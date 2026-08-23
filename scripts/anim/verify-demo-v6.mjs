import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/';
const html = fs.readFileSync(dir + 'particles-demo.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script');
new Function(m[1]);
console.log('demo JS 语法 OK');
for (const f of ['人物_完整.png', '后发_完整.png', '背景.png', '水.png', '伞.png']) {
  const p = dir + f;
  console.log(f, fs.existsSync(p) ? 'OK ' + fs.statSync(p).size + 'B' : 'MISSING');
}
// 人物完整贴图位置：origin (2115.1, 654.6) → 屏幕 (2115.1, 1505.4), size 3584x3776
const H = 2160;
console.log('\n人物贴图: 屏幕中心(2115,1505), 覆盖 y[' + (1505.4 - 1888).toFixed(0) + ',' + (1505.4 + 1888).toFixed(0) + ']');
console.log('后发贴图: 屏幕中心(1322,906), 覆盖 y[' + (905.8 - 1376).toFixed(0) + ',' + (905.8 + 1376).toFixed(0) + ']');
