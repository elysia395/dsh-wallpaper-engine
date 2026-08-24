// Amiya 头形(697网格) 与面部组件对齐诊断
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();

function compBbox(r, oid) {
  const o = r.objects.find(x => x.id === oid);
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
  return nz ? { bbox: [minX,minY,maxX,maxY], center: [(minX+maxX)/2, (minY+maxY)/2] } : null;
}

const comps = {
  697: '头(光滑头部)',
  494: '五官组(不渲染)',
  295: '右眼', 329: '左眼', 701: '鼻子', 373: '眉毛',
  421: '右耳', 685: '左耳',
  463: '头发组(不渲染)',
  459: '主发', 439: '呆毛',
};
const results = {};
for (const [oid, name] of Object.entries(comps)) {
  const c = compBbox(r, Number(oid));
  results[oid] = c;
  if (c) console.log(`${name} [${oid}]: bbox(${c.bbox.join(',')}) 中心(${c.center[0].toFixed(1)},${c.center[1].toFixed(1)})`);
  else console.log(`${name} [${oid}]: 无内容`);
}
// 头形中心 vs 各组件中心差
const headC = results[697]?.center;
if (headC) {
  console.log('\n头形中心相对各组件的偏移 (组件 - 头形):');
  for (const [oid, name] of Object.entries(comps)) {
    if (oid === '697') continue;
    const c = results[oid];
    if (!c) continue;
    const dx = c.center[0] - headC[0], dy = c.center[1] - headC[1];
    console.log(`  ${name}: dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
  }
}
