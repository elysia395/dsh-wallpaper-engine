// 读取 models/背景.json 的完整定义
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const m = r.pkg.readJson('models/背景.json');
console.log('models/背景.json:');
console.log(JSON.stringify(m, null, 1));
