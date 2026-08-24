// 检查头 697 及关键组件的 angles/scale/parent 链 — 旋转可能导致大位移
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
// 头 + 眼睛 + 耳的父链
for (const id of [697, 467, 295, 494, 329, 421, 459]) {
  const o = r.objects.find(x => x.id === id);
  if (!o) continue;
  const tr = r.resolveTransform(o);
  console.log(`id=${id} "${o.name}": parent=${o.parent} origin=${JSON.stringify(getRaw(o,'origin'))} angles=${JSON.stringify(getRaw(o,'angles'))} scale=${JSON.stringify(getRaw(o,'scale'))} size=${JSON.stringify(getRaw(o,'size'))}`);
  console.log(`  resolved: origin=(${tr.origin[0].toFixed(2)},${tr.origin[1].toFixed(2)},${tr.origin[2].toFixed(2)}) angle=${tr.angle.toFixed(3)} scale=(${tr.scale[0].toFixed(3)},${tr.scale[1].toFixed(3)})`);
}
function getRaw(o, k) { const v = o && o[k]; return v; }
