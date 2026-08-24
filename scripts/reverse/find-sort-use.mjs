import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
function rf(rva) { return rva - 0x426000 + 0x424e00; }
for (const rva of [0x48e918, 0x48e73c, 0x48e8c8, 0x48e8dc, 0x48e8d4]) {
  const off = rf(rva);
  let s = '';
  for (let i = off; i < off + 40 && i < b.length; i++) {
    if (b[i] === 0) break;
    s += String.fromCharCode(b[i]);
  }
  console.log(`0x${rva.toString(16)}: "${s}"`);
}
// 找排序相关: 对象偏移 0xe0 读取 (transparentsorting) — cmp byte [reg+0xe0]
// 搜 0xe0 偏移的字节比较: 80 78 e0 / 80 b8 e0 等 (cmp byte ptr [rax+0xe0], imm)
const text = b.toString('latin1');
console.log('--- 找 0xe0 偏移比较 (透明排序检查) ---');
// 搜 80 78 e0 xx (cmp byte [rax+0xe0], imm) 和 80 b9 e0 等
const peOff = b.readUInt32LE(0x3c);
const numSec = b.readUInt16LE(peOff + 6);
const optSize = b.readUInt16LE(peOff + 20);
const optOff = peOff + 24;
const secOff = optOff + optSize;
const secs = [];
for (let i = 0; i < numSec; i++) {
  const so = secOff + i * 40;
  secs.push({ name: b.toString('ascii', so, so + 8).replace(/\0/g, ''), vaddr: b.readUInt32LE(so + 12), vsize: b.readUInt32LE(so + 8), roff: b.readUInt32LE(so + 20), rsize: b.readUInt32LE(so + 16) });
}
const textSec = secs.find(s => s.name === '.text');
let count = 0;
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 4; i++) {
  // cmp byte ptr [reg+0xe0], imm: 80 /0 e0 (modrm 40-7f with disp8=0xe0)
  if (b[i] === 0x80 && (b[i+1] & 0x38) === 0x38 && b[i+2] === 0xe0) {
    const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
    console.log(`cmp byte [reg+0xe0]: va=0x${va.toString(16)}`);
    count++;
    if (count > 10) break;
  }
}
// 也找 cmp dword [reg+0xe0]: 83 78 e0 / 83 b8 e0
count = 0;
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 4; i++) {
  if (b[i] === 0x83 && (b[i+1] & 0x38) === 0x38 && b[i+2] === 0xe0) {
    const va = 0x140000000 + textSec.vaddr + (i - textSec.roff);
    console.log(`cmp dword [reg+0xe0]: va=0x${va.toString(16)}`);
    count++;
    if (count > 10) break;
  }
}
