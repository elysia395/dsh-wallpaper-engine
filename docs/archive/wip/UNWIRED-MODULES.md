# 未接线域模块盘点（9 个"发布面孤儿"）

<!-- status-banner: code-is-truth -->
> **状态：历史记录（不反映现行实现）。** 第二期 task-9（「发布面孤儿」盘点）的交付物，已收口：
> `node test/verify-reachability.mjs` 已由红转绿（0 不可达 / 0 行），九项裁定见本文 §14 / §16；
> 复核口径见 [`./DOC-ROT-REPORT-2.md`](./DOC-ROT-REPORT-2.md)。

> **哈希说明（squash 后）**：本文件中的短哈希是 **squash 前历史哈希**。追版本第二期收口已把
> `c43a936..352467a` 的 **108 笔**压缩为一笔（父 = `c43a936`，树内容逐字未变），该提交以 tag `catchup-2nd` 标注。
> 原文可由分支 `backup/pre-squash-20261014` 取得；逐条对应见该提交正文附录。
> 新增引用请优先使用 tag `catchup-2nd`。


> **task-9 交付物**（分支 `refactor/p0-library-ize`）。现象：`node test/verify-reachability.mjs`
> 判红 —— 9 个文件 / 2068 行在 `lib/**` 里、被 `package.json` 的 `files` 收进发布面，
> 却不在 `lib/index.js` + `lib/client.js` 的 import 图上。
>
> 本文逐模块给出**一句话裁定 + 可查证据**，并回答"哪些能安全删"。
>
> **本次实现：0 项删除 / 0 项移出发布面** —— 不是漏做，而是两类判据都不成立（§0.2）：
> ① 9 个模块**各自有一条直接 `import` 它的硬档守卫**（都在 `test/run-guards.mjs` 的链上），
> 删除即 `ERR_MODULE_NOT_FOUND` ⇒ 按 task-9 规则 3「硬档变红 ⇒ 立刻回退并改判」；
> ② 其中 **7 个带活侧缺失的上游内容**（4 个有运行时/源码级实证）⇒ 删掉就是**丢修复**。
> 因此结论是 **(b) ×7 + (a) ×2（删除前置在测试线）**，接线方案与最小改动集见 §10。

---

## 0. 速览

| # | 孤儿（行数） | 活侧真源 | 裁定 | 一句话理由 |
|---|---|---|---|---|
| 1 | `lib/transcode.js`（638） | `lib/media/transcode.js` | **(b)** | 上游在"在途命中"分支回调 `onEntry` 让加入者也进等待者账本，活侧 `return entry.promise` 让第二个客户端被 502 |
| 2 | `lib/media-probe.js`（187） | `lib/media/mp4-probe.js` | **(b)** ★ | 同一份 v1 `mdhd` 字节流：孤儿 fps=**30**（正确），活侧 fps=**128849018880**（`timescale<<32`） |
| 3 | `lib/video-preview.js`（110） | `lib/media/video-preview.js` | **(b)** | 上游用 `produced` 旗标判产出，活侧只看"文件在不在" ⇒ 失败那次留下的残片会被当"永久坏图"发布 |
| 4 | `lib/config-store.js`（132） | `lib/kernel/config.js` | **(b)** | 上游 `readConfig()` 有 `!Array.isArray(o)` 硬化，活侧没有 ⇒ 数组配置让设置写**静默丢失且不可逆** |
| 5 | `lib/host-diag.js`（130） | `lib/diag-trace.js` | **(b)** | 上游轮转前有 `existsSync` 保护，活侧没有 ⇒ 诊断文件被外部清理后 `renameSync` 每次抛、被外层吞 ⇒ 本进程诊断通道静默死亡 |
| 6 | `lib/cache-prune.js`（131） | `lib/media/transcode.js` + `lib/media/video-preview.js` + `lib/startup-sweep.js` | **(a)** | 21 个声明里 16 个逐字命中活侧，其余 4 个函数语义等价（只差 `let x;`→`let x = []`）⇒ 能力重复品；**删除前置=判据重写**（§6） |
| 7 | `lib/asset-paths.js`（189） | `lib/kernel/host-kernel.js`（就地）+ `lib/media/media-dirs.js` + `lib/we-assets.js` | **(a)** | 34 个声明里 29 个逐字命中活侧；**删除会同时红 3 条链上守卫**（两处是硬 `readFileSync`，§7） |
| 8 | `lib/wallpaper-scan.js`（285） | `lib/we-discovery.js` | **(b)** | 上游把它拆成"安装/库发现 + 枚举"两族、各有独立守卫；合并版是本分支 P0 的取舍，不是上游的更新 |
| 9 | `lib/steam-discovery.js`（266） | `lib/we-discovery.js` | **(b)** | 同上（`locateWallpaperEngineP` / `owningLibrariesP` + `steamProbeDirsP` / `wslSteamRootsP` / `resolveRegExeP` 三族文体与活侧不同） |

★ = 有运行时实证（§2）。

### 0.1 三条共同事实（都可复算，命令见 §12）

1. **9 个都是 `origin/main` 的逐字副本**：`git diff --numstat origin/main -- <file>` 对 9 个文件
   全部为空。它们不是"本分支搬家的残留"，而是**上游当前版本**随合并落进工作树（内容与分支的
   迁移结果分叉 ⇒ git 不能合并成一份）。
2. **9 个各自都有直接 `import` 它的链上守卫**：`test/run-guards.mjs:103,116,133,135,149,150,152,154,155`
   分别挂 `verify-transcode-state` / `-media-probe` / `-cache-prune` / `-wallpaper-scan` /
   `-config-store` / `-steam-discovery` / `-host-diag` / `-video-preview` / `-asset-paths`。
   这些守卫 `import` 的正是孤儿本体（例：`test/verify-cache-prune.mjs:20`）。
   ⇒ **删文件 = 静态 import 解析失败 = 链上守卫当场红**。
3. **判据读取面分三类**，删除时必须逐处处理（`§11` 给了清单）：
   - **硬 import**：模块不存在直接抛（上表 9 条主守卫，`test/verify-config-store.mjs:22-23`、
     `test/verify-upload-store.mjs:25` 是第二消费者）；
   - **硬读文本**：`readFileSync`，不存在即抛（`test/verify-contracts.mjs:29` 用在 `:133`/`:229`；
     `test/verify-presets.mjs:769`；`test/verify-we-install-probe.mjs:256-261`；
     `test/verify-scene-live.mjs:1800`）；
   - **容忍读**：`readAnyOf(...)` / `try{readFileSync}catch{return ''}`，静默退化为空串
     （`test/verify-cache-dir.mjs:287`、`test/verify-scene.mjs:38-46`）——不抛，但断言可能静默变色。

### 0.2 为什么本次一项都没有删

两条**互相独立**的判据，各自都足以否决删除：

