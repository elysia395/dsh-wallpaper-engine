// 决定性行为测试: 模拟官方 lookAt 生效 (场景坐标 + eye 平移) 前后对比
// 官方: MVP = ortho × lookAt(eye,center,up); Amiya eye=(-360,-269.56,0) center=(-360,-269.56,-1) up=(0,1,0)
// lookAt 旋转部分=单位阵, 平移=(+360,+269.56,0) → 场景坐标整体 +360/+269.56
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(eyeShift) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (eyeShift) {
    const origResolve = r.resolveTransform.bind(r);
    r.resolveTransform = (o) => {
      const tr = origResolve(o);
      tr.origin = [tr.origin[0] + 360, tr.origin[1] + 269.56, tr.origin[2]];
      return tr;
    };
  }
  r.render();
  return r;
}

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

for (const [label, shift] of [['当前(无eye)', false], ['eye平移(官方lookAt)', true]]) {
  const r = make(shift);
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_${shift ? 'eye2' : 'noeye2'}_1080.png`, png);
  const head = soloBbox(r, 697);
  const eyeR = soloBbox(r, 295);
  const bg = soloBbox(r, 314);
  console.log(`${label}:`);
  console.log(`  背景314: ${bg ? bg.join(',') : '无'}  (画布 1920x1080)`);
  if (bg) {
    const w = bg[2]-bg[0], h = bg[3]-bg[1];
    console.log(`    背景尺寸 ${w}x${h} 左缘${bg[0]} 上缘${bg[1]} 右缘${bg[2]} 下缘${bg[3]} 铺满=${bg[0]<=1&&bg[1]<=1&&bg[2]>=r.W-2&&bg[3]>=r.H-2}`);
  }
  console.log(`  头697: ${head ? head.join(',') : '无'}  右眼295: ${eyeR ? eyeR.join(',') : '无'}`);
  if (head && eyeR) {
    const hc = [(head[0]+head[2])/2, (head[1]+head[3])/2];
    const ec = [(eyeR[0]+eyeR[2])/2, (eyeR[1]+eyeR[3])/2];
    console.log(`  头中心 vs 右眼中心: dx=${(hc[0]-ec[0]).toFixed(1)} dy=${(hc[1]-ec[1]).toFixed(1)}`);
  }
}
