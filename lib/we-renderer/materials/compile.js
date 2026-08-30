// WE 渲染引擎 — materials 层: 官方材质系统统一编译
// 官方 material.json: { passes: [{ shader, blending, depthtest, depthwrite, cullmode,
//                                  textures[], constantshadervalues, usershadervalues,
//                                  combos }] }
// P2 重构: 把 image/model/particles 里散落的
//   `mat && mat.passes && mat.passes[0] ? mat.passes[0] : null`
// 收敛为单一编译入口。
// 安全原则: 本层**不替消费者发明语义默认值** (blending 默认值各消费者不同:
// image/model=opaque, particles=translucent) — 只保证数组/对象结构 + index,
// 其余字段原样保留 (Object.assign), 消费者维持各自 `|| 默认` 回退语义。
import { getVal } from '../math.js';

/** 编译 material.json → Pass[] (规范化)。无 passes 返回 null。 */
export function compileMaterial(mat) {
  if (!mat || !Array.isArray(mat.passes)) return null;
  return mat.passes.map((p, i) => Object.assign({}, p, {
    index: i,
    textures: (p && p.textures) || [],
    constantshadervalues: (p && p.constantshadervalues) || {},
    usershadervalues: (p && p.usershadervalues) || {},
    combos: (p && p.combos) || {},
  }));
}

/** 首 pass (等效旧 `mat && mat.passes && mat.passes[0] ? mat.passes[0] : null`)。 */
export function firstPass(mat) {
  const ps = compileMaterial(mat);
  return ps ? ps[0] : null;
}

/** 按 pass 索引取 pass (越界/缺失 → null)。 */
export function passAt(mat, i = 0) {
  const ps = compileMaterial(mat);
  return ps ? (ps[i] || null) : null;
}

/** pass 级 getVal (uniform/常量取值, 兼容 {script,value} 对象)。 */
export function passVal(pass, key, def) {
  return pass ? getVal(pass.constantshadervalues || {}, key, def) : def;
}
