// WE 渲染引擎 — render 层: 统一效果 pass 执行器
// 官方对应: wallpaper64.exe 的效果 pass 链执行 (effect.json passes → FBO 图)。
// P3 重构: 把 applyEffects 的执行逻辑 (GPU 链式批量 → 逐个 GPU → 注册表内核 →
// GLSL 解释器回退) 从 SceneRenderer 类解耦为独立函数, 任何实现了同一组钩子的
// 后端对象 (SceneRenderer / 未来 Dawn 后端 / 浏览器端 player) 都可驱动。
// 行为保证: 与 P2 applyEffects 逐字一致 (含 GPU 优先顺序与错误回退)。
import path from 'path';
import { getVal } from '../math.js';
import { effectRegistry } from '../effects/registry.js';

/**
 * 执行对象 o 的效果链, 返回最终图像 {width,height,rgba}。
 * @param {object} backend 后端 (需实现: _tryEffectChainGpu/_tryEffectGpu/
 *        _applyGlslEffect/log; 可含 effectRegistry 所需的内核方法)
 * @param {object} img     输入图像 {width,height,rgba}
 * @param {object} o       场景对象 (o.effects[]: {file, passes, visible...})
 * @param {number} t       场景时间
 */
export function runEffectPasses(backend, img, o, t) {
  let out = img;
  // P4b: Dawn 预计算缓存 — worker 在 render() 前异步预渲染支持的效果 (Dawn),
  // 此处同步命中直接返回 (避免效果链 CPU 执行; 输出与 CPU 内核容差内一致)。
  if (backend._dawnEffectCache && backend._dawnEffectCache.has(o.id)) {
    return backend._dawnEffectCache.get(o.id);
  }
  // GPU 链式批量 (sf40h): 同一对象的连续效果在 GPU 内 FBO 乒乓执行 —
  // 中间结果不读回 CPU, 大幅减少纹理上传/readPixels/CPU 组装
  // (水层 4 效果: 独立 4 次 ~400ms → 链式 ~35ms, 91% 节省)。
  // 失败/不可用 → 逐个回退原路径。
  if (backend._tryEffectChainGpu) {
    const chainImg = backend._tryEffectChainGpu(out, o, t);
    if (chainImg && chainImg !== out) return chainImg;
  }
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
      // GPU 优先 (sf40h): 官方 shader + WebGL 执行, 失败/不可用回退手写 CPU
      // (x64 + supreium-headless-gl; arm64 自动回退, 与现状一致)
      if (backend._tryEffectGpu) {
        const gpuImg = backend._tryEffectGpu(out, ef, name, c, pass, t);
        if (gpuImg && gpuImg !== out) { out = gpuImg; continue; }
      }
      // P2: 注册表分发 (旧 if/else 24 分支) — 条目与旧调用逐一对齐
      const kernel = effectRegistry[name];
      if (kernel) {
        out = kernel.call(backend, { img: out, ef, name, passes, pass, c, combos, t });
      } else {
        // 第三方 workshop 效果 / 官方未实现 → GLSL 解释执行 (读 pkg/全局 shader)
        // 失败回退原图 (不崩溃)
        out = backend._applyGlslEffect(out, ef, name, t);
      }
    } catch (e) {
      backend.log('效果 ' + name + ' 失败: ' + e.message);
    }
  }
  return out;
}
