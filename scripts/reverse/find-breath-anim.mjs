// 搜 Amiya 头 MDL 里的 "呼吸循环" 编码, 修正动画1 段定位
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);

// 找 UTF-8 编码的 "呼吸循环" (E5 91 BC E5 90 B8 E5 BE AA E7 8E AF)
const utf8 = Buffer.from('呼吸循环', 'utf8');
const idx = buf.indexOf(utf8);
console.log(`UTF-8 "呼吸循环" @0x${idx.toString(16)} (${idx >= 0 ? '找到' : '未找到'})`);
// 也试 GBK
const gbk = Buffer.from('呼吸循环', 'gbk');
const idx2 = buf.indexOf(gbk);
console.log(`GBK "呼吸循环" @0x${idx2.toString(16)}`);

// 找动画1 的名字区域: 动画0 段起点 + segBytes*boneCount 附近
const mdla = buf.indexOf('MDLA');
let p = mdla + 9 + 4;
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const animCount = dv.getUint32(p, true);
p += 4;
console.log(`MDLA @0x${mdla.toString(16)} animCount=${animCount}`);
// 手动解析动画0
p += 8;
const nameEnd0 = buf.indexOf(0, p);
const name0 = buf.toString('utf8', p, nameEnd0);
p = nameEnd0 + 1;
const loopEnd0 = buf.indexOf(0, p);
p = loopEnd0 + 1;
while (p + 1 < buf.length && !(buf[p] === 0xf0 && buf[p + 1] === 0x41)) p++;
p += 2;
const frameCount0 = dv.getUint16(p, true); p += 2;
p += 2 + 4;
const boneCount0 = dv.getUint32(p, true); p += 4 + 4;
const segBytes0 = dv.getUint32(p, true); p += 4;
console.log(`动画0: name="${name0}" frames=${frameCount0} bones=${boneCount0} segBytes=${segBytes0}`);
console.log(`动画0 数据起点 p=0x${p.toString(16)} 数据尾(理论)=0x${(p + segBytes0 * boneCount0).toString(16)}`);
// 检查数据尾附近字节
const tail = p + segBytes0 * boneCount0;
console.log(`数据尾附近 64 字节: ` + Array.from(buf.subarray(tail, tail + 64)).map(b => b.toString(16).padStart(2, '0')).join(' '));
// 从数据尾附近找下一个名字 (非空字符串)
for (let i = tail; i < Math.min(tail + 200, buf.length); i++) {
  // 可打印 ASCII 或 UTF-8 中文字节 (>=0x80)
  if (buf[i] >= 0x20 && buf[i] < 0x7f) {
    // 读字符串
    let j = i, s = '';
    while (j < buf.length && buf[j] !== 0 && j < i + 60) { s += String.fromCharCode(buf[j]); j++; }
    if (s.length >= 2) { console.log(`@0x${i.toString(16)}: "${s}"`); }
  }
}
