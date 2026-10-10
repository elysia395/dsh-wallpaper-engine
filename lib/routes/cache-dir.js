/**
 * cache-dir.js — 「缓存位置」这一条腿（`POST /cache-dir`）：把用户填的绝对路径校验后交给
 * 宿主的 `setCacheDir()`（落盘 config.json 的根字段 `cacheDir` + 默认迁移已有缓存）。
 *
 * 为什么需要它：插件的大块产物（transcodes 每个 80–280MB、faststart 变体 100MB–1GB、
 * 抓帧 / 缩略图）默认落在 `~/.dsh-wallpaper-engine/cache` —— 也就是**系统盘**。实测能到
 * 几个 GB，是"C 盘洁癖"用户唯一的真实痛点（设置 / 头像 / 字体那些小文件挪不挪无所谓）。
 * 缓存全是**可再生产物**，所以把根挪走后最坏结果只是重跑一次转码，不会丢用户数据。
 *
 * 不变量（与 `lib/routes/upload.js` 的 `/upload-dir` 同族 —— 那边是这套形态的样板）：
 *   · 只认**绝对路径**（`normalizeUserDir`：Windows 盘符 / UNC / POSIX，支持 `~` 展开）；
 *     路径必须能解析成目录：缺失则 `mkdir`（用户填的新盘符目录往往还不存在），
 *     存在但不是目录 ⇒ 400（**不能**让它当目录用，那会让缓存写到文件里）。
 *   · 收 body 必须有上限 + **收完一次性解码**（`bodyReader`，不逐块拼字符串）—— 判据是
 *     `test/verify-body-caps.mjs` 从磁盘枚举每一个 `req.on('data')` 站点。
 *   · **不得缓存缓存根的副本**：它是跨族共享可变量（`setCacheDir` 会改它），这里每次都问
 *     `cacheBaseDir()` —— 与 `/upload-dir` 对 `UPLOAD_DIR` 同一条纪律。
 *   · 注册返回值必须推进 `c.disposers`：否则卸载 / HMR 后路由仍挂着已释放的处理器。
 *   · 应答走 `lib/json-response.js` 的 `sendJson`（JSON 回复的**唯一**实现）。
 *
 * 另有一条只读腿 `GET /cache-dir/browse?path=…`：给设置页的「更改」弹出**目录浏览器**用。
 * 为什么由宿主列目录：设置页是网页，浏览器从不把绝对路径交给文件选择框（`<input type=file>`
 * 只给文件内容，拿不到路径字符串），而落盘迁移要的是**绝对路径** —— 所以"原生选择窗口"在这层
 * 拿不到，最接近的等价物是宿主列目录、用户在面板里点着进出。列表只含**目录名**（不列文件、
 * 不读内容），与 `/inventory` 回显安装路径同一档信任面。
 */

import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';
// 收 body 的**唯一缓冲实现**（累加 + 字节计闸 + 一次解码）—— 见 lib/http-body.js。
import { bodyReader } from '../http-body.js';
// JSON 应答的**唯一实现**（状态码 + 两个头 + end）—— 见 lib/json-response.js。
import { sendJson } from '../json-response.js';

