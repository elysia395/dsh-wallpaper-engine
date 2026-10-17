/**
 * index.js — **字体系统子包的宿主入口**。
 *
 * 落点 = 字体子包的**宿主半边**（ADR-0014 S3.4）：
 *   · 搬进来的：字体系统的**两条宿主路由族** —— `fontsets`（字体集 /fontsets）与
 *     `system-fonts`（本机字体清单 /system-fonts），见 ./routes/*.js。
 *   · P-C（2026-10-16）之后**浏览器半边也随包走**：入口 `src/client.js` + 外观页签第六节
 *     「全局字体」渲染器 `src/appearance-font-section.js` + 字体集编辑器 `src/fontset-editor.js`，
 *     产物 `lib/client.fonts.js` ⇒ 本包**声明** `dsh.client` 且清单里有 `exports['./client']`
 *     （ADR-0014 S3.4 的两向判据）。
 *   · **仍然不搬**：`src/fontset-store.js`、`src/system-fonts.js`、`src/font/apply.js`、
 *     `src/font/typography.js`、`src/font/color-roles.js`、`src/font/components.js`
 *     （它们与主包其它半边在求值期/运行期双向耦合，见 §6.1 = A 的归属裁决）。
 *
 * ⚠️ 归属（务必先读）：用户口径 **§6.1 = A「代码归属，不是状态归属」**（正本 = ADR-0013 **D20**）。
 *    字体键的**真源与状态**在主包 `lib/settings-schema.js`（`FONTSET_KEYS` 单点定义）与
 *    `fontsets/<id>.json`；本包裹走的只是**渲染器与描述符** ⇒ 本包**不持键、不持久化、
 *    不注册 `settings.section`**，读值一律经主包构造的渲染 ctx（或本文件声明的 `host` 面）。
 *
 * 两条加载路径共用这一个实现（与 packages/about-notice/lib/index.js 同形）：
 *   ① 宿主按 patch 行（cordis.patch.yml）当独立 plugin 加载 ⇒ `apply(ctx, config)`（拆出后**唯一**
 *      的加载路径：主包门面已不再有字体路由的调用点）。
 *   ② 两条路由族自己的 `registerXxxRoutes(webServer, c)` 也可以被别的调用点直接驱动 —— `c` 由本文件拼齐。
 *
 * ══ 跨包通道（唯一一条）══════════════════════════════════════════════════════════════
 * ADR-0014 S5.1 / S5.3：子包宿主半边**不 import 主包任何模块**
 * （相对路径 import 与主包裸 specifier 都禁止）。本包的 `inject` 声明主包供给的 Cordis 服务
 * `wallpaperEngineHost`，`apply()` 里 `const host = ctx.wallpaperEngineHost` 取到全部面：
 *   · `host.keys('fonts', ctx)` —— **冻结的显式键集**（本文件只消费它，不自己拼内核）；
 *     缺 id / 缺键一律**抛错**，不许静默 undefined（ADR-0013 D3③「宁可显示、不可静默消失」的宿主侧纪律）。
 *   · `host.keyNames('fonts')` —— 声明面（守卫读的那份；本文件拿它当 REQUIRED_KEYS 的对账面）。
 *   · `host.handOff(ctx, dispose)` —— 与 lib/host-boot.js 同名函数同义：`export function apply`
 *     是**函数声明**（有 prototype）⇒ cordis 走 `new apply(ctx)`、**返回值被丢弃** ⇒ 只 `return dispose`
 *     不够，必须同时交 `ctx.effect`（同 lib/index.js 的 `apply()` 末尾 fiber disposer 教训 / lib/host-boot.js 的 `handOffTeardown`）。
 *   · `host.schema` / `host.http` —— 共享内核的纯符号与 JSON 应答 / 读体的两个纯函数面；
 *     两条路由族不再静态 import 主包，由本文件显式传给它们的 register（见 routes/*.js 文件头）。
 *
 * 为什么不是「解构整个 hostKernel」/ 不是叶子 import：`import` 是**模块图**上的边，关掉主包后子包
 * 仍握着旧代 exports（ADR-0014 S5.1 / S5.3 反模式：留着指向主包的模块图边）；`inject` 才是 cordis 唯一的级联判据
 * （`name in fiber.inject`）⇒ 主包停用，子包 fiber 自动 park（ADR-0014 S7.2「关主包 = 关整族」的物理基础）。
 *
 * 开发期解析：`scripts/dev-link-subpackages.mjs` 在 `<profile>/node_modules/` 建
 * `dsh-plugin-wallpaper-engine-<pkg> → packages/<pkg>` junction（发布态天然是兄弟目录，同一份 patch 两态成立）。
 * ⚠️ 本文件已零主包 specifier ⇒ 仓内跑它**不再**需要仓库根的 `node_modules/dsh-plugin-wallpaper-engine`
 * 自链接（那一层链接只服务旧的 `dsh-plugin-wallpaper-engine/subpackage-boot.js` 叶子通道）。
 */

