// 检查 wallpaper64.exe 是否支持命令行渲染 (找 -control 等参数用法)
import fs from 'node:fs';
const p = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/wallpaper64.exe';
const b = fs.readFileSync(p);
const s = b.toString('latin1');
const pats = ['-control', '-screen', '-projector', 'preview', 'headless', 'workshop', '-scene', 'scene.pkg', 'WallpaperEngine', 'Application_quit', 'screenshot', 'shot'];
for (const pat of pats) {
  let idx = s.indexOf(pat);
  const hits = [];
  while (idx >= 0 && hits.length < 3) { hits.push('0x' + idx.toString(16)); idx = s.indexOf(pat, idx + 1); }
  console.log(pat + ': ' + (hits.length ? hits.join(',') : 'not found'));
}
