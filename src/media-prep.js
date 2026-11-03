/**
 * media-prep.js — **选中的壁纸 → 屏幕上的媒体**：预准备（预挂载 + 探测 + 超时记账）、
 * 媒体元素构建（buildMedia）、选中项落地（applySelection）。
 *
 * 为什么单独一个文件：这一族是"切换壁纸"这条主链路的三段，跨 src/client.js
 * 的三个不相邻区段，中间夹着播放列表编辑、隐藏列表、用户属性、遮挡检测 —— 读一处改一处，
 * 很难看清"准备 → 构建 → 落地"的关系。抽出来之后，"为什么这张壁纸白屏/等了很久才出来"
 * 只需读一个文件。
 *
 * 契约（本文件是客户端程序的一部分，构建期由 scripts/build-client.mjs 内联进 bundle 的
 * 工厂作用域，"外部作用域"= 同一 prelude / src/client.js 的顶层。依赖见下表分组
 * （清单只在这里维护，不在此处写死数量）：
 *   状态 store        selection · rotationPrep · rotationCandidates · rotationNextCandidate ·
 *                     pendingStagedLayerNode · selectionBlockedNote · pageHiddenSince ·
 *                     prepareLiveTimeouts（本文件声明）
 *   轮换              beginRotationPrepare（本文件）· cancelRotationPrepare · commitRotationSwitch ·
 *                     deferRotationWhileHidden · ROTATION_PREP_TIMEOUT_MS · syncRotationTimer ·
 *                     releaseRotationAudioGate · keepPlayingWallpaper · groupWallpapers
 *   媒体与探测        adoptProbe · releaseProbeMedia · consumePreparedMedia · disposePreparedMedia ·
 *                     frameUrlWithVariant · weApplyAudio · syncSceneAudio · weStartDraw · weDrawFrame
 *   live 挂载         createLiveFrame · scheduleLiveMount · cancelLiveMount（后者用于「换壁纸即终止预热页」）
 *   live 诊断         liveLog(tag, detail, level?, verboseOnly?) —— 上报只有这一个出口
 *   prelude/client    emit · persistSelection · reportClientDiag · apiHead/apiFetch（prelude）
 * 提供的入口：
 *   applySelection(id, opts)               选中项落地（**唯一**入口：解析 → 门禁 → 持久化 → 层同步 → emit）
 *   buildMedia(sel)                        按 selection 造媒体元素（img/video/iframe/canvas）
 *   beginRotationPrepare(excluded)         轮换预准备（预挂载下一张）
 *   prepareLiveTimeouts                    连续超时记账（供面板/守卫读）
 *   ＋ 同族助手（供守卫单独取用）：prepTimeout · prepareWallpaper · prepareVideoProbe ·
 *     prepareWebProbe · prepareLiveExhausted · notePrepareLiveTimeout · clearPrepareLiveTimeout ·
 *     prepareSceneLiveStage · prepareSceneStaticStage
 *
 * 不变量：
 *   · **准备与提交分离**：prepare* 只做"探测/预挂载"（把结果写进传入的 prep 对象），
 *     **不得**改 selection、不得插入 DOM；真正的落地只在 commitRotationSwitch / applySelection。
 *   · **探测元素必须释放**：adoptProbe / releaseProbeMedia / disposePreparedMedia 成对 ——
 *     探测用的 Image/Video 不释放会一直占着解码器与网络连接。
 *   · **"已就绪"只许由就绪事件打**：adoptProbe 的 `{ ready: true }` 只给真的观测到
 *     onload / canplay / 渲染页首帧的调用点。超时兜底提交只是"这次探测该收尾了"，
 *     元素的像素还没到 —— 那一档**不得**带 `__weReady`，因为切层内容闸门把它读成
 *     "这一层有画面"（标错 = 放一块还没有像素的层上屏）。
 *   · **超时记账只许清零或自增**：prepareLiveTimeouts 记"连续超时次数"，达到上限后
 *     prepareLiveExhausted 为真 ⇒ 不再预挂载（否则每轮都白等满超时）；成功路径必须清零。
 *   · **applySelection 是唯一的"选中项落地"入口**：直接改 selection.id 会漏掉持久化、
 *     轮换闸放行与层同步（emit），面板与守卫都依赖这条。
 *   · 本文件必须保持浏览器安全（无 import / require / Node API），且**不得有顶层可执行语句**
 *     读 client.js 的 const（会被内联到 bundle 顶部，撞 TDZ）。
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
      sceneLiveFailures: selection.sceneLiveFailures,
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
    sceneLiveFailures: selection.sceneLiveFailures,
  };
  if (liveRenderEnabled(webLiveSel) && !prepareLiveExhausted(w.id)) {
    prepareSceneLiveStage(w, prep, onReady, () => prepareWebProbe(w, prep, onReady));
    return;
  }
  prep.kind = "web";
  prepareWebProbe(w, prep, onReady);
}

// detached <video> 预载 + 预播：canplay = 可播放就绪，元素本身（含已解码画面）
// 在 commit 时移入新层 —— 上屏即是活画面，无重新加载黑窗。error = 硬失败
// （跳过/回退），超时 = 兜底提交（poster 覆盖空窗）。
function prepareVideoProbe(url, posterUrl, prep, onReady, onFail) {
  if (!url || typeof document === "undefined" || typeof document.createElement !== "function") { onReady(); return; }
  const v = document.createElement("video");
  // headless mock 元素无事件设施 → 同步直通。
  if (!v || typeof v.addEventListener !== "function") { onReady(); return; }
  prep.probeMedia = v;
  const onCanplay = () => { adoptProbe(prep, { ready: true }); onReady(); };
  const onErr = () => { releaseProbeMedia(prep); onFail(); };
  v.__weCanplay = onCanplay;
  v.__weError = onErr;
  v.addEventListener("canplay", onCanplay, { once: true });
  v.addEventListener("error", onErr, { once: true });
  prepTimeout(prep, () => { adoptProbe(prep); onReady(); }); // 慢网络兜底提交
  try {
    v.muted = true;
    v.loop = true;
    v.autoplay = true;
    v.preload = "auto";
    v.setAttribute("playsinline", "");
    if (posterUrl) v.poster = posterUrl;
    v.className = "we-media we-media--fit";
    v.src = url;
    v.load();
    // detached 也先播起来：移入新层时正在播放的画面无缝续播。
    const p = typeof v.play === "function" ? v.play() : null;
    if (p && typeof p.catch === "function") p.catch(() => { /* 可见后 syncLayers 补 play */ });
  } catch { adoptProbe(prep); onReady(); }
}

