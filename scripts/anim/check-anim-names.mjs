import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const mesh = r._parseMdl(r.pkg.read(m.puppet));
(mesh.animations || []).forEach((a, i) => console.log(`动画${i}: name="${a.name || ''}" frames=${a.frameCount}`));
console.log('animationlayers:');
(o.animationlayers || []).forEach((l, i) => {
  const v = l && l.visible;
  const visible = v === true || (v && typeof v === 'object' && v.value === true);
  console.log(`  层${i}: name="${l.name || ''}" visible=${visible} blend=${l.blend}`);
});
