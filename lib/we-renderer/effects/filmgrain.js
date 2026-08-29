// WE 渲染引擎 — 效果 Filmgrain (从 effects.js 拆分)
import { getVal, applyBlending, _greyscale, _sat3 } from '../math.js';

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
        const out = new Uint8Array(tex.rgba.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            // v_TexCoordNoise.xy = (uv + t) * scale * (aspect,1); .zw = (uv - t*2.5) * scale * 0.52 * (aspect,1)
            // 官方 vert: t = frac(g_Time) (sf39i)
            const tf = t - Math.floor(t);
            const n1 = tex1 ? this._texSample(tex1, (u + tf) * noiseScale * aspect, (v + tf) * noiseScale) : [1, 1, 1, 1];
            const n2 = tex1 ? this._texSample(tex1, (u - tf * 2.5) * noiseScale * 0.52 * aspect, (v - tf * 2.5) * noiseScale * 0.52) : [1, 1, 1, 1];
            let noise = [n1[0], n1[1], n1[2]];
            let noise2 = [n2[1], n2[2], n2[0]]; // .gbr
            if (greyscale === 1) {
              const g1 = _greyscale(noise), g2 = _greyscale(noise2);
              noise = [g1, g1, g1]; noise2 = [g2, g2, g2];
            }
            const mul = _sat3([noise[0] * noise2[0], noise[1] * noise2[1], noise[2] * noise2[2]]);
            const np = mul.map((v) => Math.pow(v, noisePower));
            let blend = noiseAlpha;
            if (tex2) blend *= this._texSample(tex2, u * mSx, v * mSy)[0];
            const rgb = applyBlending(mode, [s[0], s[1], s[2]], np, blend);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
};
