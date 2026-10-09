/**
 * preset-store.js — 玻璃预设的**客户端通道**：清单与正文住宿主文件
 *（`glass-presets/<id>.json`，两层：随包只读 + 用户层），应用走 settings 通道。
 *
 * 为什么不并进 persistence.js / fontset-store.js：三者的**真源不同**（settings blob ↔
 * `fontsets/<活动 id>.json` ↔ `glass-presets/<id>.json`）、**键集不同**（预设键是玻璃
 * 子系统的完整快照）、**失败语义也不同**（清单读不出来要可见、但绝不能挡启动）。
 * 合成一条会让"这个值到底存哪"变成要通读三处才能回答的问题。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域" =
 * 同一 prelude / src/client.js 的顶层）：
 *   selection                                   ← 共享 store（本文件只读写瞬态字段）
 *   GLASS_PRESET_KEYS / sanitizeGlassPresetValues / isGlassPresetId ← lib/settings-schema.js
 *   BASE / apiFetch                             ← src/api-client.js（宿主 API 唯一出入口）
 *   hostFailureReason                           ← src/client.js（失败原因的唯一翻译出口）
 *   readFileText                                ← src/fontset-store.js（File → 文本的唯一读法）
 *   persistSelection                            ← src/persistence.js（应用预设 = 走设置通道落盘）
 *   applyEffects                                ← src/effects.js
 *   emit                                        ← 单向重渲染
 * 本文件自己的两条内部约定（不导出、别处不该有）：
 *   gpFetch / gpJson               通道内**所有**请求都走它们 ⇒ 一律 `parse: 'always'`
 *                                  （非 2xx 的 `{ error }` 正是要给用户看的原因）
 *   glassPresetFailureReason(res)  失败文案的唯一出口：宿主给了 `{ error }` 就用它的原话
 *                                  （客户端显示处再过 weT 查英文表）；**裸状态码**（404/405
 *                                  且无信封）翻译成"宿主还是没有这条路由"
 * 提供的入口：
 *   loadGlassPresets()             启动加载：清单 → selection.glassPresets（失败不挡启动，只留原因）
 *   refreshGlassPresets()          重读清单（保存 / 删除 / 导入后调用）
 *   applyGlassPreset(id)           **应用**：读回 values → 整快照合并进 selection →
 *                                  persistSelection()（debounce PUT）→ applyEffects()（立即落效）
 *   saveGlassPreset(name)          以当前玻璃值新建一份用户预设（重名 ⇒ selection.glassPresetError）
 *   deleteGlassPreset(id)          删预设（出厂或用户皆可；出厂删了即永久 ——
 *                                  墓碑遮蔽，没有恢复通道）
 *   glassPresetExportUrl(id)       导出 = **普通链接**（宿主带 `Content-Disposition: attachment`
 *                                  应答）—— 不引入 blob，也不自己造保存通道（同字体集）
 *   importGlassPreset(file)        导入一份**导出出来的** .json：本地三道预检 → 宿主权威校验
 *                                  → 回读清单。**不自动应用**（"导入"不等于"立刻用"）
 *
 * 不变量：
 *   · **整套采用或整套不动**：应用预设只有拿到宿主那份完整正文（消毒产物）才写进
 *     selection，且是**一次**合并；失败时保留现状并给出可判定原因 —— 绝不"改了一半"。
 *   · **应用走设置通道**：合并之后只调 `persistSelection()`（debounce 200ms 的 PUT +
 *     本地缓存）+ `applyEffects()`。预设应用**不是**新的一条持久化通道 —— 它改的键
 *     就是 settings 键，走同一条路才不会出现"面板显示与真源分叉"。
 *   · **清单是宿主的投影**：瞬态字段，来源永远是宿主；失败保留上一次清单并写原因
 *     （不静默清空）。
 *   · **保存前先消毒**：交给宿主的正文先过 `sanitizeGlassPresetValues`（客户端、宿主
 *     两端同一套消毒 ⇒ 用户看到要存的和实际存下的永远一致）；宿主那边还会再消毒一次
 *     （权威），两头同源不会打架。
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
  return hostFailureReason(res);
}

/**
 * 失败/状态原因的**唯一写点**（本文件内）：`glassPresetError` 是已知瞬态字段，
 * 这里的**一处**裸直写是它在本文件的全部形态 —— 清单/应用/保存/删除四条路的失败
 * 与清空都汇到它，配合 emit 让面板立刻显示。判据：verify-client ①e 的上界棘轮。
 */
function setPresetError(why) {
  selection.glassPresetError = why;
  emit();
}

function glassPresetsUrl() { return BASE + "/glass-presets"; }
function glassPresetCreateUrl() { return glassPresetsUrl() + "/create"; }
function glassPresetUrl(id) { return glassPresetsUrl() + "/" + encodeURIComponent(id); }

/**
 * 当前 selection 里的**完整玻璃快照**（消毒后）—— 保存与"把预设应用回来"共用同一条
 * 收集路径：键集单一来源（GLASS_PRESET_KEYS），消毒两端同源（sanitizeGlassPresetValues）。
 */
