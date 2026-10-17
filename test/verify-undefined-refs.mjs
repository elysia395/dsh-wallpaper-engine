#!/usr/bin/env node
/**
 * verify-undefined-refs.mjs —— **未定义引用**普查（"用了但没 import/声明" ⇒ 运行到那行必炸）。
 *
 * 为什么值得一条常驻判据：本仓在"把上游域模块搬进活侧"的过程中出现过
 * `lib/media/transcode.js` 用了 `dirname(` 却没 import 的缺陷 —— 它的症状是
 * **运行期** ReferenceError，而当时三道网都照不到：
 *   · `node --check` / 语法解析：合法（未定义标识符不是语法错）；
 *   · 聚焦判据：那条判据当时测的是**上游同名副本**（import 是全的），活侧真源从未被真的调用；
 *   · `verify-static` 的 eslint `no-undef`：本机工具链不可用，且它只是"按规则计数"的棘轮。
 * 它造成的后果是**静默**的：ffmpeg 主下载路径先炸（system PATH 兜底不可达）、启动清扫被外层
 * try/catch 吞掉（永不执行）。
 *
 * ⚠️ **零依赖**（链的硬纪律：`verify-package-files` P5 明令链上脚本不许有裸包 import ——
 * CI 不装任何依赖）。所以本判据**不做语法树解析**，用 `test/tools/js-text.mjs` 的词法层
 * （字符串/模板/正则感知）做"字符级掩码 + 作用域扫描"。这与 `verify-settings-schema-exports`
 * 的口径一致（它同样刻意不引 espree）。代价是**宁可漏报、不可误报**：误报会让这条判据被静音，
 * 那才是它最坏的失效形态。
 *
 * 口径：
 *   · 只查**非全局**的 node 内置 / 宿主名（`dirname` / `join` / `readdirSync` / `spawn` /
 *     `fileURLToPath` / `createHash` / …）——`Buffer` / `URL` / `setTimeout` 是 Node 全局，
 *     放进来只会把真命中淹掉；
 *   · **危险形状只认"调用"**：`NAME(` —— 这正是会在运行期炸的形状。成员调用（`o.join(`）与被
 *     调用的对象属性（`{ join: 1 }` 里的键）都不算；
 *   · **声明面**（整段都在**已剥注释**的文本上取，允许偏宽 —— 偏宽只会漏报，不会误报）：
 *     import 子句 / `const|let|var` 模式 / `function`·`class` 名 / 函数·箭头·方法·`catch` 的形参 /
 *     裸单参箭头；
 *   · **使用面**在**掩掉字符串·模板·正则**的文本上扫：字面量里的文字不是代码。
 * 扫描面：`lib/**`、`src/**`、`scripts/**`（跳过 `webwallgl` / `vendor` / `node_modules`）。
 *
 * 牙齿（每轮都跑，不是只在 CLI 里）：六条合成样本 —— 缺 import ⇒ 判出；import 齐全 / 成员调用 /
 * 对象键 / 形参声明 / 字面量里的同名调用 ⇒ 都不许判。为真时再扫真仓（**正负对照与主判据同一段代码**）。
 *
 * 档位：**soft**（`test/run-guards.mjs` 里 `step(…, [], 'soft')`）—— 新启发式判据先出声，
 * 有据可依地跑绿若干轮后再议升 hard（见 `docs/DEV-GUIDE.md` §4.2 的三条判据）。
 *
 * 用法：`node test/verify-undefined-refs.mjs`（判据）
 *      `node test/verify-undefined-refs.mjs --prove-teeth`（额外把样本落到 `.test-cache/` 上真跑
 *      一遍 —— 证明"文件系统 + 词法 + 报告"整条链有牙，而不是只测内存里的字符串）
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const posix = (p) => p.split(sep).join('/');

let passed = 0; let failed = 0;
function check (name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section (t) { console.log('\n' + t); }

/**
 * 只查这些名字：**非全局**的 node 内置 / 宿主 API。放全局名（`Buffer`/`URL`/`setTimeout`）进来
 * 只会制造噪声，而噪声会让这条判据被静音 —— 那是它最坏的失效形态。
 */
