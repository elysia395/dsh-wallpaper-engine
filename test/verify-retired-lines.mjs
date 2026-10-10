#!/usr/bin/env node
/**
 * verify-retired-lines.mjs —— 已退役的技术线**不许复活、也不许蔓延**（结构性反向探针）。
 *
 * 四条线的状态各不相同，所以探针形态也必须不同 —— 这是本脚本最重要的一处区分：
 *
 * ① 旧场景播放器线（P0-3 **已下线**）：`/scene-runtime`、`/scene-manifest`、`/scene-resource`
 *    三条路由 + `lib/scene-player.js` + `inventory.sceneUrl` 均已移除 ⇒ 断言**零残留**。
 * ② 静态帧渲染线（P2-12 阶段 2 **已删除**）：死树与提取链删净后，退役词只可能出现在
 *    `SF_BASELINE` 里 —— 而名单**只剩检验者**（守卫必须点名退役词才能断言"它没了"），
 *    产品侧零残留 ⇒ 判据是**不蔓延 + 基线只许缩小**。
 * ③ UI 笔误「秡」（P0-4 **已修**）：断言状态行用的是「档」。
 * ④ 退役设置键（旧设置面的名字，见文末词表）：`docs/TROUBLESHOOTING.md` 世系标注声称它们在代码里
 *    **零命中** ⇒ 断言零命中（docs 不在扫描面内 ⇒ 排障页可继续点名它们做核对）。
 *
 * ②为什么基线里留着检验者：它必须拼出退役词才能搜它们，否则本节一条都搜不到（假绿）。
 * 除它之外的任何文件命中退役词 = 有人把这条线接回了主线，必须失败。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const results = [];
function check(name, ok, detail) {
  results.push(Boolean(ok));
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : ''));
}

/** 扫描面：lib/ src/ scripts/ test/ 下的源码。`assets`（vendored 压缩产物）与 node_modules 不在范围。 */
function walk(dir, out = []) {
  const abs = ROOT + dir;
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) {
      if (/node_modules|assets|\.git/.test(rel)) continue;
      walk(rel, out);
    } else if (/\.(js|mjs|ts)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const FILES = [...walk('lib'), ...walk('src'), ...walk('scripts'), ...walk('test')]
  // 本脚本必须把退役词**拼出来**才能搜它们 ⇒ 扫自己必然是假阳性。只排除这一个文件，
  // 不得扩大（新加的守卫若也要拼这些词，应改为从本脚本 import 词表，而不是再开一个豁免）。
  .filter((f) => f !== 'test/verify-retired-lines.mjs')
  .sort();
const read = (rel) => readFileSync(ROOT + rel, 'utf8');

// ── 覆盖面地板：本脚本下面每一条判据都是"**在扫描面里**找不到退役词"。
//    扫描面一旦退化（目录改名、`walk` 的过滤写错，或某条线的 walk 返回空），那些断言会**恒真**：
//    零命中不是"干净"，而是"根本没看"。所以先钉住面本身（本仓库实测：lib 43 / src 40 /
//    test 71 / scripts 3，合计 157；这里按每条线各自的地板卡，防的是"某一条线整体掉出面"）。
{
  const faces = { lib: 0, src: 0, scripts: 0, test: 0 };
  for (const f of FILES) {
    const top = f.split('/')[0];
    if (top in faces) faces[top]++;
  }
  const floors = { lib: 30, src: 30, test: 40, scripts: 2 };
  const thin = Object.entries(floors).filter(([k, n]) => faces[k] < n);
  check('覆盖面地板：扫描面四条线各自非空（空面会让下面的"零残留"全部恒真）',
    thin.length === 0 && FILES.length >= 140,
    FILES.length + ' 个文件（' + Object.entries(faces).map(([k, n]) => k + ' ' + n).join(' / ') + '）'
      + (thin.length ? ' ⇒ 过薄：' + thin.map(([k, n]) => k + ' < ' + n).join(', ') : ''));
}

// ── ① 旧场景播放器线：零残留 ─────────────────────────────────────────────────
// `scene-manifest.js` 的 manifest 构建器曾拼 `/scene-resource/` 的 URL（它的消费者
// `/scene-manifest` 路由已在 P0-3 下线）。P2-12 阶段 2 把那整块无引用声明（约 2,000 行）
// 删净 ⇒ 这条 needle 不再需要"登记遗留（DECLARED_RESIDUE）"那个中间态，直接并入零残留断言。
// 名单只许缩小：检验者 = 必须点名该 needle 才能断言"它没了"的守卫。
const LEGACY_RESOURCE_URL = '/wallpaper-engine/scene-resource/';
// **空名单 = 最后一个检验者也没了**（`verify-ledger` 随 ADR-0006 下线）：产品侧早已零残留，
// 于是这条 URL 现在连"为了断言它不在"而点名它的地方都不需要 —— 这正是清单缩小到尽头的形态。
// 断言本身**不因此变弱**：它照样对全部文件断言零残留，只是不再豁免任何人。
const RESIDUE_INSPECTORS = [];

const LEGACY_FORBIDDEN = [
  'WE_SCENE_PLAYER_HTML',
  'sceneUrl',
  '${BASE}/scene-runtime',
  '${BASE}/scene-manifest',
  '${BASE}/scene-resource',
  "'/wallpaper-engine/scene-runtime'",
  "'/wallpaper-engine/scene-manifest'",
];
{
  const hits = [];
  for (const f of FILES) {
    const s = read(f);
    for (const needle of LEGACY_FORBIDDEN) if (s.includes(needle)) hits.push(f + ' :: ' + needle);
  }
  check('旧播放器线零残留（3 条路由 + sceneUrl + 播放页标识）', hits.length === 0,
    hits.length ? '命中 ' + hits.length + '：' + hits.slice(0, 3).join(' | ') : '干净');

  check('旧播放页模块已删除（lib/scene-player.js 不存在）', !existsSync(ROOT + 'lib/scene-player.js'));
  const pkg = JSON.parse(read('package.json'));
  check('package.json `files` 不再收录 scene-player.js',
    !(pkg.files || []).includes('lib/scene-player.js'));

  const residue = FILES.filter((f) => read(f).includes(LEGACY_RESOURCE_URL));
  const residueSpread = residue.filter((f) => !RESIDUE_INSPECTORS.includes(f));
  check('旧 /scene-resource/ URL 零残留（只许出现在点名它的检验者里）',
    residueSpread.length === 0,
    residue.length ? '仅出现在 ' + residue.join(', ') : '干净（连检验者也不再提它）');

  // ⚠️ 名单为空之后，"零残留"有可能退化成**恒真断言**（这条 needle 的常量若被删掉，扫描就再也
  //    找不到任何东西而永远绿）。覆盖点就是本节主判据 `residueSpread.length === 0`（同一 needle
  //    对全部文件断言零残留）；"把某个文件喂给豁免过滤器"式的负对照在这里没有鉴别力
  //    （`RESIDUE_INSPECTORS = []` 时它只是 `1 === 1 && 0 === 0`），所以改为钉住被扫的 needle
  //    确实是有内容的字面量、且本文件确实在点名它。
  {
    check('needle 非空且本文件确实点名它（防"零残留"退化成恒真）',
      LEGACY_RESOURCE_URL.length > 0 && read('test/verify-retired-lines.mjs').includes(LEGACY_RESOURCE_URL));
  }

  {
    // 负对照：走**同一个** needle 判据，而不是断言"这个常量包含它自己"
    const legacyHit = (s) => LEGACY_FORBIDDEN.filter((n) => s.includes(n));
    check('negative control: 旧播放页标识会被判不合格',
      legacyHit('x WE_SCENE_PLAYER_HTML y').length === 1 && legacyHit('x 干净 y').length === 0);
  }
}

// ── ② 静态帧渲染线：不蔓延（BASELINE 只许缩小）───────────────────────────────
// 名单里现在只剩检验它们的守卫（产品侧已删净）；**任何不在名单里的文件出现退役词 =
// 有人开始把这条线接回主线**，必须失败。
const SF_VOCAB = [
  'renderSceneFrameInWorker', 'scene-render-worker', 'extractSceneMainImage',
  'collectImageObjectTextures', 'FORMAT_PENALTY', 'tryCompositeSceneLayers',
  'sceneFramePrewarm', 'SCENE_PREWARM_LOGIC', 'prewarm-state',
  'SceneRenderer', 'scene-renderer', 'we-renderer', 'font-render',
  'scene-scripts', 'scene-script-apis',
];
// 冻结于 P0-4。P2-12 阶段 2 已删净死树与提取链；此后**最后一个检验者**（账本守卫）
// 随 ADR-0006 下线 ⇒ 名单现在为空：产品侧与检验侧都零残留，这条线只会被"接回来"违反。
// 删除过的文件不要再留（本节 INFO 会提示可收紧项）。
const SF_BASELINE = [];
{
  const found = new Map(); // file -> 命中的退役词
  for (const f of FILES) {
    const s = read(f);
    const hit = SF_VOCAB.filter((v) => s.includes(v));
    if (hit.length) found.set(f, hit);
  }
  const spread = [...found.keys()].filter((f) => !SF_BASELINE.includes(f));
  check('静态帧线未蔓延：退役词零残留（基线已空）', spread.length === 0,
    spread.length ? '越界文件 ' + spread.length + '：' + spread.slice(0, 4).join(', ')
      : found.size === 0 ? '零残留（' + SF_VOCAB.length + ' 个退役词 × ' + FILES.length + ' 个文件）'
        : '基线内 ' + found.size + ' 个文件命中（共 ' +
          [...found.values()].reduce((a, b) => a + b.length, 0) + ' 处）');

  const shrunk = SF_BASELINE.filter((f) => existsSync(ROOT + f) && !found.has(f));
  if (shrunk.length) console.log('  INFO 基线可缩小（已不含退役词）：' + shrunk.join(', '));
  const missing = SF_BASELINE.filter((f) => !existsSync(ROOT + f));
  if (missing.length) console.log('  INFO 基线中已删除的文件（P2-12 进度，请同步收紧名单）：' + missing.join(', '));

}

// ── ④ TEX 抽取线：`lib/pkg-extract.js` 整体退役（零残留）──────────────────────
//
// P2-12 删掉静态帧线之后，那个模块的 TEX→RGBA 解码链（`decodeTex` 及其全部解码助手）、
// 内嵌 PNG 载荷解码与内嵌 MP4 抽取**都没有调用者**了。它为什么活了那么久，值得记一笔：
//   · 宿主唯一的两处 `await import('./pkg-extract.js')` 只用 `parsePkg` / `readPkgEntry` ——
//     而那两个本来就是 `lib/pkg-read.js` re-export 出来的 ⇒ 改指 pkg-read 即可；
//   · `lib/scene-manifest.js` 从头到尾 import 的是 `./pkg-read.js`，它对 pkg-extract 的
//     唯一提及是**注释里的一句话**。一次只读审计据此把它判成"仍被使用、**别误删**" ——
//     那是**把注释当调用读**（本仓"判据只针对代码、先剥注释"的同一条教训在**读代码**上的翻版）。
//   · 当年真正钉住它的是账本守卫里一条"活依赖存活"断言（检查字符串
//     `function extractTexVideoMp4(` 存在）—— **一条守卫把一个没有调用者的函数钉成了活依赖**；
//     该守卫随 ADR-0006 下线后，删除的唯一阻碍也就没了。
// ⇒ 模块整体删除，容器原语保持**唯一实现** `lib/pkg-read.js`（P3-17 的收口方向不变）。
//
// 判据：下列名字在**扫描面**（lib/ src/ scripts/ test/）零残留。名单只许缩小；
// 基线为空 ⇒ 没有任何豁免（连"为了断言它不在"而点名它的检验者也不需要 —— 本文件自己
// 在扫描面之外，见 FILES 的过滤）。
// ⚠️ `lib/vendor` **不在**名单里：那是**约定**允许的第三方副本落点（CODE-STRUCTURE §5），
//    退役的是 vendored 的**那一份 jpeg-js**，不是这个目录概念。
const TEX_EXTRACT_VOCAB = [
  'pkg-extract',        // 模块名（import 说明符 / package.json 的 files 条目 / 任何再引用）
  'decodeTex',          // 前缀相同 ⇒ 一并覆盖 decodeTexToRgba
  'extractTexVideoMp4',
  'decodePngPayload',
  'PNG_GATE_MAX_PIXELS',
  'jpegJs',             // vendored 解码器的唯一消费者随该链一起走
  'jpeg-js',
];
{
  const found = new Map(); // file -> 命中的退役词
  for (const f of FILES) {
    const s = read(f);
    const hit = TEX_EXTRACT_VOCAB.filter((v) => s.includes(v));
    if (hit.length) found.set(f, hit);
  }
  check('TEX 抽取线零残留（lib/pkg-extract.js 与其 vendored jpeg-js 已整体删除）',
    found.size === 0,
    found.size ? '命中 ' + found.size + ' 个文件：'
      + [...found.entries()].slice(0, 4).map(([f, v]) => f + '[' + v.join('|') + ']').join(', ')
      : '零残留（' + TEX_EXTRACT_VOCAB.length + ' 个退役词 × ' + FILES.length + ' 个文件）');

  check('lib/pkg-extract.js 已删除', !existsSync(ROOT + 'lib/pkg-extract.js'));
  check('vendored jpeg-js 副本已删除', !existsSync(ROOT + 'lib/vendor/jpeg-js'));
  const pkg = JSON.parse(read('package.json'));
  check('package.json `files` 不再收录 pkg-extract.js / vendor 副本',
    !(pkg.files || []).includes('lib/pkg-extract.js')
    && !(pkg.files || []).some((f) => f.includes('vendor')));

  // 负对照：走**同一个** needle 判据（不是断言"常量包含它自己"）。
  const texHit = (s) => TEX_EXTRACT_VOCAB.filter((n) => s.includes(n));
  check('negative control: 退役词会被同一判据判出',
    texHit("const x = extractTexVideoMp4(y)").length === 1
    && texHit("import { a } from './pkg-read.js'").length === 0);
  check('needle 非空且本文件确实点名它们（防"零残留"退化成恒真）',
    TEX_EXTRACT_VOCAB.length >= 5
    && TEX_EXTRACT_VOCAB.every((v) => read('test/verify-retired-lines.mjs').includes(v)));
}

// ── ③ **已撤除**（当时守的是 UI 笔误「秡」与状态行措辞，P0-4）────────────────────
//
// 这里原本有两条判据：
//   · `状态行不再出现笔误「秡」` —— P0-4 的一次性清理，修完即**恒真**。
//     按 `docs/README.md` §写作纪律 5（"基线只许收紧，**删完清空即为零残留**"），
//     一次性清理的验收判据该在收口时撤掉，否则它是"已死但仍占位"的守卫。
//   · `状态行用的是「档」` —— 断言源码里含 ` 档 · ` 这个**四字散文片段**：
//     任何改写状态行的人都会把它判红 ⇒ 它拦的是编辑，不是腐化。
//
// 两条都按 [`docs/adr/0007`](../docs/adr/0007-machine-checks-target-code-not-prose.md)
// 撤除；那篇文章里记着"为什么当时会写它"与"为什么现在不留"。

// ── ④ 退役设置键（「空闲预热 / 有损路线 / GPU 渲染加速 / 帧渲染」四个旧设置面的名字）────
//
// `docs/TROUBLESHOOTING.md`（中英两版）页首的世系标注声称这四个键在代码里**零命中** ——
// 这条让那个声称有牙（此前没有任何判据对着它，标注等于空口）。扫描面 = 上方 FILES
// （lib/src/scripts/test 的源码；**docs 不在扫描面内** ⇒ 排障页继续合法地点名它们做核对）。
// 检验者必须拼出退役词才能搜它们 ⇒ 本文件被 FILES 过滤器整体排除（否则它一上来就命中自己）。
const RETIRED_SETTINGS_KEYS = [
  'sceneFrameRender',
  'scenePrewarmScope',
  'sceneLossyRoute',
  'sceneGpuAccel',
];
{
  const keyHit = (s) => RETIRED_SETTINGS_KEYS.filter((k) => s.includes(k));
  const hits = [];
  for (const f of FILES) {
    const hit = keyHit(read(f));
    if (hit.length) hits.push(f + '[' + hit.join('|') + ']');
  }
  check('退役设置键在代码中零命中（TROUBLESHOOTING 世系标注的凭据）',
    hits.length === 0,
    hits.slice(0, 4).join(', ')
      || '零命中（' + RETIRED_SETTINGS_KEYS.length + ' 键 × ' + FILES.length + ' 文件）');
  // 负对照 1：走**同一个** needle 判据 —— 词表空了或判据写反时，这条会替"零命中"兜底。
  check('negative control: 退役键会被同一判据判出',
    keyHit('settings.sceneFrameRender = 1').join(',') === 'sceneFrameRender'
    && keyHit('settings.frameRateCap = 1').length === 0);
  // 负对照 2：needle 非空且本文件确实点名它们 —— 自排除是**承重**的（不排除就必然自命中）。
  check('needle 非空且本文件确实点名它们（自排除承重）',
    RETIRED_SETTINGS_KEYS.length >= 4
    && RETIRED_SETTINGS_KEYS.every((k) => read('test/verify-retired-lines.mjs').includes(k)));
}

const failed = results.filter((r) => !r).length;
console.log('\n' + (failed ? 'RETIRED-LINE CHECKS FAILED — ' + failed + ' failed' : 'ALL RETIRED-LINE CHECKS PASSED') + ' (' + results.length + ')');
process.exit(failed ? 1 : 0);
