// WE 渲染引擎 — 效果 Pulse (从 effects.js 拆分)
// P0-5: 整帧 out 改 scratch 池; 采样改写入式/单通道; applyBlending 直写 (数值逐位不变)
import { parseVec3, parseVec2, getVal, applyBlendingInto } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
      // pulse: 官方 shader 数学 (effects/pulse.frag/vert)
      //   vert (AUDIOPROCESSING=0): v_Pulse = smoothstep(bounds.x, bounds.y,
      //     sin(time×speed + (phase−π/2))×0.5+0.5) × amount  — phase 为弧度
      //     (uniform range [0,6.282]; 旧注释 (phase−0.25)×2π 是已修复前的错误公式)
      //   frag: pulse += sample(noise, time×0.0833, time×0.0278 ×noiseSpeed).r × noiseAmount;
      //         pulse = pow(pulse, power);
      //   PULSECOLOR: albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb×tintLow,
      //     albedo.rgb×tintHigh, pulse)
      //   PULSEALPHA: albedo.a *= pulse; MASK: mix(sample, albedo, mask.r)

    effectPulse(tex, c, t, combos, pass) {
        // 横切4: BLENDMODE 显式 0 (Normal) 不许被 || 吞 (LGT-07)
        const mode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 9;
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
        const out = scratchGet(SCRATCH_U8, src.length);
        // 音频响应 (引擎 pulse.vert AUDIOPROCESSING): v_Pulse = CreateAudioResponse(...)
        let pulse = 1;
        // 横切4: AUDIOPROCESSING 需 Number() (字符串 "2" > 0 为真但 mode===2 失败)
        const audioMode = Number(combos.AUDIOPROCESSING) || 0;
        // LGT-02: 无频谱数据 (静态帧渲染器, DSH 常态) 回落到非音频时间正弦分支,
        // 不是恒 0 — 旧实现 PULSEALPHA 整层 alpha·0 直接透明、PULSECOLOR 钉死
        // tintLow 端
        if (audioMode > 0 && this.audioSpectrum) {
          pulse = this._createAudioResponse(this.audioSpectrum, c, audioMode);
        } else {
          // 官方非音频: smoothstep(bounds, sin(time×speed + (phase − π/2))×0.5+0.5) × amount
          // g_PulsePhase range [0,6.282] 弧度 — 旧实现 (phase−0.25)×2π 把 phase 当
          // 0-1 归一化再乘 2π → phase=3(弧度) 时错算成 17.3 (sf39h)
          const sv = Math.sin(t * speed + (phase - 1.57079632679)) * 0.5 + 0.5;
          const k = Math.max(0, Math.min(1, (sv - bounds[0]) / Math.max(1e-6, bounds[1] - bounds[0])));
          pulse = (k * k * (3 - 2 * k)) * amount;
          // noise 调制 (P0-5: 只取 R → _texR)
          if (noiseAmount > 0 && noiseTex) {
            const n = this._texR(noiseTex, t * 0.08333333 * noiseSpeed, t * 0.02777777 * noiseSpeed) * noiseAmount;
            pulse += n;
          }
          pulse = Math.pow(Math.max(0, pulse), power);
        }
        const pulseC = Math.max(0, Math.min(1, pulse));
        // P0-5: 写入式采样/混合 scratch
        const s = [0, 0, 0, 0];
        const A = [0, 0, 0];
        const B = [0, 0, 0];
        const rgb = [0, 0, 0];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            this._texSampleInto(tex, u, v, false, s);
            let r0 = s[0], r1 = s[1], r2 = s[2], a = s[3];
            if (pulseColor) {
              // ApplyBlending(BLENDMODE, albedo.rgb×tintLow, albedo.rgb×tintHigh, pulse)
              A[0] = s[0] * tintLow[0]; A[1] = s[1] * tintLow[1]; A[2] = s[2] * tintLow[2];
              B[0] = s[0] * tintHigh[0]; B[1] = s[1] * tintHigh[1]; B[2] = s[2] * tintHigh[2];
              applyBlendingInto(mode, A, B, pulseC, rgb);
              r0 = rgb[0]; r1 = rgb[1]; r2 = rgb[2];
            }
            if (pulseAlpha) a = s[3] * pulseC;
            if (maskTex) {
              const mk = this._texR(maskTex, u, v);
              r0 = r0 * mk + s[0] * (1 - mk); r1 = r1 * mk + s[1] * (1 - mk); r2 = r2 * mk + s[2] * (1 - mk);
              a = a * mk + s[3] * (1 - mk);
            }
            const di = (y * w + x) * 4;
            out[di] = Math.round(Math.max(0, r0) * 255); out[di + 1] = Math.round(Math.max(0, r1) * 255);
            out[di + 2] = Math.round(Math.max(0, r2) * 255); out[di + 3] = Math.round(a * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: w, height: h, rgba: out };
      },

      // 引擎 CreateAudioResponse (pulse.vert): 频段求和 → smoothstep bounds →
      // pow → multiply。P0/LGT-02: 684fb0a 拆分时与 _gaussPass 一同丢定义,
      // 从拆分前单文件原样回补 (spec.left/right 为 16 桶频谱)。
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
};
