// WE 渲染引擎 — effects (从 core.js 拆分, 逻辑不变)
import path from 'path';
import { parseVec3, parseVec2, getVal, applyBlending, _greyscale, _sat3, _frac, smoothstepFn } from './math.js';

// ── effects mixin (从 core.js 拆分, 逻辑零改动) ──
export function installEffects(proto) {
  Object.assign(proto, {
    applyEffects(o, tex, t) {
        let img = tex;
        for (const ef of o.effects || []) {
          if (getVal(ef, 'visible', true) === false) continue;
          const file = ef.file || '';
          if (!file) continue;
          const name = path.basename(path.dirname(file)); // effects/waterwaves → waterwaves
          const passes = ef.passes || [];
          const pass = passes[0] || {};
          const c = pass.constantshadervalues || {};
          const combos = pass.combos || {};
          try {
            if (name === 'waterwaves') {
              img = this.effectWaterwaves(img, c, t, pass);
            } else if (name === 'waterflow') {
              img = this.effectWaterflow(img, c, t, pass);
            } else if (name === 'foliagesway') {
              img = this.effectFoliageSway(img, c, t, pass);
            } else if (name === 'skew') {
              img = this.effectSkew(img, c, t, pass);
            } else if (name === 'iris') {
              img = this.effectIris(img, c, t, pass);
            } else if (name === 'lightshafts') {
              img = this.effectLightshafts(img, c, t, pass);
            } else if (name === 'cloudmotion') {
              img = this.effectCloudmotion(img, c, t, pass);
            } else if (name === 'shimmer') {
              img = this.effectShimmer(img, c, t, pass);
            } else if (name === 'blurradial') {
              img = this.effectBlurradial(img, c, t, pass);
            } else if (name === 'clouds') {
              img = this.effectClouds(img, c, t, pass);
            } else if (name === 'swing') {
              img = this.effectSwing(img, c, t, pass);
            } else if (name === 'waterripple') {
              img = this.effectWaterripple(img, c, t, ef, pass);
            } else if (name === 'shake') {
              img = this.effectShake(img, c, t, pass);
            } else if (name === 'scroll') {
              img = this.effectScroll(img, c, t);
            } else if (name === 'tint') {
              img = this.effectTint(img, c, t, combos, pass);
            } else if (name === 'pulse') {
              img = this.effectPulse(img, c, t, combos, pass);
            } else if (name === 'filmgrain') {
              img = this.effectFilmgrain(img, c, t, combos, pass);
            } else if (name === 'godrays') {
              img = this.effectGodrays(img, passes, t);
            } else if (name === 'glitter') {
              img = this.effectGlitter(img, passes, t);
            } else if (name === 'opacity') {
              // 官方 shader (effects/opacity.frag): albedo.a *= mask.r
              // (g_Texture1 = mask, 默认 util/white); mask UV 按纹理比缩放 (简化用 uv)
              img = this.effectOpacity(img, c, t, pass);
            } else if (name === 'frame_builder_by_gariam') {
              // 官方 Gariam Frame Builder 面板效果 (TYPE=0 Round):
              // SDF 圆角矩形 + 4 角缺口 → 深灰面板 (Dock 类壁纸暗色面板的来源)
              img = this.effectFrameBuilder(c, combos);
            } else if (name === 'blur') {
              // 官方 4-pass 高斯模糊链 (downsample4 → gaussian_x → gaussian_y → combine)
              img = this.effectBlur(img, passes, c, t, pass);
            } else if (name === 'depthparallax') {
              // 官方交互式视差 (QUALITY 0/1/2; 静态帧鼠标居中 → 近似恒等)
              img = this.effectDepthParallax(img, c, t, pass);
            } else if (name === 'watercaustics') {
              // 官方水焦散 (4 噪声纹理卷动 + voronoi 图案 + chromatic)
              img = this.effectWaterCaustics(img, c, t, pass);
            } else if (name === 'blend') {
              // 官方 blend (blend 纹理按 BLENDMODE/WRITEALPHA 混合)
              img = this.effectBlend(img, passes, c, t, pass);
            } else if (name === 'blurprecise') {
              // 跳过 (性能)
            } else {
              // 其他 (iris/color_grading/bloom/lightshafts/geometric_transform) 暂不支持
            }
          } catch (e) {
            this.log('效果 ' + name + ' 失败: ' + e.message);
          }
        }
        return img;
      },
    
      // ── Frame Builder (Gariam, App Launcher Dock 面板) — TYPE=0 Round ──
      // 官方 shader (frame_builder_by_gariam.frag/vert) 确定性数学:
      //   vert: v_Transform.x = max(1e-6, u_NotchSize·res.x·0.2)
      //         v_Transform.y = u_Thickness·res.x·0.05; v_Transform.z = u_extrudeEdge·res.x·0.1
      //         v_TexCoord.xy = (uv + u_position − 0.5)·res·scale; v_Size = u_size·res·0.5·scale − ty − 2·softness
      //   frag TYPE=0: sdf = |v| − v_Size − tz; notch = | |v| − v_Size + notchSize | − notchSize
      //          (4 角缺口, 同象限保留); edge = max(notch, max(sdf.x,sdf.y))
      //          edge<0(内部) → inColor; outside → outColor; AA smoothstep
      effectFrameBuilder(c, combos) {
        const refRes = parseVec2(getVal(c, 'Reference resolution', '512 512'), [512, 512]);
        const notchVal = getVal(c, 'Notch size', 0.5);
        const notchSize = (notchVal && typeof notchVal === 'object' && 'value' in notchVal) ? Number(notchVal.value) : Number(notchVal);
        const thickness = Number(getVal(c, 'Thickness', 0.1));
        const extrude = Number(getVal(c, 'Edge extrude', 0));
        const softness = Number(getVal(c, 'Softness', 1));
        const n1 = Number(getVal(c, 'Top left', 0)); // u_Notch1
        const n2 = Number(getVal(c, 'Top right', 0));
        const n3 = Number(getVal(c, 'Bottom right', 0));
        const n4 = Number(getVal(c, 'Bottom left', 0));
        const inColor = parseVec3(getVal(c, 'inColor', '0.3 0.3 0.3'), [0.3, 0.3, 0.3]);
        const outColor = parseVec3(getVal(c, 'outColor', '1 1 1'), [1, 1, 1]);
        const frameColor = parseVec3(getVal(c, 'frameColor', '1 1 1'), [1, 1, 1]);
        const frameAlpha = parseVec2(getVal(c, 'frameAlpha', '0 0'), [0, 0]);
        const inAlpha = parseVec2(getVal(c, 'inAlpha', '1 1'), [1, 1]);
        const outAlpha = parseVec2(getVal(c, 'outAlpha', '0 0'), [0, 0]);
        const opacity = Number(getVal(c, 'opacity', 1));
        const pos = parseVec2(getVal(c, 'position', '0 0'), [0, 0]);
        const uSize = parseVec2(getVal(c, 'size', '1 1'), [1, 1]);
        // v_Transform (vert L48-53)
        const tx = Math.max(1e-6, notchSize * refRes[0] * 0.2);
        const ty = thickness * refRes[0] * 0.05;
        const tz = extrude * refRes[0] * 0.1;
        // 纹理尺寸 = refRes (面板在 ±refRes/2 空间)
        const W = Math.max(16, Math.round(refRes[0]));
        const H = Math.max(16, Math.round(refRes[1]));
        const rgba = new Uint8Array(W * H * 4);
        const smin = -softness, smax = softness;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const uv = [(x + 0.5) / W, (y + 0.5) / H];
            // v_TexCoord.xy = (uv + pos − 0.5)·res (scale=1, rotation=0)
            const vx = (uv[0] + pos[0] - 0.5) * refRes[0];
            const vy = (uv[1] + pos[1] - 0.5) * refRes[1];
            const vsx = uSize[0] * refRes[0] * 0.5 - ty - softness * 2;
            const vsy = uSize[1] * refRes[1] * 0.5 - ty - softness * 2;
            const ax = Math.abs(vx), ay = Math.abs(vy);
            // sdf (frag L116)
            const sdfX = ax - vsx - tz, sdfY = ay - vsy - tz;
            // notchEnabled (frag L111-114): 4 角
            let notchEnabled = 0;
            if (vx < 0 && vy < 0) notchEnabled = n1; // top-left
            else if (vx > 0 && vy < 0) notchEnabled = n2;
            else if (vx > 0 && vy > 0) notchEnabled = n3;
            else if (vx < 0 && vy > 0) notchEnabled = n4;
            const ns = tx * notchEnabled;
            // TYPE=0 (frag L120-122)
            let notch = Math.hypot(ax - vsx + ns - ty, ay - vsy + ns - ty) - ns + ty;
            const qx = vx - (vsx - (ns - ty)) * Math.sign(vx || 1e-9);
            const qy = vy - (vsy - (ns - ty)) * Math.sign(vy || 1e-9);
            const sameQ = Math.sign(vx) === Math.sign(qx) && Math.sign(vy) === Math.sign(qy);
            if (!sameQ) notch = -1e5;
            // edge 合成 (L232)
            let edge = Math.max(notch, Math.max(sdfX, sdfY));
            let outside = 1;
            if (edge >= ty) { edge = ty - edge + softness; outside = 0; }
            if (edge > softness) outside = 0;
            edge = Math.max(0, Math.min(1, (edge - smin) / (smax - smin))); // smoothstep
            edge = edge * edge * (3 - 2 * edge); // smoothstep 平滑
            // 颜色 (L271-278)
            const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
            const outC = lerp3(outColor, frameColor, frameAlpha[0]);
            const inC = lerp3(inColor, frameColor, frameAlpha[0]);
            const outA = outAlpha[1] + (frameAlpha[1] - outAlpha[1]) * edge;
            const inA = inAlpha[1] + (frameAlpha[1] - inAlpha[1]) * edge;
            const outMix = [outC[0], outC[1], outC[2], outA];
            const inMix = [inC[0], inC[1], inC[2], inA];
            let r, g, b, a;
            if (outside) { r = inMix[0]; g = inMix[1]; b = inMix[2]; a = inMix[3]; }
            else { r = outMix[0]; g = outMix[1]; b = outMix[2]; a = outMix[3]; }
            a *= opacity;
            const o = (y * W + x) * 4;
            rgba[o] = Math.round(Math.max(0, Math.min(1, r)) * 255);
            rgba[o + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
            rgba[o + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
            rgba[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
          }
        }
        return { width: W, height: H, rgba };
      }

      // godrays: 5-pass 链 (downsample2 → cast → gaussian_x → gaussian_y → combine)
      // 引擎定义 (effects/godrays/effect.json): fbos 半分辨率 (scale 2)
,
    effectGodrays(tex, passes, t) {
        const W = tex.width, H = tex.height;
        const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
        const p0 = passes[0] || {}, p1 = passes[1] || {}, p2 = passes[2] || {}, p3 = passes[3] || {}, p4 = passes[4] || {};
        const c0 = p0.constantshadervalues || {}, c1 = p1.constantshadervalues || {}, c2 = p2.constantshadervalues || {}, c3 = p3.constantshadervalues || {};
        const k0 = p0.combos || {}, k1 = p1.combos || {}, k2 = p2.combos || {}, k3 = p3.combos || {}, k4 = p4.combos || {};
        const t0tex = (p0.textures || [])[0] ? this.loadTexture(p0.textures[0]) : null; // 通常 null (framebuffer)
        // g_Texture1: mask (默认 util/white), g_Texture2: albedo 噪声 (默认 util/clouds_256)
        const maskTex = (p0.textures || [])[1] ? this.loadTexture(p0.textures[1]) : this.loadTexture('util/white');
        const noiseTex = (p0.textures || [])[2] ? this.loadTexture(p0.textures[2]) : this.loadTexture('util/clouds_256');
        // 官方 godrays_downsample2.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39j)
        const gdSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const gdSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const threshold = getVal(c0, 'raythreshold', 0.5);
        const noiseAmount = getVal(c0, 'noiseamount', 0.4);
        const noiseSmooth = getVal(c0, 'noisesmoothness', 0.2);
        const noiseSpeed = getVal(c0, 'noisespeed', 0.15);
        const noiseScale = getVal(c0, 'noisescale', 3);
        const center = parseVec2(getVal(c1, 'center', '0.5 0.5'), [0.5, 0.5]);
        const rayLength = getVal(c1, 'raylength', 0.5);
        const rayIntensity = getVal(c1, 'rayintensity', 1);
        const rayColor = parseVec3(getVal(c1, 'color', '1 1 1'), [1, 1, 1]);
        const blurScale = parseVec2(getVal(c2, 'blurscale', '1 1'), [1, 1]);
        const combineMode = k4.BLENDMODE != null ? k4.BLENDMODE : 9; // add
        const noSample = (x, y) => {
          const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
          const n1 = this._texSample(noiseTex, (u + t * noiseSpeed) * noiseScale, (v + t * noiseSpeed) * noiseScale, true);
          const n2x = (v * 0.633 - t * 0.5 * noiseSpeed) * noiseScale;
          const n2y = (-u * 0.633 + t * 0.5 * noiseSpeed) * noiseScale;
          const n2 = this._texSample(noiseTex, n2x, n2y, true);
          return n1[0] * n2[0];
        };
        // ── pass 0: downsample2 (半分辨率) ──
        const half = new Uint8Array(hw * hh * 4);
        for (let y = 0; y < hh; y++) {
          for (let x = 0; x < hw; x++) {
            const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
            const s = t0tex ? this._texSample(t0tex, u, v, true) : this._texSample(tex, u, v, true);
            const mask = maskTex ? this._texSample(maskTex, u * gdSx, v * gdSy, true)[0] : 1;
            // noiseSample = mix(sample.a, sample.a * noise, g_NoiseAmount);  (sample.a 在 premultiply 前)
            const rawNoise = noiseTex ? noSample(x, y) : 1;
            const noiseSample = s[3] + (s[3] * rawNoise - s[3]) * noiseAmount;
            // sample.rgb *= sample.a; sample.a = 1.0
            const pr = s[0] * s[3], pg = s[1] * s[3], pb = s[2] * s[3];
            const lum = pr * 0.11 + pg * 0.59 + pb * 0.3;
            const step = lum >= threshold ? 1 : 0;
            // smoothstep(0.5-smoothness, 0.5+smoothness, noiseSample)
            const sm = Math.min(1, Math.max(0, (noiseSample - (0.5 - noiseSmooth)) / (2 * noiseSmooth)));
            const ss = sm * sm * (3 - 2 * sm);
            const di = (y * hw + x) * 4;
            half[di] = Math.round(pr * 255 * mask * step);
            half[di + 1] = Math.round(pg * 255 * mask * step);
            half[di + 2] = Math.round(pb * 255 * mask * step);
            half[di + 3] = Math.round(255 * mask * step * ss);
          }
        }
        const halfTex = { width: hw, height: hh, rgba: half };
        // ── pass 1: cast (径向光线, 30 采样, 半分辨率) ──
        const cast = new Uint8Array(hw * hh * 4);
        const sampleCount = 30, sampleIntensity = 0.1;
        const sampleDrop = sampleCount - 1;
        for (let y = 0; y < hh; y++) {
          for (let x = 0; x < hw; x++) {
            const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
            let dx = center[0] - u, dy = center[1] - v;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1e-6) { dist = 1e-6; }
            dx /= dist; dy /= dist;
            dist = Math.min(dist, dist * rayLength);
            let tx = u + dx * dist, ty = v + dy * dist;
            const sx = dx * dist / sampleDrop, sy = dy * dist / sampleDrop;
            let ar = 0, ag = 0, ab = 0, aa = 0;
            for (let i = 0; i < sampleCount; i++) {
              const s = this._texSample(halfTex, tx, ty, true);
              const wgt = i / sampleDrop;
              ar += s[0] * wgt; ag += s[1] * wgt; ab += s[2] * wgt; aa += s[3] * wgt;
              tx -= sx; ty -= sy;
            }
            const di = (y * hw + x) * 4;
            const rr = rayIntensity * sampleIntensity * ar * rayColor[0];
            const rg = rayIntensity * sampleIntensity * ag * rayColor[1];
            const rb = rayIntensity * sampleIntensity * ab * rayColor[2];
            const ra = rayIntensity * sampleIntensity * aa;
            cast[di] = Math.round(Math.min(1, rr) * 255);
            cast[di + 1] = Math.round(Math.min(1, rg) * 255);
            cast[di + 2] = Math.round(Math.min(1, rb) * 255);
            cast[di + 3] = Math.round(Math.min(1, ra) * 255);
          }
        }
        const castTex = { width: hw, height: hh, rgba: cast };
        // ── pass 2/3: gaussian 7-tap 水平+垂直 (KERNEL=1) ──
        const gauss7 = [0.071303, 0.131514, 0.189879, 0.214607, 0.189879, 0.131514, 0.071303];
        const blurX = this._gaussPass(castTex, blurScale[0] / hw, 0, gauss7);
        const blurY = this._gaussPass(blurX, 0, blurScale[1] / hh, gauss7);
        // ── pass 4: combine (BLENDMODE add) ──
        const out = new Uint8Array(tex.rgba.length);
        const src = tex.rgba;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const di = (y * W + x) * 4;
            const a = [src[di] / 255, src[di + 1] / 255, src[di + 2] / 255];
            const r = this._texSample(blurY, u, v, true);
            // 引擎: albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, rays.rgb, rays.a); albedo.a += rays.a
            const blend = applyBlending(combineMode, a, [r[0], r[1], r[2]], r[3]);
            out[di] = Math.round(blend[0] * 255);
            out[di + 1] = Math.round(blend[1] * 255);
            out[di + 2] = Math.round(blend[2] * 255);
            out[di + 3] = Math.round((src[di + 3] / 255 + r[3]) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
    
      // 单方向高斯模糊 pass (输入/输出同尺寸, offset 为每 tap 的 UV 步长)
,
    _gaussPass(tex, offX, offY, kernel) {
        const w = tex.width, h = tex.height;
        const out = new Uint8Array(tex.rgba.length);
        const half = (kernel.length - 1) / 2;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            let r = 0, g = 0, b = 0, a = 0;
            for (let i = 0; i < kernel.length; i++) {
              const s = this._texSample(tex, u + (i - half) * offX, v + (i - half) * offY, true);
              r += s[0] * kernel[i]; g += s[1] * kernel[i]; b += s[2] * kernel[i]; a += s[3] * kernel[i];
            }
            const di = (y * w + x) * 4;
            out[di] = Math.round(r * 255); out[di + 1] = Math.round(g * 255);
            out[di + 2] = Math.round(b * 255); out[di + 3] = Math.round(a * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // scroll: v_Scroll = sign(s)*s²*t; uv' = frac((uv + v_Scroll) * g_Scale); 采样 g_Texture0
,
    effectScroll(tex, c, t) {
        const rep = parseVec2(getVal(c, 'repeat', '1 1'), [1, 1]);
        const sx = getVal(c, 'speedx', 0.2);
        const sy = getVal(c, 'speedy', 0.2);
        const scrollX = Math.sign(sx) * sx * sx * t;
        const scrollY = Math.sign(sy) * sy * sy * t;
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const nu = _frac((u + scrollX) * rep[0]);
            const nv = _frac((v + scrollY) * rep[1]);
            const s = this._texSample(tex, nu, nv);
            const di = (y * w + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // tint: albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, g_TintColor, g_BlendAlpha)
,
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
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            let a = alpha;
            if (maskTex) a *= this._texSample(maskTex, u * mSx, v * mSy)[0];
            const rgb = applyBlending(mode, [s[0], s[1], s[2]], color, a);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // pulse: 官方 shader 数学 (effects/pulse.frag/vert)
      //   vert (AUDIOPROCESSING=0): v_Pulse = smoothstep(bounds.x, bounds.y,
      //     sin(time×speed + (phase−0.25)×2π)×0.5+0.5) × amount
      //   frag: pulse += sample(noise, time×0.0833, time×0.0278 ×noiseSpeed).r × noiseAmount;
      //         pulse = pow(pulse, power);
      //   PULSECOLOR: albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb×tintLow,
      //     albedo.rgb×tintHigh, pulse)
      //   PULSEALPHA: albedo.a *= pulse; MASK: mix(sample, albedo, mask.r)
      //   旧实现缺时间正弦脉冲 (非音频分支 pulse=1) → 效果不工作。
      ,
    effectPulse(tex, c, t, combos, pass) {
        const mode = combos.BLENDMODE || 9;
        const speed = getVal(c, 'speed', 3);
        const phase = getVal(c, 'phase', 0);
        const amount = getVal(c, 'amount', 1);
        const bounds = parseVec2(getVal(c, 'bounds', '0 1'), [0, 1]);
        const noiseSpeed = getVal(c, 'noisespeed', 0.5);
        const noiseAmount = getVal(c, 'noiseamount', 0);
        const power = getVal(c, 'power', 1);
        const tintLow = parseVec3(getVal(c, 'tintlow', '1 1 1'), [1, 1, 1]);
        const tintHigh = parseVec3(getVal(c, 'tinthigh', '1 1 1'), [1, 1, 1]);
        const pulseAlpha = combos.PULSEALPHA === '1' || combos.PULSEALPHA === 1;
        const pulseColor = combos.PULSECOLOR !== '0' && combos.PULSECOLOR !== 0;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        const noiseTex = this.loadTexture('util/noise');
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        // 音频响应 (引擎 pulse.vert AUDIOPROCESSING): v_Pulse = CreateAudioResponse(...)
        let pulse = 1;
        const audioMode = combos.AUDIOPROCESSING || 0;
        if (audioMode > 0) {
          pulse = this.audioSpectrum ? this._createAudioResponse(this.audioSpectrum, c, audioMode) : 0;
        } else {
          // 官方非音频: smoothstep(bounds, sin(time×speed + (phase − π/2))×0.5+0.5) × amount
          // g_PulsePhase range [0,6.282] 弧度 — 旧实现 (phase−0.25)×2π 把 phase 当
          // 0-1 归一化再乘 2π → phase=3(弧度) 时错算成 17.3 (sf39h)
          const sv = Math.sin(t * speed + (phase - 1.57079632679)) * 0.5 + 0.5;
          const k = Math.max(0, Math.min(1, (sv - bounds[0]) / Math.max(1e-6, bounds[1] - bounds[0])));
          pulse = (k * k * (3 - 2 * k)) * amount;
          // noise 调制
          if (noiseAmount > 0 && noiseTex) {
            const n = this._texSample(noiseTex, t * 0.08333333 * noiseSpeed, t * 0.02777777 * noiseSpeed)[0] * noiseAmount;
            pulse += n;
          }
          pulse = Math.pow(Math.max(0, pulse), power);
        }
        const pulseC = Math.max(0, Math.min(1, pulse));
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            let rgb = [s[0], s[1], s[2]], a = s[3];
            if (pulseColor) {
              // ApplyBlending(BLENDMODE, albedo.rgb×tintLow, albedo.rgb×tintHigh, pulse)
              const A = [s[0] * tintLow[0], s[1] * tintLow[1], s[2] * tintLow[2]];
              const B = [s[0] * tintHigh[0], s[1] * tintHigh[1], s[2] * tintHigh[2]];
              rgb = applyBlending(mode, A, B, pulseC);
            }
            if (pulseAlpha) a = s[3] * pulseC;
            if (maskTex) {
              const mk = this._texSample(maskTex, u, v)[0];
              rgb = [rgb[0] * mk + s[0] * (1 - mk), rgb[1] * mk + s[1] * (1 - mk), rgb[2] * mk + s[2] * (1 - mk)];
              a = a * mk + s[3] * (1 - mk);
            }
            const di = (y * w + x) * 4;
            out[di] = Math.round(Math.max(0, rgb[0]) * 255); out[di + 1] = Math.round(Math.max(0, rgb[1]) * 255);
            out[di + 2] = Math.round(Math.max(0, rgb[2]) * 255); out[di + 3] = Math.round(a * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // 引擎 CreateAudioResponse (pulse.vert): 频谱求和 → smoothstep bounds → pow → multiply
,
    _createAudioResponse(spec, c, mode) {
        const left = (spec.left || new Array(16).fill(0));
        const right = (spec.right || new Array(16).fill(0));
        const freqMin = Math.max(0, Math.min(15, Math.round(getVal(c, 'ui_editor_properties_frequency_min', 0))));
        const freqMax = Math.max(0, Math.min(15, Math.round(getVal(c, 'ui_editor_properties_frequency_max', 1))));
        const bounds = parseVec2(getVal(c, 'ui_editor_properties_audio_bounds', '0.5 1'), [0.5, 1]);
        const power = getVal(c, 'ui_editor_properties_audio_exponent', 1);
        const multiply = getVal(c, 'ui_editor_properties_audio_amount', 1);
        const end = Math.max(freqMin, freqMax);
        let sum = 0;
        for (let a = freqMin; a <= end; a++) {
          if (mode === 1) sum += left[a] || 0;
          else if (mode === 2) sum += right[a] || 0;
          else { sum += (left[a] || 0) + (right[a] || 0); }
        }
        const count = mode === 3 ? (end - freqMin + 1) * 2 : (end - freqMin + 1);
        let resp = count > 0 ? sum / count : 0;
        // smoothstep(bounds.x, bounds.y, resp)
        const tx = Math.max(0, Math.min(1, (resp - bounds[0]) / Math.max(0.0001, bounds[1] - bounds[0])));
        resp = tx * tx * (3 - 2 * tx);
        resp = Math.max(0, Math.min(1, Math.pow(resp, power))) * multiply;
        return resp;
      }
    
      // filmgrain: 双噪声采样 (time-offset 卷动), GREYSCALE→灰度, saturate(n1*n2), pow, ApplyBlending
,
    effectFilmgrain(tex, c, t, combos, pass) {
        const mode = combos.BLENDMODE || 12; // 默认 softlight
        const greyscale = combos.GREYSCALE != null ? combos.GREYSCALE : 1;
        const noiseAlpha = getVal(c, 'ui_editor_properties_strength', 2);
        const noisePower = getVal(c, 'ui_editor_properties_power', 0.5);
        const noiseScale = getVal(c, 'ui_editor_properties_scale', 10);
        const tex1 = pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : this.loadTexture('util/noise');
        const hasMask = combos.MASK === 1;
        const tex2 = hasMask && pass.textures && pass.textures[2] ? this.loadTexture(pass.textures[2]) : null;
        const aspect = tex.width / tex.height;
        const w = tex.width, h = tex.height;
        // 官方 filmgrain.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39i)
        const mSx = tex2 && tex2.width > 0 ? tex2.width / tex.width : 1;
        const mSy = tex2 && tex2.height > 0 ? tex2.height / tex.height : 1;
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

      // opacity (引擎 shader: effects/opacity.frag): albedo.a *= mask × g_UserAlpha
      //   g_Texture0 = 对象自身纹理, g_Texture1 = mask (默认 util/white)
      //   g_UserAlpha = alpha 参数 (默认 1.0) — 旧实现缺 alpha 且 mask UV 未缩放 (sf39j)
      ,
    effectOpacity(tex, c, t, pass) {
        const pt = (pass && pass.textures) || [];
        const maskTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : this.loadTexture('util/white');
        const userAlpha = getVal(c, 'alpha', 1);
        const W = tex.width, H = tex.height;
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
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

      // skew (引擎 shader: effects/skew.frag/vert, MODE=0 UV 模式):
      //   UV 按象限偏移: u −= step(v≤0.5)·top + step(v>0.5)·bottom
      //                   v += step(u≤0.5)·left + step(u>0.5)·right   (step 用原始 UV)
      //   REPEAT combo (默认 1): frac(uv); uniform: top/bottom/left/right (默认 0)
      ,
    effectSkew(tex, c, t, pass) {
        const top = getVal(c, 'top', 0), bottom = getVal(c, 'bottom', 0);
        const left = getVal(c, 'left', 0), right = getVal(c, 'right', 0);
        const combos = (pass && pass.combos) || {};
        const rep = combos.REPEAT === '0' || combos.REPEAT === 0 ? false : true;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u0 = (x + 0.5) / W, v0 = (y + 0.5) / H;
            let u = u0 - (v0 <= 0.5 ? top : bottom);
            let v = v0 + (u0 <= 0.5 ? left : right);
            if (rep) { u = u - Math.floor(u); v = v - Math.floor(v); }
            const s = this._texSample(tex, u, v);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // iris (引擎 shader: effects/iris.frag/vert): 虹膜位移 (眼球呼吸运动)
      //   vert: time=t·speed+phase; lowDt=floor(time)
      //         moveStart = sin(1.9·lowDt) + sin(2.5·lowDt+(1,2)); moveEnd = sin(1.9·(lowDt+1)) + sin(2.5·(lowDt+1)+(1,2))
      //         da = mix(moveStart, moveEnd, smoothstep(1-rough, 1, cos(frac(time)·π)·(−0.5)+0.5))
      //         da += (sin(time), cos(time))·noiseAmount; da ×= scale·0.001
      //   frag: iris = sample(tex0, uv + da·mask)  [MASK: mask=tex1.r, irisMask 用于 BACKGROUND 混色]
      //   uniform: scale/speed/rough/noiseamount/phase/color; MASK/BACKGROUND combo
      ,
    effectIris(tex, c, t, pass) {
        const scale = parseVec2(getVal(c, 'scale', '1 1'), [1, 1]);
        const speed = getVal(c, 'speed', 1);
        const rough = getVal(c, 'rough', 0.2);
        const noiseAmount = getVal(c, 'noiseamount', 0.5);
        const phaseOffset = getVal(c, 'phase', 0);
        const eyeColor = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
        const combos = (pass && pass.combos) || {};
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const hasBg = combos.BACKGROUND === '1' || combos.BACKGROUND === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        // vert 预计算 (虹膜位移量, UV 单位)
        const time = t * speed + phaseOffset;
        const lowDt = Math.floor(time);
        const s2 = (k) => Math.sin(1.9 * (lowDt + k));
        const s4 = (k, ph) => Math.sin(2.5 * (lowDt + k) + ph);
        const moveStart = [s2(0) + s4(0, 1), s2(0) + s4(1, 2)];
        const moveEnd = [s2(1) + s4(1, 1), s2(1) + s4(1, 2)];
        const cx = Math.cos((time - Math.floor(time)) * Math.PI) * -0.5 + 0.5;
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        const f = ss(1 - rough, 1, cx);
        let dx = moveStart[0] + (moveEnd[0] - moveStart[0]) * f;
        let dy = moveStart[1] + (moveEnd[1] - moveStart[1]) * f;
        dx += Math.sin(time) * noiseAmount;
        dy += Math.cos(time) * noiseAmount;
        dx *= scale[0] * 0.001;
        dy *= scale[1] * 0.001;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            let s;
            if (maskTex) {
              const mask = this._texSample(maskTex, u, v)[0];
              const ox = dx * mask, oy = dy * mask;
              s = this._texSample(tex, u + ox, v + oy);
              if (hasBg) {
                const irisMask = this._texSample(maskTex, u + ox, v + oy)[0];
                s = [
                  eyeColor[0] + (s[0] - eyeColor[0]) * irisMask,
                  eyeColor[1] + (s[1] - eyeColor[1]) * irisMask,
                  eyeColor[2] + (s[2] - eyeColor[2]) * irisMask,
                  s[3],
                ];
              }
            } else {
              s = this._texSample(tex, u + dx, v + dy);
            }
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // lightshafts (引擎 shader: effects/lightshafts.frag/vert, RAYMODE=0 线性 +
      // RENDERING=0 颜色, 无 MASK): 透视光柱 (squareToQuad 逆变换 → fx 坐标)
      //   vert: xform = inverse(squareToQuad(p0..p3)); fx = xform × [uv,1]
      //   frag: fx = fx.xy/fx.z; mask = step(0,fx.z) × smoothstep 中心遮罩 × grad
      //         噪声双采样 → pow(exponent) → smoothstep 阈值 → fxColor 渐变
      //         albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, fxColor·intensity, fx)
      //         albedo.a = max(albedo.a, fx)
      //   uniform: rayspeed/rayscale/raysmoothness/rayfeather/colorwintensity/
      //     colorwexponent/colorastart/colorend/point0-3; BLENDMODE combo 默认 31
      ,
    effectLightshafts(tex, c, t, pass) {
        const W = tex.width, H = tex.height;
        // ── vert: squareToQuad → inverse3 (common_perspective.h 官方数学) ──
        const sq2q = (p0, p1, p2, p3) => {
          const dx0 = p0[0], dy0 = p0[1], dx1 = p1[0], dy1 = p1[1];
          const dx2 = p3[0], dy2 = p3[1], dx3 = p2[0], dy3 = p2[1];
          const diffx1 = dx1 - dx3, diffy1 = dy1 - dy3;
          const diffx2 = dx2 - dx3, diffy2 = dy2 - dy3;
          const det = diffx1 * diffy2 - diffx2 * diffy1;
          const sumx = dx0 - dx1 + dx3 - dx2, sumy = dy0 - dy1 + dy3 - dy2;
          if (det === 0 || (sumx === 0 && sumy === 0)) {
            return [
              [dx1 - dx0, dy1 - dy0, 0],
              [dx3 - dx1, dy3 - dy1, 0],
              [dx0, dy0, 1],
            ];
          }
          const ovdet = 1 / det;
          const g = (sumx * diffy2 - diffx2 * sumy) * ovdet;
          const h = (diffx1 * sumy - sumx * diffy1) * ovdet;
          return [
            [dx1 - dx0 + g * dx1, dy1 - dy0 + g * dy1, g],
            [dx2 - dx0 + h * dx2, dy2 - dy0 + h * dy2, h],
            [dx0, dy0, 1],
          ];
        };
        const inv3 = (m) => {
          const a00 = m[0][0], a01 = m[0][1], a02 = m[0][2];
          const a10 = m[1][0], a11 = m[1][1], a12 = m[1][2];
          const a20 = m[2][0], a21 = m[2][1], a22 = m[2][2];
          const b01 = a22 * a11 - a12 * a21;
          const b11 = -a22 * a10 + a12 * a20;
          const b21 = a21 * a10 - a11 * a20;
          const det = a00 * b01 + a01 * b11 + a02 * b21;
          const d = 1 / det;
          return [
            [b01 * d, (-a22 * a01 + a02 * a21) * d, (a12 * a01 - a02 * a11) * d],
            [b11 * d, (a22 * a00 - a02 * a20) * d, (-a12 * a00 + a02 * a10) * d],
            [b21 * d, (-a21 * a00 + a01 * a20) * d, (a11 * a00 - a01 * a10) * d],
          ];
        };
        const p0 = parseVec2(getVal(c, 'point0', '0.67728 0.01297'), [0.67728, 0.01297]);
        const p1 = parseVec2(getVal(c, 'point1', '0.76007 0.14043'), [0.76007, 0.14043]);
        const p2 = parseVec2(getVal(c, 'point2', '0.46654 1.09592'), [0.46654, 1.09592]);
        const p3 = parseVec2(getVal(c, 'point3', '0.16363 0.44881'), [0.16363, 0.44881]);
        const xform = inv3(sq2q(p0, p1, p2, p3));
        // ── uniforms ──
        const speed = getVal(c, 'rayspeed', 0.2);
        const scale = parseVec2(getVal(c, 'rayscale', '0.5 0.1'), [0.5, 0.1]);
        const smoothness = getVal(c, 'raysmoothness', 0.75);
        const feather = parseVec2(getVal(c, 'rayfeather', '0.05 0.2'), [0.05, 0.2]);
        const exponent = getVal(c, 'colorwexponent', 1);
        const intensity = getVal(c, 'colorwintensity', 1);
        const cStart = parseVec3(getVal(c, 'colorastart', '1 1 1'), [1, 1, 1]);
        const cEnd = parseVec3(getVal(c, 'colorend', '0.5 0.8 1'), [0.5, 0.8, 1]);
        const combos = (pass && pass.combos) || {};
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 31;
        const pt = (pass && pass.textures) || [];
        const noiseTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : this.loadTexture('util/noise');
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // fx = xform × [u,v,1] (行向量 mul)
            const f0 = u * xform[0][0] + v * xform[1][0] + xform[2][0];
            const f1 = u * xform[0][1] + v * xform[1][1] + xform[2][1];
            const f2 = u * xform[0][2] + v * xform[1][2] + xform[2][2];
            const fx = f0 / f2, fy = f1 / f2;
            let mask = f2 >= 0 ? 1 : 0; // step(0, fx.z)
            const fxRefY = fy;
            // RAYMODE=0 线性: 中心遮罩 + 渐变
            mask *= ss(0.50001, 0.5 - feather[0], Math.abs(fx - 0.5));
            mask *= ss(0.50001, 0.5 - feather[1], Math.abs(fy - 0.5));
            mask *= 1 - fy;
            // 噪声双采样 (两套频率/速度)
            const n1x = fx * 0.054111 * scale[0] + t * speed * 0.003;
            const n1y = fy * 0.003111 * scale[1] + t * speed * 0.000375111;
            const n2x = fx * 0.07333 * scale[0] - t * speed * 0.0047111;
            const n2y = fy * 0.005967111 * scale[1] - t * speed * 0.0007399;
            let fxv = this._texSample(noiseTex, n1x, n1y)[0] * this._texSample(noiseTex, n2x, n2y)[0];
            fxv = Math.pow(fxv, exponent);
            fxv = ss((1 - smoothness) * 0.29999, 0.3 + smoothness * 0.7, fxv);
            // 透视溢出 (fx/fy 巨大或 NaN) → 采样 NaN → NaN×mask=NaN → 输出黑斑;
            // GPU 侧 NaN 输出为 0/undefined, CPU 需显式归零
            if (!isFinite(fxv)) fxv = 0;
            // RENDERING=0: 颜色渐变 (起点→终点 按 fxRef.y)。
            // fxRef.y 可负 (透视点含负 y 时逆变换溢出) → fc 负色 → applyBlending
            // 输出黑斑 (实测 col=-1 → 结果 ~18)。GPU 输出时颜色自然 clamp, CPU
            // 需显式 clamp 到 [0,1]。
            const fc = [
              Math.max(0, Math.min(1, cStart[0] + (cEnd[0] - cStart[0]) * fxRefY)),
              Math.max(0, Math.min(1, cStart[1] + (cEnd[1] - cStart[1]) * fxRefY)),
              Math.max(0, Math.min(1, cStart[2] + (cEnd[2] - cStart[2]) * fxRefY)),
            ];
            fxv *= mask;
            const a = this._texSample(tex, u, v);
            const srcRgb = [a[0], a[1], a[2]];
            const col = [fc[0] * intensity, fc[1] * intensity, fc[2] * intensity];
            const rgb = applyBlending(blendMode, srcRgb, col, fxv);
            const di = (y * W + x) * 4;
            out[di] = Math.round(rgb[0] * 255);
            out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255);
            out[di + 3] = Math.round(Math.max(a[3], fxv) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // cloudmotion (引擎 shader: effects/cloudmotion.frag/vert): perlin 噪声驱动
      // 云层 UV 位移
      //   vert: noiseCoord.x = uv.x·(w/h)·scale·scaleX + t·speed; noiseCoord.y = uv.y·scale
      //   frag: offset = ((noise.r·2−1)·amount·mask, 0) 旋转 (direction+π/2)
      //         uvs = uv + offset; [MASK] uvs = mix(uv, uvs, dstMask)
      //   uniform: amount/direction/speed/scale/scaleX; textures=[主, mask?, perlin]
      ,
    effectCloudmotion(tex, c, t, pass) {
        const amount = getVal(c, 'amount', 0.1);
        const direction = getVal(c, 'direction', Math.PI / 2);
        const speed = getVal(c, 'speed', 0.02);
        const scale = getVal(c, 'scale', 2);
        const scaleX = getVal(c, 'scaleX', 0.5);
        const combos = (pass && pass.combos) || {};
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const noiseTex = pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : this.loadTexture('util/perlin_256');
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const cosD = Math.cos(direction + Math.PI / 2), sinD = Math.sin(direction + Math.PI / 2);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // vert: noise 采样坐标
            const nx = u * (W / H) * scale * scaleX + t * speed;
            const ny = v * scale;
            const noise = this._texSample(noiseTex, nx, ny);
            let mask = 1;
            if (maskTex) mask = this._texSample(maskTex, u, v)[0];
            const ox = (noise[0] * 2 - 1) * amount * mask;
            const rxo = ox * cosD, ryo = ox * sinD; // rotateVec2((ox,0), dir+π/2)
            let uu = u + rxo, vv = v + ryo;
            if (maskTex) {
              const dstMask = this._texSample(maskTex, u + rxo, v + ryo)[0];
              uu = u + (uu - u) * dstMask;
              vv = v + (vv - v) * dstMask;
            }
            const s = this._texSample(tex, uu, vv);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // shimmer (引擎 shader: effects/shimmer.frag/vert): 扫光渐变 (旋转 UV + 时间扫过)
      //   vert: v_TexCoord = uv.xyxy; v_TexCoord2 = uv (OFFSET 纹理)
      //   frag: shimmerCoord = rotate(uv, −dir+π/2)·scale
      //         MODE=0 线性: x += offset + speed·(t+off); MODE=1 镜像: x += offset + width·sin(speed·t+off)
      //         x = saturate(frac(x/(scale·delay))·scale·delay); 采样 gradient → ApplyBlending → mix
      //   uniform: direction/scale/speed/delay/width/amount/offset/timeoffsetScale/color
      //     MASK/OFFSET/MODE/BLENDMODE combo; gradient 默认 gradient_ferro_fluid
      ,
    effectShimmer(tex, c, t, pass) {
        const direction = getVal(c, 'direction', Math.PI / 2);
        const scale = getVal(c, 'scale', 1);
        const speed = getVal(c, 'speed', 1);
        const delay = getVal(c, 'delay', 2);
        const width = getVal(c, 'width', 1);
        const amount = getVal(c, 'amount', 1);
        const offset = getVal(c, 'offset', 0);
        const timeoffsetScale = getVal(c, 'timeoffsetScale', 0.05);
        const color = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
        const combos = (pass && pass.combos) || {};
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const hasOffset = combos.OFFSET === '1' || combos.OFFSET === 1;
        const mode = combos.MODE === '1' || combos.MODE === 1 ? 1 : 0;
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 32;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const offsetTex = hasOffset && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        const gradTex = pt[3] && pt[3] !== 'null' ? this.loadTexture(pt[3]) : this.loadTexture('gradient/gradient_ferro_fluid');
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const cosD = Math.cos(-direction + Math.PI / 2), sinD = Math.sin(-direction + Math.PI / 2);
        const frac = (x) => x - Math.floor(x);
        const sat = (x) => Math.min(1, Math.max(0, x));
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const albedo = this._texSample(tex, u, v);
            let mask = 1;
            if (maskTex) mask = this._texSample(maskTex, u, v)[0];
            let off = 0;
            if (offsetTex) off = this._texSample(offsetTex, u, v)[0] * timeoffsetScale;
            // rotateVec2(uv, −dir+π/2) · scale
            let sx = (u * cosD - v * sinD) * scale;
            const sy = (u * sinD + v * cosD) * scale;
            if (mode === 1) sx += offset + width * Math.sin(speed * t + off);
            else sx += offset + speed * (t + off);
            sx = sat(frac(sx / (scale * delay)) * scale * delay);
            const shimmerColor = this._texSample(gradTex, frac(sx), frac(sy));
            const eff = [
              shimmerColor[0] * color[0], shimmerColor[1] * color[1], shimmerColor[2] * color[2],
            ];
            const blended = applyBlending(blendMode, [albedo[0], albedo[1], albedo[2]], eff, 1);
            // mix 因子 = mask·shimmerColor·amount (vec3 逐通道)
            const f = mask * amount;
            const rgb = [
              albedo[0] + (blended[0] - albedo[0]) * (shimmerColor[0] * f),
              albedo[1] + (blended[1] - albedo[1]) * (shimmerColor[1] * f),
              albedo[2] + (blended[2] - albedo[2]) * (shimmerColor[2] * f),
            ];
            const di = (y * W + x) * 4;
            out[di] = Math.round(rgb[0] * 255);
            out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255);
            out[di + 3] = Math.round(albedo[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // blurradial (引擎 shader: effects/blur_radial_gaussian.frag + common_blur.h):
      // 径向旋转高斯模糊 (KERNEL 0=13 采样 / 1=7 / 2=3)
      //   delta = uv − center; amt = scale·0.025; r_i = rotate(delta, o_i·amt) − delta
      //   albedo = Σ w_i · sample(center ± r_i + delta)   (核/权重来自 common_blur.h)
      //   [MASK] albedo = mix(prev, albedo, mask.r); [BLURALPHA=0] albedo.a = prev.a
      //   uniform: scale/center; KERNEL/MASK/BLURALPHA combo
      ,
    effectBlurradial(tex, c, t, pass) {
        const scale = getVal(c, 'scale', 1);
        const center = parseVec2(getVal(c, 'center', '0.5 0.5'), [0.5, 0.5]);
        const combos = (pass && pass.combos) || {};
        const kernel = combos.KERNEL != null ? Number(combos.KERNEL) : 0;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const keepAlpha = combos.BLURALPHA === '0' || combos.BLURALPHA === 0 ? true : false;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const amt = scale * 0.025;
        // 核参数 (common_blur.h): [o_i..., w_i...]
        const K0 = {
          o: [1.4091998770852122, 3.2979348079914822, 5.2062900776825969],
          w0: 0.1976406528809576,
          w: [0.2959855056006557, 0.0935333619980593, 0.0116608059608062],
        };
        const K1 = {
          o: [2.3515644035337887, 0.469433779698372, -1.4091998770852121, -3],
          w0: null,
          w: [0.2028175528299753, 0.4044856614512112, 0.3213933537319605, 0.0713034319868530],
        };
        const K2 = {
          o: [1],
          w0: 0.5,
          w: [0.25, 0.25],
        };
        const K = kernel === 1 ? K1 : kernel === 2 ? K2 : K0;
        const rotate = (x, y, r) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const dx = u - center[0], dy = v - center[1];
            let r = [0, 0, 0, 0];
            // 中心项 (K0/K2)
            if (K.w0 != null) {
              const s0 = this._texSample(tex, u, v);
              r = [s0[0] * K.w0, s0[1] * K.w0, s0[2] * K.w0, s0[3] * K.w0];
            }
            for (let i = 0; i < K.o.length; i++) {
              const o = K.o[i] * amt;
              const rot = rotate(dx, dy, o);
              const r1x = rot[0] - dx, r1y = rot[1] - dy;
              const w = K.w[i];
              const sp = this._texSample(tex, center[0] + r1x + dx, center[1] + r1y + dy);
              const sm = this._texSample(tex, center[0] - r1x + dx, center[1] - r1y + dy);
              r[0] += (sp[0] + sm[0]) * w;
              r[1] += (sp[1] + sm[1]) * w;
              r[2] += (sp[2] + sm[2]) * w;
              r[3] += (sp[3] + sm[3]) * w;
            }
            // MASK / BLURALPHA
            const prev = this._texSample(tex, u, v);
            let or = r[0], og = r[1], ob = r[2], oa = r[3];
            if (hasMask) {
              const m = this._texSample(maskTex, u, v)[0];
              or = prev[0] + (r[0] - prev[0]) * m;
              og = prev[1] + (r[1] - prev[1]) * m;
              ob = prev[2] + (r[2] - prev[2]) * m;
              oa = prev[3] + (r[3] - prev[3]) * m;
            }
            if (keepAlpha) oa = prev[3];
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, or) * 255);
            out[di + 1] = Math.round(Math.min(1, og) * 255);
            out[di + 2] = Math.round(Math.min(1, ob) * 255);
            out[di + 3] = Math.round(Math.min(1, oa) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      },

      // blur (官方 4-pass 链: blur_downsample4 → blur_gaussian_x → blur_gaussian_y
      // → blur_combine)。effect.json passes 顺序: [downsample4, gaussian_x,
      // gaussian_y, combine]; gaussian 的 KERNEL/VERTICAL 由 material combos 决定。
      //   downsample4: 目标像素中心 ±1 源texel 4 角采样, rgb=Σ(s·a)/Σa, a=Σ(a²)/4
      //   gaussian: 13/7/3-tap 核 (VERTICAL 决定 x/y 方向), 权重固定, scale vec2
      //   combine: ApplyComposite(原, blurred) × mask; BLURALPHA=0 时 a=原a
      //   uniform (combine pass): compositealpha/offset/color; combos: COMPOSITE/
      //     BLENDMODE/COMPOSITEMONO/MASK/BLURALPHA; scale (gaussian)
    effectBlur(tex, passes, c, t, pass) {
        // ── 从 passes 提取各阶段参数 (官方 effect.json 4 pass) ──
        const pG = (passes && passes[1]) || {}, pC = (passes && passes[3]) || {};
        const cG = pG.constantshadervalues || {}, cC = pC.constantshadervalues || {};
        const kG = pG.combos || {}, kC = pC.combos || {};
        // gaussian: KERNEL 0=13/1=7/2=3-tap; VERTICAL=1 → y 方向; scale 是 vec2
        const kernel = kG.KERNEL != null ? Number(kG.KERNEL) : 0;
        const vertical = kG.VERTICAL === '1' || kG.VERTICAL === 1;
        const scaleV = parseVec2(getVal(cG, 'scale', getVal(c, 'scale', '1 1')), [1, 1]);
        const composite = kC.COMPOSITE != null ? Number(kC.COMPOSITE) : 0;
        const blendMode = kC.BLENDMODE != null ? Number(kC.BLENDMODE) : 0;
        const compMono = kC.COMPOSITEMONO === '1' || kC.COMPOSITEMONO === 1;
        const keepAlpha = kC.BLURALPHA === '0' || kC.BLURALPHA === 0;
        // MASK: combo 显式开启, 或 combine textures[1] 绑定了 mask (引擎按纹理存在自动启用 combo)
        const pCt = (pC && pC.textures) || (pass && pass.textures) || [];
        const hasMask = (kC.MASK === '1' || kC.MASK === 1) || !!(pCt[1] && pCt[1] !== 'null');
        const maskTex = hasMask && pCt[1] && pCt[1] !== 'null' ? this.loadTexture(pCt[1]) : null;
        const compAlpha = getVal(cC, 'compositealpha', getVal(c, 'alpha', 1));
        const compOffset = parseVec2(getVal(cC, 'compositeoffset', getVal(c, 'offset', '0 0')), [0, 0]);
        const compColor = parseVec3(getVal(cC, 'compositecolor', getVal(c, 'color', '1 1 1')), [1, 1, 1]);
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        // ── pass 1: downsample4 (官方 blur_downsample4: 目标像素中心 ± 1 源texel) ──
        const dw = Math.max(2, Math.floor(W / 4)), dh = Math.max(2, Math.floor(H / 4));
        const down = new Uint8Array(dw * dh * 4);
        const ox = 1 / W, oy = 1 / H;
        for (let y = 0; y < dh; y++) {
          for (let x = 0; x < dw; x++) {
            const uc = (x + 0.5) / dw, vc = (y + 0.5) / dh;
            const corners = [[uc - ox, vc - oy], [uc + ox, vc - oy], [uc - ox, vc + oy], [uc + ox, vc + oy]];
            let rs = 0, gs = 0, bs = 0, asq = 0, wa = 0;
            for (let i = 0; i < 4; i++) {
              const s = this._texSample(tex, corners[i][0], corners[i][1], true);
              rs += s[0] * s[3]; gs += s[1] * s[3]; bs += s[2] * s[3];
              asq += s[3] * s[3]; wa += s[3];
            }
            // rgb = Σ(s·a)/max(0.001,Σa); a = Σ(a²)/4 (官方 frag 逐项乘 a)
            const di = (y * dw + x) * 4;
            const wNorm = Math.max(0.001, wa);
            down[di] = Math.round((rs / wNorm) * 255);
            down[di + 1] = Math.round((gs / wNorm) * 255);
            down[di + 2] = Math.round((bs / wNorm) * 255);
            down[di + 3] = Math.round((asq / 4) * 255);
          }
        }
        let img = { width: dw, height: dh, rgba: down };
        // ── pass 2-3: gaussian x/y (官方 blur_gaussian.frag 固定权重核) ──
        const KERNELS = {
          0: { w: [0.006299, 0.017298, 0.039533, 0.075189, 0.119007, 0.156756, 0.171834], off: [6, 5, 4, 3, 2, 1, 0] },
          1: { w: [0.071303, 0.131514, 0.189879, 0.214607], off: [3, 2, 1, 0] },
          2: { w: [0.25, 0.5], off: [1, 0] },
        };
        const K = KERNELS[kernel] || KERNELS[0];
        const gauss = (tex2, vertical2) => {
          const w2 = tex2.width, h2 = tex2.height;
          const out2 = new Uint8Array(w2 * h2 * 4);
          // blur_gaussian.vert: offset = g_Scale.x/y ÷ 纹理分辨率 (z/w)
          const step = vertical2 ? scaleV[1] / h2 : scaleV[0] / w2;
          for (let y = 0; y < h2; y++) {
            for (let x = 0; x < w2; x++) {
              const u = (x + 0.5) / w2, v = (y + 0.5) / h2;
              let r = 0, g = 0, b = 0, a = 0;
              // 对称核: 中心权重 + 两侧 (官方权重已含全部 13/7/3 项, 对称)
              const full = [];
              for (let i = 0; i < K.off.length; i++) full[K.off[i]] = K.w[i];
              // 构建 2n+1 项权重数组 (对称)
              const n = K.off[0];
              const weights = [];
              for (let i = -n; i <= n; i++) {
                const ai = Math.abs(i);
                weights.push(full[ai] != null ? full[ai] : 0);
              }
              for (let i = -n; i <= n; i++) {
                const s = this._texSample(tex2, vertical2 ? u : u + i * step, vertical2 ? v + i * step : v, true);
                const wgt = weights[i + n];
                r += s[0] * wgt; g += s[1] * wgt; b += s[2] * wgt; a += s[3] * wgt;
              }
              const di = (y * w2 + x) * 4;
              out2[di] = Math.round(Math.min(1, r) * 255);
              out2[di + 1] = Math.round(Math.min(1, g) * 255);
              out2[di + 2] = Math.round(Math.min(1, b) * 255);
              out2[di + 3] = Math.round(Math.min(1, a) * 255);
            }
          }
          return { width: w2, height: h2, rgba: out2 };
        };
        img = gauss(img, vertical);
        img = gauss(img, !vertical);
        // ── pass 4: combine (blurred 与 原图 按 COMPOSITE 混合) ──
        const out = new Uint8Array(src.length);
        const bw = img.width, bh = img.height;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // ApplyCompositeOffset: 像素offset ÷ g_Texture0Resolution.xy (= blurred 纹理分辨率)
            const bu = composite !== 0 ? u + compOffset[0] / bw : u;
            const bv = composite !== 0 ? v + compOffset[1] / bh : v;
            const bl = this._texSample(img, bu, bv, true);
            const old = this._texSample(tex, u, v);
            let mask = 1;
            if (maskTex) {
              // blur_combine.vert: v_TexCoord.zw = uv · maskRes/对象Res
              const mSx = maskTex.width / W, mSy = maskTex.height / H;
              mask = this._texSample(maskTex, u * mSx, v * mSy)[0];
            }
            // div = mix(blurred.a, 1, step(blurred.a, 0)) — a>0 时用 a 反预乘, 否则 1
            const div = bl[3] > 0 ? bl[3] : 1;
            let eff = [bl[0] / div, bl[1] / div, bl[2] / div, bl[3]];
            if (compMono) {
              const gv2 = _greyscale(eff);
              eff = [gv2, gv2, gv2, eff[3]];
            }
            eff = [eff[0] * compColor[0], eff[1] * compColor[1], eff[2] * compColor[2], eff[3]];
            // ApplyComposite(original, effect)
            let res;
            if (composite === 0) {
              res = eff; // 仅返回效果
            } else if (composite === 1) {
              const eb = applyBlending(blendMode, [old[0], old[1], old[2]], [eff[0], eff[1], eff[2]], eff[3] * compAlpha);
              res = [eb[0], eb[1], eb[2], Math.max(eff[3] * Math.min(1, compAlpha), old[3])];
            } else if (composite === 2) {
              const ea = eff[3] * Math.min(1, compAlpha);
              res = [
                eff[0] + (old[0] - eff[0]) * old[3],
                eff[1] + (old[1] - eff[1]) * old[3],
                eff[2] + (old[2] - eff[2]) * old[3],
                ea + old[3] * (1 - ea),
              ];
            } else {
              const ea = eff[3] * Math.min(1, compAlpha) * (1 - old[3]);
              res = [eff[0], eff[1], eff[2], ea];
            }
            // mix(original, composite, mask)
            res = [
              old[0] + (res[0] - old[0]) * mask,
              old[1] + (res[1] - old[1]) * mask,
              old[2] + (res[2] - old[2]) * mask,
              old[3] + (res[3] - old[3]) * mask,
            ];
            if (keepAlpha) res[3] = old[3];
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, res[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, res[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, res[2])) * 255);
            out[di + 3] = Math.round(Math.min(1, Math.max(0, res[3])) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      },

      // depthparallax (官方 effects/depthparallax, 单 pass 交互式视差):
      //   vert: v_TexCoord.zw = depthUV (uv·depthRes/objRes); v_TexCoordMask = maskUV;
      //         v_ParallaxOffset = (projectedDirX·prlx.x + projectedDirY·prlx.y)·0.5+0.5
      //         (g_EffectTextureProjectionMatrixInverse 对 2D 近似单位 → = g_ParallaxPosition)
      //   frag QUALITY 0: pointer=(zw,1−w)−prlx · vec2(2,−2)·scale·−0.04; offset=(depth·2−1)·pointer·mask
      //        QUALITY 1/2: ctrlSign/ctrlPerspOrtho 透视修正 + 24/64 层 ParallaxMapping (ray march)
      //   uniform: scale/sens/center; QUALITY/MASK combo; depth=textures[1]
    effectDepthParallax(tex, c, t, pass) {
        const combos = (pass && pass.combos) || {};
        const quality = combos.QUALITY != null ? Number(combos.QUALITY) : 1;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const scale = parseVec2(getVal(c, 'scale', '1 1'), [1, 1]);
        const sens = getVal(c, 'sens', 1);
        const center = getVal(c, 'center', 0.3);
        const pt = (pass && pass.textures) || [];
        const depthTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const maskTex = hasMask && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        // 指针位置 (静态帧默认屏幕中心; 交互场景由引擎注入 g_ParallaxPosition)
        const prlxPos = parseVec2(getVal(c, 'parallaxposition', '0.5 0.5'), [0.5, 0.5]);
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const dSx = depthTex ? depthTex.width / W : 1, dSy = depthTex ? depthTex.height / H : 1;
        const mSx = maskTex ? maskTex.width / W : 1, mSy = maskTex ? maskTex.height / H : 1;
        const ctrlSign = sens >= 0 ? 1 : 0;
        const negPerspective = -sens;
        const ctrlPerspOrtho = Math.min(1, Math.max(0, sens)) + (negPerspective > 0.0001 ? 1 : 0);
        const prlx = ctrlSign ? [1 - prlxPos[0], 1 - prlxPos[1]] : [prlxPos[0], prlxPos[1]];
        const perspMix = -1 + (negPerspective + 1) * ctrlPerspOrtho; // mix(-1, negPerspective, ctrlPerspOrtho)
        const numLayers = quality === 2 ? 64 : 24;
        const layerDepth = 1 / numLayers;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const dz = u * dSx, dw = v * dSy;
            const depth = depthTex ? this._texSample(depthTex, dz, dw)[0] : 0;
            let mask = 1;
            if (maskTex) mask = this._texSample(maskTex, u * mSx, v * mSy)[0];
            let sampleU, sampleV;
            if (quality === 0) {
              // vec2(v_TexCoord.z, 1−v_TexCoord.w) 为指针输入 (y 翻转)
              let pointer = [dz - prlxPos[0], (1 - dw) - prlxPos[1]];
              pointer = [pointer[0] * 2 * scale[0] * -0.04, pointer[1] * -2 * scale[1] * -0.04];
              const offsetX = (depth * 2 - 1) * pointer[0] * mask;
              const offsetY = (depth * 2 - 1) * pointer[1] * mask;
              sampleU = u + offsetX; sampleV = v + offsetY;
            } else {
              // coords: sens≥0 时透视压缩, sens<0 时原样
              let coords = ctrlSign
                ? [(u - 0.5) / (1 + sens * 0.2) + 0.5, (v - 0.5) / (1 + sens * 0.2) + 0.5]
                : [u, v];
              coords[0] -= (prlx[0] * 2 - 1) * center * (-0.05) * scale[0] * perspMix;
              coords[1] -= (prlx[1] * 2 - 1) * center * (0.05) * scale[1] * perspMix;
              const pointer = [1 - dz, dw]; // vec2(1−v_TexCoord.z, v_TexCoord.w)
              let ctrlDir = [pointer[0] - prlx[0], pointer[1] - prlx[1]];
              // mix(vec2(1−prlx.x, prlx.y)−0.5, ctrlDir·vec2(−neg, neg), ctrlPerspOrtho)
              const altX = 1 - prlx[0] - 0.5, altY = prlx[1] - 0.5;
              const dirX = altX + (ctrlDir[0] * (-negPerspective) - altX) * ctrlPerspOrtho;
              const dirY = altY + (ctrlDir[1] * negPerspective - altY) * ctrlPerspOrtho;
              const fakeViewdir = [dirX * mask, dirY * mask];
              // ParallaxMapping (ray march 分层)
              const P = [fakeViewdir[0] * scale[0] * 0.1, fakeViewdir[1] * scale[1] * 0.1];
              const delta = [P[0] / numLayers, P[1] / numLayers];
              let cur = [coords[0], coords[1]];
              let curDepth = depthTex ? this._texSample(depthTex, cur[0] * dSx, cur[1] * dSy)[0] : 0;
              let currentLayerDepth = 1;
              let i = 0;
              while (currentLayerDepth > curDepth && i < numLayers) {
                cur = [cur[0] - delta[0], cur[1] - delta[1]];
                curDepth = depthTex ? this._texSample(depthTex, cur[0] * dSx, cur[1] * dSy)[0] : 0;
                currentLayerDepth -= layerDepth;
                i++;
              }
              const prev = [cur[0] + delta[0], cur[1] + delta[1]];
              const afterDepth = curDepth - currentLayerDepth;
              const beforeDepth = (depthTex ? this._texSample(depthTex, prev[0] * dSx, prev[1] * dSy)[0] : 0) - currentLayerDepth - layerDepth;
              const weight = afterDepth / (afterDepth - beforeDepth);
              sampleU = prev[0] * weight + cur[0] * (1 - weight);
              sampleV = prev[1] * weight + cur[1] * (1 - weight);
            }
            const s = this._texSample(tex, sampleU, sampleV);
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, s[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, s[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, s[2])) * 255);
            out[di + 3] = Math.round(Math.min(1, Math.max(0, s[3])) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      },

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
        const out = new Uint8Array(src.length);
        const ratio = W / H;
        const time = t * speed + timeOffset;
        const mSx = maskTex ? maskTex.width / W : 1, mSy = maskTex ? maskTex.height / H : 1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const albedo = this._texSample(tex, u, v);
            let mask = 1;
            if (maskTex) mask = this._texSample(maskTex, u * mSx, v * mSy)[0];
            // causticsCoords = uv·(ratio,1)·granularity
            let cx = u * ratio * uScale, cy = v * uScale;
            const noiseCoords = [cx * 0.02 + time * 0.005, cy * 0.02];
            const noiseCoords2 = [cx * 0.0333, cy * 0.0333 + time * 0.004111];
            const blendCoords = [cx * 0.01333 + time * 0.003777, cy * 0.01333 + time * 0.003777];
            const shiftCoords = [cx * 0.05 + time * 0.01, cy * 0.05 + time * 0.01];
            const shiftC = this._texSample(perlin256, shiftCoords[0], shiftCoords[1]);
            const shift = [shiftC[0] * 2 - 1, shiftC[1] * 2 - 1];
            const n1 = this._texSample(uniform256, noiseCoords[0], noiseCoords[1]);
            const n2 = this._texSample(uniform256, noiseCoords2[0], noiseCoords2[1]);
            cx += (n1[0] * 2 - 1) * 0.025 * distortion + (n2[0] * 2 - 1) * 0.025 * distortion + shift[0] * distortion;
            cy += (n1[1] * 2 - 1) * 0.025 * distortion + (n2[1] * 2 - 1) * 0.025 * distortion + shift[1] * distortion;
            // chromatic 3 通道采样
            const caustics = [
              this._texSample(voronoiLocal, cx - 0.01 * chromatic, cy)[0],
              this._texSample(voronoiLocal, cx, cy)[0],
              this._texSample(voronoiLocal, cx + 0.01 * chromatic, cy)[0],
            ];
            const glowSample = this._texSample(voronoi, cx, cy)[0];
            const blendColor = this._texSample(uniform256, blendCoords[0], blendCoords[1]);
            // caustics = mix(caustics, vec3(glowSample), u_blur)
            const cb = [
              caustics[0] + (glowSample - caustics[0]) * uBlur,
              caustics[1] + (glowSample - caustics[1]) * uBlur,
              caustics[2] + (glowSample - caustics[2]) * uBlur,
            ];
            let causticsSample, causticsColor;
            if (mode === 1) {
              const cs = cb[1];
              const blendThreshold = Math.max(0.3, blendColor[0] - shift[0]);
              const particleNoise = this._texSample(uniform256, shiftCoords[0], shiftCoords[1])[0];
              const particleSample = smoothstepFn(blendThreshold, blendThreshold - 0.001, cs) * (particleNoise * cs >= 0.3 ? 1 : 0);
              causticsSample = smoothstepFn(blendThreshold, blendThreshold + 0.001, cs) + particleSample;
              causticsSample = Math.min(1, Math.max(0, causticsSample + glowSample * glow));
              const cmix = smoothstepFn(0, 0.5, blendColor[0]);
              causticsColor = [
                brightness * (color1[0] + (color2[0] - color1[0]) * cmix),
                brightness * (color1[1] + (color2[1] - color1[1]) * cmix),
                brightness * (color1[2] + (color2[2] - color1[2]) * cmix),
              ];
            } else {
              causticsSample = (cb[0] + cb[1] + cb[2]) / 3;
              causticsSample = smoothstepFn(blendColor[0] * 0.8, 1.0 - blendColor[1] * 0.2, causticsSample + glowSample * glow);
              causticsColor = [
                brightness * (color1[0] + (color2[0] - color1[0]) * blendColor[0]) * cb[0],
                brightness * (color1[1] + (color2[1] - color1[1]) * blendColor[1]) * cb[1],
                brightness * (color1[2] + (color2[2] - color1[2]) * blendColor[2]) * cb[2],
              ];
            }
            const rgb = applyBlending(blendMode, [albedo[0], albedo[1], albedo[2]], causticsColor, mask * causticsSample);
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, rgb[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, rgb[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, rgb[2])) * 255);
            out[di + 3] = Math.round(albedo[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      },

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
        const transformRepeat = combos.TRANSFORMREPEAT === '1' || combos.TRANSFORMREPEAT === 1;
        const multiply = getVal(c1, 'multiply', getVal(c, 'multiply', 1));
        const pt = p.textures || [];
        const blendTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const opMaskTex = opMask && pt[7] && pt[7] !== 'null' ? this.loadTexture(pt[7]) : null;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const bSx = blendTex ? blendTex.width / W : 1, bSy = blendTex ? blendTex.height / H : 1;
        const oSx = opMaskTex ? opMaskTex.width / W : 1, oSy = opMaskTex ? opMaskTex.height / H : 1;
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
            if (transformUV && transformRepeat === 1) blendUV = [frac2(blendUV[0]), frac2(blendUV[1])];
            const bc = blendTex ? this._texSample(blendTex, blendUV[0], blendUV[1]) : [1, 1, 1, 1];
            let blend = 1;
            if (opMaskTex) blend *= this._texSample(opMaskTex, u * oSx, v * oSy)[0];
            // GetUVBlend: TRANSFORMUV+clip 时越界 UV 禁止混合
            if (transformUV && transformRepeat === 0) {
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
      },

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
        // 官方 glitter_combine.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39j)
        const gsSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const gsSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const noiseTex = this.loadTexture('util/perlin_256');
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
            if (maskTex) mask = this._texSample(maskTex, u * gsSx, v * gsSy)[0];
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
      ,
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
        const out = new Uint8Array(src.length);
        const aspect = W / H;
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        const txy = [speeds[0] * t, speeds[1] * t];
        const tzw = [speeds[2] * t, speeds[3] * t];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // vert (PERSPECTIVE=0)
            const ax = (u + txy[0]) * scales[0] * aspect;
            const ay = (v + txy[1]) * scales[1];
            const bz = (u + tzw[0]) * scales[2] * aspect;
            const bw = (v + tzw[1]) * scales[3];
            const c1x = -bw, c1y = bz;
            const cloud0 = this._texSample(cloudTex, ax, ay)[0];
            const cloud1 = this._texSample(cloudTex, c1x, c1y)[0];
            let cloudBlend = cloud0 * cloud1;
            cloudBlend = ss(threshold, threshold + feather, cloudBlend);
            let blend = cloudBlend * alpha;
            let cloudColor;
            if (shading === 0) {
              cloudColor = [
                color2[0] + (color1[0] - color2[0]) * blend,
                color2[1] + (color1[1] - color2[1]) * blend,
                color2[2] + (color1[2] - color2[2]) * blend,
              ];
            } else {
              const m = cloud0 * cloud1;
              cloudColor = [
                (color2[0] + (color1[0] - color2[0]) * blend) * m,
                (color2[1] + (color1[1] - color2[1]) * blend) * m,
                (color2[2] + (color1[2] - color2[2]) * blend) * m,
              ];
            }
            if (maskTex) blend *= this._texSample(maskTex, u, v)[0];
            const albedo = this._texSample(tex, u, v);
            const rgb = applyBlending(blendMode, [albedo[0], albedo[1], albedo[2]], cloudColor, blend);
            const di = (y * W + x) * 4;
            out[di] = Math.round(rgb[0] * 255);
            out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255);
            out[di + 3] = Math.round((writeAlpha ? blend : albedo[3]) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // swing (引擎 shader: effects/swing.frag/vert): 翻页旋转 (p0-p1 轴 + UV 扭曲)
      //   vert: aspect=w/h; anim = sin(t·speed + phase·2π)·amount
      //   frag: 轴/中心 (aspect 修正); uvDelta → 沿轴/正交距离
      //         uvDistort = axis·anim·dOrtho·dAlong + axisOrtho·anim²·dOrtho
      //         mask = 翻页区域 (p0-p1 夹逼 + sizeMod 边缘 feather) [DOUBLESIDED 双面]
      //         out = mix(uv, uv+distort, mask) 采样
      //   uniform: point0/point1/size/center/feather/amount/speed/phase/
      //     noisespeed/noiseamount; DOUBLESIDED/MASK/NOISE combo
      ,
    effectSwing(tex, c, t, pass) {
        const point0 = parseVec2(getVal(c, 'point0', '0.25 0.5'), [0.25, 0.5]);
        const point1 = parseVec2(getVal(c, 'point1', '0.75 0.5'), [0.75, 0.5]);
        const size = getVal(c, 'size', 0.4);
        const centerPos = getVal(c, 'center', 0.5);
        const feather = getVal(c, 'feather', 0.01);
        const amount = getVal(c, 'amount', 0.2);
        const speed = getVal(c, 'speed', 2.0);
        const phase = getVal(c, 'phase', 0);
        const noiseSpeed = getVal(c, 'noisespeed', 0.15);
        const noiseAmount = getVal(c, 'noiseamount', 0.2);
        const combos = (pass && pass.combos) || {};
        const doubleSided = combos.DOUBLESIDED === '1' || combos.DOUBLESIDED === 1;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const hasNoise = combos.NOISE === '1' || combos.NOISE === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const noiseTex = hasNoise && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : this.loadTexture('util/noise');
        const W = tex.width, H = tex.height;
        // 官方 swing.vert: v_TexCoordMask mask UV 缩放 (maskRes/对象Res) (sf39i)
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const aspect = W / H;
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        // vert 预计算
        let anim = Math.sin(t * speed + phase * 6.28318530718) * amount;
        if (hasNoise) {
          const n = this._texSample(noiseTex, t * 0.08333333 * noiseSpeed, t * 0.02777777 * noiseSpeed)[0] * 6.28318530718;
          anim = Math.min(1, Math.max(-1, anim + Math.sin(n) * noiseAmount));
        }
        // 轴 (aspect 修正)
        const ax0 = point0[0] * aspect, ay0 = point0[1];
        const ax1 = point1[0] * aspect, ay1 = point1[1];
        let adx = ax1 - ax0, ady = ay1 - ay0;
        const alen = Math.hypot(adx, ady) || 1;
        adx /= alen; ady /= alen;
        const cx = ax0 + (ax1 - ax0) * centerPos, cy = ay0 + (ay1 - ay0) * centerPos;
        const ox = -ady, oy = adx;
        const feather2 = Math.max(feather, 0.00001);
        const sizeMod = size * (1 - Math.abs(anim) * amount * 0.5);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const tx = u * aspect, ty = v;
            const dx0 = tx - cx, dy0 = ty - cy;
            const dAlong = adx * dx0 + ady * dy0;
            const dOrtho = ox * dx0 + oy * dy0;
            const dd = anim * dOrtho;
            const tx2 = tx + adx * dd * dAlong + ox * anim * dOrtho * anim;
            const ty2 = ty + ady * dd * dAlong + oy * anim * dOrtho * anim;
            // mask
            let mask = 1;
            const dRx = tx2 - ax1, dRy = ty2 - ay1;
            const dLx = tx2 - ax0, dLy = ty2 - ay0;
            mask *= ss(feather2, 0, adx * dRx + ady * dRy);
            mask *= ss(-feather2, 0, adx * dLx + ady * dLy);
            mask *= ss(sizeMod + feather2, sizeMod - feather2, dOrtho);
            if (doubleSided) mask *= ss(sizeMod + feather2, sizeMod - feather2, -dOrtho);
            else mask *= dOrtho >= 0 ? 1 : 0;
            if (maskTex) mask *= this._texSample(maskTex, u * mSx, v * mSy)[0];
            const uu = u + (tx2 / aspect - u) * mask;
            const vv = v + (ty2 - v) * mask;
            const s = this._texSample(tex, uu, vv);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // waterflow (引擎 shader: effects/waterflow.frag/vert): flow map 位移 +
      // 双周期循环混合 (flowmask RG → 位移方向, 两相 0/0.5 与 0.25/0.75 混合)
      //   vert: cycles = (frac(t·s), frac(t·s+0.5), frac(0.25+t·s), frac(0.25+t·s+0.5))
      //         blend = smoothstep(0.5−f, 0.5+f, 2·|cycle−0.5|); cycles −= 0.5
      //   frag: flowMask = (flowColor.rg − 0.498)·2; amount = length(flowMask)
      //         off = flowMask·amp·0.1·cycle; fa = mix(样2, blend); fa2 = mix(样2, blend2)
      //         fa = mix(fa, fa2, smoothstep(0.2,0.8, phase)); out = mix(原, fa, amount)
      //   uniform: speed/feather/strength/phasescale; textures=[主, flowmap(util/noflow), timeoffset]
      //   flow map UV (v_TexCoord.zw 按 tex1 分辨率缩放): flow map 通常与主纹理
      //   同尺寸 → 简化用对象 uv
      ,
    effectWaterflow(tex, c, t, pass) {
        const W = tex.width, H = tex.height;
        const speed = getVal(c, 'speed', 1);
        const feather = getVal(c, 'feather', 0.4);
        const amp = getVal(c, 'strength', 1);
        const phaseScale = getVal(c, 'phasescale', 2);
        const pt = (pass && pass.textures) || [];
        const flowTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : this.loadTexture('util/noflow');
        const phaseTex = pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const frac = (x) => x - Math.floor(x);
        const smoothstep = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        // vert 预计算
        const st = t * speed;
        const cy = [frac(st), frac(st + 0.5), frac(0.25 + st), frac(0.25 + st + 0.5)];
        const lo = 0.5 - feather, hi = 0.5 + feather;
        const blend = smoothstep(lo, hi, 2 * Math.abs(cy[0] - 0.5));
        const blend2 = smoothstep(lo, hi, 2 * Math.abs(cy[2] - 0.5));
        const cycles = cy.map((x) => x - 0.5);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // frag
            const flowPhase = phaseTex ? this._texSample(phaseTex, u * phaseScale, v * phaseScale)[0] : 0;
            const fc = this._texSample(flowTex, u, v);
            const fx = (fc[0] - 0.498) * 2, fy = (fc[1] - 0.498) * 2;
            const flowAmount = Math.sqrt(fx * fx + fy * fy);
            const k = amp * 0.1;
            const o1x = fx * k * cycles[0], o1y = fy * k * cycles[0];
            const o2x = fx * k * cycles[1], o2y = fy * k * cycles[1];
            const o3x = fx * k * cycles[2], o3y = fy * k * cycles[2];
            const o4x = fx * k * cycles[3], o4y = fy * k * cycles[3];
            const s0 = this._texSample(tex, u, v);
            const s1 = this._texSample(tex, u + o1x, v + o1y);
            const s2 = this._texSample(tex, u + o2x, v + o2y);
            const s3 = this._texSample(tex, u + o3x, v + o3y);
            const s4 = this._texSample(tex, u + o4x, v + o4y);
            const mix2 = (a, b, f) => [
              a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f,
              a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f,
            ];
            let fa = mix2(s1, s2, blend);
            const fa2 = mix2(s3, s4, blend2);
            fa = mix2(fa, fa2, smoothstep(0.2, 0.8, flowPhase));
            const o = mix2(s0, fa, Math.min(1, flowAmount));
            const di = (y * W + x) * 4;
            out[di] = Math.round(o[0] * 255); out[di + 1] = Math.round(o[1] * 255);
            out[di + 2] = Math.round(o[2] * 255); out[di + 3] = Math.round(o[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // foliagesway (引擎 shader: effects/foliagesway.frag/vert, MODE=0 UV 模式):
      //   vert: aspect=(h/w)×ratio; rotDir=rotate([1/aspect, aspect], dir)
      //         noiseUV=uv×noiseScale; params=rotate(uv,dir); amp=strength²×0.005
      //   frag: noise=sample(noise, noiseUV).rgb (用 g 通道)
      //         phase=(noise.g×2π + params.x×10 + params.y×5)×g_Phase
      //         sines = sin(phase + speed×t×(1, -0.16161616, 0.0083333, -0.00019841))
      //         csines= sin(0.4 + phase + speed×t×(-0.5, 0.041666666, -0.0013888889, 0.000024801587))
      //         sines/csines = pow(|s|, power)×sign(s)
      //         offset = rotDir × amp × (Σsines, Σcsines); out = sample(tex, uv + offset)
      //   uniform 名 (真实场景 constantshadervalues): speeduv/power/phase/strength/
      //     scrolldirection/scale(noiseScale)/ratio; textures=[null, mask, noise?]
      //   mask 启用: 场景提供 textures[1] 即按 MASK 语义乘 mask.r (combos 通常不显式设)
      ,
    effectFoliageSway(tex, c, t, pass) {
        const W = tex.width, H = tex.height;
        const speed = getVal(c, 'speeduv', getVal(c, 'speed', 5));
        const power = getVal(c, 'power', 1);
        const phase = getVal(c, 'phase', 0.5);
        const strength = getVal(c, 'strength', 0.4);
        const direction = getVal(c, 'scrolldirection', getVal(c, 'direction', 0));
        const ratio = getVal(c, 'ratio', 0.3);
        const noiseScale = getVal(c, 'scale', 0.05);
        const pt = (pass && pass.textures) || [];
        const hasMask = !!pt[1] && pt[1] !== 'null';
        const maskTex = hasMask ? this.loadTexture(pt[1]) : null;
        // 官方 foliagesway.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39i)
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const noiseTex = pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : this.loadTexture('util/noise');
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const cosD = Math.cos(direction), sinD = Math.sin(direction);
        const rotate = (x, y) => [x * cosD - y * sinD, x * sinD + y * cosD];
        // aspect = g_Texture0Resolution.z/w × ratio = (texW/texH) × ratio
        // (官方 foliagesway.vert: aspect = texW/texH×ratio; 本地曾用 H/W → 反了,
        //  rotDir 的 x/y 轴互换 → 摆动方向与官方垂直)
        const aspect = (W / H) * ratio;
        const rotDir = rotate(1 / aspect, aspect);
        const ampBase = strength * strength * 0.005;
        const TWO_PI = Math.PI * 2;
        const sW = [1, -0.16161616, 0.0083333, -0.00019841];
        const cW = [-0.5, 0.041666666, -0.0013888889, 0.000024801587];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const noise = this._texSample(noiseTex, u * noiseScale, v * noiseScale);
            const pr = rotate(u, v);
            let amp = ampBase;
            if (maskTex) amp *= this._texSample(maskTex, u * mSx, v * mSy)[0];
            const phaseV = (noise[1] * TWO_PI + pr[0] * 10 + pr[1] * 5) * phase;
            let so = 0, co = 0;
            for (let i = 0; i < 4; i++) {
              const sv = Math.sin(phaseV + speed * t * sW[i]);
              const cv = Math.sin(0.4 + phaseV + speed * t * cW[i]);
              so += Math.pow(Math.abs(sv), power) * Math.sign(sv);
              co += Math.pow(Math.abs(cv), power) * Math.sign(cv);
            }
            const s = this._texSample(tex, u + rotDir[0] * so * amp, v + rotDir[1] * co * amp);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }

      // waterwaves: 双波 sin 位移 (shader 精确数学)
      // v_Direction = rotateVec2((0,1), direction) = (-sin(dir), cos(dir))
      // (官方 common.h rotateVec2 逆时针旋转; 本地曾用 (sin,cos) → x 分量反号
      //  → 波浪沿镜像方向传播, 与官方相反 = "诡异波浪"主因)
      ,
    effectWaterwaves(tex, c, t, pass) {
        const dir1 = c.direction != null ? c.direction : 0;
        const scale1 = c.scale != null ? c.scale : 200;
        const speed1 = c.speed != null ? c.speed : 5;
        const exp1 = c.exponent != null ? c.exponent : 1;
        const strength = c.strength != null ? c.strength : 0.1;
        const dual = c.direction2 != null || c.scale2 != null;
        const dir2 = c.direction2 != null ? c.direction2 : 0;
        const scale2 = c.scale2 != null ? c.scale2 : 66;
        const speed2 = c.speed2 != null ? c.speed2 : 3;
        const exp2 = c.exponent2 != null ? c.exponent2 : 1;
        const offset2 = c.offset2 != null ? c.offset2 : 0;
        // 官方 waterwaves.frag MASK: mask = texSample(g_Texture1, v_TexCoord.zw),
        // 位移 ×mask — 旧实现无 pass 参数忽略 mask → 波纹全图 (sf39h)
        const pt = (pass && pass.textures) || [];
        const hasMask = !!pt[1] && pt[1] !== 'null';
        const maskTex = hasMask ? this.loadTexture(pt[1]) : null;
        const w = tex.width, h = tex.height;
        // 官方 waterwaves.vert: v_TexCoord.z *= maskRes.z/x (mask宽/对象宽),
        // w *= maskRes.w/y — mask UV 缩放 (sf39i, 3460 的 mask 是对象 1/2 尺寸)
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const vd1 = [-Math.sin(dir1), Math.cos(dir1)]; // rotateVec2((0,1), dir1)
        const vd2 = [-Math.sin(dir2), Math.cos(dir2)];
        const off1 = [vd1[1], -vd1[0]];
        const off2 = [vd2[1], -vd2[0]];
        const s = strength * strength;
        // 低分辨率加速: 每 2x2 计算一次
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            // 官方 MASK: 位移 × mask (mask UV 乘缩放因子)
            let mf = 1;
            if (maskTex) mf = this._texSample(maskTex, u * mSx, v * mSy)[0];
            let dist = t * speed1 + (u * vd1[0] + v * vd1[1]) * scale1;
            const val1 = Math.sin(dist);
            const s1 = Math.sign(val1);
            const p1 = Math.pow(Math.abs(val1), exp1);
            let uu = u, vv = v;
            if (dual) {
              let dist2 = (t + offset2) * speed2 + (u * vd2[0] + v * vd2[1]) * scale2;
              const val2 = Math.sin(dist2);
              const s2 = Math.sign(val2);
              const p2 = Math.pow(Math.abs(val2), exp2);
              uu += p1 * s1 * p2 * s2 * off1[0] * s * mf;
              vv += p1 * s1 * p2 * s2 * off1[1] * s * mf;
            } else {
              uu += p1 * s1 * off1[0] * s * mf;
              vv += p1 * s1 * off1[1] * s * mf;
            }
            const sx = Math.max(0, Math.min(w - 1, Math.floor(uu * w)));
            const sy = Math.max(0, Math.min(h - 1, Math.floor(vv * h)));
            const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
            out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // waterripple: 官方 shader 数学 (effects/waterripple.frag/vert, PERSPECTIVE=0)
      //   scroll = rotateVec2((0,1), dir) × scrollSpeed² × time
      //   ripple.xy = uv + time×animSpeed² + scroll
      //   ripple.zw = uv×1.333 − time×animSpeed² + scroll
      //   ripple ×= scale; ripple.xz ×= texW/texH; ripple.yw ×= ratio
      //   n1 = sample(normal, ripple.xy)×2−1; n2 = sample(normal, ripple.zw)×2−1
      //   normal = normalize(n1.xy+n2.xy, n1.z); texCoord += normal.xy×strength²×mask
      //   旧实现是"简化圆形波纹" (sin(r)×strength×3 径向位移) — 与官方完全不同,
      //   产生中心扩散的正弦环形波浪 (用户感知"诡异正弦"来源之一)。
      ,
    effectWaterripple(tex, c, t, ef, pass) {
        const strength = c.ripplestrength != null ? c.ripplestrength : 0.1;
        const animSpeed = c.animationspeed != null ? c.animationspeed : 0.15;
        const scale = c.scale != null ? c.scale : 1;
        const scrollSpeed = c.scrollspeed != null ? c.scrollspeed : 0;
        const direction = c.scrolldirection != null ? c.scrolldirection : 0;
        const ratio = c.ratio != null ? c.ratio : 1;
        const pt = (pass && pass.textures) || [];
        const normalRef = pt[2] && pt[2] !== 'null' ? pt[2] : 'effects/waterripplenormal';
        const normalTex = this.loadTexture(normalRef);
        // 官方 waterripple.frag MASK: mask = texSample(g_Texture1, v_TexCoord.zw),
        // 位移 ×mask — 旧实现忽略 pt[1] (mask) → 有 mask 的水面全区域波纹 (sf39h)
        const hasMask = !!pt[1] && pt[1] !== 'null';
        const maskTex = hasMask ? this.loadTexture(pt[1]) : null;
        const w = tex.width, h = tex.height;
        // 官方 waterripple.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39i)
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const s2 = strength * strength;
        const as2 = animSpeed * animSpeed;
        const ss2 = scrollSpeed * scrollSpeed;
        // scroll = rotateVec2((0,1), dir) × scrollSpeed² × time (官方 common.h rotateVec2)
        const scx = (-Math.sin(direction)) * ss2 * t;
        const scy = Math.cos(direction) * ss2 * t;
        const aspect = w / h;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            // ripple coords (PERSPECTIVE=0)
            let rx1 = (u + as2 * t + scx) * scale;
            let ry1 = (v + as2 * t + scy) * scale;
            let rx2 = (u * 1.333 - as2 * t + scx) * scale;
            let ry2 = (v * 1.333 - as2 * t + scy) * scale;
            rx1 *= aspect; rx2 *= aspect;
            ry1 *= ratio; ry2 *= ratio;
            let n1 = [0.5, 0.5, 1], n2 = [0.5, 0.5, 1];
            if (normalTex) n1 = this._texSample(normalTex, rx1, ry1);
            if (normalTex) n2 = this._texSample(normalTex, rx2, ry2);
            const nx1 = n1[0] * 2 - 1, ny1 = n1[1] * 2 - 1;
            const nx2 = n2[0] * 2 - 1, ny2 = n2[1] * 2 - 1;
            const nx = nx1 + nx2, ny = ny1 + ny2, nz = n1[2];
            const nl = Math.hypot(nx, ny, nz) || 1;
            // 官方: texCoord += normal.xy × strength² × mask (mask UV 乘缩放因子)
            let mfactor = 1;
            if (maskTex) mfactor = this._texSample(maskTex, u * mSx, v * mSy)[0];
            const uu = Math.max(0, Math.min(1, u + (nx / nl) * s2 * mfactor));
            const vv = Math.max(0, Math.min(1, v + (ny / nl) * s2 * mfactor));
            const s = this._texSample(tex, uu, vv);
            const di = (y * w + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // shake: 官方 shader 数学 (effects/shake.frag, NOISE=0, DIRECTION=0)
      //   time = speed×t; offset = sin(frac(time/π2)×π2)×0.498+0.5;
      //   base = step(0, cos(time)); offset = mix(1-(1-offset)^fx, offset^fy, base);
      //   offset = saturate((offset-bounds.x)/(bounds.y-bounds.x)); offset = ×2−1;
      //   texCoordOffset = offset×strength²×flowMask (flowMask = (flow.rg−0.498)×2,
      //   flow = g_Texture1 方向图); out = sample(tex, uv+texCoordOffset)。
      //   旧实现是"简化正弦" (sin(t·speed·2.3)×s×30) — 与官方完全不同 → 眼睛等
      //   组件抖动方式错 (用户感知"诡异正弦")。
,
    effectShake(tex, c, t, pass) {
        const speed = c.speed != null ? c.speed : 1;
        const strength = c.strength != null ? c.strength : 0.1;
        const fr = parseVec2(c.friction, [1, 1]);
        const fx = fr[0] || 1, fy = fr[1] || 1;
        const bd = parseVec2(c.bounds, [0, 1]);
        const bx = bd[0] || 0, by = bd[1] || 1;
        const pt = (pass && pass.textures) || [];
        const flowTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const w = tex.width, h = tex.height;
        // 官方 shake.vert: flow UV 缩放 (flowRes/对象Res) (sf39i)
        const mSx = flowTex && flowTex.width > 0 ? flowTex.width / tex.width : 1;
        const mSy = flowTex && flowTex.height > 0 ? flowTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const M_PI_2 = Math.PI / 2;
        const s2 = strength * strength;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const time = speed * t;
            let offset = Math.sin((time / M_PI_2 - Math.floor(time / M_PI_2)) * M_PI_2);
            offset = offset * 0.498 + 0.5;
            const base = Math.cos(time) >= 0 ? 1 : 0;
            offset = base >= 0.5 ? Math.pow(offset, fy) : 1 - Math.pow(1 - offset, fx);
            offset = Math.max(0, Math.min(1, (offset - bx) / (by - bx || 1)));
            offset = offset * 2 - 1;
            // flowMask: 方向图 (无 → 0; 官方默认 util/noflow 中心灰 → 无位移)
            let fmx = 0, fmy = 0;
            if (flowTex) {
              const fm = this._texSample(flowTex, u * mSx, v * mSy);
              fmx = (fm[0] - 0.498) * 2;
              fmy = (fm[1] - 0.498) * 2;
            }
            const sx = Math.max(0, Math.min(w - 1, Math.round(u * w + offset * s2 * fmx)));
            const sy = Math.max(0, Math.min(h - 1, Math.round(v * h + offset * s2 * fmy)));
            const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
            out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // ── Particle 对象渲染 (完整模拟) ──────────────────────────────────
  });
}
