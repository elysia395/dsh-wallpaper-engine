/**
 * star-count.js — 仓库 star 数（关于页签那行），从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：本文件正文与拆前 src/client.js 的 1907–2013 行逐字节相同。
 *   3) 顶层状态只有字面量（若有）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ── 仓库 star 数（「关于」页签那行「⭐ 当前 N star」）────────────────────────────
// 数据由宿主代取（packages/about-notice/lib/routes/github-stars.js：只读一条腿、10 分钟 TTL、落盘缓存兜底、
// 失败静默），客户端只管"什么时候问一次"与"怎么显示"。**不是设置**：不进 selection、
// 不落盘 —— 换机器 / 清缓存都只是重新取一次，没有需要持久化的用户意图。
// 与宿主同一量级的 TTL：避免每次重渲染、每次切页签都打一次网络（GitHub 未认证限流
// 60 次/小时 **整机共享**）。失败不写 at ⇒ 下次切到关于页立刻重试（失败不该被冷却）。
const STAR_COUNT_TTL = 10 * 60 * 1000;
let starCount = { value: null, at: 0, busy: false, tried: false, stale: false, fetchedAt: 0 };
function loadStarCount(force) {
  if (starCount.busy) return;
  if (!force && starCount.tried && Date.now() - starCount.at < STAR_COUNT_TTL) return;
  starCount = { value: starCount.value, at: starCount.at, busy: true, tried: true };
  apiJson("/star-count")
    .then((res) => {
      const d = res && res.data;
      const n = d && d.ok && Number.isFinite(d.count) ? d.count : null;
      // 冷却用**本地**时间戳（不是宿主的 fetchedAt）：宿主的缓存可能本身就是上一次的
      // 旧值（离线兜底那条腿），拿它当年龄会让客户端每次切页签都去问一次 —— 冷却的意义
      // 是"别重复问"，数据到底多旧由宿主那一层的 TTL 负责。
      // 但"多旧"必须**显示**出来：宿主的 stale 分支回的就是上一次取到的值（断网 / 证书
      // 拦截时会一直回它），客户端不标日期的话，几十天前的数会和实时数长得一模一样。
      starCount = {
        value: n, at: n == null ? 0 : Date.now(), busy: false, tried: true,
        stale: Boolean(d && d.ok && d.stale),
        fetchedAt: d && Number.isFinite(d.fetchedAt) ? d.fetchedAt : 0,
      };
      emit();
    })
    .catch(() => {
      starCount = { value: null, at: 0, busy: false, tried: true };
      emit();
    });
}
// 那行字的唯一出处（渲染器直接读它 —— 与 SliderRow 一类模块级助手同口径）。
// 三种态各有明确文案：还没问过 ⇒ 空串（不占位）、正在问 ⇒ 说明在取、取不到 ⇒ 如实说。
// 第四种是"有值但陈旧"（宿主 stale 分支）：**必须带取数日期**，否则断网时它会冒充实时数。
/** 宿主 fetchedAt → 本地 `YYYY-MM-DD`；非法就给空串（宁可退回普通文案，也不显示 NaN）。 */
function starCountFetchedDate() {
  const t = Number(starCount.fetchedAt);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
/** 陈旧值**且能说出取数日期**时才返回日期：说不清多旧的旧值不许冒充实时数。 */
function starCountStaleDate() {
  return starCount.stale && starCount.value != null ? starCountFetchedDate() : "";
}
function starCountLabel() {
  if (starCount.busy && starCount.value == null) return weT("⭐ 正在获取 star 数…");
  if (starCount.value != null) {
    const count = Number(starCount.value).toLocaleString("en-US");
    const date = starCountStaleDate();
    if (date) return weT("⭐ 当前 {count} star（{date} 取到）", { count, date });
    // 陈旧但拿不到时间戳 ⇒ 按"取不到"处理（否则它和实时数长得一模一样，正是这次事故的形态）。
    if (starCount.stale) return weT("⭐ 暂时取不到 star 数");
    return weT("⭐ 当前 {count} star", { count });
  }
  if (starCount.tried) return weT("⭐ 暂时取不到 star 数");
  return "";
}
// 数字那行的 tooltip（渲染器同样只读模块级助手）：陈旧时把"没连上"说清楚，
// 别让「实时数据」四个字挂在一个几十天前的值上。
function starCountTitle() {
  if (starCountStaleDate()) {
    return weT("这次没能连上 GitHub，显示的是上一次取到的一次值（不是实时数）");
  }
  return weT("来自 GitHub API 的实时数据（带缓存；拉不到时显示上一次取到的值）");
}

// 滑杆右侧那格「数值区」的可输入形态（SliderRow 的 opts.numberEdit 用它）。
//
// 为什么单独一个组件、并且**编辑期不受控**：受控写法（value 由设置渲染、每敲一键就写设置）
// 在"删空重打"这一路会自锁 —— 退格把框清成空串，空串不是合法值 ⇒ 不写设置 ⇒ React 又把旧值
// 渲回去，用户看到的是"数字删不掉"（实测反馈原话：「我在输入框里不能删除已有数字」）。所以：
//   · 未编辑（聚焦前）：value = 设置值，跟着滑杆拖动 / 别处改动同步显示；
//   · 编辑中：自己管自己（defaultValue + 本地 draft），**空串也是合法中间态**，随便删；
//   · 回车 / 失焦：夹取到 [min, max] 后交给同一个处理器（第二参 false = 完整路径），并收起
//     draft 回到受控 —— 值真被拒（越界回落默认）时也能立刻看到真实值。
// draft 只在编辑期覆盖显示，"删空 + 回车"于是回落设置值，而不是把 0 写进去。
function NumberValueInput(props) {
  const { label, min, max, step, unit, value, onCommit, title } = props;
  const [draft, setDraft] = React.useState(null);
  const editing = draft !== null;
  const commit = (raw) => {
    setDraft(null);
    const s = String(raw == null ? "" : raw).trim();
    if (s === "") return;                       // 空 = 放弃这次编辑，保留原值
    const n = Number(s);
    if (!Number.isFinite(n)) return;
    onCommit(Math.max(Number(min), Math.min(Number(max), n)));
  };
  return React.createElement("input", {
    className: "we-picker__value-input", type: "number",
    min: String(min), max: String(max), step: String(step),
    title: title || undefined,
    "aria-label": label + " " + unit,
    ...(editing ? { defaultValue: draft } : { value: String(value) }),
    onFocus: () => { if (!editing) setDraft(String(value)); },
    onInput: (e) => setDraft(e.currentTarget.value),
    onBlur: (e) => commit(e.currentTarget.value),
    onKeyDown: (e) => {
      if (e.key === "Enter") { commit(e.currentTarget.value); e.currentTarget.blur(); }
    },
  });
}
