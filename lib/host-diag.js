// 宿主侧诊断落盘（diagnostics sink）。
//
// 为什么单独成模块：这条通道有两个**模块级状态**（`diagBytes` 的轮转水位、`reqLogSeen`
// 的去重表），而它们只服务于「把一行 JSON 落盘」这一件事。留在门面里时，任何一次
// 门面级重构都要重新核对这两个状态的读写点；搬进来之后，状态与它的唯一写者同址。
//
// 不变量（逐条都有对应判据/注释）：
//   I1 诊断失败**绝不影响服务**：整条写入路径包在 try/catch 里，异常一律吞掉。
//   I2 去重表有**硬上界**（`REQ_LOG_SEEN_MAX`，按插入序淘汰最旧）：键里带请求可控的
//      路径段（`/live-frame` 的 token 等）⇒ 只增不减会让堆单向增长。
//   I3 轮转只发生在**写入之前**，且只留一代（`http.jsonl` → `http.jsonl.1`）：
//      目录占用有硬上界 2×`DIAG_MAX_BYTES`，而本次这一行绝不丢。
//   I4 诊断目录由宿主注入的 `configPath` 推出（`<dataDir>/diag/http.jsonl`）：
//      路径解析口径与插件数据目录保持**唯一**来源。
//
// 调用方：门面（apply）把 `appendDiagLine` / `traceRequests` 注入各路由族与套件；
// 留在门面的 `traceMediaRequests` 复用同两个名字。改动需重启 DSH 生效。
import { mkdirSync, existsSync, statSync, renameSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** 工厂：只注入 `configPath`（诊断目录 = `dirname(configPath())/diag`）。 */
export function createHostDiagKit({ configPath }) {
  /**
   * 诊断落盘：把「非 200 的 HTTP 响应 / 路径围栏」按行追加到
   * `~/.dsh-wallpaper-engine/diag/http.jsonl`。
   *
   * 为什么用文件而不是 console.log：DSH Desktop 的运行日志只收录各插件 logger 的
   * 输出，host 的 stdout 拿不到 —— 排查「桌面端黑屏但浏览器正常」这类只在某个宿主
   * 环境出现的问题时，需要一个与宿主无关、事后可读的通道。
   *
   * 大小轮转：这条通道是**常开的**（渲染页上报 + 心跳 + 请求记录），没有上限时它会一路长到
   * 几十 MB（实测一段时间的会话即到 69.8 MB），而后人排查只需要最近的那一段。上限取
   * `DIAG_MAX_BYTES`，到顶就把当前文件改名为 `http.jsonl.1`（**只留一代**，更旧的被覆盖），
   * 于是目录占用有硬上界 2×上限。字节数在内存里累加，不做逐次 `statSync`。
   *
   * 不变量：无论轮转与否，`/diag-log`（内存环形缓冲，最近 80 条）与每行的 JSON 形状都不变；
   * 轮转只发生在**写入之前**，绝不丢当次这一行。
   */
  const DIAG_MAX_BYTES = 8 * 1024 * 1024;
  let diagBytes = -1;   // -1 = 尚未探测盘上现有大小
  function appendDiagLine(kind, obj) {
    try {
      const dir = join(dirname(configPath()), 'diag');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'http.jsonl');
      if (diagBytes < 0) diagBytes = existsSync(file) ? statSync(file).size : 0;
      if (diagBytes >= DIAG_MAX_BYTES) {
        // 文件可能已被清理工具删除、或被并行实例抢先轮转（诊断文件多实例共用）——
        // rename ENOENT 若不加防，此后每次 append 都在 rename 处抛、被外层 catch 吞，
        // 诊断通道对本次进程**静默死亡**。缺失/竞态一律按新文件从零计。
        if (existsSync(file)) {
          try {
            renameSync(file, file + '.1');
          } catch {
            /* 被并行实例抢先 ⇒ 本次不轮转，现有文件继续追加 */
          }
        }
        diagBytes = 0;
      }
      const line = JSON.stringify({ t: Date.now(), kind, ...obj }) + '\n';
      appendFileSync(file, line);
      diagBytes += Buffer.byteLength(line);
    } catch { /* 诊断失败不影响服务 */ }
  }


  /**
   * 请求记录（含成功的 200）：同 route+path 十秒内只记一条，避免刷屏。
   *
   * 为什么连 200 也要记：排查「画面黑但服务端无任何 4xx」时，唯一的判据是
   * **某个请求到底有没有发生**（例如壁纸入口是否真被 iframe 请求过）——
   * 只看错误码会把「没请求」与「请求成功」混为一谈。
   *
   * ⚠️ 这张表**必须有上界**：键里带**请求可控**的路径段（`/scene-files` 子路径、
   * `/live-frame` 的 token、`/scene-live` 的 pathname …），而请求方是任意页面。
   * 只 get/set 而不回收时，会话期内互不相同的请求会让堆**单向增长**（实测 20 万个不同的
   * `/live-frame/<随机>` 把 heapUsed 从 32.2MB 抬到 72.4MB 且不释放）。
   * 下面的 TTL 只抑制**写入**，不清理条目 ⇒ 上界由 `REQ_LOG_SEEN_MAX` 单独保证。
   */
  const REQ_LOG_DEDUP_MS = 10000;
  /** 去重表的硬上界（条）。超界按插入序淘汰最旧的 ⇒ 内存有界。 */
  const REQ_LOG_SEEN_MAX = 2000;
  const reqLogSeen = new Map();
  /**
   * 去重判定 + 记账。返回 true 表示"这一条该落盘"。
   *
   * 上界与去重是**两个**要求，冲突时上界优先：条目被淘汰后同一键可能再落一条重复行 ——
   * 这是可接受的（诊断去重本就是尽力而为），而内存有界是硬要求。
   */
  function reqLogSeenTouch(key, now, ttlMs) {
    const last = reqLogSeen.get(key);
    if (last !== undefined && now - last < ttlMs) return false;
    reqLogSeen.set(key, now);
    // Map 保持插入序 ⇒ 队首就是最旧的键。
    while (reqLogSeen.size > REQ_LOG_SEEN_MAX) {
      const oldest = reqLogSeen.keys().next();
      if (oldest.done) break;
      reqLogSeen.delete(oldest.value);
    }
    return true;
  }
  /**
   * 诊断里的路径折叠：场景/网页壁纸的路径首段是 base64 的绝对路径（很长），
   * 原样落盘等于什么都没记（只剩一串 base64）。折叠成 `<token>/…`，留下真正
   * 有信息量的文件名 / 子路径。
   */
  function foldTokenPath(p) {
    const raw = String(p || '');
    const slash = raw.indexOf('/');
    return (slash > 40 ? '<token>/' + raw.slice(slash + 1) : raw).slice(0, 150);
  }
  function traceRequests(res, route, pathKey) {
    try {
      const key = route + '\u0000' + String(pathKey);
      const now = Date.now();
      if (!reqLogSeenTouch(key, now, REQ_LOG_DEDUP_MS)) return;
      res.on('finish', () => {
        appendDiagLine('req', {
          route,
          path: foldTokenPath(pathKey),
          status: res.statusCode || 0,
          dest: String(res.req && res.req.headers ? res.req.headers['sec-fetch-dest'] || '' : ''),
        });
      });
    } catch { /* ignore */ }
  }

  return { appendDiagLine, traceRequests, foldTokenPath };
}
