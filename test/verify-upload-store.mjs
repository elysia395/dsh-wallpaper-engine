#!/usr/bin/env node
/**
 * 聚焦守卫：`lib/upload-store.js`（上传元数据账本 `<uploads>/.meta.json`）。
 *
 * 这个模块只在做一件事，但那件事的四条不变量**每一条放松都会静默丢数据**，所以判据按不变量分组：
 *   1. 目录只经 `getUploadDir()` **活访问器**取（宿主 `setUploadDir()` 后套件必须跟随，旧目录不再被碰）
 *      —— A 段；
 *   2. 读路径永不抛、且**非账本形态一律退化为 `{}`**（缺失 / 坏 JSON / 字符串 / 数字 / null / **JSON 数组**）
 *      —— B 段（数组那条是模块文件头不变量 3 的边界：实现曾漏掉 `Array.isArray`，`[]` 会被当成账本
 *      读进来，随后 `JSON.stringify([])` 让每一次写盘**静默变成空账本**）；
 *   3. `metaEntry` 的三形态归一（legacy 字符串 / 对象 / 缺键）—— C 段；
 *   4. 写必须过注入的**串行队列**（读整份 → 改一条 → 原子写回），失败不抛且队列仍可用 —— D/E/F 段。
 *
 * 口径（与 docs/DEV-GUIDE.md §4.7 一致）：
 *   · 期望值**从被测源码自行重推**，不复用被测代码里的常量/函数；
 *   · 每条正向判据与它的负对照喂**同一个判据函数**（变异体只改被测源码，不动判据）；
 *   · 注入面用**真实现**（`lib/kernel/config.js` 的 kit 提供队列与原子写）——"串行"这条由真队列见证，
 *     而不是由替身假装见证；`getUploadDir` 用活访问器以便模拟 `setUploadDir`；
 *   · 覆盖面地板写在 `if` 之外。
 *
 * ── Ⅰ 段（本文件第二个被测面）：`/upload-dir` **真路由**的行为面 ──────────────────────────
 * 由来（zero-coverage 缺口）：`test/verify-scene-live.mjs` 只钉了 `/upload-dir` 的 405，
 * 于是 `lib/upload-dir.js` 的两个真 bug 一直**没有任何判据**：
 *   ① kit 按**无参**调 `ensureDir()`（内核注入的是收目录的 `ensureDirOnce`）⇒ POST 换目录直接 500
 *      `ensureUploadDir is not a function`（上游形态是 `ensureUploadDir()` = `ensureDirOnce(getUploadDir())`）；
 *   ② `setUploadDir` 末尾**丢了 `writeConfig`**（上游自己持久化 `cfg.uploadDir`）⇒ 改完重启就回落，
 *      用户可见的"改了却像没生效"。
 * 两段都用**真门面 `apply()` + 真路由 handler + 假 req/res**（形态抄 `verify-cache-dir.mjs`），
 * 判据本体与负对照共用：负对照 = ①注入恒真 no-op 的 `ensureDir` / 源码变异回"丢参数"形态，
 * ②源码变异去掉 `writeConfig(cfg);`。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { createUploadStoreKit } from '../lib/upload-store.js';
// ⚠️ 重指真源（task-10 D）：配置内核住 `lib/kernel/config.js`（上游同名副本 `lib/config-store.js`
// 已随删除提交移除）。本文件只借它的 `enqueueConfigWrite` / `atomicWriteFileSync` 两项，
// 两项都在真源导出面上；注入的 `configPath` 是真源 task-10 D 补的注入缝。
import { createConfigKit } from '../lib/kernel/config.js';
import { createCheck } from './tools/assert-harness.mjs';
import { stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'upload-store-guard');
const SRC = join(ROOT, 'lib', 'upload-store.js');
const SOURCE = readFileSync(SRC, 'utf8');
const OWN = readFileSync(fileURLToPath(import.meta.url), 'utf8');
mkdirSync(ISO, { recursive: true });

const { check, stats } = createCheck();
let mutants = 0;
let dirSeq = 0;

function section(title) { console.log('\n' + title); }

function freshDir(label) {
  dirSeq += 1;
  const d = join(ISO, `${label}-${dirSeq}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

function readMetaRaw(dir) {
  const p = join(dir, '.meta.json');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function writeMetaRaw(dir, raw) { writeFileSync(join(dir, '.meta.json'), raw); }

/** 与宿主同形的 `ensureDirOnce`：按路径 memoize + `mkdirSync(recursive)`。 */
function makeEnsureDirOnce() {
  const seen = new Set();
  return (dir) => {
    if (!seen.has(dir)) { mkdirSync(dir, { recursive: true }); seen.add(dir); }
    return dir;
  };
}

