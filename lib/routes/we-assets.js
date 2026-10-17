/**
 * routes/we-assets.js — **WE 官方素材源**族路由：只读素材端点（`/api/local-assets`）
 * 与它的配置端点（`/we-assets-dir`）。
 *
 * 为什么这两条是一族：它们回答的是同一个问题 —— "渲染页到哪去取官方像素"。一条是**消费面**
 * （渲染页按名取 `materials/**\/*.tex`），一条是**配置面**（设置 UI 写目录、探测可用性）。
 * 两者共用同一个可变真源 `WE_ASSETS_DIR` 与同一把探测谓词 `weAssetsAvailable()`：配置一改，
 * 消费端下一次请求立刻换源。把这层"配-用"关系放在一个文件里，才看得出它与设置的联动。
 *
 * 契约：`registerWeAssetsRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西。
 * **服务层与状态住在 `lib/we-assets.js`**：`WE_ASSETS_DIR` 被 `buildInventory` 读、被
 * `/inventory` 的 `weAssetsAvailable` 字段共用；扫描缓存 `weAssetsIndexCache` 被
 * `setWeAssetsDir` 清除 ⇒ 它们是全仓共用的状态，不是本族的私产（门面注入访问器）。
 *   · `disposers` / `base`        ← 清理句柄数组与路径前缀
 *   · `serveFile`                  ← 静态发送（Range 三分支 + HEAD）
 *   · `CONTROL_JSON_MAX_BYTES`     ← POST body 上限（读体器本身见下方 import —— 全仓约定：
 *                                     **用 `bodyReader` 的族自己 import**，不经 `c`，见 verify-body-caps）
 *   · `normalizeUserDir`           ← 用户输入目录的规范化（与 `/upload-dir` 同一把）
 *   · `setWeAssetsDir`             ← 写 config.json（串行化）+ 清扫描缓存
 *   · `listWeAssetNames`           ← `materials/**\/*.tex` 名称清单（60s 缓存）
 *   · `weAssetsAvailable`          ← "目录存在且含 `materials/`"的探测谓词
 *   · `WE_ASSETS_SOURCE_ID`        ← `roots[].id` 与 URL 首段（上游契约字面量 `'local'`）
 *   · `getWeAssetsDir`             ← ⚠️ **取当前值的函数，不是值本身**。`WE_ASSETS_DIR` 是
 *                                     **可变**模块状态（`setWeAssetsDir` 改写它）⇒ 传值快照
 *                                     会让"刚 POST 完却仍读旧值"。这是本族唯一需要"引用注入"
 *                                     的状态，其余全是常量或纯函数。
 *
 * 不变量：
 *   · **只读源**：素材属 WE 版权内容，只从用户本机路径只读取用，**绝不复制入库**
 *     （合规说明见 `lib/we-assets.js` 该族服务层的头部注释与上游 docs/COMPLIANCE.md）。
 *   · **配置端点先校验形态、再落盘**：必须存在且含 `materials/` 子目录；**不做任何文件迁移**。
 *   · **路径限定**：`resolve(root, rel)` 之后必须仍在素材根之内
 *     （`startsWith(root + sep)`）—— 这是拒绝 `..` 越界的**唯一**判据，不许放宽成 `includes`。
 *   · **未配置不是错误**：探测返回 `{ ok: false }`（200），渲染页静默回落程序化复刻。
 *   · `path` 必须是 `'/api/local-assets'` 这条**无前缀**字面量：它是上游渲染页的消费契约
 *     （renderer/src/local-assets.ts），不是本插件自己的 `/wallpaper-engine/...` 命名空间。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 */

import { statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
// 收 body 的**唯一实现**（累加 + 字节计闸 + 一次解码）—— 全仓约定：谁用谁 import，
// 不经 `c`（`verify-body-caps.mjs` 逐文件断言"用了它就得 import 它"）。
import { bodyReader } from '../http-body.js';
// JSON 应答的**唯一实现**（状态码 + 两个头 + end）—— 见 lib/json-response.js。
import { sendJson } from '../json-response.js';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'serveFile', 'CONTROL_JSON_MAX_BYTES', 'normalizeUserDir', 'setWeAssetsDir', 'listWeAssetNames', 'weAssetsAvailable', 'WE_ASSETS_SOURCE_ID', 'getWeAssetsDir'];

