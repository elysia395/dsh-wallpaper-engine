// 缓存键 bump: sf18 → sf19 (puppet cropoffset 交集规则 + FBO 裁剪)
import fs from 'node:fs';
const p = 'lib/index.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace('sf18_', 'sf19_');
fs.writeFileSync(p, s);
console.log('缓存键:', [...new Set(s.match(/sf\d+_/g))].join(', '));
