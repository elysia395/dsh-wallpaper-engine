// WE 渲染引擎 — 效果 Filmgrain (从 effects.js 拆分)
// P0-5: 整帧 out 改 scratch 池; 采样改写入式/单通道; 噪声链标量化;
// applyBlending 直写 (所有表达式与原版逐位一致)
import { getVal, applyBlendingInto } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
    effectFilmgrain(tex, c, t, combos, pass) {
        // P1-17/横切4: BLENDMODE 显式 0 (Normal) 不许被 || 吞 (LGT-07)
        const mode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 12; // 默认 softlight
        // P1-17: GREYSCALE 宽兼容 (字符串 '1' 与 1 等价, 旧 === 1 双失效)
        const greyscale = combos.GREYSCALE != null ? Number(combos.GREYSCALE) : 1;
        const noiseAlpha = getVal(c, 'ui_editor_properties_strength', 2);
        const noisePower = getVal(c, 'ui_editor_properties_power', 0.5);
        const noiseScale = getVal(c, 'ui_editor_properties_scale', 10);
        const tex1 = pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : this.loadTexture('util/noise');
        // P1-17: MASK 同宽兼容 (库内其余效果均 '1'||1 双判)
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const tex2 = hasMask && pass.textures && pass.textures[2] ? this.loadTexture(pass.textures[2]) : null;
        const aspect = tex.width / tex.height;
        const w = tex.width, h = tex.height;
        // sf35: mask UV 缩放 = mask 自身 header/mip0 比 (≡ 1; 旧 mask/object 比错误平铺)
        const mSx = 1, mSy = 1;
        const out = scratchGet(SCRATCH_U8, tex.rgba.length);
        // P0-5: 写入式采样/混合 scratch
        const s = [0, 0, 0, 0];
        const n1s = [0, 0, 0, 0], n2s = [0, 0, 0, 0];
        const np = [0, 0, 0];
        const rgb = [0, 0, 0];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            this._texSampleInto(tex, u, v, false, s);
            // v_TexCoordNoise.xy = (uv + t) * scale * (aspect,1); .zw = (uv - t*2.5) * scale * 0.52 * (aspect,1)
            // 官方 vert: t = frac(g_Time) (sf39i)
            const tf = t - Math.floor(t);
            // P0-5: 噪声双采样写入式 (缺失时保持 [1,1,1,1] 白契约)
            let a0, a1, a2, b0, b1, b2;
            if (tex1) {
              this._texSampleInto(tex1, (u + tf) * noiseScale * aspect, (v + tf) * noiseScale, false, n1s);
              a0 = n1s[0]; a1 = n1s[1]; a2 = n1s[2];
            } else { a0 = 1; a1 = 1; a2 = 1; }
            if (tex1) {
              this._texSampleInto(tex1, (u - tf * 2.5) * noiseScale * 0.52 * aspect, (v - tf * 2.5) * noiseScale * 0.52, false, n2s);
              b0 = n2s[1]; b1 = n2s[2]; b2 = n2s[0]; // .gbr
            } else { b0 = 1; b1 = 1; b2 = 1; }
            if (greyscale === 1) {
              const g1 = a0 * 0.11 + a1 * 0.59 + a2 * 0.3; // _greyscale(noise)
              const g2 = b0 * 0.11 + b1 * 0.59 + b2 * 0.3; // _greyscale(noise2)
              a0 = g1; a1 = g1; a2 = g1; b0 = g2; b1 = g2; b2 = g2;
            }
            // _sat3 × Math.pow(noisePower) 标量化
            np[0] = Math.pow(Math.max(0, Math.min(1, a0 * b0)), noisePower);
            np[1] = Math.pow(Math.max(0, Math.min(1, a1 * b1)), noisePower);
            np[2] = Math.pow(Math.max(0, Math.min(1, a2 * b2)), noisePower);
            let blend = noiseAlpha;
            if (tex2) blend *= this._texR(tex2, u * mSx, v * mSy);
            applyBlendingInto(mode, s, np, blend, rgb);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(tex.rgba)) scratchPut(tex.rgba);
        return { width: w, height: h, rgba: out };
      }
};
