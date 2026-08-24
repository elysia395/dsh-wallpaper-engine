// PE 导入表解析: 找关键 API 的 IAT 地址 + 调用处
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const peOff = b.readUInt32LE(0x3c);
const optOff = peOff + 24;
// 数据目录: 导入表 = 目录 1
const ddOff = optOff + 112;
const impRva = b.readUInt32LE(ddOff);
const impSize = b.readUInt32LE(ddOff + 4);
console.log(`导入表 RVA 0x${impRva.toString(16)} 大小 ${impSize}`);
// 段表
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
// 遍历导入描述符
const imgBase = 0x140000000;
let off = rvaToFile(impRva);
const iatAddrs = {};
while (off > 0 && off + 20 < b.length) {
  const origThunk = b.readUInt32LE(off);      // INT (名称表)
  const nameRva = b.readUInt32LE(off + 12);   // 名称
  const firstThunk = b.readUInt32LE(off + 16); // IAT
  if (nameRva === 0 && origThunk === 0) break;
  if (nameRva) {
    const nameFile = rvaToFile(nameRva);
    let dll = '';
    for (let i = nameFile; i < nameFile + 60 && b[i] !== 0; i++) dll += String.fromCharCode(b[i]);
    // 遍历该 DLL 的导入函数
    let thunkOff = rvaToFile(origThunk || firstThunk);
    let iatOff = rvaToFile(firstThunk);
    if (thunkOff > 0 && iatOff > 0) {
      for (let t = 0; t < 500; t++) {
        const thunk = b.readUInt32LE(thunkOff + t * 8);
        if (thunk === 0) break;
        // 名称导入 (高位 0)
        const hintFile = rvaToFile(thunk & 0x7fffffff);
        if (hintFile > 0) {
          let fn = '';
          for (let i = hintFile + 2; i < hintFile + 100 && b[i] !== 0; i++) fn += String.fromCharCode(b[i]);
          const iatVa = imgBase + firstThunk + t * 8;
          if (['QueryPerformanceCounter', 'QueryPerformanceFrequency', 'Sleep', 'Present', 'CreateSwapChainForHwnd'].includes(fn)) {
            iatAddrs[fn] = iatVa;
            console.log(`${dll}!${fn}: IAT VA 0x${iatVa.toString(16)}`);
          }
        }
      }
    }
  }
  off += 20;
}
// 搜 .text 里 call [rip+disp] → IAT 地址
const textSec = secs.find(s => s.name === '.text');
const calls = {};
for (const fn of Object.keys(iatAddrs)) calls[fn] = [];
const iatVals = Object.values(iatAddrs);
for (let i = textSec.roff; i < textSec.roff + textSec.rsize - 7; i++) {
  // call qword ptr [rip+disp]: ff 15 disp32 / ff 10 15
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
  hits.slice(0, 6).forEach(h => console.log(`  0x${h.toString(16)}`));
}
