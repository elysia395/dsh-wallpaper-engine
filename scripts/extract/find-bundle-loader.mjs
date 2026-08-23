// 确认 DSH cordis 加载器如何解析 bundle 包路径
import fs from 'fs';

// 搜索 cordis 加载器中的包解析逻辑
const dirs = [
  'D:/DSH Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/cordis-plugin-loader/lib',
  'D:/DSH Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-cordis-host-runner/lib',
  'D:/DSH Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-typert-loader/lib',
];

for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const t = fs.readFileSync(dir + '/' + f, 'utf8');
    if (/node_modules|resolve\(|import\(|createRequire|bundle/.test(t)) {
      const lines = t.split('\n');
      let hits = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/resolve\(|node_modules|createRequire|import\(|loadBundle|bundlePath|packageJson|main\b/.test(lines[i]) && lines[i].length < 180) {
          console.log(dir.split('/').pop() + '/' + f + ' L' + i + ':', lines[i].trim().slice(0, 150));
          hits++;
          if (hits > 12) break;
        }
      }
    }
  }
}
