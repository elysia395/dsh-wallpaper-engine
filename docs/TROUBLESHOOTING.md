# 排障

> **English**: [`en/TROUBLESHOOTING.md`](./en/TROUBLESHOOTING.md)（与本文同源：改一处请同步另一处）


> 面向新手的常见问题见 [`../README.beginner.md`](../README.beginner.md) 的 FAQ；
> 功能边界见 `../README.md` 的「已知限制」；升级顺序问题见 [`UPGRADING.md`](./UPGRADING.md)。

## 改了插件却"完全没作用"：先分清**客户端半**与**宿主半**

这条专治"改了代码、刷新了页面、现象一字不变"（实测踩过：大场景壁纸的首帧超时修复像没生效，
实际上是**宿主半从未重载**）。两半的加载方式完全不同：

| 半 | 从哪来 | 什么时候生效 |
|---|---|---|
| 客户端半（`lib/client.js` / `src/**`） | 宿主把**产物文件**当静态资源发给页面 | **刷新页面**即生效（诊断里 `client-boot` 的 build 标记会变） |
| 宿主半（`lib/index.js` 门面 + 它拆出的 `lib/**` 宿主模块 / `lib/routes/**`） | DSH 进程启动时 `apply(ctx)` **加载一次**，常驻内存 | **必须重启那个宿主**（官方 `DeepSeek Harness` 与社区 `DSH Desktop` 是**两个独立进程**，各加载一份） |

三条现场判据（都在本机 127.0.0.1 上，任选其一即可分辨）：

```powershell
# ① 新宿主才有这条路由：200 = 新代码在跑，404 = 宿主是旧的
curl.exe -s -o NUL -w "%{http_code}`n" "http://127.0.0.1:<GUI端口>/wallpaper-engine/scene-payload-progress?token=x"
# ② 新宿主的 inventory 才有 scenePkgBytes（大包首帧预算按它放大）
(Invoke-WebRequest "http://127.0.0.1:<GUI端口>/wallpaper-engine/inventory").Content | Select-String scenePkgBytes
# ③ 落盘时间对照：build-stamp.at 是**当前宿主 apply 的时刻**，比源文件 mtime 早 ⇒ 宿主没重载
Get-Content "$env:USERPROFILE\.dsh-wallpaper-engine\build-stamp.json"
Get-Item  D:\dsh-wallpaper-engine\lib\index.js | Select-Object LastWriteTime
# ④ 进程启动时间：宿主进程的 StartTime 早于你改文件的时间 ⇒ 它内存里是旧模块
Get-Process 'DeepSeek Harness','DSH Desktop' | Select-Object ProcessName,Id,StartTime
```

顺带两条容易误判的点：

- **插件目录通常是 junction**（`~/.dsh/profiles/<profile>/node_modules/dsh-plugin-wallpaper-engine → 工作区`），
  所以"文件已经是新的"不代表"内存里是新的" —— 值得核对的是**加载时刻**，不是文件内容。
- **面板那行「实时渲染失败（…）已自动回退」来自持久化的失败记忆**（`config.json` 的
  `settings.sceneLiveFailures`），与"这次到底有没有出帧"无关。换管线（新 bundle / 宿主开始给出
  场景媒体源）后客户端会**自动作废一次**（见 [`CHANGELOG.md`](./CHANGELOG.md)），旧版本的记忆则要
  重开一次「场景实时渲染」开关才清。

### 安装失败：`ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`

`dsh plugin --profile web add ...` 会把命令转发给 **pnpm**。如果你遇到下面的错误：

```text
[ERR_PNPM_UNEXPECTED_VIRTUAL_STORE] Unexpected virtual store location
dsh: pnpm failed in profile directory C:\Users\xxx\.dsh-desktop\profiles\web
```

**这不是插件本身的问题**（换任何一个插件安装都会失败），而是该 profile 目录的 pnpm 依赖状态失效了：
pnpm 在 `node_modules\.modules.yaml` 里记录了安装时的虚拟存储位置（绝对路径），一旦 profile 目录被
**移动 / 复制 / 备份恢复**过，或 pnpm 版本 / `virtual-store-dir` 配置发生变化，记录值与当前路径不一致，
pnpm 就会拒绝继续安装任何插件。

**修复（Windows PowerShell）：**

```powershell
# 1) 先退出 DSH 桌面端
# 2) 删除该 profile 的依赖目录（只删 node_modules 即可，配置/已装插件名不会丢）
Remove-Item "$env:USERPROFILE\.dsh-desktop\profiles\web\node_modules" -Recurse -Force
# 3) 重新安装本插件
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> 只删除 `node_modules\.modules.yaml` 一个文件也能修复（pnpm 会自动重建并继续），删除整个
> `node_modules` 更彻底。如果 `.dsh-desktop` 被 OneDrive / 云同步 / 迁移工具动过，建议把它加入同步排除，避免复发。

