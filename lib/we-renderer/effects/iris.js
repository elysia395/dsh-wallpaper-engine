// WE 渲染引擎 — 效果 Iris (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧 out 改 scratch 池; 采样改写入式/单通道 (数值语义逐位不变)
import { parseVec3, parseVec2, getVal } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
      // iris (引擎 shader: effects/iris.frag/vert): 虹膜位移 (眼球呼吸运动)
      //   vert: time=t·speed+phase; lowDt=floor(time)
      //         moveStart = sin(1.9·lowDt) + sin(2.5·lowDt+(1,2)); moveEnd = sin(1.9·(lowDt+1)) + sin(2.5·(lowDt+1)+(1,2))
      //         da = mix(moveStart, moveEnd, smoothstep(1-rough, 1, cos(frac(time)·π)·(−0.5)+0.5))
      //         da += (sin(time), cos(time))·noiseAmount; da ×= scale·0.001
      //   frag: iris = sample(tex0, uv + da·mask)  [MASK: mask=tex1.r, irisMask 用于 BACKGROUND 混色]
      //   uniform: scale/speed/rough/noiseamount/phase/color; MASK/BACKGROUND combo

    effectIris(tex, c, t, pass) {
        const scale = parseVec2(getVal(c, 'scale', '1 1'), [1, 1]);
        const speed = getVal(c, 'speed', 1);
        const rough = getVal(c, 'rough', 0.2);
        const noiseAmount = getVal(c, 'noiseamount', 0.5);
        const phaseOffset = getVal(c, 'phase', 0);
        const eyeColor = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
        const combos = (pass && pass.combos) || {};
        const hasBg = combos.BACKGROUND === '1' || combos.BACKGROUND === 1;
        const pt = (pass && pass.textures) || [];
        // 官方 iris: opacity mask 始终把位移限制在遮罩区域 (官方文档: "Use the opacity
        // mask to limit the motion to the eyes") — 作者画了 mask 纹理 (textures[1]) 即
        // 应用, 不依赖 combos.MASK。旧实现只在 combos.MASK==='1' 时乘 mask; 无 combos
        // 的场景 (本场景的 iris pass 即无 combos 字段) 走无 mask 分支 → 整帧随"眼部
        // 呼吸"位移 ±2px = 用户感知的"整体上移/平移"。与 waterripple 的 mask 处理一致
        // (纹理存在即用)。BACKGROUND combo 仅控制遮罩外区域底色混合, 仍由 combos 驱动。
        const maskTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = scratchGet(SCRATCH_U8, src.length);
        // vert 预计算 (虹膜位移量, UV 单位)
        const time = t * speed + phaseOffset;
        const lowDt = Math.floor(time);
        const s2 = (k) => Math.sin(1.9 * (lowDt + k));
        const s4 = (k, ph) => Math.sin(2.5 * (lowDt + k) + ph);
        // LGT-06: 官方 iris.vert motion4 = sin(2.5·(lowDt+{0,0,1,1}) + {1,2,1,2}),
        // moveStart.y = sin(1.9·lowDt) + sin(2.5·lowDt + 2) → s4(0, 2)。
        // 旧 s4(1, 2) 把 y 分量接到 moveEnd 槽位 (lowDt+1), 保持相位差 4.5rad,
        // lowDt∈[0,60) 最大偏差 1.898 ≈ 2px@1080p 垂直持相错误
        const moveStart = [s2(0) + s4(0, 1), s2(0) + s4(0, 2)];
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
        // P0-5: 写入式采样 scratch (hasBg 分支先暂存 s 再混色 → 标量保留)
        const s = [0, 0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            let sr, sg, sb, sa;
            if (maskTex) {
              // P0-5: mask 只取 R → _texR
              const mask = this._texR(maskTex, u, v);
              const ox = dx * mask, oy = dy * mask;
              // P1-18/§9.6: 主图位移采样 clamp (旧默认 wrap → 眼部边缘回绕对侧)
              this._texSampleInto(tex, u + ox, v + oy, true, s);
              sr = s[0]; sg = s[1]; sb = s[2]; sa = s[3];
              if (hasBg) {
                // P0-5: irisMask 只取 R → _texR
                const irisMask = this._texR(maskTex, u + ox, v + oy);
                sr = eyeColor[0] + (sr - eyeColor[0]) * irisMask;
                sg = eyeColor[1] + (sg - eyeColor[1]) * irisMask;
                sb = eyeColor[2] + (sb - eyeColor[2]) * irisMask;
              }
            } else {
              // P1-18: 同上, 无 mask 分支的主图位移也 clamp
              this._texSampleInto(tex, u + dx, v + dy, true, s);
              sr = s[0]; sg = s[1]; sb = s[2]; sa = s[3];
            }
            const di = (y * W + x) * 4;
            out[di] = Math.round(sr * 255); out[di + 1] = Math.round(sg * 255);
            out[di + 2] = Math.round(sb * 255); out[di + 3] = Math.round(sa * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
