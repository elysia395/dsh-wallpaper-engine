// 查 314 背景的 _renderType 和 image 模型字段 (fullscreen/背景标志)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
for (const id of [314, 361, 509, 407]) {
  const o = r.objects.find(x => x.id === id);
  const m = o.image ? r.readJsonAny(o.image) : null;
  console.log(`=== ${id} "${o.name}" _renderType=${o._renderType} size=${String(o.size||'')} ===`);
  if (m) {
    const keys = Object.keys(m);
    console.log(`  model keys: ${keys.join(',')}`);
    if (m.fullscreen !== undefined) console.log(`  fullscreen=${m.fullscreen}`);
    if (m.name) console.log(`  model.name=${m.name}`);
  }
}
