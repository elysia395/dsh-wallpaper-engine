// 若叶睦组件内容重叠检测: 找内容 bbox 高度重叠的组件组
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3629379075/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });

// 每个 image 组件内容 bbox
const boxes = [];
for (const o of r.objects) {
  if (!o.image) continue;
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
  for (const [oid, v] of saveVis) { const obj = r.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
  if (nz > 0) boxes.push({ id: o.id, name: String(o.name || ''), bbox: [minX, minY, maxX, maxY], area: (maxX - minX + 1) * (maxY - minY + 1) });
}
// 重叠检测 (内容 bbox 重叠 > 60% 面积的组件对)
console.log('内容重叠 > 60% 的组件组:');
const groups = [];
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.max(0, Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]));
    const oy = Math.max(0, Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]));
    const inter = ox * oy;
    const minArea = Math.min(a.area, b.area);
    if (minArea > 0 && inter / minArea > 0.6) {
      console.log(`  ${a.name} [${a.id}] 与 ${b.name} [${b.id}] 重叠 ${((inter / minArea) * 100).toFixed(0)}% (${a.bbox.join(',')} vs ${b.bbox.join(',')})`);
    }
  }
}
console.log('组件总数: ' + boxes.length);
