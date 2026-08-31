# Plan v2: 场景壁纸 WebGL 实时渲染（scene-gl）

> 目标：对「单图 + fragment 效果 + 静态相机」类 WE 场景，用浏览器 WebGL2 实时渲染替代 CPU 预渲染 mp4，彻底消除循环接缝/时长短/首渲染等待三个问题。
> v2 修订：合并两轮子代理审查（架构 4 阻断 + 代码 5 阻断）与实施细节附录（docs/plan-scene-webgl-details.md，下称"附录"）。附录含全部代码级细节（common.h 全文、shader 拼装模板、MVP 推演、uniform 表、路由 schema、spike 步骤），本文件是决策与验收的单一权威来源。

## 1. 背景与已验证事实

当前路径：SceneRenderer（CPU, worker）→ APNG → ffmpeg → mp4 → `<video>` 循环。

1. **CPU 永远到不了实时**：本场景 1600×900 全效果 1033ms/帧（≈1fps）；30fps 需 33ms/帧，差 ~40×。
2. **预渲染片段固有循环接缝**：本场景运动 100% 来自自由演化 shader（waterripple 自然周期 44.4s），时长公式 `loop=max(period, animDuration, starttime, 2)`（index.js:2508）对无相机/关键帧/粒子场景落到 2s 下限；实测接缝帧差 26.4 = 片内 3.3×。
3. **pkg 自带官方 GLSL**（waterripple/iris 的 frag+vert），GL 路径逐字编译 = 100% 忠实原作。
4. **WebGL2 上下文可直接编译 GLSL ES 1.00**（NPOT+REPEAT 限制在 API 层解除，与 shader 语言版本无关——代码审查实测确认）→ 官方 shader 几乎原样可编，300 es 宏映射降级为备选。
5. **客户端 build 脚本（scripts/build-client.mjs）只做单文件文本包裹，不打包 import**（实测）→ 模块加载方案定案为扩展 build 脚本按序拼接（附录 §7）。
6. **现有纹理解析对本场景短名全部 404**（实测）：extractSceneResource 的候选链覆盖不到 `materials/masks/*.tex`；正确解析器是 `resolveSceneTexPath`（pkg-extract.js:1123，未导出）。decodeTex 返回 jpeg/png-pass/rgba 三 kind 判别联合，png-pass 无像素只有 bytes。
7. **host 端跑 shaderfrog preprocessShader 会把 `#if` 用传入 defines 固定裁掉**（实测），且对 `#include` 抛错 → host 只能做 include 展开，`#if` 必须留给客户端拼 define 头后由 WebGL 编译器求值。
8. **scene-frame 路由返回二进制图片**，挂不了 glSupported 字段 → 支持性判定只能由 scene-gl-meta 惰性返回（inventory 加字段会因 3s TTL+全量扫描+readPkg 整包读取引入开销，且 meta 本来就是必经第一步——不加）。
9. **已有 scene-player.js 前例**（1945 行自包含 WebGL1 iframe 播放器，lib/index.js:2630 起）：默认不启用，注释记载"a live WebGL context per scene froze the page in testing"。本方案必须与其划清界限（见 §2.8 与 §6 Phase 0 的冻结归因步骤）。
10. 插件已有 GLSL 预处理设施（glsl/preprocess.js 的 include 展开/parseMeta）与 tex 解码（pkg-extract.js decodeTex）；客户端已有 canvas 壁纸层先例（we-media--canvas，Edge 视频镜像）。

## 2. 架构决策

