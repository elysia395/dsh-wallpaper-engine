# 组件行开关实测报告 —— 「关掉一行」到底改变了什么

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 一次实测取证（P2-11「关掉一个组件行到底改变了什么」）：
> **语义已落进 [`../../adr/0013`](../../adr/0013-bundle-multi-component-rows.md) 的 D3**（界面级开关），
> 门控实现在 `lib/components/visibility.js`、双向对账判据在 `test/verify-component-visibility.mjs`；
> 阶段与度量口径见 [`../wip/BUNDLE-SPLIT.md`](../../wip/BUNDLE-SPLIT.md) §7.0 / 附录 E。
> 下面正文原样保留 —— 当时的读数与「证明了什么 / 不覆盖什么」清单仍是后人复核的线索。

> **本文是一次实测取证，不是计划、也不是决策记录**：把「关掉一个组件行」的真实语义逐条量出来，
> 并指出**现有测试体系证明了什么、不覆盖什么**。语义该改成什么样 = [ADR-0013](../../adr/0013-bundle-multi-component-rows.md) 的职责；
> 阶段与度量 = [`BUNDLE-SPLIT.md`](../../wip/BUNDLE-SPLIT.md)（重构手册）的职责：**§7.0** 是这份取证的落地结果，
> **附录 E** 是度量定义与复算命令。
> **写作口径**（[`docs/README.md`](../../README.md) §写作纪律 4）：证据锚点用**符号名 / 文件路径 / 复算命令**；
> 确需给量级时**同时给复算命令**，不写成会被后续代码漂移的"权威数字"。

- **实测日期**：2026-10-14
- **被测版本**：`git rev-parse HEAD` = `e6d9bcf`（工作树干净）；`package.json` 的 `version` = 1.3.2
- **复现前提**：`cordis.patch.yml` 的四行（裸包名行 + `about-notice` + `mascot-avatar` + `media-bridge`）
- **整链基线**：`npm run verify:all` exit 0（本报告的一切结论都不以此推翻，见 §4）

---

## 1. 必读结论（三句）

1. **「关掉一行」现在的语义 = 只撤掉该行在宿主侧注册的 HTTP 路由。** 它**不**改变浏览器半边：
   三个组件行的客户端代码全在包级 `dsh.client` 里（构建期内联进 `lib/client.js`），
   **只要裸包名行还在，它们就照常加载、照常渲染**。
2. **改 `cordis.patch.yml` 后立即观察不会有任何变化** —— 该文件住在**包目录**，不在 `dsh-hmr` 的
   监听面（它只监听 profile 的 `package.json` / `cordis.patch.yml` 与 `$DSH_HOME/cordis.patch.yml`）
   ⇒ 行开关要**重启或重载**才被重读。用户观察到的"关闭后一切照旧、重启才发现区别"由此而来。
3. **重启后用户看到的是「静默坏」，不是「不可用」**：路由整族 404，而客户端仍画出按钮 / 预览 / 设置项，
   图片 `<img>` 没有 `onerror` ⇒ 用户看到的是**破图**。
   `lib/index.js` 的组件装载探针注释**自己就承认了这一条**（原文：客户端「看」是静默坏
   —— `src/client.js` 的 `<img src>`、`src/avatar-layer.js` 的 `<img>` 没有 onerror）
   —— 探针（`/diag-log` 的 `components`）是为补这个洞建的，但它**只对排障者可见**。

---

## 2. 逐条现象与机制

| # | 用户观察 | 实测机制 | 证据锚点 |
|---|---|---|---|
| 1 | 关闭「吉祥物与头像」后，吉祥物与头像**照常运行** | 该行控制的是 `/mascot` / `/avatar` 的**注册**；浏览器半边的渲染、上传入口、装饰层全在主包 | `docs/ROUTE-INDEX.md` 的 `/mascot` / `/avatar` 两行（唯一注册者是组件目录里的 `mascot.js` / `avatar.js`） |
| 2 | **重启后**才看得出区别 | 开关写的是 **profile** 的 `cordis.patch.yml`；`dsh-hmr` 只监听 profile 的 `package.json` + 两份 patch（**bundle 自带的 patch 不在监听面**），而 `dsh-plugin-manager` 的 `reload()` 在 HMR 缺席时直接返回 `[]`、结果记 `restart-required` | `dsh-hmr` 的 `watchConfig` 面；profile manifest 的 `dsh.profile.patchReload`（本机 = `"live"`）控制能否热生效 —— 机制事实已补进 `BUNDLE-SPLIT.md` §4.2 |
| 3 | 区别只是「吉祥物图标显示失败」 | `/mascot` 路由消失 ⇒ `<img>` 404；客户端没有 onerror、没有降级 | `src/client.js` 的 `/mascot` 图片 URL 调用点、`src/avatar-layer.js` 的 `avatarImageUrl()` |
| 4 | 「配置项」仍然可见 | 设置页三个页签（`src/panel-tabs.js`）、快捷面板（`src/quick-panel.js`）**没有一处**读组件装载态 | 全仓 `src/**` 对 `components` / `componentProbe` 的零命中（复算：`rg -n "components\|componentProbe" src/`） |
| 5 | （推论）关掉 `about-notice` 也只影响后端 | 关于页签仍在，star 数与两张二维码**静默失效**（同一个破图/空值形态） | `src/panel-tabs.js` 的「关于」页签段（`ABOUT_QR_*_PATH` 来自 `src/about-assets.js`） |
| 6 | （推论）关掉 `media-bridge` 后媒体设置项仍在 | 设置键 `audioSource` / `mediaIntegration` / `mediaLyricsOnline` 的 `kind` 是 **`const`（恒为常开）**，`adapterTarget` 有下拉控件 | `lib/settings-schema.js` 的 `KINDS` 与 `SETTINGS_NAMESPACES.media`；控件在 `src/panel-tabs.js` 的 `renderAppearance*` 段 |

