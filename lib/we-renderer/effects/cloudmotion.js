// WE 渲染引擎 — 效果 Cloudmotion (从 effects.js 拆分)
import { getVal } from '../math.js';
import { degradedOnce } from './_once.js';

export const fx = {
      // cloudmotion (引擎 shader: effects/cloudmotion.frag/vert): perlin 噪声驱动
      // 云层 UV 位移
      //   vert: noiseCoord.x = uv.x·(w/h)·scale·scaleX + t·speed; noiseCoord.y = uv.y·scale
      //   frag: offset = ((noise.r·2−1)·amount·mask, 0) 旋转 (direction+π/2)
      //         uvs = uv + offset; [MASK] uvs = mix(uv, uvs, dstMask)
      //   uniform: amount/direction/speed/scale/scaleX; textures=[主, mask?, perlin]

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
        // C4/F-6: 噪声缺失 → _texSample(null)=白 → (1·2−1)·amount = 最大位移
        // (整图错位); 无法用常量近似 perlin → 跳过该效果 + 记一次 degraded
        if (!noiseTex) {
          degradedOnce(this, 'effect:cloudmotion:noise', 'cloudmotion 噪声纹理缺失（util/perlin_256 不可用），已跳过该效果（对象保留）');
          return tex;
        }
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
            // P1-7/§9.6: 位移后的主图采样 clamp (旧默认 wrap → 边缘从对侧回绕)
            const s = this._texSample(tex, uu, vv, true);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
