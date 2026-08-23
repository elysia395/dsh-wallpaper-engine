// 分析 preview 头部区域: 找眼睛(暗点) 和 头部模板(灰青平坦区), 量化头眼相对位置
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const f0 = fs.readFileSync('scene-layers-out/part_analysis/preview_f0.png');
const { data, info } = await sharp(f0).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height; // 220x220

// 字符区域: 行42-210, 列8-164 (边缘检测结果)
// 头部 = 字符顶部 ~45%: y42..~117
const HEAD_Y0 = 42, HEAD_Y1 = 120;

// 1) 暗点 (眼睛候选): 亮度低
const dark = [];
for (let y = HEAD_Y0; y < HEAD_Y1; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y*W+x)*4;
    if (data[i+3] > 200 && data[i]+data[i+1]+data[i+2] < 260) dark.push([x, y]);
  }
}
console.log('头部区暗点数:', dark.length);
// 聚类: 按 6px 网格
const clusters = [];
for (const [x, y] of dark) {
  let found = false;
  for (const c of clusters) {
    if (Math.abs(c.cx - x) < 8 && Math.abs(c.cy - y) < 8) {
      c.n++; c.cx = (c.cx*(c.n-1)+x)/c.n; c.cy = (c.cy*(c.n-1)+y)/c.n;
      c.minX = Math.min(c.minX, x); c.maxX = Math.max(c.maxX, x);
      c.minY = Math.min(c.minY, y); c.maxY = Math.max(c.maxY, y);
      found = true; break;
    }
  }
  if (!found) clusters.push({ n: 1, cx: x, cy: y, minX: x, maxX: x, minY: y, maxY: y });
}
clusters.sort((a, b) => b.n - a.n);
console.log('暗点聚类 (前 12):');
for (const c of clusters.slice(0, 12)) {
  console.log(`  n=${c.n} center=(${c.cx.toFixed(1)}, ${c.cy.toFixed(1)}) box=[${c.minX}-${c.maxX}]x[${c.minY}-${c.maxY}]`);
}

// 2) 灰青平坦区 (头部模板): 低局部方差 + 灰青色调
// 在头部区域内找 slab 的轮廓: 用 3x3 方差
const slab = { minX: W, minY: H, maxX: -1, maxY: -1, count: 0 };
for (let y = HEAD_Y0; y < HEAD_Y1; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y*W+x)*4;
    const rr = data[i], g = data[i+1], b = data[i+2];
    // 灰青: b>=r, b~g, 中亮度
    if (b >= rr && Math.abs(b-g) <= 25 && b >= 90 && b <= 175 && rr >= 60) {
      // 3x3 方差
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x+dx, yy = y+dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = (yy*W+xx)*4;
        sum += data[j]+data[j+1]+data[j+2]; n += 3;
      }
      const mean = sum/n;
      let v = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x+dx, yy = y+dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = (yy*W+xx)*4;
        v += (data[j]-mean)**2 + (data[j+1]-mean)**2 + (data[j+2]-mean)**2;
      }
      if (v/9 < 250) {
        slab.count++;
        if (x<slab.minX)slab.minX=x; if (x>slab.maxX)slab.maxX=x;
        if (y<slab.minY)slab.minY=y; if (y>slab.maxY)slab.maxY=y;
      }
    }
  }
}
console.log('\n灰青平坦区 (头模板候选):', JSON.stringify(slab));

// 3) 行分布: 每行灰青像素数 (看模板范围)
console.log('\n灰青像素行分布 (头部区):');
for (let y = HEAD_Y0; y < HEAD_Y1; y += 5) {
  let n = 0;
  for (let x = 0; x < W; x++) {
    const i = (y*W+x)*4;
    const rr = data[i], g = data[i+1], b = data[i+2];
    if (b >= rr && Math.abs(b-g) <= 25 && b >= 90 && b <= 175 && rr >= 60) n++;
  }
  console.log(`  y=${y}: ${'#'.repeat(Math.round(n/8))} (${n})`);
}

// 4) 眼睛相对 slab 的位置
if (slab.count > 20 && clusters.length >= 2) {
  const eye1 = clusters[0], eye2 = clusters[1];
  const scx = (slab.minX+slab.maxX)/2, scy = (slab.minY+slab.maxY)/2;
  console.log('\n眼睛 vs 模板中心:');
  console.log(`  模板中心 (${scx.toFixed(1)}, ${scy.toFixed(1)}), 尺寸 ${slab.maxX-slab.minX+1}x${slab.maxY-slab.minY+1}`);
  for (const c of [eye1, eye2]) {
    console.log(`  眼睛 (${c.cx.toFixed(1)}, ${c.cy.toFixed(1)}): 相对模板中心 dx=${(c.cx-scx).toFixed(1)} dy=${(c.cy-scy).toFixed(1)}`);
  }
}
