// Verify the PUBLISHED package's `files` allowlist actually ships every file
// under lib/ — drop one runtime module from `files` and the tarball is missing it:
// another module then throws on import inside the render worker, and EVERY Scene
// wallpaper silently falls back to 回退主纹理 (upstream #86).
//
// The checkout always runs, so nothing in the repo notices a gap — only the
// PUBLISHED package breaks. This guard asserts the allowlist directly:
//   P1 every file under lib/ is covered by a `files` entry. Entries resolve as
//      exact paths, directories (with or without the trailing slash, e.g.
//      "lib/media/") and globs; the uncovered files are PRINTED, never
//      silently ignored.
//   P2 the resolver itself distinguishes covered from uncovered (a guard that
//      cannot fail is worthless) — positive + negative controls.
//   P3 the named runtime entry points exist on disk AND are covered, so deleting
//      a runtime module (or its entry) fails loudly instead of merely
//      shrinking P1's input set.
//
// Usage: node test/verify-package-files.mjs
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative, sep, dirname, resolve } from 'node:path';
import { builtinModules } from 'node:module';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments, blankStringLiterals } from './tools/js-text.mjs';
// 拿子进程输出的唯一方式（沙箱禁管道 ⇒ 走文件）：见该文件头。
import { runNodeCaptured } from './tools/child-out.mjs';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}
function assert(cond, name, detail) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + name + (detail ? ' — ' + detail : ''));
}

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** node: 内置模块根名（`fs` / `fs/promises` 按根名判，`node:` 前缀另判）—— P4 / P5 共用。 */
const BUILTIN_ROOTS = new Set(builtinModules || []);

/** 说明符的包根名：`@scope/pkg/sub` → `@scope/pkg`，`fs/promises` → `fs`。 */
const specRoot = (spec) => (spec.startsWith('@')
  ? spec.split('/').slice(0, 2).join('/')
  : spec.split('/')[0]);

/** 判据只针对**代码**：剥注释走共享实现（test/tools/js-text.mjs）。否则散文里一句 `from '…'`
 *  （说明"夹具长什么样"的注释）会被当成真的裸包依赖，把守卫自己判红。 */

/** 一条字符串字面量的内容里若写着**模块语法**（守卫自己的负对照夹具，形如
 *  `"import x from 'pkg'"`），那是**数据**不是依赖 —— 扫描前把它的内容抹成空白（换行保留，
 *  行号不变）。真说明符字面量（`'node:fs'` / `'./a.mjs'` / `'pkg'` / `'pkg/sub'`）不含这些
 *  关键字，原样保留；注释仍由 stripComments 处理。 */
const FIXTURE_KEYWORD_RE = /\b(?:import|export|require)\b/;
const blankFixtureStrings = (src) => blankStringLiterals(src, (content) => FIXTURE_KEYWORD_RE.test(content));

/** 说明符像不像一个**包名**：`pkg` / `@scope/pkg` / `pkg/sub`。
 *  判据只认这种形状 —— 拼接片段（` + spec + `）与 URL（`data:` / `file:` / `http:`）不是包，
 *  它们出现在链上不构成"CI 需要装依赖"这件事。 */
function looksLikePackageSpec(spec) {
  return /^(@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~/-]+)?$/.test(spec);
}

/** 源码里的**裸包** import 说明符：跳过相对路径 / 绝对路径 / 内置模块。
 *  形态覆盖 `from '…'` / 动态 `import('…')` / `require('…')` / **副作用导入 `import '…'`**
 *  —— 最后一种原先漏判（链上插一句 `import 'pkg';` 仍是绿的），现在与其余三种同一条判据。
 *  P5 的主扫描与负对照共用这一条判据。 */
function bareImportSpecs(src) {
  const out = [];
  const code = blankFixtureStrings(stripComments(src));
  for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('/')) continue;
    if (BUILTIN_ROOTS.has(specRoot(spec))) continue;
    if (!looksLikePackageSpec(spec)) continue;
    out.push(spec);
  }
  return out;
}

/** `cordis.patch.yml` 里每个模块行的 `name:` = 宿主加载该模块用的 specifier。
 *  逐行剥 `#` 注释后取 `name:` 值（`#` 开头的整行是注释，不参与）—— 与
 *  `lib/subpackage-boot.js` 的 `subpackageSpecifiers` 同一口径；那边只用子包行做双射，
 *  这里要**全部**行名当"这条依赖真被消费"的证据。 */
