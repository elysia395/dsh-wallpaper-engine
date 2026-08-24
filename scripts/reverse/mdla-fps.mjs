// 读 MDLA 动画记录头: 帧时长 float → fps
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 动画0 记录 @0x25fc, 动画1 @0x123ea (从 find-anim1-id 得知名字在 0x123ee)
const anims = [
  { name: '动画0', rec: 0x25fc },
  { name: '动画1', rec: 0x123b6 }, // 名字在 0x123ee
];
for (const a of anims) {
  console.log(`=== ${a.name} @0x${a.rec.toString(16)} ===`);
  // 打印记录头前 0x30 字节的 u32 和 float
  for (let off = a.rec; off < a.rec + 0x30; off += 4) {
    const u32 = dv.getUint32(off, true);
    const fl = dv.getFloat32(off, true);
    console.log(`  0x${off.toString(16)}: u32=${u32} float=${fl.toFixed(6)}`);
  }
}
// 找名字后 [f0 41] 前的 float (帧时长)
for (const a of anims) {
  // 找名字
  const p0 = a.rec + 8;
  const nameEnd = buf.indexOf(0, p0);
  console.log(`${a.name} 名字 @0x${p0.toString(16)}-0x${nameEnd.toString(16)}: "${buf.toString('utf8', p0, nameEnd)}"`);
  // 名字后到 [f0 41]
  let q = nameEnd + 1;
  while (q + 1 < buf.length && !(buf[q] === 0xf0 && buf[q + 1] === 0x41)) q++;
  console.log(`  名字后到 [f0 41] (0x${q.toString(16)}): 间隔 ${q - nameEnd - 1} 字节`);
  // 间隔内的 float
  if (q - nameEnd - 1 >= 4) {
    for (let off = nameEnd + 1; off + 4 <= q; off += 4) {
      console.log(`    float@0x${off.toString(16)} = ${dv.getFloat32(off, true).toFixed(6)}`);
    }
  }
}
