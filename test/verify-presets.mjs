#!/usr/bin/env node
/**
 * verify-presets.mjs — **整机配置快照**族（ADR-0011）的守卫：四段键集对账 + 两段相反的缺席语义
 * + 宿主路由全链路（含旧 tag 作废 / install-assets / export / import / 字节闸）+ 客户端形态。
 *
 * 覆盖六件容易「看起来对、实际不是那回事」的事：
 *   ① **四段对账（承重）**：`KINDS` 每个键**恰好**落在 settings 段 / `PRESET_ASSET_KEYS` /
 *      `PRESET_EXCLUDED_KEYS` / `DEFAULTS_ONLY` / `CLIENT_ONLY` 之一 —— 缺一即红、重叠即红。
 *      键表是**派生**的（D2），所以判据不能手抄第二份名单；登记表加参数时这里自动跟上。
 *      负对照：合成一份「漏一个键」与「多算一个键」的划分喂给**同一条**判据函数，必须都判红。
 *   ② **两条相反的缺席语义**（D4 最容易写反的一条）：settings 段缺键补默认（完整快照）；
 *      资产段缺席 = **不写键**（不是空对象占位）。二者不得互相污染 —— 消毒产物里既不能出现
 *      排除键，也不能出现资产键；`{}` 与 `{mascot:{}}` 必须是两个可区分的状态。
 *      负对照：把缺席段写成空对象 ⇒ 下游判据必须认出来（`'mascot' in assets` 为真）。
 *   ③ **旧 tag 一律作废**（D6）：单份 GET 回 422 且 reason **点明版本作废**（不是笼统
 *      bad-version）；清单如实标 `broken`；**墓碑先于版本判定**（否则删过的出厂预设会复活）；
 *      墓碑语义原样（已删除出厂不进清单、二次删除仍 404）。
 *      负对照：改坏 tag 的文件必须被判 `version-obsolete`，而合法文件必须判不出来。
 *   ④ **坏预设可删 + 上限占用**（captain 实测出的阻断级缺陷）：用户层一份读不懂的预设
 *      （旧 tag / 坏 JSON）⇒ DELETE 必须 200 且文件从盘上消失、名额确实腾出；同时钉住
 *      「坏行计入活跃上限」这个事实本身 —— 它是死锁的来源，不许有人误以为坏行不占位。
 *   ⑤ **export → import 往返 + 资产落盘 + 字节闸**：导出正文由读到的值重建；`assets=`
 *      未请求的段**不出现**在正文里；install-assets 落盘到 mascot/ 与 avatars/、换图清同族
 *      旧文件、`applied` 只含**实际安装的段**；单份资产超 8MB ⇒ 拒绝并**点名是哪一项**。
 *   ⑥ **客户端形态棘轮**（文本级 + 行为级）：应用走设置通道（合并 → persistSelection →
 *      reapplyAll → emit）、资产步失败按快照滚回、不另立持久化、无原生模态与 blob 通道。
 *
 * 既有 40 项断言的去向见文末「迁移说明」注释块；本次改造**没有删除任何判据意图**，
 * ①② 段的判据从「玻璃子集」口径整体换成「整机快照」口径（符号已退役，旧判据无法成立），
 * ③④ 段的删除/重名/上限/路径安全判据**原样保留**。
 *
 * 需要的外界：无。Usage: node test/verify-presets.mjs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { stripComments } from './tools/js-text.mjs';
import { scopeText } from './tools/src-scope.mjs';
import { installWeTShim } from './tools/weT-shim.mjs';
installWeTShim();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── 隔离：数据目录整体挪进工作区（必须在 import lib/index.js 之前）────────────
const ISO = join(root, '.test-cache', 'presets');
const DATA_DIR = join(ISO, 'data');
const ISO_HOME = join(ISO, 'home');
rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO_HOME, { recursive: true });
mkdirSync(join(ISO, 'steam'), { recursive: true });
process.env.DSH_WE_DATA_DIR = DATA_DIR;
process.env.DSH_WE_CACHE_DIR = join(ISO, 'cache');
process.env.DSH_WE_UPLOAD_DIR = join(ISO, 'uploads');
process.env.DSH_WE_STEAM_ROOT = join(ISO, 'steam');
process.env.HOME = ISO_HOME;           // POSIX
process.env.USERPROFILE = ISO_HOME;    // Windows

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ✓ ' + name + (detail !== undefined ? ' — ' + detail : '')); return; }
  failed++;
  console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
const section = (title) => console.log('\n' + title);

// ── ① 四段对账（承重）═══════════════════════════════════════════════════════
section('① 四段对账：KINDS 每个键恰好落在五类之一（缺一即红、重叠即红）');
const schema = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);

// ⚠️ 落盘文件名的两条正则**不在** settings-schema 的导出名单里（只导出了 DEFAULTS / KINDS 那一族）。
//   守卫要从源码文本把它们抽出来当唯一真源用 —— 绝不在这里手抄第二份字符类。
//   抽取式自己也要有牙：`reOf` 抽出来的东西必须**恰好**是那条正则，所以配一条"锚点没抽歪"的
//   判据 + 一条负对照（喂一段没有该声明的合成文本，必须抛）。
const schemaSrcText = readFileSync(join(root, 'lib', 'settings-schema.js'), 'utf8');
const reLiteralOf = (name) => {
  const m = schemaSrcText.match(new RegExp('const ' + name + ' = (/(?:[^/\\\\]|\\\\.)*/);'));
  if (!m) throw new Error('守卫无法从 settings-schema 抽出 ' + name + '（写法变了 ⇒ 抽取式必须同步，不许改成硬编码一份）');
  return m[1];
};
// ⚠️ **不要**手工切掉首尾斜杠再喂 `new RegExp`：字面量里的 `\.` 在源码文本层是「反斜杠 + 点」两个字符，
//   经字符串层再进 RegExp 构造器时那个反斜杠会被吃掉 ⇒ 变成通配点（判据比真源更宽 = 假绿）。
//   正确做法是把整段字面量连同定界符一起交给 `eval`（和 JS 引擎读源文件时的解析完全同一条路）。
const compileLiteral = (lit) => Function('"use strict"; return (' + lit + ');')();
// 顶层绑定给一个**明显不同**的哨兵正则：块内若有人手抄/遮蔽了一份，下面那条引用一致性判据
// 会立刻抓到；而真正的形状核对由紧随其后的两条 test 负责（它们用的是抽出来的真源）。
const MASCOT_FILE_RE = compileLiteral(reLiteralOf('MASCOT_FILE_RE'));
const AVATAR_FILE_RE = compileLiteral(reLiteralOf('AVATAR_FILE_RE'));
const schemaMascotRe = MASCOT_FILE_RE;
const schemaAvatarRe = AVATAR_FILE_RE;
check('抽出的正则与源文件字面量语义一致（转义没被吃掉：\\. 仍是字面点）',
  MASCOT_FILE_RE.test('mascot-abcd.png') && !MASCOT_FILE_RE.test('mascot-abcdXpng')
  && AVATAR_FILE_RE.test('user-abcd.png') && !AVATAR_FILE_RE.test('user-abcdXpng'),
  String(MASCOT_FILE_RE) + ' | ' + String(AVATAR_FILE_RE));
check('两条落盘文件名正则从 settings-schema 抽到（锚点没抽歪：正例认、反例不认）',
  MASCOT_FILE_RE.test('mascot-abcd.png') && !MASCOT_FILE_RE.test('mascot-ABCD.png')
  && !MASCOT_FILE_RE.test('../config.json')
  && AVATAR_FILE_RE.test('user-abcd.png') && AVATAR_FILE_RE.test('ai-abcd.png')
  && !AVATAR_FILE_RE.test('../../x.png'),
  String(MASCOT_FILE_RE) + ' | ' + String(AVATAR_FILE_RE));
// 负对照：同一条抽取式对"没有这条声明的文本"必须抛 —— 证明上面的 ✓ 不是恒真，
// 也证明将来有人删掉/改名那条声明时守卫会**响亮地炸**而不是静默用一份旧正则。
{
  const reOfFrom = (text, name) => {
    const m = text.match(new RegExp('const ' + name + ' = (/(?:[^/\\\\]|\\\\.)*/);'));
    if (!m) throw new Error('抽不到 ' + name);
    return m[1];
  };
  let threw = false;
  try { reOfFrom('const unrelated = 1;', 'MASCOT_FILE_RE'); } catch { threw = true; }
  check('negative control: 源文本里没有该声明时抽取式抛错（不静默退回手抄正则）', threw);
}

/**
 * 判据函数（正判据与负对照**共用它**，§4.7 约定 5）：给定五类划分，返回
 * `{ uncovered, overlapped, foreign }` —— uncovered = 一个都不在的键；overlapped = 落在两类
 * 以上的键；foreign = 表里有但候选域没有的孤儿键。三个都空才算通过。
 *
 * ⚠️ 候选域是 **`KINDS` ∪ `DEFAULTS_ONLY`**，不是单 `KINDS`：实测那五个 `DEFAULTS_ONLY` 键
 *（rotationInterval / sceneFrameUrl / themeTypeOnly / fontAdvanced / fontSetOpen）**不在**
 * `KINDS` 里（它们不持久化、只有默认值 ⇒ 没有 kind）。ADR-0011 D2 说的「每个 KINDS 键恰好落一段」
 * 在这里必须成立得更严一点 —— 五张表并起来要**完整覆盖**可持久化 + 只有默认值的键空间，
 * 且任何一张表里的键都要真存在于候选域（否则"表里写了个不存在的键"就是静默的空转）。
 */
function reconcile(domainKeys, groups) {
  const seen = new Map();
  for (const [gname, list] of Object.entries(groups)) {
    for (const k of list) {
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(gname);
    }
  }
  const uncovered = domainKeys.filter((k) => !seen.has(k));
  const overlapped = [...seen.entries()].filter(([, gs]) => gs.length > 1).map(([k]) => k);
  const foreign = [...seen.keys()].filter((k) => !domainKeys.includes(k));
  return { uncovered, overlapped, foreign };
}

{
  const { PROFILE_PRESET_KEYS, PRESET_ASSET_KEYS, PRESET_EXCLUDED_KEYS, DEFAULTS_ONLY, CLIENT_ONLY, KINDS } = schema;
  const kindsKeys = Object.keys(KINDS);
  // 候选域 = KINDS ∪ DEFAULTS_ONLY（理由见 reconcile 的头注释）。
  const domainKeys = [...new Set([...kindsKeys, ...DEFAULTS_ONLY])];
  const groups = {
    settings: PROFILE_PRESET_KEYS,
    asset: PRESET_ASSET_KEYS,
    excluded: PRESET_EXCLUDED_KEYS,
    defaultsOnly: DEFAULTS_ONLY,
    clientOnly: CLIENT_ONLY,
  };
  const r = reconcile(domainKeys, groups);
  check('四段对账：候选域每键恰好落一类（缺一即红、重叠即红）',
    r.uncovered.length === 0 && r.overlapped.length === 0 && r.foreign.length === 0,
    'KINDS ' + kindsKeys.length + ' ∪ DEFAULTS_ONLY ⇒ 域 ' + domainKeys.length + ' = settings ' + PROFILE_PRESET_KEYS.length
    + ' + asset ' + PRESET_ASSET_KEYS.length + ' + excluded ' + PRESET_EXCLUDED_KEYS.length
    + ' + defaultsOnly ' + DEFAULTS_ONLY.length + ' + clientOnly ' + CLIENT_ONLY.length
    + (r.uncovered.length ? ' 缺:' + r.uncovered.join(',') : '')
    + (r.overlapped.length ? ' 重:' + r.overlapped.join(',') : '')
    + (r.foreign.length ? ' 孤儿:' + r.foreign.join(',') : ''));
  // ADR-0011 D2 的原话口径单独钉一条：`KINDS` 的每个键都必须**落在表里**（无缺、无重）。
  // ⚠️ 这里**不查 foreign** —— `DEFAULTS_ONLY` 那五个键不在 KINDS 里（见 reconcile 头注释），
  //    它们会在这一条上合法地报"孤儿"；候选域的完整对账由上面那条负责。
  const rKinds = reconcile(kindsKeys, groups);
  check('ADR D2 原话口径：KINDS 每个键都落在五类之一且只落一类（无缺、无重）',
    rKinds.uncovered.length === 0 && rKinds.overlapped.length === 0,
    'KINDS ' + kindsKeys.length + ' 键全命中（DEFAULTS_ONLY 五键不在 KINDS ⇒ 本条不比孤儿）');
  // settings 段必须是**派生**的（D2：不再手写第二份白名单）。判据：与"KINDS 减四类"逐键同序。
  const derived = kindsKeys.filter((k) => !DEFAULTS_ONLY.includes(k) && !CLIENT_ONLY.includes(k)
    && !PRESET_ASSET_KEYS.includes(k) && !PRESET_EXCLUDED_KEYS.includes(k));
  check('settings 段是派生表而非手抄（顺序与内容都和 KINDS−四类一致）',
    derived.length === PROFILE_PRESET_KEYS.length && derived.every((k, i) => k === PROFILE_PRESET_KEYS[i]),
    PROFILE_PRESET_KEYS.length + ' 键');
  // 资产段与排除表的键必须真的在 KINDS 里（否则派生会把它们当"孤儿"漏掉）。
  check('资产段与排除表的键都在 KINDS 内（不是凭空名单）',
    PRESET_ASSET_KEYS.every((k) => k in KINDS) && PRESET_EXCLUDED_KEYS.every((k) => k in KINDS),
    'asset=' + PRESET_ASSET_KEYS.length + ' excluded=' + PRESET_EXCLUDED_KEYS.length);
  // CLIENT_ONLY 同理（它也在派生式里被减去；不在 KINDS 里的话那条减法就是空转）。
  check('CLIENT_ONLY 的键都在 KINDS 内（减法真的减到东西）',
    CLIENT_ONLY.every((k) => k in KINDS), CLIENT_ONLY.join(','));
  // 字体段 = FONTSET_KEYS 全集（ADR D1 表格里的"字体段 7 键"）。
  check('资产段里的字体族键 = FONTSET_KEYS 全集（7 键，不多不少）',
    schema.FONTSET_KEYS.length === 7
    && schema.FONTSET_KEYS.every((k) => PRESET_ASSET_KEYS.includes(k))
    && PRESET_ASSET_KEYS.filter((k) => schema.FONTSET_KEYS.includes(k)).length === 7,
    schema.FONTSET_KEYS.join(','));
  // 承旧判据：keyOverrides 生效（fidelity 走 chatGlassFidelity，无平行键）—— 现在看 settings 段。
  check('keyOverrides 生效：fidelity 走 chatGlassFidelity（无平行键）',
    PROFILE_PRESET_KEYS.includes('chatGlassFidelity') && !PROFILE_PRESET_KEYS.includes('conversationFidelity'));
  // 承旧判据：登记表生成的子项键全部自动进 settings 段（GLASS_CHILDREN 加参数即跟随）。
  {
    const { GLASS_CHILDREN, childGlassKey } = schema;
    const generated = [...new Set(GLASS_CHILDREN.flatMap((c) => Object.keys(c.params).map((p) => childGlassKey(c.id, p))))];
    const missing = generated.filter((k) => !PROFILE_PRESET_KEYS.includes(k));
    check('登记表生成的玻璃子项键自动进 settings 段（无遗漏）',
      missing.length === 0, generated.length + ' 个生成键' + (missing.length ? ' 缺:' + missing.join(',') : ''));
  }
  // ⚠️ 本仓实测踩过：这段块里引用的 `MASCOT_FILE_RE` / `AVATAR_FILE_RE` 曾被**块内同名 const 遮蔽**，
  //   于是判据读的是块内那份手抄正则、顶层"从源码抽真源"那条核对形同虚设（TDZ 报错才暴露）。
  //   这里把它钉成判据：块内可见的这两个绑定必须与文件顶层抽出来的**同一个对象**。
  check('块内引用的文件名正则就是顶层从源码抽出的那两条（无第二份手抄 / 无遮蔽）',
    MASCOT_FILE_RE === schemaMascotRe && AVATAR_FILE_RE === schemaAvatarRe,
    String(MASCOT_FILE_RE) + ' | ' + String(AVATAR_FILE_RE));

  // ── 负对照 ×4（同一条判据函数，喂合成输入）──
  // 取一个**确定在 settings 段里**的键来造缺/重（KINDS[0] = `id` 住在排除表里，拿它抽 settings
  // 会同时触发"没变少"与"多一处重叠"，判据就不精确了 —— 这是第一版踩到的坑）。
  const one = PROFILE_PRESET_KEYS[0];
  const rc1 = reconcile(domainKeys, { ...groups, settings: groups.settings.filter((k) => k !== one) });
  check('negative control 1: 从任一段抽掉一个键 ⇒ 同一条对账判"缺一即红"',
    rc1.uncovered.length === 1 && rc1.uncovered[0] === one, 'uncovered=' + rc1.uncovered.join(','));
  const rc2 = reconcile(domainKeys, { ...groups, excluded: [...groups.excluded, one] });
  check('negative control 2: 把一个键同时塞进两段 ⇒ 同一条对账判"重叠即红"',
    rc2.overlapped.length === 1 && rc2.overlapped[0] === one, 'overlapped=' + rc2.overlapped.join(','));
  const rc3 = reconcile(domainKeys.filter((k) => k !== one), groups);
  check('negative control 3: 表里留着一个候选域没有的键 ⇒ 判"孤儿即红"',
    rc3.foreign.length === 1 && rc3.foreign[0] === one, 'foreign=' + rc3.foreign.join(','));
  // 第四处负对照钉的是**候选域本身**：DEFAULTS_ONLY 不在 KINDS 里这个事实如果被改掉
  // （有人把五个键补进 KINDS），本判据必须立刻要求它们进对账 —— 而不是静默少覆盖。
  const rc4 = reconcile(kindsKeys, groups);
  check('negative control 4: 拿单 KINDS 当域去对账 ⇒ DEFAULTS_ONLY 五键被判孤儿（证明域的选取有牙）',
    rc4.foreign.length === DEFAULTS_ONLY.length && DEFAULTS_ONLY.every((k) => rc4.foreign.includes(k)),
    'foreign=' + rc4.foreign.join(','));
  check('positive control: 真实划分在同一个函数上是干净的（负对照的红不是函数本身坏了）',
    r.uncovered.length === 0 && r.overlapped.length === 0 && r.foreign.length === 0);
}

