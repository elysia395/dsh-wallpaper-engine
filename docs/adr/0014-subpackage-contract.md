# ADR-0014: 子包规范 —— 独立子包行的成文契约（subpackage contract for `packages/<pkg>`）

- **Date**: 2026-10-15
- **Status**: Accepted
- **Deciders**: 用户（产品口径）+ 实现（本仓）
- **Depends on**: [ADR-0006](./0006-comment-discipline-as-written-convention.md)（注释与文档纪律）、
  [ADR-0007](./0007-machine-checks-target-code-not-prose.md)（机器判据只针对代码与磁盘，不针对散文）
- **Related**: [ADR-0002](./0002-settings-schema-single-source.md)（设置的单一真源）、
  [ADR-0003](./0003-build-time-module-inlining.md)（浏览器半边靠构建期内联）、
  [ADR-0004](./0004-two-tier-guard-verification.md)（守卫分两档）、
  [ADR-0013](./0013-bundle-multi-component-rows.md)（插件拆分：多包终态、行级开关、组件行）

> **本文是规范（normative），不是过程记录。** 条款用 `S<组>.<序>` 编号，机器判据在自己文件里
> 引用同一个条款号（"条款号 ↔ 判据"双向可查）。本文**不写会漂的数值**（[写作纪律 4](../README.md)）：
> 枚举面一律给**复算命令**或符号引用。**本文不设、也不接受任何针对本文或其它 markdown 的机械判据**
> （D3）；本文的存活靠人维护，见 D4。

## Context

### 这件事解决什么

插件拆分的第一个切片已经落地：主包 + 三个**独立子包行**（`packages/<pkg>/`）。但"子包该长什么样"
此前只散落在两处：一份**设计稿**（阶段计划与理由）和**若干守卫的判据名**。结果是三件具体的事：

1. **术语会串**：仓里有两个都叫"子包"的东西 —— 主包 `files` 内的组件行（`lib/components/<sub>/`，
   主包 patch 用**子路径名**引用）与独立子包行（`packages/<pkg>/`，patch 用**真名**引用）。
   混称会让"某条判据管的是哪一种"变成每次都要重新确认的问题。
2. **包面有洞**：`test/verify-subpackage-manifests.mjs` 的判据面是组件行（`lib/components/**`）；
   `packages/*` 的**清单面没有任何专用判据** —— 改坏 `version`/`exports`/`files`/`dsh.client`
   不会有一条判据变红，只会在真机插件列表或客户端加载时才现形。
3. **一致性靠人记**：子包自带的 `cordis.patch.yml` 与主包 patch 里那一行"必须逐字一致"、
   开发期与发布期的两种依赖形态（`file:` ↔ 同号精确版本）都只写在注释与计划里。

> **2026-10-16 修订（P-F 组件行统一）**：上面问题 1 与问题 2 的**形态**已消解 —— 三条组件行
> （`about-notice` / `mascot-avatar` / `media-bridge`）全部出户到 `packages/<pkg>/`（ADR-0013 D6/D8 的终态），
> 主包 patch 那一行改真名、`id` 不变，`lib/components/` 目录已删除；D3② 的可见面声明真源 `visibility.js`
> 移到 `lib/component-visibility.js`（内容与 `lib/index.js` 的再导出位置不变）。本 ADR 的问题清单与 S1.1
> 措辞**保留原样**，作为「为什么会有两种行」的历史记录。

### 用户口径（2026-10-15）

- 把子包的规则**写成成文规范**，并让**所有子包**（现有三个 + 后续拆出的）统一到它；
- 允许因此**调整部分子包**；
- 需要一张**树形依赖图**，形态用 **Mermaid**；
- **放弃对 markdown 的机器对账，交给人类防腐化** —— 任何针对 `.md` 的机械判据都不应存在。

### 可测事实（复算入口，路径即锚点）

- 独立子包 = `packages/<pkg>/package.json` 存在且 `name` === 主包名 + `-` + 目录名：
  `ls packages/*/package.json`。
