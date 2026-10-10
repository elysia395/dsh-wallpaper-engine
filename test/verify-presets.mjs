/**
 * verify-presets.mjs — 玻璃预设族的守卫：键集承重 + 快照消毒 + 宿主路由全链路 + 客户端形态。
 *
 * 覆盖四件容易"看起来对、实际不是那回事"的事：
 *   ① **键集（承重）**：`GLASS_PRESET_KEYS` 必须覆盖固定键 + 登记表生成的全部子项键
 *      （尊重 `keyOverrides` —— `conversation.fidelity` 是 `chatGlassFidelity`，不得出现
 *      平行键），且每个键都真在 `KINDS` 里。登记表加参数时这里自动跟上；有人手滑
 *      把白名单抄成第二份清单时本判据变红。
 *   ② **快照语义与版本短路**：`sanitizeGlassPresetValues` 对稀疏输入补齐成**完整快照**、
 *      丢弃未知键、越界值回落默认（clampNum 语义：不是截断）；**回归钉** —— 输入不带
 *      `settingsVersion` 时不得触发 v4 旧刻度换算（实测 glassAlpha 70 曾被写成 100：
 *      快照是新刻度上的值，迁移把它当旧档重写了。这条钉死"预设正文永远按当前形状读"）。
 *   ③ **宿主路由全链路**：mock `webServer` + 真 `apply(ctx)`（与 verify-fontset.mjs 同一套
 *      台架；数据目录经 `DSH_WE_DATA_DIR` 整体挪进工作区）。七套出厂预设可列、可读、
 *      **可删且删除即永久**（2026-10-04 用户口径：删后再删 404、清单不复活、无恢复通道）；
 *      用户预设可存、可读、可删；**重名 409**（字面 / 大小写变体 / 与出厂撞名
 *      三条都算重名 —— 归一化口径见 lib/routes/presets.js）；路径穿越到不了文件系统；
 *      包内目录全程字节不变（写时复制的反面："就地改了随包预设"）。
 *   ④ **客户端形态棘轮**（文本级，与 confirmSites 棘轮同款）：应用预设必须走设置通道
 *      （`persistSelection` + `applyEffects`），不得另立持久化；保存/删除之外不发写请求；
 *      预设 UI 不引入原生模态与 blob 通道。
 *
 * 需要的外界：无。Usage: node test/verify-presets.mjs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { stripComments } from './tools/js-text.mjs';
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

// ── ① 键集（承重）══════════════════════════════════════════════════════════
section('① 键集承重：GLASS_PRESET_KEYS 与 KINDS/登记表对账');
const schema = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
{
  const { GLASS_PRESET_KEYS, KINDS, GLASS_CHILDREN, childGlassKey } = schema;
  const generated = [...new Set(GLASS_CHILDREN.flatMap((c) => Object.keys(c.params).map((p) => childGlassKey(c.id, p))))];
  const fixed = ['glassColor', 'glassAlpha', 'blur', 'glassFidelity', 'glassMode', 'glassDarkSeparate',
    'leftSidebarGlass', 'titlebarGlass', 'thinkingGlass', 'thinkingNative', 'capsuleBlur', 'capsuleColor', 'sidebarGlass', 'sidebarFullClear', 'sidebarFollowGlobal',
    'sidebarBlur', 'sidebarAlpha', 'sidebarColor', 'sidebarContentAlpha', 'sidebarContentColor'];
  check('键集 = 固定键 ∪ 登记表生成键（无缺无余）',
    GLASS_PRESET_KEYS.length === new Set([...fixed, ...generated]).size
    && fixed.every((k) => GLASS_PRESET_KEYS.includes(k))
    && generated.every((k) => GLASS_PRESET_KEYS.includes(k)),
    GLASS_PRESET_KEYS.length + ' 键（固定 ' + fixed.length + ' + 生成 ' + generated.length + '，去重）');
  const missingInKinds = GLASS_PRESET_KEYS.filter((k) => !(k in KINDS));
  check('每个预设键都在 KINDS（消毒/往返才有意义）', missingInKinds.length === 0, missingInKinds.join(',') || '全部命中');
  check('keyOverrides 生效：fidelity 走 chatGlassFidelity（无平行键）',
    GLASS_PRESET_KEYS.includes('chatGlassFidelity') && !GLASS_PRESET_KEYS.includes('conversationFidelity'));
}

// ── ② 快照语义与版本短路 ═══════════════════════════════════════════════════
section('② 快照消毒：补齐 / 丢弃 / 回落默认 / 迁移短路（回归钉）');
{
  const { GLASS_PRESET_KEYS, sanitizeGlassPresetValues, DEFAULTS } = schema;
  const sparse = sanitizeGlassPresetValues({ glassAlpha: 55 });
  check('稀疏输入补齐成完整快照（缺键 = 玻璃键默认值）',
    Object.keys(sparse).length === GLASS_PRESET_KEYS.length
    && sparse.glassAlpha === 55 && sparse.blur === DEFAULTS.blur,
    Object.keys(sparse).length + ' 键');
  const polluted = sanitizeGlassPresetValues({ glassAlpha: 55, notAGlassKey: 'x', wallpaperOpacity: 50 });
  check('非玻璃键（含真实存在的 settings 键）一律丢弃',
    !('notAGlassKey' in polluted) && !('wallpaperOpacity' in polluted) && polluted.glassAlpha === 55);
  const over = sanitizeGlassPresetValues({ glassAlpha: 999, blur: -5 });
  check('越界值回落默认（clampNum 语义：不是截断）',
    over.glassAlpha === DEFAULTS.glassAlpha && over.blur === DEFAULTS.blur,
    'glassAlpha=' + over.glassAlpha);
  // §11 A2-F1：`glassColor` 是一对、开关决定两半是否独立。开关不进快照的话，恢复一个
  // "两半不同"的预设会把开关留在 OFF ⇒ 面板从此只认浅色半，深色半的设置静默失效。
  check('A2-F1：glassDarkSeparate 进快照、玻璃色按一对归一',
    sanitizeGlassPresetValues({}).glassDarkSeparate === false
      && sanitizeGlassPresetValues({ glassDarkSeparate: true }).glassDarkSeparate === true
      && sanitizeGlassPresetValues({ glassDarkSeparate: 'yes' }).glassDarkSeparate === false
      && JSON.stringify(sanitizeGlassPresetValues({ glassColor: { light: '#123456', dark: '#654321' } }).glassColor)
        === JSON.stringify({ light: '#123456', dark: '#654321' })
      && JSON.stringify(sanitizeGlassPresetValues({ glassColor: '#123456' }).glassColor)
        === JSON.stringify({ light: '#123456', dark: '#123456' }),
    JSON.stringify({ off: sanitizeGlassPresetValues({}).glassDarkSeparate, on: sanitizeGlassPresetValues({ glassDarkSeparate: true }).glassDarkSeparate }));
  // 回归钉：2026-10-04 实测 —— 不盖 settingsVersion 时 sanitizeFromSchema 入口的
  // migrateSettings 会把快照当旧档做 v4 换算（70 → 100）。
  const noVersion = sanitizeGlassPresetValues({ glassAlpha: 70, sidebarAlpha: 85, sidebarContentAlpha: 30 });
  check('回归钉：无版本号输入不做旧刻度换算（70 进 70 出）',
    noVersion.glassAlpha === 70 && noVersion.sidebarAlpha === 85 && noVersion.sidebarContentAlpha === 30,
    'glassAlpha=' + noVersion.glassAlpha + ' sidebarAlpha=' + noVersion.sidebarAlpha);
  const glassModeOk = noVersion.glassMode && Object.values(noVersion.glassMode).every((m) => m === 'inherit');
  check('glassMode 整键在快照里且默认全 inherit', Boolean(glassModeOk));
}

// ── ③ 宿主路由全链路 ═══════════════════════════════════════════════════════
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
check('玻璃预设族路由已注册（prefix）', Boolean(route), route && route.path);
// 路由族文件的**形态**判据：注册器名与前缀路径没被手滑改掉（改了 ⇒ 与本文件的对账一齐改）。
const routeSrc = readFileSync(join(root, 'lib', 'routes', 'presets.js'), 'utf8');
check('路由族文件在位：注册器与前缀路径的形状未漂移',
  /export function registerGlassPresetsRoutes/.test(routeSrc)
  && routeSrc.includes('`${BASE}/glass-presets`')
  && /GLASS_PRESET_TOMBSTONE_TAG/.test(routeSrc));

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
const waitRes = (res) => new Promise((r) => res.__state.ended ? r() : res.on('finish', r));
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
const getList = async () => bodyJson(await callRoute(route, fakeReq('/wallpaper-engine/glass-presets', 'GET'))) || {};
const create = (name, values, id) => callRoute(route, fakeReq('/wallpaper-engine/glass-presets/create', 'POST',
  JSON.stringify(Object.assign({ name, values: values || {} }, id ? { id } : {}))));
const del = (id) => callRoute(route, fakeReq('/wallpaper-engine/glass-presets/' + id, 'DELETE'));

{
  const digestBefore = dirDigest(BUILTIN);
  // 清单：仍是七套出厂（含作者自用），其中「出厂默认」被「黑客绿(Fish)」**替换**而非新增
  // —— 总数不变，上限 8 里留给用户的那一格因此不受影响。响应无 hidden 形态（删除即永久，无恢复通道）
  let list = await getList();
  let rows = Array.isArray(list.presets) ? list.presets : [];
  const builtinRows = rows.filter((r) => r.origin === 'builtin');
  check('清单 200：七套出厂预设、origin=builtin（含「作者自用」与「黑客绿(Fish)」），响应无 hidden 字段',
    builtinRows.length === 7 && !('hidden' in list)
    && builtinRows.some((r) => r.id === 'factory-author' && r.name === '作者自用')
    && builtinRows.some((r) => r.id === 'factory-fish' && r.name === '黑客绿(Fish)'),
    builtinRows.map((r) => r.id).join(','));
  // 替换而非新增：被替换掉的 id 必须**不再随包**（留着就变回八套、把用户位吃掉）
  check('「出厂默认」已被替换掉：factory-default 不再随包',
    !builtinRows.some((r) => r.id === 'factory-default'),
    builtinRows.map((r) => r.id).join(','));

  // 创建用户预设（占第 8 个位）
  const created = await create('我的夜色', { glassColor: '#123456', glassAlpha: 66 }, 'preset-test-1');
  const createdData = bodyJson(created);
  check('创建 200，id 用客户端给的，values 缺键补齐成完整快照', created.__state.status === 200
    && createdData.id === 'preset-test-1'
    && Object.keys(createdData.values || {}).length === schema.GLASS_PRESET_KEYS.length
    // #159②：玻璃色在存储里是**一对** `{light, dark}`；旧式标量进快照也要归一成一对同值
    //（出厂预设正文、手工编辑的档都走这条 —— 它们盖了版本号、不过迁移段）。
    && (createdData.values.glassColor || {}).light === '#123456'
    && (createdData.values.glassColor || {}).dark === '#123456',
    'glassColor=' + JSON.stringify(createdData.values && createdData.values.glassColor));

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
  const freed = await create('腾位后的新预设');
  check('删除腾位后创建放行（已删除的不占上限）', freed.__state.status === 200);
  await del('preset-test-1'); // 释放旧位：腾位 + 同名测试要在 8 个活跃内完成

  // 删除期间名字放开：可以存一份叫「重磨砂」的（名字对比域只含活跃清单）
  const nameFreed = await create('重磨砂', { glassAlpha: 50 }, 'preset-rename-1');
  check('删除后出厂名字放开（同名创建 200）', nameFreed.__state.status === 200);
  await del('preset-rename-1');

  // 不可恢复（2026-10-04 口径）：删墓碑 = 复活的那条通道已封 —— 再删一次 404，
  // 清单依旧没有它；就算那个名字已经空出来，出厂预设也不会回来。
  const restoreAttempt = await del('factory-frosted');
  list = await getList();
  check('出厂删除即永久：再删一次 404、不复活（清单仍没有它）',
    restoreAttempt.__state.status === 404
    && list.presets.length === 7 && !list.presets.some((r) => r.id === 'factory-frosted'),
    'status=' + restoreAttempt.__state.status);

  // 用户预设删除 / 404 / 路径安全（形状不变）
  await del('factory-night');           // 删除腾位（不影响包内字节）
  const mk2 = await create('删除语义用的预设', {}, 'preset-test-2');
  const delUser = await del('preset-test-2');
  const delGone = await del('preset-test-2');
  const missing = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/preset-nope', 'GET'));
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


// ── ④ 客户端形态棘轮（文本级）══════════════════════════════════════════════
section('④ 客户端形态棘轮：应用走设置通道 / 无第二持久化 / 无原生模态');
{
  const storeSrc = readFileSync(join(root, 'src', 'preset-store.js'), 'utf8');
  const panelSrc = readFileSync(join(root, 'src', 'glass-panel.js'), 'utf8');
  check('应用 = 整快照合并 + persistSelection（走设置通道，不另立持久化）',
    /Object\.assign\(selection, values\);\s*\n\s*setPresetError\(""\);\s*\n\s*persistSelection\(\);/.test(storeSrc));
  check('应用后 applyEffects() 立即落效（不等等下一次重渲染）',
    /persistSelection\(\);[\s\S]{0,80}applyEffects\(\);/.test(storeSrc));
  check('预设通道不直接写 localStorage（缓存归 settings 通道管）',
    !/localStorage/.test(storeSrc));
  check('写请求只有 create 与 DELETE（预设没有 PUT / activate）',
    (storeSrc.match(/method:\s*"(POST|PUT|DELETE)"/g) || []).join(',') === 'method: "POST",method: "DELETE"',
    (storeSrc.match(/method:\s*"(POST|PUT|DELETE)"/g) || []).join(','));
  check('预设 UI 无原生模态、无 blob 通道（代码级）',
    !/window\.confirm/.test(stripComments(panelSrc))
    && !/createObjectURL|new Blob|showSaveFilePicker/.test(storeSrc + panelSrc));
  check('出厂预设名字走 weT 词表（就地字面量，不是数据直出）',
    /"factory-fish": weT\("黑客绿\(Fish\)"\)/.test(panelSrc));
  // 2026-10-04 口径再收紧：出厂预设删除 = **永久删除**（不可恢复）—— 判据从"隐藏语义"
  // 改为"两个来源各有一句删除语义文案"（文本级；行为级见下方真渲染判据）。
  check('删除按钮文案按 origin 分语义（出厂=永久删除 / 用户=删除）',
    /删除这个出厂预设（不可恢复）/.test(panelSrc)
    && /删除这个预设（会再问一次）/.test(panelSrc));
  // 玻璃节 ctx 的**两档接线完整性**（2026-10-04 实测教训）：侧栏「外观」页用自己的
  // sidebarRenderCtx 组装处理器清单，漏接一个 ⇒ 那个滑杆在该档拿到 undefined，
  // 拖动整条死（值弹回、变量不动）。判据：renderAppearanceGlassSection 解构里
  // 出现的每个 on* 处理器，必须在**两个** ctx 组装点都能找到同名标识符。
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
    // 侧栏专属处理器（2026-10-09 折叠块）：**设置页不画那一行** ⇒ 设置页 ctx 不接它是
    // 对的（接了反而是死字段）。它们必须出现在 quick-panel；设置页那份检查豁免。
    const SIDEBAR_ONLY = ['onToggleGlassDetail'];
    const missingClient = handlers.filter((h) => !SIDEBAR_ONLY.includes(h)
      && !new RegExp('\\b' + h + '\\b').test(clientAll));
    const missingQp = handlers.filter((h) => !new RegExp('\\b' + h + '\\b').test(qpAll));
    check('每个玻璃节处理器都在设置页 ctx 里（侧栏专属豁免）', missingClient.length === 0, missingClient.join(',') || '全在');
    check('每个玻璃节处理器都在侧栏快捷面板 ctx 里（漏接 = 该档滑杆全死）',
      missingQp.length === 0, missingQp.join(',') || '全在');
    check('negative control: 解构里造一个不存在的处理器会被判出',
      handlers.concat('onNoSuchHandler').some((h) => !new RegExp('\\b' + h + '\\b').test(qpAll)));
  }

  // 行为判据（真渲染 + 意图驱动）：armedId 是**裸 id**（armedIdOf 已剥族前缀）——
  // 2026-10-04 实测：拿裸 id 与 "gpreset:" + id 比较 ⇒ 确认行永远不渲染 = "点删除没反应"。
  // 本判据把这条钉死：点 × ⇒ onArmDelete 记下 id ⇒ 带 armedId 重渲染 ⇒ 确认行必须在场，
  // 且出厂/用户两种语义的问句各就各位；负对照 = 令牌不匹配时不渲染。
  {
    const ReactStub = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: '@fragment' };
    const gpStub = {
      React: ReactStub,
      weT: (k) => k,
      ctlText: () => ({ type: 'ctl' }),
      renderConfirmRow: (armed, token, question) => ({ type: 'confirm-row', question }),
      GLASS_COLOR_PRESETS: ['#ffffff'],
      SliderRow: (label) => ({ type: 'slider', label }),
      switchRow: (label, on) => ({ type: 'switch', label, on: Boolean(on) }),
      swatchRow: (label) => ({ type: 'swatch', label }),
    };
    const gpSrc = readFileSync(join(root, 'src', 'glass-panel.js'), 'utf8')
      .replace(/export\s*\{[^}]*\};?/g, '');
    const makeBlock = new Function(...Object.keys(gpStub), gpSrc + ';return { renderGlassPresetsBlock };');
    const { renderGlassPresetsBlock } = makeBlock(...Object.keys(gpStub).map((k) => gpStub[k]));
    const PRESETS = [
      { id: 'factory-a', name: '甲', origin: 'builtin' },
      { id: 'user-1', name: '乙', origin: 'user' },
    ];
    const collect = (node, out) => {
      if (!node) return out;
      if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out; }
      out.push(node);
      if (node.children) collect(node.children, out);
      return out;
    };
    const findButtons = (tree) => collect(tree, []).filter((n) => n.type === 'button');
    const findConfirm = (tree) => collect(tree, []).find((n) => n.type === 'confirm-row');
    let armed = '';
    const ctxOf = (armedId) => ({
      presets: PRESETS, loading: false, error: '', saving: false, draftName: '', armedId,
      onApply: () => {}, onOpenSave: () => {}, onDraftName: () => {}, onSaveCommit: () => {},
      onCancelSave: () => {}, onArmDelete: (id) => { armed = id; }, onDisarm: () => { armed = ''; },
      onDelete: () => {},
    });
    const tree1 = renderGlassPresetsBlock(ctxOf(armed));
    check('行为判据台架：渲染出删除按钮（出厂 + 用户）', findButtons(tree1).length >= 4,
      findButtons(tree1).length + ' 个按钮');
    const delFactory = findButtons(tree1).find((b) => b.props.title && String(b.props.title).includes('删除这个出厂预设'));
    check('出厂行的 × 在场（永久删除语义文案）', Boolean(delFactory));
    check('无令牌时确认行不渲染（负对照）', !findConfirm(tree1));
    if (delFactory) delFactory.props.onClick();
    check('点 × 走 onArmDelete 并记下**裸 id**（族前缀已剥）', armed === 'factory-a', armed);
    const tree2 = renderGlassPresetsBlock(ctxOf(armed));
    const confirm2 = findConfirm(tree2);
    check('带令牌重渲染后确认行在场，且问句是**不可恢复**语义', Boolean(confirm2)
      && String(confirm2.question).includes('删除出厂预设') && String(confirm2.question).includes('不可恢复'),
      confirm2 && String(confirm2.question).slice(0, 40));
    const tree3 = renderGlassPresetsBlock(ctxOf('user-1'));
    const confirm3 = findConfirm(tree3);
    check('用户行令牌的问句是**删除**语义', Boolean(confirm3)
      && String(confirm3.question).includes('不可恢复'), confirm3 && String(confirm3.question).slice(0, 40));
    const tree4 = renderGlassPresetsBlock(ctxOf('no-such-id'));
    check('negative control: 令牌指向不存在的 id 时确认行不渲染（不空转）', !findConfirm(tree4));
  }
}

// ── teardown ────────────────────────────────────────────────────────────────
try { dispose && dispose(); } catch { /* ignore */ }
delete process.env.DSH_WE_STEAM_ROOT;
delete process.env.DSH_WE_UPLOAD_DIR;
rmSync(ISO, { recursive: true, force: true });

console.log('');
if (failed) {
  console.log(`GLASS PRESET CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL GLASS PRESET CHECKS PASSED (${passed})`);
