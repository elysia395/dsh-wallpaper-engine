/**
 * theme-follow.js — 主题随壁纸：**默认关**（`selection.themeFollow`，真源见
 * lib/settings-schema.js）；开着时每换一张壁纸就决定全局深/浅。
 *
 * 开关**关**着时本模块整体不生效：不评估、不判决、不写主题、不留痕 —— 等价于这个功能不存在。
 * 关的那一刻还会把上一轮留下的**让位标记 / 合议排名 / 面板状态行**清掉：它们是"本张壁纸"的
 * 跨评估状态，留着会让用户把开关关掉再打开之后，同一张壁纸静默不生效（排名挡住迟到的取色
 * 结果、让位压住写入）。**不回滚已经写下的主题** —— 关的语义是"不再自动改"，而回滚本身就是
 * 一次主题写入（与"关时零写入"直接冲突）。
 *
 * 开着时的规则（按优先级取一个颜色，再看它的相对亮度）：
 *   ① 壁纸自己声明的配色：`project.json` 的 `schemecolor.value`（宿主 inventory 的
 *      `schemeColor`，已是 `rgb(r, g, b)`）。**用户在「壁纸属性」面板改过的覆盖值优先**
 *      —— 面板改的就是"这张壁纸该用什么配色"，与作者值同源同义。
 *      ⚠️ **恰好 `0 0 0` 的作者值视作"没填"**（退回 ②）：WE 新建工程的 schemecolor 默认
 *      值就是纯黑，实测本机 360 张里有 124 张（34%）是它 —— 照用会把三分之一壁纸（含很亮的）
 *      一律钉成深色。**面板里的覆盖值不受这条影响**：那是用户显式填的，照用（含纯黑）。
 *   ② 画面占比最大色：把画面缩到 64×64、按 4 bit/通道量化后取众数桶
 *      （同一条下采样先例见 src/live-layer.js 的 liveFrameLooksUsable）。只在 ① 缺席
 *      时才跑，所以绝大多数壁纸不付这份成本。
 *      这条腿有**两个来源**：作者的 preview 图（随时可得）与**真实渲染帧**（场景在抓帧
 *      那一刻顺手取色 / 网页用 __wp.capture）。两者结论不一致时**取深色** —— 只有两条腿
 *      都说是浅色才用浅色。理由：抓帧可能落在画面尚未稳定的时刻（实测一张暗色壁纸因此在
 *      首帧后 2.5 秒被抓到偏亮的一帧），而"该深却给了浅色"是肉眼最容易看见的错。
 *   ③ 两条都拿不到 ⇒ **什么都不做**（保持当前主题，不抖）。
 *
 * 亮度判定用 WCAG 相对亮度（与 test/verify-readability.mjs 同一套系数）。阈值是**明显偏亮**
 * 那一档 —— 真源是下面的常量 `THEME_FOLLOW_LIGHT_ABOVE`（其上方注释写了为什么不取中灰）：
 * 亮过它 ⇒ 浅色主题，否则深色主题。**本文件头不复述那个数值**：同一份文档里出现两处
 * 阈值、只改一处，会让这条判据与实现互相矛盾。
 *
 * 写入经宿主的客户端 Cordis 服务 `theme`（`setTheme('dark'|'light')`，官方端与社区端
 * 同一套 API）。三条自我约束：
 *   · **只在结论与当前偏好不同时写**：`setTheme` 会把偏好落进 profile 的
 *     `cordis.patch.yml`，轮换列表如果混着亮暗两派壁纸，不去重就是每次切换写一次盘。
 *   · **用户一动手就让位**：`theme/change` 若来自我们之外（偏好不等于我们最后写进去的
 *     那个值），本张壁纸不再插手，换下一张壁纸时恢复自动。
 *   · **服务缺席就什么都不做**：不声明 `inject: ["theme"]`（缺服务时声明式依赖会让插件
 *     park，见 src/client.js 主题层那段），拿不到服务时本模块整体不生效，绝不抛。
 *
 * 契约：
 *   · 需要的外界（都只在函数体内读）：`selection`（含总开关 `selection.themeFollow`）/
 *     `propTokenOf()` / `storedUserPropsOf()` / `reportClientDiag()` / `setTransient()` ← src/client.js；
 *     `theme` 服务与 `ctx` 由 attach 传入；浏览器全局（document / Image / canvas）带 typeof 守卫。
 *   · 对外提供：`themeFollowAttach(theme, ctx)`（服务就绪时接上并补评一次）、
 *     `themeFollowOnWallpaper(sel)`（换壁纸后评估）、以及若干纯函数供守卫直测。
 *     开关门（`themeFollowEnabled()`）在**每个**决策/写入口的最前面：关时那些入口一律空转。
 */

