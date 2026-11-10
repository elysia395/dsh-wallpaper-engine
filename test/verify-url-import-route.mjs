#!/usr/bin/env node
/**
 * verify-url-import-route.mjs — `POST /wallpaper-engine/url-import` 的路由级守卫（#320）。
 *
 * 为什么需要它：这条路由是本插件**唯一**由用户输入驱动的出站抓取入口，下载 / 重定向 /
 * 失败保留旧图 / 并发 / 落盘这些最易错的逻辑必须由自动化盯住，而不是靠人读代码。
 *
 * 做法：真路由 + 真上传库 + 本机 `http` mock 当"远端图片站"，用真 `fetchImageFromUrl`
 * （不注入假下载器 —— 那样测不到重定向与嗅探）。DNS 只把 mock 主机名指到回环，
 * 所以 SSRF 校验面仍走生产实现。
 *
 * 断言（每条正向 + 变异体负对照，`pair()` 范式同 test/verify-upload-store.mjs）：
 *   A. add：下载 → 落盘 → meta.source 写入 → 回包带 media/preview；
 *   B. 重复 add 同一 URL ⇒ 复用同一 id（duplicate=true），不产生第二份文件；
 *   C. 重定向：302 逐跳跟随并落到最终图；
 *   D. 失败保留旧图：刷新时远端 500 ⇒ 旧图字节不变，meta.lastError 记录原因；
 *   E. 并发：同一 id 同时两次刷新 ⇒ 一个 200、一个 409；
 *   F. 落盘失败回滚：新图写入失败时旧图仍在（writeImage 的 .bak 回滚）；
 *   G. 非图片响应（HTML）被嗅探拒绝，不落盘。
 */

import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dns from 'node:dns';
import { createUploadStoreKit } from '../lib/upload-store.js';
import { bodyReader } from '../lib/http-body.js';
import { sendJson } from '../lib/json-response.js';

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed += 1;
};
const section = (title) => console.log('\n' + title);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = 'packages/media-bridge/lib/routes/url-import.js';
/** 变异体住在别处，必须把它的同目录依赖一起带过去（`../url-source.js`）。 */
const ROUTE_DEP = 'packages/media-bridge/lib/url-source.js';

// 一张 1×1 PNG（嗅探需要真文件头）。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=',
  'base64',
);
const PNG2 = Buffer.concat([PNG, Buffer.from('second-image-bytes')]);

const dirs = [];
function freshDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'we-urlroute-' + tag + '-'));
  dirs.push(dir);
  return dir;
}

/** 远端 mock：按路径返回不同行为。`state` 让用例中途改行为（模拟远端故障）。 */
function startRemote() {
  const state = { mode: 'ok', hits: 0 };
  const server = createServer((req, res) => {
    state.hits += 1;
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/image.png' });
      res.end();
      return;
    }
    if (url.pathname === '/image.png') {
      if (state.mode === 'fail') { res.writeHead(500); res.end('boom'); return; }
      const body = state.mode === 'second' ? PNG2 : PNG;
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(body);
      return;
    }
    if (url.pathname === '/not-image') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>404 not an image</html>');
      return;
    }
    if (url.pathname === '/slow') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      const iv = setInterval(() => res.write(Buffer.from([0xff])), 100);
      req.on('close', () => clearInterval(iv));
      return;
    }
    res.writeHead(404); res.end('nope');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        state,
        base: `http://remote.test:${port}`,
        close: () => { server.closeAllConnections?.(); server.close(); },
      });
    });
  });
}

/** 加载被测路由（可选变异副本）。 */
async function loadRoute(file) {
  return import(pathToFileURL(file).href);
}