### 安装失败：`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

```text
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] ... The git-hosted package "dsh-plugin-wallpaper-engine@0.6.8"
needs to execute build scripts but is not in the "allowBuilds" allowlist.
```

**说明你用了 `github:` 形式的安装命令**（例如 `dsh plugin --profile web add github:elysia395/dsh-wallpaper-engine`）。
从 v1.4 起，客户端产物 `lib/client.js` **不入库**、安装期也**不跑任何构建脚本**（pnpm 11 出于供应链
安全默认拒绝 git 依赖的构建脚本）——因此 `github:` 直装拿不到客户端半边，不受支持。请改用
**npm 包名**安装（发布包在打包时已构建好产物，无需安装时编译）：

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> 如果你的插件中心（dsh-plugin-hub）生成的是 `github:` 命令，请把它升级到 **v1.4.1+**——新版会自动反查
> npm 包名并切到 npm 通道。

### 安装失败：`generation peer validation failed: @deepseek-ai/dsh-client-runtime does not resolve`

```text
generation-install: installed in 436ms
generation-install: generation peer validation failed: @deepseek-ai/dsh-client-runtime does not resolve from the installation closure
```

**说明宿主（DSH 核心）早于本插件的实测下限**。本插件声明的下限是
`engines.dsh >= 0.1.5-rc.1` 与 `@deepseek-ai/dsh-client-runtime >= 0.1.5-rc.1`
（`package.json` 的 `engines` / `peerDependencies`，实测下限 = 内核 **0.1.5**），而你的内核比
**0.1.5-rc.1** 还旧（例如 `0.1.2-rc.1` / DSH Desktop 2.0.5）—— 它带进安装闭包的 runtime
不满足版本下限，pnpm 在生成依赖图时直接拒绝。这不是网络 / 镜像 / pnpm 状态问题，
**装旧版插件也救不了**：早于 0.1.5-rc.1 的内核不在实测支持范围内，降级 peer 范围只会让
插件装上之后大面积不可用。

**修复：先升级宿主，再装插件**（两步都要做）：

