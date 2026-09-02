// WE 渲染引擎 — 效果 Skew (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧 out 改 scratch 池; 主图采样改写入式 (数值语义逐位不变)
import { getVal } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
      // skew (引擎 shader: effects/skew.frag/vert, MODE=0 UV 模式):
      //   UV 按象限偏移: u −= step(v≤0.5)·top + step(v>0.5)·bottom
      //                   v += step(u≤0.5)·left + step(u>0.5)·right   (step 用原始 UV)
      //   REPEAT combo (默认 1): frac(uv); uniform: top/bottom/left/right (默认 0)

    effectSkew(tex, c, t, pass) {
        const top = getVal(c, 'top', 0), bottom = getVal(c, 'bottom', 0);
        const left = getVal(c, 'left', 0), right = getVal(c, 'right', 0);
        const combos = (pass && pass.combos) || {};
        const rep = combos.REPEAT === '0' || combos.REPEAT === 0 ? false : true;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = scratchGet(SCRATCH_U8, src.length);
        const s = [0, 0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u0 = (x + 0.5) / W, v0 = (y + 0.5) / H;
            let u = u0 - (v0 <= 0.5 ? top : bottom);
            let v = v0 + (u0 <= 0.5 ? left : right);
            if (rep) { u = u - Math.floor(u); v = v - Math.floor(v); }
            // P1-13: REPEAT=0 (不 frac) 时位移 UV 越界 → _texSample 默认 wrap
            // 回绕对侧; §9.6 主图语义 → clamp
            this._texSampleInto(tex, u, v, !rep, s);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
