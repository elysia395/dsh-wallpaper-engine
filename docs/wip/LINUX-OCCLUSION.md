# Linux 壳窗遮挡区域获取 → WebWallGL 降帧/暂停 —— 实施规格

<!-- status-banner: work-in-progress -->
> **状态：进行中 —— P0（X11 适配器）已落地（2026-10-12，见 §10），Wayland 与后续项未落地。** 本文按 [`docs/README.md`](../README.md) §目录的寿命规则只放
> **还没做成事实的东西**；做完即整体归档。
> **本文不是进度真源**：机制 → 实现文件头注释、判据 → `test/`、取舍 → [`adr/`](../adr/)。
>
> **范围**：仅 Linux 会话（X11 / Wayland）。Windows/macOS 数据通路不同，另行立项。
> **调研来源**：两份 light 代理调研报告（X11 线 / Wayland 线，2026 年，含一手文档引用与
> 本机实证），要点已吸收进本文 §3/§9/§10，原文结论以本文为准。

## 0. 背景与目标

壁纸是壳窗口内的 DOM 层（[`src/styles.js`](../../src/styles.js) 的 `.we-layer`，`fixed; inset:0;
z-index:-2`），不是独立 OS 窗口。目标：宿主侧获取「壳窗口之上有哪些窗口、各自矩形」，换算成
壁纸画布坐标喂给 vendored WebWallGL 渲染器既有的遮挡管线，实现**分档降帧（heavy/light）、
完全遮挡暂停（pause）**与 ROI 剔除，省 GPU/CPU/电池。

Chromium 在 Linux **没有**原生窗口遮挡追踪（其 WindowOcclusionTracker 文档明说
"On non-Windows platforms, this does nothing"），`document.visibilityState` 只反映显隐/最小化
⇒ 必须自建生产端。

## 1. 消费端契约（WebWallGL 2.1.0，vendored pin `4ba71c40`）

渲染页控制器（bundle 内含 `setOcclusion` 方法的那个对象）提供：

```js
setOcclusion({
  occluders: [[x, y, w, h], ...] | null, // 画布本地 CSS px；null = 清除、回 run
  ratio?: number,                        // 可见率；缺省时按矩形并集面积自算
  epoch: string,                         // 数据源标识；变更 → 重置迟滞状态机
  gen: number,                           // 单调递增；回退视为过期数据
});
```

渲染器内部行为（生产端必须遵守的硬约束）：

1. **四档调频**：可见率 → `pause`(≤0.05，全停含 `<video>`) / `heavy`(≤0.3 → 24fps) /
   `light`(≤0.7 → 40fps) / `run`(sceneFps)；迟滞 0.05、驻留 400ms（bundle 默认 `occlusionCfg`）。
2. **3 秒过期**：数据超过 3s 未更新，渲染器自动重置回 run ⇒ **推送节律必须 ≤3s**
   （设计：事件驱动 + 1Hz 心跳兜底）。
3. **矩形不只调帧**：`rects` 同时进 ROI 剔除 ⇒ 喂精确矩形能省真实 GPU 绘制，不要只喂 ratio。
4. 阈值等由渲染器 `occlusionCfg` 管，生产端不复制数值。

### 锚点定位法（防上游同步漂移）

bundle 是压缩产物，符号名（`me`/`Qb` 等）会随上游同步变化。定位改点**只用行为锚点**，且
守卫测试只做行为断言、不引用压缩符号名。pin `4ba71c40` 版本下的两个已知锚点：

- 控制器创建点：`const me=Xb({fullscreen:!0})`（全 bundle 唯一）；
- 遮挡入口：`setOcclusion(t){const e=me.occlusion?.band`（控制器方法体开头）。

上游 `webwallgl` 升级后（版本真源 = `package.json` 的 `dependencies.webwallgl`；引擎已从 vendored
副本改为 npm 运行期依赖）必须重新定位锚点并复验 §8 验收。

## 2. 数据通路总览

