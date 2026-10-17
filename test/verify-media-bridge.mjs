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
 * 断言覆盖**。
 *
 * ⚠️ **退出码 + 判词契约（CI 修法 B；`test/verify-bridge-ci.mjs` 的包装器按它消费）**：
 *   · `0` = 判据全 ok；
 *   · **`3` = 唯一失败来源是"环境差异"**（文件探针判 environment **且** 产物 sha256 可信）
 *     —— 与环境跳过配套：红的原因归因给环境，退出码显式区分于"回归"；
 *   · 其它任何失败（回归 / 产物不可信 / 探针缺失或自相矛盾）= `1`；
 *   · 汇总附近**恰好打印一次**机器可读判词行
 *     `[media-bridge] verdict=ok|environment|regression|untrusted`（包装器 fail-closed：没这行就当红）。
 *   ⚠️ 但"环境差异"与"通过"**仍然不同形**：判词行 + 那条 ✗ + 末尾"这条通道本次没有断言覆盖"的
 *   明细都在，退出码非 0（3）—— 严格入口直接跑依旧是"红"，只是红的原因可被机器区分。
 *   这三条判别式是**纯函数** `resolveOutcome()`，文末用合成输入钉住四判词（见负对照）。
 *   取舍口径：**"环境跳过"不能与"通过"同形**（否则静默失去覆盖），所以判词行 + 非 0 退出码
 *   必须同时在位；`--allow-skip` 是显式开口，不给默认值。
 *
 * 属于 `npm run verify`；用 npm run verify:bridge 单独跑也可以。
 */
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { createMediaBackend } from '../packages/media-bridge/lib/backend.js';
import {
  MEDIA_BRIDGE_TAG, MEDIA_BRIDGE_ASSETS, MEDIA_BRIDGE_SHA256, MEDIA_BRIDGE_FALLBACKS,
  mediaBridgeAssetFor, mediaBridgeCachePath, binaryMagicOk, provisionMediaBridge,
} from '../packages/media-bridge/lib/provision.js';
import { lyricsToTuples, bridgeServeArgs, MEDIA_CONTROL_ACTIONS, createBridgeSupervisor, bootAttemptBudgets } from '../packages/media-bridge/lib/supervisor.js';

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
/** 文件探针的判决（'' = 没跑过）：退出码契约要区分「环境」与「回归」。 */
let probeVerdict = '';
/** 产物可信度（null = 没跑过探针；false = 产物不可信 ⇒ 判词 untrusted）。 */
let artifactTrustOk = null;
/** 判据名台账：同一条判据被数两次会把"1 个失败"读成"2 个失败"（失败支路曾经如此），
 *  也会让覆盖面地板这类计数失真 —— 文末有一条判据专门钉"名字不许重复"。 */
