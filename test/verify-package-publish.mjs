/**
 * verify-package-publish.mjs — **发布面**守卫（npm 方向）。
 *
 * 与 verify-package-files.mjs 的分工：那一份管"打包元数据有没有漂移"（files 覆盖 lib/、
 * 入口在位、依赖无死声明、工具链零裸依赖）；这一份管**装到用户机器上会不会坏 / 会不会多带东西**，
 * 四类失效各自独立：
 *   ① **该进的没进** ⇒ 用户装完跑不起来：按 `lib/index.js` 的**可达闭包**逐个核对是否被 `files` 覆盖；
 *      闭包里的每个相对导入目标还必须**真实存在于磁盘** —— 指向不存在文件的 import 在仓库里是
 *      死路径、没人撞得上，装到用户机器上才炸成 `ERR_MODULE_NOT_FOUND`；
 *   ② **不该进的进了** ⇒ 体积与源码外泄：发布集里不得出现 src/scripts/test/docs 等开发目录；
 *      白名单**为空**（棘轮）：安装期一个仓库脚本都不跑（见 ⑦ 的 #141 不变量），开发面文件一律不随包；
 *   ③ **带了同步机器的东西** ⇒ 不可复现 + 隐私：发布文本里不得出现真实的用户目录路径
 *      （占位符 `<你的用户名>` / `xxx` / `%USERPROFILE%` 不算）；
 *   ④ **白下载的运行时依赖** ⇒ 声明了但**活代码从不加载**：`dependencies` 每一条都必须被
 *      可达闭包 import（"lib/ 里某处 import 过"不够 —— 死码也算 import，见账本 §3.2）。
 *
 * 不调 npm：`files` 的展开语义在这里复刻（目录条目 / `*` 不跨 `/` / `**` 跨），
 * 于是 CI 与本机沙箱都能跑；tarball 的权威清单仍以 `npm pack --dry-run` 为准。
 * 注：这里核对的是 **`files` 驱动的集合**；npm 还会自动带上 `package.json` / `LICENSE` /
 * `README*` 等，所以真实 tarball 的条目数会比这里略多（差额即这些自动附带项）。
 * 需要精确条目数时以本机 `npm pack --dry-run` 的输出为准 —— 此处不写死数字。
 *
 * **负对照的形态规则（P3-16）**：变异输入必须喂进**同一条判据** —— 本文件里就是那几个命名实体
 * （`publishSet` / `resolveRelative` / `isDevLeak` / `DEV` / `PLACEHOLDER` / `unshippedRefs` /
 * `usedByClosure` / `vm.Script`），正判据与负对照都调它。只断言"某个常量不含 X"不算（判据没被执行）；在对照里另抄一份判据
 * 也不算（生产侧改了也不会红）。规则全文见 [`docs/DEV-GUIDE.md`](../docs/DEV-GUIDE.md) §约定 5。
 *
 * Usage:  node test/verify-package-publish.mjs
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
const section = (t) => console.log('\n' + t);
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

/** npm `files` 条目里的 glob → 正则：`*` 不跨 `/`，`**` 跨。 */
function globRe(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$+.[]{}()|'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

/** 条目 entry 是否覆盖相对路径 rel（目录条目可写 `lib/x/` 或 `lib/x`）。 */
function coveredBy(r, entry) {
  const e = String(entry).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!e) return false;
  let isDir = String(entry).endsWith('/');
  if (!isDir) {
    try { isDir = statSync(join(ROOT, e)).isDirectory(); } catch { /* 非目录/不存在 */ }
  }
  if (isDir) return r === e || r.startsWith(e + '/');
  if (/[*?]/.test(e)) return globRe(e).test(r);
  return r === e;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const files = Array.isArray(pkg.files) ? pkg.files : [];
const publishSet = (r) => files.some((entry) => coveredBy(r, entry));

/** 遍历仓库文件；跳过永远不可能"被发布"的重目录（否则本机要白走一遍 .git 与 node_modules）。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.test-cache', '_refs', '.integration-notes']);
const walk = (dir, out = []) => {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walk(abs, out);
    else if (st.isFile()) out.push(rel(abs));
  }
  return out;
};

// ── ① 该进的没进：可达闭包 ⊆ 发布集 ─────────────────────────────────────────
// 说明：`lib/webwallgl/**`（按文本注入 HTML）与 `lib/vendor/**`（按字符串 require）不走
// import 图，它们由下面的"目录条目覆盖"断言兜住，不在这张图里假装可达。
section('① 可达闭包（活的代码所需文件）是否都被 `files` 覆盖');

/** 判据：相对说明符 → 磁盘上的目标文件；候选一个都不存在返回 null。
 *  主扫描与负对照都走它 —— 否则"找不到"这条判据没有被真正执行过（P3-16）。 */
function resolveRelative(fromAbs, spec) {
  const base = resolve(dirname(fromAbs), spec.split('?')[0]);
  for (const cand of [base, base + '.js', base + '.mjs', base + '.cjs', join(base, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

const seen = new Set();
const queue = [join(ROOT, 'lib', 'index.js')];
const bare = new Set();
const unresolved = [];
while (queue.length) {
  const abs = queue.pop();
  if (seen.has(abs) || !existsSync(abs) || !/\.(js|mjs|cjs)$/.test(abs)) continue;
  seen.add(abs);
  const text = readFileSync(abs, 'utf8');
  const specs = [];
  for (const m of text.matchAll(/^\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  for (const m of text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  for (const m of text.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  // `createRequire(...).resolve('pkg')`：只定位包目录、按文件直出（webwallgl 是浏览器端引擎）——
  // 依赖照样被活代码用到，但它不是要沿着走的模块边。
  for (const m of text.matchAll(/\.resolve\s*\(\s*['"]([^'".][^'"]*)['"]\s*\)/g)) bare.add(m[1]);
  for (const s of specs) {
    if (s.startsWith('node:')) continue;
    if (!s.startsWith('.')) { bare.add(s); continue; }
    const target = resolveRelative(abs, s);
    if (target === null) { unresolved.push(rel(abs) + ' → ' + s); continue; }
    queue.push(target);
  }
}
const closure = [...seen].map(rel).sort();

/** 判据：某条声明依赖是否被**可达闭包**加载（正判据与负对照都走它；`list` 可注入）。 */
function usedByClosure(dep, list = bare) {
  // `bare` 是 Set、对照注入的却是数组 ⇒ **先摊开再判**：`Set` 上没有 `.some`，
  // 早先直接 `list.some(...)` 的写法一旦声明了任何依赖就会 `TypeError`
  // （当时 `dependencies` 为空，这条路径从不执行 ⇒ 恒绿而看不出来）。
  return [...list].some((s) => s === dep || s.startsWith(dep + '/'));
}
/** `cordis.patch.yml` 里每个模块行的 `name:` = **宿主加载该模块用的 specifier**。
 *  与 `test/verify-package-files.mjs:86` 的 `patchRowNames` 同一口径（逐字对齐其取词正则；
 *  那条正则与 `lib/subpackage-boot.js` 的 `subpackageSpecifiers` 同源）。逐行剥 `#` 注释。
 *
 *  为什么 ④ 要消费它（**别把这条当假阳性删掉**）：子包（`packages/**`）不是被主包 `import`
 *  加载的 —— **宿主按 `cordis.patch.yml` 的行名加载**它们，主包活代码里因此永远不出现这些
 *  裸说明符（启动自检走的是变量 `resolve(name)`）。所以"一条声明依赖是否被加载"的证据集
 *  必须 = 可达闭包抓到的裸说明符 ∪ **patch 行名**；少了后半，三个子包依赖会被误判成
 *  "声明了但活代码从不加载"。 */
function patchRowNames(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:-\s*)?name:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(raw.replace(/\s+#.*$/, ''));
    if (m) out.push(m[1]);
  }
  return out;
}

const uncovered = closure.filter((r) => !publishSet(r));
check('可达闭包里的每个文件都被 `files` 覆盖', uncovered.length === 0,
  uncovered.length ? '未覆盖：' + uncovered.join(', ') : closure.length + ' 个文件');
check('负对照：覆盖判据对包外路径有牙', !publishSet('src/client.js') && publishSet('lib/index.js'));
check('可达闭包里的每个相对导入目标都在磁盘上（指向不存在的文件 = 装上一加载就 ERR_MODULE_NOT_FOUND）',
  unresolved.length === 0,
  unresolved.length ? '找不到：' + unresolved.join(', ') : closure.length + ' 个文件全部解析到实体');
check('负对照：目标解析判据对缺文件返回 null、对在位与省略扩展名的说明符返回路径',
  resolveRelative(join(ROOT, 'lib', 'index.js'), './definitely-absent.js') === null
  && resolveRelative(join(ROOT, 'lib', 'index.js'), './__absent__') === null
  && resolveRelative(join(ROOT, 'lib', 'index.js'), './pkg-read') === join(ROOT, 'lib', 'pkg-read.js')
  && resolveRelative(join(ROOT, 'lib', 'index.js'), './index.js') === join(ROOT, 'lib', 'index.js'));
// 本 fork 保留：`usedByClosure` 的 `Set` 形态崩溃修复（上游与本仓库基线都仍是 `list.some`）。
// 它与分包模型无关，且上游那份同样有崩溃点 ⇒ 保留修法 + 保留这条对照。
check('负对照：依赖判据在 Set 与数组两种形态下都成立（防 `.some` 崩）',
  usedByClosure('some-dep', new Set(['some-dep'])) === true
  && usedByClosure('some-dep', ['some-dep/sub']) === true
  && usedByClosure('nope', new Set(['some-dep'])) === false);

// ── ② 不该进的进了 ──────────────────────────────────────────────────────────
section('② 发布集里没有开发目录');
const DEV = /^(src|scripts|test|docs|node_modules|\.test-cache|\.integration-notes|_refs|\.github|\.git)(\/|$)/;
/** 白名单**为空**（棘轮，只许收紧）—— 安装期一个仓库脚本都不跑（#141：`prepare` 在 git 直装时
 *  会被 pnpm 的 allowBuilds 闸拦下；构建已改挂 `prepack`，只在打包/发布时于发布者工作区跑），
 *  所以发布集里**任何**开发面文件都算泄漏。正判据（两个 check）与负对照都走 `isDevLeak`。 */
const SHIPPED_DEV_FILES = new Set();
const isDevLeak = (p) => {
  const e = String(p).replace(/^\.\//, '');
  return DEV.test(e) && !SHIPPED_DEV_FILES.has(e);
};
const devEntries = files.filter((e) => isDevLeak(e));
check('`files` 条目本身不指向开发目录（白名单为空）', devEntries.length === 0,
  devEntries.join(', ') || '无');
// 展开后的实测清单（防"某条目其实是个通配符/根目录"）
const published = walk(ROOT).filter(publishSet);
const devLeak = published.filter((r) => isDevLeak(r));
check('展开后的发布集里没有开发目录文件（白名单为空）', devLeak.length === 0,
  devLeak.length ? devLeak.slice(0, 5).join(', ') + (devLeak.length > 5 ? ` … 共 ${devLeak.length}` : '') : published.length + ' 个文件');
// 棘轮的地板必须显式写成「当前确实为空」并带计数 —— 空集上 `every(...)`
// 恒真，回填白名单后仍会绿；`size === 0` 才是「被填上就主动变红」的那道闸。
// 构建必须挂在 `prepack`：`prepare` 在 git 直装时会被 pnpm 的 allowBuilds 闸拒，
// 安装期一个仓库脚本都不跑 ⇒ 发布集里**任何**开发面文件都是泄漏，没有豁免名额。
check('白名单是棘轮（当前确实为空，回填即红）', SHIPPED_DEV_FILES.size === 0,
  '白名单 ' + SHIPPED_DEV_FILES.size + ' 条：'
    + ([...SHIPPED_DEV_FILES].join(', ') || '（无豁免：安装期不跑任何仓库脚本）'));
check('负对照：开发目录判据对 src/ 与 scripts/ 有牙（含 prepare.mjs —— 它已不随包）',
  isDevLeak('src/client.js') && isDevLeak('scripts/build-client.mjs')
  && isDevLeak('scripts/prepare.mjs') && !isDevLeak('lib/index.js'));

// ── ③ 同步机器路径（不可复现 + 隐私）────────────────────────────────────────
section('③ 发布文本里没有真实的用户目录路径');
// 占位符不算：`<你的用户名>` / `<your-user>` / `xxx` / `%USERPROFILE%` / `$HOME` 之类。
const PLACEHOLDER = /^(<.*>|x{2,}|your[-_]?user|yourname|username|user|name|%[A-Za-z_]+%|\$\{?[A-Za-z_]+\}?)$/i;
const USER_PATH_RE = /[A-Za-z]:\\Users\\([^\\\s"']+)|\/Users\/([^/\s"']+)|\/home\/([^/\s"']+)/g;
/** 从任意文本里抽出「真实用户名」分量；命中 `PLACEHOLDER` 的占位符不算命中。 */
const userPathHits = (text) => [...String(text).matchAll(USER_PATH_RE)]
  .map((m) => m[1] || m[2] || m[3] || '')
  .filter((who) => who && !PLACEHOLDER.test(who));
const pathHits = [];
for (const r of published) {
  if (!/\.(js|mjs|cjs|json|yml|yaml|md|swift|ts)$/.test(r)) continue;
  if (r === 'package.json') continue;
  for (const who of userPathHits(readFileSync(join(ROOT, r), 'utf8'))) pathHits.push(r + ' → ' + who);
}
check('发布文本里没有真实用户目录路径（占位符不算）', pathHits.length === 0,
  pathHits.length ? [...new Set(pathHits)].join('; ') : '干净');
// 发布集干净是**期望**，所以「零命中」本身不能证明抽取器还在工作 —— 必须拿正/负
// 样本把同一个抽取器喂一遍，否则正则退化（例如加了行首锚或要求整行匹配）时会静默恒真。
const pathSampleReal = 'const p = "C:\\Users\\some-real-user\\AppData";';
const pathSamplePlaceholder = 'const p = "C:\\Users\\%USERPROFILE%\\AppData";';
const realSampleHits = userPathHits(pathSampleReal);
const placeholderSampleHits = userPathHits(pathSamplePlaceholder);
check('覆盖面：路径抽取器在正样本上命中、在占位符样本上不命中（抽取器退化 ⇒ 当场红，不静默恒真）',
  realSampleHits.length === 1 && realSampleHits[0] === 'some-real-user' && placeholderSampleHits.length === 0,
  '正样本 ' + realSampleHits.length + ' 命中（' + (realSampleHits.join(',') || '无') + '）/ 占位符样本 '
    + placeholderSampleHits.length + ' 命中（' + (placeholderSampleHits.join(',') || '无') + '）');
check('负对照：路径判据放行占位符、拦住真实用户名',
  PLACEHOLDER.test('<你的用户名>') && PLACEHOLDER.test('xxx') && PLACEHOLDER.test('%USERPROFILE%')
  && !PLACEHOLDER.test('some-real-user'));

// ── ④ 白下载的运行时依赖 ────────────────────────────────────────────────────
section('④ 每个 dependencies 都被**可达闭包**用到');
// 棘轮：只许缩小。白名单为空 —— 任何"声明了但活代码从不加载"的依赖都必须当场删掉，
// 而不是登记在这里（白名单一旦有人加条目，这条断言就要求它确实仍未被使用）。
const DEP_UNUSED_ALLOW = {};
const deps = Object.keys(pkg.dependencies || {});
// 证据集 = 可达闭包抓到的裸说明符 ∪ **宿主行名**（子包由行加载，见 `patchRowNames` 的注释）。
const PATCH_TEXT = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
const loadEvidence = [...bare, ...patchRowNames(PATCH_TEXT)];
const unused = deps.filter((d) => !usedByClosure(d, loadEvidence));
const unexpected = unused.filter((d) => !(d in DEP_UNUSED_ALLOW));
check('没有"声明了但活代码从不加载"的依赖', unexpected.length === 0,
  unexpected.join(', ') || deps.join(', ') || '（无声明）');
// `every` 在空白名单上恒真 ⇒ 显式要求「当前确实为空」并带计数与理由，
// 一旦有人登记豁免（白名单不再为空）这条就当场变红，而不是继续静默放行。
const depAllowKeys = Object.keys(DEP_UNUSED_ALLOW);
check('棘轮只许缩小：白名单当前确实为空（登记项必须仍未被使用；填上即红）',
  depAllowKeys.length === 0
  && depAllowKeys.every((d) => deps.includes(d) && unused.includes(d)),
  '白名单 ' + depAllowKeys.length + ' 条' + (depAllowKeys.length ? '：' + depAllowKeys.join(', ') : '')
    + '（理由：声明了却从不加载的依赖必须当场删掉，不许登记豁免）');
check('负对照：依赖使用判据对合成输入有牙',
  usedByClosure('left-pad', ['left-pad/sub'])     // 子路径算用到
  && !usedByClosure('left-pad', ['left-padx'])    // 近失：前缀必须落在路径边界上
  && !usedByClosure('left-pad', ['node:fs']));    // 不相关的内置不是它
// 覆盖面：patch 抽取器真的读到了三条子包行（抽取器退化 ⇒ 这里当场红，不静默恒真）。
check('覆盖面：patch 行名抽到了三个子包行（本判据的"加载证据"不是空集）',
  ['dsh-plugin-wallpaper-engine-fx', 'dsh-plugin-wallpaper-engine-parallax', 'dsh-plugin-wallpaper-engine-fonts']
    .every((n) => loadEvidence.includes(n)),
  patchRowNames(PATCH_TEXT).join(', '));
// 负对照：行名确实是证据 —— 但要**同一条路径边界**（正/负两个方向都喂同一个 `usedByClosure`）。
const synthPatch = [
  'plugins:',
  '  - id: demo',
  "    name: 'demo-pkg'",
  '  - id: other',
  '    name: demo-pkg-extra',
  '  # name: commented-out',
].join('\n');
check('负对照：宿主行名能证明一条声明依赖被加载（合成 patch + 合成 dep）',
  patchRowNames(synthPatch).join(',') === 'demo-pkg,demo-pkg-extra'
  && usedByClosure('demo-pkg', [...bare, ...patchRowNames(synthPatch)]) === true
  && usedByClosure('commented-out', [...bare, ...patchRowNames(synthPatch)]) === false);
check('负对照：行名不是万能前缀（`foo-bar` 不证明 `foo`，也不证明 `foo-barbaz`）',
  usedByClosure('foo', [...patchRowNames('name: foo-bar')]) === false
  && usedByClosure('foo-barbaz', [...patchRowNames('name: foo-bar')]) === false
  && usedByClosure('foo-bar', [...patchRowNames('name: foo-bar')]) === true);

// ── ⑤ 入口 / 导出目标都在包里 ───────────────────────────────────────────────
section('⑤ 入口与导出目标都被发布');
const entries = [
  ['main', pkg.main],
  ["exports['.'].default", pkg.exports?.['.']?.default],
  ["exports['.']  .types", pkg.exports?.['.']?.types],
  ["exports['./client'].default", pkg.exports?.['./client']?.default],
  ["exports['./client'].types", pkg.exports?.['./client']?.types],
  ['types', pkg.types],
  ['dsh.bundle.patch', pkg.dsh?.bundle?.patch],
  ['dsh.client 平台/即时加载', pkg.dsh?.client?.platform === 'web' && pkg.dsh?.client?.immediately === true ? 'lib/index.js' : null],
];
const badEntries = entries.filter(([, p]) => !p || !existsSync(join(ROOT, String(p).replace(/^\.\//, '')))
  || !publishSet(String(p).replace(/^\.\//, '')));
check('每个入口/导出目标都真实存在且被发布', badEntries.length === 0,
  badEntries.map(([k, p]) => k + '=' + p).join(', ') || entries.length + ' 项');
check('`files` 里声明的每个条目都存在（否则 npm 会静默少发）',
  files.every((e) => existsSync(join(ROOT, String(e).replace(/\/+$/, '')))),
  files.filter((e) => !existsSync(join(ROOT, String(e).replace(/\/+$/, '')))).join(', ') || files.length + ' 条');
check('type=module（.js 按 ESM 解析）与 publishConfig.access', pkg.type === 'module'
  && pkg.publishConfig?.access === 'public');

// ── ⑥ 客户端产物形态（用户拿到的那一份）────────────────────────────────────
section('⑥ 发布出去的客户端产物可解析、是加载器形态');
const clientRel = String(pkg.exports?.['./client']?.default || 'lib/client.js').replace(/^\.\//, '');
const clientSrc = readFileSync(join(ROOT, clientRel), 'utf8');
check('产物是 DSH 客户端加载器形态（自注册 + factory）',
  clientSrc.startsWith('window.__ModuleLoader__.load({') && clientSrc.includes('factory: (require) => {'));
check('产物可解析（vm.Script —— 与构建同一道网）', (() => {
  try { new Script(clientSrc, { filename: clientRel }); return true; } catch { return false; }
})());
check('负对照：语法网对坏产物有牙', (() => {
  try { new Script('window.__ModuleLoader__.load({ factory: (require) => { ) }', { filename: 'bad.js' }); return false; }
  catch { return true; }
})());

// ── ⑦ 安装期不得跑任何仓库脚本（引用未随包文件 = 每个用户"装完就炸"；有构建钩子 = 装不上）──
// npm 为**依赖**运行 `preinstall` / `install` / `postinstall`；`prepare` 另有两个真的会跑的
// 时刻 —— git 直装（pnpm/npm 先装它的依赖再跑 prepare），以及把包装成**根项目**执行
// （解包后 `pnpm install` / 仓库里的 `npm install`）。**#141 起这四类一律不许出现**：
// pnpm 11 对 git 依赖的构建脚本有 allowBuilds 安全闸，插件市场默认走 `git+https://…` 直装
// ⇒ 带 `prepare` 的包被 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 稳定拒装（复现：本机
// `dsh plugin --profile <p> add git+https://…`，见 docs/CHANGELOG 的 #141 条目）。
// 构建改挂 `prepack`（只在打包/发布时、在发布者工作区里跑，引用 `src/`/`scripts/` 合法），
// 装出来的包直接用随包发布的 `lib/client.js`。`prepublishOnly` / `build` / `verify` / `smoke`
// 同样只在仓库里跑，引用开发面文件是允许的。
section('⑦ 安装期不得跑任何仓库脚本（无构建钩子 + 不引用未随包文件）');
{
  const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare'];
  const DEV_ONLY = ['prepublishOnly', 'prepack', 'postpack', 'prepublish',
    'build', 'verify', 'verify:docs', 'verify:all', 'verify:bridge', 'verify:e2e', 'smoke',
    // 本分支追加的桥闸门（严格模式）：命令指向 test/ 下的用例，同样只在仓库里跑 ⇒ 开发期脚本。
    'verify:bridge:strict',
    'verify:pet-link', 'verify:pet-link:integration', 'verify:pet-link:browser',
    // 静态门禁（ESLint / tsc 棘轮）：只在仓库里跑，工具与基线夹具都不随包发布。
    // `lint`/`typecheck` 不在此列是**不需要**：它们的命令里没有未随包路径（判据只看真引用）。
    'verify:static'];
  const unshippedRefs = (cmd) => [...String(cmd)
    .matchAll(/(?:^|\s)((?:scripts|src|test|docs|\.test-cache)\/[\w./-]+)/g)]
    .map((m) => m[1]).filter((p) => !publishSet(p));
  const offending = Object.entries(pkg.scripts || {})
    .filter(([name, cmd]) => unshippedRefs(cmd).length > 0 && !DEV_ONLY.includes(name));
  check('引用未随包发布文件的脚本只能是开发期脚本', offending.length === 0,
    offending.map(([n, c]) => n + ' → ' + unshippedRefs(c).join(',')).join('; ')
    || Object.keys(pkg.scripts || {}).length + ' 个脚本全部合规');
  check('负对照：安装期脚本引用 scripts/ 会被判出',
    unshippedRefs('node scripts/thing.mjs').length === 1
    && unshippedRefs('node lib/index.js').length === 0
    && unshippedRefs('node myscripts/thing.mjs').length === 0); // 近失：前缀必须落在路径边界上
  // 安装期钩子是**用户侧**会跑的：谁把它塞进 DEV_ONLY（为了让上面那条闭嘴）就等于放行"装完就炸"
  // `every` 的域必须非空 —— 清单被清空（或写错名）时 `[].every(...)` 恒真，这条会静默失去覆盖。
  check('负对照：安装期钩子不得被 DEV_ONLY 放行（清单非空才算数）',
    INSTALL_HOOKS.length >= 4 && INSTALL_HOOKS.every((h) => !DEV_ONLY.includes(h)),
    '安装期钩子 ' + INSTALL_HOOKS.length + ' 个：' + INSTALL_HOOKS.join(' '));
  // #141 不变量：这四类钩子在 package.json 里一个都不许有（有 ⇒ git 直装被 pnpm 的安全闸拒）。
  const bannedHooks = INSTALL_HOOKS.filter((h) => h in (pkg.scripts || {}));
  check('无安装期构建钩子（prepare / preinstall / install / postinstall）—— git 直装不得要求 allowBuilds（issue #141）',
    bannedHooks.length === 0, bannedHooks.join(', ') || '无');
  check('构建挂在 prepack 上（发布前在发布者工作区跑；装出来的包直接用 lib/client.js）',
    pkg.scripts && pkg.scripts.prepack === 'node scripts/prepare.mjs', String(pkg.scripts && pkg.scripts.prepack));
}

// ── ⑧ 根清单 ⇄ package-lock.json 同步（干净检出 `npm ci` 的前提）──────────────
// 为什么单列一条（P-A 的实际事故）：`npm ci` 第一件事是把**清单**当理想树去 registry 解析。
// `3842584e` 把三条子包依赖写进根 `dependencies`、却没动 `package-lock.json`（那时子包还没
// 发布到 npm）⇒ 干净检出上直接
//   `npm error 404  'dsh-plugin-wallpaper-engine-fonts@1.3.3' is not in this registry.`
// CI 两条腿在第 5 步（install）同时红；而本机 node_modules 早已存在、从没跑过 `npm ci`
// ⇒ 本机 82/82 全绿照样看不见（同 §10.2 第 5 条的"本机 ≠ CI"）。
// 判据 = CI 那条不变量的**离线形态**：清单里的每个依赖（连规格）都必须在锁文件根条目里逐字
// 找到，反向也不许多出条目。它**不**证明"这个包在 npm 上存在"（离线做不到），但"没锁就声明"
// 会被挡在提交前 —— 而未发布的包根本锁不出来 ⇒ 这类声明在开发期就进不了库。
section('⑧ 根清单 ⇄ package-lock.json 同步（`npm ci` 的前提）');
{
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const lockRoot = (lock.packages && lock.packages['']) || {};
  // npm 把 `optionalDependencies` 并进锁根条目的 `dependencies`（同一个键空间）。
  const asDeps = (m) => ({ ...(m.dependencies || {}), ...(m.optionalDependencies || {}) });
  /** 判据本体：清单三组字段 vs 锁根同名条目的逐字差集（正判据与全部负对照调**同一个**函数）。 */
  const lockDrift = (manifest, rootEntry) => {
    const drift = [];
    const fields = [
      ['dependencies', asDeps(manifest)],
      ['devDependencies', manifest.devDependencies || {}],
      ['peerDependencies', manifest.peerDependencies || {}],
    ];
    for (const [field, want] of fields) {
      const got = rootEntry[field] || {};
      for (const [name, spec] of Object.entries(want)) {
        if (!(name in got)) drift.push(field + '：锁里缺 ' + name + '@' + spec);
        else if (got[name] !== spec) drift.push(field + '：' + name + ' 锁 ' + got[name] + ' ≠ 清单 ' + spec);
      }
      for (const name of Object.keys(got)) {
        if (!(name in want)) drift.push(field + '：锁里多 ' + name + '@' + got[name]);
      }
    }
    if (manifest.name !== rootEntry.name || manifest.version !== rootEntry.version) {
      drift.push('name/version：清单 ' + manifest.name + '@' + manifest.version
        + ' ≠ 锁 ' + rootEntry.name + '@' + rootEntry.version);
    }
    return drift;
  };
  const drift = lockDrift(pkg, lockRoot);
  check('根清单的依赖（连规格）与 package-lock.json 根条目逐字一致（漂移 ⇒ 干净检出 `npm ci` 必红）',
    drift.length === 0, drift.join('; ') || ('deps ' + Object.keys(asDeps(pkg)).length
      + ' / dev ' + Object.keys(pkg.devDependencies || {}).length
      + ' / peer ' + Object.keys(pkg.peerDependencies || {}).length));
  // 覆盖面：判据面非空（lockfileVersion < 2 没有 `packages` ⇒ 上面会静默比较空集而恒真）。
  check('覆盖面：锁文件是 v2+ 且根条目确有可比内容（否则这条判据恒真）',
    Number(lock.lockfileVersion) >= 2 && Object.keys(lockRoot).length > 0
    && Object.keys(asDeps(pkg)).length > 0,
    'lockfileVersion=' + lock.lockfileVersion + ' / 根条目键 ' + Object.keys(lockRoot).length + ' 个');
  // 负对照：同一判据对五种合成漂移都有牙，对"完全一致"与"optionalDependencies 合并"不误报。
  const m0 = { name: 'demo', version: '1.0.0', dependencies: { a: '^1.0.0' }, devDependencies: { b: '^2.0.0' } };
  const r0 = { name: 'demo', version: '1.0.0', dependencies: { a: '^1.0.0' }, devDependencies: { b: '^2.0.0' } };
  const negs = [
    ['清单多一条（未锁）', { ...m0, dependencies: { a: '^1.0.0', z: '1.0.0' } }, r0, /锁里缺 z@1\.0\.0/],
    ['规格漂移（改了清单没重锁）', { ...m0, dependencies: { a: '^1.1.0' } }, r0, /a 锁 \^1\.0\.0 ≠ 清单 \^1\.1\.0/],
    ['锁里多一条（锁比清单旧）', m0, { ...r0, dependencies: { a: '^1.0.0', stale: '1.0.0' } }, /锁里多 stale@1\.0\.0/],
    ['devDependencies 漂移', { ...m0, devDependencies: { b: '^3.0.0' } }, r0, /devDependencies：b 锁/],
    ['包名/版本号漂移', { ...m0, version: '1.0.1' }, r0, /name\/version/],
  ];
  const missed = negs.filter(([, m, r, re]) => !re.test(lockDrift(m, r).join(' | '))).map(([n]) => n);
  check('负对照：五种清单⇄锁漂移都被判出', missed.length === 0,
    missed.length ? '漏判：' + missed.join(' / ') : negs.length + ' 种形态');
  check('负对照：一致时零漂移、且 optionalDependencies 合并进锁根不误报',
    lockDrift(m0, r0).length === 0
    && lockDrift({ ...m0, optionalDependencies: { c: '^3.0.0' } },
      { ...r0, dependencies: { a: '^1.0.0', c: '^3.0.0' } }).length === 0);
}

// ── ⑨ 发布形态自洽（ADR-0014 S8.2 的执行者：发布者的人工步骤 + 这条离线门）──────
// 为什么单列一条：S8.2 的"发布时把 `file:` 换成同号精确版"没有脚本执行者，能离线钉住的只有
// **形态自洽** —— 三份子包清单"全有或全无"。改了一半（部分进了 `dependencies`、`file:` 还留在
// `devDependencies`）是唯一能让干净检出 `npm ci` 在 install 步 404 的形态（P-A 事故同款）。
section('⑨ 发布形态自洽（开发期 ⇄ 发布期：全有或全无，混态判红）');
{
  const subs = [];
  const packagesDir = join(ROOT, 'packages');
  if (existsSync(packagesDir)) {
    for (const e of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const p = join(packagesDir, e.name, 'package.json');
      if (!existsSync(p)) continue;
      subs.push({ dir: e.name, name: JSON.parse(readFileSync(p, 'utf8')).name });
    }
    subs.sort((a, b) => (a.dir < b.dir ? -1 : 1));
  }
  const EXACT = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
  /** 判据本体：根清单处于哪种发布形态、形态内部有何矛盾（正判据与全部负对照调**同一个**函数）。 */
  const publishForm = (manifest, list) => {
    const problems = [];
    const deps = manifest.dependencies || {};
    const devDeps = manifest.devDependencies || {};
    for (const [n, s] of Object.entries(deps)) {
      if (String(s).startsWith('file:')) {
        problems.push('dependencies 里有 ' + n + '@' + s + '（未发布的包锁不出来 ⇒ 干净检出 `npm ci` E404）');
      }
    }
    const inDeps = list.filter((x) => Object.hasOwn(deps, x.name));
    const inDev = list.filter((x) => Object.hasOwn(devDeps, x.name));
    for (const x of list) {
      if (!Object.hasOwn(deps, x.name) && !Object.hasOwn(devDeps, x.name)) {
        problems.push('子包 ' + x.name + ' 两处形态都没登记（开发期应为 `file:packages/' + x.dir + '`）');
      }
    }
    for (const x of inDev) {
      if (String(devDeps[x.name]) !== 'file:packages/' + x.dir) {
        problems.push('devDependencies.' + x.name + ' = ' + devDeps[x.name]
          + '，开发期必须是 `file:packages/' + x.dir + '`');
      }
    }
    for (const x of inDeps) {
      const spec = String(deps[x.name]);
      if (!EXACT.test(spec)) {
        problems.push('dependencies.' + x.name + ' = ' + spec + '，发布期必须是同号精确版本（不用 ^ / ~ / file:）');
      } else if (spec !== manifest.version) {
        problems.push('dependencies.' + x.name + ' = ' + spec + ' ≠ 主包 version '
          + manifest.version + '（S3.2 同号纪律）');
      }
    }
    let form = 'dev';
    if (inDeps.length > 0 && inDev.length > 0) form = 'mixed';
    else if (inDeps.length > 0) form = 'publish';
    if (form === 'mixed') {
      problems.push('半发布形态：dependencies 里 ' + inDeps.length + ' 个、devDependencies 里 '
        + inDev.length + ' 个（要么全开发期、要么全发布期）');
    }
    if (form === 'publish' && inDeps.length !== list.length) {
      problems.push('发布形态缺项：' + inDeps.length + '/' + list.length + ' 个子包进了 dependencies');
    }
    if (form === 'dev' && inDev.length !== list.length) {
      problems.push('开发形态缺项：' + inDev.length + '/' + list.length + ' 个子包有 `file:` 规格');
    }
    return { form, problems };
  };
  const live = publishForm(pkg, subs);
  check('覆盖面：从 `packages/*` 清单读到 ≥3 个子包名（读不出来 ⇒ 下面的判据恒真）',
    subs.length >= 3, subs.map((x) => x.dir).join(', ') || '无');
  check('根清单处于自洽的开发期形态（S8.1）：`dependencies` 无子包、三条 `file:packages/<pkg>` 齐备',
    live.form === 'dev' && live.problems.length === 0,
    live.form + (live.problems.length ? '；' + live.problems.join('; ') : ''));
  // 负对照：同一判据对六种形态问题都有牙，对两个**合法**形态都不误报。
  const syn = [{ dir: 'a', name: 'main-a' }, { dir: 'b', name: 'main-b' }, { dir: 'c', name: 'main-c' }];
  const devM = {
    version: '1.0.0', dependencies: { x: '^2.0.0' },
    devDependencies: { 'main-a': 'file:packages/a', 'main-b': 'file:packages/b', 'main-c': 'file:packages/c' },
  };
  const pubDeps = { x: '^2.0.0', 'main-a': '1.0.0', 'main-b': '1.0.0', 'main-c': '1.0.0' };
  const pubM = { version: '1.0.0', dependencies: pubDeps, devDependencies: {} };
  const negs = [
    ['半发布（两条进 dependencies、file: 还留着）', { ...pubM, devDependencies: { 'main-c': 'file:packages/c' } }, /半发布形态/],
    ['范围规格（^1.0.0 而非同号精确）', { ...pubM, dependencies: { ...pubDeps, 'main-a': '^1.0.0' } }, /同号精确版本/],
    ['发布形态缺项（1/3 进 dependencies）', { ...pubM, dependencies: { x: '^2.0.0', 'main-a': '1.0.0' } }, /发布形态缺项/],
    ['开发形态缺项（少一条 file:）', { ...devM, devDependencies: { 'main-a': 'file:packages/a', 'main-b': 'file:packages/b' } }, /开发形态缺项/],
    ['devDependencies 里写了非 file: 规格', { ...devM, devDependencies: { ...devM.devDependencies, 'main-c': '^1.0.0' } }, /开发期必须是/],
    ['dependencies 里出现 file:（S8.1 红线）', { ...pubM, dependencies: { ...pubDeps, 'main-a': 'file:packages/a' } }, /dependencies 里有/],
  ];
  const missed = negs.filter(([, m, re]) => !re.test(publishForm(m, syn).problems.join(' | '))).map(([n]) => n);
  check('负对照：六种形态问题都被判出', missed.length === 0,
    missed.length ? '漏判：' + missed.join(' / ') : negs.length + ' 种形态');
  check('负对照：两个合法形态（全开发期 / 全发布期）零问题、不误报',
    publishForm(devM, syn).form === 'dev' && publishForm(devM, syn).problems.length === 0
    && publishForm(pubM, syn).form === 'publish' && publishForm(pubM, syn).problems.length === 0);
}

console.log('');
if (failed) { console.log(`PACKAGE PUBLISH CHECKS FAILED — ${failed} failed`); process.exit(1); }
console.log('ALL PACKAGE PUBLISH CHECKS PASSED');