- 主包 patch 里的两种行：子路径名（`name: '<主包名>/<sub>'`）与真名（`name: '<主包名>-<pkg>'`）：
  `node -e "…"` 或直接读 `cordis.patch.yml`；行 ⇄ 包的双向对账已由
  `test/verify-bundle-rows.mjs` 与 `test/tools/host-route-index.mjs` 的包发现层承担。
- 依赖方向（谁 import 谁）：`git grep -n "from '" -- packages`（子包宿主半边**零主包说明符**）、
  `git grep -n 'require("dsh-plugin-wallpaper-engine")' -- packages`（浏览器产物**只此一条**）。
- 清单字段全集与差异：逐个读 `packages/*/package.json` 与根 `package.json`。

## Decision

### D1 —— 规范的家就是本 ADR

规范**不再另开 `docs/*-SPEC.md`**：本 ADR 就是 `packages/<pkg>` 的成文契约。条款命名空间 `S*`；
守卫在文件头/判据名里引用条款号（例如 `S3.2`），本文在每条后面点名承担它的判据文件（或标 `[人工]`）。
好处：规范与决策同寿命，不会出现"规范文档漂了、决策文档没漂"两套真源。

### D2 —— 依赖方向是**两张平面**，不是一个树

子包与主包之间只允许两条受控边，方向相反：

- **宿主平面**（进程内、cordis 行）：主包 `apply()` 第一件事 `ctx.provide(HOST_SERVICE_NAME, …)`；
  子包 `inject: ['wallpaperEngineHost']` 后**只读**取用。子包宿主半边**零主包说明符**。
- **浏览器平面**（构建产物、客户端加载器）：主 bundle 冻结 `module.exports`；子包产物**唯一**允许的
  外部说明符是 `require("<主包真名>")`。

禁止边一律写进判据，不靠人记：子包 → 主包的任何 **value import**（含相对路径进主包目录）、
子包 → 子包、主包 → 子包实现文件（主包只能经**行名**加载子包 —— 这条**按行名**的 value import
是**宿主装载面**，不是跨包通道，受控例外见 S5.3）、子包 → 共享内核的第二次持有。

### D3 —— 判据只加在代码与磁盘上

按 [ADR-0007](./0007-machine-checks-target-code-not-prose.md) 的四问：本规范只把**能转成机械动作**
的条款交给守卫（清单字段、盘上文件、patch 行文本、依赖规格）；**措辞类条款标 `[人工]`**，
并且**本节管辖范围包含"不新增 md 判据"**：本 ADR 与依赖图都是人维护的文档，不配机器对账。
（既有的生成物逐字节判据是 ADR-0007 保留清单里的历史豁免，**本次不新增、也不在本轮改动**。）

### D4 —— 依赖图是人工维护的 Mermaid 文档

树形依赖图落 `docs/SUBPACKAGE-GRAPH.md`：两张平面的 Mermaid 图 + 边表（允许性）+ **登记点矩阵**
（每个包 × 每个登记点）。它**没有判据**；文档头必须写明这是**人工维护快照**并给复算命令，
腐化由人发现、人修（用户口径）。

### D5 —— "现行条款"与"待统一条款"分开登记

本轮**不动 `packages/**` 的清单字节**。规范里凡是现在还不统一、需要后续调整的，单独进
§现状偏差（`S*` 后标 `[待统一]`），不写进判据 —— 否则判据会一出生就红，或者被迫把判据放宽到没有牙。

## 规范正文

> 读法：`[机器判：<判据文件>]` = 有守卫钉住；`[人工]` = 只靠写作约定；`[待统一]` = 目标形态
> 尚未落地（见 §现状偏差）。条款号不可复用、不可重编号；废止的条款保留编号并标 `[已废止]`。

### S1 术语

- **S1.1 [人工]** 本规范把"子包"限定为**独立子包行**：`packages/<pkg>/`，主包 patch 里以
  **真名**（`name: '<主包名>-<pkg>'`）插入的一行。主包 `files` 内的
  `lib/components/<sub>/`（子路径名行；**2026-10-16 起仓里已无此形态**，三条组件行统一到 `packages/<pkg>/`）
  另行称为**组件行**，由 ADR-0013 与
  `test/verify-subpackage-manifests.mjs` 的组件行章节管辖。
