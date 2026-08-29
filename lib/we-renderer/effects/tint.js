// WE 渲染引擎 — 效果 Tint (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧 out 改 scratch 池借出; 采样/混合改写入式 (数值语义逐位不变)
import { parseVec3, getVal, applyBlendingInto } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
    effectTint(tex, c, t, combos, pass) {
        // 官方 tint.frag: BLENDMODE 默认 30 (注释), mask = alpha × maskTex.r (MASK)
        // 旧实现默认 2(multiply) + 缺 mask (sf39i)
        const mode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 30;
        const alpha = getVal(c, 'alpha', 1);
        const color = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const w = tex.width, h = tex.height;
        // C2/§9.2 裁决: mask UV 缩放 = mask 自身 header/mip0 比 ≡ 1 → 纯 uv
        // (旧 mask/对象尺寸比与裁决冲突)
        const mSx = 1, mSy = 1;
        const src = tex.rgba;
        const out = scratchGet(SCRATCH_U8, src.length);
        // P0-5: 循环级零分配 scratch (写入式采样/混合目标)
        const s = [0, 0, 0, 0];
        const rgb = [0, 0, 0];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            this._texSampleInto(tex, u, v, false, s);
            let a = alpha;
            // P0-5: mask 只取 R → 单通道 _texR (与 _texSample(...)[0] 同数学)
            if (maskTex) a *= this._texR(maskTex, u * mSx, v * mSy);
            applyBlendingInto(mode, s, color, a, rgb);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: w, height: h, rgba: out };
      }
};
