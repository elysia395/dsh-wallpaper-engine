// 场景渲染器测试: 渲染 Blue Archive-Plana 完整场景帧
import { SceneRenderer, encodePng } from '../lib/scene-renderer.js';
import fs from 'fs';

const pkgPath = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
const t = process.argv[2] ? parseFloat(process.argv[2]) : 0;
const outPath = process.argv[3] || 'D:/dsh-wallpaper-engine/scene-layers-out/renderer_test.png';

const log = (m) => console.log(m);
const r = new SceneRenderer(pkgPath, { width: 3840, height: 2160, time: t, log, assetDir: 'D:/dsh-wallpaper-engine/scene-layers-out' });

// 输出对象清单
console.log('对象总数:', r.objects.length);
for (const o of r.renderOrder) {
  console.log(`  #${o.id} ${o.name || ''} [${o._renderType}]`);
}

// 渲染
console.log('\n渲染中 (t=' + t + ')...');
const canvas = r.render();
const png = encodePng(canvas.w, canvas.h, canvas.data);
fs.writeFileSync(outPath, png);
console.log('输出:', outPath, png.length, 'B');

// 统计
let alpha = 0;
for (let i = 3; i < canvas.data.length; i += 4) if (canvas.data[i] > 8) alpha++;
console.log('非透明像素:', alpha, '/', canvas.w * canvas.h, '(' + (alpha / (canvas.w * canvas.h) * 100).toFixed(1) + '%)');
