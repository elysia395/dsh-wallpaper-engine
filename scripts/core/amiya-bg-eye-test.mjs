// 决定性行为测试: 官方 MVP = ortho × lookAt (eye 平移), 背景对象 (size==场景) 跳过
// 期望: 背景满屏, 头相对背景偏移 +180/+134.8px (eye lookAt 平移)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
import { getVal, parseVec2 } from '../../lib/we-renderer/math.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';

function make(mode) {
  const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  // 判断背景: size == 场景尺寸 (ortho) 且 origin == 场景中心
  const ortho = r.scene.general && r.scene.general.orthogonalprojection;
  const sw = ortho && ortho.width ? ortho.width : r.W;
  const sh = ortho && ortho.height ? ortho.height : r.H;
  const origResolve = r.resolveTransform.bind(r);
  r.resolveTransform = (o) => {
    const tr = origResolve(o);
    if (mode === 'none') return tr;
    // 背景判定: 对象 size == 场景尺寸 (解析数值)
    const sz = parseVec2(getVal(o, 'size'), [0, 0]);
    const isBg = Math.abs(sz[0] - sw) < 1 && Math.abs(sz[1] - sh) < 1;
    if (!isBg && mode === 'non-bg+eye') {
      tr.origin = [tr.origin[0] + 360, tr.origin[1] + 269.56, tr.origin[2]];
    } else if (mode === 'all+eye') {
      tr.origin = [tr.origin[0] + 360, tr.origin[1] + 269.56, tr.origin[2]];
    }
    return tr;
  };
  r.render();
  return r;
}
function soloBbox(r, oid) {
  const o = r.objects.find(x => x.id === oid);
  if (!o) return null;
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
  for (const [oid2, v] of sv) { const obj = r.objects.find(x => x.id === oid2); if (obj) obj.visible = v; }
  return nz ? [minX,minY,maxX,maxY] : null;
}
for (const mode of ['none', 'non-bg+eye', 'all+eye']) {
  const r = make(mode);
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_${mode}_1080.png`, png);
  const head = soloBbox(r, 697);
  const bg = soloBbox(r, 314);
  const clock = soloBbox(r, 394);
  console.log(`${mode}:`);
  console.log(`  背景: ${bg ? bg.join(',') : '无'} 铺满=${bg ? (bg[0]<=1&&bg[1]<=1&&bg[2]>=r.W-2&&bg[3]>=r.H-2) : false}`);
  console.log(`  头: ${head ? head.join(',') : '无'} 中心=${head ? `(${((head[0]+head[2])/2).toFixed(0)},${((head[1]+head[3])/2).toFixed(0)})` : ''}`);
  console.log(`  Clock: ${clock ? clock.join(',') : '无'} 中心=${clock ? `(${((clock[0]+clock[2])/2).toFixed(0)},${((clock[1]+clock[3])/2).toFixed(0)})` : ''}`);
}
