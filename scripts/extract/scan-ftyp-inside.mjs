// 检查伊蕾娜纹理内部是否含 ftyp (像 PR39 那样搜索)
import { SceneRenderer } from '../lib/scene-renderer.js';

const r = new SceneRenderer('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3470764447/scene.pkg', { width: 1, height: 1, time: 0, log: () => {} });

for (const t of ['60帧 伊蕾娜 ：静谧时光 昼夜变化', '60帧 伊蕾娜 ：静谧时光 白天', '60帧 伊蕾娜 ：静谧时光 清晨']) {
  const raw = r.pkg.read('materials/' + t + '.tex');
  if (!raw) continue;
  // 在纹理内搜索 ftyp (前 200 字节窗口, 像 PR39)
  let ftypOff = -1;
  for (let i = 0; i < 500 && i + 8 <= raw.length; i++) {
    if (raw[i] === 0x66 && raw[i+1] === 0x74 && raw[i+2] === 0x79 && raw[i+3] === 0x70) { ftypOff = i - 4; break; }
  }
  // 更广搜索
  if (ftypOff < 0) {
    for (let i = 0; i + 8 <= raw.length; i += 997) {
      if (raw[i] === 0x66 && raw[i+1] === 0x74 && raw[i+2] === 0x79 && raw[i+3] === 0x70) { ftypOff = i - 4; break; }
    }
  }
  console.log(t.slice(0, 15) + '...: ' + Math.round(raw.length/1024/1024) + 'MB, ftyp@' + (ftypOff >= 0 ? '0x' + ftypOff.toString(16) : '未找到'));
  if (ftypOff >= 0) {
    const brand = raw.toString('latin1', ftypOff + 8, ftypOff + 12);
    console.log('  MP4 brand:', brand, '剩余', raw.length - ftypOff, 'B');
  }
}
// 也检查普拉娜/阿米娅的人物纹理
for (const [name, pkg] of [
  ['普拉娜', 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3461168300/scene.pkg'],
  ['阿米娅', 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg'],
]) {
  const r2 = new SceneRenderer(pkg, { width: 1, height: 1, time: 0, log: () => {} });
  console.log('===== ' + name + ' =====');
  for (const e of r2.pkg.entries().filter(x => x.endsWith('.tex'))) {
    const raw = r2.pkg.read(e);
    if (!raw || raw.length < 10000) continue;
    let ftypOff = -1;
    for (let i = 0; i + 8 <= raw.length; i += 5003) {
      if (raw[i] === 0x66 && raw[i+1] === 0x74 && raw[i+2] === 0x79 && raw[i+3] === 0x70) { ftypOff = i - 4; break; }
    }
    if (ftypOff >= 0) console.log('  ' + e + ': ftyp@' + ftypOff.toString(16));
  }
}
