// 读取投影构造常量的浮点值
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
// rdata 段: RVA 0x426000 ↔ 文件 0x424e00
function rvaToFile(rva) { return rva - 0x426000 + 0x424e00; }
const consts = {
  0x140492628: null, 0x1404926c0: null, 0x140492700: null, 0x140492704: null,
  0x14049294c: null, 0x140492a1c: null, 0x1404929b0: null, 0x14049284c: null,
  0x140492e30: null, 0x140493050: null, 0x140483640: null, 0x140483760: null
};
for (const va of Object.keys(consts)) {
  const rva = parseInt(va) - 0x140000000;
  const f = rvaToFile(rva);
  if (f >= 0 && f + 4 < b.length) {
    const v = b.readFloatLE(f);
    const bits = b.readUInt32LE(f);
    console.log(`0x${parseInt(va).toString(16)}: ${v} (0x${bits.toString(16)})`);
  } else {
    console.log(`0x${parseInt(va).toString(16)}: 超出 rdata 范围 (rva 0x${rva.toString(16)})`);
  }
}
