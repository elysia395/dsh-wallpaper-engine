// 读 wallpaper64.exe .rdata 字段名字符串
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
function rvaToFile(rva) { return rva - 0x426000 + 0x424e00; }
const targets = [0x490be0, 0x490bf8, 0x490c00, 0x490c08, 0x490c54, 0x490b90, 0x490ba0, 0x490bb0, 0x490bc0, 0x490b9b, 0x490baa, 0x490bbc, 0x490bc9];
for (const rva of targets) {
  const off = rvaToFile(rva);
  let s = '';
  for (let i = off; i < off + 60 && i < b.length; i++) {
    if (b[i] === 0) break;
    s += String.fromCharCode(b[i]);
  }
  console.log(`0x${rva.toString(16)}: "${s}"`);
}
console.log('--- 0x490bd0-0x490c70 字符串区 ---');
const start = rvaToFile(0x490bd0);
let line = '';
for (let i = start; i < start + 0xa0; i++) {
  if (b[i] >= 0x20 && b[i] <= 0x7e) line += String.fromCharCode(b[i]);
  else if (b[i] === 0) line += ' | ';
  else line += '.';
}
console.log(line);