// ── ② 消毒：两条相反的缺席语义 ══════════════════════════════════════════════
section('② 消毒：settings 段补齐成完整快照 / 资产段缺席不写键（两条相反语义各自独立）');
{
  const { PROFILE_PRESET_KEYS, PRESET_ASSET_KEYS, PRESET_EXCLUDED_KEYS, sanitizePresetValues, sanitizePresetAssets, DEFAULTS } = schema;

  // ②-a settings 段 = 完整快照（缺键补默认）
  const sparse = sanitizePresetValues({ glassAlpha: 55 });
  check('settings 段稀疏输入补齐成完整快照（缺键 = 默认值）',
    Object.keys(sparse).length === PROFILE_PRESET_KEYS.length
    && sparse.glassAlpha === 55 && sparse.blur === DEFAULTS.blur,
    Object.keys(sparse).length + ' 键');
  const over = sanitizePresetValues({ glassAlpha: 999, blur: -5 });
  check('越界值回落默认（clampNum 语义：不是截断）',
    over.glassAlpha === DEFAULTS.glassAlpha && over.blur === DEFAULTS.blur,
    'glassAlpha=' + over.glassAlpha);
  // §11 A2-F1 承旧判据：开关进快照、玻璃色按一对归一。
  check('A2-F1：glassDarkSeparate 进快照、玻璃色按一对归一',
    sanitizePresetValues({}).glassDarkSeparate === false
      && sanitizePresetValues({ glassDarkSeparate: true }).glassDarkSeparate === true
      && sanitizePresetValues({ glassDarkSeparate: 'yes' }).glassDarkSeparate === false
      && JSON.stringify(sanitizePresetValues({ glassColor: { light: '#123456', dark: '#654321' } }).glassColor)
        === JSON.stringify({ light: '#123456', dark: '#654321' })
      && JSON.stringify(sanitizePresetValues({ glassColor: '#123456' }).glassColor)
        === JSON.stringify({ light: '#123456', dark: '#123456' }),
    JSON.stringify({ off: sanitizePresetValues({}).glassDarkSeparate, on: sanitizePresetValues({ glassDarkSeparate: true }).glassDarkSeparate }));
  // 回归钉（承旧）：不盖版本号会被 migrateSettings 当旧档换算（实测 glassAlpha 70 → 100）。
  const noVersion = sanitizePresetValues({ glassAlpha: 70, sidebarAlpha: 85, sidebarContentAlpha: 30 });
  check('回归钉：无版本号输入不做旧刻度换算（70 进 70 出）',
    noVersion.glassAlpha === 70 && noVersion.sidebarAlpha === 85 && noVersion.sidebarContentAlpha === 30,
    'glassAlpha=' + noVersion.glassAlpha + ' sidebarAlpha=' + noVersion.sidebarAlpha);
  check('glassMode 整键在快照里且默认全 inherit',
    Boolean(noVersion.glassMode) && Object.values(noVersion.glassMode).every((m) => m === 'inherit'));

  // ②-b 两条语义**互不污染**：settings 段产物里不得出现资产键或排除键。
  const polluted = sanitizePresetValues({
    glassAlpha: 55, notAKey: 'x',
    // 排除表全量喂非默认值：任何一个出现在产物里都是"预设携带了运行期记忆/本机指向"。
    id: 'wallpaper-1', hiddenIds: ['a'], rotationGroups: [{ name: 'g' }], rotationGroupId: 'g',
    rotationSeeded: true, userProps: { tok: { opacity: 5 } }, sceneLiveFailures: { t: 1 },
    noticeSeen: 'v1', presetIntroSeen: 'v1', skinYieldRestoreId: 'w', skinYieldRestoreRotation: true,
    parallaxPluginDepths: { slot: 3 }, settingsVersion: 2,
    // 资产段全量喂非默认值：同理不得进 settings 段。
    themeColors: { primary: { light: '#111111', dark: '#222222' } }, themeDarkSeparate: true,
    themeSize: { body: 20 }, themeWeight: { body: 600 }, themeFamily: { body: 'KaiTi' },
    globalFamily: 'KaiTi', componentFonts: { body: { family: 'KaiTi' } },
    mascotImage: 'mascot-abcd1234.png', mascotImageBox: '64x64',
    avatarUserImage: 'user-abcd.png', avatarAiImage: 'ai-abcd.png',
  });
  const leakedAsset = PRESET_ASSET_KEYS.filter((k) => k in polluted);
  const leakedExcluded = PRESET_EXCLUDED_KEYS.filter((k) => k in polluted);
  check('两条语义不互相污染：settings 段产物里没有资产键、也没有排除键',
    leakedAsset.length === 0 && leakedExcluded.length === 0 && polluted.glassAlpha === 55,
    'asset泄漏=' + (leakedAsset.join(',') || '无') + ' excluded泄漏=' + (leakedExcluded.join(',') || '无'));
  const unknownIn = sanitizePresetValues({ glassAlpha: 55, definitelyNotASettingKey: 1 });
  check('未知键一律丢弃（产物键数恰等于 settings 段键数）',
    !('definitelyNotASettingKey' in unknownIn) && Object.keys(unknownIn).length === PROFILE_PRESET_KEYS.length);

  // ②-c 资产段：缺席 = **不写键**（不是空对象）
  const none = sanitizePresetAssets(undefined);
  check('资产段缺席 ⇒ 不写键（{} 而不是 {font:{},mascot:{},avatar:{}}）',
    Object.keys(none).length === 0, JSON.stringify(none));
  const emptyObj = sanitizePresetAssets({});
  check('positive control: 空对象入参与缺席同为"无段"（两者都不该写出键）',
    Object.keys(emptyObj).length === 0);
  const onlyMascot = sanitizePresetAssets({ mascot: { file: 'mascot-abcd1234.png', box: '64x64', data: 'QUJD' } });
  check('资产段只勾一项 ⇒ 产物只有那一段（其余两段不出现）',
    Object.keys(onlyMascot).length === 1 && onlyMascot.mascot.file === 'mascot-abcd1234.png'
    && onlyMascot.mascot.box === '64x64' && !('font' in onlyMascot) && !('avatar' in onlyMascot),
    JSON.stringify(onlyMascot));
  check('negative control: "段在但没字节" 与 "段缺席" 可区分（下游据此决定落不落盘）',
    ('mascot' in sanitizePresetAssets({ mascot: { file: 'mascot-abcd1234.png', data: '' } }))
    && !('mascot' in sanitizePresetAssets({})));
  const fontSeg = sanitizePresetAssets({ font: { name: '我的集', values: { themeColors: { primary: { light: '#111111', dark: '#222222' } } } } });
  check('字体段落成 {name, values} 形状且 values 过 sanitizeFontset（7 键齐）',
    fontSeg.font && fontSeg.font.name === '我的集'
    && Object.keys(fontSeg.font.values).length === schema.FONTSET_KEYS.length
    && JSON.stringify(fontSeg.font.values.themeColors.primary) === JSON.stringify({ light: '#111111', dark: '#222222' }),
    'globalFamily=' + JSON.stringify(fontSeg.font && fontSeg.font.values.globalFamily));
  const evil = sanitizePresetAssets({ mascot: { file: '../../config.json', box: '999x999', data: 'QUJD' }, avatar: { user: { file: 'evil.png', data: 'RURF' } } });
  check('资产文件名过 MASCOT_FILE_RE / AVATAR_FILE_RE（非法形状回默认，不"修好它"）',
    evil.mascot.file === '' && evil.avatar.user.file === '',
    JSON.stringify({ mascot: evil.mascot.file, avatarUser: evil.avatar.user.file }));
  const nonStringData = sanitizePresetAssets({ mascot: { file: 'mascot-abcd1234.png', data: 12345 } });
  check('data 非字符串 ⇒ 丢字节但**段仍在**（"勾了但没图" ≠ "没勾"，两回事）',
    'mascot' in nonStringData && nonStringData.mascot.data === '');
}

// ── ③ 宿主路由台架 ══════════════════════════════════════════════════════════
section('③ 宿主路由（mock webServer + 真 apply，数据目录已隔离）');
const routes = [];
const mockCtx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const apply = host.apply || (host.inject && host.apply);
const dispose = apply(mockCtx);

const route = routes.find((r) => r.path && r.path.endsWith('/glass-presets'));
check('整机快照族路由已注册（prefix）', Boolean(route), route && route.path);
const routeSrc = readFileSync(join(root, 'lib', 'routes', 'presets.js'), 'utf8');
check('路由族文件在位：注册器与前缀路径的形状未漂移',
  /export function registerGlassPresetsRoutes/.test(routeSrc)
  && routeSrc.includes('`${BASE}/glass-presets`')
  && /GLASS_PRESET_TOMBSTONE_TAG/.test(routeSrc));
// 本文件头旧决策已被 ADR-0011 D7 推翻。判据分两层：
//   · **行为层**（真路由）：export / import 两条路都不得回 405 —— 这才是"这条路没被禁着"的证据；
//   · **文本层**：文件头必须有一段把这条推翻讲清楚（旧句子只允许出现在"旧版这里写着"的引述里，
//     不允许还挂在**断言当前状态**的位置上）。文本判据刻意宽松 —— 引用旧决策是 D7 明确要求的做法。
check('文件头写明 import/export 已存在（D7 更正注释在位）',
  /为什么 import \/ export 现在有/.test(routeSrc));
check('文件头不再把"没有 import\/export"当作**当前**决策来陈述（只允许作为被推翻的旧话引述）',
  !/^\s*\*\s*没有 import \/ export\s*[:：]/m.test(routeSrc));

// ★ 行为层判据（不靠正则读注释）见下方「端点存在性探针」段 —— 必须排在 callRoute 定义之后。

function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) { state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb(); },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}
function fakeReq(url, method = 'GET', body = null) {
  const chunks = body === null ? [] : [Buffer.from(body, 'utf8')];
  const r = Readable.from(chunks);
  r.url = url;
  r.method = method;
  r.headers = body === null ? {} : { 'content-type': 'application/json' };
  return r;
}
const waitRes = (res) => new Promise((r) => { if (res.__state.ended) r(); else res.on('finish', r); });
async function callRoute(route_, req) {
  const res = fakeRes();
  const done = route_.handler(req, res);
  if (done && typeof done.then === 'function') await done;
  await waitRes(res);
  return res;
}
const bodyJson = (res) => {
  try { return JSON.parse(res.__state.body.toString('utf8')); } catch { return null; }
};
const dirDigest = (dir) => {
  try {
    return readdirSync(dir).sort().map((f) => {
      const h = createHash('sha256').update(readFileSync(join(dir, f))).digest('hex').slice(0, 12);
      return f + ':' + h;
    }).join(',');
  } catch { return ''; }
};
const BUILTIN = join(root, 'lib', 'glass-presets');
const USER = join(DATA_DIR, 'glass-presets');
const MASCOT_DIR = join(DATA_DIR, 'mascot');
const AVATARS_DIR = join(DATA_DIR, 'avatars');
const P = (id) => '/wallpaper-engine/glass-presets/' + id;
const getList = async () => bodyJson(await callRoute(route, fakeReq('/wallpaper-engine/glass-presets', 'GET'))) || {};
const create = (name, values, id, embed, point) => callRoute(route, fakeReq('/wallpaper-engine/glass-presets/create', 'POST',
  JSON.stringify(Object.assign({ name, values: values || {} }, id ? { id } : {}, embed ? { embed } : {}, point ? { point } : {}))));
const del = (id) => callRoute(route, fakeReq(P(id), 'DELETE'));
const get1 = (id) => callRoute(route, fakeReq(P(id), 'GET'));
const installAssetsCall = (id) => callRoute(route, fakeReq(P(id) + '/install-assets', 'POST'));
const exportPreset = (id, assets, point) => callRoute(route, fakeReq(P(id) + '/export'
  + (assets || point ? '?' + [assets ? 'assets=' + encodeURIComponent(assets) : '', point ? 'point=' + encodeURIComponent(point) : ''].filter(Boolean).join('&') : ''), 'GET'));
const importPreset = (doc) => callRoute(route, fakeReq('/wallpaper-engine/glass-presets/import', 'POST',
  typeof doc === 'string' ? doc : JSON.stringify(doc)));
/** 直接往用户层写一份文件（复刻"升级后盘上还留着的旧档"这类真实形态）。 */
const writeUserFile = (id, objOrText) => {
  mkdirSync(USER, { recursive: true });
  writeFileSync(join(USER, id + '.json'), typeof objOrText === 'string' ? objOrText : JSON.stringify(objOrText, null, 2) + '\n', 'utf8');
};
const userFilePath = (id) => join(USER, id + '.json');

const OLD_TAG = 'dsh-we/glass-preset@1';

// ── 端点存在性探针（行为层判据，不靠正则读注释）═══════════════════════════════
// ADR-0011 D7 新做出 export / import / install-assets 三条路。旧版文件头写着"没有 import/export"
// ⇒ 那两条路当时必然 405。这里钉的是"这条路真的通了"而不是"注释改了没改" —— 注释可以照抄，
// 路由骗不了人。（排在 callRoute 等台架助手之后：const/函数声明的初始化顺序。）
{
  const probeExport = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/probe-nope/export', 'GET'));
  const probeImport = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/import', 'POST', '{}'));
  const probeInstall = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/probe-nope/install-assets', 'POST'));
  check('★ export / import / install-assets 三条端点都存在（不得 405 —— 行为判据）',
    probeExport.__state.status !== 405 && probeImport.__state.status !== 405 && probeInstall.__state.status !== 405,
    'export=' + probeExport.__state.status + ' import=' + probeImport.__state.status
    + ' install-assets=' + probeInstall.__state.status);
}

{
  const digestBefore = dirDigest(BUILTIN);
  let list = await getList();
  const rows = Array.isArray(list.presets) ? list.presets : [];
  const builtinRows = rows.filter((r) => r.origin === 'builtin');
  check('清单 200：七套出厂预设、origin=builtin（含「作者自用」），响应无 hidden 字段',
    builtinRows.length === 7 && !('hidden' in list)
    && builtinRows.some((r) => r.id === 'factory-author' && r.name === '作者自用'),
    builtinRows.map((r) => r.id).join(','));

  // 出厂预设正文本身必须是新契约的产物（t1 交付物的独立复核，不看自述）。
  // 资产段（2026-10-12 四态口径）：出厂预设**允许携带**、也允许**指向内置**或**声明无** ——
  // 但必须是 `sanitizePresetAssets` 的**规范形**（round-trip 逐字节相等），随包文件里不许有
  // 消毒会改写/丢弃的形状；`data` 由应用路径的 `installAssets` 落盘，清单端点只回
  // {id,name,origin} 不会把它漏出去。
  {
    const files = readdirSync(BUILTIN).filter((f) => f.endsWith('.json')).sort();
    const bad = [];
    for (const f of files) {
      const d = JSON.parse(readFileSync(join(BUILTIN, f), 'utf8'));
      if (d.$schema !== schema.PROFILE_PRESET_SCHEMA_TAG) bad.push(f + ':tag');
      else if (Object.keys(d.values || {}).length !== schema.PROFILE_PRESET_KEYS.length) bad.push(f + ':values=' + Object.keys(d.values || {}).length);
      else if ('assets' in d
        && JSON.stringify(schema.sanitizePresetAssets(d.assets)) !== JSON.stringify(d.assets)) bad.push(f + ':assets非规范形');
    }
    check('七套出厂正文都是新 tag + 完整 settings 段（资产段允许，须为消毒后规范形）',
      files.length === 7 && bad.length === 0, files.length + ' 套' + (bad.length ? ' 不合格:' + bad.join(',') : ''));
    const author = JSON.parse(readFileSync(join(BUILTIN, 'factory-default.json'), 'utf8'));
    check('「黑客绿(Fish)」按本机现配置抄写（glassColor 摊成一对且两侧同值，非默认白釉）',
      author.name === '黑客绿(Fish)' && author.values.glassColor
      && typeof author.values.glassColor.light === 'string'
      && author.values.glassColor.light === author.values.glassColor.dark
      && author.values.glassColor.light.toLowerCase() !== '#ffffff',
      JSON.stringify(author.values.glassColor));
    // 「同一个字段两种指向」（ADR-0011 D4 第三/四态）：`assets.mascot` 可以是**字符串** =
    //   指向出厂自带形态（零字节，应用时宿主只清本机立绘族并把 ropeForm 钉成它），也可以是
    //   对象 = 携带自定义图（`data` 经 installAssets 落盘）。
    check('「黑客绿(Fish)」的 mascot 指向内置 `deepseek`（字符串态 = 零字节，不再内嵌立绘副本）',
      author.assets && 'font' in author.assets && author.assets.mascot === 'deepseek',
      JSON.stringify(author.assets ? author.assets.mascot : null));
    // ★ 四态回归钉子（2026-10-12）：七套出厂预设**每套都必须显式声明吉祥物指向**（不留缺席）
    //   —— 缺席就是本次缺陷的载体：A（不携带立绘）→ B（携带立绘）→ A 之后，屏上留着 B 的图
    //   （A 的 110 键 settings 快照里根本没有 mascotImage 这两个键）。指向按维护者口径分配：
    //   「作者自用」→ **携带内嵌自定义立绘**（彩蛋：原内置「小女仆」，2026-10-13 从出厂形态除名
    //   后搬进这份预设）；「紫色心情」→ 携带自定义图片；其余五套（含「黑客绿(Fish)」—— 它内嵌的
    //   那张立绘 2026-10-13 认出就属内置 GLM）→ 内置 DeepSeek（`deepseek`，也是出厂默认）。
    //   头像族一律不声明（出厂预设都不携带头像，声明 `null` 只会删掉用户自己上传的头像文件）。
    const undeclared = [];
    const ptr = {};
    const form = {};
    const types = {};
    for (const f of files) {
      const d = JSON.parse(readFileSync(join(BUILTIN, f), 'utf8'));
      const key = f.replace(/^factory-|\.json$/g, '');
      form[key] = d.values.ropeForm;
      types[key] = d.values.typeFilter;
      if (!d.assets || !('mascot' in d.assets)) undeclared.push(f);
      else ptr[key] = typeof d.assets.mascot === 'string' ? d.assets.mascot
        : d.assets.mascot === null ? null : 'object';
    }
    const wantPtr = {
      author: 'object', default: 'deepseek', frosted: 'deepseek', night: 'deepseek',
      readable: 'deepseek', vivid: 'deepseek', 'purple-mood': 'object',
    };
    check('★ 七套出厂预设每套都显式声明吉祥物指向（5 套字符串指向内置 + 2 套携带对象；缺席即缺陷）',
      files.length === 7 && undeclared.length === 0
      && JSON.stringify(ptr) === JSON.stringify(wantPtr),
      undeclared.length ? '缺席:' + undeclared.join(',') : JSON.stringify(ptr));
    // 「两处值保持一致」：资产段的字符串指向与 settings 段的 ropeForm 不许打架 —— 应用时
    //   installAssets 在 settings 合并**之后**跑，资产段会覆盖 ropeForm；两处不一致 =
    //   用户看到的那只与「预设自称的那只」不同。
    check('★ 指向与 settings 段的 ropeForm 一致（5 套字符串指向 = 各自的 ropeForm；两套携带图的自报 ropeForm）',
      ptr.default === form.default && ptr.frosted === form.frosted
      && ptr.night === form.night && ptr.readable === form.readable && ptr.vivid === form.vivid
      && form.author === 'deepseek' && form['purple-mood'] === 'phoebe',
      JSON.stringify(form));
    // ★ 出厂预设不得替用户收窄**类型档**：套用一份外观预设不该顺手把壁纸库 / 轮播候选池切到
    //   单一分支（「作者自用」曾误设 `image` —— 用户看到的是"切个主题，壁纸列表突然只剩图片"）。
    //   值域同一套 id（`all` / `video` / `web` / `image` / `scene`），这里钉的是七套一律 `all`。
    const narrowedOf = (m) => Object.entries(m).filter(([, v]) => v !== 'all');
    const narrowed = narrowedOf(types);
    check('★ 七套出厂预设的类型档一律「全部」（外观预设不得替用户收窄壁纸分类）',
      files.length === 7 && narrowed.length === 0,
      narrowed.length ? narrowed.map(([k, v]) => k + '=' + v).join(',') : JSON.stringify(types));
    check('  └ 负对照（同一条判据，喂被改窄的合成输入）：判得出 —— 判据有牙',
      narrowedOf({ ...types, author: 'image' }).length === 1, '合成 author=image');
  }

  // 创建用户预设：settings 段补齐成完整快照（100 键）
  const created = await create('我的夜色', { glassColor: '#123456', glassAlpha: 66 }, 'preset-test-1');
  const createdData = bodyJson(created) || {};
  check('创建 200，id 用客户端给的，values 缺键补齐成完整快照（settings 段全量）', created.__state.status === 200
    && createdData.id === 'preset-test-1'
    && Object.keys(createdData.values || {}).length === schema.PROFILE_PRESET_KEYS.length
    && (createdData.values.glassColor || {}).light === '#123456'
    && (createdData.values.glassColor || {}).dark === '#123456',
    'values=' + Object.keys(createdData.values || {}).length + ' 键');
  check('create 未勾资产 ⇒ 回包不出现 assets 键（缺席 ≠ 空段）',
    !('assets' in createdData), Object.keys(createdData).join(','));

  // 重名三条（归一化口径：字面 / 空白变体 / 与出厂撞名）
  const dup = await create('我的夜色');
  const dupVariant = await create(' 我的夜色 ');
  const dupBuiltin = await create('重磨砂');
  check('重名 409 ×3：字面 / 空白变体 / 与出厂撞名',
    dup.__state.status === 409 && dupVariant.__state.status === 409 && dupBuiltin.__state.status === 409,
    [dup.__state.status, dupVariant.__state.status, dupBuiltin.__state.status].join('/'));
  check('409 带 error 信封（客户端显示处要原话）', typeof (bodyJson(dup) || {}).error === 'string');

  // 上限 8：现在 8 个活跃（7 出厂 + 1 用户）⇒ 第 9 个 409
  const overCap = await create('超出上限的预设');
  check('上限 8：第 9 个活跃预设 409（错误文案点明可删除腾位）',
    overCap.__state.status === 409 && /8/.test((bodyJson(overCap) || {}).error || ''),
    (bodyJson(overCap) || {}).error);

  // 删除一个出厂 ⇒ 腾出一格 ⇒ 创建放行（已删除的不占位）
  const hide = await del('factory-frosted');
  list = await getList();
  check('出厂删除 200（清单少一行、无 hidden 形态；包内字节不变）',
    hide.__state.status === 200 && bodyJson(hide).origin === 'builtin'
    && list.presets.length === 7 && !list.presets.some((r) => r.id === 'factory-frosted')
    && !('hidden' in list)
    && dirDigest(BUILTIN) === digestBefore,
    'presets=' + list.presets.length);
  const freed = await create('腾位后的新预设', {}, 'preset-freed-1');
  check('删除腾位后创建放行（已删除的不占上限）', freed.__state.status === 200, 'status=' + freed.__state.status);
  await del('preset-test-1'); // 释放旧位：腾位 + 同名测试要在 8 个活跃内完成

  // 删除期间名字放开：可以存一份叫「重磨砂」的（名字对比域只含活跃清单）
  const nameFreed = await create('重磨砂', { glassAlpha: 50 }, 'preset-rename-1');
  check('删除后出厂名字放开（同名创建 200）', nameFreed.__state.status === 200);
  await del('preset-rename-1');
  await del('preset-freed-1');

  // 不可恢复（2026-10-04 口径）：删墓碑 = 复活的那条通道已封 —— 再删一次 404，
  // 清单依旧没有它；就算那个名字已经空出来，出厂预设也不会回来。
  const restoreAttempt = await del('factory-frosted');
  list = await getList();
  check('出厂删除即永久：再删一次 404、不复活（清单仍没有它）',
    restoreAttempt.__state.status === 404
    && list.presets.length === 6 && !list.presets.some((r) => r.id === 'factory-frosted'),
    'status=' + restoreAttempt.__state.status + ' presets=' + list.presets.length);
  // 墓碑的 tag 值永不许改（改了会让删过的出厂预设复活）—— 值 + 落盘文件双向核对。
  check('墓碑 tag 值原样不动（D6 连带约束）',
    schema.GLASS_PRESET_TOMBSTONE_TAG === 'dsh-we/glass-preset-tombstone@1'
    && readFileSync(join(USER, 'factory-frosted.json'), 'utf8').includes(schema.GLASS_PRESET_TOMBSTONE_TAG),
    schema.GLASS_PRESET_TOMBSTONE_TAG);

  // 用户预设删除 / 404 / 路径安全（形状不变）
  await del('factory-night');           // 删除腾位（不影响包内字节）
  const mk2 = await create('删除语义用的预设', {}, 'preset-test-2');
  const delUser = await del('preset-test-2');
  const delGone = await del('preset-test-2');
  const missing = await get1('preset-nope');
  const escape = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/..%2F..%2Fconfig.json', 'GET'));
  const badId = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/not%20a%20valid%20id!', 'GET'));
  const nightGone = await del('factory-night'); // 已删除的出厂：再删仍 404（不可恢复）
  check('用户删除 200；再删 404；unknown 404；穿越与非法 id 4xx；出厂二次删除仍 404',
    mk2.__state.status === 200 && delUser.__state.status === 200 && bodyJson(delUser).origin === 'user'
    && delGone.__state.status === 404 && missing.__state.status === 404
    && escape.__state.status >= 400 && badId.__state.status === 400
    && nightGone.__state.status === 404,
    [mk2.__state.status, delUser.__state.status, delGone.__state.status, missing.__state.status,
      escape.__state.status, badId.__state.status, nightGone.__state.status].join('/'));
  check('包内目录全程字节不变（删除只落用户层墓碑）', dirDigest(BUILTIN) === digestBefore);
}

