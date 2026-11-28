/**
 * props-panel.js — 「壁纸属性」（WE 用户属性）的**状态与处理器**（从 `src/client.js` 按族搬出，函数体逐字未改）。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / emit / liveFrameEl / applyEffects 等自由名由正文与其
 *      它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 1857–2153 行逐字节相同
 *      （复核：git show <拆前提交>:src/client.js | sed -n '1857,2153p'，与本文件去掉本头注释后 diff）。
 *   3) 顶层状态只有字面量初始化（propsPanelOpen / propsState / USER_PROPS_COMMIT_MS /
 *      userPropsCommitTimer）：不读正文的 const、不挂监听 ⇒ 被内联到 bundle 顶部不会撞 TDZ。
 *   4) 面板标记不在本文件：仍在 src/picker/picker-props-panel.js，ctx 由正文在调用点就地组装。
 *   5) 时序住这里（180ms 去抖落盘、silent 拖动期不重渲染、换壁纸期间丢弃迟到回包）；
 *      src/client/media-frame.js 的 propsPanelSnapshot / renderUserPropsPanel 只读本文件的状态与函数。
 */

// ── 壁纸属性（WE 用户属性）──────────────────────────────────────────────────
// 「壁纸属性」按钮 → 面板：读 host `/props/<token>`（把 project.json 的
// general.properties 解析成 UI 描述），改动即时 `__wp.updateWebProps` 热更新到
// 正在跑的壁纸，并写进设置（`userProps`，按 token 存）—— 刷新/重启后网页壁纸由
// host 并进 HTML 种子、场景壁纸由 applyStoredUserProps 在就绪后回放。
//
// 条件求值器已抽到 src/core/we-cond.js（纯计算、零外界依赖；构建期由 build-client.mjs
// 内联回本作用域，因此下面的 weEvalCondition(...) 调用点无需改动，见该文件头的契约）。

// 面板状态：token 变了就重新拉一次（换壁纸/换目录）。
let propsPanelOpen = false;
let propsState = { token: "", loading: false, error: "", props: [], remote: false, we: null };

/** 打开发送（侧栏下钻的入口）：先落状态再拉定义 —— 判据是"该有属性了"。 */
function openUserPropsPanel() {
  propsPanelOpen = true;
  loadUserPropDefs(propTokenOf(selection), true);
  emit();
}

/** 收起：只翻开关（定义留着，下次开不必重拉）。 */
function closeUserPropsPanel() {
  propsPanelOpen = false;
  cancelUserPropsCommit(); // 面板关了：拖动期剩下的那次提交不再有意义
  emit();
}

/** 当前 live 渲染 iframe（属性热更新与心跳读的是同一个）。 */

/** token（propsUrl 末段；同时是设置里 userProps 的键）。 */
function propTokenOf(selLike) {
  const url = String((selLike && selLike.propsUrl) || "");
  const i = url.lastIndexOf("/");
  return i >= 0 ? url.slice(i + 1) : "";
}

function storedUserPropsOf(token) {
  const all = selection.userProps;
  const v = all && typeof all === "object" ? all[token] : null;
  return v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {};
}

/** 覆盖值写入设置（与默认值相同 = 删除该覆盖项）。 */
function saveUserProp(token, name, value, isDefault) {
  if (!token) return;
  const all = { ...(selection.userProps || {}) };
  const cur = { ...(all[token] || {}) };
  if (isDefault) delete cur[name];
  else cur[name] = value;
  if (Object.keys(cur).length) all[token] = cur;
  else delete all[token];
  setSetting("userProps", all);
}

/** 热更新到正在跑的壁纸（渲染页 __wp.updateWebProps → 场景对象脚本 / 网页 shim）。 */
function applyUserProps(wire) {
  const frame = liveFrameEl();
  if (!frame) return false;
  try {
    const wp = frame.contentWindow && frame.contentWindow.__wp;
    if (!wp || typeof wp.updateWebProps !== "function") return false;
    wp.updateWebProps(wire);
    return true;
  } catch {
    return false;
  }
}

