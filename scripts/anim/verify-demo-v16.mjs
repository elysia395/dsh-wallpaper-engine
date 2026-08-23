import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out';
const html = fs.readFileSync(dir + '/particles-demo.html', 'utf8');

// 验证所有引用的帧/资源
const checks = [
  '背景.png', '水.png', '伞.png',
  'particle_leaves.png', 'particle_layer44.png', 'particle_layer39.png',
  'particle_flare1.png', 'particle_halo6.png', 'particle_debris1.png',
];
for (const c of checks) {
  if (!fs.existsSync(dir + '/' + c)) console.log('缺失:', c);
}
// 帧目录
for (const d of ['breath_frames', 'anim1_uniform', 'backhair_frames']) {
  const n = fs.existsSync(dir + '/' + d) ? fs.readdirSync(dir + '/' + d).filter(f => f.endsWith('.png')).length : 0;
  console.log(`${d}: ${n} 帧`);
}

// 后发动画帧实际尺寸 (读 PNG 头)
function pngSize(p) {
  const b = fs.readFileSync(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
console.log('后发帧尺寸:', JSON.stringify(pngSize(dir + '/backhair_frames/frame_00.png')));
console.log('呼吸帧尺寸:', JSON.stringify(pngSize(dir + '/breath_frames/frame_00.png')));
console.log('眨眼帧尺寸:', JSON.stringify(pngSize(dir + '/anim1_uniform/frame_012.png')));

// 验证 drawOffset: 后发 offset.json
const off = JSON.parse(fs.readFileSync(dir + '/backhair_frames.offset.json', 'utf8'));
console.log('后发 offset.json:', JSON.stringify(off));
