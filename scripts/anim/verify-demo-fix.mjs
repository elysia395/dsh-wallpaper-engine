import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out';
const html = fs.readFileSync(dir + '/particles-demo.html', 'utf8');

// 1. 检查所有 img 标签
const imgs = [...html.matchAll(/<img id="([^"]+)" src="([^"]+)"/g)].map(m => [m[1], m[2]]);
console.log('=== img 标签 ===');
for (const [id, src] of imgs) {
  const exists = fs.existsSync(dir + '/' + src);
  console.log(`  ${id} → ${src} ${exists ? '✓' : '✗'}`);
}

// 2. 主循环引用的 5 个图层 id 是否都有 img 标签
const layerIds = ['i_背景', 'i_水', 'i_后发', 'i_人物', 'i_伞'];
const htmlIds = imgs.map(i => i[0]);
console.log('\n=== 图层 id 检查 ===');
for (const id of layerIds) {
  console.log(`  ${id}: ${htmlIds.includes(id) ? '✓ 有 img 标签' : '✗ 缺失!'}`);
}

// 3. 帧引用检查
console.log('\n=== 动画帧引用 ===');
for (const [prefix, count, pad] of [['breath_frames/frame_', 61, 2], ['anim1_uniform/frame_', 133, 3], ['backhair_frames/frame_', 133, 2]]) {
  let missing = 0;
  for (let i = 0; i < count; i++) {
    const p = dir + '/' + prefix + String(i).padStart(pad, '0') + '.png';
    if (!fs.existsSync(p)) missing++;
  }
  console.log(`  ${prefix}*: ${missing === 0 ? `✓ 全部 ${count} 帧存在` : `✗ 缺 ${missing} 帧`}`);
}

// 4. JS 语法
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (m) {
  try { new Function(m[1]); console.log('\nJS 语法: ✓'); }
  catch (e) { console.log('\nJS 语法错误:', e.message); }
}
