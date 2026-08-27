// WE GLSL → WebGL 方言适配 (shim)
// 现有管线 preprocessShader 已展开 include + combo 宏 (common.h 的
// hsv2rgb/rotateVec2/greyscale 等函数定义已内联), 残留的 WE 引擎方言
// (texSample2D/frac/saturate/CAST/ApplyBlending/mul...) 在这里转成标准
// GLSL ES 1.0 (WebGL1 可编译), 并注入 fragment precision。
// 实测扫描 (21 官方效果): 残留方言仅 6 类 + precision 缺失 16/21。

// WE 内置函数 → GLSL ES 1.0 shim (注入到 shader 头部)
// 注: 不含 ApplyBlending — common_blending.h 随 #include 展开提供
// `ApplyBlending(const int, vec3, vec3, float)` (GLSL ES 1.0 无函数重载,
// shim 若再定义同名不同签名会报 no matching overloaded)。
// 另: common_blending.h 用 `in vec3` 参数 (ES 3.0 语法, WebGL1 不支持) —
// 由 shim 的 floatify 阶段移除 `in ` 限定符 (见 stripInQualifiers)。
const WE_SHIM_SOURCE = `
#define M_PI 3.14159265358979323846
#define M_PI_2 1.57079632679489661923
#define M_PI_4 0.78539816339744830962
#define M_1_PI 0.31830988618379067154
#define M_2_PI 0.63661977236758134308
#define M_2_SQRTPI 1.12837916709551257390
#define M_SQRT2 1.41421356237309504880
#define M_SQRT1_2 0.70710678118654752440

float frac(float x) { return fract(x); }
vec2 frac(vec2 x) { return fract(x); }
vec3 frac(vec3 x) { return fract(x); }
vec4 frac(vec4 x) { return fract(x); }

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
vec4 saturate(vec4 x) { return clamp(x, 0.0, 1.0); }

// 行向量 × 列主序矩阵 (GLSL mul(rowVec, mat) 语义, 与 CPU 引擎 runtime.mul 一致):
//   v * m = 行向量左乘, result[i] = Σ_j v[j]·m[j + i·rows]
vec4 mul(vec4 v, mat4 m) { return v * m; }
vec3 mul(vec3 v, mat3 m) { return v * m; }
vec2 mul(vec2 v, mat2 m) { return v * m; }

vec4 texSample2D(sampler2D s, vec2 uv) { return texture2D(s, uv); }
vec4 texSample2DProj(sampler2D s, vec3 uv) { return texture2DProj(s, uv); }
// texSample2DLod: WE 显式 mip 采样 (clouds/fire/nitro 等用)。
// 不用 texture2DLodEXT (ANGLE 默认禁用该扩展) — 忽略 lod 用 texture2D
// (mip 细节损失小, 低频效果无感)。
vec4 texSample2DLod(sampler2D s, vec2 uv, float lod) { return texture2D(s, uv); }

vec2 CAST2(float x) { return vec2(x); }
vec2 CAST2(vec2 x) { return x; }
vec3 CAST3(float x) { return vec3(x); }
vec3 CAST3(vec3 x) { return x; }
vec4 CAST4(float x) { return vec4(x); }
vec4 CAST4(vec4 x) { return x; }
vec4 CAST4(vec2 x, float z, float w) { return vec4(x, z, w); }
vec4 CAST4(vec3 x, float w) { return vec4(x, w); }
// CAST3X3: mat4 → mat3 (depthparallax 用)
mat3 CAST3X3(mat3 m) { return m; }
mat3 CAST3X3(mat4 m) { return mat3(m[0].xyz, m[1].xyz, m[2].xyz); }

// atan2(y,x): WE 方言 (fisheye 等用); GLSL 是 atan(y,x)
float atan2(float y, float x) { return atan(y, x); }
vec2 atan2(vec2 y, vec2 x) { return atan(y, x); }

// 注: 不含 rotateVec2 — common.h 随 #include 展开提供 (重复定义报
// "function already has a body")。shimmer 的 rotateVec2(vec4) 宽松调用由
// floatify 阶段的 rotateVec2Vec4Fix 转 .xy。
// 注: 不含 max/min/clamp/mix 重载 — GLSL 内置不可重定义 (built-in functions
// cannot be redefined); 标量+vec 混型由 floatify 阶段的 vecScalarPromote 修复。

// inverse(mat3): perspective 等用 (GLSL ES 1.0 无 inverse 内置)
mat3 inverse(mat3 m) {
  float a = m[0][0], b = m[0][1], c = m[0][2];
  float d = m[1][0], e = m[1][1], f = m[1][2];
  float g = m[2][0], h = m[2][1], i = m[2][2];
  float A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  float det = a * A + b * B + c * C;
  if (det == 0.0) return mat3(1.0);
  float inv = 1.0 / det;
  return mat3(A * inv, B * inv, C * inv,
              (c * h - b * i) * inv, (a * i - c * g) * inv, (b * g - a * h) * inv,
              (b * f - c * e) * inv, (c * d - a * f) * inv, (a * e - b * d) * inv);
}
`;

