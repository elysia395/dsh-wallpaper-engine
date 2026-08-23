// 分层诊断: 无 cropoffset, 逐层渲染 Amiya 人物各部件, 输出每层画布 bbox
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const { SceneRenderer, encodePng } = await import('../lib/scene-renderer.js');
const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';

const r = new SceneRenderer(PKG, { width: 1920, height: 1080, log: () => {} });

// 去掉所有模型的 cropoffset (证据: cropoffset 不是场景位移)
const origReadJson = r.pkg.readJson.bind(r.pkg);
r.pkg.readJson = (p) => {
  const j = origReadJson(p);
  if (j && typeof j === 'object' && 'cropoffset' in j) { const c = { ...j }; delete c.cropoffset; return c; }
  return j;
};

// 1) dump 人物 (53) 子树
console.log('=== 人物 (53) 子树 ===');
function dumpTree(o, depth) {
  const pad = '  '.repeat(depth);
  const img = o.image || '';
  console.log(`${pad}${o.id} ${o.name||''} image=${img} parent=${o.parent}`);
  for (const l of o.layers || []) dumpTree(l, depth + 1);
}
const person = r.objects.find(o => o.id === 53);
if (person) dumpTree(person, 0);
// scene.json 顶层对象里有 layers 吗? 没有的话按 parent 找
console.log('\n=== 按 parent 找 53 的后代 (顶层对象) ===');
for (const o of r.objects) {
  if (o.parent === 53) console.log(`  ${o.id} ${o.name||''} image=${o.image||''}`);
}

// 2) 逐层渲染工具
const OUT = 'scene-layers-out/part_analysis/layerdiag/';
fs.mkdirSync(OUT, { recursive: true });
async function renderLayers(label, ids) {
  r.canvas.clear();
  // 只渲染指定 id 的 image 对象 (按 renderOrder 顺序)
  for (const o of r.renderOrder) {
    if (ids.includes(o.id) && o._renderType === 'image') {
      try { r.renderImage(o, 0); } catch (e) { console.log(`  渲染 ${o.id} 失败: ${e.message}`); }
    }
  }
  // bbox
  const { data } = r.canvas;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
    if (data[(y*r.W+x)*4+3] > 8) {
      count++;
      if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y;
    }
  }
  const png = encodePng(r.W, r.H, data);
  fs.writeFileSync(OUT + label + '.png', png);
  const bbox = count ? `x[${minX},${maxX}] y[${minY},${maxY}] (${maxX-minX+1}x${maxY-minY+1}) px=${count}` : '空';
  console.log(`${label}: ${bbox}`);
  return { minX, minY, maxX, maxY };
}

// 3) 渲染组合
// 头 #697 (无 cropoffset)
await renderLayers('head_only', [697]);
// 头 + 五官 (眼眉鼻)
await renderLayers('head_face', [697, 329, 295, 373, 701]);
// 头 + 五官 + 后发 4125? + 头发 463 (463 是 unknown 跳过) — 先看子树结果再定
console.log('\n完成。输出在 ' + OUT);