// 浅色门槛：只有**明显偏亮**的颜色才配浅色界面。这里不取中灰（0.2159）—— 实测本机库
// 作者配色的亮度中位数是 0.214，中灰阈值正好切在分布最密处（±0.05 内 27 张），于是饱和
// 中间调会被判浅而人眼看是深的（`#00918A` 的 WCAG 亮度 0.2209，只超中灰 0.005）。
// 0.40 对应约 `#AAA` 的中亮灰，语义是"亮到这个程度，浅色界面才好看"。
const THEME_FOLLOW_LIGHT_ABOVE = 0.40;
// 画面取样的边长（64×64 = 4096 px，够稳又几乎不要钱；与 live-frame 内容判据同一档）。
const THEME_FOLLOW_SAMPLE_PX = 64;

// ── 状态（模块级；一组相互独立的标记，谁都不会被别的改动带跑）──────────────────
let themeFollowService = null;   // theme 服务句柄（拿到才接上）
let themeFollowUnsub = null;     // theme/change 订阅解绑
let themeFollowWritten = "";     // 我们最后写进去的偏好（'' = 没写过）
let themeFollowYield = false;    // 本张壁纸让位（别人改过主题）
let themeFollowWallpaperId = ""; // 让位标记与排名状态的归属：只有 id 真的换了才复位
let themeFollowSeq = 0;          // 评估代次：换壁纸即作废进行中的画面取色
// 我方**改主题之前**的偏好值（"" = 还没有改过 / 已放回）。壁纸退场（清空 / 让路给皮肤）
// 时把它原样放回 —— "我们改的环境要退干净"这条与壁纸层 / 玻璃整族同级；而"别人改过就不碰"
// 的判据见 themeFollowRelease（让位标记 + 现值比对双重门）。
let themeFollowBefore = "";
// 图源结果按来源分开记：预览图只是作者的宣传画，真实渲染帧才是"这张壁纸实际长什么样"，
// 但抓帧可能落在画面还没稳定的时刻。两者**不一致时取深色**（见文件头 ② 的理由），
// 只有都说是浅色才用浅色；作者配色在场时两者一律不参与。
let themeFollowRank = 0;             // 已采纳过的最高来源：0 无 · 1 预览图 · 2 真实渲染帧
let themeFollowPreviewVerdict = "";  // 预览图那条腿的结论（'' = 还没结果）
let themeFollowFrameVerdict = "";    // 真实帧那条腿的结论（'' = 还没结果）
let themeFollowSchemeProvided = false; // 本张壁纸有作者配色 ⇒ 图源结果一律不参与
let themeFollowLastLine = "";          // 最近一次判决的可读描述（面板状态行与诊断共用）

/**
 * 总开关：只有 `selection.themeFollow === true` 才算开（默认关 —— 见 lib/settings-schema.js
 * 的 DEFAULTS.themeFollow）。读不到 store（验证环境 / 启动早期）或字段缺失一律当**关**：
 * 这个功能的默认语义就是"不发生"。
 */
function themeFollowEnabled() {
  try {
    return typeof selection !== "undefined" && !!selection && selection.themeFollow === true;
  } catch { return false; }
}

/**
 * 皮肤在台上（`src/client.js` 的互操作块已让我方整族退场）：主题是退场清单的一员 ——
 * 让路态里一个字节都不写（含画面取色那两条异步腿）。try 防 TDZ：本模块可能先于
 * client 主体被求值。
 */
function themeFollowSkinYielded() {
  try { return typeof skinYieldActive === "function" && skinYieldActive() === true; } catch { return false; }
}

