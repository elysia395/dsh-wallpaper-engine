# t4 QA 报告 — 双源下载 / 进度上报 / 卡片重排 交叉验证与联动零回归

- 日期：2026-11-01（Asia/Shanghai）
- 执行人：qa-ver（team `we-panel-download-ux`，task t4，attempt `afd65e6a-fc9b-48ce-ba6d-1a5946c240e8`）
- 仓库：`repo-dsh-wallpaper-engine`（工作区 `packages/pet-link` 整棵树**未跟踪**，见第 5 节）
- 口径：只读验证，不改实现。除本报告外未改动仓库内任何文件；唯一例外是守卫链第 2 步（`verify-client-sync`）会重建产物再比对，内容零变化但刷新了产物 mtime（见 6.3）。QA 的探针与日志全部落在工作区根的 `_t4logs/`（不在仓库内）
- 结论：**通过（verdict: pass）**。t1/t2/t3 的核心验收全部复现达成；3 条 low 级发现（1 条注释漂移、1 条验收措辞口径、1 条待确认的卡片间距静态证据），无 blocker / high。

---

## 1. 复现清单（每一条都能照抄重跑）

```powershell
cd D:\Fish-code\DSH-NEXT\插件\插件更新\repo-dsh-wallpaper-engine

# ① 全量守卫链（93 步）
node test/run-guards.mjs verify                 # 期望：✓ verify 全部 93 步执行完毕，exit 0
node test/run-guards.mjs verify --list-json     # 期望：steps=93

# ② t1/t2 的夹具（**注意：它不在 93 步链上**，见 6.2）
node test/verify-pet-install.mjs                # 期望：PASS 1..25 + guard + 总结，exit 0

# ③ 联动汇总夹具（17 件离线夹具，链上是 verify-pet-link.mjs 这一步）
node test/verify-pet-link.mjs                   # 期望：PASS 可选桌宠联动完整定点回归，exit 0

# ④ 本次 QA 独立探针（不用仓内夹具，11 组）
node D:\Fish-code\DSH-NEXT\插件\插件更新\_t4logs\probe-t4.mjs   # 期望：ALL PASS — 11 组探针全绿

# ⑤ 静态棘轮（改动面）
npx eslint packages/pet-link/src/pet-link/extension-card.js packages/pet-link/src/pet-link/panel.js `
  packages/pet-link/src/pet-link/i18n.js packages/pet-link/lib/pet-install/transaction.js `
  packages/pet-link/lib/routes/pet-install.js src/styles-ext.js   # 期望：无输出，exit 0
```

日志留档（工作区根 `_t4logs/`）：`run-guards-verify.log`、`verify-pet-install.log`、
`verify-pet-link.log`、`probe-t4.log`、`verify-steps.json`、`probe-t4.mjs`。

---

## 2. 判定摘要

