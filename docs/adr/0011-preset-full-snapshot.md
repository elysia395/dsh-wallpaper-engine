# ADR-0011: 预设从「玻璃子集快照」升为「整机配置快照」（preset: glass-subset snapshot → full-profile snapshot）

- **Date**: 2026-10-11
- **Status**: Proposed
- **Deciders**: 用户（产品口径）+ 实现（本仓）
- **Amends**: ADR-0008 D4 的「预设方案 = 高级配置」分类前提不变；本 ADR 只改**快照范围**
- **Revised**: 2026-10-11（同日二次修订）—— 用户追加三条口径，**取代**初版对应条目：
  ①**出厂预设一并重建**（「黑客绿(Fish)」按用户本机现配置只读抄写）；
  ②**旧预设直接作废、不做兼容**（**撤销**初版 D4 的"旧 tag 读容忍"）；
  ③**新增预设的导入 / 导出**，且**保存进预设栏与导出为文件时都弹对话框**，让用户勾选
  是否携带实体资产（字体 / 吉祥物 / 头像；**头像也进可选项、默认不勾**），
  并在对话框里说明不携带会怎样。⇒ D4 / D5 重写，新增 D6 / D7。

## Context

用户口径（原话要点）：**「内置预设在导入后仍有部分设置没一键导入，使得预设不像预设；
我想让保存的预设把这个插件的所有配置存入」**。

### 可测事实（符号名 / 路径作锚点，不写行号与数值）

1. **快照范围是硬编码的玻璃子集。** 预设正文的键白名单是 `GLASS_PRESET_KEYS`
   （`lib/settings-schema.js`），由「固定键 + `GLASS_CHILDREN` 登记表生成键」拼成；
   而 settings 的可持久化键集是 `KINDS` − `FONTSET_KEYS` − `DEFAULTS_ONLY` − `CLIENT_ONLY`。
   两者的**差集**就是「预设带不动」的那批键 —— 覆盖：配色 / 壁纸层滤镜 / 播放 / 系统 /
   扩展（特效、视差）/ 吉祥物 / 光标 / 字体 / 头像。复算方式：
   `Object.keys(KINDS)` 减去 `GLASS_PRESET_KEYS`（再按上式的三个集合取交）。

2. **出厂预设文件本身也已过期。** `lib/glass-presets/*.json` 每套只写一部分
   `GLASS_PRESET_KEYS`（缺 `glassDarkSeparate` / `thinkingNative` / `titlebarGlass` 与
   标题栏、思考条两族参数）。缺键由 `sanitizeGlassPresetValues` 补默认值 ——
   于是「导入出厂预设」会把这几项**重置为默认**，而不是保持用户现值。
   这正是「不像预设」的一个独立成因（与范围问题正交）。复算方式：
   对每个 `lib/glass-presets/*.json` 求 `GLASS_PRESET_KEYS` 的差集。

3. **应用路径只做一次合并 + 一次落效。** `applyGlassPreset`（`src/preset-store.js`）
   读回正文 → `sanitizeGlassPresetValues` → `Object.assign(selection, values)` →
   `persistSelection()` → `applyEffects()` → `emit()`。

4. **落效是订阅驱动的，覆盖面比想象中宽。** `emit()`（`src/client.js`）广播给
   `subscribe` 的监听器；挂载点注册了 `syncLayers` / `applyEffects` / `syncFxLayer` /
   `syncParallaxLayer` / `syncAvatarLayer`。⇒ 壁纸层、玻璃、特效、视差、头像**都能**
   靠一次 `emit()` 落效。

5. **但有一批键不在订阅链里，必须显式接线。** 实测：`syncRotationTimer()` 的调用点
   全部是显式调用（`client.js` 各处理器 + `media-prep.js`），`syncLayers` 体内**不含**
   它。同理 `syncSceneAudio` 不在 `syncLayers` 里。⇒ 「轮播开关 / 场景实时渲染 / 帧率档 /
   适配目标 / 帧率上限 / 播放倍速」这类键，光靠 `emit()` 落不了效。

6. **三类资产的「本体」不在 settings 里。** 字体值住 `fontsets/<id>.json`（`FONTSET_KEYS`
   已退出 settings 持久化白名单）；头像与吉祥物只存**文件名**（`avatarUserImage` /
   `avatarAiImage` / `mascotImage`），图本体在宿主数据目录的 `avatars/` 与 `mascot/`。
   `config.json` 本身是包封结构 `{ fontSetId, settings }`。

7. **预设族刻意没有 import / export 链路。** `lib/routes/presets.js` 文件头明记：
   「第一版不背分享链路；导出/导入若要做，应当连着『分享到市场』一起设计」。
   与本 ADR 的关系：一旦预设携带资产本体，预设文件就变成**可分享的归档**，
   这条既有决策的边界会被触及（见 D4）。

