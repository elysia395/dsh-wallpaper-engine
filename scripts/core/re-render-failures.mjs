// 用场景渲染器重渲诊断失败场景，保存 PNG 供目视检查
import { SceneRenderer, encodePng } from '../lib/scene-renderer.js';
import fs from 'fs';

const scenes = [
  { name: 'shimmering_particles', path: 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/shimmering_particles/scene.json', t: 5 },
  { name: 'demon_core', path: 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/scene.json', t: 5 },
  { name: 'dna_fragment', path: 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/dna_fragment/scene.json', t: 5 },
  { name: 'neon_sunset', path: 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/neon_sunset/scene.json', t: 5 },
];

const outDir = 'D:/dsh-wallpaper-engine/scene-layers-out/re-render';
fs.mkdirSync(outDir, { recursive: true });

for (const s of scenes) {
  try {
    const r = new SceneRenderer(s.path, { width: 1920, height: 1080, time: s.t, log: () => {} });
    console.log(`\n=== ${s.name} (objects=${r.objects.length}) ===`);
    for (const o of r.renderOrder) console.log(`  #${o.id} ${o.name || ''} [${o._renderType}]`);
    const canvas = r.render();
    const png = encodePng(canvas.w, canvas.h, canvas.data);
    const out = `${outDir}/${s.name}.png`;
    fs.writeFileSync(out, png);
    // 统计非黑像素 & 色彩
    let nonBlack = 0, colorful = 0, total = canvas.w * canvas.h;
    for (let i = 0; i < canvas.data.length; i += 4) {
      const r8 = canvas.data[i], g8 = canvas.data[i + 1], b8 = canvas.data[i + 2];
      if (r8 + g8 + b8 > 12) nonBlack++;
      if (Math.max(r8, g8, b8) - Math.min(r8, g8, b8) > 24) colorful++;
    }
    console.log(`output: ${out} (${png.length} B)`);
    console.log(`nonBlack=${(nonBlack / total * 100).toFixed(2)}% colorful=${(colorful / total * 100).toFixed(2)}%`);
  } catch (e) {
    console.log(`\n=== ${s.name} ERROR: ${e.message}`);
  }
}
