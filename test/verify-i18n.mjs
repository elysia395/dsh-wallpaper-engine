/**
 * verify-i18n.mjs — 插件文案本地化（i18n）的**门禁**。
 *
 * 守的是四件事，缺一条 i18n 就会悄悄退化：
 *   ① **界面零裸中文**：`src/**` 里每条含中文的字符串字面量都必须进 `weT(...)`；带 `${}` 的模板
 *      与 `+` 拼接的碎片**不算**包过（前者 JS 先插值 ⇒ 查不到键；后者是半句话，英文语序对不上）。
 *      例外只有两类，都写死在下面的允许清单里：诊断/日志实参（`liveLog(...)` 等，不进界面）、
 *      纯数据块（`src/styles.js` 的整份样式表 —— 其中的中文全在 CSS 注释里）。
 *   ② **词表双向对账**：`WE_I18N_EN` 的键集 ⇄ 代码里 `weT("…")` 的字面量集合。少一条 = 该处
 *      在英文界面里原样露中文；多一条 = 孤儿键（改了中文原文却没清旧键，翻译白做）。两个方向
 *      都判，且**允许清单不许空转**（每条都必须在源码里真的还有）。
 *   ③ **值纪律**：每条译文非空、不含中文、`{}` 占位符集合与键**逐个相等**（少一个占位符 =
 *      英文句子把数字吞了；多一个 = 永远插不进去）。宿主表（`WE_I18N_HOST_EN`）另判"键必须能在
 *      `lib/**` 里找到同一条字面量"，防凭空造句。
 *   ④ **运行期行为**：在 vm 沙箱里真跑 `src/i18n-copy.js + src/i18n.js`，判
 *      中文=原文 / 英文=词表 / 未知键原样 / `{name}` 插值 / **接上宿主 locale 服务后跟随切换**
 *      （`locale/change` → 译文变、修订号 +1、订阅者被通知）/ 服务缺席时回落默认语言。
 *
 * 为什么要有这个门禁：插件的界面文案是**中文原文即键**（见 `src/i18n.js`），漏包一处不会报错 ——
 * 英文用户只是看到一句中文；漏一条词表也不会报错 —— 那处原样露原文。两者都是"静默降级"，
 * 正是本仓最不想要的失败形态。所以两条都必须在提交前变红。
 *
 * 每条规则都配**负对照**：把合成输入喂给**同一个判据函数**，断言它给出"坏"的裁决 ——
 * 否则解析器一旦静默返回空集，正断言会恒绿。
 *
 * Usage:  node test/verify-i18n.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import { scanCjkStrings, needsTranslation } from './tools/i18n-scan.mjs';
import { stripExportBlocks } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
};

// ══ 允许清单 ═════════════════════════════════════════════════════════════════
// 两类例外，都按"文件 + 形态"登记（不是按内容片段），且**不许空转**：登记项在源码里找不到
// 对应命中就判红（清单过期 = 判据的牙被拔了，本仓对允许清单的既有口径）。

/** 整块纯数据：`src/styles.js` 的样式表模板（其中文只出现在 CSS 注释里，不进界面）。 */
const DATA_BLOCKS = [
  {
    file: 'src/styles.js',
    kind: 'template',
    minLength: 10000,
    why: '整份样式表是纯数据；其内的中文只出现在 CSS 注释（不渲染到界面）',
  },
];

/** 逐条精确值豁免（形如"是数据不是文案"的个别串）。每条都必须写明理由，且必须还在源码里。 */
const VALUE_ALLOW = [
  {
    value: '设置',
    why: '**宿主的**标签候选（src/sidebar-right.js 的 settingsLabelCandidates）：' +
      '这一串要照字面去匹配宿主 DOM，翻译它反而匹配不到（我们的词表里 "设置" 是动词义 "Set"，' +
      '与宿主菜单项的 "Settings" 不是同一个词）。理由见该函数上方注释与 docs/adr/0007。',
  },
  {
    value: '設定',
    why: '同上：繁体中文语言包下宿主的同一个标签，必须照字面匹配。',
  },
  {
    value: '全局设置',
    why: '同上：宿主左栏那颗设置入口实际的标签（实测；比裸 "设置" 多了 "全局" 二字）。' +
      '候选集用包含匹配，所以这一串本身也要照字面在册，否则它会被当成"未包 weT 的中文"。',
  },
];

/** 诊断/日志实参：不进界面的中文（由扫描器按"最内层被调函数"判定，无需登记具体串）。 */
const DIAGNOSTIC_CALLEES_NOTE = 'liveLog / weLog / console.* / log / warn / error / weDiag …（见 test/tools/i18n-scan.mjs）';

