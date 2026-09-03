# Changelog

## 0.8.5 — GL 渲染分辨率跟随窗口（视口预算修复 + 轮询兜底）

两处叠加的分辨率问题（复现: 首启小分辨率 → 窗口全屏 → 壁纸模糊, 刷新才清晰）:

- **视口预算解锁**：GL 画布预算原被钉死在 1920×1080 (GL 引入期的保守帽),
  2K/4K 屏上整屏 CSS 拉伸发虚且窗口越大越模糊。改为视口物理像素
  (CSS×dpr), 绝对上限 4K — 渲染器 WE_GL_MAX_DIM=4096 本就按此设计。
  实测 2560×1440 屏从 1920×1080 → 2560×1440 原生渲染。
- **resize 事件吞没修复**：GL 初始化窗口期 (meta fetch + shader 编译,
  1~3s) 内到达的 resize 事件被 apply 的 ready 检查早退丢弃 → 画布停在
  初始小分辨率。三路保障: onReady 瞬间按当前视口补一次 (确定性修复) +
  window resize/dpr 事件 (即时) + 2s 轮询兜底 (用户决策; 生命周期跟随
  GL 会话启停, GPU 崩溃加固的"失败后无残留轮询"断言语义不变)。
- **resize 零成本化** (scene-gl): sarFitFor 先算后赋, 阈值内的 resize
  完全不触碰 canvas — canvas.width 赋值即使同值也清空位图, 静态场景
  (P2-8 跳帧) 会停在空帧; 旧实现的"阈值内回滚"路径恰有此双写。
  轮询/事件重复调用 resize 现在是真正的 no-op。

## 0.8.4 — CPU 渲染全部屏蔽（决策再修订）

0.8.2 恢复的 CPU 渲染优先链经实测后用户拍板撤除：静态帧只走提取器
（0.8.1 修复版），GPU 抓帧回填保留（0.8.3）。CPU 渲染相关代码全部移除
（引擎模块与 0.8.0 移除后的基线一致；恢复方案留档于历史 4340e53）。

- `/scene-frame` 回到提取器唯一实现；缓存键 sf37→sf38
- we-renderer 引擎模块 (core/image/text/particles/model/mdl/camera/
  bloom/textures/effects/glsl executor 等) 与 scene-renderer.js /
  scene-render-worker.mjs 再次移除; puppet.js 恢复 GL 专用裁剪版
- 保留: HEAD 缓存探测、PUT GPU 抓帧回填 (仅空槽)、负缓存、in-flight
  去重、客户端 GL 接管后中止底图请求
- 行为面: GL 开 → GPU 实时 + 抓帧建缓存; GL 关/失败 → 提取器静态图;
  无纹理场景 422 → 预览回退 (0.8.1 实测 56/177 可出帧, 真实 7 张全部 ✓)

## 0.8.3 — 静态帧缓存：GPU 抓帧回填 + CPU 兜底按需触发

0.8.2 的余留问题：GL 可用时客户端仍无条件预取 frameUrl 底图 → 每张壁纸
首次选中都会白跑一次 CPU worker 渲染 (4~30s CPU 尖峰, 结果被 GL 覆盖)。
按用户决策落地"每壁纸一份缓存, CPU/GPU 皆可创建, 仅空槽写入":

- **GPU 抓帧回填**：GL ready 后 2.5s (对齐 CPU 渲染 time=2.5, 粒子/效果
  已展开) 从 canvas 同帧 `readPixels` 抓 PNG → `HEAD /scene-frame` 探测
  空槽 (204) 才上传 → `PUT /scene-frame-cache/<token>` 写入 sf37 槽。
  已有帧 (CPU 先渲染过) 零开销跳过; 任一步失败静默放弃。
- **CPU 兜底按需触发**：GL ready 即撤底图 img 的 src → 宿主 N-02 等待者
  归零 → 中止在跑的 CPU worker 渲染。GL 可用时 CPU 渲染不再落盘; GL
  失败回退时层重建重设 img.src, 链路不变。
- **首写胜出**：worker 渲染完成时若槽已被 GPU 帧占用则丢弃结果; PUT 也
  只写空槽 — 两条创建路径互不覆盖。
- `scene-frame` 支持 HEAD (纯磁盘探测, 绝不触发渲染); PUT 校验 PNG/JPEG
  魔数 + 32MB 上限 + token 白名单。
- 首次空窗 (完全无缓存) 维持现状不加垫图 (用户决策)。

## 0.8.2 — 静态帧恢复 CPU 渲染（决策修订）

0.8.0 把提取器（多图层拼合）提为唯一静态帧实现后实测暴露：该分支在 0.7.1
只是 worker 崩溃兜底、从未被真实壁纸执行过，转正即翻车（y 翻转 / PNG 12MP
解码门 / 画布 33MP 上限三连，0.8.1 已修但能力面仍窄——无粒子/文字/特效，
SDK 纯粒子场景全 422）。决策修订（详见 `docs/plan-remove-cpu-render.md` 修订节）：

- **`/scene-frame` 恢复两段式**：CPU 引擎（SceneRenderer）worker 单帧渲染
  优先（含粒子/木偶/文字/shader 效果，即 0.7.1 的静态帧质量），失败回落
  提取器拼合（0.8.1 修复版）。缓存键 sf36→sf37。
- **只恢复静态帧，不恢复烘焙**：scene-anim / APNG / mp4 raw 多帧链、
  betaSceneAnim 开关、渲染进度条 UI 均维持删除；worker 只剩单帧模式。
- **脚本执行维持删除**：core.js 本地 sceneHasScripts 谓词 + 恒不执行；
  degraded 文案对齐"静态渲染不支持脚本"。
- 客户端取帧时机不变（选择即取，GL 就绪后淡入覆盖）：首次选择付一次
  4~30s 的 worker 渲染，之后磁盘缓存命中（0.7.1 同款行为）。
- we-renderer 引擎模块自 pre-removal 基线整体恢复（puppet.js 取消裁剪 —
  对 GL 路径纯增量）；打包 files 白名单补回 scene-renderer.js /
  scene-render-worker.mjs。

## 0.8.1 — 8K 工程静态帧只剩天空雾层

`3427824116 胡桃-窗前`（投影 8192×4608）：天空/图层 1 两个 37.7MP 内嵌
PNG 在拼合 Pass 1 全被静默判为解码失败——`decodeTexToRgba` 复用的
`decodePngPayload` 带着 12MP 质量门上限（那是给 `pngQuality`"超限即信任"
设计的），两层全弃 → 拼合弃用 → 回落单纹理路径输出天空雾图。

- **真解码上限与质量门分离**：`decodePngPayload` 增加 `maxPixels` 参数
  （默认仍 12MP）；`decodeTexToRgba` 传 64MP（与 JPEG 路径对齐）。
- **拼合超限缩放**：画布超 33.2MP 硬上限时不再整帧放弃，按比例均匀缩放
  画布与全部图层到 4K 预算（3840×2160）再拼合，层间几何不变。
- 附带修复：隔行（Adam7）PNG 拒绝解码（防错位像素）；RGB PNG 载荷补
  alpha=255（此前 source-over 拼合整层不可见）。
- 新增 `scripts/verify-all-wallpapers.mjs` 全库端到端验证（视频/GL 门/静态帧）。

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
