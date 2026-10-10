#!/usr/bin/env node
/**
 * regen-golden.mjs —— 核对 / 重录 `test/fixtures/settings-sanitize-golden.json`（漂移棘轮）。
 *
 * 不变量：夹具的期望值**只在"这次漂移是有意的"被明说之后**才允许改 —— `--write` 必须带 `--intend`。
 * 为什么必须有人工意图：夹具是**漂移棘轮**，期望值录自录制当时的实现输出 ⇒ 它只证明
 * "没有无理由地变化"，**不证明取值正确**。自动重录会把缺陷输出一起录成"期望"（本仓实测过：
 * 三张布尔表的 `{}` 曾被抄成期望，整套 sanitize 判据全绿而功能是死的）。
 *
 * 两侧的地位**不一样**，读输出时别把它们当同一件事：
 *   · host    —— `test/verify-client.mjs` ③ 逐用例比对**值** ⇒ 它的漂移会让 `npm run verify` 红。
 *   · client  —— **没有任何判据比对它的值**（③ 只比 host；④ 只用用例的 `input`；
 *                `test/verify-glass-surfaces.mjs` ⑥ 只用它的**键集**做逐用例自洽）。
 *                它的值属历史快照，漂移只作提示、**不计入退出码**。
 *
 * 用法：
 *   node test/tools/regen-golden.mjs                       # 只报告，不写
 *   node test/tools/regen-golden.mjs --write --intend host:layerScale --intend client:*
 *                                                          # 按现算值写入**声明的**键
 * `--intend` 形态：`<host|client>:<键>[,<键>…]` 或 `<host|client>:*`（可重复）。
 * 写入前先算一遍：**除声明键外任何漂移 ⇒ 拒绝写入**（exit 1），所以"顺手重录"录不进事故。
 * 脚本**不改** `note`：那段是人写的不变量声明，不由脚本生成（也绝不再往里追加日期流水）。
 *
 * 退出码：0 = 无漂移（或写入成功且除声明外零漂移）/ 1 = host 侧漂移、或拒绝写入 / 2 = 用法错误。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// test/tools/ 比仓库根深两层
const ROOT = resolve(HERE, '..', '..');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'settings-sanitize-golden.json');

const SIDES = ['host', 'client'];
const ALL = '*';
/** host 侧把"整侧为 null"记成哨兵字符串（夹具既有约定），client 侧原样。 */
const enc = (side, v) => (v === null && side === 'host' ? '__null__' : v);
const dec = (v) => (v === '__null__' ? null : v);
/** 与 `test/verify-client.mjs` 同一口径：只对**顶层对象**的键排序，其余原样。 */
const canon = (o) => JSON.stringify(o && typeof o === 'object' && !Array.isArray(o)
  ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])) : o);
const isPlainObj = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o);

function usage(msg) {
  console.error('用法错误：' + msg);
  console.error('用法：node test/tools/regen-golden.mjs [--write --intend <host|client>:<键>[,<键>…]]');
  process.exit(2);
}

// ── 参数 ────────────────────────────────────────────────────────────────────────
let write = false;
const intends = { host: new Set(), client: new Set() };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--write') { write = true; continue; }
  if (argv[i] === '--intend') {
    const spec = argv[++i];
    const m = spec && spec.match(/^(host|client):(.*)$/);
    if (!m) usage('`--intend` 的形态是 <host|client>:<键>[,<键>…] 或 <host|client>:*（收到 ' + spec + '）');
    for (const k of m[2].split(',').map((s) => s.trim()).filter(Boolean)) intends[m[1]].add(k);
    continue;
  }
  usage('未知参数：' + argv[i]);
}
if (write && SIDES.every((s) => intends[s].size === 0)) {
  usage('`--write` 必须带 `--intend`：没有声明的意图就不许改期望值（夹具是棘轮，不是复读机）');
}

const { sanitizeFromSchema } = await import(pathToFileURL(join(ROOT, 'lib', 'settings-schema.js')).href);
const fx = JSON.parse(readFileSync(FIXTURE, 'utf8').replace(/^\uFEFF/, ''));
const cases = Array.isArray(fx.cases) ? fx.cases : [];
if (cases.length === 0) {
  console.error('夹具里没有 cases —— 判据无从谈起');
  process.exit(1);
}

