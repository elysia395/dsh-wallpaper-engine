// WE 渲染引擎 — 效果 Opacity (从 effects.js 拆分, 逻辑零改动)
import { getVal } from '../math.js';

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
        const out = new Uint8Array(src.length);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const m = this._texSample(maskTex, u * mSx, v * mSy)[0];
            const di = (y * W + x) * 4;
            out[di] = src[di]; out[di + 1] = src[di + 1]; out[di + 2] = src[di + 2];
            out[di + 3] = Math.round(src[di + 3] * m * userAlpha);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