/** 组装一套（真 kit / 变异体）上传账本。`getDir` 是活访问器。 */
function storeFor(getDir, opts = {}) {
  const cfg = createConfigKit({ configPath: () => join(getDir(), 'config.json') });
  const factory = opts.factory || createUploadStoreKit;
  const kit = factory({
    getUploadDir: getDir,
    ensureDirOnce: makeEnsureDirOnce(),
    enqueueConfigWrite: opts.enqueue || cfg.enqueueConfigWrite,
    atomicWriteFileSync: opts.writer || cfg.atomicWriteFileSync,
  });
  return { kit, cfg };
}

/**
 * 变异体：把被测源码锚点替换后落盘再 import。
 * 替换一律用**函数式** replacer —— 替换串里出现 `$'`/`$&` 时字符串式替换会展开成特殊模式。
 */
function loadMutant(label, transforms) {
  let text = SOURCE;
  for (const [find, replace] of transforms) {
    if (!text.includes(find)) {
      throw new Error(`变异体 ${label} 的锚点没命中：${JSON.stringify(find.slice(0, 70))} —— 源码变了就同步改锚点`);
    }
    text = text.replace(find, () => replace);
  }
  mutants += 1;
  const file = join(ISO, 'mutants', `${mutants}-${label}.mjs`);
  mkdirSync(join(ISO, 'mutants'), { recursive: true });
  writeFileSync(file, text);
  return import(pathToFileURL(file).href);
}

/**
 * `loadMutant` 的推广：把**任一**被测源码的锚点替换后落盘再 import（Ⅰ 段的被测面是
 * `lib/upload-dir.js`，不是 `lib/upload-store.js`）。替换同样用**函数式** replacer。
 */
function loadMutantOf(srcFile, label, transforms) {
  let text = readFileSync(srcFile, 'utf8');
  for (const [find, replace] of transforms) {
    if (!text.includes(find)) {
      throw new Error(`变异体 ${label} 的锚点没命中（${srcFile}）：${JSON.stringify(find.slice(0, 70))} —— 源码变了就同步改锚点`);
    }
    text = text.replace(find, () => replace);
  }
  mutants += 1;
  const file = join(ISO, 'mutants', `${mutants}-${label}.mjs`);
  mkdirSync(join(ISO, 'mutants'), { recursive: true });
  writeFileSync(file, text);
  return import(pathToFileURL(file).href);
}

const REAL = (getDir, opts = {}) => storeFor(getDir, opts);

/** 同一个判据函数喂正向与负对照（负对照只换被测源码）。 */
async function pair(name, judge, label, transforms) {
  const pos = await judge(REAL);
  check(name, pos.ok === true, '正向读数：' + pos.detail);
  const mod = await loadMutant(label, transforms);
  const mut = await judge((getDir, opts = {}) => storeFor(getDir, { ...opts, factory: mod.createUploadStoreKit }));
  check(`${name} —— 负对照（${label}）必须判红`, mut.ok === false, '变异体读数：' + mut.detail);
}

// ───────────────────────── A. 活访问器（不变量 4） ─────────────────────────
async function judgeAccessor(make) {
  const dir1 = freshDir('a-first');
  const dir2 = join(ISO, 'a-next-' + (dirSeq + 1));
  rmSync(dir2, { recursive: true, force: true });
  let current = dir1;
  const getDir = () => current;
  const { kit } = make(getDir);

  const created = kit.ensureUploadDir();
  const pathBefore = kit.uploadMetaPath();
  current = dir2;
  const followed = kit.ensureUploadDir();
  const pathAfter = kit.uploadMetaPath();
  await kit.setUploadMeta('k', 'T', 'S');

  const ok = created === dir1 && existsSync(dir1)
    && followed === dir2 && existsSync(dir2)
    && pathBefore === join(dir1, '.meta.json') && pathAfter === join(dir2, '.meta.json')
    && readMetaRaw(dir1) === null
    && readMetaRaw(dir2) === JSON.stringify({ k: { title: 'T', sha256: 'S' } });
  return { ok, detail: `建目录=${created === dir1} 跟随=${followed === dir2} 旧目录未动=${readMetaRaw(dir1) === null} 新目录=${readMetaRaw(dir2)}` };
}

// ───────────────────────── B. 读路径永不抛 / 非账本 ⇒ {}（不变量 3） ─────────────────────────
const READ_CASES = [
  ['缺文件', null],
  ['坏 JSON', '{ 坏'],
  ['字符串', '"str"'],
  ['数字', '123'],
  ['null', 'null'],
  ['JSON 数组 []', '[]'],
  ['JSON 数组 [1,2]', '[1,2]'],
];

