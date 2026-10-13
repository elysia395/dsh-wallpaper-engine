/**
 * routes/scene-frame.js — **场景帧服务族**路由：实时抓帧缓存（`/scene-frame`、`/scene-frame-cache`）
 * 与自定义画面管理（`/custom-frame`）。
 *
 * 为什么值得独立成文件：这三条路由是**帧缓存目录的读写双方** —— 一个写、一个读，
 * 且读的一方要按抓帧几何判"这张帧还是不是当前视口"。缓存键谁构造、几何谁判定、
 * 并发写谁去重 —— 这三个问题的答案都在一处，
 * 而**依赖写在签名上**（`c`）。
 *
 * 契约：`registerSceneFrameRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西。
 * 帧缓存与自定义画面的**服务层**仍留在 `lib/index.js`：它们被 `/inventory`（`buildInventory`）、
 * `/live-frame`、`/scene-video` 与 `/scene-audio` 共用，且 `CUSTOM_FRAME_EXT` 是
 * `test/verify-contracts.mjs` 从 `lib/index.js` 读取的**跨半边契约表**。它们的归属是那条依赖。
 *   · `disposers` / `base`        ← 清理句柄数组与路径前缀
 *   · `mediaMap`                   ← token → 绝对路径（12 条路由共用）
 *   · `trackStream` / `serveFile`   ← 流登记与静态发送（后者 11 条路由共用）
 *   · `sceneFrameSlot` / `gpuFrameFileFor` ← 槽位与 GPU 帧定位
 *   · `GPU_FRAME_MAX_BYTES` / `GPU_WRITE_INFLIGHT` ← 抓帧上限与按槽位的写去重
 *   · `pngSizeOf` / `looksLikePng` / `atomicWriteFileP` ← PNG 头解析、魔数校验、原子落盘
 *   · `customFrameDir` / `customFramePath` / `customIdFromAbs` / `CUSTOM_FRAME_EXT` / `CUSTOM_FRAME_MAX_BYTES`
 *   · `armBodyIdleTimeout` / `lingerClose` ← 请求体 idle 超时与"写应答后再断"的收尾
 *
 * 不变量：
 *   · **缓存键只有一处构造点**：`sceneFrameSlot` 复用 `sceneFrameCacheKey`，版本前缀只在后者里出现
 *     ⇒ 升版本才是一次改动（两处各拼一遍会让"写盘的产物"与"读取的路径"错位）。
 *   · **槽位只有两个字段、只有一个产物**：`{ key, gpuPath }` —— key 是并发写的去重锁键，
 *     gpuPath 是唯一的产物文件（实时抓帧 `<key>_gpu.png`）。**不要在槽位里加"看起来有用"
 *     的路径**：加一个就多一处会与键构造点漂移的拼接。
 *   · **档位语义归调用方**：值域 `{0, 4}`；档 4（用户 pin 的自定义封面）**豁免**抓帧，
 *     该豁免在本文件的 `variant === 4 ? null : …` 处判定 ⇒ **档 4 不解析槽位**
 *     （否则为一次永远不会被读的产物白做 `statSync` + `ensureFrameCacheDir()`）。
 *   · **并发写去重**：`GPU_WRITE_INFLIGHT` 按槽位键登记在途写；已有在途写 ⇒ 409 `gpu-frame-exists`，
 *     释放时只删自己那一条（`if (get(key) === write) delete`），否则会把后到的写踢掉。
 *   · **原子发布**：GPU 帧一律经 `atomicWriteFileP` 落盘 —— 半写的 PNG 会被当成有效帧服务出去。
 *   · **几何即新鲜度**：已有 GPU 帧时，命中判定按 PNG 头读出的宽高比（`X-WE-GPU-AR`）与当前视口比
 *     较，不符即视为陈旧并重抓；判不了就当"未知几何"保留并留痕。
 *   · `/custom-frame` 的 id 只接受 `^[A-Za-z0-9_-]{1,64}$`（路径分隔符与 `..` 进不来），
 *     写盘走 `.tmp` + rename，失败路径由 `lingerClose` 收尾（先写应答、再排空、等刷完才断）。
 *   · **写流必须有"中途放弃"的收口**：`req 'close'` 里（`completed`/`failed` 都未置位时）
 *     销毁写流并清 `.tmp`。只有 `ws 'close'`（且 `failed`）一条到达路径是不够的 —— 关弹窗 /
 *     断网时 `req 'end'`、`'error'`、超时都不发生，`failed` 永不置位 ⇒ 写流一直开着（未关闭的
 *     fd）且磁盘上留下一个 30MB 的 `.tmp`；而自定义画面目录的读取侧只认正式扩展名
 *     ⇒ 那种垃圾**看不见**，只会累积。`completed` 之后不得再销毁写流（否则发布回调不执行）。
 *   · **更换格式即清兄弟**：写 `id.<ext>` 之前先删同 id 的其它扩展名，否则旧文件会被优先命中。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载 / HMR 后路由仍挂着已释放的处理器。
 */