/**
 * 关掉开关时清掉本模块留下的状态（让位标记 / 合议排名 / 面板状态行）。
 * 为什么要清：这些是"本张壁纸"的跨评估状态 —— 留着它们，用户把开关从关拧到开之后，同一张
 * 壁纸上旧状态会静默挡住新的判决（排名挡住迟到的取色结果、让位压住写入），表现为"开了没反应"。
 * 只清内存与瞬态字段，**不动已经写下的主题**（回滚会变成一次写入，与"关时零写入"冲突）。
 */
function themeFollowClearState() {
  const hadLine = !!themeFollowLastLine;
  themeFollowYield = false;
  themeFollowRank = 0;
  themeFollowPreviewVerdict = "";
  themeFollowFrameVerdict = "";
  themeFollowSchemeProvided = false;
  themeFollowLastLine = "";
  if (hadLine) {
    try { setTransient("themeFollowLine", ""); } catch { /* 验证环境没有 store：只影响面板那一行 */ }
  }
}

/** sRGB 分量 (0–255) → 线性分量。 */
function themeFollowLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度（0–1）。入参是 [r,g,b]（0–255）。 */
function themeFollowLuminance(rgb) {
  return 0.2126 * themeFollowLinear(rgb[0]) + 0.7152 * themeFollowLinear(rgb[1]) + 0.0722 * themeFollowLinear(rgb[2]);
}

/**
 * 解析一个颜色字符串 → [r,g,b]（0–255 整数）；不认得的形状返回 null。
 * 支持三种来源的写法：宿主的 `rgb(r, g, b)`、CSS 的 `#rrggbb` / `#rgb`，
 * 以及 WE 属性面板的 0–1 浮点三元组 `"0.114 0.220 0.329"`。
 */
function themeFollowParseColor(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  let m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(Number(x)))));
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split("").map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)$/.exec(s);
  if (m) {
    const f = [m[1], m[2], m[3]].map(Number);
    if (f.some((x) => !Number.isFinite(x))) return null;
    // 浮点三元组：WE 用 0–1；> 1 就按已经是 0–255 处理（兼容手改过的工程文件）。
    const scale = f.every((x) => x <= 1) ? 255 : 1;
    return f.map((x) => Math.max(0, Math.min(255, Math.round(x * scale))));
  }
  return null;
}

/** 颜色 → 主题判决：'dark' / 'light'；拿不到颜色返回 ''（=不动）。 */
function themeFollowVerdict(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return "";
  return themeFollowLuminance(rgb) > THEME_FOLLOW_LIGHT_ABOVE ? "light" : "dark";
}

/**
 * 一个 RGBA 像素缓冲区里**占比最大的颜色桶中心**（纯函数，守卫直测）。
 * 4 bit/通道 = 4096 桶：足够把渐变与噪点吸进同一桶，又不至于把主色糊掉。
 * alpha < 128 的像素不参与（透明区域不是画面）。
 */
function themeFollowModeColorOf(px, w, h) {
  if (!px || !w || !h) return null;
  const bins = new Map();
  let counted = 0;
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    counted++;
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  if (!counted) return null;
  let bestKey = -1;
  let bestCount = -1;
  // 同票时取 key 小的（确定性输出：同一张图任何时候都得到同一个答案）。
  for (const [key, count] of bins) {
    if (count > bestCount || (count === bestCount && key < bestKey)) { bestCount = count; bestKey = key; }
  }
  const r = (bestKey >> 8) & 0xf;
  const g = (bestKey >> 4) & 0xf;
  const b = bestKey & 0xf;
  // 桶中心：把 4 bit 值映射回 0–255 的区间中点。
  return [r * 16 + 8, g * 16 + 8, b * 16 + 8];
}

/**
 * 取一张同源图片的占比最大色。失败（跨源污染 / 解码失败 / 无 canvas）一律 null。
 * 绝对 http(s) URL 走 `crossOrigin="anonymous"`：媒体源自带 `Access-Control-Allow-Origin: *`，
 * 这样画进 canvas 不会被污染。
 */