async function judgeReadNeverThrows(make) {
  const dir = freshDir('b-bad');
  const { kit } = make(() => dir);
  const bad = [];
  for (const [label, raw] of READ_CASES.slice(0, 5)) {
    rmSync(join(dir, '.meta.json'), { force: true });
    if (raw !== null) writeMetaRaw(dir, raw);
    let got; let threw = false;
    try { got = kit.readUploadMeta(); } catch { threw = true; }
    if (threw || JSON.stringify(got) !== '{}') bad.push(`${label} → ${threw ? 'THREW' : JSON.stringify(got)}`);
  }
  // 合法账本必须原样读出（否则"永不抛"可以靠"永远返回 {}"作弊）
  writeMetaRaw(dir, '{"a":{"title":"A","sha256":"x"}}');
  const good = kit.readUploadMeta();
  const goodOk = JSON.stringify(good) === '{"a":{"title":"A","sha256":"x"}}';
  if (!goodOk) bad.push('合法账本 → ' + JSON.stringify(good));
  return { ok: bad.length === 0, detail: bad.length ? bad.join(' · ') : '缺失/坏JSON/字符串/数字/null 一律 {}，合法账本原样' };
}

async function judgeReadRejectsArrays(make) {
  const dir = freshDir('b-array');
  const { kit } = make(() => dir);
  const bad = [];
  for (const [label, raw] of READ_CASES.slice(5)) {
    writeMetaRaw(dir, raw);
    let got; let threw = false;
    try { got = kit.readUploadMeta(); } catch { threw = true; }
    if (threw || JSON.stringify(got) !== '{}') bad.push(`${label} → ${threw ? 'THREW' : JSON.stringify(got)}`);
  }
  // 数组账本的可观察后果：写盘必须**落得下去**（不是写进一个 JSON.stringify 成 `[]` 的壳）
  const { kit: kit2 } = make(() => dir);
  writeMetaRaw(dir, '[]');
  await kit2.setUploadMeta('k', 'T', 'S');
  const after = readMetaRaw(dir);
  const wrote = after === JSON.stringify({ k: { title: 'T', sha256: 'S' } });
  if (!wrote) bad.push('数组账本上写入 → 盘上 ' + JSON.stringify(after) + '（写被丢掉）');
  return { ok: bad.length === 0, detail: bad.length ? bad.join(' · ') : 'JSON 数组不算账本，退化为 {} 后写入正常落盘' };
}

// ───────────────────────── C. metaEntry 三形态（不变量 3 的归一） ─────────────────────────
async function judgeLegacyEntry(make) {
  const { kit } = make(() => freshDir('c-legacy'));
  const e = kit.metaEntry({ k: 'Legacy Title' }, 'k');
  const ok = e && e.title === 'Legacy Title' && e.sha256 === null && e.contentrating === null;
  return { ok, detail: JSON.stringify(e) };
}

async function judgeObjectEntry(make) {
  const { kit } = make(() => freshDir('c-object'));
  const meta = {
    a: { title: '  Title  ', sha256: 'abc', contentrating: ' PG13 ' },
    b: { title: '   ', sha256: 7, contentrating: 5 },
    c: { title: 'T', sha256: 's' },
  };
  const a = kit.metaEntry(meta, 'a');
  const b = kit.metaEntry(meta, 'b');
  const c = kit.metaEntry(meta, 'c');
  const missing = kit.metaEntry(meta, 'zz');
  const ok = a.title === '  Title  ' && a.sha256 === 'abc' && a.contentrating === 'PG13'
    && b.title === 'b' && b.sha256 === null && b.contentrating === null
    && c.contentrating === null
    && missing.title === 'zz' && missing.sha256 === null && missing.contentrating === null;
  return { ok, detail: JSON.stringify({ a, b, c, missing }) };
}

// ───────────────────────── D. 写/读/删往返（不变量 1、2） ─────────────────────────
async function judgeRoundTrip(make) {
  const dir = freshDir('d-round');
  const { kit } = make(() => dir);
  await kit.setUploadMeta('one', 'One', 'sha1');
  await kit.setUploadMeta('two', '', null);
  const meta = kit.readUploadMeta();
  const wrote = meta.one && meta.one.title === 'One' && meta.one.sha256 === 'sha1'
    && meta.two && meta.two.title === 'two' && meta.two.sha256 === null;
  // 删除只动自己那一格
  await kit.removeUploadMeta('one');
  const after = kit.readUploadMeta();
  const removedOnly = !('one' in after) && after.two && after.two.title === 'two';
  // 删不存在的 id：不抛、账本 byte 不变
  let threw = false;
  try { await kit.removeUploadMeta('nope'); } catch { threw = true; }
  const noop = !threw && JSON.stringify(kit.readUploadMeta()) === JSON.stringify(after);
  return { ok: Boolean(wrote && removedOnly && noop), detail: `往返=${Boolean(wrote)} 只删自己=${removedOnly} 删缺失不抛且不变=${noop}` };
}

