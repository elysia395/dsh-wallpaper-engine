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

for (const repo of ['linux-wallpaperengine', 'repkg']) {
  let found = false;
  for (const f of walk('D:/dsh-wallpaper-engine/_refs/' + repo + '/src')) {
    let t = '';
    try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (/cropoffset|CropOffset|cropOffset/i.test(t)) {
      const lines = t.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/cropoffset|CropOffset|cropOffset/i.test(lines[i])) {
          console.log(repo + '/' + f.split('/').slice(-3).join('/') + ':' + (i+1) + ': ' + lines[i].trim().slice(0, 140));
          found = true;
        }
      }
    }
  }
  if (!found) console.log(repo + ': 无 cropoffset 处理');
}
