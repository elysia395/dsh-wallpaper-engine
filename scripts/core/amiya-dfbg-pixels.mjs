// deep-first-bg-first 头区域像素组成分析
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function make(mode, skip) {
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
  if (skip) for (const o of r.objects) if ([403, 449, 407].includes(o.id)) o.visible = false;
  r.render();
  return r;
}

const full = make('deep-first-bg-first', false);
const noCoat = make('deep-first-bg-first', true);
const onlyHead = (() => {
  const r = make('array', false);
  const sv = new Map();
  for (const oo of r.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
  r.objects.find(x => x.id === 697).visible = true;
  r.render();
  const d = r.canvas.data;
  for (const [oid, v] of sv) { const obj = r.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
  return d;
})();
const dA = full.canvas.data, dB = noCoat.canvas.data;
// 头内容区域 (158,266..267,412)
let sameAsNoCoat = 0, sameAsHead = 0, total = 0;
const rows = [];
for (let y = 266; y <= 412; y++) {
  let rowDiff = 0, rowT = 0;
  for (let x = 158; x <= 267; x++) {
    const i = (y * full.W + x) * 4;
    const dDiff = Math.abs(dA[i]-dB[i]) + Math.abs(dA[i+1]-dB[i+1]) + Math.abs(dA[i+2]-dB[i+2]);
    const hDiff = Math.abs(dA[i]-onlyHead[i]) + Math.abs(dA[i+1]-onlyHead[i+1]) + Math.abs(dA[i+2]-onlyHead[i+2]);
    total++; rowT++;
    if (dDiff < 30) sameAsNoCoat++;
    if (hDiff < 30) sameAsHead++;
    if (dDiff > 60) rowDiff++;
  }
  if (rowDiff / rowT > 0.1) rows.push(`y=${y}: 与无躯干版不同 ${rowDiff}/${rowT}`);
}
console.log(`头区域: 与无躯干版相同 ${(sameAsNoCoat/total*100).toFixed(1)}% 与单头相同 ${(sameAsHead/total*100).toFixed(1)}%`);
rows.slice(0, 20).forEach(s => console.log('  ' + s));
