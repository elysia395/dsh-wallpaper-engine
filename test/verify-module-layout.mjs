/**
 * verify-module-layout.mjs — `lib/` 与 `src/` 的分工守卫（docs/CODE-STRUCTURE.md §6 在册的规则）。
 *
 * 各条规则各回答一个"边界画在哪"的问题，且都机器可判定（编号 = 正文里的段落号；
 * ④ 与 ⑤ 是后加的两组判据，见各自段落的注释）：
 *
 *   ① `src/` 无孤儿 —— 除 `src/client.js`（正文，由构建脚本直接读入）外，`src/` 下每个
 *      `.js` 都必须登记进 `scripts/build-client.mjs` 的 `INLINE_MODULES`。
 *      为什么：浏览器 bundle 没有本地模块解析器，从 `src/client.js` 拆出来的模块只能由构建期
 *      按清单内联进同一个工厂作用域。**漏登记不会报错**，只是那个文件永远不进产物，
 *      调用点一多就在运行期变成 ReferenceError。清单就是唯一接线图 ⇒ 清单必须与目录一一对上。
 *      不变量：orphans == 0；登记的路径都真实存在；登记表每项都带 `file` / `why` / `markers`。
 *
 *   ② 依赖方向单向 —— `lib/` 下的运行期模块不得 import 任何解析到 `src/` 的路径。
 *      为什么：宿主半（从 `lib/index.js` 起）随包发布、由 Node 直接加载；浏览器半（`src/`）
 *      不进发布集。宿主一旦拉上 `src/`，发布包就缺文件（装上即崩），两侧也从"单向可分层"
 *      退化成互相引用。零容忍，不需要棘轮。
 *      覆盖的边形态：静态 `import … from`、副作用 `import '…'`、动态 `import(…)`、
 *      `require(…)`，外加同类的 `export … from`；判据作用在**剥掉注释后**的代码上。
 *      不变量：lib → src 的边数 == 0。
 *
 *   ③ 共享内核白名单 —— `INLINE_MODULES` 里允许不来自 `src/` 的只有 `lib/settings-schema.js`
 *      （宿主与客户端共用的设置真源）。
 *      为什么：两侧共用是**决策**，不是顺手 —— 被内联的 `lib/` 文件同时受 `src/` 的全部浏览器
 *      安全约束（无 import / 无 require / 无 process）。白名单写在下面那个数组里，再加一个
 *      共享内核必须显式改它，于是"多一个共享模块"永远会留下一次可见的改动。
 *      不变量：登记表中非 `src/` 的项 == 白名单；白名单每一项都真的在册（不许空转）。
 *
 *   ⑥ `src/` 子目录的**准入条件（门槛①）** —— 成员数达 `SRC_DIR_MIN_MEMBERS`。
 *      为什么：`src/` 模块之间没有 `import`、构建期被拍平 ⇒ 目录在这一侧**不承载机器含义**，
 *      唯一用处是"让人一眼看出这几块是一伙的"。1–2 个文件的目录做不到这件事（只多一层路径
 *      与一次搬动）。
 *      门槛① 写在 CODE-STRUCTURE §4 第 1 条；样本只有 `src/font/`（其权威文档是 FONT-SYSTEM.md）。
 *      不变量：`thin == 0`。
 *      ⚠️ **门槛②（"被一份常青文档的一级标题点名"）已撤除**，不在本守卫内 —— 它守的是标题
 *      措辞，且空壳文档（标题对、正文空）照样通过 ⇒ 守形式不守实质。门槛② 改由约定承担，
 *      撤除理由见 `docs/adr/0007-machine-checks-target-code-not-prose.md`（正文 §⑥ 同记）。
 *      本行曾误写"不变量 `thin == 0` 且 `unnamed == 0`"，与正文自相矛盾 —— 已更正。
 *
 * 每条规则都配**负对照**：把合成输入喂给**同一个判据函数**，断言它给出"坏"的裁决。
 * 只断言"今天干净"是不够的 —— 解析器一旦静默返回空表，正断言会恒绿。
 * 覆盖面断言（`src` 树 ≥13 个 `.js`、登记表 ≥10 条、`lib` ≥20 个模块且 ≥10 条依赖边、
 * `src` 子目录与常青面文档都非空）正是为此存在。
 *
 * Usage:  node test/verify-module-layout.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
// 剥注释统一用**共享且字符串感知**的实现（规则 ⑦ 就是钉这件事的）：朴素正则会被
// "注释/字符串里的块注释起始"带跑，一路吃掉后面的真实代码，规则 ④ 在那段代码上静默失效。
import { stripComments } from './tools/js-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

/**
 * 共享内核白名单：允许出现在 `INLINE_MODULES` 里、但**不**来自 `src/` 的文件。
 * 这是本守卫唯一需要人改的清单 —— 再加一个"两侧共用"的模块时，在这里加一条。
 */
const SHARED_KERNEL_WHITELIST = ['lib/settings-schema.js'];

/** 规则 ① 的判据：这些 `src/` 文件没有出现在登记表里（`src/client.js` 是正文，豁免）。 */
function findSrcOrphans(srcFiles, registered) {
  return srcFiles.filter((rel) => rel !== 'src/client.js' && !registered.has(rel)).sort();
}

