// 回退后 (无 cropoffset): 顺序测试 — deep-first + 背景最先
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(mode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (mode !== 'array') {
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
    let order;
    if (mode === 'deep-first-bg-first') {
      order = [...r.objects].sort((a, b) => (depth(b) - depth(a)) || (arrIdx.get(a.id) - arrIdx.get(b.id)));
      order = [...order.filter(o => o.id === 314), ...order.filter(o => o.id !== 314)];
    } else if (mode === 'deep-last-bg-first') {
      order = [...r.objects].sort((a, b) => (depth(a) - depth(b)) || (arrIdx.get(a.id) - arrIdx.get(b.id)));
      order = [...order.filter(o => o.id === 314), ...order.filter(o => o.id !== 314)];
    } else if (mode === 'bg-first') {
      order = [...order = r.objects.filter(o => o.id === 314), ...r.objects.filter(o => o.id !== 314)];
    }
    r.renderOrder = order.filter(o => ['image', 'model', 'particle', 'text'].includes(o._renderType));
  }
  r.render();
  return r;
}

function analyze(r, label) {
  // 头内容 (单组件)
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
  console.log(`${label}: 头覆盖 ${(diff/total*100).toFixed(1)}% 头区域=背景 ${(sameBg/total*100).toFixed(1)}%`);
}
for (const mode of ['array', 'deep-first-bg-first', 'deep-last-bg-first', 'bg-first']) {
  try {
    const r = make(mode);
    analyze(r, mode);
  } catch (e) { console.log(mode + ': ERR ' + e.message); }
}