```
[lib/occlusion] OcclusionHub（Node，插件宿主进程）
   会话判定 → 适配器(X11) → 事件驱动 + 1Hz 心跳 → 快照
        ↓  HTTP 轮询（沿插件既有 client↔host 模式）
[lib/routes/occlusion.js]  GET /wallpaper-engine/occlusion
        ↓  1Hz 轮询（仅 live 层挂载且页面可见时）
[src/occlusion.js] 像素→CSS 换算 → postMessage 进 .we-live-iframe
        ↓  {__weLive:1, op:'setOcclusion'|'clearOcclusion', …}
[lib/webwallgl/occlusion-bridge.js]（scene-live 页内注入脚本）
        ↓  window.__weSetOcclusion(payload)
渲染器遮挡管线（§1）→ run/light/heavy/pause + ROI
```

## 3. 生产端 OcclusionHub（新目录 `lib/occlusion/`）

### 3.1 文件布局

| 文件 | 职责 |
| --- | --- |
| `index.js` | Hub：会话判定、适配器装载、快照组装、epoch/gen 管理、1Hz 心跳、失联降级 |
| `rects.js` | 纯矩形运算：裁剪到自窗、矩形差集（自底向上扣减）、并集面积、合并；无 IO，可单测 |
| `x11.js` | X11 适配器（本轮唯一后端，见 §3.3） |

### 3.2 快照 schema（hub → 路由 → client 的唯一契约）

```jsonc
{
  "ok": 1,
  "backend": "x11",            // "none" = 无后端可用（含非 Linux / 连接失败）
  "epoch": "x11::display=:1",  // 稳定的数据源标识；适配器重连不变，换后端才变
  "gen": 42,                   // 快照序号，每次矩形内容可能变化 +1
  "own": { "w": 1280, "h": 800 },   // 壳窗内容区尺寸（物理/逻辑像素，同 rects 口径）
  "rects": [[x, y, w, h]],     // 自窗内容区左上角为原点的遮挡矩形（像素口径同 own）
  "ts": 1760000000000
}
```

无数据/降级：`backend:"none"` 且 `rects:null`（client 收到即下发 clearOcclusion）。
**坐标口径**：X11 是全局物理像素；Wayland 后端（后续）是逻辑像素。client 用
`innerWidth / own.w` 推 scale 换算成 CSS px——**hub 不依赖任何 Electron API**（插件宿主
是纯 Node 上下文，拿不到 BrowserWindow/screen）。

### 3.3 X11 适配器（本轮 P0）

- **连接**：npm `x11`（纯 JS 协议客户端，可订阅事件；加入 dependencies）连 `DISPLAY`；
- **自窗定位**：遍历客户窗匹配 `_NET_WM_PID === process.pid`（插件宿主与壳同进程）；
  找不到时再按 WM_CLASS/标题二次匹配；两级都失败 ⇒ `backend:"none"`；
- **堆叠序**：根窗口属性 `_NET_CLIENT_LIST_STACKING`（EWMH §3.2，自底向上；override-redirect
  窗不在其中——瞬态小窗漏判方向安全）；
- **过滤**：`map_state === IsViewable`、无 `override_redirect`、非自身 XID、无
  `_NET_WM_STATE_HIDDEN`；几何用 `GetGeometry`+`TranslateCoordinates` 转全局坐标，
  `_NET_FRAME_EXTENTS` 修正 frame；
- **计算**：只取与自窗相交的矩形，按堆叠序自底向上做矩形差集（`rects.js`），得到自窗的
  **可见区域**；`occluders = 自窗全幅 ∖ 可见区域`（或等价地直接推可见率与补集矩形）；
- **节律**：订阅根窗 `PropertyNotify(_NET_CLIENT_LIST_STACKING)` + `ConfigureNotify` 事件
  （按 `send_event` 标志过滤伪造），触发即重算；另有 1Hz 心跳兜底轮询；
