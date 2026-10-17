/**
 * routes/fontsets.js — **字体集族**路由：`<BASE>/fontsets` 一个前缀下的
 * 七个端点 —— list / get / put / delete / activate / import / export。
 *
 * 为什么独立成文件：字体集是**磁盘上的一份份文件**（`fontsets/<id>.json`），而"id 从哪来、
 * 谁能写进那个目录、写坏了怎么办"必须能在一处读完 —— 七条端点写进 `lib/index.js` 只会让
 * 那个门面更长。
 *
 * 契约：`registerFontsetsRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers` / `base`                    ← 清理句柄数组与路径前缀
 *   · `fontSetsDir()`                         ← **用户层**目录（走 `pluginDataDir()`，可写）
 *   · `fontSetsBuiltinDir`                    ← **随包层**目录（包内 `lib/fontsets/`，**只读**）
 *   · `readSettings()`                        ← 一次性迁移要读老 settings
 *   · `readFontSetId()` / `setFontSetId(id)`  ← config.json 的**根字段**，非 settings 键集
 *   · `commitFontSetMigration(id)`            ← 迁移落定：一次 config 写入 = 记 id + 摘掉内联字体键
 *   · `atomicWriteFileP` / `ensureDirOnce`    ← 落地：临时文件 + rename 发布
 *   · `armBodyIdleTimeout` / `lingerClose`    ← 请求体 idle 超时与"写应答后再断"的收尾
 *   · `log`                                   ← 降级要留痕（读不懂的文件 / 迁移失败）
 *   · `schema`                                ← 共享内核的纯符号面（见下）
 *   · `http`                                  ← JSON 应答 / 请求体读取的纯函数面（见下）
 * 键集与消毒规则**不在这里**：它们复用共享内核 `lib/settings-schema.js` 的
 * `FONTSET_KEYS` / `sanitizeFontset` / `isFontSetId` ⇒ 与 settings 同一条消毒路径，
 * 且不必新建 `lib/**` 共享模块（`verify-module-layout` 的『共享内核白名单』因此不动）。
 *
 * ══ 两层存储（写时复制）══════════════════════════════════════════════════════
 * 预设来自两层，**同一 id 时用户层胜**：
 *   · **随包层** `lib/fontsets/<id>.json` —— 随包发布，供"开箱就有几个能用的预设"与分享；
 *   · **用户层** `<pluginDataDir>/fontsets/<id>.json` —— 导入、覆盖、以及一次性迁移的产物。
 * 写**永远只落用户层**：编辑一份随包预设 ⇒ 自动生成同名覆盖（写时复制），面板可标"已修改"
 * 并用**删除覆盖**回到随包原样（`DELETE` 的 `restored` 字段就是这件事）。因此：
 *   · **包内目录永不被写**（不 `unlink`、不 `write`、不 `ensureDir`）—— 它是随包发布的字节；
 *   · 随包预设**删不掉**（只有覆盖可删），因为"删掉一份发布物"没有可判定的结果。
 * 用户层那份**即使读不懂也照样遮住**随包层：静默回落到随包那份会让"我的改动不见了"看起来
 * 像没事。宁可如实报 `broken` 并让用户删掉覆盖 —— 删了就回到随包原样，是可判定的出路。
 *
 * ══ 切换的扩展位（当前只做人工切换）══════════════════════════════════════════════
 * `activate` 是**唯一**改活动指针的写原语（`config.json` 的根字段 `fontSetId`）。将来若要按
 * 条件自动选预设（随配色 / 随壁纸类型 / 按时段），那是**策略层**，必须**调用同一个原语**落指针，
 * 而不是各自再写一个"当前该用哪份"的地方 —— 指针保持单一真源，策略只决定"什么时候调它"。
 *
 * 不变量：
 *   · **id 是单段白名单**：`isFontSetId` 只放 `[A-Za-z0-9_-]{1,64}`，`. `不在表内 ⇒ `..` /
 *     路径分隔符 / 绝对路径 / 盘符 / 空串**连形状都过不了**；文件名只由 `join(dir, id + '.json')`
 *     构造，再叠一层目录包含性检查（分隔符无关的 `relative`）作为第二道。
 *   · **不落盘到白名单之外**：任何非法 id 的请求在读/写之前就被拒 ⇒ 目录内容不变。
 *   · **写只落用户层**：写路径经 `writeFontSet`（`userDir(c)`），绝不指向随包目录。
 *   · **读不懂就拒绝并说明**：`$schema` 不是当前版本的文件一律不可用（`bad-version`），
 *     不猜、不静默降级成"看起来正常"的空集。
 *   · **写必须是原子的**：`atomicWriteFileP`（同目录 `.tmp` + rename）——半截文件会让
 *     该字体集永久不可读。
 *   · **活动集不可删、不可被同名覆盖语义混淆**：删活动集是 400（用户得先切走），
 *     因为"正在用的那份被删掉"没有可判定的正确结果。
 *   · **切换活动集只认读得懂的文件**：`activate` 在读不懂时拒绝（404 / 422），
 *     不把用户的外观切到一个"说不清"的状态。
 *   · **一次性迁移是惰性的**，绝不在 `apply()` 里做：`apply` 会被**没有** `DSH_WE_DATA_DIR`
 *     隔离的守卫调用（`verify-scene.mjs` 就是），那时 `pluginDataDir()` 指向用户真目录 ——
 *     启动期写盘会污染真机。迁移改在**第一次真的用到字体集**时发生，且由"`fontSetId` 是否
 *     为空"决定，天然幂等。
 *   · **迁移产物一定落用户层，且不与随包 id 撞名**：随包预设一旦被用户层同名文件遮住，
 *     就再也不可见了 ⇒ 随包 id 刻意避开 `default`（由守卫钉住）。
 */

