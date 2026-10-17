/**
 * dsh-wallpaper-engine — 宿主引导（**叶子模块**，P2-2b 拆环）。
 *
 * 为什么是叶子：本模块只 import `node:fs` 与 `./kernel/host-kernel.js`，**不** import
 * `lib/index.js`，也不 import 任何组件入口 / 路由模块。门面与三格组件入口共用同一份注入 deps：
 * 门面经下面的静态 import 直取；组件侧经 Cordis 服务面 `ctx.wallpaperEngineHost`（键表在
 * `lib/subpackage-boot.js`，`boot:` 源型的值即本模块的绑定）⇒ 组件入口环边不存在（既不 import 门面、
 * 也不 import 本模块；P2-1b 只消除了门面求值期的读边）。
 *
 * 谁在什么时点读它：
 *   - `lib/index.js`：模块 import 期静态 import 这里的五个绑定（`hostKernel` / `BASE` /
 *     `runComponent` / `handOffTeardown` / `componentProbe`）；`hostKernel` 单例在**本模块求值时**
 *     创建（与搬家前「模块加载期建成一次」逐字同义）⇒ `test/verify-adapter.mjs` 的
 *     「env 必须先于门面 import 设好」加载期契约不变。
 *   - `packages/{about-notice,mascot-avatar,media-bridge}/lib/index.js`：宿主按 patch 行把组件当**独立 plugin** 装载时，组件入口的 `apply()` 经 Cordis 服务 `ctx.wallpaperEngineHost` 取 deps。
 *
 * 纪律：本模块**不得** import 门面或任何组件（否则环只是换了一条边）；除 `createHostKernel()`
 * （必须保持模块级 / import 期）外不得有初始化副作用。
 */
import { readFileSync } from 'node:fs';
// ── 宿主内核 ───────────────────────────────────────────────────────────────
// 套件实例（原名 → 内核内的私有句柄）住在 lib/kernel/host-kernel.js：
//   WE 发现 discovery · 配置 configKit · 数据目录 dataDir · 场景探测 sceneProbeKit
//   MP4 探测 mp4ProbeKit · 转码 transcodeKit · 上传库 uploadStoreKit · 随包资源 weAssetsKit
//   shim/seed shimSeedKit · 帧缓存 frameStoreKit · 视频预览 videoPreviewKit · 媒体目录 mediaDirsKit
//   诊断追踪 diagTraceKit · 缓存根 cacheDirKit · http 生命周期 httpLifecycleKit。
// 只被族间互调、门面不用的符号（atomicTmpPath / enqueueConfigWrite / readProjectP /
// resolveFfmpeg / resolveSceneMainFileP / SCAN_CHUNK / spawnFfmpeg / videoPreviewCacheDir /
// writeConfig）留在内核内部，不出现在门面里。
// 契约（稳定面 / 内部面划分 / 访问器纪律）与时点纪律见 lib/kernel/host-kernel.js 文件头。
import { createHostKernel } from './kernel/host-kernel.js';

/** Request path prefix under which this bundle's HTTP surface lives. */
export const BASE = '/wallpaper-engine';
/** 终端行前缀里的名字（日志与提示通道共用同一个，别写成两处字面量）。 */
export const PLUGIN_NAME = 'wallpaper-engine';

// 宿主内核实例：**模块加载期**建成一次（门面与组件行共用同一个实例 ⇒「同一模块实例再次
// apply 状态保留」的语义不变）。搬出前它在 `lib/index.js` 的模块作用域里创建，时点同义。
export const hostKernel = createHostKernel();

/**
 * 本仓的 GitHub `owner/repo`（star 数那条路由的入参）—— **从 package.json 现读**，
 * 不另写一份字面量：仓库地址在 package.json 与 README 里已经各有一份，插件再抄一份
 * 就会在改地址时漏改一处（而那一处只在"关于页数字不更新"时才被发现）。
 * 解析不出来就返回空串 ⇒ 路由回 `ok:false`、关于页不显示数字（静默降级，不炸）。
 */
