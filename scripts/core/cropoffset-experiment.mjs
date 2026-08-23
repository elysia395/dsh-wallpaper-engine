// cropoffset 语义实验: 对普通 image 应用 cropoffset 偏移 vs 不应用
// 渲染 Amiya 两种版本, 统计: 头内容被遮比例 + 各组件内容位置
import { SceneRenderer } from '../../lib/we-renderer/core.js';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';
const T = 2.5;

// 钩子: 拦截 renderImage 前给对象加 cropOffsetShift, renderImage 读取
function renderWithCropOffsetMode(mode) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
  // 包装 renderImage: 根据 mode 决定是否给对象加模拟偏移
  const orig = r.renderImage.bind(r);
  r.renderImage = (o, t) => {
    const model = r.readJsonAny(o.image);
    if (model && model.cropoffset && !model.puppet && mode === 'apply') {
      const [cx, cy] = model.cropoffset.trim().split(/\s+/).map(Number);
      // 用临时字段给 renderImage 用: 偏移 quad
      o._cropShift = [cx, cy];
    }
    return orig(o, t);
  };
  r.render();
  return r;
}

// 直接修改 core.js 渲染逻辑太复杂, 这里用原型 patch: 渲染后分析内容
// 方案: 简单对比 — 无 cropoffset 应用 (当前 core.js 行为) vs 手动移动组件
const A = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
A.render();

// 方案B: 对普通 image 的 origin 加 cropoffset (模拟 quad 偏移)
const B = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: T, weAssetsDir: WE, log: () => {} });
const saveOrigins = new Map();
for (const o of B.objects) {
  if (!o.image) continue;
  const model = B.readJsonAny(o.image);
  if (model && model.cropoffset && !model.puppet) {
    const [cx, cy] = model.cropoffset.trim().split(/\s+/).map(Number);
    const cur = String(o.origin || '0 0 0').trim().split(/\s+/).map(Number);
    saveOrigins.set(o.id, o.origin);
    o.origin = `${cur[0] + cx} ${cur[1] + cy} ${cur[2] || 0}`;
  }
}
B.render();

// 分析头内容覆盖
function analyze(r, label) {
  const d = r.canvas.data;
  const W = r.W, H = r.H;
  // 头内容 bbox 从单独渲染: 151,362..261,506 (无 cropoffset 版)
  // 这里用 scene 头对象找内容: 简单统计画布上 y>500 的头区域? 太复杂
  // 改用: 统计头(size矩形)下方的非背景内容分布 — 简化: 检查头 size 矩形内非背景像素
  return d;
}
analyze(A, 'A');
analyze(B, 'B');

// 对比 A vs B 在头 size 矩形区域 (153,255,137,170) 的差异
const dA = A.canvas.data, dB = B.canvas.data;
const hx = 153, hy = 255, hx2 = 290, hy2 = 425;
let aNontrans = 0, bNontrans = 0;
for (let y = hy; y < hy2; y++) for (let x = hx; x < hx2; x++) {
  const i = (y * A.W + x) * 4;
  if (dA[i + 3] > 10) aNontrans++;
  if (dB[i + 3] > 10) bNontrans++;
}
console.log(`头 size 矩形区域非透明像素: A(无cropoffset应用)=${aNontrans} B(普通image应用cropoffset)=${bNontrans}`);
// 全画布差异
let diff = 0, total = 0;
for (let i = 0; i < dA.length; i += 4) {
  total++;
  if (Math.abs(dA[i] - dB[i]) > 40 || Math.abs(dA[i+1] - dB[i+1]) > 40 || Math.abs(dA[i+2] - dB[i+2]) > 40 || dA[i+3] !== dB[i+3]) diff++;
}
console.log(`全画布差异像素: ${diff}/${total} (${((diff / total) * 100).toFixed(1)}%)`);
