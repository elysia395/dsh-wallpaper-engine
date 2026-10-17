/**
 * source-locator.mjs —— **真源定位器**：输入符号名 / 文件名，回答"它唯一的声明处 / 落点在哪"。
 *
 * ══ 为什么需要它（本仓实测的腐化形态）════════════════════════════════════════════
 * 判据里"实现搬了家"这一类的**静默失配**占本分支手工修点的绝大多数（12+ 处）。典型：
 *
 *   · `const DECL_REL = 'lib/component-visibility.js'`：写死一个路径去抠符号。文件一搬，
 *     判据要么 `readFileSync` 抛（读起来像"判据坏了"而不是"锚点搬家了"），要么
 *     `sources.get(rel) || ''` 静默拿到空串 ⇒ **拿错值比对**（红得没道理 / 绿得没道理）。
 *   · 同一份 `const BASE = '/wallpaper-engine'` 在判据里**再抄一遍**：宿主改前缀时判据仍拿旧字面量
 *     去比对，报出来的是"路由没注册"而不是"判据的锚点过期了"。
 *
 * 本工具把"符号在哪"变成一次**可判红的查询**：
 *   · 命中**恰一处** ⇒ 返回 `{ ok: true, hit }`；
 *   · 命中 **0 处**（符号被重命名/删除）或 **多处**（出现第二份真源）⇒ `ok: false` 并列出候选。
 * 于是判据可以写"缺锚即红"，而不是"找不到就用默认值兜底"。
 *
 * ══ 扫描面 ════════════════════════════════════════════════════════════════════
 * `moduleFace()` = `lib/**` + `src/**` 的 `.js`（符号只在**代码**里定位；`docs/**` 的散文不算）。
 * 三条硬口径：
 *   ① **先剥注释**（共享 `js-text.mjs` 的字符串感知实现）⇒ 散文里提到符号不算声明，
 *      也不会把 `// const BASE = ...` 的示例算成第二份真源。
 *   ② **只认真实声明语句**：行首（可含缩进）的 `const|let|var|function|class NAME`。
 *      缩进**不**作为"是不是顶层"的判据 —— 本仓实测 `src/panel-tabs.js` 的
 *      `function renderWallpaperTab(ctx)` 缩进 2、`lib/media/frame-store.js` 的
 *      `const LIVE_FRAME_KEY_VERSION` 在工厂作用域里缩进 2，按"列 0"判会把它们全判成
 *      "零处声明"（假红）。**唯一性**才是本工具的契约：同名声明出现多处一律判红，
 *      由调用方用 `--in lib|src` 收窄，工具绝不替调用方猜哪一处是对的。
 *      代价：函数体内的同名局部（`const f = …`）也算一处 ⇒ 锚点请用**有辨识度的名字**。
 *   ③ **生成物不算真源**：`lib/client.js` 是构建期内联的产物，它把 `src/**` 的模块**逐份复制**进去
 *      ⇒ 不排除它，`src/` 里每个符号都会"命中两处"而**恒红**（工具自己变成无判别力的噪声）。
 *      产物本身的同步由它自己的守卫负责（`verify-client-sync` 等），不是本工具的事。
 *
 * `fileFace()` = 仓库根的直接文件 + `lib/**` + `src/**`（**全部**扩展名）—— 供 `locateFile()`
 * 定位 `cordis.patch.yml` 这类非 `.js` 的声明面文件。
 *
 * ══ 用法 ══════════════════════════════════════════════════════════════════════
 *   node test/tools/source-locator.mjs BASE                # 符号的声明处（唯一才 exit 0）
 *   node test/tools/source-locator.mjs BASE --in lib       # 只在 lib/** 里找（半边作用域）
 *   node test/tools/source-locator.mjs --file settings.js  # 文件（按仓库相对路径或唯一 basename）
 *   node test/tools/source-locator.mjs --calls registerSettingsRoutes
 *   node test/tools/source-locator.mjs --selftest          # 工具自身的正/负对照
 *
 * 在判据里（**缺锚即红**的写法，别用 `||` 兜底）：
 *
 *   import { locate } from './tools/source-locator.mjs';
 *   const decl = locate('COMPONENT_VISIBILITY');          // 也可 { in: 'lib' } 收窄到半边
 *   check('锚点：COMPONENT_VISIBILITY 唯一声明（0 处 / 多处即红）', decl.ok, decl.detail);
 *
 * `verify-guard-map.mjs` 的"守卫 ↔ 模块"映射也认这个形态（`guard-targets.mjs` 的 G 类）：
 * 判据里写 `locate('X')` 而不是字面量路径，映射仍能算出"这条守卫读了 X 的模块"。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripComments } from './js-text.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `test/tools/` 比仓库根深两层（与 `guard-targets.mjs` 同口径）。 */
