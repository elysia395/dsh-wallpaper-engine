#!/usr/bin/env node
/**
 * verify-config-store.mjs —— `lib/kernel/config.js`（`createConfigKit`）的聚焦判据。
 *
 * 被测对象：`createConfigKit({ configPath })`（`lib/kernel/config.js`）—— `config.json` 的读、
 * 原子发布、以及 `settings` 段的读-改-写串行化。注入点 `configPath`（解析路径的函数）⇒
 * 所有判据都能落在 `.test-cache/` 里，不碰真机配置目录。
 *
 * ⚠️ 重指真源（task-10 D）：真源住 `lib/kernel/config.js` 的工厂返回值里；本守卫原先 import 上游
 * 同名副本 `lib/config-store.js`（task-10 D 重指后已随删除提交移除）。副本里带着「数组不算账本」的硬化
 * （`readConfig()` 的 `!Array.isArray(o)`，见 A1/A3/A4），而真源当时只判 `typeof 'object'`
 * ⇒ 盘上是数组时设置写静默丢失。硬化已搬进真源（并补了 `configPath` 注入缝），判据随之重指 ——
 * 判据与期望值除**两处形状**（导出面清单、E1 里那条冗余的常量名断言）外一字未改。
 *
 * 为什么值得独立守卫：这是宿主**唯一**的持久状态面，失效形态全是静默的 ——
 *   · 原子发布退化成直写 ⇒ 断电/HMR 中断留下截断的半份 JSON（读侧回 `{}` ⇒ 设置全丢，无报错）；
 *   · 临时名重复 ⇒ 同一目标文件的两路并发写互相 rename 对方的半截内容；
 *   · 临时名后缀不再是纯数字 ⇒ `cache-prune` 的 `.tmp\d*$` 孤儿清扫认不出它（跨模块契约，E 段）；
 *   · 读-改-写不排队 ⇒ 并发的 settings/uploadDir 写后写者基于旧快照，吞掉先写者的改动。
 *
 * 判据设计（DEV-GUIDE §4.7）：每条正向判据都配一条**同一段判据代码**跑出来的变异体负对照
 * （源码现场改写，落在 `.test-cache/` 下，不动 `lib/`）；覆盖面地板在 G 段，写在 `if` 之外。
 * 临时名的跨模块契约（`atomicTmpPath` ↔ `cache-prune` 的孤儿清扫口径）在 C 段用真套件对钉。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConfigKit } from '../lib/kernel/config.js';
import { createTranscodeKit } from '../lib/media/transcode.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'config-store-guard');
const SRC = join(ROOT, 'lib', 'kernel', 'config.js');
const PID = process.pid;

let passed = 0; let failed = 0;
function check (name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section (t) { console.log('\n' + t); }

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

let dirSeq = 0;
function dir (label) {
  const p = join(ISO, (dirSeq++) + '-' + label);
  mkdirSync(p, { recursive: true });
  return p;
}
/** 真套件；`configPath` 是判据侧的注入点（真源缺省 = `./data-dir.js` 现算）。 */
const realKit = (configPath) => createConfigKit({ configPath: () => configPath });

// ── 变异体加载器（本模块只 import node: 内建 ⇒ 变异体可直接落在 tmp 里跑）────────
// ⚠️ 替换串一律用**函数**：字符串形态的 `$'` / `$&` 会被 String.replace 当成引用模式，
// 生成出语法坏掉的"变异体"（判据会失真成解析错误）。
// ⚠️ 源码文本先归一成 LF 再做字面替换：锚点写的是 `\n`，CRLF 检出下会全不命中
// （与 `test/verify-transcode-state.mjs` 的 `\r?\n` 处理同一个理由）。
let mutantSeq = 0;
/**
 * 变异体落在 `.test-cache/` 跑 ⇒ 源码里的**相对说明符**必须改写成绝对 `file:` URL：
 * 真源 import `'../settings-schema.js'` / `'./data-dir.js'`，相对变异体目录解析会
 * ERR_MODULE_NOT_FOUND。改写只改"从哪解析"，被 import 的仍是**真源**模块（不是副本）。
 */
