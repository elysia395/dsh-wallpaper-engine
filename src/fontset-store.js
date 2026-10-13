/**
 * fontset-store.js — 字体集的**客户端通道**：活动集的值住宿主文件，
 * 与设置（src/persistence.js）**平行但另一条**通道。
 *
 * 为什么另立一条而不是并进 persistence.js：两者的**真源不同**（settings blob ↔
 * `fontsets/<id>.json`）、**键集不同**（那字体键已退出 settings 的持久化白名单）、
 * **失败语义也不同**（设置丢一次是回退，字体集读不出来必须"整套不采用"）。
 * 合成一条会让"这个值到底存哪"再次变成要通读两处才能回答的问题。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域" =
 * 同一 prelude / src/client.js 的顶层）：
 *   selection                      ← 共享 store（本文件**只读写那字体键** + 两个瞬态字段）
 *   FONTSET_KEYS / FONTSET_MIGRATED_ID / isFontSetId / sanitizeFontset ← lib/settings-schema.js
 *   BASE / apiFetch / apiJson      ← src/api-client.js（宿主 API 唯一出入口；BASE 只在调用期读）
 *   hostFailureReason              ← src/client.js（"失败到底哪一步不对"的唯一一句文案）
 *   applyEffects                   ← src/effects.js
 *   emit                           ← 单向重渲染
 * 本文件自己的两条内部约定（不导出、别处不该有）：
 *   fsFetch / fsJson               通道内**所有**请求都走它们 ⇒ 一律 `parse: 'always'`
 *                                  （非 2xx 的 `{ error }` 正是要给用户看的原因）
 *   fontSetFailureReason(res)      失败文案的唯一出口：宿主给了 `{ error }` 就用它的原话；
 *                                  **裸状态码**（404/405 且无信封）翻译成"宿主还是没有这条路由"
 * 提供的入口：
 *   readCachedFontSetValues()      同步读本地缓存（**client.js 的 store 初始化要用**）
 *   loadFontSet()                  启动加载：活动 id + 正文 → 原子灌进 selection → 必要时重应用
 *   setFontValues(patch)           改字体值并落盘（**改值的唯一入口**，与 setSetting 同形）
 *   persistFontSet()               单独安排一次落盘（"恢复默认"那种整批赋值用；见不变量"写必成对"）
 *   flushFontSet() / onPageHideFlushFontSet() / onVisibilityResyncFontSet() / cancelPendingFontSet()
 *
 * 不变量：
 *   · **整套采用或整套不动**：只有拿到宿主那份完整正文（`sanitizeFontset` 出来的字体键）才写进
 *     selection，且是**一次** `Object.assign`。失败时保留现状（本地缓存那份）——绝不"改了一半"。
 *   · **改值只有一条路，且写必成对**：那些键的**字面直写**只许出现在 client.js 的 `onFontResetAll`
 *     整批重置里，紧跟一次 `persistFontSet()`（逐键走 `setFontValues` 会发 6 次 PUT）；其余改值
 *     一律经 `setFontValues`。⚠️ 上面那条"整套采用"是**刻意的例外**：它写的就是宿主那份，**不落盘**
 *     （落盘会立刻把宿主的副本再 PUT 回去）。判据：`verify-fontset` ⑦ 的字面直写棘轮（正/负对照）。
 *   · **localStorage 只是缓存**：启动时先同步读它（首帧就用上次的值，避免默认值→用户值跳变），
 *     宿主回了真值再覆盖。
 *   · **在途 GET 不许覆盖用户的新写**：`fontSetWrites` 计数器是这条的判据（与设置同形）。
 *   · **写只写活动集**：`PUT /fontsets/<活动 id>`；活动 id 未知时用 `FONTSET_MIGRATED_ID`
 *     （宿主那边迁移也认它 —— 两端同一个字面量，来自共享内核）。
 *   · 与设置同形：debounce 200ms、非 2xx 留脏标记并在页面重新可见时重试、pagehide 立即落盘。
 *   · 本文件必须保持浏览器安全（无 import / Node API），且**不得有顶层可执行语句**读外层 const
 *     （会被内联到 bundle 顶部，撞 TDZ）—— 因此 BASE 只在函数体里读，缓存也在函数里读。
 */

/** 活动集正文的本地缓存键（与设置缓存分开：两者真源不同，混在一起会互相顶掉）。 */
const FONTSET_CACHE_KEY = "we-fontset-active";

