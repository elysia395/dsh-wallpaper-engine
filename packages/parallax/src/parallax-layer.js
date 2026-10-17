/**
 * parallax-layer.js — 「3D 效果」的**视差层**：光标移动时把壁纸 / 吉祥物挪一小段。
 *
 * ══ 为什么是这样一个角色 ══════════════════════════════════════════════════════
 * 它是**基座模块**（见 docs/CODE-STRUCTURE.md §3.1）：不吃 ctx、直接读扁平设置 store
 * `selection`，和 `video-layer` / `effects` / `fx-layer` 同层 —— 驱动源不是某次渲染，而是
 * **输入事件**（pointermove）与一个 rAF 缓动循环；"光标一动就有反应"必须当场发生。
 *
 * ══ 它怎么动 ═════════════════════════════════════════════════════════════════
 *   · **单位量**：光标相对屏幕中心偏移 u = (光标 − 中心)，则该层的目标位移是
 *     `PARALLAX_DIRECTION × u × pct/50`（pct = 这个层的"缓动距离"，单位 = 最长对角线的
 *     百分之几；除数是 PARALLAX_STEP_DIV = 100 / 2）。用户口径 m02697-① 的定义是
 *     "**能达到的最大位移** = 屏幕对角线的 p%"：光标在屏幕角上时 |u| 最大 = 对角线 d / 2
 *     ⇒ 位移 = 2 × pct/100 × d/2 = pct% × d ✓（少一个 ×2 就会让所有层的位移翻倍）。
 *     方向 `PARALLAX_DIRECTION = -1`：**关于屏幕中心对称**（光标在右上，整块往左下走）；
 *     改成跟随光标只需把它写成 +1。
 *   · **缓动**：位移不直接等于目标，而是按 `parallaxSmooth` 每帧朝目标逼近一截
 *     （指数逼近；按真实 dt 折算 ⇒ 掉帧时跟手程度不变）⇒ 光标停下后影子还会飘一小段才归位。
 *   · **写什么**：每帧把**最终位移**直接写进那几层自己的 CSS 独立属性 `translate`
 *     （与壁纸过场内联写的 `transform` 叠加而不互相清掉）；**每帧一个自定义属性都不写** ——
 *     自定义属性是继承的，写一次就会让整棵子树重算样式，而"光标一动就写一次"正是这条链路上
 *     最贵的一笔。各层的系数（`.we-layer` 用 `parallaxBg`、`.we-rope` 用 `parallaxMascot`，
 *     关掉时为 0）在 JS 里乘完再写；壁纸补边的静态 `scale` 仍由样式表用 body 上的
 *     `--we-parallax-bg` 算（那个变量只在设置变了时写一次，不在帧里）。
 *   · **界面整块也能跟着动**（`parallaxUi`，默认关，用户口径 m01371）：输入卡片 / 会话文本区
 *     （连里面的**用户气泡**）/ 左栏这四组**整体**跟着光标走 ⇒ **文字与它底下的玻璃一起动**
 *     —— 动的是容器，不是文字节点。方向与壁纸**同向**（用户口径："希望输入框和背景同向运动，
 *     体现层次与纵深感"）⇒ 近处的界面比远处的壁纸多走一点。四条界面组独有的规矩：
 *     ① 位移**量化到整设备像素**且带**迟滞**（文字底下就是像素网格，落在半个像素上会被重采样
 *     成糊的；壁纸/吉祥物是图像层，刻意不量化 —— 量化反而会让它一顿一顿的。缓动尾巴会在零点
 *     附近来回磨，没迟滞就会两帧之间把 0 与 1 个设备像素翻来翻去 —— 用户口径 m01915-② 说的
 *     抖动就是它，见 PARALLAX_GROUP_DEAD_PX / parallaxSnapAxis()）；
 *     ② 位移归零时**把 `translate` 摘掉**。只要它存在（哪怕 0px），这个元素就成了 `position:
 *     fixed` 后代的**包含块** —— 那是本仓 #89 的坑（卡片里挂着第三方插件的座位，包含块一换
 *     就跑到卡片角上）；组里真有 fixed 后代时整组不动，见 parallaxGroupBlocked()。
 *     **左栏是例外**：那一列里长着宿主自己的 fixed 标题栏按钮（Windows 标题栏模式下的
 *     「收起 / 展开侧边栏」钉在标题栏左上角，见 docs/DSH-UI-INTERFACES.md），加 `translate`
 *     会把按钮整体推下去一个标题栏高度（用户口径 m01915-③，与本仓 #131 同一类事故）⇒
 *     左栏改用 `position: relative` + `left`/`top`：相对定位**不是** fixed 后代的包含块，
 *     按钮照旧钉在视口上（见 parallaxTargetOffset()）。代价是那一列每帧多一次布局；
 *     ③ **槽出口自己没有盒子，位移要落到有盒子的那一层上**：宿主给每个槽出口写死
 *     `display: contents`（asar 里的 `ANCHOR_STYLE`，见 docs/DSH-UI-INTERFACES.md），`translate`
 *     写在出口身上屏上一点都不会动（"只有输入框在动"就是这个缘故）⇒ 见 parallaxGroupBox()：
 *     **从锚点自身起判**，自己有盒子就用自己（输入卡片动的是卡片本体、每条用户气泡各自成为
 *     独立的位移目标），一路 `contents` 才往上找；
 *     ④ 四个区域各有**自己的距离**（`parallaxUiChatDepth` / `parallaxUiComposerDepth` /
 *     `parallaxUiSidebarDepth` / `parallaxUiBubbleDepth`，用户口径 m01915-①）：每块自己就是
 *     **绝对的最大位移百分比**（用户裁决 m02697-①/③：总倍率 `parallaxUiDepth` 已退役；出厂值
 *     = 1.2 / 1.8 / 1.6 / 1.4，真源 lib/settings-schema.js，用户诉求 m04159；**0 = 完全不缓动**）；
 *     系数 = 该区域值 × `PARALLAX_UI_SIGN`。嵌套规矩对气泡那一档放开：气泡行本来就长在会话
 *     文本区的盒子里，两者都动、位移叠加（"气泡比文本区再多走一点"的来路），其余组里套组仍
 *     只留最外侧那个。
 *     ⑤ **别的插件注册的前端元素组也参与**（用户裁决 m02697-②/③）：运行期按槽出口 `[data-slot]`
 *     认（`parallaxPluginGroups()`），距离从 `parallaxPluginDepths`（槽键 → %，真源
 *     lib/settings-schema.js）里取，**缺键 = 参与**（默认 `PARALLAX_PLUGIN_DEFAULT` = 1%），值为
 *     0 = 这一组完全不缓动；整块有**自己的开关** `parallaxPlugin`（用户诉求 m03549：插件前端单独
 *     归类加开关；裁决 = 独立于 `parallaxUi`、默认关）—— 关着时一个插件组都不认（连扫都不扫，
 *     见 ③ 的子树判定开销），表里的距离原样留着、开关一开照旧生效。「扩展」页签里那一段的行与
 *     这里**同源**（`parallaxDiscoveredGroups()` ⇒ 会动的组一定有开关，有开关的组一定在动）。
 *   · **跟随真实刷新率**：不人工封顶 60Hz；缓动本来就按真实 dt 折算，手感与封顶时一致。
 *   · **帧里零测量**：帧内不读 `window.innerWidth`、不 `querySelectorAll`、更不碰
 *     `getBoundingClientRect` / `getComputedStyle` —— 视口只在起帧与 resize 时读一次，
 *     目标重扫挪到起帧路径（节流 `PARALLAX_TARGETS_MS`）与"跟踪的节点掉出文档"那种罕见路径上。
 *   · **页面不可见就不排帧**：`document.hidden` 时 `parallaxKick()` 直接返回，
 *     `visibilitychange` 回来再接上（后台标签页一帧、一次写入都没有）。
 *   · **开销**（这一层整个长在输入路径上，省下来的都是手感）：写入只落在**要动的那几层
 *     自己**身上；"到位"按**看得见的位移**判（屏上剩余量 < 0.25px，光标静下来 180ms 之后
 *     放宽到 1px）⇒ 一次手势的帧数大约减半；系数全 0 时一帧都不排；帧循环在跑的这段时间给
 *     那几层加一个类提成合成层（每帧只挪现成的纹理、不整屏重绘），到位收工立刻摘掉
 *     （本仓刻意不留常驻合成层）。视口尺寸只在 resize 时读。
 *   · **壁纸要补边**：位移最大为 `pct/100 × 视口宽`（横向）、`pct/100 × 视口高`（纵向）
 *     —— 光标贴在屏幕边上时 2 × pct/100 × 半屏 = pct/100 × 整屏，而 `.we-layer` 正好是
 *     视口大小 ⇒ 不补边就会在边上露出底色。所以壁纸层同时放大 `1 + pct/50`
 *     （见 src/styles.js 的视差段）。
 *   · **各层各自的百分比**：壁纸走 `parallaxBg`；吉祥物跟着壁纸（`parallaxMascot` 可关）；界面四组
 *     与插件组见 ④ / ⑤（滑杆域 0..10% / 分度 0.1%；缺值兜底见 PARALLAX_GROUP_*）。
 *   · **点击与拖尾效果（`src/fx-layer.js` 那一层）刻意不参与**（用户口径第 3 条）：那层画的是"屏上的笔迹"，
 *     跟着挪会让落点与光效错位。
 *   · **自检开关**：`localStorage.weParallaxDebug = '1'` ⇒ 记每帧的回调耗时、写入次数与帧间隔，
 *     一次手势收工（或停用）时打一行 p50 / p95 / max + 长帧（≥ 8ms）计数，再附一份**界面组清点**
 *     （会话 / 输入 / 侧栏 / 气泡各认到几个、有几个被 fixed 后代挡下），并挂在
 *     `window.__weParallaxStats` 上。默认关；读它本身是有成本的，所以最多每秒重读一次。
 *
 * 契约：
 *   需要的外界：`selection`（设置 store，只读）、`document.body`（写 1 个"壁纸补边系数"与一个
 *   开关属性）、还有**那几层元素自己**（`.we-layer` / `.we-rope`：写 `translate` 与
 *   临时的合成层提示）+ **接口那几个容器**（输入卡片 / 会话文本区 / 左栏 / 用户气泡行；槽出口
 *   没盒子 ⇒ 位移落回有盒子的那一层：只写位移属性，绝不加类、不加 `will-change`；左栏写的是
 *   `position: relative` + `left`/`top`，其余三组写 `translate`）。
 *   对外提供：`syncParallaxLayer()`（设置变了就调一次）、`disposeParallaxLayer()`（卸载清理）、
 *   `parallaxDiscoveredGroups()`（**只读**：当前认到的"别的插件前端元素组"的槽键，面板画行用）。
 *   设置项（`parallax*`，真源 lib/settings-schema.js）：总开关 / 背景距离 /
 *   吉祥物是否跟随 / 界面整块是否跟随 / 四个区域的距离 / 插件组的距离表 / 缓动平滑。
 *
 * 不变量：
 *   · **一个 DOM 节点都不建**：屏上那几层本来就存在，本层只写样式 —— 1 个"壁纸补边系数"写在
 *     `document.body` 上（只在设置变了时写一次），位移写在**要动的那几层自己**身上（每帧写，
 *     但作用域只有那几个元素），另加一个开关属性 `data-we-parallax`。于是**关掉时屏上一点痕迹
 *     都没有**（属性摘掉 ⇒ 补边那条规则不命中，位移也被 removeProperty 收干净）。
 *     ⚠️ 位移**不能**写成 `transform`：`.we-layer` 的过场（层切换）与 `.we-layer--repaint`
 *     会内联写 / 清 `transform`（见 src/live-layer.js 的 resetLayerSwitchStyles）—— 用 CSS 的
 *     **独立属性** `translate` / `scale` 才与它们叠加而不互相清掉。
 *   · **只读 `selection`**：一个字节都不写（裸写棘轮只留给 media-prep / effects / live-layer）；
 *     滑块即时反馈靠"每帧重读设置"，不靠写回。
 *   · **零顶层可执行语句**：顶层只有声明 —— 读 `selection` / 碰 `document` / 读 `localStorage`
 *     的语句一律在函数里（内联后 prelude 早于 `src/client.js` 正文求值，顶层读它必撞 TDZ）。
 *   · **不接管输入**：只读 document 上的 pointermove / visibilitychange 与 window 上的 resize
 *     （都 passive），一个事件都不拦；屏上也没有属于本层的元素。
 *   · **挂了才活、到位就停**：`parallaxEnabled` 关掉 ⇒ 立刻停 rAF、摘掉临时的合成层、位移与属性。
 *     帧循环是**收敛驱动**的：剩下位移在屏上已看不出来（阈值见上面"开销"条）就画完这帧收工
 *     （`parallaxRaf = 0`），下一次 pointermove 再用 `parallaxKick()` 起一帧 —— 光标不动时零帧、零 CPU。
 *   · **没有 rAF 的环境连 DOM 都不碰**（无头/测试沙箱）：装饰宁可不画，也不在没有帧时钟的地方留半截状态。
 *   · 事件与变量都走幂等的 `parallaxBind()` / `parallaxUnbind()`，重复 sync 不会叠监听。
 */

