// WE 渲染引擎 — 效果 Blurradial (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧 out 改 scratch 池; 采样改写入式/单通道 (数值语义逐位不变)
import { parseVec2, getVal } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
      // blurradial (引擎 shader: effects/blur_radial_gaussian.frag + common_blur.h):
      // 径向旋转高斯模糊 (KERNEL 0=13 采样 / 1=7 / 2=3)
      //   delta = uv − center; amt = scale·0.025; r_i = rotate(delta, o_i·amt) − delta
      //   albedo = Σ w_i · sample(center ± r_i + delta)   (核/权重来自 common_blur.h)
      //   K0/K2 是"正距离 + 镜像 ±"核; K1 的偏移本身带符号且权重和=1.0
      //   (官方 7-tap 的双线性 4-tap 编码) → 各 tap 只按自身符号采一次 (P0-8,
      //   旧 ± 配对 → 权重和 2.0 ≈ 2 倍亮度)
      //   [MASK] albedo = mix(prev, albedo, mask.r); [BLURALPHA=0] albedo.a = prev.a
      //   uniform: scale/center; KERNEL/MASK/BLURALPHA combo

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
        const out = scratchGet(SCRATCH_U8, src.length);
        const amt = scale * 0.025;
        // 核参数 (common_blur.h): [o_i..., w_i...]
        const K0 = {
          o: [1.4091998770852122, 3.2979348079914822, 5.2062900776825969],
          w0: 0.1976406528809576,
          w: [0.2959855056006557, 0.0935333619980593, 0.0116608059608062],
        };
        const K1 = {
          // 单向核 (P0-8): 偏移带符号, 权重和恰 1.0 — 0.404486=0.214607+0.189879,
          // 0.202818=0.131514+0.071303 (官方 7-tap 相邻对的线性滤波编码)
          signed: true,
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
        // P0-5: 写入式采样 scratch (中心/正负 tap/prev 并读)
        const s0 = [0, 0, 0, 0];
        const sp = [0, 0, 0, 0];
        const sm = [0, 0, 0, 0];
        const pv = [0, 0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const dx = u - center[0], dy = v - center[1];
            // 中心项 (K0/K2) — P0-5: 标量化 (原 r 数组逐项一致)
            let rr = 0, rg = 0, rb = 0, ra = 0;
            if (K.w0 != null) {
              this._texSampleInto(tex, u, v, false, s0);
              rr = s0[0] * K.w0; rg = s0[1] * K.w0; rb = s0[2] * K.w0; ra = s0[3] * K.w0;
            }
            for (let i = 0; i < K.o.length; i++) {
              const o = K.o[i] * amt;
              const rot = rotate(dx, dy, o);
              const r1x = rot[0] - dx, r1y = rot[1] - dy;
              const w = K.w[i];
              if (K.signed) {
                // P0-8: K1 单向核 — 每个 tap 只采一次, 总权重和 1.0
                // (旧实现与 K0/K2 共用 ± 配对 → 总权重 2.0, 亮背景饱和泛白)
                this._texSampleInto(tex, center[0] + r1x + dx, center[1] + r1y + dy, false, sp);
                rr += sp[0] * w; rg += sp[1] * w; rb += sp[2] * w; ra += sp[3] * w;
              } else {
                this._texSampleInto(tex, center[0] + r1x + dx, center[1] + r1y + dy, false, sp);
                this._texSampleInto(tex, center[0] - r1x + dx, center[1] - r1y + dy, false, sm);
                rr += (sp[0] + sm[0]) * w;
                rg += (sp[1] + sm[1]) * w;
                rb += (sp[2] + sm[2]) * w;
                ra += (sp[3] + sm[3]) * w;
              }
            }
            // MASK / BLURALPHA (LGT-17: prev 仅在真正被消费时才采)
            let pr = 0, pg = 0, pb = 0, pa = 0, hasPrev = false;
            if (hasMask || keepAlpha) {
              this._texSampleInto(tex, u, v, false, pv);
              pr = pv[0]; pg = pv[1]; pb = pv[2]; pa = pv[3];
              hasPrev = true;
            }
            let or = rr, og = rg, ob = rb, oa = ra;
            if (hasMask) {
              // P0-5: mask 只取 R; maskTex 缺失时保持 [0]=1 契约
              const m = maskTex ? this._texR(maskTex, u, v) : 1;
              or = pr + (rr - pr) * m;
              og = pg + (rg - pg) * m;
              ob = pb + (rb - pb) * m;
              oa = pa + (ra - pa) * m;
            }
            if (keepAlpha) oa = pa;
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, or) * 255);
            out[di + 1] = Math.round(Math.min(1, og) * 255);
            out[di + 2] = Math.round(Math.min(1, ob) * 255);
            out[di + 3] = Math.round(Math.min(1, oa) * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