// detached <iframe> 预载：load 事件（跨域也在元素上触发）后即随元素移入新层。
// 与 live 同款 staging 容器承载 —— iframe 在同文档内 reparent 会重载文档，
// commit 时容器整体转为新层（节点级领养），iframe 全程不移动。
function prepareWebProbe(w, prep, onReady) {
  if (!w.media || typeof document === "undefined" || typeof document.createElement !== "function") { onReady(); return; }
  const f = document.createElement("iframe");
  if (!f || typeof f.addEventListener !== "function") { onReady(); return; }
  prep.probeMedia = f;
  const onLoad = () => { adoptProbe(prep, { ready: true }); onReady(); };
  f.__weLoad = onLoad;
  f.addEventListener("load", onLoad, { once: true });
  prepTimeout(prep, () => { adoptProbe(prep); onReady(); }); // 慢页兜底提交（元素继续加载）
  try {
    f.setAttribute("frameborder", "0");
    f.setAttribute("scrolling", "no");
    // 安全隔离：WE web 壁纸是 workshop 第三方 HTML/JS，与宿主同源 —— 不
    // sandbox 的话壁纸脚本可以宿主 origin 身份调宿主 API。allow-scripts 保留
    // 动态壁纸能力，opaque origin 阻断身份冒用。
    f.setAttribute("sandbox", "allow-scripts");
    f.className = "we-media we-iframe";
    const div = document.createElement("div");
    div.className = "we-layer we-layer--staging";
    prep.staged = { div };
    div.appendChild(f);
    document.body.appendChild(div);
    f.src = w.media;
  } catch { adoptProbe(prep); onReady(); }
}

// live 渲染页预载：staging 层（opacity:0 但 in-DOM 且几何满视口 → 渲染页按
// 全分辨率正常初始化）里加载 WebWallGL 渲染页，首帧判定与 startLiveWatch
// 同口径（__wpStats running && fps>0）→ 就绪后 staging 容器在 commit 时整体
// 转为新层（节点级领养，iframe 不移动 —— 同文档 reparent 会重载文档）。
// 超时/失败回退 sceneVideo/静态帧阶段；刻意不簿记 sceneLiveFailures ——
// 探测放弃不等于渲染失败，切换后的正式心跳仍有自己的首帧看护兜底。
// 准备期 live 首帧连续超时的候选：本会话不再对它尝试 live 准备，直接走
// sceneVideo/静态帧。理由：超时候选本来也进不了 live，而每次尝试都要重新完整
// 拉一次 scene.pkg（host 对 /scene-files 响应 no-store，没有 HTTP 缓存）+ 满
// 视口渲染最多 LIVE_FIRST_FRAME_MS，并且准备失败刻意不簿记 sceneLiveFailures
// （探测放弃 ≠ 渲染失败）→ 不设闸就是每轮轮换重来一次。手动选择壁纸走的是建层
// 路径、不经过准备链，不受此闸影响；准备期真的出首帧即清零，下轮恢复正常尝试。
const PREPARE_LIVE_TIMEOUT_LIMIT = 2;
// 准备期中途被隐藏（人切走了）最多等多久：短时间离开就等着 —— 回来能看到本轮
// 立刻完成切换；超过上限则释放 staging 渲染页（pkg 堆 ~10MB + 数十 MB 显存），
// 转为「可见时补做」，且不记超时计数（隐藏 ≠ 这张壁纸 live 走不通）。60s 与轮换
// 间隔同量级：离开超过一轮就没必要替用户先切好，回来再切更贴近直觉，也省掉
// 「隐藏数小时 = 每 4 分钟加载一次 pkg」的反复冷启动。
const PREPARE_LIVE_HIDDEN_HOLD_MAX_MS = 60000;
// 隐藏期探测间隔（显式拉长）：隐藏页定时器本来就被 Chromium 钳到 ≥1s、5 分钟后
// 1/min，写 2s 是为了让「这里不需要高频探测」这层意图留在代码里。
const PREPARE_LIVE_HIDDEN_POLL_MS = 2000;
const prepareLiveTimeouts = new Map(); // wallpaper id -> 连续超时次数
function prepareLiveExhausted(wid) {
  return (prepareLiveTimeouts.get(String(wid || "")) || 0) >= PREPARE_LIVE_TIMEOUT_LIMIT;
}
function notePrepareLiveTimeout(wid) {
  const key = String(wid || "");
  if (!key) return;
  const n = (prepareLiveTimeouts.get(key) || 0) + 1;
  prepareLiveTimeouts.set(key, n);
  if (n === PREPARE_LIVE_TIMEOUT_LIMIT) {
    // 降级（本会话对该壁纸不再尝试 live）⇒ `warn`；经 liveLog 走同一条诊断通道
    //（浏览器控制台 + 宿主 /diag 环形缓冲），不再自打一行裸 console。
    try {
      liveLog("prep-live-timeout",
        "wid=" + key + " 连续 " + n + " 次超时 → 本会话对该壁纸改用 sceneVideo/静态帧", "warn");
    } catch { /* ignore */ }
  }
}
function clearPrepareLiveTimeout(wid) {
  const key = String(wid || "");
  if (key) prepareLiveTimeouts.delete(key);
}

