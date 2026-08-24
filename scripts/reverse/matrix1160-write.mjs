// 找 0xc8 对象 + 0x1160/0x11a0 矩阵 (view/proj?) 的所有写入点 (含 movaps 0f 29)
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
const hits = [];
for (let i = roff; i < roff + rsize - 8; i++) {
  let is = false, op = '';
  // movups 0f 10(读)/0f 11(写); movaps 0f 28(读)/0f 29(写); movss f3 0f 10/11; movsd f2 0f 10/11
  if (b[i] === 0x0f && (b[i+1] === 0x10 || b[i+1] === 0x11 || b[i+1] === 0x28 || b[i+1] === 0x29)) {
    is = true;
    const w = b[i+1] === 0x11 || b[i+1] === 0x29;
    op = (b[i+1] === 0x10 || b[i+1] === 0x11 ? 'movups' : 'movaps') + (w ? '(w)' : '');
  } else if ((b[i] === 0xf3 || b[i] === 0xf2) && b[i+1] === 0x0f && (b[i+2] === 0x10 || b[i+2] === 0x11)) {
    is = true;
    op = (b[i] === 0xf3 ? 'movss' : 'movsd') + (b[i+2] === 0x11 ? '(w)' : '');
  }
  if (!is) continue;
  const mOff = (b[i] === 0x0f) ? i + 2 : i + 3;
  const modrm = b[mOff];
  const mod = (modrm >> 6) & 3;
  let disp = null;
  if (mod === 1) disp = b[mOff + 1];
  else if (mod === 2) disp = b.readInt32LE(mOff + 1);
  if (disp != null && disp >= 0x1160 && disp <= 0x11df) {
    const va = 0x140000000 + vaddr + (i - roff);
    const rm = modrm & 7;
    hits.push(`0x${va.toString(16)}: ${op} [r${rm}+0x${disp.toString(16)}]`);
  }
}
console.log('0xc8+0x1160-0x11df 区域访问点:');
for (const h of hits.slice(0, 50)) console.log('  ' + h);
console.log(`共 ${hits.length} 个`);
