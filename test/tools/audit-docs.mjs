#!/usr/bin/env node
/**
 * audit-docs.mjs — 文档/注释审计（人工工具，**不进 CI 链**）。
 *
 * 按 ADR-0006 / 0007 / 0017 的口径做五件事：
 *   ① 现行文档与代码注释里引用的路径**在磁盘上是否还存在**（重构后最容易腐化的一类）；
 *   ② Markdown 相对链接是否断；
 *   ③ 现行文档里是否写了**会漂的数值**（行数 / 条数 / 个数）；
 *   ④ 面向用户的文档中英是否成对、是否互相有语言切换链接；
 *   ⑤ 生成物（ROUTE-INDEX / GUARD-MAP / TOKEN-CONTRACT）是否被手改过（交给生成器复算，不在本工具里判）。
 *
 * 分类口径：
 *   · current   —— docs 根与 docs/en 的用户文档：**发现即缺陷**（ADR-0017 D1）；
 *   · generated —— 生成物：发现路径失效 ⇒ 跑对应生成器（工具只报，不改）；
 *   · adr       —— 决策记录：**方针/取舍不改**，但结论类内容（路径、符号、现状断言）允许按现状校正；
 *                  明显属“决策当时旧址”的引用由 IGNORE 逐条豁免并写明理由（见 docs/adr/README.md）；
 *   · ledger    —— CHANGELOG / changelog/ / archive/：**账本，不追溯改写**（ADR-0017 D4），只统计；
 *   · comment   —— 源码注释：发现路径失效即缺陷（注释是读者入口）。
 *
 * Usage: node test/tools/audit-docs.mjs [--json] [--max 200]
 * 只读：不写盘、不改任何文件。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const JSON_OUT = process.argv.includes('--json');
const maxArg = process.argv.indexOf('--max');
const MAX = maxArg > 0 ? Number(process.argv[maxArg + 1]) || 200 : 200;
const BS = String.fromCharCode(92);
const rel = (p) => relative(ROOT, p).split(BS).join('/');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.artifacts' || e.name === '.test-cache') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(md|js|mjs|json|yml|yaml)$/.test(e.name)) out.push(p);
  }
  return out;
}

const LEDGER = /^docs\/(archive\/|changelog\/|en\/changelog\/|CHANGELOG\.md$|en\/CHANGELOG\.md$)/;
/** ADR 不是账本：方针/取舍不改，但**结论类内容**（路径、符号、「现状是 X」的断言）允许按现状校正。 */
const ADR_DIR = /^docs\/adr\//;
const GENERATED = /^docs\/(ROUTE-INDEX|GUARD-MAP|TOKEN-CONTRACT)\.md$/;
const USER_DOCS = ['CHANGELOG.md', 'HOW-IT-WORKS.md', 'TROUBLESHOOTING.md', 'UPGRADING.md'];
const category = (fileRel) => (LEDGER.test(fileRel) ? 'ledger' : ADR_DIR.test(fileRel) ? 'adr' : GENERATED.test(fileRel) ? 'generated' : 'current');

const ROOT_DOCS = ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'AGENTS.md']
  .map((f) => join(ROOT, f)).filter((f) => existsSync(f));
const docsFiles = [...(existsSync(join(ROOT, 'docs')) ? walk(join(ROOT, 'docs')) : []), ...ROOT_DOCS];
const codeRoots = ['src', 'lib', 'packages', 'scripts'].filter((d) => existsSync(join(ROOT, d)));
const codeFiles = codeRoots.flatMap((d) => walk(join(ROOT, d)));

