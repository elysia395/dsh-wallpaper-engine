// WE GPU 后端 — 单 pass 效果 WebGL 执行器
// 输入: 预处理 shader 源码 (fragPre/vertPre) + uniform 值 + 纹理 → RGBA
// 流程: 编译 shader → 上传纹理 (g_Texture0..N) → uniform 注入 → FBO 全分辨率
//       → drawArrays 全屏 quad → readPixels → {width,height,rgba}
// 任何失败抛错 → 调用方回退 CPU (不破坏现有功能)
import { createGLContext } from './gl-core.js';
import { toWebGLSource } from './gl-shim.js';

// 编译缓存: key = stage + source → WebGLProgram (同进程复用)
let _programCache = new Map();
let _gl = null;
let _quad = null;
// 纹理上传缓存: texData 对象 → GPU 纹理 (同进程复用, 避免每帧 re-upload)。
// 场景动画多帧复用同一 img 对象 → 只上传一次, 后续帧直接绑定。
// sf41b 显存泄漏修复: key 是对象引用, 多帧动画每帧新 Canvas/中间结果 →
// 无限新增 GPU 纹理 → 显存螺旋上升。加 LRU 上限 (超过释放最旧) +
// 每帧临时纹理快速淘汰 — 只保留跨帧复用的稳定纹理 (pkg 纹理)。
const TEX_CACHE_MAX = 24;
let _texCache = new Map(); // texData → { tex, lastUse }
function texCacheGet(texData) {
  const e = _texCache.get(texData);
  if (e) { e.lastUse = _texUseSeq++; return e.tex; }
  return null;
}
function texCacheSet(gl, texData, tex) {
  if (_texCache.size >= TEX_CACHE_MAX) evictOldest(gl);
  _texCache.set(texData, { tex, lastUse: _texUseSeq++ });
  return tex;
}
function evictOldest(gl) {
  let oldestKey = null, oldestUse = Infinity;
  for (const [k, v] of _texCache) {
    if (v.lastUse < oldestUse) { oldestUse = v.lastUse; oldestKey = k; }
  }
  if (oldestKey != null) {
    const e = _texCache.get(oldestKey);
    try { gl.deleteTexture(e.tex); } catch { /* ignore */ }
    _texCache.delete(oldestKey);
  }
}
let _texUseSeq = 0;
// FBO/colorTex 复用池 (sf41e 显存修复): 每帧渲染创建/删除 FBO (1080p colorTex
// = 8.3MB) — ANGLE 的 deleteFramebuffer/deleteTexture 不立即归还显存, 多帧
// 动画 240 帧 × 多效果 = 数百次新建 → 显存螺旋上升 (实测 5GB 峰值接近 8GB 上限
// → 70-80% 帧后显存换页变慢出错)。改为按尺寸缓存 FBO+colorTex, 用完归还复用。
let _fboPool = new Map(); // "w x h" → [{fbo, tex}, ...] 可用池
const FBO_POOL_MAX = 8; // 每种尺寸最多留 8 个 (效果链乒乓需要 2+)
function acquireFbo(gl, width, height) {
  const key = width + ' x ' + height;
  const pool = _fboPool.get(key);
  if (pool && pool.length) return pool.pop();
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.activeTexture(gl.TEXTURE15);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, key };
}
function releaseFbo(gl, fbo) {
  if (!fbo) return;
  const pool = _fboPool.get(fbo.key);
  if (!pool) _fboPool.set(fbo.key, [fbo]);
  else if (pool.length < FBO_POOL_MAX) pool.push(fbo);
  else {
    try { gl.deleteTexture(fbo.tex); } catch { /* ignore */ }
    try { gl.deleteFramebuffer(fbo.fbo); } catch { /* ignore */ }
  }
}
// 空采样兜底: null sampler 必须绑白纹理 (CPU _texSample(null) → [1,1,1,1];
// 不绑则 GL 默认采样 unit 0 = 场景输入图 → GPU/CPU 输出分歧, 实测 Pulse+ 差 158)。
let _whiteTex = null;
function getWhiteTex(gl) {
  if (!_whiteTex) {
    _whiteTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, _whiteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  return _whiteTex;
}

function getGL() {
  if (!_gl) {
    _gl = createGLContext(64, 64);
    if (!_gl) throw new Error('WebGL 不可用');
    _quad = null;
  }
  return _gl;
}

function compileShader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) || '';
    gl.deleteShader(s);
    throw new Error('shader 编译失败: ' + log.slice(0, 300));
  }
  return s;
}

