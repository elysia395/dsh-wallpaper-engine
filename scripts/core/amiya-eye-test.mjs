// 测试 camera eye 偏移假设: 场景坐标 + eye (lookAt 平移生效)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(eyeShift) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (eyeShift) {
    // 场景坐标 + eye 反 (lookAt 平移 -eye → origin' = origin - eye = origin + 360, +269.56)
    const [ex, ey] = [-360.0, -269.56];
    const origImg = r.renderImage.bind(r);
    const origPup = r.renderPuppet.bind(r);
    // 通过临时字段: renderImage 用 origin 映射 — 在 resolveTransform 后偏移
    const origResolve = r.resolveTransform.bind(r);
    r.resolveTransform = (o) => {
      const tr = origResolve(o);
      tr.origin = [tr.origin[0] - ex, tr.origin[1] - ey, tr.origin[2]];
      return tr;
    };
  }
  r.render();
  return r;
}

// 头内容
function headBbox(r) {
  const headO = r.objects.find(x => x.id === 697);
  const sv = new Map();
  for (const oo of r.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
  headO.visible = true;
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

for (const [label, shift] of [['当前(无eye)', false], ['eye偏移', true]]) {
  const r = make(shift);
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_${shift ? 'eye' : 'noeye'}_1080.png`, png);
  const head = headBbox(r);
  const eye = (() => {
    const o = r.objects.find(x => x.id === 295);
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
  })();
  console.log(`${label}: 头(${head ? head.join(',') : '无'}) 右眼(${eye ? eye.join(',') : '无'})`);
  if (head && eye) {
    const hc = [(head[0]+head[2])/2, (head[1]+head[3])/2];
    const ec = [(eye[0]+eye[2])/2, (eye[1]+eye[3])/2];
    console.log(`  头中心 vs 右眼中心: dx=${(hc[0]-ec[0]).toFixed(1)} dy=${(hc[1]-ec[1]).toFixed(1)}`);
  }
}