/**
 * 通道内的请求：**一律** `parse: 'always'`。
 * 为什么要专门包一层：`api-client` 默认只在 2xx 解析体，于是非 2xx 的 `{ error }` 读不到 ——
 * 而"失败到底哪一步不对"全靠它（默认那条路只剩一个状态码，等于什么都没说）。
 */
const fsFetch = (path, options) => apiFetch(path, Object.assign({ parse: "always" }, options || {}));
const fsJson = (path, options) => fsFetch(path, Object.assign({ method: "GET" }, options || {}));

/**
 * 字体集通道的失败文案。
 *
 * **裸状态码 = 请求没到本族**。本族的每个非 2xx 都由 `sendJson` 发 `{ error }` 信封
 * （`not found` / `method not allowed` / `invalid fontset id` …），所以一个**没有信封**的
 * 404/405 只可能来自别的层（SPA 兜底 / 静态层）。实测语义只有一个：**宿主里没有这条路由**。
 * 最常见的原因是**宿主没重挂**：宿主模块只在启动时 load 一次，而浏览器里的 bundle 是
 * 每次刷新重新取的；于是"刷新页面只换前端、宿主那份还是启动时那份"，表现就是这两个裸状态码。
 * 这种话必须说出来：用户看到"宿主返回 404"只能一脸茫然，看到这句就知道去重启 DSH。
 */
function fontSetFailureReason(res) {
  const bare = !res || !res.data || typeof res.data !== "object" || !res.data.error;
  if (bare && (res.status === 404 || res.status === 405)) {
    return weT("宿主里没有字体集路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）");
  }
  return hostFailureReason(res);
}

function fontSetsUrl() { return BASE + "/fontsets"; }
function fontSetUrl(id) { return fontSetsUrl() + "/" + encodeURIComponent(id); }

/** 读本地缓存那份 → `{ id, values, dirty }`（形状不合就当作没有；无 `dirty` 字段 = false）。 */
function readCachedFontSet() {
  try {
    const raw = localStorage.getItem(FONTSET_CACHE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || !isFontSetId(doc.id)) return null;
    return { id: doc.id, values: sanitizeFontset(doc.values), dirty: doc.dirty === true };
  } catch {
    return null;
  }
}
/**
 * 字体键的**兜底**值（空对象 / 空 map = 不覆盖官方外观），**一定齐全、一定是对象**。
 *
 * 为什么 selection 初始化必须用它：这些键已不在 settings 白名单里 ⇒ `readPersisted()` 不再提供它们，
 * 而字体集是**异步**载入的、还可能失败。少了这份兜底，`selection` 会**根本没有这几个键**，
 * 于是面板那份 `fontCustom` 门控的「文字颜色角色」区（`sel.themeColors[role.id]`）在**打开总开关的
 * 那一刻**抛 TypeError —— React 渲染期抛 = 整个面板崩掉（症状：点「字体自定义」当场白屏）。
 * 兜底必须发生在**同步**的初始化里，且排在缓存之前（有缓存时用缓存那份）。
 */
function fontValueDefaults() { return sanitizeFontset({}); }
/** 启动初始化用：缓存里的那些值（没有就给兜底那份）。 */
function readCachedFontSetValues() {
  const doc = readCachedFontSet();
  return doc ? doc.values : fontValueDefaults();
}
function writeFontSetCache(id, values, dirty) {
  // dirty = 这份缓存**还没被宿主确认**（写缓存先于 PUT；PUT 成功后会写回干净那份）。
  // 它是跨重启的"上次落盘是否成功"记忆 —— 没有它，重启后的加载分不清
  // "宿主就是这份"和"宿主是旧的、上次 PUT 失败了"（后者 = 静默回滚）。
  try { localStorage.setItem(FONTSET_CACHE_KEY, JSON.stringify({ id, values, dirty: dirty === true })); } catch { /* 缓存写失败不影响真源 */ }
}

// 活动集 id：宿主回的为准；未知时留空，落盘时退回 FONTSET_MIGRATED_ID。
let activeFontSetId = "";
/**
 * **采纳时那份值的快照**（规范化后的字符串）。「使用中」的判据是"当前这些键 == 这份"，而**不是**
 * "宿主指针指着它"：用户一旦手动改过字体值（字体自定义有变更），那一行就不再是"使用中"。
 * 注意这不与写回冲突：写回把改动落进这套里，快照仍是**上次采纳时**那份 ⇒ 标记消失，直到用户重新
 * 「使用」或重载（那时读回的正是含改动的那份）⇒ 标记回来。空串 = 还没采纳过（不判漂移）。
 */
