// WE 渲染引擎 — 效果 Shake (从 effects.js 拆分)
// sf35: 两处官方语义修正（docs/plan-scene-webgl-details.md §13 仲裁闭环）:
//   1) 位移单位: 官方 texCoordOffset 是 UV 空间 → 采样前 ×w/×h
//      （旧实现当像素加, amp²≤0.0064 round 恒等 → shake 从未生效; 且 u·w=x+0.5
//       恰在 Math.round 边界, offset 符号翻转时被 mask 区域整块 0↔1px 跳变
//       = 每循环一次"闪帧"）。
//   2) 时间数学: 旧公式 sin(frac(time/π/2)·π/2) 相位裁 [0,π/2), 段边界 sin 从
//      ~1 跳回 0 → 每 π/2/speed 硬跳变。官方后续版本已改 6.28 切片 + 完整正弦
//      （sin(0)=sin(2π) 回绕连续 = 平滑往返）。与 scene-shader 路由的
//      patchShakeFrag (GL 路径) 保持同一公式。
import { parseVec2 } from '../math.js';
import { degradedOnce } from './_once.js';

export const fx = {
    effectShake(tex, c, t, pass) {
        const speed = c.speed != null ? c.speed : 1;
        const strength = c.strength != null ? c.strength : 0.1;
        const fr = parseVec2(c.friction, [1, 1]);
        // WAT-16: ?? 不吞显式 0 (用户配 friction "0 2" 的 0 应保留; 仅除数守卫
        // 处保留 || 1)
        const fx = fr[0] ?? 1, fy = fr[1] ?? 1;
        const bd = parseVec2(c.bounds, [0, 1]);
        const bx = bd[0] ?? 0, by = bd[1] ?? 1;
        const pt = (pass && pass.textures) || [];
        const flowTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        // WAT-13/F-7 守卫策略统一: 槽位有纹理但加载失败 → 无效果可确定, 跳过
        // 该效果 (对象保留) 并记一次 degraded; 槽位本就为空 = 官方 util/noflow
        // 中心灰语义 (零位移) → 直接原样返回, 不算降级
        if (pt[1] && pt[1] !== 'null' && !flowTex) {
          degradedOnce(this, 'effect:shake:flow', 'shake 流向纹理缺失，零位移语义，已跳过该效果（对象保留）');
          return tex;
        }
        if (!flowTex) return tex;
        const w = tex.width, h = tex.height;
        // 官方 shake.vert: flow UV 缩放 = g_Texture1Res.z/x = mask 自身 header/mip0 比
        // (无 mip 纹理 ≡ 1 全幅; sf35 — 旧 mask/object 比在渲染尺寸 ≠ mask 尺寸时
        // 平铺采样错区域)。loadTexImage 的 w/h 即 header 尺寸 → 比恒 1。
        const mSx = 1, mSy = 1;
        const out = new Uint8Array(tex.rgba.length);
        const TWO_PI = Math.PI * 2;
        const s2 = strength * strength;
        // sf35: 6.28 切片 + 完整正弦（官方修复形态, 连续无跳变）
        const time = ((speed * t / TWO_PI) % 1 + 1) % 1 * TWO_PI;
        let offset = Math.sin(time);
        offset = offset * 0.498 + 0.5;
        const base = Math.cos(time) >= 0 ? 1 : 0;
        offset = base >= 0.5 ? Math.pow(offset, fy) : 1 - Math.pow(1 - offset, fx);
        offset = Math.max(0, Math.min(1, (offset - bx) / (by - bx || 1)));
        offset = offset * 2 - 1;
        // 位移 UV → 像素 (sf35): 方向图 RG 编码 (0.498 中心灰)
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            // flowMask: 方向图 (无 → 0; 官方默认 util/noflow 中心灰 → 无位移)
            let fmx = 0, fmy = 0;
            if (flowTex) {
              const fm = this._texSample(flowTex, u * mSx, v * mSy);
              fmx = (fm[0] - 0.498) * 2;
              fmy = (fm[1] - 0.498) * 2;
            }
            // UV 位移 + 双线性采样 (官方语义; sf35: 旧 nearest+round 在 u·w=x+0.5
            // 恰为舍入边界, offset 符号翻转时被 mask 区域整块 0↔1px 跳变 = 闪帧)
            // F-5/§9.6: 主图位移采样传 clamp (sf35 重构时丢失 → 边缘位移带回绕)
            const s = this._texSample(tex, u + offset * s2 * fmx, v + offset * s2 * fmy, true);
            const di = (y * w + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di+1] = Math.round(s[1] * 255);
            out[di+2] = Math.round(s[2] * 255); out[di+3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
  };
