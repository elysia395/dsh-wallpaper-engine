// 检查身体 407 纹理内容分布 — 躯干像素在纹理中的位置
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 407);
const tex = r.loadModelTexture(o.image);
console.log('身体纹理:', tex.width, 'x', tex.height);
// 每 10% 高度统计非透明像素
const d = tex.rgba;
const h10 = Math.floor(tex.height / 10);
for (let band = 0; band < 10; band++) {
  let nz = 0;
  for (let y = band * h10; y < (band + 1) * h10 && y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) {
      if (d[(y * tex.width + x) * 4 + 3] > 10) nz++;
    }
  }
  console.log(`  y ${(band*h10).toString().padStart(4)}-${((band+1)*h10-1).toString().padStart(4)} (${(band*10)}-${(band+1)*10}%): ${nz} 非透明像素`);
}
// 头纹理
const ho = r.objects.find(x => x.id === 697);
const htex = r.loadModelTexture(ho.image);
console.log('头纹理:', htex.width, 'x', htex.height);
const hd = htex.rgba;
const hh10 = Math.floor(htex.height / 10);
for (let band = 0; band < 10; band++) {
  let nz = 0;
  for (let y = band * hh10; y < (band + 1) * hh10 && y < htex.height; y++) {
    for (let x = 0; x < htex.width; x++) {
      if (hd[(y * htex.width + x) * 4 + 3] > 10) nz++;
    }
  }
  console.log(`  头 y ${(band*hh10).toString().padStart(4)}-${((band+1)*hh10-1).toString().padStart(4)}: ${nz} 非透明像素`);
}
