#!/usr/bin/env node
/**
 * verify-inject-contracts.mjs — **注入契约双向对账**（ADR-0013 的 D12②「每个路由族带一份显式声明键集、与调用点双向对账」；度量 M8）。
 *
 * 为什么必须有它（度量 M8 的现状）：`lib/index.js` 的 `apply()` 是**手工 DI 组合根** —— 每个
 * `registerXxxRoutes(webServer, { … })` 的键集就是那个族的全部依赖面，可那份键集**只存在于调用点**：
 * `lib/routes/*.js`（P2-8 起还有组件目录里的实现文件）文件头写的"契约"是散文，没有任何判据核对
 * ⇒ 依赖面**不可声明、不可核对**。
 * 本守卫把两侧拉到同一张纸上，逐一比对：
 *
 *   ① **声明面 ↔ 消费面**（同一个文件内）：每个路由族模块（`lib/routes/*.js` ∪ 组件目录直接子文件）
 *      顶上 `export const DEPS`（必需键）与
 *      `export const OPTIONAL_DEPS`（允许缺席的键）必须与"该模块真的从 `c` 消费到的键"**逐键相等**
 *      —— 少一个（用了没声明）与多一个（声明了没用）都是红的。
 *   ② **声明面 ↔ 调用点**（跨文件）：每个 `registerXxxRoutes(webServer, { … })` 的实参键必须
 *      满足 `DEPS ⊆ 实参键 ⊆ DEPS ∪ OPTIONAL_DEPS`。两个方向都要，否则"声明了没人给"与
 *      "给了没声明"各漏一半。调用点来源是**数据驱动**的 `MAIN_MODULES`（门面 + 出户的组件行入口），
 *      不写死文件名。
 *
 * ── 为什么消费面不能"只扫解构"（本仓实测的三种形态，缺一条就误判）─────────────────
 *   · **多行解构**：字段一多就换行（upload.js 的 16 个键）。逐行匹配会解析出 0 个字段 ⇒ 判据变空
 *     而恒真（`verify-route-index.mjs` ④ 也踩过同一个坑）。
 *   · **`c.x` 成员访问就是消费**：`fontsets.js` / `presets.js` 的注册函数只解构 3 / 2 个键，其余
 *     全靠 `c.ensureDirOnce(...)` 这类成员访问 —— 只扫解构会把它们漏成"声明了没人给"。
 *   · **ctx 被传进模块级 helper**：`function userDir(c) { return c.fontSetsDir(); }` 的 `c` 就是那个
 *     注入对象，键在**注册函数体外**被消费。只看注册函数体就会漏键（并可能把真声明判成死声明）。
 *   · **反向陷阱**：`req.on('data', (c) => { size += c.length; })` 里的 `c` 是 Buffer 形参，与注入
 *     对象同名。不排掉它，`length` 会混进契约（实测：`scene-frame.js` 与 `upload.js` 里那两处
 *     `req.on('data', (c) => { size += c.length; })` 回调 —— 引用**符号**，不写会漂的行号）。
 *     ⇒ 判定规则：**缩进 0 处**（模块作用域）绑定 ctx 名的函数/箭头是消费者；**嵌套**绑定的
 *     一律按"遮蔽"排除（它的成员访问不算契约）。模块级消费者还要求"名字在文件里被引用过"
 *     （死 helper 不算），避免把无关的 `function pick(c)` 当契约。
 *
 * ── 解析为什么要先"中和"字符串与正则（而不是裸正则扫源码）──────────────────────
 * 括号/逗号/冒号在这三种原子内部合法出现（`'a,b'`、`/[{]/`、模板里的 `${}`），裸扫会把对象字面量
 * 切错、把花括号配错。本文件先用 `js-text.mjs` 的 `stripComments`（字符串感知、**等长**、换行保留）
 * 再按同一套"上一个有意义字符"启发式把字符串与正则**逐字符**换成 `x` ⇒ 偏移与行号与原文一一对应，
 * 而扫描面上只剩纯语法骨架。`neutralize()` 的替换是**等长**的，所以 `lineOf()` 报的行号就是原文行号。
 *
 * ── 负对照（每条都走**生产路径同一份**判据，不是另写一遍）────────────────────────
 *   nc1 少声明一个消费键 ⇒ 红；nc2 多声明一个没消费的键 ⇒ 红；nc3 调用点少给一个必需键 ⇒ 红；
 *   nc4 调用点多给一个没声明的键 ⇒ 红；nc5 嵌套 `(c) => c.length` 不得混进契约 ⇒ 消费面必须不变；
 *   nc6 模块级 helper 消费的键**必须**被看见（`fontSetsDir`）；nc7 多行解构 + 重命名（`base: BASE`）。
 *
 * 用法：
 *   node test/verify-inject-contracts.mjs            # 对账并打印结论（`M8=100%`）
 *   node test/verify-inject-contracts.mjs --dump     # 额外打印每个模块"应当声明的键集"（贴声明用）
 *
 * ⚠️ 阈值型判据（"每族都有声明"）必须配**非空地板**：解析器一旦静默返回空表，逐族相等会变成
 *    "空对空"而恒真。下面 `M8` 的计数与 `modules.length >= 21` / `declaredKeys >= 40` 就是那个地板。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 剥注释：共享的字符串感知实现（同目录 js-text.mjs）。等长 + 保留换行 ⇒ 行号可用来报错。
import { stripComments } from './tools/js-text.mjs';
// 调用点来源：门面 + 出户组件行入口（**数据驱动**，不写死文件名/组件名）。
// 路由族文件面：`lib/routes/*.js` ∪ 组件目录直接子文件（P2-8 起实现随组件走）—— 同一个枚举真源。
// `buildIndex`：**另一个解析器**（按行首形态 + 独立的 `c` 字段扫描）对同一条枚举真源的结果，
// 本守卫用它做"覆盖面"的对账对象，取代原先写死的 ≥21 / ≥40 / ≥20 地板数（快照）。
import { MAIN_MODULES, parseRouteModuleText, routeModuleFiles, buildIndex, rowRegistrationCounts } from './tools/host-route-index.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 控制关键字的 `(…) {` 不是形参表 —— 不排掉会把 `if (…) { … }` 的整块文本当函数体。 */
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'with', 'return', 'throw',
  'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'await', 'yield',
]);

// ── 文本层：中和 + 偏移工具 ─────────────────────────────────────────────────────

/**
 * 把注释、字符串/模板字面量、正则字面量**逐字符**换成 `x`（换行保留）⇒ 长度与原文相等、
 * 每行的列偏移不变。注释那一步委托 `stripComments`（字符串感知）；字符串/正则这两步抄同一套
 * "上一个有意义字符"启发式（见 js-text.mjs 文件头：`/` 在值结尾字符之后按除号处理）。
 * 中和之后，`topLevelSplit` / 花括号配平只需认真正的语法括号。
 * @param {string} raw 源码
 * @returns {string} 等长中和文本
 */
