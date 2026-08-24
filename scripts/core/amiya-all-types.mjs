// 列出 Amiya 所有组件: 名字/puppet或image/origin/size — 找出内衬衣组件
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
const rows = [];
for (const o of r.objects) {
  if (!o || typeof o.image !== 'string') continue;
  let model = null, isPuppet = false;
  try { model = r.readJsonAny(o.image); isPuppet = !!(model && model.puppet); } catch { }
  const tr = r.resolveTransform(o);
  rows.push({
    id: o.id, name: String(o.name || ''), type: isPuppet ? 'PUPPET' : 'image',
    ox: tr.origin[0].toFixed(0), oy: tr.origin[1].toFixed(0), size: String(o.size || '')
  });
}
rows.sort((a, b) => a.oy - b.oy);
console.log('=== Amiya 组件 (按场景y排序) ===');
for (const x of rows) {
  console.log(`  ${x.id} "${x.name}" [${x.type}] origin=(${x.ox},${x.oy}) size=${x.size}`);
}
// 统计 puppet vs image
const p = rows.filter(x => x.type === 'PUPPET');
console.log(`\npuppet 组件 (${p.length}):`, p.map(x => `${x.id}(${x.name})`).join(', '));
