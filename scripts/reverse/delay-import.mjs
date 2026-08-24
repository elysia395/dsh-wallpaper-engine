// 检查延迟加载导入 (delay import) + 所有导入 dll 的函数名
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
// 延迟加载目录 = 目录 13
const d13 = optOff + 112 + 13 * 8;
const dlRva = b.readUInt32LE(d13);
console.log(`延迟加载目录 RVA: 0x${dlRva.toString(16)} size ${b.readUInt32LE(d13 + 4)}`);
if (dlRva) {
  let o = rvaToFile(dlRva);
  while (o > 0 && o + 32 < b.length) {
    const attrs = b.readUInt32LE(o);
    const nameRva = b.readUInt32LE(o + 4);
    const iat = b.readUInt32LE(o + 16);
    if (nameRva === 0) break;
    const nf = rvaToFile(nameRva);
    let dll = '';
    for (let i = nf; i < nf + 60 && b[i] !== 0; i++) dll += String.fromCharCode(b[i]);
    console.log(`delay dll: ${dll}`);
    // 名称
    let t = rvaToFile(iat);
    if (t > 0) {
      let cnt = 0;
      for (let k = 0; k < 400; k++) {
        const thunk = b.readUInt32LE(t + k * 8);
        if (thunk === 0) break;
        const hintFile = rvaToFile(thunk & 0x7fffffff);
        if (hintFile > 0) {
          let fn = '';
          for (let i = hintFile + 2; i < hintFile + 100 && b[i] !== 0; i++) fn += String.fromCharCode(b[i]);
          if (['UpdateSubresource','Map','Unmap','VSSetConstantBuffers','Draw','DrawIndexed','IASetVertexBuffers','VSSetShader','CreateBuffer'].includes(fn)) {
            console.log(`  delay: ${dll}!${fn}`);
            cnt++;
          }
        }
      }
    }
    o += 32;
  }
}
console.log('done');