| 项 | 判据 | 结果 | 证据 |
|---|---|---|---|
| t1-1 | npmmirror 优先、失败/超时回退 npmjs，tarball 路径规则一致 | **通过** | 探针 B1/B2 + `verify-pet-install` 场景 17/18 |
| t1-2 | 白名单扩到 npmmirror 但仍是固定集合（不放宽为任意 https） | **通过** | 探针 A（14 个伪装域名全拒）+ 探针「零请求」+ 场景 21 |
| t1-3 | 主名 `dshpet-dshwe`，旧名 `dsh-pet-dshwe` 兼容 | **通过** | 代码口径 + 场景 22/24，`state()`/`uninstall()` 覆盖两名 |
| t1-4 | 失败结构化错误（包名/版本/各源错误/官方地址） | **通过** | 探针 ④ + 场景 19/20/23 |
| t1-5 | sha512 integrity 保留 | **通过** | `verifyIntegrity` + `verifyDownload`；探针 B3 证明校验不符**不换源** |
| t2-1 | 下载期暴露进度回调（received/total，total 未知给 null） | **通过** | 流式 `getReader` 实现 + 探针 ③ |
| t2-2 | 只读端点 `GET …/pet/install-progress` 返回六个字段 | **通过** | 探针 ⑤：200 + `{state,received,total,percent,source,error}` |
| t2-3 | 终态保留一次供收尾、随后回 idle；出错保留 error | **通过** | 探针 ③（done→idle、error→idle）+ 场景 25 |
| t2-4 | 路由索引/计数同步 | **通过** | `docs/ROUTE-INDEX.md` 第 67 行 #48；50 条；`verify-route-index`（链上第 38 步）绿 |
| t3-1 | 卡片分层重排（标题行/状态/模式/共存/进度/失败块/主按钮/次按钮/分步/诊断） | **通过（结构）** | `extension-card.js:61-196` 顺序即此十层；`verify-pet-extension-card` 绿 |
| t3-2 | 进度条渲染在卡片**内部**、done 整块不渲染、error 走失败块 | **通过** | `extension-card.js:97-121`（仅 `phase==='installing'` 且 state∈三态时渲染）、`:274-285/329-341`（done/error 时 `progress=null`） |
| t3-3 | 失败块含包名 + 已尝试的源 + 官方地址（`_blank` + `noopener`） | **通过** | `extension-card.js:123-143`（`rel: 'noopener noreferrer'`，兜底 `PET_LINK_CARD_OFFICIAL_URL`） |
| t3-4 | 按钮组行为不动、联动逻辑零改动 | **通过（含证据限制）** | 见第 4 节：mtime 窗口 + 8 文件零污染 + 17 件夹具全绿 |
| t3-5 | i18n 中英双备 | **通过** | `i18n.js:135-142` 新增 8 条（安装进度/包名/已尝试的下载源/下载源/正在下载/正在校验/正在安装/双源均失败），`verify-i18n`（链上第 35 步）绿 |
| — | 全量 `run-guards verify` 93 步 | **通过** | 93/93，exit 0（见 6.1） |

---

## 3. 五项重点逐条落地

### ① 国内源失败真的回退 npmjs

`lib/pet-install/transaction.js`：
- `DEFAULT_REGISTRIES` = `registry.npmmirror.com` → `registry.npmjs.org`（顺序即优先级，`Object.freeze`）。
- `resolvePlanForPackage()`：先镜像解析 packument，再用**同一版本同一 integrity** 为后续 registry 构造候选
  ⇒ 下载阶段可跨源回退，且不会因镜像同步滞后而降版本。
- `fetchTgz()`：只有传输/HTTP 失败才 `continue` 下一候选；拿到字节后 `verifyDownload()` **在 try 之外**执行 ⇒ 校验不符是硬失败，不降级换源。
- 回执三处一致：`r.source`、`writeCredential().source`、`steps[download].detail`。

实测（`_t4logs/probe-t4.log` 全绿）：

| 场景 | 断言 |
|---|---|
| 镜像 tarball 503 | `r.ok=true`、`r.source='npmjs'`、凭据 `source='npmjs'`、detail 含 `via npmjs`、请求序镜像→官方 |
| 镜像元数据 AbortError（超时） | 自动落到 npmjs 解析并装成功，`source='npmjs'` |
| 镜像 tarball 字节与 integrity 不符 | `r.ok=false`、reason 属校验类、**npmjs 一次请求都没发**、`package.json` 与锁文件逐字节回到安装前 |

### ② 白名单未被放宽（构造外部域名验证被拒）

`ALLOWED_DOWNLOAD_HOSTS` 仍是四台固定主机，判据是 `url.protocol==='https:'` + `includes(url.hostname)`（**精确相等**，非后缀/非通配）：

```
registry.npmmirror.com | registry.npmjs.org | github.com | objects.githubusercontent.com
```

被拒样例（探针 A 实测 14/14 抛错）：`evil.example.com`、`registry.npmjs.org.evil.example.com`（后缀伪装）、
`evil-registry.npmjs.org`（子域）、`registry.npmmirror.com.cn`（相似域）、`npmjs.org`、
`registry.npmjs.org@evil.example.com`（userinfo 伪装）、`169.254.169.254/latest/meta-data/`（云元数据）、
`127.0.0.1`、`http://registry.npmjs.org`（非 https）、`file:///etc/passwd`、`//registry.npmjs.org`（无 scheme）、相对路径、非 URL 串。

