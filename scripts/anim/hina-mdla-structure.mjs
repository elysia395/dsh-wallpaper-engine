// 分析 Hina MDLA 动画段布局: 扫描结构找帧/骨骼组织
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3554161528/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 66);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

const mdla = buf.indexOf('MDLA');
console.log('MDLA @ ' + mdla);
let p = mdla + 9;
p += 4; // 总字节
const animCount = dv.getUint32(p, true); p += 4;
console.log('动画数: ' + animCount);
for (let a = 0; a < animCount && p + 12 < buf.length; a++) {
  p += 8;
  const nameEnd = buf.indexOf(0, p);
  const name = buf.toString('utf8', p, nameEnd);
  p = nameEnd + 1;
  const loopEnd = buf.indexOf(0, p);
  p = loopEnd + 1;
  // 找 [f0 41]
  while (p + 1 < buf.length && !(buf[p] === 0xf0 && buf[p + 1] === 0x41)) p++;
  p += 2;
  const frameCount = dv.getUint16(p, true); p += 2;
  p += 2;
  p += 4;
  const boneCount = dv.getUint32(p, true); p += 4;
  p += 4;
  const segBytes = dv.getUint32(p, true); p += 4;
  const segStart = p;
  console.log(`动画${a} '${name}': frames=${frameCount} bones=${boneCount} segBytes=${segBytes} segStart=${segStart}`);
  // 分析段结构: 从 segStart 打印前 128 floats
  const floats = [];
  for (let i = 0; i < Math.min(64, segBytes / 4); i++) floats.push(dv.getFloat32(segStart + i * 4, true).toFixed(2));
  console.log('  段前64 floats: ' + floats.join(' '));
  // 找帧边界: 假设每帧 = 36B 或 72B 或其它, 统计平滑性
  for (const frameSize of [36, 72, 108, 144, 256, 2736]) {
    const n = Math.floor(segBytes / frameSize);
    if (segBytes % frameSize === 0 && n >= 1) console.log(`  可整除帧大小 ${frameSize} → ${n} 帧 (frames=${frameCount})`);
  }
  p += segBytes;
}
