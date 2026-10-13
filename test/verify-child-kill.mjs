// 形态守卫：`lib/**` 里每个子进程的 `.kill(` 调用点都必须先确认子进程**真的建立**了
// （`pid` 已落地）。
//
// 为什么需要它（真缺陷，SLICE 12 立案）：`spawn()` 一个不存在/不可执行的文件时，Node
// 返回的 ChildProcess `pid === undefined`；此时调用 `kill()` **既不抛异常、也不返回** ——
// 它把整个事件循环同步阻塞住（macOS 实测：`kill()` 之后的 `console.log` 不执行，连
// 300ms 的 watchdog 定时器都不再触发，只能靠外部信号杀掉进程）。宿主半边是单进程事件
// 循环，一次这样的挂死会让整个插件的 HTTP 面停摆（不只转码：系统字体扫描、媒体守护、
// 系统音频采集全在同一个 loop 上）。
//
// ⇒ `try/catch` 对这个形态**完全无效**（它挂住而不是抛），唯一的正解是调用前判 pid。
// 因为"行为判据"在修复前会挂死而不是报红（守卫自身就会卡住，CI 只能超时），判据必须
// 钉在**源码形态**上。
//
// 判据（阳性＝真实 lib/**；阴性对照＝合成源码 + 真源码变异体，全部走同一个
// `unguardedKills`）：一个 `.kill(` 调用点算"已守卫"，当且仅当在同一语句块向上 8 行窗口
// 内出现下面任一形态（按**同一接收者**匹配）：
//   ① `<x> && <x>.pid`（本仓统一写法）；
//   ② `<x>.pid !== undefined` / `<x>.pid === undefined`（提早 return 的形态）；
//   ③ `typeof <x>.pid === 'number'` 或 `Number.isInteger(<x>.pid)`；
//   ④ `if (<x>.pid)`；
//   ⑤ 调用点位于 `'spawn'` 事件回调里（`once('spawn'|on('spawn'`）—— 该事件只在 pid
//      落地后才触发，pid 由事件契约保证（lib/media/supervisor.js 的 killWhenSpawned
//      就用它兜"晚到的 pid"）。
// 例外面：接收者叫 `process` 的调用（`process.kill(pid, 0)` 探活）不是 ChildProcess，
// 不在本判据内 —— 这不是豁免表，而是判据的定义域。
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
const WINDOW = 8;

/** 判据：返回未被"子进程已建立"守卫包裹的 kill 调用点（含行号与接收者）。 */
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
    const r = recv.replace(/\$/g, '\\$');
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

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

// ── 正负对照（合成源码，全部喂进同一个 unguardedKills）───────────────────────
{
  const cases = [
    ['阳性：`x && x.pid` 在 kill 之前（本仓统一写法）',
      'if (p && p.pid !== undefined) { try { p.kill(); } catch {} }', 0],
    ['阳性：提早 return 形态（`x.pid === undefined` 先返回）',
      'if (p.pid === undefined) return;\np.kill();', 0],
    ['阳性：`if (x.pid)` 形态', 'if (p.pid) { p.kill(); }', 0],
    ['阳性：`\'spawn\'` 事件回调（事件契约保证 pid 已落地）',
      "p.once('spawn', () => { try { p.kill('SIGKILL'); } catch {} });", 0],
    ['阴性对照：裸 kill（本条就是造成事件循环挂死的形态）',
      'try { p.kill(); } catch {}', 1],
    ['阴性对照：只判 truthy 不判 pid（修复前的 onAbort 形态）',
      'if (p) { try { p.kill(); } catch {} }', 1],
    ['阴性对照：判了别的变量的 pid 不算守卫',
      'if (q.pid !== undefined) { try { p.kill(); } catch {} }', 1],
    ['阴性对照：注释里的 kill 不是调用点', '// p.kill();', 0],
  ];
  for (const [name, src, want] of cases) {
    const got = unguardedKills(src).bad.length;
    check(name, got === want, '报出=' + got + ' 期望=' + want);
  }
}

// ── 真实扫描：lib/** 的每个 kill 调用点 ──────────────────────────────────────
{
  const files = listLib();
  let sites = 0;
  const offenders = [];
  for (const f of files) {
    const { bad, sites: s } = unguardedKills(readFileSync(f.abs, 'utf8'));
    sites += s;
    for (const b of bad) offenders.push(f.rel + ':' + b.line + ' ' + b.recv);
  }
  check('覆盖面地板：扫描面 ≥ 40 个 lib 模块且 ≥ 8 个 kill 调用点',
    files.length >= 40 && sites >= 8, 'files=' + files.length + ' sites=' + sites);
  check('lib/** 的每个 .kill( 调用点都先确认子进程已建立（pid 落地）',
    offenders.length === 0, offenders.length ? offenders.join(' | ') : sites + ' 处全部有守卫');
}

// ── 变异对照：把真源码里的 pid 守卫删掉，同一条判据必须报红 ──────────────────
{
  const needle = 'if (proc.pid !== undefined) { try { proc.kill(); } catch { /* ignore */ } }';
  const bare = 'try { proc.kill(); } catch { /* ignore */ } }';
  const real = readFileSync(join(LIB, 'transcode.js'), 'utf8');
  const mutated = real.split(needle).join(bare);
  check('变异对照生效前提：lib/transcode.js 里确实存在被删的那一行',
    mutated !== real, 'needle 命中=' + (real.split(needle).length - 1));
  check('negative control: 同一条判据吃"删掉真源码 pid 守卫"的变异体必须报出调用点',
    unguardedKills(mutated).bad.length > 0,
    '报出=' + JSON.stringify(unguardedKills(mutated).bad.map((b) => b.line + ':' + b.recv)));
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + (failed.length === 0 ? 'ALL CHILD-KILL CHECKS PASSED' : failed.length + ' CHECK(S) FAILED'));
process.exit(failed.length === 0 ? 0 : 1);
