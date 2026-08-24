// 找 camera 相关字符串 (eye/center/up) + xref → 相机构造
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const text = b.toString('latin1');
// 找 "eye"/"center"/"up" 字符串 (rdata)
for (const n of ['"eye"', '"center"', '"up"', 'eye', 'center', 'orthogonalprojection', 'nearz']) {
  const idx = text.indexOf(n);
  if (idx >= 0 && idx >= 0x424e00 && idx < 0x4da000) {
    const rva = 0x426000 + (idx - 0x424e00);
    console.log(`${n}: RVA 0x${rva.toString(16)} VA 0x${(0x140000000 + rva).toString(16)}`);
  }
}
// 相机构造 xref: 找 "orthogonalprojection" 的引用 (投影设置)
// 先找 "camera" 字段解析 (对象创建读 camera)
for (const n of ['camera', 'projection']) {
  let idx = -1, cnt = 0;
  while ((idx = text.indexOf(n, idx + 1)) >= 0 && cnt < 5) {
    if (idx >= 0x424e00 && idx < 0x4da000) {
      console.log(`${n} @ 文件 0x${idx.toString(16)} RVA 0x${(0x426000 + (idx - 0x424e00)).toString(16)}`);
      cnt++;
    }
  }
}
