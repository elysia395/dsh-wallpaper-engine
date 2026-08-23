// 对比 head_only vs head_face 像素差异 + 单独渲染五官, 开启日志
import fs from 'fs';
const { SceneRenderer, encodePng } = await import('../lib/scene-renderer.js');
const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const logs = [];
const r = new SceneRenderer(PKG, { width: 3840, height: 2160, log: (m) => logs.push(m) });
const origReadJson = r.pkg.readJson.bind(r.pkg);
r.pkg.readJson = (p) => {
  const j = origReadJson(p);
  if (j && typeof j === 'object' && 'cropoffset' in j) { const c = { ...j }; delete c.cropoffset; return c; }
  return j;
};
const OUT = 'scene-layers-out/part_analysis/fullsize/';

function bboxOf(canvas) {
  const { data, w, h } = canvas;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y*w+x)*4+3] > 8) {
      count++;
      if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y;
    }
  }
  return count ? `x[${minX},${maxX}] y[${minY},${maxY}] (${maxX-minX+1}x${maxY-minY+1}) px=${count}` : '空';
}
function renderIds(ids) {
  r.canvas.clear();
  logs.length = 0;
  for (const o of r.renderOrder) {
    if (ids.includes(o.id) && o._renderType === 'image') {
      try { r.renderImage(o, 0); } catch (e) { logs.push(`${o.id} 异常: ${e.message}`); }
    }
  }
  return logs.slice();
}
function diffPixels(a, b) {
  let n = 0; let minX=1e9,minY=1e9,maxX=-1,maxY=-1;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i]!==b.data[i] || a.data[i+1]!==b.data[i+1] || a.data[i+2]!==b.data[i+2] || a.data[i+3]!==b.data[i+3]) {
      n++; const x = (i/4)%a.w, y = Math.floor((i/4)/a.w);
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
  }
  return n ? `${n}px x[${minX},${maxX}] y[${minY},${maxY}]` : '无差异';
}

// 1) head_only
const r1 = renderIds([697]);
fs.writeFileSync(OUT + 'head_only.png', encodePng(r.W, r.H, r.canvas.data));
const headBbox = bboxOf(r.canvas);
console.log('head_only:', headBbox);
// 2) head_face
renderIds([697, 329, 295, 373, 701]);
fs.writeFileSync(OUT + 'head_face.png', encodePng(r.W, r.H, r.canvas.data));
const faceBbox = bboxOf(r.canvas);
console.log('head_face:', faceBbox);
// 用保存的 buffer 重新比较
const headPng = fs.readFileSync(OUT + 'head_only.png');
const facePng = fs.readFileSync(OUT + 'head_face.png');
// 直接 decode 对比 — 用 sharp
const { createRequire } = await import('module');
const req = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = req('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
const hd = await sharp(headPng).raw().toBuffer({ resolveWithObject: true });
const fd = await sharp(facePng).raw().toBuffer({ resolveWithObject: true });
console.log('diff head_only vs head_face:', diffPixels(hd, fd));
// 3) 五官单独
const r3 = renderIds([329, 295, 373, 701]);
console.log('五官日志:', r3);
fs.writeFileSync(OUT + 'face_only.png', encodePng(r.W, r.H, r.canvas.data));
console.log('face_only:', bboxOf(r.canvas));
// 4) 头 + 五官 + 头发463 + 后发4125
const r4 = renderIds([697, 329, 295, 373, 701, 463, 4125]);
console.log('带发日志:', r4.filter(l => l.includes('失败') || l.includes('异常') || l.includes('跳过')));
fs.writeFileSync(OUT + 'head_hair.png', encodePng(r.W, r.H, r.canvas.data));
console.log('head_hair:', bboxOf(r.canvas));
