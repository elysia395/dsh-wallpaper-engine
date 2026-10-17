/**
 * preset-store.js — 玻璃预设的**客户端通道**：清单与正文住宿主文件
 *（`glass-presets/<id>.json`，两层：随包只读 + 用户层），应用走 settings 通道。
 *
 * ADR-0011 起，预设是**整机配置快照**（四段：settings 总是带 + 字体/吉祥物/头像按需携带），
 * 见 docs/adr/0011-preset-full-snapshot.md 的 D1 / D3 / D4 / D7。本文件的四条主路：
 *   · **应用**（applyPreset）：读回正文 → settings 段一次合并 → 资产走宿主 `install-assets`
 *     拿回 `applied`（文件名 / 显示盒 / 字体值 —— **图片本体只在宿主侧进出 base64**，
 *     浏览器不碰）→ persistSelection() → reapplyAll() → emit()。
 *   · **保存**（saveGlassPreset）：POST create 只带 `embed` 名单（勾了哪些资产段），
 *     不上传任何图片 —— 内嵌由宿主按名单从本机数据目录取。
 *   · **导入**（importGlassPreset）：本地预检三道（读不出 / 非 JSON / tag 不对）后把
 *     导出正文原样 POST 给宿主权威校验；**导入 ≠ 立刻应用**。
 *   · **导出**（exportGlassPresetUrl）：普通链接（宿主带 Content-Disposition 应答），
 *     `assets=` 查询参数就是勾选名单；不引入 blob / showSaveFilePicker。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域" =
 * 同一 prelude / src/client.js 的顶层；函数声明提升 ⇒ client.js 的函数可在调用期使用）：
 *   selection                                   ← 共享 store（本文件只写瞬态/经入口写字段）
 *   PROFILE_PRESET_SCHEMA_TAG / PROFILE_PRESET_KEYS / sanitizePresetValues ← lib/settings-schema.js
 *   FONTSET_KEYS / sanitizeFontset               ← lib/settings-schema.js（字体段载体）
 *   isGlassPresetId                              ← lib/settings-schema.js（与字体集 id 同一条白名单）
 *   BASE / apiFetch                              ← src/api-client.js（宿主 API 唯一出入口）
 *   hostFailureReason                            ← src/client.js（失败原因的唯一翻译出口）
 *   setTransient                                 ← src/client.js（瞬态字段的唯一写入口）
 *   setSetting                                   ← src/client.js（持久化设置的唯一写入口）
 *   landPresetFontSet                             ← src/fontset-store.js（预设字体落位：专用槽 preset-font，不写用户活动集）
 *   persistSelection                             ← src/persistence.js（应用预设 = 走设置通道落盘）
 *   syncLayers / syncRotationTimer / syncSceneAudio ← src/client.js / src/live-layer.js（reapplyAll 编排）
 *   emit                                         ← 单向重渲染
 * 本文件自己的内部约定（不导出、别处不该有）：
 *   gpFetch / gpJson               通道内**所有**请求都走它们 ⇒ 一律 `parse: 'always'`
 *                                  （非 2xx 的 `{ error }` 正是要给用户看的原因）
 *   glassPresetFailureReason(res)  失败文案的唯一出口：宿主给了 `{ error }` 就用它的原话
 *                                  （客户端显示处再过 weT 查英文表）；**裸状态码**（404/405
 *                                  且无信封）翻译成"宿主还是没有这条路由"
 * 提供的入口：
 *   loadGlassPresets()             启动加载：清单 → selection.glassPresets（失败不挡启动，只留原因）
 *   refreshGlassPresets()          重读清单（保存 / 删除 / 导入后调用）
 *   applyPreset(id)                **应用**（ADR-0011 D3）：整快照合并 + 资产落位 +
 *                                  persistSelection() + reapplyAll() 落效
 *   applyGlassPreset(id)           旧名别名（一行委托到 applyPreset；构建脚本的 marker
 *                                  按旧签名钉住本文件，勿删）
 *   reapplyAll()                   **整批重应用**编排点：emit() 订阅链之外的几件
 *                                  （syncLayers / syncRotationTimer / syncSceneAudio）
 *   saveGlassPreset(name, embeds)  以当前整机配置新建一份用户预设（embeds = 资产勾选名单）
 *   presetSaveChecks(checks)       保存时的资产勾选**提示语**（勾了但本机没有 ⇒ 提示"会声明成
 *                                  无"，**不拦** —— 见本函数注释）
 *   exportGlassPresetUrl(id, embeds) 导出链接（普通 <a> 导航；宿主带附件头）
 *   importGlassPreset(file)        导入一份导出文件（成功后回读清单，**不自动应用**）
 *   deleteGlassPreset(id)          删预设（出厂或用户皆可；出厂删了即永久 ——
 *                                  墓碑遮蔽，没有恢复通道）
 *
 * 不变量：
 *   · **整套采用或整套不动**：应用预设只有拿到宿主那份完整正文（消毒产物）才写进
 *     selection；且 settings 段是**一次** `Object.assign`，资产应用失败时按合并前的
 *     快照原样滚回（此刻还没有任何落盘）—— 失败保留现状并给出可判定原因，绝不"改了一半"。
 *   · **两段的"缺席"语义相反，别写反**（ADR-0011 D4）：settings 段是完整快照（缺键补默认，
 *     由 sanitizePresetValues 保证）；资产段是**四态** —— ① 段不出现 = **一个键都不碰**
 *     （不是回落默认）：正文没有 assets、或宿主 `applied` 里没有那一段，对应的现值原样保留；
 *     ② 段是 `null` = **显式声明无**：那一族回内置默认（宿主删掉本机文件并回
 *     `{ cleared: true }`，这里把键置空）；③ 段是**字符串** = **指向出厂自带形态**（只 mascot 有：
 *     宿主同样删掉本机立绘族、回 `{ form }`，这里额外把 `ropeForm` 钉成它）；
 *     ④ 段是对象 = 携带。少了 ②，一份"范围小"的预设就撤销不了前一份预设装上的资产
 *     （实测 7 套出厂预设两两 A→B→A：42 个有序对里 30 个不收敛）。
 *   · **字体键不住 settings blob**：字体值经 `setFontValues` 写进 selection 并落盘到
 *     `fontsets/<活动 id>.json`；直接 Object.assign 进 selection 会"屏上变了、重启被回滚"。
 *   · **应用走设置通道**：合并之后只调 `persistSelection()`（debounce PUT + 本地缓存）。
 *     预设应用不是新的一条持久化通道 —— 它改的键就是 settings 键。
 *   · **清单是宿主的投影**：瞬态字段，来源永远是宿主；失败保留上一次清单并写原因
 *     （不静默清空）。
 *   · **保存前先消毒**：交给宿主的 settings 段先过 `sanitizePresetValues`（客户端、宿主
 *     两端同一套消毒 ⇒ 用户看到要存的和实际存下的永远一致）；宿主那边还会再消毒一次
 *     （权威），两头同源不会打架。
 *   · **base64 不进浏览器**：保存只传 `embed` 名单；应用只调 `install-assets` 拿文件名 /
 *     显示盒 / 字体值。这是刻意的设计（浏览器不处理大 payload，也不新增第二条落盘通道）。
 *   · 本文件必须保持浏览器安全（无 import / Node API），且**不得有顶层可执行语句**读
 *     外层 const（会被内联到 bundle 顶部，撞 TDZ）—— 因此 BASE 只在函数体里读。
 */

