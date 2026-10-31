#!/usr/bin/env node
/**
 * verify-pet-tuner-coverage.mjs —— 「面板旋钮必须真的被排播消费」判据。
 *
 * ══ 为什么需要 ════════════════════════════════════════════════════════════════
 * M6 的面板把旧版约 50 个旋钮全摆了出来，但 M5 的排播实现只消费了其中一部分。
 * 结果是「能调、能存、能导出，但调了没有任何效果」——旋钮造假比缺功能更难查，
 * 因为界面上一切正常、参数也会持久化，只有真机跑起来手感不对。
 *
 * 本判据把「死旋钮」变成**可机判的红**：panel-params 里出现的每个 key，
 * 都必须在排播源码里被 `tune('<key>')` 读取一次。
 *
 * ══ 口径 ══════════════════════════════════════════════════════════════════════
 *   · 参数真源 = `src/pet-link/panel-params.js` 的 `key: '<name>'`；
 *   · 消费面 = `src/pet-link/*.js` 里除 panel-params / panel / i18n 之外的文件
 *     （panel 只负责画 DOM，读 key 不等于消费；i18n 只放词表）；
 *   · 判定 = 出现 `tune('<key>')`（严格：这是 M5/M6 约定的取值入口，
 *     宽松匹配 `'<key>'` 会把定义处自己算成消费点）。
 *
 * ══ 允许的例外 ════════════════════════════════════════════════════════════════
 * 只允许「纯展示、无排播语义」的键登记在这里，且必须写明理由 + 在源码里标注。
 * 例外的存在本身就是欠账；登记一条就该有人问「为什么不删掉这个旋钮」。
 *
 * @module wallpaper-engine/test/verify-pet-tuner-coverage
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'packages', 'pet-link', 'src');
const PET_DIR = join(SRC, 'pet-link');

/** 只画 DOM / 只放词表的文件，不算消费面。 */
const NON_CONSUMERS = new Set(['panel-params.js', 'panel.js', 'i18n.js']);

/** 允许「面板有、排播无」的键：必须写明理由。空表是目标状态。 */
const DISPLAY_ONLY_WHY = Object.freeze({
  // 例：'someKey': '纯展示元数据，不参与排播（若长期无消费应直接删除该旋钮）',
});

const paramsSource = readFileSync(join(PET_DIR, 'panel-params.js'), 'utf8');
const keys = [...paramsSource.matchAll(/key:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
if (keys.length === 0) {
  console.error('✗ 判据失效：panel-params.js 里一个 key 都没解析到（正则或结构变了）');
  process.exit(1);
}
if (new Set(keys).size !== keys.length) {
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  console.error('✗ panel-params.js 存在重复 key：' + [...new Set(dup)].join(', '));
  process.exit(1);
}

const consumerFiles = readdirSync(PET_DIR)
  .filter((f) => f.endsWith('.js') && !NON_CONSUMERS.has(f))
  .sort();
if (consumerFiles.length === 0) {
  console.error('✗ 判据失效：找不到任何排播源码文件（目录结构变了）');
  process.exit(1);
}
const consumerSource = consumerFiles.map((f) => readFileSync(join(PET_DIR, f), 'utf8')).join('\n');

const consumed = [];
const dead = [];
for (const key of keys) {
  const hit = new RegExp("tune\\(\\s*'" + key + "'").test(consumerSource);
  (hit ? consumed : dead).push(key);
}

const unexpectedDead = dead.filter((k) => !(k in DISPLAY_ONLY_WHY));
const staleException = Object.keys(DISPLAY_ONLY_WHY).filter((k) => !keys.includes(k));

console.log('参数真源：' + keys.length + ' 个 key（panel-params.js）');
console.log('消费面：' + consumerFiles.join(', '));
console.log('已消费：' + consumed.length + ' 个');
for (const key of consumed) console.log('  ✓ ' + key);

let bad = 0;
if (unexpectedDead.length > 0) {
  bad += 1;
  console.error('\n✗ 死旋钮（面板能调、排播从不读取）：' + unexpectedDead.length + ' 个');
  for (const key of unexpectedDead) console.error('  ✗ ' + key);
  console.error('  → 二选一：把该参数真正接进排播，或从面板删除这个旋钮。不许留骗人的旋钮。');
}
if (staleException.length > 0) {
  bad += 1;
  console.error('\n✗ 例外表空转（登记了但面板里已没有该键）：' + staleException.join(', '));
}

if (bad > 0) {
  console.error('\nTUNER COVERAGE FAILED — ' + bad + ' 类问题');
  process.exit(1);
}
console.log('\n✓ 全部 ' + keys.length + ' 个旋钮都有排播消费者（无一死旋钮）');