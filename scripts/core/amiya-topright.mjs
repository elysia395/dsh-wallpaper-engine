// 检查非居中对象: Clock(394) 文本(260) 等右上角对象位置
// 若官方=我的, 这些应在画面右上角附近
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
function soloBbox(r, oid) {
  const o = r.objects.find(x => x.id === oid);
  if (!o) return null;
  const sv = new Map();
  for (const oo of r.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
  o.visible = true;
  r.render();
  const d = r.canvas.data;
  let minX=1e9,minY=1e9,maxX=-1,maxY=-1,nz=0;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
    const i = (y*r.W+x)*4;
    if (d[i+3] > 10) { nz++; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  for (const [oid2, v] of sv) { const obj = r.objects.find(x => x.id === oid2); if (obj) obj.visible = v; }
  return nz ? [minX,minY,maxX,maxY] : null;
}
// 右上角对象: Clock 394, Date 286, 文本 260
for (const id of [394, 286, 260, 490]) {
  const o = r.objects.find(x => x.id === id);
  if (!o) continue;
  const tr = r.resolveTransform(o);
  const bb = soloBbox(r, id);
  console.log(`id=${id} "${o.name}": origin=(${tr.origin[0].toFixed(1)},${tr.origin[1].toFixed(1)}) bbox=${bb ? bb.join(',') : '无'} → 期望(官方): x=${(tr.origin[0]*0.5).toFixed(0)} y=${(tr.origin[1]*0.5).toFixed(0)}`);
}
