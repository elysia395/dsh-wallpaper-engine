// 测试: puppet vs image 是否分别应用视图矩阵
// 假设A: 仅 puppet 应用 -eye (头偏移, 身体不偏移 → 头相对身体上移)
// 假设B: 仅 image 应用 -eye (身体偏移, 头不偏移 → 头相对身体下移?)
// 假设C: 全部应用 (当前, 相对不变)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
function make(mode) {
  const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  const origResolve = r.resolveTransform.bind(r);
  r.resolveTransform = (o) => {
    const tr = origResolve(o);
    if (!this.camEye) return tr;
    const model = (() => { try { return r.readJsonAny(o.image); } catch { return null; } })();
    const isPuppet = !!(model && model.puppet);
    const isBg = (() => {
      const ortho = r.scene.general && r.scene.general.orthogonalprojection;
      const sw = ortho && ortho.width ? ortho.width : r.W;
      const sh = ortho && ortho.height ? ortho.height : r.H;
      const sz = parseVec2(getVal(o, 'size'), [0, 0]);
      return Math.abs(sz[0] - sw) < 1 && Math.abs(sz[1] - sh) < 1;
    })();
    const apply = !isBg && (
      (mode === 'puppetOnly' && isPuppet) ||
      (mode === 'imageOnly' && !isPuppet) ||
      (mode === 'all')
    );
    if (apply) tr.origin = [tr.origin[0] - r.camEye[0], tr.origin[1] - r.camEye[1], tr.origin[2]];
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
// 需要导入
import { getVal, parseVec2 } from '../../lib/we-renderer/math.js';
for (const mode of ['all', 'puppetOnly', 'imageOnly']) {
  const r = make(mode);
  const head = soloBbox(r, 697);
  const body = soloBbox(r, 407);
  const eyeR = soloBbox(r, 295);
  console.log(`${mode}:`);
  console.log(`  头: ${head ? head.join(',') : '无'} 身体: ${body ? body.join(',') : '无'}`);
  if (head && body) console.log(`  头-身体重叠: ${(head[3]-body[1]).toFixed(0)}px`);
  if (head && eyeR) {
    const hc = [(head[0]+head[2])/2, (head[1]+head[3])/2];
    const ec = [(eyeR[0]+eyeR[2])/2, (eyeR[1]+eyeR[3])/2];
    console.log(`  头(${hc[0].toFixed(0)},${hc[1].toFixed(0)}) 右眼(${ec[0].toFixed(0)},${ec[1].toFixed(0)}) dx=${(hc[0]-ec[0]).toFixed(1)} dy=${(hc[1]-ec[1]).toFixed(1)}`);
  }
}
