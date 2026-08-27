// 场景帧渲染 worker: 把 SceneRenderer 的同步 CPU 渲染移到 worker 线程,
// 避免阻塞 DSH 主进程事件循环 (大型壁纸渲染数秒~数十秒).
// 支持单帧 (time) 与多帧动画 (times 数组 → APNG).
// GPU 效果加速 (sf40h): gpuAccel=true 且 x64 + supreium-headless-gl
// 可用时, 内置效果/GLSL 效果走 WebGL (ANGLE) 执行, 失败自动回退 CPU。
// 全分辨率无降采样 (无马赛克).
//
// 双运行模式 (sf41): DSH 宿主是 Electron (ABI 148), supreium-headless-gl
// 的 prebuilds 只有 Node ABI (93/108/115/127/137/147) → node-gyp-build 在
// Electron 里报 No native build found → GPU 后端不可用 → 全 CPU 无加速。
// 因此渲染 worker 由宿主用 **系统 Node 子进程** (child_process.fork +
// execPath=系统 node, ABI 127) 启动, 而非 Electron worker_threads。
// 两种模式共用本脚本:
//   - fork 模式: 无 parentPort, workerData 由宿主先 send({__workerData})
//   - worker_threads 模式: parentPort + workerData (纯 Node 宿主回退)
import { parentPort, workerData as wdWorkerData } from 'node:worker_threads';
import { SceneRenderer, encodePng } from './scene-renderer.js';
import { encodeApng, encodeIdat } from './apng-encode.js';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

// fork 子进程 (系统 Node): 无 parentPort → 走 process.send/on('message');
// worker_threads 模式: parentPort 存在 (纯 Node 宿主回退)。
const viaFork = typeof parentPort === 'undefined' || parentPort === null;

// sf41 诊断: 与宿主同写 ~/.dsh-wallpaper-engine/gpu-diag.log (异步, 不阻塞渲染)
let _gpuDiagBuf = [];
let _gpuDiagTimer = null;
function gpuDiag(...args) {
  try {
    const line = new Date().toISOString() + ' [worker] ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
    _gpuDiagBuf.push(line);
    if (!_gpuDiagTimer) {
      _gpuDiagTimer = setTimeout(() => {
        _gpuDiagTimer = null;
        const lines = _gpuDiagBuf.join('');
        _gpuDiagBuf = [];
        try {
          const p = join(homedir(), '.dsh-wallpaper-engine', 'gpu-diag.log');
          import('node:fs/promises').then((fsp) => fsp.writeFile(p, lines, { flag: 'a' })).catch(() => {});
        } catch { /* ignore */ }
      }, 200);
    }
  } catch { /* ignore */ }
}
gpuDiag('worker 启动 viaFork=', viaFork, 'node=', process.version, 'modules=', process.versions.modules, 'electron=', process.versions.electron || 'none');
// 诊断: 记录可能影响 node-gyp-build 判定的 env 变量 + 探测 supreium 可加载性
// (非阻塞: 不 await, 不延迟消息处理)
try {
  const sus = {};
  for (const k of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR', 'NODE_OPTIONS', 'ELECTRON_INTERNAL_USE_ONLY', 'CHROME_CRASHPAD_PIPE_NAME']) {
    if (process.env[k] !== undefined) sus[k] = String(process.env[k]).slice(0, 60);
  }
  gpuDiag('env 可疑变量:', sus);
  import('./we-renderer/gpu-gl/gl-core.js').then(({ getWebGL }) => {
    try { gpuDiag('getWebGL(force) =', getWebGL(true) !== null); } catch (e) { gpuDiag('getWebGL 探测异常:', e.message.slice(0, 100)); }
  }).catch((e) => gpuDiag('gl-core import 失败:', e.message.slice(0, 80)));
} catch (e) {
  gpuDiag('env 诊断异常:', e.message.slice(0, 80));
}

function post(msg, transfer) {
  if (viaFork) process.send(msg);
  else parentPort.postMessage(msg, transfer || []);
}

