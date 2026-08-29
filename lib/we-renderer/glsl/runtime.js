// WE GLSL 运行时宿主 — 内置 GLSL 函数 + WE 引擎 intrinsic + 向量运算辅助
// 转译器把用户代码里的内置函数调用输出为 __rt.<name>(...), 全部在此实现。
// vec 类型用 Float32Array/普通数组表示; 标量用 JS number; 函数自动处理广播。

// ── 向量运算辅助 (转译器对 vec 二元运算生成) ──
const mk = (n) => new Float32Array(n);
const len = (a) => (typeof a === 'number' ? 1 : a.length);
const same = (a, b) => len(a) === len(b);
function _vecOp(a, b, op) {
  if (typeof a === 'number' && typeof b === 'number') return op(a, b, 0);
  const n = Math.max(len(a), len(b));
  const r = mk(n);
  for (let i = 0; i < n; i++) {
    const av = typeof a === 'number' ? a : i < a.length ? a[i] : 0;
    const bv = typeof b === 'number' ? b : i < b.length ? b[i] : 0;
    r[i] = op(av, bv, i);
  }
  return r;
}
export const _vadd = (a, b) => _vecOp(a, b, (x, y) => x + y);
export const _vsub = (a, b) => _vecOp(a, b, (x, y) => x - y);
export const _vmul = (a, b) => _vecOp(a, b, (x, y) => x * y);
export const _vdiv = (a, b) => _vecOp(a, b, (x, y) => x / y);
export const _vaddS = (a, s) => _vecOp(a, s, (x, y) => x + y);
export const _vsubS = (a, s) => _vecOp(a, s, (x, y) => x - y);
export const _vmulS = (a, s) => _vecOp(a, s, (x, y) => x * y);
export const _vdivS = (a, s) => _vecOp(a, s, (x, y) => x / y);
export const _saddV = (s, a) => _vecOp(s, a, (x, y) => x + y);
export const _ssubV = (s, a) => _vecOp(s, a, (x, y) => x - y);
export const _smulV = (s, a) => _vecOp(s, a, (x, y) => x * y);
export const _sdivV = (s, a) => _vecOp(s, a, (x, y) => x / y);
// 复合赋值 (就地): a op= b → 返回新数组 (GLSL 语义), 由转译器赋值回变量
export const _vaddEq = (a, b) => { const r = _vadd(a, b); return r; };
export const _vsubEq = (a, b) => _vsub(a, b);
export const _vmulEq = (a, b) => _vmul(a, b);
export const _vdivEq = (a, b) => _vdiv(a, b);
export const _vneg = (a) => { const r = mk(a.length); for (let i = 0; i < a.length; i++) r[i] = -a[i]; return r; };

