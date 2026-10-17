#!/usr/bin/env node
/**
 * verify-eol.mjs — 行尾（EOL）契约判据：**全部入库文本文件必须是 LF**（D-G1）。
 *
 * ## 这条守卫守什么
 * `.gitattributes:9` 写着 `* text=auto eol=lf`，它是本仓的**跨平台字节契约**：Windows 上 Git 的
 * `core.autocrlf=true` 会把文本文件检出成 CRLF，而 `test/**` 里大量判据靠「按行锚定的字面替换」
 * 构造负对照（那一句的实害清单写在 `.gitattributes` 头注释里，点了 `test/verify-transcode-state.mjs`
 * 的 `ONENTRY_CALL_RE` 等）—— 工作树一旦是 CRLF，锚点就不命中、负对照**假红**、整条 `verify` 链
 * 在 Windows 上短路。契约写在那里，此前却**没有任何判据**盯它（既有的 EOL 检查只覆盖子包清单一处），
 * 于是"某次编辑把 CRLF 写回工作树"只能靠人肉发现 —— 本仓真实踩过这个坑（整轮改动的 diff 里多出
 * `^M` 才被发现）。
 *
 * ## 判据口径（唯一一份，正判据与负对照共用）
 * · **扫描面** = `git ls-files` 列出的**入库**文件，减去 `.gitattributes` 的 `binary` 白名单
 *   （`*.png` 等资产：字节里本来就可能含 `0x0D`；那条白名单就是契约自己的排除面），再减去含
 *   `0x00` 的文件（Git `text=auto` 的二进制启发式，与之同口径）。
 *   ⚠️ 只认**入库**文件：工作树里的未跟踪产物（`dist/`、`.test-cache/` 之类）不在契约面内，
 *   把它们算进来会让"刚跑过 build"变成假红。
 * · **判红条件** = 文本文件字节里出现 `0x0D`（`\r`）：CRLF 与裸 CR 都算，契约是 LF。
 * · **覆盖面地板** = 扫到的入库文件数 ≥ `FILE_FLOOR`（防"git 列不出东西 ⇒ 判据恒真"）。
 * · git 不可用（不在工作树 / 没装 git）时**出声跳过**扫描面，但仍校验 `.gitattributes` 里的契约行
 *   存在 —— 否则这条守卫会在"没有 git"的形态下静默变成永真。
 *
 * ## 负对照怎么带牙
 * 判据主体是纯函数 `textEntries` / `crlfOffenders`，负对照把**内存里的** CRLF / 裸 CR / LF /
 * 白名单扩展名 / 含 NUL 的字节喂给**同一个**函数（不碰共享工作树里的真文件 —— 负对照写临时文件
 * 在 Windows 上是并跑守卫之间的共享状态）。断言逻辑不另开 `test/tools/*.mjs`：那会让
 * `test/verify-module-layout.mjs` ⑧ 要求新工具在 `docs/DEV-GUIDE.md` 里点名；单文件守卫没有这个面。
 *
 * Usage: node test/verify-eol.mjs
 */
import { readFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createCheck } from './tools/assert-harness.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { check, stats } = createCheck();

/** 覆盖面地板（实测 2026-10-16 = 452 个入库文件，其中 binary 白名单面 29 个）。只许抬高。 */
const FILE_FLOOR = 400;

/** `.gitattributes` 里的 `binary` 白名单：`*.png binary` 这一形态。 */
const BINARY_LINE_RE = /^\*\.(\w+)[ \t]+binary[ \t]*$/;

/** 纯函数：从 `.gitattributes` 文本取二进制扩展名集合（小写）。 */
function binaryExtsFrom(attrText) {
  const exts = new Set();
  for (const line of String(attrText).split('\n')) {
    const m = BINARY_LINE_RE.exec(line.trim());
    if (m) exts.add(m[1].toLowerCase());
  }
  return exts;
}

/** 纯函数：取扩展名（小写，无点）。 */
function extOf(rel) {
  const i = rel.lastIndexOf('.');
  return i < 0 ? '' : rel.slice(i + 1).toLowerCase();
}

/** 纯函数：`0x0D` 出现次数。 */
function crCount(buf) {
  let n = 0;
  for (const b of buf) if (b === 0x0d) n += 1;
  return n;
}

/** 纯函数：哪些入参算"文本"（减白名单、减含 NUL）。正判据与计数共用这一份口径。 */
function textEntries(entries, exts) {
  return entries.filter((e) => !exts.has(extOf(e.rel)) && !e.buf.includes(0));
}

/** 纯函数：违约清单（带 `\r` 的文本文件 + 次数）。 */
function crlfOffenders(entries, exts) {
  return textEntries(entries, exts)
    .map((e) => ({ rel: e.rel, cr: crCount(e.buf) }))
    .filter((o) => o.cr > 0);
}

/**
 * `git ls-files` 的入库清单。stdout **重定向到临时文件**：受限沙箱里抓子进程管道会 EPERM
 * （同一读法见 `test/verify-client-sync.mjs` 的 `lsFiles`）。
 */
