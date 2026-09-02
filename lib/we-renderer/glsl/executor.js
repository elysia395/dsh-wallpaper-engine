// WE GLSL 效果执行器 — 编译 shader → 逐像素渲染
// 流程: include 展开 + combo 宏 → preprocess → parse → transpile → new Function
//       vert 4 角跑 varying → 双线性插值 → frag 逐像素 main() → RGBA
import { parse } from '@shaderfrog/glsl-parser';
import { transpile } from './transpile.js';
import { preprocessShader, parseMeta, expandIncludes } from './preprocess.js';
import { runtimeObject, DISCARD } from './runtime.js';

export function compileGlsl({ fragSource, vertSource = null, combos = {}, resolveInclude = null, onWarn = null }) {
  // GLS-22: 先展开 include 再取 meta — 头文件内声明的 uniform/元注释不再丢失
  const fragX = resolveInclude ? expandIncludes(fragSource, resolveInclude, { onWarn }) : fragSource;
  const vertX = vertSource && resolveInclude ? expandIncludes(vertSource, resolveInclude, { onWarn }) : vertSource;
  const metaF = parseMeta(fragX);
  const metaV = vertX ? parseMeta(vertX) : { combos: {}, uniforms: {} };
  const meta = {
    combos: { ...metaF.combos, ...metaV.combos },
    uniforms: { ...metaF.uniforms, ...metaV.uniforms },
  };
  // P2-23: 已解析的 meta 透传给 preprocessShader — 免其对同一源码再跑一次
  // parseMeta 全文正则扫描 (此前本函数 + preprocess.js 各跑一遍)
  const fragPre = preprocessShader(fragX, { defines: combos, meta: metaF });
  const fragAst = parse(fragPre, { stage: 'fragment', quiet: true });
  const fragCode = transpile(fragAst, 'fragment');
  let vertFn = null;
  let varyings = [];
  if (vertX) {
    const vertPre = preprocessShader(vertX, { defines: combos, meta: metaV });
    const vertAst = parse(vertPre, { stage: 'vertex', quiet: true });
    const vertCode = transpile(vertAst, 'vertex');
    vertFn = new Function('__u', '__v', '__a', '__rt', vertCode);
    varyings = collectVaryings(vertAst);
  }
  const fragFn = new Function('__u', '__v', '__a', '__rt', fragCode);
  return { fragFn, vertFn, varyings, uniforms: meta.uniforms, combos: meta.combos };
}

function collectVaryings(ast) {
  const out = [];
  const typeOfSpec = (spec) => {
    let s = spec;
    while (s && typeof s === 'object' && !s.token && s.specifier) s = s.specifier;
    return s && s.token ? s.token : null;
  };
  for (const node of ast.program || []) {
    if (node.type !== 'declaration_statement') continue;
    const dl = node.declaration;
    if (!dl || dl.type !== 'declarator_list') continue;
    const quals = (dl.specified_type.qualifiers || []).map((q) => q.token);
    if (!quals.includes('varying')) continue;
    const type = typeOfSpec(dl.specified_type);
    for (const d of dl.declarations || []) {
      if (d.type === 'declaration') out.push({ name: d.identifier.identifier, type });
    }
  }
  return out;
}
const VEC_LEN = { vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4, bvec2: 2, bvec3: 3, bvec4: 4 };
function makeVarying(name, type) {
  return { name, type };
}

// 值转换: 场景 constantshadervalues / 引擎值 → uniform 需要的 JS 表示
function convertUniform(type, value) {
  if (value === undefined || value === null) return null;
  if (type === 'sampler2D') return value; // 纹理对象
  if (type === 'mat4' || type === 'mat3') {
    if (Array.isArray(value) && value.length === 16) return Float32Array.from(value);
    return value;
  }
  const v = typeof value === 'object' && value !== null && 'value' in value ? value.value : value;
  if (type.startsWith('vec')) {
    if (typeof v === 'number') {
      const n = { vec2: 2, vec3: 3, vec4: 4 }[type];
      return Float32Array.from(Array(n).fill(v));
    }
    if (Array.isArray(v)) return Float32Array.from(v);
    const parts = String(v).trim().split(/\s+/).map(Number);
    return Float32Array.from(parts);
  }
  if (type === 'float' || type === 'int') {
    if (typeof v === 'object' && v !== null && 'value' in v) return Number(v.value);
    return Number(v);
  }
  if (type === 'bool') {
    // F-11: csv 字符串 "false"/"0"/"" 必须为 false (此前 !!v 把一切字符串当 true)
    if (typeof v === 'string') return !['false', '0', ''].includes(v.trim());
    if (typeof v === 'number') return v !== 0;
    return v === true;
  }
  return v;
}

