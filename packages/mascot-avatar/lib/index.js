/**
 * `mascot-avatar` 子包宿主入口（P-F 第二格：`lib/components/mascot-avatar/` → `packages/mascot-avatar/`）。
 *
 * 为什么这两族合成**一格**出户：它们是同一套形态的两条腿（POST 导入 raw body + MIME 白名单 /
 * GET·HEAD 查看 / DELETE 清除，见本包 `lib/routes/avatar.js` 与 `lib/routes/mascot.js` 的文件头），
 * 共用同一批内核服务层符号（目录 / 上限 / 原子落盘 / 请求收尾）与同一条用户资产语义。拆成两行
 * 只会让"头像两个 side + 立绘只有一张"这套不变量散在两处。
 *
 * 两处加载路径共用同一份实现（照抄 dsh-ops 的组件真形）：
 *   ① 宿主把 patch 行的 `name` 当**独立 plugin** 加载 ⇒ `apply(ctx, config)` 是入口；
 *   ② 门面的 `applyComponent(root, rawConfig, 'mascot-avatar')` 是"按组件加载"入口。
 * P-F 之后两条路径的 deps **不再是两份各写各的字面量**：门面与入口都从
 * `lib/subpackage-boot.js` 的 `subpackageKeys('mascot-avatar', ctx)` 取**同一份冻结键视图**
 * ⇒ 两条路径不可能漂移（对账面 = `test/verify-inject-contracts.mjs` ② 的叶子冻结表逐键对账）。
 *
 * ⚠️ **跨包纪律（ADR-0014 S5.1 / S5.2，判据 `test/verify-subpackage-purity.mjs`）**：本模块
 * **零主包说明符、零相对路径逃出本包** —— 只 import 本包内的路由族。宿主能力一律经
 * `ctx.wallpaperEngineHost` 的键视图（`host.keys('mascot-avatar', ctx)`）取。这不是风格问题：
 * 相对 import 主包文件、或 import 主包名，都是该判据的硬红。
 *
 * ⚠️ **取服务姿势**：`inject` 必须先声明（`webServer` + `wallpaperEngineHost`）再读
 * `ctx.<服务>`。cordis 的 reflect `get` 对「未声明 inject 就取的服务属性」当场抛
 * `cannot get property "webServer" without inject at applyImpl`（真机原文），随后的早退分支
 * 永远执行不到（死代码），两条装载路径双双失败、该组件的路由全 404。声明 inject 后由 Loader
 * 保证「服务就绪才激活」，下面的早退分支只兜「服务在、但路由表还没挂上」这一种情况。
 * 依据：主行 `lib/index.js` 的 `inject` 声明 早就 `export const inject = ['webServer']`，即整包本来
 * 就硬依赖 web 服务（没有 webServer 的 profile 里裸行自身就 pending）⇒ 组件行补同一句**不引入
 * 任何新假设**；反过来「缺服务就软失败」是个假前提，会把「没挂上」伪装成「激活成功」。
 * 对应判据：`test/verify-bundle-rows.mjs` ⑧（入口读的每个 `ctx.<服务>` 都必须在其 inject 里）。
 *
 * ⚠️ **teardown 得交两份（关掉再打开子组件会撞 `duplicate … route`）**：本模块导出的 `apply`
 * 是**函数声明**（有 `prototype`）⇒ cordis 的 loader 走 `new apply(ctx, config)` 分支、
 * **返回值被丢弃** ⇒ 只 `return keys.runComponent(…)` 的话 fiber 卸载时没人撤路由（旧注册留在
 * 宿主路由表里），下一次启用立刻撞「重复路由」。所以返回值一律走 `keys.handOffTeardown(ctx, …)`：
 * 同一份 disposer 也交给 `ctx.effect`（cordis 的显式清理通道）并做幂等包装。见 `lib/host-boot.js`；
 * 判据 `test/verify-bundle-rows.mjs` ⑧c。
 *
 * ⚠️ **模块作用域纪律（P2-1b 定，P-F 后仍适用）**：模块作用域（顶层、任何函数体之外）只许放
 * 声明/常量 —— 不得在模块求值期去读别的模块的绑定并调用它，否则那一刻对方可能还没求值完，抛
 * `ReferenceError: Cannot access '…' before initialization`（P2-1b NC1 实测报错原文）。
 * 对应判据：`test/verify-bundle-rows.mjs` ⑥（结构判据 + 模块作用域文本兜底，双向）。
 *
 * 与主行的**有意不对称**（同 about-notice）：本组件**不** `acquireKernelLease`。租约护的是
 * `transcodeKit` 这类内核共享可变资源，而本组件只用两条静态图片的读写族，没有可释放的共享资源
 * ⇒ 不 acquire 也就不 release。
 *
 * 形态：**自建最小出站套件**，不复用 `createHostSession` —— 后者会写
 * `build-stamp.json` 并再排一次 3s 启动清扫，三行（裸行 + 两个组件行）同时加载等于把这两件事做三遍。
 * P2-7B 起这一份"迷你会话"住在内核侧（`createComponentSession()`，teardown 只有一份），组件只消费
 * **内核导出的组件视图**（键集 = 内核 `COMPONENT_VIEW_KEYS` 里这一格声明的那几个）⇒ 不再从整个
 * `hostKernel` 解构（M9 的现状）；serve 套件的入参（`SESSION_SERVE_KEYS`）由会话从视图取。
 */
import { registerMascotRoutes } from './routes/mascot.js';
import { registerAvatarRoutes } from './routes/avatar.js';