function themeFollowDominantColorOf(url) {
  return new Promise((resolve) => {
    const done = (v) => { try { resolve(v); } catch { /* ignore */ } };
    try {
      if (!url || typeof document === "undefined" || typeof Image === "undefined") return done(null);
      const img = new Image();
      if (/^https?:\/\//i.test(url)) img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = THEME_FOLLOW_SAMPLE_PX;
          canvas.height = THEME_FOLLOW_SAMPLE_PX;
          const g = canvas.getContext && canvas.getContext("2d");
          if (!g) return done(null);
          g.drawImage(img, 0, 0, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX);
          const data = g.getImageData(0, 0, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX).data;
          done(themeFollowModeColorOf(data, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX));
        } catch { done(null); }   // 污染 / 取像素被拒：当作拿不到色
      };
      img.onerror = () => done(null);
      img.src = url;
    } catch { done(null); }
  });
}

/** 当前偏好（'light' | 'dark' | 'system'；读不到返回 ''）。 */
function themeFollowCurrentPreference() {
  try {
    const snap = themeFollowService && themeFollowService.getTheme && themeFollowService.getTheme();
    const p = snap && snap.preference;
    return typeof p === "string" ? p : "";
  } catch { return ""; }
}

/**
 * 恰好 (0,0,0) —— WE 新建工程的 schemecolor 默认值。**只对作者值**用它判"没填"；
 * 面板覆盖值是用户显式填的，不受这条影响。
 */
function themeFollowIsUnfilledSchemeColor(rgb) {
  return Array.isArray(rgb) && rgb.length >= 3 && rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0;
}

/** 当前壁纸声明的配色：面板覆盖值优先，其次宿主给的作者值（纯黑作者值视作没填）。 */
function themeFollowSchemeColorOf(sel) {
  try {
    const token = typeof propTokenOf === "function" ? propTokenOf(sel) : "";
    if (token && typeof storedUserPropsOf === "function") {
      const over = storedUserPropsOf(token);
      const fromPanel = over && over.schemecolor;
      const parsed = themeFollowParseColor(fromPanel);
      if (parsed) return parsed;   // 面板里填的照用（含纯黑：那是明确意图）
    }
  } catch { /* 覆盖值读不到就退回作者值 */ }
  const author = themeFollowParseColor(sel && sel.schemeColor);
  return themeFollowIsUnfilledSchemeColor(author) ? null : author;
}

/** 画面取色的图源：预览图优先，其次场景静态帧（两者都同源）。 */
function themeFollowImageUrlOf(sel) {
  const s = sel || {};
  return String(s.previewUrl || s.sceneFrameUrl || "");
}

/**
 * 写入口。`verdict` 为空 / 与当前偏好相同 ⇒ 不写（去重，避免每次切换都改 profile 文件）。
 * 皮肤让路态同样不写（`themeFollowSkinYielded`）—— 皮肤在台上时主题归皮肤。
 */
function themeFollowApply(verdict) {
  if (!themeFollowEnabled()) return;
  if (!verdict || !themeFollowService || themeFollowYield || themeFollowSkinYielded()) return;
  const current = themeFollowCurrentPreference();
  if (current === verdict) {
    themeFollowWritten = verdict;
    themeFollowTrace(weT("保持 {verdict}（已是这个偏好，不重复写）", { verdict }));
    return;
  }
  // 第一次真正改动之前记下"原来的样子"：退场放回（themeFollowRelease）只放这一份。
  if (!themeFollowBefore && current) themeFollowBefore = current;
  try {
    themeFollowWritten = verdict;   // 先记再写：自己的写入不该被当成"别人改的"
    themeFollowService.setTheme(verdict);
    themeFollowTrace(weT("切换为 {verdict}", { verdict }));
  } catch { /* 服务拒绝（版本漂移）：保持原样，不抛 */ }
}