// ── ③b 旧 tag 一律作废（D6）══════════════════════════════════════════════════
section('③b 旧 tag 作废：422 + reason 点明版本作废、清单标 broken、墓碑先于版本判定');
{
  // 复刻用户本机升级后的真实形态：用户层一份旧 tag 的玻璃子集预设。
  writeUserFile('preset-old-tag', {
    $schema: OLD_TAG, id: 'preset-old-tag', name: '我以前的玻璃档',
    values: { glassAlpha: 40, blur: 18, settingsVersion: 6 },
  });
  const g = await get1('preset-old-tag');
  const gd = bodyJson(g) || {};
  check('旧 tag 单份 GET ⇒ 422 且 reason=version-obsolete（不是笼统 bad-version）',
    g.__state.status === 422 && gd.reason === 'version-obsolete',
    'status=' + g.__state.status + ' reason=' + gd.reason);
  check('422 的 error 文案点明"版本已作废"并给出重存出路',
    /作废/.test(String(gd.error || '')) && /重新保存/.test(String(gd.error || '')),
    String(gd.error || '').slice(0, 60));
  const lst = await getList();
  const oldRow = (lst.presets || []).find((r) => r.id === 'preset-old-tag');
  check('清单如实标 broken=version-obsolete（不静默隐藏这一行）',
    Boolean(oldRow) && oldRow.broken === 'version-obsolete' && oldRow.origin === 'user',
    JSON.stringify(oldRow || null));
  // 坏 JSON 同样拒读，但 reason 必须与"版本作废"区分开（面板文案按 origin/reason 分口径）。
  writeUserFile('preset-bad-json', '{ this is not json ');
  const gb = await get1('preset-bad-json');
  check('坏 JSON ⇒ 422 且 reason=bad-json（与 version-obsolete 不同因不同文案）',
    gb.__state.status === 422 && (bodyJson(gb) || {}).reason === 'bad-json',
    'reason=' + (bodyJson(gb) || {}).reason);
  // 负对照：合法新 tag 文件在同一条读路径上必须读出 200（证明上面的红不是恒真）。
  writeUserFile('preset-old-good', {
    $schema: schema.PROFILE_PRESET_SCHEMA_TAG, id: 'preset-old-good', name: '合法档',
    values: { glassAlpha: 42 },
  });
  const good2 = await get1('preset-old-good');
  const good2d = bodyJson(good2) || {};
  check('negative control: 新 tag + 稀疏 values 在同一路径上 200 且补齐成完整快照（作废判据不空转）',
    good2.__state.status === 200 && Object.keys(good2d.values || {}).length === schema.PROFILE_PRESET_KEYS.length
    && good2d.values.glassAlpha === 42,
    'status=' + good2.__state.status + ' values=' + Object.keys(good2d.values || {}).length);
  // 墓碑**先于**版本判定：若落到 version-obsolete 分支，删过的出厂预设会复活。
  const tomb = await get1('factory-frosted');
  check('墓碑先判：已删除出厂不被当作"版本作废"（否则删过的出厂预设会复活）',
    (bodyJson(tomb) || {}).reason !== 'version-obsolete'
    && !(await getList()).presets.some((r) => r.id === 'factory-frosted'),
    'status=' + tomb.__state.status + ' reason=' + ((bodyJson(tomb) || {}).reason || '-'));
  // 用户层坏文件遮住随包层同名（同 id 时用户层胜 —— 不能静默回落到出厂那份）。
  const shadowId = 'purple-mood';
  writeUserFile(shadowId, { $schema: OLD_TAG, id: shadowId, name: '遮住的', values: {} });
  const sh = await get1(shadowId);
  const shd = bodyJson(sh) || {};
  check('用户层旧 tag 遮住随包层同名出厂（不回落到出厂那份）',
    sh.__state.status === 422 && shd.origin === 'user' && shd.shadowsBuiltin === true,
    'status=' + sh.__state.status + ' origin=' + shd.origin + ' shadowsBuiltin=' + shd.shadowsBuiltin);
  await del(shadowId);
  const afterUnshadow = await get1(shadowId);
  check('删掉遮住的坏文件后出厂那份回来了（遮蔽只来自用户层文件在场）',
    afterUnshadow.__state.status === 200 && (bodyJson(afterUnshadow) || {}).origin === 'builtin',
    'status=' + afterUnshadow.__state.status);
  await del('preset-old-tag');
  await del('preset-bad-json');
  await del('preset-old-good');
}

// ── ③c 坏预设必须可删（captain 实测出的阻断级缺陷）══════════════════════════
section('③c 坏预设可删 + 坏行计入上限（既存得进也清得掉，不许死锁）');
{
  const countOf = async () => ((await getList()).presets || []).length;
  const countBefore = await countOf();
  writeUserFile('preset-stuck-old', { $schema: OLD_TAG, id: 'preset-stuck-old', name: '升级留下的坏行', values: {} });
  const withBad = await getList();
  const badRow = (withBad.presets || []).find((r) => r.id === 'preset-stuck-old');
  check('坏行计入活跃清单（这就是死锁的来源，钉住"坏行占位"这个事实）',
    Boolean(badRow) && badRow.broken === 'version-obsolete'
    && (withBad.presets || []).length === countBefore + 1,
    '清单 ' + countBefore + ' → ' + (withBad.presets || []).length);
  // 把现场推到边界：填到 8 个活跃（含那条坏行）。
  let guard = 0;
  while ((await countOf()) < 8 && guard++ < 12) {
    const n = 'filler-' + (await countOf());
    const r = await create(n, {}, n);
    if (r.__state.status !== 200) break;
  }
  const fullList = await getList();
  check('前置：清单已达上限 8（含那条坏行）', (fullList.presets || []).length === 8,
    (fullList.presets || []).filter((r) => r.broken).length + ' 条坏行');
  const blockedCreate = await create('坏行挡路的创建', {}, 'preset-blocked');
  check('满额时创建 409（坏行占位 ⇒ 这正是缺陷的表现）',
    blockedCreate.__state.status === 409, 'status=' + blockedCreate.__state.status);
  // ★ 核心：坏行必须**删得掉**（缺陷版返回 404 unknown preset ⇒ 永远删不掉）。
  const delBad = await del('preset-stuck-old');
  const goneFromDisk = !existsSync(userFilePath('preset-stuck-old'));
  check('★ 旧 tag 坏行 DELETE ⇒ 200 且文件真的从盘上消失（缺陷版此处 404）',
    delBad.__state.status === 200 && goneFromDisk,
    'status=' + delBad.__state.status + ' 盘上还在=' + (!goneFromDisk));
  const unblocked = await create('删掉坏行后的创建', {}, 'preset-unblocked');
  check('删除腾位后 create 放行（名额确实腾出来了）',
    unblocked.__state.status === 200, 'status=' + unblocked.__state.status);
  // 坏 JSON 同样可删（同一根因的第二种形态）。
  writeUserFile('preset-stuck-json', 'not json at all {');
  const delBadJson = await del('preset-stuck-json');
  check('坏 JSON 行 DELETE ⇒ 200 且文件消失（同一修复覆盖两种坏法）',
    delBadJson.__state.status === 200 && !existsSync(userFilePath('preset-stuck-json')),
    'status=' + delBadJson.__state.status);
  // 既有三分语义不许被这次修复破坏。
  const tombAgain = await del('factory-frosted');
  check('三分语义①：墓碑（reason=deleted）再删仍 404、不复活',
    tombAgain.__state.status === 404 && !(await getList()).presets.some((r) => r.id === 'factory-frosted'),
    'status=' + tombAgain.__state.status);
  const builtinOnly = await del('factory-vivid');
  const tombFile = existsSync(userFilePath('factory-vivid'))
    && readFileSync(userFilePath('factory-vivid'), 'utf8').includes(schema.GLASS_PRESET_TOMBSTONE_TAG);
  check('三分语义②：只有随包层 ⇒ 写墓碑、回 origin=builtin',
    builtinOnly.__state.status === 200 && (bodyJson(builtinOnly) || {}).origin === 'builtin' && tombFile,
    'status=' + builtinOnly.__state.status);
  const neither = await del('preset-never-existed');
  check('三分语义③：两层都没有 ⇒ 404', neither.__state.status === 404, 'status=' + neither.__state.status);
  // 清理本段造的 filler / unblocked，避免污染后续段的前提。
  for (const r of (await getList()).presets || []) {
    if (r.origin === 'user') await del(r.id);
  }
}

