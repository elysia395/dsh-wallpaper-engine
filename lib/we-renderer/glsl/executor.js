// WE GLSL 效果执行器 — 编译 shader → 逐像素渲染
// 流程: include 展开 + combo 宏 → preprocess → parse → transpile → new Function
//       vert 4 角跑 varying → 双线性插值 → frag 逐像素 main() → RGBA
import { parse } from '@shaderfrog/glsl-parser';
import { transpile } from './transpile.js';
import { preprocessShader, parseMeta, sanitizeReservedWords } from './preprocess.js';
import { runtimeObject } from './runtime.js';

export function compileGlsl({ fragSource, vertSource = null, combos = {}, resolveInclude = null }) {
  // 保留字消毒 (sample 等 workshop shader 变量名) — 在 meta 解析与预处理前
  fragSource = sanitizeReservedWords(fragSource);
  if (vertSource) vertSource = sanitizeReservedWords(vertSource);
  const metaF = parseMeta(fragSource);
  const metaV = vertSource ? parseMeta(vertSource) : {};
  const meta = {
    combos: { ...metaF.combos, ...metaV.combos },
    uniforms: { ...metaF.uniforms, ...metaV.uniforms },
  };
  const fragPre = preprocessShader(fragSource, { defines: combos, resolveInclude });
  const fragAst = parse(fragPre, { stage: 'fragment', quiet: true });
  const fragCode = transpile(fragAst, 'fragment');
  let vertFn = null;
  let varyings = [];
  let vertPre = null;
  if (vertSource) {
    vertPre = preprocessShader(vertSource, { defines: combos, resolveInclude });
    const vertAst = parse(vertPre, { stage: 'vertex', quiet: true });
    const vertCode = transpile(vertAst, 'vertex');
    vertFn = new Function('__u', '__v', '__a', '__rt', vertCode);
    varyings = collectVaryings(vertAst);
  }
  const fragFn = new Function('__u', '__v', '__a', '__rt', fragCode);
  // fragPre/vertPre: 预处理后 (include 展开 + combo 宏) 的源码 — 供 GPU (WebGL)
  // 路径复用 (gpu-gl), 与 CPU 解释器同一份预处理结果保证两边一致。
  return { fragFn, vertFn, varyings, uniforms: meta.uniforms, combos: meta.combos, fragPre, vertPre };
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
      if (d.type !== 'declaration') continue;
      // 数组 varying (如 vec2 v_TexCoord[4]): 量化器 = [array_specifier]
      let count = 0;
      if (Array.isArray(d.quantifier) && d.quantifier.length) {
        for (const q of d.quantifier) {
          if (q && q.type === 'array_specifier' && q.expression && q.expression.token) {
            const n = parseInt(q.expression.token, 10);
            if (n > 0) count = n;
          }
        }
      }
      out.push({ name: d.identifier.identifier, type, count });
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
  if (type === 'bool') return !!v;
  return v;
}