/** 决策留痕：面板状态行 + 诊断通道（排查"为什么判成浅色"时先看这里）。 */
function themeFollowTrace(action) {
  try { reportClientDiag("theme-follow", action + "｜" + (themeFollowLastLine || weT("无取色结果"))); }
  catch { /* 诊断是增强：失败不影响主题 */ }
  // 状态行走**瞬态字段**（与 gpuFrameUi 一类同路）：不落盘、不需要跨模块调用，
  // 面板从 ctx 的 sel 上读。面板渲染在验证环境里也能跑（不需要本模块在场）。
  try { setTransient("themeFollowLine", themeFollowLastLine ? weT("{line}｜{action}", { line: themeFollowLastLine, action }) : action); }
  catch { /* 没有 store（验证环境）：只影响面板那一行 */ }
}

/**
 * 换壁纸后的评估入口（src/media-prep.js 的 applySelection 调）。
 * 第一段同步走作者配色；拿不到色、且有图可采样时才进第二段异步取画面主色（排名 1）。
 * 真实渲染帧的更高质量结果由 themeFollowOnFrameCanvas / themeFollowOnFrameImage 补上（排名 2）。
 *
 * `opts.fromSkinRestore`：这次应用是**皮肤退场后的放回**（src/client.js 的 exitSkinYield）。
 * 它唯一的作用是**不复位让位标记** —— 皮肤在台期间用户改过主题的话，那次切换必须活过
 * 这次放回（"切换过主题不硬覆盖回去"）；没改过则标记本来就是 false，行为与普通换壁纸一致。
 */
function themeFollowOnWallpaper(sel, opts) {
  // 开关关：不评估、不写主题，顺手清掉上一轮留下的状态（见 themeFollowClearState）。
  if (!themeFollowEnabled()) return themeFollowClearState();
  if (themeFollowSkinYielded()) return;   // 皮肤在台上：主题同样让路（放回那次已先退出让路）
  if (!themeFollowService) return;
  // 让位标记与排名只随**壁纸 id 变化**复位：同一张壁纸可能被重复评估（重挂 / 重校验 /
  // 设置变动），那种情况下若也复位，就等于在用户刚手动改完主题后立刻抢回来。
  const id = String((sel && sel.id) || "");
  if (id !== themeFollowWallpaperId) {
    themeFollowWallpaperId = id;
    if (!(opts && opts.fromSkinRestore)) {
      themeFollowYield = false;
      themeFollowRank = 0;
    }
  }
  const seq = ++themeFollowSeq;
  themeFollowPreviewVerdict = "";
  themeFollowFrameVerdict = "";
  themeFollowLastLine = "";
  const scheme = themeFollowSchemeColorOf(sel);
  if (scheme) {
    themeFollowSchemeProvided = true;           // 作者说了就用作者：图源结果一律不参与
    const verdict = themeFollowVerdict(scheme);
    themeFollowLastLine = themeFollowDescribe(weT("作者配色"), scheme, verdict);
    themeFollowApply(verdict);
    themeFollowTrace(weT(themeFollowCurrentPreference() === verdict ? "已生效" : "等待取色"));
    return;
  }
  themeFollowSchemeProvided = false;
  const url = themeFollowImageUrlOf(sel);
  if (!url) return;                  // 两条都拿不到：保持当前主题
  themeFollowDominantColorOf(url).then((rgb) => {
    if (seq !== themeFollowSeq) return;   // 期间又换过壁纸：这次结果作废
    themeFollowAcceptImageVerdict(rgb, 1);
  });
}

/**
 * 壁纸退场（清空 / 让路给皮肤）⇒ 主题放回。两条自我约束，缺一条都算"抢"：
 *   · **只放我方改过的那一份**：`themeFollowBefore` 为空（我们没动过主题，或已放过）⇒ 空转；
 *     关掉开关时也空转 —— "关时零写入"是既有的对外契约（见 themeFollowClearState）。
 *   · **别人接管过就不碰**：让位标记在场（有人改过主题），或现值已经不等于我们最后写进去的
 *     值（改动发生在我们视野之外）⇒ 空转。放回是对**自己那次改动**的撤销，不是把主题
 *     "翻回去" —— 用户 / 别处的切换永远优先（"切换过主题不硬覆盖回去"）。
 * 调用点：applySelection 的清空路径（清除按钮与皮肤让路都汇到那里）。
 */