| # | 决策 | 选择 | 理由/依据 |
|---|---|---|---|
| 1 | 渲染位置 | 浏览器客户端 GPU | host headless-gl = native 依赖 + 仍需推流，排除；WE/lwe 同款架构 |
| 2 | GL 版本 | **WebGL2 上下文 + GLSL ES 1.00 shader 原样编译**（首选）；300 es 转换头为备选（附录 §2.2，仅当原样编译踩坑时启用） | 事实 4；ES 1.00 下 varying/attribute/gl_FragColor 原生，唯一必加宏是 texSample2D→texture2D；300 es 的全部边角风险（precision/gl_FragColor 改名/保留字）随首选方案消失 |
| 3 | shader 预处理职责 | **host 只做 expandIncludes**（内置 common.h/common_perspective.h stub，附录 §1），返回 `#if` 完好的源码 + combos 默认表 + uniform/textures 映射表；**客户端拼完整 define 头**（元注释默认 ⊕ pass.combos ⊕ 纹理槽位派生，§2.4 规范、§5.1 实现）再编译 | 事实 7（host 求值 #if 会让客户端注入失效——两个审查共同阻断项） |
| 4 | combo 派生规则（规范） | `MASK=1 ⟺ 该 pass 解析出的 opacitymask 槽纹理非 null`；`[COMBO_OFF]` 与 `[COMBO]` 都要解析；parseMetaGL 保留 mode/combo/default 字段 | WE 语义 = mask 纹理绑定即启用（本场景两 pass 均无 combos 字段但 textures[1] 非空）；不这么定就会复现 sf34 修掉的"整体上移"bug |
| 5 | GL 程序缓存键 | `effectDir + JSON.stringify(resolvedCombos)` | 同效果不同 combos 的对象/场景切换不得串用 program |
| 6 | 纹理环绕 | **slot1/2（mask/normal）REPEAT**（ripple 坐标随 t 无界增长必须 wrap，CPU _texSample 同为 wrap）；**slot0（主图）= 判别实验对象**（§6.4 第⑤项）——wrap 是引擎 sampler 状态、shader 文本对它零约束，"官方语义"不可考；候选 CLAMP（跟 CPU waterripple.js:61）vs REPEAT，无独立官方证据时默认跟 CPU。边缘差异带 ≈ strength²·‖normal.xy‖·texSize（按本场景 csv ripplestrength=0.1 实算上下界后再定裁边宽度，不写常数 9px）。前例 scene-player.js:876 也是 slot 相关 wrap（`loadTexture(url, repeat)`），非全 REPEAT——佐证这不是有共识的官方约定。4K 缩闪：generateMipmap + LINEAR_MIPMAP_LINEAR（WebGL2 NPOT 合法） |
| 7 | 模块加载 | 扩展 build-client.mjs：scene-gl.js 正文以 IIFE 形式拼进同一 factory（`var __WESceneGL = (function(){...})()`），版本 handshake | 事实 5；不引打包器、不加路由 |
| 8 | 与 scene-player.js 前例的关系 | 新 GL 层 = **主文档内 canvas、单上下文、非 iframe、白名单只放行简单场景、rAF 遵守 fpsCap、切壁纸即 dispose、context 属性 antialias:false/depth:false**（前例 scene-player.js:39 是 antialias:true/depth:true——第九项差异，归因实验记录里保留该对照）；Phase 0 含冻结归因（§6） | 前例冻结原因未明，不归因就复建可能重蹈覆辙 |
| 9 | 优先级不变量 | **内嵌视频（sceneVideo）> GL > CPU mp4**；GL 失败自动落 mp4；任何场景行为不退化 | sceneVideo 场景根本不触发 GL（buildMedia/applySelection 层判定，不只挂 queueSceneAnimUpgrade——代码审查非阻断 6） |
| 10 | 开关 | 复用 betaSceneAnim 总开关（开 = GL 优先、mp4 兜底）；不加新用户开关；localStorage `weSceneGL=0` 调试强制 mp4；sessionStorage per-wallpaper glFailed 防同会话反复重试 | 最小 UI 变更 |
| 11 | 回退例外 | contextlost → dispose → **重建尝试一次** → 再失败才落 mp4 | mp4 首渲是分钟级 CPU，把瞬时 GPU reset 升级成重负载兜底不成比例（架构审查） |

## 3. 白名单 gate（Phase 1，保守方向 = 宁漏勿错）

`isSceneGLSupported`（host 在 scene-gl-meta 响应返回 `supported/reason`）全部满足才放行：