/** 通道内的请求：**一律** `parse: 'always'`（理由见 fontset-store.js 同名段，不复述）。 */
const gpFetch = (path, options) => apiFetch(path, Object.assign({ parse: "always" }, options || {}));
const gpJson = (path, options) => gpFetch(path, Object.assign({ method: "GET" }, options || {}));

function glassPresetFailureReason(res) {
  const bare = !res || !res.data || typeof res.data !== "object" || !res.data.error;
  if (bare && (res.status === 404 || res.status === 405)) {
    return weT("宿主里没有玻璃预设路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）");
  }
  // ⚠️ 404 **带** JSON body 也会漏英文给用户（#188）：宿主 404 `{"error":"unknown preset"}`
  //    时 `bare` 为 false ⇒ 原句直落 `hostFailureReason` ⇒ "unknown preset" 原样上屏。
  //    这句英文没有中文键、也没查 weT。
  // **因果两分**（#199 的后续）：新宿主会把这个 404 的**原因**写进 body 的 `reason`
  //    —— `missing`（真的没有这份预设）/ `tombstone`（出厂预设已被删除）—— 这两种
  //    情况下路由是在的，重启 DSH 一点用都没有 ⇒ 各给一条能走下去的出路；只有
  //    **没有 reason**（旧宿主，或 #199 之前的宿主）才归"重启 DSH"：那一刻通常是
  //    升级窗口期（新客户端 + 旧后端），卡片/弹窗的动作必然失败，出路就是重启，
  //    不是"该重存"（那是 422 version-obsolete 的语义）。
  if (res.status === 404 && res.data && res.data.error === "unknown preset") {
    if (res.data.reason === "tombstone") {
      return weT("这份出厂预设已被删除 —— 刷新清单后会从列表里消失");
    }
    if (res.data.reason === "missing") {
      return weT("这份预设不存在了 —— 可能已被删掉，刷新清单后再选一份");
    }
    return weT("宿主里没有玻璃预设路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）");
  }
  return hostFailureReason(res);
}