/**
 * 编译 vert+frag → WebGLProgram (带缓存)。
 * @param {object} gl WebGL 上下文
 * @param {string} fragPre 预处理后 frag 源码
 * @param {string|null} vertPre 预处理后 vert 源码 (null → 默认全屏 quad vert)
 */
export function buildProgram(gl, fragPre, vertPre) {
  const fSrc = toWebGLSource(fragPre, 'fragment').source;
  const vSrc = vertPre ? toWebGLSource(vertPre, 'vertex').source : defaultVertFor(fragPre);
  const key = hash(fSrc) + ':' + (vSrc ? hash(vSrc) : 'd');
  if (_programCache.has(key)) return _programCache.get(key);
  const prog = gl.createProgram();
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fSrc);
  const vs = compileShader(gl, gl.VERTEX_SHADER, vSrc);
  gl.attachShader(prog, fs);
  gl.attachShader(prog, vs);
  gl.linkProgram(prog);
  gl.deleteShader(fs);
  gl.deleteShader(vs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || '';
    gl.deleteProgram(prog);
    throw new Error('program 链接失败: ' + log.slice(0, 300));
  }
  _programCache.set(key, prog);
  return prog;
}

// 默认 vert: 全屏 quad, 动态生成 frag 所需的全部 varying
// frag 可能声明 v_TexCoord(UV), v_Direction(方向), v_TexCoordPerspective 等;
// 这里扫描 fragPre 的 varying 声明, 为每个生成输出:
//   v_TexCoord = uv.xyxy (zw 同 uv — mask 同尺寸兜底)
//   v_Direction = (0,1) (默认向下, 效果参数 direction 由 uniform 驱动)
//   其他 vecN varying = 0 / uv 扩展
function defaultVertFor(fragPre) {
  const varyings = [];
  const re = /\bvarying\s+(vec[234]|float)\s+(\w+)\s*;/g;
  let m;
  while ((m = re.exec(fragPre || ''))) varyings.push({ type: m[1], name: m[2] });
  const parts = [];
  parts.push('attribute vec2 a_pos;');
  for (const v of varyings) parts.push('varying ' + v.type + ' ' + v.name + ';');
  parts.push('void main() {');
  for (const v of varyings) {
    if (v.name === 'v_TexCoord') parts.push('  v_TexCoord = vec4(a_pos * 0.5 + 0.5, a_pos * 0.5 + 0.5);');
    else if (v.name === 'v_Direction') parts.push('  v_Direction = vec2(0.0, 1.0);');
    else if (v.name === 'v_Direction2') parts.push('  v_Direction2 = vec2(1.0, 0.0);');
    else if (v.name === 'v_TexCoordPerspective') parts.push('  v_TexCoordPerspective = vec3(a_pos * 0.5 + 0.5, 1.0);');
    else if (v.type === 'vec2') parts.push('  ' + v.name + ' = a_pos * 0.5 + 0.5;');
    else if (v.type === 'vec3') parts.push('  ' + v.name + ' = vec3(a_pos * 0.5 + 0.5, 1.0);');
    else if (v.type === 'vec4') parts.push('  ' + v.name + ' = vec4(a_pos * 0.5 + 0.5, a_pos * 0.5 + 0.5);');
    else parts.push('  ' + v.name + ' = 0.0;');
  }
  parts.push('  gl_Position = vec4(a_pos, 0.0, 1.0);');
  parts.push('}');
  return parts.join('\n');
}

// 全屏 quad 顶点缓冲 (position xyz + texcoord uv, stride 20)
// 支持官方 vert 的 a_Position(vec3) + a_TexCoord(vec2) 与默认 vert 的 a_pos
function getQuad(gl) {
  if (!_quad) {
    _quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, _quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0, 0,
       1, -1, 0, 1, 0,
      -1,  1, 0, 0, 1,
       1,  1, 0, 1, 1,
    ]), gl.STATIC_DRAW);
  }
  return _quad;
}

