/**
 * routes/presets.js — **玻璃预设族**路由：`<BASE>/glass-presets` 一个前缀下的
 * 六个端点 —— list / get / create / delete / import / export。
 *
 * 为什么独立成文件：与字体集族（`lib/routes/fontsets.js`）同一条理由 —— 预设是
 * **磁盘上的一份份文件**（`glass-presets/<id>.json`），"id 从哪来、谁能写那个目录、
 * 重名怎么办"必须能在一处读完。结构上它是字体集族的**收窄版**：
 *   · **没有 `PUT`**：预设是"当前玻璃快照"的一次性命名，改它 = 删掉重存
 *     （面板上没有"编辑一份预设"的流程，写时复制的覆盖语义因此用不上）；
 *   · **没有 `activate`**：预设**没有活动指针** —— "使用中"对它是个谎（应用之后
 *     用户必然接着拖滑块，那一刻起就不再是"这份预设"了）。应用走客户端：
 *     读回 `values` → 合并进 selection → 走 settings 通道 PUT + 落效。
 *     这样运行中的壁纸**立即**跟随（宿主直接改 config.json 反而要等重载），
 *     而且面板滑块与真源天然一致（同一条 setSetting 路）。
 *   · **有 import/export**（后补，与字体集族**同形**）：导出是
 *     `GET <id>/export`（普通下载链接，宿主带 `Content-Disposition: attachment` 应答），
 *     导入是 `POST import`（正文 = 导出出来的那份 JSON）。两条都**只搬预设正文**，
 *     不引入第二条持久化通道：导入 = 落一份**用户层**新文件（id 顺延、重名自动让位），
 *     导出 = 由读到的值**重建**（不照抄磁盘字节 ⇒ 读不懂的文件不会被导成"看起来能分享"）。
 *   · **按用户 ID 归属**：每份预设带一个 `ownerId`（DSH 匿名用户 ID，
 *     `$DSH_HOME/.anonymous-user-id`，见 lib/index.js 的 `currentUserId()`）。
 *     存储布局**不分目录**（仍是 `glass-presets/<id>.json` 扁平一层）——归属写在文件里。
 *     没有 `ownerId` 的旧文件与随包预设一律算"无主"，**对本机当前用户照常可见可用**，
 *     因此不需要任何迁移。（**墓碑例外且刻意如此**：删除出厂预设是**机器级**的删除事实，
 *     不是一份预设 —— 见 `tombstonedIds` 的说明。）
 *
 * 契约：`registerGlassPresetsRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西
 * （与 fontsets.js 同名同义）：`disposers` / `base` / `glassPresetsDir()`（用户层，可写）/
 * `glassPresetsBuiltinDir`（随包层，**只读**）/ `atomicWriteFileP` / `ensureDirOnce` /
 * `armBodyIdleTimeout` / `lingerClose` / `log`，外加本族独有的
 * `currentUserId()` → 当前用户的 ownerId（字符串）或 `null`（无主；见 lib/index.js）。
 * 归属只影响**读出来给谁看**与**写下去算谁的**，绝不参与路径构造 ⇒ 它到不了文件系统。
 * 键集与消毒**不在这里**：复用共享内核 `lib/settings-schema.js` 的
 * `GLASS_PRESET_SCHEMA_TAG` / `GLASS_PRESET_KEYS` / `sanitizeGlassPresetValues` /
 * `isGlassPresetId` ⇒ 预设正文与 settings 同一条消毒路径（含"快照盖当前版本号"那条，
 * 见 sanitizeGlassPresetValues —— 不盖它，旧档刻度换算会把已在新刻度上的值整批改写）。
 *
 * ══ 两层存储（与字体集族同一套 D3 写时复制口径）════════════════════════════════
 *   · **随包层** `lib/glass-presets/<id>.json` —— 出厂预设（七套，含「作者自用」），
 *     随包发布、**只读**；
 *   · **用户层** `<pluginDataDir>/glass-presets/<id>.json` —— 用户保存的快照、
 *     以及**墓碑**（出厂预设的删除标记，$schema = GLASS_PRESET_TOMBSTONE_TAG）。
 * 同 id 时用户层胜（读的优先级）；**写只落用户层**；出厂预设**可删** —— 用户口径
 * （上限 8、删出厂腾位；**删除即永久，不可恢复**），但包内文件
 * 永不被写：删出厂 = 用户层落一份**墓碑**永久遮住它，清单不再有"已隐藏"可见形态，
 * 也没有恢复通道（再删一次墓碑不会放行）。随包文件只读还有一层现实：
 * 插件升级会重铺包内目录，真正持久的只有用户层 —— 墓碑正是那个持久的删除事实。
 * 用户层那份读不懂（`broken`）时**照常遮住**随包层并在清单里如实标注 —— 静默回落会让
 * "我的预设不见了"看起来像没事；删掉坏文件是可判定的出路。
 *
 * ══ 重名（本族存在的核心理由）════════════════════════════════════════════════
 * 「预设的名字不能重复」是**宿主侧的硬规则**，不是客户端的礼貌：
 *   · 归一化 = `trim()` 后整串小写 —— 中文名小写是恒等变换，英文大小写变体算同名
 *     （"Dark" 与 "dark" 撞名是用户视角的同一个名字）；
 *   · 对比域 = **全部**预设（随包 + 用户层）的名字。出厂名不进对比域的话，用户存一份
 *     「出厂默认」会得到一份永远排在真出厂旁边、看起来一模一样的影子；
 *   · 撞名 = `409 { error }`，客户端把原因原话显示在保存行下面。
 * id 撞名是另一回事：id 只是文件名，客户端生成的时间戳 id 实际不会撞；真撞了按
 * `freePresetId` 顺延（`-2`、`-3`…），不给用户看技术细节。
 *
 * 不变量（承 fontsets.js，凡重复者不在此复述理由）：
 *   · id 是单段白名单（`isGlassPresetId`）+ 目录包含性第二道网；
 *   · 写只落用户层、必须原子（`atomicWriteFileP`）；
 *   · 正文由消毒产物构造，不照抄未信任输入；
 *   · 读不懂就拒绝并说明（`422` + `reason`），不猜、不静默降级；
 *   · 清单有上限（超出截断），单份正文有字节闸。
 *
 * ══ 归属（ownerId）════════════════════════════════════════════════════════════
 * `ownerId` = DSH 匿名用户 ID（一个 UUID 小写串），由宿主注入（`c.currentUserId()`）。
 *   · **随包预设永远无主**（`ownerId: null`）—— 它们不属于任何用户；
 *   · **用户层写下去的一律盖当前用户**（保存 / 导入都是）；
 *   · **没有 ownerId 的旧文件算无主** ⇒ 对本机当前用户可见可用（零迁移）；
 *   · 无主（`null`）与"我这个用户"在**能力**上是同一档：`owned === true`；
 *     只有"另一个用户的"才是 `owned === false`；
 *   · `owned === false` **仅用于标注**（清单里如实显示是谁的），不隐藏、不降级 ——
 *     同一份 `DSH_HOME` 下换过身份（删掉 `.anonymous-user-id`）的用户不该因此
 *     打不开自己昨天的预设；要清理请用删除。删除也**不按归属设卡**（同一条理由：
 *     标注不是门禁），所以一台上别人的预设可以直接删掉。
 *   · 唯一不按归属走的是**墓碑**（删除出厂预设），见 `tombstonedIds`。
 *
 * ══ import / export（后补，与字体集族同形；差异写在这里）════════════════════════
 *   · `GET <id>/export`：正文由**读到的消毒产物重建**（`JSON.stringify(doc, null, 2)`），
 *     不照抄磁盘字节 —— 读不懂的文件根本走不到这里（404/422），所以导出的东西
 *     天然是"另一台机器导得进去的"；头与字体集族逐字相同（`Cache-Control: no-store` +
 *     `Content-Disposition: attachment`）。出厂预设**也能导出**（客户端不给入口，
 *     但路由不设卡：能读就能导，少一个特例）。
 *   · `POST import`：正文就是导出出来的那份文档，**必须**带 `$schema === GLASS_PRESET_SCHEMA_TAG`
 *     （没有标记 = 不是预设文件，`400` 点明要哪个标记）—— 与字体集族同一条判定。
 *   · **导入一定会成功落地**（除非撞上限）：id 撞了就顺延（`imported`、`imported-2`…），
 *     名字撞了就顺延（`名字 (2)`），并把 `renamed: true` 如实回给客户端。
 *     为什么不像 create 那样 `409`：导入是"我要这份文件"，因为本机已有同名预设就整体
 *     失败，等于把用户挡在他自己的文件外面；而重名是**存储的硬规则**，所以只能改名字，
 *     不能破例。两条都告诉用户，不静默。
 *   · **导入不自动应用**（"导入"不等于"立刻用"，同字体集族）：成功 = 回读清单，
 *     新那一格就是反馈。
 *   · 导入不接受 `body.id` 之外的**任何**路径性输入；`ownerId` 由宿主盖，**不信**文件里那个
 *     （一份来自别人的文件导入后就是**你的**预设）。
 *
 * ══ ID 规则（生成 / 校验 / 保留）════════════════════════════════════════════════
 *   · 形态：`isGlassPresetId` = `[A-Za-z0-9_-]{1,64}` 单段（与字体集 id 同一条，
 *     见 lib/settings-schema.js）—— 不含 `.`、`/`、`\`、绝对路径、盘符、空串；
 *   · 生成（客户端，`src/preset-store.js` 的 `newGlassPresetId`）：
 *     `preset-<Date.now() 的 36 进制>-<4 位随机 36 进制>`，形态必过白名单；
 *   · 保留段：`create` / `import` / `export` **永远不能当 id** —— 它们是同前缀下的
 *     路由段，占了就会让那条路由指向一台文件（`create` 是历史漏洞，本次一并补上）；
 *   · 分配：`freePresetId` 用调用方给的 id，撞了就顺延 `-2`、`-3`…（到上限为止，
 *     给不出就 `409`）；
 *   · 校验点在**写之前**：非法 id 的请求在任何读/写之前就被 `400` 掉 ⇒ 目录内容不变。
 */