function neutralize(raw) {
  const text = stripComments(String(raw));
  const out = text.split('');
  const isValueEnd = (ch) => ch !== '' && /[\w$)\]}'"`]/.test(ch);
  let prev = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out[i] = 'x'; i++;
      while (i < text.length) {
        const d = text[i];
        if (d === '\n') { i++; continue; } // 换行原样留（行号不变）
        if (d === '\\') { out[i] = 'x'; if (i + 1 < text.length) out[i + 1] = 'x'; i += 2; continue; }
        out[i] = 'x'; i++;
        if (d === quote) break;
      }
      prev = quote;
      continue;
    }
    if (c === '/' && !isValueEnd(prev)) {
      out[i] = 'x'; i++;
      let inClass = false;
      while (i < text.length) {
        const d = text[i];
        if (d === '\n') break; // 行内未闭合就收手，绝不跨行吞
        if (d === '\\') { out[i] = 'x'; if (i + 1 < text.length) out[i + 1] = 'x'; i += 2; continue; }
        out[i] = 'x'; i++;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
      }
      prev = '/';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/** 偏移 → 1-based 行号（中和文本与原文等长，所以这也是原文行号）。 */
function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

/** 偏移处的行首缩进（空格数）—— "模块作用域"判定用它。 */
function indentAt(text, idx) {
  let s = idx;
  while (s > 0 && text[s - 1] !== '\n') s--;
  let n = 0;
  while (s + n < text.length && (text[s + n] === ' ' || text[s + n] === '\t')) n++;
  return n;
}

/** 从 `open`（`{` 的下标）配平到闭合 `}` 的下标；失败返回 -1（调用方必须判红，不许静默放行）。 */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 顶层（括号/方括号/花括号深度为 0）切分；返回每段的文本与相对偏移。 */
function topLevelSplit(text, sep = ',') {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === sep && depth === 0) { parts.push({ text: text.slice(start, i), start }); start = i + 1; }
  }
  parts.push({ text: text.slice(start), start });
  return parts;
}

/** 顶层第一个 `ch` 的偏移；没有返回 -1。 */
function firstTopLevel(text, ch) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

/** 对象字面量（`{` 在 `open` 处）的顶层键名。`...x` 单独报出来（调用方决定能否解析）。 */
function objectLiteralKeys(text, open) {
  const end = matchBrace(text, open);
  if (end < 0) return null;
  const keys = [];
  const spreads = [];
  for (const part of topLevelSplit(text.slice(open + 1, end), ',')) {
    const t = part.text.trim();
    if (!t) continue;
    if (t.startsWith('...')) { spreads.push(t.slice(3).trim()); continue; }
    const colon = firstTopLevel(t, ':');
    const key = (colon < 0 ? t : t.slice(0, colon)).trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) return { dynamic: '非标识符键：' + JSON.stringify(key.slice(0, 24)), keys, spreads };
    keys.push(key);
  }
  return { keys, spreads, end };
}

/**
 * 模板字面量里 `${ … }` 的**插值区间**（偏移对，取自身长文本）。
 *
 * 为什么需要单独一趟：中和文本把整个模板换成 `x`，于是**插值里的标识符也一起没了** ——
 * 而本仓真的把依赖键写在插值里（`upload.js` 的 `tokenFor` 只在
 * `` `${BASE}/media/${tokenFor(abs)}` `` 里出现）。不补这一趟，`tokenFor` 会被判成"解构了但没用"，
 * 或者（`c.x` 形态时）整个键从消费面里消失 ⇒ 少声明一键而判据假绿。
 * 方向是安全的：认不出模板时最多**少**找到几个插值（判据偏严/变红），不会凭空多出键。
 * @param {string} text `stripComments` 之后的文本（注释已空、字符串/模板内容保留）
 * @returns {Array<[number, number]>} 每个插值内部的 `[起, 止)` 偏移
 */
function templateInterpolationSpans(text) {
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '`') continue;
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') break;
      if (c === '$' && text[i + 1] === '{') {
        const start = i + 2;
        let depth = 0;
        let j = start;
        for (; j < text.length; j++) {
          if (text[j] === '{') depth++;
          else if (text[j] === '}') { if (depth === 0) break; depth--; }
        }
        spans.push([start, j]);
        i = j + 1;
        continue;
      }
      i++;
    }
  }
  return spans;
}

/** 文件里 `const NAME = { … }` 的本地对象（给"第二实参是标识符/展开"时解析用）。
 * 返回 `name → { keys, spreads }`：`spreads` 是字面量里的 `...X` 名（判断这层展开能不能在本文件里解掉）。 */
function localObjectLiterals(text) {
  const map = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (map.has(m[1])) continue;
    const parsed = objectLiteralKeys(text, m.index + m[0].length - 1);
    if (parsed && !parsed.dynamic) map.set(m[1], { keys: parsed.keys, spreads: parsed.spreads || [] });
  }
  return map;
}

// ── 消费面解析（路由模块）─────────────────────────────────────────────────────

/** 形参表里是否绑定了 `ctxName`（`c` / `c = {}` / `...c` / `{ … }` 之外的形态）。 */
function bindsCtx(params, ctxName) {
  if (!ctxName) return false;
  return topLevelSplit(params, ',').some((p) => {
    const t = p.text.trim().replace(/^\.\.\./, '');
    if (!t) return false;
    return t.split('=')[0].trim() === ctxName;
  });
}

/** 扫描所有"`(params)` 后面紧跟 `{` 或 `=>`"的函数/箭头节点（含嵌套，用于算遮蔽区间）。 */
function scanFunctionNodes(text) {
  const nodes = [];
  const re = /\(([^()]*)\)\s*(=>|\{)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const openParen = m.index;
    const params = m[1];
    const afterParen = openParen + 1 + params.length + 1;
    // 前导标识符（函数名 / 方法名）；控制关键字（if/for/while/catch/switch）不是函数节点。
    const head = text.slice(Math.max(0, openParen - 48), openParen);
    const idm = /([A-Za-z_$][\w$]*)\s*$/.exec(head);
    const word = idm ? idm[1] : '';
    if (CONTROL_KEYWORDS.has(word)) { re.lastIndex = afterParen; continue; }
    let p = afterParen;
    while (p < text.length && /[ \t]/.test(text[p])) p++;
    const arrow = text.startsWith('=>', p);
    if (!arrow && text[p] !== '{') { re.lastIndex = afterParen; continue; }
    let bodyStart;
    let bodyEnd;
    if (arrow) {
      bodyStart = p + 2;
      while (bodyStart < text.length && /[ \t]/.test(text[bodyStart])) bodyStart++;
      if (text[bodyStart] === '{') bodyEnd = matchBrace(text, bodyStart);
      else {
        // 表达式体：本仓这类箭头都是单行（`(c) => size += c.length`）⇒ 取到该行/该参数表边界为止。
        let e = text.indexOf('\n', bodyStart);
        if (e < 0) e = text.length - 1;
        bodyEnd = Math.min(e, ...[text.indexOf(';', bodyStart), text.indexOf(')', bodyStart), text.indexOf(',', bodyStart)]
          .filter((x) => x >= 0));
      }
    } else {
      bodyStart = p;
      bodyEnd = matchBrace(text, bodyStart);
    }
    if (bodyEnd < 0) { re.lastIndex = afterParen; continue; }
    nodes.push({ openParen, params, word, arrow, start: openParen, end: bodyEnd, indent: indentAt(text, openParen), line: lineOf(text, openParen) });
    re.lastIndex = afterParen;
  }
  return nodes;
}

/** `a: B` / `a = 1` / `a` → `[契约键, 本地名]`。 */
function splitKeyLocal(part) {
  const eq = firstTopLevel(part, '=');
  const head = (eq < 0 ? part : part.slice(0, eq)).trim();
  const colon = firstTopLevel(head, ':');
  if (colon < 0) return [head.trim(), ''];
  return [head.slice(0, colon).trim(), head.slice(colon + 1).trim()];
}

