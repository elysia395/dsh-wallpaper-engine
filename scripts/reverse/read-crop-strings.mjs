// 读取 crop/offset 字符串上下文
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
function rvaToFile(rva) { return rva - 0x426000 + 0x424e00; }
function readStr(rva, len = 40) {
  const f = rvaToFile(rva);
  let s = '';
  for (let i = f; i < f + len && b[i] !== 0 && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
for (const rva of [0x489055, 0x490096, 0x48f580, 0x48f598, 0x48f654, 0x48fea8, 0x4918ca, 0x48db47]) {
  console.log(`RVA 0x${rva.toString(16)}: "${readStr(rva, 50)}"`);
}
