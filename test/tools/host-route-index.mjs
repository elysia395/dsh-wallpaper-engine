#!/usr/bin/env node
/**
 * host-route-index.mjs — 生成/核对**宿主路由索引**（账本 §3.5）。
 *
 * 为什么要它：`apply(ctx)` 里近三十条 `webServer.register` 挤在同一个闭包里，"这条路由依赖
 * 哪些状态"只能靠读代码。这份索引把四件事机械地列出来：
 *   ① 路由 → 所在文件:行号 → 处理器形态（箭头/函数、是否 async）；
 *   ② 该处理器的块里**引用了哪些 apply 作用域的状态**（= 将来 context 对象的字段候选）；
 *   ③ 拆成独立模块的路由族（`lib/routes/*.js`，或组件目录里的直接子文件 —— 见 `routeModuleFiles()`）：
 *      **context 契约**（声明了哪些 `c` 字段、哪个声明了却没用）；
 *   ④ 哪条路由在守卫/冒烟里被提到过（提到 ≠ 有断言，但零提及 = 拆分时没有安全网）。
 *
 * 两处**必须**在解析里做对，否则索引会静默少列路由：
 *   · **循环注册**：`for (const seg of ['media','preview']) { … register({ path: `${BASE}/${seg}` }) }`
 *     一个注册字面量产出 **2 条**路由。只按字面量计数会少一条，而"字面量数 == 索引行数"
 *     这种自比对照永远发现不了它（两边一起错）。这里展开成每条路由一行。
 *   · **路由模块**：族搬进独立模块后，注册字面量不再出现在 `lib/index.js` 里 ——
 *     解析器只扫主文件的话，搬走的路由就**从索引里消失**，而索引正是拆分的 context 设计稿。
 *     这里按 `registerXxxRoutes(webServer, …)` 调用点把模块的路由展开回原位置。
 *   · **实现归属（P2-8）**：族的落点不再只有 `lib/routes/` —— 组件私有的实现随组件住进
 *     `lib/components/<c>/`。所以文件面**从磁盘枚举**（`routeModuleFiles()`），认模块靠
 *     **入口形态**（`export function register…Routes(webServer`）而不是目录名。
 *
 * 用法：
 *   node test/tools/host-route-index.mjs            # 打印索引（守卫用它比对）
 *   node test/tools/host-route-index.mjs --write    # 写入 docs/ROUTE-INDEX.md
 *   node test/tools/host-route-index.mjs --deps     # 额外打印四个巨石的闭包状态清单
 *
 * ⚠️ 生成物 `docs/ROUTE-INDEX.md` 是 **LF** 行尾（`--write` 写的是 `md.join('\n') + '\n'`），
 *    与树里其余文本文件的 **CRLF** 口径不同 —— 这是刻意的（生成物不进 CRLF 归一）；
 *    `docs/GUARD-MAP.md`（`test/tools/guard-targets.mjs --write` 生成）同理也是 LF。
 *    `test/verify-route-index.mjs` 也是按"现算文本 vs 磁盘文本"逐字比对的，别顺手改行尾。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 剥注释：共享的字符串感知实现（同目录 js-text.mjs）。
import { stripComments } from './js-text.mjs';
// 包发现层（T1，同目录 packages.mjs）：行、子路径包、独立子包都由它给 —— 本文件不再自带
// `cordis.patch.yml` 解析器，也不再自己 glob `packages/*` 的清单（同一份发现逻辑只有一处）。
import { discoverPackages } from './packages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 剥掉源码里的字符串/注释，**保住换行**（否则行号错位）。跨行模板字面量一并处理。
 *  注释那两步走共享的 `stripComments`（字符串感知、等长替换）；字符串/模板这几步留在本函数里，
 *  顺序是"先剥注释、再剥字符串"，与索引按列定位的等长要求一致。 */
function stripSource(raw) {
  return stripComments(raw)
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .split('\n');
}

/** 从 from（1-based）起配对花括号，返回闭合行号。L/st 必须同长。 */
function braceEnd(L, st, from) {
  let d = 0;
  for (let i = from; i <= L.length; i++) {
    for (const c of st[i - 1] || '') { if (c === '{') d++; else if (c === '}') d--; }
    if (d <= 0 && i >= from) return i;
  }
  return L.length;
}

