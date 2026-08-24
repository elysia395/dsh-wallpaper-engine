// 检查 renderPuppet 为何无输出: 打印每对象渲染类型 + 头对象详情
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const logs = [];
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: (m) => logs.push(m) });
r.render();
console.log('日志数:', logs.length);
logs.slice(0, 30).forEach(l => console.log('  LOG:', l));
// 检查头对象
const head = r.objects.find(x => x.id === 697);
console.log('头 697:', JSON.stringify({ renderType: head._renderType, model: head.model && head.model.puppet, image: head.image, visible: head.visible }));
const eye = r.objects.find(x => x.id === 295);
console.log('右眼 295:', JSON.stringify({ renderType: eye._renderType, model: eye.model && eye.model.puppet, image: eye.image, visible: eye.visible }));
