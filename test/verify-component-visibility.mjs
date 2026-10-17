#!/usr/bin/env node
/**
 * verify-component-visibility.mjs —— 组件行**浏览器可见面**的判据（ADR-0013 D3 的 §验收 第 3 条）。
 *
 * 回答的边界问题：**关掉一个组件行之后，浏览器半边的哪些渲染函数真的不再渲染**。
 * 可见面声明与实现**双向对账**：声明了没 gate、gate 了没声明，两个方向都必须红 ——
 * 少了机械对账，这两个方向都是**静默通过**，用户看到的是"关掉了却还显示"或
 * "没声明的东西被顺手藏了"。
 *
 * ── 判据（每条都有牙；正判据与负对照调**同一份**判据函数）────────────────────────
 *   ① **覆盖**：声明表（`lib/component-visibility.js` 的 `COMPONENT_VISIBILITY`）里的每个
 *      `(组件, file, symbol)` 落点在磁盘上存在（file 在 `src/` 扫描面内、symbol 是该文件的顶层
 *      具名函数），且函数体内**真的**读组件状态 —— 判据要求那一句 gate 调用的**第一个实参提到
 *      `components`**（把状态面传进来），写死 `true` / `undefined` 这种"假 gate"会被判红。
 *   ② **双向对账**：声明里的落点都必须被 gate（`declared-not-gated`）；`src/**` 里每个 gate
 *      调用点都必须落在已声明的三元组内（`gated-not-declared`）。两个方向都红。
 *   ③ **负对照（有牙）**：把 `src/**` 里**全部** gate 调用抹掉 ⇒ 同一条判据必须为**每个**声明
 *      落点报 `declared-not-gated`；把一个 gate 注入**未声明**的函数 ⇒ 必须报 `gated-not-declared`；
 *      把声明表缩小一格而实现不动 ⇒ 同样报 `gated-not-declared`；再加一对**合成**正/负对照
 *      （合成落点 gate 在 ⇒ 0 违反，gate 不在 ⇒ 判红），证明判据既不恒真也不恒假，且不依赖
 *      实现进度。这几条把"判据恒真"与"声明表被悄悄缩小"一起堵住。
 *   ④ **失效口径（D3③）真跑**：从 `COMPONENT_GATE` 抽**真实现**的源码求值，喂夹具 —— 分两层：
 *      **整块** `components` 读不到 / 非对象 ⇒ 必须按"可用"渲染（探测失败不许让功能凭空消失）；
 *      而 `components` 是对象时**只有 `started` 算可用**（键缺席 = 行被 disable ⇒ 不可用，
 *      这正是"关掉一行 ⇒ 界面消失"的落点）。同一条夹具函数喂两个**变异体**（整块读不到也隐藏 /
 *      恒显示）必须判红（钉的是"方向"，不是"当前实现碰巧对"）。另外用**真处理器**驱动
 *      `lib/routes/inventory.js`：三态口径逐键对账、探针不可用时 `components` 字段**缺席**
 *      （宿主不合成"全 missing"假地图）。
 *   ⑤ **浏览器侧不得出现第二份"组件名 → UI"清单**（D3② 明文禁止）：`src/**` 里组件名的字符串
 *      字面量**只许**出现在 gate 调用的第二个实参位置；出现第二处（哪怕是另一张映射表 / 另一个
 *      消费点）即判红。负对照：合成一张映射表必须被抓到，只放 gate 调用则放行。
 *   ⑥ **覆盖面包线棘轮（D-G2）**：`SCOPE ∪ OUT_OF_SCOPE` 必须**恰好**等于「组件行宇宙」——
 *      分母由三份真源交叉而来（`cordis.patch.yml` 的组件行 · `COMPONENT_VIEW_KEYS` 的键 ·
 *      发现层 `test/tools/packages.mjs` 里认领到行的包），**不写死任何包名**。漏登记（新增一个
 *      组件行却两边都不提）与幽灵登记（拿登记表当万能筐）都判红；`OUT_OF_SCOPE` 的每一项还必须
 *      在会话声明面里有键（**豁免不得过期**）。为什么不用发现层的"包自带浏览器产物"过滤
 *      「带浏览器半边」：三格组件的浏览器半边住在**主 bundle**（各自没有产物）⇒ 那个口径今日是
 *      空集、判据会真空为真（假绿）。理由与分桶见 `registryCoverage()`。
 *
 * ── 为什么 `media-bridge` 显式排除（有意写成棘轮）────────────────────────────────
 *   本轮范围只有 `about-notice` 与 `mascot-avatar` 两行：用户口径是"`media-bridge` 是壁纸子插件
 *   的过渡形态，后续并入更大的语义变更" ⇒ 声明面的键集**恰为**这两组，多一行（或把某一行整个
 *   删掉）都必须显式回来改判据。这样"范围悄悄扩大 / 缩小"永远留下一次可见的改动。
 *
 * ── 判据只针对**代码与磁盘**（ADR-0007）────────────────────────────────────────
 *   先剥注释（共享的 `test/tools/js-text.mjs`，字符串感知）再判；锚点一律用**符号名与路径**，
 *   不写行号、不写会漂的数值。
 *
 * Usage:  node test/verify-component-visibility.mjs
 *         node test/verify-component-visibility.mjs --prove-teeth   # 只打印负对照的"红"作为牙齿证据
 */
// ⚠️ 只 import 用到的名字（`statSync` / `relative` / `sep` 在上一版扫描面写法里用过，现由
//    `source-locator` 承担枚举 ⇒ 未使用会被 `no-unused-vars` 判红）。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripComments, functionBodyOf } from './tools/js-text.mjs';
// 真源定位：三个落点（可见面声明 / 状态面路由 / 负对照的注入点文件）都不写死路径 ——
// 实现搬家时判据跟着符号走；0 处 / 多处声明即红（缺锚即红，不回落到默认值）。
import { locate, locateFile, moduleFace } from './tools/source-locator.mjs';
// 发现层（D-G2 覆盖面棘轮的分母之一）：行 ⇄ 包的**磁盘现实**，包名 / 目录名一律从磁盘取。
import { discoverPackages } from './tools/packages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BARE = 'dsh-plugin-wallpaper-engine';
/** 本轮范围（有意写成棘轮，见文件头）—— 声明面的键集必须恰为这两组。 */
const SCOPE = ['about-notice', 'mascot-avatar'];
const OUT_OF_SCOPE = ['media-bridge'];

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
const section = (t) => console.log('\n' + t);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * 锚点取值：判据在锚点丢失时必须**停在这里报红**，而不是拿空串 / 默认值继续比对。
 * ⚠️ 四处调用必须是**字面量** `locate('符号')`：`guard-targets.mjs` 的 G 类按文本认
 *    "这条守卫读了哪个模块"，写成变量实参就解析不出，本守卫的模块覆盖会**静默消失**。
 */
const anchorRel = (r) => {
  check('锚点：`' + (r.symbol || r.name) + '` 在真源面里唯一命中（0 处 / 多处即红）', r.ok, r.detail);
  return r.ok ? r.hit.rel : null;
};
const sameKeys = (a, b) => {
  const A = [...new Set(a)].sort();
  const B = [...new Set(b)].sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
};

// ── 纯函数判据（生产扫描与负对照共用同一份实现）────────────────────────────────

/** `src/**` 的扫描面：仓库相对 posix 路径 → **剥注释后**的源码。 */
function srcSources() {
  const out = new Map();
  const walk = (dir, base) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? base + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(join(dir, ent.name), rel);
      else if (ent.isFile() && ent.name.endsWith('.js')) {
        out.set(rel, stripComments(readFileSync(join(dir, ent.name), 'utf8')));
      }
    }
  };
  walk(join(ROOT, 'src'), 'src');
  return out;
}

/** patch 里**承载组件宿主半边**的行 → 组件名。两种形态：
 *   · 子路径形态（P-F 之前）：行 `name: '<裸包名>/<子路径>'` ⇒ 组件名 = 子路径
 *   · 真包名形态（P-F 之后）：行 `id: 'wallpaper-engine-<组件>'` + `name: '<裸包名>-<组件>'`
 *     （组件行出户到 `packages/<组件>/` 后目录名带连字符，行名只能是真包名）
 * 为什么两种都收：出户是**逐格**搬的，迁移期内两种会并存；本判据要防的是"声明了一个没有承载行
 * 的组件"（声明面 ↔ 行面的假绿），与那一行用哪种名字无关 —— 名字形态的收敛由
 * `test/verify-subpackage-manifests.mjs` 的 S3.1/S4.2 与主 patch 行对账负责。 */
