// 通过 SceneRenderer 读 pkg 里的 scene.json (用渲染器的 readJson)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
const json = r.scene; // 渲染器已解析 scene
const objs = json.objects || [];
for (const o of objs) {
  if (o && o.id === 314) {
    console.log('== 对象 314 (背景) ==');
    console.log(JSON.stringify(o, null, 1));
  }
}
// 列出所有 _renderType 分布
const types = {};
for (const o of objs) {
  const t = o._renderType || (o.model && o.model.puppet ? 'puppet' : o.type);
  types[t] = (types[t] || 0) + 1;
}
console.log('类型分布:', JSON.stringify(types));
// 背景类对象: type == 'background' 或 name 含 背景
for (const o of objs) {
  const nm = String(o.name || '');
  if (nm.includes('背景') || o.type === 'background' || o.type === 'bg') {
    console.log(`bg-like: id=${o.id} type=${o.type} name="${nm}" renderType=${o._renderType} fullscreen=${o.model && o.model.fullscreen}`);
  }
}