- **规则 3 判据（流程性）**：上表 9 个模块各有一条链上守卫直接 import 它。删掉即硬档变红
  （`ERR_MODULE_NOT_FOUND`，不是软档、也不是"锚点漂"）。按 task-9 规则 3「若删除后任一硬档判据
  变红 ⇒ 立刻回退该项并改判」，这 9 项在**判据没被重写之前**一律不能删。
  守卫也**不能摘**：链成员与顺序被 `test/fixtures/verify-chain.json` 冻结（`verify-guard-chain` 逐字比），
  且 `test/verify-package-files.mjs:286` 的 `CHAIN_FLOOR = {verify:24, docs:1, smoke:5, all:29}`
  会判"链静默缩水"。所以唯一的正解是**重指判据**（`§11`），那是测试线的改动。
- **内容判据（实质）**：7 个模块带活侧缺失的上游内容。最硬的一条是 §2 的运行时实证：
  活侧 `lib/media/mp4-probe.js` 读 v1 `mdhd` 读错，而**唯一读对的那份代码就在孤儿里**。
  删孤儿 = 把修复删掉、把缺陷留在发布面上。

因此本次的"低风险实现"是 **零删除 + 每项一份可排期的改动集**，而不是"为了绿掉软档判据而拆守卫"。

---

## 1. `lib/transcode.js`（638 行）→ 裁定 (b)

**一句话**：上游在 `transcodeToFps` 的**在途命中**分支上先回调 `onEntry(entry)` 再返回同一个
promise（让加入者也进等待者账本），活侧 `if (entry) return entry.promise;` 让"发起者断开"升级成
"整体取消"，第二个客户端拿到 502。

**证据**
- 孤儿：`lib/transcode.js:544-550` —— 含注释「直接 `return entry.promise` 会让加入者永远进不了账本
  ⇒ waiters 只算发起者一个 ⇒ 发起者一断开就 cancel（kill ffmpeg + 删 tmp），而仍在等的其他客户端拿到 502」，
  随后 `if (typeof onEntry === 'function') onEntry(entry);`。
- 活侧：`lib/media/transcode.js:599` 正是 `if (entry) return entry.promise;`（同一函数的另一处
  `onEntry(entry)` 在 `:639`，**不是**在途命中分支）。
- 判据：`test/verify-transcode-state.mjs:118-217`（SLICE 11）——`:171` 的行为判据与 `:216` 的
  **源码形态**判据 `joinsThroughOnEntry(tcText)` 都要求"在途命中分支在返回前先回调 onEntry"。
  该判据现在测的是孤儿（绿）；一旦把它指向活侧就会红 —— 即活侧确实缺这条修复。
- 活侧独有（不能整文件替换）：`ensureDirOnce` 记忆化、`sweepTranscodeArtifacts`、
  `sweepCustomFrameTmp`、`cacheBaseDir` / `videoPreviewCacheDir` / `pluginRoot` 注入、`dispose()`。

**处置（留方案，§10-A）**：把 `lib/transcode.js:544-550` 那 7 行（含注释）搬进
`lib/media/transcode.js` 的在途命中外支；再把 `verify-transcode-state.mjs` 的 `import`/`SRC`
重指到 `lib/media/transcode.js`，逐条比对它的 8 处源码形态变异锚点。

## 2. `lib/media-probe.js`（187 行）→ 裁定 (b) ★运行时实证

**一句话**：同一份 v1 `mdhd` 字节流，孤儿读出正确的 `fps=30`，活侧读出 `fps=128849018880`
（把 4 字节 `timescale` 当 u64 读 ⇒ `timescale<<32`）—— 活侧真源有缺陷，孤儿带着修复。

**证据（运行时）**—— 一次性探针（脚本见 §12.3，落在 `.test-cache/`，不入库）：

```
mdhd v0  期望 fps=30 duration=0.33
  lib/media-probe.js (origin/main 孤儿)  fps=30             duration=0.33   ← 正确
  lib/media/mp4-probe.js (本分支真源)    fps=30             duration=0.33
mdhd v1  期望 fps=30 duration=0.33
  lib/media-probe.js (origin/main 孤儿)  fps=30             duration=0.33   ← 正确
  lib/media/mp4-probe.js (本分支真源)    fps=128849018880   duration=0.33   ← 缺陷
```

**证据（源码）**
- 孤儿 `lib/media-probe.js:133-140`：v1 `timescale` = `readUInt32BE(off+header+20)`、
  `duration` = `readBigUInt64BE(off+header+24)`，并写着"v1 的 timescale 是 4 字节不是 8 字节
  …… 曾把 v1 读成 u64@20/u64@28 ⇒ timescale 被读成 `timescale<<32`、fps 变 206158430208 这种垃圾。
  判据：`test/verify-media-probe.mjs` 的 D3（v1 走 64 位分支）+ D4"。
- 活侧 `lib/media/mp4-probe.js:126-131`：`readBigUInt64BE(off+header+20)` / `readBigUInt64BE(off+header+28)`
  —— 正是被点名的那两种读法。
- 判据侧的**独立尺子**同意孤儿：`test/verify-media-probe.mjs:147-154`（自己按 ISO 14496-12 走盒树，
  v1 `timescale@mdhd+28` 仍 u32、`duration@mdhd+32` u64），并写明"把它当 u64 读会静默变成
  `timescale<<32`（实测 206158430208 fps）"。
- 用户可见面：`/media-info` 的"源 4K · 120fps"提示与**帧率上限跳过转码的决策**都吃这个读数
  （`lib/media-probe.js:6-11` 的调用点说明）。

**处置（留方案，§10-B）**：把孤儿 `:133-140` 的偏移修法（+注释）搬进 `lib/media/mp4-probe.js`；
把 `test/verify-media-probe.mjs` 的 `import`/`SRC` 重指到 `lib/media/mp4-probe.js`
（该守卫的期望值本来就与被测实现异源，重指后 D3/D4 立刻变成"钉住活侧缺陷"的回归锚点）。

## 3. `lib/video-preview.js`（110 行）→ 裁定 (b)

**一句话**：上游用 `produced` 旗标判"这次真的出帧了"，活侧退回"文件在不在"——ffmpeg 抛错那次
留下的 0 字节/半张残片会被 `renameSync` 当成品发布，在该缓存键下留**永久坏图**。

**证据**
- 孤儿：`:15-16`（不变量 5）、`:69`（注释）、`:70`（`let produced = false;`）、`:86`（`produced = true`）、
  `:90`（`if (!produced) throw …`）。
- 活侧：`lib/media/video-preview.js:150`（`if (existsSync(tmp)) { lastErr = null; break; }`）、
  `:154`（`if (!existsSync(tmp)) throw …`）。
- 判据：`test/verify-video-preview.mjs:234`（D2「失败留下的残片不得被当帧发布（真缺陷回归：
  lead 裁决'spawn 抛 ⇒ 该次尝试无产出'）」）、`:359`（D2 的变异体跑同一段判据）、
  `:148-150`（`M_LEFTOVER` 变异体 = 把 `!produced` 换回 `!existsSync(tmp)` ⇒ **活侧的形态就是那条变异体**）。
