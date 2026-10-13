#!/usr/bin/env node
/**
 * verify-settings-schema-exports.mjs — **内部模块的每个具名导出都必须有消费者**。
 *
 * ── 这条不变量在守什么 ─────────────────────────────────────────────────────────
 * `package.json` 的 `exports` 只放了两个 JS 入口（`.` → `lib/index.js`、`./client` →
 * `lib/client.js`）—— 这两个文件的导出面是**包的对外 API**，可以不问"谁在用"。
 * 其余 `lib/**` 与 `src/**` 模块都**不可由 exports 子路径触达**（`import 'pkg/xxx.js'`
 * 是解析不到的）⇒ 它们是**内部模块**：每个具名导出要么在仓库里真的有人用，要么就是
 * 已经死掉的对外承诺（名字对不上、抽走了调用点、只剩一个 `export` 语句）。
 *
 * 为什么要机械判：死导出**不会自己变红**。删掉最后一个调用点、或者把某段逻辑搬走时，
 * `export { … }` 里那一行谁也不会想起来删 —— 它既不是语法错误，也没有任何判据看得见。
 * 与 `verify-dead-declarations.mjs` 的"声明孤儿"、模块布局守卫的"文件孤儿"是同一族：
 * ① 管没人 import 的文件，② 管没人调用的声明，本判据管**没人消费的导出**。
 *
 * ── 口径（全部**现算**，不维护手抄名单）───────────────────────────────────────
 *   · **公开入口集合**：读 `package.json` 的 `exports`，取出所有以 `.js` 结尾的取值
 *     （既覆盖 `"." : "./lib/index.js"` 这种字符串形态，也覆盖 `{ default: … }` 对象形态）。
 *     在集合里的文件**不判**（那是包的对外 API）。
 *   · **内部模块清单**：扫 `lib/**\/*.js` 与 `src/**\/*.js`（`lib/types/**` 是 .d.ts，不扫）。
 *   · **具名导出**：`export function|class|const|let|var NAME`、`export { A, B as C }`
 *     （`as` 取**右侧**的导出名）、`export { x } from './y.js'`。`export default` 与
 *     `export * from` 不算具名导出（前者匿名，后者的名字由被转出模块自己认领）。
 *   · **消费者**：仓库里任意被跟踪的**代码**文件（`.js/.mjs/.cjs/.ts/.tsx/.jsx`），
 *     **去掉注释后**文本里出现该名字（词边界）即算一次消费。两个例外：
 *       1. **模块自己**（定义/导出语句当然在里面，不算消费）；
 *       2. **构建产物 `lib/client.js`**（它是 `src/**` 内联后的产物，里面出现名字只说明
 *          "构建时同处一个作用域"，不构成独立的消费）。
 *     **注释不算消费**：注释里写个名字谁都能写，`// 见 XXX` 不该把死导出续命
 *     （负对照 ③ 专门钉这一条）。
 *
 * ── 与"删之前先有守卫"的关系 ─────────────────────────────────────────────────
 * 本守卫是**先红后绿**的证据：先跑它、把红的清单原样报出去，**再**去删导出。
 * 反过来（先删再补守卫）等于让删除自己给自己发合格证 —— 那时"红"已经不存在了。
 *
 * Usage:  node test/verify-settings-schema-exports.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './tools/js-text.mjs';
import { createCheck } from './tools/assert-harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { check, stats } = createCheck();

/** 不扫的目录：版本库/依赖/测试缓存/构建产物（产物目录里是同一份代码的副本）。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.test-cache', '.cache', 'dist', 'build', 'coverage', '.dsh']);
/** "被跟踪的代码文件" = 这些扩展名（`.d.ts` 不在内：它是声明产物，不是消费者）。 */
const CODE_EXT = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];
/** 构建产物：`src/**` 内联进它 ⇒ 里面的名字不构成独立消费。 */
const BUILD_PRODUCT = 'lib/client.js';

/** 递归列出扩展名命中的文件（相对 ROOT、POSIX 分隔符、字典序）。 */
function listFiles(absDir, exts, out = []) {
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) listFiles(join(absDir, e.name), exts, out);
      continue;
    }
    if (exts.some((x) => e.name.endsWith(x))) out.push(join(absDir, e.name));
  }
  return out;
}

