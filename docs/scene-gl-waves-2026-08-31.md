# Scene GL 波次交付 Receipt（2026-08-31 起）

W1–W5 见 git 历史（各波 harness: `.analysis/scene-gl-wave*-verify.mjs` / `scene-gl-w*-verify.mjs`）。
本文补记 W6/W7（Phase A 逆向复审之后交付）与实验开关最终分层。

## W1–W5 概要（历史）
- W1 基础管线：meta/握手/engine 版本、gate 白名单、present pass、纹理通道。
- W2 通用效果层：effect.json 多 pass 拍平、FBO ping-pong、/scene-shader 展开、效果隔离。
- W3 粒子系统：清单入场、逐帧模拟绘制、blending 分组、精灵表帧（TEXS→a_UVRect）、
  mousefollow 发射器、instanceoverride 乘子族。
- W4 木偶网格：/scene-puppet payload、绑定姿态渲染、sf42 MDLA 动画解析修复
  （Uint8Array→Buffer indexOf）+ 逐帧蒙皮（实验层）。
- W5 稳定性：重建挂死修复（sceneGLSeq + dispose canvas.remove）、慢帧熔断、错误隔离。

## W6 视频纹理（engine /6 → /7）
- **Host**：gate 视频对象发 `type:'video'` 清单条目（全部 image 字段 +
  `mainTexture.video:true`）；`GET /scene-videotex/<token>/<texPath>` 端点
  （extractTexVideoMp4 → trimMp4ByTopBoxes → mp4LooksValid 校验 → vt1_ 磁盘缓存 →
  serveFile Range/HEAD 流式）；`SCENE_GL_ENGINE = 'dsh-we-scene-gl/7'`。
- **客户端**：`<video muted loop playsinline preload=auto>` + loadeddata 后建纹理
  （CLAMP 不 mip）；每帧 readyState≥2 且 currentTime 变化 → texImage2D（FLIP_Y=false）；
  failed/未 ready 跳过绘制不阻塞 GL_RUN；视频对象 → sceneIsStatic=false；
  dispose pause+removeAttribute('src')+load() 释放解码器；error/30s 超时隔离。
- **验证**：`.analysis/w6-verify-host.mjs` 8/8（3113554287 4×video 按场景序、
  mp4 提取 4/4、门控双态）+ `.analysis/w6-verify-client.mjs` 15/15（桩 video 元素：
  双视频序、currentTime 重传、错误隔离、/7 握手、逐帧、dispose）。
- **已知限制**：视频对象不跑效果链（非音频效果 mark 'video-effects' 丢弃）；
  时辰切换隐藏逻辑依赖内嵌脚本（不执行 → night 最上层，配置页已有 W0 提醒）。

## W7 实验开关最终分层（sceneGLExperimental，默认 OFF）
experimental 开启后**额外**进入 GL 的特性：
1. **视频纹理对象**（W6，`type:'video'`）— 关闭时 mark `video-texture`，
   场景可能 no-renderable → scene-video mp4 回退（= W6 前行为）。
2. **未测试效果目录**（W2 起的 SCENE_GL_EFFECT_TESTED 白名单外目录）。
关闭时以上全部走 CPU mp4 路径；实验层木偶骨骼动画（sf42）随清单下发，
不受开关门控（payload 有动画即蒙皮）。

## Phase A 逆向复审（官方 assets + lwe 对照，2026-09）
本波先于 W6 完成，修正的系统性错误（详见各 verify harness 与代码注释）：
- **A1 相机 eye**：lwe Camera.cpp:50 `projection=ortho·T(+eye)` 与 lookAt 的 T(−eye)
  完全抵消（7 张壁纸全部 center=eye+(0,0,−1)）— 旧 `_viewShift` 前景 x 位移是纯错
  （3735447194 右缝根因：前景错移 −267.5×ps；3427824116 错移 438.9×ps）。
- **A2 粒子 operator**：fadeValue 是**线性**非 smoothstep（lwe Maths.cpp:23）；
  angularmovement/turbulence/oscillateposition 漏乘 instanceOverride.speed；
  controlpointattract 按 lwe:1449 重做（threshold/2、cp.position+origin、
  0.001<d<threshold、力=normalize·scale·dt·speed；鼠标 cp 归一化 y-up、
  官方口径场景宽高）；oscillate* phase=random(phasemin, phasemax+2π)。
- **A3 木偶 fps**：MDLA 头 [f0 41] 魔数即 float32 帧率字段 — 从数据读出
  （0<fps≤240 校验回退 30），CPU/GL/payload 三处同步；23 动画实测全 30。
- **A4 Blending**：官方 `common_blending.h` 原文替换重建版（唯一偏离：头部补
  CAST3/BLENDMODE 守卫 — 官方引擎内置注入）；mode 5/10 官方**无** opacity mix
  （直接 min/max）；mode 15 linearlight dodge 侧**不 clamp 上限**；
  mode 4/20 官方即同为 BlendSubstract（BASE-12 了结）。
- **A5 TEX 格式**：R16F/RG1616F 补齐（官方头同 R8/RG88 转换式，half→量化）；
  82 个壁纸纹理全格式盘点覆盖。
- **A6 用户属性**：外部 project.json（pkg 旁独立文件）注入 gate + CPU；
  `{user:{condition,name},value}` 条件绑定语义 visible=(属性值===condition)
  （3735447194 rover combo 互斥生效）。
- **A7 陈旧标记**：父链 `parent` 降级标记移除（GL 三路径均消费 effTr，
  无降级 — 3427824116 的 6×parent 全为噪音）。
- **A8 CPU foliagesway**：数值验证可用（util/noise 相位场、双实例串联）；
  3427824116「降级 CPU 无效果」实为陈旧基线 + A1 错位叠加所致。
