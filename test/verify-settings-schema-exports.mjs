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
 *   · **消费者 = 真标识符引用**：剥注释（`tools/js-text.mjs` 的 `stripComments`）**之后**，
 *     再掩掉**非引用**的语法位置，剩下的代码里出现该名字（词边界）才算一次消费。被掩的
 *     位置与理由（2026-10-13 升级，见 task-14）：
 *       1. **字符串字面量 / 模板串 / 正则字面量整段** —— 字面量里的名字是数据不是引用；
 *          模板串只保留 `${…}` 里的表达式（表达式本身递归按同一口径掩码）。
 *          反例（升级前被算成消费者）：`src.includes('IDLE_STOP_MS')`、
 *          `markers: ['function prepareWallpaper(']`、守卫夹具里被求值的源码文本。
 *       2. **非简写对象键** `{ NAME: … }` / `, NAME: …` —— 键是**定义**一个接口，不是读它。
 *          简写 `{ NAME }` **不掩**（那是对绑定的真引用）。反例：替身对象里
 *          `applyCaretStyles: () => { … }` 这种"用键名充当导出接口"的写法。
 *      **不掩**（刻意保留为消费）：
 *       3. **成员访问** `mod.NAME` / `mod?.NAME` —— 命名空间成员读在语义上**就是**消费，
 *          掩掉它是判据变弱（本仓 `src/**` 是扁平内联、跨模块引用多为裸标识符，实测
 *          这一条也不贡献额外条目）；`...NAME` 展开同样保留（真读）。
 *          **为什么 ③ 必须不掩（56 与 77 的差就是这一条）**：`src/**` 是扁平内联半边，
 *          跨模块引用大量写成命名空间成员读（`m.themeFollowLuminance(…)`）。曾有一次独立
 *          复算按"只认裸标识符"得到 77 条，多出的 21 条恰恰是这类成员读 —— 它们**有真
 *          消费者**（成员读在语义上就是读），掩掉 ③ 等于把活的引用判成零消费者，是判据
 *          变弱而不是变强 ⇒ 权威红名单是 **56**，不是 77。将来再看到 77/56 的差，先看这
 *          一段，不要为了凑 77 去掩 ③。
 *       4. **`import { NAME }` / `export { NAME }` / 裸标识符 / 简写属性** —— 都是真引用。
 *      **两个例外不算消费**（升级前就有）：
 *       ① **模块自己**（定义/导出语句当然在里面，不算消费）；
 *       ② **构建产物 `lib/client.js`**（它是 `src/**` 内联后的产物，里面出现名字只说明
 *          "构建时同处一个作用域"，不构成独立的消费）。
 *     **注释不算消费**：注释里写个名字谁都能写，`// 见 XXX` 不该把死导出续命
 *     （负对照 ③ 专门钉这一条）。
 *     一句话口径：**①②掩、③不掩** —— 字符串/模板/正则与对象键掩掉；成员访问、import/export、
 *     裸标识符、简写属性都算消费。
 *
 * ── 诚实边界（为什么这是"语法级启发式"而不是解析器）──────────────────────────
 * 本仓纪律是"只收机械可判的判据、不引入解析依赖"（§4.7 约定 5：正判据与全部对照必须
 * 共用同一段代码），所以掩码按字符扫描实现，已知盲点**只有两类**，且都会让判据**偏保守
 * （宁可不判红）**或需要人工看一眼：
 *   · **解构重命名** `const { NAME: local } = obj` —— 文本上与"对象字面量的键"同形，
 *     按口径 2 会被掩掉 ⇒ 该名字若**只**这样被读，会被误判成零消费者。现树上无此形态
 *     （62 条红名单里 0 条依赖它）；若将来出现，红名单会把它列出来、人工判一次即可。
 *   · **标签 / `case NAME:`** —— `case NAME:` 不受影响（键掩码要求前一个字符是 `{` 或 `,`），
 *     但对象字面量风格之外的 `NAME:` 标签理论上会被掩掉；本仓无此形态。
 *   · **不做语法树解析**：本判据是"剥注释 + 字符级掩码"，不依赖 espree/parser。这既是纪律
 *     （不引入解析依赖），也带来一个实测好处：`src/client.js` 结尾的 `return module.exports;`
 *     会让 espree 直接抛异常（`allowReturnOutsideFunction` 传不进去），而本守卫照常读它 ——
 *     实测把 `src/client.js` 清空后红名单 119 → 198、**79 个只被 hub 消费的名字当场变红**，
 *     证明 hub 确实在消费者面内（漏掉它会把真消费者判成零消费者）。
 *
 * ── 升级当场抓到什么（2026-10-13 · 62 条 · **0 条真死声明**）──────────────────
 * 新口径重算后红名单 62 条：`lib/**` 6 条 + `src/**` 56 条（升级前这些名字全都被"字符串
 * 字面量 / 构建 markers 数组 / 替身对象的键名"续着命 ⇒ 一条都没报红）。逐条看过，**62/62
 * 的声明本体在各自文件内都还有真自用**（函数被同文件的调用点用、常量被同文件的判断用）
 * ⇒ 没有一条是"真死声明"，它们全是**只把名字写在非引用位置上的空导出面**。
 * 因此清理一律**只删 `export` 关键字或 `export { … }` 里的 specifier，声明本体与文件内
 * 自用一字不动**（`lib/**` 6 条见 `576056b`、补刀 1 条见 `472d8cf`；`src/**` 56 条见 task-17）。
 * 唯一例外是 `src/avatar-layer.js::avatarGlyphSvgString`：它被 `test/verify-scene-live.mjs:4766`
 * 的精确集合 golden（5 名集 → 4 名集）钉着，必须与该 golden 同一笔提交落刀（Lead 执行）。
 * 这正是"字面量不是引用"必须写进口径的原因：只有把字面量掩掉，空导出面才会现形。
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

