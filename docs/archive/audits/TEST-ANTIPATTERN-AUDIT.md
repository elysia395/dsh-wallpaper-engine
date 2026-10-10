# test/ 测试框架反模式审计（现存问题清单）

- 审计对象：`test/`（**72 个 `.mjs`** = 顶层 57 + `test/tools/` 15；另 `test/fixtures/` 2 份夹具）。三类问题：**面向结果编程**（A）、**无意义测试**（B）、**自欺欺人**（C）。
- 本文件的读法：**只记现在还存在的问题**。每条给：当前 `file:line` → 它该守的不变量 → 现在的形态（已重写 / 已加固 / 已删除 + 覆盖点 / 裁决不改 / 取消）→ 「牙齿」结论。已删除的判据写「原址 `file:line`（已删除）」并给出当下**真的**守着那条契约的判据。
- 计数：**106 条 = 9 high + 37 medium + 60 low**，14 个组（§2–§4 逐条，§7 矩阵校验）。
- 严重度按 id 族定档：`H1–H7`/`F1–F2` = high，`M1–M33`/`N1–N3`/`F3` = medium，`L1–L55`/`N4–N6`/`F4–F5` = low。个别条目原始标注带中间档（M23/M24 `medium-low`、M25/L25 `low-med`、L7/L8/L41 标 medium），本表统一到所属档，故合计为 9 / 37 / 60。`X1–X3` 与已计数条目**同址**，单列且**不另计入 106**（见 §3.10）。

---

## 0. 摘要

**总体判断：这套测试框架的底子明显高于同类项目。** 覆盖面地板（`SCAN_FLOOR`、`sites.length >= 8`、`rules >= 8`、`checked >= 10`…）、真变异对照、假件的"保真修复"、ADR 记录过的取舍都是**刻意建立**的约定，`docs/DEV-GUIDE.md` §4.7 把「怎么算有牙的负对照」写成了成文规则（约定 5 / 约定 8）。所以问题不是"测试全是摆设"，而是**一批高质量守卫里混进了可被静默绕过或恒真的判据**；下面 106 条就是这份清单，每条都已就地处置（重写 / 加固 / 删除 / 明示不改），但**处置不等于风险归零** —— 每条末尾的牙齿结论说明它现在还剩多少鉴别力。

| 严重度 | 条数 | 说明 |
| --- | --- | --- |
| **high** | **9** | 产品按它声称守护的方式回归时**照样绿**，或整段恒红/不可达（H7）。全部已重写或已加固 |
| medium | 37 | 判据自身空转，但同一 `check` 里通常还有一条合取项留着牙 |
| low | 60 | 恒真 / 重复 / 自指，损失的是"假保证"与误报噪声；多数已删除并由同址的兄弟判据覆盖 |

### 最要紧的 9 条（现状一句话）

1. **`test/verify-route-families.mjs:87`** —— 枚举非空地板已在 `if (routes.length)` **外面**：路由表退化成空表 ⇒ 当场红（否则整组判据会被这个 `if` 一起跳过，打印 `TRIGGER NOT FIRED` 后 exit 0）。
2. **`test/verify-route-index.mjs:59-63`** —— 正/负判据共用 `zeroLineMatches`，「把零提及行改掉」现在真的会红（原判据 `X.replace(a,b).includes(a)` 对任何输入恒真）。
3. **`test/verify-host-paint-scope.mjs:92`** —— 只剩长度/锚点这条**有牙**的合取项；`rawBackticks === 0`（抽取正则的数学恒等式）与自造串自比已删除。
4. **`test/verify-glass-surfaces.mjs:1340`** —— `member` 改用这一面自己的选择器形态（`/pI_x6G_frame/`），不再与 `anchor` 同一条正则 ⇒ "失去门控"会让它留在被检查集合里并红。
5. **`test/rotation-live-smoke.mjs:64` + `test/rotation-smoke.mjs:61`** —— 替身补上 `get/set paused()`，产品 `!video.paused` 的早退不再恒发生，"夺回焦点后自动恢复"这条路真能走到 `video.play()`。
6. **`test/verify-transcode-state.mjs:34-42`** —— 判据提成 `swFallbackIn(text)`，诱饵喂进同一条判据：`swFallbackIn(decoy) === false`，产品退回 NVENC-only 时它会红。
7. **`test/compat-harness-pages.mjs:630-695`** —— 探针里重复声明 `before` 的那一行已删，`evS` 的求值错误不再被静默吞掉；受 `spOk` 门控的表面令牌 / markdown 代码块底 / 左侧栏锚点三条回到可达，左侧栏液态玻璃关/开两条不再永不执行。**该文件仍只在 `workflow_dispatch` 上跑**，所以"下一次真跑"这件事本身仍然是它的薄弱面。
8. **`test/tools/branch-notify.mjs:54`（`DEF`）** —— 定义形态正则补成七组超集并与 `test/verify-client.mjs:13-14` 共用同一份（`async function` / `let`·`var` 箭头 / 方法简写 / 三元与 `switch` 只一支通知都能被认出；实测处理器形态定义 377 → 380）。
9. **`test/tools/branch-notify.mjs:43`（`FILES`）** —— CLI 扫描面改从 `scripts/build-client.mjs` 的 `file: '…'` 清单派生（41 个文件）。影响面**仅人读 CLI**；判据本体 `test/verify-client.mjs` ①i 的扫描面一直是全量。

### 结构性观察（现在时）

- **主导失效模式仍是约定 5 的 ② 号写法**：「在对照里另抄一份判据」。106 条里约一半属 C3。仓库**已经知道**这条（`docs/DEV-GUIDE.md` 逐字写着「② 在对照里另抄一份判据（复制正则、复制 `.every(...)`）：生产侧改了它也不会红」），同一份文档点名的规则仍被系统性违反 ⇒ 缺的不是规则，是**可执行的检查**。
- **A2（夹具从输出抄写）真实存在且已造成过缺陷**：`test/fixtures/settings-sanitize-golden.json:2` 的 `note` 现在**开头就声明自己是漂移棘轮**（只证明"没有无理由地变化"，不证明取值正确），并写明重录脚本 `.test-cache/regen-golden-*.mjs` **不在仓库里**、补键只能人工比对 diff 并确认「除新键外零漂移」；消费点 `test/verify-client.mjs:3123-3141` 的断言文案与段注释同口径。**未做**：把重生成脚本入库（需要每个键的设计意图，属产品知识）。
- **覆盖面地板文化是好的，坏的是"地板位置"**：地板写进被跳过的块里（`test/verify-route-families.mjs`，已修）、空域分支因所有行 `done: true` 而短路（`test/verify-glass-surfaces.mjs:1364`，已加固）、对照只回测抽取器（`test/verify-logging.mjs:158-161`，已修）。写对位置的正面样本很多：`test/verify-json-response.mjs` 的 221/259/260-261、`test/verify-client.mjs` 的 9 条地板、`test/verify-softrender.mjs` 的 E1–E5 六条、`test/verify-glass-surfaces.mjs` 的 `total > 0` / `checked >= 10` / `rules >= 8`。
- **"恒红"与"静默不可达"是同一个洞的两面**（H7）：一个被静默吞掉的求值错误会把同段判据劈成"永远红"（噪声）和"永不执行"（假保证）两半。这类洞只在**从来不自动跑**的守卫里长期存活 —— `.github/workflows/harness-compat.yml` 的触发面只有 `workflow_dispatch`。
- **就地无法复核的两处**：`test/compat-harness-surfaces.mjs:207-213` 的覆盖地板（按被豁免项计数）在本机没有 harness 包可实测，只能读代码确认表达式成立；`test/e2e-web-media-origin.mjs` 的浏览器段本机跑不完（中间件产物下载 `fetch failed`），该文件本来也不在 `npm run verify` 门内。

### 还能加固的方向（不改判据、改门的形态）

1. 给 `test/**` 加一条**机械可查**的规则检查：`if (X) { … check()/assert … }` 同块内若出现 `check(`/`assert.`，则必须存在对同一 `X` 的地板 —— 一次性堵掉 C4 类。
2. 把"守卫最后一次真跑是什么时候"变成出口：探针脚本在求值错误路径上不许静默（`evS` 那类条件不再只是打印细节），并给每个探针脚本加「本次至少执行了 N 条判据」的地板。
3. `test/warn-only.mjs` 的 `--probe-spawn` 建议接进 `verify:docs`（现在那条路径不带它）。

---

## 1. 判定口径

| 码 | 含义 |
| --- | --- |
| **A1** | 期望值由被测函数算出，或测试**重新实现**产品逻辑再断言自己的实现 |
| **A2** | 夹具/golden 由产品自己的输出生成（只能测漂移，对正确性没有意见） |
| **A3** | 判据断言在**测试自己的源码**上（`'字面量A'.includes('字面量B')`） |
| **A4** | 判据把产品的字面文案抄成期望值 |
| **B1** | 不可证伪/恒真（自身字面量的数学恒等式、空域或字面量集合上的 `.every()`、被前一条蕴含的断言） |
| **B2** | 判据体因域为空而永不执行，且没有覆盖面地板 |
| **B3** | 断言在**测试装置/替身自身**的保真度上，而不是产品 |
| **B4** | 重复判据（两条断言操作数相同；后者只可能在前者已红时红） |
| **C1** | 替身**复述**了被测产品逻辑（于是按构造成立），或替身**漏掉产品真的会读的属性**，使某条产品路径在测试里不可达 |
| **C2** | 析取项/门控在"功能根本不存在"时通过（`!x \|\| (…)`，x===null 表示没创建），于是"缺功能"满足了"功能行为"的标签 |
| **C3** | "负对照"里重打判据，而不是把变异输入喂进共享判据 |
| **C4** | 静默跳过（`if (x) { assert… }` 无地板 / 无覆盖面地板），或吞掉错误后 exit 0 |
| **C5** | 打印/观察后丢弃（`console.log` 一个布尔值，无断言，只有抛异常才失败） |
| **C6** | 扫描面可静默退化成空且无地板（目录枚举、正则不再匹配），守卫空转报成功 |