// ══ 工具 ═════════════════════════════════════════════════════════════════════

/** 收集一棵目录下的 `.js`（跳过 node_modules / 点开头目录）。 */
function jsFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const p = join(d, entry);
      // 并发写盘（编辑器/子代理的临时文件、原子的 rename 窗口）会让 stat 抛 ENOENT ——
      // 守卫的职责是判定，不该被一次瞬时缺文件打断；跳过即可。
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (p.endsWith('.js')) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * 判据 ①：这些命中**没有**进 `weT(...)`（且不在允许清单里）⇒ 必须被判红。
 * 与生产用法共用同一个 `needsTranslation`（来自扫描器），负对照即喂合成命中。
 */
function nakedCjk(hits, dataBlocks = DATA_BLOCKS, valueAllow = VALUE_ALLOW) {
  const allowedByBlock = (hit) => dataBlocks.some((b) => hit.file.endsWith(b.file)
    && hit.kind === b.kind && hit.value.length >= b.minLength);
  const allowedByValue = new Set(valueAllow.map((v) => v.value));
  return hits.filter((h) => !allowedByBlock(h) && needsTranslation(h, allowedByValue));
}

/** 判据 ①b：包过了、但形态是"半句话"（模板带插值 / `weT(...)` 紧邻 `+`）的位置。 */
function fragmentedCjk(hits, dataBlocks = DATA_BLOCKS) {
  const allowedByBlock = (hit) => dataBlocks.some((b) => hit.file.endsWith(b.file)
    && hit.kind === b.kind && hit.value.length >= b.minLength);
  return hits.filter((h) => !allowedByBlock(h)
    && !h.diagnostic
    && (h.hasInterp || (h.wrapped && h.concatAdjacent)));
}

/** 从 `src/i18n-copy.js` 里切出两块词表（按声明行到其配对的 `};`）。 */
function readCopyBlocks(src) {
  const blocks = {};
  for (const name of ['WE_I18N_EN', 'WE_I18N_HOST_EN']) {
    const at = src.indexOf('const ' + name + ' = {');
    if (at < 0) { blocks[name] = null; continue; }
    const end = src.indexOf('\n};', at);
    blocks[name] = end < 0 ? null : src.slice(at, end + 3);
  }
  return blocks;
}

/**
 * 判据 ②：从词表块里抽键（逐行 `"…": "…",`），并统计重复。
 * 只在**键位**（行首引号 + 冒号）上匹配 ⇒ 值里的引号/冒号不会误判。
 */
function copyKeys(block) {
  if (!block) return { keys: [], duplicates: [] };
  const keys = [];
  const re = /^\s*"((?:[^"\\]|\\.)*)"\s*:/gm;
  let m;
  while ((m = re.exec(block)) !== null) keys.push(JSON.parse('"' + m[1] + '"'));
  const seen = new Set();
  const duplicates = [];
  for (const k of keys) { if (seen.has(k)) duplicates.push(k); seen.add(k); }
  return { keys, duplicates };
}

/** 判据 ③：值纪律（非空 / 无中文 / 占位符集合与键相等）。返回违规描述数组。 */
function valueViolations(entries) {
  const out = [];
  for (const { key, value } of entries) {
    if (typeof value !== 'string' || value.trim() === '') { out.push(key + ' → 空值'); continue; }
    if (/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(value)) {
      out.push(key + ' → 译文里还有中文：' + JSON.stringify(value));
    }
    const ph = (s) => {
      const set = new Set();
      for (const m of String(s).matchAll(/\{(\w+)\}/g)) set.add(m[1]);
      return [...set].sort().join(',');
    };
    const want = ph(key.replace(/^[^\u0000]*\u0000/, ''));
    const got = ph(value);
    if (want !== got) out.push(key + ' → 占位符不一致：键 [' + want + '] vs 值 [' + got + ']');
  }
  return out;
}

/** 从源码里取 `weT("…")` 的字面量集合（去掉上下文前缀后）。 */
function weTCallSites(hits) {
  const out = new Set();
  for (const h of hits) if (h.wrapped && !h.hasInterp) out.add(h.value);
  return out;
}

