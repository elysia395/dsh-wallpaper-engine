# 桌宠联动子包（pet-link）

把壁纸吉祥物变成**可联动的桌宠**：安装 [dsh-pet-dshwe](https://github.com/Fish-under-sea/dsh-pet-dshwe)（上游 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的全量 fork）后，点壁纸吉祥物触发四条演出——侧栏后拉、跳抓吉祥物绳子、踢开侧栏原生弹飞、站立哈气开栏；没装或关闭时一切照旧（原生侧栏操作）。本包只做**编排 + 安装 + 面板**：九段联动动画、五张气泡配图在这里；宠物运行时（渲染、物理、动画池、Electron helper）全在 `dsh-pet-dshwe`，本包不含也不改它。

## 快速开始

1. 安装本仓主包 `dsh-plugin-wallpaper-engine`（含 7 个子包）——见仓库根 [CONTRIBUTING.md](../../CONTRIBUTING.md) 的完整源码安装。
2. 打开壁纸引擎设置页，第一张卡片就是「桌宠联动」：
   - **未装运行时** → 点「下载并安装 dsh-pet-dshwe」（见下文安装事务）；
   - 装完**重开 DSH** 生效；
   - 把「联动开关」打开（默认开），点壁纸吉祥物或卡片上的「测试一次联动」。
3. 也可以手动安装：`dsh plugin --profile <profile> add dsh-pet-dshwe`，与官方 `dsh-pet` 可同机共存（互不接管，同时启用各显示一只）。

## 双 provider 状态机

`petLinkMode()` 每次判定都重新回答一个问题：此刻走 **linked**（页内 `petApiDshwe.link` 直控）还是 **native**（主包原生吉祥物）。四条判据**全真**才 linked，任一为假立即降级 native 并给出可读原因：

| 判据 | 降级原因（reason） |
|---|---|
| 联动开关开启 | `toggled-off`（关闭时点击吉祥物 = 原生侧栏开关，不空转） |
| 页内探测到 `petApiDshwe` 服务 | `runtime-not-installed`（未装 / 未加载） |
| `link.*` 14 项方法齐全且协议版本 ≥ 4 | `runtime-too-old`（需升级 dsh-pet-dshwe） |
| 目标 petId 有效且根节点可见 | `unknown-target` / `unknown-pet` / `pet-not-displayed` |

降级是**彻底的**：不下发任何动作、不上租约、不画气泡，原生侧栏行为一字不差。判定失败绝不留半死状态（探测通过但控制面缺方法、点了没反应）。

> **排播进行中切换开关是有意的语义选择**：当轮演出演完、结尾归还租约并清掉气泡后才降级——不做动作中途硬打断；之后的新交互立即走 native。卸载运行时同理：服务下页后本轮收尾干净、无残留（租约 / 气泡 DOM / 定时器全部释放），后续点击回落原生。

## 四条排播与联动细节

| 逻辑 | 演出 |
|---|---|
| 侧栏拉动（默认） | 螃蟹步走到屏幕边缘 → 蓄力后拉 → 侧栏展开 → 贴边等待 → 气泡「累死本鲸了…」→ 走回原位 |
| 抓绳互动（吉祥物在近侧） | 走向吉祥物 → 跳抓眩晕 → 绳子下拉 → 侧栏展开 → 落地起身 |
| 彩蛋一（侧栏逻辑第 3 次） | 气泡「偶鲸鲸！！！」→ 踢侧栏 → 宠物被原生抛掷物理弹飞 → 落地「哇啊啊啊啊啊！！！」 |
| 彩蛋二（吉祥物逻辑第 3 次） | 气泡「？！欺负一只肥鱼！？」→ 站立哈气 → 侧栏按进度展开 |

技术口径：

- 每只宠物一份控制器，全部经 `petApiDshwe.link` 的 14 项正式方法（`getRoot` 逐帧贴边 / `adoptPosition` 承接位置续物理 / `getPlayback` 真实播放进度 / `throwNative` 原生物理弹飞 / `lock-unlock` 独占租约等）——不再依赖任何 `window` 私有字段。
- 发动作 = 每段一次 HTTP（`POST /dsh-pet-dshwe-7340/anim?pet=`），之后进度/位置/抛掷读数全走页内 `link.*`，**无逐帧请求**。
- 睡觉竞争：取锁后发现宠物在睡 → 先释放租约 → `POST /wake` → 等醒来且「起来」演完 → 重新取锁 → 才下发点播；`throwNative` 是纯物理，睡着时照常起飞不唤醒。
- 气泡由本包**自绘**覆盖层（逐帧跟随宠物根节点），不占用、不清理宠物自己的气泡。
- 官方 `dsh-pet` 在场时只**探测并提示**（卡片显示「两者会各显示一只，互不接管」），不阻断、不互斥、不改官方任何文件。

## 运行时安装（设置页卡片 → 宿主半路由）

卡片按钮全部走宿主半三条路由（同源校验 + 8 KiB body 上限；页面**不能**传任意下载 URL，安装源由宿主决定）：

- `GET  /pet-link/pet/state` → `{ installed, version, path, running, officialPet, officialVersion, conflict, bundleListed }`
- `POST /pet-link/pet/install` → 分步进度 `preflight → resolve → download → verify → install → bundles → verify-install → credential`
- `POST /pet-link/pet/uninstall` → `{ keepData }`（默认**保留**数据根；`keepData:false` 连 `~/.dsh/dsh-pet-dshwe/` 一起删）

**双路径**：宿主先试 `pnpm add dsh-pet-dshwe@<ver> --config.node-linker=hoisted --ignore-scripts`；pnpm 缺失 / 失败 / 无网时退回 **tgz 兜底**——从 Release manifest（`registry.npmjs.org` / `github.com` / `objects.githubusercontent.com` 三域名白名单，强制 https）取包，按 manifest 的 `artifact.sha256` + 字节数**复算通过才解包**。

事务骨架：备份 `package.json` / `pnpm-lock.yaml` / 目标目录 → 原子写 + 写后校验 → 任一步失败**逐项回滚**（回滚后与安装前逐字节一致）→ 成功后落 `$DSH_HOME/dsh-pet-dshwe/pet-link-install.json` 凭据。解包用 `inflateRawSync` 解 deflate 体 + 纯 JS 逐项校验 gzip 尾部 CRC32/ISIZE 再纯 JS 解 tar——**不用** `zlib.gunzipSync`（Node v24.14 的 gunzip 同步解码对 ~64 MB 大包偶发抛 `incorrect data check` 误报，同一 Buffer 20 次实测约 2 次失败；解压实现问题不代表产物损坏）；解包失败报 `extract-failed` 回滚，绝不静默写 bundles。

> ⚠ `pnpm add` 必须带 `--config.node-linker=hoisted`（= DSH profile 实际 `nodeLinker`）：本机 pnpm 12 默认 isolated linker 装 `dsh-pet-dshwe` 会原生崩溃（tokio stack overflow）。这条写死在安装事务里，是「下载并安装」能否成功的硬约束。

已知并发边界：安装与卸载同时点击时，后到请求会被判 `busy-*` 明确拒绝，先到的事务完整跑完——磁盘终态始终与报告一致（见 `verify-pet-install` 场景 15/16）。

## 浮层操控面板（`Ctrl+Shift+D`）

约 50 个参数、13 个分组、缓动三选一，按四条逻辑各存一份覆盖；按钮：▶ 运行 / ■ 停止 / 重置当前逻辑 / 导出 JSON / 导入 JSON；可拖动、`Esc` 关闭；气泡时间节点可按动作开始/结束锚点 + 毫秒偏移编辑。参数清单唯一真源见 [`src/pet-link/panel-params.js`](src/pet-link/panel-params.js)，逐组参数说明见 [`docs/2026-10-30-M6-panel-params.md`](../../../docs/2026-10-30-M6-panel-params.md)。

**持久化口径（相对初始计划 §3.6 的一处降级，明确如实说明）**：参数覆盖层持久化在 WE 侧 `localStorage` 命名空间键 `dsh-we-pet-link-panel-v1`（记录 `{version, logic, target, tuning, bubbleTiming}`），刷新 / 重开页面可回读。

- **为什么不是「写入 WE 设置」**：WE 的宿主端 `/settings` 是固定 7 簇白名单（`core / appearance / mascot / fx / parallax / typeColor / media`）按键合并，簇外键会被判据驳回忽略——塞面板参数进去根本落不了盘，改白名单则要动主包的设置契约。
- **真实边界**：换浏览器 / 清站点数据 / 换机器即丢；跨环境迁移用面板的「导出 JSON → 导入 JSON」。
- **若要落宿主文件**：替换 `src/pet-link/panel.js` 里 `createPetLinkPanelSettings` 适配器的默认实现（`load/save/clear` 三方法，面向任意 `storage` 注入），面板本体与其余逻辑零改动。

## 验证

```sh
# 前置（干净环境首跑必做，否则以下全部 ERR_MODULE_NOT_FOUND 红）：
#   1) npm install --ignore-scripts --no-audit --no-fund   # 装工具链（npm cache 可指工作区 .npm-cache：npm_config_cache=<目录>）
#   2) npm run build                                        # 生成 5 份浏览器半产物（lib/client.js + 4 子包 client.*.js）
# 预期产物：built lib/client.js (约 4.5 MB) + fonts/fx/parallax/pet-link 四份 client.*.js

npm run verify:pet-link               # 定点回归总链：包面 → 热插拔 → 排播引擎 → 四排播 → 回落 → 面板 → 卡片 → 侧栏/玻璃
npm run verify:pet-install           # 安装事务 16 场景（含真实 64 MB 产物解包 819 文件、连解 20 次、三种篡改必败、并发两条）
npm run verify:pet-link:integration   # 真实 Cordis：配置更新、旧处理器失效、十次启停零路由残留
npm run verify:pet-link:browser       # 独立浏览器：自有气泡、配图加载与调参面板（需本机 Edge/Chrome 可起无头实例）
npm run verify                        # 全仓守卫链（92 步到尾，任何一步红都会短路）
```

另在 fork 仓（`repo-dsh-pet-dshwe/`）：`npm run verify:rename`——改名判据（扫描全仓文本文件的旧身份串，0 残留才通过；扫描条数以命令输出为准，不写死数字）。

浏览器夹具不等于官方完整 React 宠物或桌面窗口的视觉验收；不能把接口单测当成所有动画均已真机验收。沙箱类环境（禁止子进程 spawn）下 `verify:pet-link:browser` 与 `verify-deployment` 会红，属环境限制而非缺陷——本地依赖齐全的正常环境可全绿。

## 从旧版本迁移

内置 pet 与修改第三方文件的安装器已退役。旧 profile 里的派生依赖、bundle 选择、数据及曾经安装的外部补丁不会自动清除。关闭宿主后先停用旧内置行，再按部署说明更新；外部补丁应通过其原备份恢复或重装官方包，不对活动安装做故障注入。旧版调参面板的「本页运行时覆盖、刷新即丢」已被持久化取代。

本包保留联动定制素材，不包含宠物完整资源、字体及个人数据。代码许可证不替代素材授权；素材分发与商用范围须分别确认。本轮不发布 npm。
