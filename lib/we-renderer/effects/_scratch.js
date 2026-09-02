// WE 渲染引擎 — P0-5 效果整帧 scratch 缓冲池
// 背景: 24 个效果每 pass 整帧 new Uint8Array (分配风暴 → RSS 锯齿 + GC 停顿)。
// 方案: 按 (类型, 元素数) 维护空闲列表, 借出/归还 + 帧首统一召回 (recall)。
//
// 生命周期约定 (效果函数内的使用范式):
//   const out = scratchGet(SCRATCH_U8, src.length);   // 借出 (可能复用旧缓冲)
//   ...逐像素写满 out (效果循环本就全帧覆盖, 无残留数据风险)...
//   if (isScratch(src)) scratchPut(src);              // 输入若来自池 (上一效果
//                                                     // 的输出) 用完归还
//   return { width, height, rgba: out };              // 输出继续被链上持有
//
// 安全性 (状态机 out/free, 杜绝 src/out 别名):
//   - 借出状态 (out) 的缓冲绝不出现在空闲列表 → 同一效果内 src 与 out 不可能是
//     同一块内存; 帧内跨效果复用只发生在"上一效果已归还"的缓冲上;
//   - 非池缓冲 (纹理缓存 rgba / image.js 构造的 frame) isScratch()=false,
//     永不归还 — 效果链最上游输入 (对象纹理) 不受影响;
//   - 帧末链尾输出 (applyEffects 最终结果) 无人归还 → 由下一帧 render() 开头的
//     scratchRecallAll() 召回 (image.js 同步 blit 后即丢弃引用, 无悬挂)。

export const SCRATCH_U8 = 1; // Uint8Array (效果整帧 RGBA)
export const SCRATCH_F32 = 2; // Float32Array (bloom 亮部/模糊缓冲)

// buf → 所属空闲列表 + 状态 ('out' 借出 | 'free' 空闲)
const registry = new Map();
// key = `${kind}:${len}` → 空闲缓冲列表 (仅 free 状态入列)
const pools = new Map();

// 借出一块 len 元素的缓冲 (优先复用; 池空才真正分配)
export function scratchGet(kind, len) {
  const key = kind + ':' + len;
  let free = pools.get(key);
  if (!free) { free = []; pools.set(key, free); }
  let buf = free.pop();
  if (buf) {
    registry.get(buf).state = 'out';
    return buf;
  }
  buf = kind === SCRATCH_F32 ? new Float32Array(len) : new Uint8Array(len);
  registry.set(buf, { free, state: 'out' });
  return buf;
}

// 归还一块池内借出缓冲 (幂等: 非池缓冲 / 已归还 / 空闲态一律忽略)
export function scratchPut(buf) {
  if (!buf) return;
  const rec = registry.get(buf);
  if (!rec || rec.state !== 'out') return;
  rec.state = 'free';
  rec.free.push(buf);
}

// 该缓冲是否为池内"借出中"的缓冲 (效果输入归还守卫用)
export function isScratch(buf) {
  const rec = registry.get(buf);
  return rec != null && rec.state === 'out';
}

// 帧首召回: 把所有仍在"借出"状态的缓冲标回可用 (上一帧的效果链输出此时已
// 无引用)。每帧 render() 开头调用一次, 让池跨帧复用。
export function scratchRecallAll() {
  for (const [buf, rec] of registry) {
    if (rec.state === 'out') { rec.state = 'free'; rec.free.push(buf); }
  }
}
