// 缓存键 bump: sf15 → sf16 (alignment 修复后必须, 否则实机复用旧缓存)
import fs from 'node:fs';
const p = 'lib/index.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace('sf15_', 'sf16_');
fs.writeFileSync(p, s);
const keys = [...new Set(s.match(/sf\d+_/g))];
console.log('缓存键:', keys.join(', '));