function loadUserPropDefs(token, force) {
  if (!token) return;
  if (!force && (propsState.token === token && (propsState.props.length || propsState.loading))) return;
  const url = PROPS_URL + "/" + encodeURIComponent(token);
  propsState = { token, loading: true, error: "", props: propsState.token === token ? propsState.props : [], remote: true, we: propsState.token === token ? propsState.we : null };
  apiJson(url)
    .then((res) => {
      const d = res.data;
      // ⚠️ 这条 message 会被渲染进「壁纸属性」面板（见 picker-props-panel.js 的 error 分支），
      //    所以它是**面向用户**的文案，尽管包在 Error 里。裸中文字面量会被 i18n-scan 的
      //    Error 豁免放过 —— 用 weT 包住，改文案时才有词表口径可循。
      if (!d || !d.ok) throw new Error((d && d.error) || weT("读取失败"));
      if (propsState.token !== token) return; // 期间换了壁纸：丢弃
      // 值以渲染页的实时表为准（场景壁纸的默认值在 scene.json 快照里，可能和
      // project.json 不同 —— 上游 getProperties 正是为此存在）；拿不到就用宿主值。
      let live = null;
      try {
        const frame = liveFrameEl();
        const wp = frame && frame.contentWindow && frame.contentWindow.__wp;
        live = wp && typeof wp.getProperties === "function" ? wp.getProperties() : null;
      } catch { live = null; }
      const props = (d.props || []).map((p) => {
        if (!live || !(p.name in live)) return p;
        return { ...p, value: live[p.name], overridden: Boolean(d.overrides && p.name in d.overrides) };
      });
      // issue #341：宿主只读带出的 WE 当前值（`wproperties`）。它**不参与**默认值合并，
      // 只供面板「从 WE 导入」，所以这里单独存一份，进 UI 前剥掉宿主的绝对路径。
      const we = d.we && d.we.ok && d.we.values && typeof d.we.values === "object"
        ? { values: d.we.values, monitor: String(d.we.monitor || ""), profile: String(d.we.profile || "") }
        : null;
      propsState = { token, loading: false, error: "", props, remote: false, we };
      emit();
    })
    .catch((e) => {
      if (propsState.token !== token) return;
      propsState = { token, loading: false, error: String((e && e.message) || e), props: [], remote: false, we: null };
      emit();
    });
}

/**
 * 「壁纸属性」拖动期的提交窗口（毫秒）：最后一次 input 之后安静这么久，才算这次拖动结束。
 *
 * 为什么需要这个定时器：面板对 color / slider 只能送 silent 的 input（见
 * src/picker/picker-props-panel.js 的 renderUserPropRow）—— **React 的 onChange 对
 * `<input type="range">` / `<input type="color">` 是逐格触发的 input 事件**，不是原生
 * change 的"抬手"。把它当抬手（旧实现）等于拖动中每格 `emit()` 一次：emit 的订阅者里
 * 有全量 `applyEffects`（重建字体样式表 / 同步场景音频 / 强制同步样式计算）和整棵设置
 * 面板的重渲染 —— 原生颜色轮盘一次拖动上百格，正是用户报的「拖颜色时异常卡顿缓慢」
 * （与 commitLiveSetting 注释里那次用户实测同一条口径；场景/网页引擎侧的单次热更新
 * 实测只有 ~0.1ms，不是这里的量级）。
 *
 * 取值：180ms 比持久化写去抖（200ms）略短、又不与它同值 —— 两个窗口各管一件事（一个
 * 决定面板什么时候回显刷新，一个决定什么时候落盘），同值会让"只测其一"的守卫分不开它们。
 * 这是"拖动停下到回显跟上"的观感上限；改大没有收益，改小会让慢速拖动（每格间隔大于
 * 阈值）中途也各提交一次。
 */
const USER_PROPS_COMMIT_MS = 180;
let userPropsCommitTimer = null;
/** 取消挂起的拖动提交（面板关闭 / 恢复默认 / 卸载）。 */
function cancelUserPropsCommit() {
  if (userPropsCommitTimer !== null && typeof clearTimeout === "function") clearTimeout(userPropsCommitTimer);
  userPropsCommitTimer = null;
}
/**
 * 拖动期的尾部提交：连续 input 只留最后一次的定时器，到点才 `emit()` 一次。
 * 无定时器设施（验证环境）退化为立即 emit —— 与 persistSelection 同一条退化口径。
 */
function scheduleUserPropsCommit() {
  cancelUserPropsCommit();
  if (typeof setTimeout !== "function") { emit(); return; }
  userPropsCommitTimer = setTimeout(() => {
    userPropsCommitTimer = null;
    emit();
  }, USER_PROPS_COMMIT_MS);
}

/** 一次属性改动：本地状态 + 热更新 + 持久化（silent = 拖动中，不 emit，尾部提交一次）。 */
function onUserPropInput(def, value, silent) {
  // 同一格可能被上报两次（React 对 range/color 会同时派发 onInput 与 onChange 两路
  // 处理器，它们都是 silent 的）：值没变就没有热更新可做，也不该多安排一次提交。
  // 只对 silent 早退 —— 显式提交（失焦 / 回车 / 组合框）即使值没变也必须走完，否则
  // "把值选成当前显示值" 这种显式选择不会落进覆盖表（旧行为如此，别改）。
  if (silent && sameUserPropValue(value, def.value)) return;
  def.value = value;
  def.overridden = !sameUserPropValue(value, def.default);
  applyUserProps({ [def.name]: { value } });
  saveUserProp(propsState.token, def.name, value, !def.overridden);
  if (silent) scheduleUserPropsCommit();
  else { cancelUserPropsCommit(); emit(); }
}