// 绑定顶点 attribute: 官方 vert 用 a_Position(vec3)/a_TexCoord(vec2),
// 默认 vert 用 a_pos(vec2)。quad 数据 = [pos.xyz, uv.xy] 交错, stride 20B。
// 注: supreium/ANGLE 的 getActiveAttrib size 可能报 1 (vec3 也报 1),
// 必须按名字硬编码分量数。
function bindAttributes(gl, prog) {
  const n = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
  const quad = getQuad(gl);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  const STRIDE = 20;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveAttrib(prog, i);
    if (!info) continue;
    const nm = info.name;
    const loc = gl.getAttribLocation(prog, nm);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    if (/a_Position|a_pos/.test(nm)) gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, STRIDE, 0);
    else if (/a_TexCoord|a_uv|a_texcoord/i.test(nm)) gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, STRIDE, 12);
    else gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, STRIDE, 12); // 未知 → uv 兜底
  }
}

// uniform 注入
function setUniform(gl, prog, name, value) {
  const loc = gl.getUniformLocation(prog, name);
  if (loc === null) return;
  if (value == null) return;
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    const arr = ArrayBuffer.isView(value) ? value : Float32Array.from(value);
    const n = arr.length;
    if (n === 2) gl.uniform2fv(loc, arr);
    else if (n === 3) gl.uniform3fv(loc, arr);
    else if (n === 4) gl.uniform4fv(loc, arr);
    else if (n === 9) gl.uniformMatrix3fv(loc, false, arr);
    else if (n === 16) gl.uniformMatrix4fv(loc, false, arr);
    else gl.uniform1fv(loc, arr);
    return;
  }
  if (typeof value === 'number') gl.uniform1f(loc, value);
  else if (typeof value === 'boolean') gl.uniform1i(loc, value ? 1 : 0);
}

// 判断值是否为纹理对象 ({width,height,rgba})
const isTex = (v) => v && typeof v === 'object' && v.rgba && typeof v.width === 'number';

/**
 * 在 WebGL 上执行单 pass 效果。
 * @param {object} opts
 * @param {string} opts.fragPre 预处理后 frag 源码
 * @param {string|null} opts.vertPre 预处理后 vert 源码
 * @param {object} opts.u uniform 值 (标量/数组/纹理对象)
 * @param {number} opts.width 输出宽度
 * @param {number} opts.height 输出高度
 * @returns {{width,height,rgba}} 结果
 */
