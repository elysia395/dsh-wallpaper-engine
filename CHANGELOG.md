# Changelog

## Unreleased — 移除 CPU 渲染路径：GL-only + 静态图回退（破坏性变更）

场景壁纸渲染优先级变为 **内嵌视频 > GL 实时 > 静态图**。CPU 软件渲染链
（we-renderer 引擎 + worker + scene-anim mp4/apng 烘焙，~11.8k 行）全部移除，
决策与依赖审计记录见 `docs/plan-remove-cpu-render.md`。

- **行为变化**：无 WebGL2 / GPU 崩溃环境从"分钟级 CPU 烘焙 mp4 动画"退化为
  静态图（提取器多图层拼合）；GL 失败自动回退并显示降级横幅。
- **配置页 4 开关 → 2**：新增「GL 实时渲染」（默认开，关闭 = 纯静态图）；
  「未测试特效放行」默认改开；「beta场景动画」「运行壁纸内嵌脚本」
  「GL 降级渲染」删除（设置键 betaSceneAnim/enableSceneScripts/sceneGLDegrade
  静默丢弃，等价全员升级 GL on）。
- **内嵌脚本不再支持**：GL 快照式架构从不加载脚本（时钟/时段类脚本冻结为
  存盘值，横幅披露"GL 渲染不支持脚本"）。
- **性能**：不再有分钟级后台 CPU 光栅化与 ffmpeg 烘焙；启动时一次性清扫
  旧 scene-anim 缓存产物（san_* / *.prog）。
- 视频壁纸转码（抽帧/进度条）、内嵌视频场景、壁纸库缩略图（preview.jpg）
  均不受影响。


## Unreleased — Linux/Intel GPU 崩溃链加固

实测复现路径：窗口被其它全屏应用遮挡（X11 下 Chromium 不做遮挡检测，页面
仍"可见"）→ GL 场景持续满帧渲染 → i915 GPU reset（`GL_GUILTY_CONTEXT_RESET_KHR`，
GPU 进程 exit 8704）→ 遮挡期间连崩两次烧完重建额度 → GL 会话级永封 → 切回
后壁纸灰色，必须刷新恢复。

- **`pauseOnBlur` 默认开**（原 false）：失焦即暂停渲染/解码，遮挡期间 GPU 归零，
  从源头掐断崩溃链。旧存档一次性迁移**在 host/local 合并之后**对最终生效值判定
  （`loadPersisted` 末尾，独立 localStorage 标记；host 是事实源且 PUT 是全量替换，
  旧版早把默认 false 落进 host —— 只迁 localStorage 会被 host 合并盖回，存量
  GL 用户拿不到保护），翻转后立即回推 host；迁移后手动关闭仍被尊重；
  host `sanitizeSettings` 镜像同步。
- **前台恢复重试**：回到前台（可见且聚焦）且层仍停在静态帧（mp4 兜底已接管时不
  动）时，`contextlost*` 类失败自动清 sessionStorage 失败标记并重试 GL；重试前
  取消在途 scene-anim 升级（防渲染完成后 trySwitch 把活 GL 按违反
  sceneVideo > GL > CPU mp4 优先级切回 mp4）。防崩溃循环双重限：每 token 每
  页面会话只自动重试一次 + 30s 全局冷却；内容性失败（unsupported/render-fatal
  等）不自动重试。
- **重建额度自动恢复**（scene-gl）：contextrestored 重建成功后稳定运行 60s 重置
  `rebuiltOnce`，多次独立 GPU 崩溃各有一次重建机会，不再两次崩溃即永封。
- 壳层（dsh-my-ui `src/main.js`）：`disable-gpu-process-crash-limit`，防 GPU
  进程连崩后 Chromium 本会话永久禁用硬件加速、回落 SwiftShader 连累 GL 预检。

## 0.7.0 — Coexistence v1：与 dsh-web-ui-all（皮肤中心）二选一互斥

### 新增
- **外观归属状态机**（`appearanceOwner: "plugin" | "skin"`，host 持久化）：默认
  `plugin = 无条件全量生效`——液态玻璃/配色/侧栏玻璃/字体不受皮肤在场影响
  （v0.7.1 取消自动让位过渡态）；显式选择 `skin` 才进入完全待机，且在另一壁纸
  引擎在播期间保持待机、无冲突时自动接管（页面不留无外观源空窗）。
- 设置页「外观归属卡」：探测状态展示（皮肤 id / 自定义主题）、双按钮切换、契约上报开关。
- 双引擎阻塞选择卡：双方壁纸同时运行时强制二选一；基于归因判据「无皮肤却存在 backdrop 标记 ⇒ 对方内置 WE 控制器在播」，第三方占用 `data-dsh-wallpaper-active` 同样触发。
- 契约上报（可关）：owning 时向 html 写 `data-dsh-wallpaper-active`、向 body/html 写 `data-dsh-backdrop-active`，令 skin-center 的 composer 中和器与表面半透明化正确协作；所有权受控（只撤除自己置位的标记）。

### 兼容加固
- portal 打标不变量：所有 body 级动态根（层/scrim/拉绳宿主/模态/卡片）插入即带 `data-dsh-plugin="dsh-plugin-wallpaper-engine"`，被 skin-center 表面打标规则豁免。
- z-index 平手修正：更新提示 1100→1090（避让 web-ui-all 移动端侧栏抽屉）、picker 模态 1000/1001→1005/1006（避让详情覆盖层）；≤768px 且对方抽屉展开期间隐藏拉绳与提示。
- 字体补丁并入状态机：yielding/idle 不再注入 `we-font-patch`，全页字色交还皮肤主题。

### 性能
- SliderRow 输入合帧：拖动期间每帧最多提交一次（此前每 tick 全量持久化+applyEffects×2+整树重渲×2），组合多插件观察器场景显著降载。

### 工程
- `scripts/verify-coexist.mjs`：39 项 headless 断言覆盖相位门控快照、idle 卸载/恢复闭环、上报所有权、阻塞卡决策路径、portal 打标静态不变量等；已并入 verify 链路。

### 兼容基线
- 实测对象：@linxin666/dsh-web-ui-all@0.3.5 / @linxin666/dsh-client-ui-skin-center@0.3.5。上游语义属性若有变更，自检日志会给出保守降级（按“无皮肤”处理）。
