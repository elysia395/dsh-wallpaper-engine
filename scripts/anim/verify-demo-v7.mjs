import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/';
const html = fs.readFileSync(dir + 'particles-demo.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script');
new Function(m[1]);
console.log('demo JS 语法 OK');

// 人物：origin (2115.1, 654.6) → 屏幕 (2115.1, 1505.4)
// 贴图 3584x3776，texOffset (665,151)，紧凑图 2411x2491
// 绘制位置 = 屏幕origin - 贴图/2 + texOffset → 紧凑图左上角屏幕坐标
const H = 2160;
const charOrigin = [2115.1, H - 654.6];
const texSize = [3584, 3776];
const offset = [665, 151];
const size = [2411, 2491];
const left = charOrigin[0] - texSize[0] / 2 + offset[0];
const top = charOrigin[1] - texSize[1] / 2 + offset[1];
console.log('人物紧凑图屏幕范围: x[' + left.toFixed(0) + ',' + (left + size[0]).toFixed(0) + '] y[' + top.toFixed(0) + ',' + (top + size[1]).toFixed(0) + ']');
console.log('画布 3840x2160: 角色可见 y[' + Math.max(0, top).toFixed(0) + ',' + Math.min(2160, top + size[1]).toFixed(0) + ']');

// 后发
const hOrigin = [1321.6, H - 1254.2];
const hLeft = hOrigin[0] - 2240 / 2 + 241;
const hTop = hOrigin[1] - 2752 / 2 + 753;
console.log('后发紧凑图屏幕范围: x[' + hLeft.toFixed(0) + ',' + (hLeft + 1999).toFixed(0) + '] y[' + hTop.toFixed(0) + ',' + (hTop + 1700).toFixed(0) + ']');
