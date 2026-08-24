// deep-first-bg-first 完整渲染: 各组件可见性检查
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(mode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (mode === 'deep-first-bg-first') {
    const depth = (o) => {
      let d = 0, cur = o, guard = 0;
      while (cur.parent != null && guard < 30) {
        const p = r.objects.find(x => x.id === cur.parent);
        if (!p) break;
        cur = p; d++; guard++;
      }
      return d;
    };
    const arrIdx = new Map(r.objects.map((o, i) => [o.id, i]));
    let order = [...r.objects].sort((a, b) => (depth(b) - depth(a)) || (arrIdx.get(a.id) - arrIdx.get(b.id)));
    order = [...order.filter(o => o.id === 314), ...order.filter(o => o.id !== 314)];
    r.renderOrder = order.filter(o => ['image', 'model', 'particle', 'text'].includes(o._renderType));
  }
  r.render();
  return r;
}

// 检查组件内容可见性: 该组件区域在完整帧里的非透明像素
function visibleContent(r, oid) {
  // 先取单组件 bbox
  const o = r.objects.find(x => x.id === oid);
  const sv = new Map();
  for (const oo of r.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
  o.visible = true;
  r.render();
  const d = r.canvas.data;
  let minX=1e9,minY=1e9,maxX=-1,maxY=-1;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
    const i = (y*r.W+x)*4;
    if (d[i+3] > 10) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  for (const [oid2, v] of sv) { const obj = r.objects.find(x => x.id === oid2); if (obj) obj.visible = v; }
  if (minX === 1e9) return null;
  // 完整帧里该区域的非透明像素 (任何组件画的)
  const fullD = r.canvas.data;
  let nz = 0, total = 0;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    total++;
    if (fullD[(y*r.W+x)*4+3] > 10) nz++;
  }
  return { bbox: [minX,minY,maxX,maxY], pct: (nz/total*100).toFixed(0) };
}

for (const mode of ['array', 'deep-first-bg-first']) {
  const r = make(mode);
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_${mode === 'array' ? 'arr' : 'dfbg'}_960.png`, png);
  console.log(`=== ${mode} ===`);
  for (const [oid, nm] of [[697,'头'],[295,'右眼'],[329,'左眼'],[701,'鼻子'],[373,'眉毛'],[421,'右耳'],[685,'左耳'],[459,'主发'],[439,'呆毛']]) {
    const c = visibleContent(r, oid);
    console.log(`  ${nm}[${oid}]: ${c ? `内容${c.pct}% ${c.bbox.join(',')}` : '无'}`);
  }
}
