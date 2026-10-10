#!/usr/bin/env node
/**
 * verify-logging.mjs —— 日志分级的**结构判据**：收口、预算、成功路径与热路径。
 *
 * 这一族规则回答的不是"文案对不对"，而是四个**结构性**问题 —— 它们全都能用文本判据钉住，
 * 所以不该只靠人读代码：
 *   N1 **单一收口**：`lib/**` 里除 `lib/log.js` 与 `lib/notice.js` 外零 `console.*`。
 *      没有这条，"默认终端只出问题"就退化成几十处各自为政的打印。
 *   N2 **提示预算**：`notice(` 的调用点必须落在编译期白名单里，且总量不超过预算。
 *      没有这条，成功提示会退化成第二份日志（"极其少量"就只是一句愿望）。
 *   N3 **源码级不重复**：每个 `kind` 在调用点里恰好出现一次（会话内幂等另由运行时 Set 保证）。
 *   N4 **成功不发日志**：`lib/notice.js` 的日志出口只有失败路径那一条 `warn`。
 *   N5 **热路径零提示**：逐请求 / 逐帧的代码段里不许出现 `notice(` —— 提示只许在里程碑位置。
 *   N6 **两侧档位名同集合**：宿主与客户端各自声明三个档位名，集合必须一致（两侧不共享内核，
 *      所以"一致"这件事本身需要判据）。
 *   N7 **渲染页自带级别声明**：`/diag` 分档的主路径是发送端自带的 `&lvl=`，由上游 WebWallGL
 *      自己声明（issue #13）—— 产物里真有 `lvl=` 上报与三档字面量，且产物**不许**再有本地补丁
 *      （本地把级别打进产物会在下次 vendor 时被覆盖，也让产物与上游不一致）。只删补丁不建上游，
 *      渲染页就退回"宿主靠文案猜"。
 *      ③ 同一份同步 rig 还要与宿主**路由前缀**对齐：产物里的绝对引用、rig 的 base、宿主注册的
 *      `${BASE}/…` 三者一致 —— 否则改前缀/改路由名时产物与路由静默分叉（渲染页 404 而判据全绿）。
 *
 * N1–N6 是**静态**判据（代码长什么样）；R1–R4 是**运行期**判据（真的跑一遍两个宿主模块）——
 * 闸门三态、幂等与"投递失败才 warn"这三件事在源码上看不出来，只能跑：
 *   R1 `DSH_WE_LOG_LEVEL` 三值真的决定终端镜像哪些档位（默认 `warn`；非法值按默认）。
 *   R2 一个 kind 每会话**至多一条**提示（同一实例内重复调用不再投递）。
 *   R3 `DSH_WE_NOTICE` 三态：`0` 静默不报、`1` 强制输出、未设且非 TTY 静默不报。
 *   R4 投递失败**恰好一条** `warn`（同步抛错与回调 err 两条失败路径）。
 *   R5 宿主侧分流：`/diag` 按失败模式表分档、`&lvl=` 三档优先、`/client-diag` 的
 *      `live-ready`+`scene` 进提示通道，且三条早退与落盘契约不变。
 *
 * 出口形态与其余守卫一致：每条判据都配**可失败对照**（合成输入上必须判红），否则一条
 * 恒真断言看起来和一条真判据没有区别。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const results = [];
function check(name, ok, detail) {
  results.push(Boolean(ok));
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
}

const read = (rel) => readFileSync(ROOT + rel, 'utf8');
/** 判据只针对**代码**：剥注释走共享实现（test/tools/js-text.mjs），
 *  否则散文里举例的 `console.log` 会把守卫自己判红。 */

