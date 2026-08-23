// MDLA 骨骼流布局解析 (修正起点后)
// 条目结构: [u32 时长ms][u32 0][name\0][mode\0][pad][f0 41][u32 帧数][u32 0][u32 骨骼数][u32 0][u32 段字节] + 骨骼段
import { readPkg } from '../../lib/we-renderer/textures.js';

const pkg = readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');

function parseMDLA(mdl, name) {
  const u32 = (o) => mdl.readUInt32LE(o);
  const f32 = (o) => mdl.readFloatLE(o);
  const mdla = mdl.indexOf('MDLA');
  if (mdla < 0) return null;
  let p = mdla + 9;
  const total = u32(p); p += 4;
  const animCount = u32(p); p += 4;
  const anims = [];
  for (let a = 0; a < animCount; a++) {
    const dur = u32(p); p += 4;
    const zero = u32(p); p += 4;
    const nameEnd = mdl.indexOf(0, p);
    const aName = mdl.toString('utf8', p, nameEnd);
    p = nameEnd + 1;
    const loopEnd = mdl.indexOf(0, p);
    const mode = mdl.toString('utf8', p, loopEnd);
    p = loopEnd + 1;
    // pad 到 4 对齐, 然后 [f0 41] 前缀 (2 字节)
    while (p % 4 !== 0) p++;
    p += 2;
    const frameCount = u32(p); p += 4;
    const u1 = u32(p); p += 4;
    const boneCount = u32(p); p += 4;
    const u2 = u32(p); p += 4;
    const segBytes = u32(p); p += 4;
    const dataStart = p;
    anims.push({ dur, aName, mode, frameCount, boneCount, segBytes, dataStart });
    p = dataStart + segBytes * boneCount;
  }
  return anims;
}

for (const m of ['models/头_puppet.mdl', 'models/左大衣_puppet.mdl', 'models/眉毛_puppet.mdl', 'models/左眼_puppet.mdl']) {
  const mdl = pkg.read(m);
  const anims = parseMDLA(mdl, m);
  console.log('===', m, 'len', mdl.length);
  if (!anims) { console.log('  无 MDLA'); continue; }
  for (const a of anims) {
    console.log('  anim "' + a.aName + '" 时长' + a.dur + 'ms 帧' + a.frameCount + ' 骨骼' + a.boneCount + ' 段字节' + a.segBytes + ' 数据@' + a.dataStart);
    // 每骨骼段首块 (9 floats)
    for (let b = 0; b < Math.min(a.boneCount, 6); b++) {
      const so = a.dataStart + b * a.segBytes;
      const vals = Array.from({ length: 9 }, (_, k) => mdl.readFloatLE(so + k * 4).toFixed(2));
      console.log('    骨' + b + ' 首块 @' + so + ':', vals.join(','));
    }
  }
}
