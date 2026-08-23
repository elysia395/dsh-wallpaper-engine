import fs from 'fs';
const animData = JSON.parse(fs.readFileSync('D:/dsh-wallpaper-engine/scene-layers-out/mdla-anim-data.json', 'utf8'));

// 动画2: 找 f=12..600 内方向反转次数多的骨骼 (快速往返 = 眨眼/颤抖)
console.log('=== 动画2 方向反转次数 (f=12..600) ===');
for (let b = 0; b < 53; b++) {
  const frames = animData.anim2.perBone[b].frames;
  // 用 rotZ 或 pos 检测反转
  let reversals = 0;
  let prevDir = 0;
  let prevVal = frames[12].pos[1];
  for (let f = 13; f < 601; f++) {
    const v = frames[f].pos[1];
    const d = v - prevVal;
    if (Math.abs(d) > 0.05) {
      const dir = d > 0 ? 1 : -1;
      if (prevDir !== 0 && dir !== prevDir) reversals++;
      prevDir = dir;
    }
    prevVal = v;
  }
  if (reversals > 3) console.log(`  B${String(b).padStart(2)}: pos.y 反转 ${reversals} 次`);
}

// 动画2 B22 完整 pos.y 曲线 (看摆动次数)
console.log('\n=== 动画2 B22 pos.y 曲线 (f=12..600, 每 20 帧) ===');
for (let f = 12; f < 601; f += 20) {
  const y = animData.anim2.perBone[22].frames[f].pos[1];
  console.log(`  f=${String(f).padStart(3)}: ${y.toFixed(1)}`);
}

// 动画2 B34 (rotZ 0.445) 曲线
console.log('\n=== 动画2 B34 rotZ 曲线 (f=12..300, 每 10 帧) ===');
for (let f = 12; f < 301; f += 10) {
  const r = animData.anim2.perBone[34].frames[f].rot[2];
  console.log(`  f=${String(f).padStart(3)}: rotZ=${r.toFixed(3)}`);
}