function componentRowsFromPatch(text) {
  const src = String(text);
  const out = [];
  const subRe = new RegExp('name\\s*:\\s*[\'"]?' + esc(BARE) + '/([^\'"\\s#]+)', 'g');
  for (const m of src.matchAll(subRe)) if (!out.includes(m[1])) out.push(m[1]);
  // 真包名形态：同一条目内 `id: wallpaper-engine-<x>` 与 `name: '<裸包名>-<x>'` 必须**成对**
  // （只按 name 收，`<裸包名>-其他` 这种与 id 不符的行也会被算成组件行）。
  // `(?!-\s*id:)` 防止懒匹配跨到下一条目的 name 上。
  const rowRe = new RegExp(
    '-\\s*id:\\s*[\'"]?(wallpaper-engine-[A-Za-z0-9][\\w.-]*)[\'"]?'
    + '((?:(?!-\\s*id:)[\\s\\S]){0,200}?)name:\\s*[\'"]([^\'"\\s#]+)[\'"]', 'g');
  for (const m of src.matchAll(rowRe)) {
    const sub = m[1].slice('wallpaper-engine-'.length);
    if (m[3] === BARE + '-' + sub && !out.includes(sub)) out.push(sub);
  }
  return out.sort();
}

/**
 * D-G2 覆盖面包线棘轮（纯函数；生产扫描与全部负对照共用这一份实现）。
 *
 * **缺口**：`SCOPE` / `OUT_OF_SCOPE` 是**手写**的登记表 —— 新增一个组件行（宿主半边出户到
 * `packages/<组件>/`、浏览器半边仍在主 bundle 里）却两边都不提时，本文件原先**一条判据都不会红**：
 * 判据 ①②⑤ 的分母全部来自声明表本身，声明表不含它 ⇒ 恒真。
 *
 * **分母**（「组件行宇宙」）由三份真源交叉，**不写死任何包名**：
 *   · 行面：`cordis.patch.yml` 里承载组件宿主半边的行（`componentRowsFromPatch`）；
 *   · 会话声明面：`lib/kernel/component-session.js` 的 `COMPONENT_VIEW_KEYS` 键（组件清单真源）；
 *   · 包面：发现层 `discoverPackages()` 里**认领到 patch 行**的包（行 ⇄ 包的磁盘现实）。
 *
 * **为什么不用发现层的"包自带浏览器产物"过滤「带浏览器半边」**：三格组件的浏览器半边住在
 * **主 bundle**（它们自己不产产物）⇒ 那个口径今日交集是空集，判据会对空集真空为真（正是 D-G2
 * 要防的假绿）。所以分母取**组件行**（比「带浏览器半边」更宽：漏登记一定被抓到），而"带浏览器
 * 半边"的含量由既有判据面表达 —— `SCOPE` 项必须真被 gate（判据 ①）、豁免项必须显式记账（②）。
 *
 * 返回**分桶**（不是一句话）：负对照因此可以只钉一个桶，不必依赖"总条数变化"这种易受连带影响的读数。
 *   `floors`      分母塌陷（行面 / 会话面 / 包面为空，或宇宙为空）⇒ 判据真空为真，必须先红
 *   `dup`         登记表内部重复（同一名字既进 SCOPE 又进 OUT_OF_SCOPE，或列了两次）
 *   `notOnDisk`   会话面与行面认得它，但发现层找不到认领该行的包 ⇒ 组件行不许停在"宣言"上
 *   `universe`    分母本身（组件行宇宙）
 *   `missing`     漏登记：宇宙里但登记表里没有（D-G2 的正题）
 *   `ghost`       幽灵登记：登记表里但不在宇宙里（不许拿登记表当万能筐）
 *   `staleExempt` 豁免过期：`OUT_OF_SCOPE` 项在会话声明面里已经没有键
 */
function registryCoverage({ patchRows, viewKeys, discovered, scope, outOfScope }) {
  const rows = Array.isArray(patchRows) ? patchRows : [];
  const keys = Array.isArray(viewKeys) ? viewKeys : [];
  const disk = Array.isArray(discovered) ? discovered : [];
  const outScope = Array.isArray(outOfScope) ? outOfScope : [];
  const reg = (Array.isArray(scope) ? scope : []).concat(outScope);
  const floors = [];
  if (!rows.length) floors.push('patch 行面为空 ⇒ 组件行宇宙失真（解析失败 / 真源搬家）');
  if (!keys.length) floors.push('会话声明面 COMPONENT_VIEW_KEYS 为空 ⇒ 组件行宇宙为空');
  if (!disk.length) floors.push('发现层的包面为空 ⇒ 行 ⇄ 包 对账真空为真');
  const componentRows = rows.filter((n) => keys.includes(n));
  const notOnDisk = componentRows.filter((n) => !disk.includes(n));
  const universe = componentRows.filter((n) => disk.includes(n));
  if (!floors.length && !universe.length) floors.push('组件行宇宙为空 ⇒ 漏登记判据真空为真');
  return {
    floors,
    dup: reg.filter((n, i) => reg.indexOf(n) !== i),
    notOnDisk,
    universe,
    missing: universe.filter((n) => !reg.includes(n)),
    ghost: reg.filter((n) => !universe.includes(n)),
    staleExempt: outScope.filter((n) => !keys.includes(n)),
  };
}

/** 引号字符串的收尾位置（认 `\` 转义）；未闭合返回 -1。 */
function skipQuoted(code, i) {
  const q = code[i];
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === '\\') { j += 2; continue; }
    if (code[j] === q) return j;
    j++;
  }
  return -1;
}

/**
 * 从 `open`（`(` 的位置）起解析实参表：返回 `{ args: [{ text, at }], end }`，解析失败返回 `null`。
 * 花括号 / 方括号内的逗号不算分隔（认字符串与转义）。注释已被 `stripComments` 换成空格。
 */
function parseCallArgs(code, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const j = skipQuoted(code, i);
      if (j < 0) return null;
      i = j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (c === ')' && depth === 0) { args.push({ text: code.slice(start, i), at: start }); return { args, end: i }; }
      depth--;
      continue;
    }
    if (c === ',' && depth === 0) { args.push({ text: code.slice(start, i), at: start }); start = i + 1; }
  }
  return null;
}

/** 某个 gate 判据名的**调用点**（排除 `x.symbol(` 成员访问与 `function symbol(` 声明本身）。 */
function gateSitesOf(code, symbol) {
  const re = new RegExp('(^|[^.\\w$])' + esc(symbol) + '\\s*\\(', 'g');
  const out = [];
  for (const m of code.matchAll(re)) {
    const at = m.index + m[0].indexOf(symbol);
    // 定义处（`function weComponentVisible(`）不是调用点：算进来会让"第二个实参"变成形参名。
    if (/(?:^|[^\w$])(?:async\s+)?function\s+$/.test(code.slice(0, at))) continue;
    const open = m.index + m[0].length - 1;
    const call = parseCallArgs(code, open);
    if (!call) continue;
    out.push({ at, args: call.args });
  }
  return out;
}

/** 顶层具名函数 `function NAME(` / `const NAME = (` 的源码区间；不存在返回 `null`。 */
function namedFunctionRange(code, symbol) {
  const headers = [
    'function ' + symbol + '(',
    'const ' + symbol + ' = (',
    'const ' + symbol + ' = async (',
    'let ' + symbol + ' = (',
    'var ' + symbol + ' = (',
  ];
  for (const header of headers) {
    const start = code.indexOf(header);
    if (start < 0) continue;
    const body = functionBodyOf(code, header);
    if (body === null) continue;
    const bodyOpen = code.indexOf('{', start + header.length);
    if (bodyOpen < 0) continue;
    return { start, end: bodyOpen + body.length, header };
  }
  return null;
}