function themeFollowRelease() {
  if (!themeFollowEnabled()) return;
  if (!themeFollowService) return;
  if (themeFollowYield) return;
  if (!themeFollowBefore) return;
  const current = themeFollowCurrentPreference();
  if (current && current !== themeFollowWritten) return;
  const back = themeFollowBefore;
  themeFollowBefore = "";
  // ⚠️ 与 themeFollowApply 同一条纪律：**先记再写**。放回自己也会触发一次 theme/change，
  // 不先记账的话那次回调会把"现值 ≠ 我们写的值"读成"别人接管了"，给下一张壁纸挂上
  // 永久的让位标记（放回把主题还了，却把自己锁死在让位态）。
  themeFollowWritten = back;
  try {
    themeFollowService.setTheme(back);
    themeFollowTrace(weT("放回 {verdict}（随壁纸退场归还）", { verdict: back }));
  } catch { /* 服务拒绝（版本漂移）：现值保持原样，不抛 */ }
}

/**
 * 两条腿的合议：都说是浅色才用浅色；只要有一条说是深色（或只有一条有结论）就按那条走。
 * 不一致时偏向深色 —— "该深却给了浅色"是肉眼最容易看见的错，而抓帧有落在过渡态的风险。
 */
function themeFollowResolveImageVerdict() {
  const p = themeFollowPreviewVerdict;
  const f = themeFollowFrameVerdict;
  if (!p) return f;
  if (!f) return p;
  return (p === "light" && f === "light") ? "light" : "dark";
}

/**
 * 采纳一个**图源**结果（预览图 rank 1 / 真实渲染帧 rank 2）。四条闸：作者配色在场时
 * 一律不参与；已有同质或更好的来源时不重复；壁纸已切走时不认；单条腿的结论本身为空时不参与。
 * 结论经合议后写入口（同判决不重复写）。导出是为了让守卫能直接打这张表（本模块其余入口
 * 都需要浏览器全局）。
 */
function themeFollowAcceptImageVerdict(rgb, rank) {
  if (!themeFollowEnabled()) return;
  if (!themeFollowService || themeFollowYield || themeFollowSkinYielded()) return;
  if (themeFollowSchemeProvided) return;
  if (themeFollowWallpaperId !== String((typeof selection !== "undefined" && selection && selection.id) || "")) return;
  if (rank <= themeFollowRank) return;
  const verdict = themeFollowVerdict(rgb);
  if (!verdict) return;
  if (rank >= 2) themeFollowFrameVerdict = verdict; else themeFollowPreviewVerdict = verdict;
  themeFollowRank = rank;
  const resolved = themeFollowResolveImageVerdict();
  themeFollowLastLine = themeFollowDescribe(weT(rank >= 2 ? "帧" : "预览"), rgb, verdict)
    + (themeFollowPreviewVerdict && themeFollowFrameVerdict && themeFollowPreviewVerdict !== themeFollowFrameVerdict
      ? weT("｜两条腿不一致 ⇒ 取深色") : "");
  themeFollowApply(resolved);
}

/** 一句可读的判决描述（面板状态行 + 诊断留痕共用；不参与任何判定）。 */
function themeFollowDescribe(source, rgb, verdict) {
  const L = Array.isArray(rgb) ? themeFollowLuminance(rgb) : -1;
  const label = weT(verdict === "light" ? "浅色" : "深色");
  return L >= 0
    ? weT("{label} · 来源：{source}（亮度 {lum}）", { label, source, lum: L.toFixed(3) })
    : weT("{label} · 来源：{source}", { label, source });
}

/**
 * 真实渲染帧（场景实时渲染的画布）→ 判决。抓帧路径本来就要把画布降采样到 64×64 做
 * 内容门禁，这里用同一档精度再取一次占比最大色，代价可以忽略。**排名 2**：会盖过先前
 * 用作者预览图得到的结论。
 */
