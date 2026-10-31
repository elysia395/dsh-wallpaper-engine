#!/usr/bin/env node
/**
 * verify-avatar-interval-and-rotation.mjs —— 三个用户可见行为的聚焦判据：
 *
 *  ① **头像出现间隔可调**（issue #231 第二轮）：`avatarAiRepeatRows` 是合法设置键
 *     （DEFAULTS / KINDS / 复位分组 / 序列化四处齐），面板有滑块，装饰层**现读设置**
 *     而不是读死常量 —— 否则"旋钮在那儿、拖了没反应"。
 *  ② **轮播间隔不再锁死 30 分钟**（issue #230）：`rotationInterval` 是 `DEFAULTS_ONLY`
 *     （不在 KINDS 里），所以任何调用点问 `schemaRange('rotationInterval')` 都会拿到
 *     `[undefined, undefined]` ⇒ `clampNum` 恒回落 30。判据扫源码：**零处**再问 KINDS，
 *     且所有钳制点都用 `ROTATION_INTERVAL_MIN/MAX`（schema 导出的那对真源）。
 *  ③ **「视频播完就换」档**（issue #230 后续诉求）：组字段 `trigger` 被规范化（旧档缺字段
 *     ⇒ `interval`）、`syncRotationTimer` 在该档**不计时**、`watchVideoState` 挂了 ended 分支、
 *     视频层在该档**关掉 loop**（loop 会让 ended 永不触发）。
 *
 * 为什么单独成文件：这三件事都是"看不出来坏没坏"的接线形态 —— 面板上的下拉还在、
 * 值也存得进去，但真正驱动行为的那个函数没读它。源码口径 + 一个小求值台就够钉住。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInventoryBuilder } from '../lib/inventory.js';
import { createImagePreviewKit } from '../lib/media/image-preview.js';
import { registerMediaBytesRoutes } from '../packages/media-bridge/lib/routes/media-bytes.js';
import { registerInventoryRoutes } from '../packages/media-bridge/lib/routes/inventory.js';
import { createServeKit } from '../lib/serve.js';
import { createUploadDirKit } from '../lib/upload-dir.js';
import { createUploadStoreKit } from '../lib/upload-store.js';
import { extOf } from '../lib/fs-paths.js';
import { createCheck, braceBody } from './tools/assert-harness.mjs';
import { stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { check, stats } = createCheck();
const norm = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => norm(readFileSync(join(ROOT, p), 'utf8'));

const schemaSrc = read('lib/settings-schema.js');
const clientSrc = read('src/client.js');
const avatarSrc = read('src/avatar-layer.js');
const extAvatarSrc = read('src/ext-avatar.js');
const tabsSrc = read('packages/media-bridge/src/wallpaper-rotation-section.js');
const videoSrc = read('src/video-layer.js');

// ── ① avatarAiRepeatRows 四处齐 + 面板滑块 + 装饰层现读 ──────────────────────
{
  const schemaMod = await import(new URL('../lib/settings-schema.js', import.meta.url).href);
  const inDefaults = schemaMod.DEFAULTS.avatarAiRepeatRows === 6;
  const inKinds = Boolean(schemaMod.KINDS.avatarAiRepeatRows)
    && schemaMod.KINDS.avatarAiRepeatRows.min === schemaMod.AVATAR_AI_REPEAT_MIN
    && schemaMod.KINDS.avatarAiRepeatRows.max === schemaMod.AVATAR_AI_REPEAT_MAX;
  const inMascotGroup = (schemaMod.SETTINGS_NAMESPACES.mascot || []).includes('avatarAiRepeatRows');
  const inExtensionsReset = schemaMod.RESET_TABS.extensions.includes('avatarAiRepeatRows');
  check('avatarAiRepeatRows：DEFAULTS / KINDS / 命名空间 / 页签复位四处齐（且是合法设置键）',
    inDefaults && inKinds && inMascotGroup && inExtensionsReset,
    'defaults=' + inDefaults + ' kinds=' + inKinds + ' ns=' + inMascotGroup + ' reset=' + inExtensionsReset);
  check('avatarAiRepeatRows：能过 serialize → sanitize 往返（不会在落盘时被丢掉）',
    (() => {
      const t = schemaMod.sanitizeFromSchema({ avatarAiRepeatRows: 11 }, 'client');
      return t.avatarAiRepeatRows === 11
        && schemaMod.serializeSettings({ avatarAiRepeatRows: 11 }).avatarAiRepeatRows === 11;
    })());
  // 越界 / 坏值 ⇒ 回落默认值（clampNum 语义：越界即默认，不是夹紧）
  check('avatarAiRepeatRows：越界与坏值回落默认（不把 0 / 999 / NaN 写进设置）',
    schemaMod.sanitizeFromSchema({ avatarAiRepeatRows: 0 }, 'client').avatarAiRepeatRows === 6
    && schemaMod.sanitizeFromSchema({ avatarAiRepeatRows: 999 }, 'client').avatarAiRepeatRows === 6
    && schemaMod.sanitizeFromSchema({ avatarAiRepeatRows: 'x' }, 'client').avatarAiRepeatRows === 6);
  check('面板：扩展页签有「助手头像间隔」滑块，量程取 schema 常量（不手写数字）',
    extAvatarSrc.includes('weT("助手头像间隔")')
    && /AVATAR_AI_REPEAT_MIN,\s*AVATAR_AI_REPEAT_MAX/.test(extAvatarSrc)
    && extAvatarSrc.includes('onAvatarAiRepeatRows'));
  check('装饰层：分组**现读设置**（avatarAiRepeatRows 读 selection），不是读死常量',
    avatarSrc.includes('function avatarAiRepeatRows(selLike)')
    && avatarSrc.includes('sel.avatarAiRepeatRows')
    && avatarSrc.includes('const repeatRows = avatarAiRepeatRows();')
    && avatarSrc.includes('aiSince >= repeatRows')
    // 兜底值必须与 schema 默认同值（否则"设置缺失"的机器上表现与默认档不一样）
    && /const AVATAR_AI_REPEAT_FALLBACK = 6;/.test(avatarSrc));
  // ⚠️ 判据读**剥掉注释**的源码：解释"别写成 schemaRange(...)"的注释本身会命中子串。
  check('处理器：onAvatarAiRepeatRows 走 schemaRange（改 KINDS 不会漏改第二处）',
    clientSrc.includes('function onAvatarAiRepeatRows(v, live)')
    && stripComments(clientSrc).includes('...schemaRange("avatarAiRepeatRows")')
    && clientSrc.includes('onAvatarSize, onAvatarRadius, onAvatarAiRepeatRows'));
}

// ── ② 轮播间隔不再锁死 30 分钟（issue #230）─────────────────────────────────
{
  // 根因判据：`rotationInterval` 是 DEFAULTS_ONLY（不在 KINDS），问 KINDS 必得 undefined。
  check('前提：rotationInterval 仍是 DEFAULTS_ONLY（不在 KINDS）—— 所以不能问 schemaRange',
    read('lib/settings-schema.js').includes("const DEFAULTS_ONLY = ['rotationInterval'")
    && !/^\s*rotationInterval:\s*\{\s*kind:/m.test(schemaSrc));
  // 同一理由：注释里那句"不要用 schemaRange(\"rotationInterval\")"不算调用。
  check('修复：src/** 里**零处**再对 rotationInterval 调 schemaRange',
    !stripComments(clientSrc).includes('schemaRange("rotationInterval")'));
  const clamps = [...clientSrc.matchAll(/clampNum\(\s*[^;]*?DEFAULTS\.rotationInterval\s*\)/g)].map((m) => m[0]);
  check('修复：所有轮播间隔钳制点都用 ROTATION_INTERVAL_MIN/MAX（' + clamps.length + ' 处）',
    clamps.length >= 3 && clamps.every((c) => c.includes('ROTATION_INTERVAL_MIN, ROTATION_INTERVAL_MAX')),
    clamps.join(' | '));
  check('真源：schema 导出那对常量，且 readRotationGroups 用它（宿主与客户端同一域）',
    schemaSrc.includes('const ROTATION_INTERVAL_MIN = 1, ROTATION_INTERVAL_MAX = 1440;')
    && schemaSrc.includes('clampNum(g.interval, ROTATION_INTERVAL_MIN, ROTATION_INTERVAL_MAX, fallbackInterval)'));
  // 行为：真跑 readRotationGroups，任意档位都要被保留（30 以外的值不再被吞掉）
  const schemaMod = await import(new URL('../lib/settings-schema.js', import.meta.url).href);
  const kinds = schemaMod.KINDS.rotationGroups;
  const mk = (interval) => ({ id: 'g', name: 'g', interval, order: 'sequence', wallpaperIds: ['a'] });
  const round = (interval) => {
    // readRotationGroups 不导出 ⇒ 走同一套消毒入口（rotationGroups 的 kind 就是 'groups'）
    const out = schemaMod.sanitizeFromSchema({ rotationGroups: [mk(interval)] }, 'client');
    return out.rotationGroups[0].interval;
  };
  const probes = [1, 5, 10, 30, 60, 120, 180, 600];
  const got = probes.map(round);
  check('行为：间隔消毒保留 1/5/10/30/60/120/180/600 全部档位（30 只是其中之一）',
    got.join(',') === probes.join(','), got.join(','));
  check('前提自检：rotationGroups 的 kind 仍是 groups（上面那条走的是真消毒路径）',
    kinds && kinds.kind === 'groups');
}

// ── ③ 「视频播完就换」档（issue #230 后续诉求）───────────────────────────────
{
  const schemaMod = await import(new URL('../lib/settings-schema.js', import.meta.url).href);
  const round = (trigger) => schemaMod.sanitizeFromSchema(
    { rotationGroups: [{ id: 'g', name: 'g', interval: 30, order: 'sequence', wallpaperIds: ['a'], trigger }] }, 'client'
  ).rotationGroups[0].trigger;
  check('trigger 规范化：videoEnd 保留 · interval 保留 · 缺字段/坏值 ⇒ interval',
    round('videoEnd') === 'videoEnd' && round('interval') === 'interval'
    && round(undefined) === 'interval' && round('nonsense') === 'interval');
  // 计时器：该档**不建**计时器（推进由 ended 驱动）
  const timerBody = braceBody(clientSrc, 'syncRotationTimer');
  check('syncRotationTimer：videoEnd 档不计时（在读 minutes 之前就 return）',
    timerBody.includes('group.trigger === "videoEnd"')
    && timerBody.indexOf('videoEnd') < timerBody.indexOf('window.setTimeout'),
    timerBody.slice(0, 240));
  // ended 分支：只在 videoEnd 档、只对当前壁纸的视频、且 loop 为假时推进
  check('watchVideoState：ended ⇒ 仅 videoEnd 档 + 当前视频壁纸 + 非 loop 才 beginRotationPrepare',
    clientSrc.includes('group.trigger !== "videoEnd"')
    && clientSrc.includes('beginRotationPrepare(new Set())')
    && clientSrc.includes('liveLog("rotation-video-end"'));
  const endedAt = clientSrc.indexOf('video.addEventListener("ended"');
  const endedBody = endedAt >= 0 ? clientSrc.slice(endedAt, endedAt + 1600) : '';
  check('ended 分支的三道门都在（videoEnd / 当前视频 / 非 loop）',
    endedBody.includes('video.loop') && endedBody.includes('cur.type !== "video"')
    && endedBody.includes('trigger !== "videoEnd"')
    && endedBody.includes('rotationCandidates().length < 2'));
  // 视频层：该档必须关 loop，否则 ended 永不触发
  check('视频层：videoEnd 档关掉 media.loop（loop 会让 ended 永不触发）',
    videoSrc.includes('activeRotationGroup')
    && videoSrc.includes('g.trigger === "videoEnd"')
    && /media\.loop\s*=/.test(videoSrc)
    && !/media\.loop = true;/.test(videoSrc));
  // 面板：编辑器与主行都有推进方式下拉，处理器进 ctx
  check('面板：编辑器与主行都能选推进方式（两个 select + 两个处理器进 ctx）',
    tabsSrc.includes('onEditTrigger') && tabsSrc.includes('onGroupTrigger')
    && tabsSrc.includes('weT("视频播完就换")') && tabsSrc.includes('weT("按间隔")')
    && tabsSrc.includes('weT("轮播推进方式")')
    && clientSrc.includes('function onEditTrigger(e)')
    && clientSrc.includes('const onGroupTrigger = (e) =>')
    && clientSrc.includes('onEditTrigger, onGroupChange, onGroupInterval, onGroupTrigger'));
  // 选中视频结束档时，已经上屏的那层要立刻换 loop 语义（否则要等下一次换壁纸才生效）
  check('切换推进方式会立刻改已上屏视频的 loop（不只影响下一次建层）',
    clientSrc.includes('media.loop = group.trigger !== "videoEnd"'));
}

// ── ④ 图片缩略图管线：真实清单 + HTTP 字节发送 + LRU（issue #240）───────────
{
  const parent = join(ROOT, '.test-cache', 'avatar-image-preview');
  mkdirSync(parent, { recursive: true });
  const iso = mkdtempSync(join(parent, 'run-'));
  const BASE = '/wallpaper-engine';
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');
  const thumbnail = Buffer.from('fixture-jpeg-preview');
  let sequence = 0;

  // node:http 直连 loopback，不走外网/代理；收完真实响应体才裁剪缓存。
  function send(origin, path, method = 'GET', headers = {}) {
    return new Promise((resolve, reject) => {
      const req = request(new URL(path, origin), { method, headers, agent: false }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.once('error', reject);
        res.once('aborted', () => reject(new Error('response aborted')));
        res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.setTimeout(5000, () => req.destroy(new Error('preview HTTP timeout')));
      req.once('error', reject);
      req.end();
    });
  }

  // 正向与变异体共用本判据，只替换生产工厂/路由；所有写盘均在 .test-cache。
  async function judgePreview(factory = createInventoryBuilder, register = registerMediaBytesRoutes) {
    const dir = join(iso, String(++sequence));
    const uploadsDir = join(dir, 'uploads');
    const ensureDirOnce = (p) => { mkdirSync(p, { recursive: true }); return p; };
    ensureDirOnce(uploadsDir);
    const source = join(uploadsDir, 'up-preview.png');
    writeFileSync(source, original);
    const pathExistsP = async (p) => existsSync(p);
    const uploads = createUploadDirKit({
      defaultUploadDir: uploadsDir, ensureDir: ensureDirOnce, pathExistsP,
      readProjectP: async () => null,
    });
    const store = createUploadStoreKit({ getUploadDir: uploads.getUploadDir, ensureDirOnce });
    const inputs = [];
    let ffmpegAvailable = true;
    let resolutions = 0;
    const kit = createImagePreviewKit({
      pluginDataDir: () => dir, ensureDirOnce,
      transcodeKit: {
        resolveFfmpeg: async () => {
          resolutions += 1;
          if (!ffmpegAvailable) throw new Error('fixture: ffmpeg unavailable');
          return 'fixture-ffmpeg';
        },
        spawnFfmpeg: async (ff, args) => {
          inputs.push({ source: args[args.indexOf('-i') + 1], filter: args[args.indexOf('-vf') + 1] });
          await new Promise((resolve) => { setImmediate(resolve); });
          writeFileSync(args[args.length - 1], thumbnail);
        },
      },
    });
    const thumb = kit.imageThumbPath(source);
    const mediaMap = new Map();
    const tokenFor = (abs) => {
      const token = Buffer.from(abs, 'utf8').toString('base64url');
      mediaMap.set(token, abs);
      return token;
    };
    const expectedPreview = `${BASE}/preview/${tokenFor(source)}`;
    const expectedMedia = `${BASE}/media/${tokenFor(source)}`;
    const log = { info() {}, warn() {}, error() {} };
    const mediaOriginApi = { observeAdapter() {}, mediaOriginBase: async () => '', ensureSceneMediaOrigin: async () => '' };
    // 每次新建 builder 模拟清单重载，绕过 3s TTL，但仍执行真实上传枚举与索引路径。
    const buildInventory = () => factory({
      log, BASE, tokenFor, mediaOriginApi, warmFaststart: async () => {},
      locateWallpaperEngineP: async () => null, owningLibrariesP: async () => [],
      enumerateWallpapersAsync: async () => [], scanSignatureP: async () => 'fixture',
      pathKey: (p) => p, listCustomFrameIds: () => new Set(), pathExistsP,
      mtimeOrNullP: async (p) => { try { return statSync(p).mtimeMs; } catch { return null; } },
      extOf, ensureUploadDir: store.ensureUploadDir, readUploadMeta: store.readUploadMeta,
      enumerateUploadsP: uploads.enumerateUploadsP, metaEntry: store.metaEntry,
      readPlaylistsP: async () => [], playlistItemId: () => null,
      readFoldersP: async () => [], foldersWithIds: () => [], weAssetsAvailable: () => false,
      getUploadDir: uploads.getUploadDir, getWeAssetsDir: () => '', cacheBaseDir: () => join(dir, 'cache'),
      imageThumbPath: kit.imageThumbPath, // 仅为恢复旧行为的负对照提供原依赖。
    })();
    const activeStreams = new Set();
    const { serveFile, serveLayout } = createServeKit({ activeStreams });
    const routes = [];
    const webServer = { register: (route) => { routes.push(route); return () => {}; } };
    const disposers = [];
    registerInventoryRoutes(webServer, { disposers, base: BASE, mediaOriginApi, buildInventory, componentsProbe: () => null });
    register(webServer, {
      disposers, base: BASE, serveFile, serveLayout, mediaMap, log,
      pinnedFaststartVariant: () => null, ensureImagePreview: kit.ensureImagePreview,
    });
    const server = createServer((req, res) => {
      const path = new URL(req.url, 'http://fixture').pathname;
      const route = routes.find((r) => r.kind === 'exact' ? path === r.path : path.startsWith(r.path + '/'));
      if (route) route.handler(req, res);
      else { res.statusCode = 404; res.end('unknown route'); }
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const origin = `http://127.0.0.1:${server.address().port}`;
      const inventory = async () => {
        const response = await send(origin, `${BASE}/inventory`);
        return { response, item: JSON.parse(response.body).wallpapers.find((w) => w.id === 'up-preview') };
      };
      const cold = await inventory();
      const coldInventory = cold.response.status === 200 && cold.item.preview === expectedPreview
        && cold.item.media === expectedMedia && !existsSync(thumb) && inputs.length === 0;
      const first = await Promise.all([send(origin, cold.item.preview), send(origin, cold.item.preview)]);
      const generated = first.every((r) => r.status === 200 && r.body.equals(thumbnail))
        && inputs.length === 1 && inputs[0].source === source
        && inputs[0].filter.includes(`min(${kit.IMAGE_PREVIEW_WIDTH},iw)`);
      const warm = await inventory();
      const savedUrl = warm.item.preview;
      const stableInventory = warm.response.status === 200 && savedUrl === expectedPreview
        && warm.item.media === expectedMedia && [...mediaMap.values()].every((p) => p === source);
      const before = await send(origin, savedUrl);
      const cached = before.status === 200 && before.body.equals(thumbnail) && inputs.length === 1;
      const head = await send(origin, savedUrl, 'HEAD');
      const conditional = await send(origin, savedUrl, 'GET', { 'If-None-Match': before.headers.etag });
      const revalidate = head.status === 200 && head.body.length === 0
        && Number(head.headers['content-length']) === thumbnail.length
        && before.headers['cache-control'] === 'private, max-age=0, must-revalidate'
        && conditional.status === 304 && conditional.body.length === 0;
      const rawBefore = await send(origin, warm.item.media);
      const range = await send(origin, warm.item.media, 'GET', { Range: 'bytes=1-5' });

      // 真调用启动清扫使用的 mtime-LRU，目标为最旧一项，保证它实际被删。
      const old = new Date('2000-01-01T00:00:00Z');
      utimesSync(thumb, old, old);
      for (let i = 0; i < kit.IMAGE_PREVIEW_CACHE_MAX; i += 1) {
        writeFileSync(join(kit.imageThumbDir(), `ip_${i.toString(16).padStart(24, '0')}.jpg`), thumbnail);
      }
      kit.pruneImagePreviewCache();
      const evicted = !existsSync(thumb) && existsSync(source)
        && readdirSync(kit.imageThumbDir()).length === kit.IMAGE_PREVIEW_CACHE_MAX;
      const spawnsBefore = inputs.length;
      const after = await send(origin, savedUrl); // 不重拉清单，重用淘汰前拿到的同一个 URL。
      const regenerated = after.status === 200 && after.body.equals(thumbnail)
        && existsSync(thumb) && inputs.length === spawnsBefore + 1 && inputs.at(-1).source === source;
      const rebuilt = await inventory();
      const stableAfterPrune = rebuilt.item.preview === expectedPreview && rebuilt.item.media === expectedMedia;

      rmSync(thumb, { force: true });
      ffmpegAvailable = false;
      const resolvesBefore = resolutions;
      const fallback = await send(origin, savedUrl);
      const missingFfmpeg = fallback.status === 200 && fallback.body.equals(original)
        && resolutions === resolvesBefore + 1 && !existsSync(thumb);
      const rawAfter = await send(origin, rebuilt.item.media);
      const mediaUnchanged = rawBefore.status === 200 && rawBefore.body.equals(original)
        && rawAfter.status === 200 && rawAfter.body.equals(original)
        && !rawBefore.headers.etag && !rawAfter.headers.etag && !rawAfter.headers['cache-control']
        && range.status === 206 && range.body.equals(original.subarray(1, 6))
        && range.headers['content-range'] === `bytes 1-5/${original.length}`;

      ffmpegAvailable = true;
      await kit.ensureImagePreview(source);
      const legacySpawns = inputs.length;
      const legacy = await send(origin, `${BASE}/preview/${tokenFor(thumb)}`);
      const noNestedThumbnail = legacy.status === 200 && legacy.body.equals(thumbnail)
        && inputs.length === legacySpawns && inputs.every((c) => c.source === source);
      const missing = await send(origin, `${BASE}/preview/unknown-token`);
      const post = await send(origin, expectedPreview, 'POST');
      const routeSemantics = missing.status === 404 && missing.headers['cache-control'] === 'no-store'
        && post.status === 405 && post.headers.allow === 'GET, HEAD';

      const keySource = join(dir, 'key.png');
      writeFileSync(keySource, original);
      const key1 = kit.imageThumbPath(keySource);
      const stamp = statSync(keySource);
      writeFileSync(keySource, Buffer.concat([original, Buffer.from('size-change')]));
      utimesSync(keySource, stamp.atime, stamp.mtime);
      const key2 = kit.imageThumbPath(keySource);
      utimesSync(keySource, stamp.atime, new Date(stamp.mtimeMs + 60000));
      const key3 = kit.imageThumbPath(keySource);
      const cacheKeys = key1 !== key2 && key2 !== key3
        && readdirSync(kit.imageThumbDir()).every((n) => !n.includes('.tmp'));
      return {
        coldInventory, generated, stableInventory, cached, revalidate, evicted, regenerated,
        stableAfterPrune, missingFfmpeg, mediaUnchanged, noNestedThumbnail, routeSemantics, cacheKeys,
        detail: `before=${before.status} evicted=${evicted} after=${after.status} fallback=${fallback.status} source=${existsSync(source)}`,
      };
    } finally {
      for (const stream of activeStreams) stream.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => { server.close(resolve); });
      for (const dispose of disposers) dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function replaceOnce(source, find, replacement) {
    if (source.split(find).length !== 2) throw new Error('preview mutant anchor must match once: ' + find);
    return source.replace(find, () => replacement);
  }

  async function loadMutant(name, source) {
    const file = join(iso, `${name}.mjs`);
    writeFileSync(file, source);
    return import(pathToFileURL(file).href);
  }

  try {
    const actual = await judgePreview();
    for (const [key, label] of Object.entries({
      coldInventory: '冷清单发布原图 token，枚举不生成缩略图',
      generated: '真实 HTTP 冷取图合流生成一次，输入原图且按 kit 宽度缩放',
      stableInventory: '已有缓存的清单仍发布原图 token，不注册缓存绝对路径',
      cached: '淘汰前 HTTP 200 返回缓存字节且不重复生成',
      revalidate: '预览保留 HEAD / ETag / 304 语义',
      evicted: '真实 mtime-LRU 确实淘汰目标，源图仍在',
      regenerated: '不重拉清单，旧 URL 在 LRU 后仍 HTTP 200 并从原图重建',
      stableAfterPrune: 'LRU 后重建清单的 preview / media 地址不变',
      missingFfmpeg: '缺 ffmpeg 时同一预览 URL HTTP 200 回原图字节',
      mediaUnchanged: '/media 始终原图，Range 字节与默认不缓存语义不变',
      noNestedThumbnail: '源图请求和历史缓存 token 均不生成缩略图的缩略图',
      routeSemantics: '未知 token 仍 404 no-store，非 GET / HEAD 仍 405',
      cacheKeys: '缓存键跟随源 size / mtime，生成结束无 tmp 残留',
    })) check('图片预览：' + label, actual[key] === true, actual.detail);

    const source = read('lib/inventory.js');
    let oldInventory = replaceOnce(source, "import { statSync } from 'node:fs';", "import { existsSync, statSync } from 'node:fs';");
    oldInventory = replaceOnce(oldInventory, 'export function createInventoryBuilder(c) {', `export function createInventoryBuilder(c) {
  function previewSourceAbs(w) {
    if (!w || w.type !== 'image') return w ? w.previewAbs : null;
    try {
      const thumb = typeof c.imageThumbPath === 'function' ? c.imageThumbPath(w.previewAbs) : null;
      if (thumb && existsSync(thumb)) return thumb;
    } catch { /* ignore */ }
    return w.previewAbs;
  }`);
    oldInventory = replaceOnce(oldInventory,
      '        preview: hasPreview\n          ? `${BASE}/preview/${tokenFor(w.previewAbs)}`',
      '        preview: hasPreview\n          ? `${BASE}/preview/${tokenFor(previewSourceAbs(w))}`');
    const old = await loadMutant('old-inventory', oldInventory);
    const broken = await judgePreview(old.createInventoryBuilder);
    check('负对照：恢复旧清单行为，同一个 LRU + HTTP 判据必须红（200 → 404，源图仍在）',
      broken.cached && broken.evicted && !broken.stableInventory && !broken.regenerated
      && broken.detail.includes('after=404'), broken.detail);

    const bytes = read('packages/media-bridge/lib/routes/media-bytes.js');
    const noFallback = await loadMutant('no-fallback', replaceOnce(bytes, 'serveFile(thumb || abs,', 'serveFile(thumb,'));
    const brokenFallback = await judgePreview(createInventoryBuilder, noFallback.registerMediaBytesRoutes);
    check('负对照：删除原图 fallback，缺 ffmpeg 的同一 HTTP 判据必须红',
      brokenFallback.regenerated && !brokenFallback.missingFfmpeg, brokenFallback.detail);
    const noThumbGuard = await loadMutant('no-thumb-guard', replaceOnce(bytes,
      'if (/[\\\\/]thumbs[\\\\/]ip_[0-9a-f]+\\.jpg$/i.test(String(abs || \'\'))) {', 'if (false) {'));
    const brokenNested = await judgePreview(createInventoryBuilder, noThumbGuard.registerMediaBytesRoutes);
    check('负对照：删除历史缓存 token 防重缩分支，同一输入追踪判据必须红',
      brokenNested.regenerated && !brokenNested.noNestedThumbnail, brokenNested.detail);
  } finally {
    rmSync(iso, { recursive: true, force: true });
  }
}

// #255②：「自动轮转」行只在**选中列表且不在编辑**时渲染；旧实现常驻，没列表时只显示一句
// 永远点不动的「请先选择或新建一个轮播列表」。
{
  const rotationSrc = read('packages/media-bridge/src/wallpaper-rotation-section.js');
  // 注释里的旧文案不算代码（本文件在 #255② 的说明里引用了旧提示原文）——用共享的
  // 字符串感知剥注释实现（verify-module-layout 禁止朴素块注释正则）。
  const rotationCode = stripComments(rotationSrc);
  const gatedCtl = (t) => t.includes('(sel.rotationGroupId && !editing) &&') && !t.includes('请先选择或新建一个轮播列表');
  check('#255② 「自动轮转」行按 sel.rotationGroupId && !editing 门控，旧提示分支已删',
    gatedCtl(rotationCode));
  const oldStyle = rotationCode
    .replace('(sel.rotationGroupId && !editing) && React.createElement("div", { className: "we-picker__ctl" },',
      'React.createElement("div", { className: "we-picker__ctl" },')
    .replace('ctlText(weT("自动轮转"),\n      playableCount < 2', 'ctlText(weT("自动轮转"),\n      !sel.rotationGroupId ? weT("请先选择或新建一个轮播列表") : playableCount < 2');
  check('#255② negative control: 恢复旧常驻行会被同一 detector 判红', !gatedCtl(oldStyle));
}

if (stats.failed) {
  console.error('AVATAR-INTERVAL + ROTATION CHECKS FAILED — ' + stats.failed + ' failed, ' + stats.passed + ' passed');
  process.exitCode = 1;
} else {
  console.log('ALL AVATAR-INTERVAL + ROTATION CHECKS PASSED (' + stats.passed + ')');
}