/** 两个允许直接写终端的宿主模块（`lib/log.js` 的终端镜像 + `lib/notice.js` 的提示行）。 */
const SINKS = ['lib/log.js', 'lib/notice.js'];
/** 不在这条判据扫描面里的东西及其理由（口径写在判据旁，不靠"约定"）。 */
const NOT_OURS = [
  [/^lib\/client\.js$/, '构建产物（源在 src/**，由 build-client 内联生成）'],
  [/^lib\/webwallgl\//, '上游 vendored 渲染页（自带 WebWallGL 的 console logger）'],
];

function walkLib(dir, out = []) {
  for (const e of readdirSync(ROOT + dir, { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walkLib(rel, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const LIB_FILES = walkLib('lib').sort();
/** N1 的扫描面：全量 `lib/**.{js,mjs}` 减去两个 sink 与三类非自研文件。 */
const N1_FILES = LIB_FILES.filter((f) => !SINKS.includes(f) && !NOT_OURS.some(([rx]) => rx.test(f)));

// ── 判据（纯函数，主扫描与可失败对照共用同一份）──────────────────────────────
/** `console.xxx(` 与 `console[...]` 两种写法都算（括号写法是最省事的绕开方式）。 */
const CONSOLE_CALL = /(?<![\w$.])console\s*(?:\.\s*[A-Za-z_$][\w$]*|\[)/g;
const consoleCalls = (src) => (stripComments(src).match(CONSOLE_CALL) || []).length;

/** `notice(<字面量>, …)` 的调用点：返回字面量 kind 列表。 */
const NOTICE_CALL = /\bnotice\(\s*(['"])([^'"]+)\1/g;
const noticeLiteralKinds = (src) => [...stripComments(src).matchAll(NOTICE_CALL)].map((m) => m[2]);
const noticeCallCount = (src) => (stripComments(src).match(/\bnotice\s*\(/g) || []).length;

/** 提示预算：**常量的家在这里**（判据就是"提示极其少量"这句话本身）。 */
const NOTICE_BUDGET = 2;
/** 预算判据：白名单不超预算、调用点不超预算、每个调用点都在白名单里、且没有非字面量调用。 */
const noticeBudgetOk = (kinds, calls, nonLiteral = 0) =>
  Array.isArray(kinds) && kinds.length > 0 && kinds.length <= NOTICE_BUDGET
  && calls.length <= NOTICE_BUDGET && nonLiteral === 0
  && calls.every((k) => kinds.includes(k));

/** 提示白名单从 `lib/notice.js` 的 `KINDS` **读出来**，守卫不抄第二份。 */
function noticeKinds(src) {
  const block = (stripComments(src).match(/const KINDS = \[([^\]]*)\]/) || [])[1];
  return block === undefined ? null : [...block.matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2]);
}

/** 按大括号配对取一个函数体（把"热路径"钉成一段真的代码，而不是一句形容）。 */
function functionBody(src, header) {
  const at = src.indexOf(header);
  if (at < 0) return null;
  const open = src.indexOf('{', at + header.length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

/** 三档名在源码里出现的集合（字面量口径；两侧各写一份，N6 只判集合相等）。 */
const LEVEL_NAMES = ['error', 'warn', 'info'];
const levelNamesIn = (src) => LEVEL_NAMES.filter((l) => src.includes("'" + l + "'") || src.includes('"' + l + '"'));

// ── N1 单一收口 ─────────────────────────────────────────────────────────────
{
  const offenders = [];
  for (const f of N1_FILES) {
    const n = consoleCalls(read(f));
    if (n) offenders.push(f + '=' + n);
  }
  check('N1 `lib/**` 里除 log.js / notice.js 外零 console.*（终端只有一个收口）',
    N1_FILES.length >= 12 && offenders.length === 0,
    offenders.length ? '命中：' + offenders.join(' ')
      : N1_FILES.length + ' 个模块干净（扫描面 = lib/**.{js,mjs} 减去 ' + SINKS.length
        + ' 个 sink 与 ' + NOT_OURS.length + ' 类非自研文件）');
  check('N1 negative control: 合成源码里的 console 调用会被判出，注释里的不会',
    consoleCalls("console.log('x')") === 1 && consoleCalls("console['warn']('x')") === 1
    && consoleCalls("x.console.log('x')") === 0
    && consoleCalls('// console.log("x")') === 0 && consoleCalls('/* console.log("x") */') === 0);
}

// ── N2 提示预算（调用点 ⊆ 白名单，且总量不超预算）────────────────────────────
const KINDS = noticeKinds(read('lib/notice.js'));
/** N2/N3 的调用点扫描面 = 我们自己的宿主模块（vendored / 生成的产物不可能调用宿主 `notice`）。 */
const CALLERS = N1_FILES.filter((f) => f !== 'lib/notice.js');
{
  const calls = [];
  let nonLiteral = 0;
  for (const f of CALLERS) {
    const src = read(f);
    nonLiteral += noticeCallCount(src) - noticeLiteralKinds(src).length;
    calls.push(...noticeLiteralKinds(src));
  }
  check('N2 `notice(` 调用点都在编译期白名单里，且总量不超预算（防退化成第二份日志）',
    noticeBudgetOk(KINDS, calls, nonLiteral),
    '白名单=' + JSON.stringify(KINDS) + ' 调用点=' + calls.length + ' 非字面量=' + nonLiteral
      + ' 预算=' + NOTICE_BUDGET);
  check('N2 negative control: 超预算的白名单 / 未登记的 kind / 非字面量调用都会被判出',
    noticeBudgetOk(['a', 'b', 'c'], ['a', 'b', 'c']) === false
    && noticeBudgetOk(['a', 'b'], ['a', 'b', 'z']) === false
    && noticeBudgetOk(['a', 'b'], ['a', 'b'], 1) === false
    && noticeBudgetOk(['a', 'b'], ['a', 'b']) === true);
}

// ── N3 源码级不重复（每个 kind 的调用点恰好一处）──────────────────────────────
{
  const counts = new Map((KINDS || []).map((k) => [k, 0]));
  for (const f of CALLERS) {
    for (const k of noticeLiteralKinds(read(f))) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const bad = [...counts.entries()].filter(([, n]) => n !== 1);
  check('N3 每个 kind 在调用点里恰好出现一次（会话内幂等由运行时 Set 负责）',
    counts.size > 0 && bad.length === 0,
    bad.length ? '次数不为 1：' + bad.map(([k, n]) => k + '=' + n).join(' ')
      : [...counts].map(([k, n]) => k + '=' + n).join(' '));
}

// ── N4 成功不发日志（lib/notice.js 的日志出口只有失败路径的那一个处理器）──────
const LOG_CALL = /log\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
/**
 * 成功路径不碰日志：文件里**所有** `log.<方法>(` 都必须落在失败处理器
 * （`function reportFailure(kind, err)`）的函数体之内，且只许用 `warn`。
 * 位置在文件里怎么排都不影响判据 —— 判的是"在不在成功路径上"。
 */
function noticeSuccessSilent(src) {
  const s = stripComments(src);
  const body = functionBody(s, 'function reportFailure(kind, err)');
  if (body === null) return false;
  const all = [...s.matchAll(LOG_CALL)];
  return all.length > 0 && all.every((m) => m[1] === 'warn')
    && [...body.matchAll(LOG_CALL)].length === all.length;
}
{
  check('N4 `lib/notice.js` 成功路径不调用日志；唯一的日志出口是失败处理器的 warn',
    noticeSuccessSilent(read('lib/notice.js')),
    '日志调用=' + JSON.stringify([...stripComments(read('lib/notice.js')).matchAll(LOG_CALL)]
      .map((m) => m[1])) + ' 失败处理器=' + (functionBody(stripComments(read('lib/notice.js')), 'function reportFailure(kind, err)') !== null));
  check('N4 negative control: 成功路径上的 warn / info，以及别处的 warn 都会被判出',
    noticeSuccessSilent("process.stdout.write('x'); log.info('ok');\nfunction reportFailure(kind, err) { log.warn('bad'); }") === false
    && noticeSuccessSilent("process.stdout.write('x'); log.warn('ok');\nfunction reportFailure(kind, err) { log.warn('bad'); }") === false
    && noticeSuccessSilent("process.stdout.write('x');\nfunction reportFailure(kind, err) { log.warn('bad'); }") === true);
}

// ── N5 热路径零提示 ─────────────────────────────────────────────────────────
{
  // 逐请求 / 逐帧的代码段（"热路径"在这里是可定位的代码，不是一句形容）：
  //   ① `lib/routes/scene-serve.js` 整个文件（每条语句都在请求路径上）；
  //   ② `src/live-layer.js` 整个文件（客户端半边：成功提示只能经 /client-diag 上行）；
  //   ③ `lib/serve.js` 的 handleSceneFiles 函数体（每个壁纸子资源请求都过它）。
  const hot = [
    ['lib/routes/scene-serve.js', read('lib/routes/scene-serve.js')],
    ['src/live-layer.js', read('src/live-layer.js')],
    ['lib/serve.js:handleSceneFiles', functionBody(read('lib/serve.js'), 'function handleSceneFiles(req, res, mount)')],
  ];
  const missing = hot.filter(([, body]) => body === null).map(([n]) => n);
  const hits = hot.filter(([, body]) => body !== null && noticeCallCount(body) > 0).map(([n]) => n);
  check('N5 热路径（请求段 / 客户端半边 / 壁纸文件处理器）里零 notice(',
    missing.length === 0 && hits.length === 0,
    missing.length ? '定位不到代码段：' + missing.join(' ') : (hits.length ? '命中：' + hits.join(' ') : '三段都干净'));
  check('N5 negative control: 同一个计数与同一段提取器在合成热路径上都会命中',
    noticeCallCount("function h(){ notice('scene-ready', 'x'); }") === 1
    && functionBody("function h(){ notice('scene-ready', 'x'); }", 'function h(') !== null
    && functionBody("function h(){ return 1; }", 'function h(') !== null);
}

// ── N6 两侧档位名同集合 ─────────────────────────────────────────────────────
{
  const host = levelNamesIn(read('lib/log.js'));
  const client = levelNamesIn(read('src/live-layer.js'));
  check('N6 宿主与客户端声明的三个档位名集合相同（两侧不共享内核，靠判据防漂）',
    host.length === LEVEL_NAMES.length && client.length === LEVEL_NAMES.length
    && LEVEL_NAMES.every((l) => host.includes(l) && client.includes(l)),
    'host=[' + host.join(',') + '] client=[' + client.join(',') + ']');
  check('N6 negative control: 少一个档位名的合成文本会被判出',
    levelNamesIn("const X = { 'error': 1, 'warn': 1 };").length !== LEVEL_NAMES.length
    && levelNamesIn("const X = { 'error': 1, 'warn': 1, 'info': 1 };").length === LEVEL_NAMES.length);
}

// ── N7 渲染页的级别由**上游产物自己**声明（宿主不再需要本地补丁）──────────────
// `/diag` 分档的主路径是发送端自带的 `&lvl=`：上游 WebWallGL 的 `diag-level.ts` 负责声明
// （issue #13），宿主 `lib/routes/diag.js` 只读不猜 —— 三档优先、未知 / 缺失才回落模式表
// （那条回落由 R5 用真请求钉住）。本判据把两件事同时钉住：「产物自带级别」与「补丁已清干净」：
// 少了上游实现，渲染页就退回"宿主靠文案猜"；而产物一旦被本地改过，`/scene-live` 的 immutable
// 缓存会让同一 URL 继续发旧字节 —— 两种坏法都只有在这里能当场看见。
/** 产物自带级别：`/diag` 上报模板带 `lvl=`，且三档字面量齐（宿主按这三个值认档）。 */
function rendererDeclaresLevel(src) {
  return src.includes('/diag?msg=') && /&lvl=\$\{[A-Za-z_$][\w$]*\}/.test(src)
    && LEVEL_NAMES.every((l) => src.includes('"' + l + '"'));
}
/** 本地补丁残留：产物里的补丁标记 / 补丁后缀名，以及同步脚本里的补丁函数与开关。 */
function localPatchResidue(assets, syncSrc) {
  const out = [];
  for (const f of assets) {
    if (read(f).includes('__weLvl')) out.push(f + ' 带补丁标记');
    if (/-welvl\d*\.js$/.test(f)) out.push(f + ' 带补丁后缀');
  }
  const code = stripComments(syncSrc);
  // 这是**零残留**探针：谁把补丁函数或
  // `--patches-only` 接回来，这里就红 —— 它不读"工具里有没有这些字符串"，而是断言它们不在。
  for (const mark of ['applyLocalPatches', 'applyDiagLevelPatch', 'PATCH_SUFFIX', 'patches-only']) {
    if (code.includes(mark)) out.push('sync-webwallgl.mjs 仍有 ' + mark);
  }
  return out;
}
{
  const assets = LIB_FILES.filter((f) => /^lib\/webwallgl\/assets\/.*\.js$/.test(f));
  const declared = assets.filter((f) => rendererDeclaresLevel(read(f)));
  const residue = localPatchResidue(assets, read('test/tools/sync-webwallgl.mjs'));
  check('N7 渲染页产物自带级别声明：`/diag` 上报带 `lvl=`，且 error/warn/info 三档字面量齐',
    assets.length >= 1 && declared.length === 1,
    '命中=' + declared.length + '/' + assets.length + '（' + (declared[0] || '无') + '）');
  check('N7 本地补丁已清干净：产物无 `__weLvl` / `-welvl1` 后缀，同步脚本无补丁函数与 `--patches-only`',
    residue.length === 0, residue.length ? residue.join(' | ') : '产物 ' + assets.length + ' 个 + 同步脚本干净');
  // 合成输入用的三档字面量 + 两种上报 URL（带 / 不带 `lvl=`）—— 同一个判据函数。
  const THREE = ' "error" "warn" "info"';
  const HAS_LVL = 'return `${t}/diag?msg=${x}&lvl=${lv}`}';
  check('N7 negative control: 缺 `lvl=` / 缺档位字面量 / 带补丁残留 三种坏形态都会被判出',
    rendererDeclaresLevel('/diag?msg=x' + THREE) === false
    && rendererDeclaresLevel(HAS_LVL + THREE.slice(0, THREE.lastIndexOf(' "info"'))) === false
    && rendererDeclaresLevel(HAS_LVL + THREE) === true
    && localPatchResidue([], 'function applyDiagLevelPatch() {}').length === 1
    && localPatchResidue([], '// applyDiagLevelPatch 曾是补丁\nconst x = 1;').length === 0
    && localPatchResidue([], "const PATCHES_ONLY = process.argv.includes('--patches-only');").length === 1);
}

// ── N7③ 渲染页的绝对引用 / 构建 rig 的 base / 宿主注册前缀，三者必须对齐 ─────────
// 事故形态：`sync-webwallgl.mjs` 用 `--base=<BASE_PATH>/` 构建，产物里的**绝对**资源引用
// （`/wallpaper-engine/scene-live/assets/*`）只有在宿主真把 `${BASE}/scene-live` 注册成路由时
// 才解析得到。三处各写一份字面量、谁都不核谁 ⇒ 改前缀（或改路由名）时产物与路由**静默分叉**，
// 症状是渲染页 404 / 白屏，而所有判据仍然全绿。
// 判据把三方串成一条链：宿主 `BASE`（lib/index.js）→ 宿主注册的 `${BASE}/…` 模板
// （lib/routes/scene-serve.js）→ 产物的绝对引用（lib/webwallgl/index.html）与 rig 的 `BASE_PATH`。
// 纯函数：喂四份源码/产物文本，返回问题清单（正判据与四条负对照都调它）。
const HOST_BASE_RE = /\bconst\s+BASE\s*=\s*'([^']*)'/;
const RIG_BASE_RE = /\bconst\s+BASE_PATH\s*=\s*'([^']*)'/;
const ROUTE_TEMPLATE_RE = /path:\s*`\$\{BASE\}(\/[^`]*)`/g;
const ABS_REF_RE = /(?:src|href)="(\/[^"]*)"/g;

function prefixAlignment(hostSrc, routeSrc, rigSrc, htmlSrc) {
  const problems = [];
  const base = (stripComments(hostSrc).match(HOST_BASE_RE) || [])[1] ?? null;
  const rigBase = (stripComments(rigSrc).match(RIG_BASE_RE) || [])[1] ?? null;
  if (base === null) problems.push("抠不到 lib/index.js 的 `const BASE = '…'`");
  if (rigBase === null) problems.push("抠不到 sync-webwallgl.mjs 的 `const BASE_PATH = '…'`");
  if (base === null || rigBase === null) return problems;
  const routes = new Set([...stripComments(routeSrc).matchAll(ROUTE_TEMPLATE_RE)].map((m) => base + m[1]));
  if (routes.size === 0) problems.push('宿主路由里找不到 `${BASE}/…` 模板（判据无从对齐）');
  const refs = [...htmlSrc.matchAll(ABS_REF_RE)].map((m) => m[1]);
  if (refs.length === 0) problems.push('产物里没有任何绝对引用（这条判据会恒真）');
  // 引用的**前缀** = BASE + 第一段路径：产物只可能被一个前缀服务，rig 也只会构建一个 base。
  const prefixes = new Set(refs.map((r) => base + '/' + r.slice(base.length).replace(/^\//, '').split('/')[0]));
  const unserved = [...prefixes].filter((p) => !routes.has(p));
  if (unserved.length) problems.push('产物引用了宿主没注册的前缀：' + unserved.join(', '));
  if (prefixes.size !== 1) {
    problems.push('产物引用落在多个前缀上（rig 只能构建一个 base）：' + [...prefixes].join(', '));
  } else if (rigBase !== [...prefixes][0]) {
    problems.push('rig 的 BASE_PATH=' + rigBase + ' 与产物的引用前缀不一致（产物在 ' + [...prefixes][0] + '）');
  }
  return problems;
}
{
  const src = {
    host: read('lib/index.js'),
    route: read('lib/routes/scene-serve.js'),
    rig: read('test/tools/sync-webwallgl.mjs'),
    html: read('lib/webwallgl/index.html'),
  };
  const problems = prefixAlignment(src.host, src.route, src.rig, src.html);
  check('N7③ 产物绝对引用 / rig 的 base / 宿主注册前缀三者对齐（分叉 ⇒ 渲染页 404 而判据全绿）',
    problems.length === 0,
    problems.length ? problems.join(' | ')
      : 'BASE=' + ((stripComments(src.host).match(HOST_BASE_RE) || [])[1] || '?')
        + ' · rig=' + ((stripComments(src.rig).match(RIG_BASE_RE) || [])[1] || '?')
        + ' · 产物绝对引用 ' + [...src.html.matchAll(ABS_REF_RE)].length + ' 条都落在注册面上');
  // 负对照：变异喂进**同一条判据**（改 rig 的 base / 改产物引用 / 改宿主 BASE / 字面量抠不到）
  const rigBroken = prefixAlignment(src.host, src.route,
    src.rig.replace("'/wallpaper-engine/scene-live'", "'/wallpaper-engine/scene-files'"), src.html);
  const htmlBroken = prefixAlignment(src.host, src.route, src.rig,
    src.html.replace('/wallpaper-engine/scene-live/assets/', '/wallpaper-engine/oops/assets/'));
  const hostBroken = prefixAlignment(
    src.host.replace("const BASE = '/wallpaper-engine'", "const BASE = '/wp'"), src.route, src.rig, src.html);
  const hostGone = prefixAlignment(
    src.host.replace("const BASE = '/wallpaper-engine'", 'const BASE = process.env.WE_BASE'),
    src.route, src.rig, src.html);
  check('N7③ negative control: 改 rig base / 改产物引用 / 改宿主 BASE / 字面量抠不到 —— 四种坏形态都被判出',
    rigBroken.length > 0 && htmlBroken.length > 0 && hostBroken.length > 0 && hostGone.length > 0,
    [rigBroken, htmlBroken, hostBroken, hostGone].map((p) => p.length).join('/') + ' 处问题');
}

// ── N8 模块级代码不得引用 apply 作用域的 log（真机事故：宿主被杀、DSH 反复重启）──
// 事故形态（2026-10-02 晚·官方壳，崩溃日志原文）：
//   `dsh: fatal load failure: ReferenceError: log is not defined at lib/index.js:1235`
// 一个**模块级**助手在失败分支里写了 `log.warn(...)`，而 `log` 只在 `apply()` 体内存在：
// ReferenceError 抛在 catch 里 ⇒ 那个 async 任务以 reject 收场且无人接管 ⇒ Node 24 按
// "未处理拒绝"杀掉宿主进程 ⇒ 壁纸整段时间出不来（用户看到的是"开屏纯色帧 + 切几张后崩溃重启"）。
// 判据：把 `apply` 的函数体**整段抠掉**，剩下的模块级源码里不许再出现 `log.<档位>(`。
const APPLY_HEADERS = ['export function apply(', 'export async function apply(',
  'async function apply(', 'function apply('];
/** apply 的函数体（大括号配对）；定位不到返回 null（判据必须因此变红，而不是假装通过）。 */
function applyBody(src) {
  for (const h of APPLY_HEADERS) {
    const body = functionBody(src, h);
    if (body !== null) return body;
  }
  return null;
}
/** 模块级（apply 体之外）的 `log.<档位>(` 自由引用；null = 定位不到 apply 体。 */
function moduleScopeLogRefs(src) {
  const s = stripComments(src);
  const body = applyBody(s);
  if (body === null) return null;
  return [...s.replace(body, '').matchAll(LOG_CALL)].map((m) => m[0]);
}
{
  const refs = moduleScopeLogRefs(read('lib/index.js'));
  check('N8 模块级代码零 `log.<档位>(` 引用（apply 里的 log 在模块级不存在 ⇒ 未处理拒绝会杀掉宿主）',
    refs !== null && refs.length === 0,
    refs === null ? '定位不到 apply 体（判据失效，必须修）'
      : (refs.length ? '命中：' + refs.join(' ') : 'apply 体之外零引用'));
  check('N8 negative control: 模块级的一条 log.warn 会被判出，apply 体之内的一条不会',
    (moduleScopeLogRefs("function f(){ log.warn('x'); }\nexport function apply(ctx){ log.info('y'); }") || []).length === 1
    && (moduleScopeLogRefs("export function apply(ctx){ log.info('y'); }") || []).length === 0
    && moduleScopeLogRefs('// 没有 apply 的文件') === null);
}

// ── 接线在位：两个宿主模块必须真的被入口 import（否则上面六条可以在死代码上全绿）──
const wiredUp = (src) => /from\s*'\.\/log\.js'/.test(src) && /from\s*'\.\/notice\.js'/.test(src)
  && /createNotice\(/.test(src) && consoleCalls(src) === 0;
{
  check('接线在位：lib/index.js 真的 import 并用上了 log.js / notice.js，且自己零 console.*',
    wiredUp(read('lib/index.js')));
  check('接线在位 negative control: 少一个 import 或自己打一行 console 都会被判出',
    wiredUp("import { createLog } from './log.js';\ncreateNotice(") === false
    && wiredUp("import { createLog } from './log.js';\nimport { createNotice } from './notice.js';\ncreateNotice(1);\nconsole.log('x');") === false);
}

// ── R1–R4 运行期行为（直接跑 lib/log.js 与 lib/notice.js 这两个宿主模块）──────
{
  const { createLog } = await import('../lib/log.js');
  const { createNotice } = await import('../lib/notice.js');

  /**
   * 捕获终端输出：`console.warn` / `console.error` 走 stderr，`console.info` 走 stdout ——
   * 两条都要接住，否则"只有 warn 可见"这类判据会假绿。捕获期间**不得**调用 console（会被吞掉），
   * 所以所有测量先攒进结果，恢复流之后再 check。
   */
  function capture(failWith) {
    const out = [];
    const so = process.stdout.write;
    const se = process.stderr.write;
    const patch = (stream, tag) => {
      stream.write = (chunk, ...rest) => {
        out.push(tag + ':' + String(chunk));
        const cb = rest.find((x) => typeof x === 'function');
        if (typeof cb === 'function') cb(failWith || null);
        return true;
      };
    };
    patch(process.stdout, 'out');
    patch(process.stderr, 'err');
    return {
      out,
      restore() { process.stdout.write = so; process.stderr.write = se; },
    };
  }
  function withTTY(value, fn) {
    const had = Object.prototype.hasOwnProperty.call(process.stdout, 'isTTY');
    const before = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true, writable: true });
    try { return fn(); } finally {
      if (had) Object.defineProperty(process.stdout, 'isTTY', { value: before, configurable: true, writable: true });
      else delete process.stdout.isTTY;
    }
  }
  function withEnv(name, value, fn) {
    const before = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    try { return fn(); } finally {
      if (before === undefined) delete process.env[name]; else process.env[name] = before;
    }
  }
  /** 一次镜像测量：返回 [终端行, 平台收到的档位]。 */
  function mirrorLines(level) {
    const platform = [];
    const logger = { error: (m) => platform.push('error:' + m), warn: (m) => platform.push('warn:' + m), info: (m) => platform.push('info:' + m) };
    const log = createLog(logger, 'probe');
    const cap = capture();
    try {
      log.error('E'); log.warn('W'); log.info('I');
    } finally { cap.restore(); }
    return { terminal: cap.out, platform, level };
  }

  const defaultGate = withEnv('DSH_WE_LOG_LEVEL', undefined, () => withTTY(false, () => mirrorLines('default')));
  const infoGate = withEnv('DSH_WE_LOG_LEVEL', 'info', () => mirrorLines('info'));
  const errorGate = withEnv('DSH_WE_LOG_LEVEL', 'error', () => mirrorLines('error'));
  const bogusGate = withEnv('DSH_WE_LOG_LEVEL', 'chatty', () => mirrorLines('chatty'));
  const seen = (r) => r.terminal
    .map((l) => l.replace(/^[a-z]+:\[probe\] /, '').trim())
    .sort().join(',');
  check('R1 `DSH_WE_LOG_LEVEL` 三值真的决定终端镜像哪些档位（默认 warn、非法值按默认）',
    seen(defaultGate) === 'E,W' && seen(infoGate) === 'E,I,W' && seen(errorGate) === 'E'
    && seen(bogusGate) === 'E,W'
    && defaultGate.platform.length === 3,
    'default=' + seen(defaultGate) + ' info=' + seen(infoGate) + ' error=' + seen(errorGate)
      + ' 非法=' + seen(bogusGate) + '（平台通道始终三档全收）');
  check('R1 negative control: 同一个判据能区分三档（判据不是恒真）',
    seen(infoGate) !== seen(defaultGate) && seen(errorGate) !== seen(defaultGate) && seen(infoGate) !== seen(errorGate));

  const noticeRun = (gateValue, tty, failWith, calls = 1) => {
    const logs = [];
    const log = { warn: (m) => logs.push(m), error: (m) => logs.push('ERR' + m), info: (m) => logs.push('INF' + m) };
    const notice = createNotice(log, 'wallpaper-engine');
    const cap = capture(failWith);
    try {
      withTTY(tty, () => withEnv('DSH_WE_NOTICE', gateValue, () => {
        for (let i = 0; i < calls; i++) notice('media-origin', () => 'ok' + i);
      }));
    } finally { cap.restore(); }
    return { terminal: cap.out, logs };
  };
  const forced = noticeRun('1', false, null);
  const silentOff = noticeRun('0', true, null);
  const silentPipe = noticeRun(undefined, false, null);
  const ttyOn = noticeRun(undefined, true, null);
  const twice = noticeRun('1', false, null, 3);
  const failedSync = (() => {
    const logs = [];
    const log = { warn: (m) => logs.push(m) };
    const notice = createNotice(log, 'wallpaper-engine');
    const so = process.stdout.write;
    process.stdout.write = () => { throw new Error('EPIPE'); };
    try { withEnv('DSH_WE_NOTICE', '1', () => notice('scene-ready', 'x')); } finally { process.stdout.write = so; }
    return logs;
  })();
  const failedCallback = (() => {
    const logs = [];
    const log = { warn: (m) => logs.push(m) };
    const notice = createNotice(log, 'wallpaper-engine');
    const cap = capture(new Error('EPIPE'));
    try { withEnv('DSH_WE_NOTICE', '1', () => notice('scene-ready', 'x')); } finally { cap.restore(); }
    return logs;
  })();
  const isNotice = (r) => r.terminal.filter((l) => /^\S*\[wallpaper-engine\] .* ✔\n$/.test(l)).length;
  check('R2 一个 kind 每会话至多一条提示（同一实例内重复调用不再投递）',
    isNotice(forced) === 1 && isNotice(twice) === 1 && twice.terminal.length === forced.terminal.length,
    '一次=' + isNotice(forced) + ' 三次=' + isNotice(twice));
  check('R2 negative control: 换个 kind 会照常投递（幂等键是 kind 而不是"发过了"）',
    isNotice((() => {
      const notice = createNotice({ warn: () => {} }, 'wallpaper-engine');
      const cap = capture();
      try { withEnv('DSH_WE_NOTICE', '1', () => { notice('media-origin', 'a'); notice('scene-ready', 'b'); }); } finally { cap.restore(); }
      return { terminal: cap.out };
    })()) === 2);
  check('R3 `DSH_WE_NOTICE` 三态：`0` 与未设+非 TTY 都静默**且不报**，`1` 强制输出',
    isNotice(forced) === 1 && forced.logs.length === 0
    && forced.terminal.some((l) => l.endsWith('ok0 ✔\n'))
    && isNotice(silentOff) === 0 && silentOff.logs.length === 0 && silentOff.terminal.length === 0
    && isNotice(silentPipe) === 0 && silentPipe.logs.length === 0 && silentPipe.terminal.length === 0
    && isNotice(ttyOn) === 1,
    '强制=' + isNotice(forced) + ' 关=' + isNotice(silentOff) + ' 非TTY=' + isNotice(silentPipe) + ' TTY=' + isNotice(ttyOn));
  check('R3 提示行与日志行同形：`[<name>] <文案> ✔`（前缀同名、`✔` 在后）',
    forced.terminal.length === 1 && forced.terminal[0] === 'out:[wallpaper-engine] ok0 ✔\n',
    JSON.stringify(forced.terminal));
  check('R3 negative control: 旧的 `✔ <文案>` 形状不再被认作提示行',
    isNotice({ terminal: ['out:✔ ok0\n'] }) === 0 && isNotice({ terminal: ['out:[wallpaper-engine] ok0 ✔\n'] }) === 1);
  // 判据只数投递失败次数，不断文案（`/投递失败/` 抄自 `lib/notice.js:56`，改名会假红）。
  check('R4 投递失败（同步抛错 / 回调 err）恰好一条 warn，成功路径零日志',
    failedSync.length === 1 && failedCallback.length === 1
    && forced.logs.length === 0 && ttyOn.logs.length === 0,
    '同步=' + failedSync.length + ' 回调=' + failedCallback.length + ' 成功路径=' + forced.logs.length);
  check('R4 negative control: 投递成功的三条路径都没有日志（判据不是"只要有日志就算"）',
    forced.logs.length === 0 && silentOff.logs.length === 0 && silentPipe.logs.length === 0
    && failedSync.length > 0);

  // ── R5 宿主侧分流（真的跑一遍 registerDiagRoutes）──────────────────────────
  // §2.2 的失败模式表与 §3.4 的 `/client-diag` 分流都只在**路由处理器内部**，静态看不出来。
  {
    const { registerDiagRoutes } = await import('../lib/routes/diag.js');
    const { EventEmitter } = await import('node:events');
    const routes = [];
    const diagLines = [];
    const platformLevels = [];
    const notices = [];
    const logger = {
      error: (m) => platformLevels.push('error:' + m),
      warn: (m) => platformLevels.push('warn:' + m),
      info: (m) => platformLevels.push('info:' + m),
    };
    const log = createLog(logger, 'wallpaper-engine');
    registerDiagRoutes(
      { register: (entry) => { routes.push(entry); return () => {}; } },
      {
        disposers: [],
        appendDiagLine: (kind, obj) => diagLines.push(kind + ':' + JSON.stringify(obj)),
        base: '/wallpaper-engine',
        log,
        notice: (kind) => notices.push(kind),
      },
    );
    const mkRes = () => {
      const res = new EventEmitter();
      res.setHeader = () => {};
      res.end = () => {};
      res.statusCode = 200;
      return res;
    };
    const getDiag = (query) => {
      const route = routes.find((r) => r.path === '/diag');
      getDiagRes = mkRes();
      route.handler({ method: 'GET', url: '/diag?' + query, headers: {} }, getDiagRes);
    };
    let getDiagRes = null;
    const postClientDiag = (body, size = 0) => {
      const route = routes.find((r) => r.path === '/wallpaper-engine/client-diag');
      const req = new EventEmitter();
      req.method = 'POST';
      req.url = '/wallpaper-engine/client-diag';
      req.headers = {};
      const res = mkRes();
      route.handler(req, res);
      if (size > 64 * 1024) req.emit('data', Buffer.alloc(size));
      else req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
      return res;
    };
    const shortLvl = () => platformLevels.map((l) => l.slice(0, l.indexOf(':')));

    // 整段测量都在捕获里跑：这条链路的终端镜像会真的写 stderr，不该污染守卫自己的输出。
    const cap = capture();
    let rendererLevels;
    let rendererLines;
    let okStatus;
    let noNoticeForWeb;
    let otherEventStatus;
    let badMethod;
    let tooBig;
    let clientLines;
    try {
      withTTY(false, () => withEnv('DSH_WE_LOG_LEVEL', 'warn', () => withEnv('DSH_WE_NOTICE', undefined, () => {
        getDiag('msg=' + encodeURIComponent('reload 失败'));
        getDiag('msg=' + encodeURIComponent('tex 12'));
        getDiag('msg=' + encodeURIComponent('tex 13') + '&lvl=warn');
        getDiag('msg=' + encodeURIComponent('tex 14') + '&lvl=bogus');
        getDiag('msg=' + encodeURIComponent('tex 15') + '&lvl=info');
        // 零失败的完成行与"词内 ERR"都不算问题（否则纯统计行会把终端刷出噪音）。
        getDiag('msg=' + encodeURIComponent('bake: 后台补烘完成 0 张（失败 0，产物 0.0MB，耗时 0ms）'));
        getDiag('msg=' + encodeURIComponent('tex TERRAIN 512'));
        getDiag('msg=' + encodeURIComponent('bake: 后台补烘完成 2 张（失败 1，产物 1.2MB）'));
      })));
      rendererLevels = shortLvl();
      rendererLines = diagLines.slice();
      platformLevels.length = 0;
      diagLines.length = 0;
      okStatus = postClientDiag({ event: 'live-ready', type: 'scene', id: 'w1', detail: 'firstFrame ok' }).statusCode;
      noNoticeForWeb = postClientDiag({ event: 'live-ready', type: 'web', id: 'w2' }).statusCode;
      otherEventStatus = postClientDiag({ event: 'live-build', type: 'scene', id: 'w3' }).statusCode;
      badMethod = (() => {
        const route = routes.find((r) => r.path === '/wallpaper-engine/client-diag');
        const req = new EventEmitter();
        req.method = 'GET';
        req.url = '/wallpaper-engine/client-diag';
        req.headers = {};
        const res = mkRes();
        route.handler(req, res);
        return res.statusCode;
      })();
      tooBig = postClientDiag({ event: 'x' }, 65 * 1024).statusCode;
      clientLines = diagLines.slice();
    } finally { cap.restore(); }

    check('R5 `/diag` 按失败模式表分档：失败类 ⇒ warn，其余 ⇒ info；`&lvl=` 三档优先、未知回落模式表',
      rendererLevels.join(',') === 'warn,info,warn,info,info,info,info,warn'
      && rendererLines.length === 8 && rendererLines.every((l) => l.startsWith('renderer:')),
      '档位=' + rendererLevels.join(',') + ' 落盘=' + rendererLines.length + ' 条（落盘与分级互不影响）');
    check('R5 `/client-diag` 的 `live-ready`+`scene` 走提示通道，且只此一条',
      notices.length === 1 && notices[0] === 'scene-ready' && okStatus === 204
      && noNoticeForWeb === 204 && otherEventStatus === 204
      && clientLines.length === 3 && clientLines.every((l) => l.startsWith('client:')),
      '提示=' + JSON.stringify(notices) + '；落盘 ' + clientLines.length + ' 条（网页类型 / 其它事件都不触发提示）');
    check('R5 三条早退不变：非 POST ⇒ 405、超 64KB ⇒ 413（且都不落盘、不提示）',
      badMethod === 405 && tooBig === 413 && notices.length === 1,
      '405=' + badMethod + ' 413=' + tooBig + ' 提示仍为 ' + notices.length);
  }
}

const failed = results.filter((r) => !r).length;
console.log('\n' + (failed ? 'LOGGING FAIL — ' + failed + ' check(s) failed' : 'ALL LOGGING CHECKS PASSED'));
process.exit(failed ? 1 : 0);