- **S1.2 [人工]** **半边**：宿主半边（`lib/**`，进程内、由 cordis 行加载）与浏览器半边
  （`src/**` + 构建产物 `lib/client.<pkg>.js`，由客户端加载器按包级 `dsh.client` 加载）。
  一个子包可以只有宿主半边（**host-only 形态**），但**不许**声明没有实现的半边。

### S2 布局

- **S2.1 [机器判：test/verify-subpackage-manifests.mjs]** 每个 `packages/<pkg>/` 至少有：
  `package.json`、`cordis.patch.yml`、`icon.png`、`locale/en.json`、`locale/zh.json`、`lib/`。
- **S2.2 [机器判：同上]** 宿主半边入口 = 清单 `main`（默认 `./lib/index.js`），且该文件在盘上。
- **S2.3 [人工]** 宿主半边的路由族实现住 `lib/routes/<族>.js`（一个文件一条族，与主包同形）；
  入口 `lib/index.js` 只做"取服务面 → 注册族 → 交接拆卸"。

### S3 清单契约

**档位（2026-10-15 收口）**：本节全部机器判据挂**硬档**，在 `test/run-guards.mjs` 的 `VERIFY_STEPS` 里。
按 [ADR-0004](./0004-two-tier-guard-verification.md) 的分档判据（"失败时用户会不会看到错的行为"），清单面
是**发布面 / 打包面**：版本漂离主包、peer 范围与主包不逐字相等（I6：宿主整次安装被拒 + 回滚）、
`dsh.client` ⟺ `exports['./client']` 失配（C2：浏览器半边静默不加载）**都是用户侧后果**。
此前它挂在 `docs` 软档组里，包面回归不会让 `npm run verify` 变红 —— 那是分档错位，不是有意豁免。

- **S3.1 [机器判：verify-subpackage-manifests]** `name` === 主包 `name` + `-` + 目录名，且 ≠ 主包名
  （否则 Node 的最近清单解析会把主包劫持到子目录）。
- **S3.2 [机器判：同上]** `version` === 主包 `version`（**同号**；宿主不校验包组版本一致，
  一致性靠这条纪律）。
- **S3.3 [机器判：同上]** `main` 与 `exports['.']` 指向的文件在盘上，且**两处落点一致**
  （指向两个不同文件 = 谁在解析这个包都得猜）；`files` 覆盖所有
  `exports` 目标（`./locale/*.json` 这类通配按其前缀目录判）。
- **S3.4 [机器判：同上]** `exports['./client']` 存在 **⟺** `dsh.client` 存在，且 `./client` 目标在盘。
  两者都没有是**合法**的 host-only 形态。**禁止**为了"看起来统一"给 host-only 包补一个空的
  `./client`：那会让"声明了 `dsh.client` 就必须有浏览器半边"这条判据失去意义。
- **S3.5 [机器判：同上]** `peerDependencies` 的每个包名都在主包 `peerDependencies` 里；
  `@deepseek-ai/*` 的范围与主包**逐字相等**（范围不一致会让宿主的整次安装被拒并回滚）。
  `dependencies` / `peerDependencies` 里**不得**出现主包名或任何子包名 —— 子包之间、子包与主包之间
  **不是 npm 依赖关系**（D2 的两条边都不走 npm）。
- **S3.6 [机器判：同上]** `dsh.bundle.patch` === `'./cordis.patch.yml'` 且该文件在盘；
  `files` 至少覆盖 `package.json`、`icon.png`、`locale/`、`cordis.patch.yml`。
