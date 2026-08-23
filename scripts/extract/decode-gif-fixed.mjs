// 修正 GIF LZW 解码: 码长递增时机 + 字典重置
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import fs from 'fs';

const gif = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif');
const sw = gif.readUInt16LE(6), sh = gif.readUInt16LE(8);
const gctSize = 2 ** ((gif[10] & 7) + 1);
const gct = [];
for (let i = 0; i < gctSize; i++) gct.push([gif[13 + i*3], gif[14 + i*3], gif[15 + i*3]]);

const dataPos = 818;
const minCode = gif[dataPos];
let p = dataPos + 1;
const blocks = [];
while (p < gif.length) { const sz = gif[p]; if (sz === 0) break; blocks.push(gif.subarray(p+1, p+1+sz)); p += sz + 1; }

// 标准 GIF LZW
function lzw(minCodeSize, blocks) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let out = [];
  let dict = new Map();
  let nextCode, codeSize;
  const resetDict = () => {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) dict.set(i, [i]);
    nextCode = endCode + 1;
    codeSize = minCodeSize + 1;
  };
  resetDict();
  let bits = 0, bitBuf = 0;
  let prev = -1;
  const getCode = () => {
    while (bits < codeSize) {
      // 从 blocks 读下一个字节
      // 简化: 预拼所有字节
    }
  };
  // 预拼所有字节
  const allBytes = [];
  for (const b of blocks) for (const byte of b) allBytes.push(byte);
  let byteIdx = 0;
  const readCode = () => {
    while (bits < codeSize && byteIdx < allBytes.length) {
      bitBuf |= allBytes[byteIdx++] << bits;
      bits += 8;
    }
    if (bits < codeSize) return -1;
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bits -= codeSize;
    return code;
  };
  while (true) {
    const code = readCode();
    if (code === -1 || code === endCode) break;
    if (code === clearCode) { resetDict(); prev = -1; continue; }
    let entry;
    if (dict.has(code)) entry = dict.get(code);
    else if (code === nextCode && prev >= 0) entry = [...dict.get(prev), dict.get(prev)[0]];
    else { break; }
    out.push(...entry);
    if (prev >= 0) dict.set(nextCode++, [...dict.get(prev), entry[0]]);
    prev = code;
    if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
  }
  return out;
}
const indices = lzw(minCode, blocks);
console.log('LZW 像素:', indices.length, '/', sw*sh);
if (indices.length >= sw*sh) {
  const rgba = new Uint8Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const c = gct[indices[i]] || [0,0,0];
    rgba[i*4] = c[0]; rgba[i*4+1] = c[1]; rgba[i*4+2] = c[2]; rgba[i*4+3] = 255;
  }
  await sharp(rgba, { raw: { width: sw, height: sh, channels: 4 } })
    .resize(sw*6, sh*6, { kernel: 'nearest' })
    .png().toFile('D:/dsh-wallpaper-engine/scene-layers-out/part_analysis/preview_frame0_6x.png');
  console.log('已保存 6x 放大');
}