// 组装 __u: 场景值 + 引擎注入 + 元注释 default 兜底
export function buildUniforms(uniformMeta, constants, engine) {
  const u = {};
  for (const [name, info] of Object.entries(uniformMeta)) {
    let val = null;
    if (info.material) {
      val = convertUniform(info.type, constants[info.material]);
    }
    if (val === null || val === undefined) {
      val = engineInject(info.type, name, engine);
    }
    // P1-38/P1-44: 材质缺值时落 shader 元注释 default (parseMeta 现保留该字段)
    if ((val === null || val === undefined) && info.default !== undefined && info.type !== 'sampler2D') {
      val = convertUniform(info.type, info.default);
    }
    if (val !== null && val !== undefined) u[name] = val;
  }
  return u;
}

function engineInject(type, name, e) {
  const eng = e || {};
  switch (name) {
    case 'g_Time': return eng.time || 0;
    case 'g_UserAlpha': return eng.userAlpha !== undefined ? eng.userAlpha : 1;
    case 'g_ParallaxPosition': return eng.parallaxPosition ? Float32Array.from(eng.parallaxPosition) : Float32Array.from([0.5, 0.5]);
    case 'g_ModelViewProjectionMatrix': return identityMat4();
    case 'g_LayerModelMatrix': return identityMat4();
    case 'g_EffectTextureProjectionMatrix': return identityMat4();
    case 'g_EffectTextureProjectionMatrixInverse': return identityMat4();
    case 'g_TextureReductionScale': return 1;
    default: break;
  }
  // g_TextureNResolution
  const m = /^g_Texture(\d+)Resolution$/.exec(name);
  if (m) {
    const idx = Number(m[1]);
    const tex = eng.textures && eng.textures[idx];
    if (tex && tex.width) {
      // P0-17/§9.2 裁决: (mip0宽, mip0高, header宽, header高)。当前纹理无独立 header
      // 尺寸 → zw=xy; 此前 (objW,objH,texW,texH) 是判别实验①明确排除的约定 (b)
      const w = tex.width, h = tex.height;
      return Float32Array.from([w, h, w, h]);
    }
    // 缺纹理: [1,1,1,1] — 分辨率缩放恒 1 (等价 §9.2 "mask UV=纯 uv" 官方语义), 不再用对象尺寸
    return Float32Array.from([1, 1, 1, 1]);
  }
  // 常量 (M_PI 等由 __rt 提供, 此处不处理)
  return null;
}

function identityMat4() {
  return Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// 双线性插值: 数组写 out 缓冲 (预分配复用), 标量直接返回
function bilinearTo(corners, u, v, out) {
  const a0 = corners[0], a1 = corners[1], b0 = corners[2], b1 = corners[3];
  if (a0 == null) return null;
  if (typeof a0 === 'number') {
    const top = a0 + (a1 - a0) * u;
    const bot = b0 + (b1 - b0) * u;
    return top + (bot - top) * v;
  }
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const top = a0[i] + (a1[i] - a0[i]) * u;
    const bot = b0[i] + (b1[i] - b0[i]) * u;
    out[i] = top + (bot - top) * v;
  }
  return out;
}

// 纹理采样器 (注入 runtime): 双线性 + clamp
export function makeSampler(sampleFn) {
  // sampleFn(tex, u, v) → [r,g,b,a] 0-1 (现有 _texSample 封装)
  return (tex, u, v) => {
    if (!tex) return [0, 0, 0, 0];
    return sampleFn(tex, u, v);
  };
}