- **降级**：连接失败 / X11 不可用 ⇒ `backend:"none"`，**绝不抛错影响宿主**（全入口 try/catch）。

## 4. 宿主路由（`lib/routes/occlusion.js`）

- `GET /wallpaper-engine/occlusion` → 快照 JSON（鉴权、JSON 响应族沿
  [`packages/media-bridge/lib/routes/now-playing.js`](../../packages/media-bridge/lib/routes/now-playing.js)
  等同族路由先例；
  `lib/json-response.js` 工具）；
- 加路由后**必须**跑 `node test/tools/host-route-index.mjs --write` 重算
  [`docs/ROUTE-INDEX.md`](../ROUTE-INDEX.md)（`verify-route-index` 会机检）。

## 5. 渲染页桥（`lib/webwallgl/`，两处改动）

1. **渲染页曝光**：引擎改为 npm 依赖 `webwallgl` 后，渲染页是本仓的
   [`lib/webwallgl/renderer.js`](../../lib/webwallgl/renderer.js)，在其中定义
   `window.__weSetOcclusion = (payload) => inst.setOcclusion(payload ?? null)`（带 try/catch）。
   不再改任何上游产物，也不再需要同步后重放打点。
   （原方案：在 vendored bundle 的 §1 控制器创建锚点后追加一行曝光，由 `sync-webwallgl` 同步后重放。）
2. **新文件 `lib/webwallgl/occlusion-bridge.js`**：监听 `window message`，只认
   `e.source === window.parent` 且 `e.data.__weLive === 1`：
   - `op:'setOcclusion'` → 校验 `payload.occluders` 为数组后调 `window.__weSetOcclusion`；
   - `op:'clearOcclusion'` → 调 `__weSetOcclusion(null)`；
   - `window.__weSetOcclusion` 未就绪时静默丢弃（渲染器晚启动是正常态）。
3. **注入**：[`lib/routes/scene-serve.js`](../../lib/routes/scene-serve.js) 响应
   `/scene-live/index.html`（现状 no-store）时注入
   `<script src="<BASE>/scene-live/occlusion-bridge.js"></script>`，注入方式沿该文件既有的
   shim 注入先例；桥文件经 `WEBWALLGL_DIR` 围栏天然可服务。

## 6. 客户端（`src/`，构建产物 `lib/client.js`）

- 新文件 `src/occlusion.js`：
  - **轮询**：1Hz `GET /wallpaper-engine/occlusion`（走既有 api-client 鉴权通道）；
    仅当 live 层挂载且 `!document.hidden` 时轮询，其余时候停；
  - **变换**：`scale = innerWidth / own.w`（防御 0/NaN），`occluders = rects.map(r => r*scale)`；
  - **下发**：`postMessage` 到 `.we-live-iframe.contentWindow`，消息形
    `{__weLive:1, op:'setOcclusion', payload:{occluders, epoch, gen}}`；`rects:null` 或轮询
    连续失败 ⇒ `op:'clearOcclusion'`；
  - 挂载/卸载 live 层时启停轮询（挂进 [`src/live-layer.js`](../../src/live-layer.js) 既有
    生命周期，改动最小化）。

## 7. 并行分工与文件所有权（本轮，三个代理 + 集成人）

| 代理 | 独占文件域 | 交付 |
| --- | --- | --- |
| A | `lib/occlusion/**`、`lib/routes/occlusion.js`、`package.json`、`docs/ROUTE-INDEX.md`(工具)、`test/verify-occlusion-hub.mjs` | hub + rects 单测 + X11 适配器 + 路由 + 依赖 + verify 接线 |
| B | `lib/webwallgl/**`、`lib/routes/scene-serve.js`、`test/verify-scene-live-occlusion.mjs` | bundle 曝光 + 桥 + HTML 注入 + 注入机检 |
| C | `src/**`、`lib/client.js`(构建产物)、`test/verify-occlusion-client.mjs` | 轮询/变换/下发 + 生命周期挂钩 + 机检 |

