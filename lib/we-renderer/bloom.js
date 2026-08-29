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
  // P1-25: HDR 通道仅在场景声明 HDR (gen.hdr) 时构建/叠加 — 旧实现无条件构建
  // 且相加, 默认 feather=0 时除 0.001 成硬阶跃 → 非 HDR 场景泛光 5-20 倍过强。
  const isHdr = getVal(gen, 'hdr', false) === true;
  const sw = Math.max(8, Math.floor(W / 4)), sh = Math.max(8, Math.floor(H / 4));
  const bright = new Float32Array(sw * sh * 3);
  const lin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
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
      const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
      r = -gray + r * 2; g = -gray + g * 2; b = -gray + b * 2;
      const o = (y * sw + x) * 3;
      bright[o] = Math.max(0, r * strength * tint[0]);
      bright[o + 1] = Math.max(0, g * strength * tint[1]);
      bright[o + 2] = Math.max(0, b * strength * tint[2]);
    }
  }
  let blurHdr = null;
  if (isHdr) {
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
        // P1-25: feather≤0 不再除 max(0.001) (硬阶跃) — 与 LDR 亮通同款线性衰减
        // sat(scale - threshold), 阶跃行为随 feather → 0 线性收敛。
        const k = hdrFeather > 0
          ? Math.max(0, Math.min(1, (scale - hdrThreshold) / hdrFeather))
          : Math.max(0, Math.min(1, scale - hdrThreshold));
        const o = (y * sw + x) * 3;
        hdr[o] = Math.max(0, r * k * hdrStrength * tint[0]);
        hdr[o + 1] = Math.max(0, g * k * hdrStrength * tint[1]);
        hdr[o + 2] = Math.max(0, b * k * hdrStrength * tint[2]);
      }
    }
    blurHdr = hdr;
  }
  const passes = Math.max(1, Math.round(2 * hdrScatter));
  let blur = bright;
  for (let p = 0; p < passes; p++) {
    const r1 = Math.max(1, Math.round(1.5 * hdrScatter));
    blur = blurQuarter(blur, sw, sh, r1);
    if (blurHdr) blurHdr = blurQuarter(blurHdr, sw, sh, r1);
  }
  const eff = 0.25 * Math.max(1, hdrScatter);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * sw / W));
      const o = (sy * sw + sx) * 3;
      const i = (y * W + x) * 4;
      const br = (blur[o] + (blurHdr ? blurHdr[o] : 0)) * eff;
      const bg = (blur[o + 1] + (blurHdr ? blurHdr[o + 1] : 0)) * eff;
      const bb = (blur[o + 2] + (blurHdr ? blurHdr[o + 2] : 0)) * eff;
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

import path from 'path';
// P0-5: bloom 亮部/模糊 F32 缓冲改 scratch 池 (每帧数块 1/4 分辨率缓冲复用)
import { scratchGet, scratchPut, isScratch, SCRATCH_F32 } from './effects/_scratch.js';