### 2.1 根因（三层，缺一不可）

1. **开关的作用域 = 宿主路由**。组件的 `applyImpl()` 里只有 `webServer.register(...)` 一族动作，
   没有任何"告诉浏览器我关了"的通道（这是 A 语义的设计边界，不是缺陷）。
2. **浏览器半边是包级的**：`dsh-client-modules` 的 `exactPackageSpecifier()` → `nearestPackage()` →
   `table.set(包名, …)` ⇒ 一个包只产生**一个**客户端 graph row。子路径行（`<pkg>/<sub>`）
   完全不参与 `dsh.client` 扫描 ⇒ **组件行不可能有自己的客户端开关**。
3. **客户端没有可读的状态面**：`/inventory` 不返回组件态，`/diag-log` 的 `components` 是排障面
   （客户端零消费），也没有"能力探测"式的兜底 ⇒ 客户端**无法区分**"行关了"与"坏了"。

---

## 3. 组件行 → 可见面盘点（UI 面 + 设置面的权威落点）

> 这张表是"关掉一行到底该少什么"的唯一清单；**每个落点都用符号名锚定**，行号会漂、不写。

| 组件行 | 宿主路由（关掉即 404） | 客户端 UI 落点 | 设置面落点 | 现状 |
|---|---|---|---|---|
| `about-notice` | `/star-count` · `/about-qr/<file>` | `panel-tabs.js` 的「关于」页签内：star 行（`starCountLabel()`）、两张二维码（`ABOUT_QR_QQ_PATH` / `ABOUT_QR_DOUYIN_PATH`）、更新公告探针 | 无（这一族不写设置） | ❌ 关掉后静默失效 |
| `mascot-avatar` | `/mascot` · `/avatar/<side>` | `panel-tabs.js` 的 `renderMascotTab`（形态转盘 + 「自定义立绘」上传）、扩展页签的头像模块（`AVATAR_EXTENSION_MODULE`）、`avatar-layer.js` 的消息头像装饰层 | 立绘 / 头像**不是设置键**：文件名只是 `<img src>` 的查询串与缓存键 ⇒ 设置面无需 gate | ❌ 关掉后破图 |
| `media-bridge` | `/now-playing` · `/now-playing/artwork` · `/media-status` · `/audio-spectrum` · `/media-control` | 「适配器目标」下拉（`adapterTarget` 控件）；音频频谱与歌词的运行时消费（`src/client.js` 的媒体轮询段） | `SETTINGS_NAMESPACES.media` 的四个键：`adapterTarget`（有控件）、`audioSource` / `mediaIntegration` / `mediaLyricsOnline`（`kind: 'const'`，无控件） | ❌ 关掉后控件仍在、控件无意义 |

**明确不在清单里**（避免范围蔓延）：`media-bridge` 的四键之一 `adapterTarget` 需要单独裁决
（它是跨簇共用键，见 `lib/settings-schema.js` 的注释）；「缓存位置」一节虽然提到"媒体桥缓存"，
但它管的是**裸行的** cacheDir ⇒ 不属于任何组件行的可见面。

---

## 4. 测试体系现在证明了什么 / 不覆盖什么

**已证明（真牙，全部 exit 0）**：

