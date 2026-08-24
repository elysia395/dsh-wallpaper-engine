// 检查 Amiya 头 697 + 关键组件的完整 model 定义
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const objs = r.scene.objects || [];
for (const o of objs) {
  if (o && (o.id === 697 || o.id === 295 || o.id === 459 || o.id === 314)) {
    console.log(`== 对象 ${o.id} "${o.name}" ==`);
    console.log(JSON.stringify(o, null, 1));
    if (o.image) {
      try {
        const img = r.pkg.readJson(o.image);
        console.log(`  image(${o.image}):`, JSON.stringify(img));
      } catch (e) { console.log(`  image 读取失败: ${e.message}`); }
    }
  }
}
