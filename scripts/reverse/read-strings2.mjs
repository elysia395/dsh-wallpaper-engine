import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
function rf(rva) { return rva - 0x426000 + 0x424e00; }
for (const rva of [0x48ed50, 0x48ed59, 0x490c20, 0x490820, 0x490825]) {
  const off = rf(rva);
  let s = '';
  for (let i = off; i < off + 50 && i < b.length; i++) {
    if (b[i] === 0) break;
    s += String.fromCharCode(b[i]);
  }
  console.log(`0x${rva.toString(16)}: "${s}"`);
}