export const ROOT = join(HERE, '..', '..');

/**
 * 生成物（内联产物）的识别标记：**只认代码标记**，不认散文。
 * ⚠️ 别加 `构建期内联` 这类**注释词**当标记：它出现在 `lib/index.js` / `src/panel-tabs.js`
 * 的头注释里（本仓实测），会把两份真源文件误判成产物 ⇒ 它们的锚点全部"零处声明"（假红）。
 * 沿用 `guard-targets.mjs` 对 `lib/client.js` 的判法：产物有一句唯一的加载器调用。
 */
const BUNDLE_MARKERS = [/__ModuleLoader__\.load\s*\(/];
/** 不参与扫描的目录名（`docs/**` 的散文、缓存、依赖都不算代码面）。 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.test-cache', '.npm-cache', 'docs', 'assets', '_refs']);

/** 相对路径的 posix 形态（Windows 上也一致，报错信息才可跨平台比对）。 */
const posix = (p) => p.split(sep).join('/');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 递归枚举 `dir` 下的文件（相对 `root` 的 posix 路径），跳过 `SKIP_DIRS`。 */
function walkFiles(root, dir, out = []) {
  // ⚠️ 两个 `let` 都**不带初值**：`let names = []` / `let st = null` 的初值永远不会被读到
  // （下面的 catch 直接早退 / continue）⇒ 会被静态门禁的 `no-useless-assignment` 判红
  // （本仓基线是空棘轮，只能减不能增）。
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walkFiles(root, abs, out);
    else if (st.isFile()) out.push(posix(relative(root, abs)));
  }
  return out;
}

/** 生成物？只看文件**头部**：内联产物的标记一定在 banner 里。 */
export function isGeneratedBundle(text) {
  const head = String(text).slice(0, 4000);
  return BUNDLE_MARKERS.some((re) => re.test(head));
}

/** 符号真源面：`lib/**` + `src/**` 的 `.js`（**含**生成物；是否排除由 `index()` 定，口径 ③）。 */
export function moduleFace(root = ROOT) {
  const all = [...walkFiles(root, join(root, 'lib')), ...walkFiles(root, join(root, 'src'))];
  return all.filter((rel) => /\.(js|mjs|cjs)$/.test(rel)).sort();
}

/** 文件真源面：仓库根的直接文件 + `lib/**` + `src/**`（全部扩展名）。 */
export function fileFace(root = ROOT) {
  let rootFiles = [];
  try {
    rootFiles = readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch { /* 根不可读 ⇒ 只剩 lib/src 面 */ }
  return [...new Set([...rootFiles, ...walkFiles(root, join(root, 'lib')), ...walkFiles(root, join(root, 'src'))])].sort();
}

/**
 * 从**一段源码**里抽出声明（已剥注释）。返回 `[{ symbol, kind, line, indent, text }]`。
 *
 * 缩进不是过滤条件（文件头口径 ②），每个命中都带上 `indent` 供报错信息用。
 * 多声明符一行（`const a = 1, b = 2;`）里后面的名字也认，但**不跨行**：跨行列表
 * （`const a = 1,\n b = 2;`）只认第一个 —— 真源锚点应当一条一行，漏认会**报红（0 处）**
 * 而不是静默取错值，方向安全。
 */
export function parseDeclarations(raw) {
  const text = stripComments(String(raw));
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = (line.match(/^[ \t]*/) || [''])[0].length;
    let m = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { out.push({ symbol: m[1], kind: 'function', line: i + 1, indent, text: line.trim() }); continue; }
    m = /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { out.push({ symbol: m[1], kind: 'class', line: i + 1, indent, text: line.trim() }); continue; }
    m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/.exec(line);
    if (m) {
      out.push({ symbol: m[1], kind: 'binding', line: i + 1, indent, text: line.trim() });
      // 同一行的后续声明符：`const a = 1, b = 2;`
      for (const d of line.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
        out.push({ symbol: d[1], kind: 'binding', line: i + 1, indent, text: line.trim() });
      }
    }
  }
  return out;
}

