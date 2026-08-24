// 读取 fullscreen/passthrough/autosize 字符串上下文
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
function rvaToFile(rva) { return rva - 0x426000 + 0x424e00; }
function readStr(rva, len = 40) {
  const f = rvaToFile(rva);
  let s = '';
  for (let i = f; i < f + len && b[i] !== 0 && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
for (const rva of [0x476e20, 0x48ace0, 0x490d9f, 0x491abb, 0x485b59, 0x4907e5, 0x49080d, 0x490b90, 0x490bf8]) {
  console.log(`RVA 0x${rva.toString(16)}: "${readStr(rva)}"`);
}
