// 检查无 cropoffset 时 (01_no_crop) 头部区域是否被大衣覆盖
// 用 sharp 分析 01_no_crop 的头部区域内容
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

async function analyzeHead(file, label) {
  const img = sharp(file);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  // 头部区域 (无 cropoffset 时头在 x660-1110, y1072-1651 → 1920x1080 缩放下 x330-555, y536-825)
  // 全图 1920x1080, 头 x660/2=330-555, y1072/2=536-825
  const x0 = 300, x1 = 600, y0 = 500, y1 = 850;
  let cnt = 0, skin = 0, hair = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4;
    const a = data[i+3];
    if (a > 30) {
      cnt++;
      const r2 = data[i], g = data[i+1], b = data[i+2];
      if (r2 > 130 && g > 80 && b > 60 && r2 > g && g > b) skin++;
      if (r2 < 120 && g < 110 && b < 110 && (r2+g+b) < 330) hair++;
    }
  }
  console.log(label + ': 头部区域不透明', cnt, '肤色', skin, '发色', hair);
}

await analyzeHead('D:/dsh-wallpaper-engine/scene-layers-out/crop_judge/01_no_crop_FULL.png', '01无cropoffset');
await analyzeHead('D:/dsh-wallpaper-engine/scene-layers-out/crop_judge/02_vert_yASIS_FULL.png', '02顶点y原样');