/**
 * 失败/状态原因的**唯一写点**（本文件内）：`glassPresetError` 是已知瞬态字段，
 * 这里的**一处**裸直写是它在本文件的全部形态 —— 清单/应用/保存/导入/删除各路的失败
 * 与清空都汇到它，配合 emit 让面板立刻显示。顺手清掉上一条成功提示（`glassPresetNote`，
 * 经 setTransient 写 —— 见 importGlassPreset），失败与成功不同屏残留。
 * 判据：verify-client ①e 的上界棘轮。
 */
function setPresetError(why) {
  setTransient("glassPresetNote", "");
  selection.glassPresetError = why;
  emit();
}

function glassPresetsUrl() { return BASE + "/glass-presets"; }
function glassPresetCreateUrl() { return glassPresetsUrl() + "/create"; }
function glassPresetUrl(id) { return glassPresetsUrl() + "/" + encodeURIComponent(id); }

/**
 * 当前 selection 里的**完整 settings 段快照**（消毒后）—— 保存共用的收集路径：
 * 键集单一来源（PROFILE_PRESET_KEYS 派生自 KINDS），消毒两端同源（sanitizePresetValues）。
 * ⚠️ 字体键**不在**这里面（它们住 `fontsets/<id>.json`，见 pickPresetFontValues）。
 */
function pickPresetValues() {
  const out = {};
  for (const key of PROFILE_PRESET_KEYS) out[key] = selection[key];
  return sanitizePresetValues(out);
}

/** 当前**活动字体集**的值（消毒后）—— 字体段的载体（ADR-0011 D4）。 */
function pickPresetFontValues() {
  const out = {};
  for (const key of FONTSET_KEYS) out[key] = selection[key];
  return sanitizeFontset(out);
}

/**
 * 启动加载：清单 → `selection.glassPresets`。**失败不挡启动**（清单只是面板的一行，
 * 拿不到就显示原因）—— 它绝不能进 `loadPersisted().then(...)` 的主链路径语义：
 * 字体集拿不到正文算"功能不可用"，预设清单拿不到只是"暂时列不出来"。
 * @returns 是否拿到了清单
 */
async function loadGlassPresets() {
  try {
    const res = await gpJson(glassPresetsUrl());
    if (!res.ok || res.error) {
      setPresetError(glassPresetFailureReason(res));
      return false;
    }
    const data = res.data || {};
    selection.glassPresets = Array.isArray(data.presets) ? data.presets : [];
    setPresetError("");
    return true;
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    return false;
  }
}

