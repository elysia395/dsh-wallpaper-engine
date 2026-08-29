// WE 渲染引擎 — 效果 Blur (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧缓冲改 scratch 池 (downsample/gauss×2/combine); 采样改写入式/单通道;
// applyBlending 直写; mix 链标量化 (所有表达式与原版逐位一致)
import { parseVec3, parseVec2, getVal, applyBlendingInto, _greyscale } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
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
        // LGT-16: x/y 两个 gaussian pass 各带自己的 scale vec2 — x 扫描用
        // passes[1].scale.x, y 扫描用 passes[2].scale.y (旧实现只读 passes[1]
        // 给两个方向用, passes[2] 的 scale 被忽略)
        const scaleH = parseVec2(getVal(cG, 'scale', getVal(c, 'scale', '1 1')), [1, 1]);
        const cGy = ((passes && passes[2]) || {}).constantshadervalues || {};
        const scaleV = parseVec2(getVal(cGy, 'scale', getVal(c, 'scale', '1 1')), [1, 1]);
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
        // P0-5: 中间缓冲池借出
        const down = scratchGet(SCRATCH_U8, dw * dh * 4);
        const ox = 1 / W, oy = 1 / H;
        // P0-5: 写入式采样 scratch (4 角顺序消费)
        const ds = [0, 0, 0, 0];
        for (let y = 0; y < dh; y++) {
          for (let x = 0; x < dw; x++) {
            const uc = (x + 0.5) / dw, vc = (y + 0.5) / dh;
            const c0x = uc - ox, c1x = uc + ox, c0y = vc - oy, c1y = vc + oy;
            let rs = 0, gs = 0, bs = 0, asq = 0, wa = 0;
            for (let i = 0; i < 4; i++) {
              this._texSampleInto(tex, i & 1 ? c1x : c0x, i < 2 ? c0y : c1y, true, ds);
              rs += ds[0] * ds[3]; gs += ds[1] * ds[3]; bs += ds[2] * ds[3];
              asq += ds[3] * ds[3]; wa += ds[3];
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
        const gs = [0, 0, 0, 0];
        const gauss = (tex2, vertical2) => {
          const w2 = tex2.width, h2 = tex2.height;
          // P0-5: 输出缓冲池借出
          const out2 = scratchGet(SCRATCH_U8, w2 * h2 * 4);
          // blur_gaussian.vert: offset = g_Scale.x/y ÷ 纹理分辨率 (z/w)
          // LGT-16: 各方向用所属 pass 的 scale (x→passes[1], y→passes[2])
          const step = vertical2 ? scaleV[1] / h2 : scaleH[0] / w2;
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
                this._texSampleInto(tex2, vertical2 ? u : u + i * step, vertical2 ? v + i * step : v, true, gs);
                const wgt = weights[i + n];
                r += gs[0] * wgt; g += gs[1] * wgt; b += gs[2] * wgt; a += gs[3] * wgt;
              }
              const di = (y * w2 + x) * 4;
              out2[di] = Math.round(Math.min(1, r) * 255);
              out2[di + 1] = Math.round(Math.min(1, g) * 255);
              out2[di + 2] = Math.round(Math.min(1, b) * 255);
              out2[di + 3] = Math.round(Math.min(1, a) * 255);
            }
          }
          // P0-5: 本 pass 输入 (池缓冲) 已消费完 → 归还
          if (isScratch(tex2.rgba)) scratchPut(tex2.rgba);
          return { width: w2, height: h2, rgba: out2 };
        };
        img = gauss(img, vertical);
        img = gauss(img, !vertical);
        // ── pass 4: combine (blurred 与 原图 按 COMPOSITE 混合) ──
        const out = scratchGet(SCRATCH_U8, src.length);
        const bw = img.width, bh = img.height;
        // P0-5: 写入式采样/混合 scratch
        const bl = [0, 0, 0, 0];
        const old = [0, 0, 0, 0];
        const eb = [0, 0, 0];
        const eff = [0, 0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // ApplyCompositeOffset: 像素offset ÷ g_Texture0Resolution.xy (= blurred 纹理分辨率)
            const bu = composite !== 0 ? u + compOffset[0] / bw : u;
            const bv = composite !== 0 ? v + compOffset[1] / bh : v;
            this._texSampleInto(img, bu, bv, true, bl);
            this._texSampleInto(tex, u, v, false, old);
            let mask = 1;
            if (maskTex) {
              // sf35: mask UV 缩放 = mask 自身 header/mip0 比 (≡ 1; 旧 mask/对象比错误平铺)
              mask = this._texR(maskTex, u, v);
            }
            // div = mix(blurred.a, 1, step(blurred.a, 0)) — a>0 时用 a 反预乘, 否则 1
            const div = bl[3] > 0 ? bl[3] : 1;
            eff[0] = bl[0] / div; eff[1] = bl[1] / div; eff[2] = bl[2] / div; eff[3] = bl[3];
            if (compMono) {
              const gv2 = _greyscale(eff);
              eff[0] = gv2; eff[1] = gv2; eff[2] = gv2;
            }
            eff[0] = eff[0] * compColor[0]; eff[1] = eff[1] * compColor[1]; eff[2] = eff[2] * compColor[2];
            // ApplyComposite(original, effect) — 标量化 (表达式与原 res 数组逐项一致)
            let r0, r1, r2, r3;
            if (composite === 0) {
              r0 = eff[0]; r1 = eff[1]; r2 = eff[2]; r3 = eff[3]; // 仅返回效果
            } else if (composite === 1) {
              applyBlendingInto(blendMode, old, eff, eff[3] * compAlpha, eb);
              r0 = eb[0]; r1 = eb[1]; r2 = eb[2];
              r3 = Math.max(eff[3] * Math.min(1, compAlpha), old[3]);
            } else if (composite === 2) {
              const ea = eff[3] * Math.min(1, compAlpha);
              r0 = eff[0] + (old[0] - eff[0]) * old[3];
              r1 = eff[1] + (old[1] - eff[1]) * old[3];
              r2 = eff[2] + (old[2] - eff[2]) * old[3];
              r3 = ea + old[3] * (1 - ea);
            } else {
              const ea = eff[3] * Math.min(1, compAlpha) * (1 - old[3]);
              r0 = eff[0]; r1 = eff[1]; r2 = eff[2]; r3 = ea;
            }
            // mix(original, composite, mask)
            r0 = old[0] + (r0 - old[0]) * mask;
            r1 = old[1] + (r1 - old[1]) * mask;
            r2 = old[2] + (r2 - old[2]) * mask;
            r3 = old[3] + (r3 - old[3]) * mask;
            if (keepAlpha) r3 = old[3];
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, r0)) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, r1)) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, r2)) * 255);
            out[di + 3] = Math.round(Math.min(1, Math.max(0, r3)) * 255);
          }
        }
        // P0-5: gauss 末级缓冲 + 输入池缓冲用完归还
        if (isScratch(img.rgba)) scratchPut(img.rgba);
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
