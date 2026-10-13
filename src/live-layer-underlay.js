/**
 * live-layer-underlay.js — **画布兜底色与可见性恢复**域。
 *
 * 纯搬移：下列声明与函数体逐字未改，只换了声明住哪。构建期由 scripts/build-client.mjs 按
 * INLINE_MODULES 顺序内联进同一工厂作用域（本模块排在组装点 src/live-layer.js 之前）。
 * 契约不变：不 import、无顶层可执行语句、只用扁平作用域里的自由名字；导出块只列本模块
 * 真声明过的名字（台架按文件 import 时靠它把名字挂回全局）。
 */
// ── 画布兜底色（--we-wallpaper-underlay）──────────────────────────────────────
// 机制与"为什么必须是根元素"见 src/styles.js 的 `html { background-color: … }` 那段。
// 这里只说两个来源与优先级：
//   · **画面取样**（64×64 下采样后的占比最大色）优先 —— 兜底色的用途是"壁纸的像素没送到
//     屏上的那一瞬间，屏上还剩一层像它的颜色"，画面自己的主色比作者的 UI 配色更贴近这个语义；
//   · **作者 / 面板配色**兜底 —— 场景 / 网页 live 壁纸的可视叶子是 iframe，没有可直接采样的
//     媒体元素，只能走这条（作者填的恰好 0 0 0 视作"没填"、面板覆盖值照用，沿用 theme-follow
//     的同一套口径，不另立一份）。
// 取样只在**已经解码进 DOM 的叶子**上做（video / canvas / img 在屏上本来就有一份），因此不
// 额外发起任何网络请求或解码；全程 try/catch：跨源污染、无 2d 上下文、元素还没数据一律静默
// 放弃并保持作者配色那条腿，绝不抛。
const UNDERLAY_SAMPLE_DELAY_MS = 6000;   // 首帧后的复采：视频常有黑场淡入，首帧不足以代表画面
let underlayScheme = "";       // 作者 / 面板配色（"rgb(r, g, b)"；"" = 没有）
let underlaySampled = "";      // 画面取样结果（"rgb(r, g, b)"；"" = 还没采到）
let underlaySampledFor = "";   // 取样结果属于哪张壁纸（换壁纸即作废）
let underlayResampleTimer = 0; // 首帧后的复采定时器
let underlayWritten = "";      // 最近一次**真正写进去**的颜色（"" = 现在没写）

function underlayRgbText(rgb) {
  return Array.isArray(rgb) && rgb.length >= 3
    ? "rgb(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ")"
    : "";
}

/**
 * 把当前兜底色写到根元素（`""` = 摘掉变量 ⇒ 画布回到透明）。
 * 两条"什么都不做"的门：**从没写过、现在也没有颜色** ⇒ 连属性带留痕一起跳过（壁上本来
 * 就是宿主自己的底色，没有任何变化值得记）；**值没变** ⇒ 只写属性、不重复留痕（换壁纸时
 * 两个来源会各调一次，值相同不该各记一行）。留痕本身就是一次上报，所以这两条门同时也是
 * "别给诊断通道添噪声"。
 */
function writeUnderlayColor(reason) {
  if (typeof document === "undefined" || !document || !document.documentElement) return;
  const color = underlaySampled || underlayScheme;
  if (!color && !underlayWritten) return;
  try {
    const st = document.documentElement.style;
    if (color) st.setProperty("--we-wallpaper-underlay", color);
    else st.removeProperty("--we-wallpaper-underlay");
  } catch { /* 写不进去（极简环境）：保持既有值，不影响壁纸 */ }
  if (color === underlayWritten) return;
  underlayWritten = color;
  liveLog("underlay", "色=" + (color || "-") + " 源=" + reason + " wid=" + (selection.id || "-"));
}

/**
 * 作者 / 面板配色那条腿（同步、幂等）。换壁纸、面板改「壁纸属性」、开关主题类设置都会走到；
 * 画面取样结果在场时它不覆盖（写入口的优先级在 writeUnderlayColor 里，只有一处）。
 */
