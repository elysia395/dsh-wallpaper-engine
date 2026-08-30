// WE 渲染引擎 — effects 聚合入口
// 各效果实现拆分在 effects/ 子目录 (按效果 1 文件), 分发走 effects/registry.js
// 注册表 (P2), 执行逻辑走 render/passes.js 统一 pass 执行器 (P3, 双后端可驱动)。
import { effectKernels } from './effects/registry.js';
import { runEffectPasses } from './render/passes.js';

export function installEffects(proto) {
  Object.assign(proto, {
    // P3: 委托统一执行器 (GPU 链式批量 → 逐个 GPU → 注册表内核 → GLSL 回退)
    applyEffects(o, tex, t) {
      return runEffectPasses(this, tex, o, t);
    },
    ...effectKernels,
  });
}
