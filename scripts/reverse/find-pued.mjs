// 搜所有壁纸 MDL 里的 PUED0002 段
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const ids = ['3486806915', '3655429099', '3629379075', '3554161528', '3641860575', '3461168300', '3690417937', '3582367840', '3669681034'];
for (const id of ids) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });
  const seen = new Set();
  for (const o of r.objects) {
    if (!o.image) continue;
    const m = o.image ? r.readJsonAny(o.image) : null;
    if (!m || !m.puppet || seen.has(m.puppet)) continue;
    seen.add(m.puppet);
    try {
      const buf = r.pkg.read(m.puppet);
      if (!buf) continue;
      const idx = buf.indexOf(Buffer.from('PUED'));
      if (idx >= 0) {
        // 段名
        let name = 'PUED';
        let i = idx + 4;
        while (i < buf.length && buf[i] >= 0x30 && buf[i] <= 0x39 && name.length < 12) { name += String.fromCharCode(buf[i]); i++; }
        console.log(`${id} ${m.puppet}: ${name} @0x${idx.toString(16)} (文件 ${buf.length}B)`);
      }
    } catch { }
  }
}
console.log('搜索完成');
