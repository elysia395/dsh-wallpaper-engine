import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function readPng(file) {
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  let idat = Buffer.alloc(0);
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat = Buffer.concat([idat, buf.slice(pos + 8, pos + 8 + len)]);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(idat);
  const rgba = Buffer.alloc(w * h * 4);
  const stride = w * 4 + 1;
  for (let y = 0; y < h; y++) raw.copy(rgba, y * w * 4, y * stride + 1, (y + 1) * stride);
  return { w, h, rgba };
}

// 在场景坐标画布上放置两张图，比较人物主体
// 静态: origin(2115,654.6) drawOffset(-1122,-1732) size 2401x2481
// 动画: origin(2115,654.6) drawOffset(-1122,-1921.6) size 2402x2671
// 屏幕坐标: 图左上角 = (origin.x + dx, H - origin.y + dy)
const H = 2160;
const staticImg = readPng('D:/dsh-wallpaper-engine/scene-layers-out/puppet_人物.png');
const animImg = readPng('D:/dsh-wallpaper-engine/scene-layers-out/anim_frames_mdla/frame_012.png');

// 静态图屏幕位置
const sX = 2115.1 - 1122, sY = 2160 - 654.6 - 1732;
// 动画图屏幕位置
const aX = 2115.1 - 1122, aY = 2160 - 654.6 - 1921.6;

console.log('静态左上角屏幕:', sX, sY, '动画左上角屏幕:', aX, aY);

// 计算人物主体 (脸部/身体) 在屏幕中的位置 - 用内容框
function contentBox(img) {
  let minX = img.w, maxX = -1, minY = img.h, maxY = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY };
}
const sb = contentBox(staticImg), ab = contentBox(animImg);
console.log('静态内容屏幕位置: x[' + (sX + sb.minX) + '-' + (sX + sb.maxX) + '] y[' + (sY + sb.minY) + '-' + (sY + sb.maxY) + ']');
console.log('动画内容屏幕位置: x[' + (aX + ab.minX) + '-' + (aX + ab.maxX) + '] y[' + (aY + ab.minY) + '-' + (aY + ab.maxY) + ']');
console.log('人物顶部屏幕 y 差:', (aY + ab.minY) - (sY + sb.minY));
console.log('人物底部屏幕 y 差:', (aY + ab.maxY) - (sY + sb.maxY));