function prepareSceneLiveStage(w, prep, onReady, onFail) {
  prep.kind = "live";
  if (typeof document === "undefined" || typeof document.createElement !== "function"
    || typeof window === "undefined" || typeof window.setTimeout !== "function") { onFail(); return; }
  const f = document.createElement("iframe");
  // headless mock 元素无事件设施 → 同步直通（验收脚本同步断言切换结果）。
  if (!f || typeof f.addEventListener !== "function") { onReady(); return; }
  const probeSel = {
    type: w.type, id: w.id,
    sceneLiveSrc: w.sceneLiveSrc || null,
    webLiveSrc: w.webLiveSrc || null,
    objectFit: selection.objectFit,
    sceneLiveFps: selection.sceneLiveFps,
    sceneLive: selection.sceneLive,
    sceneLiveFailures: selection.sceneLiveFailures,
  };
  if (!liveRenderEnabled(probeSel)) { onFail(); return; }
  const div = document.createElement("div");
  div.className = "we-layer we-layer--staging";
  f.setAttribute("frameborder", "0");
  f.setAttribute("scrolling", "no");
  f.setAttribute("allow", "autoplay");
  f.className = "we-media we-iframe we-live-iframe";
  f.src = liveRenderUrl(probeSel);
  prep.staged = { div };
  prep.probeMedia = f;
  div.appendChild(f);
  document.body.appendChild(div);
  let startedAt = Date.now();
  let heldHidden = (typeof document !== "undefined" && document.hidden); // 准备开始时就已隐藏
  const bail = (noStrike) => {
    if (prep.staged && prep.staged.div) { try { prep.staged.div.remove(); } catch { /* ignore */ } }
    prep.staged = null;
    releaseProbeMedia(prep);
    // 连续超时到限 → 本会话不再对它走 live 准备。标签页隐藏期间的放弃不算：
    // 那不是「这张壁纸 live 走不通」的证据（隐藏页面根本不可能出帧）。
    if (!noStrike) notePrepareLiveTimeout(w.id);
    onFail();
  };
  const poll = () => {
    const st = liveStats(f);
    if (st && st.running && st.fps > 0) {
      clearPrepareLiveTimeout(w.id); // 真的出首帧 → 清掉超时计数
      liveLog("prep-live-ready", "wid=" + w.id + " 用时 " + (Date.now() - startedAt) + "ms");
      adoptProbe(prep, { ready: true }); // readyEl = iframe，监听摘除，元素随 commit 进新层
      onReady();
      return;
    }
    // 标签页隐藏：渲染页的 rAF 被 Chromium 完全停摆（不是「渲染慢」），出帧物理
    // 不可能 —— 这里必须冻结首帧预算，否则隐藏期间的每次轮换都白等 15s 并退化成
    // sceneVideo/静态帧，连续两次还会给这张壁纸盖上「本会话不再尝试 live」
    // （prepareLiveExhausted）：用户切回来看到的是一张回不到 live 的静态壁纸。
    // 隐藏持续过久（超上限）才放弃，且不记超时计数（见 bail 的 noStrike）。
    if (typeof document !== "undefined" && document.hidden) {
      const now = Date.now();
      heldHidden = true;
      const hiddenFor = pageHiddenSince ? (now - pageHiddenSince) : 0;
      if (hiddenFor > PREPARE_LIVE_HIDDEN_HOLD_MAX_MS) {
        liveLog("prep-live-bail-hidden", "wid=" + w.id + " 隐藏已持续 " + hiddenFor + "ms → 释放 staging，转为可见时补做（不计超时）");
        deferRotationWhileHidden("rotation-defer");
        // 不走 bail()/onFail()：隐藏超时 ≠ 这张壁纸 live 走不通，回退链会把它提交成
        // 静态帧/内嵌 MP4 —— 人回到窗口看到的会是静态壁纸。直接取消本轮准备（释放
        // staging、停掉本链、不记 strike），可见时重新准备。
        cancelRotationPrepare();
        return;
      }
      startedAt = now; // 隐藏期间不计时：恢复可见后重新给满预算
      prepTimeout(prep, poll, PREPARE_LIVE_HIDDEN_POLL_MS);
      return;
    }
    if (heldHidden) { heldHidden = false; startedAt = Date.now(); } // 恢复可见：重新给满首帧预算
    if (Date.now() - startedAt > LIVE_FIRST_FRAME_MS) {
      liveLog("prep-live-bail", "wid=" + w.id + " 超时 " + (Date.now() - startedAt) + "ms，回退下一阶段");
      bail();
      return;
    }
    prepTimeout(prep, poll, 500);
  };
  prepTimeout(prep, poll, 300); // 首拍稍早：小 pkg 可能一帧内就绪
}