- `objects.length === 1`，且为纯 image 对象（无 `puppet`/`particle`/`model` 字段）；对象自身材质 shader ∈ `genericimage*`（image.js:74-89 还有 custom shader/solidlayer/passthrough 分支——非 genericimage 的 image 对象会"判 supported 但渲染语义不同"）
- 全部效果 `file` 目录名 ∈ {waterripple, iris}；每效果 `passes.length === 1`；`visible` 按 getVal({user,value}) 语义为 true
- waterripple pass 的 combos.PERSPECTIVE ≠ '1'（Phase 1 只支持 PERSPECTIVE=0）
- 相机：无 `paths`；`eye ≈ (0,0,0)`（无 viewShift）；`zoom === 1`；无 `camera:"default"` 对象；`general.cameraparallax !== true`
- 场景：`general.bloom !== true`；`general.hdr !== true`
- 对象：`alpha === 1`、`brightness === 1`、`colorBlendMode` 缺省或 0、`alignment` 缺省；ANIM_KEYS（index.js:2486 同款清单）全部无 `{animation}`（否则 GL 冻结动画 = 行为退化）
- scale/angles 允许（MVP 数学已含，附录 §4），但 spike 必须含 angles≠0 用例定死方向

不满足 → `supported:false` → 客户端直接走现有 mp4 路径（GL 完全不初始化）。

## 4. Host 改动（lib/index.js + 三个小配套）

1. **`GET /wallpaper-engine/scene-gl-meta/<token>`**（新）：惰性解析 + 白名单判定 + 返回完整 scene schema（objects 含**解析后的** mainTexture/effects.textures 的 pkg 完整路径 + 每张纹理 {path,w,h}，供 g_TextureNResolution；pass 级 combos/textures/constantshadervalues 原样下发）。schema 见附录 §6.1。
2. **扩展 `GET /wallpaper-engine/scene-resource/<token>/<path>`**（不新建平行路由）：解析链末尾追加 `resolveSceneTexPath` 兜底（修短名 404）；`.tex` 按 decodeTex kind 分支——jpeg/png-pass 原样透传、rgba 走 encodePng。**422 仅作用于新增的 resolveSceneTexPath 兜底分支**（兜底命中但 decode 失败才 422）；既有 `extractSceneResourceVia` 的 catch-raw 行为原样保留（内嵌视频纹理/坏 tex/.json 原样透传，scene-player 回退路径依赖它——见验收 7"只追加兜底不改前序行为"）。路径 `..` → 404。
3. **`GET /wallpaper-engine/scene-shader/<token>/<effectDir>`**（新）：读 `shaders/effects/<dir>.{frag,vert}` → **仅 expandIncludes**（内置 stub）→ include 白名单预检（未知 include → 422，防"能编译但错"）→ 返回 `{vert, frag, combos, uniforms, textures}`（parseMetaGL 产物，schema 见附录 §6.3）。**parseMetaGL 对 vert+frag 各跑一次再合并**（`{...metaF, ...metaV}`，对齐 CPU compileGlsl——PERSPECTIVE 元注释只在 waterripple.vert）。
4. 配套改动：
   - `lib/pkg-extract.js`：导出 `resolveSceneTexPath`/`pkgSceneAccess`/`dirSceneAccess`（3 个 export，零逻辑改动；松散目录分支复用 dirSceneAccess 的路径穿越 fence）；
   - `lib/we-renderer/glsl/common.h` + `common_perspective.h`（新文件，附录 §1 全文）；
   - `lib/we-renderer/glsl/preprocess.js`：新增 `parseMetaGL`（附录 §6.3 全文；不动 CPU 路径用的 parseMeta）；
   - pkg 访问 LRU 缓存（key=abs|mtime，cap 2，附录 §6）+ 解码纹理 PNG 内存 LRU（**字节预算 cap 64MB**——4K PNG 单张 5-10MB，多场景切换需显式上限防内存膨胀；首帧链路 1-3s 的主要来源是 4K decodeTex+PNG 编码，多标签/重开直接受益）。
5. 三路由与 scene-anim 同款 betaSceneAnim 403 门控 + token=base64url(abs) 机制；不做进 inventory（事实 8）。

