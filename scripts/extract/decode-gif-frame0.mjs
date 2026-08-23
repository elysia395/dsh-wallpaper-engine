// 解码 GIF 帧 0 (220x220 完整画面) 用 LZW
import fs from 'zlib';
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import fs2 from 'fs';

const gif = fs2.readFileSync('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif');
const sw = gif.readUInt16LE(6), sh = gif.readUInt16LE(8);
const gctSize = 2 ** ((gif[10] & 7) + 1);
// 全局调色板
const gct = [];
for (let i = 0; i < gctSize; i++) {
  gct.push([gif[13 + i*3], gif[14 + i*3], gif[15 + i*3]]);
}
// 帧 0 数据位置
const dataPos = 818; // 从解析结果
// LZW 解码
function lzwDecode(minCodeSize, dataBlocks) {
  let codeSize = minCodeSize + 1;
  let dict = [];
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let nextCode = endCode + 1;
  let prev = -1;
  let out = [];
  let bits = 0, bitBuf = 0;
  // 重建字典
  function resetDict() {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([]); dict.push([]); // clear, end
    nextCode = endCode + 1;
    codeSize = minCodeSize + 1;
  }
  resetDict();
  for (const block of dataBlocks) {
    for (const byte of block) {
      bitBuf |= byte << bits;
      bits += 8;
      while (bits >= codeSize) {
        const code = bitBuf & ((1 << codeSize) - 1);
        bitBuf >>= codeSize;
        bits -= codeSize;
        if (code === clearCode) { resetDict(); prev = -1; continue; }
        if (code === endCode) return out;
        let entry;
        if (code < dict.length) entry = dict[code];
        else if (code === nextCode && prev >= 0) entry = [...dict[prev], dict[prev][0]];
        else { out = out; continue; }
        out.push(...entry);
        if (prev >= 0 && dict.length < 4096) dict.push([...dict[prev], entry[0]]);
        prev = code;
        if (dict.length > (1 << codeSize) && codeSize < 12) codeSize++;
      }
    }
  }
  return out;
}
// 收集帧0的 LZW 数据块
const minCode = gif[dataPos];
let p = dataPos + 1;
const blocks = [];
while (p < gif.length) {
  const sz = gif[p];
  if (sz === 0) break;
  blocks.push(gif.subarray(p + 1, p + 1 + sz));
  p += sz + 1;
}
const indices = lzwDecode(minCode, blocks);
console.log('LZW 解码像素数:', indices.length, '(应≈' + (sw*sh) + ')');
if (indices.length >= sw*sh) {
  // 帧 0 用全局调色板
  const rgba = new Uint8Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const idx = indices[i];
    const c = gct[idx] || [0,0,0];
    rgba[i*4] = c[0]; rgba[i*4+1] = c[1]; rgba[i*4+2] = c[2]; rgba[i*4+3] = 255;
  }
  await sharp(rgba, { raw: { width: sw, height: sh, channels: 4 } })
    .resize(sw*6, sh*6, { kernel: 'nearest' })
    .png().toFile('D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/preview_frame0_6x.png');
  console.log('已保存 preview_frame0_6x.png (6x放大)');
}
