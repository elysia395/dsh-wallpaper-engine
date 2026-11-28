/**
 * occlusion.js — Linux 壳窗遮挡的**客户端轮询器**：宿主 `/occlusion` 快照 → 画布局部
 * 坐标 → postMessage 给 scene-live 渲染页的遮挡桥（`window.__weSetOcclusion`）。
 *
 * ══ 为什么轮询器住在客户端 ════════════════════════════════════════════════════
 * 快照的生产在宿主（lib/occlusion/，1Hz 心跳），但「渲染页在哪」只有客户端知道 ——
 * live iframe 是客户端建的，遮挡桥按 `e.source === window.parent` 认亲。客户端是
 * 唯一能同时摸到两头的角色：轮询宿主（apiJson）+ 投递渲染页（postMessage）。
 *
 * ══ 数据流与变换 ══════════════════════════════════════════════════════════════
 *   宿主快照 rects（自窗客户区像素，原点=壳窗左上）
 *     × scale = innerWidth / own.w        ← 画布 CSS 像素 ÷ 自窗像素
 *     → occluders（canvas-local CSS px）→ {__weLive:1, op:'setOcclusion',
 *       payload:{occluders, epoch, gen}} 投给 frame.contentWindow。
 *   epoch 变化（换了显示坐标系）或降级（rects:null）→ op:'clearOcclusion'（null），
 *   渲染器自动回 run 全速；渲染页没装桥（上游 bundle 未打点/web 壁纸）时投递无害。
 *
 * ══ 不变量 ════════════════════════════════════════════════════════════════════
 *   · **1Hz 与宿主心跳同频**：渲染器对 >3s 陈旧快照自动清遮挡，所以停轮询 = 停功能，
 *     不允许"偶尔发一帧"心态；文档隐藏（visibilitychange）时暂停是唯一例外 ——
 *     隐藏页的渲染器本来就被冻结，恢复可见时立即补一拍。
 *   · **网络失败退避**：连挂 3 次把周期放宽到 5s，成功即回 1Hz（机检 B4）；
 *   · **每拍必投**：即使内容没变也重发（1 消息/秒）——渲染器按「最近一次收到的
 *     payload 时间」判陈旧（>3s 自动清遮挡），同内容抑制会让静止画面饿死自己；
 *   · **浏览器安全**：无 import/require/Node API（build 内联纪律，见
 *     scripts/build-client.mjs INLINE_MODULES）；网络只走 apiJson（零裸 fetch 棘轮）。
 */

var OCCLUSION_POLL_MS = 1000;        // 与宿主心跳同频（渲染器 3s 陈旧线 ⇒ 必须严格 ≤3s）
var OCCLUSION_BACKOFF_MS = 5000;     // 连续失败后的退避周期
var OCCLUSION_BACKOFF_AFTER = 3;     // 连续失败多少次后开始退避

var occlusionTimer = 0;
var occlusionFrame = null;
var occlusionInflight = false;
var occlusionFailures = 0;
var occlusionOnVis = null;           // visibilitychange 监听（启动时武装）

/**
 * 启动轮询（幂等：先停旧的再开新的）。`frame` 是 scene-live iframe；
 * 非 scene 壁纸（web/视频/静态）由调用点（live-layer.startLiveWatch）把关不进来。
 */
function startOcclusionPolling(frame) {
  stopOcclusionPolling();
  occlusionFrame = frame;
  occlusionFailures = 0;
  occlusionOnVis = function () {
    // 隐藏期间渲染页被冻结，无需投递；恢复可见立即补一拍再回到常频。
    if (document.hidden) return;
    occlusionTick();
  };
  document.addEventListener('visibilitychange', occlusionOnVis);
  occlusionTimer = setInterval(occlusionTick, OCCLUSION_POLL_MS);
  occlusionTick();
}

