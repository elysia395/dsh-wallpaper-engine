// 1) 用 sharp 解 preview.gif 并裁剪 frame0 (顶部 220 行) — 可靠真值
// 2) 测量头部纹理 alpha 包围盒 (slab 在纹理中的位置)
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import fs from 'fs';

// --- 1) preview.gif frame0 ---
const gifBuf = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/preview.gif');
const meta = await sharp(gifBuf, { animated: true }).metadata();
console.log('gif meta:', meta.width, 'x', meta.height, 'pages:', meta.pages);
const frame0 = await sharp(gifBuf, { animated: true })
  .extract({ left: 0, top: 0, width: 220, height: 220 })
  .png()
  .toBuffer();
fs.writeFileSync('scene-layers-out/part_analysis/preview_frame0.png', frame0);
// 6x 放大
await sharp(frame0).resize(220*6, 220*6, { kernel: 'nearest' }).png()
  .toFile('scene-layers-out/part_analysis/preview_frame0_6x.png');
console.log('frame0 saved');

// --- 2) 头部纹理 alpha bbox ---
// 从 pkg 里取头纹理
const mod = await import('../lib/scene-renderer.js');
const pkg = mod.readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');
const scene = pkg.readJson('scene.json');
const headObj = scene.objects.find(x => String(x.id) === '697');
const model = pkg.readJson(headObj.image);
console.log('head model texture key present:', 'texture' in model, model.texture);
// material 里有纹理引用
const mat = model.material ? pkg.readJson(model.material) : null;
console.log('material keys:', mat ? Object.keys(mat) : null);
// 纹理通常在 material.texture 或 model 的 pass
function findTextureRef(obj, depth) {
  if (!obj || depth > 4) return null;
  if (typeof obj === 'string') return obj.includes('.') ? obj : null;
  if (Array.isArray(obj)) { for (const x of obj) { const r = findTextureRef(x, depth+1); if (r) return r; } return null; }
  if (typeof obj === 'object') {
    for (const k of ['texture','file','image','path','texturefile']) {
      if (typeof obj[k] === 'string' && (obj[k].endsWith('.tex') || obj[k].endsWith('.png') || obj[k].endsWith('.jpg'))) return obj[k];
    }
    for (const k of Object.keys(obj)) { const r = findTextureRef(obj[k], depth+1); if (r) return r; }
  }
  return null;
}
const texRef = findTextureRef(model) || findTextureRef(mat);
console.log('texture ref:', texRef);
if (texRef) {
  // 用 pkg-extract 的 parseTex 解码
  const { parseTex, decodeTex } = await import('../lib/pkg-extract.js');
  const texBytes = pkg.read(texRef);
  const parsed = parseTex(texBytes);
  console.log('parseTex result keys:', parsed ? Object.keys(parsed) : 'null', 'type:', parsed && parsed.type);
  if (parsed && parsed.type === 'TEXV0005') {
    const img = decodeTex(parsed);
    console.log('decoded texture:', img.width, 'x', img.height, 'channels:', img.channels);
    // alpha bbox + 非透明像素占比
    const { width, height } = img;
    const d = img.data; // RGBA
    let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (d[(y*width+x)*4+3] > 16) {
          count++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    console.log(`slab alpha bbox: x[${minX},${maxX}] w=${maxX-minX+1}, y[${minY},${maxY}] h=${maxY-minY+1}`);
    console.log(`non-transparent px: ${count} (${(100*count/(width*height)).toFixed(1)}%), 纹理尺寸 ${width}x${height}`);
    console.log(`slab 中心: (${(minX+maxX)/2}, ${(minY+maxY)/2}) vs 纹理中心 (${width/2}, ${height/2})`);
    // 保存 slab 裁剪
    await sharp(Buffer.from(d), { raw: { width, height, channels: 4 } })
      .extract({ left: minX, top: minY, width: maxX-minX+1, height: maxY-minY+1 })
      .png().toFile('scene-layers-out/part_analysis/head_slab_bbox.png');
    console.log('slab bbox png saved');
  } else {
    console.log('texture 类型不支持或为空');
  }
}
