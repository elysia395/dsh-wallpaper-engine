// 数学验证: lwe 中心化链 vs 我的非中心化链 是否等价
// lwe: m_pos(场景) → 中心化(x-s_w/2, s_h/2 - y) → ortho(-w/2,w/2,-h/2,h/2) → NDC → 屏幕
// 我:  场景坐标 → dx = x*ps - dw/2, dy = H - y*ps - dh/2 (ps = W/ortho.width)
// 用背景 314 (origin 1920,1080 size 3840,2160) 和头 697 (origin 885.4,800.5 size 548,678) 验证
const W = 1920, H = 1080;
const orthoW = 3840, orthoH = 2160;
const ps = [W / orthoW, H / orthoH]; // [0.5, 0.5]

function lweScreen(origin, size) {
  // lwe: m_pos 场景坐标, 中心化
  const sw = orthoW, sh = orthoH;
  const x1 = origin[0] - size[0]/2, x2 = origin[0] + size[0]/2;
  const y1 = origin[1] - size[1]/2, y2 = origin[1] + size[1]/2;
  // 中心化 (lwe 258-262)
  const cx1 = x1 - sw/2, cx2 = x2 - sw/2;
  const cy1 = sh/2 - y1, cy2 = sh/2 - y2;
  // ortho(-w/2,w/2,-h/2,h/2): ndc = coord / (ortho/2)
  const ndcX1 = cx1 / (sw/2), ndcX2 = cx2 / (sw/2);
  const ndcY1 = cy1 / (sh/2), ndcY2 = cy2 / (sh/2);
  // 屏幕 (OpenGL: y up, ndc y -1 底部 → 屏幕 y = (1-ndcY)/2*H)
  const sx1 = (ndcX1 + 1) / 2 * W, sx2 = (ndcX2 + 1) / 2 * W;
  const sy1 = (1 - ndcY1) / 2 * H, sy2 = (1 - ndcY2) / 2 * H;
  return { x1: sx1, x2: sx2, y1: Math.min(sy1, sy2), y2: Math.max(sy1, sy2) };
}

function myScreen(origin, size) {
  const dw = size[0] * ps[0], dh = size[1] * ps[1];
  const dx = origin[0] * ps[0] - dw / 2;
  const dy = H - origin[1] * ps[1] - dh / 2;
  return { x1: dx, x2: dx + dw, y1: dy, y2: dy + dh };
}

for (const [name, origin, size] of [
  ['背景314', [1920, 1080], [3840, 2160]],
  ['头697', [885.4, 800.5], [548, 678]],
  ['右眼295', [925, 827.5], [32, 32]],
  ['左眼329', [787.9, 905.6], [58, 36]],
]) {
  const l = lweScreen(origin, size);
  const m = myScreen(origin, size);
  console.log(`${name}:`);
  console.log(`  lwe: x[${l.x1.toFixed(1)},${l.x2.toFixed(1)}] y[${l.y1.toFixed(1)},${l.y2.toFixed(1)}] 中心(${((l.x1+l.x2)/2).toFixed(1)},${((l.y1+l.y2)/2).toFixed(1)})`);
  console.log(`  my:  x[${m.x1.toFixed(1)},${m.x2.toFixed(1)}] y[${m.y1.toFixed(1)},${m.y2.toFixed(1)}] 中心(${((m.x1+m.x2)/2).toFixed(1)},${((m.y1+m.y2)/2).toFixed(1)})`);
  console.log(`  差:  dx=${(((l.x1+l.x2)/2)-((m.x1+m.x2)/2)).toFixed(1)} dy=${(((l.y1+l.y2)/2)-((m.y1+m.y2)/2)).toFixed(1)}`);
}