import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
// 跨包通道（ADR-0014 S5.1 / S5.3）：本族**零主包 specifier** —— 共享内核的纯符号面也不静态
// import，而由 `registerFontsetsRoutes` 的 `c` 显式收下两个面（调用点 = 子包入口
// packages/fonts/lib/index.js，值来自 `ctx.wallpaperEngineHost`）：
//   · `c.schema` —— isFontSetId / sanitizeFontset / FONTSET_MIGRATED_ID / FONTSET_SCHEMA_TAG（纯函数 / 常量）
//   · `c.http`   —— sendJson / bodyReader（JSON 应答 / 请求体读取）
// 运行期才存在的**实例**（disposers / 目录 / 设置读写 / 清理句柄 …）同样逐键从 `c` 消费。
// 模块作用域**不持有**主包的任何值（ADR-0014 S5.1 / S5.3 反模式：HMR 后旧代 exports）。

/** 一份字体集正文的上限（键集 = `FONTSET_KEYS`，每键至多几十项 ⇒ 下方 `FONTSET_MAX_BYTES` 已极宽松）。 */
const FONTSET_MAX_BYTES = 256 * 1024;
/** 显示名长度上限（与设置面板一行的宽度相称）。 */
const FONTSET_NAME_MAX = 60;
/** 列表扫描上限：目录被塞爆时不让一次请求变成无界读（超出即截断，不影响取用单个集）。 */
const FONTSET_LIST_MAX = 200;

/** `fontsets/<id>.json` —— id 已过白名单，所以这是**单段**文件名。 */
function fontSetPath(dir, id) { return join(dir, id + '.json'); }

/**
 * 目录包含性（第二道网，第一道是 id 白名单）：规范化后必须仍在该目录内。
 * 口径与 `resolveUploadFile` 一致 —— 用 `relative` 而不是拼分隔符，跨平台都成立。
 */
function insideDir(dir, abs) {
  const rel = relative(resolve(dir), resolve(abs));
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

/** 用户层目录（可写）/ 随包层目录（**只读**：任何写路径都不得指向它）。 */
function userDir(c) { return c.fontSetsDir(); }
function builtinDir(c) { return c.fontSetsBuiltinDir; }

/** 文件名 → id；不合白名单的（手放进去的怪名字）不进列表、也永不被写。 */
function listFontSetIds(dir, schema) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const ids = [];
  for (const e of entries) {
    if (typeof e.isFile !== 'function' || !e.isFile()) continue;
    if (!e.name.endsWith('.json')) continue;
    const id = e.name.slice(0, -'.json'.length);
    if (!schema.isFontSetId(id)) continue;
    ids.push(id);
    if (ids.length >= FONTSET_LIST_MAX) break;
  }
  return ids.sort();
}

/**
 * 读**某一层**里的字体集。返回 `{ ok: true, doc }` 或 `{ ok: false, reason }`，
 * reason ∈ `missing` / `bad-json` / `bad-shape` / `bad-version` / `unsafe-path`。
 */
