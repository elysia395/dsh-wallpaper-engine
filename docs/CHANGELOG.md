# 变更记录（Changelog）

> **English**: [`en/CHANGELOG.md`](./en/CHANGELOG.md)（与本文同源：改一处请同步另一处）
>
> 本文件承接原先堆在 README 首页的**版本公告与功能清单**。门面（`../README.md` / `../README.en.md`）
> 只保留与版本无关的亮点；带版本号、issue 号、性能数字的内容一律记在这里。
>
> **当前发布版本：`v1.3.0`**（npm 与 GitHub Release 已发，2026-10-06）；下一版开发中（`package.json` 的 `version`）。
> **`### v1.3.0（2026-10-06）`** 一节收拢的是 **1.2.0 之后至 1.3.0** 的全部内容；`### v1.3.0-r2` 与 `### v1.3.1`（都标「未发布」）记的是 **v1.3.0 之后**的增量；**`### v1.2.0`** 一节收拢的是 **1.1.0 之后至 1.2.0**
> 的全部内容（侧栏工作台：外观 / 播放进侧栏与「壁纸属性」；玻璃染色地板与「左侧栏覆盖」；前置基线切换到官方桌面端 ≥ 0.2.0-rc.1）；
> **`### v1.1.0`** 一节收拢的是 **1.0.1 之后至 1.1.0** 的全部内容。
>
> **归档说明**：本仓库从 **v0.6.8** 起才有 git tag，更早的版本没有独立标签。早于 v0.6.8 的条目
> 按**原 README 原文的版本标注**归档；原文未标注小版本的条目放进区间桶，不臆造版本号。
> 完整逐提交历史见 GitHub Commits / Releases；升级前置条件见 [`UPGRADING.md`](./UPGRADING.md)。
> `test/verify-scene-live.mjs` 这一类判据条数**只记该条写作当时的实测总数**（如 466 / 465），不是现在的总数 —— 后续条目会往上加（现为 502）；照原文保留，好让它与当次提交对得上。

### v1.3.1（未发布）

> v1.3.0-r2 之后的增量；`NOTICE_VERSION` 哨兵同步 `1.3.1`（公告改版 ⇒ 看过 r2 公告的用户会再看到一次），；`package.json` 版本号已同步 `1.3.1`。

- **改造：预设从「玻璃子集快照」升为「整机配置快照」，并新增预设的导入 / 导出（ADR-0011）**。
  **动机**：内置预设此前只快照玻璃一族键，导入后仍有大量设置没跟着变 —— "预设不像预设"；用户口径是"保存的预设把这个插件的所有配置存入"，并要求预设能在用户之间流转。
  **做法**：预设正文改分四段 —— **settings 段**（全部观感与行为键，**总是携带**，缺键补默认 ⇒ 应用结果可判定）+ **三个资产段**（字体 / 吉祥物立绘 / 会话头像，**按需携带**）。键集**从 `KINDS` 派生**（`lib/settings-schema.js` 的 `PROFILE_PRESET_KEYS` / `PRESET_ASSET_KEYS` / `PRESET_EXCLUDED_KEYS`，互斥且穷尽；内容 / 运行期记忆类键进硬排除表），不再手抄第二份白名单 —— 新增设置键自动进 settings 段。正文 schema tag 换成 **`dsh-we/profile-preset@1`**。七套出厂预设全部按新 tag 与新范围重建（「黑客绿(Fish)」按作者本机现配置只读抄写）。**应用**改为整批：settings 段一次合并 + 资产经宿主 `install-assets` 落位（文件名 / 显示盒回填；字体值走字体集通道落盘，字体键不住 settings）+ 一条**整批重应用**编排 `reapplyAll()` —— 轮播开关 / 场景实时渲染 / 帧率档 / 播放倍速这族键不在 `emit()` 订阅链里，漏掉就是"写进了 selection、屏上不动"。**两段"缺席"语义相反**（别写反）：settings 段缺席补默认；资产段缺席 = 那一族键**保持现值不动**（不带 ≠ 清空）。**保存与导出都先弹资产勾选对话框**（字体默认勾 / 吉祥物默认勾 / 头像默认不勾 —— 图片体积翻倍），逐项写明不勾的后果（不勾字体 → 回落接收方当前那份；不勾吉祥物 → 回落内置 maid/whale；不勾头像 → 回落内置默认头像）；勾选只决定图片与字体要不要一并带走，数值配置总是完整保存。图片**只进不出**浏览器：保存只传勾选名单、由宿主从本机数据目录内嵌，应用只调 `install-assets` 拿文件名 —— 不新增第二条落盘通道。
  **破坏性**：**旧预设直接作废、不做兼容**（用户口径：旧正文只含玻璃子集，按新语义解释会得到"一半是预设、一半是当前值"的混合体）。旧 tag 的预设读出时按"读不懂"处理 —— 面板点名**版本作废**并给出"重新保存一份"的出路；**升级后已存的预设需要重新保存一次**。出厂七套已随本改造重建，不受影响。墓碑标记值原样不动（删过的出厂预设不会复活）。
  **新增**：**导出**（每行「导出」→ 同一组资产勾选 → 下载 `.json`，宿主带附件头；不引入 blob / `showSaveFilePicker`）与**导入**（三道本地预检各给可判定文案：读不出 / 不是 JSON / `$schema` 不对且点明要哪个 tag；成功只进清单、**不自动应用**）。
  **路由**：`/glass-presets` 族新增 `create` 的 `embed` 名单、`<id>/install-assets`、`<id>/export?assets=…`、`import` 端点（索引见 [`ROUTE-INDEX.md`](./ROUTE-INDEX.md)，随包索引生成物）。
  **验证**：`node test/verify-route-index.mjs` / `verify-i18n` / `verify-client` / `verify-package-files` / `verify-package-publish` exit 0；`node scripts/build-client.mjs` + `node test/verify-client-sync.mjs` 全绿（产物与源码一致）。

- **变更：出厂预设「出厂默认」换成新预设并改名「黑客绿(Fish)」（PR [#171](https://github.com/elysia395/dsh-wallpaper-engine/pull/171) 的预设值，改为**替换**而非新增）**。
  **做法**：直接改写 `lib/glass-presets/factory-default.json` 的值与名字，而不是照 PR #171 新增第 8 套（`factory-fish`）——保持**出厂仍七套**，好让装机后 8 个预设位里还留一个给用户。取值与 PR #171 一致：整体同「作者自用」（`factory-author`），`sidebarContentColor` 由 `#0d1524`（深色内容底）改为 `#ffffff`；PR 里那 7 处与 `factory-author` 的差异都是新版本 schema 新增的键且取值恰为默认值，本文件按出厂预设的稀疏写法省略，读入时由 `sanitizeGlassPresetValues` 补齐。
  **连带**：`src/glass-panel.js` 的 `FACTORY_PRESET_CN` 把 `factory-default` 的词表名改为 `"黑客绿(Fish)"`（出厂名必须走词表字面量，i18n 判据是文本扫描、数据里的 name 扫描看不见）；`src/i18n-copy.js` 同步改键（旧键「出厂默认 / Factory default」移除，避免孤儿键）。`test/verify-presets.mjs` 的对应判据跟上。
  **影响面**：出厂预设数量不变（7 套）、数量上限不变（8）、不新增设置键。**只改客户端 ⇒ 刷新页面即生效**。预先存过「出厂默认」的用户预设重名规则不变（同名禁止针对活跃清单，出厂名变化不影响已存用户预设）。

- **修复：网页壁纸周期性抢走输入焦点（issue [#148](https://github.com/elysia395/dsh-wallpaper-engine/issues/148)）—— 元素级焦点围栏 + 宿主侧焦点交还（C11 + C12 合并）**。
  **根因**：网页 / 场景壁纸里的脚本会反复 `focus()`，把输入光标从对话输入框搬走。插件原有的围栏只做**帧级**判定（壁纸帧整体拿不到键盘焦点），拦不住两类抢焦：壁纸文档里元素级的 `el.focus()`，以及**跨源 WindowProxy** 的 `top.focus()` / `parent.focus()` 与宿主文档内部的 `autofocus` / `dialog.showModal()` / `label` 转发 —— 壁纸文档里的守卫根本够不到这些路径。
  **修法**：① `lib/we-focus-guard.js` 保留帧级判定不变，新增**元素级围栏**：`HTMLElement.prototype.focus` 只在"最近一次真实交互"后的 `gestureWindowMs`（**1000 ms**）窗口内放行，窗口外吞掉并计数（`window.__weFocusGuard` 的 `elCalls` / `elAllowed` / `elBlocked` / `elLastBlockedAt` / `elLastBlockedStack`，便于作者页复现时取证）。**手势窗口不能省**：壁纸层是 `pointer-events: none`，用户真点壁纸时由 shim 合成 `isTrusted === false` 的 pointer / mouse 事件 —— 壁纸自带编辑框靠这次点击拿焦点是正当行为，一刀切会把它毁掉（总计划 §3.5 明列"不要做"）。② 新增 `src/focus-handback.js`，跑在**宿主文档**里把被搬走的焦点交还：`focusout` 来自被记住的元素、`document.activeElement` 是 `iframe.we-iframe`、且最近 1000 ms 无真实手势 ⇒ 交还；另有 `STALE_MS` / `MIN_GAP_MS` 两道保险，`window.__weFocusHandback.{handbacks,skipped}` 可观测。③ `scripts/build-client.mjs` 登记新模块、`src/client.js` 的 2e 段挂 `ctx.effect`。宿主半不能省：壁纸文档里的守卫改不了跨源 WindowProxy，也拦不住 `autofocus` / `dialog.showModal()` / `label` 转发。
  **判据**：`test/verify-scene-live.mjs` 第 ⑦–⑨ 组（帧级仍无条件吞掉 + 元素级窗口内放行 / 窗口外吞掉 + 宿主侧交还）与 `test/verify-client.mjs` 的宿主半行为判据（真 `src/focus-handback.js` + `with(__scope)` 挂载台），各配负 / 阳性对照。
  **验证**：`npm run verify` / `verify:docs` / `npm run build` / `smoke` exit 0；`lib/client.js` 随本轮重建。**宿主与客户端都改了 ⇒ 需重启 `dsh web`**（真机作者页复现仍待作者侧确认）。
  **判据坑（记给下一次）**：`src/focus-handback.js` 首版只判 `typeof document === "undefined"`，而 `test/verify-transcode-state.mjs` 喂的是能力不全的 stub document ⇒ `TypeError: document.addEventListener is not a function` 打断整条 `apply`；改成逐方法能力检查。`verify-client` 宿主半首版**假绿**（交还频率下限 300 ms，而判据块跑完远不到 300 ms，断言其实是被 `MIN_GAP_MS` 拦下的）⇒ 前置真睡 320 ms + 补"睡够必须恢复交还"的负对照。

- **性能：壁纸库扫描落盘索引 + 签名快路径 —— 重启后库没变就零 I/O（issue [#158](https://github.com/elysia395/dsh-wallpaper-engine/issues/158) (b)）**。
  **根因**：冷启动 / 重启后每次请求都要把整个壁纸库重新 `stat` 一遍（本机合成 2600 条载荷 ≈ 1.57 MB，扫描是唯一真实的 TTFB 大头），而库在绝大多数重启之间根本没变；扫描结果只住在进程内存里，重启即失。
  **修法（宿主）**：`cacheBaseDir()` 下落盘 `inventory-index.json`（`INDEX_VERSION` + `sig` + `builtAt` + **扫描原料** `we` + 逐条目探测记忆 `probes`）；签名 = `sha1(版本 + installDir + 排序后的 libraryDirs + 各扫描根 mtimeMs:size)`。四条纪律是本条的全部难点：① 索引存**扫描原料、不存载荷** —— `media` / `preview` / `frameUrl` 是 `tokenFor()` 的绝对路径 base64url、`mediaMap` 是进程内的，回放旧载荷会让重启后每个 URL 404，回放必须走 `assembleInventory` 重组；② 签名命中 ⇒ 零 fs（含零 `stat`）；③ 签名对不上**不等**（库本身变了，回旧载荷会把上一个库的清单端给用户），并发请求共用同一次在途扫描 `rescanOnce`；stale-while-revalidate 只服务"签名没变、内容可能变了"这一种情况（索引老过 `INVENTORY_REVALIDATE_MS`）；④ 逐条目失效键 = 项目目录 mtime（`enumerateWallpapersAsync` 新增 `dirAbs`），另加索引 GC。索引损坏 / 版本不符 / 元素形状不对 ⇒ 当"没有索引"，退回冷启动并自愈，绝不抛。
  **判据**：新守卫 `test/verify-inventory-index.mjs`（**23 条**）六组 —— 冷启动（4 次存在性探测 + 落盘 + 只存扫描原料）/ 重启库没动（**探测 0 次、stat 0 次**）/ 库新增一条（只探新增，`exists=2`、`stat=3`）/ 只有一个项目目录变了（负对照）/ 索引容错（坏 JSON、老版本、`we:[null]`、条目列表混入 `null`）/ GC。
  **验证**：`npm run verify`（含新守卫）/ `verify:docs` → `npm run verify:all` exit 0。**宿主半改了 ⇒ 需重启 `dsh web`**。
  **顺带修掉的第三个洞**：`rescan()` 里对原始列表解引用 `w.fileAbs`，条目为 `null` 时抛 `TypeError: Cannot read properties of null (reading 'fileAbs')`（`lib/inventory.js:428`）—— 这个洞正是被新守卫第一次跑出来的；修法是工厂级 `liveEntries(list)` 形状过滤，`assembleInventory` 与 `rescan` 两个入口都过它。（响应压缩 C8 与启动路径 C10 本轮**刻意不做**：本机 2600 条载荷 identity 6.8 ms / gzip-6 11.1 ms（101,682 B）/ brotli-4 9.1 ms（78,799 B）⇒ 回环上压缩净亏、且压缩发生在扫描之后不影响 TTFB；C10 的产物成本实测 ≈ 12 ms（读 0.4 + gunzip 4.7 + 解析 6.9），拆"关键 CSS 同步 + 余量首帧后注入"有可见闪动风险，需真机 A/B。）

- **新能力：玻璃色分主题 —— 一个颜色管两套、深色可单独设（issue [#159](https://github.com/elysia395/dsh-wallpaper-engine/issues/159) ②）**。
  **动机**：`glassColor` 此前是一个标量 hex，浅色与深色主题只能共用同一种玻璃染色，深色下常见偏亮或偏脏；形态上也与既有的 `themeColors` + `themeDarkSeparate` 不一致，用户没法表达"深色单独设"。
  **修法**：`glassColor` 从标量升级成 `{ light, dark }` 一对（`lib/settings-schema.js` 的 `KINDS.glassColor.kind = 'glassColors'`、`DEFAULTS.glassColor = GLASS_COLOR_DEFAULTS`），新增 `glassDarkSeparate` 布尔开关（默认关、两侧同值 ⇒ 出厂仍是"一个颜色管两套"）；`SETTINGS_VERSION` **5 → 6**，`migrateSettings` 末尾把标量迁成两侧同值，`readGlassColors(raw)` 永远返回完整一对（对象坏侧由好侧补齐、字符串两侧同值）—— 读容忍与迁移是两层：预设 JSON 带的是标量且盖当前版本号、不过迁移段，删读容忍会让出厂预设变白釉。`src/effects.js` 新增模块级 `glassColorOf(selection, theme)`，四条 `--we-surface-tint-{light,dark}` / `-rgb-{light,dark}` 各取自己那一半，`--we-glass-color` 仍是**浅色**标量；`src/glass.js` 的对话栏按主题各取一半。设置页与侧栏「外观」页只有开关开着才画第二行「玻璃颜色 · 深色」（`src/glass-panel.js` 的 `panelGlassPair(sel)` / `panelThemeIsDark()` + `switchRow("深色单独设置")`）。**侧栏有意不分主题**：`--we-sidebar-color` 是 body 行内样式、压不过样式表里的重声明，且消费者没有 `data-ds-dark-theme` 孪生 ⇒ 侧栏档只有一个色板、写当前主题那一侧（所见即所改），判据里显式钉成"分主题的例外"。
  **判据**：`test/verify-presets.mjs` 金夹具补齐 18 例（`glassColor` 一对 + `glassDarkSeparate` + `settingsVersion: 6`）、`test/verify-scene-live.mjs` 面板归一与侧栏档行为、`test/verify-client.mjs` 行为台（浅 / 深两侧取值 + 开关默认关时两侧同值）。
  **验证**：`npm run verify` / `verify:docs` / `npm run build` / `smoke` → `npm run verify:all` exit 0；`lib/client.js` 随本轮重建。**宿主设置表与客户端都改了 ⇒ 需重启 `dsh web`**（`config.json` 首次启动自动迁到 v6）。
  **判据坑（记给下一次）**：写"两侧取值不相等"型分主题判据是**假绿** —— 两侧各经一次亮度钳制，输出本来就不会相等 ⇒ 必须做**因果**判据（两侧同色的两份基准比）；`--we-surface-tint-light === PAIR.light` 会**假红**（沙箱里真 `weClampSurfaceColor` 遮蔽恒等 stub）；迁移守卫第一版假绿（读容忍盖住了读出口）；`panelThemeIsDark()` 对 stub document（有 body、无 `hasAttribute`）要逐能力检查。

- **修复：滚动条观感与插件取色脱节（issue [#157](https://github.com/elysia395/dsh-wallpaper-engine/issues/157)）—— 四个宿主滚动条令牌并入插件玻璃色**。
  **根因**：宿主滚动条族走 `--dsw-alias-scrollbar-{bg,hover}-l{1,2}` 四个底层令牌，而宿主自身约 17 处局部重声明写的都是**间接层** `var(--dsw-alias-scrollbar-bg-l2)`；这四个令牌在插件玻璃页里仍是宿主原生中性色 ⇒ 滚动条在染色玻璃上显得脏、与页面不在一个色系。
  **修法**：不逐锚点补样式，而是**在 `body` 上换掉这四个底层令牌**（自定义属性按元素解析 ⇒ 一处覆盖全应用、零锚点耦合）：两个页面玻璃令牌块（浅 / 深）各追加 4 条重声明，值 `color-mix(in srgb, var(--we-surface-tint-light|dark) 40%, var(--dsw-static-neutral-XXX) 60%)`。**与审计方案的偏离**：方案里的"逐锚点补 `--dsh-scrollbar-thumb`"没做（宿主 ~17 处局部重声明都指向间接层，逐锚点补不可能覆盖完）；`--dsh-scrollbar-width` / `-thumb-border` / `-track-margin` 也一个没动。
  **判据**：`test/verify-glass-surfaces.mjs` 第 ⑮ 组（8 条声明都要"存在 + `color-mix(` + 掺该主题玻璃底色"，配三形态负对照）。
  **验证**：`npm run verify` → `npm run verify:all` exit 0（实测把权重 `40%` 改成 `0%` 当场红）；`lib/client.js` 随本轮重建。**纯客户端样式 ⇒ 刷新页面即可**。

- **修复：宿主切换浅 / 深主题后，壁纸淡出底色不重算（issue [#159](https://github.com/elysia395/dsh-wallpaper-engine/issues/159) ①）**。
  **根因**：淡出底色（`lastFadeBg`）只在直播（live）时读一次，宿主翻转 `data-ds-dark-theme` 后没有任何东西通知它失效 ⇒ 深色下仍用浅色主题算出来的底色。
  **修法**：`src/effects.js` 新增 `armFadeBgThemeWatch()` / `disarmFadeBgThemeWatch()`（MutationObserver **只认 `data-ds-dark-theme`**、幂等、无 `MutationObserver` 时静默退化），在 `wallpaperOpacity > 0` 的分支挂上、归零分支与 `clearEffects` 断开。
  **判据**：`test/verify-client.mjs` 行为台（冷启动底色 `#ffffff` → 只翻属性不派发事件仍 `#ffffff`（负对照）→ 派发后才翻到 `#000000` → `clearEffects` 后观察者已断开）。
  **验证**：`npm run verify` → `npm run verify:all` exit 0；`lib/client.js` 随本轮重建。**纯客户端 ⇒ 刷新页面即可**。
  **判据坑（记给下一次）**：样式文本是塞进产物里的**模板字符串** ⇒ 在 `src/styles.js` 注释里写 markdown 反引号会让 `build-client` 报「产物语法错误：Unexpected identifier 'background'」（本轮真踩；同理 `src/effects.js` 的注入脚本也是模板字符串）。

- **修复：四处玻璃面失去底板（issue [#156](https://github.com/elysia395/dsh-wallpaper-engine/issues/156) ①②③④）**。
  **根因**：插件把页面换成壁纸后，宿主原本"靠页面底色垫着"的几处浮层 / 底板一起失去了视觉底板 —— ① 宿主 Modal 的遮罩本来自己画 `backdrop-filter: var(--dsw-mask-blur)`，而宿主主题在**裸 body** 上把这个令牌写成 `none`，插件玻璃页没有把它改回来；② 插件管理器的注册表浮层（`[data-install-registry]`）在宿主源码里**没有** `backdrop-filter`，其底色令牌 `--dsw-alias-bg-layer-2` 在插件门内是半透明的 ⇒ 一块没有霜的玻璃；④ 代码块吸顶条被插件的"清底"规则连底板一起抹掉（真正的 sticky 载体是外层 `.bannerWrap`，它的底板读 `--dsw-alias-bg-base`，被插件置成 `transparent`）；③ 输入座位那条"底衬"则是插件自己**多铺**的。
  **修法**：① 玻璃门块内重声明 `--dsw-mask-blur: blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8)) brightness(var(--we-glass-brightness, 1.04)) contrast(1.01)`（`src/styles.js:572`），宿主遮罩自己就会把霜画回来；② 新增 `body[data-we-glass-floaters] [data-install-registry] { -webkit-backdrop-filter / backdrop-filter: blur(var(--we-floaters-blur)) … }` 并配无模糊内核的 fallback 孪生（`--we-floaters-blur` **不带内层兜底** —— 否则撞 `verify-glass-surfaces` 的零兜底消费族判据）；④ 在既有清底规则**之后**、同特异度同 `!important` 地对 `:has(> [data-code-block-banner])` 重铺 `background-color`（宿主 `MarkdownText.module.css:399` 认可这个 `:has`），并配深色与无模糊内核两条孪生；③ **先加后撤**：输入座位底衬先收窄成贴底一条、再由用户口径整条撤回 —— 最终态是 `[data-composer-seat]` 上**什么都不铺**（那块底板本来只是宿主顺手画的页面底色 `--dsw-alias-bg-base`，插件把页面换成壁纸后没有东西需要它垫；dock 直接压壁纸正是宿主原生观感），令牌 `--we-composer-seat-fill` 删除并进 `verify-glass-surfaces` 的 `REAPED_VARS`，第 ⑯ 组从几何棘轮改成**反向棘轮**「输入座位不铺底板」（命中 `background` / `background-image` / `background-color` / `backdrop-filter` 即判出，配三种旧形态负对照）；`docs/DSH-UI-INTERFACES.md` 的 `data-composer-seat` 台账行改注"已撤回使用"。
  **判据**：`test/verify-glass-surfaces.mjs` 新增 / 加固 ①（玻璃门内 `--dsw-mask-blur` 必须是真的 blur）、⑯（反向棘轮）、⑰（新登记面的**有效声明**：同一条规则内 anchor + 门 + 真 `backdrop-filter` / 真 `!important` 釉色，两条负 / 正对照）、⑱（`--dsw-mask-blur` 覆盖是否有效）。
  **验证**：`npm run verify` → `npm run verify:all` exit 0；变异验证逐条做过（产物里摘掉 #156② 的霜、#156④ 浅 / 深两条重绘各摘一条、源码里 `--dsw-mask-blur` 改 `none`、滚动条权重改 `0%` —— 五种变异分别让对应判据变红）；`lib/client.js` 随本轮重建。**纯客户端样式 ⇒ 刷新页面即可**。
  **判据坑（记给下一次）**：① 第 ①/⑰ 组读的是**产物**里求值出来的 `CSS`（`test/verify-glass-surfaces.mjs:266` 起），只改 `src/styles.js` 不会红 —— 变异验证必须改产物或先 `npm run build`（本轮踩过假绿）；② `(?!none)` 这种写法是**假牙**：真文件写的是 `backdrop-filter: none !important`，`\s*` 可以回溯成空串、lookahead 落在空格上 ⇒ `none` 被当成"非 none 的霜"，负对照夹具必须写上带空格的形态；已修成 `(?![\s!]*none\b)`。

- **修复：宿主 Tooltip 被气泡玻璃误伤（issue [#161](https://github.com/elysia395/dsh-wallpaper-engine/issues/161)）**。
  **根因**：宿主的气泡类名是内容哈希（`_bubble_<hash>`），插件的玻璃规则按 `[class*="_bubble"]` 认消息气泡；而宿主的 Tooltip 元素同时带 `role="tooltip"` 与 `_bubble_<hash>` 两个标记（`dsh-client-ui-primitives/lib/index.js:4841`）⇒ 被当成气泡接管底色、恒挂霜釉。
  **修法**：四条 `[class*="_bubble"]` 规则（fill 接管 / 恒挂霜釉 / 气泡内代码块 / 无模糊内核 fallback 摘霜）统一加 `:not([role="tooltip"])`。
  **判据**：`test/verify-readability.mjs` 的 F2dN 组收紧成"下界 4 条、且每条必须带 `:not([role="tooltip"])` 排除式（`[data-chat-flow]` 作用域不能代替）"，并配负对照。
  **验证**：`npm run verify` / `verify:docs` / `npm run build` → `npm run verify:all` exit 0；`lib/client.js` 随本轮重建。**纯客户端样式 ⇒ 刷新页面即可**。

- **字体与玻璃细调节出设置页、迁进侧栏「外观」页，两块默认收起（ADR-0008 D4 二次修订）**。
  **动机**：设置页是**模态对话框**，调字体 / 玻璃细调时它挡住主页面、调完看不到实时效果；而这两块的调节项又太多，默认全开会把侧栏外观页挤得杂乱。⇒ 真迁移：**全局字体整节**与**玻璃高级行**（每个面的「独立配置」层及子项、思考块门下的胶囊雾化 / 胶囊颜色）一起搬进侧栏「外观」页，**默认收起**；设置页外观只留 主题 / 细节 / 玻璃 UI（简化配置 + 预设方案）/ 输入光标。
  **形态**：字体节的节头变成可点的折叠头（`role=button` + `aria-expanded` + 旋转箭头，`we-picker__section-head--toggle`），收起时只画节头；玻璃高级行收进「玻璃 UI」**节尾**的「详细玻璃调节」开关行后面（`advRows` 一次构建，设置页连构建都不做）。每行的**内在门**（思考玻璃挡 / 各面总开关 / 宿主能力位 / 跟随全局）原样保留 —— 折叠只是整体挪位，不改任何一行的生效条件。**预设方案反向不动**：仍只在设置页画（整快照覆盖、无撤销的动作不进随手可点的窄面板）——它现在是唯一"设置页专属"的行。
  **展开态**：两个独立 localStorage 键（`dsh-wallpaper-engine:qp-font-open` / `:qp-glass-detail`，`'1'/'0'`，**默认收起**），与 `qp-tab` / `qp-view` 同一条"仅 UI 状态、不进 `config.json`"的口径；渲染器只经 ctx 读 `fontOpen` / `glassDetailOpen`、调 `onToggleFontSection` / `onToggleGlassDetail`，纯读契约不变。侧栏窄栏兜底：字体表加 `overflow-x: auto`。
  **随迁的两处**：① `QP_CTX_SETTINGS_ONLY` 占位器名单缩编 —— 字体 16 项 + 玻璃高级 10 项移出（改传真值接线），只剩 `glassPresets` + 播放页 6 项；② 本机字体清单的触发效果从设置页 `activeTab` 移到 `QuickPanel`（`qpTab === "appearance" && fontOpen && sel.fontCustom`）—— 设置页外观已没有字体 UI，在那边拉是白付宿主扫描（macOS 实测 ~10s）。底栏深链文案「字体与更多外观 ›」→「更多外观设置 ›」。
  **判据**：`verify-scene-live` 字体节门**反转**（`gatedSidebar` + 负对照）+ `MORE_CASES` 四档（设置四节且恒无独立配置 / 侧栏默认收起 / 侧栏展开玻璃 / 侧栏展开字体）+ 占位器牙改钉 `onFpsCap`/`glassPresets` 并**反向**钉"字体与玻璃高级字段必须已不在名单里" + FREE 名单补 17 个字体标识符与 `ensureSystemFonts`；`verify-fontset` surface 判据**翻转**（设置档无「全局字体」、侧栏档有）+ ⑧ 渲染台改 `surface:'sidebar'`+`fontOpen:true`；`verify-client` 行为段拆两棵渲染树（设置台 = 简化 + 迁移负断言；侧栏台 `renderSidePane` = 高级往返 + 字体开关 —— harness 补 `ctx.get` 桩让 `installSidebarRight` 真注册侧栏 body）；`verify-system-fonts` 触发点源码判据与下拉行为台随迁；`verify-presets` 加侧栏专属处理器豁免（`onToggleGlassDetail`）；`fontset-load-smoke` 的 mount 同样补 `ctx.get` 桩与 qp-* 播种；`guard-map` 重算（`verify-system-fonts` 多盯一个 `src/quick-panel.js`）。
  **验证**：`npm run verify` / `verify:docs` / `smoke` / `npm run build` 全部 exit 0；`lib/client.js` 重建随本轮提交。**纯客户端 UI 布局变更 ⇒ 刷新页面即可**（无新设置键，`config.json` 不动）。

- **「播放」→「效果」新增壁纸层取景三件套：水平 / 垂直 / 缩放**（社区 PR [#155](https://github.com/elysia395/dsh-wallpaper-engine/pull/155) · wwexplorer）；顺带让这三行的**右侧数值可直接键入**、**双击标签回默认**。
  **动机**：WE 壁纸属性面板里「对齐方式 = 自由」那一组的 水平 / 垂直 / 缩放（`alignmentx` / `alignmenty` / `alignmentz`）是 WE 引擎内置属性，存在 WE 自己的 `config.json`（`<user>.wproperties.<壁纸路径>.MonitorN.*`）里、**不在 `project.json`**；本插件的「壁纸属性」面板只读作者在编辑器里定义的 `general.properties`，场景适配又只有 cover / contain / center / fill（`SCENE_LIVE_FIT`）⇒ 想把 WE 的取景搬进来只能在插件里重设一遍。三条刻度**与 WE 同名滑条同量程**（便于对拷数值）：位置 0..100（50 = 居中，0 / 100 = 两端），缩放 50..150（100 = 原大小，95 = 缩到 95%、四周露出页面底色）。
  **修法**：新增设置键 `layerPositionX` / `layerPositionY` / `layerScale`（唯一真源仍是 `lib/settings-schema.js`，两端的 sanitize / serialize 都遍历该表 —— 漏一端 ⇒ selection 里恒 `undefined`，滑块无值、拖动写不进）。取值落在 `.we-layer` 的**独立属性** `translate` / `scale` 上（**不是 `transform`**：层切换过渡与 `--we-layer--repaint` 都会碰 `transform`，共用会被互相清掉），由 `src/effects.js` 的 `applyEffects` 写变量、`clearEffects` 成对 `removeProperty`；**等于默认值时不写变量**（否则逼出一个常驻合成层）。三条行排在「饱和度」之后、「壁纸透明度」之前，侧栏「播放」档同源画同一批（`qpRenderPlaybackPane` 传**真处理器** —— ⚠️ 不能只登记进 `QP_CTX_SETTINGS_ONLY`：那份名单的对象是 `Object.assign` 的第一个实参，会把**设置页**那棵树一起盖成「取用即抛错」的替身）。数值区新增 `opts.numberEdit`：右侧由回显文本换成 `NumberValueInput`，**编辑期不受控**（draft 本地态 + 回车 / 失焦提交并夹取，删空 = 放弃编辑）—— 受控写法在"删空重打"时会自锁；`opts.onLabelDoubleClick` 让双击标签回默认（位置回 50、缩放回 100%）。
  **判据**：`test/verify-client.mjs` 新增两条（`NumberValueInput` 的非受控形态 + 负对照：禁止每键写受控 `onInput(Number(raw), true)`）；`test/verify-scene-live.mjs` 的侧栏自由变量表补 4 个处理器名、5 处滑条标签序列夹具在「饱和度」之后插入「水平 / 垂直 / 缩放」；`test/fixtures/settings-sanitize-golden.json` 金夹具加三个键。
  **验证**：`npm run verify`（38 条）/ `verify:docs` / `npm run build` / `smoke` exit 0；`lib/client.js` 重建随本轮提交。**客户端与宿主设置表都动了 ⇒ 需重启 `dsh web`**（两端都要认这三个键）。

- **修复：打开「会话头像」后，收起的思考行连入口一起消失（issue #154：「思考直接不可见 / 人工关闭后找不到重新打开位置」）**。
  **根因**：头像装饰层把三类消息行（`data-chat-flow-kind` = user / steering / assistant-step）改成横向 flex 容器，并给"非头像的内容"写 `flex: 1 1 auto; min-width: 0` 让它撑满剩余宽度；但宿主把节点渲染包在一层**槽出口锚点**里（`div[data-slot="conversation.chat.node"]`，宿主 renderer 给它写死内联 `style="display: contents"`，注释明说这是为了让 flex/grid 父级"看见槽自己的孩子"）——这层**没有盒子**，既不是 flex item、也不接受 flex 属性 ⇒ 那条规则**打在空气上**；真正成为 flex item 的是锚点的孩子（助手消息的内容根 `div.v5IAXa_root`），它退回默认 `flex: 0 1 auto`，主轴尺寸按自身 **max-content** 算，不再"填满行"。而宿主又给**收起**状态的思考行写死 `contain: size layout`（`._3GBCTG_root:not([data-expanded])`，`data-expanded` 只在展开时写入）——尺寸包容把固有尺寸抹成 0 ⇒ 一行可见内容只剩"思考"折叠行时 max-content = 0 ⇒ 该 flex item 宽 **0px**，整条消息连"思考"入口一起不可见；展开时那条 `contain:size` 不匹配 ⇒ 固有宽度回来 ⇒ 可见；再收起又归零 ⇒「人工关闭后找不到重新打开位置」。纯推理行（`data-chat-group-part="reasoning"`，flow-kind 同样是 `assistant-step` ⇒ 也被装饰）永远停在这个形状，是最稳的复现。
  **修法（只动样式；装饰层与宿主契约都不动）**：内容格那条规则改成**两条选择器、一条声明块** —— 直挂内容 + 穿透槽出口锚点那一层：`body[data-we-avatar="on"] [data-we-avatar-row] > :not(.we-avatar), body[data-we-avatar="on"] [data-we-avatar-row] > [data-slot] > :not(.we-avatar) { flex: 1 1 auto; min-width: 0; }`（`flex-grow: 1` 是要害：固有宽为 0 的内容也靠 grow 才撑满行）。**不把锚点自己改成 `display: block`** —— 宿主契约靠 `display:contents` 让父级看见槽的孩子，改它会带歪宿主自己的列间距与空条目判据。
  **判据**：`test/verify-scene-live.mjs` 的头像段两处收紧 ——（a）CSS 钉法改成**剥注释后**的两选择器正则（退回旧单选择器形态当场红）＋负对照「不许给 `[data-slot]` 写 `display:`」，并用 `git show HEAD:src/styles.js` 的旧文本与两处伪改验证过区分力（非空判）；（b）假 DOM 的消息行照**宿主真实形态**造：内容裹在 `div[data-slot="conversation.chat.node"]`（`style="display: contents"`）里，断言头像补在**锚点前面**（行 = [头像, 锚点]）、锚点里只有内容根（装饰层不往里插东西）、关掉后行逐字节回原生（只剩锚点、内容根对象未被重建）。此前这套假 DOM 把内容直接挂在行下，正好把这条 bug 藏住了（本仓别处的假元素早已照宿主真实形态造，头像段落漏了）。
  **验证**：`npm run verify` / `verify:docs` / `npm run build` exit 0；`lib/client.js` 已重建（新选择器落在其 4394–4395 行）。本次只改客户端渲染产物 ⇒ 刷新页面即可，不需要重启 `dsh web`。
  **判据坑（记给下一次）**：整套样式文本是被塞进产物里的**模板字符串** ⇒ `src/styles.js` 的注释里出现一个反引号就会让 `build-client` 报「产物语法错误：Unexpected identifier …」（本轮真踩：注释里给 `div[data-slot=…]` 加了反引号）。

- **视频起播不再等整份文件读完：`faststart` 从"落一份整片副本"改成"服务期虚拟布局"（磁盘占用 1570 MB → 0，且这条路上不再需要 ffmpeg）**。
  **根因**：Chromium 的媒体加载器对自己发起的请求就是 `Range: bytes=0-` **顺流整读**，而这些壁纸源把 `moov`（时长 / 索引表）放在**文件尾部** ⇒ 拿不到 moov 就不给时长、不起播，首帧时间因此正比于**文件大小**。本机实测（`E:\SteamLibrary\...\431960`，≈430 MB/s）：iris2 `764,688,296 B` 等 **1761 ms**、lv_0 `501,752,315 B` 等 **1250 ms**、kei `155,604,213 B` 等 357 ms、梓（ahq）`101,749,329 B` 等 324 ms；同一份 iris2 在 moov 已前置时只要 **149–233 ms**。旧实现拿 ffmpeg `-c copy -movflags +faststart` **整片复制**一份 `faststart/fs_<hash>.mp4` —— 本机实测 `faststart` 目录 **1570.28 MB / 5 个文件**（每个都是对应源的完整副本），而它的清理是 8 GB 上限 LRU ⇒ 这些副本**永远不会被淘汰**。
  **修法（宿主，纯读 + 服务期合成）**：新增 `lib/mp4-vfs.js`——只读源文件算出等价布局：① 顶层盒表（按需 seek 读盒头）；② `moov` 整体读入内存；③ 把 `moov` 搬家到 `mdat` 之前，并把 `stco`/`co64` 里**每一条** chunk 偏移整体 `+len(moov)`；④ 得到一张**段表**（`[mdat 之前的盒原样][补丁后的 moov][mdat 及之后]`）。`lib/serve.js` 新增 `serveLayout` / `layoutRangeStream`，按段表切 Range（单段内存段 / 单段文件段 / 跨段三个分支），**Range / 206 / 416 / HEAD / suffix 语义与 `serveFile` 逐字一致**。关键性质：**虚拟文件与源文件总长完全相同** ⇒ `Content-Length` 与 Range 端点一字不变，客户端与 `probeMp4` 都不需要知道这件事；`moov`（16–188 KB/个）只进内存，**磁盘 0 字节**。`/media` 的选片仍必须经 `pinnedFaststartVariant`（两次请求的字节偏移不同，同一次播放绝不能前半段读原片、后半段读虚拟布局 ⇒ 花屏），它现在钉的是"这一份播放用虚拟布局还是原片"。
  **判不了就安静回退原片**（这是优化不是功能）：非 mp4/m4v/mov、`moov` 本来就在前、没有或不止一个 `mdat`、任何一条偏移落在 `mdat` 之外、`moov` 里带分片族标记（`moof`/`mvex`/`traf`/`saio`/`senc`…）、没有 `stco`/`co64`、`moov` > 8 MiB、IO 失败 —— 一律照旧发原片。旧版落盘的 `faststart/fs_*.mp4`（含原子写的 `.tmp` 残留）由 `sweepLegacyFaststartVariants()` 在启动后一次性回收（上限 512 个，只认 `fs_*.mp4` 命名）。
  **等价性取证（真机 5 源，`ffmpeg 6.0`）**：五源全部判为虚拟布局、段表拼回的字节与独立算出的 faststart 布局**逐字节相同**、`ffmpeg -v error -f null -` **无输出**、`framemd5` **视频 + 音频与源逐帧全等**（梓 812/636 行 · iris2 3895/1406 · lv_0 5581/4009 · alice 6810/5323 · kei 7010/5479）；与 ffmpeg 自己 `+faststart` 的产物体积对比为 −35 B / +537 B / −55220 B / +1 B / 0 B（**非恒真对照**：虚拟那份不重排 `free`）。本机 `faststart` 目录 1570.28 MB → **0**（`moov` 内存合计约 0.5 MB）。
  **判据**：新守卫 `test/verify-mp4-vfs.mjs`（**43 条**，夹具**全在纯 JS 里手搓**、不等 ffmpeg —— 这条链的正确性本来只是"盒表 + 偏移平移"的算术）：布局数学 16 条（含 `co64` 宽表、`moov` 已在前 ⇒ `plain`、两个 `mdat` / 无 `moov` / 偏移越界 / 顶层盒截断 / 分片标记 / 无 `stbl` / `moov` 过大 / 扩展名不在册各自的 reason）、分析器只读与缓存（同一源两次同一结论、判不了的结论**不缓存**、源改动后重新解析、分析过程不改源一个字节）、端到端真 `apply()` + `/media`（206 + `Content-Range`/`Content-Length` 按虚拟总长、响应体 == 独立算出的虚拟字节 **且 ≠ 磁盘原字节**、跨 `moov`/`mdat` 边界切片、suffix、HEAD、416、第二次请求同字节、判不了的源原样发原片、`/preview` 不参与、**跑完缓存根下没有 `faststart` 目录**）、旧副本清扫（删 3 个只认命名的文件、`preview.mp4`/`notes.txt` 一个不动）、`/media-info` 的只读抽帧缓存回答 7 条（见下一条）。`verify-scene-live` 的 ① 棘轮改成**跨四个文件**的正负对照（`lib/faststart.js` 定音 / `lib/mp4-vfs.js` 数学 / `lib/serve.js` 段映射 / `lib/routes/media-bytes.js` 消费点），并把"落盘副本 + 跑 ffmpeg"那条路**整条列进负对照**。已接进 `npm run verify`（37 → **38** 条）。
  **验证**：`npm run verify`（38 条）/ `verify:docs` exit 0；`docs/ROUTE-INDEX.md` 与 `docs/GUARD-MAP.md` 已重算（`lib/**` 行号变了、新增 1 个模块与 1 条守卫）。**宿主与客户端都改了 ⇒ 需重启 `dsh web` 并重新构建 `lib/client.js`**（已随本轮重建）。
  **判据坑（记给下一次）**：沙箱下 `spawnSync(ffmpeg)` 的**管道 stdio 一律 EPERM**（`stdout`/`stderr` 双双 `undefined`）——直接比对两次 `stdout` 会让"framemd5 一致"**假绿**；取证时改成输出写文件 + `stdio: ['ignore', fd, fd]`，并**断言输出非空**。（同理：ffmpeg 的 `-map` 必须排在 `-i` 之后，输出别写进 Steam 库的源文件旁边。）

- **有缓存的抽帧版就直接播它：不再「先取原片、等探针回来再换源」**。
  **根因**：`/media-info`（选壁纸时的那次探测）只回答源元信息，客户端因此不知道「当前帧率上限的抽帧版其实已经在盘上」⇒ **建层时先起了原片**，再由 `maybeUpgradeToTranscoded` 拿 1 字节 `Range` 去探 `/transcoded`（`src/video-layer.js`），等探针回来才换源；而层若已上屏，换源还要被推迟到下一次建层（换源会清掉已上屏那一帧，真机"纯色帧"根因见 `layerStillPending`）⇒ 首次选中那一轮必然白取一次原片。
  **修法**：宿主 `/media-info?fps=<当前上限>` 的回包增加 `transcode: { fps, cached }`，`cached` **只**来自 `transcodeCached`（一条 `existsSync`），且与 `/transcoded` 的落盘路径**共用 `transcodeCacheKey(abs, mtimeMs, fps)`** —— 键各算一份就会漂移成"说有缓存却打不中"；**绝不顺手转码**（每个被选中的壁纸白跑一次 ffmpeg 是这条路由真实发生过的浪费）。无 `fps` 参数 / 上限 ≤ 0 ⇒ `transcode: null`。客户端 `refreshMediaInfo` 带着当前上限去问，命中且"源帧率确实高于上限"就把这份抽帧版记进 `selection.transcodeReady` ⇒ **下一次建层直接用它当 `src`**（`buildVideoMedia` 既有的 useCached 分支）；仍**不**在探测里动 `<video>`，落地时机只由建层与 `maybeUpgradeToTranscoded` 决定。**宿主与客户端都改了 ⇒ 本版起改客户端要重建 `lib/client.js`**（已重建）。
  **判据**：`test/verify-transcode-state.mjs` +6 条（键只有一份、只读接线、`/media-info` 处理器体里零转码调用 + 负对照、客户端必须带 `?fps=`、`transcodeReady` 的写入点、`transcodedUrlFor` 唯一构造点 + 负对照）；`test/verify-mp4-vfs.mjs` 新增 **E 段 7 条**（不带 `fps` ⇒ `null`；盘上无缓存 ⇒ `cached:false` **且不新建抽帧目录**；按 `sha256(abs|round(mtime)|fps)` **由守卫自己独立算出**的路径放一份后 ⇒ `cached:true`；上限 0 ⇒ `null`；别的上限不许借缓存；元信息与缓存回答在同一次探测里）。整条守卫 36 → **43 条**。

- **修复：Wallpaper Engine 安装目录探测失败 —— 当前版本把可执行文件放进了 `distribution/` 子目录（依赖方报告：非默认 Steam 盘上的安装被判「未安装」）**。
  **根因**：`locateWallpaperEngineP()` 唯一的"已安装"判据是顶层 `<dir>\wallpaper32.exe` 存在。当前版本 WE 顶层只剩 `ChromaAppInfo.xml` / `installer.exe` / `launcher.exe`，`wallpaper32.exe` / `wallpaper64.exe` 下移到 `distribution\`（旁边有稳定的 `version.json`）⇒ 已安装被判未安装。**而这不是降级是功能消失**：portable 项目（`<安装根>/projects/defaultprojects|myprojects`）整批不扫，WE 播放列表读不到（`readPlaylistsP` 要 `<安装根>/config.json`）⇒ 轮换 / playlist 失效。（报告里「完全跳过创意工坊扫描」不是这条 bug 的机制：`libraryDirs` → `<库>/steamapps/workshop/content/431960` 本来就不挂 installDir。）本机 `E:\SteamLibrary` 上的真安装恰是**经典布局**（顶层 `wallpaper32.exe`）—— 所以经典那条判据必须继续认。
  **修法（宿主，全在 `lib/index.js`）**：新增 `WE_INSTALL_MARKERS`（顶层 `wallpaper32.exe` / `wallpaper64.exe` + `distribution/` 的 `wallpaper32.exe` / `wallpaper64.exe` / `version.json`）与 `isWallpaperEngineRootP(dir)`（逐标记探存在性）——**两种布局都认**（官方 CLI 文档至今只描述经典布局，故不撤经典那条；`version.json` 是"万一 exe 再改名"的稳定标记）；`locateWallpaperEngineP()` 的判据换成它。**返回的始终是安装根本身**（`projects/` 与 `config.json` 所在处），绝不返回 `distribution\` —— 消费面要的是根，不是 exe 所在的那层。
  顺带修同一条链上两个会造成「用户设了也不生效」的形状：① `owningLibrariesP()` 改探**真正被扫描的那个目录**（`<根>/steamapps/workshop/content/431960`），不再是 `steamapps/common/wallpaper_engine` 这个**目录名** —— 卸载残留空壳夹不再被当成库（本机就有一个只剩 `ui/` 与 `log.txt` 的真空壳），安装夹被改名 / 不存在但工坊内容在的库不再被漏掉；② `steamProbeDirsP()` 的 **`DSH_WE_STEAM_ROOT` 覆盖排到注册表与常见目录之前**（`locate` 返回**第一个**命中，注册表在前时显式 override 永远指不走 Steam 已知的安装，且夹具型自检在开发者机器上会静默读到真安装），并让 **env 参与 60s 探测缓存键**（否则改过的 override 会被上一次探测的 TTL 掩盖）。
  **判据**：新守卫 `test/verify-we-install-probe.mjs`（**20 条**）——行为面用四个合成 Steam 根夹具（classic / modern / stale / 只带工坊内容）各 `apply()` 一次真宿主、走 `GET /wallpaper-engine/inventory`：`distribution/` 布局必须被认出来（旧判据在此返回 null，= 本 issue 的回归门）且 installDir 是根而非 `distribution\`、portable 项目被扫到、WE 播放列表解析出壁纸 id；经典布局不许被丢；卸载残留空壳不算安装（容忍开发者机器上的真安装）；只带工坊内容的根仍是壁纸来源。夹具自带形状负对照（modern 顶层**确实没有** exe —— 否则 B 组会假绿）；另有一组源码棘轮 + 负对照（标记表、`isWallpaperEngineRootP`、`'workshop', 'content', WE_APPID` 探针、probe 顺序、缓存键）。已接进 `npm run verify`（36 → **37** 条）。
  **验证**：`npm run verify`（37 条）/ `verify:docs` exit 0；`docs/ROUTE-INDEX.md` 与 `docs/GUARD-MAP.md` 已重算（宿主行号变了）。**宿主半改了 ⇒ 需重启 `dsh web`**（本次无客户端改动，无需重建 `lib/client.js`）。
  **判据坑（记给下一次）**：`DSH_WE_STEAM_ROOT` 的语义是 **Steam 根**（含 `steamapps/` 的那一层），不是 WE 安装夹 —— 传成安装夹，候选会变成 `<…>/wallpaper_engine/steamapps/common/wallpaper_engine` 而**全部 miss**（写守卫时实测踩过：四个 case 全掉到开发者机器上的真安装，看起来像"env 覆盖失效"）。

- **新设置「缓存位置」：把几 GB 缓存挪出系统盘（用户反馈：Windows 用户的「C 盘洁癖」）；顺带修掉两处绕过数据目录的硬编码**。方案口径：**只让缓存可自定义 + 补齐覆盖**，不改数据目录本身 —— 改存 `$DSH_HOME` 只是把散落目录收进 DSH 单根，默认仍在同一个系统盘，不解决占盘。
  **根因**：缓存根此前只能靠 `DSH_WE_CACHE_DIR` 环境变量改 —— 对普通用户**不可发现、不可持久化**；实测本机 `~/.dsh-wallpaper-engine` ≈ **4.94 GB**，其中 `cache` 一项 **4.84 GB**（transcodes 2.86 / faststart 1.57 / frames 0.41），是唯一真实的占盘痛点（设置、头像、字体等加起来 0 MB —— 挪它们没有意义）。另有两处**绕开 `pluginDataDir()`**：`DEFAULT_UPLOAD_DIR = join(homedir(), '.dsh-wallpaper-engine', 'uploads')` 与 `customFrameDir()` 的同形写法 ⇒ 用户即便设了 `DSH_WE_DATA_DIR` 也搬不走这两处（`DSH_WE_UPLOAD_DIR` 只覆盖前者）。
  **修法（宿主）**：新增 `lib/routes/cache-dir.js`（`GET` 回 `{ dir, effective, same }`、`POST { dir, migrate }` 解析 → 校验 → 迁移 → 落 config；相对路径 / 目标被文件占位 ⇒ 400）与 `cacheBaseDir()` **访问器**（解析链 `DSH_WE_CACHE_DIR` → `config.json` 根字段 `cacheDir` → 默认 `<数据目录>/cache`，**每次现问、不留值快照** —— 理由同 `getUploadDir()`）；`effective` 是**实际生效**的那条，界面据此照实显示"被环境变量覆盖"。六个缓存子目录（transcodes / faststart / frames / video-previews / media-bridge / artwork）全部改走 `join(cacheBaseDir(), <n>)` —— 其中媒体中间件与封面缓存那条链起初是把缓存根**当值传进工厂**（起动时的快照），改完设置后新的封面 / 中间件缓存会又写回旧盘；现已改成**传访问器、每次现问**（`now-playing.js` 把 `cacheBaseDir` 本身交给 `createMediaBackend`，两个工厂内部统一用 `cacheRoot()` 解析，字符串调用点行为不变 —— 与 `cacheBaseDir()` 不收快照同一个理由），判据 D3/D3b 钉住这个形状并有负对照。；迁移复用上传目录那套 `moveFileP`（rename 撞 EXDEV ⇒ copy + unlink，**跨盘搬得动**），**只搬插件自己那几个缓存子目录**、不认识的条目原地不动、旧目录**只留空壳不删**；两处硬编码缺口收敛回 `pluginDataDir()`（`DEFAULT_UPLOAD_DIR` 常量删除，换成 `defaultUploadDir()`）。
  **修法（客户端）**：「高级」页签新增「缓存位置」节（生效路径 / 更改 / 输入框 / 迁移结果「已迁移 N 个缓存文件，M 个跳过」），**排在「实时渲染诊断」之前**（设置行排在排查开关之前）；9 条 i18n 词条；`Inventory` 载荷新增 `cacheDir` 字段（`.d.ts` 同步）。
  **判据**：新守卫 `test/verify-cache-dir.mjs`（**31 条**：端点形状 —— GET 405 / 相对路径 400 / 目标是文件 400；解析链正负对照 —— env 覆盖、指回当前目录短路不重写、删 `config.json` 后仍问得出默认值且**不会被重建**、`/inventory` 与之对账；迁移 6 个子目录 + 「不认识的条目不动」+ `migrate:false` 只换根；派生棘轮 + 两处旧写法的**负对照**，`lib/**/*.js` 全域零命中），已接进 `npm run verify`（35 → **36** 条）；`verify-scene-live` 的节顺序行为判据同步加「缓存位置」；`verify-types` 的 Inventory 钉住字段表同步加 `cacheDir`。
  **验证**：`npm run verify`（36 条）/ `verify:docs` / `npm run build` exit 0。**宿主半改了 ⇒ 需重启 `dsh web`**（客户端半刷新页面即可）。
  **判据坑（记给下一次）**：`/inventory` 有 3s TTL（`lib/inventory.js` 的 `INVENTORY_TTL_MS = 3000`）⇒ 拿界面读数判"改完立刻生效"会读到**上一态**，判据必须过 TTL 或改问不受 TTL 影响的 `effective`。

- **重构（零行为改动）：宿主上帝函数与客户端深嵌套收官 + 两处冗余收敛**（做法=**纯搬移优先**：先只改声明住在哪，再单独改语义）。
  **规模**：`apply()` 1541 → 333 行（`lib/index.js` 4411 → 2955 行，搬出 4 个宿主工厂与 7 个路由族）；`WallpaperPicker()` 796 → 364 行；
  `syncLayers()` 276 → 169 行；`renderPickerModal()` 311 → 63 行；`QuickPanel()` 431 → 135 行；深嵌套（缩进 ≥22）`picker-modal` 77 → 3 行、`quick-panel` 59 → 2 行。
  **冗余收敛**：宿主 JSON 应答样板 10 份 → 1（`lib/json-response.js`；16 处调用点 / 11 个文件走薄别名，逐字保行为 —— 有 2 处原本不写 `Cache-Control`，以第 4 参 `null` 保留）；
  客户端钳位 / 单调时钟 / body 根 7 份 → 1（`src/we-base.js` 的 `weClampTo` / `weNow` / `weBody`；与设置侧的 `clampNum` 语义相反，**刻意不合并**）。
  **注释与文档**：`src/` 日期戳注释 50 → 0 处、`lib/` 12 → 0 处；编年史框定语 `src/` 57 → 9、`lib/` 14 → 1；常青文档里会漂的版本号 / 条数改成符号引用。
  **判据**：新守卫 `verify-json-response`（唯一实现 + 调用点棘轮 + 6 条正负对照）；`verify-client` / `verify-scene-live` 等新增「子渲染器已拆成派生 + 装配」的双向断言（含负对照）。
  **验证**：`npm run verify`（35 条）/ `verify:docs` / `smoke`（6 套）exit 0；`lib/client.js` 重建与提交内容逐字节一致。无新增依赖、无设置项与协议变化。

- **侧栏开始页（guide）的「壁纸引擎」入口图标改成官方 artwork 家族同款彩色**（用户口径：「把壁纸引擎的图标做成和其他功能一致的彩色图标」）。
  **根因**：官方 guide 卡的图标全是**固定调色板** artwork——文件＝琥珀 `#FFBC4D` 实底、终端＝`#679EFE` 描边、浏览器＝`#539CFA` 描边（36 网格）；而我们的 React 面图标用 `currentColor`，从 guide 容器拿到的是灰墨（`--dsw-alias-label-secondary`）⇒ 整页唯一显灰的入口。
  **修法**：`src/nav-icon.js` 的 React 面（guide 卡消费的那面）改固定家族色 `#A797FC`（取自官方 `PluginArtworkLoop` 的紫，与琥珀/蓝两个邻居错开色相），几何与描边宽度不动（26px 实渲染约 2.3px，恰在终端 2.5px 与浏览器 1.4px 之间）；设置 nav 的 DOM 补丁面（`weIconSvgString`）**保持 `currentColor`**——官方设置 nav 本就是单色线条图标族，跟着上彩反而突兀。
  **验证**：`npm run verify` 全绿（`verify-i18n` 对 nav-icon 的锚点判据原样过）；渲染台 mock（浅/深主题 × 26/22px）目检：紫色「画框＋太阳＋山峦」两主题都读得清、与邻居色相错开。**纯客户端改动 ⇒ 刷新页面即可**（⚠️ 但见下方勘误：官方端运行中换 bundle 可能拉取失败，冷重启最稳）。

- **修复：原生下拉（select）弹出的选项列表「底色与字同色」整列不可读**（用户报告 + 截图：深色主题下弹层白底、选项浅字几乎隐形）。
  **根因**：Chromium 的下拉弹层是一份**独立文档**——画布底色只在 `<select>` 自身背景**不透明**时才取它的底色，而本插件的 select 是透明玻璃底（`.we-picker select { background: transparent }`，玻璃面板要透出壁纸）⇒ 弹层落到默认**浅色**画布；选项文字却继承 select 的玻璃墨色 `--we-ink`（深色主题 = 宿主浅色 label 令牌）⇒ 浅字落浅底。设置窗内全部下拉（过场动画 / 轮转间隔 / 内容分级 / 类型 / 音源……）都中招；侧栏抽屉与官方右栏的 select 因宿主给它们画了不透明底而幸免——这也是「几乎所有的下拉」但并非全部的形态。
  **修法**：`src/styles.js` 给选项行显式上不透明面板底 + 玻璃墨色（`.we-picker select option, .we-picker__select option { background-color: var(--we-panel-color, #ffffff); color: var(--we-ink, #1f2328); }`）——Chromium 弹层按 option 的**已解析**计算样式逐行绘制（var 在页面内已解析，弹层文档照抄结果），`--we-panel-color` / `--we-ink` 随明暗主题翻转，两主题都可读；类名作用域（`.we-picker__select`）专门覆盖不在 `.we-picker` 子树内的侧栏 select。
  **判据**：`test/verify-readability.mjs` 新增 **F8**——option 规则必须在位（剥注释后按选择器匹配）、必须同时声明 `--we-panel-color` 底与 `--we-ink` 墨，配两条负对照（底色改回半透明玻璃 / 丢墨色声明都必须判红）。`lib/client.js` 重建，`npm run verify` / `verify:docs` / `smoke` 全部 exit 0。渲染台（真 Chromium）实测：明主题 option = 白底黑字、暗主题 option = `#1e1f26` 不透明底 + 墨色（真机墨色解析为宿主 label 令牌 #ffffff，对 #232324 底对比度 ≈15.9:1）。**纯客户端改动 ⇒ 冷重启后生效。**

- **修复：官方端（0.2.0-rc.x，dockkit）右栏「全屏」模式下对话列穿透玻璃侧栏叠在侧栏上**（[#150](https://github.com/elysia395/dsh-wallpaper-engine/issues/150)，Citrus-Cat 报，本机 0.2.0-rc.2 复现；插件出厂默认即可触发）。
  **现象**：右栏收起与半屏（push）都正常，唯独切「全屏」后，会话的 hero 标题与输入卡整块叠在侧栏内容之上；原生（无插件）全屏则是侧栏独占整个工作区。
  **根因**：宿主 0.2.0-rc.x 的 dockkit 层级体系靠**面板内部的 dock 单元**消费 `--dsh-dockkit-dock-layer`（常态 10 / 右栏全屏 40）取得 z-index，从而盖住会话列（会话侧最高 z=9）。而本插件的右栏玻璃把 `backdrop-filter` 加在**面板元素本身**上 ⇒ 面板自成层叠上下文（z=auto 档），内部 dock 单元的 z 被困在面板里，整个面板作为原子跌回 z=auto，被会话侧同为根层叠上下文 flex 项的更高层内容（hero 输入卡 z=1 / composerSeat z=7）反压。push / 收起态没有空间重叠所以看不出来；全屏面板与对话列空间重叠 ⇒ 穿帮。本机实证链：摘掉插件样式表 ⇒ 叠放立刻恢复正常（面板内容重归顶层）；差分会话 / 面板两条祖先链的层叠上下文 ⇒ 唯一差异就是面板自身的 backdrop-filter；给面板内联 `z-index: var(--dsh-dockkit-dock-layer, 10)`（全屏解析为 40）⇒ 重叠消失。
  **修法**：`src/styles.js` 右栏玻璃主规则（`body[data-we-sidebar-glass] [data-sidebar-right-panel][data-sidebar-right-open]`，即声明 backdrop-filter 那条）补一行 `z-index: var(--dsh-dockkit-dock-layer, 10)` —— 把面板抬到宿主为它设计的同一层（var 就声明在面板上，全屏自动 40，与内部 dock 单元原生取得的层完全一致）。玻璃关着（主开关兜底只上不透明底色）与软件光栅回退档（backdrop-filter 显式 none）都不成层叠上下文，保持原生绘制顺序，刻意不动。
  **判据**：`test/verify-host-paint-scope.mjs` 新增 **H4**——凡对面板声明了 blur 型 backdrop-filter 的规则必须同条声明 `z-index: var(--dsh-dockkit-dock-layer…)`，配双负对照（删真规则的抬层 / 合成「有 blur 没抬层」的规则都必须判红）；H0–H3 原样全绿。`lib/client.js` 重建，`npm run verify` / `verify:docs` / `smoke` 全部 exit 0。官方端 0.2.0-rc.2 冷重启活体复验：全屏面板 computed z-index=40、玻璃模糊仍在、hero 位置 elementFromPoint 回到面板内容（修复前是会话 SPAN），截图 `.test-cache/issue150/issue150-fixed.png`。**纯客户端改动 ⇒ 刷新页面即可**（⚠️ 但见下一条：会话中途换 client.js 的坑）。

- **⚠️ 验证手法勘误：官方端运行中重建 lib/client.js 后，仅 reload 页面可能拉取失败（`net::ERR_ABORTED`），必须重启宿主**（本次 #150 验证实测）。
  **现象**：宿主运行期间重建 client bundle（内容变化）⇒ 页面 reload 后插件 import 永不落定，启动屏停在「Loading plugins…」，宿主日志报 `web boot: 1 entry did not activate` + `import failed (see console for the import error)`；CDP 网络层可见**只有本插件的** `plugins/??dsh-plugin-wallpaper-engine/client.js&rev=…` 被中止（其它插件全部 NETDONE；同批另一模块第一次也被中止、换 rev 重试成功）。bundle 内容回退到与冷启动完全相同的字节依旧失败 ⇒ 与内容无关，是宿主对「会话中途换文件」的 rev/中继状态 wedge。此前 art-gate 实验的「checkout + reload 即生效」结论对本仓**当前构建节奏**（一次会话多次重建）不可靠。
  **手法**：改 client bundle 后验证一律 **杀进程冷重启**（`taskkill //F //IM "DeepSeek Harness.exe"` 再启动），不要赌 reload。

- **侧栏顶栏新增「刷新」按钮（「暂停」旁）+ 更新公告改版：配图缩小、「侧边栏只是简略版」用 16pt 大字喊出来**（用户口径三条：①「在暂停的旁边添加一个刷新壁纸仓库的按钮，因为总有用户找不到设置页面的刷新键」；②「缩小一些更新公告中的图片」；③「用 word 文档中的 16 号大小的字体向用户说明侧边栏的调节只是简略版，细致的调节在设置页的壁纸引擎页中，可以用夸张一点的表达效果因为用户总是忽视我的更新公告」）。
  **做了什么**：① 侧栏当前壁纸行的按钮组从 暂停 / 清除 扩成 **暂停 / 刷新 / 清除**（`src/quick-panel.js`）—— 与设置页「刷新」**同一个动作**（`loadInventory()`）、同一个在途态（`刷新中…` + 禁用），tooltip 写明「重新扫描 Wallpaper Engine 壁纸库（新装 / 已删除的壁纸立即出现）」；抽屉档与官方右栏档共用这一份。② 公告配图限高 38vh → **26vh**（`src/styles.js`；1080p 下约 410px → 280px，方图不再独占半屏）。③ 公告「💡 使用提示」下新增一段大字说明（`we-update-notice__callout`，**`font-size: 16pt` ≈ 21px，约正文两倍** —— pt 是绝对单位，不吃正文 0.82em 的缩放）：「❗❗❗ **侧边栏的调节只是「简略版」！**细致的调节都在「设置 → 壁纸引擎」里！」—— 夸张的只有字号与感叹号，不夸大事实。**`NOTICE_VERSION` 升 `1.3.1`**：公告内容改版而不升哨兵的话，看过 -r2 的用户永远看不到新说明（改了等于没改），故重弹一次。
  **判据**：`test/verify-i18n.mjs` 双向对账（新增 3 键：tooltip 一条 + 大字说明两句，中英同步）；`verify-about` 第⑤节 art-gate 判据原样全绿（门控结构未动）；`lib/client.js` 重建，`npm run verify` / `verify:docs` / `smoke` 全部 exit 0。浏览器实机渲染台目检：抽屉顶栏三按钮（360px 档）不折行、标题正常截断；16pt 大字与配图缩小符合预期。**纯客户端改动 ⇒ 刷新页面即可**。

### v1.3.0-r2（未发布）

> v1.3.0 之后的增量（GitHub Release v1.3.0 附件发出后、npm 渠道发布前修掉的三件事）；`package.json` 版本号同步 `1.3.0-r2`。

- **修复：切换会话（或设置里对同一张壁纸重新 apply）之后壁纸照播但鼠标静默失效 —— 实时激活态被同 id 重申清成 false 且再无人置真**（上游 issue 报障，本机诊断心跳 `playing=true` + `watch=… first=1` + `liveOn=0` 三者并存为直接证据）。
  **现象**：切会话 / 重申选中之后，Scene 壁纸的指针视差与点击交互、Web 壁纸页里的指针效果全部失效，只有整页重载才恢复；因为画面照旧在播（`we-live-on` 类与垫底图早就是终态），用户只会觉得「壁纸有时候坏了」。
  **根因**：`src/media-prep.js` 的 `applySelection()` 正常路径**无条件** `selection.sceneLiveActive = false`，而它同时是"渲染页活着"的运行时状态与下游闸门；同 id 重申时层键（`wantKey`，不含版本/时间戳）一字不差 ⇒ `src/live-layer.js` 的 `syncLayers()` 走 `adopt-live` 领养分支：渲染页不重载、首帧门也不会重走。而全文件**唯一**置真点是首帧门（一辈子只走一次）⇒ 标志永久为假，消费点**全是提前 return**：`livePointerFlush` / `livePointerSample` 挡住指针注入（window 级 capture 监听其实还挂着），`startMediaSync` 的 1s 拍挡住音频频谱与 Now Playing。
  **修法（三条一起，① 治根因 / ② 立刻恢复 / ③ 兜底自愈）**：① 清零点改由 `idChanged`（`selection.id` 赋值**之前**算出的新旧 id 比较，与同处 `cancelLiveMount("selection")` 共用一次比较）守卫，只在真的换图时清 —— 同 id 的**真**重建（live 开关 / fps 档 / 媒体源变化 ⇒ 键变化）本来就走 `layer-rebuild` 分支的 `stopLiveWatch()`；两个早退分支（id 为空 / 被过滤）里的裸清零**保留**（那两种情况后面不再同步任何层，清是对的）。② 领养那一跳在 `ensureLivePointer(liveFrame)` 之后按**与首帧门同源**的就绪判据（新 watch 指向同一帧 + `isConnected` + 非延迟载荷 + `isEffectivelyPlaying()` + `liveFrameReady()`）补挂激活态，不必等下一拍心跳。③ 心跳 1s tick 在 `responsive`（场景真出帧 / 网页渲染页可达）为真时无条件校正回真（每个 watch 只记一条诊断）—— 把语义的**唯一权威**放回心跳层，任何现在或将来漏掉的清零点都会被下一拍纠回来。
  **为什么自愈挂在 `responsive` 而不是原来的分支条件**：分支条件含 `|| !isEffectivelyPlaying()`，暂停期也走它，而暂停中的场景页 `fps=0` ⇒ `alive` 恒为假 —— 挂分支条件则自愈失能；反过来"无条件置真"又会在暂停期把**故意暂停**的渲染页标成 active（指针注入与媒体桥白热）。挂在 `responsive` 上两头都对：真在出帧才自愈，恢复播放后的第一拍（≤1s）再自愈。
  **判据**：`test/verify-scene-live.mjs` 新增三条结构判据（正常路径的 live 清零必须被 `idChanged` 包住且比较在赋值之前 / 领养补挂必须是含全部就绪判据的**同一条连续语句** / 自愈必须挂 `responsive` 且只报一次），各配一条**负对照**并把判据实现提出来复用（负对照跑的是同一个函数，否则证明不了有牙）—— 为此该文件补了一个配平大括号的 `balancedBody()`：既有 `fnBody()` 只切到首个 `\n}`，对"函数头先来一行早退"的 `startLiveWatch` 会截在早退块上，判据恒假。

- **修复：更新公告的求星配图在"更新后还没重启"的用户那里裂图 —— 公告改「配图就绪才弹」**（v1.3.0 发布当日实测）。
  **根因**：面板 bundle 宿主每次开页从磁盘现读，后端路由只在 DSH 重启时换血 —— 更新后未重启的窗口期里，旧后端的 `/about-qr` 白名单还没有 `update-notice.jpg` ⇒ 配图 404；公告若照旧立刻弹，用户看到裂图，而「知道了」一关整版公告永久退场，配图等于永远没人看到。
  **修法**：弹窗前轮询 `HEAD` 配图路径（1.5s 一拍），新白名单在场（= 已重启）才带图弹出；等满 90 秒仍不在（异常安装 / 死活不重启）降级为**无图**弹出，文案信息完整（求星入口在「关于」页常驻，不靠弹窗这一条命）。已关过公告的用户零探测请求。**`NOTICE_VERSION` 哨兵换 `1.3.0-r2`**：发布当日已误关公告的用户会再看到一次（这次带图）。
  **判据**：`verify-about` 新增第⑤节 art-gate 源码守卫（探针在 / 门控在 / img 只在 ready 态渲染 / 负对照）。

- **新功能：侧边栏快捷面板新增「内容分级」筛选 + 搜索框在 300px 封顶**。

  **做了什么**：视图栏新增「内容分级」下拉（全部 / 全年龄 / PG13 / 成人 / 未分级），与设置页**同一个键** `contentRatingFilter` 双向同步（类型筛选同款治理）——分级闸门本就长在面板列表的数据源（`playableInventory` 两级过滤第一级）上，此前只是缺控件，设置页切档面板列表跟着缩却无处解释；空态文案补分级分支「『{name}』分级下没有可播放的壁纸」。搜索框封顶 300px 独占首行，分级/类型/视图三个控件右对齐成第二行 —— 最窄官方右栏（276px）四控件一行放不下，2026-10-04「一行排下、最窄不折行」的旧口径按新现实改写（确定性两行，不用依赖假想尺寸的裸 flex-wrap，中间宽度不碎行）。
  **判据**：`verify-scene-live` 快捷面板合成作用域全绿；i18n 双向对账（**纯 ASCII 不包 `weT`**：「PG13」不含 CJK，调用点扫描器看不见它，包了会判孤儿键 —— 裸字面量 + 不进词表）。

- **审计一轮：「3D 效果」修掉五处真缺陷 —— 面板名单与"真的会动"的那些槽位不同源、嵌在原生组里的插件槽被漏掉、插件槽缺省值让缓动静默失效、跨中线那一帧跳 2 个设备像素、面板回显不钳范围**（来源：交付前对「界面元素跟随 + 插件前端独立开关」这一批改动做的两轮**独立**审计 —— 一轮逐行读行为层，一轮读设置 / 面板 / 测试与文档；下面每条都注明是审计意见的哪一条。**没有**改任何出厂开关、**没有**动任何存档量纲）。
  **做了什么**：① **面板名单与屏上同源**（审计 #1，`src/parallax-layer.js` 新增 `parallaxPluginEffectiveGroups()`）：`parallaxPluginGroups()` 只是"所有 `[data-slot]` 出口的元素子节点"这一层**原始**候选，而真正会拿到位移的候选还要过两道闸 —— 界面跟随开着时，被**原生组**（`PARALLAX_GROUP_SELECTOR` 那几条）包含的那些（例如 `conversation.view` 出口里的插件槽）会被外层 `contains()` 剔掉，被**别的插件子节点**包含的也剔掉；`parallaxTargetsRefresh()` 与 `parallaxDiscoveredGroups()` 现在共用这一个函数 ⇒「扩展 → 插件前端」列出来的槽位**就是**会写位移的那一批（此前它列的是原始候选：嵌在原生组里的槽会既出现在名单里、又一动不动 —— 拖了没反应还找不到原因）。② **插件槽缺省值不再让缓动失效**（审计 M1）：`parallaxMaxPercent()` 只遍历**已存键**，而缺键槽按 `PARALLAX_PLUGIN_DEFAULT` 走 ⇒ 壁纸距离 0、界面跟随关着、只开插件前端时它算出 `pctMax = 0`，帧直接走"一次落位收工"的短路、`parallaxSmooth` 静默失效（缓动尾巴上还能看到 10px 级瞬移）。现在 `if (PARALLAX_PLUGIN_DEFAULT > max) max = PARALLAX_PLUGIN_DEFAULT;` —— 缺键槽按缺省 1% 计入。③ **只认自己的键**（审计 M4）：插件表是 `map` 档、存档走 `Object.assign({}, v)` 浅拷贝，`__proto__` 这类键会变成表的**原型** ⇒ `parallaxTargetRatio()` 与 `parallaxMaxPercent()` 改走 `Object.prototype.hasOwnProperty.call(st.plugin, rec.slot)`（与遍历口径一致），不再可能从原型链上取值。④ **过零不跳**（审计 L1）：`parallaxSnapAxis()` 的量化只看绝对值、`prev` 是上一次写下的**带符号**整数 ⇒ 光标跨过屏幕中线那一帧会把 −1 直接翻成 +1（2 个设备像素的台阶 = 抖一下）。现在先把符号摘出来，`prev` 与这一次**异号**时归零：`if (prev && (prev > 0) !== (raw > 0)) return 0;`。⑤ **面板回显钳进层里那对常量**（审计 #2）：`src/ext-parallax.js` 的 `parallaxPluginPercent()` 末尾收 `Math.min(PARALLAX_GROUP_DEPTH_MAX, Math.max(PARALLAX_GROUP_DEPTH_MIN, n))` ⇒ 存档里的越界值（换过阈值的老档、手改过的档）在面板上不再显示成 42%。⑥ **长槽名不再把行撑破**（审计 #3）：`src/styles.js` 给 `.we-picker__slider-row .we-picker__label` 加 `flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`（槽键是别人的自由命名、可以很长，此前会把右端的回显挤出卡片）。⑦ 文案与注释：插件槽那一行的 tooltip 与那一卡上方那句说明（认到槽位时显示的那条 hint）都补上"**组里有 `position: fixed` 后代时这一组整组不动**"这条免责说明（中英同步），`parallaxRatios()` 的 doc 注释里那句 `1 + 变量 / 100` 改成实现里的 `scale: calc(1 + var(--we-parallax-bg, 0) / 50)`（并补上推导：位移最大 = 系数/100 × 整屏宽，居中放大 s 时每侧多出 s/2 × 整屏宽 ⇒ s = 系数/50）。
  **为什么**：① 是"面板上能拖的"与"屏上会动的"必须是同一批 —— 这条不变量在插件组进来之后第一次被破坏；② 是旧假设"壁纸不动就整体不动"的残留（插件组不再挂在壁纸上）；③④ 是同一张表 / 同一条量化链上的边界（存档里的值可以比当前域更宽，`map` 档只浅拷贝、不校验）；⑤⑥ 就是那条边界的显示层后果。**明确不改**：`case 'map'` 的通用 sanitize（它与 `customFrames` / `frameVariants` 共用，"表里的值信任写入方"是有意为之，动它会连带改另外两张表的口径）、`parallaxGroupBlocked()` 的"子树 > `PARALLAX_GROUP_SCAN_MAX`(400) 就照动"（刻意的性能闸：长会话里整块不动是回归）、`parallaxPluginDepths` 只增不减（剪枝会把当前没挂载的插件设置弄丢）、面板名单是渲染期快照（不是实时流）。
  **判据**：`test/verify-scene-live.mjs` **`ALL SCENE-LIVE CHECKS PASSED (466)`**（审计一轮后已推到 **472** —— 本轮 A1 / A6 各补判据） —— 源码口径块换锚并新增 `function parallaxPluginEffectiveGroups()` / `const plugins = parallaxPluginEffectiveGroups();` / `if (st.ui && typeof document !== 'undefined' && document` / `if (PARALLAX_PLUGIN_DEFAULT > max) max = PARALLAX_PLUGIN_DEFAULT;` / `Object.prototype.hasOwnProperty.call(st.plugin, rec.slot)` / `const sign = raw < 0 ? -1 : 1;` / `if (prev && (prev > 0) !== (raw > 0)) return 0;` / `if (!prev) {`；假 DOM 台新增第二个插件出口（`data-slot="otheracc.widget"`），它的元素子节点**长在原生会话组盒子里**，三条新腿逐条钉：界面跟随**关**着 ⇒ 它拿到位移、且名单里同时有它和 `dshmarket.panel`；界面跟随**开**着 ⇒ 它自己**一个 `translate` 都不许写**（被外层吃掉）、名单里**不许**有它而仍要有 `dshmarket.panel`；插件槽缺省值那条腿 = 壁纸距离 0 + 界面跟随关 + 插件开 ⇒ 从零点一步跨到满档、**第一帧**必须只走一部分（严格小于收敛值）；过零那条腿逐帧采样会话文本区的位移，断言"负、正都出现过"且"不存在相邻两帧符号相反"。挂载台的 `pointermove`/`selection` 时序也顺带修对了（这一层"到位就收工"、重扫又只在 kick 里发生 ⇒ 改完开关必须先把假时钟推过 250ms 重扫节流窗、再挪到一个**新位置**，否则新记录根本补不上 —— 见新助手 `rescan()` 的注释；此前那几条腿是"看着绿、其实没跑"）。ext 岛那一段补 `PARALLAX_GROUP_DEPTH_MIN` / `_MAX` 替身（单独 import 时它们是在构建期同作用域的兄弟符号 —— 从层源码里现读 `const NAME = N;`、**不抄数**）与一条越界回显腿（`{ [SLOT_A]: 42, [SLOT_B]: -5 }` ⇒ 回显落在域内的两个端点上）。`test/verify-client.mjs` 走树断言同时钉住"插件开关默认关"与"关着时那一卡只有开关"。`lib/client.js` 重建（与 `src/**` 同提交）。**纯客户端改动 ⇒ 刷新页面即可**。

- **「原生前端」四个区域距离的出厂默认改成用户实际调好的那一组（1.2 / 1.8 / 1.6 / 1.4）**（用户诉求：「修改原生前端在开启时的默认值」，并给出这四个数；「界面元素跟随」这个开关本身仍默认关）。
  **做了什么**：`lib/settings-schema.js` 的 `DEFAULTS` 四行从一律 `1` 改成 `parallaxUiChatDepth: 1.2` / `parallaxUiComposerDepth: 1.8` / `parallaxUiSidebarDepth: 1.6` / `parallaxUiBubbleDepth: 1.4`（**KINDS 不动** —— 滑杆域仍是 `num 0..10`、步长 0.1，改的只是缺省值）；`src/parallax-layer.js` 里那四个"取不到设置时的兜底"常量（`PARALLAX_GROUP_CHAT / COMPOSER / SIDEBAR / BUBBLE`）同步改成 `1.2 / 1.8 / 1.6 / 1.4`，与 `DEFAULTS` 逐字同值；`src/ext-parallax.js` 里「输入卡片距离」的 tooltip 去掉写死的"（出厂 1%）"、改成"默认比文本区大一点"，`src/i18n-copy.js` 中英同步（面板文案从此不抄任何默认值，要查出厂值只有 `lib/settings-schema.js` 一处）。
  **为什么**：出厂那一组此前是"四个都 1%"的保守值，用户实测后给出了他真正想要的层次（输入卡片最靠前 1.8、侧栏 1.6、用户气泡 1.4、会话文本区 1.2）—— 第一次打开「界面元素跟随」就该是调好的样子，而不是让每个人都先自己拖一遍。**只改距离、不改开关**：`parallaxUi` 仍默认关（效果类功能出厂不替所有用户改画面，与本页其它条目同一条理由）。**没有**顺手把插件组的缺省 `PARALLAX_PLUGIN_DEFAULT` 一起调（它自成一份、仍是 1%，量级上仍与原生区域相近）。
  **判据**：`test/verify-scene-live.mjs` **`ALL SCENE-LIVE CHECKS PASSED (466)`**（审计一轮后已推到 **472** —— 本轮 A1 / A6 各补判据） —— 四条常量锚改成 `const PARALLAX_GROUP_CHAT = 1.2;` / `const PARALLAX_GROUP_COMPOSER = 1.8;` / `const PARALLAX_GROUP_SIDEBAR = 1.6;` / `const PARALLAX_GROUP_BUBBLE = 1.4;`（行为挂载台仍旧显式给四个自己的数 ⇒ 分档 / 置 0 那几条腿不受影响）。`test/verify-client.mjs` 的四条回显断言从"一律 `1%`"改成按 `{ '会话文本区距离': '1.2%', '输入卡片距离': '1.8%', '侧栏距离': '1.6%', '用户气泡距离': '1.4%' }` 逐行钉（滑杆域 0..10 与"界面开关关着时四行都不画"照旧钉住）。`test/verify-i18n.mjs` 41 条全绿（tooltip 那条 zh 键与 en 值同步改写）。`test/fixtures/settings-sanitize-golden.json` 按新 `DEFAULTS` 重录（18 用例 × client / host 两侧共 33 处改值，**其余键零漂移**；重录脚本 `.test-cache/regen-golden-native-defaults.mjs`）。`lib/client.js` 重建（与 `src/**` 同提交）。**纯客户端改动 ⇒ 刷新页面即可**，不用重启宿主。**迁移说明（审计 #5）**：这次改的是**缺省值** —— 只对"这四个键还不在存档里"的档生效；已经存过它们的档（`serializeSettings()` 会把整张 KINDS 表都写进存档 ⇒ 任何改过一次设置的档都存过）仍是存档里那一份旧值，想要新的出厂那一组得自己把那四行拖过去。**没有**升 `settingsVersion`、**没有**迁移脚本、**没有**改动量纲。

- **「3D 效果」的插件前端有了自己的开关（默认关）—— 三类前端各有各的开关，「界面元素跟随」不再替它做主**（用户口径：「把插件前端也单独归类加开关」；裁决 = **独立开关、默认关**）。
  **做了什么**：新增设置键 `parallaxPlugin`（`lib/settings-schema.js` 的 DEFAULTS 与 KINDS 各一行，`boolFalse`、出厂 `false`）。① **层**（`src/parallax-layer.js`）：`parallaxSettings()` 多一项 `pluginOn: selection.parallaxPlugin === true,`；`parallaxMaxPercent(st)` 重排成"先取壁纸、再按 `st.ui` 取四个区域的最大值、`if (!st.pluginOn) return max;` 之后才遍历插件表"（原先把整张插件表挂在 `st.ui` 上的那句早退删掉）；`parallaxTargetRatio()` 里插件分支改判 `if (rec.kind === 'plugin') { if (!st.pluginOn) return 0; … }`，并把它排到 `if (!st.ui) return 0;` **之前** ⇒ 插件不再吃界面那个开关；`parallaxTargetsRefresh()` 里认插件组的那一段改判 `if (parallaxSettings().pluginOn) {` —— 关着时**连扫都不扫**（不是"系数算成 0"）：认了也只会白跑一遍 fixed 后代那道子树判定（每组最多 400 个 `getComputedStyle`），而结果注定是 0。② **面板**（`src/ext-parallax.js`）：「插件前端」那张卡的第一行改成它自己的开关 `switchRow(weT("插件前端跟随"), sel.parallaxPlugin === true, onParallaxPlugin, …)`，那句 hint、两态文案（认到槽位 / 一个都没认到）与 per-slot 的 `SliderRow` 全部由 `ui &&` 改判 `pluginOn &&` ⇒ 这一卡关着时**只有开关**（与"关着还能拖参数"同一条不变量），槽位名单与"真的会动"从此同源。③ **宿主侧接线**（`src/client.js`）：新增 `onParallaxPlugin` 具名处理器（`setSetting("parallaxPlugin", e.target.checked)`）并接进 `extensionCtx()`，`parallaxPluginSlots` 的判据从 `sel.parallaxUi === true` 改成 `sel.parallaxPlugin === true`；`lib/settings-schema.js` 里 `parallaxPluginDepths` 那张表的注释补一句"只在开关开着时才算数（表里的值原样留着、开关一开照旧生效）"。④ 文案两条（`src/i18n-copy.js`：「插件前端跟随」与它的英文 hint），文件头与 `parallaxTargetRatio()` 的 doc 补上"三类各有自己的开关"。
  **为什么**：插件前端挪的是**别的插件画出来的真实界面**（任务看板、市场面板…），与"原生前端"是两件事 —— 用户可能想让自己天天看的宿主界面跟着动、却不想让第三方面板跟着动（或反过来）。**独立**（而不是挂在「界面元素跟随」下当子开关）才让四种组合都成立；**默认关**与 `parallaxUi` 同一条理由（效果类功能出厂不该替所有用户改画面）。**否决了**"当 `parallaxUi` 的子开关"：那会把两件事的取舍绑死，而且 `parallaxUi` 关着时插件组那个开关会跟着消失 —— 等于根本没有这个开关。**保留**了"关着时那张表原样不删"（与 `parallaxUi` 关着时四个区域距离照旧存档同一口径）。
  **判据**：`test/verify-scene-live.mjs` **`ALL SCENE-LIVE CHECKS PASSED (466)`**（审计一轮后已推到 **472** —— 本轮 A1 / A6 各补判据） —— 源码口径块新增四条锚（`pluginOn: selection.parallaxPlugin === true,` / `if (parallaxSettings().pluginOn) {` / `if (!st.pluginOn) return 0;` / `if (!st.pluginOn) return max;`）与两条反向判据（源码里**不许**再有 `if (!st.ui) return max;` 与 `parallaxSettings().ui`）；假 DOM 台新增"插件槽出口（`display: contents`，`data-slot="dshmarket.panel"`）+ 有盒子的元素子节点"，并加三条腿 —— 界面跟随开着而插件开关关着 ⇒ 槽位一动不动；只开插件开关 ⇒ 插件那一组走到与原生会话组**一样远**（缺省 1%，两侧逐字比对）；再把界面整块关掉 ⇒ 插件组照动、原生那几组一动不动；收尾"全收干净"那条一并判插件出口与它的子节点。ext 岛新增 `onPlugin` 用例（`PARAMS` / `UI_PARAMS` 各添一行「插件前端跟随」，原 `onSlots` 改名 `onUiSlots` 并改成"界面开 + 插件关 ⇒ 插件行一行都不许出现"，`onPlugin` 的期望行序 = 背景 / 吉祥物 / 界面 / 插件开关 + 两枚槽键 + 缓动平滑），另新增一条插件开关的源码口径 check（`const pluginOn = on && sel.parallaxPlugin === true;` / `const slots = pluginOn && Array.isArray(parallaxPluginSlots) ? … : [];` / `switchRow(weT("插件前端跟随")…` / `pluginOn && (slots.length` / `pluginOn && slots.map(` + 反向 `ui && (slots.length` / `ui && slots.map(`，以及 `function onParallaxPlugin(e) {…}`、`parallaxPluginSlots: sel.parallaxPlugin === true ? …`、schema 的 `DEFAULTS.parallaxPlugin === false` 与 `KINDS.parallaxPlugin.kind === 'boolFalse'`）。`test/verify-client.mjs` 走树断言：插件开关默认是关的、**关着时那一卡既没有提示也没有槽位行**、打开之后才出现"还没认到别的插件注册的前端元素组"（该夹具没有 DOM ⇒ 恒为这一态）、把「界面元素跟随」关掉后插件那一卡照旧（开关仍开、说明还在）而原生四行收起 —— 两个开关互不依赖。`test/verify-i18n.mjs` 41 条全绿。`test/fixtures/settings-sanitize-golden.json` 按代码补录（18 用例 × client / host 两侧共 33 处新增 `"parallaxPlugin": false`，**其余键零漂移**；重录脚本 `.test-cache/regen-golden-plugin.mjs`）。`lib/client.js` 重建（提交内与 `src/**` 同步）。

- **「3D 效果」的缓动距离统一成"占屏幕最长对角线的百分比"、自动认到别的插件注册的前端元素组，并按 背景 / 原生前端 / 插件前端 三张卡分类**（用户口径三条：①「注意，这里百分比的意思是"最大缓动距离占屏幕对角线长度的百分比"」；②「接下来可以试试自动识别其它插件注册的前端元素组，让它们也参与缓动」；③「将扩展下的缓动元素设置进行分类：背景、原生前端、插件前端，当某一元素最大缓动距离设为 0 时表示该元素不缓动」；另两条裁决：滑杆域 `0–10%`、步长 `0.1%`、出厂一律 `1%`，插件元素组**默认参与缓动** —— ⚠️ 两处都已被上面新条目取代：「出厂一律 `1%`」现为 1.2 / 1.8 / 1.6 / 1.4（用户诉求 m04159）；插件前端现在有**独立的开关**（`parallaxPlugin`）、**默认关**，"默认参与"不再成立）。
  **做了什么**：① **单位量的口径**：`src/parallax-layer.js` 新增 `const PARALLAX_STEP_DIV = 50;`，帧里改成 `targetX = PARALLAX_DIRECTION * (cx - vw / 2) / PARALLAX_STEP_DIV`（Y 同理）—— 即 `位移 = 2 × pct/100 ×（光标 − 屏幕中心）`，光标贴到屏幕角（`|u| = 对角线/2`）时 `|位移|` 恰好 = `pct%` × 对角线；`src/styles.js` 的壁纸补边同步从 `scale: calc(1 + 系数 / 100)` 改成 `calc(1 + 系数 / 50)`（放大 `1 + pct/50`）。② **四个区域键改成绝对百分比、总倍率退役**：`parallaxUiChatDepth` / `parallaxUiComposerDepth` / `parallaxUiSidebarDepth` / `parallaxUiBubbleDepth` 的 KINDS 从 `num 0..3` 改成 `num 0..10`、DEFAULTS 一律 `1`，`parallaxUiDepth`（界面跟随总倍率）连同它的 KINDS 条目、`src/ext-parallax.js` 里那行滑块、`src/client.js` 的 `onParallaxUiDepth` 处理器**整条删掉**（KINDS 里没有的键，`sanitizeFromSchema()` 遍历时自然丢掉 ⇒ 旧存档里的孤儿键不需要迁移、不升 `settingsVersion`）；层里四个 `PARALLAX_GROUP_*` 系数常量（原 1 / 1.5 / 0.6 / 0.4，只是"取不到设置时的兜底"）一律改成 `1`，`PARALLAX_GROUP_DEPTH_MAX` 3 → 10；`src/ext-parallax.js` 四行滑杆的 `Math.round(sel.parallaxUi*Depth * 100)` 与 `src/client.js` 四个处理器的 `v / 100` 一并删掉（面板与存档从此**同一个单位**，只有 `%` 是单位后缀，不再是 ×100 的显示层）。③ **插件前端**：新增设置键 `parallaxPluginDepths`（KINDS `map` 档 —— 只浅拷贝、不校验值，与 `frameVariants` 同型；语义 = 槽键 → 百分比）；层里新增 `PARALLAX_PLUGIN_SLOT_ATTR / _SELECTOR / _SKIP / _SKIP_PREFIX / _SKIP_SCOPE` 与 `PARALLAX_PLUGIN_DEFAULT = 1`，以及 `parallaxPluginKey(el)`（读 `data-slot`、按名单与前缀过滤、`el.closest(PARALLAX_PLUGIN_SKIP_SCOPE)` 剔掉设置与插件管理子树）、`parallaxPluginGroups()`（返回 `[{ el: 出口的元素子节点, slot }]` —— 出口自己 `display: contents` 没有盒子，见「3D 效果」上一条与 `DSH-UI-INTERFACES.md` §3.5）、`parallaxDiscoveredGroups()`（去重后的槽键数组），三个候选入列走 `parallaxTargetAdd(…, 'plugin', slot)`、系数取 `st.plugin[rec.slot]`（缺键 = `PARALLAX_PLUGIN_DEFAULT`，显式 0 保留 = 这一组不缓动）；帧里的"最大百分比"改由新函数 `parallaxMaxPercent(st)` 算（不再只看壁纸 —— 否则界面/插件组的缓动尾巴会被判成"已到位"提前抹平），自检计数多一列 `插件前端`。④ **面板重排**：`src/ext-parallax.js` 用新助手 `parallaxSection(label, key, rows)` 拼三张分组卡（复用 `we-picker__section` / `-head` / `-label`，与「画面」那张同款）：**背景**（背景缓动距离 + 吉祥物跟随）/ **原生前端**（界面元素跟随 + 四个区域距离）/ **插件前端**（认到的槽位各一行 `0–10 / 0.1`，标签就是槽键；一行都没认到时给一句 hint），全局「缓动平滑」仍压在最后；插件行的回显走新助手 `parallaxPluginPercent(v)`（`null` / `undefined` / `""` / 非数 ⇒ 缺省，显式 0 保留），而那个缺省值**从层里 import/内联**（`src/parallax-layer.js` 的 export 因此多出 `PARALLAX_PLUGIN_DEFAULT` 这一枚，面板不许再抄一个数）；名单由 `parallaxDiscoveredGroups()` 经 `extensionCtx()` 的 `parallaxPluginSlots` 交给岛（**单一真源**：认到几个画几行），界面跟随关着时层与面板都不认。
  **为什么**：① 用户口径 ① 要的是"光标贴到屏幕角上时位移 = p% × 对角线"，而旧算式 `pct/100 × u` 只在光标走完**半条**对角线时才到 `pct%` ⇒ 除数 100 → 50（等价于增益 ×2），壁纸补边必须同步，否则位移超过放大余量就会露出底色。② "面板 ×100、存档 ÷100"是上一版为省一次迁移留下的债（见下一条），这次既然要动滑杆域（0–3 倍率 → 0–10 百分比）就一次抹平；顺带把总倍率这层**二次乘法**退役 —— 每个区域各存自己的绝对距离更直观，也才让用户口径 ③ 的"设 0 = 不缓动"变成一句真话（旧口径下总倍率为 0 也会让四块全不动，但面板上"哪一块是 0"看不出来）。③ 插件组只能**认 DOM**：运行期拿不到归属（`ctx.slots` 的占用者 `registrant` 恒为 `mf`、子槽注册不向上冒泡、宿主文档明说槽信息是开发期工具 —— 逐条证据见 `DSH-UI-INTERFACES.md` §3.6），而本插件本来就在钉 `[data-slot="…"]`；代价是宿主自己的界面槽也会出现在「插件前端」里，用户把它设 0 即可。④ 分类卡片是用户口径 ③ 的字面要求。**否决了**"把插件距离也乘上一个总倍率"（那会把刚退役的二次乘法和"0 是什么意思"一起请回来）与"用槽注册表列出插件、按包名分组"（认不出归属，且包名是别人的自由命名）。
  **判据**：`test/verify-scene-live.mjs` **`ALL SCENE-LIVE CHECKS PASSED (465)`**（⚠️ 条数已被上面新条目推到 **466**，其中 `onSlots` 那个用例已改名 `onUiSlots` 并加严成"界面开 + 插件关 ⇒ 插件行一行都不许出现"，另加一个 `onPlugin` 用例）—— 导出那一枚改成"四枚"（`PARALLAX_PLUGIN_DEFAULT,disposeParallaxLayer,parallaxDiscoveredGroups,syncParallaxLayer`，并断言 `PARALLAX_PLUGIN_DEFAULT === 1`、`parallaxDiscoveredGroups()` 返回数组），单位量（`PARALLAX_STEP_DIV = 50` 与两条新算式）、四组系数常量、`PARALLAX_GROUP_DEPTH_MAX = 10`、插件组六个常量与三个新函数、`selection.parallaxPluginDepths`、`function parallaxMaxPercent(st)`、`parallaxTargetAdd(…, kind, slot)`、`return coef * PARALLAX_UI_SIGN;` 与插件分支 `return parallaxClamp(st.plugin[rec.slot], …)`、`scale: calc(1 + var(--we-parallax-bg, 0) / 50)` 各加锚，并加两条反向判据（源码里**不许**再有 `PARALLAX_UI_DEPTH` / `st.uiDepth` / `const pctMax = st.bg;`）；假 DOM 台按新旧混合夹具继续跑（四个区域各按自己的绝对距离 1% / 1.5% / 0.6% / 0.4%，"某一块置 0 ⇒ 那一块一动不动"改成"把会话文本区距离置 0"），ext 岛新增 `onSlots` 用例（两枚槽键 ⇒ 多两行、行标签 = 槽键）与 `parallaxPluginPercent()` 的源码口径 check。`test/verify-client.mjs` 走树断言三张分组卡按标题按序出现且落在「扩展模块」容器之内、四个区域滑杆域 `0..10` 且回显 `1%`（⚠️ 回显现按新的出厂值逐行钉：1.2 / 1.8 / 1.6 / 1.4）、`界面跟随距离` 那一行彻底消失、"还没认到别的插件注册的前端元素组"那一态可见（该文件的假 DOM 没有 `querySelectorAll` ⇒ 恒为这一态；⚠️ 该条现在要**先把插件开关打开**才成立 —— 见上面新条目）。`test/verify-i18n.mjs` 41 条全绿（删掉「界面跟随距离」与其 tooltip、四条区域 tooltip 改写成"占屏幕最长对角线的百分比 / 0 = 这一组不跟"、新增三张卡标题与插件段两句 hint，中英同步；`%` 不进词表）。`test/fixtures/settings-sanitize-golden.json` 按代码重录（18 用例：`parallaxUiDepth` 消失、四个区域键改值、新增 `parallaxPluginDepths`，**其余键零漂移**）；`lib/client.js` 重建（2240610 bytes）；四份文档（`HOW-IT-WORKS` 中英 / `CODE-STRUCTURE` / `DSH-UI-INTERFACES` §3.6）同步。

- **「3D 效果」两处小修 —— 设置里的缓动距离一律按百分比显示；界面跟随不再让会话滚动容器长出一条横向滚动条（跨中线发抖的真源）**（用户口径两条：①「关于跨中线发抖，我注意到当光标从右半边移动到左半边时，输入框底部会出现一个黑条，把输入框顶上去，这就是抖动的来源」；②「我希望设置面板中所有缓动设置的单位均使用百分比」）。
  **做了什么**：① **黑条/抖动**：界面跟随挪的是**会话滚动容器里面**的真实元素（`[data-slot="conversation.view"]` / `[data-composer-card]` / 用户气泡），横向位移一旦越出这个 scroller 的 inline-end，宿主写在它身上的 `overflow-y: auto` 会把另一轴的 `overflow-x: visible` 计算成 `auto`（规范：一轴不是 `visible` 时另一轴的 `visible` 计算成 `auto`）⇒ 长出一条**横向滚动条**；它占掉约一条滚动条高的 scrollport，sticky 的输入卡片只能跟着上移 —— 这正是"输入框底部出现一个黑条、把输入框顶上去"；光标跨过屏幕中线时位移换向 ⇒ 滚动条出没 ⇒ 文本区与输入框一起抖（原先那条量化迟滞只是次要项）。`src/styles.js` 视差段加一条 `body[data-we-parallax="on"] [data-conversation-scroll] { overflow-x: hidden; }`：会话内容本来就不横滚（长 token / 宽代码块都在自己的框里滚）⇒ 封掉这一轴，滚动条连出现的机会都没有，scrollport 高度一动不动。② **单位**（⚠️ 这一段当时描述的那条链 —— **面板 ×100 / 存档仍是倍率** —— 已被上面新条目整条退役：现在面板与存档都是"占屏幕最长对角线的绝对百分比"，`parallaxUiDepth` 总倍率也没了；本段只留当时的动机与代价评估）：四个区域距离从"0–3 的倍率、面板显示裸数字"改成**面板按百分比呈现**（0%–300%、步长 5%）：`src/ext-parallax.js` 四行滑杆的域 = 设置域 ×100（`Math.round(sel.parallaxUi*Depth * 100)`），单位用**裸** `"%"`（裸单位才有拖动期就地回显；预格式化整串那口径拖动期数字不跟手，见 `SliderRow` 的 `readout` / `preformatted`），`src/client.js` 四个具名处理器改成 `commitLiveSetting("parallaxUi*Depth", v / 100, live)` —— 与「暗化」「边框」同一条链（面板 ×100、存档仍是小数）。**存档量纲没动**：仍是 `num 0..3` 的倍率 ⇒ 无需迁移、不升 `settingsVersion`、夹具零漂移、也不必重启宿主（纯客户端改动）。
  **为什么**：① 位移落在哪个元素由宿主 DOM 决定，我们改不了它的锚点，但**能**决定它不被撑出滚动条 —— 封轴是唯一"连出现的机会都没有"的做法（比 `::-webkit-scrollbar:horizontal { display: none }` 安全：后者会把那个容器切成自定义滚动条，纵向条外观跟着变）；**否决了**"把位移挪到别的容器"，那等于放弃"整块一起动"（文字会与玻璃脱层）。② 面板里其余缓动项（背景缓动距离 / 界面跟随距离 / 缓动平滑）本来就是 `%`，只剩这四个是裸倍率，用户口径要的是**整个面板统一**；而"存档也存百分比"要动 KINDS + `settingsVersion` 迁移 + 夹具重录（34 处版本号），为一个显示单位不值得，且宿主侧旧白名单会把新量纲当非法值、必须重启桌面端。
  **判据**：`test/verify-scene-live.mjs`：视差 CSS 那条 check 加锚 `body[data-we-parallax="on"] [data-conversation-scroll] { overflow-x: hidden; }`（连同因果注释），第三号模块岛补一条 check —— 四行滑杆各自必须有 `, 0, 300, 5, Math.round(sel.parallaxUi*Depth * 100)` 与 `, "%", "parallax-ui-*-depth"`、四个处理器必须是 `v / 100` 那版，且**不许**再出现旧写法（`sel.parallaxUi*Depth, onParallaxUi*Depth` / `commitLiveSetting("parallaxUi*Depth", v, live)`）⇒ `ALL SCENE-LIVE CHECKS PASSED (464)`（⚠️ 那组"`0, 300, 5` / `v / 100` / 不许出现旧写法"的锚点已被上面新条目整组替换，现为 465 条）；`test/verify-i18n.mjs` 41 条全绿（四条 tooltip 里的出厂值改成 100% / 150% / 60% / 40%，中英同步）；`lib/settings-schema.js` 的 DEFAULTS / KINDS 注释写明"存档是倍率、面板按百分比呈现"；`lib/client.js` 重建。

- **「3D 效果」的界面跟随可分了 —— 四个区域距离各自可调、光标经过屏幕中线不再发抖、左上角「收起侧边栏」在侧栏展开时不再被挤下去**（用户口径三条：① 各个区域的缓动距离支持单独调节；② 光标从屏幕一半移到另一半时，中央文本区与底部输入框会抖动；③ 画面最左上角的「收起侧边栏」按钮在侧边栏展开时错位下移、收起时正常）。
  ⚠️ **本条的设置量纲已被本节上面「缓动距离统一成……百分比」那条整条取代**（四个区域键与 `parallaxUiDepth` 现在是"占屏幕最长对角线的绝对百分比"、滑杆域 `0–10`；本条下文写的 `num 0..3` / 出厂 1 / 1.5 / 0.6 / 0.4 只是当时的样子）。**记这些历史缺陷仍有价值**：`parallaxSnapAxis()` 迟滞、左栏相对定位、`parallaxGroupBox()` 起点改成元素自身这三条**至今仍是现行实现**（现行出厂值 1.2 / 1.8 / 1.6 / 1.4）。
  **做了什么**：① **逐区域距离**：四个新设置键（`lib/settings-schema.js` 的 DEFAULTS + KINDS，`num 0..3`）—— `parallaxUiChatDepth` / `parallaxUiComposerDepth` / `parallaxUiSidebarDepth` / `parallaxUiBubbleDepth`，出厂值就是原先写死在层里的那四个倍率（1 / 1.5 / 0.6 / 0.4）；`parallaxUiDepth` 从此是**总倍率**，有效系数 = `uiDepth × 区域值 × PARALLAX_UI_SIGN`（老设置语义与观感零变化），层里那四个 `PARALLAX_GROUP_CHAT / COMPOSER / SIDEBAR / BUBBLE` 系数常量降为"取不到设置时的兜底"。`src/ext-parallax.js` 在「界面跟随距离」之后加四个滑块（「会话文本区距离」/「输入卡片距离」/「侧栏距离」/「用户气泡距离」，0–3、步长 0.1），`src/client.js` 加四个具名处理器（`onParallaxUi*Depth`）并接进 `ctx`，`src/i18n-copy.js` 同步标签与 tooltip。② **抖动**：`parallaxSnap()` 按 `devicePixelRatio` 四舍五入，而缓动的指数尾巴会在零点附近久留 —— 目标一旦落在 0.25–0.75 设备像素那一段，`Math.round` 就会在两帧之间 0↔±1 反复翻转，`translate` 被反复摘挂，整块界面（以及跟随同一滚动容器的输入卡片）就一下一下地跳（壁纸那一层不量化，所以只有界面抖）。改成 `parallaxSnapAxis(v, prev)`：**逐记录迟滞**（死区 `PARALLAX_GROUP_DEAD_PX = 0.25`、重新起跳 `PARALLAX_GROUP_STICK_PX = 0.75`），记录里存上一次写下的**整数设备像素**，越过迟滞带才改；"归零摘 `translate`"的纪律保留。③ **「收起侧边栏」错位**：侧栏组的落点 = `[data-slot="sidebar"]` 出口的**父元素**（那一列），而 Windows 标题栏模式下宿主的收起按钮是**那一列里的 `position: fixed` 后代** ⇒ 往那一列写 `translate` 就把它变成按钮的包含块、按钮整体下移一个标题栏的高（与 #131 同一类事故）；它此前**只有展开时**错位，是因为展开后子树节点数超过 `PARALLAX_GROUP_SCAN_MAX = 400`、`parallaxGroupBlocked()` 直接放行（那句注释原文就写着超限即照动），收起时子树小、判为 blocked。改法：左栏**改走相对定位**（`position: relative` + `left` / `top`，**绝不写 `translate`**）且**不吃**那条 fixed 后代判定（相对定位不产生包含块，天然安全）。④ 顺带把 `parallaxGroupBox()` 的起点从 `el.parentElement` 改成 **`el` 自身**（自己就有盒子就用自己）⇒ 输入卡片落在卡片本体、24 条气泡各自成为独立位移目标（此前它们先落到会话文本区那个盒子上）；自检那行追加"侧栏走相对偏移"计数（`parallaxGroupCounts()` 的 `offset`）。
  **为什么**：① 那四个倍率原先写死，用户要的是能调；保留 `parallaxUiDepth` 当总倍率，老设置不必迁移、观感不变（新键出厂值 = 旧常量）。② 量化不能去掉（半像素会把文字推糊），抖动只能从"零点附近别来回翻"下手，迟滞是这件事的最小改动；没改成"常驻 `translate: 0px 0px`"是因为属性只要在就成立包含块。③ 相对定位是唯一既能动那一列、又不会给里面的 fixed 后代换锚的形态，代价是那一列每帧一次布局（侧栏小，可接受）；**否决了**"扫描超限就判 blocked"的保守改法 —— 那会让长会话的会话文本区整块不动，是回归。
  **判据**：`test/verify-scene-live.mjs` 源码口径块换锚（`function parallaxSnapAxis(v, prev)` / 迟滞两常量 / 四个区域键与 `parallaxTargetRatio()` 的 `st.chatDepth` 等分支 / `parallaxGroupBox()` 的 `let node = el;` / `parallaxGroupOffsets(kind)` / `parallaxTargetIsOffset(rec)` / `parallaxTargetOffset(rec, x, y)` / `blocked: isGroup && !offsets ? … : false,` / `parallaxTargetOffset` 里那句 `PARALLAX_POSITION_RELATIVE`），假 DOM 台新增左栏断言（左栏**不许有** `translate`、必须有 `position: relative` 与 `left` / `top`；归零时摘 `left` / `top` 但**留着** `position`；展开态那张**含 fixed 后代**的侧栏照动）、迟滞断言（收敛后把光标挪到目标只剩 0.4 设备像素处，仍须保留那一整像素不许摘）与区域倍率断言（把会话文本区倍率置 0 ⇒ 文本区一动不动、左栏照旧有偏移），第三号模块岛补四个滑块的文案锚点；夹具 `test/fixtures/settings-sanitize-golden.json` 两侧期望补入四个键（安全阀 = 其余键零漂移，重录脚本 `.test-cache/regen-golden-uidepth.mjs`）；中英 `HOW-IT-WORKS` / `CODE-STRUCTURE` / `README` / `DSH-UI-INTERFACES` 同步。`npm run verify:all` 全绿。

- **修复 + 增补：「3D 效果」带界面一起动 —— 原先只有输入框在动、方向与背景相反、用户气泡没有独立缓动**（用户口径三条：① 视觉上只有背景和底部输入框在动，但效果不错；② 希望输入框和背景**同向**运动，体现层次与纵深感；③ 把侧栏（先左侧，右侧栏来自 sidebar 模组）、中央文本区（对话文本显示区）与其中的用户对话气泡也**独立**赋予缓动效果）。
  **做了什么**：`src/parallax-layer.js` 三处。① **位移改落在"最近的有盒子的祖先"**：宿主槽渲染器给每个出口写死 `const ANCHOR_STYLE = { display: "contents" }`（注释原文：``display:contents` keeps the wrapper out of layout … so the anchor is purely addressable surface.`），而 `display: contents` 的元素**不生成盒子** ⇒ 往 `[data-slot="conversation.view"]` / `[data-slot="sidebar"]` 上写 `translate` 屏上零效果（这就是"只有输入框在动"的根因 —— `[data-composer-card]` 是有盒子的真卡片）。新增 `parallaxGroupBox(el)`：从出口的 `parentElement` 往上找第一个 `display !== 'contents'` 的祖先（上限 `PARALLAX_GROUP_BOX_MAX_UP = 3`；父元素是 `body` / `documentElement` 就返回 null —— 宁可不动；拿不到 `getComputedStyle` 的挂载台直接返回父元素），只在重扫（帧外、250ms 节流）路径跑。② **方向改成与壁纸同向**：删 `PARALLAX_UI_FLIP`、改 `PARALLAX_UI_SIGN = 1`，`parallaxTargetRatio()` 里 `return st.uiDepth * coef * PARALLAX_UI_SIGN;`。③ **用户气泡独立缓动**：选择器追加 `[data-chat-flow-kind="user"]` / `[data-chat-flow-kind="steering"]`（气泡那个盒子上挂着宿主写的一排语义 data 属性，类名是构建哈希、不可靠），`parallaxGroupKind()` 先认它 → `'bubble'`；倍率 `PARALLAX_GROUP_BUBBLE = 0.4` **叠在会话文本区之上**（合起来 1.4×）；嵌套判定对气泡**放行**（其余"组里套组"仍只留最外侧那一个）；同时新增 `PARALLAX_GROUP_BUBBLE_MAX = 24`，只给 DOM 顺序里**最近 24 条**气泡写位移。自检那行追加界面组清点（新函数 `parallaxGroupCounts()`：会话 / 输入 / 侧栏 / 气泡 / 被 fixed 挡下），挂进 `window.__weParallaxStats.groups`。文案 `src/i18n-copy.js` 三条（模块描述 / 子开关 hint / 距离 tooltip）与 `src/ext-parallax.js`、`src/client.js` 的注释同步。**`src/styles.js` 一行没改。**
  **为什么**：① 这是宿主契约（槽出口只为"可寻址"、刻意不进布局），所以只能把位移交给它下面那个真盒子 —— 它同时解释了"为什么只有输入卡片跟得动"。② 用户口径要"输入框和背景同向、体现层次与纵深感"：同向 + 倍率差才是**镜头横移**（近处的界面比远处的壁纸多走一点）；反向读起来是"界面浮在前面"，与诉求不符。③ 气泡是最贴近眼睛的一层，给它额外位移才有纵深；但它数量不定（长会话上百条）、逐条写 `translate` 会明显吃掉帧预算，所以**截尾只留最近 24 条**。
  **判据**：`test/verify-scene-live.mjs` 源码口径块换锚（`PARALLAX_UI_SIGN` 取代 `PARALLAX_UI_FLIP`、五段选择器整串、`PARALLAX_GROUP_BUBBLE` / `_BUBBLE_MAX` / `_BOX_MAX_UP`、`function parallaxGroupBox(el)` / `parallaxGroupCounts()`、`parallaxTargetAdd(next, prev, el, group, inFrame, kind)`、`if (nested && candidates[i].kind !== 'bubble') continue;`）；假 DOM 用例给每个出口配一个 `display: contents` 的出口 + 盒子父元素（断言位移落在**父盒子**上、出口自己**没有** `translate`），并加 30 条气泡（断言只有最近 24 条动、`dbg.groups.bubble === 24`），方向断言从"与壁纸相反"改成**同向**；`test/verify-client.mjs` 三号模块段的文案字面量同步。`npm run verify:all` 全绿。

- **新增：「3D 效果」能带着界面一起动 —— 输入卡片 / 会话文本区 / 侧栏整块跟光标走，文字与底下的玻璃同进同出**（用户口径：把 3D 感扩到输入框 / 文本区 / 侧栏，希望**文字本体跟着玻璃元素一起动**（组合动））。
  ⚠️ **本条已被本节上面两条整条取代**：`parallaxUiDepth`（界面跟随总倍率）**已删除**（`lib/settings-schema.js` 与 `src/ext-parallax.js` 里现在 grep 0 命中），四个区域距离键改成独立的绝对百分比、KINDS 由 `num 0..6`/`0..3` 变为 `num 0..10`、出厂值现为 1.2 / 1.8 / 1.6 / 1.4。下文保留的是当时的设计与理由（方向、整块位移、不动 `src/styles.js` 这些结论仍然成立）。
  **做了什么**：两个新设置键（`lib/settings-schema.js` 的 DEFAULTS + KINDS）—— `parallaxUi`（`boolFalse`，**默认关**：它动的是真实界面，不该替所有人改画面）、`parallaxUiDepth`（`num 0..6`，默认 `1`：会话文本区为基准，输入卡片 ×1.5、侧栏 ×0.6）。行为层 `src/parallax-layer.js` 多接一条腿：界面组选择器 `PARALLAX_GROUP_SELECTOR`（五段：`[data-composer-card]` / `[data-slot="conversation.view"]` / `[data-slot="sidebar"]` / `[data-chat-flow-kind="user"]` / `[data-chat-flow-kind="steering"]`）、四个倍率常量（`PARALLAX_GROUP_CHAT = 1` / `PARALLAX_GROUP_COMPOSER = 1.5` / `PARALLAX_GROUP_SIDEBAR = 0.6` / `PARALLAX_GROUP_BUBBLE = 0.4`）、方向常量 `PARALLAX_UI_SIGN = 1`（界面与壁纸**同向**；起初那版是 `PARALLAX_UI_FLIP = 1` 反向，后按用户口径改成同向，见上一条）。动的单位是**容器整块**（这样文字才跟着玻璃一起走、且不会因逐节点位移而发虚）；宿主槽出口（`[data-slot=…]`）自己写死 `display: contents`、不生成盒子 ⇒ 位移落在**最近的有盒子的祖先**上（`parallaxGroupBox()`，最多往上 3 层），否则写上去屏上一点不动（见上一条）。为此新增 `parallaxTargetAdd()` 的去重与 `contains()` **剔除嵌套组**（只动最外侧那一个，免得位移叠乘；**用户气泡是故意的例外** —— 它长在会话文本区盒子里，位移**叠**在文本区之上）。界面组另有三条独有规矩：① 位移**量化到整设备像素**（`parallaxSnap()` 按 `devicePixelRatio` 取整 —— 半像素会把文字推模糊）；② 归零时用新函数 `parallaxTargetUnset()` 把 `translate` **整条摘掉**（属性只要在就成立包含块，会改掉固定定位后代的参照，正是 #89 那个坑）；③ 组内出现任何 `position: fixed` 后代（`parallaxGroupBlocked()`，扫描上限 400 个节点）就**整组不动**。界面组**从不提合成层**（`parallaxTargetsSettle()` 跳过，`will-change` 只留给壁纸与吉祥物），帧里也**不重算**子树判定（新冒出来的组先按静止处理，下一帧外再判）。描述符 `src/ext-parallax.js` 加两行：子开关「界面元素跟随」+ 滑块「界面跟随距离」（0–6%、步长 0.5，只在子开关打开时才长出来）；`src/client.js` 加 `onParallaxUi` / `onParallaxUiDepth` 两个具名处理器并接进 `ctx`；`src/i18n-copy.js` 同步六条文案（总开关那句提示也改成"界面整块默认不动（要一起动就打开下面的「界面元素跟随」）"）；模块描述补上"与界面整块"。**`src/styles.js` 一行没改** —— 这一层不加任何 CSS，位移全在 JS 里算完，只借元素自己的独立属性 `translate`。
  **为什么**：用户要的是"文字本体跟着玻璃元素一起动"，那唯一不糊的形态就是**整块容器一起挪**（逐字 / 逐节点动既贵又糊）；三层各给一个倍率是为了有一点纵深（输入卡片最近、侧栏最远），方向与壁纸相反是因为界面在壁纸上层。默认关 + 一个独立子开关：它动的是**真实界面**（输入框在光标附近，感知比壁纸强得多），出厂开关不该替所有用户改画面 —— 与上游"效果类功能默认关"的口径一致。
  **判据**：`test/verify-scene-live.mjs` 的视差源码口径块新增约 22 条界面组锚点（选择器 / 四个倍率 / `PARALLAX_UI_SIGN` / `parallaxSnap` / `parallaxGroupBlocked` / `parallaxTargetUnset` / `if (rec.group) continue;` / `parallaxTargetsRefresh(now, inFrame)` 的行内标记），假 DOM 用例改成**按选择器分流**并新增界面组断言（三条位移都是整数、符号与壁纸层相同、侧栏比会话文本区近、嵌套组与含 fixed 后代的输入卡片组**没有** `translate`、四个组都**不带**合成层类、指针回到屏幕正中后四个组的 `translate` **整条摘掉**）；`test/verify-client.mjs` 三号模块段补上"面板里出现新开关 + 滑块范围 0..6 + 默认关时连文案都不出现 + 关掉子开关或总开关后界面那两行收起"；设置夹具 `test/fixtures/settings-sanitize-golden.json` 从 client / host 两侧期望补入这两个键（安全阀 = 其余键零漂移）；中英 `README` / `HOW-IT-WORKS` / `CODE-STRUCTURE` 同步（并把 README 里那段"只写几个 CSS 变量 / 帧率封顶 60Hz"的过期表述一并改成当前机制）。`npm run verify:all` 全绿。

- **优化：「3D 效果」的每帧开销再降一档 —— 位移不走继承型自定义属性，改成每帧直接写那几层自己的 `translate`**（用户反馈：柱状图模块退役后流畅了很多，但快速移动光标时硬件占用率波动仍明显）。
  **做了什么**：改动只在 `src/parallax-layer.js`（行为层）、`src/styles.js` 的视差段与 `scripts/build-client.mjs` 的注入标记，**没有新设置键、没有新文案、界面一行没动**。① **写入机制换掉**：原先每帧把"位移步长"写成 CSS 自定义属性 `--we-parallax-x / -y`（再由样式表用 `calc()` 乘各层系数），而**自定义属性是继承的** —— 写一次就让整棵子树进入"待重算样式"，光标一动就是 60 次/秒；现在每帧把**算完乘完的最终位移**用 `style.setProperty('translate', 'X.XXpx Y.XXpx')` 直接写进 `.we-layer` / `.we-rope` 自己的 **CSS 独立属性 `translate`**（两位小数；值没变就不写，比对用的是自己攒的快照、不读 DOM），**每帧零自定义属性写入**；body 上只剩一个"壁纸补边系数" `--we-parallax-bg`（只在设置变了时写一次），样式表那条静态 `scale: calc(1 + var(--we-parallax-bg, 0) / 50)`（⚠️ 本条写这条时是 `/ 100`，除数已由本节上面"百分比"那条改成 `50`；这里按现行值记）照旧。② **去掉 60Hz 人工封顶**（跟随显示器真实刷新率；缓动本来就按真实 dt 折算，手感不变，高刷屏不再隔帧跑）。③ **帧里零测量**：视口尺寸只在起帧 / resize 时读，目标（那两层）重扫从帧内挪到起帧路径并节流 250ms，帧内不再 `querySelectorAll`、不再读 `window.innerWidth`。④ **页面不可见时不排帧**（`document.hidden` 直接返回，`visibilitychange` 回来再接上）。⑤ 新增**自检开关**：`localStorage.weParallaxDebug = '1'` ⇒ 记每帧回调耗时 / 写入次数 / 帧间隔，收工时打一行 p50 / p95 / max + 长帧（≥8ms）计数并挂 `window.__weParallaxStats`。
  **为什么**：用户口径是"柱状图退役后流畅了很多，但硬件占用率波动仍明显"—— 剩下的大头正是"每帧写继承型自定义属性"这条：它的代价不随"要动几个元素"变化，而随**继承它的子树规模**变化（侧栏 + 会话区几千个节点）；而位移只影响那几个元素自己的呈现，写在自己身上就够了。另外帧内那几次测量（视口 / 目标重扫）把布局查询和样式写入交错在一起，正是"偶尔卡一下"的形态。
  **判据**：`test/verify-scene-live.mjs` 的视差源码口径块换锚（新增 `const PARALLAX_TRANSLATE = 'translate';`、`const PARALLAX_VAR_BG = '--we-parallax-bg';`、`parallaxVarOn(el, PARALLAX_TRANSLATE, value);`、`function parallaxApply(st)` / `parallaxTargetKind` / `parallaxTargetsEnsure` / `parallaxHidden` / `parallaxDebugSync` / `parallaxDebugFrame` / `parallaxDebugReport`、`visibilitychange` 被动监听；删掉 `PARALLAX_VAR_X / -Y`、`PARALLAX_MIN_FRAME_MS` 与帧内那三行封顶 / 两条写入，并把 `--we-parallax-x / -y` 加成反向断言），CSS 段判据同步（只剩那条补边 `scale` 与 `will-change: translate`，`--we-parallax-x / -y / -mascot` 必须消失），假 DOM 运行时用例改成断言**元素自己的 `translate`** 与 body 上只剩 `--we-parallax-bg`，并新增一条自检断言（开 `localStorage.weParallaxDebug` 后收工时 `window.__weParallaxStats` 里有帧统计）；`scripts/build-client.mjs` 的注入标记同步（缺标记直接拒绝构建）。中英 HOW-IT-WORKS / CODE-STRUCTURE 同步（行为层"两条腿"的表述从"写 CSS 变量"改成"直接写独立属性"）。

- **新功能：标题栏液态玻璃 —— 与左侧栏同色的玻璃接管**（用户口径："对标题栏进行玻璃化，跟左侧栏液态玻璃一样，不要有任何色差"）。
  **做了什么**：新设置键 `titlebarGlass`（默认关，乙类 = 关时恢复壳层原生不透明底），玻璃 UI 面板在左侧栏液态玻璃同组下加四行（主开关 + 标题栏玻璃·独立配置 + 透明度 / 雾化两滑杆）；`GLASS_CHILDREN` 登记 `panelOff: true`，`DEFAULTS` / `KINDS` / 预设固定键同步 ⇒ 存量配置与出厂预设**零迁移**。标题栏**不是元素**，是 AppFrame 那条 grid 容器的伪元素（`[data-windows-titlebar] .pI_x6G_frame:before`）—— 初版挂的壳层类名 `.dshDesktopFrameTitlebar` 在当前 app.asar 全量字面扫描里**命中 0 次**（开关能开、变量全对，CSS 却永不匹配），锚点改为 `div[class*="pI_x6G_frame"]`（哈希**子串**匹配，跨版本漂移时最坏是"本块不生效"、绝不误伤），外加 `html[data-windows-titlebar]` 与 `data-we-adapter^="desktop-"` 两道形态门。
  **为什么**：① 底色与模糊必须**分住两个伪元素** —— 底色 / 釉光 / accent 留在壳层那条 `::before`，`backdrop-filter` 另起 `::after`（几何对齐 `inset:0 0 auto` + 标题栏高度，`pointer-events:none` 不挡 `-webkit-app-region: drag`）；左栏是「底色在元素、模糊在其 ::before 之上」⇒ `F(壁纸 ⊕ 底色)`，两者同写一个伪元素会得到 `底色 ⊕ F(壁纸)`，底色不过 saturate/brightness ⇒ **数值全同仍出色差**。② 釉光改**恒定 `sheen-a`**：停靠点是百分比，同一条三段渐变装进 40px 与 1111.33px 两个盒子算出 均值 0.0495 vs 0.0967、交界台阶 0.05 白釉。③ 按左栏 S2 同一政策**不画底分割线**（那条线本身就是色差）。④ **逗号列表一损俱损**：把未经引擎验证的嵌套 `:has()` 座位锚与哈希锚写进同一条规则，壳层 Chromium 拒绝前者 ⇒ 整条规则**连同能命中的那条一起被丢弃**，症状与"锚点没选对"完全同形，静态扫描 / 正则判据 / css-select 全都判不出来。
  **判据**：`verify-glass-compositing` 新增 TB1–TB6（死锚点 / 两层互斥 / 壳层门 / 六条同色声明 / 恒定釉光 / 不画分割线），负对照一律跑**真实判据**而非字面量断言；`verify-glass-surfaces` 登记 `titlebar-override` 面与 `--we-titlebar-*` 私有变量组；`verify-presets` 固定键表、`settings-sanitize-golden` 重录（3 键 × 18 用例 × 2 侧）。

- **交付后审计一轮：A1 / A6 两处真缺陷 + F1 一处同源回归 + 一批过期注释与文档口径修正，CI 在本机按 workflow 逐步骤复跑全绿**（本节上面那五条 + 标题栏玻璃落地之后的独立审计：主代理逐行读行为层，另有两路独立审计分别读样式 / 玻璃与文档 / 注释；**没有**改任何出厂开关、**没有**动量纲、**没有**升 `settingsVersion`）。
  **做了什么**：① **A1**：`parallaxStop()` 的收尾自检恒报 0 组 —— 它在 `parallaxTargetsClear()` **之后**才调 `parallaxDebugReport()`，而组数正是从已经清空的那张表数出来的；现在清表前先把 `parallaxDebugOn ? parallaxGroupCounts() : null` 拍成快照、`parallaxDebugReport(groupCounts)` 收下它（诊断关闭时不开销、也不改打印形态）。② **A6**：`parallaxPluginEffectiveGroups()` 会把同一个落点的多个槽键**各列一行**，而 `parallaxTargetAdd()`（`src/parallax-layer.js:740`）第一行就按 `el` 去重 ⇒ **屏上只有先入列的那一条拿到位移**，面板名单却把所有行都画出来 —— 破坏"面板列出来的每一行都有落点 / 面板名单与屏上同源"这条硬不变量（两个函数的注释都把它写成不变量）；现在该函数末尾按**落点**去重（`const boxes = []; … if (!box || boxes.indexOf(box) >= 0) continue; … return kept;`），纯新增、零行为回归（被丢掉的那些记录本来就被 `parallaxTargetAdd()` 丢掉）。③ **F1**：深色主题的标题栏 `::before` 仍是**三段渐变**（`…sheen-a 0% / …sheen-b 38% / …sheen-c 100%`），而亮档早已改成单停靠点 `sheen-a` —— 同一张表、同一个盒尺寸色差问题又长回来了；判据 `verify-glass-compositing` 的 `tbLightRule` 又显式排除 `data-ds-dark-theme` ⇒ **暗档零覆盖**。现在暗档也改成单停靠点 `sheen-a`，并补 **TB4b** 两条判据（暗档同样恒定 + 负对照"三段渐变必须判红，且亮/暗两条釉光声明逐字同源"）。④ **过期注释与文档口径**（8 处）：`src/glass.js:196-199` / `lib/settings-schema.js:256-264` 与 `:545-551` 仍写已消失的类名 `.dshDesktopFrameTitlebar` / 变量 `--dsh-desktop-frame-fill` 与"顶栏底分割线"（现锚点是 `div[class*="pI_x6G_frame"]` 哈希子串，底分割线是刻意不画）；`src/glass.js:104` 与 `src/effects.js` 两处仍写"滑杆 0–60"（滑杆域早已是 0–100）；`src/styles.js:3257` 的"上面那条补边规则"指代写反（规则在注释**下面**）；`README.md:121` / `README.en.md:128` 的"总倍率之下还有四个滑块"和"光标走完一整条对角线"两处口径（总倍率 `parallaxUiDepth` 已退役、位移口径是"光标贴在屏幕角上"）；`docs/DSH-UI-INTERFACES.md` §2.2 锚点表补登 `data-windows-titlebar` 形态门、§2.3 补"完整哈希子串"这第三种形态并注明**棘轮盲区**（`test/compat-harness-surfaces.mjs` 的抽取正则只收 `[class*="_xxx"]`，抓不到 `pI_x6G` 这种完整哈希名，只有 `verify-glass-surfaces` 的 `anchors` 单独兜）；`docs/CODE-STRUCTURE.md` §3.1 补登 `glass-panel` / `glass` / `preset-store` 三个模块；`docs/en/HOW-IT-WORKS.md` 的"3D depth 是第二个模块"改成与注册表一致的**第三个**，并修好 `:198-210` 的缩进与两处被切碎的换行；中英 CHANGELOG 给 r2 节里两条**已被取代**的旧条目加了 ⚠️ 取代注（含 `parallaxUiDepth` 已删除、KINDS 由 `num 0..6` 变 `num 0..10`、现行出厂 1.2 / 1.8 / 1.6 / 1.4），并把被取代条目里的 `scale: … / 100` 按**现行值**改记 `/ 50`。
  **为什么**：这一批全是"读者照注释/文档做会做错"或"判据看着有牙其实只覆盖一半"的那一类；A1 / A6 是行为层的真缺陷（诊断恒报 0、面板与屏上不同源），F1 是刚修过的同源回归又长回来。**明确不改**：`src/parallax-layer.js` 的 `PARALLAX_GROUP_SCAN_MAX = 400` 超限即放行（刻意的性能闸）、插件深度表只增不减、`map` 档的通用 sanitize、"面板名单是渲染期快照"这四条（理由见本节「审计一轮」那条）。
  **判据**：`test/verify-scene-live.mjs` **`ALL SCENE-LIVE CHECKS PASSED (472)`** —— A1 那条结构判据本身**过期**（它钉 `function parallaxDebugReport()`，签名收参后必红 ⇒ 属判据该升级，不是实现错），已升级成三条（签名收 `groupCounts` / 快照行**必须在 `parallaxTargetsClear();` 之前** / 调用点收快照），并给 A6 补三条结构锚（`const boxes = [];` / `if (!box || boxes.indexOf(box) >= 0) continue;` / `return kept;`）。`test/verify-glass-compositing.mjs` ⇒ `ALL GLASS COMPOSITING CHECKS PASSED`（新增 TB4b 实测能区分好坏）。`lib/settings-schema.js` 只改注释（键集与值零改动）。`lib/client.js` 重建：`test/verify-client-sync.mjs` ⇒ `CLIENT SYNC CHECKS PASSED (4)`；把 `core.autocrlf` 关掉后 `git diff --exit-code -- lib/client.js` 在**干净 HEAD 树**上 exit 0，且重建后仍是 exit 0 ⇒ builder 幂等、零字节漂移。`verify:docs` 五支全绿、`npm run smoke` exit 0、`git diff --check` exit 0。**CI 等价性**：把 `.github/workflows/verify.yml` 的每一步在本机复跑（build / verify / verify:bridge --provision / smoke / verify:docs / 两条 diff 门）**全部 exit 0**；`verify:bridge` 在放宽沙箱（= CI 姿势）下 42 通过 / 0 失败 / 1 平台跳过；`test/verify-contracts.mjs` ④⑤ 全绿。唯一一处"本机红 / CI 绿"是 `test/verify-system-fonts.mjs` 的「真子进程：多字节字符跨 chunk」—— 受限沙箱禁止建管道 stdio（`spawn EPERM`），放宽沙箱实测 `SYSTEM-FONT CHECKS PASSED (94)` ⇒ CI 上本来就绿；已照 `verify-media-bridge` 的既有规矩给它加**环境跳过**档（不静默算过、也不冤枉判红），受限环境现在报 `SYSTEM-FONT CHECKS PASSED (93) —— ⚠️ 1 条环境跳过`。`package.json` 未改、版本仍是 `1.3.0-r2`。
- **合并跟修一轮（维护者审 PR #147 时发现的 1 处应修 + 3 处口径不符，随合并一起落）**
  **做了什么**：① **P1** `src/parallax-layer.js`：`parallaxDebugSync()` 的"最多每秒重读一次"节流判据里带了 `parallaxDebugOn &&` —— 只在**开着**时短路，默认态（关）下一次手势的每一起帧都落到 `localStorage` 读（60~144 次/秒），与函数头注释矛盾；现在节流不看当前状态（判据只比时间），一行修复。② **P2** `src/live-layer.js`：心跳自愈注释承诺"暂停/隐藏期不自愈"，但**网页**壁纸的 `alive` 只问 iframe 加载与否（`iframeLoaded`），暂停期也为真；自愈判据补上 `isEffectivelyPlaying()`（场景暂停期 `alive` 本就为假，行为零变化；网页暂停期现在确实不自愈、恢复播放后的第一拍再自愈，与注释语义对齐）。③④ **P2** 过期口径两处：`lib/settings-schema.js` 视差段的单位注释还在写已退役的旧口径（"走完一整条对角线"少一个 ×2）与"放大 1+pct%"（现为 1+pct/50），`src/client.js` 视差订阅处注释还在写"只写 CSS 变量 / 帧率封顶 60Hz"（现为直写 `translate` / 跟随真实刷新率，且随内联进 `lib/client.js` 一起发布）；另有 `docs/wip/SLIDER-CONSOLIDATION.md` 把 verify-system-fonts 写成"必然 EPERM 失败"（同一棵树里已带环境跳过档）。
  **为什么**：P1 是输入路径上的真实每帧开销（且默认态就中）；其余三条按本仓"注释与文档口径错误算真缺陷"的规范收口 —— 全部是审阅 #147 合流体时发现的，不影响三位贡献者交付的主体。
  **判据**：`npm run verify` / `verify:docs` / `smoke` 全部 exit 0；`lib/client.js` 重建后 `git diff --exit-code` 通过（builder 幂等）。**判据升级一处**：`test/verify-scene-live.mjs` 的自愈结构判据原本钉死旧条件串 `if (alive && !selection.sceneLiveActive)`，②改了条件后必红 ⇒ 升级为新形态 `if (alive && isEffectivelyPlaying() && !selection.sceneLiveActive)`（负对照不变：退回分支条件形态与"无条件置真"形态仍须被判红），总数仍 472。P1 那条路径无独立判据（诊断默认关、且"读了几次 localStorage"本就不可断言），注释口径靠同文件其余结构锚兜着。

- **审阅 P3 六条清账：超限组的全量枚举收成冷却缓存、插件距离两条取数路径合成一个取值器、删掉一条永不为真的死分支、补上暗档顶栏与暗档左栏的同色对照、两处看护共用同一个存活判据**（来源：维护者审 PR #147 时列出的六条 P3 备注 —— 均不阻断合并、留作后续；**没有**改任何出厂开关、**没有**动量纲、**没有**升 `settingsVersion`）。
  **做了什么**：① **P3-1 超限组不再每 250ms 白付一次枚举**（`src/parallax-layer.js`）：`PARALLAX_GROUP_SCAN_MAX = 400` 这条性能闸的口径是"没验完 ⇒ 照动"，但旧写法**先枚举、再发现超限、然后放行** ⇒ 长会话里那一组每一轮重扫都白付一遍 `querySelectorAll('*')`。现在新增 `parallaxGroupNodes(el)` 与 `PARALLAX_GROUP_SCAN_COOLDOWN_MS = 1000`、`WeakMap` 缓存 `parallaxGroupSizes`：**数出来超限**的组在 1s 内连数都不数，直接返回 `null`（调用方按"没验完"算 ⇒ 与旧口径逐字同义）；缓存只在**真数出来**时更新 ⇒ 子树缩回可验范围后的第一次调用就会重验。`parallaxGroupBlocked()` 顺带从"枚举两次"收到"枚举一次"。
  ② **P3-2 插件距离的兜底一致化**（同文件）：`parallaxMaxPercent()` 那遍把非有限值钳成 **0**，而 `parallaxTargetRatio()` 自己 `hasOwnProperty` + clamp 到 `PARALLAX_PLUGIN_DEFAULT` ⇒ 同一个坏值两条路给出不同答案，`pctMax === 0` 让那一组的缓动走"一次落位、收工"的短路（插件表是 `map` 档、只浅拷贝不校验值，手改 `settings.json` 即可触发）。现在两条路共用新取值器 `parallaxPluginDepth(st, slot)`：缺键 / 非有限值 / 超范围从此**同一个结果**。
  ③ **P3-3 删掉一条永不为真的死分支**（同文件）：`parallaxGroupKind()` 里那句"在 **className** 里找 `data-composer-card`"（属性名不会长在类名里）整条删除，composer 身份只认 `hasAttribute('data-composer-card')`。
  ④ **P3-4 暗档顶栏的同色对照 + 一条恒真的负对照**（`test/verify-glass-compositing.mjs`）：TB2c 的负对照首子句此前拿**字面量**去测 `/blur\(/`（恒真），现在抽出真谓词 `tbBeforeHasBlur(body)` 并喂**真规则的变异副本**；新增 **TB4d**：暗档顶栏与暗档左栏的**六条颜色声明**（底色 + 五条 accent 映射）逐一对照必须全等 —— TB4 的孪生对照此前只覆盖浅档、TB4b 只管釉光，暗档的底色与 accent 一直是零覆盖；比较与负对照共用同一个差异函数 `darkDiffsOf`（归一 `--we-surface-tint-light` / `-dark` 与 `rgba(255,255,255,0.04)`）。
  ⑤ **P3-5 两处看护共用同一个存活判据**（`src/live-layer.js`）：抽出模块级 `liveHeartbeatAlive(frame, stats, wstate, isWeb)` 与别名 `liveHeartbeatReady`。心跳那一拍的自愈按 `iframeLoaded`（网页）判断"还活着"，而 `syncLayers()` 的领养补挂那一跳用 `liveFrameReady()`（网页要 `getState` 可读）⇒"可达但还没加载完"的窗口两边都不管、只能等下一次 emit 补挂。现在两处**同源**（场景分支与 `liveFrameReady` 的场景语义逐字同义 ⇒ 场景侧零行为变化），`liveFrameReady` 只留给 `scheduleLiveMount()` 那一跳。
  ⑥ **顺手发现的既存缺陷：`src/live-layer.js` 的导出表里有两个名字不是它声明的**（`retireFadingLayer` 与 `nudgeWallpaperRepaint` 其实住在 `src/layer-core.js`）。内联构建把整块 `export` 剥掉、又把所有模块并进同一个作用域 ⇒ 调用点照样解析、`lib/client.js` 一切正常，**但这层"导出自己没声明的名字"在任何真 ESM 语境下都是链接期错误**：`node --check src/live-layer.js` 一直报 `SyntaxError: Export 'nudgeWallpaperRepaint' is not defined in module`。两个名字从这张表里删掉（它们由 `src/layer-core.js` 自己的导出表给出），模块现在能作为真 ESM 正常解析。
  **为什么**：① 这道闸该省的是**枚举本身**、不是枚举的结论；② 是同一个值被两条路两种解释（一半信 clamp、一半信直读），最坏情形就是维护者点出的"那一组缓动静默失效"——用户看到的只是"这一组不动了"；③ 留着这条死分支会让读者以为 className 也是一种识别形态；④ 是"负对照拿字面量测正则"与"新加的暗档判据只覆盖釉光一半"这两类**看着有牙**的缺口；⑤ 同一条语义在两处各写一份内联判据，缝正好落在"窗口可达但没加载完"这个真实存在的时间窗上；⑥ 是"构建侥幸替代码兜着"——只要有人把 `src/live-layer.js` 当模块真 import（或在编辑器里按 ESM 解析），它当场就是一个语法级的错。
  **判据**：`test/verify-scene-live.mjs` ⇒ **`ALL SCENE-LIVE CHECKS PASSED (476)`**（472 → 474 → 476）—— 三条行为腿 + 两条结构反证。腿 ①：超限组（`box.querySelectorAll` 返回 401 个节点）在两次重扫里**只数一次**、空转 1060ms 后必须重数（实测 `{"first":1,"second":1,"after":2,"within":340}`）；腿 ②：组件身份只认属性 —— 同一个 `data-composer-card` 组**撤掉 fixed 后代后必须立刻拿到自己的 1.5% 距离**（证明此前那一组不动来自 fixed 判定、不是没认出身份）；腿 ③：插件槽的**非有限值**与**缺键**并排比位移必须逐字相同、**超范围值**必须按上界钳（42 ⇒ 10%）。结构反证一：`!parSrc.includes("cls.indexOf(' data-composer-card ')")` —— 那条死分支永远不成立、复活它不改变任何可达形态，行为腿抓不到，只能靠结构钉。结构反证二：新增 `liveFlagChecks.exportListHonest(body)` —— 把 `src/live-layer.js` 导出表里的每个名字逐个回头问"本文件声明过吗"（注释先剥掉再按逗号切，否则块内一行 `// …` 会把后面的名字连成一块、拼出非法正则），并配一条负对照：合成的"抄了别人名字"源码（含**历史形态** `retireFadingLayer, nudgeWallpaperRepaint`）必须被判红、干净表必须收。`test/verify-glass-compositing.mjs` ⇒ `ALL GLASS COMPOSITING CHECKS PASSED`（TB2c 改为喂真规则的变异体；TB4d 的差异算法实测能区分好坏）。**有牙的独立证明（变异体，`.test-cache/mutate-p3.mjs`）**：A 把冷却改成 `0` ⇒ 行为腿判红；B 复活死分支、C 把"最大距离"那一遍退回旧兜底 ⇒ 结构判据判红；三者还原后全绿。⚠️ 该脚本一度因锚点写成 `\n`（本仓 `core.autocrlf=true` ⇒ 盘上是 CRLF）而**静默不生效**、测的是没变异的树 ⇒ 假绿；现在必须核 `MUTANT …: applied` 这一行才可信。⑥ 的前后对照直接可复现：修前 `node --check src/live-layer.js` 报 `Export 'nudgeWallpaperRepaint' is not defined in module`，修后同一份源码作为真 ESM 解析通过、`names exported but not declared: 0`。`lib/client.js` 重建（与 `src/**` 同提交，`test/verify-client-sync.mjs` ⇒ `CLIENT SYNC CHECKS PASSED (4)`）。全链 `build` / `verify` / `verify:docs` / `smoke` / `verify:bridge` / `git diff --check` 全部 exit 0。**纯客户端改动 ⇒ 刷新页面即可**。

- **修复：插件每次重载都在同一 document 里再叠一对窗口监听与一个 60s 定时器 —— 诊断与「重启恢复」监听从模块顶层搬进 `ctx.effect`（fiber 作用域）**（来源：排查上游 issue「播放中 composer 每 0.9–3.6s 失焦、暂停即恢复」时取到的实测旁证；全仓**没有**任何周期性焦点调用，焦点问题本身另案，本条是那次排查中确证、可独立修的缺陷。**没有**改出厂开关、**没有**动量纲、**没有**升 `settingsVersion`）。
  **做了什么**：① **现象与实测**：`src/live-layer.js` 有四段写在**模块顶层**的 `try{}catch{}` 副作用 —— 启动留痕的 `setTimeout(…, 0)`、`window` 的 `focus`/`blur`、`document` 的 `visibilitychange`、60s `window.setInterval` 心跳 `beat`；把判据落到这份文件上时又抓出第五段：`:1447-1452` 给「重启恢复」档用的 `window` `pointerdown`/`keydown`（`once`）。宿主每次 revision 变化（**只改 mtime / 大小等元数据也算**）都会 `tearDownEntryFiber` 后用新模块体重跑一遍，而这些定时器与监听器不挂 fiber、永不释放 ⇒ 本机诊断实测同一 document 里出现 **214 个 `[we-live d8·pXXXXX]` 页 id**、一次真实 window blur 被 **117 份实例各记一条**（60s 心跳与「每行一个像素请求」的 `/diag` 上报同样被乘成 ~100×）。
  ② **修法**：新增 `installLiveDiagnostics()` 与 `installLiveBootRestore()`（`src/live-layer.js`）：注册一律经内层 `cleanups` 记账（`listen()` 包 `addEventListener`/`removeEventListener`，定时器配 `clearTimeout`/`clearInterval`），返回值即一次性注销器；`liveDiagUninstall` 只记「上一份装到哪」，重复 apply 先拆旧再装新（不叠加）。`src/client.js` 的 `apply` 新增 "2e." 段：`ctx.effect(() => installLiveDiagnostics() || undefined)` 与 `ctx.effect(() => installLiveBootRestore() || undefined)`；两个新名字进 `src/live-layer.js` 的导出表（`exportListHonest` 仍绿）。
  ③ **语义零变化**：日志文案、60s 拍、`once` 语义、boot 留痕逐字保留，只把注册点从模块顶层挪进 fiber。
  **为什么**：官方插件契约原文（`dsh-agent-preset/skills/cordis-plugin-development/references/ui-plugin.md`）："Keep factories free of side effects. Register styles, timers, listeners and other resources inside `apply` with `ctx.effect`/`ctx.on` and return their cleanup functions."；这条泄漏与 composer 失焦的因果尚未确证，但它本身是一处确证的资源泄漏（每个实例多一对窗口监听 + 一个 60s 定时器，诊断每行还发一个像素请求）—— 至少是「越用越吵」的放大器，且直接违反宿主契约。
  **判据**：`test/verify-scene-live.mjs` ⇒ **`ALL SCENE-LIVE CHECKS PASSED (480)`**（476 → 480）—— 新增 `liveFlagChecks.topLevelText()`（**只挖函数体、不挖普通块**）与两条结构判据：`moduleScopeQuiet`（`src/live-layer.js` 的模块顶层不得出现 `addEventListener`/`setInterval`/`setTimeout` 调用）、`installersWired`（`src/client.js` 必须以两条 `ctx.effect(() => install…() || undefined)` 接入），各配一条负对照：合成的「历史形态」（模块顶层三段副作用）必须判红、装进函数的形态必须收；「裸调用安装器」与「只接一半」必须判红。⚠️ 判据第一版按花括号配平深度判「模块顶层」，而顶层 `try { setTimeout(…) } catch {}` 里的调用深度为 1 ⇒ **恒绿（漏判）**；必须先切出函数体再判。**有牙的独立证明（变异体，`.test-cache/mutate-diag.mjs`）**：A 把 60s 心跳搬回模块顶层 ⇒ 主判据与负对照同时判红（`moduleScopeCalls=1`）；B 把 `ctx.effect` 接线拆成裸调用 ⇒ 接线主判据与负对照判红（`src=false`）；还原后全绿。⚠️ 该脚本的还原一度按**子串**替换，而 `let liveDiagUninstall = null;` 恰好是变异行的前缀 ⇒ 还原把变异又写回文件（还写进了字面量 `{NL}`）；现在一律按**整行 trim 相等**操作并带 `status` 自检。`lib/client.js` 重建（与 `src/**` 同提交，`test/verify-client-sync.mjs` ⇒ `CLIENT SYNC CHECKS PASSED`）：bundle 里 `function installLiveDiagnostics()` 在 `lib/client.js:17628`、`function installLiveBootRestore()` 在 `:18785`、接线在 `:26009-26010`。全链 `build` / `verify` / `verify:docs` / `smoke` / `git diff --check` 全部 exit 0。**纯客户端改动 ⇒ 刷新页面即可**。

- **修复（同类第二处）：「隐藏期轮换推迟到可见时补做」的两条监听也在模块顶层 —— 与上一条同型，一并搬进 `ctx.effect`，判据扩到整个 `src/**/*.js`**（同上：排查上游 issue「播放中 composer 每 0.9–3.6s 失焦、暂停即恢复」时顺出来的确证缺陷；**没有**改出厂开关、**没有**动量纲、**没有**升 `settingsVersion`）。
  **做了什么**：① 原形态 `src/client.js:1355-1362` 在**模块顶层**的 `try{}catch{}` 里给 `document` 挂 `visibilitychange`、给 `window` 挂 `focus`（兜底，注释原文「事件缺失也不会把待命丢掉」），回调是 `resumePendingRotation()`；每次 revision 重载同样再叠一对、永不摘除。② 抽出 `installRotationResumeListeners()`：两条监听经内层 `bound` 记账，返回值即一次性注销器（逐条 `removeEventListener`）；`apply` 的 "2e." 段加第三条 `ctx.effect(() => installRotationResumeListeners() || undefined)`（该段注释同步写明两处现场）。③ 语义逐字不变：仍是同一个 `resumePendingRotation`、同样两条事件、同样的兜底说明。
  **为什么**：上一条修完之后，对全 `src/**/*.js`（递归 38 个文件）的模块顶层普查（`.test-cache/scan-toplevel.mjs`）**只剩**这两处 `addEventListener` 还在模块顶层 —— 同型、同因、同后果：模块体每次重跑都多一对监听，一次 `visibilitychange`/`focus` 被 N 份实例各跑一遍（本次实测同一 document 已有 214 个页 id）。只修一处而不把判据铺到整棵树，同样的写法下一次还会长回来。
  **判据**：`test/verify-scene-live.mjs` ⇒ **`ALL SCENE-LIVE CHECKS PASSED (483)`**（480 → 483）—— 新增主判据「`src/**/*.js` 任何模块顶层的 `addEventListener`/`setInterval`/`setTimeout` 都判红」（`liveFlagChecks.srcTreeOffenders()` 递归全树、返回违规文件清单，空数组才算过）；`installersWired` 从两条接线收紧到**三条**（漏 `installRotationResumeListeners` ⇒ 「隐藏过再回来」不再补做轮换）；负对照加两条：`src/client.js` 的历史形态（模块顶层那对监听）必须判红、只接两个安装器必须判红。**有牙的独立证明（变异体，`.test-cache/mutate-diag.mjs` 扩到 A/B/C/D）**：C 把这对监听搬回模块顶层、D 拆掉第三条接线；四条同时施加 ⇒ **7 条判据判红**（含全树主判据与两条新负对照，`treeOffenders=2`：`src/client.js` + 被 A 变异的 `src/live-layer.js`），`restore` 后 483 全绿、`git diff --check` exit 0。`lib/client.js` 重建（与 `src/**` 同提交，`test/verify-client-sync.mjs` ⇒ `CLIENT SYNC CHECKS PASSED`）。**纯客户端改动 ⇒ 刷新页面即可**。

- **修复：未重启的旧后端把公告配图探针变成刷屏机 —— 探针加「同页面只探一次」的结论缓存 + 指数退避（90 秒内最多 8 拍，旧口径 61 拍）**（来源：用户贴出的桌面客户端 F12 控制台 —— 约 150 行 `about-qr/update-notice.jpg` 404 红字；`test/verify-about.mjs` 78 → 87 条）。
  **现象**：面板每挂载一次，探针就按固定 1.5s 一拍、连打 90 秒 = 60 个 `HEAD`；前后点开几回，「关于」面板与公告的挂载叠加起来把控制台刷成 150+ 行 404。（404 本身是这台机器**还没重启**的既知窗口期：路由白名单只在 DSH 进程启动时读一次，见本节上一条；重启即 200。请求自带 `no-store` / `no-cache`，所以这不是缓存问题，是**噪音**问题。）
  **修法**：① **结论是页面级事实**：新增模块级 `let noticeArtVerdict = ""`，拿到 `ready` / `timeout` 就写进去；组件 effect 一进门先读缓存，有结论直接落座、**一个请求都不发**（面板关掉再开、切会话回来都不复探）。② **指数退避**：固定间隔常量 `NOTICE_ART_POLL_MS` 整体退役，改由纯函数 `noticeArtSchedule(waits, backoff)` 生成时刻表 —— 表 `[1500, 3000, 6000, 12000, 30000]`、末档封顶、末拍被时限截短（保证"等满 90 秒"那一拍真的发出，降级紧跟其后）⇒ 实测 8 拍 `0 / 1.5s / 4.5s / 10.5s / 22.5s / 52.5s / 82.5s / 90s`（旧口径 61 拍）。③ 门控、img 只在 ready 渲染、"已关公告零请求"这些既有语义**一字未动**。
  **为什么**：洪泛的成因是"把页面级事实当成每次挂载都要重新确认的运行时状态"——退避治的是同一次等待里的密度、缓存治的是跨挂载的重复，两条一起才把上界从「60 × 挂载次数」压到「8 × 1」。**不改**：仍在 90 秒后降级弹出（异常安装 / 死活不重启的用户照样看得到公告，只是无图）。
  **判据**：`test/verify-about.mjs` ⇒ **`ABOUT (stars + QR) CHECKS PASSED (87)`**（78 → 87）—— 新增 ⑤b 节。不读第二份字面量：退避表 / 时限 / 时刻表函数都从源码现取，再**跑真函数**算"一个时限里到底发几个请求"（8 拍，4 ≤ n ≤ 10；末拍落点与时限相差 ≤1ms）；"时刻表建了但组件仍按固定间隔排拍"另有一条接线判据（`setTimeout(probe, …)` 这类固定节奏形态一律判红 —— 换成裸字面量 `1500` 也照样判红，判据不该只认那个已退役的常量名）；缓存判据要求**读**与两个终态**写**同在（只写不读 = 缓存白建）。每条主判据都配一条**负对照喂进同一个函数**（旧固定 1.5s 轮询 61 拍必须判红）。**有牙的独立证明（变异体，`.test-cache/mutate-artgate.mjs`）**：A 退避表退回 `[1500]` ⇒ 2 条红（85）；B 拆掉缓存**读**侧 ⇒ 1 条红（86）；C 组件换回固定间隔排拍 ⇒ 1 条红（86）；三条同施 ⇒ 4 条红（83）；还原后 87 全绿、`git diff --check` exit 0。⚠️ 形态判据一律只看**剥掉注释的代码**（`stripComments`）—— 上面这些说明文字里就写着 `NOTICE_ART_POLL_MS` 与"固定间隔"，拿原文比会被自己的注释误伤成真阳性。**纯客户端改动 ⇒ 刷新页面即可**（本机要清掉那 150 行红字，仍需**重启 DSH** 让路由白名单换血）。

- **修复：某些网页壁纸每点一下就把 DSH 的键盘焦点抢走（输入框 / 下拉选择框 / 左下角账号菜单失焦）—— 给壁纸文档注入一段「帧级夺焦围栏」，吞掉 `window.focus()` 并留计数**（来源：用户实测可复现 —— 壁纸「鲸鱼计划表」workshopid `3800777313`）。
  **现象**：播放中在宿主界面任意位置点一下，DSH 自己的输入框 / 下拉选择框 / 左下角「设置-意见反馈-退出登录」菜单就失焦（窗口仍在焦点、`relatedTarget` 为 null ⇒ 焦点被搬进了**另一个文档**）；**与点击位置无关、与组件类型有关** —— 只有"必须持有键盘焦点才正常"的那类控件看得出来，其它组件看起来一切正常；**暂停即恢复**。
  **机制（静态闭合，三步）**：① 壁纸层 `pointer-events:none`，鼠标事件由 DSH UI 消费；客户端在 window 捕获相把每次真实 mousedown 注入渲染页（`src/live-layer.js:1178-1238`），且只在 `selection.sceneLiveActive` 时发（`src/live-layer.js:1194` 的门槛）⇒ 暂停就停止注入，这正是「暂停即恢复」。② 网页壁纸走严格沙箱（`&webSandbox=strict`，`src/live-layer.js:178`），渲染页够不到壁纸文档，控制只能经 web-shim 的 op 通道落到壁纸一侧；shim 用 `elementFromPoint` 命中元素后 `dispatchEvent` **合成** pointer/mouse 事件（`lib/webwallgl/web-shim.js`：`pushPointer` / `elementFromPoint` / `dispatchEvent`），合成事件的 `isTrusted === false`。③ 作者为了让 WE 桌面模式下「键盘有处可去」，在**捕获相 mousedown** 里调 `window.focus()`（该壁纸 `index.html:4615-4619`，全文件唯一的 `window.focus` 调用点）⇒ 宿主里任何位置点一下，壁纸帧就抢走键盘。
  **修法**：新增 `lib/we-focus-guard.js` —— 注入体以**源码文本**下发（`weFocusGuardSource()` 用 `Function.prototype.toString()` 取同一份函数原文，单一真源，不抄第二份字符串），由 `lib/index.js` 的 `/scene-files` HTML 注入块插在 shim 之后、seed 之前（`<script data-we-focus-guard="host">`，与 shim **同门控**：没有 shim 就没有注入通道）。围栏把 `window` 上的**帧级** `focus` 换成「计数 + 吞掉」，两条腿装机（赋值 ⇒ 不生效则 `Object.defineProperty` 建自有属性），失败只体现为 `window.__weFocusGuard.installed === false`，**绝不抛**（注入体住在壁纸文档里，抛异常会毁掉作者脚本）；`window.__weFocusGuard = { calls, blocked, allowed, installed, allow }` 是围栏唯一的自证手段（壁纸帧控制台一眼可见拦了多少次），`allow = true` 是给对比测试用的逃生门。`package.json` 的 `files` 收录新模块。
  **为什么可以整条废掉，以及为什么只拦帧级**：本插件从不把键盘送进壁纸帧 —— web-shim 里 `keydown`/`keyup`/`keypress`/`KeyboardEvent` **零命中**，渲染页的 keydown 只用于音频解锁。所以壁纸抢到帧级焦点，唯一效果就是**从 DSH 手里把键盘拿走**（作者为此内置软键盘）。**元素级** `HTMLElement.prototype.focus()` 有意放行：壁纸自己的单元格编辑框 / 模态输入框照常工作，那是它真正需要的焦点。同样**不**用 `inert` / `pointer-events:none` 去砸壁纸交互。围栏也**不**放进 `lib/webwallgl/`（`test/tools/sync-webwallgl.mjs` 每次上游同步都 `rmSync` 整个目录）—— 必须是插件自己的字节，才不会被上游覆盖。
  **判据**：`test/verify-scene-live.mjs` ⇒ **`ALL SCENE-LIVE CHECKS PASSED (494)`**（483 → 494）—— 新增：① **行为腿**（`await import` 真模块取注入体，`new Function('window', src)` 在只有 `window` 的假 realm 里跑**真源码**）六条：拦住且原函数一次都没被调用、重复注入幂等、`allow` 转交并累加、**原型上不可写 ⇒ `defineProperty` 兜底**、自有不可写不可配置 ⇒ `installed === false` 且**不抛**、以及负对照（把「吞掉」改回「转交」⇒ 核心断言变假）；② **接线腿**（剥注释后：标签名 + `weFocusGuardSource()` + 顺序 site-root < shim < **guard** < seed）+ 负对照；③ 形态腿（无 `</script`、无 `import`/`export`、经 `toString()` 取源）；④ 两条 e2e 扩面（C3 打真响应体断言围栏注入且**早于 seed**；C4 对真实 socket 的 `Origin: null` 请求同样断言围栏在响应里）。**有牙的独立证明（变异体，`.test-cache/mutate-guard.mjs`）**：A 拿掉注入腿 ⇒ **3 条红**（C3 e2e + C4 e2e + 接线腿，`491 passed`）；B 把「吞掉」改回「转交」 ⇒ **3 条红**（行为腿 + `allow` 腿 + 兜底腿，`491 passed`；它自己的负对照此时仍绿，因为**被变异的树就是那条负对照想合成的形态**）；C 把围栏与 seed 的顺序对调 ⇒ **2 条红**（接线顺序腿 + C3 顺序腿，`492 passed`）；D 拆掉幂等守卫 ⇒ **2 条红**（幂等腿 + `allow` 腿 —— 没有幂等守卫时二次注入换了 guard 对象，旧引用成了死对象，`492 passed`）；B+C+D 同施 ⇒ **5 条红**（`489 passed`），`restore` 后 494 全绿、`status` 各锚点 ok/0。⚠️ 变异体锚点必须写成**盘上整行原文**：幂等那条行尾带注释，用 `if (w.__weFocusGuard) return;` 当锚点会 `found 0`（脚本按整行 trim 相等操作，这是刻意的）。
  **已知残留**：跨源 WindowProxy 上的 `top.focus()` / `parent.focus()` 无法从壁纸文档侧改写（同源策略允许调用、禁止改写）；真有这类壁纸时 `__weFocusGuard.blocked` 不涨而症状仍在 —— 那就是这个残留，届时再谈宿主半拦截（代价是与作者页拉锯，本仓不做）。**这是宿主半的改动 ⇒ 重启 DSH 生效。**

### v1.3.0（2026-10-06）

> 1.2.0 之后至 1.3.0 的全部内容（npm 与 GitHub Release 已发布）：

- **新功能/行为：「思考块液态玻璃」升三挡 —— 关 / 液态玻璃 / 原生（**正文实色、输入框保留玻璃**）**（用户口径，作用域两轮收窄后落定）。
  **做了什么**：新设置键 `thinkingNative`，与 `thinkingGlass` 组成三挡，**原生挡赢**的互斥在门控层保证（原生 ⇒ 不挂思考玻璃门；存储形状不动 ⇒ 存量配置与出厂玻璃预设零迁移，预设键表已收编、缺键按 false 补）。原生挡把**正文内容**——消息气泡与代码块 / 行内代码 / 标签 / 代码分段 / 引用等 markdown 家族——在正文子树（`[data-chat-flow]` / `[data-vcp-rawhtml]`）内被接管的 10 个令牌**退回宿主原生值**（原生值逐条取自宿主主题包 design-platform 的静态调色板，`var(--dsw-static-*, 字面量兜底)` 形态，浅/深两主题各一套）；**对话画布与输入框不碰**——输入卡与工具弹卡保留玻璃、画布照常透壁纸。气泡的霜/釉在原生挡退出；胶囊雾化 / 胶囊颜色 / 思考触发条的玻璃细调在该挡整组收起（门下 CSS 不挂 ⇒ 画了就是死旋钮的既有防线）。
  **为什么**：关挡（半透明透壁纸）与玻璃挡（磨砂）之外还要"完全实色"的一挡；第一版把整列都钉回原生，结果 composerSeat 自带的「36px 渐变到 bg-base」装饰底衬在子树里拿到不透明原生值、在屏上现形为"输入区一条黑楔"（官方 Harness 壳层没有 `.dshDesktopConversationSurface` 那个类，画布大底罩不住）——按用户口径收窄到正文子树后，黑楔按构造消失（底衬回到透明隐形）。
  **判据**：`verify-client` 三挡分段行为断言（选挡写两键一致 / 原生互斥属性 / 触发条独立配置与胶囊行在原生挡收起）；`verify-presets` 键表收编；`settings-sanitize-golden` 重录（其余键零漂移）。

- **修复：自定义字体颜色"重启后保存的直接没了"—— 持久化链路上的两个丢失洞**（用户反馈）。
  **洞 1 · 半对整角色丢弃**：字体颜色现在是角色色（5 角色 × `{light,dark}` 两套）。打开「深色单独设置」后**只填一边**（另一侧留"跟随"）= 半对，而三层消毒（`readThemeColors` / 令牌载荷构建 / `sanitizeFontset`）都是"缺一套整角色丢弃" ⇒ 该颜色**落不了盘、也不会生效**，面板却显示着已选——重启后自然"没了"（本机实测：磁盘上只有两边都填过的角色活了下来）。修：`onThemeColor` 的 separate 分支把空的那一侧用**当前官方色**补齐（主题服务不可达时退回同色）——pair 永远完整，"只改深色"的意图不受影响。
  **洞 2 · 失败后回滚**：字体值走独立字体集通道（编辑 → localStorage 缓存 → `PUT /fontsets/<活动id>`），而"上次落盘是否成功"的脏标记不跨重启——PUT 一旦失败（最典型：插件更新后宿主没重挂，面板提示的正是"重启 DSH 后再试"；或退出太快），重启后的启动加载会拿宿主旧值**无条件覆盖**缓存里较新的编辑。修：缓存带跨重启 dirty 标记（写缓存即标脏、PUT 确认后转净）；启动加载发现"脏缓存 ≠ 宿主值" ⇒ **采纳缓存并立即补推**，不再静默回滚（取舍：两桌面端共用数据目录时 = 本窗口最后所见者胜，注释在案）。
  **判据**：`verify-fontset` 新增 ⑦g（半对：静态判据 + 行为级"半对确实被消毒丢弃"存档）/ ⑦h（回滚防线四件套 + 双负对照）。

- **修复：插件市场 git 直装失败（issue #141）—— 构建钩子 `prepare` 撞上 pnpm 11 的 git 依赖构建闸，改挂 `prepack`**。
  **现象与复现**：市场默认走 `dsh plugin --profile web add git+https://github.com/elysia395/dsh-wallpaper-engine.git`，pnpm 11 报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`（"needs to execute build scripts but is not in the allowBuilds allowlist"）⇒ 装不上（报障环境 Windows + DSH 0.1.7-rc.2）。本机隔离 profile 一条命令稳定复现；对照验证 npm 渠道（`dsh plugin … add dsh-plugin-wallpaper-engine`）不受影响。
  **根因**：git 直装会把源码拉下来并跑包的 `prepare`（= 我们的客户端构建），而 pnpm 11 对 **git 依赖的构建脚本**有 `allowBuilds` 安全闸（默认拒跑）⇒ 直接拒装。旧设计（`scripts/prepare.mjs` 随包、文档写明"安装期会跑"）正是与这道安全闸正面相撞的形态。
  **修法**：构建从 `prepare` 改挂 `prepack`（只在 `npm pack` / `npm publish` 时、在发布者工作区里跑）——安装期**一个脚本都不跑**；装出来的包直接用随包发布的 `lib/client.js`（由 CI 的 build 幂等 + `verify-client-sync` 看着）。`scripts/prepare.mjs` 不再随包（开发面文件零随包），三份 README / CONTRIBUTING / CODE-STRUCTURE 里"包里带什么""安装期脚本"的表述同步。**给仍被拦用户的立即绕法**（已实测有效）：按 CLI 提示把 pnpm 打印的 allowBuilds 键写进 profile 的 `pnpm-workspace.yaml` 再重跑；或改走 npm 渠道。
  **判据**：`test/verify-package-publish.mjs` ⑦ 换成新不变量 —— **不许出现 `prepare`/`preinstall`/`install`/`postinstall` 四类安装期钩子**，且构建必须挂在 `prepack` 上；② 的随包白名单收成**空**（棘轮，只许收紧），负对照同步（`prepare.mjs` 现在被判为开发面泄漏）。三份 README 的"随包清单"与 `npm pack --dry-run` 实测一致。

- **修复：Edge 里视频壁纸切换"无反应"（旧壁纸永远留在屏上）—— 切层闸门的镜像画布分支从不读画笔留痕**（用户报障；复现＝Edge 打开 web 实例后点任意视频壁纸：`layer-hold` 之后永无 `layer-reveal`）。
  **做了什么**：`layerContentReady` 的视频分支在「Edge 镜像画布」这一档原先写死"有画布 ⇒ `return false`"（本意是"等 `weDrawFrame` 画上第一笔再放行"，随 7a1e60b 的切层闸门一起出生），而画笔的留痕 `canvas.dataset.weDrawn = "1"`（`weDrawFrame` 里已写、并回调 `noteLayerContent(canvas)`）**从来没被读** —— 首笔落下时回调的 `recheck()` 又撞回同一条判据，放行条件永远不成立；`VIDEO_STALL_GIVE_UP_MS`（15s）到点后按"绝不露空层底色"的口径停在旧壁纸上，观感就是"切换无反应"。现在该分支读留痕：`if (mirror) return !!(mirror.dataset && mirror.dataset.weDrawn === "1");`。
  **为什么现在才炸**：该分支只在 **UA 含 `Edg/`** 的浏览器里成立（Edge 档的视频层才带镜像 canvas；桌面端/其它浏览器走原生 `<video>` 档、闸门判 `readyState`，一直是通的）。用户日常跑桌面端不触发；改用 Edge 开 web 实例后必现 —— 与"现在切换无反应"的时点吻合。
  **怎么定位的**：落盘诊断里连续三次切换全停在 `layer-hold`、无一条 `layer-reveal`，且 `underlay` 回退"作者配色"（画面取样同样拿不到帧）—— 与"元素没数据"矛盾；加了一版临时取证行（已在同批删除）打印闸门判否那一刻的元素真值：`rs=4 ns=1 vw=1920x1080`（有帧、有尺寸、只差没播），能把判否走通的只剩镜像画布那条。复现/验证走**隔离实例**（profile web-015 + `DSH_WE_DATA_DIR` 隔离，无 ledger 锁）：无头 Edge 里合成 pointerover（预热）→ 点卡片（应用）→ 修前永不放行、修后 `layer-reveal … held=13ms`。
  **判据**：`test/verify-scene-live.mjs` 新增两条 —— 闸门必须读 `weDrawn` 且"有画布就判否"的旧形态不存在，配负对照（把读留痕改回 `return false` 即判红）；画笔侧 `canvas.dataset.weDrawn = "1"` 与闸门读取**两半同批断言** —— 这条 bug 的病根正是"两半各写一半、没人对上账"。

- **修复/行为：皮肤互操作补上「主题」这一维 —— 皮肤上台时主题也退场（我方改过的那份原样放回），任何时候的显式主题切换都不硬覆盖回去**（用户报障："设置壁纸后切回皮肤，我们插件没完全退还干净的环境，会对皮肤造成覆盖"；口径："WE 主题，其他主题不要覆盖；如果切换主题不要硬覆盖回去"）。
  **做了什么**：让路清单从"壁纸层 + 玻璃整族"扩到主题 —— ① 让路态（皮肤在台上）里主题的 5 处写入口（评估 / 写 / 图源 / 两条抓帧腿）一律空转：皮肤在台上时主题归皮肤；② 清空路径（用户「清除」与皮肤让路两条路都汇到 `applySelection("")`）调用新入口 `themeFollowRelease()`：**只放我方改过的那一份** —— 第一次真正改动前记下原值（`themeFollowBefore`），退场时原样放回并留诊断行；两条"不碰"判据 —— 让位标记在场（有人改过主题）、或现值已经不等于我方最后写进去的值（改动发生在我们视野之外）；③ 皮肤退场把壁纸放回的那次应用带 `fromSkinRestore`：主题评估**不复位让位标记** —— 皮肤窗口期里用户改过的主题活过这次放回，没改过则与普通换壁纸逐位一致；④ 放回自身遵守"先记再写"（`themeFollowWritten = back` 先于 `setTheme`）—— 放回自己也会触发一次 `theme/change`，不先记账会被读成"别人接管"，把同一张壁纸的放回锁死在让位态。
  **为什么**：旧行为里让路窗口把主题留在壁纸判决上（清空早退路径不评估、也不放回）—— 皮肤上台后整层宿主界面停在壁纸判的深/浅色，皮肤的浅/深变体也被带偏，这正是"环境没退干净"里肉眼最大的一块。放回是对**自己那次改动**的撤销，不是把主题"翻回去"：用户 / 别处的切换永远优先（让位标记与现值比对双重闸），且边界双向都钉住 —— 窗口里没人动过主题时，放回照常写壁纸判决（不把"不硬覆盖"做成"永远不写"）。
  **判据**：`test/verify-theme-follow.mjs` 新增 ⑧（放回三条闸 · 让路态空转而放回照常 · `fromSkinRestore` 正负对照 —— 不带标志的同序列会被写回壁纸判决 · 放回自触发事件不许被读成"别人接管" · 放回后再选同一张重新接管）；`test/verify-client.mjs` 互操作块新增 ⑥（清空路径放回 / 5 处让路门 / 两层"不碰"判据 + 三条负对照）。

- **新功能：皮肤中心（dsh-skins）互操作 —— 皮肤上台 ⇒ 我方壁纸与玻璃整族让路**（对侧已由对方实现：只读 `body[data-we-wallpaper]`，壁纸应用时皮肤整体停画；这里补**反向** —— 皮肤试穿 / 应用时我方让路，只读对方信号、绝不写对方任何状态）。
  **做了什么**：信号只有一条腿 —— MutationObserver 观察 `html[data-dsh-skin]`（对方的公开标记；dsh-skins#49 起其显式试穿 / 应用 / **重复应用**都会重写该属性，同值 `setAttribute` 也产生 mutation record）。**进场滞回 450ms**（对方的启动上妆是瞬时翻转、随后被它自己的 refresh 自纠；真实动作会持续 ≥1.5s ⇒ 只认"过一拍还在"的出现）+ **复位滞回 2.6s**（对方 refresh 会先摘标记再补回，瞬时摘不算退场；晚于对方 1500ms 的让路上限）。「我方在台上」认**两条腿**：壁纸在台（标记在场 ⇒ 有层要让，兼防启动竞态 —— 设置在途或壁纸在册但层还没建都不算动作，实测报障"有壁纸时刷新掉壁纸"）与**无壁纸**（设置已就位且 id 为空 ⇒ 没有层可清、也没有竞态可防，但玻璃整族仍盖在皮肤上 —— 玻璃与壁纸正交（`data-we-glass-page` 恒挂），这条腿也要进，否则无壁纸用户中途试穿 / 应用皮肤永远摘不掉玻璃；安装期的 adopt 只管启动那一拍）。让路态 = 清当前壁纸（若设过）+ 玻璃整族退场（`applyGlass` 顶部整族摘门控七连；effects 的 thinking-glass 与 sidebar-follow 两处门控同步摘）；退场时先按停轮播（`rotationEnabled` 置 false —— 否则空 id 会被轮播自动补位）。复位 = **持续**不在台上才做：按记忆放回壁纸与轮播开关；用户期间手动选过壁纸就不抢（`fromManual` 钩子立刻退让路态）；启动期只"认领"不写盘（等 `selection.loaded`，本地缓存可能过期）。**让路记忆落盘**（`skinYieldRestoreId` / `skinYieldRestoreRotation` 两枚无界面设置键）：enter 把退场前的选择写盘、exit 消费即清；重启后认领按盘上记忆武装（不再拿空记忆），皮肤在应用关闭期间被移除时启动直接按记忆放回（`boot-restore` 借 exit 的消费路径）—— 跨重启不再丢壁纸与轮播选择。早先为补"应用"这条腿做的轻轮询（`GET /api/skin-center/v2/active`）已随对方契约落地**整体删除** —— 纯事件、无网络。另在 `lib/index.js` 记下**跨插件读契约**（对方出文档前同步读 `config.json` 的 `settings.id` 判"壁纸在台"，issue #51 —— 环境变量名 / 文件名 / 键名是双边契约，单方面改动会把首帧预判打回"皮肤先闪一下"）。诊断行 `skin-yield`（enter / exit / adopt 的 reason 落 `~/.dsh-wallpaper-engine/diag/http.jsonl`）。
  **判据**：`test/verify-client.mjs` 尾部互操作块：① 单腿信号（轮询腿不许回来 —— 剥注释后的代码上判）+ 两条腿进场条件（负对照：去掉"我方在台上"前提、或退回"只认壁纸标记"的单腿旧条件即红）；② 只读对方（绝不写它的标记）；③ 退场在玻璃三层门控点都生效（applyGlass / effects 两处）、滞回常量与对方 1500ms 上限的关系、手动重选立刻退；④ 复位按记忆且不抢用户新选择（负对照三连）。
- **移除：「扩展」页签一号模块「硬件资源监控柱状图」整体退役**（用户口径：资源监控**不并入**本美化插件，建议做成**单独的监控类插件**；「扩展」页签与另两个模块原样保留）。
  **做了什么**：模块的四份实现整份删除 —— 浏览器侧两半（画布层 `src/metrics-layer.js` + 扩展岛 `src/ext-metrics.js`）与宿主侧两半（采样器 `lib/metrics.js` + 只读路由 `lib/routes/metrics.js`）；`lib/settings-schema.js` 的 29 个 `metrics*` 键与 `parallaxMetrics`（共 30 键）、`src/client.js` 的 21 个 `onMetrics*` 处理器与订阅 / 卸载两处接线、`src/styles.js` 的柱状图整段样式、`src/i18n-copy.js` 的整块词条、`package.json` 的 `files` 条目（`lib/metrics.js`）一并撤掉。**「扩展」页签的容器语义一行没改**：注册表 `extensionModules()` 现在只返回三项（自定义会话头像 / 点击效果与拖尾效果 / 3D 效果）—— 当初把它做成注册表的价值就在这一刀上。三号「3D 效果」里"柱状图参与视差"的那部分（柱层 / 行名 / 白线三个系数与 `parallaxMetrics` 键）随模块退役，只剩壁纸与吉祥物两层（落在 body 上的系数从 5 个减到 2 个）。
  **为什么**：① 它是插件里唯一带**宿主侧常驻采样**的模块（Windows 上还常驻一条 `typeperf` 子进程），与"美化"不是一类东西；② 资源监控是独立的监控类产品面 —— 单独做成插件才不用两头迁就（挂在壁纸插件里它只能长在壁纸上，参数还得跟玻璃 / 字体 / 主题抢位置）。
  **判据**：`test/verify-client.mjs` 的「扩展」页签判据从"四张模块卡"改成三张（锚点 / 计数 / 注册表顺序 / 三个模块默认关时都不画参数）；`test/verify-scene-live.mjs` 删掉三个整块（两个浏览器侧模块的登记与"产物里只有一份"、宿主采样器与那条只读路由的行为断言、画布层与岛的两半判据），注册表字符串期望同步为 `AVATAR_EXTENSION_MODULE, FX_EXTENSION_MODULE, PARALLAX_EXTENSION_MODULE`，视差层的源码口径换锚（选择器 `.we-layer, .we-rope`、`const pctMax = st.bg;`、body 上只剩 2 个系数），头像样式段的切片终点改挂「扩展」二号模块（原来靠被删掉的柱状图段头当边界）；设置夹具 `test/fixtures/settings-sanitize-golden.json` 从 client / host 两侧期望里整批摘掉这 30 键（其余键零漂移）；`docs/ROUTE-INDEX.md` 由 41 条路由重算为 40 条、`docs/GUARD-MAP.md` 重算（两个模块移出后零覆盖只剩两个 vendor 产物）；中英 README / HOW-IT-WORKS / CODE-STRUCTURE 同步（页签里的模块清单、视差层的两条腿、路由图与角色表）。`npm run verify:all` 全绿（scene-live 453 条）。

- **修复：页面玻璃效果不再依赖「已设置壁纸」（用户报障：不设置壁纸时玻璃不生效）**。
  **做了什么**：整页的玻璃规则原先一律挂在壁纸门 `data-we-wallpaper` 下（那条属性只在选中壁纸时才挂）⇒ 没设壁纸时「玻璃 / 玻璃透明度 / 玻璃颜色 / 玻璃保真度 / 雾化」全是死旋钮、界面维持宿主原生实色。现在拆成**两条正交的锚点**：
  · **`data-we-glass-page`（新，页面玻璃锚点）** —— 由 `src/glass.js` 的 `applyGlass` **恒挂**（插件在跑就挂，与有没有壁纸无关；与既有的 `data-we-glass-chat` / `-window` / `-floaters` 同族）。壁纸只是玻璃的**背景来源**之一，不是玻璃的前提。`src/styles.js` 里 99 条整页接管的规则改挂它：表面令牌映射（`--dsw-alias-bg-layer-1/2/3`、抬高按钮、代码块家族、边框…）、对话框玻璃（气泡 / 输入卡片 / 工具弹卡）、轨迹内容区补霜、左侧栏液态玻璃、右栏原生面板、以及「无 backdrop-filter」与「软件光栅器」两档回退。
  · **`data-we-wallpaper`（保持原义，只剩真·壁纸语义）**：页面**让开**（`--dsw-alias-bg-base` / `--dsw-specific-sidebar-fill` 置透明 ⇒ 壁纸层透出来）、浅色模式的文字对比提升、桌面壳画布底清底（`.dshDesktopFrame`，否则整片盖住壁纸）、柱状图 / 特效层（它们画的就是壁纸的像素）、以及 #137「侧栏全透明」既有的壁纸门口径。
  无壁纸时页面**不会**变透明：`body` 的基色保持宿主原色（玻璃面压在这层不透明基色与内容之上），配方照旧算出可读的底色（可读性地板 + 霜 + 釉光 + 发丝边）；有壁纸时两条锚点同时在场，观感与之前逐位一致。卸载路径成对：`src/effects.js` 的 `clearEffects` 撤掉新锚点（与 -chat / -window / -floaters 同批）。
  **判据**：`test/verify-readability.mjs` 的整表 surfaceSpecs（39 个文字面）与各条 `ruleFor` 全部改锚到 `body[data-we-glass-page]`（F2a 仍逐条带可读性下限 + 负对照，F2e 的栅栏规则谓词同步换锚）；`test/verify-glass-compositing.mjs` 的 G8 换锚点并补**覆盖面地板**（浅/深 23/23 —— 顺带修掉它的块头切片缺陷：原先 `lastIndexOf('{', open)` 会命中 `open` 自己 ⇒ 块头恒空串、这条判据一直静默空转，本次新增的地板把它抓了出来），S2c2 换锚点；`test/verify-client.mjs` 新增三条 —— 映射必须挂在 `body[data-we-glass-page]` 上、壁纸块里**不许**有玻璃映射（负对照：锚回壁纸门即红）、以及运行时一条（用真 picker 关掉壁纸后 `data-we-glass-page` 仍是 `on`，`data-we-wallpaper` 同时消失）；`test/compat-harness-pages.mjs` 的表面令牌探针改成"先读锚点在场、再临时摘掉锚点取对照侧"（原来靠临时挂壁纸锚点，现在那个锚点由插件常挂）；`test/verify-glass-surfaces.mjs` 的门控许可证注释与 `test/fixtures/harness-ui-surfaces.json` 的两条覆盖说明同步换锚。`verify:all` 全绿。

- **新功能：吉祥物可自定义导入立绘（「系统」页签 · 聊天吉祥物）**（用户口径：可导入自定义图片；已导入时下一次导入覆盖上一次）。
  **做了什么**：设置页「吉祥物形态」那一排多了**第三张卡**（用户口径：导入后显示在「鲸御姐」后面、同样的卡片大小和样式）：卡面舞台与最高的内置卡同一个盒（64×96），点它导入 / 替换（再导入即覆盖），正在用时是 `--active` 那张。主页面那只吉祥物（`RopeDock`）的立绘改由 `ropeArtOf(sel)` 统一解析 —— `mascotImage` 非空且显示盒合法就用**用户导入的那张**，否则回落到「吉祥物形态」选的内置立绘（小女仆 / 鲸御姐）；两个内置形态卡片在自定义生效时**禁用**（点了不会变 ⇒ 不许做成"点了没反应"，禁用态同时淡出），清除后恢复可选；「清除」按钮只在有自定义立绘时出现在这一排的最后。新路由族 `lib/routes/mascot.js`（POST 导入 / GET·HEAD 查看 / DELETE 清除）与头像同形但**只有一张**：导入前先清同族旧文件 ⇒ "再导入即覆盖"；落盘在插件数据目录的 `mascot/`（`mascot-<时间戳>.<ext>`），设置只存文件名（`mascotFile` 档）。显示盒（`<宽>x<高>`）在导入时按 96×192 等比适配算好存进 `mascotImageBox`（小图不放大，只为"太小的图标点不到"留 28px 的短边下限；盒按**存盘那张**缩放后图的像素算，`downscaleImageFile` 的宽高契约即"缩放后像素数"）—— 拖动、贴边与视口钳位都读它；盒坏掉时 `ropeArtOf` 整体回落到内置立绘（宁可回内置，也不拿一个猜出来的盒子去量）。盒的 96×192 上限是 **schema 单源常量**（`MASCOT_BOX_MAX_W/H`）：`mascotBox` 档按它限量级（手改 config 塞不进 `999x999` 这类超盒值），客户端 `ropeArtOf` 同一上限兜底。导入链（选文件 / 解码 / 按 512px 缩 / POST / 失败文案）与头像**共用同一份**实现（`pickImageFile` / `downscaleImageFile` / `postImageAsset` / `assetRouteFailure`）。
  **判据**：`test/verify-scene.mjs` 的真 socket 路由块扩成"用户图片资产两族"——立绘六条（未导入 404 + no-store / 非白名单 MIME 415 / 导入 200 + 文件名形状 / 查看字节一致 + 长缓存 / **再导入即覆盖**（新名字 + 目录里只剩一张）/ 清除后回到 404）；`test/verify-contracts.mjs` 新增立绘 MIME 两侧一致 + 路由形态四条（共享读体器 + 原子落盘 / 只有一张 / 长缓存 + 404 no-store / 目录与上限）；`test/verify-client.mjs` 在吉祥物节判「未导入 ⇒ 只有『导入图片…』+ 未导入占位、无『清除』、形态卡片可点」与「已导入 ⇒ 提示 / 替换+清除 / 卡片禁用」的源码口径。设置夹具同批补入 `mascotImage` / `mascotImageBox` 两键。

- **新功能：自定义会话头像（「扩展」页签的**第一项**模块）—— 把任务消息交互做成好友互相发信息的样子**（用户口径：默认关闭；开启后可导入自定义图片给交互双方设置头像，默认圆形头像，可调大小和头像圆角强度）。
  **做了什么**：`src/avatar-layer.js`（新）是一层**会话 DOM 补丁** —— 给三类消息行（`data-chat-flow-kind` = `user` / `steering` / `assistant-step`）在最前面补一个头像节点（一个圆脸；宽度固定为边长），行本身改横向 flex、用户行反过来 ⇒ 你的消息靠右带头像、助手的靠左带头像；只读 `selection`，MutationObserver 两级早退（新增元素先判"是不是消息行"、再判"是不是已在装饰过的行里"），流式输出每帧的插入只多一次 `closest`。关掉开关 = 摘掉全部注入节点与行标记、断观察者、撤 body 上的开关属性与两个变量（逐字节回原生）。尺寸与圆角靠 `--we-avatar-size` / `--we-avatar-round` 两个变量 ⇒ 拖滑块只是变量替换，不重建节点。默认头像是画出来的内置 SVG（我方 = 人像、助手 = 四角星，同一张零件表供 DOM 与面板两处用），导入的图片只是替换它。**没有自定义名字行**：中途试过的那版"双方各一个自定义称呼（助手默认取当前模型名、我方默认「我」）+ 头像上方的名字"按用户口径**整体移除**（"加了它太丑了"）—— 设置键、节点、样式、词条一并撤掉，不许再长回来。
  **图片怎么存**：图片本体由宿主落在**插件数据目录**的 `avatars/`（`<side>-<stamp>.<ext>`，不进 `overrides` —— 那是"某个壁纸的画面"；也不进 `uploads` —— 会污染壁纸库存），设置里只存那个文件名（`avatarFile` 档，形状不合法即作废）—— 它同时是"设置过没有"的真源与 `<img>` 的缓存键（换图 ⇒ 换名 ⇒ 不吃旧缓存）。新路由族 `lib/routes/avatar.js`：POST 导入（MIME 白名单 + 8MB 上限，**走共享读体器 + 原子落盘**，不新增流式豁免）/ GET、HEAD 查看（长缓存由文件名担保；未导入 404 + no-store）/ DELETE 清除；客户端导入前先在 canvas 上按 512px 缩一遍再传。设置新增五键：`avatarEnabled`（默认关）/ `avatarSize` 40（24–72）/ `avatarRadius` 100（0–100，100 = 正圆）/ `avatarUserImage` / `avatarAiImage`；自定义吉祥物立绘两键 `mascotImage` / `mascotImageBox`（同批加入）。
  **导入失败的文案**：宿主没重挂时（宿主模块只在启动时 load 一次，而浏览器里的 bundle 每次刷新都重新取）POST 会落到 SPA 兜底、拿到一个**裸 405** —— 屏幕上只说"宿主返回 405"等于没说话。`src/client.js` 的 `avatarFailureReason` 按"有没有 `{ error }` 信封"区分两种失败：裸 404/405 ⇒ 「宿主里没有头像路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）」（与字体集/系统字体同口径）。
  **判据**：`test/verify-client.mjs` 的四张模块卡改为**按注册表顺序**判（头像第一）+ 头像模块默认关不画参数 / 开着画两方各行与两个滑块、量程与回显（40px / 100%）、「导入图片…」两个按钮（没导入过时不得出现「清除」）、页签里不得再出现自定义名字行；`test/verify-scene-live.mjs` 新增两条登记判据（产物里各只有一份）+ 装饰层源码口径（三类行的选择器与 side 映射、开关属性与两个变量、无自定义名字行、回原生六步、观察者两级早退、只读 settings）+ 岛的可见行为（关着只画总开关、开着才画两方各行与两个滑块）+ 最小 DOM 替身下真跑一遍装饰层（开 ⇒ 只给两类消息行补节点、换设置就地更新、关 ⇒ 逐字节回原生）+ 纯函数面（无 DOM 环境零抛错、URL 构造）；`test/verify-contracts.mjs` 新增头像 MIME 两侧一致（客户端 accept ↔ 宿主 `AVATAR_EXT`）+ 路由形态五条（只认两个 side / 共享读体器 + 原子落盘 / 换图清兄弟 / 长缓存 + 404 no-store / 目录与上限）；设置夹具 `test/fixtures/settings-sanitize-golden.json` 同批补入五键（安全阀 = 其余键零漂移；中途试过的两个自定义称呼键已随整体移除一并从夹具撤掉）；`test/verify-scene.mjs` 新增一条**真 socket** 的路由级用例（数据目录用 `DSH_WE_DATA_DIR` 隔离到工作区、用完即删 —— 路由会清"同一方的旧文件"，指错目录等于删用户的头像）：未导入 404 + no-store / 非法一方 400 / 非白名单 MIME 415 / 导入 200 + 文件名形状 / 查看 200 + 字节一致 + 长缓存 / HEAD 无体 / 换图只剩一份 / 清除后回到 404。
- **「预设方案」收口为显式的高级配置**（ADR-0008 D4）：预设块此前**恰好**也不在侧栏，但那是
  **隐式事实** —— 侧栏档只是"没传 `glassPresets`"，靠渲染器入口守卫 `if (!presets) return null`
  顺带不画，于是没有任何判据对着它判过（谁把那个字段补进侧栏 ctx，整块就会静默出现在侧栏）。
  本次显式化三件：① `src/glass-panel.js` 加门 `!sidebarSurface && renderGlassPresetsBlock(...)`；
  ② `glassPresets` 进 `src/quick-panel.js` 的 **setting-only 占位器**（拆掉门 ⇒ 渲染器解构它的第一下
  就抛错）；③ `test/verify-scene-live.mjs` 两档都钉（侧栏档标签序列与整树文本都不许出现预设块、
  设置档必须有；用例新增 `ctxOver` 注入 preset 替身，否则"设置档必须有"会恒假）。
  **分类理由**：它不是总开关也不是逐面覆盖，而是**跨面批量覆盖**（一份预设 = 玻璃子系统完整快照，
  应用即整套覆盖、**无确认无撤销**），且出厂预设**删除即永久** ⇒ 按 D4 的取向属高阶。
  ⚠️ 顺带更正上游那句"设置页与侧栏快捷面板共用同一预设块"（与实现不符）。

- **侧栏「外观」恢复"只画简化配置"**（用户口径，判定走 `ctx.surface`；ADR-0008 **D4** 恢复并细化）。
  **做了什么**：侧栏快捷面板的「外观」页此后不再画每个面的「独立配置」层**及其子项参数**，也不再画
  「思考块液态玻璃」门下的**胶囊雾化 / 胶囊颜色** —— 这些都改回**只在设置页**出现；而**总开关**留在
  两档：「思考块液态玻璃」「左侧栏液态玻璃」「侧栏液态玻璃」「侧栏全透明」「侧栏玻璃跟随全局」+ 全局
  四件套。（**预设方案**见上一条：它是高级配置，本次已从"隐式事实"收口成显式门 + 占位器 + 两档断言。）
  **为什么**：侧栏面板窄、是"随手调一下"的场合；逐面覆盖全局是高级动作。⚠️ 这一条在 2026-10-03 曾按
  当时口径整体拆掉（"两档同内容"），但 **ADR-0008 的 D4 没有随之修订** ⇒ 文档（ADR + `UPGRADING.md`）
  与实现自那天起不一致；本版以 ADR 为准恢复，并把分类写死进 D4。
  **两道保险**：① 门在 `src/glass-panel.js`（`!sidebarSurface`），**连构建都跳过**高级行；
  ② 那些高级行的处理器进了 `src/quick-panel.js` 的 **setting-only 占位器**（取用即抛错）⇒ 将来把高级行
  挪回侧栏档会**当场炸**，不是静默变成"拖了没反应"的死旋钮。
  **判据**：`test/verify-scene-live.mjs` 的两档**控件标签序列**（侧栏档 10 行 / 设置档 18 行）+ 新增的
  D4 双向断言（侧栏档一个「独立配置」都不许有、预设块也不许有，但两个总开关必须在；设置档必须有
  独立配置层与预设块）。
  ⚠️ 附带修掉一条**空转判据**：那条边界检查原本住在旧的 `CASES` 循环里，而外观用例早已搬进
  `MORE_CASES` ⇒ 它当时永远不会触发（改口径也不红）；现已随本次改动搬进真正跑得到外观用例的循环。

- **玻璃配置收成「每个面一个独立配置开关」**（用户可见的取值管道重构，宿主端设置表 + 浏览器端渲染）。
  ① 退役「设置窗口液态玻璃」与「子 UI 玻璃」两层开关 —— 实测那个"关"做不到回原生纯色（那些面上还有一批
  不挂门控的底色改写）；② 每个玻璃面只留一个「独立配置」（开 = 用自己那套釉层参数覆盖全局，关 = 跟随全局），
  其中**侧栏 / 内容面是新补的入口**（此前它们的滑杆没有 UI 入口 ⇒ 拖了没有任何变化）；③ 各面刻度统一成
  一把（观感不变：存量值按"归一化位置"一次性换算，`settingsVersion` → 5）；④「窗口与侧栏」节撤销、内容并进
  「玻璃 UI」（没装 better-sidebar 的机器上它原本是一个只有标题的空节）；⑤ 删掉面板上**从来没人读**的六行
  死控件。判据：`test/verify-glass-surfaces.mjs`（登记表 ↔ 接线 ↔ 语义三方对账，每条带负对照）+
  `verify-readability` / `verify-glass-compositing` / `verify-softrender`。取舍与被证伪的方案见
  [`adr/0008`](./adr/0008-glass-config-two-state.md)，全过程取证见
  [`archive/wip/GLASS-CONFIG-REFACTOR.md`](./archive/wip/GLASS-CONFIG-REFACTOR.md)。⚠️ 需重启 DSH 生效。
- **新增：思考触发条（`section[data-turn-trigger]`）也吃玻璃，并带自己的「独立配置」**。宿主给这一面一个
  **专属底色令牌**（`--dsw-alias-turn-trigger-bg` 与其 `-hover`），本插件**接管那两个令牌**（hover 档必须
  一起接管，否则鼠标一悬停就被不透明灰盖掉）而不是去匹配宿主的哈希类名，并在锚点元素上挂模糊载体。
  ⚠️ **它挂在「思考块液态玻璃」（`thinkingGlass`，默认关）门下**：开关关着时令牌不被接管、模糊不挂
  ⇒ **逐字节现状**；打开后才吃玻璃，此时「思考触发条玻璃·独立配置」开 = 用自己那套**模糊 / 透明度**覆盖
  全局，关 = 跟随全局（`glass.js` 写 `--we-thinking-trigger-blur` / `-alpha`；刻度与全局同一把，
  0–60 px / 0–100 %）。上游 #134 把这一面与推理面一起写成"清底 + 无霜"，本次追版（v1.3.0）两条线收敛为
  **共用同一道门、这一面从清底那一组里摘出来**。可读性走**全局**那对变量（用对话栏那对会被
  `verify-readability` 的 F2c 判出）；软件光栅（`data-we-glass-fallback`）下把令牌钉回不透明面板色并显式
  关掉模糊。判据：`verify-glass-surfaces` 的登记表把这一面从 `pending` 摘除并改判 `tier: private`
  （第 ③ 组随之从"pending 豁免"转为"锚点必须在"，并新增"global 面不得藏着私有变量族"的反向检查）+
  `verify-readability` F2a/F2c + `verify-softrender` E2/E3 + `verify-client` 的面板量程断言 + 设置黄金夹具
  （两个新键）。

- **修复：松散目录形态的场景壁纸无法实时渲染**（用户报障：松散类型的场景壁纸无法正常渲染）。
  **做了什么**：`lib/index.js` 的 `sceneFieldsFor` 撤下「live render is pkg-only」旧门 —— 旧口径以为
  WebWallGL 的 httpSource 只能拉单文件容器，入口是 `.json` 的松散目录被整体判 `sceneLive:false`、不发
  token。WebWallGL 2.1.0 起渲染器原生支持松散形态：站点根两种形态一致（`<mediaBase>/<token>/`），
  渲染器先拉 `project.json`、按 `file` 后缀自动判形态（`.json` 结尾 → loose，拉入口 json 与同级素材；
  否则回退 `scene.pkg` 容器），auto 档 sceneDir 先试、scenePkg 兜底。所以 token 一律发放、形态判定交给
  渲染器；`isPkg` 只剩 `scenePkgBytes` 一个用途（松散目录没有"整包"，首帧预算走基准）。客户端两处过时
  注释同步（`src/media-prep.js` / `src/client.js`，逻辑本来就只认标志）。
  **判据**：`test/verify-scene-live.mjs` 新增真松散夹具（project.json 声明 scene.json + 入口与素材散放
  盘上、全目录零 scene.pkg）七条判据 —— inventory 给 `sceneLive:true` + token、token 解开 = 入口 json
  绝对路径、`/scene-files` 逐件 200 + 字节一致（project.json / 入口 scene.json / 同级 main.tex）、
  「没有 scene.pkg ⇒ 404」负对照；ROUTE-INDEX 重生成。

- **侧栏与设置页壁纸库两处列表改「占位 spacer + 可视窗口」虚拟滚动，设置页库视图不再分页**（用户口径：「全量加载、不隐藏」「不要分页」）。
  **做了什么**：侧栏的「100 行封顶 + 还有 N 张未显示」与设置页库视图的分页器（normal / hidden 两组页状态、四枚翻页回调、分页器行）整套退役；两处共用同一套机制 —— `src/quick-panel.js` 的 `qpVirtWindow`：scrollHeight 由上下两枚占位行撑出**全集**高度，滚动 / 搜索 / 筛选语义与全量 DOM 完全一致；窗口按**网格行**计（列表一行 1 张、卡片一行 cols 张，列数从首张已渲染卡的轨宽实测反推），视口外上下各多渲染 6 行防快速滚动露白；换视图 / 换形态（正常 / 草稿 / 隐藏 / 开关下钻）的一帧按「未测量」处理（首窗 30 条目 + 零占位），测量 effect 立刻跟上。hooks 长在 WallpaperPicker 组件里、经 ctx（gridRef / vwin）传给纯渲染器 `renderPickerModal`；「✕ 关闭」卡是网格第 0 条目，必须算进窗口切片；隐藏页的头部行 / 问句行移出网格（语义行不是网格单元，行号折算才成立）；classic CD 架**不虚拟化**（aspect-ratio 叠盖卡的行高随列宽变，固定行距算式不成立，且该档本无分页），维持全量渲染。官方档（列表自己滚）与抽屉档（祖先滚动）两壳同一套测量式；滚动事件 rAF 合并、窗口没变不重渲染；官方档在换视图 / 条数变化时 scrollTop 归零重测。
  **为什么**：库可以上千张 —— 全量 DOM 卡顿，分页又违背「全量加载不隐藏」的口径；窗口按条目直算会盖不满视口（卡片档滚一行窗口只挪一张，实测踩过），按网格行折算才对。
  **判据**：`test/verify-picker-model.mjs` 跨层对拍对象从「当页切片」换成「虚拟首窗」（判定台 React 是替身、测量 effect 不跑 ⇒ 首窗 = 关闭卡 + min(30, 可播放数)，确定性断言）；`test/verify-client.mjs` 分页判据整套换成虚拟窗口判据（首窗 30 卡 / 库视图分页器不出现 / 窗外条目不渲染但经搜索可达 + 负对照）、class 序列遍历对 Fragment 透明（虚拟窗口的 Fragment 不产生 DOM）、golden 按虚拟窗口形态重录（普通视图 181 令牌）；`scripts/build-client.mjs` 内联标记同步（QP_LIST_MAX 退役、qpFindScroller / qpVirtWindow 上岗）。

- **修复：「吉祥物大小」滑块把设置页里的形态卡片也一起缩放**（用户口径：设置页内的吉祥物大小不应该随之改变，只能改变主页面内的吉祥物大小）。
  **做了什么**：`src/panel-tabs.js` 吉祥物页签的形态卡片立绘改按 `ROPE_FORMS` 基础尺寸固定渲染
  （小女仆 52×57 / 鲸御姐 64×96，去掉 `* sel.ropeScale`），提示文案同步改为
  「卡片固定大小 · 大小只作用于主页面吉祥物」；主页面 `RopeDock`（拉绳吉祥物本体）的缩放逻辑不动。
  **为什么**：滑块的职责是调桌面上的吉祥物大小，设置页卡片只是选形态的按钮 —— 跟着缩放既没必要，
  大倍率下（上限 2.5×）还会把卡片撑得很大。
  **判据**：`test/verify-client.mjs` 在滑块拨到 1.5 后断言两张卡片的立绘仍为固定基础尺寸（加回乘法即判红）。

- **修复：侧栏「壁纸属性」在属性多的壁纸上显示不全、滚不动**（用户报障：壁纸属性点开时，属性特别多会显示不全）。
  **做了什么**：`src/styles.js` 在官方侧栏壳里给属性下钻容器补一条自带滚动
  （`.we-qp--official .we-qp__propsview--drill { overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }`）。
  **为什么**：官方侧栏的页签内容区是宿主给的「固定高 + overflow:hidden」（壁纸档还挂 `--library`，滚动特意交给
  列表自己），而属性下钻那一屏**没有列表** —— 面板不自带滚动就被裁掉，且从它到 body 之间**没有任何"用户滚得动"
  的祖先**（`overflow:hidden` 的容器程序上也能 `scrollTop`，但用户滚不动）。抽屉壳的滚动由 `.we-repo-panel__body`
  承担，这条只作用在官方档，不叠第二层滚。
  **判据**：`test/verify-scene-live.mjs` 的侧栏滚动链一段追加「面板自带纵向滚动 / 有界高 / 前提：内容区裁切」三条
  与一条负对照（去掉 `overflow-y` 即判红）；真浏览器判定台 `test/tools/sidebar-props-scroll-rig.mjs`（真产物 + 真
  React + 宿主几何：60 项属性的壁纸，逐候选滚动验证末行可达 —— 修复前 FAIL、修复后 PASS，壁纸列表滚动不受影响）。

- **一号模块「硬件资源监控柱状图」的默认值按维护者实际调好的那套参数固化**（用户口径："将当前插件的
  『硬件资源监控柱状图』扩展中的设置设为默认配置" ⇒ 明确为"把我现在实际调好的那套值固化成默认值"）。
  **做了什么**：`lib/settings-schema.js` 的 `DEFAULTS` 里**十键改值** —— 高度 / 垂直偏移 / 柱宽 / 行间隔 /
  阈值 / 不透明度 / 极黑档倍率 / 荧光 / 描边宽度（数值见该文件，这里不另抄一份）；键的集合与顺序未变，
  `KINDS` 的每一段范围一律未动，其余十九键与那套值本来就一致
  （水平偏移 0 / 柱间距 2 / 细白横线开 / 混合模式「自动」/ 平滑 60 / 时间窗 60 / 实心柱开 / 序列名称开 /
  三条序列开、网络与磁盘关）⇒ 原样保留。
  ⚠️ **总开关仍默认关**（`metricsEnabled: false`、kind 保持 `boolFalse`）：同批一度把它改成默认开
  （`DEFAULTS` 转 true + kind 换 `boolTrue` —— kind 自己编着"缺值时的取值"，只改 `DEFAULTS` 会被
  sanitize 抹回去），随后按用户测试结论**改回默认关**（见下一条：扩展三模块出厂全关、按需开启）。
  **为什么**：这十键不是出厂拍脑袋值，是逐项手调出来的观感 —— 固化之后**打开这个模块**的用户直接就是这个
  样子，不必再照截图重拖一遍；"要不要开"仍由用户按需决定。
  **判据**：`test/verify-client.mjs` 的「扩展」块钉住**三模块出厂全关**（默认一律不画参数控件 +
  `checked === false`），再走一次总开关的 `onChange` —— 打开后那串参数（位置与大小 / 柱形 / 阈值 /
  观感四项 / 柱形配色 / 序列名称 / 五条序列）必须出现，并钉住"关掉总开关后那一串参数必须收起来"；
  `test/verify-scene-live.mjs` 里那张扩展岛的对比，「关」那一档**显式**写 `metricsEnabled: false`
  （不再拿 `DEFAULTS` 当"关"的样本 —— 默认值一变，那种对比就成了恒真）；golden 夹具按新默认重钉
  （`.test-cache/regen-golden-metrics.mjs` 新增 `RESTAMPED` 十键：键集没变、只变默认值 ⇒ 走"重钉"而不是
  "补新键"，跑出 `added 0 key slots across 18 cases`，安全阀 = 其余键零漂移）。
  **没有新设置键**（数量 / 顺序 / 范围都没动）⇒ `docs/ROUTE-INDEX.md` 与 `lib/types/` 都不动。

- **扩展三模块的出厂开关全部默认关、按需开启**（用户口径 2026-10-04）：`metricsEnabled` 由默认开改回
  **默认关**（点击与拖尾 / 3D 效果两个模块本就默认关）—— 三个模块都不再替用户做决定，想要的人才打开。
  **判据**：`test/verify-client.mjs` 的「扩展」块从"默认开 ⇒ 参数直接画出来"改回"默认关 ⇒ 一条参数都不画"，
  三个模块的 `checked === false` 同时钉住；`test/verify-scene-live.mjs` 的扩展岛对比改用**显式**
  `metricsEnabled: false` 当"关"那一档（不再拿 `DEFAULTS` 当样本）；golden 夹具按新默认重钉
  （`metricsEnabled` 与其 kind 回到 `boolFalse`），安全阀 = 其余键零漂移；中英文档同步。

- **优化：「3D 效果」的动效开销**（用户反馈：效果很好，只是动效的性能开销较高）。
  **做了什么**：改动全在 `src/parallax-layer.js` 与 `src/styles.js` 的视差段，**没有新设置键**
  （⇒ golden 夹具与 `docs/ROUTE-INDEX.md` 都不动）。① **变量作用域收窄**：每帧变的"位移步长"
  `--we-parallax-x / -y` 从 body 改写到**要动的那几层自己**身上（`.we-layer` / `.we-rope` /
  `.we-metrics`，由 `document.querySelectorAll` 每 250ms 重扫一次、记录里收着"上一次写下去的步长"
  比快照，不读回 DOM），body 上只留 5 个"各层系数"（只在设置变了时写一次）—— 自定义属性是继承的，
  写在 body 上等于每帧让整棵文档树重算样式。② **帧率封顶 60Hz**（`PARALLAX_MIN_FRAME_MS` = 一帧的
  0.75 倍）：高刷屏上多出来的那些帧只重排、不写变量，缓动本来就按 60fps 折算。③ **"到位"改按看得见的
  位移判**：`settle = max(PARALLAX_SETTLE_PX, 剩余可见像素 / 最大系数)`，常态 0.25px、光标静下来
  180ms 之后放宽到 1px ⇒ 收敛尾巴上那十几帧一次收掉（抹平那一刻的位移不足 1px，看不出来）。
  ④ **视口尺寸只在起帧与 resize 时读**（帧里不再每帧问 `window`）。⑤ **系数全 0 时一帧都不排**
  （一次落位就收工）。⑥ **只在动的那几帧提合成层**：起帧给那几层加 `.we-parallax--moving`
  （样式段给 `will-change: translate`，只提示 translate、不碰 scale 的栅格化倍率），到位收工与停用时
  立刻摘掉 —— 本仓刻意不留常驻合成层（同 `.we-layer--repaint` 的两帧微推）。
  **为什么**：这一层整个长在输入路径上，开销全在"每帧的样式失效范围有多大""一次手势要跑多少帧"
  与"每帧要不要把满屏壁纸重绘一遍"这三笔上；上面六条各自砍掉其中一笔，观感一个字没改。
  **判据**：`test/verify-scene-live.mjs` 的源码口径大 check 追加 ⑧ 性能一组（作用域写入 / 60Hz 封顶 /
  可见位移阈值 / 零系数快路径 / 临时合成层的加与摘），并新增一条**行为判据** —— 搭一副最小假 DOM
  （`querySelectorAll` 返回三个假元素、假 rAF 由判据手动驱动）真跑几帧，断言步长只落在那些元素身上、
  body 上只有 5 个系数、起帧时合成层提示类在、收敛后已摘掉、停用后两边都收干净；`src/styles.js`
  那条 check 追加 `body[data-we-parallax="on"] .we-parallax--moving { will-change: translate; }`。
- **新增：「扩展」三号模块「3D 效果」—— 随光标移动的视差纵深**。
  **做了什么**：新增 5 个设置键（`lib/settings-schema.js` 的 DEFAULTS + KINDS）—— `parallaxEnabled`
  （`boolFalse`，默认关）、`parallaxBg`（`num 0..10`，默认 `1`，壁纸与吉祥物）、`parallaxMetrics`
  （`num 0..20`，默认 `1`，柱状图柱层）、`parallaxMascot`（`boolTrue`）、`parallaxSmooth`
  （`num 0..98`，默认 `85`）。新文件两个：行为层 `src/parallax-layer.js`（基座模块：零 ctx、只读
  `selection`）与描述符 `src/ext-parallax.js`（扩展岛 5 行）；`src/panel-tabs.js` 的注册表加第三项；
  `src/client.js` 五个具名处理器 + `extensionCtx()` + `subscribe(syncParallaxLayer)` /
  `disposeParallaxLayer()`；`src/styles.js` 新增「「扩展」三号模块：3D 效果（视差）」段；
  `src/i18n-copy.js` 登记 12 条键；构建表加这两个模块。
  **它一个 DOM 节点都不建**：只 passive 监听 `document` 的 pointermove 与 `window` 的 resize，把光标偏离
  屏幕中心的量换算成 7 个 CSS 变量与一个开关属性 `data-we-parallax` 写在 body 上，位移 / 放大 / 各层配比
  全在样式表里用 `calc()` 乘出来 —— `.we-layer` 的 `translate` 乘 `--we-parallax-bg` 并
  `scale: calc(1 + 变量 / 100)`、`.we-rope` 乘 `--we-parallax-mascot`、`.we-metrics` 乘
  `--we-parallax-metrics`、`.we-metrics--labels` / `.we-metrics--guides` 在柱层的值上各再多 1% / 2%。
  单位量：光标偏离屏幕中心的向量 `u` ⇒ 目标位移 = `PARALLAX_DIRECTION × u × 百分比/100`（光标走完一整条
  最长对角线，该层正好挪它那个百分点的对角线距离 —— 就是用户口径里的定义）；`PARALLAX_DIRECTION = -1`
  ⇒ **关于屏幕中心对称**（与光标反向）；缓动是按帧时长做的指数逼近（`parallaxSmooth`，`0` = 立刻跟手），
  追上目标即停（空闲零帧，只有 `parallaxKick()` 才排帧）。
  **为什么**：用户口径 —— "新增扩展：3D效果：当光标移动时，组件与背景壁纸沿中心对称方向缓动…背景的缓动
  距离默认为最长对角线的 1%，【硬件资源监控曲线】扩展组件也支持自定义缓动距离（仅图表组件，其余组件以该值
  为基准逐加 1%）…点击效果与拖尾效果不偏移…如果可以，让吉祥物挂件组件也参与偏移"。三个取舍：① 位移用
  **CSS 独立属性 `translate` / `scale`** 而不是 `transform` —— 壁纸过场的
  `resetLayerSwitchStyles()` 会内联写 / 清 `transform`，只有独立属性与它叠加而不互相清掉；② 壁纸必须
  **同时放大** `1 + 百分比/100` 补边（横向最大位移 = 百分比 × 视口宽 / 2 ⇒ 不放大边上就露出底色）；
  ③ **点击与拖尾那一层刻意不参与**（用户第 3 条），抽屉 / 快捷面板 / 设置面板也不参与（它们在指针底下，
  跟着动会点不准）。
  **判据**：`test/verify-scene-live.mjs` 加了登记类 check 两条（两个新模块各在 `INLINE_MODULES` 与产物里
  各一份）、`src/parallax-layer.js` 的单文件 import 与三态 `syncParallaxLayer()`（开 / 越界值 / 关）+
  `disposeParallaxLayer()` **无 rAF 环境零抛错零 DOM 副作用**、源码口径大 check（方向常数与那两行公式、
  `parallaxBody()` 的 `typeof document` 守卫、`requestAnimationFrame` 早退、`LABEL_STEP` / `GUIDE_STEP`、
  两条 passive 监听、**负向**断言"不建 DOM"与"不碰 `we-fx`"）与样式段 check（五条
  `body[data-we-parallax="on"]` 规则、`translate` / `scale` 的 `calc()`、**负向**"这一段里没有
  `transform:`、也没有 `.we-fx`"）、三号模块的岛块（顺序敏感：关 ⇒ 只有总开关那一行，开 ⇒ 四行参数）；
  `test/verify-client.mjs` 加了岛行为断言（三张模块卡、总开关默认关、打开后四行文案与滑块范围
  0..10、0..20、0..98、默认回显 `1%`、`1%`、`85%`、吉祥物开关默认开、负向不含别模块的控件）。
  **夹具**：新增 5 个设置键 ⇒ `test/fixtures/settings-sanitize-golden.json` 按「引入时行为」补录
  （`added 165 key slots across 18 cases`）；`docs/ROUTE-INDEX.md` 不动（纯客户端、无新路由）。
- **修复：「硬件资源监控柱状图」的自动混合在极黑背景上改用「变亮」+ 柱子透明度压低（倍率可自定义）**。
  **做了什么**：`src/metrics-layer.js` 的自动档从两档变三档 —— 新增
  `METRICS_BLEND_NIGHT = 'lighten'` / `METRICS_LUMA_DEEP = 0.15`；
  `metricsBlendForLuma` 的**最前一句**判极黑（实际显示亮度 < `METRICS_LUMA_DEEP`）⇒ 那一段用
  「变亮」，并把**柱层**（`band.host.style.opacity`）的不透明度乘一个可调的倍率（用户口径的
  "透明度 -50%"）；分段方案的每一项因此从裸字符串变成 `{ mode, dim }`，`dim` **只由这条极黑规则
  产生** —— 手选「变亮」不带 `dim`（用户自己选的档不该被顺手压低，判据也因此不能拿
  `mode === 'lighten'` 当极黑档的开关）；采不到壁纸亮度时的兜底走新的 `metricsBlendFallback()`
  （同样不压低）；**名称层与标尺层照旧用原不透明度**（它们混合恒为 `normal`，压低只是把白字白线
  变成灰的）。扩展岛「混合模式」那一行的 hint 与中英词表同步补了这一档。
  倍率本身是**设置键**：用户随后又提"关于上文所说的明度-50%，该值也允许自定义"，于是把当时写死的
  `METRICS_DEEP_ALPHA = 0.5` 换成新键 `metricsDeepOpacity`（默认 `50`、范围 `10..100`、
  `kind: 'num'`），帧里读成 `const deepAlpha = metricsClamp(selection.metricsDeepOpacity, 10, 100, 50) / 100;`。
  键表达的是**结果**（极黑时柱层只剩多少不透明度）而不是"减多少" —— `100` 天然等于"关掉这条极黑
  规则"，不必再加开关；扩展岛里这一行叫**「极黑柱不透明度」**，且**只在「混合模式 = 自动」时出现**
  （别的档根本不会判极黑，摆着就是骗人 ——「分色」档才出现五个取色器是同一条理由）。
  **为什么**：用户口径 —— "修复【硬件资源监控曲线】，对于极黑的背景，自动模式应使用'变亮' +
  图柱透明度-50%的策略"。纯黑底上 `multiply` 是 ×0（柱子被乘没）、`overlay` 也只是勉强提亮，
  只有 `lighten`（逐通道取较大值）能让柱子**原色直出**；但全量的变亮在黑底上亮得发糊、整块糊成
  一条光带 ⇒ 同时把柱层压低（默认砍半，倍率可自定义）。阈值 `0.15` 是观感取值，必须**远低于** `METRICS_LUMA_SPLIT` 的
  `0.5`，否则"暗档"就被它吃掉了。
  **判据**：`test/verify-scene-live.mjs` 的 `metrics-layer.js` 源码口径 check 加了 8 条断言（两个
  新常量、判定首句、`metricsBlendFallback`、手选档的 `{ mode: manual, dim: false }`、`deepAlpha`
  读设置键的那一行与 `entry.dim ? deepOpacity : opacity` 这一处写入）；`test/verify-client.mjs` 的
  「扩展」块判新滑块的范围（10..100）、默认回显（`50%`）与**只在自动档出现**（切到别的档即消失、
  切回又回来）。**新增一个设置键** ⇒ golden 夹具已按「引入时行为」补录
  （`added 33 key slots across 18 cases`）；`docs/ROUTE-INDEX.md` 仍不动（纯客户端、无新路由）。

- **新增：「扩展」页签二号模块 ——「点击效果与拖尾效果」**。
  **做了什么**：① 新增一对文件：扩展岛 `src/ext-fx.js`（总开关 + 点击 / 拖尾两个子开关，各自的样式、
  尺寸、光晕、时长、粗细、不透明度、混合模式与配色；两个子开关任一开着即生效，关掉哪个就把它那一串
  参数收起来），画布层 `src/fx-layer.js`（body 级 `.we-fx` 画布 + `z-index: -1` 浮层，只 **passive**
  监听 `document` 的 pointermove / pointerdown —— 宿主 `pointer-events: none`，**不接管任何输入**；
  落在开关 / 输入框 / 面板等界面控件上的点击直接丢掉，免得"点按钮顺便炸一圈"）。② 点击效果 = 两圈
  扩散的圆环（第二圈晚 18% 寿命起步）/ 一簇**不等长**的飞散亮点 + 中心一次白闪 / 两者；拖尾 = 一条按
  年龄逐段收细的圆头光带（彗尾）/ 按固定步距留在原地的亮点（星尘），两者龄满即除 —— 指针停住也照淡。
  ③ **帧循环是内容驱动的**：`fxStart()` 首句在没有 `requestAnimationFrame` 的环境直接返回（测试沙箱
  因此零 DOM 副作用），有内容才续帧、画空了就收工（空闲零帧）；帧头唯一的早退之后**立刻**调幂等的
  `fxEnsureHost()`（柱状图那层把"宿主还没建"也当早退条件造成的死锁不会再犯）。④ 不透明度与**混合模式**
  写在**宿主元素**上（写在画布上只会跟宿主自己的层叠上下文混合）、层内 `lighter` 叠加；颜色 = 主题色 /
  彩虹（每个实例一个色相、还随时间流转）/ 自定义。⑤ 层级靠文档序：本层压在壁纸之上、暗化层与柱状图
  之下，每帧用 `compareDocumentPosition` 核对一次、被盖住就插到柱状图宿主前面。⑥ 新增 14 个 `fx*`
  设置键（`lib/settings-schema.js` 的 DEFAULTS + KINDS + 四张值表；总开关默认**关**）；取色器只在
  「自定义」档出现。
  **为什么**：用户口径 ——"开启下一扩展的制作：点击效果与拖尾效果，该扩展仅作为示例，你可以自行设计"。
  这一层刻意**不采样壁纸像素**（所以没有「自动」档），混合交给默认的滤色或用户手选；其余取舍都以
  美观优先（两圈而不是一圈、亮点不等长而不是等长、龄满即除而不是拖尾留痕）。
  **判据**：verify-client 的「扩展」块断言两张模块卡、默认关时不得出现参数文案、开着后 34 条文案 /
  十条滑块上下限 / `140px`·`420ms`·`85%` 三个读数 / 混合模式下拉五个档 / 取色器只在「自定义」档出现
  且默认 `#4f8cff` / 两个子开关各自收起自己那串参数；verify-scene-live 断言两个新文件各在产物里只有
  一份、`fx-layer.js` 可单独 import 且**无 rAF 环境零抛错零副作用**（导出键集合恰为
  `disposeFxLayer,syncFxLayer`）、源码口径（`FX_HOST_ID` / 内容驱动帧循环 / `if (!fxOn || !st.on) return;`
  之后紧跟 `fxEnsureHost()` / `insertBefore` 的两条层级路径 / `mix-blend-mode` 与 `opacity` 写在宿主 /
  `globalCompositeOperation = 'lighter'` / `target.closest(FX_UI_SELECTOR)` / `{ passive: true }`）、
  扩展岛的 12 条参数顺序 + 取色器只在自定义档出现。中英文案（README / HOW-IT-WORKS / 本文件）同步；
  `docs/ROUTE-INDEX.md` 不动（纯客户端、无新路由）；i18n 词表与 golden 夹具按新键补录。

- **修正：「自动」混合模式改看"实际显示亮度"；三族宿主压在暗化层之上；标尺层自己归位画布**。
  **做了什么**：① `auto` 档的判据不再是壁纸**原图**的亮度 —— `drawImage` 读到的是原始像素，
  它既不吃本插件下发的 CSS 滤镜、也看不见盖在壁纸上的暗化层，于是"亮壁纸被暗化压到中灰"仍被
  当成亮区走正片叠底（柱子 = 柱色 × 暗背景，糊在背景里）。现在先把插件自己那套效果反算回去再判档
  （`metricsDisplayLuma`：`brightness` 乘法 → `contrast` 绕 0.5 拉伸 → 半透明壁纸的淡出底色与
  叶 opacity → 暗化 `scrim`；每一步都按 schema 的范围兜底），并给这四个键 + 淡出底色算了一个签名
  （`metricsDisplaySig`），拖动设置立刻重算显示亮度，不必等采样缓存到点；采样仍读一行像素，只是
  把原图亮度留成 `metricsLumaRaw`、对外暴露的是显示亮度。② 三族宿主（柱 / 行名 / 白线）与暗化层
  `.we-scrim` 都是 `z-index: -1` 的 body 级浮层 —— 同层靠文档序分上下，而暗化层是**壁纸激活时**才
  挂上去的：本层先起（开机就开着扩展、壁纸稍后才铺）就会被那层黑罩住，现在每帧核对一次文档序、
  被罩住就把三族宿主按原顺序搬到暗化层之后（`metricsRaiseAboveScrim`）。③ 标尺层的画布**漏了归位**：
  段画布与行名层都调了 `metricsSizeCanvas`，白线那层没有 ⇒ 它的位图一直是 HTML 默认的 300×150，
  被 CSS `width/height: 100%` 拉伸 ⇒ 整块宽不到 300 时白线只画出左边一段、整块高过 150 时下半截
  被裁掉、纵向还被拉伸错位（用户口径："白色横条没显示完全"）。现在两层各自在尺寸变化时归位画布
  并清自己的重绘签名。
  **为什么**：用户口径 —— ①"柱状图难以辨别，因为其在亮背景上生效正片叠底后再被背景插件的'暗化'
  等效果加暗…我的建议是先获取当前插件中设置的相关值，基于这些值计算出该区域背景的实际显示亮度，
  再基于此亮度判断亮暗区"；②"白色横条没显示完全"。
  **判据**：verify-scene-live 的画布层源码断言补 `metricsDisplayLuma` / `metricsFadeBaseLuma` /
  `metricsDisplaySig` / 四个参与反算的 `selection.*` 键 / `metricsRaiseAboveScrim` 及其每帧调用 /
  两层各自的"归位成功就清签名"形态（只断言"画过线"抓不到这类漏归位）。**没有新设置键** ⇒ 词表与
  golden 夹具都不动；`lib/settings-schema.js` 里 `METRICS_BLEND_VALUES` 的注释同步说明判据是显示亮度。
  中英文案（README / HOW-IT-WORKS / 本文件）同步。

- **修正 + 新增：行名独立成层并把字色亮度钳在 20%–80%；「自动」混合模式改成按壁纸明暗分区切换**。
  **做了什么**：① 序列名称从参与混合的柱层**搬出来**，成为第三层宿主（`#we-metrics-labels`），
  混合恒为 `normal` —— 上一版把行名和柱子放在同一层，`multiply` 档（正片叠底）会把接近纯白的
  主题字色乘到几乎看不见（用户口径："标注文字难以辨别了，可能是因为其是白色，被正片叠底机制消除"）；
  字色仍取「外观」里那套设置，但过一道 `metricsClampInk()` 把 HSL 的**亮度**钳进 20%–80%
  （`METRICS_INK_MIN` / `METRICS_INK_MAX`）—— 纯白落在 80%、纯黑落在 20%，亮壁纸与暗壁纸上都读得出来；
  ② `auto` 档不再"整块取一个平均亮度"，改成**逐段判明暗**：整块横着切成不超过 `METRICS_BAND_MAX`
  段（**每段一个宿主、各挂自己那一档**），每段采"柱子背后那一横条画面"的亮度，偏亮用正片叠底、
  偏暗用叠加 —— CSS 的 `mix-blend-mode` 是**元素级**的、逐像素换档做不到，分段是它的近似；切点恒取
  柱间距的中点（`metricsBands`），永远不会把一根柱子切成两半；某段采不到（iframe / 跨源 / 视频没出帧）
  仍退回上一次手选的档；采样探针从"24 × 24 的方块"改成 `段数 × 1` 的一行像素，缓存键带上段数与
  整块的水平位置/宽度占比，段数**只由几何决定**（手动档恒 1 段 ⇒ DOM 不会每帧重建）。
  **为什么**：用户口径 —— ①"加入限制：标注文字的颜色虽然受壁纸插件控制但亮度上下限钳制在20%-80%"；
  ②"能否进一步智能化，自动识别背景亮度大于/小于50%的区域，明区使用正片叠底，暗区使用叠加？"
  **判据**：verify-scene-live 的产物判据从"两条独立绘制路径"改成**三条**（柱子 / 行名 / 白线各恰好
  一份 —— 混回一份就等于三层又粘上，"解耦"当场失效），画布层源码断言补 `METRICS_LABEL_HOST_ID` /
  `METRICS_BAND_MAX` / `METRICS_INK_MIN` / `METRICS_INK_MAX` / `metricsClampInk` / `metricsBlendPlan` /
  `metricsBands` / `metricsSyncHosts` / `metricsPaintLabels` / 逐段写混合（`metricsNodeStyle(band.host,
  'mix-blend-mode', mode)`）/ 渐变改用钳过的字色。**没有新设置键** ⇒ 词表与 golden 夹具都不动。
  中英文案（README / HOW-IT-WORKS / 本文件）同步。

- **新增：资源柱状图可设图层混合模式（含按壁纸明暗自动切换）、细白横线标尺、五条序列各自的自定义颜色**。
  **做了什么**：① 新设置键 `metricsBlend`（枚举，默认 `auto`）决定这组柱子与壁纸怎么融合 ——
  手动档就是 CSS 的 `mix-blend-mode`（正常 / 正片叠底 / 叠加 / 滤色 / 柔光 / 变暗 / 变亮），
  「自动」档由画布层**采样壁纸画面**判明暗：采样到的平均亮度偏亮用正片叠底、偏暗用叠加；
  采不到画面（网页 / 场景壁纸是 iframe、视频还没出帧、跨源画布被污染）就**退回上一次手选的档**，
  而不是把柱子置成某个说不清的默认值 —— 采样结果带 TTL 缓存，不会每帧都去读像素；
  ② 新设置键 `metricsGuides`（细白横线，默认开）在**每行 50% 高度**与**每两行之间**各画一条
  横贯整块的 1px 白线（恒定 35% 不透明度），把柱状图变成能读数的标尺；
  ③ 画布层从此挂**两个宿主层**：柱子与行名一层（混合模式与不透明度写在这一层），细白横线**单独一层**
  （混合恒为 `normal` —— 与柱子同层的话正片叠底会把白线乘没），标尺层的重绘签名**不含数据时间戳**，
  于是柱子每秒换帧时白线不会跟着重画；两层的显隐与混合因此互不牵连 —— 这正是后来落地的「扩展」
  三号模块「3D 效果」（`src/parallax-layer.js`）用的接口；④ 「分色」档不再用内置固定色相，改成五个新设置键
  `metricsColorCpu` / `metricsColorMem` / `metricsColorGpu` / `metricsColorNet` / `metricsColorDisk`
  （`hex` 类型，默认值就是原来的出厂色相 ⇒ 没改过颜色的用户看到的是同一幅画），面板在「分色」档下
  才长出五条取色器（预设圆点 + 自定义色盘，色盘拖动走 live 档、抬手落盘）。
  **为什么**：用户口径 —— ①"能否修改该扩展叠加到背景上的图层混合模式？例如当背景为亮背景时使用
  正片叠底，暗背景使用叠加"；②"添加细白横线，横在每个柱状图 50% 高度上和每两个柱状图之间"；
  ③"注意把标注文字/图柱和细白横线解耦，因为我计划的下一个扩展功能是随光标位置响应的 3D 纵深效果"；
  ④"允许自定义图柱颜色"。
  **判据**：verify-client 的「扩展」页签块补 细白横线 / 混合模式 / 七个混合档名共九个文案，
  钉住细白横线开关默认开、混合模式是**下拉**（8 档平铺会被等分宽度的 `.we-picker__seg` 挤成一团）
  且默认 `auto`、档位与 `METRICS_BLEND_VALUES` 逐字对齐（值 + option 条数一起判），并新增一轮
  「跟随主题色档下不得有取色器 → 点「分色」后恰好五条取色行、默认值就是各自出厂色相 → 切回后
  取色器消失」的行为断言；verify-scene-live 的扩展岛判据改成 **17 参数 + 5 序列开关**，另加一条
  用记录桩（本台 `swatchRow` 是 noop）钉住"只在分色档调了五次、每次给的就是那条序列的出厂色"，
  画布层源码断言加了两个宿主的 id / 白线不透明度 / 自动档两个档位常量 / `metricsResolveBlend` /
  `metricsSampleLuma` / `metricsSeriesColor` / `metricsPaintBars` / `metricsPaintGuides`；
  settings 规范化 golden 夹具按「引入时行为」再补七个新键（脚本 `.test-cache/regen-golden-metrics.mjs`，
  安全阀 = host 侧其余键零漂移）。中英文案（README / HOW-IT-WORKS / 本文件）同步。

- **调整：资源柱状图改用英文标注 + 标注文字竖向渐变，整块位置可左右 / 上下偏移**。
  **做了什么**：① 压在每行上的那行字从"跟随界面语言的指标名"改成**固定英文缩写**——
  CPU / RAM / GPU / NET / DISK（画布层 `METRICS_SERIES[].tag`，纯 ASCII 常量**不进词表**；
  面板里的开关仍是中英随语言的指标名，两者从此各管一处）；② 那行字由"整段 30% 不透明"
  改成**竖向线性渐变**：字的上缘 30%、下缘全透明，渐变跨度取字自身的行框（不是整行 band，
  于是行高怎么变，几行字的渐变看起来都一样）；③ 新增两个可负的设置键 `metricsOffsetX`
  （水平偏移）/ `metricsOffsetY`（垂直偏移），在"居中 + 四边留白"的基础上把**整块**挪
  （正值向右 / 向上），挪出屏外会被钳回留白之内 —— 偏移是微调，不该能把装饰挪丢。
  **为什么**：用户口径 —— 标注要"像图形的一部分"（英文缩写、不随界面语言改写）、
  "标注文字上下渐变，上部是默认颜色，下部是透明"、以及"允许设置其位置（左右、上下偏移）"。
  **判据**：verify-client 的「扩展」页签块补 `水平偏移` / `垂直偏移` 两个文案、两者的滑块
  上限 `400` 与**下限 `-400`**（新增 `sliderMin` 助手：可负的滑块只判 max 会让"丢了负半边"
  这种回归看不见），并钉住两个偏移的数值回显 `0px`；verify-scene-live 的扩展岛判据改成
  **15 参数 + 5 序列开关**，画布层源码断言加了位置偏移常量（`METRICS_OFFSET_MAX`）、
  `rows[ri].def.tag`、`createLinearGradient` 与"下端 stop 全透明"三条；settings 规范化
  golden 夹具按「引入时行为」再补两个新键（脚本 `.test-cache/regen-golden-metrics.mjs`，
  安全阀 = host 侧其余键零漂移）。中英文案（README / HOW-IT-WORKS / 本文件）同步。

- **调整：资源柱状图居中 + 四边留白，新增「柱间距」与「序列名称」两个旋钮，滑块右侧回显数值**。
  **做了什么**：① 那组柱子不再贴着屏幕右下角 —— 整块在屏幕下方**水平居中**、四边各留
  一段固定留白（高度也会按视口高钳一次，窄窗口里不会顶到边）；② 新设置键 `metricsBarGap`
  （柱间距）管**同一行里相邻两根柱子之间的缝**，与柱宽、行间隔各管一维；③ 新设置键
  `metricsLabels`（序列名称，默认开）在**每一行的居中位置**用「外观」里设置的字体写出该行
  名称 —— 加粗、字色也取「外观」的文字色、**30% 透明度**、与行等高（行太矮或取不到字色就
  不画：它是装饰，宁可没有也不要噪点）；④ `SliderRow` 右侧那格从"只印单位"变成**回显当前
  数值 + 单位**，拖动期由控件就地改写同一格（面板全域生效，所有走 `SliderRow` 的控件都受益）。
  **为什么**：用户口径是"这是个壁纸插件 ⇒ 以美观为主"——贴边显脏、柱子连成一片看不出根数、
  拖滑块时看不到数值只能猜；名称叠在柱子上是为了"一眼知道哪行是哪个指标"，而 30% 透明度是
  **不挡柱子**的观感取舍。
  **判据**：verify-client 的「扩展」页签块补了 `柱间距` / `序列名称` 两个文案与 `柱间距` 的
  滑块上限，并新增**数值回显**断言（高度 `120px` / 柱间距 `2px` / 阈值 `80%` / 时间窗 `60s`，
  取的是 `we-picker__value` 那一格的文本），另在 SliderRow 形态判据里钉住"第三格是 `readout`
  而不是裸 `suffix`、拖动期就地改写"；verify-scene-live 的扩展岛判据改成 **13 参数 + 5 序列
  开关**，并新增一条画布层源码口径断言（居中留白常量、柱间距参与 pitch、行名绘制函数）；
  settings 规范化 golden 夹具按「引入时行为」再补两个新键（脚本 `.test-cache/regen-golden-metrics.mjs`，
  安全阀 = host 侧其余键零漂移）。中英文案（README / HOW-IT-WORKS / 本文件）同步。

- **新增：「扩展」页签一号模块 —— 硬件资源监控柱状图（屏幕右下角的实时资源柱）**。
  **做了什么**：设置页「扩展」页里多了一张模块卡，开关与外观参数（高度 / 柱宽 / 指标间隔 /
  阈值 / 不透明度 / 描边宽度 / 荧光强度 / 平滑 / 时间窗 / 实心柱 / 配色 / 五条序列的显示）
  都在卡内 —— 屏幕**右下角**叠加一组随时间**步进**的**荧光柱**：**一条序列一行**（CPU / 内存 /
  显卡 / 网络 / 磁盘自上而下**拼接**，行距可调），只有柱子，没有刻度、表头与坐标轴；柱宽决定
  一格多宽、时间窗决定铺多少格，于是"长"与"宽"是两个独立旋钮；比值**超过阈值**的柱子换成告警红
  （占各自满格的比例算，0 = 关闭标红）。值取自系统当前资源：**CPU**（`os.cpus()` 时间差分）与
  **内存**（`os.freemem()`）两条零子进程；**显卡 / 网络 / 磁盘**共用一条常驻 `typeperf -si 1`
  （`GPU Engine(*engtype_3D)` / `Network Interface(*)` / `PhysicalDisk(_Total)`），那条腿
  **只在 Windows 起、懒启动、无人请求 30 s 自停、失败即整体退场**（取不到的指标就不画，不糊假的
  柱子）。柱状图叠在壁纸图层之上（画布层排在壁纸与玻璃蒙层之后、`z-index` 为负、
  `pointer-events: none`，宽度按格数右对齐贴屏），配色默认跟随「外观」里的主题色。
  **为什么**：这是"后续功能都以模块形式挂在「扩展」页签下"的**第一例**，顺带把容器的加模块路径
  走通一遍（描述符住自己的文件、动作一律经具名处理器、真源仍在 `lib/settings-schema.js`）；
  柱状图而非折线是用户口径 —— 每秒一格更直观，也去掉了连续动画（不需要"减少动态效果"降级）。
  **判据**：verify-client 的「扩展」页签块断言锚文本（节标签 / 模块名 / 开关名）、`we-ext` 容器
  真的在树上、开关默认关时那批外观控件**不得**出现、打开后 18 个控件文案齐全、滑块上限与
  KINDS 对齐（高度 / 柱宽 / 指标间隔 / 阈值 / 时间窗 / 描边宽度），复位后不留状态；settings
  规范化 golden 夹具按「引入时行为」补入 17 个 `metrics*` 键（柱状图改造新增三键，脚本
  `.test-cache/regen-golden-metrics.mjs`，安全阀 = host 侧其余键零漂移）；路由表重算
  （`lib/routes/metrics.js` 是新的一条）。新增的四个模块（`lib/metrics.js` /
  `lib/routes/metrics.js` / `src/ext-metrics.js` / `src/metrics-layer.js`）都**补了真判据**，
  而不是登记进 `docs/GUARD-MAP.md` 的零覆盖例外表（那张表只许缩小）：verify-scene-live 现在
  直接 import 两个浏览器侧模块并真渲染一次扩展岛，另有一条采样器与那条只读路由的行为断言。
  中英文案（README / HOW-IT-WORKS / 本文件）同步。
  **顺带**：注册表从顶层常量改成**惰性函数** `extensionModules()` —— 顶层直接引用兄弟模块的符号
  会让"单独 import `src/panel-tabs.js`"的 verify-scene-live 判据当场 ReferenceError（第一版写法
  就是被它咬住的），改完这份源文件既能独立 import，也不再依赖注入顺序。

- **新增：第六个页签「扩展」—— 后续功能的模块容器（排在「关于」之前）**。
  **做了什么**：设置页从五个页签变六个；新增的「扩展」页整页只有一张注册表
  `extensionModules()`（`src/panel-tabs.js`，形状 `{ id, title, desc?, render? }`；一开始是顶层常量
  `EXTENSION_MODULES`，随一号模块一起改成惰性函数，见上一条）—— 表里登记过的
  模块各画一张卡，表为空就画空态（节标签 + 标题 + 一行说明）。**为什么**：此前每加一个功能都要
  动页签栏、`renderActiveTab` 的分派，以及一大串写着"五个页签"的判据与文案；有了这一页，后续
  功能**只往表里加一项**，页签本身、页签栏、指示胶囊都不用再改。**为什么排在「关于」之前**：
  致谢压尾是既有口径（「关于」仍是最后一枚页签），所以「扩展」占第 5 位。
  **判据**：verify-client 的页签计数 / 标签序列 / 胶囊宽度 5→6（「关于」仍判 `tabs[5]`），另加一条
  「扩展」页签的行为断言（节标签 + 空态文案 + `we-ext` 容器真的在树上 + 恰好只有它处于激活态 +
  别的页签的控件不得混进来）；verify-scene-live 的 `TAB_FNS` 收录 `renderExtensionsTab`；构建的
  markers 收录同名函数。中英文案（README / HOW-IT-WORKS / 本文件）同步。

- **修复（issue #129）：场景载荷的媒体源对非本机客户端不可达，且那次失败会把本机一起拉黑**。
  1.2.0 把场景载荷的源换成了宿主起的独立 loopback 媒体源（`inventory.sceneMediaBase`，
  `http://127.0.0.1:<port>`）—— 对**任何不在这台电脑上运行的客户端**（远程桌面 / 代理进来的
  设备），`127.0.0.1` 指的是它自己 ⇒ 取 `scene.pkg` 必然失败；渲染页的诊断信标也打同一个源，
  排查窗口一起关掉；而失败归因看的是**跨实例累积**的宿主账本（`completed>0` 永久为真），
  那次失败被误判成「渲染侧」写进**所有窗口共用**的持久失败记忆 —— 本机从此也只显示静态垫底图。
  三处修：**① `mediaBase` 按页面可达性给**（`resolveSceneMediaBase`：页面自身在非本机
  http(s) 源上时回落页面 origin，即 1.1.0 的行为；本机 / 壳内自定义 scheme 维持媒体源）；
  **② 归因要求本看护窗口内的整包完成证据**（账本从没见过这个 token / 窗口内 `completed`
  没涨、`served` 没涨够一个整包 ⇒ 一律按传输侧软失败，不落盘）；**③ `stall`（运行期无帧）
  也降为会话内软失败**（失焦/被遮挡窗口的"无帧"不是"渲染不出来"的证据），与传输类同级：
  只记会话内、冷却 45s 自动重试。顺带补上 vendored 的 `default-wallpaper/index.html` 兜底页
  （渲染页在场景解析失败时的可见落点，上游 public/ 下的静态文件，sync-webwallgl 现在会一并拷）。
  判据：verify-scene-live 重写/新增 6 条（mediaBase 判定式、三态账本读数、窗口内证据、
  stall 软失败、重试认一切软失败、兜底页在位 + 同步脚本 + 缓存头）。
- **修复（issue #131）：开启「左侧栏覆盖」后，收起/展开侧边栏按钮下移、收起态不可见**。
  根因是 CSS 规范的**包含块**规则：非 none 的 `backdrop-filter` 会让元素成为**其后代
  `position:fixed` 元素的包含块**。宿主在 Windows 标题栏模式下把「收起 / 展开侧边栏」按钮与
  收起态的「新建会话」按钮都设成 `position:fixed` ⇒ 它们从「相对视口」变成「相对左栏」：
  列的上边被 `[data-windows-titlebar]` 的 `padding-top` 推下去（按钮整体下移一个标题栏高度），
  而收起时这一列的网格轨道宽度是 0、又自带 `overflow:hidden` ⇒ 按钮被整块裁掉（展开按钮不可见）。
  修法：玻璃配方里**只把 `backdrop-filter` 那一对声明**搬到左栏的 `::before`（伪元素没有后代，
  永远不会成为任何 fixed 元素的包含块），列自己拿 `position:relative` + `z-index:0`
  （把伪元素的 `z-index:-1` 圈在列内）；软件光栅器回退同步显式关掉 `::before` 的模糊。
  底色 / 釉光 / 边框 / 令牌留在列上，玻璃与文字层次不变。判据：verify-glass-compositing 的
  S2c（三态声明形态 + 「把模糊种回列自身即判红」负对照）+ S2c2（回退覆盖），另配真浏览器探针
  实测（修复后 fixed 按钮相对视口 top=20、收起态仍命中；复刻修复前 top=列顶+20、收起态被裁掉）。
- **修复（issue #127）：文字与背景同色（黄底黄字 / 白底黄字）**。两层根因都在 accent 重映射：
  **① 宿主 primary 控件的契约是「填充 × label-primary-foreground 反色墨」成对随主题翻转**
  （dsh-client-ui-primitives/Button.module.css），我们把填充重映射成**任意亮度**的用户配色后，
  主题静态墨不再保证可读（浅色配色 × 浅色主题墨 ≈ 1.5:1）—— 新增 `--we-accent-ink`
  （effects.js 按 WCAG 相对亮度选黑/白），整窗映射把它接到 `--dsw-alias-label-primary-foreground`，
  hover 从「往白混」改为「往墨混」；我们自己的 `.we-picker__btn--primary` / `.we-picker__tab--active`
  同步改用墨色。**② accent 名字空间泄漏**：第三方 settings 分区若拿 `var(--we-accent)` 当
  文字色（无兜底），落在我们重映射成 accent 的填充上就是**逐像素同色**（实测按钮内部
  8250 像素全部是同一个 #FFCF4D）—— 设置窗内把 `--we-accent` 掐成 `initial`（无兜底的
  var() 回落继承色 = 它们原生外观下的颜色），`.we-picker` 根从 body 的 `--we-accent-src`
  重新别名，窗内消费面不变；`--we-accent-ink` 同时作为**受支持的配对 token** 供给第三方分区。
- **玻璃覆盖面第二批（issue #71 附带的 glass-patch.css 收编）**：把壳层其余能画出实色面的
  别名 token 折进同一张玻璃 —— `bg-overlay`（弹层）、`bg-module-platform`、`bg-multi-select`、
  `button-floating-fill`、`button-ghost-active-fill`、`button-tool-bar-fill`、
  `interactive-bg-active`、`interactive-bg-hover-solid`、`markdown-citation`、
  `markdown-placeholder`。层权重沿用那份补丁的角色分档，但**每条都包上可读性下限**
  （#82 的配方），语义状态色与 accent 系按补丁原文保持原生；亮/暗两套逐条同形。
- **排障文档**：新增「安装失败：`generation peer validation failed`」一节（issue #116/#117 的
  根因 = 宿主 DSH 核心 < 0.2.0-rc.1，含 `dsh --version` 自查与「桌面端版本号 ≠ 核心版本」的说明）。

- **内部：契约守卫的覆盖面补齐 + 注释审计 + 「哪个守卫管哪个模块」的派生映射**（**无用户可见行为变化**；
  产物 `lib/client.js` 只少了注释与一处死状态）。三件事：
  **① 字段写入契约**：`selection.<字段> = …` 的裸直写在 `client.js` 之外共 126 处，而在册棘轮只看得见 11 处
  —— 扫描面原先按**目录项名**判扩展名（`filter(f => f.endsWith('.js'))`），于是 **`src/font/` 整个目录隐式脱出**，
  `lib/settings-schema.js` 也从未被扫过。现在扫描面**从 `INLINE_MODULES` 派生**（真源），并补覆盖面地板、
  负对照与回归探针；「既非持久化、也非瞬态」的 27 个「模块×字段」收进**可枚举的登记表**
  （零 unknown / 表不空转 / 每条有书面理由）。顺带删掉**死状态** `fontSetLoaded`（只被写、全仓无消费者）。
  **② `src/` 的十个模块补上 `export {}`**（`CODE-STRUCTURE.md` §5 第 5 条：导出清单同时是**守卫的接口**），
  产物**逐字节未变**；`verify-picker-model` 因此改成**直接 `import` 源模块**做行为断言，并与产物**双通道对拍**
  （24 条用例）+ **自足变异探针**证明判据有牙。
  **③ 守卫映射**：新增 `test/tools/guard-targets.mjs`（从守卫**代码**派生它碰的模块，不维护清单）与生成物
  [`GUARD-MAP.md`](./GUARD-MAP.md)（守卫→模块、模块→守卫两张表），配软档判据 `test/verify-guard-map.mjs`
  （零覆盖可枚举 + 生成物逐字一致 + 覆盖面地板）。**改某个模块后查这张表就知道该跑哪几条。**
  **另修**：`scripts/build-client.mjs` 的"撞名提取"原先要求行首，会漏掉把顶层声明写了一层缩进的模块
  ⇒ 撞名不被判出（平铺后是运行期 SyntaxError）；导出块剥除同样漏缩进形态。两处都改成
  「缩进 == 本文件声明的最小缩进」。
  **注释审计**（28 个模块全扫过）：只清**引用已删代码 / 内部账本编号**的溯源（issue 号 13 处 · 已删档位 2 处 ·
  已删文件 1 处 · 分期标记 14 处），把**会漂的数值搬进符号**（`连续 20s 无帧` → `LIVE_STALL_TICKS` 等），
  并**改口**三处与实现不符的注释（含一处**实现与注释相反**的：属性面板早已是"页内下钻"而注释仍写"内联展开"）。
  `实测出处` 与「为什么这么做」的决策理由**按 §写作纪律 2 保留**（23 处宽口径候选里只有 3 处该删）。

- **左侧栏那一列的竖分割线不再画（现场口径："左侧边栏右边框线不要显示，即使全局设置了边框拉到了90%"）**。
那条线此前是**刻意补**上去的（darwin 壳层把原生竖分割线置为 none，补回来图个"与其他面板口径一致"）。
现在改成明确的 `border-right: none`：这一列已经是一整块玻璃，再画一条竖线就把它与会话区切成两半。
  - ⚠️ 必须是**显式 none**、不能只删那行声明：非 darwin 壳层自己有一条读 `--dsw-alias-border-l3`
    的边框，删声明会让它在别的平台上回来；
  - 「边框」滑杆对这一列**内部**的描边（「新建会话」按钮、焦点环等读 `--dsw-alias-border-l3`）**依旧生效**，
    只是不再画这一列自己的外沿；
  - 守卫：verify-glass-compositing 新增 S2 —— 判据看的是**声明形态**（必须显式 none 且不再跟 `--we-border-alpha` 联动），
    配"把随滑杆变浓淡的发丝线种回去即判红"的负对照；S2b 另钉住那条内部令牌映射仍然在场（别把滑杆一起废掉）。
- **侧栏玻璃改为跟随全局（用户口径："我需要侧栏玻璃也跟随全局"）**。此前两侧栏是两套独立配方，实测差异（深色主题，按现场配置推算）：
左栏（原生左栏）= 中性 #1c1c1c、合成不透明度 **0.63**、模糊 **10px**；右栏（dsh-better-sidebar）= 青色 #67DCE7、**0.76**、模糊 **37px**。
而且**滑杆调不成一致**——差异是结构性的，不是数值性的：
  - **颜色管线不同**：左栏把玻璃色经 weClampSurfaceColor 钳进可读亮度带（深色下 #ffffff → #1c1c1c，
    连 #67DCE7 都会被钳成 #0e1f20），右栏**原样**用；⇒ 深色下左栏永远做不出右栏那种青。
  - **色染曲线区间不同**：左栏 `--we-glass-alpha` ∈ 10%–25%，右栏 `--we-sidebar-tint` ∈ 20%–48%（反向映射）。
  - **模糊源不同**：左栏吃全局「雾化」，右栏吃「侧栏模糊」。
改法（新增设置键 `sidebarFollowGlobal`，**默认开**）：
  - 跟随态把侧栏那套变量**指向**全局三件套（`var()` 惰性替换，不是拷贝）：
    `--we-sidebar-blur: var(--we-blur)`、`--we-sidebar-saturate: var(--we-saturate)`、
    `--we-sidebar-tint: calc(var(--we-glass-alpha) * 100%)`、`--we-sidebar-color: var(--we-follow-tint)`；
  - 新增样式表变量 `--we-follow-tint`（按主题取**与其余面板同一个**钳制色；不能由 JS 内联写死，否则盖掉"按主题"）；
  - 侧栏的釉也分两档：跟随态取与左栏同一道 `--we-panel-sheen-*`，自定义态保留旧的"随透明度衰减"曲线 ⇒
    **两侧栏逐字段一致**（真 Chromium 实测：浅色两侧同为 color(srgb 1 1 1 / 0.505)、深色同为 …/ 0.631，模糊同为 blur(10px) saturate(1.3)）；
  - 三个独立旋钮（侧栏模糊 / 侧栏透明度 / 侧栏玻璃颜色）**只在关掉跟随时出现**（画了就是"设置了不生效"）；
    内容面两个旋钮（内容面透明度 / 底色）**不受**跟随影响 —— 它们管语法高亮 / ANSI 的可读性，不是玻璃外观；
  - 守卫：verify-glass-compositing 新增 S1（把跟随映射代进两侧栏声明后必须**逐字相等**，配"换一个色染权重就不相等"的负对照；
    另判 `--we-follow-tint` 与 `--we-readability-base` 同源、两档釉的规则与属性都在）；verify-client 的侧栏判据改成两档
    （跟随态三旋钮隐藏 + 属性在场，关掉跟随三旋钮回来 + 属性摘掉，再打开收回）；设置规范化 golden 按既有约定补入新键（18 例各一个 true）。
- **轨迹（trajectory）视图的内容区补霜（用户口径："轨迹内容区域也同样做玻璃化"）**。查下来根因**不是**"没映射令牌"：
轨迹模块的内容容器（`.rkta1W_split` / `_overviewPreview` / `_programPanel`）读的就是 `--dsw-alias-bg-layer-1`，
而那条**早就**被映射成玻璃配方了 —— 也就是说它其实已经**半透明**。真正缺的是**霜**：实测整个轨迹模块
**289 条规则里一条 `backdrop-filter` 都没有**，于是它在壁纸上只是"平涂的一层纱"（高频壁纸下细纹原样透出、
文字与纹路打架），读起来就是"没玻璃化"。
  - 改法：给三个内容面补上**与侧栏面板同一档**的霜 + 镜面釉 + 内高光，**只补霜、不叠第二层底** ——
    父层已经拿到玻璃配方，再叠一层会让两层可读性下限相乘（0.494 → 0.744），正好把想要的通透收回去；
  - 选择器只用**轨迹模块独有**的类名子串（实测 `_tablePane` / `_overviewPreview` / `_programPanel` 全宿主
    只有轨迹模块在用）；`_details` / `_split` 别的模块也有 ⇒ **不碰**（宁可少盖一层也不误伤别处）。
    CSS 模块哈希是构建产物，稳定的就是 "_<类名>" 这半边（与 `[class*="_bubble"]` / `[class*="_panel"]` 同一手法）；
  - 实测该模块里**没有 `position:fixed`** ⇒ 在这里加 `backdrop-filter` 不会让 fixed 后代改锚（#89 那类问题）；
  - 回退档无需额外处理：那条 `--dsw-alias-bg-layer-1` 已被钉回不透明面板色，底下不再是壁纸；
  - 守卫：`verify-glass-compositing` 把这三条选择器加进 **REQUIRED carrier 清单**（霜掉了就红），并新增 T1 判据
    「轨迹的补霜规则**只补霜**、不许叠 `background-color`」——**配负对照**（往那条规则里种一层底 ⇒ 判出 3 条，
    真实 CSS 判出 0 条；负对照按**选择器**定位，因为产物把内联模块整段缩进过，按声明空白字面量定位会假绿）；
  - 裁定真源同步：`harness-ui-surfaces.json` 里 `dsh-client-ui-trajectory` 从 `native` 升为 `covered`
    （现在有逐面适配了，不再是"只靠全局令牌"）。
- **对话区内的代码块与"重点文字"背景也玻璃化（用户口径）**：用户要求"代码块和重点文字背景也需要和对话框背景一样进行玻璃化覆盖"。
这几条底以前是**刻意不接管**的（裁定写在 `test/fixtures/harness-ui-surfaces.json` 的 `tokenScope.declined`：代码块底是 shiki
固定配色的画布，透出壁纸怕把注释 / 字符串压到不可读）。现在改为**把底也纳入同一条可读性下限**：
  - 先实测：这几条别名**不是**层令牌的派生（宿主给的是 `--dsw-static-neutral-bluish-50/900` 这类**静态**调色板），
    所以先前"映射 `--dsw-alias-bg-layer-*`"那条路对它们纹丝不动 —— 必须逐条映射；
  - 接管的令牌（**从宿主产物里实测得到**，不是猜的）：`--dsw-alias-markdown-code-block`、`-code-block-banner`、
    `-inline-code`（行内代码 = "重点文字"）、`-tag`、`-code-segment-unselected`、`-code-segment-selected`；
  - 配方与气泡**逐字同一张表**：`主题底色 @ 可读性下限 + 玻璃色 @ 玻璃透明度`。**shiki 的前景色一个都不动**，
    于是玻璃感进来了、代码配色的对比仍由下限兜住；层权重沿用既有层级规矩：代码块与标题条 = 气泡那一档（0.8 / 0.4），
    行内代码 / 标签 / 未选中分段高半档（1.0 / 0.5 —— 小色块要"比底稍亮"才留得住 chip 读法），
    选中分段再高一档（1.15，与抬高按钮同档：选中靠"比未选中更亮"读出来，而不是回到实色）；
  - **回退档**：无 `backdrop-filter` / 软件光栅器时这六条一律钉回不透明面板色（半透明 + 无霜 = 代码直接压在花壁纸上）；
  - 裁定真源与真机探针同一次改判：`harness-ui-surfaces.json` 的 `declined` 条目移入 `mapped`，`compat-harness-pages`
    里那条"刻意不接管"的判据改成"按新裁定接管为玻璃（回退档钉回不透明）"；
  - `verify-readability` 的表面表 27 → **39 条**（这六条令牌 × 明暗），F2a 全绿 —— 即"底变玻璃"这件事
    **没有**把任何文字面放到壁纸上。玻璃浓度仍由「玻璃透明度 / 玻璃颜色」两个滑杆统一控制（不新增开关）。

- **视频壁纸拆成独立通道，并且"没画面就不上屏"**。视频档此前走的是为 WebGL 场景设计的实时管线
  （切层内容闸门 / 垫底图 / 心跳 / 载荷 / GPU 抓帧，其中只有一部分对视频有意义）。实测两条后果：
  ① 闸门的视频判据是"手上已有一帧"（`readyState ≥ 2`），而视频档**故意不设 poster**（WE 的
  `preview.gif` 当 poster 会"先播预览、再进正片"）⇒ 整次切换（含过场）被推迟到首个可解码帧，
  源越大 / 上限越高越久，从秒级退化到十几秒；② 闸门**预算到期就放行**，于是"还没有画面"的那一瞬
  被直接铺到屏上 = 用户盯着一整块**纯色**（真机日志：`gate-arm … budget` → `gate-open why=budget
  rs=0` → 1–2 秒后才 `loadeddata`）。
  改动：`src/video-layer.js`（视频通道：就绪判据 + 放行策略 + 转码触发）与 `src/layer-core.js`
  （两条通道共用的切换核心：层退役 / 过场内联样式 / 可见性复推）从实时管线里抽出来，实时管线只留
  一次委托；放行改成**只认当下这一帧**（海报图**已加载** —— 属性存在不算 / `readyState ≥ 2`），
  预算到期从"放行"改成**停滞判据**（每 1200ms 复查，只有屏上真有东西才放行；15 秒仍无画面就
  **继续留旧壁纸**并记一条 warn，绝不铺底色）；抽帧换源只在"层还被闸门押着"或"用户刚主动改上限"
  时落地（在已上屏的层上换源会清掉当前帧 = 纯色）。围栏判据 `CHANNEL_FILES × LIVE_ONLY` 保证通道
  **不引用任何实时专属符号**，并配**反空转地板**（清单里的符号必须仍真实存在于实时模块，
  否则"围栏"会退化成查一份空名单）。

- **切换延迟 0.5–2s 的根因：源的 moov 在文件尾部，而播放器会顺流整读整个文件**（修法是 faststart
  变体）。真机取数取证（本次一并删掉的临时插桩）：播放器对 `/media` 的第一个请求是
  `Range: bytes=0-`，随后**把整个文件读完**才报 `loadedmetadata` —— 764,688,296B/1761ms ·
  501,752,315B/1250ms · 155,604,213B/357ms · 101,749,329B/324ms（≈430MB/s）。这几张源的 moov 都在
  **文件尾部**（`moovStart≈EOF`）⇒ 元数据时间 ∝ 文件大小，切层闸门就一直押着旧壁纸
  （`held=1668/2860/3340ms`，与文件大小一一对上）；而同一张 iris2（729MB）在"页面刚加载后的第一张"
  那条路上只要 149–233ms。同一份取证顺带否掉四条候选（都有读数）：`document.hidden` 全程 0
  （不是遮挡节流）· Range 回 206 且 `Content-Range` 正常（不是 Range 被吃）· `load()/src=` 调用栈
  为 0（不是插件自己在重启元素）· "上一个壁纸也是视频"与不是视频时 `loadedmetadata` 中位相同
  （578 vs 586ms，不是解码器竞争）。
  改动：宿主对 moov 不在头部附近（>1MB）的 mp4/m4v/mov 做一次性 `ffmpeg -c copy -movflags
  +faststart`（**不重编码**，实测 729MB/0.92s），按"源路径+大小+mtime"缓存（`fs_*.mp4`，8GB LRU、
  命中即顶 mtime 且同一份 5 分钟只写一次盘），`/media` 命中就改发变体 ⇒ 播放器第一段就拿到 moov，
  与文件大小无关（端到端实测：`Range: bytes=0-511` 回 `ftyp@4 moov@36`，原片 moov 在
  764,643,145）；**同一 token 在一次宿主运行里钉住同一份字节**（原片与变体的字节偏移不同，
  绝不允许一次播放中途换文件）；变体预热按"轮换列表优先 + 其余视频"**串行**生成，按源字节卡
  6GB 预算。客户端另加**提交前预热**：指针按下 / 停在卡片上就把它预到元数据
  （`preload=metadata`、**不 `play()`**、单槽位、TTL 20s），点击时领养那个元素 ⇒ 建层那一刻
  解复用器已在位（不引进第二个 4K 解码器）。
  判据：`verify-scene-live` 的"字节布局钉住 / 只搬盒子（`-c copy -movflags +faststart`）/ 缓存上限 /
  顶 mtime"，以及①的四条（只到元数据 · 不 play · 领养元素不重赋 src · 触发点是卡片身份标记
  `data-we-id`）。

- **帧率上限的口径改回"上限能不能真降帧"，档位收敛，并修掉一处会杀宿主的崩溃。**
  背景：上一版把"原生可解"当成了"不必抽帧"的充分条件，但"容器能不能原生播"与"帧率是否高于上限"
  是两件事 —— 4K120 的 H.264 既原生可解、又远高于任何上限 ⇒ 上限在实际在用的 mp4 上**完全失效**，
  只剩一句面板文案；而它的全部意义就是压 GPU 解码占用（Video Decode 随帧率上升，是壁纸里最大的
  一块；v1.1.0 一节记过 4060 实测 4K120→24fps 后从 ~60% 降到 ~15%）。
  改动：判据换成 `capNeedsTranscode()` —— **源帧率高于上限（+1 帧容差）才抽帧**，与容器能否原生播
  无关；"原生可解"只保留给**源帧率读不到**时的成本护栏（不为一个未知帧率整片重编码）；建层认领
  抽帧版的判据同步去掉原生可解条件（否则会"建层用抽帧版 → 随即判 native 又退回原片"，白跑一次
  换源）；面板文案改成「 · 源帧率未知，未抽帧」（中英同步）。档位收敛为 **无限制 / 60 / 30**
  （60 = 120fps 源砍半，30 = 60/50fps 源砍半；退役 48 与 24），存量 48/24 由枚举值域
  **clamp 回缺省 0（无限制）**，不需要迁移代码（实测 `sanitizeFromSchema({fpsCap:24})` → 0）。
  崩溃：新加的 faststart 助手是**模块级**函数，而它在失败分支里引用了只存在于 `apply()` 作用域的
  `log` ⇒ `ReferenceError` 抛在 catch 里 ⇒ 那个 async 任务以 reject 收场且无人接管 ⇒ Node 24 按
  **未处理拒绝**杀掉宿主进程（崩溃日志原文：`dsh: fatal load failure: ReferenceError: log is not
  defined at lib/index.js:1235`）⇒ DSH 反复重启宿主、壁纸一直出不来（用户看到的是"开屏纯色帧 +
  切几张后 DSH 崩溃重启"）。修法：日志一律经参数注入的 `say`（可缺省、异常不影响流程），
  并给任务挂兜底 `job.catch`。
  判据：`verify-logging` 新增 **N8**（把 `apply` 的函数体整段抠掉后，模块级源码里不许出现
  `log.<档位>(`，含可失败对照 —— 合成一条模块级 `log.warn` 当场判红）；`verify-transcode-state`
  的夹具改成**原生可解的 mp4/avc1**（原来写 `hvc1` ⇒ 走的是"非原生必须转"那条路，上面的回归
  **在夹具里根本看不见** —— 这也是上一版没被拦住的原因之一），并新增行为判据「原生可解 +
  源 120fps + 上限 30 ⇒ 仍然抽帧」；变异测试验证过：把旧口径放回去，这条会红（5 条 FAIL）。
  `verify-scene-live` ② 组重写为三态口径（高于⇒转 / 不高于⇒skip / 未知⇒原生护栏）+ 负对照
  （把"原生可解"写回免转条件会被判出）；档位退役后夹具里 24/48 的按钮与断言全部改用 30/60。

- **删掉两处临时取证**：客户端 `video-tl` 时间线探针（含包 `load()`、实例 `src` 访问器、
  200ms/3s/15s 定时器）与宿主 `media-req` 取数取证 —— 它们只为定位上面两条，现已收口；
  结论与读数留在判据与上面的条目里当依据。

- **文档瘦身：撤掉活账本、清空 `wip/`、删掉已迁出仓库的归档线与三份英文镜像**
  （**50 → 41 个文件 / 11,178 → 6,625 行，−41%**；目录规则同步写进
  [`docs/README.md`](./README.md)）：
  · **重构账本退场**：`docs/wip/OPEN-ITEMS.md`（277 行，**71 条 ✅ 对 1 条 ❌ / 1 条待定**）按本仓自己的
    寿命规则（"描述**尚未完成**的工作…**完成即整体移入 `docs/archive/`**"）整体归档到
    `docs/archive/wip/`，并补上政策要求的状态横幅。它活着的内容挪去了更好的家：**行为缺口**（挂住时留旧层 /
    页面首帧底色 / 裸 iframe）→ [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) 新增的「**已知行为边界**」；
    **令牌层约束（§9.1 的 `V1–V10`）** → 由守卫执行（`verify-readability` / `verify-glass-compositing`），
    `FONT-SYSTEM.md` 的引用改指守卫；§2 基线 / §7 触发线的机器那半边本来就已由棘轮与
    `verify-route-families.mjs` 承担。它自称"唯一还活着的账本 / 状态列是唯一进度真源"早已不成立：
    逐行核对的账本守卫随 [`adr/0006`](./adr/0006-comment-discipline-as-written-convention.md) 下线，
    且**零代码 / 测试引用**（`git grep` 实测）—— 需要看守的东西一律写成守卫，账本会漂且漂了不会变红。
  · **`docs/wip/` 撤除**：另两份（`POST-REFACTOR-AUDIT.md` 收官审计——它开出的 P4 条目已全部收口；
    `SIDEBAR-TABS-DESIGN.md` 侧栏页签设计——已随 v1.1.0 → v1.2.0 发布）一并归档到 `docs/archive/wip/`，
    各补状态横幅。`docs/` 从此只有一条不变式：**常青 + ADR + 用户向 en + 归档**。
  · **删静态帧归档线**：`docs/archive/static-frame/**`（15 个文件 / 4,347 行 / 约 370 KB）—— v1.1.0 一节
    早已写明该线迁往 [`YV3507/we-static-frame`](https://github.com/YV3507/we-static-frame) 后"将由其它
    贡献者在下次更新移除"，本次执行；长尾记录交给 git 历史。
  · **英文维护者镜像撤除**：`docs/en/{CODE-STRUCTURE,DEV-GUIDE,FONT-SYSTEM}.md`（890 行）—— 读者是维护者
    本人，双语只是双份维护成本；面向用户的 `README` / `UPGRADING` / `HOW-IT-WORKS` / `TROUBLESHOOTING` /
    `CHANGELOG` 仍中英成对（先例：`en/UPGRADING.md` 早就写过 "CHANGELOG (Chinese only)"）。

- **修掉一处"本地全绿、推上去 0 秒失败"的 CI 故障，并补上钉住它的判据**：`verify.yml` 的
  `concurrency` 原先挂在**工作流级**、组里带 `${{ matrix.os }}` —— 而 `matrix` 只在**作业**上下文里
  存在 ⇒ GitHub 在启动阶段就把整个工作流文件判为无效：push 后 run **0 秒失败、`jobs=[]`**，页面只说
  "This run likely failed because of a workflow file issue"。**实测形态**：本次 CI 检查里 `46a1d2a` 与
  `7515c7f` 两次推送都是这个形态（0s / failure / 无作业），而更早的推送是 50s 正常跑完的。
  改成挂在**作业**上，语义不变（一次新 push 取消的是**同一平台**的上一次 run）。
  判据：`test/verify-contracts.mjs` 新增 **⑤** —— `jobs:` 之前那一段里不许出现 `matrix` / `strategy` /
  `steps` / `needs` / `job`（含负对照与"至少一个工作流在 `jobs:` 之后真的用了 `matrix.`"的反空转地板）；
  `docs/DEV-GUIDE.md` §4.3 同步写明这条坑。

- **修掉"产物跨平台不一致"的根因**（ubuntu 腿查出来的第二处）：`src/i18n-copy.js` 历史上以 **CRLF 入库**
  （其余入库文件都是 LF 入库）且其中 **28 行是 `\r\r\n` 双 CR**。构建只做 `\r\n → \n` 归一化 ⇒
  Windows 检出（`core.autocrlf=true` 把双 CR 放大成 `\r\r\n`）会**残留一个孤立 CR**，而 Linux 检出是
  `\r\n`（被归一化掉）⇒ **同一份源码在两个平台产出不同字节的 `lib/client.js`**：commit 哪一份，另一条腿
  的「产物与源码同步」（`git diff --exit-code -- lib/client.js`）都会红 —— 实测 ubuntu 腿红、win32 腿绿，
  且**本机怎么跑都看不出来**。
  改动：① 该文件连同异常行一并归一化成 **LF 入库**（与其余文件同口径）；② `scripts/build-client.mjs`
  的构建输入改走 `readNormalized()` —— 归一化后**断言不再有孤立 CR**，有就点名文件并让构建失败
  （宁可红在本地，也不要产出一份平台相关的产物）。现在本机重建的产物与已入库那份**逐字节相同**（CR=0）。

- **修掉上游 v1.2.0 带进来的一处不可运行测试**：`test/repro-sidebar-props.mjs`（侧栏「壁纸属性」的
  真产物复现台）把仓库根**写死成作者机器的绝对路径** `/Users/oneincase/Documents/workspace/
  dsh-wallpaper-engine` ⇒ 在任何非 mac 机器上 `readFileSync` 直接 `ENOENT`（Windows 上还会被解析成
  `D:\Users\oneincase\...`）。改成与其余测试同一口径：由本文件位置推（`new URL('../',
  import.meta.url)`）。
  **给上游的建议**：把这条复现台接进 `verify` 守卫链 —— 它跑的正是替身台看不见的**作用域**错误
  （`renderUserPropsPanel is not defined` ⇒ React 卸载整棵树 ⇒ 整页空白），而它不在任何链里，
  所以 CI 跑不到、写死路径这类问题也就能一路过去。
  另记：`verify-dead-declarations` 报的 `tabBodyOf`（独立脚本面引用顶层声明）是**上游自带**的
  warn-only 项 —— 在干净的 `origin/main` worktree 上同样红，不是本仓引入。

- **渲染用例补上三种"锚"，并借此补掉五处真实覆盖缺口**（P4-19 收尾的覆盖面部分）。
  起点是一个反例：`renderWallpaperTab`（456 行）在挂载台上**只吐出 3 个控件标签** —— 因为
  `editing` / `groups` / `uploadedList` / `propsPanelOpen` 这些门默认全关着，四节里约 **410 行**
  从未被渲染过。同类缺口另有两处：外观页字体节的细节被 `sel.fontCustom` 挡着（**~180 行**）、
  效果页的实时渲染组因挂载台**一个替身都没给**而连"渲染得出"都过不了。
  ⇒ 补了**三种行为锚**（都对任何重构不变，各配正/负对照）：**标签锚**（`labelSeq`，认走
  `SliderRow`/`switchRow`/`ctlText` 的行）· **类名锚**（`classKinds`，认"画了哪些构件" —— 墙纸档
  门后的裸 `input`/`select` 只它看得见）· **文本锚**（`textKinds`，认"渲染出哪些文案" —— 转码进度
  那一行五个分支**只差文案**）。门的**两侧**都钉住：开门侧 `wantClasses`、关门侧 `rejectClasses`
  （只钉开门侧的话，"把门拆掉、永远画编辑器/列表"也会绿）。
  用例 3 → **19 档**（墙纸 5 / 外观 3 / 效果 11），配两条**覆盖面地板**（用例数、带期望条数）、
  一条 `want` 地板、一条**锚体系地板**（三种锚各须被真的用上）与一条 `wantTexts` 地板。
  ⚠️ 本轮实测过一次**静默失败**：补丁把新用例插进了上一条的 `ctx:` 构造器里 —— **语法合法却
  从没被迭代到**，判据一条没加而套件照旧全绿（靠"通过数没动"才发现）；另加一条**"守卫的守卫"**
  静态断言每条 `sameSeq(...)` 与三处锚调用都被 `if (t.<字段>)` 包住 —— 它上线时当场抓到
  `sameSeq(seq, t.want)` 未守卫（**缺守卫时是"崩"而不是"判红"**，比判红更隐蔽：一条结论都不留）。
  **顺带修掉的真实缺陷**：挂载台没给实时渲染组的替身（那几十行从未执行）· `FRAME_VARIANTS` 被设成
  **空数组** ⇒ 场景档读 `FRAME_VARIANTS[i].label` 直接抛（**空替身把分支变成不可达**，是"覆盖率为零"
  的另一种伪装）· 转码行的门还要求 `sel.transcodeState === "working"`（漏了就永远不画）。

- **`renderEffectsTab` 拆成五个块：先给它造了一条更细的锚**（P4-19 余项）。它是最后一个百行级渲染器，
  却**只有一个节标签** ⇒ "节顺序"钉不住它的内部结构。于是先把 `SliderRow` / `switchRow` / `ctlText`
  的标签**从渲染替身里放回树里**（原先 `noop` 把它们吞成 `null`），"**控件标签的有序序列**"就成了
  可判的行为事实 —— 对任何重构不变，却细到能看见"某一行被挪了 / 被删了"：
  效果页设置档 10 个标签、侧栏档 9 个（少的正是 `帧率上限`，与那条侧栏豁免一致）；
  外观页设置档 7 个、侧栏档 5 个（少的三节来自 `!sidebarSurface` 那条门）。
  锚立住后才拆：`renderEffectsTab` **270 → 39 行**（父函数 = 空态提前返回 + 唯一的节外壳 + 五块组装），
  内容分成 12 / 42 / 80 / 78 / 21 行的五个子渲染器。
  **连带修正一处判据口径**：`verify-scene-live` 的"侧栏 ctx 要覆盖渲染器全部字段"原先只读
  `render*Tab` 那一层的解构 —— 字段搬进 `render*Section` 之后它读到空集而变红。**它红得对**，
  是判据的口径没跟上代码：改为连节函数一起收（候选字段 8 → 70）。

- **收 body 的管道收敛成一份实现：新建 `lib/http-body.js`，9 个站点改走它**（审计 §6.2，P4-13）。
  此前**11 个站点各抄一份**"累加 + 按累计字节计闸 + 收完解码"的逻辑，两个代价都真实发生过：
  **抄漏上限**（新加的路由忘了抄闸）、**改一处要改十一处**。现在这两件事各归其位 ——
  前者继续由 `test/verify-body-caps.mjs` 从磁盘枚举看住，后者由共享读体器 `bodyReader()` 解决。
  **它只吃真正重复的那三件事**（累加 / 计闸 / `Buffer.concat` 后只解码一次）：应答、超时、断开
  收口仍留在各调用点 —— 各站的策略本来就不同（有的 `fail(413)`、有的直接写 `res.statusCode`、
  有的还要等落盘），把它们也抽象进来只会把差异藏进参数里。
  **分类是实测的，不是估的**：11 个收集器 = **9 个"缓冲"站点**（改走共享实现）+ **2 个"流式落盘"
  站点**（`/upload` 的 512MB 与 `/custom-frame`，边收边写 `.tmp` + 背压）。后者是**结构性豁免** ——
  它们的文件头早就写着"**不得**把 512MB 的请求体整个缓冲在内存里"，所以判据里也是按"豁免"记，
  不是按"漏了"记。
  **判据与实现同交**：`verify-body-caps` 从"每个站点都要有闸"升级为五条 —— 内联收集器必须有闸
  （逐站点名，流式那两处也在这里被点名）· 内联收集器数 **≤ 2** 的棘轮 · 共享读体器调用点 **≥ 9**
  的地板 · 每个 `X.onData` 必须真的来自同文件的 `bodyReader(...)`（`foo.onData` 蒙混不过去，
  带负对照）· 以及**调用点里被置位的标志必须在它之前声明过**。`verify-scene` 三条"体积判定与
  用例一致"的 `needle` 随之从 `size > X` 改指 `maxBytes: X`（同一个事实的新位置，不是放宽）。
  ⚠️ **迁移过程实测踩中一条真 bug 族，并且暴露了行为判据的盲区**：把 `let done/tooLarge = false`
  从内联回调里挪走时**漏声明三处** —— `shouldStop` / `onOverflow` 是闭包，少一行声明就要等到
  "这条路由真的收到请求体"才炸 ReferenceError。行为判据只抓到 `/client-diag` 一处；
  **`/we-assets-dir` 那处没有任何用例往它 POST 过体**，纯静态判据才看得见 ⇒ 第五条判据就是为这个
  盲区补的（只认 `NAME = true|false|数字` 的布尔/计数标志形态，字符串里的 `charset=utf-8` 不误判），
  **牙齿实证**：去掉一处声明 ⇒ 红并点名 `lib/index.js:tooLarge`。

- **账本真源修正：三处已经失真的说法**（`docs/wip/OPEN-ITEMS.md` 自称"状态列是唯一进度真源"，
  而它有三处是错的 —— 每一条都会**主动误导下一个规划的人**，所以值得单独一刀）：
  ① **P3-28 写着"工作区已落地并配判据、**未提交**"** —— 实际早已随 P4-1…P4-16 的汇总提交入库，
  且 `verify:all` 全绿：第二层围栏（`lstatSync` 拒链接 + `realpathSync.native` 包含性比对）、
  宿主给出的 `sceneMediaBase`、媒体源与诊断族共用的 `onHandleDiag` 都在提交物里，
  `verify-scene-live` 的围栏判据四条齐全（含"同目录普通文件照旧 200"的反空转负对照、
  以及链接建不出来就记账的平台跳过）⇒ **翻 ✅**。按 ADR-0006 D2，替代写法是**复算命令**
  而不是行号（行号会漂）。
  ② **P2-11 写着"该守卫已随 ADR-0006 下线 ⇒ 这个监视器现在失效"** —— 实际它已按 §7 第 6 条的
  复算方式**重建为读代码的守卫** `test/verify-route-families.mjs`（在硬档 `verify` 链里），
  当前读数 `ROUTE-FAMILY TRIGGER NOT FIRED (below the line)`（36 条路由 / 最大族 2 < 3）。
  ③ **§3.1 写着 `src/panel-tabs.js`"仍是 5 个巨型渲染函数装在一个文件里、是全仓最大的理解单元"**
   —— P4-19 之后已不成立：三个最大的渲染器各自只剩一张"按顺序组装各节"的清单（十几行），
  画法按节住在 `render*Section` 里；**唯一剩下的百行级渲染器是 `renderEffectsTab`**。
  这一刀**只有文档改动**，但它修的是"唯一进度真源"本身。

- **两个最大的页签渲染器拆成"一节一个子渲染器"，但先补的是判据**（审计 P4-19）。原先
  `renderWallpaperTab`（458 行）与 `renderAdvancedTab`（111 行）是全仓最大的**理解单元**，
  而且它们**一条行为判据都没有** —— 只有源码锚点（"函数在这儿""首行从 ctx 解构"）。
  纯搬动最容易出的三件事（**漏一节 / 改顺序 / 复制一节**）源码锚点一个都看不见，
  所以这一刀的顺序是**先造能看见它的判据，再搬**：
  用**真渲染器** + 最小替身渲染这两个页签，抽出树里 `we-picker__section-label` 的**有序**序列
  ⇒ "节顺序"成了对任何重构都不变的行为判据。顺带钉住了"实时渲染诊断"那一节的**门**：
  视频壁纸不画它、场景壁纸画在**最后**（原先这条门也只有散落的源码串，没有行为断言）。
  然后才是搬：`renderWallpaperTab` **458 → 16 行**（四个节 102 / 61 / 149 / 162）、
  `renderAdvancedTab` **111 → 16 行**（五个节 18 / 18 / 44 / 25 / 25），父函数只剩一张
  "有哪几节、什么顺序"的组装清单，每个节只解构它自己用到的那几个 ctx 字段。
  **同一轮抓到并修掉的三个真问题**：① `...INTERVALS.map(...)` 的**展开写法**让派生脚本把它
  当成成员访问 ⇒ 那一节没解构 `INTERVALS`，某个分支一执行就 ReferenceError（新渲染挂载台
  当场抓到）；为此补了第二条**静态**判据"每个节函数用到的 ctx 字段都必须解构它"，
  以该页签的 ctx 字段全集为词表、**先剥注释**（规则 ⑦）、展开写法算"用到"、对象键不算；
  ② 写这条静态判据时自己踩了 **CRLF 切片**的坑 —— 边界串用的是裸 `\n`，在工作树（CRLF）上
  匹配不到，`indexOf` 回 −1 ⇒ 切片一路吃到文件尾、把**别的函数**的解构也算了进来 ⇒
  整个词表被误报成"漏解构"（判据"切错了还照旧报"正是它该防的形状）；已在判据里归一成 LF
  并写明原因；③ 拆分脚本写文件时引入了 **140 行裸 LF**（工作树本是纯 CRLF），已归一。
  **牙齿实证**：把 `INTERVALS` 从那一节的解构里去掉 ⇒ 渲染判据与静态判据**各自变红并点名**。
  **第二轮（同一方法）**：先给 `renderAppearanceTab` / `renderEffectsTab` 补**同款节顺序期望**
  —— ctx 由**渲染器自己的解构行**驱动（除 `fontSet` / `surface` / `sel` 几个值形状外全是处理器），
  于是"这个页签要什么"仍由源码说了算、不用手抄；顺带把两条此前只有源码串的**门**变成行为断言：
  外观页侧栏档被 `!sidebarSurface` 包住的**三节不画**（只剩主题 / 细节）、效果页在
  `!sel.id` 时走**空态提前返回**。补完期望才拆 `renderAppearanceTab`：
  **350 → 10 行**（五节 38 / 22 / 231 / 27 / 54）。该架构最实的一条收益在这里显形 ——
  该文件头那句"漏传会当场 ReferenceError"在**拆分后仍成立**：`const { … } = ctx;` 现在是
  **每个节各自一份**，谁需要什么一眼可查。这一轮又抓到同族的第三个 bug：注入的前导局部量
  （`const sidebarSurface = surface === "sidebar";`）**自身的依赖**没被加进该节的解构 ——
  于是 `surface is not defined`（渲染挂载台当场抓到，3 处一次修好）。
  **有意留下**：`renderEffectsTab`（271）只有一个节标签 ⇒ 按"一节一个子渲染器"拆**没有顺序可钉**，
  要拆得先换锚（例如按"控件标签的有序序列"钉），故本轮不动；`renderAppearanceFontSection`(231)、
  `renderWallpaperUploadsSection`(162)、`renderWallpaperRotationSection`(149)、`renderAboutTab`(123)
  仍是较大的单元，可再分一层。详见 `docs/wip/OPEN-ITEMS.md` 的 P4-19 行。

- **CI 补上 POSIX 腿：平台条件分支的另一半第一次真的被执行**（审计 §8）。此前两个 workflow 都只有
  `windows-latest`，而守卫里有**平台条件分支**，两半各在不同的平台上才有牙 —— 最实的一条是
  `verify-scene` 的 unlink 失败用例：**只有 POSIX 的 `chmod` 能阻止 unlink**（Windows 上模式位基本
  被忽略）⇒ POSIX 那半（500 `unlink-failed` / 帧仍在盘上 / 重试可用 …）在 win32 上**不执行**，
  而 win32 那半（ENOENT 幂等）在 POSIX 上不执行；另有 `verify-scene-live` 的 junction/dir 分支与
  `verify-media-bridge` 的 win32 专用断言。
  **这件事判据自己早就喊出来了**：`verify-scene` 每次在 win32 上都打印
  「来自 posix 分支的 5 条 … 在 win32 上没有任何覆盖 —— 这是覆盖差异，不是通过」。
  所以"换平台会改变被断言的那一半"不是**不换平台**的理由，恰恰是**两个都要跑**的理由。
  现在 `verify.yml` 是 `strategy.matrix.os = [windows-latest, ubuntu-latest]` +
  `fail-fast: false`（一条腿红了不该把另一条腿的结论藏起来），`concurrency.group` 带上 `matrix.os`
  （语义唯一：一次新 push 取消的是**同一平台**的上一次 run，而不是让两条腿互相取消），
  首步打印 `process.platform` 便于读日志。**`verify:bridge` 两条腿都跑** ——
  `lib/media/provision.js` 早已声明 linux 资产（`media-bridge-linux-x64-musl` 等，含 sha256），
  所以不是"没有产物可下"；该步自带"环境跳过"的第三结局，失败即真回归。
  **判据**：`test/verify-contracts.mjs` 新增第 ④ 节 —— 从 workflow 源码解析它**实际会跑的 runner
  集合**（同时认 `runs-on: <字面量>` 与 `runs-on: ${{ matrix.os }}` + `os: [...]` 两种形态），
  断言必须同时含 windows 与 ubuntu/linux；三条负对照覆盖字面量单平台、矩阵单平台，以及
  "矩阵形态必须被解析出全部平台"（否则主判据会假绿）。**牙齿实证**：把 `verify.yml` 改回
  windows-only ⇒ 红并点名 `runners=windows-latest`；还原 ⇒ 绿。
  ⚠️ 这条腿的**首次真实运行就是它的验证** —— 本机是 Windows，POSIX 分支在这里结构性跑不了
  （`chmod` 不影响删除），这一点无法在本机替代。

- **发布产物第一次被真实安装器装一遍**（审计 §7.6）。此前的盲区是结构性的：CI 只跑
  `dsh plugin add link:<工作区>`，而发布面守卫只核**声明**（`files` / 可达闭包 / `dependencies`）
  —— 而**软链不参与依赖解析**，所以"`peerDependencies` 能否在**安装闭包**里解析出来"这一类
  在那条通道里**根本不可见**。代价被一次用户回执实测出来了：`Packages: +1`（只装了插件自己）→
  `generation … already exists, reusing` → `generation peer validation failed:
  @deepseek-ai/dsh-client-runtime does not resolve from the installation closure`。
  现在 `test/compat-harness-live.mjs` 有**两条安装通道**：`--channel link`（默认，软链工作区）与
  `--channel tarball`（先 `npm pack`，再把 **.tgz** 装进去，`--fresh` 隔离 HOME）。于是原有的全链路
  判据（宿主路由可达 / 落盘诊断出现探活标记 / 环形缓冲回读 / 进程存活 / 插件树无加载失败）
  **一并覆盖发布产物**，另加三条只属于 tarball 通道的判据：**通道自证**（装进去的入口是**真目录**
  而不是软链 —— 否则这条判据可能是在测另一个东西）与两条针对性的失败串断言
  （`peer validation failed` / `does not resolve from the installation closure`）。
  `harness-compat.yml` 里两条通道**各跑一步**；`npm pack` 的 cache / logs 指到隔离目录，
  于是打包步骤既不依赖网络、也不污染全局 cache。
  ⚠️ **本机跑不了这条通道**（沙箱禁带管道的 spawn —— 连第一步"HOME 隔离对子进程生效"都会 EPERM，
  且本机没有 `dsh`），但它是**响亮地红**而不是静默跳过：判据缺前置时表现为失败，这正是本仓
  §0 要求的失败形态。本机可验的那一半已验：打包成功产出唯一 tarball（39 文件）。

- **面板页签终于兑现自己的模块头契约：26 处内联"写 + 通知"收口成具名处理器**（审计 §6.3，
  审计称之为"**真接缝缺口，不是风格**"）。`src/panel-tabs.js` 的文件头一直写着"页签**不得**写
  selection / 不得 emit：写设置是处理器的职责"，而实测的越界**不在**"写 selection"这一条上
  （那条一直是零）—— 真正漏掉的是**判据看不见的两类**：① 4 个渲染器里 22 处直接 `emit()`；
  ② 改写**模块级状态**（`propsPanelOpen = !propsPanelOpen`、`pickerFocusPending`、
  `pickerOpener = el`）与 **ctx 别名指向的东西**（`editing.name` / `editing.interval` /
  `editing.order = …`，而 `editing` 就是 `selection.editing`）。②这一类连 `selection.` 字面量
  都不含，所以"只数 `selection.`"的那条判据**一直放行**。
  **为什么它是个缺口而不是风格**：同一刀拆出去的 `src/picker-modal.js` / `src/picker-props-panel.js`
  早就在**严口径**下被守着（`selection` 零引用 + `emit(` 零调用），只有 `panel-tabs.js` 不在那张表里。
  **改法**：把那些内联箭头抽成 `src/client.js` 里的**具名处理器**，经 ctx 传进页签 ——
  `onTogglePropsPanel`、`openPicker` / `onOpenPicker` / `onOpenPickerDraft`、三个轮播草稿改写
  （`onEditName` / `onEditInterval` / `onEditOrder`）、上传目录与官方资源路径两组草稿编辑、
  `onToggleSceneLive`（**六件事一起做**：写开关 + 清失败记忆 + 清准备期冷却 + 清会话内软失败
  + 重建层 + 同步音频），以及 `onFpsCap` / `onObjectFit`（含 Edge canvas 路径的直接重绘）/
  `onToggleLiveDiag` 等；页签里只剩 `onClick: onFoo` 这样的引用。
  **判据**：① 把 `panel-tabs.js` 加进 `verify-client` 的接缝判据表（与另外两个渲染器**同一条口径**）；
  ② 新增一条"渲染器不得改写 **ctx 别名 / 模块级状态**"的判据，覆盖赋值、成员赋值与原地变更三类形态，
  纯读取（含 `.map`）与注释里的提及都不误伤。**牙齿实证三组**：三类各注入一次 ⇒ 各自变红并**点名**
  （`propsPanelOpen` / `editing` / `不得自己发通知`），还原后 `verify-client-sync` 的重建结果
  **逐字节一致**。**连带更新**：`verify-scene-live` 里三条"面板 → 实时渲染"的跨文件接线判据随调用点
  迁移而改写（**两端都钉**：处理器真的做 + 面板确实引用那个处理器 —— 只钉一端会漏掉"删掉另一端"），
  侧栏 ctx 覆盖名单与真渲染挂载台同步扩面（新增 11 个自由变量，漏一个就是 ReferenceError）。

- **帧缓存槽位只留唯一产物，并去掉一次"档 4"的白工**（审计 §6.4）。`sceneFrameSlot` 曾返回
  `pngPath` / `jpgPath` / `gifPath` / `dir` 四个字段与一个 `_vN` 档位后缀，而**四个字段里只有
  `gpuPath` 有人在用**（外加 `key`，它是 GPU 回填 PUT 的写去重锁键）——那三条路径是静态帧提取线
  的遗留；`_vN` 后缀则**从来没有任何活调用点会传非 0 的档位**。返回收敛为 `{ key, gpuPath }`。
  **顺带修掉那条链上的一次真实白工**：档 4（用户显式 pin 的自定义封面）**豁免**抓帧，而它此前
  仍会 `sceneFrameSlot(abs, 4)` 解析一次槽位 —— 做一次 `statSync` + `ensureFrameCacheDir()`，
  产出的路径**永远不会被读**（`gpuFrameFileFor` 对档 4 早就是 `return null`）。现在豁免在**调用方**
  判定（`variant === 4 ? null : gpuFrameFileFor(sceneFrameSlot(abs))`）：档 4 连槽位都不解析。
  `gpuFrameFileFor` 同时去掉 `variant` 参数，以及一条只对档位 1/2/3 生效、而值域是 `{0,4}` 的死分支。
  **验证**：`test/verify-scene.mjs` 新增四条判据各带对照 —— 死字段在 `lib/` **零残留**（且**先剥注释
  再判**：解释"它们为什么被删"的注释必须还能点名它们）、**返回恰好两个字段**（按数量判，不按名字 ——
  `dir` 在本函数里合法地作为局部变量存在，按名字禁它是错的判据）、无档位参数且不拼 `_v`、
  豁免点不解析槽位。**牙齿实证两组**：重加 `dir` + `pngPath` ⇒ 红且点名；**只**重加 `dir` ⇒
  红并报 `fields=3`（这一组是专门用来堵住"按名字判漏掉裸 `dir`"那个缺口的）。

- **发布面再瘦一圈：TEX 抽取模块整体退役 + 自带 JPEG 解码副本删除**（审计 §6.1，审计自己称它是
  "本轮重构**唯一**明确没删干净的结构残留"）。`lib/pkg-extract.js` 是静态帧线的遗留：静态帧线在
  P2-12 整体删除后，它的 **TEX→RGBA 解码链**（`decodeTex` 与全部解码助手）、**内嵌 PNG 载荷解码**
  与**内嵌 MP4 抽取**就都没有调用者了 —— 实测从唯一活入口 `parseTex` 出发，**430 / 645 行不可达**。
  它之所以还活着，是两个"看起来还在用"的假象：① 宿主那两处 `await import('./pkg-extract.js')`
  只用 `parsePkg` / `readPkgEntry`，而那两个的实现**本来就在** `lib/pkg-read.js`（P3-17 的收口方向），
  改成直接 import 即可；② `lib/scene-manifest.js` 对它的唯一提及是**注释里的一句话** ——
  一次只读审计据此写下"这条是活的、**别误删**"，那是**把注释当调用读**（本仓对判据早有"先剥注释再判"
  的纪律，这是同一条纪律在审计侧的翻版）。当年真正钉住它的是账本守卫里一条"活依赖存活"断言
  （检查字符串 `function extractTexVideoMp4(` 存在 —— **一条守卫把一个没有调用者的函数钉成了活依赖**），
  该守卫随 ADR-0006 下线后，删除的最后一个阻碍也随之消失。
  **删除内容**：`lib/pkg-extract.js`（645 行）· `lib/vendor/jpeg-js/`（7 文件，随包发布的 ~100KB 自带副本）·
  `package.json` 的 `files` 两条（`lib/pkg-extract.js`、`lib/vendor/`）· 一个已经没人用的 `node:zlib` 导入
  与一条"PNG 编码器"的僵尸小节注释。容器知识保持**唯一实现** `lib/pkg-read.js`。
  **验证**：`lib/**` 扫描面 **27 → 23 文件 / 34,124 → 31,756 行**，运行时不可达仍是 **0 / 0**；
  发布面守卫（`files` 覆盖 / 具名入口 / 每个模块 `node --check` / 相对说明符可解析 / 死声明 / BOM）
  全绿。**判据**：`test/verify-retired-lines.mjs` 新增第 ④ 节 —— 退役词在扫描面**零残留**，
  外加三条存在性断言（文件没了、副本没了、`files` 不再收录）与负对照；并严格按本仓
  "**反向探针先于删除**"的纪律执行：**先加探针、让它红着列出 10 个待清点、再逐条清**。
  ⚠️ 有意**不**把 `lib/vendor` 目录名本身列为退役词 —— 那是 `CODE-STRUCTURE` §5 **约定**允许的
  第三方副本落点，退役的是那一份副本，不是这个目录概念。

- **宿主加固四刀（都是"一次只切一刀"的独立改动，各自配了能钉住它的守卫）**：
  ① **四条路由补请求体上限** —— `/remove`、`/upload-dir`、`/we-assets-dir`、`/media-control` 此前是
  逐块 `body += chunk` 而**从不比较长度**：异常大的请求会把宿主堆无界撑大（默认只听 loopback，
  但 webserver 允许 `host: 0.0.0.0`，而这四条都是 POST）。上限取统一常量
  `CONTROL_JSON_MAX_BYTES`（小控制面 JSON 64KB）。**这一条的判据缺口此前被实测过一次**：
  一次只读审计记下"没有任何守卫要求收 body 的路由必须有上限、同族已有的闸全靠人记得抄"，
  之后新增的 `/media-control` **又忘了抄** ⇒ 缺口从三条变四条。所以这次不是"再修三条"，
  而是把判据做成**从磁盘枚举每个 `req.on('data')` 站点、缺上限即红**（`test/verify-body-caps.mjs`，
  8 条正/负对照 + 覆盖面地板；"回调是裸标识符"（idle 计时器重置）走**结构性**豁免，不是白名单）。
  ② **逐块解码 ⇒ 多字节码点被切成 `U+FFFD`**：同一条链上的第二个静默缺陷 —— 落在两个 TCP 分片
  之间的码点会被写坏，而**用户可见字符串**（壁纸 id / 字体名 / 字体族）被写坏了客户端永远不知道。
  六处（`/settings`、`/fontsets`、`/remove`、`/upload-dir`、`/we-assets-dir`、`/media-control`）统一
  改成**边收边计字节、收完只 `Buffer.concat(...).toString('utf8')` 解码一次**（与 `/live-frame`、
  `/scene-frame-cache`、`/client-diag` 本来就对的形态一致）。
  ③ **`reqLogSeen` 加上界**：键里带**请求可控**的路径段（`/scene-files` 子路径 / `/live-frame` 的 token /
  `/scene-live` 的 pathname），而它只有 `get`/`set`、没有回收 ⇒ 会话期内互不相同的请求让堆**单向增长**
  （实测 20 万个不同 token 把 heapUsed 从 32.2MB 抬到 72.4MB 且不释放）。10s TTL 只抑制**写入**、
  不清理条目，所以上界由新常量单独保证（超界按插入序淘汰最旧的）。去重与上界冲突时**上界优先**：
  条目被淘汰后同一键可能再落一条重复诊断行 —— 诊断去重本就是尽力而为，内存有界是硬要求。
  ④ **`/custom-frame` 补"中途放弃"收口 + 两个临时文件缺陷**：关弹窗 / 断网时 `req 'end'`、`'error'`、
  超时都不发生、`failed` 永不置位 ⇒ 只靠 `ws 'close'` 到不了清理：写流一直开着（未关闭的 fd，直到 GC），
  磁盘上留下最多 30MB 的 `.tmp`，而读取侧只认正式扩展名 ⇒ 那是**看不见的垃圾**，只会累积。现按
  `upload.js` 的同一形态补 `req.once('close')`（`completed` 之后不再销毁写流），并加一条**只清够旧的
  `.tmp`** 的启动清扫（进程被强杀留下的孤儿，按年龄设限以免误删在途写）。
  **转码临时文件同时改用 `atomicTmpPath`**（`.tmp<pid><递增序号>`）：原先用确定性名
  `cachePath + '.tmp' + pid`，而 `cancel()` 会立刻从 `TRANSCODE_INFLIGHT` 删条目 ⇒ 新任务能在旧任务收尾
  **之前**用同一路径开跑，旧任务 `catch` 里那句 `unlinkSync(tmp)` 删掉的正是**新任务正在写的产物**。
  ⚠️ 改名连带修了清扫器的"保护本进程在途写"判据（它原先只认 `.tmp<pid>` **结尾**，改名后会静默失效、
  在 HMR 时删掉正在写的产物）。**`uploads/.meta.json` 的读-改-写同时收进 `enqueueConfigWrite`**
  （它与 config.json 共用同一写队列）：两份 meta 互相覆盖会丢掉 `sha256`，而 `sha256` 正是内容去重的
  依据 —— 丢了就是同一文件被反复堆成副本。
- **两条用户直接撞得到的客户端缺陷**：
  ① **启动链补终止 `.catch` + 把裸 `localStorage` 读收进守卫** —— 迁移分支此前只把 `JSON.parse` 包进
  try，而 `localStorage.getItem` 留在 try **外面**：站点数据被禁 / 不透明源嵌入时连 `getItem` 本身都会抛
  `SecurityError` ⇒ `loadPersisted()` 整体 reject ⇒ 启动链（`loadPersisted → loadFontSet → loadInventory`）
  断掉 ⇒ 选择器**永久卡在「扫描 Wallpaper Engine…」**且一次性提示不收敛（用户只能靠刷新或禁用插件自救）。
  现在整条读走带守卫的 `readPersistedRaw()`，并给启动链补一条**终止兜底**（失败留 `boot-chain-failed`
  诊断行）。同一处注释此前正好写着这个坑修过一次 —— 说明**守卫的位置**比"记得包 try"更可靠。
  ② **音乐开关的高亮是反的**：判据原为 `weAudioVolume() > 0 || disabled`（化简 = 只有"开着且音量为 0"
  时才亮），而出厂默认是 `videoVolume: 0` + `videoAudioEnabled: true` ⇒ 按钮亮着而壁纸是哑的，
  用户一点（音轨关掉）高亮反而**消失**；旁边文案又只看 `videoAudioEnabled` ⇒ 文案与高亮自相矛盾。
  现改为与**按钮自己的状态**（也就是文案那个判据）逐字同一个（`videoAudioEnabled === false ? "" : " is-on"`）。
  ⚠️ 有意**不采用**"开着且有音量才亮"那种写法：音量是**另一颗**控件，而那颗写法会让出厂默认下
  点击**没有任何视觉反馈**（亮灭都不变）。
- **恢复一条被撤掉的监视器（读代码的守卫）+ 修一条"判据空转"**：
  ① **路由族触发线重新有人看守** —— 账本 §7-6「某个路径首段族长到 ≥3 条 ⇒ 按族拆」原先由
  `verify-ledger.mjs` 看守，而该守卫随 ADR-0006 整体下线，其代价一节自己写明"**这个监视器现在失效**"
  ⇒ 触发线还在文档里、却没有任何东西看着它。现按 ADR-0006 给的**正确做法**把判据搬进读代码的守卫
  `test/verify-route-families.mjs`（枚举口径 = `host-route-index` 的 `buildIndex()`，归族规则与
  `analyze-host-apply.mjs` ② 组逐字相同）。**它红不代表代码坏了，代表该回来裁决**（拆族 或 改线并同改判据）。
  ② **`verify-scene` 里一条判据在扫全文**：它的终点锚写成 `sceneFrameSlotFile`（**全仓不存在**）⇒
  `indexOf` 返回 −1 ⇒ `slice(start, −1)` 一路扫到文件末尾，判据从"函数体内"退化成"文件余下所有内容"
  却照样报绿。现改为按下一个顶层函数取边界，并加**"缺锚即红"**断言 + 负对照（这类"锚点漂了没人发现"
  是 P3-16 那类判据空转的又一实例）。
- **文档与注释只述当前原理（清掉一批与实现互相矛盾的陈述）**：`theme-follow.js` 文件头写阈值取中灰
  `≈0.2159` 而实现是 `0.40`、且同文件下方明写"不取中灰"（同文件头尾打架）；`effects.js` 写"只读 selection"
  而 `clearEffects()` 就在写它 5 个字段（改为写明"唯一例外 + 它同样不写设置"）；`client.js` 的轮换间隔注释
  写"默认 5 分钟"而真源是 `rotationInterval: 30`；`lib/index.js` 的缓存键不变量仍指着**已随 P2-12 删除**的
  "预热写盘"；`live-layer.js` 一处注释写成了编年史（"这一行曾写…"，ADR-0006 明令注释只述当前原理）；
  `CONTRIBUTING.md` 说 `INLINE_MODULES` 是"14 个模块"而实际远多于此（**按 ADR-0006 D2 改成"从构建清单现读"，
  不再写死**）；`HOW-IT-WORKS.md` 仍指"账本 §9.5"（该节已归档）。另删掉一条**死夹具管线**：
  `fontSetNewName` / `newName` 这两个"契约字段"在实现里**都不存在**（store 字面量与 `fontSetCtx()` 都没有），
  只有守卫还在喂它们。**`docs/en/TROUBLESHOOTING.md` 补上中文版有、英文版整段缺失的**
  「改了插件却'完全没作用'：先分清客户端半与宿主半」（含四条现场判据）与页首世系标注 —— 补完后
  该中英对的章节结构首次逐条对齐（此前中英标题数 7 : 5）。
- **账本数字按 ADR-0006 D2 退场**：`docs/wip/OPEN-ITEMS.md` §2/§3/§7 曾抄了十余个会漂的数值
  （内联模块数、`lib/**` 扫描面、`apply` 行数与路由条数、`WallpaperPicker` 行数、守卫条数、共变耦合均值…），
  **全部漂了**（一次只读审计已逐条列出）。现改为**只记指标 + 复算命令**；§3.2 那条"`lib/**` 复制率 9.6%"
  的结论方向是**反的**（它把生成物 `lib/client.js` 又把 `src/**` 装了一遍算成了宿主半的结构重复 ——
  排除生成物与 vendored 后手写面在两种窗口下都是不足 1% 量级），已连同"必须写明作用域与排除项"一起更正。

- **真正根因（"重启了还是一样"）：那个"控制台"是 `dsh-ssh` 的 xterm 面板，不是 DSH 对话里的终端块 —— 两者字体互不相干。**
前一条把 `componentFonts.terminal.family` 设成 Nerd Font 是**对的**（读回来确认过：
`{"terminal":{"family":"sys:MesloLGL Nerd Font Mono"}}`），但那个键只投到 DSH 的 TerminalBlock（官方 `--dsl-terminal-font`）。
侧栏那个终端由第三方插件 `@linxin666/dsh-ssh` 用 **xterm.js** 画，而 xterm 的字体**只从构造参数/选项来** ——
它的源码原话是 "xterm's DOM renderer takes the font only from constructor/options, so a plain stylesheet rule
cannot retarget it"（普通 CSS 规则改不动它）。它给这种情况**留了给皮肤用的钩子**，注释原文：
"`--dsh-ssh-terminal-font` — dedicated hook for skins and user CSS (**e.g. a Nerd Font for powerline glyphs**)"，
取值链 ①它自己的设置 `terminalFontFamily` → ②`--dsh-ssh-terminal-font` → ③官方 `--ds-font-family-code` → ④它内置的 monospace。
**修法**：我们的「终端字体」现在同时写 ②（`body { --dsh-ssh-terminal-font: … }`，写在 `body` 上 —— 它读的就是
`getComputedStyle(document.body)`），于是那一行**一处管两个终端**。两个必须记住的技术点：
  - 值必须**摊平**成具体字体列表（不能含 `var()`）：它会被当字符串读走交给 xterm 的 `fontFamily`，
    `var()` 在里面不是函数 ⇒ 整条列表失效。新增 `fontFamilyStackConcrete` 专门做这件事；
  - 用户若在 dsh-ssh 自己的设置里填过 `terminalFontFamily`，那个值优先级更高（我们让位，这是它的取值链规定的）。
本机核实：那个设置**没被设过** ⇒ 我们的钩子生效。
  **但第一次改完还是口** —— 因为**时机**：那个插件只在**构造终端的那一刻**读该变量，之后只有**它自己的设置**变化才重读（源码 `useEffect(…, [fontOverride])`），而我们的样式表要等宿主把设置 / 字体集**异步**读回来才写得出来 —— 终端往往在那之前就建好了，于是它一辈子用着兜底字体（这正是"重启了还是口"）。改法：那一份改写成 **body 上的内联属性**，并让 bundle 正文在**顶层先抢跑一次**（值取 localStorage 里那份**同步可读**的字体集缓存），抢在别的插件构造终端之前；宿主回话后再写一遍权威值。⇒ **新装的 / 重开的终端**一律拿到正确字体，不必再赌两个插件的挂载顺序。
- **修：内置族键在 macOS 上会把整个界面压成 serif**（查上面那条时顺手发现的真缺陷）。内置那几条栈是**给 Windows 写的**
（`KaiTi` / `SimSun` / `STXingkai` …），实测在 macOS 上 `KaiTi` 与 `STXingkai` **都匹配不上** —— 而不带兜底尾时
`--dsw-font-family: KaiTi, serif` 会让**所有**界面文字落到 `serif`（Times），比"没生效"更糟。现在**每条非 `inherit`
的栈都以 `var(--we-host-font-family, …)` 收尾**（先用自己的族名，再退回 DSH 原来那条链的快照）⇒ 匹配不上的族名只是
"这一档不起作用"，中文 / emoji / 等宽的退路照旧。判据：`verify-system-fonts` 用真渲染产物断言内置键那条也带尾，
并配负对照（只看后缀会被 `sans-serif;` 骗到，所以判据认的是"带没带 DSH 原链"）。
- **定位（现场截图，未改动代码的那半）**：用户截图里那些"口"是**终端提示符的 Powerline / Nerd Font 图标**
（PUA 码位：段尾分隔符 `U+E0B0`/`U+E0B2`、分支 `U+E0A0`/`U+F126`、home `U+F015`、文件夹 `U+F07B`…）。
在用户本机逐个码位量过（`canvas` 画该码位，与**同一字体画未分配码位 `U+10FFFE`**即 `.notdef` 的指纹比）：
  - **只有他装的那一族 Nerd Font 真的提供这些图标**（`Meslo…Nerd Font` 共 21 个变体）；
  - 普通等宽字体（`Menlo` / `Monaco`）画的是**方框**，中文字体（`PingFang SC`）甚至**什么都不画**
    —— 后者是"字体在 cmap 里认领了码位却给个空白字形"，它会**挡住逐字形回退**；
  - 关键：**PUA 码位不会回退到 Nerd Font**（没有别的字体认领它们）⇒ 在普通字体之间换来换去**永远**是口。
  ⇒ 正解不是"再换个字体试试"，而是把「终端字体」设成**装了的那款 Nerd Font**。
  这条也是"本机字体清单"这个功能真正的用处：以前没法在 DSH 里给终端块指定字体，只能忍着口。
- **修：本机字体下拉里有一批名字**浏览器根本取不到**（现场反馈："控制台切换了字体，部分特殊文字还是显示成口"）**：宿主那份清单来自操作系统，而**系统列出的族名 ≠ 浏览器能匹配的族名** —— 用真 Chromium 逐个量过：本机 309 个名字里 **64 个匹配不上**，而且恰好包括"为了修口最会去挑的那几个"：
  - **系统保留字体**：`Apple Color Emoji` / `Symbol` / `Zapf Dingbats` / `Apple Braille` / `GB18030 Bitmap`，以及阿拉伯 / 希伯来 / 天城文那些（macOS 不让应用按族名取它们，`system_profiler` 照样列）；
  - **同一字体的另一种写法**：`苹方-繁` / `苹方-港` / `黑体-繁` / `系统字体` 等（规范名 `PingFang TC` 才取得到）。
  选这些名字**什么都不会发生** —— 看着就是"换了字体没用"。现在客户端在**渲染下拉时**探一次"这个名字在本浏览器里到底能不能用"（同一个名字分别配 `monospace` 与 `serif` 量同一段拉丁文字：名字生效 ⇒ 两次都用它 ⇒ 宽度相同；不生效 ⇒ 一次走 monospace、一次走 serif ⇒ 宽度不同），只把能用名字摆出来，并在那一行**如实写出略过了几个**；量不到（替身 DOM / 无布局）时**原样放行**，绝不因为"测不出来"把用户的字体名丢掉。当前值即使被筛掉也照旧显示出来（否则 `<select>` 会显示成「跟随」而值其实还存着 —— 界面在撒谎）。TC/HK 那些变体没丢，用规范名照样能选。
- **排查结论（未改动代码的那半）**：我们的字体链**不会**打断逐字形回退。用真 Chromium 画了 18 个"特殊字符"（制表 / 盲文 / Nerd 图标 PUA / emoji / ⚠✅→✓ / 生僻汉字 Ext-B / 数学字母）：在"用户选了只有拉丁字形的字体 + 我们的兜底链"这一档下，**一个方框都没有**。⇒ 剩下的"口"只有两类成因：① **当前这条字体链里没有任何字体认领那个码位**（PUA 图标就是这一类 —— 换个装了它的字体就能修，见上一条定位）；② **本机任何字体都没有那个码位**（只能装字体，换字体解决不了）。
- **「本机字体」现在两种名字都给（现场缺陷修复：可选字体看着"没扫全"）**：用户反馈"可选字体没有扫描出本机所有字体"。核对结论：**字体一个没少**（与本机 CoreText 的族名列表逐条对得上），少的是**名字的写法** —— `system_profiler` 报的是**本地化**族名：中文系统上 `PingFang SC` 报成 `苹方-简`、`Heiti SC` 报成 `黑体-简`，而 CSS / 字体册英文界面 / 设计软件用的是**规范（英文）名**，本插件的内置族键（`STXingkai` / `KaiTi`…）也是英文名 ⇒ 用户在下拉里找不到自己认识的字体。现在 macOS 上**两条权威腿并行**：`system_profiler`（本地化名，~10s）+ CoreText 的 `CTFontManagerCopyAvailableFontFamilyNames`（规范名，实测 ~0.05s，走 `osascript -l JavaScript`），族名**取并集**，两种写法都能选到（实测 `"苹方-简"` 与 `"PingFang SC"` 在 Chromium 里渲染宽度逐位相同 ⇒ 同一个字体）。本机实测 **266 → 309** 个可选族名，冷扫描耗时不变（并行）。
- **修：子进程输出逐块解码会在多字节字符跨块时插 U+FFFD**：同一份 `system_profiler` 输出里 `系统字体` 变成 `系统\uFFFD\uFFFD\uFFFD体`，而正确的那个名字也在 ⇒ 字体下拉里多出一个**认不出的族名**。现在按**字节**收、最后一次性 `Buffer.concat(...).toString('utf8')` 解码；超上限即判失败（截断的 JSON 解析不出东西，宁可走降级也不给半份名单）。判据：`verify-system-fonts` 真起一个子进程，让它在两个 chunk 里切开一个 3 字节汉字（配负对照：同一串字节按逐块解码拼**必须**真的坏掉）。
- **字体可选「本机系统字体」，「全局 / 终端」两个范围各有一处入口**：用户口径（现场要求"插件需要支持全局/终端 系统字体 选择切换"）。此前字族只有**七个内置族键**（雅黑 / 楷体 / 宋体 / 黑体 / 行楷 / 等宽 / 默认）—— 全是 Windows 中文字体，macOS 上等于没得选。现在：
  - **清单从操作系统来**（新路由 `GET /wallpaper-engine/system-fonts`）：macOS 走 `system_profiler SPFontsDataType -json` **加** CoreText 那一条（两种名字取并集，见上一条）、Windows 走 PowerShell 的 `InstalledFontCollection`（拿不到退回注册表值名）、Linux 走 `fc-list`；权威来源都拿不到时按**字体文件名**推，并**如实标 `approximate`**（面板写明"是按文件名推测的"）。为什么这么选（而不是插件自己解析字体文件、或让浏览器枚举）见 [ADR-0009](./adr/0009-system-fonts-from-the-os.md)。
  - **一次扫描很贵**（macOS 慢腿实测秒级到十秒级，`-detailLevel mini` 不减少耗时）⇒ 双层缓存 + 过期**先回旧值**（标 `stale`）再后台重扫 + 面板上的「重新扫描」；扫描**不在启动期**发生（第一次真的用到才触发）。
  - **字族从此统一存"键"**：内置键或 `sys:<族名>`；CSS 栈（引号 + fallback 链）在解析侧现拼，本机字体那条链是 `"<族名>", var(--we-host-font-family, <保底>)` —— `--we-host-font-family` 是**开写之前**的 DSH 字族快照，所以中文 / 等宽的退路仍是 DSH 自己那条。历史值（组件字体曾存解析后的栈）解析侧照样认 ⇒ 老字体集零迁移。
  - **「默认字体（全局）」是默认不是强制**：它写 DSH 的基准令牌 `--dsw-font-family`（角色表之外的文字都从它继承），并**只**落在"本来就被接管"的角色上（用户改过该角色字号/字重）—— **挑一个全局字体不会改动任何角色的字号**（接管一个角色意味着连字号/行高都改走细粒度令牌，那是另一件事）。角色 / 组件里单独设过的字族仍然优先。
  - **「终端字体」**：只改对话里的终端块，与「高级字体设置 → 终端」是同一项（`componentFonts.terminal.family`）的两处入口，值同源所以不会漂。
  - **验证**：新守卫 [`verify-system-fonts.mjs`](../test/verify-system-fonts.mjs)（含负对照）—— 三平台解析夹具、「两种名字都在」的回归判据、单腿可用、`approximate` 标记、缓存不重复扫描、`?refresh=1`、过期先回旧值、非 GET 405、空清单不落盘、真子进程的多字节解码、客户端通道只碰自己那几个瞬态字段、全局字族那两条腿；`verify-fontset` / `verify-client` / `fontset-load-smoke` 的字体键集随之扩到七个（守卫按设计变红后同步）。
- **渲染内核同步上游 WebWallGL 2.1.0**（`cd56f80` → `4ba71c4`，59 个上游提交；上游 release 主题「官方内置示例工程全量兼容 / 引擎加固 / 松散目录形态」）。用户可见的主要是：**场景壁纸支持松散目录形态**（按 `project.json.file` 的后缀判定、装配期按名取资源 ⇒ 源码工程不必打包成 pkg）、`applyUserProperties` **按官方字母序下发**（修 corsair_collection 白屏）、文字 `anchor:none` 不再被剪贴蒙版抹掉（3509578940 文字时钟）、点击命中门槛改按祖先可见性（隐形 Solid 点击区仍可命中），以及 F23–F50 一批渲染修复（MDL 多子网格 / 透明像素不写深度 / 引擎内置 shader 仓内实现 / 粒子 colorrandom 逐分量 / 场景相机路径 + `usershadervalues`；上游曾试过 fp16 HDR bloom 链，最终按上游作者指令**冻结 SDR 等效口径并整体 Revert**）。
  **产物**：`lib/webwallgl/assets/renderer-AJkjEL9i.js`（原 `renderer-DTLW1Gf0.js`），`.upstream.json` 抬到 2.1.0；`web-shim.js` 随上游 +19 行（字母序下发那段）。
  **判据**：`verify:all` 全绿；插件依赖的两条宿主通道（`__weSiteRoot` 站点根声明 / `__wp.setMediaControl`）在上游都还在，`verify-scene-live` 的 shim rAF 节流与站点根形态断言原样通过；`test/verify-guard-map.mjs` 零覆盖例外表跟着换哈希（`DTLW1Gf0` → `AJkjEL9i`）+ `docs/GUARD-MAP.md` 重生成，ROUTE-INDEX 不动（路由未变）。


- **「预设方案」玻璃预设（出厂七套 + 用户自存，上限 8）—— 出厂预设删除即永久（不可恢复）**：预设块**只画在设置页**（**高级配置**，ADR-0008 D4；门是 `src/glass-panel.js` 的 `!sidebarSurface && renderGlassPresetsBlock(...)`，`glassPresets` 另在 quick-panel 的 setting-only 占位器名单里 —— 拆门即当场抛错。渲染器入口那句 `if (!presets) return null` 只是**第二道**保险：侧栏档本来就不传这个字段。本句原先写成"设置页与侧栏共用同一预设块"，与实现不符，2026-10-05 更正）（两行四列、每格 = 应用键 + 删除键、两步确认、空位虚框）；预设 = 玻璃子系统完整快照（`GLASS_PRESET_KEYS`），应用走设置通道（整快照一次合并 → persistSelection + applyEffects 立即落效）；存储 = 两层写时复制 —— 随包层 `lib/glass-presets/*.json`（七套含「作者自用」，只读、包内永不被写）+ 用户层 `glass-presets/`（快照 + 墓碑），同 id 用户层胜。**删除即永久**（用户口径）：删出厂 = 用户层墓碑永久遮蔽，清单无 hidden 形态、**无恢复通道**（再删 404 不复活）；被删的不占 8 上限、名字即放开。重名是宿主硬规则（409；trim + 小写归一，对比域 = 活跃清单）。守卫 = `verify-presets.mjs`（键集承重 / 消毒回归钉 / 路由全链路 / 形态棘轮 + 真渲染行为判据）。
- **前置口径回落：`engines.dsh` `>=0.2.0-rc.1` → `>=0.1.5-rc.1`（内核实测下限 0.1.5），三个 `@deepseek-ai/dsh-*` peers → `>=0.1.5-rc.1`（先随回落放宽到 `>=0.1.0-rc.6`，发布前徽章复核后与 engines 对齐），description 前置句同步；`dsh-better-sidebar` 取消版本限制**：官方桌面端线（内核 0.2.0-rc.1+）与旧 DSH Desktop ≥ 2.0.7 线（内核 0.1.5-rc.1+）均可安装本版；更旧内核仍拒绝。semver 细节：`0.1.5-rc.1 < 0.1.5`，写 `>=0.1.5` 会把实测过的 rc 线排除，故沿用 1.1.0 实证写法。v1.2.0 已按 `>=0.2.0-rc.1` 发布 npm；本版按用户实测结论回落。**徽章复核（发布前已做）**：engines / peers 曾为两档口径，市场徽章会显示 `DSH >=0.1.5-rc.1 ∩ >=0.1.0-rc.6` 两截——peers 对齐到 `>=0.1.5-rc.1` 后徽章单截干净显示，且**约束等价**（engines 本就排除 <0.1.5-rc.1 的宿主，peers 收紧不新增排除；badge-sim 实测 0.1.2-rc.1 红、0.1.7-rc.1+ 灰，判定与对齐前一致）。
- **排障文档**：「安装失败：`generation peer validation failed`」一节的下限口径随回落更新——issue #116 现场的 0.1.7-rc.2 内核现已满足 ≥ 0.1.5-rc.1、可正常安装。

### v1.2.0（2026-10-02）

> 1.1.0 之后至 1.2.0 的全部内容。主题：**侧栏工作台**（外观 / 播放进侧栏 + 「壁纸属性」）、**玻璃染色地板**与「左侧栏覆盖」、
> **前置基线切换到官方桌面端（DeepSeek Harness）≥ 0.2.0-rc.1**（旧 DSH Desktop 2.0.x 装不上本版）。逐提交可查；公告见 v1.2.0 Release。

- **前置基线切换：`engines.dsh` 声明 `>=0.2.0-rc.1`，三个 dsh peer 与 description 前置句同步**：manifest 声明是插件市场「宿主要求」徽章与安装预检的数据源（顶层 `engines.dsh` 硬声明 + `@deepseek-ai/dsh-*` 可选 peer 并入展示交集）；四条声明必须统一为**同一字符串**，徽章才能显示成单截 `DSH >=0.2.0-rc.1`（字符串不一致会拼成 `A ∩ B` 两截）。结果：官方桌面端（内核 0.2.0-rc.1 / 0.2.0-rc.2）灰标 compatible；旧 DSH Desktop 2.0.x（内核 0.1.7-rc.1）红标 incompatible 且安装预检拒绝。判定用 dshmarket 自家 lib 模拟核实（`.test-cache/badge-sim.mjs`）。
- **快切面板空态提示升级为完整操作链**：侧栏类型档与设置页类型档是**两层叠加**（上游先筛、侧栏再筛），两层无交集时旧提示只说"切成「全部」才能看到"却不说在哪切。现在主提示**点名两层档位**（「场景」与设置页的类型档「视频」没有交集 —— 两层筛选都放行的壁纸才会出现在这里），下附**完整点击链**（设置 → 壁纸引擎 → 壁纸库 → 「选择壁纸」→ 顶部「类型」切成「全部」）；两档相同且该类型为空时不给无效链路（切成全部也变不出该类型），只报「{name}」类型下没有可播放的壁纸。
- **面板公告升级 1.2.0（`NOTICE_VERSION` 同步）**：公告正文按 v1.2.0 Release 口径重写（前置变更置顶 + 侧栏 / 玻璃 / 渲染内核 + 使用提示与三步调节）；「💡 使用提示」「❗❗❗ 看不清字」两个分节标题从灰色小字改为**正文粗体**，「关于」提示加 ❗❗❗ 前缀并加粗（用户现场口径）。i18n 词表随公告换血：+31 / −35（旧 v1.1.0 公告词条全数退役），verify-i18n 双向对账全绿。
- **守卫 Windows CRLF 误报修复**：verify-scene-live「面板渲染器必须顶格声明」判据的缩进判定用 `\s+` —— `\s` 跨行吞换行且 JS 正则 `^` 在多行模式把 `\r` 当行终止符，CRLF 检出下顶格声明前面是注释行就会被误判成"缩进形态"（LF 检出测不出）；改 `[ \t]+`（同行缩进），负对照同步。对账脚本复核：该失败与任何本次改动无关（HEAD 原文件即复现）。

- **侧栏「壁纸属性」：入口固定在页签栏下方（整行、无背景），点开 = 页内下钻**：用户口径（现场反馈"侧栏壁纸 / 外观 / 播放标签下面的壁纸属性不见了"）。核对结论：这块面板**只在设置页「壁纸库」页签**有，侧栏（官方右栏 tab 与低版本右滑抽屉共用同一份 `src/quick-panel.js`）自引入起就没接过 —— 不是回归，是漏项。**最终形态**（按用户三次口径收敛）：入口放在「壁纸 / 外观 / 播放」三档页签**下方、独占整行**（`.we-qp__propsbtn`：整行宽 + 文字居中 + 字号与页签标签一致 12px + 上下 7px 内边距，并显式 `height: auto` 解掉基类的固定高 —— 固定高 30px 且零纵向内边距会让文字贴边、整枚看着被压扁，现场反馈后改的）；三档都在同一位置看得见，**不随下钻消失**（打开时同一行同一位置换文案为「收起壁纸属性」并 `is-on` 高亮，再点收回；在别的档点它先切回壁纸档再打开，否则用户看不出反应）。点开走**页内下钻**：内容区整区换成「返回 + 属性面板」，列表 / 搜索 / 声音组让位。面板本体与开关仍与设置页**共用同一份**（`propsPanelOpen` 的 accessor + 模块级 `renderUserPropsPanel`），入口显隐判据与设置页逐字同一条（仅场景 / 网页 + 有 `propsUrl`）。这一轮踩到并修掉的两个真缺陷：① **作用域事故**（整页白屏的直接原因）：面板渲染器原本是 `apply()` 里的闭包，而 `src/sidebar-right.js` 是 prelude（在 `apply()` **之前**求值），它注册的渲染回调引用不到 apply 的作用域 ⇒ 真机抛 `ReferenceError: renderUserPropsPanel is not defined` ⇒ React 卸载整棵树；设置页那条路因为经 `ctx` 显式收这个函数完全察觉不到，是靠"跑真产物 + 真侧栏注册路径"的复现台抓到的。渲染器因此提升到**模块级**，并补结构性判据把"必须顶格声明"钉死（布局期的替身渲染台天然发现不了作用域错误）。② **互补门**：下钻支与其余内容支的门必须是 `qpTab === "wallpaper" && 开关 && 这张有属性` ↔ 它的取反，错开一格（开关还开着但这张没 `propsUrl`）就是"两支同时为假 ⇒ 内容区空白"。另修：面板画的是**上一次求值留下的属性表**（宿主异步），过去只看 `propsState.loading` ⇒ 开着面板换壁纸会拿上一张的属性冒充这一张（现在 token 不一致就一行都不画，并改说"正在取这张壁纸的属性…"）；头部加**自陈读数**（` · <token> · <宿主给的条数>[…]`）让三条空表成因一眼可辨；清壁纸时 `onClear` 把开关一并收起。
  **验证**：[repro-sidebar-props.mjs](../test/repro-sidebar-props.mjs) 跑**真产物**（`lib/client.js` → `apply(ctx)` → 官方侧栏 `ctx.slots.inject("sidebar.right.pane.tab")` 注册路径 → 真选一张 → 真点入口）：修复前逐字复现那条 `ReferenceError`，修复后走通"入口 → 下钻 → 面板落地"。判据：`verify-scene-live` —— 入口在**页签栏下方、内容区之前**（配负对照：挪到页签栏之上判红）、整行宽 + 边框显式声明、颜色取主题文字色（`--we-ink` + `color-mix` 40%，配负对照）、三档都在且随下钻切文案/高亮、别的档点它先切回壁纸档；下钻支先于其它分支、内容区**直接就是面板**（没有返回按钮那一行）；其余分支与下钻支**门互补**（`!(…)` ≥2 处，配"退回只看开关读数"的负对照）；面板渲染器必须是**模块级顶格声明**（配"缩进写进 apply() 判红"的负对照）；真源码渲染 —— 点入口走处理器、下钻后列表让位且入口变「收起」、点「收起壁纸属性」回列表、**五种输入**下"壁纸档内容区非空（列表或面板必居其一）"、入口三档都在而面板只属壁纸档。`verify-picker-props` 第 8/9 节照旧。全量 `npm run verify`(23) 与 `verify:docs` 全绿；路由索引的"守卫提及"计数随新守卫重新生成。

- **侧栏当前壁纸缩略图的圆更"正"了 —— 外缘改走整圆裁切，中心孔不再用 mask**：现场反馈"当前壁纸图片不够圆"。成因：外缘靠 `border-radius + overflow`（把方盒子裁圆），同时又叠了一层 `radial-gradient` mask 去挖中心孔 —— mask 会把元素提升到一层额外光栅、**把外缘的抗锯齿一起弄糊**，于是圆看着毛。现在：外缘 = `clip-path: circle(50%)`（对图片外接盒做整圆裁切，抗锯齿明显更干净）＋ 方形外接盒（`aspect-ratio: 1/1` + `box-sizing: border-box`）；中心孔仍由 `::after` 那枚**描边圆环**画（不是叠色块 —— 面板是玻璃，只有留空才能透出底色）；整枚不再用 mask。判据：`verify-scene-live` 两条（整圆裁切 + 方形外接盒 + 不许有 mask，配"退回 border-radius + mask"的负对照；中心孔仍由 ::after 描边圆环画）。
- **外观页新增「左侧栏覆盖」（默认关，在「玻璃透明度」滑杆下面）—— 原生左栏第一次能被玻璃配方调节**：壁纸激活时宿主原生左栏（会话列表 / 工作区那一列）此前只是**透明的洞**：插件把 `--dsw-specific-sidebar-fill` 置为 `transparent`，那一列于是把壁纸**原样**透出来 —— 没有霜、没有底色，主题那套「配色 / 玻璃颜色 / 玻璃透明度 / 雾化 / 边框」一个都到不了它（其余面板都有）。打开后这一列拿到**与其余面板同一张配方表**：玻璃色（钳制后的可读性底色）@ 玻璃透明度 压在可读性下限之上 + 雾化（`--we-blur`）+ 边框（竖分割线走 `--dsw-alias-border-l3`，壁纸令牌映射只接管了 l1/l2 —— 这正是「边框」此前对左栏完全无感的原因）+ 配色（accent 映射到 `--dsw-alias-interactive-bg-hover` / `-accent` / `state-business-primary` / `brand-*`，作用于选中 / 悬停行、徽标与强调文字）。默认关 = 与今天逐字节相同（否定式：只盖开关不盖壁纸锚点也照样不吃玻璃）。无 backdrop-filter 与软件光栅器两档按既有政策钉回近不透明（92%）并显式关掉模糊。**锚点**：那一列只有 CSS 模块哈希类名（harness 的 `pI_x6G_sidebarCol` / `hHd-Xa_root`，跨版本漂移、不得使用），可钉的是**座位出口** `[data-slot="sidebar"]`（与设置窗口用的 `[data-slot="settings.section"]` 同一机制）—— 出口正是这一列的**直接子元素**，故用 `div:has(> [data-slot="sidebar"])` 反向选中父元素；⚠️ 不能把玻璃画在出口自己身上：它带 `display:contents`（座位渲染器的 ANCHOR_STYLE），**不生成盒子**，背景 / 模糊 / 边框全画不出来。
  **验证**：真 harness（隔离 HOME）无头页面**四态探针**（`compat-harness-pages`：裸页面 / 只盖壁纸锚点 / 再加开关 / 摘掉开关）—— 锚点唯一命中（`matches=1`）、默认档 `rgba(0,0,0,0)/none`、开关档 `color(srgb 1 1 1 / 0.571) + blur(16px) saturate(1.3)`、摘掉开关逐字段还原；另做**真实壁纸的像素 A/B**（合成 1920×1080 测试图 + host `PUT /settings` 真改开关）：左栏区域红绿分界的最大水平梯度 **145 → 5**、梯度 RMS **11.2 → 1.17**（≈9.6× 变糊），同帧中央对照区 **0% 变化**（这一栏没动）；`verify-readability` 的 F2a 表面表补两条（左栏是能直接看到壁纸的大块文字面，必须有下限声明），27 个表面全过。
- **CI 判据四处修（兼容层两条"恒红" + 五分区走查跟改名 + 无头浏览器统一假钥匙串 + verify-scene-live 容忍 CRLF）**：① `compat-harness-pages` 的表面令牌探针把 `evS` 的返回值又取了一次 `.value`（`evS` 返回的就是值本身）⇒ `sp` 恒为 `null`、**三条判据自 bb06fc2 起一直红且看不出原因**（harness-compat 是派发制，没人重跑就没人发现）—— 现已修好并跑绿（27/27），同时给探针加了 `DSH_WE_COMPAT_DEBUG` 原始值落屏口子。② 五分区走查写死 `Wallpaper Engine`，而 UI 重构把那枚分区改名成「**壁纸引擎**」⇒ 最后一段点了 0 次（同一条判据里的 `断点=` 已经点了名，但读数容易被忽略）；改成**候选名匹配**（别名再变也不会静默失效，两条都找不到才红）。③ **无头浏览器的启动口径：6 处 `--headless=new` 启动点全部带 `--use-mock-keychain`** —— macOS 上缺它会去碰真钥匙串、弹「找不到用于存储"…"的钥匙串」对话框打断跑测的人（用户侧实测复现两轮；`compat-harness-pages` 与 `tools/diagnose-web-blank` 各漏一处，`e2e-web-media-origin` 的第二次运行也漏），现在由 `verify-contracts` 新增的第 ③ 节静态守住（按**启动参数数组**判，新启动点自动覆盖；配负对照）。
  ⑤ `verify-scene-live` 的「侧栏 ctx 覆盖渲染器要的全部字段」把换行写成了字面量 `\n` ⇒ 在 **CRLF 检出**（CI 跑 windows-latest，本仓没有 .gitattributes、Git for Windows 默认 autocrlf）上**候选恒为 0**：本机 LF 检出全绿、CI 却是 `候选 0 个` + 279 passed / 1 failed（PR #125 首次推送实测）。改成 `\r?\n` 并补一条正/负对照（同一判据在 LF / CRLF 两种形态下都要认出字段、换个函数名要落空）；其余 21 个守卫在 `git clone -c core.autocrlf=true` 的检出上逐条复跑全绿 —— 这条是本批唯一 CRLF 脆弱的判据。

- **拖动色板 / 滑块不再发涩（拖动档只写"看得见的那部分"）**：现场（用户反馈"自定义颜色色盘拾取有点卡"）——在原生颜色轮盘里拖动时**每格**都走 `setSetting + emit()`：emit 让整棵面板重渲染（设置页那棵最重：字体表 + 12 个色块 + 字体集编辑器），而 emit 的订阅者里那次**全量** `applyEffects` 还会重建字体样式表、同步场景音频、并读一次 `getComputedStyle`（壁纸透明度 > 0 时 —— 那就是**强制同步样式计算**，整页重算）⇒ 每格三样重活，拖动因此发涩。现在分两档：拖动中（`input`）只写值 + `applyEffects({ live: true })`（跳过上述与本次拖动无关的重活，样式变量照旧**全量**写）且**不 emit** —— 数值回显由控件就地更新（滑块轨道 `--we-fill` 直接写 style、原生色块自身会变），抬手（`change`）才走完整一次（emit → 全量 applyEffects）。音量滑块同理（拖动档不 emit，音量本身即时生效）。拖动中的中间值照旧落盘（`setSetting` 的 debounce 200ms），中途关窗不丢最后一次值。这条与「壁纸属性」面板的 silent 拖动是同一口径（`src/picker-props-panel.js` 的 `onPropInput`）。
  **验证**：`verify-client` 新增三层判据 —— ① 两个行构造器必须把 live 传下去（`input`=true / `change`=false）；② 17 个会拖动的处理器必须收口到 `commitLiveSetting`（音量走自己的 `if (!live) emit()`，并在分支通知豁免表里写明"拖动档有意不通知"）；③ **行为**：拿真 `src/effects.js` 在带间谍的 DOM 替身上跑 —— 拖动档必须 0 次 `getComputedStyle`、不碰字体样式表 / 场景音频，同时照写 ≥15 个样式变量；无参（抬手档）必须把这几样都做（负对照成对，含"冷启动无缓存时允许算一次"的边界）。`verify-scene-live` 的 applyEffects 形态判据随签名更新为 `function applyEffects(`。
  **已知未覆盖**：「颜色角色」那 12 个色块（外观页的「全局字体」节）仍是每格 emit 的老口径 —— 它的可见反馈要走 emit 里那条宿主令牌层，静默会冻住预览，要单独处理（rAF 合流那条路）。

- **侧栏加「壁纸 / 外观 / 播放」三档页签 —— 设置页那两页不用离开壁纸就能调**：快捷播放面板（官方右栏 tab 与低版本右滑抽屉共用同一份）在「轮播」一节**之下**加了一条三档页签，位置与"上方内容三档都显示"都是用户点名口径：**当前壁纸与轮播在任何一档下都看得见**（调外观 / 播放参数时想换一张对照很常见），只有页签内容区滚（官方档下宿主 tab 身体是固定高 + `overflow:hidden`，滚动自管）。**「外观」「播放」两页与设置页同名页签共用同一批渲染器**（`ctx.surface === "sidebar"` 档少画设置页专属分组：外观的**字体 / 输入光标 / 窗口与侧栏**三节；播放的**准备与诊断**行 —— 出图来源 / 实时帧 / 自定义画面 / 帧率上限 / 源信息与转码进度），于是两处是同一份控件、同一份状态，改哪边另一边都跟着变；页签记忆只进 `localStorage`（不进 `config.json`）。为此把 12 个「外观 / 画面」处理器（`onAccent` / `onGlassColor` / `onGlassAlpha` / `onBlur` / `onBorder` / `onToggleThemeFollow` / `onScrim` / `onWallpaperBlur` / `onWallpaperOpacity` / `onBackground{Brightness,Contrast,Saturate}`）从 `WallpaperPicker` 组件闭包**提升到模块级**（与当年那批播放控制处理器同一条先例）；侧栏那份**手写**的声音组并回 `renderAudioTab`（此前它的提示语已与设置页不一致）。侧栏底栏那颗入口按钮**随页签换文案与落点**：壁纸页「壁纸引擎设置 ›」、外观页「字体与更多外观 ›」、播放页「更多播放设置 ›」；后两者走一条**瞬态深链请求**（`settingsTabRequest` + `openSettingsSection(tabId)`），落地在设置页的一次性 effect 里走同一个 `switchTab`（自动打开失手时清掉请求，不劫持下一次手动打开）。侧栏类型筛选**补上「图片」档**（此前只有 全部 / 场景 / 网页 / 视频）；列表是"设置页类型档先筛、侧栏这一档再筛"的两层叠加，两层都非「全部」而列表为空时，空态会把**上游那一档**点出来（否则看起来像"库里没有这类壁纸"）。侧栏不再在加载 / 扫描失败时整体只剩一句话 —— 那两态现在只占「壁纸」页，外观 / 播放两页照常可进。
  **验证**：`verify-scene-live` 新增 18 条源码判据（五档齐全 + 少一档负对照 · 三档页签齐全与**页签栏位置**（在轮播与底栏之间）· 页签记忆不进设置 · 与设置页共用渲染器且侧栏零自写控件 · 六扇 surface 门 · 处理器提升到模块级 · **侧栏 ctx 覆盖渲染器解构的全部字段**（提供的字段 + setting-only 占位器）· 侧栏零裸写 · 深链带 tabId 与超时清理），并**在真源码上把三档各渲染一次**（React / store 用替身、渲染器用真的）：三档都渲染得出、各画各的、底栏文案随档变、「去挑一张 ›」空态，外加一条**接线判据** —— 遍历三档渲染树逐个戳处理器，树里不许出现设置页专属的占位器（负对照成对）。`verify-fontset` 的面板渲染台新增 surface 档判据：**缺省与 `"settings"` 逐字相同**（设置页形态一个节点不少）、侧栏档只少该少的分组、空态 CTA 两档不同。i18n 词表 +7 条。

- **玻璃染色地板：自定义色相第一次真正进入对话框/侧栏**：#82 的可读性底色原是**主题白/黑**（浅 `#ffffff` / 深 `#0d1524`），固定占表面配方的 45%/59% 且任何滑杆都压不动 ⇒ 用户自定义的玻璃色最多只剩 ~10%（深色下"玻璃只有黑"、浅色只有白）。现在地板色改为**玻璃色经亮度钳制的按主题版本**（深色过亮压暗、浅色过暗提亮，钳制目标 4.6:1 留 hex 量化余量）—— 色相跟随用户、亮度钳制保住 #82 的 ≥4.5:1 正文判据；**输入框与消息气泡的白色釉层（`rgba(255,255,255,…)`）同批换成语义相同的染色釉** —— 对话区全部文字面第一次整族跟随自定义色相；`verify-readability` 的网格随之升级为 **玻璃色 {黑/中灰/白} × 滑杆 × 主题 × 壁纸透明度 全组合 ≥4.5:1**（旧网格只测白色 frost 单点，对深色自定义色有盲区）。
- **玻璃透明度拉满不再"变黑白"**：滑杆换算曲线的下限从 0.03 提到 0.10 —— 旧曲线在染色地板下会把玻璃色份额抽干到 ~1%，只剩主题底色（用户报的"拉满变黑/变白"）；现在拉满仍保留一层可见磨砂，壁纸透过率依旧单调上升。
- **设置页新增「关于」页签（第五枚，排在最后）**：四段内容**按序**为 —— ① 项目简介；② 本仓地址与「⭐ 去 GitHub 点亮 Star」（真链接、新窗口、`rel=noopener`，旁边另给一段**可选中可复制的裸地址** —— 桌面壳里外链能否唤起浏览器不由插件说了算，这条给"点了没反应"兜底）；③ 交流群的**两张二维码**（QQ 群与抖音群）；④ 贡献者致谢**压尾**（逐条列出 oneincase / YV3507 / yuxilao / Jerry 与其余贡献者做了什么，并以 💌 那句收尾）—— 顺序是用户的明确口径，判据按首次出现下标比大小钉住（错序 / 缺段都红，配正负对照）。它是唯一**不读面板状态**的页签：不写设置、不发通知、一条表单控件都没有（判据按这个语义钉住：滑条行必须为 0）。两张码是**随包 PNG**（`lib/about/qq-group.png` / `douyin-group.png`，`package.json` 的 `files` 收进去），
由插件自己的路由 `GET /wallpaper-engine/about-qr/<文件名>` 直出（白名单 + ETag/304，换码不重建产物）——
**不是**内联 base64：那版会把约 240KB 压进 `lib/client.js`（每次冷启动都要解析这串与本页逻辑无关的字符），
拆成静态文件后 bundle 回到原大小、更换二维码只要替换 PNG。README 中英两份的「联系方式」段引用**同一份**
文件（展示与插件用同一份字节，不另存副本）。派生口径 = 只取码区（裁掉图内标题 / 群名群号 —— 那些文字由
卡片与 README 的标题承担）+ 缩到 520px 宽 + 128 色调色板，两张码因此在面板里尺寸一致、并排对齐。
**验证**：把派生图上采样回原分辨率与源图逐像素比，两图平均通道差 `0.90 / 0.72`、99 分位差 `9 / 8`、
二值化一致率 `99.3% / 99.7%`；再用 macOS Vision 对**派生版**扫码，QQ 码解出
`https://qm.qq.com/q/yxDL6BdsFW`（抖音那种点划 + 渐变的装饰码连**原图**都解不出来 —— Vision 认不了这一型，
其验证只到结构保真那一档，换码后请用手机真机扫一次）。
- **Windows 桌面端最小化 / 还原的整窗白帧（浅灰帧）修掉**：最小化动画、任务栏缩略图、以及还原后的那一瞬间，屏上可能出现「整块白」（默认暗化档下偏浅灰）而不是壁纸。机制：壁纸层是挂在 `body` 上、`z-index:-2` 的**普通元素**（像素活在根帧的栅格里），而壁纸激活时插件把底色令牌置成 `transparent` ⇒ 窗口 / 标签页任何一次状态切换都可能在根帧拿不到那一层时露出**窗口底板**（Electron 的 `backgroundColor` 缺省 `#FFF`）与宿主 `body` 的纯白兜底。修复：壁纸激活期间给**根元素**一个不透明的**壁纸代表色**（新变量 `--we-wallpaper-underlay`）—— 画布背景是整条合成链上"不依赖栅格、由合成器直接填充"的最后一层。取值优先**画面占比最大色**（直接从层里已经解码的 video / canvas / img 叶子 64×64 下采样取众数，不发额外请求、不加额外解码），其次作者 / 面板配色（作者填的 `0 0 0` 视作"没填"），都没有就不设（回到透明）。掉层于是从「白闪」降级成「同色底」。同一轮还给可见性恢复加了**一次两帧的复合成微推**（只在"隐藏 → 可见"这一个方向，不常驻合成层）与一条**在屏留痕**（层几何 + 叶子就绪态 + 已呈现帧数 + "下一帧呈现于 +N ms"，后者走 rVFC 而不是定时器），专治「只在特定窗口状态下复现、意图态日志答不了」的问题。**实测**（无头 Edge、跑真产物、页面结构与宿主前端逐条一致）：媒体叶子不绘制时，中心像素由修复前的 `rgb(191,191,191)`（宿主纯白底被默认暗化压过）变成 `rgb(150,30,42)`（该视频自己的主色 —— 取样那条腿赢过作者配色）；壁纸在屏时两版逐像素一致（无副作用）。**上游仍有一处壳侧待办**（本报告的建议 ①）：桌面壳只给 darwin 的窗口设了透明底板，win32 的 `BrowserWindow` 不传 `backgroundColor` ⇒ 底板保持纯白；窗口"完全没有帧可提交"时仍会露它。
- **外壳画布底清底不再钉模式名**：原先只清 `data-dsh-desktop-mode="extended"` 那一档（壳层给该模式的 `.dshDesktopFrame` 刷了不透明底 ⇒ 整片盖住壁纸）。模式名与门控集合由壳层自己演进，钉住一个名字等于把"壁纸被盖住"留成下一次壳层更新时的静默回归 —— 现在壁纸激活时一律清底（兼容模式的基线本就是 transparent，因而是无操作），守卫两个方向都有牙：漏清红，写回单一模式门控也红。
- **`data-we-appwindow` 哑标记删除**：它是"沉浸式窗口自动降毛玻璃"那一版的遗留（消费方 CSS 在保留完整毛玻璃的改动里撤掉了），此后只写不读 —— 而它的判定（`outerWidth === innerWidth`）在桌面壳这类无边框窗口上恰好会误判。属性随消费方一起删掉，诊断面与 DOM 不再有这条没人读的钩子。

- **界面多语言（跟随 DSH 的语言设置）**：插件界面接进宿主的 `locale` 服务（`@deepseek-ai/dsh-client-locale`，随 dsh-web-app 一起来），**语言目录与 dsh web 完全一致**（内置 `zh` / `en`，语言包通过官方 `addLanguage` 追加后也一并跟随）—— 用户在「设置 → 通用 → 语言」里切一次，插件界面**即时**跟着换，不需要重载页面。实现口径：`src/i18n.js`（取词层，可选服务 + 短轮询，缺服务时停在中文）+ `src/i18n-copy.js`（中文原文即键的英文词表）；语言变了由顶层组件的 `useWeLocale()` 订阅触发重渲染，DOM 补丁（设置 nav 图标、设置入口锚点）由 `weOnLocaleChange` 重放，宿主的 slot / tab / shortcut 注册面用 thunk 标签现读现算。宿主半返回给界面显示的文案（上传 / 字体集 / 素材路径等路由应答）由客户端在显示处按同一张表置换 —— 宿主路由契约零改动；宿主那种**运行时拼接**的消息（`不支持的格式：` + 扩展名）不在覆盖内。新增守卫 `test/verify-i18n.mjs`（零裸中文 / 词表双向对账 / 值纪律 / 运行期跟随 / 顶层订阅契约，逐条配负对照）与迁移共用的扫描器 `test/tools/i18n-scan.mjs`，`npm run verify` 链新增这一环。
- **`verify:bridge` 的「环境跳过」（CI 修红）**：windows-latest 上这条端到端会出现「产物 sha256 正确、进程活着、`hello` 不回、两条流都空」——它与"中间件/协议回归"表现**完全一样**，处置却相反（前者是环境差异，后者必须红），而把引导预算从 25s 抬到 90s 已被实测证伪（runner 上 90s 也拿不到）。现在自检在握手失败时先跑一条**主动探针**（对同一份产物发一次平凡调用，看它是否响应）并**校验产物可信度**（sha256 是否就是发布产物）：只有「探针也说这个环境执行不了它 **且** 产物可信」才记**环境跳过**，并在日志末尾点名"这条通道本次没有断言覆盖"（不冒充通过）；探针说执行得了、或产物不可信，照旧判红 —— 于是"环境跑不了"不再挡住无关 PR，而真回归跑不掉。宿主侧的失败行同时补上**子进程 stdout 的首行非协议输出**与**实际用到的 spawn 姿势**（失败行的两路输出此前只带 stderr 与一句"hello 超时"，而那种现场里 stdout 才是唯一还可能说话的一条流）。
- **失败记忆带「管线身份」（旧断言不再跨管线复用）**：`sceneLiveFailures` 说的是"这张壁纸在**当时那条管线**上出不了帧"，而它偏偏是面板那行「实时渲染失败（…）已自动回退」的**唯一**来源。换了 bundle、或宿主终于把场景媒体源端出来（`sceneMediaBase` 从空串变成 loopback origin）之后，旧断言就该作废一次 —— 现在客户端把管线身份（`LIVE_DIAG_BUILD` + 有无媒体源）记在 `localStorage.weLivePipeline`，启动时**在设置落地之后**核对，不一致就清空那批记忆并重建回 live（不必再手动重开「场景实时渲染」开关）。判据**单向**：只有"bundle 变了 / 媒体源从无到有"才清，反向不清（源一抖动就把真实失败记忆抹掉更糟）。**实测动机**：宿主半没重载时留下的 `timeout` 会让"客户端已更新、宿主是旧的"看起来像是修复完全无效。
- **大场景壁纸的「首帧超时」误判修掉（可用性 · 本机实测驱动）**：现场诊断显示 `scene.pkg` 实测到 **336MB**（不是文档假设的 70–90MB），而**首帧必须等整包到齐** —— 三个客户端实例同时挂载同一份包时传输互相饿死，可见那个实例 15s 后 `stats={"fps":0,"running":false}`（一帧都没出）就被判「首帧超时」，并写进**所有窗口共用**的失败记忆。五处修正：① 首帧预算改成 `15s + 包大小 ÷ 8MB/s`（封顶 90s，包大小由 `/inventory` 的新字段 `scenePkgBytes` 给）；② 宿主加一本**载荷传输账本**（新路由 `GET /wallpaper-engine/scene-payload-progress?token=…`），客户端每拍问一次，**字节还在涨就不计超时**（账本未知/旧宿主一律退回墙钟）；③ **隐藏 / 未播放的实例根本不拉载荷**（建层时延迟赋 `src`、切到后台把 `src` 摘成 `about:blank` 中止在飞请求、可见时补回；层键不含这个状态 ⇒ 不重建、垫底图全程在位）；④ **失败分因**：账本说"传过但没传完"⇒ 只记**会话内**软失败（不落盘）+ 冷却 45s 自动重试（至多 2 次），只有渲染页真的不出帧 / 运行期失联才写共享记忆；⑤ **`scene.pkg` 可重验证缓存**（`ETag`(size+mtime) + `Last-Modified`，命中即 304 无体；入口 HTML 仍 no-store）—— 几百 MB 的包每次重建 live 层都重读一遍盘，靠这一条消掉。
- **场景载荷不再按适配器形态门控（性能修正）**：`mediaOriginNeeded()` 门控的是**网页壁纸的能力头栅栏**，而场景要独立源的理由是**带宽** —— 于是原生浏览器形态下 `sceneMediaBase` 曾恒为空串、大包必然走那条会饿死的应用源（本机日志：同一份 336MB 包在媒体源上 0.6s 到齐，应用源上出现过 15–74s 与永不返回）。现在场景载荷无条件懒起媒体源（起不来才回落应用源），客户端层键带上这一格 ⇒ 宿主把它端出来之后会重建一次渲染页；传输类软失败重试前还会刷一次库存，专治"本实例的 inventory 粘在媒体源起来之前"。
- **诊断补的两处硬伤**：`client-boot`（唯一带页 id / 窗口模式、能回答"同一时刻有几个客户端实例在跑"的那一行）**从来没有落过盘** —— 它在 bundle 顶部调 `liveStateBrief()` → `selection`（`const`，还在 TDZ），异常被外层 `catch{}` 静默吞掉（实测两份诊断文件 2495 行里 0 次）；现改成延迟一拍上报。`liveFail` 的现场也补齐了**载荷账本读数 / 媒体源 origin / 首帧预算 / 传输中 tick 数**，下次再有这类问题不必靠推理。
- **大场景壁纸的载荷改走宿主自建媒体源（性能）**：**场景载荷（`scene.pkg`，常 70–90MB）也走宿主自建的独立 loopback 媒体源**（网页壁纸早就走它）。`/inventory` 新增 `sceneMediaBase`（按"库里**真有**可实时渲染的场景"门控、媒体源不可用时落空串），客户端 `liveRenderUrl` 消费它而**不再自己拼 `location.origin`**。**两点别读错**：① 渲染页自身仍在应用源上（它**必须同源** —— 父页要 `frame.contentWindow.__wp` 直接驱动它），所以提速有上限；② 这是**传输路径的改善，不是安全修复**。
- **媒体源接住根路径 `/diag`（可观测性）**：渲染页的诊断信标打的是 `{mediaBase origin}/diag` —— `mediaBase` 一改指向，这个根路径若不在媒体源上也有落点，"场景首帧超时"时渲染页的告警会以 404 **静默丢掉**。诊断族因此把 `handleDiag` 经出参交给媒体源，两边共用**同一份**环形缓冲（`/diag-log` 读到的是一份）。
- **`/scene-files` 目录围栏补第二层（安全加固）**：目标文件的**真实路径**必须仍落在壁纸目录内 —— `lstatSync` 拒链接 + **`realpathSync.native`** 包含性比对，且该层 **fail-closed**（除"不存在"外一律围栏）。实测确认 **JS 版 `realpathSync` 在 Windows 上不解析 junction**（`.native` 才解析），故这一层必须用 `.native`。（**残留**：`lib/scene-manifest.js` 的 `dirSceneAccess` 仍是 junction 盲的，属另一条路由族，本次未动。）
- **启动等待期的预热渲染页泄漏修掉（与上面 ③ 互补）**：`boot-mount-cancel`（启动等待窗口内重新选择壁纸）对**分离态** iframe 赋 `src=about:blank` **不会提交导航** —— 预热页带着整个 WebWallGL 引擎常驻到会话结束（本机实测一次泄漏 **9 个 4K 引擎**存活 1 小时，是"切了几张之后大包首帧全变慢"的放大器；③ 管的是**已挂载**层的可见性暂停，管不到这条**从未挂载**的预热页）。改为先隐身挂进文档让导航真实提交、再移除空壳；已连接（被领养）的帧照旧绝不动。
- **宿主报错在英文界面露中文（i18n 显示点漏查表）**：宿主的 `error` 串是**运行时数据**，客户端必须在**显示处**再过一次 `weT(...)` —— 而字体集那条链路漏了：`lib/routes/fontsets.js` 回的是中文（`字体集数量已达上限` 等），经 `fontset-store` 原样存进 `fontSetError`，到 `src/fontset-editor.js` 直接塞进句子里 ⇒ 英文界面出现 `Font sets unavailable: 字体集数量已达上限`，而词表里早就为这些串备好的英文**永远不会生效**（死词条）。同一份数据的两个显示点此前**一个查表一个不查**（`src/client.js` 查、`src/quick-panel.js` 不查）。现补齐四处显示点（`fontset-editor` / `quick-panel` / `picker-props-panel` / `client.js` 那条裹在 `Error` 里、但 message 会被渲染进「壁纸属性」面板的文案）+ 一条词条；`verify-i18n` 的"零漏译"当场抓出了漏补的那条。
- **「主题随壁纸」被文档写成"没有开关"**：它是 `lib/settings-schema.js` 里 `kind: 'boolFalse'` 的**默认关**开关（面板上就是一行 `switchRow`），而 README 与 HOW-IT-WORKS 中英四份都写着"无开关，行为即自动"，本仓 `CHANGELOG` 自己反倒记对了。已按代码真源改正（**关 = 整条取色链不跑**，与"自动切主题"是两回事）。
- **注释与文档只述当前原理（清考古内容）**：清掉 60 余个源文件里"已经废弃的东西为什么废弃"的叙述——"旧实现…"、"此前埋在 `src/client.js`…"、`评审 P2-x`、`（2026-09 大包事故的修正）`、以及 `1,204 行`/`116 个选择器`/`手抄了 56 次` 这类**会漂的计数**，一律改写为"当前为什么不变量成立"。**保留**：用户文案（`weT` 实参 / 判据名）一字未动、实测出处（写作纪律 2）、`legacy` 这类**活代码**的说明、以及 `CHANGELOG` / `archive` / `wip` 的账本叙述。同批撤除 7 条**守散文**的判据（见下条），并顺手修掉三处真缺陷（产物同步判红、守卫 Usage 指向不存在的文件、审计工具的导入闭包假阳性）。
- **撤除"守散文"的判据并写下判定程序（ADR-0007）**：ADR-0006 定的边界（"读代码的守卫照留，读散文的守卫不加"）此前**只写在散文里**，于是没能拦住三件实测发生的事：判据改去断言源码里的**文案片段**（`includes('有能力头栅栏…')`、`includes('ESC 返回')`、`includes(' 档 · ')`）；一条判据把自己的钉子钉在了**一个 bug 上**（`includes('/设置|Settings/i.test')` —— 而那个正则正是宿主换语言/换措辞就**静默失效**的设置入口锚点，于是"修 bug 会让守卫变红"）；以及一次性清理的收口判据**恒真**留着（笔误「秡」）。现按四问判定程序撤除，并把"判源码文案"改判**机制**（状态行"三分支且每支是 `weT(...)`"，已做变异测试证明有牙）。**同批修掉那个 locale 锚点**（改成宿主标签候选集，并登记两条"照字面匹配宿主"的精确值豁免——我们的词表里 `"设置"` 是**动词**义，直接用它当锚点反而更错）。退役线判据 13 → 10 条。
- **`test/tools/audit-import-closure.mjs` 的假阳性修掉**：它把 `readFileSync(new URL('../package.json', …))` 这类**数据文件读取**当成模块导入，于是 `lib/index.js → package.json` 被误报为"发布包缺文件"。改为**分两类**判（真模块导入才要求 `files` 覆盖；数据读取只核对文件在磁盘上）+ 剥注释，并补了牙齿验证（注入不存在的导入 ⇒ `[UNRESOLVED]` 且非零退出）。

### v1.1.0（1.0.1 → 1.1.0 · 2026-09-29）

> 本安装包含 **1.0.1 之后至 1.1.0** 的全部内容（自 v1.0.1 `6ba2fae` 起落地的提交）。

**界面**

- **主题随壁纸（自动深 / 浅切换）**：换壁纸后插件按壁纸决定全局深色 / 浅色 —— 取色顺序 **① 壁纸自己声明的配色**（`project.json` 的 `schemecolor` / `ui_browse_properties_scheme_color`；你在「壁纸属性」面板里改过的覆盖值优先；**作者填的恰好 `0 0 0` 视作"没填"** —— 那是 WE 新建工程的默认值，本机实测 360 张里 124 张是它，照用会把三分之一壁纸一律钉成深色；面板里显式填的纯黑不受这条影响）**→ ② 画面占比最大色**（64×64 下采样、4 bit/通道量化后取众数桶，只在 ① 缺席时跑；**两个来源合议** —— 作者预览图与真实渲染帧（场景抓帧 / 网页 `__wp.capture`）各判一次，**不一致时取深色**，只有都说是浅色才用浅色（抓帧有落在画面未稳定时刻的风险，而"该深却给浅色"肉眼最容易看见））**→ ③ 两条都拿不到就保持不动**（不抖）；判定用 WCAG 相对亮度，阈值 **0.40**（语义是"**明显偏亮**才配浅色界面"；不取中灰 0.2159 —— 实测本机库作者配色的亮度中位数是 0.214，中灰阈值正好切在分布最密处、±0.05 内 27 张，饱和中间调会被判浅而人眼看是深的）。**默认关**（「外观 → 主题」段最上方的开关，设置键 `themeFollow`；开启后行为即自动，关闭时六个入口全空转 —— 不取色、不判决、不写主题，也不留让位痕记，并清掉它此前留下的合议排名与状态行）。三条自我约束：**结论与当前偏好相同就不写**（`setTheme` 会把偏好落进 profile 的 `cordis.patch.yml`，轮换列表混着亮暗两派时不去重就是每次切换写一次盘）；**你在 DSH 设置里手动改过主题 ⇒ 本张壁纸不再自动**（同一张被重复评估也不会抢回来），**换下一张恢复**；宿主没提供主题服务（`theme`）时整体不生效、绝不抛。顺带修好一处哑管道：宿主早就发了 `schemeColor`，客户端从没接 —— 场景 / 网页壁纸首帧的垫底图因此一直走 CSS 变量兜底，现在按作者配色打底。
- **适配器模式（「适配目标」）**：「高级」页签新增「**适配**」段 —— 自动识别插件跑在 **原生浏览器 / 非官方桌面端 / 官方桌面端** 哪一种里，显示「检测到：… · 有 / 无能力头栅栏」，并可手选覆盖（**手选优先于检测**，是检测不准时的自救）。判定**与操作系统无关**：宿主按**请求头与 UA** 观测 —— 能力头 `x-dsh-desktop-renderer` ⇒ 非官方桌面端（实测只有社区壳 `DSH Desktop.app` 注入，官方 `DeepSeek Harness.app` 的 `app.asar` 里该字面量零命中）、UA 含 `Electron/` ⇒ 桌面壳、两者皆无 ⇒ 原生浏览器；观测用**只增不减的闩锁**，首帧前的探活请求不会把已判明的桌面端改回浏览器（错判成浏览器的代价是网页壁纸 403）。它同时决定四处行为：① **网页壁纸载荷**走独立媒体源还是应用源 —— 原生浏览器没有栅栏就不再多开一个 loopback 监听，该形态的相对路径由守卫单独断言；② **外壳材质规则**（`data-dsh-desktop-mode` / `data-we-mica`）一律经 `[data-we-adapter^="desktop-"]` 门控，浏览器形态不吃壳层材质；③ **「窗口失焦时暂停」只在浏览器目标下提供**（桌面壳失焦时壁纸多半仍整块可见，暂停会定格**可见**画面；已保存的值不删，切回浏览器目标即恢复生效）；④ **面板按目标显隐并说明原因**，手选与检测冲突时给出可执行警示（手选浏览器却观测到栅栏 ⇒ 明说网页壁纸会 403）。
- **设置页签重组**：「字体」页签并入「**外观**」，「玻璃」改名「**雾化**」，调节项按用途归位（外观 / 效果 / 声音 / 高级）—— 页签仍是六个（壁纸 / 外观 / 吉祥物 / 效果 / 声音 / 高级）。
- **字体集（整套字体外观的预设）**：字体自定义从此以**一整套**为单位 —— 随包自带预设，可**新建（以当前外观）/ 重命名 / 删除**；改任何字体项都只落到**当前这一套**，随时可以「恢复原样」回到它本来的样子（改过之后那一套会标注「已改」，点「使用」即整份读回来）。支持**导出 / 导入**一份 `.json`（导出走系统「另存为」对话框，导入前先校验文件里的版本标记，坏文件会给出具体原因）。界面只说"哪一套在用"，不区分随包还是自建。
- **「只看改过的」默认开启**：排版角色表默认只列改过字号 / 字重 / 字族的角色（一行都没改时会给一行提示），并挂成「字体自定义」的一部分 —— 总开关关掉时整块收起。
- **换壁纸过场动画（7 种可选）**：交叉淡化 / 推移 / 擦除 / 光圈 / 缩放 / 条带 / 百叶窗；**默认硬切**，手动点选与自动轮播共用同一套；类型 / 方向 / 速度档**走白名单**（未知值回落默认）。「条带」本轮改为真·百叶窗（原实现与「擦除」肉眼分辨不出）。
- **实时帧行**不再受「实时渲染」开关限制（随时可重新截帧），并显示当前壁纸的实时帧**微缩预览**。
- 过场动画选项改为**下拉菜单**，删去两行冗余面板提示。
- **「启动延迟」改名「启动最长等待时间」，语义改为上限**：延迟期照常预加载（首帧先热起来），**首帧一就绪就换上**、到上限仍未出帧也换上；选项写成 `立即 / ≤3s / ≤5s / ≤10s`。

**日志与提示**

- **终端默认只报问题**：宿主输出收敛成三档（档位名就是日志方法名）—— `error`（会导致插件 / DSH / 系统出问题）、`warn`（降级 / 回退 / 围栏拒绝 / 首帧超时等**影响显示效果**的非正常表现）、`info`（其余全部：逐张贴图、心跳、autosize gate、准备期探测、成功事实的日志侧留痕）。**终端默认只镜像 `error` + `warn`**，`info` 只在 `DSH_WE_LOG_LEVEL=info` 时可见（取值 `error` / `warn` / `info`，默认 `warn`）。此前每一行渲染器上报与心跳都直接打到终端（实测约 18 行/分钟）。
- **成功提示改走独立通道**：终端上的一行 `[wallpaper-engine] … ✔`（「壁纸媒体源已监听」「场景壁纸已就绪」，**与日志行同前缀**，`✔` 只标记"这是成功提示、不是问题"），**每条每会话至多一条**（HMR 重挂不重发）；不经日志、不带级别、不落档。它只在 stdout 是终端时出现 —— DSH 桌面端的宿主由 Electron 以管道启动（`isTTY` 为假）⇒ 桌面端默认安静，`DSH_WE_NOTICE=1` 可显式打开、`=0` 永久静默；**投递失败**才产生一条 `warn`。
- **每个上报端点都自己声明级别**：客户端 `[we-live]` 的诊断行随同源像素请求带上 `&lvl=`（宿主对未知 / 缺失一律落 `info`）；**渲染页**（随包的 WebWallGL 产物）原先只把级别喂给浏览器控制台、请求里丢掉 —— 渲染页同步到 **2.0.2 后自带 `&lvl=`**（按与宿主一致的失败模式表判定），宿主侧 `levelForReport` 一律**以发送端声明为准**、只在声明缺失时才退回那张表；期间曾用过的本地补丁已随 2.0.2 删除。轮换准备期的首帧连续超时从裸 `console.info` 并入同一条通道并标 `warn`。
- **诊断档案加上限**：`~/.dsh-wallpaper-engine/diag/http.jsonl` 写到 8 MiB 时轮转为 `http.jsonl.1`（只留一代）；`/diag-log` 与每行 JSON 的形状不变。
- **客户端异常也留痕**：面板的渲染期异常此前只表现为"界面白掉"——而那台机器打不开 DevTools，诊断缓冲里什么都没有。现在 `error` 与 `unhandledrejection` 会把消息与栈前三行写进同一条诊断通道（标签 `client-error`，级别 `error`），排查时先 `Select-String 'client-error'`。
- 详情与开闸命令见 [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) 的「终端输出：默认只报问题」。

**修复**

- **原生确认弹窗会让壁纸停住、且不再自己恢复**（上游无 issue，实测复现）：`window.confirm` 把焦点交给它自己的窗口 ⇒ 若开着「窗口失焦时暂停」（`pauseOnBlur`），弹窗一出现壁纸就停；模态期间渲染线程被**同步阻塞**（输入框收不到键）；关闭时回来的 `focus` 事件**不保证送达** ⇒ 遮挡判定永久卡在"窗口失焦"，只能重载页面。现在遮挡判定除事件外还做**低频复核**（3s，只在判定变化时 emit 并留一行 `occlusion-recheck` 诊断），并把字体集里的删除改成**面板内确认**（不再使用原生对话框）。
- **按钮与链接不再大小不一**：「重命名」（`<button>`）与「导出」（`<a>`）共用那枚类名，而它原先只钉住了 `<button>` 的盒子 —— `<a>` 默认 `inline`（**行内盒忽略 `height`**）、`content-box`、不继承字体，还带下划线。现在该类名对两种元素都成立（`display` / `box-sizing` / `font` / `line-height` / `text-decoration` 全部写明）。
- **启动等待期切下一张会卡**：延迟期那个未上屏的 iframe 是**正在跑的渲染页**（不是普通元素），换壁纸时无人终止 ⇒ 它留在后台继续拉 pkg / 解码纹理 / 上传，与新壁纸的启动叠在同一主线程上。现在 `applySelection` 与卸载都会清定时器并把它 `src=about:blank` **中止**；挂载处另补一次心跳武装（`load` 回调只在已挂载时武装，而延迟路径的文档可能在挂载前就 load 完 ⇒ `we-live-on` 会永远不加上）。护栏 `rotation-prepared-leak-smoke` 的 Q1 / Q2 / Q3（各带可失败对照）。
- **首次激活场景壁纸不再黑屏**：新壁纸**第一次**激活时实时抓帧还不存在（要等这一轮 live 回填），而垫底画面当时只试「抓帧」一级、失败后**静默保留近黑主题色** ⇒ 首帧前是一块黑屏。现在垫底画面按 **实时抓帧 → 作者随包发布的预览图 → 主题色** 取：预览图**只作占位**（不算"替作者猜一张图"，`/scene-frame` 的空态语义**不变**、服务端一个字节没改），live 首帧一到即被顶掉；护栏 `rotation-prepared-leak-smoke` 的 P / P2（正 / 负对照成对）。
- **修复 harness 0.1.7 下「右栏关闭态露出玻璃底板」（上游 issue #107）**：宿主右栏面板容器在**关闭态**仍占宽度、且自身没有背景，而插件无条件给它刷玻璃底 ⇒ 对话区右侧露出一块中灰板（控制台零报错，易被误判成主题问题）。现在**所有**给该容器上色的规则（含 `.cm-editor` / `.xterm` 内容面与软件渲染兜底）都限定在 `[data-sidebar-right-open]`，并补一条关闭态显式清底；护栏 `verify-host-paint-scope`。
- **移除「beta 场景动画」**：`betaSceneAnim` 开关、宿主 `/scene-anim` 与 `/scene-anim-progress` 路由、客户端动画升级队列 / 进度轮询 / 探针 `<video>`、worker 多帧渲染与 APNG 输出**整体删除**（WebWallGL 实时渲染已是其上位替代）；`verify-client` 增**反向探针**，断言该路线不会复活。
- **资源泄漏修复（审计 12 项）**：scene-anim 析构、探针视频、监听器、定时器、轮询守卫；宿主侧资源与缓存上限一并修复。
- **`sceneVideo` 字段诚实化**：仅在壁纸真含内嵌 MP4 时输出；补时序拉取，且 live 期间不进层 key。
- **壁纸透明度拉高时垫底静态帧透出**：淡出底色改为原生纯黑 / 纯白。
- **未闭合的 CSS 注释吞掉 `.we-layer` 规则**（视频壁纸掉到页面底部 / 场景壁纸盖住文字层）。
- **extended 模式壁纸被外壳画布盖住**：清掉 `.dshDesktopFrame` 的不透明底。
- **增强模式左侧工作区在 Win10（无 Mica）下的兜底**（上游 #73）。
- **软件渲染下玻璃不兜底**（上游 issue #95）：`@supports not (backdrop-filter)` 这类**语法**检测在「语法支持但渲染不发生」时仍为真 ⇒ 兜底永不触发、面板过透。新增 `detectSoftwareRender()`（取不到 WebGL 上下文即判软件，并按 `UNMASKED_RENDERER_WEBGL` / `VENDOR` 匹配 swiftshader / llvmpipe 等）与 `?we-glassfallback=on|off` 手动覆盖；兜底同时覆盖 composer 卡片的 `::before` 载体。
- **玻璃可读性下限**（#82）：给承载文字的面压一层主题底色（`--we-readability-floor`，明 0.45 / 暗 0.59）—— 壁纸可被压暗混淡，正文保持 ≥4.5:1。
- **输入框卡片的模糊改由 `::before` 承载**（#89 / #94），恢复 fixed 后代的视口定位。
- **ffmpeg 子进程 cwd 跨平台修复** + 健壮性审计。

**依赖与护栏**

- 以最小形式采纳上游 PR #87 的 `js-yaml` 约束（非可达漏洞）。
- 打包白名单回归断言（`verify-package-files`），覆盖 `lib/**` 全部运行时模块。
- **发布面三处补强（v1.1.0）**：
  - **`scripts/prepare.mjs` 进入 `files`**：`prepare` 在 git 直装、或把包装成**根项目**执行（解包后 `pnpm install`）时真的会跑 —— 脚本不随包就是执行即 `MODULE_NOT_FOUND`（把发布包解开当根项目跑 `pnpm install` 可稳定复现）。配套：`verify-package-publish` ⑦ 不再把 `prepare` 当开发期脚本（它的引用必须随包），② 只为这一个文件开白名单，其余 `src/` `scripts/` `test/` `docs/` 照旧一律判红。
  - **可达闭包的相对导入目标必须在磁盘上在位**（`verify-package-publish` ① 新增断言 + 负对照）：指向不存在文件的 import 在仓库里是死路径、本地没人撞得上，装到用户机器上才炸成 `ERR_MODULE_NOT_FOUND` —— npm 上的 1.0.1 正是这么残缺的（`lib/scene-scripts.js` 引用的 `./scene-script-apis.js` 从未进过发布物）。同一口径再落到 `verify-package-files` 的新 **P7**：扫 `lib/**` 全部运行时模块（不只 `lib/index.js` 的可达闭包），相对导入目标缺失即判红。
  - **版本 `1.0.1 → 1.1.0`**：npm 上的 1.0.1 已发布且不可覆盖，仓库与它内容不同步，只能靠新版本把当前代码带上去。

**文档与仓库整理**

- 规划文档入库（`docs/`）；**静态帧渲染线归档**到 `docs/archive/static-frame/` —— 该线与 beta 场景动画线的渲染器实现均已迁往独立仓库 [`YV3507/we-static-frame`](https://github.com/YV3507/we-static-frame)（把场景离线渲染成一张 PNG，可当库或 CLI 用），**将由其它贡献者在下次更新移除**。

**移除 / 行为变更**

- **静态帧线整体移除**：离线场景渲染器 / 主纹理提取 / 合成器，以及「静态帧」后台预热**全部删除**（约 1 万行）。场景壁纸的**出图来源**现在只有两级 —— **实时画面**（实时抓帧，优先）与**自定义画面**（你导入的截图）；两者都没有时**诚实留空**，不再"替作者猜一张图"（那会产出一张糊图，把"这张壁纸没有可用画面"这个**可判定事实**掩盖掉）。
  配套：`?v=1/2/3` 档位退役（旧配置按"自动"处理，**无需迁移**）；帧缓存键改名升值（旧缓存自动失效重建，代价只是重抓几张实时帧）；面板上「壁纸画面刷新」改名为「**出图来源**」（两档）。

### v1.0.1（里程碑 · 2026-09-25）

> 本安装包含 **0.7.6 + 0.7.7 + 0.7.8 + 1.0.1**。

- **「扩展模式」兼容修复**：修复扩展模式下壁纸不显示、以及壁纸「正常几秒后失效成静态图 / 预览图」的问题 —— **兼容 / 增强 / 扩展三种窗口模式下壁纸与全部效果均可用**，无需再切换窗口模式。
- 应用内公告升级至 1.0.1：移除「扩展模式暂不支持」窗口模式警告；新增 Tips：设置面板中部分暂未生效的选项为后续版本的待更新内容，会随更新逐步开放。

### v0.7.8（场景壁纸实时渲染全面上线）

- **场景壁纸实时渲染引擎**：接入 WebWallGL 实时渲染，90% 以上的场景效果都能完整实时呈现；个别渲染不动的壁纸自动回落静态帧管线（毫秒级出图 + 后台预热），不会黑屏。
- **鼠标视差 / 鼠标透视**：场景层次随鼠标移动产生位移；透视 / 景深随鼠标位置实时变化。
- **动态粒子 + 水波纹 + 鼠标点击交互**：粒子系统实时运行（质量档位可在效果页签调整）；水面 / 液体波纹；光标脚本、粒子锁点等点击响应（左键）。
- **音频检测（音乐频谱律动）**：Windows 走系统音频（WASAPI 回环 + GSMTC），**无需 Stereo Mix / 虚拟声卡 / 任何额外接线**；同时带 Now Playing —— 曲目 / 歌手 / 封面直达壁纸。
- **帧率上限与播放态管理**：15 / 30 / 60 fps 上限自由设定；窗口隐藏 / 最小化 / 失焦自动暂停；电池供电自动暂停（均可在效果页签关闭）。
- **dsh-desktop 2.0.14 全面适配**：修复升级后的插件加载失败、右栏玻璃关闭态露灰板、增强模式左栏灰面板遮挡壁纸等问题；建议搭配 dsh-desktop 2.0.14 及以上版本。

### v0.7.6 / v0.7.7

- **壁纸属性面板**：作者属性热更新 + 卡片在抽屉里的窄布局；抽屉名称行居中等 UI 修正。
- **轮换升级**：就绪后切换 + 交叉渐变（统一放慢到 1.8s：轮换 / GPU 静帧→首帧淡入 / 手动换壁纸同一套渐变）+ live / web 节点级领养。
- **媒体三平台**：media-bridge 接入（macOS / Windows / Linux），中间件版本钉 v0.1.5（频谱口径修正 + 采集跟随默认输出设备）；歌曲封面（Now Playing artwork）通用取源；新增**在线歌词**（本地 `.lrc` / 已缓存优先，本地没有才向 lrclib.net 查一次 —— 该请求会外发歌名 / 歌手 / 专辑，因此默认关闭）。
- **网页壁纸修复**：独立壁纸媒体源提供载荷（修 Desktop 全黑）、跨源重复注入 shim 导致帧率被限两次、渲染页同步 webwallgl 1.4.2（含两类网页壁纸白屏修复）。
- **GPU 抓帧回填 + 几何校验**：实时帧缓存回填静态帧缓存、面板状态 / 清除入口、CPU 渲染严格门禁；存帧视比与当前视口不符自动清掉重抓。
- **视频类壁纸恢复 0.7.5「选中即播」**（去掉 preview 海报与预热探测链）；官方资源路径（WE assets 目录，宿主半边 + 客户端半边）。
- **排查台**：网页壁纸「白屏」排查（无头真浏览器截图 + 控制台报错）；渲染链路黑匣子（客户端关键步骤上报 + 宿主落盘）。

### v0.7.5

> 上游 v0.7.5 的内容（`#91` 字体重做与画面刷新档位、`#99` 视频壁纸音轨、玻璃饱和度不再随模糊上涨 `#98` 等）+ 本仓库 **0.7.4 全部内容**（见下节）。
> ⚠️ **WebWallGL 实时渲染（`#103`）与 `lib/webwallgl/` 发布白名单不在本版内** —— 它们是**追版合并**的成果（后来随 `v1.1.0` 一并发布）；本版发布时的管线前缀是 `sf33_`。

### v0.7.4（未发布 — 内容并入 v0.7.5）

> npm 上的 0.7.3 已被更早的提交占用且不可覆盖，故版本上调；0.7.4 = 0.7.3 内容 + #88（场景静态帧系列修复）+ 下列两条。**该版本号从未发布到 npm**（`0.7.3 → 0.7.5`），其内容随 v0.7.5 一起出货。

- **输入框玻璃定位修复**（[#89](https://github.com/elysia395/dsh-wallpaper-engine/issues/89)，社区 PR [#94](https://github.com/elysia395/dsh-wallpaper-engine/pull/94)）：`[data-composer-card]` 内含 `position:fixed` 后代（`@dsh-external/dsh-webui` 把「AI 浏览器」座位挂在卡片内部），而卡片上的 `backdrop-filter` 按规范会成为这些 fixed 后代的**包含块** —— 座位不再相对视口定位、多出数百 px 幽灵溢出，输入框滚到底时被留在上方。现在模糊改由 `::before` 伪元素承载（伪元素没有 DOM 后代，永远不会成为包含块），模糊半径 / `--we-*` 变量 / 圆角全部沿用，视觉等价。
- **场景内嵌视频字段诚实化**（[#92](https://github.com/elysia395/dsh-wallpaper-engine/issues/92)，社区 PR [#94](https://github.com/elysia395/dsh-wallpaper-engine/pull/94)）：过去 inventory 用「静态帧可用」冒充「内嵌 MP4」，对几乎所有场景壁纸都输出 `sceneVideo` URL，客户端请求 `/scene-video` 必然 404。现在按「pkg 路径 + mtime」缓存真实探测结果（有界 LRU + 后台补齐 + 真实请求回填，未知一律 `null`、绝不猜），只有确认内嵌 MP4 才给地址。

### v0.7.3

- **自定义上传壁纸可用性 + 播放状态如实显示**（[#84](https://github.com/elysia395/dsh-wallpaper-engine/issues/84)）：
  - ① 自上传内容在 `uploads/.meta.json` 里从不写 `contentrating`，过去算「未分级」而内容分级默认是 **Everyone**，于是**所有自上传壁纸默认被过滤掉**（网格里看不到、被上传流程自动应用时直接拒绝 → 壁纸层空白 + 播放按钮变灰）。现在未标注分级的自上传内容按 **Everyone** 处理，自己的文件开箱即用，显式标注 G / PG13 / R 的照常过滤。
  - ② 视频 `play()` 被拒（自动播放策略、浏览器解不了的编码如 HEVC/10-bit、被紧接着的 src 切换打断）时过去**静默吞掉**：面板继续写「播放中」、卡片上只有「暂停」，壁纸冻在首帧却无「继续」可点。现在按 `<video>` 的**真实状态**显示，按钮回到「播放」可重试并给出原因（如「无法解码这段视频，建议改用 H.264」），并在媒体就绪后**自动补一次播放**。
  - ③ 被过滤条件丢弃的当前壁纸不再是无解释的空白，卡片上会写明是哪一项过滤挡住的。
- **壁纸透明度**（[#82](https://github.com/elysia395/dsh-wallpaper-engine/issues/82)）：「效果」区新增滑动条（0–90 %，越大越透，默认 0 %）——把壁纸整层淡出、融向页面底色，即 IDEA 背景图式的「看得见但不喧宾夺主」；与暗化互补，文字可读性不受影响。
- **输入光标颜色**（[#83](https://github.com/elysia395/dsh-wallpaper-engine/issues/83)）：「字体」页签新增 **输入光标** 分区——光标颜色与壁纸相近看不清时，可从 6 种预设或自定义取色器里挑一个高对比颜色（也可选「自动」恢复 dsh 原生表现，默认即为「自动」）；作用于所有输入框与可编辑区域，独立于字体自定义开关。

### v0.7.2

- **前置条件升级**：适配 DeepSeek Harness **0.1.5-rc.1**（DSH Desktop ≥ 2.0.7），并要求 **dsh-better-sidebar ≥ 0.19.0**。升级顺序与回退方式见 [`UPGRADING.md`](./UPGRADING.md)。
- **修复「右侧栏完全透明」并把玻璃扩展到官方原生右侧栏**：harness 0.1.5 的官方原生右侧栏面板直接绘制 `--dsw-alias-bg-base`——这正是本插件为露出壁纸设成透明的 token，且官方面板没有自己的毛玻璃，导致升级 better-sidebar 0.19 后右侧栏整体透明。v0.7.2 起官方原生右侧栏纳入「侧栏液态玻璃」适配：同一组**侧栏模糊 / 透明度 / 玻璃颜色**滑杆生效，总开关关闭时回退主题面板色（不再透明）。这组滑杆是：**侧栏液态玻璃**（总开关，默认开）· **侧栏模糊**（0–200 px，默认 16）· **侧栏透明度**（0–200 %，默认 120 %，越大越透）· **侧栏玻璃颜色**（6 预设 + 自定义取色，默认 `#ffffff`）。
- 追补修复：侧栏颜色调节与内容面在官方原生右侧栏失效；侧栏颜色混入强度改为独立于透明度的可见性曲线。

### v0.7.1

- **适配 DeepSeek Harness 0.1.2-rc.1**，并在 **DSH Desktop v2.0.5** 上完成实测：壁纸宿主路由（inventory / media / scene-frame）、设置一级分区、选择器弹窗、视频与场景壁纸播放、拉绳抽屉、液态玻璃在「兼容模式」与「增强模式」下均正常。本插件依赖的 slots / webserver / 主题变量等 API 在 0.1.2-rc.1 → 0.1.5-rc.1 之间经实测同样稳定。
- **修复 rc.1 的「色板 / 黑胶唱片变圆角矩形」**（[#74](https://github.com/elysia395/dsh-wallpaper-engine/issues/74)）：rc.1 主题层新增 `corner-shape.css`，给**所有元素**统一加了 `corner-shape: superellipse(1.5)`（方圆形角），任何 `border-radius:50%` 的正圆都被渲染成圆角矩形。插件现已对自身绘制的全部正圆 / 胶囊控件（色板、黑胶唱片、滑杆圆点、开关滑块、字体 chip 等）显式重置 `corner-shape: round`，在旧版 harness 上该声明会被自动忽略、无副作用。

### v0.6.8

- 场景渲染管线的稳定化修复批次（solid layer 白方块 / JPEG 回退 alpha / clearcolor / `#86` 残留 / 资源泄漏回归护栏）；发布包 `files` 白名单回归由 `test/verify-package-files.mjs` 长期看护。

### v0.6.7

- **字体自定义**：设置新增「字体」分区——总开关默认关闭（即 dsh 原生外观），开启后可调 **字体颜色 / 字重(100–900) / 字体族**（默认 · 雅黑 · 楷体 · 宋体 · 黑体 · 行楷 · 等宽，选项按钮以各自字体实时预览）；报错红字不受染色影响，关闭总开关即一键恢复默认。

### v0.6.4

- **优化「沉浸式全屏窗口偶尔全屏闪白」**（保留完整毛玻璃）：早期版本在**桌面快捷方式打开的沉浸式全屏窗口**（独立应用 / kiosk 窗口）里，点击对话或输入文字时**可能整屏闪白一下**——这是该窗口 + 硬件加速下，Chromium 合成器对壁纸重绘时偶发把整屏画白。v0.6.4 继续按「减少合成层」处理：仓库面板关闭时懒加载、拉绳无永久滤镜、壁纸媒体默认下不再强制一个变换合成层——同时**完整保留毛玻璃**；普通浏览器标签页完全不受影响，保持完整毛玻璃与硬件加速。插件更新后会弹一次提示，告知此优化（每个新版本仅出现一次）。

### v0.6.3 前后

- **吉祥物（聊天顶部拉绳）**：一条可拖拽的拉绳沿顶部吸附，向下拉即拉出**壁纸仓库**抽屉；可切换形态（小女仆 / 鲸御姐）与大小（0.5×–2.5×）。
- **壁纸效果调节条扩充**（v0.6.x）：「壁纸效果」区新增 **亮度 / 对比度 / 饱和度** 三个滑动条（**亮度 40–160 % / 对比度 40–200 % / 饱和度 0–200 %**，默认均 100 %；作用于壁纸媒体滤镜），与壁纸模糊 / 暗化等配合，任意壁纸都能调到与界面融合舒服的状态；全部即时生效、持久保存。

### v0.6.0

- **场景壁纸完整场景帧**：Scene 壁纸由纯 JS 场景渲染器完整重放（对象树 / 纹理 / 粒子 / shader 效果），不再是主纹理静态帧。实现细节见 [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md)。

### v0.5.x

- **遮挡暂停（省电三档）**：类似 Wallpaper Engine 的「被遮挡时暂停」——最小化 / 切页、窗口失焦、使用电池供电时自动暂停视频壁纸，**解码引擎直接归零**；回到界面 / 接通电源自动继续（网页壁纸仅随页面隐藏被浏览器节流）。三档开关均持久保存，分别是「最小化 / 切页时暂停」（默认开）、「窗口失焦时暂停」（默认关）、「使用电池时暂停」（默认关）；场景实时渲染同样会在这些时机暂停渲染循环。
- **解码帧率上限（抽帧转码）**：高帧率源（如 4K120 H.264）的硬解是 GPU 占用大头（4060 实测 1.0x 达 ~60% Video Decode）。宿主端用 ffmpeg 一次性重编码为上限帧率（时间线保持 1.0x **正常速度**、与倍速完全解耦），输出 **4K 保留 + AV1**，带下载 / 转码实时进度条；实测 4K120→24fps 后占用从 ~60% 降至 **~15%**。ffmpeg 三档供给：显式指定 → 自动下载（npmmirror + GitHub 双源竞速）→ 系统 PATH。档位为 无限制 / 60 / 48 / 30 / 24 fps，源帧率已在上限内自动跳过；按「路径 + mtime + 上限」缓存，轮转里每张只付一次成本；转码优先 **NVENC**（`av1_nvenc` → `h264_nvenc`），无 NVIDIA 显卡时回落 **libx264 软件编码**；只有拿不到 ffmpeg 时才自动关闭、壁纸保持原片。

### v0.4.1

- **媒体流句柄修复 + 扫描提速**：媒体 / 预览 / 场景帧流在客户端断开时**立即释放文件句柄**（修复反复切壁纸 / 刷新累积句柄、Windows 上壁纸文件被锁无法删除 / 移动的问题）；壁纸库扫描改**全异步**（fs.promises 线程池），不再阻塞事件循环（WSL / 大壁纸库下启动明显更快）。
- **WSL 支持**：自动探测 `/mnt/<盘符>` 挂载的 Windows Steam 库，WSL 里也能发现壁纸。

### v0.4.0

- **设置持久化到宿主端文件**：全部设置（已选壁纸、配色、透明度、布局、轮播、隐藏、倍速 / 翻转等）改存 `~/.dsh-wallpaper-engine/config.json`，不再依赖浏览器 localStorage —— **重启、换端口（含 DSH Desktop 的随机端口）、清浏览器数据、换浏览器都不再丢失**；旧版 localStorage 配置首次启动自动迁移。
- **Edge 兼容渲染**：Edge（且仅 Edge）会在页面里任何「可见的 `<video>`」上绘制浏览器自带的「下载 / 投屏」悬浮工具栏，且没有官方开关可以关闭；插件因此在 Edge 中默认把视频壁纸改为 **canvas 渲染**来规避。「紧凑布局」同一行右侧新增「**Edge 兼容**」开关（默认开启），关闭后所有浏览器一律回退到原生 `<video>`。

### v0.3.1–v0.3.6

- **液态玻璃设置页**（v0.3.1）：设置页升级为**一级设置页**（参照 dsh-web-ui-all 皮肤中心的设计），整页是可自定义的液态玻璃卡片 —— **配色**（6 种预设 + 自定义取色）与**配色**（默认经典蓝 `#4f8cff`）与**玻璃透明度**（0–60 %，默认 12 %）即时生效、持久保存。
- **整个设置窗口液态玻璃化**（v0.3.2）：一键把 **DSH 原生设置窗口整体**（对话框 + 左侧导航 + General / 模型 / 插件等**全部原生分区**）换成液态玻璃 + 自定义配色；关闭则恢复原生样式。
- **玻璃调节统一**（v0.3.3–v0.3.5）：设置窗口的玻璃模糊与**对话栏共用同一套调节参数**（「玻璃」滑动条 0–60 px 同时控制设置窗口与输入栏 / 气泡的模糊半径，饱和度 / 亮度 / 对比度配方一致）；新增「**玻璃颜色**」—— 设置窗口玻璃的**底色色调**可自定义（6 预设 + 自定义取色，默认浅色白 / 深色深夜蓝，选定后两种主题统一使用该色），与「配色」分工：**配色管控件、玻璃颜色管玻璃本身**。
- **卡片样式与黑胶唱片**：「紧凑布局」开关（CD 架式纵向层叠）与旋转黑胶唱片标签效果。

### v0.2

- **壁纸选择弹窗**：缩略图网格收纳进独立弹窗，设置页不再被长列表占满。
- **隐藏 / 恢复**：不想看的壁纸一键隐藏（软删除），随时恢复，不碰源文件。
- **视频倍速**：0.5x – 2x 六档原生调速，即时生效、不重载。
- **水平翻转**：镜像画面（视频 / 网页 / 上传图片均适用）。
- **自定义壁纸**：直接上传本地 JPG / PNG / MP4 当壁纸，可选存储位置（默认 `~/.dsh-wallpaper-engine/uploads`，可改到任意盘符并自动迁移已有文件）与画面适配模式（覆盖 / 填充 / 居中 / 拉伸）；上传的 MP4 自动生成抽帧缩略图。

---