// ── 标量/向量通用内置函数 ──
export function mix(a, b, t) {
  if (typeof t === 'number') {
    if (typeof a === 'number') return a + (b - a) * t;
    const n = a.length, r = mk(n);
    for (let i = 0; i < n; i++) r[i] = a[i] + (b[i] - a[i]) * t;
    return r;
  }
  // t 为 vec
  // P1-41: 长度须计入 t (mix(标,标,vec t) 此前恒得长度 1)
  const n = Math.max(len(a), len(b), len(t));
  const r = mk(n);
  for (let i = 0; i < n; i++) {
    const av = typeof a === 'number' ? a : i < a.length ? a[i] : 0;
    const bv = typeof b === 'number' ? b : i < b.length ? b[i] : 0;
    const tv = i < t.length ? t[i] : 0;
    r[i] = av + (bv - av) * tv;
  }
  return r;
}
export function step(edge, x) {
  if (typeof x === 'number') return x >= edge ? 1 : 0;
  const r = mk(x.length);
  for (let i = 0; i < x.length; i++) r[i] = x[i] >= (typeof edge === 'number' ? edge : edge[i]) ? 1 : 0;
  return r;
}
export function smoothstep(e0, e1, x) {
  if (typeof x === 'number') {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  const r = mk(x.length);
  for (let i = 0; i < x.length; i++) {
    const e0v = typeof e0 === 'number' ? e0 : e0[i];
    const e1v = typeof e1 === 'number' ? e1 : e1[i];
    const t = Math.min(1, Math.max(0, (x[i] - e0v) / (e1v - e0v)));
    r[i] = t * t * (3 - 2 * t);
  }
  return r;
}
export const clamp = (x, lo, hi) => {
  if (typeof x === 'number') return Math.min(hi, Math.max(lo, x));
  const r = mk(x.length);
  for (let i = 0; i < x.length; i++) r[i] = Math.min(typeof hi === 'number' ? hi : hi[i], Math.max(typeof lo === 'number' ? lo : lo[i], x[i]));
  return r;
};
export const min = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.min(a, b);
  const n = Math.max(len(a), len(b)), r = mk(n);
  for (let i = 0; i < n; i++) r[i] = Math.min(typeof a === 'number' ? a : a[i], typeof b === 'number' ? b : b[i]);
  return r;
};
export const max = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  const n = Math.max(len(a), len(b)), r = mk(n);
  for (let i = 0; i < n; i++) r[i] = Math.max(typeof a === 'number' ? a : a[i], typeof b === 'number' ? b : b[i]);
  return r;
};
export const abs = (x) => (typeof x === 'number' ? Math.abs(x) : x.map((v) => Math.abs(v)));
export const floor = (x) => (typeof x === 'number' ? Math.floor(x) : x.map((v) => Math.floor(v)));
export const ceil = (x) => (typeof x === 'number' ? Math.ceil(x) : x.map((v) => Math.ceil(v)));
export const fract = (x) => (typeof x === 'number' ? x - Math.floor(x) : x.map((v) => v - Math.floor(v)));
export function mod(x, y) {
  if (typeof x === 'number') return x - y * Math.floor(x / y);
  const r = mk(x.length);
  for (let i = 0; i < x.length; i++) r[i] = x[i] - (typeof y === 'number' ? y : y[i]) * Math.floor(x[i] / (typeof y === 'number' ? y : y[i]));
  return r;
}
export const pow = (x, y) => (typeof x === 'number' ? Math.pow(x, y) : x.map((v, i) => Math.pow(v, typeof y === 'number' ? y : y[i])));
export const exp = (x) => (typeof x === 'number' ? Math.exp(x) : x.map((v) => Math.exp(v)));
export const log = (x) => (typeof x === 'number' ? Math.log(x) : x.map((v) => Math.log(v)));
export const sqrt = (x) => (typeof x === 'number' ? Math.sqrt(x) : x.map((v) => Math.sqrt(v)));
export const inversesqrt = (x) => (typeof x === 'number' ? 1 / Math.sqrt(x) : x.map((v) => 1 / Math.sqrt(v)));
export const sign = (x) => (typeof x === 'number' ? Math.sign(x) : x.map((v) => Math.sign(v)));
export const sin = (x) => (typeof x === 'number' ? Math.sin(x) : x.map((v) => Math.sin(v)));
export const cos = (x) => (typeof x === 'number' ? Math.cos(x) : x.map((v) => Math.cos(v)));
export const tan = (x) => (typeof x === 'number' ? Math.tan(x) : x.map((v) => Math.tan(v)));
export const asin = (x) => (typeof x === 'number' ? Math.asin(x) : x.map((v) => Math.asin(v)));
export const acos = (x) => (typeof x === 'number' ? Math.acos(x) : x.map((v) => Math.acos(v)));
export function atan(x, y) {
  if (y === undefined) return typeof x === 'number' ? Math.atan(x) : x.map((v) => Math.atan(v));
  // P1-40: atan(y, x) 双参向量重载逐分量 (此前 Math.atan2(vec,vec) → NaN)
  if (typeof x === 'number' && typeof y === 'number') return Math.atan2(x, y);
  const n = Math.max(len(x), len(y));
  const r = mk(n);
  for (let i = 0; i < n; i++) {
    const xv = typeof x === 'number' ? x : x[i];
    const yv = typeof y === 'number' ? y : y[i];
    r[i] = Math.atan2(xv, yv);
  }
  return r;
}
export const radians = (x) => (typeof x === 'number' ? (x * Math.PI) / 180 : x.map((v) => (v * Math.PI) / 180));
export const degrees = (x) => (typeof x === 'number' ? (x * 180) / Math.PI : x.map((v) => (v * 180) / Math.PI));
export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
export function cross(a, b) {
  return new Float32Array([
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]);
}
export function length(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s);
}
export function distance(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}
export function normalize(x) {
  const l = length(x) || 1;
  const r = mk(x.length);
  for (let i = 0; i < x.length; i++) r[i] = x[i] / l;
  return r;
}
export const isnan = (x) => (typeof x === 'number' ? Number.isNaN(x) : x.map((v) => (Number.isNaN(v) ? 1 : 0)));
export const isinf = (x) => (typeof x === 'number' ? (x === Infinity || x === -Infinity ? 1 : 0) : x.map((v) => (v === Infinity || v === -Infinity ? 1 : 0)));

