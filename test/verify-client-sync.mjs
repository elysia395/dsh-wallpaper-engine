/**
 * verify-client-sync.mjs — 构建**产物面**与 `src/**` / `packages/<pkg>/src/**` 的重建结果
 * **逐字节一致**，且**产物不出现在版本库里**（v1.4 起产物出库，见 CONTRIBUTING
 * 「What `lib/client.js` actually is」）。
 *
 * 不变量：产物是浏览器半边**唯一能被加载的形态**，由 `npm run build` 现场生成
 * （本地链 / CI / `prepack` 三条路径都跑同一支构建）。它们**不再入库**：本仓的安装路径
 * （npm 包 / Release tgz）都在打包时构建，开发路径（`link:`）本来就要求先 `npm run build`。
 *
 * ⚠️ 产物**不止一份**（BUNDLE-SPLIT §7.2「每包一产物」）：主包 `lib/client.js` + 每个声明了
 * 浏览器半边（`dsh.client` / `exports['./client']`）的 standalone 子包各一份
 * `packages/<pkg>/lib/client.<短名>.js`（fx / parallax …）。产物集合**不写死在本文件里**，
 * 而是取发现层 `test/tools/packages.mjs` 的 `clientPackages` —— 写死清单的失败模式是
 * 新产物**静默脱离**新鲜度判据（改了子包源码忘重建，而这里全绿地验证旧产物）。
 *
 * 判据三条，缺一不可：
 *   ① **产物面地板**：发现层给出的产物数 ≥ `FLOORS.clientArtifacts`（产物面被削空时下面每一条
 *      都可能恒真 ⇒ 先钉住这条；地板与负对照**共用同一个函数**）。
 *   ② **新鲜度**（**逐份产物**）：把当前产物读进内存 → 跑**一次**构建 → 逐字节比对 → 把原内容写回。
 *      任一份产物与重建结果不同 ⇒ 红，且判词**点名是哪一份**。
 *   ③ **不入库**：`git ls-files` 不得列出任何一份产物 / `docs/images/**`
 *      （artifact-untracking 的机器判定；文件仍在磁盘上由构建生成）。
 *
 * 做法：把当前产物读进内存 → 跑一次构建 → 逐字节比对 → **把原内容写回**。
 * 守卫不该改工作树：无论结论如何，退出时每份产物都与进来时一致。
 * ⚠️ 构建必须用 `stdio: 'ignore'` 的子进程 —— 受限环境禁止**管道**捕获子进程输出（EPERM），
 * 而本守卫不需要它的 stdout。同理 `git ls-files` 的 stdout 正是需要的，所以走 **fd 重定向到临时文件**
 * 再读回（不是"换个方式重试"：这里要的就是**不捕获管道**）。
 *
 * Usage:  node test/verify-client-sync.mjs
 */
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// 产物面真源（不写死清单）：包 ⇄ 浏览器半边产物的对应关系只有发现层一处。
import { discoverPackages, FLOORS } from './tools/packages.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUILD = ROOT + 'scripts/build-client.mjs';

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

