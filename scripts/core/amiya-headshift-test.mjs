// 实验: 697(头) origin 上移 — 五官/头发组全部跟着上移, 躯干/大衣不动
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(headShiftY) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (headShiftY) {
    const o = r.objects.find(x => x.id === 697);
    o.origin = `3.91650 ${174.03113 + headShiftY} 0.00000`;
  }
  r.render();
  return r;
}

function compBbox(r, oid) {
  const o = r.objects.find(x => x.id === oid);
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

for (const shift of [0, 379, 550, 750]) {
  const r = make(shift);
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_headshift_${shift}.png`, png);
  const head = compBbox(r, 697);
  const eye = compBbox(r, 295);
  const lEar = compBbox(r, 685);
  const hair = compBbox(r, 459);
  const body = compBbox(r, 407);
  const coat = compBbox(r, 403);
  console.log(`697+${shift}: 头(${head ? head.join(',') : '无'}) 右眼(${eye ? eye.join(',') : '无'}) 左耳(${lEar ? lEar.join(',') : '无'})`);
  console.log(`  主发(${hair ? hair.join(',') : '无'}) 躯干(${body ? body.join(',') : '无'}) 左大衣(${coat ? coat.join(',') : '无'})`);
}
