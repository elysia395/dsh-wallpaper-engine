/**
 * verify-client-sync.mjs — 提交物 `lib/client.js` 与 `src/**` 的重建结果**逐字节一致**。
 *
 * 不变量：`lib/client.js` 是浏览器半边**唯一能被加载的形态**（见 `CONTRIBUTING.md`
 * 「What `lib/client.js` actually is」），它入库、随包分发，而本仓支持的安装路径
 * （`pnpm add github:…` / `link:`）**都不跑构建** ⇒ 产物一旦过期，发出去的就是旧行为。
 * 而**浏览器侧的守卫跑的都是产物**（`verify-readability` / `verify-softrender` / `verify-client`），
 * 所以"改了 `src/**` 忘重建"会让它们**全绿地验证旧代码**。
 *
 * CI 一直在判这件事（`.github/workflows/verify.yml`：`npm run build` 之后
 * `git diff --exit-code -- lib/client.js`）。本守卫把那一步搬进**本地链**，让它在 push 前就红。
 *
 * 做法：把当前产物读进内存 → 跑一次构建 → 逐字节比对 → **把原内容写回**。
 * 守卫不该改工作树：无论结论如何，退出时的 `lib/client.js` 都与进来时一致。
 * ⚠️ 构建必须用 `stdio: 'ignore'` 的子进程 —— 受限环境禁止**管道**捕获子进程输出（EPERM），
 * 而本守卫不需要它的 stdout。
 *
 * Usage:  node test/verify-client-sync.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARTIFACT = ROOT + 'lib/client.js';
const BUILD = ROOT + 'scripts/build-client.mjs';

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

if (!existsSync(ARTIFACT) || !existsSync(BUILD)) {
  console.log('  ✗ 前置缺失：' + [ARTIFACT, BUILD].filter((p) => !existsSync(p)).join(' / '));
  process.exit(1);
}
const before = readFileSync(ARTIFACT);

// 跑构建（stdio:'ignore' —— 不捕获输出，绕开管道限制）。
let buildCode = 0;
let buildErr = '';
try {
  execFileSync(process.execPath, [BUILD], { cwd: ROOT, stdio: 'ignore' });
} catch (e) {
  buildCode = (e && typeof e.status === 'number') ? e.status : 1;
  buildErr = String((e && e.message) || e);
}
const after = readFileSync(ARTIFACT);
// 立刻还原：守卫的职责是"判定"，不是"修好"（留下的 diff 会让使用者分不清是谁改的）。
if (!after.equals(before)) writeFileSync(ARTIFACT, before);

/**
 * 判定基准是**提交形态**，不是工作树的字节。构建脚本按 LF 写产物（`output.join('\n')`
 * 且逐模块 `replace(/\r\n/g, '\n')`），而本仓的检出侧开了 `core.autocrlf=true`
 * ⇒ 同一个内容在盘上是 CRLF、入索引时被规范化回 LF。直接比字节会把「检出侧的行尾」
 * 判成「产物过期」—— 干净工作树上比字节必红（第 1 行差异），而
 * `git diff` 同时说没改。CI 不红是因为它检出的就是 LF。
 * 所以两侧都折成 LF 再判：这仍能抓住"src 改了没重建"（那是**内容**差异），
 * 只是不再把行尾风格当内容差异。
 */
const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

/** 「产物过期」判据（主判据的**唯一**实现）：两侧折成 LF 后比较，不等即过期。
 *  正/负对照必须复用**本函数** —— 拿两个 `lf()` 结果互相比只是在证明 helper 自己会折
 *  行尾，压根没经过判据（A4：对照的牙必须长在主判据上，而不是长在它的实现细节上）。 */
const staleByLf = (after, before) => !lf(after).equals(lf(before));

check('重建命令成功退出（markers 齐全、产物可解析）', buildCode === 0,
  buildCode === 0 ? 'exit 0' : 'exit ' + buildCode + (buildErr ? ' · ' + buildErr.split('\n')[0] : ''));

/** 首个不同的行号（1-based）—— 只为了让报错能直接指路。 */
const firstDiffLine = (a, b) => {
  const la = lf(a).toString('utf8').split('\n');
  const lb = lf(b).toString('utf8').split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return i + 1;
  return 0;
};

const a0 = lf(after);
const b0 = lf(before);
const agree = !staleByLf(after, before);
const eolOnly = !after.equals(before) && agree;
check('提交物与重建结果一致（按提交形态 LF 比较）', agree,
  agree ? sha(b0) + ' · ' + b0.length + ' B' + (eolOnly ? '（盘上仅行尾风格不同：检出侧 CRLF，属正常）' : '')
    : '产物 ' + sha(b0) + ' ≠ 重建 ' + sha(a0) + '；首处差异在第 ' + firstDiffLine(before, after)
      + ' 行 ⇒ 跑 `npm run build` 并把 lib/client.js 与 src/** 一起提交');

// 负对照：同一个判据对"被改过一个字节"的**内容**必须判红，否则上面那条可能是恒真式。
{
  const tampered = Buffer.from(b0);
  tampered[tampered.length - 2] = tampered[tampered.length - 2] ^ 0x01;
  check('negative control: 内容差一个字节会被判出', staleByLf(tampered, b0),
    'len=' + tampered.length + ' · 首处差异第 ' + firstDiffLine(tampered, b0) + ' 行');
}
// 正对照：行尾风格不算内容差异 —— 否则本机（CRLF 检出）恒红。
// 两侧都是**真造出来的 Buffer**（CRLF 版 / LF 版），喂进主判据同一个函数 `staleByLf`：
// ① 只有行尾差异 ⇒ 不算过期；② 真有一个字节不同 ⇒ 必须算过期。②是这条对照的牙 ——
// 少了它，把 `staleByLf` 改成恒 false 也照样全绿（对照就成了"判据恒绿"的复述）。
{
  const crlfAfter = Buffer.from('a\r\nb\r\n', 'utf8');
  const lfBefore = Buffer.from('a\nb\n', 'utf8');
  const changed = Buffer.from('a\nB\n', 'utf8'); // 第 2 行的 b→B：真的差一个字节
  check('positive control: 只有 CRLF/LF 之差不算产物过期',
    staleByLf(crlfAfter, lfBefore) === false, 'CRLF vs LF ⇒ stale=' + staleByLf(crlfAfter, lfBefore));
  check('positive control 咬合：同一函数对"差一个字节"必须判 stale',
    staleByLf(changed, lfBefore) === true, 'a\\nb\\n vs a\\nB\\n ⇒ stale=' + staleByLf(changed, lfBefore));
}

console.log('\n' + (failed ? 'CLIENT SYNC CHECKS FAILED — ' + failed + ' failed' : 'CLIENT SYNC CHECKS PASSED')
  + ' (' + (passed + failed) + ')');
process.exit(failed ? 1 : 0);