/** 实参文本是**单个字符串字面量**时返回它的内容，否则 `null`。 */
function literalName(text) {
  const m = /^\s*(['"])([^'"]*)\1\s*$/.exec(String(text));
  return m ? m[2] : null;
}

/**
 * 判据本体（唯一一份）：声明表 + gate 落点 + 扫描面 ⇒ 违反项。
 * 正判据与三条负对照都调它，输入不同而已。
 * @param {Record<string, {file: string, symbol: string}[]>} decl 可见面声明
 * @param {{file: string, symbol: string}} gate gate 判据落点
 * @param {Map<string, string>} sources 剥注释后的 `src/**` 源码
 * @returns {{ violations: {kind: string, detail: string}[], stats: object }}
 */
function auditVisibility(decl, gate, sources) {
  const violations = [];
  const entries = [];
  for (const [component, landings] of Object.entries(decl)) {
    for (const l of landings || []) entries.push({ component, file: l.file, symbol: l.symbol });
  }

  // gate 判据的**唯一**实现（两处实现本身就是"两份判据"，必须红）。
  const gateCode = sources.get(gate.file) || '';
  const defs = [...gateCode.matchAll(new RegExp('(^|[^.\\w$])function\\s+' + esc(gate.symbol) + '\\s*\\(', 'g'))].length;
  if (defs !== 1) {
    violations.push({ kind: 'gate-def', detail: gate.file + ' 里 `function ' + gate.symbol + '(` 出现 ' + defs + ' 次（必须恰 1 次）' });
  }

  const sites = [];
  // ⚠️ 除了规范 gate 符号，还要认**注入别名**（见 lib/component-visibility.js 的
  // COMPONENT_GATE_ALIASES）：模块边界真实化后，可单独 import 的模块通过注入拿到同一 gate，
  // 于是出现第二个调用名。**词汇扩展，不变量不变**（组件名字面量仍只许出现在 gate 实参里）。
  // ⚠️ 别名表**不许静默回落成空表**：`|| []` 会让"声明面把表搬走/改名"变成"词汇没了但判据照绿"
  //    （本会话实测：抹调用点的负对照漏掉别名落点，只报 4/5）。缺锚由 ① 的显式判据判红；
  //    这里若表为空，`aliasSites` 恒 0，下面的自检会把它点出来。
  let aliasSites = 0;
  for (const [rel, code] of sources) {
    for (const s of gateSitesOf(code, gate.symbol)) sites.push({ rel, at: s.at, args: s.args });
    for (const a of GATE_ALIASES) {
      for (const s of gateSitesOf(code, a.symbol)) { sites.push({ rel, at: s.at, args: s.args, via: a.symbol }); aliasSites++; }
    }
  }

  const ranges = [];
  for (const e of entries) {
    const code = sources.get(e.file);
    if (code === undefined) { violations.push({ kind: 'landing-file', detail: e.component + ' 的落点文件不在扫描面：' + e.file }); continue; }
    const r = namedFunctionRange(code, e.symbol);
    if (!r) { violations.push({ kind: 'landing-symbol', detail: e.component + ' 的落点函数找不到：' + e.file + '#' + e.symbol }); continue; }
    ranges.push({ ...e, ...r });
  }

  // ① 正向：声明了就必须被 gate（且真的把状态面传进来）。
  for (const r of ranges) {
    const hit = sites.filter((s) => s.rel === r.file && s.at > r.start && s.at < r.end
      && literalName((s.args[1] || {}).text || '') === r.component);
    if (hit.length === 0) {
      violations.push({
        kind: 'declared-not-gated',
        detail: r.file + '#' + r.symbol + " 体内没有 weComponentVisible(<状态面>, '" + r.component + "')",
      });
    }
  }

  // ② 反向：每个 gate 调用点都必须在声明的三元组内，且第一个实参真的提到 `components`。
  for (const s of sites) {
    const argName = literalName((s.args[1] || {}).text || '');
    const first = String((s.args[0] || {}).text || '');
    if (!argName) {
      violations.push({ kind: 'gate-name', detail: s.rel + ' 的 gate 第二个实参不是组件名字面量：' + JSON.stringify(first.trim()) });
      continue;
    }
    const owner = ranges.filter((r) => r.file === s.rel && s.at > r.start && s.at < r.end);
    if (!owner.some((r) => r.component === argName)) {
      violations.push({ kind: 'gated-not-declared', detail: s.rel + " 的 gate('" + argName + "') 不在任何已声明落点内" });
    }
    if (!/\bcomponents\b/.test(first)) {
      violations.push({ kind: 'gate-state-arg', detail: s.rel + ' 的 gate 第一个实参没把状态面传进来：' + JSON.stringify(first.trim()) });
    }
  }

  // ③ 浏览器侧不得出现第二份"组件名 → UI"清单：组件名字面量只许出现在 gate 的第二个实参位置。
  const gatedAt = new Map();
  for (const s of sites) {
    const arg = s.args[1];
    if (!arg) continue;
    const t = arg.text.trim();
    if (!literalName(t)) continue;
    const code = sources.get(s.rel) || '';
    const at = code.indexOf(t, arg.at);
    if (at < 0) continue;
    if (!gatedAt.has(s.rel)) gatedAt.set(s.rel, new Set());
    gatedAt.get(s.rel).add(at);
  }
  const stray = [];
  for (const name of Object.keys(decl)) {
    const lit = new RegExp("(['\"])" + esc(name) + '\\1', 'g');
    for (const [rel, code] of sources) {
      const allowed = gatedAt.get(rel) || new Set();
      for (const m of code.matchAll(lit)) if (!allowed.has(m.index)) stray.push(rel + ' 的 ' + JSON.stringify(m[0]));
    }
  }
  if (stray.length) {
    violations.push({ kind: 'second-list', detail: '组件名字面量出现在 gate 实参之外（浏览器侧不许有第二份"组件名 → UI"清单）：' + stray.join('、') });
  }

  return { violations, stats: { entries: entries.length, ranges: ranges.length, sites: sites.length, aliasSites, defs, files: sources.size } };
}

/**
 * 别名词汇的判据本体（生产与负对照调**同一份**）：`COMPONENT_GATE_ALIASES` 的每一条都必须是
 * **真的**——声明的文件在扫描面内、符号真的在那个文件里声明、真的被调用（≥1 处）、
 * 且规范 gate 的**注入点**真实存在于 `gate.file`（`injectedBy = gate.symbol` 或调用形态）。
 *
 * 由来（审计发现）：`lib/component-visibility.js` 里那段注释写着"判据强制：`GATE.file` 里必须存在
 * `<injectedBy>(<GATE.symbol>)` 的注入调用"，但**全仓没有一条判据读 `injectedBy`**（grep 零命中）
 * ⇒ 散文承诺了判据、判据不存在；别名只要写进数组就自动被当"第二个调用名"认账，
 * 哪怕它没声明、没调用、注入点被删（= 绕过 gate 的自由补丁）。这条把它们补齐。
 * @param {Array<{symbol: string, file: string, injectedBy: string}>} aliases
 * @param {Map<string, string>} sources 剥注释后的 `src/**`
 * @param {{file: string, symbol: string}} gate 规范 gate 落点
 * @returns {string[]} 违规清单（空 = 词汇合法）
 */
function aliasViolations(aliases, sources, gate) {
  const bad = [];
  for (const a of aliases) {
    if (!a || typeof a.symbol !== 'string' || !a.symbol || typeof a.file !== 'string' || !a.file || typeof a.injectedBy !== 'string' || !a.injectedBy) {
      bad.push('条目形状不全（要 symbol / file / injectedBy）：' + JSON.stringify(a));
      continue;
    }
    const code = sources.get(a.file);
    if (code === undefined) { bad.push(a.symbol + ' 声明的 file 不在扫描面：' + a.file); continue; }
    const declared = Boolean(namedFunctionRange(code, a.symbol))
      || new RegExp('(^|[^.\\w$])(?:const|let|var)\\s+' + esc(a.symbol) + '\\s*=').test(code);
    if (!declared) bad.push(a.symbol + ' 登记成词汇，却没在它声明的文件里声明：' + a.file);
    if (gateSitesOf(code, a.symbol).length === 0) bad.push(a.symbol + ' 登记成词汇，却在 ' + a.file + ' 里**零处调用**（死词汇）');
    const gateCode = sources.get(gate.file) || '';
    const injection = new RegExp(esc(a.injectedBy) + '\\s*(?:=|\\()\\s*' + esc(gate.symbol) + '\\b');
    if (!injection.test(gateCode)) {
      bad.push(a.injectedBy + ' 在 ' + gate.file + ' 里没有指向 ' + gate.symbol + ' 的注入（别名会绕过规范 gate）');
    }
  }
  return bad;
}

/** 从源码里抽出 gate 判据的**真实现**（只依赖自己的两个入参 ⇒ 可直接求值）。 */
function extractGateFunction(code, symbol) {
  const header = 'function ' + symbol + '(';
  const start = code.indexOf(header);
  if (start < 0) return { fn: null, why: '找不到 `function ' + symbol + '(`' };
  const body = functionBodyOf(code, header);
  if (body === null) return { fn: null, why: '函数体花括号不配对' };
  const open = start + header.length - 1;
  const close = code.indexOf(')', open);
  if (close < 0) return { fn: null, why: '参数表不配对' };
  const params = code.slice(open + 1, close);
  try {
    return { fn: new Function('return function ' + symbol + '(' + params + ')' + body)(), why: '' };
  } catch (e) {
    return { fn: null, why: '求值失败（判据必须自包含：只依赖两个入参）——' + e.message };
  }
}

/**
 * 失效口径的夹具（唯一一份）：喂**任何**同形函数，返回它违反的条目。
 *
 * 期望语义（D3③ + `lib/routes/inventory.js` 冻结的状态面契约）分两层，**别混**：
 *   · **整块** `components` 读不到 / 非对象（`undefined` / `null` / 数字 / 字符串）⇒ 按可用渲染
 *     （`true`）—— 探测失败不许让用户的功能凭空消失；
 *   · `components` 是对象时：只有 `'started'` 算可用；**键缺席**（行被 disable ⇒ 键压根不出现）、
 *     `missing`、`failed:<…>`、`undefined`、无法识别的值 ⇒ 不可用（`false`）。
 * 第二层正是"关掉一行 ⇒ 界面消失"的落点：把键缺席也当失效，功能就永远藏不掉。
 */
function gateSemantics(fn) {
  const NAME = 'about-notice';
  const out = [];
  const expect = (label, input, want) => {
    let got;
    try { got = Boolean(fn(input, NAME)); } catch (e) { out.push(label + '（抛 ' + e.message + '）'); return; }
    if (got !== want) out.push(label + '：期望 ' + want + ' 实测 ' + got);
  };
  expect('整块状态面 undefined ⇒ 按可用渲染', undefined, true);
  expect('整块状态面 null ⇒ 按可用渲染', null, true);
  expect('整块状态面非对象（数字）⇒ 按可用渲染', 0, true);
  expect('整块状态面非对象（字符串）⇒ 按可用渲染', 'nope', true);
  expect('对象但该组件的键缺席（行被 disable）⇒ 不渲染', {}, false);
  expect('键的值是 undefined ⇒ 不渲染', { [NAME]: undefined }, false);
  expect('值是无法识别的字符串 ⇒ 不渲染（只有 started 算可用）', { [NAME]: 'weird' }, false);
  expect('started ⇒ 渲染', { [NAME]: 'started' }, true);
  expect('missing ⇒ 不渲染', { [NAME]: 'missing' }, false);
  expect('failed:<文案> ⇒ 不渲染', { [NAME]: 'failed:boom' }, false);
  return out;
}

/** 用**真处理器**驱动 `/inventory`，取回响应体（`mock webServer` 只记路由，不启服务）。 */
async function inventoryResponse(routeMod, probe) {
  const registered = [];
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk !== undefined && chunk !== null) this.body += String(chunk); },
  };
  routeMod.registerInventoryRoutes({ register(route) { registered.push(route); return () => {}; } }, {
    disposers: [],
    base: '/wallpaper-engine',
    mediaOriginApi: { observeAdapter() {} },
    buildInventory: async () => ({ wallpapers: [] }),
    componentsProbe: probe,
  });
  await registered[0].handler({ method: 'GET', url: '/wallpaper-engine/inventory' }, res);
  return { json: JSON.parse(res.body), headers: res.headers };
}

