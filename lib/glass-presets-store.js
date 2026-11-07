/**
 * glass-presets-store.js — 整机配置快照族的**存储层**（2026-11-07 从 `routes/presets.js`
 * 纯搬移折出：常量 + 磁盘读写 + 消毒 + 资产段编解码 + 资产落盘；零行为改动）。
 *
 * 语义与理由仍以 `routes/presets.js` 文件头为准（ADR-0011 四段语义、两层存储、墓碑、
 * 重名策略、旧版本作废、base64 只在宿主侧进出）；本文件只保证实现落点可读：
 *   · `readPresetAt` / `resolvePreset` / `listPresets` —— 读（两层优先级 + 墓碑遮蔽）；
 *   · `writePreset` / `writeTombstone` / `landImage` / `installAssets` —— 写（原子、只落用户层）；
 *   · `publicAssets` —— 对外元数据白名单（GET / create 回包）。
 *
 * 路由侧（`routes/presets.js`）只留 HTTP 面：端点解析、状态码、`DEPS` 契约与调用点。
 * 拆分纪律：先纯搬移（CODE-STRUCTURE §4.2）—— 本刀不顺手改任何行为。
 */

import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  PROFILE_PRESET_SCHEMA_TAG, GLASS_PRESET_TOMBSTONE_TAG, isGlassPresetId,
  sanitizePresetValues, sanitizePresetAssets, sanitizeFontset, ROPE_FORM_VALUES,
} from './settings-schema.js';

/**
 * 一份**无资产**预设正文的上限（settings 段的键集由 `../settings-schema.js` 给出 ⇒ 下方 `PRESET_MAX_BYTES` 已极宽松）。
 * 用于 `create` —— 那条路只收 settings 段与 `embed` **名单**（不收字节，见文件头）。
 */
export const PRESET_MAX_BYTES = 128 * 1024;
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
export const PRESET_IMPORT_MAX_BYTES = PRESET_MAX_BYTES + 3 * (Math.ceil(PRESET_ASSET_MAX_BYTES / 3) * 4);
/** 显示名长度上限（与设置面板一行宽度相称，与字体集名同一条）。 */
export const PRESET_NAME_MAX = 60;
/** 预设数量上限（用户口径：见下方 `PRESET_TOTAL_MAX`）。按**活跃**预设计 ——
 *  随包 + 用户层去重后的清单长度；被删除（墓碑）的出厂预设**不占位**
 *（删除正是用户腾位的手段）。清单扫描沿用同族常数做无界读护栏（另留墓碑余量）。 */
export const PRESET_TOTAL_MAX = 8;
/** 单层文件扫描上限（无界读护栏；墓碑也住用户层，给足余量）。 */
const PRESET_SCAN_MAX = 32;
/** 三个资产段的段名（白名单：`embed` 名单与 `assets=` 查询参数都只认这三个）。 */
export const ASSET_SEGMENTS = ['font', 'mascot', 'avatar'];
/** 落盘的图只认这三种扩展名（与 `AVATAR_EXT` / `MASCOT_EXT` 的值域同源）。 */
const ASSET_IMAGE_EXT = ['png', 'jpg', 'webp'];

/** `glass-presets/<id>.json` —— id 已过白名单，所以这是**单段**文件名。 */
export function presetPath(dir, id) { return join(dir, id + '.json'); }

