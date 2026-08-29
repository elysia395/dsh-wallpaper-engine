/**
 * scene-gl.js — WE 场景壁纸 WebGL2 实时渲染（scene-gl，plan-scene-webgl Phase 1）
 *
 * 本文件由 scripts/build-client.mjs 以 IIFE 形式拼进 client bundle 的同一 factory
 * （附录 §7）：无 import/export 纯脚本片段；禁止声明 module/exports 或与 client.js
 * 顶层重名；末行 return 模块对象。
 *
 * 渲染数学全部经 Phase 0 spike 实测对齐 CPU（docs/plan-scene-webgl-details.md §11）：
 *   - y-down 全链路：纹理不翻转上传（tex 行 0=图顶=CPU v=0）、quad UV 顶边 v=0、
 *     效果 pass MVP y 行取负、present MVP 正常（附录 §3 回写）；
 *   - g_TextureNResolution = lwe 约定 (mip0.w, mip0.h, header.w, header.h)（§11-①）；
 *   - angles：弧度、正角=屏幕 CCW、像素空间刚体旋转 S⁻¹·RotZ·S（§11-②）；
 *   - slot0 CLAMP（跟 CPU）/ slot1+ REPEAT（§11-⑤）；
 *   - ES 1.00 原样编译 + 两条 int 字面量 fixup（附录 §2 回写）。
 *
 * 状态机（附录 §8）：GL_TRY(meta) → GL_INIT(shader 编译先于纹理下载) → GL_RUN
 * → DISPOSED；任一失败 → onError(reason)（调用方标记 glFailed 并回退 mp4）；
 * contextlost → dispose → contextrestored 重建一次 → 再失败回退。
 */

// ---------- 附录 §4：MVP 工具 ----------
// P2-7/N-08: MVP 计算改为写入调用方给定缓冲（无 out 时落模块级复用缓冲），
// 消除旧实现热路径每帧每对象 new Float32Array(16)×2~3；带缓存的调用方
// （构建期 mvpFx / present 按 CW/CH 缓存）必须传独占缓冲，防止共享 scratch
// 被后续计算覆写。
const _WE_GL_MVP_SCRATCH = new Float32Array(16);
const _WE_GL_ZROT_R = new Float32Array(16);
const _WE_GL_ZROT_OUT = new Float32Array(16);
function _weGLQuadMVP(W, H, dx, dy, dw, dh, flipY, out) {
  const cx = dx + dw / 2, cy = dy + dh / 2;
  const sy = flipY ? -2 * dh / H : 2 * dh / H; // 效果 pass: 图顶→NDC−1（y-down 链一致）
  const ty = flipY ? -(1 - 2 * cy / H) : 1 - 2 * cy / H;
  const m = out || _WE_GL_MVP_SCRATCH;
  m[0] = 2 * dw / W; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = sy; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = -1; m[11] = 0;
  m[12] = 2 * cx / W - 1; m[13] = ty; m[14] = 0; m[15] = 1;
  return m;
}
function _weGLMvpWithZRot(m, rad, dw, dh, out) {
  if (!rad) return m;
  const o = out || _WE_GL_ZROT_OUT;
  const r = -rad; // CPU 正角 = 屏幕 CCW（判别实验②实测）
  const c = Math.cos(r), s = Math.sin(r);
  const kx = dw / dh, ky = dh / dw; // 像素空间刚体：S⁻¹·RotZ·S
  const R = _WE_GL_ZROT_R;
  R[0] = c; R[1] = s * kx; R[2] = 0; R[3] = 0;
  R[4] = -s * ky; R[5] = c; R[6] = 0; R[7] = 0;
  R[8] = 0; R[9] = 0; R[10] = 1; R[11] = 0;
  R[12] = 0; R[13] = 0; R[14] = 0; R[15] = 1;
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += m[k * 4 + row] * R[col * 4 + k];
      o[col * 4 + row] = sum;
    }
  return o;
}

