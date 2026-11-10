/**
 * url-source.js — 图片 URL / Bing 每日一图的**安全抓取层**（仅宿主侧使用）。
 *
 * 不变量：
 *   · 只允许 http / https；拒绝回环、私网、链路本地与常见内网主机名。
 *   · 重定向**每一跳**重新校验；连接固定到已校验的 IP（SNI / Host 仍用原主机名），
 *     避免 DNS 重绑定把已校验的主机名解析到私网地址。
 *   · 有上限：单响应字节数、总时长、重定向次数；超限一律抛错，调用方保留旧图。
 *   · 不信任 Content-Type：按文件头嗅探 JPG / PNG / WebP —— 错误页不会被当成图片落盘。
 *
 * 本模块只 import `node:*`，不碰上传目录也不写 meta：那些是路由族的职责。
 */

import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/** 单张图片上限（Bing 4K 原图通常 < 5 MB，32 MB 留足余量）。 */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** Bing 归档 JSON 上限。 */
export const MAX_JSON_BYTES = 1024 * 1024;
/** 最多跟随的重定向跳数。 */
export const MAX_REDIRECTS = 5;
/** 单次抓取的总时长预算（含所有重定向跳）。 */
export const FETCH_TIMEOUT_MS = 20000;

/** Bing 每日一图归档接口（返回 { images: [{ url, title, copyright }] }）。 */
export const BING_IMAGE_ARCHIVE = 'https://www.bing.com/HPImageArchive.aspx';

const BLOCKED_HOSTS = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.home.arpa'];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function stripBrackets(hostname) {
  return String(hostname || '').replace(/^\[|\]$/g, '');
}

/**
 * Whether an IP literal points at a loopback / private / link-local / reserved range.
 * Non-IP strings are treated as blocked (callers resolve hostnames separately).
 */