- **S3.7 [机器判：同上]** 清单是 `JSON.parse` 得过的 **LF、无 BOM** 文本（`JSON.parse` 不剥 BOM）。
- **S3.8 [机器判：verify-subpackage-manifests.mjs]** 字段集合与**键序**统一：判据自带一份**显式模板常量**
  （顶层键相对序 `name → … → files → [peerDependencies → peerDependenciesMeta] → license`、
  `files` 的规范**单行**字面量），**不以任何一份现成清单为基准**；必选键缺失、模板外的顶层键、
  相邻模板键逆序、`files` 不是单行字面量或排在 `dsh` 块之前，都判红。
  **同一形态**的包两两掩掉 `name` / `description` / `exports['./client']` 后必须**逐字相等**
  （`exports` 键序由此一并钉住）。
  跨形态的差异**不是**缺陷：字段集合取决于该包用不用某个面（例如 host-only 包没有
  `./client`/`dsh.client`，而注入宿主 `webServer` 面的包才需要那条 `peerDependencies`）—— 见 S3.5。
- **S3.8a [机器判：verify-subpackage-manifests.mjs]** 带显式 `exports['./install']` 的包是安装器形态，不与纯宿主包混做逐字对账。保留相同顶层键序、布局、版本、依赖及入口存在性规则；其规范单行发布白名单在基础五项之后依次增加 `tools/`、`assets/`、`src/`，确保工具、资源和构建源码都可交付。缺任意一项目录白名单、去掉安装入口后仍携带安装器形态，均由同一判据的负控判红。`pet-link` 属于此形态；安装器必须显式调用，不挂自动安装脚本，也不因此给主包或子包添加 `dsh-pet`、Electron 等桌宠依赖。
- **S3.9 [人工]** `description` 写"能力 + 半边归属"，并**只引用稳定文档**（见 S9.1）。

### S4 行与接线

- **S4.1 [机器判：verify-bundle-rows.mjs + test/tools/host-route-index.mjs + verify-subpackage-manifests.mjs]** 行的唯一真源是**主包 patch**：
  每条子包行必须在 `packages/*/package.json` 里被 `name` 逐字认领，且每个包都必须有行
  （无死行、无未登记的包；"行静默少一行"= 运行期少一个插件）。
- **S4.2 [机器判：verify-subpackage-manifests]** 子包自带的 `packages/<pkg>/cordis.patch.yml`
  里的 `insert` 行，其 `(id, name)` 与主包 patch 里对应行**逐字相等**。
  （自带那份只在"把这个子包当独立 bundle"时生效；两处不一致 = 同一个 id 装出两种形态。）
- **S4.3 [机器判：同上]** 行的 `id` === `wallpaper-engine-<pkg>`（id 一旦定下不可改：它是
  用户 profile 覆盖项与插件管理器开关的锚点）。
- **S4.4 [人工]** `name` 用**真名**（裸包名）；开发期解析靠目录 junction、发布期靠依赖 hoist，
  因此**开发期与发布期共用同一份 patch**，不许出现"两套行名"。

### S5 依赖方向（D2 的落地）

- **S5.1 [机器判：verify-subpackage-purity.mjs]** 宿主半边**零主包说明符**（含旧叶子写法），
  且**必须** `export const inject` 含 `'wallpaperEngineHost'` 并真的从 `ctx.wallpaperEngineHost` 取用。
- **S5.2 [机器判：verify-subpackage-client-half.mjs + verify-subpackage-purity.mjs]** 浏览器半边**只**允许一条外部说明符：
  构建期发出的 `require("<主包真名>")`；源码面（`src/**`）不许写 `require`/`import`。
- **S5.3 [机器判：verify-subpackage-purity.mjs]** 禁止边：子包 → 子包、子包 → 主包任何 value import、
  子包 → 共享内核的第二次持有（共享内核只许主包一份）。
  - **受控例外（宿主装载面，2026-10-16 P-F 三格出户起）**：主包门面按**行名（裸包名）** value import
    出户组件（`lib/index.js` 的 `import { applyImpl as … } from 'dsh-plugin-wallpaper-engine-<pkg>'`）
    **不属**跨包通道 —— 它是门面按组件名加载实现的**宿主装载面**；跨包通道只有
    `ctx.wallpaperEngineHost`（S5.1 / S5.2）。该边规格两态承接：开发期 = 根 `devDependencies` 的
    `file:packages/<pkg>`（S8.1），发布期 = 主包 `dependencies` 的**同号精确版**（S8.2）。
    依赖图 `docs/SUBPACKAGE-GRAPH.md` 的登记点"边 5"据此标为**已落例外**（不是禁止边）。
