// 解析 Amiya scene.json: 找背景(314) 与 fullscreen 对象
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
// 直接读 pkg 里 scene.json
const pkg = r.pkg;
let json = null;
try { json = pkg.readJson('scene.json'); } catch (e) { console.log('readJson fail', e.message); }
if (!json) {
  // 手动解包
  const buf = fs.readFileSync(`${WS}/3486806915/scene.pkg`);
  const s = buf.toString('latin1');
  const si = s.indexOf('scene.json');
  // 尝试直接找 JSON 起点
  const jb = s.indexOf('{', si);
  // 粗略提取
  const chunk = s.slice(jb, jb + 4000000);
  try { json = JSON.parse(chunk); } catch (e) { console.log('parse fail', e.message); }
}
if (json) {
  console.log('objects:', (json.objects || []).length);
  for (const o of (json.objects || [])) {
    const m = o && o.model;
    const fsFlag = m && (m.fullscreen === true || String(m.fullscreen) === 'true');
    if (o && (o.id === 314 || o.id === 0 || fsFlag || (m && m.puppet))) {
      console.log(`obj id=${o.id} name="${o.name}" type=${o.type} fullscreen=${m && m.fullscreen} file=${m && m.file} origin=${JSON.stringify(o.origin)} size=${JSON.stringify(o.size)} alignment=${o.alignment}`);
    }
  }
  const cam = json.camera || {};
  console.log('camera:', JSON.stringify({ eye: cam.eye, center: cam.center, up: cam.up, projection: cam.projection, fov: cam.fov, nearz: cam.nearz, farz: cam.farz, parallax: cam.parallax }));
  const gen = json.general || {};
  console.log('general:', JSON.stringify({ orthogonalprojection: gen.orthogonalprojection, fov: gen.fov, nearz: gen.nearz, farz: gen.farz, zoom: gen.zoom }));
}