export function repoSlugFromPkg() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const url = String((pkg.repository && pkg.repository.url) || '');
    const m = url.match(/github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
    return m ? m[1] : '';
  } catch { return ''; }
}

/**
 * 组件装载账本（P2-4 A2；P2-2b 从门面模块作用域搬来这里）。
 *
 * 为什么值得搬到一个叶子模块：拆环后「按组件加载」有**两条入口** —— 门面的
 * `applyComponent(root, rawConfig, component)`（"按组件加载"的公开分发点，守卫真调它）与组件
 * 入口自己的 `apply(ctx, config)`（宿主按 patch 行当独立 plugin 加载时走的路）。两条路都要记同一
 * 本账，否则 `/diag-log` 探针只能看见其中一条 —— 而探针要回答的恰是"这个进程里到底装载了哪几行"。
 *
 * 为什么不是门面导出：组件入口若为了记账去 import 门面，就等于把 P2-1b/P2-2b 刚拆掉的
 * `组件入口 → 门面` 那条环边重新接上（宿主真实装载顺序是裸行在前 ⇒ 组件模块先求值 ⇒ 门面模块级
 * 绑定还在 TDZ）。落在这里，两条入口都只依赖叶子模块。
 *
 * 纪律：本 Set 只被 `markComponentLoaded()` 写、被探针读；**不读任何组件入口导出**。
 */
export const loadedComponents = new Set();

/**
 * 记一次「组件行被加载 / 被分发」。（语义是**进入 apply**，不是激活成功 —— 激活成功另有
 * `startedComponents`，见下。）
 * @param {string} component patch 行 `name` 的子路径段（如 `'about-notice'`）
 */
function markComponentLoaded(component) {
  loadedComponents.add(component);
}

/**
 * 激活成功账本 —— 「进过 apply」不等于「实现跑完了」，这本账记后者。
 *
 * 为什么另开一本：`loadedComponents` 只回答"apply 进没进"，而真实存在的故障形态是
 * **apply 进了、实现抛了**（`cannot get property "webServer" without inject`）⇒ `/diag-log` 的
 * `loaded` 显示两个组件都在，用户却看到"组件启用失败"警告、该组件的路由全 404 —— 探针**假绿**。
 * 本 Set 只在 `applyImpl` 真的跑完（把 disposer 交回宿主）时登记。
 */
export const startedComponents = new Set();

/**
 * 激活失败账本：组件名 → 错误消息（**只留 UI 上那行报错文案，不留 Error 对象**，避免把整个
 * 会话的错误对象图挂在模块作用域里）。
 *
 * 何时被写：宿主把 patch 行当独立 plugin 装载时，`apply()` 抛出的错由 loader 记（本模块不接）；
 * 但**门面路径**（`applyComponent`）与**入口路径**的抛错都会先经 `runComponent` 留证，再原样往外抛
 * （绝不吞错：组件行加载失败必须仍然是红的、可被 harness 检查到）。探针把这张表并进
 * `components.failed`，让"启用失败"这件事在 `/diag-log` 上可见，而不是只剩终端里一行 warning。
 */
export const failedComponents = new Map();

/**
 * 记一次激活失败（幂等覆盖：后来的错误消息更近现场）。
 * @param {string} component patch 行 `name` 的子路径段
 * @param {unknown} error 抛出的错误（取 `.message`，缺失则 String()）
 */
function markComponentFailed(component, error) {
  /** @type {string} */
  let message;
  try {
    const e = /** @type {{ message?: unknown }} */ (error);
    message = error && e.message ? String(e.message) : String(error);
  } catch { message = '(无法序列化的错误)'; }
  failedComponents.set(component, message);
  // 失败即未启动：清掉成功账本里的同名项（同一进程内先后两次装载同一组件时，后一次失败不得
  // 被前一次的成功记录遮住）。
  startedComponents.delete(component);
}

