// Amiya 头 animationlayers 引用分析
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });

// scene.json 对象 id=374/690/537
for (const o of r.scene.objects) {
  if ([374, 690, 537].includes(o.id)) {
    console.log('对象 ' + o.id + ': ' + JSON.stringify(o).slice(0, 300));
  }
}
// 头 MDL 动画名
const o = r.scene.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = buf.indexOf('MDLA');
let p = mdla + 9 + 4;
const animCount = dv.getUint32(p, true);
p += 4;
console.log('头 MDL 动画数: ' + animCount);
for (let a = 0; a < animCount && p + 8 < buf.length; a++) {
  p += 8;
  const nameEnd = buf.indexOf(0, p);
  if (nameEnd < 0) break;
  const name = buf.toString('utf8', p, nameEnd);
  console.log('MDLA 动画' + a + ' 名: "' + name + '"');
  p = nameEnd + 1;
  const loopEnd = buf.indexOf(0, p);
  if (loopEnd < 0) break;
  p = loopEnd + 1;
  while (p + 1 < buf.length && !(buf[p] === 0xf0 && buf[p + 1] === 0x41)) p++;
  p += 2 + 2 + 4;
  const boneCount = dv.getUint32(p, true);
  p += 4 + 4;
  const segBytes = dv.getUint32(p, true);
  p += 4;
  p += segBytes * boneCount;
}
// 467 的动画 (animation=537)
const o467 = r.scene.objects.find(x => x.id === 467);
const m467 = r.readJsonAny(o467.image);
const buf467 = r.pkg.read(m467.puppet);
const dv467 = new DataView(buf467.buffer, buf467.byteOffset, buf467.byteLength);
const mdla467 = buf467.indexOf('MDLA');
let q = mdla467 + 9 + 4;
const ac467 = dv467.getUint32(q, true);
q += 4;
console.log('467 MDL 动画数: ' + ac467);
for (let a = 0; a < ac467 && q + 8 < buf467.length; a++) {
  q += 8;
  const nameEnd = buf467.indexOf(0, q);
  if (nameEnd < 0) break;
  const name = buf467.toString('utf8', q, nameEnd);
  console.log('467 MDLA 动画' + a + ' 名: "' + name + '"');
  q = nameEnd + 1;
  const loopEnd = buf467.indexOf(0, q);
  if (loopEnd < 0) break;
  q = loopEnd + 1;
  while (q + 1 < buf467.length && !(buf467[q] === 0xf0 && buf467[q + 1] === 0x41)) q++;
  q += 2 + 2 + 4;
  const boneCount = dv467.getUint32(q, true);
  q += 4 + 4;
  const segBytes = dv467.getUint32(q, true);
  q += 4;
  q += segBytes * boneCount;
}