```sh
# 1) 把 DSH 内核更到 >= 0.1.5-rc.1（官方桌面端更到最新即可；旧 DSH Desktop 线至少 2.0.7）
#    自查：dsh --version 应 >= 0.1.5-rc.1
dsh --version
# 2) 重新安装
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

> 「桌面端显示 v0.10.0」是**应用**自己的版本号，与它打包的 **DSH 核心**版本不是一回事 ——
> 判据以 `dsh --version` 为准（issue #116 里 v0.10.0 桌面端打包的是 0.1.7-rc.2 核心；该内核
> 现已满足 ≥ 0.1.5-rc.1，可以安装本插件）。

### 症状 → 先看哪里

| 症状 | 先检查 |
|---|---|
| 面板上出现「宿主里没有字体集路由…」「宿主里没有本机字体路由…」或「宿主返回 404 / 405」 | 宿主是旧的：**宿主端代码只在启动时加载**，刷新页面只换前端 bundle。**重启 DSH**（`dsh web` 重开 / 桌面端退出再进）即可。自查两步：① `~/.dsh-wallpaper-engine/build-stamp.json` 的 `at` 必须晚于 `lib/index.js` 的 mtime；② `diag/http.jsonl` 里搜 `fontsets` / `system-fonts` —— **0 命中**说明请求根本没到插件（那种"裸状态码"只可能来自别的层） |
| 选了「默认字体 / 终端字体」里的某个本机字体，**一点变化都没有**（特殊文字照旧是口） | 先看那一行的状态说明：写着「已略过 N 个本浏览器取不到的字体名」说明有名字被筛掉了 —— **系统列出的族名不等于浏览器能匹配的族名**（`Apple Color Emoji` / `Symbol` / `Zapf Dingbats` / `Apple Braille` 这类系统保留字体，以及 `苹方-繁` / `黑体-繁` 这种「同一字体的另一种写法」）。TC/HK 那些变体请用**规范名**选（`PingFang TC` / `Heiti TC` 都在）。若换成能匹配的名字后**个别字符**仍是口：那是**没有任何已装字体覆盖那个码位**（换字体解决不了），把具体字符贴出来即可定位（Nerd Font 图标另有一类成因：字体是 v3 码位、内容写的是 v2 码位） |
| 侧栏那个"控制台 / 终端面板"的字体改不动（图标还是口） | 那个面板是 `dsh-ssh` 的 **xterm**，字体**只从选项来**，普通 CSS 规则改不动它 —— 我们通过它给皮肤留的 `--dsh-ssh-terminal-font` 钩子投递（「终端字体」那一行一处管两个终端：对话里的终端块 + 这个面板）。自查：① 刷新页面后**重开一次终端面板**（它在构造 / 重挂时才重新解析字体）；② 若在 `dsh-ssh` 自己的设置里填过 `terminalFontFamily`，**那个值优先级更高**，清掉它我们的钩子才生效；③ 打开 DevTools 看 `body` 上有没有 `--dsh-ssh-terminal-font`（没有说明字体自定义总开关关着，或那一行选的是「跟随」） |
| 下拉里找不到自己认识的字体（如 `PingFang SC` / `Heiti SC` / `Songti SC`），只看到「苹方-简」这类中文名 | macOS 上**同一个字体有两个名字**：`system_profiler` 给的是本地化名，插件的第二条腿（CoreText）会给规范英文名，两者都进清单 —— 先在列表里搜英文名（原生下拉支持首字母跳转：打 `Pin` 跳到 `PingFang SC`）。若英文名确实没有，多半是 CoreText 那条腿（`osascript`）被挡或缺失，点一次「重新扫描」并把 `~/.dsh-wallpaper-engine/system-fonts.json` 里的 `source` 一起反馈（正常是 `system_profiler+coretext`，只有 `system_profiler` 说明第二条腿没通） |
| 「默认字体 / 终端字体」的下拉里没有本机字体（只有内置那几个） | 三种成因，面板上都有话说：① 写着「正在读取本机字体…」= 第一次扫描还在跑（macOS 要遍历全部字体，**秒级到十秒级**，之后走缓存）；② 写着「本机字体读不到：…」= 按那句话查（多半是上一条"宿主没重挂"）；③ 只显示内置族键且**没有任何提示** = 系统里确实一个都没读到。装了新字体时点那一行的「重新扫描」（**跳过缓存**重扫，不必等一周 TTL） |
| 本机字体清单写着「是按文件名推测的」 | 三条权威来源（macOS `system_profiler` / Windows PowerShell / Linux `fc-list`）都没拿到，退回**按字体文件名推**。清单能用，但名字可能带字重后缀（如「STHeiti Light」）——修好上一条那个工具的可用性后再点「重新扫描」即可拿到权威族名 |
| 设置面板突然空白 / 整块界面白掉 | 先搜客户端异常留痕：`client-error`（消息 + 栈前三行都在同一行诊断里）。已知一类是 **React #31**（对象数组被当成子节点渲染）；拿到 `client-error` 原文就能定位到具体行 |
| 确认一次（删除/隐藏之类）之后壁纸停住、输入框也没反应 | 原生 `confirm` 把焦点交给它自己的窗口 ⇒ 开着「窗口失焦时暂停」时壁纸会停；模态期间渲染线程被同步阻塞，而回来时的 `focus` 事件不保证送达（旧版本上只能重载）。遮挡判定每 3 s 低频复核一次并留 `occlusion-recheck` 行（丢事件也能自愈），字体集的删除也改成了面板内确认。旧版本上先点一下窗口或切走再切回 |
| 选择壁纸后的库视图是空的 | WE 是否装好并下载过壁纸；重启一次 `dsh web`（详见 [`../README.beginner.md`](../README.beginner.md) FAQ 1）。重启后仍为空就查**安装目录有没有被认出来**：`GET /wallpaper-engine/inventory` 的 `installDir` 为 `null` = 没认到安装 —— 1.3.1 起同时认**经典布局**（顶层 `wallpaper32.exe`）与**当前版本的布局**（exe 在 `distribution\` 子目录里），旧版本只认顶层 exe ⇒ 遇到新布局会看到**空库而不是报错**。确认装好却仍是 `null` 时，用环境变量 `DSH_WE_STEAM_ROOT` 指到**含 `steamapps\` 的那一层**（Steam 根，不是 WE 安装夹）强制指定，再重启宿主 |
| 最小化 / 还原窗口时闪一整块白（默认暗化下偏浅灰），任务栏缩略图也是白的 | 露出来的是**窗口底板**。**当前分支**：壁纸激活期间根元素带一层不透明的壁纸代表色（画面主色 → 作者配色，`--we-wallpaper-underlay`），掉层从「白闪」降级成「同色底」；恢复可见时另做一次两帧的复合成微推。若**仍是纯白**（连底色都没有），说明窗口那一刻**一帧都没提交** —— 那是壳侧底板（win32 的 `BrowserWindow` 未设透明 `backgroundColor`），插件侧改不动，请附诊断里的 `onscreen` 行反馈 |
| 视频壁纸黑屏 / 冻在首帧 | 卡片上的播放按钮与提示文案：显示「播放」即未真正播放，点它重试；提示无法解码则换 **H.264** 编码的 MP4 |
| 网页（Web）壁纸一片空白 / 只剩底色 | 网页壁纸默认走**实时渲染**（渲染页加载 `/scene-live/`，子资源经 `/scene-files/<token>/…` 取回）。**先刷新页面**；仍是空白就重启一次 `dsh web`（宿主端路由在插件加载时注册）。若怀疑是实时渲染路径的问题，可在「效果」页签关掉「**网页实时渲染**」验证**兼容路径**（`/wallpaper-engine/media/<token>` —— 退回普通 iframe 加载同一份入口 HTML）。两种路径下都用 DevTools 看 Network：子资源应当 200，出现 404/403 请附上该请求路径反馈 |
| 手选「适配目标」之后网页壁纸变黑 / 403 | 「系统 → 高级 → 适配」的手选**优先于检测**：若把它选成「原生浏览器」而实际跑在带能力头栅栏的桌面端，网页壁纸载荷会改走应用源、被栅栏拒成 `403`。改回「自动检测」（或任一桌面目标）即恢复；该段的状态行会写明「检测到：…」，手选与检测冲突时还会直接给出这条警示 |
| 自己上传的壁纸看不到 | 库视图上方的**内容分级**筛选（默认 Everyone；未标注分级的自上传内容按 Everyone 处理） |
| 场景壁纸是静止画面 | **默认不该如此** —— 场景壁纸默认由 WebWallGL **实时渲染**（粒子 / 脚本 / 视差都会动）。先看「播放」→「效果」的「**场景实时渲染**」是否被关掉、以及开关下方是否显示失败原因（首帧超时 / 运行中断）：重开该开关会清空失败记忆并重试。只有实时渲染不可用时才会走「作者内嵌 MP4 → 实时抓帧 → 自定义画面 → 空态」这条链（首帧前先垫**作者的预览图**，不会黑屏）；不支持 WebGL2 的浏览器**必然**走那条链（**松散 `scene.json` 目录不在此列** —— 它同样实时渲染）—— 那种情况可用「出图来源」换一种出图方式，或导入「自定义画面」（见 [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md)） |
| 场景 / 网页壁纸黑屏，约 15 秒后跳成静态帧（或只剩垫底画面） | 这是实时渲染的**看护降级**：首帧超时 ⇒ 降级（并按原因决定要不要记入失败记忆，见下）。先确认能访问外网/磁盘读取正常、显卡驱动可用（需要 WebGL2）；重开「场景实时渲染」/「网页实时渲染」开关可清空记忆重试。**首帧预算是按包大小放大的**：`15s + scene.pkg 体积 ÷ 8MB/s`（封顶 90s），而**传输还在进字节时一律不计超时**（宿主载荷账本 `GET /wallpaper-engine/scene-payload-progress?token=…`，客户端每秒问一次）—— 所以"大包在慢慢下"不会再被误判成"渲染不出来"。**首帧确实没出来时分两种**：① 账本说"传过但没传完"（下载停滞 / 被别的实例饿死）⇒ 只记**会话内**软失败，不写所有窗口共用的失败记忆，冷却 45s 后自动重试（每张至多 2 次）；② 渲染页真的不出帧或运行期失联 ⇒ 才按壁纸落盘失败记忆。**现行行为**：那条提取/合成链已整体删除，宿主**只在已有帧时才发图**（没有就 404 空态，**不生成、也不预热任何图**）；客户端首帧前垫的是**实时抓帧 → 作者的预览图 → 主题色**，所以**即使这张壁纸从来抓不到帧，首帧前也不是黑屏**。若仍长时间只有一块纯色，说明**连作者的预览图都没取到**（工程里没有 preview，或读取失败），请附上诊断行反馈 |
| 大场景壁纸（`scene.pkg` 上百 MB）反复「首帧超时」，但同一张图在别的窗口里 1–2 秒就出画面 | 典型的**载荷被饿死**。三条自查：① 是否同时开着**多个 DSH 窗口/标签页** —— 每个都是独立的客户端实例，各自会建自己的渲染页（现在**隐藏/未播放的实例不再拉载荷**，可见那个才拉）；② 「高级 → 适配」里 `GET /wallpaper-engine/media-origin` 是否**给得出地址** —— 场景载荷走独立媒体源是必须的（实测同一份 336MB 包：媒体源 0.6s，应用源 15–74s 甚至永不返回）；③ 诊断文件里 `liveFail` 那一行的 `载荷=` 字段：`"served":0,"completed":0` = 一个字节都没进来（传输根本没开始），`served>0 且 completed=0` = 传了但没传完（被饿死）。带上这两行反馈即可定位 |
| 帧率上限没效果 | 需要 ffmpeg（编码器优先 NVENC，无 N 卡时回落 libx264 软件编码）；拿不到 ffmpeg 时该功能自动关闭（见 `../README.md` 的「已知限制」） |
| 右栏关闭后，对话区右侧出现一块中灰 / 浅色板 | 右栏容器是「保留宽度、只隐藏子元素」，插件给该容器刷的玻璃底在关闭态也生效（`verify-host-paint-scope` 钉住）；临时办法：关掉「侧栏液态玻璃」总开关，或把该会话的右栏宽度拖到 0 |
| 设置改完重启又变回去 | 设置存宿主端文件（见下「设置存在哪」）—— 先确认 `~/.dsh-wallpaper-engine/config.json` 可写、且没有回退到旧版本。若宿主日志里出现「settings PUT 丢弃了白名单外的键」，说明客户端与宿主的字段清单不一致，附上该行反馈即可定位 |

### 终端输出：默认只报问题

宿主输出分三档，档位名就是日志方法名：

| 档 | 判据 | 终端默认 |
|---|---|---|
| `error` | 会导致**插件 / DSH / 系统**出问题（核心能力起不来、数据或进程被破坏、需要用户处理） | ✅ |
| `warn` | **影响显示效果**的非正常表现（降级、回退、围栏拒绝、首帧超时、重试、被拒的请求） | ✅ |
| `info` | 其余全部（诊断细节、逐帧统计、运行信息、成功事实的日志侧留痕） | ❌ |

**终端默认只有前两档** —— 所以「壁纸黑屏」这类问题在终端上是安静的，档案照常记录。要看细节
（逐张贴图、心跳、autosize gate、准备期探测…）：

```powershell
# Windows PowerShell（只影响本次启动）
$env:DSH_WE_LOG_LEVEL = "info"; dsh web
```

```sh
# macOS / Linux
DSH_WE_LOG_LEVEL=info dsh web
```

取值 `error` / `warn` / `info`（默认 `warn`，非法值按默认走）。

排障仍首选**档案**通道（不受终端闸门影响、也不随终端关闭而消失）：

- `~/.dsh-wallpaper-engine/diag/http.jsonl` —— 请求记录、路径围栏、渲染页与客户端上报；到上限即轮转为
  `http.jsonl.1`（只留一代，目录占用有硬上界；阈值与行形状见 `lib/diag-trace.js` 的文件头）；
- `GET http://127.0.0.1:<端口>/wallpaper-engine/diag-log` —— 最近一批渲染页 / 客户端上报（环形上限与返回窗口见 `lib/routes/diag.js`）。

