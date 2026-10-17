#!/usr/bin/env node
// 聚焦守卫：`lib/diag-trace.js`（宿主侧诊断落盘 sink）。
//
// ⚠️ 重指真源（task-10 E）：被测实现住 `lib/diag-trace.js` 的工厂返回值里；本守卫原先 import
// 上游同名副本 `lib/host-diag.js`（task-10 末次提交已随本批删除）。副本里带着轮转的**竞态保护**
// （`existsSync` + 内层 `try/catch`，见 MUTANT_SPECS 的 `race-unguarded`），而真源当时是裸
// `renameSync` —— 文件被外部清理/被并行实例抢先轮转后，每次 append 都在 rename 处抛、被外层
// catch 吞 ⇒ 本进程诊断通道静默死亡。修法已搬进真源，判据随之重指（判据与期望值一字未改）。
//
// 为什么值得一条守卫：这条通道是**常开**的（请求记录 + 心跳），它有两个模块级状态
// （轮转水位 `diagBytes`、去重表 `reqLogSeen`）。两者退化时的症状都不在功能面上：
//   · 轮转坏掉 ⇒ 磁盘悄悄长到几十 MB（实测一段会话 69.8 MB）；
//   · 去重表无界 ⇒ 堆单向增长（实测 20 万个 `/live-frame/<随机>` 把 heapUsed 32.2 → 72.4 MB）。
// 功能测试永远抓不到这两类，所以判据直接打在"占用有上界 + 当次不丢"上。
//
// 纪律：判据先剥注释（`test/tools/js-text.mjs`）；每条正向判据都配一个变异体喂进
// **同一个判据函数**（DEV-GUIDE §4.5 约定 ⑤）；变异体锚点漂了就抛错，绝不静默跳过。
// `MAX_BYTES` / `SEEN_MAX` 是**故意复写**的：模块把上限改成别的值时，本文件必须红，
// 逼人来核对"新上限下的轮转/淘汰行为"（DEV-GUIDE §4.7 约定 ⑨）。
import {
  mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync,
  existsSync, readdirSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDiagTraceKit } from '../lib/diag-trace.js';
import { stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SRC = join(ROOT, 'lib', 'diag-trace.js');
const ISO = join(ROOT, '.test-cache', 'host-diag-guard');
const MAX_BYTES = 8 * 1024 * 1024;   // = lib/diag-trace.js 的 DIAG_MAX_BYTES
const SEEN_MAX = 2000;               // = lib/diag-trace.js 的 REQ_LOG_SEEN_MAX

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section(title) { console.log('\n' + title); }

// ---------------------------------------------------------------- 夹具与工具
function scratch(label) {
  const d = join(ISO, label);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}
const diagDir = (d) => join(d, 'diag');
const diagFile = (d) => join(diagDir(d), 'http.jsonl');
const cfgIn = (d) => () => join(d, 'config.json');
const readLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((s) => s.length > 0) : []);
const diagEntries = (d) => (existsSync(diagDir(d))
  ? readdirSync(diagDir(d)).filter((n) => n.startsWith('http.jsonl')).sort() : []);

/** 假 `res`：记录挂了哪些 finish 监听，`emit('finish')` 手动触发。 */
function fakeRes({ statusCode = 200, dest, hasReq = true } = {}) {
  const listeners = [];
  return {
    statusCode,
    req: hasReq ? { headers: dest === undefined ? {} : { 'sec-fetch-dest': dest } } : undefined,
    listeners,
    on(ev, cb) { listeners.push({ ev, cb }); return this; },
    emit(ev) { for (const l of listeners) if (l.ev === ev) l.cb(); },
  };
}

/** 变异体：把源码里的锚点逐条替换后落盘再 import（锚点漂了 ⇒ 抛）。 */
let mutantSeq = 0;
async function loadMutant(label, transforms) {
  // ⚠️ 锚点写的是 `\n`：源码文本先归一成 LF 再做字面替换（CRLF 检出下锚点会全不命中，
  // 与 `test/verify-transcode-state.mjs` 的 `\r?\n` 处理同一个理由）。
  const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  let out = src;
  for (const [find, replace] of transforms) {
    if (!out.includes(find)) throw new Error('变异体锚点漂了：' + label + ' ⇐ ' + JSON.stringify(find));
    out = out.replace(find, () => replace);
  }
  const dir = join(ISO, 'mutants');
  mkdirSync(dir, { recursive: true });
  mutantSeq += 1;
  const file = join(dir, mutantSeq + '-' + label + '.mjs');
  writeFileSync(file, out);
  return import(pathToFileURL(file).href);
}

