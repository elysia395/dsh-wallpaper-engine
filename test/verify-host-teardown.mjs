#!/usr/bin/env node
/**
 * verify-host-teardown.mjs -- R-1 的机器面：apply() **中途抛错** ⇒ 宿主路由表残留 0
 *
 * ── 判的是什么 ────────────────────────────────────────────────────────────────
 * R-1（BUNDLE-SPLIT §13.1，该行的原文已按本轮实测更正）：
 *   `lib/index.js` 的 `apply()` 原先把 `handOffTeardown(ctx, dispose)` 留在函数**最后一行**。
 *   只要中间任何一处抛错（最现实的是上一次装载残留导致的
 *   `webserver: duplicate <kind> route "<path>"`），最后一行就**永不执行** ⇒ `ctx.effect`
 *   从未登记 ⇒ fiber 卸载时 `dispose()` 不跑 ⇒ 此前各族**已经注册成功**的路由全部留在宿主
 *   路由表里 ⇒ 下一次启用继续撞重复路由，插件到进程重启都起不来（半装载残留）。
 *   把交接挪到**任何一次注册之前**即修：抛错前登记的 effect 一定随 fiber 回滚。
 *   实测账：修前残留 31 条、修后 0 条（注册面 32 条，两臂 (kind,path) 逐条同序相等）。
 *
 * ── 与 R-1 原始断言的差别（本轮实测推翻，别再按原文写判据） ───────────────────
 * 原文断言"`disposers.push(webServer.register({…}))` 是一个表达式 ⇒ register() 抛错时 push 未
 * 执行、而那条路由"已进宿主路由表" ⇒ 单条残留"。从出货宿主 `dsh-host-webserver` 抠出的源码是：
 *     register(route) { const t = …; if (t.has(route.path)) throw new Error('webserver: duplicate …');
 *                       t.set(route.path, route); return () => { t.delete(route.path); }; }
 * 判重在 `table.set` **之前** ⇒ register() 抛错时路由表逐字节未变，"push 未执行"也正是对的。
 * 因此那 40 处单表达式（20 个文件）**没有可失败的中间态**，本判据不为它们编造断言；给每个族套
 * 族级 try/catch 只会加噪音。真正可复现的形态只有上面这一条：**交接位置**（见
 * docs/wip/BUNDLE-SPLIT.md §13.1 R-1 行）。
 *
 * ── 两把判据 ─────────────────────────────────────────────────────────────────
 *  ① 源码序（静态）：`apply()` 体内 `handOffTeardown(ctx, …)` 的位置必须**早于**第一处路由注册点，
 *     且函数体末行必须把这个 teardown 交回直调方（`return <标识符>;`）。文本先过
 *     test/tools/js-text.mjs 的 `stripComments()` ⇒ 注释里写的 `handOffTeardown(` 不认账。
 *  ② 行为（真代码 + mock 宿主/fiber）：跑**真 `lib/index.js` 的 `apply()`**，用"预置一条本函数
 *     最后才会注册的路由"复现真实触发器（上一次装载的残留）⇒ apply() 中途被宿主判重抛错 ⇒
 *     观察 fiber 回滚后的残留条数；判据断言残留 0，并顺手做两臂注册序列的逐条等式
 *     （零行为回归：路径集合 / 条数 / 注册顺序）。
 *
 * ── 带牙负对照（5 条，各自命中期望红） ───────────────────────────────────────
 *  NC1 源码序：把真源码文本**改成旧序**（交接挪回末行）⇒ 判据①必须判红。
 *  NC2 行为旧序：把同一份旧序文本落成 `.test-cache/` 下的镜像跑真代码 ⇒ 残留必须 > 0。
 *  NC3 覆盖面地板：把注册点/交接从文本里抹掉（或喂空文本）⇒ 判据①必须报"无法判定"而非假绿。
 *  NC4 mock 契约：坏 mock fiber（调用 `ctx.effect` 回调却**丢掉它的返回值**，等价于把
 *      `ctx.effect(() => once)` 的返回值扔了）在最小样例上必须假红 —— `handOffTeardown()` 交的
 *      disposer 是**回调的返回值**。这是 gate-r1 第一版踩过的假红点，契约写在这里防复发。
 *  NC5 场景地板：空转 apply（0 条注册）上"场景成立"判据必须判红，防"什么都没跑也算通过"。
 *
 * ── 未覆盖点（如实标注，不许升级为"已验证"） ─────────────────────────────────
 *  · 判据②用的 fiber 是 **mock**：它把 cordis "`_reload()` 捕获 apply 抛错后转 `_unload()`，
 *    `clear()` 并逐条执行 `_disposables`"这段语义做成可观测等价物。这段语义本身是**源码推读**
 *    （`@deepseek-ai/cordis` 本轮不装；CI 口径是 `npm ci --omit=peer`），本判据**没有跑真 cordis
 *    往返**，不要据此声称"已在真 cordis 上验证"。
 *  · mock 宿主逐字照抄出货 `dsh-host-webserver` 的 register 判重顺序；`tapIndex()`、升级路由
 *    （`registerUpgrade`）与 `registerFallback` 不在 `apply()` 的注册面上，未建模。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { functionBodyOf, stripComments } from './tools/js-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'lib', 'index.js');
const SCRATCH = join(ROOT, '.test-cache', 'host-teardown');

// 注册面地板：apply() 在 mock 宿主上的真实注册条数至少这么多（2026-02 实测 32）。
// 低于它说明 mock 没接上真注册链，判据会"真空为真" ⇒ 判红。
const ROUTE_FLOOR = 20;

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n      ' + detail : '')); }
}
function note(text) { console.log('  note ' + text); }

// ══════════════════════════════════════════════════════════════════════════════
// mock：真宿主判重语义 + cordis fiber 的 `ctx.effect` 契约
// ══════════════════════════════════════════════════════════════════════════════

const routeKey = (r) => r.kind + ' ' + r.path;
const dupMessage = (r) => 'webserver: duplicate ' + r.kind + ' route "' + r.path + '"';

/**
 * 出货 `dsh-host-webserver` 的路由表（register 语义逐字照抄）。
 * @param {{insertThenThrow?: boolean}} [opts] insertThenThrow = R-1 原文假想的"先插入后抛"宿主（本
 *   判据用它做 A 段负对照：只有那种宿主上"单表达式残留"才成立）。
 */
