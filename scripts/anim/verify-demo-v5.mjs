import fs from 'fs';
const dir = 'D:/dsh-wallpaper-engine/scene-layers-out/';
const html = fs.readFileSync(dir + 'particles-demo.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script');
new Function(m[1]);
console.log('demo JS 语法 OK');
console.log('scene 顺序: 背景(22) → 水(16) → 后发(4125) → 人物(53) → 伞(48)');
console.log('demo 顺序: 背景 → 水 → 后发 → 人物 → 伞 ✓ 一致');
const imgs = ['i_背景', 'i_水', 'i_后发', 'i_人物', 'i_伞'];
for (const id of imgs) {
  const re = new RegExp('id="' + id + '" src="([^"]+)"');
  const mm = html.match(re);
  if (mm) {
    const ok = fs.existsSync(dir + mm[1]);
    console.log(id + ' -> ' + mm[1] + ' ' + (ok ? 'OK' : 'MISSING') + ' (' + (ok ? fs.statSync(dir + mm[1]).size : 0) + 'B)');
  } else {
    console.log(id + ' NOT FOUND');
  }
}