/** patch 行 slug（`cordis.patch.yml` 里该行 `name` 的完整值，两处逐字相等）。 */
export const name = 'dsh-plugin-wallpaper-engine-mascot-avatar';

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
    throw new Error('[wallpaper-engine] mascot-avatar 没拿到 wallpaperEngineHost 服务'
      + '（inject 声明与宿主装载顺序不匹配）');
  }
  // 键视图 = `lib/subpackage-boot.js` 的 SUBPACKAGE_KEY_TABLE 里本包那一行（值全部来自主包模块级绑定）。
  // 记账 / 错误留证 / 「失败仍原样抛」三件事都在 `keys.runComponent()`（门面 `applyComponent`
  // 走的是同一个函数）⇒ 两条装载路径共用一份语义，不可能一条记了、另一条忘了。
  const keys = host.keys('mascot-avatar', ctx);
  // `http` 面（`sendJson` / `bodyReader`）不在冻结键表里，与 `packages/fonts` 同款：按需显式带上。
  const deps = Object.freeze({ ...keys, http: host.http });
  return keys.handOffTeardown(ctx, keys.runComponent('mascot-avatar', ctx, config, deps, applyImpl));
}

/**
 * 组件实现。第三个形参名取 `c`（与 `lib/kernel/host-session.js` 同一约定）：
 * `test/tools/host-route-index.mjs --deps` 按 `const { … } = c;` 现抽契约；路由族调用点的
 * `...keys` 展开则由 `test/verify-inject-contracts.mjs` 按冻结表认（`keys` 与 `apply()` 里那个
 * 绑定同名 ⇒ 两边指的是同一份键视图）。
 */
export function applyImpl(root, _rawConfig, c) {
  const keys = c;
  const { base, pluginName, componentViewFrom, createComponentSession } = c;
  // 两条装载路径都能这么读：① 子包行自己声明了 `inject = ['webServer', 'wallpaperEngineHost']`；
  // ② 门面路径的 `root` 就是门面的 ctx，而门面同样声明了 `inject = ['webServer']`（主行
  // `lib/index.js` 的 `inject` 声明）。
  const webServer = root && root.webServer;
  // 与门面 `apply()` 同款早退：服务在、但 register 面还没挂上（或换成了别的 webServer 实现）。
  if (!webServer || typeof webServer.register !== 'function') return () => {};

  // P2-7B 注入面收窄：从内核取**本组件声明的视图**（`COMPONENT_VIEW_KEYS['mascot-avatar']`），
  // 不再 `const { … } = hostKernel` 现解构 —— 后者等于把整个内核（键数与分级由
  // `test/verify-component-face.mjs` 现算）当成注入面（M9 的现状）。视图缺键即抛，不静默 `undefined`。
  const view = componentViewFrom('mascot-avatar');
  // 迷你会话（disposers / activeStreams / mediaMap / log / serveFile / 同序 teardown）收在内核侧：
  // serve 套件的入参（`SESSION_SERVE_KEYS`）由会话从视图取，本组件只取下面两条路由族要的键。
  const { disposers, serveFile, teardown } = createComponentSession(root, { base, pluginName }, view);
  // 服务层符号（目录 / 上限 / 原子落盘 / 请求收尾）继续由内核持有 —— 主包的 settings-schema、
  // presets、startup-sweep 与门面本身都还按同一套目录语义读写它们（见 lib/media/media-dirs.js）。
  const {
    mascotDir, mascotPath, MASCOT_EXT, MASCOT_MAX_BYTES,
    avatarDir, avatarPath, AVATAR_SIDES, AVATAR_EXT, AVATAR_MAX_BYTES,
    atomicWriteFileP, armBodyIdleTimeout, lingerClose,
  } = view;

  // ⚠️ **注册期必须包 try**（P2-4）：本实现要注册**两条**路由族，第 N 条抛错时前面 N-1 条已经
  // 把 disposer 推进了 `disposers`。若不在这里收尾就往外抛，`teardown` 永远交不回宿主
  // （`runComponent()` 只在 impl 正常返回时拿到它）⇒ 残留路由让下一次启用撞
  // `webserver: duplicate … route`。teardown 自己吞异常，原错照抛（装载失败必须仍然是红的）。
  try {
    // 6f. 「系统」页签的自定义吉祥物立绘 → lib/routes/mascot.js。POST 导入（raw body + MIME 白名单）/
    //     GET·HEAD 查看 / DELETE 清除，只认一张：导入前先清同族旧文件（"下一次导入覆盖上一次"）。
    registerMascotRoutes(webServer, {
      ...keys, disposers, base, serveFile, http: keys.http,
      mascotDir, mascotPath, MASCOT_EXT, MASCOT_MAX_BYTES,
      atomicWriteFileP, armBodyIdleTimeout, lingerClose,
    });

    // 6e. 「扩展」页签第一个模块（自定义会话头像）的两张图 → lib/routes/avatar.js。一条 prefix 注册
    //     覆盖三个端点；图落在插件数据目录的 `avatars/` 下（不进 overrides，也不进 uploads）。
    registerAvatarRoutes(webServer, {
      ...keys, disposers, base, serveFile, http: keys.http,
      avatarDir, avatarPath, AVATAR_SIDES, AVATAR_EXT, AVATAR_MAX_BYTES,
      atomicWriteFileP, armBodyIdleTimeout, lingerClose,
    });
  } catch (error) {
    teardown();
    throw error;
  }

  // 本组件自己的收尾（会话的 teardown，见 lib/kernel/component-session.js）：与 host-session 的
  // teardown 同序（逐个 disposer → destroy 在途流 → 清两个容器），但**没有** releaseKernelLease
  // —— 见文件头那条有意不对称。
  return teardown;
}
