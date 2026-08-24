// 缓存键 bump: sf19 → sf20 (animationlayers blend 混合)
import fs from 'node:fs';
const p = 'lib/index.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace('sf19_', 'sf20_');
fs.writeFileSync(p, s);
console.log('缓存键:', [...new Set(s.match(/sf\d+_/g))].join(', '));