// 形状：`[标签, [[find, replace], …]]` —— 每条 find 必须逐字命中源码，否则 loadMutant 抛。
const MUTANT_SPECS = [
  // I1 落盘
  ['no-mkdir', [['mkdirSync(dir, { recursive: true });', 'void dir;']]],
  // I3 轮转
  ['no-probe', [['let diagBytes = -1;', 'let diagBytes = 0;']]],
  ['reprobe-every-call', [
    ['if (diagBytes < 0) diagBytes = existsSync(file) ? statSync(file).size : 0;',
      'diagBytes = existsSync(file) ? statSync(file).size : 0;'],
  ]],
  ['rotate-after-write', [
    ["renameSync(file, file + '.1');",
      "appendFileSync(file, JSON.stringify({ t: Date.now(), kind, ...obj }) + '\\n');"],
  ]],
  ['race-unguarded', [
    ['if (existsSync(file)) {', 'if (true) {'],
    ['          try {\n            renameSync(file, file + \'.1\');\n          } catch {\n            /* 被并行实例抢先 ⇒ 本次不轮转，现有文件继续追加 */\n          }',
      "          renameSync(file, file + '.1');"],
  ]],
  // I1' 失败隔离
  ['errors-throw', [['} catch { /* 诊断失败不影响服务 */ }', '} catch (e) { throw e; }']]],
  // I4 折叠
  ['fold-never', [["slash > 40 ?", 'slash > 1000000 ?']]],
  ['fold-always', [
    ["slash > 40 ? '<token>/' + raw.slice(slash + 1) : raw",
      "slash >= 0 ? '<token>/' + raw.slice(slash + 1) : raw"],
  ]],
  ['fold-no-truncate', [[').slice(0, 150);', ');']]],
  ['fold-nonstring', [["const raw = String(p || '');", 'const raw = p;']]],
  // I5 请求记录
  ['path-raw', [['path: foldTokenPath(pathKey),', 'path: pathKey,']]],
  ['key-route-only', [["const key = route + '\\u0000' + String(pathKey);", 'const key = route;']]],
  ['dedup-off', [
    ['if (!reqLogSeenTouch(key, now, REQ_LOG_DEDUP_MS)) return;',
      'reqLogSeenTouch(key, now, REQ_LOG_DEDUP_MS);'],
  ]],
  ['dest-no-guard', [
    ["dest: String(res.req && res.req.headers ? res.req.headers['sec-fetch-dest'] || '' : ''),",
      "dest: res.req.headers['sec-fetch-dest'],"],
  ]],
  ['status-no-fallback', [['status: res.statusCode || 0,', 'status: res.statusCode,']]],
  // 去重 TTL 与上界
  ['ttl-off', [
    ['if (last !== undefined && now - last < ttlMs) return false;',
      'if (last !== undefined && false) return false;'],
  ]],
  ['dedup-unbounded', [
    ['while (reqLogSeen.size > REQ_LOG_SEEN_MAX) {',
      'while (false && reqLogSeen.size > REQ_LOG_SEEN_MAX) {'],
  ]],
];
const MUTANTS = new Map();
for (const [label, transforms] of MUTANT_SPECS) MUTANTS.set(label, await loadMutant(label, transforms));
const usedLabels = new Set();

/**
 * 一条正向判据 + 它的变异体：`judge(makeKit, d) => { ok, detail }`。
 * 两边喂的是**同一个 judge**（不是另抄一份判据），变异体必须判红。
 */
function pair(name, label, judge) {
  usedLabels.add(label);
  const run = (makeKit, d) => {
    try { return judge(makeKit, d); } catch (err) { return { ok: false, detail: '抛了 ' + (err && err.message) }; }
  };
  const pos = run((cfg) => createDiagTraceKit({ configPath: cfg }), scratch('pos-' + label));
  check(name, pos.ok, pos.detail);

  const mod = MUTANTS.get(label);
  const mut = run((cfg) => mod.createDiagTraceKit({ configPath: cfg }), scratch('mut-' + label));
  check('变异体 ' + label + ' ⇒ 同一判据必须变红', !mut.ok, mut.detail);
}