function sameUserPropValue(a, b) {
  if (a === b) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return false;
}

/** 恢复默认：清掉这张壁纸的全部覆盖值，并把默认值热更新回渲染页。 */
function resetUserProps() {
  const token = propsState.token;
  if (!token) return;
  cancelUserPropsCommit(); // 拖动期的尾部提交已无意义（下面这次 emit 就是最后一次）
  const wire = {};
  for (const p of propsState.props) {
    p.value = p.default;
    p.overridden = false;
    if (p.default !== null) wire[p.name] = { value: p.default };
  }
  applyUserProps(wire);
  const all = { ...(selection.userProps || {}) };
  delete all[token];
  setSetting("userProps", all);
  emit();
}

/**
 * WE 当前值 → 面板值的类型归位（WE `config.json` 存在以字符串存布尔/数字的机器）。
 * 类型不对 ⇒ undefined（这项不导入，绝不把字符串塞进 slider）。
 */
function wePropValueOf(p, raw) {
  if (raw === null || raw === undefined) return undefined;
  if (p.ptype === "bool") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const s = raw.trim().toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
    }
    return undefined;
  }
  if (p.ptype === "slider") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (p.ptype === "color" || p.ptype === "file" || p.ptype === "directory" || p.ptype === "textinput" || p.ptype === "other") {
    return typeof raw === "string" ? raw : undefined;
  }
  return raw; // combo：保留声明类型（与 project.json 同一口径）
}

/** 「从 WE 导入」能带来的改动摘要（面板按钮的文案/可用态 + tooltip 用）。 */
function userPropsWeImport() {
  const we = propsState.we && propsState.we.values ? propsState.we.values : null;
  if (!we) return null;
  const labels = [];
  for (const p of propsState.props) {
    if (!p || p.hidden) continue;
    if (!Object.prototype.hasOwnProperty.call(we, p.name)) continue;
    const next = wePropValueOf(p, we[p.name]);
    if (next === undefined || sameUserPropValue(next, p.value)) continue;
    labels.push(p.text || p.name);
  }
  return { count: labels.length, labels };
}

/**
 * 从 WE 当前值导入（issue #341）：把与面板当前显示不同的值写成用户覆盖值。
 *
 * 只做用户**显式**动作（面板按钮）：不自动应用 —— WE `config.json` 是外部状态，静默
 * 覆盖会让"我在插件里调的值"凭空消失。导入后与手工改值同一条落盘路径
 * （`settings.userProps`），所以刷新/重启后仍然生效。
 */
function importUserPropsFromWe() {
  const token = propsState.token;
  const we = propsState.we && propsState.we.values ? propsState.we.values : null;
  if (!token || !we) return false;
  cancelUserPropsCommit();
  const wire = {};
  let changed = 0;
  for (const p of propsState.props) {
    // hidden（project.json 里 editable:false）与按钮统计同一口径：只读导入不碰它们 ——
    // 面板不显示这些项，写进去用户在界面上看不见、也没法单独撤销（只能整张恢复默认）。
    if (!p || p.hidden || typeof p.name !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(we, p.name)) continue;
    const next = wePropValueOf(p, we[p.name]);
    if (next === undefined || sameUserPropValue(next, p.value)) continue;
    p.value = next;
    p.overridden = !sameUserPropValue(next, p.default);
    wire[p.name] = { value: next };
    changed += 1;
  }
  if (changed === 0) { emit(); return false; }
  applyUserProps(wire);
  const all = { ...(selection.userProps || {}) };
  const cur = { ...(all[token] || {}) };
  for (const p of propsState.props) {
    if (!p || !Object.prototype.hasOwnProperty.call(wire, p.name)) continue;
    if (p.overridden) cur[p.name] = wire[p.name].value;
    else delete cur[p.name];
  }
  if (Object.keys(cur).length) all[token] = cur;
  else delete all[token];
  setSetting("userProps", all);
  emit();
  return true;
}

/** 就绪后回放覆盖值：网页壁纸由 host 并进 HTML 种子，场景壁纸没有种子通道。 */
function applyStoredUserProps(selLike) {
  if (!selLike) return;
  const token = propTokenOf(selLike);
  if (!token) return;
  const ov = storedUserPropsOf(token);
  const names = Object.keys(ov);
  if (!names.length) return;
  const wire = {};
  for (const [k, v] of Object.entries(ov)) wire[k] = { value: v };
  applyUserProps(wire);
}

/** Web 颜色 "r g b"（0–1 浮点）↔ #rrggbb */
function weColorToHex(v) {
  if (typeof v !== "string") return "#000000";
  const parts = v.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return "#000000";
  const hex = parts.slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0"))
    .join("");
  return "#" + hex;
}
function weHexToColor(hex) {
  const h = String(hex || "").replace(/^#/, "");
  if (h.length !== 6) return "0 0 0";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b].map((n) => Math.round(n * 1000) / 1000).join(" ");
}
