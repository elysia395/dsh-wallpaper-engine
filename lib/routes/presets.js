/**
 * routes/presets.js — **整机配置快照族**路由：`<BASE>/glass-presets` 一个前缀下的
 * 七个端点 —— list / get / create / delete / install-assets / export / import。
 *
 * 为什么独立成文件：与字体集族（`lib/routes/fontsets.js`）同一条理由 —— 预设是
 * **磁盘上的一份份文件**（`glass-presets/<id>.json`），"id 从哪来、谁能写那个目录、
 * 重名怎么办"必须能在一处读完。结构上它是字体集族的**收窄版**：
 *   · **没有 `PUT`**：预设是"当前整机快照"的一次性命名，改它 = 删掉重存
 *     （面板上没有"编辑一份预设"的流程，写时复制的覆盖语义因此用不上）；
 *   · **没有 `activate`**：预设**没有活动指针** —— "使用中"对它是个谎（应用之后
 *     用户必然接着拖滑块，那一刻起就不再是"这份预设"了）。应用走客户端：
 *     读回 `values` → 合并进 selection → 走 settings 通道 PUT + 落效。
 *     这样运行中的壁纸**立即**跟随（宿主直接改 config.json 反而要等重载），
 *     而且面板滑块与真源天然一致（同一条 setSetting 路）。
 *
 * ══ ADR-0011：预设从「玻璃子集」升为「整机配置快照」══════════════════════════
 * 正文分四段（键集见 `lib/settings-schema.js`，本文件不持有任何键表）：
 *   · **settings 段**（`PROFILE_PRESET_KEYS`）—— 全部观感与行为键，**总是携带**；
 *   · **字体 / 吉祥物 / 头像**三个**资产段**（`PRESET_ASSET_KEYS`）—— **按需**携带，
 *     由用户在保存 / 导出时勾选。
 * ⚠️ 两段的"缺席"语义相反，**别写反**（D4 最容易理解错的那条）：
 *   · settings 段是**完整快照** —— 缺键补默认值；
 *   · 资产段是**四态**（2026-10-12 补齐第三、四态，见 D4）：① **键不出现** = "我不管"、保持接收方现值不动；② **`null`** = **显式声明无**、那一族回内置默认；③ **字符串** = **指向出厂自带形态**（只有 `mascot` 有这一态，值域 = `ROPE_FORM_VALUES`，2026-10-13 起 10 只）；④ **对象** = 携带。
 *     ⇒ `install-assets` 对①**什么都不做**、`applied` 里也不要出现它；对②删本机文件 + 置空键（回内置默认）；
 *       对③删本机文件 + 回 `{ form }`（"指向内置的那只"就落成客户端把 `ropeForm` 钉成它）；
 *       「段在、但里面没有字节」同样不落（落个空文件名等于把接收方现值清空）。
 *
 * ══ 为什么 import / export 现在有（**推翻本文件头旧决策**）════════════════════
 * 旧版这里写着：「没有 import/export：第一版不背分享链路；导出/导入若要做，应当连着
 * "分享到市场"一起设计」。ADR-0011 D7 **推翻它的前置** —— 用户明确要"方便用户之间
 * 流转"，本地文件流转先行，市场那条链路仍待设计（那条关切本身仍然成立，只是不再
 * 禁止本地导入导出）。旧注释留着会让后来者以为这条路被禁着，故同批更正。
 * 形态**照抄字体集族**（`fontsets.js` 的 `<id>/export` / `import` 段）：走**普通链接**
 * + `Content-Disposition: attachment`，不引入 blob / `showSaveFilePicker`。
 *
 * ══ base64 只在宿主侧进出（D5 / D7）══════════════════════════════════════════
 * 客户端**既不编码也不解码图片**：保存时它只给 `embed` 名单（宿主据此从本机数据目录
 * 内嵌字节），应用时它只调 `install-assets` 拿文件名与显示盒。⇒ 浏览器不处理大
 * payload，也不存在第二条落盘通道 —— 落盘复用 `lib/routes/mascot.js` /
 * `lib/routes/avatar.js` 的同一套语义（原子写 + 换图清同族旧文件 + 形状校验）。
 * ⇒ `GET /<id>` 的 `assets` **只回元数据**（不回 `data`），否则一次清单后的正文读取
 * 就会把响应体撑到几 MB。
 *
 * 契约：`registerGlassPresetsRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西
 * （与 fontsets.js 同名同义）：`disposers` / `base` / `glassPresetsDir()`（用户层，可写）/
 * `glassPresetsBuiltinDir`（随包层，**只读**）/ `atomicWriteFileP` / `ensureDirOnce` /
 * `armBodyIdleTimeout` / `lingerClose` / `log`，以及资产段读写要用的那几个服务层入口：
 * `readSettings()` / `readFontSetId()` / `fontSetsDir()` / `mascotDir()` / `mascotPath()` /
 * `avatarDir()` / `avatarPath()` / `AVATAR_SIDES`。
 * 键集与消毒**不在这里**：复用共享内核 `lib/settings-schema.js` 的
 * `PROFILE_PRESET_SCHEMA_TAG` / `sanitizePresetValues` / `sanitizePresetAssets` /
 * `isGlassPresetId` ⇒ 预设正文与 settings 同一条消毒路径（含"快照盖当前版本号"那条，
 * 见 sanitizePresetValues —— 不盖它，旧档刻度换算会把已在新刻度上的值整批改写）。
 *
 * ══ 两层存储（与字体集族同一套 D3 写时复制口径）════════════════════════════════
 *   · **随包层** `lib/glass-presets/<id>.json` —— 出厂预设（七套，含「黑客绿(Fish)」），
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
 * ══ 旧版本一律作废（D6）═══════════════════════════════════════════════════════
 * schema tag 升版后旧 tag 的预设文件**一律读不出**，reason 记为 `version-obsolete`
 * （点明是**版本作废**而不是笼统"读不出来" —— 用户看到的是"该重存"，不是"预设没了"）。
 * **不写迁移、不写读容忍**：旧预设只含玻璃子集，按新语义解释会得到"一半是预设、
 * 一半是当前值"的混合体，那正是用户要消灭的「不像预设」。
 * ⚠️ 墓碑标记（`GLASS_PRESET_TOMBSTONE_TAG`）的值**永不许改**，且必须在 tag 校验
 * **之前**先判：它记的是"这套出厂被删了"，与正文版本无关 —— 改了它（或让它落到
 * 版本作废那条分支）会让用户删过的出厂预设复活。
 *
 * ══ 重名（本族存在的核心理由）════════════════════════════════════════════════
 * 「预设清单里不出现无法区分的同名项」是**宿主侧的硬规则**，不是客户端的礼貌。
 * 两条入口按**各自的可行动性**选了不同策略（冻结口径，二者不矛盾）：
 *   · 归一化 = `trim()` 后整串小写 —— 中文名小写是恒等变换，英文大小写变体算同名
 *     （"Dark" 与 "dark" 撞名是用户视角的同一个名字）；
 *   · 对比域 = **全部**预设（随包 + 用户层）的名字。出厂名不进对比域的话，用户存一份
 *     「出厂默认」会得到一份永远排在真出厂旁边、看起来一模一样的影子；
 *   · **create 撞名 = `409 { error }`** —— 保存对话框里用户能直接改名字，报错即时可行动；
 *     客户端把原因原话显示在保存行下面。
 *   · **import 撞名 = 自动顺延**（`暗夜釉色` → `暗夜釉色 (2)`，见 `uniqueImportName`）——
 *     面板没有重命名功能，导入者拿到 409 就是"拿到手却改不了"；顺延让两份都进清单、
 *     名字可区分。两条策略满足的是同一条判据："清单里不出现无法区分的同名项"。
 * id 撞名是另一回事：id 只是文件名，客户端生成的时间戳 id 实际不会撞；真撞了按
 * `freePresetId` 顺延（`-2`、`-3`…），不给用户看技术细节。
 *
 * 不变量（承 fontsets.js，凡重复者不在此复述理由）：
 *   · id 是单段白名单（`isGlassPresetId`）+ 目录包含性第二道网；
 *   · 写只落用户层、必须原子（`atomicWriteFileP`）；
 *   · 正文由消毒产物构造，不照抄未信任输入；
 *   · 读不懂就拒绝并说明（`422` + `reason`），不猜、不静默降级；
 *   · 清单有上限（超出截断），单份正文有字节闸，**单份资产另有独立字节闸**，
 *     超限拒绝时**点名是哪一项**（不静默截断、不笼统报错）。
 */