// 出图来源阶段：GET frameUrl 由 host 从磁盘取（`<key>_gpu.png` 或用户导入的自定义画面），
// img onload = 解码完成，元素随 commit 移入新层。空槽是 404（no-frame）→ preview 探测；
// 422 只属于 v=4 自定义画面缺失。preview 也失败 → onFail 跳过。
function prepareSceneStaticStage(w, prep, onReady, onFail) {
  prep.kind = "static";
  if (typeof Image !== "function") { onReady(); return; }
  const tryPreview = () => {
    if (!w.preview) { onFail(); return; }
    const p = new Image();
    prep.probeMedia = p;
    p.onload = () => { adoptProbe(prep, { ready: true }); onReady(); };
    p.onerror = () => { releaseProbeMedia(prep); onFail(); };
    p.alt = "";
    p.draggable = false;
    p.className = "we-media we-media--fit";
    p.src = w.preview;
  };
  if (!w.frameUrl) { tryPreview(); return; }
  // 探针必须加载**提交后真正会显示的那个 URL**：提交时 selection.url 会带上该
  // 壁纸记住的画面档位（frameUrlWithVariant）。若这里用无档位的 frameUrl，带档位
  // 的元素（?v=4）会在收编时被 URL 校验判为不符 → 释放重建：预载白做、新层仍从零
  // 加载（机制本意消除的加载窗口又回来了），还多一次全分辨率帧下载（host 对出图
  // 响应 no-store，浏览器缓存不复用；空槽时这次探测本身也白跑一次）。
  // 档位在准备与提交之间被改（理论上只有用户手动刷新）时 URL 仍会不符，
  // 校验照旧兜住重建。
  const savedVariant = Number(selection.frameVariants && selection.frameVariants[String(w.id)]) || 0;
  const frameSrc = frameUrlWithVariant(w.frameUrl, savedVariant);
  const img = new Image();
  prep.probeMedia = img;
  img.onload = () => { adoptProbe(prep, { ready: true }); onReady(); };
  img.onerror = () => { releaseProbeMedia(prep); tryPreview(); };
  prepTimeout(prep, () => { adoptProbe(prep); onReady(); }); // 慢帧兜底提交
  img.alt = "";
  img.draggable = false;
  img.className = "we-media we-media--fit";
  img.src = frameSrc;
}