// ───────────────────────── E. 写必须过注入的串行队列（不变量 1） ─────────────────────────
async function judgeConcurrentWrites(make) {
  const dir = freshDir('e-concurrent');
  const base = createConfigKit({ configPath: () => join(dir, 'config.json') });
  const calls = [];
  const { kit } = make(() => dir, {
    enqueue: (fn) => { calls.push(fn); return base.enqueueConfigWrite(fn); },
  });
  await Promise.all(Array.from({ length: 25 }, (_, i) => kit.setUploadMeta('c' + i, 'T' + i, 'S' + i)));
  const meta = kit.readUploadMeta();
  const keys = Object.keys(meta);
  const allKept = keys.length === 25 && keys.every((k, i) => k === 'c' + i && meta[k] && meta[k].sha256 === 'S' + i);
  const allQueued = calls.length === 25;
  return { ok: allKept && allQueued, detail: `25 路并发后键数=${keys.length} · 进队列次数=${calls.length}` };
}

async function judgeQueueOrder(make) {
  const dir = freshDir('e-order');
  const base = createConfigKit({ configPath: () => join(dir, 'config.json') });
  const order = [];
  const { kit } = make(() => dir, {
    enqueue: (fn) => base.enqueueConfigWrite(() => { order.push('module-write'); fn(); }),
  });
  // 先入队一个"慢任务"，再让套件写：写必须排在它之后（真串行，而不是"恰好都不冲突"）
  const slow = base.enqueueConfigWrite(() => new Promise((resolve) => {
    order.push('other-start');
    setTimeout(() => { order.push('other-end'); resolve(); }, 10);
  }));
  const write = kit.setUploadMeta('k', 'T', 'S');
  await Promise.all([slow, write]);
  const ok = JSON.stringify(order) === JSON.stringify(['other-start', 'other-end', 'module-write'])
    && readMetaRaw(dir) === JSON.stringify({ k: { title: 'T', sha256: 'S' } });
  return { ok, detail: JSON.stringify(order) };
}

// ───────────────────────── F. 失败隔离（不变量 1 的兜底） ─────────────────────────
async function judgeFailureIsolation(make) {
  const dir = freshDir('f-flaky');
  const { cfg } = make(() => dir);
  let writes = 0;
  const flaky = (file, data) => {
    writes += 1;
    if (writes === 1) throw new Error('boom');
    cfg.atomicWriteFileSync(file, data);
  };
  // 用 `make`（而不是 `storeFor`）装 kit —— 否则变异体工厂根本不参与，负对照会静默变绿。
  const { kit } = make(() => dir, { writer: flaky, enqueue: cfg.enqueueConfigWrite });
  let threwFirst = false;
  try { await kit.setUploadMeta('a', 'A', 's'); } catch { threwFirst = true; }
  const firstLanded = 'a' in kit.readUploadMeta();
  let threwSecond = false;
  try { await kit.setUploadMeta('b', 'B', 's'); } catch { threwSecond = true; }
  const second = kit.readUploadMeta();
  const ok = !threwFirst && !threwSecond && !firstLanded && Boolean(second.b && second.b.title === 'B');
  return { ok, detail: `第一次抛=${threwFirst} 第一次落盘=${firstLanded} 第二次抛=${threwSecond} 第二次落盘=${JSON.stringify(second)}` };
}

// ───────────────────────── G. 常量与导出面（消费方依赖） ─────────────────────────
const PREVIEW_CANDIDATES_WANT = ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp'];

async function judgeConstants(make) {
  const { kit } = make(() => freshDir('g-api'));
  const names = ['ensureUploadDir', 'uploadMetaPath', 'readUploadMeta', 'metaEntry', 'setUploadMeta', 'removeUploadMeta', 'PREVIEW_CANDIDATES'];
  const missing = names.filter((n) => !(n in kit));
  const extra = Object.keys(kit).filter((n) => !names.includes(n));
  const order = JSON.stringify(kit.PREVIEW_CANDIDATES) === JSON.stringify(PREVIEW_CANDIDATES_WANT);
  return { ok: missing.length === 0 && extra.length === 0 && order, detail: `缺=${JSON.stringify(missing)} 多=${JSON.stringify(extra)} 候选序=${JSON.stringify(kit.PREVIEW_CANDIDATES)}` };
}

