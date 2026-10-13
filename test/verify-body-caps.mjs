#!/usr/bin/env node
/**
 * verify-body-caps.mjs — 「**收 body 的路由必须有上限**」的结构守卫。
 *
 * ── 为什么需要它（这条判据的来历）────────────────────────────────────────────
 * 宿主侧有若干条 POST/PUT 路由把请求体收进内存。**没有上限**时，异常大的请求体让宿主堆无界
 * 增长（OOM / 进程死亡）；而上限**不会**因为"同族其它的路都有"就自动出现 —— 它靠人记得抄。
 * 本仓实测过一次完整的因果链：
 *   ① 一次只读审计发现三条路由没有上限，并明确记下判据缺口 ——「没有任何守卫要求'收 body 的
 *      路由必须有上限'；同族已有的闸全靠人记得抄」；
 *   ② 之后新增的一条路由（`/media-control`）**又忘了抄**，于是缺口从三条变成四条。
 * 同一条链上还有第二个静默缺陷：逐块 `body += chunk` 再逐块 `toString()`，会把落在两个 TCP
 * 分片之间的多字节码点切成 U+FFFD，而用户可见字符串（壁纸 id / 字体名 / 字体族）被写坏了
 * 客户端永远不知道。正确形态是**边收边计字节、收完只解码一次**。
 *
 * ⇒ 所以这条判据**从磁盘枚举**每一个 `req.on('data')` 站点，而不是维护一份"该有闸的路由名单"：
 * 名单会漂，枚举不会。新增路由只要写了 `req.on('data')` 就自动进面。
 *
 * ── 判据形态（为什么是它）──────────────────────────────────────────────────
 * `req.on('data', cb)` 的 `cb` 分两类：
 *   · **收集器**（collector）：内联函数字面量，闭包一个累加变量。**必须**在回调**体内**出现
 *     一次字节/长度比较（`size > CONTROL_JSON_MAX_BYTES`、`body.length > SETTINGS_MAX_BYTES`、
 *     `size > 4 * 1024 * 1024` …）。
 *   · **非收集器**（non-collector）：回调是**裸标识符**（本仓唯一实例是 `req.on('data', arm)`，
 *     `armBodyIdleTimeout` 里那个只顾重置 idle 计时器的函数）。它不闭包累加器 ⇒ 没有"上限"
 *     可言。这条豁免是**结构性**的（裸标识符 vs 内联闭包），不是一份名字白名单 ——
 *     收集器必须内联才能闭包累加变量，所以这个区分不会漏掉任何真实的收集器。
 *
 * ── 判据必须有牙（正/负对照喂**同一个**判据函数）──────────────────────────────
 * 只断言"今天干净"不够：解析器一旦静默返回空表，正断言会恒绿。因此下面成对断言：
 *   · 覆盖面地板（站点数 ≥ 8）—— 空表/解析退化 ⇒ 当场红；
 *   · 负对照：无上限的内联回调必须被判**不合格**；
 *   · 负对照：上限写在回调**外面**（同一文件别处有一句 `size > 1024`）必须**仍然**判不合格
 *     —— 这条钉的是"判据作用域 = 回调体内"，防止判据退化成全文件扫描；
 *   · 负对照：`findBodyReadSites` 对合成源码认出站点（抽取器本身可判非空）。
 *
 * 剥注释用共享的**字符串感知**实现（`tools/js-text.mjs`）：朴素正则会被注释/字符串里的块注释
 * 起始带跑，一路吃掉真实代码 ⇒ 判据静默失效（本仓规则 ⑦ 就是钉这件事的）。
 *
 * Usage:  node test/verify-body-caps.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './tools/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'lib');

/** 扫描面排除：vendored 第三方（不归我们维护）与本半边的生成物。 */
const EXCLUDE_DIRS = new Set(['vendor', 'webwallgl']);
const EXCLUDE_FILES = new Set(['client.js']);

/**
 * 上限判据：一次把"字节/长度计数器"与某个限值/常量比大小的比较。
 * 认这些左值：`.length` / `size` / `bytes` / `len` / `count`（本仓既有的闸都用其中之一）。
 */
