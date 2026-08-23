// 分对象渲染 demon_core: 单独 core / 单独 bgsphere / 全场景, 并输出 preview 对比
import { SceneRenderer, encodePng } from '../lib/scene-renderer.js';
import fs from 'fs';

const base = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/scene.json';
const out = 'D:/dsh-wallpaper-engine/scene-layers-out/re-render';
fs.mkdirSync(out, { recursive: true });

async function renderOnly(keep, name, t = 0) {
  const r = new SceneRenderer(base, { width: 1280, height: 720, time: t, log: () => {} });
  // 保留指定对象, 其余丢弃
  r.objects = r.objects.filter((o) => keep(o));
  r.renderOrder = r.objects;
  const c = r.render();
  fs.writeFileSync(`${out}/${name}.png`, encodePng(c.w, c.h, c.data));
  // 统计
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (let i = 0; i < c.data.length; i += 4) { rSum += c.data[i]; gSum += c.data[i+1]; bSum += c.data[i+2]; n++; }
  console.log(`${name}: avg rgb=(${(rSum/n).toFixed(0)},${(gSum/n).toFixed(0)},${(bSum/n).toFixed(0)})`);
}

await renderOnly((o) => o.id === 6, 'demon_core_core_only');
await renderOnly((o) => o.id === 7, 'demon_core_bgsphere_only');
await renderOnly(() => true, 'demon_core_full_t0');
await renderOnly(() => true, 'demon_core_full_t3', 3);

// preview.jpg 复制对比
fs.copyFileSync(
  'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/preview.jpg',
  `${out}/demon_core_preview.jpg`
);
console.log('done');