/** 1 = 跟随光标，-1 = 关于屏幕中心对称（用户口径："沿中心对称方向缓动"）。改这一个数就能换向。 */
const PARALLAX_DIRECTION = -1;
/** 百分比是"最长对角线的百分之几"：壁纸 0..10（它同时决定补边放大的倍数 1 + pct/50）、
 *  平滑 0..98（100% 等于永远不动）。 */
const PARALLAX_BG_MIN = 0;
const PARALLAX_BG_MAX = 10;
const PARALLAX_SMOOTH_MIN = 0;
const PARALLAX_SMOOTH_MAX = 98;
/** 用户口径 m02697-① 的那条折算：位移 = `PARALLAX_DIRECTION × u × pct / PARALLAX_STEP_DIV`
 *  （u = 光标 − 屏幕中心）⇒ 光标贴在屏幕角上时 |位移| = pct% × 最长对角线。
 *  除数是 100 / 2（少一个 ×2 就会让所有层位移翻倍），推导见文件头"单位量"。 */
const PARALLAX_STEP_DIV = 50;
/** 位移步长的最小"到位"距离（px / 每 1%）：兜底阈值，常态用的是下面按可见位移折算的那个。 */
const PARALLAX_SETTLE_PX = 0.02;
/** 缓动按 60fps 一帧折算；掉帧时最多按 64ms 补（再长就直接到位，别放大成一次跳跃）。
 *  ⚠️ 这只是**折算基准**，不是帧率上限：帧率跟随显示器真实刷新率（高刷屏上不再隔帧跑）。 */
const PARALLAX_FRAME_MS = 1000 / 60;
const PARALLAX_DT_MAX = 64;
/** "到位"看的是**屏上还剩多少位移**：位移 = 步长 × 系数 ⇒ 剩余位移 = 剩余步长 × 最大系数。
 *  0.25px 已经在感知之外；光标静下来 180ms 之后放宽到 1px —— 尾巴上那十几帧一次收掉
 *  （抹平那一刻的位移不足 1px，看不出来）。 */
const PARALLAX_SETTLE_VISIBLE_PX = 0.25;
const PARALLAX_IDLE_MS = 180;
const PARALLAX_IDLE_VISIBLE_PX = 1;
/** 要动的那几层（与 src/styles.js 视差段的规则一一对应）：壁纸层与吉祥物。 */
const PARALLAX_TARGET_SELECTOR = '.we-layer, .we-rope';
/** 跟着动的**界面整块**（开关 `parallaxUi`）—— 四组都是宿主真实锚点（见 docs/DSH-UI-INTERFACES.md
 *  与 test/verify-glass-surfaces.mjs 的玻璃面登记表）：`[data-composer-card]` 输入卡片、
 *  `[data-slot="conversation.view"]` 会话文本区、`[data-slot="sidebar"]` 左栏，以及聊天流里
 *  **用户消息那一行** `[data-chat-flow-kind="user"]`（`steering` 渲染的是同一个气泡组件）。
 *  ⚠️ 动的是**容器**：文字本体跟着走靠的就是"整块一起挪"（逐字加 transform 只会糊）。
 *  ⚠️ 气泡那一档只能按 `data-chat-*` 认：宿主的气泡类名是构建哈希（`cJsG2q_userRow` / `_bubble`），
 *  随版本变；这一排语义属性是宿主写在每个聊天流条目上的，稳。 */
const PARALLAX_GROUP_SELECTOR = '[data-composer-card], [data-slot="conversation.view"], [data-slot="sidebar"], [data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]';
/** 四个区域的**出厂 / 兜底距离**（% 对角线；用户裁决 m02697-①/③：总倍率 `parallaxUiDepth`
 *  退役、每块自己就是绝对距离、0 = 这一块完全不缓动）。真源是 lib/settings-schema.js 里那四个
 *  `parallaxUi*Depth` 键，这里的四个数只作缺值兜底、与出厂默认逐字同值（用户诉求 m04159 把它
 *  固化成用户实际调好的那一组：1.2 / 1.8 / 1.6 / 1.4；滑杆域仍是 0..10% / 分度 0.1%）。
 *  用户气泡那一档长在会话文本区的盒子里、两者都动 ⇒ 位移是**叠加**的（文件头 ④）。 */
const PARALLAX_GROUP_CHAT = 1.2;
const PARALLAX_GROUP_COMPOSER = 1.8;
const PARALLAX_GROUP_SIDEBAR = 1.6;
const PARALLAX_GROUP_BUBBLE = 1.4;
/** 区域距离的取值范围（与 lib/settings-schema.js 的 KINDS 同值：本文件要能被单独 import）。 */
const PARALLAX_GROUP_DEPTH_MIN = 0;
const PARALLAX_GROUP_DEPTH_MAX = 10;
/** 别的插件注册的前端元素组（用户裁决 m02697-②/③）。**槽出口自己没有盒子**（宿主给每个出口
 *  写死 `display: contents`，见 docs/DSH-UI-INTERFACES.md 与 parallaxGroupBox()）⇒ 位移落在
 *  出口的**元素子节点**上：那才是插件自己渲染出来、真有盒子的内容（一个出口可能有多个子节点，
 *  各有各的位移记录 —— DOM 上一个出口只有槽键、认不出占用它的插件，所以移动单位只能是节点）。
 *  **不参与的槽**（挪了没有意义或会与别的那一组打架）：
 *   · 整帧容器（`root` / `main` / `rightbar`）与 shell 各处 —— 挪它们等于整块界面动；
 *   · 原生四组（`[data-composer-card]` 输入卡片 / `conversation.view` 会话文本区 /
 *     `sidebar` 左栏 / `main.conversation`）—— 上面那条选择器在管；
 *   · 整个设置 / 插件管理界面（`settings.*` / `plugins.*`，连同落在它们子树里的一切）——
 *     那是一块你正在读的表单，跟着光标晃只会碍事（第三方在插件页里声明的座位也算在内）。 */
const PARALLAX_PLUGIN_SLOT_ATTR = 'data-slot';
const PARALLAX_PLUGIN_SELECTOR = '[data-slot]';
const PARALLAX_PLUGIN_SKIP = [
  'root', 'main', 'rightbar',
  'conversation.view', 'sidebar', 'main.conversation',
];
const PARALLAX_PLUGIN_SKIP_PREFIX = ['settings.', 'plugins.', 'shell.'];
const PARALLAX_PLUGIN_SKIP_SCOPE = '[data-slot="settings.section"], [data-slot="plugins.bundle.config"]';
/** 插件组的缺省距离（%，用户裁决 m02697-②："默认参与缓动，给一个和原生区域相近的默认距离"）
 *  —— 它自成一份（原生那四档已按用户诉求 m04159 固化成 1.2 / 1.8 / 1.6 / 1.4，这里仍是 1，
 *  量级上仍与原生区域相近），真源就是这个常量、别处不许再抄；取值范围同 PARALLAX_GROUP_DEPTH_*。
 *  只在 `parallaxPlugin` 开着时才会被读到（用户诉求 m03549：那个开关独立于 `parallaxUi`、默认关）。 */
const PARALLAX_PLUGIN_DEFAULT = 1;
/** 界面组量化的**迟滞带**（单位 = 设备像素）：位移小于 `DEAD` 一律归零；已经非零时小于
 *  `STICK` 不许重新起跳。缓动尾巴会在零点附近来回磨（指数逼近最后那一段永远到不了终点），
 *  没有这条带子就会两帧之间把 0 与 1 个设备像素翻来翻去 —— 用户口径 m01915-②："光标从屏幕
 *  一半移动至另一半区域时，中央文本区和底部输入框会抖动"。壁纸 / 吉祥物不走这条路
 *  （它们是图像层，本来就量化反而一顿一顿的）。 */
const PARALLAX_GROUP_DEAD_PX = 0.25;
const PARALLAX_GROUP_STICK_PX = 0.75;
/** 左栏走的那对偏移属性 + 它需要的定位前缀（相对定位**不是** fixed 后代的包含块，
 *  所以宿主的标题栏按钮不会被改锚；见文件头 ② 与 parallaxTargetOffset()）。 */
const PARALLAX_OFFSET_LEFT = 'left';
const PARALLAX_OFFSET_TOP = 'top';
const PARALLAX_POSITION = 'position';
const PARALLAX_POSITION_RELATIVE = 'relative';
/** 会话流可能很长（每条用户消息一个盒子）⇒ 只让**最近**这么多条气泡参与：几十上百条同时写
 *  `translate`，帧预算就全花在它们身上了，而屏外那几百条本来就没人看得见。 */
