// 列出所有导入 DLL 名 + 搜 SetTransform/D3DXMatrix 字符串
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
console.log('== 导入 DLL ==');
while (off > 0 && off + 20 < b.length) {
  const origThunk = b.readUInt32LE(off);
  const nameRva = b.readUInt32LE(off + 12);
  const firstThunk = b.readUInt32LE(off + 16);
  if (nameRva === 0 && origThunk === 0) break;
  if (nameRva) {
    const nameFile = rvaToFile(nameRva);
    let dll = '';
    for (let i = nameFile; i < nameFile + 60 && b[i] !== 0; i++) dll += String.fromCharCode(b[i]);
    console.log(`  ${dll}`);
  }
  off += 20;
}
// 搜字符串
const latin = b.toString('latin1');
console.log('== D3D 相关字符串 ==');
for (const n of ['SetTransform', 'D3DXMatrixOrtho', 'D3DXMatrixLookAt', 'd3d9', 'd3d11', 'd3d10', 'dxgi', 'ID3D11', 'd3dcompiler', 'MatrixOrtho', 'MatrixLookAt', 'D3DXMatrix', 'SetVertexShaderConstant', 'VSSetConstantBuffers', 'CreateMatrix']) {
  let idx = -1, cnt = 0;
  while ((idx = latin.indexOf(n, idx + 1)) >= 0 && cnt < 6) {
    if (idx >= 0x424e00 && idx < 0x4da000) {
      const rva = 0x426000 + (idx - 0x424e00);
      console.log(`  "${n}" @ VA 0x${(0x140000000 + rva).toString(16)} RVA 0x${rva.toString(16)}`);
      cnt++;
    }
  }
  if (cnt === 0) console.log(`  "${n}" 未找到`);
}
