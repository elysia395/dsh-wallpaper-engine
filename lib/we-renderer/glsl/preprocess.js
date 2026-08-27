// WE GLSL 预处理: #include 展开 + combo 宏注入 + uniform material 映射解析
import preprocess from '@shaderfrog/glsl-parser/preprocessor/index.js';

// 解析 shader 源码里的元注释:
//   // [COMBO] {"material":"...","combo":"KERNEL","default":0,...}  → combos 默认值
//   uniform <type> <name>; // {"material":"xxx",...}              → material→uniform 映射
export function parseMeta(source) {
  const combos = {}; // combo 名 → 默认值 (string)
  const uniforms = {}; // uniform 名 → { material, type }
  const comboRe = /\/\/\s*\[COMBO\]\s*(\{[\s\S]*?\})/g;
  let m;
  while ((m = comboRe.exec(source))) {
    try {
      const meta = JSON.parse(m[1]);
      if (meta.combo && meta.default !== undefined) combos[meta.combo] = String(meta.default);
    } catch {}
  }
  const unifRe = /uniform\s+([\w]+)\s+(\w+)\s*;\s*\/\/\s*(\{[\s\S]*?\})/g;
  while ((m = unifRe.exec(source))) {
    try {
      const meta = JSON.parse(m[3]);
      if (meta.material) uniforms[m[2]] = { material: meta.material, type: m[1] };
    } catch {}
  }
  // 无注释的 uniform 也收集 (引擎注入类, material=null)
  const unifPlain = /uniform\s+([\w]+)\s+(\w+)\s*;/g;
  while ((m = unifPlain.exec(source))) {
    if (!uniforms[m[2]]) uniforms[m[2]] = { material: null, type: m[1] };
  }
  return { combos, uniforms };
}

// include 展开: resolveInclude(rel) → 源码字符串
export function expandIncludes(source, resolveInclude, seen = new Set()) {
  const re = /#include\s+"([^"]+)"/g;
  let out = source;
  let m;
  while ((m = re.exec(source))) {
    const inc = m[1];
    if (seen.has(inc)) { out = out.replace(m[0], ''); continue; }
    seen.add(inc);
    let src = '';
    try { src = resolveInclude(inc); } catch {}
    if (!src) { out = out.replace(m[0], ''); continue; }
    src = expandIncludes(src, resolveInclude, seen);
    out = out.replace(m[0], '\n' + src + '\n');
  }
  return out;
}