// ── 掩码层（口径 1/2 的机械实现；正判据与全部对照共用 `codeFace`）───────────────
/** 允许"正则字面量"出现在其后的前一个有意义字符（其余 `/` 都是除号）。 */
const REGEX_PREV_CHARS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']);
/** 同上，但前一个"词"是这些关键字时也可起正则（`return /x/`）。 */
const REGEX_PREV_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await', 'default']);

/** 跳过从 `i` 起的引号字符串（支持 `\\` 转义），返回结束位置。 */
function skipQuoted(text, i) {
  const q = text[i];
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === q) return j + 1;
    j++;
  }
  return text.length;
}

/** 跳过从 `i` 起的模板串（含其中 `${…}` 的嵌套），返回结束位置。 */
function skipTemplate(text, i) {
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === '`') return j + 1;
    if (text[j] === '$' && text[j + 1] === '{') { j = matchBrace(text, j + 1); continue; }
    j++;
  }
  return text.length;
}

/** `text[i] === '{'` ⇒ 返回配平 `}` 之后的位置（跳过字符串/模板/正则里的括号）。 */
function matchBrace(text, i) {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "'" || ch === '"') { j = skipQuoted(text, j); continue; }
    if (ch === '`') { j = skipTemplate(text, j); continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return j + 1; }
    j++;
  }
  return text.length;
}

/** 跳过从 `i` 起的正则字面量（含字符类与 flags），返回结束位置。 */
function skipRegex(text, i) {
  let j = i + 1;
  let inClass = false;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === '\n') break;
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) { j++; break; }
    j++;
  }
  while (j < text.length && /[a-z]/i.test(text[j])) j++;
  return j;
}

/** `text[i] === '/'` 处该按正则字面量解释吗（看前一个有意义字符/词）。 */
function regexAllowedAt(out) {
  const trimmed = out.replace(/\s+$/, '');
  if (!trimmed) return true;
  const last = trimmed[trimmed.length - 1];
  if (REGEX_PREV_CHARS.has(last)) return true;
  if (/[\w$]/.test(last)) {
    const word = /[A-Za-z_$][\w$]*$/.exec(trimmed);
    return !!word && REGEX_PREV_WORDS.has(word[0]);
  }
  return false;
}

/** 口径 1：掩字符串/模板/正则字面量（模板保留 `${…}` 内的表达式并递归掩码）。 */
function maskLiterals(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"') { out += ' '; i = skipQuoted(text, i); continue; }
    if (c === '`') {
      let j = i + 1;
      let expr = '';
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '`') { j++; break; }
        if (text[j] === '$' && text[j + 1] === '{') {
          const end = matchBrace(text, j + 1);
          expr += ' ' + maskLiterals(text.slice(j + 2, end - 1)) + ' ';
          j = end;
          continue;
        }
        j++;
      }
      out += ' ' + expr + ' ';
      i = j;
      continue;
    }
    if (c === '/' && regexAllowedAt(out)) { out += ' '; i = skipRegex(text, i); continue; }
    out += c;
    i++;
  }
  return out;
}

