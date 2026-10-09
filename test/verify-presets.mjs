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

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// 归属（ownerId）走**真解析路径**：把 DSH_HOME 一起挪进工作区，再写一份测试身份文件。
// ⚠️ 不覆盖 DSH_HOME 的话，本进程会去读**真机**的 `$DSH_HOME/.anonymous-user-id`
//    （本仓的守卫常在 DSH 环境里跑，那个变量通常已经存在）⇒ 判据随机器而变。
// 两个身份都要：一个"我"、一个"别人"（用来验 owned=false 那一档）。
const TEST_USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FOREIGN_USER_ID = 'ffffffff-1111-4222-8333-444444444444';
const ISO_DSH_HOME = join(ISO_HOME, '.dsh');
mkdirSync(ISO_DSH_HOME, { recursive: true });
writeFileSync(join(ISO_DSH_HOME, '.anonymous-user-id'), TEST_USER_ID + '\n');
process.env.DSH_HOME = ISO_DSH_HOME;

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
  // 清单：七套出厂（含作者自用）；响应无 hidden 形态（删除即永久，无恢复通道）
  let list = await getList();
  let rows = Array.isArray(list.presets) ? list.presets : [];
  const builtinRows = rows.filter((r) => r.origin === 'builtin');
  check('清单 200：七套出厂预设、origin=builtin（含「作者自用」），响应无 hidden 字段',
    builtinRows.length === 7 && !('hidden' in list)
    && builtinRows.some((r) => r.id === 'factory-author' && r.name === '作者自用'),
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

  // ── ③b 导出 / 导入 / 归属（ownerId）──────────────────────────────────────
  // 形态对齐 test/verify-fontset.mjs 同名一节：导出 200 + attachment 头 + `$schema` 逐字，
  // 导入 → **新 id**、往返正文 canon 相等，坏版本 422 且清单标 broken。
  //
  // ⚠️ 名额账（本族的硬上限是 8）：③ 结束时活跃 = 5 套出厂。本节先删掉两套出厂腾出余量，
  //    再按"造 → 验 → 删"分段推进 —— 上限是**活跃**预设计，任何一步超了都是 409 假红。
  const exportReq = (id) => callRoute(route, fakeReq('/wallpaper-engine/glass-presets/' + id + '/export', 'GET'));
  const importDoc = (doc) => callRoute(route, fakeReq('/wallpaper-engine/glass-presets/import', 'POST',
    typeof doc === 'string' ? doc : JSON.stringify(doc)));
  const byId = async (id) => (await getList()).presets.find((r) => r.id === id) || null;
  await del('factory-clear');
  await del('factory-vivid'); // 腾出两个名额（随包目录字节不变由下方判据兜住）
  await del(bodyJson(freed).id); // 上一段"腾位后创建"留下的那份，本节不再需要

  // 造一份"可导出"的用户预设（快照里放两个非默认值，往返才有意义）。
  const src = await create('导出用的预设', { glassAlpha: 37, blur: 21 }, 'preset-exp-1');
  const exp = await exportReq('preset-exp-1');
  const expText = exp.__state.body.toString('utf8');
  const expDoc = bodyJson(exp);
  check('导出 200 + attachment + no-store + `$schema` 逐字（正文由读到的值重建）',
    src.__state.status === 200 && exp.__state.status === 200
    && String(exp.__state.headers['Content-Disposition'] || '').includes('attachment')
    && String(exp.__state.headers['Content-Disposition'] || '').includes('preset-exp-1.json')
    && exp.__state.headers['Cache-Control'] === 'no-store'
    && String(exp.__state.headers['Content-Type'] || '').includes('application/json')
    && expDoc.$schema === schema.GLASS_PRESET_SCHEMA_TAG
    && expDoc.id === 'preset-exp-1' && expDoc.name === '导出用的预设'
    && expDoc.values.glassAlpha === 37 && expDoc.values.blur === 21
    // 归属随导出走（分享出去的文件自带"谁的"），且是**本次测试注入的那个用户**。
    && expDoc.ownerId === TEST_USER_ID,
    'schema=' + expDoc.$schema + ' owner=' + expDoc.ownerId);
  check('导出的正文是完整快照、以换行收尾（可再导入的形状）',
    Object.keys(expDoc.values).length === schema.GLASS_PRESET_KEYS.length && /\n$/.test(expText));

  // 往返：把导出的正文原样导回去。id 与名字都已被占用 ⇒ **两条都顺延**（不是覆盖、也不是 409）。
  const reimport = await importDoc(expDoc);
  const reimportData = bodyJson(reimport);
  check('导入 200：id 撞占用时顺延（新 id ≠ 源 id），正文往返 canon 相等',
    reimport.__state.status === 200
    && typeof reimportData.id === 'string' && reimportData.id !== 'preset-exp-1'
    && JSON.stringify(reimportData.values) === JSON.stringify(expDoc.values),
    'id=' + reimportData.id);
  const regot = bodyJson(await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/' + reimportData.id, 'GET')));
  check('导入后的那份可读回，values 与导出的一致（往返闭合）',
    regot && regot.ok === true && JSON.stringify(regot.values) === JSON.stringify(expDoc.values));
  const srcStill = bodyJson(await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/preset-exp-1', 'GET')));
  check('导入不覆盖源预设（两份并存）', srcStill && srcStill.ok === true && srcStill.id === 'preset-exp-1');

  // 名字**不撞**时一个字都不改（让位是兜底，不是习惯性改名）。
  const freeDoc = Object.assign({}, expDoc, { id: 'preset-imp-9', name: '进口的预设' });
  const importedFree = await importDoc(freeDoc);
  const freeData = bodyJson(importedFree);
  check('名字不撞时原样保留：id 用文件里的、name 一个字不动、renamed=false',
    importedFree.__state.status === 200 && freeData.renamed === false
    && freeData.id === 'preset-imp-9' && freeData.name === '进口的预设',
    'renamed=' + freeData.renamed + ' id=' + freeData.id);

  // 重名让位：同一份文档再导一次 ⇒ 名字继续顺延（源那份仍占着原名）。
  const third = await importDoc(expDoc);
  const thirdData = bodyJson(third);
  check('重名让位：名字顺延为「… (3)」且 renamed=true（不 409、不静默改名）',
    third.__state.status === 200 && thirdData.renamed === true
    && thirdData.name === '导出用的预设 (3)'
    && thirdData.id !== 'preset-exp-1' && thirdData.id !== reimportData.id,
    'name=' + thirdData.name + ' id=' + thirdData.id);
  check('第一次导入的名字也让位了（源那份一直占着原名）',
    reimportData.renamed === true && reimportData.name === '导出用的预设 (2)',
    'name=' + reimportData.name);
  // 让位出来的名字**不再**与活跃清单里的任何名字撞（否则只是把 409 推给别人）。
  {
    const names = (await getList()).presets.map((r) => String(r.name).trim().toLowerCase());
    check('顺延后的名字在活跃清单里唯一', new Set(names).size === names.length, names.join('|'));
  }

  // 归属：源预设属于本用户 ⇒ owned=true；把磁盘上那份改成**别人的** ⇒ 照常列出、但 owned=false；
  // 去掉 ownerId（旧文件形状）⇒ 无主、算"我的"（这是零迁移的全部依据）。
  {
    const before = await byId('preset-exp-1');
    const userFile = join(USER, 'preset-exp-1.json');
    const onDisk = JSON.parse(readFileSync(userFile, 'utf8'));
    writeFileSync(userFile, JSON.stringify(Object.assign({}, onDisk, { ownerId: FOREIGN_USER_ID }), null, 2) + '\n');
    const after = await byId('preset-exp-1');
    writeFileSync(userFile, JSON.stringify({
      $schema: schema.GLASS_PRESET_SCHEMA_TAG, id: 'preset-exp-1', name: '导出用的预设', values: onDisk.values,
    }, null, 2) + '\n');
    const legacy = await byId('preset-exp-1');
    check('归属标注：本人 owned=true / 别人 owned=false（仍列出）/ 无主旧文件 owned=true',
      before && before.owned === true && before.ownerId === TEST_USER_ID
      && after && after.owned === false && after.ownerId === FOREIGN_USER_ID
      && legacy && legacy.owned === true && legacy.ownerId === null,
      [before && before.owned, after && after.owned, legacy && legacy.owned].join('/'));
    const builtinRow = (await getList()).presets.find((r) => r.origin === 'builtin');
    check('随包预设永远无主且 owned=true（不属于任何用户）',
      builtinRow && builtinRow.ownerId === null && builtinRow.owned === true);
    // 导入**盖当前用户**，不信文件里那个（一份来自别人的文件导入后就是你的）。
    const adopted = bodyJson(await importDoc(Object.assign({}, expDoc, { ownerId: FOREIGN_USER_ID })));
    const adoptedRow = adopted && adopted.id ? await byId(adopted.id) : null;
    check('导入的归属由宿主盖章（文件里的 ownerId 不被采信）',
      adopted && adopted.ownerId === TEST_USER_ID && adoptedRow && adoptedRow.owned === true,
      'owner=' + (adopted && adopted.ownerId));
    await del(adopted.id);
  }

  // 名额腾回来：导入产物删掉，给下面的保留段用例留位置。
  await del(reimportData.id);
  await del(thirdData.id);
  await del(freeData.id);
  await del('preset-exp-1');

  // 异常与边界（预检都在**名额判定之前**，所以这一组不受上限影响）。
  {
    const badSchema = await importDoc({ $schema: 'dsh-we/fontset@1', name: 'x', values: {} });
    const notObject = await importDoc('"just a string"');
    const badJson = await importDoc('{ not json');
    const noValues = await importDoc({ $schema: schema.GLASS_PRESET_SCHEMA_TAG, name: 'x' });
    check('导入预检：$schema 不符 400 / 非对象 400 / 坏 JSON 400 / 缺 values 400',
      badSchema.__state.status === 400 && notObject.__state.status === 400
      && badJson.__state.status === 400 && noValues.__state.status === 400,
      [badSchema.__state.status, notObject.__state.status, badJson.__state.status, noValues.__state.status].join('/'));
    check('$schema 不符时的文案点明**要哪个标记**（用户手里可能是任意 .json）',
      String((bodyJson(badSchema) || {}).error || '').includes(schema.GLASS_PRESET_SCHEMA_TAG));
    // 导入是 POST 段：别的动词一律 405（它是保留段，不会被当成 id）。
    const importGet = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/import', 'GET'));
    check('保留段 import 只收 POST（GET 405，不会被当成一台预设）', importGet.__state.status === 405);
    // 非法 / 未知 / 读不懂的导出，三种各自的码；穿越与非 GET 各一条。
    const badExportId = await exportReq('not%20a%20valid%20id!');
    const unknownExport = await exportReq('preset-nope');
    const escapedExport = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/..%2F..%2Fconfig.json/export', 'GET'));
    const wrongMethod = await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/preset-exp-1/export', 'POST'));
    check('导出：非法 id 400 / 未知 404 / 穿越 4xx / 非 GET 405',
      badExportId.__state.status === 400 && unknownExport.__state.status === 404
      && escapedExport.__state.status >= 400 && wrongMethod.__state.status === 405,
      [badExportId.__state.status, unknownExport.__state.status, escapedExport.__state.status, wrongMethod.__state.status].join('/'));
    // 保留段：三个段名**永远不能当 id** —— 否则那台文件会变成"点不动的预设"。
    // 两条不同的机制，两条都要钉住：
    //   · `create` 过得了 id 白名单（`[A-Za-z0-9_-]{1,64}`），是**历史漏洞**（段名先匹配 ⇒ 占了
    //     它的文件永远读不到）—— 由本族 `PRESET_RESERVED_IDS` 的占用域补上，id 顺延成 `create-2`；
    //   · `import` / `export` 更早一步就被 id 白名单本身拒了（`FONTSET_RESERVED_IDS`，
    //     与字体集族共用同一条）⇒ 客户端给的这两个词当**非法**处理，落成兜底 base。
    const reservedCreate = await create('保留段 create', { glassAlpha: 11 }, 'create');
    const reservedImport = await create('保留段 import', { glassAlpha: 12 }, 'import');
    const reservedExport = await create('保留段 export', { glassAlpha: 13 }, 'export');
    const rids = [bodyJson(reservedCreate).id, bodyJson(reservedImport).id, bodyJson(reservedExport).id];
    check('保留段不可占用：create 顺延成 create-2；import / export 连 id 白名单都过不了',
      rids[0] === 'create-2'
      && rids.every((id) => schema.isGlassPresetId(id) && !['create', 'import', 'export'].includes(id))
      && rids[1] !== rids[2],
      rids.join('/'));
    // 顺延出来的那几份仍然**点得动**（路由段与 id 段不打架）。
    const reservedReads = [];
    for (const id of rids) reservedReads.push((await callRoute(route, fakeReq('/wallpaper-engine/glass-presets/' + id, 'GET'))).__state.status);
    check('顺延后的 id 都是真路由（不是被段名吞掉的死文件）',
      reservedReads.every((s) => s === 200), reservedReads.join('/'));
    // 读不懂的预设：导出必须**拒绝**（不把坏文件导成"看起来能分享"的东西），清单标 broken。
    const brokenFile = join(USER, 'preset-broken.json');
    writeFileSync(brokenFile, JSON.stringify({ $schema: 'dsh-we/glass-preset@999', id: 'preset-broken', values: {} }) + '\n');
    const brokenExport = await exportReq('preset-broken');
    const brokenRow = await byId('preset-broken');
    check('读不懂的预设：导出 422 { reason }，清单里如实标 broken（不静默）',
      brokenExport.__state.status === 422 && bodyJson(brokenExport).reason === 'bad-version'
      && brokenRow && brokenRow.broken === 'bad-version',
      'status=' + brokenExport.__state.status + ' reason=' + (bodyJson(brokenExport) || {}).reason);
    rmSync(brokenFile, { force: true });
    for (const id of rids) await del(id);
  }
  check('导出/导入全程包内目录字节不变', dirDigest(BUILTIN) === digestBefore);
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
  // 写请求的口径（2026-10-10 起 import 也是写）：**没有 PUT** 仍是本族的定义性约束
  // （预设没有"编辑一份"的流程），POST 恰好两处 = create + import，DELETE 一处。
  // 导出**不是**写请求 —— 它是宿主带 attachment 头应答的普通 GET 链接（下方另有判据）。
  // 按**计数**而不是出现顺序判：顺序只是文件里的书写次序，不是契约。
  const writeMethods = storeSrc.match(/method:\s*"(POST|PUT|DELETE)"/g) || [];
  const countOf = (m) => writeMethods.filter((x) => x === 'method: "' + m + '"').length;
  check('写请求：无 PUT；POST = create + import 两处；DELETE 一处',
    countOf('PUT') === 0 && countOf('POST') === 2 && countOf('DELETE') === 1,
    writeMethods.join(','));
  check('预设 UI 无原生模态、无 blob 通道（代码级）',
    !/window\.confirm/.test(stripComments(panelSrc))
    && !/createObjectURL|new Blob|showSaveFilePicker/.test(storeSrc + panelSrc));
  check('出厂预设名字走 weT 词表（就地字面量，不是数据直出）',
    /"factory-default": weT\("出厂默认"\)/.test(panelSrc));
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

    // ── 导出 / 导入的真渲染判据（2026-10-10 新增）───────────────────────────
    // 上面那套 ctx **不给** exportUrl / onImport —— 那正是"新字段缺席时不许炸"的形态判据；
    // 这里补上它们，钉住"给了就一定要长出来"，两条互为对照（缺任一条都会让另一条空转）。
    const findNodes = (tree, pred) => collect(tree, []).filter(pred);
    const fakeInput = { clicked: 0, click() { this.clicked += 1; } };
    let importedFile = null;
    /** 带上导出/导入两枚新字段的 ctx（`present:false` = 负对照：字段缺席）。 */
    const ctxExport = (importNote, present = true) => Object.assign(ctxOf(''), present ? {
      exportUrl: (id) => '/wallpaper-engine/glass-presets/' + id + '/export',
      onImport: (f) => { importedFile = f; },
      importNote,
    } : {});

    const treeE = renderGlassPresetsBlock(ctxExport('重名已让位，导入为「乙 (2)」'));
    const links = findNodes(treeE, (n) => n.type === 'a');
    check('用户预设行有导出链接（出厂行没有：导出随包发布物没有意义）',
      links.length === 1 && links[0].props.href === '/wallpaper-engine/glass-presets/user-1/export'
      && links[0].props.download === 'user-1.json',
      links.map((l) => l.props.href).join(',') || '（一条都没有）');
    check('导出是**普通链接**（不是按钮 + 不是 blob 通道）',
      links.length === 1 && !links.some((l) => /^(javascript|blob):/.test(String(l.props.href || ''))));

    const inputNode = findNodes(treeE, (n) => n.type === 'input' && n.props.type === 'file')[0];
    check('导入的隐藏 file input：只收 .json、隐藏、有 ref 供按钮去 click()',
      Boolean(inputNode) && String(inputNode.props.accept).includes('.json')
      && inputNode.props.style && inputNode.props.style.display === 'none'
      && typeof inputNode.props.ref === 'function',
      inputNode ? JSON.stringify(inputNode.props.accept) : '缺失');
    if (inputNode && typeof inputNode.props.ref === 'function') inputNode.props.ref(fakeInput);
    const importBtn = findButtons(treeE).find((b) => String(b.props.title || '').includes('导入一份预设'));
    check('导入按钮在场且文案点明"重名会让位 / 不会自动应用"',
      Boolean(importBtn) && String(importBtn.props.title).includes('重名会自动让位')
      && String(importBtn.props.title).includes('不会自动应用'));
    if (importBtn) importBtn.props.onClick();
    check('点导入按钮 ⇒ 真的去 click() 那个 file input（接线不是摆设）', fakeInput.clicked === 1,
      'clicked=' + fakeInput.clicked);
    // 选文件 ⇒ onImport 拿到那个 File（读文件与校验在 store 里，渲染器只负责"选"）。
    if (inputNode) inputNode.props.onChange({ target: { files: [{ name: 'x.json' }], value: 'x' } });
    check('file input 的 onChange 把 File 交给 onImport（且清空 input.value 以便重选同一个文件）',
      importedFile && importedFile.name === 'x.json', importedFile && importedFile.name);
    check('让位提示行如实渲染（静默改名最恼人）',
      findNodes(treeE, (n) => n.type === 'div' && typeof n.children[0] === 'string'
        && n.children[0].includes('重名已让位')).length === 1);

    // 负对照：两枚字段都缺席时，上面那三样一个都不许出现（否则"给了才画"这条只是巧合）。
    const treeN = renderGlassPresetsBlock(ctxExport('', false));
    check('negative control: exportUrl / onImport 缺席 ⇒ 导出链接与导入按钮都不渲染（不炸、不空转）',
      findNodes(treeN, (n) => n.type === 'a').length === 0
      && !findButtons(treeN).some((b) => String(b.props.title || '').includes('导入一份预设'))
      && !collect(treeN, []).some((n) => n.type === 'input' && n.props.type === 'file'));
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
