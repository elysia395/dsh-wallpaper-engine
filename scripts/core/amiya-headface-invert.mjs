// 实验: 头面发耳组 cropoffset 取反 (网格 = raw - crop), 躯干/大衣不动
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

// 头面发耳组件 (467 下的头/眼/鼻/眉/耳/头发 + 各自子树)
const HEAD_FACE = new Set([
  697, 295, 701, 329, 373, 421, 685,        // 头/眼/鼻/眉/耳
  463, 459, 673, 520, 439, 636, 466, 523, 574, // 头发组及发
  192, 201, 205, 209, 214, 218, 222,        // 刘海
  513, 593, 536, 535,                       // 垂发/马尾
]);

function make(headInvert) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (headInvert) {
    const orig = r.renderPuppet.bind(r);
    const origSkin = r._skinPuppet.bind(r);
    r._skinPuppet = (mesh, t, cxs, cys) => {
      const out = origSkin(mesh, t, 0, 0);
      const crop = r._curCrop;
      if (crop) for (const p of out) { p[0] += crop[0]; p[1] += crop[1]; }
      return out;
    };
    r.renderPuppet = (o, model, tr, t) => {
      if (HEAD_FACE.has(o.id) && model && model.cropoffset) {
        const [cx, cy] = model.cropoffset.trim().split(/\s+/).map(Number);
        r._curCrop = [-cx, -cy]; // 取反
      } else r._curCrop = null;
      return orig(o, model, tr, t);
    };
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

for (const [label, invert] of [['回退(无crop)', false], ['头面发耳取反', true]]) {
  const r = make(invert);
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_${invert ? 'headface_invert' : 'current'}.png`, png);
  const head = compBbox(r, 697);
  const lEar = compBbox(r, 685);
  const rEar = compBbox(r, 421);
  const eye = compBbox(r, 295);
  const nose = compBbox(r, 701);
  const hair = compBbox(r, 459);
  const body = compBbox(r, 407);
  const coat = compBbox(r, 403);
  console.log(`${label}:`);
  console.log(`  头(${head ? head.join(',') : '无'}) 左耳(${lEar ? lEar.join(',') : '无'}) 右耳(${rEar ? rEar.join(',') : '无'})`);
  console.log(`  右眼(${eye ? eye.join(',') : '无'}) 鼻子(${nose ? nose.join(',') : '无'}) 主发(${hair ? hair.join(',') : '无'})`);
  console.log(`  躯干(${body ? body.join(',') : '无'}) 左大衣(${coat ? coat.join(',') : '无'})`);
}
