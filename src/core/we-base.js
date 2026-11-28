/*
 * we-base.js — 浏览器半边的**最小地基**：三枚到处都用、必须只有一份实现的纯工具。
 *
 * 为什么必须是**唯一实现**（而不是各自留一份局部副本）：这三者都是"看不见的行为"
 * （越界值怎么办、没有 `performance` 怎么办、无头环境怎么办），一旦存在第二份副本，
 * 改一处必然漏掉另一处，而漏掉的那处没有任何测试或肉眼反馈会指出来。
 *
 * ⚠️ `weClampTo` 与 `lib/settings-schema.js` 的 `clampNum` **不是**同一个东西（名字像、
 * 语义相反，两者在内联后的同一作用域里都在）：
 *   · `weClampTo` —— **越界即夹紧到边界**（`Math.min(hi, Math.max(lo, n))`），且先把值
 *     转成数字（`"30"` 这类字符串也算数）；转不出有限数才用 `fallback`。
 *   · `clampNum`  —— **越界即回落到默认值**（`v >= lo && v <= hi ? v : fallback`），服务于
 *     设置反序列化（存档里的脏值应当回默认，而不是被悄悄改成边界值）。
 *   两者都只在"值是数字且在范围内"时给出同一个结果 —— 别按名字把调用点对调。
 *
 * 契约：
 *   需要的外界：`window` / `document`（都按"没有就静默"的口径探测），别无其他。
 *   对外提供：`weClampTo(v, lo, hi, fallback)` · `weNow()` · `weBody()`。
 *
 * 不变量：
 *   · **零依赖**：不读 `selection`、不碰任何兄弟模块的符号 —— 它是地基，必须能排在内联
 *     清单最前，也必须能被单独 import（`test/verify-scene-live.mjs` 就是这么测的）。
 *   · **零顶层可执行语句**：本文件的顶层只有声明（内联后 prelude 早于 `src/client.js`
 *     正文求值，顶层读正文必撞 TDZ）。
 */

/** 夹紧到 `[lo, hi]`：非数字先转（如 `"30"`），转不出有限数才用 `fallback`。 */
function weClampTo(v, lo, hi, fallback) {
  const n = typeof v === 'number' && isFinite(v) ? v : Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** 单调时钟（没有 `performance` 就退到 `Date.now`）；只用来算"这点多老了"。 */
function weNow() {
  return window.performance && typeof window.performance.now === 'function'
    ? window.performance.now() : Date.now();
}

/** `document.body` 的落点。没有 DOM 的环境（无头沙箱、SSR 探测）一律 null ⇒ 调用方全链静默。 */
function weBody() {
  if (typeof document === 'undefined' || !document || !document.body) return null;
  return document.body;
}

export { weClampTo, weNow, weBody };
