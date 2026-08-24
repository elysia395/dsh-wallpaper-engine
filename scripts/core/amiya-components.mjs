// 列出 Amiya 所有组件 bbox + origin, 找可能 100px+ 差异的组件
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
// 逐个对象测 bbox
const results = [];
for (const o of r.objects) {
  if (o._renderType !== 'image' && o._renderType !== 'text') continue;
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
  for (const [oid, v] of sv) { const obj = r.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
  if (nz) results.push({ id: o.id, name: String(o.name || ''), bbox: [minX,minY,maxX,maxY], nz });
}
// 排序: 按名字或 id
results.sort((a,b) => a.id - b.id);
for (const r0 of results) {
  const [x1,y1,x2,y2] = r0.bbox;
  const cx = (x1+x2)/2, cy = (y1+y2)/2;
  console.log(`id=${r0.id} "${r0.name}": bbox(${x1},${y1},${x2},${y2}) 中心(${cx.toFixed(0)},${cy.toFixed(0)}) 尺寸${x2-x1}x${y2-y1}`);
}