const PARALLAX_GROUP_BUBBLE_MAX = 24;
/** 界面组的符号：+1 = **与壁纸同向**（用户口径 m01371："希望输入框和背景同向运动，体现层次与
 *  纵深感" ⇒ 像镜头横移，近处的界面比远处的壁纸多走一点）；想让界面与壁纸反向（界面像贴在
 *  镜头上的窗框）就改成 -1。 */
const PARALLAX_UI_SIGN = 1;
/** 每个界面组最多扫这么多节点去找 `position: fixed` 后代：超过就认作"没验完"（照动）。
 *  一个几千节点的会话流上每 250ms 全量 getComputedStyle 是不行的。
 *  ⚠️ 左栏不走这道判定（它写的是相对偏移、不是 transform，见文件头 ②）—— 这一条正是
 *  m01915-③ 的来路：侧栏展开时子树超过这个上限 ⇒ 判定放行 ⇒ `translate` 落上那一列 ⇒
 *  宿主的 fixed 标题栏按钮被改锚、整块下移。 */
const PARALLAX_GROUP_SCAN_MAX = 400;
/** "这一组太大、不验了"这个结论的**有效期**（ms）：超限组在这段时间内**连枚举都不做**
 *  （见 parallaxGroupBig）。取 1s 的理由：重扫本身是 250ms 一次，过期后重验一次 ⇒ 一组最多
 *  每秒付一次 `querySelectorAll('*')`，而"子树从超限缩回可验范围、且里面有 fixed 后代"这种
 *  变化晚 ≤1s 被认到 —— 这个量级对着色延迟无关痛痒，却把"超限组每 250ms 白枚举一遍整棵子树"
 *  那笔账整个抹掉。 */
const PARALLAX_GROUP_SCAN_COOLDOWN_MS = 1000;
/** 从槽出口往上找"有盒子的祖先"最多走这么多层：`display: contents` 连着套是极端情况，兜底用。 */
const PARALLAX_GROUP_BOX_MAX_UP = 3;
/** 帧循环在跑的这段时间加在目标上的类（样式段只在开关属性下给它 will-change）—— 收工即摘。 */
const PARALLAX_MOVING_CLASS = 'we-parallax--moving';
/** 目标重扫间隔：壁纸层会换节点，所以起帧路径上定期重扫一次（**不在帧里**）。 */
const PARALLAX_TARGETS_MS = 250;
/** 光标在屏幕外 / 还没动过时的位移：读不到真实尺寸时的兜底中心，也是"零位移"的那一点。 */
const PARALLAX_BG_DEFAULT = 1;
const PARALLAX_SMOOTH_DEFAULT = 85;
/** 每帧写下去的那条 CSS 独立属性（不能用 transform：壁纸过场会内联写 / 清它）。 */
const PARALLAX_TRANSLATE = 'translate';
/** 只写一次的那个"壁纸补边系数"（与 src/styles.js 的 `scale: calc(1 + 变量 / 50)` 逐字对应）：
 *  它落 body，是因为补边放大整层只与总设置有关、与光标无关。 */
const PARALLAX_VAR_BG = '--we-parallax-bg';
/** body 上的总开关属性：只有它在时补边那条规则才命中（关掉 ⇒ 壁纸连 scale 都不带）。 */
const PARALLAX_ATTR = 'data-we-parallax';
/** 自检开关（localStorage 键）与"最多每秒重读一次"的节流；长帧阈值取 8ms（60Hz 一帧的预算）。 */
const PARALLAX_DEBUG_KEY = 'weParallaxDebug';
const PARALLAX_DEBUG_REREAD_MS = 1000;
const PARALLAX_LONG_FRAME_MS = 8;
/** 自检只留最近这些帧的样本（百分位是"开自检之后的前 600 帧"，够看一次手势了）。 */
const PARALLAX_DEBUG_SAMPLES = 600;

let parallaxOn = false;
let parallaxBound = false;
let parallaxRaf = 0;
let parallaxX = 0;
let parallaxY = 0;
let parallaxSeen = false;
/** 当前位移步长（px / 每 1% 的百分比）与上一帧的时间戳。 */
let parallaxStepX = 0;
let parallaxStepY = 0;
/** 重扫期量过大小的界面组：`el` → `{ n, at, big }`（`n` = 上次枚举到的节点数）。只有**超限**
 *  的那些会被当真缓存（见 parallaxGroupBig）—— 组元素来了又走，所以是 WeakMap 而不是 Map。 */
const parallaxGroupSizes = typeof WeakMap === 'function' ? new WeakMap() : null;
let parallaxLastMs = 0;
let parallaxRatioKey = '';
/** 视口尺寸（只在起帧、resize 与"冷路径补读"时读一次：帧里不再问 window，省掉每帧那次布局查询）。 */
let parallaxVw = 0;
let parallaxVh = 0;
/** 设备像素比（界面组的位移要量化到**整设备像素**上）：与视口一样只在帧外读。 */
let parallaxDpr = 0;
/** 最近一次 pointermove 的时刻（判"光标静下来了"）与要动的那几层的记录（见 parallaxTargetsRefresh）。 */
let parallaxMoveMs = 0;
let parallaxTargets = [];
let parallaxTargetsMs = 0;
/** 本帧在写入时发现"跟踪的节点已经不在文档里"（壁纸换节点）—— 记下来，下一帧重扫一次。 */
let parallaxStale = false;
/** 自检：开关状态、上次重读时刻、样本桶与上一次 rAF 时间戳（算帧间隔）。 */
let parallaxDebugOn = false;
let parallaxDebugCheckMs = 0;
let parallaxDebugStats = null;
let parallaxDebugLastMs = 0;

/* `weNow()` / `weClampTo()` 的唯一实现见 src/we-base.js（内联后同作用域）。 */

/**
 * 设置快照（每帧现读 ⇒ 拖滑块不需要 emit 就能看到反馈）。
 * 数值范围是**常量**、与本文件外的白名单同值（改范围要同时看 lib/settings-schema.js ——
 * 那份是唯一真源）：本文件要能被单独 import（test/verify-scene-live.mjs 就是这么测的），
 * 引那份 schema 会在单文件环境里 ReferenceError。
 */
function parallaxSettings() {
  return {
    on: selection.parallaxEnabled === true,
    bg: weClampTo(selection.parallaxBg, PARALLAX_BG_MIN, PARALLAX_BG_MAX, PARALLAX_BG_DEFAULT),
    mascot: selection.parallaxMascot !== false,
    ui: selection.parallaxUi === true,
    /** 插件前端那一整块自己的开关（用户诉求 m03549；独立于 ui、默认关 ⇒ `=== true` 才算开）。 */
    pluginOn: selection.parallaxPlugin === true,
    /** 插件组的距离表（槽键 → %）：浅拷贝由 schema 负责，这里只做"不是对象就当空表"的兜底。
     *  表只在 pluginOn 为真时被读（见 parallaxMaxPercent 与 parallaxTargetRatio）。 */
    plugin: (selection.parallaxPluginDepths && typeof selection.parallaxPluginDepths === 'object')
      ? selection.parallaxPluginDepths : {},
    chatDepth: weClampTo(selection.parallaxUiChatDepth, PARALLAX_GROUP_DEPTH_MIN,
      PARALLAX_GROUP_DEPTH_MAX, PARALLAX_GROUP_CHAT),
    composerDepth: weClampTo(selection.parallaxUiComposerDepth, PARALLAX_GROUP_DEPTH_MIN,
      PARALLAX_GROUP_DEPTH_MAX, PARALLAX_GROUP_COMPOSER),
    sidebarDepth: weClampTo(selection.parallaxUiSidebarDepth, PARALLAX_GROUP_DEPTH_MIN,
      PARALLAX_GROUP_DEPTH_MAX, PARALLAX_GROUP_SIDEBAR),
    bubbleDepth: weClampTo(selection.parallaxUiBubbleDepth, PARALLAX_GROUP_DEPTH_MIN,
      PARALLAX_GROUP_DEPTH_MAX, PARALLAX_GROUP_BUBBLE),
    smooth: weClampTo(selection.parallaxSmooth, PARALLAX_SMOOTH_MIN, PARALLAX_SMOOTH_MAX,
      PARALLAX_SMOOTH_DEFAULT),
  };
}

/**
 * 插件槽的**距离取值器**（唯一真源）：`parallaxPluginDepths[slot]` 经钳制后的数字。
 * 缺键、非数字、`NaN` / `Infinity`、超范围 —— **一律**回同一个结果（钳到 `0..10` 里）。
 * 为什么要一个共用取值器：算"屏上最大距离"的 `parallaxMaxPercent` 与算系数的
 * `parallaxTargetRatio` 各写了一套兜底，而两套的**非有限值**分支不一样（一个回 0、一个回
 * `PARALLAX_PLUGIN_DEFAULT`）⇒ 存档里手写一个 `null` / `"abc"` 就能让"最大距离算 0"而"系数算 1"，
 * 于是 `pctMax === 0` 触发"一次落位、收工"那条短路，整组缓动静默失效（屏上表现为瞬移）。
 * 表里只认**自己的键**：存档里那个 `__proto__` 经 schema 的 `Object.assign({}, v)` 会变成结果的
 * **原型**（属性名不进 `data-slot`，值是对象）⇒ 取值一律走 `hasOwnProperty`，绝不直接读
 * `st.plugin[slot]`（否则原型链上的东西会被当成设置）。表里没写过的槽键 = "缺键" ⇒ 走缺省。
 */
function parallaxPluginDepth(st, slot) {
  const map = st && st.plugin;
  if (!map) return PARALLAX_PLUGIN_DEFAULT;
  const own = Object.prototype.hasOwnProperty.call(map, slot) ? map[slot] : undefined;
  // 一行写完，别换行：`test/verify-scene-live.mjs` 的结构判据按**整行子串**钉这条取值器
  //（两行会让 `includes` 落空）。
  return weClampTo(own, PARALLAX_GROUP_DEPTH_MIN, PARALLAX_GROUP_DEPTH_MAX, PARALLAX_PLUGIN_DEFAULT);
}

/** 屏上可能出现的**最大距离百分比**（壁纸、四个区域、插件组里最大的那个）。只在两处用到：
 *  ① "系数全 0 ⇒ 一次落位、收工"这条短路；② 到位阈值（剩余位移 = 剩余步长 × 最大系数）。
 *  ⚠️ 不能只看壁纸：用户口径 m02697 之后每块的距离都是**独立的绝对百分比**，界面组或插件组
 *  完全可能比壁纸走得远（只看壁纸会让那几组的尾巴被过早抹平）。界面整块关着时只有壁纸算数；
 *  插件组那一张表只在它自己的开关开着时算（用户诉求 m03549：关着 = 一个插件组都不认）。 */