// ---------------------------------------------------------------- A. I1 落盘形状
section('A. I1 落盘位置、行形状、追加（不是覆盖）');

pair('A1 落在 <configPath 所在目录>/diag/http.jsonl，每行是 JSON.stringify({ t, kind, ...obj })',
  'no-mkdir', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    kit.appendDiagLine('req', { route: '/r', status: 200 });
    const f = diagFile(d);
    if (!existsSync(f)) return { ok: false, detail: '文件不存在：' + f };
    const lines = readLines(f);
    if (lines.length !== 1) return { ok: false, detail: '行数=' + lines.length };
    const obj = JSON.parse(lines[0]);
    const whole = JSON.stringify({ t: obj.t, kind: obj.kind, route: obj.route, status: obj.status }) + '\n';
    return {
      ok: readFileSync(f, 'utf8') === whole && typeof obj.t === 'number' && Math.abs(obj.t - Date.now()) < 5000,
      detail: '原样=' + JSON.stringify(lines[0]),
    };
  });

pair('A2 连续两次调用是追加（2 行），不是覆盖（1 行）',
  'no-mkdir', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    kit.appendDiagLine('a', { i: 1 });
    kit.appendDiagLine('b', { i: 2 });
    const lines = readLines(diagFile(d));
    return { ok: lines.length === 2 && JSON.parse(lines[1]).kind === 'b', detail: '行数=' + lines.length };
  });

pair('A3 中间目录不存在时递归建（configPath 指向多层不存在的目录）',
  'no-mkdir', (makeKit, d) => {
    const deep = join(d, 'a', 'b', 'c', 'config.json');
    const kit = makeKit(() => deep);
    kit.appendDiagLine('a', {});
    const f = join(d, 'a', 'b', 'c', 'diag', 'http.jsonl');
    return { ok: existsSync(f), detail: '期望存在=' + f };
  });

// ---------------------------------------------------------------- B. I3 轮转
section('B. I3 轮转只发生在写入之前、只留一代、当次不丢');

pair('B1 盘上已 ≥ 上限 + 全新 kit ⇒ 旧文件改名 .1（大小不变），新文件恰 1 行，目录里 http.jsonl* 恰 2 份',
  'no-probe', (makeKit, d) => {
    mkdirSync(diagDir(d), { recursive: true });
    writeFileSync(diagFile(d), Buffer.alloc(MAX_BYTES + 1024, 0x78));
    const kit = makeKit(cfgIn(d));           // 必须全新 kit：水位是模块级状态
    kit.appendDiagLine('req', { route: '/after-rotate' });
    const entries = diagEntries(d);
    const rolled = join(diagDir(d), 'http.jsonl.1');
    const lines = readLines(diagFile(d));
    const ok = entries.length === 2 && entries.includes('http.jsonl.1')
      && existsSync(rolled) && statSync(rolled).size >= MAX_BYTES
      && lines.length === 1 && JSON.parse(lines[0]).route === '/after-rotate';
    return { ok, detail: '目录=' + JSON.stringify(entries) + ' 新文件行数=' + lines.length };
  });

pair('B2 已加载的 kit 不再逐次 stat 盘上大小（内存累加）⇒ 外部灌水后仍不轮转',
  'reprobe-every-call', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    kit.appendDiagLine('a', { i: 1 });        // 首次写入时探一次盘上大小（0）
    appendFileSync(diagFile(d), Buffer.alloc(MAX_BYTES + 1024, 0x79));  // 外部把文件灌过上限
    kit.appendDiagLine('b', { i: 2 });
    const entries = diagEntries(d);
    return {
      ok: !entries.includes('http.jsonl.1') && readLines(diagFile(d)).length === 2,
      detail: '目录=' + JSON.stringify(entries),
    };
  });

