// 找 g_Bones shader 字符串 + 骨骼矩阵上传
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const text = b.toString('latin1');
// g_Bones 相关字符串
for (const n of ['g_Bones', 'BONECOUNT', 'g_MorphBoneRules', 'SKINNING']) {
  const idx = text.indexOf(n);
  if (idx >= 0) {
    const rva = 0x426000 + (idx - 0x424e00);
    console.log(`${n}: 文件 0x${idx.toString(16)} RVA 0x${rva.toString(16)} VA 0x${(0x140000000 + rva).toString(16)}`);
  }
}
// 找所有 "g_Bones" 出现
console.log('\ng_Bones 所有出现:');
let i = -1, cnt = 0;
while ((i = text.indexOf('g_Bones', i + 1)) >= 0 && cnt < 10) {
  console.log(`  0x${i.toString(16)}`);
  cnt++;
}
