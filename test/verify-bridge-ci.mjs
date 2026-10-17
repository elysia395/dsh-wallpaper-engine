#!/usr/bin/env node
/**
 * verify-bridge-ci.mjs —— media-bridge 端到端自检的 **CI 入口**：按「判词」定红绿。
 *
 * 为什么需要它：`test/verify-media-bridge.mjs` 有三种结局（ok / 环境差异 / 回归），而 CI 只读退出码 ——
 * runner 侧的环境抖动会让"环境差异"与"回归"长得一样，于是整条 run 红，却指向不了任何改动。
 * 这个入口只做一件事：**把「仅环境差异」降级为注解式跳过并退出 0**，其余一律照旧。
 *
 * 消费的契约（由 `test/verify-media-bridge.mjs` 提供）：
 *   · 退出码：`0` = 全部判据 ok；`3` = **唯一**失败来源是"环境差异"（探针判 environment 且产物可信）；
 *     其它任何失败 = `1`；
 *   · 判词：三种结局都打印一行 `[media-bridge] verdict=ok|environment|regression|untrusted`（只出现一次）。
 *
 * 红绿规则（**fail-closed**：看不懂就红，绝不把"没看懂"当跳过）：
 *   码 0 + `verdict=ok`            → 退出 0（通过）
 *   码 0 + 缺判词 / 其它判词         → 退出 1（**没有判词就没有"通过"的凭据**）
 *   码 3 + `verdict=environment`    → `::warning::` 注解 + 具名 SKIP，退出 0（**唯一的降级路径**）
 *   码 3 + 缺判词 / 其它判词         → 退出 3（不降级）
 *   其它任何非 0 码                 → **原样透传**
 *   判词**不止一行**（"只出现一次"这条契约被破坏）/ spawn 失败 / 被信号结束 / 码为 null → 退出 1
 *
 * 机制说明（为什么落一个临时文件，而不是 `stdio:'inherit'` 或 `'pipe'`）：
 *   判词必须**被父进程读到**才能核对，而 `stdio:'inherit'` 的子进程输出直接进 CI 日志、父进程读不到；
 *   `stdio:'pipe'` 在受限沙箱里 spawn 会 `EPERM`（本仓 CI 等价性实测踩到过）。因此这里把子进程的
 *   stdout 重定向到一个**临时文件**，子进程结束后**逐字节回放**到本进程 stdout（日志内容与 inherit
 *   相同，只是不再实时），再核对判词。stdin/stderr 仍是 inherit。
 *
 * 用法：node test/verify-bridge-ci.mjs [--provision …]      # 参数原样透传给自检
 * 严格口径（三种结局都非 0）：npm run verify:bridge:strict
 * 自检钩子：`DSH_VERIFY_BRIDGE_CHILD=<path>` 覆盖子进程路径（**仅供本入口自身的负对照**）。
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHILD = process.env.DSH_VERIFY_BRIDGE_CHILD || join(HERE, 'verify-media-bridge.mjs');
const CHILD_ARGS = process.argv.slice(2);
const VERDICT_RE = /\[media-bridge\]\s+verdict=(ok|environment|regression|untrusted)\b/g;
const TAG = '[verify-bridge-ci]';

console.log(TAG + ' 子进程：' + CHILD + (CHILD_ARGS.length ? ' ' + CHILD_ARGS.join(' ') : ''));

if (!existsSync(CHILD)) {
  console.log('::error title=media-bridge spawn::子进程不存在：' + CHILD + ' —— fail-closed（不当跳过）');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'we-verify-bridge-'));
const outPath = join(dir, 'child-stdout.log');
const fd = openSync(outPath, 'a');
let settled = false;

/** 读子进程输出（读不到——例如写入方还占着句柄——就返回空串，流程不会因此中断）。 */
const readOut = () => { try { return readFileSync(outPath, 'utf8'); } catch { return ''; } };

/**
 * 把**新增**的字节转到本进程 stdout：先到先出，长步骤（~90s）在 CI 日志里不会"最后一次性刷出"。
 * 若运行中读不到（句柄被占），退化为结束后一次性回放 —— 内容一样，只是不实时。
 */
let forwarded = 0;
const forwardNew = (text) => {
  if (text.length > forwarded) { process.stdout.write(text.slice(forwarded)); forwarded = text.length; }
};
const timer = setInterval(() => forwardNew(readOut()), 250);

/** 收尾时把剩下的字节一次性补上（并返回全文供核对判词）。 */
const replay = () => { const text = readOut(); forwardNew(text); return text; };

const verdictsOf = (text) => (text.match(new RegExp(VERDICT_RE.source, 'g')) || [])
  .map((s) => s.replace(/.*verdict=/, ''));

const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };

function decide(code, signal, spawnErr) {
  if (settled) return;
  settled = true;
  clearInterval(timer);
  try { closeSync(fd); } catch { /* ignore */ }
  const text = replay();
  const found = verdictsOf(text);
  const verdict = found.length ? found[found.length - 1] : null;
  cleanup();

  if (spawnErr) {
    console.log('::error title=media-bridge spawn::spawn 失败（' + spawnErr + '）—— fail-closed，不当跳过');
    process.exit(1);
  }
  if (signal) {
    console.log('::error title=media-bridge signal::子进程被信号结束（' + signal + '）—— fail-closed，不当跳过');
    process.exit(1);
  }
  if (code === null || code === undefined) {
    console.log('::error title=media-bridge exit::拿不到退出码（非信号、非正常结束）—— fail-closed，不当跳过');
    process.exit(1);
  }
  if (found.length > 1) {
    console.log('::error title=media-bridge verdict::判词出现了 ' + found.length + ' 行（'
      + [...new Set(found)].join(' / ') + '）—— 契约是"只出现一次"，fail-closed，不当跳过');
    process.exit(1);
  }

  if (code === 0) {
    if (verdict !== 'ok') {
      console.log('::error title=media-bridge verdict::退出码 0 但没有 `verdict=ok` 判词（'
        + (verdict ? '判词是 ' + verdict : '缺判词')
        + '）—— 没有判词就没有"通过"的凭据，fail-closed');
      process.exit(1);
    }
    console.log(TAG + ' 通过（子进程退出码 0，判词 ' + verdict + '）。');
    process.exit(0);
  }

  if (code === 3) {
    if (verdict === 'environment') {
      console.log('::warning title=media-bridge env-skip::唯一失败来源是环境差异（判词 verdict=environment）'
        + ' ⇒ 本步按**跳过**处理并退出 0：这条通道本次没有断言覆盖，不得与通过同形。');
      console.log('SKIP verify:bridge（media-bridge 端到端）—— 唯一失败来源是环境差异（探针判 environment +'
        + ' 产物可信，判词 verdict=environment）：**这条通道本次没有断言覆盖，不得与通过同形**。'
        + ' 要严格口径（三种结局都非 0）用 npm run verify:bridge:strict。');
      process.exit(0);
    }
    console.log('::error title=media-bridge env-skip::退出码 3 声称"仅环境差异"，但判词'
      + (verdict ? '是 ' + verdict : '缺失') + ' —— 不降级，fail-closed');
    process.exit(3);
  }

  console.log(TAG + ' 子进程退出码 ' + code + (verdict ? '（判词 ' + verdict + '）' : '（无判词）')
    + ' —— 原样透传。');
  process.exit(code);
}

const child = spawn(process.execPath, [CHILD, ...CHILD_ARGS], {
  stdio: ['inherit', fd, 'inherit'],
  env: process.env,
});
child.on('error', (err) => decide(null, null, err && err.code ? err.code : String(err)));
child.on('close', (code, signal) => decide(code, signal, null));