import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  PROFILE_PRESET_SCHEMA_TAG, GLASS_PRESET_TOMBSTONE_TAG, isGlassPresetId,
  sanitizePresetValues, sanitizePresetAssets, sanitizeFontset, ROPE_FORM_VALUES,
} from '../settings-schema.js';
import { bodyReader } from '../http-body.js';
// JSON 应答的**唯一实现**（状态码 + 两个头 + end）—— 见 lib/json-response.js。
import { sendJson } from '../json-response.js';

/**
 * 一份**无资产**预设正文的上限（settings 段 100 键 ⇒ 128 KiB 已极宽松）。
 * 用于 `create` —— 那条路只收 settings 段与 `embed` **名单**（不收字节，见文件头）。
 */
const PRESET_MAX_BYTES = 128 * 1024;
/**
 * **单份资产**的独立字节闸（**解码后**的原始字节数）。
 * 与头像 / 立绘那两族的上限同一条口径（8 MB —— 客户端导入前已按 512px 压过一轮）。
 * 为什么单独一道闸：三份资产各自 8 MB 并不意味着"合起来随便多大"也合理 —— 总量仍由
 * `PRESET_IMPORT_MAX_BYTES` 收口，而**单份**这道闸保证"某一项特别大"能被**点名**拒绝
 * （D5：不做静默截断、不笼统报错）。
 */
const PRESET_ASSET_MAX_BYTES = 8 * 1024 * 1024;
/**
 * `import` 的收体上限：**按"最多携带三项资产"重算**，不沿用旧的 128 KiB（承 Context 第 8 条）。
 * 由「三项 × base64(单份上限)」**推出来**而不是写死一个数字 —— 单份闸一改，这里自动跟上：
 * base64 把 3 字节编成 4 字符 ⇒ 一项 8 MB 的图落进 JSON 约 10.7 MB，三项约 32 MB，
 * 再加上正文本身的余量。
 */
const PRESET_IMPORT_MAX_BYTES = PRESET_MAX_BYTES + 3 * (Math.ceil(PRESET_ASSET_MAX_BYTES / 3) * 4);
/** 显示名长度上限（与设置面板一行宽度相称，与字体集名同一条）。 */
const PRESET_NAME_MAX = 60;
/** 预设数量上限（用户口径：**最多 8 个**）。按**活跃**预设计 ——
 *  随包 + 用户层去重后的清单长度；被删除（墓碑）的出厂预设**不占位**
 *（删除正是用户腾位的手段）。清单扫描沿用同族常数做无界读护栏（另留墓碑余量）。 */
const PRESET_TOTAL_MAX = 8;
/** 单层文件扫描上限（无界读护栏；墓碑也住用户层，给足余量）。 */
const PRESET_SCAN_MAX = 32;
/** 三个资产段的段名（白名单：`embed` 名单与 `assets=` 查询参数都只认这三个）。 */
const ASSET_SEGMENTS = ['font', 'mascot', 'avatar'];
/** 落盘的图只认这三种扩展名（与 `AVATAR_EXT` / `MASCOT_EXT` 的值域同源）。 */
const ASSET_IMAGE_EXT = ['png', 'jpg', 'webp'];

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
  let entries;
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
 * 读**某一层**里的预设。返回 `{ ok: true, doc }` 或 `{ ok: false, reason }`，
 * reason ∈ `missing` / `bad-json` / `bad-shape` / `version-obsolete` / `unsafe-path`。
 * 名字的截断与兜底与 fontsets.js 同形；正文由 `sanitizePresetValues` 重建
 *（缺键补默认值 —— 存盘的每一份都是完整快照，读出来也必须还是），资产段由
 * `sanitizePresetAssets` 重建（**缺席的段不写键**，绝不用空对象占位）。
 */
