#!/usr/bin/env node
/**
 * verify-json-response.mjs — 「**JSON 应答只有一处实现**」的结构守卫。
 *
 * ── 为什么需要它（这条判据的来历）────────────────────────────────────────────
 * 发一个 JSON 应答是三行样板（状态码 + `Content-Type` + `end(JSON.stringify(…))`）。
 * 因为短，它被**抄了十份**：`lib/routes/` 下四种名字（`json` / `jsonOut` / `reply` /
 * `sendJson`）各一份，而且**已经漂移出真实差异** —— `scene-frame.js` 与 `we-assets.js`
 * 那两份不写 `Cache-Control`，其余八份都写 `no-store`。抄成多份时这种差异没人看得到，
 * 也没人能判定它是有意还是漏抄；而"改口径要改十处"迟早会漏掉一处。
 *
 * 与 `verify-body-caps.mjs` 是**同一件事的两面**：那个管"收请求体不许抄漏上限"，
 * 这个管"发应答不许抄出差异"。两者的落地方式也相同 —— 共享实现 + 逐文件从磁盘枚举。
 *
 * ── 判据形态（为什么是它）──────────────────────────────────────────────────
 * 「内联 JSON 应答助手」= 一个**具名闭包/函数**（`const NAME = (…) => { … }` 或
 * `function NAME(…) { … }`），且它的块体是**纯 JSON 应答体** —— 逐行看只有那三行样板：
 *   · `res.statusCode = …;`
 *   · `res.setHeader('Content-Type', 'application/json…');`
 *   · `res.end(JSON.stringify(…));`（可另有一行别的 `setHeader`，如 `Cache-Control`）
 * 且这样的行**至少 2 行、至多 4 行**。
 * 这条"纯"字是判据的关键分界：它把"**一份应答样板**"与下面两类**正确**的相邻形态分开 ——
 *   · 大处理器里顺带发一次 JSON（比如 `scene-frame.js` 的 `/custom-frame`）—— 行数远超 4；
 *   · `const fail = (code, payload) => { … }` 这类**先置失败位再应答**的包装
 *     （`upload.js` / `scene-frame.js` 各一处）—— 抹掉样板后还剩 `if (failed) return;` 等语句。
 * 判据面 = `lib/` 下**除共享实现外**的 `.js`：命中必须为 **0**。
 *
 * 调用点不做"名单"：从磁盘枚举路由族文件（`lib/routes/*.js` ∪ 组件目录直接子文件 —— P2-8 起
 * 实现随组件走），凡是出现 `sendJson(` 的文件都必须属于下面**三条正当来路**之一：
 *   a) 从 `../json-response.js` 引入共享实现；
 *   b) 经叶子 `subpackage-boot.js` 的 `httpView` 具名视图取（历史形态，**判据保留**，不因真文本收敛而删）；
 *   c) **跨包服务视图**（§5.1 ① 之后子包路由族的唯一形态）：本族 `DEPS` 声明 `'http'` 且真的用
 *      `c.http.sendJson(`，同时**包入口**把 `http: host.http` 传下来（`host = ctx.<HOST_SERVICE_NAME>`）。
 * 三条来路都设**棘轮**（调用点只许增，防"只剩一份实现"靠删调用点达成 —— 与
 * verify-body-caps 的 `READER_FLOOR` 同源）。判据面 = `lib/**` ∪ `packages/<pkg>/lib/**`（生成物除外）。
 *
 * ── 判据必须有牙（正/负对照喂**同一个**判据函数）──────────────────────────────
 *   · 覆盖面地板：扫到的 `lib/` 下 .js 文件 ≥ 20 个（解析退化 ⇒ 当场红）；
 *   · 负对照（合成）：内联三行样板必须被判出；
 *   · 正对照（合成）：`const json = (…) => sendJson(res, …)` 必须放行；
 *   · 负对照（扰动真实输入）：把某个**真实**的薄别名在内存里换回内联形态，判据必须报出它
 *     —— 证明真实文本确实流过了判据，而不只是合成数据能过。
 *   · 行为级（⑤，压缩）：**协商式**才合格 —— 无 req / 小载荷 / `q=0` / HEAD / identity 都不压，
 *     声明 gzip 且载荷 ≥ 1 KB 才压，且 gunzip 回来逐字节等于 JSON。
 *
 * 剥注释与配花括号都走共享的**字符串感知**实现（`tools/js-text.mjs` 的 `stripComments`；
 * 配对见下方 `matchBrace`）：朴素正则会被注释/字符串里的花括号带跑 ⇒ 判据静默失效。
 *
 * Usage:  node test/verify-json-response.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { stripComments } from './tools/js-text.mjs';
// 路由族文件面（`lib/routes/*.js` ∪ 组件目录直接子文件）的**同一份**枚举真源。
import { routeModuleFiles } from './tools/host-route-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'lib');

/** 扫描面排除：vendored 第三方（不归我们维护）与本半边的生成物。 */
const EXCLUDE_DIRS = new Set(['vendor', 'webwallgl']);
const EXCLUDE_FILES = new Set(['client.js']);
const EXCLUDE_FILE_RE = /^client(\.[\w.-]+)?\.js$/;