function patchRowNames(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:-\s*)?name:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(raw.replace(/\s+#.*$/, ''));
    if (m) out.push(m[1]);
  }
  return out;
}

// ── lib/ 文件枚举 + `files` 条目覆盖判定 ────────────────────────────────────
/** 递归列出 dir 下的文件 (相对 ROOT 的 posix 路径, 已排序)。 */
function walkFiles(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walkFiles(abs, out);
    else if (st.isFile()) out.push(relative(ROOT, abs).split(sep).join('/'));
  }
  return out.sort();
}

/** npm `files` 条目里的 glob → 正则: `*` 不跨 `/`, `**` 跨。 */
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

/** 条目 entry 是否覆盖相对路径 rel。目录条目可写 "lib/media/" 或
 *  "lib/media" (后者按磁盘上是否为目录判定), 其余支持精确路径与 glob。 */
function coveredBy(rel, entry) {
  const e = String(entry).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!e) return false;
  let isDir = String(entry).endsWith('/');
  if (!isDir) {
    try { isDir = statSync(join(ROOT, e)).isDirectory(); } catch { /* 非目录/不存在 */ }
  }
  if (isDir) return rel.startsWith(e + '/');
  if (/[*?]/.test(e)) return globRe(e).test(rel);
  return rel === e;
}