/** `apply` 的作用域：缩进 ≤2 的声明（与 analyze-host-apply.mjs 同口径）。 */
function applyScope(L, st) {
  let start = -1;
  for (let i = 0; i < L.length; i++) if (/^(export\s+)?(async\s+)?function apply\s*\(/.test(L[i])) { start = i + 1; break; }
  const end = start > 0 ? braceEnd(L, st, start) : -1;
  const declRe = /^(\s*)(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
  const names = [];
  for (let i = start + 1; start > 0 && i <= end; i++) {   // eslint-disable-line no-unmodified-loop-condition -- 循环由 i <= end 收敛；start > 0 是不变量门
    const m = declRe.exec(L[i - 1]);
    if (m && m[1].length <= 2) names.push(m[2]);
  }
  return { start, end, names };
}

/** `for (const X of ['a','b']) { … }` 的区间 + 元素（循环注册的路由要展开成 N 行）。 */
function loopSpans(L, st) {
  const out = [];
  L.forEach((l, i) => {
    const m = /^\s*for\s*\(\s*const\s+([A-Za-z_$][\w$]*)\s+of\s+\[([^\]]*)\]\s*\)\s*\{\s*$/.exec(l);
    // ⚠️ 读的是**原始行** l 而非剥好的 st[i]：剥字符串会把 ['media','preview'] 变成
    //    ['','']，元素被 filter(Boolean) 全滤掉 —— 循环展开会静默失效。
    if (!m) return;
    const els = m[2].split(',').map((s) => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
    if (!els.length) return;
    out.push({ varName: m[1], els, from: i + 1, to: braceEnd(L, st, i + 1) });
  });
  return out;
}

/** 一条注册 → 路由行（含循环展开）。depsOf(block) 决定"依赖"列怎么算。 */
function routesIn(L, st, depsOf) {
  const loops = loopSpans(L, st);
  const found = [];
  L.forEach((l, i) => {
    if (!/webServer\.register\(\{/.test(l)) return;
    const start = i + 1;
    const end = braceEnd(L, st, start);
    const block = L.slice(start - 1, end).join('\n');
    const pm = /path:\s*['"`]((?:\$\{BASE\})?\/[^'"`]*)['"`]/.exec(block);
    const hm = /handler:\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|handler:\s*(async\s*)?function/.exec(block);
    const kind = (hm && hm[1]) ? 'async 箭头' : '箭头';
    const deps = depsOf(block);
    const loop = loops.find((s) => start >= s.from && start <= s.to);
    const raw = pm ? pm[1] : '';
    const variants = (loop && raw.includes('${' + loop.varName + '}'))
      ? loop.els.map((el) => raw.split('${' + loop.varName + '}').join(el))
      : [raw];
    for (const v of variants) {
      // 动态路径（含 BASE 之外的插值）也要**出现在索引里** —— 否则"索引覆盖全部注册"这条
      // 断言会因为少一条而红，而真正该记的是"这一条是参数化的"。
      const dynamic = !v || /\$\{(?!BASE\})/.test(v);
      found.push({
        path: dynamic ? '(动态路径)' : v.replace(/^\$\{BASE\}/, ''),
        line: start, end, dynamic, kind, deps,
        viaLoop: Boolean(loop && variants.length > 1),
      });
    }
  });
  return found;
}

/** 解析一个模块：apply 作用域（主文件）或 context 契约（路由模块）。 */
function parseMain(rel) {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  const L = raw.split('\n');
  const st = stripSource(raw);
  const scope = applyScope(L, st);
  const depsOf = (block) => scope.names.filter((n) => new RegExp('(^|[^.\\w$])' + n + '\\b').test(block));
  return { rel, L, st, scope, routes: routesIn(L, st, depsOf) };
}

/** 路由模块：`c` 的字段即"这一族用到但不属于它"的东西 —— 解析出来就是 context 契约。 */
export function parseRouteModuleText(raw, rel, fnName) {
  const L = raw.split('\n');
  const st = stripSource(raw);
  const at = L.findIndex((l) => new RegExp('export\\s+function\\s+' + fnName + '\\s*\\(').test(l)) + 1;
  const end = at > 0 ? braceEnd(L, st, at) : 0;
  const indent = at > 0 ? (/^(\s*)/.exec(L[at - 1])[1]).length : 0;
  // `const { a, b: C } = c;` → 字段 a、b（本地名 C）。**解构可以跨多行**（字段一多就会换行），
  // 所以必须在整个函数体文本上匹配一次，而不是逐行 —— 逐行匹配多行解构会静默解析出 0 个字段，
  // 于是该模块的契约列与死声明检查**一起空转**（判据变空即恒真）。
  const fields = [];
  let dsAt = 0; // 解构**结束**所在行（1-based）：**dead-declaration 判定的正文必须从它之后算起**，
  // 否则解构行自己就"用到了"每个字段，死声明永远测不出来。
  const bodyAll = at > 0 ? L.slice(at - 1, end).join('\n') : '';
  const dm = at > 0 ? /const\s*\{([^}]*)\}\s*=\s*c\s*;/.exec(bodyAll) : null;
  if (dm) {
    dsAt = at + (bodyAll.slice(0, dm.index + dm[0].length).match(/\n/g) || []).length;
    for (const part of dm[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const [field, local] = t.split(':').map((s) => s.trim());
      fields.push({ field, local: local || field });
    }
  }
  // `c.xxx` 形式的使用也算契约的一部分 —— 但**只在函数体顶层**：嵌套回调（如
  // `req.on('data', (c) => … c.length)`) 里的 `c` 是形参、与 context 同名但无关。
  // 实测：不限定缩进时 `c.length` 被当成 context 字段 `length`。
  for (let i = at + 1; at > 0 && i <= end; i++) {   // eslint-disable-line no-unmodified-loop-condition -- 循环由 i <= end 收敛；at > 0 是不变量门（at<=0 时 end=0，去掉会多跑一轮）
    const line = L[i - 1] || '';
    if ((/^(\s*)/.exec(line)[1]).length > indent + 2) continue;
    for (const m of line.matchAll(/\bc\.([A-Za-z_$][\w$]*)/g)) {
      if (!fields.some((f) => f.field === m[1])) fields.push({ field: m[1], local: m[1] });
    }
  }
  const body = L.slice(dsAt || at, end).join('\n');
  const unused = fields.filter((f) => !new RegExp('(^|[^.\\w$])' + f.local + '\\b').test(body)).map((f) => f.field);
  const depsOf = (block) => fields.filter((f) => new RegExp('(^|[^.\\w$])' + f.local + '\\b').test(block)).map((f) => f.field);
  return { rel, fnName, L, st, at, end, fields, unused, routes: routesIn(L, st, depsOf) };
}

/** 路由族模块的**入口形态**：`export function register<X>Routes(webServer`。
 *  认模块只认这个形态（不认目录名）—— 组件目录里的 `index.js`（导出 `apply` / `applyImpl`）
 *  因此不会被误当成路由族，而搬进组件目录的族照样被认出来。 */
const ROUTE_ENTRY_RE = /export\s+function\s+register[A-Za-z_$][\w$]*Routes\s*\(\s*webServer\b/;

/** 路由族模块的**候选文件面**（从磁盘枚举，不写死组件清单 —— M5）：
 *  `lib/routes/*.js` ∪ `lib/components/<c>/` 的直接子文件 ∪ `packages/<pkg>/lib/routes/*.js`。
 *  这是"可能住着路由族"的文件面；是否真是路由族由 `ROUTE_ENTRY_RE` 判定（见 `routeModuleFiles()`）。
 *  P-A 起实现随**子包**走（fonts 的两族），所以候选面必须跟着包发现层一起长 —— 否则搬走的族
 *  会从"孤儿面"里静默消失（文件在、没人调用也判不出来）。 */
export function routeModuleCandidates() {
  const out = [];
  const push = (dir, prefix) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) out.push(prefix + name);
  };
  push(join(ROOT, 'lib', 'routes'), 'lib/routes/');
  const pkgs = join(ROOT, 'packages');
  if (existsSync(pkgs)) {
    for (const p of readdirSync(pkgs).sort()) {
      const dir = join(pkgs, p);
      if (!statSync(dir).isDirectory()) continue;
      push(join(dir, 'lib', 'routes'), 'packages/' + p + '/lib/routes/');
    }
  }
  const comps = join(ROOT, 'lib', 'components');
  if (existsSync(comps)) {
    for (const c of readdirSync(comps).sort()) {
      const dir = join(comps, c);
      if (!statSync(dir).isDirectory()) continue;
      push(dir, 'lib/components/' + c + '/');
    }
  }
  return out;
}

/** 路由族模块的**文件面**：候选里**含注册入口**的那些（组件目录里的 `index.js` 导出的是
 *  `apply` / `applyImpl`，没有这个形态 ⇒ 不会被误当成路由族）。 */
export function routeModuleFiles() {
  return routeModuleCandidates().filter((rel) => ROUTE_ENTRY_RE.test(readFileSync(join(ROOT, rel), 'utf8')));
}

/** 路由族模块：文件面里每个文件 × 它的导出函数（用于把调用点映射回模块）。 */
function routeModules() {
  const out = [];
  for (const rel of routeModuleFiles()) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of raw.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      out.push(parseRouteModuleText(raw, rel, m[1]));
    }
  }
  return out;
}

/**
 * 「行」的主模块清单：门面（= `package.json` 的 `main`）+ 出户的组件行入口。
 * ⚠️ 合并的只有**路由与调用点**；`stateNames` / `applyStart` / `applyEnd` 仍只按门面算
 *    （`analyze-host-apply.mjs` 用它们框出 `apply()` 的正文 —— 那是"门面还剩多少"，别混入组件行）。
 *
 * **清单数据驱动（P2-9 / 度量 M5，P-B 起改读发现层）**：组件行 = 发现层里 `kind === 'subpath'`
 * 的包（`lib/components/<sub>/package.json` —— P-F 批 1c（2026-10-16）三格出户后该目录已删除，此行只为历史兼容、命中数恒为 0；宿主入口取该包清单的 `main`），且该包必须在
 * `cordis.patch.yml` 有行、入口文件在磁盘上存在 —— 两侧交叉才算一行：
 *   · 只看磁盘 ⇒ 未登记的组件目录会被当成"运行时会注册的行"，索引说谎；
 *   · 只看行 ⇒ 缺文件的死行也会算一行。
 * ⇒ **新增一个组件行不需要改本文件**（把目录建好 + patch 加一行即可）。
 */
/** 包发现层模型（T1）：行 / 子路径包 / 独立子包都从这里取。 */
const MODEL = discoverPackages(ROOT);

/** 主包清单：只用来取**宿主入口**（见下）。 */
const PKG_MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
/** 门面入口 = 主包清单的 `main`（字面串，`lib/index.js`）。
 *  ⚠️ 仍直读根清单、不从发现层取：发现层 `main` 的字段形状**冻结**为没有宿主入口
 *  （只有 `dir` / `name` / 清单与 patch 路径 / `clientArtifact` / `rows` / `row`）。主包就是发现层
 *  自己所在的那个包，读它自己的清单拿入口不属于"单包枚举假设"（枚举假设 = 写死"本仓只有一个包"
 *  或写死包名 / 子目录名）。出现第二个消费者时再把这个字段回收进模型（T5 收尾清单）。 */
export const PKG_MAIN = PKG_MANIFEST.main;
/** 主包真名：由发现层给（子包行的行名 = `<本名>-<pkg>`，见 `subpackageModules()`）。 */
const PKG_NAME = MODEL.main.name;

/** 主 `cordis.patch.yml` 里的行名（按文件顺序）—— 直接取发现层解析好的 `main.rows`
 *  （发现层按主清单声明的 `dsh.bundle.patch` 定位 patch，手写扫描、构建/守卫链上不引 js-yaml；
 *  本文件不再自带解析器）。
 *
 *  ⚠️ 出口契约是"返回行**名字符串**数组"：发现层的行模型允许 `name === null`（只有 `id:` 的项）
 *  与空值，而旧的形态正则里这两种行根本不存在 ⇒ 必须在这里滤掉，否则下游
 *  `rows.filter(n => n.startsWith(…))` 会因 `null` 抛异常。 */
export function patchRowNames() {
  return MODEL.main.rows
    .map((r) => (r ? r.name : null))
    .filter((n) => typeof n === 'string' && n !== '');
}

/** 出户的组件行（**子路径包**）的宿主入口：取发现层的 `kind === 'subpath'` 分类 + 该包清单的
 *  `main`（根相对 `entry`），不再从行名硬映射到 `lib/components/<sub>/index.js` —— 包住哪儿由
 *  发现层说，本文件不写死落点。仍是两侧交叉：要有 patch 行（`row !== null`）+ 入口文件在磁盘上存在。 */
export function componentModules() {
  const out = [];
  for (const p of MODEL.packages) {
    if (p.kind !== 'subpath' || p.row === null || typeof p.entry !== 'string') continue;
    if (existsSync(join(ROOT, p.entry)) && !out.includes(p.entry)) out.push(p.entry);
  }
  return out;
}

/**
 * 子包行（**独立子包**）的宿主入口：取发现层的 `kind === 'standalone'` 分类，不再靠
 * `<主包名>-` 前缀去猜"这条行属于哪个子包"（行与包的对应由发现层按包目录分类给出）。
 *
 * 与组件行同款**两侧交叉**：要有 patch 行（`row !== null`）+ 入口文件在磁盘上存在 ——
 * 只看磁盘 ⇒ 还没登记行的包会被当成"运行时会注册的行"；只看行 ⇒ 缺入口文件的死行也算一行。
 * 也不与组件行重叠：组件行只认发现层里的 `kind === 'subpath'`。
 */
export function subpackageModules() {
  const out = [];
  for (const p of MODEL.packages) {
    if (p.kind !== 'standalone' || p.row === null || typeof p.entry !== 'string') continue;
    if (existsSync(join(ROOT, p.entry))) out.push(p.entry);
  }
  return out;
}

/**
 * 子包行的宿主入口**双向对账**（纯函数，供守卫做负对照 —— 合成输入必须喂**同一个**判据）：
 *   · patch 里每条子包行（`<主包名>-<pkg>`，裸名）都必须在
 *     `packages/<dir>/package.json` 里被 `name` 逐字认领（否则是死行）；
 *   · 每个包都必须有行（只看磁盘 ⇒ 还没登记的包会被当成"运行时会注册的行"，§2.2 的静默失效）；
 *   · 认领到的 `main` 必须解析到**磁盘上存在**的文件（缺入口 = 行装不起来，`MAIN_MODULES` 会静默少一行）。
 * `fileExists(rel)` 注入 ⇒ 合成 "main 指向不存在的路径" 也能走同一条判据。返回违规清单（空 = 干净）。
 */
export function subpackageModuleViolations(rows, packages, fileExists) {
  const rowSet = new Set(rows.filter((n) => n.startsWith(PKG_NAME + '-') && !n.includes('/')));
  const bad = [];
  const claimed = new Set();
  for (const p of packages) {
    if (!rowSet.has(p.name)) { bad.push('未登记行：packages/' + p.dir + '（' + p.name + '）不在 cordis.patch.yml 的子包行里'); continue; }
    const rel = 'packages/' + p.dir + '/' + String(p.main || './lib/index.js').replace(/^\.\//, '');
    if (!fileExists(rel)) bad.push('入口不存在：' + p.name + ' 的 main → ' + rel + '（行会静默少一行）');
    claimed.add(p.name);
  }
  for (const name of rowSet) if (!claimed.has(name)) bad.push('死行：cordis.patch.yml 的子包行 ' + name + ' 没有任何 packages/<dir>/package.json 认领');
  return bad;
}

/** 独立子包的清单描述（`{ dir, name, main }`，排序）—— 供 `subpackageModules()` 与守卫共用。
 *  包面（哪些目录、叫什么名）由**发现层**的 `kind === 'standalone'` 给出，本文件不再 glob `packages/*`；
 *  `dir` = 包目录名（`packages/<dir>`，守卫按它拼路径并打印）、`name` = 清单真名。
 *
 *  ⚠️ `main` 取清单里的**字面串**（`./lib/index.js`），不能用发现层的 `entry` 反推：`entry` 是
 *  根相对路径，而 `verify-route-ownership.mjs` 的 `p.dir + ' → ' + p.main` 打印逐字依赖这个字面串。 */
export function subpackageManifests() {
  const out = [];
  for (const p of MODEL.packages) {
    if (p.kind !== 'standalone') continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(ROOT, p.manifestPath), 'utf8')); } catch { continue; }
    if (typeof manifest.name !== 'string') continue;
    out.push({ dir: p.sub, name: manifest.name, main: typeof manifest.main === 'string' && manifest.main ? manifest.main : './lib/index.js' });
  }
  return out;
}

/** 一行的宿主入口：门面（主包 `main`）+ 出户的组件行 + 子包行（都在 patch 里有行、且文件在磁盘上）。 */
export const MAIN_MODULES = [PKG_MAIN, ...componentModules(), ...subpackageModules()];

/** 出户的组件行入口（= `MAIN_MODULES` 去掉门面）。守卫据此**数据驱动**地遍历组件行，不写死名字。 */
export const COMPONENT_MODULES = componentModules();

/** 出户的**子包行**入口（= `MAIN_MODULES` 去掉门面与组件行）。运行时对账要把它们当独立 plugin 各跑一遍。 */
export const SUBPACKAGE_MODULES = subpackageModules();

/**
 * 一个「行」模块里 `registerXxxRoutes(webServer, …)` 调用点 → **期望注册条数**（数据驱动判据用：
 * 组件行出户后，"这一行注册几条"必须由它调用的路由族条数现算，不能写死 2）。
 * 返回 `{ fns, expected, unknown }`：`unknown` 非空 = 调用点解析不到路由模块（判据要红，别静默算 0）。
 */
export function rowRegistrationCounts(rel, modules) {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  const byFn = new Map(modules.map((m) => [m.fnName, m.routes.length]));
  const fns = [];
  for (const line of raw.split('\n')) {
    const hit = /^\s*([A-Za-z_$][\w$]*)\s*\(\s*webServer\s*,/.exec(line);
    if (hit) fns.push(hit[1]);
  }
  return { fns, expected: fns.reduce((n, f) => n + (byFn.get(f) || 0), 0), unknown: fns.filter((f) => !byFn.has(f)) };
}

export function buildIndex() {
  const main = parseMain(PKG_MAIN);
  const mains = MAIN_MODULES.map((rel) => parseMain(rel));
  const modules = routeModules();
  const byFn = new Map(modules.map((m) => [m.fnName, m]));

  // 调用点（`registerXxxRoutes(webServer, {…})`）在各行主模块里的行号
  const calls = [];
  for (const m of mains) {
    m.L.forEach((l, i) => {
      const hit = /^\s*([A-Za-z_$][\w$]*)\s*\(\s*webServer\s*,/.exec(l);
      if (hit && byFn.has(hit[1])) calls.push({ line: i + 1, fn: hit[1], mod: byFn.get(hit[1]), srcRel: m.rel });
    });
  }
  // 孤儿模块：文件在、导出在，但没有任何一行调用 ⇒ 它的路由既不在索引里也不在运行时
  const calledFiles = new Set(calls.map((c) => c.mod.rel));
  const orphanModules = modules.filter((m) => !calledFiles.has(m.rel));

  // 按文档顺序合并：逐行（先门面、再组件行）合并该行的字面量路由与调用点展开
  const ordered = [];
  for (const m of mains) {
    const mine = calls.filter((c) => c.srcRel === m.rel);
    const byCall = new Map(mine.map((c) => [c.line, c]));
    const lines = [...new Set([...m.routes.map((r) => r.line), ...mine.map((c) => c.line)])].sort((a, b) => a - b);
    for (const ln of lines) {
      const c = byCall.get(ln);
      if (c) for (const r of c.mod.routes) ordered.push({ ...r, src: c.mod.rel });
      for (const r of m.routes.filter((r) => r.line === ln)) ordered.push({ ...r, src: m.rel });
    }
  }

  // 守卫覆盖（口径：路由片段在守卫/冒烟源码里被提到）
  const walk = (dir, out = []) => {
    for (const n of readdirSync(dir)) {
      const abs = join(dir, n);
      if (statSync(abs).isDirectory()) walk(abs, out);
      else if (/\.mjs$/.test(n) && !/host-route-index|analyze-host-apply/.test(n)) out.push(abs);
    }
    return out;
  };
  const guardTexts = [...walk(join(ROOT, 'scripts')), ...walk(join(ROOT, 'test'))]
    .map((f) => [relative(ROOT, f), readFileSync(f, 'utf8')]);
  // 提及判定要**带尾边界**：`/media` 是 `/media-info` 的子串，纯 includes 会让
  // `/media` 凭空获得 14 次"提及"，把一条没人守的路由显示成已覆盖。
  //
  // ⚠️ 口径收口（本轮）：这一列答的是"**哪个文件的代码碰过这条路由**"，不是"哪个文件出现过这个
  //   字符串"。所以先把源码里的**代码路径**（`lib/…` / `src/…` / `test/…` / `scripts/…` / `docs/…`，
  //   含 `./` 与 `../` 前缀）遮掉，再用**两侧边界**判路由形状 —— 否则 `lib/media/mp4-probe.js`、
  //   `lib/media/video-preview.js` 这类**源文件路径**会被算成 `/media`、`/video-preview` 路由的提及
  //   （实测：判据的读点一改，这一列就跟着漂 3 次；那是口径假阳性，不是覆盖变化）。
  //   左边界**不加**：路由在守卫里常带 `${BASE}` 前缀出现（`'/wallpaper-engine/media-origin'`），
  //   加 `(?<![\w.-])` 会把这类**真提及**判成零（实测：`/media-origin` 与
  //   `/scene-payload-progress` 立刻变 0）。遮代码路径已经足够消掉那一类假阳性。
  const maskCodePaths = (t) => t.replace(
    /(?:\.[./]*)?(?:lib|src|test|scripts|docs)\/[A-Za-z0-9._/-]+/g, ' ');
  const mentionRe = new Map(ordered.map((r) => [r.path,
    new RegExp(r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])')]));
  const mentions = (p) => guardTexts.filter(([, t]) => mentionRe.get(p).test(maskCodePaths(t))).length;
  // 提及数挂在路由上：`analyze-host-apply.mjs` 与本文件的表格共用同一口径，避免两处各算一遍
  for (const r of ordered) r.mentions = mentions(r.path);

  const md = [];
  md.push('# 宿主路由索引（P2-11 前置 1 · 自动生成，勿手改）');
  md.push('');
  md.push('> 生成：`node test/tools/host-route-index.mjs --write`；核对：`node test/verify-route-index.mjs`');
  md.push('> （守卫会在索引与代码不一致时失败 —— 索引因此不会烂掉）。');
  md.push('>');
  md.push('> **依赖** = 该处理器块里引用到的 `apply` 作用域声明（缩进 ≤2）= **将来 context 对象的字段候选**；');
  md.push('> 同一列里反复出现的名字，就是该提出来的字段。拆成独立模块的族（`lib/routes/*.js` 或');
  md.push('> 组件目录里的实现文件）则列它的 **`c` 字段**。');
  md.push('> 循环里注册的路由（`for (const seg of [...])`）按**实际条数**逐条列出，不折叠成一行。');
  md.push('> 路径列省略 `${BASE}` 前缀；因此**看起来同名的两行**是同一路径同时挂了根路径与带前缀');
  md.push('> 两条注册（渲染页按根路径上报，只挂一条会静默 404）。**守卫提及**列的口径：该路由以');
  md.push('> 路由形状（尾边界，`/media` 不被 `/media-info` 误算）出现在几个守卫/冒烟文件的**代码**里；');
  md.push('> `lib/…`、`src/…`、`test/…` 这类**代码路径**先被遮掉 ⇒ 也不会被 `lib/media/mp4-probe.js`');
  md.push('> 这类源文件路径误算（提及 ≠ 有断言；零提及 = 拆前无安全网）。');
  md.push('');
  md.push(`共 **${ordered.length}** 条路由。`);
  md.push('');
  md.push('| # | 路径 | 来源 | 形态 | 依赖（闭包状态 / `c` 字段） | 守卫提及 |');
  md.push('|---|---|---|---|---|---|');
  ordered.forEach((r, i) => {
    const hits = r.mentions;
    const deps = r.deps.length > 6 ? r.deps.slice(0, 6).join(' ') + ` …(+${r.deps.length - 6})` : r.deps.join(' ');
    md.push(`| ${i + 1} | \`${r.path}\` | ${r.src}:${r.line} | ${r.kind} | ${deps || '—'} | ${hits || '**0**'} |`);
  });
  md.push('');
  const uncovered = ordered.filter((r) => !r.mentions);
  md.push(`**零提及（拆分前必须先补守卫）**：${uncovered.length ? uncovered.map((r) => '`' + r.path + '`').join('、') : '（无）'}`);
  md.push('');
  // 出现最多的闭包状态 = context 字段的优先级（只统计**主文件**的路由：路由模块的依赖是 c 字段，
  // 混进来会把"该提出来的 apply 状态"和"已经提出的 context 字段"算成同一张票）
  const freq = new Map();
  for (const r of ordered) if (r.src === main.rel) for (const d of r.deps) freq.set(d, (freq.get(d) || 0) + 1);
  md.push('**被最多路由引用的闭包状态（context 字段优先级，仅 `lib/index.js` 内的路由）**：');
  md.push('');
  md.push([...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([k, n]) => '`' + k + '`×' + n).join(' · '));
  md.push('');
  // 路由模块的 context 契约（每个族"用到但不属于它"的东西 = 该文件的依赖清单）
  if (modules.length) {
    md.push('**路由模块的 context 契约**（声明了却没用到的字段单独标出 —— 那是死声明）：');
    md.push('');
    md.push('| 模块 | 入口 | 路由数 | `c` 字段 | 死声明 |');
    md.push('|---|---|---|---|---|');
    for (const m of modules) {
      const used = m.fields.filter((f) => !m.unused.includes(f.field)).map((f) => '`' + f.field + '`').join(' ');
      md.push(`| \`${m.rel}\` | \`${m.fnName}(webServer, c)\` | ${m.routes.length} | ${used || '—'} | ${m.unused.length ? m.unused.map((f) => '`' + f + '`').join(' ') : '—'} |`);
    }
    md.push('');
  }

  // ── 前置 3：从 apply() 拆出的**非路由工厂**的上下文契约 ─────────────────────
  // ⚠️ 这里原先列的是"apply() 内的四大巨石"（`ensureMediaOrigin` / `serveFile` / `buildInventory`
  //    / `handleSceneFiles`）与它们捕获的 apply 作用域状态。B1 落地后四者**全部搬出** apply()
  //    ⇒ 旧判据只剩"没找到声明"，外加一处把 `const buildInventory = createInventoryBuilder({…})`
  //    误当声明的 9 行假匹配。改成列这几个工厂模块**声明的 `c` 字段** —— 语义等价
  //    （"这个模块吃外面哪些东西"就是那份 context 设计稿），且拆分后仍然成立。
  //    ⚠️ 必须在**整份剥好的源码**（stripped）里配花括号：逐行剥字符串会把跨行模板字面量里的
  //    花括号算进深度。工厂的 `c` 有两种写法，都要认：形参解构 `({ a, b })` 与 `(c)` ＋
  //    `const { a, b } = c;`。`deps` 键名沿用 `giants`（analyze-host-apply 按同口径读）。
  const FACTORY_MODULES = [
    ['lib/media-origin.js', 'createMediaOrigin'],
    ['lib/inventory.js', 'createInventoryBuilder'],
    ['lib/serve.js', 'createServeKit'],
    ['lib/faststart.js', 'createFaststartKit'],
    ['lib/kernel/host-session.js', 'createHostSession'],
    // 出户的组件行（P2-1 起）：`c` 由门面 `applyComponent` 的字面量对象注入（`= c;` 解构）。
    // 清单**数据驱动**（`componentModules()`，P2-9）⇒ 新增组件行不必改本文件。
    ...componentModules().map((rel) => [rel, 'applyImpl']),
  ];
  const fieldsOf = (headLine, body) => {
    const pick = (s) => s.split(',').map((p) => p.trim().split(':')[0].trim()).filter(Boolean);
    const inline = /\{([^}]*)\}\s*\)\s*\{?\s*$/.exec(headLine);
    if (inline) return pick(inline[1]);
    const dm = /const\s*\{([^}]*)\}\s*=\s*c\s*;/.exec(body);
    return dm ? pick(dm[1]) : [];
  };
  const giants = FACTORY_MODULES.map(([rel, fn]) => {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    const L = raw.split('\n');
    const st = stripSource(raw);
    const at = L.findIndex((l) => new RegExp('export\\s+function\\s+' + fn + '\\s*\\(').test(l)) + 1;
    if (!at) return { name: fn, file: rel, from: 0, to: 0, lines: 0, deps: [] };
    const end = braceEnd(L, st, at);
    const body = L.slice(at - 1, end).join('\n');
    return { name: fn, file: rel, from: at, to: end, lines: end - at + 1, deps: fieldsOf(L[at - 1], body) };
  });

  return {
    text: md.join('\n'),
    routes: ordered,
    modules,
    orphanModules,
    stateNames: main.scope.names,
    applyStart: main.scope.start,
    applyEnd: main.scope.end,
    giants,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { text, routes, modules, orphanModules, giants } = buildIndex();
  if (process.argv.includes('--deps')) {
    console.log('\n== 非路由工厂模块的上下文契约（前置 3）==');
    for (const g of giants) {
      if (!g.lines) { console.log('  ?? ' + g.name + '（没找到声明）'); continue; }
      console.log(`  ${g.file} → ${g.name}  ${g.from}-${g.to}（${g.lines} 行）吃 ${g.deps.length} 个: ${g.deps.join(' ')}`);
    }
    console.log('\n== 路由模块的 context 契约 ==');
    for (const m of modules) {
      console.log(`  ${m.rel} → ${m.fnName}(webServer, c)  ${m.routes.length} 条路由`
        + `  c 字段: ${m.fields.map((f) => f.field).join(' ') || '（无）'}`
        + (m.unused.length ? `  ⚠️ 死声明: ${m.unused.join(' ')}` : ''));
    }
    if (orphanModules.length) console.log('  ⚠️ 孤儿模块（apply 里没有调用）: ' + orphanModules.map((m) => m.rel).join(' '));
  } else if (process.argv.includes('--write')) {
    writeFileSync(join(ROOT, 'docs', 'ROUTE-INDEX.md'), text + '\n');
    console.log('已写入 docs/ROUTE-INDEX.md（' + routes.length + ' 条路由）');
  } else {
    process.stdout.write(text + '\n');
  }
}