- 活侧独有：`videoPreviewCacheDir` / `pruneVideoPreviewCache` / `pruneCacheDirBySize` /
  `TRANSCODE_CACHE_MAX_BYTES`（被 `lib/startup-sweep.js` 消费）⇒ 也不能整文件替换。

**处置（留方案，§10-C）**：把 `produced` 语义搬进 `lib/media/video-preview.js`（保留活侧 prune 面），
再把该守卫的夹具从注入契约
`{ensureVideoPreviewCacheDir, resolveFfmpeg, spawnFfmpeg, VIDEO_PREVIEW_WIDTH, VIDEO_PREVIEW_MAX_CONCURRENT}`
改到活侧契约 `{cacheBaseDir, ensureDirOnce, transcodeKit}`。

## 4. `lib/config-store.js`（132 行）→ 裁定 (b)

**一句话**：上游 `readConfig()` 拒绝数组（`!Array.isArray(o)`）——数组也是 `typeof 'object'`，
放进来后续写的是**非索引属性**，`JSON.stringify([])` 仍是 `"[]"` ⇒ 设置写静默丢失且此后每次写都丢；
活侧 `lib/kernel/config.js` 没有这层。

**证据**
- 孤儿 `lib/config-store.js:33-36`（注释 + `!Array.isArray(o)`）。
- 活侧 `lib/kernel/config.js:25`：`return o && typeof o === 'object' ? o : {};`（无数组判定）。
- 判据：`test/verify-config-store.mjs:87` 点名"非索引属性、`JSON.stringify([])` 仍是 `"[]"` ⇒
  设置写静默丢失（`lib/config-store.js` 已修）"；该守卫 `:22`/`:27` 直接 import / 读孤儿源码。
- 活侧独有（体量大得多）：`mergeSettings`（队内读-改-写）、`fontSetsDir` / `glassPresetsDir` /
  `readFontSetId` / `setFontSetId` / `commitFontSetMigration` / `withLegacyFontValues`
  ⇒ 不能整文件替换，只能**移植那一行**。
- 重指难点：活侧 `createConfigKit()` **无 `configPath` 注入缝**（配置路径来自
  `lib/kernel/data-dir.js` 的 `configPath()`，认 `DSH_WE_DATA_DIR`）⇒ 判据的
  `createConfigStoreKit({ configPath })` 夹具**不能原样重指**，需要改成"先设 `DSH_WE_DATA_DIR`
  再动态 `import()`"或给 `createConfigKit` 留一条注入缝（后者是 lib/kernel 的改动）。
- 第二消费者：`test/verify-upload-store.mjs:25` 也 import 孤儿。

**处置（留方案，§10-D）**：① 把 `!Array.isArray(o)` + 注释搬进 `lib/kernel/config.js`；
② 判据改隔离口径（env + 动态 import）或加注入缝；③ 之后才是删除。

## 5. `lib/host-diag.js`（130 行）→ 裁定 (b)

**一句话**：上游轮转前先 `existsSync` 再 `renameSync`（并注释"rename ENOENT 若不加防，此后每次
append 都在 rename 处抛、被外层 catch 吞，诊断通道对本次进程**静默死亡**"），活侧去掉了这层保护。

**证据**
- 孤儿 `lib/host-diag.js:45-55`（注释 + `if (existsSync(file)) { try { renameSync(...) } catch {} }`）。
- 活侧 `lib/diag-trace.js:41-44`：直接 `if (diagBytes >= DIAG_MAX_BYTES) { renameSync(file, file + '.1'); }`
  —— 无 `existsSync`、无内层 `try/catch`（外层 catch 一吞，此后 append 每次都在 rename 处失败）。
- 判据：`test/verify-host-diag.mjs:20`（import 孤儿）、`:25`（`SRC`）、`:440-444`（H2 自检"本文件确实
  静态读到被测模块"）⇒ 删除/重指都必须同步这条自检。
- 活侧独有：`traceMediaRequests`（`:112-133`）与更宽的返回面（`DIAG_MAX_BYTES` / `diagBytes` /
  `REQ_LOG_*` / `reqLogSeen` / `reqLogSeenTouch`）⇒ 移植而非替换。

**处置（留方案，§10-E）**：把 `existsSync` 保护搬进 `lib/diag-trace.js` 的轮转分支；重指守卫的
`import`/`SRC`。

## 6. `lib/cache-prune.js`（131 行）→ 裁定 (a)，但删除前置在测试线

**一句话**：能力重复品 —— 它的四个函数现在住在活侧两个 kit 的返回值里，语义一致；删不掉的原因
是判据（13 个按源码文本改写的变异体）没有对应的活侧工厂可指。

**证据（能力等价）**
- 声明覆盖率（§12.2 探针）：21 个声明，**16 个在活侧逐字存在**；余下 4 个函数名在活侧同名但文体差
  `let x;` → `let x = []`（`sweepTranscodeArtifacts` / `sweepCustomFrameTmp` 在
  `lib/media/transcode.js`；`pruneVideoPreviewCache` / `pruneCacheDirBySize` 在
  `lib/media/video-preview.js`）。逐条口径一致：`.tmp<pid>\d*$` 正则、10 分钟 `.tmp` 年龄门、
  512 份缩略图上限、4 GiB / 5 分钟 LRU 门、`ownTmpSuffix` 保护。
- 消费面：`lib/startup-sweep.js`（时点编排）+ `lib/kernel/host-kernel.js:197`（解构两个 kit 的清扫面）。

**证据（删除为何被阻塞）**
- `test/verify-cache-prune.mjs:20` 直接 `import { createCachePruneKit }`；活侧**没有同名工厂**
  （四个函数分居 `createTranscodeKit` / `createVideoPreviewKit` 的返回值）。
- 该守卫的牙全长在孤儿的源码文本上：`:24` `SRC`、`:89-99` `loadMutant`（落 tmp 后 `import`）、
  `:246-395` 共 13 个变异体、`:228-236` "工厂只暴露 5 个名字"、`:402-404` G3 直读 `SRC`.
- 第二个消费者：`test/verify-config-store.mjs:23`（跨模块临时名契约）也 import 孤儿。
- ⇒ 删除项的前置是**判据重写**（把夹具换成两 kit 的适配器、变异体裁剪到活侧两份源码），
  属测试线（`test/**` 归 test-audit / guards-wiring）；按规则 3，判据未重写前不删。

**处置（留方案，§11）**：判据重写（模板见 §11.2）→ 删文件 + 去 `files` 条目 →
`node test/tools/guard-targets.mjs --write` 重算派生映射 → 跑三条判据。

## 7. `lib/asset-paths.js`（189 行）→ 裁定 (a)，但删除会同时红 3 条链上守卫

**一句话**：能力重复品 —— 活侧把同一批能力拆在 `host-kernel` 就地实现 / `media-dirs` / `we-assets`
三处；删不掉的原因是判据面有**两处硬读文本**，删除会连带红掉 `verify-contracts` 与 `verify-presets`。