// 组装 __u: 场景值 + 引擎注入
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
    case 'g_TexelSize': {
      const w = (eng.objW || 1), h = (eng.objH || 1);
      return Float32Array.from([1 / w, 1 / h]);
    }
    default: break;
  }
  // g_TextureNResolution
  const m = /^g_Texture(\d+)Resolution$/.exec(name);
  if (m) {
    const idx = Number(m[1]);
    const tex = eng.textures && eng.textures[idx];
    if (tex) {
      const w = tex.width || 0, h = tex.height || 0;
      return Float32Array.from([eng.objW || w, eng.objH || h, w, h]);
    }
    const w = eng.objW || 0, h = eng.objH || 0;
    return Float32Array.from([w, h, w, h]);
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
export function renderGlsl(compiled, { width, height, u, textures, time, sampler }) {
  const rt = runtimeObject(sampler);
  // ── vert 4 角 → varying 角值 ──
  const cornerVals = {};
  if (compiled.vertFn) {
    for (const vn of compiled.varyings) cornerVals[vn.name] = [];
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    for (const [cu, cv] of corners) {
      const __a = { a_TexCoord: [cu, cv], a_Position: [0, 0, 0] };
      // 预初始化 varying (数组型: 每元素独立 Float32Array — vert 写 v_TexCoord[i] =
      // vec2 字面量时元素槽位是数组, 赋值生效)
      const __v = {};
      for (const vn of compiled.varyings) {
        if (vn.count > 0) __v[vn.name] = Array.from({ length: vn.count }, () => new Float32Array(VEC_LEN[vn.type] || 4));
        else __v[vn.name] = new Float32Array(VEC_LEN[vn.type] || 4);
      }
      const vertCtx = compiled.vertFn(u, __v, __a, rt);
      vertCtx.main();
      if (process.env.DSH_WE_DEBUG_GLSL === '1' && __v.v_SizeMultiplier) {
        console.log('[renderGlsl] vert 角(' + cu + ',' + cv + ') v_SizeMultiplier=' + Array.from(__v.v_SizeMultiplier).map((x) => x.toFixed(4)).join(','));
      }
      for (const vn of compiled.varyings) cornerVals[vn.name].push(__v[vn.name]);
    }
  }
  // ── frag 装配 (__v 必须与像素循环共享同一对象 — 模块闭包引用构造时传入的引用) ──
  const __v = {};
  const fragCtx = compiled.fragFn(u, __v, {}, rt);
  const fragMain = fragCtx.main;
  const gl_FragColor = fragCtx.gl_FragColor;
  const out = new Uint8Array(width * height * 4);
  // 预分配 varying 插值缓冲 (数组型 varying 复用)
  const vbufs = {};
  const vbufCounts = {};
  for (const vn of compiled.varyings) {
    const c0 = cornerVals[vn.name] && cornerVals[vn.name][0];
    if (c0 && typeof c0 === 'object') {
      if (vn.count > 0 && c0.length) {
        // 数组型: 每元素一个 vec 缓冲
        vbufs[vn.name] = Array.from({ length: c0.length }, () => new Float32Array(c0[0] ? c0[0].length : (VEC_LEN[vn.type] || 4)));
        vbufCounts[vn.name] = c0.length;
      } else {
        vbufs[vn.name] = new Float32Array(c0.length);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fu = (x + 0.5) / width, fv = (y + 0.5) / height;
      for (const vn of compiled.varyings) {
        if (vbufCounts[vn.name]) {
          // 数组 varying 逐元素双线性
          const corners = cornerVals[vn.name];
          const res = vbufs[vn.name];
          const n = res.length;
          for (let e = 0; e < n; e++) {
            const a0 = corners[0][e], a1 = corners[1][e], b0 = corners[2][e], b1 = corners[3][e];
            const outv = res[e];
            for (let c = 0; c < outv.length; c++) {
              const top = a0[c] + (a1[c] - a0[c]) * fu;
              const bot = b0[c] + (b1[c] - b0[c]) * fu;
              outv[c] = top + (bot - top) * fv;
            }
          }
          __v[vn.name] = res;
        } else {
          __v[vn.name] = vbufs[vn.name]
            ? bilinearTo(cornerVals[vn.name], fu, fv, vbufs[vn.name])
            : bilinearTo(cornerVals[vn.name], fu, fv, null);
        }
      }
      fragMain();
      const di = (y * width + x) * 4;
      out[di] = Math.round(Math.min(1, Math.max(0, gl_FragColor[0])) * 255);
      out[di + 1] = Math.round(Math.min(1, Math.max(0, gl_FragColor[1])) * 255);
      out[di + 2] = Math.round(Math.min(1, Math.max(0, gl_FragColor[2])) * 255);
      out[di + 3] = Math.round(Math.min(1, Math.max(0, gl_FragColor[3])) * 255);
    }
  }
  return { width, height, rgba: out };
}

// 便捷: 一次调用编译 + 渲染 (测试用)
export function compileAndRender({ fragSource, vertSource, combos, constants, width, height, textures, time, resolveInclude, sampler }) {
  const compiled = compileGlsl({ fragSource, vertSource, combos, resolveInclude });
  const u = buildUniforms(compiled.uniforms, constants || {}, {
    time, textures, objW: width, objH: height,
  });
  // 纹理绑定: uniforms 里 sampler2D 类型 → 从 textures 按序取
  for (const [name, info] of Object.entries(compiled.uniforms)) {
    if (info.type === 'sampler2D' && u[name] === undefined) {
      const idx = Number(/g_Texture(\d+)/.exec(name)?.[1] || 0);
      u[name] = textures && textures[idx];
    }
  }
  return renderGlsl(compiled, { width, height, u, textures, time, sampler });
}
