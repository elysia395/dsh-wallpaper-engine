import fs from 'fs';
const animData = JSON.parse(fs.readFileSync('D:/dsh-wallpaper-engine/scene-layers-out/mdla-anim-data.json', 'utf8'));

// 人物 anim1 (133帧) 所有骨骼的运动特征
console.log('=== 人物 anim1 各骨骼运动 (f=12..132, 排除特殊帧) ===');
const active = [];
for (let b = 0; b < 53; b++) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, maxR = 0;
  for (let f = 12; f < 133; f++) {
    const p = animData.anim1.perBone[b].frames[f];
    if (!p || !isFinite(p.pos[0])) continue;
    if (p.pos[0] < minX) minX = p.pos[0]; if (p.pos[0] > maxX) maxX = p.pos[0];
    if (p.pos[1] < minY) minY = p.pos[1]; if (p.pos[1] > maxY) maxY = p.pos[1];
    const r = Math.abs(p.rot[3]) + Math.abs(p.rot[4]) + Math.abs(p.rot[5]);
    if (r > maxR) maxR = r;
  }
  const dx = maxX - minX, dy = maxY - minY;
  if (dx > 0.3 || dy > 0.3 || maxR > 0.005) {
    active.push(b);
    console.log(`  B${String(b).padStart(2)}: Δpos=(${dx.toFixed(1)},${dy.toFixed(1)}) maxRot=${maxR.toFixed(3)}`);
  }
}
console.log('anim1 活跃骨骼:', active.join(','), '(', active.length, ')');

// anim1 完整 B4 曲线 (确认是眉毛还是身体)
console.log('\n=== anim1 B4 逐帧 pos (f=12..132, 每5帧) ===');
for (let f = 12; f < 133; f += 5) {
  const p = animData.anim1.perBone[4].frames[f];
  console.log(`  f=${String(f).padStart(3)}: pos=(${p.pos[0].toFixed(1)},${p.pos[1].toFixed(1)})`);
}

// anim1 其他活跃骨骼曲线
console.log('\n=== anim1 其他活跃骨骼 f=12, 60, 120 ===');
for (const b of active.filter(x => x !== 4).slice(0, 15)) {
  const p12 = animData.anim1.perBone[b].frames[12];
  const p60 = animData.anim1.perBone[b].frames[60];
  const p120 = animData.anim1.perBone[b].frames[120];
  console.log(`  B${b}: f12=(${p12.pos[0].toFixed(1)},${p12.pos[1].toFixed(1)}) f60=(${p60.pos[0].toFixed(1)},${p60.pos[1].toFixed(1)}) f120=(${p120.pos[0].toFixed(1)},${p120.pos[1].toFixed(1)})`);
}