function readPresetAt(dir, id) {
  const abs = presetPath(dir, id);
  if (!insideDir(dir, abs)) return { ok: false, reason: 'unsafe-path' };
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch { return { ok: false, reason: 'missing' }; }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'bad-json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'bad-shape' };
  // ⚠️ 墓碑**先判**：它的 tag 是墓碑自己的（与正文版本无关），必须在下面那条
  //    "tag 不是当前版本 ⇒ 版本作废"之前认出来，否则会让删过的出厂预设复活（D6）。
  if (parsed.$schema === GLASS_PRESET_TOMBSTONE_TAG) return { ok: false, reason: 'deleted' };
  // 旧 tag 一律作废：reason 点明是**版本**问题 —— 面板按它给"重新保存一份"的出路。
  if (parsed.$schema !== PROFILE_PRESET_SCHEMA_TAG) return { ok: false, reason: 'version-obsolete' };
  const name = typeof parsed.name === 'string' && parsed.name.trim()
    ? parsed.name.trim().slice(0, PRESET_NAME_MAX) : id;
  const assets = sanitizePresetAssets(parsed.assets);
  return {
    ok: true,
    doc: {
      $schema: PROFILE_PRESET_SCHEMA_TAG,
      id,
      name,
      values: sanitizePresetValues(parsed.values),
      ...(Object.keys(assets).length ? { assets } : {}),
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
  // ⚠️ 随包层的失败原因**原样保留**，不塌缩成 missing（#188）：升级窗口期里磁盘上的
  //    随包文件已是新版 tag（`version-obsolete`），而宿主内存里还是旧路由代码 ——
  //    塌缩会让路由回 404 "unknown preset"，绕过同一条 GET 上**已经本地化**的 422
  //    "版本作废" 文案（那段在随包层曾是死代码）。真·不存在（文件读不到）仍是
  //    `missing` ⇒ 404 语义不变；只有"文件在、读不懂"才落到 422。
  return {
    ok: false, reason: builtin.reason,
    origin: builtin.reason === 'missing' ? null : 'builtin',
  };
}

/** 用户层里的墓碑 id 集（= 已被删除的出厂预设 —— 删除即永久，无恢复通道）。 */
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
  const builtinIds = listPresetIds(builtinDir(c));
  const userIds = listPresetIds(userDir(c));
  const rows = [];
  for (const id of builtinIds) {
    if (tomb.has(id)) continue; // 墓碑 = 这套出厂预设已被（永久）删除
    const read = readPresetAt(builtinDir(c), id);
    rows.push(read.ok
      ? { id, name: read.doc.name, origin: 'builtin' }
      : { id, name: id, origin: 'builtin', broken: read.reason });
  }
  for (const id of userIds) {
    if (tomb.has(id)) continue; // 墓碑不是预设
    const read = readPresetAt(userDir(c), id);
    rows.push(read.ok
      ? { id, name: read.doc.name, origin: 'user' }
      : { id, name: id, origin: 'user', broken: read.reason });
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
 * 给**导入**的预设起一个不撞名的名字（**自动顺延**，`暗夜釉色` → `暗夜釉色 (2)`）。
 *
 * 为什么 import 不像 create 那样 409（captain 冻结的口径，两种策略并存不矛盾）：
 *   · **import 走自动顺延** —— 面板没有重命名功能，导入者拿到 409 就是"拿到手却改不了"
 *     （只能删掉已有那份或去手改 JSON，在应用内无法解决）；顺延让清单里两份都进、
 *     名字可区分（判据：清单不出现无法区分的同名项 —— 两种策略满足的是同一条判据）。
 *   · **create 仍 409** —— 保存对话框里用户能直接改名字，报错即时可行动。
 * 顺延规则：原样名可用就原样用；否则追加 ` (2)`、`(3)`…（显示名截断在 `PRESET_NAME_MAX`，
 * 追加后超长会先截断再查 —— 所以循环里每次都重新走 `normalizeName` 对比）。
 * @returns 不撞名的显示名（一定非空 —— `fallback` 空时由调用方先拒）
 */
function uniqueImportName(c, wanted) {
  const taken = takenNames(c);
  const base = String(wanted || '').trim().slice(0, PRESET_NAME_MAX) || '导入的预设';
  if (!taken.has(normalizeName(base))) return base;
  for (let i = 2; i <= PRESET_TOTAL_MAX * 4; i++) {
    const suffix = ' (' + i + ')';
    const candidate = base.slice(0, PRESET_NAME_MAX - suffix.length) + suffix;
    if (!taken.has(normalizeName(candidate))) return candidate;
  }
  return base.slice(0, PRESET_NAME_MAX - 7) + ' ' + Date.now().toString(36);
}

// ── 资产段：本机 ⇄ 预设正文 ────────────────────────────────────────────────────
// 这一节是"base64 只在宿主侧进出"的全部实现：读本机（内嵌 / 导出补段）与落本机
//（install-assets）都在这里，落盘复用 mascot.js / avatar.js 的同一套语义。

/** 文件名 → 扩展名（小写）；不认的形状给空串。 */
function extOfFile(name) {
  const s = typeof name === 'string' ? name : '';
  const dot = s.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = s.slice(dot + 1).toLowerCase();
  return ASSET_IMAGE_EXT.includes(ext) ? ext : '';
}

/** 与 mascot.js / avatar.js 同形的落盘时间戳（换图即换名 ⇒ `<img>` 不吃旧缓存）。 */
function assetStamp() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 一个绝对路径 → base64（读不到给空串 —— 缺席即不携带，不是空段）。 */
function encodeFile(abs) {
  if (!abs) return '';
  try { return readFileSync(abs).toString('base64'); } catch { return ''; }
}

/** base64 → 字节（不合法 / 空 ⇒ null）。 */
function decodeBase64(data) {
  if (typeof data !== 'string' || !data) return null;
  try {
    const buf = Buffer.from(data, 'base64');
    return buf.length ? buf : null;
  } catch { return null; }
}

/** 当前**活动字体集**的正文（字体段的载体）。迁移前（`fontSetId` 为空）退回 settings。 */
function currentFontSegment(c) {
  const id = typeof c.readFontSetId === 'function' ? c.readFontSetId() : '';
  if (id && typeof c.fontSetsDir === 'function') {
    try {
      const parsed = JSON.parse(readFileSync(join(c.fontSetsDir(), id + '.json'), 'utf8'));
      return { name: typeof parsed.name === 'string' ? parsed.name.slice(0, 64) : id, values: sanitizeFontset(parsed.values) };
    } catch { /* 活动集读不出 ⇒ 退回 settings 那份（可能已是迁移前的形状） */ }
  }
  const settings = typeof c.readSettings === 'function' ? c.readSettings() : null;
  return { name: id || '', values: sanitizeFontset(settings) };
}

/** 当前本机的吉祥物段（立绘本体 + 文件名 + 显示盒）；没有图 ⇒ null（= 不携带）。 */
function currentMascotSegment(c) {
  const settings = (typeof c.readSettings === 'function' ? c.readSettings() : null) || {};
  const abs = typeof c.mascotPath === 'function' ? c.mascotPath() : null;
  if (!abs) return null;
  const file = basename(abs);
  if (!extOfFile(file)) return null;
  const data = encodeFile(abs);
  if (!data) return null;
  return { file, box: typeof settings.mascotImageBox === 'string' ? settings.mascotImageBox : '', data };
}

/** 当前本机的头像段（哪一方有图就带哪一方）；两边都没有 ⇒ null（= 不携带）。 */
function currentAvatarSegment(c) {
  const sides = Array.isArray(c.AVATAR_SIDES) ? c.AVATAR_SIDES : ['user', 'ai'];
  const out = {};
  for (const side of sides) {
    if (side !== 'user' && side !== 'ai') continue;
    const abs = typeof c.avatarPath === 'function' ? c.avatarPath(side) : null;
    if (!abs) continue;
    const file = basename(abs);
    if (!extOfFile(file)) continue;
    const data = encodeFile(abs);
    if (!data) continue;
    out[side] = { file, data };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * `point` = 调用方对某一族资产的**指向声明**（ADR-0011 D4 第四态，2026-10-12 用户口径）：
 * `{ mascot: 'whale' }` ⇒ 落盘的 `assets.mascot` 是**字符串**（零字节，指向出厂自带的那一只），
 * 与内嵌对象 / `null`（声明无）并列成第三态。
 * 只有 `mascot` 有这个值域（内置形态只有吉祥物有）；段名与形态值**逐个逐字认**，
 * 认不清的**整条丢掉** —— 与 `sanitizePresetAssets` 的"认不清整段丢"同一口径：猜错等于
 * 悄悄给人换一只吉祥物，比"什么都不做"糟得多（丢 = 该段回到"缺席 = 不动"）。
 * @returns `{}`（没有可认的声明）或 `{ mascot: <形态 id> }`（值域 = `ROPE_FORM_VALUES`，
 *   2026-10-13 起 10 只：`whale` / `phoebe` + 八只「模型娘」）
 */
function sanitizePresetPoint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  if (typeof raw.mascot === 'string' && ROPE_FORM_VALUES.includes(raw.mascot)) out.mascot = raw.mascot;
  return out;
}

/** 按段名从**当前本机**取一段（内嵌 / 导出补段共用）。 */
function currentSegment(c, seg) {
  if (seg === 'font') return currentFontSegment(c);
  if (seg === 'mascot') return currentMascotSegment(c);
  if (seg === 'avatar') return currentAvatarSegment(c);
  return null;
}

/**
 * 清同族旧文件后原子落盘（**与 mascot.js / avatar.js 同一套语义**，不新增第二条通道）：
 *   · 换图即换名 ⇒ 必须先清同族旧文件，否则读取侧（按前缀扫目录取第一个命中）会
 *     "新图导进去了、屏上还是旧图"；陈旧 `.tmp` 一并清。
 *   · 原子（`.tmp` + rename）：半写的图会被当成有效图服务出去。
 *   · **同一张图不重落**（2026-10-12 补）：同族里已有唯一一枚**同扩展名**且**字节全等**的文件，
 *     直接复用它的文件名 —— 不 unlink、不写。两条理由：① 原先每次应用都盖新 stamp，
 *     `mascotImage` / `avatarUserImage` 的值每次都不同 ⇒ 同一份预设应用两次得不到逐字节
 *     相同的状态，任何"往返幂等"断言都钉不住（实测 A→B→A 里"大覆盖"那 12 对只在文件名上有差异）；
 *     ② 少一次无关的删+写，别的读者（浏览器缓存里的旧链接）也不会突然 404。
 *     多个同族同扩展名命中（正常流程下不该出现）⇒ 不认，照旧走"清族 + 重落"。
 * @returns 落盘后的文件名
 */
async function landImage(c, dir, prefix, ext, buf) {
  const dup = sameFamilyFile(dir, prefix, ext);
  if (dup && Buffer.compare(dup.bytes, buf) === 0) return dup.name;
  try {
    for (const name of readdirSync(dir)) {
      if (name.slice(0, prefix.length) !== prefix) continue;
      try { unlinkSync(join(dir, name)); } catch { /* ignore */ }
    }
  } catch { /* 空目录 */ }
  const name = prefix + assetStamp() + '.' + ext;
  await c.atomicWriteFileP(join(dir, name), buf);
  return name;
}

/**
 * `landImage` 的"同一张图"判据：同族里**恰好一枚**该扩展名的文件时返回 `{ name, bytes }`，
 * 否则（零枚 / 多枚 / 读不出）返回 null —— 多枚时不做字节比较，直接让 landImage 清族重落。
 */
function sameFamilyFile(dir, prefix, ext) {
  let hit = null;
  try {
    for (const name of readdirSync(dir)) {
      if (name.slice(0, prefix.length) !== prefix) continue;
      if (name.slice(-(ext.length + 1)) !== '.' + ext) continue;
      if (hit) return null;
      hit = name;
    }
  } catch { return null; }
  if (!hit) return null;
  try { return { name: hit, bytes: readFileSync(join(dir, hit)) }; } catch { return null; }
}

/**
 * 一个资产项的字节闸（**收集态**：返回原因给调用方汇总，不自己抛 —— 见 installAssets
 * 的两阶段预检，多超限项一次性点名）。
 * @param label 资产项名（`'mascot'` / `'avatar.user'` …）
 * @returns 超限时的点名文案；在闸内给 null
 */
function assetOverBudget(label, buf) {
  if (buf && buf.length > PRESET_ASSET_MAX_BYTES) {
    return '资产「' + label + '」超过单份上限（'
      + Math.round(PRESET_ASSET_MAX_BYTES / (1024 * 1024)) + 'MB）—— 取消勾选它，或换一张小一点的图';
  }
  return null;
}

export function registerGlassPresetsRoutes(webServer, c) {
  const { disposers, base: BASE } = c;

  /**
   * 请求体 → JSON（带上限与 idle 超时；与 fontsets.js 同形，理由不复述）。
   * 上限**按端点分档**：`create` 只收 settings 段（`PRESET_MAX_BYTES`），
   * `import` 要收最多三项 base64 资产（`PRESET_IMPORT_MAX_BYTES`）。
   */
  function withJsonBody(req, res, maxBytes, onBody) {
    let settled = false;
    const fail = (code, payload) => {
      if (settled) return;
      settled = true;
      sendJson(res, code, payload);
      c.lingerClose(req, res);
    };
    c.armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
    const reader = bodyReader(req, {
      maxBytes,
      shouldStop: () => settled,
      onOverflow: () => fail(413, { error: 'preset payload too large' }),
    });
    req.on('data', reader.onData);
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = reader.text();
      let parsed;
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
      let url;
      try { url = new URL(req.url || '/', 'http://x'); } catch { json(400, { error: 'invalid url' }); return; }
      const rest = url.pathname.slice(`${BASE}/glass-presets`.length);
      if (rest.includes('//')) { json(400, { error: 'invalid path' }); return; }
      let segments;
      try {
        segments = rest.split('/').filter((s) => s !== '').map((s) => decodeURIComponent(s));
      } catch { json(400, { error: 'invalid percent-encoding in path' }); return; }
      const [first, second] = segments;

      // 根：GET 清单（随包在前、用户在后；`broken` 如实标注；已删除的出厂不出现）。
      if (segments.length === 0) {
        if (method !== 'GET') { json(405, { error: 'method not allowed' }); return; }
        json(200, { presets: listPresets(c) });
        return;
      }

      // ── 导入（保留段，不允许当 id）─────────────────────────────────────────
      // 照抄 fontsets.js 的 `import`：先认 tag → **重名自动顺延** → 判上限 → 分配新 id，
      // **不自动应用**（导入 ≠ 立刻用 —— 想用去清单里点它）。
      if (segments.length === 1 && first === 'import') {
        if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }
        withJsonBody(req, res, PRESET_IMPORT_MAX_BYTES, (body) => {
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            json(400, { error: '预设文件必须是一个 JSON 对象' });
            return;
          }
          // 旧 tag 一律拒（D6：**不写迁移、不写读容忍**）—— 文案点明"要哪个标记"。
          if (body.$schema !== PROFILE_PRESET_SCHEMA_TAG) {
            json(400, {
              error: '无法读取的预设版本（需要 ' + PROFILE_PRESET_SCHEMA_TAG
                + ' 标记 —— 旧版预设已作废，请从「导出」重新拿一份）',
              reason: 'version-obsolete',
            });
            return;
          }
          // 重名**自动顺延**（captain 冻结口径；与 create 的 409 不矛盾 —— 理由见
          // uniqueImportName 的头注释）。校验顺序：判 tag → **处理重名** → 判上限。
          // 名字在导入者手上不可编辑，顺延让两份都进清单且名字可区分。
          const importName = uniqueImportName(c, typeof body.name === 'string' ? body.name : '');
          if (listPresets(c).length >= PRESET_TOTAL_MAX) {
            json(409, { error: '预设数量已达上限（最多 8 个 —— 删除不需要的预设腾位）' });
            return;
          }
          const id = freePresetId(c, typeof body.id === 'string' ? body.id : '');
          if (!id) { json(409, { error: '预设数量已达上限' }); return; }
          writePreset(c, id, importName, body.values, body.assets).then(
            (doc) => json(200, { ok: true, id: doc.id, name: doc.name }),
            (err) => json(500, { error: String(err && err.message ? err.message : err) }),
          );
        });
        return;
      }

      // 新建：POST { name, values, id?, embed? }。重名是 409 —— 这是本族的核心规则，
      // 归一化口径与对比域见文件头；错误原因客户端原话显示（i18n 词表备好英文）。
      if (segments.length === 1 && first === 'create') {
        if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }
        withJsonBody(req, res, PRESET_MAX_BYTES, (body) => {
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            json(400, { error: 'body 必须是 { name, values }' });
            return;
          }
          const name = typeof body.name === 'string' ? body.name.trim().slice(0, PRESET_NAME_MAX) : '';
          if (!name) { json(400, { error: '预设名字不能为空' }); return; }
          if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
            json(400, { error: '预设正文缺失（values 必须是整机配置快照对象）' });
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
          // `embed` = 资产段名数组 ⇒ 宿主据此把**当前本机资产**内嵌进落盘正文
          //（客户端不上传任何图片字节；名单外的段名一律忽略，不是报错）。
          const embed = Array.isArray(body.embed)
            ? [...new Set(body.embed.filter((k) => ASSET_SEGMENTS.includes(k)))] : [];
          // `point` = 指向声明（第四态，2026-10-12）：那几段**不内嵌本机资产**，正文里存指向字符串。
          const point = sanitizePresetPoint(body.point);
          const assets = {};
          for (const seg of embed) {
            const cur = currentSegment(c, seg);
            assets[seg] = cur; // cur === null ⇒ 显式声明无；cur 是字符串 ⇒ 指向内置形态（勾了而本机没有 = 用户的真实声明，D4 第三/四态）
          }
          // 声明**赢过内嵌**（客户端本就把这两条路做成互斥的，这里是宿主侧的兜底顺序）。
          for (const [seg, form] of Object.entries(point)) assets[seg] = form;
          const id = freePresetId(c, typeof body.id === 'string' ? body.id : '');
          if (!id) { json(409, { error: '预设数量已达上限' }); return; }
          writePreset(c, id, name, body.values, assets).then(
            (doc) => json(200, {
              ok: true, id: doc.id, name: doc.name, values: doc.values,
              ...(doc.assets ? { assets: publicAssets(doc.assets) } : {}),
            }),
            (err) => json(500, { error: String(err && err.message ? err.message : err) }),
          );
        });
        return;
      }

      // ── `<id>/install-assets` / `<id>/export` ───────────────────────────────
      if (segments.length === 2) {
        if (!isGlassPresetId(first)) { json(400, { error: 'invalid preset id' }); return; }

        // 把预设已内嵌的资产段**落盘**到 mascot/ 与 avatars/，回 `{ ok, applied }`。
        // ⚠️ 段**不出现** ⇒ 什么都不做、也不出现在 `applied` 里（"缺席 = 保持现值"）；
        //    段是 `null` ⇒ 那一族回内置默认（删本机文件 + 置空键），`applied` 里回 `{ cleared: true }`。
        if (second === 'install-assets') {
          if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }
          const read = resolvePreset(c, first);
          if (!read.ok) {
            json(read.reason === 'missing' ? 404 : 422, {
              error: 'preset file is unreadable', reason: read.reason,
            });
            return;
          }
          installAssets(c, read.doc.assets || {}).then(
            (applied) => json(200, { ok: true, applied }),
            (err) => json(500, { error: String(err && err.message ? err.message : err) }),
          );
          return;
        }

        // 导出：正文由读到的值**重建**（不照抄磁盘字节 —— 未知版本的文件不会被导出成
        // "看起来能分享"的东西）。`assets=` = 勾选名单：预设里已有的用它自己的（**含 `null`
        // 这个"声明无"与"指向内置形态"的字符串**，照抄），预设里没有的从**当前本机资产**现取；
        // 未被请求的段**不出现**。
        if (second === 'export') {
          if (method !== 'GET') { json(405, { error: 'method not allowed' }); return; }
          const read = resolvePreset(c, first);
          if (!read.ok) {
            json(read.reason === 'missing' ? 404 : 422, {
              error: 'preset file is unreadable', reason: read.reason,
            });
            return;
          }
          const wanted = (url.searchParams.get('assets') || '')
            .split(',').map((s) => s.trim()).filter((s) => ASSET_SEGMENTS.includes(s));
          // `point=` = 指向声明（第四态）的查询参数形态：`mascot:whale`，逗号分隔多段。
          // 与 `create` 走**同一个**白名单（`sanitizePresetPoint`）—— 认不清的段名 / 形态一律丢。
          const pointRaw = {};
          for (const item of (url.searchParams.get('point') || '').split(',')) {
            const [seg, form] = item.split(':').map((s) => (s || '').trim());
            if (seg) pointRaw[seg] = form;
          }
          const point = sanitizePresetPoint(pointRaw);
          const embedded = read.doc.assets || {};
          const assets = {};
          // 要重建的段 = `assets=` 名单 ∪ `point=` 声明（指向自己能成段：客户端有指向时
          // 本就不会把 `mascot` 放进 `assets=` —— 只看名单会把这条声明整个漏掉）。
          for (const seg of [...new Set(wanted.concat(Object.keys(point)))]) {
            const own = embedded[seg];
            // "预设里已有" = 这一段存在**且有可落的字节**（字体段不看字节）。
            const usable = seg === 'font'
              ? Boolean(own && own.values)
              : Boolean(own && typeof own === 'object'
                && ((own.data && own.data.length) || (own.user && own.user.data) || (own.ai && own.ai.data)));
            // 预设**自己声明过的**（`null` = 声明无 / 字符串 = 指向内置形态）一律照抄自己的声明 ——
            // 否则导出一份"声明无"的预设会偷走导出者本机的图；而导出一份"指向内置菲比啾比"的
            // 预设若不照抄，就会退化成 `currentSegment`（把"指内置那只"悄悄改成"指我本机这张"）；
            // 只有"段真的没有可用内容"（键不出现 / 空对象）才回落到当前本机现值。
            if (own === null || typeof own === 'string') assets[seg] = own;
            // 预设这一段**真的没内容**（键不出现 / 空对象）⇒ 用调用方的指向声明（第四态）；
            // 没有声明才回落到本机现值 —— 老行为一个字节不变。
            else if (!usable && point[seg]) assets[seg] = point[seg];
            else assets[seg] = usable ? own : currentSegment(c, seg);
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Disposition', 'attachment; filename="' + first + '.json"');
          res.end(JSON.stringify({
            $schema: PROFILE_PRESET_SCHEMA_TAG,
            id: read.doc.id,
            name: read.doc.name,
            values: read.doc.values,
            ...(Object.keys(assets).length ? { assets } : {}),
          }, null, 2) + '\n');
          return;
        }

        json(404, { error: 'not found' });
        return;
      }

      if (segments.length === 1) {
        if (!isGlassPresetId(first)) { json(400, { error: 'invalid preset id' }); return; }
        if (method === 'GET') {
          const read = resolvePreset(c, first);
          if (read.ok) {
            // ⚠️ `assets` 只含**元数据**（字体段数值 + 文件名 / 显示盒），**不带图片
            //    字节** —— 一次清单后的正文读取不该把响应体撑到几 MB（字节只在
            //    export 的正文与 install-assets 的落盘里进出）。
            const assets = read.doc.assets ? publicAssets(read.doc.assets) : null;
            json(200, {
              ok: true, origin: read.origin, id: read.doc.id, name: read.doc.name,
              values: read.doc.values, ...(assets ? { assets } : {}),
            });
            return;
          }
          // 404 带 `reason`/`id`（#188 建议四）：真不存在时让用户/排查方能分辨"清单里
          //    就没有"与"曾删过"（`tombstone`）—— 三处 404 同一句文案不带上下文的话，
          //    只能靠重启宿主盲试。
          if (read.reason === 'missing') {
            json(404, { error: 'unknown preset', reason: 'missing', id: first });
            return;
          }
          c.log.warn('glass-presets: 读不懂的预设文件（' + read.reason + '）：' + first);
          json(422, {
            error: read.reason === 'version-obsolete'
              ? '这份预设的版本已作废（旧格式不再兼容 —— 请重新保存一份）'
              : 'preset file is unreadable',
            reason: read.reason,
            origin: read.origin, shadowsBuiltin: Boolean(read.shadowsBuiltin),
          });
          return;
        }
        // 删除的三分语义（用户口径：出厂预设可删、总数上限 8、**删了即永久**）：
        //   ① 用户层**有这个文件** ⇒ 删文件（应用过的那份早已融进当前设置，删文件不动它们）；
        //   ② 用户层是一份**墓碑** ⇒ 这套出厂预设已被删除 —— **不可恢复**，再删一次
        //      也不放行；
        //   ③ 只有随包层 ⇒ 写**墓碑**（删除事实落用户层，永久遮蔽）—— 包内文件永不被写。
        //   预设没有"活动指针"，这些动作都不影响当前外观。
        //
        // ⚠️ ① 的判据是「用户层**有没有这个文件**」，**不是**「它读不读得懂」：
        //    坏文件（旧 tag 作废 / 坏 JSON / 形状不对）在清单里如实标 `broken`，
        //    却**照样占着活跃上限名额**（7 出厂 + 1 坏行 = 8 已满）⇒ 一旦删不掉，
        //    用户就同时"存不了新预设、也清不掉坏行" —— 死锁。删掉坏文件是**唯一**
        //    出路（本族文件头 broken 行那条口径），所以这里必须放行。
        if (method === 'DELETE') {
          const userAbs = presetPath(userDir(c), first);
          const userRead = readPresetAt(userDir(c), first);
          if (userRead.reason === 'deleted') {
            json(404, { error: 'unknown preset', reason: 'tombstone', id: first });
            return;
          }
          // `missing` = 没有这个文件（走③或404）；`unsafe-path` = 目录包含性没过
          // ⇒ 绝不碰它，直接落回下面的分支。其余（含读不懂的那三种）一律删。
          if (userRead.reason !== 'missing' && userRead.reason !== 'unsafe-path') {
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
          json(404, { error: 'unknown preset', reason: 'missing', id: first });
          return;
        }
        json(405, { error: 'method not allowed' });
        return;
      }

      json(404, { error: 'not found' });
    },
  }));
}

