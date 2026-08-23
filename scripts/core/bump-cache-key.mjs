// 安全 bump 缓存键 (UTF-8 读写, 避免 PowerShell 编码事故)
import fs from 'node:fs';
const p = 'lib/index.js';
let c = fs.readFileSync(p, 'utf8');
const before = c;
// 只改 sf14_ → sf15_ (键值), 不动注释
c = c.replace(/'sf14_'/g, "'sf15_'");
c = c.replace(/sf14 = /g, 'sf15 = ');
if (c === before) {
  console.log('无变化');
} else {
  fs.writeFileSync(p, c, 'utf8');
  console.log('已 bump sf14 → sf15');
}
const after = fs.readFileSync(p, 'utf8');
const m = after.match(/sf1\d_/);
console.log('当前缓存键:', m ? m[0] : '未找到');
