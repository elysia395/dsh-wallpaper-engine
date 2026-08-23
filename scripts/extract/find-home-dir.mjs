import fs from 'fs';

const boot = 'D:/DSH Desktop/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js';
const t = fs.readFileSync(boot, 'utf8');

// 找 resolveDshHome 和 PROFILES_DIR
const lines = t.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (/function resolveDshHome|PROFILES_DIR\s*=|const PROFILES_DIR|homeDir\s*=|function resolveHome/.test(lines[i])) {
    console.log('L' + i + ':', lines.slice(i, i + 12).join('\n'));
    console.log('---');
  }
}