8. **收体有上限，且有结构守卫钉住。** `lib/routes/presets.js` 的 `PRESET_MAX_BYTES`
   走共享读体器；`test/verify-body-caps.mjs` 对「收 body 的路由必须有上限」有棘轮。
   ⇒ 预设正文一旦携带 base64 资产，上限必须重新论证，不能沿用。

9. **保存预设目前没有对话框。** `saveGlassPreset(name)` 直接 POST（`src/preset-store.js`），
   面板侧只有一行「名字 + 保存 / 取消」（`renderGlassPresetsBlock` 的 `saveRow`）。
   ⇒ D4 的资产勾选必须**新增**这一步，且要能表达"不勾会怎样"。

10. **本仓有成熟的"对话框 + 勾选"先例可照抄。** `src/fontset-editor.js` 的
    `<input type="file">` 隐藏 + 按钮触发（`accept` 只做提示，真正的门是 `$schema`），
    以及 `renderConfirmRow` 的两步确认行 —— 都不使用原生模态（本仓纪律：
    `verify-presets` ④ 断言预设 UI 无 `window.confirm`）。D4 / D7 的对话框必须沿用这条形态。

### 约束

- **`sanitizeGlassPresetValues` 的「快照盖当前版本号」是承重设计**：不盖版本号，
  `sanitizeFromSchema` 入口的 `migrateSettings` 会把已在新刻度上的值当旧档整批重写
  （实测 `glassAlpha` 70 → 100）。范围扩大后这条必须同样成立。
- **两端同源消毒**：客户端保存前与宿主落盘前都过同一个 sanitize（见
  `src/preset-store.js` 与 `lib/routes/presets.js` 的不变量段）。
- **`glassMode` 与 `GLASS_CHILDREN` 生成键必须继续自动跟随登记表**，不得手抄第二份。

## Decision

**D1 — 预设升为「整机配置快照」，分四段：settings 段 + 三个资产段。**
键集划分（**互斥且穷尽**，每个 `KINDS` 键恰好落一段；复算方式见 D2）：

| 段 | 内容 | 携带方式 |
|---|---|---|
| **settings 段** | 全部观感与行为键 | 数值，总是携带 |
| **字体段** | `FONTSET_KEYS`（7 键） | 数值 + 字体集名，**按需**携带 |
| **吉祥物段** | `mascotImage` / `mascotImageBox` | 文件名 + 显示盒 + **图片本体**，**按需**携带 |
| **头像段** | `avatarUserImage` / `avatarAiImage` | 文件名 + **图片本体**，**按需**携带（默认不勾） |

**硬排除**（既不进 settings 段也不进任何资产段，理由随项）：
- **内容 / 指向本机文件**：`id`（当前壁纸）、`hiddenIds`（隐藏了哪些壁纸）、
  `rotationGroups` / `rotationGroupId` / `rotationSeeded`（轮播列表与游标）、
  `userProps`（按壁纸 token 索引的属性）。
  理由：它们描述「现在用哪张 / 藏了哪些」，不是「这个插件怎么配置」；
  跨机与分享时指向本机绝对路径，必然失效。
- **运行期记忆 / 诊断**：`sceneLiveFailures` / `noticeSeen` /
  `skinYieldRestoreId` / `skinYieldRestoreRotation` / `parallaxPluginDepths`。
  理由：它们是「发生过什么」的记账，不是用户意图；恢复它们等于凭空制造失败记忆。
- **`settingsVersion`**：由消毒路径盖当前版本号（承 §Context 第一条约束）。
- **已在候选集之外、无需列进排除表的**：`frameVariants` / `customFrames`（`CLIENT_ONLY`，
  宿主不收、本就是设备本地记忆）；`rotationInterval` / `sceneFrameUrl` / `themeTypeOnly` /
  `fontAdvanced` / `fontSetOpen`（`DEFAULTS_ONLY`，不持久化）。
- **不在 `KINDS` 里的派生字段**（`url` / `type` / `sceneVideo` / `sceneLiveSrc` /
  `sceneMediaBase`）：它们由当前选择派生、不是设置键，天然不在候选集内。

