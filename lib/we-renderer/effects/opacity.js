// WE 渲染引擎 — 效果 Opacity (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧 out 改 scratch 池借出; mask 采样换单通道 _texR (同数学)
import { getVal } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
      // opacity (引擎 shader: effects/opacity.frag): albedo.a *= mask × g_UserAlpha
      //   g_Texture0 = 对象自身纹理, g_Texture1 = mask (默认 util/white)
      //   g_UserAlpha = alpha 参数 (默认 1.0) — 旧实现缺 alpha 且 mask UV 未缩放 (sf39j)

    effectOpacity(tex, c, t, pass) {
        const pt = (pass && pass.textures) || [];
        const maskTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : this.loadTexture('util/white');
        const userAlpha = getVal(c, 'alpha', 1);
        const W = tex.width, H = tex.height;
        // sf35: mask UV 缩放 = mask 自身 header/mip0 比 (≡ 1; 旧 mask/object 比错误平铺)
        const mSx = 1, mSy = 1;
        const src = tex.rgba;
        // P0-5: 整帧 out 改 scratch 池借出
        const out = scratchGet(SCRATCH_U8, src.length);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // P0-5: mask 只取 R → _texR; mask 缺失时保持 _texSample(null)[0]=1 契约
            const m = maskTex ? this._texR(maskTex, u * mSx, v * mSy) : 1;
            const di = (y * W + x) * 4;
            out[di] = src[di]; out[di + 1] = src[di + 1]; out[di + 2] = src[di + 2];
            out[di + 3] = Math.round(src[di + 3] * m * userAlpha);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
