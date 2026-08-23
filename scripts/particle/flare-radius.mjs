import fs from 'fs';
const { decodeTex } = await import('file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js');
const raw = fs.readFileSync('c:/program files (x86)/steam/steamapps/common/wallpaper_engine/assets/materials/particle/light/flare_1.tex');
const d = decodeTex(raw);
const { width: w, height: h, rgba } = d;
// 沿中心行统计 alpha 轮廓（G 通道）
const cy = (h / 2) | 0;
let prev = -1;
const outline = [];
for (let x = 0; x < w; x += 4) {
  const g = rgba[(cy * w + x) * 4 + 1];
  if (g !== prev) { outline.push(x + ':' + g); prev = g; }
}
console.log('中心行 y=' + cy + ' G通道轮廓(每变化点): ' + outline.join(' '));
// 光斑半径估计：从中心向外第一个 alpha<10 的位置
const cx = (w / 2) | 0;
let r = 0;
for (let x = cx; x < w; x++) {
  const g = rgba[(cy * w + x) * 4 + 1];
  if (g < 10) { r = x - cx; break; }
}
console.log('估计光斑半径 ≈', r, 'px (256 尺寸下)');
// 对角方向
let rd = 0;
for (let k = 0; k < w; k++) {
  const x = cx + k, y = cy + k;
  if (x >= w || y >= h) break;
  const g = rgba[(y * w + x) * 4 + 1];
  if (g < 10) { rd = k; break; }
}
console.log('对角半径 ≈', rd, 'px');
