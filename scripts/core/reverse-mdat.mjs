// 逆向 MDAT0001 / MDMP0001 结构
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const findSeg = (buf, magic) => {
  let off = 0;
  while ((off = buf.indexOf(magic, off)) >= 0) {
    const v = buf.toString('ascii', off + 4, off + 8);
    if (/^\d{4}$/.test(v)) return { off, version: v };
    off += 4;
  }
  return null;
};
const dumpHex = (buf, off, n) => buf.toString('hex', off, off + n);
const dumpAscii = (buf, off, n) => {
  let s = '';
  for (let i = off; i < off + n && i < buf.length; i++) {
    const b = buf[i];
    s += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
  }
  return s;
};
const u32 = (buf, off) => buf.readUInt32LE(off);
const f32 = (buf, off) => buf.readFloatLE(off);

// 头_puppet MDAT@9613
{
  const pkg = readPkg(WS + '/3486806915/scene.pkg');
  const buf = pkg.read('models/头_puppet.mdl');
  const mdat = findSeg(buf, 'MDAT');
  console.log('=== 头_puppet MDAT@' + mdat.off + ' ===');
  console.log('hex:', dumpHex(buf, mdat.off + 9, 80));
  console.log('ascii:', JSON.stringify(dumpAscii(buf, mdat.off + 9, 80)));
  for (let i = 0; i < 8; i++) console.log('  u32@' + (mdat.off + 9 + i * 4) + '=' + u32(buf, mdat.off + 9 + i * 4) + ' f32=' + f32(buf, mdat.off + 9 + i * 4).toFixed(3));
}

// cat11 MDMP@561971
{
  const pkg = readPkg(WS + '/3641860575/scene.pkg');
  const buf = pkg.read('models/cat11_puppet.mdl');
  const mdmp = findSeg(buf, 'MDMP');
  console.log('\n=== cat11 MDMP@' + mdmp.off + ' ===');
  console.log('hex:', dumpHex(buf, mdmp.off + 9, 96));
  console.log('ascii:', JSON.stringify(dumpAscii(buf, mdmp.off + 9, 96)));
  for (let i = 0; i < 10; i++) console.log('  u32@' + (mdmp.off + 9 + i * 4) + '=' + u32(buf, mdmp.off + 9 + i * 4) + ' f32=' + f32(buf, mdmp.off + 9 + i * 4).toFixed(3));
  // MDMP 到下一段 (MDLE) 长度
  const mdle = findSeg(buf, 'MDLE');
  console.log('MDMP 段长:', mdle.off - mdmp.off, '字节');
}