pair('B3 轮转是「先改名、再写当次」—— 当次这一行必须落在新文件里',
  'rotate-after-write', (makeKit, d) => {
    mkdirSync(diagDir(d), { recursive: true });
    writeFileSync(diagFile(d), Buffer.alloc(MAX_BYTES + 1024, 0x7a));
    const kit = makeKit(cfgIn(d));
    kit.appendDiagLine('req', { route: '/current' });
    const lines = readLines(diagFile(d));
    return {
      ok: lines.length === 1 && JSON.parse(lines[0]).route === '/current',
      detail: '新文件行数=' + lines.length,
    };
  });

pair('B4 rename 竞态（旧文件已被并行实例轮转走 ⇒ ENOENT）⇒ 不抛且当次照写',
  'race-unguarded', (makeKit, d) => {
    mkdirSync(diagDir(d), { recursive: true });
    // 先落在上限**之下**：第一次 append 只探大小、不轮转，但写完后内存水位越过了上限
    writeFileSync(diagFile(d), Buffer.alloc(MAX_BYTES - 10, 0x7b));
    const kit = makeKit(cfgIn(d));
    kit.appendDiagLine('warm', { i: 0 });      // 水位 → 上限之上
    rmSync(diagFile(d));                       // 模拟被并行实例抢先轮转走（rename 将 ENOENT）
    kit.appendDiagLine('req', { route: '/race' });
    const lines = readLines(diagFile(d));
    return { ok: lines.length === 1 && JSON.parse(lines[0]).route === '/race', detail: '行数=' + lines.length };
  });

// ---------------------------------------------------------------- C. I1' 失败隔离
section('C. 诊断失败绝不影响服务（整条路径吞异常）');

pair('C1 configPath 落在「普通文件之下」⇒ appendDiagLine 不抛、不崩',
  'errors-throw', (makeKit, d) => {
    const blocker = join(d, 'blocker');
    writeFileSync(blocker, 'x');
    const kit = makeKit(() => join(blocker, 'config.json'));
    try {
      kit.appendDiagLine('req', { route: '/x' });
      return { ok: true, detail: '未抛' };
    } catch (err) {
      return { ok: false, detail: '抛了 ' + err.code };
    }
  });

pair('C2 同上 ⇒ traceRequests + finish 事件也不抛',
  'errors-throw', (makeKit, d) => {
    const blocker = join(d, 'blocker');
    writeFileSync(blocker, 'x');
    const kit = makeKit(() => join(blocker, 'config.json'));
    const res = fakeRes({ dest: 'iframe' });
    try {
      kit.traceRequests(res, '/scene-files', '/blocked');
      res.emit('finish');
      return { ok: true, detail: '未抛' };
    } catch (err) {
      return { ok: false, detail: '抛了 ' + err.code };
    }
  });

// ---------------------------------------------------------------- D. I4 foldTokenPath
section('D. foldTokenPath：折叠长 token 段、原样、截断 150、非字符串退化');

pair('D1 首段 > 40 字符 ⇒ <token>/ + 余下（留下真正有信息量的子路径）',
  'fold-never', (makeKit) => {
    const kit = makeKit(() => '/tmp/config.json');
    const got = kit.foldTokenPath('a'.repeat(41) + '/pkg/scene.json');
    return { ok: got === '<token>/pkg/scene.json', detail: '得到=' + JSON.stringify(got) };
  });

pair('D2 边界：首段恰 40 字符 ⇒ 原样（判据是严格 > 40，不是 ≥）',
  'fold-always', (makeKit) => {
    const kit = makeKit(() => '/tmp/config.json');
    const raw = 'a'.repeat(40) + '/pkg/scene.json';
    const got = kit.foldTokenPath(raw);
    return { ok: got === raw, detail: '得到=' + JSON.stringify(got.slice(0, 20)) + '…' };
  });

pair('D3 结果整体截断到 150 字符',
  'fold-no-truncate', (makeKit) => {
    const kit = makeKit(() => '/tmp/config.json');
    const got = kit.foldTokenPath('b'.repeat(200));
    return { ok: got.length === 150, detail: '长度=' + got.length };
  });

pair('D4 折叠后的结果同样受 150 截断',
  'fold-no-truncate', (makeKit) => {
    const kit = makeKit(() => '/tmp/config.json');
    const got = kit.foldTokenPath('c'.repeat(60) + '/' + 'd'.repeat(200));
    return { ok: got.length === 150 && got.startsWith('<token>/'), detail: '长度=' + got.length };
  });