## 5. Client 改动

### 5.1 新文件 `src/scene-gl.js`（纯脚本片段，无 import/export，附录 §7 约定）

`createSceneGLRenderer({ token, frameUrl, width, height, fpsCap, onError })`：
- **顺序：meta → shader fetch+compile+link（失败快速退出）→ 纹理 fetch（附录 §8 状态机）**——避免编译失败白耗 4K 传输（架构审查）
- combo 解析（§2.4）→ define 头拼装（附录 §2.1）→ 编译链接；程序缓存键 §2.5
- 纹理：`createImageBitmap(blob, {imageOrientation:'flipY', premultiplyAlpha:'none'})` → texImage2D；纹理参数按 §2.6
- 渲染循环 rAF：`g_Time=(performance.now()−t0)/1000` 自由运行；**fpsCap 累计器限帧**（与 mp4/scene-anim 的用户控制一致，防 144Hz 屏跑满）；MVP/uniform 按附录 §4/§5
- 暂停：document.hidden / IntersectionObserver 离屏即停；恢复继续（时间基连续无跳变）
- dispose 幂等（abort fetch → deleteTexture/Program/FBO → loseContext）；contextlost 按 §2.11

### 5.2 `src/client.js` 接线（小改）

- **GL 判定放在 applySelection/buildMedia 层**（非只挂 queueSceneAnimUpgrade）：selection.type==='scene' && beta && 无 sceneVideo && weSceneGL≠0 && 无 glFailed → 创建 GL renderer；失败 → sessionStorage 标记（**glFailed 带 reason 字段**——网络超时 vs 编译失败 vs contextlost，调试期定位回退原因零成本）+ 走既有 mp4 升级（queueSceneAnimUpgrade 零改动）
- buildMedia 增 `sceneGL` 分支 → canvas 元素（`we-media we-media--gl`）；**canvas 首帧渲染完成后才显示**（静态帧 img 作底图，首帧后 300ms CSS 淡出）——加载体验不比现状差
- syncLayers wantKey 加 GL 位（否则 img↔canvas 层复用错乱）；releaseLayerMedia 加 canvas/GL dispose 钩子（现只清 video）
- queueSceneAnimUpgrade 内联的 w/h 计算抽 helper 复用（含 sar 场景宽高比修正——GL canvas 背板按场景 ortho 比例，视口不一致时 CSS letterbox）
- 构建：`node scripts/build-client.mjs`（扩后的拼接逻辑附录 §7）+ verify-client 回归

## 6. 分阶段与验收（全部可客观裁决）

### Phase 0 — spike（不碰现有代码，`test/scene-gl-spike/`，附录 §9）【已完成，裁决见附录 §11】

1. **冻结归因**（§2.8）：读 scene-player.js 渲染循环 + 实测复现，确定冻结根因并写入附录；确认本方案设计逐项规避。
   **候选清单**（七项）：iframe 内上下文竞争／无 fps 限制／粒子 CPU 模拟／上下文数量／同步编译／**玻璃面板逐帧重采样（backdrop-filter 跨 surface readback——合成器假设）**／**旧场景切换后 context 未释放触发浏览器逐出**。
   后两项必须列入的证据链：scene-runtime 路由注释（index.js:2625-2630）自述 iframe 同源就是为了让父页面 **backdrop-filter (liquid glass)** 采样；client.js:3888-3890 玻璃配方 blur(16px) saturate(1.8) 多处面板采样壁纸层；client.js:3734 本代码库已有"re-rasterising all backdrop-filter panels over the wallpaper"的性能回归史——玻璃×壁纸重采样是被证明过的雷区，且前例运行环境（同源 iframe 被玻璃面板实时采样）结构上正是"整页冻结"级机制，去掉 iframe 只消除跨 surface readback，**不消除"每帧壁纸更新⇒全部玻璃面板重模糊"**，候选清单只列页面内机制会漏掉它。
   **实验设计（三配置 × 10min，记录帧时与合成器行为）**：① 现状 iframe（最小页）；② 主文档 canvas + 玻璃面板开启（真实 GUI 壳或按 client.js:3888 配方复刻玻璃叠加层）；③ 同 ② 但玻璃关闭。③ 与 ② 之差直接归因玻璃项；① 与 ② 之差归因 iframe/surface 项。
   **无复现决策规则**：三轮都复现不出 ⇒ 依据 §2.8 差异设计 + `weSceneGL=0` 逃生门 + per-wallpaper glFailed 继续实施，但把**"②玻璃开启状态下 30s 帧时 P95 ≤ 20ms"提前为 Phase 1 首项验收**（现有验收 3 在真实 GUI 跑，标注玻璃状态即可）——归因实验不能空转。