function parallaxMaxPercent(st) {
  let max = st.bg;
  if (st.ui) {
    if (st.chatDepth > max) max = st.chatDepth;
    if (st.composerDepth > max) max = st.composerDepth;
    if (st.sidebarDepth > max) max = st.sidebarDepth;
    if (st.bubbleDepth > max) max = st.bubbleDepth;
  }
  if (!st.pluginOn) return max;
  // 槽**没存过值**时插件组按缺省 `PARALLAX_PLUGIN_DEFAULT` 走（parallaxTargetRatio 的兜底）
  // ⇒ 这里必须把缺省也算进来：只遍历已存的键会让"槽还没调过 + 原生那几档正好都是 0"这一格
  // 算出 `pctMax = 0`，帧于是走"一次落位、收工"的短路（见 parallaxFrame）—— 插件组每帧直接贴到
  // 目标，面板上那个「缓动平滑」静默失效。代价很小：插件开关开着时那条短路不再触发，
  // 顶多多排几帧空帧（真的一个都不动时，写与属性摘挂照旧在头两帧里做完）。
  if (PARALLAX_PLUGIN_DEFAULT > max) max = PARALLAX_PLUGIN_DEFAULT;
  const map = st.plugin;
  for (const key in map) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
    // 与 parallaxTargetRatio 走**同一个**取值器（两处各写一套兜底时非有限值会算出
    // 不同结果 ⇒ 手改存档能让"最大距离"与真实系数打架，`pctMax === 0` 把缓动短路掉）。
    const v = parallaxPluginDepth(st, key);
    if (v > max) max = v;
  }
  return max;
}

/* `weBody()`（写样式 / 属性的落点）的唯一实现见 src/we-base.js；没有 DOM 的环境一律 null。 */

/** 写一条**元素级**的样式（只在真的变了的时候写，比的是自己攒的快照，不读回 DOM）。
 *  两个能力都先探再调：挂载台（`test/verify-client.mjs`）的 style 只实现了 setProperty。 */
function parallaxVarOn(el, prop, value) {
  const style = el && el.style;
  if (!style || typeof style.setProperty !== 'function') return;
  if (typeof style.getPropertyValue === 'function' && style.getPropertyValue(prop) === value) return;
  style.setProperty(prop, value);
}

/** 视口尺寸：帧里要用（中心 = 视口 / 2），但只在起帧、resize 与冷路径补读时读一次 ——
 *  每帧问 window 是白花的，而且"读窗口尺寸"和样式写入交错还有把布局刷出来的风险。 */