function readFontSetAt(dir, id, schema) {
  const abs = fontSetPath(dir, id);
  if (!insideDir(dir, abs)) return { ok: false, reason: 'unsafe-path' };
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch { return { ok: false, reason: 'missing' }; }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'bad-json' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'bad-shape' };
  if (parsed.$schema !== schema.FONTSET_SCHEMA_TAG) return { ok: false, reason: 'bad-version' };
  const name = typeof parsed.name === 'string' && parsed.name.trim()
    ? parsed.name.trim().slice(0, FONTSET_NAME_MAX) : id;
  return { ok: true, doc: { $schema: schema.FONTSET_SCHEMA_TAG, id, name, values: schema.sanitizeFontset(parsed.values) } };
}

/**
 * 按两层优先级解析一份字体集：**用户层胜**（写时复制的覆盖就住在那儿）。
 * 用户层那份即使读不懂也照样遮住随包层 —— 静默回落到随包那份会让"我的改动不见了"看起来
 * 像没事；如实报 `broken` 才是可判定的形态（删掉覆盖即可回到随包原样）。
 */
function resolveFontSet(c, id) {
  const user = readFontSetAt(userDir(c), id, c.schema);
  if (user.ok) return { ok: true, doc: user.doc, origin: 'user' };
  if (user.reason !== 'missing') {
    return {
      ok: false, reason: user.reason, origin: 'user',
      shadowsBuiltin: readFontSetAt(builtinDir(c), id, c.schema).ok,
    };
  }
  const builtin = readFontSetAt(builtinDir(c), id, c.schema);
  if (builtin.ok) return { ok: true, doc: builtin.doc, origin: 'builtin' };
  return { ok: false, reason: 'missing', origin: null };
}

/** 两层合并（用户层胜）+ `origin` / `overrides` / `broken` 标记，按 id 排序。 */
function listFontSets(c) {
  const userIds = listFontSetIds(userDir(c), c.schema);
  const builtinIds = listFontSetIds(builtinDir(c), c.schema);
  const ids = [...new Set([...userIds, ...builtinIds])].sort();
  return ids.slice(0, FONTSET_LIST_MAX).map((id) => {
    const resolved = resolveFontSet(c, id);
    const inUser = userIds.includes(id);
    const row = {
      id,
      name: resolved.ok ? resolved.doc.name : id,
      origin: resolved.ok ? resolved.origin : (inUser ? 'user' : 'builtin'),
    };
    if (inUser && builtinIds.includes(id)) row.overrides = true;
    if (!resolved.ok) row.broken = resolved.reason;
    return row;
  });
}

