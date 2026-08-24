// 读取 rdata 0x48e480-0x48e9c0 区域字符串
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
// 文件偏移 = RVA - 0x426000 + 0x424e00 (rdata 段基址)
function rvaToFile(rva) { return rva - 0x426000 + 0x424e00; }
const start = rvaToFile(0x48e480), end = rvaToFile(0x48e9c0);
let out = '';
for (let i = start; i < end; i++) {
  const c = b[i];
  if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
  else if (out.length) {
    if (out.length > 1) console.log(`  RVA 0x${(0x426000 + (i - out.length - 0x424e00)).toString(16)}: "${out}"`);
    out = '';
  }
}
if (out.length > 1) console.log(`  RVA 0x${(0x426000 + (end - out.length - 0x424e00)).toString(16)}: "${out}"`);
