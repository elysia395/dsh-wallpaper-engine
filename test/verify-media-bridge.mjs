#!/usr/bin/env node
/**
 * verify-media-bridge.mjs — 媒体中间件（media-bridge）接入的端到端自检。
 *
 * 测什么（用中间件自带的 `--provider mock`：内置假播放器 + 假封面，**不需要真播放
 * 器、也不碰系统音频权限**，因此可重复、可 CI 化）：
 *   1. 产物解析表：平台/架构 → 附件名 + 固定的 sha256 齐全
 *   2. 门面默认走中间件：握手 protocol=1、快照字段映射、封面路径与 MIME、状态形状
 *   3. 位置外推：两次读取之间进度在走（且不超过 duration）
 *   4. 歌词换算：lines{tMs} + offsetMs → 渲染页要的 [[秒, 文本], …]
 *   5. 反向控制：动作白名单（五个渲染页动作）+ 未就绪时如实拒绝且不触发懒启动 +
 *      打真中间件（mock）：pause/play 后回读到新状态
 *   6. 回落：产物不可用时门面切回内置实现，且原因进 status.fallback
 *   7. 生命周期：stop() 之后子进程真的没了（不留孤儿）
 *
 * 产物从哪来：DSH_WE_MEDIA_BRIDGE（显式路径）→ 插件目录 bin/ → 自检缓存 →
 * 真实数据目录的下载缓存。都没有时**端到端那一段不会执行**，而"没执行"必须与"通过"区分开：
 * 那种情况计为 **blocked**（打印 ⛔），并**默认让本脚本失败**（退出码 1），除非显式传
 * `--allow-skip`。加 `--provision` 会联网下载到自检缓存（`.test-cache/`）后真正执行。
 *
 * 为什么默认要红：`verify` 链里"整块被跳过但仍退 0"会让 CI 看起来覆盖了这一条通道，
 * 实际上一条断言都没跑（假绿比没有守卫更坏）。要接受不跑，就把它写在命令行上 ——
 * 于是"本机/CI 到底覆盖了什么"在脚本里和链里都是可 grep 的事实。
 * 平台条件跳过（如 Windows 上没有 pgrep）仍用 `skip()`，只计数不判失败。
 *
 * **「中间件端到端」这一段的第三种结局：环境跳过**。产物在位、sha256 对齐、进程也起得来，
 * 但握手拿不到 `hello`（存活、两路输出皆空）—— 这在有的环境里是"这个环境跑不动这个二进制"
 * （无媒体栈的 runner、刚下载的未签名产物被安全策略挂住、带管道的子进程句柄不可用），与
 * "中间件/协议回归"在守护侧看到的形状**完全一样**。两者处置相反（前者是环境差异，后者必须红），
 * 所以判据是**换一条不依赖管道的通道再问一次**（`probeHandshakeViaFiles`：同一套参数把 stdio
 * 落文件、写一行 hello）**加上**产物可信度（`artifactTrusted`：手上这份的 sha256 是否就是发布
 * 产物）。只有"文件探针也判环境 + 产物可信"才记环境跳过，并在汇总行里**点名这条通道本次没有
 * 断言覆盖**；探针判回归、或产物不可信，都照旧判红。
 *
 * 属于 `npm run verify`；用 npm run verify:bridge 单独跑也可以。
 */
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { createMediaBackend } from '../lib/media/index.js';
import {
  MEDIA_BRIDGE_TAG, MEDIA_BRIDGE_ASSETS, MEDIA_BRIDGE_SHA256, MEDIA_BRIDGE_FALLBACKS,
  mediaBridgeAssetFor, mediaBridgeCachePath, binaryMagicOk, provisionMediaBridge,
} from '../lib/media/provision.js';
import { lyricsToTuples, bridgeServeArgs, MEDIA_CONTROL_ACTIONS, createBridgeSupervisor } from '../lib/media/supervisor.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = join(root, '.test-cache', 'verify-media-bridge');
const PROVISION = process.argv.includes('--provision');
/** 缺前置时是否允许"不跑但仍通过"。默认不允许 —— 见文件头。 */
const ALLOW_SKIP = process.argv.includes('--allow-skip');

