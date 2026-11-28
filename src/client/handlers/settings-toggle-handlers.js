/**
 * settings-toggle-handlers.js — 设置开关处理器（独立配置 / 场景实时 / 播放 / 系统），从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 口径：本段含玻璃子项「独立配置」三函数，以及场景实时（开机延迟/帧率/自动画质/软渲染暂停）、播放倍速与限帧、镜像、适配目标、三种暂停与启动暂停、live 诊断开关。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文逐字节来自拆前的 src/client.js 对应区间。
 *   3) 顶层只有函数声明：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ⚠️ 只有 `glassMode` 一个键：能读自己的值这件事，由"注册表 params ↔ 接线点"（守卫 ④）
//    与"写了必须被 CSS 读到"（⑬）保证。
function onToggleChildIndependent(id, on) {
  const next = Object.assign({}, selection.glassMode);
  if (on) next[id] = "custom"; else delete next[id];
  setSetting("glassMode", next);
  emit();
}
/** 某一个子项的「独立配置」是否已开（**只看模式**）。 */
function childIndependentOn(id) {
  return !!(selection.glassMode && selection.glassMode[id] === "custom");
}
// 子 UI 独立参数：直接写它自己的键（键名由 childGlassKey 生成，与 schema 同源）。
function onGlassChildParam(id, param, value) { setSetting(childGlassKey(id, param), value); emit(); }
// 场景 / 网页实时渲染的总开关就是**显式重试入口**：除写设置外还要清空全部失败记忆
//（含**会话内**的传输类软失败 —— 它不在设置里），并重建层与音频互斥态。
// 五件事必须一起发生，所以它是一个处理器，而不是渲染器里的五行。
function onToggleSceneLive(e) {
  setSetting("sceneLive", e.target.checked);
  setSetting("sceneLiveFailures", {});
  prepareLiveTimeouts.clear(); // 准备期 live 超时冷却一并清零
  clearLiveSessionFailures();  // 会话内的传输类软失败同样要清
  syncLayers();                // key 的 live 段变化 → 层重建（升级/降级）
  syncSceneAudio(selection);   // 音频互斥状态随形态切换
  emit();
}
function onLiveBootDelay(secs) { setSetting("liveBootDelay", secs); emit(); }
function onSceneLiveFps(f) { setSetting("sceneLiveFps", f); syncLayers(); emit(); }
// 自动画质开关：值进渲染页 URL（autoq=0）⇒ 必须重建层（syncLayers）。
// ⚠️ #371：switchRow 走 React 委托，onChange 收到的是**合成事件**——这里若写 `v === true`
// （v 是事件对象）恒为 false ⇒ 开关只能写 false（"能关不能开"）。与 onTitlebarGlass /
// onPauseOnHidden 等同款，取 e.target.checked。
function onSceneAutoQuality(e) { setSetting("sceneAutoQuality", e.target.checked === true); syncLayers(); emit(); }
// 软件渲染兜底：关掉即恢复「软渲染也照跑实时」，下次 sync 会把暂停态解除。
function onSceneSoftRenderPause(e) { setSetting("sceneSoftRenderPause", e.target.checked === true); syncLayers(); emit(); }
function onPlaybackRate(rate) { setSetting("playbackRate", rate); emit(); }
function onFpsCap(cap) {
  // 用户主动改上限：这一轮抽帧升级允许当场换源（自动触发的那一轮不允许，见 upgradeByUser）。
  try { noteFpsCapChange(); } catch { /* ignore */ }
  setSetting("fpsCap", cap);
  refreshMediaInfo(true);
  emit();
}
function onFlip(e) { setSetting("flip", e.target.checked); emit(); }
function onAdapterTarget(e) { setSetting("adapterTarget", e.target.value); emit(); }
function onPauseOnHidden(e) { setSetting("pauseOnHidden", e.target.checked); emit(); }
function onPauseOnBlur(e) { setSetting("pauseOnBlur", e.target.checked); emit(); }
function onPauseOnBattery(e) { setSetting("pauseOnBattery", e.target.checked); emit(); }
function onStartPaused(e) { setSetting("startPaused", e.target.checked); emit(); }
function onToggleLiveDiag() { toggleLiveDiag(); emit(); }
