// preview 边缘检测 → 定位角色区域 → 裁头部区域放大
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const f0 = fs.readFileSync('scene-layers-out/part_analysis/preview_f0.png');
const { data: pd, info: pi } = await sharp(f0).raw().toBuffer({ resolveWithObject: true });
const PW = pi.width, PH = pi.height; // 220x220

// Sobel 边缘
const edge = new Float32Array(PW * PH);
let maxE = 0;
for (let y = 1; y < PH - 1; y++) {
  for (let x = 1; x < PW - 1; x++) {
    const i = (y*PW+x)*4;
    // 灰度
    const g = (y,x) => { const j = (y*PW+x)*4; return (pd[j]+pd[j+1]+pd[j+2])/3; };
    const gx = g(y-1,x+1) + 2*g(y,x+1) + g(y+1,x+1) - g(y-1,x-1) - 2*g(y,x-1) - g(y+1,x-1);
    const gy = g(y+1,x-1) + 2*g(y+1,x) + g(y+1,x+1) - g(y-1,x-1) - 2*g(y-1,x) - g(y-1,x+1);
    const e = Math.sqrt(gx*gx + gy*gy);
    edge[y*PW+x] = e;
    if (e > maxE) maxE = e;
  }
}
// 边缘密度 (每 5px 块)
console.log('=== 边缘密度图 (每 5px 块, #=高密度) ===');
const density = [];
for (let by = 0; by < PH; by += 5) {
  let row = '';
  for (let bx = 0; bx < PW; bx += 5) {
    let sum = 0, n = 0;
    for (let y = by; y < Math.min(by+5, PH); y++) for (let x = bx; x < Math.min(bx+5, PW); x++) { sum += edge[y*PW+x]; n++; }
    const d = sum / n / (maxE || 1);
    density.push(d);
    row += d > 0.06 ? '#' : d > 0.02 ? '+' : d > 0.008 ? '.' : ' ';
  }
  console.log(row);
}
// 角色区域: 边缘密度高的行/列范围
const rowDens = [], colDens = [];
for (let y = 0; y < PH; y += 2) { let s = 0; for (let x = 0; x < PW; x++) s += edge[y*PW+x]; rowDens.push([y, s]); }
for (let x = 0; x < PW; x += 2) { let s = 0; for (let y = 0; y < PH; y++) s += edge[y*PW+x]; colDens.push([x, s]); }
// 找行范围 (高于平均)
const rowAvg = rowDens.reduce((a,b)=>a+b[1],0) / rowDens.length;
const rowHigh = rowDens.filter(([y,s]) => s > rowAvg*1.2).map(([y])=>y);
const colAvg = colDens.reduce((a,b)=>a+b[1],0) / colDens.length;
const colHigh = colDens.filter(([x,s]) => s > colAvg*1.2).map(([x])=>x);
console.log('\n高边缘 行范围:', Math.min(...rowHigh), '-', Math.max(...rowHigh));
console.log('高边缘 列范围:', Math.min(...colHigh), '-', Math.max(...colHigh));
// 保存边缘图
const edgePng = Buffer.alloc(PW*PH*4);
for (let i = 0; i < PW*PH; i++) { const v = Math.min(255, Math.round(edge[i]/maxE*255*4)); edgePng[i*4]=v; edgePng[i*4+1]=v; edgePng[i*4+2]=v; edgePng[i*4+3]=255; }
fs.writeFileSync('scene-layers-out/part_analysis/preview_edges.png', edgePng);
// 裁角色头部区域 (角色顶部 ~40% 高度) 放大
const topY = Math.min(...rowHigh), botY = Math.max(...rowHigh);
const headTop = topY, headH = Math.round((botY-topY)*0.45);
const crop = { left: Math.max(0, Math.min(...colHigh)-5), top: Math.max(0, headTop-5), width: Math.min(PW, Math.max(...colHigh)-Math.min(...colHigh)+10), height: headH+10 };
console.log('头部裁剪:', JSON.stringify(crop));
if (crop.width > 0 && crop.height > 0) {
  await sharp(f0).extract(crop).resize(crop.width*8, crop.height*8, { kernel: 'nearest' }).png()
    .toFile('scene-layers-out/part_analysis/preview_head_8x.png');
  console.log('preview_head_8x.png saved');
}
