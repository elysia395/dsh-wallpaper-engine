/**
 * verify-bundle-rows.mjs —— 发布面的**行不变量**守卫（P2-0 新增；两条「静默整体消失」红线的第一套判据）。
 *
 * 为什么需要：`cordis.patch.yml` 是"这个包到底往宿主里插入哪几行"的唯一声明面，而它与
 * `package.json` 的发布面契约咬在一起（`dsh.bundle.patch` → patch 文件；`dsh.client` →
 * `exports['./client']`）。其中任何一层**整体消失**都不会有任何运行期报错：宿主照常启动，
 * 只是这个插件根本不存在（用户侧表现为"装上了但什么也没发生"）。在此之前这三层没有任何判据钉住。
 *
 * 判据（只断言**仓库根**那一份 patch，不读用户 profile —— profile 由宿主写，依赖它会把本机
 * 状态拖进 CI；见 `.integration-notes/scratch/p2-0-recon.md` §5-4）：
 *   ① patch 结构：恰好一个顶层 `- insert:`；其下每行都有非空 `id`、都有 `name`；
 *      恰好一行的 `name` 等于裸包名；其余行的 `name` 必须形如 `<裸包名>/<子路径>`；
 *   ② 行 `id` 全局唯一（重复 `id` 会让宿主只加载其中一行，另一行静默消失）；
 *   ③ `dsh.bundle.patch === './cordis.patch.yml'`；声明了 `dsh.client` ⇒ `exports['./client']` 必须在；
 *   ④ `peerDependencies` 键集合 ⊆ 既有 5 个（peer 门禁是**包级**的：多加一个 DSH peer 会让所有
 *      没装它的用户装不上 ⇒ 只许减不许增）；
 *   ⑤ 组件分发点：`lib/index.js` 导出 `applyComponent`（P2-0 脚手架；P2-1 起表里有真实组件行）；
 *   ⑥ 组件行（P2-1/P2-2，**逐行数据驱动**：组件名一律现取 patch 子行，不写死）：patch 的每个
 *      子行 ⇄ `exports` 三连（入口 / 清单 / locale）；`files` 覆盖组件目录的**每一个**文件
 *      （入口 / 清单 / 图标 / locale 四类）；入口有非空 `export const name`（**不要求**等于行名）；
 *      `applyComponent` 真能加载每个组件行，且注册条数 == 它调用的路由族条数；组件入口的独立
 *      plugin 路径与门面 `applyComponent` 注册出同一组 `(kind, path)`；未知组件名仍然抛；
 *      「合成 N 行」并集条数 == **各 bundle 行声明注册数之和**（跨源对账：单点真源 =
 *      `MAIN_MODULES` × `rowRegistrationCounts`，不写死数字）且跨行无重复 `(kind, path)`；环的**双向**判据（P2-2 O2/O4）：组件
 *      入口与门面的**模块作用域**都不许出现对方的导入标识符（P2-1b 起实现表建在函数体内）；
 *      P2-2b 拆环后另有**结构判据**：组件入口不得 `import` / re-export 门面（任意写法，含
 *      `export … from` —— 再导出在模块作用域不产生名字，文本级那条测不到）；
 *      `moduleScopeOf` 从 `test/tools/js-text.mjs` 取（O7 归一到一份，且认正则字面量 ⇒ O3 修复）；
 *   ⑦ 内核租约语义（D5）：两个会话共享内核时，先 release 的**不**释放共享资源；计数归零后
 *      再 release 必须幂等（不抛、不再 dispose）。真 import 真模块跑，不在源码里找字符串。
 *   ⑧ 组件装载探针（P2-4 A2）：`/diag-log` 的响应体带 `components`（`declared` / `loaded` / `missing`）。
 *      判据**走真实路径**核对 —— 在 mock webServer 上跑门面 `apply()` 取注册的 `/diag-log` 处理器，
 *      用假 req/res 调用并 `JSON.parse`，而不是另造一份合成探针：这样"探针字段丢了 / 键名改了 /
 *      没接进 diag 路由"都会红。未装载任何组件时 `loaded` 必须为空、`missing == declared`；
 *      装载后 `loaded` 覆盖全部组件行、`missing` 为空；Content-Type 仍是 `application/json`。
 *   ⑧c（P2-6）fiber 卸载必须真的撤路由：`apply` 交回的 teardown **也要**交给 fiber（`ctx.effect`）——
 *      cordis 对**有 `prototype`** 的插件回调（`export function apply(…)`）走 `new callback(ctx, config)`
 *      分支、**返回值被丢弃** ⇒ 只 `return dispose` 时 fiber 卸载不撤路由，关掉再打开撞
 *      `webserver: duplicate … route`（真机故障）。判据 = 模拟构造分支（丢返回值）的
 *      「装载 → 卸载 → 再装载」往返 + 一条负对照 + 真 cordis 往返（缺 `node_modules` 依赖时**出声**跳过）。
 *   ⑨ `moduleScopeWithoutImports` 的 import 形态夹具（P2-4 O2）：跨行 import 与"import 行带尾注释"
 *      两种形态都必须只剥掉 import 自身、**不**连带吞掉后续真实引用（吞掉 = 判据静默变绿）。
 *   ⑩ P2-5B 补牙：`moduleScopeWithoutImports` 的跨行状态机 / 收尾复位 / 副作用导入短路 / 动态
 *      `import(` 各有一条**必要条件**夹具（P2-4 O4 的"拿掉也不红"）；夹具形态是实测挑的：`import`
 *      与绑定名分行、花括号表与 `from` 分行这两类续行**真的载着绑定名**，而纯跨行花括号表被
 *      `moduleScopeOf` 提前折叠（对状态机/复位零区分度）；`lib/host-boot.js` 的内核单例必须
 *      **在模块求值期构造**（模块作用域文本里 `createHostKernel(` 恰好 1 次，懒化/外包/重复构造都红）。
 *
 * ⚠️ **不 import js-yaml**：本文件**有意留在链外**（不在 `test/run-guards.mjs` 的链上；豁免理由见
 * `test/tools/guard-chain.mjs` 的 `OFF_CHAIN_WHY`），而"链上脚本零裸包 import"是链上的硬判据
 * （`test/verify-package-files.mjs` P5；CI 不跑 npm ci）—— P5 只扫链上脚本顶层源码，本文件**不在**
 * 它的扫描面内；即便如此仍保持与链上同口径的零裸包形态。js-yaml 只是 `overrides` 里的 lock 残留。
 * 两份 patch 都是简单列表 ⇒ 行级解析足够，且比引入解析器更可控。
 *
 * Usage:  node test/verify-bundle-rows.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { moduleScopeOf, stripComments, functionBodyOf } from './tools/js-text.mjs';
import { buildIndex, rowRegistrationCounts, MAIN_MODULES, SUBPACKAGE_MODULES } from './tools/host-route-index.mjs';
import { createSubpackageHost, provideSubpackageHost } from '../lib/subpackage-boot.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BARE = 'dsh-plugin-wallpaper-engine';
const PATCH_REL = 'cordis.patch.yml';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
const section = (t) => console.log('\n' + t);

/** 行级标量取值：剥引号；非引号形态下切掉行尾 ` #` 注释。 */
function scalar(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const q = s[0];
  if (q === "'" || q === '"') {
    const end = s.indexOf(q, 1);
    return end > 0 ? s.slice(1, end) : s.slice(1);
  }
  const hash = s.indexOf(' #');
  return (hash >= 0 ? s.slice(0, hash) : s).trim();
}

/**
 * 跨源对账判据本体（生产与负对照调**同一份**）：`observed` 并集条数 + 各 bundle 行的声明期望
 * + 跨行重复键 ⇒ 问题清单（空 = 一致）。取代原先写死的 `registered.length === 42` 快照。
 *
 * @param {number} observed 实跑注册并集条数
 * @param {Array<{rel: string, expected: number, unknown: string[]}>} rowExpected 每个 bundle 行的声明期望
 * @param {string[]} dupes 跨行重复的 `(kind, path)` 键
 * @returns {{bad: string[], expected: number}}
 */
function unionReconciliation(observed, rowExpected, dupes) {
  const bad = [];
  const unresolved = rowExpected.filter((r) => r.unknown && r.unknown.length);
  if (unresolved.length) {
    bad.push('调用点解析不到路由族：' + unresolved.map((r) => r.rel + '(' + r.unknown.join(',') + ')').join(' '));
  }
  const expected = rowExpected.reduce((n, r) => n + (Number(r.expected) || 0), 0);
  if (expected !== observed) {
    bad.push('并集 ' + observed + ' 条 ≠ Σ 行声明 ' + expected + ' 条（'
      + rowExpected.map((r) => r.rel + '=' + r.expected).join(' + ') + '）');
  }
  if (dupes && dupes.length) bad.push('跨行重复 (kind, path)：' + dupes.join(' · '));
  return { bad, expected };
}

/**
 * 行级解析 `- insert:` 块里的行（YAML list item）。只认本仓 patch 的实际形态：
 * 顶层 `- insert:`，其下是缩进的 `- key: value` 行；行的首键缩进 = `-` 缩进 + 2，
 * 更深的键（如 `config:` 下的嵌套 map）不算行键。
 * 返回每个 insert 块的行表：`[[{ line, id, name }, …], …]`。
 */
function parseInsertRows(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const inserts = [];
  let cur = null;      // 当前 insert 块的行表（null = 不在任何 insert 块内）
  let keyIndent = -1;  // 当前行的首键缩进
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
    const mIns = /^(\s*)-\s*insert:\s*$/.exec(raw);
    if (mIns) { cur = []; inserts.push(cur); keyIndent = -1; continue; }
    if (!cur) continue;
    const mRow = /^(\s*)-\s*(.*)$/.exec(raw);
    if (mRow) {
      keyIndent = mRow[1].length + 2;
      cur.push({ line: i + 1, id: '', name: '' });
      const inline = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(mRow[2]);
      if (inline) recordKey(cur[cur.length - 1], inline[1], inline[2]);
      continue;
    }
    const mKey = /^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (!mKey) continue;
    if (mKey[1].length !== keyIndent) { if (mKey[1].length < keyIndent) cur = null; continue; }
    recordKey(cur[cur.length - 1], mKey[2], mKey[3]);
  }
  return inserts;
}

/** 只记行自己的 `id` / `name`（首见为准；嵌套键已被缩进过滤掉）。 */
function recordKey(row, key, value) {
  if (key === 'id' && !row.id) row.id = scalar(value);
  else if (key === 'name' && !row.name) row.name = scalar(value);
}

/**
 * 从入口源码里解出**从门面 `lib/index.js` import 进来的本地名** —— 环判据（O2/O4）的问句是
 * "模块作用域里有没有出现这些名字"，而不是"有没有出现某个固定函数名"。
 *
 * 为什么要解析而不是写死 `applyComponent`：门面还可能导出别的东西，组件也可能用别名
 * （`import { applyImpl as x }`）；写死函数名的话，换一个门面导出就能绕过判据。
 * 说明符按"相对本文件的路径解析后是否等于门面"来认（组件入口在 `lib/components/<sub>/` ⇒
 * 典型写法是 `'../../index.js'`），不依赖具体写法。
 *
 * P2-3D（D2 硬化）：此前只认**具名** import ⇒ `import facade from '../../index.js'` 与
 * `import * as facade from '../../index.js'` 解析出的名字集合是**空的**（p1b-recon 实验 E2：
 * 具名 1 / 具名别名 1 / 默认 0 / 命名空间 0）⇒ 把模块作用域里的门面引用改写成默认导入，那条
 * TDZ 判据当场空转。现在三种形态都解析，取**本地绑定名**：具名（`as` 之后的名字）、默认
 * （绑定名）、命名空间（`* as` 之后的名字），外加"默认 + 具名"混合形态。
 */
function facadeImportNames(src, rel) {
  const dir = dirname(join(ROOT, rel));
  // 先剥注释：文件头 JSDoc 会**引用**被删掉的旧写法做档案说明（`import { applyComponent } from
  // '../../index.js'` 已删），那不是真边 —— 不剥就会把注释里的例子当成导入名（结构判据已按语句
  // 判，这里保持一致，免得判据详情自相矛盾）。
  return importNamesFrom(stripComments(String(src)), (spec) => spec.startsWith('.') && join(dir, spec) === join(ROOT, 'lib', 'index.js'));
}

