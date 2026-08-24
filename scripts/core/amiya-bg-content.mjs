// 检查: 1) 背景314纹理内容 (是否含角色身体) 2) 身体407 model是否puppet 3) 完整帧各组件位置
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
// 背景纹理内容分布
const bg = r.objects.find(x => x.id === 314);
const bgTex = r.loadModelTexture(bg.image);
console.log('背景纹理:', bgTex.width, 'x', bgTex.height);
const d = bgTex.rgba;
// 每 10% 高度统计非透明像素 (背景应全屏)
for (let band = 0; band < 10; band++) {
  let nz = 0;
  const h10 = Math.floor(bgTex.height / 10);
  for (let y = band * h10; y < (band + 1) * h10 && y < bgTex.height; y++) {
    for (let x = 0; x < bgTex.width; x++) {
      if (d[(y * bgTex.width + x) * 4 + 3] > 10) nz++;
    }
  }
  console.log(`  背景 y ${(band*10)}-${(band+1)*10}%: ${nz} 非透明`);
}
// 身体407 model
const body = r.objects.find(x => x.id === 407);
const bodyModel = r.readJsonAny(body.image);
console.log('身体407 model:', JSON.stringify(bodyModel));
// 头697 model
const head = r.objects.find(x => x.id === 697);
const headModel = r.readJsonAny(head.image);
console.log('头697 model puppet:', headModel.puppet);