/** 目录包含性（第二道网，第一道是 id 白名单）—— 口径与 fontsets.js 一致。 */
function insideDir(dir, abs) {
  const rel = relative(resolve(dir), resolve(abs));
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

/** 用户层目录（可写）/ 随包层目录（**只读**：任何写路径都不得指向它）。 */
export function userDir(c) { return c.glassPresetsDir(); }
export function builtinDir(c) { return c.glassPresetsBuiltinDir; }

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
export function readPresetAt(dir, id) {
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
export function resolvePreset(c, id) {
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
export function listPresets(c) {
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
export function normalizeName(name) { return String(name).trim().toLowerCase(); }

/** 全部**活跃**预设的归一化名字集合 —— 新建时的对比域（已删除的出厂名已放开）。 */
export function takenNames(c) {
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
export function uniqueImportName(c, wanted) {
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
 * `point` = 调用方对某一族资产的**指向声明**（ADR-0011 D4 第四态）：
 * `{ mascot: 'whale' }` ⇒ 落盘的 `assets.mascot` 是**字符串**（零字节，指向出厂自带的那一只），
 * 与内嵌对象 / `null`（声明无）并列成第三态。
 * 只有 `mascot` 有这个值域（内置形态只有吉祥物有）；段名与形态值**逐个逐字认**，
 * 认不清的**整条丢掉** —— 与 `sanitizePresetAssets` 的"认不清整段丢"同一口径：猜错等于
 * 悄悄给人换一只吉祥物，比"什么都不做"糟得多（丢 = 该段回到"缺席 = 不动"）。
 * @returns `{}`（没有可认的声明）或 `{ mascot: <形态 id> }`（值域 = `ROPE_FORM_VALUES`，
 *   值域：`whale` / `phoebe` + 八只「模型娘」）
 */
export function sanitizePresetPoint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  if (typeof raw.mascot === 'string' && ROPE_FORM_VALUES.includes(raw.mascot)) out.mascot = raw.mascot;
  return out;
}

/** 按段名从**当前本机**取一段（内嵌 / 导出补段共用）。 */
export function currentSegment(c, seg) {
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
 *   · **同一张图不重落**：同族里已有唯一一枚**同扩展名**且**字节全等**的文件，
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

/**
 * 落盘（原子，**只落用户层**）：正文永远由消毒产物构造，不照抄未信任输入。
 * 资产段过 `sanitizePresetAssets` ⇒ 形状与文件名都走与 settings 同一条消毒路径
 * （`MASCOT_FILE_RE` / `MASCOT_BOX_RE` / `AVATAR_FILE_RE`），且**缺席的段不写键**。
 */
export async function writePreset(c, id, name, values, assets) {
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
export async function writeTombstone(c, id) {
  const dir = userDir(c);
  c.ensureDirOnce(dir);
  const doc = { $schema: GLASS_PRESET_TOMBSTONE_TAG, id };
  await c.atomicWriteFileP(presetPath(dir, id), JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

/** 取一个未被占用的 id：客户端给的就用它，真撞了顺延 `-2`、`-3` …（不给用户看细节）。 */
export function freePresetId(c, wanted) {
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
 * `null`（**显式声明无**）与**字符串**（**指向出厂自带形态**）都**原样
 * 回显** —— 调用方要能看出"这一族被声明成无"或"被指到内置哪一只"，与"没带这一段"（键根本
 * 不出现）区分开。
 */
export function publicAssets(assets) {
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
  // 主题段：**纯元数据**（两个档位之一），没有字节可落 ⇒ 原样回显。
  // ⚠️ 这份函数是**白名单**：新增一段就必须在这里加一条。漏了的话客户端收不到那一段、
  // `applyPreset` 里对应那一腿静默不执行 —— 实测事故：作者自用声明了 dark，但宿主 GET
  // 时 theme 被丢掉 ⇒ 套用预设永远不切深色（而且不报错）。判据见 test/verify-presets.mjs
  // 的「theme 段能穿过宿主 publicAssets 白名单」。
  const th = assets.theme;
  if (th && typeof th === 'object' && !Array.isArray(th) && typeof th.preference === 'string') {
    out.theme = { preference: th.preference };
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
 * ⚠️ **`null` = 「显式声明无」（D4 的三态）**：那一族**回到内置默认** ——
 * 立绘 / 头像删掉本机文件（`clearFamily`）并回 `{ cleared: true }`（客户端据此把键置空）；
 * 字体没有文件可删，直接回一份**默认值**（客户端照旧经 `landPresetFontSet` 落进预设专用槽）。
 * 没有这一态，一份"范围小"的预设就撤销不了前一份预设装上的资产：实测 7 套出厂预设两两
 * 走 A→B→A，42 个有序对里 30 个不收敛（缺口全在资产族）。
 * ⚠️ **字符串 = 「指向出厂自带形态」（D4 第四态，只有 `mascot` 有）**：值域
 * = `ROPE_FORM_VALUES` 全表（`whale` / `phoebe` + 八只「模型娘」
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
export async function installAssets(c, assets) {
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