/** `in` 作用域过滤器：`rel === in` 或 `rel.startsWith(in + '/')`（既可给目录也可给一个文件）。 */
function inScope(rel, inOpt) {
  if (!inOpt) return true;
  const want = String(inOpt).split(sep).join('/').replace(/\/+$/, '');
  return rel === want || rel.startsWith(want + '/');
}

/**
 * 由**内存里的** `Map<rel, text>` 建索引（负对照用；不碰磁盘）。
 * **同一条生成物排除规则**也在这里生效 ⇒ 合成夹具与生产输入走同一份口径。
 */
export function indexFromSources(sources) {
  const bySymbol = new Map();
  const byFile = new Map();
  const files = new Map();
  for (const [rel, raw] of sources) {
    const base = rel.split('/').pop();
    if (!files.has(base)) files.set(base, []);
    if (!files.get(base).includes(rel)) files.get(base).push(rel);
    if (isGeneratedBundle(raw)) continue; // 口径 ③
    byFile.set(rel, [rel]);
    for (const d of parseDeclarations(raw)) {
      if (!bySymbol.has(d.symbol)) bySymbol.set(d.symbol, []);
      bySymbol.get(d.symbol).push({ rel, ...d });
    }
  }
  return { bySymbol, byFile, files, sources: new Map([...sources].filter(([, t]) => !isGeneratedBundle(t))) };
}

let CACHE = new Map();
/** 真源索引（按 root 缓存一次；工具里多处查询不重复扫盘）。 */
export function index(root = ROOT) {
  if (CACHE.has(root)) return CACHE.get(root);
  const sources = new Map();
  for (const rel of moduleFace(root)) {
    // 同上：初值读不到（catch 里 continue）⇒ 声明不带初值。
    let text;
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    if (isGeneratedBundle(text)) continue; // 口径 ③：产物不是真源
    sources.set(rel, text);
  }
  const idx = indexFromSources(sources);
  const files = new Map();
  for (const rel of fileFace(root)) {
    const base = rel.split('/').pop();
    if (!files.has(base)) files.set(base, []);
    if (!files.get(base).includes(rel)) files.get(base).push(rel);
  }
  idx.files = files;
  CACHE.set(root, idx);
  return idx;
}

/** 供测试清缓存用（判据里用不到）。 */
export function resetIndexCache() { CACHE = new Map(); }

/** 候选列表的可读渲染。 */
const renderHits = (hits) => hits.map((h) => h.rel + ':' + (h.line || 0) + ' (' + h.kind + ') ' + h.text).join(' · ');

/**
 * 定位符号的**顶层声明**。
 * @param {string} symbol 符号名（区分大小写）
 * @param {{root?: string, in?: string, index?: object}} [opts] `in` = 路径（或路径前缀），
 *        用于"同一个名字在宿主与客户端两边各有一份声明"的场合（如 `BASE`）——**必须显式给**，
 *        工具绝不替调用方猜哪一份是对的。
 * @returns {{ok: boolean, symbol: string, hit: object|null, hits: object[], detail: string}}
 */
export function locate(symbol, opts = {}) {
  const root = opts.root || ROOT;
  const idx = opts.index || index(root);
  const hits = (idx.bySymbol.get(symbol) || []).filter((h) => inScope(h.rel, opts.in));
  const scope = opts.in ? '（限定 ' + opts.in + '/**）' : '';
  if (hits.length === 1) {
    return { ok: true, symbol, hit: hits[0], hits, detail: symbol + ' ⇒ ' + hits[0].rel + ':' + hits[0].line + scope };
  }
  if (hits.length === 0) {
    return {
      ok: false, symbol, hit: null, hits,
      detail: symbol + ' 在真源面' + scope + '**零处声明**（重命名 / 搬家到扫描面之外 / 被删）'
        + ' —— 缺锚即红，不许回落到默认值',
    };
  }
  return {
    ok: false, symbol, hit: null, hits,
    detail: symbol + ' 在真源面' + scope + '有 **' + hits.length + ' 处声明**（第二份真源 = 谁对不确定）'
      + '：' + renderHits(hits),
  };
}

