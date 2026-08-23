// 1) 完整渲染逐层累积, 监控头部区域 (x661-1108, y1071-1648) 的 grey-cyan 像素
// 2) 头模板纹理轮廓分析 (耳朵凸起位置)
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
const { SceneRenderer, encodePng } = await import('../lib/scene-renderer.js');
const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';

const r = new SceneRenderer(PKG, { width: 3840, height: 2160, log: () => {} });
const origReadJson = r.pkg.readJson.bind(r.pkg);
r.pkg.readJson = (p) => {
  const j = origReadJson(p);
  if (j && typeof j === 'object' && 'cropoffset' in j) { const c = { ...j }; delete c.cropoffset; return c; }
  return j;
};

// ── 头模板纹理轮廓分析 ─────────────────────────────
console.log('=== 头模板纹理轮廓 ===');
{
  const texBytes = r.pkg.read('materials/头.tex');
  const { decodeTex } = await import('../lib/pkg-extract.js');
  const dec = decodeTex(texBytes);
  let w, h, d;
  if (dec.kind === 'png-pass') {
    const img = await sharp(dec.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    w = img.info.width; h = img.info.height; d = img.data;
  } else { w = dec.width; h = dec.height; d = dec.rgba; }
  console.log('头纹理:', w, 'x', h);
  // 每 20px 一行的 alpha 左右边界 (轮廓)
  for (let y = 0; y < h; y += 20) {
    let lx = -1, rx = -1;
    for (let x = 0; x < w; x++) if (d[(y*w+x)*4+3] > 16) { lx = x; break; }
    for (let x = w-1; x >= 0; x--) if (d[(y*w+x)*4+3] > 16) { rx = x; break; }
    if (lx >= 0) {
      const widthStr = 'x'.repeat(Math.max(0, Math.round((rx-lx+1)/5)));
      console.log(`y=${String(y).padStart(3)}: [${String(lx).padStart(3)}..${String(rx).padStart(3)}] w=${rx-lx+1} ${widthStr}`);
    }
  }
  // 耳朵凸起检测: 每行宽度 vs 最大宽度, 找"窄-宽-窄"结构的凸起列区间
  console.log('\n耳朵凸起检测 (每行左右边界, 找两侧凸出):');
  let maxL = 999, maxR = -1;
  for (let y = 0; y < h; y++) {
    let lx = -1, rx = -1;
    for (let x = 0; x < w; x++) if (d[(y*w+x)*4+3] > 16) { lx = x; break; }
    for (let x = w-1; x >= 0; x--) if (d[(y*w+x)*4+3] > 16) { rx = x; break; }
    if (lx >= 0) { if (lx < maxL) maxL = lx; if (rx > maxR) maxR = rx; }
  }
  console.log(`最左边界=${maxL}, 最右边界=${maxR}`);
  // 每 10px 输出左右边界变化, 找凸起
  let prevL = -1, prevR = -1;
  for (let y = 0; y < h; y += 10) {
    let lx = -1, rx = -1;
    for (let x = 0; x < w; x++) if (d[(y*w+x)*4+3] > 16) { lx = x; break; }
    for (let x = w-1; x >= 0; x--) if (d[(y*w+x)*4+3] > 16) { rx = x; break; }
    if (lx >= 0) {
      const dl = prevL >= 0 ? lx - prevL : 0;
      const dr = prevR >= 0 ? rx - prevR : 0;
      if (Math.abs(dl) > 3 || Math.abs(dr) > 3) console.log(`y=${y}: L=${lx}(Δ${dl}) R=${rx}(Δ${dr})`);
      prevL = lx; prevR = rx;
    }
  }
}

// ── 完整渲染逐层累积监控头部区域 ─────────────────────
console.log('\n=== 逐层累积: 头部区域 grey-cyan 像素 ===');
const HEAD = { x0: 661, x1: 1108, y0: 1071, y1: 1648 };
function countSlabPixels(canvas) {
  const { data, w } = canvas;
  let n = 0;
  for (let y = HEAD.y0; y <= HEAD.y1; y++) {
    for (let x = HEAD.x0; x <= HEAD.x1; x++) {
      const i = (y*w+x)*4;
      const a = data[i+3];
      if (a > 20) {
        const rr = data[i], g = data[i+1], b = data[i+2];
        // grey-cyan slab 颜色 (96,128,128) ± 50
        if (Math.abs(rr-96)<=50 && Math.abs(g-128)<=50 && Math.abs(b-128)<=50) n++;
      }
    }
  }
  return n;
}
// 找出完整的 image 渲染顺序 (renderOrder 过滤 image)
const imgOrder = r.renderOrder.filter(o => o._renderType === 'image');
const headIdx = imgOrder.findIndex(o => o.id === 697);
console.log('image 对象总数:', imgOrder.length, '头在顺序中位置:', headIdx);
r.canvas.clear();
for (let i = 0; i < imgOrder.length; i++) {
  const o = imgOrder[i];
  try { r.renderImage(o, 0); } catch (e) {}
  if (i <= headIdx || i < headIdx + 15) {
    const n = countSlabPixels(r.canvas);
    console.log(`[${String(i).padStart(3)}] id=${String(o.id).padStart(5)} ${(o.name||'').slice(0,10).padEnd(10)} slabpx=${String(n).padStart(6)}`);
  }
}
fs.writeFileSync('scene-layers-out/part_analysis/fullsize/full_nocrop2.png', encodePng(r.W, r.H, r.canvas.data));