/** 重读清单（保存 / 删除 / 导入后调用）。失败保留上一次清单并写原因 —— 不静默清空。 */
async function refreshGlassPresets() { return loadGlassPresets(); }

/**
 * 把宿主 `install-assets` 回的 `applied` 合并进 selection（ADR-0011 D4 的"应用半边"）。
 *
 * ⚠️ 判据是"`applied` **里有没有**这一段"：宿主没回的段**一个键都不碰** —— 那正是
 * "缺席 = 保持现值"的语义；正文没有 assets 时调用方根本不会进来（见 applyPreset）。
 * ⚠️ 段里的 `{ cleared: true }` = **显式声明无**（D4 第三态）：宿主已删掉本机文件，这里把
 * 那一族的键清空（吉祥物两个键 / 头像两侧一起）；`{ form: 'phoebe' }` = **指向出厂自带形态**
 * （D4 第四态）：同一件清空之外，还要把 `ropeForm` 钉成 `form`。两者与"没回这一段"必须区别
 * 对待。
 * 返回 "" = 全部落位；非空 = 可判定的失败原因（形状不对 = 宿主契约被破坏，要说出来）。
 */
async function applyPresetAssets(applied) {
  if (!applied || typeof applied !== "object" || Array.isArray(applied)) {
    return weT("预设的资产应用失败：{reason}", { reason: weT("宿主回包里没有 applied 形状") });
  }
  const font = applied.font;
  if (font && typeof font === "object" && font.values && typeof font.values === "object") {
    // 字体值走**字体集通道**，落进**预设专用字体集**（固定 id `preset-font`，见
    // fontset-store.js 的 landPresetFontSet）—— **绝不写用户当前的活动字体集**：那是
    // 用户自己的设计（实测教训：黑客绿的字体段落进活动集后把它整个染绿，之后任何
    // 预设下手动开自定义都见绿）。activateFontSet 会把槽里的值读回采用；槽的显示名
    // 用预设自带的 font.name。失败走 applyPreset 的整批滚回。
    if (!(await landPresetFontSet(sanitizeFontset(font.values), font.name))) {
      return weT(selection.fontSetError || "宿主不可达（请求未完成）");
    }
  }
  const mascot = applied.mascot;
  if (mascot && typeof mascot === "object" && !Array.isArray(mascot)) {
    if (typeof mascot.form === "string" && mascot.form) {
      // 「指向出厂自带形态」（D4 第四态）：宿主已清掉本机立绘族，这里**两件事一起做** ——
      // ① 把 `ropeForm` 钉成内置的那只（少了它，这一态就退化成"声明无"：形态交回 settings 段）；
      // ② 两个自定义键置空（图已被删掉，键还指着那个不存在的文件名 ⇒ 渲染仍走自定义分支、
      //    屏上那只直接消失）。
      setSetting("ropeForm", mascot.form);
      setSetting("mascotImage", "");
      setSetting("mascotImageBox", "");
    } else if (mascot.cleared === true) {
      // 「显式声明无」：宿主已把本机立绘文件删掉，这里把那两个键也清空 —— 与"宿主没回
      // 这一段"**必须**区别开：没回 = 一个键都不碰，回了 cleared = 明确要求回到内置立绘。
      setSetting("mascotImage", "");
      setSetting("mascotImageBox", "");
    } else {
      setSetting("mascotImage", typeof mascot.file === "string" ? mascot.file : "");
      setSetting("mascotImageBox", typeof mascot.box === "string" ? mascot.box : "");
    }
  }
  const avatar = applied.avatar;
  if (avatar && typeof avatar === "object" && !Array.isArray(avatar)) {
    if (avatar.cleared === true) {
      // 整族声明无 ⇒ 两侧一起清（只清一侧会让另一侧接着用旧图，"声明无"就不成立了）。
      setSetting("avatarUserImage", "");
      setSetting("avatarAiImage", "");
    } else {
      // 两张头像各自独立：宿主只落了哪张就写哪张，另一张保持现值（缺席 = 不碰）。
      if (avatar.user && typeof avatar.user === "object") {
        setSetting("avatarUserImage", typeof avatar.user.file === "string" ? avatar.user.file : "");
      }
      if (avatar.ai && typeof avatar.ai === "object") {
        setSetting("avatarAiImage", typeof avatar.ai.file === "string" ? avatar.ai.file : "");
      }
    }
  }
  return "";
}

