// 从 preview.gif 提取正确的人物位置 (ground truth)
// GIF 是多帧堆叠: 逻辑屏幕 220x220, 37 帧
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import fs from 'fs';

const OUT = 'D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/';

// 用 sharp 提取单帧 (page 0) 为 220x220
const img = sharp('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif', { animated: true, page: 0 });
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
console.log('page0:', info.width + 'x' + info.height, 'channels', info.channels);

// 保存单帧 PNG
await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
  .png().toFile(OUT + 'preview_page0.png');
console.log('已保存 preview_page0.png');

// 放大 4 倍便于查看
await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
  .resize(info.width * 4, info.height * 4, { kernel: 'nearest' })
  .png().toFile(OUT + 'preview_page0_4x.png');
console.log('已保存 preview_page0_4x.png (4x放大)');
