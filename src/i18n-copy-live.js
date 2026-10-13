/**
 * i18n-copy-live.js — 英文词表域：实时层与素材预处理（src/live-layer.js · src/media-prep.js）
 *
 * 本域词条**原样搬自** `src/i18n-copy.js`（拆分属纯搬移：中文键与英文值一行未改、顺序未动）。
 * 组装点在同族的 `src/i18n-copy.js`（composer）；域模块必须排在 composer **之前**登记进
 * `scripts/build-client.mjs` 的 INLINE_MODULES —— 构建期内联进同一工厂作用域，顶层读受 TDZ 约束。
 * 只读不写：纯数据，不得有可执行语句。守卫判据见 `test/verify-i18n.mjs`（族读法 test/tools/src-scope.mjs）。
 */
const WE_I18N_EN_LIVE = {
  // ── src/live-layer.js ──
  "首帧超时（{secs} 秒内无画面）": "First-frame timeout ({secs} s without a frame)",
  "运行中断（{secs} 秒无帧）": "Stalled ({secs} s without a frame)",
  "壁纸加载失败": "Wallpaper failed to load",
  "载荷传输未完成（下载停滞）": "Payload transfer incomplete (download stalled)",
  "渲染失败": "Rendering failed",
  "，暂停期跳过 {n} tick": ", skipped while paused for {n} tick",
  "，传输中 {n} tick": ", transferring for {n} tick",
  "(应用源)": "(app origin)",
  "，冷却 {s}s 后自动重试": ", cooling down for {s}s, then auto-retry",
  "，已达重试上限": ", retry limit reached",
  "拿不到实时画面（这个壁纸没有实时渲染）": "No live frame available (this wallpaper has no live rendering)",
  "拿不到实时画面（实时渲染没在运行，或渲染页还没画布）": "No live frame available (live rendering is not running, or the render page has no canvas yet)",
  "抓到的画面是空的（实时渲染还在启动中？稍等一两秒再试）": "Captured frame is empty (is live rendering still starting up? Wait a second or two, then try again)",
  "抓到的画面还没有内容（全黑/纯色）→ 已保留原来那张": "Captured frame has no content yet (all black / solid color) → kept the previous one",
  "旧实时帧删不掉（被占用或宿主报错）→ 没有换成新抓的这张，可稍后重试": "Cannot delete the old live frame (in use or host error) → the newly captured frame was not applied; try again later",
  "写入失败（宿主返回 {status}）": "Write failed (host returned {status})",
  "这次没抓成（拿不到画面或写入失败）→ 原来那张没动": "Capture failed this time (no frame or write failed) → the previous one was left untouched",
  "抓帧过程出错 → 原来那张没动": "Error while capturing the frame → the previous one was left untouched",
  "过场": "transition",

  // ── src/media-prep.js ──
  "无": "none",

};

export { WE_I18N_EN_LIVE };
