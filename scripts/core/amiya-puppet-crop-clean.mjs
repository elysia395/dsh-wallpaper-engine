// puppet cropoffset 生效版: 动态头区域覆盖检测 + 整体布局
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(puppetCrop) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (puppetCrop) {
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
  }
  r.render();
  return r;
}

// 动态测: 头组件内容区域被躯干/大衣覆盖
function dynCoverage(r) {
  // 头内容 bbox (单组件)
  const head = (() => {
    const saveVis = new Map();
    for (const oo of r.objects) { saveVis.set(oo.id, oo.visible); oo.visible = false; }
    const h = r.objects.find(x => x.id === 697);
    h.visible = true;
    r.render();
    const d = r.canvas.data;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
      const i = (y * r.W + x) * 4;
      if (d[i+3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    for (const [oid, v] of saveVis) { const obj = r.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
    return [minX, minY, maxX, maxY];
  })();
  // 跳过躯干/大衣版 (同 puppetCrop 设置)
  const r2 = make(r._puppetCropOn);
  for (const o of r2.objects) if ([403, 449, 407].includes(o.id)) o.visible = false;
  r2.render();
  const dA = r.canvas.data, dB = r2.canvas.data;
  let diff = 0, total = 0;
  for (let y = head[1]; y <= head[3]; y++) for (let x = head[0]; x <= head[2]; x++) {
    const i = (y * r.W + x) * 4;
    const dd = Math.abs(dA[i]-dB[i]) + Math.abs(dA[i+1]-dB[i+1]) + Math.abs(dA[i+2]-dB[i+2]);
    if (dA[i+3] > 0 && (dB[i+3] === 0 || dd > 60)) diff++;
    total++;
  }
  return { cov: (diff / total * 100).toFixed(1), head };
}
for (const [label, crop] of [['当前(无puppet crop)', false], ['puppet crop生效', true]]) {
  const r = make(crop);
  r._puppetCropOn = crop;
  const { cov, head } = dynCoverage(r);
  console.log(`${label}: 头内容(${head.join(',')}) 被躯干/大衣覆盖 ${cov}%`);
}
