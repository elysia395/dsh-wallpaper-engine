// 组件级渲染验证: 渲染后检查每个 image 组件矩形内是否有实际内容(alpha>0)
// 验证修复后组件真正画在了审计预期的位置 (文件级一一对应 + 内容确认)
import fs from 'node:fs';
import path from 'node:path';
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { getVal, parseVec2 } from '../../lib/we-renderer/math.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = process.argv[2] || '3629379075';
const T = parseFloat(process.argv[3] || '2.5');

const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
r._backupScriptValues(); r._restoreScriptValues();
try { (await import('../../lib/scene-scripts.js')).applySceneScripts(r.scene, T); } catch {}
try { r._resolveAnimations(T); } catch {}
r.render();
const d = r.canvas.data;

const sceneW = (r.scene.general?.orthogonalprojection?.width) || 1920;
const sceneH = (r.scene.general?.orthogonalprojection?.height) || 1080;
const ps = [r.W / sceneW, r.H / sceneH];

let empty = 0, total = 0;
for (const o of r.scene.objects) {
  if (!o.image) continue;
  let size = parseVec2(getVal(o, 'size'), [0, 0]);
  if (size[0] === 0 || size[1] === 0) { const tex = r.loadModelTexture(o.image); if (!tex) continue; size = [tex.width, tex.height]; }
  const tr = r.resolveTransform(o);
  const sc = tr.scale;
  const dw = size[0] * sc[0] * ps[0], dh = size[1] * sc[1] * ps[1];
  let dx = tr.origin[0] * ps[0] - dw / 2;
  let dy = r.H - tr.origin[1] * ps[1] - dh / 2;
  const align = String(getVal(o, 'alignment', '')).toLowerCase();
  if (align.includes('top')) dy += dh / 2;
  else if (align.includes('bottom')) dy -= dh / 2;
  if (align.includes('left')) dx += dw / 2;
  else if (align.includes('right')) dx -= dw / 2;
  // 采样矩形内容 (非透明占比)
  const x0 = Math.max(0, Math.floor(Math.min(dx, dx + dw))), x1 = Math.min(r.W, Math.ceil(Math.max(dx, dx + dw)));
  const y0 = Math.max(0, Math.floor(Math.min(dy, dy + dh))), y1 = Math.min(r.H, Math.ceil(Math.max(dy, dy + dh)));
  if (x1 <= x0 || y1 <= y0) { total++; empty++; console.log(`EMPTY-RECT ${o.name} [${o.id}] rect=${dx.toFixed(0)},${dy.toFixed(0)},${dw.toFixed(0)},${dh.toFixed(0)}`); continue; }
  let nz = 0, px = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { px++; if (d[(y * r.W + x) * 4 + 3] > 0) nz++; }
  total++;
  const pct = px ? (nz / px) * 100 : 0;
  const status = pct > 1 ? 'OK ' : 'EMPTY';
  if (pct <= 1) empty++;
  console.log(`${status} ${o.name || o.id} [${o.id}] rect=${dx.toFixed(0)},${dy.toFixed(0)},${dw.toFixed(0)},${dh.toFixed(0)} 内容${pct.toFixed(1)}% align=${align}`);
}
console.log(`\n总计 ${total} 组件, 空内容 ${empty}`);