const CAP_RE = /(?:\.length|\bsize\b|\bbytes\b|\blen\b|\bcount\b)\s*>\s*(?:[A-Za-z_$][\w$]*|\d)/;

/** `req.on('data'` / `req.once('data'` —— 两种写法都算收 body 的站点。 */
const SITE_RE = /req\.(?:on|once)\(\s*['"]data['"]\s*,\s*/g;

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(p, out);
    } else if (entry.name.endsWith('.js') && !EXCLUDE_FILES.has(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/** 1-based 行号：`index` 是**剥注释后**文本里的偏移（等长替换 ⇒ 与原文一致）。 */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * 引号感知的花括号配对：从 `open`（必须是 `{`）开始找配对的 `}`。
 * 字符串/模板里的花括号不计数（剥注释保留了字符串，所以这里必须自己跳过它们）。
 * 找不到配对返回 -1（调用方按"判据不可判定"处理，宁可红）。
 */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) break;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * 判据核心：抽出源码里每一个 `req.on('data', …)` 站点。
 * 返回 [{ line, kind, callback }]，kind ∈ {'collector','non-collector'}。
 * 合成源码与真实源码走**同一个**函数（负对照因此证明的是同一条判据）。
 */
function findBodyReadSites(src) {
  const sites = [];
  SITE_RE.lastIndex = 0;
  let m;
  while ((m = SITE_RE.exec(src)) !== null) {
    const start = m.index + m[0].length;
    const line = lineAt(src, m.index);
    const rest = src.slice(start);
    // 非收集器：回调是裸标识符，形如 `arm)`（本仓唯一实例见文件头）。
    const bare = /^([A-Za-z_$][\w$]*)\s*\)/.exec(rest);
    if (bare) {
      sites.push({ line, kind: 'non-collector', name: bare[1], callback: '' });
      continue;
    }
    // **共享读体器**的处理器引用：形如 `reader.onData)`。它自己**不该**在这里有闸 ——
    // 闸住在 `lib/http-body.js` 的那一份实现里（P4-13）。是不是真的来自那实现，由下面
    // 用「同一文件里有没有 `bodyReader(` 赋给这个标识符」来判（不让任意 `foo.onData` 蒙混）。
    const viaReader = /^([A-Za-z_$][\w$]*)\.onData\s*\)/.exec(rest);
    if (viaReader) {
      sites.push({ line, kind: 'reader', name: viaReader[1], callback: '' });
      continue;
    }
    // 收集器：内联箭头/函数字面量 —— 取到回调体的配对 `}`。
    const braceIdx = src.indexOf('{', start);
    if (braceIdx === -1) {
      sites.push({ line, kind: 'unparsable', callback: '' });
      continue;
    }
    const end = matchBrace(src, braceIdx);
    if (end === -1) {
      sites.push({ line, kind: 'unparsable', callback: '' });
      continue;
    }
    sites.push({ line, kind: 'collector', callback: src.slice(braceIdx, end + 1) });
  }
  return sites;
}

/** 一条判据：收集器必须在**回调体内**出现上限比较。 */
const hasCap = (callback) => CAP_RE.test(callback);

// ── ① 判据自身的正/负对照（先证明它有牙，再看真实代码）──────────────────────
check('负对照：无上限的内联回调被判不合格',
  hasCap('{ body += c; }') === false, 'snippet={ body += c; }');
check('正对照：字节计上限被判合格',
  hasCap('{ size += c.length; if (size > CONTROL_JSON_MAX_BYTES) { return; } chunks.push(c); }') === true,
  'snippet=size > CONTROL_JSON_MAX_BYTES');
check('正对照：`.length` 形式的闸也被认',
  hasCap('{ body += c; if (body.length > SETTINGS_MAX_BYTES) fail(413); }') === true);

