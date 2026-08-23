// WE 渲染引擎 — HDR/bloom 后处理 (引擎源码: downsample_quarter_bloom → combine_hdr)
// 1. 降采样 1/4: 4 角平均 → saturate(scale-threshold) → 饱和度增强 → ×strength×tint
// 2. 合成: 原图 + bloom 4 角平均×0.25 → 线性化 lin() → ×曝光
import { parseVec3, getVal, sat } from './math.js';

export function applyBloom(canvas, gen, getNum) {
  const W = canvas.w, H = canvas.h;
  const data = canvas.data;
  const threshold = getNum(gen.bloomthreshold, 0.65);
  const strength = getNum(gen.bloomstrength, 1);
  const tint = parseVec3(getVal(gen, 'bloomtint', '1 1 1'), [1, 1, 1]);
  const hdrThreshold = getNum(gen.bloomhdrthreshold, threshold);
  const hdrStrength = getNum(gen.bloomhdrstrength, strength);
  const hdrScatter = getNum(gen.bloomhdrscatter, 1);
  const hdrFeather = getNum(gen.bloomhdrfeather, 0);
  const exposure = 1;
  const sw = Math.max(8, Math.floor(W / 4)), sh = Math.max(8, Math.floor(H / 4));
  const bright = new Float32Array(sw * sh * 3);
  const lin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  // 降采样 + 亮部提取 (downsample_quarter_bloom)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor(x * W / sw), x1 = Math.min(W - 1, x0 + Math.floor(W / sw));
      const y0 = Math.floor(y * H / sh), y1 = Math.min(H - 1, y0 + Math.floor(H / sh));
      let r = 0, g = 0, b = 0;
      for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        const i = (sy * W + sx) * 4;
        r += data[i] / 255; g += data[i + 1] / 255; b += data[i + 2] / 255;
      }
      r *= 0.25; g *= 0.25; b *= 0.25;
      const scale = Math.max(r, g, b);
      const k = Math.max(0, Math.min(1, scale - threshold));
      r *= k; g *= k; b *= k;
      // 饱和度增强 (引擎 sat=1)
      const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
      r = -gray + r * 2; g = -gray + g * 2; b = -gray + b * 2;
      const o = (y * sw + x) * 3;
      bright[o] = Math.max(0, r * strength * tint[0]);
      bright[o + 1] = Math.max(0, g * strength * tint[1]);
      bright[o + 2] = Math.max(0, b * strength * tint[2]);
    }
  }
  // HDR 通道: 更高阈值 + 强度 (软阈值 feather)
  const hdr = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor(x * W / sw), x1 = Math.min(W - 1, x0 + Math.floor(W / sw));
      const y0 = Math.floor(y * H / sh), y1 = Math.min(H - 1, y0 + Math.floor(H / sh));
      let r = 0, g = 0, b = 0;
      for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        const i = (sy * W + sx) * 4;
        r += data[i] / 255; g += data[i + 1] / 255; b += data[i + 2] / 255;
      }
      r *= 0.25; g *= 0.25; b *= 0.25;
      const scale = Math.max(r, g, b);
      const k = Math.max(0, Math.min(1, (scale - hdrThreshold) / Math.max(0.001, hdrFeather)));
      const o = (y * sw + x) * 3;
      hdr[o] = Math.max(0, r * k * hdrStrength * tint[0]);
      hdr[o + 1] = Math.max(0, g * k * hdrStrength * tint[1]);
      hdr[o + 2] = Math.max(0, b * k * hdrStrength * tint[2]);
    }
  }
  // 散射: 多次盒式模糊 (近似 upsample ×0.25×scatter)
  const passes = Math.max(1, Math.round(2 * hdrScatter));
  let blur = bright, blurHdr = hdr;
  for (let p = 0; p < passes; p++) {
    const r1 = Math.max(1, Math.round(1.5 * hdrScatter));
    blur = blurQuarter(blur, sw, sh, r1);
    blurHdr = blurQuarter(blurHdr, sw, sh, r1);
  }
  // 合成: LDR (albedo+bloom) / HDR (lin(albedo)+bloom)
  const isHdr = getVal(gen, 'hdr', false) === true;
  const eff = 0.25 * Math.max(1, hdrScatter);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * sw / W));
      const o = (sy * sw + sx) * 3;
      const i = (y * W + x) * 4;
      const br = (blur[o] + blurHdr[o]) * eff;
      const bg = (blur[o + 1] + blurHdr[o + 1]) * eff;
      const bb = (blur[o + 2] + blurHdr[o + 2]) * eff;
      if (isHdr) {
        const r = lin(data[i] / 255) + br;
        const g2 = lin(data[i + 1] / 255) + bg;
        const b2 = lin(data[i + 2] / 255) + bb;
        data[i] = Math.min(255, Math.round(sat(r) * exposure * 255));
        data[i + 1] = Math.min(255, Math.round(sat(g2) * exposure * 255));
        data[i + 2] = Math.min(255, Math.round(sat(b2) * exposure * 255));
      } else {
        data[i] = Math.min(255, data[i] + Math.round(br * 255));
        data[i + 1] = Math.min(255, data[i + 1] + Math.round(bg * 255));
        data[i + 2] = Math.min(255, data[i + 2] + Math.round(bb * 255));
      }
    }
  }
}

function blurQuarter(src, sw, sh, r) {
  const out = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let rSum = 0, gSum = 0, bSum = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(sh - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(sw - 1, Math.max(0, x + dx));
          const o = (yy * sw + xx) * 3;
          rSum += src[o]; gSum += src[o + 1]; bSum += src[o + 2]; n++;
        }
      }
      const o = (y * sw + x) * 3;
      out[o] = rSum / n; out[o + 1] = gSum / n; out[o + 2] = bSum / n;
    }
  }
  return out;
}
