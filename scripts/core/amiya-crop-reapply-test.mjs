// 测试 puppet cropoffset 加回: 头覆盖 + 头面发耳可见性
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(applyCrop) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (applyCrop) {
    // patch renderPuppet: 应用 cropoffset 到网格
    const orig = r.renderPuppet.bind(r);
    const origSkin = r._skinPuppet.bind(r);
    r._skinPuppet = (mesh, t, cxs, cys) => {
      const out = origSkin(mesh, t, 0, 0);
      // cropoffset 在 renderPuppet 里设置
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

// 头区域与 no-coat 的差异
function diffCoverage(r) {
  const r2 = make(false);
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
  return (diff / total * 100).toFixed(1);
}
// 组件内容可见性 (区域非透明)
function compContent(r, x0, y0, x1, y1) {
  const d = r.canvas.data;
  let nz = 0, total = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    total++;
    if (d[(y * r.W + x) * 4 + 3] > 10) nz++;
  }
  return (nz / total * 100).toFixed(0);
}
for (const [label, applyCrop] of [['无crop', false], ['加crop', true]]) {
  const r = make(applyCrop);
  console.log(`=== ${label} ===`);
  console.log(`  头区域被大衣覆盖: ${diffCoverage(r)}%`);
  console.log(`  头(158,266..267,412): ${compContent(r, 158, 266, 267, 412)}%`);
  console.log(`  右眼(222,334..238,350): ${compContent(r, 222, 334, 238, 350)}%`);
  console.log(`  鼻子(213,331..228,350): ${compContent(r, 213, 331, 228, 350)}%`);
}