pair('D5 非字符串（null / undefined / 数字）⇒ 退化不抛，null 与 undefined 得空串',
  'fold-nonstring', (makeKit) => {
    const kit = makeKit(() => '/tmp/config.json');
    const got = [kit.foldTokenPath(null), kit.foldTokenPath(undefined), kit.foldTokenPath(42)];
    return { ok: got[0] === '' && got[1] === '' && got[2] === '42', detail: JSON.stringify(got) };
  });

// ---------------------------------------------------------------- E. I5 traceRequests
section('E. traceRequests：注册即去重（同 route+path 10s）、落行形状、不同 path 立即记');

const TOKEN_PATH = 'a'.repeat(41) + '/live-frame';   // 会被折成 <token>/live-frame

pair('E1 首次注册 + finish ⇒ 落一行 { kind:"req", route, path（折叠后）, status, dest }',
  'path-raw', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    const res = fakeRes({ statusCode: 206, dest: 'iframe' });
    kit.traceRequests(res, '/scene-files', TOKEN_PATH);
    res.emit('finish');
    const lines = readLines(diagFile(d));
    if (lines.length !== 1) return { ok: false, detail: '行数=' + lines.length };
    const o = JSON.parse(lines[0]);
    const ok = o.kind === 'req' && o.route === '/scene-files' && o.path === '<token>/live-frame'
      && o.status === 206 && o.dest === 'iframe';
    return { ok, detail: JSON.stringify(o) };
  });

pair('E2 同 route+path 十秒内第二次：连 finish 监听都不挂（一行都不落）',
  'dedup-off', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    const r1 = fakeRes({});
    kit.traceRequests(r1, '/r', '/p');
    r1.emit('finish');
    const r2 = fakeRes({});
    kit.traceRequests(r2, '/r', '/p');
    r2.emit('finish');
    const lines = readLines(diagFile(d));
    const ok = r1.listeners.length === 1 && r2.listeners.length === 0 && lines.length === 1;
    return { ok, detail: '第二次监听数=' + r2.listeners.length + ' 行数=' + lines.length };
  });

pair('E3 不同 pathKey ⇒ 立即记（去重键含 path）',
  'key-route-only', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    for (const p of ['/p1', '/p2', '/p3']) {
      const r = fakeRes({ dest: 'empty' });
      kit.traceRequests(r, '/r', p);
      r.emit('finish');
    }
    const lines = readLines(diagFile(d));
    return { ok: lines.length === 3, detail: '行数=' + lines.length };
  });

pair('E4 res.req 缺失 ⇒ dest 落空串（不抛）',
  'dest-no-guard', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    const res = fakeRes({ hasReq: false });
    kit.traceRequests(res, '/r', '/p');
    res.emit('finish');
    const lines = readLines(diagFile(d));
    const o = lines.length === 1 ? JSON.parse(lines[0]) : {};
    return { ok: o.dest === '', detail: '行数=' + lines.length + ' dest=' + JSON.stringify(o.dest) };
  });

pair('E5 statusCode 缺失（undefined）⇒ status 落 0（不是缺键）',
  'status-no-fallback', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    const res = fakeRes({ dest: 'empty' });
    res.statusCode = undefined;
    kit.traceRequests(res, '/r', '/p');
    res.emit('finish');
    const lines = readLines(diagFile(d));
    const o = lines.length === 1 ? JSON.parse(lines[0]) : {};
    return { ok: o.status === 0, detail: 'status=' + JSON.stringify(o.status) };
  });

// ---------------------------------------------------------------- F. I5' TTL 边界
section('F. 去重 TTL 的边界（9999ms 抑制 / 10001ms 放行）');

pair('F1 同键 9999ms 后仍抑制、10001ms 后放行',
  'ttl-off', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    const realNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => now;
    try {
      const drive = () => { const r = fakeRes({}); kit.traceRequests(r, '/r', '/p'); r.emit('finish'); };
      drive();
      now += 9999;
      drive();
      const afterSuppress = readLines(diagFile(d)).length;
      now += 2;                                  // 累计 10001ms
      drive();
      const afterExpire = readLines(diagFile(d)).length;
      return {
        ok: afterSuppress === 1 && afterExpire === 2,
        detail: '9999ms 后=' + afterSuppress + ' / 10001ms 后=' + afterExpire,
      };
    } finally {
      Date.now = realNow;
    }
  });