- **S5.4 [机器判：verify-subpackage-boot.mjs / verify-inject-contracts.mjs]** 服务面形状固定：
  服务名 `wallpaperEngineHost`，值 = `createSubpackageHost()` 的**冻结六键**
  `ids / keyNames / keys / handOff / schema / http`；键集与该包在
  `lib/subpackage-boot.js` 的 `SUBPACKAGE_KEY_TABLE` 里登记的键名**双向对账**（多给、少给都红）。

### S6 生命周期

- **S6.1 [机器判：verify-subpackage-boot.mjs]** 宿主半边导出形状固定：
  `export const name` / `export const inject` / `export function apply(ctx)` / `export default`；
  `apply` 的第一步是从服务面取键集与自检（缺 id 或缺键**大声抛**，不静默 `undefined`）。
- **S6.2 [机器判：verify-subpackage-toggle-roundtrip.mjs]** teardown 必须交 `ctx.effect`：
  经 `host.handOff(ctx, dispose)` 转发；零残留（关闭行后无遗留注册、无遗留 DOM 节点）。
- **S6.3 [人工]** 模块顶层只许 import / 声明：无求值期副作用、无定时器、无 `window`/`DOM` 访问；
  半边的 IO 一律**按需**（第一次请求才做），不做启动期扫描。

### S7 开关与重启

- **S7.1 [机器判：verify-subpackage-toggle-roundtrip.mjs]** 行级开关 = 该行的**宿主路由** +
  该行的**浏览器可见面**；关掉的形态必须"整体缺席"，而不是"界面还在、请求 404"。
- **S7.2 [机器判：同上（负对照）]** 关掉主包行 = 整族缺席：子包因 `inject` 服务消失而**级联 park**，
  不是"半挂"（服务面缺席必须表现为不加载，而不是运行时 `undefined`）。
- **S7.3 [人工]** 改动行内容 / 包代码需要重载或重启（patch 住在包目录，不在热更新监听面）。

### S8 发布形态

- **S8.1 [机器判：verify-subpackage-manifests]** **开发期形态**：主包 `devDependencies` 对每个子包都有
  `"<子包名>": "file:packages/<pkg>"`；主包 `dependencies` 里**不得**出现任何子包名，也不得出现
  `file:` 规格（未发布的包锁不出来 ⇒ 干净检出 `npm ci` 在 install 步 E404）。
- **S8.2 [人工 + 机器判：verify-package-publish.mjs]** **发布形态**：子包先发布；主包以**同号精确版本**
  （不用 `^`）把子包写进 `dependencies`，并在**同一次提交**里删掉 `devDependencies` 的 `file:` 规格。
  **执行者 = 发布者的人工步骤**（本仓不设发布脚本：换形态就是"改主包清单"这一件事，脚本化只会把
  发布顺序藏进代码）。离线门只钉**形态自洽**：`packages/*` 的每个子包必须"全有或全无" —— 要么全在
  `devDependencies` 的 `file:packages/<pkg>` 上（开发期），要么全在 `dependencies` 的同号精确版上、
  且 `devDependencies` 里不残留任何 `file:`（发布期）；**混态判红**（"改了一半"是唯一能让干净检出
  `npm ci` 在 install 步 404 的形态，同 S8.1 的事故面）。
- **S8.3 [机器判：verify-package-publish.mjs ⑧]** 任何一次改主包清单，都必须同一次提交重算
  `package-lock.json`（清单与锁根逐字一致）；发布顺序反了 ⇒ 干净检出与用户侧安装都在 install 步失败。

### S9 文档与引用

