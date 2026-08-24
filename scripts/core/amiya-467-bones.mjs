// 检查 467 (鼻子, 头部链根锚点) 的 MDL 骨骼 — 骨骼根 bind 平移可能影响子挂载
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
for (const [id, name] of [[467, '身体(鼻子锚点)'], [697, '头'], [403, '左大衣']]) {
  const o = r.objects.find(x => x.id === id);
  const m = r.readJsonAny(o.image);
  if (!m.puppet) { console.log(`${id} ${name}: 非 puppet`); continue; }
  const mdlRaw = r.pkg.read(m.puppet);
  const mesh = r._parseMdl(mdlRaw);
  console.log(`=== ${id} ${name} MDL 骨骼 ${mesh.bones ? mesh.bones.length : 0} ===`);
  if (mesh.bones) {
    for (let b = 0; b < Math.min(mesh.bones.length, 4); b++) {
      const bn = mesh.bones[b];
      const bm = bn.bind;
      console.log(`  骨${b}: parent=${bn.parent} bind T=(${bm[12].toFixed(2)},${bm[13].toFixed(2)},${bm[14].toFixed(2)})`);
    }
  }
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for (const p of mesh.positions) { minX=Math.min(minX,p[0]); maxX=Math.max(maxX,p[0]); minY=Math.min(minY,p[1]); maxY=Math.max(maxY,p[1]); }
  console.log(`  raw: x[${minX.toFixed(1)},${maxX.toFixed(1)}] y[${minY.toFixed(1)},${maxY.toFixed(1)}] 中心(${((minX+maxX)/2).toFixed(1)},${((minY+maxY)/2).toFixed(1)})`);
  // 蒙皮后 (动画0, t=2.5)
  if (mesh.bones && mesh.animations) {
    const sk = r._skinPuppet(mesh, 2.5, 0, 0, 0, 1);
    let ax=1e9,ay=1e9,bx=-1e9,by=-1e9;
    for (const p of sk) { ax=Math.min(ax,p[0]); bx=Math.max(bx,p[0]); ay=Math.min(ay,p[1]); by=Math.max(by,p[1]); }
    console.log(`  蒙皮后: x[${ax.toFixed(1)},${bx.toFixed(1)}] y[${ay.toFixed(1)},${by.toFixed(1)}]`);
  }
}