**D2 — 键集单一来源改为「从 `KINDS` 派生 + 显式分段表」。**
新增 `PRESET_ASSET_KEYS`（三个资产段的键）与 `PRESET_EXCLUDED_KEYS`（硬排除），
派生的 `PROFILE_PRESET_KEYS` = `KINDS` − `DEFAULTS_ONLY` − `CLIENT_ONLY`
− `PRESET_ASSET_KEYS` − `PRESET_EXCLUDED_KEYS`（即 **settings 段**）。
**不再手写第二份白名单** —— 新增设置键自动进 settings 段，除非显式落进资产段或排除表。
理由：本仓的实测结论是「手抄的键表必然漂」（`GLASS_CHILDREN` 登记表的存在理由即是此）。
守卫按「`KINDS` 的每个键必须**恰好**落在四段之一」双向对账（缺一即红、重叠即红）。
复算方式：`Object.keys(KINDS)` 减去 `DEFAULTS_ONLY` / `CLIENT_ONLY` /
`PRESET_ASSET_KEYS` / `PRESET_EXCLUDED_KEYS`。

**D3 — 落效补一条「整批重应用」入口，不逐键模拟处理器。**
`applyGlassPreset` 改名/扩展为 `applyPreset`，落效段改为：一次 `Object.assign` →
`persistSelection()` → **`reapplyAll()`** → `emit()`。
`reapplyAll()` 是一个新的显式编排点，按序做 `emit()` 覆盖不到的那几件事：
`syncRotationTimer()`、`syncSceneAudio(selection)`、场景层重建（`syncLayers()`）、
以及字体族（`applyEffects()` 内的字体分支已覆盖，无需重复）。
**不逐键调用 `on*` 处理器** —— 那些处理器混着「写设置 + 清记忆 + 重建层」三种职责，
复用它们会把 `onToggleSceneLive` 的「清失败记忆」副作用带进来，与 D1 排除运行期记忆矛盾。

**D4 — 资产按需携带，由用户在保存 / 导出时勾选。**
预设正文是**归档**：settings 段总是带，三个资产段**各自可选**。

- **字体段**：内嵌活动字体集的 `FONTSET_KEYS` 值 + 集名。应用时**写回字体集**
  而不是塞进 settings（它们不在 settings 白名单里），走 `setFontValues` / `persistFontSet`。
- **吉祥物段**：内嵌图片本体（base64）+ 文件名 + 显示盒。应用时落盘到 `mascot/`
  再写文件名（形状必须过 `MASCOT_FILE_RE`，复用 `lib/routes/mascot.js` 的落盘语义）。
- **头像段**：内嵌两张图的本体 + 文件名。应用时落盘到 `avatars/` 再写文件名
  （形状过 `AVATAR_FILE_RE`，复用 `lib/routes/avatar.js` 的落盘语义）。
- **勾选默认值**：字体段**默认勾**、吉祥物段**默认勾**、头像段**默认不勾**
  （用户口径：头像体积翻倍、与「分享一份外观配置」关系最弱）。
- **不勾的后果必须在对话框里写出来**（用户明确要求）：不勾字体 ⇒ 换机 / 分享后
  字体颜色与排版回落接收方当前那份；不勾吉祥物 ⇒ 回落内置立绘（maid / whale）；
  不勾头像 ⇒ 回落内置默认头像（我方人像 / 助手四角星）。
  **数值键不受影响**：`avatarEnabled` / `avatarSize` / `avatarRadius` / `ropeForm` /
  `ropeScale` / `ropeShown` 恒在 settings 段 —— 不勾资产只是「图不是我的那张」，
  尺寸与开关照常生效。
- **段缺席的语义（两段不同，必须分清）**：
  · **settings 段**是**完整快照** —— 缺键补默认值（承既有不变量「整套采用或整套不动」）；
  · **资产段缺席 = 那一族键保持用户现值不动**，不是回落默认。
  理由：资产是**附加负载**，不带它不等于「把它清空」—— 否则一份没勾字体的预设
  会把接收方调好的字体抹成默认，与 D4「不勾 = 回落接收方当前那份」自相矛盾。
  ⇒ 应用时的判据：**正文里有的段才写**，缺席的段一个键都不碰。

**D5 — 上限与安全重新论证（承 Context 第 8 条）。**
携带 base64 资产后上限必须重算，并给**单份资产的字节闸**（超限则拒绝并说明是**哪一项**，
不做静默截断）。资产文件名与内容一律走既有消毒路径，**不新增第二条落盘通道**：
落盘复用 `lib/routes/mascot.js` / `lib/routes/avatar.js` 已经验证过的原子写 + 同族清理语义。

**D6 — 旧预设直接作废，不做兼容（撤销初版 D4 的读容忍）。**
schema tag 升版后，**旧 tag 的预设文件一律读不出**：宿主按「读不懂」处理（沿用
`readPresetAt` 既有的 `bad-version` 分支 → 清单标 `broken`、面板禁用且只留删除），
**不写迁移、不写读容忍**。理由（用户口径）：旧预设只含玻璃子集，按新语义解释会得到
「一半是预设、一半是当前值」的混合体 —— 那正是用户要消灭的「不像预设」。
⚠️ 连带影响（必须一起做，否则用户看到的是"预设没了"而不是"该重存"）：
- 面板对 `broken` 的既有文案要**点明是版本作废**（而非笼统"读不出来"），并给出
  「重新保存一份」的出路。