// ── bloom mixin (从 core.js 拆分, 逻辑零改动) ──
export function installBloom(proto) {
  Object.assign(proto, {
    _applyBloom(gen) {
        const W = this.W, H = this.H;
        const data = this.canvas.data;
        const getNum = (v, d) => {
          if (v == null) return d;
          if (typeof v === 'object' && v !== null && 'value' in v) return typeof v.value === 'number' ? v.value : d;
          return typeof v === 'number' ? v : d;
        };
        const threshold = getNum(gen.bloomthreshold, 0.65);
        const strength = getNum(gen.bloomstrength, 1);
        const tint = parseVec3(getVal(gen, 'bloomtint', '1 1 1'), [1, 1, 1]);
        // HDR 参数
        const hdrThreshold = getNum(gen.bloomhdrthreshold, threshold);
        const hdrStrength = getNum(gen.bloomhdrstrength, strength);
        const hdrScatter = getNum(gen.bloomhdrscatter, 1);
        const hdrFeather = getNum(gen.bloomhdrfeather, 0);
        // P1-25: HDR 通道仅场景声明 HDR (gen.hdr) 时构建/叠加 (见上方 applyBloom
        // 同款注释) — 旧实现无条件构建+相加, 非 HDR 场景泛光数倍过强
        const isHdr = getVal(gen, 'hdr', false) === true;
        // 曝光 (combine_hdr g_RenderVar0.x) — 近似 1
        const exposure = 1;
        // 降采样 1/4: 4 角平均 (downsample_quarter_bloom)
        const sw = Math.max(8, Math.floor(W / 4)), sh = Math.max(8, Math.floor(H / 4));
        // P0-5: F32 缓冲池借出
        const bright = scratchGet(SCRATCH_F32, sw * sh * 3);
        const lin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            // 源区域 4 角 (映射到全分辨率)
            const x0 = Math.floor(x * W / sw), x1 = Math.min(W - 1, x0 + Math.floor(W / sw));
            const y0 = Math.floor(y * H / sh), y1 = Math.min(H - 1, y0 + Math.floor(H / sh));
            let r = 0, g = 0, b = 0;
            for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
              const i = (sy * W + sx) * 4;
              r += data[i] / 255; g += data[i + 1] / 255; b += data[i + 2] / 255;
            }
            r *= 0.25; g *= 0.25; b *= 0.25;
            // saturate(scale - threshold) — 引擎: albedo *= saturate(scale - threshold)
            const scale = Math.max(r, g, b);
            const k = Math.max(0, Math.min(1, scale - threshold));
            r *= k; g *= k; b *= k;
            // 饱和度增强 (引擎: -gray*sat + albedo*(1+sat), sat=1)
            const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
            r = -gray + r * 2; g = -gray + g * 2; b = -gray + b * 2;
            // × strength × tint
            const o = (y * sw + x) * 3;
            bright[o] = Math.max(0, r * strength * tint[0]);
            bright[o + 1] = Math.max(0, g * strength * tint[1]);
            bright[o + 2] = Math.max(0, b * strength * tint[2]);
          }
        }
        // HDR 通道: 更高阈值 + 强度 (单独降采样) — 仅 gen.hdr 场景 (P1-25)
        let blurHdr = null;
        if (isHdr) {
          // P0-5: F32 缓冲池借出
          const hdr = scratchGet(SCRATCH_F32, sw * sh * 3);
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
              // 软阈值 (hdrfeather): smoothstep 过渡。
              // P1-25: feather≤0 不再除 max(0.001) 成硬阶跃 — 改线性衰减
              // sat(scale - threshold), 与 LDR 亮通一致, 行为随 feather→0 线性收敛
              const k = hdrFeather > 0
                ? Math.max(0, Math.min(1, (scale - hdrThreshold) / hdrFeather))
                : Math.max(0, Math.min(1, scale - hdrThreshold));
              const o = (y * sw + x) * 3;
              hdr[o] = Math.max(0, r * k * hdrStrength * tint[0]);
              hdr[o + 1] = Math.max(0, g * k * hdrStrength * tint[1]);
              hdr[o + 2] = Math.max(0, b * k * hdrStrength * tint[2]);
            }
          }
          blurHdr = hdr;
        }
        // 散射: 多次模糊 (hdrScatter 控制扩散) — combine_hdr upsample 的 ×0.25×scatter 等价
        const passes = Math.max(1, Math.round(2 * hdrScatter));
        let blur = bright;
        for (let p = 0; p < passes; p++) {
          const r1 = Math.max(1, Math.round(1.5 * hdrScatter));
          blur = this._blurQuarter(blur, sw, sh, r1);
          if (blurHdr) blurHdr = this._blurQuarter(blurHdr, sw, sh, r1);
        }
        // 合成: 引擎 combine (LDR: albedo+bloom; HDR: lin(albedo)+bloom)
        const eff = 0.25 * Math.max(1, hdrScatter);
        for (let y = 0; y < H; y++) {
          const sy = Math.min(sh - 1, Math.floor(y * sh / H));
          for (let x = 0; x < W; x++) {
            const sx = Math.min(sw - 1, Math.floor(x * sw / W));
            const o = (sy * sw + sx) * 3;
            const i = (y * W + x) * 4;
            const br = (blur[o] + (blurHdr ? blurHdr[o] : 0)) * eff;
            const bg = (blur[o + 1] + (blurHdr ? blurHdr[o + 1] : 0)) * eff;
            const bb = (blur[o + 2] + (blurHdr ? blurHdr[o + 2] : 0)) * eff;
            if (isHdr) {
              // HDR: lin(albedo) + bloom → 曝光 (引擎 combine_hdr)
              const r = lin(data[i] / 255) + br;
              const g2 = lin(data[i + 1] / 255) + bg;
              const b2 = lin(data[i + 2] / 255) + bb;
              data[i] = Math.min(255, Math.round(sat(r) * exposure * 255));
              data[i + 1] = Math.min(255, Math.round(sat(g2) * exposure * 255));
              data[i + 2] = Math.min(255, Math.round(sat(b2) * exposure * 255));
            } else {
              // LDR: albedo + bloom (引擎 combine.frag)
              data[i] = Math.min(255, data[i] + Math.round(br * 255));
              data[i + 1] = Math.min(255, data[i + 1] + Math.round(bg * 255));
              data[i + 2] = Math.min(255, data[i + 2] + Math.round(bb * 255));
            }
          }
        }
        // P0-5: 合成消费完 → 末级模糊缓冲归还池
        if (isScratch(blur)) scratchPut(blur);
        if (blurHdr && isScratch(blurHdr)) scratchPut(blurHdr);
      }

      // 1/4 分辨率盒式模糊 (bloom 散射)
,
    _blurQuarter(src, sw, sh, r) {
        // P0-5: F32 缓冲池借出
        const out = scratchGet(SCRATCH_F32, sw * sh * 3);
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
        // P0-5: 输入缓冲已消费完 → 归还
        if (isScratch(src)) scratchPut(src);
        return out;
      }
    
      // ── 相机 / 光照环境 (scene.json camera + general) ──────────────────
      // camera paths: 多 path 顺序循环 (总时长 = duration 和), path 内关键帧线性插值
  });
}
