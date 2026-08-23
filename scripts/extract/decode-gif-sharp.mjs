// 用 sharp 解码 preview.gif 帧 0 → PNG (官方预览布局参考)
import { createRequire } from 'module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');

const files = [
  ['C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif', 'scripts/out/amiya_official_preview.png'],
];
for (const [src, dst] of files) {
  try {
    const img = sharp(src, { animated: false, pages: 1 });
    const meta = await img.metadata();
    console.log('GIF:', meta.width + 'x' + meta.height, 'pages=' + meta.pages, 'pageHeight=' + meta.pageHeight);
    // 提取前几帧
    for (let i = 0; i < Math.min(4, meta.pages || 1); i++) {
      const buf = await sharp(src, { animated: true }).extract({ left: 0, top: i * (meta.pageHeight || meta.height), width: meta.width, height: meta.pageHeight || meta.height }).png().toBuffer();
      fs.writeFileSync(`scripts/out/amiya_preview_frame${i}.png`, buf);
      console.log('帧 ' + i + ' 保存: scripts/out/amiya_preview_frame' + i + '.png (' + buf.length + 'B)');
    }
  } catch (e) {
    console.log('sharp 解码失败:', e.message);
  }
}
