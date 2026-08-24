// 读取 puppet/g_Bones/MDL 字符串上下文 (0x490c54, 0x4920f0 附近)
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
function rvaToFile(rva) { return rva - 0x426000 + 0x424e00; }
function readStr(rva, len = 60) {
  const f = rvaToFile(rva);
  let s = '';
  for (let i = f; i < f + len && b[i] !== 0 && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
for (const rva of [0x490c54, 0x4875f3, 0x48daf8, 0x48db60, 0x48b2b0, 0x48f4dc, 0x491f65, 0x484d80, 0x4920f0, 0x492318, 0x492325]) {
  console.log(`RVA 0x${rva.toString(16)}: "${readStr(rva)}"`);
}
