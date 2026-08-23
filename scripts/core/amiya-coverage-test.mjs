// Amiya 头区域覆盖检测: 全量渲染 vs 跳过右大衣/身体渲染, 对比头区域像素差异
import fs from 'node:fs';
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { getVal, parseVec2 } from '../../lib/we-renderer/math.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';
const T = 2.5;

function make(skip) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
  // 应用脚本/动画
  r._backupScriptValues(); r._restoreScriptValues();
  try { r.render(); } catch {}
  const d = r.canvas.data;
  // 头矩形 (697)
  const head = r.scene.objects.find(o => o.id === 697);
  const sceneW = r.scene.general.orthogonalprojection.width, sceneH = r.scene.general.orthogonalprojection.height;
  const ps = [r.W / sceneW, r.H / sceneH];
  const size = parseVec2(getVal(head, 'size'), [0, 0]);
  const tr = r.resolveTransform(head);
  const dw = size[0] * tr.scale[0] * ps[0], dh = size[1] * tr.scale[1] * ps[1];
  const dx = tr.origin[0] * ps[0] - dw / 2;
  const dy = r.H - tr.origin[1] * ps[1] - dh / 2;
  return { r, d, headRect: { x: dx, y: dy, w: dw, h: dh }, sceneW, sceneH, ps };
}

// 方案A: 全量渲染
const A = make(true);
// 方案B: 把右大衣(449)/身体(407) visible 设为 false
const B = make(true);
for (const o of B.r.scene.objects) {
  if (o.id === 449 || o.id === 407) o.visible = false;
}
B.r.render();
const bd = B.r.canvas.data;

const hx = A.headRect;
console.log(`头矩形: ${hx.x.toFixed(0)},${hx.y.toFixed(0)},${hx.w.toFixed(0)},${hx.h.toFixed(0)}`);
// 逐行统计头区域差异 (A 有内容而 B 无 → 被大衣覆盖)
let covered = 0, total = 0;
const rows = [];
for (let y = Math.floor(hx.y); y < Math.ceil(hx.y + hx.h); y++) {
  if (y < 0 || y >= A.r.H) continue;
  let rowCov = 0, rowT = 0;
  for (let x = Math.floor(hx.x); x < Math.ceil(hx.x + hx.w); x++) {
    if (x < 0 || x >= A.r.W) continue;
    rowT++;
    const ai = (y * A.r.W + x) * 4;
    const bi = (y * A.r.W + x) * 4;
    const aA = A.d[ai + 3], aB = bd[bi + 3];
    const diff = Math.abs(A.d[ai] - bd[bi]) + Math.abs(A.d[ai+1] - bd[bi+1]) + Math.abs(A.d[ai+2] - bd[bi+2]);
    if (aA > 0 && aB === 0) { covered++; rowCov++; }  // A 有 B 无 → 被遮
    else if (diff > 60) { covered++; rowCov++; }      // 颜色显著不同 → 被遮
    total++;
  }
  if (rowT > 0 && rowCov / rowT > 0.05) rows.push(`  y=${y} 行被遮 ${rowCov}/${rowT} (${((rowCov / rowT) * 100).toFixed(0)}%)`);
}
console.log(`头区域总像素 ${total}, 被右大衣/身体覆盖 ${covered} (${((covered / total) * 100).toFixed(1)}%)`);
rows.slice(0, 25).forEach(s => console.log(s));
// 头部 x 范围统计
console.log('头部 y 范围: ' + Math.floor(hx.y) + '..' + Math.ceil(hx.y + hx.h));