/** `export const NAME = [ … ];` 的条目（**读原文**：中和副本里字符串已变成 `x`）。 */
function parseDeclaredList(raw, name) {
  const m = new RegExp('export\\s+const\\s+' + name + '\\s*=\\s*\\[([^\\]]*)\\]\\s*;').exec(raw);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/**
 * 解析一个路由模块的注入契约。**全部走中和文本 + 偏移**，所以多行解构、`c.x` 成员访问、
 * 模块级 helper 传播、嵌套同名形参遮蔽都能在同一遍里判对。
 * @param {string} raw 源码
 * @param {string} rel 工作区相对路径（报错用）
 */
export function parseModuleContract(raw, rel) {
  // 两份等长文本，分工明确：
  //   · `text`（中和）—— 结构扫描用：花括号/圆括号/逗号只可能是语法括号，配平与切分才可靠。
  //   · `idText`（只剥注释）—— **标识符引用**判定用：字符串/模板内容保留，插值里的名字还在。
  //   两者与原文**等长** ⇒ 偏移可直接互换（行号也一直是对的）。
  const text = neutralize(raw);
  const idText = stripComments(String(raw));
  const fnM = /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/.exec(text);
  if (!fnM) return { rel, ok: false, reason: '没找到 `export function <名>(…) {`（本守卫只认这一种入口形态）' };
  const fnName = fnM[1];
  const registerOpenParen = fnM.index + fnM[0].indexOf('(');
  const registerEnd = matchBrace(text, fnM.index + fnM[0].length - 1);
  if (registerEnd < 0) return { rel, fnName, ok: false, reason: '注册函数的花括号不配对（源码被截断？）' };
  const params = topLevelSplit(fnM[2], ',').map((p) => p.text.trim()).filter(Boolean);
  const second = params.length > 1 ? params[1] : '';
  let ctxName = '';
  const signatureKeys = [];
  if (second.startsWith('{')) {
    for (const part of topLevelSplit(second.slice(1, second.lastIndexOf('}')), ',')) {
      const t = part.text.trim();
      if (!t || t.startsWith('...')) continue;
      const [key] = splitKeyLocal(t);
      if (key) signatureKeys.push(key);
    }
  } else {
    ctxName = second.split('=')[0].replace(/^\.\.\./, '').trim();
  }

  // 上下文绑定的两种来源：注册函数自己的形参、以及**把 ctx 当形参收进去**的函数/箭头。
  // 判定（三条，缺一条就会误判，见下面各自的实测理由）：
  //   · 模块作用域（缩进 0）：函数声明/常量箭头都算；命名的还要求"文件里有调用点"
  //     （死 helper 里的 `c.x` 不算契约）。
  //   · 调用点可以在**定义之前**（函数声明有提升：`presets.js` 在注册函数体里调
  //     `writePreset(c, …)` / `installAssets(c, …)`，两者的 `function` 声明在文件后半段）
  //     ⇒ 引用扫描必须在**整个文件**上做，且把节点自身的那次 `NAME(` 排除掉。
  //   · 嵌套但**被显式喂进 ctx**（`NAME(c, …)`）的命名函数也算消费者 —— 否则它会退化成
  //     "遮蔽"，把 `installAssets` 里消费的 `c.mascotDir()` 整批漏掉。
  const nodes = scanFunctionNodes(text);
  const shadow = [];
  const helpers = [];
  for (const n of nodes) {
    if (n.openParen === registerOpenParen) continue;
    if (!bindsCtx(n.params, ctxName)) continue;
    const named = Boolean(n.word) && /^[A-Za-z_$][\w$]*$/.test(n.word) && n.word !== 'function';
    let referenced = false;
    if (named) {
      const callRe = new RegExp('(^|[^.\\w$])' + n.word + '\\s*\\(', 'g');
      let hit;
      while ((hit = callRe.exec(text)) !== null) {
        if (hit.index < n.start || hit.index > n.end) { referenced = true; break; }
      }
    }
    const fedCtx = named && new RegExp('(^|[^.\\w$])' + n.word + '\\s*\\(\\s*' + ctxName + '\\b').test(text);
    if ((n.indent === 0 && (!named || referenced)) || fedCtx) helpers.push(n);
    else shadow.push(n);
  }
  const inShadow = (idx) => shadow.some((s) => idx >= s.start && idx <= s.end);

  // ① 解构面（含多行、重命名、默认值）；② `c.x` 成员访问面。两者都跳过遮蔽区间。
  const destructured = [];
  const consumed = new Map();
  const addKey = (key, via) => { const cur = consumed.get(key) || {}; cur[via] = true; consumed.set(key, cur); };
  for (const key of signatureKeys) addKey(key, 'signature');
  if (ctxName) {
    const dsRe = new RegExp('\\b(?:const|let|var)\\s*\\{([^{}]*)\\}\\s*=\\s*' + ctxName + '\\b', 'g');
    let m;
    while ((m = dsRe.exec(text)) !== null) {
      if (inShadow(m.index)) continue;
      for (const part of topLevelSplit(m[1], ',')) {
        const t = part.text.trim();
        if (!t || t.startsWith('...')) continue;
        const [key, local] = splitKeyLocal(t);
        if (!key) continue;
        addKey(key, 'destructured');
        destructured.push({ key, local: local || key, after: m.index + m[0].length });
      }
    }
    const useRe = new RegExp('\\b' + ctxName + '\\.([A-Za-z_$][\\w$]*)', 'g');
    while ((m = useRe.exec(text)) !== null) {
      if (text[m.index - 1] === '.') continue; // `foo.c.x`：`c` 是别人的字段
      if (inShadow(m.index)) continue;
      addKey(m[1], 'member');
    }
    // 模板插值里的 `c.x`（中和文本看不见）—— 只扫插值区间，避免把**字符串里**的 `c.x` 当引用。
    for (const [s, e] of templateInterpolationSpans(idText)) {
      const chunk = idText.slice(s, e);
      for (const hit of chunk.matchAll(new RegExp('\\b' + ctxName + '\\.([A-Za-z_$][\\w$]*)', 'g'))) {
        const abs = s + hit.index;
        if (idText[abs - 1] === '.') continue;
        if (inShadow(abs)) continue;
        addKey(hit[1], 'member');
      }
    }
  }
  // 解构了却没用 = 死解构（与 verify-route-index ④ 同口径，这里顺带钉住）。
  // ⚠️ 必须在 `idText` 上找引用：`${BASE}` 这类插值在中和文本里已变成 `x`，拿它判会把
  //    `base: BASE` 整批误报成死解构（实测过，21 个族里 21 个都假红）。
  const unusedLocal = destructured
    .filter((d) => !new RegExp('(^|[^.\\w$])' + d.local + '\\b').test(idText.slice(d.after)))
    .map((d) => d.key);

  return {
    rel, ok: true, fnName, ctxName, text, registerEnd,
    consumed, destructured, unusedLocal,
    deps: parseDeclaredList(raw, 'DEPS'),
    optionalDeps: parseDeclaredList(raw, 'OPTIONAL_DEPS'),
    helpers: helpers.map((h) => h.word || '(箭头)'),
    shadowCount: shadow.length,
  };
}

// ── 调用点解析（门面 / 组件行入口）─────────────────────────────────────────────

/**
 * 一个"行"模块（MAIN_MODULES）里的 `NAME(webServer, <第二实参>)` 调用点。
 * 只认**这一种语句形态**（行首即函数名）—— 与 `host-route-index` 的调用点正则同源；带赋值前缀
 * 的写法会让本守卫与路由索引一起把整族判成孤儿。
 *
 * spreadTable（可选，子包行入口用）= { names: Set<绑定名>, keys: string[] }：把
 * ...subpackageKeys('<id>')（旧形态）或 ...host.keys('<id>', ctx)（服务面形态，§5.1 ①）的运行期
 * 展开在**静态**面上补成叶子冻结表（叶子表是子包入口声明面的唯一真源）。不给这项就沿用旧口径：
 * 展开名解析不到本文件里的对象字面量 ⇒ site.dynamic 判红。
 */
export function parseCallSitesText(raw, rel, knownFns, spreadTable = null) {
  const text = neutralize(raw);
  const locals = localObjectLiterals(text);
  const sites = [];
  const re = /(^|\n)[ \t]*([A-Za-z_$][\w$]*)\s*\(\s*webServer\s*,/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const fn = m[2];
    if (!knownFns.has(fn)) continue;
    const line = lineOf(text, m.index + m[1].length);
    let p = re.lastIndex;
    while (p < text.length && /\s/.test(text[p])) p++;
    const site = { rel, line, fn, keys: [], spreads: [], dynamic: null, raw: '' };
    if (text[p] === '{') {
      const parsed = objectLiteralKeys(text, p);
      if (!parsed) site.dynamic = '第二实参对象字面量的花括号不配对';
      else if (parsed.dynamic) site.dynamic = parsed.dynamic;
      else {
        site.keys = parsed.keys.slice();
        for (const sp of parsed.spreads) {
          site.spreads.push(sp);
          const local = locals.get(sp);
          if (local) site.keys.push(...local.keys);
          else if (spreadTable && spreadTable.names.has(sp)) site.keys.push(...spreadTable.keys);
          else site.dynamic = '展开 `...' + sp + '` 解析不到本文件里的对象字面量（子包入口还认了叶子表绑定）';
        }
      }
    } else if (/[A-Za-z_$]/.test(text[p] || '')) {
      const idm = /^[A-Za-z_$][\w$]*/.exec(text.slice(p));
      const id = idm ? idm[0] : '';
      const local = locals.get(id);
      if (local) {
        site.keys = local.keys.slice();
        for (const sp of local.spreads) {
          site.spreads.push(sp);
          const nested = locals.get(sp);
          if (nested) site.keys.push(...nested.keys);
          else if (spreadTable && spreadTable.names.has(sp)) site.keys.push(...spreadTable.keys);
          else site.dynamic = '展开 `...' + sp + '` 解析不到本文件里的对象字面量';
        }
      } else if (spreadTable && spreadTable.names.has(id)) {
        site.keys = spreadTable.keys.slice();
      } else {
        site.dynamic = '第二实参是标识符 `' + id + '`，本文件里找不到它的对象字面量';
      }
    } else {
      site.dynamic = '第二实参不是对象字面量也不是本地对象（形如 `' + text.slice(p, p + 12).trim() + '`）';
    }
    sites.push(site);
    re.lastIndex = p;
  }
  return sites;
}

// ── 对账 ──────────────────────────────────────────────────────────────────────

/**
 * 面差集：`theirs` 里**不在** `ours` 里的成员（空 = 覆盖完整）。
 * 生产扫描（本守卫 vs 独立索引）与两条负对照调**同一份**，取代原先的写死地板数。
 */
function missingFrom(ours, theirs) {
  const have = new Set(ours);
  return [...new Set(theirs)].filter((x) => !have.has(x));
}

/** ① 声明面 ↔ 本模块的消费面。返回结构化问题清单（空 = 对账通过）。 */
export function reconcileModule(mod) {
  const issue = (kind, text, key = null) => ({ kind, text, key });
  if (!mod.ok) return [issue('unparsable', mod.reason)];
  const issues = [];
  const deps = mod.deps;
  const optional = mod.optionalDeps || [];
  if (deps === null) issues.push(issue('no-deps', '缺少 `export const DEPS = [ … ];` 声明面（本族没有可对账的键集）'));
  const required = deps || [];
  const dupes = required.filter((k, i) => required.indexOf(k) !== i);
  if (dupes.length) issues.push(issue('duplicate-key', 'DEPS 里有重复键：' + [...new Set(dupes)].join(' ')));
  const overlap = required.filter((k) => optional.includes(k));
  if (overlap.length) issues.push(issue('optional-overlap', 'DEPS 与 OPTIONAL_DEPS 重叠：' + [...new Set(overlap)].join(' ')));
  const declared = new Set([...required, ...optional]);
  for (const k of mod.consumed.keys()) {
    if (!declared.has(k)) issues.push(issue('consumed-not-declared', '消费了但没声明：' + k, k));
  }
  for (const k of declared) {
    if (!mod.consumed.has(k)) issues.push(issue('declared-not-consumed', '声明了但没消费：' + k, k));
  }
  for (const k of mod.unusedLocal) issues.push(issue('dead-destructure', '解构了但没用：' + k, k));
  return issues;
}

/** ② 声明面 ↔ 调用点实参键（两个方向都要）。 */
export function reconcileCallSite(site, mod) {
  const issue = (kind, text, key = null) => ({ kind, text, key });
  if (site.dynamic) return [issue('dynamic-arg', '第二实参无法机械解析（' + site.dynamic + '）⇒ 声明面与调用点不可对账')];
  if (!mod || !mod.ok) return [issue('unknown-family', '调用点解析不到路由族模块（名字拼错 / 不是路由族模块的 register 函数？）')];
  if (mod.deps === null) return [issue('no-deps', '该族没有 DEPS 声明面 ⇒ 调用点无处对账')];
  const given = new Set(site.keys);
  const allowed = new Set([...mod.deps, ...(mod.optionalDeps || [])]);
  const issues = [];
  for (const k of mod.deps) {
    if (!given.has(k)) issues.push(issue('declared-not-given', '调用点没给：' + k, k));
  }
  for (const k of given) {
    if (!allowed.has(k)) issues.push(issue('given-not-declared', '调用点多给：' + k, k));
  }
  return issues;
}

// ── 子包行入口（packages/<pkg>/<main>）：叶子冻结表 = 声明面唯一真源 ────────────
// 子包入口的 c 是运行期键表展开：旧形态 { ...subpackageKeys('<id>'), disposers, cachePath }，
// 重构后（§5.1 ①）是 const host = ctx.<服务名>; const keys = host.keys('<id>', ctx);
// { ...keys, disposers, schema: host.schema, http: host.http } —— 两种形态静态扫描都看不见那些键。
// ⇒ 判据把叶子的 subpackageKeyNames(id) 读进来当给定面（不然要么判 dynamic 恒红，要么把共享 c
// 误判成"少给 N 键"）。绑定形态由 tableBindingNames() 同一处认（真动态对象仍然判红）。

/** 根包名（子包行的行名 = `<根包名>-<id>`，子包入口判定的数据来源）。 */
const ROOT_NAME = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name || ''; } catch { return ''; }
})();