2. **资源提取 + CPU 参考帧**：extract-assets.mjs（pkg→PNG）+ render-ref.mjs（SceneRenderer **staticFrame 全分辨率**单帧，960×540，t=3.7s——不用动画降采样路径，消除系统性偏差）。
3. **GL spike 页**：硬编码本场景，ES 1.00 原样编译两效果（附录 §2.1），冻结 t=3.7 渲一帧。
4. **判别实验**（附录 §9）：① g_TextureNResolution 三候选约定各渲一帧对 CPU 帧（唯一未定的语义歧义——官方 waterripple.vert 用 g_Texture2Resolution 缩放 mask UV，而 CPU 用 maskW/objW；约定 (a) 下本场景 iris 会退化为 no-op 而 CPU 有眼部微动）；② angles=30° 合成用例定死旋转方向；③ uv+1.3 REPEAT 无黑缝；④ mask 区域集中差异时替换约定重试；**⑤ slot0（主图）CLAMP vs REPEAT 各渲一帧对 CPU ref（§2.6——无独立官方证据时默认跟 CPU 的 clamp）**。
   **仲裁优先序（统一规范，覆盖全部语义歧义）**：官方可考（shader 文本/文档/资产实测）→ 按官方；官方不可考（如 sampler wrap 状态、resolution uniform 约定）→ 以**用户已验收视觉**（=CPU 修复后行为、原作意图）为准。选定结论记入 docs/WE-REVERSE.md。
5. **验收阈值**：裁边宽度按 §2.6 实算（strength²·‖normal.xy‖·texSize 上下界，初值 16px）后 MAD（0..255，RGB 均值，忽略 A）**≤2 通过、>5 失败**，之间人眼仲裁；**MAD 是回归阈值而非正确性标准**——正确性仲裁按 §6.4 的优先序（官方可考→官方；不可考→用户已验收视觉）；附加结构断言：相位相关全局偏移 <0.5px（对应"无整体上移"，自动化）；16 行分段 MAD 定位差异区。**人眼仲裁带的污染源控制**：MAD 落入 2-5 仲裁带时，先在 1920×1080（2:1 缩小）复测排除 GL 三线性 mip vs CPU 全分辨率双线性的滤波差异，再下结论。

### Phase 1 — host 路由 + client 运行时 + 接线（§4/§5 全部）✅ 已完成（实测全绿）

验收（Playwright 系统 Chrome E2E + 实测）——**实测结果回填**：
1. ✅ 本场景 beta 开 → canvas 层出现、首帧后 img 淡出（canvas 300ms 淡入等价）、**无 scene-anim 请求发出**（headed GUI 实测 0 个）；
2. ✅ 红角/蓝眼追踪：生产运行时 1080p 匹配 t（lastT 原子取帧）vs CPU staticFrame **MAD=1.266 ≤2**，亚像素偏移 (0.16,0.16) <0.5px（与 spike 1.247 一致）；
3. ✅ 性能（玻璃开）：真实 GUI 30s 帧时 **P95=16.80ms（n=1801，p50=16.70，max=16.80，vsync 锁定）≤20ms**；5min soak 无 contextlost 无 pageerror；
4. ✅ "无接缝"条款：599 连续帧差分 MAD 中位数 0.517 / 上界 0.549（<3× 中位数）；
5. ✅ beta 关 → 静态帧（无 GL 无 scene-anim）；`weSceneGL=0` → mp4 路径（scene-anim 请求发出）；不支持场景（bloom 变体实测 `supported:false reason:"bloom"`）→ 自动 mp4；
6. ✅ GL→mp4 回退：contextlost→自动重建回 GL_RUN→二次丢失→glFailed(`contextlost-twice`)→mp4，全程兜底 img/video 层在无黑帧；GL↔mp4 连切 10 次路径全对、无 pageerror；
7. ✅ 回归三件套：verify-client PASS / verify-transcode-state PASS / verify-scene 8过1失败（"no scene wallpaper with frameUrl on this machine" 环境断言，基线同款，与改动无关）。

