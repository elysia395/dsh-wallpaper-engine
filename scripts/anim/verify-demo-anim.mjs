import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/';
const html = fs.readFileSync(dir + 'particles-demo.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script');
new Function(m[1]);
console.log('demo JS 语法 OK');
// 检查动画帧
let allOk = true;
for (let f = 0; f < 24; f++) {
  const p = dir + 'anim_frames/frame_' + String(f).padStart(2, '0') + '.png';
  if (!fs.existsSync(p)) { console.log('MISSING frame', f); allOk = false; }
}
console.log(allOk ? '24 帧动画资源 OK' : '有缺失帧');
// 检查其他资源
for (const f of ['背景.png', '水.png', '伞.png', 'puppet_后发.png', 'particle_leaves.png', 'particle_layer44.png', 'particle_layer39.png', 'particle_flare1.png', 'particle_halo6.png', 'particle_debris1.png']) {
  if (!fs.existsSync(dir + f)) console.log('MISSING', f);
}
console.log('其他资源检查完成');