/** 口径 2：掩非简写对象键（`{ NAME:` / `, NAME:`）；成员访问与展开**刻意不掩**。 */
function maskObjectKeys(text) {
  return text.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, (m, a, name, c) => a + ' '.repeat(name.length) + c);
}

/**
 * 消费者判据口径的**唯一**入口：剥注释 → 掩字面量 → 掩对象键。
 * 正判据与全部负对照都喂进这一个函数（§4.7 约定 5），不许另抄一份。
 */
function codeFace(text) {
  return maskObjectKeys(maskLiterals(stripComments(String(text))));
}

/**
 * 判据核心（**纯函数**：正判据与全部负对照都喂进这一个函数，不许另抄一份口径）。
 *
 * @param {{ modules: Map<string,string>, publicSet: Set<string>, consumers: Map<string,string>, buildProduct?: string }} input
 *   `modules`：内部模块路径 → 源码；`publicSet`：豁免的公开入口；
 *   `consumers`：消费者候选路径 → 原始文本（**函数内部**剥注释 + 掩非引用位）。
 * @returns {{ mod: string, name: string }[]} 零消费者的导出（按模块、名字排序）
 */
function zeroConsumerExports({ modules, publicSet, consumers, buildProduct = BUILD_PRODUCT }) {
  const masked = new Map();
  for (const [f, text] of consumers) masked.set(f, codeFace(text));
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

// ⑦ 负对照（升级新增）：名字只在**字符串/模板**里出现 ⇒ 仍判红（字面量是数据不是引用）
{
  const r = judge({
    modules: new Map([['lib/synth.js', syntheticModule]]),
    publicSet: new Set(),
    consumers: new Map([['test/other.mjs', "check('SYNTH_EXPORT' in src);\nconst s = `SYNTH_EXPORT`;\nconst re = /SYNTH_EXPORT/;\n"]]),
  });
  check('负对照：名字只在字符串/模板/正则里出现 ⇒ 仍判红（字面量不是引用）', !r.ok, r.detail);
}

// ⑧ 正控（升级新增，与 ⑦ 成对）：同一文件里既有字面量又有**一行真引用** ⇒ 不判（掩码只吃字面量）
{
  const r = judge({
    modules: new Map([['lib/synth.js', syntheticModule]]),
    publicSet: new Set(),
    consumers: new Map([['test/other.mjs', "check('SYNTH_EXPORT' in src);\nconsole.log(SYNTH_EXPORT);\n"]]),
  });
  check('正控：同名既有字面量又有一行真引用 ⇒ 不判（掩码只吃字面量）', r.ok, r.detail);
}

// ⑨ 负对照（升级新增）：名字只作**非简写对象键**出现 ⇒ 仍判红（键是定义不是读）
{
  const r = judge({
    modules: new Map([['lib/synth.js', syntheticModule]]),
    publicSet: new Set(),
    consumers: new Map([['test/other.mjs', 'const stub = { SYNTH_EXPORT: () => {} };\n']]),
  });
  check('负对照：名字只作对象键出现 ⇒ 仍判红（键是定义不是读）', !r.ok, r.detail);
}

// ⑩ 正控（升级新增，钉住"成员访问不算假消费"）：只有 `mod.SYNTH_EXPORT` ⇒ **不判**
{
  const r = judge({
    modules: new Map([['lib/synth.js', syntheticModule]]),
    publicSet: new Set(),
    consumers: new Map([['test/other.mjs', 'import * as ns from "./synth.js";\nns.SYNTH_EXPORT();\n']]),
  });
  check('正控：成员访问 mod.SYNTH_EXPORT ⇒ 不判（命名空间成员读就是消费）', r.ok, r.detail);
}

console.log('');
if (stats.failed) {
  console.log(`SETTINGS-SCHEMA-EXPORTS CHECKS FAILED — ${stats.failed} failed, ${stats.passed} passed`);
  process.exit(1);
}
console.log(`ALL SETTINGS-SCHEMA-EXPORTS CHECKS PASSED (${stats.passed})`);
