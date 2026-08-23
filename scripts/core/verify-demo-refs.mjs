import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out';
const html = fs.readFileSync(dir + '/particles-demo.html', 'utf8');
const refs = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
let ok = true;
for (const r of refs) {
  if (r.startsWith('http') || !r) continue;
  const exists = fs.existsSync(dir + '/' + r);
  console.log(r, '=>', exists);
  if (!exists) ok = false;
}
console.log(ok ? '全部存在 ✓' : '有缺失 ✗');