/** 规则 ③ 的判据：登记表里不来自 `src/`、又不在白名单里的项。 */
function findUnlistedSharedKernels(registeredFiles, whitelist) {
  return registeredFiles.filter((rel) => !rel.startsWith('src/') && !whitelist.includes(rel)).sort();
}

/** 规则 ③ 的反向判据：白名单里登记表却没收的项（防白名单变成僵尸清单）。 */
function findStaleWhitelistEntries(registeredFiles, whitelist) {
  return whitelist.filter((rel) => !registeredFiles.includes(rel)).sort();
}

/**
 * `src/` 子目录准入的**成员数门槛**。
 *
 * 这里是该数值的**唯一真源**：`docs/CODE-STRUCTURE.md` §4 只写"达到 `SRC_DIR_MIN_MEMBERS`"，
 * 不抄写数字（本仓纪律：文档不写会漂的数值，见 `docs/README.md` §写作纪律）。
 * 判定逻辑在 `thinSrcDirs()`，正/负对照都走同一个函数。
 */
const SRC_DIR_MIN_MEMBERS = 3;

/**
 * 规则 ⑤ 的判据 (a)：成员数不足 `SRC_DIR_MIN_MEMBERS` 的 `src/` 子目录。
 * 入参形如 `{ font: 4 }`（目录名 → 该目录下 `.js` 计数）。
 */
function thinSrcDirs(counts) {
  return Object.entries(counts).filter(([, n]) => n < SRC_DIR_MIN_MEMBERS).map(([dir]) => dir).sort();
}

/**
 * 规则 ② 的边扫描：从**剥掉注释后**的代码里取出所有模块说明符及其形态。
 * 四种必须覆盖的形态（静态 / 副作用 / 动态 / require）外加同类的 export…from。
 */
