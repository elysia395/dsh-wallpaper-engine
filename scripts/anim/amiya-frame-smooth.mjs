// 验证 Amiya 头动画0 frame 70-80 的骨骼 pos 平滑性 (9列布局深帧正确性)
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 480, height: 270, time: 2.5, weAssetsDir: WE, log: () => {} });
const o = r.objects.find(x => x.id === 697);
const m = r.readJsonAny(o.image);
const buf = r.pkg.read(m.puppet);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mesh = r._parseMdl(buf);
const anim = mesh.animations[0];
const nb = mesh.bones.length;

console.log(`动画0: frames=${anim.frameCount} bones=${nb} segBytes=${anim.segBytes}`);
// 用 9 列布局读 frame 68-82 的每骨骼 pos/rot
for (let frame = 68; frame <= 82; frame++) {
  const vals = [];
  for (let b = 0; b < nb; b++) {
    const b2 = 2 * b;
    const posShift = Math.floor(b2 / 9);
    const posCol = b2 % 9;
    const o1 = anim.segs[b] + ((frame + posShift) % anim.frameCount) * 36 + posCol * 4;
    const px = dv.getFloat32(o1, true), py = dv.getFloat32(o1 + 4, true);
    const rotShift = Math.floor((b2 + 5) / 9);
    const rotCol = (b2 + 5) % 9;
    const o2 = anim.segs[b] + ((frame + posShift + rotShift) % anim.frameCount) * 36 + rotCol * 4;
    const rot = dv.getFloat32(o2, true);
    vals.push(`B${b}=(${px.toFixed(1)},${py.toFixed(1)} r${rot.toFixed(3)})`);
  }
  console.log(`帧${frame}: ` + vals.join(' '));
}
// 绑定矩阵平移 (参照)
mesh.bones.forEach((bn, b) => console.log(`绑定B${b}: (${bn.bind[12].toFixed(1)},${bn.bind[13].toFixed(1)})`));
