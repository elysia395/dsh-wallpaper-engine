// WE 渲染引擎 — 效果 WaterCaustics (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧 out 改 scratch 池; 采样改写入式/RG/单通道; 中间向量标量化;
// applyBlending 直写 (所有表达式与原版逐位一致)
import { parseVec3, getVal, applyBlendingInto, smoothstepFn } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
      // watercaustics (官方 effects/watercaustics/caustics.frag):
      //   4 组噪声/图案坐标 (perlin/uniform/voronoi) 按时间卷动 + distortion 扰动
      //   3 通道 chromatic 采样 voronoi_local → caustics; MODE 0: smoothstep 阈值
      //   MODE 1: 阈值+粒子; rgb = ApplyBlending(BLENDMODE, albedo, causticsColor, mask·causticsSample)
      //   uniform: brightness/glow/granularity/speed/time_offset/distortion/chromatic/blur/color1/color2
      //   MODE/BLENDMODE/MASK combo
    effectWaterCaustics(tex, c, t, pass) {
        const combos = (pass && pass.combos) || {};
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 32;
        const mode = combos.MODE != null ? Number(combos.MODE) : 0;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const brightness = getVal(c, 'ui_editor_properties_brightness', 1);
        const glow = getVal(c, 'ui_editor_properties_glow', 0.5);
        const uScale = getVal(c, 'ui_editor_properties_granularity', 2);
        const speed = getVal(c, 'ui_editor_properties_speed', 1);
        const timeOffset = getVal(c, 'ui_editor_properties_time_offset', 0);
        const distortion = getVal(c, 'ui_editor_properties_distortion', 1);
        const chromatic = getVal(c, 'ui_editor_properties_chromatic_aberration', 1);
        const uBlur = getVal(c, 'ui_editor_properties_blur', 0);
        const color1 = parseVec3(getVal(c, 'ui_editor_properties_color_start', '0.7 0.9 1'), [0.7, 0.9, 1]);
        const color2 = parseVec3(getVal(c, 'ui_editor_properties_color_end', '0.4 0.6 1'), [0.4, 0.6, 1]);
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const voronoiLocal = this.loadTexture(pt[2] && pt[2] !== 'null' ? pt[2] : 'pattern/voronoi_local');
        const voronoi = this.loadTexture(pt[5] && pt[5] !== 'null' ? pt[5] : 'pattern/voronoi');
        const uniform256 = this.loadTexture(pt[3] && pt[3] !== 'null' ? pt[3] : 'util/uniform_256');
        const perlin256 = this.loadTexture(pt[4] && pt[4] !== 'null' ? pt[4] : 'util/perlin_256');
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = scratchGet(SCRATCH_U8, src.length);
        const ratio = W / H;
        const time = t * speed + timeOffset;
        // P0-9 / §9.2 裁决: mask UV 缩放 = g_Texture1Resolution.zw/xy = mask 自身
        // header/mip0 比 ≡ 1 → mask UV = 屏幕纯 uv (旧 maskTex.width/W 是被
        // spike 判别实验①明确排除的"对象尺寸"约定 → mask 左上四分之一被
        // 拉伸到全图)
        const mSx = 1, mSy = 1;
        // P0-5: 写入式采样/混合 scratch
        const albedo = [0, 0, 0, 0];
        const rg2 = [0, 0];
        const vs = [0, 0, 0, 0];
        const causticsColor = [0, 0, 0];
        const rgb = [0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            this._texSampleInto(tex, u, v, false, albedo);
            let mask = 1;
            if (maskTex) mask = this._texR(maskTex, u * mSx, v * mSy);
            // causticsCoords = uv·(ratio,1)·granularity
            let cx = u * ratio * uScale, cy = v * uScale;
            const noiseCoordsX = cx * 0.02 + time * 0.005, noiseCoordsY = cy * 0.02;
            const noiseCoords2X = cx * 0.0333, noiseCoords2Y = cy * 0.0333 + time * 0.004111;
            const blendCoordsX = cx * 0.01333 + time * 0.003777, blendCoordsY = cy * 0.01333 + time * 0.003777;
            const shiftCoordsX = cx * 0.05 + time * 0.01, shiftCoordsY = cy * 0.05 + time * 0.01;
            // P0-5: 偏移/噪声采样改 RG 写入式 (各取 R/G)
            this._texRG(perlin256, shiftCoordsX, shiftCoordsY, false, rg2);
            const shiftX = rg2[0] * 2 - 1, shiftY = rg2[1] * 2 - 1;
            this._texRG(uniform256, noiseCoordsX, noiseCoordsY, false, rg2);
            const n1x = rg2[0] * 2 - 1, n1y = rg2[1] * 2 - 1;
            this._texRG(uniform256, noiseCoords2X, noiseCoords2Y, false, rg2);
            const n2x = rg2[0] * 2 - 1, n2y = rg2[1] * 2 - 1;
            cx += (n1x) * 0.025 * distortion + (n2x) * 0.025 * distortion + shiftX * distortion;
            cy += (n1y) * 0.025 * distortion + (n2y) * 0.025 * distortion + shiftY * distortion;
            // chromatic 3 通道采样 — P0-5: 写入式逐通道取 R (依次消费)
            this._texSampleInto(voronoiLocal, cx - 0.01 * chromatic, cy, false, vs);
            const c0 = vs[0];
            this._texSampleInto(voronoiLocal, cx, cy, false, vs);
            const c1 = vs[0];
            this._texSampleInto(voronoiLocal, cx + 0.01 * chromatic, cy, false, vs);
            const c2 = vs[0];
            const glowSample = this._texR(voronoi, cx, cy);
            // P0-5: blendColor 消费 R/G/B 三通道 (mode 0 第三分量用 B) → 写入式全采样
            this._texSampleInto(uniform256, blendCoordsX, blendCoordsY, false, vs);
            const blendColorR = vs[0], blendColorG = vs[1], blendColorB = vs[2];
            // caustics = mix(caustics, vec3(glowSample), u_blur)
            const cb0 = c0 + (glowSample - c0) * uBlur;
            const cb1 = c1 + (glowSample - c1) * uBlur;
            const cb2 = c2 + (glowSample - c2) * uBlur;
            let causticsSample;
            if (mode === 1) {
              const cs = cb1;
              const blendThreshold = Math.max(0.3, blendColorR - shiftX);
              const particleNoise = this._texR(uniform256, shiftCoordsX, shiftCoordsY);
              const particleSample = smoothstepFn(blendThreshold, blendThreshold - 0.001, cs) * (particleNoise * cs >= 0.3 ? 1 : 0);
              causticsSample = smoothstepFn(blendThreshold, blendThreshold + 0.001, cs) + particleSample;
              causticsSample = Math.min(1, Math.max(0, causticsSample + glowSample * glow));
              const cmix = smoothstepFn(0, 0.5, blendColorR);
              causticsColor[0] = brightness * (color1[0] + (color2[0] - color1[0]) * cmix);
              causticsColor[1] = brightness * (color1[1] + (color2[1] - color1[1]) * cmix);
              causticsColor[2] = brightness * (color1[2] + (color2[2] - color1[2]) * cmix);
            } else {
              causticsSample = (cb0 + cb1 + cb2) / 3;
              causticsSample = smoothstepFn(blendColorR * 0.8, 1.0 - blendColorG * 0.2, causticsSample + glowSample * glow);
              causticsColor[0] = brightness * (color1[0] + (color2[0] - color1[0]) * blendColorR) * cb0;
              causticsColor[1] = brightness * (color1[1] + (color2[1] - color1[1]) * blendColorG) * cb1;
              causticsColor[2] = brightness * (color1[2] + (color2[2] - color1[2]) * blendColorB) * cb2;
            }
            applyBlendingInto(blendMode, albedo, causticsColor, mask * causticsSample, rgb);
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, rgb[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, rgb[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, rgb[2])) * 255);
            out[di + 3] = Math.round(albedo[3] * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
