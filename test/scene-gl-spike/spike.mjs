// Phase 0 spike — 官方 shader 逐字编译的 WebGL2 渲染（plan-scene-webgl §6.3 / 附录 §2-§5）
// URL 参数:
//   t=3.7            冻结时间（秒）
//   res=lwe|a|b      g_TextureNResolution 约定（判别实验①）:
//                      lwe = (mip0.w, mip0.h, header.w, header.h)  [linux-wallpaperengine 实测约定]
//                      a   = (w, h, 1/w, 1/h)                      [社区文档约定]
//                      b   = (objW, objH, texW, texH)              [本仓库 executor.js engineInject]
//   slot0wrap=clamp|repeat   主图环绕（判别实验⑤，默认 clamp=跟 CPU）
//   angles=<deg>     对象绕 z 旋转（判别实验②，默认 0）
//   fx=waterripple,iris      效果白名单（默认全开，调试用）
//   animate=1        动画模式（冻结归因实验用），帧时记录到 window.__frameTimes
//   glass=1          叠加玻璃面板（冻结归因实验②③）
// 输出: window.__capturePNG = dataURL（readPixels → 2D canvas）；window.__errors / __frameTimes
import { SCENE_DATA } from './scene-data.mjs';

const Q = new URLSearchParams(location.search);
const T = parseFloat(Q.get('t') ?? '3.7');
const RES_MODE = Q.get('res') || 'lwe';
const SLOT0_WRAP = (Q.get('slot0wrap') || 'clamp').toUpperCase();
const ANGLES_RAD = parseFloat(Q.get('angles') || '0'); // 弧度（对齐 CPU/lwe 的 scene.json 语义）
const FX_ON = new Set((Q.get('fx') || 'waterripple,iris').split(','));
const ANIMATE = Q.get('animate') === '1';

window.__errors = [];
window.__frameTimes = [];
window.__capturePNG = null;
const hud = document.getElementById('hud');
const err = (m) => { window.__errors.push(String(m)); hud.textContent = window.__errors.join('\n'); console.error(m); };

if (Q.get('glass') === '1') for (const el of document.querySelectorAll('.glass-panel')) el.hidden = false;

// ---------- 附录 §1: 最小 common.h / common_perspective.h（host 内置 stub 的 spike 内联版）----------
const COMMON_H = `
#define M_PI   3.14159265358979323846
#define M_PI_2 1.57079632679489661923
#define M_PI_4 0.78539816339744830962
#define mul(v, m) ((v) * (m))
#define frac fract
#define lerp mix
#define saturate(x) clamp((x), 0.0, 1.0)
#define CAST2(x) vec2(x)
#define CAST3(x) vec3(x)
#define CAST4(x) vec4(x)
#define CAST3X3(x) mat3(x)
vec2 rotateVec2(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}
`;
const COMMON_PERSPECTIVE_H = `
mat3 squareToQuad(vec2 p0, vec2 p1, vec2 p2, vec2 p3) {
    float dx1 = p1.x - p2.x, dy1 = p1.y - p2.y;
    float dx2 = p3.x - p2.x, dy2 = p3.y - p2.y;
    float sx  = p0.x - p1.x + p2.x - p3.x;
    float sy  = p0.y - p1.y + p2.y - p3.y;
    float den = dx1 * dy2 - dy1 * dx2;
    float g = (sx * dy2 - sy * dx2) / den;
    float h = (dx1 * sy - dy1 * sx) / den;
    float a = p1.x - p0.x + g * p1.x;
    float b = p3.x - p0.x + h * p3.x;
    float c = p0.x;
    float d = p1.y - p0.y + g * p1.y;
    float e = p3.y - p0.y + h * p3.y;
    float f = p0.y;
    return mat3(a, d, g,  b, e, h,  c, f, 1.0);
}
`;
const INCLUDES = { 'common.h': COMMON_H, 'common_perspective.h': COMMON_PERSPECTIVE_H };

function expandIncludes(src, seen = new Set()) {
  return src.replace(/#include\s+"([^"]+)"/g, (m, inc) => {
    if (seen.has(inc)) return '';
    seen.add(inc);
    const s = INCLUDES[inc];
    if (s == null) { err('unknown include: ' + inc); return ''; }
    return '\n' + expandIncludes(s, seen) + '\n';
  });
}

