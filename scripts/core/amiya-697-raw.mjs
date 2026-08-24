// 检查 scene.json 中 697/463/494/528 的原始定义 (完整)
// 找 291px 偏移的数学来源 — 可能 697 的 origin 或 size 解析有误
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
for (const id of [467, 697, 463, 494, 528]) {
  const o = r.objects.find(x => x.id === id);
  if (!o) continue;
  console.log(`== id=${id} "${o.name}" 原始 JSON ==`);
  console.log(JSON.stringify(o, null, 1));
}
// 头 697 的 MDL: 检查 raw 顶点与图像 size 关系
const head = r.objects.find(x => x.id === 697);
const hm = r.readJsonAny(head.image);
const mdlRaw = r.pkg.read(hm.puppet);
const mesh = r._parseMdl(mdlRaw);
console.log('\n头 MDL raw bbox:', (() => {
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for (const p of mesh.positions) { minX=Math.min(minX,p[0]); maxX=Math.max(maxX,p[0]); minY=Math.min(minY,p[1]); maxY=Math.max(maxY,p[1]); }
  return `x[${minX},${maxX}] y[${minY},${maxY}]`;
})());
console.log('头 size:', head.size);