// 渲染入口: compiled + uniforms + 纹理 → RGBA
// F-10: textures/time 是死参, 已删除 (sampler/u 由调用方组装)
export function renderGlsl(compiled, { width, height, u, sampler }) {
  const rt = runtimeObject(sampler);
  // ── vert 4 角 → varying 角值 ──
  const cornerVals = {};
  if (compiled.vertFn) {
    for (const vn of compiled.varyings) cornerVals[vn.name] = [];
    // P1-39: 4 角给真实角点 — a_Position = 全屏 quad NDC 角 (与 a_TexCoord 角一一对应,
    // 此前恒 [0,0,0] → 依赖 a_Position 的 vert 全部塌缩到单点)
    const corners = [
      { uv: [0, 0], pos: [-1, -1, 0] },
      { uv: [1, 0], pos: [1, -1, 0] },
      { uv: [0, 1], pos: [-1, 1, 0] },
      { uv: [1, 1], pos: [1, 1, 0] },
    ];
    for (const c of corners) {
      const __a = { a_TexCoord: c.uv, a_Position: c.pos };
      // 预初始化 varying 数组 (vert 里 swizzle 写分量需要已存在)
      const __v = {};
      for (const vn of compiled.varyings) {
        __v[vn.name] = new Float32Array(VEC_LEN[vn.type] || 4);
      }
      const vertCtx = compiled.vertFn(u, __v, __a, rt);
      if (vertCtx.__initGlobals) vertCtx.__initGlobals(); // GLS-26: 逐角重置全局
      vertCtx.main();
      for (const vn of compiled.varyings) cornerVals[vn.name].push(__v[vn.name]);
    }
  }
  // ── frag 装配 (__v 必须与像素循环共享同一对象 — 模块闭包引用构造时传入的引用) ──
  const __v = {};
  const fragCtx = compiled.fragFn(u, __v, {}, rt);
  const fragMain = fragCtx.main;
  const gl_FragColor = fragCtx.gl_FragColor;
  const initGlobals = fragCtx.__initGlobals || null;
  const out = new Uint8Array(width * height * 4);
  // 预分配 varying 插值缓冲 (数组型 varying 复用)
  const vbufs = {};
  for (const vn of compiled.varyings) {
    const c0 = cornerVals[vn.name] && cornerVals[vn.name][0];
    if (c0 && typeof c0 === 'object') vbufs[vn.name] = new Float32Array(c0.length);
  }
  let pixelErrors = 0;   // F-12: 逐像素异常隔离计数
  let lastError = null;
  // P1-8⑤: 循环不变量外提 — varying 角值/插值缓冲预取成局部数组;
  // 数组型 varying 的 __v 槽只绑定一次 (frag 侧只读 __v, bilinearTo 就地写
  // 复用缓冲), 免逐像素 for..of 遍历 + 三重键查找
  const arrV = [], sclV = [];
  for (const vn of compiled.varyings) {
    const buf = vbufs[vn.name];
    if (buf) { __v[vn.name] = buf; arrV.push([cornerVals[vn.name], buf]); }
    else sclV.push([vn.name, cornerVals[vn.name]]);
  }
  const nArr = arrV.length, nScl = sclV.length;
  for (let y = 0; y < height; y++) {
    const fv = (y + 0.5) / height; // 行不变量外提 (纯除法, 结果逐位不变)
    for (let x = 0; x < width; x++) {
      const fu = (x + 0.5) / width;
      for (let k = 0; k < nArr; k++) { const p = arrV[k]; bilinearTo(p[0], fu, fv, p[1]); }
      for (let k = 0; k < nScl; k++) { const p = sclV[k]; __v[p[0]] = bilinearTo(p[1], fu, fv, null); }
      if (initGlobals) initGlobals(); // GLS-26: 全局逐像素重置 (GLSL 语义; const 全局已在转译期排除)
      // P0-15: 重置残留 (discard/早退像素不泄漏到下一像素) — P1-8⑤: 显式赋值替代 fill(0) 方法调用
      gl_FragColor[0] = 0; gl_FragColor[1] = 0; gl_FragColor[2] = 0; gl_FragColor[3] = 0;
      try {
        fragMain();
      } catch (e) {
        if (e === DISCARD) continue; // P0-15/P1-32: discard → 本像素不写色
        pixelErrors++;
        lastError = e;
        if (pixelErrors > 1024) throw e; // 大面积异常 → 整帧失败 (交给上层回退, 不做百万次 catch)
        continue;
      }
      const di = (y * width + x) * 4;
      // P1-8⑤: Math.min/max 三连 (12 次 Math 调用/像素) → 比较运算 (每像素 1 次
      // Math.round); NaN 与 ±∞ 的归约路径与 Math.min(1, Math.max(0, x)) 逐位一致
      let c = gl_FragColor[0];
      out[di] = Math.round((c < 0 ? 0 : c > 1 ? 1 : c) * 255);
      c = gl_FragColor[1];
      out[di + 1] = Math.round((c < 0 ? 0 : c > 1 ? 1 : c) * 255);
      c = gl_FragColor[2];
      out[di + 2] = Math.round((c < 0 ? 0 : c > 1 ? 1 : c) * 255);
      c = gl_FragColor[3];
      out[di + 3] = Math.round((c < 0 ? 0 : c > 1 ? 1 : c) * 255);
    }
  }
  return { width, height, rgba: out, pixelErrors, lastError: lastError ? String((lastError && lastError.message) || lastError) : null };
}

// 便捷: 一次调用编译 + 渲染 (测试用)
export function compileAndRender({ fragSource, vertSource, combos, constants, width, height, textures, time, resolveInclude, sampler }) {
  const compiled = compileGlsl({ fragSource, vertSource, combos, resolveInclude });
  const u = buildUniforms(compiled.uniforms, constants || {}, {
    time, textures, objW: width, objH: height,
  });
  // 纹理绑定: uniforms 里 sampler2D 类型 → 从 textures 按序取 (官方语义: g_TextureN ↔ textures[N])
  for (const [name, info] of Object.entries(compiled.uniforms)) {
    if (info.type === 'sampler2D' && u[name] === undefined) {
      const idx = Number(/g_Texture(\d+)/.exec(name)?.[1] || 0);
      u[name] = textures && textures[idx];
    }
  }
  return renderGlsl(compiled, { width, height, u, sampler });
}
