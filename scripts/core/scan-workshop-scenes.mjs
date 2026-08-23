// 深入检查 workshop scene 壁纸的内容
import fs from 'node:fs';

const ws = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
for (const d of ['2934788040', '3461168300', '3470764447', '3486806915']) {
  const dir = ws + '/' + d;
  console.log('=== ' + d + ' ===');
  const sj = dir + '/scene.json';
  if (!fs.existsSync(sj)) { console.log(' 无 scene.json'); continue; }
  try {
    const j = JSON.parse(fs.readFileSync(sj, 'utf8'));
    const types = {};
    const effects = {};
    for (const o of (j.objects || [])) {
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
    console.log(' camera:', JSON.stringify((j.camera || {}).paths || []).slice(0, 60));
    const raw = fs.readFileSync(sj, 'utf8');
    console.log(' 脚本引用:', (raw.match(/"script"/g) || []).length);
    // shaders 目录
    const sh = dir + '/shaders';
    if (fs.existsSync(sh)) {
      console.log(' shaders:', fs.readdirSync(sh).filter(f => f.endsWith('.frag') || f.endsWith('.vert')).slice(0, 12).join(', '));
    }
  } catch (e) { console.log(' 解析失败:', e.message); }
}
