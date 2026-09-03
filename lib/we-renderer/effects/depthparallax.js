// WE 渲染引擎 — 效果 DepthParallax (从 effects.js 拆分, 逻辑零改动)
// P0-5: 整帧 out 改 scratch 池; depth/mask 采样换单通道 _texR (ray-march 内层
// 每 step 一采, 24/64 层 — 分配收益最大); 主图采样改写入式 (数值语义逐位不变)
import { parseVec2, getVal } from '../math.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
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
        // 指针位置 (静态帧默认屏幕中心): 场景 uniform parallaxposition 优先;
        // 缺省时接 renderer opts.mouse (P1-11: 旧实现只读 uniform → 引擎注入的
        // 鼠标从不生效)。格式与 camera.js:253 视差一致 — [x,y] 数组下标风格,
        // UV 空间 [0,1]
        const ppRaw = getVal(c, 'parallaxposition', null);
        const prlxPos = ppRaw != null ? parseVec2(ppRaw, [0.5, 0.5])
          : this.optsMouse != null
            ? [Number.isFinite(Number(this.optsMouse[0])) ? Number(this.optsMouse[0]) : 0.5,
               Number.isFinite(Number(this.optsMouse[1])) ? Number(this.optsMouse[1]) : 0.5]
            : [0.5, 0.5];
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = scratchGet(SCRATCH_U8, src.length);
        // sf35: depth/mask UV 缩放 = 纹理自身 header/mip0 比 (≡ 1; 旧 mask/对象比错误平铺)
        const dSx = 1, dSy = 1;
        const mSx = 1, mSy = 1;
        const ctrlSign = sens >= 0 ? 1 : 0;
        const negPerspective = -sens;
        const ctrlPerspOrtho = Math.min(1, Math.max(0, sens)) + (negPerspective > 0.0001 ? 1 : 0);
        const prlx = ctrlSign ? [1 - prlxPos[0], 1 - prlxPos[1]] : [prlxPos[0], prlxPos[1]];
        const perspMix = -1 + (negPerspective + 1) * ctrlPerspOrtho; // mix(-1, negPerspective, ctrlPerspOrtho)
        const numLayers = quality === 2 ? 64 : 24;
        const layerDepth = 1 / numLayers;
        // P0-5: 写入式采样 scratch
        const s = [0, 0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const dz = u * dSx, dw = v * dSy;
            // P0-5: depth 只取 R → _texR (与 _texSample(...)[0] 同数学)
            const depth = depthTex ? this._texR(depthTex, dz, dw) : 0;
            let mask = 1;
            if (maskTex) mask = this._texR(maskTex, u * mSx, v * mSy);
            let sampleU, sampleV;
            if (quality === 0) {
              // P2-25: 标量化 (原实现每像素建 2 个 pointer 数组; 表达式逐项不变)
              // vec2(v_TexCoord.z, 1−v_TexCoord.w) 为指针输入 (y 翻转)
              let pX = dz - prlxPos[0], pY = (1 - dw) - prlxPos[1];
              pX = pX * 2 * scale[0] * -0.04;
              pY = pY * -2 * scale[1] * -0.04;
              const offsetX = (depth * 2 - 1) * pX * mask;
              const offsetY = (depth * 2 - 1) * pY * mask;
              sampleU = u + offsetX; sampleV = v + offsetY;
            } else {
              // P2-25: 标量化 ray-march — 原实现每像素分配 coords/pointer/ctrlDir/
              // fakeViewdir/P/delta/cur/prev 等 9 个小数组, 且 while 内每步
              // (至多 64 层) 再 new 一个 cur 数组; 标量表达式与原数组版逐项相同
              // (含求值顺序) → 采样坐标/层数/收敛语义逐位一致
              // coords: sens≥0 时透视压缩, sens<0 时原样
              let co0, co1;
              if (ctrlSign) {
                co0 = (u - 0.5) / (1 + sens * 0.2) + 0.5;
                co1 = (v - 0.5) / (1 + sens * 0.2) + 0.5;
              } else {
                co0 = u; co1 = v;
              }
              co0 -= (prlx[0] * 2 - 1) * center * (-0.05) * scale[0] * perspMix;
              co1 -= (prlx[1] * 2 - 1) * center * (0.05) * scale[1] * perspMix;
              const ptrX = 1 - dz, ptrY = dw; // vec2(1−v_TexCoord.z, v_TexCoord.w)
              const cd0 = ptrX - prlx[0], cd1 = ptrY - prlx[1];
              // mix(vec2(1−prlx.x, prlx.y)−0.5, ctrlDir·vec2(−neg, neg), ctrlPerspOrtho)
              const altX = 1 - prlx[0] - 0.5, altY = prlx[1] - 0.5;
              const dirX = altX + (cd0 * (-negPerspective) - altX) * ctrlPerspOrtho;
              const dirY = altY + (cd1 * negPerspective - altY) * ctrlPerspOrtho;
              const fvX = dirX * mask, fvY = dirY * mask;
              // ParallaxMapping (ray march 分层)
              const pX = fvX * scale[0] * 0.1, pY = fvY * scale[1] * 0.1;
              const dX = pX / numLayers, dY = pY / numLayers;
              let curU = co0, curV = co1;
              let curDepth = depthTex ? this._texR(depthTex, curU * dSx, curV * dSy) : 0;
              let currentLayerDepth = 1;
              let i = 0;
              while (currentLayerDepth > curDepth && i < numLayers) {
                curU = curU - dX;
                curV = curV - dY;
                curDepth = depthTex ? this._texR(depthTex, curU * dSx, curV * dSy) : 0;
                currentLayerDepth -= layerDepth;
                i++;
              }
              const prevU = curU + dX, prevV = curV + dY;
              const afterDepth = curDepth - currentLayerDepth;
              const beforeDepth = (depthTex ? this._texR(depthTex, prevU * dSx, prevV * dSy) : 0) - currentLayerDepth - layerDepth;
              const weight = afterDepth / (afterDepth - beforeDepth);
              sampleU = prevU * weight + curU * (1 - weight);
              sampleV = prevV * weight + curV * (1 - weight);
            }
            this._texSampleInto(tex, sampleU, sampleV, false, s);
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, s[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, s[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, s[2])) * 255);
            out[di + 3] = Math.round(Math.min(1, Math.max(0, s[3])) * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