/** `packages/<dir>/…` 的入口相对路径 → 子包 id（对账该包的 `name`）；不是子包入口则 null。 */
export function subpackageEntryId(rel) {
  const m = /^packages\/([^/]+)\//.exec(rel);
  if (!m || !ROOT_NAME) return null;
  let name;
  try { name = JSON.parse(readFileSync(join(ROOT, 'packages', m[1], 'package.json'), 'utf8')).name; } catch { return null; }
  const prefix = ROOT_NAME + '-';
  return typeof name === 'string' && name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : null;
}

/**
 * 入口文本里"冻结键表"的绑定名（两种形态都认）：
 *   · 旧叶子形态：const NAME = subpackageKeys('<id>'[, ctx]) / subpackageKeyNames('<id>')
 *   · 服务面形态（§5.1 ① 重构后的真实写法）：const NAME = <host>.keys('<id>'[, ctx]) /
 *     <host>.keyNames('<id>')，其中 <host> **必须**是本文件里从 ctx.<服务名> 取到的绑定
 *     （形如 const host = ctx.wallpaperEngineHost）。
 * 服务名本身不进正则（它是 lib/subpackage-boot.js 的 HOST_SERVICE_NAME，只该有一处真源）；
 * 但"接收者必须源自 ctx.<某个键>"这条不能省 —— 否则任何 X.keys('fonts') 都会被当成冻结表，
 * "认表"就退化成"看见 .keys 就放行"（负对照 nc-sub7）。
 */
