// 逆向 MDLE0002 / MDAT0001 / MDMP0001 段结构
import fs from 'node:fs';
import path from 'node:path';
import { readPkg } from '../../lib/we-renderer/textures.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const ids = fs.readdirSync(WS).filter((d) => fs.existsSync(path.join(WS, d, 'scene.pkg')));

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

// 找含 MDLE 的 MDL (选一个小的)
let target = null;
for (const id of ids) {
  let pkg;
  try { pkg = readPkg(path.join(WS, id, 'scene.pkg')); } catch { continue; }
  const mdls = pkg.entries().filter((e) => e.name.endsWith('.mdl'));
  for (const m of mdls) {
    const buf = pkg.read(m.name);
    if (!buf) continue;
    const mdle = findSeg(buf, 'MDLE');
    const mdls_ = findSeg(buf, 'MDLS');
    if (mdle && mdls_ && m.size < 200000) {
      target = { id, name: m.name, buf, mdle, mdls: mdls_, size: m.size };
      break;
    }
  }
  if (target) break;
}
if (!target) { console.log('未找到含 MDLE 的小 MDL'); process.exit(0); }
const { id, name, buf, mdle, mdls, size } = target;
console.log(`=== ${id}/${name} (${size}B) MDLS@${mdls.off} MDLE@${mdle.off} ===`);
console.log('MDLE 后 96 字节:', dumpHex(buf, mdle.off + 9, 96));
console.log('MDLE ascii:', JSON.stringify(dumpAscii(buf, mdle.off + 9, 96)));
// MDLE 后找 JSON 或字段
console.log('MDLE 后 200 字节 ascii:', JSON.stringify(dumpAscii(buf, mdle.off + 9, 200)));