function refreshUnderlayColor() {
  let next;
  try { next = underlayRgbText(themeFollowSchemeColorOf(selection)); } catch { next = ""; }
  if (next === underlayScheme) return;
  underlayScheme = next;
  writeUnderlayColor(weT("作者配色"));
}

/** 清空两条腿并摘掉变量（清除壁纸 / 插件卸载）。 */
function clearUnderlayColor() {
  underlayScheme = "";
  underlaySampled = "";
  underlaySampledFor = "";
  underlayWritten = "";
  scrubUnderlayResample();
  if (typeof document === "undefined" || !document || !document.documentElement) return;
  try { document.documentElement.style.removeProperty("--we-wallpaper-underlay"); } catch { /* ignore */ }
}

function scrubUnderlayResample() {
  if (!underlayResampleTimer) return;
  try { if (typeof window !== "undefined" && window.clearTimeout) window.clearTimeout(underlayResampleTimer); } catch { /* ignore */ }
  underlayResampleTimer = 0;
}

/** 从层里的媒体叶子采一次占比最大色（画不出来就说"没有"，不改任何既有值）。 */
function sampleUnderlayOnce(el, wid) {
  try {
    if (!el || typeof document === "undefined" || !document) return false;
    const probe = document.createElement("canvas");
    if (!probe || typeof probe.getContext !== "function") return false;
    probe.width = THEME_FOLLOW_SAMPLE_PX;
    probe.height = THEME_FOLLOW_SAMPLE_PX;
    const g = probe.getContext("2d");
    if (!g) return false;
    g.drawImage(el, 0, 0, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX);
    const px = g.getImageData(0, 0, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX).data;
    const text = underlayRgbText(themeFollowModeColorOf(px, THEME_FOLLOW_SAMPLE_PX, THEME_FOLLOW_SAMPLE_PX));
    if (!text) return false;
    if (underlaySampledFor !== wid) return false;   // 采样期间换过壁纸：这次结果作废
    if (text === underlaySampled) return true;
    underlaySampled = text;
    writeUnderlayColor(weT("画面取样"));
    return true;
  } catch { return false; }   // 跨源污染 / 取像素被拒：保持作者配色那条腿
}

/**
 * 画面取样那条腿的调度（syncLayers 每次调用，幂等）：叶子已经解码 ⇒ 立刻采一次，并在
 * 播放一段时间后复采一次（黑场淡入的视频首帧不足以代表画面）；还没解码 ⇒ 等它的就绪事件。
 */
function scheduleUnderlaySample(node) {
  try {
    if (!node || typeof document === "undefined" || !document) return;
    const wid = String(selection.id || "");
    if (!wid) return;
    if (underlaySampledFor !== wid) {           // 换壁纸：上一张的取样结果作废
      underlaySampledFor = wid;
      underlaySampled = "";
      scrubUnderlayResample();
      writeUnderlayColor(weT("换壁纸"));
    }
    const el = node.querySelector("canvas.we-media--canvas")
      || node.querySelector("video.we-media")
      || node.querySelector("img.we-media");
    if (!el) return;                            // live（iframe）没有可直接采样的叶子
    const armed = el.dataset ? el.dataset.weUnderlayWid : "";
    if (armed === wid) return;                  // 这张壁纸的这个叶子已经排过取样
    if (el.dataset) el.dataset.weUnderlayWid = wid;
    const kind = String(el.tagName || "").toUpperCase();
    const ready = kind === "CANVAS"
      || (kind === "VIDEO" && Number(el.readyState) >= 2 && Number(el.videoWidth) > 0)
      || (kind === "IMG" && el.complete && Number(el.naturalWidth) > 0);
    const take = (again) => {
      try {
        if (String(selection.id || "") !== wid) return;   // 期间换过壁纸
        if (!sampleUnderlayOnce(el, wid)) return;
        if (!again) {
          scrubUnderlayResample();
          underlayResampleTimer = window.setTimeout(() => {
            underlayResampleTimer = 0;
            try { if (String(selection.id || "") === wid) sampleUnderlayOnce(el, wid); } catch { /* ignore */ }
          }, UNDERLAY_SAMPLE_DELAY_MS);
        }
      } catch { /* ignore */ }
    };
    if (ready) take(false);
    else if (typeof el.addEventListener === "function") {
      // 只等一次：`loadeddata`（video 首帧）/ `load`（img 解码完成）。不 bind 到具体壁纸 ——
      // 回调里按 wid 再校一次，换过壁纸就自然空转（元素本身随层一起被回收）。
      const ev = kind === "VIDEO" ? "loadeddata" : "load";
      try { el.addEventListener(ev, () => take(false), { once: true }); } catch { /* ignore */ }
    }
  } catch { /* 兜底色是增强：任何异常都不该影响壁纸主路径 */ }
}

