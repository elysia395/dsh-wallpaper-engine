#!/usr/bin/env node
/**
 * move-src-module.mjs — 把 src/ 下的一个模块搬到新位置（机械搬迁的唯一入口）。
 *
 * 搬一个模块要同步改六处：INLINE_MODULES 条目（路径，顺序不动）、test/ · scripts/ · src/ · lib/ 的
 * 路径字面量（含正则里的转义写法 src\/x\.js）、docs/ 的现行文档。前五类不报错（只会悄悄变成错的
 * 话，或让守卫读不到文件而恒假），所以收进一个工具；人只负责改文档措辞和跑守卫。
 *
 * 不做什么：不改函数体、不重排 INLINE_MODULES（TDZ 与组装点靠顺序）、不重写 CHANGELOG 与
 * docs/archive（历史记录，按 ADR-0017 保留原文）。
 *
 * Usage:
 *   node test/tools/move-src-module.mjs <old> <new>                    # 试跑，只报告
 *   node test/tools/move-src-module.mjs <old> <new> --apply            # 真搬（含字面量改写）
 *   node test/tools/move-src-module.mjs <old> <new> --rewrite-only --apply  # 已搬完，只补改写
 *
 * ⚠️ 受限沙箱里本工具 spawn git 会 EPERM：它会退回 renameSync，此时**必须自己**跑 `git add -A`
 *    把删除与新增入索引，否则 `git ls-files` 还指着旧路径（verify-eol 会当场判红）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const REWRITE_ONLY = process.argv.includes('--rewrite-only');
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const oldRel = argv[0];
const newRel = argv[1];
const BS = String.fromCharCode(92);

const die = (msg) => { console.error('[move-src-module] ' + msg); process.exit(1); };
const abs = (p) => join(ROOT, p);
const base = (p) => p.split('/').pop();

function walk(dir) {
  const out = [];
  const rec = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', '.artifacts', '.test-cache'].includes(e.name)) continue;
        rec(p);
      } else out.push(relative(ROOT, p).split(BS).join('/'));
    }
  };
  rec(abs(dir));
  return out;
}

/** 一个路径在源码里的三种写法：原样 / 正则里转义斜杠 / 再转义点号。 */
function variants(p) {
  const slash = p.split('/').join(BS + '/');
  return [p, slash, slash.split('.').join(BS + '.')];
}

if (!oldRel || !newRel) die('用法：node test/tools/move-src-module.mjs <old> <new> [--apply] [--rewrite-only]');
for (const p of [oldRel, newRel]) {
  if (!p.startsWith('src/') || !p.endsWith('.js')) die('路径必须形如 src/<...>.js：' + p);
}
if (oldRel === 'src/client.js') die('src/client.js 是正文，不能搬（clientSources() 硬编码它）');
if (oldRel === newRel) die('新旧路径相同');
if (REWRITE_ONLY) {
  if (!existsSync(abs(newRel))) die('--rewrite-only 要求新文件已存在：' + newRel);
} else {
  if (!existsSync(abs(oldRel))) die('源文件不存在：' + oldRel);
  if (existsSync(abs(newRel))) die('目标已存在：' + newRel);
}
const newDir = dirname(newRel);
if (!REWRITE_ONLY && !existsSync(abs(newDir))) console.log('[warn] 目标目录不存在（--apply 会创建）：' + newDir);

// ① INLINE_MODULES 条目
const BUILD = 'scripts/build-client.mjs';
const buildText = readFileSync(abs(BUILD), 'utf8');
const entryNeedle = "file: '" + oldRel + "'";
const entryHits = buildText.split(entryNeedle).length - 1;
console.log('① INLINE_MODULES 旧条目：' + entryHits + ' 处' + (entryHits === 1 ? '（正常）' : entryHits === 0 ? '（已改过 / 未登记）' : '（重复！）'));

