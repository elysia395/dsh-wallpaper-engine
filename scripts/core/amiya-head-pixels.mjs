// Amiya 头区域像素组成分析: 完整帧 vs 只头 vs 只躯干
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function render(visibleIds, hiddenIds) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (visibleIds) {
    for (const o of r.objects) o.visible = false;
    for (const o of r.objects) if (visibleIds.includes(o.id)) o.visible = true;
  }
  if (hiddenIds) for (const o of r.objects) if (hiddenIds.includes(o.id)) o.visible = false;
  r.render();
  return r;
}

// 头面发耳 (697 头 + 463 头发组 + 眼睛/鼻子/眉毛/耳朵/刘海) + 身体467
const headParts = [697, 463, 295, 701, 329, 373, 421, 685, 459, 673, 520, 439, 636, 466, 523, 574, 222, 218, 214, 209, 205, 201, 192];
const bodyParts = [449, 407, 403, 547];
const torso = [528, 467, 411, 513, 593, 536, 535, 389, 361, 159];

// A: 完整帧
const A = render(null, null);
// B: 只头面发耳
const B = render(headParts, null);
// C: 只躯干大衣
const C = render(bodyParts.concat([528, 467]), null);

const dA = A.canvas.data, dB = B.canvas.data, dC = C.canvas.data;
// 头内容区域 y[266,412] x[158,267] 逐像素: 属于头/躯干/两者
let headOnly = 0, bodyOnly = 0, both = 0, none = 0;
const rows = [];
for (let y = 266; y <= 412; y++) {
  let rowHead = 0, rowBody = 0, rowT = 0;
  for (let x = 158; x <= 267; x++) {
    const i = (y * A.W + x) * 4;
    const inB = dB[i + 3] > 10;
    const inC = dC[i + 3] > 10;
    rowT++;
    if (inB && inC) { both++; rowHead++; rowBody++; }
    else if (inB) { headOnly++; rowHead++; }
    else if (inC) { bodyOnly++; rowBody++; }
    else none++;
  }
  if (rowT > 0) rows.push(`y=${y}: 头${rowHead}/${rowT} 躯干${rowBody}/${rowT}`);
}
console.log(`头区域 (266-412): 只有头 ${headOnly} 只有躯干 ${bodyOnly} 两者 ${both} 无 ${none}`);
rows.filter(r2 => r2.includes('躯干')).slice(0, 40).forEach(s => console.log('  ' + s));
// 保存完整帧
const png = encodeApng(A.W, A.H, [{ rgba: A.canvas.data, delayMs: 100 }]);
fs.writeFileSync('scripts/out/amiya_full_960_sf18.png', png);
console.log('完整帧保存 scripts/out/amiya_full_960_sf18.png');