const checkNames = [];
function check(name, ok, detail) {
  checkNames.push(name);
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
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

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
 * 「握手失败 ⇒ 换 spawn 姿势重试」的判据本体（生产与全部负对照共用）。
 *
 * ⚠️ 语义**分结局**，不能无条件要求"失败行"：**就绪结局上根本不存在失败行**。
 * 本判据原先写成无条件的"必须有失败行 + 两次尝试" ⇒ 中间件在 CI 上握手成功时它**恒红**
 * （CI 实测：唯一失败项就是它，明细「没有失败行 —— 说明没走到这条结局」；判据自己的注释
 * 早已写明"只在产物在位但握手没成的分支里断言（OK 路径上不会出现失败行）"，但代码没照做）。
 * 两个结局各有**可判红的**要求：
 *   · **失败结局**（ready=false）：失败行必须在位，且逐次点名 **≥2 种姿势**（带耗时与存活位），
 *     并出现「换 spawn 姿势重试」行 ⇒ 重试真的发生过。把重试短路（不试第二种姿势）⇒ 只剩一次尝试 ⇒ 红。
 *   · **就绪结局**（ready=true）：成功行必须在位；**若**中途换过姿势，换姿势行必须齐形
 *     （两种**不同**姿势 + 耗时 + 存活位）⇒ "换姿势"不许退化成同姿势空转或没有记账。
 * @param {{ready: boolean, logs: string[]}} input
 * @returns {{ok: boolean, detail: string}}
 */
function judgeBootRetry({ ready, logs }) {
  const lines = (logs || []).map(String);
  const failLine = lines.filter((l) => l.includes('中间件启动失败：')).join('\n');
  const attempts = failLine.match(/尝试 \d+\/\d+：(detached|plain) \d+ms 存活=(true|false)/g) || [];
  const postures = [...new Set(attempts.map((s) => /：(detached|plain)/.exec(s)[1]))];
  const retryLines = lines.filter((l) => l.includes('换 spawn 姿势重试'));
  const retryShapes = retryLines
    .map((l) => /姿势=(\w+)，(\d+)ms，存活=(true|false)[\s\S]*?⇒ 换 spawn 姿势重试：(\w+) → (\w+)/.exec(l))
    .filter(Boolean)
    // ⚠️ 组号：1=首姿势 · 2=耗时 · 3=存活位 · **4=换之前** · **5=换之后**（off-by-one 会让
    //    "同姿势空转"检出恒真 —— 本判据的负对照第一次跑就踩到了这个，改完才区分得开）。
    .map((m) => ({ from: m[4], to: m[5], ms: Number(m[2]) }));
  const readyLine = lines.some((l) => l.includes('中间件就绪：'));
  if (ready) {
    const badShape = retryShapes.filter((s) => s.from === s.to || !(s.ms >= 0));
    const ok = readyLine && badShape.length === 0 && (!failLine || attempts.length >= 1);
    return {
      ok,
      detail: `结局=就绪 · 成功行=${readyLine} · 换姿势行 ${retryLines.length} 条（齐形 ${retryShapes.length}${badShape.length ? '，坏形 ' + badShape.length : ''}）`
        + ` · 失败行=${failLine ? '有（' + attempts.length + ' 次尝试明细）' : '无（就绪结局正常）'}`,
    };
  }
  const ok = attempts.length >= 2 && postures.length >= 2 && retryLines.length >= 1;
  return {
    ok,
    detail: failLine
      ? `结局=失败 · 尝试 ${attempts.length} 次 / 姿势 ${postures.length} 种 / 换姿势行 ${retryLines.length} 条 ⇒ ` + failLine.slice(0, 220)
      : '（失败结局却没有失败行 ⇒ 判据或夹具失效）',
  };
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
  let outFd;
  let errFd;
  try {
    outFd = openSync(outPath, 'w');
    errFd = openSync(errPath, 'w');
  } catch (e) {
    return { spawned: false, exited: false, wrote: false, timedOut: false, hello: false, stdout: '', stderr: '', detail: '打不开探针输出文件：' + String((e && e.message) || e) };
  }
  const r = { spawned: false, exited: false, wrote: false, timedOut: false, hello: false, stdout: '', stderr: '', detail: '' };
  let p;
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
  // 引导预算：**必须与宿主（`lib/components/media-bridge/supervisor.js`）用的是同一个数**。`--provision`
  // 这条路会在 CI runner 上首次执行一个刚下载的二进制 —— 实测 windows-latest 25s 拿不到
  // `hello`（同一个产物、同一套参数，在本机 <25s 就绪），所以这条路显式放宽；本机自备
  // 产物那条仍按宿主默认。
  // ⚠️ 等待预算**从同一个数派生**（不是写死 200×150ms = 30s —— 那只比引导预算多 5s，
  //    一旦放宽引导而不动它，测试会抢在握手结束前判失败，而且看起来像"中间件超时"）。
  const bootMs = PROVISION ? 90000 : (Number(process.env.DSH_WE_MEDIA_BOOT_MS) || 25000);
  process.env.DSH_WE_MEDIA_BOOT_MS = String(bootMs);
  // 两姿势重试的预算**在总预算内分配**（不翻倍）—— 纯函数判据，下面还用行为面验证"确实试了两次"。
  const budgets = bootAttemptBudgets(bootMs);
  check('两姿势重试的预算在总预算内分配（第二次不额外加时间）',
    budgets.second > 0 && budgets.first >= 1000 && budgets.first + budgets.second <= bootMs,
    `总 ${bootMs}ms = 第一次 ${budgets.first}ms + 换姿势第二次 ${budgets.second}ms`);
  // 守护侧日志要能被断言（"换姿势重试真的发生了"），但仍原样打到 stdout。
  const bootLogs = [];
  const backend = createMediaBackend({ dataDir: TEST_DIR, log: (m) => { bootLogs.push(String(m)); console.log('    · ' + m); } });
  backend.start({ audio: false, online: false });   // 不碰系统音频权限
  let ready = false;
  const readyDeadline = Date.now() + bootMs + 15000;   // 引导预算 + 收尾余量
  while (!ready && Date.now() < readyDeadline) { await sleep(150); ready = backend.usingBridge(); }
  // ⚠️ 这条判据**必须覆盖到每一个结局**（不能只写在 `if (ready)` 里）：放进去就成了"进得来块 ⇒
  //    ready 为真 ⇒ 判据恒真"，中间件根本没起来时它不会把失败喊出来，而是**整段静默跳过** ——
  //    恒红与静默不可达是同一个洞的两面。
  //    做法：给每个结局各留**一次**计数（`judgeReady` 自带去重），失败支路把探针判决写进**同一行**
  //    的明细里。⚠️ 失败支路曾经**再数一次同名判据** ⇒ 一个失败被读成 `failed=2`（同一条判据在
  //    报告里出现两行 ✗），所以这里收成唯一入口。
  const READY_NAME = '中间件就绪（握手通过、子进程在跑）';
  const readyWhyBase = `引导预算 ${bootMs}ms`;
  let readyJudged = false;
  const judgeReady = (ok, why) => {
    if (readyJudged) return;   // 同名判据只计数一次（文末"判据名唯一"那条判据钉住这件事）
    readyJudged = true;
    check(READY_NAME, ok, why ? `${readyWhyBase}；${why}` : readyWhyBase);
  };
  if (ready) {
    judgeReady(true);
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
    // **产物可信**（sha256 就是发布产物）才允许把失败归因给环境。三种结局都把原因写进
    // **同一条**判据的明细（唯一入口 `judgeReady`），退出码照旧是红 —— 见文件头。
    const probe = await probeHandshakeViaFiles(binPath, bridgeServeArgs({
      cacheDir: join(TEST_DIR, 'probe-cache'), audio: false, online: false, mock: true,
    }), join(TEST_DIR, 'probe'));
    const verdict = classifyProbe(probe);
    const trust = artifactTrusted(binPath, asset);
    probeVerdict = verdict;
    artifactTrustOk = trust.ok;
    const probeBrief = (probe.hello ? '文件通道拿到了 hello 应答' : (probe.stdout || probe.stderr
      ? '子进程原话：' + String(probe.stdout || probe.stderr).replace(/\s+/g, ' ').slice(0, 160)
      : (probe.spawned ? '存活且文件全空' : '起不来：' + (probe.detail || 'spawn 失败'))));
    if (verdict === 'regression') {
      judgeReady(false, JSON.stringify(backend.status().fallback || '')
        + `；文件探针判**回归**：${probeBrief} ⇒ 不是环境差异`);
    } else if (!trust.ok) {
      judgeReady(false, JSON.stringify(backend.status().fallback || '')
        + `；探针判 ${verdict}，但产物不可信：${trust.why} ⇒ 不能归因给环境`);
    } else {
      // 环境差异：**仍然判红**（明细里点名"本次没有断言覆盖"）。新契约下退出码 = 3（唯一失败
      // 来源是环境差异 + 产物可信），与"通过"（0）和"回归"（1）都不同形 —— 别把这条支路改成不计数。
      channelSkipped = probeBrief;
      const why = `文件探针判 ${verdict}：${probeBrief}；产物可信（${trust.why}）⇒ 判为环境差异（非协议回归）`;
      judgeReady(false, why + '；这条通道本次没有断言覆盖，不得与"通过"同形（唯一失败来源是环境差异 ⇒ 退出码 3，不是 0）');
      skip('中间件端到端用例', why);
    }
  }
  // 兜底：上面若新增了不调 `judgeReady` 的支路，这条判据仍会红一次 —— 判据宁可恒红，不可静默。
  judgeReady(false, '（没有走到任何结局分支：这条判据本身是红的，别让它变成静默跳过）');

  // ── 两姿势重试的**行为面**判据（CI 修法 B）────────────────────────────────
  // 判据本体 = `judgeBootRetry`（纯函数，按**结局**分派，见它的注释）。生产扫描与这里的全部
  // 负对照都调它：合成日志各喂一次，覆盖"就绪结局"（CI 上真实发生的那个 —— 原先在这里恒红）
  // 与"失败结局"（重试短路 / 只有一行 / 没有换姿势行都要红）。
  {
    const r = judgeBootRetry({ ready, logs: bootLogs });
    check('握手失败会换 spawn 姿势重试（按结局分派：失败结局要求失败行逐次点名姿势与耗时；'
      + '就绪结局要求成功行在位 + 换姿势行齐形）',
      r.ok, r.detail);
    // 负对照（同一份 judgeBootRetry，纯合成日志）
    const READY_LINE = '系统媒体中间件就绪：mock 0.1.5（win32/x64），仅元数据';
    const RETRY_OK = '中间件握手失败（姿势=detached，1234ms，存活=true，两路输出都为空）'
      + ' ⇒ 换 spawn 姿势重试：detached → plain（总预算 90000ms 不翻倍）';
    const FAIL_2 = '中间件启动失败：hello 超时（预算 25000ms，存活=false，姿势=plain，'
      + '尝试 1/2：detached 15000ms 存活=true 两路输出都为空；尝试 2/2：plain 8000ms 存活=false 两路输出都为空）';
    check('negative control：**就绪结局**（CI 上真实形态：成功行在位、无失败行 ⇒ 曾在此恒红）⇒ 判据放行',
      judgeBootRetry({ ready: true, logs: [READY_LINE] }).ok === true,
      judgeBootRetry({ ready: true, logs: [READY_LINE] }).detail);
    check('negative control：就绪结局 + 中途换过姿势且行齐形 ⇒ 放行（这是"重试成功"的正常形态）',
      judgeBootRetry({ ready: true, logs: [RETRY_OK, READY_LINE] }).ok === true);
    check('negative control：就绪结局但换姿势行**同姿势空转**（detached → detached）⇒ 判红（口径没退化成恒绿）',
      judgeBootRetry({ ready: true, logs: [RETRY_OK.replace('detached → plain', 'detached → detached'), READY_LINE] }).ok === false);
    check('negative control：就绪结局但**成功行缺失**（说就绪却没有任何成功记账）⇒ 判红',
      judgeBootRetry({ ready: true, logs: [] }).ok === false);
    check('negative control：失败结局 + 两次尝试 + 两种姿势 + 换姿势行 ⇒ 放行（原判据的语义仍被钉住）',
      judgeBootRetry({ ready: false, logs: [RETRY_OK, FAIL_2] }).ok === true);
    check('negative control：失败结局但**重试被短路**（失败行只剩一次尝试、没有换姿势行）⇒ 判红（牙齿与原判据一致）',
      judgeBootRetry({ ready: false, logs: [FAIL_2.replace('尝试 2/2：plain 8000ms 存活=false 两路输出都为空', '')] }).ok === false
      && judgeBootRetry({ ready: false, logs: [FAIL_2.replace('（总预算', '（')] }).ok === false);
    check('negative control：失败结局却**没有失败行** ⇒ 判红（"没走到这条结局"不许当通过）',
      judgeBootRetry({ ready: false, logs: [READY_LINE] }).ok === false);
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
// ⚠️ 这个夹具是"握手失败 ⇒ 换姿势重试"的**确定性**来源：坏产物必然握不上手（不需要 CI 抖动、
//    也不需要本地有可用产物）⇒ 两次尝试 + 换姿势行 + 失败行必然出现。把它记下来喂同一条
//    `judgeBootRetry`，于是"重试被短路 / 换姿势行丢了"在任何一次运行里都会红。
const bogLogs = [];
const bog = createMediaBackend({ dataDir: join(TEST_DIR, 'bogus'), log: (m) => { bogLogs.push(String(m)); } });
bog.start({ audio: false, online: false });
let bogFallback = '';
for (let i = 0; i < 120 && !bogFallback; i++) { await sleep(150); bogFallback = bog.status().fallback || ''; }
check('坏产物 → 回落内置实现（不无限等）', Boolean(bogFallback) && bog.usingBridge() === false,
  bogFallback || '（超时未回落）');
{
  const r = judgeBootRetry({ ready: bog.usingBridge(), logs: bogLogs });
  check('确定性夹具：坏产物逼出握手失败 ⇒ 同一条判据的**失败结局分支**真被走到（两次尝试 + 两种姿势 + 换姿势行）',
    r.ok, r.detail);
}
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

// 判据名唯一：同一条判据被数两次会把"1 个失败"读成"2 个失败"（失败支路曾经如此），也让下面的
// 覆盖面地板失去意义。**这条有牙**：任何重名都会红。
check('判据名唯一（同一条判据不许计数两次）',
  checkNames.length === new Set(checkNames).size,
  `${checkNames.length} 条判据 / ${new Set(checkNames).size} 个唯一名字`);

// ── 退出码 + 判词契约（CI 修法 B；包装器 `test/verify-bridge-ci.mjs` 按它消费）──────────────
// 判别式收成**纯函数**：ok=0 / environment=3 / 其它=1（回归 · 产物不可信 · 探针缺失或自相矛盾）。
// `verdict` 四值就是包装器认的那四个；下文用合成输入钉住映射（负对照与生产走同一函数）。
function resolveOutcome({ failedCount, envOnly, probeVerdict, trustOk, blockedCount, allowSkip }) {
  // "没跑"与"通过"不能同形：缺前置且没显式接受 ⇒ fail-closed 判回归。
  if (blockedCount > 0 && !allowSkip) return { verdict: 'regression', code: 1 };
  if (failedCount === 0) return { verdict: 'ok', code: 0 };
  if (trustOk === false) return { verdict: 'untrusted', code: 1 };
  // ⚠️ **这两条的先后顺序就是语义**，必须是显式决定的（不是"碰巧"）：
  //   探针说 `regression` ⇒ 直接判回归，**不许**被 `envOnly` 降级成"环境跳过"。
  //   反例（本判据修之前的样子）：`envOnly` 那条排在前面 ⇒
  //   `envOnly=true + trustOk=true + probeVerdict='regression'` 会落成 environment/3，
  //   即"探针说这是真回归，却被记成环境差异"⇒ fail-closed 静默失效。
  //   生产路径当前**不可达**（`channelSkipped` 只在探针**不是** regression 的分支里赋值），
  //   但正是这一格要由下面的矩阵钉住 —— 将来谁把赋值分支重构走，矩阵会红。
  if (probeVerdict === 'regression') return { verdict: 'regression', code: 1 };
  // 环境差异必须是**唯一**失败来源，且产物 sha256 可信 —— 两个条件缺一不可。
  if (envOnly && trustOk === true && failedCount === 1) return { verdict: 'environment', code: 3 };
  return { verdict: 'regression', code: 1 };   // 探针缺失 / 自相矛盾 ⇒ fail-closed
}
const outcome = resolveOutcome({
  failedCount: failed, envOnly: Boolean(channelSkipped), probeVerdict,
  trustOk: artifactTrustOk, blockedCount: blocked, allowSkip: ALLOW_SKIP,
});

/**
 * 退出码矩阵的判据本体（生产与负对照共用）：喂一个"解析器"跑完整张矩阵 ⇒ 不合格清单。
 * @param {Array<[object, string, number]>} rows `[输入, 期望 verdict, 期望退出码]`
 * @param {(input: object) => {verdict: string, code: number}} resolveFn
 * @returns {string[]} 空 = 全对
 */
function outcomeMatrixFailures(rows, resolveFn) {
  const bad = [];
  for (const [input, verdict, code] of rows) {
    const o = resolveFn(input);
    if (o.verdict !== verdict || o.code !== code) {
      bad.push(JSON.stringify(input) + ' ⇒ 期望 ' + verdict + '/' + code + ' 实测 ' + o.verdict + '/' + o.code);
    }
  }
  return bad;
}
/**
 * 合成输入矩阵（**6 组，无重复行**）。
 * ⚠️ 本表**不许有重复行**（逐字相同的行零新增判别力），且必须含最能区分分支顺序的那组：
 *    `envOnly=true + trustOk=true + failedCount=1 + probeVerdict='regression'`。
 *    那组**必须**落 `regression/1`：它是唯一能区分判定顺序的输入（落 `environment/3` 就说明顺序被绕过）。
 */
const OUTCOME_ROWS = [
  [{ failedCount: 0, envOnly: false, probeVerdict: '', trustOk: null, blockedCount: 0, allowSkip: false }, 'ok', 0],
  [{ failedCount: 1, envOnly: true, probeVerdict: 'environment', trustOk: true, blockedCount: 0, allowSkip: false }, 'environment', 3],
  [{ failedCount: 1, envOnly: false, probeVerdict: 'regression', trustOk: true, blockedCount: 0, allowSkip: false }, 'regression', 1],
  [{ failedCount: 1, envOnly: false, probeVerdict: 'environment', trustOk: false, blockedCount: 0, allowSkip: false }, 'untrusted', 1],
  [{ failedCount: 0, envOnly: false, probeVerdict: '', trustOk: null, blockedCount: 1, allowSkip: false }, 'regression', 1],
  // ★ 原先缺失的那格：环境差异与"产物可信"都成立，但**探针判回归** ⇒ 必须是回归，不许降级成跳过。
  [{ failedCount: 1, envOnly: true, probeVerdict: 'regression', trustOk: true, blockedCount: 0, allowSkip: false }, 'regression', 1],
];
{
  const bad = outcomeMatrixFailures(OUTCOME_ROWS, resolveOutcome);
  check('退出码契约：四个判词的映射（合成输入钉住 ok / environment / regression / untrusted；'
    + '含"环境差异成立但探针判回归 ⇒ 必须回归"那格）',
    bad.length === 0,
    bad.join('；') || `${OUTCOME_ROWS.length} 组输入全部相符 · 生产路径本次 = verdict ${outcome.verdict} / code ${outcome.code}`);
  // 负对照 1：**键序**对调 ⇒ 结论不变（函数按名字解构，不许依赖对象的键序）
  const flipped = OUTCOME_ROWS.map(([input, v, c]) => {
    const reordered = {};
    for (const k of Object.keys(input).reverse()) reordered[k] = input[k];
    return [reordered, v, c];
  });
  check('negative control：同一批输入把**键序**对调 ⇒ 同一条矩阵判据结论不变（不靠对象遍历顺序碰巧对）',
    outcomeMatrixFailures(flipped, resolveOutcome).length === 0
    && outcomeMatrixFailures([...OUTCOME_ROWS].reverse(), resolveOutcome).length === 0);
  // 负对照 2：**分支序**对调的变异体（把"环境差异"那条挪回"探针判回归"之前 = 修前的样子）⇒
  //   同一张矩阵必须把它判红。这条证明矩阵真的锚定了顺序，而不是"顺序换了也照样绿"。
  const mutantResolve = ({ failedCount, envOnly, probeVerdict, trustOk, blockedCount, allowSkip }) => {
    if (blockedCount > 0 && !allowSkip) return { verdict: 'regression', code: 1 };
    if (failedCount === 0) return { verdict: 'ok', code: 0 };
    if (envOnly && trustOk === true && failedCount === 1) return { verdict: 'environment', code: 3 }; // ← 修前的顺序
    if (trustOk === false) return { verdict: 'untrusted', code: 1 };
    if (probeVerdict === 'regression') return { verdict: 'regression', code: 1 };
    return { verdict: 'regression', code: 1 };
  };
  const mutantBad = outcomeMatrixFailures(OUTCOME_ROWS, mutantResolve);
  check('negative control：把 `envOnly` 判据挪到 `probeVerdict=regression` 之前的变异体 ⇒ 同一张矩阵判红'
    + '（顺序即语义，且被矩阵钉住）',
    mutantBad.length === 1 && /environment\/3/.test(mutantBad[0]), mutantBad.join('；') || '**没判红**');
}

// 「环境跳过」那条判据按**新契约**改口径：它要防的仍是"跳过不与通过同形"（现在两者退出码不同：
// 3 vs 0），但断言从「failed ≥ 1」升级成「退出码=3 **且** 仍有 ✗ 计数」—— 比原来更严。
check('环境差异不与通过同形（唯一失败来源是环境差异 ⇒ 退出码 3，且仍有 ✗ 计数）',
  !channelSkipped || (outcome.code === 3 && outcome.verdict === 'environment' && failed >= 1),
  channelSkipped
    ? `本次环境跳过：verdict=${outcome.verdict} code=${outcome.code} failed=${failed}（必须 code=3 且 failed ≥ 1）`
    : '本次没有环境跳过');

// 覆盖面地板（全局）：离线那一段（产物表 7 / 歌词 3 / 反向控制 5 / 探针判定 4 = 19 条，加文末
// 两条契约判据 = **21** 条）与有没有产物无关，恒在。整段被短路或删空时，下面的"全绿 / --allow-skip"
// 就是**空域上的通过**，所以钉一个绝对下界（改离线判据条数时同步改这个数）。
check('覆盖面地板：本次至少执行 21 条判据（否则汇总的"通过"是空域上的）', passed + failed >= 21,
  '已执行 ' + (passed + failed) + ' 条');

/** 机器可读判词行**恰好一次**（包装器 fail-closed：缺这行当红）。 */
let verdictEmitted = false;
const emitVerdict = (v) => {
  if (verdictEmitted) return;
  verdictEmitted = true;
  console.log(`[media-bridge] verdict=${v}`);
};

console.log(`\nmedia-bridge 自检：${passed} 通过 / ${failed} 失败`
  + `${skipped ? ` / ${skipped} 平台跳过` : ''}`
  + `${blocked ? ` / ${blocked} 未执行（缺前置）` : ''}`);
if (blocked && !ALLOW_SKIP) {
  console.log(`\n✗ 有 ${blocked} 段因缺前置**没有执行**（${blockedNames.join('、')}）—— `
    + '默认判失败，因为"没跑"与"通过"不能同形。');
  console.log('  要么补前置（--provision / 设 DSH_WE_MEDIA_BRIDGE），要么显式接受：--allow-skip');
  emitVerdict(outcome.verdict);
  process.exit(outcome.code);
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
  console.log('   ⚠️ **本次仍然不是绿**（退出码 3，"中间件就绪"那条给的是 ✗）：'
    + '这条通道没被断言，就不能与"通过"同形。判词里的"环境差异"说的是**红的原因**，不是"可以不管"。');
}
emitVerdict(outcome.verdict);
// 退出码契约：0 = 全 ok；3 = 唯一失败来源是环境差异（探针判 environment 且产物可信）；
// 其它（回归 / 产物不可信 / 探针缺失或矛盾）= 1 —— 见文件头与 `resolveOutcome()`。
process.exit(outcome.code);
