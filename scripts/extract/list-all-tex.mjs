// 检查: 头部纹理是否是大图的裁剪? cropoffset 与纹理尺寸关系
import { SceneRenderer } from '../lib/scene-renderer.js';

const r = new SceneRenderer('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg', { width: 3840, height: 2160, time: 0, log: (s) => console.log('LOG:', s) });

// 列出所有材质纹理及尺寸
console.log('=== 所有 image 对象的纹理 ===');
for (const o of r.objects) {
  if (o._renderType !== 'image') continue;
  const model = r.pkg.readJson(o.image);
  if (!model) continue;
  const mat = r.pkg.readJson(model.material);
  const t = mat && mat.passes && mat.passes[0] && mat.passes[0].textures && mat.passes[0].textures[0];
  if (!t) continue;
  const tex = r.loadTexture(t);
  if (!tex) continue;
  console.log('#' + o.id, (o.name || '').padEnd(8),
    'crop:' + (model.cropoffset || '无').padEnd(16),
    'size:' + (o.size || '无'),
    '纹理:' + tex.width + 'x' + tex.height,
    '模型:' + (model.puppet ? 'puppet' : 'image'));
}