import { createReadStream, createWriteStream, existsSync, renameSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
// 收 body 的**唯一缓冲实现**（累加 + 字节计闸 + 一次解码）—— 见 lib/http-body.js。
// ⚠️ 本文件既用共享实现（GPU 帧 PUT / `/scene-frame-cache/...`）、又有一处**结构性豁免**
// （`/custom-frame` 边收边写流 + 背压），豁免的理由见 lib/http-body.js 文件头。
import { bodyReader } from '../http-body.js';
// JSON 应答的**唯一实现**（状态码 + 两个头 + end）—— 见 lib/json-response.js。
import { sendJson } from '../json-response.js';

export function registerSceneFrameRoutes(webServer, c) {
  const {
    disposers, base: BASE, mediaMap, trackStream, serveFile,
    GPU_FRAME_MAX_BYTES, GPU_WRITE_INFLIGHT,
    CUSTOM_FRAME_EXT, CUSTOM_FRAME_MAX_BYTES,
    armBodyIdleTimeout, atomicWriteFileP, customFrameDir, customFramePath, customIdFromAbs,
    gpuFrameFileFor, lingerClose, looksLikePng, pngSizeOf, sceneFrameSlot,
  } = c;

  // 出图来源（**唯一权威顺序**）：**实时抓帧**（`<key>_gpu.png`，由 live 渲染页
  // PUT 回填）优先；没有抓帧时回落到**用户导入的自定义画面**（`overrides/<id>.*`）；两者都没有
  // ⇒ 404（客户端走「空」态，状态行给出可判定原因）。
  // ⚠️ 这里**没有**「替作者猜一张图」的来源：拿不到上面两条就 404 —— 猜出来的糊图
  // 比诚实留空更糟。
  // 档位值域是 `{0 = 自动（求链头）, 4 = 强制自定义画面}`；其余值一律 **clamp 到 0**
  //（值域里的洞有意保留：档位号一经定义就不复用，因此不需要值域迁移）。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-frame`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const token = decodeURIComponent(pathname.slice(`${BASE}/scene-frame/`.length));
      const abs = mediaMap.get(token);
      if (!abs) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'unknown-token' }));
        return;
      }
      const vRaw = Number(new URL(req.url || '/', 'http://x').searchParams.get('v') || 0);
      const variant = vRaw === 4 ? 4 : 0;
      // `v=4` **豁免** GPU 抓帧：它是用户显式 pin 的来源，不被一张抓帧顶掉。
      // 豁免在这里判定 ⇒ 档 4 **连槽位都不解析**：槽位的唯一产物是抓帧，档 4 永远不会读它，
      // 而解析会白做一次 `statSync` + `ensureFrameCacheDir()`。
      const gpuFile = variant === 4 ? null : gpuFrameFileFor(sceneFrameSlot(abs));
      const customFile = () => {
        const p = customFramePath(customIdFromAbs(abs));
        return p && existsSync(p) ? p : null;
      };
      // HEAD：纯磁盘探测（绝不触发任何生成）—— 抓帧回填的客户端按它决定要不要抓帧：
      // 204 + `X-WE-GPU: 1`（已有抓帧，附 W/H/AR 几何头）· 204 + `0`（只有自定义画面）· 404 空槽。
      if (method === 'HEAD') {
        const file = gpuFile || customFile();
        if (!file) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'no-frame' }));
          return;
        }
        res.statusCode = 204;
        res.setHeader('X-WE-GPU', gpuFile ? '1' : '0');
        if (gpuFile) {
          // 抓帧几何（读 PNG 头，见 pngSizeOf）：客户端据此判断这张帧还是不是**当前视口**的构图
          // —— 不是就清掉按当前视口重抓（否则别的窗口/旧会话留下的帧会被 CSS cover 再裁一次）。
          const dim = pngSizeOf(gpuFile);
          if (dim) {
            res.setHeader('X-WE-GPU-W', String(dim.width));
            res.setHeader('X-WE-GPU-H', String(dim.height));
            res.setHeader('X-WE-GPU-AR', (dim.width / dim.height).toFixed(4));
          }
        }
        res.end();
        return;
      }
      const servePath = gpuFile || customFile();
      if (!servePath) {
        // 终端的语义分两种：`v=4` 是用户显式 pin 的来源失效（422，客户端要明示"自定义画面已失效"）；
        // 自动档则是诚实的"空"（404，客户端走 ⑤）。
        res.statusCode = variant === 4 ? 422 : 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: variant === 4 ? 'no-custom-frame' : 'no-frame' }));
        return;
      }
      res.setHeader('Content-Type', servePath.endsWith('.jpg') ? 'image/jpeg'
        : servePath.endsWith('.gif') ? 'image/gif'
          : servePath.endsWith('.webp') ? 'image/webp' : 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      trackStream(createReadStream(servePath), res);
    },
  }));

  // 3a-gpu. Live GPU 抓帧回填：PUT /scene-frame-cache/<token> —— live 渲染页
  //     首帧确认后由客户端抓渲染 canvas（preserveDrawingBuffer:true，父页面同源
  //     直读，无需渲染页配合）写回帧缓存槽位。GPU 帧存独立的 <key>_gpu.png
  //     （文件名即标记，可直接打开查看）；serve 优先级高于自定义画面。
  //     缓存唯一性：_gpu.png 已存在 → 409（每壁纸一份，不反复生成），写入在
  //     同 key 临界区内串行（并发 PUT 不会双双通过）。
  //     清除通道：DELETE（或 POST ?clear=1）删掉 _gpu.png —— 抓到黑帧/想要
  //     重新抓取时的唯一出路，删后 HEAD 回到 X-WE-GPU=0、PUT 可再写一次。
  //     token 白名单 = mediaMap，与 scene-frame 同一缓存键（档 0）。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/scene-frame-cache`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const url = new URL(req.url || '/', 'http://x');
      // 薄别名：保留调用点写法，实现收敛到 lib/json-response.js；**第四参 null 保行为** ——
      // 本条副本本来就不写 `Cache-Control`（见 lib/json-response.js 文件头"缓存头口径"）。
      const json = (code, payload) => sendJson(res, code, payload, null);
      let token;
      try {
        token = decodeURIComponent(url.pathname.slice(`${BASE}/scene-frame-cache/`.length));
      } catch {
        json(404, { error: 'unknown-token' }); return;
      }
      // DELETE 与 POST ?clear=1 等价（POST 是框架确定放行的方法，DELETE 实测
      // 前缀路由同样可达；两者都提供，避免依赖单一方法的可达性）。
      const wantsClear = method === 'DELETE' || (method === 'POST' && url.searchParams.get('clear') === '1');
      if (wantsClear) {
        const abs = mediaMap.get(token);
        if (!abs) { json(404, { error: 'unknown-token' }); return; }
        const slot = sceneFrameSlot(abs);
        let removed = false;
        try { unlinkSync(slot.gpuPath); removed = true; }
        catch (e) {
          // ENOENT = 本来就没有（幂等成功）；EACCES/EBUSY/EPERM 等 = **真的没删掉**，
          // 必须报错：否则客户端把「清除」当成功（面板行消失、提示已清除），而宿主
          // 照旧发 GPU 帧 —— 画面纹丝不动且没有任何反馈。
          if (!e || e.code !== 'ENOENT') {
            json(500, { ok: false, removed: false, error: 'unlink-failed', code: (e && e.code) || '' });
            return;
          }
        }
        json(200, { ok: true, removed });
        return;
      }
      if (method !== 'PUT') { json(405, { error: 'method not allowed' }); return; }
      const abs = mediaMap.get(token);
      if (!abs) { json(404, { error: 'unknown-token' }); return; }
      const chunks = [];
      let size = 0;
      let failed = false;
      const fail = (code, payload) => {
        if (failed) return;
        failed = true;
        json(code, payload);
        lingerClose(req, res);
      };
      armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
      const reader = bodyReader(req, {
        maxBytes: GPU_FRAME_MAX_BYTES,
        shouldStop: () => failed,
        onOverflow: () => fail(413, { error: 'frame too large' }),
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (failed) return;
        const body = reader.buf();
        // GPU 抓帧统一 PNG（客户端 canvas.toBlob('image/png')）：签名 + IHDR +
        // IEND + 长度下限，避免 9 字节假 PNG 永久占槽。
        if (!looksLikePng(body)) { json(415, { error: 'unsupported-format' }); return; }
        const slot = sceneFrameSlot(abs);
        // 唯一性闸与写盘同一临界区（按缓存键串行）：并发 PUT 只有一个能写，
        // 其余拿到 409（实测：无锁时两个 24MB PUT 都会 200）。
        const prev = GPU_WRITE_INFLIGHT.get(slot.key) || Promise.resolve();
        const write = prev
          .catch(() => { /* 前序失败不影响本次判定 */ })
          .then(async () => {
            if (existsSync(slot.gpuPath)) return { code: 409, payload: { error: 'gpu-frame-exists' } };
            await atomicWriteFileP(slot.gpuPath, body);
            return { code: 200, payload: { ok: true, bytes: body.length } };
          });
        GPU_WRITE_INFLIGHT.set(slot.key, write);
        write
          .then((r) => json(r.code, r.payload))
          .catch((err) => json(500, { error: String(err && err.message ? err.message : err) }))
          .finally(() => {
            if (GPU_WRITE_INFLIGHT.get(slot.key) === write) GPU_WRITE_INFLIGHT.delete(slot.key);
          });
      });
    },
  }));

  // 自定义画面管理：POST 导入（raw body，MIME 白名单，30MB 上限）/
  // GET 查看 / DELETE 清除；scene-frame ?v=4 消费同一 overrides 目录。
  disposers.push(webServer.register({
    kind: 'prefix',
    path: `${BASE}/custom-frame`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      const pathname = new URL(req.url || '/', 'http://x').pathname;
      const id = decodeURIComponent(pathname.slice(`${BASE}/custom-frame/`.length)).replace(/\/+$/, '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'bad-id' }));
        return;
      }
      if (method === 'GET') {
        const p = customFramePath(id);
        if (!p) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'not-set' }));
          return;
        }
        serveFile(p, req, res, false);
        return;
      }
      if (method === 'DELETE') {
        let removed = false;
        for (const e of ['png', 'jpg', 'webp']) {
          try { unlinkSync(join(customFrameDir(), id + '.' + e)); removed = true; } catch { /* ignore */ }
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, removed }));
        return;
      }
      if (method !== 'POST') {
        res.statusCode = 405; res.end('method not allowed'); return;
      }
      const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = CUSTOM_FRAME_EXT[ctype];
      if (!ext) {
        res.statusCode = 415;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: '不支持的格式：' + ctype + '（仅支持 JPG / PNG / WebP）' }));
        return;
      }
      const dir = customFrameDir();
      for (const e of ['png', 'jpg', 'webp']) {
        if (e !== ext) { try { unlinkSync(join(dir, id + '.' + e)); } catch { /* ignore */ } }
      }
      const target = join(dir, id + '.' + ext);
      const tmpAbs = target + '.tmp';
      const ws = createWriteStream(tmpAbs);
      let size = 0;
      let failed = false;
      let completed = false; // 请求已成功发布（.tmp 已 rename 成正式文件）
      let tmpCleaned = false; // 防重复清理
      const cleanupTmp = () => {
        if (tmpCleaned) return;
        tmpCleaned = true;
        try { unlinkSync(tmpAbs); } catch { /* ignore */ }
      };
      const fail = (code, payload) => {
        if (failed) return;
        failed = true;
        try { ws.destroy(); } catch { /* ignore */ } // 'close' 里 cleanupTmp
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
        lingerClose(req, res);
      };
      ws.on('error', () => fail(500, { error: 'write failed' }));
      ws.on('close', () => { if (failed) cleanupTmp(); });
      // 中途放弃（关弹窗 / 断网 / 离开页面）：不会走 req 'end' / 'error' / 超时，`failed` 也就
      // 永远不会置位 ⇒ 只靠 `ws 'close'` 到不了 cleanupTmp：写流一直开着（未关闭的 fd，直到
      // GC），磁盘上留下一个最多 30MB 的 `.tmp`。而 `customFramePath` / `listCustomFrameIds`
      // 只认 `.png|.jpg|.webp` ⇒ 它是**看不见的垃圾**，只会累积。这里照 upload.js 的同一形态收口。
      req.once('close', () => {
        if (completed || failed) return;
        failed = true;
        try { ws.destroy(); } catch { /* ignore */ } // 'close' 里 cleanupTmp
        cleanupTmp();
      });
      armBodyIdleTimeout(req, () => fail(408, { error: 'request timeout' }));
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > CUSTOM_FRAME_MAX_BYTES) { fail(413, { error: '图片过大（上限 30MB）' }); return; }
        if (!ws.write(c)) req.pause();
      });
      ws.on('drain', () => { if (!failed) req.resume(); });
      req.on('end', () => {
        if (failed) return;
        // 请求体已完整收到 ⇒ 临时文件自此由 ws.end 回调负责发布，req 'close' 不得再销毁写流
        //（销毁了回调就不会执行，文件永远停在 .tmp）。
        completed = true;
        ws.end(() => {
          try { renameSync(tmpAbs, target); } catch { fail(500, { error: 'publish failed' }); return; }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, id, bytes: size }));
        });
      });
    },
  }));
}
