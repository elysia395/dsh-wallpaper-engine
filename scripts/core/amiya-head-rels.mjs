// 检查 Amiya 组件相对关系: 头 vs 面/发/耳/身体 — 找出可能 100px+ 错位的组件
// 用户原话: "头面发耳错位" — 头/面/发/耳 组件间相对位置
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
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
// 头相关组件
const ids = [697, 295, 329, 459, 421, 407, 439, 192, 201, 205, 209, 214, 218, 222, 466, 373, 389, 411];
const data = {};
for (const id of ids) {
  const o = r.objects.find(x => x.id === id);
  if (!o) continue;
  const tr = r.resolveTransform(o);
  const bb = soloBbox(r, id);
  data[id] = { name: String(o.name || ''), origin: tr.origin, bbox: bb, scale: tr.scale };
  console.log(`id=${id} "${data[id].name}": origin=(${tr.origin[0].toFixed(1)},${tr.origin[1].toFixed(1)}) scale=(${tr.scale[0].toFixed(2)},${tr.scale[1].toFixed(2)}) bbox=${bb ? bb.join(',') : '无'}`);
}
// 头 vs 各组件中心差
if (data[697] && data[697].bbox) {
  const hc = [(data[697].bbox[0]+data[697].bbox[2])/2, (data[697].bbox[1]+data[697].bbox[3])/2];
  for (const id of ids) {
    if (id === 697 || !data[id] || !data[id].bbox) continue;
    const c = [(data[id].bbox[0]+data[id].bbox[2])/2, (data[id].bbox[1]+data[id].bbox[3])/2];
    console.log(`头中心(${hc[0].toFixed(0)},${hc[1].toFixed(0)}) vs ${data[id].name}(id=${id}) 中心(${c[0].toFixed(0)},${c[1].toFixed(0)}): dx=${(hc[0]-c[0]).toFixed(0)} dy=${(hc[1]-c[1]).toFixed(0)}`);
  }
}
