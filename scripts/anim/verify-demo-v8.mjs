import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/';
const html = fs.readFileSync(dir + 'particles-demo.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script');
new Function(m[1]);
console.log('demo JS 语法 OK');

// 人物: origin (2115.1, 654.6) → 屏幕 (2115.1, 1505.4)
// drawOffset (-1122, -1732), size 2401×2481
const H = 2160;
const charOrigin = [2115.1, H - 654.6];
const off = [-1122, -1732], size = [2401, 2481];
const left = charOrigin[0] + off[0], top = charOrigin[1] + off[1];
console.log('人物屏幕: x[' + left.toFixed(0) + ',' + (left + size[0]).toFixed(0) + '] y[' + top.toFixed(0) + ',' + (top + size[1]).toFixed(0) + ']');
console.log('画布 3840x2160: 可见 y[' + Math.max(0, top).toFixed(0) + ',' + Math.min(2160, top + size[1]).toFixed(0) + ']');

// 后发: origin (1321.6, 1254.2) → 屏幕 (1321.6, 905.8)
const hOff = [-875, -618], hSize = [2232, 1690];
const hOrigin = [1321.6, H - 1254.2];
console.log('后发屏幕: x[' + (hOrigin[0] + hOff[0]).toFixed(0) + ',' + (hOrigin[0] + hOff[0] + hSize[0]).toFixed(0) + '] y[' + (hOrigin[1] + hOff[1]).toFixed(0) + ',' + (hOrigin[1] + hOff[1] + hSize[1]).toFixed(0) + ']');
