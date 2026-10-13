/**
 * provision.js — 预编译 media-bridge 产物（Rust 系统媒体中间件）的解析与按需下载。
 *
 * 中间件不是 npm 依赖，也没有自己的包名可以挂 optionalDependencies（这个插件在
 * npm 上的那个名字不是本仓库发的），所以产物只能**首次使用时按需取**：解析链每一
 * 级失败就落到下一级，全失败由上层回落 legacy 实现（见 lib/media/index.js）。
 *
 *   1. 环境变量 `DSH_WE_MEDIA_BRIDGE`        ← 开发/自备产物（指向可执行文件）
 *   2. 插件目录旁的 `bin/<asset>`             ← 想随包分发就放这
 *   3. `<dataDir>/bin/media-bridge/<tag>/<asset>` ← 下载缓存（跑过一次就有）
 *   4. 从 GitHub Release 下载（sha256 固定，见 MEDIA_BRIDGE_SHA256）
 *
 * 产物名对齐 Node 的 process.platform / process.arch；平台映射见
 * MEDIA_BRIDGE_ASSETS。Linux x64 选 **musl 静态版**（无 glibc 下限，Alpine/老发行
 * 版都能跑）；arm64 只有 gnu 版（需 glibc ≥ 2.34）；Windows 发 x64 就够覆盖
 * ARM64（系统自带模拟），原生 ARM64 也一并支持。
 *
 * 为什么不去共用 lib/index.js 里那套 ffmpeg 下载器：那套与 ffmpeg 的命名/路径/
 * 进度上报（transcode job）耦合在一起，且被自检脚本按字符串断言着；这里只做
 * 「取一个文件并校验」，刻意保持独立、不牵扯转码那条链路。
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, chmodSync, statSync,
         openSync, closeSync, writeSync, readSync, fsyncSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
/** 插件根目录：本文件在 lib/media/ 下。 */
const PLUGIN_ROOT = resolve(SELF_DIR, '..', '..');

/** 中间件版本（与 media-bridge 的 git tag / Release 一致）。升级要连带更新哈希。 */
export const MEDIA_BRIDGE_TAG = 'v0.1.5';

/** process.platform → process.arch → Release 附件名。 */
export const MEDIA_BRIDGE_ASSETS = {
  darwin: {
    arm64: 'media-bridge-darwin-universal',
    x64: 'media-bridge-darwin-universal',
  },
  win32: {
    x64: 'media-bridge-win32-x64.exe',
    arm64: 'media-bridge-win32-arm64.exe',
  },
  linux: {
    // x64 走 musl 静态包：不依赖 glibc 版本，装不上 glibc 依赖的发行版也能用。
    x64: 'media-bridge-linux-x64-musl',
    arm64: 'media-bridge-linux-arm64',
  },
};

/**
 * 每个附件的 sha256（来自 Release 的 SHA256SUMS，已核对 v0.1.5）。
 * 下载后先过哈希再落盘执行；缺一条就不下载（宁可回落 legacy，也不执行未校验的二进制）。
 */
export const MEDIA_BRIDGE_SHA256 = {
  'media-bridge-darwin-universal': '3b73d368ba49e803dd58587759c6253e2acdf87a34ff046a63ca90303bb0cb1a',
  'media-bridge-win32-x64.exe': '61a7f6dd5d9b012aceebc4180d9b429b17cd519764c92ea217acf3e63407ee0c',
  // media-bridge-win32-arm64.exe：v0.1.5 仍未提供（CI 里是可选产物）→ Windows ARM64 走 x64 回落
  'media-bridge-linux-x64-musl': 'd97d02ad66f674cca170c9a69148e145baea87dbcceddbf75a3299b54835ebce',
  'media-bridge-linux-x64': 'c88a52d5c45f479be25a00995228d538bfc1ca5d7c7bc144273841e99a079ced',
  'media-bridge-linux-arm64': '40368c1c94dc094fd98b1c7cc8ea08c03181112b8e084d7ec6da6368de430b4a',
};
/**
 * 某些产物的**回落链**：首选产物在 Release 上不存在时按顺序再试。
 *
 * 目前只有一处：`win32-arm64` 在 CI 里是「可选产物」（windows-11-arm runner 实测会长时间
 * 卡住，已摘出发布依赖链）—— 没有它的时候，Windows ARM64 用 x64 产物即可（系统自带
 * x64 模拟，官方 BUILD.md 也是这么建议的）。每个产物各自有固定的 sha256，回落意味着
 * 用的是另一份文件、另一条哈希。
 */
export const MEDIA_BRIDGE_FALLBACKS = {
  'media-bridge-win32-arm64.exe': ['media-bridge-win32-x64.exe'],
};

/** 产物体积下限（v0.1.5 里最小的产物约 7.3MB）；明显更小说明下到的是错误页。 */
const MIN_BYTES = 3 * 1024 * 1024;
/** 单个镜像的超时（下载 13MB 在慢网络上也就几十秒，5 分钟足够）。 */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** 当前平台/架构对应的附件名；不支持时 null。 */
export function mediaBridgeAssetFor(platform = process.platform, arch = process.arch) {
  const byArch = MEDIA_BRIDGE_ASSETS[platform];
  return (byArch && byArch[arch]) || null;
}

