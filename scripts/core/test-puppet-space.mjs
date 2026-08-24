// 对比 Amiya 头 puppet 定位: origin+raw vs size/2+raw (lwe)
import { readPkg } from '../../lib/we-renderer/textures.js';
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';

const r = new SceneRenderer(WS + '/3486806915/scene.pkg', { width: 10, height: 10, weAssetsDir: WE, log: () => {} });
const head = r.objects.find(o => o.id === 697);
const tr = r.resolveTransform(head);
const mdl = r.pkg.read('models/头_puppet.mdl');
const mesh = r._parseMdl(mdl);

let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
for (const p of mesh.positions) {
  if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
  if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
}
const size = head.size ? head.size.split(' ').map(Number) : null;
console.log('头对象: origin=' + tr.origin.map(v=>v.toFixed(1)).join(',') + ' size=' + size);
console.log('网格: x[' + minX.toFixed(0) + ',' + maxX.toFixed(0) + '] y[' + minY.toFixed(0) + ',' + maxY.toFixed(0) + '] 中心=(' + ((minX+maxX)/2).toFixed(0) + ',' + ((minY+maxY)/2).toFixed(0) + ')');

// 躯干 (528 大衣组) 位置
const torso = r.objects.find(o => o.id === 528);
const trT = r.resolveTransform(torso);
console.log('躯干(528): origin=' + trT.origin.map(v=>v.toFixed(1)).join(','));

// 方式 A: origin + raw (我的)
console.log('\n方式 A (origin+raw, 我的):');
console.log('  头 x[' + (tr.origin[0]+minX).toFixed(0) + ',' + (tr.origin[0]+maxX).toFixed(0) + '] y[' + (tr.origin[1]+minY).toFixed(0) + ',' + (tr.origin[1]+maxY).toFixed(0) + ']');
console.log('  头中心=(' + tr.origin[0].toFixed(0) + ',' + tr.origin[1].toFixed(0) + ')');

// 方式 B: size/2 + raw (lwe)
if (size) {
  console.log('\n方式 B (size/2+raw, lwe):');
  console.log('  头 x[' + (size[0]/2+minX).toFixed(0) + ',' + (size[0]/2+maxX).toFixed(0) + '] y[' + (size[1]/2+minY).toFixed(0) + ',' + (size[1]/2+maxY).toFixed(0) + ']');
  console.log('  对象左上=(' + (size[0]/2).toFixed(0) + ',' + (size[1]/2).toFixed(0) + ')');
}

// 判断: 头是否在躯干上方
console.log('\n头中心 y vs 躯干中心 y:');
console.log('  方式A 头中心 y=' + tr.origin[1].toFixed(0) + ' 躯干中心 y=' + trT.origin[1].toFixed(0) + ' → ' + (tr.origin[1] > trT.origin[1] ? '头在上方 ✓' : '头在下方 ✗'));
if (size) console.log('  方式B 头中心 y=' + (size[1]/2).toFixed(0) + ' vs 躯干 ' + trT.origin[1].toFixed(0) + ' → ' + (size[1]/2 > trT.origin[1] ? '头在上方' : '头在下方'));