// 就绪 → 落实切换：提交前再校验（准备期间用户可能手动切换/隐藏候选/关闭轮换），
// 通过则置渐变标记并 applySelection（fromRotation 带 kind 实测结果）。iframe 类
// 媒体走节点级领养（staging 容器整体转为新层，iframe 不移动）；img/video 走
// 元素级领养（buildMedia 收编）。staging 容器的收尾在 applySelection 返回后 ——
// 节点级领养时它已变成新层，元素级领养时它已完成使命移除。
function applySelection(id, opts) {
  // 让路态里用户**手动重选**壁纸（点卡片 / 快捷面板 / 「下一张」）= 最新的显式动作 ⇒
  // 立刻退出让路：玻璃整族回来，且用用户这次的选择（skipRestore 别拿记忆里的旧 id 盖它）。
  // 只认 fromManual —— 启动恢复 / revalidate / 轮换提交都不是"用户刚点了"。
  if (id && opts && opts.fromManual
      && typeof skinYieldActive === "function" && skinYieldActive()) {
    exitSkinYield("manual-pick", { skipRestore: true });
  }
  reportClientDiag("apply", "id=" + String(id || "").slice(0, 40));
  // 手动切换/清除/revalidate：取消进行中的轮换准备（staged/探测元素全部
  // 释放），并丢弃任何滞留的就绪元素。轮换提交（fromRotation）例外 ——
  // 就绪元素正是本次调用要带进新层的资产。
  if (!opts || !opts.fromRotation) { cancelRotationPrepare(); disposePreparedMedia(); }
  // 只有**用户点击**（fromManual）才清失败记忆：手动点开 = 想看它 live，重试一次实时渲染
  //（真失败会自动回退并重新记账）。启动恢复 / revalidate / 轮换提交都不清 —— 记忆的
  // 语义是「这张 live 走不通」，凡路过就清等于没记忆（smoke L2 钉住这条）。
  if (opts && opts.fromManual) clearLiveFailure(id);
  // GPU 抓帧回填的目标壁纸随切换作废（新壁纸的 live 首帧会重新调度）。
  cancelLiveFrameBackfill();
  // 延迟期那个**正在预热**的渲染页随**真正的切换**作废：它是「正在跑的渲染页」而不是普通元素，
  // 不终止就会留在后台继续抢 CPU/GPU，与新壁纸的启动叠在同一主线程上（用户反馈：启动
  // 延迟期切下一张会卡）。清定时器 + 未挂载则 `src=about:blank`，见 cancelLiveMount。
  //
  // **只在 id 真变了才拆**。同 id 的 revalidate（`loadInventory` → `revalidateSelection` →
  // 这里）传进来的就是当前选中项，那个待挂载的预热页正是**本次要用的**那一个；无条件拆掉
  // 会把已排定的挂载清成 `about:blank` 并且此后**没有任何人恢复**（`liveMountPending` 已空，
  // 看护器只在挂载成功路径上武装），图层就永久停在垫底图。而 `buildLive` 自己会
  // `scheduleLiveMount()`（它开头就 `cancelLiveMount("replaced")`），上一个 pending 不会泄漏。
  // ⚠️ 比较必须在下面那行赋值**之前** —— 赋值之后两边永远相等，这个守卫会失效。
  const idChanged = selection.id !== (id || "");
  if (idChanged) cancelLiveMount("selection");
  // 手动切换不走渐变 → 立即放行轮换音频闸（轮换提交由旧层退场放行）。
  if (!opts || !opts.fromRotation) releaseRotationAudioGate();
  selection.id = id || "";
  persistSelection();
  if (!selection.id) {
    selection.blockedNote = "";
    selection.url = null;
    selection.type = null;
    selection.previewUrl = null;
    selection.mediaExt = null;
    selection.slidesUrl = null;
    selection.slideIntervalMs = null;
    selection.liveFrame = null;
    selection.sceneVideo = null;
    selection.sceneLiveSrc = null;
    selection.webLiveSrc = null;
    selection.propsUrl = null;
    selection.sceneLiveActive = false;
    selection.sceneAudioUrl = null;
    selection.sceneHasAudio = false;
    selection.schemeColor = null;
    selection.mediaInfo = null;
    selection.transcodeState = "idle";
    invalidateMediaInfoProbe();
    abortTranscodeUpgrade();
    syncSceneAudio(selection);
    syncRotationTimer();
    // 壁纸退了 ⇒ 主题也退（我方改过才放、别人接管过就不碰；见 src/theme-follow.js 的
    // themeFollowRelease）。两条清空路径（用户「清除」与皮肤让路）都汇到这里。
    themeFollowRelease();
    emit();
    return;
  }
  const w = selection.inventory.wallpapers.find((x) => x.id === selection.id);
  // 判定来自 src/picker-model.js：过滤档与隐藏集合从调用点显式传入（模型不读 selection）。
  // 闸门是 keepPlayingWallpaper（分级拦播放；类型档只筛列表/轮播候选，不碰正在应用的壁纸）。
  if (!w || !keepPlayingWallpaper(w, selection.contentRatingFilter)) {
    // 被过滤条件排除 / 条目消失时必须留下可读原因（#84），见 selectionBlockedNote。
    selection.blockedNote = selectionBlockedNote(w);
    selection.url = null;
    selection.type = null;
    selection.previewUrl = null;
    selection.mediaExt = null;
    selection.slidesUrl = null;
    selection.slideIntervalMs = null;
    selection.liveFrame = null;
    selection.sceneVideo = null;
    selection.sceneLiveSrc = null;
    selection.webLiveSrc = null;
    selection.propsUrl = null;
    selection.sceneLiveActive = false;
    selection.sceneAudioUrl = null;
    selection.sceneHasAudio = false;
    selection.schemeColor = null;
    selection.mediaInfo = null;
    selection.transcodeState = "idle";
    invalidateMediaInfoProbe();
    abortTranscodeUpgrade();
    syncSceneAudio(selection);
    syncRotationTimer();
    emit();
    return;
  }
  const savedVariant = Number(selection.frameVariants && selection.frameVariants[String(w.id)]) || 0;
  selection.url = w.type === "scene" ? frameUrlWithVariant(w.frameUrl, savedVariant) : w.media;
  // 宿主 inventory 权威标记：已有自定义画面时同步进本地记忆（换机/清配置后恢复）。
  if (w.hasCustomFrame) {
    const cf = Object.assign({}, selection.customFrames || {});
    cf[String(w.id)] = true;
    selection.customFrames = cf;
  }
  selection.type = w.type;
  // 真实容器后缀（宿主 inventory 的 mediaExt）：媒体 URL 是 token 形态、没有扩展名，
  // 「浏览器原生可解」那条判据（见 src/video-layer.js 的 isNativelyPlayableSource）必须靠它。
  selection.mediaExt = w.mediaExt || null;
  // 图片 / 幻灯片壁纸的图集入口（宿主 inventory 的 slidesUrl = `/slides/<token>`；只有
  // 图集 ≥2 张时才给）。它只是「这张图之上还有几张可以淡入淡出」的附加层，底层首图仍走
  // url/mediaExt 那条原链 —— 接不到就退化成单图，与图片壁纸在 1.4.0 的行为一致。
  selection.slidesUrl = w.type === "image" && w.slidesUrl ? w.slidesUrl : null;
  selection.slideIntervalMs = w.type === "image" && typeof w.slideIntervalMs === "number" ? w.slideIntervalMs : null;
  selection.blockedNote = "";
  // 静态帧 URL (frameUrl, 立即上屏)：供页面刷新 / 档位切换时重挂。
  selection.sceneFrameUrl = w.type === "scene" ? (w.frameUrl || null) : null;
  // Scene wallpapers with an embedded animation (host-extracted MP4) play it
  // as a hardware-decoded <video>; scenes without one stay on the static frame.
  selection.sceneVideo = w.type === "scene" ? (w.sceneVideo || null) : null;
  // 轮换提交以准备期【探测】为准：sceneVideo 探测已 404/解码失败（kind 落到
  // static）时不得按 inventory 原样复活它 —— 否则新层 <video> 必然再次
  // error，已就绪的静态帧被硬重建 = 一次切换两段闪烁（实测闪烁主链）。
  if (opts && opts.fromRotation && w.type === "scene" && opts.kind === "static") {
    selection.sceneVideo = null;
  }
  // WebWallGL 实时渲染 token：host inventory 对 pkg 与松散目录一律给出
  // （WebWallGL 2.1.0 起渲染器按 project.json 的 file 后缀自判形态），客户端只认标志。
  selection.sceneLiveSrc = w.type === "scene" && w.sceneLive && w.sceneLiveSrc ? w.sceneLiveSrc : null;
  // 网页壁纸的 live 入口（host inventory 的 webLive/webLiveSrc）。
  selection.webLiveSrc = w.type === "web" && w.webLive && w.webLiveSrc ? w.webLiveSrc : null;
  // 「壁纸属性」面板：只有场景/网页壁纸的项目目录才有 project.json 用户属性。
  selection.propsUrl = (w.type === "scene" || w.type === "web") && w.propsUrl ? w.propsUrl : null;
  // 实时渲染激活态**只在真的换图时**清。它同时是"渲染页活着"的运行时状态与下游
  // （指针注入 / 媒体桥 / 属性面板提示）的闸门，而这里的清零点位于层同步**之前**：
  //   ① 同 id 重申（切会话后的 revalidate / 设置页对同一张再 apply）时 `wantKey`
  //      一字不差 ⇒ 走 `adopt-live` 领养分支，渲染页不重载、`startLiveWatch` 也可能
  //      因帧已在出帧（reset 后 `firstFrame` 一 tick 内即被置真）而不再走首帧门
  //      —— 标志就此永久停在 false，而消费点全是提前 return：`livePointerFlush` /
  //      `livePointerSample` 挡住指针注入、媒体桥 `startMediaSync` 的 1s 拍挡住
  //      频谱与 Now Playing。症状 = 壁纸照播但鼠标静默失效（只有整页重载才恢复）。
  //   ② 换图时仍必须清：旧帧连同它的 watch 一起退场，指针注入的闸门不能在新层
  //      就绪之前放行（下游还按 `isConnected` 兜底，但语义上这两件事必须同步）。
  // 同 id 的**真**重建（live 开关 / fps 档 / 媒体源变化 ⇒ 键变化）由 live-layer 的
  // `layer-rebuild` 分支 `stopLiveWatch()` 负责清，本行不必代劳。
  // 兜底：`startLiveWatch` 的 1s tick 在真出帧/渲染页可达时无条件校正回真（见 live-layer.js）。
  if (idChanged) selection.sceneLiveActive = false;
  // 场景包内独立音频（无内嵌 MP4 时播放；内嵌 MP4 场景由视频自带音轨，
  // syncSceneAudio 内部按 sceneVideo 互斥）。sceneHasAudio 经 HEAD 探测得出，
  // 供卡片音乐按钮显示。
  selection.sceneAudioUrl = w.type === "scene" && w.sceneAudio ? w.sceneAudio : null;
  selection.sceneHasAudio = false;
  if (selection.sceneAudioUrl) {
    const probeUrl = selection.sceneAudioUrl;
    apiHead(probeUrl).then((r) => {
      if (r.ok && selection.sceneAudioUrl === probeUrl) {
        selection.sceneHasAudio = true;
        try { emit(); } catch { /* ignore */ }
      }
    }).catch(() => { /* 无音频/探测失败：按钮保持隐藏 */ });
  }
  // Keep the preview around so a failed static frame can fall back to it.
  selection.previewUrl = w.preview || null;
  // 网页壁纸的实时抓帧缓存（宿主 inventory 的 liveFrame = /live-frame/<token>）。web 支把它当
  // 垫底图的**第 1 级候选**，并在 live 首帧稳定后向它回填抽帧；不落这条字段，那一整支
  //（候选、抽帧定时器、"真实渲染帧"那条取色腿）在客户端就没有入口。与 previewUrl 同址。
  selection.liveFrame = w.type === "web" && w.liveFrame ? w.liveFrame : null;
  // 作者声明的配色（project.json 的 schemecolor，宿主已转成 rgb()）：既是垫底图的
  // 底色兜底（buildLivePoster），也是「主题随壁纸」的第一优先级取色。
  // 接不到就让下面各处的 CSS 变量兜底。
  selection.schemeColor = w.schemeColor || null;
  selection.transcodeState = "idle";
  // The previous wallpaper's media info must not leak into the new one: a stale
  // fps would make the sync "源帧率 ≤ 上限" check wrongly skip the transcode
  // (and the UI would keep claiming 无需抽帧 for a 120fps source).
  selection.mediaInfo = null;
  abortTranscodeUpgrade();
  refreshMediaInfo(true);
  syncRotationTimer();
  emit();
  // 主题随壁纸（无开关）：本张壁纸的判决在**媒体层已经建好之后**才落一次（作者配色缺席时
  // 它会自己去采样预览图：异步、带代次校验，取不到就保持当前主题不动）。
  // 为什么必须落在 emit() 之后：写作入口在宿主侧是同步的一整轮 —— 重写全量别名令牌 +
  // 翻 color-scheme / body 主题属性 + 一次强制样式读取（dsh-client-ui-layout 的
  // ThemePresenter）。放在 emit() 之前，这一轮就正好落在「新壁纸的媒体节点还没被创建、
  // 请求还没发出」的空窗里，换壁纸的建层/起播/过渡全部排在它后面；实测同一条切换路径上
  // 主题真的写入时 apply→建层的中位耗时是 25ms，未写入时是 3ms。异步取色那条腿本来就在
  // 建层之后（要等图解码），这里只是让作者配色那条腿与它同序。
  // `fromSkinRestore`：皮肤退场把这张壁纸放回（src/client.js 的 exitSkinYield）——
  // 让位标记不复位，皮肤在台期间用户改过的主题不被这次放回盖掉。
  themeFollowOnWallpaper(selection, { fromSkinRestore: !!(opts && opts.fromSkinRestore) });
}
function buildMedia(sel) {
  // 换壁纸会重造这一层的媒体节点，但过场图挂在**层**上、不在媒体节点里：
  // 不先摘掉上一档的过场层，新媒体插回原位后旧图集仍压在上面（最多等一个周期才被
  // tick 的失联判定收走）。摘了等于回到「只有底层首图」，这一拍的交叉过渡也照旧。
  if (activeImageSlideshow) activeImageSlideshow.stop();
  // 壁纸播放形态优先级:
  //   1. live — WebWallGL 实时 iframe（scene.pkg 走场景管线；web 壁纸走它的
  //      web 挂载 + 宿主注入的 WE shim，严格沙箱隔离）。心跳判定失败后自动
  //      降级，见 startLiveWatch/liveFail。
  //   2. sceneVideo — 场景内嵌 MP4 (作者主分支, 硬件解码 <video>, poster=静态帧)
  //   3. 静态帧 img (frameUrl) / 网页壁纸的裸 iframe 兼容路径
  const isLive = (sel.type === "scene" || sel.type === "web") && liveRenderEnabled(sel);
  const isSceneVideo = sel.type === "scene" && Boolean(sel.sceneVideo) && !isLive;
  const isStill = sel.type === "image" || (sel.type === "scene" && !isLive && !isSceneVideo);
  if (isLive) {
    reportClientDiag("live-build", "type=" + sel.type + " delay=" + sel.liveBootDelay + " boot=" + bootRestore);
    // 轮换提交不走这里：live 的领养是节点级（staging 容器整体转为新层，
    // 见 syncLayers 的 pendingStagedLayerNode 分支），iframe 绝不移动。
    liveLog("build-live", "wid=" + sel.id + " 冷启动渲染页（重新加载） " + liveStateBrief());
    const poster = buildLivePoster(sel);
    const frame = createLiveFrame(sel);
    // 启动等待（仅「重启恢复上次壁纸」阶段，bootRestore）：**延迟期照常加载**（iframe 已建，
    // 正在拉 pkg / 解码纹理 / 编译 shader —— 让首帧先热起来才是这一档存在的理由），只是先显示
    // 占位图；`liveBootDelay` 是**上限**：首帧一就绪就立刻挂载，到上限仍未出帧也挂载。
    // 用户一开始交互 bootRestore 即为 false（见其声明处），手动切换壁纸 → 立即挂载、不等待。
    // 切换离开时由 cancelLiveMount 终止这个预热页（否则它会在后台抢资源压住新壁纸）。
    const delaySecs = clampNum(sel.liveBootDelay, 0, 30, 3);
    const delayMs = bootRestore && delaySecs > 0 ? delaySecs * 1000 : 0;
    if (delayMs <= 0) return [poster, frame];
    reportClientDiag("live-delayed", "ms=" + delayMs);
    scheduleLiveMount(sel, frame, delayMs);
    return poster;
  }
  // The user-chosen fit mode (覆盖/填充/居中/拉伸) applies to every wallpaper
  // type — WE media included (the 适配 control used to be uploads-only).
  // iframes (web wallpapers) don't read object-fit, so they skip the class.
  const fitClass = " we-media--fit";
  let media;
  if (sel.type === "video") {
    // 视频档的媒体构建归**视频通道**（见 src/video-layer.js 的 buildVideoMedia）：
    // Edge 那条腿会在通道里返回 [media, canvas]（镜像画布）⇒ 这里照原样把两条腿返回出去。
    const builtVideo = buildVideoMedia(sel, fitClass);
    if (Array.isArray(builtVideo)) return builtVideo;
    media = builtVideo;
  } else if (isSceneVideo) {
    // Scene animation as <video>: autoplay/loop/muted, poster = the extracted
    // static frame (shown while the video loads). Hardware-decoded → smooth,
    // no WebGL context → no freeze.
    const prepared = consumePreparedMedia("VIDEO", sel.sceneVideo);
    media = prepared || document.createElement("video");
    if (!prepared) {
      media.src = sel.sceneVideo;
      media.poster = sel.url;   // frameUrl as poster
    }
    media.autoplay = true;
    media.loop = true;
    media.setAttribute("playsinline", "");
    media.className = "we-media" + fitClass;
    // No embedded video (404) or codec failure → degrade to the static frame.
    media.addEventListener("error", () => {
      if (selection.sceneVideo) {
        selection.sceneVideo = null;
        try { syncLayers(); syncSceneAudio(selection); emit(); } catch { /* ignore */ }
      }
    });
  } else if (isStill) {
    const prepared = consumePreparedMedia("IMG", sel.url);
    media = prepared || document.createElement("img");
    if (!prepared) media.src = sel.url;
    media.alt = "";
    media.draggable = false;
    media.className = "we-media" + fitClass;
    // 图片 / 幻灯片壁纸：底层首张封面已经在上面挂好，图集（2 张以上）交给过场层。
    // 这一步只挂「附加层」，失败/空图集一律静默保持单图，绝不阻断建层。
    if (sel.type === "image" && sel.slidesUrl) scheduleImageSlideshow(media, sel);
    // Scene frames are no longer generated (the host serves an existing frame: the live-backfilled
    // GPU frame, or the user-imported custom frame). 代码事实：该帧**加载失败**（img onerror）且该壁纸
    // 有工程预览图时，退到 previewUrl 垫底 —— 那是作者随包发布的图，不是本插件合成的"猜图"。
    if (sel.type === "scene" && sel.previewUrl) {
      media.onerror = () => {
        if (media.src !== sel.previewUrl) media.src = sel.previewUrl;
      };
    }
  } else {
    // web 旧链不走元素级领养（iframe reparent 重载）：轮换的 web 提交是
    // 节点级领养（staging 容器整体转为新层），此处只会是手动选择路径。
    media = document.createElement("iframe");
    media.src = sel.url;
    media.setAttribute("frameborder", "0");
    media.setAttribute("scrolling", "no");
    // 安全隔离：WE web 壁纸是 workshop 第三方 HTML/JS，而 media 路由与宿主
    // 同源 —— 不 sandbox 的话壁纸脚本可以 DSH 宿主 origin 身份调用宿主全部
    // API。allow-scripts 保留动态壁纸能力，但拿到 opaque origin（无
    // allow-same-origin），无法再冒用宿主身份。
    media.setAttribute("sandbox", "allow-scripts");
    media.className = "we-media we-iframe";
  }
  return media;
}