/** 唯一允许出现"内联 JSON 应答助手"的文件（判据的**收敛终点**）。 */
const SOLE_IMPLEMENTATION = 'lib/json-response.js';

/**
 * 棘轮：路由族文件（`lib/routes/*.js` ∪ 组件目录直接子文件）下 `sendJson(` 的调用点下限。
 * P4-14 迁移后实测 16 处（10 个文件的薄别名 + `fontsets`/`presets` 里各 2 处直呼）。
 * **只许增**：它防的是"靠删调用点凑出一份实现"这种假收敛。
 */
const CALL_SITE_FLOOR = 12;

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(p, out);
    } else if (entry.name.endsWith('.js') && !EXCLUDE_FILES.has(entry.name) && !EXCLUDE_FILE_RE.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 引号感知的花括号配对：从 `open`（必须是 `{`）开始找配对的 `}`。
 * 字符串/模板里的花括号不计数（剥注释保留了字符串，所以这里必须自己跳过它们）。
 * 找不到配对返回 -1（调用方按"判据不可判定"处理，宁可红）。
 */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) break;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 1-based 行号：`index` 是**剥注释后**文本里的偏移（等长替换 ⇒ 与原文一致）。 */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** `const NAME = (…) => {` 与 `function NAME(…) {` —— 两种"具名闭包/函数"的块头。 */