function parallaxReadViewport() {
  const win = typeof window === 'undefined' ? null : window;
  const w = win ? Math.round(Number(win.innerWidth)) : 0;
  const h = win ? Math.round(Number(win.innerHeight)) : 0;
  parallaxVw = isFinite(w) && w > 0 ? w : 0;
  parallaxVh = isFinite(h) && h > 0 ? h : 0;
  const dpr = win ? Number(win.devicePixelRatio) : 0;
  parallaxDpr = isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** 页面是否不可见（后台标签页 / 最小化）：不可见时一帧都不排 —— 那点位移没人看，
 *  而 rAF、合成层与样式写入本身都是有成本的。取不到就当作可见。 */
function parallaxHidden() {
  if (typeof document === 'undefined' || !document) return false;
  return document.hidden === true || document.visibilityState === 'hidden';
}

/** 提合成层的提示（只提示 translate：scale 是静态的，不掺和栅格化倍率）。已经在身上时
 *  add 是空操作；壁纸层的过场会把类整条抹掉（`resetLayerSwitchStyles` 重置 className），
 *  所以帧里每次写位移都补一次。 */
function parallaxTargetLift(el, on) {
  const list = el && el.classList;
  if (!list) return;
  if (on) {
    if (typeof list.add === 'function') list.add(PARALLAX_MOVING_CLASS);
    return;
  }
  if (typeof list.remove === 'function') list.remove(PARALLAX_MOVING_CLASS);
}

/** 这一层是壁纸（走 `parallaxBg`）还是吉祥物（走 `parallaxMascot`）：按类名认，
 *  认不出来就按壁纸算（位移最小、最不惹眼的那一档）。 */
function parallaxTargetKind(el) {
  const list = el && el.classList;
  if (list && typeof list.contains === 'function') {
    if (list.contains('we-layer')) return 'bg';
    if (list.contains('we-rope')) return 'mascot';
  }
  const cls = ' ' + String((el && el.className) || '') + ' ';
  if (cls.indexOf(' we-layer ') >= 0) return 'bg';
  if (cls.indexOf(' we-rope ') >= 0) return 'mascot';
  return 'bg';
}

/** 界面组的种类：按宿主锚点认（`parallaxTargetsRefresh` 只把组查询命中的节点交进来）。
 *  `data-chat-flow-kind` → `data-slot` → `data-composer-card` 依次认 —— 都是宿主写的**语义**属性，
 *  比构建哈希类名稳；认不出来按基准档（会话文本区）算。
 *  ⚠️ composer 只认 `data-composer-card` **属性**（`hasAttribute`）：属性名不会长在类名里，
 *  靠 `className` 找它的分支**永远不成立**（真实 composer 卡片的类名是构建哈希、
 *  语义只在属性上 ⇒ 类名那条路本就认不出宿主）。 */
function parallaxGroupKind(el) {
  if (!el) return 'chat';
  let flow = null;
  let slot = null;
  if (typeof el.getAttribute === 'function') {
    try { flow = el.getAttribute('data-chat-flow-kind'); } catch (e) { flow = null; }
    try { slot = el.getAttribute('data-slot'); } catch (e) { slot = null; }
  }
  if (flow === 'user' || flow === 'steering') return 'bubble';
  if (slot === 'sidebar') return 'sidebar';
  if (slot === 'conversation.view') return 'chat';
  if (typeof el.hasAttribute === 'function') {
    try { if (el.hasAttribute('data-composer-card')) return 'composer'; } catch (e) { /* 只读宿主 */ }
  }
  return 'chat';
}

/** 这个槽出口算不算"别的插件注册的前端元素组"：是就返回它的槽键，否则返回空串（判据见
 *  PARALLAX_PLUGIN_SKIP / _SKIP_PREFIX / _SKIP_SCOPE 的注释）。只读宿主写的 `data-slot`。 */
function parallaxPluginKey(el) {
  if (!el || typeof el.getAttribute !== 'function') return '';
  let key;
  try { key = el.getAttribute(PARALLAX_PLUGIN_SLOT_ATTR) || ''; } catch (e) { return ''; }
  key = String(key);
  if (!key || PARALLAX_PLUGIN_SKIP.indexOf(key) >= 0) return '';
  for (let i = 0; i < PARALLAX_PLUGIN_SKIP_PREFIX.length; i += 1) {
    if (key.indexOf(PARALLAX_PLUGIN_SKIP_PREFIX[i]) === 0) return '';
  }
  // 落在设置页 / 插件管理页那块子树里的一律不算（第三方在那里声明的座位也算）——
  // `closest` 取不到（老宿主 / 假 DOM）时按"不在里面"算，宁可多认一个组也别漏。
  if (typeof el.closest === 'function') {
    try { if (el.closest(PARALLAX_PLUGIN_SKIP_SCOPE)) return ''; } catch (e) { /* 只读宿主 */ }
  }
  return key;
}

/** 当前该跟着动的"别的插件前端元素组"：`[{ el, slot }]`（`el` = 出口的**元素子节点** ——
 *  出口自己 `display: contents`、没有盒子，见常量注释）。只在**重扫路径**上跑（帧里绝不查 DOM）。
 *  没有 DOM、或出口一个元素子节点都没有的环境一律返回空数组 ⇒ 老环境零影响。 */
function parallaxPluginGroups() {
  const out = [];
  if (typeof document === 'undefined' || !document
    || typeof document.querySelectorAll !== 'function') return out;
  let nodes;
  try { nodes = document.querySelectorAll(PARALLAX_PLUGIN_SELECTOR); } catch (e) { return out; }
  for (let i = 0; i < nodes.length; i += 1) {
    const slot = parallaxPluginKey(nodes[i]);
    if (!slot) continue;
    const kids = nodes[i].children;
    if (!kids || typeof kids.length !== 'number') continue;
    for (let j = 0; j < kids.length; j += 1) {
      if (!kids[j]) continue;
      out.push({ el: kids[j], slot: slot });
    }
  }
  return out;
}

/** 屏上**会自己动**的那几个插件前端元素组：`[{ el, slot }]`（`el` 已经是位移落点那个盒子）。
 *  与 parallaxTargetsRefresh 用同一套挑选，只是提前把"被外层组吃掉"的剔掉 ⇒ 「扩展」页签
 *  列出来的每一行都有落点（唯一的例外见 parallaxDiscoveredGroups 的注释）。两道剔除：
 *    ① 落在**原生四组**（会话文本区 / 输入卡片 / 侧栏 / 用户气泡）盒子里的 —— 外层一动它就跟着
 *       走，它自己的距离没有落点（重扫那一步的"组里套组只留最外侧"）。⚠️ 只在「界面元素跟随」
 *       **开着**时才这么算：关着时那四组的系数恒为 0（parallaxTargetRatio 里 `if (!st.ui) return 0`）、
 *       **压根不是候选**（见 parallaxTargetsRefresh ①），拿它们去挡插件组会让"只开插件前端"变成
 *       一个拖了不动的空开关（用户诉求 m03549 的"独立"落不到实处）。
 *    ② 落在**另一个**认到的插件组里的 —— 同上。
 *  纯读 DOM、零副作用；没有 DOM 的环境返回空数组（面板那边退回一句说明）。 */
function parallaxPluginEffectiveGroups() {
  const groups = parallaxPluginGroups();
  const out = [];
  if (!groups.length) return out;
  const st = parallaxSettings();
  const outers = [];
  if (st.ui && typeof document !== 'undefined' && document
    && typeof document.querySelectorAll === 'function') {
    let nodes;
    try { nodes = document.querySelectorAll(PARALLAX_GROUP_SELECTOR); } catch (e) { nodes = null; }
    for (let i = 0; nodes && i < nodes.length; i += 1) outers.push(nodes[i]);
  }
  for (let i = 0; i < groups.length; i += 1) {
    const el = groups[i].el;
    let nested = false;
    for (let j = 0; j < outers.length && !nested; j += 1) {
      const outer = outers[j];
      if (outer && outer !== el && typeof outer.contains === 'function'
        && outer.contains(el)) nested = true;
    }
    for (let j = 0; j < groups.length && !nested; j += 1) {
      if (j === i) continue;
      const outer = groups[j].el;
      if (outer && outer !== el && typeof outer.contains === 'function'
        && outer.contains(el)) nested = true;
    }
    if (nested) continue;
    out.push({ el: parallaxGroupBox(el) || el, slot: groups[i].slot });
  }
  // 落点去重（**不变量**：面板列出来的每一行都有落点，且一行只对应一个落点）。一个出口有多个
  // 元素子节点、或两个不同槽键的子节点最终落到**同一个盒子**时，`parallaxTargetAdd()` 只留先
  // 入列的那一条（它按 `el` 去重）⇒ 后一条的距离其实无处可写。这里按落点先剔掉，让**面板名单
  // 与屏上同源**这条不变量继续成立（否则「扩展」页签会多出一行永不生效的槽键）。
  const boxes = [];
  const kept = [];
  for (let i = 0; i < out.length; i += 1) {
    const box = out[i].el;
    if (!box || boxes.indexOf(box) >= 0) continue;
    boxes.push(box);
    kept.push(out[i]);
  }
  return kept;
}

/** 对外（「扩展」页签那一段画行用）：**自动发现**到的插件前端元素组的槽键，屏上顺序、去重。
 *  与屏上表现同源（同一个挑选）⇒ "会动的组一定有开关，有开关的组一定在动"。唯一的例外是
 *  **组里有 `position: fixed` 后代**那一条（`parallaxGroupBlocked`：那种组层的写法是整组不动，
 *  因为 `translate` 会让它变成那些后代的包含块）—— 那要遍历子树、只在帧外做，面板这边不筛，
 *  改成把这条写进每一行的 tooltip（`src/ext-parallax.js` 的插件槽位那一行）。
 *  纯读 DOM、零副作用；没有 DOM 的环境返回空数组（面板那边退回一句说明）。 */
function parallaxDiscoveredGroups() {
  const groups = parallaxPluginEffectiveGroups();
  const out = [];
  for (let i = 0; i < groups.length; i += 1) {
    if (out.indexOf(groups[i].slot) < 0) out.push(groups[i].slot);
  }
  return out;
}

/**
 * 界面上**真正要挪的那个盒子**（位移落点）。
 * 为什么不能直接写在命中的锚点上：宿主给每个槽出口写死 `display: contents`
 * （asar 里的 `ANCHOR_STYLE`，见 docs/DSH-UI-INTERFACES.md）—— 出口自己不生成盒子，
 * `translate` 写在它身上屏上一点都不会动。用户看到"只有输入框在动"就是这个缘故：输入卡片是
 * 有盒子的真元素，侧栏与会话文本区都只是出口。
 * ⇒ **从锚点自身起判**，一路 `display: contents` 才往上找第一个有自己盒子的元素
 * （会话文本区 = `.viewArea`，左栏 = 那一列的盒子；输入卡片与每条用户气泡行本来就有盒子
 * ⇒ 原样返回 —— 于是气泡各有各的位移，见文件头 ③）。
 * 兜底：① 取不到 `getComputedStyle`（无头 / 测试挂载台）或一路 contents 走到头 ⇒ 退回父元素；
 * ② 盒子的父元素是 body / documentElement ⇒ 返回 null（挪它们等于整页动，宁可不动）。
 * 只在**重扫路径**上跑（帧里绝不碰 getComputedStyle）。
 */
function parallaxGroupBox(el) {
  if (!el) return null;
  const body = weBody();
  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (typeof getComputedStyle !== 'function') return el.parentElement || null;
  let node = el;
  for (let up = 0; up < PARALLAX_GROUP_BOX_MAX_UP && node; up += 1) {
    if (node === body || node === root) break;
    let cs;
    try { cs = getComputedStyle(node); } catch (e) { cs = null; }
    if (!cs || cs.display !== 'contents') return node;
    node = node.parentElement || null;
  }
  const parent = el.parentElement || null;
  if (!parent || parent === body || parent === root) return null;
  return parent;
}

/** 界面组的位移要落在**整设备像素**上：文字底下就是像素网格，落在半个像素上会被重采样成糊的。
 *  壁纸 / 吉祥物是图像层、刻意不做这件事（量化反而会让它看着一顿一顿的）。
 *  带**迟滞**（用户口径 m01915-②）：`prev` 是这条记录上一帧写下的设备像素整数，返回值是这一帧
 *  该写的整数设备像素 —— 已经非零时只要还剩 `PARALLAX_GROUP_DEAD_PX` 就继续留着，已经归零时
 *  要超过 `PARALLAX_GROUP_STICK_PX` 才重新起跳。缓动尾巴在零点附近磨的那几帧因此不再来回翻转
 *  （不带上限的量化会在 0 与 1 个设备像素之间反复摘挂属性 = 屏上一下一下地跳）。 */
function parallaxSnapAxis(v, prev) {
  const dpr = parallaxDpr > 0 ? parallaxDpr : 1;
  const raw = (isFinite(v) ? v : 0) * dpr;
  const mag = Math.abs(raw);
  const sign = raw < 0 ? -1 : 1;
  // 过零那一帧先归零：`prev` 是上一条写给同一个轴的**带符号**整数（`rec.dx` / `rec.dy`，见调用点），
  // 不认符号的话 "+1 → 这一帧只该走 0.3px" 会被当成"已经非零"直接翻成 **-1** —— 光标扫过屏幕
  // 中线时那一下就是 2 个设备像素的台阶（用户口径 m01915-② 要的正是过中线不跳）。跨零的那一帧
  // 写 0 ⇒ 下一帧从零起跳，走的是下面 `!prev` 那一档（要先超过 STICK 才起跳，零点附近更安静）。
  if (prev && (prev > 0) !== (raw > 0)) return 0;
  let next = Math.round(mag);
  if (!prev) {
    if (mag < PARALLAX_GROUP_STICK_PX) next = 0;
  } else if (next === 0 && mag >= PARALLAX_GROUP_DEAD_PX) {
    next = 1;
  }
  return sign * next;
}

/** 左栏那一列要不要本层替它补一个 `position: relative`：计算值本来就是定位元素（插件自己的液态
 *  玻璃那一段已经给这一列写过 `position: relative`）时什么都不用补；是 `static` 时相对偏移不
 *  生效，得补一个。**只在重扫路径上读**（帧里绝不碰 getComputedStyle）；读不到就当作要补。 */
function parallaxGroupNeedsRelative(el) {
  if (!el || typeof getComputedStyle !== 'function') return true;
  let cs;
  try { cs = getComputedStyle(el); } catch (e) { cs = null; }
  if (!cs) return true;
  return cs.position === 'static' || !cs.position;
}

/** 左栏的位移落点（其余三组走 `translate`）：需要时补 `position: relative` + `left`/`top` ——
 *  相对定位**不建立** fixed 后代的包含块，所以宿主钉在标题栏上的按钮不会被改锚（文件头 ②）。
 *  属性不摘：`position` 在"动 ↔ 不动"之间反复摘挂等于把列里绝对定位后代的锚点来回换，
 *  而它本身在屏上没有任何痕迹（值与插件玻璃那一段写下的逐字相同）。 */
function parallaxTargetOffset(rec, x, y) {
  const el = rec && rec.el;
  const style = el && el.style;
  if (!style || typeof style.setProperty !== 'function') return;
  if (rec.rel === true) parallaxVarOn(el, PARALLAX_POSITION, PARALLAX_POSITION_RELATIVE);
  parallaxVarOn(el, PARALLAX_OFFSET_LEFT, x + 'px');
  parallaxVarOn(el, PARALLAX_OFFSET_TOP, y + 'px');
}

/**
 * 这个界面组的子树**此刻有哪些节点**（`el.querySelectorAll('*')`，问不到返回 `null`）。
 * 顺带把"太大"这个结论按 `PARALLAX_GROUP_SCAN_COOLDOWN_MS` 缓存住。
 * 为什么值得缓存：不缓存就得每次重扫（250ms 一轮）都为一句"没验完"白枚举整棵子树 ⇒ 超限组
 * 每轮白付一次全量 `querySelectorAll('*')`；会话流动辄几千节点，这比它想省掉的
 * `getComputedStyle` 那一段还贵。
 * 缓存口径（`big` 只在**这次真的数出来**才更新）：
 *   · `big === true`（上次数出来就超限）且还没过期 ⇒ 不再枚举，返回 `null`（调用方一律按"没验完"
 *     算 ⇒ 照动）；
 *   · 其余一律现数，并把这次的结果记进 `big` —— 于是"子树缩回可验范围"后第一次调用就会重验，
 *     不会因为上一次的结论一直放行（过期只是给"组的情况不再变化"兜底）。
 * ⚠️ 只在重扫路径（帧外）调用，与 parallaxGroupBlocked 同一批调用方。
 */
function parallaxGroupNodes(el) {
  if (!el || typeof el.querySelectorAll !== 'function') return null;
  const now = weNow();
  const slot = parallaxGroupSizes ? parallaxGroupSizes.get(el) : null;
  if (slot && slot.big === true && now - slot.at < PARALLAX_GROUP_SCAN_COOLDOWN_MS) return null;
  let nodes;
  try { nodes = el.querySelectorAll('*'); } catch (e) { return null; }
  if (!nodes) return null;
  const n = nodes.length;
  if (parallaxGroupSizes) {
    try { parallaxGroupSizes.set(el, { n: n, at: now, big: n > PARALLAX_GROUP_SCAN_MAX }); }
    catch (e) { /* 只读宿主 / 不是对象键 */ }
  }
  return nodes;
}

/**
 * 这个界面组里有没有 `position: fixed` 的后代 —— 有就**整组不动**。
 * 为什么：`translate` 只要不是 none，这个元素就成了 fixed 后代的**包含块**，那些后代会从
 * "钉在视口上"变成"钉在这个盒子上"（本仓 #89：第三方插件把座位挂在输入卡片里，包含块一换
 * 就跑到卡片角上、还多出幽灵溢出）。
 * 只在**重扫路径**上跑（帧里绝不碰），而且**只枚举一次子树**：节点数超过
 * PARALLAX_GROUP_SCAN_MAX（= 400）就认作"没验完"（照动）—— 会话流动辄几千节点，每 250ms 全量
 * getComputedStyle 是不行的。
 * ⚠️ 超限那一步自己也有成本：枚举整棵子树不比 `getComputedStyle` 便宜多少 ⇒ 枚举走
 * parallaxGroupNodes 的缓存（超限的组合在 1s 内**连数都不数**）；要验的那些组直接
 * 拿它数出来的那张表来遍历，不再为 `length` 白枚举第二遍。
 * ⚠️ 超限放行的代价不只是"白跑"：这一组里若嵌着 `position: fixed` 后代，也会跟着**照旧被改锚**
 * （也就是下面那个 return true 根本没机会跑到）。可接受的理由：会话文本区一棵子树本来就常超 400，
 * 而"输入卡片 / 侧栏"这类真会带固定定位后代的盒子都很小 ⇒ 实际触发面窄。
 * ⚠️ 左栏不由这条判定管：它写的是相对偏移、不是 transform，本来就不建立包含块
 * （调用方 parallaxTargetAdd 对 `sidebar` 直接按"没被挡下"算）。
 * 取不到 `getComputedStyle`（无头 / 测试挂载台）时按"没有"算。
 */
function parallaxGroupBlocked(el) {
  if (!el || typeof el.querySelectorAll !== 'function') return false;
  if (typeof getComputedStyle !== 'function') return false;
  const nodes = parallaxGroupNodes(el);
  if (!nodes || nodes.length > PARALLAX_GROUP_SCAN_MAX) return false;
  for (let i = 0; i < nodes.length; i += 1) {
    let cs;
    try { cs = getComputedStyle(nodes[i]); } catch (e) { cs = null; }
    if (cs && cs.position === 'fixed') return true;
  }
  return false;
}

/** 各层这一帧的系数（**带符号**）：壁纸恒为 `parallaxBg`；吉祥物跟随（`parallaxMascot` 关掉时为 0）；
 *  界面四组各按**自己的距离**（四个设置项，缺值兜底见 PARALLAX_GROUP_*）、插件组按槽键查表
 *  （缺键 = `PARALLAX_PLUGIN_DEFAULT`；只在 `parallaxPlugin` 开着时才查），符号都取与壁纸**同向**。 */
function parallaxTargetRatio(rec, st) {
  if (rec.group) {
    // 别的插件的组：走**自己那一块的开关**（用户诉求 m03549），与界面整块互不依赖。
    if (rec.kind === 'plugin') {
      if (!st.pluginOn) return 0;
      // 距离按**槽键**从 parallaxPluginDepths 里取（缺键 = PARALLAX_PLUGIN_DEFAULT）—— 取值口径
      // 与"最大距离"共用 parallaxPluginDepth()：表里只认自己的键（`__proto__` 那件事见那里），
      // 非有限值 / 超范围与缺键一律同一个结果。
      return parallaxPluginDepth(st, rec.slot) * PARALLAX_UI_SIGN;
    }
    if (!st.ui) return 0;
    let coef = st.chatDepth;
    if (rec.kind === 'composer') coef = st.composerDepth;
    else if (rec.kind === 'sidebar') coef = st.sidebarDepth;
    else if (rec.kind === 'bubble') coef = st.bubbleDepth;
    return coef * PARALLAX_UI_SIGN;
  }
  if (rec.kind === 'mascot') return st.mascot ? st.bg : 0;
  return st.bg;
}

/** 从一个目标身上收掉本层留下的一切（合成层提示 + 位移 / 偏移 / 本层补的定位前缀）。 */
function parallaxTargetClear(rec) {
  const el = rec && rec.el;
  if (!el) return;
  parallaxTargetLift(el, false);
  const style = el.style;
  if (!style || typeof style.removeProperty !== 'function') { rec.key = ''; return; }
  try { style.removeProperty(PARALLAX_TRANSLATE); } catch (e) { /* 已卸载 */ }
  if (parallaxTargetIsOffset(rec)) {
    try {
      style.removeProperty(PARALLAX_OFFSET_LEFT);
      style.removeProperty(PARALLAX_OFFSET_TOP);
      // 本层补的定位前缀只在这里摘：记录都没了，把列还原成 static 才算真的收干净。
      if (rec.rel === true) style.removeProperty(PARALLAX_POSITION);
    } catch (e) { /* 已卸载 */ }
  }
  rec.key = '';
  rec.dx = 0;
  rec.dy = 0;
}

/** 这一档界面组是不是走"相对偏移"那条腿（只有左栏）：它不建立 fixed 后代的包含块，
 *  所以"组里有 fixed 后代就整组不动"那条判定对它不适用 —— 真按那条判，展开的侧栏子树
 *  超过扫描上限就会被放行，位移落上那一列，宿主的标题栏按钮整体下移（m01915-③）。 */
function parallaxGroupOffsets(kind) {
  return kind === 'sidebar';
}

/** 这条记录是不是走"相对偏移"那条腿（左栏）：只有它不写 `translate`。 */
function parallaxTargetIsOffset(rec) {
  return !!(rec && rec.group === true && parallaxGroupOffsets(rec.kind));
}

/** 把位移从元素上收掉（界面组归零时走这条）。界面组静止时**一点 `translate` 都不能留**：
 *  属性在、值哪怕是 `0px 0px`，包含块也照样成立（见文件头 ②）。
 *  左栏那条腿收的是 `left`/`top`（`position` 留着，摘了等于把那列里绝对定位后代的锚点换回去）。
 *  `key` 为空表示这个元素身上本来就没有本层写的位移 ⇒ 一次样式写入都不做（光标停住之后这里
 *  彻底安静）。 */
function parallaxTargetUnset(rec) {
  if (!rec || !rec.key) return;
  rec.key = '';
  rec.dx = 0;
  rec.dy = 0;
  const style = rec.el && rec.el.style;
  if (!style || typeof style.removeProperty !== 'function') return;
  try {
    if (parallaxTargetIsOffset(rec)) {
      style.removeProperty(PARALLAX_OFFSET_LEFT);
      style.removeProperty(PARALLAX_OFFSET_TOP);
      return;
    }
    style.removeProperty(PARALLAX_TRANSLATE);
  } catch (e) { /* 已卸载 */ }
}

function parallaxTargetsClear() {
  for (let i = 0; i < parallaxTargets.length; i += 1) parallaxTargetClear(parallaxTargets[i]);
  parallaxTargets = [];
  parallaxTargetsMs = 0;
  parallaxStale = false;
}

/**
 * 把一个命中的节点并进下一批记录：**复用旧记录**（保住 `key`：值没变就不用重写样式），
 * 新来的按类型建一条。同一个元素只留一条 —— 壁纸 / 吉祥物先入列，所以它优先。
 * 界面组的种类由调用方传进来（`kind`）：命中的是**槽出口**，而位移要落的**盒子**是
 * `parallaxGroupBox()` 找到的那一层，属性都在出口身上 —— 到这儿就认不出来了。
 * 界面组的"有没有 fixed 后代"这一项**只在帧外算**；帧里新冒出来的组先认作 blocked
 * （宁可不跟手，也别让一个还没验过的组去当别人的包含块），下一次帧外重扫再放行。
 * 左栏（`sidebar`）走相对偏移、不是 transform ⇒ 那道判定对它一律按"没被挡下"算，
 * 改成问"要不要补一个 `position: relative`"（见 parallaxGroupOffsets / 文件头 ②）。
 * 插件组额外带 `slot`（槽键）：只用来查 `parallaxPluginDepths` 那张距离表（见 parallaxTargetRatio）。
 */
function parallaxTargetAdd(next, prev, el, group, inFrame, kind, slot) {
  for (let k = 0; k < next.length; k += 1) { if (next[k].el === el) return; }
  let rec = null;
  for (let j = 0; j < prev.length; j += 1) {
    if (prev[j].el === el && prev[j].group === group) { rec = prev[j]; break; }
  }
  if (rec) {
    rec.kept = true;
    if (slot) rec.slot = String(slot);
    // 判定会随时间变（第三方座位挂上来 / 撤走、宿主换容器实现）⇒ 每次帧外重扫都重验一遍。
    if (group && !inFrame) {
      if (parallaxGroupOffsets(rec.kind)) {
        rec.blocked = false;
        rec.rel = parallaxGroupNeedsRelative(el);
      } else {
        rec.blocked = parallaxGroupBlocked(el);
      }
    }
    next.push(rec);
    return;
  }
  const isGroup = group === true;
  const recKind = group ? kind : parallaxTargetKind(el);
  const offsets = isGroup && parallaxGroupOffsets(recKind);
  next.push({
    el: el,
    key: '',
    dx: 0,
    dy: 0,
    group: isGroup,
    kind: recKind,
    /** 只有插件组用得上（`parallaxPluginDepths` 的键）；其余一律空串。 */
    slot: slot ? String(slot) : '',
    rel: offsets && !inFrame ? parallaxGroupNeedsRelative(el) : offsets,
    blocked: isGroup && !offsets ? (inFrame ? true : parallaxGroupBlocked(el)) : false,
  });
}

/**
 * 重扫那几层（**不在帧里**：起帧路径每隔 PARALLAX_TARGETS_MS 一次，外加"帧里发现有节点掉出
 * 文档"那种罕见路径）。走掉的**当场**把类与位移收干净，新来的补进记录并让下一帧整批重写一遍
 * （新元素身上还没有位移）。
 * 界面组走**第二条选择器**，并且就地做四件挑选：① 组里套组只留最外侧那个（位移不做嵌套叠加
 * —— 外层一动，里层的文字本来就会跟着走），**气泡除外**：气泡行长在会话文本区的盒子里，
 * 那两个位移是**故意叠加**的；② 气泡只留**最近** PARALLAX_GROUP_BUBBLE_MAX 条（DOM 顺序即时间
 * 顺序，尾巴上那几条才是屏上的）；③ 命中的锚点先换成**真正要挪的盒子**（槽出口没盒子，见
 * parallaxGroupBox()）；④ "有没有 fixed 后代"这个要遍历子树的判定只在 `inFrame !== true` 时做
 * （帧里那次重扫沿用上一次的结论）。
 * 第三类来源是**别的插件注册的前端元素组**（parallaxPluginEffectiveGroups()，用户裁决 m02697-②）：
 * 它们的盒子并进同一张 `candidates` ⇒ 上面那套挑选（含"组里套组只留最外侧"）对它们一样生效，
 * 落在原生四组盒子里的插件组因此不会被挪两次（父组一动，子元素本来就跟着走）。
 * ⚠️ 原生四组那一条只在「界面元素跟随」**开着**时才走（`if (st.ui)`）：关着时它们系数恒为 0、
 * 压根不是候选，于是落在它们盒子里的插件组不再被"嵌套"吃掉 —— 只开插件前端也能真的动
 * （用户诉求 m03549 的"独立"；否则那一块就是个拖了不动的空开关）。
 */
function parallaxTargetsRefresh(now, inFrame) {
  if (typeof document === 'undefined' || !document
    || typeof document.querySelectorAll !== 'function') return;
  const prev = parallaxTargets;
  const next = [];
  const found = document.querySelectorAll(PARALLAX_TARGET_SELECTOR);
  for (let i = 0; i < found.length; i += 1) {
    parallaxTargetAdd(next, prev, found[i], false, inFrame);
  }
  const st = parallaxSettings();
  const candidates = [];
  // ① 宿主自己的界面四组（含用户气泡）：只在「界面元素跟随」**开着**时才算候选。关着时它们系数
  //    恒为 0（parallaxTargetRatio 里 `if (!st.ui) return 0`），留在候选里只会白跑一遍 fixed 后代
  //    扫描，**还会把落在它们盒子里的插件组当成嵌套吃掉** ⇒ 只开「插件前端跟随」时那些插件组
  //    白认一场（用户诉求 m03549 的"独立"落不到实处）。
  if (st.ui) {
    const groups = document.querySelectorAll(PARALLAX_GROUP_SELECTOR);
    const bubbles = [];
    for (let i = 0; i < groups.length; i += 1) {
      const kind = parallaxGroupKind(groups[i]);
      if (kind === 'bubble') bubbles.push({ el: groups[i], kind: kind });
      else candidates.push({ el: groups[i], kind: kind });
    }
    const from = bubbles.length > PARALLAX_GROUP_BUBBLE_MAX
      ? bubbles.length - PARALLAX_GROUP_BUBBLE_MAX : 0;
    for (let i = from; i < bubbles.length; i += 1) candidates.push(bubbles[i]);
  }
  // ② 别的插件注册的前端元素组（用户裁决 m02697-②）：**出口的元素子节点**才是要挪的盒子。
  //    这一块有自己的开关（用户诉求 m03549），关着时一个都不认 —— 那时它们的系数恒为 0，认了
  //    只会白跑 fixed 后代那道子树判定（每个组最多 400 个 getComputedStyle）。**与界面整块那个
  //    开关互不依赖**：只开插件前端也能动，反之亦然。名单走 parallaxPluginEffectiveGroups()：
  //    落在外层组盒子里的（界面跟随开着时）在那里已经剔掉了。
  if (st.pluginOn) {
    const plugins = parallaxPluginEffectiveGroups();
    for (let i = 0; i < plugins.length; i += 1) {
      candidates.push({ el: plugins[i].el, kind: 'plugin', slot: plugins[i].slot });
    }
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const el = candidates[i].el;
    let nested = false;
    for (let j = 0; j < candidates.length; j += 1) {
      if (i === j) continue;
      const outer = candidates[j].el;
      if (outer && typeof outer.contains === 'function' && outer.contains(el)) { nested = true; break; }
    }
    if (nested && candidates[i].kind !== 'bubble') continue;
    parallaxTargetAdd(next, prev, parallaxGroupBox(el) || el, true, inFrame, candidates[i].kind,
      candidates[i].slot);
  }
  for (let j = 0; j < prev.length; j += 1) {
    if (prev[j].kept) { prev[j].kept = false; continue; }
    parallaxTargetClear(prev[j]);
  }
  parallaxTargets = next;
  parallaxTargetsMs = now;
  parallaxStale = false;
}

/** 起帧路径上的重扫（节流）：`parallaxTargetsMs === 0` 表示还没扫过 ⇒ 立刻扫。 */
function parallaxTargetsEnsure(now) {
  if (parallaxTargetsMs && now - parallaxTargetsMs < PARALLAX_TARGETS_MS) return;
  parallaxTargetsRefresh(now);
}

/** 收工：把合成层提示摘掉（本仓刻意不留常驻合成层）；位移留着，下次 pointermove 直接续上。
 *  界面组从不提层（它连本层的类都不该有）⇒ 这里跳过它。 */
function parallaxTargetsSettle() {
  for (let i = 0; i < parallaxTargets.length; i += 1) {
    const rec = parallaxTargets[i];
    if (rec.group) continue;
    parallaxTargetLift(rec.el, false);
  }
}

/** 壁纸补边的系数（只在设置变了时写一次，落在 body 上）：位移由 JS 算，这条只喂
 *  `scale: calc(1 + var(--we-parallax-bg, 0) / 50)`（除以 50 的来路见 src/styles.js 那一份注释：
 *  位移最大 = 系数/100 × 整屏宽，居中放大 s 时每侧多出 s/2 × 整屏宽 ⇒ s = 系数/50）。 */
function parallaxRatios(st) {
  const body = weBody();
  if (!body) return;
  const key = String(st.bg);
  if (key === parallaxRatioKey) return;
  parallaxRatioKey = key;
  parallaxVarOn(body, PARALLAX_VAR_BG, key);
}

/** 把补边系数从 body 上收掉（停用后 body 上不留本层的任何痕迹）。 */
function parallaxRatioClear() {
  const body = weBody();
  const style = body && body.style;
  if (!style || typeof style.removeProperty !== 'function') return;
  try { style.removeProperty(PARALLAX_VAR_BG); } catch (e) { /* 已卸载 */ }
}

/**
 * 把这一帧的位移写下去（每帧一次，**只写要动的那几层自己**）：两位小数够用 —— 再细也看不出来，
 * 而"值没变就不写"这一条让静止的那些帧一次样式写入都没有。
 * 界面组走另一条腿：量化到整设备像素（带迟滞，见 parallaxSnapAxis）、归零就摘属性、
 * 组里有 fixed 后代时不动它；左栏那一条走 `position: relative` + `left`/`top`（见文件头 ②）。
 * 返回写了几次；顺带记下"有节点掉出文档"（壁纸换节点），由调用方决定何时重扫。
 */
function parallaxApply(st) {
  if (!parallaxTargets.length) return 0;
  let writes = 0;
  for (let i = 0; i < parallaxTargets.length; i += 1) {
    const rec = parallaxTargets[i];
    const el = rec.el;
    if (!el || el.isConnected === false) { parallaxStale = true; continue; }
    const ratio = rec.group && rec.blocked === true ? 0 : parallaxTargetRatio(rec, st);
    if (rec.group) {
      const dx = parallaxSnapAxis(parallaxStepX * ratio, rec.dx);
      const dy = parallaxSnapAxis(parallaxStepY * ratio, rec.dy);
      if (dx === 0 && dy === 0) { parallaxTargetUnset(rec); continue; }
      const dpr = parallaxDpr > 0 ? parallaxDpr : 1;
      const x = dx / dpr;
      const y = dy / dpr;
      const uiValue = x.toFixed(2) + 'px ' + y.toFixed(2) + 'px';
      if (uiValue === rec.key) continue;
      rec.key = uiValue;
      rec.dx = dx;
      rec.dy = dy;
      if (parallaxTargetIsOffset(rec)) parallaxTargetOffset(rec, x.toFixed(2), y.toFixed(2));
      else parallaxVarOn(el, PARALLAX_TRANSLATE, uiValue);
      writes += 1;
      continue;
    }
    const value = (parallaxStepX * ratio).toFixed(2) + 'px '
      + (parallaxStepY * ratio).toFixed(2) + 'px';
    if (value === rec.key) continue;
    rec.key = value;
    parallaxTargetLift(el, true);
    parallaxVarOn(el, PARALLAX_TRANSLATE, value);
    writes += 1;
  }
  return writes;
}

/** 总开关属性：开了才让补边那条规则命中（关掉时屏上不留任何痕迹）。 */
function parallaxAttr(on) {
  const body = weBody();
  if (!body) return;
  if (on) {
    if (typeof body.setAttribute === 'function') body.setAttribute(PARALLAX_ATTR, 'on');
    return;
  }
  if (typeof body.removeAttribute === 'function') body.removeAttribute(PARALLAX_ATTR);
}

/**
 * 自检（`localStorage.weParallaxDebug = '1'`）：读开关本身有成本，所以只在起帧路径上
 * **最多每秒重读一次**；打开时开新样本桶，关掉即丢。任何读取异常（隐私模式、被禁的存储）
 * 一律当作关。
 */
function parallaxDebugSync(now) {
  // 节流必须**不看当前状态**：判据里带 `parallaxDebugOn &&` 的话，默认态（关）下一次手势
  // 的每一起帧都会落到 localStorage 读（60~144 次/秒），"最多每秒重读一次"就只剩开着时成立。
  if (now - parallaxDebugCheckMs < PARALLAX_DEBUG_REREAD_MS) return;
  parallaxDebugCheckMs = now;
  let on = false;
  try {
    const ls = typeof localStorage === 'undefined' ? null : localStorage;
    if (ls && typeof ls.getItem === 'function') on = ls.getItem(PARALLAX_DEBUG_KEY) === '1';
  } catch (e) { on = false; }
  parallaxDebugOn = on;
  parallaxDebugStats = on
    ? { frames: 0, writes: 0, long: 0, costs: [], gaps: [] }
    : null;
  parallaxDebugLastMs = 0;
}

function parallaxPercentile(list, p) {
  if (!list.length) return 0;
  const sorted = list.slice().sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return Math.round(sorted[at] * 100) / 100;
}

/** 攒一帧的样本：回调耗时（t0 由帧入口取）、写了几个元素、与上一帧 rAF 时间戳的间隔。 */
function parallaxDebugFrame(t0, now, writes) {
  const stats = parallaxDebugStats;
  if (!parallaxDebugOn || !t0 || !stats) return;
  const cost = weNow() - t0;
  stats.frames += 1;
  stats.writes += writes;
  if (cost >= PARALLAX_LONG_FRAME_MS) stats.long += 1;
  if (stats.costs.length < PARALLAX_DEBUG_SAMPLES) stats.costs.push(cost);
  if (parallaxDebugLastMs && now > parallaxDebugLastMs
    && stats.gaps.length < PARALLAX_DEBUG_SAMPLES) {
    stats.gaps.push(now - parallaxDebugLastMs);
  }
  parallaxDebugLastMs = now;
}

/** 清点当前认到的界面组（自检用）：四档 + 插件组各几个、几个被 fixed 后代挡下、几个走相对偏移
 *  （左栏）。纯读数，不碰 DOM —— 记录本来就在手边（自检那条路上一帧都不该多花）。 */
function parallaxGroupCounts() {
  const counts = { chat: 0, composer: 0, sidebar: 0, bubble: 0, plugin: 0, offset: 0, blocked: 0 };
  for (let i = 0; i < parallaxTargets.length; i += 1) {
    const rec = parallaxTargets[i];
    if (!rec.group) continue;
    if (rec.blocked === true) counts.blocked += 1;
    if (rec.kind === 'composer') counts.composer += 1;
    else if (rec.kind === 'sidebar') {
      counts.sidebar += 1;
      if (parallaxTargetIsOffset(rec)) counts.offset += 1;
    } else if (rec.kind === 'bubble') counts.bubble += 1;
    else if (rec.kind === 'plugin') counts.plugin += 1;
    else counts.chat += 1;
  }
  return counts;
}

/** 一次手势收工（或停用）时打一行结论，并把同一份对象挂到 `window.__weParallaxStats` 上。
 *  可传入 `groupCounts` 覆盖读数：`parallaxStop()` 必须在**清表之前**先快照组数（否则那行恒为 0）。 */
function parallaxDebugReport(groupCounts) {
  const stats = parallaxDebugStats;
  if (!parallaxDebugOn || !stats || !stats.frames) return;
  const report = {
    frames: stats.frames,
    writes: stats.writes,
    longFrames: stats.long,
    groups: groupCounts || parallaxGroupCounts(),
    costMs: {
      p50: parallaxPercentile(stats.costs, 0.5),
      p95: parallaxPercentile(stats.costs, 0.95),
      max: parallaxPercentile(stats.costs, 1),
    },
    gapMs: {
      p50: parallaxPercentile(stats.gaps, 0.5),
      p95: parallaxPercentile(stats.gaps, 0.95),
      max: parallaxPercentile(stats.gaps, 1),
    },
  };
  parallaxDebugStats = { frames: 0, writes: 0, long: 0, costs: [], gaps: [] };
  parallaxDebugLastMs = 0;
  try {
    const win = typeof window === 'undefined' ? null : window;
    if (win) win.__weParallaxStats = report;
  } catch (e) { /* 只读宿主 */ }
  try {
    if (typeof console !== 'undefined' && console && typeof console.info === 'function') {
      const g = report.groups;
      console.info('[we-parallax] 帧 ' + report.frames + ' · 写入 ' + report.writes
        + ' · 长帧(≥' + PARALLAX_LONG_FRAME_MS + 'ms) ' + report.longFrames
        + ' · 回调耗时 p50/p95/max ' + report.costMs.p50 + '/' + report.costMs.p95 + '/'
        + report.costMs.max + 'ms · 帧间隔 p50/p95/max ' + report.gapMs.p50 + '/'
        + report.gapMs.p95 + '/' + report.gapMs.max + 'ms'
        + ' · 界面组 会话/输入/侧栏/气泡 ' + g.chat + '/' + g.composer + '/' + g.sidebar
        + '/' + g.bubble + ' · 插件前端 ' + g.plugin
        + ' · 被 fixed 挡下 ' + g.blocked
        + ' · 侧栏走相对偏移 ' + g.offset);
    }
  } catch (e) { /* 没有控制台 */ }
}

function parallaxOnPointerMove(e) {
  if (!parallaxOn) return;
  parallaxX = e.clientX;
  parallaxY = e.clientY;
  parallaxSeen = true;
  parallaxMoveMs = weNow();
  parallaxKick();
}

/** 换窗口大小 ⇒ 中心跟着变（同一次光标位置的目标位移不同）：重读视口、再算一帧。 */
function parallaxOnResize() {
  if (!parallaxOn) return;
  parallaxReadViewport();
  parallaxKick();
}

/** 页面切到后台就停帧（并丢掉时间基准，回来时不会攒出一次大跳跃），切回前台再接上。 */
function parallaxOnVisibility() {
  if (!parallaxOn) return;
  if (parallaxHidden()) {
    if (parallaxRaf) {
      try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(parallaxRaf); } catch (e) { /* 已卸载 */ }
      parallaxRaf = 0;
    }
    parallaxLastMs = 0;
    parallaxDebugReport();
    return;
  }
  parallaxKick();
}

