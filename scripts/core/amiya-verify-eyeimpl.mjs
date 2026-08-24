// 验证核心修改: 非背景对象 -eye (视图平移) 渲染 Amiya
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
fs.writeFileSync('scripts/out/amiya_eyeimpl_1080.png', png);
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
const eyeR = soloBbox(r, 295);
const eyeL = soloBbox(r, 329);
const ear = soloBbox(r, 421);
const bg = soloBbox(r, 314);
console.log('实现 -eye 视图平移后:');
console.log(`  背景: ${bg ? bg.join(',') : '无'} 铺满=${bg ? (bg[0]<=1&&bg[1]<=1&&bg[2]>=r.W-2&&bg[3]>=r.H-2) : false}`);
console.log(`  头: ${head ? head.join(',') : '无'}`);
console.log(`  右眼: ${eyeR ? eyeR.join(',') : '无'} 左眼: ${eyeL ? eyeL.join(',') : '无'} 右耳: ${ear ? ear.join(',') : '无'}`);
if (head && eyeR && eyeL) {
  const hc = [(head[0]+head[2])/2, (head[1]+head[3])/2];
  const ec = [(eyeR[0]+eyeR[2])/2, (eyeR[1]+eyeR[3])/2];
  const el = [(eyeL[0]+eyeL[2])/2, (eyeL[1]+eyeL[3])/2];
  console.log(`  头中心(${hc[0].toFixed(0)},${hc[1].toFixed(0)}) 右眼(${ec[0].toFixed(0)},${ec[1].toFixed(0)}) 左眼(${el[0].toFixed(0)},${el[1].toFixed(0)})`);
  console.log(`  头 vs 右眼: dx=${(hc[0]-ec[0]).toFixed(1)} dy=${(hc[1]-ec[1]).toFixed(1)}  (原: dx=-21 dy=-2.5)`);
  console.log(`  眼距: ${(ec[0]-el[0]).toFixed(0)}px (原: 71px)`);
}
