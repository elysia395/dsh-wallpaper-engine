/**
 * src-scope.mjs — **构建期内联族**的共享读法（守卫用）。
 *
 * 浏览器半边的模块不是 ESM：`scripts/build-client.mjs` 按 `INLINE_MODULES` 的顺序把各文件
 * **原样内联进同一个工厂作用域**，模块之间不 import、靠扁平符号协作（见 docs/CODE-STRUCTURE.md §3）。
 * 所以"某个符号住在哪个文件"对守卫不是重点，重点是**同族文件按注册顺序拼起来**就是运行时的真实作用域。
 *
 * 单一真源：清单本身从 `scripts/build-client.mjs` 解析（不在这里抄第二份）——
 *   ① 新增模块只登记一次：构建与守卫读法一起跟上；
 *   ② 守卫读到的顺序**就是**构建期内联的顺序（键序、常量可见性都由它决定）。
 *
 * API 冻结（`test/tools/guard-targets.mjs` 按这三个名字识别前缀族读法；改签名要先协调 owner）：
 *   · parseInlineModules()      → [{ file, markers }]，顺序 = 构建顺序
 *   · scopeFiles(prefix)        → 路径数组（工作区相对、正斜杠），顺序 = 构建顺序
 *   · scopeText(prefix, sep?)   → 各文件全文按序拼接（默认 '\n;\n'，保持语句边界）
 *
 * 空族必须抛错：守卫拿到空集就会"静默全绿"，那正是本仓最不想要的失败形态。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILD_SCRIPT = join(ROOT, 'scripts', 'build-client.mjs');

/** 解析 `scripts/build-client.mjs` 的 INLINE_MODULES 清单（顺序即构建期内联顺序）。 */
export function parseInlineModules() {
  const src = readFileSync(BUILD_SCRIPT, 'utf8');
  const at = src.indexOf('const INLINE_MODULES = [');
  if (at < 0) throw new Error('src-scope: scripts/build-client.mjs 里找不到 `const INLINE_MODULES = [`');
  const end = src.indexOf('\n];', at);
  if (end < 0) throw new Error('src-scope: INLINE_MODULES 清单没有收尾 `\\n];`');
  const entries = [];
  for (const chunk of src.slice(at, end).split(/\n {2}\{/).slice(1)) {
    const file = chunk.match(/file:\s*'([^']+)'/);
    if (!file) continue;
    const mk = chunk.match(/markers:\s*\[([\s\S]*?)\]/);
    entries.push({
      file: file[1],
      markers: mk ? [...mk[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) : [],
    });
  }
  if (entries.length === 0) throw new Error('src-scope: INLINE_MODULES 解析出 0 条');
  return entries;
}

/** 同族（路径前缀相同）文件，按 INLINE_MODULES 顺序。前缀命中 0 个文件即抛错（防"空族静默全绿"）。 */
export function scopeFiles(prefix) {
  const files = parseInlineModules().map((e) => e.file).filter((f) => f.startsWith(prefix));
  if (files.length === 0) throw new Error('src-scope: 前缀 ' + prefix + ' 在 INLINE_MODULES 里没有命中任何文件');
  return files;
}

/** 同族文件全文按序拼接（`sep` 默认 '\\n;\\n'：跨文件语句边界，与构建期内联同形）。 */
export function scopeText(prefix, sep = '\n;\n') {
  return scopeFiles(prefix).map((f) => readFileSync(join(ROOT, f), 'utf8')).join(sep);
}
