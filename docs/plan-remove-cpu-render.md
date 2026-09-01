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
