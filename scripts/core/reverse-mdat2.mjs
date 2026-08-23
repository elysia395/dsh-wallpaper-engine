// 完整逆向 MDAT0001 段 (头_puppet, MDAT@9613 到 MDLA@9707)
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const pkg = readPkg(WS + '/3486806915/scene.pkg');
const buf = pkg.read('models/头_puppet.mdl');
const u32 = (o) => buf.readUInt32LE(o);
const f32 = (o) => buf.readFloatLE(o);

const mdat = 9613;
const mdla = 9707;
console.log('MDAT@' + mdat + ' 到 MDLA@' + mdla + ' = ' + (mdla - mdat) + ' 字节');
console.log('MDAT 全 hex:', buf.toString('hex', mdat, mdla));
console.log('MDAT ascii:', JSON.stringify(buf.toString('latin1', mdat, mdla)));
// 结构: [魔数9][u32 下一段偏移][u32 flags?][骨骼名\0][矩阵...]
let p = mdat + 9;
console.log('\nu32@' + p + ' =', u32(p), '(下一段偏移)'); p += 4;
console.log('u32@' + p + ' =', u32(p), '= 0x' + u32(p).toString(16)); p += 4;
// 骨骼名 (UTF-8)
const nameEnd = buf.indexOf(0, p);
const name = buf.toString('utf8', p, nameEnd);
console.log('骨骼名: "' + name + '"'); p = nameEnd + 1;
console.log('名字后 @' + p + ':');
// 剩余 = 矩阵序列?
const remaining = mdla - p;
console.log('剩余', remaining, '字节 =', remaining / 64, '个 64B 矩阵');
for (let i = 0; i < Math.min(remaining / 64, 3); i++) {
  const mo = p + i * 64;
  const floats = [];
  for (let k = 0; k < 16; k++) floats.push(f32(mo + k * 4).toFixed(2));
  console.log('  矩阵' + i + ': ' + floats.join(','));
}