// ── ③d 资产勾选 / install-assets / export / import / 字节闸 ══════════════════
section('③d 资产段：install-assets 落盘与 applied 语义、export→import 往返、单份字节闸');
{
  // 本机放一份立绘与两张头像，让 embed 有东西可内嵌（复用宿主自己的目录与命名形状）。
  mkdirSync(MASCOT_DIR, { recursive: true });
  mkdirSync(AVATARS_DIR, { recursive: true });
  // ⚠️ 文件名必须落在 `AVATAR_FILE_RE` / `MASCOT_FILE_RE` 的合法形状里：前缀后 `[a-z0-9]{4,16}`，
  //    **只能小写字母 + 数字**（混大写会被消毒回默认空串 ⇒ embed 拿不到段、后面所有落盘判据全体失真）。
  //    名字本身合不合法由下面那条「台架前提」判据核对，不靠注释里的自觉。种子在 install-assets
  //    成功后会被"清同族旧文件"换掉，所以下面的判据不按个数、按**字节数**认它们。
  const PNG1 = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    + '0000000a49444154789c6360000002000100ffff0300000600055fbf0d4f0000000049454e44ae426082', 'hex');
  writeFileSync(join(MASCOT_DIR, 'mascot-guardseed.png'), PNG1);
  writeFileSync(join(AVATARS_DIR, 'user-guardseed.png'), PNG1);
  writeFileSync(join(AVATARS_DIR, 'ai-guardseed.png'), PNG1);

  // ★★ 台架自身的**承重前提**（本仓最典型的"看起来对、实际不是那回事"就出在这一段）：
  //   上面三个种子名必须真的过宿主自己的两条正则 —— 否则 `embed` 会静默拿到**空段**，
  //   于是"落盘 / 清同族 / applied 只含实际安装的段 / 字节闸点名是哪一项"这一整组判据
  //   **失去被测对象却照样一条条报绿**。实测第一版把种子写成 `mascot-guard01.png`
  //   （前缀后只剩 2 个字符，`{4,16}` 不认）⇒ 三条前置全 ✓、紧随的落盘判据拿到空串而红。
  check('台架前提：三个种子的文件名确实过宿主自己的正则（否则内嵌拿到空段、下面全体判据空转）',
    MASCOT_FILE_RE.test('mascot-guardseed.png')
    && AVATAR_FILE_RE.test('user-guardseed.png') && AVATAR_FILE_RE.test('ai-guardseed.png'),
    String(MASCOT_FILE_RE) + ' | ' + String(AVATAR_FILE_RE));

  const withEmbed = await create('带资产的快照', { glassAlpha: 51 }, 'preset-embed-1', ['font', 'mascot', 'avatar']);
  const weData = bodyJson(withEmbed) || {};
  // 前置：内嵌这条路真的拿到了本机资产（种子名不合法 / 读不出 ⇒ assets 会是空段，
  // 后面所有落盘判据都会"看起来红其实是没东西可测"）。这条把前提钉死。
  check('前置：create+embed 从本机取到三段资产（立绘与两张头像的文件名都非空）',
    weData.assets && weData.assets.mascot && weData.assets.mascot.file === 'mascot-guardseed.png'
    && weData.assets.avatar && weData.assets.avatar.user && weData.assets.avatar.user.file === 'user-guardseed.png'
    && weData.assets.avatar.ai && weData.assets.avatar.ai.file === 'ai-guardseed.png',
    JSON.stringify(weData.assets && weData.assets.mascot));
  check('create + embed ⇒ 回包 assets 只含元数据（不含图片字节 data）',
    withEmbed.__state.status === 200 && weData.assets
    && weData.assets.mascot && weData.assets.mascot.file === 'mascot-guardseed.png'
    && !('data' in (weData.assets.mascot || {}))
    && weData.assets.avatar && !('data' in ((weData.assets.avatar || {}).user || {})),
    JSON.stringify(Object.keys(weData.assets || {})));
  check('embed 的字体段带 name + values（宿主从活动字体集取，客户端不上传）',
    weData.assets && weData.assets.font && weData.assets.font.values
    && Object.keys(weData.assets.font.values).length === schema.FONTSET_KEYS.length,
    JSON.stringify(weData.assets && weData.assets.font && Object.keys(weData.assets.font)));

  // install-assets：三段都在 ⇒ applied 三段都有
  const ia = await installAssetsCall('preset-embed-1');
  const iaData = bodyJson(ia) || {};
  // ⚠️ 台架自己的前提核对（**不是**对实现的判据）：本文件顶层从 settings-schema 抽出的两条正则，
  //   必须与宿主 `lib/index.js` 里那份**逐字相同**。不同 ⇒ 下面所有"名字合不合法"的判据读的都是
  //   一份歪的尺子（这正是"看起来对、实际不是那回事"）。写这段守卫时它就以 ReferenceError 暴露了
  //   一次块内遮蔽，所以这条要留在跑测输出里当护栏。
  // ⚠️ 读点变更（T2 #8）：`MASCOT_FILE_RE` / `AVATAR_FILE_RE` 的定义已搬进 lib/asset-paths.js
  //    ⇒ 只改"读哪个文件"，下面 hostLit 抽取式与那条逐字一致判据（含 check 文案）一字未改。
  const hostIdxSrc = readFileSync(join(root, 'lib', 'asset-paths.js'), 'utf8');
  const hostLit = (name) => {
    const m = hostIdxSrc.match(new RegExp('const ' + name + ' = (/(?:[^/\\\\]|\\\\.)*/);'));
    return m ? m[1] : '(未找到)';
  };
  check('台架前提：守卫抽出的两条正则与 lib/index.js 里宿主那份逐字相同（尺子没歪）',
    String(MASCOT_FILE_RE) === hostLit('MASCOT_FILE_RE') && String(AVATAR_FILE_RE) === hostLit('AVATAR_FILE_RE'),
    '守卫=' + String(MASCOT_FILE_RE) + ' | 宿主=' + hostLit('MASCOT_FILE_RE'));
  check('install-assets 三段齐 ⇒ applied 含 font/mascot/avatar 三段',
    ia.__state.status === 200 && iaData.applied
    && iaData.applied.font && iaData.applied.mascot && iaData.applied.avatar
    && iaData.applied.avatar.user && iaData.applied.avatar.ai,
    JSON.stringify(Object.keys(iaData.applied || {})));
  // ★★ F-1（**定时炸弹，不是当场爆**，见汇报）：`landImage()` 落盘的名字 = 前缀 + `assetStamp()`。
  //   `assetStamp() = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)` ⇒ 实测恒 **12** 字符
  //   （时间戳段 8 + 随机段 4）。真源 `MASCOT_FILE_RE` / `AVATAR_FILE_RE` 是 `[a-z0-9]{4,16}` ——
  //   按当前长度它**认得**，所以这条判据今天绿；但余量只有 4 个字符，而 base36 的时间戳只会变长
  //   （`Date.now()` 到 2027 年前后进 9 位、再往后 10 位…）⇒ stamp 一旦超过 16，
  //   **落盘仍然成功、名字却存不进 settings**（readOne 回默认空串 ⇒ 屏上永远旧图，用户看到"导入没生效"）。
  //   ⚠️ 本判据引用从 settings-schema 抽出的同一条正则（不手抄），实现与真源一旦分叉就叫红；
  //   下面那条「余量量化」把还剩几个字符钉成数字 —— 余量归零那天它会自己变红，不用等人想起来。
  const mascotApplied = String(((iaData.applied || {}).mascot || {}).file || '');
  const userApplied = String((((iaData.applied || {}).avatar || {}).user || {}).file || '');
  const aiApplied = String((((iaData.applied || {}).avatar || {}).ai || {}).file || '');
  check('立绘落盘到 mascot/、头像两方各落一张到 avatars/，且落下的名字能被宿主自己的正则认下',
    MASCOT_FILE_RE.test(mascotApplied) && existsSync(join(MASCOT_DIR, mascotApplied))
    && AVATAR_FILE_RE.test(userApplied) && /^user-/.test(userApplied)
    && existsSync(join(AVATARS_DIR, userApplied))
    && AVATAR_FILE_RE.test(aiApplied) && /^ai-/.test(aiApplied)
    && existsSync(join(AVATARS_DIR, aiApplied)),
    'mascot=' + mascotApplied + '(' + MASCOT_FILE_RE.test(mascotApplied) + ')'
    + ' user=' + userApplied + '(' + AVATAR_FILE_RE.test(userApplied) + ')'
    + ' ai=' + aiApplied + '(' + AVATAR_FILE_RE.test(aiApplied) + ')');
  // 逐项定位到底是哪一段不合格（否则上面那条聚合判据红了却没人知道该修哪一头）。
  {
    const rejected = [
      ['mascot', mascotApplied, MASCOT_FILE_RE],
      ['avatar.user', userApplied, AVATAR_FILE_RE],
      ['avatar.ai', aiApplied, AVATAR_FILE_RE],
    ].filter(([, v, re]) => !re.test(v));
    check('F-1 定位：三段落地文件名里被真源拒收的是哪些（空 = 全部合法）',
      rejected.length === 0,
      rejected.length ? rejected.map(([n, v]) => n + '=' + v).join(' | ') : '三段都合法');
  }
  // ★ F-1 的**量化证据**：按 `assetStamp()` 原式采样量出实际最长长度，再用真源去撞它的上限。
  //   ⚠️ 上限值也**从源码抽**（不写死 16）—— 真源哪天放宽，这条跟着走；实现哪天超长，这条先红。
  {
    const quant = Number((MASCOT_FILE_RE.source.match(/\[a-z0-9\]\{(\d+),(\d+)\}/) || [])[2]);
    let stampMax = 0;
    for (let i = 0; i < 5000; i++) {
      stampMax = Math.max(stampMax, (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).length);
    }
    check('★ F-1 余量量化：assetStamp() 当前最长 ' + stampMax + ' 字符 vs 真源上限 ' + quant
      + ' ⇒ 只剩 ' + (quant - stampMax) + ' 个字符（进位即全线失效）',
      Number.isFinite(quant) && stampMax <= quant
      && MASCOT_FILE_RE.test('mascot-' + 'x'.repeat(quant) + '.png')
      && !MASCOT_FILE_RE.test('mascot-' + 'x'.repeat(quant + 1) + '.png'),
      '时间戳段=' + Date.now().toString(36).length + ' 位 + 随机段 4 位；base36 时间戳还会继续变长');
  }  check('换图清同族旧文件（mascot/ 与 avatars/ 各侧只剩刚落的这一张）',
    readdirSync(MASCOT_DIR).filter((f) => f.startsWith('mascot-')).length === 1
    && readdirSync(AVATARS_DIR).filter((f) => f.startsWith('user-')).length === 1
    && readdirSync(AVATARS_DIR).filter((f) => f.startsWith('ai-')).length === 1,
    JSON.stringify({ mascot: readdirSync(MASCOT_DIR), avatars: readdirSync(AVATARS_DIR) }));

  // ★ 缺席语义（与 settings 段相反）：正文没有资产段 ⇒ applied 为空对象、一个键都不碰。
  const noAssets = await create('纯数值快照', { glassAlpha: 52 }, 'preset-noassets-1');
  check('前置：未勾资产的 create 回包没有 assets 键', !('assets' in (bodyJson(noAssets) || {})));
  const iaNone = bodyJson(await installAssetsCall('preset-noassets-1')) || {};
  check('★ 正文无资产段 ⇒ install-assets 的 applied 是空对象（缺席段不出现在 applied 里）',
    iaNone.ok === true && iaNone.applied && Object.keys(iaNone.applied).length === 0,
    JSON.stringify(iaNone.applied));
  check('★ 负对照：上一步之后 mascot/ 仍是那一张（缺席段没有被"清空成空文件名"）',
    readdirSync(MASCOT_DIR).filter((f) => f.startsWith('mascot-')).length === 1,
    readdirSync(MASCOT_DIR).join(','));
  // 只勾 mascot 的一段预设 ⇒ applied 只有 mascot（font/avatar 不出现）。
  const onlyM = bodyJson(await create('只带立绘', {}, 'preset-only-mascot', ['mascot'])) || {};
  check('前置：embed=[mascot] ⇒ assets 只有 mascot 段',
    onlyM.assets && Object.keys(onlyM.assets).length === 1 && 'mascot' in onlyM.assets,
    JSON.stringify(Object.keys(onlyM.assets || {})));
  const iaOnly = bodyJson(await installAssetsCall('preset-only-mascot')) || {};
  check('只带一段 ⇒ applied 只含实际安装的那一段（其余段缺席即不出现）',
    Object.keys(iaOnly.applied || {}).length === 1 && 'mascot' in (iaOnly.applied || {}),
    JSON.stringify(Object.keys(iaOnly.applied || {})));

  // ★ 三态（2026-10-12）：`assets.<seg> === null` = **显式声明「无」** ⇒ 那一族回内置默认
  //   （宿主先删本机同族文件再置空键；读侧 `mascotPath()` / `avatarPath()` 是**按前缀扫目录
  //   取第一个命中**、不看 settings 记的文件名 ⇒ 只置空键清不干净）。这是"范围小的预设必须
  //   能撤销范围大的预设装上的资产"的落点：四套不带立绘的出厂预设就此声明 null（见 ① 段钉子）。
  check('★ sanitizePresetAssets 认「显式声明无」：`{mascot:null}` 原样保 null（不折成空对象、不丢键）',
    JSON.stringify(schema.sanitizePresetAssets({ mascot: null })) === '{"mascot":null}'
    && JSON.stringify(schema.sanitizePresetAssets({ font: null, mascot: null })) === '{"font":null,"mascot":null}'
    && JSON.stringify(schema.sanitizePresetAssets({ mascot: false })) === '{}',
    JSON.stringify(schema.sanitizePresetAssets({ mascot: null })) + ' / false⇒'
    + JSON.stringify(schema.sanitizePresetAssets({ mascot: false })));
  // ★ 第四态（2026-10-12「同一个字段两种指向」）：mascot 也可以是**字符串** = 指向出厂自带形态，
  //   值域就是 ROPE_FORM_VALUES（`maid` 已于 2026-10-13 从出厂形态除名，见本文件 ① 段）。认不清的
  //   字符串**整段丢掉** ⇒ 语义回到"缺席 = 不动"—— 不猜 'builtin:whale'、也不把垃圾折成 'whale'。
  check('★ sanitizePresetAssets 认「指向内置形态」（字符串原样保留；值域外 / 其它类型不猜）',
    JSON.stringify(schema.sanitizePresetAssets({ mascot: 'phoebe' })) === '{"mascot":"phoebe"}'
    && JSON.stringify(schema.sanitizePresetAssets({ mascot: 'whale' })) === '{"mascot":"whale"}'
    && JSON.stringify(schema.sanitizePresetAssets({ mascot: 'dragon' })) === '{}'
    && JSON.stringify(schema.sanitizePresetAssets({ mascot: 'WHALE' })) === '{}'
    && JSON.stringify(schema.sanitizePresetAssets({ mascot: 'maid' })) === '{}'
    && JSON.stringify(schema.sanitizePresetAssets({ mascot: 42 })) === '{}'
    && JSON.stringify(schema.sanitizePresetAssets({ avatar: 'phoebe' })) === '{}',
    JSON.stringify(schema.sanitizePresetAssets({ mascot: 'phoebe' })) + ' / dragon⇒'
    + JSON.stringify(schema.sanitizePresetAssets({ mascot: 'dragon' }))
    + ' / maid⇒' + JSON.stringify(schema.sanitizePresetAssets({ mascot: 'maid' }))
    + ' / avatar:phoebe⇒' + JSON.stringify(schema.sanitizePresetAssets({ avatar: 'phoebe' })));
  {
    // 造"勾了而本机没有"的真实来路：先把本机立绘文件挪走，再走 create 的 embed 名单。
    const beforeM = readdirSync(MASCOT_DIR).filter((f) => f.startsWith('mascot-'));
    for (const f of beforeM) rmSync(join(MASCOT_DIR, f), { force: true });
    const declM = bodyJson(await create('声明无立绘', { glassAlpha: 47 }, 'preset-declare-none-m', ['mascot'])) || {};
    check('★ 勾了而本机没有 ⇒ create 落 `assets.mascot = null`（显式声明无，不再把整段丢掉）',
      declM.ok === true && declM.assets && 'mascot' in declM.assets && declM.assets.mascot === null,
      JSON.stringify(declM.assets));
    const iaDeclM = bodyJson(await installAssetsCall('preset-declare-none-m')) || {};
    check('★ 声明无的预设 install-assets ⇒ `applied.mascot = {cleared:true}` 且 mascot/ 被清空',
      declM.ok === true && iaDeclM.ok === true && iaDeclM.applied && iaDeclM.applied.mascot
      && iaDeclM.applied.mascot.cleared === true
      && readdirSync(MASCOT_DIR).filter((f) => f.startsWith('mascot-')).length === 0,
      JSON.stringify({ before: beforeM.length, applied: iaDeclM.applied, after: readdirSync(MASCOT_DIR) }));
    await del('preset-declare-none-m');
    // 头像族同形（整族声明无 ⇒ 两侧一起清）。
    const beforeA = readdirSync(AVATARS_DIR);
    for (const f of beforeA) rmSync(join(AVATARS_DIR, f), { force: true });
    const declA = bodyJson(await create('声明无头像', { glassAlpha: 48 }, 'preset-declare-none-a', ['avatar'])) || {};
    check('★ 勾了而本机两侧都没有头像 ⇒ create 落 `assets.avatar = null`',
      declA.ok === true && declA.assets && 'avatar' in declA.assets && declA.assets.avatar === null,
      JSON.stringify(declA.assets));
    const iaDeclA = bodyJson(await installAssetsCall('preset-declare-none-a')) || {};
    check('★ 头像族声明无 ⇒ `applied.avatar = {cleared:true}` 且两侧文件都被清',
      declA.ok === true && iaDeclA.applied && iaDeclA.applied.avatar && iaDeclA.applied.avatar.cleared === true
      && readdirSync(AVATARS_DIR).length === 0,
      JSON.stringify({ before: beforeA.length, applied: iaDeclA.applied, after: readdirSync(AVATARS_DIR) }));
    await del('preset-declare-none-a');
    // 复位：把带内嵌字节的那一份重新应用，让后面"整批语义"按 PNG1 字节计数的判据仍有图可数
    //   （⚠️ 必须先复位再往下走，否则那些判据会因为"图被本探针清了"而假红）。
    const iaRestore = bodyJson(await installAssetsCall('preset-embed-1')) || {};
    check('前置复位：重新应用带字节的那份预设 ⇒ 立绘 1 张 + 头像 2 张都回来',
      iaRestore.ok === true
      && readdirSync(MASCOT_DIR).some((f) => statSync(join(MASCOT_DIR, f)).size === PNG1.length)
      && readdirSync(AVATARS_DIR).filter((f) => statSync(join(AVATARS_DIR, f)).size === PNG1.length).length === 2,
      JSON.stringify({ mascot: readdirSync(MASCOT_DIR), avatars: readdirSync(AVATARS_DIR) }));
  }

  // export → import 往返
  const exp = await exportPreset('preset-embed-1', 'font,mascot,avatar');
  const expDoc = JSON.parse(exp.__state.body.toString('utf8'));
  check('export 200 + Content-Disposition: attachment（普通链接下载，不走 blob）',
    exp.__state.status === 200 && /^attachment; filename="preset-embed-1\.json"$/.test(String(exp.__state.headers['Content-Disposition'] || '')),
    String(exp.__state.headers['Content-Disposition'] || ''));
  check('export 正文带完整 settings 段 + 三项资产段（含图片字节）',
    expDoc.$schema === schema.PROFILE_PRESET_SCHEMA_TAG
    && Object.keys(expDoc.values || {}).length === schema.PROFILE_PRESET_KEYS.length
    && expDoc.values.glassAlpha === 51
    && expDoc.assets && expDoc.assets.mascot && expDoc.assets.mascot.data
    && expDoc.assets.avatar && expDoc.assets.avatar.user.data,
    'assets=' + Object.keys(expDoc.assets || {}).join(','));
  const expFewDoc = JSON.parse((await exportPreset('preset-embed-1', 'mascot')).__state.body.toString('utf8'));
  check('★ export 只请求一段 ⇒ 未被请求的段**不出现**在正文里（不是空段占位）',
    expFewDoc.assets && Object.keys(expFewDoc.assets).length === 1 && 'mascot' in expFewDoc.assets
    && !('font' in expFewDoc.assets) && !('avatar' in expFewDoc.assets),
    JSON.stringify(Object.keys(expFewDoc.assets || {})));
  const expNoneDoc = JSON.parse((await exportPreset('preset-embed-1', '')).__state.body.toString('utf8'));
  check('export 不带 assets= ⇒ 正文完全没有 assets 键（数值照旧完整）',
    !('assets' in expNoneDoc) && Object.keys(expNoneDoc.values || {}).length === schema.PROFILE_PRESET_KEYS.length,
    Object.keys(expNoneDoc).join(','));

  // import：把导出的正文原样 POST 回来，读回应与所携资产段一致
  const imp = await importPreset(expDoc);
  const impData = bodyJson(imp) || {};
  check('import 200（按占用分配新 id，不自动应用）',
    imp.__state.status === 200 && impData.ok === true && typeof impData.id === 'string' && impData.id,
    JSON.stringify({ status: imp.__state.status, id: impData.id }));
  const back = bodyJson(await get1(impData.id)) || {};
  check('往返：读回的 settings 段与导出正文逐键一致（100 键、值不漂）',
    Object.keys(back.values || {}).length === schema.PROFILE_PRESET_KEYS.length
    && JSON.stringify(back.values) === JSON.stringify(expDoc.values),
    'glassAlpha=' + (back.values || {}).glassAlpha);
  check('往返：读回的资产段元数据与导出所携一致（文件名同源）',
    back.assets && back.assets.mascot && back.assets.mascot.file === expDoc.assets.mascot.file
    && back.assets.avatar && back.assets.avatar.user.file === expDoc.assets.avatar.user.file,
    JSON.stringify(Object.keys(back.assets || {})));
  const impOld = await importPreset({ $schema: OLD_TAG, id: 'x', name: '旧版预设', values: { glassAlpha: 1 } });
  check('import 旧 tag ⇒ 400 + reason=version-obsolete 且文案点名需要的标记',
    impOld.__state.status === 400 && (bodyJson(impOld) || {}).reason === 'version-obsolete'
    && String((bodyJson(impOld) || {}).error || '').includes(schema.PROFILE_PRESET_SCHEMA_TAG),
    String((bodyJson(impOld) || {}).error || '').slice(0, 70));
  const impGarbage = await importPreset('[1,2,3]');
  check('import 非对象正文 ⇒ 400（不猜、不静默降级）', impGarbage.__state.status === 400,
    'status=' + impGarbage.__state.status);

  // ★ 第四态走**真实来路**（import）：别人分享一份「指向内置形态」的预设 ⇒ 宿主只清本机立绘族、
  //   把形态回给客户端，**一个字节都不落**；导出时也必须**照抄**那个字符串 —— 若这里回落成
  //   `currentSegment`（本机那张图），"指向内置"就退化成"把导出者自己的自定义图内嵌给别人"。
  {
    // 数量上限 8：先把不再需要的用户预设删掉腾位（`preset-embed-1` 要留着 —— 末尾复位与
    //   "带字节"的判据还用它），否则这次 import 只会撞 409 而测不到第四态。
    for (const r of (await getList()).presets || []) {
      if (r.origin === 'user' && r.id !== 'preset-embed-1') await del(r.id);
    }
    const ptrDoc = JSON.parse(JSON.stringify(expDoc));
    ptrDoc.name = '指向内置菲比';
    delete ptrDoc.id;
    ptrDoc.assets = { mascot: 'phoebe' };
    const impPtr = await importPreset(ptrDoc);
    const ptrId = (bodyJson(impPtr) || {}).id;
    const ptrBack = (bodyJson(await get1(ptrId)) || {}).assets || {};
    check('前置：import 收下 mascot 字符串态（读回仍是 "phoebe"，没被折成 null / 空对象）',
      impPtr.__state.status === 200 && typeof ptrId === 'string' && ptrBack.mascot === 'phoebe',
      JSON.stringify({ status: impPtr.__state.status, err: String((bodyJson(impPtr) || {}).error || '').slice(0, 80), id: ptrId, mascot: ptrBack.mascot }));
    const iaPtr = bodyJson(await installAssetsCall(ptrId)) || {};
    check('★ 指向内置形态 install-assets ⇒ `applied.mascot = {form:"phoebe"}` 且立绘族被清（零字节落盘）',
      iaPtr.ok === true && iaPtr.applied && iaPtr.applied.mascot
      && iaPtr.applied.mascot.form === 'phoebe'
      && readdirSync(MASCOT_DIR).filter((f) => f.startsWith('mascot-')).length === 0,
      JSON.stringify(iaPtr.applied));
    const expPtrDoc = JSON.parse((await exportPreset(ptrId, 'mascot')).__state.body.toString('utf8'));
    check('★ export 照抄字符串指向（不回落本机资产）',
      expPtrDoc.assets && expPtrDoc.assets.mascot === 'phoebe',
      JSON.stringify(expPtrDoc.assets));
    await del(ptrId);
    // 复位（同 ① 段末尾）：把带内嵌字节的那份重新应用，让后面按 PNG1 字节计数的判据仍有图可数。
    await installAssetsCall('preset-embed-1');
  }

  // ★ 「指向出厂自带」的**第二条真实来路**：客户端「吉祥物 · 指向」把声明交给 create / export
  //   （`point` 字段 / `?point=mascot:<形态>`）⇒ 宿主把那一段落成**字符串**（零字节、不带图）。
  //   三条要钉的事：① 声明**赢过内嵌**（同一段两者同时给）；② 认不清的段名 / 形态**整条丢**
  //   （不猜、也绝不折成 `null` —— 丢 = 该段回到"缺席 = 不动"）；③ 预设自己已有的 `null` /
  //   字符串**照抄自己的**，声明只补"真的没有内容"的段（导出这条路上老行为是本机现值）。
  {
    const mascotFiles = () => readdirSync(MASCOT_DIR).filter((f) => f.startsWith('mascot-')).sort().join(',');
    const filesBefore = mascotFiles();
    const pWhale = bodyJson(await create('指向Deepseek_Pro', {}, 'preset-point-whale', null, { mascot: 'whale' })) || {};
    const docWhale = JSON.parse(readFileSync(userFilePath('preset-point-whale'), 'utf8'));
    check('★ create 带 point ⇒ 那一段落成字符串指向（零字节、不带图），settings 段照旧全量',
      pWhale.assets && pWhale.assets.mascot === 'whale'
      && docWhale.assets && docWhale.assets.mascot === 'whale'
      && Object.keys(docWhale.values || {}).length === schema.PROFILE_PRESET_KEYS.length,
      JSON.stringify({ 回包: pWhale.assets, 落盘: docWhale.assets, 键数: Object.keys(docWhale.values || {}).length }));
    check('★ create 带 point 不碰本机立绘族（指向是纯文本声明，一个字节都不落）',
      mascotFiles() === filesBefore, mascotFiles());
    const pBoth = bodyJson(await create('声明赢过内嵌', {}, 'preset-point-both', ['mascot'], { mascot: 'whale' })) || {};
    const sizeBoth = statSync(userFilePath('preset-point-both')).size;
    check('★ point 与 embed 同时给 ⇒ 声明赢（落字符串，正文里没有那份 base64 大图）',
      pBoth.assets && pBoth.assets.mascot === 'whale' && sizeBoth < 20000,
      JSON.stringify({ 回包: pBoth.assets, 正文大小: sizeBoth }));
    const pBad = bodyJson(await create('认不清的指向', {}, 'preset-point-bad', null, { mascot: 'dragon', avatar: 'phoebe' })) || {};
    check('★ 认不清的 point（值域外的形态 / 别的段名）整条丢：那一段回到"缺席"（不折成 null）',
      !('assets' in pBad) && !('assets' in (bodyJson(await get1('preset-point-bad')) || {})),
      JSON.stringify(pBad.assets));
    const expOwn = JSON.parse((await exportPreset('preset-point-whale', null, 'mascot:phoebe')).__state.body.toString('utf8'));
    check('★ export 只带 point（不带 assets=）也能成段；预设自己已有的指向**照抄自己的**',
      expOwn.assets && expOwn.assets.mascot === 'whale', JSON.stringify(expOwn.assets));
    const expFill = JSON.parse((await exportPreset('preset-point-bad', null, 'mascot:whale')).__state.body.toString('utf8'));
    check('★ export 对"预设这一段真的没内容"的段用调用方的指向（老行为是本机现值）',
      expFill.assets && expFill.assets.mascot === 'whale', JSON.stringify(expFill.assets));
    const iaPoint = bodyJson(await installAssetsCall('preset-point-whale')) || {};
    check('★ create 出来的指向预设可安装：applied.mascot = {form:"whale"} 且立绘族被清（与 import 那条路同结果）',
      iaPoint.ok === true && iaPoint.applied && iaPoint.applied.mascot
      && iaPoint.applied.mascot.form === 'whale'
      && readdirSync(MASCOT_DIR).filter((f) => f.startsWith('mascot-')).length === 0,
      JSON.stringify(iaPoint.applied));
    for (const id of ['preset-point-whale', 'preset-point-both', 'preset-point-bad']) await del(id);
    // 复位（同 ① 段末尾）：把带内嵌字节的那份重新应用 —— 后面的判据还要按 PNG1 字节数立绘。
    // ⚠️ 落盘文件名**每次安装都重新分配**（`landImage` 生成新名，见 `lib/routes/presets.js:929` /
    //   回执 `applied.mascot.file` 见 `lib/routes/presets.js:931`）⇒ 收尾判据不能拿"复位前那个名字"
    //   去比（那会把正常的重新落盘判成副作用，是台架自己造的假红）。判据改为：立绘族**恰好一份**，
    //   且就是这次复位回执点名的那一份 —— 既钉住"没有多出来的残留文件"，又不依赖随机名。
    const restore = bodyJson(await installAssetsCall('preset-embed-1')) || {};
    const restoreFile = restore.applied && restore.applied.mascot ? restore.applied.mascot.file : '';
    check('★ 本块收尾：立绘族恰好一份，且 = 复位回执点名的那份（上面的清理没有留下副作用）',
      Boolean(restoreFile) && mascotFiles() === restoreFile,
      JSON.stringify({ 场上: mascotFiles(), 复位前: filesBefore, 回执: restore.applied }));
  }

  // ── 字节闸 ──
  // ★ 单份资产闸（**解码后** 8MB）。测法说明（为什么这样造才不空转）：
  //   `import` 的顺序是「tag ⇒ **数量上限** ⇒ 分配 id ⇒ writePreset」，而 `writePreset` **只消毒不落字节**
  //   （sanitizePresetAssets 原样保留 data 字符串）⇒ 走 import 永远撞不到单份闸。
  //   真正执行单份闸的是 `install-assets`（assetOverBudget 在落盘前判）。所以这里分两步：
  //     ① 用 create + embed 让宿主把**本机那张超重立绘**内嵌进正文并落盘 —— 这条路上没有单份闸
  //        （它读的是本机文件），这正是"一份带超图的预设怎么进到用户机器上"的真实来路；
  //     ② 再对它调 install-assets ⇒ 必须被拒且**点名是哪一项**。
  //   ⚠️ 9 MiB 的图编成 base64 是 12 MiB 字符 ⇒ 已经**超过 create 自己的 128 KiB 收体闸**
  //      （回包会把整份正文吐回来）。所以这一步之后必须先把清单清到只剩出厂那几套，
  //      否则紧随的 import 探针只会撞上"数量已达上限"的 409，而不是我们要测的那道闸。
  const bigBuf = Buffer.alloc(9 * 1024 * 1024, 7);           // 9 MiB 的"图"
  for (const r of (await getList()).presets || []) { if (r.origin === 'user') await del(r.id); }
  writeFileSync(join(MASCOT_DIR, 'mascot-fatchk.png'), bigBuf);
  const fatCreate = bodyJson(await create('超重的立绘', {}, 'preset-fat-mascot', ['mascot'])) || {};
  check('前置：create+embed 把本机那张 9MiB 立绘内嵌进正文并落盘了（证明下面的红来自闸而不是没读到文件）',
    fatCreate.id === 'preset-fat-mascot' && existsSync(userFilePath('preset-fat-mascot'))
    && statSync(userFilePath('preset-fat-mascot')).size > 8 * 1024 * 1024,
    'id=' + fatCreate.id + ' 正文大小=' + (existsSync(userFilePath('preset-fat-mascot')) ? statSync(userFilePath('preset-fat-mascot')).size : 'N/A'));
  // ★ 这条同时钉住一个**真实边界**：create 的收体闸只管"请求体"，而宿主自己内嵌出来的正文
  //   可以远大于它（这里 12 MiB）。这是 D5 的刻意分工 —— create 不收客户端字节，
  //   单份资产的大小由 install-assets 那道闸兜住。若哪天有人把两者混成一个数字，这里会红。
  check('★ create 的内嵌正文可以超过其收体闸（两道闸各司其职；超限由 install-assets 兜住）',
    !('error' in fatCreate) && existsSync(userFilePath('preset-fat-mascot')),
    JSON.stringify(Object.keys(fatCreate)));
  const iaFatMascot = await installAssetsCall('preset-fat-mascot');
  const iaFatMascotErr = String((bodyJson(iaFatMascot) || {}).error || '');
  check('★ 单份资产超 8MB ⇒ install-assets 整批拒绝且错误**点名 mascot 这一项**（不静默截断）',
    iaFatMascot.__state.status === 500 && /mascot/.test(iaFatMascotErr) && /8MB/.test(iaFatMascotErr),
    'status=' + iaFatMascot.__state.status + ' err=' + iaFatMascotErr.slice(0, 90));
  await del('preset-fat-mascot');
  // 负对照：超限项换成 avatar.ai ⇒ 点名的必须是 avatar.ai —— 证明"点名"不是硬编码字样。
  writeFileSync(join(AVATARS_DIR, 'ai-fatchk.png'), bigBuf);
  const fatAvCreate = bodyJson(await create('超重的头像', {}, 'preset-fat-avatar', ['avatar'])) || {};
  const iaFatAvatar = await installAssetsCall(fatAvCreate.id || 'preset-fat-avatar');
  const iaFatAvatarErr = String((bodyJson(iaFatAvatar) || {}).error || '');
  check('negative control: 超限项换成 avatar.ai ⇒ 点名的就是 avatar.ai（不是硬编码 mascot 字样）',
    iaFatAvatar.__state.status === 500 && /avatar\.ai/.test(iaFatAvatarErr) && !/mascot/.test(iaFatAvatarErr),
    'err=' + iaFatAvatarErr.slice(0, 90));
  await del('preset-fat-avatar');
  // ★★ 整批语义（D5）：两次超重都**一个都没落** —— 不会"图是我的、盒子是旧的"那种半落状态。
  //   ⚠️ 这里必须**先删掉探针自己写进本机目录的那两张超大种子图**再计数，否则判据读到的
  //   bigBuf 尺寸文件是我们自己塞的，不是宿主落的 ⇒ 会把"正确行为"判成红（第一版就踩了）。
  //   认法也按字节数而不是前缀个数：install-assets 成功时会清同族旧文件，种子早被换掉了。
  rmSync(join(MASCOT_DIR, 'mascot-fatchk.png'), { force: true });
  rmSync(join(AVATARS_DIR, 'ai-fatchk.png'), { force: true });
  await del('preset-fat-mascot');
  await del('preset-fat-avatar');
  {
    const mascotLanded = readdirSync(MASCOT_DIR).map((f) => statSync(join(MASCOT_DIR, f)).size);
    const avatarLanded = readdirSync(AVATARS_DIR).map((f) => statSync(join(AVATARS_DIR, f)).size);
    check('整批失败 ⇒ 没有半个资产落盘（两个目录里都没有 bigBuf 尺寸的落地文件，原有小图完好）',
      !mascotLanded.some((s) => s === bigBuf.length) && !avatarLanded.some((s) => s === bigBuf.length)
      && mascotLanded.filter((s) => s === PNG1.length).length === 1
      && avatarLanded.filter((s) => s === PNG1.length).length === 2,
      JSON.stringify({ mascotSizes: mascotLanded, avatarSizes: avatarLanded }));
  }
  // ★★ FR-1（两阶段预检）：**多段混合**且其中一段超限 ⇒ 任一项超限都必须在**任何
  //   unlink / write 之前**抛出 —— mascot/ 与 avatars/ 两个目录**字节不变**。
  //   ⚠️ 上面的单段用例恰好安全（单段超限时该段还没落），真正会咬人的是混合段：
  //   mascot 合法 + avatar.ai 超限 —— 旧实现"先落 mascot（先清同族 ⇒ 用户原图被
  //   unlink）→ 再判 avatar 闸" ⇒ 整批 500，但用户原立绘已没了、无备份（不可恢复丢失）。
  //   预检还必须**收集所有超限项、一次性点名**（ mascot 与 avatar 双超 ⇒ 两个名字都在）。
  {
    // 先把本机目录推回已知态：一张合法立绘 + 两张合法头像（与上面整批判据同态）。
    writeFileSync(join(MASCOT_DIR, 'mascot-mixseed.png'), PNG1);
    writeFileSync(join(AVATARS_DIR, 'user-mixseed.png'), PNG1);
    writeFileSync(join(AVATARS_DIR, 'ai-mixseed.png'), PNG1);
    const digBefore = { mascot: dirDigest(MASCOT_DIR), avatars: dirDigest(AVATARS_DIR) };
    // 一份正文同时带：合法 mascot + 超限 avatar.user + 超限 avatar.ai ⇒ 两项都该被点名。
    // （writePreset 不看字节 ⇒ 这份正文能落盘；闸只在 install-assets 执行。）
    const mixBody = JSON.stringify({
      $schema: schema.PROFILE_PRESET_SCHEMA_TAG, id: 'preset-mix-fat', name: '混合超限',
      values: { glassAlpha: 9 },
      assets: {
        mascot: { file: 'mascot-mixseed.png', box: '96x192', data: PNG1.toString('base64') },
        avatar: {
          user: { file: 'user-mixseed.png', data: bigBuf.toString('base64') },
          ai: { file: 'ai-mixseed.png', data: bigBuf.toString('base64') },
        },
      },
    });
    mkdirSync(USER, { recursive: true });
    writeFileSync(userFilePath('preset-mix-fat'), mixBody, 'utf8');
    const iaMix = await installAssetsCall('preset-mix-fat');
    const mixErr = String((bodyJson(iaMix) || {}).error || '');
    check('★ FR-1 混合段（mascot 合法 + avatar 双超限）⇒ 拒绝且**一次性点名全部超限项**',
      iaMix.__state.status === 500
      && /avatar\.user/.test(mixErr) && /avatar\.ai/.test(mixErr)
      && (mixErr.match(/超过单份上限/g) || []).length === 2,
      'status=' + iaMix.__state.status + ' err=' + mixErr.slice(0, 120));
    const digAfter = { mascot: dirDigest(MASCOT_DIR), avatars: dirDigest(AVATARS_DIR) };
    check('★ FR-1 混合段超限 ⇒ mascot/ 与 avatars/ 目录**字节不变**（unlink 从未发生 —— 用户原图无伤）',
      digBefore.mascot === digAfter.mascot && digBefore.avatars === digAfter.avatars
      && readdirSync(MASCOT_DIR).some((f) => f === 'mascot-mixseed.png')
      && readdirSync(AVATARS_DIR).some((f) => f === 'user-mixseed.png')
      && readdirSync(AVATARS_DIR).some((f) => f === 'ai-mixseed.png'),
      JSON.stringify({ before: digBefore, after: digAfter }));
    // 结构判据：两阶段必须在**源码序**上成立 —— 所有 assetOverBudget 调用都在第一条
    // landImage 之前（预检阶段），落盘循环里不再出现超限判定（否则又会落一半）。
    {
      const fnAt = routeSrc.indexOf('async function installAssets(');
      const fnBody = fnAt >= 0 ? routeSrc.slice(fnAt, routeSrc.indexOf('\n}', fnAt) + 2) : '';
      const lastOver = fnBody.lastIndexOf('assetOverBudget(');
      const firstLand = fnBody.indexOf('landImage(');
      check('结构判据：installAssets 的字节闸预检全部在落盘（landImage）之前 —— 源码序钉死两阶段',
        Boolean(fnBody) && lastOver >= 0 && firstLand >= 0 && lastOver < firstLand
        && /overs\.join\(/.test(fnBody),
        'lastOver=' + lastOver + ' firstLand=' + firstLand);
      // 负对照：把预检调用挪到 landImage 之后的合成文本必须被同一条判据判红。
      const synth = 'async function installAssets(c, a) { await landImage(x); const over = assetOverBudget("m", b); }';
      const sAt = synth.indexOf('async function installAssets(');
      const sBody = synth.slice(sAt);
      const sOver = sBody.lastIndexOf('assetOverBudget(');
      const sLand = sBody.indexOf('landImage(');
      check('negative control: 「先落盘后判闸」的合成文本会被同一条源码序判据判红',
        !(sOver >= 0 && sLand >= 0 && sOver < sLand), 'synth over@' + sOver + ' land@' + sLand);
    }
    await del('preset-mix-fat');
    // ★ FR-1 负对照：同样的混合段但**全部合法** ⇒ 真的落盘（mascot 换成新 stamp 名、
    //   两张头像落地），证明上面的"字节不变"来自预检而不是"install-assets 坏了"。
    const okBody = JSON.stringify({
      $schema: schema.PROFILE_PRESET_SCHEMA_TAG, id: 'preset-mix-ok', name: '混合全合法',
      values: { glassAlpha: 9 },
      assets: {
        mascot: { file: 'mascot-mixseed.png', box: '96x192', data: PNG1.toString('base64') },
        avatar: {
          user: { file: 'user-mixseed.png', data: PNG1.toString('base64') },
          ai: { file: 'ai-mixseed.png', data: PNG1.toString('base64') },
        },
      },
    });
    writeFileSync(userFilePath('preset-mix-ok'), okBody, 'utf8');
    const iaOk = await installAssetsCall('preset-mix-ok');
    const iaOkData = bodyJson(iaOk) || {};
    const okMascot = String(((iaOkData.applied || {}).mascot || {}).file || '');
    const okUser = String((((iaOkData.applied || {}).avatar || {}).user || {}).file || '');
    const okAi = String((((iaOkData.applied || {}).avatar || {}).ai || {}).file || '');
    check('FR-1 负对照：同样的混合段全合法 ⇒ 200 且三段真落盘（种子被换成新 stamp 名）',
      iaOk.__state.status === 200
      && okMascot && okMascot !== 'mascot-mixseed.png' && existsSync(join(MASCOT_DIR, okMascot))
      && okUser && /^user-/.test(okUser) && existsSync(join(AVATARS_DIR, okUser))
      && okAi && /^ai-/.test(okAi) && existsSync(join(AVATARS_DIR, okAi)),
      'mascot=' + okMascot + ' user=' + okUser + ' ai=' + okAi);
    await del('preset-mix-ok');
    // 收尾：把本机目录恢复到"各一张合法图"的形态（清掉 mix 种子，给后续段落留干净现场）。
    rmSync(join(MASCOT_DIR, 'mascot-mixseed.png'), { force: true });
    rmSync(join(AVATARS_DIR, 'user-mixseed.png'), { force: true });
    rmSync(join(AVATARS_DIR, 'ai-mixseed.png'), { force: true });
  }
  // 收体总闸：超过 import 上限 ⇒ 413（不收完再判、不 OOM）。
  const huge = JSON.stringify({
    $schema: schema.PROFILE_PRESET_SCHEMA_TAG, id: 'huge', name: 'h',
    values: { glassAlpha: 5 },
    assets: { mascot: { file: 'mascot-huge01.png', data: 'A'.repeat(34 * 1024 * 1024) } },
  });
  const hugeRes = await importPreset(huge);
  check('import 收体超总闸 ⇒ 413（payload too large），不进入解析',
    hugeRes.__state.status === 413, 'status=' + hugeRes.__state.status + ' bytes=' + Buffer.byteLength(huge));
  // create 的闸更紧（只收 settings 段 + embed 名单，不收字节）。
  const bigCreate = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/create', 'POST',
    JSON.stringify({ name: '超大 create', values: { glassAlpha: 5 }, pad: 'x'.repeat(200 * 1024) })));
  check('create 收体超 128KiB ⇒ 413（create 不收字节，闸比 import 紧）',
    bigCreate.__state.status === 413, 'status=' + bigCreate.__state.status);
  // 结构判据：import 的总闸必须由单份闸**推出来**（单份一改就自动跟上，不是两处手抄数字）。
  {
    const src = stripComments(routeSrc);
    const reDecl = /const PRESET_IMPORT_MAX_BYTES\s*=\s*([^;]+);/;
    const decl = src.match(reDecl);
    check('结构判据：PRESET_IMPORT_MAX_BYTES 由单份闸推导（不是写死的第二个数字）',
      Boolean(decl) && /PRESET_ASSET_MAX_BYTES/.test(decl[1]) && /\b3\b/.test(decl[1]),
      decl ? decl[1].trim().replace(/\s+/g, ' ') : '未找到声明');
    // 负对照：把推导式换成写死数字，同一条判据必须判红。
    const m2 = 'const PRESET_IMPORT_MAX_BYTES = 33554432;'.match(reDecl);
    check('negative control: 总闸写成硬编码数字会被同一条判据判红',
      Boolean(m2) && !/PRESET_ASSET_MAX_BYTES/.test(m2[1]), m2 ? m2[1] : '抽取失败');
  }
  // 清理
  for (const id of ['preset-embed-1', 'preset-noassets-1', 'preset-only-mascot', impData.id]) {
    if (id) await del(id);
  }

  // ── FR-2：import 同名 ⇒ **自动顺延**，两份都进清单且名字可区分（captain 冻结口径）──
  //   为什么不是 409：面板没有重命名功能（grep 确认零匹配），导入者拿到 409 就是
  //   "拿到手却改不了"；顺延（`暗夜釉色` → `暗夜釉色 (2)`）让清单里不出现无法区分的
  //   同名项 —— 与 create 的 409 满足的是同一条判据（create 那边用户能当场改名，409
  //   是即时可行动的）。负对照：导入不同名 ⇒ 名字保持原样（顺延不能误伤不撞名的导入）。
  //   ⚠️ 位置在 ③d 末尾清理**之后**：此时清单只剩 4 套未删出厂，连导数份不会被
  //      数量上限 409 淹掉（实测第一版放在清理前 ⇒ 顺延正确执行仍撞上限，判据全空转）。
  {
    // 现场里 expDoc 的名字是「带资产的快照」（create 建的、上一行刚删掉它 ——
    // 名字已放开，两份同名导入会从原名重新开始顺延）。
    const dupA = await importPreset(expDoc);
    const dupB = await importPreset(expDoc);
    const aData = bodyJson(dupA) || {};
    const bData = bodyJson(dupB) || {};
    check('FR-2：连导两份同名 ⇒ 两份都 200（自动顺延，不 409 —— 面板没有重命名功能）',
      dupA.__state.status === 200 && dupB.__state.status === 200
      && typeof aData.id === 'string' && typeof bData.id === 'string' && aData.id !== bData.id,
      'a=' + aData.id + '(' + aData.name + ') b=' + bData.id + '(' + bData.name + ')');
    const listAfter = (await getList()).presets || [];
    const names = listAfter.filter((r) => !r.broken).map((r) => r.name);
    const aRow = listAfter.find((r) => r.id === aData.id);
    const bRow = listAfter.find((r) => r.id === bData.id);
    check('FR-2：两行都在清单里、名字互不相同；整张清单无重复名（归一化后）',
      Boolean(aRow) && Boolean(bRow) && aRow.name !== bRow.name
      && new Set(names.map((n) => n.trim().toLowerCase())).size === names.length,
      JSON.stringify({ a: aRow && aRow.name, b: bRow && bRow.name }));
    check('FR-2：顺延名 = 原名 + " (2)"（可预期的形状，不是乱码后缀）',
      aRow && bRow && (aRow.name === '带资产的快照' && bRow.name === '带资产的快照 (2)'
        || aRow.name === '带资产的快照 (2)' && bRow.name === '带资产的快照'),
      'a=' + (aRow && aRow.name) + ' b=' + (bRow && bRow.name));
    // 负对照：导入**不同名**的正文 ⇒ 名字保持原样（顺延只在真撞名时介入）。
    const distinct = JSON.parse(JSON.stringify(expDoc));
    distinct.name = '另一个名字的导入';
    delete distinct.id;
    const impDistinct = await importPreset(distinct);
    const dRow = ((await getList()).presets || []).find((r) => r.id === (bodyJson(impDistinct) || {}).id);
    check('FR-2 负对照：不同名导入 ⇒ 名字原样保留（顺延不误伤）',
      impDistinct.__state.status === 200 && dRow && dRow.name === '另一个名字的导入',
      'name=' + (dRow && dRow.name));
    // 顺延名也要再查重：已有「X (2)」时再导一份「X」 ⇒ 得到「X (3)」，不能撞上「X (2)」。
    const third = await importPreset(expDoc);
    const tRow = ((await getList()).presets || []).find((r) => r.id === (bodyJson(third) || {}).id);
    check('FR-2：顺延名同样过对比域（第三份拿 " (3)"，不与 " (2)" 撞名）',
      third.__state.status === 200 && tRow
      && tRow.name !== aRow.name && tRow.name !== bRow.name
      && /带资产的快照 \(3\)/.test(tRow.name),
      'name=' + (tRow && tRow.name));
    // 清理本组探针，避免污染后续段落的上限前提。
    for (const id of [aData.id, bData.id, (bodyJson(impDistinct) || {}).id, (bodyJson(third) || {}).id]) {
      if (id) await del(id);
    }
  }
}