// ---------- 附录 §2.1 + Phase 0 回写：define 头拼装 + int 字面量 fixup ----------
function _weGLAssemble(expandedSrc, combosTable, comboValues) {
  if (/^\s*#version/m.test(expandedSrc)) throw new Error('unexpected #version in WE shader');
  let head = '';
  for (const name of Object.keys(combosTable || {})) head += '#define ' + name + ' ' + (comboValues[name] ?? 0) + '\n';
  head += '#define texSample2D texture2D\nprecision highp float;\nprecision highp int;\n';
  const body = expandedSrc
    .replace(/\* 2 - 1\b/g, '* 2.0 - 1.0')            // waterripple.frag n1/n2（官方编译器宽松放行）
    .replace(/smoothstep\(1 - g_Rough, 1,/, 'smoothstep(1.0 - g_Rough, 1.0,') // iris.vert
    .replace(/M_PI \* 2 \+/, 'M_PI * 2.0 +')          // foliagesway.frag phase
    .replace(/v_Params\.x \* 10 \+/, 'v_Params.x * 10.0 +') // foliagesway.frag phase
    .replace(/v_Params\.y \* 5\)/, 'v_Params.y * 5.0)');   // foliagesway.frag phase
  return head + body + '\n';
}

// 顶点数据（全 pass 共用）：local ±0.5，UV 顶边 v=0（y-down 定案，附录 §3 回写）
const _WE_GL_VERTS = new Float32Array([
  -0.5,  0.5, 0,  0, 0,   // 左上 v=0（图顶）
   0.5,  0.5, 0,  1, 0,   // 右上
  -0.5, -0.5, 0,  0, 1,   // 左下 v=1（图底）
   0.5, -0.5, 0,  1, 1,   // 右下
]);
const _WE_GL_IDX = new Uint16Array([0, 2, 1, 1, 2, 3]);

const _WE_GL_PRESENT_VERT = `
attribute vec3 a_Position; attribute vec2 a_TexCoord;
varying vec2 v_UV; uniform mat4 u_MVP;
void main(){ v_UV = a_TexCoord.xy; gl_Position = u_MVP * vec4(a_Position, 1.0); }
`;
const _WE_GL_PRESENT_FRAG = `
precision highp float;
varying vec2 v_UV; uniform sampler2D u_Tex; uniform float u_ObjectAlpha; uniform float u_Brightness;
void main(){ vec4 c = texture2D(u_Tex, v_UV); gl_FragColor = vec4(c.rgb * u_Brightness, c.a * u_ObjectAlpha); }
`;

const _WE_GL_VERSION = 4; // W2: 通用效果层 (多pass拍平/previous/workshop shader 引用) — 与 host SCENE_GL_ENGINE 同步
const WE_GL_MAX_DIM = 4096; // G-07: 背板/FBO 单边尺寸上限（dpr≤2 × 4K 视口足够）
const WE_GL_RENDER_FATAL_MAX = 5; // G-03: 连续抛错帧数达到即判 fatal 上抛
const WE_GL_FT_CAP = 4096; // N-09: stats.frameTimes 容量上限
const WE_GL_SLOW_WINDOW = 120; // P0-2: render 耗时滑窗帧数（窗口填满 ≈ 慢帧已持续 ≥3s 的帧数近似）
const WE_GL_SLOW_P95_MS = 200; // P0-2: 滑窗 p95 render 耗时阈值（ms），持续超限 → 熔断回退 mp4
function clampGLDim(v) {
  const n = Math.round(Number(v) || 0);
  return Math.max(2, Math.min(WE_GL_MAX_DIM, n));
}

// ---------- P1-3①: WebGL2 一次性预检 + SwiftShader 嗅探 ----------
// 此前 webgl2-unavailable 要到 buildResources（meta+shader 串行 fetch 之后）才
// 暴露，SwiftShader/llvmpipe 软渲染更是要到运行期才以 1fps 灾难形态显形。这里
// 模块级只探一次：失败（无 webgl2 / 软渲染器）→ sessionStorage 全局标记 + 返回
// 失败原因，调用方直接走 onError 降级（mp4），本会话不再进入 meta/shader fetch。
// sessionStorage 读全部裹 try/catch（隐私模式会抛）。
const WE_GL_PROBE_FAIL_KEY = 'weSceneGLProbeFailed';
const WE_GL_SW_RENDERER_RE = /swiftshader|llvmpipe|software/i;
let _weGLProbeResult; // undefined=未测；true=通过；string=失败原因（sessionStorage 命中时复用旧因）
function weGLPreflight() {
  if (_weGLProbeResult !== undefined) return _weGLProbeResult;
  try {
    const prev = sessionStorage.getItem(WE_GL_PROBE_FAIL_KEY);
    if (prev) { _weGLProbeResult = prev; return prev; } // 本会话已判定失败 → 短路（连 probe canvas 都不建）
  } catch { /* 隐私模式：跳过会话标记，仍现场探测 */ }
  let reason = '';
  try {
    const g = document.createElement('canvas').getContext('webgl2');
    if (!g) {
      reason = 'webgl2-unavailable';
    } else {
      // 成功路径嗅探渲染器：UNMASKED_RENDERER 命中软栅格化（SwiftShader/llvmpipe
      // /software）→ 同样降级（软渲染灾难路径）。嗅探本身失败不阻断（按硬件 GL 放行）。
      try {
        const ext = g.getExtension('WEBGL_debug_renderer_info');
        const renderer = ext ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
        if (renderer && WE_GL_SW_RENDERER_RE.test(renderer)) reason = 'software-renderer:' + renderer.slice(0, 80);
      } catch { /* */ }
      try { const lose = g.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch { /* 探测完即释放 */ }
    }
  } catch (e) {
    reason = 'webgl2-probe:' + (e && e.message ? e.message : e);
  }
  if (reason) {
    try { sessionStorage.setItem(WE_GL_PROBE_FAIL_KEY, reason); } catch { /* 隐私模式 */ }
    _weGLProbeResult = reason;
    return reason;
  }
  _weGLProbeResult = true;
  return true;
}

/**
 * 创建场景 GL 渲染器。
 * opts: { token, width, height, fpsCap, onReady, onError }
 *   width/height = 视口预算像素（调用方按 dpr 算好）；canvas 背板在 meta 到达后
 *                 按场景 ortho 比例修正（sar fix，视口不一致时 CSS object-fit letterbox）
 *   onReady()    首帧渲染完成（调用方此刻才显示 canvas + 淡出底图 img）
 *   onError({reason, permanent})  任一失败（调用方标记 glFailed 回退 mp4；
 *                 含 G-03: 连续 N 帧渲染抛错 → 'render-fatal:...' 上抛）
 * 返回 { canvas, dispose(), stats(), setPaused(), setFpsCap(), setPlaybackRate(),
 *        degraded(), resize(w,h) }。
 */
function createSceneGLRenderer(opts) {
  const token = opts.token;
  let CW = clampGLDim(opts.width); // G-07: 创建期即 clamp（超限输入防背板/FBO 分配失败）
  let CH = clampGLDim(opts.height);
  let fpsCap = Math.max(0, Number(opts.fpsCap) || 0); // 0 = 不限
  const onReady = typeof opts.onReady === 'function' ? opts.onReady : () => {};
  const onError = typeof opts.onError === 'function' ? opts.onError : () => {};
  const BASE = '/wallpaper-engine';
  const resUrl = (p) => BASE + '/scene-resource/' + token + '/' + p.split('/').map(encodeURIComponent).join('/');

  const canvas = document.createElement('canvas');
  canvas.width = 2; // 背板尺寸在 meta 到达后按场景 ortho 比例确定（sar fix）
  canvas.height = 2;
  canvas.className = 'we-gl-canvas';

  let state = 'GL_TRY';
  let disposed = false;
  let readyFired = false;
  let paused = false; // 用户暂停/遮挡暂停（调用方 setPaused）
  let playbackRate = 1;
  let rateBase = 0;  // 播放速率时间基：t = rateBase + (now − wallBase)/1000 × rate
  let wallBase = 0;
  let gl = null;
  const ctrl = new AbortController();
  // E2E/诊断钩子（验收 3/4 读取）：帧时环形缓冲 + contextlost 计数
  const stats = { state: () => state, frames: 0, frameTimes: [], contextLost: 0, errors: [], lastT: 0, initStage: 'meta', renderFails: 0 };
  const pushFrameTime = (ms) => {
    // N-09: 旧实现在超 4096 后每帧 splice(0,1) O(n)。读方语义要求 frameTimes
    // 恒为 oldest→newest 有序真数组（index.html 取 ft[len-1]=最新；gui-e2e.py
    // 会外部 length=0 清空后重灌 + slice()），原地环形覆盖会破坏这两条，故改为
    // 攒批削半：写满 1.5×cap 才一次 splice 削回 cap，摊还 O(1)/帧。
    const ft = stats.frameTimes;
    ft.push(ms);
    if (ft.length >= WE_GL_FT_CAP + (WE_GL_FT_CAP >> 1)) ft.splice(0, ft.length - WE_GL_FT_CAP);
  };
  // P0-2: render 耗时滑窗熔断 — pushFrameTime 记的是 rAF 间隔（含浏览器节流/
  // 合帧，非渲染成本），慢帧判定必须量 render() 本身。窗口填满（=慢帧已持续
  // 数秒的帧数近似）且 p95 超阈 → onError({reason:'slow', permanent:false})
  // 只触发一次，客户端 markSceneGLFailed + queueSceneAnimUpgrade 现有链零改动接住。
  const renderMsRing = new Float64Array(WE_GL_SLOW_WINDOW);
  let renderMsN = 0, renderMsHead = 0, slowFired = false;
  const pushRenderTime = (ms) => {
    renderMsRing[renderMsHead] = ms;
    renderMsHead = (renderMsHead + 1) % WE_GL_SLOW_WINDOW;
    if (renderMsN < WE_GL_SLOW_WINDOW) renderMsN++;
    if (slowFired || renderMsN < WE_GL_SLOW_WINDOW) return; // 窗口未填满不判定（防开机抖动误熔断）
    const sorted = Array.from(renderMsRing).sort((a, b) => a - b); // 120 个数/帧，排序成本可忽略
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    if (p95 > WE_GL_SLOW_P95_MS) {
      slowFired = true; // fail → dispose 停循环，天然只触发一次；此为双保险
      try { console.warn('[scene-gl] render p95=' + Math.round(p95) + 'ms 超过 ' + WE_GL_SLOW_P95_MS + 'ms 阈值，慢帧熔断降级'); } catch { /* console 不可用 */ }
      fail('slow', false);
    }
  };

  // G-05: 渲染器本地降级记录 — 与 host gate 的 mark / CPU C1 结构对齐
  // {object, feature, action}（object=null 表示场景级），经 degraded() 与 host
  // 清单合并上浮给客户端提示条（对象名不丢）。
  const degradedLocal = [];
  const mark = (object, feature, action) => degradedLocal.push({ object, feature, action });
  // G-07: viewport clamp 只 mark 一次（resize/dpr 变化会反复触发，防清单刷屏）
  let viewportClampMarked = Math.round(Number(opts.width) || 0) > CW || Math.round(Number(opts.height) || 0) > CH;
  if (viewportClampMarked) mark(null, 'viewport', '渲染尺寸超限，已 clamp 到 ' + WE_GL_MAX_DIM);
  const noteViewportClamp = (w, h) => {
    if (viewportClampMarked) return;
    if (Math.round(Number(w) || 0) > WE_GL_MAX_DIM || Math.round(Number(h) || 0) > WE_GL_MAX_DIM) {
      viewportClampMarked = true;
      mark(null, 'viewport', '渲染尺寸超限，已 clamp 到 ' + WE_GL_MAX_DIM);
    }
  };

  const fail = (reason, permanent) => {
    if (disposed) return;
    stats.errors.push(String(reason));
    dispose();
    onError({ reason: String(reason), permanent: permanent !== false });
  };
  const fetchJson = async (url, timeoutMs) => {
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
    try {
      const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!resp.ok) throw new Error(url + ' → ' + resp.status);
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  };
  const fetchBlob = async (url, timeoutMs) => {
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
    try {
      const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!resp.ok) throw new Error(url + ' → ' + resp.status);
      return await resp.blob();
    } finally {
      clearTimeout(timer);
    }
  };

  // ---- GL 资源（rebuild 时整体重建）----
  let res = null; // { vbo, ibo, programs:[{prog,uniforms}], presentProg, fboA, fboB, textures:[] }
  let rafId = 0;
  let running = false;
  let lastNow = 0;
  let fpsAcc = 0;
  let hiddenListener = null;
  let observer = null;
  let meta = null;
  let shaderMeta = null; // dir → { combos, uniforms, textures, vert, frag }
  let geo = null; // 场景级 { clearcolor:[r,g,b,a] }（对象几何/MVP 缓存在 res.objects[].geo，P2-7）

  function compileShader(type, src, label) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(label + ' compile: ' + log);
    }
    return sh;
  }
  function linkProgram(vs, fs, label) {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(label + ' link: ' + log);
    }
    return p;
  }
  let fboClampMarked = false; // G-07: FBO clamp 只 mark 一次（多对象场景防刷屏）
  function makeFBO(w, h) {
    // G-07+N-06: FBO 尺寸上限守卫 — 超大对象纹理（拼接大图/异常 header）clamp
    // 到 4096。两轴取同一缩放比 s=min(1,MAX/w,MAX/h)（等比，保持纵横比）：旧的
    // w/h 各自独立 clamp 会把 8192×4608 压成 4096×4096（16:9→1:1），读 aspect
    // 的效果（foliagesway 等）失真。效果链分辨率轻微下降，优于 FBO 分配失败整链报废
    if (w > WE_GL_MAX_DIM || h > WE_GL_MAX_DIM) {
      const s = Math.min(1, WE_GL_MAX_DIM / w, WE_GL_MAX_DIM / h);
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
      if (!fboClampMarked) {
        fboClampMarked = true;
        mark(null, 'fbo', '对象纹理超限，效果 FBO 已等比 clamp（单边上限 ' + WE_GL_MAX_DIM + '）');
      }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // hw/hh = w/h：lwe 约定 FBO 的 g_TextureNResolution 视为 (w,h,w,h)。
    // 缺了它，链式效果的 slot0 resolution = [w,h,undefined,undefined] → NaN
    // （foliagesway.vert aspect 计算 NaN → 位移方向崩坏；02 场景没踩中只因
    //  waterripple/iris 不读 slot0 resolution）。
    return { fbo, tex, w, h, hw: w, hh: h };
  }
  let glMaxTexSize = 0; // N-07: gl.MAX_TEXTURE_SIZE（buildResources 拿到上下文后取一次）
  function uploadTex(bmp, { repeat, mip }) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // N-07: MAX_TEXTURE_SIZE 守卫 — 源图单边超限（拼接大图/异常包）时 texImage2D
    // 会被 GPU 拒收（INVALID_VALUE → 纹理残缺）；等比降采样到限内（离屏 2D
    // canvas drawImage 缩放）再上传。采样走归一化 UV、FBO 链另有画布预算 clamp，
    // 故 entry 的 w/h 仍记原始尺寸（几何/aspect 不受影响）。
    let src = bmp;
    if (glMaxTexSize > 0 && (bmp.width > glMaxTexSize || bmp.height > glMaxTexSize)) {
      const s = Math.min(1, glMaxTexSize / bmp.width, glMaxTexSize / bmp.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * s));
      c.height = Math.max(1, Math.round(bmp.height * s));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      src = c;
    }
    // 不翻转上传（y-down 定案）：tex 行 0 = PNG 行 0 = 图顶 = CPU v=0
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return tex;
  }

  // 空槽位回退（CPU _texSample(null) = [1,1,1,1] 语义扩展）：
  //  - 默认（opacitymask/noise 等）→ 1×1 白：与 CPU null→白逐位一致
  //  - mode:"flowmask" → 1×1 中灰 (127,127)：官方默认 util/noflow 即中心灰
  //    (0.498→(c-0.498)*2≈0 无位移)，CPU 无 flow 纹理时 fmx=fmy=0 —— 两者
  //    在"缺失"语义下一致；白色会被解读为 +1.004 全图位移（shake MAD 4.2 主因）
  function makeSolidTex(r, g, b) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    return tex;
  }

  function destroyResources() {
    if (!res) return;
    try {
      if (res.vaos) for (const vao of res.vaos.values()) gl.deleteVertexArray(vao); // P2-7: VAO 随程序释放
      if (res.progCache) for (const e of res.progCache.values()) gl.deleteProgram(e.prog);
      if (res.presentProg) gl.deleteProgram(res.presentProg);
      for (const o of res.objects || []) {
        for (const f of [o.fboA, o.fboB]) {
          if (f) { gl.deleteFramebuffer(f.fbo); gl.deleteTexture(f.tex); }
        }
      }
      for (const t of res.textures) gl.deleteTexture(t);
      if (res.vbo) gl.deleteBuffer(res.vbo);
      if (res.ibo) gl.deleteBuffer(res.ibo);
    } catch { /* context 可能已丢 */ }
    res = null;
  }

  // combos 解析（§2.4 规范）：元注释默认 ⊕ pass.combos ⊕ 纹理槽位派生
  function resolveCombos(ef, sm) {
    const values = {};
    for (const [name, c] of Object.entries(sm.combos || {})) values[name] = c.default ?? '0';
    for (const [name, v] of Object.entries(ef.combos || {})) values[name] = String(v);
    // 纹理派生：shader 纹理表带 combo 的槽位（如 MASK）= 该 pass 槽纹理非 null
    for (const [texName, t] of Object.entries(sm.textures || {})) {
      if (!t.combo) continue;
      const slot = t.unit;
      if (slot == null || slot === 0) continue;
      values[t.combo] = ef.textures[slot] ? '1' : '0';
    }
    return values;
  }

  // uniform 值转换（附录 §5）：float=Number；vecN=空白分隔 split；单数字播撒
  function convertUniform(type, raw) {
    if (raw == null) return null;
    const nums = (typeof raw === 'number') ? [raw]
      : String(raw).trim().split(/\s+/).map(Number).filter((x) => Number.isFinite(x));
    if (!nums.length) return null;
    if (type === 'float') return [nums[0]];
    if (type === 'vec2') return nums.length >= 2 ? nums.slice(0, 2) : [nums[0], nums[0]];
    if (type === 'vec3') return nums.length >= 3 ? nums.slice(0, 3) : [nums[0], nums[0], nums[0]];
    if (type === 'vec4' || type === 'color') return nums.length >= 4 ? nums.slice(0, 4) : [nums[0], nums[0], nums[0], 1];
    return nums;
  }

  // ---- G-07: 布局状态（buildResources 与 resize 共用）----
  const layoutOrtho = { width: 0, height: 0 }; // 场景 ortho 逻辑尺寸（无 ortho 时=视口预算）
  let camEye = [0, 0, 0];
  let objectsById = new Map(); // G-04: 父链查找表（host gate objectsById 同款）
  // sar fix：视口预算 → 场景 ortho 比例背板（视口比例 ≠ 场景比例 → CSS letterbox，
  // 对齐 scene-anim 路由的 h=w/sar 修正语义）；落盘到 CW/CH + canvas 背板
  function applySarFit(bw, bh) {
    const W = Math.max(2, Math.round(bw)), H = Math.max(2, Math.round(bh));
    if (layoutOrtho.width > 0 && layoutOrtho.height > 0) {
      const sar = layoutOrtho.width / layoutOrtho.height;
      let h = Math.round(W / sar), w = W;
      if (h > H) { h = H; w = Math.round(h * sar); }
      CW = Math.max(2, w);
      CH = Math.max(2, h);
    } else {
      CW = W;
      CH = H;
    }
    canvas.width = CW;
    canvas.height = CH;
  }

  // ---- G-04: 父链折叠（host gate foldChain / CPU core.js resolveTransform 同式）----
  // 只做平移+角+缩放复合：子 origin × 累积 scale → 旋转(累积 Z 角) → + 累积
  // origin。host gate 已把折叠结果预写进 obj.effTr 时直接消费；原始 parent 字段
  // 在场时（schema 漂移/直喂场景）本地折叠；父缺失/成环按无父渲染并 mark。
  function foldChain(chain) {
    const root = chain[chain.length - 1];
    let ox = Number(root.origin && root.origin[0]) || 0;
    let oy = Number(root.origin && root.origin[1]) || 0;
    let sx = Number(root.scale && root.scale[0]) || 1;
    let sy = Number(root.scale && root.scale[1]) || 1;
    let angle = Number(root.angles && root.angles[2]) || 0;
    for (let i = chain.length - 2; i >= 0; i--) {
      const co = chain[i].origin || [], cs = chain[i].scale || [];
      const ca = Number(chain[i].angles && chain[i].angles[2]) || 0;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const rx = (Number(co[0]) || 0) * sx, ry = (Number(co[1]) || 0) * sy;
      ox += rx * cos - ry * sin;
      oy += rx * sin + ry * cos;
      sx *= Number(cs[0]) || 1;
      sy *= Number(cs[1]) || 1;
      angle += ca;
    }
    return { origin: [ox, oy], scale: [sx, sy], angle };
  }
  function resolveTransform(obj, oi) {
    if (obj.effTr) {
      const t = obj.effTr;
      return {
        origin: [Number(t.origin && t.origin[0]) || 0, Number(t.origin && t.origin[1]) || 0],
        scale: [Number(t.scale && t.scale[0]) || 1, Number(t.scale && t.scale[1]) || 1],
        angle: Number(t.angle) || 0,
      };
    }
    if (obj.parent == null) {
      return {
        origin: [Number(obj.origin && obj.origin[0]) || 0, Number(obj.origin && obj.origin[1]) || 0],
        scale: [Number(obj.scale && obj.scale[0]) || 1, Number(obj.scale && obj.scale[1]) || 1],
        angle: Number(obj.angles && obj.angles[2]) || 0,
      };
    }
    const name = String(obj.name || ('对象' + oi));
    const chain = [obj];
    let cur = obj, guard = 0, broken = false;
    while (cur.parent != null && guard < 32) {
      const parent = objectsById.get(cur.parent);
      if (!parent || chain.includes(parent)) { broken = true; break; }
      chain.push(parent);
      cur = parent;
      guard++;
    }
    if (broken) {
      // 父缺失/成环：按无父渲染（自身变换），mark 上浮（H-04 姊妹项语义）
      mark(name, 'parent 链缺失', '按无父渲染');
      return {
        origin: [Number(obj.origin && obj.origin[0]) || 0, Number(obj.origin && obj.origin[1]) || 0],
        scale: [Number(obj.scale && obj.scale[0]) || 1, Number(obj.scale && obj.scale[1]) || 1],
        angle: Number(obj.angles && obj.angles[2]) || 0,
      };
    }
    mark(name, 'parent', '父链变换已折叠渲染');
    return foldChain(chain);
  }
  // 几何：对象矩形（画布像素，CPU image.js:133-145 同款公式 + alignment 锚点）；
  // G-04: origin/scale/angle 一律取父链折叠结果
  function computeGeo(obj, oi) {
    const ps = [layoutOrtho.width > 0 ? CW / layoutOrtho.width : 1, layoutOrtho.height > 0 ? CH / layoutOrtho.height : 1];
    const tr = resolveTransform(obj, oi);
    const dw = obj.size[0] * tr.scale[0] * ps[0];
    const dh = obj.size[1] * tr.scale[1] * ps[1];
    let cx = tr.origin[0] * ps[0];
    let cy = CH - tr.origin[1] * ps[1];
    const al = String(obj.alignment || '').toLowerCase();
    // lwe CImage.cpp:242-256：left → 左边锚定 origin（矩形右移半宽）；top → 矩形在 origin 下方展开
    if (al.includes('left')) cx += dw / 2; else if (al.includes('right')) cx -= dw / 2;
    if (al.includes('top')) cy += dh / 2; else if (al.includes('bottom')) cy -= dh / 2;
    // viewShift（CPU camera.js:276 同款）：静态 scene.camera.eye 仅 x 平移前景，满幅背景豁免
    const isBg = obj.size[0] >= layoutOrtho.width - 1 && obj.size[1] >= layoutOrtho.height - 1;
    if (!isBg) cx += -camEye[0] * ps[0];
    return {
      dx: cx - dw / 2, dy: cy - dh / 2, dw, dh,
      anglesZ: tr.angle || 0,
      alpha: Number.isFinite(obj.alpha) ? obj.alpha : 1,
      brightness: Number.isFinite(obj.brightness) ? obj.brightness : 1,
    };
  }

  async function buildResources() {
    stats.initStage = 'build';
    const scene = meta.scene;
    const sceneObjects = Array.isArray(scene.objects) ? scene.objects : [];
    layoutOrtho.width = scene.general.ortho.width || CW;
    layoutOrtho.height = scene.general.ortho.height || CH;
    camEye = (scene.camera && scene.camera.eye) || [0, 0, 0];
    objectsById = new Map();
    for (const o of sceneObjects) if (o && o.id != null) objectsById.set(o.id, o);
    // sar fix（G-07 抽取为 applySarFit，resize 复用）：背板按场景 ortho 比例
    applySarFit(CW, CH);

    gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false, antialias: false, depth: false });
    if (!gl) throw new Error('webgl2-unavailable');
    glMaxTexSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0; // N-07: uploadTex 上传守卫用（重建时刷新）

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, _WE_GL_VERTS, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, _WE_GL_IDX, gl.STATIC_DRAW);

    // ① shader 编译链接（失败快速退出，不下载纹理 — 附录 §8）
    // 多对象：program 按 (dir + combos) 缓存共享（同一效果多对象复用，uniform 按绘制时喂）
    stats.initStage = 'compile';
    const progCache = new Map(); // key → { prog, locs, sm }
    const programFor = (ef) => {
      // W2: 清单 ef.shader 为完整引用 (effects/<dir> 或 workshop/<id>/...)
      const sm = shaderMeta[ef.shader];
      if (!sm) throw new Error('shader-meta-missing:' + ef.shader);
      const comboValues = resolveCombos(ef, sm);
      const key = ef.shader + '|' + JSON.stringify(comboValues);
      let entry = progCache.get(key);
      if (!entry) {
        const vsrc = _weGLAssemble(sm.vert, sm.combos, comboValues);
        const fsrc = _weGLAssemble(sm.frag, sm.combos, comboValues);
        const vs = compileShader(gl.VERTEX_SHADER, vsrc, ef.shader + '.vert');
        const fs = compileShader(gl.FRAGMENT_SHADER, fsrc, ef.shader + '.frag');
        const prog = linkProgram(vs, fs, ef.shader);
        // 预取全部 uniform 位置（被 #if 裁掉的返回 null，uniformX(null) 规范 no-op）
        const locs = {};
        for (const name of Object.keys(sm.uniforms || {})) locs[name] = gl.getUniformLocation(prog, name);
        locs.g_Time = gl.getUniformLocation(prog, 'g_Time');
        locs.g_ModelViewProjectionMatrix = gl.getUniformLocation(prog, 'g_ModelViewProjectionMatrix');
        // P2-7: attrib 位置同款预取 — 旧 bindQuad 每帧每 pass getAttribLocation×2，
        // 位置 link 后不变，构建期取一次（被裁掉的 attribute 返回 -1，绑定跳过）
        const attribs = {
          aPos: gl.getAttribLocation(prog, 'a_Position'),
          aUV: gl.getAttribLocation(prog, 'a_TexCoord'),
        };
        // P2-7/N-08: slot1/2 纹理槽位表预展开 — 旧实现每帧每 pass
        // Object.entries(sm.textures) 分配 + 逐项查 locs，全部构建后不变
        const texSlots = [];
        for (const [texName, tx] of Object.entries(sm.textures || {})) {
          if (tx.unit == null || tx.unit === 0) continue;
          texSlots.push({ texName, unit: tx.unit, mode: tx.mode, loc: locs[texName] ?? null, resLoc: locs[texName + 'Resolution'] ?? null });
        }
        entry = { prog, locs, attribs, texSlots, sm };
        progCache.set(key, entry);
      }
      return entry;
    };
    // W2: 每效果编译隔离 — 单个效果 shader 编译/链接失败只跳过该链条目
    // (链输入原样传给下一 pass), 不拖垮整个对象/场景; 失败记配置页提醒。
    const safeProgramFor = (ef, objName) => {
      try {
        return programFor(ef);
      } catch (e) {
        mark(objName || '?', 'effect:' + (ef.dir || ef.shader),
          'shader 编译/链接失败，已跳过该效果: ' + (e && e.message ? e.message : e));
        return null;
      }
    };
    const presentProg = linkProgram(
      compileShader(gl.VERTEX_SHADER, _WE_GL_PRESENT_VERT, 'present.vert'),
      compileShader(gl.FRAGMENT_SHADER, _WE_GL_PRESENT_FRAG, 'present.frag'),
      'present',
    );
    const presentLocs = {
      u_MVP: gl.getUniformLocation(presentProg, 'u_MVP'),
      u_Tex: gl.getUniformLocation(presentProg, 'u_Tex'),
      u_ObjectAlpha: gl.getUniformLocation(presentProg, 'u_ObjectAlpha'),
      u_Brightness: gl.getUniformLocation(presentProg, 'u_Brightness'),
    };
    // P2-7: present 程序 attrib 位置同样构建期预取（旧 bindQuad 每帧查询）
    const presentAttribs = {
      aPos: gl.getAttribLocation(presentProg, 'a_Position'),
      aUV: gl.getAttribLocation(presentProg, 'a_TexCoord'),
    };

    // ② 纹理 fetch（y-down 不翻转上传；多对象并发加载，路径去重共享）
    stats.initStage = 'textures';
    const textures = [];
    const texByKey = new Map(); // path → Promise<{ tex, w, h }>
    const loadOne = (info, repeat, mip) => {
      const k = info.path + '|' + (mip ? 'm' : '');
      if (texByKey.has(k)) return texByKey.get(k);
      stats.initStage = 'tex:' + info.path;
      const p = (async () => {
        const blob = await fetchBlob(resUrl(info.path), 10000);
        const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
        const w = bmp.width, h = bmp.height; // close() 后 width/height 归零，先取
        const tex = uploadTex(bmp, { repeat, mip });
        bmp.close();
        const entry = { tex, w, h, hw: info.headerWidth || w, hh: info.headerHeight || h };
        textures.push(tex);
        return entry;
      })();
      texByKey.set(k, p);
      return p;
    };
    const whiteEntry = { tex: makeSolidTex(255, 255, 255), w: 1, h: 1, hw: 1, hh: 1 };
    const flowEntry = { tex: makeSolidTex(127, 127, 255), w: 1, h: 1, hw: 1, hh: 1 };
    textures.push(whiteEntry.tex, flowEntry.tex);

    // 每对象资源：主纹理 + 效果纹理 + program 列表 + FBO 对（仅带效果者）+ 几何
    const objResList = await Promise.all(sceneObjects.map(async (obj, oi) => {
      const mainTexEntry = await loadOne(obj.mainTexture, false, true); // slot0 CLAMP+mipmap（§2.6/§11-⑤）
      const programs = (obj.effects || []).map((ef) => {
        const pe = safeProgramFor(ef, obj.name);
        return pe ? { ef, ...pe } : null;
      }).filter(Boolean); // W2: 编译失败的效果已被隔离剔除
      // P2-7: 材质常量构建期一次预转换 — 旧实现在 renderObjectChain 每帧每 pass
      // split/Number 转换（csv 值 + 类型转换 + 元注释 default 兜底，附录 §5 同款
      // 逻辑前移；constants/uniform 位置构建后均不变）。同名跨阶段冲突按片元
      // 语义喂值（uniformsFrag 优先；GL 同名合一位置）。
      for (const p of programs) {
        p.matUniforms = [];
        for (const [name, u] of Object.entries(p.sm.uniforms || {})) {
          if (u.type === 'sampler2D') continue;
          const uu = (p.sm.uniformsFrag && p.sm.uniformsFrag[name]) || u;
          if (!uu.material) continue;
          let raw = p.ef.constants[uu.material];
          if (raw === undefined && uu.default !== undefined) raw = uu.default;
          const v = convertUniform(uu.type, raw);
          const loc = p.locs[name];
          if (v == null || loc == null) continue; // null loc = setU no-op 语义不变
          p.matUniforms.push({ loc, v: v.length === 1 ? v[0] : v });
        }
      }
      // 效果纹理（槽位键按对象隔离；loadOne 按路径去重不重复上传）
      const effectTex = new Map();
      await Promise.all((obj.effects || []).map(async (ef) => {
        for (let slot = 1; slot < ef.textures.length; slot++) {
          const info = ef.textures[slot];
          // W2: {previous:true}/{chain:true} 标记槽无 path — 绘制期绑定, 不预载
          if (!info || !info.path) continue;
          effectTex.set(ef.shader + ':' + slot, await loadOne(info, true, false)); // slot1/2 REPEAT
        }
      }));
      // FBO 链 = 对象纹理空间等比 clamp 到画布预算（P0-1：此前链 FBO 跟主纹理
      // 走，8K 底图在 1080p 视口上多耗 ~5-8× 片元/GPU 显存；现对齐 CPU mp4 路径
      // ≤ 视口预算的语义。N-06：两轴取同一缩放比 s=min(1,CW/w,CH/h) 保持纵横比
      // ——w/h 各自独立 clamp 会把 16:9 压成 1:1，读 aspect 的效果失真；链输出
      // 仍由 present pass 按对象几何画到真实画布，aspect 由 quad 几何保证。
      // CW/CH 此刻 = applySarFit 后的画布背板 = 调用方视口预算（client
      // sceneViewportSize ≤1920×1080）；≤ 预算的纹理 s=1，行为不变）
      let fboA = null, fboB = null;
      if (programs.length > 0) {
        const s = Math.min(1, CW / mainTexEntry.w, CH / mainTexEntry.h);
        const fw = Math.max(1, Math.round(mainTexEntry.w * s));
        const fh = Math.max(1, Math.round(mainTexEntry.h * s));
        fboA = makeFBO(fw, fh);
        fboB = makeFBO(fw, fh);
      }
      // 几何（G-04）：origin/scale/angle 取父链折叠结果（computeGeo 内
      // resolveTransform：effTr 直消费 / 原始 parent 本地折叠 / 缺失 mark）
      const geo = computeGeo(obj, oi);
      // P2-7: 效果链 MVP 构建期算一次 — 仅依赖主纹理尺寸（构建后不变；旧实现
      // 每帧重建）。独占缓冲：多 pass 间持续被读，不可共享模块 scratch。
      const mvpFx = programs.length > 0
        ? _weGLQuadMVP(mainTexEntry.w, mainTexEntry.h, 0, 0, mainTexEntry.w, mainTexEntry.h, true, new Float32Array(16))
        : null;
      return { obj, oi, mainTexEntry, programs, effectTex, fboA, fboB, geo, mvpFx };
    }));

    stats.initStage = 'fbo';
    geo = { clearcolor: [0, 0, 0, 1] };
    const cc = String(scene.general.clearcolor || '0 0 0').trim().split(/\s+/).map(Number);
    geo.clearcolor = [cc[0] || 0, cc[1] || 0, cc[2] || 0, 1];

    // P2-8: 静态场景判定（保守）— 本渲染器唯一的帧变 uniform 是 g_Time（材质
    // 常量=scene.json 静态值、无鼠标/相机类动态输入、resolution/纹理均构建期
    // 固定）。任一 program 的 g_Time 位置非空（被链接器优化掉的返回 null）即
    // 视为动态场景，逐帧渲染保持现状；全部为 null 才允许跳帧。
    let sceneIsStatic = true;
    for (const o of objResList) {
      if (!sceneIsStatic) break;
      for (const p of o.programs) {
        if (p.locs.g_Time != null) { sceneIsStatic = false; break; }
      }
    }

    // P2-7: vaos = VAO 缓存（bindQuadVao 按 attrib 位置组合惰性建，见下）
    res = { vbo, ibo, objects: objResList, progCache, presentProg, presentLocs, presentAttribs, textures, whiteEntry, flowEntry, sceneIsStatic, vaos: new Map() };
  }

  // P2-7: VAO 缓存（WebGL2 原生）— 全 pass 顶点布局一致（同 vbo/ibo、同
  // stride/offset），仅 attrib 位置编号可能随 program 变化，故按 (aPos,aUV)
  // 组合建 VAO（同一批 shader 名字相同，实际场景 1~2 个）。一次 bindVertexArray
  // 恢复完整 attrib 状态，替代旧 bindQuad 每帧每 pass 的
  // getAttribLocation×2 + enable + pointer×2；destroyResources 随程序一起释放，
  // contextrestored 重建时随 res 重建。
  function bindQuadVao(attribs) {
    const key = attribs.aPos + '|' + attribs.aUV;
    if (!res.vaos.has(key)) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.ibo);
      if (attribs.aPos >= 0) {
        gl.enableVertexAttribArray(attribs.aPos);
        gl.vertexAttribPointer(attribs.aPos, 3, gl.FLOAT, false, 20, 0);
      }
      if (attribs.aUV >= 0) {
        gl.enableVertexAttribArray(attribs.aUV);
        gl.vertexAttribPointer(attribs.aUV, 2, gl.FLOAT, false, 20, 12);
      }
      gl.bindVertexArray(null);
      res.vaos.set(key, vao);
    }
    gl.bindVertexArray(res.vaos.get(key));
  }
  const setU = (loc, v) => {
    if (loc == null || v == null) return;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
    else if (v.length === 4) gl.uniform4fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else gl.uniform1f(loc, v[0]);
  };
  // N-08: resolution 向量模块级复用（旧实现每帧每 pass 每槽位分配新数组；
  // setU→uniform4fv 即时消费不逃逸，复用安全）
  const _weResVecBuf = [0, 0, 0, 0];
  const resVec = (e) => {
    const v = _weResVecBuf;
    v[0] = e.w; v[1] = e.h; v[2] = e.hw; v[3] = e.hh;
    return v;
  }; // lwe: (mip0.w, mip0.h, header.w, header.h)

  // 单对象效果链：主纹理 →（效果 pass ×N，对象自身 FBO 对 ping-pong）→ 输出 entry
  function renderObjectChain(o, t) {
    if (!o.programs.length) return o.mainTexEntry;
    const mvpFx = o.mvpFx; // P2-7: 构建期缓存（仅依赖主纹理尺寸，见 buildResources）
    let input = o.mainTexEntry;
    // P2-7/N-08: for 循环替代 forEach（旧实现每帧每对象分配闭包）
    for (let i = 0; i < o.programs.length; i++) {
      const p = o.programs[i];
      // sf35: FBO 逐 pass 交替（ping-pong）。旧逻辑 i===n-1?fboB:fboA 在 n≥3 时
      // 中间 pass 读写同一 FBO 纹理 = GL 规范禁止的 feedback loop（真机 tile GPU
      // 上未定义行为 → 3 效果链的中间效果错乱; SwiftShader 读改写容错掩盖了它,
      // E2E 从未暴露）。n=1/2 时与旧逻辑逐位等价（02 场景回归不受影响）。
      const target = (i % 2 === 0) ? o.fboA : o.fboB;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
      gl.disable(gl.BLEND); // 效果 FBO pass 禁 BLEND（附录 §3）
      gl.useProgram(p.prog);
      bindQuadVao(p.attribs); // P2-7: VAO 绑定（attrib 位置已构建期预取）
      // slot0 = 链输入（首效果=主图，后续=上一 FBO；lwe 约定 FBO 视为 (w,h,w,h)）
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input.tex);
      if (p.locs.g_Texture0) gl.uniform1i(p.locs.g_Texture0, 0);
      setU(p.locs.g_Texture0Resolution, resVec(input));
      // slot1/2 = mask/normal（空槽按 mode 回退：flowmask→中灰，其余→白）
      // P2-7: 遍历构建期预展开的槽位表（含预取 loc，免每帧 Object.entries 分配）
      for (let s = 0; s < p.texSlots.length; s++) {
        const ts = p.texSlots[s];
        // W2: 清单槽 {previous:true} → 对象主纹理 (官方 effect.json pass.bind
        // "previous" 语义); 其余按预载纹理/兜底
        const slotInfo = p.ef.textures[ts.unit];
        const entry = (slotInfo && slotInfo.previous === true) ? o.mainTexEntry
          : (o.effectTex.get(p.ef.shader + ':' + ts.unit)
            || (ts.mode === 'flowmask' ? res.flowEntry : res.whiteEntry));
        gl.activeTexture(gl.TEXTURE0 + ts.unit);
        gl.bindTexture(gl.TEXTURE_2D, entry.tex);
        if (ts.loc) gl.uniform1i(ts.loc, ts.unit);
        setU(ts.resLoc, resVec(entry));
      }
      setU(p.locs.g_ModelViewProjectionMatrix, mvpFx);
      setU(p.locs.g_Time, t);
      // P2-7: 材质常量已构建期预转换（附录 §5 逻辑前移至 buildResources），直喂
      for (let m = 0; m < p.matUniforms.length; m++) {
        const mu = p.matUniforms[m];
        setU(mu.loc, mu.v);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      input = target;
    }
    return input;
  }

  // N-08: 合成输出槽模块级复用（旧实现每帧 res.objects.map 分配新数组；
  // render 内即写即读不逃逸）
  const _weOutputs = [];
  function render(t) {
    if (!res) return;
    // ① 每对象效果链（输出 = 对象纹理空间的合成结果）
    const objs = res.objects;
    for (let i = 0; i < objs.length; i++) _weOutputs[i] = renderObjectChain(objs[i], t);
    // ② 合成 pass：按场景对象顺序 src-over（CPU canvas 直 alpha 同款）
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, CW, CH);
    const c = geo.clearcolor;
    gl.clearColor(c[0], c[1], c[2], c[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(res.presentProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    bindQuadVao(res.presentAttribs);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(res.presentLocs.u_Tex, 0);
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      const g = o.geo;
      gl.bindTexture(gl.TEXTURE_2D, _weOutputs[i].tex);
      // P2-7: present MVP 缓存 — 仅视口（CW/CH）或几何（resize 重算 geo，换新
      // 对象）变化时重算；旧实现每帧每对象 new Float32Array×2 + 全乘法重算。
      // 独占缓冲（基座+旋转各一，旋转在位乘会污染未读元素，不可共用 scratch）。
      if (!g.mvp || g.mvpW !== CW || g.mvpH !== CH) {
        const base = new Float32Array(16), rot = new Float32Array(16);
        _weGLQuadMVP(CW, CH, g.dx, g.dy, g.dw, g.dh, false, base);
        g.mvp = _weGLMvpWithZRot(base, g.anglesZ, g.dw, g.dh, rot);
        g.mvpW = CW;
        g.mvpH = CH;
      }
      gl.uniformMatrix4fv(res.presentLocs.u_MVP, false, g.mvp);
      gl.uniform1f(res.presentLocs.u_ObjectAlpha, g.alpha);
      gl.uniform1f(res.presentLocs.u_Brightness, g.brightness);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.BLEND);
  }

  // rAF 循环：g_Time 自由运行（时间基连续，暂停恢复无跳变）；fpsCap 累计器限帧；
  // playbackRate 缩放场景时间（与 mp4 路径的 video.playbackRate 同款用户控制）
  function loop(now) {
    if (disposed || !running) return;
    rafId = requestAnimationFrame(loop);
    const dt = lastNow ? now - lastNow : 16.7;
    lastNow = now;
    if (fpsCap > 0) {
      fpsAcc += dt;
      const budget = 1000 / fpsCap;
      if (fpsAcc < budget) return;
      fpsAcc %= budget;
    }
    pushFrameTime(dt);
    stats.frames++;
    // P2-8: 静态场景跳帧 — 无 g_Time 依赖（构建期保守判定，见 buildResources）
    // 且无脏标记时跳过 render（GL 工作全免；rAF 空转保持活跃，脏标记置位后
    // 下一 vsync 立即恢复）。frameTimes/frames 照常记录（rAF 间隔量纲，外部
    // 观测语义不变）。动态场景（任一 g_Time 存在）恒不触发，行为与旧版一致。
    if (res && res.sceneIsStatic && !needRedraw) return;
    const t = rateBase + ((now - wallBase) / 1000) * playbackRate;
    stats.lastT = t;
    // G-03: 帧级 try/catch + 连续失败计数 — 连续 N 帧抛错判 fatal：停循环、
    // fail 上抛（onError → 调用方回退 CPU mp4 并提示）；偶发单帧失败计数
    // 清零自愈。onReady 只在成功帧后触发（杜绝“抛错帧也标 ready”的假就绪）。
    try {
      const renderT0 = performance.now(); // P0-2: 量 render 本身（pushFrameTime 记的是 rAF 间隔）
      render(t);
      pushRenderTime(performance.now() - renderT0);
      if (disposed) return; // P0-2: 慢帧熔断已在 pushRenderTime 内 dispose → 跳过本帧余下动作（含 onReady）
      needRedraw = false; // P2-8: 渲染成功帧后才清脏（抛错帧保持脏，G-03 重试仍逐帧跑）
      renderFails = 0;
      stats.renderFails = 0;
      if (!readyFired) {
        readyFired = true;
        state = 'GL_RUN';
        try { onReady(); } catch { /* 调用方异常不中断渲染 */ }
      }
    } catch (e) {
      renderFails++;
      stats.renderFails = renderFails;
      const msg = e && e.message ? e.message : String(e);
      stats.errors.push('render:' + msg);
      try { console.error('[scene-gl] 渲染帧失败（连续 ' + renderFails + '/' + WE_GL_RENDER_FATAL_MAX + '）:', e); } catch { /* console 不可用 */ }
      if (renderFails >= WE_GL_RENDER_FATAL_MAX) {
        fail('render-fatal:' + msg, true); // fail → dispose + onError（调用方标记 glFailed 回退）
        return;
      }
    }
  }
  function startLoop() {
    if (running || disposed || !res || paused) return;
    running = true;
    lastNow = 0;
    needRedraw = true; // P2-8: 恢复渲染保守重画一帧（暂停期间 canvas 可能被合成器回收）
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  let renderFails = 0; // G-03: 连续渲染抛错计数（成功帧清零）
  let needRedraw = true; // P2-8: 静态场景脏标记（首帧/恢复/resize 置位，渲染成功后清除）

  // G-07: 视口/设备像素比变化 → 重建背板与对象几何。尺寸变化>阈值(2px)才落
  // GL 状态（防 dpr 抖动频繁触发）；超限 clamp 到 4096 并 mark（一次）。对象
  // 效果 FBO 建于构建期画布预算内（P0-1 等比 clamp），不随 resize 重建（重建
  // =重传全部纹理；视口放大时链输出由 present pass 放大，仅轻微变软）。
  function resize(w, h) {
    if (disposed) return false;
    noteViewportClamp(w, h);
    const oldW = CW, oldH = CH;
    applySarFit(clampGLDim(w), clampGLDim(h));
    if (Math.abs(CW - oldW) < 2 && Math.abs(CH - oldH) < 2) {
      // 阈值内回滚（canvas 背板尺寸赋值本身有重分配成本，避免抖动）
      CW = oldW; CH = oldH;
      canvas.width = CW;
      canvas.height = CH;
      return false;
    }
    if (res && res.objects) {
      for (const o of res.objects) {
        try { o.geo = computeGeo(o.obj, o.oi); } catch { /* 单对象布局失败不拦整体 */ }
      }
    }
    needRedraw = true; // P2-8: 视口/几何变化 → 静态场景重渲一帧
    return true;
  }

  // 暂停策略：document.hidden + IntersectionObserver 离屏即停（§5.1）
  function installPauseHooks() {
    hiddenListener = () => { if (document.hidden) stopLoop(); else startLoop(); };
    document.addEventListener('visibilitychange', hiddenListener);
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        const e = entries[0];
        if (!e) return;
        if (e.isIntersecting) startLoop(); else stopLoop();
      }, { threshold: 0.01 });
      observer.observe(canvas);
    }
  }

  // contextlost → dispose → contextrestored 短退避后重建一次 → 再失败回退（§2.11）
  let rebuiltOnce = false;
  function installContextHooks() {
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault(); // 允许 contextrestored
      stats.contextLost++;
      stopLoop();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (disposed) return;
      if (rebuiltOnce) { fail('contextlost-twice'); return; }
      rebuiltOnce = true;
      setTimeout(async () => {
        try {
          destroyResources();
          await buildResources();
          startLoop();
        } catch (e) {
          fail('contextlost-rebuild:' + (e && e.message ? e.message : e));
        }
      }, 500);
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    state = 'DISPOSED';
    stopLoop();
    ctrl.abort();
    if (hiddenListener) document.removeEventListener('visibilitychange', hiddenListener);
    if (observer) { try { observer.disconnect(); } catch { /* */ } observer = null; }
    try { destroyResources(); } catch { /* */ }
    if (gl) {
      try {
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      } catch { /* */ }
      gl = null;
    }
  }

  // ---- 启动序列（附录 §8）----
  (async () => {
    try {
      // 先让出同步栈：本 IIFE 在首个 await 前同步执行，此刻调用方尚未完成
      // sceneGL 赋值，同步 fail() 的 onError 会撞上其早退守卫被吞（渲染器挂死）。
      await Promise.resolve();
      if (disposed) return;
      // P1-3①: WebGL2 一次性预检 + SwiftShader 嗅探 — 失败即降级，不进入
      // meta/shader 串行 fetch（webgl2-unavailable 此前要到 buildResources 才暴露）
      const probeFail = weGLPreflight();
      if (probeFail !== true) { fail(probeFail, true); return; }
      // GL_TRY：meta（5s 超时）
      meta = await fetchJson(BASE + '/scene-gl-meta/' + token, 5000);
      if (disposed) return;
      if (!meta || meta.supported !== true) {
        fail('unsupported:' + ((meta && meta.reason) || 'unknown'), true);
        return;
      }
      // 版本 handshake：engine 次版本不符 → 回退 mp4（附录 §7）
      if (String(meta.engine || '').split('/')[1] !== String(_WE_GL_VERSION)) {
        fail('engine-version:' + meta.engine, true);
        return;
      }
      state = 'GL_INIT';
      stats.initStage = 'shaders';
      // shader fetch（编译先于纹理下载；多对象：收集全部对象用到的 shader 引用）
      shaderMeta = {};
      for (const obj of meta.scene.objects || []) {
        for (const ef of obj.effects || []) {
          if (shaderMeta[ef.shader]) continue;
          // W2: 完整 shader 引用 (effects/<dir> / workshop/<id>/...), 逐段 URL 编码
          const ref = String(ef.shader).split('/').map(encodeURIComponent).join('/');
          shaderMeta[ef.shader] = await fetchJson(BASE + '/scene-shader/' + token + '/' + ref, 5000);
        }
      }
      if (disposed) return;
      // 总 watchdog（meta 之后）：多对象场景纹理数十张，4K 解码串行可观，放宽到 120s
      const watchdog = setTimeout(() => fail('init-watchdog'), 120000);
      try {
        await buildResources();
      } finally {
        clearTimeout(watchdog);
      }
      if (disposed) return;
      stats.initStage = 'done';
      installContextHooks();
      installPauseHooks();
      wallBase = performance.now();
      startLoop();
    } catch (e) {
      fail('init:' + (e && e.message ? e.message : e), false);
    }
  })();

  return {
    canvas,
    dispose,
    stats,
    state: () => state,
    // 降级清单 = host gate 产物 ⊕ 渲染器本地 mark（G-04 父链缺失 / G-07 clamp）。
    // dispose 后仍可读（client 在 onError 里取用 — G-01 缓存的数据来源）。
    degraded: () => [
      ...((meta && Array.isArray(meta.degraded)) ? meta.degraded : []),
      ...degradedLocal,
    ],
    // G-07: 视口/设备像素比变化时由调用方喂新预算（超限 clamp + 阈值内忽略）
    resize,
    // 用户暂停/遮挡暂停（调用方按 isEffectivelyPlaying 同步）
    setPaused(p) {
      p = !!p;
      if (p === paused) return;
      paused = p;
      if (p) stopLoop(); else startLoop();
    },
    // fpsCap 变更即时生效（不重建）
    setFpsCap(cap) { fpsCap = Math.max(0, Number(cap) || 0); fpsAcc = 0; },
    // 播放速率（mp4 路径 video.playbackRate 同款语义）：时间基重锚定，无跳变
    setPlaybackRate(r) {
      r = Number(r);
      if (!Number.isFinite(r) || r <= 0 || r === playbackRate) return;
      const now = performance.now();
      rateBase = rateBase + ((now - wallBase) / 1000) * playbackRate;
      wallBase = now;
      playbackRate = r;
    },
  };
}

return { version: _WE_GL_VERSION, createSceneGLRenderer };
