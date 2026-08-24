// 测试: 697 y 上移 + 494/463 x 右移 (眼睛/头发组件相对头右移)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(headShiftY, faceShiftX) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (headShiftY) {
    const o = r.objects.find(x => x.id === 697);
    o.origin = `3.91650 ${174.03113 + headShiftY} 0.00000`;
  }
  if (faceShiftX) {
    // 五官组(494) 和 头发组(463) 的 origin x 右移
    for (const gid of [494, 463]) {
      const o = r.objects.find(x => x.id === gid);
      if (o && o.origin) {
        const parts = o.origin.trim().split(/\s+/).map(Number);
        o.origin = `${parts[0] + faceShiftX} ${parts[1] || 0} ${parts[2] || 0}`;
      }
    }
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

// 组合测试: 上移量 × 右移量
const combos = [
  [550, 0], [550, 100], [550, 200], [650, 100], [650, 200], [750, 150],
];
for (const [hy, fx] of combos) {
  const r = make(hy, fx);
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_combo_h${hy}_x${fx}.png`, png);
  const head = compBbox(r, 697);
  const eye = compBbox(r, 295);
  const lEar = compBbox(r, 685);
  const rEar = compBbox(r, 421);
  const nose = compBbox(r, 701);
  const hair = compBbox(r, 459);
  console.log(`697+${hy} 组+${fx}: 头(${head ? head.join(',') : '无'}) 右眼(${eye ? eye.join(',') : '无'})`);
  console.log(`  左耳(${lEar ? lEar.join(',') : '无'}) 右耳(${rEar ? rEar.join(',') : '无'}) 鼻(${nose ? nose.join(',') : '无'}) 主发(${hair ? hair.join(',') : '无'})`);
}