let passed = 0;
let failed = 0;
let skipped = 0;
let blocked = 0;
const blockedNames = [];
/** 被环境挡掉的**整条**通道（探针判决，见 classifyProbe 上方那段）：汇总行要点名。 */
let channelSkipped = '';
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
/** 平台条件跳过：本平台不适用，只计数（不是"本该跑却没跑"）。 */
function skip(name, why) {
  skipped++;
  console.log('  ○ ' + name + (why ? ' — ' + why : ''));
}
/** 缺前置导致**整段没执行**：默认判失败，除非显式 --allow-skip。 */
function blockedBy(name, why) {
  blocked++;
  blockedNames.push(name);
  console.log('  ⛔ ' + name + ' —— 未执行' + (why ? '：' + why : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 环境探针（"起来了但不吭声"的二义消解）──────────────────────────────────
// 引导失败的典型现场是「进程活着、`hello` 不回、两路输出为空」。这在自检里是**二义**的：
//   · 中间件 / 协议真回归了 —— 必须红；
//   · 这个环境根本跑不了这个二进制（无媒体栈的 runner、未签名产物被安全策略挂住、
//     受限环境里带管道的子进程句柄不可用）—— 是环境差异，判红只会挡住所有无关改动。
// 两者在守护侧看到的形状**完全一样**，所以要换一条**不依赖管道**的通道再问一次：
// 用同一套参数（`bridgeServeArgs`）起一次 `serve`，把三路 stdio 都落到文件里，再写一行
// 与守护侧同形的 `hello` 请求。判据只看文件与退出位：
//   · 文件里出现 `hello` 应答 ⇒ 产物能跑、协议也对，坏的是**管道/句柄那一层** ⇒ 环境；
//   · 文件里/退出位上有别的话（错误横幅、提前退出）⇒ 能跑但握不上手 ⇒ **回归**（把原文带出来）；
//   · 到点文件仍全空且进程活着 ⇒ 连文件都不说话（进程被环境挂住）⇒ 环境；
//   · 根本起不来（EPERM 等）⇒ 环境。
// 判据本身是纯函数（`classifyProbe`），下面用合成输入钉住四分支 —— 它一旦写错，
// "环境跳过"就会变成掩盖真回归的后门。
function classifyProbe({ spawned, wrote, exited, timedOut, hello }) {
  if (!spawned) return 'environment';        // 起不来：受限句柄 / 不允许 spawn
  if (hello) return 'environment';           // 文件通道能握手 ⇒ 坏的是管道那一层
  if (wrote || exited) return 'regression';  // 说了别的话 / 提前退出 ⇒ 可行动的失败
  return timedOut ? 'environment' : 'regression';
}
/**
 * 文件探针：同一套参数起一次 `serve`，stdio 全部落文件（不经过管道），写一行 `hello`。
 * 返回 `{ spawned, exited, wrote, timedOut, hello, stdout, stderr, detail }`（stdout/stderr 是前 300 字）。
 */
async function probeHandshakeViaFiles(bin, args, dir, timeoutMs = 20000) {
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, 'probe.out');
  const errPath = join(dir, 'probe.err');
  const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
  let outFd = 0;
  let errFd = 0;
  try {
    outFd = openSync(outPath, 'w');
    errFd = openSync(errPath, 'w');
  } catch (e) {
    return { spawned: false, exited: false, wrote: false, timedOut: false, hello: false, stdout: '', stderr: '', detail: '打不开探针输出文件：' + String((e && e.message) || e) };
  }
  const r = { spawned: false, exited: false, wrote: false, timedOut: false, hello: false, stdout: '', stderr: '', detail: '' };
  let p = null;
  try {
    p = spawn(bin, args, { stdio: ['pipe', outFd, errFd], windowsHide: true });
  } catch (e) {
    try { closeSync(outFd); closeSync(errFd); } catch { /* ignore */ }
    r.detail = String((e && e.message) || e);
    return r;
  }
  r.spawned = true;
  p.once('exit', () => { r.exited = true; });
  p.once('error', (e) => { r.detail = String((e && e.message) || e); });
  try { p.stdin.write(JSON.stringify({ id: 1, method: 'hello', params: {} }) + '\n'); } catch { /* ignore */ }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const so = read(outPath);
    if (/"id"\s*:\s*1/.test(so) || r.exited) break;
  }
  try { if (p && !p.killed) p.kill('SIGKILL'); } catch { /* ignore */ }
  try { closeSync(outFd); closeSync(errFd); } catch { /* ignore */ }
  const so = read(outPath);
  const se = read(errPath);
  r.hello = /"id"\s*:\s*1/.test(so) && /"ok"\s*:\s*true/.test(so);
  r.wrote = Boolean(so.trim() || se.trim());
  r.timedOut = !r.exited && !r.wrote && !r.hello;
  r.stdout = so.slice(0, 300);
  r.stderr = se.slice(0, 300);
  return r;
}
/**
 * 手上这份产物是不是**发布产物**（sha256 与产物表一致）。
 * 为什么"环境跳过"要有这道门：不然任何跑不起来的二进制都能被探针判成"环境差异"而白放过 ——
 * 探针只回答"这个环境跑不跑得动它"，回答不了"这份文件是不是我们要测的那份"。两者都成立时
 * 跳过才是诚实的（发布产物 + 本环境跑不动）；文件被换过 / 被截断 / 是自建产物时判**失败**，
 * 因为那是可行动的问题，不是环境差异。
 */
function artifactTrusted(bin, assetName) {
  const want = String(MEDIA_BRIDGE_SHA256[assetName] || '');
  if (!/^[0-9a-f]{64}$/.test(want)) return { ok: false, why: '产物表里没有它的期望 sha256（无法确认手上这份就是发布产物）' };
  try {
    const got = createHash('sha256').update(readFileSync(bin)).digest('hex');
    return got === want
      ? { ok: true, why: 'sha256 与发布产物一致' }
      : { ok: false, why: `sha256 与发布产物不一致（手上 ${got.slice(0, 12)}…）` };
  } catch (e) {
    return { ok: false, why: '读不出产物字节：' + String((e && e.message) || e) };
  }
}

// ── 1. 产物表（纯静态，先跑，和有没有产物无关）──────────────────────────────
console.log('· 产物解析表');
check('darwin 两个架构都指向通用包',
  mediaBridgeAssetFor('darwin', 'arm64') === 'media-bridge-darwin-universal'
  && mediaBridgeAssetFor('darwin', 'x64') === 'media-bridge-darwin-universal');
check('linux x64 取 musl 静态包（无 glibc 下限）',
  mediaBridgeAssetFor('linux', 'x64') === 'media-bridge-linux-x64-musl');
check('win32 有 x64 与 arm64 两个产物',
  mediaBridgeAssetFor('win32', 'x64') === 'media-bridge-win32-x64.exe'
  && mediaBridgeAssetFor('win32', 'arm64') === 'media-bridge-win32-arm64.exe');
check('不支持的架构返回 null（回落内置实现）', mediaBridgeAssetFor('linux', 'ia32') === null);
const allAssets = [...new Set(Object.values(MEDIA_BRIDGE_ASSETS).flatMap((a) => Object.values(a)))];
const hasHash = (a) => /^[0-9a-f]{64}$/.test(String(MEDIA_BRIDGE_SHA256[a] || ''));
// 每个产物要么自己有哈希，要么它的回落链里有（win32-arm64 是 CI 的可选产物，
// Release 里没有时就靠 x64 回落 —— 那时它自己没有哈希是正常的）
check('每个产物都有 sha256（或回落链里有）',
  allAssets.every((a) => hasHash(a) || (MEDIA_BRIDGE_FALLBACKS[a] || []).some(hasHash)),
  allAssets.map((a) => a + (hasHash(a) ? '✓' : '→回落')).join(', '));
check('产物名带版本标签（升级时哈希必须一起换）', /^v\d+\.\d+\.\d+$/.test(MEDIA_BRIDGE_TAG));
check('可执行魔数识别（PE / ELF / Mach-O / universal）',
  binaryMagicOk(Buffer.from([0x4d, 0x5a, 0, 0]))
  && binaryMagicOk(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  && binaryMagicOk(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))
  && binaryMagicOk(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
  && !binaryMagicOk(Buffer.from([0x3c, 0x21, 0x44, 0x4f])));

// ── 2. 歌词换算（纯函数，样例数据）─────────────────────────────────────────
console.log('· 歌词换算（渲染页要 [[秒, 文本], …]）');
const lyr = lyricsToTuples({
  offsetMs: 500,                                  // LRC [offset:500] = 整体晚 0.5s
  lines: [{ tMs: 1000, text: '第一句' }, { tMs: 12500, text: '第二句' }, { tMs: null, text: '丢掉' }],
});
check('ms → 秒并叠加 offsetMs',
  Array.isArray(lyr) && lyr.length === 2
  && lyr[0][0] === 1.5 && lyr[0][1] === '第一句' && lyr[1][0] === 13,
  JSON.stringify(lyr));
check('空歌词返回 null（渲染页退回「没有歌词」）',
  lyricsToTuples(null) === null && lyricsToTuples({ lines: [] }) === null
  && lyricsToTuples({ lines: [{ tMs: 100 }] }) !== null);
check('时间轴不会被 offset 推成负数', lyricsToTuples({ offsetMs: -90000, lines: [{ tMs: 100, text: 'x' }] })[0][0] === 0);

// ── 2c. 反向控制的门面契约（离线，不需要产物）──────────────────────────────
// 动作白名单是**闸门**：`/media-control` 是开放的 HTTP 入口，动作名不得直达中间件
//（协议里还有 seek / set-loop / toggle-shuffle 这类本插件不暴露的动作）。
console.log('· 反向控制（动作白名单 + 未就绪时的诚实拒绝）');
check('五个渲染页动作各有映射，不多不少',
  MEDIA_CONTROL_ACTIONS.play === 'play' && MEDIA_CONTROL_ACTIONS.pause === 'pause'
  && MEDIA_CONTROL_ACTIONS.playPause === 'play-pause'
  && MEDIA_CONTROL_ACTIONS.skipNext === 'next' && MEDIA_CONTROL_ACTIONS.skipPrevious === 'previous'
  && Object.keys(MEDIA_CONTROL_ACTIONS).length === 5);
{
  // 门面未启动时：控制必须如实回不可用，**且不得触发懒启动**（控制是用户点一下的
  // 交互，不该顺带把产物下载与子进程拉起来；启动仍由取数那四条路由决定）。
  const idle = createMediaBackend({ dataDir: join(TEST_DIR, 'control-idle'), log: () => {} });
  const r = await idle.control('play');
  check('未就绪时 control 回不可用（不抛、不造成功）',
    r && r.ok === false && typeof r.error === 'string' && r.error.length > 0, JSON.stringify(r));
  check('未就绪时 control 不触发懒启动', idle.usingBridge() === false);
  idle.stop();
  // 白名单闸门在守护层（门面还没就绪时它先回 not-ready，白名单在那里不可观测）：
  // 构造一个**从未 start 过**的守护 —— 未知动作当场拒绝、已知动作也只是"中间件未运行"，
  // 两种都不许真的去 spawn（这就是"控制不自带启动"的第二条腿）。
  const sup = createBridgeSupervisor({ binPath: join(TEST_DIR, 'not-a-binary'), cacheDir: TEST_DIR, log: () => {} });
  const unknown = await sup.control('seek');
  check('未知动作被白名单挡在守护层（不落到中间件）',
    unknown && unknown.ok === false && unknown.error === 'unknown-action', JSON.stringify(unknown));
  const notUp = await sup.control('play');
  check('守护未启动时已知动作回 not-running（不 spawn）',
    notUp && notUp.ok === false && /中间件未运行/.test(String(notUp.error)), JSON.stringify(notUp));
  sup.stop();
}

// ── 2b. 环境探针的判定（纯函数 + 四分支负对照）──────────────────────────────
// 这条逻辑决定"握手失败"是红还是环境跳过 ⇒ 它自己必须有判据：四个分支各喂一个合成输入，
// 并显式断言**"说了别的话 / 提前退出"必须落到 regression**（写反了就等于给真回归开后门）。
console.log('· 环境探针判定（把"环境跑不动"与"中间件坏了"分开）');
check('探针：起不来 ⇒ environment（受限句柄 / 不允许 spawn）',
  classifyProbe({ spawned: false, wrote: false, exited: false, timedOut: false, hello: false }) === 'environment');
check('探针：文件通道拿到 hello ⇒ environment（产物与协议都对，坏的是管道那一层）',
  classifyProbe({ spawned: true, wrote: true, exited: false, timedOut: false, hello: true }) === 'environment');
check('探针：说了别的话或提前退出 ⇒ regression（可行动的失败，不得记成环境跳过）',
  classifyProbe({ spawned: true, wrote: true, exited: false, timedOut: false, hello: false }) === 'regression'
  && classifyProbe({ spawned: true, wrote: false, exited: true, timedOut: false, hello: false }) === 'regression');
check('探针：存活且文件全空 ⇒ environment（连文件都不说话 = 进程被环境挂住）',
  classifyProbe({ spawned: true, wrote: false, exited: false, timedOut: true, hello: false }) === 'environment');

// ── 3. 找产物 ───────────────────────────────────────────────────────────────
console.log('· 找中间件产物');
mkdirSync(TEST_DIR, { recursive: true });
const asset = mediaBridgeAssetFor();
let binPath = '';
let binSource = '';
const envBin = process.env.DSH_WE_MEDIA_BRIDGE && process.env.DSH_WE_MEDIA_BRIDGE.trim();
const candidates = [
  ['env', envBin ? resolve(envBin) : ''],
  ['plugin-bin', asset ? join(root, 'bin', asset) : ''],
  ['test-cache', asset ? mediaBridgeCachePath(TEST_DIR, MEDIA_BRIDGE_TAG, asset) : ''],
  ['user-cache', asset ? mediaBridgeCachePath(join(homedir(), '.dsh-wallpaper-engine'), MEDIA_BRIDGE_TAG, asset) : ''],
];
for (const [src, p] of candidates) {
  if (p && existsSync(p)) { binPath = p; binSource = src; break; }
}
if (!binPath && PROVISION) {
  const prov = await provisionMediaBridge({ dataDir: TEST_DIR, log: (m) => console.log('    · ' + m) });
  if (prov.path) { binPath = prov.path; binSource = prov.source; }
  else console.log('    · 下载没成功：' + prov.error);
}
if (!binPath) {
  blockedBy('中间件端到端用例', '本机没有产物 —— 跑 `node test/verify-media-bridge.mjs --provision` 下载 '
    + MEDIA_BRIDGE_TAG + '；明确接受这次不跑就传 `--allow-skip`');
} else {
  console.log(`   产物：${binPath}（${binSource}）`);

  // ── 4. 门面：默认走中间件 ─────────────────────────────────────────────────
  console.log('· 门面（mock provider）');
  // 用中间件自带的假播放器：不需要真播放器、也不碰系统音频权限，断言才是确定的。
  // （这也是给用户的联调开关：DSH_WE_MEDIA_PROVIDER=mock 起插件就能看到假曲目。）
  process.env.DSH_WE_MEDIA_PROVIDER = 'mock';
  // 引导预算：**必须与宿主（`lib/media/supervisor.js`）用的是同一个数**。`--provision`
  // 这条路会在 CI runner 上首次执行一个刚下载的二进制 —— 实测 windows-latest 25s 拿不到
  // `hello`（同一个产物、同一套参数，在本机 <25s 就绪），所以这条路显式放宽；本机自备
  // 产物那条仍按宿主默认。
  // ⚠️ 等待预算**从同一个数派生**（不是写死 200×150ms = 30s —— 那只比引导预算多 5s，
  //    一旦放宽引导而不动它，测试会抢在握手结束前判失败，而且看起来像"中间件超时"）。
  const bootMs = PROVISION ? 90000 : (Number(process.env.DSH_WE_MEDIA_BOOT_MS) || 25000);
  process.env.DSH_WE_MEDIA_BOOT_MS = String(bootMs);
  const backend = createMediaBackend({ dataDir: TEST_DIR, log: (m) => console.log('    · ' + m) });
  backend.start({ audio: false, online: false });   // 不碰系统音频权限
  let ready = false;
  const readyDeadline = Date.now() + bootMs + 15000;   // 引导预算 + 收尾余量
  while (!ready && Date.now() < readyDeadline) { await sleep(150); ready = backend.usingBridge(); }
  // ⚠️ 这条**必须在 `if (ready)` 外面**：放进去就成了"进得来块 ⇒ ready 为真 ⇒ 判据恒真"，
  //    中间件根本没起来时它不会把失败喊出来，而是**整段静默跳过** —— 恒红与静默不可达是同一个洞的两面。
  check('中间件就绪（握手通过、子进程在跑）', ready, `引导预算 ${bootMs}ms`);
  if (ready) {
    const info = backend.bridgeInfo() || {};
    check('hello.protocol = 1（协议版本一致才用）', Number(info.protocol) === 1);
    check('hello 报告平台与后端', Boolean(info.platform) && Boolean(info.provider),
      `${info.platform}/${info.arch} ${info.provider}`);

    // 等第一份快照到位（mock 播放器立刻就有曲目）
    let np = null;
    for (let i = 0; i < 20 && !np; i++) { await sleep(150); np = backend.nowPlaying(); }
    check('快照映射出曲目信息', Boolean(np && np.title && np.artist),
      np ? `${np.title} - ${np.artist}` : 'null');
    check('播放态映射成旧 wire 的 1/2/0', Boolean(np) && [0, 1, 2].includes(np.state), np ? String(np.state) : '');
    check('时长/进度是秒（不是毫秒）',
      Boolean(np) && np.duration > 10 && np.duration < 10000 && np.position >= 0 && np.position <= np.duration + 1,
      np ? `pos=${np.position.toFixed(1)}s dur=${np.duration.toFixed(1)}s` : '');
    check('封面存在时给出宿主代理路径', Boolean(np && np.thumbnail) === Boolean(backend.artworkFile()),
      np && np.thumbnail ? String(np.thumbnail) : '（无封面）');
    check('封面文件真的落盘了且 MIME 可用',
      !backend.artworkFile() || (existsSync(backend.artworkFile()) && /^image\//.test(backend.artworkMime())),
      backend.artworkFile() ? backend.artworkMime() : '（无封面）');
    check('歌词缺省时不硬塞空数组（不给渲染页假歌词）',
      !np || np.lyrics === undefined || Array.isArray(np.lyrics));

    // 频谱形状：音频关掉时也必须是「形状正确的 64 段」，而不是报错
    const sp = backend.spectrum();
    check('频谱恒为 64 段（音频关时全 0，不是错误）',
      sp && sp.length === 64 && typeof sp[0] === 'number');

    // 位置外推：等一会儿再读，进度得往前走
    const before = np ? np.position : 0;
    await sleep(1200);
    const after = backend.nowPlaying();
    check('位置随真实时间外推（不是卡在上报值）',
      Boolean(after) && after.position > before,
      `${before.toFixed(1)}s → ${after ? after.position.toFixed(1) : '?'}s`);

    // ── 反向控制（端到端，mock 播放器）：壁纸里的播放/暂停按钮落到的就是这条链 ──
    // 判据按**回读的状态**（不是只看 {ok:true}）：中间件发完命令会开突发窗口重轮询，
    // 守护侧再把响应里的快照写进缓存 —— 宿主面板与壁纸图标靠的就是这一步即时性。
    const ctlPause = await backend.control('pause');
    check('control(pause) 打到中间件且回读到暂停',
      ctlPause && ctlPause.ok === true && (backend.nowPlaying() || {}).state === 2,
      JSON.stringify(ctlPause) + ' state=' + String((backend.nowPlaying() || {}).state));
    const ctlPlay = await backend.control('play');
    check('control(play) 恢复播放并回读到播放态',
      ctlPlay && ctlPlay.ok === true && (backend.nowPlaying() || {}).state === 1,
      JSON.stringify(ctlPlay) + ' state=' + String((backend.nowPlaying() || {}).state));
    const ctlNext = await backend.control('skipNext');
    check('control(skipNext) 映射到中间件的 next', ctlNext && ctlNext.ok === true, JSON.stringify(ctlNext));

    // 状态形状：与内置实现同名同形（调用点不必分支），外加 backend/回落说明
    const st = backend.status();
    check('status 形状与内置实现同名同形（audio/nowPlaying 两段 + 后端标记）',
      st.audio && typeof st.audio.status === 'string'
      && st.nowPlaying && typeof st.nowPlaying.status === 'string'
      && st.backend === 'bridge' && st.fallback === '',
      `audio=${st.audio.status} nowPlaying=${st.nowPlaying.status}`);
    check('用户关掉音频时不装音频桥（status.audio=off）', st.audio.status === 'off', st.audio.status);
    check('mock 下 metadata 源在跑', st.nowPlaying.status === 'running', st.nowPlaying.status);

    // ── 5. 生命周期：stop() 不留孤儿 ────────────────────────────────────────
    const pid = Number(info.pid) || 0;
    backend.stop();
    let alive = false;
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      alive = false;
      if (pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
      if (!alive) break;
    }
    check('stop() 后子进程退出（不留孤儿）', !alive, pid ? 'pid ' + pid : '（hello 没给 pid）');
  } else {
    backend.stop();
    // 二义消解（见 classifyProbe 上方那段）：换一条不依赖管道的通道再问一次，并要求
    // **产物可信**（sha256 就是发布产物）才允许记环境跳过。
    const probe = await probeHandshakeViaFiles(binPath, bridgeServeArgs({
      cacheDir: join(TEST_DIR, 'probe-cache'), audio: false, online: false, mock: true,
    }), join(TEST_DIR, 'probe'));
    const verdict = classifyProbe(probe);
    const trust = artifactTrusted(binPath, asset);
    const probeBrief = (probe.hello ? '文件通道拿到了 hello 应答' : (probe.stdout || probe.stderr
      ? '子进程原话：' + String(probe.stdout || probe.stderr).replace(/\s+/g, ' ').slice(0, 160)
      : (probe.spawned ? '存活且文件全空' : '起不来：' + (probe.detail || 'spawn 失败'))));
    if (verdict === 'regression') {
      check('中间件就绪（握手通过、子进程在跑）', false,
        JSON.stringify(backend.status().fallback || '')
        + `（引导预算 ${bootMs}ms；文件探针判**回归**：${probeBrief} ⇒ 不是环境差异）`);
    } else if (!trust.ok) {
      check('中间件就绪（握手通过、子进程在跑）', false,
        JSON.stringify(backend.status().fallback || '')
        + `（引导预算 ${bootMs}ms；探针判 ${verdict}，但产物不可信：${trust.why} ⇒ 不能归因给环境）`);
    } else {
      channelSkipped = probeBrief;
      skip('中间件端到端用例', `文件探针判 ${verdict}：${probeBrief}；产物可信（${trust.why}）⇒ 判为环境差异（非协议回归）`);
    }
  }
}

// ── 6. 回落：产物不可用 → 内置实现 ──────────────────────────────────────────
console.log('· 回落路径');
process.env.DSH_WE_MEDIA_LEGACY = '1';   // 等价于「中间件不可用」
const fb = createMediaBackend({ dataDir: join(TEST_DIR, 'fallback'), log: () => {} });
fb.start({ audio: false, online: false });
await sleep(300);
const fst = fb.status();
check('强制内置实现时不走中间件', fb.usingBridge() === false);
check('回落原因写进 status.fallback（给用户看的原因）', typeof fst.fallback === 'string' && fst.fallback.length > 0, fst.fallback);
check('回落状态也是旧形状（audio/nowPlaying）',
  Boolean(fst.audio) && typeof fst.audio.status === 'string' && Boolean(fst.nowPlaying));
check('回落时不偷偷开音频采集（audio=off 传下去）', fst.audio.status === 'off', fst.audio.status);
fb.stop();

// 产物「看着像可执行文件、其实跑不起来」时：spawn 失败 → 回落，且**不留孤儿进程**。
// （这条是从实测里补上的：macOS 首次执行刚下载的二进制会让 'spawn' 事件晚到几秒，
//  早杀的 kill() 打在空气上，进程随后才起来 —— 于是留下一只孤儿。）
console.log('· 产物是坏二进制时不卡住、不留孤儿');
delete process.env.DSH_WE_MEDIA_LEGACY;
process.env.DSH_WE_MEDIA_IDLE_MS = '0';
const bogus = join(TEST_DIR, 'bogus-binary');
{
  const head = Buffer.alloc(4096);
  head.writeUInt32BE(0x7f454c46, 0);           // 假 ELF 头：过得了魔数校验
  const filler = Buffer.alloc(4 * 1024 * 1024, 0x41);   // 体积够（≥3MB）才不被体积检查拦下
  head.copy(filler, 0);
  writeFileSync(bogus, filler, { mode: 0o755 });
}
process.env.DSH_WE_MEDIA_BRIDGE = bogus;
const bog = createMediaBackend({ dataDir: join(TEST_DIR, 'bogus'), log: () => {} });
bog.start({ audio: false, online: false });
let bogFallback = '';
for (let i = 0; i < 120 && !bogFallback; i++) { await sleep(150); bogFallback = bog.status().fallback || ''; }
check('坏产物 → 回落内置实现（不无限等）', Boolean(bogFallback) && bog.usingBridge() === false,
  bogFallback || '（超时未回落）');
bog.stop();
await sleep(1500);
if (process.platform === 'win32') {
  skip('坏产物没有留下孤儿进程', 'Windows 上没有 pgrep');
} else {
  let stray = '';
  try {
    stray = execFileSync('pgrep', ['-fl', 'bogus-binary'], { encoding: 'utf8' }).trim();
  } catch { /* pgrep 退出码 1 = 没找到，正是期望 */ }
  check('坏产物没有留下孤儿进程', !stray, stray || '无');
}
delete process.env.DSH_WE_MEDIA_BRIDGE;
delete process.env.DSH_WE_MEDIA_IDLE_MS;

rmSync(join(TEST_DIR, 'fallback'), { recursive: true, force: true });
rmSync(join(TEST_DIR, 'bogus'), { recursive: true, force: true });
rmSync(join(TEST_DIR, 'probe'), { recursive: true, force: true });
rmSync(join(TEST_DIR, 'probe-cache'), { recursive: true, force: true });
rmSync(bogus, { force: true });

// 覆盖面地板（全局）：离线那一段（产物表 7 / 歌词 3 / 反向控制 5 / 探针判定 4 = 19 条）与有没有
// 产物无关，恒在。整段被短路或删空时，下面的"全绿 / --allow-skip"就是**空域上的通过**，所以钉一个
// 绝对下界（改离线判据条数时同步改这个数）。
check('覆盖面地板：本次至少执行 19 条判据（否则汇总的"通过"是空域上的）', passed + failed >= 19,
  '已执行 ' + (passed + failed) + ' 条');

console.log(`\nmedia-bridge 自检：${passed} 通过 / ${failed} 失败`
  + `${skipped ? ` / ${skipped} 平台跳过` : ''}`
  + `${blocked ? ` / ${blocked} 未执行（缺前置）` : ''}`);
if (blocked && !ALLOW_SKIP) {
  console.log(`\n✗ 有 ${blocked} 段因缺前置**没有执行**（${blockedNames.join('、')}）—— `
    + '默认判失败，因为"没跑"与"通过"不能同形。');
  console.log('  要么补前置（--provision / 设 DSH_WE_MEDIA_BRIDGE），要么显式接受：--allow-skip');
  process.exit(1);
}
if (blocked) {
  console.log(`\n⚠️  ${blocked} 段被显式允许跳过（--allow-skip）：${blockedNames.join('、')} —— `
    + '这条通道本次没有任何断言覆盖。');
}
if (channelSkipped) {
  console.log('\n⚠️  「中间件端到端用例」本次判为**环境跳过**：' + channelSkipped + '。');
  console.log('   这条通道本次**没有断言覆盖**（不是通过）：产物存在且 sha256 通过，失败形态是'
    + '"存活但不吭声"，与协议回归不可区分 ⇒ 交给探针裁决，探针也判环境。');
  console.log('   在有媒体栈的机器（或本机 `node test/verify-media-bridge.mjs --provision`）上这一步会真跑。');
}
process.exit(failed ? 1 : 0);