/** `/inventory` 响应体里的 `components`（= 状态面；字段缺席时是 `undefined`）。 */
async function componentsMapOf(routeMod, probe) {
  return (await inventoryResponse(routeMod, probe)).json.components;
}

// ── 输入 ──────────────────────────────────────────────────────────────────────
// 四个落点一律**定位符号 / 文件名**（0 处 / 多处即红），不写死路径 —— 实现搬家时判据跟着走。
/** 可见面声明的单一真源（宿主侧；D3②）。 */
const DECL_REL = anchorRel(locate('COMPONENT_VISIBILITY'));
/** 状态面的真处理器（判据 ④ 走**真实注册路径**，不另造合成探针）。 */
const INVENTORY_ROUTE_REL = anchorRel(locate('registerInventoryRoutes'));
/** 组件行的唯一声明面（行 name 形如 `<裸包名>/<子路径>`）。 */
const PATCH_REL = anchorRel(locateFile('cordis.patch.yml'));
/**
 * 负对照 2 的注入点文件：按**符号**定位（原先写死 `src/panel-tabs.js`：实现搬家后负对照会拿
 * `sources.get(旧路径)` = undefined 去注入，红出来的是"夹具构造失败"这种误导性原因）。
 */
const TABS_REL = anchorRel(locate('renderWallpaperTab'));
const TABS_SYMBOL = 'renderWallpaperTab';

const declMod = await import(pathToFileURL(join(ROOT, DECL_REL)).href);
const routeMod = await import(pathToFileURL(join(ROOT, INVENTORY_ROUTE_REL)).href);
const DECL = declMod.COMPONENT_VISIBILITY;
const GATE = declMod.COMPONENT_GATE;
/**
 * 别名词汇表（`COMPONENT_GATE_ALIASES`）。**不许 `|| []` 静默回落**：它决定负对照 1 要抹哪些
 * 调用点、也决定"第二个调用名"认哪些；表没了 ⇒ 词汇没了，但判据不会因此变红（假绿）。
 * 缺锚由 ① 的显式判据判红；此处保留原值（可能是 `undefined`）以便判据点出"表缺失"。
 */
const GATE_ALIASES_RAW = declMod.COMPONENT_GATE_ALIASES;
const GATE_ALIASES = Array.isArray(GATE_ALIASES_RAW) ? GATE_ALIASES_RAW : [];
const sources = srcSources();
const patchRows = componentRowsFromPatch(read(PATCH_REL));
/** `source-locator` 的枚举真源：扫描面窄化（只扫固定文件 / 漏一个子目录）会被下面点名。 */
const SRC_FACE = moduleFace().filter((rel) => rel.startsWith('src/'));

// ── D-G2 覆盖面棘轮的三份真源（会话声明面 + 行面 + 发现层包面）──────────────────────
/** 组件清单真源（宿主侧）：组件名 → 内核视图键集。`registryCoverage()` 的分母之一。 */
const VIEW_KEYS_REL = anchorRel(locate('COMPONENT_VIEW_KEYS'));
const viewKeysMod = VIEW_KEYS_REL ? await import(pathToFileURL(join(ROOT, VIEW_KEYS_REL)).href) : {};
const VIEW_KEYS = viewKeysMod.COMPONENT_VIEW_KEYS;
const VIEW_KEYS_NAMES = VIEW_KEYS && typeof VIEW_KEYS === 'object' && !Array.isArray(VIEW_KEYS)
  ? Object.keys(VIEW_KEYS) : [];
/**
 * 发现层：包名 / 目录名一律从**磁盘**取（不写死）。`row` 非 null = 这个包在 patch 上认领到了行；
 * 组件行 = `<裸包名>-<组件>` 形态（主包行 `wallpaper-engine` 与子包行 fx / parallax / fonts 都不匹配）。
 */
const pkgModel = discoverPackages(ROOT);
const DISCOVERED_ROWS = (Array.isArray(pkgModel && pkgModel.packages) ? pkgModel.packages : [])
  .filter((p) => p && p.row && typeof p.row.name === 'string' && p.row.name.startsWith(BARE + '-'))
  .map((p) => p.row.name.slice(BARE.length + 1));
const cover = registryCoverage({
  patchRows, viewKeys: VIEW_KEYS_NAMES, discovered: DISCOVERED_ROWS, scope: SCOPE, outOfScope: OUT_OF_SCOPE,
});

