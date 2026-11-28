#!/usr/bin/env node
/**
 * move-src-module.mjs — 把 src/ 下的一个模块搬到新位置（机械搬迁的唯一入口）。
 *
 * 搬一个模块要同步改五处：INLINE_MODULES 条目（路径，顺序不动）、test/ 的路径字面量、
 * scripts/ 的路径字面量、src/ 注释里的互引、docs/ 的现行文档。前四类不报错（只会悄悄变成
 * 错的话，或让守卫读不到文件而恒假），所以收进一个工具；人只负责改文档措辞和跑守卫。
 *
 * 不做什么：不改函数体、不重排 INLINE_MODULES（TDZ 与组装点靠顺序）、不重写 CHANGELOG 与
 * docs/archive（历史记录，按 ADR-0017 保留原文）。
 *
 * Usage:
 *   node test/tools/move-src-module.mjs <old> <new>           # 试跑，只报告
 *   node test/tools/move-src-module.mjs <old> <new> --apply   # 真搬
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const oldRel = argv[0];
const newRel = argv[1];

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
      } else out.push(relative(ROOT, p).split(String.fromCharCode(92)).join('/'));
    }
  };
  rec(abs(dir));
  return out;
}

if (!oldRel || !newRel) die('用法：node test/tools/move-src-module.mjs <old> <new> [--apply]');
for (const p of [oldRel, newRel]) {
  if (!p.startsWith('src/') || !p.endsWith('.js')) die('路径必须形如 src/<...>.js：' + p);
}
if (oldRel === 'src/client.js') die('src/client.js 是正文，不能搬（clientSources() 硬编码它）');
if (oldRel === newRel) die('新旧路径相同');
if (!existsSync(abs(oldRel))) die('源文件不存在：' + oldRel);
if (existsSync(abs(newRel))) die('目标已存在：' + newRel);
const newDir = dirname(newRel);
if (!existsSync(abs(newDir))) console.log('[warn] 目标目录不存在（--apply 会创建）：' + newDir);

// ① INLINE_MODULES 条目
const BUILD = 'scripts/build-client.mjs';
const buildText = readFileSync(abs(BUILD), 'utf8');
const entryNeedle = "file: '" + oldRel + "'";
const entryHits = buildText.split(entryNeedle).length - 1;
console.log('① INLINE_MODULES 条目：' + entryHits + ' 处' + (entryHits === 1 ? '（正常）' : entryHits === 0 ? '（未登记？）' : '（重复！）'));

// ② 完整路径字面量 / ③ 分段写法 / ④ 文档命中
const files = [...new Set([...['test', 'scripts', 'src'].flatMap((d) => (existsSync(abs(d)) && statSync(abs(d)).isDirectory() ? walk(d) : [])), BUILD])]
  .filter((f) => f.endsWith('.mjs') || f.endsWith('.js')).filter((f) => f !== oldRel);
const lit = [];
const split = [];
for (const f of files) {
  const text = readFileSync(abs(f), 'utf8');
  const n = text.split(oldRel).length - 1;
  if (n) lit.push(f + '×' + n);
  if (text.includes("'src', '" + base(oldRel) + "'")) split.push(f);
}
console.log('② 完整路径字面量：' + (lit.length ? lit.join(' · ') : '无'));
console.log('③ 分段写法（\'src\', \'' + base(oldRel) + '\'）：' + (split.length ? split.join(' · ') : '无'));
const HIST = ['docs/archive', 'docs/changelog', 'docs/en/changelog'];
const HEXTRA = ['docs/CHANGELOG.md', 'docs/en/CHANGELOG.md'];
const docs = existsSync(abs('docs')) ? walk('docs').filter((f) => f.endsWith('.md'))
  .filter((f) => !HIST.some((h) => f.startsWith(h)) && !HEXTRA.includes(f)) : [];
const docHits = [];
for (const f of docs) {
  const n = readFileSync(abs(f), 'utf8').split(oldRel).length - 1;
  if (n) docHits.push(f + '×' + n);
}
console.log('④ 现行文档命中（人工改措辞）：' + (docHits.length ? docHits.join(' · ') : '无'));
console.log('   （CHANGELOG / docs/changelog / docs/archive 按 ADR-0017 不重写，已排除）');

if (!APPLY) {
  console.log('');
  console.log('[试跑] 加 --apply 才真搬。搬完依次跑：npm run build → node test/run-guards.mjs verify → node test/run-guards.mjs docs');
  process.exit(0);
}

// ⑤ 真搬
if (!existsSync(abs(newDir))) mkdirSync(abs(newDir), { recursive: true });
const gitMv = spawnSync('git', ['mv', oldRel, newRel], { cwd: ROOT, encoding: 'utf8' });
if (gitMv.status !== 0) {
  console.warn('[warn] git mv 失败，退回 renameSync：' + String(gitMv.stderr || '').trim());
  renameSync(abs(oldRel), abs(newRel));
}
if (entryHits === 1) {
  writeFileSync(abs(BUILD), buildText.replace(entryNeedle, "file: '" + newRel + "'"));
} else {
  console.warn('[warn] INLINE_MODULES 条目不是 1 处，未自动改 —— 请人工核对');
}
const dirParts = newRel.split('/').slice(1, -1);
const b = base(oldRel);
const joinWith = (q) => q + ['src', ...dirParts, b].join(q + ', ' + q) + q;
const rewrite = (text) => {
  let out = text.split(oldRel).join(newRel);
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
console.log('[move] ' + oldRel + ' → ' + newRel + '（改了 ' + (changed + (entryHits === 1 ? 1 : 0)) + ' 个文件）');
console.log('下一步：改④里的现行文档 → npm run build → 守卫链 → 重算 GUARD-MAP/ROUTE-INDEX → 一个纯搬移 commit');
