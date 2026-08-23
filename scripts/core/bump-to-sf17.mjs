// 缓存键 bump: sf16 → sf17 (MDLA 布局修复后必须)
import fs from 'node:fs';
const p = 'lib/index.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace('sf16_', 'sf17_');
fs.writeFileSync(p, s);
const keys = [...new Set(s.match(/sf\d+_/g))];
console.log('缓存键:', keys.join(', '));
