// 读 MDLA 段动画 ID (animationlayers.animation 匹配依据)
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = buf.indexOf('MDLA');
let p = mdla + 9;
console.log(`MDLA @0x${mdla.toString(16)}`);
console.log('MDLA 头 前 32 字节: ' + Array.from(buf.subarray(mdla, mdla + 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
// 段总字节
const total = dv.getUint32(p, true);
console.log(`总字节(头+9): ${total}`);
p += 4;
const animCount = dv.getUint32(p, true);
console.log(`动画数: ${animCount}`);
p += 4;
// 每个动画: ID + 名字 + 数据
for (let a = 0; a < animCount && p + 12 < buf.length; a++) {
  const animStart = p;
  const id1 = dv.getUint32(p, true);
  const id2 = dv.getUint32(p + 4, true);
  console.log(`动画${a} @0x${animStart.toString(16)}: u32[0]=${id1} u32[1]=${id2}`);
  p += 8;
  const nameEnd = buf.indexOf(0, p);
  if (nameEnd < 0) break;
  const name = buf.toString('utf8', p, nameEnd);
  console.log(`  名字: "${name}" (0x${p.toString(16)}-0x${nameEnd.toString(16)})`);
  p = nameEnd + 1;
  // 找 [f0 41]
  const f0pos = p;
  let q = p;
  while (q + 1 < buf.length && !(buf[q] === 0xf0 && buf[q + 1] === 0x41)) q++;
  console.log(`  名字后到 [f0 41]: 0x${q.toString(16)} (间隔 ${q - f0pos})`);
  q += 2;
  const frameCount = dv.getUint16(q, true);
  console.log(`  帧数: ${frameCount}`);
  // 继续找 boneCount/segBytes 用于跳过
  q += 2 + 2 + 4;
  const bc = dv.getUint32(q, true);
  q += 4 + 4;
  const sb = dv.getUint32(q, true);
  q += 4;
  console.log(`  bones=${bc} segBytes=${sb} 数据起点 0x${q.toString(16)} 数据尾 0x${(q + sb * bc).toString(16)}`);
  p = q + sb * bc;
}
