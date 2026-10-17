/**
 * component-session.js —— 组件会话 + 组件视图（P2-7B：组件注入面收窄的内核侧落点）。
 *
 * 为什么需要（M9 的现状）：两个组件入口（`packages/about-notice/lib` / `mascot-avatar`）
 * 各自复制了一份"迷你会话"（`disposers` / `activeStreams` / `mediaMap` / `createLog` /
 * `createServeKit` / 同序 teardown），并且**直接从整个 `hostKernel` 解构**自己的符号
 * （每个组件的键集与条数见下方 `COMPONENT_VIEW_KEYS`，其中大半是内核**内部面**）⇒ 依赖面名义上是
 * `c` 的四个键，实际是整个内核对象。本模块把两件事一起收口：
 *   ① `createComponentSession()` —— 迷你会话的唯一实现（teardown 只有一份，不可能一处改了另一处没改）；
 *   ② `componentViewFrom()` —— **组件视图**：内核按组件名交出"这一个组件允许消费的键"，
 *      键集是显式声明（`COMPONENT_VIEW_KEYS`），组件入口不再碰内核对象的其余键。
 *
 * 为什么是"视图面"而不是"把内部面键升进稳定面"：稳定面定义 = 被 ≥2 个路由族或门面共享基座
 * 消费（见 `host-kernel.js` 文件头）。组件要的 `ABOUT_DIR` / `mascotDir` 族 / diag 族的
 * `traceMediaRequests` / `readWebShim` / `buildSeedScript` **不是**共享基座，把内部面键
 * 一股脑升进稳定面只是把"隐式共享"从组件搬到契约上，稳定面会随组件数线性膨胀、契约反而更弱
 * （两个键集分别见本文 `COMPONENT_VIEW_KEYS` 与 `host-kernel.js` 的 `KERNEL_STABLE_FACE`）。
 * 视图面是第三种归属：**每个组件一份、显式列出、逐键可核对**（守卫 `test/verify-component-face.mjs`），
 * 且添加一个键必须改这份声明 —— 契约变更因此可见。若将来某个键真的被 ≥2 个组件共享基座消费，
 * 那才是它升进稳定面的时机（升面 = 契约变更，要在报告/ADR 里记）。
 *
 * 键名纪律：视图沿用内核的**原符号名**（`ABOUT_DIR` / `MASCOT_EXT` / `atomicWriteFileP`…），
 * 不另起别名。理由：这些名字同时是 `lib/routes/*.js` 的 `c` 声明键（路由族的声明面由 P2-7A
 * 对账）⇒ 改名会让组件调用点里出现 `MASCOT_EXT: view.mascotExt` 这种既没解耦又多一层映射的写法。
 * 收窄的判据是"组件只从**视图**取键、不再从 `hostKernel` 解构"，不是"组件里不出现内核符号名"。
 *
 * 与主行（`lib/kernel/host-session.js`）的**有意不对称**：本会话**不** `acquireKernelLease`。
 * 租约护的是 `transcodeKit` 这类内核共享可变资源（在途 ffmpeg / 进度账本 / 在途表），而两个组件
 * 只用静态文件的读/写族（`serveFile` 直出 + `atomicWriteFileP` 落盘），没有可释放的共享资源
 * ⇒ 不 acquire 也就不 release。这条不对称在 P2-7B 重构里**逐字保留**：往 `createComponentSession`
 * 里加一次 `acquireKernelLease` 会让"关掉组件行"变成可能 dispose 主行正在用的共享资源（引用计数
 * 记账也对不上：本会话不在计数里）。
 *
 * teardown 顺序与两处原实现**逐字同序**（行为等价性的承重面）：
 *   逐个 disposer（try/catch，一个失败不拦其余）→ 在途流 `destroy()`（try/catch）→
 *   `activeStreams.clear()` → `mediaMap.clear()`。与 `host-session` 的 dispose 相比，**只少**
 *   `releaseKernelLease` 这一步（见上段），其余顺序完全一致。
 *
 * 纪律：模块 import 期零副作用（不建目录、不起定时器、不读配置）——一切都在工厂体内；本文件零
 * `console.*`（终端镜像的唯一落点是 `lib/log.js`）。
 *
 * ── 返回契约（第三件组件"媒体桥入包"时扩展一格）────────────────────────────────
 * `createComponentSession()` 交出 `{ log, disposers, serveFile, teardown, appendDiagLine }`。
 * 前四项从 P2-7B 起就有；**第五项 `appendDiagLine` 是媒体桥入包时加的**，理由：
 *   · 路由族可能既需要 serve 套件（会话侧消费 `appendDiagLine`），又需要 diag 落盘入口本身
 *     —— 媒体桥的 `registerNowPlayingRoutes` 把 `appendDiagLine` 当 `c.diag` 交给
 *     `createMediaBackend()`（回落事件写进环形缓冲）。
 *   · 若让组件入口**自己再从视图解构一次**同一个键，该键就会同时出现在"入口消费面"与
 *     "会话消费面"里 —— `test/verify-component-face.mjs` ③ 的「入口 ∩ 会话 = ∅」是**有意**
 *     的性质（同一个键两处消费 = 归属侧漂移），不改它；改的是这个键的**归属侧**：
 *     会话代为交出（与 `serveFile` 同类：路由族消费、入口不解构）。
 *   · 沿用内核**原符号名**（不另起 `diag` 别名），与视图键名纪律一致（见上"键名纪律"）。
 * 扩展只是**返回值多一个键**，`COMPONENT_VIEW_KEYS` 的声明面与 ③ 的双向对账口径一字未动。
 */
