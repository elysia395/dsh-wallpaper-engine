// 测试 autosort 假设: 同一父下的子按 origin.y 排序 (y 小先渲染)
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(mode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (mode !== 'array') {
    const originY = (o) => {
      const s = String(o.origin || '0 0 0').trim().split(/\s+/).map(Number);
      return s[1] || 0;
    };
    // 分组: 根对象 (无 parent) 保持数组顺序; 同父子按 origin.y 排序
    const byParent = new Map();
    for (const o of r.objects) {
      const key = o.parent == null ? 'root' : 'p' + o.parent;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(o);
    }
    const order = [];
    for (const o of r.objects) {
      if (o.parent == null) order.push(o); // 根按数组顺序
    }
    // 非根: 按父分组排序后输出 (保持父出现的顺序, 组内按 y 排序)
    const parentOrder = [];
    for (const o of r.objects) {
      if (o.parent != null && !parentOrder.includes(o.parent)) parentOrder.push(o.parent);
    }
    for (const pid of parentOrder) {
      const group = byParent.get('p' + pid);
      if (mode === 'autosort-y') group.sort((a, b) => originY(a) - originY(b));
      else if (mode === 'autosort-y-rev') group.sort((a, b) => originY(b) - originY(a));
      else if (mode === 'autosort-x') {
        const originX = (o) => Number(String(o.origin || '0 0 0').trim().split(/\s+/)[0] || 0);
        group.sort((a, b) => originX(a) - originX(b));
      }
      order.push(...group);
    }
    r.renderOrder = order.filter(o => ['image', 'model', 'particle', 'text'].includes(o._renderType));
  }
  r.render();
  return r;
}

function analyze(r, label) {
  // 头内容 (动态)
  const head = (() => {
    const sv = new Map();
    for (const oo of r.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
    const h = r.objects.find(x => x.id === 697);
    h.visible = true;
    r.render();
    const d = r.canvas.data;
    let minX=1e9,minY=1e9,maxX=-1,maxY=-1;
    for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
      const i = (y*r.W+x)*4;
      if (d[i+3] > 10) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
    for (const [oid, v] of sv) { const obj = r.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
    return [minX,minY,maxX,maxY];
  })();
  // 完整 vs 无躯干 (同顺序)
  const r2 = make(label === 'array' ? 'array' : label);
  for (const o of r2.objects) if ([403, 449, 407].includes(o.id)) o.visible = false;
  r2.render();
  const dA = r.canvas.data, dB = r2.canvas.data;
  let diff = 0, total = 0;
  for (let y = head[1]; y <= head[3]; y++) for (let x = head[0]; x <= head[2]; x++) {
    const i = (y*r.W+x)*4;
    const dd = Math.abs(dA[i]-dB[i]) + Math.abs(dA[i+1]-dB[i+1]) + Math.abs(dA[i+2]-dB[i+2]);
    if (dA[i+3] > 0 && (dB[i+3] === 0 || dd > 60)) diff++;
    total++;
  }
  // 背景是否盖头
  const r3 = make(label === 'array' ? 'array' : label);
  for (const o of r3.objects) if (o.id !== 314) o.visible = false;
  r3.render();
  const dBG = r3.canvas.data;
  let sameBg = 0;
  for (let y = head[1]; y <= head[3]; y++) for (let x = head[0]; x <= head[2]; x++) {
    const i = (y*r.W+x)*4;
    const dd = Math.abs(dA[i]-dBG[i]) + Math.abs(dA[i+1]-dBG[i+1]) + Math.abs(dA[i+2]-dBG[i+2]);
    if (dd < 30) sameBg++;
  }
  console.log(`${label}: 头覆盖 ${(diff/total*100).toFixed(1)}% 头=背景 ${(sameBg/total*100).toFixed(1)}%`);
}
for (const mode of ['array', 'autosort-y', 'autosort-y-rev', 'autosort-x']) {
  try {
    const r = make(mode);
    analyze(r, mode);
  } catch (e) { console.log(mode + ': ERR ' + e.message); }
}