/**
 * 下载地址。`DSH_WE_MEDIA_BRIDGE_URL` 可整体替换（自建镜像 / 内网源）：
 * 支持 `{tag}` 与 `{asset}` 两个占位符；不含占位符时按「该产物的完整 URL」处理。
 */
function mediaBridgeAssetUrls(asset, tag = MEDIA_BRIDGE_TAG) {
  const env = process.env.DSH_WE_MEDIA_BRIDGE_URL && process.env.DSH_WE_MEDIA_BRIDGE_URL.trim();
  if (env) {
    return [{ url: env.includes('{') ? env.replace(/\{tag\}/g, tag).replace(/\{asset\}/g, asset) : env, source: 'env-url' }];
  }
  return [{
    url: `https://github.com/oneincase/media-bridge/releases/download/${tag}/${asset}`,
    source: 'github',
  }];
}

/** 二进制魔数：PE("MZ") / ELF / Mach-O（含 universal 的 fat 头）。 */
export function binaryMagicOk(buf) {
  if (!buf || buf.length < 4) return false;
  const b = buf;
  const mz = b[0] === 0x4d && b[1] === 0x5a;
  const elf = b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46;
  const machThin = b[0] === 0xcf && b[1] === 0xfa && b[2] === 0xed && b[3] === 0xfe;  // 64 位 LE
  const machThin32 = b[0] === 0xce && b[1] === 0xfa && b[2] === 0xed && b[3] === 0xfe;
  const machFat = b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe;    // universal（大端）
  const machFatLe = b[0] === 0xbe && b[1] === 0xba && b[2] === 0xfe && b[3] === 0xca;
  return mz || elf || machThin || machThin32 || machFat || machFatLe;
}

/** 下载缓存目录：<dataDir>/bin/media-bridge/<tag>/。 */
function cacheDirFor(dataDir, tag) {
  return join(dataDir, 'bin', 'media-bridge', tag);
}

/** 某个产物在下载缓存里的完整路径（自检脚本据此判断「已经取过一次」）。 */
export function mediaBridgeCachePath(dataDir, tag = MEDIA_BRIDGE_TAG, asset = mediaBridgeAssetFor()) {
  if (!asset) return null;
  return join(cacheDirFor(dataDir, tag), asset);
}