**证据（能力等价）**
- 声明覆盖率（§12.2）：34 个声明，**29 个在活侧逐字存在**。
- 落点对照：
  - `defaultUploadDir` / `resolveUploadDir` → `lib/kernel/host-kernel.js:211-217` **就地实现**
    （`:212` `() => join(pluginDataDir(), 'uploads')`、`:213-216` env → `config.uploadDir` → 默认，
    与孤儿 `:29-34` 同逻辑；且 `:204-205` 注释已自陈"本分支**没接线那个 kit**……下面两行就是就地实现"）；
  - `customFrameDir` / `liveFrameDir` / `avatarDir` / `mascotDir` / `avatarPath` / `mascotPath` /
    `AVATAR_*` / `MASCOT_*` / `UPLOAD_EXT` / `CUSTOM_FRAME_EXT` → `lib/media/media-dirs.js`
    （+ 组件行消费：`lib/components/mascot-avatar/*` 的 `DEPS` 点名这些键）；
  - `getWeAssetsDir` / `listWeAssetNames` / `weAssetsAvailable` / `WE_ASSETS_SOURCE_ID` /
    `setWeAssetsDir` / `resolveWeAssetsDir` → `lib/we-assets.js`。

**证据（删除为何被阻塞 —— 比 §6 更硬）**
- `test/verify-asset-paths.mjs:22`（import）`:28`（`SRC`）——主守卫，32 条判据 + 源码变异体。
- **硬读文本**：`test/verify-contracts.mjs:29` 的 `read = (rel) => readFileSync(join(ROOT, rel), 'utf8')`
  在 `:133`/`:229` 读 `lib/asset-paths.js` ⇒ 文件不在**直接抛**；
  `test/verify-presets.mjs:769` `readFileSync(join(root, 'lib', 'asset-paths.js'), 'utf8')`
  同样直接抛（且 `:767-772` 的注释声明"读点变更（T2 #8）……只改'读哪个文件'"）。
- 容忍读（会静默退化，必须一并清理）：`test/verify-cache-dir.mjs:287` 的
  `readAnyOf('lib/asset-paths.js', 'lib/media/media-dirs.js', 'lib/upload-dir.js')`。
- ⇒ 删除前必须先改这三处读点（改到 `media-dirs.js` / 组件行常量 / `we-assets.js`），
  再把主守卫的夹具从 `createAssetPathsKit` 换成"`createUploadDirKit` + `createMediaDirsKit` +
  `we-assets` 函数"的组合。这同样是测试线改动。

**处置（留方案，§11）**：同 §6 的四步，且额外清理 `verify-contracts` / `verify-presets` /
`verify-cache-dir` 三处读点。

## 8. `lib/wallpaper-scan.js`（285 行）→ 裁定 (b)

**一句话**：上游按"安装/库发现"与"枚举"两族拆分、各带独立守卫；本分支 P0 把两族合成
`lib/we-discovery.js` 一个 kit，属**分支自己的取舍**，不是上游的重复品 —— 按附录 F.2 的裁决
（`docs/wip/BUNDLE-SPLIT.md:585`「**取上游**（待接线；上游有 `verify-wallpaper-scan` /
`verify-steam-discovery`）」）该接线。

**证据**
- 活侧：`lib/kernel/host-kernel.js:65` `import { createWeDiscovery }`、`:162-166`
  建一次并解构 `pathExistsP, mtimeOrNullP, locateWallpaperEngineP, owningLibrariesP, …`。
- 声明覆盖率：孤儿 47 个声明，**36 个在活侧逐字存在**；缺的是两族拆分带来的文体
  （`enumerateWallpapersAsync` 的版本、`resolveSceneMainFileP`、`scanSignatureP`、`extOf`
  以及 `schemeToCss` / `resolveSceneMainFileP` 的注入位置）。
- 契约差异（可查）：孤儿 `:31` `createWallpaperScanKit({ WE_APPID, pathExistsP, isFileP, isDirectoryP })`
  ——`isFileP` / `isDirectoryP` **由调用方注入**；活侧 `lib/we-discovery.js:83,90` 把它们做成 kit 内部函数
  （`:314`/`:389` 消费）。即"谁提供这三个谓词"正是拆分与合并的分界线。
- 判据面：`test/verify-wallpaper-scan.mjs:23`（import，66 条判据）、
  `test/verify-scene-live.mjs:1800`（**硬读**该文件找 `function extOf(p)`）、
  `test/verify-module-layout.mjs:462`（提到该路径的历史搬移）。
- 历史：分支为扫描族的分叉打过两轮定位（`docs/wip/BUNDLE-SPLIT.md:660-700`），轮 7 结论是
  "发现族无罪、问题在枚举/解析层"，并写明"若两轮内仍不能定位，则**按附录 F.2 采纳上游两族拆分**"。

**处置（留方案，§10-F）**：见 §10。

## 9. `lib/steam-discovery.js`（266 行）→ 裁定 (b)

**一句话**：与 §8 同源 —— 上游这一族负责"Steam/WE 安装与库归属"，并在**同一层**算清
installDir 与 owningLibraries，本分支把它塞进合并版 `we-discovery`。

**证据**
- 活侧：`lib/kernel/host-kernel.js:162-166`（同上）。
- 声明覆盖率：孤儿 38 个声明，**34 个在活侧逐字存在**；缺 `resolveRegExeP` / `wslSteamRootsP` /
  `steamProbeDirsP` 的对应文体（这三个名字在活侧存在，文体不同）。
- 上游返回面窄而明确：孤儿 `:264` `return { locateWallpaperEngineP, owningLibrariesP };`
  ⇒ 它**不提供** `isFileP` / `isDirectoryP`，那三个谓词由调用方给（活侧内置）。
- 判据面：`test/verify-steam-discovery.mjs:23`（import，29 条判据 + 13 个变异体）、
  `test/verify-we-install-probe.mjs:256-261`（**硬读**该文件源码，`:261` 直接 `readFileSync(..., 'steam-discovery.js')`）。

**处置（留方案，§10-F）**：见 §10。

---

## 10. 接线最小改动集（7 个 (b) 项，给 Lead 排期）

> 落点全部在 **`lib/media/**` 或 `lib/kernel/**`** —— 不在 task-9 的写范围（禁区含 `lib/media/**`，
> `lib/kernel/**` 也未授权），所以本节只给方案。顺序都遵循"**先移植 → 再删孤儿 → 再重指判据**"，
> 任何一步都不许为了让 `verify-reachability` 变绿而放宽基线。

