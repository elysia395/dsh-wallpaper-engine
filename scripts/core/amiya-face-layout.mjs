// Amiya 头面发耳组件内容 bbox 与头的相对关系
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
// 头面发耳相关组件
const targets = [697, 295, 329, 701, 373, 421, 685, 459, 673, 520, 439, 636, 466, 523, 574, 222, 218, 214, 209, 205, 201, 192, 463];
const results = [];
for (const o of r.objects) {
  if (!targets.includes(o.id)) continue;
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
  results.push({ id: o.id, name: String(o.name || ''), bbox: nz ? [minX, minY, maxX, maxY] : null });
}
// 头内容 (基准)
const head = results.find(x => x.id === 697).bbox;
console.log('头内容: (' + head.join(',') + ')');
console.log('---');
for (const x of results) {
  if (x.id === 697) continue;
  const b = x.bbox;
  if (!b) { console.log(x.name + ' [' + x.id + ']: 无内容'); continue; }
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const hc = [(head[0] + head[2]) / 2, (head[1] + head[3]) / 2];
  const rel = (cx - hc[0]).toFixed(0) + ',' + (cy - hc[1]).toFixed(0);
  console.log(x.name.padEnd(8) + ' [' + x.id + '] 内容(' + b.join(',') + ') 中心相对头(' + rel + ')');
}
