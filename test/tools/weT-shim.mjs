#!/usr/bin/env node
/**
 * weT-shim.mjs — 给**单独 import `src/**` 模块**的守卫装一个身份译文层。
 *
 * 为什么需要：`src/**` 的文案走 `weT("中文原文")`（中文原文即键），而 `weT` 是**构建期**
 * 由 `scripts/build-client.mjs` 内联进 bundle 工厂作用域的函数声明 —— 单独 `import()` 一个
 * `src/` 模块（守卫的常用姿势：拿纯函数/常量表来测）时它**不在场**，读 label 就是
 * `ReferenceError: weT is not defined`。
 *
 * 这个 shim 让"单独 import"与"在 bundle 里"的语义**逐字一致**：中文态下 `weT(k)` 就是 `k`
 * （`src/i18n/i18n.js` 的口径）。于是守卫读到的 label 正是面板在中文下会显示的那串。
 *
 * 用法（**必须在 import 目标模块之前**调用一次）：
 *   import { installWeTShim } from './tools/weT-shim.mjs';
 *   installWeTShim();
 *   const mod = await import(new URL('../src/font/components.js', import.meta.url).href);
 *
 * 契约：只**兜底**（已有 `globalThis.weT` 时不覆盖 —— 需要真实译文层的测试可以自己先装）；
 * 不读文件、不抛异常。刻意不实现词表：守卫要断的是"中文下的形态与行为"，英文那侧由
 * `test/verify-i18n.mjs` 在真 VM 里跑真实现。
 */

/**
 * 装身份译文层（幂等）。
 * @returns {boolean} true = 本次装上了；false = 已存在（未覆盖）。
 */
export function installWeTShim() {
  if (typeof globalThis.weT === 'function') return false;
  // 签名与 `weT(key, params, context)` 对齐：身份层下 `{name}` 占位符也照插值
  // （与 i18n 的中文路径同形），这样 `weT("共 {n} 张", { n })` 在守卫里也得到整句。
  globalThis.weT = (key, params) => {
    const text = String(key);
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
  return true;
}

// 自检：正/负对照成对 —— 装上后取词=原文、占位符照插、重复调用不覆盖已有实现。
if (process.argv[1] && process.argv[1].endsWith('weT-shim.mjs')) {
  let failed = 0;
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
    if (!cond) failed++;
  };
  const fresh = () => { delete globalThis.weT; };
  fresh();
  ok('装上：返回 true', installWeTShim() === true);
  ok('身份：原文即译文', globalThis.weT('壁纸模糊') === '壁纸模糊');
  ok('插值：{n} 照插', globalThis.weT('共 {n} 张', { n: 3 }) === '共 3 张');
  ok('缺参：占位符原样留', globalThis.weT('共 {n} 张', {}) === '共 {n} 张');
  ok('幂等：已有实现时返回 false 且不覆盖', installWeTShim() === false);
  fresh();
  globalThis.weT = (k) => 'CUSTOM:' + k;
  ok('不覆盖调用方自己的实现（负对照）', installWeTShim() === false && globalThis.weT('x') === 'CUSTOM:x');
  fresh();
  console.log(failed ? 'selftest FAILED（' + failed + '）' : 'selftest ok');
  process.exit(failed ? 1 : 0);
}