const EDGE_PATTERNS = [
  { form: '静态 import…from', re: /\bimport\b[^;'"()]*?\bfrom\s*['"]([^'"]+)['"]/g },
  { form: '副作用 import', re: /(?:^|[^\w$.])import\s*['"]([^'"]+)['"]/gm },
  { form: '动态 import()', re: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
  { form: 'require()', re: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
  { form: 'export…from', re: /\bexport\b[^;'"()]*?\bfrom\s*['"]([^'"]+)['"]/g },
];

function scanEdges(code) {
  const out = [];
  for (const { form, re } of EDGE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) out.push({ form, spec: m[1] });
  }
  return out;
}

/**
 * 开发面（`scripts/` / `test/`）的说明符抽取：只认**语句位置**的 import/export，外加
 * `new URL('…', import.meta.url)`。守卫与冒烟的负对照里大量存在**合成字符串**
 *（如 `"import a from '../../src/a.js';"`），全量正则会把它们当成真依赖（实测 16 条假阳性）。
 */
function devSpecifiers(text) {
  const out = [];
  for (const line of stripComments(text).split('\n')) {
    // 合成夹具一律以引号开头（`"import a from '…';",`）—— 跳过，否则负对照会被算成真依赖。
    if (/^\s*['"`]/.test(line)) continue;
    const m = /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/.exec(line)
      || /^\s*import\s*['"]([^'"]+)['"]/.exec(line);
    if (m) out.push({ form: '语句位置 import/export', spec: m[1] });
    for (const u of line.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) {
      // `new URL('..', import.meta.url)` 指的是**目录**（仓库根），所以这一类允许目录命中。
      out.push({ form: 'new URL(…, import.meta.url)', spec: u[1], allowDir: true });
    }
  }
  return out;
}

/** 相对说明符 → 仓库根相对路径（posix）；非相对（node: / 裸包名 / 绝对路径）返回 null。 */
function resolveRelative(spec, fromRel) {
  // Windows 上 CommonJS 的 require 允许反斜杠，统一成正斜杠再解析。
  const s = spec.replace(/\\/g, '/');
  if (!s.startsWith('.')) return null;
  return posix.normalize(posix.join(posix.dirname(fromRel), s));
}

/**
 * 规则 ② 的判据：sources = [{ rel, text }]（`lib/` 下的运行期模块），
 * 返回所有解析到 `src/` 的依赖边。
 */
function findLibToSrcEdges(sources) {
  const out = [];
  for (const { rel, text } of sources) {
    for (const { form, spec } of scanEdges(stripComments(text))) {
      const resolved = resolveRelative(spec, rel);
      if (resolved && (resolved === 'src' || resolved.startsWith('src/'))) {
        out.push({ rel, form, spec, resolved });
      }
    }
  }
  return out;
}

/** 递归列出 dir 下的文件（仓库根相对的 posix 路径，已排序）。 */
function walkFiles(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const abs = join(dir, name);
    let st = null;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walkFiles(abs, out);
    else if (st.isFile()) out.push(relative(ROOT, abs).split(sep).join('/'));
  }
  return out.sort();
}

// 判据针对**代码**：先剥注释（`stripComments` 来自 `test/tools/js-text.mjs`，字符串感知），
// 否则模块头里一句 `// 见 src/x.js` 会被判成一条依赖边。

/** 从构建脚本里解析 `INLINE_MODULES`，并顺带数出每项的 `why` / `markers` 字段。 */
function parseInlineModules(buildText) {
  const region = buildText.match(/const INLINE_MODULES = \[([\s\S]*?)\n\];/);
  if (!region) return { found: false, files: [], whys: 0, markers: 0 };
  return {
    found: true,
    files: [...region[1].matchAll(/file:\s*(['"])([^'"]+)\1/g)].map((m) => m[2]),
    whys: (region[1].match(/\bwhy:/g) || []).length,
    markers: (region[1].match(/\bmarkers:/g) || []).length,
  };
}

// ── 输入集：三份扫描结果，全部来自磁盘 ───────────────────────────────────────
const srcFiles = walkFiles(join(ROOT, 'src')).filter((rel) => rel.endsWith('.js'));
const libSources = walkFiles(join(ROOT, 'lib'))
  .filter((rel) => /\.(js|mjs|cjs)$/.test(rel))
  .map((rel) => ({ rel, text: readFileSync(join(ROOT, rel), 'utf8') }));
const inline = parseInlineModules(readFileSync(join(ROOT, 'scripts', 'build-client.mjs'), 'utf8'));
const registeredSet = new Set(inline.files);

// ═══ ① `src/` 无孤儿 ══════════════════════════════════════════════════════════
console.log('\n① `src/` 无孤儿：除 src/client.js 外每个 .js 都在 INLINE_MODULES 里');
{
  // 覆盖面：解析器/扫描器静默返回空表时，下面的正断言会变成空对空。
  check('覆盖面：src 树扫到 ≥13 个 .js（防 walker 返回空表）', srcFiles.length >= 13,
    srcFiles.length + ' 个：' + srcFiles.join(' '));
  const srcEntries = inline.files.filter((rel) => rel.startsWith('src/'));
  check('覆盖面：INLINE_MODULES 解析出 ≥10 条登记', inline.found && inline.files.length >= 10,
    inline.found ? inline.files.length + ' 条（' + srcEntries.length + ' src + '
      + (inline.files.length - srcEntries.length) + ' lib）' : '数组区段没找到（构建脚本结构变了？）');
  check('登记表结构完整：每项都有 file / why / markers（防解析器只认到一部分项）',
    inline.found && inline.files.length === inline.whys && inline.files.length === inline.markers,
    'entries=' + inline.files.length + ' why=' + inline.whys + ' markers=' + inline.markers);
  check('负对照：解析器认得出合成登记项（不是把文件名硬编码进去）',
    JSON.stringify(parseInlineModules(
      "const INLINE_MODULES = [\n  { file: 'src/z.js', why: 'x', markers: [] },\n  { file: 'src/y.js', why: 'y', markers: [] },\n];\n"
    ).files) === JSON.stringify(['src/z.js', 'src/y.js']));

  const absent = inline.files.filter((rel) => !srcFiles.includes(rel) && !libSources.some((s) => s.rel === rel));
  check('登记的每个 file 都真实存在', absent.length === 0,
    inline.files.length + ' 条登记；缺文件=[' + absent.join(', ') + ']');

  const orphans = findSrcOrphans(srcFiles, registeredSet);
  check('除 src/client.js 外零孤儿', orphans.length === 0,
    srcFiles.length - 1 + ' 个待登记文件，孤儿=[' + orphans.join(', ') + ']');

  // 负对照 1（合成输入 → 同一个判据）：漏一个必须判孤儿，登记齐了必须放行。
  const probeSet = new Set(['src/a.js', 'src/b.js']);
  const probeFiles = ['src/client.js', 'src/a.js', 'src/b.js'];
  check('负对照：合成输入里漏登记的文件被判孤儿、登记齐时放行',
    JSON.stringify(findSrcOrphans(['src/client.js', 'src/a.js', 'src/b.js'], new Set(['src/a.js'])))
      === JSON.stringify(['src/b.js'])
    && findSrcOrphans(probeFiles, probeSet).length === 0
    && findSrcOrphans(['src/client.js'], new Set()).length === 0);

  // 负对照 2（扰动真实输入）：把真实登记集去掉一个成员，同一判据必须正好报出它 ——
  // 这条同时证明"真实输入确实流过了判据"，而不只是合成数据能过。
  const victim = inline.files.find((rel) => rel.startsWith('src/') && rel !== 'src/client.js');
  const perturbed = new Set([...registeredSet].filter((rel) => rel !== victim));
  const perturbedOrphans = findSrcOrphans(srcFiles, perturbed);
  check('负对照：真实登记集少一条时，判据精确报出那个文件', !!victim
    && srcFiles.includes(victim)
    && JSON.stringify(perturbedOrphans) === JSON.stringify([victim]),
    'victim=' + victim + ' 扰动后孤儿=[' + perturbedOrphans.join(', ') + ']');
}

// ═══ ② 依赖方向单向：lib → src 零处 ═════════════════════════════════════════
console.log('\n② 依赖方向单向：lib/ 不得 import 任何解析到 src/ 的路径');
{
  const edgeCount = libSources.reduce((n, s) => n + scanEdges(stripComments(s.text)).length, 0);
  check('覆盖面：lib 运行期模块 ≥20 个（防 walker 返回空表）', libSources.length >= 20,
    libSources.length + ' 个 .js/.mjs/.cjs');
  check('覆盖面：扫出的依赖边 ≥10 条（防解析器静默返回空表）', edgeCount >= 10, edgeCount + ' 条');
  check('覆盖面：宿主入口 lib/index.js 在扫描集里',
    libSources.some((s) => s.rel === 'lib/index.js') && libSources.some((s) => s.rel === 'lib/client.js'));

  const offenders = findLibToSrcEdges(libSources);
  check('lib/ 里零条指向 src/ 的依赖边', offenders.length === 0,
    offenders.length + ' 处 [' + offenders.map((o) => o.rel + ' -> ' + o.spec).join(', ') + ']');

  // 负对照 1（合成输入 → 同一个判据）：四种形态各造一条越界边，外加 export…from。
  const synthetic = [{
    rel: 'lib/deep/mod.js',
    text: [
      "import a from '../../src/a.js';",
      "import '../../src/b.js';",
      "const c = await import('../../src/c.js');",
      "const d = require('../../src/d.js');",
      "export { e } from '../../src/e.js';",
      "import local from './sibling.js';",
      "import fs from 'node:fs';",
      // 裸包名在**运行时拼出来**：写成字面量会被 verify-package-files 的 P5 文本扫描当成
      // 本链里真的裸依赖，把守卫链自己判红（P5 对它自己的负对照也是这么处理的）。
      "import x from '" + ['re', 'act'].join('') + "';",
      "// import ghost from '../../src/only-in-comment.js';",
      "const prose = 'see ../../src/only-in-prose.js for details';",
    ].join('\n'),
  }];
  const syntheticHits = findLibToSrcEdges(synthetic);
  check('负对照：四种形态 + export…from 各一条都被判越界',
    JSON.stringify(syntheticHits.map((h) => h.form + ':' + h.resolved)) === JSON.stringify([
      '静态 import…from:src/a.js', '副作用 import:src/b.js', '动态 import():src/c.js',
      'require():src/d.js', 'export…from:src/e.js',
    ]),
    syntheticHits.map((h) => h.form + '->' + h.resolved).join(' ') || '（一条都没抓到）');
  check('负对照：lib 内部相对 import / node: 内置 / 裸包名 / 注释与字符串里的 src 提及都不误报',
    !syntheticHits.some((h) => /sibling|only-in-comment|only-in-prose/.test(h.spec)));

  // 负对照 2（扰动真实输入）：在真实 lib 文件列表上注入一条越界边，同一判据必须报 1 处。
  const injected = findLibToSrcEdges([...libSources,
    { rel: 'lib/__control__/injected.js', text: "import { x } from '../../src/client.js';" }]);
  check('负对照：真实 lib 扫描集里注入一条到 src 的边，判据报出恰好 1 处',
    injected.length === 1 && injected[0].resolved === 'src/client.js',
    injected.map((h) => h.rel + ' -> ' + h.spec + ' => ' + h.resolved).join(' ') || '（注入的边没被报出来）');
}

// ═══ ③ 共享内核白名单 ════════════════════════════════════════════════════════
console.log('\n③ 共享内核白名单：INLINE_MODULES 里非 src/ 的项只许是 lib/settings-schema.js');
{
  const unlisted = findUnlistedSharedKernels(inline.files, SHARED_KERNEL_WHITELIST);
  const registeredNonSrc = inline.files.filter((rel) => !rel.startsWith('src/'));
  check('登记表里非 src/ 的项都在白名单里', unlisted.length === 0,
    registeredNonSrc.length + ' 项 [' + registeredNonSrc.join(', ') + ']；越界=[' + unlisted.join(', ') + ']');
  check('白名单不空转：每一项都真的在登记表里', findStaleWhitelistEntries(inline.files, SHARED_KERNEL_WHITELIST).length === 0,
    '白名单=' + SHARED_KERNEL_WHITELIST.length + ' 项；未在册=['
      + findStaleWhitelistEntries(inline.files, SHARED_KERNEL_WHITELIST).join(', ') + ']');

  // 负对照 1（合成输入 → 同一个判据）：多一个共享内核必须被判越界，在册的项与 src 项必须放行。
  check('负对照：合成登记集里多一个 lib/ 内核会被判越界，白名单内与 src 项放行',
    JSON.stringify(findUnlistedSharedKernels(
      ['src/a.js', 'lib/settings-schema.js', 'lib/another-kernel.js'], SHARED_KERNEL_WHITELIST))
      === JSON.stringify(['lib/another-kernel.js'])
    && findUnlistedSharedKernels(['src/a.js', 'lib/settings-schema.js'], SHARED_KERNEL_WHITELIST).length === 0);
  check('负对照：白名单少了在册项时，反向判据会报出来（防白名单放行一切）',
    findStaleWhitelistEntries(['src/a.js'], SHARED_KERNEL_WHITELIST).length === SHARED_KERNEL_WHITELIST.length);

  // 负对照 2（扰动真实输入）：真实登记表 + 一个假的 lib/ 内核，同一判据必须报出它。
  const injected = findUnlistedSharedKernels([...inline.files, 'lib/telemetry.js'], SHARED_KERNEL_WHITELIST);
  check('负对照：真实登记表里注入 lib/telemetry.js 会被判越界',
    JSON.stringify(injected) === JSON.stringify(['lib/telemetry.js']),
    '注入后越界=[' + injected.join(', ') + ']');
}

// ═══ ④ 相对说明符必须解析到真实文件（移动代码 ⇒ 相对路径必须重解析）════════════
// 为什么需要：把一段代码从 `lib/index.js` 搬进 `lib/routes/` 时，块里的相对说明符会**按新位置
// 重新解析**。静态 import 走这一步会在加载期直接抛（响亮、易查），而**动态 `import()` 的拒绝是
// 运行期、且常被 try/catch 吞成业务错误** —— 实测：scene 帧提取的那句
// `await import('./pkg-read.js')` 搬进 `lib/routes/` 后指向一个不存在的文件，最终表现是
// 《无可用纹理》的 422，看起来像数据问题而不是路径问题。所以判据按"说明符必须解析到真实文件"。
console.log('\n④ 相对说明符必须解析到真实文件');
{
  // Node 式解析：说明符可以省略扩展名（`require('./lib/encoder')` ⇒ `./lib/encoder.js`），
  // 也可以落在一个目录的 index 上。只做"存在性"是错的判据。
  const resolves = (rel) => {
    const abs = join(ROOT, rel);
    try { if (existsSync(abs) && statSync(abs).isFile()) return true; } catch { /* 继续探测 */ }
    for (const ext of ['.js', '.mjs', '.cjs', '.json']) if (existsSync(abs + ext)) return true;
    for (const idx of ['/index.js', '/index.mjs', '/index.cjs']) if (existsSync(abs + idx)) return true;
    return false;
  };
  // 扫描面 = `lib/**`（运行期）**加上开发面**（`scripts/**` + `test/**`）。开发面必须一并覆盖：
  // 目录重整（守门进 test/、工具进 test/tools/）会让相对说明符按新位置重解析 —— 实测
  // `test/verify-route-index.mjs` 的 `from './host-route-index.mjs'` 在工具搬进 test/tools/ 后断链
  // （它现在写的是 `from './tools/host-route-index.mjs'`，即搬目录后的正确形态）。
  const devSources = [...walkFiles(join(ROOT, 'scripts')), ...walkFiles(join(ROOT, 'test'))]
    .filter((rel) => rel.endsWith('.mjs'))
    .map((rel) => ({ rel, text: readFileSync(join(ROOT, rel), 'utf8') }));
  const allSources = [...libSources, ...devSources];
  // ⚠️ 开发面**不能**沿用 `scanEdges`：守卫自己的负对照里就有**合成字符串**
  //（如 `"import a from '../../src/a.js';"`），它们不是真说明符 —— 拿全量正则扫开发面会把
  // 这些夹具判成断链（实测 16 条假阳性）。所以开发面只认**语句位置**的说明符，
  // 外加 `new URL('…', import.meta.url)`（它同样是"按本文件位置解析"的相对路径）。
  const specsOf = (rel, text) => (rel.startsWith('lib/') ? scanEdges(stripComments(text)) : devSpecifiers(text));
  // 目录也算命中（`new URL('..', import.meta.url)` 指的就是目录；模块说明符另有 index 探测）。
  const resolvesDirOk = (rel) => resolves(rel) || (() => { try { return existsSync(join(ROOT, rel)) && statSync(join(ROOT, rel)).isDirectory(); } catch { return false; } })();
  const missing = [];
  for (const { rel, text } of allSources) {
    for (const { form, spec, allowDir } of specsOf(rel, text)) {
      const resolved = resolveRelative(spec, rel);
      if (!resolved) continue; // node: 内置 / 裸包名：不由本判据负责
      const ok = allowDir ? resolvesDirOk(resolved) : resolves(resolved);
      if (!ok) missing.push(`${rel} → ${spec}（${form}）`);
    }
  }
  // 覆盖面：扫描集非空且至少扫出一条相对边，否则这条断言是空对空
  const relativeEdges = allSources.flatMap(({ rel, text }) => specsOf(rel, text)
    .map(({ spec }) => resolveRelative(spec, rel)).filter(Boolean));
  check('覆盖面：扫到 ≥10 条相对说明符（防解析器静默返回空表）', relativeEdges.length >= 10,
    relativeEdges.length + ' 条');
  check('覆盖面：开发面也被扫到（scripts/ + test/ 至少 30 个 .mjs）', devSources.length >= 30,
    devSources.length + ' 个开发面 .mjs');
  check('lib/ 与开发面的每条相对路径都指向存在的文件', missing.length === 0,
    missing.length ? missing.join('; ') : relativeEdges.length + ' 条全部可解析');
  // 负对照：同一条判据喂给一条指向不存在文件的相对边，必须报出来
  const probe = scanEdges("const m = await import('./does-not-exist.js');")
    .map(({ spec }) => resolveRelative(spec, 'lib/routes/probe.js'))
    .filter((r) => r && !resolves(r));
  check('负对照：指向不存在文件的相对 import 会被判出',
    probe.length === 1 && probe[0] === 'lib/routes/does-not-exist.js', 'probe=' + probe.join(','));
  // 负对照 2：省略扩展名的合法说明符**不得**被判缺失
  check('负对照：省略扩展名的真实文件会被正确解析',
    resolves('lib/pkg-read') && resolves('lib/routes/no-such-module') === false,
    'pkg-read=' + resolves('lib/pkg-read') + ' 不存在的=' + resolves('lib/routes/no-such-module'));
  // 负对照 3：合成夹具字符串**不得**被当成真说明符（否则这条判据在开发面必然假红）
  check('负对照：守卫负对照里的合成 import 字符串不会被误判',
    devSpecifiers('    "import a from \'../../src/a.js\';",').length === 0
      && devSpecifiers("import { x } from './real.js';").length === 1);

  // `test/tools/` 比 `scripts/`、`test/` **深一层** ⇒ 用 `import.meta.url` 推仓库根必须退**两层**。
  // 这是搬迁最容易漏的一处，且症状离奇：退一层会把 ROOT 解析成 `test/`，于是 buildIndex 读
  // `test/lib/index.js` 直接 ENOENT —— 看起来像"文件没了"，其实是根找错了。
  const rootDepthOf = (text) => {
    // 只看**真正推导仓库根**的那一行：它必然同时含 `'..'`（`HERE = …import.meta.url` 那行不含）。
    const line = stripComments(text).split('\n')
      .find((l) => /\b(?:ROOT|root|HERE)\b\s*=/.test(l) && /'\.\.'/.test(l));
    return line ? (line.match(/'\.\.'/g) || []).length : null;
  };
  const shallow = devSources.filter(({ rel }) => rel.startsWith('test/tools/'))
    .map(({ rel, text }) => ({ rel, depth: rootDepthOf(text) }))
    .filter((x) => x.depth !== null && x.depth < 2);
  check('test/tools/*.mjs 的仓库根推导退两层（深一层目录最易漏改）', shallow.length === 0,
    shallow.map((x) => x.rel + '(depth=' + x.depth + ')').join(', ') || '全部退两层');
  check('负对照：单层仓库根推导会被判出',
    rootDepthOf("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');") === 1
      && rootDepthOf("const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');") === 2);
}

// ═══ ⑤ 路由模块不得"继承" lib/index.js 的 import ══════════════════════════════
// 为什么需要：把一段代码搬进 `lib/routes/` 之后，它原来靠 `lib/index.js` 顶层 import 拿到的名字
// （`readFile` / `existsSync` / …）在新文件里**不存在**了 —— 必须自己 import。缺失的静态 import
// **不是语法错误**，加载期不报；跑到那一行才是 ReferenceError，而且常被 try/catch 吞成业务错误
// （实测：scene 帧提取因此变成《无可用纹理》的 422，看起来像数据问题而不是代码问题）。
// 判据：路由模块里出现、`lib/index.js` 有 import，而它自己既没 import 也没声明的名字。
console.log('\n⑤ 路由模块必须自己 import 用到的库函数（不得吃 lib/index.js 的 import）');
{
  const importNames = (text) => {
    const out = new Set();
    for (const m of stripComments(text).matchAll(/\bimport\b([^;]*?)\bfrom\s*['"][^'"]+['"]/g)) {
      const clause = m[1];
      const braced = /\{([^}]*)\}/.exec(clause);
      if (braced) for (const p of braced[1].split(',')) {
        const t = p.trim().split(/\s+as\s+/).pop().trim();
        if (t) out.add(t);
      }
      const rest = clause.replace(/\{[^}]*\}/, ' ').replace(/,/g, ' ').trim();
      if (rest && !rest.startsWith('*')) out.add(rest);
    }
    return out;
  };
  const declaredNames = (code) => new Set([
    ...[...code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...code.matchAll(/\{([^}]*)\}\s*=\s*c\b/g)]
      .flatMap((m) => m[1].split(',').map((p) => p.trim().split(':').pop().trim())),
  ]);
  /** 同一个判据函数：返回该模块"吃了 index.js 的 import"的名字。 */
  const staleRefs = (code, ownImports, hostImports) => {
    const declared = declaredNames(code);
    return [...hostImports].filter((n) => !ownImports.has(n) && !declared.has(n)
      && new RegExp('(^|[^.\\w$])' + n + '\\b').test(code));
  };

  const hostImports = importNames(readFileSync(join(ROOT, 'lib/index.js'), 'utf8'));
  const hostRouteFiles = walkFiles(join(ROOT, 'lib', 'routes')).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const rel of hostRouteFiles) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    const stale = staleRefs(stripComments(raw), importNames(raw), hostImports);
    if (stale.length) offenders.push(rel + ' → ' + stale.join(','));
  }
  check('覆盖面：解析出 lib/index.js 的 import 名与路由模块（防判据空转）',
    hostImports.size >= 10 && hostRouteFiles.length >= 4,
    hostImports.size + ' 个 import 名 / ' + hostRouteFiles.length + ' 个路由模块');
  check('路由模块不引用 lib/index.js 单独 import 的名字', offenders.length === 0,
    offenders.join('; ') || '全部自足');
  // 负对照：把"缺 import"的合成源码喂给**同一个**判据；形参与 c 字段不得被误报
  const synth = stripComments([
    'export function registerX(webServer, c) {',
    '  const { base } = c;',
    '  const b = readFile(base);',
    '}',
  ].join('\n'));
  const synthStale = staleRefs(synth, importNames(''), hostImports);
  check('负对照：少了 import 的库函数会被判出，形参与 c 字段不误报',
    synthStale.includes('readFile') && !synthStale.includes('webServer') && !synthStale.includes('base'),
    '报出=[' + synthStale.join(',') + ']');
}

// ═══ ④（已撤除：CODE-STRUCTURE 的内联计数 == 构建清单）══════════════════════════
// 这里此前有一条**读文档散文**的判据：把文档（当时的 `docs/MODULE-LAYOUT.md`，现并入
// `docs/CODE-STRUCTURE.md`）里"共 N 个内联模块"那句
// 用正则找出来，与构建清单比对，并要求"改写句子就变红"。
//
// 它按 [`docs/adr/0006`](../docs/adr/0006-comment-discipline-as-written-convention.md) **撤除**了：
// 判据在守"作者怎么措辞"，而且它的失效方式正是它想防的那种 —— 句子一改写，判据就从
// "复算数字"退化成"守住那两句话"，于是它开始拦的是编辑而不是腐化。
// 边界依 ADR-0006：**读代码的守卫照留（①②③⑤⑥⑦⑧），读散文的守卫不加。**
//
// 数值腐化改由**符号引用**承担：文档不再写"共 N 个内联模块"，而是指向
// `scripts/build-client.mjs` 的 `INLINE_MODULES`（唯一真源）。

console.log('');

// ═══ ⑥ `src/` 子目录的准入条件（成员 ≥3）══════════════════════════════════════
// 为什么需要：`src/` 模块之间没有 `import`，构建期被拍平进同一个工厂作用域 ⇒ 目录在这一侧
// **不承载机器含义**，它唯一的用处是"让人一眼看出这几块是一伙的"。于是"2 个文件就分一层"
// （多一层路径、多一次搬动，却看不出任何结构）这种烂法没人拦。判据从**磁盘**现算。
//
// ⚠️ 本节**后半已撤除**（原文："子目录被一份常青文档的**一级标题**点名"）—— 按
//    [`docs/adr/0007`](../docs/adr/0007-machine-checks-target-code-not-prose.md)：
//    它守的是"某份文档的标题怎么写、放在哪里"，而且**一份空壳文档（标题对、正文空）照样
//    通过** ⇒ 守的是形式而非实质。"建 `src/` 子目录时同时建一份以它为标题的常青文档"
//    改由约定承担（与 `docs/README.md` §写作纪律 3「能写在代码旁的规则不单写文档」同源）。
console.log('⑥ `src/` 子目录成员数 ≥3');
{
  const srcDirs = readdirSync(join(ROOT, 'src'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const counts = {};
  for (const dir of srcDirs) {
    counts[dir] = walkFiles(join(ROOT, 'src', dir)).filter((rel) => rel.endsWith('.js')).length;
  }
  const thin = thinSrcDirs(counts);
  check('覆盖面：存在 `src/` 子目录（防判据因扫描面为空而恒真）',
    srcDirs.length >= 1, srcDirs.length + ' 个目录（' + srcDirs.join(',') + '）');
  check('`src/` 子目录成员数达门槛（不足就别分目录，见 CODE-STRUCTURE §4 第 1 条；门槛 = SRC_DIR_MIN_MEMBERS = ' + SRC_DIR_MIN_MEMBERS + '）',
    thin.length === 0,
    thin.length ? '不足：' + thin.map((d) => d + '(' + counts[d] + ')').join(' ')
      : srcDirs.map((d) => d + '(' + counts[d] + ')').join(' '));

  // 负对照：把合成输入喂给**同一个**判据函数，断言它给出"坏"的裁决。
  check('负对照：成员 2 个的合成目录会被判出',
    thinSrcDirs({ 'src/two': 2, 'src/three': 3 }).join() === 'src/two',
    '报出=[' + thinSrcDirs({ 'src/two': 2, 'src/three': 3 }).join(',') + ']');
}

// ═══ ⑦ 剥注释必须字符串感知 —— 朴素块注释正则在 test/** 与 src/** 的代码里不得再出现 ═══════════
// 回答的边界问题：「判据读源码时先剥注释」这一步本身可不可信。
// 朴素写法（块注释一条正则 + 行注释一条正则）**不认字符串与行注释**：
// 注释或字符串里出现"块注释起始"那两个字符（把 `scripts/**`、`test/**`、`docs/*.md` 写进一句
// 注释就够了）就会开一个"块注释"，一路吃到下一个结束标记，把中间的真实代码**静默删掉**，
// 而那些判据照样报绿 —— 这正是本仓最不想要的失败形态（单文件最长一段被吃掉 331 行）。
// 白名单**只许缩小**：CSS 侧那三处保留自己的朴素剥法（CSS 没有行注释，套 JS 词法会误删
// `url(//host/x)` 这类内容），另两处是"反面参照 / 检测器"本身，不是生产路径。
{
  const NAIVE_ALLOWED = [
    'test/tools/js-text.mjs',             // 共享实现内含一条**反面参照**（证明缺陷真实存在）
    'test/tools/audit-guard-teeth.mjs',    // 判据 F 的**检测器**：就是靠这个正则找可疑区间
    'test/verify-glass-compositing.mjs',   // CSS 专用
    'test/verify-glass-surfaces.mjs',      // CSS 专用（玻璃面登记表：同样从产物取样式表并剥注释）
    'test/verify-readability.mjs',         // CSS 专用
    'test/verify-softrender.mjs',          // CSS 专用
  ];
  // 朴素块注释正则的**源码文本**（就是这串字符：/ \ / \ * [ \ s \ S ] * ? \ * \ / / ）。
  // 分两段拼：这条判据自身也在扫描面里，整串写出来会命中它自己。
  const NEEDLE = String.raw`/\/\*[\s\S]` + String.raw`*?\*\//`;
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const judge = (text) => stripComments(text).includes(NEEDLE);

  const scanned = [...walkFiles(join(ROOT, 'test')), ...walkFiles(join(ROOT, 'src'))]
    .filter((rel) => rel.endsWith('.js') || rel.endsWith('.mjs'));
  check('覆盖面：⑦ 扫到 ≥50 个 JS/MJS 文件（防扫描面为空而恒真）', scanned.length >= 50, scanned.length + ' 个');

  const naive = scanned.filter((rel) => !NAIVE_ALLOWED.includes(rel) && judge(read(rel)));
  check('代码里零"朴素块注释正则"（剥注释已统一到字符串感知的实现）', naive.length === 0,
    naive.length ? '仍在用：' + naive.join(', ') : scanned.length + ' 个文件干净');

  const staleAllowed = NAIVE_ALLOWED.filter((rel) => !existsSync(join(ROOT, rel)) || !judge(read(rel)));
  check('白名单条目不空转（每条都真的还在用那个正则；只许缩小）', staleAllowed.length === 0,
    staleAllowed.length ? '该删：' + staleAllowed.join(', ') : NAIVE_ALLOWED.length + ' 条都在用');

  check('negative control: 朴素块注释正则会在这条判据下被判出',
    judge('x.replace(' + NEEDLE + "g, ' ')"));
  check('positive control: 注释里提到它不算（判据先剥注释再搜 ⇒ 不是恒真）',
    !judge('// 见 ' + NEEDLE + 'g'));
}

// ═══ ⑧ 手动工具与适配层必须在 docs/DEV-GUIDE.md 里点名（不许有"没人知道的工具"）══════════════
// 回答的边界问题：「`test/tools/` 里那些没有 CI 消费者的脚本，读的人找得到吗」。
// 实测过的形状：9 个工具里只有 1 个被文档点名 —— 其余等于只对作者可见（别人不知道该跑哪个、怎么跑）。
// `test/compat-*.mjs` 同理：它们是 CI 调的，但人也要能手动跑（文档里写的是不带扩展名的名字）。
//
// ⚠️ **中英两份都要点名**（实测过的失效形状）：本判据原来只读中文 `docs/DEV-GUIDE.md`，
//    于是英文版的 `test/tools/` 清单少了 2 项（`i18n-scan.mjs` / `weT-shim.mjs`）而**无人发现** ——
//    中文那份是权威版，但英文读者照着 §4.6 找不到这两个工具。两份都据同一份磁盘清单对账。
//    这是"读文件清单"而不是"读散文"：判据对的是**枚举面完整性**，措辞仍由写作约定承担。
{
  // ⚠️ 只对账**磁盘上真实存在**的那几份：`docs/en/DEV-GUIDE.md` 已按
  //    `docs/README.md` §语言结构「维护者向文档只留中文」撤除。硬读一个已删的路径
  //    会让本守卫**整条崩掉**（ENOENT ⇒ 后面所有规则都不再被判定）—— 实测过一次。
  //    中文那份是**权威版**，必须在册（下面的覆盖面断言钉住这点）。
  const docs = [
    { label: 'zh', path: join(ROOT, 'docs', 'DEV-GUIDE.md') },
    { label: 'en', path: join(ROOT, 'docs', 'en', 'DEV-GUIDE.md') },
  ].filter((d) => existsSync(d.path)).map((d) => ({ ...d, text: readFileSync(d.path, 'utf8') }));
  const tools = readdirSync(join(ROOT, 'test', 'tools')).filter((f) => f.endsWith('.mjs')).sort();
  const compat = readdirSync(join(ROOT, 'test')).filter((f) => /^compat-.*\.mjs$/.test(f)).sort();
  // 按**不带扩展名的文件名**判（文档里工具写成 `x.mjs`、compat 写成 `x`，两种都算点名）
  const judge = (doc, files) => files.filter((f) => !doc.includes(f.replace(/\.mjs$/, '')));
  check('覆盖面：⑧ 扫到 ≥8 个工具 + ≥3 个 compat（防扫描面为空而恒真）',
    tools.length >= 8 && compat.length >= 3, tools.length + ' 工具 / ' + compat.length + ' compat');
  check('覆盖面：⑧ 在册文档非空且含权威版 zh（防"文件被删 ⇒ 判据静默空转"）',
    docs.length >= 1 && docs.some((d) => d.label === 'zh'), docs.map((d) => d.label).join(',') || '（一份都没有）');
  for (const d of docs) {
    const undocumented = judge(d.text, [...tools, ...compat]);
    check(`每个 test/tools/*.mjs 与 test/compat-*.mjs 都在 ${d.label} 的 DEV-GUIDE 里点名`,
      undocumented.length === 0,
      undocumented.length ? '未点名：' + undocumented.join(', ') : (tools.length + compat.length) + ' 个都被点名');
  }
  check('negative control: 合成一个没被点名的工具会被判出',
    docs.every((d) => judge(d.text, ['zzz-合成未点名.mjs']).join() === 'zzz-合成未点名.mjs'));
  check('positive control: 已点名的工具不算（判据不是恒真）', judge(docs[0].text, [tools[0]]).length === 0, tools[0]);
}

console.log('');
if (failed) {
  console.log('MODULE LAYOUT CHECKS FAILED — ' + failed + ' failed');
  process.exit(1);
}
console.log('ALL MODULE LAYOUT CHECKS PASSED');
process.exit(0);