// ── ② 抽取器的正/负对照 ─────────────────────────────────────────────────────
{
  const synth = "req.on('data', (c) => { body += c; });\n"
    + "req.on('data', (c) => { size += c.length; if (size > 1024) return; chunks.push(c); });\n"
    + "req.on('data', arm);\n";
  const found = findBodyReadSites(synth);
  check('负对照：抽取器认出内联收集器', found.filter((s) => s.kind === 'collector').length === 2,
    'collectors=' + found.filter((s) => s.kind === 'collector').length);
  check('负对照：裸标识符回调归为非收集器（豁免是结构性的）',
    found.some((s) => s.kind === 'non-collector' && s.name === 'arm'));
  check('负对照：抽取器对合成源码能判出上限的有无',
    hasCap(found[0].callback) === false && hasCap(found[1].callback) === true);
  check('负对照：抽取器返回空表时判据会失败（覆盖面地板有牙）',
    findBodyReadSites('const x = 1;').length === 0);
}

// ── ②b 判据作用域：上限必须在**回调体内**，不是"同一文件里出现过比较" ─────────
// 这条是必须的：判据若退化成"全文件搜一次大小比较"，任何文件只要别处有一句 `size > N`
// 就会把无上限的收集器一起放过 —— 那正是本仓最不想要的静默通过形态。
{
  const outside = "req.on('data', (c) => { body += c; });\nconst limit = size > 1024;\n";
  const found = findBodyReadSites(outside);
  check('负对照：上限在回调**外** ⇒ 该站点仍判不合格（作用域 = 回调体内）',
    found.length === 1 && found[0].kind === 'collector'
      && hasCap(found[0].callback) === false && CAP_RE.test(outside) === true,
    '文件级有比较、回调级没有');
}

// ── ③ 真实代码：从磁盘枚举 ─────────────────────────────────────────────────
const files = walk(LIB).sort();
const sites = [];
for (const file of files) {
  const text = stripComments(readFileSync(file, 'utf8'));
  for (const site of findBodyReadSites(text)) {
    sites.push({ ...site, file: relative(ROOT, file).split('\\').join('/') });
  }
}

const collectors = sites.filter((s) => s.kind === 'collector');
const uncapped = collectors.filter((s) => !hasCap(s.callback));
const unparsable = sites.filter((s) => s.kind === 'unparsable');
const readers = sites.filter((s) => s.kind === 'reader');

// ── P4-13：收 body 的两条形状 ────────────────────────────────────────────────
//   · **内联收集器**（`req.on('data', (c) => {…})`）—— 闸必须在这一段回调体里（原有判据）。
//     P4-13 之后只应剩**流式落盘**那两处：它们边收边写 `.tmp`，**不许**把体缓冲进内存
//     （512MB 的 `/upload` 与 `/custom-frame`），是**结构性豁免**而不是漏网的副本。
//   · **共享读体器**（`reader.onData`）—— 闸住在 `lib/http-body.js` 的唯一一份实现里；
//     这里只判"它确实来自那实现"，不重复要求闸。
// 两条棘轮（都只许朝收敛方向走）：内联收集器**只减**、共享读体器的调用点**只增**。
const INLINE_CEILING = 2;   // 棘轮：内联收集器上限 = **收敛终点**（只剩两处流式豁免）
const READER_FLOOR = 9;     // 棘轮：共享读体器的调用点下限（防"只剩一份实现"靠删调用点达成）
const READER_MODULE = 'lib/http-body.js';

/** 该文件里被 `bodyReader(` 赋值过的标识符集合（`const reader = bodyReader(req, {…})`）。 */
const readerVarsIn = (src) => new Set(
  [...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*bodyReader\s*\(/g)].map((m) => m[1]));

