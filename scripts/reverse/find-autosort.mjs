// 找 autosort 字符串位置 + xref + 反汇编排序相关
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const text = b.toString('latin1');
// autosort 字符串
let idx = -1;
while ((idx = text.indexOf('autosort', idx + 1)) >= 0) {
  console.log('autosort 文件偏移: 0x' + idx.toString(16));
  // RVA: .rdata 0x426000 → roff 0x424e00
  const rva = 0x426000 + (idx - 0x424e00);
  console.log('  RVA: 0x' + rva.toString(16));
}
// PUED0002
idx = -1;
while ((idx = text.indexOf('PUED0002', idx + 1)) >= 0) {
  console.log('PUED0002 文件偏移: 0x' + idx.toString(16) + ' RVA: 0x' + (0x426000 + (idx - 0x424e00)).toString(16));
}
// morph 相关
idx = -1;
while ((idx = text.indexOf('morph', idx + 1)) >= 0 && idx < 0x500000) {
  console.log('morph 文件偏移: 0x' + idx.toString(16) + ' RVA: 0x' + (0x426000 + (idx - 0x424e00)).toString(16));
  break;
}