/**
 * 定位**文件**：先按完整相对路径（posix），再按唯一 basename。
 * 多处同名（`index.js`）⇒ `ok: false` 并列出候选。
 */
export function locateFile(name, opts = {}) {
  const root = opts.root || ROOT;
  const idx = opts.index || index(root);
  const want = String(name).split(sep).join('/');
  const base = want.split('/').pop();
  const all = [...new Set([...(idx.files && idx.files.get(base) ? idx.files.get(base) : []), ...fileFace(root)])];
  const exact = all.filter((r) => r === want || r.endsWith('/' + want));
  const cands = (exact.length ? exact : all.filter((r) => r.split('/').pop() === base)).filter((r) => inScope(r, opts.in));
  if (cands.length === 1) {
    return { ok: true, name: want, hit: { rel: cands[0], line: 0, kind: 'file', text: want }, hits: cands.map((rel) => ({ rel })), detail: want + ' ⇒ ' + cands[0] };
  }
  if (cands.length === 0) return { ok: false, name: want, hit: null, hits: [], detail: '文件 ' + want + ' 在真源面（root + lib/** + src/**）**不存在** —— 缺锚即红' };
  return { ok: false, name: want, hit: null, hits: cands.map((rel) => ({ rel })), detail: '文件 ' + want + ' 有多处同名候选：' + cands.join(' · ') + '（写完整相对路径）' };
}

/**
 * 定位**调用点**：`(^|[^.\w$])symbol(` 且不是 `function symbol(` 的定义处。
 * 用于"注册调用在哪一行"这种跨文件锚点（`registerSettingsRoutes(webServer, …)`）。
 */
export function locateCallSites(symbol, opts = {}) {
  const root = opts.root || ROOT;
  const idx = opts.index || index(root);
  const hits = [];
  for (const [rel, raw] of idx.sources) {
    if (!inScope(rel, opts.in)) continue;
    const text = stripComments(String(raw));
    const re = new RegExp('(^|[^.\\w$])' + esc(symbol) + '\\s*\\(', 'g');
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].indexOf(symbol);
      if (/(?:^|[^\w$])(?:async\s+)?function\s+$/.test(text.slice(0, at))) continue; // 定义处不算调用点
      hits.push({ rel, line: text.slice(0, at).split('\n').length, kind: 'call', text: text.slice(at, at + 80).split('\n')[0].trim() });
    }
  }
  if (hits.length === 1) return { ok: true, symbol, hit: hits[0], hits, detail: symbol + '() 调用点 ⇒ ' + hits[0].rel + ':' + hits[0].line };
  if (hits.length === 0) return { ok: false, symbol, hit: null, hits, detail: symbol + '() 在真源面**零处调用点** —— 缺锚即红' };
  return { ok: false, symbol, hit: null, hits, detail: symbol + '() 有 ' + hits.length + ' 处调用点：' + renderHits(hits) };
}

