// 找 0xc8 对象 + 0x8f0-0x92f 区域 (4x4 矩阵, M 的真正来源) 的写入点
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
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
const roff = textSec.roff, rsize = textSec.rsize, vaddr = textSec.vaddr;
// movups/movaps/movss [r+disp32] disp ∈ 0x8f0-0x92f 的写入 (0f 11 / 0f 29 / f3 0f 11)
const hits = [];
for (let i = roff; i < roff + rsize - 8; i++) {
  let is = false, op = '';
  if (b[i] === 0x0f && (b[i+1] === 0x11 || b[i+1] === 0x29)) { is = true; op = b[i+1] === 0x11 ? 'movups' : 'movaps'; }
  else if (b[i] === 0xf3 && b[i+1] === 0x0f && b[i+2] === 0x11) { is = true; op = 'movss'; }
  if (!is) continue;
  const mOff = b[i] === 0xf3 ? i + 3 : i + 2;
  const modrm = b[mOff];
  const mod = (modrm >> 6) & 3;
  if (mod !== 2) continue;
  const disp = b.readInt32LE(mOff + 1);
  if (disp >= 0x8f0 && disp <= 0x92f) {
    const va = 0x140000000 + vaddr + (i - roff);
    const rm = modrm & 7;
    hits.push(`0x${va.toString(16)}: ${op} [r${rm}+0x${disp.toString(16)}]`);
  }
}
console.log('0xc8+0x8f0 矩阵写入点:');
for (const h of hits.slice(0, 40)) console.log('  ' + h);
console.log(`共 ${hits.length} 个`);
