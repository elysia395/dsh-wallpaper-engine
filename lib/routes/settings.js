/**
 * routes/settings.js — **插件设置**族路由：`/settings`（兼容整段入口）与 `/settings/<ns>`（组件写路径）。
 *
 * 端口无关的持久化，替代 localStorage：GET 回已存设置（从未存过则 null）＋ 两个**随响应带出**的
 * 旁路观测值；PUT 把规范化副本写进 `~/.dsh-wallpaper-engine/config.json`。这正是设置能跨
 * DSH Desktop 重启（新随机 `--port 0` 回环端口）与同机多浏览器 / 多设备存活的原因。
 *
 * **P1-S1「设置分区」后的两条写路径**（设计 B）：
 *   · `GET/PUT /settings` —— **兼容整段入口**（老客户端 / 首启迁移 / 兜底）。PUT 语义从「整段替换」
 *     改成**按键合并**：只覆盖 body 里**出现**的键；含全部键的 body 与旧行为**逐字节等价**
 *     （合并结果 = 过一遍宿主消毒，键序恒为 `KINDS` 序）；缺键**不再**被重置成默认值。
 *     它是本族**唯一**允许一次碰多个簇的入口，M4 口径里单列为兼容例外。
 *   · `GET/PUT /settings/<ns>` —— **组件写路径**（`<ns>` ∈ `SETTINGS_NAMESPACE_NAMES`，注册表
 *     单一真源 = `lib/settings-schema.js`）：PUT 只接受本簇键，**段外键与未知键一律忽略**（宿主机配置
 *     一字不变；被忽略的键名在应答 `ignored` 里回报 —— 静默忽略无法与"写丢了"区分开）；GET 回该簇
 *     读视图（磁盘上有哪些键就给哪些键）。
 *     `meta`（`settingsVersion`）**没有路由**：只由规范化路径写；未知 ns 一律 JSON 404。
 *
 * 为什么只有**一条** prefix 注册（`${BASE}/settings`），而不是 exact + 逐 ns 各一条 exact：
 *   · 真实匹配语义是 `pathname === path || pathname.startsWith(path + '/')`（三处夹具同形：
 *     `test/e2e-web-media-origin.mjs:84-86`、`test/tools/diagnose-web-blank.mjs:110-112`、
 *     `test/verify-scene.mjs:527`），带尾斜杠的 `${BASE}/settings/` **永远匹配不上**
 *     `/settings/core`（`startsWith('/settings/' + '/')` 为假）—— 尾斜杠是错的；
 *   · 逐 ns 各注册一条 exact 会让 route-family 的 `settings` 族越过
 *     `test/verify-route-families.mjs` 的 `FAMILY_TRIGGER` ⇒ 红（现况由该守卫现算并打印）。
 *   · `lib/routes/props.js` / `fontsets.js` 是同一种形态（一条 prefix 同时服务裸路径与子路径）。
 *
 * 契约：`registerSettingsRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers`            ← 清理句柄数组
 *   · `base`                 ← `/wallpaper-engine` 前缀
 *   · `ctx`                  ← 插件上下文（透传给 `isBetterSidebarLoaded(ctx)`）
 *   · `mediaOriginApi`       ← 适配器形态观测（GET 时 `observeAdapter` + `adapterState`）
 *   · `readSettings`         ← 读 `config.json` 现值
 *   · `isBetterSidebarLoaded`← 侧栏插件是否安装且启用（`betterSidebar` 字段）
 *   · `sanitizeSettings`     ← 白名单 / 派生校验（唯一真源见 `../settings-schema.js`）
 *   · `withLegacyFontValues` ← 字体迁移期护栏（磁盘老字体值不得被这次写入抹掉）
 *   · `mergeSettings`        ← **按键合并**落盘：读-改-写整条在写队列内（P1-S1 关掉的那个窗口）
 *   · `armBodyIdleTimeout`   ← 60s 无数据即超时（收体防挂）
 *   · `lingerClose`          ← 应答先发、排空后再断
 * 收体的 `bodyReader` 由本模块**自己 import**（不经 `c`，见 verify-body-caps 的逐文件断言）。
 *
 * 不变量：
 *   · **写路径只认 PUT**，其余非 GET 一律 405（两条路径同口径）。
 *   · 收体三条：**有上限**（`SETTINGS_MAX_BYTES`）、**超时断开**（`armBodyIdleTimeout`）、
 *     **一次性解码**（`bodyReader.text()`，不逐块 `+=`）。两条写路径共用 `readSettingsBody`，三条只写一遍。
 *   · 落盘的永远是**规范化后**的值；非对象体 ⇒ 400，连 JSON 都解析不了 ⇒ 400。
 *   · **组件路径的 patch 值按"当前刻度"解读**（P1-FIX）：组件差分 body **不带** `settingsVersion`，
 *     若按 body 自己的"档位"消毒，`migrateSettings` 会把这几个**已经在当前刻度上**的键再换算一遍
 *     （`migrateSettings` 的换算键：70 会落成 100 / 35 / 88 …）⇒ `readSettingsBody` 另出一份盖了当前版本号的
 *     消毒结果 `current`，组件路径取 `current[key]`。兼容整段入口仍取 `sanitized` —— body 自带
 *     旧版本号（或老客户端整段迁移）时要保留"迁移一次"的语义。
 *   · **收体优先于路由判定**：任何 `PUT /settings…` 都先把请求体收完（或按上限/超时拒绝）**再**判 ns ——
 *     带着未读的入站数据应答/断开会被对端判成 RST（`lingerClose` 的排空就是为这个）。因此
 *     `413`（超限）/`408`（超时）/`400`（体坏）**优先于** `404`（未知 ns）；这也是
 *     `test/verify-scene.mjs:723-818`（Level D2，用 `route + '/' + token` 的 URL 直接调 handler）的口径。
 *   · `withLegacyFontValues` 是迁移期护栏，迁移落定后它自动失效（理由见其自身注释）——
 *     在本族里它必须**在**写盘之前，不能绕过（`mergeSettings` 队内还会再上一道，两道同源）。
 *   · **段外键不是错误，是忽略**：`/settings/<ns>` 的 body 夹带别簇的键时磁盘一字不动，
 *     应答里附 `ignored` 键名 —— 判据见 `test/verify-settings-namespaces.mjs` ②。
 *   · 一个本簇键都没有的 body（含 `PUT {}`）**不触发任何写入** —— 连规范化重写都不会发生
 *     （旧语义会把整段重置成默认值；这条判据是 `test/verify-settings-namespaces.mjs` ③ 的幂等前提）。
 *   · `GET /settings` 回的是**规范化后的宿主快照**（键集 = `sanitizeFromSchema` 的白名单，真源 `../settings-schema.js`）而不是磁盘原文：老存档（缺键 / 旧刻度 /
 *     没盖 `settingsVersion`）因此也拿到完整可用的形状，而**读不落盘**（`config.json` 逐字节不变）。
 *     迁移期护栏照旧生效（`fontSetId` 为空时内联字体键仍在响应里）；磁盘上**没有** `settings` 段时
 *     仍回 `null`（客户端靠 `null` 判"宿主还没有存档 ⇒ 把本地副本迁上去"）。
 */