// ───────────────────────── 判据 ─────────────────────────
section('A. 目录只经活访问器（不变量 4：宿主 setUploadDir 后套件跟随）');
await pair(
  'A 换目录后建目录/取路径/写盘都跟随新目录，旧目录 byte 不变',
  judgeAccessor,
  'meta-path-frozen',
  [[`  function uploadMetaPath() { return join(getUploadDir(), '.meta.json'); }`,
    `  const FROZEN_DIR = getUploadDir();\n  function uploadMetaPath() { return join(FROZEN_DIR, '.meta.json'); }`]],
);

section('B. 读路径永不抛 / 非账本 ⇒ {}（不变量 3）');
await pair(
  'B1 缺失/坏 JSON/字符串/数字/null ⇒ {}，合法账本原样读出',
  judgeReadNeverThrows,
  'read-returns-raw',
  [[`      const o = JSON.parse(readFileSync(p, 'utf8'));`,
    `      return JSON.parse(readFileSync(p, 'utf8'));`]],
);
await pair(
  'B2 JSON 数组不算账本 ⇒ {}，且数组账本上的写入必须能落盘（不是写进 `[]` 壳）',
  judgeReadRejectsArrays,
  'read-returns-raw',
  [[`      const o = JSON.parse(readFileSync(p, 'utf8'));`,
    `      return JSON.parse(readFileSync(p, 'utf8'));`]],
);

section('C. metaEntry 三形态归一');
await pair(
  'C1 legacy 字符串形态 ⇒ {title, sha256:null, contentrating:null}',
  judgeLegacyEntry,
  'legacy-branch-gone',
  [[`    if (typeof v === 'string') return { title: v, sha256: null, contentrating: null };\n`, '']],
);
await pair(
  'C2 对象形态逐字段透传：title 原样、空白 title 回落 id、非法 sha256/rating ⇒ null、缺键回落 id',
  judgeObjectEntry,
  'sha-unchecked',
  [[`      sha256: typeof v.sha256 === 'string' ? v.sha256 : null,`, `      sha256: v.sha256,`]],
);
await pair(
  'C3 对象形态的空白 title 也回落 id（不是空串）',
  judgeObjectEntry,
  'entry-title-no-fallback',
  [[`      title: typeof v.title === 'string' && v.title.trim() ? v.title : id,`, `      title: v.title,`]],
);

section('D. 写/读/删往返（不变量 1、2）');
await pair(
  'D 往返：写后读回、空 title 回落 id、删只动自己那格、删缺失不抛且账本不变',
  judgeRoundTrip,
  'remove-no-delete',
  [[`        if (id in m) { delete m[id]; atomicWriteFileSync(uploadMetaPath(), JSON.stringify(m)); }`,
    `        if (id in m) { atomicWriteFileSync(uploadMetaPath(), JSON.stringify(m)); }`]],
);
await pair(
  'D 往返：写侧空 title 的回落（title || id）',
  judgeRoundTrip,
  'write-title-no-fallback',
  [[`        m[id] = { title: title || id, sha256: sha256 || null };`, `        m[id] = { title, sha256 };`]],
);

section('E. 写必须过注入的串行队列（不变量 1：读整份 → 改一条 → 原子写回）');
await pair(
  'E1 25 路并发写零丢失，且 25 次写全部经过注入的队列',
  judgeConcurrentWrites,
  'bypass-queue',
  [[`    return enqueueConfigWrite(() => {`, `    return Promise.resolve().then(() => {`]],
);
await pair(
  'E2 套件的写排在先前入队的任务之后（真串行，不是"恰好不冲突"）',
  judgeQueueOrder,
  'bypass-queue',
  [[`    return enqueueConfigWrite(() => {`, `    return Promise.resolve().then(() => {`]],
);

section('F. 失败隔离：写抛时不 reject，队列仍可用（不变量 1 的兜底）');
await pair(
  'F 注入的原子写首次抛 ⇒ setUploadMeta 不 reject、未落盘，且队列在失败后仍可写',
  judgeFailureIsolation,
  'catch-rethrow',
  [[`      } catch { /* ignore */ }
    });`, `      } catch (err) { throw err; }
    });`]],
);

section('G. 常量与导出面（enumerateUploadsP 依赖候选顺序）');
await pair(
  'G PREVIEW_CANDIDATES 逐字逐序，导出面恰为 7 个名字',
  judgeConstants,
  'preview-order',
  [[`  const PREVIEW_CANDIDATES = ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp'];`,
    `  const PREVIEW_CANDIDATES = ['preview.png', 'preview.jpg', 'preview.gif', 'preview.webp'];`]],
);

// ───────────────────────── Ⅰ. `/upload-dir` 真路由（行为面） ─────────────────────────
const UPLOAD_DIR_SRC = join(ROOT, 'lib', 'upload-dir.js');