function verifyFile(path, wantSha) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size < MIN_BYTES) return { ok: false, error: '文件体积异常（' + st.size + ' 字节）' };
    const fd = openSync(path, 'r');
    const head = Buffer.alloc(8);
    try {
      let got = 0;
      while (got < 8) { const n = readSync(fd, head, got, 8 - got, got); if (n <= 0) break; got += n; }
    } finally { closeSync(fd); }
    if (!binaryMagicOk(head)) return { ok: false, error: '不是可执行文件（魔数不符）' };
    if (wantSha) {
      const hash = createHash('sha256');
      const fd2 = openSync(path, 'r');
      const chunk = Buffer.alloc(1 << 20);
      try {
        for (;;) {
          const n = readSync(fd2, chunk, 0, chunk.length, null);
          if (n <= 0) break;
          hash.update(chunk.subarray(0, n));
        }
      } finally { closeSync(fd2); }
      if (hash.digest('hex') !== wantSha) return { ok: false, error: 'sha256 不符' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/** 流式下载到 .part 文件并算 sha256（不把 13MB 全塞进内存）。 */
async function downloadToFile(url, tmp) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  let fd = -1;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'dsh-wallpaper-engine' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!res.body) throw new Error('响应没有 body');
    const reader = res.body.getReader();
    fd = openSync(tmp, 'w');
    const hash = createHash('sha256');
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        let off = 0;
        while (off < value.length) off += writeSync(fd, value, off, value.length - off);
        hash.update(value);
        total += value.length;
      }
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = -1;
    // 魔数校验要**只读**再开一次：写句柄（'w'）上读会 EBADF。
    const head = Buffer.alloc(8);
    const rfd = openSync(tmp, 'r');
    try {
      let got = 0;
      while (got < 8) { const n = readSync(rfd, head, got, 8 - got, got); if (n <= 0) break; got += n; }
    } finally { closeSync(rfd); }
    if (!binaryMagicOk(head)) throw new Error('不是可执行文件（魔数不符）');
    if (total < MIN_BYTES) throw new Error('体积异常（' + total + ' 字节）');
    return { total, sha256: hash.digest('hex') };
  } finally {
    clearTimeout(timer);
    if (fd >= 0) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

/** macOS：去掉浏览器的隔离标记（curl/node 下载本来不带，防御性处理，失败无所谓）。 */
function stripQuarantine(path) {
  if (process.platform !== 'darwin') return;
  try { spawnSync('xattr', ['-d', 'com.apple.quarantine', path], { timeout: 3000 }); } catch { /* ignore */ }
}

let provisionTask = null;

/**
 * 解析可用产物路径。返回 `{ path, source, error, tag }`（path 为 null 表示不可用，
 * error 是给用户看的原因，会进 status.hint）。
 *
 * @param {object} o
 * @param {string} o.dataDir 插件数据目录（产物落 `<dataDir>/bin/media-bridge/`）；**必给**。
 * @param {import('../log.js').LogCall} [o.log] 日志被调用面（`log(msg, level?)`）；缺省空实现。
 */
export async function provisionMediaBridge({ dataDir, log = () => {} }) {
  if (provisionTask) return provisionTask;
  provisionTask = (async () => {
    const tag = (process.env.DSH_WE_MEDIA_BRIDGE_TAG && process.env.DSH_WE_MEDIA_BRIDGE_TAG.trim()) || MEDIA_BRIDGE_TAG;
    const envPath = process.env.DSH_WE_MEDIA_BRIDGE && process.env.DSH_WE_MEDIA_BRIDGE.trim();
    if (envPath) {
      const v = verifyFile(resolve(envPath), process.env.DSH_WE_MEDIA_BRIDGE_SHA256 || null);
      if (v.ok) return { path: resolve(envPath), source: 'env', tag };
      return { path: null, source: 'env', tag, error: 'DSH_WE_MEDIA_BRIDGE 指定的文件不可用：' + v.error };
    }

    const asset = mediaBridgeAssetFor();
    if (!asset) {
      return { path: null, source: 'none', tag, error: `当前平台没有预编译产物（${process.platform}/${process.arch}）` };
    }

    // 2. 插件目录旁的 bin/
    const localBin = join(PLUGIN_ROOT, 'bin', asset);
    if (existsSync(localBin)) {
      const v = verifyFile(localBin, null);
      if (v.ok) return { path: localBin, source: 'plugin-bin', tag };
      log('插件目录里的 bin/' + asset + ' 不可用：' + v.error, 'warn');
    }

    // 3. 下载缓存
    const target = join(cacheDirFor(dataDir, tag), asset);
    if (existsSync(target)) {
      const want = MEDIA_BRIDGE_SHA256[asset] || null;
      const v = verifyFile(target, want);
      if (v.ok) return { path: target, source: 'cache', tag };
      log('缓存的中间件不可用（' + v.error + '），重新下载', 'warn');
      try { unlinkSync(target); } catch { /* ignore */ }
    }

    // 4. 下载（按「首选产物 + 回落链」逐个试；见 MEDIA_BRIDGE_FALLBACKS）
    if (typeof fetch !== 'function') {
      return { path: null, source: 'download', tag, error: '当前 Node 没有 fetch（需要 Node 18+）' };
    }
    const errors = [];
    const assets = [asset, ...(MEDIA_BRIDGE_FALLBACKS[asset] || [])];
    for (const tryAsset of assets) {
      const want = MEDIA_BRIDGE_SHA256[tryAsset] || null;
      if (!want) {
        errors.push(tryAsset + ' → 未固定 sha256（自定义版本请同时给 DSH_WE_MEDIA_BRIDGE_SHA256）');
        continue;
      }
      const tryTarget = join(cacheDirFor(dataDir, tag), tryAsset);
      if (existsSync(tryTarget)) {
        const v = verifyFile(tryTarget, want);
        if (v.ok) return { path: tryTarget, source: 'cache', tag, asset: tryAsset };
      }
      try { mkdirSync(dirname(tryTarget), { recursive: true }); } catch { /* ignore */ }
      const urls = mediaBridgeAssetUrls(tryAsset, tag);
      for (const c of urls) {
        const tmp = tryTarget + '.part' + process.pid;
        try {
          log('下载系统媒体中间件：' + c.url, 'info');
          const r = await downloadToFile(c.url, tmp);
          if (r.sha256 !== want) throw new Error('sha256 不符（拿到 ' + r.sha256.slice(0, 12) + '…）');
          if (process.platform !== 'win32') { try { chmodSync(tmp, 0o755); } catch { /* ignore */ } }
          renameSync(tmp, tryTarget);
          stripQuarantine(tryTarget);
          log('系统媒体中间件就绪：' + tryTarget + '（' + Math.round(r.total / 1048576) + 'MB）'
            + (tryAsset === asset ? '' : '（首选 ' + asset + ' 取不到，用了回落产物 ' + tryAsset + '）'), 'info');
          return { path: tryTarget, source: 'download', tag, asset: tryAsset };
        } catch (err) {
          const msg = String(err && err.message ? err.message : err);
          errors.push(c.url + ' → ' + msg);
          try { unlinkSync(tmp); } catch { /* ignore */ }
        }
      }
    }
    return { path: null, source: 'download', tag, error: '中间件下载失败：' + (errors.join('; ') || '未知原因') };
  })().catch((err) => ({
    path: null, source: 'error', tag: MEDIA_BRIDGE_TAG,
    error: '中间件准备出错：' + String(err && err.message ? err.message : err),
  })).finally(() => { provisionTask = null; });
  return provisionTask;
}