补充判据（更硬）：把 `resolveReleaseOptions.registries` 换成 `https://evil.example.com`、manifest 也换成外部域名后，
**fetch 一次都没被调用**（`touched.length === 0`），错误体里记 `download-source-not-allowed`。这就是「发请求前就拒」的行为证据。

一处**不是**绕过：`https://registry%2Enpmjs%2Eorg/x.tgz` 会被 WHATWG URL 规范把主机里的 `%2E` 解码成 `.`，
解析结果就是 `registry.npmjs.org`（连接目标也是这台机），因此放行是正确的 —— 探针里用等价性断言而不是拒绝断言。

### ③ 进度端点：下载中 received 递增、done 后回 idle

代码口径：`defaultDownload()` 读 `res.body.getReader()` 逐块 `onProgress({received,total})`；
`total` 取 `content-length`（缺席给 `null`，`percent` 随之为 `null`）；非流式响应退回一次性读并补报终值。
`progress()` 对 `done|error` **只交付一次**，读走即回 `idle`（字节账归零、error 清空）；非终态可反复读。

实测（5 块流式 body，285 B tgz）：
- 在途连续读：`received` 单调递增 `57 → 114 → 171 → 228 → 285`（末次是下载完成的补满账，重复值不是回退），每次 `progress()` 都是 `downloading`（未被消费）；
- `onProgress` 覆盖 `downloading / verifying / installing / done` 四态；
- 第一次读终态：`{state:'done', received:285, total:285, percent:100, source:'npmmirror'}`；
- 第二次读：`{state:'idle', received:0, total:null, error:null}`；
- error 终态：读一次拿到结构化体，第二次读回 `idle` 且 `error=null`；
- 路由层：`GET` 200；`POST` 405（只读）；`sec-fetch-site: cross-site` 403。

UI 侧消费同一端点：`extension-card.js` 以 500ms 轮询 `/pet-link/pet/install-progress`，
`done` 立刻 `progress=null` 并停轮询（视图不再渲染整块，无空行占位），`error` 存进 `failBlock` 并停轮询，
连续 3 次轮询失败自动停（`PROGRESS_POLL_MAX_FAILURES`）；`POST /install` 回执一到无条件 `stopProgressPolling()`，迟到快照丢弃。

### ④ UI 只改了 extension-card / panel / i18n 与样式（联动逐字节未动）

**先说证据边界**：`packages/pet-link/src/pet-link/*` 与 `src/pet-link-performer.js` 在本工作区是**未跟踪文件**
（`git ls-files` 为空，`git status` 全是 `??`），HEAD 里没有 `packages/pet-link/src/pet-link/` 整棵树
⇒ **「git diff 证明」这条口径在本环境不可达**（不是实现问题，是仓库状态）。改用三重替代证据：

**(a) mtime 窗口**（UTC；t3 完工 17:06:40Z，对应本地 01:06:40）

| 文件 | mtime (UTC) | 归属 |
|---|---|---|
| linked.js | 2026-10-30T19:13:33Z | 不得触碰 |
| linked-shared.js | 2026-10-31T14:46:06Z | 不得触碰 |
| linked-mascot.js | 2026-10-31T14:46:40Z | 不得触碰 |
| linked-sidebar.js | 2026-10-30T16:15:35Z | 不得触碰 |
| linked-egg1.js | 2026-10-30T18:44:40Z | 不得触碰 |
| linked-egg2.js | 2026-10-30T12:29:03Z | 不得触碰 |
| pet-link-performer.js | 2026-10-30T09:42:30Z | 不得触碰 |
| mode.js | 2026-10-30T19:09:09Z | 不得触碰 |
| **extension-card.js** | **2026-10-31T17:01:56Z** | t3 |
| **i18n.js** | **2026-10-31T17:02:17Z** | t3 |
| **src/styles-ext.js** | **2026-10-31T17:02:51Z** | t3 |
| **panel.js** | **2026-10-31T17:03:24Z** | t3 |

分界干净：t3 的四次写全部落在 17:01:56Z–17:03:24Z（约 88 秒内），其余联动文件最近一次写是 14:46:40Z，
**早于 t3 首次写 2 小时 15 分钟**；t3 的 attempt 结算时间是 17:06:40Z。

**(b) SHA-256 锚（供此后漂移检测；只取前 16 位）**

