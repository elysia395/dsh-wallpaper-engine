// 读 -control 等 CLI 字符串附近上下文
import fs from 'node:fs';
const b = fs.readFileSync('C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe');
const s = b.toString('latin1');
for (const pat of ['-control', '-screen', 'preview', 'workshop']) {
  let idx = s.indexOf(pat);
  if (idx < 0) continue;
  // 向前找字符串起点 (\0 分隔)
  let start = idx;
  while (start > 0 && s.charCodeAt(start - 1) !== 0) start--;
  let end = idx;
  while (end < s.length && s.charCodeAt(end) !== 0) end++;
  console.log(`[${pat}] @0x${idx.toString(16)}: "${s.slice(start, end).replace(/[^\x20-\x7e]/g, '?')}"`);
  // 打印周围 ±200 字节的可见字符串
  const around = s.slice(idx - 100, idx + 200).replace(/[^\x20-\x7e]/g, '|');
  console.log('  around:', around.slice(0, 300));
}
