/**
 * occlusion/rects.js — 遮挡矩形运算的**唯一纯函数实现**（无 IO、无状态、可单测）。
 *
 * 坐标系约定（本文所有函数共用）：
 *   · 屏幕坐标系：原点在根窗口左上角，y 向下；矩形统一 `[x, y, w, h]`（像素）。
 *   · 「自窗矩形」= 壳窗客户区（内容区）在屏幕坐标系的矩形；遮挡矩形一律先被
 *     裁剪进自窗矩形——渲染器（WebWallGL）只关心落进画布里的部分。
 *
 * 与渲染器的分工（为什么这里**不做**矩形差集）：
 *   渲染器拿到 `occluders` 后**自己**做「画布 ∖ 遮挡」求可见区域、算可见率、驱动
 *   run/light/heavy/pause 分档（见 docs/wip/LINUX-OCCLUSION.md §1）。宿主侧把差集
 *   再做一遍是纯冗余——所以本模块只负责「把一堆原始矩形变成一份**干净的遮挡集**」：
 *   裁剪、去零面积、合并重叠（合并只是减少传输体积，渲染器对重叠是幂等的）。
 *
 * 契约：对外提供 `clipRect / rectsArea / cleanOccluders`。
 * 不变量：
 *   · 所有函数**纯**：不读环境、不改入参（返回新数组）；空输入 ⇒ 空输出，不抛错。
 *   · `w <= 0 || h <= 0` 的矩形视为不存在（"零面积"），一律被 `cleanOccluders` 丢弃。
 *   · 数值必须是有限数；调用方（x11 适配器）负责把 X11 返回的整数保证成整数，
 *     本模块不 defensively 校验每个字段（性能路径，丑输入属于适配器的 bug）。
 */

/**
 * 把一个矩形裁剪进边界矩形。
 * @param {[number, number, number, number]} rect
 * @param {[number, number, number, number]} bounds
 * @returns {[number, number, number, number] | null} 不相交或零面积 ⇒ null
 */
export function clipRect(rect, bounds) {
  const x1 = Math.max(rect[0], bounds[0]);
  const y1 = Math.max(rect[1], bounds[1]);
  const x2 = Math.min(rect[0] + rect[2], bounds[0] + bounds[2]);
  const y2 = Math.min(rect[1] + rect[3], bounds[1] + bounds[3]);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  return [x1, y1, w, h];
}

/**
 * 批量裁剪：丢掉不相交/零面积项，保持顺序（顺序对渲染器无意义，但稳定顺序利于 diff）。
 */
function clipRectsToBounds(rects, bounds) {
  const out = [];
  for (const r of rects) {
    const clipped = clipRect(r, bounds);
    if (clipped) out.push(clipped);
  }
  return out;
}

/** 矩形面积和（**含**重叠部分——用于"合并后体积"估计，不是可见率）。 */
export function rectsArea(rects) {
  let sum = 0;
  for (const r of rects) sum += r[2] * r[3];
  return sum;
}

/**
 * 两两合并相交/相触的矩形（贪心，非最小覆盖——目标是省字节，不是最优性）。
 * 一轮扫描：任一 rect 与已收矩形相交则替换成并包矩形并重新扫描；不变则收下。
 * 最坏 O(n²)，n 是**自窗之上的可见窗口数**（几十），可忽略。
 */
function mergeRects(rects) {
  const merged = [];
  for (const r of rects) {
    let cur = r.slice();
    let didMerge = true;
    while (didMerge) {
      didMerge = false;
      for (let i = 0; i < merged.length; i++) {
        if (intersectsOrTouches(cur, merged[i])) {
          cur = unionRect(cur, merged[i]);
          merged.splice(i, 1);
          didMerge = true;
          break;
        }
      }
    }
    merged.push(cur);
  }
  return merged;
}

/** 相交或**单轴**边缘相触（`[0,0,10,5]` 与 `[0,5,10,5]` 合成一个，纯赚）。
 *  不得合并「仅角相触」的矩形（两轴都只贴边零重叠）：`[0,0,100,100]` 与
 *  `[100,100,100,100]` 的并包会把 20000px² 的实际遮挡报成 40000px²，可见率被
 *  低估 ⇒ 渲染器向 heavy/pause 过度降档（假 pause）。判据 = 一轴真重叠(>0)
 *  且另一轴相触或重叠。 */
function intersectsOrTouches(a, b) {
  const xOverlap = a[0] < b[0] + b[2] && b[0] < a[0] + a[2];
  const yOverlap = a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  const xTouch = a[0] <= b[0] + b[2] && b[0] <= a[0] + a[2];
  const yTouch = a[1] <= b[1] + b[3] && b[1] <= a[1] + a[3];
  return (xOverlap && yTouch) || (yOverlap && xTouch);
}

/** 并包（不要求相交，调用点自行保证语义）。 */
function unionRect(a, b) {
  const x1 = Math.min(a[0], b[0]);
  const y1 = Math.min(a[1], b[1]);
  const x2 = Math.max(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x1, y1, x2 - x1, y2 - y1];
}

/**
 * 产出干净遮挡集的唯一入口：裁剪进自窗 → 去零面积（clipRect 已保证）→ 合并。
 * 返回的新数组按**输入顺序**（堆叠序，自底向上）——顺序仅是可读性，渲染器不依赖。
 *
 * @param {number[][]} rawRects 屏幕坐标系的候选遮挡矩形（可含不相交/越界/零面积项）
 * @param {[number, number, number, number]} ownRect 自窗客户区（屏幕坐标系）
 * @returns {number[][]} 裁剪后仍以**屏幕坐标**表示（相对化到自窗原点是路由层的事，
 *   见 `lib/occlusion/index.js` —— 本模块不认识"自窗"概念以外的语义）。
 */
export function cleanOccluders(rawRects, ownRect) {
  return mergeRects(clipRectsToBounds(rawRects, ownRect));
}