/**
 * **整批重应用**（ADR-0011 D3）：`emit()` 的订阅链只覆盖 syncLayers / applyEffects /
 * syncFxLayer / syncParallaxLayer / syncAvatarLayer；下面这几件**不在**订阅链里、也不在
 * syncLayers 体内（源码核实），漏掉就是"轮播开关变了但定时器没重排 / 场景音频没人管"：
 *   · syncLayers()        场景层重建（sceneLive 开关 / fps 档 / liveSrc 键都进层键）
 *   · syncRotationTimer() 轮播定时器按新的开关与间隔重排
 *   · syncSceneAudio(selection) 场景包 BGM 的装/拆与互斥（依赖 syncLayers 刚写的层状态）
 * applyEffects（玻璃 / 字体族）**不在这里**：紧跟其后的 emit() 是它的订阅者，天然跑一次。
 * 不逐键调用 on* 处理器 —— 那些处理器混着"写设置 + 清记忆 + 重建层"，会把失败记忆
 * 清空这类副作用带进来（与"预设不携带运行期记忆"矛盾，见 ADR D3）。
 */
function reapplyAll() {
  syncLayers();
  syncRotationTimer();
  syncSceneAudio(selection);
}

/**
 * 应用一份预设（**整套采用**，ADR-0011 D3）：读回正文 → settings 段**一次**合并 →
 * （正文带资产段时）调宿主 `install-assets` 并把 `applied` 落进 selection →
 * persistSelection() → reapplyAll() 落效 → emit()。任何一步失败都不动现状 ——
 * settings 段合并后若资产步失败，按合并前的快照**原样滚回**（屏幕与内存都回到现状），
 * 落盘从未发生（persistSelection 在全部成功之后才调）。
 * @returns 是否成功
 */
async function applyPreset(id) {
  if (!isGlassPresetId(id)) return false;
  try {
    const res = await gpJson(glassPresetUrl(id));
    if (!res.ok || res.error) {
      setPresetError(glassPresetFailureReason(res));
      return false;
    }
    // 旧 tag 的正文：宿主 422 拒读。失败原因已是"版本作废"的点名文案，原样上屏
    //（面板在显示处再过一次 weT 查英文表）。走 setPresetError 早退 = 现状一个键都不动。
    const values = sanitizePresetValues(res.data && res.data.values);
    // ── settings 段：完整快照，一次合并（合并前先拍快照：资产步失败时原样滚回）──
    const before = {};
    for (const key of PROFILE_PRESET_KEYS) before[key] = selection[key];
    Object.assign(selection, values);
    // ── 资产段：正文带了才调 install-assets（缺席 = 一个键都不碰，不是回落默认）──
    const rawAssets = res.data && res.data.assets;
    if (rawAssets && typeof rawAssets === "object" && !Array.isArray(rawAssets)) {
      const assetRes = await gpFetch(glassPresetUrl(id) + "/install-assets", { method: "POST" });
      const applied = assetRes.ok && !assetRes.error ? assetRes.data && assetRes.data.applied : null;
      const why = applied ? (await applyPresetAssets(applied)) : glassPresetFailureReason(assetRes);
      if (why) {
        // 资产落不下：整批放弃 —— settings 段按快照滚回（此刻还没有任何落盘）。
        for (const key of PROFILE_PRESET_KEYS) selection[key] = before[key];
        setPresetError(weT("预设的资产应用失败：{reason}", { reason: weT(why) }));
        return false;
      }
    }
    setPresetError("");
    persistSelection(); // debounce 200ms 的 PUT + 本地缓存 —— 与滑块拖动同一条路
    reapplyAll();       // emit() 订阅链之外的那几件：层重建 / 轮播定时器 / 场景音频
    emit();
    return true;
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    return false;
  }
}

