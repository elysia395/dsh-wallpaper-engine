// verify-shake-fix.mjs — sf35 shake 修正数值断言 + CPU 帧复现
// 用法:
//   node scripts/verify-shake-fix.mjs math        # 公式断言 (新旧跳变对照)
//   node scripts/verify-shake-fix.mjs frames <sceneDir> [w h fps sec]  # CPU 帧级断言
import { SceneRenderer, encodePng } from '../lib/scene-renderer.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const M_PI_2 = Math.PI / 2;
const TWO_PI = Math.PI * 2;

// 旧公式 (2023 pkg 快照, NOISE=0): sin(frac(time/π/2)·π/2) — 相位裁 [0,π/2)
function offsetOld(t, { speed = 1, fx = 1.2, fy = 1.2 } = {}) {
  const time = speed * t;
  let o = Math.sin(((time / M_PI_2) % 1 + 1) % 1 * M_PI_2);
  o = o * 0.498 + 0.5;
  const base = Math.cos(time) >= 0 ? 1 : 0;
  o = base >= 0.5 ? Math.pow(o, fy) : 1 - Math.pow(1 - o, fx);
  o = Math.max(0, Math.min(1, o));
  return o * 2 - 1;
}

// 新公式 (sf35, 官方修复形态): frac(T/6.28)·6.28 切片 + 完整正弦 — 回绕连续
export function offsetNew(t, { speed = 1, fx = 1.2, fy = 1.2 } = {}) {
  const time = (((speed * t / TWO_PI) % 1) + 1) % 1 * TWO_PI;
  let o = Math.sin(time);
  o = o * 0.498 + 0.5;
  const base = Math.cos(time) >= 0 ? 1 : 0;
  o = base >= 0.5 ? Math.pow(o, fy) : 1 - Math.pow(1 - o, fx);
  o = Math.max(0, Math.min(1, o));
  return o * 2 - 1;
}

function maxJump(fn, opts, span = 40, step = 0.001) {
  let prev = fn(0, opts), max = 0, at = 0;
  for (let t = step; t <= span; t += step) {
    const o = fn(t, opts);
    const j = Math.abs(o - prev);
    if (j > max) { max = j; at = t; }
    prev = o;
  }
  return { max, at };
}

const mode = process.argv[2] || 'math';

if (mode === 'math') {
  const p = { speed: 1, fx: 1.2, fy: 1.2 }; // 卡提希亚参数
  const oldJ = maxJump(offsetOld, p);
  const newJ = maxJump(offsetNew, p);
  console.log(`旧公式 (pkg 2023): 40s 内最大相邻跳变 = ${oldJ.max.toFixed(4)} @ t=${oldJ.at.toFixed(3)}s`);
  console.log(`新公式 (sf35):     40s 内最大相邻跳变 = ${newJ.max.toFixed(6)} @ t=${newJ.at.toFixed(3)}s`);
  // 周期与振幅
  let mn = 9, mx = -9;
  for (let t = 0; t < 20; t += 0.002) { const o = offsetNew(t, p); if (o < mn) mn = o; if (o > mx) mx = o; }
  console.log(`新公式 offset 范围: [${mn.toFixed(3)}, ${mx.toFixed(3)}] 周期 6.28/speed = ${(6.28 / p.speed).toFixed(2)}s (平滑往返)`);
  const ok = newJ.max < 0.01 && oldJ.max > 0.3;
  console.log(ok ? 'PASS: 新公式视觉连续 (<0.01 归一化 ≈ <0.06px), 旧公式确有硬跳变 (>0.3 ≈ 2.7px)' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

if (mode === 'frames') {
  // CPU 渲染帧级断言: 相邻帧无孤立闪帧; 植物区慢变化; 人物区平滑位移
  const src = process.argv[3];
  const w = Number(process.argv[4] || 1920);
  const h = Number(process.argv[5] || 1080);
  const fps = Number(process.argv[6] || 24);
  const sec = Number(process.argv[7] || 2);
  const frameCount = Math.max(2, Math.round(fps * sec));
  const times = [];
  for (let i = 0; i < frameCount; i++) times.push((i / frameCount) * sec);
  const dir = mkdtempSync(join(tmpdir(), 'shake-fix-'));
  const renderer = new SceneRenderer(src, { width: w, height: h, time: times[0], times, log: () => {} });
  // 帧差统计 (降采样 1/4 加速: 每 4 像素取 1)
  const prevFrames = [];
  let maxPulse = 0, pulseAt = -1;
  const plantChange = { t0: null, tEnd: null };
  for (let i = 0; i < frameCount; i++) {
    renderer.setTime(times[i]);
    const canvas = renderer.render();
    const d = new Uint8Array(canvas.data); // 复制! canvas.data 逐帧复用
    if (i === 0) plantChange.t0 = d;
    if (i === frameCount - 1) plantChange.tEnd = d;
    if (prevFrames.length) {
      const pd = prevFrames[prevFrames.length - 1];
      let ch = 0, tot = 0;
      for (let k = 0; k < d.length; k += 16) { // 每 4 像素
        tot++;
        if (Math.abs(d[k] - pd[k]) > 8 || Math.abs(d[k + 1] - pd[k+1]) > 8 || Math.abs(d[k + 2] - pd[k+2]) > 8) ch++;
      }
      const pct = (100 * ch) / tot;
      if (pct > maxPulse) { maxPulse = pct; pulseAt = i; }
    }
    prevFrames.push(d);
  }
  console.log(`帧间最大变化率: ${maxPulse.toFixed(2)}% @ frame ${pulseAt} (旧版实测 f003 孤立闪帧 13.8%)`);
  // 植物区 (左下 1/4) 首末帧变化
  let ch = 0, tot = 0;
  const a = plantChange.t0, b = plantChange.tEnd;
  for (let y = Math.floor(h * 0.55); y < h; y += 2) {
    for (let x = 0; x < Math.floor(w * 0.28); x += 2) {
      const k = (y * w + x) * 4;
      tot++;
      if (Math.abs(a[k] - b[k]) > 8 || Math.abs(a[k+1] - b[k+1]) > 8 || Math.abs(a[k+2] - b[k+2]) > 8) ch++;
    }
  }
  const plantPct = (100 * ch) / tot;
  console.log(`植物区 首帧vs末帧 变化: ${plantPct.toFixed(2)}% (摆动应 >1%)`);
  const ok = maxPulse < 6 && plantPct > 1;
  console.log(ok ? 'PASS: 无孤立闪帧, 植物有摆动' : 'FAIL');
  process.exit(ok ? 0 : 1);
}
