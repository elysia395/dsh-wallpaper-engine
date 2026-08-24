// 完整父链: 头(697→467) vs 身体(407→528→...)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
function chain(id) {
  const out = [];
  let cur = r.objects.find(x => x.id === id);
  let guard = 0;
  while (cur && guard < 20) {
    out.push({ id: cur.id, name: String(cur.name || ''), origin: cur.origin, parent: cur.parent, size: cur.size, scale: cur.scale });
    if (cur.parent == null) break;
    cur = r.objects.find(x => x.id === cur.parent);
    guard++;
  }
  return out;
}
console.log('=== 头 697 父链 ===');
for (const c of chain(697)) console.log(`  ${c.id} "${c.name}" origin=${c.origin} parent=${c.parent} size=${c.size}`);
console.log('=== 身体 407 父链 ===');
for (const c of chain(407)) console.log(`  ${c.id} "${c.name}" origin=${c.origin} parent=${c.parent} size=${c.size}`);
// 五官 494 链
console.log('=== 右眼 295 父链 ===');
for (const c of chain(295)) console.log(`  ${c.id} "${c.name}" origin=${c.origin} parent=${c.parent} size=${c.size}`);