/** 发现层给的是**根相对**路径（正斜杠）；这里统一成同样口径再拼绝对路径。 */
const relOf = (s) => String(s).replace(/\\/g, '/').replace(/^\.\//, '');

let model;
try {
  model = discoverPackages(ROOT);
} catch (e) {
  console.log('  ✗ 发现层失败：discoverPackages() 抛错 — ' + String((e && e.message) || e));
  process.exit(1);
}
const MAIN_REL = model.main.clientArtifact ? relOf(model.main.clientArtifact) : '';
// 集合去重（发现层的契约里主包恒在 `clientPackages[0]`，但这里不靠位置，靠去重后的集合）。
const ARTIFACTS = [];
for (const p of model.clientPackages) {
  const rel = relOf(p.clientArtifact);
  if (rel && !ARTIFACTS.some((a) => a.rel === rel)) ARTIFACTS.push({ rel, abs: ROOT + rel, name: p.name });
}
const artNames = ARTIFACTS.map((a) => a.rel);
console.log('  产物集合（发现层 clientPackages）：' + ARTIFACTS.length + ' 份 — ' + artNames.join(', '));

/** 「产物面地板」判据（**唯一**实现）：生产判据与负对照都喂它。 */
const meetsArtifactFloor = (n) => n >= FLOORS.clientArtifacts;
check('产物面地板：发现层给出 ≥ ' + FLOORS.clientArtifacts + ' 份产物（含主包；防止产物面静默缩小）',
  meetsArtifactFloor(ARTIFACTS.length), ARTIFACTS.length + ' 份 — ' + artNames.join(', '));
// 负对照：同一个函数对"少一份"必须判红 —— 少了它，把地板写成恒真也照样全绿。
check('negative control: 同一地板对 ' + (FLOORS.clientArtifacts - 1) + ' 份判红',
  !meetsArtifactFloor(FLOORS.clientArtifacts - 1),
  'FLOORS.clientArtifacts=' + FLOORS.clientArtifacts + ' ⇒ ' + (FLOORS.clientArtifacts - 1) + ' 份 = 不达标');
check('产物集合含主包产物（clientPackages 的契约：主包恒在集合里，且主包 clientArtifact 非空）',
  Boolean(MAIN_REL) && artNames.includes(MAIN_REL), MAIN_REL || '（主包 clientArtifact 为空）');

// 前置：构建脚本与**每一份**产物都必须在盘（产物由 `npm run build` 现场生成）。
const missingBuild = !existsSync(BUILD);
const missingArtifacts = ARTIFACTS.filter((a) => !existsSync(a.abs));
if (missingBuild || missingArtifacts.length) {
  console.log('  ✗ 前置缺失：' + [...(missingBuild ? [BUILD] : []), ...missingArtifacts.map((a) => a.rel)].join(' / ')
    + '（产物由 `npm run build` 现场生成；先跑一次构建）');
  process.exit(1);
}
const before = new Map(ARTIFACTS.map((a) => [a.rel, readFileSync(a.abs)]));

// 跑构建（stdio:'ignore' —— 不捕获输出，绕开管道限制）。
// timeout/killSignal：给"构建卡住"加界。没有它时，子进程一旦不退出，父进程会**无界静默等待**
// （一个字都不输出）；加上之后超时由 SIGKILL 收掉，`e.status` 为 null ⇒ 下面按 1 计 ⇒ 判红
// 并在判词里带上 `ETIMEDOUT`，使用者能从输出本身看出发生了什么。判据一条未改。
let buildCode = 0;
let buildErr = '';
try {
  execFileSync(process.execPath, [BUILD], { cwd: ROOT, stdio: 'ignore', timeout: 120000, killSignal: 'SIGKILL' });
} catch (e) {
  buildCode = (e && typeof e.status === 'number') ? e.status : 1;
  buildErr = String((e && e.message) || e);
}
check('重建命令成功退出（markers 齐全、产物可解析）', buildCode === 0,
  buildCode === 0 ? 'exit 0' : 'exit ' + buildCode + (buildErr ? ' · ' + buildErr.split('\n')[0] : ''));

/**
 * 判定基准是**构建形态**，不是工作树的字节。构建脚本按 LF 写产物（`output.join('\n')`
 * 且逐模块 `replace(/\r\n/g, '\n')`），而仓库契约是全仓 LF（`.gitattributes`），
 * 若某种检出把盘上写出了 CRLF，直接比字节会把「检出侧的行尾」判成「产物过期」——
 * 干净工作树上比字节必红（第 1 行差异）。
 * 所以两侧都折成 LF 再判：这仍能抓住"src 改了没重建"（那是**内容**差异），
 * 只是不再把行尾风格当内容差异。
 */
const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

/** 「产物过期」判据（主判据的**唯一**实现）：两侧折成 LF 后比较，不等即过期。
 *  正/负对照必须复用**本函数** —— 拿两个 `lf()` 结果互相比只是在证明 helper 自己会折
 *  行尾，压根没经过判据（A4：对照的牙必须长在主判据上，而不是长在它的实现细节上）。 */
const staleByLf = (after, before) => !lf(after).equals(lf(before));

/** 首个不同的行号（1-based）—— 只为了让报错能直接指路。 */
const firstDiffLine = (a, b) => {
  const la = lf(a).toString('utf8').split('\n');
  const lb = lf(b).toString('utf8').split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return i + 1;
  return 0;
};

// 逐份产物：读回 → 与构建前逐字节比对 → **立刻还原**（守卫的职责是"判定"，不是"修好"：
// 留下的 diff 会让使用者分不清是谁改的）；判词一律带上产物名，N 份里哪一份过期要能直接看出来。
for (const a of ARTIFACTS) {
  const after = existsSync(a.abs) ? readFileSync(a.abs) : null;
  const b0 = before.get(a.rel);
  if (after && !after.equals(b0)) writeFileSync(a.abs, b0);
  const a0 = after ? lf(after) : null;
  const agree = after !== null && !staleByLf(after, b0);
  const eolOnly = after !== null && !after.equals(b0) && agree;
  check('构建产物与重建结果一致（按构建形态 LF 比较）— ' + a.rel, agree,
    after === null ? '重建后该产物不在盘（构建没有产出它；产物由 `npm run build` 生成）'
      : agree ? sha(lf(b0)) + ' · ' + lf(b0).length + ' B' + (eolOnly ? '（盘上仅行尾风格不同：检出侧 CRLF，属正常）' : '')
        : '产物 ' + sha(lf(b0)) + ' ≠ 重建 ' + sha(a0) + '；首处差异在第 ' + firstDiffLine(b0, after)
          + ' 行 ⇒ 跑 `npm run build` 重建（产物不再入库，重建后无需提交它）');
}

// 负对照：同一个判据对**每一份**产物"被改过一个字节"的内容都必须判红，否则上面那 N 条可能是恒真式。
{
  const missed = [];
  for (const a of ARTIFACTS) {
    const b0 = lf(before.get(a.rel));
    const tampered = Buffer.from(b0);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] ^ 0x01;
    if (!staleByLf(tampered, b0)) missed.push(a.rel);
  }
  check('negative control: 每一份产物内容差一个字节都会被判出（' + ARTIFACTS.length + ' 份共用同一判据）',
    missed.length === 0, missed.length ? '漏判：' + missed.join(' ') : artNames.join(' '));
}
// 正对照：行尾风格不算内容差异 —— 否则换一种检出的机器上恒红。
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

