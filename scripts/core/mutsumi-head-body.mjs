// 检查另一壁纸 (若叶睦 3629379075) 的头/身体相对位置 — 判断是否为系统性问题
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
function tryRender(id) {
  try {
    const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
    r.render();
    return r;
  } catch (e) { console.log(`  ${id} 渲染失败:`, e.message); return null; }
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
const r = tryRender('3629379075');
if (r) {
  // 找名字含 头/身体 的对象
  const headObjs = r.objects.filter(o => String(o.name||'').includes('头'));
  const bodyObjs = r.objects.filter(o => String(o.name||'').includes('身体') || String(o.name||'').includes('体'));
  console.log('若叶睦: 头对象:', headObjs.map(o=>o.id).join(','), ' 身体对象:', bodyObjs.map(o=>o.id).join(','));
  for (const o of headObjs.slice(0, 3)) {
    const bb = soloBbox(r, o.id);
    console.log(`  头 ${o.id}: bbox=${bb ? bb.join(',') : '无'}`);
  }
  for (const o of bodyObjs.slice(0, 3)) {
    const bb = soloBbox(r, o.id);
    console.log(`  身体 ${o.id}: bbox=${bb ? bb.join(',') : '无'}`);
  }
}