const PATH_RE = /(?<![\w./-])((?:src|lib|packages|test|scripts|assets)\/[A-Za-z0-9_./-]*[A-Za-z0-9_-])(\.(?:js|mjs|json|md|yml|yaml|css|html|png))?/g;
const skipPath = (p) => /[*<>{}$]/.test(p) || p.endsWith('/') || /[-_]$/.test(p);
/** 正则会在 `*` / `{` 之前截断（`src/picker-*.js`、`src/<pkg>/x.js`）—— 截断后剩下的前缀不是真路径，跳过。 */
const truncatedAt = (line, index, len) => {
  const next = line.slice(index + len, index + len + 1);
  if (/[*<>{}$]/.test(next)) return true;
  // `lib/client.<pkg>.js` 这类命名模板：匹配会在点号处停住，剩余部分不是路径
  const matched = line.slice(index, index + len);
  return next === '.' && !/\.(js|mjs|json|md|yml|yaml|css|html|png)$/.test(matched);
};
/** 不是本仓路径的四种常见形态（都是**陈述正确**的写法，不该报）。 */
function foreignContext(line, index) {
  const before = line.slice(0, index);
  if (/dsh-my-ui\/(?:scripts\/)?$/.test(before)) return '父仓 dsh-my-ui 的路径';
  if (/\/(?:scripts|src)\/$/.test(before) && !/(^|\s)(?:scripts|src)\/$/.test(before)) return '其它仓库的子目录';
  if (/(前缀|prefix)[^\n]{0,12}$/i.test(before)) return '指的是前缀，不是文件';
  return '';
}
const PLACEHOLDER = /(^|\/)(your-|example|foo\b|bar\b)/;
const ARTIFACT_NAME = /^lib\/client(\.[a-z0-9-]+)?\.js$/;
/** 显式豁免：逐条写**为什么它不是缺陷**（ADR-0007 第 1/2 问）。 */
const IGNORE = [
  { file: 'scripts/compare-bundle.mjs', path: 'src/styles-base.js', why: '自检夹具里的字符串字面量（演示 --map 用法），不是引用真实文件' },
  { file: 'scripts/compare-bundle.mjs', path: 'src/styles-shell.js', why: '同上' },
  // —— 以下不是缺陷，逐条写明理由（ADR-0007 第 1/2 问）——
  { file: 'docs/CODE-STRUCTURE.md', line: 987, path: 'scripts/prepare-dependencies.mjs', why: '父仓 dsh-my-ui 的路径；同句已点名该父仓' },
  { file: 'docs/CODE-STRUCTURE.md', line: 987, path: 'src/first-run.js', why: '同上（dsh-my-ui 的相对路径）' },
  { file: 'docs/CODE-STRUCTURE.md', line: 988, path: 'src/main.js', why: '同上（dsh-my-ui 的相对路径）' },
  { file: 'docs/CODE-STRUCTURE.md', line: 998, path: 'src/main.js', why: '同上（dsh-my-ui 的相对路径）' },
  { file: 'lib/index.js', line: 480, path: 'lib/components', why: '迁移历史：描述批 1c 之前的旧址（原文已写“已随批 1c 全部出户”）' },
  { file: 'lib/subpackage-boot.js', line: 100, path: 'lib/components', why: '迁移历史：P-F 出户前后的对照写法（`旧 → 新`）' },
  { file: 'lib/subpackage-boot.js', line: 147, path: 'lib/components/about-notice/index.js', why: '迁移历史：“原 `lib/components/...`”' },
  { file: 'lib/subpackage-boot.js', line: 168, path: 'lib/components/mascot-avatar/index.js', why: '迁移历史：出户前地址对照' },
  { file: 'lib/subpackage-boot.js', line: 193, path: 'lib/components/media-bridge/index.js', why: '迁移历史：出户前地址对照' },
  { file: 'packages/about-notice/lib/index.js', line: 2, path: 'lib/components/about-notice', why: '迁移历史：`旧 → 新` 的对照' },
  { file: 'packages/mascot-avatar/lib/index.js', line: 2, path: 'lib/components/mascot-avatar', why: '迁移历史：`旧 → 新` 的对照' },
  { file: 'packages/media-bridge/lib/index.js', line: 3, path: 'lib/components/media-bridge', why: '迁移历史：`旧 → 新` 的对照' },
  { file: 'packages/fx/lib/index.js', line: 16, path: 'lib/components', why: '描述子包入口形状时引用的旧目录名（同族包现在都在 packages/<pkg>/lib/）' },
  { file: 'packages/parallax/lib/index.js', line: 17, path: 'lib/components', why: '同上' },
  { file: 'packages/pet-link/lib/index.js', line: 98, path: 'assets/config.jsonc', why: '指的是第三方包 dsh-pet-dshwe 自带的 assets（同句已点名该包），不是本仓文件' },
  { file: 'CONTRIBUTING.md', path: 'lib/bin.js', why: '指的是 DSH CLI 自己的入口文件（`<DSH CLI lib/bin.js 路径>`），不是本仓文件' },
  // —— ADR 里的**历史类**引用：正文明确写出“旧址→新址/已删除”，属决策当时的锚点，按方针不动 ——
  { file: 'docs/adr/0013-bundle-multi-component-rows.md', line: 166, path: 'lib/components', why: '决策正文里的“旧址 → packages/<pkg>/lib/”（同句已写明 P-F 起统一到新址）' },
  { file: 'docs/adr/0014-subpackage-contract.md', line: 25, path: 'lib/components', why: '术语定义：区分“组件行（旧形态）”与“独立子包行”；同段已写明该形态已不存在' },
  { file: 'docs/adr/0014-subpackage-contract.md', line: 28, path: 'lib/components', why: '同上（判据面的历史描述）' },
  { file: 'docs/adr/0014-subpackage-contract.md', line: 36, path: 'lib/components', why: '同段已写“lib/components/ 目录已删除”' },
  { file: 'docs/adr/0014-subpackage-contract.md', line: 106, path: 'lib/components', why: '同句已写“2026-10-16 起仓里已无此形态”' },
  { file: 'docs/adr/0015-glass-surface-ownership.md', line: 12, path: 'src/styles-sidebar.js', why: '同句已写“第三处 src/styles-sidebar.js 已删除”' },
  { file: 'docs/adr/0016-glass-subpackage.md', line: 11, path: 'src/glass.js', why: 'Context 描述的是“自 ADR-0008 起住在主包”的**旧状**，Decision 才是出户' },
  { file: 'docs/adr/0016-glass-subpackage.md', line: 11, path: 'src/glass-surfaces.js', why: '同上（旧状锚点）' },
  { file: 'docs/adr/0016-glass-subpackage.md', line: 12, path: 'src/glass-extra.js', why: '同上（旧状锚点）' },
  { file: 'docs/adr/0016-glass-subpackage.md', line: 12, path: 'src/glass-panel.js', why: '同上（旧状锚点）' },
];
const ignored = (file, p) => IGNORE.some((x) => x.file === file && x.path === p);
const NUM_RE = /\b\d[\d,]{2,}\s*(行|条|个|份|处)/g;
const LINK_RE = /\]\((?!https?:|mailto:|#)([^)\s]+)\)/g;
const LINE_RE = /([A-Za-z0-9_./-]+\.(?:js|mjs|json|md)):(\d{1,6})(?:-(\d{1,6}))?/g;

const findings = { stalePath: [], brokenLink: [], staleAnchor: [], driftingNumber: [], parity: [], history: [] };
/** 历史账：日期、issue 编号、"本次/原先/现已" 这类**仅记录改动**的措辞（ADR-0006 D2 的写作约定）。 */
const HISTORY_RE = /(20\d\d-\d\d-\d\d|issue #\d+|（#\d{2,4}(?![0-9a-fA-F])|PR #\d+)/g;
/** 构建产物：它们的注释来自源文件，重算即可 —— 不参与注释审计（否则同一处会报两遍）。 */
const GEN_ARTIFACT = /(^|\/)lib\/client(\.[a-z0-9-]+)?\.js$/;
/** `packages/<pkg>/**` 里的相对路径既可以相对仓库根、也可以相对包目录（`client.build.json` 就是后者）。 */
function existsAny(p, fromFile) {
  const cands = [join(ROOT, p)];
  const m = fromFile.match(/^packages\/([^/]+)\//);
  if (m) cands.push(join(ROOT, 'packages', m[1], p));
  return cands.some((c) => existsSync(c));
}
const add = (kind, file, line, text, extra) => findings[kind].push({ file, line, text, ...(extra || {}) });

for (const abs of docsFiles) {
  const file = rel(abs);
  const cat = category(file);
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(PATH_RE)) {
      const p = m[1] + (m[2] || '');
      if (skipPath(p) || truncatedAt(line, m.index, m[0].length) || PLACEHOLDER.test(p) || ARTIFACT_NAME.test(p)) continue;
      if (foreignContext(line, m.index)) continue;
      if (ignored(file, p)) continue;
      if (!existsAny(p, file)) add('stalePath', file, i + 1, p, { cat });
    }
    if (file.endsWith('.md')) {
      for (const m of line.matchAll(LINK_RE)) {
        let t = m[1];
        if (/^[a-z]+:/.test(t) || t.startsWith('#')) continue;
        const hash = t.indexOf('#');
        if (hash >= 0) t = t.slice(0, hash);
        if (!t || /[*<>{}$]/.test(t)) continue;
        const target = t.startsWith('/') ? join(ROOT, t) : join(dirname(abs), t);
        if (!existsSync(target)) add('brokenLink', file, i + 1, m[1], { cat });
      }
      if (cat === 'current') {
        // LINE_RE：`path:123` 的行号锚 —— 文件存在但行号超出文件长度 ⇒ 锚漂了（ADR-0017 D1 要求锚到符号）
        for (const m of line.matchAll(LINE_RE)) {
          const p = m[1];
          const n = Math.max(Number(m[2]), Number(m[3] || 0));
          if (skipPath(p) || PLACEHOLDER.test(p)) continue;
          if (!existsAny(p, file)) continue;
          const cand = [join(ROOT, p)];
          const pm = file.match(/^packages\/([^/]+)\//);
          if (pm) cand.push(join(ROOT, 'packages', pm[1], p));
          const real = cand.find((c) => existsSync(c));
          let lines = 0;
          try { lines = readFileSync(real, 'utf8').split(/\r?\n/).length; } catch { lines = 0; }
          if (lines > 0 && n > lines) add('staleAnchor', file, i + 1, m[0], { cat });
        }
        for (const m of line.matchAll(NUM_RE)) {
          add('driftingNumber', file, i + 1, m[0].trim(), { cat });
        }
        for (const m of line.matchAll(HISTORY_RE)) add('history', file, i + 1, m[0], { cat });
      }
    }
  });
}

// 源码注释：只报**路径失效**（数值与文案属作者判断，不做机器结论）
for (const abs of codeFiles) {
  const file = rel(abs);
  if (GEN_ARTIFACT.test(file)) continue;
  const text = readFileSync(abs, 'utf8');
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(PATH_RE)) {
      const p = m[1] + (m[2] || '');
      if (skipPath(p) || truncatedAt(line, m.index, m[0].length) || PLACEHOLDER.test(p) || ARTIFACT_NAME.test(p)) continue;
      if (foreignContext(line, m.index) || ignored(file, p)) continue;
      if (!existsAny(p, file)) add('stalePath', file, i + 1, p, { cat: 'comment' });
    }
    const cmt = /^\s*(\/\/|\*|\/\*)/.test(line) ? line : line.slice(Math.max(0, line.lastIndexOf('//')));
    for (const m of cmt.matchAll(HISTORY_RE)) add('history', file, i + 1, m[0], { cat: 'comment' });
    // 注释里的行号锚：只报**确定超界**的（文件存在且行号大于文件长度）
    for (const m of line.matchAll(LINE_RE)) {
      const p = m[1];
      const n = Math.max(Number(m[2]), Number(m[3] || 0));
      if (skipPath(p) || PLACEHOLDER.test(p) || ARTIFACT_NAME.test(p)) continue;
      const cand = [join(ROOT, p)];
      const pm = file.match(/^packages\/([^/]+)\//);
      if (pm) cand.push(join(ROOT, 'packages', pm[1], p));
      const real = cand.find((c) => existsSync(c));
      if (!real) continue;
      const lines2 = readFileSync(real, 'utf8').split(/\r?\n/).length;
      if (n > lines2) add('staleAnchor', file, i + 1, m[0], { cat: 'comment' });
    }
  });
}

