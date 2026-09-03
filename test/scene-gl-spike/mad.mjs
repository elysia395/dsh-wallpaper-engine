// Phase 0 spike — GL 截图 vs CPU 参考帧对比（plan §6.5）
// 用法: node test/scene-gl-spike/mad.mjs <gl.png> <ref.png>
// 输出: 全局 MAD（0..255 RGB 均值）+ 16 行分段 MAD + 全局偏移搜索（±3px，亚像素拟合）
// 验收: MAD ≤2 通过 / >5 失败 / 之间人眼仲裁；全局偏移 <0.5px（无整体上移断言）
import fs from 'node:fs';
import { decodePngBuffer } from '../../lib/scene-renderer.js';

const [glPath, refPath] = process.argv.slice(2);
if (!glPath || !refPath) { console.error('usage: mad.mjs <gl.png> <ref.png>'); process.exit(2); }

const A = decodePngBuffer(fs.readFileSync(glPath));
const B = decodePngBuffer(fs.readFileSync(refPath));
if (A.width !== B.width || A.height !== B.height) {
  console.error(`尺寸不一致: ${A.width}x${A.height} vs ${B.width}x${B.height}`);
  process.exit(2);
}
const { width: W, height: H } = A;
const a = A.rgba ?? A.data, b = B.rgba ?? B.data;

function madAt(dx, dy, y0 = 0, y1 = H) {
  // B 平移 (dx,dy) 后与 A 比（只比重叠内区）
  let sum = 0, n = 0;
  const xa = Math.max(0, -dx), xb = Math.min(W, W - dx);
  const ya = Math.max(y0, Math.max(0, -dy)), yb = Math.min(y1, Math.min(H, H - dy));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * W + x) * 4, j = ((y + dy) * W + (x + dx)) * 4;
      sum += Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);
      n += 3;
    }
  }
  return n ? sum / n : 0;
}

// 全局偏移搜索 ±3px
let best = { dx: 0, dy: 0, mad: Infinity };
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
  const m = madAt(dx, dy);
  if (m < best.mad) best = { dx, dy, mad: m };
}
// 亚像素: 对 best 邻域 3×3 做抛物线拟合（x/y 独立）
function subpixel(axis) {
  const vals = {};
  for (const d of [-1, 0, 1]) {
    const dx = axis === 'x' ? best.dx + d : best.dx;
    const dy = axis === 'y' ? best.dy + d : best.dy;
    vals[d] = madAt(dx, dy);
  }
  const denom = vals[-1] - 2 * vals[0] + vals[1];
  if (Math.abs(denom) < 1e-9) return 0;
  const peak = 0.5 * (vals[-1] - vals[1]) / denom;
  return Math.max(-1, Math.min(1, peak));
}
const subX = best.dx + subpixel('x');
const subY = best.dy + subpixel('y');

// 分段 MAD（未平移）
const SEGS = 16;
const seg = [];
for (let s = 0; s < SEGS; s++) {
  seg.push(madAt(0, 0, Math.floor((s * H) / SEGS), Math.floor(((s + 1) * H) / SEGS)));
}

console.log(`MAD(0,0)      = ${madAt(0, 0).toFixed(3)}`);
console.log(`MAD(best)     = ${best.mad.toFixed(3)} @ (${best.dx},${best.dy}) 亚像素 ≈ (${subX.toFixed(2)},${subY.toFixed(2)})`);
console.log('16 段 MAD    = ' + seg.map((v) => v.toFixed(1)).join(' '));