const audit = auditVisibility(DECL, GATE, sources);
const kinds = (r) => r.violations.map((v) => v.kind);
const violated = (kind) => kinds(audit).includes(kind);

// ═══ ① 覆盖面与声明面自检（防空转；判据本身先落地）══════════════════════════════════
section('① 覆盖面与声明面自检（扫描面为空 ⇒ 下面每条判据都在空转）');
check('声明面 `' + DECL_REL + '` 导出 COMPONENT_VISIBILITY / COMPONENT_GATE',
  Boolean(DECL) && typeof DECL === 'object' && Boolean(GATE && GATE.file && GATE.symbol),
  GATE ? GATE.file + '#' + GATE.symbol : '**缺 COMPONENT_GATE**');
// 扫描面完整性：**对账 `source-locator` 的枚举真源**（而不是写死"≥30 个"这种快照地板）——
// 枚举真源一多一个文件而本判据漏扫，就在这里点名；扫描面塌陷自然也红。
check('扫描面完整：`srcSources()` 覆盖 `source-locator` 枚举出的每个 `src/**.js`（少扫 / 多扫都点名）',
  SRC_FACE.length > 0 && sources.size === SRC_FACE.length
  && SRC_FACE.every((rel) => sources.has(rel)),
  '枚举真源 ' + SRC_FACE.length + ' 个（' + (SRC_FACE.length ? SRC_FACE[0] + ' …' : '空') + '）· 本判据扫到 ' + sources.size + ' 个'
    + (SRC_FACE.filter((r) => !sources.has(r)).length ? ' · 漏扫 ' + SRC_FACE.filter((r) => !sources.has(r)).join(' ') : '')
    + ([...sources.keys()].filter((r) => !SRC_FACE.includes(r)).length ? ' · 多扫 ' + [...sources.keys()].filter((r) => !SRC_FACE.includes(r)).join(' ') : ''));
// 负对照：把扫描面**窄化**一个文件（合成输入）⇒ 上面同一条等式必须判红。
check('negative control：扫描面被窄化一个文件 ⇒ 同一条判据判红（"覆盖 == 枚举真源"不是恒真式）',
  sources.size > 1 && new Map([...sources].slice(1)).size !== SRC_FACE.length,
  '窄化后 ' + (new Map([...sources].slice(1)).size) + ' ≠ 真源 ' + SRC_FACE.length);
check('patch 里解析出 ≥2 个组件行（子路径形态 `<裸包名>/<子路径>` 或真包名形态 `<裸包名>-<组件>` + 配对 id）', patchRows.length >= 2, patchRows.join(' '));
check('本轮范围棘轮：声明面的键集恰为 [' + SCOPE.join(', ') + ']，且不含 [' + OUT_OF_SCOPE.join(', ') + ']',
  sameKeys(Object.keys(DECL), SCOPE) && !Object.keys(DECL).some((k) => OUT_OF_SCOPE.includes(k)),
  '声明面 = [' + Object.keys(DECL).join(', ') + '] · patch 行 = [' + patchRows.join(', ') + ']');
check('声明的每个组件名都在 patch 的组件行里（声明不许指向不存在的行）',
  Object.keys(DECL).every((k) => patchRows.includes(k)),
  Object.keys(DECL).join(' ') + ' ⊆ ' + patchRows.join(' '));
// ── D-G2 覆盖面包线棘轮（判据缺口：手写登记表漏一格时原先一条判据都不会红）──────────────
// 分母 = 行面 ∩ 会话声明面 ∩ 发现层包面，三份真源都不写死名字（见 `registryCoverage()`）。
console.log('    · D-G2 组件行宇宙 = [' + cover.universe.join(' ') + '] · 登记表 = ['
  + SCOPE.concat(OUT_OF_SCOPE).join(' ') + '] · 发现层认领的行 = [' + DISCOVERED_ROWS.join(' ') + ']');
check('D-G2 ① 覆盖面棘轮：组件行都在 SCOPE ∪ OUT_OF_SCOPE 里显式记账（漏登记即红）',
  cover.floors.length === 0 && cover.missing.length === 0,
  cover.floors.concat(cover.missing.map((n) => n + ' 是组件行却在 SCOPE / OUT_OF_SCOPE 里都没有（D-G2：漏登记）')).join('；')
    || '宇宙 ' + cover.universe.length + ' 个：' + cover.universe.join(' '));
check('D-G2 ② 豁免不得过期：`OUT_OF_SCOPE` 的每一项在 `' + VIEW_KEYS_REL + '` 的 COMPONENT_VIEW_KEYS 里都有键',
  cover.staleExempt.length === 0,
  cover.staleExempt.map((n) => n + ' 已不在 COMPONENT_VIEW_KEYS 里（要么补键，要么从 OUT_OF_SCOPE 摘掉）').join('；')
    || '[' + OUT_OF_SCOPE.join(' ') + '] ⊆ [' + VIEW_KEYS_NAMES.join(' ') + ']');
check('D-G2 ③ 反向：登记表不含非组件行（发现层认领的行 / COMPONENT_VIEW_KEYS 键 至少一项对不上即红）',
  cover.ghost.length === 0,
  cover.ghost.map((n) => n + ' 登记了但不在组件行宇宙里（不许拿登记表当万能筐）').join('；')
    || '登记表与宇宙两侧相等');
check('D-G2 ④ 会话面与行面认得、发现层找不到认领该行的包 ⇒ 判红（组件行不许停在"宣言"上）',
  cover.notOnDisk.length === 0,
  cover.notOnDisk.map((n) => n + ' 在 ' + PATCH_REL + ' 与 COMPONENT_VIEW_KEYS 里有，但发现层的包面里没有认领该行的包').join('；')
    || '三份真源两侧对得上');
check('D-G2 ⑤ 登记表内部无重复（同一个组件不许既进 SCOPE 又进 OUT_OF_SCOPE，也不许列两次）',
  cover.dup.length === 0,
  cover.dup.length ? '重复登记：' + [...new Set(cover.dup)].join(' ') : '无重复');