/**
 * Ⅰ① 判据本体（生产与两个负对照共用）：一次 `/upload-dir` 换目录的可观察结果 ⇒ 问题清单。
 * @param {{status: number, result: object|null, dirExists: boolean, expectedDir: string}} obs
 */
function uploadDirPostProblems(obs) {
  const bad = [];
  if (obs.status !== 200) bad.push('HTTP ' + obs.status + '（期望 200）');
  if (!obs.result || typeof obs.result !== 'object') bad.push('应答不是 JSON 对象：' + JSON.stringify(obs.result));
  else {
    if (obs.result.uploadDir !== obs.expectedDir) bad.push('应答 uploadDir=' + JSON.stringify(obs.result.uploadDir) + ' ≠ ' + obs.expectedDir);
    for (const k of ['migrated', 'skipped', 'same']) if (!(k in obs.result)) bad.push('应答缺字段 ' + k);
  }
  if (!obs.dirExists) bad.push('目标目录不存在（ensureDir 没真的建目录）');
  return bad;
}

/**
 * Ⅰ② 判据本体（生产与负对照共用）：落盘 + **重新加载** ⇒ 问题清单。
 * `reloadedSame` 必须是 `true`：新实例把"同一个目录"认成 same，只可能是它的**起始目录就是从
 * config 读到的那个新目录**（否则它从默认目录起步，`same` 会是 false，而 `uploadDir` 照样回目标值
 * —— 这一格正是"重启回落"的落点，不能只看 `reloadedDir`）。
 * @param {{cfgUploadDir: unknown, expectedDir: string, reloadedDir: unknown, reloadedSame: unknown}} obs
 */
function uploadDirPersistProblems(obs) {
  const bad = [];
  if (obs.cfgUploadDir !== obs.expectedDir) bad.push('config.json.uploadDir=' + JSON.stringify(obs.cfgUploadDir) + ' ≠ ' + obs.expectedDir);
  if (obs.reloadedDir !== obs.expectedDir) bad.push('重载后 uploadDir=' + JSON.stringify(obs.reloadedDir) + ' ≠ ' + obs.expectedDir);
  if (obs.reloadedSame !== true) bad.push('重载实例没把目标认成"当前目录"（same=' + JSON.stringify(obs.reloadedSame) + '）⇒ 它的起始目录不是 config 里的新目录（重启回落）');
  return bad;
}

/** 假 res：收 body / 状态码（`Writable` 形态与 `verify-cache-dir.mjs` 同款）。 */
function udRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) {
      state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb();
    },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}

/** 一次 POST `/upload-dir`（**真 handler**，体走真 `bodyReader` 路径）⇒ `{status, json, raw}`。 */
async function udPost(route, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.url = '/wallpaper-engine/upload-dir';
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  const res = udRes();
  const done = route.handler(req, res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 8000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  let json = null;
  try { json = JSON.parse(res.__state.body.toString('utf8')); } catch { /* 非 JSON 由判据报红 */ }
  return { status: res.__state.status, json, raw: res.__state.body.toString('utf8') };
}

/** 一套**新实例**：fresh import 门面（带查询串隔离模块实例）+ `apply()` 到自己的 mock。 */
async function udFreshInstance(tag) {
  const routes = [];
  const ctx = { webServer: { register(r) { routes.push(r); return () => {}; }, tapIndex() { return () => {}; } } };
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href + '?' + tag);
  const host = mod.default || mod;
  const dispose = (host.apply || host.apply)(ctx);
  return { route: routes.find((r) => r.path === '/wallpaper-engine/upload-dir'), dispose };
}

/**
 * 用真 / 变异 kit 跑一次 `setUploadDir`，返回与真路由**同形**的可观察量（供 Ⅰ① 与 Ⅰ② 的负对照）。
 * 注入面全是受控替身：`ensureDir` 默认做真 mkdir（丢参数即抛，与真 `ensureDirOnce` 同形）。
 */
async function udKitObservation(factory, { cfgFile, from, target, ensureDir }) {
  const readConfig = () => { try { return JSON.parse(readFileSync(cfgFile, 'utf8')); } catch { return {}; } };
  const writeConfig = (cfg) => { mkdirSync(dirname(cfgFile), { recursive: true }); writeFileSync(cfgFile, JSON.stringify(cfg)); };
  const kit = factory({
    defaultUploadDir: from,
    resolveUploadDir: () => readConfig().uploadDir || from,
    ensureDir: ensureDir || ((dir) => {
      if (typeof dir !== 'string' || !dir) throw new TypeError('The "path" argument must be of type string. Received ' + JSON.stringify(dir));
      mkdirSync(dir, { recursive: true });
    }),
    pathExistsP: async () => false,
    moveFileP: async () => true,
    enqueueConfigWrite: (fn) => fn(),
    readConfig,
    writeConfig,
    previewCandidates: [],
  });
  let status = 200;
  let result = null;
  try { result = await kit.setUploadDir(target, false); } catch { status = 500; }
  return { status, result };
}

