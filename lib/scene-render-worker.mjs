// 场景帧渲染 worker: 把 SceneRenderer 的同步 CPU 渲染移到 worker 线程,
// 避免阻塞 DSH 主进程事件循环 (大型壁纸渲染数秒~数十秒).
// 支持单帧 (time) 与多帧动画 (times 数组 → APNG; fmt=mp4/rawVideo 时 → raw RGBA 帧)。
import { parentPort, workerData } from 'node:worker_threads';
import { SceneRenderer, encodePng } from './scene-renderer.js';
import { encodeApng, encodeIdat } from './apng-encode.js';

const { src, width, height, time, times, weAssetsDir, frameDelayMs, videoFrames, fmt, rawVideo } = workerData;

// P2-14: raw 帧模式 (fmt=mp4 / 调用方显式 rawVideo:true) — 视频合成路径的
// 中间 APNG 全程多余: 每帧 encodeIdat 的 deflateSync(level6) 编码, 宿主端
// ffmpeg 再把 PNG 解回 RGBA。raw 模式改为逐帧直接 postMessage RGBA 原始
// 字节, 由宿主 pipe 给 ffmpeg stdin (-f rawvideo), 不做任何压缩/封装。
const rawMode = rawVideo === true || fmt === 'mp4';

// 契约 C1 (为 Wave 3 CPU degraded 通道铺路): SceneRenderer 支持
// opts.onDegraded({object, feature, action}) 时收集降级事件, 随最终结果
// postMessage 上浮 (msg.degraded, 结构与 GL gate 的 degraded 清单一致)。
// 特性探测是隐式的 — 把收集器传进 opts 即可: 渲染器没有该能力时忽略未知
// opt → 列表恒空 → 不随消息发送 (静默, 不影响现有行为)。
const degradedEvents = [];
const collectDegraded = (e) => {
  if (degradedEvents.length < 200 && e && typeof e === 'object') degradedEvents.push(e);
};

// 空白帧门禁阈值 (P-15 复核定案): 与 clearcolor 差异采样 < 0.1% 视为空白。
// 实测 7 张场景壁纸 (§9.5 同一批, 640×360 同款采样): 6 张有实际渲染内容的
// diff 比例为 86.6%~99.6% (3113554287 恰为 0.00% — 其 4 张主纹理是内嵌
// mp4 的 tex, 静态解码失败后只剩 clearcolor, 门禁按设计拦截回退), 全部
// 距阈值 3 个数量级以上、无人落在 0.05%~0.1% 区间 → 按"全部 >5× 阈值则
// 放宽到 0.1%"定案放宽一倍, 为深色合法场景 (近纯色夜空/暗场) 留余量。
const BLANK_DIFF_RATIO = 0.001;

// 逐帧对 clearcolor 的采样 diff 计数 (与单帧模式同一套数学: 每 8px 采样,
// 任一通道差 >24 记一次), 顺带把采样点 RGB 收进 cur 供帧间比较。
function sampleBlankStats(canvas, cr0, cg0, cb0, cur) {
  const step = 8;
  let diff = 0;
  let checked = 0;
  for (let y = 0; y < canvas.h; y += step) {
    for (let x = 0; x < canvas.w; x += step) {
      const i = (y * canvas.w + x) * 4;
      checked++;
      const r = canvas.data[i];
      const g = canvas.data[i + 1];
      const b = canvas.data[i + 2];
      if (Math.abs(r - cr0) > 24 || Math.abs(g - cg0) > 24 || Math.abs(b - cb0) > 24) diff++;
      if (cur) cur.push(r, g, b);
    }
  }
  return { diff, checked };
}

