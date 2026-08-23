// 扫描 Hina MDLA 段流中每骨骼 bind 平移的位置 (精确字节步进)
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
const end = seg0 + 32 * anim.segBytes;
const results = [];
for (let b = 0; b < 32; b++) {
  const bindX = mesh.bones[b].bind[12], bindY = mesh.bones[b].bind[13];
  let found = null;
  for (let off = seg0; off < end - 4; off += 4) {
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true);
    if (Math.abs(x - bindX) < 0.5 && Math.abs(y - bindY) < 0.5) {
      const rel = off - seg0;
      found = { rel, block: Math.floor(rel / 36), col: (rel % 36) / 4 };
      break;
    }
  }
  results.push({ b, bindX, bindY, found });
  if (found) console.log(`B${b} bind=(${bindX.toFixed(1)},${bindY.toFixed(1)}) → 块${found.block} col${found.col} (rel ${found.rel}B)`);
  else console.log(`B${b} bind=(${bindX.toFixed(1)},${bindY.toFixed(1)}) → 未找到`);
}
// 分析规律: 骨骼 b 的块/列
console.log('\n--- 规律分析 ---');
for (const r2 of results) {
  if (r2.found) {
    const expectCol = (2 * r2.b) % 9;
    console.log(`B${r2.b}: 实际块${r2.found.block} col${r2.found.col} | 期望(2b)%9=${expectCol} 块=${Math.floor(r2.found.block / 76)}帧${r2.found.block % 76}`);
  }
}