| 项 | 最小改动 | 落点 | 需要/依赖 | 判据面同步 |
|---|---|---|---|---|
| **A** `transcode` | 把 `lib/transcode.js:544-550`（在途命中分支的 `onEntry(entry)` + 注释）搬进活侧同分支 | `lib/media/transcode.js:599` 一带 | 无新注入（`onEntry` 已是形参） | `verify-transcode-state.mjs` 的 import/`SRC` + 8 处源码形态锚点 |
| **B** `media-probe` | 把 `lib/media-probe.js:133-140` 的 v1 `mdhd` 偏移修法（u32@+20 / u64@+24 + 注释）搬进活侧 | `lib/media/mp4-probe.js:126-131` | 无（零依赖套件） | `verify-media-probe.mjs` import/`SRC`（33 条立刻转为活侧回归锚点） |
| **C** `video-preview` | 把 `produced` 旗标（`:70/:86/:90` + 注释）搬进活侧，**保留**活侧 prune 面 | `lib/media/video-preview.js:150/:154` | 无新注入 | `verify-video-preview.mjs` 夹具注入契约改 `{cacheBaseDir, ensureDirOnce, transcodeKit}`；D2/M_LEFTOVER 原样保留 |
| **D** `config-store` | 把 `!Array.isArray(o)` + 注释搬进活侧 `readConfig` | `lib/kernel/config.js:25` | 无新注入 | `verify-config-store.mjs` / `verify-upload-store.mjs` 需**新的隔离口径**：活侧 `createConfigKit()` 无 `configPath` 注入缝 ⇒ 要么改判据为"先设 `DSH_WE_DATA_DIR` 再动态 import"，要么给 `createConfigKit` 补一条注入缝（lib/kernel 决定） |
| **E** `host-diag` | 把轮转前的 `existsSync` + 内层 `try/catch` 保护搬进活侧 | `lib/diag-trace.js:41-44` | 无新注入 | `verify-host-diag.mjs` import/`SRC` + `:440-444` H2 自检 |
| **F** `wallpaper-scan` + `steam-discovery`（成对，一次做完） | 在 `host-kernel` 里由 1 个 kit 换成 2 个：先 `createSteamDiscoveryKit({ WE_APPID, pathExistsP })` 取 `{locateWallpaperEngineP, owningLibrariesP}`，再 `createWallpaperScanKit({ WE_APPID, pathExistsP, isFileP, isDirectoryP })` | `lib/kernel/host-kernel.js:65` 与 `:162-166` | **需补 `isFileP` / `isDirectoryP`**：上游由门面供给，活侧现在是 `lib/we-discovery.js:83,90` 的内部函数 ⇒ 要么把这两个谓词提到调用点（fs 实现），要么从活侧套件导出。`pathExistsP` 已是内核键（`:162`）。另外 `we-discovery` 的返回面被多处内核键消费（`mtimeOrNullP` / `readPlaylistsP` / `pathKey` 等）⇒ 必须逐键对账 `verify-inject-contracts` | `verify-wallpaper-scan.mjs`、`verify-steam-discovery.mjs` 重指到两个新文件；`verify-we-install-probe.mjs:256-261` 与 `verify-scene-live.mjs:1800` 的**硬读文本**改到新落点；`we-discovery.js` 退出 import 图（或按裁决保留为薄聚合层） |

**排期建议**：A/B/C/E 是"逐 hunk 移植"，彼此独立、可并行（都在 `lib/media/**` 与 `lib/kernel/**`，
写者要互斥）；D 卡在"判据隔离口径"的决策上；F 是**成族移植**（改门面装配 + 两个判据重指 +
注入契约对账），应先做 §10-F 的键集对账，再动装配。

## 11. 待删项（§6/§7）与全部删除项的"四处引用"同步清单

### 11.1 同步清单（每删一个文件都要走完）

1. **判据读取面**（`test/**`，归测试线）：硬 import → 重指或改写夹具；硬读文本 →
   改到真源；容忍读 → 清掉指向已删文件的候选路径。
2. **`package.json` 的 `files`**：删掉该条目。注意 `test/verify-package-files.mjs` 的
   **P1 断言 `files` 覆盖 `lib/` 下每一个文件**（`:118-122`）⇒ **只删条目不删文件必红**；
   反之文件删了条目留着无害但应在同一次提交里清掉。
3. **代码与文档里的相对路径**：`lib/upload-dir.js:5,10,57` 与
   `lib/kernel/host-kernel.js:204`（指向 `lib/asset-paths.js` 的注释，`docs/archive/wip/DOC-DRIFT-REPORT.md:97-99`
   已记为遗留缺口）；`lib/config-store.js` 的临时名契约注释（`DEV-GUIDE.md:465` 引用它）；
   `lib/media-probe.js` 的调用点说明等。
4. **封装面登记表 / 派生映射**：`docs/GUARD-MAP.md` 是 `test/tools/guard-targets.mjs --write`
   的生成物 ⇒ 改完守卫必须重算；`test/verify-package-publish.mjs:292` 的 `DEV_ONLY` 表只在
   `package.json` 钩子引用未发布文件时才需要动（本次 9 个目标都不涉及）。
   另：**链成员冻结**在 `test/fixtures/verify-chain.json`（`verify-guard-chain` 逐字比）
   + `test/verify-package-files.mjs:286` 的 `CHAIN_FLOOR` ⇒ 守卫只能**重指**，不能摘除。

### 11.2 `verify-cache-prune.mjs` 的重写模板（§6 的前置）

```js
// 活侧两个 kit 的适配器：把分居两处、语义等价（仅 let x; → let x = []）的四个函数重新合成一"套"
import { createTranscodeKit } from '../lib/media/transcode.js';
import { createVideoPreviewKit } from '../lib/media/video-preview.js';
const makeKit = (dirs) => {
  const boom = () => { throw new Error('未注入的目录解析器被调用'); };
  const tk = createTranscodeKit({
    cacheBaseDir: boom, configPath: boom,
    videoPreviewCacheDir: dirs.preview || boom,
    getMediaInfo: () => null, atomicTmpPath: (p) => p, pluginRoot: ROOT,
  });
  const vk = createVideoPreviewKit({ cacheBaseDir: () => dirs.root, ensureDirOnce: (d) => d, transcodeKit: tk });
  return {
    sweepTranscodeArtifacts: tk.sweepTranscodeArtifacts,
    sweepCustomFrameTmp: tk.sweepCustomFrameTmp,
    pruneVideoPreviewCache: vk.pruneVideoPreviewCache,
    pruneCacheDirBySize: vk.pruneCacheDirBySize,
    TRANSCODE_CACHE_MAX_BYTES: vk.TRANSCODE_CACHE_MAX_BYTES,
  };
};
```
配套要改：13 个变异体的**多源改写**（`loadMutant` 目前只读一个 `SRC`，要扩成"目标文件 + 文本变换"），
`:228-236` 的"只暴露 5 个名字"改成"适配器暴露 5 个名字"，
`:402-404` G3 的 `SRC` 直读改成读两个活文件里对应函数的形态。

### 11.3 `verify-asset-paths.mjs` 的重写要点（§7 的前置）

