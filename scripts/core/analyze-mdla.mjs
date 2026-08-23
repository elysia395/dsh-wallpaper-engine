// MDLA 动画格式系统分析: 按 36B 切块, 统计每列(9 floats)的值分布
//
// 已确认事实 (2025-06, 头/左眼/左大衣 puppet 逆向):
// - MDLA 条目: [u32 时长ms?][u32 0][name\0][mode\0][pad][骨骼流数据]
// - 数据按骨骼分段 (头 3 骨骼 → 3 段, 每段 ~601 块 × 36B; 左大衣 3 段 ~121 块)
// - 每块 36B = 9 floats, 含 [骨骼 pos.xy 组 + scale/rot]
// - 骨骼流间有跳跃点 (pos 变化 >50)
// - 未解明: 块内字段精确布局 (bone0 pos 在头 @col0-1, 左大衣 @col5-6, 跨模型不一致;
//   疑似多骨骼交错布局 + 每流只更新自身字段 + 占位)
// - 后续: 需更多样例或对照 WE 引擎 (wallpaper64.exe) 逆向
import { readPkg } from '../../lib/we-renderer/textures.js';

const pkg = readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');
const mdl = pkg.read('models/头_puppet.mdl');
const f32 = (off) => mdl.readFloatLE(off);

// 动画 1 数据区: 假设从 9770 起 (bone0 流首块), 到动画 2 名称 74737
const start = 9770, end = 74737;
const blocks = [];
for (let p = start; p + 36 <= end; p += 36) {
  blocks.push(Array.from({ length: 9 }, (_, i) => f32(p + i * 4)));
}
console.log('总块数:', blocks.length);

// 每列统计: 唯一值数, min, max
for (let col = 0; col < 9; col++) {
  const vals = blocks.map(b => b[col]);
  const uniq = new Set(vals.map(v => v.toFixed(4)));
  let min = Infinity, max = -Infinity;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  console.log(`col${col}: 唯一值=${uniq.size} min=${min.toFixed(3)} max=${max.toFixed(3)} 样本=${[...uniq].slice(0, 6).join(',')}`);
}

// 找边界: 块间"跳跃" (骨骼流切换点)
const jumps = [];
for (let i = 1; i < blocks.length; i++) {
  const a = blocks[i - 1], b = blocks[i];
  // 检查 pos 候选列变化
  let maxDelta = 0;
  for (let c = 0; c < 9; c++) maxDelta = Math.max(maxDelta, Math.abs(a[c] - b[c]));
  if (maxDelta > 50) jumps.push({ i, at: start + i * 36, maxDelta: maxDelta.toFixed(0) });
}
console.log('跳跃点:', jumps.map(j => `块${j.i}@${j.at} Δ${j.maxDelta}`).join('\n'));