{
  // D-G2 的负对照：全部走**同一份** `registryCoverage()`，每条只造一个缺陷，并且钉**分桶**
  // （不是"总条数变了"这种易受连带影响的读数）。**合成基准与磁盘上的登记表解耦**（`synth`）：
  // 若拿真实 `SCOPE` / `OUT_OF_SCOPE` 当基准，登记表一旦被改坏，这些负对照会跟着"真空变绿"、
  // 牙就掉了。临时反例只存在于**内存输入**里，不落盘。
  const buckets = ['floors', 'dup', 'notOnDisk', 'missing', 'ghost', 'staleExempt'];
  const clean = (r) => buckets.every((k) => r[k].length === 0);
  const synth = { patchRows: ['__alpha', '__beta', '__gamma'], viewKeys: ['__alpha', '__beta', '__gamma'],
    discovered: ['__alpha', '__beta', '__gamma'], scope: ['__alpha', '__beta'], outOfScope: ['__gamma'] };
  const probe = '__we_component_probe__';
  // 正对照 1：真实输入必须干净 ⇒ 棘轮可满足、不是恒红。
  check('positive control（D-G2）：真实输入 ⇒ 六个桶全空（判据可满足、不是恒红）',
    clean(cover) && sameKeys(cover.universe, SCOPE.concat(OUT_OF_SCOPE)),
    '宇宙 = [' + cover.universe.join(' ') + '] · 登记 = [' + SCOPE.concat(OUT_OF_SCOPE).join(' ') + ']');
  // 正对照 2：合成第 4 个组件行（行面 / 会话面 / 包面三处都加）并登记进 OUT_OF_SCOPE ⇒ 仍干净。
  // 这条证的是"棘轮随新组件一起走"，不是"只认今天这几格"；没有它，漏登记负对照可能是别的原因红的。
  const added = registryCoverage(Object.assign({}, synth, {
    patchRows: synth.patchRows.concat(probe), viewKeys: synth.viewKeys.concat(probe),
    discovered: synth.discovered.concat(probe), outOfScope: synth.outOfScope.concat(probe),
  }));
  check('positive control（D-G2 新增组件已登记）：合成第 4 个组件行并登记 ⇒ 六个桶仍全空',
    clean(added) && added.universe.includes(probe), '宇宙 = [' + added.universe.join(' ') + ']');
  // 临时反例 1（漏登记）：三处真源都有这个组件行，登记表不动。
  const leaked = registryCoverage(Object.assign({}, synth, {
    patchRows: synth.patchRows.concat(probe), viewKeys: synth.viewKeys.concat(probe),
    discovered: synth.discovered.concat(probe),
  }));
  check('negative control（D-G2 漏登记）：合成一个组件行而 SCOPE / OUT_OF_SCOPE 都不提 ⇒ `missing` 桶判红',
    leaked.missing.length === 1 && leaked.missing[0] === probe, 'missing = [' + leaked.missing.join(' ') + ']');
  // 临时反例 2（豁免过期）：会话声明面抽掉 __gamma 的键，OUT_OF_SCOPE 不动。
  const stale = registryCoverage(Object.assign({}, synth, {
    viewKeys: synth.viewKeys.filter((k) => k !== '__gamma'),
  }));
  check('negative control（D-G2 ② 豁免过期）：会话面抽掉 __gamma 的键、`OUT_OF_SCOPE` 不动 ⇒ `staleExempt` 判红',
    stale.staleExempt.includes('__gamma'), 'staleExempt = [' + stale.staleExempt.join(' ') + ']');
  // 临时反例 3（幽灵登记）：有包、有行，但会话声明面里没有它的键。
  const ghost = registryCoverage(Object.assign({}, synth, { outOfScope: synth.outOfScope.concat('__ghost') }));
  check('negative control（D-G2 ③ 幽灵登记）：把 `__ghost` 塞进 OUT_OF_SCOPE（有行 / 有包，但会话面无键）⇒ `ghost` 判红',
    ghost.ghost.includes('__ghost'), 'ghost = [' + ghost.ghost.join(' ') + ']');
  // 临时反例 4（登记表内部重复）：同一个组件既进 SCOPE 又进 OUT_OF_SCOPE。
  const dup = registryCoverage(Object.assign({}, synth, { outOfScope: synth.outOfScope.concat('__alpha') }));
  check('negative control（D-G2 ⑤ 重复登记）：`__alpha` 既进 SCOPE 又进 OUT_OF_SCOPE ⇒ `dup` 桶判红',
    dup.dup.includes('__alpha'), 'dup = [' + dup.dup.join(' ') + ']');
  // 临时反例 5（真空为真地板）：行面 / 会话面 / 包面各塌陷一次。
  const noRows = registryCoverage(Object.assign({}, synth, { patchRows: [] }));
  const noKeys = registryCoverage(Object.assign({}, synth, { viewKeys: [] }));
  const noDisk = registryCoverage(Object.assign({}, synth, { discovered: [] }));
  check('negative control（D-G2 地板）：行面 / 会话面 / 包面任一为空 ⇒ `floors` 桶判红（判据不许真空为真）',
    noRows.floors.length > 0 && noKeys.floors.length > 0 && noDisk.floors.length > 0,
    '行面：' + noRows.floors.join(' ') + ' · 会话面：' + noKeys.floors.join(' ') + ' · 包面：' + noDisk.floors.join(' '));
  // 临时反例 6（判据 ④）：行面 / 会话面都认得 __beta，但发现层的包面缺它。
  const offDisk = registryCoverage(Object.assign({}, synth, {
    discovered: synth.discovered.filter((d) => d !== '__beta'),
  }));
  check('negative control（D-G2 ④）：发现层包面抽掉 __beta ⇒ `notOnDisk` 桶判红',
    offDisk.notOnDisk.includes('__beta'), 'notOnDisk = [' + offDisk.notOnDisk.join(' ') + ']');
}
check('gate 判据落点在扫描面内且符号存在',
  Boolean(sources.get(GATE.file)) && audit.stats.defs === 1,
  GATE.file + ' · `function ' + GATE.symbol + '(` 出现 ' + audit.stats.defs + ' 次');
check('声明落点 ≥ ' + SCOPE.length + ' 个、gate 调用点 ≥ 声明落点数（判据不是空对空）',
  audit.stats.entries >= SCOPE.length && audit.stats.sites >= audit.stats.entries,
  '声明 ' + audit.stats.entries + ' 个落点 / gate 调用 ' + audit.stats.sites + ' 个');

// ── 别名词汇（`COMPONENT_GATE_ALIASES`）──────────────────────────────────────────
// 审计发现：`lib/component-visibility.js` 里那段注释**承诺**"判据强制 GATE.file 里必须存在
// `<injectedBy>(<GATE.symbol>)` 的注入调用"，但全仓没有一条判据读 `injectedBy`（grep 零命中）
// ⇒ 别名只要写进数组就自动被认账，哪怕它没声明 / 没调用 / 注入点被删（= 绕过 gate 的自由补丁）。
// 下面三条把它补成机器判据，负对照见 ③ NC-6/NС-7。
check('锚点：声明面导出非空数组 COMPONENT_GATE_ALIASES（缺锚即红 —— `|| []` 会让词汇消失而判据照绿）',
  Array.isArray(GATE_ALIASES_RAW) && GATE_ALIASES.length > 0,
  Array.isArray(GATE_ALIASES_RAW) ? GATE_ALIASES.length + ' 条：' + GATE_ALIASES.map((a) => a && a.symbol).join(' ') : '**COMPONENT_GATE_ALIASES 缺失 / 非数组**');
{
  const aliasBad = aliasViolations(GATE_ALIASES, sources, GATE);
  check('别名词汇有牙：每条别名都真的声明在其 file 里 + 真的被调用（≥1 处）+ 注入点在 GATE.file 里存在',
    aliasBad.length === 0, aliasBad.join('；') || GATE_ALIASES.map((a) => a.symbol + '@' + a.file + ' ← ' + a.injectedBy).join(' · '));
  check('别名词汇不空转：别名调用点是真被扫到的（否则负对照 1 的口径会静默变窄）',
    audit.stats.aliasSites > 0, '别名调用点 ' + audit.stats.aliasSites + ' 处 / 总 gate 调用点 ' + audit.stats.sites + ' 处');
  // 负对照（调**同一份** aliasViolations，合成/变异输入）：
  const deadAlias = [{ symbol: 'deadAliasGuardProbe', file: TABS_REL, injectedBy: 'globalThis.__weComponentVisible' }];
  check('negative control（别名 1）：登记了却**零处调用**的死别名 ⇒ 同一条判据判红',
    TABS_REL !== null && aliasViolations(deadAlias, sources, GATE).some((v) => /零处调用/.test(v)),
    aliasViolations(deadAlias, sources, GATE).join('；') || '**没判红**');
  const ghostFileAlias = [{ symbol: GATE_ALIASES[0] && GATE_ALIASES[0].symbol, file: 'src/__no_such_alias_file__.js', injectedBy: 'globalThis.__weComponentVisible' }];
  check('negative control（别名 2）：别名声明的 file 不在扫描面 ⇒ 同一条判据判红',
    aliasViolations(ghostFileAlias, sources, GATE).some((v) => /不在扫描面/.test(v)),
    aliasViolations(ghostFileAlias, sources, GATE).join('；') || '**没判红**');
  const noInjection = GATE_ALIASES.map((a) => ({ ...a }));
  const gateFileStripped = new Map(sources).set(GATE.file, (sources.get(GATE.file) || '').replace(/globalThis\.__weComponentVisible\s*=\s*[\w$]+/, 'x'));
  check('negative control（别名 3）：把 GATE.file 里的注入行删掉 ⇒ 同一条判据判红（散文承诺的那条判据真的在跑）',
    noInjection.length > 0 && aliasViolations(noInjection, gateFileStripped, GATE).some((v) => /没有指向/.test(v)),
    aliasViolations(noInjection, gateFileStripped, GATE).join('；') || '**没判红**');
  check('negative control（别名 4）：别名退出规范 gate（没声明）⇒ 同一条判据判红',
    aliasViolations([{ symbol: 'noSuchAliasDecl', file: TABS_REL, injectedBy: 'globalThis.__weComponentVisible' }], sources, GATE)
      .some((v) => /却没在它声明的文件里声明/.test(v)));
}

