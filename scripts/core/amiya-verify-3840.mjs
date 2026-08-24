// 3840x2160 下验证 (DSH 实际分辨率): puppet -eye, image 不动
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
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
const head = soloBbox(r, 697);
const body = soloBbox(r, 407);
const bg = soloBbox(r, 314);
console.log('3840x2160 (DSH 分辨率):');
console.log(`  背景: ${bg ? bg.join(',') : '无'} 铺满=${bg ? (bg[0]<=1&&bg[1]<=1&&bg[2]>=r.W-2&&bg[3]>=r.H-2) : false}`);
console.log(`  头: ${head ? head.join(',') : '无'}`);
console.log(`  身体: ${body ? body.join(',') : '无'}`);
if (head && body) console.log(`  头-身体重叠: ${(head[3]-body[1]).toFixed(0)}px`);
// 头中心
if (head) console.log(`  头中心: (${((head[0]+head[2])/2).toFixed(0)},${((head[1]+head[3])/2).toFixed(0)})`);