// 中英成对（用户文档）
for (const name of USER_DOCS) {
  const zh = 'docs/' + name;
  const en = 'docs/en/' + name;
  if (existsSync(join(ROOT, zh)) !== existsSync(join(ROOT, en))) {
    add('parity', zh, 0, existsSync(join(ROOT, zh)) ? '缺英文版：' + en : '缺中文版：' + zh, { cat: 'current' });
  }
}

const summary = Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length]));
const byCat = {};
for (const [kind, list] of Object.entries(findings)) for (const it of list) byCat[it.cat] = (byCat[it.cat] || 0) + 1;

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, byCat, findings }, null, 2));
  process.exit(0);
}

console.log('文档/注释审计（只读）');
console.log('总览：' + JSON.stringify(summary) + ' · 按类：' + JSON.stringify(byCat));
const groups = [
  ['stalePath', '现行文档/注释里失效的路径'],
  ['brokenLink', '断掉的中文相对链接'],
  ['staleAnchor', '行号锚已超出文件长度（应改锚符号）'],
  ['driftingNumber', '现行文档里的会漂数值'],
  ['parity', '中英不成对'],
  ['history', '历史账：日期 / issue·PR 编号'],
];
for (const [kind, title] of groups) {
  const list = findings[kind];
  if (!list.length) continue;
  console.log('');
  console.log('## ' + title + '（' + list.length + '）');
  const current = list.filter((x) => x.cat === 'current' || x.cat === 'comment');
  const adrs = list.filter((x) => x.cat === 'adr');
  const ledgers = list.filter((x) => x.cat === 'ledger' || x.cat === 'generated');
  for (const it of current.slice(0, MAX)) console.log('  · ' + it.file + ':' + it.line + '  ' + it.text);
  if (current.length > MAX) console.log('  … 另有 ' + (current.length - MAX) + ' 条（--max 调整）');
  if (adrs.length) {
    console.log('  [ADR：方针不改、结论类可校正] ' + adrs.length + ' 条');
    for (const it of adrs.slice(0, MAX)) console.log('    · ' + it.file + ':' + it.line + '  ' + it.text);
  }
  if (ledgers.length) console.log('  [账本/生成物，按 ADR-0017 D4 不追溯] ' + ledgers.length + ' 条');
}
