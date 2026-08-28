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
function _weGLQuadMVP(W, H, dx, dy, dw, dh, flipY) {
  const cx = dx + dw / 2, cy = dy + dh / 2;
  const sy = flipY ? -2 * dh / H : 2 * dh / H; // 效果 pass: 图顶→NDC−1（y-down 链一致）
  const ty = flipY ? -(1 - 2 * cy / H) : 1 - 2 * cy / H;
  return new Float32Array([
    2 * dw / W, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, -1, 0,
    2 * cx / W - 1, ty, 0, 1,
  ]);
}
function _weGLMvpWithZRot(m, rad, dw, dh) {
  if (!rad) return m;
  const r = -rad; // CPU 正角 = 屏幕 CCW（判别实验②实测）
  const c = Math.cos(r), s = Math.sin(r);
  const kx = dw / dh, ky = dh / dw; // 像素空间刚体：S⁻¹·RotZ·S
  const R = new Float32Array([c, s * kx, 0, 0, -s * ky, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += m[k * 4 + row] * R[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
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

const _WE_GL_ENGINE = 'dsh-we-scene-gl/2';
const _WE_GL_VERSION = 3; // sf35: shake 2π 数学 + FBO 交替 (与 host SCENE_GL_ENGINE 同步)

/**
 * 创建场景 GL 渲染器。
 * opts: { token, width, height, fpsCap, onReady, onError }
 *   width/height = 视口预算像素（调用方按 dpr 算好）；canvas 背板在 meta 到达后
 *                 按场景 ortho 比例修正（sar fix，视口不一致时 CSS object-fit letterbox）
 *   onReady()    首帧渲染完成（调用方此刻才显示 canvas + 淡出底图 img）
 *   onError({reason, permanent})  任一失败（调用方标记 glFailed 回退 mp4）
 * 返回 { canvas, dispose(), stats(), setPaused(), setFpsCap(), setPlaybackRate() }。
 */
function createSceneGLRenderer(opts) {
  const token = opts.token;
  let CW = Math.max(2, Math.round(opts.width));
  let CH = Math.max(2, Math.round(opts.height));
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
  const stats = { state: () => state, frames: 0, frameTimes: [], contextLost: 0, errors: [], lastT: 0, initStage: 'meta' };
  const pushFrameTime = (ms) => {
    stats.frameTimes.push(ms);
    if (stats.frameTimes.length > 4096) stats.frameTimes.splice(0, stats.frameTimes.length - 4096);
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
  let geo = null; // { dx, dy, dw, dh, anglesZ, clearcolor:[r,g,b,a], mvpFxW/H }

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
  function makeFBO(w, h) {
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
  function uploadTex(bmp, { repeat, mip }) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 不翻转上传（y-down 定案）：tex 行 0 = PNG 行 0 = 图顶 = CPU v=0
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
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

  async function buildResources() {
    stats.initStage = 'build';
    const scene = meta.scene;
    const sceneObjects = Array.isArray(scene.objects) ? scene.objects : [];
    const orthoW = scene.general.ortho.width || CW;
    const orthoH = scene.general.ortho.height || CH;
    // sar fix：背板按场景 ortho 比例（视口比例 ≠ 场景比例 → CSS letterbox，
    // 对齐 scene-anim 路由的 h=w/sar 修正语义）
    if (orthoW > 0 && orthoH > 0) {
      const sar = orthoW / orthoH;
      let bh = Math.round(CW / sar);
      let bw = CW;
      if (bh > CH) { bh = CH; bw = Math.round(bh * sar); }
      CW = Math.max(2, bw);
      CH = Math.max(2, bh);
    }
    canvas.width = CW;
    canvas.height = CH;

    gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false, antialias: false, depth: false });
    if (!gl) throw new Error('webgl2-unavailable');

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
      const sm = shaderMeta[ef.dir];
      const comboValues = resolveCombos(ef, sm);
      const key = ef.dir + '|' + JSON.stringify(comboValues);
      let entry = progCache.get(key);
      if (!entry) {
        const vsrc = _weGLAssemble(sm.vert, sm.combos, comboValues);
        const fsrc = _weGLAssemble(sm.frag, sm.combos, comboValues);
        const vs = compileShader(gl.VERTEX_SHADER, vsrc, ef.dir + '.vert');
        const fs = compileShader(gl.FRAGMENT_SHADER, fsrc, ef.dir + '.frag');
        const prog = linkProgram(vs, fs, ef.dir);
        // 预取全部 uniform 位置（被 #if 裁掉的返回 null，uniformX(null) 规范 no-op）
        const locs = {};
        for (const name of Object.keys(sm.uniforms || {})) locs[name] = gl.getUniformLocation(prog, name);
        locs.g_Time = gl.getUniformLocation(prog, 'g_Time');
        locs.g_ModelViewProjectionMatrix = gl.getUniformLocation(prog, 'g_ModelViewProjectionMatrix');
        entry = { prog, locs, sm };
        progCache.set(key, entry);
      }
      return entry;
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
    const ps = [CW / orthoW, CH / orthoH];
    const eye = (scene.camera && scene.camera.eye) || [0, 0, 0];
    const objResList = await Promise.all(sceneObjects.map(async (obj, oi) => {
      const mainTexEntry = await loadOne(obj.mainTexture, false, true); // slot0 CLAMP+mipmap（§2.6/§11-⑤）
      const programs = (obj.effects || []).map((ef) => ({ ef, ...programFor(ef) }));
      // 效果纹理（槽位键按对象隔离；loadOne 按路径去重不重复上传）
      const effectTex = new Map();
      await Promise.all((obj.effects || []).map(async (ef) => {
        for (let slot = 1; slot < ef.textures.length; slot++) {
          const info = ef.textures[slot];
          if (!info) continue;
          effectTex.set(ef.dir + ':' + slot, await loadOne(info, true, false)); // slot1/2 REPEAT
        }
      }));
      // FBO 链 = 对象纹理空间（对齐 CPU staticFrame 全分辨率效果链）
      let fboA = null, fboB = null;
      if (programs.length > 0) {
        fboA = makeFBO(mainTexEntry.w, mainTexEntry.h);
        fboB = makeFBO(mainTexEntry.w, mainTexEntry.h);
      }
      // 几何：对象矩形（画布像素，CPU image.js:133-145 同款公式 + alignment 锚点）
      const dw = obj.size[0] * obj.scale[0] * ps[0];
      const dh = obj.size[1] * obj.scale[1] * ps[1];
      let cx = obj.origin[0] * ps[0];
      let cy = CH - obj.origin[1] * ps[1];
      const al = String(obj.alignment || '').toLowerCase();
      // lwe CImage.cpp:242-256：left → 左边锚定 origin（矩形右移半宽）；top → 矩形在 origin 下方展开
      if (al.includes('left')) cx += dw / 2; else if (al.includes('right')) cx -= dw / 2;
      if (al.includes('top')) cy += dh / 2; else if (al.includes('bottom')) cy -= dh / 2;
      // viewShift（CPU camera.js:276 同款）：静态 scene.camera.eye 仅 x 平移前景，满幅背景豁免
      const isBg = obj.size[0] >= orthoW - 1 && obj.size[1] >= orthoH - 1;
      if (!isBg) cx += -eye[0] * ps[0];
      const geo = {
        dx: cx - dw / 2, dy: cy - dh / 2, dw, dh,
        anglesZ: (obj.angles && obj.angles[2]) || 0,
        alpha: Number.isFinite(obj.alpha) ? obj.alpha : 1,
        brightness: Number.isFinite(obj.brightness) ? obj.brightness : 1,
      };
      return { obj, mainTexEntry, programs, effectTex, fboA, fboB, geo };
    }));

    stats.initStage = 'fbo';
    geo = { clearcolor: [0, 0, 0, 1] };
    const cc = String(scene.general.clearcolor || '0 0 0').trim().split(/\s+/).map(Number);
    geo.clearcolor = [cc[0] || 0, cc[1] || 0, cc[2] || 0, 1];

    res = { vbo, ibo, objects: objResList, progCache, presentProg, presentLocs, textures, whiteEntry, flowEntry };
  }

  function bindQuad(prog) {
    const aPos = gl.getAttribLocation(prog, 'a_Position');
    const aUV = gl.getAttribLocation(prog, 'a_TexCoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, res.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.ibo);
    if (aPos >= 0) {
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
    }
    if (aUV >= 0) {
      gl.enableVertexAttribArray(aUV);
      gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 20, 12);
    }
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
  const resVec = (e) => [e.w, e.h, e.hw, e.hh]; // lwe: (mip0.w, mip0.h, header.w, header.h)

  // 单对象效果链：主纹理 →（效果 pass ×N，对象自身 FBO 对 ping-pong）→ 输出 entry
  function renderObjectChain(o, t) {
    if (!o.programs.length) return o.mainTexEntry;
    const FW = o.mainTexEntry.w, FH = o.mainTexEntry.h;
    const mvpFx = _weGLQuadMVP(FW, FH, 0, 0, FW, FH, true);
    let input = o.mainTexEntry;
    o.programs.forEach((p, i) => {
      // sf35: FBO 逐 pass 交替（ping-pong）。旧逻辑 i===n-1?fboB:fboA 在 n≥3 时
      // 中间 pass 读写同一 FBO 纹理 = GL 规范禁止的 feedback loop（真机 tile GPU
      // 上未定义行为 → 3 效果链的中间效果错乱; SwiftShader 读改写容错掩盖了它,
      // E2E 从未暴露）。n=1/2 时与旧逻辑逐位等价（02 场景回归不受影响）。
      const target = (i % 2 === 0) ? o.fboA : o.fboB;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
      gl.disable(gl.BLEND); // 效果 FBO pass 禁 BLEND（附录 §3）
      gl.useProgram(p.prog);
      bindQuad(p.prog);
      // slot0 = 链输入（首效果=主图，后续=上一 FBO；lwe 约定 FBO 视为 (w,h,w,h)）
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input.tex);
      if (p.locs.g_Texture0) gl.uniform1i(p.locs.g_Texture0, 0);
      setU(p.locs.g_Texture0Resolution, resVec(input));
      // slot1/2 = mask/normal（空槽按 mode 回退：flowmask→中灰，其余→白）
      for (const [texName, tx] of Object.entries(p.sm.textures || {})) {
        if (tx.unit == null || tx.unit === 0) continue;
        const entry = o.effectTex.get(p.ef.dir + ':' + tx.unit)
          || (tx.mode === 'flowmask' ? res.flowEntry : res.whiteEntry);
        gl.activeTexture(gl.TEXTURE0 + tx.unit);
        gl.bindTexture(gl.TEXTURE_2D, entry.tex);
        if (p.locs[texName]) gl.uniform1i(p.locs[texName], tx.unit);
        setU(p.locs[texName + 'Resolution'], resVec(entry));
      }
      setU(p.locs.g_ModelViewProjectionMatrix, mvpFx);
      setU(p.locs.g_Time, t);
      // material 常量 → uniform（附录 §5：csv 值 → 类型转换 → 元注释 default 兜底）
      // 同名跨阶段冲突按片元语义喂值（uniformsFrag 优先；GL 同名合一位置）
      for (const [name, u] of Object.entries(p.sm.uniforms || {})) {
        if (u.type === 'sampler2D') continue;
        const uu = (p.sm.uniformsFrag && p.sm.uniformsFrag[name]) || u;
        if (!uu.material) continue;
        let raw = p.ef.constants[uu.material];
        if (raw === undefined && uu.default !== undefined) raw = uu.default;
        const v = convertUniform(uu.type, raw);
        if (v == null) continue;
        setU(p.locs[name], v.length === 1 ? v[0] : v);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      input = target;
    });
    return input;
  }

  function render(t) {
    if (!res) return;
    // ① 每对象效果链（输出 = 对象纹理空间的合成结果）
    const outputs = res.objects.map((o) => renderObjectChain(o, t));
    // ② 合成 pass：按场景对象顺序 src-over（CPU canvas 直 alpha 同款）
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, CW, CH);
    const c = geo.clearcolor;
    gl.clearColor(c[0], c[1], c[2], c[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(res.presentProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    bindQuad(res.presentProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(res.presentLocs.u_Tex, 0);
    res.objects.forEach((o, i) => {
      const g = o.geo;
      gl.bindTexture(gl.TEXTURE_2D, outputs[i].tex);
      const mvp = _weGLMvpWithZRot(_weGLQuadMVP(CW, CH, g.dx, g.dy, g.dw, g.dh), g.anglesZ, g.dw, g.dh);
      gl.uniformMatrix4fv(res.presentLocs.u_MVP, false, mvp);
      gl.uniform1f(res.presentLocs.u_ObjectAlpha, g.alpha);
      gl.uniform1f(res.presentLocs.u_Brightness, g.brightness);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    });
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
    const t = rateBase + ((now - wallBase) / 1000) * playbackRate;
    stats.lastT = t;
    render(t);
    if (!readyFired) {
      readyFired = true;
      state = 'GL_RUN';
      try { onReady(); } catch { /* 调用方异常不中断渲染 */ }
    }
  }
  function startLoop() {
    if (running || disposed || !res || paused) return;
    running = true;
    lastNow = 0;
    rafId = requestAnimationFrame(loop);
  }
  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
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
      // shader fetch（编译先于纹理下载；多对象：收集全部对象用到的效果目录）
      shaderMeta = {};
      for (const obj of meta.scene.objects || []) {
        for (const ef of obj.effects || []) {
          if (shaderMeta[ef.dir]) continue;
          shaderMeta[ef.dir] = await fetchJson(BASE + '/scene-shader/' + token + '/' + ef.dir, 5000);
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
    // 降级清单（host gate 分层产物；客户端设置面板提示用；空数组 = 完整渲染）
    degraded: () => (meta && Array.isArray(meta.degraded) ? meta.degraded : []),
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