function parallaxBind() {
  if (parallaxBound) return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  // passive：只读事件，绝不拦指针（屏上也没有属于本层的元素）。
  document.addEventListener('pointermove', parallaxOnPointerMove, { passive: true });
  document.addEventListener('visibilitychange', parallaxOnVisibility, { passive: true });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', parallaxOnResize, { passive: true });
  }
  parallaxBound = true;
}

function parallaxUnbind() {
  if (!parallaxBound) return;
  try {
    document.removeEventListener('pointermove', parallaxOnPointerMove);
    document.removeEventListener('visibilitychange', parallaxOnVisibility);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', parallaxOnResize);
    }
  } catch (e) { /* 已卸载 */ }
  parallaxBound = false;
}

/**
 * 起一帧（已经在跑就不重复排）：由 pointermove / resize / visibilitychange 与自己的帧尾调用。
 * 这里做的都是**帧外**的事：补读一次视口（只到读出来为止）、重读自检开关（≤1 次/秒）、
 * 节流重扫那几层 —— 于是帧里可以一个测量 API 都不碰。
 */
function parallaxKick() {
  if (parallaxRaf) return;
  if (typeof requestAnimationFrame !== 'function') return;
  if (parallaxHidden()) return;
  const now = weNow();
  if (parallaxVw <= 0 || parallaxVh <= 0) parallaxReadViewport();
  if (parallaxVw <= 0 || parallaxVh <= 0) return;
  parallaxDebugSync(now);
  parallaxTargetsEnsure(now);
  parallaxRaf = requestAnimationFrame(parallaxFrame);
}

