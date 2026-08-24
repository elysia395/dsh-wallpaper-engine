// 对比 puppet 锚点: 我的 (origin+raw) vs lwe (size/2+raw 经 mvp)
// 检查 lwe 的 resolveGeometrySize 语义: size 是场景尺寸还是纹理尺寸
import fs from 'node:fs';
// 看 lwe resolveGeometrySize
const src = fs.readFileSync('D:/dsh-wallpaper-engine/_refs/linux-wallpaperengine/src/WallpaperEngine/Render/Objects/CImage.cpp', 'utf8');
const i1 = src.indexOf('resolveGeometrySize');
console.log('=== resolveGeometrySize ===');
console.log(src.slice(i1 - 50, i1 + 900));
