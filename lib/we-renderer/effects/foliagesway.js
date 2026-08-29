// WE 渲染引擎 — 效果 FoliageSway (从 effects.js 拆分)
// P0-5: 整帧 out 改 scratch 池; 采样改写入式/RG/单通道 (数值语义逐位不变)
import { getVal } from '../math.js';
import { degradedOnce } from './_once.js';
import { scratchGet, scratchPut, isScratch, SCRATCH_U8 } from './_scratch.js';

export const fx = {
      // foliagesway (引擎 shader: effects/foliagesway.frag/vert, MODE=0 UV 模式):
      //   vert: aspect=(texW/texH)×ratio; rotDir=rotate([1/aspect, aspect], dir)
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
        // 官方 foliagesway.vert: v_TexCoord.zw mask UV 缩放 = g_Texture1Res.z/x
        // = mask 自身 header/mip0 比 (无 mip ≡ 1 全幅)。sf35: 旧 mask/object 尺寸比
        // 在渲染尺寸 ≠ mask 尺寸时平铺采样 (植物 mask 落空 → "不动"的放大器)。
        const mSx = 1, mSy = 1;
        const noiseTex = pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : this.loadTexture('util/noise');
        // C4/F-6: 噪声缺失 → 白 → 相位恒定同值 → 整片植物同步摆动 (相位场丢失);
        // 无法用常量近似 → 跳过该效果 + 记一次 degraded
        if (!noiseTex) {
          degradedOnce(this, 'effect:foliagesway:noise', 'foliagesway 噪声纹理缺失（util/noise 不可用），已跳过该效果（对象保留）');
          return tex;
        }
        const src = tex.rgba;
        const out = scratchGet(SCRATCH_U8, src.length);
        const cosD = Math.cos(direction), sinD = Math.sin(direction);
        // P2-26: rotate 标量化 (原每像素返回新数组)
        const rotateX = (x, y) => x * cosD - y * sinD;
        const rotateY = (x, y) => x * sinD + y * cosD;
        // aspect = g_Texture0Resolution.z/w × ratio = (texW/texH) × ratio
        // (官方 foliagesway.vert: aspect = texW/texH×ratio; 本地曾用 H/W → 反了,
        //  rotDir 的 x/y 轴互换 → 摆动方向与官方垂直)
        const aspect = (W / H) * ratio;
        const rotDirX = rotateX(1 / aspect, aspect);
        const rotDirY = rotateY(1 / aspect, aspect);
        const ampBase = strength * strength * 0.005;
        const TWO_PI = Math.PI * 2;
        const sW = [1, -0.16161616, 0.0083333, -0.00019841];
        const cW = [-0.5, 0.041666666, -0.0013888889, 0.000024801587];
        // P2-26: speed·t·sW[i] / speed·t·cW[i] 为整 pass 常量 — 像素循环外一次
        // (旧实现每像素 ×8 乘法; 表达式左结合顺序保持 speed*t*sW[i])
        const stW = new Array(4), ctW = new Array(4);
        for (let i = 0; i < 4; i++) {
          stW[i] = speed * t * sW[i];
          ctW[i] = speed * t * cW[i];
        }
        // P0-5: 写入式采样 scratch (噪声只取 G → RG 变体)
        const noiseRG = [0, 0];
        const s = [0, 0, 0, 0];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            this._texRG(noiseTex, u * noiseScale, v * noiseScale, false, noiseRG);
            const prx = rotateX(u, v), pry = rotateY(u, v);
            let amp = ampBase;
            if (maskTex) amp *= this._texR(maskTex, u * mSx, v * mSy);
            const phaseV = (noiseRG[1] * TWO_PI + prx * 10 + pry * 5) * phase;
            let so = 0, co = 0;
            for (let i = 0; i < 4; i++) {
              const sv = Math.sin(phaseV + stW[i]);
              const cv = Math.sin(0.4 + phaseV + ctW[i]);
              so += Math.pow(Math.abs(sv), power) * Math.sign(sv);
              co += Math.pow(Math.abs(cv), power) * Math.sign(cv);
            }
            // C3/§9.6: 主图位移采样 clamp (旧默认 wrap → 植株边缘回绕对侧)
            this._texSampleInto(tex, u + rotDirX * so * amp, v + rotDirY * co * amp, true, s);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        // P0-5: 输入若为池缓冲 (上一效果输出) 用完归还
        if (isScratch(src)) scratchPut(src);
        return { width: W, height: H, rgba: out };
      }
};
