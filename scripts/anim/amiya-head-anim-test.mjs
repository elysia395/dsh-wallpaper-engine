// 头动画选择: animations[0] vs [1] 的蒙皮对比
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const mesh = r._parseMdl(r.pkg.read(m.puppet));
const bbox = (pts) => { let a=1e9,b=1e9,c=-1e9,d=-1e9; for (const p of pts){a=Math.min(a,p[0]);b=Math.min(b,p[1]);c=Math.max(c,p[0]);d=Math.max(d,p[1]);} return 'x['+a.toFixed(0)+','+c.toFixed(0)+'] y['+b.toFixed(0)+','+d.toFixed(0)+']'; };
console.log('绑定: ' + bbox(mesh.positions));
console.log('动画0(动画1): ' + bbox(r._skinPuppet(mesh, 2.5, 0, 0)));
// 用动画1
const mesh2 = r._parseMdl(r.pkg.read(m.puppet));
mesh2.animations = [mesh2.animations[1]];
console.log('动画1(呼吸循环): ' + bbox(r._skinPuppet(mesh2, 2.5, 0, 0)));
// 渲染动画1版本的头
const r2 = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
const origSkin = r2._skinPuppet.bind(r2);
r2._skinPuppet = (mesh3, t, cxs, cys) => {
  if (mesh3.animations && mesh3.animations.length > 1 && mesh3._useAnim1) {
    mesh3.animations = [mesh3.animations[1]];
  }
  return origSkin(mesh3, t, cxs, cys);
};
// 设置头 mesh 用动画1
const headO = r2.objects.find(x => x.id === 697);
const saveVis = new Map();
for (const oo of r2.objects) { saveVis.set(oo.id, oo.visible); oo.visible = false; }
headO.visible = true;
// patch _parseMdl 缓存: 渲染时头 mesh 标记用动画1
const origParse = r2._parseMdl.bind(r2);
r2._parseMdl = (buf) => {
  const mesh3 = origParse(buf);
  if (mesh3 && mesh3.animations && mesh3.animations.length > 1) mesh3._useAnim1 = true;
  return mesh3;
};
r2.render();
const d = r2.canvas.data;
let minX=1e9,minY=1e9,maxX=-1,maxY=-1,nz=0;
for (let y = 0; y < r2.H; y++) for (let x = 0; x < r2.W; x++) {
  const i = (y*r2.W+x)*4;
  if (d[i+3] > 10) { nz++; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
}
console.log('动画1 头渲染内容: ' + (nz ? minX+','+minY+'..'+maxX+','+maxY+' 像素'+nz : '无'));