/** 停止轮询并解绑（幂等）。不清渲染页侧遮挡 —— iframe 即将销毁/换源，无需消息。 */
function stopOcclusionPolling() {
  if (occlusionTimer) {
    clearInterval(occlusionTimer);
    occlusionTimer = 0;
  }
  if (occlusionOnVis) {
    document.removeEventListener('visibilitychange', occlusionOnVis);
    occlusionOnVis = null;
  }
  occlusionFrame = null;
  occlusionInflight = false;
  // op 基线一并复位：否则换壁纸后首拍 op 与上一会话终态相同 ⇒ 不留日志，
  // QA 对账在轮换场景丢首条证据。
  occlusionLastOp = null;
}

function occlusionTick() {
  const frame = occlusionFrame;
  if (!frame || !frame.isConnected || occlusionInflight) return;
  if (document.hidden) return; // 隐藏页渲染器冻结；恢复时 visibilitychange 补拍
  const src = String(frame.src || '');
  if (!src || src === 'about:blank') return; // 延迟加载期：还没有渲染页可投递
  let targetOrigin = '*';
  try {
    const o = new URL(src).origin;
    if (o && o !== 'null') targetOrigin = o;
  } catch (e) { /* 畸形 src：保持 '*'，桥按 e.source 认亲 */ }
  occlusionInflight = true;
  Promise.resolve(tryOcclusionFetch())
    .catch(function () { return null; })
    .then(function (snap) {
      occlusionInflight = false;
      // 帧身份校验（而非仅判空）：跨 stop→start 的 in-flight 旧 tick 不得把旧快照
      // 投进已被换掉的 iframe（陈旧数据会覆写共享的看护镜像 ≤1 拍）。
      if (frame !== occlusionFrame) return;
      if (!snap || snap.ok !== 1) {
        // 网络失败退避：连挂 N 次放宽周期；成功即回常频。不投递 —— 渲染器的
        // 3s 陈旧线自会兜底，比乱发 clear 更诚实（旧遮挡还在就别假装没有）。
        // 但**镜像要跟着衰减**：失败 ≥3s 后渲染器已自回 run 全速，镜像若停在
        // true 会让看护豁免 stall/首帧预算（与真实状态单向漂移）。
        occlusionFailures++;
        if (occlusionFailures >= OCCLUSION_BACKOFF_AFTER) {
          if (occlusionFailures === OCCLUSION_BACKOFF_AFTER) {
            clearInterval(occlusionTimer);
            occlusionTimer = setInterval(occlusionTick, OCCLUSION_BACKOFF_MS);
          }
          occlusionRendererPause = false;
        }
        return;
      }
      // 处于退避态时成功 ⇒ 恢复常频（setInterval 换周期）。
      const wasBacking = occlusionFailures >= OCCLUSION_BACKOFF_AFTER;
      occlusionFailures = 0;
      if (wasBacking && occlusionTimer) {
        clearInterval(occlusionTimer);
        occlusionTimer = setInterval(occlusionTick, OCCLUSION_POLL_MS);
      }
      deliverOcclusionSnapshot(frame, snap, targetOrigin);
    });
}

/** 宿主快照拉取。失败回 null（含非 2xx）——apiJson 不抛错，形状见 api-client。
 *  2s 看门狗：occlusionInflight 门闩在 fetch settle 前不放行，一个永不结算的请求
 *  （socket 半开、宿主挂起、休眠恢复）会把 1Hz 心跳**永久**饿死 —— 超时按失败计数
 *  走既有退避。AbortSignal 缺失（单测沙箱/老引擎）时退化为无超时，不阻塞功能。 */
function tryOcclusionFetch() {
  const opts = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? { signal: AbortSignal.timeout(2000) }
    : {};
  return apiJson('/occlusion', opts).then(function (res) {
    return res && res.ok ? res.data : null;
  });
}

