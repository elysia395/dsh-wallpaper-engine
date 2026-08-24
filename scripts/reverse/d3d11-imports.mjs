// 列出 d3d11.dll 的所有导入函数
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const peOff = b.readUInt32LE(0x3c);
const optOff = peOff + 24;
const ddOff = optOff + 112;
const impRva = b.readUInt32LE(ddOff);
const numSec = b.readUInt16LE(peOff + 6);
const optSize = b.readUInt16LE(peOff + 20);
const secOff = optOff + optSize;
const secs = [];
for (let i = 0; i < numSec; i++) {
  const so = secOff + i * 40;
  secs.push({ name: b.toString('ascii', so, so + 8).replace(/\0/g, ''), vaddr: b.readUInt32LE(so + 12), vsize: b.readUInt32LE(so + 8), roff: b.readUInt32LE(so + 20), rsize: b.readUInt32LE(so + 16) });
}
function rvaToFile(rva) {
  const s = secs.find(x => rva >= x.vaddr && rva < x.vaddr + x.vsize);
  return s ? s.roff + (rva - s.vaddr) : -1;
}
let off = rvaToFile(impRva);
while (off > 0 && off + 20 < b.length) {
  const origThunk = b.readUInt32LE(off);
  const nameRva = b.readUInt32LE(off + 12);
  const firstThunk = b.readUInt32LE(off + 16);
  if (nameRva === 0 && origThunk === 0) break;
  if (nameRva) {
    const nameFile = rvaToFile(nameRva);
    let dll = '';
    for (let i = nameFile; i < nameFile + 60 && b[i] !== 0; i++) dll += String.fromCharCode(b[i]);
    if (dll.toLowerCase().includes('d3d11')) {
      console.log(`== ${dll} 导入函数 ==`);
      const thunkOff = rvaToFile(origThunk || firstThunk);
      if (thunkOff > 0) {
        for (let t = 0; t < 300; t++) {
          const thunk = b.readUInt32LE(thunkOff + t * 8);
          if (thunk === 0) break;
          const hintFile = rvaToFile(thunk & 0x7fffffff);
          if (hintFile > 0) {
            let fn = '';
            for (let i = hintFile + 2; i < hintFile + 100 && b[i] !== 0; i++) fn += String.fromCharCode(b[i]);
            console.log(`  ${fn}`);
          }
        }
      }
    }
  }
  off += 20;
}
console.log('done');