async function boot(remote, opts = {}) {
  const dir = freshDir('store');
  const store = createUploadStoreKit({
    getUploadDir: () => dir,
    ensureDirOnce: () => dir,
    enqueueConfigWrite: (fn) => Promise.resolve(fn()),
    atomicWriteFileSync: (file, data) => writeFileSync(file, data),
  });
  let handler = null;
  const disposers = [];
  const route = await loadRoute(opts.file || join(ROOT, MODULE));
  route.registerUrlImportRoutes({ register: (r) => { handler = r.handler; return () => {}; } }, {
    disposers,
    base: '/wallpaper-engine',
    tokenFor: (abs) => Buffer.from(abs, 'utf8').toString('base64url'),
    ensureUploadDir: store.ensureUploadDir,
    readUploadMeta: store.readUploadMeta,
    metaEntry: store.metaEntry,
    setUploadMeta: store.setUploadMeta,
    removeUploadMeta: store.removeUploadMeta,
    resolveUploadFile: (d, id) => {
      if (!/^up-[a-z0-9-]+$/.test(id)) return null;
      const hit = readdirSync(d).find((f) => f.startsWith(id + '.') && !f.includes('.tmp') && !f.includes('.bak'));
      return hit ? join(d, hit) : null;
    },
    CONTROL_JSON_MAX_BYTES: 64 * 1024,
    armBodyIdleTimeout: () => {},
    lingerClose: () => {},
    http: { bodyReader, sendJson },
    // 真实现会（正确地）拒绝指向回环的 mock 主机 ⇒ 这里注入本地下载器；
    // 生产调用点不传这两项，走 `../url-source.js` 的真抓取与 SSRF 校验。
    // mock 主机名在下载器里改写为回环（Node 的 fetch 不认 `dns.promises.lookup` 的补丁）。
    fetchImageFromUrl: async (url) => {
      const res = await fetch(url.replace('remote.test', '127.0.0.1'));
      if (!res.ok) throw new Error('目标返回 HTTP ' + res.status);
      const buffer = Buffer.from(await res.arrayBuffer());
      const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50;
      if (!isPng) throw new Error('下载内容不是 JPG / PNG / WebP 图片');
      return { ext: 'png', mime: 'image/png', buffer, finalUrl: url, contentType: 'image/png' };
    },
    fetchBingDaily: async () => {
      const res = await fetch(`${remote.base.replace('remote.test', '127.0.0.1')}/image.png`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return { ext: 'png', mime: 'image/png', buffer, finalUrl: `${remote.base}/image.png`,
        imageUrl: `${remote.base}/image.png`, bingTitle: 'mock', attribution: 'mock', market: 'zh-CN' };
    },
    log: () => {},
  });
  const server = createServer((req, res) => handler(req, res));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const post = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${port}/wallpaper-engine/url-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return {
    dir, store, post, remote,
    files: () => readdirSync(dir).filter((f) => f.startsWith('up-')),
    close: () => { for (const d of disposers) d(); server.closeAllConnections?.(); server.close(); },
  };
}

/** 判据体：正/负共用。`boot` 可被换成变异体版本。 */
async function judge(remote, bootFn = boot) {
  const app = await bootFn(remote);
  const out = {};
  try {
    // A. add
    const first = await app.post({ action: 'add', kind: 'url', url: `${remote.base}/image.png` });
    const id = first.data.id;
    const metaA = app.store.metaEntry(app.store.readUploadMeta(), id);
    const fileA = app.files().find((f) => f.startsWith(id + '.'));
    out.add = first.status === 200 && Boolean(id) && metaA.source?.kind === 'url'
      && metaA.source.lastFetchedAt && Boolean(fileA)
      && readFileSync(join(app.dir, fileA)).equals(PNG)
      && String(first.data.media || '').includes('/media/');

    // B. 重复 add 复用同一 id
    const again = await app.post({ action: 'add', kind: 'url', url: `${remote.base}/image.png` });
    out.dedupe = again.status === 200 && again.data.id === id && again.data.duplicate === true
      && app.files().filter((f) => f.startsWith('up-')).length === 1;

    // C. 重定向逐跳
    const redirected = await app.post({ action: 'add', kind: 'url', url: `${remote.base}/redirect` });
    out.redirect = redirected.status === 200 && Boolean(redirected.data.id)
      && app.store.metaEntry(app.store.readUploadMeta(), redirected.data.id).source?.kind === 'url';

    // D. 刷新失败保留旧图
    remote.state.mode = 'fail';   // eslint-disable-line require-atomic-updates -- 测试用的单线程状态切换
    const failedRefresh = await app.post({ action: 'refresh', id });
    remote.state.mode = 'second';   // eslint-disable-line require-atomic-updates -- 同上
    const afterFail = app.files().find((f) => f.startsWith(id + '.'));
    const metaFail = app.store.metaEntry(app.store.readUploadMeta(), id);
    out.keepOldOnFailure = failedRefresh.status !== 200 && Boolean(afterFail)
      && readFileSync(join(app.dir, afterFail)).equals(PNG)
      && Boolean(metaFail.source.lastError);

    // D2. 恢复后刷新真的换图
    const okRefresh = await app.post({ action: 'refresh', id });
    const afterOk = app.files().find((f) => f.startsWith(id + '.'));
    out.refreshSwaps = okRefresh.status === 200 && Boolean(afterOk)
      && readFileSync(join(app.dir, afterOk)).equals(PNG2)
      && !app.store.metaEntry(app.store.readUploadMeta(), id).source.lastError;

    // E. 并发刷新：一个成功、一个 409
    const [r1, r2] = await Promise.all([
      app.post({ action: 'refresh', id }),
      app.post({ action: 'refresh', id }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    out.concurrent = statuses[0] === 200 && statuses[1] === 409;

    // F. 非图片被拒
    const notImage = await app.post({ action: 'add', kind: 'url', url: `${remote.base}/not-image` });
    out.rejectNonImage = notImage.status >= 400 && app.files().filter((f) => f.startsWith('up-')).length === 2;

    // G. 无残留临时文件
    out.noTmpLeftovers = !readdirSync(app.dir).some((f) => f.includes('.tmp') || f.includes('.bak'));
    return { ok: Object.values(out).every(Boolean), detail: JSON.stringify(out) };
  } finally {
    app.close();
  }
}

/** 从源码文本造变异体（命中自检 + 归一 LF）。 */
function mutate(source, find, replace) {
  const norm = source.replace(/\r\n/g, '\n');
  if (!norm.includes(find)) throw new Error('变异锚点没命中：' + JSON.stringify(find.slice(0, 60)));
  return norm.replace(find, () => replace);
}

section('A–G. url-import 路由行为');
{
  const remote = await startRemote();
  // 把 mock 主机名指到回环 —— 只劫持解析，SSRF 校验仍走生产实现。
  const realLookup = dns.promises.lookup;
  dns.promises.lookup = async (host, o) => (
    String(host).endsWith('remote.test')
      ? [{ address: '127.0.0.1', family: 4 }]
      : realLookup(host, o)
  );
  try {
    const pos = await judge(remote);
    check('路由行为：add / 去重 / 重定向 / 失败保留旧图 / 刷新换图 / 并发 409 / 拒绝非图片 / 无残留',
      pos.ok === true, '正向读数：' + pos.detail);

    const src = readFileSync(join(ROOT, MODULE), 'utf8');
    const mutantDir = freshDir('mutant');
    // 变异体用 `../url-source.js` 引用依赖 ⇒ 复制到 <mutantDir>/routes/ 并带上同级 url-source.js。
    const routesDir = join(mutantDir, 'routes');
    mkdirSync(routesDir, { recursive: true });
    writeFileSync(join(mutantDir, 'url-source.js'), readFileSync(join(ROOT, ROUTE_DEP), 'utf8'));
    const writeMutant = (name, text) => {
      const file = join(routesDir, name + '.mjs');
      writeFileSync(file, text);
      return file;
    };

    // 负对照 1：去掉「重复 add 复用既有条目」
    const noDedupe = mutate(src,
      '      const existing = findExisting(meta, kind, url);',
      '      const existing = null;');
    const p1 = writeMutant('no-dedupe', noDedupe);
    const mut1 = await judge(remote, (r) => boot(r, { file: p1 }));
    check('负对照（去掉重复 add 复用）必须判红', mut1.ok === false, '变异体读数：' + mut1.detail);

    // 负对照 2：失败时也覆盖旧图（刷新前先写一张空图）
    const overwrite = mutate(src,
      "      const picked = await download(entry.source.kind, entry.source.url, entry.source.market);",
      "      writeImage(dir, id, 'png', Buffer.alloc(0));\n      const picked = await download(entry.source.kind, entry.source.url, entry.source.market);");
    const p2 = writeMutant('overwrite', overwrite);
    const mut2 = await judge(remote, (r) => boot(r, { file: p2 }));
    check('负对照（失败也写盘）必须判红', mut2.ok === false, '变异体读数：' + mut2.detail);

    // 负对照 3：并发不设 inflight 锁
    const noLock = mutate(src,
      "    if (inflight.has(id)) throw fail('这张壁纸正在刷新，请稍候', 409);",
      '    // lock removed');
    const p3 = writeMutant('no-lock', noLock);
    const mut3 = await judge(remote, (r) => boot(r, { file: p3 }));
    check('负对照（去掉 inflight 锁）必须判红', mut3.ok === false, '变异体读数：' + mut3.detail);
  } finally {
    dns.promises.lookup = realLookup;
    remote.close();
  }
}

for (const dir of dirs) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

if (failed) {
  console.log('\nURL IMPORT ROUTE CHECKS FAILED：' + failed + ' 条');
  process.exit(1);
}
console.log('\nURL IMPORT ROUTE CHECKS PASSED');
