// 读取 vtable 0x140490a28 (相机对象) 内容
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
function rvaToFile(rva) {
  // rdata 段: RVA 0x426000 ↔ 文件 0x424e00; 需验证边界
  if (rva >= 0x426000 && rva < 0x4da000) return rva - 0x426000 + 0x424e00;
  return -1;
}
const vtableVa = 0x140490a28;
const rva = vtableVa - 0x140000000;
const f = rvaToFile(rva);
console.log(`vtable 文件偏移 0x${f.toString(16)}`);
for (let i = 0; i < 24; i++) {
  const p = f + i * 8;
  if (p + 8 > b.length) break;
  const ptr = b.readUInt32LE(p);
  const ptrHi = b.readUInt32LE(p + 4);
  if (ptr === 0 && ptrHi === 0) { console.log(`  [${i}] = null`); continue; }
  // 小端 64 位
  const full = (BigInt(ptrHi) << 32n) | BigInt(ptr);
  console.log(`  [${i}] (off 0x${(i*8).toString(16)}) = 0x${full.toString(16)}`);
}