- **S9.1 [人工]** 活文档 / 清单 / 注释只引用**稳定位置**：本 ADR 的条款号、实现文件头、`test/` 里的判据名。
  **不引用** `docs/wip/`（会归档）与 `docs/archive/`（[写作纪律 9](../README.md)）。
- **S9.2 [人工]** 机制与不变量写在**实现文件的头注释**里（本仓"代码即真相"），规范只留契约与验收点。

### S10 新增一个独立子包的登记点

登记点清单是**矩阵**（每个包 × 每一格），完整矩阵与当前状态见
[`docs/SUBPACKAGE-GRAPH.md`](../SUBPACKAGE-GRAPH.md)。其中两条有判据：

- **S10.1 [机器判：verify-subpackage-manifests]** 每个子包在 `lib/subpackage-boot.js` 的
  `SUBPACKAGE_KEY_TABLE` 里恰好一项（键 = 子包 id），无多余项。
- **S10.2 [机器判：同上]** 有 `dsh.client` 的包必须有一份**包内构建配方**
  `packages/<pkg>/client.build.json`，且其 `artifact` === 该包 `exports['./client']` 目标、产物在盘；
  没有 `dsh.client` 的包**不得**有该配方。（2026-10-15：配方原先是 `scripts/build-client.mjs` 里写死的
  `SUBPACKAGE_BUILDS` 表，改成包内文件后"新增一个包要不要动构建器"这个问题消失 —— 判据口径不变。）
- **S10.3 [人工]** 其余登记点：自带 `cordis.patch.yml`、`icon.png`、`locale/{en,zh}.json`、
  主包 patch 行、主包清单（S8.1/S8.2 两态）、`package-lock.json`、`lib/routes/`、
  守卫的**数据驱动发现面**（无需手改：`test/tools/host-route-index.mjs` 按 `packages/*` 清单枚举）、
  生成物重算（`docs/ROUTE-INDEX.md` 用 `node test/tools/host-route-index.mjs --write`、
  `docs/GUARD-MAP.md` 用 `node test/tools/guard-targets.mjs --write`）、
  以及**人工更新** `docs/SUBPACKAGE-GRAPH.md`（D4）。

- **判据的覆盖面地板（防恒真）**：`verify-subpackage-manifests.mjs` 在任一次枚举结果为空或明显不足时判红 ——
  `packages/` 目录、主包 patch 的真名行、`SUBPACKAGE_KEY_TABLE` 与**各包配方** `client.build.json`
  读不出来都算 —— **不许**静默跳过：恒真的判据比缺失的判据更坏（它会谎报“已覆盖”）。

## 现状偏差（待统一，按 S 编号）

