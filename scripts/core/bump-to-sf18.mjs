// 缓存键 bump: sf17 → sf18 (solidlayer 旋转修复)
import fs from 'node:fs';
const p = 'lib/index.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace('sf17_', 'sf18_');
fs.writeFileSync(p, s);
console.log('缓存键:', [...new Set(s.match(/sf\d+_/g))].join(', '));
