// 查找所有 Steam 库中的 workshop 内容 (Wallpaper Engine appid 431960)
import fs from 'node:fs';

const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const vdf = 'C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf';
const libraries = [ 'C:/Program Files (x86)/Steam' ];
if (fs.existsSync(vdf)) {
  const content = fs.readFileSync(vdf, 'utf8');
  for (const m of content.matchAll(/"path"\s+"([^"]+)"/g)) {
    libraries.push(m[1].replace(/\\\\/g, '\\'));
  }
}
console.log('Steam 库:', libraries);
for (const lib of libraries) {
  const ws = lib + '/steamapps/workshop/content/431960';
  if (fs.existsSync(ws)) {
    const dirs = fs.readdirSync(ws);
    console.log('\nworkshop @', ws, '内容数:', dirs.length);
    let scenes = 0, projects = 0;
    for (const d of dirs) {
      const dir = ws + '/' + d;
      const sj = dir + '/scene.json';
      const pj = dir + '/project.json';
      let title = '';
      if (fs.existsSync(pj)) {
        projects++;
        try {
          const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
          title = (j.title || '').slice(0, 50);
        } catch {}
      }
      if (fs.existsSync(sj)) scenes++;
      console.log(' ', d, (fs.existsSync(sj) ? '[scene]' : '       '), title);
    }
    console.log('场景数:', scenes, '项目数:', projects);
  }
}
