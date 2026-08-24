// 解析 d3d9.dll 导入表全部函数 + 找 SetTransform/SetVertexShaderConstantF 调用处
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
const imgBase = 0x140000000;
let off = rvaToFile(impRva);
const iatAddrs = {};
while (off > 0 && off + 20 < b.length) {
  const origThunk = b.readUInt32LE(off);
  const nameRva = b.readUInt32LE(off + 12);
  const firstThunk = b.readUInt32LE(off + 16);
  if (nameRva === 0 && origThunk === 0) break;
  if (nameRva) {
    const nameFile = rvaToFile(nameRva);
    let dll = '';
    for (let i = nameFile; i < nameFile + 60 && b[i] !== 0; i++) dll += String.fromCharCode(b[i]);
    const thunkOff = rvaToFile(origThunk || firstThunk);
    const iatOff = rvaToFile(firstThunk);
    if (thunkOff > 0 && iatOff > 0) {
      for (let t = 0; t < 800; t++) {
        const thunk = b.readUInt32LE(thunkOff + t * 8);
        if (thunk === 0) break;
        const hintFile = rvaToFile(thunk & 0x7fffffff);
        if (hintFile > 0) {
          let fn = '';
          for (let i = hintFile + 2; i < hintFile + 100 && b[i] !== 0; i++) fn += String.fromCharCode(b[i]);
          const iatVa = imgBase + firstThunk + t * 8;
          if (dll.toLowerCase().includes('d3d9') && (fn.includes('SetTransform') || fn.includes('SetVertexShaderConstantF') || fn.includes('DrawIndexedPrimitive') || fn.includes('DrawPrimitive') || fn.includes('SetFVF') || fn.includes('SetStreamSource') || fn.includes('SetRenderState') || fn.includes('SetTexture'))) {
            iatAddrs[fn] = iatVa;
            console.log(`${dll}!${fn}: IAT VA 0x${iatVa.toString(16)}`);
          }
        }
      }
    }
  }
  off += 20;
}
const textSec = secs.find(s => s.name === '.text');
const calls = {};
for (const fn of Object.keys(iatAddrs)) calls[fn] = [];
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  if (b[i] === 0xff && (b[i+1] === 0x15 || b[i+1] === 0x25)) {
    const disp = b.readInt32LE(i + 2);
    const instrRva = textSec.vaddr + (i - textSec.roff);
    const target = (0x140000000 + instrRva + 6 + disp) & 0xffffffff;
    for (const [fn, va] of Object.entries(iatAddrs)) {
      if (target === va) calls[fn].push(0x140000000 + instrRva);
    }
  }
}
for (const [fn, hits] of Object.entries(calls)) {
  console.log(`${fn}: ${hits.length} 处调用`);
  hits.slice(0, 8).forEach(h => console.log(`  0x${h.toString(16)}`));
}