| 判据 | 证明的事实 |
|---|---|
| `test/verify-bundle-rows.mjs` ⑧c「真 cordis 往返」 | 装载 → `fiber.dispose()` → 再装载：路由**撤干净**、不撞 `duplicate … route`，三个组件入口各过一遍 |
| 同 ⑧「负对照：只 `return dispose` 不交给 fiber」 | 卸载后路由残留 + 再装载撞 duplicate ⇒ 上一条不是空转 |
| 同「合成 N 行：并集 42 条且跨行无重复 `(kind, path)`」 | 每行的路由集合互不重叠 |
| `test/verify-route-ownership.mjs` | 已出户组件的实现**不得**留在 `lib/routes/`（M10 = 0） |
| `test/verify-inject-contracts.mjs` / `test/verify-component-face.mjs` | 21 个路由族的声明面 ↔ 消费面 ↔ 调用点三方对账；组件不从整个 `hostKernel` 解构（M8 = 100% / M9 = 0） |

**不覆盖（就是本次暴露的空档）**：

1. **"关掉一行之后，用户在界面上还能不能看见它"** —— 没有任何判据；
2. **"组件不可用时的降级/兜底"** —— 现在的失败形态（破图 + 空值）是**默认行为**，不是被选定的行为；
3. **`cordis.patch.yml` 的生效时机** —— 守卫测的是"行在/不在"两种静态形态，
   **不测**"改了行之后是否需要重启"（HMR 面的事实写在文档里，无机械判据）；
4. **宿主侧边界漏口**（见 §5）—— 声明面对账**看不见合法声明之外的耦合**。

---

## 5. 顺带实测出的宿主侧边界漏口

**预设族（`lib/routes/presets.js`）直接持有立绘 / 头像的落盘路径**：
它的 `DEPS` 里含 `mascotPath` / `mascotDir` / `avatarPath` / `avatarDir` / `AVATAR_SIDES`，
落盘与"换图即清同族"的实现都在这条腿上（函数名：`clearFamily`、`putAsset` 一族）。

后果：**关掉 `mascot-avatar` 行之后，预设族照样能读写立绘与头像的落盘目录** ——
宿主侧"这些资产归 mascot-avatar 组件"这条边界是**漏的**。它既不是 M10 违例（文件归属没错），
也不是 M8/M9 违例（这些键**是**合法声明的），所以现有三类判据都看不见它。

这条是"锚定模块边界"里一条真实的欠账，与开关语义正交，可单独立项。

---

## 6. 结论与下一步

- **现象全部成立，且根因不在实现 bug**：A 语义的开关作用域就是宿主路由；用户期望的
  "关掉 ⇒ 不显示 + 配置项不可见"是**另一档语义**（UI 级），当前**没有实现、也没有判据**。
- **升档已定案并已落地**：[ADR-0013](../../adr/0013-bundle-multi-component-rows.md) 的 **D3** 把行级开关的作用域
  从**路由级**扩到**界面级**（含可见性契约、失效口径、验收判据）；本报告是该条的**取证依据**，
  落地阶段与遗留观察写在 [`BUNDLE-SPLIT.md`](../../wip/BUNDLE-SPLIT.md) **§7.0**（起步态 = D3 已落地）。
- **无论升档怎么落地，"关掉后静默坏"都该修**：把"破图 + 空值"换成"明确的不可用形态"，
  是补一条被 `lib/index.js` 注释自己承认的既有缺陷，不依赖升档决策。
- **§5 的边界漏口独立立项**：它改善的是"锚定边界"，与开关升档无耦合。

### 收口状态

| # | 决策 | 状态 |
|---|---|---|
| 1 | 行级开关是否升为 **UI 级语义**（关掉 ⇒ 界面与设置项都不可见） | **已定案 = 升档**（[ADR-0013](../../adr/0013-bundle-multi-component-rows.md) D3①） |
| 2 | A 语义是否保留为底座（路由仍照旧撤掉、UI 跟着走） | **已定案 = 保留**（同 D4） |
| 3 | `adapterTarget` 这种**跨簇共用键**在行关掉后如何处理 | 待定（ADR-0013 触发线 7 点名，需单独裁决） |

### 复算命令（本条结论的机器复现入口）

```powershell
git rev-parse HEAD                                  # 被测版本
npm run verify:all                                  # 基线：应 exit 0
node test/verify-bundle-rows.mjs                    # ⑧c 真 cordis 往返 / 负对照
node test/verify-route-ownership.mjs                # M10 归属唯一性
node test/verify-inject-contracts.mjs               # M8 声明面对账
node test/verify-component-face.mjs                 # M9 隐式共享面
node test/tools/host-route-index.mjs                # 每行注册了哪些路由（现算）
```

> `node test/verify-media-bridge.mjs --provision`（`npm run verify:bridge:strict`）在本会话沙箱恒 exit 1
> （`spawn EPERM`，harness 禁 stdio 管道）—— 与本次结论无关，但它是唯一一条**没在本机拿到覆盖**的腿。
