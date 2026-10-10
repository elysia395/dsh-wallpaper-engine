#!/usr/bin/env node
/**
 * verify-contracts.mjs — **声明出来的契约必须与代码一致**：两类"没人守的契约"归在这里。
 *
 * ① **运行时下限**：`package.json` 的 `engines.node`。宿主代码用了全局 `fetch`（Node ≥18）与
 *    `AbortSignal.timeout`（≥17.3），而这两个 API 缺失时的失败**是被吞掉的**（回落成"没有封面"，
 *    用户永远看不到原因）⇒ 没有 `engines` 时 npm 既不警告也不拒绝，降级是静默的。这里断言：
 *    声明存在，且声明的**最低版本不低于代码真实用到的 API 所要求的下限**。
 *
 * ② **跨半边契约**：同一个词表在浏览器半边与宿主半边各写一份，而两边都由同一个用户操作驱动：
 *    · `BASE`（路径前缀）—— `lib/index.js` 与 `src/api-client.js` 各一份。不一致时**每一条**
 *      客户端请求 404（失败很响，但排查成本高）。
 *    · **上传 MIME** —— 客户端 `UPLOAD_TYPES` / 自定义画面的 accept 列表 vs 宿主 `UPLOAD_EXT` /
 *      `CUSTOM_FRAME_EXT`。不一致时选择器会收下一个宿主映射不出扩展名的文件 ⇒ **静默失败**。
 *
 * 口径（都是"读两边源码比对"）：**不是** import 一边再与自己比 —— 那对"两边一致"是同源比较，
 * 永远为真。这条口径对一切"镜像声明"都成立（设置键、路径前缀、MIME 表）。
 *
 * 每条断言都配一条负对照（把坏输入喂给**同一个**判据函数并断言它判坏），并带覆盖断言
 * （集合必须非空 —— 否则"两个空集相等"会让相等断言恒真）。退出码 0/1。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
/** 集合相等（用于词表比对）。 */
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
const uniq = (xs) => [...new Set(xs)];
/** 从一个 JS 字面量串里抠出所有带引号的字符串。 */
const quoted = (s) => [...s.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);

// ── ① 运行时下限 ────────────────────────────────────────────────────────────
console.log('\n① 运行时下限（engines 与代码真实用到的 API 对齐）');

