// WE 渲染引擎 — 效果 Waterflow (从 effects.js 拆分)
// P0-5: 整帧 out 改 scratch 池; 采样改写入式/RG/单通道; mix2 链标量化
// (每步表达式与原 mix2 完全一致, 仅去数组分配)
import { getVal } from '../math.js';
import { degradedOnce } from './_once.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

// WAT-08: 原 mix2 像素级闭包分配已在 P0-5 标量化 (见下方 mix 链, 表达式不变)

export const fx = {
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

    effectWaterflow(tex, c, t, pass) {
        const W = tex.width, H = tex.height;
        const speed = getVal(c, 'speed', 1);
        const feather = getVal(c, 'feather', 0.4);
        const amp = getVal(c, 'strength', 1);
        const phaseScale = getVal(c, 'phasescale', 2);
        const pt = (pass && pass.textures) || [];
        const flowTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : this.loadTexture('util/noflow');
        const phaseTex = pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        // WAT-02/F-7: flowmask 缺失时 _texSample(null)=白 → 解码 (1−0.498)·2
        // ≈ 最大流量 (整图对角位移 ~96px@1920)。官方 util/noflow 语义 = 中灰
        // 0.498 → 零位移 → "无效果"可确定 → 按 F-7 守卫策略直接跳过 + 记一次
        // degraded (与 shake 缺 flow 纹理的处理对齐)
        if (!flowTex) {
          degradedOnce(this, 'effect:waterflow:flowmask', 'waterflow 流向纹理缺失（util/noflow 不可用），无位移语义，已跳过该效果（对象保留）');
          return tex;
        }
        const src = tex.rgba;
        const out = scratchGet(SCRATCH_U8, src.length);
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
        // P0-5: 五路写入式采样 scratch (s0..s4 并读) + RG 流向图
        const fcRG = [0, 0];
        const s0 = [0, 0, 0, 0], s1 = [0, 0, 0, 0], s2 = [0, 0, 0, 0], s3 = [0, 0, 0, 0], s4 = [0, 0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // frag
            // P0-5: 相位/流向图单通道或 RG 写入式采样
            const flowPhase = phaseTex ? this._texR(phaseTex, u * phaseScale, v * phaseScale) : 0;
            this._texRG(flowTex, u, v, false, fcRG);
            const fx = (fcRG[0] - 0.498) * 2, fy = (fcRG[1] - 0.498) * 2;
            const flowAmount = Math.sqrt(fx * fx + fy * fy);
            const k = amp * 0.1;
            const o1x = fx * k * cycles[0], o1y = fy * k * cycles[0];
            const o2x = fx * k * cycles[1], o2y = fy * k * cycles[1];
            const o3x = fx * k * cycles[2], o3y = fy * k * cycles[2];
            const o4x = fx * k * cycles[3], o4y = fy * k * cycles[3];
            this._texSampleInto(tex, u, v, false, s0);
            // P1-7/§9.6: 位移后的主图采样 clamp (旧默认 wrap → 边缘 ~5% 带从
            // 对侧回绕镜像内容)
            this._texSampleInto(tex, u + o1x, v + o1y, true, s1);
            this._texSampleInto(tex, u + o2x, v + o2y, true, s2);
            this._texSampleInto(tex, u + o3x, v + o3y, true, s3);
            this._texSampleInto(tex, u + o4x, v + o4y, true, s4);
            // P0-5: mix2 链标量化 (与原 mix2 每步表达式逐位一致)
            const ssPh = smoothstep(0.2, 0.8, flowPhase);
            const fa = Math.min(1, flowAmount);
            const di = (y * W + x) * 4;
            for (let i = 0; i < 4; i++) {
              let fai = s1[i] + (s2[i] - s1[i]) * blend;
              const fa2 = s3[i] + (s4[i] - s3[i]) * blend2;
              fai = fai + (fa2 - fai) * ssPh;
              out[di + i] = Math.round((s0[i] + (fai - s0[i]) * fa) * 255);
            }
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
