/**
 * http-body.js —— 收**要整体缓冲**的请求体：**累加 · 字节计闸 · 一次解码**，这三件事的唯一实现。
 *
 * 为什么单独一个模块：这段逻辑（**累加 · 字节计闸 · 一次解码**）**只许有一处实现**，
 * 抄成多份有两件事各自有代价：
 *   · **抄漏上限** —— 新加的路由忘了抄闸，缺口就会多一条。
 *     这一半现在由 `test/verify-body-caps.mjs` **从磁盘枚举**每个 `req.on('data')` 站点看住。
 *   · **改一处要改十三处** —— 就是本模块要解决的另一半。
 *
 * ⚠️ **两条不变量**（与 `lib/routes/upload.js` 文件头同源，别在这里写岔）：
 *   ① **上限按累计字节判**（`size += chunk.length`），不是按块数、也不是按最终长度 ——
 *      按最终长度判等于先收完再拒，闸就没意义了。
 *   ② **收完只解码一次**（`Buffer.concat(chunks).toString('utf8')`）。逐块 `body += chunk`
 *      会把跨 TCP 分片的多字节码点切成 U+FFFD，用户可见字符串（壁纸 id / 字体名 / 字体族）
 *      被静默写坏且客户端不会知道。
 *
 * ⚠️ **不适用：边收边落盘的流式上传。** `/upload`（上限 512MB）与 `/custom-frame` 是
 * "边收边写 `.tmp` + 背压 + 增量 sha256"的另一种形状，**不许**把体缓冲进内存
 * （见 `lib/routes/upload.js` 文件头）。它们是本模块的**结构性豁免**，不是待迁移项 ——
 * 判据里也是按"豁免"记的，不是按"漏了"记的。
 *
 * 用法（**与调用点原有形态同形**：只把内联的 data 处理器换掉，`end` / 超时 / 断开收口都留在调用点）：
 *
 *   const reader = bodyReader(req, {
 *     maxBytes: CONTROL_JSON_MAX_BYTES,
 *     shouldStop: () => timedOut,                       // 可选：调用点自己的中止条件
 *     onOverflow: () => { tooLarge = true; res.statusCode = 413; res.end(); },
 *   });
 *   req.on('data', reader.onData);
 *   req.on('end', () => {
 *     if (timedOut || tooLarge) return;
 *     const body = reader.text();                       // ← 一次解码
 *     ...
 *   });
 *
 * 为什么是"处理器 + 取值器"而不是一个 `await readBody()`：各站点的**应答 / 超时 / 断开**
 * 策略互不相同（有的 `fail(413)`、有的直接写 `res.statusCode`、有的还要等落盘），
 * 把它们也抽象进来只会把差异藏进参数里。本模块只吃**那三件真正重复的事**。
 *
 * 浏览器安全无关（这是宿主半边），只用 `node:` 内置能力，无第三方依赖。
 */

/**
 * 小控制面 JSON 请求体的**统一上限**（64 KiB）—— **单一真源**，就住在收体器旁边。
 *
 * 为什么在这里而不是门面：它服务的正是本模块的调用点（`maxBytes: CONTROL_JSON_MAX_BYTES`，
 * 见上方用法示例），而出户的媒体桥组件**也要**用它（`packages/media-bridge/lib/routes/now-playing.js`
 * 的 `/media-control`）⇒ 常量必须有"门面之外也够得着"的落点。本轮把它从 `lib/index.js` 的
 * 门面局部常量挪到这里，**值一字未变**（`64 * 1024`），门面改为 import。
 */
export const CONTROL_JSON_MAX_BYTES = 64 * 1024;

/**
 * 造一个缓冲收集器。
 *
 * @param {import('node:http').IncomingMessage} req 请求（**只用来读 `aborted` 之类的即时状态**；
 *   监听器的挂载仍由调用点做）
 * @param {{ maxBytes?: number, shouldStop?: () => boolean, onOverflow?: () => void }} [opts]
 *   `maxBytes` 在**类型上可选**是刻意的：给出上限这件事由**运行期**守 —— 漏写时在第一个请求上
 *   当场抛错（见下），而不是悄悄用一个默认值。类型签名不替运行期假装守住这条不变量。
 *   其余两项：`shouldStop` 是调用点自己的中止条件（如 `() => timedOut`），命中后**不再累加** ——
 *   超时/已判失败的请求体不该继续占内存；`onOverflow` 在首次越限时**立即**回调
 *   （调用点据此当场应答 413，而不是等体收完），只回调一次。
 * @returns {{ onData: (chunk: Buffer) => void, overflowed: boolean, bytes: number,
 *   buf: () => Buffer, text: () => string }}
 */
export function bodyReader(req, { maxBytes, shouldStop, onOverflow } = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('bodyReader 需要 maxBytes（正整数）—— 收 body 必须有上限，这是不变量不是选项');
  }
  const chunks = [];
  let size = 0;
  let overflowed = false;

  const onData = (chunk) => {
    if (overflowed) return;
    if (shouldStop && shouldStop()) return;
    size += chunk.length;
    if (size > maxBytes) {
      overflowed = true;
      // 先置位再回调：回调里的应答若同步抛错，也不会让后续块重新进入累加。
      if (onOverflow) onOverflow();
      return;
    }
    chunks.push(chunk);
  };

  return {
    onData,
    get overflowed() { return overflowed; },
    get bytes() { return size; },
    /** 一次 `Buffer.concat`（二进制站点用这个，如 GPU 帧）。 */
    buf: () => Buffer.concat(chunks),
    /** 一次 `Buffer.concat` + **只解码这一次**（字符串站点用这个）。 */
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}
