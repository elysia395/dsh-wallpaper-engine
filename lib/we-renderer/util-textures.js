// WE 内置 util 纹理程序化生成 (W1)
// 官方语义: shader 元注释 {"default":"util/noise"} 等引用的全局纹理随 WE 应用
// 分发 (wallpaper_engine/assets/materials/util/*.tex), 壁纸 pkg 不含; 本机无 WE
// 安装时 (locateWallpaperEngineP=null) CPU loadTexture 与 GL gate 都无法解析 →
// foliagesway 等效果整体跳过/绑纯白近似。本模块提供确定性生成兜底:
//   - 与官方文件不逐字节一致 (不可得, 版权资产不可镜像), 但统计特征对齐:
//     平滑可平铺 value noise, REPEAT 无缝, 多倍频程, 各通道独立种子
//   - 从"效果完全不生效"到"有机摆动"是严格改善; 两条路由 (CPU/GL) 用同一份
//     生成结果, 视觉一致
// 生成器: 整数格点 hash (lowbias32 混合, 无 PRNG 状态) + smoothstep 插值 +
// 倍频程叠加; 格点按 period 回绕 → 纹理边缘无缝 (REPEAT 采样安全)。
import { encodePng } from './canvas.js';

// lowbias32 整数混合 (Chris Wellons) — 确定性格点 hash
function _hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const _smooth = (t) => t * t * (3 - 2 * t);

// 单倍频程可平铺 value noise: 采样坐标 (x,y)∈[0,period) 浮点, 格点 mod period 回绕
function _octave(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = _smooth(x - x0), ty = _smooth(y - y0);
  const w = (v) => ((v % period) + period) % period;
  const v00 = _hash2(w(x0), w(y0), seed);
  const v10 = _hash2(w(x0 + 1), w(y0), seed);
  const v01 = _hash2(w(x0), w(y0 + 1), seed);
  const v11 = _hash2(w(x0 + 1), w(y0 + 1), seed);
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

// 多倍频程叠加 (值域归一到 [0,1)); octaves: [[period, amp], ...]
function _fbm(px, py, size, octaves, seed) {
  let sum = 0, norm = 0;
  for (const [period, amp] of octaves) {
    sum += _octave((px / size) * period, (py / size) * period, period, seed) * amp;
    norm += amp;
  }
  return sum / norm;
}

// util/noise: 256×256, 3 倍频程 (16/32/64 格, 振幅 1/0.5/0.25), RGBA 四通道独立种子
// (官方 noise.tex 为 RGBA 数据纹理; foliagesway 读 .g, filmgrain 读 rgb, alpha
//  也生成为噪声而非 255 — 防着色器把 .a 当随机源时拿到常量)
const _NOISE_OCT = [[16, 1], [32, 0.5], [64, 0.25]];
// util/perlin_256: 4 倍频程 fBm (glitter/cloudmotion 用)
const _PERLIN_OCT = [[8, 1], [16, 0.5], [32, 0.25], [64, 0.125]];
// util/clouds_256: 5 倍频程 + 覆盖度重映射 (godrays/clouds 用; 亮部聚合更像云)
const _CLOUDS_OCT = [[8, 1], [16, 0.5], [32, 0.25], [64, 0.125], [128, 0.0625]];

function _genNoise(size, octaves, channelSeeds, remap) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        let v = _fbm(x, y, size, octaves, channelSeeds[c]);
        if (remap) v = remap(v);
        rgba[i + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }
  return { width: size, height: size, rgba };
}

function _genSolid(r, g, b, a) {
  return { width: 1, height: 1, rgba: new Uint8Array([r, g, b, a]) };
}

// 云覆盖度重映射: smoothstep(0.4, 0.75) 让亮部成块、暗部透空
const _cloudRemap = (v) => {
  const t = Math.max(0, Math.min(1, (v - 0.4) / 0.35));
  return t * t * (3 - 2 * t);
};

// 内置表: 规范名 → 惰性生成器 (首次访问生成, 进程级单例 — 确定性结果全实例共享)
const _BUILDERS = {
  'util/noise': () => _genNoise(256, _NOISE_OCT, [11, 23, 37, 53], null),
  'util/perlin_256': () => _genNoise(256, _PERLIN_OCT, [101, 103, 107, 109], null),
  'util/clouds_256': () => _genNoise(256, _CLOUDS_OCT, [201, 211, 223, 227], _cloudRemap),
  'util/white': () => _genSolid(255, 255, 255, 255),
  'util/black': () => _genSolid(0, 0, 0, 255),
  // 法线/流向"零"纹理: 平面法线编码 (0.5,0.5,1) ≈ (127,127,255) — 与 GL 客户端
  // flowEntry 中灰兜底一致 (shake g_Texture1 default util/noflow)
  'util/noflow': () => _genSolid(127, 127, 255, 255),
};

export const BUILTIN_UTIL_TEXTURES = Object.keys(_BUILDERS);

const _texCache = new Map(); // name → {width,height,rgba}
const _pngCache = new Map(); // name → Buffer(PNG)

// 引用名归一: 'util/noise' / 'util/noise.tex' / 'materials/util/noise.tex' → 'util/noise'
export function normalizeBuiltinUtilName(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  let s = ref.replace(/\\/g, '/');
  const m = /(?:^|\/)(util\/[^/]+?)(?:\.tex)?$/i.exec(s);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return _BUILDERS[name] ? name : null;
}

// CPU 渲染器用: {width,height,rgba} | null (与 loadTexImage 返回形态一致)
export function getBuiltinTexture(ref) {
  const name = normalizeBuiltinUtilName(ref);
  if (!name) return null;
  let t = _texCache.get(name);
  if (!t) { t = _BUILDERS[name](); _texCache.set(name, t); }
  return t;
}

// GL host 用: PNG 字节 | null (/scene-resource 下发; 尺寸与 getBuiltinTexture 一致)
export function getBuiltinTexturePng(ref) {
  const name = normalizeBuiltinUtilName(ref);
  if (!name) return null;
  let p = _pngCache.get(name);
  if (!p) {
    const t = getBuiltinTexture(name);
    p = Buffer.from(encodePng(t.width, t.height, t.rgba));
    _pngCache.set(name, p);
  }
  return p;
}

// GL gate 用: 纹理描述条目 (与 glTexInfo 返回形态一致)
export function getBuiltinTextureInfo(ref) {
  const t = getBuiltinTexture(ref);
  if (!t) return null;
  return {
    path: normalizeBuiltinUtilName(ref),
    width: t.width, height: t.height,
    headerWidth: t.width, headerHeight: t.height,
    video: false,
  };
}
