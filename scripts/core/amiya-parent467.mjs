// 检查 528 对象 (身体 407 的父) 完整定义
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
for (const id of [528, 467]) {
  const o = r.objects.find(x => x.id === id);
  if (!o) { console.log(`对象 ${id} 不存在`); continue; }
  console.log(`== ${id} "${o.name}" ==`);
  console.log(JSON.stringify(o, null, 1));
}
// 所有引用 467 作为 parent 的对象
console.log('parent=467 的对象:');
for (const o of r.objects) {
  if (o.parent === 467) console.log(`  ${o.id} "${o.name}" origin=${o.origin} size=${o.size}`);
}