export function tableBindingNames(raw, id) {
  const text = stripComments(String(raw));
  const names = new Set();
  let m;
  // 形态 a：旧叶子（subpackageKeys / subpackageKeyNames）
  const leafRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:subpackageKeys|subpackageKeyNames)\s*\(\s*['"]([^'"]*)['"][^)]*\)/g;
  while ((m = leafRe.exec(text)) !== null) if (m[2] === id) names.add(m[1]);
  // 形态 b：服务面（<host>.keys / <host>.keyNames），但 <host> 必须源自本文件里的 ctx.<服务名>：
  // 没有这条约束就退化成"看见 .keys 就放行"（nc-sub7 钉住）。
  const fromCtx = new Set();
  const recvRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*ctx\s*\.\s*[A-Za-z_$][\w$]*/g;
  while ((m = recvRe.exec(text)) !== null) fromCtx.add(m[1]);
  const svcRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*(?:keys|keyNames)\s*\(\s*['"]([^'"]*)['"][^)]*\)/g;
  while ((m = svcRe.exec(text)) !== null) if (m[3] === id && fromCtx.has(m[2])) names.add(m[1]);
  return names;
}

/**
 * 叶子冻结表（`lib/subpackage-boot.js` 的 `subpackageKeyNames()`）—— 子包入口声明面的唯一真源。
 * 读不到 / 表为空都是红：空表会让子包入口的"逐键对账"退化成空对空（R-5 的空转形态）。
 */
async function loadLeafKeyNames() {
  const rel = 'lib/subpackage-boot.js';
  if (!existsSync(join(ROOT, rel))) return { error: rel + ' 不存在（子包入口声明面无真源）', tables: new Map() };
  let mod;
  try { mod = await import(pathToFileURL(join(ROOT, rel)).href); }
  catch (error) { return { error: rel + ' 装载失败：' + (error && error.message), tables: new Map() }; }
  if (typeof mod.subpackageKeyNames !== 'function' || typeof mod.subpackageIds !== 'function') {
    return { error: rel + ' 没有具名导出 subpackageKeyNames()/subpackageIds()（声明面无真源）', tables: new Map() };
  }
  const tables = new Map();
  for (const id of mod.subpackageIds()) {
    try { tables.set(id, [...mod.subpackageKeyNames(id)]); } catch { tables.set(id, null); }
  }
  return { error: null, tables };
}

/** 子包入口的调用点给定键 = 叶子冻结表 ∪ 该实参里显式写出的键。 */
export function subpackageGivenKeys(table, site) {
  return [...new Set([...(table || []), ...((site && site.keys) || [])])];
}

/**
 * 子包入口的调用点对账（② 的子包口径）：**只判"没给"**。
 * `c` 是整包共享的键集（叶子表 + 本文件自带键），逐族判"多给"在这里没有意义（另一族要的键当然
 * 也在共享 c 上）——"多给"改由 `reconcileSubpackageEntry()` 按**整包**判。
 */
export function reconcileSubpackageCallSite(site, mod, table) {
  const issue = (kind, text, key = null) => ({ kind, text, key });
  if (site.dynamic) return [issue('dynamic-arg', '第二实参无法机械解析（' + site.dynamic + '）⇒ 声明面与调用点不可对账')];
  if (!mod || !mod.ok) return [issue('unknown-family', '调用点解析不到路由族模块（名字拼错 / 不是路由族模块的 register 函数？）')];
  if (mod.deps === null) return [issue('no-deps', '该族没有 DEPS 声明面 ⇒ 调用点无处对账')];
  const given = new Set(subpackageGivenKeys(table, site));
  const issues = [];
  for (const k of mod.deps) if (!given.has(k)) issues.push(issue('declared-not-given', '调用点没给：' + k, k));
  return issues;
}

/**
 * 子包入口的**整包**对账：入口显式给的键（叶子表以外的：`disposers` / `cachePath` 这类）必须被本包
 * 某个族的声明面认领（DEPS ∪ OPTIONAL_DEPS）。共享 c 上的"多给"只有在这一层才有意义 —— 塞一个
 * 没有任何族认识的键 = 契约漂移（负对照 nc-sub3）。
 */
export function reconcileSubpackageEntry(entry) {
  const issues = [];
  const families = entry.families || [];
  const declaredAny = new Set(families.flatMap((f) => [...(f.deps || []), ...(f.optionalDeps || [])]));
  for (const k of entry.explicit || []) {
    if (!declaredAny.has(k)) issues.push({ kind: 'given-not-declared', text: '子包入口给了没有任何族声明的键：' + k, key: k });
  }
  return issues;
}

// ── 读盘 ──────────────────────────────────────────────────────────────────────
// 路由族文件面（`lib/routes/*.js` ∪ 组件目录直接子文件）走 `host-route-index.mjs` 的**同一份**
// 枚举真源 —— P2-8 把四个族搬进组件目录后，这里若还只扫 `lib/routes/`，判据会**静默失去覆盖**
// （地板 `modules.length >= 21` 就是为这件事留的哨兵）。

// ── 负对照（全部走上面同一份判据）─────────────────────────────────────────────