成功提示（「壁纸媒体源已监听」「场景壁纸已就绪」）走**另一条通道**：终端上的一行
`[wallpaper-engine] … ✔`（**与日志行同前缀**，`✔` 只标记"这是成功提示、不是问题"），不经日志、
不带级别、不落档。它只在 **stdout 是终端**时出现 —— DSH 桌面端的宿主由 Electron 以管道启动，
`isTTY` 为假 ⇒ 桌面端默认安静。桌面端要看提示就显式开：

```powershell
$env:DSH_WE_NOTICE = "1"   # 启动 DSH 前设置；设成 0 则永久静默（连提示投递失败的 warn 也不报）
```

---

## 已知行为边界（**不是 bug**，但很容易被当成 bug 报）

三条都是"**宁留旧画面，也不露底色**"这条取舍的必然代价，登记在这里是为了让"看起来卡了 / 闪了一下"
的现象有解释。三处的判据与读数见 `docs/CHANGELOG.md` 的「未发布」一节。

### 切到某张壁纸后"点了没反应"，屏上还是旧壁纸

切层内容闸门只在"新层**真的有画面**"或"这一级判失败"时放行。若媒体请求**挂住**（既不成功也不失败），
新层就一直待显影，屏上是旧壁纸 —— 用户看到的形态是"点了没反应 + 设置里显示的与屏上不是同一张"。

