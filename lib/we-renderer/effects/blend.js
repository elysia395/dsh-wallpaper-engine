// WE 渲染引擎 — 效果 Blend (从 effects.js 拆分)
import { getVal, applyBlending } from '../math.js';
import { degradedOnce } from './_once.js';

export const fx = {
      // blend (官方 effects/blend, 单 pass):
      //   blendUV = v_TexCoord.zw (blend 纹理 UV 缩放); blend = OPACITYMASK·GetUVBlend
      //   PerformBlend: WRITEALPHA=1 时 alpha 合成 (premultiplied 数学);
      //     否则 blendAlpha·= blendColors.a; rgb = ApplyBlending(BLENDMODE, albedo, blendColors, blendAlpha)
      //   uniform: multiply/alpha; combos: BLENDMODE/WRITEALPHA/TRANSFORMUV/TRANSFORMREPEAT/
      //     NUMBLENDTEXTURES/OPACITYMASK; blend 纹理 = textures[1]
    effectBlend(tex, passes, c, t, pass) {
        const p = (passes && passes[0]) || {};
        const combos = p.combos || {};
        const c1 = p.constantshadervalues || {};
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 2;
        const writeAlpha = combos.WRITEALPHA === '1' || combos.WRITEALPHA === 1;
        const numTextures = combos.NUMBLENDTEXTURES != null ? Number(combos.NUMBLENDTEXTURES) : 1;
        const opMask = combos.OPACITYMASK === '1' || combos.OPACITYMASK === 1;
        const transformUV = combos.TRANSFORMUV === '1' || combos.TRANSFORMUV === 1;
        // P1-10: transformRepeat 是 boolean, 下游不得再 === 1/=== 0 数值比较
        // (旧 :58/:63 双死分支 → TRANSFORMUV 从不 frac 也不裁剪, clip 模式下
        // _texSample 静默 wrap 到越界区)
        const transformRepeat = combos.TRANSFORMREPEAT === '1' || combos.TRANSFORMREPEAT === 1;
        const multiply = getVal(c1, 'multiply', getVal(c, 'multiply', 1));
        const pt = p.textures || [];
        const blendTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const opMaskTex = opMask && pt[7] && pt[7] !== 'null' ? this.loadTexture(pt[7]) : null;
        // C4/LGT-12: blend 纹理缺失 → WRITEALPHA 下 bc=[1,1,1,1] 白图把整层
        // alpha 推向 1; blend 纹理是本效果的唯一输入, 缺失即无效果 → 跳过
        if (!blendTex) {
          degradedOnce(this, 'effect:blend:texture', 'blend 混合纹理缺失，已跳过该效果（对象保留）');
          return tex;
        }
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        // C2/§9.2 裁决: blend/opacitymask 纹理 UV 缩放 = 纹理自身 header/mip0
        // 比 ≡ 1 → 纯 uv (旧 blendTex.width/W 对象尺寸比与裁决冲突)
        const bSx = 1, bSy = 1;
        const oSx = 1, oSy = 1;
        const step01 = (x) => (x >= 0.01 ? 1 : 0);
        const performBlend = (albedo, bc, blendAlpha) => {
          if (writeAlpha) {
            const newAlpha = albedo[3] * (1 - blendAlpha) + bc[3] * blendAlpha;
            const rgb = [
              albedo[0] * albedo[3] * (1 - blendAlpha) + bc[0] * bc[3] * blendAlpha,
              albedo[1] * albedo[3] * (1 - blendAlpha) + bc[1] * bc[3] * blendAlpha,
              albedo[2] * albedo[3] * (1 - blendAlpha) + bc[2] * bc[3] * blendAlpha,
            ];
            const s = step01(albedo[3]) * (1 - bc[3] * blendAlpha);
            const d = step01(bc[3] * (1 - albedo[3] * (1 - blendAlpha)));
            for (let i = 0; i < 3; i++) {
              const srcRgb = bc[i] + (albedo[i] - bc[i]) * s;
              const dstRgb = albedo[i] + (bc[i] - albedo[i]) * d;
              rgb[i] += (srcRgb + (dstRgb - srcRgb) * blendAlpha) * (1 - newAlpha);
            }
            return [rgb[0], rgb[1], rgb[2], newAlpha];
          }
          const ba = blendAlpha * bc[3];
          const rgb2 = applyBlending(blendMode, [albedo[0], albedo[1], albedo[2]], [bc[0], bc[1], bc[2]], ba);
          return [rgb2[0], rgb2[1], rgb2[2], albedo[3]];
        };
        const frac2 = (x) => x - Math.floor(x);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const albedo = this._texSample(tex, u, v);
            let blendUV = [u * bSx, v * bSy];
            if (transformUV && transformRepeat) blendUV = [frac2(blendUV[0]), frac2(blendUV[1])];
            const bc = blendTex ? this._texSample(blendTex, blendUV[0], blendUV[1]) : [1, 1, 1, 1];
            let blend = 1;
            if (opMaskTex) blend *= this._texSample(opMaskTex, u * oSx, v * oSy)[0];
            // GetUVBlend: TRANSFORMUV+clip 时越界 UV 禁止混合
            if (transformUV && !transformRepeat) {
              const inside = blendUV[0] >= 0 && blendUV[0] <= 1 && blendUV[1] >= 0 && blendUV[1] <= 1;
              blend *= inside ? 1 : 0;
            }
            const res = performBlend(albedo, bc, blend * multiply);
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, res[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, res[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, res[2])) * 255);
            out[di + 3] = Math.round(Math.min(1, Math.max(0, res[3])) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