export function registerWeAssetsRoutes(webServer, c) {
  const {
    disposers, base: BASE, serveFile,
    CONTROL_JSON_MAX_BYTES, normalizeUserDir,
    setWeAssetsDir, listWeAssetNames, weAssetsAvailable,
    WE_ASSETS_SOURCE_ID, getWeAssetsDir,
  } = c;

  // 3c-3d. WE 官方素材端点（local-assets）—— 上游 WebWallGL 渲染页的消费契约
  //       （renderer/src/local-assets.ts；上游 dev server 在 host/wallpaper-host.ts
  //       实现同一接口，这里是等价的服务端实现）。渲染页只在 URL 带
  //       ?localAssets=1 时探测本端点，客户端仅在素材目录可用时加该参数
  //       （liveRenderUrl），故未配置素材的用户零请求。
  //       四种请求形：
  //         GET /api/local-assets                              → {ok, roots}
  //         GET /api/local-assets/local/materials/index.json   → {names}
  //         GET /api/local-assets/local/materials/<name>.tex   → 文件字节
  //         GET /api/local-assets/local/<rel>                  → 文件字节（fonts 后备）
  disposers.push(webServer.register({
    kind: 'prefix',
    path: '/api/local-assets',
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') { res.statusCode = 405; res.end('method not allowed'); return; }
      // 薄别名：保留调用点写法，实现收敛到 lib/json-response.js（默认带 no-store）。
      const jsonOut = (code, payload) => sendJson(res, code, payload);
      let rest;
      try {
        rest = new URL(req.url || '/', 'http://x').pathname.slice('/api/local-assets'.length);
      } catch { jsonOut(400, { error: 'bad request' }); return; }
      // 探测（渲染页 installLocalAssets 第一步）：ok=false 时渲染页静默回落
      // 程序化复刻 —— 未配置素材不是错误，是正常态。
      if (rest === '' || rest === '/') {
        const ok = weAssetsAvailable();
        jsonOut(200, { ok, roots: ok ? [{ id: WE_ASSETS_SOURCE_ID, dir: getWeAssetsDir() }] : [] });
        return;
      }
      if (!weAssetsAvailable()) { jsonOut(404, { ok: false, error: '素材目录未配置或不可用' }); return; }
      // 每次请求现取一次当前目录（配置端点可能刚改过它）。
      const root = getWeAssetsDir();
      let segs;
      try {
        segs = rest.replace(/^\/+/, '').split('/').filter(Boolean).map(decodeURIComponent);
      } catch { jsonOut(400, { error: '路径非法' }); return; }
      const id = segs.shift() || '';
      if (id !== WE_ASSETS_SOURCE_ID) { jsonOut(404, { error: `未知素材源：${id}` }); return; }
      const rel = segs.join('/');
      if (rel === 'materials/index.json') {
        jsonOut(200, { names: await listWeAssetNames(root) });
        return;
      }
      if (!rel) { jsonOut(400, { error: '路径非法' }); return; }
      // 路径限定：resolve 后必须仍在素材根之内（拒绝 .. 越界）。素材目录只读。
      const target = resolve(root, rel);
      if (!target.startsWith(root + sep)) { jsonOut(403, { error: 'forbidden' }); return; }
      let isFile = false;
      try { isFile = statSync(target).isFile(); } catch { /* ignore */ }
      if (!isFile) { jsonOut(404, { error: `素材不存在：${rel}` }); return; }
      serveFile(target, req, res, method === 'HEAD');
    },
  }));

  // 3c-3e. WE 官方资源路径设置：GET 返回当前配置与可用性；POST {dir} 设置
  //       （空串 / null 清除 → 回落程序化复刻）。只校验目录形态（存在且含
  //       materials/ 子目录），不做任何文件迁移 —— 素材是只读源。
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/we-assets-dir`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      // 薄别名：保留调用点写法，实现收敛到 lib/json-response.js；**第四参 null 保行为** ——
      // 本条副本本来就不写 `Cache-Control`（见 lib/json-response.js 文件头"缓存头口径"）。
      const jsonOut = (code, payload) => sendJson(res, code, payload, null);
      if (method === 'GET') {
        jsonOut(200, { dir: getWeAssetsDir(), available: weAssetsAvailable() });
        return;
      }
      if (method !== 'POST') { res.statusCode = 405; res.end('method not allowed'); return; }
      // 收 body 的两条不变量（权威表述见 lib/routes/upload.js 文件头）：
      //   ① **必须有上限** —— 逐块累加而不比较长度，异常大的请求会把宿主堆无界撑大；
      //   ② **必须一次性解码** —— 逐块 `body += chunk` 会把跨 TCP 分片的多字节码点切成 U+FFFD。
      // 这两件事的**唯一实现**在 `lib/http-body.js`。
      let tooLarge = false;
      const reader = bodyReader(req, {
        maxBytes: CONTROL_JSON_MAX_BYTES,
        onOverflow: () => { tooLarge = true; jsonOut(413, { error: 'payload too large' }); },
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (tooLarge) return;
        const body = reader.text();
        let dirRaw = null;
        try { dirRaw = JSON.parse(body || '{}').dir; } catch { /* ignore */ }
        if (dirRaw === '' || dirRaw === null) {
          setWeAssetsDir(null).then(
            () => jsonOut(200, { dir: null, available: false }),
            (err) => jsonOut(500, { error: String(err && err.message ? err.message : err) }),
          );
          return;
        }
        const dir = normalizeUserDir(dirRaw);
        if (!dir) {
          jsonOut(400, { error: '请输入有效的绝对路径（如 D:\\Steam\\steamapps\\common\\wallpaper_engine\\assets 或 ~/WE/assets）' });
          return;
        }
        let hasMaterials = false;
        try { hasMaterials = statSync(join(dir, 'materials')).isDirectory(); } catch { /* ignore */ }
        if (!hasMaterials) {
          jsonOut(400, { error: '该目录下没有 materials/ 子目录 —— 请指向 WE 安装目录的 assets 树（或其拷贝）' });
          return;
        }
        setWeAssetsDir(dir).then(
          async () => jsonOut(200, { dir, available: true, textures: (await listWeAssetNames(dir)).length }),
          (err) => jsonOut(500, { error: String(err && err.message ? err.message : err) }),
        );
      });
      req.on('error', () => {
        if (tooLarge) return; // 超限那条已经应答过，别二次应答
        res.statusCode = 400; res.end('request error');
      });
    },
  }));
}