**红线**：任何人不得跑 git 写命令；不得碰 `patches/`、`_refs/`、他人文件域；C 不改
`package.json`（其 verify 接线由集成人完成）；改动不提交，留会话主控验收。

## 8. 验收清单（DoD）

1. `npm run build` 成功；`node test/verify-occlusion-hub.mjs` /
   `verify-scene-live-occlusion.mjs` / `verify-occlusion-client.mjs` 全过；
2. `npm run verify` 全绿（现 40 项零回归）；`npm run verify:docs` 无新增告警；
3. `rects.js` 单测覆盖：裁剪、自底向上差集、多矩形、退化（空/全遮/零面积）；
4. scene-serve 注入机检：真实请求 `/scene-live/index.html` 含桥 script（沿
   `test/verify-scene-live.mjs` Level E 真实请求模式）；
5. X11 真机手动 QA（本机 `DISPLAY=:1` 可用）：开壁纸 → 拖窗覆盖半屏 ⇒ 日志见 heavy/light
   降帧；全屏覆盖 ⇒ 暂停；移开 ⇒ 恢复；`?resources=` 诊断行可见 band。

### 8.1 实例拉起与真机 QA（已查证，2026-10-11，父仓 dsh-my-ui @ main）

插件被父仓 `dsh-my-ui`（Electron 发行版）引用，真机验证必须按下述**已核实**链路拉起，
`DSH_HOME` 只允许 `~/.dsh-dev`（开发隔离家），不得触碰在跑的 `/opt` 打包版（其用 `~/.dsh`）：

1. **装载链**（证据：`dsh-my-ui/scripts/prepare-dependencies.mjs` 头注释、`src/first-run.js`
   `BUNDLED_PLUGINS`、`src/main.js:313`）：
   - `postinstall` 把 `custom-plugins/<name>`（按插件自身 `files` 清单）**拷贝**为
     `dsh-my-ui/node_modules/<name>` 真实目录——运行时**不读**源码树；
   - dsh 0.2.0 `resolveBundleDir` **安装锚优先**：插件实际从 app 的 `node_modules` 拷贝加载；
   - `ensureBundledProfile({ force: app.isPackaged })`：开发态 **不** 强制重写 profile；
     `~/.dsh-dev/profiles/web/package.json` 的 `dsh.profile.bundles` **已含**
     `dsh-plugin-wallpaper-engine`，无需任何接线动作。
2. **修改插件后的刷新**（本仓库改动 → 可测）：在 `dsh-my-ui` 根目录跑
   `node scripts/prepare-dependencies.mjs` 重新物化 `node_modules` 拷贝，然后重启实例
   （patchReload 已随 0.2.0 移除，别指望热载）。
3. **拉起**：`cd dsh-my-ui && npm start`；未打包运行时 `src/main.js:73-74` 自动设
   `DSH_HOME=~/.dsh-dev`（显式 `DSH_HOME=~/.dsh-dev npm start` 亦可，**禁止**指向其他路径）。
   与打包版 userData/DSH_HOME 双重隔离，可并存。
4. **自动化 QA 钩子**：`npm start -- --remote-debugging-port=9333`（官方 smoke 脚本同款，
   见 `scripts/smoke-*.mjs` 头注释），CDP 连入后可在页面上下文 `fetch('/wallpaper-engine/occlusion')`
   读快照、读渲染器 `getOcclusion()` 的 band；遮挡源用 `xdotool` 拖动覆盖窗制造。
   单实例纪律：同一时刻只跑一个 dev 实例。

## 9. 后续（本轮不做，降级矩阵）

| 会话 | 主路线 | 备用 | 最后 |
| --- | --- | --- | --- |
| X11 | 本轮 §3.3 | CLI 解析轮询（xwininfo/xprop） | 最小化二值 |
| sway/i3、Hyprland、niri | socket/stdio IPC（逻辑坐标，零特权） | portal 像素差 | 二值 |
| KDE Wayland | KWin 脚本 `callDBus` → 宿主 D-Bus 服务（勿走 plasma-window-management，被 plasmashell 独占） | portal 像素差 | 二值 |
| GNOME Wayland | Shell 扩展 `get_frame_rect` + D-Bus 导出 | portal 像素差（`restore_token`） | 二值 |
| river/COSMIC/未知 | portal ScreenCast 像素差 | — | 二值 |