/**
 * 落盘（原子，**只落用户层**）：正文永远由消毒产物构造，不照抄未信任输入。
 * 资产段过 `sanitizePresetAssets` ⇒ 形状与文件名都走与 settings 同一条消毒路径
 * （`MASCOT_FILE_RE` / `MASCOT_BOX_RE` / `AVATAR_FILE_RE`），且**缺席的段不写键**。
 */
async function writePreset(c, id, name, values, assets) {
  const dir = userDir(c);
  c.ensureDirOnce(dir);
  const assetSegs = sanitizePresetAssets(assets);
  const doc = {
    $schema: PROFILE_PRESET_SCHEMA_TAG,
    id,
    name: String(name).trim().slice(0, PRESET_NAME_MAX),
    values: sanitizePresetValues(values),
    ...(Object.keys(assetSegs).length ? { assets: assetSegs } : {}),
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

/** 取一个未被占用的 id：客户端给的就用它，真撞了顺延 `-2`、`-3` …（不给用户看细节）。 */
function freePresetId(c, wanted) {
  const taken = new Set([...listPresetIds(userDir(c)), ...listPresetIds(builtinDir(c))]);
  if (isGlassPresetId(wanted) && !taken.has(wanted)) return wanted;
  const base = isGlassPresetId(wanted) ? wanted : 'preset';
  for (let i = 2; i <= PRESET_TOTAL_MAX * 4; i++) {
    const id = (base + '-' + i).slice(0, 64);
    if (isGlassPresetId(id) && !taken.has(id)) return id;
  }
  return null;
}

/**
 * 资产段的**对外形态**（GET 单份 / create 回包）：元数据 + 字体段数值，**不含图片字节**。
 * 形状与 `sanitizePresetAssets` 一致，只是逐段摘掉 `data`（`font` 段本来就没有字节）。
 * `null`（**显式声明无**，2026-10-12 补）与**字符串**（**指向出厂自带形态**，同日补）都**原样
 * 回显** —— 调用方要能看出"这一族被声明成无"或"被指到内置哪一只"，与"没带这一段"（键根本
 * 不出现）区分开。
 */
function publicAssets(assets) {
  const out = {};
  const f = assets.font;
  if (f === null) out.font = null;
  else if (f && typeof f === 'object') out.font = { name: f.name, values: f.values };
  const m = assets.mascot;
  // 字符串态（指向出厂自带形态）**原样回显** —— 调用方要能看出"这一族被指到内置哪一只"，
  // 而不是把 `'phoebe'` 折成 `null`（那会变成另一件事：声明无、形态交回 settings 段）。
  if (typeof m === 'string') out.mascot = m;
  else if (m === null) out.mascot = null;
  else if (m && typeof m === 'object') out.mascot = { file: m.file, box: m.box };
  const a = assets.avatar;
  if (a === null) out.avatar = null;
  else if (a && typeof a === 'object') {
    const av = {};
    if (a.user && typeof a.user === 'object') av.user = { file: a.user.file };
    if (a.ai && typeof a.ai === 'object') av.ai = { file: a.ai.file };
    if (Object.keys(av).length) out.avatar = av;
  }
  return out;
}

/**
 * 清掉某一族在本机的**全部落地物**（按 `<prefix>` 扫目录 —— 与 mascot.js / avatar.js
 * 落图时"换图即清同族"同一条语义）。**只把键置空是不够的**：读侧（`mascotPath` /
 * `avatarPath`）是**按前缀扫目录取第一个命中**、不看 settings 记的文件名 ⇒ 文件还在，
 * 下一次取段又会把它捞回来（"看着清了、其实没清"）。
 * @returns 删掉的文件数（0 = 本来就没有）
 */
function clearFamily(dir, prefix) {
  let removed = 0;
  try {
    for (const name of readdirSync(dir)) {
      if (name.slice(0, prefix.length) !== prefix) continue;
      try { unlinkSync(join(dir, name)); removed += 1; } catch { /* ignore */ }
    }
  } catch { /* 空目录 / 目录还不存在 */ }
  return removed;
}

/**
 * 把预设内嵌的资产段落盘到本机（**应用半边**）。
 *
 * ⚠️ **缺席的段什么都不做，且不出现在 `applied` 里** —— 那是 D4 的核心语义
 * （"不带它"≠"把它清空"）。段在但没有字节的，同样不落（落空文件名 = 清空现值）。
 * ⚠️ **`null` = 「显式声明无」（2026-10-12 补，D4 的三态）**：那一族**回到内置默认** ——
 * 立绘 / 头像删掉本机文件（`clearFamily`）并回 `{ cleared: true }`（客户端据此把键置空）；
 * 字体没有文件可删，直接回一份**默认值**（客户端照旧经 `landPresetFontSet` 落进预设专用槽）。
 * 没有这一态，一份"范围小"的预设就撤销不了前一份预设装上的资产：实测 7 套出厂预设两两
 * 走 A→B→A，42 个有序对里 30 个不收敛（缺口全在资产族）。
 * ⚠️ **字符串 = 「指向出厂自带形态」（2026-10-12 补，D4 第四态，只有 `mascot` 有）**：值域
 * = `ROPE_FORM_VALUES` 全表（`whale` / `phoebe` + 八只「模型娘」，2026-10-13 起共 10 只
 * —— 同日「小女仆」除名、那只图改由「作者自用」预设携带；= settings 的 `ropeForm`）。落盘动作与"声明无"**同一件**
 * （清本机立绘族），回 `{ form }` —— 客户端拿它写 `ropeForm`，屏幕上是**内置的那只**，
 * 而预设正文里**零字节**（内置图本来就在包里，内嵌一份副本是纯冗余）。
 * ⚠️ **两阶段**（D5 的"整批落位或一个不落"落到实处）：
 *   · **第一阶段（预检）**：对**全部**待落项做形状 + 字节闸检查，**收集所有超限项、
 *     一次性点名**（不是遇到第一个就抛）—— 用户一次就能看到"哪些项要处理"，而不是
 *     修一个、再请求一次、又冒出下一个；任一项超限 ⇒ 在**任何 unlink / write 之前**
 *     抛出。为什么必须先检后落：`landImage` 的第一步就是"清同族旧文件"（把用户原图
 *     就地 unlink）—— 若 mascot 先合法落盘、avatar 再被闸拦下，用户的原立绘已经没了
 *     且无备份（不可恢复丢失）。
 *   · **第二阶段（落盘）**：预检全通过后才逐项 `landImage` / `clearFamily` —— 到这里每一项
 *     都已确认形状合法且在字节闸内，失败只剩磁盘错误这一种（原子写，不会半写）。
 *
 * @returns {Promise<{font?: object, mascot?: object, avatar?: object}>}
 */
async function installAssets(c, assets) {
  const applied = {};
  const font = assets.font;
  if (font === null) {
    // 「声明无」的字体段 = 回落默认字体集：没有文件可删，给默认值让客户端照常落专用槽。
    applied.font = { name: '', values: sanitizeFontset(null) };
  } else if (font && typeof font === 'object' && font.values) {
    applied.font = { name: typeof font.name === 'string' ? font.name : '', values: sanitizeFontset(font.values) };
  }
  // ── 第一阶段：全量预检（形状 + 字节闸），收集所有超限项、一次性点名 ──────────
  //    待落项 = "有字节且扩展名合法"的那些（与第二阶段的判定**同一条表达式**，
  //    否则预检放行了、落盘阶段又跳过，两阶段就名存实亡）。
  const pending = []; // { label, dir, prefix, ext, buf }
  const overs = [];   // 超限项的点名文案（全部收集，一次性报）
  const clearMascot = assets.mascot === null;
  const clearAvatar = assets.avatar === null;
  const m = assets.mascot;
  // ③ 字符串 = 指向出厂自带形态（D4 第四态）：立绘要**像"声明无"那样清掉本机文件**（既然指着
  //    内置那只，本机那张自定义图就不该再被读侧按前缀扫出来），差别只在 `applied` 回 `{ form }`。
  const mascotForm = typeof m === 'string' ? m : '';
  if (!clearMascot && !mascotForm && m && typeof m === 'object') {
    const buf = decodeBase64(m.data);
    const ext = extOfFile(m.file);
    if (buf && ext) {
      const over = assetOverBudget('mascot', buf);
      if (over) overs.push(over);
      else pending.push({ label: 'mascot', dir: c.mascotDir(), prefix: 'mascot-', ext, buf });
    }
  }
  const a = assets.avatar;
  if (!clearAvatar && a && typeof a === 'object') {
    for (const side of ['user', 'ai']) {
      const one = a[side];
      if (!one || typeof one !== 'object') continue;
      const buf = decodeBase64(one.data);
      const ext = extOfFile(one.file);
      if (!buf || !ext) continue;
      const over = assetOverBudget('avatar.' + side, buf);
      if (over) overs.push(over);
      else pending.push({ label: 'avatar.' + side, dir: c.avatarDir(), prefix: side + '-', ext, buf });
    }
  }
  if (overs.length) {
    // 在任何 unlink / write 之前抛 —— landImage 的"清同族"与声明无的 clearFamily 都不会被半批触发。
    throw new Error(overs.join('；'));
  }
  // ── 第二阶段：落盘 / 清空（到这里每一项都已过预检；失败只剩磁盘错误，原子写不半写）──
  if (clearMascot || mascotForm) {
    clearFamily(c.mascotDir(), 'mascot-');
    applied.mascot = mascotForm ? { form: mascotForm } : { cleared: true };
  }
  if (clearAvatar) {
    for (const side of ['user', 'ai']) clearFamily(c.avatarDir(), side + '-');
    applied.avatar = { cleared: true };
  }
  const av = {};
  for (const item of pending) {
    const file = await landImage(c, item.dir, item.prefix, item.ext, item.buf);
    if (item.label === 'mascot') {
      applied.mascot = { file, box: typeof m.box === 'string' ? m.box : '' };
    } else {
      av[item.prefix.slice(0, -1)] = { file }; // 前缀 'user-' / 'ai-' → 槽位名
    }
  }
  if (Object.keys(av).length) applied.avatar = av;
  return applied;
}