/**
 * 旧名别名（ADR-0011 改名 applyPreset 后保留）：构建脚本
 * scripts/build-client.mjs 的 INLINE_MODULES marker 按旧签名 `applyGlassPreset(id)`
 * 钉住本文件，一行委托保住那个锚点 —— 语义已全部在 applyPreset 里。
 */
async function applyGlassPreset(id) { return applyPreset(id); }

/** 新建预设的 id：单段白名单内、按时间戳递增（宿主只做形状校验与顺延）。 */
function newGlassPresetId() {
  return "preset-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

/**
 * 保存时的资产勾选**提示语**（ADR-0011 D4 三态的客户端半边）。
 * `checks` 是三个布尔（字体 / 吉祥物 / 头像）。口径：
 *   · **勾上** = "按本机现状声明这一族" —— 本机没有自定义图 ⇒ 落盘的就是 `null`（**显式
 *     声明无**），套用它的人回到内置默认；宿主侧对"勾了但没有"就是这样落的，不需要客户端拦。
 *   · **不勾** = "这一族我不管" —— 段根本不出现，对方的现值一个键都不碰。
 * 旧版把"勾了但本机没有"直接拦下（`return` 一句错误、保存失败）：结果是**用户自存预设永远
 * 无法声明"无"** —— 那一族只能靠出厂预设里的 `null` 来清，自己那份永远清不掉（本次缺陷的
 * 客户端半边）。改成"照存 + 一句人话"，出路写在提示里（想带上就先导入一张 / 不想动对方就取消勾选）。
 * @returns "" = 无需提示；非空 = 给用户的一句人话（**不阻断保存**）
 */
function presetSaveChecks(checks, mascotPoint) {
  const c = checks && typeof checks === "object" ? checks : {};
  // 吉祥物族的**指向**（第四态）：非空 ⇒ 这一族存的是"指向出厂自带的那一只"，不是"无"也不带图。
  const point = ROPE_FORM_VALUES.includes(mascotPoint) ? mascotPoint : "";
  const notes = [];
  if (c.font === true) {
    const f = pickPresetFontValues();
    const hasFontTweaks = f.themeColors && typeof f.themeColors === "object"
      && Object.keys(f.themeColors).length > 0;
    if (!hasFontTweaks) {
      notes.push(weT("字体这一族会按本机现状存成「无」（当前字体集还是全默认）—— 套用它的人回到内置字体；想带上自己的就先在字体页调好，或取消勾选「字体」（不勾 = 不动对方的字体）"));
    }
  }
  if (c.mascot === true && point) {
    // 有指向 ⇒ 上面那条"会存成「无」"不成立（这正是第四态要消掉的那个歧义），改说这一族存的是什么。
    notes.push(weT("吉祥物这一族存的是「指向出厂自带的「{name}」」（不占体积、不带图）—— 套用它的人换回那一只，他自己导入的立绘会先被清除", { name: ROPE_FORMS[point].label }));
  } else if (c.mascot === true && !selection.mascotImage) {
    notes.push(weT("吉祥物这一族会按本机现状存成「无」（本机没有自定义立绘）—— 套用它的人回到内置立绘；想带上自己的就先在「系统」页签导入一张，或取消勾选「吉祥物」（不勾 = 不动对方的立绘）"));
  }
  if (c.avatar === true && !selection.avatarUserImage && !selection.avatarAiImage) {
    notes.push(weT("头像这一族会按本机现状存成「无」（本机没有自定义会话头像）—— 套用它的人回到内置默认头像；想带上自己的就先在「扩展」页签导入，或取消勾选「头像」（不勾 = 不动对方的头像）"));
  }
  return notes.join(" ");
}

/**
 * 以**当前整机配置**保存一份用户预设（ADR-0011 D1：settings 段总是带；资产段按
 * `selection.glassPresetAssetChecks` 的勾选名单 —— 宿主按名单从本机数据目录内嵌图片
 * 本体，浏览器不上传图片）。重载入口见 `savePresetWithEmbeds`。
 * @returns 新预设的 id（失败给空串）
 */
async function saveGlassPreset(name) {
  const checks = (selection.glassPresetAssetChecks && typeof selection.glassPresetAssetChecks === "object")
    ? selection.glassPresetAssetChecks : {};
  const embeds = ["font", "mascot", "avatar"].filter((k) => checks[k] === true);
  // 指向出厂自带（第四态）与"内嵌这一族"互斥：那一段没有字节可带，正文里只存指向字符串。
  const point = ROPE_FORM_VALUES.includes(checks.mascotPoint) ? checks.mascotPoint : "";
  return savePresetWithEmbeds(name, embeds.filter((k) => !(k === "mascot" && point)), point);
}

/**
 * 保存的实现体（勾选名单显式入参 —— glassPresetCtx 在「保存预设」那一下把对话框的
 * 勾选写进 selection 后经 saveGlassPreset 进来）。
 * 成功后回读清单（新那一片就是反馈）。重名（宿主 409）⇒ 原因进 `selection.glassPresetError`。
 * @param {string} name 预设名
 * @param {string[]} embeds 'font' | 'mascot' | 'avatar' 的子集
 * @param {string} mascotPoint 吉祥物族的**指向**（第四态）："" = 按本机现状；形态值 = 只存指向
 */
async function savePresetWithEmbeds(name, embeds, mascotPoint) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    setPresetError(weT("先给预设起个名字"));
    return "";
  }
  const list = Array.isArray(embeds) ? embeds.filter((k) => k === "font" || k === "mascot" || k === "avatar") : [];
  // 有指向时这一族**照样算"带上了"**（只是带的是指向而不是字节）—— 提示语据此二选一。
  const point = ROPE_FORM_VALUES.includes(mascotPoint) ? mascotPoint : "";
  const hasMascotSeg = list.includes("mascot") || Boolean(point);
  // 提示语（**不阻断保存**）：勾了但本机没有 ⇒ 这一族会被**显式声明为「无」**，先把后果说清。
  const assetNote = presetSaveChecks({ font: list.includes("font"), mascot: hasMascotSeg, avatar: list.includes("avatar") }, point);
  // settings 段里的 `ropeForm` 与资产段的指向**必须是同一只**：宿主 `installAssets` 在 settings 合并
  // **之后**跑，`assets.mascot` 的字符串会覆盖 `ropeForm` —— 两处不一致只会让"只读 values 的读者"
  // （导出正文 / 手工查看）看到另一只吉祥物。
  const values = pickPresetValues();
  if (point) values.ropeForm = point;
  try {
    const res = await gpFetch(glassPresetCreateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: trimmed, values, id: newGlassPresetId(), embed: list,
        ...(point ? { point: { mascot: point } } : {}),
      }),
    });
    if (!res.ok) {
      setPresetError(glassPresetFailureReason(res));
      return "";
    }
    setPresetError(""); // 顺手清掉上一条提示 —— 所以下面这条提示必须写在它**之后**
    if (assetNote) setTransient("glassPresetNote", assetNote);
    await refreshGlassPresets();
    emit();
    const data = res.data || {};
    return typeof data.id === "string" ? data.id : "";
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    return "";
  }
}

