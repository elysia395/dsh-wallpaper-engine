/**
 * routes/diag.js — **诊断族**路由：客户端渲染链路的落盘上报（`/client-diag`）与宿主的
 * 渲染页告警通道 / 读取（`/diag`、`/diag-log`）。
 *
 * 为什么值得独立成文件：这一族的依赖面小且固定 —— "这条路由依赖什么"
 * 在签名上一眼看全，改诊断上报只需读这一个文件，
 * 而**依赖写在签名上**（`c`）。
 *
 * 契约：`registerDiagRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers`       ← `apply` 的清理句柄数组；注册返回值必须推进去
 *   · `appendDiagLine`  ← `lib/diag-trace.js` 的落盘函数（多族共用，经门面注入）
 *   · `log`             ← `lib/log.js` 的宿主日志入口（本族只管上报**经它**分级，不自己写终端）
 *   · `notice`          ← `lib/notice.js` 的提示通道（`/client-diag` 上的 `live-ready` 走它）
 *   · `base`            ← 路径前缀 `BASE`（宿主唯一的定义处；这里以别名 BASE 使用）
 *   · `onHandleDiag`    ← **出参**（可省略）：把本族的 `handleDiag` 交回 `apply`，供壁纸媒体源的
 *     根路径 `/diag` 复用**同一个**实现。为什么是回调而不是返回值：调用点必须保持
 *     `register<族>Routes(webServer, {…})` 这一**语句形态**（`test/tools/host-route-index.mjs`
 *     的调用点正则认的就是行首即函数名），加赋值前缀会让本族被判成"孤儿族模块"。
 *     与 `disposers` 同species —— 那个也是 apply 拥有、族往里写的出参。
 *   · `componentsProbe` ← **只读探针**（`lib/index.js` 的 `componentProbe()`）：组件行的装载面。
 *     声明 / 已装载 / 缺口随 `/diag-log` 的 `components` 字段出门 —— 组件行缺行或被 disable 时
 *     本包零代码执行、该族整族 404，而客户端「看」是静默坏（`<img src>` 没有 onerror）
 *     ⇒ 需要一个人能一眼看出的落点。可省略（老调用点）：那时字段为 `null`。
 * 族内状态（`diagLog` / `handleDiag`）是本文件的局部量 —— 只被这一族使用，**不经过 context**。
 *
 * 不变量：
 *   · 注册顺序按原样：`/client-diag` → `/diag`（根路径）→ `/diag`（前缀）→ `/diag-log`；
 *   · `/diag` 三条**共用同一个 handleDiag**：渲染页按 `{mediaBase origin}/diag` 上报（根路径），
 *     而同一份产物里还有一条走前缀的通道，只挂一条会让"壁纸黑屏"时最关键的渲染页告警
 *     以 404 静默丢掉；**第三条挂在壁纸媒体源上**（见 `lib/media-origin.js` 的 `ensureMediaOrigin`）——
 *     场景壁纸的 `mediaBase` 指向那个源之后，根路径 `/diag` 必须在那里也有一个落点，
 *     否则"大场景 pkg 首帧超时"时渲染页的告警同样会静默 404。故本族把 `handleDiag`
 *     **经返回值交出去**（`lib/media-origin.js` 在媒体源闭包里消费它，见那里的 `mediaDiagHandler`）。
 *   · 落盘（`appendDiagLine`）、内存环形缓冲与 `/diag-log` 的应答形状**与本族的分级无关**：
 *     分级只决定这一行经 `log` 的哪一档，不动档案。
 *   · `/diag` 的**无级别上报默认 `info`**（未知消息宁可安静也不误报）：只有消息文本命中
 *     失败模式表才升级到 `warn`。**发送端自带 `&lvl=` 时以它为准** —— 客户端
 *     `src/live-layer.js` 的 liveLog 与渲染页（上游 WebWallGL 的 `diag-level.ts`，
 *     见 issue #13）都自己声明级别；三档之一即采用，未知 / 缺失才回落模式表。
 *     模式表因此是**兜底**（旧产物 / 其它写入者），不是主路径。
 *   · 注册返回值必须推进 `c.disposers`，否则卸载后路由仍挂着一个已释放的处理器；
 *   · `/client-diag` 的三条早退（非 POST 405 / 超 64KB 413 / 早退不落盘）由
 *     `test/verify-scene-live.mjs` 的 Level E 以真实请求钉住。
 */

/**
 * 渲染器上报的失败模式表：**只在发送端没带 `&lvl=` 时**起作用 —— 命中即 `warn`
 * （影响显示效果的非正常表现），其余 `info`。无级别的上报**默认 `info`** 是刻意的 ——
 * 未知消息宁可安静也不误报；代价是渲染器新增一种真正的失败文案时不会自动升级，须补进这张表。
 *
 * 上游渲染页（2.0.2 起）每条上报都自带级别，所以这条路径是给**旧产物**与其它写入者
 * 兜底的：它比上游的 `classifyDiag` 保守（不判 `error`，也认不出「失败 0」之外的计数形态），
 * 宁可少报严重级别，也不把统计行打成故障。
 *
 * 两处**必须**比"出现某个词"更严，否则纯统计行会被误升级成问题（终端当场多出噪音）：
 *   · `失败` 后面紧跟计数 `0` 时不算（`bake: 后台补烘完成 0 张（失败 0，产物 0.0MB）`
 *     是"零失败"的完成行，不是失败）；
 *   · `ERR` 要词首（`\b`），否则纹理 / 着色器名里的 `…TERRAIN…` 这类子串会误命中。
 */
const FAIL_REPORT_RE = /失败(?!\s*[:：]?\s*0)|\bERR|不可用|黑屏|fallback/;