// ── 图片 / 幻灯片壁纸的图内切换 ──────────────────────────────────────────────
// 契约：**只管附加层，不管底层**。底层 `<img>`（封面首图）的 src / 内联 opacity 一律不碰 ——
// 换壁画面的仍是 syncLayers 那一套；这里只是在它上面叠两张绝对定位的过场图做交叉淡化，
// 所以「回原生」（清壁纸 / 关功能 / 切到别的壁纸）只需要停表 + 摘节点，没有需要回滚的样式。
//
// 数据来自宿主 `/wallpaper-engine/slides/<token>`（token = 封面首图的媒体 token），回包里
// 是同一目录下自然序排好的全部图片 URL。图集 ≤1 张时**不装**：那种「幻灯片」与单图无差别，
// 多挂两张透明 img 只是白占内存。
const SLIDE_FADE_MS = 600;
const IMAGE_SLIDES_CACHE = new Map(); // `${id}@${intervalMs}` → { images, intervalMs }
// 当前挂着过场层的那一次安装（周期改了要能原地重装，不必重建整层：图片档的层键
// 只含 type+url，不会因为 `pictureSlideSeconds` 变化而重建）。
let activeImageSlideshow = null;

/** 图内过场的实际周期（毫秒）。用户显式设了秒数就听用户的，否则用 WE 项目里的 imageswitchtimes。 */
function pictureSlideIntervalMs(sel) {
  const preferredSec = clampNum(sel && sel.pictureSlideSeconds, 0, 3600, 0);
  if (preferredSec > 0) return preferredSec * 1000;
  // WE 没声明档位（老项目 / 手改过的 project.json）⇒ 30 秒兜底；声明了就钳进 5 秒..1 小时。
  const weMs = sel && typeof sel.slideIntervalMs === "number" ? sel.slideIntervalMs : 30000;
  return clampNum(weMs, 5000, 3600000, 30000);
}

