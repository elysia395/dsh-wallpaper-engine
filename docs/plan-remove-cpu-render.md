# 移除 CPU 渲染路径 — 决策记录（GL-only + 静态图回退）

> 2026-09 实施。三个 commit：服务端（refactor!）、客户端（refactor!）、脚本/文档。
> 净删 ~11.8k 行；发布包 70 → ~50 文件。

## 目标不变量

```
现状:  sceneVideo (内嵌 mp4) > GL 实时 > CPU mp4 (scene-anim) > 静态帧 (scene-frame)
目标:  sceneVideo > GL 实时 > 静态帧
```

GL 任一失败（gate 拒 / 初始化失败 / contextlost 烧尽 / 慢帧熔断）→ 停留静态帧 + 降级徽标。

## 六项已拍板决策

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| 1 | GL 总门控 | `betaSceneAnim` → **`sceneGL`，默认开** | GL engine v9 + e2e 成熟；失败自动落静态帧 |
| 2 | 静态图来源 | **提取器转正**：`/scene-frame` URL 不变，实现换 `extractSceneMainImage`（缓存键 sf35→sf36） | 现有 worker 崩溃回退分支即此实现，皮肤中心同源，零新代码 |
| 3 | 效果白名单 | **`sceneGLExperimental` 默认开** | 机制通用（客户端编译官方 shader）+ 失败隔离；CPU 备胎已删，白名单拦截只会让特效静默消失 |
| 4 | 内嵌脚本 | **彻底删除**（含 `enableSceneScripts` 开关、`scene-scripts.js`） | GL 快照式架构从不加载脚本；实测本地 3/7 壁纸含脚本且全部为时钟/时段类，默认配置下本就没执行 |
| 5 | GL 降级开关 | **删除 `sceneGLDegrade`**，固定"部分渲染 + 横幅披露" | 其 OFF 分支的"完整备胎"（CPU mp4）没了；部分动画严格优于无特效静态图 |
| 6 | 脚本提示 | W0 标记保留，文案改为"GL 渲染不支持脚本" | 原文案引导开一个已删除的开关（悬空引用） |

## 依赖审计结论（实施前实证）

- **官方 JSON+GLSL 本就直连**：壁纸 pkg 自带特效定义（实测 3295448069 的 15 条目中 11 条为 effects/materials/shaders）；GL 客户端编译官方 shader（`_weGLAssemble` + HLSL 兼容宏）；CPU 路径的解释器栈（`we-renderer/glsl/`）只服务软件渲染。
- **we-renderer 非整块 CPU 专属**，GL 服务端依赖保留：`canvas.js`(encodePng)、`math.js`、`puppet.js`(裁剪至 7 个解析方法)、`puppet-export.js`、`util-textures.js`、`glsl/preprocess.js + *.h`。
- **选壁纸界面预览图**：网格卡片 = `preview.jpg`（零渲染，不受影响）；预览底图/poster = `/scene-frame`（URL 不变，实现换提取器，客户端零改动）。
- **`extractSceneVideoFrames`**：worker 链删除后仅剩诊断导出，保留。

## 文件变更清单

**删除**：`scene-renderer.js`、`scene-render-worker.mjs`、`apng-encode.js`、`scene-scripts.js`、`scene-script-apis.js`、`we-renderer/{core,image,text,particles,model,mdl,camera,bloom,textures,math→保留,effects.js,effects/,glsl/{executor,transpile,runtime,integration},jpeg}.js`、`scripts/verify-shake-fix.mjs`、`test/scene-gl-spike/render-ref.mjs`

**settings 键迁移**：删 `betaSceneAnim`/`enableSceneScripts`/`sceneGLDegrade`；增 `sceneGL`(默认 true)；`sceneGLExperimental` 默认 false→true。旧键直接丢弃不映射（= 全员升级 GL on）。

**端点**：删 `/scene-anim`、`/scene-anim-progress`；`/scene-gl-*` 403 门改 `sceneGL`；启动清扫 `san_*` 产物与 `*.prog` 孤儿。

## 行为变化（明示）

- 无 WebGL2 / GPU 崩溃环境：从"mp4 动画兜底"退化为静态帧（本次目标）。
- 内嵌脚本永久失效（时钟冻结为存盘值、时段标签/粒子强度不自动切换）；横幅披露。
- 复杂多对象场景的静态底图从"worker 渲染帧"降为提取器拼合图（无特效/粒子）——只在 GL 未就绪/失败/关闭时可见。
- scene-anim 相关 UI（渲染进度条、beta 提示、倍速对 scene 的适用）全部移除；视频壁纸转码（transcodeState）不受影响。

## 修订（2026-09-02 晚，0.8.2）：静态帧恢复 CPU 渲染

实施后实测复盘推翻了决策 #2 的"零新代码"前提：`extractSceneMainImage` 虽是
现成的 worker 崩溃回退分支，但 0.7.1 时代 worker 渲染几乎从不失败，该分支
**从未被真实壁纸执行过**——转正当天暴露三处潜伏 bug（拼合 y 翻转 / PNG 12MP
质量门泄漏进真解码 / 画布 33MP 上限整帧放弃，分别见 0c59622 / 66050e0），
且能力面也窄（只叠静态图层，无粒子/文字/特效；SDK 纯粒子场景全 422）。

决策修订（用户拍板）：

1. **保留提取器修复** — 作为渲染失败时的回退链第二级。
2. **恢复 CPU 渲染（SceneRenderer）但仅限静态帧**：`/scene-frame` 恢复
   0.7.1 的两段式 — worker 单帧渲染优先（含粒子/shader 效果），失败回落
   提取器拼合。缓存键 sf36→sf37。客户端 fetch frameUrl 的时机不变
   （选择即取，GL canvas 就绪后淡入覆盖；首次选择付一次 4~30s 的
   worker 渲染，之后磁盘缓存命中）。
3. **烘焙回路保持删除**：scene-anim / scene-anim-progress 端点、APNG/
   mp4/raw 多帧链、betaSceneAnim 开关、渲染进度条 UI 均不恢复；
   `scene-render-worker.mjs` 只保留单帧模式（times 参数不再消费）。
4. **脚本执行保持删除**：core.js 改为本地 sceneHasScripts 谓词 + 恒
   `runScripts=false`；degraded 披露文案对齐（"静态渲染不支持脚本"）。

净效果：GL 失败/关闭时的静态底图质量回到 0.7.1 水平（含粒子/特效），而
分钟级动画烘焙、脚本执行、双开关 UI 均维持 0.8.0 的删除状态。

## 修订二（2026-09-02 深夜，0.8.4）：CPU 渲染全部屏蔽

修订一恢复的 worker 渲染优先链实际运行后（HMR 生效、GPU 抓帧落盘验证
正常），用户最终拍板撤除 CPU 渲染：

- 静态帧**只走提取器**（0.8.1 修复版：64MP 解码门 + 超限缩放 + y 翻转）。
- **GPU 抓帧回填保留**（0.8.3）：GL 会话 2.5s 后 canvas 抓帧写入缓存槽
  （仅空槽、每壁纸一份），GL 关闭/失败时提取器补位。
- 引擎代码再次移除；恢复方案完整留档于 4340e53（含单帧 worker、脚本
  谓词内联、首写胜出协调），需要时可整体 cherry-pick 回来。

最终形态：`sceneVideo > GL (GPU) > 提取器静态图`，渲染负载全部在 GPU
或提取器（一次性、磁盘缓存），CPU 光栅化链不存在。