- 夹具：`createAssetPathsKit` → `createUploadDirKit`（`lib/upload-dir.js:66`）+
  `createMediaDirsKit`（`lib/media/media-dirs.js:16`）+ `lib/we-assets.js` 的 `createWeAssetsKit`
  三者的组合；上传目录解析在活侧已由 `host-kernel.js:211-217` 就地实现 ⇒ 判据要么承认这是注入点、
  要么把 `defaultUploadDir` / `resolveUploadDir` 的实现提到一个叶子（那会改动 lib/**，需 Lead 决策）。
- 另外两处**硬读文本**先改：`test/verify-contracts.mjs:133,229`、`test/verify-presets.mjs:769`
  → 改读 `lib/media/media-dirs.js` / `lib/components/mascot-avatar/*` 里的同名常量真源；
  容忍读 `test/verify-cache-dir.mjs:287` 清掉 `lib/asset-paths.js` 这个候选。

---

## 12. 复算命令

### 12.1 现象与共同事实
```bash
node test/verify-reachability.mjs                      # 软档：红（9 个 / 2068 行）
for f in lib/asset-paths.js lib/cache-prune.js lib/config-store.js lib/host-diag.js \
         lib/media-probe.js lib/steam-discovery.js lib/transcode.js lib/video-preview.js \
         lib/wallpaper-scan.js; do git diff --numstat origin/main -- "$f"; done   # 全部为空
grep -n "verify-\(asset-paths\|cache-prune\|config-store\|host-diag\|media-probe\|steam-discovery\|transcode-state\|video-preview\|wallpaper-scan\)" test/run-guards.mjs
node test/verify-package-files.mjs && node test/verify-package-publish.mjs        # exit 0
```

### 12.2 声明覆盖率与语义差（本次一次性探针，未入库）
- 声明覆盖率：逐声明在活侧文件里做"忽略空白"的逐字查找
  （本次实测 `cache-prune` 16/21、`asset-paths` 29/34、`transcode` 82/90、`media-probe` 40/44、
  `video-preview` 9/12、`config-store` 16/18、`host-diag` 17/18、`wallpaper-scan` 36/47、
  `steam-discovery` 34/38）。
- 语义差：`git diff --no-index --ignore-all-space -U0 -- <孤儿> <活侧>`。

### 12.3 v1 `mdhd` 运行时实证（§2）
`.test-cache/wiring-audit/mdhd-v1-probe.mjs`：按 ISO 14496-12 造 v0/v1 两份最小 mp4，
分别喂 `lib/media-probe.js` 的 `getMediaInfo` 与 `lib/media/mp4-probe.js` 的
`createMp4ProbeKit().getMediaInfo`，打印两份读数（v1 期望 fps=30；实测活侧 128849018880）。
脚本落在 `.test-cache/`（不入库、不随包发布）；若要留成常驻锚点，应把其中"活侧必须读对 v1"的
断言并入 `test/verify-media-probe.mjs` 的 D3/D4（见 §10-B）。

---

## 13. 本次验证证据

| 判据 | 结果 |
|---|---|
| `node test/verify-reachability.mjs` | exit 1（软档，9 个 / 2068 行；**基线未改**，按 Lead 口径不为绿而放宽） |
| `node test/verify-package-files.mjs` | exit 0（`ALL PACKAGE FILE CHECKS PASSED`；本次未改 `files`） |
| `node test/verify-package-publish.mjs` | exit 0（`ALL PACKAGE PUBLISH CHECKS PASSED`） |
| 9 条主守卫（改动前基线） | 全部 exit 0：`verify-asset-paths`(32) · `verify-cache-prune`(28) · `verify-config-store`(24) · `verify-host-diag`(48) · `verify-media-probe`(33) · `verify-steam-discovery`(29) · `verify-wallpaper-scan`(66) · `verify-video-preview`(31) · `verify-transcode-state` |
| 本次对 `lib/**` / `package.json` / `test/**` 的改动 | **无**（0 文件）—— 依据 §0.2 的两条判据，删除项一律改判/留方案 |

---

## 14. task-10 收口（第一批 A/B/C/E 已落地）

Lead 裁决走"移植 → 删孤儿"路线后，§10 的第一批四组已按"每项一次提交 + 逐项验证"落地：

| 项 | 提交 | 搬了什么 | 判据重指到 | 验证 |
|---|---|---|---|---|
| B `media-probe` | `6e74947` | 孤儿 `:133-140` 的 v1 `mdhd` 偏移修法（u32@+20 / u64@+24 + 注释）→ `lib/media/mp4-probe.js` | `test/verify-media-probe.mjs`（import / `createMp4ProbeKit`） | 33 passed；v1 实证脚本两份实现读数一致（30/30） |
| A `transcode` | `36949c5` | 孤儿 `:544-550` 的 `onEntry(entry)` 在途命中分支 → `lib/media/transcode.js` | `test/verify-transcode-state.mjs`（import + 3 处 `readFileSync` + kit 夹具 deps） | ALL PASSED（SLICE 11 行为 + 源码形态 + 两条负对照） |
| C `video-preview` | `d9d69d8` | 孤儿 `:70/:86/:90` 的 `produced` 旗标 → `lib/media/video-preview.js`（并恢复 `VIDEO_PREVIEW_WIDTH` / `MAX_CONCURRENT` 可选注入、返回面加 `videoPreviewCachePath`，prune 面原样保留） | `test/verify-video-preview.mjs`（import/SRC + 夹具注入契约） | 31 passed / 13 变异体（D2 负对照读数正是修复前真源行为） |
| E `host-diag` | `6d930f4` | 孤儿 `:45-55` 的轮转竞态保护（`existsSync` + 内层 `try/catch`）→ `lib/diag-trace.js`；工厂对外面收窄为被消费的 4 个名字 | `test/verify-host-diag.mjs`（import/SRC/工厂名 + H2 路径自检） | 48 passed（含 `race-unguarded` 负对照） |
| 删除批 | 本批末次删除提交 | 删 4 个孤儿（`lib/{media-probe,transcode,video-preview,host-diag}.js`）+ `package.json` `files` 去 4 条 + 例外表临时登记移除 + `docs/GUARD-MAP.md` 重算 | — | `verify-reachability` **9 → 5 个 / 2068 → 1003 行**（软档，基线未改）；guard-map / package 两判据全绿；`run-guards verify` 58 步 exit 0 |
| D `config-store` | `c7c323b` + 同批删除提交 | `createConfigKit` 补 `configPath` / `pluginDataDir` 注入缝（缺省仍走 `data-dir.js` 现算）；孤儿 `:33-36` 的 `!Array.isArray(o)` 硬化搬进真源 `lib/kernel/config.js`；两个判据重指真源，副本 `lib/config-store.js` 删除 | `test/verify-config-store.mjs`（import/SRC/工厂名；E1 去掉一条与键集断言重复的常量名断言；E3 导出面改成"内核消费面 15 名"；变异体说明符绝对化）、`test/verify-upload-store.mjs` | `verify-config-store`(24) / `verify-upload-store`(28) / `verify-settings-schema-exports`(15) / `verify-inject-contracts`(M8=100%) / `verify-settings-namespaces` / `verify-guard-map` / `verify-guard-chain` / `verify-module-layout` / package 两判据全 exit 0；reachability **5 → 4 个 / 1003 → 871 行**；例外表 **4 → 2 条** |
| F `steam-discovery` + `wallpaper-scan` | `a51576d` + 同批删除提交 | 装配改取上游两族拆分（`createSteamDiscoveryKit({WE_APPID, pathExistsP})` + `createWallpaperScanKit({WE_APPID, pathExistsP, isFileP, isDirectoryP, extOf, schemeToCss})`）；内核自出 4 个异步谓词；`extOf` / `schemeToCss` 改为**注入**（单一真源 `lib/fs-paths.js` / `lib/kernel/host-kernel.js`）；合并版 `lib/we-discovery.js` 删除 | `test/verify-wallpaper-scan.mjs`（`realDeps()` 注入两个真源；两处显式 deps 夹具补齐；D8 的 extOf 变异体改真源后注入）、`test/verify-scene-live.mjs`（extOf 落点改指 `lib/fs-paths.js`，落点更正非放宽） | 该两族判据 66 + 29 全绿；`verify-scene-live`(678) / `verify-scene`(132) / `verify-adapter` / `verify-we-install-probe`(19) / `verify-inventory-index`(23) / `verify-component-face`（内核 **98 键**逐字未变）· `verify-inject-contracts`（M8=100%）· `verify-types` · `verify-static`（见下方注）全 exit 0；reachability **4 → 2 个 / 871 → 320 行**（软档，基线未改）；例外表 **2 → 1 条** |
| G `asset-paths` | `147e1a4` + `30aa437` + `760441b` + 同批删除提交 | 两处硬读文本改真源（`verify-contracts` / `verify-presets` → `lib/media/media-dirs.js`）；`defaultUploadDir` / `resolveUploadDir` 从内核工厂体**提取**成叶子导出 `createUploadDirResolution()`（`lib/upload-dir.js`，内侧单源 + 三级优先逐字保留）；主守卫改**三源适配器** + 14 个变异体按源分派；副本 `lib/asset-paths.js` 删除 | `test/verify-asset-paths.mjs`（三源合并 kit 面：`upload-dir` / `media-dirs` / `we-assets`）、`test/verify-contracts.mjs`、`test/verify-presets.mjs`、`test/verify-cache-dir.mjs`（容忍读候选清理） | `verify-asset-paths` **32 条 / 14 变异体**全绿（负对照打在活侧真源上）· `verify-contracts` · `verify-presets`(225) · `verify-upload-store`(28) · `verify-cache-dir`(40) · `verify-component-face`（98 键）· `verify-inject-contracts`（M8=100%）· `verify-adapter` · `verify-module-layout` · `verify-dead-declarations` · `verify-guard-map` · package 两判据 全 exit 0；reachability **2 → 1 个 / 320 → 131 行**；例外表仍 **1 条** |

| H `cache-prune` | `1dfd854` + `5f9a1db` + 同批删除提交 | 先把多源变异体加载器提到共享 `test/tools/multi-source-mutants.mjs`（`verify-asset-paths` 改用它作等价性证明）；聚焦守卫改**两源适配器**（`lib/media/transcode.js` 的 `sweepTranscodeArtifacts`/`sweepCustomFrameTmp` + `lib/media/video-preview.js` 的 `pruneVideoPreviewCache`/`pruneCacheDirBySize`/`TRANSCODE_CACHE_MAX_BYTES`）+ 13 个变异体按源分派；`verify-config-store` 的跨模块临时名契约改指转码套件；副本 `lib/cache-prune.js` 删除 | `test/verify-cache-prune.mjs`、`test/verify-config-store.mjs`、`test/tools/multi-source-mutants.mjs`（新） | `verify-cache-prune` **28 条 / 11 变异体**全绿（D6/D11/D12 仍按原样 SKIP）· `verify-config-store`(24) · `verify-transcode-state` · `verify-video-preview`(31) · `verify-scene-live`(678) · `verify-child-kill` · `verify-component-face` · `verify-inject-contracts`（M8=100%）· `verify-module-layout` · `verify-dead-declarations` · `verify-guard-map` · package 两判据 全 exit 0；**顺带修真缺陷** `da00a7b`（真源缺 `dirname` import ⇒ ffmpeg 下载链与启动清扫抛 ReferenceError）；reachability **1 → 0**（棘轮自动转绿，基线未改） |

据此，本文件 §0 的裁定表对 A/B/C/E、D、F、G 与 H **九项全部收口**（修复/真源已接线 + 副本已删）；
`verify-reachability` 的不可达规模归零。

> **注（`verify-static`）**：该判据在本机**跑不起来**，与本次改动无关 —— 守卫自身的
> `spawnSync(…)` 撞沙箱的命名管道限制（`EPERM`），而直接复现它的两条工具命令时 eslint
> 连启动都失败（`Cannot find module …/@cacheable/memory/dist/index.cjs`，安装态损坏）；
> `tsc` 的 40 条报错全部落在**本次 diff 之外**（我的 hunk 在 host-kernel 的 import 段与
> 装配段，报错行在其后的 upload/dir kit 调用点与 `lib/components/media-bridge/**`）。
> ⇒ 该棘轮需要在本机 `npm ci` 后（或由 Lead 在完整工具链上）复核。

---

## 15. 方法论案例：判据重指真源当场挖出的一个真缺陷（`da00a7b`）

**结论**：把聚焦判据从"上游同名副本"重指到"活侧真源"，不只是清死码 —— 它会**第一次真的执行**
发布面的那条路径。本次在 cache-prune 重指（`5f9a1db`）时就撞出：

```
ReferenceError: dirname is not defined        ← lib/media/transcode.js:141（ffmpegDataDir）
```

**根因**：P0 把转码族搬进 `lib/media/` 时，`import { join, dirname } from 'node:path'` 被收窄成
`import { join } from 'node:path'`（同一刀把 `dirname(fileURLToPath(import.meta.url))` 换成了注入的
`pluginRoot`，于是以为 `dirname` 不再需要）—— 漏了 `ffmpegDataDir()` 这一处仍要用它。

**为什么三道网都照不到**：
1. `node --check` / 语法解析：合法（未定义标识符是**运行时**错误）；
2. 聚焦判据：那条判据当时测的是**上游副本** `lib/transcode.js`（它的 import 是全的），
   活侧真源从未被真的调用过；
3. `eslint no-undef`：本可当场抓到，但本机工具链不可用 ⇒ `verify-static` 按 Lead 裁定记
   "本机不可判"（见上注）。

**症状（两条用户可见路径，都是静默的）**：
· `resolveFfmpeg()` → `ensureDownloadedFfmpeg()`（`:295` `join(ffmpegDataDir(), …)`）**先炸** ⇒
  system PATH 兜底（`:375`）永远到不了 ⇒ 没设 `DSH_WE_FFMPEG`、也没有仓库内 `ffmpeg/` 的机器上
  **帧率上限抽帧与视频缩略图整条链失败**（那正是"下载一次缓存起来"的主路径）；
· `sweepTranscodeArtifacts()` 被 `lib/startup-sweep.js:47` 的 `try { … } catch { /* ignore */ }`
  吞掉 ⇒ **转码缓存/下载残片清扫静默永不执行**（磁盘只涨不落）。

**它印证的两条既有纪律**：
1. **"删 / 搬要连带查引用"**：这一刀同时改了 import 行与一处用法，改完没有回头数"这个模块里还有
   谁在用 `dirname`"。文件头里其实写着 `join(dirname(configPath()), 'ffmpeg')` —— 抄一遍 grep 就能发现。
2. **"静默失败最难查"**：两个症状都不报错可见（一个被 try/catch 吞、一个只在真起 ffmpeg 时才炸），
   判据与语法检查都看不见 ⇒ 只有"让判据真的走到那条路径"才能暴露。

**可复用的做法（本次因此成立）**：重指判据时优先**让真源被真的调用一次**（哪怕只为一个负对照），
而不是只做文本锚点比对；发现新缺陷就单独提交、写清证据链（本案例即 `da00a7b`），不要混进判据提交。

**现由常驻判据覆盖**：`test/verify-undefined-refs.mjs`（soft 档，`c2fa163`）—— 它扫
`lib/**` + `src/**` + `scripts/**` 里"用了但没 import/声明"的**非全局**内置名（`dirname`/`join`/
`spawn`/…），危险形状只认调用 `NAME(`；六条合成样本**每轮**自证牙齿（缺 import ⇒ 判出、import 齐全 /
成员调用 / 对象键 / 形参 / 字面量 ⇒ 不判），另有 `--prove-teeth` 把样本落盘复跑整条链。零依赖
（链的 P5 纪律：链上脚本不许有裸包 import）。

---

## 16. §14/§15 的结论怎么复算（五条证据 → 五条命令）

"上游同名副本未接线"这一类**已关闭**（§14 九项收口），同类余项也已盘清。下面每条都能**独立复算**，
不依赖任何一次性脚本；阈值写在命令旁边（判据只认这些阈值下的机器结论）：

1. **发布面里没有"不在 import 图上"的副本**（该类的主判据）：
   ```
   node test/verify-reachability.mjs
   ```
   期望：`ALL REACHABILITY CHECKS PASSED`（不可达 **0 个 / 0 行**；`BASELINE` 未动 ⇒ 绿不是放宽来的）。
   配套：`node test/verify-guard-map.mjs` ⇒ 例外表仍只有 1 条（`lib/components/mascot-avatar/index.js`）。

2. **上游那批同名文件确实已不在盘上**（不是"藏着"）：
   ```
   git ls-tree -r --name-only origin/main lib/ > "$TEMP/up.txt"; git ls-tree -r --name-only HEAD lib/ > "$TEMP/head.txt"; diff "$TEMP/up.txt" "$TEMP/head.txt"
   ```
   期望：`lib/media/{index,legacy,provision,supervisor}.js` 只出现在 `origin/main` 一侧
   （能力住 `lib/components/media-bridge/**`）——"是否与上游同构"这一项因此不需要再决策。

3. **全仓没有"用了但没 import/声明"的潜在 ReferenceError**（`da00a7b` 那一类）：
   ```
   node test/verify-undefined-refs.mjs                 # 期望 exit 0 / 145 个文件 / 零命中
   node test/verify-undefined-refs.mjs --prove-teeth    # 期望 exit 0（额外落盘复跑整条链）
   ```

4. **没有"同一份实现躺在两个路径"**（精确重复为 0；近重复阈值 Jaccard ≥ 0.5、仅 ≥40 行文件）：
   ```
   node --input-type=module -e 'import{readdirSync,statSync,readFileSync}from"node:fs";import{join}from"node:path";import{createHash}from"node:crypto";import{stripComments}from"./test/tools/js-text.mjs";const w=(d,o=[])=>{for(const n of readdirSync(d)){const p=join(d,n);statSync(p).isDirectory()?/webwallgl|vendor/.test(p)||w(p,o):n.endsWith(".js")&&o.push(p)}return o};const fs=[...w("lib"),...w("src")].filter(f=>!/webwallgl|vendor|client\.js$/.test(f));const byH=new Map();for(const f of fs){const h=createHash("sha256").update(readFileSync(f)).digest("hex");byH.set(h,[...(byH.get(h)||[]),f])}const ex=[...byH.values()].filter(v=>v.length>1);const st=fs.map(f=>[f,new Set(stripComments(readFileSync(f,"utf8")).split("\n").map(l=>l.trim()).filter(l=>l.length>2))]);const nr=[];for(let i=0;i<st.length;i++)for(let j=i+1;j<st.length;j++){const[a,n1]=st[i],[b,n2]=st[j];if(n1.size<40||n2.size<40)continue;let k=0;for(const l of n1)if(n2.has(l))k++;const jc=k/(n1.size+n2.size-k);if(jc>=0.5)nr.push(jc.toFixed(2)+"  "+a+"  <->  "+b)}console.log("精确重复："+(ex.length?JSON.stringify(ex):"无"));console.log("近重复："+(nr.length?"\n  "+nr.join("\n  "):"无"))'
   ```
   期望：精确重复 **无**；近重复只有 `mascot-avatar/avatar.js ↔ mascot.js`（0.60）—— 同形两条腿
   （头像 / 立绘），不是重复实现。

5. **同 basename 碰撞只剩 by-design 的配对**（叶 vs 路由族 / 门面 vs 组件入口）：
   ```
   node --input-type=module -e 'import{readdirSync,statSync}from"node:fs";import{join,basename}from"node:path";const w=(d,o=[])=>{for(const n of readdirSync(d)){const p=join(d,n);statSync(p).isDirectory()?/webwallgl|vendor/.test(p)||w(p,o):n.endsWith(".js")&&o.push(p)}return o};const m=new Map();for(const f of w("lib"))m.set(basename(f),[...(m.get(basename(f))||[]),f]);const d=[...m].filter(([,v])=>v.length>1);console.log(d.length?d.map(([k,v])=>k+": "+v.join("  ")).join("\n"):"无同 basename 碰撞")'
   ```
   期望：只有 `cache-dir.js` / `inventory.js` / `we-assets.js`（各为叶 + `lib/routes/` 族）与五个
   `index.js`（门面 + 组件入口 + `occlusion`）。

> 口径说明：第 4/5 条是**盘点期的探针**（一次性跑，不入链）；第 1/3 条已经**常驻**（分别是
> `verify:docs` 的软档步骤 —— 可达性与未定义引用）。第 2 条是与 `origin/main` 的对账，属"读者可自行
> 复算"的一类，不需要常驻判据（本分支与上游的关系由 `verify-guard-chain` / 发布面判据覆盖）。



