#!/usr/bin/env node
/**
 * verify-extra-glass.mjs — 「额外补雾化的选择器」（上游 #200）：生成、消毒贯通、DOM 通道、接线。
 *
 * 为什么要有这一层：本键把**用户自填的文本**拼进一条 CSS 规则（本仓第二处"用户文本进 CSS"，
 * 另一处是字体族）。三件事只有守卫看得住：
 *   ① **消毒必须真的贯通到产物**：白名单在 settings-schema 里写得再严，只要生成侧绕开它，
 *      一条 `;}` 就能把规则撕开、把后面的声明写成任意 CSS（= 给自己开了注入面）；
 *   ② **规则形态必须保持"伪元素载体"**：载体挂在 `::before` 上才不会成为 `position:fixed`
 *      后代的包含块（本仓 #89 那个坑）。哪天有人图省事把它改回"直接给宿主元素加
 *      backdrop-filter"，第三方面板内部的定位弹层会静默改锚 —— 肉眼很难归因，这里当场判。
 *   ③ **两条门不许丢**：`data-we-glass-page`（皮肤让路态下整族失效）与
 *      `:not([data-we-glass-fallback])`（软渲档不保留不生效的 backdrop-filter，同 #95 政策）。
 *
 * 分节：
 *   ① 生成（纯函数）：空清单 = 零规则；每条一个 `::before` 载体；声明齐（含两个前缀）；
 *      模糊读的是全局 `--we-blur`（所以跟随「雾化」滑杆）
 *   ② 消毒贯通：注入串一个字都进不去；坏条只丢自己；合法属性选择器保留
 *   ②b 总量上限：8 条 × 120 字（974 B）全量保留且每条长度/起始符合法；任何超限输入（含
 *      975 字符这一档）⇒ **整体拒绝 0 条**，绝不 slice 出半截选择器（+ 旧实现红对照）
 *   ③ 负对照：未消毒的同串拼进规则**会**含 `}` ⇒ ② 不是恒真
 *   ④ DOM 通道：空 ⇒ 不建标签 · 有值 ⇒ 建且内容正确 · 同值不重写 · 变空/卸载 ⇒ 移除
 *   ⑤ 接线（源码形态）：effects 两处调用 · INLINE_MODULES 登记 · 面板控件与文案 ·
 *      两侧 ctx 都给处理器（漏一侧 = 侧栏档渲染期 ReferenceError）· schema 两处登记
 *   ⑥ 设置往返：合法清单过 sanitizeFromSchema 逐字保留；非法条被丢
 *
 * 本模块与 src/adapter.js 同族：按构建期契约**同作用域内联**，`sanitizeExtraGlassSelectors`
 * 是外部作用域的自由变量 ⇒ 这里把它挂到 globalThis 复现同一形态（每种初值用新 URL 重新
 * import，避免模块级状态互相污染）。
 *
 * Usage: node test/verify-extra-glass.mjs
 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MOD_URL = pathToFileURL(join(ROOT, 'src', 'glass-extra.js')).href;
const TAG_ID = 'dsh-wallpaper-engine/extra-glass';

const schema = await import(pathToFileURL(join(ROOT, 'lib', 'settings-schema.js')).href);
const effectsSrc = readFileSync(join(ROOT, 'src', 'effects.js'), 'utf8');
const panelSrc = readFileSync(join(ROOT, 'src', 'glass-panel.js'), 'utf8');
const clientSrc = readFileSync(join(ROOT, 'src', 'client.js'), 'utf8');
const quickSrc = readFileSync(join(ROOT, 'src', 'quick-panel.js'), 'utf8');
const buildSrc = readFileSync(join(ROOT, 'scripts', 'build-client.mjs'), 'utf8');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { failed++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

/** 极简 DOM 桩：只做本模块用到的那四件事（建标签 / 查标签 / 挂 head / remove）。 */
function makeDoc() {
  const head = { children: [] };
  head.appendChild = (el) => { head.children.push(el); return el; };
  const doc = {
    head,
    createElement(tag) {
      const el = { tagName: tag, dataset: {}, textContent: '', removed: false };
      el.remove = () => { el.removed = true; const i = head.children.indexOf(el); if (i >= 0) head.children.splice(i, 1); };
      return el;
    },
    querySelector(sel) {
      const m = /^style\[data-plugin-css="(.*)"\]$/.exec(sel);
      if (!m) return null;
      return head.children.find((e) => e.tagName === 'style' && e.dataset.pluginCss === m[1]) || null;
    },
  };
  return doc;
}

