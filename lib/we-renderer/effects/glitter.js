// WE 渲染引擎 — 效果 Glitter (从 effects.js 拆分)
import { parseVec3, getVal, applyBlending } from '../math.js';
import { degradedOnce } from './_once.js';

export const fx = {
      // glitter (引擎 shader: effects/glitter_prepare.frag + glitter_combine.frag):
      // 双 pass — pass0 生成 256×256 r8 闪光图案 (_rt_GlitterTiles, uvs=repeat),
      // pass1 用闪光图案混合
      //   prepare: noiseCoord = uv·5; n0r = noise.r·(1−noise.g); timer = frac(n0r·100 + t·speed·density²)
      //            glitter = smoothstep 双峰 × smoothstep(0.5,1) ²
      //   combine: glitter = sample(图案, uv·(w/h)·scale).r; rgb = ApplyBlending(BLENDMODE, albedo, color·glitter, alpha·mask)
      //   uniform: pass0 speed/density; pass1 scale/alpha/color; MASK/BLENDMODE combo (combine)
    effectGlitter(tex, passes, t) {
        const p0 = (passes && passes[0]) || {}, p1 = (passes && passes[1]) || {};
        const c0 = p0.constantshadervalues || {}, c1 = p1.constantshadervalues || {};
        const k1 = p1.combos || {};
        const speed = getVal(c0, 'speed', 1);
        const density = getVal(c0, 'density', 0.5);
        const glitterScale = getVal(c1, 'scale', 1);
        const glitterOpacity = getVal(c1, 'alpha', 1);
        const glitterColor = parseVec3(getVal(c1, 'color', '1 1 1'), [1, 1, 1]);
        const hasMask = k1.MASK === '1' || k1.MASK === 1;
        const blendMode = k1.BLENDMODE != null ? Number(k1.BLENDMODE) : 32;
        const p1tex = p1.textures || [];
        const maskTex = hasMask && p1tex[2] && p1tex[2] !== 'null' ? this.loadTexture(p1tex[2]) : null;
        // C2/§9.2 裁决: v_TexCoord.zw mask UV 缩放 = g_Texture1Res.zw/xy = mask
        // 自身 header/mip0 比 ≡ 1 → 纯 uv (旧 maskRes/对象Res 注释与裁决冲突,
        // sf39j 作废 — F-15)
        const mSx = 1, mSy = 1;
        // P1-15: 噪声纹理读场景槽位 (prepare pass g_Texture1 = passes[0].
        // textures[1]); 槽位缺省才回退内置默认 util/perlin_256 (旧实现硬编码
        // → 场景自带噪声被忽略)
        const p0tex = p0.textures || [];
        const noiseTex = p0tex[1] && p0tex[1] !== 'null' ? this.loadTexture(p0tex[1]) : this.loadTexture('util/perlin_256');
        // C4/LGT-12: 噪声缺失 → 白 → n0r 恒 1·(1−0)=… 全部 65536 格同步闪烁;
        // 无法用常量近似官方 perlin → 跳过该效果 + 记一次 degraded
        if (!noiseTex) {
          degradedOnce(this, 'effect:glitter:noise', 'glitter 噪声纹理缺失（util/perlin_256 不可用），已跳过该效果（对象保留）');
          return tex;
        }
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        const frac = (x) => x - Math.floor(x);
        // ── pass 0: prepare (256×256 闪光图案, r8) ──
        const TW = 256, TH = 256;
        const glitterRgba = new Uint8Array(TW * TH * 4);
        const d2 = density * density;
        const tm = t * speed * d2;
        const gd = d2 * 0.5;
        for (let gy = 0; gy < TH; gy++) {
          for (let gx = 0; gx < TW; gx++) {
            const nu = ((gx + 0.5) / TW) * 5, nv = ((gy + 0.5) / TH) * 5;
            const n0 = this._texSample(noiseTex, nu, nv);
            const n0r = n0[0] * (1 - n0[1]);
            const timer0 = frac(n0r * 100 + tm);
            let g0 = ss(0.5 - gd, 0.5, timer0) * ss(0.5 + gd, 0.5, timer0);
            g0 = ss(0.5, 1, g0);
            g0 *= g0;
            const di = (gy * TW + gx) * 4;
            const v8 = Math.round(Math.min(1, g0) * 255);
            glitterRgba[di] = v8; glitterRgba[di + 1] = v8; glitterRgba[di + 2] = v8; glitterRgba[di + 3] = 255;
          }
        }
        const glitterTex = { width: TW, height: TH, rgba: glitterRgba };
        // ── pass 1: combine ──
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const aspect = W / H;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const albedo = this._texSample(tex, u, v);
            let mask = 1;
            if (maskTex) mask = this._texSample(maskTex, u * mSx, v * mSy)[0];
            const glitter = this._texSample(glitterTex, u * aspect * glitterScale, v * glitterScale)[0];
            const col = [glitterColor[0] * glitter, glitterColor[1] * glitter, glitterColor[2] * glitter];
            const rgb = applyBlending(blendMode, [albedo[0], albedo[1], albedo[2]], col, glitterOpacity * mask);
            const di = (y * W + x) * 4;
            out[di] = Math.round(rgb[0] * 255);
            out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255);
            out[di + 3] = Math.round(albedo[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
