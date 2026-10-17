/**
 * `media-bridge` 子包宿主入口（P-F 第三格：`lib/components/media-bridge/` → `packages/media-bridge/`）。
 *
 * 为什么这一格独立成行：这五条路由（`/media-status`、`/audio-spectrum`、`/now-playing`、
 * `/now-playing/artwork`、`/media-control`）与它们的后端实现（media-bridge 子进程 + 内置回落）
 * 自成一条边：桥的状态 = 一个**子进程**与它自己的磁盘载体，与 `lib/media/` 那六个"内核媒体"
 * 文件（帧缓存 / 媒体目录 / MP4 探测 / 场景探测 / 视频预览 / 转码）零交叉 —— 后者仍由内核
 * （`lib/kernel/host-kernel.js`）持有，因为 `lib/index.js` 的 `/inventory`、`/media`、`/scene-*`
 * 都消费它们。出户后"这个组件由哪些文件构成"由**位置**回答（M6/M10）。
 *
 * 两处加载路径共用同一份实现（照抄 dsh-ops 的组件真形）：
 *   ① 宿主把 patch 行的 `name` 当**独立 plugin** 加载 ⇒ `apply(ctx, config)` 是入口；
 *   ② 门面的 `applyComponent(root, rawConfig, 'media-bridge')` 是"按组件加载"入口。
 * P-F 之后两条路径的 deps **不再是两份各写各的字面量**：门面与入口都从
 * `lib/subpackage-boot.js` 的 `subpackageKeys('media-bridge', ctx)` 取**同一份冻结键视图**
 * ⇒ 两条路径不可能漂移（对账面 = `test/verify-inject-contracts.mjs` ② 的叶子冻结表逐键对账）。
 *
 * `export const name` 与 patch 行的 `name` 逐字相等（`dsh-plugin-wallpaper-engine-media-bridge`）。
 *
 * ⚠️ **跨包纪律（ADR-0014 S5.1 / S5.2，判据 `test/verify-subpackage-purity.mjs`）**：本模块
 * **零主包说明符、零相对路径逃出本包** —— 只 import 本包内的路由族。宿主能力一律经
 * `ctx.wallpaperEngineHost` 的键视图（`host.keys('media-bridge', ctx)`）取。这不是风格问题：
 * 相对 import 主包文件、或 import 主包名，都是该判据的硬红。
 *
 * ⚠️ **取服务姿势**：先声明 `export const inject = ['webServer', 'wallpaperEngineHost']`，再直接读
 * `ctx.<服务>`。缺服务且不声明 inject 会被 cordis 的 reflect `get` 当场抛
 * `cannot get property "webServer" without inject at applyImpl`（真机原文），函数体里那些早退
 * 分支永远执行不到（死代码）。声明 inject 后由 Loader 保证「服务就绪才激活」，下面的早退分支只兜
 * 「服务在、但 register 面还没挂上」这一种情况。
 *
 * ⚠️ **teardown 得交两份**：本模块导出的 `apply` 是**函数声明**（有 `prototype`）⇒ cordis 的 loader
 * 走 `new apply(ctx, config)` 分支、**返回值被丢弃** ⇒ 只 `return keys.runComponent(…)` 的话 fiber
 * 卸载时没人撤路由。所以返回值一律走 `keys.handOffTeardown(ctx, …)`（同一份 disposer 也交给
 * `ctx.effect` 并做幂等包装，见 `lib/host-boot.js`）。判据 `test/verify-bundle-rows.mjs` ⑧c。
 *
 * ⚠️ **模块作用域纪律**：本模块被门面**静态** import（`test/verify-reachability.mjs` 的 import 图
 * 承重），宿主真实装载顺序又是**裸行在前** ⇒ 本模块可能**先于**门面求值。模块作用域（顶层、
 * 任何函数体之外）只许放声明/常量 —— 不得在求值期读别的模块的绑定并调用它（会踩 TDZ）。
 * 对应判据：`test/verify-bundle-rows.mjs` ⑥（结构判据 + 模块作用域文本兜底，双向）。
 *
 * ⚠️ **原先的两个叶子 import 已改为服务面取键（P-F）**：`configPath` 与 `CONTROL_JSON_MAX_BYTES`
 * 曾由本入口直接 import 主包叶子模块（`lib/kernel/data-dir.js` / `lib/http-body.js`）——出户后
 * 那两条相对路径既不可解析、也违反跨包纪律。现在它们分别走键表的 `data:<名>` 与 `http:<名>` 源型
 * （`lib/subpackage-boot.js` 的 `DATA_VIEW` / `HTTP_VIEW`），**仍然是同一份模块级绑定**（不是副本）。
 * 键集见 `lib/kernel/component-session.js` 的 `COMPONENT_VIEW_KEYS['media-bridge']` 注释。
 */
import { registerNowPlayingRoutes } from './routes/now-playing.js';

/** patch 行 slug（`cordis.patch.yml` 里该行 `name` 的完整值，两处逐字相等）。 */
export const name = 'dsh-plugin-wallpaper-engine-media-bridge';

/**
 * 硬依赖 web 服务 + 主包宿主服务：与主行 `lib/index.js` 的 `inject` 同一套语义。
 * 子包行走 patch 行加载时，Loader 靠这两句保证「服务就绪才激活」，`ctx.webServer` /
 * `ctx.wallpaperEngineHost` 才读得到。
 */
export const inject = ['webServer', 'wallpaperEngineHost'];