/**
 * 一帧：把步长朝目标逼近一截、写下去，没到位就再排一帧。
 * 目标只看"光标相对中心的偏移"与视口尺寸 —— 视口就是那条对角线的两端：光标贴在屏幕角上时
 * 位移正好 = pct% × 最长对角线（用户口径 m02697-① 的那个定义）。
 */
function parallaxFrame(ms) {
  parallaxRaf = 0;
  if (!parallaxOn) return;
  const t0 = parallaxDebugOn ? weNow() : 0;
  const st = parallaxSettings();
  if (!st.on) { parallaxStop(); return; }
  const now = typeof ms === 'number' ? ms : weNow();
  // 视口未知 ⇒ 这一帧什么都不做（**不在帧里补读**）：下一次 kick 在帧外补读。
  if (parallaxVw <= 0 || parallaxVh <= 0) return;
  const vw = parallaxVw;
  const vh = parallaxVh;
  const cx = parallaxSeen ? parallaxX : vw / 2;
  const cy = parallaxSeen ? parallaxY : vh / 2;
  // 用户口径 m02697-①：能走到的最大位移 = 屏幕最长对角线的 pct% ⇒ 除数是 100 / 2
  // （PARALLAX_STEP_DIV：少一个 ×2 就会让所有层位移翻倍）。
  const targetX = PARALLAX_DIRECTION * (cx - vw / 2) / PARALLAX_STEP_DIV;
  const targetY = PARALLAX_DIRECTION * (cy - vh / 2) / PARALLAX_STEP_DIV;
  // 一层都不动（系数全 0）⇒ 屏上什么都不会变：一次落位、收工，一帧都不多排。
  const pctMax = parallaxMaxPercent(st);
  let writes;
  if (pctMax <= 0) {
    parallaxStepX = targetX;
    parallaxStepY = targetY;
    writes = parallaxApply(st);
    parallaxTargetsSettle();
    parallaxDebugFrame(t0, now, writes);
    parallaxDebugReport();
    return;
  }
  // 指数逼近：a = 每 16.7ms 吃掉剩余距离的比例（smooth=0 ⇒ a=1 ⇒ 直接落位，像贴在光标上）。
  const a = 1 - st.smooth / 100;
  const dt = parallaxLastMs ? Math.min(PARALLAX_DT_MAX, Math.max(1, now - parallaxLastMs))
    : PARALLAX_FRAME_MS;
  parallaxLastMs = now;
  const f = a <= 0 ? 1 : 1 - Math.pow(1 - a, dt / PARALLAX_FRAME_MS);
  parallaxStepX += (targetX - parallaxStepX) * f;
  parallaxStepY += (targetY - parallaxStepY) * f;
  // 到位判据按**屏上还剩多少位移**算（剩余步长 × 最大系数）；光标静下来一会儿之后放宽
  // —— 尾巴上那点位移早看不出来了，与其再画十几帧，不如一次抹平收工。
  const idle = parallaxMoveMs > 0 && now - parallaxMoveMs >= PARALLAX_IDLE_MS;
  const settle = Math.max(PARALLAX_SETTLE_PX,
    (idle ? PARALLAX_IDLE_VISIBLE_PX : PARALLAX_SETTLE_VISIBLE_PX) / pctMax);
  const doneX = Math.abs(targetX - parallaxStepX) <= settle;
  const doneY = Math.abs(targetY - parallaxStepY) <= settle;
  if (doneX) parallaxStepX = targetX;
  if (doneY) parallaxStepY = targetY;
  parallaxRatios(st);
  writes = parallaxApply(st);
  // 罕见路径：壁纸换了节点（写的时候发现它已经掉出文档）⇒ 重扫一次再补写，
  // 否则这一帧的位移就落在了一个没人看的节点上。这是**帧里**的重扫 ⇒ 界面组那项子树判定沿用
  // 上一次的结论（帧外那次已经算过），组里新冒出来的节点先按 blocked 处理。
  if (parallaxStale) {
    parallaxTargetsRefresh(now, true);
    writes += parallaxApply(st);
  }
  if (!doneX || !doneY) parallaxKick();
  else parallaxTargetsSettle();
  parallaxDebugFrame(t0, now, writes);
  if (doneX && doneY) parallaxDebugReport();
}