let seq = 0;
/** 复现"内联同作用域"：消毒器挂 globalThis，document 每次换成新的桩。 */
async function fresh() {
  const doc = makeDoc();
  globalThis.sanitizeExtraGlassSelectors = schema.sanitizeExtraGlassSelectors;
  globalThis.document = doc;
  const mod = await import(MOD_URL + '?v=' + (++seq));
  return { mod, doc };
}

const GOOD = '.dsh-mobile-control__panel, .dim-jh-badgePop';

// ── ① 生成（纯函数）────────────────────────────────────────────────────────────
{
  const { mod } = await fresh();
  check('空清单 ⇒ 空串（一条规则都不生成）', mod.weExtraGlassCss({ extraGlassSelectors: '' }) === '',
    JSON.stringify(mod.weExtraGlassCss({ extraGlassSelectors: '' })));
  check('缺键 ⇒ 空串', mod.weExtraGlassCss({}) === '');
  check('非字符串 ⇒ 空串', mod.weExtraGlassCss({ extraGlassSelectors: 42 }) === '');

  const css = mod.weExtraGlassCss({ extraGlassSelectors: GOOD });
  const n = (css.match(/::before \{/g) || []).length;
  check('两条选择器 ⇒ 两条 ::before 载体', n === 2, 'n=' + n);
  check('载体挂在 ::before 上（**不是**直接给目标元素加 backdrop-filter —— #89 的包含块坑）',
    /\.dsh-mobile-control__panel::before \{/.test(css) && !/\.dsh-mobile-control__panel \{[^}]*backdrop-filter/.test(css));
  for (const decl of ['content: ""', 'position: absolute', 'inset: 0', 'border-radius: inherit',
    'z-index: -1', 'pointer-events: none']) {
    check('载体声明齐：' + decl, css.includes(decl));
  }
  const webkitCount = (css.match(/-webkit-backdrop-filter: blur\(/g) || []).length;
  const stdCount = (css.match(/(?:^|[^-])backdrop-filter: blur\(/g) || []).length;
  check('两个前缀的 backdrop-filter 都在（-webkit- 与标准，逐条规则各一份）',
    webkitCount === 2 && stdCount === 2, 'webkit=' + webkitCount + ' std=' + stdCount);
  const webkitBlur = (css.match(/-webkit-backdrop-filter: blur\(var\(--we-blur, 16px\)\)/g) || []).length;
  const stdBlur = (css.match(/(?:^|[^-])backdrop-filter: blur\(var\(--we-blur, 16px\)\)/g) || []).length;
  check('模糊读全局 `--we-blur`（= 跟随「雾化」滑杆，不是写死半径）',
    webkitBlur === 2 && stdBlur === 2, 'webkit=' + webkitBlur + ' std=' + stdBlur);
  check('门①：整组挂在 data-we-glass-page 下（皮肤让路态跟着一起失效）',
    (css.match(/body\[data-we-glass-page\]:not\(\[data-we-glass-fallback\]\) /g) || []).length === 2);
  check('门②：软渲档整组不匹配（不保留不会生效的 backdrop-filter，同 #95 政策）',
    css.includes(':not([data-we-glass-fallback])'));
}

// ── ② 消毒贯通 ────────────────────────────────────────────────────────────────
{
  const { mod } = await fresh();
  const evil = '.evil; } body { display: none }';
  const css = mod.weExtraGlassCss({ extraGlassSelectors: evil });
  check('注入串一个字都进不去（整条作废，不修剪成另一个选择器）', css === '', JSON.stringify(css));
  const css2 = mod.weExtraGlassCss({ extraGlassSelectors: GOOD + ', .x{y}' });
  check('坏条只丢自己，好条照旧',
    (css2.match(/::before \{/g) || []).length === 2 && !css2.includes('.x'));
  const css3 = mod.weExtraGlassCss({ extraGlassSelectors: '[data-dsh-mobile-details]' });
  check('合法属性选择器保留（那是真实面板的锚点形状）', css3.includes('[data-dsh-mobile-details]::before'));
  check('生成结果里不出现任何 `}` 由选择器引入的痕迹（选择器只在 { 之前）',
    css2.split('::before {').every((part, i) => i === 0 || !/\}/.test(part.split('backdrop-filter:')[0])));
}

// ── ②b 总量上限（P1 复审：#204 原实现 slice(0,400) 会切出半截选择器）──────────────
// 合法输入的极限是 8 条 × 单条 120 字 = 974 B（含 7 个 ", "）。旧版把总量上限写死 400 并对
// 结果 `.slice(0, 400)` ⇒ 8 条满长输入只活下来 4 条、第 4 条被切成半截（能匹配到**别的**
// 元素，与"整条作废、不修剪"的纪律冲突）。判定口径钉死到"不许半截"：
//   · 满量合法输入 ⇒ 逐条逐字节保留（条数、每条长度区间、起始符合法性、总量）
//   · 任何总量超限的输入 ⇒ **整体拒绝、0 条**（而不是截断出半截）
// 要求 8 条 × 120 是**可达上界**：因为每条 ≤120，所以 >974 的输入必然至少 9 条（974+2+1=977），
// 故"975 字符也不许半截"与">974 ⇒ 0 条"是同一条断言。
{
  const { mod } = await fresh();
  const PER_MAX = 120;
  const COUNT_MAX = 8;
  const FULL = Array.from({ length: COUNT_MAX }, (_, i) => ('.p' + i + '-x'.repeat(PER_MAX)).slice(0, PER_MAX));
  const JOINED = FULL.join(', ');
  const TOTAL_MAX = JOINED.length;                       // 974，由 8×120 推导而来
  const START_OK = /^[A-Za-z0-9.#_:*>()[\]=+~|\-]/;     // 与 schema 白名单首字符一致
  const selOf = (css) => css.split('\n').filter((l) => l.includes('::before'))
    .map((l) => l.replace(/^body\[data-we-glass-page\]:not\(\[data-we-glass-fallback\]\) /, '')
      .replace(/::before \{.*$/, ''));
  // 一条判据，正反两用：每段必须逐字属于输入、长度在 [1,120]、起始符合法。
  const intact = (sels) => sels.length === COUNT_MAX && sels.every((s) =>
    FULL.includes(s) && s.length >= 1 && s.length <= PER_MAX && START_OK.test(s));
  const out = mod.weExtraGlassCss({ extraGlassSelectors: JOINED });
  const got = selOf(out);
  check('②b-1 8 条满长（各 120 字 / 合计 ' + TOTAL_MAX + ' B）全量保留，一条不丢、一句不切',
    intact(got) && out.length >= TOTAL_MAX && schema.sanitizeExtraGlassSelectors(JOINED).length === TOTAL_MAX,
    'n=' + got.length + ' · 规则 ' + got.length + ' · 消毒器直出 ' + schema.sanitizeExtraGlassSelectors(JOINED).length + ' B');
  check('②b-2 消毒器直出 = 输入逐字节（不重排、不丢字、不补分隔符）',
    schema.sanitizeExtraGlassSelectors(JOINED) === JOINED, TOTAL_MAX + ' B');
  check('②b-2b 每条都逐字属于输入、长度 ∈[1,' + PER_MAX + '] 且以合法起始符开头（结构上排除半截）',
    got.length === COUNT_MAX && got.every((s) => FULL.includes(s) && s.length >= 1 && s.length <= PER_MAX && START_OK.test(s)),
    got.map((s) => s.length).join(','));
  // 超限输入：**多余的条整条丢**（不是切半）。这一档覆盖"975 字符"——因为单条已限 120、
  // 条数已限 8，任何 >974 的输入必然至少 9 条（974+2+1=977），只能落在这一类里。
  const subsetIntact = (sels, inputs) => sels.length <= COUNT_MAX && sels.every((s) =>
    inputs.includes(s) && s.length >= 1 && s.length <= PER_MAX && START_OK.test(s));
  const OVER = FULL.concat(['.z']);
  const OVER9 = Array.from({ length: COUNT_MAX + 1 }, (_, i) => ('.q' + i + '-y'.repeat(PER_MAX)).slice(0, PER_MAX));
  const OVER_STR = OVER.join(', ');
  const OVER9_STR = OVER9.join(', ');
  const over1 = selOf(mod.weExtraGlassCss({ extraGlassSelectors: OVER_STR }));
  const over9 = selOf(mod.weExtraGlassCss({ extraGlassSelectors: OVER9_STR }));
  check('②b-2c 超限输入（' + OVER_STR.length + ' B = 8+1 条 · ' + OVER9_STR.length + ' B = 9 条，含 975 字符这一档）⇒ 多余的条**整条丢**，存活每条逐字属于输入、长度 ≤' + PER_MAX + '、总量 ≤' + TOTAL_MAX + '，绝不半截',
    subsetIntact(over1, FULL) && subsetIntact(over9, OVER9)
    && schema.sanitizeExtraGlassSelectors(OVER_STR).length <= TOTAL_MAX
    && schema.sanitizeExtraGlassSelectors(OVER9_STR).length <= TOTAL_MAX,
    '8+1 条 ⇒ ' + over1.length + ' 条 / ' + schema.sanitizeExtraGlassSelectors(OVER_STR).length + ' B · 9 条 ⇒ ' + over9.length + ' 条 / ' + schema.sanitizeExtraGlassSelectors(OVER9_STR).length + ' B · 上界 ' + TOTAL_MAX + ' B');
  // 模糊 300 组（合法 / 超长 / 含非法字符 / 条数 1–11）：产物恒为「整条子集」，永不半截。
  let fuzzBad = 0;
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 300; t++) {
    const n = 1 + Math.floor(rnd() * 11);
    const inputs = [];
    const pieces = [];
    for (let i = 0; i < n; i++) {
      const len = 1 + Math.floor(rnd() * (PER_MAX + 3));
      const s = ('.f' + t + '-' + i + '-' + 'z'.repeat(len)).slice(0, len);
      inputs.push(s);
      pieces.push(i === n - 1 && rnd() < 0.25 ? s + '!' : s);   // 掺入非法尾字符
    }
    const san = schema.sanitizeExtraGlassSelectors(pieces.join(', '));
    const sels = selOf(mod.weExtraGlassCss({ extraGlassSelectors: pieces.join(', ') }));
    if (san.length > TOTAL_MAX || sels.length > COUNT_MAX
      || sels.some((s) => !inputs.includes(s) || s.length < 1 || s.length > PER_MAX || !START_OK.test(s))) fuzzBad++;
  }
  check('②b-2d 300 组随机输入（含超长 / 非法字符 / 1–11 条）的产物恒为「整条子集」：无半截、≤' + COUNT_MAX + ' 条、≤' + TOTAL_MAX + ' B',
    fuzzBad === 0, 'violations=' + fuzzBad);
  // 负对照：复刻旧实现（join 后 slice(0,400)），用**同一条 intact 判据**必须判红。
  const OLD_MAX = 400;                                    // 旧实现写死的总量上限（就是 bug 本身）
  const oldSel = JOINED.slice(0, OLD_MAX).split(', ');
  check('negative control ②b-1: 旧实现 slice(0,' + OLD_MAX + ') 在同一条判据下判红 —— 产出半截选择器',
    !intact(oldSel), '旧输出 ' + OLD_MAX + ' B / ' + oldSel.length + ' 条 · 末段 ' + JSON.stringify(oldSel[oldSel.length - 1]) + ' 长度 ' + oldSel[oldSel.length - 1].length);
  // 源码形态：截断是"半截选择器"的唯一来源 ⇒ 总量上限必须由两个量纲**算出来**且不再 slice。
  const schemaSrc = readFileSync(join(ROOT, 'lib', 'settings-schema.js'), 'utf8');
  check('②b-3 总量上限由 8×120 推导（不是手写魔数），且结果不再走 slice 截断',
    /const EXTRA_GLASS_SELECTORS_MAX = EXTRA_GLASS_SELECTOR_COUNT \* EXTRA_GLASS_SELECTOR_MAX\s+\+ 2 \* \(EXTRA_GLASS_SELECTOR_COUNT - 1\);/.test(schemaSrc)
    && !/\.slice\(0,\s*EXTRA_GLASS_SELECTORS_MAX\)/.test(schemaSrc));
}

// ── ③ 负对照：没有消毒就会带进 `}` ⇒ ② 不是恒真 ───────────────────────────────
{
  const raw = '.evil; } body { display: none }';
  const bypass = 'body[data-we-glass-page] ' + raw + '::before { content: ""; }';
  check('negative control：同一串**不消毒**直接拼 ⇒ 规则里出现注入用的 `}`（② 有牙）',
    /\} body \{/.test(bypass));
}

// ── ④ DOM 通道 ────────────────────────────────────────────────────────────────
{
  const { mod, doc } = await fresh();
  mod.syncExtraGlassCss({ extraGlassSelectors: '' });
  check('空清单 ⇒ 不建标签', doc.head.children.length === 0);

  mod.syncExtraGlassCss({ extraGlassSelectors: GOOD });
  check('有值 ⇒ 建一个本通道的 <style>', doc.head.children.length === 1
    && doc.head.children[0].dataset.pluginCss === TAG_ID);
  const tag = doc.head.children[0];
  const css1 = tag.textContent;
  check('标签内容 = 生成结果', css1 === mod.weExtraGlassCss({ extraGlassSelectors: GOOD }));

  mod.syncExtraGlassCss({ extraGlassSelectors: GOOD });
  check('同值重复同步 ⇒ 不重写（内容比对，逐字符相等即不碰 DOM）', tag.textContent === css1);

  mod.syncExtraGlassCss({ extraGlassSelectors: '.other' });
  check('值变化 ⇒ 重写', tag.textContent !== css1 && tag.textContent.includes('.other::before'));

  mod.syncExtraGlassCss({ extraGlassSelectors: '' });
  check('值变空 ⇒ 撤掉标签（不留空 <style>）', doc.head.children.length === 0);

  mod.syncExtraGlassCss({ extraGlassSelectors: GOOD });
  const t2 = doc.head.children[0];
  mod.disposeExtraGlassCss();
  check('dispose ⇒ 标签移除（卸载路径）', doc.head.children.length === 0 && t2.removed === true);
  mod.disposeExtraGlassCss();
  check('重复 dispose 不抛（幂等）', doc.head.children.length === 0);
}

// ── ⑤ 接线（源码形态）─────────────────────────────────────────────────────────
{
  check('effects.applyEffects 同步这条通道',
    /applyGlass\(selection, s\);\n[^\n]*\n(?:[^\n]*\n)*?\s+syncExtraGlassCss\(selection\);/.test(effectsSrc)
    || /syncExtraGlassCss\(selection\);/.test(effectsSrc));
  check('effects.clearEffects 撤标签（与 body 那批清理成对）', /disposeExtraGlassCss\(\);/.test(effectsSrc));
  check('构建期内联清单已登记 src/glass-extra.js', buildSrc.includes("file: 'src/glass-extra.js'"));
  check('面板渲染了这个控件（走 weT 词条 + 具名处理器）',
    /weT\("额外补雾化的选择器"\)/.test(panelSrc) && /onInput: \(e\) => onExtraGlassSelectors\(e\.target\.value\)/.test(panelSrc));
  check('渲染器解构了这个处理器（否则面板拿到 undefined）', /onExtraGlassSelectors,/.test(panelSrc));
  check('设置页 ctx 给了处理器', /onExtraGlassSelectors,/.test(clientSrc));
  check('侧栏 ctx 也给了处理器（漏一侧 = 侧栏档渲染期 ReferenceError）',
    /onExtraGlassSelectors,/.test(quickSrc));
  check('处理器是模块级（在 WallpaperPicker 之前声明）',
    clientSrc.indexOf('const onExtraGlassSelectors') > 0
    && clientSrc.indexOf('const onExtraGlassSelectors') < clientSrc.indexOf('function WallpaperPicker() {'));
  check('schema：KINDS + DEFAULTS 都有这个键',
    schema.KINDS.extraGlassSelectors && schema.KINDS.extraGlassSelectors.kind === 'extraSelectors'
    && schema.DEFAULTS.extraGlassSelectors === '');
  check('预设段自动携带（PROFILE_PRESET_KEYS 由 KINDS 派生，不是一个手抄清单）',
    schema.PROFILE_PRESET_KEYS.includes('extraGlassSelectors'));
}

// ── ⑥ 设置往返 ────────────────────────────────────────────────────────────────
{
  const ok = schema.sanitizeFromSchema(
    Object.assign({}, schema.DEFAULTS, { extraGlassSelectors: GOOD }), 'client');
  check('合法清单经 sanitizeFromSchema 逐字保留', ok.extraGlassSelectors === GOOD);
  const bad = schema.sanitizeFromSchema(
    Object.assign({}, schema.DEFAULTS, { extraGlassSelectors: '.a;}x' }), 'client');
  check('非法条经 sanitizeFromSchema 被丢（两侧共用同一份判据）', bad.extraGlassSelectors === '');
}

console.log('\n' + (failed ? 'EXTRA-GLASS CHECKS FAILED — ' + failed + ' failed' : 'ALL EXTRA-GLASS CHECKS PASSED'));
process.exit(failed ? 1 : 0);
