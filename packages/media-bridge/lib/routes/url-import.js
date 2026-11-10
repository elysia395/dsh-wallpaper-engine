/**
 * routes/url-import.js — 图片 URL 导入 / 刷新（Bing 每日一图是内置源）。
 *
 * 契约：`registerUrlImportRoutes(webServer, c)`；`c` 是 media-bridge 的共享键集 +
 * 本组件会话的 `disposers`（登记返回值必须推进去，否则卸载后定时器与路由都还在）。
 *
 * 行为：
 *   · `POST ${BASE}/url-import`，JSON `{ action: 'add' | 'refresh', kind: 'url' | 'bing', url?, id? }`。
 *   · 下载成功后按普通自定义壁纸落盘（`up-*.<jpg|png|webp>`），并写 uploads/.meta.json 的
 *     `source` 记录；之后筛选 / 轮播 / 玻璃 / 视差全部沿用现有上传链路。
 *   · 失败保留旧图（新导入失败则不落盘）；自动刷新失败只把原因写进 `source.lastError`。
 *   · Bing 源每天自动刷新一次（本机日历日）；失败后一小时再试，避免网络故障时反复打 Bing。
 *   · 任意 URL 源只在用户点「添加 / 刷新」时联网，插件其余部分仍然离线可用。
 */

import { createHash } from 'node:crypto';
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchBingDaily, fetchImageFromUrl, sourceDue, titleFromUrl, validateSourceUrl,
} from '../url-source.js';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = [
  'disposers', 'base', 'tokenFor', 'ensureUploadDir', 'readUploadMeta', 'metaEntry', 'setUploadMeta',
  'removeUploadMeta', 'resolveUploadFile', 'CONTROL_JSON_MAX_BYTES', 'armBodyIdleTimeout', 'lingerClose',
  'http', 'log',
];

/** 定时器节奏：启动后稍等一次，之后每半小时看一遍（真正到期判断在 sourceDue）。 */
const FIRST_CHECK_DELAY_MS = 20 * 1000;
const CHECK_EVERY_MS = 30 * 60 * 1000;
const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp'];

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode: statusCode || 400 });
}

function messageOf(error) {
  return String(error && error.message ? error.message : error);
}

function newUploadId(meta) {
  for (;;) {
    const id = 'up-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    if (!meta[id]) return id;
  }
}

/** 原子覆盖同一 id 的图片；扩展名变化时清掉旧扩展名文件（id 不变 ⇒ 选择/轮播引用不失效）。 */
function writeImage(dir, id, ext, buffer) {
  const target = join(dir, id + '.' + ext);
  const tmp = target + '.tmp' + process.pid;
  writeFileSync(tmp, buffer);
  try {
    renameSync(tmp, target);
  } catch {
    try { unlinkSync(target); } catch { /* ignore */ }
    renameSync(tmp, target);
  }
  for (const oldExt of IMAGE_EXTENSIONS) {
    if (oldExt === ext) continue;
    const old = join(dir, id + '.' + oldExt);
    if (existsSync(old)) { try { unlinkSync(old); } catch { /* ignore */ } }
  }
  return target;
}