- **出厂预设一并重建**（用户口径）：七套 `lib/glass-presets/*.json` 按新 tag 与新范围重写，
  补齐既有缺失键。其中「黑客绿(Fish)」按**用户本机现配置**（只读抄写）重建。
- 墓碑文件（`GLASS_PRESET_TOMBSTONE_TAG`）**保持原样不动** —— 它记的是"这套出厂被删了"，
  与正文版本无关；改了它会让用户删过的出厂预设复活。

**D7 — 新增导入 / 导出，形态照抄字体集族（不另造一套）。**
- **导出**：`GET /glass-presets/<id>/export`，`Content-Disposition: attachment`，
  正文由**读到的值重建**（不照抄磁盘字节）—— 与 `lib/routes/fontsets.js` 的
  `<id>/export` 逐条同形。走**普通链接**，不引入 blob / `showSaveFilePicker`
  （本仓既有纪律，见 `src/preset-store.js` 的形态棘轮）。
- **导入**：`POST /glass-presets/import`，本地预检三道（读不出 / 非 JSON / tag 不对各给
  一句可判定文案）后交宿主权威校验，再按占用情况分配新 id —— 照抄
  `src/fontset-store.js` 的 `importFontSet` 与 `lib/routes/fontsets.js` 的 `import` 段。
- **导出对话框**：点「导出」先弹资产勾选对话框（D4 的三项 + 后果说明），确认后才发起下载。
- ⚠️ **与 `lib/routes/presets.js` 文件头「没有 import/export」那条既有决策的关系**：
  该段原文要求「导出/导入若要做，应当连着『分享到市场』一起设计」。本 ADR **推翻它的
  前置**（用户明确要"方便用户之间流转"），并**同批更新那段文件头注释** ——
  留着旧注释会让后来者以为这条路被禁着（本仓的实测教训：文档与实现不一致会持续误导）。

## Consequences

- **收益**：预设回到「一键套用我的整套配置」这个语义；新增设置键自动进 settings 段（D2），
  「预设带不动某个键」这类缺陷不会随功能增长而复现；预设可导出成自包含文件在用户间流转。
- **代价：预设不再只描述玻璃。** `GLASS_PRESET_*` 这一族符号名与
  `lib/glass-presets/` 目录名变成历史包袱（语义已扩大）。本 ADR 选择**保留路径与路由**
  （`/glass-presets`）不动，只改正文语义与展示文案 —— 改路径要迁移用户层文件与
  墓碑，收益不抵风险。⇒ 名字与语义的偏差记在这里，供后来者判断。
- **代价：应用预设变成「有副作用」的动作。** 它会重建壁纸层、重排轮播定时器、
  改字体集文件、可能落立绘与头像。⇒ 应用不再是「只改玻璃观感」的轻动作，
  ADR-0008 D4「无确认无撤销」的分类前提需要重新审视（见触发线）。
- **代价：旧预设作废（D6）。** 用户已存的预设需要重新保存一次；这是用户明确选择的
  取舍（"直接作废、强制重存，完全去更新它"），换来的是语义干净、无混合体。
- **代价：预设文件可能变大。** 携带 base64 资产后单份可达数百 KB 甚至 MB 量级；
  上限表要跟着调整。
- **放弃：逐键复用 `on*` 处理器。** 它们的副作用（清失败记忆、重建层）与
  「预设不携带运行期记忆」直接冲突。
- **放弃：旧预设的读容忍 / 迁移。** 见 D6 的理由。

## 重新考虑的触发线

- 若「应用预设」的副作用（重建层 / 改字体集 / 落立绘与头像）被判定需要用户确认：
  重开 ADR-0008 D4 的分类 —— 预设可能不再是「高级配置」，而是**需要确认的整机操作**。
- 若资产体积让预设文件超出可接受量级：改走「引用 + 内容寻址」而不是内嵌 base64。
- 若新增的设置键**天然属于**排除表（内容 / 运行期记忆）或资产段：
  把它加进 `PRESET_EXCLUDED_KEYS` / `PRESET_ASSET_KEYS` 并写明理由，
  不要靠"忘了加"来实现排除。
- 若将来要做「分享到市场」：本 ADR 只做了本地文件流转，市场那条链路仍待设计
  （`lib/routes/presets.js` 文件头的原始关切仍然成立，只是不再禁止本地导入导出）。
