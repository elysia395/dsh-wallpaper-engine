// Amiya puppet cropoffset 方向测试: 正/反/无 三种, 检查头覆盖 + 布局
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function renderWithCropMode(cropMode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  // 拦截 renderPuppet: 对 model.cropoffset 应用 (方向由 cropMode 决定)
  const orig = r.renderPuppet.bind(r);
  r.renderPuppet = (o, model, tr, t) => {
    if (cropMode !== 'none' && model && model.cropoffset) {
      const [cx, cy] = model.cropoffset.trim().split(/\s+/).map(Number);
      const sign = cropMode === 'reverse' ? -1 : 1;
      const origMesh = r._mdlCache.get(model.puppet);
      if (origMesh) {
        // 临时: 在 _skinPuppet 结果上偏移 — 改为偏移 skinned 结果
        // 简化: 直接改 tr.origin? 不 — 网格偏移
        // 用临时字段传给 renderPuppet 内部逻辑: patch _skinPuppet
        r._puppetCrop = [cx * sign, cy * sign];
      }
    }
    return orig(o, model, tr, t);
  };
  // patch _skinPuppet 加 cropoffset
  const origSkin = r._skinPuppet.bind(r);
  r._skinPuppet = (mesh, t2, cxs, cys) => {
    const out = origSkin(mesh, t2, 0, 0);
    const crop = r._puppetCrop;
    if (crop) {
      for (const p of out) { p[0] += crop[0]; p[1] += crop[1]; }
    }
    return out;
  };
  r.render();
  return r;
}

function headCoverage(r) {
  const r2 = renderWithCropMode('none-skip');
  // 跳过 449/407/403
  for (const o of r2.objects) if ([449, 407, 403].includes(o.id)) o.visible = false;
  r2.render();
  const dA = r.canvas.data, dB = r2.canvas.data;
  let covered = 0, total = 0;
  for (let y = 266; y <= 412; y++) for (let x = 158; x <= 267; x++) {
    const i = (y * r.W + x) * 4;
    const aA = dA[i + 3], aB = dB[i + 3];
    const diff = Math.abs(dA[i] - dB[i]) + Math.abs(dA[i+1] - dB[i+1]) + Math.abs(dA[i+2] - dB[i+2]);
    if (aA > 0 && (aB === 0 || diff > 60)) covered++;
    total++;
  }
  return (covered / total * 100).toFixed(1);
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

for (const mode of ['none', 'apply', 'reverse']) {
  const r = renderWithCropMode(mode);
  const cov = headCoverage(r);
  const head = compBbox(r, 697);
  console.log(`${mode}: 头覆盖 ${cov}% 头内容 ${head ? head.join(',') : '无'}`);
}