let activeFontSetValues = "";
let fontSetTimer = null;
// 脏标记：非 2xx / 不可达都算"没写进去"，下次编辑或页面回到前台时重试（否则宿主那份会变旧，
// 而宿主是真源 ⇒ 下次加载会把用户刚改的字体**回滚**）。
let fontSetDirty = false;
// 在途 GET 的竞态守卫（与 persistence.js 的 persistWrites 同形）。
let fontSetWrites = 0;

/** 当前 selection 里的全部字体值（消毒后）—— 落盘与"值有没有变"的比较共用它。 */
function pickFontValues() {
  const out = {};
  for (const key of FONTSET_KEYS) out[key] = selection[key];
  return sanitizeFontset(out);
}

/** 立即写本地缓存（真源是宿主，缓存只是下次启动的同步起点）。**写缓存即标脏**：
 *  此刻这份值还没被宿主确认（紧跟着的 PUT 成功后才写回干净那份）——
 *  页面在 PUT 应答前关闭时，脏标记就是"宿主可能还是旧值"的唯一线索。 */
function cacheFontValues() {
  writeFontSetCache(activeFontSetId || FONTSET_MIGRATED_ID, pickFontValues(), true);
}

async function pushFontSet() {
  const id = activeFontSetId || FONTSET_MIGRATED_ID;
  const values = pickFontValues();
  try {
    const res = await fsFetch(fontSetUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
      keepalive: true, // 让挂起的落盘活过 pagehide/close
    });
    fontSetDirty = !res.ok;
    if (res.ok) {
      activeFontSetId = id;
      writeFontSetCache(id, values, false); // 宿主已确认 ⇒ 缓存转净
      selection.fontSetError = "";
    } else {
      selection.fontSetError = fontSetFailureReason(res);
    }
  } catch {
    fontSetDirty = true;
  }
}
function flushFontSet() {
  fontSetTimer = null;
  cacheFontValues();
  pushFontSet();
}
function scheduleFontSet() {
  if (fontSetTimer) return;
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
    flushFontSet();
    return;
  }
  fontSetTimer = window.setTimeout(flushFontSet, 200);
}

/**
 * 改字体值（**唯一入口**，与 `setSetting` 同形）：赋值 + 落盘。
 * `patch` 给几个键就改几个；其余保持不动。
 */
function setFontValues(patch) {
  if (patch && typeof patch === "object") {
    for (const key of FONTSET_KEYS) if (key in patch) selection[key] = patch[key];
  }
  fontSetWrites++;
  scheduleFontSet();
}

/** 预设应用的字体落位槽：**固定 id**（宿主 PUT 对未知 id 即创建，见 fontsets.js 的
 *  PUT 分支；id 白名单 `[A-Za-z0-9_-]{1,64}` 放行）。独立于用户的任何字体集 ——
 *  每次应用整体覆盖同一个槽 ⇒ 反复应用不增殖、不串味。 */
const PRESET_FONTSET_ID = "preset-font";

/**
 * 预设应用的字体落位（ADR-0011 D4 的宿主半边对偶）：写进**预设专用字体集**
 * （`PRESET_FONTSET_ID`），再激活采用（activateFontSet 会把槽里的值读回 selection）。
 * **绝不写用户当前的活动字体集**：那是用户自己的设计 —— 实测教训：黑客绿的字体段
 * 经 setFontValues 落进活动集后把它整个染绿，之后任何预设下手动开自定义都见绿。
 * @returns 是否成功（失败已写 selection.fontSetError）
 */
async function landPresetFontSet(values, name) {
  try {
    const res = await fsFetch(fontSetUrl(PRESET_FONTSET_ID), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: typeof name === "string" && name.trim() ? name.trim() : weT("预设字体"),
        values,
      }),
    });
    if (!res.ok) { selection.fontSetError = fontSetFailureReason(res); return false; }
  } catch {
    selection.fontSetError = weT("宿主不可达（请求未完成）");
    return false;
  }
  return activateFontSet(PRESET_FONTSET_ID); // 读回采用（值 + 快照 + 清单 + 「使用中」标记）
}