// ═══ ② 判据 ①②⑤：声明 ↔ 实现双向对账（生产扫描）═══════════════════════════════════
section('② 声明 ↔ 实现双向对账（声明没 gate / gate 没声明 / 浏览器侧第二份清单，都红）');
check('判据 ① 每个声明落点都存在于磁盘且真的读组件状态（gate 第一个实参提到 components）',
  !violated('landing-file') && !violated('landing-symbol') && !violated('gate-state-arg') && !violated('gate-def') && !violated('gate-name'),
  audit.violations.filter((v) => ['landing-file', 'landing-symbol', 'gate-state-arg', 'gate-def', 'gate-name'].includes(v.kind)).map((v) => v.detail).join('；')
    || audit.stats.ranges + ' 个落点 · gate 定义 ' + audit.stats.defs + ' 处');
check('判据 ② 声明的落点都真的被 gate（declared-not-gated = 0）', !violated('declared-not-gated'),
  audit.violations.filter((v) => v.kind === 'declared-not-gated').map((v) => v.detail).join('；') || '全部被 gate');
check('判据 ② 被 gate 的落点都在声明里（gated-not-declared = 0）', !violated('gated-not-declared'),
  audit.violations.filter((v) => v.kind === 'gated-not-declared').map((v) => v.detail).join('；') || '全部已声明');
check('判据 ⑤ 浏览器侧零处第二份"组件名 → UI"清单（组件名字面量只出现在 gate 实参）', !violated('second-list'),
  audit.violations.filter((v) => v.kind === 'second-list').map((v) => v.detail).join('；')
    || Object.keys(DECL).join(' / ') + ' 的字面量只出现在 gate 第二个实参');

// ═══ ③ 判据 ③：负对照 —— 同一条 auditVisibility 必须能判出三种"做错"的输入 ═══════════
section('③ 判据 ③ 负对照：同一条判据对"故意做错"的输入必须判红');
/** 把源码里**所有** gate 调用抹成等长空格（长度不变 ⇒ 落点区间与其余偏移都不动）。 */
function blankGates(code, gateSymbol) {
  const re = new RegExp('(^|[^.\\w$])' + esc(gateSymbol) + '\\s*\\(', 'g');
  const marks = [];
  for (const m of code.matchAll(re)) {
    const at = m.index + m[0].indexOf(gateSymbol);
    if (/(?:^|[^\w$])(?:async\s+)?function\s+$/.test(code.slice(0, at))) continue; // 定义处不动
    const call = parseCallArgs(code, m.index + m[0].length - 1);
    if (!call) continue;
    marks.push([at, call.end + 1]);
  }
  let out = code;
  for (const [s, e] of marks) out = out.slice(0, s) + ' '.repeat(e - s) + out.slice(e);
  return { code: out, count: marks.length };
}
/** 往某个**未声明**的函数体开头注入一条 gate 调用。 */
function injectGateIn(code, symbol, component, gateSymbol) {
  const range = namedFunctionRange(code, symbol);
  if (!range) return null;
  const open = code.indexOf('{', range.start);
  if (open < 0) return null;
  const call = ' ' + gateSymbol + "(components, '" + component + "');";
  return code.slice(0, open + 1) + call + code.slice(open + 1);
}

{
  // NC-1（真实源码，无条件）：把 `src/**` 里**全部** gate 调用抹掉 ⇒ 每个声明落点都必须被判
  // `declared-not-gated`。这条与"实现还没落地"无关：落地前后它都成立（落地前本来就已经红了，
  // 落地后恰好证明"红的确是判据给的"）。
  const blanked = new Map();
  let blankedCount = 0;
  for (const [rel, code] of sources) {
    let b = blankGates(code, GATE.symbol);
    // ⚠️ **别名（注入形态）的调用点也要抹** —— 否则"抹掉 src/** 里全部 gate 调用"这个负对照
    // 会漏掉注入型落点，覆盖面悄悄变窄（本仓实测：抹 4 处却只报 4/5 个声明落点）。
    // 词汇扩展必须连**验证该词汇的负对照**一起扩展，否则负对照自己变成假红。
    for (const al of GATE_ALIASES) {
      const ab = blankGates(b.code, al.symbol);
      b = { code: ab.code, count: b.count + ab.count };
    }
    if (b.count) { blanked.set(rel, b.code); blankedCount += b.count; }
  }
  for (const [rel, code] of sources) if (!blanked.has(rel)) blanked.set(rel, code);
  const ncBlanked = auditVisibility(DECL, GATE, blanked);
  const ncBlankedKinds = ncBlanked.violations.filter((v) => v.kind === 'declared-not-gated');
  check('负对照 1：把 src/** 里全部 gate 调用抹掉（' + blankedCount + ' 处）⇒ 同一条判据为**每个**声明落点报 declared-not-gated',
    audit.stats.ranges >= SCOPE.length && ncBlankedKinds.length === audit.stats.ranges,
    '抹掉 ' + blankedCount + ' 处 · 声明落点 ' + audit.stats.ranges + ' 个 ⇒ 报 ' + ncBlankedKinds.length + ' 个');
  // 负对照 1 的**覆盖面自检**：抹掉的调用点数必须等于判据扫到的调用点数（含别名）。
  // 这条钉的正是"词汇扩展了但负对照没跟着扩展"那个坑（本仓实测：漏抹别名 ⇒ 只报 4/5）：
  // 一旦别名表多一条而这里没抹到，两边就不等 ⇒ 红。
  check('负对照 1 自检：抹掉的调用点数 == 判据扫到的调用点数（含别名，共 ' + audit.stats.sites + ' 处）',
    blankedCount === audit.stats.sites,
    '抹掉 ' + blankedCount + ' / 扫到 ' + audit.stats.sites + '（规范 ' + (audit.stats.sites - audit.stats.aliasSites) + ' + 别名 ' + audit.stats.aliasSites + '）');

  // NC-2：把 gate 注入一个**未声明**的函数 ⇒ gated-not-declared。
  // 注入点文件与函数名都来自锚点（`locate('renderWallpaperTab')`），不写死路径。
  const tabsRel = TABS_REL;
  const injected = tabsRel === null ? null : injectGateIn(sources.get(tabsRel), TABS_SYMBOL, 'about-notice', GATE.symbol);
  const ncInject = injected === null ? null : auditVisibility(DECL, GATE, new Map(sources).set(tabsRel, injected));
  check('负对照 2：gate 被放进未声明的函数 ⇒ 同一条判据报 gated-not-declared',
    Boolean(ncInject) && ncInject.violations.some((v) => v.kind === 'gated-not-declared'),
    ncInject ? (ncInject.violations.map((v) => v.kind).join(',') || '**没报**') : '夹具构造失败（`' + TABS_SYMBOL + '` 的锚点丢了？见 ① 的锚点判据）');

  // NC-3：声明表缩小一格而实现不动 ⇒ 同样 gated-not-declared（防"声明被悄悄删掉"）。
  const shrunk = { ...DECL, 'about-notice': [] };
  const ncShrink = auditVisibility(shrunk, GATE, sources);
  check('负对照 3：声明表把 about-notice 的落点删空而实现不动 ⇒ 同一条判据报 gated-not-declared',
    ncShrink.violations.some((v) => v.kind === 'gated-not-declared'),
    ncShrink.violations.map((v) => v.kind).join(',') || '**没报**');

  // NC-4：第二份清单的检测器（合成一张 `组件名 → UI` 表）必须被抓到；只放 gate 调用则放行。
  const synthRel = 'src/__synth__.js';
  const synthMap = "const SECOND_LIST = { 'about-notice': [1], 'mascot-avatar': [2] };\n";
  const synthGate = "function renderAboutTab() { if (!weComponentVisible(components, 'about-notice')) return null; }\n";
  const ncMap = auditVisibility(DECL, GATE, new Map([[synthRel, synthMap]]));
  const ncGateOnly = auditVisibility(DECL, GATE, new Map([[synthRel, synthGate]]));
  check('负对照 4：合成第二份"组件名 → UI"表被判 second-list；只放 gate 调用时同一条判据不报 second-list',
    ncMap.violations.some((v) => v.kind === 'second-list') && !ncGateOnly.violations.some((v) => v.kind === 'second-list'),
    '合成映射表 ⇒ [' + ncMap.violations.map((v) => v.kind).join(',') + '] · 合成 gate 调用 ⇒ [' + ncGateOnly.violations.map((v) => v.kind).join(',') + ']');

  // 正对照（合成夹具，无条件）：同一份判据在"落点真的被 gate"时 0 违反；gate 一拿掉就红。
  // 这条证明判据既不是恒真（能红）也不是恒假（能绿），且不依赖实现进度。
  const fxRel = 'src/__fixture__.js';
  const fxGate = 'function ' + GATE.symbol + '(components, name) {\n'
    + "  if (!components || typeof components !== 'object') return true;\n"
    + "  return components[name] === 'started';\n}\n";
  const fxGated = 'function renderAboutTab() { if (!' + GATE.symbol + "(components, 'about-notice')) return null; return 1; }\n";
  const fxUngated = 'function renderAboutTab() { return 1; }\n';
  const fxSources = (code) => new Map([[GATE.file, fxGate], [fxRel, code]]);
  const declFx = { 'about-notice': [{ file: fxRel, symbol: 'renderAboutTab' }] };
  const fxOn = auditVisibility(declFx, GATE, fxSources(fxGated));
  const fxOff = auditVisibility(declFx, GATE, fxSources(fxUngated));
  check('正对照（合成）：gate 在 ⇒ 同一条判据 0 违反；gate 不在 ⇒ 报 declared-not-gated（判据既不恒真也不恒假）',
    fxOn.violations.length === 0 && fxOff.violations.some((v) => v.kind === 'declared-not-gated'),
    'gate 在 ⇒ [' + fxOn.violations.map((v) => v.kind).join(',') + '] · gate 不在 ⇒ [' + fxOff.violations.map((v) => v.kind).join(',') + ']');

  // 生产判据自身不空转：真实输入必须**零**违反（这时上面的负对照才证明"判红是真的判红"）。
  check('正对照：真实输入下同一条判据 violation = 0（判据不是恒真，也不是恒假）',
    audit.violations.length === 0,
    audit.violations.length ? audit.violations.map((v) => v.kind).join(',') : '0 违反');

  // `--prove-teeth`：只把负对照的"红"打出来当牙齿证据（判据正确时报 exit 0）。
  if (process.argv.includes('--prove-teeth')) {
    console.log('\n  ── [--prove-teeth] 负对照的红（这些输入被同一条判据判红）──');
    for (const [label, r] of [['NC-1 抹掉全部 gate 调用', ncBlanked], ['NC-2 gate 放进未声明函数', ncInject],
      ['NC-3 声明表删空一格', ncShrink], ['NC-4 合成第二份清单', ncMap], ['NC-5 合成：gate 拿掉', fxOff]]) {
      console.log('   · ' + label + ' ⇒ ' + (r ? r.violations.map((v) => v.kind).join(', ') || '**没报（牙齿缺失）**' : '夹具构造失败'));
    }
    for (const d of (ncBlanked || { violations: [] }).violations) console.log('     - ' + d.detail);
    for (const d of (ncInject || { violations: [] }).violations) console.log('     - ' + d.detail);
  }
}

