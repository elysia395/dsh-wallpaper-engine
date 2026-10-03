# 变更记录（Changelog）

> **English**: [`en/CHANGELOG.md`](./en/CHANGELOG.md)（与本文同源：改一处请同步另一处）
>
> 本文件承接原先堆在 README 首页的**版本公告与功能清单**。门面（`../README.md` / `../README.en.md`）
> 只保留与版本无关的亮点；带版本号、issue 号、性能数字的内容一律记在这里。
>
> **当前发布版本：`v1.2.0`**（与 `package.json` 的 `version` 一致）。
> `### 未发布（下一版）` 记的是 **v1.2.0 之后**的增量 —— 暂无；**`### v1.2.0`** 一节收拢的是 **1.1.0 之后至 1.2.0**
> 的全部内容（侧栏工作台：外观 / 播放进侧栏与「壁纸属性」；玻璃染色地板与「左侧栏覆盖」；前置基线切换到官方桌面端 ≥ 0.2.0-rc.1）；
> **`### v1.1.0`** 一节收拢的是 **1.0.1 之后至 1.1.0** 的全部内容。
>
> **归档说明**：本仓库从 **v0.6.8** 起才有 git tag，更早的版本没有独立标签。早于 v0.6.8 的条目
> 按**原 README 原文的版本标注**归档；原文未标注小版本的条目放进区间桶，不臆造版本号。
> 完整逐提交历史见 GitHub Commits / Releases；升级前置条件见 [`UPGRADING.md`](./UPGRADING.md)。

### 未发布（下一版）

> v1.2.0 之后的增量（本地未发布，逐提交可查）：

- **一号模块「硬件资源监控柱状图」的默认值按维护者实际调好的那套参数固化**（用户口径："将当前插件的
  『硬件资源监控柱状图』扩展中的设置设为默认配置" ⇒ 明确为"把我现在实际调好的那套值固化成默认值"）。
  **做了什么**：`lib/settings-schema.js` 的 `DEFAULTS` 里**十键改值** —— `metricsEnabled` **默认改开**，
  另有高度 / 垂直偏移 / 柱宽 / 行间隔 / 阈值 / 不透明度 / 极黑档倍率 / 荧光 / 描边宽度（数值见该文件，
  这里不另抄一份）；键的集合与顺序未变（唯一动的不只是"值"：`metricsEnabled` 的 kind 也从 `boolFalse` 换成了 `boolTrue` —— kind 自己编着"缺值时的取值"（`boolFalse` 就是 `v === true`，缺值归 false），只改 `DEFAULTS` 会被 sanitize 抹回去），以及 `KINDS` 的每一段范围一律未动，其余十九键与那套值本来就一致
  （水平偏移 0 / 柱间距 2 / 细白横线开 / 混合模式「自动」/ 平滑 60 / 时间窗 60 / 实心柱开 / 序列名称开 /
  三条序列开、网络与磁盘关）⇒ 原样保留。
  **为什么**：这十键不是出厂拍脑袋值，是逐项手调出来的观感 —— 固化之后新装或被重置的用户直接就是这个
  样子，不必再照截图重拖一遍；总开关跟着变开，因为柱状图正是这个模块存在的意义。
  **判据**：`test/verify-client.mjs` 的「扩展」块改成"一号模块默认开 ⇒ 参数控件直接画出来"（另两个模块
  仍默认关、仍钉住"关着不画参数"这一条），滑块的默认回显改判固化后的值，并新增"关掉总开关后那一串参数
  必须收起来"；`test/verify-scene-live.mjs` 里那张扩展岛的对比，「关」那一档改成**显式**写
  `metricsEnabled: false`（原来直接拿 `DEFAULTS` 当"关"的样本 —— 默认值一转开，这一对比就成了恒真，
  判据自己先判红了一次）；golden 夹具按新默认重钉（`.test-cache/regen-golden-metrics.mjs` 新增 `RESTAMPED` 十键：
  键集没变、只变默认值 ⇒ 走"重钉"而不是"补新键"，跑出 `added 0 key slots across 18 cases`，安全阀 =
  其余键零漂移）。
  **没有新设置键**（数量 / 顺序 / 范围都没动）⇒ `docs/ROUTE-INDEX.md` 与 `lib/types/` 都不动。

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
  于是柱子每秒换帧时白线不会跟着重画；两层的显隐与混合因此互不牵连 —— 这正是下一版「随光标位置
  响应的 3D 纵深」要的接口；④ 「分色」档不再用内置固定色相，改成五个新设置键
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
