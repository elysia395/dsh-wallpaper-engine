#!/usr/bin/env node
/**
 * host-route-index.mjs — 生成/核对**宿主路由索引**（账本 §3.5）。
 *
 * 为什么要它：`apply(ctx)` 里近三十条 `webServer.register` 挤在同一个闭包里，"这条路由依赖
 * 哪些状态"只能靠读代码。这份索引把四件事机械地列出来：
 *   ① 路由 → 所在文件:行号 → 处理器形态（箭头/函数、是否 async）；
 *   ② 该处理器的块里**引用了哪些 apply 作用域的状态**（= 将来 context 对象的字段候选）；
 *   ③ 拆到 `lib/routes/*.js` 的族：**context 契约**（声明了哪些 `c` 字段、哪个声明了却没用）；
 *   ④ 哪条路由在守卫/冒烟里被提到过（提到 ≠ 有断言，但零提及 = 拆分时没有安全网）。
 *
 * 两处**必须**在解析里做对，否则索引会静默少列路由：
 *   · **循环注册**：`for (const seg of ['media','preview']) { … register({ path: `${BASE}/${seg}` }) }`
 *     一个注册字面量产出 **2 条**路由。只按字面量计数会少一条，而"字面量数 == 索引行数"
 *     这种自比对照永远发现不了它（两边一起错）。这里展开成每条路由一行。
 *   · **路由模块**：族搬进 `lib/routes/*.js` 后，注册字面量不再出现在 `lib/index.js` 里 ——
 *     解析器只扫主文件的话，搬走的路由就**从索引里消失**，而索引正是拆分的 context 设计稿。
 *     这里按 `registerXxxRoutes(webServer, …)` 调用点把模块的路由展开回原位置。
 *
 * 用法：
 *   node test/tools/host-route-index.mjs            # 打印索引（守卫用它比对）
 *   node test/tools/host-route-index.mjs --write    # 写入 docs/ROUTE-INDEX.md
 *   node test/tools/host-route-index.mjs --deps     # 额外打印四个巨石的闭包状态清单
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 剥注释：共享的字符串感知实现（同目录 js-text.mjs）。
import { stripComments } from './js-text.mjs';

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

/** 读盘版本（`parseRouteModuleText` 的薄封装）。 */
function parseRouteModule(rel, fnName) {
  return parseRouteModuleText(readFileSync(join(ROOT, rel), 'utf8'), rel, fnName);
}

/** `lib/routes/*.js` 里每个导出函数名 → 文件（用于把调用点映射回模块）。 */
function routeModules() {
  const dir = join(ROOT, 'lib', 'routes');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
    const rel = 'lib/routes/' + name;
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of raw.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      out.push(parseRouteModule(rel, m[1]));
    }
  }
  return out;
}

export function buildIndex() {
  const main = parseMain('lib/index.js');
  const modules = routeModules();
  const byFn = new Map(modules.map((m) => [m.fnName, m]));

  // 调用点（`registerXxxRoutes(webServer, {…})`）在 apply 里的行号
  const calls = [];
  main.L.forEach((l, i) => {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*\(\s*webServer\s*,/.exec(l);
    if (m && byFn.has(m[1])) calls.push({ line: i + 1, fn: m[1], mod: byFn.get(m[1]) });
  });
  // 孤儿模块：文件在、导出在，但 apply 里没有调用 ⇒ 它的路由既不在索引里也不在运行时
  const calledFiles = new Set(calls.map((c) => c.mod.rel));
  const orphanModules = modules.filter((m) => !calledFiles.has(m.rel));

  // 按文档顺序合并：调用点处展开该模块的路由
  const ordered = [];
  const byCall = new Map(calls.map((c) => [c.line, c]));
  const lines = [...new Set([...main.routes.map((r) => r.line), ...calls.map((c) => c.line)])].sort((a, b) => a - b);
  for (const ln of lines) {
    const c = byCall.get(ln);
    if (c) for (const r of c.mod.routes) ordered.push({ ...r, src: c.mod.rel });
    for (const r of main.routes.filter((r) => r.line === ln)) ordered.push({ ...r, src: main.rel });
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
  const mentionRe = new Map(ordered.map((r) => [r.path,
    new RegExp(r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])')]));
  const mentions = (p) => guardTexts.filter(([, t]) => mentionRe.get(p).test(t)).length;
  // 提及数挂在路由上：`analyze-host-apply.mjs` 与本文件的表格共用同一口径，避免两处各算一遍
  for (const r of ordered) r.mentions = mentions(r.path);

  const md = [];
  md.push('# 宿主路由索引（P2-11 前置 1 · 自动生成，勿手改）');
  md.push('');
  md.push('> 生成：`node test/tools/host-route-index.mjs --write`；核对：`node test/verify-route-index.mjs`');
  md.push('> （守卫会在索引与代码不一致时失败 —— 索引因此不会烂掉）。');
  md.push('>');
  md.push('> **依赖** = 该处理器块里引用到的 `apply` 作用域声明（缩进 ≤2）= **将来 context 对象的字段候选**；');
  md.push('> 同一列里反复出现的名字，就是该提出来的字段。拆到 `lib/routes/*.js` 的族则列它的 **`c` 字段**。');
  md.push('> 循环里注册的路由（`for (const seg of [...])`）按**实际条数**逐条列出，不折叠成一行。');
  md.push('> 路径列省略 `${BASE}` 前缀；因此**看起来同名的两行**是同一路径同时挂了根路径与带前缀');
  md.push('> 两条注册（渲染页按根路径上报，只挂一条会静默 404）。提及判定带尾边界，`/media` 不会被');
  md.push('> `/media-info` 误算成已覆盖。');
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
