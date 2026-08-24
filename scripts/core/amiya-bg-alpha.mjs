// 检查 314 背景在渲染顺序的位置与透明度, 及前景是否被盖
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
console.log('renderOrder 中 314 位置:', r.renderOrder.findIndex(x => x.id === 314), '/', r.renderOrder.length);
console.log('renderOrder 前 12:', r.renderOrder.slice(0, 12).map(x => `${x.id}:${x.name||''}`).join(' | '));
const o314 = r.objects.find(x => x.id === 314);
const m = r.readJsonAny(o314.image);
const tex = r.loadModelTexture(o314.image);
if (tex) {
  // 采样纹理 alpha
  let alphaSum = 0, n = 0, minA = 255;
  for (let i = 3; i < tex.rgba.length; i += 4) { alphaSum += tex.rgba[i]; n++; if (tex.rgba[i] < minA) minA = tex.rgba[i]; }
  console.log(`背景纹理 ${tex.width}x${tex.height} 平均alpha=${(alphaSum/n).toFixed(1)} minA=${minA}`);
}
console.log('背景 alpha 对象属性:', String(o314.alpha || ''));