section('Ⅰ. `/upload-dir` 真路由（行为面）：① 换目录不崩 ② 落盘 config + 重载生效');
{
  const { createUploadDirKit } = await import(pathToFileURL(UPLOAD_DIR_SRC).href);
  // 环境隔离必须在 fresh import 门面**之前**设；`configPath()` 是调用期读 env 的访问器。
  const DIR_ISO = join(ISO, 'upload-dir-behavior');
  rmSync(DIR_ISO, { recursive: true, force: true });
  const DATA = join(DIR_ISO, 'data');
  mkdirSync(DATA, { recursive: true });
  process.env.DSH_WE_DATA_DIR = DATA;
  process.env.DSH_WE_CACHE_DIR = join(DIR_ISO, 'cache');
  process.env.DSH_WE_STEAM_ROOT = join(DIR_ISO, 'steam-none');
  delete process.env.DSH_WE_UPLOAD_DIR;
  const { configPath } = await import(pathToFileURL(join(ROOT, 'lib', 'kernel', 'data-dir.js')).href);
  check('Ⅰ0 夹具隔离：`configPath()` 落在 `.test-cache` 下（不碰用户真实 config.json）',
    configPath().startsWith(DIR_ISO), configPath());

  const TARGET = join(DIR_ISO, 'target-one');
  const inst = await udFreshInstance('upload-dir-a');
  check('Ⅰ1 真路由在册：`POST /wallpaper-engine/upload-dir`（exact）', Boolean(inst.route),
    inst.route ? inst.route.kind + ' /wallpaper-engine/upload-dir' : '**没注册**');

  // ① 崩溃路径：修前形态（kit 按无参调 ensureDir）在真路由上实测 500 `ensureUploadDir is not a function`
  const r1 = await udPost(inst.route, { dir: TARGET, migrate: false });
  const obs1 = { status: r1.status, result: r1.json, dirExists: existsSync(TARGET), expectedDir: TARGET };
  check('Ⅰ2 ① POST 换目录：200 + {uploadDir,migrated,skipped,same} 且目标目录真的存在（修前形态：500 ensureUploadDir is not a function）',
    uploadDirPostProblems(obs1).length === 0,
    uploadDirPostProblems(obs1).join('；') || JSON.stringify(r1.json) + ' · dirExists=' + existsSync(TARGET));

  // ② 落盘 + 重载：新实例（新 apply/kernel）若真从 config 起步，把同一目录再 POST 会回 same:true
  const cfgAfter = JSON.parse(readFileSync(configPath(), 'utf8'));
  const inst2 = await udFreshInstance('upload-dir-b');
  const r2 = await udPost(inst2.route, { dir: TARGET, migrate: false });
  const obs2 = {
    cfgUploadDir: cfgAfter.uploadDir,
    expectedDir: TARGET,
    reloadedDir: r2.json && r2.json.uploadDir,
    reloadedSame: r2.json && r2.json.same,
  };
  check('Ⅰ3 ② POST 后 `config.json.uploadDir` == 新目录，且**重新加载**（新 apply/kernel 实例）后仍以它为当前目录（修前形态：config 里根本没有该键 ⇒ 重启回旧目录）',
    uploadDirPersistProblems(obs2).length === 0,
    uploadDirPersistProblems(obs2).join('；')
      || 'config.uploadDir=' + JSON.stringify(cfgAfter.uploadDir) + ' · 重载 same=' + JSON.stringify(obs2.reloadedSame));

  // 负对照 1（① 的变异体）：注入的 `ensureDir` 换成**恒真 no-op** ⇒ "建目录"这件事没发生
  const ncDirA = join(DIR_ISO, 'nc-noop-target');
  const ncA = await udKitObservation(createUploadDirKit, {
    cfgFile: join(DIR_ISO, 'nc-noop-config.json'), from: join(DIR_ISO, 'nc-noop-from'), target: ncDirA, ensureDir: () => {},
  });
  check('Ⅰ2-NC1 恒真 no-op 的 `ensureDir` ⇒ 目标目录不存在 ⇒ **同一条** `uploadDirPostProblems` 判红',
    uploadDirPostProblems({ status: ncA.status, result: ncA.result, dirExists: existsSync(ncDirA), expectedDir: ncDirA }).length > 0,
    uploadDirPostProblems({ status: ncA.status, result: ncA.result, dirExists: existsSync(ncDirA), expectedDir: ncDirA }).join('；'));

  // 负对照 2（① 的变异体）：源码变异回**修前形态**（调用丢参数）
  const mutNoArgs = await loadMutantOf(UPLOAD_DIR_SRC, 'ensure-call-no-args', [['ensureDir(UPLOAD_DIR);', 'ensureDir();']]);
  const ncDirB = join(DIR_ISO, 'nc-noargs-target');
  const ncB = await udKitObservation(mutNoArgs.createUploadDirKit, {
    cfgFile: join(DIR_ISO, 'nc-noargs-config.json'), from: join(DIR_ISO, 'nc-noargs-from'), target: ncDirB,
  });
  check('Ⅰ2-NC2 源码变异（`ensureDir(UPLOAD_DIR)` → `ensureDir()`，= 修前形态）⇒ setUploadDir 抛、目录没建 ⇒ 同一条判据判红',
    uploadDirPostProblems({ status: ncB.status, result: ncB.result, dirExists: existsSync(ncDirB), expectedDir: ncDirB }).length > 0,
    uploadDirPostProblems({ status: ncB.status, result: ncB.result, dirExists: existsSync(ncDirB), expectedDir: ncDirB }).join('；'));

  // 负对照 3（② 的变异体）：源码变异去掉 `writeConfig(cfg);`（= 修前形态）
  const mutNoPersist = await loadMutantOf(UPLOAD_DIR_SRC, 'no-persist', [['writeConfig(cfg);', '']]);
  const ncCfgFile = join(DIR_ISO, 'nc-nopersist-config.json');
  const ncFrom = join(DIR_ISO, 'nc-nopersist-from');
  const ncTarget = join(DIR_ISO, 'nc-nopersist-target');
  mkdirSync(ncFrom, { recursive: true });
  writeFileSync(ncCfgFile, JSON.stringify({ uploadDir: ncFrom }));
  // 第一遍：跑一次变异体的 setUploadDir（副作用 = 试图落盘）；可观察量从磁盘与**重载**实例取。
  await udKitObservation(mutNoPersist.createUploadDirKit, { cfgFile: ncCfgFile, from: ncFrom, target: ncTarget });
  const ncCfgAfter = JSON.parse(readFileSync(ncCfgFile, 'utf8'));
  const ncReload = await udKitObservation(mutNoPersist.createUploadDirKit, { cfgFile: ncCfgFile, from: ncFrom, target: ncTarget });
  const obsNC = {
    cfgUploadDir: ncCfgAfter.uploadDir,
    expectedDir: ncTarget,
    reloadedDir: ncReload.result && ncReload.result.uploadDir,
    reloadedSame: ncReload.result && ncReload.result.same,
  };
  check('Ⅰ3-NC 源码变异去掉 `writeConfig(cfg);`（= 修前形态）⇒ config 仍是旧目录、重载实例不认新目录 ⇒ 同一条判据判红',
    uploadDirPersistProblems(obsNC).length > 0,
    uploadDirPersistProblems(obsNC).join('；') || JSON.stringify(obsNC));

  if (typeof inst.dispose === 'function') { try { inst.dispose(); } catch { /* 收尾失败不影响判定 */ } }
  if (typeof inst2.dispose === 'function') { try { inst2.dispose(); } catch { /* 收尾失败不影响判定 */ } }
  delete process.env.DSH_WE_DATA_DIR;
  delete process.env.DSH_WE_CACHE_DIR;
  delete process.env.DSH_WE_STEAM_ROOT;
}