/**
 * 记一次激活成功。
 * @param {string} component patch 行 `name` 的子路径段
 */
function markComponentStarted(component) {
  startedComponents.add(component);
  failedComponents.delete(component);
}

/**
 * 组件实现的注入面（`applyImpl(root, rawConfig, c)` 的第三个实参）。两条装载路径注入同一份 deps。
 *
 * P-F 起这份面取自**冻结键表**（`lib/subpackage-boot.js` 的 `SUBPACKAGE_KEY_TABLE`）：键逐个在表里
 * 列出，且**不含 `hostKernel`**（改为注入已绑定的 `componentViewFrom` / `createComponentSession`，
 * 不让组件直接解构内核内部面，见 ADR-0013 D12）。
 *
 * 记录类型为何是**开放**的：三条组件行 2026-10-16 全部出户之前，门面这条装载路径注入的是主包字面量
 * `{ hostKernel, base, pluginName, repoSlugFromPkg }`；出户后两条路径**都**走键表（`lib/index.js` 的
 * `applyComponent` 与组件入口 `apply` 逐步同源）。四条具名键因此保留为**可选**：历史形状与键表形状
 * 都可能出现在调用点，实参由 `applyImpl` 自己解构。
 * @typedef {Readonly<Record<string, unknown>> & { hostKernel?: object, base?: string, pluginName?: string, repoSlugFromPkg?: () => string }} ComponentDeps
 */

/**
 * 组件装载/激活的**唯一记账入口**：两条装载路径（门面 `applyComponent` 与组件入口 `apply`）都经
 * 它调实现 —— 记账逻辑只有一份，不可能出现"某条路径忘了记账"（P2-2b 起两本账就是为此而设）。
 *
 * 三个账本的语义（`componentProbe()` 按它们出 `/diag-log`）：
 *   - `loadedComponents` ：进了本函数（apply 走到了）—— 回答"patch 行装载了没"；
 *   - `startedComponents`：`impl` 跑完并交回 disposer —— 回答"启用成功没"；
 *   - `failedComponents` ：`impl` 抛错 —— 回答"为什么失败"（只留错误消息）。
 * 「跑完」包含实现自己的早退分支（注册期没有 webServer 时返回空 disposer）：那是**加载期无事可做**，
 * 不是失败，所以照样算 started。
 *
 * 错误**绝不吞**：留证后原样往外抛 —— 宿主 loader 的 `did not activate` 检查、调用方的 try/catch
 * 都靠这个错（**别让"loaded 已记上"把它掩盖掉** —— 那正是探针假绿的成因）。
 *
 * @param {string} component patch 行 `name` 的子路径段（如 `'about-notice'`）
 * @param {object} root fiber 根上下文（门面分发时是门面 `apply` 的 `ctx`；宿主按行装载时是该组件的 `ctx`）
 * @param {unknown} rawConfig patch 行原样配置
 * @param {ComponentDeps} deps 显式依赖面（两条路径注入同一批绑定）
 * @param {(root: object, rawConfig: unknown, deps: ComponentDeps) => (() => void)} impl 组件实现
 * @returns {() => void} 实现交回的 disposer
 */
export function runComponent(component, root, rawConfig, deps, impl) {
  markComponentLoaded(component);
  let dispose;
  try {
    dispose = impl(root, rawConfig, deps);
  } catch (error) {
    markComponentFailed(component, error);
    throw error;
  }
  markComponentStarted(component);
  return dispose;
}