/** 取图集并按需安装过场层（异步；同一 `id@周期` 只取一次）。 */
function scheduleImageSlideshow(media, sel) {
  if (!media || !sel || typeof sel.slidesUrl !== "string" || sel.slidesUrl === "") return;
  if (typeof apiJson !== "function") return;
  const intervalMs = pictureSlideIntervalMs(sel);
  const cacheKey = String(sel.id || "") + "@" + intervalMs;
  const cached = IMAGE_SLIDES_CACHE.get(cacheKey);
  if (cached) {
    if (media.isConnected) installImageSlideshow(media, cached);
    return;
  }
  Promise.resolve(apiJson(sel.slidesUrl)).then((res) => {
    const payload = res && res.ok ? res.data : null;
    if (!payload || payload.ok !== true || !Array.isArray(payload.images)) return;
    const images = payload.images
      .map((it) => (it && typeof it.url === "string" ? it.url : null))
      .filter(Boolean);
    if (images.length < 2) return;
    const entry = { images, intervalMs };
    IMAGE_SLIDES_CACHE.set(cacheKey, entry);
    if (media.isConnected) installImageSlideshow(media, entry);
  }).catch(() => { /* 图集不可用 ⇒ 保持单图（封面） */ });
}

/** 在 `media` 之上叠两张过场图，按周期轮转。返回的 stop 由 tick 内的失联判断自己调。 */
function installImageSlideshow(media, entry) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const parent = media && media.parentNode;
  if (!parent) return;
  const order = entry.images;
  const layers = [];
  for (let i = 0; i < 2; i += 1) {
    const img = document.createElement("img");
    img.className = "we-media we-media--fit we-slide";
    img.alt = "";
    img.draggable = false;
    img.style.opacity = "0";
    parent.appendChild(img);
    layers.push(img);
  }
  let top = 0;
  let index = 0;
  const timer = window.setInterval(tick, entry.intervalMs);
  const installed = { intervalMs: entry.intervalMs };
  function stop() {
    window.clearInterval(timer);
    for (const img of layers) if (img.parentNode) img.parentNode.removeChild(img);
    if (activeImageSlideshow === installed) activeImageSlideshow = null;
  }
  installed.stop = stop;
  installed.media = media;
  installed.entry = entry;
  installed.order = order;
  activeImageSlideshow = installed;
  function tick() {
    // 脱离文档 ⇒ 立刻停表摘图（换壁纸 / 清壁纸 / 切层都走这条路）。
    if (!media.isConnected || !parent.isConnected) { stop(); return; }
    // 页面隐藏时不推进：后台标签页里连续解码大图只会白烧 CPU，回来再继续。
    if (document.hidden) return;
    index = (index + 1) % order.length;
    const incoming = layers[1 - top];
    const outgoing = layers[top];
    incoming.src = order[index];
    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      incoming.style.transition = "opacity " + SLIDE_FADE_MS + "ms ease";
      outgoing.style.transition = "opacity " + SLIDE_FADE_MS + "ms ease";
      incoming.style.opacity = "1";
      outgoing.style.opacity = "0";
      top = 1 - top;
    };
    // 已解码就直接交接；否则等这一张真到位（load 或 error 都算「这一拍该结束了」），
    // 避免慢图把一整拍拖成空白。
    if (incoming.complete && incoming.naturalWidth > 0) commit();
    else {
      incoming.addEventListener("load", commit, { once: true });
      incoming.addEventListener("error", commit, { once: true });
    }
  }
  // 预载第二张：第一拍切过去之前就把它拉下来，首拍才不会空。
  layers[1].src = order[1 % order.length];
}

