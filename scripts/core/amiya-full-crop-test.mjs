// 完整 cropoffset 测试: puppet 网格 + 普通 image quad 都应用
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(mode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  // puppet: cropoffset 加到网格
  const orig = r.renderPuppet.bind(r);
  const origSkin = r._skinPuppet.bind(r);
  r._skinPuppet = (mesh, t, cxs, cys) => {
    const out = origSkin(mesh, t, 0, 0);
    const crop = r._curCrop;
    if (crop) for (const p of out) { p[0] += crop[0]; p[1] += crop[1]; }
    return out;
  };
  r.renderPuppet = (o, model, tr, t) => {
    if (model && model.cropoffset) {
      const [cx, cy] = model.cropoffset.trim().split(/\s+/).map(Number);
      r._curCrop = [cx, cy];
    } else r._curCrop = null;
    return orig(o, model, tr, t);
  };
  // 普通 image: cropoffset 偏移 origin
  const origImg = r.renderImage.bind(r);
  r.renderImage = (o, t2) => {
    const model = o.image ? r.readJsonAny(o.image) : null;
    if (model && model.cropoffset && !model.puppet && mode === 'full') {
      const [cx, cy] = model.cropoffset.trim().split(/\s+/).map(Number);
      const cur = String(o.origin || '0 0 0').trim().split(/\s+/).map(Number);
      o._savedOrigin = o.origin;
      o.origin = `${cur[0] + cx} ${cur[1] + cy} ${cur[2] || 0}`;
    }
    const res = origImg(o, t2);
    if (o._savedOrigin) { o.origin = o._savedOrigin; delete o._savedOrigin; }
    return res;
  };
  r.render();
  return r;
}

function compBbox(r, oid) {
  const o = r.objects.find(x => x.id === oid);
  const saveVis = new Map();
  for (const oo of r.objects) { saveVis.set(oo.id, oo.visible); oo.visible = false; }
  o.visible = true;
  r.render();
  const d = r.canvas.data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, nz = 0;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
    const i = (y * r.W + x) * 4;
    if (d[i + 3] > 10) { nz++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  for (const [oid2, v] of saveVis) { const obj = r.objects.find(x => x.id === oid2); if (obj) obj.visible = v; }
  return nz ? [minX, minY, maxX, maxY] : null;
}

for (const [label, mode] of [['当前(无crop)', 'none'], ['puppet+crop', 'puppet'], ['完整crop', 'full']]) {
  const r = make(mode);
  // 头覆盖
  const r2 = make('none');
  for (const o of r2.objects) if ([403, 449, 407].includes(o.id)) o.visible = false;
  r2.render();
  const dA = r.canvas.data, dB = r2.canvas.data;
  let diff = 0, total = 0;
  for (let y = 266; y <= 412; y++) for (let x = 158; x <= 267; x++) {
    const i = (y * r.W + x) * 4;
    const dd = Math.abs(dA[i]-dB[i]) + Math.abs(dA[i+1]-dB[i+1]) + Math.abs(dA[i+2]-dB[i+2]);
    if (dA[i+3] > 0 && (dB[i+3] === 0 || dd > 60)) diff++;
    total++;
  }
  const cov = (diff / total * 100).toFixed(1);
  const head = compBbox(r, 697);
  const lEar = compBbox(r, 685);
  const rEar = compBbox(r, 421);
  const coat = compBbox(r, 403);
  const body = compBbox(r, 407);
  console.log(`${label}: 头覆盖 ${cov}% 头(${head ? head.join(',') : '无'}) 左耳(${lEar ? lEar.join(',') : '无'}) 右耳(${rEar ? rEar.join(',') : '无'}) 左大衣(${coat ? coat.join(',') : '无'}) 躯干(${body ? body.join(',') : '无'})`);
}