const BLOCK_HEADS = [
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*\{/g,
  /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
];

/** 纯应答体里**唯一允许**出现的行形态（逐行判，故 `;` 这种字符串内字符不影响）。 */
const PURE_LINES = [
  /^res\.statusCode\s*=\s*.+;$/,
  /^res\.setHeader\(\s*['"][^'"]+['"]\s*,\s*.+\s*\);$/,
  /^res\.end\(\s*JSON\.stringify\(.+\)\s*\);$/,
  /^res\.end\(.+\);$/,                      // `res.end()` 空体（`res.end();` 也认）
];

/**
 * 块体是不是**纯 JSON 应答体** —— 判据的"纯"字（见文件头）：把 `{` / `}` 与空行滤掉后，
 * 剩下的每一行都得是上面那三种样板之一，且行数在 [2, 4]；同时必须含一个
 * `Content-Type: application/json…` 与一个 `res.end(JSON.stringify(…))`。
 * 合成源码与真实源码走**同一个**函数（负对照因此证明的是同一条判据）。
 */
function isPureJsonBody(body) {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l !== '' && l !== '{' && l !== '}');
  if (lines.length < 2 || lines.length > 4) return false;
  if (!lines.every((l) => PURE_LINES.some((re) => re.test(l)))) return false;
  if (!lines.some((l) => /^res\.setHeader\(\s*['"]Content-Type['"]\s*,\s*['"]application\/json/.test(l))) return false;
  if (!lines.some((l) => /^res\.end\(\s*JSON\.stringify\(/.test(l))) return false;
  return true;
}

/**
 * 判据核心：抽出源码里每一个**内联 JSON 应答助手**（具名 + 纯应答体）。
 * 返回 [{ name, line }]。
 */
function inlineJsonHelpers(src) {
  const out = [];
  for (const re of BLOCK_HEADS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const braceIdx = src.indexOf('{', m.index + m[0].length - 1);
      if (braceIdx === -1) continue;
      const end = matchBrace(src, braceIdx);
      if (end === -1) continue;
      if (!isPureJsonBody(src.slice(braceIdx, end + 1))) continue;
      out.push({ name: m[1], line: lineAt(src, m.index) });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * 叶子具名视图（`lib/subpackage-boot.js` 的 `httpView`）—— 子包路由族取 `sendJson` 的**唯一**正当来路。
 * 跨包不许直接 import 另一包的模块级导出（BUNDLE-SPLIT §5.2 四条反模式），只许走这一个裸子路径。
 */
const LEAF_REL = 'lib/subpackage-boot.js';

/**
 * 跨包服务名真源：`lib/subpackage-boot.js` 的 `HOST_SERVICE_NAME`（不抄字面量 —— 名字漂移由身份对账抓）。
 * 装载失败不回退成"永远放行"，由下面的 check 判红。
 */
const bootMod = await import(pathToFileURL(join(ROOT, LEAF_REL)).href);
const HOST_SERVICE_NAME = typeof bootMod.HOST_SERVICE_NAME === 'string' ? bootMod.HOST_SERVICE_NAME : '';

/**
 * 调用点来路正当性（生产扫描与负对照走**同一份**判据）：文件里出现 `sendJson(` 时，
 *   · a) 从共享实现 `../json-response.js` 引入；或
 *   · b) 从叶子 `subpackage-boot.js` 引入 `httpView` 并 `const { sendJson … } = httpView;`（保留）；或
 *   · c) **跨包服务视图**：本族 `DEPS` 含 `'http'`、文件真的用 `c.http.sendJson(`（或从 `c` 解构出的
 *     `http` 上直呼），且**包入口**把 `http: <host>.http` 传下来（`<host> = ctx.<HOST_SERVICE_NAME>`）。
 * 返回 `{ ok, why }`。
 * @param {string} code 路由族文件源码（已剥注释）
 * @param {{ entryCode?: string }} [opts] 该族的包子包入口源码 —— c 来路要有它才能判"面真的传下来了"
 */
function sendJsonProvenance(code, opts) {
  const o = opts || {};
  if (/from\s+['"][^'"]*json-response\.js['"]/.test(code)) return { ok: true, why: '共享实现' };
  const leafImport = new RegExp('from\\s+[\'"][^\'"]*subpackage-boot\\.js[\'"]').test(code);
  const viewBind = /const\s*\{[^}]*\bsendJson\b[^}]*\}\s*=\s*httpView\s*;/.test(code);
  if (leafImport && viewBind) return { ok: true, why: '叶子 httpView' };
  // c) 跨包服务视图：三条同时成立才算（缺一条 = 判红；"看见 .http 就放行"被负对照钉死）。
  const depsHttp = /export\s+const\s+DEPS\s*=\s*\[([^\]]*)\]/.exec(code);
  const depsHasHttp = Boolean(depsHttp) && /['"]http['"]/.test(depsHttp[1]);
  const usesHttp = /(?<![\w.$])c\s*\.\s*http\s*\.\s*sendJson\s*\(/.test(code)
    || (/\{\s*[^}]*\bhttp\b[^}]*\}\s*=\s*c\b/.test(code) && /(?<![\w.$])http\s*\.\s*sendJson\s*\(/.test(code));
  const entryCode = typeof o.entryCode === 'string' ? o.entryCode : '';
  const recv = new RegExp('const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*ctx\\s*\\.\\s*' + HOST_SERVICE_NAME + '\\b').exec(entryCode);
  const entryPassesHttp = Boolean(recv) && new RegExp('\\bhttp\\s*:\\s*' + recv[1] + '\\s*\\.\\s*http\\b').test(entryCode);
  if (depsHasHttp && usesHttp && entryPassesHttp) return { ok: true, why: 'c.http 宿主视图' };
  const why = [];
  if (leafImport) why.push('引入了叶子但没有 `const { sendJson } = httpView;`');
  else why.push('既没引入共享实现、也没走叶子 httpView');
  if (depsHasHttp && usesHttp && !entryPassesHttp) why.push('DEPS 有 http 且用了它，但包入口没有把 `http: <host>.http` 传下来');
  else if (depsHasHttp && !usesHttp) why.push('DEPS 声明了 http 但文件里没用 `c.http.sendJson(`');
  return { ok: false, why: why.join('；') };
}
// ── ① 判据自身的正/负对照（先证明它有牙，再看真实代码）──────────────────────
const INLINE_COPY = [
  'const json = (code, payload) => {',
  "  res.statusCode = code;",
  "  res.setHeader('Content-Type', 'application/json; charset=utf-8');",
  "  res.setHeader('Cache-Control', 'no-store');",
  '  res.end(JSON.stringify(payload));',
  '};',
].join('\n');
const THIN_ALIAS = "const json = (code, payload) => sendJson(res, code, payload);";
{
  check('负对照：内联三行样板被判出',
    inlineJsonHelpers(INLINE_COPY).map((h) => h.name).join() === 'json',
    '报出=[' + inlineJsonHelpers(INLINE_COPY).map((h) => h.name).join() + ']');
  check('正对照：薄别名（无块体、委托共享实现）放行', inlineJsonHelpers(THIN_ALIAS).length === 0);
  check('负对照：`function` 形态同样被判出',
    inlineJsonHelpers("function jsonOut(res, code, p) {\n  res.statusCode = code;\n"
      + "  res.setHeader('Content-Type', 'application/json; charset=utf-8');\n"
      + '  res.end(JSON.stringify(p));\n}').length === 1);
  check('负对照：大处理器里顺带发一次 JSON **不**被判出（行数远超 4）',
    inlineJsonHelpers('const handle = (req, res) => {\n'
      + "  const method = (req.method || 'GET').toUpperCase();\n"
      + "  res.setHeader('Content-Type', 'application/json; charset=utf-8');\n"
      + "  res.setHeader('X-A', '1'); res.setHeader('X-B', '2');\n"
      + "  res.statusCode = 200;\n"
      + '  res.end(JSON.stringify({ ok: true }));\n};').length === 0);
  check('负对照：`fail(code, payload)` 那种"先置失败位再应答"的包装**不**被判出（纯字边界）',
    inlineJsonHelpers("const fail = (code, payload) => {\n"
      + '  if (failed) return;\n'
      + '  failed = true;\n'
      + '  res.statusCode = code;\n'
      + "  res.setHeader('Content-Type', 'application/json; charset=utf-8');\n"
      + '  res.end(JSON.stringify(payload));\n'
      + '  lingerClose(req, res);\n};').length === 0);
  check('负对照：字符串/注释里的样板不算（判据先剥注释）',
    inlineJsonHelpers(stripComments('// ' + INLINE_COPY.replace(/\n/g, '\n// '))).length === 0);
}

// ── ② 真实代码：从磁盘枚举（**共享实现本身不在判据面内**）────────────────────
// 判据面 = `lib/**` ∪ `packages/<pkg>/lib/**`：P-A 起路由族随子包行出户（fonts 的两族），只扫 `lib/` 会让
// 子包里的内联副本**静默脱离**本判据（面塌陷 ⇒ 判据恒真）。子包的 `src/**` 是浏览器半边，不进 Node 侧判据面。
const PKGS = join(ROOT, 'packages');
const packageLibFiles = existsSync(PKGS)
  ? readdirSync(PKGS, { withFileTypes: true }).filter((e) => e.isDirectory()).sort()
    .flatMap((e) => { const d = join(PKGS, e.name, 'lib'); return existsSync(d) ? walk(d) : []; })
  : [];
const files = [...walk(LIB), ...packageLibFiles].sort()
  .filter((f) => relative(ROOT, f).split('\\').join('/') !== SOLE_IMPLEMENTATION);
const hits = [];
for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const text = stripComments(readFileSync(file, 'utf8'));
  for (const h of inlineJsonHelpers(text)) hits.push({ ...h, file: rel });
}

console.log(`\n  扫描面：lib/**/*.js ∪ packages/<pkg>/lib/**/*.js（排除 ${[...EXCLUDE_DIRS].join(' / ')}`
  + ` / ${[...EXCLUDE_FILES].join(' / ')} / ${SOLE_IMPLEMENTATION}） —— ${files.length} 个文件`);
console.log(`  内联 JSON 应答助手：${hits.length} 处`);
for (const h of hits) console.log(`    · ${h.file}:${h.line}（${h.name}）`);
console.log('');

check('覆盖面：判据面扫到 ≥ 20 个 .js（lib ∪ packages/<pkg>/lib；判据面为空即失败）', files.length >= 20, `实测 ${files.length}`);
// 覆盖面地板（子包那一半）：随子包行出户的路由族必须在判据面内 —— walk(packages) 静默返回空时这里点名。
const judgedRels = files.map((f) => relative(ROOT, f).split('\\').join('/'));
const subpackageRouteRels = routeModuleFiles().filter((rel) => rel.startsWith('packages/'));
check('覆盖面：判据面包含全部子包路由族（塌回 `lib/`-only ⇒ 红）',
  subpackageRouteRels.length > 0 && subpackageRouteRels.every((rel) => judgedRels.includes(rel)),
  '子包路由族 ' + subpackageRouteRels.length + ' 个 · 面内 packages 文件 ' + judgedRels.filter((r) => r.startsWith('packages/')).length + ' 个');
check(`唯一实现：${SOLE_IMPLEMENTATION} 之外**零**份内联 JSON 应答助手`,
  hits.length === 0, hits.map((h) => `${h.file}:${h.line}(${h.name})`).join(', ') || '零副本');

// ── ③ 共享实现本身的形态（判据不得空转）────────────────────────────────────
{
  const abs = join(ROOT, SOLE_IMPLEMENTATION);
  check(`${SOLE_IMPLEMENTATION} 在磁盘上`, existsSync(abs));
  if (existsSync(abs)) {
    const src = readFileSync(abs, 'utf8');
    check('共享实现导出 `sendJson`', /export\s+function\s+sendJson\s*\(/.test(src));
    check('共享实现真的发 JSON（`Content-Type` + `JSON.stringify(payload)` + `res.end(`）',
      /'Content-Type',\s*'application\/json; charset=utf-8'/.test(src)
      && /JSON\.stringify\(payload\)/.test(src) && /res\.end\(/.test(src));
    // 压缩的三条不变量（#158）：有阈值、请求从 `res.req` 取（**不改签名**）、只在大载荷上
    // 声明 `Vary` / `Content-Encoding`。
    check('共享实现的压缩是协商式的（阈值 + `res.req` 协商 + `Vary`）',
      /GZIP_MIN_BYTES\s*=\s*\d+/.test(src) && /res\.req/.test(src)
      && /'Vary',\s*'Accept-Encoding'/.test(src) && /'Content-Encoding',\s*'gzip'/.test(src));
    check('压缩没有改签名（仍是 4 个形参：res / code / payload / cacheControl）',
      /export\s+function\s+sendJson\s*\(\s*res\s*,\s*code\s*,\s*payload\s*,\s*cacheControl\s*=\s*'no-store'\s*\)/.test(src));
    // 缓存头口径：默认 no-store，且**保留**"不写该头"的出口（行为不改的搬运依据）。
    check('共享实现默认 `no-store`，并保留 `null` = 不写该头的出口',
      /no-store/.test(src) && /cacheControl !== null/.test(src));
    check('正对照：共享实现**不**被判据面命中（它多一行 `if (…)` ⇒ 不是"纯"样板，故不在面内）',
      inlineJsonHelpers(stripComments(src)).length === 0);
  }
}

// ── ④ 每个调用点都必须来路正当（`sendJson(` ⇒ 必须 import 自共享实现）────────
{
  // 路由族文件面走 `host-route-index.mjs` 的同一份枚举真源：P2-8 把四个族搬进组件目录后，
  // 只扫 `lib/routes/` 会让它们**静默脱离**本判据（§10 风险 12 的同款形态）。
  const routeFiles = routeModuleFiles();
  const callers = [];
  for (const rel of routeFiles) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    const code = stripComments(raw);
    const calls = (code.match(/\bsendJson\s*\(/g) || []).length;
    if (!calls) continue;
    // c) 来路要**包入口**当证据：包入口把 `http: host.http` 传下来，跨包面才算真的到位。
    const pkg = /^packages\/([^/]+)\//.exec(rel);
    const entryRel = pkg ? `packages/${pkg[1]}/lib/index.js` : '';
    const entryCode = entryRel && existsSync(join(ROOT, entryRel))
      ? stripComments(readFileSync(join(ROOT, entryRel), 'utf8')) : '';
    callers.push({ rel, calls, ...sendJsonProvenance(code, { entryCode }) });
  }
  const callSites = callers.reduce((n, c) => n + c.calls, 0);

  check('覆盖面：路由模块被枚举到（≥ 10 个 .js）', routeFiles.length >= 10, `实测 ${routeFiles.length}`);
  check(`棘轮：\`sendJson(\` 调用点 ≥ ${CALL_SITE_FLOOR}（只许增，防"靠删调用点凑出的假收敛"）`,
    callSites >= CALL_SITE_FLOOR, `实测 ${callSites} 处 / ${callers.length} 个文件`);
  const notLegit = callers.filter((c) => !c.ok);
  check('每个调用 `sendJson(` 的路由文件都来路正当（共享实现，或叶子 `httpView` 的同一函数）',
    notLegit.length === 0, notLegit.map((c) => c.rel + '（' + c.why + '）').join(', ') || '全部来路正当');

  // 子包路由族走叶子 `httpView` ⇒ 必须证明那不是"另一个同名东西"：实跑 identity 对账。
  const leafView = bootMod;
  const sharedMod = await import(pathToFileURL(join(ROOT, SOLE_IMPLEMENTATION)).href);
  check('等价来源：叶子 `httpView.sendJson` === 共享实现的 `sendJson`（同一函数对象，不是同名副本）',
    Boolean(leafView.httpView) && leafView.httpView.sendJson === sharedMod.sendJson,
    leafView.httpView ? 'identity = ' + (leafView.httpView.sendJson === sharedMod.sendJson) : '叶子没有导出 httpView');
  const viaLeaf = callers.filter((c) => c.why === '叶子 httpView');
  const viaHttp = callers.filter((c) => c.why === 'c.http 宿主视图');
  const subpackageCallers = callers.filter((c) => c.rel.startsWith('packages/'));
  check('服务面真源：lib/subpackage-boot.js 导出 HOST_SERVICE_NAME（读不到 = c 来路没法判）',
    HOST_SERVICE_NAME !== '', 'HOST_SERVICE_NAME=' + JSON.stringify(HOST_SERVICE_NAME));
  // 覆盖面无牙判据：子包调用点必须**全部**被已知来路解释，且 c 这一新形态必须真的被验到
  // （真文本零个案 ⇒ 这条判据就是空转）。
  check('覆盖面：子包路由族的正当来路全部被验到（叶子 httpView ∪ c.http 宿主视图；c 形态没被验到 = 判据没牙）',
    subpackageCallers.length > 0 && viaLeaf.length + viaHttp.length === subpackageCallers.length && viaHttp.length > 0,
    '叶子形态 ' + (viaLeaf.map((c) => c.rel).join(' ') || '（0 个）') + ' · c.http 形态 '
    + (viaHttp.map((c) => c.rel).join(' ') || '（0 个）') + ' · 子包调用点 ' + subpackageCallers.length + ' 个');

  // 正/负对照（合成，b 形态）：真文本里 b 已收敛掉，也必须证明"这条来路仍被认、且不是看见 import 就放行"。
  const LEAF_VIEW_IMPORT = 'import { httpView } ' + 'from' + ' ' + JSON.stringify('./lib/subpackage-boot.js') + ';';
  const synthLeaf = LEAF_VIEW_IMPORT + '\nconst { sendJson } = httpView;\n'
    + 'const json = (code, payload) => sendJson(res, code, payload);';
  check('正对照（合成）：叶子 httpView 形态仍被同一条来路判据放行（历史形态没被悄悄删掉）',
    sendJsonProvenance(synthLeaf).ok === true && sendJsonProvenance(synthLeaf).why === '叶子 httpView',
    sendJsonProvenance(synthLeaf).why);
  const synthLeafNoBind = synthLeaf.split('const { sendJson } = httpView;').join('');
  check('负对照（合成）：叶子 import 了 httpView 但没有取出 sendJson ⇒ 判红（不是"看见 import 就放行"）',
    sendJsonProvenance(synthLeafNoBind).ok === false, sendJsonProvenance(synthLeafNoBind).why);

  // 真实输入扰动（c 形态）：把真实包入口的 `http: <host>.http` 换成**内联副本** ⇒ 来路判据必须判红。
  const httpVictim = viaHttp[0];
  if (httpVictim) {
    const pkg = /^packages\/([^/]+)\//.exec(httpVictim.rel);
    const entryRel = pkg ? `packages/${pkg[1]}/lib/index.js` : '';
    const realEntry = stripComments(readFileSync(join(ROOT, entryRel), 'utf8'));
    const realRoute = stripComments(readFileSync(join(ROOT, httpVictim.rel), 'utf8'));
    const inlineHttp = 'http: { sendJson: (res, code, payload) => {\n'
      + '  res.statusCode = code;\n'
      + "  res.setHeader('Content-Type', 'application/json; charset=utf-8');\n"
      + '  res.end(JSON.stringify(payload));\n} }';
    const perturbedEntry = realEntry.replace(/http\s*:\s*[A-Za-z_$][\w$]*\s*\.\s*http\b/g, inlineHttp);
    const prov = sendJsonProvenance(realRoute, { entryCode: perturbedEntry });
    check('负对照（真实输入）：把真实包入口的 `http: <host>.http` 换成内联副本 ⇒ 来路判据判红',
      perturbedEntry !== realEntry && prov.ok === false, entryRel + ' → ' + prov.why);
    check('正对照：真实子包路由族（c.http 形态）被同一条来路判据放行（判据不恒假）',
      sendJsonProvenance(realRoute, { entryCode: realEntry }).ok === true
      && sendJsonProvenance(realRoute, { entryCode: realEntry }).why === 'c.http 宿主视图');
  } else {
    check('负对照（真实输入）：找到一个经 c.http 取 sendJson 的子包路由族做扰动', false, '（零个）');
  }

  // 扰动真实输入（b 形态，若本仓仍有这一形态）：换回本地内联三行样板 ⇒ 内联 + 来路两条判据都要报出。
  const leafVictim = viaLeaf[0];
  if (leafVictim) {
    const real = stripComments(readFileSync(join(ROOT, leafVictim.rel), 'utf8'));
    const inline = 'const sendJson = (res, code, payload) => {\n'
      + '  res.statusCode = code;\n'
      + "  res.setHeader('Content-Type', 'application/json; charset=utf-8');\n"
      + "  res.setHeader('Cache-Control', 'no-store');\n"
      + '  res.end(JSON.stringify(payload));\n};';
    const perturbed = real.replace(/const\s*\{[^}]*\bsendJson\b[^}]*\}\s*=\s*httpView\s*;/, inline);
    const found = inlineJsonHelpers(perturbed);
    const prov2 = sendJsonProvenance(perturbed);
    check('负对照（真实输入）：子包路由族把叶子 `httpView` 取用换回本地内联 ⇒ 内联副本被判出且来路判据判红',
      perturbed !== real && found.length === 1 && found[0].name === 'sendJson' && prov2.ok === false,
      leafVictim.rel + ' → 内联报出=[' + found.map((h) => h.name).join() + '] 来路=' + prov2.why);
    check('正对照：真实子包路由族的叶子视图取用被同一条来路判据放行（判据不恒假）',
      sendJsonProvenance(real).ok === true && sendJsonProvenance(real).why === '叶子 httpView', sendJsonProvenance(real).why);
  } else {
    check('负对照（真实输入）：本仓当前没有经叶子 httpView 取 sendJson 的路由族（形态已收敛到 c.http）—— 该形态的牙由上面的合成正/负对照覆盖',
      viaHttp.length > 0 && subpackageCallers.every((c) => c.ok),
      '叶子形态 0 个 · c.http 形态 ' + viaHttp.length + ' 个');
  }

  // 扰动真实输入：把某个真实薄别名在**内存里**换回内联形态，同一判据必须报出它。
  const victim = callers.find((c) => /const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*sendJson\(/.test(
    readFileSync(join(ROOT, c.rel), 'utf8')));
  if (victim) {
    const real = readFileSync(join(ROOT, victim.rel), 'utf8');
    const perturbed = stripComments(real).replace(
      /const\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*sendJson\(res,\s*([^;]*)\);/,
      (full, name, args) => 'const ' + name + ' = (' + args + ') => {\n'
        + "  res.setHeader('Content-Type', 'application/json; charset=utf-8');\n"
        + '  res.end(JSON.stringify(' + args.split(',').pop().trim() + '));\n};');
    const found = inlineJsonHelpers(perturbed);
    check('负对照：把真实薄别名换回内联形态，判据精确报出（真实文本确实过了判据）',
      found.length === 1 && perturbed !== stripComments(real),
      victim.rel + ' → ' + (found.map((h) => h.name).join() || '（没报出来）'));
  } else {
    check('负对照：找到一个真实薄别名做扰动', false, '没有形如 `const X = (…) => sendJson(…)` 的别名');
  }
}

// ── ⑤ 压缩是**协商式**的（行为级：同一个函数喂五种请求头）────────────────────
{
  const { sendJson } = await import(pathToFileURL(join(ROOT, SOLE_IMPLEMENTATION)).href);
  const call = (payload, accept, method = 'GET') => {
    const headers = {};
    let body = null;
    const res = {
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      end(b) { body = b; },
    };
    if (accept !== undefined) res.req = { method, headers: accept === null ? {} : { 'accept-encoding': accept } };
    sendJson(res, 200, payload);
    return { headers, body };
  };
  const big = { wallpapers: Array.from({ length: 300 }, (_, i) => ({ id: 'p' + i, title: 'x'.repeat(32) })) };
  const bigJson = JSON.stringify(big);
  const small = { ok: true };

  const plain = call(big, undefined);   // 台架形态：假 res 没有 req
  check('假 res（无 req）⇒ 不压缩，body 就是 JSON 字节（旧行为逐字节不变）',
    plain.headers['content-encoding'] === undefined && plain.body.toString('utf8') === bigJson);

  const gz = call(big, 'gzip, deflate, br');
  check('accept-encoding: gzip + 大载荷 ⇒ Content-Encoding: gzip，gunzip 后逐字节等于 JSON',
    gz.headers['content-encoding'] === 'gzip' && gz.headers.vary === 'Accept-Encoding'
    && gunzipSync(gz.body).toString('utf8') === bigJson,
    '压缩后 ' + gz.body.length + ' B / 原始 ' + Buffer.byteLength(bigJson) + ' B');
  check('压缩确实变小了（不是"压了但更大"）', gz.body.length < Buffer.byteLength(bigJson));

  const tiny = call(small, 'gzip');
  check('小载荷（< 1 KB）不压：省不下 1 KB 却要多两个头',
    tiny.headers['content-encoding'] === undefined && tiny.body.toString('utf8') === JSON.stringify(small));

  const q0 = call(big, 'gzip;q=0');
  check('`gzip;q=0` = 客户端明确不要 ⇒ 不压（协商不是"看见 gzip 字样就压"）',
    q0.headers['content-encoding'] === undefined);

  const head = call(big, 'gzip', 'HEAD');
  check('HEAD ⇒ 不压（与宿主 compression 中间件同口径：只回头、不回体）',
    head.headers['content-encoding'] === undefined);

  const identity = call(big, 'identity');
  check('负对照：只声明 identity ⇒ 不压（证明上面那条不是恒真）',
    identity.headers['content-encoding'] === undefined);
}

console.log('');
if (failed) {
  console.log(`JSON-RESPONSE CHECKS FAILED — ${failed} 条不合格`);
  // ⚠️ 文案里**不得**出现 `from` 紧跟引号的字样：verify-package-files 的 P5 裸依赖扫描只剥注释、
  // 不剥字符串，那种字样会被当成真的裸包 import，把本守卫（它自己就在被扫的链里）判红。
  console.log('修法：删掉那份内联副本 —— 主包路由文件从 `../json-response.js` 引入薄别名；子包路由族走**跨包服务视图**（§5.1 ①）：'
    + '本族 `DEPS` 声明 `http`、用 `c.http.sendJson(`，包入口把 `http: host.http`（host = ctx.wallpaperEngineHost）传下来；'
    + '（历史形态：从叶子 `subpackage-boot.js` 取 `httpView`，判据仍认。）调用点不用改。');
  process.exit(1);
}
console.log('JSON-RESPONSE CHECKS PASSED');