**现状**：视频档已有**有界**兜底 —— 每 `VIDEO_POSTER_BUDGET_MS` 复查一次（见 `src/video-layer.js`），
只有屏上真有东西才放行；到 `VIDEO_STALL_GIVE_UP_MS` 仍无画面就**继续留旧壁纸**，并在诊断档案里记一条
`video-stall` warn。**"超时后放行到主题色 / 底色"这条被明确否决** —— 那正是"纯色帧"那个 bug 的形态
（闸门在 `readyState = 0` 时被预算放行 ⇒ 用户盯着整块底色一两秒）。

### 页面刚加载后的第一张壁纸，会先有一小段底色

那时**没有旧层可守**，闸门压根没武装 ⇒ 首帧到位前屏上是层底色。实测（一次性，读数与条件见
`docs/CHANGELOG.md` 的「未发布」一节）：同一张 729MB 的 4K120 源，"刚加载后的第一张"这条路
`loadedmetadata` 只要一百多毫秒。

**现状（未做）**：做法是给视频档一个**真静帧**当门面（复用已有的抽帧路径），而不是等 `<video>` 的第一帧。

### 切到"网页壁纸（旧链）"时有一小段白 / 空

切层闸门认的是 `iframe.we-live-iframe` 的 `we-live-on`；裸 `iframe.we-iframe` 落在"不拦"那一档。

**现状（未做）**：这一档**可以覆盖** —— iframe 元素自己的 `load` / `error` 跨域也会触发（同一份代码在
`prepareWebProbe` 里就是这么用的），缺的只是把这两个信号接进闸门的信号表。