export function registerCacheDirRoutes(webServer, c) {
  const {
    disposers, base: BASE, CONTROL_JSON_MAX_BYTES,
    normalizeUserDir, cacheBaseDir, setCacheDir, armBodyIdleTimeout,
  } = c;

  // 7b. 「缓存位置」（设置页：高级 → 缓存位置）。**只有 POST** —— 当前值经 /inventory 的
  //     `cacheDir` 字段下发（与 uploadDir 同形），所以这里不必再开一条 GET。
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/cache-dir`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') { res.statusCode = 405; res.end('method not allowed'); return; }

      let timedOut = false;
      let tooLarge = false;
      armBodyIdleTimeout(req, () => {
        timedOut = true;
        sendJson(res, 408, { error: 'request timeout' });
      });
      const reader = bodyReader(req, {
        maxBytes: CONTROL_JSON_MAX_BYTES,
        shouldStop: () => timedOut,
        onOverflow: () => {
          tooLarge = true;
          sendJson(res, 413, { error: 'payload too large' });
        },
      });
      req.on('data', reader.onData);

      req.on('end', () => {
        if (timedOut || tooLarge) return;
        const body = reader.text();
        let dirRaw = null;
        let migrate = true;
        try {
          const o = JSON.parse(body || '{}');
          dirRaw = o.dir;
          migrate = o.migrate !== false;
        } catch { /* 坏 JSON 交给 normalizeUserDir 判空 ⇒ 400 */ }

        const dir = normalizeUserDir(dirRaw);
        if (!dir) {
          sendJson(res, 400, { error: '请输入有效的绝对路径（如 D:\\WallpaperEngineCache 或 /data/we-cache）' });
          return;
        }
        // 目标可能是尚未存在的盘符目录（用户刚建好盘/新目录）⇒ 先建再判是不是目录。
        try { mkdirSync(dir, { recursive: true }); } catch { /* 下面 stat 会给出结论 */ }
        let isDir = false;
        try { isDir = statSync(dir).isDirectory(); } catch { isDir = false; }
        if (!isDir) {
          sendJson(res, 400, { error: '无法在该路径创建目录（权限不足或路径被占用）' });
          return;
        }
        // 迁移 + 落盘串行在 config 写队列里（见 setCacheDir 的两条 ⚠️：只搬已知缓存子目录、
        // 搬不动的留在原地不删）。
        // 回包里 `effective` 是**再次问解析链**得到的实际生效根，而不是把用户填的值回显：
        // 设了 `DSH_WE_CACHE_DIR` 时 env 优先于 config，两者会不一致 —— 客户端据
        // `effective !== cacheDir` 提示"当前由环境变量覆盖"，免得用户以为改了没生效。
        setCacheDir(dir, migrate).then((result) => {
          sendJson(res, 200, { ...result, effective: cacheBaseDir() });
        }, (err) => {
          sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
        });
      });

      req.on('error', () => { res.statusCode = 400; res.end('request error'); });
    },
  }));

  // 「更改」弹出目录浏览器的数据腿（`?path=…` → 那一级的**子目录**列表）。不带 path =
  // 根视图：列存在的盘符（Windows）/ 根（POSIX），附主目录 —— 用户从这里开始点。
  // 契约：应答 `{ current, parent, dirs: [{ name, path }], truncated }`（根视图另有 home）；
  // 点行 = 拿条目里的 `path` 再问下一级，客户端不做任何路径拼接（分隔符大小写都是宿主的口径）。
  // 判不了的 path（不存在 / 不是目录 / 无权读）一律 400 带原因，面板原样展示 —— 不猜、不回落。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/cache-dir/browse`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return; }
      let raw = '';
      try { raw = new URL(req.url || '/', 'http://x').searchParams.get('path') || ''; } catch { raw = ''; }
      const dir = normalizeUserDir(raw);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (!dir) {
        sendJson(res, 200, { current: '', parent: null, home: homedir(), dirs: listDriveRoots() });
        return;
      }
      let isDir = false;
      try { isDir = statSync(dir).isDirectory(); } catch { isDir = false; }
      if (!isDir) {
        sendJson(res, 400, { error: '该路径不是目录或不存在' });
        return;
      }
      let names = null;
      let readErr = null;
      try {
        names = readdirSync(dir, { withFileTypes: true })
          .filter((ent) => ent.isDirectory())
          .map((ent) => ent.name);
      } catch (err) {
        readErr = String(err && err.code ? err.code : (err && err.message ? err.message : err));
      }
      if (names === null) {
        sendJson(res, 400, { error: '无法读取该目录：' + readErr });
        return;
      }
      names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
      let truncated = false;
      if (names.length > BROWSE_MAX_ENTRIES) {
        names = names.slice(0, BROWSE_MAX_ENTRIES);
        truncated = true;
      }
      const atRoot = parse(dir).root === dir;
      sendJson(res, 200, {
        current: dir,
        parent: atRoot ? null : dirname(dir),
        dirs: names.map((name) => ({ name, path: join(dir, name) })),
        truncated,
      });
    },
  }));
}

/** 浏览列表的单次上限：再多设置面板也滚不动，超了带 `truncated` 标记，客户端提示。 */
const BROWSE_MAX_ENTRIES = 2000;

/** 根视图的条目：Windows 逐个 stat 盘符 A:\–Z:\（没有的/拨掉的盘 stat 会抛，跳过）；
 *  POSIX 只有 /。只列**存在的**目录根 —— 列出点不进去的盘是给用户添堵。 */
function listDriveRoots() {
  if (process.platform !== 'win32') return [{ name: '/', path: '/' }];
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i) + ':\\';
    try { if (statSync(letter).isDirectory()) out.push({ name: letter, path: letter }); } catch { /* 没有这个盘 */ }
  }
  return out;
}