const WATCH = new Set([
  'dirname', 'basename', 'extname', 'join', 'resolve', 'normalize', 'relative', 'isAbsolute',
  'readFileSync', 'writeFileSync', 'appendFileSync', 'existsSync', 'statSync', 'lstatSync', 'mkdirSync',
  'readdirSync', 'unlinkSync', 'renameSync', 'copyFileSync', 'chmodSync', 'openSync', 'closeSync',
  'readSync', 'writeSync', 'fsyncSync', 'fstatSync', 'realpathSync', 'rmSync',
  'readFile', 'writeFile', 'appendFile', 'mkdir', 'readdir', 'unlink', 'copyFile', 'rm', 'access', 'realpath',
  'createHash', 'randomUUID', 'timingSafeEqual',
  'spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync',
  'homedir', 'tmpdir', 'fileURLToPath', 'pathToFileURL', 'createRequire', 'promisify',
]);

/**
 * 把**字符串 / 模板 / 正则**内容换成等长空格（换行原样保留 ⇒ 行号不变）。入参必须是已剥注释的
 * 文本（`stripComments` 已把注释换成空格、且保证注释里的引号不会开字符串）。
 * 正则字面量的识别沿用 `js-text.mjs` 的启发式：上一个有意义字符是运算符/分隔符时 `/` 开正则。
 */
function maskLiterals (src) {
  const REGEX_PREV = new Set(['=', '(', ',', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  let out = '';
  let i = 0;
  let prevMeaningful = '';
  while (i < src.length) {
    const c = src[i];
    const blankRun = (end) => { out += blank(src.slice(i, end)); i = end; };
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j += 1; break; }
        j += 1;
      }
      blankRun(Math.min(j, src.length));
      prevMeaningful = 'x';
      continue;
    }
    if (c === '/' && REGEX_PREV.has(prevMeaningful)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;                       // 行内未闭合 ⇒ 收手（绝不跨行吞）
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { j += 1; closed = true; break; }
        j += 1;
      }
      if (closed) { blankRun(j); prevMeaningful = 'x'; continue; }
    }
    out += c;
    if (!/\s/.test(c)) prevMeaningful = c;
    i += 1;
  }
  return out;
}

/** 从一个"模式/形参"片段里收集标识符（偏宽：默认值、属性键也收 —— 只会漏报）。 */
function collectNames (fragment, declared) {
  for (const m of fragment.matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(m[0]);
}

/** 声明面（在**已剥注释**的文本上取）。 */
function declaredNames (code) {
  const declared = new Set();
  for (const m of code.matchAll(/\bimport\b([^;]*?)\bfrom\b/g)) collectNames(m[1], declared);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([^;=\n]+)/g)) collectNames(m[1], declared);
  for (const m of code.matchAll(/\b(?:function\s*\*?\s*|class\s+)([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  // 形参：具名/匿名函数、箭头（含单参无括号）、方法、catch —— 都取括号内片段
  for (const m of code.matchAll(/\bfunction\s*\*?\s*[A-Za-z_$]*\s*\(([^)]*)\)/g)) collectNames(m[1], declared);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) collectNames(m[1], declared);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) collectNames(m[2], declared);
  for (const m of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) collectNames(m[1], declared);
  return declared;
}

/**
 * 单个源文本的未定义引用（纯函数：合成样本与真仓源码走**同一段代码**）。
 * @returns {Array<{name: string, line: number}>}
 */
function undefinedRefs (sourceText) {
  const code = stripComments(sourceText);
  const masked = maskLiterals(code);
  const declared = declaredNames(code);
  const lines = masked.split('\n');
  const out = [];
  const seen = new Set();
  for (const name of WATCH) {
    if (declared.has(name)) continue;
    const re = new RegExp('(?<![\\w$.])' + name + '\\s*\\(', 'g');
    for (let ln = 0; ln < lines.length; ln++) {
      re.lastIndex = 0;
      if (!re.test(lines[ln]) || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, line: ln + 1 });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function walk (dir, out = []) {
  // ⚠️ 声明**不带初值**：`let names = []` 的初值读不到（catch 里直接 return）
  //    ⇒ `no-useless-assignment` 会红（基线是空棘轮，只能减不能增）。
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!/webwallgl|vendor|node_modules/.test(p)) walk(p, out); }
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}

// ── 牙齿（每轮都跑）：六条合成样本 ────────────────────────────────────────────────
section('T. 牙齿自证：阳性 / 阴性 / 成员调用 / 对象键 / 形参 / 字面量（同一段判据代码）');
const S_BROKEN = "import { join } from 'node:path';\nexport const x = join(dirname('a/b'), 'c');\n";
const S_OK = "import { dirname, join } from 'node:path';\nexport const x = join(dirname('a/b'), 'c');\n";
const S_MEMBER = "const o = { join: 1 };\nexport const x = o.join('a', 'b');\n";
const S_KEY = "export const y = JSON.stringify({ dirname: 1 });\n";
const S_PARAM = "export const p = new Promise((resolve) => { resolve('a'); });\n";
const S_LITERAL = "export const s = 'dirname(' + `join(` + /readdirSync\\(/;\n";
check('T1 阳性对照：用了 `dirname(` 但没 import ⇒ 判出（这正是 `da00a7b` 的形态）',
  undefinedRefs(S_BROKEN).some((h) => h.name === 'dirname' && h.line === 2),
  JSON.stringify(undefinedRefs(S_BROKEN)));