import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  GLASS_PRESET_SCHEMA_TAG, GLASS_PRESET_TOMBSTONE_TAG, isGlassPresetId, sanitizeGlassPresetValues,
} from '../settings-schema.js';
import { bodyReader } from '../http-body.js';
// JSON 应答的**唯一实现**（状态码 + 两个头 + end）—— 见 lib/json-response.js。
import { sendJson } from '../json-response.js';

/** 一份预设正文的上限（23 个玻璃键的快照 ⇒ 128 KiB 已极宽松）。 */
const PRESET_MAX_BYTES = 128 * 1024;
/** 显示名长度上限（与设置面板一行宽度相称，与字体集名同一条）。 */
const PRESET_NAME_MAX = 60;
/** 预设数量上限（用户口径：**最多 8 个**）。按**活跃**预设计 ——
 *  随包 + 用户层去重后的清单长度；被删除（墓碑）的出厂预设**不占位**
 *（删除正是用户腾位的手段）。清单扫描沿用同族常数做无界读护栏（另留墓碑余量）。 */
const PRESET_TOTAL_MAX = 8;
/** 单层文件扫描上限（无界读护栏；墓碑也住用户层，给足余量）。 */
const PRESET_SCAN_MAX = 32;
/** 归属长度上限（一个 UUID 是 36 字符；留余量到 64，与 id 同一条宽度纪律）。 */
const PRESET_OWNER_MAX = 64;
/**
 * 保留段：**永远不能当 id** —— 它们是同一前缀下的路由段（`create` / `import` 是
 * `POST` 的落点，`export` 是 `<id>/export` 的第二段）。占了其中任何一个，
 * 那台文件就会变成一条"点不动的预设"：路由先匹配到保留段，文件永远读不到。
 * `create` 是本次补上的历史漏洞（`import` / `export` 是新增段，一开始就在表里）。
 */