// ── P1-28/GLS-10: 补齐的 GLSL 内置 (此前缺收录/缺实现 → 裸调用 ReferenceError 丢整帧) ──
export function reflect(I, N) {
  if (typeof I === 'number') return I - 2 * N * N * I;
  const d = dot(N, I) * 2;
  const r = mk(I.length);
  for (let i = 0; i < I.length; i++) r[i] = I[i] - d * N[i];
  return r;
}
export function refract(I, N, eta) {
  if (typeof I === 'number') {
    const k = 1 - eta * eta * (1 - N * N * I * I);
    return k < 0 ? 0 : eta * I - (eta * N * I + Math.sqrt(k)) * N;
  }
  const ni = dot(N, I);
  const k = 1 - eta * eta * (1 - ni * ni);
  const r = mk(I.length); // 全折射 (k<0) 返回 0 向量
  if (k >= 0) {
    const s = eta * ni + Math.sqrt(k);
    for (let i = 0; i < I.length; i++) r[i] = eta * I[i] - s * N[i];
  }
  return r;
}
export function faceforward(N, I, Nref) {
  if (typeof N === 'number') return Nref * I < 0 ? N : -N;
  return dot(Nref, I) < 0 ? N : _vneg(N);
}
export function matrixCompMult(x, y) {
  const n = Math.max(x.length, y.length);
  const r = mk(n);
  for (let i = 0; i < n; i++) r[i] = x[i] * y[i];
  return r;
}
// vec 关系运算 → bvec (0/1 分量)
const _vcmp = (cmp) => (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return cmp(a, b) ? 1 : 0;
  const n = Math.max(len(a), len(b));
  const r = mk(n);
  for (let i = 0; i < n; i++) {
    const av = typeof a === 'number' ? a : a[i];
    const bv = typeof b === 'number' ? b : b[i];
    r[i] = cmp(av, bv) ? 1 : 0;
  }
  return r;
};
export const lessThan = _vcmp((x, y) => x < y);
export const lessThanEqual = _vcmp((x, y) => x <= y);
export const greaterThan = _vcmp((x, y) => x > y);
export const greaterThanEqual = _vcmp((x, y) => x >= y);
export const equal = _vcmp((x, y) => x === y);
export const notEqual = _vcmp((x, y) => x !== y);
export const any = (v) => (typeof v === 'number' ? v !== 0 : v.some((x) => x !== 0));
export const all = (v) => (typeof v === 'number' ? v !== 0 : v.every((x) => x !== 0));
export const not = (v) => (typeof v === 'number' ? (v !== 0 ? 0 : 1) : v.map((x) => (x !== 0 ? 0 : 1)));

// 位重解释 (P1-29: BUILTIN 声明了没实现 → 实现)
const _bitsBuf = new ArrayBuffer(4);
const _bitsF32 = new Float32Array(_bitsBuf);
const _bitsI32 = new Int32Array(_bitsBuf);
export function floatBitsToInt(v) {
  if (typeof v !== 'number') return v.map(floatBitsToInt);
  _bitsF32[0] = v;
  return _bitsI32[0];
}
export function intBitsToFloat(v) {
  if (typeof v !== 'number') return v.map(intBitsToFloat);
  _bitsI32[0] = v;
  return _bitsF32[0];
}