**「牙齿」回答一个具体问题：「产品按这条守卫声称守护的方式回归时，这一行会不会变红？」** 答 `no` 即失去保护，答 `partial` 即同 `check` 里还有别的合取项在扛。另有一类**反向失效**：判据恒红或整段不可达（H7）—— 恒红同样是失去保护（噪声之外还会掩盖同段真正"永不执行"的判据），故计入 high 并在条目里注明。

**明确排除（不报）**：缺测试、风格/格式、注释措辞、命名、啰嗦、"本可以测得更好"。已核查但判定不算问题的清单见 §6。

---

## 2. HIGH（9 条）

- **H1** `[C4｜high｜H]` `test/verify-route-families.mjs:87` —— 守：路由枚举不得静默退化成空表（族结构"没有族"恰好是它要防的回归）。现状：**已加固** —— `check('覆盖面：路由枚举非空（buildIndex() 返回了路由表，而非静默空表）', routes.length > 0, …)` 落在 `if (routes.length)` 之外，另外两条覆盖面地板与触发条件判据仍在块内。牙：**yes**（枚举空 ⇒ 红）。
- **H2** `[C3｜high｜R]` `test/verify-route-index.mjs:59-63` —— 守：「零提及」行必须与实际计算一致，且改动它必须被判出。现状：**已重写** —— 判据提成 `const zeroLineMatches = (line) => line.includes(expectedZero);`，阳性/阴性共用同一条；原址 `:56-58`（`X.replace(a,b).includes(a)` 恒真）已删除。同块那条指向不存在的 `lib/routes/nope.js` 的对照也已删除，域非空由同块地板守住。牙：**yes**（同文件 `:42-46` 的 `sameAsIndex` 是正确写法的范本）。
- **H3** `[B1｜high｜D]` `test/verify-host-paint-scope.mjs:92` —— 守：CSS 模板抽取必须完整（提前截断 ⇒ 锚点失配、长度骤短）。现状：**已删除两个恒真合取项** —— `rawBackticks === 0`（抽取正则 `[^`]*` 的数学恒等式）与自造串自比（`caughtBacktick`）已去掉，标签改成它真正验证的「模板抽取完整」；覆盖它的判据是同一条 `check` 内的长度地板。牙：**partial**（长度地板有牙；反引号那条从来不是对产品的观察）。
- **H4** `[B1｜high｜R]` `test/verify-glass-surfaces.mjs:1340` —— 守：声称被门控的规则集合里不该出现"没有门控"的规则（W5 覆盖面）。现状：**已重写** —— 门控表的 `member` 改成这一面自己的选择器形态 `/pI_x6G_frame/`，与 `anchor: /data-we-titlebar-glass/` 分开。否则两者同一条正则，"失去门控"会让该规则**不再是 member**、从被检查集合里消失 ⇒ `ungated` 恒空。牙：**yes**（失去门控 ⇒ 该面判据红）。
- **H5** `[C1｜high｜H]` `test/rotation-live-smoke.mjs:64`、`test/rotation-smoke.mjs:61` —— 守：媒体元素替身必须暴露产品真的会读的属性（产品在 `src/client.js` 用 `!video.paused` 早退，唯一一次 `video.play()` 在该 return 之后）。现状：**已加固** —— 替身补 `get/set paused(){ return this.__paused !== false; }`。若两份 `makeEl` 都只记 `__paused` ⇒ 早退恒发生，"夺回焦点后自动恢复"永不可达、`(live.__plays || 0) === playsBefore3` 恒为 `0 === 0`。牙：**yes**。
- **H6** `[B1+C3｜high｜R]` `test/verify-transcode-state.mjs:34-42` —— 守：产品不得退回 NVENC-only 的转码写法。现状：**已重写** —— 判据提成 `const swFallbackIn = (text) => …`，阴性侧把诱饵喂进**同一条**判据（`swFallbackIn(decoy) === false`）。负对照若只断测试自己刚写的字面量（`decoy.includes('ENC_TUNE')`）⇒ 真判据从未被引用。牙：**yes**。
- **H7** `[C4+B2｜high｜D+H]` `test/compat-harness-pages.mjs:630-695`（探针）、`:697`/`:702`/`:713`/`:720`（受 `spOk` 门控的判据）、`:362`（`evS` 的错误通道） —— 守：表面令牌 / markdown 代码块底 / 左侧栏锚点三条判据要能红，左侧栏液态玻璃"关 ⇒ 与今天一致 / 开 ⇒ 接管 / 摘掉开关即还原"三条要真的执行。现状：**已删除**重复声明（原址 `:628` 的 `const before = snap();` 与同作用域 `let before = null;` ⇒ 整段 `SyntaxError`，被 `evS` 静默吞掉），并在 `:652` 留下一条"不要在这里取 before"的防回归注释；`evS` 的求值错误不再只在 `DSH_WE_COMPAT_DEBUG` 下可见。牙：**已恢复**（错误可见、门控条件可满足）；**遗留**：该文件只在 `workflow_dispatch` 上被调用，"一直红"与"一直绿"都缺自动出口。
- **F1** `[A4+C6｜high｜R]` `test/tools/branch-notify.mjs:54`（`DEF`）、`test/verify-client.mjs:13-14`（导入同一份） —— 守：处理器形态识别必须覆盖 `async function`、`let`/`var` 箭头、`onXxx(…) {` 方法简写、以及三元/`switch` 里只有一支通知的形态。现状：**已重写** —— `DEF` 补成七组超集并 `export`，新增 `export const defName = (m) => m[2] || … || m[7];`—— 两处正则合成同一份，不再各抄一份。牙：**yes**（实测处理器形态定义 377 → 380，多出的正是旧正则漏掉的三个 `async function`；候选零新增）。
- **F2** `[C4｜high｜H]` `test/tools/branch-notify.mjs:43`（`FILES`） —— 守：人读 CLI 的扫描面不得是手工清单（手工清单只覆盖 2 个模块 ⇒ 其余 39 个模块的候选全部漏报）。现状：**已加固** —— `FILES = [...new Set(['src/client.js', ...inlineModuleFiles()])]`，从 `scripts/build-client.mjs` 的 `file: '…'` 清单派生（41 个文件）。牙：**n/a（只影响人读输出）**；判据本体 `test/verify-client.mjs` ①i 的扫描面一直是全量 `panelSrcs`，**不存在**"几十个处理器静默脱出分支级判据"。

---

## 3. MEDIUM（37 条）

### 3.1 `test/verify-client.mjs`

- **M1** `[A4｜medium｜R]` `:1529` —— 守：字体节必须真的把控件组画出来。现状：**已重写** —— 在渲染树文本上断言「恢复默认 / 文字颜色 / 排版」都在（只 grep 整份构建产物里的 i18n 字面量 ⇒ 字体节不渲染也绿）。牙：**yes**。
- **M2** `[C4｜medium｜H]` `:1354`（地板）`:1355`（`if (sidebarSwitch)`） —— 守：侧栏主开关一变形状，块内三条断言（关 ⇒ 清 `data-we-sidebar-glass` / 开关仍画出 / 「独立配置」隐藏）不得静默零覆盖。现状：**已加固** —— `assert.ok(sidebarSwitch, '侧栏液态玻璃主开关缺失 ⇒ 下面三条断言零覆盖')` 落在 `if` 外面。牙：**yes**。
- **M3** `[C4｜medium｜H]` `:1726-1728` —— 守：「壁纸透明度 60% ⇒ `--we-wallpaper-opacity: 0.4`、0% ⇒ 不设」这条契约（全仓唯一覆盖）不得因输入框形状变化而静默跳过。现状：**已加固** —— 行、输入框、reset 各一条地板。牙：**yes**。
- **F3** `[A1｜medium｜H]` `:3093-3096` —— 守：①i 的期望值来自被测 scanner 自身输出减手写豁免表，scanner 退化时不得恒真。现状：**已加固** —— 加棘轮地板 `handlerDefCount >= 380`（常数 = 实测值，只降不升；补齐 `async function` 等形态前是 377），路径展开行为由正/负对照钉住。牙：**yes**（形态识别一退化 ⇒ 红）。
- **M32** `[A2｜medium｜不改（声明）]` `test/fixtures/settings-sanitize-golden.json:2` + `test/verify-client.mjs:3123-3147` —— 守：**host 侧**设置规范化的输出不得**无理由**变化（**不是**取值正确性）。现状：**口径已写明，重录有闸门** —— 夹具 `note` 四节（定位 / 哪一侧真被守着 / 怎么重录 / 键的存在性）、③ 段注释 `:3123-3134` 与断言文案 `:3145-3147` 三处同口径；**重录工具已入库** `test/tools/regen-golden.mjs`（默认只报告；`--write --intend <host|client>:<键>` 才写入，除声明键外的漂移被**拒绝写入**，脚本不碰 `note`）⇒ 旧口径「重生成脚本不在仓库里」作废。键的**存在性**由 `test/verify-glass-surfaces.mjs` 的 ⑥ 键集快照管 —— 但那比的是**夹具自身逐用例的自洽**：某用例漏补会红，**一个键在所有用例里都没补则抓不到**。**只有 host 侧的值被棘轮住**：夹具里 `client` 侧的值没有任何判据比对（④ 在活值上钉 client == host、⑥ 只用键集）⇒ client 侧现有 `layerPositionX`/`layerPositionY`/`layerScale` 三键与当前实现不一致（18/18 用例）而守卫全绿，只有重录工具会提示。牙：**yes（对漂移）**；对"取值对不对"这条夹具按设计不作判断。

### 3.2 `test/verify-scene-live.mjs`

- **M4** `[B1｜medium｜R]` `:1780-1788` —— 守：旧的原生可播豁免形态必须被认出来。现状：**已重写** —— 提成 `OLD_NATIVE_EXEMPT_RE`，正反两向喂同一条正则（真源码必须不命中 ∧ 具名样本 `OLD_NATIVE_EXEMPT_SAMPLE` 必须命中）。断言对象是真源码与具名样本，不再把源码逐字抄成散文串（抄串比对自己造的字面量 ⇒ 恒真）。牙：**yes**（阳性侧换成样本 ⇒ 当场红）。
- **M5** `[B1｜medium｜R]` `:2639-2648` —— 守：`renderUserPropsPanel` 必须住在模块级、不在某个块里。现状：**已重写** —— 提成 `const isModuleLevel = (t) => …`，阴性侧喂固定缩进的字面量（`!(A && !B)` 因固定缩进按定义恒真）。牙：**yes**。
- **M6** `[C3｜medium｜R]` `:1817-1821` —— 守：未登记的模块名会被构建清单判出。现状：**已重写** —— 把变异喂回正面判据用的同一个正则（`build.replace("'src/live-layer.js'", "'src/nope.js'")`），不再是"发明一个文件名再对它跑一遍正则"。牙：**yes**。
- **M7** `[B1/C3｜medium｜R]` `:5153-5159` —— 守：判据用例集必须有足够多的带标签期望。现状：**已重写** —— 提成 `const floorOk = (cs) => cs.length >= 4 && cs.filter((c) => c.wantLabels).length >= 3;`，阳性喂 `CASES`、阴性喂合成数组。牙：**yes**。
- **M8** `[B1/C3｜medium｜R]` `:5473-5483` —— 守：锚点期望必须三种都够量（标签 / 类名 / 文本）。现状：**已重写** —— 提成 `const anchorsOk = (cs) => …`，阴性喂"只堆一种锚"的合成数组。牙：**yes**。

### 3.3 scene / media

- **M9** `[B1/B4｜medium｜R]` `test/verify-transcode-state.mjs:364` —— 守：同一比较式吃变异状态（fps 60）必须为 false。现状：**已重写** —— 把变异文本喂进同一比较式（`:351` 那种逐字重复零独立信号）。牙：**yes**。
- **M10** `[C3｜medium｜R]` `test/verify-transcode-state.mjs:87-97` —— 守：只读路径的形态（`transcode = { fps, cached: … }`、无 `transcodeToFps`、无 `await`）。现状：**已重写** —— 提成 `readOnlyAnswer(body)`，变异体喂进同一条判据。牙：**yes**。
- **M11** `[C3｜medium｜R]` `test/verify-scene.mjs:809-817` —— 守：裸 `req.destroy()` 计数判据有牙。现状：**已重写** —— 提成 `bareDestroyCount(t)`，正判据与该对照共用。牙：**yes**。
- **M12** `[C3｜medium｜R]` `test/verify-scene.mjs:830-858` —— 守：base64url 派生只在预期处发生。现状：**已重写** —— 提成 `base64UrlDerivations(t)`，正/负共用一份实现。牙：**yes**。
- **M13** `[C3/B1｜medium｜R]` `test/verify-scene.mjs:1065-1071` —— 守：宿主侧用 `extractSceneVideo(new Uint8Array(…))` 这条探针形态。现状：**已重写** —— 提成 `usesUint8Probe(t)`，把 `hostHalfSrc` 与合成变异串一起喂进去（否则退化成拿同义串跟自己比 ⇒ 恒真）。牙：**yes**。
- **M14** `[A4｜medium｜R]` `test/verify-cache-dir.mjs:143-151` —— 守：路由模块声明"生效值来自 `cacheBaseDir()`"且不缓存缓存根副本。现状：**已重写** —— 删掉两条文案的 `includes`（同一对文案已在运行时响应上断过），只留行为项 `/effective: cacheBaseDir\(\)/` 与 `!/const cacheDir = cacheBaseDir\(\)/`，消除改文案造成的假红。牙：**yes（对行为）**。

### 3.4 route / logging / we-install

- **M15** `[A3｜medium｜D]` `test/verify-we-install-probe.mjs:274-278` —— 原址（已删除）：两个字面量 contains 另两个字面量，从不读 `hostSrc`。覆盖：同文件 `:256-267` 对 `hostSrc` 可证伪的 D4/D5。牙：**覆盖点 yes**。
- **M16** `[C3｜medium｜D]` `test/verify-logging.mjs:163-165` —— 原址（已删除）：只回测抽取器（判据体从未引用真判据）。覆盖：`:156-161` 的计数 Map + `bad` 过滤。牙：**覆盖点 yes**。
- **M17** `[B1/B4｜medium｜D]` `test/verify-logging.mjs:572-576`（同形 `:453-454`）—— 原址（已删除）：每个合取项都已被整条 golden 向量蕴含。覆盖：`:556` 的 `rendererLevels` 向量与 `:560-570`。牙：**覆盖点 yes**。

### 3.5 glass

- **M18** `[A1+B3｜medium｜R]` `test/verify-glass-surfaces.mjs:1429-1433` —— 守：旧式布尔形态进 `sanitizeFromSchema` 后必须被改写而不是原样留下。现状：**已重写** —— 提成 `legacyIntoSchema(raw)` 并把它喂进**产品函数**（若整组断言都落在测试自带的桩上 ⇒ 产品侧改坏也绿）。牙：**yes**。
- **M19** `[C6+B2｜medium｜H]` `test/verify-glass-surfaces.mjs:2287-2320` —— 守：座位锚点下不铺底板。现状：**已加固**（当前仓态里样式表命中 0 块是**合法值**）—— 改成"证明扫描器是活的"：同一族函数对合成真规则必须数出 1 块、对只有注释的文本必须数出 0 块，`seatPlateOffenders` 对合成底板必须判 1。牙：**yes**（扫描器坏了 ⇒ 红；`bodies === 0` 从此是"扫过了、真的是零"）。
- **M20** `[C3｜medium｜R]` `test/verify-glass-surfaces.mjs:1399-1412` —— 守：清除路径必须 `removeAttribute` 掉每个写入过的属性。现状：**已重写** —— 共享判据提成 `attrMiss(body)`，对照改成 `attrMiss(broken).length > 0`（不再把过滤逻辑重写一遍）。牙：**yes**。
- **M21** `[B2｜medium｜H]` `test/verify-glass-surfaces.mjs:1364` —— 守：GATE 表不得被清空，也不得全部 `done`（全 done 就不是覆盖面）。现状：**已加固** —— 该地板落在空域分支之前（否则该分支会短路、地板永不执行）。牙：**yes**。
- **M22** `[B1+C3｜medium｜R]` `test/verify-glass-surfaces.mjs:738` —— 守：声明成 private 却没有组的面必须被判出。现状：**已重写** —— 合成面喂进 `missingGroupOf`（只断言自造字面量不在自造常量里 ⇒ 恒真）。牙：**yes**。
- **M23** `[C3+B1｜medium｜R]` `test/verify-glass-compositing.mjs:628-646` —— 守：给顶栏改一个字面量，同一条判据必须判红。现状：**已重写** —— 真判据提成 `sameDecl(a, b)`，变异体喂进 `tbDiffs`/`declValue()`（只经 `tbNorm` 区分两个字面量 ⇒ 不是对产品声明的观察）。牙：**yes**。
- **M24** `[B1｜medium｜R]` `test/verify-glass-surfaces.mjs:1167-1171`、`:1190-1194` —— 守：被接线的 override 键名与 `ownKeyOf` 的键名必须是**输入里可能出现**的名字。现状：**已重写** —— 恒真的自反合取项（查永不可能出现的名字）已去掉，改查真实选择器形态的键名；两处各留一条"不许在这里查 `onlyDeclared` / `…BlurX`"的注释防回归。牙：**yes**（键名找不到 ⇒ 红）。
- **M25** `[C3｜medium｜R]` `test/verify-glass-surfaces.mjs:2056-2085` —— 守：写入但从不被读的声明（dead writes）与缺失组必须用**生产侧同一套过滤器**判。现状：**已重写** —— 过滤器提成共用函数并保留 `OBSERVED_ONLY` 豁免，对照喂真实 `faces`/`w` 的变异副本（对照里复刻一份、且丢掉豁免 ⇒ 生产过滤器改坏时对照仍绿）。牙：**yes**。

### 3.6 contracts / about / fontset

- **M26** `[C2｜medium｜R]` `test/verify-contracts.mjs:112-177` —— 守：客户端的头像 / 吉祥物 / 自定义框 accept 列表必须与宿主扩展表一致。现状：**已重写** —— 域换成**客户端自己的赋值点**（`const clientAccept = acceptAssignments(clientSrc)`，从 `src/client.js` 的 `input.accept = "…"` 抽，判据在 `:162-177`）。三条 `check` 若共用 `src/panel-tabs.js` 那一份清单（那唯一一条图片 accept）⇒ 客户端漂移全绿。牙：**yes**。
- **M27** `[A1｜medium｜R]` `test/verify-about.mjs:55-85` —— 守：宿主解析腿（`lib/index.js` 的 `repoSlugFromPkg`）必须与 `package.json`、客户端三方指向同一个 `owner/repo`。现状：**已重写** —— 阳性/阴性都用从宿主抽出的那条正则（检查在 `:74`），`slugOf` 不再是期望值来源。宿主解析腿**唯一覆盖**，故不判 D。牙：**yes**。
- **M28** `[A4｜medium｜R]` `test/verify-fontset.mjs:1406-1440`（判据 `:1412`） —— 守：新字体集默认名字**确定性**、取**第一个**空位、避开已占用、空/错名字不算占用。现状：**已重写** —— `stripComments` 后按花括号配平从 `src/client.js` 提取具名 `nextFontSetName`，`new Function('weT','selection', …)` 喂桩**真跑**：空清单 ⇒ 基础名；占用基础名 ⇒ `base + " 2"`；占用 {base, base 2} ⇒ `base + " 3"`；占用 {base, base 2, base 4} ⇒ 仍是 `base + " 3"`（"最大+1"会给 5）；无关占用不影响；同清单同结果。接线那条降级为**如实标注的源码形状判据**（标题写明"不是行为判据"）。牙：**yes**（名字在面板层生成、编辑器渲染台观测不到，只能这样跑实现）。

### 3.7 smoke

- **M29** `[C6｜medium｜H]` `test/live-frame-backfill-smoke.mjs:240-257` —— 守：场景 F 依赖"重跑 applySelection"这一步必须真被执行。现状：**已加固** —— 两处 `catch { /* ignore */ }` 改成把错误 push 进具名失败（并打印步骤未执行），并在 `if (openBtn) {` 外面加存在性地板。牙：**yes**。
- **M30** `[C5｜medium｜R]` `test/repro-sidebar-props.mjs:134` —— 守：展开后 props 面板必须真的渲染。现状：**已重写** —— 打印完就丢的布尔改成真断言 `if (!JSON.stringify(tree2).includes('we-picker__props')) throw new Error('props 面板未渲染');`。牙：**yes**（该脚本仍靠抛异常失败，语义未变但唯一观测真能失败）。
- **M31** `[C2｜medium｜H]` `test/rotation-smoke.mjs:223-228` —— 守：渐变期间确实创建了场景 BGM 元素且未出声。现状：**已加固** —— 去掉 `!bgmMid ||` 的"不存在即通过"，改成存在性地板 `check('渐变期间确实创建了场景 BGM 元素', bgmMid !== null)` + 单独断 `volume === 0 && muted === true && __paused !== false`。牙：**yes**。

### 3.8 structure / tools

- **M33** `[C3｜medium｜R]` `test/tools/audit-guard-teeth.mjs:148-151` —— 守：判「守卫没有会红的出口」（E 段）不得建立在朴素注释剥离之后。现状：**已重写** —— 剥离改成复用 `test/tools/js-text.mjs` 的**字符串感知**剥离器（同文件判据 C 早已声明朴素剥法会吃掉真代码）。牙：**yes**（E 段不再对 `test/verify-i18n.mjs` 报假阳性，且该文件确有失败出口）。

### 3.9 守卫补漏（N1–N3）

- **N1** `[A4｜medium｜R]` `test/verify-client-sync.mjs:70-110` —— 守：内容差一个字节会被判出、行尾风格差异不算内容差异。现状：**已重写** —— 主判据提成 `const staleByLf = (after, before) => !lf(after).equals(lf(before));`（`:70`），主判据 `const agree = !staleByLf(after, before);`（`:85`），负对照复用同一函数（`:96`），阳性对照两条**真造 Buffer**（`:108-110`，含"改一个字节 ⇒ 判出"这一支，它才是这条对照的牙）。正对照若只驱动 `lf` helper、从未经过主判据 ⇒ 主判据退化也绿。牙：**yes**。
- **N2** `[C3｜medium｜R]` `test/verify-token-contract.mjs:237-258` —— 守：门控计数格里 `(N>0)` 被改成 `(0)` 必须被判出。现状：**已重写** —— 新增 `gateCellProbe(docText, tokenList)`，复用 ⑥ 自己的 `rowRe` 逐行匹配、只认全量令牌表行，取门控格里第一个 `(N>0)` 改写成 `(0)` 再喂回 `gateProblems`；判据 `probe !== null && probeProblems.length > 0` ⇒ **找不到格也判红**。若取全文第一个 `(N)`，命中的是说明行 ⇒ 恒真。牙：**yes**。
- **N3** `[A1｜medium｜H]` `test/verify-token-contract.mjs:89-140` —— 守：白名单/门控口径必须与产品侧的**独立锚点**一致，不能与被审工具同源。现状：**已加固** —— 新增独立锚点表 `ANCHORS`（6 条：裸 `:root`、顶层 `.we-layer`、`body[data-we-glass-page]`、仅 `body[data-we-wallpaper]`、`@media` 里的无门控声明、`--we-*` 不在契约口径内），期望值逐条从 `docs/COEXISTENCE.md`、`docs/adr/0010-glass-off-revisit-four-states.md:17-19`、`docs/wip/COEXISTENCE-AUDIT.md:198`、`src/styles.js`、`docs/TOKEN-CONTRACT.md` 的口径段推出（来源与理由写在每条 `why` 里）；判据 `ANCHORS.length >= 4 && anchorProblems.length === 0`（`:138-139`）。牙：**yes**（工具把口径放宽 ⇒ 独立锚点仍会红）。

### 3.10 与已计数条目同址、不另计入 106 的三条

- **X1** `[C2｜medium｜H]` `test/compat-harness-surfaces.mjs:39-82`、判据 `:190-193` —— 守：上游"隐藏机制换代"（既不 `translate` 滑出、也不 `visibility` 切换）必须被判出，且标记必须落在**面板作用域**的规则里。现状：**已加固** —— 新增 `PANEL_ANCHORS`（`:39`）与 `cssBlobsIn`/`cssRulesIn`/`classesIn`/`hideMechanismIn`（`:43-82`），判据改为 `hideMechanismIn(src, HIDE_MARKERS)`。全文子串匹配会被**无关规则**（分隔线规则的 `visibility:hidden`）满足 ⇒ 必须限定在面板作用域内。牙：**yes**（锚点仍在、标记只出现在无关规则里的负样本当场判红）。**既知局限**：上游若改成独立 `.css` 文件或单引号/模板串字面量，会误报换代。
- **X2** `[C3｜medium｜R]` `test/verify-theme-follow.mjs:249-267` —— 守：同一条判据必须能区分"去重"与"每次都写"。现状：**已重写** —— 两个**真实现**（`naiveCalls` 不去重 / `dedupedCalls`）喂同一条判据，断言 `deduped.length === 0 && naive.length > 0`（若 `naiveWrites` 退回对测试自己字面量数组取 `.length > 0` ⇒ 恒真）。牙：**yes**。
- **X3** `[C4｜medium｜H]` `test/warn-only.mjs:61-71` —— 守：守卫**根本没起来**（spawn 失败）不得被报成"原退出码 = 1 的正常红"。现状：**已加固** —— `r.status === null` 时打印具名 SKIP（明说"这不是通过：该自检在本环境**没有覆盖**"），真实路径 `if (r.status !== 0)` 直接用 `r.status`；`package.json` 未动。牙：**yes**。

---

## 4. LOW（60 条）

> 一 bullet 可覆盖同形态多处（用「/」枚举）；标「已删除」的条目给出当下守着同一契约的判据。

**`test/verify-client.mjs`**
- **L1** `[B1｜low｜D]` `:3516`（`:3552`/`:3586` 同形）—— 原址（已删除）`&& src.includes(n + '(')`（被前一合取项蕴含）；覆盖：同一条 `check` 的 `src.includes('function ' + n + '(')`（`:3543`/`:3578`/`:3613`）。牙：**覆盖点 partial**。
- **L2** `[B1｜low｜H]` `:3290-3292` —— 守：条带 p=0 必须零面积。现状：**已加固** —— 加域非空地板 `assert.ok(xs0.length > 0, 'barsPolygon 未抽出任何值 ⇒ .every() 恒真')`（空匹配集上 `.every()` 恒真）。牙：**yes**。
- **L3** `[B3｜low｜不改]` `test/verify-client.mjs:3930-3935` —— 断的是装置自己的 `FakeMutationObserver.disconnected` 标志。**保留**（并已就地标注为"装置自检、**不是**产品判据"）：它是上一条 `assert.ok(watch.disconnected, '#159①…')` 的**可假性前提** —— 那条断的是桩的标志位，DEV-GUIDE §4.7 约定 8 要求"判据被中和时必须变红"；同块 `test/verify-client.mjs:3846` 的名字记录器装置断的是另一条失效模式。牙：**partial**。

**`test/verify-scene-live.mjs`**
- **L4** `[B4｜low｜R]` `:2783-2795` —— 守：模块级/组件内界线（`function WallpaperPicker() {` 之后不得再有处理器声明）。现状：**已重写** —— 提成 `strayProcessors(text)`，阳性喂真源码、阴性喂**删掉界标**的源码副本（`-1` 若被当成"都合格"会让所有 `at > boundary` 恒真）。负对照若在同一份真实源码上重打正面判据 ⇒ 零独立信号。牙：**yes**。
- **L5** `[B1｜low｜H]` `:2801-2816` —— 守：`PROMOTED_FONT` 非空域上每个名字都在组件之前。现状：**已加固** —— 删掉被蕴含的第二项，加独立地板 `check('覆盖面：PROMOTED_FONT 非空', PROMOTED_FONT.length > 0)`。牙：**yes**。
- **L6** `[B1｜low｜R]` `:2834-2858` —— 守：`flagged(compStart)` 必须能判出"仍在组件里的处理器"。现状：**已重写** —— 两个试探名真的出现在 `PROMOTED_HANDLERS` 里（把真实组件内成员喂进 `flagged`），第二项不再被正面判据强制。牙：**yes**。

**`test/verify-theme-layer.mjs`**
- **L7** `[C3+B1｜low｜R]` `:307-310` —— 守：面板里**没有**的占位形态必须靠注入变异被识别。现状：**已重写** —— 提成命名常量喂真实源与变异串两侧（否则退化成"抄一份正则 + 喂自己造的字面量" ⇒ 恒真）。牙：**yes**。
- **L8** `[C3｜low｜R]` `:292-305` 一带（同形态 5 处：`--dsh-content-font-size` / `role.defaultPx` / `role.prefix` / `--we-font-weight` / `we-font-patch`）—— 现状：**已重写** —— 每处的正则提成命名常量，阴性侧改成"同一常量喂变异文本"（范本 `test/verify-client.mjs:3190-3201` 的 `migrationHasV6` + `assert.notEqual(noV6, schemaSrc)`）。牙：**yes**。

**`test/verify-readability.mjs` / `test/verify-windows-caption.mjs`**
- **L9** `[B1+A1｜low｜D]` 原址 `:735-737`（已删除：把产品 CSS 的 `max()` 夹逼在测试里重实现一遍，再断 `Math.max` 的数学恒等式）—— 覆盖：`:548-553`（F3 结构性钉住产品 CSS 里真实的夹逼表达式）；现址 `:728-737` 是新的 C4b（断言有效 α 单调递减，**不复刻**产品算术）。牙：**覆盖点 yes**。
- **L10** `[C1+A1｜low｜R]` `:48-88` —— 守：激活时产品真的设置/清除了 `data-we-wallpaper`，外观观察器只看 style。现状：**已重写** —— 期望值不再由测试自己的颜色函数产出，改断产品**真的设置/清除了**该属性（`:56` 起的一批 `assert.ok(gateOn(win)/!gateOn(win), …)`），`:56` 的标签降为 `'activation updates the data-we-wallpaper attribute'`。牙：**yes（对该属性）**。

**font / picker / about**
- **L11** `[C3｜low｜R]` `test/verify-about.mjs:322-357` —— 守：本地码白名单（`qq-group.png` 一族）。现状：**已重写** —— 真白名单提成命名函数，把 `'qq-group.png.bak'` 变异输入喂进它（若对 `['qq-group.png']` 取 `includes` ⇒ 变异名 `qq-group.png.bak` 也命中 ⇒ 恒真）。牙：**yes**。
- **L12** `[C3｜low｜D]` `test/verify-component-fonts.mjs:387-388` —— 原址（已删除）：自造串上 `every(...)` 恒 false。覆盖：`:372-384` 读 `clientSrc`/`effectsSrc` 搬家标记的判据。牙：**覆盖点 yes**。
- **L13** `[B4｜low｜D]` `test/verify-system-fonts.mjs:93` —— 原址（已删除）：与前一行的断言完全相同。覆盖：`:491-503` 的整表判据。牙：**n/a（冗余）**。
- **L14** `[B4｜low｜D]` `test/verify-system-fonts.mjs:502-503` —— 原址（已删除）：`includes(...) === false` 被整表相等蕴含。覆盖：`:491-503`。牙：**n/a（冗余）**。
- **L15** `[B1｜low｜D]` `test/verify-picker-props.mjs:502-503` —— 原址（已删除）：只是复述辅助函数定义。覆盖：`:465` 的 `hasPickerRender = (renders) => renders.length > 0` 及其实调用点 `:501`。牙：**n/a（冗余）**。
- **L16** `[C3｜low｜D]` `test/verify-fontset.mjs:1510-1511` —— 原址（已删除）：重打正则去测刻意造得能匹配的字面量。覆盖：`:1533-1539` 真正读 accept 列表形态的判据。牙：**覆盖点 yes**。
- **L17** `[C3｜low｜R]` `test/verify-about.mjs:432-462` —— 守：star 计数路由不得被硬编码进设置。现状：**已重写** —— 正则提成命名常量，硬编码违规串喂进同一常量（重打一遍、且第一个合取项还是重复取反 ⇒ 零独立信号）。牙：**yes**。

**contracts / packaging / api-client**
- **L18** `[C6｜low｜H]` `test/verify-api-client.mjs:52-70` —— 守：`src/**` 里不得出现裸 `fetch(`（`docs/DEV-GUIDE.md` 约定 4：判据的域应当**从磁盘枚举**）。现状：**已加固** —— 硬编码的 14 条名单换成从磁盘枚举 `src/**`（`srcWalk`），地板改成"枚举数 == 检查数且 ≥ 14"。牙：**yes**（新增模块写裸 `fetch(` ⇒ 红；硬编码名单则漏掉它、全绿）。
- **L19** `[B1｜low｜R]` `test/verify-playback-controls.mjs:314-324` —— 守：被拒绝的 `play()` 会被重试（而不是被静默吞掉）。现状：**已重写** —— 改断**增量**而不是累计值（`video._playCalls - callsBeforeRefusal`；断累计值则三次真实点击就把计数推到 3 ⇒ 零次重试也能过）。牙：**yes**。
- **L20** `[C3｜low｜H]` `test/verify-package-publish.mjs:195-209` —— 守：路径抽取器必须能命中正样本。现状：**已加固** —— 加正样本地板 `check('覆盖面：路径抽取器在正样本上命中、在占位符样本上不命中…')`（抽取器退化时 `pathHits` 为空也绿）。牙：**yes**。
- **L21** `[C6｜low｜H]` `test/verify-api-client.mjs:295-298` —— 守：stub 形态扫描必须真的扫到 stub 形对象。现状：**已加固** —— 加地板 `check('覆盖面：扫描真的命中 stub 形对象 ≥ 1（域空 ⇒ 上一条恒真）')`（只查 `stubFiles.length > 20` ⇒ 域空也绿）。牙：**yes**。
- **L22** `[B1｜low｜H]` `test/verify-package-publish.mjs:162-181` —— 守：空棘轮（`SHIPPED_DEV_FILES`）必须显式声明"当前确实为空"并带计数。现状：**已加固** —— 空集上的 `every(...)` 换成带计数的显式地板。牙：**yes**（棘轮被填上 ⇒ 主动变红，而不是恒真）。
- **L23** `[A1｜low｜R]` `test/verify-i18n.mjs:351-370` —— 守：英文词典必须含宿主表合并的那一半。现状：**已重写** —— 期望值不再与被测对象同源（改从宿主表原文或补断"含宿主表合并"那一半）。牙：**yes**。
- **L24** `[B1｜low｜D]` `test/verify-api-client.mjs:148-149` —— 原址（已删除）：在前一条断言之后不可能失败。覆盖：`:159-161`（`errDefault.data === null`）；`:202-203` 那半由 `:196` 的 `=== '{"a":1}'` 覆盖。牙：**n/a（冗余）**。
- **L25** `[B3｜low｜R]` `test/verify-i18n.mjs:271-294`、正对照 `:332-344` —— 守：orphan 键判据在上下文前缀被剥掉时仍要开火。现状：**已重写** —— ② 的负对照与正对照都复用生产过滤器（生产侧会剥 `^[^\u0000]*\u0000` 前缀；内联复刻的 `judge` 若不剥 ⇒ 破坏生产判据两边都仍绿）。牙：**yes**。
- **L26** `[C3｜low｜D]` `test/verify-i18n.mjs:315-316` —— 原址（已删除）：对任何不含该字面量的集合都成立（含空集）。覆盖：`:341` 起的说明与被复用的生产过滤器（stray 判据自身开火路径）。牙：**覆盖点 yes**。
- **L27** `[B1｜low｜H]` `test/verify-package-publish.mjs:221-230` —— 守：`DEP_UNUSED_ALLOW` 与 `INSTALL_HOOKS` 两条棘轮必须显式声明当前状态。现状：**已加固** —— 空域 `.every()` 改成对**非空**集合求值 + 带计数的地板。牙：**yes**。

**structure / tools / fixtures**
- **L28** `[C3｜low｜D]` `test/verify-retired-lines.mjs:144-146` —— 原址（已删除）：`SF_BASELINE = []` ⇒ 内层恒真，且复刻了主判据。覆盖：`:138-148` 的 `spread` 判据。牙：**覆盖点 yes**。
- **L29** `[B4｜low｜D]` `test/verify-retired-lines.mjs:150-154` —— 原址（已删除）：空基线分支退化成 `found.size === 0`，只在主判据已红时红。覆盖：`:138-148`。牙：**n/a（冗余）**。
- **L30** `[C3｜low｜D]` `test/verify-retired-lines.mjs:95-97` —— 原址（已删除）：`RESIDUE_INSPECTORS = []` ⇒ `1 === 1 && 0 === 0`（名字声称的语义正好相反）。覆盖：`:102-110` 消费该名单的主扩散判据。牙：**覆盖点 yes**。
- **L31** `[B1｜low｜D]` `test/tools/js-text.mjs:236-237` —— 原址（已删除）：JS 字符串语义演示，恒真却计入 `selftest PASSED (N)`。覆盖：`:249` 的其它 selftest 条目。牙：**n/a（演示）**。
- **L32** `[C6｜low｜H]` `test/tools/audit-import-closure.mjs:117-127` —— 守：导入闭包扫描必须有域地板。现状：**已加固** —— 加 `check('覆盖面：被检查文件数与 lib 枚举非空', checked.size >= 10 && libFiles.length > 0)`（若 `IMPORT_RE` 或 `lib/` 枚举退化 ⇒ `problems` 仍为 0 并 exit 0）。牙：**yes**。
- **L33** `[A1｜low｜R]` `test/verify-mp4-vfs.mjs:459-468` —— 守：`ok` 与 `info`/`transcode` 各给独立期望。现状：**已重写** —— 不再用 `plain.ok === (plain.info !== null)` 这种自洽恒等式。牙：**yes**。
- **L34** `[B1｜low｜R]` `test/rotation-prepared-leak-smoke.mjs:2025`（同形 `:2064`） —— 守：媒体层/`<video>` 节点在一次纯主题切换后仍是同一节点。现状：**已重写** —— 把 `mediaLayerSurvives` 提成命名判据并喂**真实的**先前快照（原址 `:2045-2046`/`:1507-1508` 现场新建 `{ layer: {}, video: {} }`，对真节点的同一性永不可能为真）。牙：**yes**；同文件 `:1509`（喂空 src 的负对照）本身是有牙的。
- **L35** `[C5｜low｜H]` `test/rotation-prepared-leak-smoke.mjs:572` —— 守：插件 disposer 抛异常必须可见，而不是被静默吞掉。现状：**已加固** —— 与兄弟场景一致改用 `t.cleanups.forEach((c) => c())`（`:428` H、`:686` F 同形）。牙：**yes**。
- **L36** `[B4｜low｜D]` `test/rotation-live-smoke.mjs:306-308` —— 原址（已删除）：断的是装置自己的登记表，而 `fireWin`（`:144`，使用点 `:308`/`:313`）就经它派发。覆盖：`:308-313` 前的实际派发判据。牙：**n/a（冗余）**。
- **L54** `[C3+B1｜low｜H]` `test/verify-i18n.mjs:1` —— 守：判"守卫没有会红的出口"不得因朴素剥注释产生假阳性。现状：**已加固** —— 工具换用字符串感知剥离器后该假阳性消失（该文件确有失败出口）。牙：**yes**。

**glass / logging / media-bridge / compat / e2e**
- **L37** `[C3｜low｜R]` `test/verify-glass-compositing.mjs:751-785` —— 守：「S3 accent 重映射」不变量必须靠**变异输入**判、而不是普通正向断言。现状：**已重写** —— 负对照真的喂变异输入。牙：**yes**。
- **L38** `[A4｜low｜H]` `test/verify-logging.mjs:452-457` —— 守：投递失败路径必须有且只有一条计数。现状：**已加固** —— 保留 `failedSync.length === 1`，删掉抄自 `lib/notice.js` 的措辞正则（改名造成假红）。牙：**yes（对计数）**。
- **L39** `[B1｜low｜H]` `test/verify-media-bridge.mjs:301` —— 守：中间件就绪（握手通过、子进程在跑）。现状：**已加固** —— 判据体从字面量 `true` 换成对分支条件的复述（`ready`），并移到 `if (ready) { … }` **外面** ⇒ 中间件没起来时**真的红**（本机实测 `✗ 中间件就绪（握手通过、子进程在跑）`、exit 1）；全局 19 条地板（`:458-459`）本来就在块外。牙：**yes**；`--allow-skip` 不掩盖它（`:480` 一带 `process.exit(failed ? 1 : 0)` 只看 `failed`）。`npm run verify` 里该文件由 `test/warn-only.mjs --probe-spawn … --allow-skip` 包着，本机沙箱起不了带管子进程 ⇒ 该入口整体具名 SKIP。
- **L40** `[C4｜low｜H]` `test/compat-harness-pages.mjs:236-241` —— 守：`--allow-skip` 逃生门不得在零判据时给出"通过"。现状：**已加固** —— `results.length` 覆盖面地板在 `process.exit(0)` **之前**（零判据的退出码已具名 SKIP）。牙：**yes**（默认是红，CI 不传该开关）。
- **L41** `[B2｜low｜H]` `test/compat-harness-surfaces.mjs:207-213`、`:259-265` —— 守：豁免表不得把依赖全豁免掉而使这一组退化成恒真。现状：**已加固** —— 地板改成按**被豁免项**计数（`exemptHit` 存实际命中的依赖名，`:261-265` 用 `tokens + attrs + suffixes + slots - exemptNames.size`），不再按规则条数计数。牙：**yes（按表达式）**；本机没有 harness 包，无法实测计数。
- **L42** `[B3｜low｜R]` `test/e2e-web-media-origin.mjs:316`、`:480-513`、`:797-801` —— 守：主操作区只剩「选择壁纸」一个按钮（壁纸属性已并入播放控制行）。现状：**已重写** —— 原址 `:801-803` 那条自比判据（数测试自己在镜像页里摆的 `.we-picker__btn`，按构造恒为 1）**已删除**；按钮个数契约由真源码判据 `productPrimaryActions`（`:480-513`，锚在产品真源码 `src/panel-tabs.js:79` 的 `we-picker__current-actions` 上，实测抽屉 1 / 快速面板 3）守，「镜像页确实起来了」由 `:797-801` 守。牙：**yes**。
- **L43** `[A1｜low｜H]` `test/e2e-web-media-origin.mjs:81`、`:541-542` —— 守：桥版本与产品常量一致（能抓"产物陈旧/下载被挡"）。现状：**保留 + 加固** —— 期望值仍取自产品自己的常量（有意的取舍），另加独立地板 `check('覆盖面：桥版本观测点在场', Boolean(mstat && mstat.bridge && mstat.bridge.version))`，避免取值为空时静默。牙：**partial**（永远抓不到"tag 该升没升"）。
- **L44** `[C4｜low｜H]` `test/e2e-web-media-origin.mjs:605-611` —— 守：自动跳过（未找到 Chromium）不得等价于通过。现状：**已加固** —— `preBrowserOk = preBrowserChecks >= PRE_BROWSER_MIN_CHECKS(12)` ⇒ `skipCode = preBrowserOk ? 0 : 1` ⇒ `process.exit(skipCode)`，SKIP 行印明"前置判据不足，按**失败**退出"。牙：**yes**（地板改 999 ⇒ 该判据 `✗` 且 exit 1）。缓解：该文件不属于 `npm run verify`。
- **L45** `[C3｜low｜R]` `test/e2e-web-media-origin.mjs:736-766` —— 守：帧间隔 p50 与慢帧数必须在目标区间内。现状：**已重写** —— 提成命名判据 `fpsWithinTarget` / `fpsJudge`，对照喂同两条序列（重打 45/100/0.2 三个数字 ⇒ 放宽真阈值时对照仍在验旧数字）。牙：**yes**。

**softrender / theme-follow**
- **L46** `[C4｜low｜H]` `test/verify-theme-follow.mjs:445-451` —— 守：`theme/change` 订阅必须真的在场（订阅不在时"没有让位痕迹"最容易通过）。现状：**已加固** —— 给驱动器循环加订阅在场地板 `check('覆盖面：theme/change 订阅在场', fOff.handlers.some(([ev]) => ev === 'theme/change'))`。牙：**yes**。
- **L47** `[A4｜low｜R]` `test/verify-theme-follow.mjs:395-396`（同形 `:431`、`:561-563`） —— 守：状态行的**判决正确性**（不是措辞）。现状：**已重写** —— 期望值不再抄产品措辞：把 `themeFollowDescribe` 的判决正确性作为断言对象（`:193-194` 已独立断言），措辞只留在 detail 串。牙：**yes（对判决）**。
- **L48** `[C1｜low｜R]` `test/verify-softrender.mjs:217-220`、`:555-581` —— 守：`typeof URLSearchParams` 守卫与它的 `else` 回退（正则 + `decodeURIComponent`）必须**可达**。现状：**已重写** —— 删掉 `provideLocation: false` 开关、`sandbox.location` 改为**无条件**提供（`:219`），I1/I2/I3 改写成三条都可达的场景（无 `URLSearchParams` + `?we-glassfallback=%6Fff` ⇒ hook null；有 `URLSearchParams` + `=off` ⇒ hook null；正对照 `search: ''` ⇒ hook `"1"`）。牙：**yes**（把守卫换成裸 `new URLSearchParams(location.search)` 会被判红）。
- **L49** `[B1｜low｜R]` `test/verify-softrender.mjs:303-320` —— 守：软件光栅器正则必须覆盖**每一条独立分支**（含裸 `software`）。现状：**已重写** —— 裸 `'software'` 那条被兄弟项蕴含的裸合取项换成对**独立分支**的观测（覆盖地板写在 `:319` 一带，注释点明它守的是 `software|` 这条独立 alternation）。牙：**yes**。
- **L50** `[C4｜low｜H]` `test/verify-theme-follow.mjs:581-588`（同形 `:629`、`:663`） —— 守：无地板驱动器循环必须收进有订阅在场地板的辅助路径。现状：**已加固** —— `:581` 起是共用的驱动器地板（这几处循环否则静默空转）。牙：**yes**。
- **L51** `[C4｜low｜H]` `test/verify-theme-follow.mjs:581` —— 守：偏好改成 `light` 后必须真的置上让位痕迹。现状：**已加固** —— `:581` 的驱动器地板同时覆盖"订阅消失"那一支（只有"写入被卡住"那一支有牙时，"订阅消失"那一支恒真；有牙的兄弟在 `:213`）。牙：**yes**。
- **L52** `[C1｜low｜不改]` `test/verify-softrender.mjs:214-220` —— 留下的不是 `typeof URLSearchParams` 字面守卫，而是场景开关 `provideURLSearchParams`（默认 `true`，`:136`；`:220` 才决定是否注入 `sandbox.URLSearchParams`），被 I1 `:569`（false ⇒ 正则 + `decodeURIComponent` 回退分支）/ I2 `:581`（true ⇒ `new URLSearchParams`）/ I3 `:593`（正对照）**真用**（三条在 `:555-599`）。复核结论：**已是解决态** —— L48 已把这个洞从根上补好（删死开关 + 三条可达场景），删开关反而会削弱场景矩阵。牙：**yes（经 L48 的场景矩阵）**。
- **L53**/**L55** `[取消]` —— 两条都指向不存在的判据/名单：L53 指向的那段代码与 M28（`test/verify-fontset.mjs` 的同一 `check` 体）是同一处，已随 M28 整段改写；L55 指向的 `verify-*.mjs:1` 弱判据名单不存在，同类候选清单是 `test/tools/audit-guard-teeth.mjs` 的**运行期输出**，已由 M33 覆盖（E 段不再报假阳性）。牙：**n/a（无对应判据）**。

**守卫补漏（N4–N6）与 `test/tools/`**
- **N4** `[B2｜low｜H]` `test/verify-types.mjs:210-212`、`:227-229` —— 守："无幽灵字段"必须有非空域。现状：**已加固** —— 两条 check 表达式改成 `a.declared.length > 0 && a.missingInCode.length === 0`（interface 解析失败时 `declared` 为空 ⇒ `missingInCode` 恒 `[]`，会以"没有幽灵字段"通过 ⇒ 恒真）。牙：**yes**。
- **N5** `[B4｜low｜D]` `test/verify-types.mjs:219` —— 原址（已删除）：`a.declared.length === INVENTORY_REQUIRED.length` 被同一条里的 `missingDeclared`/`extraDeclared` 逐名蕴含；原地留注释点名分工（现行 `:217`/`:225`/`:243`）。牙：**n/a（冗余）**。
- **N6** `[A4｜low｜H]` `test/live-frame-async-identity-smoke.mjs:246-263` —— 守：live 层"已挂载"必须是产品行为，而不是"装置自己 `createElement` 推了一个 iframe"。现状：**已加固** —— 新增 `liveUrlOf`/`boundFrame`（`:256-260`），用产品的独立可观测绑定判定（class 含 `we-live-iframe` ∧ URL 含 `/scene-live/` ∧ 含夹具 A 的 `tok-a`），判据 `iframeEls.length >= 1 && !!boundFrame`。牙：**yes**。
- **F4** `[C5/C6｜low｜不改]` `test/tools/branch-notify.mjs:198-215` —— CLI 分支只打印候选、无断言、恒 exit 0。**不改**（并已在 `docs/DEV-GUIDE.md` §4.6 写明「只印候选、何时跑、看到候选怎么处置」）：文件自述"输出是**候选**、要人读"，被 import 时导出 `pathNotifications`/`definitionsOf`/`DEF`/`defName`，判据在 `test/verify-client.mjs` ①h/①i 那一侧 ⇒ 定位落差而非反模式。`test/tools/` 不在牙齿普查的扫描面内（`test/tools/audit-guard-teeth.mjs` 只枚举 `test/` 顶层的 `verify-*`/`*-smoke`）⇒ 「恒 0 出口」这类形态在那套普查里结构上看不见。牙：**n/a（人读）**。
- **F5** `[A2｜low｜不改（已补对齐判据）]` `test/tools/sync-webwallgl.mjs:41` —— `BASE_PATH` 曾只用于自比（`:63-64`/`:90`/`:155`），与产品真值 `lib/routes/scene-serve.js:55` 无对齐判据。现状：**对齐判据已加** —— `test/verify-logging.mjs` 的 N7③ 把「rig 的 `BASE_PATH` / 产物 `lib/webwallgl/index.html` 的绝对引用 / 宿主注册的 `${BASE}/…` 前缀」三者钉在一起，带 4 条负对照（改 rig base、改产物引用、改宿主 `BASE`、字面量抠不到）；判据只认单引号字面量形态 ⇒ 上游换代（双引号 / 模板串）会以「抠不到」报红，不是漏判。rig 本身仍是纯手动 vendoring（`:11-17` 自述、`package.json` 无任何调用），缺前置时 exit 1，本机跑它仍以「缺上游」文案退出（环境缺失）。牙：**yes（N7③）**；rig 自身 n/a（手动）。

---

## 5. 系统性模式

1. **约定 5 的 ② 号写法是主导失效模式**（C3 ≈ 一半发现）：判据在**闭包/内联**里定义（不是命名函数或命名正则常量），于是写对照时只能"再抄一遍"。`test/verify-glass-surfaces.mjs` 的过滤器内联、`test/verify-about.mjs` 的正则重打是样本；`test/verify-route-index.mjs:44-46` 的 `sameAsIndex` 与 `test/verify-client.mjs` 的 `migrationHasV6` 是反例。
2. **`if (x) { …断言… }` 的"软地板"**（C4）：文件里到处有 `assert.ok(x, '缺则后面断言零覆盖')` 这种**正确**约定（`test/verify-client.mjs:1620-1623` 一带），漏掉的恰好是"唯一覆盖某条产品契约"的那几块（已按 §3 逐条加固）。同一形态也出现在**驱动器循环**上：订阅不在时"没有痕迹"恰好能通过 —— 有牙的兄弟是 `test/verify-theme-follow.mjs:213`。
3. **期望值来源漂移**（A1/A2/A4）：`test/verify-readability.mjs` 复刻产品算术、`test/verify-about.mjs` 复刻宿主正则、`test/verify-cache-dir.mjs` 与 `test/verify-logging.mjs` 抄文案 ⇒ 期望值与被测对象同源，均已按"期望值必须来自独立来源"重写。A2 那一类已有落地范式（漂移声明 + 键集快照 + 人工确认零漂移），值得复制到其它夹具。
4. **空域与自比**（B1/B2）：`{...}.every()` 与字面量自比散落在 8 个文件里 ⇒ 恒真；共同后果是**判据名字声称一个语义、判据体验证另一个语义**（`test/verify-retired-lines.mjs` 那处甚至正好相反）。现在的判据要么有非空域地板、要么已被更早的断言覆盖。
5. **守卫的"域"退化无人守**（C6）：`src/**` 枚举、`lib/` 枚举、抽取正则都可能静默退化成空。仓库已把"从磁盘枚举 + 地板"写成约定（`docs/DEV-GUIDE.md` 约定 4），剩下的缺口是**地板与被守护的域不在同一作用域** —— §3/§4 里的 6 条已就地补上，机械检查仍值得加（见 §0 末尾）。
6. **"恒红"与"静默不可达"同一个洞的两面**（H7）：一个被静默吞掉的求值错误会让同段判据一半永远红、一半永不执行。这类洞只在"守卫从来不自动跑"的环境里存活（`harness-compat.yml` 触发面只有 `workflow_dispatch`）⇒ 探针脚本在求值错误路径上不许静默，并给每个探针脚本加"本次至少执行了 N 条判据"的地板。

---

## 6. 已核查但判定"不算问题"

- **机械审计假阳性**：`test/verify-presets.mjs:55`（`failed++` 先执行，文件在 `failed !== 0` 时 exit 1，那条 `check` 是报告辅助函数而非产品判据）；`test/verify-logging.mjs:134` 的 `const calls = []`（在 `:133` 开的块内，与 `:82` 形参的另一个绑定同名不同物）；`test/verify-scene-live.mjs:1694` 的 `const hits = (text) => …`（是判据函数，被完整求值；另一处 `hits` 在别的函数局部，同名不同物）。
- **假件不是 C1 的地方**：`test/verify-scene-live.mjs` 的 mock Node/HTTP/DOM 装置经 `apply(mockCtx)` 载入**真的** `lib/index.js` 并驱动真注册的 handler；Level D 导入真的 `src/*.js`；`test/verify-windows-caption.mjs` 的假外观观察器**刻意**复刻官方 preload 的"只看 style"约束（建模真实约束，不是复刻产品逻辑）；`test/tools/weT-shim.mjs` 是合法替身（`weT` 是构建期内联的函数声明）。
- **有牙的 A3 形态**：`test/rotation-prepared-leak-smoke.mjs` 与 `test/rotation-smoke.mjs` 从构建出的 `lib/client.js` 文本读期望（`FADE_GRACE_MS`/`FRAME_BYTES_MAX`），形态像 A3，但每条都在注释里给了理由、漂移时**硬失败**（`Number(code.match(...)[1])` 抛异常/NaN）。
- **两条 golden 棘轮不算 A2**：`test/verify-picker-props.mjs:420-455`（`EXPECTED_PROPS_GOLDEN` + 长度锚 + 变异对照 + `DSH_MUT_LIB`）与 `test/verify-fontset.mjs:210-257`（`GOLDEN_LINES` + `--record` + 对照 + 差一字符可达性探针）。
- **注释里的取舍理由不是判据**：一批位置的产品取舍以注释形式写在测试里（`test/verify-media-bridge.mjs` 的环境跳过、`test/verify-scene.mjs` 的竞态说明、`test/verify-host-paint-scope.mjs:42` 的 `catch { CSS = CSS_BODY; }` 回落扫同一文本）。这清单按"有可证伪判据"衡量不报 —— 但理由被删不等于行为被守住，改这些块时要重新确认。
- **`test/tools/branch-notify.mjs` 的 CLI 恒 `EXIT=0`（F4）—— 定位落差**：CLI 分支打印候选后即结束（只有用法错误那一支 exit 1），`package.json` 里没有它；文件自述"输出是**候选**：要人读"，被 import 时导出判据本体 ⇒ 库里跑判据 + CLI 给人读的两用体。处置：**不加棘轮**，只在 `docs/DEV-GUIDE.md` §4.6 写明「只印候选、何时跑、看到候选怎么处置」；`test/tools/` 不在牙齿普查的扫描面内 ⇒ 恒 0 出口不会被那套普查发现。
- **`test/tools/sync-webwallgl.mjs` 的 `BASE_PATH` 只自比（F5）—— 纯手动 rig**：与产品真值无判据对齐，但它是手动同步上游的构建脚本，`package.json` 无任何调用，缺前置时 exit 1 ⇒ 没有「假保证」可失。**处置：对齐判据已加** —— `test/verify-logging.mjs` 的 N7③（见 §4 的 F5 条）。
- **`docs/DEV-GUIDE.md` §4.6 的 `test/tools/` 清单不算自相矛盾**：小标题按"是否被工作流/门调用"读，正文已补一句「其中 `host-route-index.mjs` / `js-text.mjs` / `branch-notify.mjs` **同时是守卫的库** ⇒ 改它们等于改判据，走 `npm run verify:all`」。
- **明确的干净文件**：`test/verify-body-caps.mjs`、`test/verify-inventory-index.mjs`、`test/verify-json-response.mjs`、`test/verify-picker-upload.mjs`、`test/verify-picker-model.mjs`、`test/fontset-load-smoke.mjs`、`test/verify-package-files.mjs`、`test/verify-adapter.mjs`、`test/verify-reachability.mjs`、`test/verify-module-layout.mjs`、`test/verify-dead-declarations.mjs`、`test/verify-guard-map.mjs`、`test/compat-harness-live.mjs`、`test/tools/token-contract.mjs`、`test/tools/i18n-scan.mjs`、`test/tools/host-route-index.mjs`、`test/tools/guard-targets.mjs`、`test/tools/analyze-host-apply.mjs`、`test/tools/audit-fixture-coverage.mjs`。
- **`test/compat-harness-live.mjs` —— 真 harness 集成探针，两侧判据齐**：隔离 HOME/USERPROFILE + 钉住 `DSH_WE_DATA_DIR`、`DSH_WE_MEDIA_LEGACY=1`，由 `.github/workflows/harness-compat.yml` 的 `--channel tarball --fresh` 调用。有牙判据包括：隔离家目录探针（失败也记 `false` ⇒ 整轮红）、`npm pack` 恰好一个 tarball 且 > 200 KiB、按 realpath 自证通道（`isSameFile` 抛错返回 null ⇒ 红）、真安装器 stdout 上的 peer 校验失败与闭包解析失败、profile 登记、token URL、就绪探针 token→303+Set-Cookie→`GET /`→200、`GET /wallpaper-engine/diag?msg=<marker>` → 204（带无 token 重试腿）、从 `<DATA_DIR>/diag/http.jsonl` 重读标记并要求 `kind === 'renderer'`、`/diag-log` 环形缓冲含标记、进程存活、日志无插件树加载失败。
- **机械 grep 假阳性（不要当缺陷报）**：`test/e2e-web-media-origin.mjs` 只在诊断信息里写错文件名（实际读 `src/styles.js`；CSS 为空时布局判据仍会红）、`:507` 的 `try { mine.push(JSON.parse(line)); } catch { /* ignore */ }`（丢一行 ⇒ beacon 判据红）；`test/compat-harness-pages.mjs` 的 `|| await evS(…)` 是**重查**而非重言式（`false || null` 仍然红）、右栏缺席只报 info（判据自称"在场才判"，包源侧另有覆盖）；`test/verify-softrender.mjs:366` 的未守卫下标是 `check()` 的**实参**（空表会抛 TypeError 并被捕获 ⇒ exit 1 的响亮失败）；`test/verify-theme-follow.mjs` 用同一输入调产品两次是**确定性**判据（对有状态/记忆化实现可证伪）；`test/verify-theme-follow.mjs` 的 `px` 参数名 `b2` 只是避免遮蔽外层 `Buffer` 的 `b`。
- **"注释已承认"档里仍成立的两条范本**：`test/verify-softrender.mjs` 的运行时场景把**变异的** renderer/vendor 串推进唯一可观测的 `hook()`，且每条集合类判据都有显式地板（E1–E5 各一条）；`test/verify-theme-follow.mjs` 的 `themeMovesUnderSwitch`、`restoreCase`、命名正则常量 `releaseThenEmitRe` 都被正负两侧共用。
- **`test/e2e-web-media-origin.mjs` 的定位**：它**不是守卫**，是手动浏览器 rig（文件头声明不属于 `npm run verify`）。按这个自称衡量，它的 beacon 类判据确实在驱动真中间件与真渲染器；§4 里报的只是"不能失败"或"静默不跑"的那几条。
- **手动 rig 的退出码语义正确**：`test/tools/underlay-pixel-rig.mjs` / `sidebar-props-scroll-rig.mjs` / `diagnose-web-blank.mjs` 缺前置时 `exit 2`；`analyze-host-apply.mjs` 自述"退出码恒为 0（这是度量工具，不是守卫）"。

---

## 7. 覆盖矩阵

| 组 | 文件 | high | medium | low | 合计 |
| --- | --- | --- | --- | --- | --- |
| 1 | `test/verify-client.mjs` | 0 | 3（M1–M3） | 3（L1–L3） | 6 |
| 2 | `test/verify-scene-live.mjs` | 0 | 5（M4–M8） | 3（L4–L6） | 8 |
| 3 | scene / media 6 文件（`verify-scene` / `verify-transcode-state` / `verify-mp4-vfs` / `verify-inventory-index` / `verify-cache-dir` / `verify-json-response`） | 1（H6） | 6（M9–M14） | 1（L33） | 8 |
| 4 | route / logging 7 文件（`verify-body-caps` / `verify-route-index` / `verify-route-families` / `verify-host-paint-scope` / `verify-we-install-probe` / `verify-logging` / `verify-media-bridge`） | 3（H1–H3） | 3（M15–M17） | 2（L38、L39） | 8 |
| 5 | `verify-glass-surfaces` + `verify-glass-compositing` | 1（H4） | 8（M18–M25） | 1（L37） | 10 |
| 6 | font / picker / about 9 文件 | 0 | 3（M26–M28） | 7（L11–L17） | 10 |
| 7 | smoke 6 文件 | 1（H5） | 3（M29–M31） | 3（L34–L36） | 7 |
| 8 | contracts / packaging 9 文件 | 0 | 0 | 10（L18–L27） | 10 |
| 9 | structure / tools / fixtures | 0 | 2（M32、M33） | 6（L28–L32、L54） | 8 |
| 10 | `verify-readability` / `verify-theme-layer` / `verify-windows-caption` | 0 | 0 | 4（L7–L10） | 4 |
| 11 | `compat-harness-{live,pages,surfaces}` + `e2e-web-media-origin` | 1（H7） | 0 | 6（L40–L45） | 7 |
| 12 | `verify-softrender.mjs` + `verify-theme-follow.mjs` | 0 | 0 | 9（L46–L52、L53、L55） | 9 |
| 13 | `verify-client-sync.mjs` / `verify-types.mjs` / `verify-token-contract.mjs` / `live-frame-async-identity-smoke.mjs` | 0 | 3（N1–N3） | 3（N4–N6） | 6 |
| 14 | `test/tools/branch-notify.mjs` / `test/tools/sync-webwallgl.mjs` / `test/tools/audit-guard-teeth.mjs` / `test/tools/js-text.mjs` / `test/tools/audit-import-closure.mjs` | 2（F1、F2） | 1（F3） | 2（F4、F5） | 5 |
| **合计** | **72 个 `.mjs` 全覆盖** | **9** | **37** | **60** | **106** |

**校验式**：`9 + 37 + 60 = 106`；逐组累加 = `6+8+8+8+10+10+7+10+8+4+7+9+6+5 = 106`。取消的两条（L53、L55）已无对应判据、也无对应文件，按其所在段落计入组 12；L54 计入组 9。

- 处置分布：**重写 R 47 / 加固 H 33 / 删除 D 19 / 裁决不改 5（L3、L52、M32、F4、F5）/ 取消 2（L53、L55）= 106**（H7 同时含"删一行 + 加固一处"，按一条计）。逐条处置写在各条目的「现状」里。取消的两条与裁决不改的 5 条都计入上表所属档。`X1`（组 11）、`X2`（组 12）、`X3`（组 9 的 `warn-only` 面）与已计数条目同址，**不另计入**本表。
