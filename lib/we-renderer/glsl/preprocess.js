// WE GLSL 预处理: #include 展开 + combo 宏注入 + uniform material 映射解析
import preprocess from '@shaderfrog/glsl-parser/preprocessor/index.js';

// 解析 shader 源码里的元注释:
//   // [COMBO] {"material":"...","combo":"KERNEL","default":0,...}  → combos 默认值
//   uniform <type> <name>; // {"material":"xxx",...}              → material→uniform 映射
export function parseMeta(source) {
  const combos = {}; // combo 名 → 默认值 (string)
  const uniforms = {}; // uniform 名 → { material, type }
  const requires = {}; // combo 名 → {宏: 值} (require 关系, 引擎编译期强制)
  // 整行贪婪匹配: 元 JSON 可含嵌套对象 (options/require 的 {…}) — 旧的非贪婪
  // `[\s\S]*?}` 会在第一个 } 截断 → INTERPOLATION 等带 options 的 combo 丢失
  // → 其 #if 分支不可判定 → 嵌套 #if 求值回退 → main 被 shaderfrog 丢弃。
  const comboRe = /\/\/\s*\[COMBO\]\s*(\{[^\n]*\})/g;
  let m;
  while ((m = comboRe.exec(source))) {
    try {
      const meta = JSON.parse(m[1]);
      if (meta.combo && meta.default !== undefined) combos[meta.combo] = String(meta.default);
      if (meta.combo && meta.require && typeof meta.require === 'object') requires[meta.combo] = meta.require;
    } catch {}
  }
  const unifRe = /uniform\s+([\w]+)\s+(\w+)\s*;\s*\/\/\s*(\{[^\n]*\})/g;
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
  return { combos, uniforms, requires };
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
  // 前导零小数 (00.25 / 012.5): GLSL 合法, 但 JS 拒绝 (00.25 → "Unexpected
  // number", 00 按 legacy octal 解析) — transpile 会原样输出 → 统一归一化为
  // JS 合法形式 (0.25 / 12.5)。仅在词边界且整部为 0 开头时触发, 不碰
  // 0.25/10.5/0x 等。
  src = src.replace(/\b0+(\d*\.\d+(?:[eE][+-]?\d+)?)\b/g, (m, frac) => {
    const dot = frac.indexOf('.');
    const intPart = frac.slice(0, dot);
    const fracPart = frac.slice(dot);
    const norm = intPart.length ? String(Number(intPart)) : '0';
    return norm + fracPart;
  });
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
  // require 关系补全: 官方引擎编译期强制 (AUTO_CUT require AA_VERSION=3) —
  // 生效 combo 的 require 宏未显式给出时按 require 值补 (auto_sway 等
  // 按 AA_VERSION 1/2/3 各有一份 main, 不补则全不命中 → "main is not defined")。
  for (const [combo, req] of Object.entries(meta.requires || {})) {
    if (allDefines[combo] === undefined || allDefines[combo] === null || allDefines[combo] === '') continue;
    for (const [macro, val] of Object.entries(req)) {
      if (allDefines[macro] === undefined || allDefines[macro] === null || allDefines[macro] === '') {
        allDefines[macro] = String(val);
      }
    }
  }
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

// 手动求值 `#if ... #elif/#else ... #endif` 条件编译块。
// 背景: shaderfrog preprocess 对嵌套 `#if` 有 bug — 求值后丢弃整个 main 函数体
// (auto_sway 等 workshop shader: `#if NODE_COUNT >= 2` 内嵌 `#if DEBUG`)。
// 条件全部可判定 (宏在 defines 中且为数值/真值) 时做完整行级求值 (支持嵌套/
// ==/!=/>=/<=/>/</裸宏/!取反); 任一条件不可判定 → 回退旧的正则 (只求值
// 扁平 `#if NAME == NUM`, 其余留给 shaderfrog, 保持现状不回归)。
export function evaluateNumericIfs(source, defines) {
  const lines = source.split('\n');
  // 收集源码顶层 #define (LINEAR=0/CUBIC=1 等 — auto_sway 的 `#if INTERPOLATION
  // == LINEAR` 比较符号; rootDirection 等在 #if 块内, 不计入)。
  const sourceDefines = {};
  {
    let depth = 0;
    for (const l of lines) {
      const t = l.trim();
      if (/^#\s*(if|ifdef|ifndef)\b/.test(t)) { depth++; continue; }
      if (/^#\s*endif\b/.test(t)) { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0) {
        const dm = /^#\s*define\s+([A-Za-z_]\w*)\s+(\S+)/.exec(t);
        if (dm) sourceDefines[dm[1]] = dm[2];
      }
    }
  }
  const resolveMacro = (ident) => {
    const v = defines[ident];
    if (v !== undefined && v !== null && v !== '') return String(v).replace(/^["']|["']$/g, '');
    if (sourceDefines[ident] !== undefined) return String(sourceDefines[ident]);
    return null;
  };
  // 条件判定: 返回 true/false/null(不可判定)。
  // 未定义宏按 C/GLSL 预处理语义 = 0 (false) — `#if MASK`(未定义) → false,
  // 使嵌套 #if 块可完整求值 (auto_sway 等); #ifdef/#ifndef 仍按存在性判定。
  const evalCond = (cond) => {
    const c = String(cond).trim();
    // 数值/标识符比较: NAME op (NUM | IDENT); 右操作数是已定义宏 → 先代换
    let m = /^(!?)\s*([A-Za-z_]\w*)\s*(==|!=|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?|[A-Za-z_]\w*)$/.exec(c);
    if (m) {
      const neg = m[1] === '!';
      const name = m[2], op = m[3], rawRight = m[4];
      const lv = resolveMacro(name) ?? '0';
      let rv;
      if (/^-?\d/.test(rawRight)) rv = rawRight;
      else {
        const res = resolveMacro(rawRight);
        rv = res !== null ? res : rawRight; // 未定义标识符 → 按字面字符串 (字符串宏比较)
      }
      const ln = parseFloat(lv), rn = parseFloat(rv);
      if (isFinite(ln) && isFinite(rn)) {
        let r;
        switch (op) {
          case '==': r = ln === rn; break;
          case '!=': r = ln !== rn; break;
          case '>=': r = ln >= rn; break;
          case '<=': r = ln <= rn; break;
          case '>': r = ln > rn; break;
          case '<': r = ln < rn; break;
        }
        return neg ? !r : r;
      }
      if (op === '==' || op === '!=') {
        const eq = String(lv).toLowerCase() === String(rv).toLowerCase();
        const r = op === '==' ? eq : !eq;
        return neg ? !r : r;
      }
      return null;
    }
    m = /^(!?)\s*([A-Za-z_]\w*)$/.exec(c);
    if (m) {
      const neg = m[1] === '!';
      const name = m[2];
      const s = resolveMacro(name) ?? '0';
      const truthy = s !== '0' && s.toLowerCase() !== 'false' && s !== '';
      return neg ? !truthy : truthy;
    }
    return null; // 复杂条件 → 不可判定
  };
  const isMacroDefined = (name) => resolveMacro(name) !== null;
  // 预扫描: 所有 #if/#elif 条件是否都可判定
  let allDecidable = true;
  for (const l of lines) {
    const t = l.trim();
    let m = /^#\s*(?:if|elif)\s+(.+)$/.exec(t);
    if (!m) {
      m = /^#\s*ifn?def\s+(\w+)/.exec(t);
      if (m) {
        // #ifdef/#ifndef 需要宏存在性可判定: 均未定义时 shaderfrog 也可能出错,
        // 但保持旧行为 (留给 shaderfrog) — 只有至少一侧 (defines/source) 已定义
        // 才可判定。为稳妥, 未定义 → 不可判定 → 回退。
        if (!isMacroDefined(m[1])) { allDecidable = false; break; }
      }
      continue;
    }
    if (evalCond(m[1]) === null) { allDecidable = false; break; }
  }
  if (!allDecidable) {
    // 回退: 仅求值扁平 `#if NAME == NUM` (旧行为, common_blending.h 等)
    const re = /#\s*if\s+(\w+)\s*==\s*(-?\d+)([\s\S]*?)(?:#\s*else([\s\S]*?))?#\s*endif/g;
    return source.replace(re, (mm, name, num, thenBody, elseBody) => {
      const val = defines[name];
      if (val === undefined || val === null) return mm;
      const match = String(val).replace(/^["']|["']$/g, '') === num;
      return match ? thenBody : (elseBody || '');
    });
  }
  // 完整行级求值 (支持嵌套)。条件已全部求值 → 只保留激活分支的内容,
  // #if/#elif/#else/#endif 指令行一律不输出 (否则 shaderfrog 二次求值
  // 会把已展开的块再截断/丢弃, 如 auto_sway 的 main 函数体)。
  const out = [];
  // 栈元素: { active: 本层当前分支是否激活, parentActive: 父层是否激活, taken: 已取分支 }
  const stack = [];
  const emit = (line) => { if (stack.every((s) => s.active)) out.push(line); };
  for (const line of lines) {
    const t = line.trim();
    let m = /^#\s*(if|ifdef|ifndef)\s+(.+)$/.exec(t);
    if (m) {
      const parentActive = stack.length === 0 || stack[stack.length - 1].active;
      let active = false;
      if (m[1] === 'if') {
        const r = evalCond(m[2]);
        active = r === null ? false : parentActive && r;
      } else {
        const name = m[2].trim();
        const defined = isMacroDefined(name);
        const want = m[1] === 'ifdef';
        active = parentActive && (defined === want);
      }
      stack.push({ active, parentActive, taken: active });
      continue;
    }
    if (/^#\s*elif\s+/.test(t)) {
      const top = stack[stack.length - 1];
      if (top.parentActive && !top.taken) {
        const r = evalCond(t.replace(/^#\s*elif\s*/, ''));
        const act = r === true;
        if (act) top.taken = true;
        top.active = act;
      } else {
        top.active = false;
      }
      continue;
    }
    if (/^#\s*else\s*$/.test(t)) {
      const top = stack[stack.length - 1];
      if (top.parentActive && !top.taken) { top.active = true; top.taken = true; }
      else top.active = false;
      continue;
    }
    if (/^#\s*endif\s*$/.test(t)) {
      stack.pop();
      continue;
    }
    emit(line);
  }
  return out.join('\n');
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