/** 代码里真正用到的、有最低 Node 版本要求的 API → 所需最低版本。 */
const API_FLOORS = [
  { name: 'global fetch', re: /(^|[^.\w$])fetch\s*\(/gm, since: 18 },
  { name: 'AbortSignal.timeout', re: /AbortSignal\.timeout\s*\(/g, since: 17.3 },
];

/** 扫一份源码，返回它要求的最低 Node 版本（没有命中则 0）。 */
function requiredFloor(src) {
  let floor = 0;
  for (const api of API_FLOORS) {
    api.re.lastIndex = 0;
    if (api.re.test(src)) floor = Math.max(floor, api.since);
  }
  return floor;
}
/** 从一个 semver range 里取"最低被提到的版本"（`>=18` → 18；`^22.19.0 || >=24` → 22.19）。 */
function rangeFloor(range) {
  const nums = [...String(range).matchAll(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/g)]
    .map((m) => Number(m[1]) + (m[2] ? Number('0.' + m[2]) : 0));
  return nums.length ? Math.min(...nums) : 0;
}

const pkg = JSON.parse(read('package.json'));
/** 声明里是否给出了 node 下限（同一个判据也用于负对照）。 */
const hasNodeEngine = (p) => Boolean(p && p.engines && p.engines.node);
{
  // 只扫会被发布的宿主代码（浏览器半边不跑在 Node 上，不能拿它推下限）
  const hostSrc = ['lib/index.js', 'lib/media/legacy.js', 'lib/media/index.js', 'lib/media/supervisor.js']
    .map((f) => { try { return read(f); } catch { return ''; } }).join('\n');
  const need = requiredFloor(hostSrc);
  const declared = pkg.engines && pkg.engines.node;
  check('宿主代码里确实用到了有版本要求的 API（判据非空转）', need >= 18,
    '推导出的下限 = ' + need);
  check('package.json 声明了 engines.node', hasNodeEngine(pkg), declared ? String(declared) : '缺失');
  check('声明的下限不低于代码真实下限', declared ? rangeFloor(declared) >= need : false,
    '声明 ' + declared + ' → ' + (declared ? rangeFloor(declared) : '?') + ' / 需要 ' + need);

  // 负对照：把坏输入喂给**同一个**判据
  check('negative control: 过低的声明会被判不合格', rangeFloor('>=16') < need);
  check('negative control: 缺失声明会被判不合格',
    hasNodeEngine({}) === false && hasNodeEngine({ engines: {} }) === false && hasNodeEngine(pkg) === true);
  check('negative control: 不含版本要求的源码推导出 0（证明判据依赖真实命中）',
    requiredFloor('const x = 1; function f() {}') === 0);
}

// ── ② 跨半边契约 ────────────────────────────────────────────────────────────
console.log('\n② 跨半边契约（读两边源码比对，不是 import 一边自己比）');

/** `BASE` 的单一字面量。 */
function baseOf(src) {
  const m = /const\s+BASE\s*=\s*['"]([^'"]+)['"]/.exec(src);
  return m ? m[1] : null;
}
/** `const NAME = { 'mime': 'ext', … }` 的键集合。 */
function hostMimeKeys(src, name) {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*\\{([^}]*)\\}').exec(src);
  if (!m) return null;
  return uniq([...m[1].matchAll(/['"]([^'"]+)['"]\s*:/g)].map((x) => x[1]));
}
/** 客户端 `const NAME = ["mime", …]`。 */
function clientMimeList(src, name) {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(src);
  return m ? uniq(quoted(m[1])) : null;
}
/** 客户端所有 `accept: "a,b,c"` 列表（面板模块造选择器时写的那个选项）。 */
function acceptLists(src) {
  return [...src.matchAll(/accept:\s*['"]([^'"]+)['"]/g)]
    .map((m) => uniq(m[1].split(',').map((s) => s.trim()).filter(Boolean)));
}
/** 客户端**选图腿自己写下的赋值点** `input.accept = "a,b,c"`（`src/client.js` 的 pickImageFile）。 */
function acceptAssignments(src) {
  return [...src.matchAll(/input\.accept\s*=\s*['"]([^'"]+)['"]/g)]
    .map((m) => uniq(m[1].split(',').map((s) => s.trim()).filter(Boolean)));
}
/** 负对照用的变异体：把每个 `input.accept` 清单**砍掉最后一项**。 */
function weakenedAcceptAssignments(src) {
  return String(src).replace(/(input\.accept\s*=\s*)['"]([^'"]+)['"]/g,
    (_, head, list) => head + '"' + list.split(',').slice(0, -1).join(',') + '"');
}

const hostSrc = read('lib/index.js');
const apiSrc = read('src/api-client.js');
const clientSrc = read('src/client.js');
const tabsSrc = read('src/panel-tabs.js');

{
  const a = baseOf(hostSrc);
  const b = baseOf(apiSrc);
  check('BASE 两边都能解析出字面量（判据非空转）', Boolean(a) && Boolean(b), 'host=' + a + ' client=' + b);
  check('BASE 两侧一致', a !== null && a === b, a + ' vs ' + b);
  // 负对照：把不一致的输入喂给同一个比较
  check('negative control: BASE 不一致会被判出',
    baseOf("const BASE = '/a';") !== baseOf("const BASE = '/b';"));
}

{
  const clientUp = clientMimeList(clientSrc, 'UPLOAD_TYPES');
  const hostUp = hostMimeKeys(hostSrc, 'UPLOAD_EXT');
  const clientFrame = acceptLists(tabsSrc);
  const hostFrame = hostMimeKeys(hostSrc, 'CUSTOM_FRAME_EXT');

  // 覆盖断言：两个集合都必须非空 —— 否则"两个空集相等"会让下面的相等断言恒真
  check('上传 MIME：两侧都解析出非空集合（判据非空转）',
    Boolean(clientUp && clientUp.length >= 3) && Boolean(hostUp && hostUp.length >= 3),
    'client=' + (clientUp || []).length + ' host=' + (hostUp || []).length);
  check('上传 MIME：客户端 UPLOAD_TYPES 与宿主 UPLOAD_EXT 键集一致',
    Boolean(clientUp && hostUp) && sameSet(clientUp, hostUp),
    (clientUp || []).join(',') + ' vs ' + (hostUp || []).join(','));

  const match = clientFrame.find((l) => hostFrame && sameSet(l, hostFrame));
  check('自定义画面 MIME：客户端有一个 accept 列表与宿主 CUSTOM_FRAME_EXT 键集一致',
    Boolean(hostFrame && hostFrame.length >= 3) && Boolean(match),
    'host=' + (hostFrame || []).join(',') + ' client=' + clientFrame.map((l) => l.join(',')).join(' | '));

  // 自定义会话头像（「扩展」页签一号模块）与吉祥物立绘（「系统」页签 · 聊天吉祥物）走的是
  // **同一条选图腿**（`src/client.js` 的 pickImageFile），也就是说客户端那一份 accept 只写在
  // 一个地方：`input.accept = "…"`（`src/client.js:3307`）。判据必须锚在**这条腿自己写下的那一行**上
  // ——先前三条 check 共用从 `src/panel-tabs.js` 抄来的同一份清单，选图腿漂了它也照样绿。
  // 宿主那边是 lib/index.js 的 AVATAR_EXT / MASCOT_EXT；不一致的失效模式同自定义画面：
  // 选择器收得下、宿主判 415（静默失败）。
  const clientAccept = acceptAssignments(clientSrc);
  /** 某个客户端赋值点里是否存在与宿主表一致的 accept 列表（正判据与负对照共用这一条）。 */
  const acceptCovers = (lists, hostTable) =>
    Boolean(hostTable && hostTable.length >= 3) && lists.some((l) => sameSet(l, hostTable));
  check('覆盖面：选图腿确实写下了 input.accept 赋值点（抽取器退化 ⇒ 当场红，不静默恒真）',
    clientAccept.length >= 1, '赋值点=' + clientAccept.map((l) => l.join(',')).join(' | ') || '(没抽到)');

  const hostAvatar = hostMimeKeys(hostSrc, 'AVATAR_EXT');
  check('会话头像 MIME：客户端选图腿自己的 input.accept 与宿主 AVATAR_EXT 键集一致',
    acceptCovers(clientAccept, hostAvatar),
    'host=' + (hostAvatar || []).join(',') + ' client=' + clientAccept.map((l) => l.join(',')).join(' | '));

  const hostMascot = hostMimeKeys(hostSrc, 'MASCOT_EXT');
  check('吉祥物立绘 MIME：客户端选图腿自己的 input.accept 与宿主 MASCOT_EXT 键集一致',
    acceptCovers(clientAccept, hostMascot),
    'host=' + (hostMascot || []).join(',') + ' client=' + clientAccept.map((l) => l.join(',')).join(' | '));

  // 吉祥物**显示盒上限**的单源契约：`MASCOT_BOX_MAX_W/H` 只住在 lib/settings-schema.js
  // （`mascotBox` 档用它限量级），客户端上传腿与 ropeArtOf 经构建期内联引用同一对 ——
  // 谁要是本地重声明一份，sanitize 拦得住的值渲染层照样画出来 ⇒ 两处迟早漂。
  const schemaSrc = read('lib/settings-schema.js');
  const boxSingleSource = (schemaText, clientText) =>
    [...schemaText.matchAll(/MASCOT_BOX_MAX_[WH]\s*=\s*(\d+)/g)].length === 2
    && !/const\s+MASCOT_BOX_MAX_W\b/.test(clientText)
    && /MASCOT_BOX_MAX_W/.test(clientText);
  check('吉祥物显示盒上限：schema 是唯一真源（一对常量在 schema、client 只引用不重声明）',
    boxSingleSource(schemaSrc, clientSrc));
  check('negative control: client 本地重声明盒上限即判红',
    !boxSingleSource(schemaSrc, clientSrc + '\nconst MASCOT_BOX_MAX_W = 999;'));
  check('negative control: schema 丢了上限常量即判红',
    !boxSingleSource(schemaSrc.replace(/MASCOT_BOX_MAX_H\s*=\s*192;/, ''), clientSrc));

  // 负对照：喂给同一个比较
  check('negative control: 上传 MIME 单边加一种类型会被判出',
    !sameSet(['image/jpeg', 'image/png', 'video/mp4', 'image/webp'], ['image/jpeg', 'image/png', 'video/mp4']));
  check('negative control: 自定义画面 accept 少一种会被判出',
    !sameSet(['image/png', 'image/jpeg'], ['image/jpeg', 'image/png', 'image/webp']));
  // 负对照：把**变异过的客户端源码**喂进同一条判据 —— 选图腿的 accept 各砍掉最后一项，
  // 头像与立绘两条契约都必须判坏；空域同样必须判坏（否则判据可能只是"没有可比列表"恒真）。
  const weakenedClient = weakenedAcceptAssignments(clientSrc);
  check('negative control: 客户端选图腿少写一种 MIME（或域被抽空）会被判出',
    !acceptCovers(acceptAssignments(weakenedClient), hostAvatar)
    && !acceptCovers(acceptAssignments(weakenedClient), hostMascot)
    && !acceptCovers([], hostAvatar));
}

{
  // 会话头像路由（lib/routes/avatar.js）的形态判据。它跟另两条收体路由的关键差别是
  // **不走流式落盘**：上限只有 8MB（客户端导入前已按 512px 缩过一轮）⇒ 走共享读体器 +
  // 原子落盘，内联收集器那条棘轮因此不增（见 test/verify-body-caps.mjs 的两条棘轮）。
  const routeSrc = read('lib/routes/avatar.js');
  const hostNow = read('lib/index.js');
  // `const json = (code, payload) => sendJson(res, code, payload);` —— 恰好**三个**实参 ⇒ 走共享实现的
  // 默认 `no-store`。四参形态（`sendJson(res, code, payload, null)` 之类）**不**匹配：那等于把这条
  // 错误路径改回可缓存，正是本判据要挡的（`no-store` 的唯一落点是 lib/json-response.js）。
  const THIN_JSON_ALIAS = /=>\s*sendJson\(res,\s*[^,()]+,\s*[^,()]+\)\s*;/;
  check('头像路由：只认两个 side（路径段当白名单查，不拼进文件名）',
    /AVATAR_SIDES\.includes\(side\)/.test(routeSrc) && /AVATAR_SIDES = \['user', 'ai'\]/.test(hostNow));
  check('头像路由：收体走共享读体器 + 原子落盘（不是第三个流式豁免）',
    // ⚠️ 这条判据的**字面量形状**有讲究：verify-package-files 的 P5 会扫本文件里的 import 规格，
    // 写成一个带引号的 `from '…/http-body.js'` 会被它当成裸包名（转义后的 `\.\.` 不以点开头）
    // ⇒ 这里用 `\s+['"]…['"]` 形态描述那条 import（探测器的 `from\s+` 匹配不到它）。
    /import\s*\{[^}]*bodyReader[^}]*\}\s+from\s+['"]\.\.\/http-body\.js['"]/.test(routeSrc)
    && /bodyReader\(req, \{/.test(routeSrc) && /maxBytes: AVATAR_MAX_BYTES/.test(routeSrc)
    && /atomicWriteFileP\(join\(dir, name\), body\)/.test(routeSrc));
  check('头像路由：换图即清兄弟（同 side 的旧文件先删，否则屏上还是旧图）',
    /name\.slice\(0, side\.length \+ 1\) !== side \+ '-'/.test(routeSrc)
    && /unlinkSync\(join\(dir, name\)\)/.test(routeSrc));
  check('头像路由：文件名带时间戳 + 长缓存由文件名担保 · 未导入 404 且 no-store',
    /avatarStamp\(\)/.test(routeSrc)
    && /'Cache-Control', 'private, max-age=31536000, immutable'/.test(routeSrc)
    && /json\(404, \{ error: 'not-set' \}\)/.test(routeSrc)
    && THIN_JSON_ALIAS.test(routeSrc));
  // 头像目录与壁纸资产分家：不写 overrides（那是"某个壁纸的画面"）、不写 uploads（会污染库存）。
  check('头像落在插件数据目录的 avatars/ 且上限 8MB（不进 overrides / uploads）',
    /function avatarDir\(\) \{ return ensureDirOnce\(join\(pluginDataDir\(\), 'avatars'\)\); \}/.test(hostNow)
    && /AVATAR_MAX_BYTES = 8 \* 1024 \* 1024/.test(hostNow));

  // 吉祥物立绘族（lib/routes/mascot.js）：与头像同形，但**只有一张**（导入即覆盖）。
  const mascotRouteSrc = read('lib/routes/mascot.js');
  check('立绘路由：形态与头像同族（共享读体器 + 原子落盘，不是新的流式豁免）',
    // ⚠️ 与头像那条同一个理由：写成一个带引号的 `from '…/http-body.js'` 会被 verify-package-files
    //    的 P5 当成裸包名（转义后的 `\.\.` 不以点开头）⇒ 用 `\s+['"]…['"]` 形态描述它。
    /import\s*\{[^}]*bodyReader[^}]*\}\s+from\s+['"]\.\.\/http-body\.js['"]/.test(mascotRouteSrc)
    && /bodyReader\(req, \{/.test(mascotRouteSrc) && /maxBytes: MASCOT_MAX_BYTES/.test(mascotRouteSrc)
    && /atomicWriteFileP\(join\(dir, name\), body\)/.test(mascotRouteSrc));
  check('立绘路由：**只有一张**（导入前清同族旧文件 ⇒ 再导入即覆盖）',
    /name\.slice\(0, 'mascot-'\.length\) !== 'mascot-'/.test(mascotRouteSrc)
    && /unlinkSync\(join\(dir, name\)\)/.test(mascotRouteSrc));
  check('立绘路由：文件名带时间戳 + 长缓存由文件名担保 · 未导入 404 且 no-store',
    /mascotStamp\(\)/.test(mascotRouteSrc)
    && /'Cache-Control', 'private, max-age=31536000, immutable'/.test(mascotRouteSrc)
    && /json\(404, \{ error: 'not-set' \}\)/.test(mascotRouteSrc)
    && THIN_JSON_ALIAS.test(mascotRouteSrc));
  check('立绘落在插件数据目录的 mascot/ 且上限 8MB（不进 overrides / uploads）',
    /function mascotDir\(\) \{ return ensureDirOnce\(join\(pluginDataDir\(\), 'mascot'\)\); \}/.test(hostNow)
    && /MASCOT_MAX_BYTES = 8 \* 1024 \* 1024/.test(hostNow)
    && /const MASCOT_FILE_RE = \/\^mascot-\[a-z0-9\]\{4,16\}/.test(hostNow));
}

{
  // F3 阶段 4：字体集文件的"能读什么"由**同一个 `$schema`** 定义 —— 客户端拿它做本地预检
  // （给一句可判定文案），宿主拿它做权威校验。两边必须引用**同一个常量**，谁也不许手抄字面量
  // （手抄就会漂：客户端放行、宿主拒收，反之亦然 —— 那是最难查的一类"看起来没反应"）。
  const kernel = read('lib/settings-schema.js');
  const storeSrc = read('src/fontset-store.js');
  const editorSrc = read('src/fontset-editor.js');
  const routeSrc = read('lib/routes/fontsets.js');
  const tag = /const\s+FONTSET_SCHEMA_TAG\s*=\s*'([^']+)'\s*\+\s*FONTSET_SCHEMA_VERSION/.exec(kernel);
  check('版本标记 = 前缀 + 版本常量，且定义在共享内核（判据非空转）',
    Boolean(tag) && /const\s+FONTSET_SCHEMA_VERSION\s*=\s*\d+/.test(kernel), tag ? tag[1] + 'N' : '(没解析到)');
  // 字面量只许出现在共享内核：其余会 import 的两半都只能写常量名。
  const literalSites = ['lib/index.js', 'lib/routes/fontsets.js', 'src/fontset-store.js',
    'src/fontset-editor.js', 'src/client.js', 'src/api-client.js']
    .filter((f) => /dsh-we\/fontset@/.test(read(f)));
  check('字体集的版本字面量只出现在共享内核（两半都引用常量名，不手抄）',
    literalSites.length === 0, literalSites.join(',') || '零处手抄');
  check('客户端预检与宿主校验用的是同一个常量名',
    /FONTSET_SCHEMA_TAG/.test(storeSrc) && /FONTSET_SCHEMA_TAG/.test(routeSrc));
  check('导入走宿主那条路由（客户端 POST 到 /fontsets/import）',
    /fontSetsUrl\(\)\s*\+\s*"\/import"/.test(storeSrc),
    '客户端侧路由拼接');
  check('导入入口的 accept 只提示 .json（真正的门是 $schema，不是扩展名）',
    /accept:\s*"\.json,application\/json"/.test(editorSrc) && /\.json/.test(editorSrc));
  // 负对照：同一判据对"某处手抄了版本字面量"有牙
  check('negative control: 手抄的版本字面量会被判出',
    /dsh-we\/fontset@/.test("const X = 'dsh-we/fontset@1';") && !/dsh-we\/fontset@/.test('const X = FONTSET_SCHEMA_TAG;'));
}

{
  // ── ③ 无头浏览器启动口径：每个 `--headless=new` 启动点都必须带 `--use-mock-keychain` ──
  // 为什么值得一条判据：macOS 上不给这个开关，Chromium 系（实测 Edge）会去**碰真钥匙串**
  // 并弹「找不到用于存储"…"的钥匙串」对话框 —— 它打断的是**跑测的人**，对断言毫无影响，
  // 于是会在没人看着的时候被顺手删掉（本仓实测两处漏带：compat-harness-pages 与
  // tools/diagnose-web-blank，病根正是"没有一个判据守着每个启动点"）。
  // 判据按**启动参数数组**判（从 `--headless=new` 到该数组的收尾方括号），不按行号/文件名单，
  // 新加的启动点自动被覆盖。其他平台该开关无害；win32 CI 无水可摸，传了是空操作。
  // 为什么放硬档（它不是"用户会撞上"的那一类）：漏带只打断本地跑测的人，但后果是
  // 「真跑被系统弹窗打断」+「有人把这条红当成噪音去放宽别的判据」；修复成本是一个词，
  // 静态判据零抖动，所以宁可拦住。它不是守散文的判据（ADR-0006 的边界：这条读的是代码）。
  const SCAN = ['test/compat-harness-pages.mjs', 'test/e2e-web-media-origin.mjs',
    'test/tools/diagnose-web-blank.mjs', 'test/tools/underlay-pixel-rig.mjs',
    'test/tools/sidebar-props-scroll-rig.mjs'];
  /** 抠出每个 headless 启动点所在的参数数组文本（从该处到最近的 `]`）。 */
  const launchSites = (src) => {
    const out = [];
    let from = 0;
    for (;;) {
      const at = src.indexOf('--headless=new', from);
      if (at < 0) break;
      from = at + 1;
      const end = src.indexOf(']', at);
      out.push(src.slice(at, end < 0 ? src.length : end));
    }
    return out;
  };
  const missing = [];
  let sites = 0;
  for (const f of SCAN) {
    const found = launchSites(read(f));
    sites += found.length;
    for (const s of found) if (!s.includes('--use-mock-keychain')) missing.push(f + '(' + s.slice(0, 40).replace(/\s+/g, ' ') + '…)');
  }
  check('每个无头浏览器启动点都带 --use-mock-keychain（macOS 弹真钥匙串会打断跑测的人）',
    sites > 0 && missing.length === 0,
    sites + ' 处启动点 · 漏带=' + missing.length + (missing.length ? ' · ' + missing.join(' | ') : ''));
  // 负对照：同一判据对"漏带"有牙（喂一段没有该开关的启动数组，必须判坏）。
  check('negative control: 漏带开关的启动数组会被判出',
    launchSites("spawn(b, ['--headless=new', '--enable-unsafe-swiftshader', '--no-ping']);")
      .some((s) => !s.includes('--use-mock-keychain'))
    && !launchSites("spawn(b, ['--headless=new', '--use-mock-keychain']);")
      .some((s) => !s.includes('--use-mock-keychain')));
}

// ── ④ CI 必须同时跑 Windows 与 POSIX 两条腿 ──────────────────────────────────
// 为什么这是**契约**而不是配置偏好：守卫里有平台条件分支，而两半各在不同的平台上才有牙 ——
//   · `verify-scene` 的 unlink 失败用例：**只有 POSIX 的 chmod 能阻止 unlink**（Windows 上
//     模式位基本被忽略）⇒ POSIX 那半（500 unlink-failed / 帧仍在盘上 / 重试可用 …）在 win32
//     上不执行，而 win32 那半（ENOENT 幂等）在 POSIX 上不执行；
//   · `verify-scene-live` 的目录链接按平台建 junction / dir；
//   · `verify-media-bridge` 有一处 win32 专用断言。
// 只跑一个平台 ⇒ 另一半**零覆盖**，而 `verify-scene` 自己会把这件事打印成
// "这是覆盖差异，不是通过"（实测：win32 上 5 条 platform-skipped）。
// ⇒ 判据：`verify.yml` 声明的 runner 集合必须同时含 windows 与 ubuntu/linux。
console.log('\n④ CI 平台矩阵（平台条件分支的两半都要有覆盖）');
{
  const workflow = read('.github/workflows/verify.yml');
  /**
   * 从 workflow 源码取出它**实际会跑**的 runner 集合。
   * 两种形态都要认：`runs-on: <literal>` 与矩阵 `runs-on: ${{ matrix.os }}` + `os: [...]`
   * —— 只认字面量会把矩阵形态误判成"没有 runner"（假红），只认矩阵则会漏掉字面量那种。
   */
  const runnersOf = (text) => {
    const out = new Set();
    for (const m of text.matchAll(/runs-on:\s*([^\n#]+)/g)) {
      const v = m[1].trim();
      if (!v.includes('matrix.')) out.add(v.split(/\s+/)[0]);
    }
    const mu = /runs-on:\s*\$\{\{\s*matrix\.([\w-]+)\s*\}\}/.exec(text);
    if (mu) {
      const m = new RegExp('\\b' + mu[1] + ':\\s*\\[([^\\]]*)\\]').exec(text);
      if (m) for (const x of m[1].split(',')) if (x.trim()) out.add(x.trim().replace(/['"]/g, ''));
    }
    return [...out];
  };
  const runners = runnersOf(workflow);
  const isWindows = (r) => /^windows/i.test(r);
  const isPosix = (r) => /^(ubuntu|linux)/i.test(r);
  check('覆盖断言非空转：真的解析到了 runner 清单', runners.length >= 2, 'runners=' + runners.join(', '));
  check('verify.yml 同时跑 Windows 与 POSIX（平台条件分支的两半都有覆盖）',
    runners.some(isWindows) && runners.some(isPosix), 'runners=' + runners.join(', '));
  // 负对照：字面量与矩阵两种形态都必须在**同一个**判据下判坏。
  check('negative control: 只跑 windows 的字面量 runner 会被判出',
    (() => { const r = runnersOf('runs-on: windows-latest\n'); return r.some(isWindows) && !r.some(isPosix); })());
  check('negative control: 只列一个平台的矩阵会被判出',
    (() => { const r = runnersOf('runs-on: ${{ matrix.os }}\nos: [windows-latest]\n'); return r.some(isWindows) && !r.some(isPosix); })());
  check('negative control: 矩阵形态必须被解析出全部平台（否则上面的"两平台"会假绿）',
    JSON.stringify(runnersOf('runs-on: ${{ matrix.os }}\nos: [windows-latest, ubuntu-latest]\n').sort())
      === JSON.stringify(['ubuntu-latest', 'windows-latest']));
}

// ── ⑤ CI 工作流与 **GitHub 解析器**的契约：工作流级表达式不得引用作业作用域的上下文 ──
// 这是"本地全绿、推上去 0 秒失败且**一个作业都没有**"那一类失败（页面只说
// "This run likely failed because of a workflow file issue"）。实测（2026-10-02）：
//   concurrency:
//     group: verify-${{ github.ref }}-${{ matrix.os }}      ← 工作流级！
// `matrix` 只在**作业**上下文里存在 ⇒ GitHub 在启动阶段就把整个工作流文件判为无效。
// 判据：`jobs:` 之前那一段里不许出现 matrix / strategy / steps / needs / job 这些作业作用域上下文。
console.log('\n⑤ CI 工作流的工作流级表达式（作业作用域上下文不得越界）');
{
  const wfDir = join(ROOT, '.github', 'workflows');
  const files = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  const JOB_SCOPED = ['matrix', 'strategy', 'steps', 'needs', 'job'];
  /** 工作流级（`jobs:` 之前）里被误用的作业作用域上下文；返回 null = 这个文件没有 `jobs:`（交给别的判据）。 */
  const workflowScopeViolations = (text) => {
    const lines = String(text).split(/\r?\n/);
    const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    if (jobsAt < 0) return null;
    const head = lines.slice(0, jobsAt).join('\n');
    const bad = [];
    for (const ctx of JOB_SCOPED) {
      const re = new RegExp('\\$\\{\\{[^}]*\\b' + ctx + '\\.', 'g');
      for (const _ of head.match(re) || []) bad.push(ctx);
    }
    return uniq(bad);
  };
  const offenders = [];
  let matrixAfterJobs = 0;
  for (const f of files) {
    const text = readFileSync(join(wfDir, f), 'utf8');
    const bad = workflowScopeViolations(text);
    if (bad && bad.length) offenders.push(f + '=' + bad.join(','));
    const lines = text.split(/\r?\n/);
    const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
    if (jobsAt >= 0 && /\$\{\{[^}]*\bmatrix\./.test(lines.slice(jobsAt).join('\n'))) matrixAfterJobs++;
  }
  check('工作流级表达式不引用作业作用域上下文（matrix / strategy / steps / needs / job）',
    files.length >= 1 && offenders.length === 0,
    offenders.length ? '命中：' + offenders.join(' ')
      : files.length + ' 个工作流干净（扫描面 = .github/workflows/*.yml）');
  // 反空转地板：判据必须真的在看有内容的文件 —— 至少有一个工作流在 `jobs:` 之后用了 matrix.
  check('覆盖断言非空转：至少一个工作流在 `jobs:` 之后真的用了 matrix.',
    matrixAfterJobs >= 1, 'jobs: 之后出现 matrix. 的工作流数 = ' + matrixAfterJobs);
  // 负对照：同一个判据下，"工作流级写 matrix" 判坏、"作业级写 matrix" 判好。
  check('negative control: 工作流级写 matrix.os 会被判出，写在 jobs: 之后不会',
    (workflowScopeViolations('concurrency:\n  group: x-${{ matrix.os }}\njobs:\n  a:\n    runs-on: ubuntu-latest\n') || []).join(',') === 'matrix'
      && (workflowScopeViolations('jobs:\n  a:\n    concurrency:\n      group: x-${{ matrix.os }}\n') || []).length === 0
      && workflowScopeViolations('on:\n  push:\n') === null);
}

console.log('');
if (failed) { console.log('CONTRACT CHECKS FAILED — ' + failed + ' failed'); process.exit(1); }
console.log('ALL CONTRACT CHECKS PASSED');
