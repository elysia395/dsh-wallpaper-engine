/**
 * `media-bridge` 子包宿主入口（P-D 阶段1：保留 media-bridge 包名，把壁纸域宿主路由族与浏览器半边并入本包；
 * P-F 第三格：`lib/components/media-bridge/` → `packages/media-bridge/`）。
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
import { registerWeAssetsRoutes } from './routes/we-assets.js';
// S5c 刀2：9 族宿主路由（21 条）从主包搬进本包 —— 实现在本包 `lib/routes/`，注册点只在
// `applyImpl` 里；c 面 = 键表（`...keys`：`kernel:` / `apply:` / `schema:` / `log:` 四种源型）
// ＋ 本组件会话自己的 `disposers` ＋ `http` 面（`sendJson`/`bodyReader`）。
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerSlidesRoutes } from './routes/slides.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerPropsRoutes } from './routes/props.js';
import { registerMediaBytesRoutes } from './routes/media-bytes.js';
import { registerMediaDerivedRoutes } from './routes/media-derived.js';
import { registerSceneFrameRoutes } from './routes/scene-frame.js';
import { registerSceneServeRoutes } from './routes/scene-serve.js';
import { registerSceneMediaRoutes } from './routes/scene-media.js';
import { registerLiveFrameRoutes } from './routes/live-frame.js';
// S5d 刀3：遮挡/省电判据源整族入包 —— 生产端（x11 探针 + 心跳/降级）在本包
// `lib/occlusion/`，只读端点在本包 `lib/routes/occlusion.js`；hub 由本入口在行装载时现建。
import { createOcclusionHub } from './occlusion/index.js';
import { registerOcclusionRoutes } from './routes/occlusion.js';

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
    throw new Error('[wallpaper-engine] wallpaper 没拿到 wallpaperEngineHost 服务'
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
  const webServer = keys.tolerantWebServer(root && root.webServer);
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

  // S5d 刀3. 遮挡/省电判据源随本组件行装载：hub 在**本入口**现建（x11 探针 + 心跳 + 降级），
  // dispose 推进**本组件会话**的 `disposers` —— 保 S7.1 行级开关（关包行 ⇒ hub 与 `/occlusion`
  // 一起撤，不碰主包其它族）。日志/诊断走键表同源绑定：`log:` 源型与 `kernel:appendDiagLine`。
  // 行为变化（有意）：hub 生命周期从「主包 apply」变为「wallpaper 行装载」—— 这正是
  // 「省电判据源 + 策略同包」的定义；浏览器侧仍只经 HTTP（`/occlusion`）消费，零跨包调用。
  // 平台适配器 / 会话判定留在主包（`lib/occlusion/x11.js`），经键表 `schema:` 面注入 ——
  // 缺键会让 `createOcclusionHub` 大声抛（不静默退化成"永远降级"）。
  const occlusionHub = createOcclusionHub({
    log: keys.log.tag('occlusion'),
    diag: (obj) => keys.appendDiagLine('occlusion', obj),
    isX11CandidateEnv: keys.isX11CandidateEnv,
    createX11Adapter: keys.createX11Adapter,
  });
  disposers.push(() => occlusionHub.dispose());
  occlusionHub.start().catch(() => { /* hub.start 不外抛；兜底防 unhandled（主包原实现同款） */ });

  // ⚠️ **注册期必须包 try**（P2-4）：本组件一次性注册**二十九条**路由（媒体状态 5 + WE 素材源 2
  // + S5c 刀2 的 9 族 21 条 + S5d 刀3 的遮挡 1 条），
  // 中途抛错时已经推进 `disposers` 的那几条会留下（`mediaBackend.stop()` 也在同一个 disposer 列表里，一并丢）
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
    // 3c-3d/3c-3e. WE 官方素材源族（`/api/local-assets` + `/we-assets-dir`）→ 本包
    //       `lib/routes/we-assets.js`（S5b 刀1 出户）。两条注册、配置-消费共用可变真源
    //       `WE_ASSETS_DIR` 都在那个文件里；这里只声明它的依赖（与门面调用点逐键相同）。
    registerWeAssetsRoutes(webServer, {
      ...keys, disposers, base, serveFile, CONTROL_JSON_MAX_BYTES, http: keys.http,
    });

    // ── S5c 刀2：9 族宿主路由（21 条；注册顺序与主包门面逐字一致）──────────────────
    // `...keys` 提供键表里本包的**全部**键（kernel:/apply:/schema:/log: 四种源型同源）；
    // `disposers` **只用本组件会话的**（S7.1 行级开关：组件被关时只回滚它自己登记的这 21 条，
    // 不碰主包其它族）；`http` 面按需显式带上（S5b 同款，`verify-json-response` 来路 c）。
    // ⚠️ 这里**不能**再显式覆盖 `serveFile` / `mediaMap` / `tokenFor`：它们来自 `...keys` 的
    // `apply:` 面（= 主包本次 apply 会话的同一份实例，R1 token 域单主权）；覆盖成本组件会话
    // 那份会让 token 查不到（组件会话自建第二张 mediaMap）。

    // 1. 壁纸清单 JSON（`/inventory`）→ 本包 `lib/routes/inventory.js`。
    registerInventoryRoutes(webServer, {
      ...keys, disposers,
    });

    // 1b. 图片 / 幻灯片壁纸的图集清单（`/slides/<token>`）→ 本包 `lib/routes/slides.js`。
    //     `listImages` 走键表 `kernel:listImages`（内核扫描族），`mediaMap` / `tokenFor`
    //     仍是 `...keys` 的 `apply:` 面（与 `/media` 同一张 token 表）。
    registerSlidesRoutes(webServer, {
      ...keys, disposers, http: keys.http,
    });

    // 2/3a. 派生媒体族（源元信息 / 抽帧转码 + 进度 / 视频缩略图）→ 本包 `lib/routes/media-derived.js`。
    registerMediaDerivedRoutes(webServer, {
      ...keys, disposers,
    });

    // 2/3. 媒体 + 预览原始字节（`/media`、`/preview`）→ 本包 `lib/routes/media-bytes.js`。
    registerMediaBytesRoutes(webServer, {
      ...keys, disposers,
    });

    // 3c-3b/3c-5. 场景帧服务族（实时抓帧缓存 / 自定义画面）→ 本包 `lib/routes/scene-frame.js`。
    registerSceneFrameRoutes(webServer, {
      ...keys, disposers, http: keys.http,
    });

    // 3c-2/3c-3. 场景载荷服务族（live 渲染页 / 场景文件 / 媒体源诊断）→ 本包 `lib/routes/scene-serve.js`。
    registerSceneServeRoutes(webServer, {
      ...keys, disposers,
    });

    // 3c-3c. 壁纸属性（WE 用户属性）→ 本包 `lib/routes/props.js`。
    registerPropsRoutes(webServer, {
      ...keys, disposers, http: keys.http,
    });

    // 3c-4. 网页壁纸首帧缓存（`__wp.capture` 回填的 JPEG）→ 本包 `lib/routes/live-frame.js`。
    registerLiveFrameRoutes(webServer, {
      ...keys, disposers, http: keys.http,
    });

    // 3e. 场景内嵌媒资（动画 MP4 + 独立音频）→ 本包 `lib/routes/scene-media.js`。
    registerSceneMediaRoutes(webServer, {
      ...keys, disposers,
    });

    // 4/5/6. 上传资产族（导入 / 删除 / 切换上传目录）→ 本包 `lib/routes/upload.js`。
    registerUploadRoutes(webServer, {
      ...keys, disposers, http: keys.http,
    });

    // S5d 刀3. 遮挡快照族（`/occlusion`）→ 本包 `lib/routes/occlusion.js`（一族一条）。
    // ⚠️ 调用点形态被判据钉住（test/verify-occlusion-hub.mjs 的 D3）：`hub` 与 log/diag 必须
    // 在这个字面量里逐键给到，引入中间变量/少给 `hub` 都判红。`diag` 用内核 `appendDiagLine`
    // 的同源绑定（与主包原调用点同一份实现）。
    registerOcclusionRoutes(webServer, {
      ...keys, disposers, base, hub: occlusionHub,
      log: keys.log.tag('occlusion'),
      diag: (obj) => keys.appendDiagLine('occlusion', obj),
      http: keys.http,
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
