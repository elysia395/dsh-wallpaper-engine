// 提取 asar 内指定文件 (seek)
import fs from 'fs';

const asarPath = 'D:/DSH Desktop/resources/app.asar';
const fd = fs.openSync(asarPath, 'r');
const headBuf = Buffer.alloc(16);
fs.readSync(fd, headBuf, 0, 16, 0);
const headerSize = headBuf.readUInt32LE(4);
const jsonBuf = Buffer.alloc(headerSize);
fs.readSync(fd, jsonBuf, 0, headerSize, 16);
const json = jsonBuf.toString('utf8');
const cut = json.lastIndexOf('}') + 1;
const header = JSON.parse(json.slice(0, cut));

const wanted = process.argv[2].split(',');
const dataStart = 8 + headerSize;
const out = [];

const walk = (node, prefix) => {
  for (const [name, info] of Object.entries(node)) {
    const p = prefix ? prefix + '/' + name : name;
    if (info.files) walk(info.files, p);
    else if (wanted.some((w) => p.endsWith(w))) {
      const off = Number(info.offset);
      const data = Buffer.alloc(info.size);
      fs.readSync(fd, data, 0, info.size, dataStart + off);
      const dest = 'D:/dsh-wallpaper-engine/_refs/asar-' + p.replace(/[\/\\]/g, '__');
      fs.writeFileSync(dest, data);
      out.push(dest);
    }
  }
};
walk(header.files, '');
fs.closeSync(fd);
console.log('extracted:', out.join('\n') || '(none)');
