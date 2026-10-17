/**
 * lib/http-lifecycle.js —— HTTP 生命周期（空闲超时 / linger 收口）（P0.2-C 纯搬移）
 *
 * 从 `lib/index.js` 整段搬出：`armBodyIdleTimeout`（请求体空闲超时兜底）与
 * `lingerClose`（唯一断开收口：先写应答 → 排空 → 等 flush 再断）。
 * **逐字保真**：只做 +2 缩进与工厂包裹。零注入依赖。
 */

export function createHttpLifecycleKit() {
  // 无外部依赖：纯时限常量 + 收口函数。

  // 请求体收集的 idle 超时：客户端连上后不发数据（或中途停发）会让连接永久
  // 挂起，占着 socket 与路由状态。每次收到数据重置计时，60s 无数据即回调
  // onTimeout（路由负责应答）并销毁请求。unref 保证计时器不拖住进程退出。
  // ⚠️ 它是**最终兜底**：onTimeout 返回后无条件 destroy，**不经过 lingerClose**
  //    ⇒ 这条路径的应答是尽力而为（调用点若要保证送达，应自行先应答再 lingerClose）。
  const BODY_IDLE_TIMEOUT_MS = 60 * 1000;
  function armBodyIdleTimeout(req, onTimeout) {
    let timer = null;
    let fired = false;
    const disarm = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const arm = () => {
      if (fired) return;
      disarm();
      timer = setTimeout(() => {
        fired = true;
        try { onTimeout(); } catch { /* ignore */ }
        try { req.destroy(); } catch { /* ignore */ }
      }, BODY_IDLE_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();
    };
    req.on('data', arm);
    req.once('end', disarm);
    req.once('close', disarm);
    arm();
    return disarm;
  }

  /**
   * 中途放弃一个请求体（413 / 408 / 5xx 应答**已经写出**之后）的唯一断开入口。
   *
   * 两个独立的"应答丢失"通道，都必须堵：
   *   ① 带着**未读的入站数据**关闭套接字 ⇒ RST（实测：不再排空、只挂 res 'finish'
   *      ⇒ 客户端 status=0）⇒ 要等请求体读完。
   *   ② 应答**尚未刷出**就关闭 ⇒ 写缓冲被丢掉，客户端同样只看到连接被掐断。
   *      ⚠️ `res.writableEnded` 在 res.end() 一调即为真，**不代表已刷出**；
   *      代表刷出的是 `writableFinished`（'finish' 已发出）—— 带背压时二者不同刻。
   *
   * ⇒ 顺序固定为「**请求体读完 **且** 应答刷完 → 才 destroy**」：两个条件**都**要成立。
   *   小应答（413 只有几十字节）通常**先**刷完，而请求体还剩很多没读 —— 只看应答就会在
   *   还有未读入站数据时关闭。排空最多等 LINGER_MAX_MS（客户端发满上限后停发时不能长期占住）。
   *
   * 调用点契约：**先写出应答**，然后调用本函数；**不得**再自行 req.destroy()
   * （守卫按此断言：全仓 req.destroy() 只允许出现在本函数与 idle 兜底两处）。
   */
  const LINGER_MAX_MS = 5000;
  function lingerClose(req, res) {
    let timer = null;
    let armed = false;
    const drop = () => {
      if (timer) { try { clearTimeout(timer); } catch { /* ignore */ } timer = null; }
      try { req.destroy(); } catch { /* ignore */ }
    };
    const armLinger = () => {
      if (armed) return; // 只武装一次：多个等待者不该叠加计时器
      armed = true;
      timer = setTimeout(drop, LINGER_MAX_MS);
      if (typeof timer.unref === 'function') timer.unref();
    };
    // 请求体读完（`end` 已发 / `complete` / 已销毁）—— 三种说法取或：不同终止路径置的不一样。
    const requestDrained = () => req.readableEnded === true || req.complete === true
      || req.destroyed === true || typeof req.once !== 'function';
    // 应答刷完（没有可等的 res 也算：调用方给的是替身）。
    const responseFlushed = () => !res || typeof res.once !== 'function' || res.writableFinished === true;
    const dropWhenBothDone = () => {
      if (requestDrained() && responseFlushed()) { drop(); return; }
      // ⚠️ `req 'close'` 也必须走同一条路：Node ≥16 在**请求完成**时就发它，不只表示"连接没了"。
      //    A/B 实测（同机各 12 次）：在这两条路径上不等应答直接 destroy ⇒ 丢 1 次应答；
      //    等应答刷完 ⇒ 0 次。
      if (!requestDrained()) {
        req.once('end', dropWhenBothDone);
        req.once('close', dropWhenBothDone);
      }
      if (!responseFlushed()) {
        res.once('finish', dropWhenBothDone);
        res.once('close', dropWhenBothDone);
      }
      armLinger();
    };
    dropWhenBothDone();
    if (!requestDrained()) { try { req.resume(); } catch { /* ignore */ } }
  }

  return {
    BODY_IDLE_TIMEOUT_MS,
    armBodyIdleTimeout,
    LINGER_MAX_MS,
    lingerClose,
  };
}