// 收 body 的**唯一缓冲实现**（累加 + 字节计闸 + 一次解码）—— 见 lib/http-body.js。
// 本族只有 `/client-diag` 一处要收体，且它是**有界小体**（诊断上报），故正常走共享实现。
import { bodyReader } from '../http-body.js';

/** 一条 `/diag` 上报该走哪一档：客户端自带的三档之一优先，否则问模式表。 */
function levelForReport(msg, lvl) {
  if (lvl === 'error' || lvl === 'warn' || lvl === 'info') return lvl;
  return FAIL_REPORT_RE.test(msg) ? 'warn' : 'info';
}

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'appendDiagLine', 'log', 'notice', 'base', 'onHandleDiag', 'componentsProbe'];

export function registerDiagRoutes(webServer, c) {
  const { disposers, appendDiagLine, log, notice, base: BASE, onHandleDiag, componentsProbe } = c;
  // 3c-6. 客户端（浏览器半）行为上报：渲染链路的关键步骤落盘 —— 排查只在
  //       某个宿主环境出现的问题时，「走了哪条分支、在哪一步停下」比事后猜有用。
  //
  // 分流：这条 POST 同时承载「场景壁纸已就绪」这一条**成功事实** ⇒ 按 body 的
  // `event`/`type` 认出它，送进提示通道（`lib/notice.js`）而**不是**日志通道。
  // 落盘与三条早退都不受影响（落盘是档案，与提示通道互不替代）。
  const isSceneReady = (body) =>
    String(body.event || '') === 'live-ready' && String(body.type || '') === 'scene';
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/client-diag`,
    handler: (req, res) => {
      if ((req.method || '').toUpperCase() !== 'POST') { res.statusCode = 405; res.end(); return; }
      let done = false;
      const reader = bodyReader(req, {
        maxBytes: 64 * 1024,
        shouldStop: () => done,
        onOverflow: () => { done = true; res.statusCode = 413; res.end(); },
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (done) return;
        done = true;
        try {
          const body = JSON.parse(reader.text());
          appendDiagLine('client', {
            event: String(body.event || ''),
            type: String(body.type || ''),
            id: String(body.id || ''),
            detail: String(body.detail || '').slice(0, 300),
            src: String(body.src || '').slice(0, 200),
          });
          // `live-ready` 是 `src/live-layer.js` 在 first-frame-ok 里程碑发出的那一条
          //（与 liveLog("first-frame-ok", …) 同一处）。文案里的「场景」与判据里的
          // type 一致：网页壁纸的成功事实由媒体源那条提示承担，缺口不留在这里。
          if (isSceneReady(body)) notice('scene-ready', '场景壁纸已就绪');
        } catch { /* 坏 payload 忽略 */ }
        res.statusCode = 204;
        res.end();
      });
    },
  }));

  // 3c-7. Renderer diagnostics sink. WebWallGL's reportDiag() fires a pixel
  //       request at `{mediaBase origin}/diag?msg=…` — i.e. the ROOT path, not
  //       under BASE. Those messages are the only window into what happens
  //       inside the renderer page (shim injection failures, fallbacks to a
  //       bare iframe, sound-layer errors, …), which is exactly what a
  //       "wallpaper goes black" report needs. Keep a bounded ring buffer and
  //       mirror to the host log; a debug route lets us read it back.
  const diagLog = [];
  const reportLog = log.tag('renderer');
  const handleDiag = (req, res) => {
    try {
      const u = new URL(req.url || '/diag', 'http://x');
      const msg = u.searchParams.get('msg') || '';
      if (msg) {
        diagLog.push({ t: Date.now(), msg });
        if (diagLog.length > 200) diagLog.shift();
        // 落盘：DSH Desktop 的运行日志不收录 host 的 stdout，而渲染页的内部告警
        //（shim 未注入 / 退回裸 iframe / 声音层失败…）是排查「壁纸黑屏」的关键，
        // 必须与 4xx 记录写进同一个可事后读取的文件。
        appendDiagLine('renderer', { msg: msg.slice(0, 300) });
        reportLog(msg, levelForReport(msg, u.searchParams.get('lvl')));
      }
    } catch { /* ignore malformed */ }
    res.statusCode = 204;
    res.end();
  };
  // 渲染页按 `{mediaBase origin}/diag` 上报（根路径）；但同一份产物里还有一条
  // 走 `${BASE}/diag` 的通道 —— 两条都接上，否则「壁纸黑屏」时最关键的渲染页告警
  // 会以 404 静默丢掉（实测：排查本机黑屏时它们全部打在 ${BASE}/diag 上）。
  disposers.push(webServer.register({ kind: 'exact', path: '/diag', handler: handleDiag }));
  disposers.push(webServer.register({ kind: 'exact', path: `${BASE}/diag`, handler: handleDiag }));
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/diag-log`,
    handler: (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // `components`（P2-4 A2）：组件装载探针 —— 只在**这里**读一次，仍走 `res.end(JSON.stringify(…))`
      // 与 `application/json`（不得改用 sendJson：那会换掉 Content-Type，老客户端按 JSON 解析的假设会破）。
      res.end(JSON.stringify({
        entries: diagLog.slice(-80),
        components: typeof componentsProbe === 'function' ? componentsProbe() : null,
      }));
    },
  }));
  // 出参交付（见文件头的 `onHandleDiag`）：媒体源的根路径 `/diag` 必须落到**同一个**
  // 落盘 / 分级 / 环形缓冲实现上，否则媒体源上的告警会另起一份、`/diag-log` 读不到。
  if (onHandleDiag) onHandleDiag(handleDiag);
}
