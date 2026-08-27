# Changelog

## 0.7.0 — Coexistence v1：与 dsh-web-ui-all（皮肤中心）二选一互斥

### 新增
- **外观归属状态机**（`appearanceOwner: "plugin" | "skin"`，host 持久化）：三态
  `owning / yielding / idle`。皮肤在场时自动让位（壁纸保留、配色单源）；归属皮肤中心时完全待机；皮肤被关闭后自动接管——互斥持续执行而非一次性快照。
- **设置页「外观归属卡」**：探测状态展示（皮肤 id / 自定义主题）、双按钮切换、契约上报开关。
- **双引擎阻塞选择卡**：双方壁纸同时运行时强制二选一；基于归因判据「无皮肤却存在 backdrop 标记 ⇒ 对方内置 WE 控制器在播」，第三方占用 `data-dsh-wallpaper-active` 同样触发。
- **契约上报**（可关）：owning/yielding 时向 html 写 `data-dsh-wallpaper-active`、向 body/html 写 `data-dsh-backdrop-active`，令 skin-center 的 composer 中和器与表面半透明化正确协作；所有权受控（只撤除自己置位的标记）。

### 兼容加固
- portal 打标不变量：所有 body 级动态根（层/scrim/拉绳宿主/模态/卡片）插入即带 `data-dsh-plugin="dsh-plugin-wallpaper-engine"`，被 skin-center 表面打标规则豁免。
- z-index 平手修正：更新提示 1100→1090（避让 web-ui-all 移动端侧栏抽屉）、picker 模态 1000/1001→1005/1006（避让详情覆盖层）；≤768px 且对方抽屉展开期间隐藏拉绳与提示。
- 字体补丁并入状态机：yielding/idle 不再注入 `we-font-patch`，全页字色交还皮肤主题。

### 性能
- SliderRow 输入合帧：拖动期间每帧最多提交一次（此前每 tick 全量持久化+applyEffects×2+整树重渲×2），组合多插件观察器场景显著降载。

### 工程
- `scripts/verify-coexist.mjs`：39 项 headless 断言覆盖相位门控快照、idle 卸载/恢复闭环、上报所有权、阻塞卡决策路径、portal 打标静态不变量等；已并入 verify 链路。

### 兼容基线
- 实测对象：@linxin666/dsh-web-ui-all@0.3.5 / @linxin666/dsh-client-ui-skin-center@0.3.5。上游语义属性若有变更，自检日志会给出保守降级（按“无皮肤”处理）。
