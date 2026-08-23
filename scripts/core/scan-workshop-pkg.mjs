// 提取 workshop scene.pkg 内容清单 + scene.json 分析
import fs from 'node:fs';
import { readPkg } from '../../lib/we-renderer/textures.js';

const ws = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
for (const d of ['2934788040', '3461168300', '3470764447', '3486806915']) {
  const dir = ws + '/' + d;
  const pkg = dir + '/scene.pkg';
  if (!fs.existsSync(pkg)) { console.log('=== ' + d + ' 无 scene.pkg ==='); continue; }
  console.log('=== ' + d + ' ===');
  try {
    const p = readPkg(pkg);
    const entries = p.entries().map(e => e.name);
    console.log(' 条目数:', entries.length);
    // 按前缀分组
    const groups = {};
    for (const e of entries) {
      const g = e.split('/')[0];
      groups[g] = (groups[g] || 0) + 1;
    }
    console.log(' 分组:', JSON.stringify(groups));
    // scene.json
    const sj = p.readJson('scene.json');
    if (sj) {
      const types = {};
      const effects = {};
      for (const o of (sj.objects || [])) {
        let t = 'other';
        if (o.image) t = 'image';
        else if (o.model) t = 'model';
        else if (o.particle) t = 'particle';
        else if (o.text) t = 'text';
        else if (o.light) t = 'light';
        types[t] = (types[t] || 0) + 1;
        if (o.effects) for (const ef of o.effects) {
          const n = ef.file ? ef.file.split('/').slice(-2, -1)[0] : '?';
          effects[n] = (effects[n] || 0) + 1;
        }
      }
      console.log(' 对象类型:', JSON.stringify(types));
      console.log(' effects:', JSON.stringify(effects));
      console.log(' camera paths:', JSON.stringify((sj.camera || {}).paths || []).slice(0, 50));
      const raw = JSON.stringify(sj);
      console.log(' 脚本引用:', (raw.match(/"script"/g) || []).length);      // 材质 shader 清单
      const shaders = new Set();
      for (const e of entries) {
        if (e.startsWith('materials/') && e.endsWith('.json')) {
          try {
            const mat = p.readJson(e);
            const sh = mat.passes && mat.passes[0] && mat.passes[0].shader;
            if (sh) shaders.add(sh);
          } catch {}
        }
      }
      console.log(' shaders:', [...shaders].slice(0, 20).join(', '));
    }
  } catch (e) { console.log(' 读取失败:', e.message); }
}