import { bodyReader } from '../http-body.js';
// JSON 应答的**唯一实现**（状态码 + 两个头 + end）—— 见 lib/json-response.js。
import { sendJson } from '../json-response.js';
// 命名空间注册表：**单一真源**，与客户端半边（`src/persistence.js` 的差分发送）共用同一张表。
import { SETTINGS_NAMESPACES, SETTINGS_NAMESPACE_NAMES } from '../settings-schema.js';

/** PUT body 上限：设置体是小的 JSON 对象，64KB 远超正常值。 */
const SETTINGS_MAX_BYTES = 64 * 1024;

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'ctx', 'mediaOriginApi', 'readSettings', 'isBetterSidebarLoaded', 'sanitizeSettings', 'withLegacyFontValues', 'mergeSettings', 'armBodyIdleTimeout', 'lingerClose'];

export function registerSettingsRoutes(webServer, c) {
  const {
    disposers, base: BASE, ctx, mediaOriginApi,
    readSettings, isBetterSidebarLoaded, sanitizeSettings, withLegacyFontValues, mergeSettings,
    armBodyIdleTimeout, lingerClose,
  } = c;

  const SETTINGS_PATH = `${BASE}/settings`;
  const NS_PREFIX = `${BASE}/settings/`;
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // 落盘一律走 `mergeSettings`（`lib/kernel/config.js`）：读-改-写整条在 config 写队列内，
  // 并发写不会互相丢更新（P1-S1 关掉的那个窗口）。签名与错误传播同整段写一致。

  /** 该簇的读视图：**只回磁盘上真有的键**（补默认值是 `GET /settings` 的事，不是这里）。 */
  const nsView = (settings, ns) => {
    const out = {};
    if (!settings || typeof settings !== 'object') return out;
    for (const key of SETTINGS_NAMESPACES[ns]) if (hasOwn(settings, key)) out[key] = settings[key];
    return out;
  };

  /**
   * 收体三条 + 解析 + 消毒 —— 两条 PUT 路径共用。失败路径自己应答（408/413/400/400），
   * 成功时把 `(parsed, sanitized, current)` 交给 `done`。`parsed` 是**原始 body**（判"这次到底
   * 提了哪些键"只能用它）；`sanitized` 是**按 body 自己的档位**规范化后的完整快照（兼容整段入口
   * 用它 —— body 自带旧版本号时要迁移一次）；`current` 是**盖了当前版本号**的同一份快照
   * （组件路径用它 —— 差分 body 不带版本号，按当前刻度取值才不会被二次换算）。
   */
  const readSettingsBody = (req, res, json, done) => {
    let tooLarge = false;
    // 中途放弃（超限 / 超时）走**同一处**断开收口：应答先写，再排空、等应答刷完才断。
    const fail = (code, payload) => {
      if (tooLarge) return;
      tooLarge = true;
      json(code, payload);
      lingerClose(req, res);
    };
    // 60s 无数据即超时（见 armBodyIdleTimeout）。
    armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
    // 字节计上限 + 收完一次性解码 —— 唯一实现见 `lib/http-body.js`。
    // `fail()` 自己会置 `tooLarge`（见它的定义），`end` 那条早退因此保持不变。
    const reader = bodyReader(req, {
      maxBytes: SETTINGS_MAX_BYTES,
      onOverflow: () => fail(413, { error: 'settings payload too large' }),
    });
    req.on('data', reader.onData);
    req.on('end', () => {
      if (tooLarge) return;
      let parsed;
      try { parsed = JSON.parse(reader.text() || '{}'); } catch {
        json(400, { error: 'invalid JSON body' }); return;
      }
      const sanitized = sanitizeSettings(parsed);
      if (!sanitized) {
        json(400, { error: 'settings must be a JSON object' }); return;
      }
      // 第二份消毒：**盖上当前版本号**再消毒一次。`settingsVersion` 是 `kind:'const'`
      //（`sanitizeSettings` 一律把它回成当前版本），组件差分 body 不带版本号，若按 body 自己的
      // "档位"取刻度，`migrateSettings` 会把这几个**已经在当前刻度上**的键再换算一遍
      //（`migrateSettings` 的换算键：glassAlpha 70 ⇒ 100、sidebarAlpha 70 ⇒ 35、sidebarContentAlpha 70 ⇒ 88 …）。
      // 键集仍取 `parsed`（判"这次到底提了哪些键"），取值改取 `current`（当前刻度）；
      // 兼容整段入口继续用 `sanitized` —— body 自带旧版本号时要保留"按 body 版本迁移一次"的语义。
      const current = sanitizeSettings(
        Object.assign({}, parsed, { settingsVersion: sanitized.settingsVersion }),
      ) || sanitized;
      done(parsed, sanitized, current);
    });
    req.on('error', () => { if (!tooLarge) json(400, { error: 'request error' }); });
  };

  // 7. Plugin settings (port-independent persistence replacing localStorage).
  //    GET returns the persisted settings (null when never saved); PUT stores
  //    a sanitized copy in ~/.dsh-wallpaper-engine/config.json. This is what
  //    keeps every setting across DSH Desktop restarts with a new random
  //    --port 0 loopback port, and across browsers/devices on the same host.
  //    一条 prefix 注册同时服务裸路径（兼容整段入口）与子路径（组件路径）——
  //    匹配语义与理由见文件头（尾斜杠注册是错的；逐 ns 各一条 exact 会越过族触发线）。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/settings`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      // 薄别名：保留调用点写法，实现收敛到 lib/json-response.js（默认带 no-store）。
      const json = (code, payload) => sendJson(res, code, payload);
      // 段名一律从 pathname 取（不吃查询串，也不吃尾斜杠）；段名全是 ASCII，不做解码 ——
      // 编码过的段名匹配不上就落进 404，这正是我们要的（不猜、不纠错）。
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const isComponent = pathname !== SETTINGS_PATH;
      const ns = isComponent ? pathname.slice(NS_PREFIX.length).replace(/\/+$/, '') : '';
      const knownNs = isComponent && SETTINGS_NAMESPACE_NAMES.includes(ns);

      if (method === 'GET') {
        if (isComponent) {
          // `meta` 与任何未知 ns 都走这条（组件簇由 `SETTINGS_NAMESPACE_NAMES` 给出）。
          if (!knownNs) { json(404, { ok: false, error: 'unknown settings namespace' }); return; }
          const stored = readSettings();
          json(200, { ok: true, ns, settings: stored ? nsView(stored, ns) : null });
          return;
        }
        // betterSidebar: 侧栏玻璃控制组是否显示（dsh-better-sidebar 已安装且
        // 启用）。挂在 settings 响应上，客户端 loadPersisted 时一次取回。
        // adapter: 本页面跑在哪种宿主形态里（观测值 fence/detected + 手选后的生效值），
        // 客户端据此挂 body[data-we-adapter]、门控外壳材质与失焦暂停。见 3c-0。
        mediaOriginApi.observeAdapter(req);
        // 回**规范化后的宿主快照**而不是磁盘原文（理由见文件头最后一条不变量）：
        // 老存档缺的键补默认值、旧刻度过迁移、非白名单键丢掉，读不落盘。
        const stored = readSettings();
        json(200, {
          settings: stored ? withLegacyFontValues(sanitizeSettings(stored)) : null,
          betterSidebar: isBetterSidebarLoaded(ctx),
          adapter: mediaOriginApi.adapterState(),
        });
        return;
      }
      if (method !== 'PUT') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }

      // ── 组件写路径：`PUT /settings/<ns>` ────────────────────────────────
      if (isComponent) {
        // ⚠️ 顺序是**先收体、后判 ns**（见文件头"收体优先于路由判定"）：超限 / 超时的体必须先被
        //    排空再拒绝，否则带着未读入站数据断开会被对端判成 RST。正常大小的未知 ns 体读完后
        //    回 JSON 404，且**一字不写**。
        readSettingsBody(req, res, json, (parsed, _sanitized, current) => {
          if (!knownNs) { json(404, { ok: false, error: 'unknown settings namespace' }); return; }
          // 本簇的键才算 patch；段外键（含未知键）忽略并回报键名。键集走 `parsed`、**取值走 `current`**
          // （`parsed` 只用来判"这次提了哪些键"，原始值不落盘；`current` = 盖了当前版本号的消毒结果，
          // 所以已在当前刻度上的 patch 值不会被迁移再换算一遍，见 readSettingsBody 里那份注释）。
          const nsKeys = SETTINGS_NAMESPACES[ns];
          const patch = {};
          // 只认 body 里**出现过**的本簇键：取值走 `current`（消毒后的刻度 / 白名单值），
          // 但键集走 `parsed` —— `current` 是**完整快照**（缺键已补默认值），直接拿它当 patch
          // 会把本簇没提到的键一起按默认值写回去（等于"整簇替换"，段外键会连坐被改）。
          for (const key of Object.keys(parsed)) {
            if (!nsKeys.includes(key) || !hasOwn(current, key)) continue;
            patch[key] = current[key];
          }
          const ignored = Object.keys(parsed).filter((key) => !nsKeys.includes(key));
          if (!Object.keys(patch).length) {
            // 一个本簇键都没提到 ⇒ **一字不写**（段外键不得引起任何写入，连规范化重写都不发生）。
            const stored = readSettings();
            json(200, { ok: true, ns, settings: stored ? nsView(stored, ns) : null, ignored });
            return;
          }
          // 写已串行化（`mergeSettings` 把读-改-写整条放进写队列），等写盘完成再应答，
          // 保持原有「响应即已持久化」的语义。
          mergeSettings(patch).then(
            (next) => json(200, { ok: true, ns, settings: nsView(next, ns), ignored }),
            (err) => json(500, { error: String(err && err.message ? err.message : err) }),
          );
        });
        return;
      }

      // ── 兼容整段入口：`PUT /settings` ───────────────────────────────────
      readSettingsBody(req, res, json, (parsed, sanitized) => {
        // **按键合并**（P1-S1 的核心语义变更）：只保留 body 里**出现**过的键 ——
        // `sanitizeSettings` 会给缺键补默认值，整段交给写路径就等于退回「整段替换」。
        for (const key of Object.keys(sanitized)) if (!hasOwn(parsed, key)) delete sanitized[key];
        if (!Object.keys(sanitized).length) {
          // body 里一个合法键都没有（含 `PUT {}`）⇒ 一字不写。旧语义会在这里把整段重置成默认值。
          json(200, { ok: true, settings: readSettings() }); return;
        }
        // 迁移前的护栏：字体值还没进字体集时，这次写入不得抹掉磁盘上的老字体值
        //（`withLegacyFontValues` 的完整理由见它的注释）。迁移落定后它自动失效。
        const persisted = withLegacyFontValues(sanitized);
        mergeSettings(persisted).then(
          (next) => json(200, { ok: true, settings: next }),
          (err) => json(500, { error: String(err && err.message ? err.message : err) }),
        );
      });
    },
  }));
}
