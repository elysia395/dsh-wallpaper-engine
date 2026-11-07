#!/usr/bin/env node
/**
 * compare-bundle.mjs — 构建产物「搬目录前后逐字节相同」判据的可复跑版本。
 *
 * 背景：`lib/client.js` 由 `scripts/build-client.mjs` 在构建期内联各模块正文，**不嵌路径**
 * （B1–B4 的 `src/` 目录化正是靠这条判据证明零行为改动）。当时的比对用未入库的草稿脚本完成、
 * 产物坐标未留存 ⇒ `docs/CHANGELOG.md` 里的历史字节数不可事后复算；本脚本把判据固定下来。
 *
 * 用法：
 *   node scripts/compare-bundle.mjs --before <旧产物> --after <新产物> \
 *        --map <旧路径>=<新路径> [--map ...] [--verbose]
 *   node scripts/compare-bundle.mjs --selftest
 *
 * 语义：把 `--after` 里出现的**新路径**逐条换回**旧路径**（长串优先，避免前缀误替换），
 * 行尾统一成 LF 后与 `--before` 逐字节比较。exit 0 = 相同；1 = 不同；2 = 用法/IO 错误。
 *
 * 例（B1：styles/panel-tabs 归目录）：
 *   node scripts/compare-bundle.mjs --before .test-cache/base/lib/client.js --after lib/client.js \
 *     --map src/styles-base.js=src/styles/base.js --map src/styles-shell.js=src/styles/shell.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USAGE = `usage: node scripts/compare-bundle.mjs --before <file> --after <file> --map old=new [--map ...] [--verbose]
       node scripts/compare-bundle.mjs --selftest`;

function fail(msg) {
  console.error('compare-bundle: ' + msg);
  console.error(USAGE);
  process.exit(2);
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    fail('读不到文件 ' + p + ': ' + e.message);
  }
}

function lf(text) {
  return text.replace(/\r\n/g, '\n');
}

function normalize(afterText, maps) {
  const sorted = maps.slice().sort((a, b) => b.to.length - a.to.length);
  const used = new Map(sorted.map((m) => [m.to, 0]));
  let out = afterText;
  for (const m of sorted) {
    let count = 0;
    // 按字面量切分，避免正则元字符；只替换完整出现，不做大小写/边界猜测。
    const parts = out.split(m.to);
    count = parts.length - 1;
    out = parts.join(m.from);
    used.set(m.to, count);
  }
  return { text: out, used };
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function parseMaps(argv) {
  const maps = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--map') continue;
    const spec = argv[i + 1];
    const eq = spec ? spec.indexOf('=') : -1;
    if (eq <= 0 || eq === spec.length - 1) fail('--map 需要 old=new 形式：' + spec);
    maps.push({ from: spec.slice(0, eq), to: spec.slice(eq + 1) });
  }
  if (!maps.length) fail('至少给一条 --map（旧路径=新路径）');
  return maps;
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-bundle-'));
  const w = (name, text) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, text);
    return p;
  };
  const before = w('before.js', '/* a */\nconst x = "src/styles-base.js";\n');
  const same = w('same.js', '/* a */\nconst x = "src/styles-base.js";\n');
  const moved = w('moved.js', '/* a */\nconst x = "src/styles/base.js";\n');
  const drifted = w('drifted.js', '/* b */\nconst x = "src/styles/base.js";\n');
  const map = [{ from: 'src/styles-base.js', to: 'src/styles/base.js' }];

  const eq = normalize(lf(readText(moved)), map).text === lf(readText(before));
  const eqSame = normalize(lf(readText(same)), map).text === lf(readText(before));
  const neDrift = normalize(lf(readText(drifted)), map).text !== lf(readText(before));
  // 长串优先：只给 a→b 与 a/x→a/y 时，"a/y" 必须整体命中，不能被 "a"→"b" 先啃掉。
  const overlap = normalize('pre a/y post', [
    { from: 'a', to: 'b' },
    { from: 'a/x', to: 'a/y' },
  ]);
  const overlapOk = overlap.text === 'pre a/x post' && overlap.used.get('a/y') === 1;
  fs.rmSync(dir, { recursive: true, force: true });

  const checks = [
    ['搬目录后归一化 = 相同', eq],
    ['未搬动的产物 = 相同', eqSame],
    ['正文漂移 = 判为不同', neDrift],
    ['长串优先（前缀 map 不误伤）', overlapOk],
  ];
  let bad = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
    if (!ok) bad += 1;
  }
  if (bad) {
    console.error('compare-bundle selftest: ' + bad + ' 项失败');
    process.exit(1);
  }
  console.log('compare-bundle selftest: all ' + checks.length + ' checks passed');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    selftest();
    return;
  }
  const verbose = argv.includes('--verbose');
  const ri = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  const beforePath = ri('--before');
  const afterPath = ri('--after');
  if (!beforePath || !afterPath) fail('需要 --before 与 --after');
  const maps = parseMaps(argv);

  const before = lf(readText(beforePath));
  const rawAfter = lf(readText(afterPath));
  const { text: normalized, used } = normalize(rawAfter, maps);

  if (verbose) {
    for (const m of maps) {
      console.log('[map] ' + m.to + ' -> ' + m.from + '  (' + used.get(m.to) + ' 处)');
    }
  }
  const unused = maps.filter((m) => used.get(m.to) === 0);
  if (unused.length) {
    console.error('警告：以下新路径在 --after 里 0 次命中（map 写错或该批未搬）：' +
      unused.map((m) => m.to).join(', '));
  }

  const diff = firstDiff(before, normalized);
  if (diff === -1) {
    console.log('OK  归一化后逐字节相同（before ' + Buffer.byteLength(before) +
      ' B / after ' + Buffer.byteLength(rawAfter) + ' B，替换 ' +
      maps.reduce((n, m) => n + used.get(m.to), 0) + ' 处）');
    return;
  }
  const beforeLine = readText(beforePath).split('\n')[lineOf(before, diff) - 1] || '';
  const afterLine = rawAfter.split('\n')[lineOf(normalized, diff) - 1] || '';
  console.error('DIFF  首个不同在偏移 ' + diff + '（before 行 ' + lineOf(before, diff) +
    ' / after 行 ' + lineOf(normalized, diff) + '）');
  console.error('  before: ' + beforeLine.slice(0, 160));
  console.error('  after : ' + afterLine.slice(0, 160));
  process.exit(1);
}

main();
