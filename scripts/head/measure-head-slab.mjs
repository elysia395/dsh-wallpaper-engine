// 测量头部纹理 slab alpha 包围盒
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import fs from 'fs';

const mod = await import('../lib/scene-renderer.js');
const pkg = mod.readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');
const { parseTex, decodeTex } = await import('../lib/pkg-extract.js');

const texBytes = pkg.read('materials/头.tex');
console.log('头.tex bytes:', texBytes ? texBytes.length : 'NULL');
const parsed = parseTex(texBytes);
console.log('parseTex:', parsed.formatName, parsed.width + 'x' + parsed.height, 'embedded:', parsed.embedded);
const img = decodeTex(texBytes);
console.log('decoded kind:', img.kind, img.width, 'x', img.height);

let width, height, d;
if (img.kind === 'rgba') { width = img.width; height = img.height; d = img.rgba; }
else if (img.kind === 'png-pass' || img.kind === 'jpeg') {
  const png = await sharp(img.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  width = png.info.width; height = png.info.height; d = png.data;
  console.log('embedded ' + img.kind + ' decoded via sharp:', width + 'x' + height);
} else { process.exit(0); }
let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
// 也统计 dominant 颜色区域 (grey-cyan slab)
const slabColor = { r: 96, g: 128, b: 128 };
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y*width+x)*4;
    if (d[i+3] > 16) {
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
console.log(`slab alpha bbox: x[${minX},${maxX}] w=${maxX-minX+1}, y[${minY},${maxY}] h=${maxY-minY+1}`);
console.log(`slab 中心: (${((minX+maxX)/2).toFixed(1)}, ${((minY+maxY)/2).toFixed(1)}) 纹理中心: (${width/2}, ${height/2})`);
console.log(`非透明像素: ${count} (${(100*count/(width*height)).toFixed(1)}%)`);

// 行级 alpha 分布 (每 20px 一行)
console.log('\n行 alpha 分布 (每 34px):');
for (let y = 0; y < height; y += 34) {
  let rowCount = 0;
  for (let x = 0; x < width; x++) if (d[(y*width+x)*4+3] > 16) rowCount++;
  console.log(`y=${y}..${Math.min(y+33,height-1)}: ${'#'.repeat(Math.round(rowCount/width*50))} (${rowCount}/${width})`);
}
// 保存透明图
await sharp(Buffer.from(d), { raw: { width, height, channels: 4 } })
  .png().toFile('scene-layers-out/part_analysis/head_tex_alpha.png');
console.log('\nhead_tex_alpha.png saved');
