// WE 渲染引擎 — 效果 Clouds (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧 out 改 scratch 池; 采样改写入式/单通道; applyBlending 直写 (数值逐位不变)
import { parseVec3, getVal, applyBlendingInto } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
      // clouds (引擎 shader: effects/clouds.frag/vert, PERSPECTIVE=0): 双云纹理
      // 采样 → 阈值混合
      //   vert: cloudUV.xy = (uv + t·speeds.xy)·scales.xy; zw = (uv + t·speeds.zw)·scales.zw
      //         xz ×= aspect(主纹理宽高比); zw = (−w, z)
      //   frag: cloudBlend = sample(tex1,.xy).r × sample(tex1,.zw).r
      //         smoothstep(threshold, threshold+feather) → blend = ×alpha
      //         SHADING: cloudColor = mix(c2, c1, blend) [或 ×cloud0·cloud1]
      //         rgb = ApplyBlending(BLENDMODE); [WRITEALPHA] a = blend
      //   uniform: alpha/threshold/feather/colorstart/colorend/speed/scale
      //     SHADING(默认 7→非0)/BLENDMODE/MASK/WRITEALPHA combo; tex1 默认 util/clouds_256

    effectClouds(tex, c, t, pass) {
        const alpha = getVal(c, 'alpha', 1);
        const threshold = getVal(c, 'threshold', 0);
        const feather = getVal(c, 'feather', 0.5);
        const color1 = parseVec3(getVal(c, 'colorstart', '1 1 1'), [1, 1, 1]);
        const color2 = parseVec3(getVal(c, 'colorend', '1 1 1'), [1, 1, 1]);
        const parse4 = (v, d) => {
          const s = String(v == null ? d : v).trim().split(/\s+/).map(Number);
          return [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0];
        };
        const speeds = parse4(c.speed, '0.01 0.01 -0.02 -0.02');
        const scales = parse4(c.scale, '1.3 1.3 0.5 0.5');
        const combos = (pass && pass.combos) || {};
        const shading = combos.SHADING != null ? Number(combos.SHADING) : 7;
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 0;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const writeAlpha = combos.WRITEALPHA === '1' || combos.WRITEALPHA === 1;
        const pt = (pass && pass.textures) || [];
        const cloudTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : this.loadTexture('util/clouds_256');
        const maskTex = hasMask && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = scratchGet(SCRATCH_U8, src.length);
        const aspect = W / H;
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        const txy = [speeds[0] * t, speeds[1] * t];
        const tzw = [speeds[2] * t, speeds[3] * t];
        // P0-5: 写入式采样/混合 scratch
        const albedo = [0, 0, 0, 0];
        const cloudColor = [0, 0, 0];
        const rgb = [0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // vert (PERSPECTIVE=0)
            const ax = (u + txy[0]) * scales[0] * aspect;
            const ay = (v + txy[1]) * scales[1];
            const bz = (u + tzw[0]) * scales[2] * aspect;
            const bw = (v + tzw[1]) * scales[3];
            const c1x = -bw, c1y = bz;
            // P0-5: 云采样只取 R → _texR (纹理缺失时保持 [0]=1 契约)
            const cloud0 = cloudTex ? this._texR(cloudTex, ax, ay) : 1;
            const cloud1 = cloudTex ? this._texR(cloudTex, c1x, c1y) : 1;
            let cloudBlend = cloud0 * cloud1;
            cloudBlend = ss(threshold, threshold + feather, cloudBlend);
            let blend = cloudBlend * alpha;
            if (shading === 0) {
              cloudColor[0] = color2[0] + (color1[0] - color2[0]) * blend;
              cloudColor[1] = color2[1] + (color1[1] - color2[1]) * blend;
              cloudColor[2] = color2[2] + (color1[2] - color2[2]) * blend;
            } else {
              const m = cloud0 * cloud1;
              cloudColor[0] = (color2[0] + (color1[0] - color2[0]) * blend) * m;
              cloudColor[1] = (color2[1] + (color1[1] - color2[1]) * blend) * m;
              cloudColor[2] = (color2[2] + (color1[2] - color2[2]) * blend) * m;
            }
            if (maskTex) blend *= this._texR(maskTex, u, v);
            this._texSampleInto(tex, u, v, false, albedo);
            applyBlendingInto(blendMode, albedo, cloudColor, blend, rgb);
            const di = (y * W + x) * 4;
            out[di] = Math.round(rgb[0] * 255);
            out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255);
            out[di + 3] = Math.round((writeAlpha ? blend : albedo[3]) * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