function makeHost({ insertThenThrow = false } = {}) {
  const table = new Map();
  return {
    table,
    register(route) {
      const k = routeKey(route);
      if (insertThenThrow) { table.set(k, route); throw new Error(dupMessage(route)); }
      if (table.has(k)) throw new Error(dupMessage(route));
      table.set(k, route);
      return () => { table.delete(k); };
    },
    tapIndex() { return () => {}; },
  };
}

/**
 * cordis fiber 的可观测等价物。
 *
 * ⚠️ **承重契约**：`ctx.effect(cb)` 收的 disposer 是 **cb() 的返回值**，不是 `cb` 本身。
 * `lib/host-boot.js` 的 `handOffTeardown()` 正是这么交的：`ctx.effect(() => once)` —— 箭头函数
 * **返回** `once`。所以这个 mock 必须"调用 cb、再把它的返回值当 disposer"，卸载时反向逐条执行。
 * 第一版把 `cb` 当清理函数、忽略返回值 ⇒ 成功路径的基线判据**假红**；NC4 把这个坑钉住。
 *
 * @param {object} webServer mock 宿主（真宿主或 recorder 代理）
 */
function makeFiber(webServer) {
  const disposables = [];
  return {
    ctx: {
      webServer,
      effect(cb) {
        const d = cb();
        if (typeof d === 'function') disposables.push(d);
        return () => {}; // cordis 的 effect 自身也是个 disposable；本判据不用它
      },
    },
    effectCount: () => disposables.length,
    /** `Fiber._unload()`：反向逐条执行，disposer 抛错被吞（与真 fiber 一致）。 */
    unload() {
      for (let i = disposables.length - 1; i >= 0; i--) {
        try { disposables[i](); } catch { /* cordis _unload 同样吞 */ }
      }
      disposables.length = 0;
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 判据①：源码序（静态，纯函数，负对照直接喂内存文本）
// ══════════════════════════════════════════════════════════════════════════════

/** apply() 体内的"路由注册点"形态（各族 register*Routes(webServer, {…}) 是主形态）。 */
const REGISTRATION_PATTERNS = [
  /\bregister[A-Za-z0-9_$]*Routes\s*\(/g, // registerInventoryRoutes(webServer, { … })
  /\.register\s*\(/g,                     // 直调 webServer.register(
  /\bcreateComponentSession\s*\(/g,       // 组件半边：会话一建就带 disposers
];

function firstRegistrationIndex(body) {
  let best = -1;
  for (const re of REGISTRATION_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(body);
    if (m && (best < 0 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * 判据①的纯函数内核。喂**任意**文本都能给判定（负对照靠这点在内存里造红面）。
 * @param {string|null} body apply() 函数体原文（含花括号）；null = 定位失败
 * @returns {{ok: boolean, issues: string[], unknown: string[], handoffAt: number,
 *            firstRegAt: number, tail: string, callTail: boolean}}
 */
function orderVerdict(body) {
  const issues = [];
  const unknown = [];
  if (typeof body !== 'string' || body.length === 0) {
    return { ok: false, issues, unknown: ['apply() 函数体定位失败（functionBodyOf 未命中）'], handoffAt: -1, firstRegAt: -1, tail: '', callTail: false };
  }
  const handoffAt = body.search(/\bhandOffTeardown\s*\(/);
  const firstRegAt = firstRegistrationIndex(body);
  // `functionBodyOf()` 交回的函数体**含花括号** ⇒ 末行判据要先剥掉最外层那一对，否则末行永远读到 `}`。
  let inner = body;
  if (inner.startsWith('{')) inner = inner.slice(1);
  if (inner.endsWith('}')) inner = inner.slice(0, -1);
  const lines = inner.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  const tail = lines[lines.length - 1] || '';
  const tailId = /^return\s+([A-Za-z_$][\w$]*)\s*;$/.exec(tail);
  const callTail = /^return\s+handOffTeardown\s*\(/.test(tail);

  if (handoffAt < 0) unknown.push('apply() 体内找不到 `handOffTeardown(` —— 无法判定交接位置');
  if (firstRegAt < 0) unknown.push('apply() 体内找不到任何路由注册点 —— 无法判定"交接先于注册"');

  if (tailId === null && !callTail) {
    issues.push('apply() 体末行不是 `return <标识符>;`（现在：' + tail + '）⇒ 直调方拿不到 teardown');
  }
  if (callTail) {
    issues.push('交接又被挪回函数末行（`' + tail + '`）⇒ 中途抛错时这一行永不执行，fiber 拿不到 teardown');
  }
  if (handoffAt >= 0 && firstRegAt >= 0 && handoffAt > firstRegAt) {
    issues.push('交接位置在首次注册**之后**（offset ' + handoffAt + ' > ' + firstRegAt + '）⇒ 抛错时 fiber 从未登记 ⇒ 前序路由全残留');
  }
  const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*handOffTeardown\s*\(\s*ctx\s*,/.exec(body);
  if (decl && tailId && tailId[1] !== decl[1]) {
    issues.push('末行返回的 `' + tailId[1] + '` 不是交接绑定的 `' + decl[1] + '` ⇒ 交回直调方的不是同一个 teardown');
  }
  return { ok: issues.length === 0 && unknown.length === 0, issues, unknown, handoffAt, firstRegAt, tail, callTail };
}

/**
 * 把源码改成 **R-1 旧序**（交接绑定行挪到函数末行）——NC1/NC2 共用这一个变换：
 * 删掉那条 `const <t> = handOffTeardown(ctx, dispose);`，再把末尾的 `return <t>;` 换成
 * `return handOffTeardown(ctx, dispose);`。变换失败（形态已不是修后形态）返回 null。
 * @param {string} src 源码（原文即可，注释行不会被这两条**行首锚定**的正则命中）
 */
function toOldOrder(src) {
  const declRe = /^([ \t]*)const\s+([A-Za-z_$][\w$]*)\s*=\s*handOffTeardown\s*\(\s*ctx\s*,\s*dispose\s*\);[ \t]*$/m;
  const m = declRe.exec(src);
  if (!m) return null;
  const indent = m[1];
  const name = m[2];
  let out = src.replace(m[0] + '\n', '');
  // 仓库契约是 LF（.gitattributes `* text=auto eol=lf`）：CRLF 检出时上面这条删不掉那一行
  // （`m[0]` 不含 `\r`）⇒ 半变异体（只换了末行、交接行仍在原位）会让 NC1 报"位置 issue 缺失"、
  // NC2 报"旧序残留 0"，看起来像判据坏了。这里显式判"删掉了没有"，没删就说清是变换失败。
  if (out === src) return null;
  const tailRe = new RegExp('^[ \\t]*return ' + name + ';[ \\t]*$', 'm');
  if (!tailRe.test(out)) return null;
  out = out.replace(tailRe, indent + 'return handOffTeardown(ctx, dispose);');
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// 判据②：行为（真 lib/index.js 的 apply() × mock 宿主/fiber）
// ══════════════════════════════════════════════════════════════════════════════

const req = (mod) => (mod.default && typeof mod.default.apply === 'function' ? mod.default.apply : mod.apply);

/** 录制臂：跑一遍成功的 apply()，拿注册序列（(kind,path) 逐条、按注册顺序）。 */
function recordRoutes(applyFn) {
  const host = makeHost();
  const seen = [];
  const proxy = {
    register(route) { seen.push(routeKey(route)); return host.register(route); },
    tapIndex() { return () => {}; },
  };
  const fiber = makeFiber(proxy);
  let error = null;
  try { applyFn(fiber.ctx); } catch (e) { error = e; }
  fiber.unload();
  return { seen, leftoverAfterUnload: host.table.size, error };
}

/**
 * 抛错臂：预置"本函数最后才会注册的那条 (kind,path)"（= 上一次装载没能撤走的残留）⇒ apply()
 * 跑到那一条时被宿主判重抛出 ⇒ 观察 fiber 回滚后的残留。
 * @param {Function} applyFn apply(ctx)
 * @param {string} lastKey 预置的 (kind,path) 键
 */
function runThrowing(applyFn, lastKey) {
  const kind = lastKey.slice(0, lastKey.indexOf(' '));
  const path = lastKey.slice(lastKey.indexOf(' ') + 1);
  const leaked = { kind, path, handler() {} };
  const host = makeHost();
  host.table.set(lastKey, leaked); // ← 上一轮泄漏进来的那条，不在本次 disposers 账上
  const fiber = makeFiber(host);
  let error = null;
  try { applyFn(fiber.ctx); } catch (e) { error = e; }
  const effectCount = fiber.effectCount();
  const registered = host.table.size - 1; // 减去预置的那条泄漏
  fiber.unload(); // ← cordis `_reload()` 捕获抛错后走 `_unload()` 的可观测等价物
  const residue = host.table.size - 1;
  const seedIntact = host.table.get(lastKey) === leaked;
  return { error, effectCount, registered, residue, seedIntact, message: error ? error.message : '' };
}

/** 场景地板：这一次真的"注册到一半被判重抛错"了吗（否则整段行为判据是空转）。 */
function scenarioIsMeaningful(r) {
  return /^webserver: duplicate /.test(r.message) && r.registered > 0 && r.effectCount >= 1;
}

// ══════════════════════════════════════════════════════════════════════════════
// A. 宿主判重顺序（R-1 原文前提 vs 出货宿主）——先把"为什么不为 40 处写断言"钉住
// ══════════════════════════════════════════════════════════════════════════════
console.log('verify-host-teardown: R-1 — apply() 中途抛错 ⇒ 宿主路由表残留 0');
note('cordis 的 _reload()/_unload() 回滚语义是源码推读（本轮不装 @deepseek-ai/cordis），判据②用 mock fiber 造可观测等价物，未跑真 cordis 往返。');

{
  const pre = { kind: 'exact', path: '/pre-existing', handler() {} };
  const real = makeHost();
  real.table.set(routeKey(pre), pre);
  const recorded = [];
  let realThrew = '';
  try { recorded.push(real.register({ kind: 'exact', path: '/pre-existing', handler() {} })); }
  catch (e) { realThrew = e.message; }
  check('前提①：出货宿主 register() 判重在 table.set 之前 ⇒ 抛错时路由表逐字节未变（那 40 处单表达式无需兜底）',
    realThrew === dupMessage(pre) && real.table.size === 1 && real.table.get(routeKey(pre)) === pre && recorded.length === 0,
    JSON.stringify({ realThrew, size: real.table.size, sameObject: real.table.get(routeKey(pre)) === pre, recorded: recorded.length }));

  const hypo = makeHost({ insertThenThrow: true });
  hypo.table.set(routeKey(pre), pre);
  let hypoThrew = '';
  let hypoRecorded = 0;
  try { hypoRecorded = [hypo.register({ kind: 'exact', path: '/pre-existing', handler() {} })].length; }
  catch (e) { hypoThrew = e.message; }
  check('前提②（负对照）：只有"先插入后抛"的假想宿主上才会留下无 disposer 记录的单条残留 —— R-1 原文只在这种宿主上成立',
    hypoThrew === dupMessage(pre) && hypoRecorded === 0 && hypo.table.get(routeKey(pre)) !== pre,
    JSON.stringify({ hypoThrew, recorded: hypoRecorded, entryReplaced: hypo.table.get(routeKey(pre)) !== pre }));
}

// ══════════════════════════════════════════════════════════════════════════════
// B. 判据① 源码序（真源码）
// ══════════════════════════════════════════════════════════════════════════════
const RAW = readFileSync(TARGET, 'utf8');
const CLEAN = stripComments(RAW); // 注释 → 等长空白；注释里的 handOffTeardown( 不认账
const BODY = functionBodyOf(CLEAN, 'function apply(ctx)');
const V = orderVerdict(BODY);

check('覆盖面：目标文件与 apply() 函数体都能定位（lib/index.js 的 `function apply(ctx)`）',
  existsSync(TARGET) && typeof BODY === 'string' && BODY.length > 0,
  JSON.stringify({ exists: existsSync(TARGET), bodyLen: typeof BODY === 'string' ? BODY.length : null }));

check('判据①（源码序）：`handOffTeardown(ctx, …)` 早于 apply() 体内第一处路由注册点',
  V.handoffAt >= 0 && V.firstRegAt >= 0 && V.handoffAt < V.firstRegAt,
  JSON.stringify({ handoffAt: V.handoffAt, firstRegAt: V.firstRegAt, issues: V.issues, unknown: V.unknown }));

check('判据①（源码序）：apply() 体末行把同一个 teardown 交回直调方（`return <标识符>;`，不是又一发 handOffTeardown）',
  V.ok,
  JSON.stringify({ tail: V.tail, issues: V.issues, unknown: V.unknown }));

// NC1：把真源码改成旧序 ⇒ 判据①必须判红
{
  const oldSrc = toOldOrder(RAW);
  const oldBody = oldSrc === null ? null : functionBodyOf(stripComments(oldSrc), 'function apply(ctx)');
  const oldV = orderVerdict(oldBody);
  check('NC1（源码序，带牙）：同一份真源码改成旧序（交接挪回末行）⇒ 判据①必须判红，且指出"交接在首次注册之后"',
    oldSrc !== null && oldV.ok === false && oldV.issues.some((s) => /首次注册\*\*之后/.test(s)),
    JSON.stringify({ mutated: oldSrc !== null, ok: oldV.ok, issues: oldV.issues, tail: oldV.tail }));
  note('NC1 原文：把真源码的交接行挪回末行后 → 判据① ok=' + oldV.ok + '，issues=' + JSON.stringify(oldV.issues));
}

// NC3：覆盖面地板 —— 抹掉注册点/交接 ⇒ 必须报"无法判定"，不许假绿
{
  const noRegs = typeof BODY === 'string' ? BODY.replace(/\bregister[A-Za-z0-9_$]*Routes\s*\(/g, 'noop(') : '';
  const noRegsV = orderVerdict(noRegs);
  const emptyV = orderVerdict('');
  const noHandoffV = orderVerdict(typeof BODY === 'string' ? BODY.replace(/\bhandOffTeardown\s*\(/g, 'noop(') : '');
  check('NC3（覆盖面地板，带牙）：注册点被抹掉 / 函数体为空 / 交接被抹掉 ⇒ 判据①必须判红（报"无法判定"或 issue），不许真空为真',
    noRegsV.ok === false && noRegsV.unknown.some((s) => /路由注册点/.test(s))
    && emptyV.ok === false && emptyV.unknown.length > 0
    && noHandoffV.ok === false,
    JSON.stringify({ noRegs: noRegsV.unknown, empty: emptyV.unknown, noHandoff: noHandoffV.issues.concat(noHandoffV.unknown) }));
  note('NC3 原文：抹掉注册点 → unknown=' + JSON.stringify(noRegsV.unknown)
    + '；空文本 → unknown=' + JSON.stringify(emptyV.unknown)
    + '；抹掉交接 → issues+unknown=' + JSON.stringify(noHandoffV.issues.concat(noHandoffV.unknown)));
}

// ══════════════════════════════════════════════════════════════════════════════
// C. 判据② 行为（真代码）——环境隔离必须在 import lib/index.js 之前
//    （与 test/verify-route-index.mjs ⑤ 同一套约定）
// ══════════════════════════════════════════════════════════════════════════════
const ISO = join(SCRATCH, 'iso');
process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
process.env.DSH_WE_DATA_DIR = join(ISO, 'data');
process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
process.env.HOME = join(ISO, 'home');
process.env.USERPROFILE = process.env.HOME;
mkdirSync(process.env.DSH_WE_CACHE_DIR, { recursive: true });
mkdirSync(process.env.DSH_WE_DATA_DIR, { recursive: true });
mkdirSync(process.env.DSH_WE_UPLOAD_DIR, { recursive: true });
mkdirSync(process.env.HOME, { recursive: true });

const NEW = await import(pathToFileURL(TARGET).href);
const newApply = req(NEW);
const rec = recordRoutes(newApply);

check('覆盖面：apply() 在 mock 宿主上真的注册了整条链（条数 ≥ ' + ROUTE_FLOOR + '，防判据真空为真）',
  rec.seen.length >= ROUTE_FLOOR && rec.error === null,
  JSON.stringify({ routes: rec.seen.length, floor: ROUTE_FLOOR, error: rec.error && rec.error.message }));
check('成功路径基线（自检）：apply() 正常返回时 fiber 卸载后宿主路由表清空（mock 与交接契约都接对了）',
  rec.leftoverAfterUnload === 0,
  JSON.stringify({ leftover: rec.leftoverAfterUnload }));

const newRun = runThrowing(newApply, rec.seen[rec.seen.length - 1]);
check('判据②（行为）：apply() 中途被判重抛错 ⇒ fiber 回滚后本次装载残留 0（抛错前已注册 ' + newRun.registered + ' 条）',
  newRun.residue === 0 && newRun.seedIntact,
  JSON.stringify({ residue: newRun.residue, registeredBeforeThrow: newRun.registered, seedIntact: newRun.seedIntact, threw: newRun.message }));
check('判据②前置：场景成立（真的注册到一半被判重抛错、effect 已登记、抛错前已注册 > 0 条）',
  scenarioIsMeaningful(newRun),
  JSON.stringify({ message: newRun.message, registered: newRun.registered, effectCount: newRun.effectCount }));

// NC5：场景地板 —— 空转 apply（0 条注册）上场景判据必须判红
{
  const empty = runThrowing(() => { /* 什么都不注册 */ }, 'exact /never');
  check('NC5（场景地板，带牙）：空转 apply（0 条注册）上"场景成立"判据必须判红 ⇒ 防"什么都没跑也算通过"',
    scenarioIsMeaningful(empty) === false,
    JSON.stringify({ message: empty.message, registered: empty.registered, effectCount: empty.effectCount }));
  note('NC5 原文：空转 apply → "场景成立"=' + scenarioIsMeaningful(empty) + '（message="' + empty.message + '"，registered=' + empty.registered + '，effectCount=' + empty.effectCount + '）');
}

// ══════════════════════════════════════════════════════════════════════════════
// D. NC2 行为旧序（真代码）：把旧序文本落成镜像跑一遍 ⇒ 残留必须 > 0
// ══════════════════════════════════════════════════════════════════════════════
{
  const oldSrc = toOldOrder(RAW);
  const mirrorDir = join(SCRATCH, 'old-order');
  let oldRun = null;
  let oldRec = null;
  let mirrorBuilt = false;
  try {
    if (oldSrc !== null) {
      rmSync(mirrorDir, { recursive: true, force: true });
      mkdirSync(mirrorDir, { recursive: true });
      cpSync(join(ROOT, 'lib'), join(mirrorDir, 'lib'), { recursive: true });
      cpSync(join(ROOT, 'package.json'), join(mirrorDir, 'package.json'));
      cpSync(join(ROOT, 'cordis.patch.yml'), join(mirrorDir, 'cordis.patch.yml'));
      writeFileSync(join(mirrorDir, 'lib', 'index.js'), oldSrc);
      mirrorBuilt = true;
      const oldMod = await import(pathToFileURL(join(mirrorDir, 'lib', 'index.js')).href);
      const oldApply = req(oldMod);
      oldRec = recordRoutes(oldApply);
      // 零行为回归：两臂注册面逐条同序相等（路径集合 / 条数 / 注册顺序）
      oldRun = runThrowing(oldApply, rec.seen[rec.seen.length - 1]);
    }
  } catch (error) {
    oldRun = { residue: -1, registered: -1, message: '镜像构建/装载失败：' + error.message };
  }
  check('NC2（行为旧序，带牙）：镜像真的建成（旧序文本已落盘）**且**同一场景下旧序真代码留下残留（> 0）—— 证明判据②不是恒绿',
    mirrorBuilt === true && oldRun !== null && oldRun.residue > 0,
    JSON.stringify({ mirrorBuilt, residue: oldRun && oldRun.residue, registeredBeforeThrow: oldRun && oldRun.registered, threw: oldRun && oldRun.message }));
  check('零行为回归：新旧两臂注册面逐条同序相等（条数 / 路径 / 顺序逐字节）',
    oldRec !== null && oldRec.seen.length === rec.seen.length && JSON.stringify(oldRec.seen) === JSON.stringify(rec.seen),
    JSON.stringify({ newCount: rec.seen.length, oldCount: oldRec && oldRec.seen.length }));
  if (oldRun !== null && oldRun.residue >= 0) {
    note('R-1 实测账：残留 旧序 ' + oldRun.residue + ' → 修后 ' + newRun.residue + '（注册面 ' + rec.seen.length + ' 条，两臂同序相等）');
  }
  note('NC2 原文：镜像建成=' + mirrorBuilt + '；同一场景下**旧序**真代码残留 ' + (oldRun && oldRun.residue) + ' 条（抛错前已注册 ' + (oldRun && oldRun.registered)
    + ' 条），新序残留 ' + newRun.residue + ' 条 ⇒ 判据②不是恒绿');
  try { rmSync(mirrorDir, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// E. NC4 mock 契约自检：`ctx.effect` 的 disposer = **回调的返回值**
//    （不碰 lib/index.js，也不碰内核租约；纯 mock 上验证"契约是承重的"）
// ══════════════════════════════════════════════════════════════════════════════
{
  // 最小 apply：注册一条 + 按 `handOffTeardown()` 的同款写法交给 fiber。
  const applyLike = (ctx) => {
    const d = ctx.webServer.register({ kind: 'exact', path: '/probe' });
    ctx.effect(() => d); // ← disposer 是回调的**返回值**
    return d;
  };
  const goodHost = makeHost();
  const goodFiber = makeFiber(goodHost);
  applyLike(goodFiber.ctx);
  goodFiber.unload();
  const goodLeftover = goodHost.table.size;

  // 坏 fiber：调用回调却**丢掉返回值**（= 把 `ctx.effect(() => once)` 的返回值扔了。）
  const badHost = makeHost();
  const badDisposables = [];
  const badFiber = {
    ctx: { webServer: badHost, effect(cb) { badDisposables.push(cb); return () => {}; } },
    unload() { for (const cb of [...badDisposables].reverse()) { try { cb(); } catch { /* ignore */ } } },
  };
  applyLike(badFiber.ctx);
  badFiber.unload();
  const badLeftover = badHost.table.size;

  check('NC4（mock 契约，带牙）：忽略 `ctx.effect` 回调返回值的 mock 在成功路径上必然假红（残留 1 条），正确实现回调返回值的 mock 才清空 —— 契约是承重的',
    goodLeftover === 0 && badLeftover === 1,
    JSON.stringify({ goodLeftover, badLeftover }));
  note('NC4 原文：正确实现"回调返回值即 disposer"的 mock → 残留 ' + goodLeftover + '；丢掉回调返回值的 mock → 残留 ' + badLeftover);
}

// ══════════════════════════════════════════════════════════════════════════════
// 判据①的负对照已全部在内存里喂纯函数（NC1/NC3）；判据②/地板用真代码（NC2/NC5）+ mock 契约（NC4）
// ══════════════════════════════════════════════════════════════════════════════
if (failed) { console.log('HOST TEARDOWN CHECKS FAILED -- ' + failed + ' failed'); process.exit(1); }
console.log('ALL HOST TEARDOWN CHECKS PASSED');
process.exit(0);