/**
 * 图内周期改了（设置项 `pictureSlideSeconds`）：把当前这张图上的过场层原地重装。
 * 图片档的层键只有 type+url，改设置不会触发 syncLayers 重建，所以这里显式收尾再装一次
 *（`scheduleImageSlideshow` 的缓存按 `id@周期` 分桶，新周期必然是冷取）。
 */
function refreshImageSlideshow(sel) {
  if (!sel || sel.type !== "image" || typeof sel.slidesUrl !== "string" || sel.slidesUrl === "") return;
  const current = activeImageSlideshow;
  if (!current) return;
  current.stop();
  if (current.media && current.media.isConnected) scheduleImageSlideshow(current.media, sel);
}

// ── Occlusion pause (遮挡暂停, WE-style) ────────────────────────────────────
// Desktop Wallpaper Engine pauses rendering whenever the wallpaper is covered
// — the main reason its GPU load is ~0 most of the time. Browsers cannot
// detect window occlusion directly, so we use the two closest proxies:
// document.hidden (minimized / tab switched away) and window focus loss
// (another app took the foreground; the wallpaper is likely covered). Pausing
// the <video> stops decode entirely (rVFC stops → decode engine → 0); on
// restore, the effective playing state resumes automatically unless the user
// manually paused. Web/iframe wallpapers cannot be paused from outside — they
// are only throttled by the browser while the page is hidden.
export {
  applySelection, buildMedia, beginRotationPrepare, prepareLiveTimeouts,
  clearPrepareLiveTimeout, refreshImageSlideshow,
};
