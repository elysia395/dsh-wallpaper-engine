// 扫描 Hina MDLA 段流中每骨骼 bind 平移的位置 → 解明布局
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3554161528/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 66);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mesh = r._parseMdl(buf);
const anim = mesh.animations[0];

const seg0 = anim.segs[0];
const totalBytes = anim.segs[0] + 32 * anim.segBytes;
console.log('段流: ' + seg0 + '..' + totalBytes + ' 总 ' + (totalBytes - seg0) + 'B = ' + (totalBytes - seg0) / 36 + ' 帧块');

// 对每骨骼: 在流中找 bind 平移 (容忍 ±0.5)
for (let b = 0; b < 32; b++) {
  const bindX = mesh.bones[b].bind[12], bindY = mesh.bones[b].bind[13];
  let found = null;
  // 扫描 float 位置 (步长 4B, 最多扫全流)
  const startF = Math.floor((seg0) / 4), endF = Math.floor(totalBytes / 4);
  for (let fi = startF; fi < endF - 1; fi++) {
    const x = dv.getFloat32(fi * 4, true), y = dv.getFloat32((fi + 1) * 4, true);
    if (Math.abs(x - bindX) < 0.5 && Math.abs(y - bindY) < 0.5) {
      // 计算: 段内偏移 (相对 seg0), 帧块索引, 块内 col
      const rel = fi * 4 - seg0;
      const block = Math.floor(rel / 36);
      const col = (rel % 36) / 4;
      found = { rel, block, col };
      break;
    }
  }
  if (found) {
    console.log(`B${String(b).padEnd(3)} bind=(${bindX.toFixed(1)},${bindY.toFixed(1)}) → 块${found.block} col${found.col} (rel ${found.rel}B)`);
  } else {
    console.log(`B${String(b).padEnd(3)} bind=(${bindX.toFixed(1)},${bindY.toFixed(1)}) → 未找到`);
  }
}
