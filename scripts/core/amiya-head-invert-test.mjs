// 只对头(697) 应用 cropoffset 取反 (网格 = raw - crop): 头上移+右移, 大衣不动
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(headCropMode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (headCropMode !== 'none') {
    const orig = r.renderPuppet.bind(r);
    const origSkin = r._skinPuppet.bind(r);
    r._skinPuppet = (mesh, t, cxs, cys) => {
      const out = origSkin(mesh, t, 0, 0);
      const crop = r._curCrop;
      if (crop) for (const p of out) { p[0] += crop[0]; p[1] += crop[1]; }
      return out;
    };
    r.renderPuppet = (o, model, tr, t) => {
      // 只对 697 (头) 应用 cropoffset 取反
      if (o.id === 697 && model && model.cropoffset) {
        const [cx, cy] = model.cropoffset.trim().split(/\s+/).map(Number);
        r._curCrop = [-cx, -cy]; // 取反
      } else r._curCrop = null;
      return orig(o, model, tr, t);
    };
  }
  r.render();
  return r;
}

// 版本: none (回退当前) / head-invert (头取反)
for (const [label, mode] of [['回退当前', 'none'], ['头crop取反', 'head-invert']]) {
  const r = make(mode);
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_${mode === 'none' ? 'reverted2' : 'head_invert'}.png`, png);
  // 头内容位置
  const o = r.objects.find(x => x.id === 697);
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
  console.log(`${label}: 头内容 ${nz ? minX+','+minY+'..'+maxX+','+maxY : '无'}`);
}
console.log('帧已保存: scripts/out/amiya_reverted2.png, amiya_head_invert.png');
