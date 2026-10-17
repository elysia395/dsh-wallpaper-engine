/**
 * i18n-copy-ext.js — 英文词表域：扩展页签 · 关于页签 · 更新公告（ext-* · panel-tabs）
 *
 * 本域词条**原样搬自** `src/i18n-copy.js`（拆分属纯搬移：中文键与英文值一行未改、顺序未动）。
 * 组装点在同族的 `src/i18n-copy.js`（composer）；域模块必须排在 composer **之前**登记进
 * `scripts/build-client.mjs` 的 INLINE_MODULES —— 构建期内联进同一工厂作用域，顶层读受 TDZ 约束。
 * 只读不写：纯数据，不得有可执行语句。守卫判据见 `test/verify-i18n.mjs`（族读法 test/tools/src-scope.mjs）。
 */
const WE_I18N_EN_EXT = {
  // ── src/panel-tabs.js · 「扩展」页签（模块注册表 + 空态）──
  //    页签标签「扩展」本身在 src/client.js 的 PICKER_TABS 里，键登记在上面的
  //    `// ── src/client.js ──` 段（一张表，两处共用）。
  "扩展模块": "Extension modules",
  "还没有可用的扩展模块": "No extension modules yet",
  "后续新增的功能会以模块形式收在这里，每个模块自带它的控件": "Features added later are collected here as modules, each with its own controls",

  // ── packages/fx/src/ext-fx.js · 「扩展」页签二号模块（点击效果与拖尾效果）──
  //    范围/默认值不在这里写死：真源是 lib/settings-schema.js 的 14 个 `fx*` 键。
  //    最后那几条是**通用档位名**（混合模式与配色档），登记在本段。
  "点击效果与拖尾效果": "Click and trail effects",
  "在壁纸之上叠加随光标响应的点击与拖尾效果：整层在界面之后，不会挡到任何控件": "Overlays click and trail effects that follow the cursor on top of the wallpaper: the whole layer sits behind the interface, so it never blocks a control",
  "启用点击与拖尾效果": "Enable click and trail effects",
  "点击效果": "Click effect",
  "在点击处炸开一圈光效": "Bursts a ring of light where you click",
  "点击样式": "Click style",
  "点击时炸开的样子": "How the click bursts",
  "涟漪": "Ripple",
  "从点击处扩散的圆环": "Rings spreading out from the click",
  "星火": "Sparks",
  "向四周飞散的亮点": "Bright dots flying outward",
  "两者": "Both",
  "圆环与星火一起": "Rings and sparks together",
  "半径": "Radius",
  "点击光晕": "Click glow",
  "拖尾效果": "Trail effect",
  "光标划过时留下会淡出的轨迹": "Leaves a fading path as the cursor sweeps across",
  "拖尾样式": "Trail style",
  "轨迹的样子": "The shape of the path",
  "彗尾": "Comet",
  "一条渐隐的光带": "A single fading band of light",
  "星尘": "Stardust",
  "留在原地的亮点": "Bright dots left behind in place",
  "拖尾时长": "Trail duration",
  "光标停下后，轨迹在这段时间里淡完": "After the cursor stops, the path fades away over this long",
  "拖尾粗细": "Trail width",
  "拖尾光晕": "Trail glow",
  "与壁纸的融合方式：默认的滤色只让画面变亮、最像霓虹；想让它更像实体贴纸就换手选档": "How the effects fuse with the wallpaper: the default Screen only brightens, which looks most like neon; pick another mode by hand to make them feel more like a solid sticker",
  "效果配色": "Effect colors",
  "光效的取色方式": "How the effects pick their colors",
  "用「外观」里选的配色": "Uses the accent color from Appearance",
  "彩虹": "Rainbow",
  "每次效果的色相都不一样": "Every effect gets a different hue",
  "用下面选的那一个颜色": "Uses the single color picked below",
  "自定义颜色": "Custom color",
  "不透明度": "Opacity",
  "混合模式": "Blend mode",
  "滤色": "Screen",
  "正常": "Normal",
  "叠加": "Overlay",
  "正片叠底": "Multiply",
  "变亮": "Lighten",
  "跟随主题色": "Follow theme color",

  // ── packages/parallax/src/ext-parallax.js · 「扩展」页签三号模块（3D 效果）──
  //    范围/默认值不在这里写死：真源是 lib/settings-schema.js 的 11 个 `parallax*` 键
  //    （插件槽位那一档的缺省值是 packages/parallax/src/parallax-layer.js 的 PARALLAX_PLUGIN_DEFAULT）。
  //    这一节刻意不登记 `%`（SliderRow 的单位后缀是代码里的字面量，不进词表），
  //    也没有与另两个模块共用的键 —— 文案都是这一个模块自己的。
  //    距离的口径只有一条（用户口径 m02697-①）：**最大位移 = 屏幕最长对角线的百分比**。
  "3D 效果": "3D effect",
  "光标移动时，壁纸与吉祥物沿屏幕中心的对称方向轻轻偏移，界面整块则与壁纸同向轻挪（视差纵深）": "Shifts the wallpaper and the mascot gently along the direction mirrored about the screen center as the cursor moves, while the whole interface drifts the same way as the wallpaper (parallax depth)",
  "启用 3D 效果": "Enable 3D effect",
  "光标移动时，壁纸与吉祥物沿屏幕中心的对称方向轻轻偏移；界面整块默认不动（要一起动就打开下面的「界面元素跟随」）": "As the cursor moves, the wallpaper and the mascot drift gently in the direction mirrored about the screen center; the interface itself stays put unless you turn on Interface follows below",
  "背景": "Background",
  "背景缓动距离": "Background travel",
  "光标贴到屏幕角时，壁纸挪动的距离占屏幕最长对角线的百分比（壁纸会同时放大同样多，免得边上露出底色）": "How far the wallpaper travels, as a percentage of the screen's longest diagonal, when the cursor reaches a screen corner (the wallpaper is scaled up by the same amount, so no base color shows at the edges)",
  "吉祥物跟随": "Mascot follows",
  "挂件也按「背景缓动距离」一起挪": "The mascot drifts along using the background travel distance",
  "原生前端": "Built-in interface",
  "界面元素跟随": "Interface follows",
  "输入卡片、会话文本区（连里面的用户气泡一起）与侧栏作为整块跟着挪：文字与底下的玻璃一起动": "The composer, the conversation text area (user bubbles inside included) and the sidebar drift as whole blocks: the text moves together with the glass underneath it",
  "会话文本区距离": "Conversation area travel",
  "长回复所在的整块文本区自己的最大位移：光标贴到屏幕角时它最多挪出屏幕最长对角线的百分之几（0 = 这一组完全不跟）": "Maximum travel of the whole text area that long replies live in, on its own: the percentage of the screen's longest diagonal it can move when the cursor reaches a screen corner (0 = this group does not move at all)",
  "输入卡片距离": "Composer travel",
  "底部输入卡片自己的最大位移：默认比文本区大一点，看着更靠前、纵深更明显（0 = 这一组完全不跟）": "Maximum travel of the composer at the bottom, on its own: by default a little larger than the text area, which reads as the nearest layer and makes the depth clearer (0 = this group does not move at all)",
  "侧栏距离": "Sidebar travel",
  "左侧栏自己的最大位移：它比文本区更靠后，想让它更沉就调小（0 = 这一组完全不跟）": "Maximum travel of the left sidebar, on its own: it sits further back than the text area, so lower values read as more distant (0 = this group does not move at all)",
  "用户气泡距离": "User bubble travel",
  "你的消息气泡在会话文本区之外「再多走」的一份距离：0 = 气泡只跟着文本区一起动，调大就比周围的回复更靠前": "An extra distance your message bubbles add on top of the conversation text area: 0 = bubbles only move with the text area, and higher values put them in front of the replies around them",
  "插件前端": "Plugin interface",
  "插件前端跟随": "Plugin interface follows",
  "别的插件注册进来的界面元素组（比如任务看板、市场面板）也跟着挪；默认关 —— 它动的是它们的真实界面": "Front-end element groups registered by other plugins (a task board, a marketplace panel, and so on) drift along too; off by default, because it moves their real interface",
  "下面是运行期认到的、由别的插件注册进来的前端元素组（槽名就是它的身份）：一行一个，0 = 这一组完全不跟。组里出现固定在屏幕上的元素（下拉、浮层一类）时，这一组整组都不跟": "Below are the front-end element groups discovered at runtime that other plugins registered (the slot name is the identity): one row each, 0 = that group does not move at all. If the group contains a fixed-position element (a dropdown or popover, say), the whole group stays still",
  "还没认到别的插件注册的前端元素组：等它们的界面出现后，这里会自动多出对应的行": "No front-end element groups registered by other plugins have been discovered yet: once their interface shows up, the matching rows appear here automatically",
  "这一组自己的最大位移：光标贴到屏幕角时它最多挪出屏幕最长对角线的百分之几（0 = 这一组不缓动）。组里出现固定在屏幕上的元素（下拉、浮层一类）时，这一组整组都不跟": "Maximum travel of this group, on its own: the percentage of the screen's longest diagonal it can move when the cursor reaches a screen corner (0 = this group does not move). If the group contains a fixed-position element (a dropdown or popover, say), the whole group stays still",
  "缓动平滑": "Easing smoothness",
  "0 = 立刻跟手，越大越柔和（跟得越慢、停下后还会飘一小段才归位）": "0 = follows the cursor instantly; higher values are softer (it trails behind and keeps drifting a little after the cursor stops)",

  // ── src/ext-avatar.js · 「扩展」页签**第一个**模块（自定义会话头像）──
  //    范围/默认值不在这里写死：真源是 lib/settings-schema.js 的五个 `avatar*` 键。
  //    与别的模块共用的键（清除那种）**不重复登记** —— 上面已经有的直接复用。
  "自定义会话头像": "Custom session avatars",
  "给会话双方各配一张头像，消息像好友聊天一样左右分列（默认关）": "Give both sides of the conversation an avatar, so messages line up left and right like a chat with a friend (off by default)",
  "启用自定义会话头像": "Enable custom session avatars",
  "给会话双方配上头像，消息像好友聊天一样左右分列": "Gives both sides an avatar, so messages line up left and right like a chat with a friend",
  "开启后：你的消息靠右侧、带你的头像；助手的消息靠左侧、带助手的头像。图片只保存在本机（导入时会缩到 1024px 以内）；JPG / PNG / WebP 直接导入，SVG / GIF / BMP / AVIF 会在导入时转成位图。超过 1024×1024 或 4 MB 的图会被拦下，可选择自动压缩后导入。没导入就用内置的默认头像。关掉这个开关，会话立刻恢复原样。": "Once on: your messages sit on the right with your avatar; the assistant's messages sit on the left with its own. Images are stored on this machine only (shrunk to at most 1024px on import). JPG / PNG / WebP import as-is; SVG / GIF / BMP / AVIF are rasterised on import. Images over 1024x1024 or 4 MB are held back, with the option to compress and import. Without one a built-in default avatar is drawn. Turn this off and the conversation goes back to exactly how it was.",
  "「我」的头像": "Your avatar",
  "你的消息在右侧，头像跟着在右侧": "Your messages sit on the right, so your avatar does too",
  "「助手」的头像": "Assistant avatar",
  "助手的消息在左侧，头像跟着在左侧": "The assistant's messages sit on the left, so its avatar does too",
  "导入图片…": "Import image…",
  "导入中…": "Importing…",
  "头像大小": "Avatar size",
  "圆角强度": "Corner roundness",
  "100% = 正圆（默认），50% = 大圆角方块，0% = 直角方形": "100% = a full circle (default), 50% = a rounded square, 0% = sharp corners",

  "仅支持 JPG / PNG / WebP 图片": "Only JPG / PNG / WebP images are supported",
  "仅支持 JPG / PNG / WebP / SVG / GIF / BMP / AVIF 图片": "Only JPG / PNG / WebP / SVG / GIF / BMP / AVIF images are supported",
  "这张图无法直接导入：{why}。": "This image cannot be imported directly: {why}.",
  "原图 {w}×{h}，超过 1024×1024 上限": "the original is {w}x{h}, over the 1024x1024 limit",
  "原图 {mb}，超过 4 MB 上限": "the original is {mb}, over the 4 MB limit",
  "原图 {w}×{h}、{mb}，同时超过 1024×1024 与 4 MB 上限": "the original is {w}x{h} and {mb}, over both the 1024x1024 and 4 MB limits",
  "可以点下面的按钮自动压缩后再导入：等比缩到 1024×1024 以内、优先 PNG 无损编码（只有 PNG 装不下才转视觉无损 WebP），压缩完仍然让你先裁切、可取消。": "Use the button below to compress and then import: scaled to fit 1024x1024, with PNG (lossless) preferred and a fallback to visually lossless WebP only when PNG will not fit. You still get to crop first, and can cancel.",
  "自动压缩后导入": "Compress and import",
  "压缩中…": "Compressing…",
  "压缩失败：{error}": "Compression failed: {error}",
  "导入失败：{error}": "Import failed: {error}",
  "宿主里没有{what}路由：重启 DSH 后再试（改过宿主代码要重挂，刷新页面不够）": "The host has no {what} route: restart DSH and try again (if you changed host code it must be re-mounted; refreshing the page is not enough)",
  "头像": "avatar",
  "立绘": "mascot art",
  "清除失败：{error}": "Clear failed: {error}",

  // ── src/panel-tabs.js · 「关于」页签（简介 / 致谢 / 仓库 / 交流群）──
  //    人名与项目标识不译（oneincase / YV3507 / WebWallGL / media-bridge / scene-gl…）；
  //    中文全角标点只出现在键里 —— 值里一律 ASCII（守卫会把全角标点当"中文"判红）。
  "关于": "About",
  "📖 项目简介": "📖 About the project",
  "🖼️ 壁纸引擎 · 让 DSH 的背后动起来": "🖼️ Wallpaper Engine · bring the space behind DSH to life",
  "把 Wallpaper Engine 的壁纸搬到 DSH 界面后面：视频直接播放，场景（Scene）与网页（Web）壁纸由内置的 WebWallGL 引擎实时渲染，再配上一整套液态玻璃界面改造 —— 你桌面上那张会动的画，现在就在对话背后放着。🎬✨": "Puts your Wallpaper Engine wallpapers behind the DSH interface: videos play directly, Scene and Web wallpapers are rendered live by the bundled WebWallGL engine, and the whole UI gets a liquid-glass makeover — the moving picture from your desktop now hangs behind the chat. 🎬✨",
  "壁纸全部来自你自己的机器（本机库 / WE 工程目录 / 手动上传），插件不联网也能用，更不会把它们传到任何地方。🔒": "Every wallpaper comes from your own machine (local library / WE project folders / manual uploads); the plugin works offline and never sends them anywhere. 🔒",
  "🙏 贡献者致谢": "🙏 Contributors",
  "这个插件是许多人一起做出来的成果，谢谢他们：❤️": "This plugin is the work of many hands — thank you all: ❤️",
  "🧩 oneincase —— 内置 WebWallGL 实时渲染引擎与 media-bridge 媒体中间件的作者：场景 / 网页壁纸的实时渲染，以及 Windows / macOS / Linux 三平台的原生媒体链路，都建立在它们之上": "🧩 oneincase — author of the bundled WebWallGL live-rendering engine and the media-bridge media middleware: live rendering for Scene / Web wallpapers and the native media pipeline on Windows / macOS / Linux are both built on them",
  "🛠️ YV3507 —— 提交量最大的贡献者：从早期场景渲染器起步，到静态帧系列修复、液态玻璃令牌体系、实时帧链路与多轮大型重构，几乎每个里程碑都有他": "🛠️ YV3507 — the most prolific contributor: from the early scene renderer to the static-frame fixes, the liquid-glass token system, the live-frame pipeline and several large refactors — he is in almost every milestone",
  "🎨 yuxilao —— scene-gl 的 Linux 实时渲染管线（WebGL2 官方 shader 驱动）、轮换交接与 GPU 帧回填": "🎨 yuxilao — the Linux live-rendering pipeline of scene-gl (WebGL2 driven by the official shaders), rotation hand-off and GPU frame back-fill",
  "🍎 Jerry —— 在三平台原生支持落地之前，macOS 侧的适配与贡献路径由他维护": "🍎 Jerry — before native support landed on all three platforms, he maintained the macOS port and the macOS contribution path",
  "🌟 还有 SiriLee、libiwolve、0-007pro、jujubaoj646-star、xiahou001、wilianyichen、hecoococ、ShamSky88、Rekk0、Y1X1n 等贡献者，以及所有通过 issue 反馈与 PR 参与改进的朋友 —— 谢谢你们！": "🌟 And SiriLee, libiwolve, 0-007pro, jujubaoj646-star, xiahou001, wilianyichen, hecoococ, ShamSky88, Rekk0, Y1X1n and many more, plus everyone who filed an issue or sent a PR — thank you!",
  "也谢谢上游 Wallpaper Engine 生态与 DSH 官方插件的作者们 —— 站在你们的肩膀上。🙇": "Thanks as well to the Wallpaper Engine ecosystem and the authors of the official DSH plugins — we are standing on your shoulders. 🙇",
  "⭐ 开源与支持": "⭐ Open source & support",
  "项目以 MIT 协议开源、完全免费。如果它让你的 DSH 好看了一点点，去仓库点一颗 ⭐ 就是最直接的鼓励～": "The project is MIT-licensed and completely free. If it made your DSH look even a little nicer, a ⭐ on the repo is the most direct way to say thanks!",
  "⭐ 去 GitHub 点亮 Star": "⭐ Star it on GitHub",
  "在浏览器里打开项目仓库": "Open the project repository in your browser",
  // 「重新查看本版更新公告」（关于页「开源与支持」节那枚按钮）：公告是等版本弹一次的
  // 展示面，看过就调不出来 —— 这条给用户一条重看路径（也顺带能再看到配图下的求星入口）。
  "重新查看本版更新公告": "Show this version's update notice again",
  "再弹一次本版更新公告（含配图下方的求星入口）": "Show this version's update notice once more (it carries the star entry under the art)",
  "⭐ 正在获取 star 数…": "⭐ Fetching star count…",
  "⭐ 当前 {count} star": "⭐ {count} stars right now",
  "⭐ 暂时取不到 star 数": "⭐ Star count unavailable right now",
  "来自 GitHub API 的实时数据（带缓存；拉不到时显示上一次取到的值）": "Live data from the GitHub API (cached; when GitHub cannot be reached the last known value is shown)",
  "🔗 仓库地址（按钮打不开时可手动复制）：": "🔗 Repository URL (copy it manually if the button does nothing):",
  "想要新功能、遇到问题，或者想看看接下来要做什么，都欢迎来仓库提 Issue / PR —— 一起把它做得更好 🧰": "Want a new feature, hit a problem, or curious what is next? File an Issue / PR in the repo — let's make it better together. 🧰",
  "💬 加入交流群": "💬 Join the community",
  "卡住了、想吐槽、或者想第一时间拿到新版本，都欢迎来群里找我们 👋": "Stuck, want to vent, or want new versions the moment they land? Come find us in the groups. 👋",
  "🐧 QQ 群 · DSHWE | LLM 讨论群": "🐧 QQ group · DSHWE | LLM discussion",
  "🎵 抖音群 · dsh 交流群": "🎵 Douyin group · dsh community",
  "QQ 群二维码": "QQ group QR code",
  "抖音群二维码": "Douyin group QR code",
  "手机 QQ 扫码加入 · 群里见 👋": "Scan with QQ on your phone to join · see you there 👋",
  "抖音扫码加入 · 群号 252729465001": "Scan in Douyin to join · group ID 252729465001",
  "💌 感谢每一位使用者 —— 换上你喜欢的那张壁纸，这个插件就没白写。": "💌 Thanks to every user — put up a wallpaper you love and this plugin has done its job.",
  // 「作者自用」推广弹窗（PresetIntroDialog）：EN 侧用词表里的预设译名（"Author's preset"，
  // 与预设卡片显示的那份一致）；键里的「作者自用」是中文原文照抄。
  "试试「作者自用」外观预设？": "Try the “Author's preset” look?",
  "「作者自用」是作者日常在用的整机外观方案：兼顾美观与可读性，一键套用、不用逐项调。": "“Author's preset” is the look the author uses daily: balanced for beauty and readability — one click instead of tuning every knob.",
  "采用后当前外观设置会被整份替换（不能一键撤销）；选择保持的话，随时可在「设置 → 壁纸引擎 → 主题预设」里再套用。": "Applying replaces your current look settings entirely (no one-click undo). If you keep yours, you can apply it anytime under Settings → Wallpaper Engine → Theme presets.",
  "正在应用…": "Applying…",
  "采用「作者自用」": "Apply “Author's preset”",
  "保持我的设置": "Keep my settings",
  // ── 更新公告（当前一版公告的标题 / 配图 caption / 四条正文 / 按钮）──
  "🎉 更新：头像导入大升级 · 一组修复 · 省电与外观提示": "🎉 Update: avatar import overhaul · a batch of fixes · power saving & look tip",
  "新朋友「星来」登场": "The blue-haired maid mascot says hi",
  // 公告配图下那行（求星入口）的文案与关于页那枚 Star 按钮**同一句** ⇒ 复用其既有词条
  //（上面 "⭐ 去 GitHub 点亮 Star"，151 行那份），此处**不得**再登记一份：
  // 同键重复会被 test/verify-i18n.mjs 的「词表内无重复键」判红（同名键在对象字面量里静默去重，
  // 后写的那份会被吃掉）。
  "头像导入大升级！": "Avatar imports leveled up!",
  "现支持 SVG / GIF 等更多格式，超大图可自动压缩，上传前还能先裁切 —— 都在「扩展」分页。": "SVG / GIF and more formats are supported, oversized images can be auto-compressed, and you can crop before uploading — all under the Extensions tab.",
  "修复一批": "A batch of fixes",
  "：多窗口实时渲染不再互相踢掉；网页壁纸音频可视化恢复跳动；设置图标对齐、思考块行内代码与下拉弹层显示恢复正常。": ": live scene wallpapers in multiple windows no longer kick each other off; web-wallpaper audio visuals react to music again; settings icons, inline code in thinking blocks and dropdown popups render correctly again.",
  "Linux 用户更省电": "Linux users save more battery",
  "：窗口被遮挡时自动降帧，完全遮挡时暂停渲染。": ": a covered window drops frames, a fully covered one pauses rendering.",
  "在设置中启用深色模式 + 「作者自用」预设，为本插件最佳效果之一！": "Enable dark mode + the “Author's preset” in Settings — one of this plugin's best looks!",
  "升级后建议重启一次 DSH，改动才完整生效；本提示每个新版本只出现一次，点下方按钮关闭后不再弹出。": "Restart DSH once after upgrading so changes fully apply; this notice shows once per version — dismiss it and it won't come back.",
};

export { WE_I18N_EN_EXT };
