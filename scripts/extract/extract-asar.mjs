// 从 app.asar 提取 install-recovery 源码 (只读头 + 随机 seek)
import fs from 'fs';

const asarPath = 'D:/DSH Desktop/resources/app.asar';
const fd = fs.openSync(asarPath, 'r');
const headBuf = Buffer.alloc(16);
fs.readSync(fd, headBuf, 0, 16, 0);
const headerSize = headBuf.readUInt32LE(4);
const jsonBuf = Buffer.alloc(headerSize);
fs.readSync(fd, jsonBuf, 0, headerSize, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));

function walk(node, prefix, out) {
  for (const [name, info] of Object.entries(node)) {
    const p = prefix ? prefix + '/' + name : name;
    if (info.files) walk(info.files, p, out);
    else out.push({ p, offset: info.offset, size: info.size });
  }
}
const list = [];
walk(header.files, '', list);
const targets = list.filter((f) => /install-recovery|desktop-cli/i.test(f.p));
console.log('matching:', targets.map((t) => t.p).join('\n'));

const dataStart = 8 + headerSize;
for (const t of targets) {
  const data = Buffer.alloc(t.size);
  fs.readSync(fd, data, 0, t.size, dataStart + t.offset);
  const out = 'D:/dsh-wallpaper-engine/_refs/asar-' + t.p.replace(/[\/\\]/g, '__');
  fs.writeFileSync(out, data);
  console.log('extracted:', out, data.length, 'B');
}
fs.closeSync(fd);