/** 判据 ⑥ 的判据本体：顶层组件必须各自订阅一次语言（合成输入可测）。 */
function componentsWithoutLocaleHook(sources) {
  return sources.filter((s) => !/useWeLocale\s*\(/.test(s)).map((s) => s.slice(0, 40));
}

// ══ 读源码 ═══════════════════════════════════════════════════════════════════
// **词表模块本身在扫描面之外**：它的中文就是键（`src/i18n.js` 的设计），不是"漏包的界面文案"。
// 排除它必须留牙：下面 ① 里那条"词表里确实还有中文键"的判据钉住这次排除不是空豁免。
const DICT_MODULE = 'src/i18n-copy.js';
const srcFiles = jsFiles(join(ROOT, 'src'));
const srcHits = [];
for (const file of srcFiles) {
  const rel = relative(ROOT, file).split(/[\\/]/).join('/');
  if (rel === DICT_MODULE) continue;
  for (const h of scanCjkStrings(readFileSync(file, 'utf8'))) srcHits.push({ file: rel, ...h });
}
const dictHits = scanCjkStrings(readFileSync(join(ROOT, DICT_MODULE), 'utf8'));
// 宿主文案的取值面：`lib/` 下的全部 `.js`（排除**生成物**与 **vendored** —— 它们不是本仓文案）。
// 路径一律先归一成 `/` 再判（CI 里 Windows 的分隔符会让 `includes('/vendor/')` 静默失效）。
// 本文件里的 glob 不许写成「斜杠紧跟两个星号」：那三个字符会让**朴素剥注释**的实现
// （`/\/\*[\s\S]*?\*\//`，正是 `test/tools/js-text.mjs` 存在的理由）从这里开一个假块注释，
// 一路吃到下面第一条真块注释的结束标记，把中间的真实代码**静默删掉**（实测会丢 9481 个非空白
// 字符，连文件末尾的 `process.exit(failed ? 1 : 0)` 都一起吃掉 ⇒ `audit-guard-teeth` 判据 E 会
// 假报「本文件既无 process.exit 也无 throw」）。本仓生产路径统一走字符串感知的剥注释，
// 这里只是不给下一个"守守卫"的工具留同样的坑。
const libFiles = jsFiles(join(ROOT, 'lib')).filter((f) => {
  const rel = relative(ROOT, f).split(/[\\/]/).join('/');
  return rel !== 'lib/client.js' && !rel.startsWith('lib/vendor/') && !rel.startsWith('lib/webwallgl/');
});
const libValues = new Set();
for (const file of libFiles) {
  for (const h of scanCjkStrings(readFileSync(file, 'utf8'))) libValues.add(h.value);
}

const copySrc = readFileSync(join(ROOT, 'src', 'i18n-copy.js'), 'utf8');
const blocks = readCopyBlocks(copySrc);
const enKeys = copyKeys(blocks.WE_I18N_EN);
const hostKeys = copyKeys(blocks.WE_I18N_HOST_EN);
const callSites = weTCallSites(srcHits);

// ══ ① 界面零裸中文 ═══════════════════════════════════════════════════════════
console.log('① 界面零裸中文（src/ 下，诊断串与纯数据块除外）');
{
  const naked = nakedCjk(srcHits);
  check('每条中文都进了 weT(...)', naked.length === 0,
    naked.length ? naked.length + ' 处未包：' + naked.slice(0, 6)
      .map((h) => h.file + ':' + h.line + ' ' + JSON.stringify(h.value.slice(0, 40))).join(' · ')
      : srcHits.length + ' 条命中，全部合规');

  const frag = fragmentedCjk(srcHits);
  check('无"半句话"位置（模板插值 / weT 拼接）', frag.length === 0,
    frag.length ? frag.length + ' 处：' + frag.slice(0, 6)
      .map((h) => h.file + ':' + h.line + (h.hasInterp ? '(模板)' : '(拼接)') + ' ' + JSON.stringify(h.value.slice(0, 40))).join(' · ')
      : '模板与拼接都改成了占位符整句');

  // 允许清单不许空转：登记的纯数据块必须真的还在源码里（否则判据的牙被拔了）。
  const stale = DATA_BLOCKS.filter((b) => !srcHits.some((h) => h.file.endsWith(b.file)
    && h.kind === b.kind && h.value.length >= b.minLength));
  check('允许清单不空转（纯数据块仍在）', stale.length === 0,
    stale.length ? stale.map((b) => b.file).join(' ') : DATA_BLOCKS.length + ' 条纯数据块在册');
  const staleValues = VALUE_ALLOW.filter((v) => !srcHits.some((h) => h.value === v.value));
  check('允许清单不空转（精确值仍出现）', staleValues.length === 0,
    staleValues.length ? staleValues.map((v) => JSON.stringify(v.value).slice(0, 30)).join(' ') : VALUE_ALLOW.length + ' 条精确值在册');

  // 词表模块的排除必须留牙：它里面必须**真的**还是"中文即键"（而不是被排除后空了）。
  check('词表模块的排除不空转（' + DICT_MODULE + ' 里仍有中文键）',
    dictHits.length > 100 && dictHits.every((h) => h.value.length > 0),
    dictHits.length + ' 条中文键在词表里');

  // 负对照：同一判据必须能给"裸中文 / 半句话"判红。
  const probe = (src, file = 'src/probe.js') => scanCjkStrings(src).map((h) => ({ file, ...h }));
  check('negative control: 裸中文会被判红',
    nakedCjk(probe('x = "中文"')).length === 1
    && nakedCjk(probe('x = weT("中文")')).length === 0);
  check('negative control: 模板插值/拼接会被判红',
    fragmentedCjk(probe('x = weT(`共 ${n} 张`)')).length === 1
    && fragmentedCjk(probe('x = weT("共 ") + n')).length === 1
    && fragmentedCjk(probe('x = weT("共 {n} 张", { n })')).length === 0);
  check('negative control: 纯数据块豁免不是"整文件豁免"',
    nakedCjk(probe('x = "中文"', 'src/styles.js')).length === 1,
    'styles.js 里的小串仍会被判红（豁免看长度/形态，不看文件名）');
}

// ══ ② 词表双向对账 ═══════════════════════════════════════════════════════════
console.log('② 词表双向对账（WE_I18N_EN ⇄ 代码里的 weT 字面量）');
{
  const blockOk = blocks.WE_I18N_EN !== null && blocks.WE_I18N_HOST_EN !== null;
  check('词表两块都在 src/i18n-copy.js 里', blockOk,
    blockOk ? 'WE_I18N_EN=' + enKeys.keys.length + ' 条 · WE_I18N_HOST_EN=' + hostKeys.keys.length + ' 条' : '缺块');

  check('词表内无重复键（JS 对象字面量会静默去重）',
    enKeys.duplicates.length === 0 && hostKeys.duplicates.length === 0,
    enKeys.duplicates.concat(hostKeys.duplicates).slice(0, 5).join(' / ') || '无重复');

  // 正判据与下面两条对照**必须**走同一个具名函数。内联复刻一份判据（例如用自己的 `judge` 顶替，
  // 其 orphan 分支不剥 `^[^\u0000]*\u0000` 上下文前缀）会在生产判据被砸坏时仍全绿。
  const missingKeys = (sites, keys) => [...sites].filter((k) => !keys.includes(k)).sort();
  // 上下文键（`<ctx>\u0000<原文>`）按**原文**对账：它服务的正是同一处 `weT("原文", …)` 调用点。
  const orphanKeys = (sites, keys) => keys
    .filter((k) => !new Set(sites).has(k.replace(/^[^\u0000]*\u0000/, ''))).sort();
  const missing = missingKeys(callSites, enKeys.keys);
  const orphan = orphanKeys(callSites, enKeys.keys);
  check('零漏译（每个 weT 原文都有词条）', missing.length === 0,
    missing.length ? missing.length + ' 条缺：' + missing.slice(0, 6).map((k) => JSON.stringify(k.slice(0, 30))).join(' ') : callSites.size + ' 条对账');
  check('零孤儿键（每条词条都被代码用到）', orphan.length === 0,
    orphan.length ? orphan.length + ' 条多余：' + orphan.slice(0, 6).map((k) => JSON.stringify(k.slice(0, 30))).join(' ') : '词表与调用点一一对应');

  // 负对照：拿**真数据**做变异，喂回上面**同一条**判据 ——
  //   少一条调用点 ⇒ 该词条变成孤儿（生产 orphan 判据必须开火）；
  //   凭空多一条调用点 ⇒ 漏译 1 条；词表多一条 ⇒ 孤儿 1 条。
  const droppedSite = [...callSites][0];
  const mutations = {
    lessSites: [...callSites].slice(1),
    moreSites: [...callSites, '这个词表里没有的合成调用点'],
    moreKeys: enKeys.keys.concat(['这个词表里没有的合成键']),
  };
  const missMore = missingKeys(new Set(mutations.moreSites), enKeys.keys);
  const orphLess = orphanKeys(new Set(mutations.lessSites), enKeys.keys);
  const orphMore = orphanKeys(callSites, mutations.moreKeys);
  check('negative control: 同一条判据对"少一条调用点 / 多一条调用点 / 词表多一条"分别判红（变异的是真数据）',
    callSites.size >= 2 && typeof droppedSite === 'string'
    && orphLess.length >= 1
    && missMore.length === 1 && missMore[0] === '这个词表里没有的合成调用点'
    && orphMore.length === 1 && orphMore[0] === '这个词表里没有的合成键'
    && missing.length === 0 && orphan.length === 0,
    'sites=' + callSites.size + ' · 少一条 ⇒ 孤儿 ' + orphLess.length
      + ' 条（' + JSON.stringify(droppedSite.slice(0, 12)) + ' 那类）· 多一条 ⇒ 漏译 ' + missMore.length
      + ' / 词表多一条 ⇒ 孤儿 ' + orphMore.length);
  // 正对照：上下文后缀键（`<ctx>\u0000<原文>`）按原文对账 —— 同一条 orphan 判据：对得上是 0 条，
  // 把原文改掉（后缀前缀都不剥就会漏判）则必须是 1 条。
  const ctxSites = new Set(['适配']);
  check('positive control: 上下文后缀键按原文对账（与生产 orphan 判据同源）',
    orphanKeys(ctxSites, ['适配', 'adapter\u0000适配']).length === 0
    && orphanKeys(ctxSites, ['adapter\u0000适配别的']).length === 1,
    '一致 ' + orphanKeys(ctxSites, ['适配', 'adapter\u0000适配']).length + ' 条孤儿 / 改写后 '
      + orphanKeys(ctxSites, ['adapter\u0000适配别的']).length + ' 条');
}

// ══ ③ 值纪律 ═════════════════════════════════════════════════════════════════
console.log('③ 值纪律（非空 / 无中文 / 占位符对齐）');
{
  const en = parseCopyEntries(blocks.WE_I18N_EN);
  const violations = valueViolations(en);
  check('WE_I18N_EN 全部合规', violations.length === 0,
    violations.length ? violations.slice(0, 5).join(' · ') : en.length + ' 条');

  check('negative control: 空值/中文残留/占位符缺失都会判红',
    valueViolations([{ key: 'a', value: '' }]).length === 1
    && valueViolations([{ key: 'a', value: '中文' }]).length === 1
    && valueViolations([{ key: '共 {n} 张', value: 'x {m}' }]).length === 1
    && valueViolations([{ key: '共 {n} 张', value: '{n} items' }]).length === 0);
}

// ══ ④ 宿主表对账 ═════════════════════════════════════════════════════════════
console.log('④ 宿主表（WE_I18N_HOST_EN 的键必须来自 lib/ 下的真实字面量）');
{
  const stray = hostKeys.keys.filter((k) => !libValues.has(k.replace(/^[^\u0000]*\u0000/, '')));
  check('零凭空造句（每条键都能在 lib/ 下找到）', stray.length === 0,
    stray.length ? stray.slice(0, 5).map((k) => JSON.stringify(k.slice(0, 40))).join(' · ') : hostKeys.keys.length + ' 条对账');

  const hostEntries = parseCopyEntries(blocks.WE_I18N_HOST_EN);
  const hostViolations = valueViolations(hostEntries);
  check('宿主表值纪律', hostViolations.length === 0,
    hostViolations.length ? hostViolations.slice(0, 5).join(' · ') : hostEntries.length + ' 条');

  // 不许用「库里没有的键会被判红」这类对照：`['不存在的串'].filter((k) => !libValues.has(k))`
  // 对任何不含该字面量的集合都成立（含空集），只是复述 `Array.prototype.filter` 而已；
  // 覆盖点：上游 `stray = hostKeys.keys.filter(…)` 那条判据自身的开火路径
  // （test/verify-i18n.mjs:332-337：`lib/` 抓不到某条宿主键时 stray 非空、当场判红，同一失效模式）。
}

// ══ ⑤ 运行期行为（真跑 i18n 层）══════════════════════════════════════════════
console.log('⑤ 运行期行为（vm 沙箱里跑 src/i18n-copy.js + src/i18n.js）');
{
  const runtime = loadI18nRuntime({ search: '' });
  const enDictSource = runtime.api.WE_I18N_EN || {};
  const first = Object.keys(enDictSource)[0];
  const sample = first || '壁纸模糊';
  const sampleEn = enDictSource[sample];

  check('无服务 + 默认语言 ⇒ 原文（zh 身份）', runtime.api.weT(sample) === sample,
    JSON.stringify(sample.slice(0, 24)));
  check('?we-lang=en ⇒ 走英文词表', loadI18nRuntime({ search: '?we-lang=en' }).api.weT(sample) === sampleEn,
    JSON.stringify(String(sampleEn).slice(0, 40)));
  check('未知键原样返回（渐进式：没译文也不炸）',
    loadI18nRuntime({ search: '?we-lang=en' }).api.weT('这个词表里没有') === '这个词表里没有');

  // 占位符插值：拿词表里**带 {…} 的真词条**跑一遍（没有就说明词表缺参数化文案 ⇒ 判红）
  const withPh = Object.keys(enDictSource).find((k) => /\{\w+\}/.test(k));
  if (withPh) {
    const params = {};
    for (const m of withPh.matchAll(/\{(\w+)\}/g)) params[m[1]] = 7;
    const out = loadI18nRuntime({ search: '?we-lang=en' }).api.weT(withPh, params);
    check('占位符插值（英文，键 ' + JSON.stringify(withPh.slice(0, 24)) + '）',
      !/\{\w+\}/.test(out) && out !== enDictSource[withPh], JSON.stringify(out.slice(0, 60)));
  } else {
    check('占位符插值（英文）', false, '词表里没有带 {name} 的词条 ⇒ 这条判据无从检验（该补一条真词条）');
  }

  // 接上官方 locale 服务：注册两张表 + 跟随切换 + 订阅者被通知 + 卸载退回默认
  const service = createLocaleServiceStub('zh');
  const live = loadI18nRuntime({ search: '', service });
  let notified = 0;
  const off = live.api.weLocaleSubscribe(() => { notified++; });
  check('接入服务：注册了 zh 身份表 + en 词表',
    service.registered.some((r) => r.ns === 'wallpaper-engine' && r.locale === 'zh')
    && service.registered.some((r) => r.ns === 'wallpaper-engine' && r.locale === 'en'),
    service.registered.map((r) => r.locale).join('/') || '未注册');
  const zhDict = (service.dicts['wallpaper-engine'] || {}).zh || {};
  const enDict = (service.dicts['wallpaper-engine'] || {}).en || {};
  check('zh 表是"原文身份"（值 == 原文）',
    Object.keys(zhDict).length > 0 && Object.keys(zhDict).every((k) => zhDict[k] === k.replace(/^[^\u0000]*\u0000/, '')),
    Object.keys(zhDict).length + ' 条');
  // 期望值必须取自**磁盘上的词表原文**（`parseCopyEntries(blocks.…)` 从 `src/i18n-copy.js` 解析），
  // 不能拿被测模块经沙箱交回的 `WE_I18N_EN`：同源意味着模块整段漏合并宿主表也会绿，
  // "含宿主表合并"那一半就从未被断言。
  const enDisk = parseCopyEntries(blocks.WE_I18N_EN);
  const hostDisk = parseCopyEntries(blocks.WE_I18N_HOST_EN);
  const asDict = (entries) => Object.fromEntries(entries.map((e) => [e.key, e.value]));
  // 合并形态照产品实现（`src/i18n.js:197` 的 `Object.assign({}, WE_I18N_EN, WE_I18N_HOST_EN)` ⇒ 宿主表覆盖同名键）。
  const enExpected = Object.assign({}, asDict(enDisk), asDict(hostDisk));
  const diskMismatches = (dict, expected) => Object.keys(expected).filter((k) => dict[k] !== expected[k]);
  const enDictKeys = Object.keys(enDict);
  check('en 表与磁盘词表原文逐条一致（WE_I18N_EN 部分；期望值取自 src/i18n-copy.js 原文）',
    enDisk.length > 0 && enDictKeys.length === Object.keys(enExpected).length
    && diskMismatches(enDict, asDict(enDisk)).length === 0,
    '磁盘 EN ' + enDisk.length + ' 条 / 注册 ' + enDictKeys.length + ' 条');
  check('en 表含宿主表合并（每条宿主键都在注册表里、值取自磁盘原文，不取自被测对象）',
    hostDisk.length > 0 && diskMismatches(enDict, asDict(hostDisk)).length === 0,
    '磁盘 HOST ' + hostDisk.length + ' 条 / 注册 ' + enDictKeys.length + ' 条');
  // 负对照：喂**变异后的期望**给上面**同一对**判据 —— 模块漏合并宿主表、或某条值被改写，都必须判红。
  const enOnly = asDict(enDisk);
  const enFirstKey = Object.keys(enOnly)[0] || '';
  const enMutated = Object.assign({}, enExpected, { [enFirstKey]: '__mutated__' });
  check('negative control: 同一条判据对"漏合并宿主表 / 值被改写"分别判红',
    hostDisk.length > 0 && Object.keys(enOnly).length > 0
    && diskMismatches(enOnly, enExpected).length >= 1
    && diskMismatches(enMutated, enExpected).length >= 1,
    '漏合并 ⇒ ' + diskMismatches(enOnly, enExpected).length + ' 处不一致；改写首键 ⇒ '
      + diskMismatches(enMutated, enExpected).length + ' 处');

  check('服务在场时取词仍正确（中文）', live.api.weT(sample) === sample);
  check('语言切换 ⇒ 订阅者被通知 + 修订号前进',
    (() => {
      const rev0 = live.api.weLocaleRevisionValue();
      const n0 = notified;
      service.setLocale('en');
      return notified > n0 && live.api.weLocaleRevisionValue() > rev0;
    })(), 'notified=' + notified);
  check('语言切换 ⇒ 译文跟着变（跟随官方，无需重挂）', live.api.weT(sample) === sampleEn,
    JSON.stringify(String(live.api.weT(sample)).slice(0, 40)));

  // 负对照：判据不是恒真 —— 修订号**只在收到通知后**才前进（"订阅没接上"的形态下，
  // 界面不会重渲染；官方 `bind()` 是调用时读快照，所以这里只钉"通知 → 修订号"这一环）。
  check('negative control: 修订号只在通知后前进（判据有牙）',
    (() => {
      const rev = live.api.weLocaleRevisionValue();
      service.active = 'zh'; // 只改快照、不发通知
      return live.api.weLocaleRevisionValue() === rev;
    })());
  service.setLocale('zh');
  check('切回中文 ⇒ 译文回到原文', live.api.weT(sample) === sample);

  const detached = loadI18nRuntime({ search: '', service: createLocaleServiceStub('zh') });
  detached.api.weI18nAttach({ get: () => undefined, effect: () => {} }); // 服务缺席：静默
  check('服务缺席时静默（不抛、停在默认语言）', detached.api.weT(sample) === sample);
  off();
}

// ══ ⑥ 跟随契约（源码级）═══════════════════════════════════════════════════════
console.log('⑥ 跟随契约（可选服务 / 不 park / 顶层订阅）');
{
  const clientSrc = readFileSync(join(ROOT, 'src', 'client.js'), 'utf8');
  const i18nSrc = readFileSync(join(ROOT, 'src', 'i18n.js'), 'utf8');
  check('inject 里没有 locale（缺服务的旧宿主不该被 park）',
    !/const inject = \[[^\]]*"locale"/.test(clientSrc) && /const inject = \["slots"\]/.test(clientSrc),
    (clientSrc.match(/const inject = \[[^\]]*\]/) || [''])[0]);
  check('用 ctx.get("locale") 取可选服务（同 pollThemeService 口径）',
    /ctx\.get\(\s*["']locale["']\s*\)/.test(i18nSrc));
  check('apply() 里真的挂上了 i18n', /weI18nAttach\(ctx\)/.test(clientSrc));
  check('语言覆盖是逃生舱（?we-lang）', /WE_LANG_PARAM = "we-lang"/.test(i18nSrc));

  const comps = [
    { name: 'WallpaperPickerSection', src: clientSrc.slice(clientSrc.indexOf('function WallpaperPickerSection')) },
    { name: 'WallpaperPicker', src: clientSrc.slice(clientSrc.indexOf('function WallpaperPicker()')) },
    { name: 'RopeDock', src: clientSrc.slice(clientSrc.indexOf('function RopeDock')) },
    { name: 'UpdateNotice', src: clientSrc.slice(clientSrc.indexOf('function UpdateNotice')) },
    { name: 'QuickPanel', src: readFileSync(join(ROOT, 'src', 'quick-panel.js'), 'utf8').slice(readFileSync(join(ROOT, 'src', 'quick-panel.js'), 'utf8').indexOf('function QuickPanel')) },
  ];
  const noHook = componentsWithoutLocaleHook(comps.map((c) => c.src.slice(0, 400)));
  check('五个顶层组件都订阅了语言（否则切语言只换一半）', noHook.length === 0,
    noHook.length ? '缺订阅：' + noHook.join(' ') : comps.map((c) => c.name).join(' / '));
  check('negative control: 没订阅的组件会被判红',
    componentsWithoutLocaleHook(['function A() { return null; }']).length === 1
    && componentsWithoutLocaleHook(['function A() { useWeLocale(); return null; }']).length === 0);

  const navSrc = readFileSync(join(ROOT, 'src', 'nav-icon.js'), 'utf8');
  check('DOM 锚点用当前译文匹配（nav label / 设置入口），不冻结中文常量',
    /weT\("壁纸引擎"\)/.test(navSrc)
    && !/WE_NAV_LABEL/.test(navSrc)
    && /weT\("壁纸引擎"\)/.test(readFileSync(join(ROOT, 'src', 'sidebar-right.js'), 'utf8')));
  check('语言切换会重放 DOM 补丁（weOnLocaleChange）', /weOnLocaleChange\(/.test(navSrc));

  check('官方注册面用 thunk（label/title/description 现读现算）',
    /label: \(\) => weT\(/.test(clientSrc) && /title: \(\) => weT\(/.test(readFileSync(join(ROOT, 'src', 'sidebar-right.js'), 'utf8')));
}

console.log('\n' + (failed ? 'I18N CHECKS FAILED — ' + failed + ' failed' : 'I18N CHECKS PASSED')
  + ' (' + (passed + failed) + ')');
process.exit(failed ? 1 : 0);

// ══ 实现细节（放在最后：只被上面的判据调用）═══════════════════════════════════

/** 词表块 → `[{key, value}]`（只在"键位"上取键，值用同一个正则的捕获组）。 */
function parseCopyEntries(block) {
  if (!block) return [];
  const out = [];
  const re = /^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
  let m;
  while ((m = re.exec(block)) !== null) {
    out.push({ key: JSON.parse('"' + m[1] + '"'), value: JSON.parse('"' + m[2] + '"') });
  }
  return out;
}

/**
 * 把 `src/i18n-copy.js` + `src/i18n.js` 装进一个 vm 沙箱（与 bundle 的工厂作用域同形：
 * 同一作用域里的函数声明 + const）。返回 `{api}`，api 就是脚本末尾那条表达式的值
 * （vm 里 `const`/`function` 是脚本作用域，只能由脚本自己导出 —— 不能从 context 上取）。
 * 沙箱里补上 bundle 里由别的内联模块提供的两个定时器助手（sidebar-right.js 的
 * scheduleWeTimeout/clearWeTimeout）与最小 location 桩 —— i18n 层只依赖这些。
 */
function loadI18nRuntime({ search = '', service = null } = {}) {
  // `vm.Script` 不是模块环境 ⇒ 先按构建期内联的同一手法剥掉各文件的 `export { … }`
  // （共享实现：`test/tools/js-text.mjs` 的 stripExportBlocks —— 别在这里再抄一份正则）。
  const code = stripExportBlocks(readFileSync(join(ROOT, 'src', 'i18n-copy.js'), 'utf8'))
    + '\n;\n' + stripExportBlocks(readFileSync(join(ROOT, 'src', 'i18n.js'), 'utf8'))
    + '\n;\n({ weT, WE_I18N_EN, WE_I18N_HOST_EN, weI18nAttach, weLocaleSubscribe,'
    + ' weLocaleRevisionValue, weOnLocaleChange, weLocaleId });\n';
  const sandbox = {
    location: { search },
    URLSearchParams,
    React: { useSyncExternalStore: () => 0 },
    scheduleWeTimeout: (fn) => setTimeout(fn, 0),
    clearWeTimeout: (id) => clearTimeout(id),
    setTimeout,
    clearTimeout,
    console,
  };
  const context = createContext(sandbox);
  const api = new Script(code, { filename: 'i18n-runtime.js' }).runInContext(context);
  if (service) api.weI18nAttach({ get: (n) => (n === 'locale' ? service : undefined), effect: () => {} });
  return { api, context };
}

/**
 * 官方 `LocaleRuntime` 的最小**同形替身**：只实现 i18n 层用到的四个面，语义照抄官方实现
 * （`register(ns, locale, dict)` / `getSnapshot().active` / `subscribe(fn)` /
 * `bind(ns)(key, params)` 的"active 链 → en → 键本身"查找 + `{name}` 插值）。
 * 真机上这些由 `@deepseek-ai/dsh-client-locale` 提供（dsh-web-app 的依赖，随 web GUI 一起装）。
 */
function createLocaleServiceStub(active) {
  const service = {
    active,
    dicts: {},
    listeners: new Set(),
    registered: [],
    getSnapshot() { return { active: service.active, locales: [], revision: service.revision || 0 }; },
    subscribe(fn) { service.listeners.add(fn); return () => service.listeners.delete(fn); },
    setLocale(id) {
      service.active = id;
      for (const fn of service.listeners) fn();
    },
    register(ns, locale, dict) {
      (service.dicts[ns] = service.dicts[ns] || {})[locale] = dict;
      service.registered.push({ ns, locale });
      return () => {};
    },
    bind(ns) {
      return (key, params) => {
        const chain = [String(service.active).toLowerCase(), 'en'];
        let text;
        for (const locale of chain) {
          const dict = (service.dicts[ns] || {})[locale];
          if (dict && dict[key] !== undefined) { text = dict[key]; break; }
        }
        if (text === undefined) text = key;
        return params
          ? text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
          : text;
      };
    },
  };
  return service;
}
