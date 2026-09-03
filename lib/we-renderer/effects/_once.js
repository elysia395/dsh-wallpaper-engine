// WE 渲染引擎 — effects 共享工具
// 记一次式 degraded (C1 通道): 同一渲染器实例 + 同一 feature 只发一次,
// 避免逐帧泛滥 (效果每帧都跑, 不加去重会每帧刷一条)。
// 注: effect 层拿不到所属对象 o (effects.js 分派不传对象), object 传 null,
// 与 core.js texture-parse 等无对象条目一致; 对象名上浮需上层 (effects.js) 配合。
const seen = new WeakMap();

export function degradedOnce(renderer, feature, action) {
  if (!renderer || typeof renderer._degraded !== 'function') return;
  let s = seen.get(renderer);
  if (!s) { s = new Set(); seen.set(renderer, s); }
  if (s.has(feature)) return;
  s.add(feature);
  try { renderer._degraded(null, feature, action); } catch { /* 回调失败不影响渲染 */ }
}
