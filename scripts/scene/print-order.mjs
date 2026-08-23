// 打印头部相关部件的完整渲染顺序 (z-order)
import { SceneRenderer } from '../lib/scene-renderer.js';

const r = new SceneRenderer('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg', { width: 3840, height: 2160, time: 0, log: () => {} });

console.log('=== 渲染顺序 (前到后) ===');
r.renderOrder.forEach((o, i) => {
  const model = o._renderType === 'image' ? r.pkg.readJson(o.image) : null;
  const isPuppet = model && model.puppet;
  const tag = o._renderType === 'image' ? (isPuppet ? 'puppet' : 'image ') : o._renderType;
  console.log('[' + String(i).padStart(3) + '] #' + String(o.id).padStart(4), (o.name || '').padEnd(8), tag, 'parent:' + (o.parent ?? '-'));
});
