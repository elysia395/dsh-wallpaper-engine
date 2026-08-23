// 彻底搜索 lwe/repkg 中 puppet 模型定位逻辑 (crop/offset/autosize)
import fs from 'fs';

const walk = (d, out = []) => {
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = d + '/' + e.name;
      if (e.isDirectory()) walk(p, out);
      else if (/\.(cpp|h|cs|js|ts)$/.test(e.name)) out.push(p);
    }
  } catch {}
  return out;
};

console.log('=== lwe 中 puppet 定位相关 ===');
for (const f of walk('D:/dsh-wallpaper-engine/_refs/linux-wallpaperengine/src')) {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (/crop|autosize|auto.?size|updatePuppetPosition|origin.*puppet|puppet.*origin/i.test(t)) {
    const lines = t.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/crop|autosize|auto.?size|updatePuppetPosition/i.test(lines[i])) {
        console.log(f.split('/').slice(-3).join('/') + ':' + (i+1) + ': ' + lines[i].trim().slice(0, 140));
      }
    }
  }
}

console.log('\n=== repkg 中 crop/autosize ===');
for (const f of walk('D:/dsh-wallpaper-engine/_refs/repkg/src')) {
  let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (/crop|autosize|auto.?size/i.test(t)) {
    const lines = t.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/crop|autosize|auto.?size/i.test(lines[i])) {
        console.log(f.split('/').slice(-3).join('/') + ':' + (i+1) + ': ' + lines[i].trim().slice(0, 140));
      }
    }
  }
}
