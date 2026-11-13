/**
 * media-prep/prepare.js — 媒体预备族的**轮换预准备段**（S5 从 src/media-prep.js 纯搬移）。
 *
 * 内容：beginRotationPrepare（预挂载下一张候选）/ prepTimeout（准备超时记账）/
 * prepareWallpaper（按类型分派到 video/web/scene 预处理器）。
 *
 * 同族其余部分：根组装点 src/media-prep.js（applySelection / buildMedia / scene 两阶段 /
 * 幻灯片）、probe.js（detached video/iframe 探测）、budget.js（live 准备超时账本）。
 * 契约：构建期与其他内联模块同作用域拼接（不 import）；浏览器安全；不得有顶层可执行语句
 * 读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
 */

function beginRotationPrepare(excluded) {
  cancelRotationPrepare();
  // 隐藏中：连 staging 都不建（cancelRotationPrepare 已释放上一轮的驻留）。
  if (typeof document !== "undefined" && document.hidden) { deferRotationWhileHidden("rotation-defer"); return; }
  const next = rotationNextCandidate(excluded);
  liveLog("rotation-fire", "当前 " + (selection.id || "-") + " → 候选 " + (next ? next.id : weT("无"))
    + " 候选池 " + rotationCandidates().length + " " + liveStateBrief());
  // 静默停摆修复语义保留：候选在 armed 期间被隐藏到不足时 re-arm（候选仍 <2
  // 时 syncRotationTimer 自身不会 arm；恢复 ≥2 由 hide/restore 的补 arm 接管）。
  if (!next) { syncRotationTimer(); return; }
  const prep = {
    id: next.id, fromId: selection.id, excluded,
    cancelled: false, settled: false, timers: [], staged: null, probeMedia: null,
  };
  rotationPrep = prep;
  const onReady = () => {
    if (prep.cancelled || prep.settled || rotationPrep !== prep) return;
    prep.settled = true;
    commitRotationSwitch(prep);
  };
  const onFail = () => {
    if (prep.cancelled || prep.settled || rotationPrep !== prep) return;
    prep.settled = true;
    // 跳过坏壁纸：清理本次准备（staged 在失败点已自清理）后链式尝试下一个。
    rotationPrep = null;
    prep.cancelled = true;
    for (const t of prep.timers) { try { clearTimeout(t); } catch { /* ignore */ } }
    prep.timers = [];
    releaseProbeMedia(prep);
    excluded.add(next.id);
    beginRotationPrepare(excluded);
  };
  prepareWallpaper(next, prep, onReady, onFail);
}

// 单阶段超时兜底：宁肯兜底提交/降级也绝不让轮换静默卡死。返回 timer handle。
function prepTimeout(prep, fn, ms) {
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") return null;
  const t = window.setTimeout(() => {
    if (prep.cancelled || prep.settled || rotationPrep !== prep) return;
    fn();
  }, ms || ROTATION_PREP_TIMEOUT_MS);
  prep.timers.push(t);
  return t;
}

function prepareWallpaper(w, prep, onReady, onFail) {
  if (!w) { onFail(); return; }
  if (w.type === "image") {
    prep.kind = "image";
    // headless 验证环境无 Image → 同步直通（验收脚本同步断言切换结果）。
    if (typeof Image !== "function") { onReady(); return; }
    const img = new Image();
    prep.probeMedia = img;
    img.onload = () => { adoptProbe(prep, { ready: true }); onReady(); };
    img.onerror = () => { releaseProbeMedia(prep); onFail(); };
    prepTimeout(prep, () => { adoptProbe(prep); onReady(); }); // 慢图兜底提交（元素在新层继续加载）
    img.alt = "";
    img.draggable = false;
    img.className = "we-media we-media--fit";
    img.src = w.media;
    return;
  }
  if (w.type === "video") {
    prep.kind = "video";
    // 视频类壁纸不跑「就绪后切换」的准备链：选中即播。
    // 准备链会另起一个 video 元素在后台 load() + play() 做预热领养 —— 对视频
    // 壁纸这意味着双解码（4K 下可见画面卡顿），而且预热元素带着 poster 进层，
    // 观感就是「GIF→静态图→正片」的整套加载流程。轮换到视频时直接提交，加载
    // 窗口由交叉渐变盖住。
    onReady();
    return;
  }
  if (w.type === "scene") {
    // 优先级不变量（与 buildMedia 一致）：live > sceneVideo > 静态帧。
    // live 探测失败回退 sceneVideo（host 对每个 scene 都 mint
    // sceneVideo URL，是否有内嵌视频只有请求后才知道），404/解码失败再降
    // 出图来源；那一帧拿不到 → preview → onFail 跳过。
    const liveSel = {
      type: "scene", id: w.id,
      sceneLiveSrc: w.sceneLiveSrc || null,
      objectFit: selection.objectFit,
      sceneLiveFps: selection.sceneLiveFps,
      sceneLive: selection.sceneLive,
      sceneLiveFailures: selection.sceneLiveFailures, sceneAutoQuality: selection.sceneAutoQuality,
    };
    if (liveRenderEnabled(liveSel) && !prepareLiveExhausted(w.id)) {
      prepareSceneLiveStage(w, prep, onReady, () => {
        if (w.sceneVideo) {
          prep.kind = "sceneVideo";
          prepareVideoProbe(w.sceneVideo, w.frameUrl || w.preview, prep, onReady,
            () => prepareSceneStaticStage(w, prep, onReady, onFail));
          return;
        }
        prepareSceneStaticStage(w, prep, onReady, onFail);
      });
      return;
    }
    if (w.sceneVideo) {
      prep.kind = "sceneVideo";
      prepareVideoProbe(w.sceneVideo, w.frameUrl || w.preview, prep, onReady,
        () => prepareSceneStaticStage(w, prep, onReady, onFail));
      return;
    }
    prepareSceneStaticStage(w, prep, onReady, onFail);
    return;
  }
  // web (iframe)：live 渲染页探测优先（webLiveSrc），失败回退旧链裸 iframe
  // load 探测（慢页超时兜底提交）。
  const webLiveSel = {
    type: "web", id: w.id,
    webLiveSrc: w.webLiveSrc || null,
    objectFit: selection.objectFit,
    sceneLiveFps: selection.sceneLiveFps,
    sceneLive: selection.sceneLive,
    sceneLiveFailures: selection.sceneLiveFailures, sceneAutoQuality: selection.sceneAutoQuality,
  };
  if (liveRenderEnabled(webLiveSel) && !prepareLiveExhausted(w.id)) {
    prepareSceneLiveStage(w, prep, onReady, () => prepareWebProbe(w, prep, onReady));
    return;
  }
  prep.kind = "web";
  prepareWebProbe(w, prep, onReady);
}