const FRAG_PRECISION = 'precision highp float;\n';

/**
 * 把预处理的 frag/vert 源码转成 WebGL1 可编译。
 * @param {string} source 预处理后 (include 展开 + combo 宏) 的 shader 源码
 * @param {string} stage 'fragment' | 'vertex'
 * @returns {{source: string}}
 */
export function toWebGLSource(source, stage) {
  if (!source) return { source: '' };
  let body = source;
  // GLSL ES 1.0 要求"先声明后使用" (global scope 变量/函数体引用)。
  // 官方多 pass 头文件 (common_blur.h) 的函数体引用 g_Texture0, 而
  // blurradial/shine gaussian 把 `uniform sampler2D g_Texture0;` 写在
  // `#include` 之后 → DX 允许后声明, GLSL 报 undeclared identifier。
  // 把顶层无条件 uniform 声明提到最前 (条件 #if 内不移动)。
  body = hoistTopLevelUniforms(body);
  // 官方 godrays/shine cast: `const int sampleCount = N;` 参与 float 运算
  // (sampleCount - 1 / i / sampleDrop)。GLSL ES 1.0 二元运算无 int→float
  // 隐式转换 → 提升声明为 float, 并同步提升以此为边界的循环计数器
  // (for (int i = 0; i < sampleCount; ++i) → float i)。须在 floatify 前,
  // 这样 `sampleCount - 1` 的 1 由 floatify 补 .0。
  body = promoteConstIntToFloat(body);
  // GLSL ES 1.0 严格类型: WE shader 的 vec×int/vec−int 宽松写法
  // (官方 DX 编译器允许 vec3 * 2, WebGL 报 wrong operand types) →
  // 把纯整数字面量运算数转 float (只影响数值, 语义不变)。
  // 模式: vecN 表达式 与 int 的 * / - + 运算 → int 补 .0
  body = floatifyIntLiterals(body);
  // GLSL ES 1.0 不支持 `in` 参数限定符 (common_blending.h 的
  // `vec3 ApplyBlending(const int, in vec3 A, ...)`) → 移除 `in `。
  body = stripInQualifiers(body);
  // rotateVec2 vec4 宽松调用 (shimmer: rotateVec2(v_TexCoord, ...) 传 vec4) →
  // 取 .xy (DX vec4→vec2 截断语义; common.h 的 rotateVec2 只收 vec2)。
  body = body.replace(/rotateVec2\s*\(\s*(v_TexCoord|v_TexCoord\.[xy]{2})\s*,/g, 'rotateVec2($1.xy,');
  // max/min/clamp/mix 标量+vec 混型 (nitro: max(0.0, albedo.rgb)):
  // 第一参数标量字面量 → 按第二参数 vec swizzle 提升 (GLSL ES 1.0 无标量+vec
  // 重载)。仅当第二参数带明确 vec swizzle (rgb/xyz/xy/rgba/xyzw) 才转换 —
  // 避免误伤 float 第二参数 (vhs: max(0.00001, dblend) 的 dblend 是 float)。
  body = body.replace(/\b(max|min|clamp|mix)\((\s*[0-9.]+)\s*,\s*([a-zA-Z_]\w*\.(?:rgb|xyz|xy|rgba|xyzw))\s*\)/g,
    (m, fn, scalar, second) => {
      let dim = 3;
      if (/\.(rgba|xyzw)$/.test(second)) dim = 4;
      else if (/\.(xy)$/.test(second)) dim = 2;
      return fn + '(vec' + dim + '(' + scalar.trim() + '),' + second + ')';
    });
  // vecN = texSample2D(...) (vec4) → 赋 vec3 需 .rgb (DX vec4→vec3 截断语义;
  // shimmer: vec3 shimmerColor = texSample2D(...) 报 dimension mismatch)。
  // 贪婪匹配整行, 捕获 texSample2D 闭合括号 (最后的 `)`), 在其后加 .rgb
  body = body.replace(/(vec3\s+\w+\s*=\s*texSample2D\(.*\))(\s*;)/g, '$1.rgb$2');
  // 注入 WE 方言 shim (frag + vert 都需要: mul/frac 等在 vert 也会出现)
  body = WE_SHIM_SOURCE + '\n' + body;
  if (stage === 'fragment') {
    // WebGL1 fragment 必须显式 precision; 源码已有则跳过
    if (!/precision\s+\w+\s+float/.test(body)) {
      body = FRAG_PRECISION + body;
    }
  }
  return { source: body };
}

// 移除 GLSL ES 3.0 的 `in` 参数限定符 (WebGL1 = ES 1.0 不支持):
// `vec3 f(in vec3 A)` → `vec3 f(vec3 A)`; `const in vec3` → `const vec3`。
function stripInQualifiers(src) {
  return src
    .replace(/\bconst\s+in\s+/g, 'const ')
    .replace(/\bin\s+(vec[234]|float|int|bool|mat[234])\b/g, '$1');
}

// GLSL ES 1.0 要求全局声明先于使用。官方多 pass 头 (common_blur.h) 函数体
// 引用 g_Texture0, 而 blurradial/shine gaussian 的 uniform 声明在 #include
// 之后 → 把顶层 (非 #if 条件内) 的 uniform 声明行提到源码最前。
function hoistTopLevelUniforms(src) {
  const lines = src.split('\n');
  const decls = [];
  const rest = [];
  let ifDepth = 0;
  for (const line of lines) {
    // 预处理后 #if/#endif 成对; 条件内不移动
    if (/^\s*#\s*(if|ifdef|ifndef)/.test(line)) ifDepth++;
    else if (/^\s*#\s*endif/.test(line)) ifDepth = Math.max(0, ifDepth - 1);
    const m = /^\s*(?:uniform|varying)\s+[\w]+\s+[\w]+\s*;/.exec(line);
    if (m && ifDepth === 0) decls.push(line);
    else rest.push(line);
  }
  if (!decls.length) return src;
  return decls.join('\n') + '\n' + rest.join('\n');
}

// 官方 godrays/shine cast shader: `const int sampleCount = N;` 参与 float 运算
// (sampleCount - 1、i / sampleDrop)。GLSL ES 1.0 二元运算无 int→float 隐式
// 转换 → 把这类"循环边界 const int"提升为 float, 并同步提升其循环计数器。
// 安全门: 仅当该 const int 未用作数组下标 [X], 且循环体变量未作数组下标时
// 才提升 (提升会改变 i 的类型, 数组下标必须是 int)。
function promoteConstIntToFloat(src) {
  let out = src;
  const re = /const int (\w+) = (\d+);/g;
  let m;
  const jobs = [];
  while ((m = re.exec(src))) {
    const name = m[1], num = m[2];
    // 数组下标 [name] → 必须保持 int, 跳过
    if (new RegExp('\\[' + name + '\\]').test(src)) continue;
    // 找以它为边界的 for (int i = 0; i < name; ++i)
    const loopRe = new RegExp('for\\s*\\(\\s*int\\s+(\\w+)\\s*=\\s*0\\s*;\\s*\\1\\s*<\\s*' + name + '\\s*;\\s*\\+\\+\\1\\s*\\)', 'g');
    let lm;
    const loops = [];
    while ((lm = loopRe.exec(src))) {
      const iv = lm[1];
      if (new RegExp('\\[' + iv + '\\]').test(src)) { loops.length = 0; break; } // 循环体用数组下标 → 不提升
      loops.push(lm[0]);
    }
    if (!loops.length) continue;
    jobs.push({ name, num, loops });
  }
  for (const j of jobs) {
    out = out.replace(new RegExp('const int ' + j.name + ' = ' + j.num + ';'), 'const float ' + j.name + ' = ' + j.num + '.0;');
    for (const l of j.loops) {
      const lm = /for\s*\(\s*int\s+(\w+)\s*=\s*0\s*;/.exec(l);
      if (!lm) continue;
      const iv = lm[1];
      const repl = 'for (float ' + iv + ' = 0.0; ' + iv + ' < ' + j.name + '; ' + iv + ' += 1.0)';
      out = out.replace(l, repl);
    }
  }
  return out;
}

// 把 GLSL 源码里与 vec/float 运算相邻的整数字面量补 .0 (vec3 * 2 → vec3 * 2.0,
// float x = 0 → 0.0, CAST3(0) → CAST3(0.0), int 上下文不碰)。
// GLSL ES 1.0 严格类型: WE 宽松写法 (官方 DX 编译器允许) 报 wrong operand types。
// 规则:
//   - * / 后孤立整数: 恒转 (二元算术)
//   - + - 后孤立整数: 前是 = ( , [ 或类型关键字 (一元/声明) 不转, 否则转
//   - ( 后孤立整数: 后跟 ) 或算术符转 (CAST3(0) / float(2+2.0)), 后跟 , 不转
//     (函数 int 参数 ApplyBlending(31,))
//   - float/vec 声明后的 = 孤立整数: 转 (float x = 0 → 0.0)
// 科学计数法 (1e-10) 全程保护。
function floatifyIntLiterals(src) {
  const sci = [];
  // 1) 提取并占位科学计数法 (含符号 e+/-)
  let s = src.replace(/(\d)([eE][+\-]\d+)/g, (m, d, exp) => {
    sci.push(d + exp);
    return d + '\u0001' + (sci.length - 1) + '\u0002';
  });
  // 2) 保护一元负号/声明上下文的 + - (前是 = , [ 或类型关键字, 允许中间空白):
  //    for (int i = -2) 的 - 2 不得转成 - 2.0 (int 类型错误)。
  //    替换时 pre 已在源中保留, 占位只存 op+num。
  const unary = [];
  s = s.replace(/([=(\[,]|\b(?:int|float|vec[234]|bool))\s*([+\-])\s*(\d+)(?!\.)(?![\w])/g,
    (m, pre, op, num) => {
      unary.push(op + ' ' + num);
      return pre + '\u0003' + (unary.length - 1) + '\u0004';
    });
  // 2b) ( 后正数: CAST3(0) / float(2 + 2.0) / smoothstep(0, 0.5, x) 的 ( 后
  //     整数转 (后跟 ) 或算术符 或 ,)。ApplyBlending 的 int blendMode 参数
  //     (如 ApplyBlending(31, ...)) 在转换后还原 (float→int 不合法)。
  s = s.replace(/\(\s*(\d+)(?!\.)(?![\w])(?=[+\-*\/\s]|\)|,)/g, (m, num) => '( ' + num + '.0');
  // 2b2) 函数参数中的 , 整数, 或 , 整数): smoothstep(feather, 0, dist) 的 0
  //     转 0.0 (int edge 与 float 混型)。排除数组/构造 (用 [ 或 vecN() 内部? 难判 —
  //     保守: 仅当 , 整数 后跟 , 或 ) 且行内前面有非 int 声明)。
  //     vhs.vert: smoothstep(0, 2, 1 + 0.5*sin(...)) — `, 1 +` 的 1 也转
  //     (int + vec3 混型; 仅 int 构造/数组上下文罕见, WE shader 未用)。
  s = s.replace(/,\s*(\d+)(?!\.)(?![\w])(?=\s*,|\s*\)|\s*[+\-*\/])/g, (m, num) => ', ' + num + '.0');
  // 还原 ApplyBlending 的 int 参数: ApplyBlending( 31.0, → ApplyBlending( 31,
  // (仅去掉 .0, 保留原有逗号 — 不能把逗号放进替换, 否则双逗号)
  s = s.replace(/(ApplyBlending\s*\()\s*(\d+)\.0(?=\s*,)/g, (m, pre, num) => pre + ' ' + num);
  // 2c) float/vec 声明后的 = 孤立整数: float x = 0 → 0.0 (int→float 赋值错误)
  s = s.replace(/(\b(?:float|vec[234])\s+\w+\s*=\s*)(\d+)(?!\.)(?![\w])/g, (m, pre, num) => pre + num + '.0');
  // 2c2) 分量/成员赋值孤立整数: v_TexCoord.w = 0 / v_PointDelta.x *= 100 /
  //     v_PointerUVLast.xy += 0.5 → 0.0 (vec 分量是 float, GLSL ES 1.0
  //     int→float 赋值不合法; cursorripple/fluidsimulation/blur gaussian 用)。
  //     仅匹配 `标识符.分量` 形式的赋值目标 (排除数组/构造)。
  s = s.replace(/(\b\w+\.\w+\s*[*\/+\-]?=\s*)(\d+)(?!\.)(?![\w])/g, (m, pre, num) => pre + num + '.0');
  // 3) 转换剩余二元运算符后的孤立整数 (* / + -)
  s = s.replace(/([*\/+\-])\s*(\d+)(?!\.)(?![\w])/g, (m, op, num) => op + ' ' + num + '.0');
  // 4) 还原一元上下文 + 科学计数法
  s = s.replace(/\u0003(\d+)\u0004/g, (m, i) => unary[Number(i)]);
  return s.replace(/\u0001(\d+)\u0002/g, (m, i) => sci[Number(i)]);
}

/**
 * 快速判定 shader 是否含 WE 方言 (需要 shim)。
 */
export function needsShim(source) {
  return /texSample2D|frac\(|saturate|CAST[234]\(|ApplyBlending|PerformBlend|GetUVBlend|mul\(/.test(source);
}
