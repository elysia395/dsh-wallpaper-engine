/**
 * occlusion/index.js — 遮挡数据 **hub**：适配器之上的状态机与生命周期唯一持有者。
 *
 * ══ 为什么值得独立成文件 ══════════════════════════════════════════════════════
 * 「采集」（x11.js）与「快照语义」（epoch/gen/降级/心跳）是两件事：前者是平台细节，
 * 后者是**渲染器契约**（docs/wip/LINUX-OCCLUSION.md §1）。渲染器只认快照形状与
 * `ts` 新鲜度，不关心底下是 X11 还是 Wayland —— hub 把这两件事隔开，让将来的
 * Wayland 适配器（KWin 脚本 / sway IPC / portal）只是**换一个 createAdapter**。
 *
 * ══ 快照契约（消费方：lib/routes/occlusion.js → src/occlusion.js → WebWallGL）═══
 *   `{ ok:1, backend:'x11', epoch, gen, own:{w,h}, rects:[[x,y,w,h]…], ts }`
 *   · `rects` 已**相对自窗客户区原点**、单位是自窗像素（客户端按 innerWidth/own.w
 *     缩放到画布 CSS 像素）；`epoch` 标识坐标系来源，变 epoch ⇒ 渲染器全量重置；
 *   · 降级（无 X11 会话 / 适配器死亡 / EWMH 缺失）：`backend:'none'`、`own:null`、
 *     `rects:null` —— 客户端据此 postMessage `clearOcclusion`，渲染器回全速 run；
 *   · `gen` 只在 own/rects **内容**变化时递增（消费者拿它判「是不是旧一帧」）；
 *     `ts` 每次**成功或降级重算**都刷新 —— 渲染器对 >3s 陈旧快照自动清遮挡，所以
 *     hub 的 1Hz 心跳是**硬性要求**，绝不允许「只在事件时才算」。
 *
 * ══ 生命周期与不变量 ══════════════════════════════════════════════════════════
 *   · `start()` 幂等；任何失败**不抛出**——记日志后进入降级态并按 30s 上限退避重试
 *     （X 会话可能在插件启动后才可用，比如用户从 Wayland 重登回 X11）；
 *   · 1Hz 兜底轮询 + 适配器事件触发立即重算（合并间隔 200ms，防止 ConfigureNotify
 *     拖动风暴）；轮询失败 ⇒ 立即降级并重启重试循环；
 *   · `getSnapshot()` **永不抛错**、永不回 undefined —— 路由层据此可以零防御直发；
 *   · `dispose()` 幂等；清掉全部定时器与适配器连接（进 `c.disposers`）。
 */

import { isX11CandidateEnv, createX11Adapter } from './x11.js';

const POLL_INTERVAL_MS = 1000;   // 心跳：渲染器 3s 陈旧线的三倍余量。
const EVENT_COALESCE_MS = 200;   // 事件触发的最小重算间隔（拖动风暴闸）。
const RETRY_START_MS = 30_000;   // 降级后重建适配器的重试间隔（上限）。
const POLL_TIMEOUT_MS = 3_000;   // 单次 poll 的看门狗：x11 断连可能让在途应答永不回来。

/**
 * 造遮挡 hub（依赖全可注入：单测 / 探针）。
 *
 * `log` 的类型是**被调用面** `LogCall`（`log(msg, level?)`），不是 `LogFn`：hub 只调不读，
 * 所以缺省空实现、单测/探针里的单参回调都合法（形状真源见 `lib/log.js`）。
 *
 * @param {object} [o]
 * @param {import('../log.js').LogCall} [o.log] 日志被调用面（`log(msg, level?)`）；缺省空实现。
 * @param {(data:any) => void} [o.diag] 宿主注入 `appendDiagLine` 包装（**单参**：`diag({ ev, … })`）。可省。
 * @param {Function} [o.createAdapter] 适配器工厂（缺省 `createX11Adapter`）。
 * @param {(env?:any) => boolean} [o.isCandidate] 候选环境判定（缺省 `isX11CandidateEnv`）。
 * @param {number} [o.pollMs] 兜底轮询间隔（缺省 1000ms）。
 * @param {number} [o.retryStartMs] 降级后重建适配器的重试间隔上限（缺省 30s）。
 * @param {number} [o.pollTimeoutMs] 单次 poll 的看门狗（缺省 3s）；0/负值 = 关闭。
 * @param {() => number} [o.now] 时钟注入（缺省 `Date.now`）。
 * @param {number} [o.ownPid] 仅透传给适配器（探针/单测注入）；undefined ⇒ 适配器取 [pid, ppid]。
 */