// ── ③e #199：随包层读失败原因**不塌缩** + 404 带上下文 ═════════════════════════
section('③e #199：随包层旧 tag ⇒ 422「版本已作废」（不是 404）、404 带 reason=missing/tombstone');
{
  // 为什么另起一个台架：`lib/index.js` 把随包层钉死成**仓内** `lib/glass-presets`
  // （GLASS_PRESET_BUILTIN_DIR），守卫不能往仓内随包目录塞一份旧 tag 文件（那是改工作树）。
  // 这里按族文件头的 ctx 契约自己接线，随包层指向隔离区里的一份**旧 tag** 文件 ——
  // 复刻真实形态：升级窗口期磁盘上的随包文件已是另一版 tag，而宿主内存里是这份路由代码。
  const probeMod = await import(pathToFileURL(join(root, 'lib', 'routes', 'presets.js')).href);
  const probeBuiltin = join(ISO, 'probe-builtin');
  const probeUser = join(ISO, 'probe-user');
  rmSync(probeBuiltin, { recursive: true, force: true });
  rmSync(probeUser, { recursive: true, force: true });
  mkdirSync(probeBuiltin, { recursive: true });
  mkdirSync(probeUser, { recursive: true });
  writeFileSync(join(probeBuiltin, 'factory-legacy.json'),
    JSON.stringify({ $schema: OLD_TAG, id: 'factory-legacy', name: '旧版出厂预设', values: {} }) + '\n');
  writeFileSync(join(probeBuiltin, 'factory-live.json'),
    JSON.stringify({ $schema: 'dsh-we/profile-preset@1', id: 'factory-live', name: '现役出厂预设', values: {} }) + '\n');
  const probeRoutes = [];
  probeMod.registerGlassPresetsRoutes({
    register(r) { probeRoutes.push(r); return () => {}; },
  }, {
    disposers: [],
    base: '/wallpaper-engine',
    glassPresetsDir: () => probeUser,
    glassPresetsBuiltinDir: probeBuiltin,
    log: { warn: () => {} },
    ensureDirOnce: (d) => mkdirSync(d, { recursive: true }),
    atomicWriteFileP: async (p, buf) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); },
  });
  const probe = probeRoutes.find((r) => r.path && r.path.endsWith('/glass-presets'));
  check('台架自检：探针路由已注册（随包/用户层独立接线）', Boolean(probe), probe && probe.path);

  if (probe) {
    // ★ 主判据（#199 的核心）：随包层"**文件在**、tag 作废" ⇒ 422 + reason=version-obsolete。
    //   #199 之前 `resolvePreset()` 把随包层的**一切**读失败塌缩成 `missing` ⇒ 这里回 404
    //   `unknown preset`，同一条 GET 上**已经本地化**的 422「版本已作废」成了死代码（#188）。
    const legacy = await callRoute(probe, fakeReq(P('factory-legacy'), 'GET'));
    const legacyBody = bodyJson(legacy) || {};
    check('★ #199：随包层旧 tag ⇒ 422 version-obsolete（塌缩回 missing 即红）',
      legacy.__state.status === 422 && legacyBody.reason === 'version-obsolete'
      && legacyBody.origin === 'builtin' && legacyBody.shadowsBuiltin === false,
      'status=' + legacy.__state.status + ' reason=' + legacyBody.reason + ' origin=' + legacyBody.origin);
    check('★ #199：该 422 上屏的是**已本地化**的「版本已作废」那条，不是英文 unreadable',
      typeof legacyBody.error === 'string' && legacyBody.error.includes('版本已作废')
      && !/unreadable/.test(legacyBody.error),
      String(legacyBody.error));

    const absent = await callRoute(probe, fakeReq(P('factory-absent'), 'GET'));
    const absentBody = bodyJson(absent) || {};
    check('随包层真不存在 ⇒ 仍是 404 missing（origin 语义不回退）',
      absent.__state.status === 404 && absentBody.error === 'unknown preset'
      && absentBody.reason === 'missing' && absentBody.id === 'factory-absent' && !absentBody.origin,
      'status=' + absent.__state.status + ' reason=' + absentBody.reason + ' origin=' + absentBody.origin);

    const delOk = await callRoute(probe, fakeReq(P('factory-live'), 'DELETE'));
    check('正对照：现役 tag 的随包预设可删 ⇒ 200 写墓碑（探针台架真在跑）',
      delOk.__state.status === 200 && (bodyJson(delOk) || {}).origin === 'builtin',
      'status=' + delOk.__state.status);
    const delAgain = await callRoute(probe, fakeReq(P('factory-live'), 'DELETE'));
    const delAgainBody = bodyJson(delAgain) || {};
    // ★ #188 建议四：三处 404 不再共用同一句**没有上下文**的文案。
    check('★ #199：重复 DELETE 已墓碑的出厂预设 ⇒ 404 带 reason=tombstone + id',
      delAgain.__state.status === 404 && delAgainBody.reason === 'tombstone'
      && delAgainBody.id === 'factory-live',
      'status=' + delAgain.__state.status + ' reason=' + delAgainBody.reason);
  }
  rmSync(probeBuiltin, { recursive: true, force: true });
  rmSync(probeUser, { recursive: true, force: true });
}