/**
 * 快照 → 变换 → 幂等投递。核心换算 scale = innerWidth / own.w：
 * 宿主 rects 在「自窗客户区」像素系，画布是 CSS 像素系，live iframe 铺满视口。
 * own 缺失/为零 ⇒ 无法建立坐标系 ⇒ clear（宿主降级态本来就是 rects:null）。
 */
function deliverOcclusionSnapshot(frame, snap, targetOrigin) {
  // 不看 backend 名字：hub 契约里 backend 是开放集合（x11/sway/KDE/GNOME…），
  // own/rects 才是实质判据 —— 硬编码相等会让未来后端被当"无数据"静默清遮挡。
  const hasData = snap.own && snap.own.w > 0
    && Array.isArray(snap.rects);
  if (!hasData) {
    occlusionRendererPause = false; // 无数据 ≠ 遮挡：渲染器自会全速
    deliverOcclusionOp(frame, 'clearOcclusion', null, '', snap.gen, targetOrigin);
    return;
  }
  const scale = (typeof innerWidth === 'number' && innerWidth > 0) ? innerWidth / snap.own.w : 0;
  if (!(scale > 0)) return; // 视口还量不出来（最小化/启动期）：这拍跳过，别投半成品
  const occluders = snap.rects.map(function (r) {
    return [r[0] * scale, r[1] * scale, r[2] * scale, r[3] * scale];
  });
  // 可见率（面积直和口径，宿主坐标）：重叠会高估遮挡 ⇒ 只会偏保守地多判"暂停"，
  // 不会漏判全遮挡；0.05 与渲染器 pause 档阈值同口径。
  const areaOwn = snap.own.w * snap.own.h;
  let areaOcc = 0;
  for (let i = 0; i < snap.rects.length; i++) {
    areaOcc += snap.rects[i][2] * snap.rects[i][3];
  }
  const visible = areaOwn > 0 ? Math.max(0, 1 - areaOcc / areaOwn) : 1;
  occlusionRendererPause = visible <= 0.05;
  deliverOcclusionOp(frame, 'setOcclusion', occluders, snap.epoch, snap.gen, targetOrigin);
}

/**
 * 投递。⚠️ **每拍都发，不做同内容抑制**：渲染器的陈旧判定读的是「最近一次收到的
 * payload 时间」，同内容抑制会让静止画面的 last-update 一路变陈 ⇒ >3s 被渲染器
 * 判陈旧自动清遮挡 —— 恰恰在最需要遮挡（画面没动）的时刻失效。1 消息/秒的成本
 * 远小于这个契约风险。
 */
let occlusionLastOp = null;
// 渲染器侧 pause 档的**客户端镜像**：最近一次成功快照的可见率 ≤ 0.05（与渲染器
// pause 阈值同口径）⇒ 看护心跳必须把这段视作"故意暂停"，否则帧计数会把遮挡暂停
// 误判成 stall/首帧超时，自动回退关闭实时渲染（实测事故：全遮挡下轮播换页必触发）。
let occlusionRendererPause = false;
function occlusionRendererPaused() {
  return occlusionRendererPause;
}
function deliverOcclusionOp(frame, op, occluders, epoch, gen, targetOrigin) {
  try {
    const payload = op === 'setOcclusion' ? { occluders: occluders, epoch: epoch, gen: gen } : null;
    frame.contentWindow.postMessage({ __weLive: 1, op: op, payload: payload }, targetOrigin);
    // QA 契约：客户端每次 op 切换（清↔设）留一行日志，走 liveLog → console +
    // host /diag 环形缓冲。逐拍 setOcclusion 不记录（1Hz 心跳是噪音不是事件）。
    if (op !== occlusionLastOp) {
      occlusionLastOp = op;
      if (typeof liveLog === "function") {
        liveLog("occlusion", function () {
          return "op=" + op + " gen=" + gen +
            " rects=" + (occluders ? occluders.length : "clear");
        }, "info");
      }
    }
  } catch (e) {
    // contentWindow 可能恰好在换源（about:blank 互斥）：丢这一拍，下一跳重发。
  }
}
