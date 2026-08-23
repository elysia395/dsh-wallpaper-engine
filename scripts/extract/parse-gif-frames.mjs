// 手动解析 GIF 第一帧 (正确提取 220x220 画面)
import fs from 'fs';

const gif = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif');
console.log('GIF 大小:', gif.length);

// GIF 头: GIF89a + 逻辑屏幕宽高 (LE) + packed + bg + aspect
const sw = gif.readUInt16LE(6), sh = gif.readUInt16LE(8);
console.log('逻辑屏幕:', sw + 'x' + sh, 'packed:', gif[10].toString(16));
const gctFlag = (gif[10] >> 7) & 1;
const gctSize = 2 ** ((gif[10] & 7) + 1);
console.log('全局调色板:', gctFlag, '大小:', gctSize);

// 遍历块结构, 找图像描述符 (0x2C) 和图像数据
let pos = 13 + (gctFlag ? gctSize * 3 : 0);
let frame = 0;
const frames = [];
while (pos < gif.length) {
  const marker = gif[pos];
  if (marker === 0x2C) {
    // 图像描述符
    const left = gif.readUInt16LE(pos + 1), top = gif.readUInt16LE(pos + 3);
    const w = gif.readUInt16LE(pos + 5), h = gif.readUInt16LE(pos + 7);
    const packed = gif[pos + 9];
    const lctFlag = (packed >> 7) & 1;
    const lctSize = lctFlag ? 2 ** ((packed & 7) + 1) : 0;
    const dataPos = pos + 10 + lctSize * 3;
    console.log('帧' + frame + ': 图像@' + pos + ' 位置(' + left + ',' + top + ') 尺寸' + w + 'x' + h + ' LCT:' + lctSize);
    frames.push({ pos, left, top, w, h, dataPos });
    frame++;
    // 跳到数据结束: LZW 最小码长 + 数据子块
    let p = dataPos + 1;
    while (p < gif.length) {
      const blockSize = gif[p];
      if (blockSize === 0) { p++; break; }
      p += blockSize + 1;
    }
    pos = p;
  } else if (marker === 0x21) {
    // 扩展块: 0x21 label size data...
    const label = gif[pos + 1];
    let p = pos + 2;
    // 图形控制扩展 label=0xF9: 4 字节 + terminator
    while (p < gif.length) {
      const blockSize = gif[p];
      if (blockSize === 0) { p++; break; }
      p += blockSize + 1;
    }
    pos = p;
  } else if (marker === 0x3B) {
    console.log('GIF 尾 @' + pos);
    break;
  } else {
    console.log('未知标记 @' + pos + ': ' + marker.toString(16));
    break;
  }
}
console.log('总帧数:', frame);
console.log('帧列表:', JSON.stringify(frames.slice(0, 5)));