async function run(workerData) {
  const { src, width, height, time, times, weAssetsDir, frameDelayMs, videoFrames, gpuAccel, framesDir } = workerData;
  const renderOpts = { width, height, time, times, weAssetsDir, videoFrames, gpuAccel: gpuAccel === true, log: () => {} };
  gpuDiag('render 开始 gpuAccel=', renderOpts.gpuAccel, 'src=', src, 'w=', width, 'h=', height, 'times=', times ? times.length : 0);
  const t0 = Date.now();

  try {
    // 单帧模式 (静态帧缓存)
    if (!times || !times.length) {
      const renderer = new SceneRenderer(src, renderOpts);
      const canvas = renderer.render();
      // 空帧门禁统计: 与 clearcolor 差异 < 0.05% 视为空白
      const cc = renderer.scene && renderer.scene.general && renderer.scene.general.clearcolor;
      const ccv = typeof cc === 'string' && cc.trim() ? cc.trim().split(/\s+/).map(Number) : [0, 0, 0];
      const cr0 = (ccv[0] || 0) * 255, cg0 = (ccv[1] || 0) * 255, cb0 = (ccv[2] || 0) * 255;
      const step = 8;
      let diff = 0, checked = 0;
      for (let y = 0; y < canvas.h; y += step) {
        for (let x = 0; x < canvas.w; x += step) {
          const i = (y * canvas.w + x) * 4;
          checked++;
          if (Math.abs(canvas.data[i] - cr0) > 24 || Math.abs(canvas.data[i + 1] - cg0) > 24 || Math.abs(canvas.data[i + 2] - cb0) > 24) diff++;
        }
      }
      const png = encodePng(canvas.w, canvas.h, canvas.data);
      gpuDiag('单帧完成 ms=', Date.now() - t0, 'gpuBackend=', renderer._getGpuBackend ? !!renderer._getGpuBackend() : 'n/a');
      // 单帧 PNG (4K 可达 10-30MB) 也走文件传输 (与多帧一致, 避免 IPC 大消息)
      const pngTmp = join(tmpdir(), 'dsh-we-png-' + process.pid + '-' + Date.now() + '.png');
      const fsp = await import('node:fs/promises');
      await fsp.writeFile(pngTmp, png);
      post({ ok: true, pngPath: pngTmp, width, height, diff, checked });
      await waitAck();
      releaseGpu(renderer);
    } else {
      // 多帧模式: 复用单个 SceneRenderer (每帧只换 time), 避免每帧重读 pkg/重解码纹理
      // (大型 pkg 如 336MB 场景, 逐帧重建 = 每帧整包读取 + 全部纹理解码)
      // 传 times → staticFrame=false → 动画全分辨率 (无降采样, sf40f; GPU 加速见上)
      const renderer = new SceneRenderer(src, renderOpts);
      const total = times.length;
      const fsp = await import('node:fs/promises');
      if (framesDir) {
        // PNG 帧序列管线 (sf41h): 不打包 APNG — 每帧渲染为独立 PNG 文件,
        // 宿主 ffmpeg 用 image2 直读目录合成视频。省掉 1080p APNG 数百 MB
        // 的一次性打包内存 (encodeApng Buffer.concat) 与宿主读回/重写大文件
        // (1080p APNG 419MB 曾致 ffmpeg 合成慢/失败 → 被迫降 720p)。
        // 中间格式为无损 PNG → 最终视频画质零损失, 可恢复全分辨率。
        for (let i = 0; i < total; i++) {
          renderer.setTime(times[i]);
          const canvas = renderer.render();
          const png = encodePng(width, height, canvas.data);
          await fsp.writeFile(join(framesDir, 'frame_' + String(i + 1).padStart(4, '0') + '.png'), png);
          // 逐帧进度上报 (宿主 scene-anim 渲染进度条)
          post({ progress: true, done: i + 1, total });
        }
        gpuDiag('多帧完成(帧序列) ms=', Date.now() - t0, 'frames=', total, 'gpuBackend=', renderer._getGpuBackend ? !!renderer._getGpuBackend() : 'n/a');
        // 无大文件回传: 宿主 ffmpeg 直读帧目录, IPC 只传路径 (小消息, 可靠)
        post({ ok: true, frameDir: framesDir, frameCount: total, width, height });
        await waitAck();
        releaseGpu(renderer);
        return;
      }
      const frames = [];
      for (let i = 0; i < total; i++) {
        renderer.setTime(times[i]);
        const canvas = renderer.render();
        // 立即压缩 → 释放原始帧 (4K 多帧峰值: 全帧 rgba 可达数 GB; 压缩后仅存 IDAT)
        frames.push({ idat: encodeIdat(width, height, canvas.data), delayMs: frameDelayMs || 100 });
        // 逐帧进度上报 (宿主 scene-anim 渲染进度条)
        post({ progress: true, done: i + 1, total });
      }
      const apng = encodeApng(width, height, frames);
      gpuDiag('多帧完成 ms=', Date.now() - t0, 'frames=', total, 'gpuBackend=', renderer._getGpuBackend ? !!renderer._getGpuBackend() : 'n/a');
      // 大 APNG 不走 fork IPC (sf41c): 240 帧 1080p APNG 可达数百 MB, IPC
      // 序列化拷贝会阻塞主进程 + 大消息易丢失 (exit 134 / ok 不到) → 写临时
      // 文件, 宿主异步读回。IPC 只传文件路径 (小消息, 可靠)。
      const apngTmp = join(tmpdir(), 'dsh-we-apng-' + process.pid + '-' + Date.now() + '.apng');
      await fsp.writeFile(apngTmp, apng);
      post({ ok: true, apngPath: apngTmp, width, height });
      await waitAck();
      releaseGpu(renderer);
    }
  } catch (e) {
    gpuDiag('render 失败:', e.message);
    post({ ok: false, error: String(e && e.message ? e.message : e) });
    releaseGpu(null);
  }
}

// 等待宿主确认 (sf41c): 进程保持存活等宿主读完临时文件后 send ack, 防 IPC
// 消息在进程退出时丢失 (此前 exit 134 / ok 不到的结果丢失)。
function waitAck() {
  return new Promise((res) => {
    if (!viaFork) { setTimeout(res, 50); return; }
    const timer = setTimeout(() => { gpuDiag('waitAck 超时 15s'); res(); }, 15000); // 兜底
    process.once('message', (m) => {
      if (m && m.__ack) { clearTimeout(timer); gpuDiag('收到 ack'); res(); }
    });
  });
}

// 渲染完成/失败后释放 GPU 纹理 (sf41b 显存泄漏修复):
// 多帧动画 worker 复用单个 SceneRenderer, GL 上下文跨帧存活 — 完成后
// 主动 dispose 释放显存 (进程即将退出, 但显存及时归还避免泄漏感知)。
function releaseGpu() {
  try {
    import('./we-renderer/gpu-gl/gl-effect.js').then((m) => m.disposeGPU()).catch(() => {});
  } catch { /* ignore */ }
}

if (viaFork) {
  // fork 子进程: 宿主先 send workerData
  process.on('message', (m) => {
    if (m && m.__workerData) {
      run(m.__workerData).then(() => {
        // IPC channel 保持进程存活 — run 完成后主动退出 (宿主 finish 也会
        // kill, 但主动退出避免挂起 + 双保险)
        setTimeout(() => process.exit(0), 100);
      }).catch(() => process.exit(1));
    }
  });
} else {
  run(wdWorkerData);
}
