// 查 Amiya scene.camera 与 general
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
console.log('scene.camera =', JSON.stringify(r.scene.camera));
console.log('scene.general =', JSON.stringify(r.scene.general));
console.log('camEye =', r.camEye);