export function runEffectOnGL({ fragPre, vertPre = null, u = {}, width, height }) {
  const gl = getGL();
  const prog = buildProgram(gl, fragPre, vertPre);
  gl.useProgram(prog);

  // ── 纹理上传 + sampler 单元绑定: u 里值为纹理对象的条目 = sampler ──
  // 上传缓存: 同一 texData 对象 (场景多帧复用) 只 upload 一次, 后续绑定缓存
  // GPU 纹理 — 减少 4K 纹理每帧 re-upload (每帧 ~5ms + 同步开销)。
  const texEntries = Object.entries(u).filter(([, v]) => isTex(v));
  const unitByTex = new Map(); // 纹理对象 → 单元号 (同一纹理多 uniform 复用)
  let nextUnit = 0;
  // null sampler (WE 默认 util/noise 等未提供 → 引擎填白) 先收集, 后面统一
  // 绑白纹理 — CPU _texSample(null) → [1,1,1,1], GPU 不绑则采样 unit 0 出错。
  const nullSamplers = Object.entries(u).filter(([name, v]) => v == null && /^g_Texture\d+$/.test(name));
  for (const [name, texData] of texEntries) {
    let unit = unitByTex.get(texData);
    if (unit === undefined) {
      unit = nextUnit++;
      let t = texCacheGet(texData);
      if (!t) {
        t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texData.width, texData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData.rgba);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        texCacheSet(gl, texData, t);
      } else {
        // 缓存命中: 绑定到当前单元 (缓存纹理存于原单元, 需重新绑定到新单元)
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
      }
      unitByTex.set(texData, unit);
    }
    const loc = gl.getUniformLocation(prog, name);
    if (loc !== null) gl.uniform1i(loc, unit);
  }

  // null sampler → 绑共享白纹理 (与 CPU _texSample(null)=white 对齐)
  if (nullSamplers.length) {
    const white = getWhiteTex(gl);
    gl.activeTexture(gl.TEXTURE0 + nextUnit);
    gl.bindTexture(gl.TEXTURE_2D, white);
    for (const [name] of nullSamplers) {
      const loc = gl.getUniformLocation(prog, name);
      if (loc !== null) gl.uniform1i(loc, nextUnit);
    }
    nextUnit++;
  }

  // ── 其余 uniform 注入 (标量/数组) ──
  for (const [name, value] of Object.entries(u)) {
    if (isTex(value)) continue; // 已处理
    setUniform(gl, prog, name, value);
  }

  // ── FBO 渲染 ──
  // 注意: colorTex 创建时 gl.bindTexture 会绑定到"当前 active unit" —
  // 若当前单元恰是采样纹理单元, 会覆盖采样绑定 (DUALWAVES 等多 uniform
  // shader 实测输出全 0)。切到独立的高位单元 (TEXTURE15) 创建, 避免覆盖。
  // sf41e: FBO/colorTex 从复用池取 (跨帧复用, 防显存螺旋)。
  const fboObj = acquireFbo(gl, width, height);
  const fbo = fboObj.fbo, colorTex = fboObj.tex;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    releaseFbo(gl, fboObj);
    throw new Error('FBO 不完整 (' + width + 'x' + height + ')');
  }
  gl.viewport(0, 0, width, height);

  bindAttributes(gl, prog);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.finish();

  // ── readPixels 读回 (全分辨率) ──
  // UV 约定核对 (与 CPU renderGlsl 一致): 引擎 y=0 顶行 = a_TexCoord v=0 =
  // 纹理首行 (texImage2D 首字节)。GL 左下角 = v=0 → readPixels 行0 即引擎顶行,
  // **不需要 Y 翻转** (flipY 会把顶行错采到源底部 — 实测蓝通道 199 异常)。
  const out = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);

  // 清理: FBO/colorTex 归还复用池 (不 delete — ANGLE 延迟释放导致显存螺旋);
  // 采样纹理保留在 _texCache (复用)
  releaseFbo(gl, fboObj);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { width, height, rgba: out };
}

/**
 * 连续效果链在 GPU 内执行 (FBO 乒乓, 中间结果不读回 CPU)。
 * 每个效果的输入是前一个效果的 GPU 输出 — 大幅减少纹理上传/readPixels/
 * CPU 组装 (4 次独立调用 ~400ms → 单会话 ~35ms, 91% 节省)。
 * @param {Array<{fragPre,vertPre,u}>} effects 按顺序执行的效果列表
 * @param {number} width 输出宽度
 * @param {number} height 输出高度
 * @returns {{width,height,rgba}} 最终结果
 */
