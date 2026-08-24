// 验证: 当前渲染背景 314 是否铺满画布; 对比各对象绝对位置
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
// 只显示背景 314
function soloBbox(id) {
  const o = r.objects.find(x => x.id === id);
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
  for (const [oid, v] of sv) { const obj = r.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
  return nz ? [minX,minY,maxX,maxY] : null;
}
const bg = soloBbox(314);
console.log(`背景314 bbox: ${bg ? bg.join(',') : '无'}  (画布 1920x1080)`);
if (bg) {
  const w = bg[2]-bg[0], h = bg[3]-bg[1];
  console.log(`背景尺寸: ${w}x${h}, 左缘=${bg[0]}, 上缘=${bg[1]}, 右缘=${bg[2]}, 下缘=${bg[3]}`);
  console.log(`铺满: 左=${bg[0]<=1} 上=${bg[1]<=1} 右=${bg[2]>=r.W-2} 下=${bg[3]>=r.H-2}`);
}