// ── 转译器辅助 ──
// GLS-07: vec/mat 相等比较 (== / !=)
export function _veq(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') return false; // 标量×vec 非法比较, 恒 false
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// P1-34: int % 的 GLSL floor-mod (负操作数)
export function _imod(a, b) {
  return ((a % b) + b) % b;
}
// F-14: mat 列写回 — m[i] = v (flat 列主序)
export function _matColSet(m, i, v, rows) {
  const off = i * rows;
  for (let j = 0; j < rows; j++) m[off + j] = v[j];
  return m;
}
// P0-15/P1-32: discard 信号 — executor 逐像素捕获后跳过写色
export const DISCARD = Symbol('glsl-discard');
export function _discard() {
  throw DISCARD;
}

// ── WE 引擎 intrinsic ──
export const M_PI = 3.14159265359;
export const M_PI_HALF = 1.57079632679;
export const M_PI_2 = 6.28318530718;
export const SQRT_2 = 1.41421356237;
export const SQRT_3 = 1.73205080756;
export const saturate = (x) => (typeof x === 'number' ? Math.min(1, Math.max(0, x)) : clamp(x, 0, 1));

// 行向量 × 列主序矩阵 (GLSL mul(rowVec, mat)):
//   result[i] = Σ_j v[j] · m[j + i·rows]
// v 长度 = 矩阵行数 (mat4: 4, mat3: 3); m 长度 = rows²
export function mul(v, m) {
  const rows = v.length;
  const out = mk(rows);
  for (let i = 0; i < rows; i++) {
    let s = 0;
    for (let j = 0; j < rows; j++) s += v[j] * m[j + i * rows];
    out[i] = s;
  }
  return out;
}

// mat4 → mat3 (左上 3×3, 列主序取前 3 列各 3 元素)
export function CAST3X3(m) {
  if (typeof m === 'number') return new Float32Array([m, 0, 0, 0, m, 0, 0, 0, m]);
  if (m.length === 9) return m;
  return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
}
// CAST2/3/4: vec 构造广播 (转译器通常直接展开, 兜底保留)
export const CAST2 = (a, b) => (typeof a === 'number' ? new Float32Array([a, b === undefined ? a : b]) : new Float32Array([a[0], a[1] === undefined ? a[0] : a[1]]));
export const CAST3 = (a, b, c) => {
  if (typeof a === 'number') return new Float32Array([a, b === undefined ? a : b, c === undefined ? a : c]);
  return new Float32Array([a[0], a[1] === undefined ? a[0] : a[1], a[2] === undefined ? a[0] : a[2]]);
};
export const CAST4 = (a, b, c, d) => {
  if (typeof a === 'number') return new Float32Array([a, b === undefined ? a : b, c === undefined ? a : c, d === undefined ? a : d]);
  return new Float32Array([a[0], a[1] === undefined ? a[0] : a[1], a[2] === undefined ? a[0] : a[2], a[3] === undefined ? a[0] : a[3]]);
};

// ── 纹理采样 (注入: texSample 由 executor 提供, 包装为 texSample2D) ──
export function makeTexSample(sampler) {
  // sampler(tex, u, v) → [r,g,b,a] (0-1)
  return function texSample2D(tex, uv) {
    if (!tex) return [0, 0, 0, 0];
    const u = typeof uv === 'number' ? uv : uv[0];
    const v = typeof uv === 'number' ? uv : uv[1];
    return sampler(tex, u, v);
  };
}
export const texture2D = null; // 由 executor 绑定

// ── 生成执行器: 把 runtime 绑定为 __rt 对象 (new Function 作用域) ──
export function runtimeObject(texSample) {
  const rt = {
    _vadd, _vsub, _vmul, _vdiv, _vaddS, _vsubS, _vmulS, _vdivS,
    _saddV, _ssubV, _smulV, _sdivV, _vaddEq, _vsubEq, _vmulEq, _vdivEq, _vneg,
    _veq, _imod, _matColSet, _discard, DISCARD,
    mix, step, smoothstep, clamp, min, max, abs, floor, ceil, fract, mod,
    pow, exp, log, sqrt, inversesqrt, sign, sin, cos, tan, asin, acos, atan,
    radians, degrees, dot, cross: (a, b) => new Float32Array([
      a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
    ]),
    length, distance, normalize, isnan, isinf,
    // P1-28/GLS-10 新增内置
    reflect, refract, faceforward, matrixCompMult,
    lessThan, lessThanEqual, greaterThan, greaterThanEqual, equal, notEqual, any, all, not,
    floatBitsToInt, intBitsToFloat,
    M_PI, M_PI_HALF, M_PI_2, SQRT_2, SQRT_3, saturate, mul, CAST2, CAST3, CAST4, CAST3X3,
    texSample2D: makeTexSample(texSample), texture2D: makeTexSample(texSample),
    texture2DLod: makeTexSample(texSample), // P1-29: 无 mip 链, 与 texture2D 同采样
  };
  return rt;
}