import { join } from 'node:path';

import { registerFontsetsRoutes } from './routes/fontsets.js';
import { registerSystemFontsRoutes } from './routes/system-fonts.js';

/** 行标识：与 packages/fonts/cordis.patch.yml 里那行的 `name` 逐字相同（ADR-0014 S4.2 会逐字对账）。 */
export const name = 'dsh-plugin-wallpaper-engine-fonts';

/** 这一族的宿主注入面：`webServer`（两条路由都注册在它上面）+ 主包的跨包服务面（ADR-0014 S5.1）。 */
export const inject = ['webServer', 'wallpaperEngineHost'];

/**
 * 宿主半边入口。`ctx` 是 cordis 的插件上下文（`new apply(ctx)` 形态），`config` 来自 patch 行的 config
 * （本包今天不使用：路由路径/键名都是定死的，要求行为零回归）。
 *
 * @returns {() => void} 拆卸函数（同时已交 `ctx.effect`；mock ctx 无 effect 时退回返回值，见 host-boot.js:188-197）。
 */
export function apply(ctx, _config) {
  const webServer = ctx && ctx.webServer;
  // provider 缺席（主包没起 / 没有 webServer）：与 about-notice 同口径 —— 静默退回空拆卸，
  // 不抛异常炸掉整行（行级失败静默）。
  if (!webServer || typeof webServer.register !== 'function') return () => {};

  // 跨包服务面：键集 / 声明面 / 拆卸交接 / 纯符号面都从这**一个**服务取（子包半边零主包说明符）。
  const host = ctx.wallpaperEngineHost;
  // 显式键集：键表 **逐字派生**自主包服务面的冻结表（真源 lib/subpackage-boot.js），缺 id / 缺键在这里抛错
  // （**不静默 undefined**）。键集只含 host-only 的**运行期实例**；共享内核的纯符号面走 host.schema /
  // host.http，由下方传给两条路由的 register。
  const keys = host.keys('fonts', ctx);
  assertFontsKeys(host.keyNames('fonts'), keys);

  // 拆卸句柄数组：照主包 lib/kernel/host-session.js:190/:257 的口径（一个数组、插入顺序、
  // 逐条兜错），两条路由族的 register 都往它 push。
  const disposers = [];
  // 两个调用点各自给**自己那一族**的键集：`...keys` 是冻结表（唯一真源），`disposers` 是共用
  // 拆卸句柄数组，`cachePath` 只给 system-fonts 一族（fontsets 不消费它 —— 别把不认识自己的键塞给它，
  // test/verify-inject-contracts.mjs 的调用点对账会把它记成「多给」）；
  // `schema` / `http` 是两条族共用的**纯符号面**（来自 host），显式传给各自的 register。
  try {
    registerFontsetsRoutes(webServer, { ...keys, disposers, schema: host.schema, http: host.http });
    registerSystemFontsRoutes(webServer, {
      ...keys,
      disposers,
      schema: host.schema,
      http: host.http,
      // 落盘缓存路径与主包同式（本文件 :94；出户前 = 主包 lib/index.js:383）：pluginDataDir()/system-fonts.json。
      cachePath: () => join(keys.pluginDataDir(), 'system-fonts.json'),
    });
  } catch (error) {
    // 半边起不来就整行回滚（不留半死态：第一条已经 push 的 disposer 先跑掉再抛）。
    disposeAll(disposers);
    throw error;
  }

  return host.handOff(ctx, () => disposeAll(disposers));
}

/**
 * 本包从 `c` 消费的全部键。**不手写第二份清单**：逐字派生自主包服务面的冻结表
 * （`host.keyNames('fonts')`）—— 冻结表是唯一真源（守卫读的声明面），派生保证两份永不漂移。
 * `disposers`/`cachePath`/`schema`/`http` 由本文件自带，不在冻结表内。
 *
 * ADR-0013 D3③「宁可显示、不可静默消失」的宿主侧对应纪律：键集**缺一个就抛错**，绝不让 `undefined` 顺着
 * `c` 流进路由（那时错误会变成"某个请求 500"或"某个下拉空着"，离根因很远）。
 * 声明面与实际键集不一致 = 契约漂移，必须在这里炸而不是靠人记得。
 */
function assertFontsKeys(required, keys) {
  const missing = required.filter((k) => keys[k] === undefined);
  if (missing.length) {
    throw new Error(`[wallpaper-engine-fonts] host.keys('fonts') 缺少声明面要求的键：${missing.join(', ')}`);
  }
}

/**
 * 逐条兜错的拆卸：**插入顺序**、单条抛错不影响其余（与 lib/kernel/host-session.js:257 逐字同口径）。
 * `splice(0)` 让重复调用成 no-op（teardown 可能被 ctx.effect + 调用方各跑一次）。
 */
function disposeAll(disposers) {
  for (const d of disposers.splice(0)) {
    try { d(); } catch { /* ignore */ }
  }
}
