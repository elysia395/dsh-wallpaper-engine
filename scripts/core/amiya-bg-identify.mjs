// 查 Amiya 各对象属性: 判断背景(314)/前景, fullscreen, name, image 类型
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
const ids = [314, 467, 697, 407, 463, 494, 459, 421, 685, 295, 329, 361, 509];
for (const id of ids) {
  const o = r.objects.find(x => x.id === id);
  if (!o) { console.log(id, 'NOT FOUND'); continue; }
  const m = o.image ? r.readJsonAny(o.image) : null;
  const imgType = m ? (m.puppet ? 'puppet' : m.fullscreen ? 'fullscreen' : m.solidlayer ? 'solid' : 'image') : 'anchor(无image)';
  const keys = Object.keys(o).filter(k => !['image'].includes(k)).join(',');
  console.log(`${id} "${String(o.name || '')}" type=${imgType} parent=${o.parent} origin=${String(o.origin||'').replace(/\s+/g,',')} keys=[${keys}]`);
}