/** 落盘（原子，**只落用户层**）：正文永远由 `sanitizeFontset` 的产物构造，不照抄未信任输入。 */
async function writeFontSet(c, id, name, values) {
  const dir = userDir(c);
  c.ensureDirOnce(dir);
  const doc = {
    $schema: c.schema.FONTSET_SCHEMA_TAG,
    id,
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, FONTSET_NAME_MAX) : id,
    values: c.schema.sanitizeFontset(values),
  };
  await c.atomicWriteFileP(fontSetPath(dir, id), JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

/**
 * 一次性迁移：`config.json` 还是"老形状"（六个字体键内联在 settings 里、没有 `fontSetId`）
 * ⇒ 把它们落成 `fontsets/default.json` 并记下活动 id，**同时把内联键从 settings 里摘掉**
 *（`commitFontSetMigration` 一次写完 —— D1 的终态是"值只住字体集"）。
 * 只在**第一次真的用到字体集**时调用（见文件头的惰性理由）。
 *
 * ⚠️ **不覆盖已有的用户 `default`**：客户端在迁移落定前若已经改过字体，它会先 PUT 出一份
 * 用户 `default`；这里若照写一遍就等于把用户刚做的编辑抹掉（而且看起来"迁移成功"）。
 * 已有用户文件时**直接采纳**它（`adopted: true`）。
 */
async function migrateLegacyFontSet(c) {
  if (c.readFontSetId()) return { migrated: false };
  const existing = readFontSetAt(userDir(c), c.schema.FONTSET_MIGRATED_ID, c.schema);
  if (!existing.ok) await writeFontSet(c, c.schema.FONTSET_MIGRATED_ID, '默认', c.readSettings() || {});
  await c.commitFontSetMigration(c.schema.FONTSET_MIGRATED_ID);
  return { migrated: true, adopted: existing.ok };
}

/** 取一个未被占用的 id（导入用）：`<base>`、`<base>-2`、`<base>-3` … 到上限为止。 */
function freeFontSetId(c, wanted) {
  const base = c.schema.isFontSetId(wanted) ? wanted : 'imported';
  // 两层都算占用：导入撞上随包 id 会立刻变成一份"覆盖"，那是用户的意图之外。
  const taken = new Set([...listFontSetIds(userDir(c), c.schema), ...listFontSetIds(builtinDir(c), c.schema), 'import', 'export']);
  if (!taken.has(base)) return base;
  for (let i = 2; i <= FONTSET_LIST_MAX; i++) {
    const id = (base + '-' + i).slice(0, 64);
    if (c.schema.isFontSetId(id) && !taken.has(id)) return id;
  }
  return null;
}

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账；本族多数键经模块级 helper 的 `c` 形参消费）。 */
// 全部 13 个运行期实例（清理句柄 / 目录 / 设置读写 …）由主包 `host.keys('fonts')` 冻结供给；
// `schema` / `http` 是共享内核的纯符号面，由调用点（`packages/fonts/lib/index.js`）从
// `ctx.wallpaperEngineHost` 显式传下（见文件头）—— 本文件零主包 specifier。
export const DEPS = ['disposers', 'base', 'readFontSetId', 'fontSetsDir', 'fontSetsBuiltinDir', 'ensureDirOnce', 'atomicWriteFileP', 'readSettings', 'commitFontSetMigration', 'lingerClose', 'armBodyIdleTimeout', 'log', 'setFontSetId', 'schema', 'http'];

export function registerFontsetsRoutes(webServer, c) {
  const { disposers, base: BASE, readFontSetId } = c;

  /** 请求体 → JSON（带上限与 idle 超时；解析失败也算可判定的失败）。 */
  function withJsonBody(req, res, onBody) {
    let settled = false;
    const fail = (code, payload) => {
      if (settled) return;
      settled = true;
      c.http.sendJson(res, code, payload);
      c.lingerClose(req, res);
    };
    c.armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
    // 字节计上限 + 收完**一次性**解码（不变量见 lib/routes/upload.js 文件头）：
    // 逐块 `body += chunk` 会把跨 TCP 分片的多字节码点切成 U+FFFD，而字体集名 / 字体族
    // 正是会被这样静默写坏的用户可见字符串。
    const reader = c.http.bodyReader(req, {
      maxBytes: FONTSET_MAX_BYTES,
      shouldStop: () => settled,
      onOverflow: () => fail(413, { error: 'fontset payload too large' }),
    });
    req.on('data', reader.onData);
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = reader.text();
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch {
        c.http.sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      onBody(parsed);
    });
    req.on('error', () => fail(400, { error: 'request error' }));
  }

  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/fontsets`,
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const json = (code, payload) => c.http.sendJson(res, code, payload);
      // ⚠️ `new URL` 会先把 `..` / `%2e%2e` / 反斜杠形式的点段规范化掉（WHATWG 语义）
      // ⇒ 穿越路径到不了这里；能到这里的都是"看起来像 id"的段，随后还要过 `isFontSetId`。
      let url;
      try { url = new URL(req.url || '/', 'http://x'); } catch { json(400, { error: 'invalid url' }); return; }
      const rest = url.pathname.slice(`${BASE}/fontsets`.length);
      if (rest.includes('//')) { json(400, { error: 'invalid path' }); return; }
      let segments;
      try {
        segments = rest.split('/').filter((s) => s !== '').map((s) => decodeURIComponent(s));
      } catch { json(400, { error: 'invalid percent-encoding in path' }); return; }
      const [first, second] = segments;

      // 根：GET 列表（列表前先做惰性迁移 —— 这是唯一会写盘的时机）。
      if (segments.length === 0) {
        if (method !== 'GET') { json(405, { error: 'method not allowed' }); return; }
        let migrated = false;
        let adopted = false;
        try {
          const r = await migrateLegacyFontSet(c);
          migrated = r.migrated;
          adopted = Boolean(r.adopted);
        } catch (err) {
          c.log.warn('fontsets: 一次性迁移失败（' + String(err && err.message ? err.message : err) + '）');
        }
        const active = readFontSetId();
        const fontsets = listFontSets(c).map((row) => Object.assign({ active: row.id === active }, row));
        json(200, { fontsets, active, migrated, adopted });
        return;
      }

      // 导入（保留段，不允许当 id）。
      if (segments.length === 1 && first === 'import') {
        if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }
        withJsonBody(req, res, (body) => {
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            json(400, { error: '字体集文件必须是一个 JSON 对象' }); return;
          }
          if (body.$schema !== c.schema.FONTSET_SCHEMA_TAG) {
            json(400, { error: '无法读取的字体集版本（需要 ' + c.schema.FONTSET_SCHEMA_TAG + '）' }); return;
          }
          const id = freeFontSetId(c, body.id);
          if (!id) { json(409, { error: '字体集数量已达上限' }); return; }
          writeFontSet(c, id, body.name, body.values).then(
            (doc) => json(200, { ok: true, id: doc.id, name: doc.name }),
            (err) => json(500, { error: String(err && err.message ? err.message : err) }),
          );
        });
        return;
      }

      if (segments.length === 1) {
        if (!c.schema.isFontSetId(first)) { json(400, { error: 'invalid fontset id' }); return; }
        if (method === 'GET') {
          const read = resolveFontSet(c, first);
          if (read.ok) { json(200, { ok: true, origin: read.origin, ...read.doc }); return; }
          if (read.reason === 'missing') { json(404, { error: 'unknown fontset' }); return; }
          c.log.warn('fontsets: 读不懂的字体集文件（' + read.reason + '）：' + first);
          json(422, {
            error: 'fontset file is unreadable', reason: read.reason,
            origin: read.origin, shadowsBuiltin: Boolean(read.shadowsBuiltin),
          });
          return;
        }
        if (method === 'PUT') {
          withJsonBody(req, res, (body) => {
            if (!body || typeof body !== 'object' || Array.isArray(body)
              || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
              json(400, { error: 'body 必须是 { name?, values: {…} }（values 必填：清空请显式给 {}）' });
              return;
            }
            const prev = resolveFontSet(c, first);
            const name = typeof body.name === 'string' && body.name.trim()
              ? body.name : (prev.ok ? prev.doc.name : first);
            // 写时复制：改一份随包预设 ⇒ 落一份同名**用户层**覆盖；随包那份字节不动。
            const overrides = readFontSetAt(builtinDir(c), first, c.schema).ok;
            writeFontSet(c, first, name, body.values).then(
              (doc) => json(200, {
                ok: true, id: doc.id, name: doc.name, values: doc.values,
                origin: 'user', overrides,
              }),
              (err) => json(500, { error: String(err && err.message ? err.message : err) }),
            );
          });
          return;
        }
        if (method === 'DELETE') {
          if (first === readFontSetId()) {
            json(400, { error: '不能删除正在使用的字体集（先切换到别的集）' });
            return;
          }
          // 只有**用户层**的文件可删。删掉一份覆盖 ⇒ 随包那份重新可见（= 恢复原样）。
          const userAbs = fontSetPath(userDir(c), first);
          const inUser = readFontSetAt(userDir(c), first, c.schema).reason !== 'missing';
          if (inUser) {
            try { unlinkSync(userAbs); } catch {
              json(500, { error: '删除失败（文件被占用或权限不足）' });
              return;
            }
            const restored = readFontSetAt(builtinDir(c), first, c.schema);
            json(200, { ok: true, removed: first, origin: 'user', ...(restored.ok ? { restored: 'builtin' } : {}) });
            return;
          }
          if (readFontSetAt(builtinDir(c), first, c.schema).ok) {
            json(400, {
              error: '随包预设不能删除（可以直接覆盖它；要恢复原样就删掉你的覆盖）',
              origin: 'builtin',
            });
            return;
          }
          json(404, { error: 'unknown fontset' });
          return;
        }
        json(405, { error: 'method not allowed' });
        return;
      }

      // 切换活动集：`<id>/activate`。**必须**先读得懂那一份才肯切过去 ——
      // 切到一个读不懂的文件等于把用户的字体外观变成"说不清"，宁可拒绝。
      if (segments.length === 2 && second === 'activate') {
        if (method !== 'POST') { json(405, { error: 'method not allowed' }); return; }
        if (!c.schema.isFontSetId(first)) { json(400, { error: 'invalid fontset id' }); return; }
        const read = resolveFontSet(c, first);
        if (!read.ok) {
          json(read.reason === 'missing' ? 404 : 422, { error: 'fontset file is unreadable', reason: read.reason });
          return;
        }
        c.setFontSetId(first).then(
          () => json(200, { ok: true, active: first, origin: read.origin }),
          (err) => json(500, { error: String(err && err.message ? err.message : err) }),
        );
        return;
      }

      // 导出：`<id>/export`（正文由读到的值**重建**，不照抄磁盘上的字节 —— 未知版本的文件
      // 因此不会被导出成"看起来能分享"的东西）。
      if (segments.length === 2 && second === 'export') {
        if (method !== 'GET') { json(405, { error: 'method not allowed' }); return; }
        if (!c.schema.isFontSetId(first)) { json(400, { error: 'invalid fontset id' }); return; }
        const read = resolveFontSet(c, first);
        if (!read.ok) {
          json(read.reason === 'missing' ? 404 : 422, { error: 'fontset file is unreadable', reason: read.reason });
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