// ── 漂移（与 verify-client ③ 同口径：逐用例、逐键，值用同一个 canon）──────────────
/** @returns {Map<string, Set<string>>} 键 → 受影响用例名（`(顶层)` = 整个期望值不是对象且不等） */
function driftOf(side) {
  const byKey = new Map();
  const bump = (k, name) => { if (!byKey.has(k)) byKey.set(k, new Set()); byKey.get(k).add(name); };
  for (const c of cases) {
    const want = dec(c[side]);
    const now = sanitizeFromSchema(c.input, side);
    if (canon(now) === canon(want)) continue;
    if (!isPlainObj(want) || !isPlainObj(now)) { bump('(顶层)', c.name); continue; }
    for (const k of new Set([...Object.keys(want), ...Object.keys(now)])) {
      if (canon(want[k]) !== canon(now[k])) bump(k, c.name);
    }
  }
  return byKey;
}

const declared = (side, key) => intends[side].has(ALL) || intends[side].has(key);
const drift = Object.fromEntries(SIDES.map((s) => [s, driftOf(s)]));

// ── 只报告 ─────────────────────────────────────────────────────────────────────
console.log('夹具 ' + FIXTURE);
console.log('用例 ' + cases.length + ' 个 · generatedFrom ' + JSON.stringify(fx.generatedFrom || null));
for (const side of SIDES) {
  const d = drift[side];
  const note = side === 'host'
    ? '（verify-client ③ 逐用例比对值 ⇒ 漂移会让 `npm run verify` 红）'
    : '（无判据比对值；只有 verify-glass-surfaces ⑥ 用它的键集 ⇒ 漂移仅提示、不计入退出码）';
  if (d.size === 0) { console.log(side + ' ' + note + '：无漂移'); continue; }
  console.log(side + ' ' + note + '：' + d.size + ' 个键漂移');
  for (const [k, names] of [...d].sort()) {
    console.log('   ' + k.padEnd(34) + names.size + ' 个用例' +
      (names.size <= 3 ? '（' + [...names].join(', ') + '）' : ''));
  }
}

// ── 写入（先校验，再落盘）───────────────────────────────────────────────────────
if (!write) {
  const hostDrift = drift.host.size;
  console.log(hostDrift
    ? '⇒ 被棘轮住的 host 侧有漂移：判断这次漂移是否有意；有意则 `--write --intend host:<键>` 重录。'
    : '⇒ 被棘轮住的 host 侧零漂移（client 侧的提示见上，它没有值判据）。');
  process.exit(hostDrift ? 1 : 0);
}

const undeclared = [];
for (const side of SIDES) {
  for (const k of drift[side].keys()) if (!declared(side, k)) undeclared.push(side + '.' + k);
}
if (undeclared.length) {
  console.error('拒绝写入：存在未声明的漂移 ⇒ ' + undeclared.join(', '));
  console.error('（那说明本次改动影响到了别的键；确认它确实是有意的，再把它加进 --intend）');
  process.exit(1);
}
if (SIDES.every((s) => drift[s].size === 0)) {
  console.log('没有任何漂移 ⇒ 无需要写入。');
  process.exit(0);
}

const byName = new Map(cases.map((c) => [c.name, c]));
for (const side of SIDES) {
  for (const [key, names] of drift[side]) {
    for (const name of names) {
      const c = byName.get(name);
      if (!c) usage('漂移记录里的用例在夹具里找不到：' + name);
      const now = sanitizeFromSchema(c.input, side);
      if (key === '(顶层)') { c[side] = enc(side, now); continue; }
      if (!isPlainObj(c[side])) c[side] = {};
      if (isPlainObj(now) && Object.prototype.hasOwnProperty.call(now, key)) c[side][key] = now[key];
      else delete c[side][key];
    }
  }
}

// 复算：落盘前必须"除声明外零漂移"（写坏了就根本不写）
const after = Object.fromEntries(SIDES.map((s) => [s, driftOf(s)]));
const leftover = SIDES.flatMap((s) => [...after[s].keys()].map((k) => s + '.' + k));
if (leftover.length) {
  console.error('拒绝写入：写入后仍有漂移 ⇒ ' + leftover.join(', ') + '（夹具未改动）');
  process.exit(1);
}
const declaredKeys = SIDES.flatMap((s) => [...drift[s].keys()].map((k) => s + '.' + k));
writeFileSync(FIXTURE, JSON.stringify(fx, null, 2) + '\n', 'utf8');
console.log('已写入 ' + FIXTURE);
console.log('本次重录的键（' + declaredKeys.length + ' 个）：' + declaredKeys.join(', '));
console.log('⚠️ 提交信息里必须写明这次漂移的意图（工具只保证"除声明外零漂移"，不保证取值正确）。');