/** 单独安排一次落盘（"恢复默认"那种直接改 selection 后调用）。 */
function persistFontSet() {
  fontSetWrites++;
  scheduleFontSet();
}

function onPageHideFlushFontSet() {
  if (fontSetTimer && typeof window.clearTimeout === "function") {
    window.clearTimeout(fontSetTimer);
    flushFontSet();
  }
}
function onVisibilityResyncFontSet() {
  if (!document.hidden && fontSetDirty && !fontSetTimer) scheduleFontSet();
}

/**
 * 启动加载（**原子**）：宿主 → 活动 id → 正文 → 一次 `Object.assign` 灌进 selection。
 * 失败时**不动任何字体值**（selection 保持"同步缓存那份" = 用户上次所见），
 * 并把**可判定原因**写进 `selection.fontSetError`（面板据此显示；绝不静默）。
 * @returns 是否拿到了宿主那份正文
 */
async function loadFontSet() {
  const writesAtStart = fontSetWrites;
  const before = JSON.stringify(pickFontValues());
  let values = null;
  let id = "";
  let why = "";
  try {
    const listRes = await fsJson(fontSetsUrl());
    const listData = (listRes.ok && !listRes.error && listRes.data) ? listRes.data : null;
    // 清单**顺手更新**：它就在手里。少了这一句，`loadFontSet()` 的调用方（新建 / 切换）之后
    // 列表还是旧的 —— 新那一行不出现、"使用中"的落点看着也不对，要刷新页面才好（真机报过）。
    if (listData && Array.isArray(listData.fontsets)) selection.fontSets = listData.fontsets;
    const active = listData ? listData.active : null;
    if (!listRes.ok || listRes.error) {
      why = fontSetFailureReason(listRes);
    } else if (!isFontSetId(active)) {
      why = weT("宿主没有活动字体集");
    } else {
      id = active;
      const oneRes = await fsJson(fontSetUrl(active));
      if (oneRes.ok && !oneRes.error && oneRes.data && oneRes.data.values) {
        values = sanitizeFontset(oneRes.data.values);
      } else {
        why = fontSetFailureReason(oneRes);
      }
    }
  } catch {
    why = weT("宿主不可达（请求未完成）");
  }

  if (values) {
    activeFontSetId = id;
    selection.fontSetActive = id; // 指针（= 宿主那边正在用的那份；能力判定用它）
    // 用户在 GET 在途时改过 ⇒ 他的值更新，别覆盖（但活动 id 必须记下：写目标要对）。
    if (fontSetWrites === writesAtStart) {
      // ⚠️ **回滚防线**（用户反馈"重启后保存的自定义颜色没了"）：上次会话的
      //    落盘可能没成功（宿主没重挂 / 退出太快 / 任何非 2xx）—— 脏标记随页面死了，
      //    但缓存里那份就是**用户屏幕上看到的最后状态**。宿主值 ≠ 缓存值且缓存带脏
      //    ⇒ 采纳缓存并立即补推，不让宿主的旧值把用户的编辑静默回滚。
      //    取舍：两个桌面端共用同一份数据目录时这是"本窗口最后所见者胜"，
      //    比"先写者胜"更贴近用户预期（另一个窗口的更新若被顶掉，重推后的差异
      //    依旧可见；两实例同时编辑字体的场景本就罕见）。缓存不带脏（正常关停）
      //    ⇒ 宿主为准。
      const cached = readCachedFontSet();
      const cachedNewer = Boolean(cached && cached.dirty && cached.id === id
        && canonicalFontValues(cached.values) !== canonicalFontValues(values));
      if (cachedNewer) {
        Object.assign(selection, cached.values);
        activeFontSetValues = canonicalFontValues(cached.values);
        scheduleFontSet(); // 补推：让宿主追上用户最后所见
      } else {
        Object.assign(selection, values); // 字体键一次写完 —— 这就是"整套采用"
        writeFontSetCache(id, values);
        activeFontSetValues = canonicalFontValues(values);
      }
    } else {
      // 快照 = 宿主那份（采用被在途编辑跳过时，selection ≠ 快照 ⇒ 正好判成"已改"）。
      activeFontSetValues = canonicalFontValues(values);
    }
    selection.fontSetError = "";
  } else {
    // 只拿到指针、没拿到正文：能力判定（活动集不可删）仍要准，但**不设快照** ⇒ 不判漂移。
    if (isFontSetId(id)) { activeFontSetId = id; selection.fontSetActive = id; }
    selection.fontSetError = why || weT("字体集不可用");
  }
  if (values && JSON.stringify(pickFontValues()) !== before) applyEffects();
  emit();
  return Boolean(values);
}

