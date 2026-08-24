// debug: renderPuppet patch 后头的渲染
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: (m) => console.log('LOG:', m) });
const origRP = r.renderPuppet.bind(r);
const origSkin = r._skinPuppet.bind(r);
r.renderPuppet = (o, model, tr, t) => {
  if (o.id === 697) {
    const mesh2 = r._mdlCache.get(model.puppet);
    console.log('renderPuppet 697: mesh=' + (mesh2 ? '有' : '无') + ' animations=' + (mesh2 ? mesh2.animations.length : 0));
    if (mesh2 && mesh2.animations.length > 1) {
      mesh2.animations = [mesh2.animations[1]];
      console.log('  改用动画1: frameCount=' + mesh2.animations[0].frameCount + ' segs0=' + mesh2.animations[0].segs[0]);
    }
  }
  return origRP(o, model, tr, t);
};
const headO = r.objects.find(x => x.id === 697);
const sv = new Map();
for (const oo of r.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
headO.visible = true;
r.render();
const d = r.canvas.data;
let nz = 0;
for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 10) nz++;
console.log('单独渲染头 非透明像素: ' + nz);
// 直接测 _skinPuppet
const mesh = r._parseMdl(r.pkg.read(r.readJsonAny(headO.image).puppet));
console.log('_parseMdl animations: ' + mesh.animations.length + ' anim1 frames=' + mesh.animations[1].frameCount + ' segs0=' + mesh.animations[1].segs[0]);
mesh.animations = [mesh.animations[1]];
const sk = origSkin(mesh, 2.5, 0, 0);
console.log('动画1 蒙皮顶点数: ' + sk.length + ' 首顶点: ' + sk[0].map(v => v.toFixed(1)).join(','));
