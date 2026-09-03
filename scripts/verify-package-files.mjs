// 打包完整性守卫：从插件入口解析完整 import 图，凡 lib/ 下可达文件都必须被
// package.json 的 files 白名单覆盖。漏列 = npm pack 丢文件 = 生产环境模块缺失
// （0.6.8 漏 lib/scene-script-apis.js → scene-renderer 全线崩溃 → 静态帧回退
// 错乱 / scene-anim 卡 0%）。
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const filesList = Array.isArray(pkg.files) ? pkg.files : [];

const seen = new Set();
const queue = ['lib/index.js', 'lib/client.js', 'lib/scene-render-worker.mjs'];
const importRe = /(?:import|export)[^'"]*from\s+['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  let src;
  try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
  let m;
  while ((m = importRe.exec(src))) {
    const spec = m[1] || m[2] || m[3];
    let r = path.normalize(path.join(path.dirname(rel), spec)).replace(/\\/g, '/');
    if (!/\.(js|mjs|cjs|json)$/.test(r)) {
      if (fs.existsSync(path.join(root, r + '.js'))) r += '.js';
      else if (fs.existsSync(path.join(root, r + '.mjs'))) r += '.mjs';
      else if (fs.existsSync(path.join(root, r, 'index.js'))) r = r + '/index.js';
    }
    if (r.startsWith('lib/')) queue.push(r);
  }
}

const covered = (f) => filesList.includes(f)
  || filesList.some((e) => e.endsWith('/') && f.startsWith(e));
const missing = [...seen].filter((f) => !covered(f));
if (missing.length) {
  console.error('✗ package.json files 白名单未覆盖以下可达文件（npm pack 会丢失）:');
  for (const f of missing) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ package files 完整性: import 图 ${seen.size} 个 lib 文件全部被 files 白名单覆盖`);