**E2E 修出的三个真实 bug（已修）**：① buildMedia 重建重赋 className 会抹掉已火的 `we-media--gl-ready`（按 `sceneGL.ready` 幂等重挂）；② sceneVideo 404 回退路径里 syncLayers 先于 trySceneGL 跑（sceneGL 仍 null 建成纯 img），canvas 永远不进层 → trySceneGL 成功路径补 `emit()` 触发重建挂载；③ onError 不清 `window.__weSceneGL` 诊断钩子（补清理）。**E2E 顺带验证的特性**：pauseOnBattery 电池放电 → GL 暂停（initStage='done' frames=0）= WE 对齐遮挡暂停语义正确生效。

### Phase 1.5 — gate 放宽 + 三新效果（waterwaves/foliagesway/shake）✅ 已完成

触发：用户新增 6 张场景壁纸全回退 mp4。逐张判定：**5 张正确回退**（粒子发射器/workshop 粒子/audio_bars/lens_flare/workshop 自定义效果，见 details §13）；**鸣潮-卡提希亚（3478544779）解锁**：单 image 对象 + 三效果全默认常量。gate 放宽：hdr 单独（仅 bloom 读取，bloom 先拒）与 cameraparallax（仅鼠标驱动，CPU 恒静止）不再拒绝；eye 透传为 viewShift；combo 门禁泛化（PERSPECTIVE/DUALWAVES/MODE/AUDIOPROCESSING）。

验收（headless 4K 链 + headed GUI）：
1. ✅ 基座 4K MAD 0.000；单效果 waterwaves 0.744 / foliagesway 0.828 / shake 2.154（vs 官方语义 CPU）；全链 4K MAD 2.58（仲裁带内，热图确认边缘亚像素残差——LINEAR vs CPU NEAREST + float 相位，非结构差异）；
2. ✅ GUI 真机：GL_RUN + canvas ready + 无 mp4 + 0 scene-anim 请求；
3. ✅ 02 回归 MAD 1.367（基线 1.266 同档）；回归三件套与基线一致。

修出的真 bug（details §13 全录）：parseMetaGL 嵌套花括号截断（combo 静默丢失→编译错，readBalancedJson 平衡扫描修复）；uniformsFrag 跨阶段语义冲突（foliagesway speeduv 5 被 speed 1 覆盖）；FBO hw/hh 缺失（链式 resolution NaN）；flowmask 空槽回退中灰（对齐官方 util/noflow 零位移，白回退会全图位移）；shake.vert 隐式 common.h 前置补 stub。**CPU 新发现两处官方语义偏差**（shake 位移单位缺 ×w/×h → mp4 从未生效；mask UV 缩放用 mask/object 比而非官方 header/mip0 比）——已回滚，与既有两项合并入用户仲裁清单。

### Phase 2（后续，不在本 plan）

bloom/hdr、相机 paths/zoom/视差、多对象与混合模式（扩多对象前 gate 先加 `blending ∈ {translucent, normal}`——材质级 blending 现未查，单对象 alpha=1 时 src-over 与 opaque 等价故 Phase 1 无风险）、更多效果白名单（按三档分层排期：简单 ~10 个纯 UV/颜色数学直接可放；中等 ~8 个多纹理+resolution uniform 需纹理派生 combo 覆盖；难 ~6 个 blur 多 tap/composite-mask/godrays/depthparallax/blend 需逐个补 gate 条件——gate 的"pass 数==1"挡不住 blur 型组合语义）。