export function runEffectChainOnGL(effects, width, height) {
  if (!effects || !effects.length) return null;
  const gl = getGL();
  // 全部 program 编译 (缓存)
  const programs = effects.map((e) => ({ prog: buildProgram(gl, e.fragPre, e.vertPre), u: e.u || {} }));

  // 输入纹理上传 (所有效果需要的 sampler 纹理)
  // 第一个效果的 g_Texture0 = 场景输入纹理 (由调用方传入 u)
  // 中间结果: 每个效果输出到 FBO, 作为下一个效果的 g_Texture0

  // 上传所有非 "中间结果" 的纹理 (u 里非 img 的纹理对象)
  // unit 0 预留给中间结果 FBO (g_Texture0), 其余纹理从 unit 1 起
  const unitByTex = new Map();
  let nextUnit = 1;
  const uploadTex = (texData) => {
    let unit = unitByTex.get(texData);
    if (unit === undefined) {
      unit = nextUnit++;
      let t = texCacheGet(texData);
      if (!t) {
        t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texData.width, texData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData.rgba);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        texCacheSet(gl, texData, t);
      } else {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
      }
      unitByTex.set(texData, unit);
    }
    return unit;
  };

  // 场景输入纹理 (第一个效果的 g_Texture0): 从第一个效果的 u 取, 绑到 unit 0
  const firstU = programs[0].u;
  const firstTex = Object.entries(firstU).find(([n, v]) => isTex(v) && /g_Texture0/.test(n));
  let sceneTexUnit = 0;
  if (firstTex) {
    const t = uploadTex(firstTex[1]);
    sceneTexUnit = t; // uploadTex 从 unit 1 起, 但 g_Texture0 需 unit 0 — 重新绑定
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texCacheGet(firstTex[1]));
  }

  // 创建两个 FBO (乒乓) — sf41e: 从复用池取 (防显存螺旋)
  const mkFbo = () => acquireFbo(gl, width, height);
  const fboA = mkFbo(), fboB = mkFbo();

  // 逐效果执行
  const lastIdx = programs.length - 1;
  for (let i = 0; i < programs.length; i++) {
    const { prog, u } = programs[i];
    gl.useProgram(prog);
    // 绑定本效果 uniforms: sampler 从 u 取 (g_Texture0 用 curInputUnit)
    const texEntries = Object.entries(u).filter(([, v]) => isTex(v));
    // null sampler → 白纹理兜底 (与 runEffectOnGL 一致)
    const nullSamplers = Object.entries(u).filter(([n, v]) => v == null && /^g_Texture\d+$/.test(n) && !/^g_Texture0$/.test(n));
    for (const [name, texData] of texEntries) {
      if (/g_Texture0/.test(name)) {
        // 输入: i=0 用场景纹理 (unit 0), i>0 用上一 FBO 输出 (unit 0)
        let inputTex = null;
        if (i === 0) {
          const cached = texCacheGet(firstTex[1]);
          if (cached) inputTex = cached;
          else { const t = uploadTex(firstTex[1]); inputTex = texCacheGet(firstTex[1]); }
        } else {
          inputTex = (i % 2 === 1) ? fboA.tex : fboB.tex;
        }
        const unit = 0;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, inputTex);
        gl.uniform1i(gl.getUniformLocation(prog, name), unit);
        continue;
      }
      const unit = uploadTex(texData);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    }
    if (nullSamplers.length) {
      const white = getWhiteTex(gl);
      gl.activeTexture(gl.TEXTURE0 + nextUnit);
      gl.bindTexture(gl.TEXTURE_2D, white);
      for (const [name] of nullSamplers) {
        gl.uniform1i(gl.getUniformLocation(prog, name), nextUnit);
      }
      nextUnit++;
    }
    for (const [name, value] of Object.entries(u)) {
      if (isTex(value)) continue;
      setUniform(gl, prog, name, value);
    }
    // 渲染到目标 FBO (最后一个 → fboA 读回)
    const target = (i % 2 === 0) ? fboA : fboB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, width, height);
    bindAttributes(gl, prog);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // 读回最后结果 (最后一个效果输出在 fboA 或 fboB — i 偶数 → fboA)
  const finalFbo = (lastIdx % 2 === 0) ? fboA : fboB;
  gl.bindFramebuffer(gl.FRAMEBUFFER, finalFbo.fbo);
  gl.finish();
  const out = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  // 清理: FBO/colorTex 归还复用池 (防显存螺旋)
  releaseFbo(gl, fboA);
  releaseFbo(gl, fboB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { width, height, rgba: out };
}

// Y 翻转 (WebGL readPixels 原点左下 → 引擎 Y-down 顶下)
function flipY(rgba, w, h) {
  const row = new Uint8Array(w * 4);
  for (let y = 0; y < (h >> 1); y++) {
    const top = y * w * 4, bot = (h - 1 - y) * w * 4;
    row.set(rgba.subarray(top, top + w * 4));
    rgba.copyWithin(top, bot, bot + w * 4);
    rgba.set(row, bot);
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 进程退出清理 (sf41b: 完整释放纹理 + FBO 池, 防显存泄漏) */
export function disposeGPU() {
  try {
    if (_gl) {
      for (const [, e] of _texCache) { try { _gl.deleteTexture(e.tex); } catch { /* ignore */ } }
      for (const [, pool] of _fboPool) {
        for (const f of pool) {
          try { _gl.deleteTexture(f.tex); } catch { /* ignore */ }
          try { _gl.deleteFramebuffer(f.fbo); } catch { /* ignore */ }
        }
      }
      try { if (_whiteTex) _gl.deleteTexture(_whiteTex); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  _texCache.clear();
  _fboPool.clear();
  _whiteTex = null;
  _gl = null;
  _programCache.clear();
  _quad = null;
}
