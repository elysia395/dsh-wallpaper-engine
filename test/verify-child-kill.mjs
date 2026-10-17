// 子进程生命周期形态守卫（`lib/**`）：两条不变量都只能用**源码形态**判，因为它们
// 违反时的表现是"进程卡住/崩掉"，没有可断言的返回值 —— 行为判据在修复前会挂死或抛出
// 捕获不到的异常，CI 只能超时。
//
//   不变量 A（kill 前判 pid）：`spawn()` 一个不存在/不可执行的文件时，Node 返回的
//   ChildProcess `pid === undefined`；此时 `kill()` **既不抛、也不返回** —— 整个事件
//   循环被同步阻塞（macOS 实测：`kill()` 之后的 `console.log` 不执行，连 300ms 的
//   watchdog 定时器都不再触发，只能外部信号杀掉）。`try/catch` 因此完全无效（它挂住而
//   不是抛），唯一正解是调用前判 pid。
//
//   不变量 B（spawn 的返回值必须有 'error' 监听）：spawn 失败（ENOENT/EACCES）是**异步**
//   发到 'error' 事件上的，`try/catch` 只挡同步抛。没人监听时 Node 抛
//   `Unhandled 'error' event` ⇒ 宿主半边（单进程）整只崩死，比 A 更狠。
//
// 判据（阳性＝真实 lib/**；阴性对照＝合成源码 + 真源码变异体，全部走同一个判据函数）：
//   A. 一个 `.kill(` 调用点算"已守卫"，当且仅当同一语句块向上 8 行窗口内出现下面任一
//      形态（按**同一接收者**匹配）：`<x> && <x>.pid` / `<x>.pid !== undefined` /
//      `<x>.pid === undefined`（提早 return）/ `typeof <x>.pid === 'number'` /
//      `Number.isInteger(<x>.pid)` / `if (<x>.pid)`；或该调用点位于 `'spawn'` 事件回调里
//      （`once('spawn'|on('spawn'` —— 该事件只在 pid 落地后触发，pid 由事件契约保证，
//      lib/media/supervisor.js 的 killWhenSpawned 用它兜"晚到的 pid"）。
//      接收者叫 `process` 的调用（`process.kill(pid, 0)` 探活）不是 ChildProcess，按定义
//      排除 —— 这不是豁免表，而是判据的定义域。
//   B. 一个 `spawn(` 站点算"已监听"，当且仅当它的返回值被赋给某个变量，且**同一文件**里
//      该变量至少有一处 `<var>.on('error'` / `<var>.once('error'`。为什么按"同文件同变量"
//      而不是相邻行：lib/media/supervisor.js 的监听挂在 `awaitSpawn(p)` 里、与 `spawn` 不在
//      同一个函数（间隔几十行），按相邻行判会把正确的写法误判成违规；而未赋给变量的
//      `spawn(` 直接判违规（拿不到句柄就不可能挂监听）。
//
// 剥注释统一走共享的 `test/tools/js-text.mjs`（字符串感知），不用朴素块注释正则。
// Usage: node test/verify-child-kill.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './tools/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'lib');
const GENERATED = new Set(['lib/client.js']);
const KILL_RE = /([A-Za-z_$][\w$]*)\.kill\s*\(/;
const SPAWN_BARE_RE = /\bspawn\s*\(/;
const SPAWN_ASSIGN_RE = /\b([A-Za-z_$][\w$]*)\s*=\s*spawn\s*\(/;
const WINDOW = 8;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 判据 A：返回未被"子进程已建立"守卫包裹的 kill 调用点（含行号与接收者）。 */
function unguardedKills(code) {
  const lines = stripComments(code).split('\n');
  const bad = [];
  let sites = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(KILL_RE);
    if (!m) continue;
    const recv = m[1];
    if (recv === 'process') continue;
    sites++;
    const win = lines.slice(Math.max(0, i - WINDOW), i + 1).join('\n');
    const r = escapeRe(recv);
    const pidGuarded = new RegExp(
      '\\b' + r + '\\s*&&\\s*' + r + '\\.pid\\b'
      + '|\\b' + r + '\\.pid\\s*(?:!==?|===?)\\s*undefined'
      + '|typeof\\s+' + r + '\\.pid\\s*===?\\s*[\'"]number[\'"]'
      + '|Number\\.isInteger\\s*\\(\\s*' + r + '\\.pid'
      + '|if\\s*\\(\\s*' + r + '\\.pid\\s*\\)',
    ).test(win);
    const spawnEvent = /\.(?:once|on)\s*\(\s*['"]spawn['"]/.test(win);
    if (!pidGuarded && !spawnEvent) bad.push({ line: i + 1, recv, text: lines[i].trim() });
  }
  return { bad, sites };
}

/** 判据 B：返回没有同文件 `'error'` 监听的 spawn 站点（含行号与变量）。 */
function unmonitoredSpawns(code) {
  const text = stripComments(code);
  const lines = text.split('\n');
  const bad = [];
  const monitored = [];
  let sites = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!SPAWN_BARE_RE.test(lines[i])) continue;
    sites++;
    const m = lines[i].match(SPAWN_ASSIGN_RE);
    if (!m) {
      bad.push({ line: i + 1, recv: '(未赋值)', why: '返回值没赋给变量 ⇒ 拿不到句柄挂监听' });
      continue;
    }
    const recv = m[1];
    const r = escapeRe(recv);
    if (!new RegExp('\\b' + r + '\\s*\\.\\s*(?:on|once)\\s*\\(\\s*[\'"]error[\'"]').test(text)) {
      bad.push({ line: i + 1, recv, why: '同文件没有 ' + recv + ".on/once('error')" });
      continue;
    }
    monitored.push(i + 1 + ':' + recv);
  }
  return { bad, sites, monitored };
}

function listLib(dir = LIB, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) { listLib(abs, out); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (!GENERATED.has(rel)) out.push({ abs, rel });
  }
  return out;
}

/** 扫描面的第二半：每个子包自己的 `lib/**`（P-F 出户后媒体桥的实现住这里）。
 *  包目录由 `packages/*` 现算，不写死包名；目录不存在就跳过（未出户的组件没有这一层）。 */
function listSubpackageLib() {
  const out = [];
  let dirs;
  try { dirs = readdirSync(join(ROOT, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return out; }
  for (const name of dirs) {
    const dir = join(ROOT, 'packages', name, 'lib');
    try { if (readdirSync(dir, { withFileTypes: true }).length) listLib(dir, out); } catch { /* 没有 lib/ 的子包 */ }
  }
  return out;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

// ── 判据 A 的正负对照（合成源码，全部喂进同一个 unguardedKills）──────────────
{
  const cases = [
    ['A 阳性：`x && x.pid` 在 kill 之前（本仓统一写法）',
      'if (p && p.pid !== undefined) { try { p.kill(); } catch {} }', 0],
    ['A 阳性：提早 return 形态（`x.pid === undefined` 先返回）',
      'if (p.pid === undefined) return;\np.kill();', 0],
    ['A 阳性：`if (x.pid)` 形态', 'if (p.pid) { p.kill(); }', 0],
    ['A 阳性：`\'spawn\'` 事件回调（事件契约保证 pid 已落地）',
      "p.once('spawn', () => { try { p.kill('SIGKILL'); } catch {} });", 0],
    ['A 阴性对照：裸 kill（本条就是造成事件循环挂死的形态）',
      'try { p.kill(); } catch {}', 1],
    ['A 阴性对照：只判 truthy 不判 pid（修复前的 onAbort 形态）',
      'if (p) { try { p.kill(); } catch {} }', 1],
    ['A 阴性对照：判了别的变量的 pid 不算守卫',
      'if (q.pid !== undefined) { try { p.kill(); } catch {} }', 1],
    ['A 阴性对照：注释里的 kill 不是调用点', '// p.kill();', 0],
  ];
  for (const [name, src, want] of cases) {
    const got = unguardedKills(src).bad.length;
    check(name, got === want, '报出=' + got + ' 期望=' + want);
  }
}

// ── 判据 B 的正负对照 ───────────────────────────────────────────────────────
{
  const cases = [
    ['B 阳性：同文件同变量挂了 on(\'error\')',
      "const p = spawn('x');\np.on('error', () => {});", 0],
    ['B 阳性：监听在另一个函数里（supervisor 的 awaitSpawn 形态）',
      "function a() { const p = spawn('x'); }\nfunction b() { p.once('error', () => {}); }", 0],
    ['B 阴性对照：只挂 exit 不挂 error（legacy 修复前的形态）',
      "const p = spawn('x');\np.on('exit', () => {});", 1],
    ['B 阴性对照：`on(\'error\')` 只出现在注释里不算',
      "const p = spawn('x');\n// p.on('error', () => {});", 1],
    ['B 阴性对照：返回值没赋给变量 ⇒ 判违规',
      "spawn('x');", 1],
    ['B 阴性对照：监听挂在另一个变量上不算',
      "const p = spawn('x'); const q = spawn('y');\nq.on('error', () => {});", 1],
  ];
  for (const [name, src, want] of cases) {
    const got = unmonitoredSpawns(src).bad.length;
    check(name, got === want, '报出=' + got + ' 期望=' + want);
  }
}

// ── 真实扫描：`lib/**` + **每个子包 `packages/<pkg>/lib/**`** 的每个 kill / spawn 站点 ──
// ⚠️ P-F 起媒体桥的 spawn/kill 站点出户到 `packages/media-bridge/lib/**`（子包 `lib/` 不在主包
//    `lib/` 下）⇒ 只扫主包会让覆盖面地板静默塌陷（kill 8→4、spawn 4→1），判据却仍然绿。
{
  const files = [...listLib(), ...listSubpackageLib()];
  let killSites = 0;
  let spawnSites = 0;
  const killOffenders = [];
  const spawnOffenders = [];
  const sweep = [];
  for (const f of files) {
    const code = readFileSync(f.abs, 'utf8');
    const k = unguardedKills(code);
    const s = unmonitoredSpawns(code);
    killSites += k.sites;
    spawnSites += s.sites;
    for (const b of k.bad) killOffenders.push(f.rel + ':' + b.line + ' ' + b.recv);
    for (const b of s.bad) spawnOffenders.push(f.rel + ':' + b.line + ' ' + b.recv + ' — ' + b.why);
    if (s.sites > 0) sweep.push(f.rel + ' [' + s.sites + ' spawn: ' + s.monitored.join(', ') + ']');
  }
  check('覆盖面地板：扫描面 ≥ 40 个 lib 模块、≥ 8 个 kill 站点、≥ 4 个 spawn 站点',
    files.length >= 40 && killSites >= 8 && spawnSites >= 4,
    'files=' + files.length + ' kill=' + killSites + ' spawn=' + spawnSites);
  check('lib/** 的每个 .kill( 调用点都先确认子进程已建立（pid 落地）',
    killOffenders.length === 0, killOffenders.length ? killOffenders.join(' | ') : killSites + ' 处全部有守卫');
  check('lib/** 的每个 spawn( 站点都有同文件同变量的 \'error\' 监听',
    spawnOffenders.length === 0, spawnOffenders.length ? spawnOffenders.join(' | ') : spawnSites + ' 处全部有监听');
  console.log('  · 全仓 spawn sweep：' + (sweep.length ? sweep.join(' · ') : '（无）'));
}

// ── 变异对照：把真源码里的守卫/监听删掉，同一条判据必须报红 ──────────────────
// ⚠️ 读点按**真源**（本分支搬家后）：转码套件住 lib/media/transcode.js（上游在 lib/transcode.js）、
//    媒体桥内置实现住 packages/media-bridge/lib/legacy.js（上游在 lib/media/legacy.js）。
//    变异对照必须打在**跑起来的那份**上，否则"删掉守卫"删的是没人引用的副本 —— 判据会失去牙。
const readFirst = (...rels) => {
  for (const rel of rels) {
    try { return { rel, code: readFileSync(join(LIB, rel), 'utf8') }; } catch { /* 试下一个 */ }
  }
  throw new Error('找不到源码：' + rels.join(' / '));
};
/** 同 `readFirst`，但路径按**仓库根**起算（P-F 出户后的包在 `packages/**`，不在 `lib/` 下）。 */
const readRepoFirst = (...rels) => {
  for (const rel of rels) {
    try { return { rel, code: readFileSync(join(ROOT, rel), 'utf8') }; } catch { /* 试下一个 */ }
  }
  throw new Error('找不到源码：' + rels.join(' / '));
};
{
  const { rel, code: real } = readFirst('media/transcode.js', 'transcode.js');
  const needle = 'if (proc.pid !== undefined) { try { proc.kill(); } catch { /* ignore */ } }';
  const mutated = real.split(needle).join('if (true) { try { proc.kill(); } catch { /* ignore */ } }');
  check('变异对照前提：lib/' + rel + ' 里存在被删的那一行（命中 ' + (real.split(needle).length - 1) + ' 处）',
    mutated !== real);
  check('negative control(A): 同一条判据吃"删掉真源码 pid 守卫"的变异体必须报出调用点',
    unguardedKills(mutated).bad.length > 0,
    '报出=' + JSON.stringify(unguardedKills(mutated).bad.map((b) => b.line + ':' + b.recv)));
}
{
  const { rel, code: real } = readRepoFirst('packages/media-bridge/lib/legacy.js',
    'lib/components/media-bridge/legacy.js', 'lib/media/legacy.js');
  // 把两处 'error' 监听改名（保持语法合法、括号平衡），模拟"删掉监听"。
  const mutated = real.split(".on('error'").join(".on('errorDisarmed'");
  const { bad, sites } = unmonitoredSpawns(mutated);
  check('negative control(B): 同一条判据吃"legacy.js 的 error 监听被改名"的变异体必须报红',
    bad.length >= 2 && sites >= 2,
    '报出=' + JSON.stringify(bad.map((b) => 'lib/' + rel + ':' + b.line + ' ' + b.recv)));
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + (failed.length === 0 ? 'ALL CHILD-KILL CHECKS PASSED' : failed.length + ' CHECK(S) FAILED'));
process.exit(failed.length === 0 ? 0 : 1);
