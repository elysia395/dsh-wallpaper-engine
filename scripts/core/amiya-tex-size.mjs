// 检查身体 407 纹理尺寸 vs size (autosize 语义)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 407);
const model = r.readJsonAny(o.image);
const tex = r.loadModelTexture(o.image);
console.log('身体 407: size=', o.size, ' model.autosize=', model.autosize);
console.log('纹理尺寸:', tex ? `${tex.width}x${tex.height}` : '无');
// 头 697 纹理
const head = r.objects.find(x => x.id === 697);
const hmodel = r.readJsonAny(head.image);
const htex = r.loadModelTexture(head.image);
console.log('头 697: size=', head.size, ' 纹理:', htex ? `${htex.width}x${htex.height}` : '无');
// 右眼
const eye = r.objects.find(x => x.id === 295);
const etex = r.loadModelTexture(eye.image);
console.log('右眼 295: size=', eye.size, ' 纹理:', etex ? `${etex.width}x${etex.height}` : '无');