⚠️ Wayland 会话**禁止**走 X11/xwininfo（XWayland 隔离，看不见原生 Wayland 窗口，漏判=白渲染）。

## 10. 实施状态（P0 已落地，2026-10-12）

全部文件已就位且机检绿：hub 18 项、client 12 项、bridge/scene-serve 30 项、路由索引含
`/occlusion`、client-sync 4 项。**本轮未做任何 git 提交**（集成约定）。

### 10.1 与规格的偏差（均已验证为正确方向）

| 规格原设 | 实际落地 | 原因 |
| --- | --- | --- |
| §3.3 宿主端做遮挡矩形差集 | 宿主直发**裁剪后 occluders**，可见区由渲染器自算 | 渲染器 bundle 内部即做差集+占比，宿主重复计算无收益 |
| `me = Xb({...})` 即控制器 | 控制器是 **`window.__wp`** 包装对象 | bundle 混淆后 `me` 非导出名；`window.__wp={…}` 字面量后才可注入 |
| 客户端同内容抑制下发 | **每拍必发**（无抑制） | 渲染器 >3s 未收到快照会自动回 run，抑制会造成饥饿（已实测复现） |
| 「自家」= `process.pid` 的窗 | 候选集 **`[process.pid, process.ppid]`** | 插件跑在 runtime utility 子进程，BrowserWindow 属于 Electron 主进程（QA 实测 own:null 后定位） |
| — | `createX11Adapter({ownPid})` 可注入 | 供探针/测试在无窗进程里伪造宿主归属 |

### 10.2 观测点（QA 契约：三层日志）

1. **生产端结果**：hub 快照内容变化即打一行（1Hz 心跳不刷屏）：
   `[occlusion] snapshot gen=N own=WxH rects=K visible=0.xx epoch=x11::display=…`
   并经 `appendDiagLine` 落**诊断档案**：`~/.dsh-wallpaper-engine/diag/http.jsonl`
   （`kind:"occlusion"`，`ev:"snapshot"|"degrade"|"get"`，带轮转）——utility 子进程的
   console 在本架构不回终端，**档案是宿主侧唯一可靠落点**（QA 实测确认）。
2. **插件响应**：`DSH_WE_OCCLUSION_TRACE=1` 时路由逐请求打一行并同落档案
   （`ev:"get"`：gen/backend/rects/ms）；默认关。
3. **WebWallGL 分档结果**：客户端 op 切换经 `liveLog` 落同一档案
   （`kind:"renderer"`，`[we-live …] occlusion · op=setOcclusion gen=N rects=K`）；
   渲染器侧用 CDP 读 `window.__wp.getOcclusion()`（band/ratio/gridCoverage）。
   实测时序：注入近全遮后 **1–2s 进入 `pause`**；**停止喂给 3s 后渲染器自动回 run**
   （`getOcclusion()→null`）——规格"客户端必须每拍下发"的契约被实测印证。

### 10.3 实机运行的两个运维事实（本次踩坑实录）

- **profile 锚点遮蔽**：`~/.dsh-dev/profiles/web/node_modules/dsh-plugin-wallpaper-engine`
  若是**实体目录**（旧拷贝），会以更高优先级遮蔽 app 侧新拷贝（installation-anchor-first）。
  正确形态是指向 app 拷贝的**符号链接**（`ensureBundledPluginLinks` 仅 force 时重建，
  dev 永不 force）。修复：`ln -s <app>/node_modules/dsh-plugin-wallpaper-engine ~/.dsh-dev/profiles/web/node_modules/`。
