// 深挖: 头(697) vs 身体(407) 相对位置 — 检查身体类型/定义/puppet
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
// 头 697, 身体 407, 锚点 467
for (const id of [697, 407, 467]) {
  const o = r.objects.find(x => x.id === id);
  if (!o) continue;
  console.log(`== 对象 ${id} "${o.name}" ==`);
  console.log(JSON.stringify(o, null, 1));
  try {
    const model = r.readJsonAny(o.image);
    console.log(`  model:`, JSON.stringify(model));
  } catch (e) { console.log('  model 读取失败:', e.message); }
}
// 头与身体渲染顺序
const order = r.renderOrder;
const head = order.find(x => x.id === 697);
const body = order.find(x => x.id === 407);
console.log('renderOrder 中 头 index:', order.indexOf(head), ' 身体 index:', order.indexOf(body));
