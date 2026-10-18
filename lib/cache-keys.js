/**
 * cache-keys.js — 缓存产物文件名的**唯一**键派生点（帧抓取 / 场景视频 / 场景音频）。
 *
 * 为什么单独成模块：这三个命名空间原先各自拼一遍
 * `前缀 + '_' + base64url(abs) + '_' + round(mtime)`。base64url 的长度是路径长度的
 * **1.34 倍**，于是键长度随 checkout 深度线性增长 —— 深目录里 `abs` 只要到 176 字节，
 * 产物名就顶到 256 字节，越过 NAME_MAX（255）⇒ `ENAMETOOLONG`，表现为一批与代码
 * 无关的假红（issue #208）。
 *
 * 不变量：
 *  1. **键里不出现可逆的路径编码**。只放 `sha256(abs)` 的前 `ABS_HASH_HEX` 个十六进制
 *     字符 ⇒ 文件名长度与 checkout 深度**无关**，恒为上界
 *     `前缀(3) + 1 + 16 + 1 + 13 + 后缀`，最长的是抓帧临时名 `……_gpu.png.tmp<pid><6位>`
 *     ≈ 56 字节，离 255 有两个数量级的余量。
 *  2. **没有反向解析**。全仓不按名反解路径、不 `readdir` 枚举后反推 abs：缓存清理一律按
 *     子目录整删，读侧一律用同一个 `cacheKeyFor()` 现算 ⇒ 短哈希不会让任何既有语义失效。
 *  3. **碰撞代价可接受**：64 位空间（16 hex）在「几千个壁纸」量级下的碰撞概率 ~1e-14；
 *     真发生时后果是两个源共用一个槽位，与「mtime 相同」同类。要更保守只能加长，
 *     但那会把长度预算重新拉回路径相关 —— 本仓选短哈希，不选截断+去重（后者要扫目录
 *     并在并发写者之间抢名字，竞态面远大于收益）。
 *  4. **一改键形态就必须 bump 前缀版本**（`lf1` → `lf2` 等）：旧前缀下的产物不会被新键
 *     命中，否则「改了却没生效」。版本前缀仍由各调用方持有（它们对自己的渲染语义负责），
 *     本模块只管「命名空间之后那一段」的派生规则统一。
 *  5. 本模块**不进** `INLINE_MODULES`：浏览器半不需要算缓存键，宿主侧唯一消费者。
 */
import { createHash } from 'node:crypto';

/**
 * abs 路径摘要长度（十六进制字符数）。16 hex = 64 bit。
 *
 * 上界推导（判据 `verify-scene.mjs` Level E 会按最长产物名复算一遍）：
 * 抓帧临时名 = `lf2` + `_` + 16 + `_` + 13(mtime 毫秒) + `_gpu.png` + `.tmp` + pid + 6 位序号
 * = 4 + 16 + 1 + 13 + 8 + 4 + 5 + 6 ≈ 57 字节。
 */
export const ABS_HASH_HEX = 16;

/** `sha256(abs)` 的前 `ABS_HASH_HEX` 个十六进制字符（小写）。 */
export function absDigest(abs) {
  return createHash('sha256').update(String(abs), 'utf8').digest('hex').slice(0, ABS_HASH_HEX);
}

/**
 * 缓存产物的键：`<命名空间>_<absDigest>_<mtime 毫秒>`。
 *
 * @param {string} namespace 命名空间前缀（含版本号，如 `lf2` / `sv1` / `sa1`）
 * @param {string} abs 源文件绝对路径
 * @param {number} mtime 源文件 mtime（毫秒；取不到时传 0）
 * @returns {string}
 */
export function cacheKeyFor(namespace, abs, mtime) {
  // mtime 取不到时**不许**把 `NaN` 写进文件名：那会造出一个谁也命中不了、也认不出来的产物名。
  // 与 `sceneVideoProbeKey` 的 `Math.round(Number(m) || 0)` 同口径。
  return namespace + '_' + absDigest(abs) + '_' + Math.round(Number(mtime) || 0);
}
