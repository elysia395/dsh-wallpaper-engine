// 深挖: 头部区域组件 (头/眼/眉/鼻/发/耳/刘海/垂发/马尾/呆毛) 的父链与锚点
// 用户: 头部组件相对身体组件偏移, 头被身体盖 → 头部锚点可能偏低
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
function chain(id) {
  const out = [];
  let cur = r.objects.find(x => x.id === id);
  let guard = 0;
  while (cur && guard < 15) {
    const tr = r.resolveTransform(cur);
    out.push({ id: cur.id, name: String(cur.name || ''), origin: tr.origin, local: cur.origin, parent: cur.parent, size: String(cur.size || '') });
    if (cur.parent == null) break;
    cur = r.objects.find(x => x.id === cur.parent);
    guard++;
  }
  return out;
}
// 头部组件
const headIds = [697, 295, 329, 373, 701, 459, 421, 685, 466, 439, 192, 513, 520, 535, 536];
console.log('=== 头部组件父链 (id 名 绝对origin 父 尺寸) ===');
for (const id of headIds) {
  const c = chain(id);
  console.log(`\n[${id}] ${c[0].name}:`);
  for (const x of c) console.log(`  ${x.id} "${x.name}" local=${x.local ? x.local.replace(/\s+/g,',') : '-'} → abs(${x.origin[0].toFixed(1)},${x.origin[1].toFixed(1)}) parent=${x.parent} size=${x.size}`);
}
// 身体组件父链
console.log('\n=== 身体/手臂组件父链 ===');
for (const id of [407, 411, 389, 449, 403]) {
  const c = chain(id);
  console.log(`\n[${id}] ${c[0].name}:`);
  for (const x of c) console.log(`  ${x.id} "${x.name}" local=${x.local ? x.local.replace(/\s+/g,',') : '-'} → abs(${x.origin[0].toFixed(1)},${x.origin[1].toFixed(1)}) parent=${x.parent} size=${x.size}`);
}