/**
 * 读宿主那边的**字体集清单**（面板的"有哪些集、哪个是活动的、谁覆盖了随包那份"全靠它）。
 * 结果落进 `selection.fontSets`（瞬态：不落盘，来源永远是宿主）。
 * 失败写 `selection.fontSetError`（可判定文案），清单保持上一次的 —— 不静默清空。
 */
async function refreshFontSets() {
  try {
    const res = await fsJson(fontSetsUrl());
    if (!res.ok || res.error) {
      selection.fontSetError = fontSetFailureReason(res);
      return false;
    }
    const data = res.data || {};
    selection.fontSets = Array.isArray(data.fontsets) ? data.fontsets : [];
    if (isFontSetId(data.active)) activeFontSetId = data.active;
    selection.fontSetActive = isFontSetId(data.active) ? data.active : "";
    selection.fontSetError = "";
    return true;
  } catch {
    selection.fontSetError = weT("宿主不可达（请求未完成）");
    return false;
  }
}

/** 一份值的**规范化**形态（比对"有没有被改过"必须过同一套消毒 + 同一份键序）。 */
function canonicalFontValues(values) {
  return JSON.stringify(sanitizeFontset(values || {}));
}

/**
 * 当前字体值是否已经**偏离**上次采纳的那一份（= 面板里"使用中"该不该亮）。
 * 没采纳过（快照空）时返回 false —— 宁可不标，也不谎报"已改"。
 */
function fontSetDrifted() {
  return activeFontSetValues !== "" && canonicalFontValues(pickFontValues()) !== activeFontSetValues;
}

/**
 * 切换活动集（人工切换的**唯一**写原语；宿主那边也只认这一条）。
 * 挪完指针要**把它那份值读回来采用** —— 否则界面上什么都不会变（得等下次启动才生效）。
 */
async function activateFontSet(id) {
  if (!isFontSetId(id)) return false;
  try {
    const res = await fsFetch(fontSetUrl(id) + "/activate", { method: "POST" });
    if (!res.ok) { selection.fontSetError = fontSetFailureReason(res); return false; }
    activeFontSetId = id;
    selection.fontSetActive = id;
    selection.fontSetError = "";
    await loadFontSet(); // 读回这一份的值并采用（值 + 快照 + **清单** + 「使用中」标记都在它里面）
    return true;
  } catch {
    selection.fontSetError = weT("宿主不可达（请求未完成）");
    return false;
  }
}

/** 新集 id：单段白名单内、按时间戳递增（宿主那边只做形状校验，唯一性由这里保证）。 */
function newFontSetId() {
  return "set-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

/**
 * 以**当前字体值**新建一份集（面板的「新建」与「另存为」是同一件事：
 * 差异只在措辞 —— 两个按钮做同一个动作会让"改哪个才生效"再次变成要读两处的问题）。
 * 新建后**切过去**：用户的下一步一定是调它。
 */
async function createFontSet(name) {
  const id = newFontSetId();
  const values = pickFontValues();
  try {
    const res = await fsFetch(fontSetUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: typeof name === "string" && name.trim() ? name.trim() : id, values }),
    });
    if (!res.ok) { selection.fontSetError = fontSetFailureReason(res); return ""; }
    await activateFontSet(id); // 里面会 loadFontSet：新集的快照 = 当前值 ⇒ 立刻是「使用中」
    return id;
  } catch {
    selection.fontSetError = weT("宿主不可达（请求未完成）");
    return "";
  }
}

/** 重命名：先读回那一份的**值**（非活动集的值不在本地），再整份写回新名字。 */
async function renameFontSet(id, name) {
  if (!isFontSetId(id) || typeof name !== "string" || !name.trim()) return false;
  try {
    const one = await fsJson(fontSetUrl(id));
    if (!one.ok || !one.data) { selection.fontSetError = fontSetFailureReason(one); return false; }
    const res = await fsFetch(fontSetUrl(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), values: one.data.values }),
    });
    if (!res.ok) { selection.fontSetError = fontSetFailureReason(res); return false; }
    selection.fontSetError = "";
    await refreshFontSets();
    return true;
  } catch {
    selection.fontSetError = weT("宿主不可达（请求未完成）");
    return false;
  }
}

