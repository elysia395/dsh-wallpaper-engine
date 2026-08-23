import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/';
const html = fs.readFileSync(dir + 'particles-demo.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script');
new Function(m[1]);
console.log('demo JS 语法 OK');
for (const f of ['人物_完整.png', '后发_完整.png']) {
  const p = dir + f;
  console.log(f, fs.existsSync(p) ? 'OK ' + fs.statSync(p).size + 'B' : 'MISSING');
}
// 位置
const H = 2160;
console.log('\n人物: origin(2115,655) → 屏幕中心(2115,1505), 贴图 3550x3750 → y[' + (1505.4-1875) + ',' + (1505.4+1875) + ']');
console.log('后发: origin(1322,1254) → 屏幕中心(1322,906), 贴图 2200x2740 → y[' + (905.8-1370) + ',' + (905.8+1370) + ']');
console.log('画布 2160: 人物可见 y[0,2160]（头顶-370被裁为立绘构图）, 后发 y[0,2160]');