// 完整预处理: include 展开 → combo defines 注入 → shaderfrog preprocess
export function preprocessShader(source, { defines = {}, resolveInclude = null } = {}) {
  let src = source;
  if (resolveInclude) src = expandIncludes(src, resolveInclude);
  // HLSL float 后缀 (0.0f): 官方 blur/godrays/shine gaussian vert 用 DX 语法。
  // CPU transpile 会原样输出 0.0f → new Function 语法错误; GLSL 也不接受 →
  // 统一剥离 (f/F 后缀)。
  src = src.replace(/(\d+\.\d+)f\b/gi, '$1');
  // `#require <Lib>`: WE 内置库指令 (LightingV1 等), 库源码不随 assets 分发
  // (assets 里只有 PerformLighting_V1 的调用点, 定义在引擎内置)。shaderfrog
  // 无法解析该指令 → 剥离 (所需函数仅在非默认 combo 分支内, 默认分支不含)。
  src = src.replace(/^\s*#require\s+\w+.*$/gm, '');
  // 若 combo 无默认且未注入 → 显式补 0 避免 #if 未定义报错
  const meta = parseMeta(src);
  const allDefines = {};
  for (const [k, v] of Object.entries(meta.combos)) {
    if (defines[k] === undefined) allDefines[k] = v;
  }
  Object.assign(allDefines, defines);
  // shaderfrog preprocess 的 defines 选项不生成 #define 行 — WebGL 编译
  // 需要显式宏定义 (common_blending.h 的 `#if BLENDMODE == 31` 分支) →
  // 在源码前插入 `#define <K> <V>` 行 (值带引号时去引号 — JSON default 是
  // 数字/字符串, GLSL 宏值须为数字或裸标识符)。
  const defineLines = [];
  for (const [k, v] of Object.entries(allDefines)) {
    if (v === undefined || v === null || v === '') continue;
    const val = String(v).replace(/^["']|["']$/g, '');
    defineLines.push('#define ' + k + ' ' + val);
  }
  if (defineLines.length) src = defineLines.join('\n') + '\n' + src;
  // shaderfrog preprocess 对 common_blending.h 的多独立 `#if MACRO == N` 求值
  // 有 bug (真实文件残留空体函数) — 先手动求值这类条件 (用 allDefines),
  // 保留其余 #if 给 shaderfrog。CRLF 统一为 LF。
  const hadCRLF = src.includes('\r\n');
  if (hadCRLF) src = src.replace(/\r\n/g, '\n');
  src = evaluateNumericIfs(src, allDefines);
  // shaderfrog 二次处理 eval 后文本会空体化 ApplyBlending (30 分支裸 return
  // 残留 + 函数体被清) — 用已知 BLENDMODE 分支实现补全空体函数。
  const out = preprocess(src, { defines: allDefines });
  return patchEmptyApplyBlending(out, allDefines);
}

// 手动求值 `#if NAME == NUM ... #elif ... #else ... #endif` (单条件数值比较)。
// 用于 shaderfrog 处理异常的 common_blending.h 风格多分支 (ApplyBlending)。
function evaluateNumericIfs(source, defines) {
  let s = source;
  // 匹配 #if NAME == NUM (NAME 在 defines 中, NUM 为数字) 的完整块
  const re = /#\s*if\s+(\w+)\s*==\s*(-?\d+)([\s\S]*?)(?:#\s*else([\s\S]*?))?#\s*endif/g;
  s = s.replace(re, (m, name, num, thenBody, elseBody) => {
    const val = defines[name];
    if (val === undefined || val === null) return m; // 未定义 → 留给 shaderfrog
    const match = String(val).replace(/^["']|["']$/g, '') === num;
    return match ? thenBody : (elseBody || '');
  });
  return s;
}

// shaderfrog 处理后 ApplyBlending 可能空体 (common_blending.h 的 #if 多分支
// bug) — 检测空体函数并用实际 BLENDMODE 的 31 分支实现补全。
function patchEmptyApplyBlending(source, defines) {
  const bm = defines.BLENDMODE;
  if (bm === undefined) return source;
  // 31 = normal (A + B*opacity) — common_blending.h 的标准 normal 混合
  const body = (String(bm) === '31')
    ? '\treturn A + B * opacity;'
    : '\treturn mix(A, B, opacity);';
  // 匹配空体 ApplyBlending: { 后无有效语句直到 }
  const re = /(vec3 ApplyBlending\(const int blendMode, in vec3 A, in vec3 B, in float opacity\)\s*\{\s*)\}/;
  if (re.test(source)) return source.replace(re, '$1' + body + '\n}');
  return source;
}

// GLSL 保留字消毒: 第三方 workshop shader 偶用 GLSL 保留字作变量名
// (如 light_map.frag / pulse_.frag 的 `vec4 sample;` — sample 是 shaderfrog
// glsl-parser 保留字 → parse 失败 → 效果静默跳过 (bloom 暖光/pulse_ 脉冲丢失)。
// blend.frag 的 `vec4 input` (WRITEALPHA 分支) — input 是 GLSL ES 保留字,
// ANGLE/WebGL1 编译报 Illegal use of reserved (CPU 手写实现不编译官方 shader,
// 仅 GPU 路径受影响 → 静默回退 CPU)。逐字符跟踪注释状态, 仅替换注释外的
// 完整标识符 (texSample2D 等含子串不误伤)。
const RESERVED_RENAMES = { sample: '_weSample', input: '_weInput' };
export function sanitizeReservedWords(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  let lineComment = false, blockComment = false;
  const isIdStart = (c) => /[A-Za-z_]/.test(c);
  const isIdChar = (c) => /[A-Za-z0-9_]/.test(c);
  while (i < n) {
    const ch = source[i];
    if (lineComment) {
      out += ch;
      if (ch === '\n') lineComment = false;
      i++;
      continue;
    }
    if (blockComment) {
      out += ch;
      if (ch === '*' && source[i + 1] === '/') { out += '/'; blockComment = false; i += 2; }
      else i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { lineComment = true; out += '//'; i += 2; continue; }
    if (ch === '/' && source[i + 1] === '*') { blockComment = true; out += '/*'; i += 2; continue; }
    if (isIdStart(ch)) {
      let j = i;
      while (j < n && isIdChar(source[j])) j++;
      const word = source.slice(i, j);
      out += RESERVED_RENAMES[word] !== undefined ? RESERVED_RENAMES[word] : word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