function selftest(ok) {
  const ok2 = (name, cond, detail) => ok(name, cond, detail);
  const mod = (body, deps, optional) => [
    'export const DEPS = [' + (deps || []).map((k) => "'" + k + "'").join(', ') + '];',
    optional ? 'export const OPTIONAL_DEPS = [' + optional.map((k) => "'" + k + "'").join(', ') + '];' : '',
    'export function registerProbeRoutes(webServer, c) {',
    body,
    '}',
  ].filter(Boolean).join('\n');

  // nc1：消费了但没声明 ⇒ 红
  const nc1 = parseModuleContract(mod("  const { disposers, base } = c;\n  void disposers; void base;", ['disposers']), 'probe.js');
  ok2('nc1 少声明一个消费键必须红', reconcileModule(nc1).some((s) => s.kind === 'consumed-not-declared' && s.key === 'base'));

  // nc2：声明了但没消费 ⇒ 红
  const nc2 = parseModuleContract(mod("  const { disposers } = c;\n  void disposers;", ['disposers', 'base']), 'probe.js');
  ok2('nc2 多声明一个没消费的键必须红', reconcileModule(nc2).some((s) => s.kind === 'declared-not-consumed' && s.key === 'base'));

  // nc3 / nc4：调用点的两个方向
  const good = parseModuleContract(mod("  const { disposers, base } = c;\n  void disposers; void base;", ['disposers', 'base']), 'probe.js');
  const site = (keys) => ({ rel: 'probe-host.js', line: 1, fn: 'registerProbeRoutes', keys, dynamic: null });
  ok2('nc3 调用点少给一个必需键必须红', reconcileCallSite(site(['disposers']), good).some((s) => s.kind === 'declared-not-given' && s.key === 'base'));
  ok2('nc4 调用点多给一个没声明的键必须红', reconcileCallSite(site(['disposers', 'base', 'nope']), good).some((s) => s.kind === 'given-not-declared' && s.key === 'nope'));
  ok2('nc3/nc4 的对偶：两个方向都齐 ⇒ 无问题', reconcileCallSite(site(['disposers', 'base']), good).length === 0);

  // nc5：嵌套同名形参（Buffer）不得混进契约（实测形态：`req.on('data', (c) => size += c.length)`）
  const nc5 = parseModuleContract(mod([
    '  const { disposers, base } = c;',
    '  void disposers; void base;',
    "  webServer.register({ kind: 'exact', path: base, handler: (req, res) => {",
    "    let size = 0;",
    "    req.on('data', (c) => { size += c.length; res.end(String(size)); });",
    '  } });',
  ].join('\n'), ['disposers', 'base']), 'probe.js');
  ok2('nc5 嵌套同名形参的成员访问不得混进契约', !nc5.consumed.has('length') && reconcileModule(nc5).length === 0,
    '消费面=[' + [...nc5.consumed.keys()].join(',') + ']');

  // nc6：ctx 被传进**模块级 helper** ⇒ 那里的成员访问必须算契约（fontsets/presets 的形态）
  const nc6 = parseModuleContract([
    "export const DEPS = ['disposers', 'base', 'fontSetsDir'];",
    "function userDir(c) { return c.fontSetsDir(); }",
    'export function registerProbeRoutes(webServer, c) {',
    '  const { disposers, base } = c;',
    '  void disposers; void base; void userDir(c);',
    '}',
  ].join('\n'), 'probe.js');
  ok2('nc6 模块级 helper 消费的键必须被看见（否则会漏键）', nc6.consumed.has('fontSetsDir') && reconcileModule(nc6).length === 0,
    '消费面=[' + [...nc6.consumed.keys()].join(',') + ']');

  // nc7：多行解构 + 重命名（`base: BASE`）必须解析出**契约键 base**，而不是本地名 BASE
  const nc7 = parseModuleContract(mod([
    '  const {',
    '    disposers, base: BASE, mediaMap,',
    '    serveFile, log,',
    '  } = c;',
    '  void disposers; void BASE; void mediaMap; void serveFile; void log;',
  ].join('\n'), ['disposers', 'base', 'mediaMap', 'serveFile', 'log']), 'probe.js');
  ok2('nc7 多行解构 + 重命名都按契约键算', reconcileModule(nc7).length === 0 && nc7.consumed.has('base') && !nc7.consumed.has('BASE'),
    '消费面=[' + [...nc7.consumed.keys()].join(',') + ']');

  // 反空转：正控 —— 上面那些"应当绿"的形态真的绿了（否则上面的红可能是解析失败造成的假红）
  ok2('正控：完整声明的合规模块不得报问题', reconcileModule(good).length === 0);
  ok2('正控：没找到入口函数的模块必须报解析失败（不许静默放行）',
    reconcileModule(parseModuleContract('const x = 1;', 'probe.js')).some((s) => s.kind === 'unparsable'));

  // nc8：只在**模板插值**里出现的键必须被看见（实测形态：upload.js 的 `tokenFor` 只出现在
  //      `` `${BASE}/media/${tokenFor(abs)}` `` 里）。中和文本会把整段模板换成 `x` ⇒ 少了这一趟，
  //      该键会从消费面消失（少声明一键而判据假绿）。
  const nc8 = parseModuleContract([
    "export const DEPS = ['disposers', 'base', 'tokenFor'];",
    'export function registerProbeRoutes(webServer, c) {',
    '  const { disposers, base: BASE, tokenFor } = c;',
    '  void disposers;',
    '  const url = `${BASE}/media/${tokenFor(1)}`;',
    '  void url;',
    '}',
  ].join('\n'), 'probe.js');
  ok2('nc8 只在模板插值里出现的键必须算消费（否则会漏键）',
    nc8.consumed.has('tokenFor') && reconcileModule(nc8).length === 0 && nc8.unusedLocal.length === 0,
    '消费面=[' + [...nc8.consumed.keys()].join(',') + '] 死解构=[' + nc8.unusedLocal.join(',') + ']');

  // ── 子包行入口（packages/<pkg>/）：叶子冻结表 = 声明面唯一真源 ─────────────────
  // nc-sub1 / nc-sub2：`c = { ...subpackageKeys('probe'), disposers }` 的静态展开面必须是叶子表的
  // 逐字复制；表里少一键（或调用点多给）都会让声明面对账失真。
  const subSite = (keys, dynamic) => ({ rel: 'packages/probe/lib/index.js', line: 1, fn: 'registerProbeRoutes', keys, dynamic: dynamic || null });
  ok2('nc-sub1 子包入口：叶子表里少一个族要求的键必须红',
    reconcileSubpackageCallSite(subSite(['disposers']), good, ['disposers']).some((s) => s.kind === 'declared-not-given' && s.key === 'base'));
  ok2('nc-sub2 正控：叶子表 ∪ 调用点显式键覆盖声明面 ⇒ 子包入口调用点无问题',
    reconcileSubpackageCallSite(subSite(['disposers']), good, ['disposers', 'base']).length === 0);

  // nc-sub3 / nc-sub4：共享 c 上的"多给"只在**整包**层判 —— 入口显式键必须被某族认领。
  const subEntry = (explicit, table, deps, optional) => ({
    rel: 'packages/probe/lib/index.js', id: 'probe', table,
    explicit,
    families: [{ rel: 'probe.js', fn: 'registerProbeRoutes', deps, optionalDeps: optional || [] }],
  });
  ok2('nc-sub3 子包入口显式多给一个没有族声明的键必须红',
    reconcileSubpackageEntry(subEntry(['disposers', 'phantom'], ['base'], ['base'], ['disposers']))
      .some((s) => s.kind === 'given-not-declared' && s.key === 'phantom'));
  ok2('nc-sub4 正控：入口显式键被族声明（DEPS / OPTIONAL_DEPS 皆可）⇒ 整包对账无问题',
    reconcileSubpackageEntry(subEntry(['disposers'], ['base'], ['base'], ['disposers'])).length === 0);

  // nc-sub5：`...subpackageKeys(id)` 只有在**认得叶子表绑定**时才展开；不给表仍判 dynamic（原有牙没丢）
  const subRaw = [
    "import { subpackageKeys } from 'dsh-plugin-wallpaper-engine/subpackage-boot.js';",
    "const keys = subpackageKeys('probe');",
    "export const DEPS = ['base'];",
    'export function registerProbeRoutes(webServer, c) {',
    '  void c;',
    '}',
    'registerProbeRoutes(webServer, { ...keys, disposers });',
  ].join('\n');
  const withTable = parseCallSitesText(subRaw, 'packages/probe/lib/index.js', new Set(['registerProbeRoutes']), { names: tableBindingNames(subRaw, 'probe'), keys: ['base'] });
  const withoutTable = parseCallSitesText(subRaw, 'packages/probe/lib/index.js', new Set(['registerProbeRoutes']));
  ok2('nc-sub5 `...subpackageKeys(id)` 认表时展开成表键、不认表时仍判 dynamic',
    withTable.length === 1 && !withTable[0].dynamic && withTable[0].keys.includes('base') && withTable[0].keys.includes('disposers')
    && withoutTable.length === 1 && Boolean(withoutTable[0].dynamic),
    '认得表=[' + (withTable[0] ? withTable[0].keys.join(',') : '无') + '] 不认得表=' + (withoutTable[0] && withoutTable[0].dynamic ? 'dynamic' : '未判红'));

  // nc-sub6：**服务面形态**（§5.1 ① 重构后的真实写法）必须同样被认成冻结表绑定。
  const svcRaw = [
    'const host = ctx.wallpaperEngineHost;',
    "const keys = host.keys('probe', ctx);",
    'export const DEPS = [];',
    'export function registerProbeRoutes(webServer, c) {',
    '  void c;',
    '}',
    'registerProbeRoutes(webServer, { ...keys, disposers });',
  ].join('\n');
  const svcSites = parseCallSitesText(svcRaw, 'packages/probe/lib/index.js', new Set(['registerProbeRoutes']),
    { names: tableBindingNames(svcRaw, 'probe'), keys: ['base'] });
  ok2('nc-sub6 服务面形态（const host = ctx.<服务名>; host.keys(id, ctx)）也被认成冻结表绑定',
    svcSites.length === 1 && !svcSites[0].dynamic && svcSites[0].keys.includes('base') && svcSites[0].keys.includes('disposers'),
    '认得表=[' + (svcSites[0] ? svcSites[0].keys.join(',') : '无') + ']');

  // nc-sub7：接收者**不是**从 ctx 取来的 X.keys(id) 不许被认（"看见 .keys 就放行" = 判据没牙）。
  const alienRaw = [
    'const other = something;',
    "const keys = other.keys('probe');",
    'export const DEPS = [];',
    'export function registerProbeRoutes(webServer, c) { void c; }',
    'registerProbeRoutes(webServer, { ...keys, disposers });',
  ].join('\n');
  const alienSite = parseCallSitesText(alienRaw, 'packages/probe/lib/index.js', new Set(['registerProbeRoutes']),
    { names: tableBindingNames(alienRaw, 'probe'), keys: ['base'] })[0];
  ok2('nc-sub7 负对照：接收者不源自 ctx.<服务名> 的 X.keys(id) 不被认成冻结表（仍判 dynamic）',
    tableBindingNames(alienRaw, 'probe').size === 0 && Boolean(alienSite && alienSite.dynamic),
    '绑定=' + [...tableBindingNames(alienRaw, 'probe')].join(',') + ' 站点=' + (alienSite && alienSite.dynamic ? 'dynamic' : '未判红'));
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  const dump = process.argv.includes('--dump');
  let failed = 0;
  const check = (name, cond, detail) => {
    if (cond) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
    return cond;
  };

  console.log('\n① 路由族的声明面 ↔ 消费面（每个路由族模块：`lib/routes/*.js` ∪ 组件目录直接子文件）');
  const modules = routeModuleFiles().map((rel) => parseModuleContract(readFileSync(join(ROOT, rel), 'utf8'), rel));
  const byFn = new Map(modules.filter((m) => m.ok).map((m) => [m.fnName, m]));
  const moduleIssues = [];
  for (const m of modules) {
    const issues = reconcileModule(m);
    if (issues.length) moduleIssues.push([m, issues]);
  }
  // 覆盖面：**对账独立索引**（`buildIndex()` 走另一套解析路径枚举同一批文件与函数），
  // 而不是写死 ≥21 个模块 / ≥21 个声明面 / ≥40 个声明键这种会随实现漂的快照地板
  // （原地板的两头都错：上游加一族 ⇒ 无判别力的绿；上游合并掉一族 ⇒ 无判别力的红）。
  const declaredKeys = modules.reduce((n, m) => n + (m.deps ? m.deps.length : 0), 0);
  const withDecl = modules.filter((m) => Array.isArray(m.deps)).length;
  const built = buildIndex();
  const builtFns = built.modules.map((m) => m.fnName);
  const ourFns = [...byFn.keys()];
  check('覆盖面：本守卫解析出的路由模块面 / 函数面 == 独立索引 `buildIndex()` 的面（两个解析器不许互相矛盾）',
    modules.length > 0 && built.modules.length === modules.length
    && missingFrom(ourFns, builtFns).length === 0 && missingFrom(builtFns, ourFns).length === 0,
    '本守卫 ' + modules.length + ' 模块 / ' + ourFns.length + ' 族 · 独立索引 ' + built.modules.length + ' 模块 / ' + builtFns.length + ' 族'
      + (missingFrom(ourFns, builtFns).length ? ' · 本守卫漏了 ' + missingFrom(ourFns, builtFns).join(' ') : '')
      + (missingFrom(builtFns, ourFns).length ? ' · 本守卫多了 ' + missingFrom(builtFns, ourFns).join(' ') : ''));
  check('覆盖面：每个族都有 DEPS 声明面、且每族至少声明 1 个键（空声明面 / 空数组 = 不可对账）',
    modules.length > 0 && withDecl === modules.length && declaredKeys >= modules.length,
    `模块 ${modules.length} · 有声明 ${withDecl} · 声明键 ${declaredKeys}（≥ 族数 ${modules.length}）`);
  // 负对照（同一条 missingFrom）：合成面里少一个成员 / 多一个成员都必须被判出。
  check('negative control：面差集判据两个方向都有牙（漏成员 / 多成员各一条）',
    missingFrom(['a'], ['a', 'b']).join() === 'b' && missingFrom(['a', 'b'], ['a']).length === 0
    && missingFrom(['a', 'c'], ['a']).length === 0 && missingFrom(['a'], ['a', 'c']).length === 1);
  check('解析面：每个模块都解析出了非空消费面（否则"逐键相等"会退化成空对空）',
    modules.every((m) => m.ok && m.consumed.size > 0),
    modules.filter((m) => !(m.ok && m.consumed.size > 0)).map((m) => m.rel).join(' ') || '每个模块都有非空消费面');
  // 与另一个独立解析器（host-route-index 的 `c` 字段）交叉对账：它的字段必须被本守卫看见。
  const disagree = [];
  for (const m of modules) {
    if (!m.ok) continue;
    const host = parseRouteModuleText(readFileSync(join(ROOT, m.rel), 'utf8'), m.rel, m.fnName);
    for (const f of host.fields) if (!m.consumed.has(f.field)) disagree.push(m.rel + ':' + f.field);
  }
  check('一致性：host-route-index 解析出的 `c` 字段必须都在本守卫的消费面里（两个解析器不许互相矛盾）',
    disagree.length === 0 && modules.some((m) => m.helpers.length),
    disagree.join(' ') || '全部一致');
  for (const [m, issues] of moduleIssues) console.log('  ✗ ' + m.rel + '（' + m.fnName + '）: ' + issues.map((i) => i.text).join('；'));
  check('① 每个族的声明面与消费面逐键相等（少声明 / 多声明 / 死解构都算红）', moduleIssues.length === 0,
    moduleIssues.length ? moduleIssues.length + ' 个族不一致' : modules.length + ' 个族逐键相等');

  console.log('\n② 声明面 ↔ 调用点实参键（门面 + 出户组件行入口 + 子包行入口，数据驱动）');
  const knownFns = new Set(byFn.keys());
  // 子包行入口的声明面**唯一真源** = 叶子冻结表（subpackageKeyNames(id)）：静态扫描看不见
  // { ...subpackageKeys('fonts'), disposers }（旧形态）或
  // const keys = host.keys('fonts', ctx); { ...keys, disposers }（服务面形态）的运行期展开，
  // 必须把表读进来当给定面 —— 两种绑定形态由 tableBindingNames() 同一处认。
  const leaf = await loadLeafKeyNames();
  const sites = [];
  const siteIssues = [];
  const entryReports = [];
  for (const rel of MAIN_MODULES) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    const id = subpackageEntryId(rel);
    const table = id ? (leaf.tables.get(id) || null) : null;
    const bindings = id ? tableBindingNames(raw, id) : new Set();
    const spreadTable = id && table ? { names: bindings, keys: table } : null;
    const rowSites = parseCallSitesText(raw, rel, knownFns, spreadTable);
    sites.push(...rowSites);
    for (const s of rowSites) {
      const issues = id ? reconcileSubpackageCallSite(s, byFn.get(s.fn), table) : reconcileCallSite(s, byFn.get(s.fn));
      if (issues.length) siteIssues.push([s, issues]);
    }
    if (!id) continue;
    const tableSet = new Set(table || []);
    const explicit = [...new Set(rowSites.flatMap((s) => s.keys))].filter((k) => !tableSet.has(k));
    const families = [...new Set(rowSites.map((s) => s.fn))].map((fn) => byFn.get(fn)).filter(Boolean);
    const problems = rowSites.length
      ? reconcileSubpackageEntry({
        rel, id, table: table || [], explicit,
        families: families.map((f) => ({ rel: f.rel, fn: f.fnName, deps: f.deps || [], optionalDeps: f.optionalDeps || [] })),
      })
      : [];
    entryReports.push({ rel, id, explicit, fns: families.map((f) => f.fnName), tableKeys: (table || []).length, problems });
  }
  const subpackageRels = MAIN_MODULES.filter((rel) => subpackageEntryId(rel) !== null);
  const unreadable = subpackageRels.filter((rel) => !leaf.tables.get(subpackageEntryId(rel)));
  check('② 子包行入口的声明面真源 = 叶子 `subpackageKeyNames(id)`（读不到 / 空表 = 红，不许退化成空对空）',
    leaf.error === null && subpackageRels.length > 0 && unreadable.length === 0,
    leaf.error || (subpackageRels.length + ' 个子包行入口 · 冻结表 ' + [...leaf.tables.keys()].join(' / ')
      + (unreadable.length ? ' · 取不到冻结表：' + unreadable.join(' ') : '')));
  const subpackageDynamic = sites.filter((s) => subpackageEntryId(s.rel) !== null && s.dynamic);
  check('② 子包入口的 ...subpackageKeys(id) / ...host.keys(id, ctx) 展开必须被认出来（认不出 = 整包调用点不可对账）',
    entryReports.length === subpackageRels.length && subpackageDynamic.length === 0,
    '子包入口 ' + entryReports.map((e) => e.id + ':' + e.tableKeys + ' 键 / ' + e.fns.length + ' 族').join(' · ')
      + (subpackageDynamic.length ? ' · 判 dynamic：' + subpackageDynamic.map((s) => s.rel + ':' + s.line).join(' ') : ''));
  const entryProblemRows = entryReports.filter((e) => e.problems.length);
  for (const e of entryProblemRows) console.log('  ✗ ' + e.rel + '（' + e.id + '）: ' + e.problems.map((p) => p.text).join('；'));
  check('② 子包入口共享 c 面：显式给的键（叶子表以外）必须被本包某个族声明（DEPS ∪ OPTIONAL_DEPS）',
    entryProblemRows.length === 0,
    entryProblemRows.length ? entryProblemRows.length + ' 个子包入口有问题' : entryReports.length + ' 个子包入口的显式键都被族认领');
  const calledFns = new Set(sites.map((s) => s.fn));
  const orphans = [...byFn.keys()].filter((f) => !calledFns.has(f));
  // 调用点覆盖面：**对账另一个解析器**（`rowRegistrationCounts()` 按行首形态独立扫同一批行模块），
  // 取代原先写死的 `sites.length >= 20`（快照：上游加一族 ⇒ 无判别力的绿）。
  const builtCallKeys = MAIN_MODULES.flatMap((rel) => rowRegistrationCounts(rel, built.modules).fns
    .map((f) => rel + '::' + f));
  const ourCallKeys = sites.map((s) => s.rel + '::' + s.fn);
  const missingCalls = missingFrom(ourCallKeys, builtCallKeys);
  const extraCalls = missingFrom(builtCallKeys, ourCallKeys);
  check('覆盖面：调用点面 == 独立索引解析出的调用点面（两个解析器不许互相矛盾）',
    sites.length > 0 && builtCallKeys.length > 0 && missingCalls.length === 0 && extraCalls.length === 0 && orphans.length === 0,
    `调用点 ${sites.length}（独立索引 ${builtCallKeys.length}）`
      + (missingCalls.length ? ' · 本守卫漏了 ' + missingCalls.join(' ') : '')
      + (extraCalls.length ? ' · 本守卫多了 ' + extraCalls.join(' ') : '')
      + (orphans.length ? ' · 无调用点：' + orphans.join(' ') : ''));
  for (const [s, issues] of siteIssues) console.log('  ✗ ' + s.rel + ':' + s.line + ' → ' + s.fn + '(): ' + issues.map((i) => i.text).join('；'));
  check('② 每个调用点的实参键与声明面对账（门面/组件行双向；子包入口 = 叶子表 ∪ 显式键 ⊇ 族声明面）',
    siteIssues.length === 0,
    siteIssues.length ? siteIssues.length + ' 个调用点不一致' : sites.length + ' 个调用点逐键对账');

  console.log('\n③ 负对照 / 正控（走 ① ② 的同一份判据）');
  selftest(check);

  // M8 = 边界的可声明率：模块声明面对账 + 调用点对账，两个面合并计。**没有豁免账本** ——
  // 任何一处不一致都直接拉低这个数（Lead 口径：M8 必须是真 100%）。
  const okModules = modules.length - moduleIssues.length;
  const okSites = sites.length - siteIssues.length;
  const m8 = Math.round(100 * (okModules + okSites) / (modules.length + sites.length));
  const m8Clean = m8 === 100 && withDecl === modules.length && modules.length > 0 && sites.length > 0
    && orphans.length === 0 && builtCallKeys.length > 0;

  if (dump) {
    console.log('\n== 各族的声明键集（--dump；贴进对应文件的 `export const DEPS`）==');
    for (const m of modules) {
      if (!m.ok) { console.log('  ?? ' + m.rel + '：' + m.reason); continue; }
      const consumed = [...m.consumed.keys()];
      const optional = (m.optionalDeps || []).filter((k) => consumed.includes(k));
      const required = consumed.filter((k) => !optional.includes(k));
      console.log('  ' + m.rel + ' → ' + m.fnName + '  必需 ' + required.length + ' 个: '
        + required.map((k) => "'" + k + "'").join(', ')
        + (optional.length ? '  | 可缺席 ' + optional.length + ' 个: ' + optional.map((k) => "'" + k + "'").join(', ') : '')
        + (m.helpers.length ? '  [模块级消费者: ' + m.helpers.join(' ') + ']' : ''));
    }
    console.log('\n== 调用点实参键（--dump）==');
    for (const s of sites) {
      console.log('  ' + s.rel + ':' + s.line + ' → ' + s.fn + '(): '
        + (s.dynamic ? '（无法解析：' + s.dynamic + '）' : s.keys.map((k) => "'" + k + "'").join(', ')));
    }
  }

  console.log('\nM8=' + m8 + '%'
    + ' (' + withDecl + '/' + modules.length + ' families declared'
    + ' · 声明面对账 ' + okModules + '/' + modules.length + ' 族'
    + ' · 调用点对账 ' + okSites + '/' + sites.length + ' 处'
    + ' · 声明键 ' + declaredKeys + ' 个)');
  console.log('');
  if (!m8Clean || failed) {
    console.log(`INJECT CONTRACT CHECKS FAILED — ${failed} 条判据红（M8=${m8}%）`);
    process.exit(1);
  }
  console.log('ALL INJECT CONTRACT CHECKS PASSED');
  process.exit(0);
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