async function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert(Array.isArray(pkg.files), 'package.json must declare a files allowlist');
  const files = pkg.files;
  const libFiles = walkFiles(join(ROOT, 'lib'));
  // 运行时载荷 = .js/.mjs/.cjs (worker/模块图); 其余 lib/ 文件同样必须随包发布
  // (.d.ts 由 package.json types/exports 指向, .h 是 glsl 参考头) —— 一并断言,
  // 这样任何 lib/ 文件都不会被静静漏掉。
  const runtime = libFiles.filter((rel) => /\.(js|mjs|cjs)$/.test(rel));
  const uncovered = libFiles.filter((rel) => !files.some((e) => coveredBy(rel, e)));

  // ── P1: `files` 覆盖 lib/ 下的每一个文件 ────────────────────────────────────
  check('P1 package.json `files` covers every file under lib/ (' + runtime.length + ' runtime .js/.mjs)',
    libFiles.length > 0 && uncovered.length === 0,
    libFiles.length + ' lib file(s) vs ' + files.length + ' `files` entr(ies)'
      + '; missing=[' + uncovered.join(', ') + ']');

  // ── P2: 解析器正/负控制 (证明这条断言真的会 FAIL) ───────────────────────────
  {
    const controls = [
      [coveredBy('lib/index.js', 'lib/index.js'), 'exact file'],
      // 目录条目：正对照必须挑**磁盘上仍存在**的目录 —— 例子一旦失效，那条"无尾斜杠"
      // 正对照就恒假（判据本身没问题，是例子过期）。
      [coveredBy('lib/media/index.js', 'lib/media/'), 'dir entry (trailing slash)'],
      [coveredBy('lib/media/index.js', 'lib/media'), 'dir entry (no trailing slash)'],
      [coveredBy('lib/media/legacy.js', 'lib/media/**'), 'glob entry'],
      [!coveredBy('lib/__absent__.js', 'lib/index.js'), 'negative: unlisted file'],
      [!coveredBy('lib/__absent__/x.js', 'lib/index.js'), 'negative: wrong prefix'],
      [!coveredBy('lib/routes/upload.js', 'lib/media'), 'negative: dir must not match sibling'],
      [!coveredBy('lib/__absent__/x.js', 'lib/media/'), 'negative: outside the dir entry'],
    ];
    const bad = controls.filter(([ok]) => !ok).map(([, label]) => label);
    check('P2 coverage resolver separates covered from uncovered (positive + negative controls)',
      bad.length === 0,
      controls.length + ' controls, failed=[' + bad.join(', ') + ']');
  }

  // ── P3: 具名运行时入口必须在磁盘上且被收录 (防文件被删后 P1 空转通过) ────────
  {
    const required = [
      'lib/index.js', 'lib/client.js', 'lib/http-body.js', 'lib/pkg-read.js',
    ];
    const absent = required.filter((rel) => !libFiles.includes(rel));
    const unlisted = required.filter((rel) => libFiles.includes(rel) && !files.some((e) => coveredBy(rel, e)));
    check('P3 named runtime entry points exist under lib/ AND are shipped by `files`',
      absent.length === 0 && unlisted.length === 0,
      'required=' + required.length + ' absent=[' + absent.join(', ') + '] unlisted=[' + unlisted.join(', ') + ']');
  }

  // ── P6: 每个 lib/ 运行时模块都能被解析（语法 / 早期错误；`lib/` 里还有 .swift/LICENSE/.html，不参与）─────────────────────────
  // 为什么要 `node --check`：`export { parsePkg }` 而 parsePkg 未定义这种**再导出**错误让
  // 模块根本加载不起来，而没有任何守卫 import 它时整条链仍是绿的。只解析、不执行
  //（避免 `lib/client.js` 这类在 Node 里跑起来）。
  {
    const broken = runtime.filter((rel) => {
      try { execFileSync(process.execPath, ['--check', join(ROOT, rel)], { stdio: 'ignore' }); return false; }
      catch { return true; }
    });
    check('P6 every lib/ module parses (node --check)', broken.length === 0,
      broken.length ? 'broken=[' + broken.join(', ') + ']' : runtime.length + ' module(s) parsed');
    // 负对照：同一个判据对**故意写坏**的文件必须判红（否则这条断言可能恒真）
    const dir = join(ROOT, '.test-cache');
    const tmp = join(dir, 'syntax-probe.mjs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, 'export { nope };\n', 'utf8');
    let caught = false;
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'ignore' }); } catch { caught = true; }
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    check('P6 negative control: 坏模块会被 --check 判出', caught);
  }

  // ── P7: 每个 lib/ 运行时模块的**相对导入目标**都真实存在于磁盘 ─────────────────
  // P6 只判语法：一个指向不存在文件的 import 在仓库里是**死路径** —— 没有守卫 import 它，
  // `node --check` 也照过（语法没错），装到用户机器上才炸成 `ERR_MODULE_NOT_FOUND`。
  // 与 `verify-package-publish` ① 同口径但面更宽：那一份从 `lib/index.js` 的可达闭包出发，
  // 这份扫**全部**运行时模块（路由 / 媒体族多为宿主动态 import，不进那张闭包图）。
  // 口径：剥注释后扫 `from` / 动态 `import()` / `require()` 三种形态的相对说明符。
  {
    /** 判据：相对说明符 → 磁盘上的目标文件；候选一个都不存在返回 null（主扫描与负对照都走它）。 */
    const resolveRelative = (fromRel, spec) => {
      const base = resolve(ROOT, dirname(fromRel), spec.split('?')[0]);
      for (const cand of [base, base + '.js', base + '.mjs', base + '.cjs', join(base, 'index.js')]) {
        if (existsSync(cand) && statSync(cand).isFile()) return cand;
      }
      return null;
    };
    const missing = [];
    let specs = 0;
    for (const rel of runtime) {
      const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
        specs++;
        if (resolveRelative(rel, m[1]) === null) missing.push(rel + ' -> ' + m[1]);
      }
    }
    check('P7 every relative import target of every lib/ module exists on disk',
      specs > 0 && missing.length === 0,
      missing.length ? 'missing=[' + missing.join(', ') + ']'
        : specs + ' specifier(s) across ' + runtime.length + ' module(s)');
    check('P7 negative control: 目标不存在时报出、省略扩展名时解析到实体',
      resolveRelative('lib/index.js', './definitely-absent.js') === null
      && resolveRelative('lib/index.js', './__absent__') === null
      && resolveRelative('lib/index.js', './pkg-read') === join(ROOT, 'lib', 'pkg-read.js'));
  }

  // ── P4: 声明的依赖必须有消费者 (防"死声明") ──────────────────────────────────
  // package.json 里每一条 `dependencies` 都必须在 lib/ 里真的被 import（或经
  // `createRequire(...).resolve()` 定位包目录 —— `webwallgl` 是浏览器端引擎，宿主不加载它，
  // 只按文件直出）—— 否则它只是给用户装了一个永远不会被用到的包。历史上这里真有这么一条：
  // 代码只 import 一份相对路径的自带副本，裸包名在 link: 安装下根本解析不到；
  // 那份副本与它的唯一消费者已一并退役（见 `test/verify-retired-lines.mjs` ④）。
  // 注意口径：这里只断言"声明有消费者"，**不断言可达**（可达性属 P2-12 的活）。
  {
    const deps = Object.keys(pkg.dependencies || {});
    const libSrc = walkFiles(join(ROOT, 'lib'))
      .filter((rel) => /\.(js|mjs|cjs)$/.test(rel))
      .map((rel) => readFileSync(join(ROOT, rel), 'utf8'))
      .join('\n');
    // 消费者判据（与 P5 的裸依赖扫描同一口径）：源码里的 from / 动态 import() / require()
    // 三种形态各接一个引号包裹的依赖名，且名字后紧跟斜杠或收尾引号 —— 前缀相近的名字
    // （`foo-extra` 与 `foo` 不是同一个包）不算消费者。声明名本身是内置模块或相对路径时不算：那种声明在 Node
    // 解析下拿不到包（内置模块名命中的是内置模块，不是装进来的包）。
    const consumerRe = (dep) => new RegExp(
      '(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*|\\.resolve\\s*\\(\\s*)[\'"]'
      + dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:/[\'"]|[\'"])');
    // 消费者证据有两类：① lib/ 源码里的字面量；② `cordis.patch.yml` 的**行名** —— 宿主按行名
    // 加载模块，子包正是这样被消费的（主包 lib/ 里只出现变量名 `resolve(name)`，字面量在 patch 里）。
    const patchNames = new Set(patchRowNames(readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')));
    const consumes = (dep, src, rows = new Set()) => !dep.startsWith('.') && !dep.startsWith('/')
      && !(dep.startsWith('node:') || BUILTIN_ROOTS.has(specRoot(dep)))
      && (consumerRe(dep).test(src) || rows.has(dep));
    const consumers = deps.filter((d) => consumes(d, libSrc, patchNames));
    const orphans = deps.filter((d) => !consumers.includes(d));
    check('P4 every declared dependency is imported by lib/ (no dead declaration)',
      orphans.length === 0,
      'deps=' + deps.length + ' consumers=[' + consumers.join(', ') + '] orphans=[' + orphans.join(', ') + ']'
        + ' patchRows=' + patchNames.size);
    // 负对照必须跑**同一条** consumes 判据（不是另写一条正则、也不比常量字符串），否则它
    // 证明不了这条判据会 FAIL。合成源码里：假依赖名必须被判为"有消费者"；内置模块 /
    // `node:` 前缀 / 相对路径 / 前缀相近的名字必须不判为消费者。
    const fake = ['dsh', 'not-a-real-dep'].join('-');
    const controls = [
      [consumes(fake, 'import x from "' + fake + '"'), 'positive: from'],
      [consumes(fake, 'const x = require("' + fake + '")'), 'positive: require'],
      [consumes(fake, 'const m = await import("' + fake + '")'), 'positive: dynamic import'],
      [consumes(fake, 'createRequire(import.meta.url).resolve("' + fake + '")'), 'positive: require.resolve'],
      [!consumes(fake, 'import x from "' + fake + '-extra"'), 'negative: near-miss name'],
      [!consumes(fake, 'createRequire(import.meta.url).resolve("' + fake + '-extra")'), 'negative: near-miss resolve'],
      [!consumes(fake, 'import x from "./' + fake + '.mjs"'), 'negative: relative specifier'],
      [!consumes('./local.mjs', "import x from './local.mjs'"), 'negative: relative declaration'],
      [!consumes('node:path', 'import p from "node:path"'), 'negative: node: builtin'],
      [!consumes('fs', 'import f from "fs"'), 'negative: bare builtin'],
      // 第二类证据（patch 行名）必须与源码证据**同一条判据**：行名命中即消费者，
      // 前缀相近的行名不算，内置模块名当行名也不算。
      [consumes(fake, '', new Set([fake])), 'positive: patch row name'],
      [!consumes(fake, '', new Set([fake + '-extra'])), 'negative: near-miss patch row name'],
      [!consumes('node:path', '', new Set(['node:path'])), 'negative: builtin patch row name'],
    ];
    // patch 行名解析本身也要有牙：整行 `#` 的注释、`id:` 行必须跳过，`- name:` 与缩进 `name:`
    // 两种写法都要取到，引号有无、单双引号都要认。
    const synthPatch = '# 说明：\n# - name: \'' + fake + '-commented\'\n- id: some-id\n  name: \'' + fake + '\'\n  name: "' + fake + '-extra"\n- name: ' + fake + '-bare\n';
    const parsedRows = patchRowNames(synthPatch);
    check('P4 negative control: patch 行名解析跳过注释/id 行、认 - name: 与裸 name:、三种引号写法',
      parsedRows.length === 3 && parsedRows[0] === fake && parsedRows[1] === fake + '-extra' && parsedRows[2] === fake + '-bare',
      'parsed=[' + parsedRows.join(', ') + ']');
    const bad = controls.filter(([ok]) => !ok).map(([, label]) => label);
    check('P4 negative control: the consumer predicate reports a synthetic dependency and rejects builtins/relative/near-miss names',
      bad.length === 0,
      controls.length + ' controls, failed=[' + bad.join(', ') + ']');
  }

  // ── P5: 构建 / 校验链保持"零裸依赖"(CI 不装依赖的前提) ───────────────────────
  // .github/workflows/verify.yml 只装运行期依赖（`npm ci --omit=peer`）：build + verify + smoke
  // 脚本本身只用 node: 内置模块与相对路径，因此整条流水线对 peer 解析免疫。
  // 这是一条真不变量，不是偶然 —— 一旦有人在守卫里 import 一个裸包，CI 会红在
  // "command not found" 而不是给出可读原因，所以在这里显式钉住。
  //
  // ⚠️ **取源已不再是 `package.json` 的脚本字符串**：`verify` / `verify:docs` / `smoke` /
  // `verify:all` 四条现在各自只有一行 `node test/run-guards.mjs <组>`，用正则抠那行只会抠到
  // runner 自己 —— 五十多个守卫一个也扫不到，判据会"静默缩小后照旧通过"，正是这一段一直要挡
  // 的形态。真源在 runner 的 `--list-json`（`test/run-guards.mjs` 文件头写了为什么）。
  // 链的**成员与顺序**另由 `test/verify-guard-chain.mjs` 对着冻结 fixture 逐字比；这里管的是
  // 另外两面：零裸依赖，以及"链没有静默缩水"。
  {
    /** 一条脚本键必须**恰好**是 `node test/run-guards.mjs <它自己的组>`。纯函数 ⇒ 可被负对照直接喂。 */
    const shapeError = (cmd, key, group) => {
      const m = /^node\s+(\S+)\s+(\S+)$/.exec(String(cmd || '').trim());
      if (!m) return key + ' 不是单步 `node <file> <group>` 形态：' + JSON.stringify(cmd);
      if (m[1] !== 'test/run-guards.mjs') return key + ' 指向 ' + m[1] + '（应为 test/run-guards.mjs）';
      if (m[2] !== group) return key + ' 跑的组是 ' + m[2] + '（应为 ' + group + '）';
      return null;
    };
    const GROUPS = [['verify', 'verify'], ['verify:docs', 'docs'], ['smoke', 'smoke'], ['verify:all', 'all']];
    // 地板 = **实测步数**（新增不受限，**删或改名即判红**）。`docs` 整组软档也设 1 位数级别的值时
    // "整组被删空"会和"设计如此"无法区分，所以按实测收紧。
    //  收紧：verify 58→63（重新挂回 inject-contracts / component-face /
    // route-ownership / settings-namespaces / js-text selftest 这 5 条，见 run-guards.mjs 的清单注释）、
    // docs 1→7（再 7→8：新增 `verify-subpackage-manifests` —— 子包包面不得漂回极简形态）、
    // smoke 5→6、all 29→77（再 77→78，随 docs 那条）。
    //  再：verify 63→67 / all 78→82 —— 新增四条子包判据（subpackage-boot / -purity / -client-half /
    // -toggle-roundtrip，见 run-guards.mjs 的 VERIFY_STEPS 清单）。收紧后"删一步即红"由下面的负对照钉住。
    //  再：docs 8→7 / verify 67→68 —— `verify-subpackage-manifests`（子包包面）由软档升 hard
    // （ADR-0004：清单面属发布面 / 打包面，用户侧后果见 adr/0014 S3 的档位说明）；all 不变。
    //  再：verify 68→69 / all 82→83 —— 新增 `test/tools/packages.mjs selftest`（包发现层自检：
    // 上面一批包面判据与 `scripts/build-client.mjs` 都读它，属"判据底座的底座"；档位依据同
    // `js-text` selftest —— 它坏了会让一整批判据静默失真）。
    //  再：verify 69→70 / all 83→84 —— 新增 `test/verify-host-teardown.mjs`（R-1 的真实形态：
    // `handOffTeardown` 必须早于 `apply()` 体内任何注册点，中途抛错时 fiber 才拿得到 teardown；
    // 硬档依据 = 后果是"路由整族残留在宿主表里、开关再也关不干净"）。
    //  再：verify 70→71 / docs 7→6 —— `verify-guard-chain`（链的形状自检）由 docs 软档升 hard
    // （ADR-0004：链的形状属**发布面** —— 静默掉一条守卫 = 一条硬档判据无声脱离 PR 门禁，而 CI 对
    // `verify:docs` 是 `continue-on-error`，软档拦不住；R-4。它另含 R-5「脱链必须有代码内理由」⑤）。
    // all 不变（组内搬家）。
    //  再：verify 71→72 / all 84→85 —— 新增 `test/verify-ci-steps.mjs`（R-7：CI 步骤表自身无判据时，
    // 删掉 `verify:static` / `verify:bridge` 步不会让任何判据变红；硬档依据 = 后果是"一整类门禁静默
    // 从 PR 上消失"，同 ⑧ 的发布面口径）。
    //  再：verify 72→73 / all 85→86 —— 新增 `test/verify-eol.mjs`（D-G1：`.gitattributes:9` 的
    // `* text=auto eol=lf` 契约此前**零判据**，实害已发生过一次整轮改动被 CRLF 污染；硬档依据 =
    // 后果是"`test/**` 里按行锚定的字面替换负对照假红、整条 verify 链在 Windows 上短路"，同 ⑧ 的
    // 发布面口径 —— 它坏的时候没有任何一条别的判据会红）。
    //  再：verify 73→85 / all 86→98 —— 新增十二组可选桌宠联动离线回归（PR #5；`verify-pet-package` /
    // `-hotplug-host` / `-hotplug-client` / `-rope-entry` / `-tuner` / `-bubble-timing` / `-mascot-motion` /
    // `-egg1-motion` / `-egg1-rebound` / `-sidebar-rebound` / `-egg2-motion` / `-follow`，见 run-guards.mjs
    // 的 VERIFY_STEPS 清单）。合并时按实测重取：原 PR 基于 P-F 批 1c 之前的树，写的是 84/97。
    const CHAIN_FLOOR = { verify: 85, docs: 6, smoke: 6, all: 98 };
    /** 地板表与 GROUPS 的对齐体检：键名必须与**组名**逐一对齐（纯函数 ⇒ 负对照可直接喂）。 */
    const floorGaps = (groups, floors) => groups.map(([, g]) => g).filter((g) => !Number.isInteger(floors[g]));
    const problems = floorGaps(GROUPS, CHAIN_FLOOR).map((g) => '地板表缺组 ' + g
      + '（键名要写**组名**：`verify`/`docs`/`smoke`/`all`，不是脚本键名 `verify:docs`/`verify:all`）');
    /** 地板判据（纯函数：主判据与"删一步即红"的负对照**共用这一份口径**，不另抄）。 */
    const belowFloor = (steps, floor) => steps < floor;
    const scripts = new Set();
    const counts = [];
    /** 组名 → 实测步数（负对照要拿它和地板比，证明紧到"删一步即红"）。 */
    const measured = {};
    for (const [key, group] of GROUPS) {
      const bad = shapeError((pkg.scripts || {})[key], key, group);
      if (bad) { problems.push(bad); continue; }
      let listed;
      try {
        const out = runNodeCaptured([join(ROOT, 'test/run-guards.mjs'), group, '--list-json'], { cwd: ROOT });
        listed = JSON.parse(out);
      } catch (err) {
        problems.push(key + ' ⇒ runner 跑不起来：' + String((err && err.message) || err).split('\n')[0]);
        continue;
      }
      // runner 自己声明它服务哪个脚本键：挂错组（如 `verify` 指向 `docs`）在这里当场对不上。
      if (listed.chainKey !== key) problems.push(key + ' ⇒ runner 报的 chainKey=' + listed.chainKey);
      const steps = listed.steps || [];
      // 地板按**组名**取（不是脚本键名：`verify:docs` 的组是 `docs`）—— 键名取错会得到
      // `undefined`，`n < undefined` 恒 false，地板静默失效、这条判据变成永真。
      counts.push(key + '=' + steps.length + '/' + CHAIN_FLOOR[group]);
      measured[group] = steps.length;
      if (belowFloor(steps.length, CHAIN_FLOOR[group])) problems.push(key + ' 步数 ' + steps.length + ' < 地板 ' + CHAIN_FLOOR[group]);
      for (const s of steps) if (s.file) scripts.add(s.file);
    }
    // `build` / `prepack` 仍是**直连**的一行（不在 runner 里）：按老口径从脚本字符串取，
    // 并各自保一条地板 —— 只剩 runner 一条链时，它们是最容易被"顺手删掉"的两个。
    for (const key of ['build', 'prepack']) {
      const refs = [...String((pkg.scripts || {})[key] || '').matchAll(/node\s+([\w./-]+\.mjs)/g)].map((m) => m[1]);
      if (refs.length < 1) problems.push(key + ' 没有可扫描的 node 入口：' + JSON.stringify((pkg.scripts || {})[key]));
      for (const rel of refs) scripts.add(rel);
    }
    const offenders = [];
    for (const rel of scripts) {
      let src;
      try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { offenders.push(rel + '(缺文件)'); continue; }
      for (const spec of bareImportSpecs(src)) offenders.push(rel + ' -> ' + spec);
    }
    check('P5 the chain perimeter is pinned: each script is exactly one `node test/run-guards.mjs <its group>` and every group keeps at least its measured step count',
      problems.length === 0,
      problems.length ? 'problems=[' + problems.join(' · ') + ']'
        : counts.join(' ') + ' · unique scripts=' + scripts.size);
    check('P5 build/verify/smoke/prepack chain has NO bare-package import (CI installs nothing)',
      scripts.size > 0 && offenders.length === 0,
      scripts.size + ' script(s) referenced (from the runner manifests, not from the script strings); offenders=[' + offenders.join(', ') + ']');
    check('P5 negative control: the detector catches a bare import and ignores builtins/relative',
      (() => {
        // 负对照跑**主扫描用的同一个** bareImportSpecs（不是另抄一份），否则它证明不了
        // 主判据会 FAIL。假包名在运行时拼出来 —— 否则这条负对照的**字符串字面量**会被
        // 上面的扫描当成真的裸依赖，把守卫自己判红（本守卫也在被扫的链里）。
        const fake = ['left', 'pad'].join('-');
        return bareImportSpecs('import x from "' + fake + '"').length === 1
          && bareImportSpecs("const x = require('" + fake + "')").length === 1
          && bareImportSpecs("import fs from 'fs'").length === 0
          && bareImportSpecs("import p from 'node:path'").length === 0
          && bareImportSpecs("import q from './local.mjs'").length === 0
          // 注释里的引号说明符**不得**被算成依赖（本仓纪律：判据先剥注释再判）
          && bareImportSpecs("// 夹具形如 from '" + fake + "'\nconst ok = 1;").length === 0;
      })());
    check('P5 negative control: 副作用导入形态（import 后直接跟引号）被同一条 bareImportSpecs 判出，相对路径 / 内置模块不误伤',
      (() => {
        // 与上一条同一手法：假包名在运行时拼出来 —— 本文件也是被扫的链成员，字符串字面量里
        // 不许出现 `import '真包名'` 那种形状，否则守卫扫自己时会把字面量当成真裸依赖（自伤）。
        const fakeSide = ['left', 'pad'].join('-');
        return bareImportSpecs("import '" + fakeSide + "';").length === 1
          && bareImportSpecs("import '" + fakeSide + "'").length === 1
          // 副作用导入与 `from` 形态混排：两条都要算（漏一边或重复计数都会被这条钉住）
          && bareImportSpecs("import '" + fakeSide + "';\nimport x from '" + fakeSide + "';").length === 2
          && bareImportSpecs("import './local.mjs';").length === 0
          && bareImportSpecs("import 'node:fs';").length === 0
          && bareImportSpecs("import 'fs';").length === 0
          // 注释里的副作用导入同样**不得**算（先剥注释再判，与上一条同一纪律）
          && bareImportSpecs("// import '" + fakeSide + "'\nconst ok = 1;").length === 0;
      })());
    check('P5 negative control: the script-shape predicate rejects a wrong group, an extra step and the old inline chain',
      shapeError('node test/run-guards.mjs verify', 'verify', 'verify') === null
      && shapeError('node test/run-guards.mjs docs', 'verify', 'verify') !== null
      && shapeError('node test/run-guards.mjs smoke', 'smoke', 'smoke') === null
      // 旧形态（一条 `&&` 长链）不得被当成合法 —— 它正是"取源漂了"的那一形态
      && shapeError('node test/verify-client-sync.mjs && node test/verify-client.mjs', 'verify', 'verify') !== null
      // 多挂一步（`node test/run-guards.mjs verify && node other.mjs`）也不合法
      && shapeError('node test/run-guards.mjs verify && node test/verify-about.mjs', 'verify', 'verify') !== null
      && shapeError('node test/other.mjs verify', 'verify', 'verify') !== null);
    check('P5 negative control: a floor table that keys by script name instead of group name is detected',
      // 真实踩过的形态：表里写 `'verify:all': 29` 而查表用组名 `all` ⇒ `undefined` ⇒ 地板永真。
      floorGaps(GROUPS, { verify: 63, docs: 7, smoke: 6, 'verify:all': 77 }).length === 1
      && floorGaps(GROUPS, { verify: 63, docs: 7, smoke: 6 }).length === 1
      && floorGaps(GROUPS, CHAIN_FLOOR).length === 0);
    // 地板"紧到位"的负对照：拿**实测步数**喂同一条比较口径 —— 实测-1 必须判红、实测必须不红。
    // 没有这条的话，地板写成 24（实测 63）也能"通过"，等于给"整条链被删掉 39 步"发合格证。
    check('P5 negative control: 地板紧到「删一步即红」（同一 belowFloor 口径，喂 实测-1 / 实测）',
      GROUPS.every(([, g]) => Number.isInteger(measured[g])
        && belowFloor(measured[g] - 1, CHAIN_FLOOR[g]) && !belowFloor(measured[g], CHAIN_FLOOR[g]))
      && belowFloor(77, 78) && !belowFloor(78, 78),
      GROUPS.map(([, g]) => g + ' 实测=' + measured[g] + '/地板=' + CHAIN_FLOOR[g]).join(' · '));
  }

  // ── P8: 发布面文件不得带 UTF-8 BOM ─────────────────────────────────────────
  // 为什么归**发布面**管：这些文件会被发到用户机器上。实测（Node 22）两种解析器的行为**不同**，
  // 所以不能一律说"会炸"，但其中一种是真炸：
  //   · **Node ESM 加载器会剥 BOM** ⇒ 模块带 BOM 仍能 `import`（实测通过）；
  //   · **`JSON.parse` 不剥** ⇒ 带 BOM 的文本抛 `Unexpected token '\uFEFF'`（实测失败）。
  // 也就是说：`.json` 带 BOM 是**真缺陷**，`.js` 是**隐患**（换解析路径 / 工具链即可能爆，
  // 且 `node --check` 与它无关）。两者都按"发出去的东西不该带"处理。
  //
  // 扫描面：`lib/` 下**会被解析**的那些扩展名。`.swift`（原生附带源码，用户自己编译）、
  // `.md` 与无扩展名文件不参与 —— 它们没有"解析器会读首字节"这件事。
  // vendored 子树一并扫（当前无 BOM；它们同样是随包发出的文本）。
  //
  // 判据边界（与 ADR-0006 一致）：它读的是**产物字节**，不是散文措辞 —— 属于"读代码的守卫"。
  // 本条的前身是 `verify-comment-discipline` 里那段"硬编码 5 个文件"的 BOM 检查，
  // 随该守卫撤除；那次撤除让 `lib/routes/fontsets.js` 带着 BOM 无人看管
  //（撤除那条守卫时这个盲区被漏掉过）。这里改按扩展名全扫，不再硬编码名单。
  {
    const BOM = [0xEF, 0xBB, 0xBF];
    const PARSED_EXT = ['.js', '.mjs', '.cjs', '.json', '.ts', '.html'];
    /** 首三字节是否为 UTF-8 BOM。入参是 fs 读出的原始字节（不是'utf8' 字符串）。 */
    const hasBom = (buf) => buf.length >= 3 && buf[0] === BOM[0] && buf[1] === BOM[1] && buf[2] === BOM[2];
    const scanned = libFiles.filter((rel) => PARSED_EXT.some((ext) => rel.toLowerCase().endsWith(ext)));
    const offenders = scanned.filter((rel) => {
      try { return hasBom(readFileSync(join(ROOT, rel))); } catch { return false; }
    });
    // 覆盖面：扫描面为空 ⇒ 判据恒真。`lib/` 下必然有 .js，所以这里同时钉住下限与"确实扫到了"。
    check('P8 coverage: the BOM scan actually reached files', scanned.length >= 10,
      scanned.length + ' file(s) with parsed extensions under lib/');
    check('P8 no published file carries a UTF-8 BOM (JSON.parse does not strip it)',
      offenders.length === 0,
      offenders.length ? 'offenders=[' + offenders.join(', ') + ']' : 'clean (' + scanned.length + ' file(s))');
    check('P8 negative control: a BOM-prefixed buffer is detected, a clean one is not',
      hasBom(Buffer.from([0xEF, 0xBB, 0xBF, 0x2F])) === true
      && hasBom(Buffer.from([0x2F, 0x2A, 0x2A])) === false
      // 正对照：**被换行/空白开头的正常文件**不得误伤
      && hasBom(Buffer.from('// ok\n')) === false);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0
    ? 'ALL PACKAGE FILE CHECKS PASSED'
    : failed.length + ' CHECK(S) FAILED'));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('TEST ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