// ───────────────────────── H. 自检与地板 ─────────────────────────
section('H. 自检与覆盖面地板');
check('H1 本文件确实调用了被测模块（不是只 import）',
  stripComments(OWN).includes('createUploadStoreKit('),
  '剥注释后含 createUploadStoreKit(');
check('H2 注释里的调用不算调用（先剥注释再判）',
  !stripComments('// createUploadStoreKit(x)\n/* createUploadStoreKit(y) */').includes('createUploadStoreKit('),
  'stripComments 剥掉行注释与块注释');

const CHECK_FLOOR = 12;
const MUTANT_FLOOR = 6;
const totalChecks = stats.passed + stats.failed;
check(`H3 覆盖面地板：执行的判据 ≥ ${CHECK_FLOOR}`, totalChecks >= CHECK_FLOOR, `实测 ${totalChecks}`);
check(`H4 负对照地板：变异体 ≥ ${MUTANT_FLOOR}`, mutants >= MUTANT_FLOOR, `实测 ${mutants}`);

console.log('');
if (stats.failed > 0) {
  console.log(`UPLOAD-STORE CHECKS FAILED — ${stats.failed} failed, ${stats.passed} passed`);
  process.exit(1);
}
console.log(`ALL UPLOAD-STORE CHECKS PASSED (${stats.passed})`);