check('T2 阴性对照：import 齐全 ⇒ 不判',
  undefinedRefs(S_OK).length === 0, JSON.stringify(undefinedRefs(S_OK)));
check('T3 负对照：成员调用（`o.join(`）不算未定义引用 ⇒ 不判',
  undefinedRefs(S_MEMBER).length === 0, JSON.stringify(undefinedRefs(S_MEMBER)));
check('T4 负对照：对象字面量的键（`{ dirname: 1 }`）不算引用 ⇒ 不判',
  undefinedRefs(S_KEY).length === 0, JSON.stringify(undefinedRefs(S_KEY)));
check('T5 负对照：形参即声明面（`new Promise((resolve) => …)`）⇒ 不判',
  undefinedRefs(S_PARAM).length === 0, JSON.stringify(undefinedRefs(S_PARAM)));
check('T6 负对照：字符串 / 模板 / 正则里的同名"调用"不是代码 ⇒ 不判',
  undefinedRefs(S_LITERAL).length === 0, JSON.stringify(undefinedRefs(S_LITERAL)));

// ── 主判据：扫真仓 ─────────────────────────────────────────────────────────────
section('U. 全仓普查（lib/** + src/** + scripts/**）');
const FILES = [
  ...walk(join(ROOT, 'lib')),
  ...walk(join(ROOT, 'src')),
  ...walk(join(ROOT, 'scripts')),
];
const hits = [];
let scanned = 0;
for (const file of FILES) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  scanned += 1;
  for (const r of undefinedRefs(text)) hits.push(posix(relative(ROOT, file)) + ':' + r.line + ' 未声明的 ' + r.name);
}
// 覆盖面地板（写在 if 之外）：扫描面静默退化（walk 失败 / 读不到文件）时必须显形
check('U0 覆盖面地板：真仓扫描到的文件数 ≥ 80（零值/骤降必须显形）', scanned >= 80, '实测 ' + scanned + ' / 枚举到 ' + FILES.length);
check('U1 没有"用了但没 import/声明"的非全局内置名', hits.length === 0,
  hits.length ? hits.length + ' 处：\n      ' + hits.join('\n      ') : '零命中（' + scanned + ' 个文件）');

// ── --prove-teeth：把样本落到盘上真跑一遍（证明"文件系统 + 词法 + 报告"整条链有牙）──────
if (process.argv.includes('--prove-teeth')) {
  section('V. --prove-teeth：样本落盘后经 walk + readFile + 报告整条链复跑');
  const ISO = join(ROOT, '.test-cache', 'undefined-refs-teeth');
  rmSync(ISO, { recursive: true, force: true });
  mkdirSync(ISO, { recursive: true });
  const wrote = [
    ['broken.js', S_BROKEN], ['ok.js', S_OK], ['member.js', S_MEMBER],
    ['key.js', S_KEY], ['param.js', S_PARAM], ['literal.js', S_LITERAL],
  ].map(([n, body]) => { const p = join(ISO, n); writeFileSync(p, body); return p; });
  const flagged = wrote.filter((p) => undefinedRefs(readFileSync(p, 'utf8')).length > 0).map((p) => posix(relative(ROOT, p)));
  const want = [posix(relative(ROOT, wrote[0]))];
  check('V1 落盘的六份样本里，只有 broken.js 被判出', JSON.stringify(flagged) === JSON.stringify(want),
    '判出=' + JSON.stringify(flagged));
  check('V2 真仓扫描不受样本目录影响（扫描面只含 lib/src/scripts）',
    !hits.some((h) => h.includes('.test-cache')), '零命中来自真仓');
  rmSync(ISO, { recursive: true, force: true });
  console.log('  （探针目录已清理：' + posix(relative(ROOT, ISO)) + '）');
}

console.log('');
if (failed) {
  console.log(`UNDEFINED-REFS CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL UNDEFINED-REFS CHECKS PASSED (${passed}) —— ${scanned} 个文件 / ${WATCH.size} 个受查名字`);
