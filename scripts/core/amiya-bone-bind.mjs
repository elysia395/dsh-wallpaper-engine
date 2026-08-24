// 检查头 697 MDL 骨骼 bind 矩阵平移 — 根骨骼偏移可能导致头整体位移
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
for (const [id, name] of [[697, '头'], [295, '右眼'], [329, '左眼']]) {
  const o = r.objects.find(x => x.id === id);
  const model = r.readJsonAny(o.image);
  const mdlRaw = r.pkg.read(model.puppet);
  const mesh = r._parseMdl(mdlRaw);
  console.log(`=== ${name}(${id}) MDL: 骨骼 ${mesh.bones ? mesh.bones.length : 0} ===`);
  if (mesh.bones) {
    for (let b = 0; b < mesh.bones.length; b++) {
      const bn = mesh.bones[b];
      const bm = bn.bind;
      console.log(`  骨${b}: parent=${bn.parent} bind T=(${bm[12].toFixed(2)},${bm[13].toFixed(2)},${bm[14].toFixed(2)}) rot=atan2(${bm[1].toFixed(4)})`);
    }
  }
  // 顶点范围
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for (const p of mesh.positions) { minX=Math.min(minX,p[0]); maxX=Math.max(maxX,p[0]); minY=Math.min(minY,p[1]); maxY=Math.max(maxY,p[1]); }
  console.log(`  raw 顶点: x[${minX.toFixed(1)},${maxX.toFixed(1)}] y[${minY.toFixed(1)},${maxY.toFixed(1)}] 中心(${((minX+maxX)/2).toFixed(1)},${((minY+maxY)/2).toFixed(1)})`);
}