/**
 * 删掉**用户层**的那一份。对"覆盖了随包预设"的行，这个动作的语义就是**「恢复随包原样」**
 * （宿主删掉覆盖后随包那份重新可见）—— 所以只有一个入口，标签由面板按 `origin`/`overrides` 决定。
 * 活动集宿主会拒（400）：先切走。
 */
async function deleteFontSet(id) {
  if (!isFontSetId(id)) return false;
  try {
    const res = await fsFetch(fontSetUrl(id), { method: "DELETE" });
    if (!res.ok) { selection.fontSetError = fontSetFailureReason(res); return false; }
    selection.fontSetError = "";
    await refreshFontSets();
    return true;
  } catch {
    selection.fontSetError = weT("宿主不可达（请求未完成）");
    return false;
  }
}

/** 导出入口：**普通链接**（宿主带 `Content-Disposition: attachment` 应答）—— 不引入 blob。 */
function exportFontSetUrl(id) {
  return isFontSetId(id) ? fontSetUrl(id) + "/export" : "";
}

/**
 * 读一个 File 的文本。`file.text()` 是 Blob 的标准方法（Chromium/Electron 都有）；
 * 旧的 / 替身形态退回到 FileReader —— 两条都失败才报错（失败要**可判定**，不许静默）。
 */
function readFileText(file) {
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

/**
 * 导入一份字体集文件。三道**本地**预检各给一句可判定文案，再交给宿主做权威校验
 * （宿主那边还会查 `$schema` 与形状，并按占用情况分配新 id）：
 *   ① 文件读不出来 ⇒ "读不出这个文件"；② 不是 JSON ⇒ 点明；③ `$schema` 不对 ⇒ 点明**要哪个标记**
 *   （这条最关键：用户可能拖进来任意 .json，笼统说"导入失败"等于什么都没说）。
 * 成功 = 回读清单（新那一行就是反馈）；**不自动切换**（"导入"不等于"立刻用"）。
 * @returns 新的 id（失败给空串）
 */
async function importFontSet(file) {
  selection.fontSetError = "";
  let text;
  try {
    text = await readFileText(file);
  } catch {
    selection.fontSetError = weT("读不出这个文件（换一个 .json 再试）");
    return "";
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    selection.fontSetError = weT("这不是 JSON 文件（字体集是导出出来的 .json）");
    return "";
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.$schema !== FONTSET_SCHEMA_TAG) {
    selection.fontSetError = weT("这不是字体集文件（需要 {tag} 标记 —— 只有从「导出」拿到的文件才有）", { tag: FONTSET_SCHEMA_TAG });
    return "";
  }
  try {
    const res = await fsFetch(fontSetsUrl() + "/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
      // `parse: 'always'`：非 2xx 时也要读到宿主给的原因（否则只能报一个状态码）。
      parse: "always",
    });
    if (!res.ok) {
      selection.fontSetError = fontSetFailureReason(res);
      return "";
    }
    const data = res.data || {};
    selection.fontSetError = "";
    await refreshFontSets();
    return typeof data.id === "string" ? data.id : "";
  } catch {
    selection.fontSetError = weT("宿主不可达（请求未完成）");
    return "";
  }
}

/** 撤销挂起的写（面板里"新建/切换"之前先把当前值落地，免得新集拿到旧值）。 */
async function flushFontSetNow() {
  if (fontSetTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(fontSetTimer);
  }
  fontSetTimer = null;
  cacheFontValues();
  await pushFontSet();
}

/**
 * 取消挂起的 debounce 写入（卸载路径调用）。与 `cancelPendingPersist` 同理：
 * 模块级 timer 不属于 fiber，不清掉的话 200ms 后仍会对已卸载的插件写一次。
 */
function cancelPendingFontSet() {
  if (fontSetTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(fontSetTimer);
  }
  fontSetTimer = null;
}

export {
  fontValueDefaults, readCachedFontSetValues, loadFontSet, setFontValues, persistFontSet,
  onPageHideFlushFontSet, onVisibilityResyncFontSet, cancelPendingFontSet,
  landPresetFontSet,
  refreshFontSets, activateFontSet, createFontSet, renameFontSet, deleteFontSet,
  exportFontSetUrl, importFontSet, flushFontSetNow, fontSetDrifted,
};
