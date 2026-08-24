// 验证: puppet 经视图矩阵(-eye), image 不经 — 头-身体重叠应降为 ~10px
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
fs.writeFileSync('scripts/out/amiya_sf22_1080.png', png);
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
const head = soloBbox(r, 697);
const body = soloBbox(r, 407);
const bg = soloBbox(r, 314);
const clock = soloBbox(r, 394);
const eyeR = soloBbox(r, 295);
console.log('puppet 经视图矩阵, image 不经:');
console.log(`  背景: ${bg ? bg.join(',') : '无'} 铺满=${bg ? (bg[0]<=1&&bg[1]<=1&&bg[2]>=r.W-2&&bg[3]>=r.H-2) : false}`);
console.log(`  头: ${head ? head.join(',') : '无'}`);
console.log(`  身体: ${body ? body.join(',') : '无'}`);
if (head && body) console.log(`  头-身体重叠: ${(head[3]-body[1]).toFixed(0)}px`);
console.log(`  Clock: ${clock ? clock.join(',') : '无'}`);
if (head && eyeR) {
  const hc = [(head[0]+head[2])/2, (head[1]+head[3])/2];
  const ec = [(eyeR[0]+eyeR[2])/2, (eyeR[1]+eyeR[3])/2];
  console.log(`  头(${hc[0].toFixed(0)},${hc[1].toFixed(0)}) 右眼(${ec[0].toFixed(0)},${ec[1].toFixed(0)}) dx=${(hc[0]-ec[0]).toFixed(1)} dy=${(hc[1]-ec[1]).toFixed(1)}`);
}
