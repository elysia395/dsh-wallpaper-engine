import fs from 'fs';

const base = 'D:/DSH Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai';
if (!fs.existsSync(base)) {
  console.log('node_modules 不存在:', base);
  process.exit(0);
}
const pkgs = fs.readdirSync(base);
console.log('@deepseek-ai 包:', pkgs.join(', '));

function walk(d, out = []) {
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = d + '/' + e.name;
      if (e.isDirectory()) walk(p, out);
      else if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.ts')) out.push(p);
    }
  } catch {}
  return out;
}

// 全局搜 resolveProfileDir
for (const pkg of pkgs) {
  const js = walk(base + '/' + pkg);
  for (const f of js) {
    let t = '';
    try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (t.includes('resolveProfileDir')) {
      console.log('=== resolveProfileDir 于', f, '===');
      const lines = t.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/function resolveProfileDir|resolveProfileDir =|const resolveProfileDir/.test(lines[i])) {
          // 打印函数体 (后续 15 行)
          console.log(lines.slice(i, i + 20).join('\n'));
          console.log('---');
        }
      }
    }
  }
}