const readerSource = existsSync(join(ROOT, READER_MODULE)) ? readFileSync(join(ROOT, READER_MODULE), 'utf8') : '';
const srcByFile = new Map();
for (const file of files) srcByFile.set(relative(ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
const bogusReaders = readers.filter((s) => !readerVarsIn(srcByFile.get(s.file) || '').has(s.name));
const readerFiles = new Set(readers.map((s) => s.file));
const notImported = [...readerFiles].filter((f) => !/from\s+['"][^'"]*http-body\.js['"]/.test(srcByFile.get(f) || ''));

console.log(`\n  扫描面：lib/**/*.js（排除 ${[...EXCLUDE_DIRS].join(' / ')} 与 ${[...EXCLUDE_FILES].join(' / ')}）`
  + ` —— ${files.length} 个文件`);
console.log(`  收 body 站点：${sites.length}（内联收集器 ${collectors.length} · 共享读体器 ${readers.length}`
  + ` · 非收集器 ${sites.length - collectors.length - readers.length - unparsable.length}）`);
for (const s of collectors) {
  console.log(`    ${hasCap(s.callback) ? '✓' : '✗'} ${s.file}:${s.line}（内联）`);
}
for (const s of readers) {
  console.log(`    ${bogusReaders.includes(s) ? '✗' : '·'} ${s.file}:${s.line}（共享读体器 ${s.name}）`);
}
console.log('');

// 覆盖面地板：解析器静默返回空表 / 站点被改名 ⇒ 当场红，而不是"全绿通过"。
check('覆盖面：收 body 站点总数 ≥ 8（空表或解析退化即失败）', sites.length >= 8,
  `实测 ${sites.length}`);
check('判据可判定：没有配对失败的站点（宁可红，不可静默跳过）', unparsable.length === 0,
  unparsable.map((s) => `${s.file}:${s.line}`).join(', ') || '无');
check('每一个**内联**收集器都在回调体内有上限（流式豁免那两处也在这里被逐站点名）',
  uncapped.length === 0,
  uncapped.map((s) => `${s.file}:${s.line}`).join(', ') || '全部有闸');
// P4-13 的两条棘轮 + 共享读体器的存在性与来路
check('棘轮：内联收集器 ≤ ' + INLINE_CEILING + '（P4-13 的收敛方向：终点 = 2 处流式豁免）',
  collectors.length <= INLINE_CEILING, `实测 ${collectors.length}`);
check('棘轮：共享读体器 `' + READER_MODULE + '` 存在，且自身带字节计闸',
  readerSource !== '' && /(?:\.length|\bsize\b|\bbytes\b)\s*>\s*maxBytes/.test(readerSource),
  readerSource === '' ? '文件不存在'
    : '上限语句=' + (/(?:\.length|\bsize\b|\bbytes\b)\s*>\s*maxBytes/.test(readerSource) ? '在位' : '缺失'));
check('棘轮：共享读体器的调用点 ≥ ' + READER_FLOOR + '（只许增，防"只剩一份"靠删调用点达成）',
  readers.length >= READER_FLOOR, `实测 ${readers.length}`);
check('每个 `X.onData` 都真的来自同一文件里的 `bodyReader(...)`（任意 `foo.onData` 蒙混不过去）',
  bogusReaders.length === 0,
  bogusReaders.map((s) => `${s.file}:${s.line}(${s.name})`).join(', ') || '全部来自 bodyReader');
check('用了共享读体器的文件都 import 了它（没 import 就是另一个同名东西）',
  notImported.length === 0, notImported.join(', ') || '全部已 import');

// ── 第三条：调用点里被**置位的标志**必须真的在那个作用域里声明过 ──────────────
// 为什么这条值得单独钉：P4-13 的迁移把 `let done/tooLarge = false` 从内联回调里挪走了，
// 而 `shouldStop` / `onOverflow` 是**闭包** —— 少一行声明就要等到"这条路由真的收到体"
// 才炸 ReferenceError。本轮实测踩中**三处**，其中 `/we-assets-dir` 一处**行为判据完全没覆盖**
// （没有任何用例往它 POST 过体）⇒ 静态判据在这里补的是行为判据的盲区。
// 只认 `NAME = true|false|数字` 这种**布尔/计数标志**的形态（`charset=utf-8` 这类字符串内的
// `=` 因此不会被误判），并先剥注释（规则 ⑦）。
const FLAG_SET_RE = /(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*=\s*(?:true|false|\d+)\b/g;
/** 只认**调用点**：`export function bodyReader(req, {…}) {` 那个定义处的花括号是形参解构，
 *  把它当成 options 会把函数体整段扫进来（实测会把 `size = 0` / `overflowed = false` 误报）。 */
const isDefinition = (code, at) => /function\s+$/.test(code.slice(Math.max(0, at - 12), at));
const undeclaredFlags = [];
for (const [rel, src] of srcByFile) {
  const code = stripComments(src);
  for (const m of code.matchAll(/bodyReader\s*\(/g)) {
    if (isDefinition(code, m.index)) continue;
    const optsStart = code.indexOf('{', m.index);
    if (optsStart < 0) continue;
    const optsEnd = code.indexOf('});', optsStart);
    const opts = code.slice(optsStart, optsEnd < 0 ? code.length : optsEnd + 3);
    const before = code.slice(0, m.index);
    for (const f of new Set([...opts.matchAll(FLAG_SET_RE)].map((x) => x[1]))) {
      if (!new RegExp('(?:let|const|var)\\s+' + f + '\\b').test(before)) {
        undeclaredFlags.push(rel + ':' + f);
      }
    }
  }
}
check('每个共享读体器调用点里被置位的标志，都在**它之前**声明过（闭包捕获不存在的名字 = 一收体就 ReferenceError）',
  undeclaredFlags.length === 0, undeclaredFlags.join(', ') || '全部已声明');
{
  const ok = 'let done = false;\nconst r = bodyReader(req, {\n  shouldStop: () => done,\n  onOverflow: () => { done = true; },\n});';
  const bad = 'const r = bodyReader(req, {\n  onOverflow: () => { done = true; },\n});';
  const probe = (src) => {
    const code = stripComments(src);
    const r = [];
    for (const m of code.matchAll(/bodyReader\s*\(/g)) {
      const s = code.indexOf('{', m.index);
      const e = code.indexOf('});', s);
      for (const f of new Set([...code.slice(s, e + 3).matchAll(FLAG_SET_RE)].map((x) => x[1]))) {
        if (!new RegExp('(?:let|const|var)\\s+' + f + '\\b').test(code.slice(0, m.index))) r.push(f);
      }
    }
    return r;
  };
  check('negative control: 声明在位时判合格', probe(ok).length === 0);
  check('negative control: 声明被挪走时判出来（本轮实测的那个形状）', probe(bad).join(',') === 'done');
  check('negative control: 字符串里的 `charset=utf-8` 不得被当成标志', probe("const r = bodyReader(req, { onOverflow: () => res.setHeader('Content-Type', 'application/json; charset=utf-8') });").length === 0);
}

// 负对照：新分类与来路判定的牙
{
  const fromReader = 'const r = bodyReader(req, { maxBytes: 1 });\nreq.on("data", r.onData);\n';
  const handmade = 'const r = makeReader();\nreq.on("data", r.onData);\n';
  const bogusCount = (src) => findBodyReadSites(src)
    .filter((s) => s.kind === 'reader' && !readerVarsIn(src).has(s.name)).length;
  check('negative control: `reader.onData` 来自 bodyReader 时判合格',
    bogusCount(fromReader) === 0 && findBodyReadSites(fromReader).some((s) => s.kind === 'reader'));
  check('negative control: 自己造的 `X.onData` 被判出来（不是"长得像就放行"）', bogusCount(handmade) === 1);
  check('negative control: 内联回调仍按"回调体内有没有闸"判（不被新分类顺带放过）',
    findBodyReadSites("req.on('data', (c) => { chunks.push(c); });")
      .filter((s) => s.kind === 'collector' && !hasCap(s.callback)).length === 1);
}

console.log('');
if (failed) {
  console.log(`BODY-CAP CHECKS FAILED — ${failed} 条不合格`);
  console.log('修法：按 lib/routes/upload.js 文件头的两条不变量改 —— 边收边计字节（size += chunk.length）、'
    + '超限即 413 早退、收完只 Buffer.concat(...).toString("utf8") 解码一次。');
  process.exit(1);
}
console.log('BODY-CAP CHECKS PASSED');
