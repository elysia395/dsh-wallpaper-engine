// 分析 Amiya MDL 文件的段结构: MDLS/MDLA/MDLE/PUED 等
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
console.log(`MDL 大小: ${buf.length}`);
// 找所有段标记
const marks = ['MDLV', 'MDLS', 'MDLA', 'MDLE', 'MDLP', 'PUED', 'MDLX'];
const found = [];
for (const mk of marks) {
  let idx = 0;
  while ((idx = buf.indexOf(Buffer.from(mk), idx)) >= 0) {
    // 读段名 (标记 + 版本号, 如 MDLA0006)
    let name = mk;
    let i = idx + mk.length;
    while (i < buf.length && buf[i] >= 0x30 && buf[i] <= 0x39 && name.length < 12) { name += String.fromCharCode(buf[i]); i++; }
    found.push({ off: idx, name });
    idx += mk.length;
  }
}
found.sort((a, b) => a.off - b.off);
console.log('段标记:');
found.forEach(f => console.log(`  0x${f.off.toString(16)}: ${f.name}`));
// 段间大小
for (let i = 0; i < found.length - 1; i++) {
  const size = found[i + 1].off - found[i].off;
  console.log(`  ${found[i].name} @0x${found[i].off.toString(16)} → 大小 ${size} (到 ${found[i+1].name})`);
}
// 最后一段到末尾
if (found.length) {
  const last = found[found.length - 1];
  console.log(`  ${last.name} @0x${last.off.toString(16)} → 到末尾 ${buf.length - last.off}`);
}
// PUED0002 详情: 前 64 字节
const pued = found.find(f => f.name.startsWith('PUED'));
if (pued) {
  console.log(`\nPUED0002 @0x${pued.off.toString(16)} 前 80 字节:`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const bytes = [];
  for (let i = 0; i < 80; i++) bytes.push(buf[pued.off + i].toString(16).padStart(2, '0'));
  console.log('  ' + bytes.join(' '));
  // u32 解读
  const u32s = [];
  for (let i = 0; i < 40; i++) u32s.push(dv.getUint32(pued.off + 9 + i * 4, true));
  console.log('  u32 (从+9): ' + u32s.slice(0, 15).join(', '));
}
