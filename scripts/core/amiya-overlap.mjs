// 对比 sf20(无eye) vs sf21(-eye): 头/身体/右眼 bbox 与重叠
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
function make(eye) {
  const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  if (!eye) {
    // 禁用 -eye: 临时置零 camEye
    const origSetup = r._setupCamera.bind(r);
    r._setupCamera = function() { origSetup(); this.camEye = [0,0,0]; };
  }
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
for (const [label, eye] of [['sf20(无eye)', false], ['sf21(-eye)', true]]) {
  const r = make(eye);
  const head = soloBbox(r, 697);
  const body = soloBbox(r, 407);
  const eyeR = soloBbox(r, 295);
  console.log(`${label}:`);
  console.log(`  头: ${head ? head.join(',') : '无'} 底部=${head ? head[3] : '-'}`);
  console.log(`  身体: ${body ? body.join(',') : '无'} 顶部=${body ? body[1] : '-'}`);
  if (head && body) {
    const overlap = head[3] - body[1];
    console.log(`  重叠(头底部-身体顶部): ${overlap.toFixed(0)}px ${overlap > 0 ? '→ 身体盖住头' : '→ 无重叠'}`);
  }
  if (head && eyeR) {
    const hc = [(head[0]+head[2])/2, (head[1]+head[3])/2];
    const ec = [(eyeR[0]+eyeR[2])/2, (eyeR[1]+eyeR[3])/2];
    console.log(`  头中心(${hc[0].toFixed(0)},${hc[1].toFixed(0)}) 右眼(${ec[0].toFixed(0)},${ec[1].toFixed(0)}) dx=${(hc[0]-ec[0]).toFixed(0)} dy=${(hc[1]-ec[1]).toFixed(0)}`);
  }
}