/**
 * 起（幂等）。**没有 rAF 的环境连 DOM 都不碰**：这一层是装饰，宁可不画，
 * 也不要在没有帧时钟的地方留半截状态（无头/测试沙箱走的就是这条）。
 */
function parallaxStart() {
  if (typeof requestAnimationFrame !== 'function') return;
  parallaxOn = true;
  parallaxAttr(true);
  parallaxReadViewport();
  parallaxRatios(parallaxSettings());
  parallaxBind();
  parallaxKick();
}

/** 全停（rAF、事件、临时合成层、位移、补边系数、开关属性）。 */
function parallaxStop() {
  parallaxOn = false;
  if (parallaxRaf) {
    try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(parallaxRaf); } catch (e) { /* 已卸载 */ }
    parallaxRaf = 0;
  }
  parallaxUnbind();
  // 先快照组数再清表：报告里那行"界面组 会话/输入/侧栏/气泡/插件"读的就是这张表
  // （parallaxGroupCounts），清完再报永远是 0 —— 先记下来，交给报告用（见 parallaxDebugReport）。
  const groupCounts = parallaxDebugOn ? parallaxGroupCounts() : null;
  parallaxTargetsClear();
  parallaxRatioClear();
  parallaxStepX = 0;
  parallaxStepY = 0;
  parallaxSeen = false;
  parallaxLastMs = 0;
  parallaxMoveMs = 0;
  parallaxRatioKey = '';
  parallaxVw = 0;
  parallaxVh = 0;
  parallaxDpr = 0;
  parallaxDebugReport(groupCounts);
  parallaxDebugOn = false;
  parallaxDebugStats = null;
  parallaxDebugCheckMs = 0;
  parallaxAttr(false);
}

/**
 * 设置变了就调一次（由 `src/client.js` 的 `subscribe(syncParallaxLayer)` 驱动）。
 * 它只决定"该不该活"，不碰具体参数 —— 那些每帧现读。
 */
function syncParallaxLayer() {
  const st = parallaxSettings();
  if (!st.on) {
    parallaxStop();
    return;
  }
  parallaxStart();
}

/** 卸载：本模块拥有的一切都收掉（监听、rAF、位移、补边系数、开关属性）。 */
function disposeParallaxLayer() {
  parallaxStop();
}

export {
  syncParallaxLayer,
  disposeParallaxLayer,
  parallaxDiscoveredGroups,
  // 插件槽位那一档的缺省距离：面板（src/ext-parallax.js）画行时要显示"缺键时算多少"，
  // 单一真源在这里 ⇒ 连这个数一起导出，面板直接读（不许自己再抄一个）。
  PARALLAX_PLUGIN_DEFAULT,
};