export function registerUrlImportRoutes(webServer, c) {
  const {
    disposers, base: BASE, tokenFor, ensureUploadDir, readUploadMeta, metaEntry, setUploadMeta,
    removeUploadMeta, resolveUploadFile, CONTROL_JSON_MAX_BYTES, armBodyIdleTimeout, lingerClose,
    http, log,
  } = c;
  const inflight = new Set();

  /** 读一个小 JSON 控制面请求体（上限 + 一次性解码，与 upload 族同一口径）。 */
  function readJsonBody(req, res, onDone) {
    let timedOut = false;
    let tooLarge = false;
    armBodyIdleTimeout(req, () => {
      timedOut = true;
      http.sendJson(res, 408, { error: 'request timeout' });      lingerClose(req, res);
    });
    const reader = http.bodyReader(req, {
      maxBytes: CONTROL_JSON_MAX_BYTES,
      shouldStop: () => timedOut,
      onOverflow: () => {
        tooLarge = true;
        http.sendJson(res, 413, { error: 'payload too large' });
      },
    });
    req.on('data', reader.onData);
    req.on('end', () => {
      if (timedOut || tooLarge) return;
      let body = {};
      try { body = JSON.parse(reader.text() || '{}'); } catch { /* ignore */ }
      onDone(body && typeof body === 'object' ? body : {});
    });
    req.on('error', () => { res.statusCode = 400; res.end('request error'); });
  }

  function publicEntry(id, title, source) {
    const dir = ensureUploadDir();
    const abs = resolveUploadFile(dir, id);
    const entry = { id, title, type: 'image', playable: true, urlSource: source || null };
    if (abs) {
      entry.media = `${BASE}/media/${tokenFor(abs)}`;
      entry.preview = `${BASE}/preview/${tokenFor(abs)}`;
    }
    return entry;
  }

  function findExisting(meta, kind, url) {
    for (const id of Object.keys(meta)) {
      const entry = metaEntry(meta, id);
      if (!entry.source) continue;
      if (kind === 'bing' && entry.source.kind === 'bing') return { id, entry };
      if (kind === 'url' && entry.source.kind === 'url' && entry.source.url === url) return { id, entry };
    }
    return null;
  }

  async function download(kind, url, market) {
    if (kind === 'bing') {
      const bing = await fetchBingDaily({ market: market || 'zh-CN' });
      return {
        image: bing,
        title: bing.bingTitle || 'Bing 每日一图',
        source: {
          kind: 'bing',
          url: bing.imageUrl,
          market: bing.market,
          attribution: bing.attribution || '',
        },
      };
    }
    const image = await fetchImageFromUrl(url);
    return {
      image,
      title: titleFromUrl(url) || 'URL 壁纸',
      source: { kind: 'url', url, market: '', attribution: '' },
    };
  }

  async function refreshEntry(id) {
    const dir = ensureUploadDir();
    const meta = readUploadMeta();
    const entry = metaEntry(meta, id);
    const oldAbs = resolveUploadFile(dir, id);
    if (!oldAbs) throw fail('壁纸文件不存在', 404);
    if (!entry.source) throw fail('这张壁纸不是 URL 源', 400);
    const now = new Date().toISOString();
    try {
      const picked = await download(entry.source.kind, entry.source.url, entry.source.market);
      writeImage(dir, id, picked.image.ext, picked.image.buffer);
      const sha = createHash('sha256').update(picked.image.buffer).digest('hex');
      const source = {
        ...entry.source,
        ...picked.source,
        lastAttemptAt: now,
        lastFetchedAt: now,
        lastError: '',
      };
      await setUploadMeta(id, entry.title, sha, { source });
      return { ...publicEntry(id, entry.title, source), refreshed: true };
    } catch (error) {
      const source = {
        ...entry.source,
        lastAttemptAt: now,
        lastError: messageOf(error).slice(0, 300),
      };
      // 保留旧图与旧 sha；只记账失败原因。写盘失败也不影响用户继续看旧图。
      await setUploadMeta(id, entry.title, entry.sha256, { source });
      throw error;
    }
  }

  async function refreshOnce(id) {
    if (inflight.has(id)) throw fail('这张壁纸正在刷新，请稍候', 409);
    inflight.add(id);
    try { return await refreshEntry(id); } finally { inflight.delete(id); }
  }

  async function addEntry(kind, url, requestedTitle) {
    const meta = readUploadMeta();
    const dir = ensureUploadDir();
    const existing = findExisting(meta, kind, url);
    if (existing) {
      if (resolveUploadFile(dir, existing.id)) {
        const result = await refreshOnce(existing.id);
        return { ...result, duplicate: true };
      }
      // 文件被用户手动删掉了：先清掉坏记录，再按新条目重新下载（否则每次添加都命中坏记录）。
      await removeUploadMeta(existing.id);
    }
    let picked;
    if (kind === 'bing') {
      picked = await download('bing', '');
    } else {
      validateSourceUrl(url);   // 早失败：协议 / 主机不合法直接 400
      picked = await download('url', url);
    }
    const id = newUploadId(meta);
    const title = (requestedTitle || picked.title || id).slice(0, 80);
    const now = new Date().toISOString();
    writeImage(dir, id, picked.image.ext, picked.image.buffer);
    const sha = createHash('sha256').update(picked.image.buffer).digest('hex');
    const source = {
      ...picked.source,
      lastAttemptAt: now,
      lastFetchedAt: now,
      lastError: '',
    };
    await setUploadMeta(id, title, sha, { source });
    return { ...publicEntry(id, title, source), duplicate: false };
  }

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/url-import`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Allow', 'POST');
        res.end('method not allowed');
        return;
      }
      readJsonBody(req, res, (body) => {
        const action = body.action === 'refresh' ? 'refresh' : 'add';
        const kind = body.kind === 'bing' ? 'bing' : 'url';
        const run = (async () => {
          if (action === 'refresh') {
            const id = typeof body.id === 'string' ? body.id.trim() : '';
            if (!id) throw fail('缺少壁纸 id', 400);
            return refreshOnce(id);
          }
          const url = typeof body.url === 'string' ? body.url.trim() : '';
          if (kind === 'url' && !url) throw fail('请输入图片 URL', 400);
          let checked = '';
          if (kind === 'url') {
            try { checked = validateSourceUrl(url).toString(); } catch (error) { throw fail(messageOf(error), 400); }
          }
          const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
          return addEntry(kind, checked, title);
        })();
        run.then(
          (payload) => http.sendJson(res, 200, payload),
          (error) => {
            http.sendJson(res, error && error.statusCode ? error.statusCode : 502, { error: messageOf(error) });
            lingerClose(req, res);
          },
        );
      });
    },
  }));

  /** 拉一遍所有到期的 Bing 源；串行执行，失败只记 meta，不影响其它源。 */
  let running = null;
  function refreshDueSources() {
    if (running) return running;
    running = (async () => {
      let meta;
      try { meta = readUploadMeta(); } catch { return; }
      const now = new Date();
      for (const id of Object.keys(meta)) {
        const entry = metaEntry(meta, id);
        if (!entry.source || !sourceDue(entry.source, now)) continue;
        if (inflight.has(id)) continue;
        try {
          await refreshOnce(id);
          log('URL 壁纸已自动刷新：' + id, 'info');
        } catch (error) {
          log('URL 壁纸自动刷新失败 ' + id + '：' + messageOf(error), 'warn');
        }
      }
    })().finally(() => { running = null; });
    return running;
  }

  const firstCheck = setTimeout(refreshDueSources, FIRST_CHECK_DELAY_MS);
  const everyCheck = setInterval(refreshDueSources, CHECK_EVERY_MS);
  if (typeof firstCheck.unref === 'function') firstCheck.unref();
  if (typeof everyCheck.unref === 'function') everyCheck.unref();
  disposers.push(() => {
    clearTimeout(firstCheck);
    clearInterval(everyCheck);
  });
}
