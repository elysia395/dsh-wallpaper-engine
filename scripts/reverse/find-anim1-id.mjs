// 搜 u32=690 (动画1 ID) 定位动画1 记录
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// 动画0 理论数据尾 0x123b6
const tail0 = 0x123b6;
console.log(`动画0 理论尾 0x${tail0.toString(16)} → 到 0x${(tail0 + 300).toString(16)} 的 u32 序列:`);
for (let i = tail0; i < tail0 + 300; i += 4) {
  const v = dv.getUint32(i, true);
  if (v !== 0 && v < 100000) {
    console.log(`  0x${i.toString(16)}: ${v}`);
  }
}
// 搜 690 出现位置 (动画1 ID)
console.log('\n搜 u32=690 的位置:');
let count = 0;
for (let i = 0x123b6; i < buf.length - 4 && count < 10; i += 4) {
  if (dv.getUint32(i, true) === 690) {
    console.log(`  0x${i.toString(16)}: 690`);
    count++;
  }
}
// 搜 u32=374 出现 (动画0 ID 参照)
console.log('\n搜 u32=374 的位置 (参照):');
count = 0;
for (let i = 0; i < buf.length - 4 && count < 5; i += 4) {
  if (dv.getUint32(i, true) === 374) {
    console.log(`  0x${i.toString(16)}: 374`);
    count++;
  }
}
// 检查 0x123b6 附近字节
console.log('\n0x123b0-0x12400 字节:');
console.log(Array.from(buf.subarray(0x123b0, 0x12400)).map(b => b.toString(16).padStart(2, '0')).join(' '));
// ASCII 显示
let asc = '';
for (let i = 0x123b0; i < 0x12400; i++) asc += (buf[i] >= 0x20 && buf[i] < 0x7f) ? String.fromCharCode(buf[i]) : '.';
console.log(asc);
