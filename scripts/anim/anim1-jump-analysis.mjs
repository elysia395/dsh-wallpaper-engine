import fs from 'fs';
const animData = JSON.parse(fs.readFileSync('D:/dsh-wallpaper-engine/scene-layers-out/mdla-anim-data.json', 'utf8'));

// 动画1 在 f40→f41 突变: 检查所有骨骼在 f40/f41 的 pos
console.log('=== 动画1 f39/f40/f41 各骨骼 pos ===');
for (let b = 0; b < 53; b++) {
  const p39 = animData.anim1.perBone[b].frames[39]?.pos;
  const p40 = animData.anim1.perBone[b].frames[40]?.pos;
  const p41 = animData.anim1.perBone[b].frames[41]?.pos;
  const d1 = p39 && p40 ? Math.abs(p40[0]-p39[0]) + Math.abs(p40[1]-p39[1]) : 0;
  const d2 = p40 && p41 ? Math.abs(p41[0]-p40[0]) + Math.abs(p41[1]-p40[1]) : 0;
  if (d1 > 1 || d2 > 1) {
    console.log(`  B${b}: f39=(${p39[0].toFixed(1)},${p39[1].toFixed(1)}) f40=(${p40[0].toFixed(1)},${p40[1].toFixed(1)}) f41=(${p41[0].toFixed(1)},${p41[1].toFixed(1)}) d39-40=${d1.toFixed(1)} d40-41=${d2.toFixed(1)}`);
  }
}

// 动画1 f40 是否有骨骼 scale 变化
console.log('\n=== 动画1 f40 scale 异常 ===');
for (let b = 0; b < 53; b++) {
  const sc = animData.anim1.perBone[b].frames[40]?.scale;
  if (sc && (Math.abs(sc[0]) < 0.9 || Math.abs(sc[1]) < 0.9)) {
    console.log(`  B${b}: scale=(${sc.join(',')})`);
  }
}
