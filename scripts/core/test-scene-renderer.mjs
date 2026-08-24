// 鍦烘櫙娓叉煋鍣ㄦ祴璇? 娓叉煋 Blue Archive-Plana 瀹屾暣鍦烘櫙甯?
import { SceneRenderer, encodePng } from '../../lib/scene-renderer.js';
import fs from 'fs';

const pkgPath = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
const t = process.argv[2] ? parseFloat(process.argv[2]) : 0;
const outPath = process.argv[3] || 'D:/dsh-wallpaper-engine/scene-layers-out/renderer_test.png';

const log = (m) => console.log(m);
const r = new SceneRenderer(pkgPath, { width: 3840, height: 2160, time: t, log, assetDir: 'D:/dsh-wallpaper-engine/scene-layers-out' });

// 杈撳嚭瀵硅薄娓呭崟
console.log('瀵硅薄鎬绘暟:', r.objects.length);
for (const o of r.renderOrder) {
  console.log(`  #${o.id} ${o.name || ''} [${o._renderType}]`);
}

// 娓叉煋
console.log('\n娓叉煋涓?(t=' + t + ')...');
const canvas = r.render();
const png = encodePng(canvas.w, canvas.h, canvas.data);
fs.writeFileSync(outPath, png);
console.log('杈撳嚭:', outPath, png.length, 'B');

// 缁熻
let alpha = 0;
for (let i = 3; i < canvas.data.length; i += 4) if (canvas.data[i] > 8) alpha++;
console.log('闈為€忔槑鍍忕礌:', alpha, '/', canvas.w * canvas.h, '(' + (alpha / (canvas.w * canvas.h) * 100).toFixed(1) + '%)');