| 条款 | 现状 | 目标 | 是否阻塞 |
|---|---|---|---|
| S3.8 | ✅ **已消除**（2026-10-15）：三份清单落在同一模板上，`files` 统一为单行且在 `dsh` 块之后 | —— | —— |
| S3.9 / S9.1 | `packages/**` **已收口**（2026-10-15：改引本 ADR 的 `S*` 或 `ADR-0013 D*`；没有对应条款的**删引用保原意**）。**剩余引用面**（复算：`git grep -nE 'docs/wip\|BUNDLE-SPLIT' -- lib src scripts test cordis.patch.yml`；活 md 用同一模式加 `-- docs` —— 只数条数、不抄行号，行号必漂）。全仓惯例形的 `mNNNNN` 消息引用与阶段号（`P2-7A` 等）**不计入**本条款；2026-10-15 用户裁决 = 阶段号**暂保持现状**，不逐个改 | 剩余面按同一规则改引 `S*`（或删引用保原意）；`docs/wip/` 归档前必须完成 | 不阻塞，但 wip 归档前必须改 |
| S3.4 | ✅ **已收口（2026-10-16，P-C 第一刀）**：字体包不再是 host-only —— 它现在有浏览器半边（`src/client.js` + 外观页签字体节 + 字体集编辑器，产物 `lib/client.fonts.js`）⇒ 声明 `dsh.client` 且 `exports['./client']` 两向齐。host-only **形态本身仍然合法**（本条只描述现状；"不许用空 `./client` 假装统一"的口径不变） | —— | —— |
| S8.2 | 发布形态**尚未执行过**（三包都在开发期形态）；执行者 = 发布者的人工步骤（本仓不设发布脚本） | 人工执行 + 离线门只钉**形态自洽**（`verify-package-publish.mjs` ⑨：全有或全无，混态判红） | 已定（人工门） |
| S3.4 / S10.2 | ✅ **已收口（2026-10-17，用户裁决"收口成一般形态"）**：第四个子包 `packages/pet-link` 补齐了浏览器半边的一般形态 —— 包内配方 `client.build.json`（`entry: src/client.js` → `artifact: lib/client.pet-link.js`）、包内产物 `packages/pet-link/lib/client.pet-link.js`（≈178 KB）、`exports['./client']` + `dsh.client`（与根逐键相同），并从主包 `INLINE_MODULES` 摘出（主包 `lib/client.js` 4,607,984 → 4,433,884 B）。收口前的"第三种形态"（源码在包内、构建归主包，2026-10-16 PR #5 引入）与 `test/verify-module-layout.mjs` 规则③ 的软档冲突随之消失；`FLOORS.clientArtifacts` 4→5。词条表按 fonts 惯例归位到主包 `src/i18n-copy-pet-link.js`（域表，与浏览器半边产物无关）。主包只留门面（`src/client.js` 的 `petLink` / `petLinkWiring` + `registerPetLink` 桥键）：跨包求值顺序不保证 ⇒ 门面缓冲 + 登记到达时补做；缺席语义 = `mascot.tap()` 抛错以保住回落。⚠️ 余一条**与本形态无关**的软档红（浏览器回归脚本引用运行时才创建的 `../.artifacts/**`，PR #5 既有）。详见 [`docs/SUBPACKAGE-GRAPH.md`](../SUBPACKAGE-GRAPH.md) §三/§五/§六 | 已裁决（走 ①）；② 的"扩规则③ 判据面"不再需要 | 已收口（硬档全绿） |

## Consequences

**收益**

- "子包该长什么样"从**人记**变成**条款 + 判据**：清单面、行面、依赖方向各有归属，新拆一个包时按 S10 逐格过即可。
- 术语分开（S1.1）后，"这条判据管组件行还是独立子包行"不再需要每次重新确认。
- 规范与决策同寿命（D1）：不会出现规范文档与 ADR 各说一套。

**代价（我们放弃了什么）**

- **树形依赖图没有机器对账**（D4）：它是"画出来的当前状态"，包一多就会滞后 —— 这是用户明确选择的
  代价（md 判据一律不设）。缓解手段只有文档头的复算命令与人工复核。
- **S8.2 仍是人工门**：离线判据能证明"开发期没写错"，证明不了"发布时换对了"。
- **host-only 与 host+client 两种形态并存**：规范选择承认它（S3.4）而不是抹平它，
  代价是"统一"只能统一到**同形态**包之间，跨形态的字段差异要一直解释。

## 复核触发线

出现下面任一情况时回来改本文（而不是另开 ADR）：① 新增第三种包形态（既非 host-only 也非 host+client）
—— ⚠️ **已触发（2026-10-16，PR #5 合并）**：`packages/pet-link` 的浏览器半边源码在包内、构建归主包
（`INLINE_MODULES` 内联进 `lib/client.js`），既非 host-only 也非 host+client；✅ **已定案并收口
（2026-10-17）**：选"收口成一般形态"，该形态**只此一例且已消失**（pet-link 现有包内 `client.build.json` +
产物 + `exports['./client']` + `dsh.client`），本条触发线随之关闭；处置与实测见 §现状偏差的 `S3.4 / S10.2` 行
与 `docs/SUBPACKAGE-GRAPH.md` §三/§五/§六；
② 跨包通道不再是 Cordis Service；③ `packages/<pkg>` 不再是同仓目录（例如改多仓）；
④ 有判据开始断言 markdown（D3 的边界被打破）。
