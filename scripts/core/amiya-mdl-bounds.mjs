// 检查头 697 MDL 的 raw 顶点范围 vs 图像 size (548x678)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const head = r.objects.find(x => x.id === 697);
const model = r.readJsonAny(head.image);
const mdlRaw = r.pkg.read(model.puppet);
const mesh = r._parseMdl(mdlRaw);
console.log('MDL:', model.puppet);
console.log('顶点数:', mesh.positions.length);
let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
for (const p of mesh.positions) { minX=Math.min(minX,p[0]); maxX=Math.max(maxX,p[0]); minY=Math.min(minY,p[1]); maxY=Math.max(maxY,p[1]); }
console.log(`raw 顶点范围: x[${minX},${maxX}] y[${minY},${maxY}] (宽${(maxX-minX).toFixed(1)} 高${(maxY-minY).toFixed(1)})`);
console.log(`图像 size: 548x678`);
console.log(`骨骼数:`, mesh.bones ? mesh.bones.length : 0, '动画数:', mesh.animations ? mesh.animations.length : 0);
// 蒙皮后范围
if (mesh.bones && mesh.animations) {
  const skinned = r._skinPuppet(mesh, 2.5, 0, 0, 1, 0.74);
  let ax=1e9,ay=1e9,bx=-1e9,by=-1e9;
  for (const p of skinned) { ax=Math.min(ax,p[0]); bx=Math.max(bx,p[0]); ay=Math.min(ay,p[1]); by=Math.max(by,p[1]); }
  console.log(`蒙皮后范围: x[${ax.toFixed(1)},${bx.toFixed(1)}] y[${ay.toFixed(1)},${by.toFixed(1)}]`);
}
