// 搜索 asar 头 JSON: 找 install-recovery / desktop-cli 文件路径
import fs from 'fs';

const fd = fs.openSync('D:/DSH Desktop/resources/app.asar', 'r');
const headBuf = Buffer.alloc(16);
fs.readSync(fd, headBuf, 0, 16, 0);
const headerSize = headBuf.readUInt32LE(4);
const jsonBuf = Buffer.alloc(headerSize);
fs.readSync(fd, jsonBuf, 0, headerSize, 16);
const json = jsonBuf.toString('utf8');
console.log('json length:', json.length);
// 头部 JSON 末尾可能有填充, 截到最后一个 }
const cut = json.lastIndexOf('}') + 1;
const clean = json.slice(0, cut);

const re = /"(lib\/[^"]*(?:install-recovery|desktop-cli)[^"]*)":\s*\{/g;
let m; const found = [];
while ((m = re.exec(json)) && found.length < 10) found.push(m[1]);
console.log('found paths:', found.length ? found.join('\n') : '(none)');

// 用 JSON.parse 精准找
try {
  const header = JSON.parse(clean);
  const seen = [];
  const walk = (node, prefix) => {
    for (const [name, info] of Object.entries(node)) {
      const p = prefix ? prefix + '/' + name : name;
      if (info.files) { if (seen.length < 30) walk(info.files, p); }
      else if (/install-recovery|desktop-cli/i.test(p) && seen.length < 30) {
        seen.push({ p, offset: info.offset, size: info.size });
      }
    }
  };
  walk(header.files, '');
  console.log('walk found:', seen.map((s) => s.p + ' (' + s.size + 'B)').join('\n') || '(none)');
  fs.closeSync(fd);
  if (!seen.length) process.exit(2);
} catch (e) {
  console.log('JSON.parse failed:', e.message);
  fs.closeSync(fd);
  process.exit(1);
}