// ---------- 附录 §2.1: ES 1.00 原样编译（define 头 = combos 表遍历 + texSample2D + precision）----------
function assembleGLSL(expandedSrc, combosTable, comboValues) {
  if (/^\s*#version/m.test(expandedSrc)) throw new Error('unexpected #version in WE shader');
  let head = '';
  for (const name of Object.keys(combosTable || {})) head += `#define ${name} ${comboValues[name] ?? 0}\n`;
  head += '#define texSample2D texture2D\nprecision highp float;\nprecision highp int;\n';
  // spike 实测修正：官方 shader 的 int 字面量用于 float 上下文——严格 ES 1.00 禁止
  // int→float 隐式转换，SwiftShader/ANGLE 拒绝（WE 官方引擎的编译器宽松放行）。
  // 最小文本修正（白名单两效果的全部实测案例，不动 loop counter/数组下标）：
  const body = expandedSrc
    .replace(/\* 2 - 1\b/g, '* 2.0 - 1.0')            // waterripple.frag n1/n2
    .replace(/smoothstep\(1 - g_Rough, 1,/, 'smoothstep(1.0 - g_Rough, 1.0,'); // iris.vert
  return head + body + '\n';
}

// combos 表（spike 硬编码 = parseMetaGL 预期产物）：两 shader 元注释合并
//   waterripple.frag: [COMBO_OFF] SPECULAR default 0; textures 元注释 combo MASK（无默认→纹理派生）
//   waterripple.vert: [COMBO] PERSPECTIVE default 0
//   iris.frag: [COMBO] BACKGROUND default 0; g_Texture1 combo MASK（纹理派生）
const COMBOS = { PERSPECTIVE: 0, SPECULAR: 0, BACKGROUND: 0, MASK: 0 }; // MASK 值在纹理解析后填 1

// ---------- 附录 §3: 顶点数据（全 pass 共用）----------
// spike 实测重大修正：v 轴必须 y-down（v=0=图顶），不用 flipY 上传。
// 原因：WE shader 血统是 HLSL/D3D（mul(v,m) 行向量、texSample2D 宏）——官方语义
// v=0 在图顶、纹理行 0=图顶。waterripple.vert 把 g_Time 直接加进 v：y-up（flipY）
// 会让 frac(v_gl+c) 与 CPU 的 frac(v_cpu+c) 互为镜像 → 法线场采样位置完全不同
// （实测：位移场方向全错）。y-down 下 GL 每个 (u,v) 与 CPU 逐点对齐。
// FBO 链一致性：效果 pass 的 MVP 必须把图顶映到 NDC y=−1（→FBO t=0），
// 这样下一 pass 读 t=0 = 图顶 ✓；present pass 用正常 MVP（图顶→NDC+1=屏幕上）——
// 即效果 pass MVP 的 y 行取负。
const VERTS = new Float32Array([
  -0.5,  0.5, 0,  0, 0,   // 左上 v=0（图顶）
   0.5,  0.5, 0,  1, 0,   // 右上
  -0.5, -0.5, 0,  0, 1,   // 左下 v=1（图底）
   0.5, -0.5, 0,  1, 1,   // 右下
]);
const IDX = new Uint16Array([0, 2, 1, 1, 2, 3]);

// ---------- 附录 §4: MVP ----------
function quadMVP(W, H, dx, dy, dw, dh, flipY = false) {
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
function mvpWithZRot(m, rad, dw, dh) {
  if (!rad) return m;
  // 方向锁定（判别实验②，反旋拟合法定向实测）：CPU 正角 = 屏幕逆时针（CCW），
  // GL 需 r = −rad。像素空间刚体旋转（实测修正）：NDC/本地空间各向异性（960×540），
  // 直接 rotZ 会在屏幕上缩成 17.6°（tan⁻¹((540/960)·tan30°)）；先 S=diag(dw,dh) 到
  // 像素等距空间、旋转、再 S⁻¹：R' = S⁻¹·RotZ(r)·S = [[c, −s·dh/dw],[s·dw/dh, c]]。
  const r = -rad;
  const c = Math.cos(r), s = Math.sin(r);
  const kx = dw / dh, ky = dh / dw;
  const R = new Float32Array([c, s * kx, 0, 0, -s * ky, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // local 左乘: M' = M · R（列主序）
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += m[k * 4 + row] * R[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
}

// present pass（附录 §4 自写 shader）
const PRESENT_VERT = `
attribute vec3 a_Position; attribute vec2 a_TexCoord;
varying vec2 v_UV; uniform mat4 u_MVP;
void main(){ v_UV = a_TexCoord.xy; gl_Position = u_MVP * vec4(a_Position, 1.0); }
`;
const PRESENT_FRAG = `
precision highp float;
varying vec2 v_UV; uniform sampler2D u_Tex; uniform float u_ObjectAlpha;
void main(){ vec4 c = texture2D(u_Tex, v_UV); gl_FragColor = vec4(c.rgb, c.a * u_ObjectAlpha); }
`;

// ---------- 场景常量（scene.json 实测值）----------
const ORTHO = { w: 3840, h: 2160 };
const OBJ = { origin: [1920, 1080], size: [3840, 2160] };
const EFFECTS = [
  { dir: 'waterripple',
    constants: { animationspeed: 0.15000001, ratio: 1, ripplestrength: 0.1, scale: 1, scrolldirection: 0, scrollspeed: 0 },
    textures: [null, 'masks__waterripple_mask_206a0206.png', 'effects__waterripplenormal.png'] },
  { dir: 'iris',
    constants: { noiseamount: 0.5, phase: 0, rough: 0.2, scale: '1 1', speed: 1 },
    textures: [null, 'masks__iris_mask_d44b353d.png'] },
];
// material→uniform 映射（附录 §5；parseMetaGL 的 uniforms 表预期产物，spike 硬编码）
const UNIFORM_MAP = {
  waterripple: { g_AnimationSpeed: 'animationspeed', g_Scale: 'scale', g_ScrollSpeed: 'scrollspeed',
                 g_Direction: 'scrolldirection', g_Ratio: 'ratio', g_Strength: 'ripplestrength',
                 g_SpecularPower: 'ripplespecularpower', g_SpecularStrength: 'ripplespecularstrength',
                 g_SpecularColor: 'ripplespecularcolor' },
  iris: { g_Scale: 'scale', g_Speed: 'speed', g_Rough: 'rough', g_NoiseAmount: 'noiseamount',
          g_PhaseOffset: 'phase', g_EyeColor: 'color' },
};
const UNIFORM_DEFAULTS = { // 元注释 default（material 常量缺失时）
  ripplespecularpower: 1, ripplespecularstrength: 1, ripplespecularcolor: '1 1 1', color: '1 1 1',
};

// ---------- g_TextureNResolution 三约定（判别实验①）----------
function resolutionVec(mode, texW, texH) {
  if (mode === 'a') return [texW, texH, 1 / texW, 1 / texH];
  if (mode === 'b') return [OBJ.size[0], OBJ.size[1], texW, texH];
  return [texW, texH, texW, texH]; // lwe: (mip0.w, mip0.h, header.w, header.h)，本场景 header==mip0
}

async function loadTex(gl, file, { wrap, mip }) {
  const resp = await fetch('./assets/' + file);
  if (!resp.ok) throw new Error('fetch ' + file + ' → ' + resp.status);
  const blob = await resp.blob();
  // 上传不翻转（imageOrientation 默认 none）：t=0 = PNG 行 0 = 图顶 = CPU v=0
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const bw = bmp.width, bh = bmp.height; // close() 后 width/height 归零，先取
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  const w = wrap === 'REPEAT' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mip) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  bmp.close();
  return { tex, w: bw, h: bh };
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    err(label + ' compile: ' + gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}
function link(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { err(label + ' link: ' + gl.getProgramInfoLog(p)); return null; }
  return p;
}

function makeFBO(gl, w, h) {
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
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) err('FBO incomplete');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

async function main() {
  const canvas = document.getElementById('glcanvas');
  canvas.width = parseInt(Q.get('w') || '960', 10);
  canvas.height = parseInt(Q.get('h') || '540', 10);
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';
  // 冻结归因实验①代理：ctx=webgl1 用 WebGL1 上下文（ES 1.00 shader 本就兼容），
  // aa=1/depth=1 复刻 scene-player.js:39 的上下文属性
  const ctxName = Q.get('ctx') === 'webgl1' ? 'webgl' : 'webgl2';
  const gl = canvas.getContext(ctxName, {
    alpha: false, premultipliedAlpha: false,
    antialias: Q.get('aa') === '1', depth: Q.get('depth') === '1',
  });
  if (!gl) { err(ctxName + ' unavailable'); window.__ready = true; return; }

  // 几何
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, VERTS, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IDX, gl.STATIC_DRAW);

  // shader fetch + 编译（效果）
  const programs = {};
  for (const ef of EFFECTS) {
    if (!FX_ON.has(ef.dir)) continue;
    const [vertSrc, fragSrc] = await Promise.all([
      fetch(`./assets/shaders__effects__${ef.dir}.vert`).then((r) => r.text()),
      fetch(`./assets/shaders__effects__${ef.dir}.frag`).then((r) => r.text()),
    ]);
    // combo 解析（§2.4 规范）: MASK=1 ⟺ pass textures[1] 非 null
    const combos = { ...COMBOS, MASK: ef.textures[1] ? 1 : 0 };
    const vsrc = assembleGLSL(expandIncludes(vertSrc), COMBOS, combos);
    const fsrc = assembleGLSL(expandIncludes(fragSrc), COMBOS, combos);
    const vs = compile(gl, gl.VERTEX_SHADER, vsrc, ef.dir + '.vert');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsrc, ef.dir + '.frag');
    if (!vs || !fs) return;
    const prog = link(gl, vs, fs, ef.dir);
    if (!prog) return;
    programs[ef.dir] = prog;
  }
  // present program
  const pvs = compile(gl, gl.VERTEX_SHADER, PRESENT_VERT, 'present.vert');
  const pfs = compile(gl, gl.FRAGMENT_SHADER, PRESENT_FRAG, 'present.frag');
  const presentProg = link(gl, pvs, pfs, 'present');
  if (!presentProg) return;

  // 纹理（编译全过才下载 —— 附录 §8 顺序）
  const mainTex = await loadTex(gl, SCENE_DATA.textures['materials/207电脑.tex'].file, { wrap: SLOT0_WRAP, mip: false });
  const auxTex = {};
  for (const ef of EFFECTS) {
    if (!FX_ON.has(ef.dir)) continue;
    for (let slot = 1; slot < ef.textures.length; slot++) {
      const f = ef.textures[slot];
      if (f && !auxTex[f]) auxTex[f] = await loadTex(gl, f, { wrap: 'REPEAT', mip: false }); // slot1/2 REPEAT（§2.6）
    }
  }

  // FBO ×2（效果链全分辨率 = 主图分辨率，对齐 CPU staticFrame）
  const FW = mainTex.w, FH = mainTex.h;
  const fboA = makeFBO(gl, FW, FH);
  const fboB = makeFBO(gl, FW, FH);

  // 对象矩形（画布像素，CPU image.js:133-145 同款公式）
  const CW = canvas.width, CH = canvas.height;
  const ps = [CW / ORTHO.w, CH / ORTHO.h];
  const dw = OBJ.size[0] * ps[0], dh = OBJ.size[1] * ps[1];
  const dx = OBJ.origin[0] * ps[0] - dw / 2;
  const dy = CH - OBJ.origin[1] * ps[1] - dh / 2;
  // 效果 pass MVP：对象占满 ortho → 全 FBO，y 行取负（图顶→NDC−1 → FBO t=0）；
  // present MVP：画布矩形，图顶→NDC+1（angles 合成用例只转 present）
  const mvpFx = quadMVP(FW, FH, 0, 0, FW, FH, true);
  const mvpPresent = mvpWithZRot(quadMVP(CW, CH, dx, dy, dw, dh), ANGLES_RAD, dw, dh);

  function bindQuad(prog) {
    const aPos = gl.getAttribLocation(prog, 'a_Position');
    const aUV = gl.getAttribLocation(prog, 'a_TexCoord');
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 20, 12);
  }
  const setU = (prog, name, ...args) => {
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) return; // 被 #if 裁掉的 uniform → 规范 no-op（附录 §5）
    const m = args[0];
    if (m && m.$i !== undefined) gl.uniform1i(loc, m.$i); // sampler 显式标记
    else if (typeof m === 'number') gl.uniform1f(loc, m);
    else if (m.length === 16) gl.uniformMatrix4fv(loc, false, m);
    else if (m.length === 4) gl.uniform4fv(loc, m);
    else if (m.length === 3) gl.uniform3fv(loc, m);
    else if (m.length === 2) gl.uniform2fv(loc, m);
  };
  const constVal = (ef, key) => {
    let v = ef.constants[key];
    if (v === undefined) v = UNIFORM_DEFAULTS[key];
    if (v === undefined) return null;
    if (typeof v === 'number') return [v];
    return String(v).trim().split(/\s+/).map(Number);
  };

  function drawEffect(ef, prog, inputTex, target, t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : CW, target ? target.h : CH);
    gl.disable(gl.BLEND); // 效果 FBO pass 禁 BLEND（附录 §3）
    gl.useProgram(prog);
    bindQuad(prog);
    // slot0 = 链输入
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex.tex);
    setU(prog, 'g_Texture0', { $i: 0 });
    setU(prog, 'g_Texture0Resolution', resolutionVec(RES_MODE, inputTex.w, inputTex.h));
    for (let slot = 1; slot < ef.textures.length; slot++) {
      const f = ef.textures[slot];
      if (!f) continue;
      const at = auxTex[f];
      gl.activeTexture(gl.TEXTURE0 + slot);
      gl.bindTexture(gl.TEXTURE_2D, at.tex);
      setU(prog, 'g_Texture' + slot, { $i: slot });
      setU(prog, 'g_Texture' + slot + 'Resolution', resolutionVec(RES_MODE, at.w, at.h));
    }
    setU(prog, 'g_ModelViewProjectionMatrix', mvpFx);
    setU(prog, 'g_Time', t);
    for (const [uni, matKey] of Object.entries(UNIFORM_MAP[ef.dir])) {
      const v = constVal(ef, matKey);
      if (v == null) continue;
      if (v.length === 1) setU(prog, uni, v[0]);
      else setU(prog, uni, v);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  function render(t) {
    let input = mainTex;
    const chain = EFFECTS.filter((e) => FX_ON.has(e.dir));
    chain.forEach((ef, i) => {
      const target = i === chain.length - 1 ? fboB : fboA;
      drawEffect(ef, programs[ef.dir], input, target, t);
      input = target;
    });
    if (chain.length === 0) { // fx= 空调试
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      input = mainTex;
    }
    // present → 画布
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, CW, CH);
    gl.clearColor(0.7, 0.7, 0.7, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(presentProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    bindQuad(presentProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.tex);
    const uloc = gl.getUniformLocation(presentProg, 'u_Tex');
    gl.uniform1i(uloc, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(presentProg, 'u_MVP'), false, mvpPresent);
    gl.uniform1f(gl.getUniformLocation(presentProg, 'u_ObjectAlpha'), 1);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND);
  }

  function capture() {
    // readPixels（bottom-up）→ 翻回 top-down → 2D canvas → dataURL
    const px = new Uint8Array(CW * CH * 4);
    gl.readPixels(0, 0, CW, CH, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const row = CW * 4;
    const flipped = new Uint8ClampedArray(px.length);
    for (let y = 0; y < CH; y++) flipped.set(px.subarray((CH - 1 - y) * row, (CH - y) * row), y * row);
    const c2 = document.createElement('canvas');
    c2.width = CW; c2.height = CH;
    c2.getContext('2d').putImageData(new ImageData(flipped, CW, CH), 0, 0);
    window.__capturePNG = c2.toDataURL('image/png');
  }

  if (ANIMATE) {
    let last = performance.now();
    const t0 = last;
    const loop = (now) => {
      window.__frameTimes.push(now - last);
      last = now;
      render((now - t0) / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    hud.textContent = `animate mode, res=${RES_MODE}`;
  } else {
    render(T);
    capture();
    hud.textContent = `t=${T} res=${RES_MODE} slot0=${SLOT0_WRAP} angles=${ANGLES_RAD} fx=${[...FX_ON].join('+')} | errors=${window.__errors.length}`;
    document.title = window.__errors.length ? 'SPIKE_ERR' : 'SPIKE_OK';
  }
  window.__ready = true;
}

main().catch((e) => { err(e.stack || e); document.title = 'SPIKE_ERR'; window.__ready = true; });