function pickGlassPresetValues() {
  const out = {};
  for (const key of GLASS_PRESET_KEYS) out[key] = selection[key];
  return sanitizeGlassPresetValues(out);
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

/** 重读清单（保存 / 删除后调用）。失败保留上一次清单并写原因 —— 不静默清空。 */
async function refreshGlassPresets() { return loadGlassPresets(); }

/**
 * 应用一份预设（**整套采用**）：读回正文 → 消毒 → **一次**合并进 selection →
 * 设置通道落盘 → `applyEffects()` 立即落效 → 重渲染。任何一步失败都不动现状。
 * @returns 是否成功
 */
async function applyGlassPreset(id) {
  if (!isGlassPresetId(id)) return false;
  try {
    const res = await gpJson(glassPresetUrl(id));
    if (!res.ok || res.error) {
      setPresetError(glassPresetFailureReason(res));
      emit();
      return false;
    }
    const values = sanitizeGlassPresetValues(res.data && res.data.values);
    Object.assign(selection, values);
    setPresetError("");
    persistSelection(); // debounce 200ms 的 PUT + 本地缓存 —— 与滑块拖动同一条路
    applyEffects();
    emit();
    return true;
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    emit();
    return false;
  }
}

/** 新建预设的 id：单段白名单内、按时间戳递增（宿主只做形状校验与顺延）。 */
function newGlassPresetId() {
  return "preset-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

/**
 * 以**当前玻璃值**保存一份用户预设。成功后回读清单（新那一片就是反馈）。
 * 重名（宿主 409）⇒ 原因进 `selection.glassPresetError`，保存行下面显示。
 * @returns 新预设的 id（失败给空串）
 */
async function saveGlassPreset(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    setPresetError(weT("先给预设起个名字"));
    emit();
    return "";
  }
  try {
    const res = await gpFetch(glassPresetCreateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, values: pickGlassPresetValues(), id: newGlassPresetId() }),
    });
    if (!res.ok) {
      setPresetError(glassPresetFailureReason(res));
      emit();
      return "";
    }
    setPresetError("");
    await refreshGlassPresets();
    emit();
    const data = res.data || {};
    return typeof data.id === "string" ? data.id : "";
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    emit();
    return "";
  }
}

/** 删预设：出厂或用户皆可（出厂 = 宿主落墓碑永久遮蔽，不可恢复；界面上两步确认）。 */
async function deleteGlassPreset(id) {
  if (!isGlassPresetId(id)) return false;
  try {
    const res = await gpFetch(glassPresetUrl(id), { method: "DELETE" });
    if (!res.ok) {
      setPresetError(glassPresetFailureReason(res));
      emit();
      return false;
    }
    setPresetError("");
    await refreshGlassPresets();
    emit();
    return true;
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    emit();
    return false;
  }
}

/**
 * 导出链接（**普通链接**，与字体集同一条腿）：宿主带 `Content-Disposition: attachment`
 * 应答 ⇒ 交给浏览器 / 桌面壳的下载管理器，插件**不**造保存通道、也不引入 blob。
 * 非法 id 给空串（面板那边 `href=""` 不会发请求 —— 与 `exportFontSetUrl` 同一口径）。
 *
 * 出厂预设也有链接（宿主路由不设卡：能读就能导）；面板只在**用户层**那一行给入口
 * （导出随包发布物没有意义），但这里不区分 —— 判定归界面，通道保持单纯。
 */
function glassPresetExportUrl(id) {
  return isGlassPresetId(id) ? glassPresetUrl(id) + "/export" : "";
}

/**
 * 导入一份**导出出来的**预设 .json。三道**本地**预检各给一句可判定文案，再交给宿主做
 * 权威校验（宿主还会查 `$schema`、限量上限、按占用情况分配新 id、重名时让位顺延）：
 *   ① 文件读不出来 ⇒ "读不出这个文件"；② 不是 JSON ⇒ 点明；③ `$schema` 不对 ⇒ 点明**要哪个标记**
 *   （这条最关键：用户可能拖进来任意 .json，笼统说"导入失败"等于什么都没说）。
 * 成功 = 回读清单（新那一格就是反馈）；**不自动应用**（同字体集："导入"不等于"立刻用"）。
 * 宿主改了名字（重名让位）时把**实际落下的名字**写进 `glassPresetImportNote`，
 * 面板如实显示 —— 静默改名比拒绝更恼人。
 * @returns 新的 id（失败给空串）
 */
async function importGlassPreset(file) {
  selection.glassPresetImportNote = "";
  let text = "";
  try {
    text = await readFileText(file);
  } catch {
    setPresetError(weT("读不出这个文件（换一个 .json 再试）"));
    return "";
  }
  let doc = null;
  try {
    doc = JSON.parse(text);
  } catch {
    setPresetError(weT("这不是 JSON 文件（预设是导出出来的 .json）"));
    return "";
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.$schema !== GLASS_PRESET_SCHEMA_TAG) {
    setPresetError(weT("这不是预设文件（需要 {tag} 标记 —— 只有从「导出」拿到的文件才有）", { tag: GLASS_PRESET_SCHEMA_TAG }));
    return "";
  }
  try {
    // 正文**原样转发**（不重新序列化）：宿主是权威校验方，中间再拼一次只会多一处失真面。
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
    setPresetError("");
    if (data.renamed === true && typeof data.name === "string" && data.name) {
      selection.glassPresetImportNote = weT("重名已让位，导入为「{name}」", { name: data.name });
    }
    await refreshGlassPresets();
    emit();
    return typeof data.id === "string" ? data.id : "";
  } catch {
    setPresetError(weT("宿主不可达（请求未完成）"));
    return "";
  }
}
