/**
 * routes/presets.js — **玻璃预设族**路由：`<BASE>/glass-presets` 一个前缀下的
 * 四个端点 —— list / get / create / delete。
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
 *   · **没有 import/export**：第一版不背分享链路；导出/导入若要做，应当连着
 *     "分享到市场"一起设计，而不是先长出两条半成品端点。
 *
 * 契约：`registerGlassPresetsRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西
 * （与 fontsets.js 同名同义）：`disposers` / `base` / `glassPresetsDir()`（用户层，可写）/
 * `glassPresetsBuiltinDir`（随包层，**只读**）/ `atomicWriteFileP` / `ensureDirOnce` /
 * `armBodyIdleTimeout` / `lingerClose` / `log`。
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
 *     「作者自用」会得到一份永远排在真出厂旁边、看起来一模一样的影子；
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
 * 读**某一层**里的预设。返回 `{ ok: true, doc }` 或 `{ ok: false, reason }`，
 * reason ∈ `missing` / `bad-json` / `bad-shape` / `bad-version` / `unsafe-path`。
 * 名字的截断与兜底与 fontsets.js 同形；正文由 `sanitizeGlassPresetValues` 重建
 *（缺键补玻璃键默认值 —— 存盘的每一份都是完整快照，读出来也必须还是）。
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
  return { ok: true, doc: { $schema: GLASS_PRESET_SCHEMA_TAG, id, name, values: sanitizeGlassPresetValues(parsed.values) } };
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

/** 落盘（原子，**只落用户层**）：正文永远由消毒产物构造，不照抄未信任输入。 */
async function writePreset(c, id, name, values) {
  const dir = userDir(c);
  c.ensureDirOnce(dir);
  const doc = {
    $schema: GLASS_PRESET_SCHEMA_TAG,
    id,
    name: String(name).trim().slice(0, PRESET_NAME_MAX),
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
      const [first] = segments;

      // 根：GET 清单（随包在前、用户在后；`broken` 如实标注；已删除的出厂不出现）。
      if (segments.length === 0) {
        if (method !== 'GET') { json(405, { error: 'method not allowed' }); return; }
        json(200, { presets: listPresets(c) });
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
          writePreset(c, id, name, body.values).then(
            (doc) => json(200, { ok: true, id: doc.id, name: doc.name, values: doc.values }),
            (err) => json(500, { error: String(err && err.message ? err.message : err) }),
          );
        });
        return;
      }

      if (segments.length === 1) {
        if (!isGlassPresetId(first)) { json(400, { error: 'invalid preset id' }); return; }
        if (method === 'GET') {
          const read = resolvePreset(c, first);
          if (read.ok) { json(200, { ok: true, origin: read.origin, ...read.doc }); return; }
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

      json(404, { error: 'not found' });
    },
  }));
}