// ── 工具自身的有牙自检（正/负对照调上面**同一份**实现）────────────────────────────
export function selftest(ok) {
  // 合成真源面：
  //   · `src/c.js` 的 `UNIQ_B` 唯一；`lib/b.js` 里只在**注释**提到它（口径 ① 的负对照）。
  //   · `lib/b.js` 的 `SAME` 是第一处；`lib/gen.js`（内联产物）里有列 0 的同名声明（口径 ③ 的负对照）。
  //   · `lib/a.js` 的 `UNIQ_LOCAL` 在**缩进**的工厂作用域里（口径 ②：缩进不算过滤条件 —— 本仓实测
  //     `src/panel-tabs.js` / `lib/media/frame-store.js` 的真锚点都在缩进层）。
  const face = new Map([
    ['lib/a.js', 'export const UNIQ_A = 1;\nfunction indented() {\n  const UNIQ_LOCAL = 2;\n  return UNIQ_LOCAL;\n}\n'],
    ['lib/b.js', "// const UNIQ_B = 999;  // 注释里的示例不算声明\nconst SAME = 4;\n"],
    ['src/c.js', 'const UNIQ_B = 3;\nconst SOMENAME = 4, OTHER = 5;\n'],
    ['lib/gen.js', "window.__ModuleLoader__.load({ id: 'x', factory: () => { return 1; } });\nconst SAME = 5;\n"],
  ]);
  const idx = indexFromSources(face);
  const hitRels = (sym, inOpt) => locate(sym, { index: idx, in: inOpt }).hits.map((h) => h.rel);
  const dupFace = indexFromSources(new Map([['lib/d1.js', 'const DUP = 1;\n'], ['lib/d2.js', 'const DUP = 2;\n']]));

  ok('唯一声明 ⇒ ok 且给出 行号', locate('UNIQ_A', { index: idx }).ok && locate('UNIQ_A', { index: idx }).hit.line === 1);
  ok('**多处声明** ⇒ 判红并列出候选（不许静默取第一个）',
    locate('DUP', { index: dupFace }).ok === false && locate('DUP', { index: dupFace }).hits.length === 2,
    locate('DUP', { index: dupFace }).detail);
  ok('**零处声明** ⇒ 判红（缺锚即红，不回落默认值）',
    locate('__NOPE__', { index: idx }).ok === false && /零处声明/.test(locate('__NOPE__', { index: idx }).detail));
  ok('negative control: 注释里的"声明"不算（`// const UNIQ_B = 999` 不制造第二处）',
    locate('UNIQ_B', { index: idx }).ok === true && hitRels('UNIQ_B').join() === 'src/c.js');
  ok('口径 ②：缩进的工厂作用域声明**算**真源（本仓锚点的真实形态，按列 0 判会假红）',
    locate('UNIQ_LOCAL', { index: idx }).ok === true && locate('UNIQ_LOCAL', { index: idx }).hit.indent === 2);
  ok('negative control: 生成物里的同名声明不算真源（内联副本不制造"第二处"）',
    !hitRels('SAME').includes('lib/gen.js') && isGeneratedBundle(face.get('lib/gen.js'))
    && locate('SAME', { index: idx }).ok === true);
  ok('`in` 作用域：同一个名字在 lib / src 两边各有一份 ⇒ 各自唯一（工具不替调用方猜）',
    hitRels('SAME', 'lib').join() === 'lib/b.js' && hitRels('UNIQ_B', 'src').join() === 'src/c.js');
  ok('多声明符一行：`const A = 1, B = 2;` 两个名字都认',
    locate('SOMENAME', { index: idx }).ok && locate('OTHER', { index: idx }).ok);
  ok('negative control: 空符号名必须红，绝不返回空成功', locate('', { index: idx }).ok === false);
  ok('locateCallSites：函数**定义处**不算调用点，真调用点才算',
    locateCallSites('f', { index: indexFromSources(new Map([['lib/x.js', 'function f() {}\nconst y = f();\n']])) }).hits.length === 1);
  ok('locateCallSites：多处调用点 ⇒ 判红（不猜哪一个）',
    locateCallSites('f', { index: indexFromSources(new Map([['lib/x.js', 'function f() {}\nf();\nf();\n']])) }).ok === false);
  return true;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const optOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  let failed = 0;
  const report = (label, r) => {
    if (r.ok) console.log('  ✓ ' + r.detail);
    else { console.log('  ✗ ' + label + '：' + r.detail); failed++; }
  };
  if (args.includes('--selftest')) {
    selftest((name, cond, detail) => {
      if (cond) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
      else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
    });
  } else if (optOf('--file')) {
    report('file', locateFile(optOf('--file'), { in: optOf('--in') }));
  } else if (optOf('--calls')) {
    report('calls', locateCallSites(optOf('--calls'), { in: optOf('--in') }));
  } else {
    const symbol = args.find((a) => !a.startsWith('--') && a !== optOf('--in'));
    if (!symbol) {
      console.log('用法：node test/tools/source-locator.mjs <符号名> [--in lib|src] | --file <名> | --calls <符号> | --selftest');
      process.exit(2);
    }
    report(symbol, locate(symbol, { in: optOf('--in') }));
  }
  if (failed) { console.log('\nSOURCE LOCATOR FAILED — ' + failed + ' failed'); process.exit(1); }
  console.log('\nSOURCE LOCATOR OK');
  process.exit(0);
}

export { posix };