/** 独立 plugin 入口：宿主按 patch 行加载本子包时走这里，转调本模块的实现（不经门面）。 */
export function apply(ctx, config) {
  // ⚠️ 这个字面形态是**承重**的：`test/verify-inject-contracts.mjs` 的 `tableBindingNames()` 按
  // `const <host> = ctx.<服务名>` 认「本文件里的冻结表绑定」（`recvRe`），再据此把下面调用点的
  // `...keys` 展开成叶子冻结表。写成 `ctx && ctx.<服务名>` 守卫就认不出表 ⇒ 整包调用点判 dynamic
  // 而红（nc-sub7 钉的就是这条：接收者必须源自 `ctx.<服务名>`）。
  const host = ctx.wallpaperEngineHost;
  // 拿不到服务名就大声失败：静默 `undefined` 会让下面每一步都在 undefined 上取属性（半死态）。
  if (!host) {
    throw new Error('[wallpaper-engine] media-bridge 没拿到 wallpaperEngineHost 服务'
      + '（inject 声明与宿主装载顺序不匹配）');
  }
  // 键视图 = `lib/subpackage-boot.js` 的 SUBPACKAGE_KEY_TABLE 里本包那一行（值全部来自主包模块级绑定）。
  // 记账 / 错误留证 / 「失败仍原样抛」三件事都在 `keys.runComponent()`（门面 `applyComponent`
  // 走的是同一个函数）⇒ 两条装载路径共用一份语义，不可能一条记了、另一条忘了。
  const keys = host.keys('media-bridge', ctx);
  // `http` 面（`sendJson` / `bodyReader`）不在冻结键表里，与 `packages/fonts` 同款：按需显式带上。
  const deps = Object.freeze({ ...keys, http: host.http });
  return keys.handOffTeardown(ctx, keys.runComponent('media-bridge', ctx, config, deps, applyImpl));
}

/**
 * 组件实现。第三个形参名取 `c`（与 `lib/kernel/host-session.js` 同一约定）：
 * `test/tools/host-route-index.mjs --deps` 按 `const { … } = c;` 现抽契约；路由族调用点的
 * `...keys` 展开则由 `test/verify-inject-contracts.mjs` 按冻结表认（`keys` 与 `apply()` 里那个
 * 绑定同名 ⇒ 两边指的是同一份键视图）。
 */
export function applyImpl(root, _rawConfig, c) {
  const keys = c;
  const { base, pluginName, configPath, CONTROL_JSON_MAX_BYTES, componentViewFrom, createComponentSession } = c;
  // 两条装载路径都能这么读：① 子包行自己声明了 `inject = ['webServer', 'wallpaperEngineHost']`；
  // ② 门面路径的 `root` 就是门面的 ctx，而门面同样声明了 `inject = ['webServer']`（主行
  // `lib/index.js` 的 `inject` 声明）。
  const webServer = root && root.webServer;
  // 与门面 `apply()` 同款早退：服务在、但 register 面还没挂上（或换成了别的 webServer 实现）。
  if (!webServer || typeof webServer.register !== 'function') return () => {};

  // P2-7B 注入面收窄：从内核取**本组件声明的视图**（`COMPONENT_VIEW_KEYS['media-bridge']`），
  // 不再 `const { … } = hostKernel` 现解构；视图缺键即抛，不静默 `undefined`。
  const view = componentViewFrom('media-bridge');
  // 迷你会话（disposers / log / serveFile / 同序 teardown）收在内核侧；`appendDiagLine` 由会话
  // 一并交出（它在 SESSION_SERVE_KEYS 里，入口若自己再从视图解构一次，`verify-component-face` ③
  // 的「入口 ∩ 会话 = ∅」会红）。
  const { log, disposers, serveFile, teardown, appendDiagLine } = createComponentSession(root, { base, pluginName }, view);
  // 本组件自己要的两个键：后端启动决策每次现读设置（`readConfig`），缓存根传**访问器**。
  const { readConfig, cacheBaseDir } = view;

  // ⚠️ **注册期必须包 try**（P2-4）：这一族一次性注册**五条**路由，中途抛错时已经推进
  // `disposers` 的那几条会留下（`mediaBackend.stop()` 也在同一个 disposer 列表里，一并丢）
  // ⇒ 下一次启用撞 `webserver: duplicate … route`，且桥的子进程无人收。`teardown()` 自己吞异常，
  // 原错照抛（装载失败必须仍然是红的）。
  try {
    // 3c-5. 媒体状态族路由（媒体后端懒启动 + /media-status、/audio-spectrum、/now-playing、
    //       /now-playing/artwork、/media-control）→ 本包 `lib/routes/now-playing.js`。
    //       后端实例、启动决策与五条注册都在那个文件里；这里只声明它的依赖（与门面调用点逐键相同）。
    registerNowPlayingRoutes(webServer, {
      ...keys, disposers, base, appendDiagLine, configPath, cacheBaseDir, readConfig, serveFile,
      CONTROL_JSON_MAX_BYTES, http: keys.http,
      // 媒体子系统的行统一带 `[media]` 标签（与终端既有形状逐字一致）；级别由调用点标注。
      log: log.tag('media'),
    });
  } catch (error) {
    teardown();
    throw error;
  }

  // 本组件自己的收尾（会话的 teardown）：与 host-session 的 teardown 同序（逐个 disposer →
  // destroy 在途流 → 清两个容器），但**没有** releaseKernelLease —— 见 `component-session.js`
  // 文件头那条有意不对称（桥的子进程由它自己的 disposer `mediaBackend.stop()` 收掉）。
  return teardown;
}
