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
import { stripComments } from './tools/js-text.mjs';

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

/** 源码里的**裸包** import 说明符：跳过相对路径 / 绝对路径 / 内置模块。
 *  P5 的主扫描与负对照共用这一条判据。 */
function bareImportSpecs(src) {
  const out = [];
  for (const m of stripComments(src).matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)[\'"]([^\'"]+)[\'"]/g)) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('/')) continue;
    if (BUILTIN_ROOTS.has(specRoot(spec))) continue;
    out.push(spec);
  }
  return out;
}

// ── lib/ 文件枚举 + `files` 条目覆盖判定 ────────────────────────────────────
/** 递归列出 dir 下的文件 (相对 ROOT 的 posix 路径, 已排序)。 */
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
    const consumes = (dep, src) => !dep.startsWith('.') && !dep.startsWith('/')
      && !(dep.startsWith('node:') || BUILTIN_ROOTS.has(specRoot(dep)))
      && consumerRe(dep).test(src);
    const consumers = deps.filter((d) => consumes(d, libSrc));
    const orphans = deps.filter((d) => !consumers.includes(d));
    check('P4 every declared dependency is imported by lib/ (no dead declaration)',
      orphans.length === 0,
      'deps=' + deps.length + ' consumers=[' + consumers.join(', ') + '] orphans=[' + orphans.join(', ') + ']');
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
    ];
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
    // 地板 = 本轮实测步数（新增不受限，**删或改名即判红**）。`docs` 整组软档也设 1：
    // 设 0 的话"整组被删空"会和"设计如此"无法区分。
    const CHAIN_FLOOR = { verify: 24, docs: 1, smoke: 5, 'verify:all': 29 };
    const problems = [];
    const scripts = new Set();
    const counts = [];
    for (const [key, group] of GROUPS) {
      const bad = shapeError((pkg.scripts || {})[key], key, group);
      if (bad) { problems.push(bad); continue; }
      let listed;
      try {
        const out = execFileSync(process.execPath, [join(ROOT, 'test/run-guards.mjs'), group, '--list-json'], { cwd: ROOT, encoding: 'utf8' });
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
      if (steps.length < CHAIN_FLOOR[group]) problems.push(key + ' 步数 ' + steps.length + ' < 地板 ' + CHAIN_FLOOR[group]);
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
      let src = '';
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
    check('P5 negative control: the script-shape predicate rejects a wrong group, an extra step and the old inline chain',
      shapeError('node test/run-guards.mjs verify', 'verify', 'verify') === null
      && shapeError('node test/run-guards.mjs docs', 'verify', 'verify') !== null
      && shapeError('node test/run-guards.mjs smoke', 'smoke', 'smoke') === null
      // 旧形态（一条 `&&` 长链）不得被当成合法 —— 它正是"取源漂了"的那一形态
      && shapeError('node test/verify-client-sync.mjs && node test/verify-client.mjs', 'verify', 'verify') !== null
      // 多挂一步（`node test/run-guards.mjs verify && node other.mjs`）也不合法
      && shapeError('node test/run-guards.mjs verify && node test/verify-about.mjs', 'verify', 'verify') !== null
      && shapeError('node test/other.mjs verify', 'verify', 'verify') !== null);
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
  //（`docs/archive/wip/POST-REFACTOR-AUDIT.md` §4.9 早就点出那个盲区）。这里改按扩展名全扫，不再硬编码名单。
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