## 7. 性能与定位（诚实声明）

- GL 路径的赢面 = **消除循环接缝 + 无限时长 + 100% 忠实原作 + 零首渲染等待**；**不声称比视频硬解省电**（循环 1080p60 硬解通常比 GL 着色+合成更省）。内嵌视频场景永远优先 `<video>`（§2.9 不变量）。
- 预期负载：1080p canvas × 2 全屏 pass（每像素 ~3 次双线性采样 + 少量 ALU）→ 核显毫秒级以下，P95≤20ms 门槛现实。
- 首帧链路瓶颈 = host decodeTex(4K)+PNG 编码（1-3s）→ host 内存 LRU（§4.4）；期间静态帧 img 作底图，体验不劣于现状。

## 8. 风险与缓解（合并后）

| 风险 | 缓解 |
|---|---|
| scene-player.js 前例冻结原因不明，可能重蹈 | Phase 0 第一步冻结归因（§6.1）；本方案九项差异设计（§2.8） |
| g_TextureNResolution 约定歧义（官方 quirk：用 normal 分辨率缩放 mask UV） | spike 判别实验（§6.4）三约定对比，以原作视觉仲裁；结论记 WE-REVERSE.md |
| ES 1.00 原样编译边角（v_Scroll 未写 varying、引擎注入 uniform 无默认值） | spike 编译冒烟；引擎注入表（g_Time/MVP/g_TextureNResolution）照附录 §5 显式赋值；300 es 备选（附录 §2.2） |
| common.h/common_perspective.h 自带版与官方出入 | 只实现用到的函数；rotateVec2 已按官方语义核对；squareToQuad 几何验证（附录 §1）；PERSPECTIVE=1 白名单拒绝 |
| uniform 映射错（material→csv 键） | host parseMetaGL 生成映射表；缺失用 shader 默认；spike 对帧验证 |
| 4K 纹理首帧传输 1-3s | host LRU + 静态帧底图淡出；shader 编译先于纹理下载（失败快速退出） |
| GPU contextlost | dispose→重建一次→再失败回退 mp4（§2.11） |
| 多标签/多窗口 | GL context per-document 无共享冲突；host 路由只读；成本=重复解码（LRU 对冲）+2×GPU；dispose-on-switch 保上下文数安全 |
| 回退闪烁 | canvas 首帧后才显示；GL→mp4 像素差分无黑帧（验收 6） |
| build 拼接破坏现有 bundle | build 后 verify-client 回归；拼接逻辑只加不改（附录 §7） |

## 9. 非目标

- 粒子/puppet/3D 模型的 GPU 化（继续 CPU 预渲染）
- WebGL1 专用路径（fract hack 不值）；**WebGPU**（WGSL 整条新管线，对 2 个全屏 pass 无收益）；**OffscreenCanvas+Worker**（主线程每帧只有几次 draw call，worker 化收益不抵复杂度）
- host 端 GPU 渲染（native 依赖）
- 改 mp4 预渲染路径的任何行为（保留为回退）
- 正式版 ~/.dsh 实例（只在 dev ~/.dsh-dev 验证）

## 10. 开放问题（全部关闭）

1. **g_TextureNResolution 约定**——【Phase 0 关闭】**定案 lwe 约定 (mip0.w, mip0.h, header.w, header.h)**（lwe CTexture::setupResolution 可考 + 判别实验①证据链，附录 §11）。

已关闭（v1 开放问题）：模块加载（定案 build 拼接，§2.7）；canvas/img 过渡（定案首帧后 300ms 淡出，§5.2）；g_Time 起点（定案从 0，与 WE 行为一致）。

已关闭（Phase 0 spike 实测）：v 轴方向（y-down 全链路，推翻附录 §3 flipY 方案）；ES 1.00 原样编译可行性（可行，需两条 int 字面量 fixup）；angles 旋转（弧度/正角 CCW/像素空间刚体）；slot0 wrap（CLAMP 跟 CPU）；附带实锤并修复 CPU 渲染器三处 bug（附录 §10.6）。