// ── ④ 客户端形态棘轮（文本级）══════════════════════════════════════════════
section('④ 客户端形态棘轮：新编排链（合并→落盘→reapplyAll→emit）/ 失败滚回 / 无第二持久化');
{
  const storeSrc = readFileSync(join(root, 'src', 'preset-store.js'), 'utf8');
  const panelSrc = readFileSync(join(root, 'src', 'glass-panel.js'), 'utf8');
  const storeCode = stripComments(storeSrc);
  const panelCode = stripComments(panelSrc);

  // ★ 按 ADR-0011 D3 的新编排重写（原判据的两条正则锚在旧文本上，已随改造失效；
  //   失效是**正确的** —— applyPreset 中间插入了资产步骤与失败滚回段，落效改走
  //   reapplyAll()，applyEffects() 由紧随的 emit() 订阅者触发，文本上不再紧邻）。
  //   重写保住原判据的两个意图：① 应用必须走设置通道（不另立持久化）；② 落效必须真的发生。
  const applyBody = (() => {
    const at = storeCode.indexOf('async function applyPreset(');
    return at < 0 ? '' : storeCode.slice(at, at + 3000);
  })();
  check('应用 = 整快照一次合并（Object.assign(selection, values)，不逐键 setSetting）',
    /Object\.assign\(selection, values\);/.test(applyBody), applyBody ? 'applyPreset 体已定位' : '未找到 applyPreset');
  check('落效链：persistSelection() → reapplyAll() → emit() 依次在场（D3 的新编排）',
    /persistSelection\(\);[\s\S]{0,120}reapplyAll\(\);[\s\S]{0,120}emit\(\);/.test(applyBody));
  check('reapplyAll 做 emit 订阅链之外的三件事（syncLayers / syncRotationTimer / syncSceneAudio）',
    /function reapplyAll\(\)\s*\{[\s\S]*?syncLayers\(\);[\s\S]*?syncRotationTimer\(\);[\s\S]*?syncSceneAudio\(selection\);/.test(storeCode));
  check('资产步失败 ⇒ settings 段按合并前快照**逐键滚回**（新增保护：整套采用或整套不动）',
    /for \(const key of PROFILE_PRESET_KEYS\) before\[key\] = selection\[key\];/.test(applyBody)
    && /for \(const key of PROFILE_PRESET_KEYS\) selection\[key\] = before\[key\];/.test(applyBody));
  check('滚回发生在 persistSelection 之前（失败时落盘从未发生）',
    applyBody.indexOf('selection[key] = before[key]') >= 0
    && applyBody.indexOf('selection[key] = before[key]') < applyBody.indexOf('persistSelection()'));
  check('正文带资产段才调 install-assets（缺席 = 一个键都不碰，不是回落默认）',
    /rawAssets && typeof rawAssets === "object"[\s\S]{0,200}\/install-assets/.test(applyBody));
  // ★ 三态的应用半边：宿主用 `{cleared:true}` 告诉客户端"那一族回到内置"，客户端必须把键清空
  //   —— 与"宿主没回这一段"（一个键都不碰）区别对待。落点在 `applyPresetAssets`（不是 applyPreset）。
  {
    const assetsBody = (() => {
      const at = storeCode.indexOf('function applyPresetAssets(');
      return at < 0 ? '' : storeCode.slice(at, at + 2600);
    })();
    check('★ 客户端认 `{cleared:true}` 把那一族键置空（声明「无」的落地半边）',
      /mascot\.cleared === true/.test(assetsBody) && /avatar\.cleared === true/.test(assetsBody)
      && /setSetting\("mascotImage", ""\)/.test(assetsBody) && /setSetting\("mascotImageBox", ""\)/.test(assetsBody)
      && /setSetting\("avatarUserImage", ""\)/.test(assetsBody) && /setSetting\("avatarAiImage", ""\)/.test(assetsBody),
      assetsBody ? 'applyPresetAssets 体已定位' : '未找到 applyPresetAssets');
    // ★ 第四态的落地半边：宿主回 `{form:'phoebe'}` ⇒ 客户端**两件事一起做**（钉 ropeForm + 清两个
    //   自定义键）。少了前者就退化成"声明无"（形态交回 settings 段的 ropeForm）；少了后者，图已被
    //   宿主删掉而键还指着那个文件名 ⇒ 渲染仍走自定义分支、屏上那只直接消失。
    check('★ 客户端认 `{form}` 把 ropeForm 钉成内置形态并清两个自定义键（指向内置的落地半边）',
      /mascot\.form === "string"/.test(assetsBody)
      && /setSetting\("ropeForm", mascot\.form\)/.test(assetsBody)
      && assetsBody.indexOf('setSetting("ropeForm"') < assetsBody.indexOf('setSetting("mascotImage", "")'),
      assetsBody ? 'applyPresetAssets 体已定位' : '未找到 applyPresetAssets');
    check('negative control: `form` 判据不是恒真 —— `{cleared:true}` 那条路仍不写 ropeForm',
      /if \(typeof mascot\.form === "string" && mascot\.form\) \{[\s\S]{0,400}?\} else if \(mascot\.cleared === true\) \{/.test(assetsBody));
    check('negative control: `cleared` 不是恒真判据 —— 没带 cleared 的段仍走"写文件名"那条路',
      /mascot\.file/.test(assetsBody) && /avatar\.user/.test(assetsBody));
    const saveBody = (() => {
      const at = storeCode.indexOf('async function savePresetWithEmbeds(');
      return at < 0 ? '' : storeCode.slice(at, at + 1800);
    })();
    check('★ 勾了而本机没有 ⇒ 保存不再被拦下，改成成功路径上屏一条提示（提示必须排在 setPresetError("") 之后）',
      /const assetNote = presetSaveChecks\(/.test(saveBody)
      && /if \(assetNote\) setTransient\("glassPresetNote", assetNote\);/.test(saveBody)
      && saveBody.indexOf('setTransient("glassPresetNote"') > saveBody.indexOf('setPresetError("");')
      && /return notes\.join\(" "\);/.test(storeCode),
      saveBody ? 'savePresetWithEmbeds 体已定位' : '未找到 savePresetWithEmbeds');
  }
  check('字体值走字体集通道，落进**预设专用槽** landPresetFontSet（不写用户活动集 —— 写活动集会把用户自己的设计整个染绿，实测教训）',
    /landPresetFontSet\(sanitizeFontset\(font\.values\), font\.name\)/.test(storeCode));
  check('negative control: 旧的 setFontValues 直写形态必须从 preset-store 消失（落到专用槽是唯一路径）',
    !/setFontValues\(sanitizeFontset/.test(storeCode));
  check('预设通道不直接写 localStorage（缓存归 settings 通道管）',
    !/localStorage/.test(storeCode));
  // ★ 写请求集合按**语义**判，不按字面顺序判（旧判据把 `join(',')` 的字符串当等式钉死 ⇒
  //   install-assets 那处写成行内 `{ method: "POST" }`、create/import 写成换行的 `method: "POST",`
  //   —— 同一种请求两种字面，调用顺序一挪就假红）。
  //   意图不变：预设族**没有 PUT、没有 activate**；写只有 create / install-assets / import / delete。
  {
    const writeMethods = (storeCode.match(/method:\s*"(POST|PUT|DELETE)"/g) || []);
    const putCount = writeMethods.filter((m) => /PUT/.test(m)).length;
    const postCount = writeMethods.filter((m) => /POST/.test(m)).length;
    const delCount = writeMethods.filter((m) => /DELETE/.test(m)).length;
    check('写请求只有 POST×3（create / install-assets / import）与 DELETE×1 —— 无 PUT、无 activate',
      putCount === 0 && postCount === 3 && delCount === 1,
      'POST=' + postCount + ' DELETE=' + delCount + ' PUT=' + putCount);
    // 负对照：同一条计数对"多一条 PUT"的合成源码必须判出（证明不是恒真）。
    const synth = 'a({ method: "POST" }) b({ method: "POST" }) c({ method: "DELETE" }) d({ method: "PUT" })';
    const sm = synth.match(/method:\s*"(POST|PUT|DELETE)"/g) || [];
    check('negative control: 源码里多出一条 PUT 会被同一条计数判出',
      sm.filter((m) => /PUT/.test(m)).length === 1 && sm.length === 4, sm.join(','));
  }
  check('导出走普通链接（无 blob / showSaveFilePicker / window.confirm）',
    !/createObjectURL|new Blob|showSaveFilePicker/.test(storeCode + panelCode)
    && !/window\.confirm/.test(panelCode));
  // 2026-10-12 第四态：正文除 `embed` 名单外多了一处 `point` **声明**（`{mascot:'whale'}` —— 只带
  //   形态名、零字节）。意图不变：正文里**没有图片字节**（base64 只在宿主侧进出），所以判据同步为
  //   "名单 + 声明都在"，负对照仍是 `readAsDataURL` 缺席。
  check('保存只传 embed 名单与「指向」声明、不上传图片字节（base64 只在宿主侧进出）',
    /embed: list/.test(storeCode) && /point: \{ mascot: point \}/.test(storeCode)
    && !/readAsDataURL/.test(storeCode));
  check('导入三道本地预检齐全（读不出 / 非 JSON / tag 不对各给一句）',
    /读不出这个文件/.test(storeCode) && /这不是 JSON 文件/.test(storeCode)
    && /这不是预设文件/.test(storeCode) && /PROFILE_PRESET_SCHEMA_TAG/.test(storeCode));
  check('出厂预设名字走 weT 词表（就地字面量，不是数据直出）',
    /"factory-default": weT\("黑客绿\(Fish\)"\)/.test(panelSrc));
  check('删除按钮文案按 origin 分语义（出厂=永久删除 / 用户=删除）',
    /删除这个出厂预设（不可恢复）/.test(panelSrc) && /删除这个预设（会再问一次）/.test(panelSrc));
  // ADR-0011 D6 连带要求：broken 文案必须**点明版本作废**并给出重存出路，按 origin 分口径。
  check('broken 文案按 origin 分：出厂点名"版本已作废"+ 重存出路（不是笼统读不出来）',
    /这份出厂预设的版本已作废/.test(panelSrc) && /从预设栏重新保存一份/.test(panelSrc)
    && /这份预设读不出来/.test(panelSrc));
  // D4（2026-10-12 三态）：勾选对话框必须把**三态**口径写出来 —— 勾了而本机没有 = 声明「无」
  // （对方回内置），不勾 = 一个字都不动对方。旧文案写的是"不勾吉祥物 ⇒ 回落内置立绘"，与
  // "资产段缺席 = 保持现值"自相矛盾（实测 A→B→A 30/42 不收敛）—— 这条棘轮就是那颗钉子。
  check('★ 资产勾选对话框按三态写明后果（勾了没有 = 声明「无」/ 不勾 = 不动对方；三族都在）',
    /本机字体还是全默认 —— 勾着存 = 声明「无」/.test(panelSrc)
    && /本机没有自定义立绘 —— 勾着存 = 声明「无」/.test(panelSrc)
    && /本机没有自定义头像 —— 勾着存 = 声明「无」/.test(panelSrc)
    && /不勾 = 不动对方的字体/.test(panelSrc)
    && /不勾 = 不动对方的立绘/.test(panelSrc)
    && /不勾 = 不动对方的头像/.test(panelSrc)
    && !/不勾：吉祥物回落内置立绘/.test(panelSrc)
    && !/不勾：会话头像回落内置默认头像/.test(panelSrc));
  // 负对照（本次缺陷的客户端半边）：勾选框**不再按 available 禁用** —— 旧版 `disabled: !xxxAvailable`
  // 让"本机没有自定义立绘"的用户永远无法声明「无」，那一族只能靠出厂预设里的 null 来清。
  check('★ 勾选框不再按 available 禁用（禁用 = 本机没有的用户永远无法声明「无」）',
    /const fontAvailable = /.test(panelSrc) && !/disabled:\s*!\w*[Aa]vailable/.test(panelSrc),
    /disabled:\s*!\w*[Aa]vailable/.test(panelSrc) ? '仍有禁用表达式' : '无禁用');
  check('保存与导出两处都先过勾选对话框（同一组勾选项）',
    /saveTarget === "export"/.test(panelSrc) && /saveTarget === "save"/.test(panelSrc)
    && /onExportCommit\(\)/.test(panelSrc) && /assetRows/.test(panelSrc));

  // 玻璃节 ctx 的两档接线完整性（承旧判据，2026-10-04 实测教训）
  {
    const destr = stripComments(panelSrc).match(
      /function renderAppearanceGlassSection\(ctx\) \{\s*const \{([\s\S]*?)\} = ctx;/);
    const handlers = destr
      ? [...new Set([...destr[1].matchAll(/\bon[A-Z][\w$]*/g)].map((m) => m[0]))]
      : [];
    check('玻璃节解构解析出处理器清单（判据不空转）', handlers.length >= 15,
      handlers.length + ' 个');
    const clientAll = stripComments(readFileSync(join(root, 'src', 'client.js'), 'utf8'));
    const qpAll = stripComments(readFileSync(join(root, 'src', 'quick-panel.js'), 'utf8'));
    // 侧栏专属处理器（设置页 ctx 里**故意**没有）：设置页那一档不需要它们，硬塞一个死处理器
    // 反而会把"这一档根本不会调它"这件事藏起来。
    //   · `onToggleGlassDetail` —— 「详细玻璃调节」子门（只有侧栏有折叠块）；
    //   · `onToggleGlassUiSection` —— 「玻璃 UI」**整节**折叠门（2026-10-11 二次修订后设置页
    //     也传了 ⇒ 本豁免对它已无实际作用，保留作兜底）；
    //   · 同批的 `onToggleDetailSection` / `onToggleCornersSection` 是另外两节的整节门，
    //     同样只在侧栏（那两节的渲染器在 panel-tabs.js，不在这段扫描范围里）。
    const SIDEBAR_ONLY = ['onToggleGlassDetail', 'onToggleGlassUiSection'];
    // 设置页专属处理器（侧栏 ctx 里**故意**没有）—— 与上面同一原理的镜像：
    //   · `onTogglePresetsSection` —— 「主题预设」整节折叠门（2026-10-12）。该节 `!sidebarSurface`
    //     门控**只在设置页渲染** ⇒ 侧栏档根本不会调它，硬塞进侧栏 ctx 反而是死处理器。
    const SETTING_ONLY = ['onTogglePresetsSection'];
    const missingClient = handlers.filter((h) => !SIDEBAR_ONLY.includes(h)
      && !new RegExp('\\b' + h + '\\b').test(clientAll));
    const missingQp = handlers.filter((h) => !SETTING_ONLY.includes(h)
      && !new RegExp('\\b' + h + '\\b').test(qpAll));
    check('每个玻璃节处理器都在设置页 ctx 里（侧栏专属豁免）', missingClient.length === 0, missingClient.join(',') || '全在');
    check('每个玻璃节处理器都在侧栏快捷面板 ctx 里（漏接 = 该档滑杆全死）',
      missingQp.length === 0, missingQp.join(',') || '全在');
    check('negative control: 解构里造一个不存在的处理器会被判出',
      handlers.concat('onNoSuchHandler').some((h) => !new RegExp('\\b' + h + '\\b').test(qpAll)));
  }

  // ── 「作者自用」推广弹窗（PresetIntroDialog，2026-10-12 用户口径：更新后一次性二选一）──
  // 组件挂在 RopeDock 根上（渲染台够不到）⇒ 源码级判据，与 verify-about ⑤ 公告守卫同思路。
  {
    const introSrc = stripComments(readFileSync(join(root, 'src', 'client.js'), 'utf8'));
    check('弹窗组件存在，且在 RopeDock 两处挂载（隐藏分支 + 主返回树，与公告同位）',
      /function PresetIntroDialog\(\)/.test(introSrc)
      && (introSrc.match(/React\.createElement\(PresetIntroDialog, null\)/g) || []).length === 2,
      (introSrc.match(/React\.createElement\(PresetIntroDialog, null\)/g) || []).length + ' 处挂载');
    check('门控三件齐：hostLoaded + 未答过（settings 哨兵）+ 公告已处理（先公告后弹窗，不同屏）',
      /sel\.hostLoaded && !seen && sel\.noticeSeen === NOTICE_VERSION/.test(introSrc)
      && /const seen = sel\.presetIntroSeen === PRESET_INTRO_VERSION;/.test(introSrc));
    // A 键：走预设卡片同一条 applyPreset 整快照链（settings 合并 + 资产落位 + 失败滚回），
    // 且**成功才记已读** —— 失败留弹窗可重试，"答过了"不能伪装成"应用过了"。
    const aGuard = (s) => /applyPreset\("factory-author"\)/.test(s)
      && /if \(ok\) markSeen\(\); else setFailed\(true\);/.test(s);
    check('A 键 = applyPreset("factory-author") 整快照链，成功才记已读（失败留弹窗）', aGuard(introSrc));
    check('negative control: 把"成功才记已读"改成"总是记已读"会被判出（判据有牙）',
      !aGuard(introSrc.replace('else setFailed(true);', 'else markSeen();')));
    check('B 键只记已读不碰设置（onClick: markSeen 恰一处；A 键走 accept）',
      (introSrc.match(/onClick: markSeen/g) || []).length === 1,
      (introSrc.match(/onClick: markSeen/g) || []).length + ' 处');
    // 哨兵住 **settings**（2026-10-16 修正 2026-10-12 的 localStorage 口径）：localStorage
    // 按**源**（协议+主机+端口）隔离，而 DSH Desktop 每次启动都换随机 `--port 0` 端口 ⇒
    // 旧口径的已读标记活不过一次重启，弹窗每次开机重弹（用户实测）。settings 落宿主
    // config.json、与端口无关 ⇒ 真正的一次性；同时必须挂 PRESET_EXCLUDED_KEYS ——
    // "答没答过"是每机状态不是外观配置，不许随预设快照旅行（noticeSeen 同款先例）。
    const introSchemaSrc = readFileSync(join(root, 'lib', 'settings-schema.js'), 'utf8');
    check('哨兵是 settings 口径（markSeen = setSetting + emit；client.js 无 localStorage 残留）',
      /setSetting\("presetIntroSeen", PRESET_INTRO_VERSION\)/.test(introSrc)
      && !/preset-intro-seen/.test(introSrc));
    check('哨兵键在 schema：KINDS 收编（str）+ PRESET_EXCLUDED_KEYS 硬排除（不进预设快照）',
      /presetIntroSeen: \{ kind: 'str' \}/.test(introSchemaSrc)
      && /'presetIntroSeen',\s*\/\/ 「作者自用」推广弹窗/.test(introSchemaSrc));
    check('negative control: 退回旧 localStorage 口径的源码会被上面两条判据判出（判据有牙）',
      !(() => { const legacy = introSrc
        .replace(/const seen = sel\.presetIntroSeen === PRESET_INTRO_VERSION;/,
                 'const seen = localStorage.getItem("dsh-wallpaper-engine:preset-intro-seen") === PRESET_INTRO_VERSION;')
        .replace(/setSetting\("presetIntroSeen", PRESET_INTRO_VERSION\);\s*emit\(\);/,
                 'try { localStorage.setItem("dsh-wallpaper-engine:preset-intro-seen", PRESET_INTRO_VERSION); } catch { /* ignore */ }');
        return /setSetting\("presetIntroSeen", PRESET_INTRO_VERSION\)/.test(legacy)
          && !/preset-intro-seen/.test(legacy); })());
    // ── #199 窗口期门控：开之前先探一次宿主**正文**路由（与公告美术闸同思路）──
    //    探针打的是**这一份**预设的正文（清单 200 只说明路由挂着，说明不了它读得懂 ——
    //    旧后端读新 tag 文件正是读不懂）；判定按**模块级**缓存（页面级事实，多面板只探一轮）；
    //    非 ok（404/405/422/断网）一律不渲染：A 键在那个后端上必然失败，不值得打扰用户。
    const probeGate = (s) => /let presetIntroProbeVerdict = "";/.test(s)
      && /if \(presetIntroProbeVerdict\) \{ setProbe\(presetIntroProbeVerdict\); return undefined; \}/.test(s)
      && /if \(!eligible\) return undefined;/.test(s)
      && /gpJson\(glassPresetUrl\("factory-author"\)\)\.then\(\(r\) => \{/.test(s)
      && /presetIntroProbeVerdict = r\.ok && !r\.error \? "ok" : "no";/.test(s)
      && /if \(!eligible \|\| probe !== "ok"\) return null;/.test(s);
    check('★ #199 窗口期：弹窗开之前先探 GET /glass-presets/factory-author，非 ok 一律不渲染',
      probeGate(introSrc));
    check('negative control: 把门放宽成"eligible 就渲染"（不看探针结论）会被判出（判据有牙）',
      !probeGate(introSrc.replace('if (!eligible || probe !== "ok") return null;', 'if (!eligible) return null;')));
    check('★ #199：探针结论缓存在**模块级**（页面级事实，多面板只探一轮；刷新即重探）',
      /let presetIntroProbeVerdict = "";/.test(introSrc)
      && /const \[probe, setProbe\] = React\.useState\(presetIntroProbeVerdict \|\| "pending"\);/.test(introSrc));
    check('★ #199：探针归 "no" 的路径上**不写**已看哨兵（窗口期保持安静，重启后照常弹一次）',
      !/presetIntroProbeVerdict = r\.ok && !r\.error \? "ok" : "no";[\s\S]{0,200}markSeen/.test(introSrc));
  }
}

// ── ④b 客户端行为判据（真渲染 + 意图驱动）══════════════════════════════════
section('④b 行为判据：删除令牌链 + broken 行禁用与可删 + 勾选对话框渲染');
{
  const ReactStub = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.filter((c) => c !== undefined && c !== null) }), Fragment: '@fragment' };
  // ⚠️ 台架必须复刻**真实签名**（`switchRow(label, checked, onChange, opts)` → `ctlText(label, hint, tooltip)`
  //   + `Toggle({checked, disabled, …})`）。第一版把 stub 写成 `(label, on, onChange, opts)` 并直接返回一个
  //   `{type:'switch', label}` —— 于是"禁用态"这条判据读的是我自己造的字段，永远读不到真值：
  //   **假绿**，正是本仓要防的失败形态。现在 stub 按真实结构展开，判据从渲染树里找
  //   `input[type=checkbox][aria-label=…]` 读它的 `disabled`。
  const gpStub = {
    React: ReactStub,
    weT: (k) => k,
    ctlText: (label, hint, tooltip) => ({ type: 'div', props: { className: 'we-picker__ctl-text' }, children: [
      { type: 'span', props: { className: 'we-picker__ctl-label', title: tooltip }, children: [label] },
      hint ? { type: 'span', props: { className: 'we-picker__ctl-hint' }, children: [hint] } : null,
    ] }),
    Toggle: (props) => ({ type: 'label', props: { className: 'we-picker__switch', title: props.title }, children: [
      { type: 'input', props: { type: 'checkbox', checked: props.checked, disabled: props.disabled === true, 'aria-label': props.label }, children: [] },
    ] }),
    renderConfirmRow: (armed, token, question) => ({ type: 'confirm-row', question }),
    GLASS_COLOR_PRESETS: ['#ffffff'],
    SliderRow: (label) => ({ type: 'slider', label }),
    switchRow: (label, checked, onChange, opts) => {
      opts = opts || {};
      return { type: 'div', props: { className: 'we-picker__ctl', key: opts.key }, children: [
        gpStub.ctlText(label, opts.hint, opts.tooltip),
        gpStub.Toggle({ checked, onChange, label, title: opts.tooltip, disabled: opts.disabled }),
      ] };
    },
    swatchRow: (label) => ({ type: 'swatch', label }),
    // ⚠️ glass-panel.js 在 bundle 里与 src/client.js（`ROPE_FORMS` 定义在 `src/client.js:4892`）和
    //   lib/settings-schema.js（`ROPE_FORM_VALUES` 定义在 `lib/settings-schema.js:32`）**同处一个
    //   作用域**（build 把各 src 文件顺序拼成一个 lib/client.js；`src/panel-tabs.js:1090` 的
    //   `ROPE_FORMS[k].label` 早就是同一形态的既有用法）。单独 eval 时这两个模块作用域符号必须由
    //   台架按**真实形状**补上，否则渲染第一步就 ReferenceError —— 判据根本跑不到（本仓最忌的
    //   "台架自己造字段"：这里只补作用域，不替代任何被判定为真的字段）。
    //   值域**从真源读**（本文件已在 `:71` 把 `lib/settings-schema.js` 取成 `schema`）—— 手抄一份必然
    //   漂移：2026-10-13 并入 #180 时形态从 3 只涨到 12 只（同日晚「小女仆」除名 ⇒ 现为 10 只），于是"一组 4 键"那条判据自己先聋了。
    //   显示名照 `src/client.js` 的 `ROPE_FORMS` 抄（那边是 `weT("Deepseek_Pro")` 的取值路径，还挂着 img
    //   的 data URL，无法内联）；下面紧跟着一条判据钉住"标签表的键集 == 真源值域"，两边不许打架。
    ROPE_FORM_VALUES: schema.ROPE_FORM_VALUES,
    ROPE_FORMS: Object.fromEntries(Object.entries({
      whale: 'Deepseek_Pro', phoebe: '菲比啾比',
      claude: 'Claude', deepseek: 'DeepSeek', gemini: 'Gemini', gpt: 'GPT',
      glm: 'GLM', grok: 'Grok', kimi: 'Kimi', qwen: 'Qwen',
    }).map(([k, label]) => [k, { label }])),
  };
  const gpSrc = readFileSync(join(root, 'src', 'glass-panel.js'), 'utf8')
    .replace(/export\s*\{[^}]*\};?/g, '');
  const makeBlock = new Function(...Object.keys(gpStub), gpSrc + ';return { renderGlassPresetsBlock };');
  const { renderGlassPresetsBlock } = makeBlock(...Object.keys(gpStub).map((k) => gpStub[k]));
  // 台架前提核对（不是对实现的判据）：标签表的键集必须恰好等于真源值域 —— 少一只 ⇒ 判据读不到那只键
  //   （静默少测），多一只 ⇒ 造出不存在的形态。真源改了这里必须跟着改（就是这条判据在提醒）。
  check('台架前提：立绘标签表的键集 == settings-schema 的 ROPE_FORM_VALUES（10 只，不许手抄漂移）',
    Object.keys(gpStub.ROPE_FORMS).join(',') === schema.ROPE_FORM_VALUES.join(','),
    Object.keys(gpStub.ROPE_FORMS).length + ' 只 vs 真源 ' + schema.ROPE_FORM_VALUES.length + ' 只');
  const PRESETS = [
    { id: 'factory-a', name: '甲', origin: 'builtin' },
    { id: 'user-1', name: '乙', origin: 'user' },
    { id: 'user-old', name: '丙', origin: 'user', broken: 'version-obsolete' },
  ];
  const collect = (node, out) => {
    if (!node) return out;
    if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out; }
    // 文本子节点（字符串 / 数字）不是元素：只收进 out 供 textOf 之类读，不挂 props。
    if (typeof node !== 'object') { out.push(node); return out; }
    out.push(node);
    // ⚠️ `props` 可能不存在（台架里被剥掉的导出语句、以及 Fragment 之外的裸值）——
    //    判据要能读 props.children / props.className，就得在这里把缺 props 的节点补上空对象，
    //    而不是让整条判据抛 TypeError（抛了 = 后面所有判据都没跑，比红更糟）。
    if (!node.props) node.props = {};
    if (node.children) collect(node.children, out);
    return out;
  };
  const isEl = (n) => Boolean(n) && typeof n === 'object';
  const textOf = (n) => (n && n.children || []).map((c) => (typeof c === 'string' ? c : '')).join('');
  const findButtons = (tree) => collect(tree, []).filter((n) => isEl(n) && n.type === 'button');
  const findConfirm = (tree) => collect(tree, []).find((n) => isEl(n) && n.type === 'confirm-row');
  // 勾选项从渲染树里认：`input[type=checkbox]` + `aria-label`（真实 Toggle 的形状）。
  const findToggles = (tree) => collect(tree, [])
    .filter((n) => isEl(n) && n.type === 'input' && n.props.type === 'checkbox')
    .map((n) => ({ label: String(n.props['aria-label'] || ''), disabled: n.props.disabled === true }));
  let armed = '';
  const baseCtx = (over) => Object.assign({
    presets: PRESETS, loading: false, error: '', note: '', saving: false, draftName: '', armedId: '',
    saveTarget: '', exportTargetId: '',
    assetChecks: { font: true, mascot: true, avatar: false, fontAvailable: true, mascotAvailable: true, avatarAvailable: false },
    onApply: () => {}, onOpenSave: () => {}, onOpenExport: () => {}, onExportTargetChange: () => {},
    onDraftName: () => {}, onSaveCommit: () => {},
    onCancelSave: () => {}, onArmDelete: (id) => { armed = id; }, onDisarm: () => { armed = ''; },
    onDelete: () => {}, onAssetToggle: () => {}, onExportCommit: () => {}, onSaveCommit2: () => {},
    onImportFile: () => {},
  }, over || {});
  const tree1 = renderGlassPresetsBlock(baseCtx({ armedId: armed }));
  check('行为判据台架：渲染出删除按钮（出厂 + 用户 + 坏行）', findButtons(tree1).length >= 6,
    findButtons(tree1).length + ' 个按钮');
  const delFactory = findButtons(tree1).find((b) => b.props.title && String(b.props.title).includes('删除这个出厂预设'));
  check('出厂行的 × 在场（永久删除语义文案）', Boolean(delFactory));
  // ★ t8：坏行也有 ×（且 armed 后给确认行 —— 见下方 broken 判据组）。
  const delBroken = findButtons(tree1).find((b) => String(b.props.title || '').includes('删除这个预设'));
  check('坏行 / 用户行的 × 都在（删掉坏文件是唯一出路）', Boolean(delBroken));
  check('无令牌时确认行不渲染（负对照）', !findConfirm(tree1));
  if (delFactory) delFactory.props.onClick();
  check('点 × 走 onArmDelete 并记下**裸 id**（族前缀已剥）', armed === 'factory-a', armed);
  const tree2 = renderGlassPresetsBlock(baseCtx({ armedId: armed }));
  const confirm2 = findConfirm(tree2);
  check('带令牌重渲染后确认行在场，且问句是**不可恢复**语义', Boolean(confirm2)
    && String(confirm2.question).includes('删除出厂预设') && String(confirm2.question).includes('不可恢复'),
    confirm2 && String(confirm2.question).slice(0, 40));
  const tree3 = renderGlassPresetsBlock(baseCtx({ armedId: 'user-1' }));
  const confirm3 = findConfirm(tree3);
  check('用户行令牌的问句是**删除**语义', Boolean(confirm3)
    && String(confirm3.question).includes('不可恢复'), confirm3 && String(confirm3.question).slice(0, 40));
  const tree4 = renderGlassPresetsBlock(baseCtx({ armedId: 'no-such-id' }));
  check('negative control: 令牌指向不存在的 id 时确认行不渲染（不空转）', !findConfirm(tree4));

  // ★ 新增：broken 行必须**禁用应用**但仍保留删除（删掉坏文件是唯一出路 —— 与 ③c 的宿主侧判据配对）。
  //   ⚠️ broken 文案按 **origin 分两套口径**（ADR-0011 D6 + 面板注释），所以这里两种 origin 都要各测一遍：
  //     · 用户层坏行 ⇒ "读不出来 …（删掉它，重新保存一份）"；
  //     · 出厂坏行 ⇒ "**版本已作废** …（从预设栏重新保存一份即可）"。
  //   只测一种就会漏掉"有人把两套合并成一句笼统话"这种退化（那正是 D6 明令不许的形态）。
  const cells = collect(tree1, []).filter((n) => isEl(n) && n.type === 'div' && String(n.props.className || '') === 'we-picker__preset-cell');
  const cellOf = (name) => cells.find((c) => collect(c, []).some((n) => isEl(n) && n.type === 'button' && textOf(n) === name)) || null;
  const btnsOf = (cell) => cell ? collect(cell, []).filter((n) => isEl(n) && n.type === 'button') : [];
  {
    const brokenCell = cellOf('丙');
    const brokenBtns = btnsOf(brokenCell);
    const applyBtn = brokenBtns.find((b) => textOf(b) === '丙');
    check('★ 用户层坏行：应用按钮 disabled=true、title 给出可判定原因与"删掉重存"出路',
      Boolean(applyBtn) && applyBtn.props.disabled === true
      && /读不出来/.test(String(applyBtn.props.title || '')) && /重新保存/.test(String(applyBtn.props.title || '')),
      applyBtn ? String(applyBtn.props.title || '').slice(0, 46) : '未找到坏行按钮');
    check('★ 坏行仍保留删除键（坏行删不掉 = 死锁，与 ③c 配对）',
      brokenBtns.some((b) => String(b.props.className || '').includes('preset-del')),
      brokenBtns.length + ' 个按钮');
    // 负对照：健康行（乙）的应用按钮**不该**被禁用 —— 证明上面那条不是"所有按钮都 disabled"。
    const healthyCell = cellOf('乙');
    const healthyApply = btnsOf(healthyCell).find((b) => textOf(b) === '乙');
    check('negative control: 健康行的应用按钮不 disabled（禁用判据只咬坏行）',
      Boolean(healthyApply) && healthyApply.props.disabled === false,
      healthyApply ? String(healthyApply.props.disabled) : '未找到健康行按钮');
  }
  // 出厂坏行的另一套口径（用第二个台架实例，避免污染上面的 PRESETS）。
  {
    const BUILTIN_BROKEN = [{ id: 'factory-bad', name: '丁', origin: 'builtin', broken: 'version-obsolete' }];
    const treeB = renderGlassPresetsBlock(baseCtx({ presets: BUILTIN_BROKEN }));
    const bCell = collect(treeB, []).filter((n) => isEl(n) && n.type === 'div'
      && String(n.props.className || '') === 'we-picker__preset-cell')[0] || null;
    const bApply = bCell ? collect(bCell, []).filter((n) => isEl(n) && n.type === 'button').find((b) => textOf(b) === '丁') : null;
    check('★ 出厂坏行：title 点明"**版本已作废**"+ 从预设栏重存的出路（D6 要求的点名文案）',
      Boolean(bApply) && /版本已作废/.test(String(bApply.props.title || ''))
      && /从预设栏重新保存一份/.test(String(bApply.props.title || '')),
      bApply ? String(bApply.props.title || '').slice(0, 46) : '未找到出厂坏行按钮');
  }
  // t8 修复的行为判据：**坏行 armed ⇒ 确认行必须渲染**（旧代码 `!armedRow.broken` 把它挡掉
  //   ⇒ 面板点了 × 什么也不出现，而宿主那边其实已经能删 —— 用户看不到"确认删除"这一步）。
  const treeBrokenArmed = renderGlassPresetsBlock(baseCtx({ armedId: 'user-old' }));
  const confirmBroken = findConfirm(treeBrokenArmed);
  check('★ 坏行点 × 后确认行渲染（t8：坏行也要给两步确认，不能静默无反应）',
    Boolean(confirmBroken) && String(confirmBroken.question).includes('不可恢复'),
    confirmBroken ? String(confirmBroken.question).slice(0, 40) : '确认行缺席');
  // 负对照：令牌指向不存在的坏 id 时仍然不渲染（证明上面那条不是"任何 armed 都渲染"）。
  check('negative control: armedId 不在清单里时坏行确认判据不空转（仍不渲染）',
    !findConfirm(renderGlassPresetsBlock(baseCtx({ armedId: 'no-such-broken-id' }))));

  // 勾选对话框：available=false 的项必须禁用并给替代说明（勾了也带不出东西）
  const treeSave = renderGlassPresetsBlock(baseCtx({ saving: true, saveTarget: 'save' }));
  const toggles = findToggles(treeSave);
  const avatarToggle = toggles.find((t) => t.label === '会话头像');
  const fontToggle = toggles.find((t) => t.label === '字体');
  check('勾选对话框渲染出三个勾选项（字体 / 吉祥物立绘 / 会话头像）',
    toggles.length >= 3 && Boolean(fontToggle) && Boolean(avatarToggle),
    toggles.map((t) => t.label).join(','));
  // D4 三态（2026-10-12）：本机没有的资产项**不再禁用** —— 勾上就是"声明「无」"，禁用等于
  // 剥夺用户声明无的能力（旧版 `disabled: !xxxAvailable` 正是本次缺陷的客户端半边）。
  check('★ 本机没有的资产项不再禁用（勾上 = 声明「无」；字体可用同样不禁）',
    Boolean(avatarToggle) && avatarToggle.disabled === false
    && Boolean(fontToggle) && fontToggle.disabled === false,
    JSON.stringify(toggles));
  // 提示文案必须随 available 变（读 `we-picker__ctl-hint` span；Toggle 的投影里没有 hint）：
  // 本机有的 ⇒ "带进预设"；本机没有 ⇒ "声明「无」"。
  {
    const hints = collect(treeSave, [])
      .filter((n) => isEl(n) && n.props && n.props.className === 'we-picker__ctl-hint')
      .map((n) => textOf(n));
    check('★ 勾选行的提示随本机现状给两套口径（有 = 带进预设 / 没有 = 声明「无」）',
      hints.some((h) => /勾上：把当前字体带进预设/.test(h))
      && hints.some((h) => /本机没有自定义头像 —— 勾着存 = 声明「无」/.test(h)),
      JSON.stringify(hints.map((h) => h.slice(0, 16))));
    check('negative control: 提示文案不是恒真的同一条（两类文案确实不同形）',
      hints.every((h) => !(/勾上：把当前字体带进预设/.test(h) && /声明「无」/.test(h))));
  }
  // 负对照：把 available 全部翻真 ⇒ 同一条判据必须判"没有禁用项"（证明它读的是 ctx 而不是常量）。
  {
    const allAvail = renderGlassPresetsBlock(baseCtx({
      saving: true, saveTarget: 'save',
      assetChecks: { font: true, mascot: true, avatar: true, fontAvailable: true, mascotAvailable: true, avatarAvailable: true },
    }));
    check('negative control: available 全真时三项都不可禁（禁用判据随 ctx 变，不是硬编码期望）',
      findToggles(allAvail).filter((t) => t.disabled).length === 0,
      JSON.stringify(findToggles(allAvail)));
  }

  // ★ 第四态（2026-10-12 用户口径）：勾选对话框里多一行「吉祥物 · 指向」——把这一族存成**指向某只
  //   出厂自带**（正文里只留形态名、零字节），而不是只能"带我的图 / 声明无"两态。这一行的行为判据
  //   读渲染树：一组 1 + N 键（本机现状 + 真源 `ROPE_FORM_VALUES` 里的每一只内置形态，当前 N = 10）+ **受控**选中态（aria-pressed 跟 ctx.mascotPoint 走）+ 点击回传**形态名**。三条缺一条就会出现"面板上能选、正文里存不进去/选不中"的静默空转
  //   （本仓 2026-10-11 的实测教训：`has("mascot")` 与 `mascotPoint` 各自对，合起来却互斥）。
  {
    const calls = [];
    const checksBase = { font: true, mascot: true, avatar: false, fontAvailable: true, mascotAvailable: true, avatarAvailable: false };
    const segTree = (point, available) => renderGlassPresetsBlock(baseCtx({
      saving: true, saveTarget: 'save',
      assetChecks: Object.assign({}, checksBase, { mascotAvailable: available, mascotPoint: point }),
      onMascotPoint: (v) => calls.push(v),
    }));
    const groupOf = (tree) => collect(tree, [])
      .filter((n) => isEl(n) && n.props && String(n.props['aria-label'] || '') === '吉祥物 · 指向');
    const segBtns = (tree) => {
      const g = groupOf(tree);
      return g.length === 1 ? collect(g[0], []).filter((n) => isEl(n) && n.type === 'button') : [];
    };
    const pressedOf = (tree) => segBtns(tree)
      .filter((b) => String(b.props['aria-pressed']) === 'true').map((b) => textOf(b));

    const treePoint = segTree('whale', true);
    check('★ 勾选对话框里有「吉祥物 · 指向」一组键（本机现状 + 真源里的每一只出厂自带，当前 10 只）',
      groupOf(treePoint).length === 1 && segBtns(treePoint).length === 1 + schema.ROPE_FORM_VALUES.length,
      segBtns(treePoint).length + ' 键：' + (segBtns(treePoint).map((b) => textOf(b)).join(',') || '未找到分组'));
    check('★ 指向的选中态是**受控**的：ctx.mascotPoint="whale" ⇒ 只有「Deepseek_Pro」按下',
      pressedOf(treePoint).length === 1 && pressedOf(treePoint)[0] === 'Deepseek_Pro',
      pressedOf(treePoint).join(','));
    // 负对照 1：换一个 ctx 值 ⇒ 按下的必须换成那一只（证明选中态读 ctx，不是硬编码第一只 / 恒真）。
    check('negative control: 同一组键在 mascotPoint="phoebe" 下换成「菲比啾比」按下（选中态随 ctx 变）',
      pressedOf(segTree('phoebe', true)).join(',') === '菲比啾比', pressedOf(segTree('phoebe', true)).join(','));
    // 负对照 2：空指向 ⇒ 「本机现状」按下（默认态 = 带我的图 / 声明无，不是偷偷指向某只内置）。
    check('★ mascotPoint 为空 ⇒ 只有「本机现状」按下（默认是老行为，不是偷偷指向内置）',
      pressedOf(segTree('', true)).join(',') === '本机现状', pressedOf(segTree('', true)).join(','));

    const whaleBtn = segBtns(treePoint).find((b) => textOf(b) === 'Deepseek_Pro') || null;
    const ownBtn = segBtns(treePoint).find((b) => textOf(b) === '本机现状') || null;
    check('★ 两个边界的键都在场（内置形态 + 本机现状）', Boolean(whaleBtn) && Boolean(ownBtn));
    if (whaleBtn) whaleBtn.props.onClick();
    if (ownBtn) ownBtn.props.onClick();
    check('★ 回传值口径：内置键 ⇒ 形态名、本机现状 ⇒ 空串（清掉指向才有"回到老行为"的路）',
      calls.length === 2 && calls[0] === 'whale' && calls[1] === '', JSON.stringify(calls));

    // 提示文案按 available 换口径（与上面三条勾选行同一约定）：本机有 = "带进预设"，没有 = "会存成无"。
    const hintsOf = (tree) => collect(tree, [])
      .filter((n) => isEl(n) && n.props && n.props.className === 'we-picker__ctl-hint').map((n) => textOf(n));
    check('★ 指向行的提示随本机现状给两套口径（有 = 带进预设 / 没有 = 会存成「无」）',
      hintsOf(segTree('', true)).some((h) => /「本机现状」= 把这台的自定义立绘带进预设/.test(h))
      && hintsOf(segTree('', false)).some((h) => /「本机现状」会存成「无」；也可以直接选一只出厂自带/.test(h)),
      JSON.stringify(hintsOf(segTree('', false)).filter((h) => /本机现状/.test(h)).map((h) => h.slice(0, 18))));
    // 负对照 3：没勾这一族 ⇒ 指向无处可落（不勾 = 一个字都不动对方），整行不该渲染。
    const unchecked = renderGlassPresetsBlock(baseCtx({
      saving: true, saveTarget: 'save',
      assetChecks: { font: true, mascot: false, avatar: false, fontAvailable: true, mascotAvailable: true, avatarAvailable: false, mascotPoint: 'whale' },
      onMascotPoint: () => {},
    }));
    check('negative control: 没勾吉祥物那一族时指向行不渲染（不勾 = 不动对方，指向无所指）',
      groupOf(unchecked).length === 0, groupOf(unchecked).length + ' 组');
  }
  const treeExport = renderGlassPresetsBlock(baseCtx({ saving: true, saveTarget: 'export' }));
  check('导出对话框有「下载 .json」提交键（走普通链接，不用 blob）',
    collect(treeExport, []).some((n) => n.type === 'button' && textOf(n) === '下载 .json'));
  check('negative control: 未展开对话框时没有「下载 .json」（判据不空转）',
    !collect(tree1, []).some((n) => n.type === 'button' && textOf(n) === '下载 .json'));

  // ── 导出入口**独立**且目标**可选**（2026-10-11 用户口径）─────────────────────
  //   旧形态：**逐格**挂一个「导出」键（一排同名键挤在格子里，且只能导出那一格）。
  //   新形态：动作行一个「导出预设…」+ 对话框里选「导出哪一份」。
  //   两条都要钉住 —— 逐格键**不该**回来（回来了格子又被挤满且与独立入口重复），
  //   独立入口与目标选择器**必须**在（否则"选任意已有预设导出"这个能力就没了）。
  {
    const treeGrid = renderGlassPresetsBlock(baseCtx({}));
    const gridTexts = findButtons(treeGrid).map((b) => textOf(b));
    check('★ 逐格不再有「导出」键（导出已独立成动作行入口，不再挤格子）',
      !gridTexts.includes('导出'), gridTexts.join(','));
    check('★ 动作行有独立的「导出预设…」入口', gridTexts.includes('导出预设…'), gridTexts.join(','));

    // 目标选择器：选项 = 清单里**读得出来**的那几份。broken 的不进 —— 它的正文读不出来，
    // 宿主对它会 422，画一个"选了必然失败"的项等于骗用户。
    const treeEx = renderGlassPresetsBlock(baseCtx({ saving: true, saveTarget: 'export', exportTargetId: 'factory-a' }));
    const sel = collect(treeEx, []).find((n) => isEl(n) && n.type === 'select') || null;
    const optTexts = sel
      ? collect(sel, []).filter((n) => isEl(n) && n.type === 'option').map((o) => textOf(o))
      : [];
    check('★ 导出对话框有「导出哪一份」选择器，只列可导出的（坏行不进选项）',
      Boolean(sel) && optTexts.includes('甲') && optTexts.includes('乙') && !optTexts.includes('丙'),
      optTexts.join(',') || '未找到 select');
    check('选择器的当前值是受控的（读 ctx 的 exportTargetId，不是内部状态）',
      Boolean(sel) && sel.props.value === 'factory-a', sel ? String(sel.props.value) : '无 select');

    // 无目标 ⇒ 下载键禁用（而不是发起一次必然 404 的导航）。
    const dlOff = collect(renderGlassPresetsBlock(baseCtx({ saving: true, saveTarget: 'export', exportTargetId: '' })), [])
      .find((n) => isEl(n) && n.type === 'button' && textOf(n) === '下载 .json') || null;
    check('无导出目标时「下载 .json」禁用（不发起必然失败的导航）',
      Boolean(dlOff) && dlOff.props.disabled === true);
    // 负对照：同一个键在**有**目标时必须可用 —— 证明上面那条读的是 ctx，不是恒禁用。
    const dlOn = collect(treeEx, []).find((n) => isEl(n) && n.type === 'button' && textOf(n) === '下载 .json') || null;
    check('negative control: 有目标时「下载 .json」可用（禁用判据随 ctx 变，不是硬编码）',
      Boolean(dlOn) && dlOn.props.disabled !== true);

    // 清单里**一份都读不出来**时：独立入口禁用，且 title 指路（先存一份 / 先删坏的那份）。
    const allBroken = renderGlassPresetsBlock(baseCtx({
      presets: [{ id: 'b1', name: '坏', origin: 'user', broken: 'bad-json' }],
    }));
    const expBtn = findButtons(allBroken).find((b) => textOf(b) === '导出预设…') || null;
    check('清单全读不出来时独立导出入口禁用并指路（没有可导出的东西时不能装作能导）',
      Boolean(expBtn) && expBtn.props.disabled === true && /先保存一份/.test(String(expBtn.props.title || '')),
      expBtn ? String(expBtn.props.title || '').slice(0, 44) : '未找到导出入口');
    // 负对照：同一入口在**有**可导出预设时不禁用。
    const expBtnOk = findButtons(treeGrid).find((b) => textOf(b) === '导出预设…') || null;
    check('negative control: 有可导出预设时该入口不禁用（判据随清单变）',
      Boolean(expBtnOk) && expBtnOk.props.disabled !== true);
  }
}

// ── ④c #199 失败文案：真跑分类函数 + 词表对齐 ═════════════════════════════════
section('④c #199 失败文案：404 不再把宿主英文原句直落上屏，窗口期出路口径在词表里');
{
  const copyText = scopeText('src/i18n-copy');
  const storeCode = stripComments(readFileSync(join(root, 'src', 'preset-store.js'), 'utf8'));
  // 真跑 `src/preset-store.js` 里的 `glassPresetFailureReason()`：按花括号配平提取具名函数、喂桩执行。
  // grep 到 `reason` 三个字符串**不算**证据 —— 把分类改回"一句到底"它照样能匹配到。
  const at = storeCode.indexOf('function glassPresetFailureReason(');
  let fn = '';
  if (at >= 0) {
    const open = storeCode.indexOf('{', at);
    let depth = 0, end = -1;
    for (let i = open; i >= 0 && i < storeCode.length; i++) {
      if (storeCode[i] === '{') depth++;
      else if (storeCode[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    if (end > 0) fn = storeCode.slice(at, end);
  }
  check('台架自检：glassPresetFailureReason 已从源码文本里提取到', fn.length > 0,
    fn.length ? fn.length + ' 字符' : '未找到函数');

  if (fn) {
    const RESTART = '宿主里没有玻璃预设路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）';
    const dictEn = (key) => {
      const m = copyText.match(new RegExp('"' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*:\\s*"([^"]*)"'));
      return m ? m[1] : '';
    };
    const classify = new Function('weT', 'hostFailureReason', fn + '\nreturn glassPresetFailureReason;')(
      (k) => String(k), (res) => 'HOST-EN:' + String((res && res.data && res.data.error) || ''));
    const window404 = classify({ status: 404, data: { error: 'unknown preset' } });   // 旧宿主（无 reason）
    const missing404 = classify({ status: 404, data: { error: 'unknown preset', reason: 'missing' } });
    const tomb404 = classify({ status: 404, data: { error: 'unknown preset', reason: 'tombstone' } });
    const bare404 = classify({ status: 404 });                                       // 裸状态码（老语义）
    const bare405 = classify({ status: 405 });

    check('★ #199：旧宿主（404 + unknown preset，**无** reason）⇒「重启 DSH」出路文案',
      window404 === RESTART, String(window404).slice(0, 30));
    check('裸状态码 404/405（无信封）仍归「重启 DSH」（客户端形态棘轮的老语义不受影响）',
      bare404 === RESTART && bare405 === RESTART);
    // ★ 英文漏出（#188 的原始缺陷）：`unknown preset` 这句宿主原话不许直落上屏。
    check('★ #199：404 不再走 hostFailureReason 的英文原句直落（带不带 reason 都不许）',
      !/^HOST-EN:/.test(missing404) && !/^HOST-EN:/.test(tomb404)
      && !/^HOST-EN:/.test(window404),
      'missing=' + String(missing404).slice(0, 24) + ' tomb=' + String(tomb404).slice(0, 24));
    // 词表对齐：文案的**唯一**来源是词表键（中文原文作键），客户端不许出现未登记的散句。
    const dictOk = (keys) => keys.every((k) => dictEn(k).trim().length > 0 && dictEn(k) !== k);
    check('词表对齐：「重启 DSH」那条在 src/i18n-copy 里、英文非空且不是中英同形',
      dictEn(RESTART).trim().length > 0 && dictEn(RESTART) !== RESTART,
      dictEn(RESTART).slice(0, 44) || '词表里找不到这条键');
    // ★ 因果三分（#199 的 P2）：路由**在**、预设真没了 ⇒ 出路不是"重启 DSH"（重启没用）。
    //   窗口期（无 reason）/ 真不存在（missing）/ 已删除（tombstone）必须三条不同的出路，
    //   且每条都从词表来；把三条并回一句就判红。
    const threeWay = (v) => v.missing !== RESTART && v.tomb !== RESTART && v.missing !== v.tomb;
    check('★ #199-P2：三条出路两两不同（窗口期 / 真不存在 / 已删除，不许并成一句）',
      threeWay({ missing: missing404, tomb: tomb404 }),
      'missing=' + String(missing404).slice(0, 22) + ' tomb=' + String(tomb404).slice(0, 22));
    check('★ #199-P2：三条出路都在 src/i18n-copy 里，英文非空且不是中英同形',
      dictOk([RESTART, missing404, tomb404]),
      [RESTART, missing404, tomb404].map((k) => (dictOk([k]) ? 'ok' : '缺/同形')).join(','));
    // 负对照：把 reason 两分整块拿掉（回到 #199 原文的"一句到底"）⇒ 上面两条必须判红。
    const mergedFn = fn
      .replace(/\n\s*if \(res\.data\.reason === "tombstone"\) \{[\s\S]*?\n\s*\}/, '')
      .replace(/\n\s*if \(res\.data\.reason === "missing"\) \{[\s\S]*?\n\s*\}/, '');
    const classifyMerged = new Function('weT', 'hostFailureReason', mergedFn + '\nreturn glassPresetFailureReason;')(
      (k) => String(k), (res) => 'HOST-EN:' + String((res && res.data && res.data.error) || ''));
    check('negative control: 把 reason 两分拿掉（三条并回一句）会被判出（判据有牙）',
      mergedFn !== fn
      && !threeWay({
        missing: classifyMerged({ status: 404, data: { error: 'unknown preset', reason: 'missing' } }),
        tomb: classifyMerged({ status: 404, data: { error: 'unknown preset', reason: 'tombstone' } }),
      }),
      mergedFn === fn ? '变异没生效（负对照空转）' : '变异生效且判红');
  }
}

// ── 迁移说明（既有 40 项断言的去向；acceptance 第 9 条要求逐条交代）═══════════
// ① 段（旧 3 项）：`GLASS_PRESET_KEYS` 已退役 ⇒ 三条判据整体换成"四段对账"（新 6 项 + 3 负对照
//    + 1 正对照）。其中「keyOverrides 生效」与「登记表生成键自动跟随」两条**意图原样保留**，
//    只是判据的对象从"玻璃白名单"换成"派生的 settings 段"（覆盖面更大且不会漂）。
// ② 段（旧 6 项）：`sanitizeGlassPresetValues` → `sanitizePresetValues`。
//    「稀疏输入补齐成完整快照」= 保留（键数基准从玻璃子集改为 settings 段全量）；
//    「非玻璃键（含真实 settings 键 wallpaperOpacity）一律丢弃」= **等价替换并加强**：旧语义下
//      wallpaperOpacity 该丢（不在玻璃范围），新语义下它**应当**进快照 ⇒ 判据改为"排除键与资产键
//      不得泄漏进 settings 段"（②-b，喂的是两张表的全量非默认值）+ "未知键丢弃"；
//    「越界回落默认」「A2-F1」「回归钉 70 进 70 出」「glassMode 全 inherit」= 原样保留。
// ③ 段（旧 8 项）：清单/创建/重名/上限/删除/路径安全/包内字节 = **原样保留**（语义未变），
//    仅"创建补齐"的键数基准改为 settings 段全量；新增出厂正文结构与「黑客绿(Fish)」来源复核。
// ④ 段（旧 15 项）：文本棘轮中两条锚在旧编排上的正则**按新编排重写**（见 ④ 段首注释与
//    captain 指引①：失效是正确的，不是放宽），其余（localStorage / 写请求集合 / 无原生模态 /
//    词表 / 删除文案 / 两档接线 / 行为台架）原样保留并按新代码同步锚点。
// ⇒ 没有任何一条旧判据被"为了变绿"删除；每一条要么原样、要么加强、要么按新契约等价替换。

// ── teardown ────────────────────────────────────────────────────────────────
try { if (dispose) dispose(); } catch { /* ignore */ }
delete process.env.DSH_WE_STEAM_ROOT;
delete process.env.DSH_WE_UPLOAD_DIR;
rmSync(ISO, { recursive: true, force: true });

console.log('');
if (failed) {
  console.log(`PRESET SNAPSHOT CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL PRESET SNAPSHOT CHECKS PASSED (${passed})`);
// 与 verify-scene-live-occlusion.mjs 同款兜底：本段加载 client bundle 后有驻留句柄
// （实测断言全过后进程不退），显式退出把链交给下一棒。
process.exit(0);
