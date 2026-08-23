// 搜索所有 WE exe/dll 的 PKGV 魔数 + TEXV0004 上下文
import fs from 'node:fs';
import path from 'node:path';

const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const files = fs.readdirSync(WE).filter((f) => f.endsWith('.exe') || f.endsWith('.dll'));
const ascii = (bytes, o, n) => {
  let s = '';
  for (let i = o; i < o + n && i < bytes.length; i++) {
    const b = bytes[i];
    s += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
  }
  return s;
};

for (const f of files) {
  const p = path.join(WE, f);
  let bytes;
  try { bytes = fs.readFileSync(p); } catch { continue; }
  if (bytes.length < 100000) continue;
  const found = [];
  for (const t of ['PKGV', 'TEXV0004', 'TEXV0005', 'tex-json', 'scene.pkg', '.mdl', 'MDMP', 'MDLE']) {
    const b = Buffer.from(t, 'ascii');
    let idx = -1;
    while ((idx = bytes.indexOf(b, idx + 1)) >= 0) {
      found.push(t + '@' + idx);
      if (found.filter((x) => x.startsWith(t)).length >= 2) break;
    }
  }
  if (found.length) {
    console.log(f + ': ' + found.join(', '));
    // PKGV 上下文
    const pkIdx = found.find((x) => x.startsWith('PKGV'));
    if (pkIdx) {
      const off = parseInt(pkIdx.split('@')[1]);
      console.log('  PKGV 上下文: ' + ascii(bytes, off - 30, 90).replace(/\s+/g, ' ').trim());
    }
  }
}