```
4ded3c03c9765bb6  linked.js            (8858 B)
991e2b9d6f4490ff  linked-shared.js    (54641 B)
f3053e1768283953  linked-mascot.js    (10633 B)
171a437802430dcb  linked-sidebar.js    (5668 B)
b51adbb83f76a84c  linked-egg1.js       (6269 B)
a53a59e3a7d1eb29  linked-egg2.js       (5824 B)
7bbfab99a15a70dd  pet-link-performer.js (16539 B)
e8ab234466893290  mode.js              (4780 B)
```

**(c) 零污染静态检查**：上述 8 个文件对 `install-progress / failBlock / we-pet-link__ / dshpet-dshwe / npmmirror`
的命中数 **全部为 0** —— 卡片/安装/双源这些新概念没有渗进联动层。

**(d) 行为回归**：`node test/verify-pet-link.mjs` 全绿（17 件离线夹具：四分区排播、彩蛋计数、
未装/关闭/探测失败回落、sleep-wake、无逐帧 HTTP、共享层收尾、气泡时间节点、duration 隐藏规则…），
链上第 81 步 `verify-pet-link.mjs` 也绿。

产物侧另有一条硬证据：链上第 2 步 `verify-client-sync` 判定
`lib/client.js (5e43c5022032 · 4515069 B)` 与 `packages/pet-link/lib/client.pet-link.js (224aa830be38 · 217628 B)`
**等于按当前 src 重新构建的结果**（逐字节），且尺寸与 t3 自述一致 ⇒ 产物没有落后于源码，也没有夹带旧联动代码。

### ⑤ 失败块含包名与官方地址

`extension-card.js:123-143`：
- 包名：取结构化体 `error.package`，缺失兜底 `dshpet-dshwe`；
- 已尝试的源：`error.sources[].source (+ error)` 逐源拼接（只有真拿到结构化体时才渲染这一行）；
- 固定提示：`双源均失败，可从官方地址手动安装`；
- 官方地址：`error.officialUrl`，缺失兜底 `https://www.npmjs.com/package/dshpet-dshwe`；
  `<a href=… target="_blank" rel="noopener noreferrer">`（`verify-pet-extension-card` 与探针 ⑤ 双向印证：502 体里 `officialUrl` 就是该 URL）。
- 该块渲染条件与状态行一致（`phase==='failed'`），与 t3 自述一致。

---

## 4. 交叉验证里额外确认的「没坏」项

- 安装成功回执 `{ok, method, version, source, package, steps, state}`；失败回执 `{ok:false, reason, message, error?, steps, state}`（探针逐字段断言）。
- 双路径不变：pnpm 优先（`--config.node-linker=hoisted`、`--ignore-scripts`），pnpm 失败/缺失才走 tgz + integrity + 解包；场景 2/3/4 仍绿。
- 事务回滚不变：失败后 `package.json` / `pnpm-lock.yaml` 逐字节回到安装前（探针 B3/④、场景 5/6/7/8/19 均断言）。
- 并发互斥不变：`busy-install` / `busy-uninstall` 仍 409（场景 15/16 + 路由分支）。
- 页面不能指定下载源：`POST /install` 只读 `force`，`POST /uninstall` 只读 `keepData`，其余字段一律忽略。
- 路由同源守卫不变：`sec-fetch-site: cross-site` → 403；`Origin` 非同端口/非回环 → 403；dispose 后 → 410。
- 产物层：`lib/pet-install/*` 与 `lib/routes/pet-install.js` 在构建后仍在（`verify-client-sync`、`verify-package-files` 绿）。

---

## 5. 发现（findings）

