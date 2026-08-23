import fs from 'fs';
const animData = JSON.parse(fs.readFileSync('D:/dsh-wallpaper-engine/scene-layers-out/mdla-anim-data.json', 'utf8'));

// 动画1: 检查 B4 摆动首尾衔接 (循环性)
// 动画1 f=12 起有效。B4 在 f=12..132 的 pos.y
console.log('=== 动画1 B4 pos 循环性 ===');
const f12 = animData.anim1.perBone[4].frames[12].pos;
const f132 = animData.anim1.perBone[4].frames[132].pos;
console.log('f12:', f12.map(v => v.toFixed(2)).join(','), 'f132:', f132.map(v => v.toFixed(2)).join(','));
console.log('首尾差:', (f132[0]-f12[0]).toFixed(2), (f132[1]-f12[1]).toFixed(2));

// 动画1 B4 曲线峰值
let minY = 1e9, maxY = -1e9, minF = -1, maxF = -1;
for (let f = 12; f < 133; f++) {
  const y = animData.anim1.perBone[4].frames[f].pos[1];
  if (y < minY) { minY = y; minF = f; }
  if (y > maxY) { maxY = y; maxF = f; }
}
console.log(`B4 pos.y: min=${minY.toFixed(1)}@f${minF} max=${maxY.toFixed(1)}@f${maxF} 幅度=${(maxY-minY).toFixed(1)}`);

// 动画2: 检查是否有高频小幅度骨骼 (眨眼候选: 幅度 < 5px, 变化快)
console.log('\n=== 动画2 各骨骼运动特征 (f=12..600) ===');
for (let b = 0; b < 53; b++) {
  const frames = animData.anim2.perBone[b].frames;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  let maxRot = 0;
  for (let f = 12; f < 601; f++) {
    const p = frames[f].pos;
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    const r = Math.abs(frames[f].rot[2]);
    if (r > maxRot) maxRot = r;
  }
  const dx = maxX - minX, dy = maxY - minY;
  if (dx > 0.2 || dy > 0.2 || maxRot > 0.005) {
    console.log(`  B${String(b).padStart(2)}: Δpos=(${dx.toFixed(1)},${dy.toFixed(1)}) maxRotZ=${maxRot.toFixed(3)}`);
  }
}
