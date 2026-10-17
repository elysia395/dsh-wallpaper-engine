/**
 * `about-notice` 子包宿主入口（P-F 第一格：`lib/components/about-notice/` → `packages/about-notice/`）。
 *
 * 为什么这一格先出：它那两条路由与主包其余路由**没有共享可变状态**（规模由
 * `node test/tools/host-route-index.mjs` 现算），出户成本最低，而收益是宿主可以把
 * `cordis.patch.yml` 里这一行单独 disable（其余各行一个不动）。
 *
 * 两处加载路径共用同一份实现（照抄 dsh-ops 的组件真形）：
 *   ① 宿主把 patch 行的 `name` 当**独立 plugin** 加载 ⇒ `apply(ctx, config)` 是入口；
 *   ② 门面的 `applyComponent(root, rawConfig, 'about-notice')` 是"按组件加载"入口。
 * P-F 之后两条路径的 deps **不再是两份各写各的字面量**：门面与入口都从
 * `lib/subpackage-boot.js` 的 `subpackageKeys('about-notice', ctx)` 取**同一份冻结键视图**
 * ⇒ 两条路径不可能漂移（对账面 = `test/verify-inject-contracts.mjs` ② 的叶子冻结表逐键对账）。
 *
 * ⚠️ **跨包纪律（ADR-0014 S5.1 / S5.2，判据 `test/verify-subpackage-purity.mjs`）**：本模块
 * **零主包说明符、零相对路径逃出本包** —— 只 import 本包内的路由族与 `node:` 内建。宿主能力一律
 * 经 `ctx.wallpaperEngineHost` 的键视图（`host.keys('about-notice', ctx)`）取。这不是风格问题：
 * 相对 import 主包文件、或 import 主包名，都是该判据的硬红。
 *
 * ⚠️ **取服务姿势**：`inject` 必须先声明（`webServer` + `wallpaperEngineHost`）再读
 * `ctx.<服务>`。cordis 的 reflect `get` 对「未声明 inject 就取的服务属性」当场抛
 * `cannot get property "webServer" without inject at applyImpl`（真机原文），随后的早退分支
 * 永远执行不到（死代码），两条装载路径双双失败、该组件的路由全 404。声明后由 Loader 保证
 * 「服务就绪才激活」，`applyImpl` 里的早退只兜「服务在、但路由表还没挂上」这一种情况。
 * 对应判据：`test/verify-bundle-rows.mjs` ⑧（入口读的每个 `ctx.<服务>` 都必须在其 inject 里）。
 *
 * ⚠️ **teardown 得交两份（关掉再打开子组件会撞 `duplicate … route`）**：本模块导出的 `apply`
 * 是**函数声明**（有 `prototype`）⇒ cordis 的 loader 走 `new apply(ctx, config)` 分支、
 * **返回值被丢弃** ⇒ 只 `return keys.runComponent(…)` 的话 fiber 卸载时没人撤路由（旧注册留在
 * 宿主路由表里），下一次启用立刻撞「重复路由」。所以返回值一律走 `keys.handOffTeardown(ctx, …)`：
 * 同一份 disposer 也交给 `ctx.effect`（cordis 的显式清理通道）并做幂等包装。见 `lib/host-boot.js`。
 *
 * ⚠️ **模块作用域纪律（P2-1b 定，P-F 后仍适用）**：模块作用域（顶层、任何函数体之外）只许放
 * 声明/常量 —— 不得在模块求值期去读别的模块的绑定并调用它（那一刻对方可能还没求值完，抛
 * `ReferenceError: Cannot access '…' before initialization`，P2-1b NC1 实测报错原文）。
 */
import { join } from 'node:path';
// 本包内的两条路由族（`lib/routes/*.js` 是路由族的**唯一**落点：落在别处 `docs/ROUTE-INDEX.md`
// 会静默少行，见 test/tools/host-route-index.mjs 的候选面）。
import { registerGithubStarsRoutes } from './routes/github-stars.js';
import { registerAboutQrRoutes } from './routes/about-qr.js';

/** patch 行 slug（`cordis.patch.yml` 里该行 `name` 的完整值，两处逐字相等）。 */
export const name = 'dsh-plugin-wallpaper-engine-about-notice';