try {
  // 单帧模式 (静态帧缓存)
  if (!times || !times.length) {
    const renderer = new SceneRenderer(src, { width, height, time, weAssetsDir, videoFrames, log: () => {}, onDegraded: collectDegraded });
    const canvas = renderer.render();
    // 空帧门禁统计: 与 clearcolor 差异 < 阈值比例视为空白 (宿主 route 判定)
    const cc = renderer.scene && renderer.scene.general && renderer.scene.general.clearcolor;
    const ccv = typeof cc === 'string' && cc.trim() ? cc.trim().split(/\s+/).map(Number) : [0, 0, 0];
    const cr0 = (ccv[0] || 0) * 255, cg0 = (ccv[1] || 0) * 255, cb0 = (ccv[2] || 0) * 255;
    const { diff, checked } = sampleBlankStats(canvas, cr0, cg0, cb0, null);
    const png = encodePng(canvas.w, canvas.h, canvas.data);
    const msg = { ok: true, png, diff, checked };
    if (degradedEvents.length) msg.degraded = degradedEvents;
    // 不走 transfer list: encodePng 的 Buffer 常落在 node 分配池的共享
    // ArrayBuffer 上 (小 PNG/近空白帧必中), transfer 直接抛
    // "Cannot transfer object of unsupported type" → 整帧 ok:false。
    // 结构化克隆一次拷贝代价相对 CPU 渲染可忽略。
    parentPort.postMessage(msg);
  } else {
    // 多帧模式: 复用单个 SceneRenderer (每帧只换 time), 避免每帧重读 pkg/重解码纹理
    // (大型 pkg 如 336MB 场景, 逐帧重建 = 每帧整包读取 + 全部纹理解码)
    // 传 times → staticFrame=false → 动画启用效果降采样加速 (sf38); 静态帧不降采样
    const renderer = new SceneRenderer(src, { width, height, time: times[0], times, weAssetsDir, videoFrames, log: () => {}, onDegraded: collectDegraded });
    const frames = [];
    const total = times.length;
    // 空白门禁统计 (P-03, 与单帧/scene-frame 同语义): 每帧对 clearcolor 采样
    // diff, 另存首帧采样快照比较帧间变化。全部帧近空白 → 纯色/黑帧被当有效
    // 动画下发; 全零帧间变化 → 渲染异常/静态场景误入动画路径, 同样 ok:false
    // (由下方 throw → 外层 catch 统一回 { ok:false, error })。
    const cc = renderer.scene && renderer.scene.general && renderer.scene.general.clearcolor;
    const ccv = typeof cc === 'string' && cc.trim() ? cc.trim().split(/\s+/).map(Number) : [0, 0, 0];
    const cr0 = (ccv[0] || 0) * 255, cg0 = (ccv[1] || 0) * 255, cb0 = (ccv[2] || 0) * 255;
    let minDiff = Infinity; // 全部帧中对 clearcolor 的最小 diff 计数
    let maxFrameDelta = 0; // 后续帧相对首帧的最大变化采样数
    let checkedTotal = 0;
    let firstSample = null;
    for (let i = 0; i < total; i++) {
      renderer.setTime(times[i]);
      const canvas = renderer.render();
      if (rawMode) {
        // P2-14: raw 模式逐帧直传 RGBA (结构化克隆一次拷贝; 同样不走 transfer
        // list — canvas.data 是渲染器跨帧复用的缓冲, 不可 transfer, 见单帧
        // 分支注释)。发出后不持有引用, worker 内存峰值不随帧数增长。
        parentPort.postMessage({ frame: true, index: i, rgba: canvas.data });
      } else {
        // 立即压缩 → 释放原始帧 (4K 多帧峰值: 全帧 rgba 可达数 GB; 压缩后仅存 IDAT)
        frames.push({ idat: encodeIdat(width, height, canvas.data), delayMs: frameDelayMs || 100 });
      }
      const cur = [];
      const { diff, checked } = sampleBlankStats(canvas, cr0, cg0, cb0, cur);
      checkedTotal = checked;
      if (diff < minDiff) minDiff = diff;
      if (firstSample) {
        let d = 0;
        for (let k = 0; k + 2 < firstSample.length; k += 3) {
          if (Math.abs(cur[k] - firstSample[k]) > 24
            || Math.abs(cur[k + 1] - firstSample[k + 1]) > 24
            || Math.abs(cur[k + 2] - firstSample[k + 2]) > 24) d++;
        }
        if (d > maxFrameDelta) maxFrameDelta = d;
      } else {
        firstSample = cur;
      }
      // 逐帧进度上报 (宿主 scene-anim 渲染进度条)。
      // 契约注释 (P-11): progress 消息只是进度通知, 不是结果 — 宿主即使没有
      // onProgress 也绝不能把它误判为渲染失败; 唯一的结果消息带 ok 字段。
      parentPort.postMessage({ progress: true, done: i + 1, total });
    }
    // P-03 门禁: 全部帧近空白 (对 clearcolor 的最小 diff 低于阈值比例), 或
    // 全部帧与首帧零变化 → 动画无效, ok:false 让宿主走静态帧/回退链。
    if (checkedTotal > 0 && minDiff < checkedTotal * BLANK_DIFF_RATIO) {
      throw new Error('blank animation (all frames near clearcolor)');
    }
    if (total >= 2 && maxFrameDelta === 0) {
      throw new Error('static animation (no inter-frame change)');
    }
    if (rawMode) {
      // P2-14: raw 模式不打包 APNG (帧已逐条流出); ok 消息仅作收尾信号。
      const msg = { ok: true, raw: true };
      if (degradedEvents.length) msg.degraded = degradedEvents;
      parentPort.postMessage(msg); // 同单帧: 池化缓冲不可 transfer, 走克隆
    } else {
      const apng = encodeApng(width, height, frames);
      const msg = { ok: true, apng };
      if (degradedEvents.length) msg.degraded = degradedEvents;
      parentPort.postMessage(msg); // 同单帧: 池化 ArrayBuffer transfer 会抛错, 走克隆
    }
  }
} catch (e) {
  const msg = { ok: false, error: String(e && e.message ? e.message : e) };
  if (degradedEvents.length) msg.degraded = degradedEvents;
  parentPort.postMessage(msg);
}