// ── 产物不入库（v1.4 起）：**每一份**产物与 `docs/images/**` 不得被 git 跟踪 ────────────
// 这是"产物出库"策略的机器判定：构建产物与展示图（现由媒体 Release 分发，见 README）都不入库。
// 判据口径：`git ls-files` 列出即红（不比对内容 —— 跟踪本就是错的那件事）。
/**
 * 跑一次 `git ls-files` 并读回 stdout。stdout **不能走管道**（受限环境 EPERM），所以重定向到
 * 临时文件再读 —— 需要的就是这段输出，绕开的是管道而不是判据。
 * 返回 `{ ok, tracked, err }`；`ok === false` 表示 git 根本跑不起来（不是 git 工作树 / 没装 git）。
 */
const lsFiles = (args) => {
  const tmp = join(tmpdir(), 'dsh-client-sync-ls-files-' + process.pid + '.txt');
  let fd = null;
  try {
    fd = openSync(tmp, 'w');
    execFileSync('git', ['ls-files', '--', ...args], { cwd: ROOT, stdio: ['ignore', fd, 'ignore'] });
    closeSync(fd);
    fd = null;
    const out = readFileSync(tmp, 'utf8');
    unlinkSync(tmp);
    return { ok: true, tracked: out.split('\n').map((s) => s.trim()).filter(Boolean), err: '' };
  } catch (e) {
    if (fd !== null) { try { closeSync(fd); } catch { /* 已经关了 */ } }
    try { unlinkSync(tmp); } catch { /* 压根没建起来 */ }
    return { ok: false, tracked: [], err: String((e && e.message) || e).split('\n')[0] };
  }
};

{
  const ls = lsFiles([...artNames, 'docs/images']);
  if (!ls.ok) {
    console.log('  ⚠ git 跑不起来（不是 git 工作树 / 没装 git）⇒ 跳过「产物不入库」判据：' + ls.err);
  } else {
    check('产物不入库：' + ARTIFACTS.length + ' 份产物与 docs/images/** 均未被 git 跟踪', ls.tracked.length === 0,
      ls.tracked.length === 0 ? 'ls-files 空（pathspec: ' + artNames.join(' ') + ' docs/images）'
        : '被跟踪 ' + ls.tracked.length + ' 条：' + ls.tracked.slice(0, 5).join(', ') + (ls.tracked.length > 5 ? ' …' : ''));
    // 负对照：给一个**确定被跟踪**的路径（仓库根自己的守卫脚本），同一判据必须能列出它。
    // 少了这条，"ls-files 永远返回空"（比如 pathspec 写错）也会全绿。
    const probe = lsFiles(['test/verify-client-sync.mjs']);
    check('negative control: 同一判据对已跟踪文件有牙（本守卫自身被列出）',
      probe.ok && probe.tracked.length === 1, 'probe=' + JSON.stringify(probe.tracked) + (probe.ok ? '' : ' · ' + probe.err));
  }
}

console.log('\n' + (failed ? 'CLIENT SYNC CHECKS FAILED — ' + failed + ' failed' : 'CLIENT SYNC CHECKS PASSED')
  + ' (' + (passed + failed) + ')');
process.exit(failed ? 1 : 0);