// ② 字面量（test / scripts / src / lib）
const SCAN = ['test', 'scripts', 'src', 'lib'];
const files = [...new Set([...SCAN.flatMap((d) => (existsSync(abs(d)) && statSync(abs(d)).isDirectory() ? walk(d) : [])), BUILD])]
  .filter((f) => f.endsWith('.mjs') || f.endsWith('.js')).filter((f) => f !== oldRel)
  // 生成物不算源码：lib/client.js 由 scripts/build-client.mjs 产出，改它没有意义（下次构建就覆盖）
  .filter((f) => f !== 'lib/client.js');
const lit = [];
for (const f of files) {
  const text = readFileSync(abs(f), 'utf8');
  let n = 0;
  for (const v of variants(oldRel)) n += text.split(v).length - 1;
  if (n) lit.push(f + '×' + n);
}
console.log('② 路径字面量（含正则转义写法）：' + (lit.length ? lit.join(' · ') : '无'));
const splitNeedle = "'src', '" + base(oldRel) + "'";
const split = files.filter((f) => readFileSync(abs(f), 'utf8').includes(splitNeedle));
console.log("③ 分段写法（'src', '" + base(oldRel) + "'）：" + (split.length ? split.join(' · ') : '无'));

// ③ docs 命中（只报告）
const HIST = ['docs/archive', 'docs/changelog', 'docs/en/changelog'];
const HEXTRA = ['docs/CHANGELOG.md', 'docs/en/CHANGELOG.md'];
const docs = existsSync(abs('docs')) ? walk('docs').filter((f) => f.endsWith('.md'))
  .filter((f) => !HIST.some((h) => f.startsWith(h)) && !HEXTRA.includes(f)) : [];
const docHits = [];
for (const f of docs) {
  const text = readFileSync(abs(f), 'utf8');
  const n = variants(oldRel).reduce((a, v) => a + text.split(v).length - 1, 0);
  if (n) docHits.push(f + '×' + n);
}
console.log('④ 现行文档命中（人工改措辞）：' + (docHits.length ? docHits.join(' · ') : '无'));
console.log('   （CHANGELOG / docs/changelog / docs/archive 按 ADR-0017 不重写，已排除）');

if (!APPLY) {
  console.log('');
  console.log('[试跑] 加 --apply 才改。改完依次跑：npm run build → node test/run-guards.mjs verify → node test/run-guards.mjs docs');
  process.exit(0);
}

// ④ 真搬
if (!REWRITE_ONLY) {
  if (!existsSync(abs(newDir))) mkdirSync(abs(newDir), { recursive: true });
  const gitMv = spawnSync('git', ['mv', oldRel, newRel], { cwd: ROOT, encoding: 'utf8' });
  if (gitMv.status !== 0) {
    console.warn('[warn] git mv 不可用（' + String(gitMv.error ? gitMv.error.code : gitMv.status) + '），退回 renameSync —— 搬完请自己跑 git add -A');
    renameSync(abs(oldRel), abs(newRel));
  }
}
if (entryHits === 1) {
  writeFileSync(abs(BUILD), buildText.replace(entryNeedle, "file: '" + newRel + "'"));
}

const dirParts = newRel.split('/').slice(1, -1);
const b = base(oldRel);
const joinWith = (q) => q + ['src', ...dirParts, b].join(q + ', ' + q) + q;
const rewrite = (text) => {
  let out = text;
  const ov = variants(oldRel);
  const nv = variants(newRel);
  for (let i = 0; i < ov.length; i++) out = out.split(ov[i]).join(nv[i]);
  if (dirParts.length) {
    out = out.split("'src', '" + b + "'").join(joinWith("'"));
    out = out.split('"src", "' + b + '"').join(joinWith('"'));
  }
  return out;
};
let changed = 0;
for (const f of files) {
  const before = readFileSync(abs(f), 'utf8');
  const after = rewrite(before);
  if (after === before) continue;
  writeFileSync(abs(f), after);
  changed++;
}
console.log('');
console.log('[move] ' + oldRel + ' → ' + newRel + '（改了 ' + changed + ' 个文件）');
console.log('下一步：改④里的现行文档 → npm run build → 守卫链 → 重算 GUARD-MAP/ROUTE-INDEX → 一个纯搬移 commit');