function gitTrackedFiles() {
  const tmp = join(tmpdir(), 'eol-ls-files-' + process.pid + '.txt');
  let fd;
  try {
    fd = openSync(tmp, 'w');
    execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, stdio: ['ignore', fd, 'ignore'] });
    return { ok: true, tracked: readFileSync(tmp, 'utf8').split('\0').filter(Boolean), err: '' };
  } catch (err) {
    return { ok: false, tracked: [], err: String((err && err.message) || err).split('\n')[0] };
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* 已经关掉了 */ }
    }
    try { unlinkSync(tmp); } catch { /* 临时文件可能压根没建起来 */ }
  }
}

// ═══ 契约文件与扫描面 ══════════════════════════════════════════════════════════════════════
console.log('EOL / 行尾契约');

const attrPath = join(ROOT, '.gitattributes');
const attrText = existsSync(attrPath) ? readFileSync(attrPath, 'utf8') : '';
const exts = binaryExtsFrom(attrText);

check('覆盖面：`.gitattributes` 存在且载着 `* text=auto eol=lf` 这一行（契约本体在册）',
  /^\*[ \t]+text=auto[ \t]+eol=lf[ \t]*$/m.test(attrText),
  existsSync(attrPath) ? '契约行命中' : '（文件不存在）');
check('覆盖面：binary 白名单解析出 ≥ 10 个扩展名（防"白名单解析失败 ⇒ 资产被当文本扫"）',
  exts.size >= 10, exts.size + ' 个：' + [...exts].sort().join(' '));

const git = gitTrackedFiles();
const entries = [];
const unreadable = [];
if (git.ok) {
  for (const rel of git.tracked) {
    try { entries.push({ rel, buf: readFileSync(join(ROOT, rel)) }); } catch { unreadable.push(rel); }
  }
}
check('git 可用时：入库文件数 ≥ FILE_FLOOR（防"git 列不出东西 ⇒ 判据恒真"）',
  !git.ok || git.tracked.length >= FILE_FLOOR,
  git.ok ? git.tracked.length + ' 个入库文件 / 地板 ' + FILE_FLOOR
    : '⚠ git 跑不起来（' + git.err + '）⇒ 出声跳过扫描面，只判契约行');
check('扫描面：每个入库文件都读得出来（防"读失败被悄悄跳过"）',
  unreadable.length === 0, unreadable.length ? '读不出：' + unreadable.join(' ') : entries.length + ' 个文件都读到了');

// ═══ 主判据 ═══════════════════════════════════════════════════════════════════════════════
const text = textEntries(entries, exts);
const offenders = crlfOffenders(entries, exts);
const HEAD = 20;
check('全部入库文本文件都是 LF（零 `0x0D`）',
  offenders.length === 0,
  offenders.length
    ? offenders.length + ' 个文件带 CR：' + offenders.slice(0, HEAD).map((o) => o.rel + '(' + o.cr + ')').join(' ')
      + (offenders.length > HEAD ? ' …（共 ' + offenders.length + ' 个）' : '')
      + ' · 修法（内容零变化）：`while read f; do git show ":$f" > "$f"; done`（从 index blob 逐字节重写），'
      + '再 `git add -- <这些路径>` 刷新 stat 缓存（不然 `git status` 会留着 stale ` M`）'
    : text.length + ' 个文本文件 / ' + entries.length + ' 个入库文件全部 LF');

// ═══ 负对照 / 正对照（同一份纯函数，喂内存数据）══════════════════════════════════════════
const enc = (s) => Buffer.from(s, 'utf8');
const SYN = [
  { rel: 'src/合成-CRLF.js', buf: enc('a = 1;\r\nb = 2;\r\n') },
  { rel: 'src/合成-裸CR.js', buf: enc('a = 1;\rb = 2;\n') },
  { rel: 'src/合成-LF.js', buf: enc('a = 1;\nb = 2;\n') },
  { rel: 'assets/合成.png', buf: enc('\x89PNG\r\n\x1a\n') },
  { rel: 'assets/合成.bin', buf: Buffer.from([0x61, 0x0d, 0x00, 0x62]) },
];
const synHit = crlfOffenders(SYN, exts).map((o) => o.rel);
check('负对照：CRLF 文本被判出（判据不是恒真）', synHit.includes('src/合成-CRLF.js'),
  synHit.length ? '判出：' + synHit.join(' ') : '（零）');
check('负对照：裸 CR 文本也被判出（契约是 LF，不是"CRLF 才算"）', synHit.includes('src/合成-裸CR.js'));
check('正对照：纯 LF 文本不在违约清单里', !synHit.includes('src/合成-LF.js'));
check('正对照：binary 白名单扩展名被跳过（PNG 里的 CR 不算违约）', !synHit.includes('assets/合成.png'));
check('正对照：含 NUL 的文件被跳过（与 git 的 text=auto 同口径）', !synHit.includes('assets/合成.bin'));
check('负对照：清空白名单后 PNG 立刻被判出（证明上一条不是"没扫到"）',
  crlfOffenders(SYN, new Set()).some((o) => o.rel === 'assets/合成.png'));

console.log('');
if (stats.failed) {
  console.log('EOL CHECKS FAILED — ' + stats.failed + ' failed');
  process.exit(1);
}
console.log('ALL EOL CHECKS PASSED — ' + stats.passed + ' checks');
process.exit(0);