/** `package.json` 的 `exports` ⇒ 公开入口集合（相对路径；只看 `.js` 取值）。 */
function publicEntriesOf(exportsMap) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.endsWith('.js')) out.add(v.replace(/^\.\//, '')); };
  for (const v of Object.values(exportsMap ?? {})) {
    if (typeof v === 'string') add(v);
    else if (v && typeof v === 'object') for (const vv of Object.values(v)) add(vv);
  }
  return out;
}

const EXPORT_DECL_RE = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_BLOCK_RE = /export\s*\{([\s\S]*?)\}\s*;?/g;

/**
 * 一个模块源码里的**具名导出**名字（字典序）。
 * 先剥注释：注释里的 `export { … }` 不是导出（也不该被当成"有消费者"）。
 */
function namedExports(src) {
  const code = stripComments(String(src));
  const names = new Set();
  let m;
  while ((m = EXPORT_DECL_RE.exec(code))) names.add(m[1]);
  EXPORT_BLOCK_RE.lastIndex = 0;
  while ((m = EXPORT_BLOCK_RE.exec(code))) {
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      // `A as B` ⇒ 导出名是 B；`A` ⇒ A。`export { x } from './y.js'` 同形。
      const name = (p.split(/\s+as\s+/)[1] || p.split(/\s+as\s+/)[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * 判据核心（**纯函数**：正判据与全部负对照都喂进这一个函数，不许另抄一份口径）。
 *
 * @param {{ modules: Map<string,string>, publicSet: Set<string>, consumers: Map<string,string>, buildProduct?: string }} input
 *   `modules`：内部模块路径 → 源码；`publicSet`：豁免的公开入口；
 *   `consumers`：消费者候选路径 → 原始文本（**函数内部剥注释**）。
 * @returns {{ mod: string, name: string }[]} 零消费者的导出（按模块、名字排序）
 */
function zeroConsumerExports({ modules, publicSet, consumers, buildProduct = BUILD_PRODUCT }) {
  const masked = new Map();
  for (const [f, text] of consumers) masked.set(f, stripComments(String(text)));
  const offenders = [];
  for (const [mod, src] of modules) {
    if (publicSet.has(mod)) continue;
    for (const name of namedExports(src)) {
      const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b');
      let used = false;
      for (const [f, text] of masked) {
        if (f === mod || f === buildProduct) continue;
        if (re.test(text)) { used = true; break; }
      }
      if (!used) offenders.push({ mod, name });
    }
  }
  return offenders.sort((a, b) => (a.mod === b.mod ? a.name.localeCompare(b.name) : a.mod.localeCompare(b.mod)));
}

/** 判定器：把 offenders 折成 `{ ok, detail }`（判据文本两处共用，避免两种口径）。 */
function judge(input) {
  const offenders = zeroConsumerExports(input);
  if (!offenders.length) return { ok: true, detail: '0 个零消费者导出' };
  const grouped = new Map();
  for (const o of offenders) grouped.set(o.mod, [...(grouped.get(o.mod) || []), o.name]);
  return {
    ok: false,
    detail: `${offenders.length} 个零消费者导出：`
      + [...grouped].map(([mod, names]) => `${mod} ⇒ ${names.join(' ')}`).join(' · '),
    offenders,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 生产扫描面（现算）
// ══════════════════════════════════════════════════════════════════════════════
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const publicSet = publicEntriesOf(pkg.exports);

const moduleFiles = [...listFiles(join(ROOT, 'lib'), ['.js']), ...listFiles(join(ROOT, 'src'), ['.js'])]
  .map((p) => p.slice(ROOT.length + 1))
  .filter((p) => !p.startsWith('lib/types/') && p !== BUILD_PRODUCT)
  .sort();
const modules = new Map(moduleFiles.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

const consumerFiles = listFiles(ROOT, CODE_EXT)
  .map((p) => p.slice(ROOT.length + 1))
  .filter((p) => !p.startsWith('lib/types/') && !p.startsWith('node_modules/'))
  .sort();
const consumers = new Map(consumerFiles.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

// ── 自检：扫描面非空（空面会让主判据"恒绿"，是最危险的失败形态）──────────────
check('自检：内部模块面非空（lib/** + src/** 现算）', modules.size >= 40, `${modules.size} 个模块`);
check('自检：消费者面非空（仓库代码文件现算）', consumers.size >= 200, `${consumers.size} 个文件`);
check('自检：公开入口集合从 package.json 现算到', publicSet.has('lib/index.js') && publicSet.has('lib/client.js'),
  [...publicSet].join(' '));
check('自检：构建产物（lib/client.js）不在内部模块清单里，且作为消费者面被豁免',
  !modules.has(BUILD_PRODUCT) && publicSet.has(BUILD_PRODUCT), `publicSet=${publicSet.has(BUILD_PRODUCT)}`);

// ── 主判据：内部模块的每个具名导出都必须有消费者 ──────────────────────────────
const prod = judge({ modules, publicSet, consumers });
if (!prod.ok) {
  console.log('  零消费者导出（按模块分组，先红后绿的"红"就是这份清单）：');
  let lastMod = '';
  for (const o of prod.offenders) {
    if (o.mod !== lastMod) { console.log('    ' + o.mod + ':'); lastMod = o.mod; }
    console.log('      · ' + o.name);
  }
}
check('内部模块的每个具名导出都有消费者（不可由 exports 子路径触达 ⇒ 必须有人用）', prod.ok,
  prod.ok ? undefined : `${prod.offenders.length} 个（见上方清单）`);

// ══════════════════════════════════════════════════════════════════════════════
// 负对照 / 正控（喂进**同一条**判据函数）
// ══════════════════════════════════════════════════════════════════════════════
const syntheticModule = 'const SYNTH_EXPORT = 1;\nexport { SYNTH_EXPORT };\n';

// ① 合成一个零消费者导出且未豁免 ⇒ 判红
{
  const r = judge({
    modules: new Map([['lib/synth.js', syntheticModule]]),
    publicSet: new Set(),
    consumers: new Map([['test/other.mjs', 'const x = 1;\n']]),
  });
  check('负对照：合成零消费者导出（未豁免）⇒ 判红', !r.ok, r.detail);
}

// ② 同一条导出挪进 exports 覆盖的公开入口 ⇒ 不判（豁免面有牙）
{
  const r = judge({
    modules: new Map([['lib/index.js', syntheticModule]]),
    publicSet: new Set(['lib/index.js']),
    consumers: new Map([['test/other.mjs', 'const x = 1;\n']]),
  });
  check('负对照：同一条导出挪进 exports 覆盖的入口 ⇒ 不判（豁免面有牙）', r.ok, r.detail);
}

// ③ 消费者只在**注释**里提到名字 ⇒ 仍判红（防"注释当消费者"）
{
  const r = judge({
    modules: new Map([['lib/synth.js', syntheticModule]]),
    publicSet: new Set(),
    consumers: new Map([['test/other.mjs', '// 见 SYNTH_EXPORT\n/* SYNTH_EXPORT */\nconst x = 1;\n']]),
  });
  check('负对照：消费者只在注释里提到名字 ⇒ 仍判红', !r.ok, r.detail);
}

// ④ 正控：另一个文件在**代码**里用到它 ⇒ 不判（消费者面有牙，不是"恒红"）
{
  const r = judge({
    modules: new Map([['lib/synth.js', syntheticModule]]),
    publicSet: new Set(),
    consumers: new Map([['test/other.mjs', 'console.log(SYNTH_EXPORT);\n']]),
  });
  check('正控：另一个文件在代码里消费它 ⇒ 不判（消费者面有牙）', r.ok, r.detail);
}

// ⑤ 负对照：产物里的出现不算消费（`lib/client.js` 是内联产物）
{
  const r = judge({
    modules: new Map([['lib/synth.js', syntheticModule]]),
    publicSet: new Set(),
    consumers: new Map([['lib/client.js', 'var SYNTH_EXPORT = 1; console.log(SYNTH_EXPORT);\n']]),
  });
  check('负对照：只有构建产物 lib/client.js 里出现 ⇒ 仍判红（产物不算消费者）', !r.ok, r.detail);
}

// ⑥ 自检：`as` 别名取**右侧**导出名（`export { a as SYNTH_ALIAS }`）
{
  const names = namedExports('const a = 1;\nexport { a as SYNTH_ALIAS };\n');
  check('自检：`export { a as B }` 认的是 B（不把本地名当导出名）',
    names.length === 1 && names[0] === 'SYNTH_ALIAS', names.join(' '));
}

console.log('');
if (stats.failed) {
  console.log(`SETTINGS-SCHEMA-EXPORTS CHECKS FAILED — ${stats.failed} failed, ${stats.passed} passed`);
  process.exit(1);
}
console.log(`ALL SETTINGS-SCHEMA-EXPORTS CHECKS PASSED (${stats.passed})`);