import { createLog } from '../log.js';
import { createServeKit } from '../serve.js';

/**
 * **组件视图键集**（唯一真源）：组件名 → 该组件允许消费的内核键。
 *
 * 每键的来源与理由（改键集 = 契约变更，必须同步守卫与报告）：
 *   · `about-notice`（键集见下表）：
 *     - `ABOUT_DIR`            —— 关于页两张二维码的静态 PNG 目录（we-assets 族，内部面）。
 *     - `appendDiagLine`       —— serve 套件的请求收尾/留证依赖（稳定面）。
 *     - `traceRequests`        —— 同上（稳定面）。
 *     - `traceMediaRequests`   —— 同上（diag-trace 族，内部面）。
 *     - `readWebShim`          —— serve 套件出站脚本依赖（shim-seed 族，内部面）。
 *     - `buildSeedScript`      —— 同上（shim-seed 族，内部面）。
 *     除 `ABOUT_DIR` 外，其余各项就是下表的 `SESSION_SERVE_KEYS`（`createServeKit` 的**入参**，
 *     由 `createComponentSession` 消费；组件入口只取 `ABOUT_DIR`）。
 *   · `mascot-avatar`（键集见下表）：
 *     - `mascotDir` · `mascotPath` · `MASCOT_EXT` · `MASCOT_MAX_BYTES`
 *     - `avatarDir` · `avatarPath` · `AVATAR_SIDES` · `AVATAR_EXT` · `AVATAR_MAX_BYTES`
 *       —— 两条路由族的目录 / 路径 / 白名单 / 上限（media-dirs 族，内部面）。
 *     - `atomicWriteFileP` · `armBodyIdleTimeout` · `lingerClose` —— 落盘与请求收尾（稳定面）。
 *     - `appendDiagLine` · `traceRequests` · `traceMediaRequests` · `readWebShim` · `buildSeedScript`
 *       —— 同 about-notice 的 serve 套件入参（其中 `traceMediaRequests` · `readWebShim` ·
 *       `buildSeedScript` 是内部面），由会话消费。
 *   · `media-bridge`（键集见下表，第三件组件"媒体桥入包"）：
 *     - `readConfig` —— 读取设置：启动决策每次现读它的三个媒体键（`audioSource` /
 *       `mediaIntegration` / `mediaLyricsOnline`）。**这是内部面，是有意保留的耦合**（ADR-0013 D13）：
 *       桥与内核共享同一份设置真源，不另抄一份。
 *     - `cacheBaseDir` —— 用户可改的缓存根**访问器**（媒体桥的 `--cache-dir` 与封面缓存跟它走）。
 *     - `appendDiagLine` —— 回落事件写进 diag 环形缓冲（**入口不自取**：由会话交给入口，见文件头
 *       「返回契约」）。
 *     - `traceRequests` · `traceMediaRequests` · `readWebShim` · `buildSeedScript` —— serve 套件
 *       入参（其中 `traceMediaRequests` · `readWebShim` · `buildSeedScript` 是内部面），由会话消费；
 *       本组件需要 `serveFile` 出封面字节（`/now-playing/artwork`）。
 *     内部面就是上面标出的那几项（`readConfig` · `traceMediaRequests` · `readWebShim` ·
 *     `buildSeedScript`）。
 *     ⚠️ 媒体桥还需要 `configPath`（后端 `dataDir` = `configPath()` 的父目录）与
 *     `CONTROL_JSON_MAX_BYTES`（`/media-control` 收体上限）——**这两项不在实跑内核对象上**
 *     （前者是 `lib/kernel/data-dir.js` 的模块级函数，后者是 `lib/http-body.js` 的常量），
 *     所以**不进视图**：组件入口按与门面同款姿势直接 import 那两个叶子模块（`componentViewFrom()`
 *     对内核上没有的键缺键即抛，写进来会当场抛）。
 */