/**
 * 硬依赖 web 服务 + 主包宿主服务：与主行 `lib/index.js` 的 `inject` 同一套语义。
 * 组件行走 patch 行加载时，Loader 靠这两句保证「服务就绪才激活」，`ctx.webServer` /
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
    throw new Error('[wallpaper-engine] about-notice 没拿到 wallpaperEngineHost 服务'
      + '（inject 声明与宿主装载顺序不匹配）');
  }
  // 键视图 = `lib/subpackage-boot.js` 的 SUBPACKAGE_KEY_TABLE 里本包那一行（值全部来自主包模块级绑定）。
  // 记账 / 错误留证 / 「失败仍原样抛」三件事都在 `keys.runComponent()`（门面 `applyComponent`
  // 走的是同一个函数）⇒ 两条装载路径共用一份语义，不可能一条记了、另一条忘了。
  const keys = host.keys('about-notice', ctx);
  // `http` 面（`sendJson` / `bodyReader`）不在冻结键表里，与 `packages/fonts` 同款：按需显式带上。
  const deps = Object.freeze({ ...keys, http: host.http });
  return keys.handOffTeardown(ctx, keys.runComponent('about-notice', ctx, config, deps, applyImpl));
}

/**
 * 组件实现。第三个形参名取 `c`（与 `lib/kernel/host-session.js` 同一约定）：
 * `test/tools/host-route-index.mjs --deps` 按 `const { … } = c;` 现抽契约；路由族调用点的
 * `...keys` 展开则由 `test/verify-inject-contracts.mjs` 按冻结表认（`keys` 与 `apply()` 里那个
 * 绑定同名 ⇒ 两边指的是同一份键视图）。
 */
export function applyImpl(root, _rawConfig, c) {
  const keys = c;
  const { base, pluginName, repoSlugFromPkg, pluginDataDir, componentViewFrom, createComponentSession } = c;
  // 两条装载路径都能这么读：① 组件行自己声明了 `inject = ['webServer', 'wallpaperEngineHost']`；② 门面路径的 `root`
  // 就是门面的 ctx，而门面同样声明了 `inject = ['webServer']`（主行 `lib/index.js` 的 `inject` 声明）。
  const webServer = root && root.webServer;
  // 与门面 `apply()` 同款早退：服务在、但 register 面还没挂上（或换成了别的 webServer 实现）。
  if (!webServer || typeof webServer.register !== 'function') return () => {};

  // P2-7B 注入面收窄：从内核取**本组件声明的视图**（`COMPONENT_VIEW_KEYS['about-notice']`），
  // 不再从整个 `hostKernel` 现解构 —— 后者等于把整个内核（键数与分级由
  // `test/verify-component-face.mjs` 现算）当成注入面（M9 的现状）。视图缺键即抛，不静默 `undefined`。
  const view = componentViewFrom('about-notice');
  // 迷你会话（disposers / activeStreams / mediaMap / log / serveFile / 同序 teardown）收在内核侧；
  // serve 套件的入参（`SESSION_SERVE_KEYS`：appendDiagLine / traceRequests / traceMediaRequests /
  // readWebShim / buildSeedScript）由会话从视图取 ⇒ 它们不再出现在组件入口的解构面里。
  const { log, disposers, serveFile, teardown } = createComponentSession(root, { base, pluginName }, view);
  const { ABOUT_DIR } = view;

  // ⚠️ **注册期必须包 try**（P2-4）：本实现要注册**两条**路由族，第 N 条抛错时前面 N-1 条已经
  // 把 disposer 推进了 `disposers`。若不在这里收尾就往外抛，`teardown` 就**永远不会交回宿主**
  // （`runComponent()` 只在 impl 正常返回时拿到它）⇒ 已注册的路由留在宿主路由表里，下一次启用
  // 立刻撞 `webserver: duplicate … route`。收尾失败不掩盖原始错误：teardown 自己吞异常，
  // 原错照抛（装载失败必须仍然是红的）。
  try {
    // 「关于」页签的仓库 star 数 → lib/routes/github-stars.js。**只读**一条腿：本插件唯一一处
    // 出站请求（api.github.com），带 10 分钟 TTL + 落盘缓存兜底；一键 star 不做（GitHub 要点星
    // 必须有用户凭据，插件不存任何 token）。
    registerGithubStarsRoutes(webServer, {
      ...keys, disposers, base, repoSlug: repoSlugFromPkg(),
      cachePath: () => join(pluginDataDir(), 'star-count.json'),
      log, http: keys.http,
    });

    // 「关于」页签的两张联系方式二维码（静态 PNG，白名单直出）→ lib/routes/about-qr.js。
    registerAboutQrRoutes(webServer, { ...keys, disposers, base, aboutDir: ABOUT_DIR, serveFile });
  } catch (error) {
    teardown();
    throw error;
  }

  // 本组件自己的收尾（会话的 teardown，见 lib/kernel/component-session.js）：与 host-session 的
  // teardown 同序（逐个 disposer → destroy 在途流 → 清两个容器），但**没有** releaseKernelLease
  // —— 见文件头那条有意不对称。
  return teardown;
}
