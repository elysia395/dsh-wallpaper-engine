// 解出 preview.gif 的帧 (用 sharp), 保存 PNG 供视觉分析
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import fs from 'fs';

const src = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif';
const outDir = 'D:/dsh-wallpaper-engine/scene-layers-out/preview_frames/';
fs.mkdirSync(outDir, { recursive: true });

const img = sharp(src, { animated: true });
const meta = await img.metadata();
console.log('GIF 元数据:', JSON.stringify({ width: meta.width, height: meta.height, pages: meta.pages, pageHeight: meta.pageHeight }));

// 提取所有帧
const frames = await img.raw().toBuffer({ resolveWithObject: true });
console.log('帧数据:', frames.info);

// 逐帧提取
for (let i = 0; i < (meta.pages || 1); i++) {
  const f = sharp(src, { animated: true, page: i });
  const out = await f.png().toBuffer();
  fs.writeFileSync(outDir + 'frame_' + i + '.png', out);
  console.log('帧 ' + i + ':', out.length + 'B');
}