- **插件运行时依赖解析**：物化拷贝不带 node_modules，`import('x11')` 在实例内解析不到 →
  hub 按设计降级 `backend:none`（不崩）。开发机以 `npm install --no-save x11` 装进 app
  node_modules（不动父仓 manifest/lock，重装依赖后需补装）。
  **分发决策（已定，2026-10-12）**：x11 作为插件正式依赖随 npm 包分发——用户侧由 dsh
  插件管理器的 profile pnpm 安装（x11@4.3.1 纯 JS/零依赖/无安装脚本，win/mac 也会装
  但永不 import，死重 5.2MB，可接受）；解析不到即优雅降级。曾评估 os 门控壳包方案
  （`optionalDependencies` + 排除 win32/darwin 的壳），按"零维护优先"否决。
  `test/verify-scene-live-occlusion.mjs` 因加载真实
  `lib/index.js` 会拉起 hub 连真 X11，结尾已 `process.exit(0)` 兜底（dispose 有异步竞态）。
- **归属候选集**：插件宿主是 runtime utility 子进程（`--expose-internals`），窗口属于
  Electron 主进程 ⇒ own 判定用候选集 `[process.pid, process.ppid]`（§3 的
  "`_NET_WM_PID === process.pid`"按此修正）。

### 10.4 事故修复：全遮挡误判"载荷传输未完成"并自动回退（2026-10-12）

**现象**：全遮挡下轮播换页，弹"实时渲染失败（载荷传输未完成（下载停滞））"并回退静态；
/opt 正式实例（无遮挡功能）全遮挡偶发同类软失败（Chromium 冻结遮挡页 rAF 的形态）。

**根因**：`isEffectivelyPlaying()` 只感知 标签页隐藏/失焦/电池 三个暂停源；"被完全
覆盖"（渲染器遮挡 pause 档 / Chromium rAF 冻结）不在其中 ⇒ 看护把"故意暂停"当无帧
故障计数 ⇒ 首帧预算耗尽归因 transfer（软失败回退）或运行期 stall（40s）。轮播换页时
`liveFrameShouldDefer()` 同源失真，全遮挡下仍拉整包（违反"隐藏的实例不该拉 300MB"
的既有延迟纪律）。

**修复**：`src/occlusion.js` 维护渲染器 pause 档的客户端镜像 `occlusionRendererPaused()`
（可见率 ≤0.05，面积直和口径，重叠只偏保守不漏判）；`isEffectivelyPlaying()` 与
`livePauseReason()` 接入（新文案"窗口被完全遮挡(pauseOnOcclusion)"，i18n 已补）。效果：
全遮挡下轮播换页 → 载荷延迟（垫底图在位，揭开后 ≤1s 自动补加载）；运行期遮挡 →
暂停期豁免计数，揭开即恢复。**注**：/opt 在遮挡功能进版前，其"Chromium 冻结 rAF"
形态只能靠软失败+重试兜底（既有设计），本修复随遮挡功能一并根治。

### 10.5 三评审代理修复记录（2026-10-12，22 项：1 P0 + 3 P1 + 18 P2）

**生产端（P0×1 + P1×3 + P2×4，全部实锤并修复）**
- **P0** `x11.js`：X 客户端未挂 'error' 监听 —— x11@4.3.1 对每个错误应答都会额外
  `emit('error')`（调用回调返回 falsy 即触发），遍历 stacking 时窗口销毁的 BadWindow
  是常态触发面 ⇒ ERR_UNHANDLED_ERROR 崩掉宿主 utility 进程（dsh 运行时无全局兜底，
  已核实）。修复：start 挂吞错监听、stop 同步移除；单次调用失败仍走 Promise rejection
  → hub 降级。
- **P1** `index.js`：重试循环死代码 —— `started` 置位后永不复位，重试回调被 start
  首行守卫弹回 ⇒ 降级后永不恢复（评审以假适配器复现）。修复：scheduleAdapterRestart
  复位 `started=false`；新增 B7 重试恢复回归钉。
