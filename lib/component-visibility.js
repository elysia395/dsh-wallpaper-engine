/**
 * component-visibility.js — 组件行**浏览器可见面**的声明单一真源（ADR-0013 D3②）。
 *
 * 回答的问题：**关掉一个组件行之后，浏览器半边的哪些渲染函数该整块不渲染**。
 * 这张表与**实现双向对账**（判据 `test/verify-component-visibility.mjs`）：声明了没 gate、
 * gate 了没声明，两个方向都红 —— 少了这份对账，两个方向都是静默通过，
 * 用户看到的是"关掉了却还显示"或"没声明的东西被顺手藏了"。
 *
 * ── 为什么声明住在**宿主侧**（而不是浏览器侧）────────────────────────────────────
 *   · D3② 明文禁止浏览器侧再写第二份"组件名 → UI"清单：状态面由宿主给（`/inventory` 的
 *     `components`），浏览器侧只**读**；把映射表也搬过去，等于把"行的语义"复制成两份。
 *   · 行的存在性本来就是宿主侧事实（`cordis.patch.yml` 的行 + 门面 `componentImpls()`），
 *     声明跟着它走才不会与行清单漂移。
 *   · 落点文件全是浏览器侧路径 ⇒ 这份声明是**跨半边**的：宿主侧持有映射，浏览器侧持有 gate。
 *
 * ── 谁消费它 ─────────────────────────────────────────────────────────────────
 *   · `test/verify-component-visibility.mjs`（判据）：逐项对账 + 负对照；
 *   · `lib/index.js` **再导出**一次，使本文件落在 import 图上 —— `test/verify-reachability.mjs`
 *     的棘轮是「零不可达文件」，一个没人 import 的 lib 文件会当场把它顶红。
 *     再导出不产生 import 绑定 ⇒ 不撞 `test/verify-module-layout.mjs` ⑨ 的"死绑定"判据。
 *
 * ── 落点格式与 gate 契约（判据按这个文本形态认，改形态要同步改判据）──────────────
 *   `COMPONENT_VISIBILITY` = 组件名 → `[{ file, symbol }]`：
 *     · `file`   浏览器侧源文件（仓库相对路径，posix 分隔）；
 *     · `symbol` 该文件里**顶层具名函数**（`function NAME(` 或 `const NAME = (`）。
 *   每个 `(组件, file, symbol)` 三元组都必须满足：该函数体内出现一次
 *     `weComponentVisible(<提到 components 的表达式>, '<组件名>')`
 *   —— 第一个实参必须真的把状态面传进来（写死 `true` 会被判红），第二个实参必须是组件名字面量。
 *   `weComponentVisible` 的**唯一实现**在 `COMPONENT_GATE.file` 的 `COMPONENT_GATE.symbol`；
 *   它的失效口径由判据**真跑**（抽真源码 + 夹具），分两层且别混：
 *     · **整块** `components` 读不到 / 非对象 ⇒ 按"可用"渲染（D3③：探测失败不许让功能凭空消失）；
 *     · `components` 是对象时**只有 `'started'` 算可用** ⇒ **键缺席**（行被 disable 时键压根不出现）、
 *       `missing`、`failed:<…>` 一律不渲染。键缺席按"可用"会让"关掉一行"永远藏不掉。
 *
 * ── 本轮范围（有意写成棘轮，改范围必须显式改判据）────────────────────────────────
 *   只有 `about-notice` 与 `mascot-avatar` 两行。`media-bridge` **显式排除**（用户口径：它是
 *   壁纸子插件的过渡形态，后续并入更大的语义变更）⇒ 判据要求声明面的键集恰为下面两组。
 *
 * 纪律：本文件**零 import**（纯数据 + 契约描述），因此不可能与门面 / 组件入口成环。
 */

/**
 * 组件行 → 可见面落点（ADR-0013 D3② 的单一真源）。
 *
 * `about-notice`：只有「关于」页签里那几块由该组件供数的内容（star 行 / 两张联系方式二维码 /
 * 更新公告）需要消失。**不占整页**：那个页签里还有项目简介与贡献者致谢（与两条宿主路由无关）
 * ⇒ 把整页当它的可见面是**过度隐藏**，所以落点是页签渲染器与更新公告弹窗，不是页签表。
 *
 * `mascot-avatar`：三处都要跟着行关 —— 设置页的吉祥物区块、「扩展」页签里的头像模块、会话头像
 * 装饰层。
 *
 * ── 当前事实：本轮两个组件都**不占整页**（所以页签表不是落点）────────────────────
 *   · 「关于」页签里还有项目简介与贡献者致谢（与 `about-notice` 的两条宿主路由无关）；
 *   · 「系统」页签 = `renderMascotTab` ＋ `renderAdvancedTab`（缓存位置 / 适配器目标 / 暂停策略
 *     与立绘 / 头像无关，而 `media-bridge` 本轮明确定为不动）。
 *   ⇒ 可见面一律是**页签内的区块**；在页签表里 gate 组件 = 顺带藏掉无关小节，属过度隐藏。
 *   **变更时需要什么**：将来某个组件真独占一页（页签内容只剩该组件的可见面）才把页签表的派生
 *   函数加回本表，并同步 `src/client.js` 的 `activeTab` 校验 / 回落（被 gate 的页签不能留在导航里）。
 */
export const COMPONENT_VISIBILITY = {
  'about-notice': [
    { file: 'src/panel-tabs.js', symbol: 'renderAboutTab' },
    { file: 'src/client.js', symbol: 'UpdateNotice' },
  ],
  'mascot-avatar': [
    { file: 'src/panel-tabs.js', symbol: 'renderMascotTab' },
    { file: 'src/panel-tabs.js', symbol: 'renderExtensionsTab' },
    { file: 'src/avatar-layer.js', symbol: 'syncAvatarLayer' },
  ],
};

/**
 * 浏览器侧 gate 的**唯一判据**落点（名字与实现见 `src/client.js`）。
 *
 * 判据从该文件抽出这个函数的源码**真跑**一遍（三态夹具 + 两条负对照），所以它必须
 * **自包含**：只依赖自己的两个入参，不调模块级别的函数（否则真跑会抛 ReferenceError，
 * 判据如实报红并带上原因）。
 */
export const COMPONENT_GATE = { file: 'src/client.js', symbol: 'weComponentVisible' };

/**
 * **gate 的注入别名**（模块边界真实化）。
 *
 * 背景：某些浏览器侧模块必须能**单独 import**（判据要求"无 DOM 零抛错零副作用"），而
 * `COMPONENT_GATE.symbol`（唯一实现）住 `src/client.js` —— 两者只在**拼接**之后同作用域，
 * 单独 import 会 `ReferenceError`（实测真实回归）。这类模块改为**接收注入**，于是出现了
 * "同一 gate 的第二个调用名"。
 *
 * ⚠️ 别名必须**从规范 gate 注入而来**，判据强制：`GATE.file` 里必须存在
 * `<injectedBy>(<GATE.symbol>)` 的注入调用；否则别名就是"绕过 gate 的自由补丁"，判红。
 */
export const COMPONENT_GATE_ALIASES = [
  // 两个别名都是"可单独 import / 可独立求值"的模块里的**本地包装**：它们读
  // \`globalThis.__weComponentVisible\`（由 src/client.js 启动时注入），而不裸引用拼接作用域里的符号。
  { symbol: 'avatarComponentVisible', injectedBy: 'globalThis.__weComponentVisible', file: 'src/avatar-layer.js' },
  { symbol: 'weComponentVisibleOf', injectedBy: 'globalThis.__weComponentVisible', file: 'src/panel-tabs.js' },
];
