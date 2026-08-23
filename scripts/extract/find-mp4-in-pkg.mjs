// 检查 scene.pkg 中的内置 MP4 视频 (ftyp 魔数)
import { SceneRenderer } from '../lib/scene-renderer.js';
import fs from 'fs';

const scenes = [
  { id: '3461168300', name: '普拉娜', pkg: 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3461168300/scene.pkg' },
  { id: '3470764447', name: '伊蕾娜', pkg: 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3470764447/scene.pkg' },
  { id: '3486806915', name: '阿米娅', pkg: 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg' },
];

for (const s of scenes) {
  if (!fs.existsSync(s.pkg)) { console.log(s.name, 'pkg 不存在'); continue; }
  const r = new SceneRenderer(s.pkg, { width: 1, height: 1, time: 0, log: () => {} });
  console.log('===== ' + s.name + ' =====');
  // 扫描所有条目, 找含 MP4 的
  const entries = r.pkg.entries();
  let mp4Found = 0;
  for (const e of entries) {
    // 检查条目内容是否 MP4 (ftyp)
    const raw = r.pkg.read(e);
    if (!raw || raw.length < 12) continue;
    const isMp4 = raw[4] === 0x66 && raw[5] === 0x74 && raw[6] === 0x79 && raw[7] === 0x70;
    if (isMp4) {
      // 读 box 大小和类型
      const boxSize = raw.readUInt32BE(0);
      const brand = raw.toString('latin1', 8, 12);
      mp4Found++;
      if (mp4Found <= 8) console.log('  MP4: ' + e + ' (' + raw.length + 'B, box=' + boxSize + ', brand=' + brand + ')');
    }
  }
  console.log('  MP4 纹理数:', mp4Found, '/', entries.length, '条目');
}