const PRESET_RESERVED_IDS = ['create', 'import', 'export'];

/** `glass-presets/<id>.json` —— id 已过白名单，所以这是**单段**文件名。 */
function presetPath(dir, id) { return join(dir, id + '.json'); }

/** 目录包含性（第二道网，第一道是 id 白名单）—— 口径与 fontsets.js 一致。 */
function insideDir(dir, abs) {
  const rel = relative(resolve(dir), resolve(abs));
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

/** 用户层目录（可写）/ 随包层目录（**只读**：任何写路径都不得指向它）。 */
function userDir(c) { return c.glassPresetsDir(); }
function builtinDir(c) { return c.glassPresetsBuiltinDir; }

/** 文件名 → id；不合白名单的（手放进去的怪名字）不进列表、也永不被写。 */
function listPresetIds(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const ids = [];
  for (const e of entries) {
    if (typeof e.isFile !== 'function' || !e.isFile()) continue;
    if (!e.name.endsWith('.json')) continue;
    const id = e.name.slice(0, -'.json'.length);
    if (!isGlassPresetId(id)) continue;
    ids.push(id);
    if (ids.length >= PRESET_SCAN_MAX) break;
  }
  return ids.sort();
}

/**
 * 归属归一：只收**非空短字符串**，其余（缺失 / 数字 / 对象 / 过长）一律 `null`。
 * 与 id 不同，ownerId **不参与路径构造**（它是文件里的一个字段），所以这里不做白名单
 * —— 宽进严出的收益为零，窄进只会让"换了个身份格式"的旧文件整份读不出来。
 */
function readOwnerId(raw) {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, PRESET_OWNER_MAX) : null;
}