const absolutizeSpecifiers = (text) => text.replace(
  /(from\s*|import\s*\(\s*|require\s*\(\s*)(['"])(\.[^'"]+)\2/g,
  (m, head, q, spec) => head + q + pathToFileURL(join(dirname(SRC), spec)).href + q);

async function loadMutant (label, transform) {
  const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  const out = transform(src);
  if (out === src) throw new Error('变异体没改到源码（判据会失真）: ' + label);
  const d = join(ISO, 'mutants');
  mkdirSync(d, { recursive: true });
  const f = join(d, (mutantSeq++) + '-' + label + '.mjs');
  writeFileSync(f, absolutizeSpecifiers(out));
  const mod = await import(pathToFileURL(f).href);
  return (configPath) => mod.createConfigKit({ configPath: () => configPath });
}

// ── 判据本体（正向与负对照共用同一段代码；`make` = (configPath) => kit）──────────
const emptyObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === 0;
const attempt = (fn) => { try { return fn(); } catch { return 'THREW'; } };
/** 目标文件旁是否还留着 `<base>.tmp…` 残骸（原子发布的"绝不留下临时件"口径）。 */
const tmpLeftovers = (d, base) => readdirSync(d).filter((n) => n.startsWith(base + '.tmp'));

/** ① 读永不抛：缺失 / 坏 JSON / 非对象 JSON ⇒ `{}`；正常对象原样。 */
function readNeverThrows (make, d) {
  const p = join(d, 'config.json');
  const k = make(p);
  const results = [];
  results.push(emptyObject(attempt(() => k.readConfig())));                 // 文件缺失
  writeFileSync(p, '{ oops');
  results.push(emptyObject(attempt(() => k.readConfig())));                 // 坏 JSON
  writeFileSync(p, '5');
  results.push(emptyObject(attempt(() => k.readConfig())));                 // 非对象：数字
  writeFileSync(p, '"str"');
  results.push(emptyObject(attempt(() => k.readConfig())));                 // 非对象：字符串
  writeFileSync(p, 'null');
  results.push(emptyObject(attempt(() => k.readConfig())));                 // 非对象：null
  // JSON 数组的 `typeof` 也是 'object'：放它进来，后续 `cfg[SETTINGS_FIELD] = …` 挂的是
  // 非索引属性、`JSON.stringify([])` 仍是 "[]" ⇒ 设置写静默丢失（`lib/kernel/config.js` 已修）。
  writeFileSync(p, '[]');
  results.push(emptyObject(attempt(() => k.readConfig())));                 // 非账本：空数组
  writeFileSync(p, '[1,2]');
  results.push(emptyObject(attempt(() => k.readConfig())));                 // 非账本：非空数组
  writeFileSync(p, '{"a":1}');
  results.push(JSON.stringify(attempt(() => k.readConfig())) === '{"a":1}'); // 正常原样
  return results.every(Boolean);
}

/** ①b 数组账本：读回 `{}`，且在其上的设置写必须真落盘（"写进 `[]` 壳"是静默丢数据）。 */
async function arrayLedgerWriteLands (make, d) {
  const p = join(d, 'config.json');
  const k = make(p);
  writeFileSync(p, '[]');
  if (!emptyObject(attempt(() => k.readConfig()))) return false;
  await k.writeSettings({ a: 1 });
  try { return JSON.stringify(JSON.parse(readFileSync(p, 'utf8')).settings) === '{"a":1}'; } catch { return false; }
}

/** ② 原子发布（同步）：内容逐字节落盘、覆盖生效、不留临时件。 */
function syncPublishesAtomically (make, d) {
  const p = join(d, 'config.json');
  const k = make(p);
  k.atomicWriteFileSync(p, 'HELLO');
  if (readFileSync(p, 'utf8') !== 'HELLO' || tmpLeftovers(d, 'config.json').length) return false;
  k.atomicWriteFileSync(p, Buffer.from('WORLD'));
  return readFileSync(p, 'utf8') === 'WORLD' && tmpLeftovers(d, 'config.json').length === 0;
}

/** ②b 原子发布（异步）：同上。 */
async function asyncPublishesAtomically (make, d) {
  const p = join(d, 'config.json');
  const k = make(p);
  await k.atomicWriteFileP(p, 'ALPHA');
  if (readFileSync(p, 'utf8') !== 'ALPHA' || tmpLeftovers(d, 'config.json').length) return false;
  await k.atomicWriteFileP(p, 'BETA');
  return readFileSync(p, 'utf8') === 'BETA' && tmpLeftovers(d, 'config.json').length === 0;
}

/** ②c rename 失败时的兜底分支：目标最终仍有完整内容（同步版只保证"内容"，临时件的处置见详情）。 */
function syncFallbackKeepsContent (make, d) {
  const p = join(d, 'config.json');
  make(p).atomicWriteFileSync(p, 'HELLO');
  return readFileSync(p, 'utf8') === 'HELLO';
}
/** ②d 异步兜底分支：内容保住**且**临时件被清掉（异步版 catch 里显式 unlink）。 */
async function asyncFallbackKeepsContentAndCleans (make, d) {
  const p = join(d, 'config.json');
  await make(p).atomicWriteFileP(p, 'HELLO');
  return readFileSync(p, 'utf8') === 'HELLO' && tmpLeftovers(d, 'config.json').length === 0;
}

/** ③ 临时名：每次调用唯一、以 `<file>.tmp` 开头、带本进程 pid、后缀纯数字。 */
function tmpNameUnique (make, d) {
  const p = join(d, 'config.json');
  const k = make(p);
  const a = k.atomicTmpPath(p);
  const b = k.atomicTmpPath(p);
  return a !== b
    && a.startsWith(p + '.tmp') && b.startsWith(p + '.tmp')
    && a.includes(String(PID))
    && /^.*\.tmp\d*$/.test(a) && /^.*\.tmp\d*$/.test(b)
    && new RegExp('\\.tmp' + PID + '\\d*$').test(a);
}

/**
 * ③b 跨模块契约（`lib/kernel/config.js` ↔ 转码套件的孤儿清扫 `lib/media/transcode.js`）：
 * `atomicTmpPath` 的产物必须同时满足两条 —— 别的 pid 的同类产物会被孤儿清扫清掉（说明清扫口径
 * 认这个形状），本进程的产物必须被留住（说明"在途写"保护认得它）。任一侧改形状都会让这条判红。
 *
 * ⚠️ 读点更正：清扫侧原先取自上游同名副本 `lib/cache-prune.js`（已删）；真源是
 * `createTranscodeKit().sweepTranscodeArtifacts()`，它扫的三个目录由注入的访问器派生
 * （`join(cacheBaseDir(),'transcodes')` / `join(dirname(configPath()),'ffmpeg')` / `videoPreviewCacheDir()`）
 * ⇒ 夹具把三个探针文件放进**派生后的**目录；断言形状与期望值一字未改。
 */
function crossModuleTmpShape (make, d) {
  const p = join(d, 'config.json');
  const name = make(p).atomicTmpPath(p);
  const own = basename(name);
  const foreign = own.replace('.tmp' + PID, '.tmp' + (PID + 1));
  const foreign2 = own.replace('.tmp' + PID, '.tmp' + (PID + 2));
  if (foreign === own) return false;
  const sub = ['t', 'f', 'p'].map((tag) => { const x = join(d, tag); mkdirSync(x, { recursive: true }); return x; });
  const transcodeDir = join(sub[0], 'transcodes');
  const ffmpegDir = join(sub[1], 'ffmpeg');
  mkdirSync(transcodeDir, { recursive: true });
  mkdirSync(ffmpegDir, { recursive: true });
  writeFileSync(join(transcodeDir, own), 'x');
  writeFileSync(join(ffmpegDir, foreign), 'x');
  writeFileSync(join(sub[2], foreign2), 'x');
  createTranscodeKit({
    cacheBaseDir: () => sub[0],
    configPath: () => join(sub[1], 'config.json'),
    videoPreviewCacheDir: () => sub[2],
    getMediaInfo: () => null,
    atomicTmpPath: (f) => f,
    pluginRoot: ROOT,
  }).sweepTranscodeArtifacts();
  return existsSync(join(transcodeDir, own)) && !existsSync(join(ffmpegDir, foreign)) && !existsSync(join(sub[2], foreign2));
}

/** ④ 读-改-写串行化：fn 体全同步时不得丢改动。 */
async function concurrentSyncBodiesKeepAll (make, d, rounds) {
  const p = join(d, 'config.json');
  const k = make(p);
  k.writeConfig({ n: 0 });
  await Promise.all(Array.from({ length: rounds }, () => k.enqueueConfigWrite(() => {
    const cfg = k.readConfig(); cfg.n = (cfg.n || 0) + 1; k.writeConfig(cfg);
  })));
  return k.readConfig().n === rounds;
}

/** ④b fn 体里有 await（真实调用点 `setUploadDir` / `setCacheDir` 的形态）⇒ 不排队必然丢改动。 */
async function concurrentAwaitingBodiesKeepAll (make, d, rounds) {
  const p = join(d, 'config.json');
  const k = make(p);
  k.writeConfig({ n: 0 });
  const yieldNow = () => new Promise((r) => { setImmediate(r); });
  await Promise.all(Array.from({ length: rounds }, () => k.enqueueConfigWrite(async () => {
    const cfg = k.readConfig(); cfg.n = (cfg.n || 0) + 1;
    await yieldNow();
    k.writeConfig(cfg);
  })));
  return k.readConfig().n === rounds;
}

/** ⑤ 队列永不 reject：一次失败只 reject 它自己的调用方，后续写入照常执行。 */
async function queueNeverSticks (make, d) {
  const p = join(d, 'config.json');
  const k = make(p);
  k.writeConfig({ n: 0 });
  const order = [];
  const bad = k.enqueueConfigWrite(() => { order.push('bad'); throw new Error('boom'); });
  let badRejected = false;
  await bad.then(() => { badRejected = false; }, () => { badRejected = true; });
  const good = await k.enqueueConfigWrite(() => { order.push('ok'); return 'DONE'; });
  await Promise.all([
    k.enqueueConfigWrite(() => { order.push('3'); }),
    k.enqueueConfigWrite(() => { order.push('4'); }),
  ]);
  return badRejected && good === 'DONE' && order.join(',') === 'bad,ok,3,4';
}

/** ⑥ settings 段：`SETTINGS_FIELD`、缺失/非对象 ⇒ null、round-trip、**覆盖不是合并**、不动其它键。 */
async function settingsSectionSemantics (make, d) {
  const p = join(d, 'config.json');
  const k = make(p);
  const noSection = k.readSettings() === null;
  k.writeConfig({ uploadDir: '/u', settings: 5 });
  const nonObject = k.readSettings() === null;
  await k.writeSettings({ a: 1, b: 2 });
  const roundTrip = JSON.stringify(k.readSettings()) === '{"a":1,"b":2}';
  await k.writeSettings({ a: 9 });
  const overwrite = JSON.stringify(k.readSettings()) === '{"a":9}';
  const finalCfg = k.readConfig();
  const keys = Object.keys(finalCfg).sort().join(',');
  // ⚠️ 字段名「settings」由 `keys === 'settings,uploadDir'` **行为**钉住（把字段改名会让键集变），
  // 所以这条不再依赖「真源导出 `SETTINGS_FIELD` 常量」——真源只交出被内核消费的那些名字。
  return noSection && nonObject && roundTrip && overwrite
    && finalCfg.uploadDir === '/u' && keys === 'settings,uploadDir';
}

/** ⑦ `writeConfig` 自动建父目录 + 写盘失败不抛。 */
function writeCreatesParents (make, d) {
  const nested = join(d, 'a', 'b', 'config.json');
  const k = make(nested);
  k.writeConfig({ a: 1 });
  const created = existsSync(nested) && JSON.parse(readFileSync(nested, 'utf8')).a === 1;
  const blockedParent = join(d, 'blocked');
  writeFileSync(blockedParent, 'x');                       // 父级被文件占位 ⇒ mkdir 必失败
  let threw = false;
  try { make(join(blockedParent, 'config.json')).writeConfig({ b: 2 }); } catch { threw = true; }
  return created && !threw;
}

// ═══ A. 读语义 ══════════════════════════════════════════════════════════════
section('A. 读永不抛：缺失 / 坏 JSON / 非对象（含 JSON 数组）⇒ {}');
check('A1 readConfig 对缺失/坏 JSON/数字/字符串/null/数组 一律回 {}，正常对象原样', readNeverThrows(realKit, dir('a1')));

// 变异锚点只钉 `const o = JSON.parse(…)` 这一行 —— 谓词行会随真修改形（upload-store 那次教训）。
const noValidation = await loadMutant('read-no-validation', (s) => s.replace(
  'const o = JSON.parse(readFileSync(configPath(), \'utf8\'));',
  'return JSON.parse(readFileSync(configPath(), \'utf8\'));'));
check('A2 负对照：变异体把解析结果原样返回 ⇒ 非对象 JSON 直通 ⇒ A1 判据判红',
  readNeverThrows(noValidation, dir('a2')) === false);

check('A3 数组账本上 `writeSettings` 必须真落盘（数组不是账本 ⇒ 读回 `{}` 后正常写）',
  await arrayLedgerWriteLands(realKit, dir('a3')));

const arrayNotRejected = await loadMutant('array-not-rejected', (s) => s.replace(
  'const o = JSON.parse(readFileSync(configPath(), \'utf8\'));',
  'const o = JSON.parse(readFileSync(configPath(), \'utf8\'));\n      if (Array.isArray(o)) return o;'));
check('A4 负对照：变异体删掉"数组不算账本"的裁决（数组直通）⇒ A1 与 A3 都判红',
  readNeverThrows(arrayNotRejected, dir('a4')) === false
  && await arrayLedgerWriteLands(arrayNotRejected, dir('a4b')) === false);

// ═══ B. 原子发布 ════════════════════════════════════════════════════════════
section('B. 原子发布：内容落盘 + 覆盖 + 不留临时件（含 rename 失败的兜底分支）');
check('B1 atomicWriteFileSync 内容逐字节落盘、可覆盖、不留 `<file>.tmp…` 残骸', syncPublishesAtomically(realKit, dir('b1')));
check('B2 atomicWriteFileP 同上（含 Buffer 之外的字符串路径）', await asyncPublishesAtomically(realKit, dir('b2')));

const syncRenameFails = await loadMutant('rename-sync-throws', (s) => s.replace(
  'renameSync(tmp, filePath);', 'throw new Error(\'mutant: rename 失败\');'));
const b3 = dir('b3');
const b3ok = syncFallbackKeepsContent(syncRenameFails, b3);
check('B3 兜底分支可达：强制 renameSync 失败 ⇒ 目标仍有完整内容（catch 里退化成直写）', b3ok,
  '兜底后同目录残骸 = ' + JSON.stringify(tmpLeftovers(b3, 'config.json')));

const asyncRenameFails = await loadMutant('rename-async-throws', (s) => s.replace(
  'await renameP(tmp, filePath);', 'throw new Error(\'mutant: rename 失败\');'));
check('B4 异步兜底分支：强制 renameP 失败 ⇒ 目标有内容**且**临时件被清掉',
  await asyncFallbackKeepsContentAndCleans(asyncRenameFails, dir('b4')));

// ═══ C. 临时名 ══════════════════════════════════════════════════════════════
section('C. 临时名：唯一 + 后缀纯数字（与 cache-prune 的孤儿清扫口径对钉）');
check('C1 atomicTmpPath 连续两次唯一、前缀 `<file>.tmp`、含本进程 pid、后缀纯数字', tmpNameUnique(realKit, dir('c1')));
check('C2 跨模块契约：本进程 pid 的产物被 cache-prune 留住，别的 pid 的同类产物被清掉', crossModuleTmpShape(realKit, dir('c2')));

const fixedSeq = await loadMutant('tmp-seq-fixed', (s) => s.replace(
  'atomicTmpSeq = (atomicTmpSeq + 1) % 1000000;', 'atomicTmpSeq = 1;'));
check('C3 负对照：变异体把序号固定 ⇒ 两次调用同名 ⇒ C1 判据判红',
  tmpNameUnique(fixedSeq, dir('c3')) === false);

// ═══ D. 读-改-写串行化 ══════════════════════════════════════════════════════
section('D. 读-改-写串行化：并发不丢改动，且队列本身永不 reject');
const ROUNDS = 25;
check(`D1 ${ROUNDS} 路并发（fn 体全同步）⇒ 终值 == 次数`, await concurrentSyncBodiesKeepAll(realKit, dir('d1'), ROUNDS));
check(`D2 ${ROUNDS} 路并发（fn 体内有 await，同真实调用点）⇒ 终值 == 次数`,
  await concurrentAwaitingBodiesKeepAll(realKit, dir('d2'), ROUNDS));
check('D3 队列永不 reject：一次抛错只 reject 它自己的调用方，后续写入照常执行且保序',
  await queueNeverSticks(realKit, dir('d3')));

const noQueue = await loadMutant('no-queue', (s) => s.replace(
  'const p = configWriteQueue.then(fn, fn);', 'const p = Promise.resolve().then(fn, fn);'));
const d4 = dir('d4');
const noQueueOk = await (async () => { try { return await concurrentAwaitingBodiesKeepAll(noQueue, d4, ROUNDS); } catch { return 'THREW'; } })();
check('D4 负对照：变异体不入队（各自独立 promise）⇒ 并发改动互相覆盖 ⇒ D2 判据判红', noQueueOk !== true,
  '终值 = ' + JSON.stringify(attempt(() => realKit(join(d4, 'config.json')).readConfig().n)));

const naiveQueue = await loadMutant('naive-queue', (s) => s
  .replace('const p = configWriteQueue.then(fn, fn);', 'const p = configWriteQueue.then(fn);')
  .replace('configWriteQueue = p.then(() => {}, () => {});', 'configWriteQueue = p;'));
const d5 = dir('d5');
const naiveOk = await (async () => { try { return await queueNeverSticks(naiveQueue, d5); } catch { return 'THREW'; } })();
check('D5 负对照：朴素队列（不吞拒绝）⇒ 一次失败后后续写入全被拒 ⇒ D3 判据判红', naiveOk !== true);

// ═══ E. settings 段与导出面 ═════════════════════════════════════════════════
section('E. settings 段：缺失/非对象 ⇒ null、round-trip、覆盖不是合并、不动其它键');
check('E1 writeSettings 读改写：round-trip / 二次写覆盖（不合并）/ uploadDir 等其它键保持 / 键集只多一个 settings',
  await settingsSectionSemantics(realKit, dir('e1')));

const mergeSettings = await loadMutant('settings-merge', (s) => s.replace(
  'cfg[SETTINGS_FIELD] = settings;', 'Object.assign(cfg[SETTINGS_FIELD] ||= {}, settings);'));
check('E2 负对照：变异体把"覆盖"兑成"合并" ⇒ E1 判据判红',
  (await settingsSectionSemantics(mergeSettings, dir('e2'))) === false);

const kitNames = Object.keys(realKit(join(ISO, 'surface', 'config.json'))).sort();
// 真源的导出面 = **内核实际解构的那些**（`lib/kernel/host-kernel.js:169-175` 逐字解构这 15 个），
// 内部状态（`atomicTmpSeq` / `configWriteQueue` / `SETTINGS_FIELD` 常量）一律不外泄 ——
// 断言仍是"键集逐字相等"，外泄一个名字或多一个名字都判红。
check('E3 导出面恰好 = 内核消费面（15 个名字；队列/序号/字段名常量等内部状态不外泄）',
  kitNames.join(',') === 'atomicTmpPath,atomicWriteFileP,atomicWriteFileSync,commitFontSetMigration,'
    + 'enqueueConfigWrite,fontSetsDir,glassPresetsDir,mergeSettings,readConfig,readFontSetId,readSettings,'
    + 'setFontSetId,withLegacyFontValues,writeConfig,writeSettings',
  kitNames.join(','));

// ═══ F. 写盘与降级 ══════════════════════════════════════════════════════════
section('F. writeConfig：自动建父目录，写盘失败不抛');
check('F1 深层父目录自动创建并落 JSON；父级被文件占位时静默失败不抛', writeCreatesParents(realKit, dir('f1')));

const noMkdir = await loadMutant('write-no-mkdir', (s) => s.replace(
  '      mkdirSync(dirname(configPath()), { recursive: true });\n', ''));
check('F2 负对照：变异体删掉建父目录 ⇒ 目录缺失时内容没落盘 ⇒ F1 判据判红',
  writeCreatesParents(noMkdir, dir('f2')) === false);

// ═══ G. 覆盖面地板（写在 if 之外）════════════════════════════════════════════
section('G. 覆盖面地板（防"判据在空域上恒真"）');
check('G1 正向判据数 ≥ 12', passed >= 12, 'passed=' + passed);
check('G2 变异体负对照数 ≥ 7', mutantSeq >= 7, 'mutants=' + mutantSeq);
check('G3 本文件直读被测模块（guard-map 的覆盖认定靠这个路径字面量）',
  readFileSync(SRC, 'utf8').includes('export function createConfigKit')
  && typeof createConfigKit === 'function');

console.log('');
if (failed) {
  console.log(`CONFIG-STORE CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL CONFIG-STORE CHECKS PASSED (${passed})`);
