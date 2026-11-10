#!/usr/bin/env node
/**
 * verify-url-source.mjs — 图片 URL / Bing 每日一图源的守卫。
 *
 * 断言：
 *   A. SSRF 校验：回环 / 私网 / 链路本地 / 本地主机名全部拒绝，公网放行；
 *   B. 图片嗅探：只认 JPG / PNG / WebP 的文件头，HTML 错误页不当图片；
 *   C. Bing 归档解析：相对地址按 base 解析，标题 / 版权透传，缺地址即失败；
 *   D. 每日到期判断：当天不重复、失败后一小时退避、非 Bing 源不自动刷新；
 *   E. uploads/.meta.json 的 source 往返：写入、保留、清除三态正确；
 *   F. 上传目录枚举认 WebP（`up-*.webp` → image）；
 *   G. 基础工具：标题推导与本地日期键；
 *   H. 旧 `setUploadMeta(id, title, sha)` 的落盘形状**逐字不变**（不夹带空 source 字段）。
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUploadStoreKit } from '../lib/upload-store.js';
import { createUploadDirKit } from '../lib/upload-dir.js';
import {
  isBlockedHostname, isPrivateAddress, localDateKey, parseBingArchive, requestPinnedOnce, sniffImage,
  sourceDue, titleFromUrl, validateSourceUrl,
} from '../packages/media-bridge/lib/url-source.js';

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed += 1;
};
const section = (title) => console.log('\n' + title);
const tmpDirs = [];
function freshDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), 'we-url-' + tag + '-'));
  tmpDirs.push(dir);
  return dir;
}

section('A. SSRF 校验');
check('回环 IPv4 被拒', isPrivateAddress('127.0.0.1'));
check('私网 10/8 被拒', isPrivateAddress('10.1.2.3'));
check('私网 172.16/12 被拒', isPrivateAddress('172.20.0.1'));
check('私网 192.168/16 被拒', isPrivateAddress('192.168.1.1'));
check('链路本地 169.254/16 被拒', isPrivateAddress('169.254.1.1'));
check('回环 IPv6 被拒', isPrivateAddress('::1'));
check('IPv4 映射的 IPv6 回环被拒', isPrivateAddress('::ffff:127.0.0.1'));
check('IPv4 映射的 IPv6 十六进制回环被拒', isPrivateAddress('::ffff:7f00:1'));
check('TEST-NET-1 被拒', isPrivateAddress('192.0.2.1'));
check('链路本地 IPv6 被拒', isPrivateAddress('fe80::1'));
check('ULA IPv6 被拒', isPrivateAddress('fd00::1'));
check('公网 IPv4 放行', !isPrivateAddress('8.8.8.8'));
check('公网 IPv6 放行', !isPrivateAddress('2606:4700:4700::1111'));
check('6to4 内嵌回环被拒', isPrivateAddress('2002:7f00:0001::'));
check('6to4 内嵌私网被拒', isPrivateAddress('2002:c0a8:0101::'));
check('NAT64 内嵌回环被拒', isPrivateAddress('64:ff9b::7f00:1'));
check('NAT64 内嵌私网被拒', isPrivateAddress('64:ff9b::c0a8:101'));
check('Teredo 2001::/32 被拒', isPrivateAddress('2001::1'));
check('IPv6 组播被拒', isPrivateAddress('ff02::1'));
check('IPv6 文档段 2001:db8::/32 被拒', isPrivateAddress('2001:db8::1'));
check('IPv6 discard 100::/64 被拒', isPrivateAddress('100::1'));
check('IPv4-compatible 回环被拒', isPrivateAddress('::7f00:1'));
check('localhost 主机名被拒', isBlockedHostname('localhost'));
check('.local 主机名被拒', isBlockedHostname('printer.local'));
check('普通域名放行', !isBlockedHostname('www.bing.com'));
const urlOk = (raw) => { try { validateSourceUrl(raw); return true; } catch { return false; } };
check('https 公网 URL 放行', urlOk('https://www.bing.com/th?id=x.jpg'));
check('file:// 被拒', !urlOk('file:///etc/passwd'));
check('data: 被拒', !urlOk('data:image/png;base64,AAAA'));
check('127.0.0.1 URL 被拒', !urlOk('http://127.0.0.1/a.jpg'));
check('[::1] URL 被拒', !urlOk('http://[::1]/a.jpg'));
check('localhost URL 被拒', !urlOk('http://localhost/a.jpg'));
check('带用户名密码的 URL 被拒', !urlOk('https://u:p@example.com/a.jpg'));

section('B. 图片嗅探');
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
check('JPEG 头 → jpg', sniffImage(jpg)?.ext === 'jpg');
check('PNG 头 → png', sniffImage(png)?.ext === 'png');
check('WebP 头 → webp', sniffImage(webp)?.ext === 'webp');
check('HTML 错误页不被当成图片', sniffImage(Buffer.from('<html>404</html>')) === null);
check('GIF 不被接受', sniffImage(Buffer.from('GIF89a......')) === null);

section('C. Bing 归档解析');
{
  const picked = parseBingArchive({
    images: [{
      url: '/th?id=OHR.Test_1920x1080.jpg&rf=LaDigue',
      title: 'Test Image',
      copyright: '© Test / Bing',
    }],
  }, 'https://www.bing.com/HPImageArchive.aspx');
  check('相对地址解析为绝对地址',
    picked.imageUrl === 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&rf=LaDigue',
    picked.imageUrl);
  check('标题透传', picked.title === 'Test Image');
  check('版权透传', picked.attribution === '© Test / Bing');
  let threw = false;
  try { parseBingArchive({ images: [] }); } catch { threw = true; }
  check('缺图片地址即失败', threw);
}

section('D. 每日刷新到期判断');
{
  const now = new Date(2026, 10, 10, 12, 0, 0);
  const today = new Date(2026, 10, 10, 8, 0, 0).toISOString();
  const yesterday = new Date(2026, 10, 9, 8, 0, 0).toISOString();
  const tenMinutesAgo = new Date(2026, 10, 10, 11, 50, 0).toISOString();
  const twoHoursAgo = new Date(2026, 10, 10, 10, 0, 0).toISOString();
  check('非 Bing 源不自动刷新', !sourceDue({ kind: 'url', lastFetchedAt: yesterday }, now));
  check('今天已取过 → 不再取', !sourceDue({ kind: 'bing', lastFetchedAt: today }, now));
  check('昨天取过 → 到期', sourceDue({ kind: 'bing', lastFetchedAt: yesterday }, now));
  check('十分钟前失败过 → 退避', !sourceDue({ kind: 'bing', lastFetchedAt: yesterday, lastAttemptAt: tenMinutesAgo }, now));
  check('两小时前失败过 → 可重试', sourceDue({ kind: 'bing', lastFetchedAt: yesterday, lastAttemptAt: twoHoursAgo }, now));
  check('本地日期键稳定', localDateKey(now) === '2026-11-10', localDateKey(now));
}

section('D2. 慢速滴灌：绝对 deadline 覆盖读取阶段');
{
  // 每 120 ms 滴 1 字节：socket 空闲超时永远不会触发（每块都重置），只有绝对 deadline 能停。
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    const iv = setInterval(() => res.write(Buffer.from([0xff])), 120);
    req.on('close', () => clearInterval(iv));
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const started = Date.now();
  let message = '';
  try {
    await requestPinnedOnce(new URL(`http://127.0.0.1:${port}/drip.jpg`), { address: '127.0.0.1', family: 4 }, {
      deadline: Date.now() + 600,
      timeoutMs: 600,
      maxBytes: 1024,
    });
  } catch (error) {
    message = String(error && error.message);
  }
  const elapsed = Date.now() - started;
  server.closeAllConnections?.();
  server.close();
  check('滴灌响应在 deadline 内被中断（不是等 socket 空闲）', elapsed < 3000 && message === '请求超时',
    elapsed + 'ms / ' + message);
}

section('E. uploads/.meta.json 的 source 往返');
{
  const dir = freshDir('meta');
  const kit = createUploadStoreKit({
    getUploadDir: () => dir,
    ensureDirOnce: () => dir,
    enqueueConfigWrite: (fn) => Promise.resolve(fn()),
    atomicWriteFileSync: (file, data) => writeFileSync(file, data),
  });
  const source = {
    kind: 'bing', url: 'https://www.bing.com/th?id=x.jpg', market: 'zh-CN',
    lastFetchedAt: '2026-11-10T00:00:00.000Z', lastAttemptAt: '2026-11-10T00:00:00.000Z',
    lastError: '', attribution: '© Bing',
  };
  await kit.setUploadMeta('up-a', 'Title', 'sha1', { source });
  let entry = kit.metaEntry(kit.readUploadMeta(), 'up-a');
  check('source 写入并可读', entry.source && entry.source.kind === 'bing'
    && entry.source.url === 'https://www.bing.com/th?id=x.jpg'
    && entry.source.market === 'zh-CN' && entry.source.attribution === '© Bing');
  await kit.setUploadMeta('up-a', 'Title', 'sha2');
  entry = kit.metaEntry(kit.readUploadMeta(), 'up-a');
  check('普通重写保留 source', entry.source && entry.source.kind === 'bing' && entry.sha256 === 'sha2');
  await kit.setUploadMeta('up-a', 'Title', 'sha2', { source: null });
  entry = kit.metaEntry(kit.readUploadMeta(), 'up-a');
  check('显式 source:null 清除', entry.source === null);
  const legacy = kit.metaEntry({ old: 'Legacy' }, 'old');
  check('旧字符串条目 source 为 null', legacy.source === null && legacy.title === 'Legacy');
}

section('F. 上传目录枚举认 WebP');
{
  const dir = freshDir('webp');
  writeFileSync(join(dir, 'up-abc123.webp'), webp);
  const kit = createUploadDirKit({
    defaultUploadDir: dir,
    resolveUploadDir: () => dir,
    ensureDir: () => {},
    pathExistsP: async (p) => existsSync(p),
    moveFileP: async () => true,
    enqueueConfigWrite: (fn) => fn(),
    readConfig: () => ({}),
    writeConfig: () => {},
    readProjectP: async () => null,
    resolveSceneMainFileP: async () => null,
  });
  const list = await kit.enumerateUploadsP(dir);
  const hit = list.find((w) => w.id === 'up-abc123');
  check('up-*.webp 被枚举为 image', Boolean(hit) && hit.type === 'image', JSON.stringify(hit && hit.type));
  check('resolveUploadFile 认 WebP 路径', Boolean(kit.resolveUploadFile(dir, 'up-abc123')));
}

section('G. 标题与路径工具');
check('从 URL 推导标题', titleFromUrl('https://example.com/pics/Sunset.JPG') === 'Sunset');
check('无路径时退回主机名', titleFromUrl('https://example.com/') === 'example.com');

section('H. 旧 setUploadMeta 形状不变');
{
  const dir = freshDir('shape');
  const kit = createUploadStoreKit({
    getUploadDir: () => dir,
    ensureDirOnce: () => dir,
    enqueueConfigWrite: (fn) => Promise.resolve(fn()),
    atomicWriteFileSync: (file, data) => writeFileSync(file, data),
  });
  await kit.setUploadMeta('k', 'T', 'S');
  const raw = kit.readUploadMeta().k;
  check('新条目只有 title / sha256', JSON.stringify(raw) === JSON.stringify({ title: 'T', sha256: 'S' }), JSON.stringify(raw));
}

section('I. 长 URL 不被截断（否则刷新必失败）');
{
  const dir = freshDir('longurl');
  const kit = createUploadStoreKit({
    getUploadDir: () => dir,
    ensureDirOnce: () => dir,
    enqueueConfigWrite: (fn) => Promise.resolve(fn()),
    atomicWriteFileSync: (file, data) => writeFileSync(file, data),
  });
  const longUrl = 'https://example.com/' + 'a'.repeat(4096) + '.jpg';
  await kit.setUploadMeta('up-long', 'Long', 'sha', {
    source: { kind: 'url', url: longUrl, market: '', lastFetchedAt: '', lastAttemptAt: '', lastError: '', attribution: '' },
  });
  const stored = kit.metaEntry(kit.readUploadMeta(), 'up-long').source.url;
  check('超长直链原样保存（不截断）', stored === longUrl, 'len=' + stored.length);
}

for (const dir of tmpDirs) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

if (failed) {
  console.log('\nURL source guard FAILED：' + failed + ' 条');
  process.exit(1);
}
console.log('\nURL source guard PASS');