/**
 * 导出链接（ADR-0011 D7）：**普通链接** —— 调用方把它交给 `<a href>` / 锚点点击导航，
 * 宿主以 `Content-Disposition: attachment` 应答。不引入 blob / showSaveFilePicker。
 * `embeds`（勾选名单）走 `assets=` 查询参数，逗号分隔；`mascotPoint`（第四态）走 `point=mascot:<形态>`
 * —— 与 `assets=` 里的 `mascot` **互斥**（有指向时那一段没有字节可带，宿主按声明写字符串）。
 */
function exportGlassPresetUrl(id, embeds, mascotPoint) {
  if (!isGlassPresetId(id)) return "";
  const list = Array.isArray(embeds) ? embeds.filter((k) => k === "font" || k === "mascot" || k === "avatar") : [];
  const q = [];
  if (list.length) q.push("assets=" + encodeURIComponent(list.join(",")));
  if (ROPE_FORM_VALUES.includes(mascotPoint)) q.push("point=" + encodeURIComponent("mascot:" + mascotPoint));
  return glassPresetUrl(id) + "/export" + (q.length ? "?" + q.join("&") : "");
}

/**
 * 导入一份预设文件。三道**本地**预检各给一句可判定文案，再把导出正文**原样**交给宿主
 * 做权威校验（宿主按占用情况分配新 id；旧 tag 与坏正文由宿主拒绝）：
 *   ① 文件读不出来 ⇒ "读不出这个文件"；② 不是 JSON ⇒ 点明；③ `$schema` 不对 ⇒ 点明
 *   **要哪个标记**（这条最关键：用户可能拖进来任意 .json，笼统说"导入失败"等于什么都没说）。
 * 成功 = 回读清单 + 一条成功提示；**不自动应用**（导入 ≠ 立刻用 —— 想用去清单里点它）。
 * @returns 新的 id（失败给空串）
 */