export const COMPONENT_VIEW_KEYS = Object.freeze({
  'about-notice': Object.freeze([
    'ABOUT_DIR',
    'appendDiagLine',
    'traceRequests',
    'traceMediaRequests',
    'readWebShim',
    'buildSeedScript',
  ]),
  'mascot-avatar': Object.freeze([
    'mascotDir',
    'mascotPath',
    'MASCOT_EXT',
    'MASCOT_MAX_BYTES',
    'avatarDir',
    'avatarPath',
    'AVATAR_SIDES',
    'AVATAR_EXT',
    'AVATAR_MAX_BYTES',
    'atomicWriteFileP',
    'armBodyIdleTimeout',
    'lingerClose',
    'appendDiagLine',
    'traceRequests',
    'traceMediaRequests',
    'readWebShim',
    'buildSeedScript',
  ]),
  // 第三件组件（媒体桥入包）：内部面 = readConfig ＋ SESSION_SERVE_KEYS 里强制的那些 serve
  // 管线依赖（哪个是内部面见上方每键理由）—— 另见文件头「返回契约」；`configPath` / `CONTROL_JSON_MAX_BYTES`
  // 不在内核对象上，故**不入视图**：P-F 出户后改走宿主服务面键表的 `data:` / `http:` 源型
  // （`lib/subpackage-boot.js` 的 `DATA_VIEW` / `HTTP_VIEW`），仍是同一份模块级绑定。
  'media-bridge': Object.freeze([
    'readConfig',
    'cacheBaseDir',
    'appendDiagLine',
    'traceRequests',
    'traceMediaRequests',
    'readWebShim',
    'buildSeedScript',
  ]),
});

/**
 * 会话自取的 serve 套件依赖键（`createServeKit` 的入参）。
 * 数组里这些键**不再出现在组件入口的解构面里** —— 它们是套件管线，不是组件语义；会话缺键即抛。
 */
export const SESSION_SERVE_KEYS = Object.freeze([
  'appendDiagLine',
  'traceRequests',
  'traceMediaRequests',
  'readWebShim',
  'buildSeedScript',
]);

/**
 * 取一个组件的**视图**（内核按 `component` 交出的显式键子集）。
 *
 * 缺键即抛（响亮报错，不静默 `undefined`）：这是 P2-7「先加判据、再收窄」的收窄那一半 ——
 * 视图键集与内核实现漂移时，组件行加载当场失败并被 `runComponent()` 记为 failed，
 * 而不是带着 `undefined` 跑出一半路由（那是**假绿**：探针说"启用成功"、路由却半死不活）。
 *
 * @param {object} kernel 宿主内核（`lib/kernel/host-kernel.js` 的平坦对象）
 * @param {string} component patch 行 `name` 的子路径段（如 `'about-notice'`）
 * @returns {Readonly<Record<string, unknown>>} 冻结的视图对象
 */
