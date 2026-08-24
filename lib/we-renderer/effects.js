// WE 渲染引擎 — effects (从 core.js 拆分, 逻辑不变)
import path from 'path';
import { parseVec3, parseVec2, getVal, applyBlending, _greyscale, _sat3, _frac } from './math.js';

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
              img = this.effectWaterwaves(img, c, t);
            } else if (name === 'waterripple') {
              img = this.effectWaterripple(img, c, t, ef);
            } else if (name === 'shake') {
              img = this.effectShake(img, c, t);
            } else if (name === 'scroll') {
              img = this.effectScroll(img, c, t);
            } else if (name === 'tint') {
              img = this.effectTint(img, c, t, combos);
            } else if (name === 'pulse') {
              img = this.effectPulse(img, c, t, combos, pass);
            } else if (name === 'filmgrain') {
              img = this.effectFilmgrain(img, c, t, combos, pass);
            } else if (name === 'godrays') {
              img = this.effectGodrays(img, passes, t);
            } else if (name === 'opacity') {
              // opacity 通常通过 mask 控制透明度, 简化: 忽略
            } else if (name === 'frame_builder_by_gariam') {
              // 官方 Gariam Frame Builder 面板效果 (TYPE=0 Round):
              // SDF 圆角矩形 + 4 角缺口 → 深灰面板 (Dock 类壁纸暗色面板的来源)
              img = this.effectFrameBuilder(c, combos);
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
            const mask = maskTex ? this._texSample(maskTex, u, v, true)[0] : 1;
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
    effectTint(tex, c, t, combos) {
        const mode = combos.BLENDMODE || 2; // 默认 multiply
        const alpha = getVal(c, 'alpha', 1);
        const color = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            const rgb = applyBlending(mode, [s[0], s[1], s[2]], color, alpha);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // pulse: blend = mask.a * g_Multiply; albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, mask.rgb, blend)
,
    effectPulse(tex, c, t, combos, pass) {
        const mode = combos.BLENDMODE || 2;
        const mult = getVal(c, 'multiply', 1);
        const tex1 = pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : null;
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        // 音频响应 (引擎 pulse.vert AUDIOPROCESSING): v_Pulse = CreateAudioResponse(...)
        let pulse = 1;
        const audioMode = combos.AUDIOPROCESSING || 0;
        if (audioMode > 0 && this.audioSpectrum) {
          pulse = this._createAudioResponse(this.audioSpectrum, c, audioMode);
        } else if (audioMode > 0) {
          pulse = 0; // 无音频输入 → 静音
        }
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            const mask = tex1 ? this._texSample(tex1, u, v) : [1, 1, 1, 1];
            // 引擎 pulse.frag: blend = mask.a * g_Multiply; AUDIO 时 pulse 调制
            const blend = mask[3] * mult * pulse;
            const rgb = applyBlending(mode, [s[0], s[1], s[2]], [mask[0], mask[1], mask[2]], blend);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
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
        const out = new Uint8Array(tex.rgba.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            // v_TexCoordNoise.xy = (uv + t) * scale * (aspect,1); .zw = (uv - t*2.5) * scale * 0.52 * (aspect,1)
            const n1 = tex1 ? this._texSample(tex1, (u + t) * noiseScale * aspect, (v + t) * noiseScale) : [1, 1, 1, 1];
            const n2 = tex1 ? this._texSample(tex1, (u - t * 2.5) * noiseScale * 0.52 * aspect, (v - t * 2.5) * noiseScale * 0.52) : [1, 1, 1, 1];
            let noise = [n1[0], n1[1], n1[2]];
            let noise2 = [n2[1], n2[2], n2[0]]; // .gbr
            if (greyscale === 1) {
              const g1 = _greyscale(noise), g2 = _greyscale(noise2);
              noise = [g1, g1, g1]; noise2 = [g2, g2, g2];
            }
            const mul = _sat3([noise[0] * noise2[0], noise[1] * noise2[1], noise[2] * noise2[2]]);
            const np = mul.map((v) => Math.pow(v, noisePower));
            let blend = noiseAlpha;
            if (tex2) blend *= this._texSample(tex2, u, v)[0];
            const rgb = applyBlending(mode, [s[0], s[1], s[2]], np, blend);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // waterwaves: 双波 sin 位移 (shader 精确数学)
,
    effectWaterwaves(tex, c, t) {
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
        // mask 纹理 (可选)
        let mask = null;
        const texArr = (ef => ef.passes?.[0]?.textures)({ passes: [{ textures: this._currentEffectTextures }] }) || [];
        // 简化: 无 mask 时 mask=1
    
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const vd1 = [Math.sin(dir1), Math.cos(dir1)]; // rotateVec2((0,1), dir)
        const vd2 = [Math.sin(dir2), Math.cos(dir2)];
        const off1 = [vd1[1], -vd1[0]];
        const off2 = [vd2[1], -vd2[0]];
        const s = strength * strength;
        // 低分辨率加速: 每 2x2 计算一次
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const pos = Math.abs((u - 0.5) * vd1[0] + (v - 0.5) * vd1[1]);
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
              uu += p1 * s1 * p2 * s2 * off1[0] * s;
              vv += p1 * s1 * p2 * s2 * off1[1] * s;
            } else {
              uu += p1 * s1 * off1[0] * s;
              vv += p1 * s1 * off1[1] * s;
            }
            const sx = Math.max(0, Math.min(w - 1, Math.floor(uu * w)));
            const sy = Math.max(0, Math.min(h - 1, Math.floor(vv * h)));
            const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
            out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // waterripple: 法线贴图采样位移 (简化: 纯 CPU 波纹)
,
    effectWaterripple(tex, c, t, ef) {
        // 需要 waterripplenormal 纹理; 简化实现: 圆形波纹位移
        const strength = c.ripplestrength != null ? c.ripplestrength : 0.1;
        const animSpeed = c.animationspeed != null ? c.animationspeed : 0.15;
        const scale = c.scale != null ? c.scale : 1;
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const cx = w / 2, cy = h / 2;
        const maxR = Math.hypot(cx, cy);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dx = x - cx, dy = y - cy;
            const r = Math.hypot(dx, dy);
            const phase = t * animSpeed * 4 + r / maxR * Math.PI * 4 * scale;
            const amp = Math.sin(phase) * strength * 3;
            const sx = Math.max(0, Math.min(w - 1, Math.round(x + (dx / (r + 1e-6)) * amp)));
            const sy = Math.max(0, Math.min(h - 1, Math.round(y + (dy / (r + 1e-6)) * amp)));
            const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
            out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // shake: 时间噪声位移
,
    effectShake(tex, c, t) {
        const speed = c.speed != null ? c.speed : 1;
        const strength = c.strength != null ? c.strength : 0.1;
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const s = strength * strength;
        // 简化: 均匀时间位移 + 轻微空间变化
        const ox = Math.sin(t * speed * 2.3) * s * 30;
        const oy = Math.cos(t * speed * 1.7) * s * 30;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const phase = t * speed + x * 0.001 + y * 0.0013;
            const shx = Math.sin(phase) * s * 15 + ox;
            const shy = Math.cos(phase * 1.3) * s * 15 + oy;
            const sx = Math.max(0, Math.min(w - 1, Math.round(x + shx)));
            const sy = Math.max(0, Math.min(h - 1, Math.round(y + shy)));
            const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
            out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // ── Particle 对象渲染 (完整模拟) ──────────────────────────────────
  });
}