async function importGlassPreset(file) {
  setPresetError("");
  let text;
  try {
    text = await gpReadFileText(file);
  } catch {
    setPresetError(weT("读不出这个文件（换一个 .json 再试）"));
    return "";
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    setPresetError(weT("这不是 JSON 文件（预设是导出出来的 .json）"));
    return "";
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.$schema !== PROFILE_PRESET_SCHEMA_TAG) {
    setPresetError(weT("这不是预设文件（需要 {tag} 标记 —— 只有从「导出」拿到的文件才有）", { tag: PROFILE_PRESET_SCHEMA_TAG }));
    return "";
  }
  try {
    const res = await gpFetch(glassPresetsUrl() + "/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    if (!res.ok) {
      setPresetError(glassPresetFailureReason(res));
      return "";
    }
    const data = res.data || {};
    const name = typeof data.name === "string" && data.name ? data.name : (typeof data.id === "string" ? data.id : "");
    setTransient("glassPresetNote", weT("已导入：{name}（在上面列表里点它才会应用）", { name }));
    setPresetError("");
    await refreshGlassPresets();
    emit();
    return typeof data.id === "string" ? data.id : "";
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    return "";
  }
}

/**
 * 读一个 File 的文本（与 src/fontset-store.js 的同名助手同形 —— 那边没有 export，
 * 但**函数名不能撞**：两个模块平铺进 bundle 是同一作用域，故这里用族前缀专名）。
 * `file.text()` 是 Blob 的标准方法（Chromium/Electron 都有）；旧的 / 替身形态退回到
 * FileReader —— 两条都失败才报错（失败要**可判定**，不许静默）。
 */
function gpReadFileText(file) {
  if (file && typeof file.text === "function") return Promise.resolve(file.text());
  return new Promise((resolve, reject) => {
    try {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result == null ? "" : fr.result));
      fr.onerror = () => reject(new Error("read-failed"));
      fr.readAsText(file);
    } catch (e) {
      reject(e);
    }
  });
}

/** 删预设：出厂或用户皆可（出厂 = 宿主落墓碑永久遮蔽，不可恢复；界面上两步确认）。 */
async function deleteGlassPreset(id) {
  if (!isGlassPresetId(id)) return false;
  try {
    const res = await gpFetch(glassPresetUrl(id), { method: "DELETE" });
    if (!res.ok) {
      setPresetError(glassPresetFailureReason(res));
      return false;
    }
    setPresetError("");
    await refreshGlassPresets();
    emit();
    return true;
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    return false;
  }
}