function themeFollowOnFrameCanvas(canvas) {
  if (!themeFollowEnabled()) return;   // 关时不取像素（连这份成本都不付）
  if (themeFollowSkinYielded()) return;   // 让路态：主题归皮肤，取色结果无处可去
  try {
    if (!canvas || typeof document === "undefined") return;
    const probe = document.createElement("canvas");
    probe.width = THEME_FOLLOW_SAMPLE_PX;
    probe.height = THEME_FOLLOW_SAMPLE_PX;
    const g = probe.getContext && probe.getContext("2d");
    if (!g) return;
    g.drawImage(canvas, 0, 0, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX);
    const px = g.getImageData(0, 0, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX).data;
    themeFollowAcceptImageVerdict(themeFollowModeColorOf(px, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX), 2);
  } catch { /* 取像素被拒（跨源/无 2d）⇒ 保持预览图那一档 */ }
}

/** 真实渲染帧（网页壁纸 `__wp.capture` 的 data URL）→ 判决。同样排名 2。 */
function themeFollowOnFrameImage(url) {
  if (!themeFollowEnabled()) return;   // 同上：关时不发起解码
  if (themeFollowSkinYielded()) return;   // 让路态：同 canvas 腿（连解码都不发起）
  themeFollowDominantColorOf(url).then((rgb) => themeFollowAcceptImageVerdict(rgb, 2));
}

/**
 * 把主题偏好写成指定值（**预设携带深浅**用）。
 *
 * 与「主题随壁纸」共用同一个服务句柄，但**语义不同**：
 *   · 随壁纸：带让位标记、退场会放回、跟壁纸走；
 *   · 这里是**用户显式动作**（套用一份声明了深浅的预设）⇒ 不设让位、不放回。
 *
 * 不变量：
 *   · 服务没拿到（启动早期 / 低版本宿主）⇒ 返回 `false`，**不抛**：套用预设是一整批操作，
 *     主题这一腿失败不该把已经落好的设置段也回滚。
 *   · 已经是目标值 ⇒ 仍返回 `true`（"现在确实是这个主题"），但不重复写。
 *   · **不碰** `themeFollowWritten` / `themeFollowBefore`：那是随壁纸的让位记账，
 *     混用会让"退场放回"把用户刚套用的主题还回去。
 *
 * @param {"dark"|"light"} preference
 * @returns {boolean} 是否确认已生效（服务缺席 ⇒ false）
 */
function themeFollowApplyPreference(preference) {
  const pref = String(preference || "").trim();
  if (pref !== "dark" && pref !== "light") return false;
  if (!themeFollowService || typeof themeFollowService.setTheme !== "function") return false;
  try {
    if (themeFollowCurrentPreference() !== pref) themeFollowService.setTheme(pref);
    return true;
  } catch { return false; }
}

/**
 * 主题服务就绪时接上（src/client.js 的主题层 onReady 调，同一处轮询拿到的句柄）。
 * 订阅 `theme/change`：只要变化不是我们写的那次，就判定"用户/别的插件接管了"，
 * 本张壁纸不再插手 —— 不跟用户抢控制权。接上后立刻对当前壁纸补评一次
 *（服务通常晚于第一张壁纸就绪）。
 */
function themeFollowAttach(theme, ctx) {
  try {
    if (!theme || typeof theme.setTheme !== "function") return;
    themeFollowService = theme;
    if (!themeFollowUnsub && ctx && typeof ctx.on === "function") {
      themeFollowUnsub = ctx.on("theme/change", () => {
        if (!themeFollowEnabled()) return;
        const now = themeFollowCurrentPreference();
        if (now && now !== themeFollowWritten) themeFollowYield = true;
      });
    }
    if (typeof selection !== "undefined" && selection && selection.id) themeFollowOnWallpaper(selection);
  } catch { /* 主题随壁纸是增强：任何异常都不该影响壁纸主路径 */ }
}

export {
  THEME_FOLLOW_LIGHT_ABOVE, THEME_FOLLOW_SAMPLE_PX,
  themeFollowParseColor, themeFollowLuminance, themeFollowVerdict, themeFollowModeColorOf,
  themeFollowIsUnfilledSchemeColor, themeFollowSchemeColorOf, themeFollowOnWallpaper, themeFollowAttach,
  themeFollowAcceptImageVerdict, themeFollowOnFrameCanvas, themeFollowOnFrameImage, themeFollowRelease,
  themeFollowApplyPreference,
};