| id | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| F1 | low | `packages/pet-link/lib/routes/pet-install.js:4-6`（文件头）与 `:51` | 头注释仍列「三条路由」、`registerPetInstallRoutes` 文档写「注册三条路由」，实际 `webServer.register` 注册 4 条（state / install-progress / install / uninstall），新增的 `install-progress` 没进头注释 | 把 `install-progress` 补进文件头路由表，`注册三条路由` 改「注册 4 条：状态 / 进度 / 安装 / 卸载」 |
| F2 | low | 验收措辞（t1/t2 报告与 team task 验收） | 「run-guards verify 93 步全绿（含 verify-pet-install）」**不成立**：`test/verify-pet-install.mjs` 被登记在 `test/tools/guard-chain.mjs` 的 `OFF_CHAIN_WHY`（理由：含真实 64MB 产物解包，耗时），93 步链里没有它。真实结果是「93/93 + 独立 `npm run verify:pet-install` 27 行 PASS」 | 措辞改成「93/93 + verify:pet-install 独立入口」；或把它挂进链上的 `test/verify-pet-link.mjs` 汇总（代价是链变慢） |
| F3 | low（待确认） | `packages/pet-link/src/pet-link/extension-card.js` 根 div + `src/styles-ext.js` we-pet-link 段 | 卡片根节点那一层 class 在 `styles-ext.js` **没有任何规则**；卡内十层之间没有 gap/margin 规则（`.we-ext__module` 的 6px gap 只作用于「模块头 / 描述 / 卡片」三块之间）。t3 自述的「主间距 8px」在静态证据里找不到对应的**容器**规则，实际是逐元素 padding/gap（`__head` gap 8、`__fail` padding 8 等） | 若有意为之，在样式段注释里写明「卡内行距由各层自带 token 提供，根容器不设 gap」；若要 8px 节奏，补一条根类 `display:flex; flex-direction:column; gap:8px`。**本机无浏览器，未做视觉判定**，故只报 low |

> 说明：F3 的两处类名在工具输出里会被脱敏成占位符，定位时按「`extension-card.js` 第 198 行返回的根 div 的 className」与「`styles-ext.js` 第 263-357 行的 we-pet-link 段」查即可。

---

## 6. 全量守卫链与口径澄清

### 6.1 `node test/run-guards.mjs verify`

```
✓ verify 全部 93 步执行完毕        （exit 0；日志 612 KB 级，605 行 ✓ / PASS；0 fail、0 skip、0 todo）
```

覆盖到本次改动面的关键步：`[1] verify-eol`、`[2] verify-client-sync`（产物 = 重建结果）、
`[3] verify-client`、`[28] verify-package-files`、`[35] verify-i18n`、`[38] verify-route-index`、
`[39] verify-route-families`、`[76] verify-pet-package`、`[81] verify-pet-link`、`[88] verify-guard-chain`。

### 6.2 脱链项（不是回归，是既有约定）

`verify-pet-install.mjs`、`verify-pet-linked.mjs`、`verify-pet-mascot.mjs`、`verify-pet-egg.mjs`、
`verify-pet-panel.mjs`、`verify-pet-extension-card.mjs`、`verify-pet-optional-probe.mjs`、
`verify-pet-tuner-coverage.mjs` 都在 `OFF_CHAIN_WHY` 里有非空理由（`verify-guard-chain` 第 88 步会强制这一点）。
其中后 7 件由链上第 81 步 `test/verify-pet-link.mjs` 逐个子进程执行；只有 `verify-pet-install.mjs` 是**纯独立入口**。

### 6.3 QA 自身对产物的副作用（如实记录）

本次跑链的第 2 步（`verify-client-sync`）会重建产物再比对，导致
`lib/client.js`、`packages/pet-link/lib/client.pet-link.js` 等产物的 **mtime 被刷新到 17:13:29Z**
（内容零变化：与 t3 自述尺寸、与测试打印的 hash 逐字一致）。除 mtime 外，本次 QA 未改仓库内任何文件。

---

## 7. 遗留 / 建议下家动作

1. F1 注释漂移（1 分钟）：`lib/routes/pet-install.js` 头注释补 `install-progress`。
2. F2 措辞（报告层）：后续回报一律写「93/93 + verify:pet-install 独立入口」，不要写成「链上含它」。
3. F3 视觉确认（需人眼/浏览器）：在 `设置 → 扩展 → 桌宠联动` 卡片上看卡内行距是否符合预期；
   若偏挤，补一条根容器 gap 规则即可（不涉及逻辑）。
4. 若要长期守住「联动文件零改动」，建议把 `packages/pet-link/src/pet-link/*` 纳入 git 跟踪
   （现在整棵树未跟踪，任何"改动前/后逐字节"的证明都只能靠 mtime + hash 锚）。