/**
 * 解析 `import … from '<spec>'` 语句的**本地绑定名**，`matchSpec(spec)` 为真时收集该语句的名字。
 * 覆盖三种形态（D2）：具名表 / 默认绑定 / 命名空间绑定（`* as X`），外加"默认 + 具名"混合。
 * @param {string} src 源码
 * @param {(spec: string) => boolean} matchSpec 说明符过滤器（按解析后的绝对路径判，不写死写法）
 * @returns {string[]} 本地绑定名（按语句出现顺序）
 */
function importNamesFrom(src, matchSpec) {
  const names = [];
  const addNamed = (part) => {
    const t = part.trim();
    if (!t) return;
    const [orig, local] = t.split(/\s+as\s+/).map((s) => s.trim());
    if (orig || local) names.push(local || orig);
  };
  // ① 具名：`import { a, b as c } from '<spec>'`
  for (const m of String(src).matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!matchSpec(m[2])) continue;
    for (const part of m[1].split(',')) addNamed(part);
  }
  // ② 默认 / 命名空间 / 默认+具名：`import X from` · `import * as X from` · `import X, { … } from`
  //    ① 要求 `{` 紧跟 `import`，混合形态的 `{` 前面还有默认名 ⇒ ① 不匹配它，同一个名字不会收两遍；
  //    混合形态里的具名表由这里补收（本地名口径同 ①）。
  for (const m of String(src).matchAll(/import\s+([A-Za-z_$][\w$]*|\*\s*as\s+[A-Za-z_$][\w$]*)\s*(?:,\s*\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!matchSpec(m[3])) continue;
    const head = m[1].trim();
    names.push(/^\*/.test(head) ? head.replace(/^\*\s*as\s+/, '').trim() : head);
    if (m[2]) for (const part of m[2].split(',')) addNamed(part);
  }
  return names;
}

/**
 * 模块作用域文本里**剔除 import 语句自身**：导入绑定名出现在 `import` 行上不算"引用门面"，
 * 否则 `import facade from '<门面>'` 这种形态会被判据拿自己的绑定声明误判成违规（假阳性），
 * 而真正要抓的是**模块求值期真的读了门面导出**（`facade.applyComponent(…)` 出现在模块作用域）。
 * 具名 import 的说明符表本来就被 `moduleScopeOf` 当"体内"抠掉；这里补齐默认/命名空间形态。
 * 只影响**扫描用文本**，不改任何判据的名字 / 字面量 / 最小条数。
 * @param {string} src 源码
 * @returns {string} 模块作用域文本（import 语句按行替换成空格）
 */