- **P1** `x11.js`：根窗未选事件掩码 ⇒ 事件触发重算整条死功能（只剩 1Hz 心跳）。
  修复：start 后 `ChangeWindowAttributes(root, PropertyChange|SubstructureNotify)`。
- **P1** `index.js`：断连时 poll 的 Promise 永不结算 ⇒ busy 卡死、hub 静默冻结。
  修复：`pollTimeoutMs`（默认 3s）看门狗包住 adapter.poll()，超时走降级路径；新增 B8。
- **P2** rects 角触合并虚报面积（修复判据：一轴真重叠 + 另一轴相触；新增 A6 负对照）；
  log 回调未包 try/catch（safeLog 统一包裹）；getSnapshot 返回活引用（改拷贝，B9）；
  busy/合并窗丢事件无 trailing（dirty 标志 + finally 补算）。

**宿主集成（P2×8 全实锤修复）**：trace 分支 log 无守卫（traceLog/traceDiag 对称守卫）、
405 零留痕（trace 下补 `ev:'405'`）、头注释族比对失实（改写）、`appendDiagLine` 轮转
ENOENT 后诊断通道静默死亡（existsSync 短路 + 按新文件从零计）、dispose 竞态出假
start-failed（start 后补 disposed 复查）、**路由 handler 无运行时测试**（新增 E1-E4：
200/no-store/逐字直发、405+Allow、trace 双分支、缺省安全）、F1 地板计数失真
（改判据总数）、trace 开关注册时快照（handler 内现读，对齐 log.js 约定）。

**客户端与桥（P2×7 全实锤修复）**：inflight 门闩无超时会永久饿死心跳（apiJson 传
`AbortSignal.timeout(2000)`，超时按失败走退避；AbortSignal 缺失环境退化无超时）；
`occlusionLastOp` 跨会话残留（stop 复位）；`backend==='x11'` 硬编码（解耦，own/rects
为实质判据）；旧 tick 投旧帧（帧身份校验 `frame !== occlusionFrame`，新增 B7b）；
失败期看护镜像不衰减（失败 ≥ 阈值置 false，对齐渲染器 3s 陈旧线）；桥 immutable+版本
键（改**桥内容 sha256 前 12 位**，改桥自动失效旧缓存）；sync-webwallgl 不重放曝光
打点（同步后自动重放，锚点缺失 exit 1）。

## 11. 调研引用（关键一手来源）

- EWMH 堆叠序/帧扩展：https://specifications.freedesktop.org/wm-spec/latest/ar01s03.html ·
  https://specifications.freedesktop.org/wm/latest-single/#_net_frame_extents
- XQueryTree/XGetWindowAttributes：https://man7.org/linux/man-pages/man3/XQueryTree.3.html ·
  https://man7.org/linux/man-pages/man3/XGetWindowAttributes.3.html
- npm x11：https://github.com/sidorares/node-x11
- Chromium 无 Linux 遮挡：https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/windows_native_window_occlusion_tracking.md
- sway IPC：https://man.archlinux.org/man/sway-ipc.7.en · Hyprland：https://wiki.hypr.land/ipc ·
  niri：https://github.com/niri-wm/niri/wiki/IPC
- KWin scripting：https://develop.kde.org/docs/plasma/kwin/api/ ·
  plasma-window-management 独占：https://wayland.app/protocols/kde-plasma-window-management
- GJS D-Bus 导出：https://gjs.guide/guides/gio/dbus.html ·
  get_frame_rect：https://gnome.pages.gitlab.gnome.org/mutter/meta/method.Window.get_frame_rect.html
- portal ScreenCast（restore_token）：https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html
- ext-foreign-toplevel-list-v1（无几何）：https://wayland.app/protocols/ext-foreign-toplevel-list-v1
- XWayland 隔离：https://wayland.freedesktop.org/docs/book/Xwayland.html ·
  Electron 平台选择：https://github.com/electron/electron/issues/48001
