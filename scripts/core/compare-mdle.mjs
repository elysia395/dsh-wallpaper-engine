// 对比 MDLE 矩阵 vs MDLS 绑定矩阵 (验证 MDLE 是否修正静态姿态)
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const pkg = readPkg(WS + '/3461168300/scene.pkg');
const buf = pkg.read('models/发_puppet.mdl');
const u32 = (o) => buf.readUInt32LE(o);
const f32 = (o) => buf.readFloatLE(o);

const mdls = 3054;
const mdle = 32923;
// MDLS 骨骼数
const boneCount = u32(mdls + 13);
console.log('发_puppet 骨骼数:', boneCount);
// 解析 MDLS 绑定矩阵
let p = mdls + 9 + 4 + 4;
const binds = [];
for (let b = 0; b < boneCount; b++) {
  const tmp = buf[p];
  const type = u32(p + 1);
  const parent = buf.readInt32LE(p + 5);
  let headExtra = 0;
  let len = u32(p + 9);
  if (len === 0 || len > 4096) {
    type = u32(p + 2); parent = buf.readInt32LE(p + 6); len = u32(p + 10); headExtra = 1;
  }
  p += 9 + headExtra + 4;
  const m = [];
  for (let i = 0; i < 16; i++) m.push(f32(p + i * 4));
  p += len;
  let je = p;
  while (je < buf.length && buf[je] !== 0) je++;
  p = je + 1;
  binds.push({ tmp, type, parent, m });
}
console.log('MDLS 骨骼平移:');
for (let i = 0; i < boneCount; i++) console.log('  bone' + i + ' parent=' + binds[i].parent + ' T=' + binds[i].m[12].toFixed(1) + ',' + binds[i].m[13].toFixed(1));

// MDLE: [u32 文件长][每骨骼 64B]
console.log('\nMDLE 矩阵 (每骨骼 64B):');
let q = mdle + 9 + 4; // 跳过魔数 + u32 文件长
for (let i = 0; i < Math.min(boneCount, 10); i++) {
  const floats = [];
  for (let k = 0; k < 16; k++) floats.push(f32(q + i * 64 + k * 4).toFixed(2));
  console.log('  MDLE骨' + i + ': ' + floats.join(','));
}