function moduleScopeWithoutImports(src) {
  const lines = moduleScopeOf(src).split('\n');
  let inImport = false;
  return lines.map((line) => {
    if (/^\s*import\s*(?!\()/.test(line)) {
      // 无 `from` 的副作用导入（`import 'x';`）只占一行；其余按"直到 `from '…'`"跨行吃掉。
      if (/^\s*import\s*['"][^'"]+['"]\s*;?\s*$/.test(line)) return ' ';
      inImport = !/\bfrom\s*['"][^'"]+['"]\s*;?\s*$/.test(line);
      return ' ';
    }
    if (inImport) {
      if (/\bfrom\s*['"][^'"]+['"]\s*;?\s*$/.test(line)) inImport = false;
      return ' ';
    }
    return line;
  }).join('\n');
}

/**
 * 组件入口 → 门面的**结构性边**（P2-2b 拆环）：import（具名 / 默认 / 命名空间 / 副作用）或
 * re-export（`export … from` / `export * from`），**任意写法**。返回匹配到的说明符列表，空 = 没有这条边。
 *
 * 为什么不能只靠 `facadeImportNames` 的类型集合：那条判据问的是"模块作用域里有没有出现**这些名字**"，
 * 它天然是**文本级**的；`export { x } from '../../index.js'` 这类再导出不会在模块作用域产生名字，
 * 边还在却测不到。拆环后的契约是"组件入口根本没有这条边" —— 所以这里按**语句**判，与名字无关。
 */
function facadeEdgeSpecs(src, rel) {
  const dir = dirname(join(ROOT, rel));
  const facadePath = join(ROOT, 'lib', 'index.js');
  const out = [];
  const hit = (spec) => spec.startsWith('.') && join(dir, spec) === facadePath;
  // 先剥注释（`stripComments` 注释 → 等长空格，行号列偏移不变）：文件头 JSDoc 里会**引用**被删掉的
  // 旧写法（如「`import { applyComponent } from '../../index.js'` 已删」）做档案说明，那不算边。
  const text = stripComments(String(src));
  const patterns = [
    /import\s*(?:[^'"]*?)\bfrom\s*['"]([^'"]+)['"]/g, // 具名 / 默认 / 命名空间 / 混合
    /import\s*['"]([^'"]+)['"]/g,                    // 副作用导入
    /export\s*(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\s*['"]([^'"]+)['"]/g, // re-export
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) if (hit(m[1])) out.push(m[1]);
  return out;
}

/** 词边界出现（`x` 不得被 `xy` / `a.x` 命中）。 */
function namesHit(text, names) {
  return names.filter((n) => new RegExp('(^|[^.\\w$])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text));
}

/**
 * 行不变量判据（**唯一一份**）：正判据与全部负对照都调它。
 * 返回违反项 `[{ kind, detail }]`，空数组 = 通过。
 */
function rowViolations(inserts, bare, allowedSubpackages = new Set()) {
  const out = [];
  if (inserts.length !== 1) out.push({ kind: 'inserts', detail: '顶层 `- insert:` 恰好 1 个（实测 ' + inserts.length + ' 个）' });
  const rows = inserts.flat();
  const noId = rows.filter((r) => !r.id);
  if (noId.length) out.push({ kind: 'id', detail: '每行 id 非空（第 ' + noId.map((r) => r.line).join(', ') + ' 行缺失）' });
  const seen = new Map();
  for (const r of rows) {
    if (!r.id) continue;
    if (seen.has(r.id)) out.push({ kind: 'id', detail: 'id `' + r.id + '` 重复（第 ' + seen.get(r.id) + ' 行与第 ' + r.line + ' 行）' });
    else seen.set(r.id, r.line);
  }
  const nameless = rows.filter((r) => !r.name);
  if (nameless.length) out.push({ kind: 'name', detail: '每行都要有 name（第 ' + nameless.map((r) => r.line).join(', ') + ' 行没有）' });
  const bareRows = rows.filter((r) => r.name === bare);
  if (bareRows.length !== 1) out.push({ kind: 'bare', detail: '恰好 1 行的 name 等于裸包名 `' + bare + '`（实测 ' + bareRows.length + ' 行）' });
  // P-A 起 patch 里有第二种子行：**子包真名**（宿主按包名加载 `packages/<pkg>/index.js`）。
  // 判据不能只看前缀（"凭空多一行包名"会被静默放行），必须对着磁盘上真实的子包清单名来认。
  const bad = rows.filter((r) => r.name && r.name !== bare && !r.name.startsWith(bare + '/') && !allowedSubpackages.has(r.name));
  if (bad.length) out.push({ kind: 'subpath', detail: '其余行的 name 必须是 `' + bare + '/<子路径>`（组件行）或盘上真实存在的子包真名（P-A；第 ' + bad.map((r) => r.line).join(', ') + ' 行：' + bad.map((r) => r.name).join(' ') + '）' });
  return out;
}

/**
 * 行分类（P-A 起 patch 里有三种行；**P-F 起组件行也可以是真名行**，别再把它们混成一个集合）：
 *   · 裸行    `name === bare`                        → 整包门面 `lib/index.js`
 *   · 组件行  `name === '<bare>/<sub>'`（出户前）     → 宿主当独立 plugin 加载 `lib/components/<sub>/index.js`
 *             `name === '<bare>-<sub>'`（出户后，P-F）→ 加载 `packages/<sub>/lib/index.js`
 *   · 子包行  `name === '<bare>-<pkg>'`（非组件）     → P-A 拆出的子包，加载 `packages/<pkg>`（真名 ⇄ 清单名双射）
 *
 * ⚠️ 出户后**组件行与子包行的名字形态完全一样**（都是真名），能分开它们的只有"这个名字是不是组件"——
 * 那份名单的唯一真源是会话模块的 `COMPONENT_VIEW_KEYS`（③ 段逐键对账用的那一份），不是目录、也不是前缀。
 */
const COMPONENT_NAMES = (() => {
  const src = readFileSync(join(ROOT, 'lib', 'kernel', 'component-session.js'), 'utf8');
  const m = /export\s+const\s+COMPONENT_VIEW_KEYS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(src);
  if (!m) throw new Error('读不到 `lib/kernel/component-session.js` 的 COMPONENT_VIEW_KEYS —— 组件口径的声明面真源');
  return new Set([...m[1].matchAll(/(?:^|\n)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g)]
    .map((x) => x[1] || x[2] || x[3]));
})();
/** 组件入口落点：未出户 = `lib/components/<sub>/index.js`；已出户（P-F）= `packages/<sub>/lib/index.js`。 */
const componentEntryRel = (sub) => {
  const legacy = 'lib/components/' + sub + '/index.js';
  return existsSync(join(ROOT, legacy)) ? legacy : 'packages/' + sub + '/lib/index.js';
};
/** 组件**归属清单**：未出户 = 根清单（组件目录在主包 tarball 里）；已出户 = 该子包自己的清单。 */
const componentManifestRel = (sub) => (existsSync(join(ROOT, 'lib', 'components', sub, 'index.js'))
  ? 'package.json' : 'packages/' + sub + '/package.json');
const componentNamesOf = (rows, bare) => {
  const named = new Set(rows.map((r) => r.name).filter(Boolean));
  return [...COMPONENT_NAMES].filter((sub) => named.has(bare + '/' + sub) || named.has(bare + '-' + sub));
};
/**
 * 非裸、非子路径的行（= 真名行：P-A 子包行 **以及 P-F 出户后的组件行**）；它们的 name 必须能在磁盘上
 * 找到对应清单。出户后的组件**同时**是"组件行"与"真名行"，两套判据各自都要管它 ⇒ 这里不排除它，
 * 否则"盘上有包却没有行"会误报（它确实有行，只是那行还兼着组件语义）。
 */
const subpackageRowsOf = (rows, bare) => rows
  .filter((r) => r.name && r.name !== bare && !r.name.startsWith(bare + '/'));
/**
 * 子包行 ⇄ 盘上清单名的**双向**问题清单（生产与负对照调**同一份**，不重写判据）。
 * 两个方向都要报：行指向不存在的包（凭空一行）、盘上有包却没有行（装了但宿主永远不会加载它）。
 */
const subpackageRowIssues = (rows, bare, diskNames) => {
  const rowNames = new Set(subpackageRowsOf(rows, bare).map((r) => r.name));
  return [
    ...[...diskNames].filter((n) => !rowNames.has(n)).map((n) => '盘上有包却没有行：' + n),
    ...[...rowNames].filter((n) => !diskNames.has(n)).map((n) => '有行却没有包：' + n),
  ];
};

/** 磁盘上已落盘的子包真名（`packages/<pkg>/package.json` 的 name；无 packages/ 时为空集）。 */
function subpackageNamesOnDisk() {
  const dir = join(ROOT, 'packages');
  if (!existsSync(dir)) return new Set();
  const out = new Set();
  for (const entry of readdirSync(dir)) {
    const manifest = join(dir, entry, 'package.json');
    if (!existsSync(manifest)) continue;
    try {
      const json = JSON.parse(readFileSync(manifest, 'utf8'));
      if (json && json.name) out.add(json.name);
    } catch { /* 坏清单由别的判据报，这里不静默吞掉语义 */ }
  }
  return out;
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ═══ ① patch 的行不变量 ══════════════════════════════════════════════════════
section('① cordis.patch.yml 的行不变量（两条「静默整体消失」红线的第一半）');
const patchPath = join(ROOT, PATCH_REL);
check('仓库根存在 ' + PATCH_REL, existsSync(patchPath));
const patchText = existsSync(patchPath) ? read(PATCH_REL) : '';
const inserts = parseInsertRows(patchText);
const SUBPACKAGE_NAMES = subpackageNamesOnDisk();
const violations = rowViolations(inserts, BARE, SUBPACKAGE_NAMES);
const rows = inserts.flat();
const ofKind = (kind) => violations.filter((v) => v.kind === kind);
const detailOr = (kind, ok) => (ofKind(kind).length ? ofKind(kind).map((v) => v.detail).join('；') : ok);
check('恰好一个顶层 `- insert:` 块', ofKind('inserts').length === 0,
  detailOr('inserts', inserts.length + ' 个块 · ' + rows.length + ' 行'));
check('每行的 id 非空且全局唯一', ofKind('id').length === 0,
  detailOr('id', rows.map((r) => r.id).join(' ')));
check('每行都有 name（patch 行缺 name 等于插了一行加载不了的东西）', ofKind('name').length === 0,
  detailOr('name', rows.map((r) => r.name).join(' ')));
check('恰好一行 name 等于裸包名 `' + BARE + '`', ofKind('bare').length === 0,
  detailOr('bare', rows.filter((r) => r.name === BARE).length + ' 行'));
check('其余行的 name 都是 `<裸包名>/<子路径>`（组件行）或盘上真实子包真名（P-A 子包行）', ofKind('subpath').length === 0,
  detailOr('subpath', rows.filter((r) => r.name && r.name !== BARE).map((r) => r.name).join(' ') || '（没有子行）'));
{
  // 子包行（P-A）⇄ 磁盘 `packages/*/package.json` 的 name **双向**对账：既不许行指向不存在的包，
  // 也不许盘上有包却没插行（后者是"装了但宿主永远不会加载它"的静默缺口）。
  const subIssues = subpackageRowIssues(rows, BARE, SUBPACKAGE_NAMES);
  check('子包行 ⇄ packages/*/package.json 的 name 双向对账（P-A）',
    subIssues.length === 0,
    subIssues.join('；') || subpackageRowsOf(rows, BARE).length + ' 行 ⇄ ' + SUBPACKAGE_NAMES.size + ' 包');
  // 负对照：调上面同一份判据（合成输入，两个方向各一条）。
  const disk = new Set([BARE + '-fx', BARE + '-parallax']);
  const synthRows = [{ name: BARE + '-fx' }, { name: BARE + '-fonts' }];
  const synthIssues = subpackageRowIssues(synthRows, BARE, disk);
  check('negative control：子包行 ⇄ 包清单的两个方向都会判出（少一行 / 凭空一行）',
    synthIssues.some((t) => /盘上有包却没有行/.test(t) && /parallax/.test(t))
    && synthIssues.some((t) => /有行却没有包/.test(t) && /fonts/.test(t))
    && subpackageRowIssues(synthRows, BARE, new Set([BARE + '-fx', BARE + '-fonts'])).length === 0,
    synthIssues.join('；') || '**没有判出**');
}
// 组件行口径独立成一条（否则"组件行 0 行"会被上面那条通用形态判据掩盖）
check('组件行（`<裸包名>/<子路径>`）仍在 patch 里', componentNamesOf(rows, BARE).length >= 1,
  componentNamesOf(rows, BARE).join(' ') || '**没有**');

// ═══ ② package.json 的发布面声明 ═════════════════════════════════════════════
section('② package.json 的发布面声明（红线的第二半：patch 与浏览器半边都在这里挂在包上）');
const pkg = JSON.parse(read('package.json'));
const patchDecl = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
check("dsh.bundle.patch === './cordis.patch.yml'", patchDecl === './cordis.patch.yml',
  '实测 ' + JSON.stringify(patchDecl));
const clientDecl = pkg.dsh && pkg.dsh.client;
const clientExport = pkg.exports && pkg.exports['./client'];
check('声明 dsh.client ⇒ exports["./client"] 存在', !clientDecl || Boolean(clientExport),
  clientDecl ? 'dsh.client 已声明 · exports["./client"] ' + (clientExport ? '在' : '**缺**') : '未声明 dsh.client（本判据不适用）');

// ═══ ③ peer 门禁 ═════════════════════════════════════════════════════════════
section('③ peer 门禁：只许减不许增');
/** 现状 5 个 peer —— 增一个 = 所有没装它的用户装不上（门禁是包级的，不读 optional 标记）。 */
const PEER_BASELINE = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-host-webserver',
  'react',
];
const peers = Object.keys(pkg.peerDependencies || {});
const extraPeers = peers.filter((p) => !PEER_BASELINE.includes(p));
check('peerDependencies 键集合 ⊆ 既有 ' + PEER_BASELINE.length + ' 个', extraPeers.length === 0,
  extraPeers.length ? '多出：' + extraPeers.join(' ') : peers.length + ' 个：' + peers.join(' '));

// ═══ ④ 组件分发点 ═════════════════════════════════════════════════════════════
section('④ 组件分发点（P2-0 脚手架，形态甲）');
const facadePath = join(ROOT, 'lib', 'index.js');
const facade = existsSync(facadePath) ? readFileSync(facadePath, 'utf8') : '';
const hasApplyComponent = /export function applyComponent\(/.test(facade);
check('lib/index.js 导出 `applyComponent`（组件名 → 实现的分发点）', hasApplyComponent,
  hasApplyComponent ? '导出在位' : '**缺**：P2-0 钉下的组件契约没有落点');

// ═══ ⑤ 内核租约语义（D5）═════════════════════════════════════════════════════
section('⑤ 内核租约语义（D5）：共享资源只在最后一个会话释放');
{
  // 环境隔离必须**在 import 之前**：内核模块会拉起媒体 / 存储各族（与 verify-route-index.mjs ⑤ 同一套约定）。
  const ISO = join(ROOT, '.test-cache', 'bundle-rows');
  process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
  process.env.DSH_WE_DATA_DIR = join(ISO, 'data');
  process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
  process.env.HOME = join(ISO, 'home');
  process.env.USERPROFILE = process.env.HOME;
  const kernelMod = await import(pathToFileURL(join(ROOT, 'lib', 'kernel', 'host-kernel.js')).href);
  const { acquireKernelLease, releaseKernelLease } = kernelMod;
  check('内核导出 acquireKernelLease / releaseKernelLease',
    typeof acquireKernelLease === 'function' && typeof releaseKernelLease === 'function',
    typeof kernelMod.acquireKernelLease + ' / ' + typeof kernelMod.releaseKernelLease);
  /** 合成内核：只记 dispose 次数（租约语义与内核实现细节无关）。 */
  const tracker = () => {
    const calls = [];
    return { calls, kernel: { transcodeKit: { dispose: () => calls.push('dispose') } } };
  };
  // 单行（现状）：与"门面卸载时无条件 dispose 一次"逐字等价。
  const one = tracker();
  acquireKernelLease(one.kernel);
  const oneDone = releaseKernelLease(one.kernel);
  check('单会话：acquire → release 恰 dispose 一次（返回 true）',
    oneDone === true && one.calls.length === 1, '返回 ' + String(oneDone) + ' · dispose ' + one.calls.length + ' 次');
  // 双行共享内核：先卸载的**不许**释放共享资源。
  const two = tracker();
  acquireKernelLease(two.kernel);
  acquireKernelLease(two.kernel);
  const firstRelease = releaseKernelLease(two.kernel);
  check('双会话共享内核：先 release 的不释放共享资源（返回 false · dispose 0 次）',
    firstRelease === false && two.calls.length === 0, '返回 ' + String(firstRelease) + ' · dispose ' + two.calls.length + ' 次');
  const secondRelease = releaseKernelLease(two.kernel);
  check('双会话共享内核：最后一个 release 才 dispose（返回 true · 恰 1 次）',
    secondRelease === true && two.calls.length === 1, '返回 ' + String(secondRelease) + ' · dispose ' + two.calls.length + ' 次');
  // 幂等：计数归零后再 release 不得再 dispose、不得抛（侦察 §1.3 草案正是在这里错的）。
  let threw = null;
  let thirdRelease = null;
  try { thirdRelease = releaseKernelLease(two.kernel); } catch (e) { threw = e; }
  check('计数归零后再 release：幂等 no-op（不抛 · 不再 dispose · 返回 false）',
    threw === null && thirdRelease === false && two.calls.length === 1,
    threw ? '抛出 ' + threw.message : '返回 ' + String(thirdRelease) + ' · dispose ' + two.calls.length + ' 次');
  // 按对象归属（WeakMap）：一个内核的释放不碰另一个。
  const other = tracker();
  acquireKernelLease(other.kernel);
  releaseKernelLease(two.kernel); // two 已归零 ⇒ 不得连带 other
  check('租约按内核对象归属：释放一个内核不影响另一个',
    other.calls.length === 0 && two.calls.length === 1, '另一个 dispose ' + other.calls.length + ' 次');
  releaseKernelLease(other.kernel);
}

// ═══ ⑦ 判据自身有牙（正负对照调同一条 parseInsertRows / rowViolations）═══════
// ═══ ⑥ C8′ 组件行（P2-1）：patch 子行 ⇄ exports / files / 真加载 / 双行并集 ═════════
section('⑥ 组件行（P2-1/P2-2，逐行数据驱动）：patch 子行 ⇄ exports 三连 / files 覆盖 / 真加载 / 双路径一致 / 未知仍抛 / 合成 N 行并集');
{
  // patch 里 `name` 形如 `<裸包名>/<sub>` 的行 = 宿主会当**独立 plugin** 加载的组件行。
  // 组件行 = name 形如 `<裸包名>/<sub>`；P-A 起 patch 里还有**子包行**（name 是子包真名），它们不是组件。
  const subs = componentNamesOf(rows, BARE);
  check('patch 里有组件行（P2-1 起至少一行；P-F 起真名形态也算）', subs.length >= 1, subs.join(' ') || '**没有**');
  // 组件行在**归属清单**里的三连：未出户 = 根清单的 `./<sub>` 子路径三连（入口住在主包 tarball 里）；
  // 已出户（P-F）= 该子包自己清单的 `./lib/index.js` / `./package.json` / `./locale/*.json` 三连。
  // 出口解析按**清单所在目录**归一成仓库相对路径（子包清单里的 `./lib/index.js` 相对的是包根，不是仓库根）。
  const manifestOf = (rel) => JSON.parse(read(rel));
  const tripleMissing = [];
  const entryOf = new Map();
  const entryMissing = [];
  for (const sub of subs) {
    const rel = componentManifestRel(sub);
    const own = manifestOf(rel);
    const ownerDir = rel === 'package.json' ? '' : 'packages/' + sub + '/';
    const keys = rel === 'package.json'
      ? ['./' + sub, './' + sub + '/package.json', './' + sub + '/locale/*.json']
      : ['.', './package.json', './locale/*.json'];
    for (const key of keys) if (!(own.exports ? own.exports[key] : undefined)) tripleMissing.push(rel + '#' + key);
    const spec = own.exports ? own.exports[keys[0]] : undefined;
    const target = typeof spec === 'string' ? spec : (spec && spec.default);
    const targetRel = target ? ownerDir + String(target).replace(/^\.\//, '') : '';
    entryOf.set(sub, targetRel);
    if (!targetRel || !existsSync(join(ROOT, targetRel))) entryMissing.push(sub + ' → ' + String(target));
  }
  check('每个组件行在**归属清单**里有三连（未出户 = 根清单 `./<sub>` 三连；已出户 = 子包自己的清单三连）',
    tripleMissing.length === 0, tripleMissing.join(' ') || subs.map((s) => componentManifestRel(s)).join(' '));
  check('每个组件行的 entry 指向的文件都在磁盘上', entryMissing.length === 0, entryMissing.join(' ') || '全部在');
  // locale 文件名规范：同目录的 .json 全会被读，非语言名 / 重复语言会让宿主报 duplicates。
  // 目录也按归属走（出户后 locale 随包搬到 `packages/<sub>/locale/`）。
  const LOCALE_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
  const localeSeen = [];
  const badLocale = [];
  for (const sub of subs) {
    const dir = componentManifestRel(sub) === 'package.json'
      ? join(ROOT, 'lib', 'components', sub, 'locale')
      : join(ROOT, 'packages', sub, 'locale');
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) {
      localeSeen.push(sub + '/' + n);
      if (!n.endsWith('.json') || !LOCALE_RE.test(n.slice(0, -5))) badLocale.push(sub + '/' + n);
    }
  }
  check('locale 目录里只有语言名 .json（en / zh）', badLocale.length === 0,
    badLocale.join(' ') || localeSeen.join(' '));
  // `files` 必须覆盖组件目录的**每一个**文件（数据驱动：目录条目尾 `/` 按前缀、`*` 段内通配）。
  // 覆盖面也按归属清单算：未出户 = 根清单的 `files` 覆盖 `lib/components/<sub>/**`；
  // 已出户 = 子包自己清单的 `files` 覆盖 `packages/<sub>/**`（根清单此时不再包含这个目录）。
  const componentFiles = [];
  const walkComponent = (dir, prefix) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walkComponent(join(dir, ent.name), rel);
      else componentFiles.push(rel);
    }
  };
  const coveredBy = (files, rel) => (files || []).some((raw) => {
    const s = String(raw);
    const e = s.replace(/\/+$/, '');
    if (!e) return false;
    if (s.endsWith('/')) return rel === e || rel.startsWith(e + '/');
    if (!e.includes('*')) return rel === e;
    const re = new RegExp('^' + e.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
    return re.test(rel);
  });
  const uncovered = [];
  for (const sub of subs) {
    const ownRel = componentManifestRel(sub);
    const own = manifestOf(ownRel);
    const pkgRoot = ownRel === 'package.json' ? 'lib/components/' + sub : 'packages/' + sub;
    walkComponent(join(ROOT, pkgRoot), pkgRoot);
    // `files` 条目是**相对清单所在目录**的：未出户时清单在仓库根 ⇒ 与仓库相对路径同形；
    // 已出户后清单在 `packages/<sub>/` ⇒ 比对前必须把包前缀剥掉，否则整包都判"未覆盖"。
    const prefix = pkgRoot + '/';
    for (const f of componentFiles.filter((x) => x.startsWith(prefix))) {
      const ownPath = ownRel === 'package.json' ? f : f.slice(prefix.length);
      if (!coveredBy(own.files, ownPath)) uncovered.push(f);
    }
  }
  const kinds = [
    ['入口', (f) => /\/index\.js$/.test(f)],
    ['清单', (f) => /\/package\.json$/.test(f)],
    ['图标', (f) => /\/icon\.png$/.test(f)],
    ['locale', (f) => /\/locale\/[^/]+\.json$/.test(f)],
  ];
  const kindMissing = kinds.filter(([, hit]) => !componentFiles.some(hit)).map(([k]) => k);
  check('组件目录每个文件都被**归属清单**的 `files` 覆盖（四类齐：入口 / 清单 / 图标 / locale）',
    componentFiles.length > 0 && uncovered.length === 0 && kindMissing.length === 0,
    (componentFiles.join(' ') || '**组件目录里没有文件**')
      + (uncovered.length ? ' · 未覆盖：' + uncovered.join(' ') : '')
      + (kindMissing.length ? ' · 缺类：' + kindMissing.join(' ') : ''));
  // 图标是**同一份素材**（字节相同），不是"再导出一份"。
  // ⚠️ 必须逐个组件查（`find` 只取第一个 ⇒ 第二个组件改了图标会被静默放行；2026-xx 负对照实测）。
  const rootIcon = join(ROOT, 'icon.png');
  const rootIconBytes = existsSync(rootIcon) ? readFileSync(rootIcon) : Buffer.alloc(0);
  const iconRels = componentFiles.filter((f) => /\/icon\.png$/.test(f));
  const badIcons = iconRels.filter((rel) => {
    const b = readFileSync(join(ROOT, rel));
    return !(rootIconBytes.length > 0 && b.length === rootIconBytes.length && b.equals(rootIconBytes));
  });
  check('每个组件图标都与包根 icon.png 字节相同', iconRels.length > 0 && badIcons.length === 0,
    badIcons.length
      ? badIcons.map((rel) => `${rel}（${rootIconBytes.length} B vs ${readFileSync(join(ROOT, rel)).length} B）`).join(' ')
      : `${iconRels.length} 个图标 · ${rootIconBytes.length} B`);
  // ── 每个组件入口的文本级纪律（**逐行数据驱动**，不写死 'about-notice'）──────────────────
  const entrySrcOf = new Map();
  const entryNames = new Map();
  const entryIssues = { console: [], name: [], scope: [], facadeEdge: [] };
  for (const sub of subs) {
    const rel = String(entryOf.get(sub) || '').replace(/^\.\//, '');
    const src = rel && existsSync(join(ROOT, rel)) ? read(rel) : '';
    entrySrcOf.set(sub, { rel, src });
    if (!src) continue;
    // ① 日志一律走 createLog（与 verify-logging 同一纪律）。
    if (/console\./.test(src)) entryIssues.console.push(sub);
    // ② O10：组件入口必须有**非空**的 `export const name`（宿主按行加载时要一个名字）。
    //    ⚠️ 判据**不要求**它与 patch 行的 name 逐字相等 —— 实物反例：dsh-ops 的组件入口导出
    //    `dsh-ops-file`，patch 行写 `dsh-ops/file`（两者不等，宿主照常加载）。相等不是契约，
    //    "非空"才是（空名会让宿主的 meta 解析拿到空字符串）。本仓现状取等号是**更安全**的
    //    选择，不是必需。
    if (!/^\s*export\s+const\s+name\s*=\s*['"`][^'"`]+['"`]\s*;/m.test(src)) entryIssues.name.push(sub);
    // ③ O2/O4：模块作用域里不许出现**门面导入的标识符**（比"不许调用 `applyComponent(`"更强：
    //    门面换一个导出名、或用别名 import，都还在判据里）。门面静态 import 组件入口
    //    （reachability 承重），组件入口又 import 门面 ⇒ 互为环；宿主真实装载顺序是裸行在前 ⇒
    //    组件模块可能先于门面求值，那一刻门面的模块级 const 还在 TDZ（P2-1b NC1 实测
    //    `Cannot access 'hostKernel' before initialization`）。真跑一次没法由守卫安排装载顺序
    //    ⇒ 落文本级判据：把 `{ … }` 体抠掉，模块作用域里零出现；函数体内出现是正常用法。
    const fnames = facadeImportNames(src, rel);
    entryNames.set(sub, fnames);
    const hits = namesHit(moduleScopeWithoutImports(src), fnames);
    if (hits.length) entryIssues.scope.push(sub + '：' + hits.join(' '));
    // ④ P2-2b（结构判据，比 ③ 更硬）：组件入口**根本没有** `import` / re-export 门面这条边 ——
    //    任意写法（具名 / 默认 / 命名空间 / 副作用 / `export … from`）都算违规。③ 是文本级兜底
    //    （问"模块作用域里有没有出现这些名字"），再导出形态在模块作用域不产生名字、测不到，
    //    而拆环后的契约是"这条边不存在"⇒ 判语句，与名字无关。
    const edges = facadeEdgeSpecs(src, rel);
    if (edges.length) entryIssues.facadeEdge.push(sub + '：' + edges.join(' '));
  }
  check('每个组件入口都不自己打 console（日志走 createLog 通道）', entryIssues.console.length === 0,
    entryIssues.console.join(' ') || subs.join(' '));
  check('每个组件入口都有非空的 `export const name`（**不要求**等于 patch 行 name：相等不是契约，见注释）',
    entryIssues.name.length === 0, entryIssues.name.join(' ') || subs.join(' '));
  check('每个组件入口的模块作用域都不出现门面导入标识符（环的求值期纪律：模块求值期读门面导出在宿主装载顺序下 TDZ）',
    entryIssues.scope.length === 0,
    entryIssues.scope.join('；') || subs.map((s) => s + '：' + ((entryNames.get(s) || []).join(' ') || '已无门面导入名')).join(' · '));
  check('每个组件入口都不 import / re-export 门面（P2-2b 拆环的**结构判据**：这条边根本不存在，任意写法）',
    entryIssues.facadeEdge.length === 0,
    entryIssues.facadeEdge.join('；') || subs.map((s) => s + '：无门面边').join(' · '));

  // ── O2 的反向一半：门面侧的模块作用域也不许出现**组件入口的导入名** ────────────────────
  // P2-1b 把实现表搬进了 `applyComponent` 函数体（否则门面求值期就读组件入口的导出）。有人搬回
  // 模块级，这条就红 —— 与组件侧那条正好互为镜像，合起来才是"双向判据"。
  const componentImportNames = [];
  for (const sub of subs) {
    const { rel } = entrySrcOf.get(sub);
    // P2-3D（D2 硬化）：与组件侧同构 —— 具名 / 默认 / 命名空间三种导入形态都解析（旧写法只认具名表，
    // 门面改用默认或命名空间导入组件入口时这条镜像判据会静默空转）。
    // P-F：组件出户后门面按**裸包名** import 该组件入口（`dsh-plugin-wallpaper-engine-<sub>`，与 §12 的
    // 发布形态同形）⇒ 两种写法都认，否则三格全出户后这里解析出空集、判据静默失效（本轮实测抓到）。
    componentImportNames.push(...importNamesFrom(stripComments(String(facade)), (spec) =>
      spec.startsWith('.')
        ? join(dirname(facadePath), spec) === join(ROOT, rel)
        : spec === BARE + '-' + sub));
  }
  const facadeHits = namesHit(moduleScopeWithoutImports(facade), componentImportNames);
  check('门面（lib/index.js）的模块作用域不出现组件入口的导入名（实现表必须建在函数体内）',
    componentImportNames.length > 0 && facadeHits.length === 0,
    componentImportNames.length === 0
      ? '**没解析到组件入口导入名**（判据失效，必须修）'
      : (facadeHits.length ? '模块作用域出现：' + facadeHits.join(' ') : '导入名 ' + componentImportNames.join(' ') + ' 只在函数体内'));

  // ── P2-3D（D2）负对照：证明**旧的绕过手法**（换一种导入形态）不再让判据空转 ──────────────
  // 合成源码 + `() => true` 的说明符过滤器 ⇒ 与 `facadeImportNames` 的解析口径完全同构，
  // 且不读真实文件。旧写法只认具名表 ⇒ 默认/命名空间形态解析出**空集**（判据空转）。
  const anySpec = () => true;
  check('负对照(硬化)：默认导入的门面绑定名会被解析出来（旧写法此处空集 ⇒ 判据空转）',
    importNamesFrom("import facade from './index.js';\n", anySpec).join(',') === 'facade',
    JSON.stringify(importNamesFrom("import facade from './index.js';\n", anySpec)));
  check('负对照(硬化)：命名空间导入（`* as`）的门面绑定名会被解析出来（旧写法此处空集）',
    importNamesFrom("import * as facade from './index.js';\n", anySpec).join(',') === 'facade',
    JSON.stringify(importNamesFrom("import * as facade from './index.js';\n", anySpec)));
  check('正对照(硬化)：默认 + 具名混合形态两个名字都收、且不重复',
    importNamesFrom("import d, { e as f } from './index.js';\n", anySpec).join(',') === 'd,f',
    JSON.stringify(importNamesFrom("import d, { e as f } from './index.js';\n", anySpec)));
  check('正对照(硬化)：具名 / 别名口径与硬化前一致（`as` 之后取本地名）',
    importNamesFrom("import { a, b as c } from './index.js';\n", anySpec).join(',') === 'a,c',
    JSON.stringify(importNamesFrom("import { a, b as c } from './index.js';\n", anySpec)));
  check('负对照(硬化)：默认导入的绑定名不会被当成"模块作用域里的引用"（否则假阳性），'
    + '但模块作用域里真读它照样命中（判据没被剥空）',
    namesHit(moduleScopeWithoutImports("import facade from './index.js';\nconst x = 1;\n"), ['facade']).length === 0
      && namesHit(moduleScopeWithoutImports("import facade from './index.js';\nfacade.applyComponent();\n"), ['facade']).length === 1);
  // 端到端口径（走**真** `facadeImportNames` 与真相对路径解析，只是源码是合成的组件入口）：
  // 旧写法（只认具名表）在这两种形态下名字集合为空 ⇒ 组件侧那条 TDZ 判据当场空转（绿）。
  const syntheticEntryDefault = "import facade from '../../index.js';\nfacade.applyComponent();\n";
  const syntheticEntryNs = "import * as facade from '../../index.js';\nfacade.applyComponent();\n";
  check('负对照(硬化)：组件入口改写成**默认导入**形态时判据抓得到（旧写法此处空集 ⇒ 判据空转）',
    facadeImportNames(syntheticEntryDefault, 'lib/components/about-notice/index.js').join(',') === 'facade'
      && namesHit(moduleScopeWithoutImports(syntheticEntryDefault), facadeImportNames(syntheticEntryDefault, 'lib/components/about-notice/index.js')).length === 1);
  check('负对照(硬化)：组件入口改写成**命名空间导入**形态时判据抓得到（旧写法此处空集 ⇒ 判据空转）',
    facadeImportNames(syntheticEntryNs, 'lib/components/about-notice/index.js').join(',') === 'facade'
      && namesHit(moduleScopeWithoutImports(syntheticEntryNs), facadeImportNames(syntheticEntryNs, 'lib/components/about-notice/index.js')).length === 1);

  // ── P2-4 O2 夹具：import 的**跨行**与**带尾注释**两种形态 ────────────────────────────────
  // 两个方向都要有牙：① import 自身被剔干净（否则绑定声明会被当成"模块作用域里的门面引用" ⇒ 假阳性）；
  // ② 只剥 import，**不**连带吞掉后面的真实引用（吞掉 = 模块作用域里真读门面导出也判绿 ⇒ 静默失效）。
  // 说明：跨行 import 的说明符表会被 `moduleScopeOf` 当"体内"抠掉（花括号内文本连同换行一起消失），
  // 所以这里同时钉住"折叠后的形态"也要被正确剔除 —— 这正是旧写法容易漏掉的一格。
  check('夹具(O2)：跨行 import 被整段剔除（说明符表与 from 行都不算模块作用域引用），后续真实引用仍命中',
    namesHit(moduleScopeWithoutImports("import {\n  facade,\n} from './index.js';\nconst x = 1;\n"), ['facade']).length === 0
      && namesHit(moduleScopeWithoutImports("import {\n  facade,\n} from './index.js';\nfacade.applyComponent();\n"), ['facade']).length === 1);
  check('夹具(O2)：import 行带尾注释时只剥该行，不连带吞掉后续真实引用（吞掉 ⇒ 真引用判绿）',
    namesHit(moduleScopeWithoutImports("import facade from './index.js'; // 环入口\nconst x = 1;\n"), ['facade']).length === 0
      && namesHit(moduleScopeWithoutImports("import facade from './index.js'; // 环入口\nfacade.applyComponent();\n"), ['facade']).length === 1);

  // ── P2-5B B1（P2-4 终验 O4 补牙）：让"跨行状态机"与"收尾复位"成为**必要条件**的夹具 ──────────
  // P2-4 终验实测：上面两段夹具都区分不出这两步 —— 跨行**具名** import 的花括号表先被
  // `moduleScopeOf` 当"体内"折叠掉（状态机根本没参与），import 行**尾注释**又已被共享
  // `stripComments` 剥掉。下面四段夹具各顶住一格，每格都先证明真实现下的期望输出，再把对应那一步
  // 退化（NC 表见回报）：任一步退化 ⇒ 判据红，不再静默通过。
  //
  // 夹具形态是实测挑出来的（探针矩阵 `.integration-notes/scratch/p2-5b-fixture-probe.mjs`）：
  // **纯跨行花括号绑定表**（`import {\n  facade,\n} from '../x.js';`）对这两步**没有任何区分度** ——
  // `moduleScopeOf` 在状态机之前就把花括号表整段折叠掉，真实模块作用域文本里它只是 `import  from
  // '../x.js';` 一行（real / 摘状态机 / 摘复位三种实现下命中数都是同一个值）。有牙的形态是下面两类。
  //
  // ① `import` 关键字与**绑定名**分处两行（合法 ES：`import` 后不可能断句，绑定名落在模块作用域的
  //    续行上）：续行必须被状态机剔除 —— 摘掉状态机 ⇒ 续行上的绑定名成了"模块作用域里的门面引用"
  //    （假阳性）；并且必须**在 `from` 行收尾复位** —— 不复位 ⇒ 状态机一直"仍在 import 中" ⇒ 后续
  //    真实引用被连带吞掉（判据静默变绿）。一格顶两步：两次退化各自都红。
  check('夹具(P2-5B)：`import` 与绑定名分处两行时续行必须被状态机剔除（否则绑定名成假阳性），且必须在 `from` 行收尾复位（不复位 ⇒ 后续真引用被吞）',
    namesHit(moduleScopeWithoutImports("import\n  facade\nfrom './index.js';\nconst x = 1;\n"), ['facade']).length === 0
      && namesHit(moduleScopeWithoutImports("import\n  facade\nfrom './index.js';\nfacade.applyComponent();\n"), ['facade']).length === 1);
  // ② 花括号表与 `from` 分处两行（`}` 单独一行、`from '…';` 再下一行）：`from` 那一行是**续行**，
  //    必须被剔除，而且必须在它上面**收尾复位** —— 摘掉复位 ⇒ 状态机仍"在 import 中" ⇒ 下一行的
  //    真实引用被吞（这一步专顶"收尾复位"，摘状态机不影响它）。
  check('夹具(P2-5B)：花括号表与 `from` 分处两行时，`from` 续行必须被剔除并在该行收尾复位（不复位 ⇒ 下一行真引用被吞）',
    namesHit(moduleScopeWithoutImports("import {\n  facade,\n}\nfrom './index.js';\nconst x = 1;\n"), ['facade']).length === 0
      && namesHit(moduleScopeWithoutImports("import {\n  facade,\n}\nfrom './index.js';\nfacade.applyComponent();\n"), ['facade']).length === 1);
  // ③ 副作用导入（无 `from` 的单行形态）只剥自己那一行：短路那一步没了 ⇒ 状态机被误置为"仍在
  //    import 中" ⇒ 后面的真实引用被连带吞掉。
  check('夹具(P2-5B)：无 `from` 的副作用导入（单行形态）只剥自己那一行，之后的状态机不得被误置为"仍在 import 中"（误置 ⇒ 后续真引用被吞）',
    namesHit(moduleScopeWithoutImports("import './x.js';\nconst x = 1;\n"), ['facade']).length === 0
      && namesHit(moduleScopeWithoutImports("import './x.js';\nfacade.applyComponent();\n"), ['facade']).length === 1);
  // ④ 模块作用域的**动态** `import(` 不是静态导入：当成静态导入 ⇒ 后面全被吞掉。
  check('夹具(P2-5B)：模块作用域的动态 `import(` 不被当成静态导入（当成 ⇒ 后续真实引用被连带吞掉 ⇒ 判据静默变绿）',
    namesHit(moduleScopeWithoutImports("import('./x.js');\nfacade.applyComponent();\n"), ['facade']).length === 1);

  // 行为面：在 mock webServer 上把**两行**都跑一遍（环境隔离重复设一次，不依赖 ⑤ 的段落顺序）。
  const ISO = join(ROOT, '.test-cache', 'bundle-rows');
  process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
  process.env.DSH_WE_DATA_DIR = join(ISO, 'data');
  process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
  process.env.HOME = join(ISO, 'home');
  process.env.USERPROFILE = process.env.HOME;
  const facadeMod = await import(pathToFileURL(facadePath).href);
  const applyFn = facadeMod.apply || (facadeMod.default && facadeMod.default.apply);
  const applyComponentFn = facadeMod.applyComponent || (facadeMod.default && facadeMod.default.applyComponent);
  const registered = [];
  // mock ctx 只需 `webServer`：组件行与主行同款取服务（`inject = ['webServer']` + 直读 `ctx.webServer`）。
  // 取服务姿势本身由 ⑧ 段的**结构判据**钉住（读的每个服务都必须被 inject 覆盖）；这段只管行为面条数。
  const mock = {
    webServer: {
      register(route) { registered.push(route); return () => {}; },
      tapIndex() { return () => {}; },
    },
  };
  const disposeMain = typeof applyFn === 'function' ? applyFn(mock) : undefined;
  const afterMain = registered.length;
  let unknownErr = null;
  try { applyComponentFn(mock, undefined, 'no-such-component'); } catch (e) { unknownErr = e; }
  check('未知组件名仍然抛（绝不静默返回，且注册面没被污染）',
    unknownErr !== null && /unknown component: /.test(String(unknownErr.message)) && registered.length === afterMain,
    unknownErr ? String(unknownErr.message) : '**没有抛**');

  // ── P2-4 A2：组件装载探针 —— **走真实路径**（门面 `apply()` 注册的 `/diag-log` 处理器 + 假 req/res）──
  // 为什么不用合成探针：这条判据要抓的失败形态正是"探针没接进 diag 路由 / 字段名写错 / 字段丢掉"，
  // 自造一份探针就永远抓不到。假 res 只需 `setHeader` + `end`（该处理器不读 req，也不碰 statusCode）。
  const DIAG_LOG = '/wallpaper-engine/diag-log';
  const readDiagLog = () => {
    const route = registered.find((r) => r.kind === 'exact' && r.path === DIAG_LOG);
    if (!route) return null;
    const headers = {};
    let body = '';
    route.handler({ method: 'GET', url: DIAG_LOG }, {
      setHeader(k, v) { headers[k] = v; },
      end(chunk) { if (chunk !== undefined && chunk !== null) body += String(chunk); },
    });
    let json = null;
    try { json = JSON.parse(body); } catch { /* 非 JSON 由判据报错 */ }
    return { headers, body, json };
  };
  const fresh = readDiagLog();
  // 归一成 null：字段缺失 / 被改名时 `json.components` 是 `undefined`，直接取属性会抛 TypeError
  //（那是"崩"不是"判红"，detail 也就没了）。这里显式收敛成 null ⇒ 判据干净报红并带上响应体。
  const asProbe = (r) => (r && r.json && r.json.components && typeof r.json.components === 'object' ? r.json.components : null);
  const freshProbe = asProbe(fresh);
  const probeDeclared = freshProbe && Array.isArray(freshProbe.declared) ? freshProbe.declared : [];
  check('装载探针：/diag-log 响应体带 components.{declared,loaded,missing}（真实注册路径，非合成探针）',
    fresh !== null && fresh.json !== null && freshProbe !== null
      && Array.isArray(freshProbe.declared) && Array.isArray(freshProbe.loaded) && Array.isArray(freshProbe.missing),
    fresh === null ? '门面 apply() 没注册 ' + DIAG_LOG
      : (fresh.json === null ? '响应体不是 JSON：' + fresh.body.slice(0, 120)
        : (freshProbe === null ? '响应体没有 components 字段（或不是对象）：' + JSON.stringify(fresh.json).slice(0, 160) : JSON.stringify(freshProbe))));
  check('装载探针：响应头仍是 application/json（不得改用 sendJson 换头）',
    fresh !== null && fresh.headers['Content-Type'] === 'application/json; charset=utf-8',
    fresh ? String(fresh.headers['Content-Type']) : 'n/a');
  const sortedSubs = [...subs].sort();
  check('装载探针：declared 与组件声明面（patch 的组件子行）完全一致（顺序无关；多塞或漏掉一个名字都红）',
    probeDeclared.length === sortedSubs.length && probeDeclared.every((n, i) => n === sortedSubs[i]),
    'declared ' + JSON.stringify(probeDeclared) + ' vs patch ' + JSON.stringify(sortedSubs));
  check('装载探针：未装载任何组件时 loaded 为空、missing == declared',
    freshProbe !== null && freshProbe.loaded.length === 0 && freshProbe.missing.length === probeDeclared.length
      && freshProbe.missing.every((n, i) => n === probeDeclared[i]),
    freshProbe === null ? '读不到探针' : 'loaded ' + JSON.stringify(freshProbe.loaded) + ' · missing ' + JSON.stringify(freshProbe.missing));
  // 逐行数据驱动：期望条数由"该入口调用了哪些路由族"现算（不写死组件名，也不写死 2）。
  const { modules: routeMods } = buildIndex();
  const perComponent = new Map();
  const componentDisposers = [];
  const countIssues = [];
  const sharedIssues = [];
  // P-F：出户的组件入口不再直取主包模块，改为 `ctx.wallpaperEngineHost` 取冻结键面 ⇒ 走入口那条
  // 路径的 mock 必须提供**真宿主服务**（`createSubpackageHost()`，与运行期同一个工厂），否则
  // `apply()` 在取服务那一步就抛，两条装载路径一致性 / 账本两条判据都会误红。
  const hostService = createSubpackageHost();
  // 出户的组件既是**子包行**（真名、有清单）又是**组件行**（声明面里的一员）；下面那段子包循环
  // 会按 `SUBPACKAGE_MODULES` 跑一遍全部真名包，若不在那里跳过它们，同一个 mock 上会重复注册，
  // 并集对账（Σ 行声明 vs 并集）会撑出重复项。组件这条路径更严（逐组件计数 + 两条路径一致性），
  // 所以这里让组件路径独占它。
  const componentEntryRels = new Set(subs.map((sub) => componentEntryRel(sub)));
  for (const sub of subs) {
    const before = registered.length;
    componentDisposers.push(typeof applyComponentFn === 'function' ? applyComponentFn(mock, undefined, sub) : undefined);
    const got = registered.length - before;
    perComponent.set(sub, got);
    const { rel } = entrySrcOf.get(sub);
    const exp = rowRegistrationCounts(rel, routeMods);
    if (exp.unknown.length) countIssues.push(sub + ' 的调用点解析不到路由模块：' + exp.unknown.join(' '));
    else if (got !== exp.expected) countIssues.push(sub + ' 注册 ' + got + ' 条 ≠ 路由族 ' + exp.expected + ' 条（' + exp.fns.join(' ') + '）');
    // 「两边复用同一份实现」：组件入口自己的 `apply(ctx)`（宿主把该行当**独立 plugin** 加载的路径）
    // 必须与门面 `applyComponent(root, …, sub)`（按组件加载的路径）注册出同一组 `(kind, path)`。
    const viaEntry = [];
    const mock2 = { webServer: { register(route) { viaEntry.push(route); return () => {}; }, tapIndex() { return () => {}; } }, wallpaperEngineHost: hostService };
    const entryMod = await import(pathToFileURL(join(ROOT, rel)).href);
    let dEntry = null;
    try {
      dEntry = typeof entryMod.apply === 'function' ? entryMod.apply(mock2, undefined) : null;
    } catch (e) { sharedIssues.push(sub + '（独立 plugin 路径）apply 抛 ' + e.message); }
    if (typeof dEntry === 'function') { try { dEntry(); } catch { /* 收尾失败不影响判定 */ } }
    const mine = registered.slice(before).map((r) => r.kind + ' ' + r.path);
    const other = viaEntry.map((r) => r.kind + ' ' + r.path);
    if (mine.length !== other.length || mine.some((k, i) => k !== other[i])) {
      sharedIssues.push(sub + ' 两条加载路径不一致：' + JSON.stringify(mine) + ' vs ' + JSON.stringify(other));
    }
  }
  check('每个组件行经 `applyComponent` 真能加载：注册条数 == 它调用的路由族条数（逐行数据驱动）',
    subs.length >= 1 && countIssues.length === 0,
    countIssues.join('；') || subs.map((s) => s + '=' + perComponent.get(s)).join(' '));
  check('每个组件入口的独立 plugin 路径（apply）与门面 applyComponent 注册出同一组 (kind, path)',
    subs.length >= 1 && sharedIssues.length === 0, sharedIssues.join('；') || subs.join(' '));
  // ── P-A：**子包行**也是独立 plugin（patch 里裸真名一行）⇒ 同一条 mock 上逐行跑一遍 ──────────
  // 为什么必须在这里也跑：下面「合成 N 行」对账用的 `MAIN_MODULES` 已经含子包行
  //（`subpackageModules()`）⇒ 不跑它们，并集会比 Σ 行声明**少**（实测：少 fonts 的 2 条）。
  // 那是判据自己缺对象，不是实现少注册 —— 判据必须把每一类行都真跑一遍才配得上"并集"这个词。
  const subCountIssues = [];
  const perSubpackage = [];
  for (const rel of SUBPACKAGE_MODULES) {
    // 出户组件由 ⑥ 的组件路径跑（更严：两条装载路径一致性 + 逐组件计数 + 账本），这里跳过以免重复注册。
    if (componentEntryRels.has(rel)) continue;
    const short = rel.replace(/^packages\//, '').split('/')[0];
    const before = registered.length;
    const subMod = await import(pathToFileURL(join(ROOT, rel)).href);
    const subApply = subMod.apply || (subMod.default && subMod.default.apply);
    const dSub = typeof subApply === 'function' ? subApply(mock) : undefined;
    if (typeof dSub === 'function') componentDisposers.push(dSub);
    const got = registered.length - before;
    const exp = rowRegistrationCounts(rel, routeMods);
    if (exp.unknown.length) subCountIssues.push(short + ' 的调用点解析不到路由模块：' + exp.unknown.join(' '));
    else if (got !== exp.expected) subCountIssues.push(short + ' 注册 ' + got + ' 条 ≠ 路由族 ' + exp.expected + ' 条（' + exp.fns.join(' ') + '）');
    perSubpackage.push(short + '=' + got);
  }
  check('每个子包行在同一个 mock 上注册的条数 == 它调用的路由族条数（逐行数据驱动，含零路由空壳行）',
    SUBPACKAGE_MODULES.length >= 1 && subCountIssues.length === 0,
    subCountIssues.join('；') || perSubpackage.join(' '));
  // ── P2-2b：账本要对**两条装载路径**都有牙 ──────────────────────────────────────────────
  // 上面那段里门面路径与入口路径先后都记了账，账本被先到者填满 ⇒ 单看 afterProbe 分不出"入口路径
  // 忘了记账"。这里先清空账本，再**只走组件入口自己的 `apply()`**（宿主按 patch 行独立加载那条路
  // 径）：每个组件都必须重新登记一次。漏一个 ⇒ 宿主按行加载时 `/diag-log` 的 `loaded` 会少一个
  // ⇒ 探针在"组件行被宿主装载"这个真实场景下失效，而门面那条路径看不出来。
  // （P2-2b 拆环后两条路径不再互相 import，各自从 `lib/host-boot.js` 取同一个账本与记账函数。）
  const boot = await import(pathToFileURL(join(ROOT, 'lib', 'host-boot.js')).href);
  let markIssues = '';
  if (!(boot.loadedComponents instanceof Set)) {
    markIssues = 'host-boot 没有导出 `loadedComponents`（账本没落在叶子模块？）';
  } else {
    boot.loadedComponents.clear();
    for (const sub of subs) {
      const { rel } = entrySrcOf.get(sub);
      const mod = await import(pathToFileURL(join(ROOT, rel)).href);
      const m = { webServer: { register() { return () => {}; }, tapIndex() { return () => {}; } }, wallpaperEngineHost: hostService };
      try {
        const d = typeof mod.apply === 'function' ? mod.apply(m, undefined) : null;
        if (typeof d === 'function') { try { d(); } catch { /* 收尾失败不影响判定 */ } }
      } catch (e) { markIssues += sub + ' 的独立路径 apply 抛 ' + e.message + '；'; }
      if (!boot.loadedComponents.has(sub)) markIssues += sub + ' 的 apply() 没登记账本；';
    }
    const extra = [...boot.loadedComponents].filter((n) => !subs.includes(n));
    if (extra.length) markIssues += '账本里出现 patch 没有的组件名：' + extra.join(' ');
  }
  check('每个组件入口的 apply() 自己登记装载账本（宿主按行加载那条路径也进 /diag-log 探针；账本清空后单独验）',
    markIssues === '' && subs.length >= 1, markIssues || subs.map((s) => s + ' ✓').join(' '));
  // ── P2-5B B3：内核单例必须**在模块求值期构造**（task-35 补充证据 NC③ 的补牙）─────────────────
  // 为什么要补：NC③ 把 `lib/host-boot.js` 的 `export const hostKernel = createHostKernel();`
  // 换成惰性 Proxy 后 `verify-adapter` / `verify-bundle-rows` / `verify-scene` 全绿 ⇒ 这个时点
  // 当时**没有任何判据**。时点为什么是契约：宿主按 patch 行装载时组件模块可能先于门面求值，而
  // `lib/kernel/data-dir.js` 这类模块在**加载期**读 env；内核单例的构造若被推迟到首次属性访问，
  // 构造时刻就取决于"谁先读它"，env / 租约状态不再确定（P2-1b 的 TDZ 一族正是这条时点的运行期表现）。
  // 判据口径（**语义不变量**，不钉文本形态）：**模块作用域文本**里 `createHostKernel(` 恰好 1 次。
  // `moduleScopeOf` 会抠掉函数体与字面量花括号 ⇒ "搬进函数体 / 惰性包装 / 外包给别的模块（改为从
  // 别处 import 现成单例）"都会掉到 0 次，"重复构造"会到 >1 次。用共享实现，不另写花括号配平。
  const bootSrc = read('lib/host-boot.js');
  const bootScope = moduleScopeOf(bootSrc);
  const ctorHits = (bootScope.match(/createHostKernel\s*\(/g) || []).length;
  check('host-boot 的内核单例在模块加载期构造：`createHostKernel(` 在模块作用域**恰好 1 次**'
    + '（0 次 = 惰性 / 搬进函数体 / 外包给别的模块，>1 次 = 重复构造）',
    ctorHits === 1,
    ctorHits === 0
      ? '模块作用域里 0 次 `createHostKernel(`：构造被惰性化 / 搬进函数体 / 外包给别的模块 ⇒ 首次访问才构造，时刻不确定'
      : (ctorHits > 1 ? '模块作用域里 ' + ctorHits + ' 次 `createHostKernel(`：内核单例被重复构造' : '恰好 1 次'));
  check('host-boot 的 `hostKernel` 导出在 import 后即为非空对象（等价面：构造确实发生在加载期，而不是首次访问时）',
    typeof boot.hostKernel === 'object' && boot.hostKernel !== null,
    'typeof hostKernel = ' + (boot.hostKernel === null ? 'null' : typeof boot.hostKernel));

  // 探针的**第二态**：逐行装载完之后再读一次 `/diag-log`（`loadedComponents` 是模块级账本，跨调用累积）。
  const afterLoad = readDiagLog();
  const afterProbe = asProbe(afterLoad);
  check('装载探针：装载后 loaded 覆盖全部组件行、missing 为空（declared − loaded 口径）',
    afterProbe !== null && subs.every((s) => afterProbe.loaded.includes(s)) && afterProbe.missing.length === 0,
    afterProbe === null ? '读不到探针'
      : 'loaded ' + JSON.stringify(afterProbe.loaded) + ' · missing ' + JSON.stringify(afterProbe.missing));
  const keyed = registered.map((r) => r.kind + ' ' + r.path);
  const dupes = [...new Set(keyed.filter((k, i) => keyed.indexOf(k) !== i))];
  // ── 跨源对账（取代原先写死的 `registered.length === 42`）──────────────────────────────
  // 期望值**现算**：每个 bundle 行（`MAIN_MODULES` = 门面 + 全部组件行 + 全部子包行，数据驱动）应当注册的条数 =
  // 它调用的路由族的条数之和（`rowRegistrationCounts`）。单点真源 = 这张行清单 × 那份族表。
  //
  // 写死的快照数字会烂：行清单或族表一变它就过期 ⇒ 判据恒红（且红得没有信息量）。
  // 现算出来的期望 = 门面 34 + about-notice 2 + mascot-avatar 2 + media-bridge 5 = 43；
  // 并集 43、跨行零重复、无孤儿 ⇒ 与"多注册"是两回事：真出事时并集会大于 Σ 行声明。
  // ⚠️ 这条对账同时覆盖**门面**的注册数（原先只有组件行逐行对账，门面的 34 条只被总数隐性约束）。
  const rowExpected = MAIN_MODULES.map((rel) => ({ rel, ...rowRegistrationCounts(rel, routeMods) }));
  const union = unionReconciliation(registered.length, rowExpected, dupes);
  check('合成 N 行：并集条数 == 各 bundle 行声明注册数之和（跨源对账；单点真源 = MAIN_MODULES × rowRegistrationCounts）',
    rowExpected.length > 0 && union.bad.length === 0,
    `并集 ${registered.length} 条 = Σ 行声明 ${rowExpected.map((r) => r.rel + '=' + r.expected).join(' + ')} = ${union.expected}`
      + (union.bad.length ? ' ⇒ ' + union.bad.join('；') : ''));
  check('合成 N 行：跨行无重复 (kind, path)', dupes.length === 0,
    dupes.length ? '重复：' + dupes.join(' · ') : `并集 ${registered.length} 条 · 无重复`);
  // 负对照（调上面**同一份** `unionReconciliation`；三条变异各顶一格 + 一条正对照）
  const okRows = [{ rel: 'a', expected: 2, unknown: [] }, { rel: 'b', expected: 3, unknown: [] }];
  check('negative control：某行声明注册数 +1（并集不变）⇒ 同一条对账判红并点名',
    unionReconciliation(5, [{ rel: 'a', expected: 3, unknown: [] }, { rel: 'b', expected: 3, unknown: [] }], [])
      .bad.some((t) => /Σ 行声明/.test(t)));
  check('negative control：**去掉一整行**（并集不变）⇒ 同一条对账判红（少一行不会被吞掉）',
    unionReconciliation(5, [{ rel: 'a', expected: 2, unknown: [] }], []).bad.some((t) => /Σ 行声明/.test(t)));
  check('negative control：某行的调用点解析不到路由族 ⇒ 同一条对账判红（解析失败不许静默算 0）',
    unionReconciliation(5, [{ rel: 'a', expected: 0, unknown: ['registerNoSuchRoutes'] }], [])
      .bad.some((t) => /解析不到路由族/.test(t)));
  check('negative control：跨行重复 (kind, path) ⇒ 同一条对账判红',
    unionReconciliation(5, okRows, ['exact /x']).bad.some((t) => /跨行重复/.test(t)));
  check('正对照：并集 == Σ 行声明且无重复 ⇒ 同一条对账 0 问题（判据不是恒真）',
    unionReconciliation(5, okRows, []).bad.length === 0);
  for (const d of [disposeMain, ...componentDisposers]) {
    if (typeof d === 'function') { try { d(); } catch { /* 收尾失败不影响判定 */ } }
  }
}

section('⑦ 判据自身有牙（正负对照调同一条 parseInsertRows / rowViolations）');
{
  const patchOf = (...r) => ['- insert:', ...r].join('\n');
  const legalRow = (id, name) => ['    - id: ' + id, "      name: '" + name + "'"].join('\n');
  const good = patchOf(legalRow('wallpaper-engine', BARE), legalRow('wallpaper-engine/extra', BARE + '/extra'));
  const goodViolations = rowViolations(parseInsertRows(good), BARE);
  check('正对照：合法 patch 零违反', goodViolations.length === 0,
    goodViolations.map((v) => v.detail).join('；') || '零违反');
  const kinds = (text) => new Set(rowViolations(parseInsertRows(text), BARE).map((v) => v.kind));
  check('负对照：两行 name 都等于裸包名 ⇒ 判出（裸包名行必须恰好一行）',
    kinds(patchOf(legalRow('a', BARE), legalRow('b', BARE))).has('bare'));
  check('负对照：id 重复 ⇒ 判出',
    kinds(patchOf(legalRow('dup', BARE), legalRow('dup', BARE + '/x'))).has('id'));
  check('负对照：裸包名行被换成别的包名 ⇒ 判出',
    kinds(patchOf(legalRow('a', 'dsh-plugin-somebody-else'))).has('bare'));
  check('负对照：name 不在裸包名命名空间下 ⇒ 判出',
    kinds(patchOf(legalRow('a', BARE), legalRow('b', 'dsh-plugin-other/sub'))).has('subpath'));
  // ── P-A：子包行（name = 子包**真名**）是第二类合法子行，判据必须按**磁盘清单**认，不能只看前缀 ──
  check('正对照：子包行（盘上真实存在的名字）零违反（P-A）',
    rowViolations(parseInsertRows(patchOf(legalRow('wallpaper-engine', BARE), legalRow('wallpaper-engine-fx', BARE + '-fx'))), BARE, new Set([BARE + '-fx'])).length === 0);
  check('负对照：子包行写成盘上不存在的包名 ⇒ 判出 subpath（否则"凭空一行包名"会被静默放行）',
    kinds(patchOf(legalRow('wallpaper-engine', BARE), legalRow('wallpaper-engine-nope', BARE + '-nope'))).has('subpath'));
  check('负对照：行没有 name ⇒ 判出', kinds(patchOf('    - id: only-id')).has('name'));
  check('负对照：id 为空 ⇒ 判出',
    kinds(patchOf('    - id:', "      name: '" + BARE + "'")).has('id'));
  check('负对照：两个顶层 `- insert:` ⇒ 判出',
    kinds(good + '\n- insert:\n' + legalRow('c', BARE + '/c')).has('inserts'));
}

// ── ⑧ 组件行的「取服务」姿势 + 账本三态（真机故障的回归判据）────────────────────────
// 故障原文（进注释便于日后 grep）：`Error: cannot get property "webServer" without inject at applyImpl`。
// 形态：组件行**没有** `inject` 声明却直读 `ctx.webServer` ⇒ cordis 的 reflect `get` 陷阱当场抛错
//（`ctx.<名>` 直读只对「inject 声明过」的服务、以及 reflect 混入的 `get`/`logger`/… 放行）⇒ 紧随其后的
// 「没有 webServer 就早退」分支永远执行不到（死代码），而 `loaded` 账本**已经记上**（记账发生在进入
// apply 时）⇒ `/diag-log` 探针假绿，用户只看到终端一行 "did not activate"、4 条路由 404。
//
// 判据钉的是**不变量**（不是某一行文本）：**组件入口读的每个 `ctx.<服务>` 都必须在它自己的
// `export const inject` 里**。依据：主行 `lib/index.js` 早就有 `export const inject =
// ['webServer']`，整包本来就硬依赖 web 服务 ⇒ 组件行补同一句**不引入任何新假设**（"缺服务就软失败"
// 是个假前提：没有 webServer 的 profile 里裸行自身就 pending，"软失败"只会把"没挂上"伪装成"已激活"）。
// 另一条路（不声明 inject、改走 reflect 混入的 `ctx.get()`）也实测可用，但它放弃了 Loader 的
// 「服务就绪才激活」保证 ⇒ 判据把"没声明 inject 就直读服务属性"钉死，防止这个坑再长回来。
section('⑧ 组件行取服务的 inject 姿势 + 装载账本三态（真机故障回归）');
{
  // 组件子行在本段**重新派生**一次（⑥ 段里那个 `subs` 是块级作用域，出了 `{}` 就没了）。
  // 派生口径与 ⑥ 段逐字一致：`rows` 来自同一次 `parseInsertRows(patchText)`。
  const subs8 = componentNamesOf(rows, BARE);
  const entrySrcOf = new Map();
  for (const sub of subs8) {
    const rel = componentEntryRel(sub);
    entrySrcOf.set(sub, { rel, src: read(rel) });
  }
  // 组件入口的 `export const inject = ['webServer', …]` → 服务名列表（`null` = 压根没声明）。
  // 只剥注释后再匹配：注释里写 `export const inject = …` 不算声明（stripComments 保留字符串原文，
  // 所以 `['webServer']` 里的引号与字面量都还在）。
  const injectList = (src) => {
    const m = /export\s+const\s+inject\s*=\s*\[([^\]]*)\]/.exec(stripComments(src));
    if (!m) return null;
    return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  };
  // 直读的宿主服务属性：组件入口的 ctx 面只有两个绑定名（门面 `apply(ctx)` / `applyImpl(root, …)`）；
  // 其余属性（`get`/`logger`/…）不是"宿主服务"面，跳过。`c` 是 deps 字面量（只解构、不点属性）。
  const NON_SERVICE = new Set(['get', 'logger', 'config', 'effect', 'on', 'services', 'reflect', 'scope', 'request', 'router']);
  const serviceReads = (src) => {
    const out = [];
    for (const m of stripComments(src).matchAll(/(?:^|[^\w$.])(?:ctx|root)\.([A-Za-z_$][\w$]*)/g)) {
      if (!NON_SERVICE.has(m[1])) out.push(m[1]);
    }
    return [...new Set(out)];
  };
  // 返回"违反"文案数组（空数组 = 姿势正确）。正负对照喂同一条逻辑 ⇒ 判据自己有牙。
  const postureViolations = (src) => {
    const out = [];
    const list = injectList(src);
    const reads = serviceReads(src);
    if (list === null) {
      if (reads.length) out.push('直读服务属性 ' + reads.join(',') + ' 却无 `export const inject`');
      return out;
    }
    const uncovered = reads.filter((n) => !list.includes(n));
    if (uncovered.length) out.push('直读 ' + uncovered.join(',') + ' 但 inject 只声明了 [' + list.join(',') + ']');
    return out;
  };
  const postureIssues = [];
  for (const sub of subs8) {
    const rel = entrySrcOf.get(sub).rel;
    const src = read(rel);
    for (const v of postureViolations(src)) postureIssues.push(rel + ' ' + v);
    // 还要求"真声明 + 真读"：光"没读到服务"也能让上面零违反，那种组件行的早退分支没有意义。
    const list = injectList(src);
    if (list === null || !list.includes('webServer')) postureIssues.push(rel + ' 的 inject 里没有 webServer');
    if (!serviceReads(src).includes('webServer')) postureIssues.push(rel + ' 没有读 `ctx.webServer`（早退分支就没有判据意义）');
  }
  check('组件入口读的每个 `ctx.<服务>` 都在它自己的 `export const inject` 里（未声明 inject 就直读 ⇒ 判红）',
    subs8.length >= 1 && postureIssues.length === 0,
    postureIssues.join('；') || subs8.map((s) => entrySrcOf.get(s).rel + ' ✓').join(' '));
  // 正负对照：同一条 `postureViolations()` 喂合成源码。① 故障原形（直读、无 inject）必须判红；
  // ② **覆盖不全**（声明了 inject，但读了没声明的服务）也必须判红 —— 只查"有没有 inject"会漏这一格；
  // ③ 正确姿势（声明 + 直读被覆盖）零违反；④ inject 只写在**注释**里不算声明（先剥注释再匹配）。
  const synthBroken = "export function applyImpl(ctx) {\n  const webServer = ctx && ctx.webServer;\n  return () => {};\n}\n";
  const synthPartial = "export const inject = ['webServer'];\nexport function applyImpl(ctx) {\n  const db = ctx.db;\n  return () => {};\n}\n";
  const synthGood = "export const inject = ['webServer'];\nexport function applyImpl(root) {\n  const webServer = root && root.webServer;\n  return () => {};\n}\n";
  const synthCommented = "// export const inject = ['webServer'];\nexport function applyImpl(ctx) {\n  const webServer = ctx.webServer;\n  return () => {};\n}\n";
  check('负对照：直读 `ctx.webServer` 且无 `export const inject` ⇒ 判红（这就是真机故障那一行）；正对照 ⇒ 零违反',
    postureViolations(synthBroken).length === 1 && postureViolations(synthGood).length === 0,
    'broken=' + JSON.stringify(postureViolations(synthBroken)) + ' · good=' + JSON.stringify(postureViolations(synthGood)));
  check('负对照：inject 声明了但**覆盖不全**（读了没声明的 `ctx.db`）⇒ 判红；只在注释里的 inject 不算声明',
    postureViolations(synthPartial).length === 1 && injectList(synthCommented) === null
      && postureViolations(synthCommented).length === 1,
    'partial=' + JSON.stringify(postureViolations(synthPartial)) + ' · commented=' + JSON.stringify(postureViolations(synthCommented)));

  // 行为面（② + ③）：走**门面分发点**（真 `applyComponent`）取实现，喂一个"注册面必抛"的 webServer
  //（`register()` 抛 ⇒ 实现中途炸），核对账本三态：loaded 有、started 无、failed 记文案、错误仍外抛。
  // 夹具不再用"空 ctx"：取服务姿势回到 inject + 直读后，空 ctx 只会走早退分支（那是**合法**路径，
  // 不该判红）—— 要触发实现内部抛错，得让注册面自己炸。
  const bootMod = await import(pathToFileURL(join(ROOT, 'lib', 'host-boot.js')).href);
  const facade = await import(pathToFileURL(facadePath).href);
  const applyComponentFn2 = facade.applyComponent || (facade.default && facade.default.applyComponent);
  const badTarget = subs8[subs8.length - 1];
  const BOOM = 'P2-5C 探针夹具：注册面必抛';
  bootMod.failedComponents.clear();
  bootMod.startedComponents.clear();
  let thrown = null;
  try {
    applyComponentFn2(
      { webServer: { register() { throw new Error(BOOM); }, tapIndex() { return () => {}; } } },
      undefined, badTarget);
  } catch (e) { thrown = e; }
  const failedMsg = bootMod.failedComponents.get(badTarget);
  check('实现抛错 ⇒ `components.failed` 记下错误文案，且错误不被吞（仍往外抛）',
    thrown !== null && typeof failedMsg === 'string' && failedMsg.includes(BOOM)
      && !bootMod.startedComponents.has(badTarget),
    thrown === null ? '**没抛**（错误被吞了）'
      : ('抛 ' + thrown.message + ' · failed=' + JSON.stringify(failedMsg)
        + ' · started=' + JSON.stringify([...bootMod.startedComponents])));
  check('探针三态同源：`componentProbe()` 的 loaded/started/failed 都读自账本（故障时 loaded 有、started 无）',
    (() => {
      const p = bootMod.componentProbe(subs8);
      return p.loaded.includes(badTarget) && !p.started.includes(badTarget)
        && p.failed[badTarget] === failedMsg && !p.missing.includes(badTarget);
    })(),
    JSON.stringify(bootMod.componentProbe(subs8)));
  // 早退路径（**放在三态判据之后**：它会清账本、会把 badTarget 记成 started，先跑就会把上面那条判据
  // 的状态擦掉）。webServer 缺失是**合法**路径（早退返回空 dispose）⇒ 不许记 failed。
  check('早退路径不记账失败：webServer 缺失（`root.webServer` undefined）⇒ 干净返回 dispose、不写 failed',
    (() => {
      bootMod.failedComponents.clear();
      bootMod.startedComponents.clear();
      // ⚠️ `let d = null` 的初值读不到（catch 里直接 return false）⇒ 声明不带初值。
      let d;
      try { d = applyComponentFn2({}, undefined, badTarget); } catch { return false; }
      const okDispose = typeof d === 'function';
      if (okDispose) { try { d(); } catch { /* 收尾失败不影响判定 */ } }
      return okDispose && !bootMod.failedComponents.has(badTarget) && bootMod.startedComponents.has(badTarget);
    })(),
    'failed=' + JSON.stringify([...bootMod.failedComponents]) + ' · started=' + JSON.stringify([...bootMod.startedComponents]));
  bootMod.failedComponents.clear();
  bootMod.startedComponents.clear();

  // ── ⑧c fiber 卸载必须真的撤路由（真机故障：关掉再打开 ⇒ duplicate route）──────────────
  // 故障原文：`webserver: duplicate exact route "/wallpaper-engine/inventory"`（三行全中：裸行 + 两组件行）。
  // 根因（真 cordis 探针实证）：插件入口导出的是**函数声明** `apply`（有 `prototype`）⇒ cordis 的 loader
  // 走 `new callback(ctx, config)` 分支、**返回值被丢弃** ⇒ 我们 return 的 teardown 从未进 fiber 的
  // disposer 列表 ⇒ 卸载时路由留在宿主路由表里 ⇒ 再次启用立刻撞「重复路由」，而**功能当时看不出问题**
  // （旧注册还在服务），故障只在"关掉再打开"这一路暴露。
  // 判据口径（不变量）：**`apply` 交回的 teardown 必须同时交给 fiber（`ctx.effect`）**。两层证据：
  //   ① 行为面 —— 模拟 cordis 的构造分支（**丢掉返回值**）→ 卸载 → 再装载 的往返，外加一条负对照；
  //   ② 真 cordis 往返 —— 装齐 `node_modules/@deepseek-ai/cordis` 时真跑（缺依赖 ⇒ **出声**跳过，
  //      不静默绿：P2-5C 的教训正是"mock 全绿、真门禁红"）。
  const entries = [];
  for (const sub of subs8) {
    const rel = componentEntryRel(sub);
    entries.push({ rel, mod: await import(pathToFileURL(join(ROOT, rel)).href) });
  }
  const facadeApply = facade.apply || (facade.default && facade.default.apply);
  const plugins = [{ label: 'lib/index.js', apply: facadeApply },
    ...entries.map((e) => ({ label: e.rel, apply: e.mod.apply }))];
  // 宿主 webServer 的模拟：重复 `(kind, path)` 抛**与宿主同款**的错，注册返回撤单函数。
  const makeTable = () => {
    const table = new Map();
    return {
      table,
      webServer: {
        register(route) {
          const key = route.kind + ' ' + route.path;
          if (table.has(key)) throw new Error('webserver: duplicate ' + route.kind + ' route "' + route.path + '"');
          table.set(key, route);
          return () => { table.delete(key); };
        },
        tapIndex() { return () => {}; },
      },
    };
  };
  // fiber 的模拟：`effect(cb)` 立刻调 cb、收下它的返回值（cordis 的 safeCollect 语义）；`unload()`
  // 逆序跑收集到的 disposer（= fiber 卸载）。
  // P-F：⑧ 的两个往返夹具都要给组件入口补上宿主服务（`inject: ['webServer', 'wallpaperEngineHost']`）。
  const hostService = createSubpackageHost();
  const makeFiber = (webServer) => {
    const collected = [];
    return {
      ctx: { webServer, wallpaperEngineHost: hostService, effect(cb) { const d = cb(); if (typeof d === 'function') collected.push(d); return d; } },
      unload() { while (collected.length) collected.pop()(); },
    };
  };
  // **模拟 cordis 的构造分支：返回值丢掉** —— 只有 `ctx.effect` 能救回 teardown。
  const loadDroppingReturn = (applyFn, ctx) => { applyFn(ctx); };
  const trips = [];
  for (const p of plugins) {
    const t = makeTable();
    const f1 = makeFiber(t.webServer);
    try { loadDroppingReturn(p.apply, f1.ctx); } catch (e) { trips.push(p.label + '：首次装载抛 ' + e.message); continue; }
    const first = t.table.size;
    if (first === 0) trips.push(p.label + '：首次装载没注册任何路由（夹具失效）');
    f1.unload();
    if (t.table.size !== 0) trips.push(p.label + '：卸载后仍留 ' + t.table.size + ' 条路由（teardown 没进 fiber）');
    let reloadErr = null;
    try { loadDroppingReturn(p.apply, makeFiber(t.webServer).ctx); } catch (e) { reloadErr = e; }
    if (reloadErr) trips.push(p.label + '：关掉再打开抛 ' + reloadErr.message);
    else if (t.table.size !== first) trips.push(p.label + '：重装载注册 ' + t.table.size + ' 条 ≠ 首次 ' + first + ' 条');
  }
  check('关掉再打开不撞 duplicate：apply 返回值被丢（= cordis 构造分支）时，teardown 仍经 `ctx.effect` 撤回路由',
    plugins.length >= 3 && trips.length === 0,
    trips.join('；') || plugins.map((p) => p.label + ' ✓').join(' / '));
  // 负对照：**只 `return dispose`、不交给 fiber** 的插件在同一个夹具下必须判红（判据有牙 + 复现真机形态）。
  const synthNoHandoff = (ctx) => {
    const d = ctx.webServer.register({ kind: 'exact', path: '/synth-no-handoff' });
    return () => d();
  };
  const badTable = makeTable();
  const bf1 = makeFiber(badTable.webServer);
  loadDroppingReturn(synthNoHandoff, bf1.ctx);
  bf1.unload();
  let negErr = null;
  try { loadDroppingReturn(synthNoHandoff, makeFiber(badTable.webServer).ctx); } catch (e) { negErr = e; }
  check('负对照：只 `return dispose` 不交给 fiber ⇒ 卸载后路由仍在、再装载撞 duplicate（证明上一条不是空转）',
    badTable.table.size === 1 && negErr instanceof Error && /duplicate/.test(negErr.message),
    '残留 ' + badTable.table.size + ' 条 · 再装载 ' + (negErr ? negErr.message : '**没抛**（夹具没牙）'));
  // 文本兜底：三个插件入口的 `apply` 体里都必须出现 `handOffTeardown(`（行为面已覆盖；这条只为把失败
  // 定位到"哪个入口忘了交接"，并配一条合成负对照证明这条文本判据本身有牙）。
  const APPLY_HEADER = 'export function apply(';
  const handoffIssues = [];
  for (const p of [{ label: 'lib/index.js', src: read('lib/index.js') },
    ...entries.map((e) => ({ label: e.rel, src: read(e.rel) }))]) {
    const body = functionBodyOf(stripComments(p.src), APPLY_HEADER);
    if (body === null) handoffIssues.push(p.label + '：定位不到 `' + APPLY_HEADER + '` 的函数体');
    else if (!/handOffTeardown\s*\(/.test(body)) handoffIssues.push(p.label + '：apply 体里没有 `handOffTeardown(`（teardown 只靠返回值 ⇒ fiber 卸载时会丢）');
  }
  check('三个插件入口的 `apply` 都把 teardown 交给 fiber（文本兜底；行为面见上两条）',
    handoffIssues.length === 0 && plugins.length >= 3,
    handoffIssues.join('；') || plugins.map((p) => p.label).join(' / '));
  const synthNoHandoffSrc = "export function apply(ctx) {\n  const d = ctx.webServer.register({ kind: 'exact', path: '/x' });\n  return () => d();\n}\n";
  check('负对照：合成源码里 `export function apply` 只 `return dispose`（无交接）⇒ 文本判据判红',
    !/handOffTeardown\s*\(/.test(functionBodyOf(synthNoHandoffSrc, APPLY_HEADER) || ''),
    '合成源码体=' + JSON.stringify(functionBodyOf(synthNoHandoffSrc, APPLY_HEADER)));
  // ── 真 cordis 往返（可选）：装齐依赖时真跑；缺依赖 ⇒ 出声跳过（不静默绿）────────────────────────
  const cordisPath = join(ROOT, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js');
  if (!existsSync(cordisPath)) {
    console.log('  ⛔ SKIP 真 cordis 往返未执行：找不到 ' + cordisPath
      + '（本包 peerDependencies 声明了 @deepseek-ai/cordis；装齐依赖后本判据自动生效）');
  } else {
    const { Context, Service } = await import(pathToFileURL(cordisPath).href);
    // ⚠️ 执行器用**语句体**：`(r) => setTimeout(r, 10)` 会把 Timeout 当执行器返回值（没人能读）
    //    ⇒ `no-promise-executor-return` 判红。行为等价（等待 10ms 后 resolve）。
    const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => { setTimeout(r, 10); }); };
    const realTrips = [];
    for (const e of entries) {
      const table = new Map();
      /** 与 dsh-host-webserver 同款：重复 (kind, path) 抛错，注册返回撤单函数。 */
      class StubWebServer extends Service {
        constructor(ctx) { super(ctx, 'webServer'); }
        register(route) {
          const key = route.kind + ' ' + route.path;
          if (table.has(key)) throw new Error('webserver: duplicate ' + route.kind + ' route "' + route.path + '"');
          table.set(key, route);
          return () => { table.delete(key); };
        }
        tapIndex() { return () => {}; }
      }
      const ctx = new Context();
      // P-F：组件入口现在 `inject: ['webServer', 'wallpaperEngineHost']`，服务由主包 `apply()` 提供；
      // 本夹具只装单个组件入口模块，所以在这里把同一份服务补上（与运行期同一条 provide 路径）。
      provideSubpackageHost(ctx);
      ctx.plugin(StubWebServer);
      await settle();
      const mod = await import(pathToFileURL(join(ROOT, e.rel)).href + '?cordis9=' + Date.now());
      let fiber = null; let err = null;
      try { fiber = await ctx.plugin(mod); } catch (x) { err = x; }
      await settle();
      const firstErr = err || (fiber && fiber.error) || null;
      const first = table.size;
      // ⚠️ 这里的赋值是**死写**：`err` 在上面已被读进 `firstErr`，之后不再被读
      //    ⇒ `catch { err = x; }` 会被 `no-useless-assignment` 判红。收尾失败本就不影响
      //    重载判据（下面只判 `table.size`），所以只留一条注释说明形态。
      try { await fiber.dispose(); } catch { /* 收尾失败不影响重载判据 */ }
      await settle();
      const left = table.size;
      // ⚠️ 声明**不带初值**：`let reloadErr = null` 的初值在 try/catch 两条路径上都会被覆盖
      //    （`ctx.plugin` 抛 ⇒ catch 赋；不抛 ⇒ try 里赋）⇒ 初值读不到。
      let reloadErr;
      try {
        const f2 = await ctx.plugin(mod);
        await settle();
        reloadErr = (f2 && f2.error) || null;
      } catch (x) { reloadErr = x; }
      if (firstErr) realTrips.push(e.rel + '：首次装载失败 ' + String(firstErr.message || firstErr).split('\n')[0]);
      else if (first === 0) realTrips.push(e.rel + '：首次装载 0 条路由');
      else if (left !== 0) realTrips.push(e.rel + '：fiber.dispose() 后仍留 ' + left + ' 条路由');
      else if (reloadErr) realTrips.push(e.rel + '：重装载失败 ' + String(reloadErr.message || reloadErr).split('\n')[0]);
      else if (table.size !== first) realTrips.push(e.rel + '：重装载 ' + table.size + ' 条 ≠ 首次 ' + first + ' 条');
    }
    check('真 cordis 往返：装载 → `fiber.dispose()` → 再装载，路由撤干净且不撞 duplicate（' + entries.length + ' 个组件入口）',
      entries.length >= 1 && realTrips.length === 0, realTrips.join('；') || entries.map((e) => e.rel).join(' / '));
  }
}

console.log('');
if (failed) { console.log('BUNDLE ROW CHECKS FAILED — ' + failed + ' failed'); process.exit(1); }
console.log('ALL BUNDLE ROW CHECKS PASSED');
// ⚠️ 显式退出：⑧c 会 import 真 `@deepseek-ai/cordis`（装了 peer 依赖时），它的事件循环句柄会让
//    **成功路径**的进程一直挂着不返回 —— 实测绿了却不退出（失败路径有 process.exit(1) 所以看不出来）。
//    挂住的形态比"红"更坏：跑一次的人以为卡死，于是没人跑（本文件又不在 run-guards 链上）。
process.exit(0);