// ---------------------------------------------------------------- G. I2' 去重表上界
section('G. 去重表有硬上界（按插入序淘汰最旧 ⇒ 内存有界）');

pair('G1 灌入 ' + SEEN_MAX + ' 个新键把首键挤出后，首键又能落行（证明确实有界且按插入序淘汰）',
  'dedup-unbounded', (makeKit, d) => {
    const kit = makeKit(cfgIn(d));
    const drive = (pathKey) => { const r = fakeRes({}); kit.traceRequests(r, '/r', pathKey); r.emit('finish'); };
    drive('/first');
    for (let i = 0; i < SEEN_MAX; i++) drive('/k' + i);
    const beforeRetry = readLines(diagFile(d)).length;
    drive('/first');                             // 首键已被淘汰 ⇒ 应重新落行
    const afterRetry = readLines(diagFile(d)).length;
    return {
      ok: beforeRetry === SEEN_MAX + 1 && afterRetry === SEEN_MAX + 2,
      detail: '挤满后=' + beforeRetry + ' 重试后=' + afterRetry,
    };
  });

// ---------------------------------------------------------------- H. 导出面 + 地板
section('H. 导出面、自检与覆盖面地板');

const kitProbe = createDiagTraceKit({ configPath: () => '/tmp/config.json' });
check('H1 kit 只暴露被消费的 4 个名字（内部常量与状态不外泄）',
  JSON.stringify(Object.keys(kitProbe).sort()) === JSON.stringify(
    ['appendDiagLine', 'foldTokenPath', 'traceMediaRequests', 'traceRequests']),
  'keys=' + JSON.stringify(Object.keys(kitProbe).sort()));

const ownSource = stripComments(readFileSync(SELF, 'utf8'));
const realCallCount = (ownSource.match(/createDiagTraceKit\(/g) || []).length;
check('H2 本文件确实静态读到被测模块（剥注释后仍有路径字面量 + 真调用）',
  ownSource.includes("from '../lib/diag-trace.js'") && realCallCount >= 3,
  '真调用=' + realCallCount);

const fakeSource = stripComments('// createDiagTraceKit 只在注释里出现\nconst x = 1;\n');
check('H3 负对照：只在注释里提到 createDiagTraceKit 的源码不算真读（判据先剥注释）',
  !fakeSource.includes('createDiagTraceKit'), '剥注释后=' + JSON.stringify(fakeSource.trim()));

const unused = MUTANT_SPECS.map(([l]) => l).filter((l) => !usedLabels.has(l));
check('H4 没有闲着不用的变异体规格（每条规格都真的喂给某个判据）',
  unused.length === 0, '未使用=' + JSON.stringify(unused));

const badShape = MUTANT_SPECS.filter(([label, tr]) => typeof label !== 'string'
  || !Array.isArray(tr) || tr.length === 0
  || tr.some((p) => !Array.isArray(p) || p.length !== 2
    || typeof p[0] !== 'string' || typeof p[1] !== 'string'));
check('H5 变异体规格形状必须是 [标签, [[find, replace], …]]（写成 ["a","b"] 会按字符解构成无牙变异体）',
  badShape.length === 0, '形状错=' + JSON.stringify(badShape.map(([l]) => l)));

// 地板写在 if 之外：覆盖面一旦被削（有人删判据/删变异体）必须立刻红。
const EXECUTED_FLOOR = 47;   // 本文件当前实测：21 正向 + 21 变异体 + 5 自检
const executed = passed + failed;
check('H6 覆盖面地板：至少 ' + EXECUTED_FLOOR + ' 条判据被执行', executed >= EXECUTED_FLOOR,
  'passed=' + passed + ' / failed=' + failed + ' / 地板 ' + EXECUTED_FLOOR);

console.log('\n' + (failed === 0
  ? 'ALL HOST-DIAG CHECKS PASSED (' + passed + ')'
  : 'HOST-DIAG CHECKS FAILED — ' + failed + ' failed, ' + passed + ' passed'));
process.exit(failed === 0 ? 0 : 1);
