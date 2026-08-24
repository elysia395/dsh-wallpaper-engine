// 读头 697 MDLA 骨骼 0 动画 pos @t=2.5 (frame=75) — 验证 puppet origin 骨骼链变换量级
// 对比用户"头右移一个头(~449)" / "-eye 平移(360)" 假设
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const mdlRaw = r.pkg.read(m.puppet);
const mesh = r._parseMdl(mdlRaw);
const t = 2.5, fps = 30;
const frame = Math.floor(t * fps) % Math.max(1, mesh.animations[0].frameCount);
console.log('头697: animIdx=0 frame=', frame, 'frameCount=', mesh.animations[0].frameCount);
console.log('骨骼数=', mesh.bones.length);
// 用 DSH 蒙皮函数拿到 animWorld
const nb = mesh.bones.length;
const anim = mesh.animations[0];
const dv = new DataView(mesh.raw.buffer, mesh.raw.byteOffset, mesh.raw.byteLength);
const totalFrames = Math.max(1, anim.frameCount);
console.log('\n骨骼动画局部 pos/rot (MDLA 段布局):');
for (let b = 0; b < nb; b++) {
  const segStart = anim.segs[b];
  const b2 = 2 * b;
  const posShift = Math.floor(b2 / 9);
  const posCol = b2 % 9;
  const frame0 = ((frame + posShift) % totalFrames) * 36;
  const o1 = segStart + frame0 + posCol * 4;
  const px = dv.getFloat32(o1, true);
  const py = dv.getFloat32(o1 + 4, true);
  const rotShift = Math.floor((b2 + 5) / 9);
  const rotCol = (b2 + 5) % 9;
  const o2 = segStart + ((frame + posShift + rotShift) % totalFrames) * 36 + rotCol * 4;
  const rotZ = dv.getFloat32(o2, true);
  const bind = mesh.bones[b].bind;
  console.log(`骨${b}: parent=${mesh.bones[b].parent} anim pos=(${px.toFixed(2)},${py.toFixed(2)}) rot=${rotZ.toFixed(4)}rad bind T=(${bind[12].toFixed(2)},${bind[13].toFixed(2)})`);
}
// animWorld 平移 (行主序: bind 列主序? 用 DSH 的 _matMulRow)
const animLocal = new Array(nb);
const animWorld = new Array(nb);
for (let b = 0; b < nb; b++) {
  const segStart = anim.segs[b];
  const b2 = 2 * b;
  const posShift = Math.floor(b2 / 9);
  const posCol = b2 % 9;
  const frame0 = ((frame + posShift) % totalFrames) * 36;
  const o1 = segStart + frame0 + posCol * 4;
  const px = dv.getFloat32(o1, true);
  const py = dv.getFloat32(o1 + 4, true);
  const rotShift = Math.floor((b2 + 5) / 9);
  const rotCol = (b2 + 5) % 9;
  const o2 = segStart + ((frame + posShift + rotShift) % totalFrames) * 36 + rotCol * 4;
  const rotZ = dv.getFloat32(o2, true);
  const c = Math.cos(rotZ), s = Math.sin(rotZ);
  let local;
  if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && isFinite(rotZ)) {
    local = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, px, py, 0, 1];
  } else {
    local = mesh.bones[b].bind;
  }
  animLocal[b] = local;
  const parent = mesh.bones[b].parent;
  animWorld[b] = parent >= 0 && parent < nb && animWorld[parent] ? r._matMulRow(animWorld[parent], local) : local;
}
console.log('\nanimWorld 平移 (行主序 [12],[13]):');
for (let b = 0; b < nb; b++) {
  const w = animWorld[b];
  console.log(`骨${b}: T=(${w[12].toFixed(2)},${w[13].toFixed(2)})`);
}
// 头 origin
const tr = r.resolveTransform(o);
console.log('\n头697 绝对origin(DSH)=', tr.origin.map(v => v.toFixed(2)).join(','));
console.log('头697 局部origin=', String(o.origin));
console.log('\n用户假设对比 (@场景坐标, DSH ps=1):');
console.log('  官方若 origin+骨骼根bind平移: ', tr.origin.map((v,i)=> (v + (i===0? mesh.bones[0].bind[12] : i===1? mesh.bones[0].bind[13] : 0)).toFixed(1)).join(','));
console.log('  官方若 origin+animWorld[0]平移: ', tr.origin.map((v,i)=> (v + (i===0? animWorld[0][12] : i===1? animWorld[0][13] : 0)).toFixed(1)).join(','));
console.log('  官方若 origin+animWorld[2]平移: ', tr.origin.map((v,i)=> (v + (i===0? animWorld[2][12] : i===1? animWorld[2][13] : 0)).toFixed(1)).join(','));
console.log('  -eye 平移假设: ', tr.origin.map(v=>v.toFixed(1)).join(',') + ' + (360,269.56)');