export function isPrivateAddress(address) {
  const raw = String(address || '').trim();
  if (!net.isIP(raw)) return true;
  if (net.isIPv4(raw)) {
    const p = raw.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;                 // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;        // private
    if (a === 192 && b === 168) return true;                 // private
    if (a === 192 && b === 0 && p[2] === 0) return true;     // 192.0.0.0/24 special
    if (a === 192 && b === 0 && p[2] === 2) return true;     // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true;    // benchmarking
    if (a === 198 && b === 51 && p[2] === 100) return true;  // TEST-NET-2
    if (a === 203 && b === 0 && p[2] === 113) return true;   // TEST-NET-3
    if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT
    if (a >= 224) return true;                                // multicast / reserved
    return false;
  }
  const ip = raw.toLowerCase().split('%')[0];
  if (ip === '::' || ip === '::1') return true;
  if (/^fe[89ab]/.test(ip)) return true;                     // fe80::/10 link-local
  if (/^f[cd]/.test(ip)) return true;                        // fc00::/7 unique-local
  if (ip.startsWith('::ffff:')) {
    const tail = ip.slice(7);
    if (net.isIPv4(tail)) return isPrivateAddress(tail);
    // hex 形式（::ffff:7f00:1）：按最后 32 位还原成 IPv4 再判。
    const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (!m) return true;
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (ip.startsWith('::') && net.isIPv4(ip.slice(2))) return isPrivateAddress(ip.slice(2));
  return false;
}

/** Reject obvious local hostnames before spending a DNS lookup. */
export function isBlockedHostname(hostname) {
  const h = stripBrackets(hostname).toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (BLOCKED_HOSTS.has(h)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * Parse and validate a user-supplied URL. Throws a user-readable error on
 * anything that is not a plain public http(s) URL.
 */
export function validateSourceUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw new Error('URL 格式不正确'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 http / https URL');
  if (url.username || url.password) throw new Error('URL 不能带用户名或密码');
  const host = stripBrackets(url.hostname);
  if (isBlockedHostname(host)) throw new Error('拒绝访问本机或内网主机');
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error('拒绝访问私网地址');
  return url;
}

/** Resolve a hostname and reject if **any** answer is private. */
export async function resolvePublicAddresses(hostname) {
  const host = stripBrackets(hostname);
  let list;
  try { list = await dns.lookup(host, { all: true, verbatim: true }); } catch { throw new Error('域名解析失败'); }
  if (!Array.isArray(list) || !list.length) throw new Error('域名解析失败');
  for (const item of list) {
    if (isPrivateAddress(item.address)) throw new Error('拒绝访问私网地址');
  }
  return list;
}

/**
 * One HTTP request pinned to an already-validated address. Redirects are
 * returned to the caller (never followed here) so every hop is re-validated.
 */
function requestOnce(urlObj, address, opts) {
  return new Promise((resolve, reject) => {
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : http;
    const hostname = stripBrackets(urlObj.hostname);
    const req = mod.request({
      protocol: urlObj.protocol,
      host: address.address,
      family: address.family,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        Host: urlObj.host,
        'User-Agent': 'dsh-wallpaper-engine/1 (+https://github.com/elysia395/dsh-wallpaper-engine)',
        Accept: opts.accept || 'image/*,*/*;q=0.8',
        'Accept-Encoding': 'identity',
      },
      ...(isHttps ? { servername: hostname, rejectUnauthorized: true } : {}),
      timeout: opts.timeoutMs,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ status, location: String(res.headers.location) });
        return;
      }
      if (status !== 200) {
        res.resume();
        resolve({ status });
        return;
      }
      const chunks = [];
      let size = 0;
      let aborted = false;
      res.on('data', (chunk) => {
        if (aborted) return;
        size += chunk.length;
        if (size > opts.maxBytes) {
          aborted = true;
          req.destroy(new Error('响应过大'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (aborted) return;
        resolve({
          status,
          body: Buffer.concat(chunks),
          contentType: String(res.headers['content-type'] || ''),
        });
      });
      res.on('error', (err) => { if (!aborted) reject(err); });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

/** Fetch a URL with redirect / size / time limits; returns the final body. */
async function fetchBuffer(rawUrl, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : FETCH_TIMEOUT_MS;
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : MAX_IMAGE_BYTES;
  const maxRedirects = Number.isInteger(opts.maxRedirects) ? opts.maxRedirects : MAX_REDIRECTS;
  const deadline = Date.now() + timeoutMs;
  let current = validateSourceUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('请求超时');
    const addresses = await resolvePublicAddresses(current.hostname);
    const res = await requestOnce(current, addresses[0], {
      ...opts,
      maxBytes,
      timeoutMs: Math.min(remaining, timeoutMs),
    });
    if (res.location) {
      const next = new URL(res.location, current).toString();
      current = validateSourceUrl(next);   // 每一跳都重新校验
      continue;
    }
    if (res.status !== 200) throw new Error('目标返回 HTTP ' + res.status);
    if (!res.body || !res.body.length) throw new Error('目标返回空内容');
    return { body: res.body, finalUrl: current.toString(), contentType: res.contentType || '' };
  }
  throw new Error('重定向次数过多');
}

/** Sniff a real image type from magic bytes; null when it is not JPG / PNG / WebP. */
export function sniffImage(buffer) {
  const buf = buffer;
  if (!buf || !buf.length) return null;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.length >= 12
    && buf.toString('ascii', 0, 4) === 'RIFF'
    && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

/** Download one image URL and return its bytes plus sniffed type. */
export async function fetchImageFromUrl(rawUrl, opts = {}) {
  const got = await fetchBuffer(rawUrl, { ...opts, maxBytes: opts.maxBytes || MAX_IMAGE_BYTES });
  const kind = sniffImage(got.body);
  if (!kind) throw new Error('下载内容不是 JPG / PNG / WebP 图片');
  return { ...kind, buffer: got.body, finalUrl: got.finalUrl, contentType: got.contentType };
}

/** Pick the first image out of a Bing archive response. */
export function parseBingArchive(json, baseUrl) {
  const image = json && Array.isArray(json.images) ? json.images[0] : null;
  const rel = image && (typeof image.url === 'string' && image.url
    ? image.url
    : (typeof image.urlbase === 'string' ? image.urlbase : ''));
  if (!rel) throw new Error('Bing 返回内容缺少图片地址');
  return {
    imageUrl: new URL(rel, baseUrl || 'https://www.bing.com').toString(),
    title: typeof image.title === 'string' ? image.title.slice(0, 80) : '',
    attribution: typeof image.copyright === 'string' ? image.copyright.slice(0, 200) : '',
  };
}

/** Fetch today's Bing image (archive JSON first, then the image itself). */
export async function fetchBingDaily(opts = {}) {
  const market = typeof opts.market === 'string' && opts.market.trim() ? opts.market.trim() : 'zh-CN';
  const api = new URL(BING_IMAGE_ARCHIVE);
  api.searchParams.set('format', 'js');
  api.searchParams.set('idx', '0');
  api.searchParams.set('n', '1');
  api.searchParams.set('mkt', market);
  const got = await fetchBuffer(api.toString(), {
    ...opts,
    maxBytes: MAX_JSON_BYTES,
    accept: 'application/json',
  });
  let json;
  try { json = JSON.parse(got.body.toString('utf8')); } catch { throw new Error('Bing 返回值不是 JSON'); }
  const picked = parseBingArchive(json, got.finalUrl);
  const image = await fetchImageFromUrl(picked.imageUrl, opts);
  return {
    ...image,
    imageUrl: picked.imageUrl,
    bingTitle: picked.title,
    attribution: picked.attribution,
    market,
  };
}

/** Local calendar day key (`YYYY-MM-DD`) used for once-a-day refresh. */
export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/**
 * Whether a Bing source is due for its daily refresh. Failed attempts back off
 * for an hour so a broken network does not hammer Bing on every timer tick.
 */
export function sourceDue(source, now) {
  if (!source || source.kind !== 'bing') return false;
  const at = now instanceof Date ? now : new Date(now || Date.now());
  const lastFetch = Date.parse(source.lastFetchedAt || '');
  if (Number.isFinite(lastFetch) && localDateKey(new Date(lastFetch)) === localDateKey(at)) return false;
  const lastAttempt = Date.parse(source.lastAttemptAt || '');
  if (Number.isFinite(lastAttempt) && at.getTime() - lastAttempt < 60 * 60 * 1000) return false;
  return true;
}

/** Derive a readable wallpaper title from the last path segment of a URL. */
export function titleFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const last = url.pathname.split('/').filter(Boolean).pop() || '';
    const base = decodeURIComponent(last).replace(/\.[a-z0-9]{1,5}$/i, '').trim();
    return (base || url.hostname).slice(0, 80);
  } catch { return ''; }
}
