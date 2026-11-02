# pet-link 可选依赖口径：petApiDshwe 探测与 inject/纯度判据对齐（t14）

> 日期 2026-10-30；范围 `repo-dsh-wallpaper-engine/packages/pet-link` + 纯度判据；不改 M5 排播、不改 M4 安装事务、不动产物 tgz。

## 1. 结论（先探测定论，不凭记忆）

**本机 DSH 实际使用的 Cordis 不支持「可选依赖」声明**，因此 `ctx.get('petApiDshwe')` 是正确写法；判据把它误判为「未声明的必需依赖」，属**判据过严**，已修判据。

证据（从 `C:\Users\Fish\AppData\Local\Programs\DSH NEXT\resources\app.asar` 直接解出）：

- 应用：`dsh-desktop-next` **2.0.20-next**；`app.asar` 内 `node_modules/@deepseek-ai/cordis` 版本 **4.0.5**（`APP_DEP @deepseek-ai/cordis=4.0.5`）。
- `cordis@4.0.5 src/registry.ts`：
  - `export type Inject<M = Dict> = (keyof M)[] | { [K in keyof M]?: M[K] }`
    —— 对象形态是「服务名 → 拦截配置」，**没有 `required` / `optional` 字段**；
  - 「the required service name」「unloaded and re-run whenever a required service changes」
    —— 凡写进 `inject` 的服务都是**必需依赖**（fiber 等它出现才激活）。
- `cordis@4.0.5 src/reflect.ts`：`ctx.get(name)` —— "Read a service from the store without the inject requirement"
  —— 这正是官方提供的「不声明 inject 也能读」的**可选访问**入口，读不到返回 `undefined`。

⇒ 不能把 `petApiDshwe` 加进 `inject`（否则没装 dsh-pet-dshwe 时整个子包不激活，破坏计划 §3.3 的 native 降级）；
⇒ 保留 `ctx.get`；**问题在判据把方法名 `get` 当成了服务名**。

## 2. 实现（host 半 / browser 半同一语义）

- 宿主半 `packages/pet-link/lib/index.js`：新增导出工具 `probeOptionalService(ctx, name)`
  （try/catch 包 `ctx.get`，读不到给 `null`），`probeRunning: () => Boolean(probeOptionalService(ctx, 'petApiDshwe'))`。
  注释明确「**这是可选探测，不是必需依赖 —— 不许把 petApiDshwe 加进 inject**」。
- 浏览器半 `packages/pet-link/src/client.js`：新增本地 `probePetApi()`（同语义），
  `getApi: probePetApi`，`playAnim` 成功后的 `pollState` 也走它。
- `export const inject` 两半都不含 `petApiDshwe`（宿主半仍是 `['webServer','wallpaperEngineHost']`，浏览器半仍是 `[]`）。

## 3. 判据对齐（修判据，不删判据、不放宽到失去意义）

`test/verify-subpackage-purity.mjs` 的 inject 一致性判据原实现用正则抽 `ctx.<ident>` 当作「消费的服务名」，
把 `ctx.get` 的**方法名 `get`** 也当成服务，于是误报 `用了 ctx.get 但 inject 里没有声明它`。

修正：引入 `CORDIS_CONTEXT_API` 集合（真源 = cordis 4.0.5 `src/reflect.ts` 的 mixin 表：
`get/set/provide/accessor/mixin`、`runtime/effect`、`inject/plugin`、`on/once/parallel/emit/serial/bail/waterfall`，
外加 `logger/root/intercept`），在「消费的服务名」里排除这些 **Cordis 内建 API**。

- **判据意图不变**（防未声明的**必需**服务消费）：只排 API 名，不排业务服务名。
- **两向负对照都在**：
  - `ctx.get('可选服务')` 不写 inject ⇒ 不判红（新增 `negOk`）；
  - `ctx.get(...)` 旁的 `ctx.foo.bar()` 仍判红（新增 `neg`）；原 `ctx.webServer` 未声明仍判红。

结果：纯度判据里 `packages/pet-link/lib/index.js 用了 ctx.get …` 这条**已消失**。

## 4. 夹具

`test/verify-pet-optional-probe.mjs`（6 段 PASS）：

1. 宿主半 `inject` 不含 `petApiDshwe`；
2. `probeOptionalService`：无 ctx / 无 get / undefined / 抛异常 → `null`；命中 → 服务实例；
3. 无 `petApiDshwe` 时宿主半 `applyImpl` 装载成功并可 `dispose`；有服务时同样装载成功；
4. 浏览器半：无服务 → `petLinkMode()==='native'` 且 `reason==='runtime-not-installed'`；有服务 → `'linked'`（探测命中）。

## 5. 验证命令与结果

```
node test/verify-pet-optional-probe.mjs   # 6 段 PASS：无运行时装载+native 回落 / 有服务探测命中
node test/verify-pet-linked.mjs           # PASS（M5 双 provider + 四条排播 + 回落 + sleep/wake）
node test/verify-pet-link.mjs             # PASS（可选桌宠联动完整定点回归）
node test/verify-subpackage-purity.mjs    # ctx.get 的 inject 误报已消除；负对照两向 ok
```

- 纯度判据**剩余**的 1 条 FAIL 是 `声明落点产物不在盘（先跑 npm run build）`——客户端产物未构建（M5 已说明属构建缺失），**与 ctx.get 无关**。
- `verify-guard-map.mjs` 仍为 2 条红（`run-pnpm.js` 零覆盖未登记 + 映射生成物需 `--write` 重算），与改动前**同数同因**，属 M4/构建侧，不属本任务 `ctx.get` 口径。
