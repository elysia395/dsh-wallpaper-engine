// 场景帧渲染 worker: 把 SceneRenderer 的同步 CPU 渲染移到 worker 线程,
// 避免阻塞 DSH 主进程事件循环 (大型壁纸渲染数秒~数十秒).
// 只支持单帧 (time → 静态帧 PNG); 多帧动画 (scene-anim) 已随方向调整移除.
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
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// fork 子进程 (系统 Node): 无 parentPort → 走 process.send/on('message');
// worker_threads 模式: parentPort 存在 (纯 Node 宿主回退)。
const viaFork = typeof parentPort === 'undefined' || parentPort === null;

// ── fork 模式 workerData 消息 (顶层 await 链) ──
// dawn.node 在 fork 子进程里 dispatch 必须挂在模块顶层 await 上执行, 否则
// 原生崩溃 (0xC0000005)。因此 fork 模式把"等待 workerData → run()"整体放进
// 顶层 await 链: 消息监听在模块求值早期注册 (Dawn 块期间到达的消息不丢),
// 求值末尾 await 该 promise → run() 的整个异步链挂到顶层 await。
// worker_threads 模式不走此路径 (workerData 直接可用, 且不启用 Dawn)。
const workerDataPromise = viaFork
  ? new Promise((res) => {
      process.on('message', (m) => { if (m && m.__workerData) res(m.__workerData); });
    })
  : null;

// ── P4b: Dawn 预计算 (DSH_WE_DAWN=1, 仅 fork 模式) ──
// 设备必须在模块顶层直接 await 创建 + 后续 dispatch 全部经顶层 await 链 —
// dawn.node 绑定在 fork 子进程内, 游离于顶层 await 之外的 dispatch (事件回调 /
// fire-and-forget 微任务链) 会原生崩溃 (0xC0000005)。验证: fork-step-repro /
// fork-file-child (顶层 await 挂起 OK; runFn().catch() 崩)。
// 注意 precompute 内部**不得**再调用 getDawnDevice() 创建第二设备 (第二设备的
// 首个 dispatch 同样原生崩溃) — 顶层设备以 extDevice 传入。
let _dawnExtDevice = null;
if (viaFork && process.env.DSH_WE_DAWN === '1') {
  try {
    const modPath = process.env.DSH_WE_DAWN_MODULE || 'webgpu';
    const dawnMod = await import(pathToFileURL(modPath).href);
    Object.assign(globalThis, dawnMod.globals);
    const gpu0 = dawnMod.create([]);
    const adapter0 = await gpu0.requestAdapter();
    const dev = await adapter0.requestDevice();
    // 绑定初始化预热: 本设备首个 dispatch 前先跑一个 1×1 compute (对齐
    // backend.getDawnDevice), 避免 dawn.node 未初始化状态下的原生崩溃。
    try {
      const G = dawnMod.globals;
      const warmOut = dev.createBuffer({ size: 4, usage: G.GPUBufferUsage.STORAGE | G.GPUBufferUsage.COPY_SRC });
      const warmShader = dev.createShaderModule({
        code: '@group(0) @binding(0) var<storage, read_write> out: array<u32>; @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3<u32>) { out[0] = 0u; }',
      });
      const warmLayout = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: G.GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] });
      const warmBg = dev.createBindGroup({ layout: warmLayout, entries: [{ binding: 0, resource: { buffer: warmOut } }] });
      const warmPipe = dev.createComputePipeline({ layout: dev.createPipelineLayout({ bindGroupLayouts: [warmLayout] }), compute: { module: warmShader, entryPoint: 'main' } });
      const warmEnc = dev.createCommandEncoder();
      const warmPass = warmEnc.beginComputePass();
      warmPass.setPipeline(warmPipe);
      warmPass.setBindGroup(0, warmBg);
      warmPass.dispatchWorkgroups(1, 1, 1);
      warmPass.end();
      dev.queue.submit([warmEnc.finish()]);
      await dev.queue.onSubmittedWorkDone();
    } catch { /* 预热失败不影响 — 后续调用会再失败回退 CPU */ }
    _dawnExtDevice = dev;
    gpuDiag('Dawn 设备已创建 (extDevice, 顶层)');
  } catch (e) {
    gpuDiag('Dawn 设备创建失败:', e && e.message);
    _dawnExtDevice = null;
  }
}

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
  const { src, width, height, time, weAssetsDir, videoFrames, gpuAccel } = workerData;
  const renderOpts = { width, height, time, weAssetsDir, videoFrames, gpuAccel: gpuAccel === true, log: () => {} };
  gpuDiag('render 开始 gpuAccel=', renderOpts.gpuAccel, 'src=', src, 'w=', width, 'h=', height);
  const t0 = Date.now();

  try {
    const renderer = new SceneRenderer(src, renderOpts);
    // P4b: Dawn 预计算 (DSH_WE_DAWN=1 + 顶层 extDevice 可用) — 异步预渲染
    // 支持的效果到缓存, render() 同步命中 (runEffectPasses 检查 _dawnEffectCache)。
    // 设备已在模块顶层创建 — precompute 以 extDevice 传入, 内部绝不二次创建设备。
    if (_dawnExtDevice) {
      try {
        gpuDiag('Dawn 预计算开始');
        const { precomputeEffectsDawn } = await import('./we-renderer/gpu-dawn/backend.js');
        const cache = await precomputeEffectsDawn(renderer, time, _dawnExtDevice);
        gpuDiag('Dawn 预计算完成, 缓存对象数=', cache ? cache.size : 0);
        if (cache) renderer._dawnEffectCache = cache;
      } catch (e) {
        gpuDiag('Dawn 预计算失败:', e && e.message);
      }
    }
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
    // 脚本运行时错误诊断 (根因 A): 渲染成功但脚本失败 → 内容错, 不再不可见
    if (renderer._scriptErrors && renderer._scriptErrors.length) {
      gpuDiag('脚本错误(' + renderer._scriptErrors.length + '):', renderer._scriptErrors.slice(0, 5).join(' | '));
    }
    gpuDiag('单帧完成 ms=', Date.now() - t0, 'gpuBackend=', renderer._getGpuBackend ? !!renderer._getGpuBackend() : 'n/a');
    // 单帧 PNG (4K 可达 10-30MB) 走文件传输 (避免 IPC 大消息)
    const pngTmp = join(tmpdir(), 'dsh-we-png-' + process.pid + '-' + Date.now() + '.png');
    const fsp = await import('node:fs/promises');
    await fsp.writeFile(pngTmp, png);
    post({ ok: true, pngPath: pngTmp, width, height, diff, checked });
    await waitAck();
    releaseGpu(renderer);
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
  // fork 模式: 顶层 await 链 (Dawn dispatch 必须挂在顶层 await 上, 否则原生
  // 崩溃)。workerDataPromise 已注册监听 (Dawn 块期间到达的消息不丢)。
  try {
    const wd = await workerDataPromise;
    await run(wd);
    // IPC channel 保持进程存活 — run 完成后主动退出 (宿主 finish 也会
    // kill, 但主动退出避免挂起 + 双保险)
    setTimeout(() => process.exit(0), 100);
  } catch (e) {
    gpuDiag('worker 顶层流程失败:', e && e.message);
    process.exit(1);
  }
} else {
  // worker_threads 模式: workerData 直接可用 (不启用 Dawn, 回退 CPU)
  run(wdWorkerData);
}