// ── 可见性恢复：复合成微推 + 「画面真的回到屏上了吗」留痕 ────────────────────────
// 最小化 / 遮挡 / 后台节流之后再回到屏上时，合成器可能仍拿着那一层的陈旧状态：壁纸层是
// 整屏的负 z-index 普通元素，而本仓刻意不给它常驻合成层（见 --we-wallpaper-transform 的
// 注释）—— 于是"回来时它没被重新提交"没有第二条自愈路径。这里只做**一次两帧**的提升：
// 让合成器重新提交这一层的像素，随后立刻撤掉，不留常驻层。

/** 层的一句话在屏状态：几何 + 叶子就绪态 + 已呈现帧数（video 才有）。 */

/** 已呈现（解码输出）的帧数；拿不到返回 -1（判据是"它在不在涨"，不是绝对值）。 */

/**
 * 可见性恢复后的留痕（事件级，绝不进热路径）：意图态（playing / hidden / focus）答不了
 * "画面到底有没有回到屏上"，而这类只在特定窗口状态下复现的问题恰恰要这一条。
 * 第二行取**下一帧真的被呈现**那一刻（`requestVideoFrameCallback`），比等一个固定时长更
 * 贴近问题本身（"隔了多久画面才回来"），也不给任何"按毫秒数找定时器"的夹具添一个同槽位
 * 的干扰项 —— 弹这行的是**媒体事件**，与定时器命名空间无关。引擎没有 rVFC（或层里没有
 * video）时不补第二行：第一行已经带上了几何 + 叶子就绪态 + 已呈现帧数。
 */
function probeWallpaperOnScreen(source) {
  try {
    const node = document.getElementById(LAYER_ID);
    liveLog("onscreen", source + " · " + onScreenBrief(node));
    const v = node && node.querySelector ? node.querySelector("video.we-media") : null;
    if (!v || typeof v.requestVideoFrameCallback !== "function") return;
    const t0 = Date.now();
    v.requestVideoFrameCallback(() => {
      try {
        liveLog("onscreen", source + " · 画面呈现于 +" + Math.round(Date.now() - t0) + "ms · "
          + onScreenBrief(document.getElementById(LAYER_ID)));
      } catch { /* ignore */ }
    });
  } catch { /* 诊断是增强：失败不影响壁纸 */ }
}

// The official Windows preload observes body.style, but not ACTIVE_ATTR.
// Keep its measured native caption colour in step with the wallpaper gate.
// The plugin-owned marker only wakes that existing observer; it paints nothing.
function setWallpaperActive(active) {
  const body = document.body;
  if (active) body.setAttribute(ACTIVE_ATTR, "on");
  else body.removeAttribute(ACTIVE_ATTR);
  if (document.documentElement?.dataset?.windowsTitlebar === undefined) return;
  const marker = "--we-caption-active";
  if (active) {
    if (body.style.getPropertyValue(marker) !== "1") body.style.setProperty(marker, "1");
  } else if (body.style.getPropertyValue(marker)) {
    body.style.removeProperty(marker);
  }
}


export { refreshUnderlayColor, clearUnderlayColor, probeWallpaperOnScreen };