/**
 * 一份预设**算不算当前用户的**：无主（`null`）与本人同档 —— 旧文件、随包预设、
 * 以及宿主取不到匿名用户 ID 的机器（`currentUserId()` 给 `null`）都走这一档，
 * 于是"匿名用户 ID 不可用"退化成"全都是我的"，功能照走、不误伤。
 */
function ownerMatches(ownerId, me) {
  return ownerId === null || me === null || ownerId === me;
}

/**
 * 当前用户的 ownerId（宿主注入，见 lib/index.js 的 `currentUserId()`）。
 * **任何异常都退化成 `null`**（= 无主 ⇒ 全都算我的）：归属只影响标注与归属标注，
 * 不该有能力让预设功能不可用。ctx 缺席 `currentUserId`（别的守卫台架）同样走这条。
 */
function currentUserId(c) {
  let id = null;
  try { id = typeof c.currentUserId === 'function' ? c.currentUserId() : null; } catch { id = null; }
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/**
 * 读**某一层**里的预设。返回 `{ ok: true, doc }` 或 `{ ok: false, reason }`，
 * reason ∈ `missing` / `bad-json` / `bad-shape` / `bad-version` / `deleted` / `unsafe-path`。
 * 名字的截断与兜底与 fontsets.js 同形；正文由 `sanitizeGlassPresetValues` 重建
 *（缺键补玻璃键默认值 —— 存盘的每一份都是完整快照，读出来也必须还是）。
 * `ownerId` 随正文一起读出（`null` = 无主），墓碑的 `ownerId` 单独走 `readTombstoneAt`。
 */
function readPresetAt(dir, id) {
  const abs = presetPath(dir, id);
  if (!insideDir(dir, abs)) return { ok: false, reason: 'unsafe-path' };
  let text = '';
  try { text = readFileSync(abs, 'utf8'); } catch { return { ok: false, reason: 'missing' }; }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'bad-json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'bad-shape' };
  if (parsed.$schema === GLASS_PRESET_TOMBSTONE_TAG) return { ok: false, reason: 'deleted' };
  if (parsed.$schema !== GLASS_PRESET_SCHEMA_TAG) return { ok: false, reason: 'bad-version' };
  const name = typeof parsed.name === 'string' && parsed.name.trim()
    ? parsed.name.trim().slice(0, PRESET_NAME_MAX) : id;
  return {
    ok: true,
    doc: {
      $schema: GLASS_PRESET_SCHEMA_TAG, id, name,
      ownerId: readOwnerId(parsed.ownerId),
      values: sanitizeGlassPresetValues(parsed.values),
    },
  };
}

/** 两层优先级解析：用户层胜。用户层读不懂照样遮住随包层（理由见文件头）。 */
function resolvePreset(c, id) {
  const user = readPresetAt(userDir(c), id);
  if (user.ok) return { ok: true, doc: user.doc, origin: 'user' };
  if (user.reason !== 'missing') {
    return {
      ok: false, reason: user.reason, origin: 'user',
      shadowsBuiltin: readPresetAt(builtinDir(c), id).ok,
    };
  }
  const builtin = readPresetAt(builtinDir(c), id);
  if (builtin.ok) return { ok: true, doc: builtin.doc, origin: 'builtin' };
  return { ok: false, reason: 'missing', origin: null };
}

/**
 * 用户层里的墓碑 id 集（= 已被删除的出厂预设 —— 删除即永久，无恢复通道）。
 *
 * ⚠️ 墓碑**刻意不带归属**（与本族其余部分相反）：它是**删除事实**，不是一份预设。
 * 一个 id 只能有一份墓碑文件，按归属分会让"我删的出厂预设"在换过身份后自己回来；
 * 而出厂预设是随包发布物、不属于任何用户（`ownerId: null`），删它本来就是机器级的事实。
 * 所以：**用户预设按 ownerId 标注归属，删除出厂预设仍是全机器生效**。
 */
function tombstonedIds(c) {
  const set = new Set();
  for (const id of listPresetIds(userDir(c))) {
    if (readPresetAt(userDir(c), id).reason === 'deleted') set.add(id);
  }
  return set;
}

/**
 * 清单：随包在前，用户层在后；**被删除的出厂预设不进清单**（墓碑遮蔽即永久 ——
 * 没有"已隐藏"的可见形态，也没有恢复通道）。用户层墓碑本身也不是预设，同样跳过。
 * 用户口径：出厂预设可删、预设总数上限 8，删除的不占位。
 */
function listPresets(c) {
  const tomb = tombstonedIds(c);
  const me = currentUserId(c);
  const builtinIds = listPresetIds(builtinDir(c));
  const userIds = listPresetIds(userDir(c));
  const rows = [];
  // `ownerId` / `owned` 是**标注**，不是门禁：别人的预设照常列出（`owned: false`），
  // 想清理用删除。随包预设永远无主 ⇒ `owned: true`（见文件头「归属」一节）。
  for (const id of builtinIds) {
    if (tomb.has(id)) continue; // 墓碑 = 这套出厂预设已被（永久）删除
    const read = readPresetAt(builtinDir(c), id);
    rows.push(read.ok
      ? { id, name: read.doc.name, origin: 'builtin', ownerId: read.doc.ownerId, owned: true }
      : { id, name: id, origin: 'builtin', ownerId: null, owned: true, broken: read.reason });
  }
  for (const id of userIds) {
    if (tomb.has(id)) continue; // 墓碑不是预设
    const read = readPresetAt(userDir(c), id);
    rows.push(read.ok
      ? { id, name: read.doc.name, origin: 'user', ownerId: read.doc.ownerId, owned: ownerMatches(read.doc.ownerId, me) }
      : { id, name: id, origin: 'user', ownerId: null, owned: true, broken: read.reason });
  }
  return rows.slice(0, PRESET_TOTAL_MAX);
}

/** 归一化名字（重名判定的唯一口径 —— 见文件头"重名"一节）。 */
function normalizeName(name) { return String(name).trim().toLowerCase(); }

/** 全部**活跃**预设的归一化名字集合 —— 新建时的对比域（已删除的出厂名已放开）。 */
function takenNames(c) {
  const taken = new Set();
  for (const row of listPresets(c)) {
    if (!row.broken) taken.add(normalizeName(row.name));
  }
  return taken;
}

/**
 * 落盘（原子，**只落用户层**）：正文永远由消毒产物构造，不照抄未信任输入。
 * `ownerId` **由宿主决定**（当前用户或 `null`），绝不来自请求体 —— 见文件头「归属」。
 */
async function writePreset(c, id, name, values, ownerId) {
  const dir = userDir(c);
  c.ensureDirOnce(dir);
  const doc = {
    $schema: GLASS_PRESET_SCHEMA_TAG,
    id,
    name: String(name).trim().slice(0, PRESET_NAME_MAX),
    ownerId: typeof ownerId === 'string' && ownerId ? ownerId : null,
    values: sanitizeGlassPresetValues(values),
  };
  await c.atomicWriteFileP(presetPath(dir, id), JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

/** 落一份墓碑（原子，**只落用户层**）：出厂预设的"删除"就是这个文件。 */
async function writeTombstone(c, id) {
  const dir = userDir(c);
  c.ensureDirOnce(dir);
  const doc = { $schema: GLASS_PRESET_TOMBSTONE_TAG, id };
  await c.atomicWriteFileP(presetPath(dir, id), JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

/**
 * 取一个未被占用的 id：客户端给的就用它，真撞了顺延 `-2`、`-3` …（不给用户看细节）。
 * 占用域 = **两层全部文件**（含墓碑：墓碑占着那个 id，重用它等于把遮住的出厂预设放回来）
 * ＋**保留段**（`create` / `import` / `export` 是路由段，占了就点不动）。
 */
function freePresetId(c, wanted, fallbackBase) {
  const taken = new Set([
    ...listPresetIds(userDir(c)), ...listPresetIds(builtinDir(c)), ...PRESET_RESERVED_IDS,
  ]);
  if (isGlassPresetId(wanted) && !taken.has(wanted)) return wanted;
  const base = isGlassPresetId(wanted) ? wanted : (fallbackBase || 'preset');
  for (let i = 2; i <= PRESET_TOTAL_MAX * 4; i++) {
    const id = (base + '-' + i).slice(0, 64);
    // 顺延出来的 id 也必须是**非保留段**：`create` 撞名时 `create-2` 合法，但
    // `import` 这类 base 顺延后仍可能落回另一条保留段（同表检查最省心）。
    if (isGlassPresetId(id) && !taken.has(id)) return id;
  }
  return null;
}

/**
 * 导入时的**名字让位**：重名是存储的硬规则（`409` 是 create 的口径），但导入是
 * "我要这份文件"，因为本机已有同名预设就整体失败等于把用户挡在自己的文件外面。
 * 于是这里顺延 `名字 (2)`、`名字 (3)`… 到上限为止，并把结果如实回给客户端。
 * 名字的对比域与 `takenNames` **同一条**（活跃清单、归一化后小写）——
 * 顺延出来的名字也必须过同一条判定，否则只是把 409 推给别人。
 * @returns `{ name, renamed }`；给不出不撞名的名字时 `name` 为 `null`。
 */
function freePresetName(c, wanted, id) {
  const taken = takenNames(c);
  const base = (typeof wanted === 'string' && wanted.trim() ? wanted.trim() : id).slice(0, PRESET_NAME_MAX);
  if (!taken.has(normalizeName(base))) return { name: base, renamed: false };
  // 后缀要截在名字上限**之内**（长名字 + 后缀超上限会被 writePreset 悄悄截掉，
  // 截出来的结果可能又重名 ⇒ 循环里每轮都重新判一次，不假设前缀一定安全）。
  const suffixOf = (i) => ' (' + i + ')';
  for (let i = 2; i <= PRESET_TOTAL_MAX * 4; i++) {
    const suffix = suffixOf(i);
    const candidate = base.slice(0, Math.max(1, PRESET_NAME_MAX - suffix.length)) + suffix;
    if (!taken.has(normalizeName(candidate))) return { name: candidate, renamed: true };
  }
  return { name: null, renamed: true };
}

export function registerGlassPresetsRoutes(webServer, c) {
  const { disposers, base: BASE } = c;

  /** 请求体 → JSON（带上限与 idle 超时；与 fontsets.js 同形，理由不复述）。 */
  function withJsonBody(req, res, onBody) {
    let settled = false;
    const fail = (code, payload) => {
      if (settled) return;
      settled = true;
      sendJson(res, code, payload);
      c.lingerClose(req, res);
    };
    c.armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
    const reader = bodyReader(req, {
      maxBytes: PRESET_MAX_BYTES,
      shouldStop: () => settled,
      onOverflow: () => fail(413, { error: 'preset payload too large' }),
    });
    req.on('data', reader.onData);
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = reader.text();
      let parsed = null;
      try { parsed = JSON.parse(body || '{}'); } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      onBody(parsed);
    });
    req.on('error', () => fail(400, { error: 'request error' }));
  }

  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/glass-presets`,
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const json = (code, payload) => sendJson(res, code, payload);
      let url = null;
      try { url = new URL(req.url || '/', 'http://x'); } catch { json(400, { error: 'invalid url' }); return; }
      const rest = url.pathname.slice(`${BASE}/glass-presets`.length);
      if (rest.includes('//')) { json(400, { error: 'invalid path' }); return; }
      let segments = [];
      try {
        segments = rest.split('/').filter((s) => s !== '').map((s) => decodeURIComponent(s));
      } catch { json(400, { error: 'invalid percent-encoding in path' }); return; }
      const [first, second] = segments;

      // 根：GET 清单（随包在前、用户在后；`broken` 如实标注；已删除的出厂不出现）。
      // `ownerId` 是**当前用户**的 ID（`null` = 取不到匿名身份 ⇒ 全都算无主），
      // 客户端拿它显示"谁存的"并决定是否提示"这份是别人的"。
      if (segments.length === 0) {
        if (method !== 'GET') { json(405, { error: 'method not allowed' }); return; }
        json(200, { presets: listPresets(c), ownerId: currentUserId(c) });
        return;
      }

      // 新建：POST { name, values, id? }。重名是 409 —— 这是本族的核心规则，
      // 归一化口径与对比域见文件头；错误原因客户端原话显示（i18n 词表备好英文）。
      if (segments.length === 1 && first === 'create') {
        if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }
        withJsonBody(req, res, (body) => {
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            json(400, { error: 'body 必须是 { name, values }' });
            return;
          }
          const name = typeof body.name === 'string' ? body.name.trim().slice(0, PRESET_NAME_MAX) : '';
          if (!name) { json(400, { error: '预设名字不能为空' }); return; }
          if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
            json(400, { error: '预设正文缺失（values 必须是玻璃键快照对象）' });
            return;
          }
          if (listPresets(c).length >= PRESET_TOTAL_MAX) {
            json(409, { error: '预设数量已达上限（最多 8 个 —— 删除不需要的预设腾位）' });
            return;
          }
          if (takenNames(c).has(normalizeName(name))) {
            json(409, { error: '已存在同名的预设（换个名字再存）' });
            return;
          }
          const id = freePresetId(c, typeof body.id === 'string' ? body.id : '');
          if (!id) { json(409, { error: '预设数量已达上限' }); return; }
          writePreset(c, id, name, body.values, currentUserId(c)).then(
            (doc) => json(200, {
              ok: true, id: doc.id, name: doc.name, ownerId: doc.ownerId, values: doc.values,
            }),
            (err) => json(500, { error: String(err && err.message ? err.message : err) }),
          );
        });
        return;
      }

      // 导入：保留段（与 create 同一条：段名先匹配，不是 id）。正文 = 导出出来的那份文档。
      // 与 create 的三点差异（理由见文件头）：
      //   ① `$schema` 必须命中当前标记（没有标记 = 不是预设文件，点明要哪个标记）；
      //   ② 不因重名 409 —— 名字**让位顺延**（`名字 (2)`）并把 `renamed: true` 如实回给客户端；
      //   ③ id 的兜底 base 是 `imported`（不是 `preset`），免得一堆导入全叫 preset-2、preset-3。
      if (segments.length === 1 && first === 'import') {
        if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }
        withJsonBody(req, res, (body) => {
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            json(400, { error: '预设文件必须是一个 JSON 对象' });
            return;
          }
          if (body.$schema !== GLASS_PRESET_SCHEMA_TAG) {
            json(400, {
              error: '无法读取的预设版本（需要 ' + GLASS_PRESET_SCHEMA_TAG
                + ' 标记 —— 只有从「导出」拿到的文件才有）',
            });
            return;
          }
          if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
            json(400, { error: '预设正文缺失（values 必须是玻璃键快照对象）' });
            return;
          }
          if (listPresets(c).length >= PRESET_TOTAL_MAX) {
            json(409, { error: '预设数量已达上限（最多 8 个 —— 删除不需要的预设腾位）' });
            return;
          }
          const id = freePresetId(c, typeof body.id === 'string' ? body.id : '', 'imported');
          if (!id) { json(409, { error: '预设数量已达上限' }); return; }
          const named = freePresetName(c, body.name, id);
          if (!named.name) { json(409, { error: '预设数量已达上限' }); return; }
          writePreset(c, id, named.name, body.values, currentUserId(c)).then(
            // `renamed` 让客户端能说清"导入成了另一个名字"（静默改名最恼人）；
            // `ownerId` 回显的是**宿主盖上的**归属（不是文件里那个 —— 导入后就是你的）。
            (doc) => json(200, {
              ok: true, id: doc.id, name: doc.name, ownerId: doc.ownerId,
              renamed: named.renamed, values: doc.values,
            }),
            (err) => json(500, { error: String(err && err.message ? err.message : err) }),
          );
        });
        return;
      }

      if (segments.length === 1) {
        if (!isGlassPresetId(first)) { json(400, { error: 'invalid preset id' }); return; }
        if (method === 'GET') {
          const read = resolvePreset(c, first);
          if (read.ok) {
            json(200, {
              ok: true, origin: read.origin, ...read.doc,
              owned: ownerMatches(read.doc.ownerId, currentUserId(c)),
            });
            return;
          }
          if (read.reason === 'missing') { json(404, { error: 'unknown preset' }); return; }
          c.log.warn('glass-presets: 读不懂的预设文件（' + read.reason + '）：' + first);
          json(422, {
            error: 'preset file is unreadable', reason: read.reason,
            origin: read.origin, shadowsBuiltin: Boolean(read.shadowsBuiltin),
          });
          return;
        }
        // 删除的两分语义（用户口径：出厂预设可删、总数上限 8、**删了即永久**）：
        //   ① 用户层是一份**真预设** ⇒ 删文件（应用过的那份早已融进当前设置，删文件不动它们）；
        //   ② 用户层是一份**墓碑** ⇒ 这套出厂预设已被删除 —— **不可恢复**，再删一次
        //      也不放行；
        //   ③ 只有随包层 ⇒ 写**墓碑**（删除事实落用户层，永久遮蔽）—— 包内文件永不被写。
        //   预设没有"活动指针"，这些动作都不影响当前外观。
        if (method === 'DELETE') {
          const userAbs = presetPath(userDir(c), first);
          const userRead = readPresetAt(userDir(c), first);
          if (userRead.reason === 'deleted') {
            json(404, { error: 'unknown preset' });
            return;
          }
          if (userRead.ok) {
            try { unlinkSync(userAbs); } catch {
              json(500, { error: '删除失败（文件被占用或权限不足）' });
              return;
            }
            json(200, { ok: true, removed: first, origin: 'user' });
            return;
          }
          if (readPresetAt(builtinDir(c), first).ok) {
            writeTombstone(c, first).then(
              () => json(200, { ok: true, removed: first, origin: 'builtin' }),
              (err) => json(500, { error: String(err && err.message ? err.message : err) }),
            );
            return;
          }
          json(404, { error: 'unknown preset' });
          return;
        }
        json(405, { error: 'method not allowed' });
        return;
      }

      // 导出：`<id>/export`。正文由读到的值**重建**，不照抄磁盘上的字节 —— 未知版本的
      // 文件根本走不到这里（上面 404/422 拦掉），因此导出的东西天然是"另一台机器导得进去的"。
      // 头三条与字体集族**逐字相同**（客户端的导出是普通 `<a download>` 链接，靠这里的
      // `Content-Disposition` 落成附件 ⇒ 不引入 blob、也不自己造保存通道）。
      // 出厂预设也放行：路由不设卡（能读就能导，少一个特例）；客户端不给入口而已。
      if (segments.length === 2 && second === 'export') {
        if (method !== 'GET') { json(405, { error: 'method not allowed' }); return; }
        if (!isGlassPresetId(first)) { json(400, { error: 'invalid preset id' }); return; }
        const read = resolvePreset(c, first);
        if (!read.ok) {
          if (read.reason === 'missing') { json(404, { error: 'unknown preset' }); return; }
          c.log.warn('glass-presets: 读不懂的预设文件（' + read.reason + '）：' + first);
          json(422, { error: 'preset file is unreadable', reason: read.reason, origin: read.origin });
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Disposition', 'attachment; filename="' + first + '.json"');
        res.end(JSON.stringify(read.doc, null, 2) + '\n');
        return;
      }

      json(404, { error: 'not found' });
    },
  }));
}