export function componentViewFrom(kernel, component) {
  const keys = COMPONENT_VIEW_KEYS[component];
  if (!keys) throw new Error('[wallpaper-engine] 未登记的组件视图：' + component);
  const view = {};
  for (const key of keys) {
    if (!(key in kernel)) {
      throw new Error('[wallpaper-engine] 组件视图缺键（' + component + '）：' + key
        + ' —— 视图声明面与内核实现漂移，改 COMPONENT_VIEW_KEYS 或内核返回契约');
    }
    view[key] = kernel[key];
  }
  return Object.freeze(view);
}

/**
 * 建一次**组件会话**：两个组件入口原来各自复制的迷你会话，这里只有一份实现。
 *
 * 与 `createHostSession(kernel, { base, ctx })` 的差别（都是有意为之）：
 *   · 不写 `build-stamp.json`、不排 3s 启动清扫 —— 那些是"整包一次"的事，组件行再排一遍就重复了；
 *   · 不 `acquireKernelLease`（理由见文件头）。
 *
 * @param {{ logger?: { error?: Function, warn?: Function, info?: Function } | ((name: string) => object) | null }} root fiber 根上下文（真实宿主有 `logger`；mock 夹具可能只有一个 `webServer`）
 * @param {{ base: string, pluginName: string }} c 门面常量（`BASE` / `PLUGIN_NAME`）
 * @param {Readonly<Record<string, unknown>>} view `componentViewFrom()` 交出的组件视图
 * @returns {{ log: import('../log.js').LogFn, disposers: unknown[], serveFile: Function, teardown: () => void, appendDiagLine: Function }}
 */
export function createComponentSession(root, { base, pluginName }, view) {
  const disposers = [];
  const activeStreams = new Set();
  const mediaMap = new Map();
  // `root.logger` 可能是 undefined（同一处 mock ctx 只有 `webServer`）⇒ 与 host-session 同款形态。
  const log = createLog(
    typeof root.logger === 'function' ? root.logger(pluginName) : root.logger,
    pluginName,
  );

  // serve 套件入参取自**视图**（组件声明面），不从内核对象现解构 —— 缺键即抛。
  for (const key of SESSION_SERVE_KEYS) {
    if (!(key in view)) {
      throw new Error('[wallpaper-engine] 组件会话缺 serve 依赖：' + key
        + ' —— 该键必须在 COMPONENT_VIEW_KEYS 里声明');
    }
  }
  // ⚠️ 这 5 个键必须**逐字留在同一条解构里**：`verify-component-face` 按文本解析这条解构式，
  // 要求它 == `SESSION_SERVE_KEYS`（单一真源不漂移）——把某个键挪去单独取（哪怕类型更准）
  // 都会让判据判「会话自取的 serve 键」少一个。类型收窄放在**返回值**那一处做。
  const { appendDiagLine, traceRequests, traceMediaRequests, readWebShim, buildSeedScript } = view;
  const { serveFile } = createServeKit({
    activeStreams, BASE: base, mediaMap, log, appendDiagLine, traceRequests, traceMediaRequests,
    readWebShim, buildSeedScript,
  });

  // 收尾：与两处原实现**逐字同序**（逐个 disposer → destroy 在途流 → 清两个容器），
  // 但**没有** releaseKernelLease —— 见文件头那条有意不对称。
  const teardown = () => {
    for (const d of disposers) { try { d(); } catch { /* 收尾尽力而为，别让一个 disposer 拦住其余 */ } }
    for (const stream of activeStreams) { try { stream.destroy(); } catch { /* 已关或未持有 destroy */ } }
    activeStreams.clear();
    mediaMap.clear();
  };

  // `activeStreams` / `mediaMap` 只在会话内部（serve 套件与 teardown）流动 ⇒ 不交给组件。
  // `appendDiagLine` 一并交出：路由族可能需要 diag 落盘入口本身（媒体桥把它当 `c.diag`），
  // 而它**不能**由入口再从视图解构一次（那会让同一键同时进"入口消费面"与"会话消费面"，
  // verify-component-face ③ 的「入口 ∩ 会话 = ∅」会红）—— 见文件头「返回契约」。
  // 视图取出来的是 `unknown` ⇒ 交出前收窄成**被调用面**（路由族把它当 `c.diag`：`diag(name, data?)`）。
  return { log, disposers, serveFile, teardown,
    appendDiagLine: /** @type {(name: string, data?: unknown) => void} */ (appendDiagLine) };
}
