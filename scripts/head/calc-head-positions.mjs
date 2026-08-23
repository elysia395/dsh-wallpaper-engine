// 计算扫描图中每个 dy 的头模板渲染位置 (相对眼睛参考)
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import { SceneRenderer } from '../lib/scene-renderer.js';

const r = new SceneRenderer('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg', { width: 3840, height: 2160, time: 0, log: () => {} });
const head = r.objects.find(x => x.id === 697);
const model = r.pkg.readJson(head.image);
const mesh = r._parseMdl(r.pkg.read(model.puppet));
const tr = r.resolveTransform(head);

// 眼睛参考 (无crop): 左眼 y1277-1355, 右眼 y1339-1403 → 眼中心 ~y1340
const EYE_Y = 1340;

console.log('=== 头模板不同 dy 的渲染位置 (无crop时 y[1072,1651], 眼睛中心 y' + EYE_Y + ') ===');
console.log('dy(顶点y偏移) | 头上移量 | 头渲染y范围 | 头底-眼中心距离');
for (const dy of [-200, -100, 0, 100, 150, 200, 250, 300, 350, 400, 450]) {
  const verts = mesh.positions.map(p => [p[0], p[1] + dy, p[2]]);
  const b = r._meshBounds(verts);
  const W = Math.ceil(b.maxX - b.minX) + 1, H = Math.ceil(b.maxY - b.minY) + 1;
  const dy2 = (r.H - tr.origin[1]) - b.maxY;
  const top = dy2, bottom = dy2 + H;
  const headBottomToEye = bottom - EYE_Y; // 正=头底在眼下, 负=头底在眼上
  console.log('dy=' + String(dy).padStart(4) + ' | 上移' + String(-dy).padStart(4) + ' | y[' + top.toFixed(0) + ',' + bottom.toFixed(0) + '] | 头底-眼=' + headBottomToEye.toFixed(0));
}
console.log('');
console.log('目标: 眼睛(中心y1340)应在头部下部1/3处露出, 头底应略低于眼睛底部(眼底~1403)');
console.log('即: 头底 ≈ 1403-1480, 头顶 ≈ 头底-579 ≈ 824-900');
