// WE 渲染引擎 — HDR/bloom 后处理 (引擎源码: downsample_quarter_bloom → combine_hdr)
// 1. 降采样 1/4: 4 角平均 → saturate(scale-threshold) → 饱和度增强 → ×strength×tint
// 2. 合成: 原图 + bloom 4 角平均×0.25 → 线性化 lin() → ×曝光
import { parseVec3, getVal, sat } from './math.js';

// N-15: 原此处的独立版 applyBloom/blurQuarter 已删除 — 与下方 installBloom
// 注入的 _applyBloom/_blurQuarter 是重复的完整实现, 全仓 grep 确认仅被
// scene-renderer.js 再导出、无任何 import 消费 (死代码); 渲染路径始终走
// core.js installBloom 注入的实例方法
import path from 'path';
// P0-5: bloom 亮部/模糊 F32 缓冲改 scratch 池 (每帧数块 1/4 分辨率缓冲复用)
import { scratchGet, scratchPut, isScratch, SCRATCH_F32 } from './effects/_scratch.js';

// P2-13: lin() 精确查表 — 输入恒为 data[i]/255 (data 是 Uint8Array, 仅 256 个
// 离散整数键)。表项用与原 lin 完全相同的表达式 (v=i/255) 预计算, 双精度原样
// 存取, 与逐像素 lin(data[i]/255) 逐位一致 — 非整数幂 (2.4) 不做任何近似,
// 消除 HDR 合成每像素 3 次 Math.pow
let _linLut = null;
function linLutGet(lin) {
  if (_linLut) return _linLut;
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) t[i] = lin(i / 255);
  _linLut = t;
  return t;
}

// P2-13: _blurQuarter 钳制窗口偏移表 (模块级按需扩容复用, 单线程无重入)
let _blurRowOff = null, _blurColOff = null;

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
            // P2-13: 4 角采样解构解循环 — 原实现每像素分配 [[x0,y0],...] 字面量
            // 数组 + 迭代器; 累加顺序不变 ((x0,y0)→(x1,y0)→(x0,y1)→(x1,y1)),
            // 逐位一致
            let i4 = (y0 * W + x0) * 4;
            r += data[i4] / 255; g += data[i4 + 1] / 255; b += data[i4 + 2] / 255;
            i4 = (y0 * W + x1) * 4;
            r += data[i4] / 255; g += data[i4 + 1] / 255; b += data[i4 + 2] / 255;
            i4 = (y1 * W + x0) * 4;
            r += data[i4] / 255; g += data[i4 + 1] / 255; b += data[i4 + 2] / 255;
            i4 = (y1 * W + x1) * 4;
            r += data[i4] / 255; g += data[i4 + 1] / 255; b += data[i4 + 2] / 255;
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
              // P2-13: 4 角采样解构解循环 (同上, 累加顺序不变, 逐位一致)
              let i4 = (y0 * W + x0) * 4;
              r += data[i4] / 255; g += data[i4 + 1] / 255; b += data[i4 + 2] / 255;
              i4 = (y0 * W + x1) * 4;
              r += data[i4] / 255; g += data[i4 + 1] / 255; b += data[i4 + 2] / 255;
              i4 = (y1 * W + x0) * 4;
              r += data[i4] / 255; g += data[i4 + 1] / 255; b += data[i4 + 2] / 255;
              i4 = (y1 * W + x1) * 4;
              r += data[i4] / 255; g += data[i4 + 1] / 255; b += data[i4 + 2] / 255;
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
        // P2-13: HDR 路 lin() 换 256 项精确查表 (键 = data[i] 整数 0..255,
        // 表项与原表达式逐字相同 → 逐位一致; 消除每像素 3 次 Math.pow)
        const lut = isHdr ? linLutGet(lin) : null;
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
              const r = lut[data[i]] + br;
              const g2 = lut[data[i + 1]] + bg;
              const b2 = lut[data[i + 2]] + bb;
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
        // P2-13: 钳制窗口偏移预计算 — clamp(y+dy)/clamp(x+dx) 与像素内容无关,
        // 原内核每 tap 两次 Math.min/max + 乘法 + n++。预计算后每 tap 只剩两次
        // 表读 + 加法; 元素偏移表 (×3) 直接相加。求和顺序与项数完全不变 → 逐位
        // 一致。O(r²) 可分离化会改变浮点累加分组 (行和先行 vs 行列交错), 不满足
        // 逐位一致铁律 → 跳过 (见 .we-fix-accept 验收报告)
        const size = 2 * r + 1;
        if (!_blurRowOff || _blurRowOff.length < size) _blurRowOff = new Int32Array(size);
        const rowOff = _blurRowOff; // 每行重填: rowOff[k] = clamp(y+k-r)*sw*3
        if (!_blurColOff || _blurColOff.length < sw * size) _blurColOff = new Int32Array(sw * size);
        const colOff = _blurColOff; // 一次填: colOff[x*size+k] = clamp(x+k-r)*3
        for (let x = 0; x < sw; x++) {
          for (let k = 0; k < size; k++) {
            const xx = Math.min(sw - 1, Math.max(0, x + k - r));
            colOff[x * size + k] = xx * 3;
          }
        }
        const n = size * size; // ≡ 原 n++ 累计的 (2r+1)² (小整数精确同值)
        for (let y = 0; y < sh; y++) {
          for (let k = 0; k < size; k++) {
            const yy = Math.min(sh - 1, Math.max(0, y + k - r));
            rowOff[k] = yy * sw * 3;
          }
          const rowBase = y * sw * 3;
          for (let x = 0; x < sw; x++) {
            let rSum = 0, gSum = 0, bSum = 0;
            const coff = x * size;
            for (let dy = 0; dy < size; dy++) {
              const ro = rowOff[dy];
              for (let dx = 0; dx < size; dx++) {
                const o = ro + colOff[coff + dx];
                rSum += src[o]; gSum += src[o + 1]; bSum += src[o + 2];
              }
            }
            const o = rowBase + x * 3;
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
