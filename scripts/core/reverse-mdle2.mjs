// MDLE/MDAT/MDMP 结构: 对比骨骼数与段长度
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

const boneCountOf = (buf, mdlsOff) => {
  try { return buf.readUInt32LE(mdlsOff + 13); } catch { return -1; }
};

for (const id of ids) {
  let pkg;
  try { pkg = readPkg(path.join(WS, id, 'scene.pkg')); } catch { continue; }
  const mdls = pkg.entries().filter((e) => e.name.endsWith('.mdl'));
  for (const m of mdls) {
    const buf = pkg.read(m.name);
    if (!buf) continue;
    const parts = [];
    for (const s of ['MDLV', 'MDLS', 'MDLA', 'MDAT', 'MDMP', 'MDLE']) {
      const seg = findSeg(buf, s);
      if (seg) parts.push({ s, off: seg.off });
    }
    if (parts.length < 3) continue;
    const mdlsSeg = parts.find((p) => p.s === 'MDLS');
    const bones = mdlsSeg ? boneCountOf(buf, mdlsSeg.off) : -1;
    // 各段后 u32 (可能的大小)
    const info = parts.map((p) => {
      const v = buf.readUInt32LE(p.off + 9);
      return p.s + '@' + p.off + '=u32' + v;
    }).join(' ');
    console.log(id + '/' + m.name.split('/').pop() + ' 骨' + bones + ': ' + info);
  }
}