export function createOcclusionHub({
  log = () => {},
  diag, // (obj) => void；宿主注入 appendDiagLine 包装。可省（单测/探针）。
  createAdapter = createX11Adapter,
  isCandidate = isX11CandidateEnv,
  pollMs = POLL_INTERVAL_MS,
  retryStartMs = RETRY_START_MS,
  pollTimeoutMs = POLL_TIMEOUT_MS, // 单测可调小；0/负值 = 关闭看门狗
  now = () => Date.now(),
  ownPid, // 仅透传给适配器（探针/单测注入用）；undefined ⇒ 适配器取 [pid, ppid]
} = {}) {
  let adapter = null;
  let started = false;
  let disposed = false;
  let pollTimer = null;
  let retryTimer = null;
  let lastEventAt = 0;
  // 事件触发重算只在「事件来的时机距上次计算足够远」时执行；事件风暴时退化为下一跳。
  let busy = false;
  let dirty = false; // 事件落在 busy/合并窗内被丢时置位 ⇒ finally 里补算一次（trailing）。
  let snapshot = degradedSnapshot(0, now());
  let lastContent = ''; // 上一次成功快照的内容指纹（gen 只在指纹变化时递增）。
  const seenLogs = new Set(); // 同类告警只记一次（适配器重建后允许再记）。

  // 日志回调的**安全包装**：hub 契约要求 log 抛错不得影响服务（与 diag 同等对待）。
  // 否则成功路径里 log 抛错会被 recompute 的通用 catch 吞成「假降级 + 拆健康适配器」。
  const safeLog = (msg) => {
    try {
      log(msg);
    } catch {
      /* 回调异常不是采集失败，绝不能触发降级 */
    }
  };

  function degradedSnapshot(gen, ts) {
    return { ok: 1, backend: 'none', epoch: '', gen, own: null, rects: null, ts };
  }

  function logOnce(key, msg) {
    if (seenLogs.has(key)) return;
    seenLogs.add(key);
    safeLog(`[occlusion] ${msg}`);
  }

  /** 内容变化比较：own/rects 都变才递增 gen；epoch 变化必然伴随内容变化。 */
  function contentOf(core) {
    return JSON.stringify([core.epoch, core.own, core.rects]);
  }

  async function recompute() {
    if (busy || disposed || !adapter) return;
    busy = true;
    // 看门狗：x11 断连时在途应答可能永不结算（client.replies 无清理）⇒ poll 永挂
    // ⇒ busy 永久卡 true、hub 静默冻结。超时按失败走同一条降级路径。
    let pollGuard = null;
    try {
      const pollPromise = adapter.poll();
      const result = await (pollTimeoutMs > 0
        ? Promise.race([
            pollPromise,
            new Promise((_, reject) => {
              pollGuard = setTimeout(() => reject(new Error(`x11 poll timeout (${pollTimeoutMs}ms; connection dead?)`)), pollTimeoutMs);
            }),
          ])
        : pollPromise);
      if (!result) throw new Error('adapter returned null (connection dead)');
      const ts = now();
      const own = result.own
        ? { w: result.own.w, h: result.own.h }
        : null;
      const rects = result.own && result.own.w > 0 && result.own.h > 0
        ? result.occluders.map((r) => [r[0] - result.own.x, r[1] - result.own.y, r[2], r[3]])
        : null;
      const nextContent = contentOf({ epoch: result.epoch, own, rects });
      const gen = nextContent !== lastContent ? snapshot.gen + 1 : snapshot.gen;
      const changed = gen !== snapshot.gen;
      lastContent = nextContent;
      snapshot = {
        ok: 1,
        backend: 'x11',
        epoch: result.epoch,
        gen,
        own,
        rects,
        ts,
      };
      // 内容变化日志（QA 契约：遮挡结果必须可观测）。gen 不变时静默 —— 1Hz 心跳
      // 不刷屏；变化时一行给出 own 尺寸、矩形数与可见率估计（面积口径，供对账）。
      if (changed) {
        const areaOwn = own ? own.w * own.h : 0;
        const areaOcc = rects ? rects.reduce((a, r) => a + r[2] * r[3], 0) : 0;
        const visible = areaOwn > 0 ? Math.max(0, 1 - areaOcc / areaOwn) : 1;
        const line = `[occlusion] snapshot gen=${gen} own=${own ? `${own.w}x${own.h}` : 'null'} rects=${rects ? rects.length : 'null'} visible=${visible.toFixed(2)} epoch=${result.epoch}`;
        safeLog(line);
        // 同一行落诊断档案（diag/http.jsonl，轮转）：utility 子进程的 console 在本
        // 架构里不回终端，档案是宿主侧唯一可靠落点。低频（仅内容变化）。
        if (typeof diag === 'function') {
          try {
            diag({ ev: 'snapshot', gen, own, rects: rects ? rects.length : null, visible: Number(visible.toFixed(3)), epoch: result.epoch });
          } catch { /* 诊断失败不影响服务 */ }
        }
      }
    } catch (err) {
      // 采集失败 ⇒ 降级（清遮挡，渲染器回全速），30s 后重建适配器重试。
      const gen = snapshot.backend === 'none' ? snapshot.gen : snapshot.gen + 1;
      lastContent = 'none';
      snapshot = degradedSnapshot(gen, now());
      logOnce('poll-failed', `x11 poll failed, degraded to backend=none: ${err && err.message}`);
      if (typeof diag === 'function') {
        try {
          diag({ ev: 'degrade', gen, reason: String((err && err.message) || err).slice(0, 160) });
        } catch { /* 诊断失败不影响服务 */ }
      }
      scheduleAdapterRestart();
    } finally {
      // require-atomic-updates（噪声，非竞态）：`busy` 是重入锁 —— 函数开头 `if (busy || …) return;`
      // 保证同一时刻至多一个 recompute 在飞，写者只有它自己（进入时置真、这里置假），事件回调只读它。
      // eslint 报的是"读过后跨 await 再写"的形状，语义却是"我这一趟跑完了"。
      // eslint-disable-next-line require-atomic-updates -- 见上方注释：busy 是重入锁，写者只有本趟自身。
      busy = false;
      if (pollGuard) clearTimeout(pollGuard);
      // trailing 补算：busy 中 / 合并窗内被丢的事件在这里补上一拍，不让事件退化成
      // "只能等下一跳心跳"（最坏 1s 延迟）。dirty 在进入补算前清位，防自递归。
      if (dirty && !disposed && adapter) {
        dirty = false;
        recompute().catch(() => { /* 不外抛 */ });
      }
    }
  }

  function scheduleAdapterRestart() {
    if (disposed || retryTimer) return;
    if (adapter) {
      try {
        adapter.stop();
      } catch {
        /* stop 幂等，异常吞掉 */
      }
      adapter = null;
    }
    // ⚠️ 必须复位 started：start() 首行 `if (started || disposed) return` 会把
    // 重试回调直接弹回去 —— 不复位的话重试循环是死代码，降级后永不恢复
    // （评审 P1 实测复现：retry 到期 built 计数不涨）。
    started = false;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start().catch(() => { /* start 内部已降级并记录，不外抛 */ });
    }, retryStartMs);
  }

  async function start() {
    if (started || disposed) return;
    started = true; // 无论成败都算「已启动」——重试走 retryTimer，不走重复 start。
    if (!isCandidate()) {
      logOnce('not-candidate', 'not an X11 session (non-linux, no DISPLAY, or Wayland), backend=none');
      scheduleAdapterRestart(); // 会话可能在登录切换后出现 —— 低频重试兜底。
      return;
    }
    try {
      adapter = createAdapter(ownPid === undefined ? {} : { ownPid });
      await adapter.start();
      // dispose 可能恰好落在 start 挂起期间（stop 已把 adapter 置 null）：
      // 此时不得再挂 onChange，否则 TypeError 会被 catch 误判成 start-failed，
      // 白 +1 gen 并打一条假降级日志污染 QA 时序。
      if (disposed) return;
      adapter.onChange(onAdapterEvent);
      logOnce('started', `occlusion hub started (${snapshot.epoch || 'x11'})`);
      await recompute();
      pollTimer = setInterval(() => {
        recompute().catch(() => { /* recompute 不外抛；这里兜底防 unhandled */ });
      }, pollMs);
    } catch (err) {
      snapshot = degradedSnapshot(snapshot.gen + 1, now());
      logOnce('start-failed', `x11 adapter start failed, backend=none: ${err && err.message}`);
      scheduleAdapterRestart();
    }
  }

  function onAdapterEvent() {
    const t = now();
    // busy 中 / 合并窗内的事件不丢：置 dirty，由 recompute 的 finally 补算一拍。
    if (busy) {
      dirty = true;
      return;
    }
    if (t - lastEventAt < EVENT_COALESCE_MS) {
      dirty = true;
      return;
    }
    lastEventAt = t;
    recompute().catch(() => { /* 同上 */ });
  }

  return {
    start,
    /** 永不抛错、永不回空 —— 路由层零防御直发。返回**拷贝**：调用方原地改写
     * （含 rects 数组）不得污染其他读者（getSnapshot 的"永不抛"契约不含防改写，
     * 这里用复制把契约做实）。 */
    getSnapshot() {
      const s = snapshot;
      return {
        ...s,
        own: s.own ? { ...s.own } : null,
        rects: s.rects ? s.rects.map((r) => [r[0], r[1], r[2], r[3]]) : null,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
      pollTimer = retryTimer = null;
      if (adapter) {
        try {
          adapter.stop();
        } catch {
          /* 幂等 */
        }
        adapter = null;
      }
    },
  };
}