/**
 * 把 teardown 交给宿主 fiber —— **不能只靠 `apply` 的返回值**。
 *
 * 为什么必须另交一份（关掉再打开子组件 ⇒ 宿主报 `webserver: duplicate … route`）：
 * cordis 判定插件回调「是不是类」看的是**有没有 `prototype`** —— `export function apply(…)` 有
 * `prototype` ⇒ loader 走 `new callback(ctx, config)` 分支，而 `new` 的返回值被**丢弃** ⇒ 我们
 * `return` 的 disposer 谁也没接住，fiber 卸载时路由从未撤销（旧注册留在宿主的路由表里），下一次
 * 启用立刻撞「重复路由」。`ctx.effect()` 是 cordis 的**显式**清理通道（`@deepseek-ai/dsh-*` 家族
 * 注册路由的插件全走它）⇒ 这里把同一份 disposer 交进去；返回值只为**直调方**保留（测试夹具、
 * 只提供 `webServer` 的 mock ctx）。
 *
 * `once` 包一层：两条通道将来若被同时收（有人把 `apply` 改成无 `prototype` 的箭头形态），teardown
 * 仍恰好跑一次。mock ctx 没有 `effect()` 时**静默**退回「只靠返回值」—— 真宿主一定有 `effect`
 * （reflect 混入），所以这不是降级面，只是让既有夹具不必改。
 *
 * @param {{ effect?: (fn: () => void) => void }|null} ctx fiber 上下文（门面路径与组件行路径都是它）
 * @param {() => void} dispose 实现交回的 teardown
 * @returns {() => void} 幂等包装后的 teardown（供直调方使用）
 */
export function handOffTeardown(ctx, dispose) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    dispose();
  };
  if (ctx && typeof ctx.effect === 'function') ctx.effect(() => once);
  return once;
}

/**
 * 组件装载探针（`/diag-log` 的 `components` 字段）。
 *
 * 口径（`test/verify-bundle-rows.mjs` ⑧ 逐条断言）：
 *   - `declared`：`cordis.patch.yml` 里声明了几行组件 —— 由门面 `lib/index.js` 传入
 *     （门面是唯一真源：它 import 组件入口建实现表）；
 *   - `loaded`  ：进入过 apply 的名字（探针观测面，顺序按 declared 归一，便于比对）；
 *   - `started` ：apply 跑完、disposer 已交回宿主的名字（**这才算启用成功**）；
 *   - `failed`  ：名字 → 错误文案（激活抛错的那些）；
 *   - `missing` ：declared − loaded（patch 行没被装载 / 被 disable / 入口路径没走到）。
 *
 * 顺序纪律：`started` / `failed` 都是按 `declared` 的顺序输出的数组 / 对象，避免跨进程顺序抖动。
 *
 * `builtin`（第二个可选入参，**不参与上面那套 patch 行语义**）：本包**代码里内建**的组件行名
 * （门面 `componentImpls()` 的键 —— 声明面的另一个侧面：`declared` 回答"这次装载进没进行"，
 * `builtin` 回答"这个包写死了哪些组件行"）。两者都保留的理由是可判据性：
 * `test/verify-bundle-rows.mjs` 把 `declared` 钉成 **patch 子行逐名相等**（多塞一个就红），
 * 而"行被 disable"这一态需要消费方看见**一个确实存在、但值为不可用**的键 ⇒ 用 `builtin` 表达，
 * 不去放宽 `declared` 的既有判据。
 *
 * @param {readonly string[]} declared 组件声明面（顺序即输出顺序）
 * @param {readonly string[]} [builtin] 代码内建的组件行名（消费方据此区分"行被关掉"与"未知行"）
 */
export function componentProbe(declared, builtin) {
  const names = Array.isArray(declared) ? declared : [];
  const failed = {};
  for (const n of names) {
    if (failedComponents.has(n)) failed[n] = failedComponents.get(n);
  }
  return {
    declared: [...names],
    builtin: Array.isArray(builtin) ? [...builtin] : [],
    loaded: names.filter((n) => loadedComponents.has(n)),
    started: names.filter((n) => startedComponents.has(n)),
    failed,
    missing: names.filter((n) => !loadedComponents.has(n)),
  };
}