// ═══ ④ 判据 ④：失效口径真跑（真实现 + 三态夹具 + 状态面真处理器）══════════════════════
section('④ 判据 ④ 失效口径：真跑 gate 实现与 /inventory 真处理器（缺席 ≠ 全不可用）');
{
  const gateCode = sources.get(GATE.file) || '';
  const extracted = extractGateFunction(gateCode, GATE.symbol);
  check('能从 `' + GATE.file + '` 抽出 gate 判据的真实现并求值', typeof extracted.fn === 'function', extracted.why || 'ok');

  const real = typeof extracted.fn === 'function' ? gateSemantics(extracted.fn) : ['真实现没抽出来'];
  check('真实现满足失效口径：整块读不到 / 非对象 ⇒ 按可用渲染；对象内只有 started 算可用（键缺席 / missing / failed: ⇒ 不渲染）',
    real.length === 0, real.join('；') || '10 条夹具全过');

  // 变异体（同一夹具函数）：两个方向都必须判红 —— 整块读不到也隐藏 / 恒显示。
  const mutantFailClosed = (components, name) => Boolean(components) && components[name] === 'started';
  const mutantShow = () => true;
  check('负对照（方向 1）："整块状态面读不到也隐藏"的变异体被同一条夹具判红（D3③ 的方向被钉住）',
    gateSemantics(mutantFailClosed).length > 0, gateSemantics(mutantFailClosed).join('；') || '**没判红**');
  check('负对照（方向 2）："恒显示"的变异体被同一条夹具判红（判据不是恒真）',
    gateSemantics(mutantShow).length > 0, gateSemantics(mutantShow).join('；') || '**没判红**');

  // 状态面：走**真实注册路径**（真 handler + mock webServer），不另造合成探针。
  // 夹具形态照**被 disable 的行**：`builtin` 是本包写死的组件行面、`declared` 是本次 patch 的
  // 子行面（被 disable 的行不在里面）⇒ 状态表按 `builtin` 出行，那个行是 `missing` 而**键仍在**
  //（键消失会让消费方无法区分"行被关掉"与"状态面读不到"）。
  const builtin = ['about-notice', 'mascot-avatar', 'media-bridge'];
  const probe = () => ({
    declared: ['about-notice', 'mascot-avatar'],
    builtin,
    loaded: ['about-notice', 'mascot-avatar'],
    started: ['about-notice'],
    failed: { 'mascot-avatar': 'boom' },
    missing: ['media-bridge'],
  });
  const got = await componentsMapOf(routeMod, probe);
  check('状态面三态口径：键集 = 内建组件行面（被 disable 的行是 `missing` 而不是键消失）/ failed:<文案> / started 逐键对账',
    Boolean(got) && sameKeys(Object.keys(got), builtin)
      && got['about-notice'] === 'started' && got['mascot-avatar'] === 'failed:boom' && got['media-bridge'] === 'missing',
    JSON.stringify(got));

  const absent = await componentsMapOf(routeMod, null);
  const absentNonObj = await componentsMapOf(routeMod, () => 'nope');
  check('探针不可用 / 返回非对象 ⇒ `components` 字段**缺席**（宿主不合成"全 missing"假地图；D3③ 方向）',
    absent === undefined && absentNonObj === undefined,
    'probe=null ⇒ ' + JSON.stringify(absent) + ' · probe 非对象 ⇒ ' + JSON.stringify(absentNonObj));
  const synthesized = await componentsMapOf(routeMod, () => ({ builtin, declared: [], loaded: [], started: [], failed: {}, missing: builtin }));
  check('负对照：合成"全 missing"地图与字段缺席是**两种形状**（同一条取数函数，判据没把两者混为一谈）',
    synthesized !== undefined && Object.values(synthesized).every((v) => v === 'missing') && absent === undefined,
    '合成 ⇒ ' + JSON.stringify(synthesized));
  const emptyDeclared = await componentsMapOf(routeMod, () => ({ declared: [], builtin: [], loaded: [], started: [], failed: {}, missing: [] }));
  check('两个面都读不出 ⇒ 字段同样**缺席**（不是"全不可用"）',
    emptyDeclared === undefined, JSON.stringify(emptyDeclared));

  const resp = await inventoryResponse(routeMod, probe);
  check('响应头仍逐字保留（不得改用 sendJson 换头）',
    resp.headers['Content-Type'] === 'application/json; charset=utf-8' && resp.headers['Cache-Control'] === 'no-store',
    String(resp.headers['Content-Type']) + ' · ' + String(resp.headers['Cache-Control']));
  check('判据不存在的文件面：声明表与状态面都是磁盘真源（本判据读的三个路径都存在）',
    existsSync(join(ROOT, DECL_REL)) && existsSync(join(ROOT, INVENTORY_ROUTE_REL)) && existsSync(join(ROOT, PATCH_REL)),
    [DECL_REL, INVENTORY_ROUTE_REL, PATCH_REL].join(' '));
}

console.log('');
if (failed) {
  console.log('COMPONENT VISIBILITY CHECKS FAILED — ' + failed + ' failed');
  console.log('（判据先落、实现后到是预期形态：声明的可见面在 src/** 里还没被 gate 时，本守卫就是红的。）');
  process.exit(1);
}
console.log('ALL COMPONENT VISIBILITY CHECKS PASSED');
process.exit(0);
