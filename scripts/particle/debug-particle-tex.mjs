import { SceneRenderer } from '../lib/scene-renderer.js';
const r = new SceneRenderer('c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg', { width: 3840, height: 2160, time: 0, log: () => {} });

for (const o of r.objects.filter(o => o._renderType === 'particle')) {
  const def = typeof o.particle === 'string' ? r.pkg.readJson(o.particle) : o.particle;
  if (!def || !def.material) continue;
  const mat = r.pkg.readJson(def.material);
  console.log('=== ' + o.name + ' ===');
  console.log('def.material:', def.material);
  if (mat) {
    console.log('材质 passes:', JSON.stringify(mat.passes).slice(0, 300));
    if (mat.passes && mat.passes[0] && mat.passes[0].textures) {
      for (const t of mat.passes[0].textures) {
        if (!t) continue;
        console.log('  纹理引用:', t, '→ pkg有:', r.pkg.has('materials/' + t + '.tex'), '或', r.pkg.has(t));
      }
    }
  } else {
    console.log('材质文件缺失');
  }
}
