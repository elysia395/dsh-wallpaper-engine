# 升级指南 / Upgrading

> 本文件承接原先放在 README 首页的**升级前置条件与版本兼容说明**。README 只保留一行提示 + 链接。
> 各版本修了什么见 [`CHANGELOG.md`](./CHANGELOG.md)；安装失败报错见 [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)。

## 中文

### ⚠️ 更新前置条件：① DSH 内核最新 ② better-sidebar 最新

**两个前置条件都满足之前，请勿更新本插件。** v0.7.2 适配 DeepSeek Harness **0.1.5-rc.1**
（对应 **DSH Desktop ≥ 2.0.7**），并要求 **dsh-better-sidebar ≥ 0.19.0**（0.19 起右侧栏接入
DSH 0.1.5 的官方原生侧栏；仍停留在 0.1.2-rc.1 旧内核的用户请保持 better-sidebar 0.18.x，**不要混搭**）。

| 组件 | v0.7.2+ 要求 | 停留在旧内核（0.1.2-rc.1）时 |
|---|---|---|
| DeepSeek Harness / DSH Desktop | 0.1.5-rc.1 / ≥ 2.0.7 | 0.1.2-rc.1 / v2.0.5 |
| dsh-better-sidebar | ≥ 0.19.0 | 0.18.x |

### 正确的更新顺序

1. **先把 DeepSeek Harness / DSH Desktop 更新到最新版**：DSH Desktop 在「顶部导航栏 → 版本信息」检查更新，或到 [GitHub Releases](https://github.com/anywhere-labs/dsh-desktop/releases) 下载对应平台安装包；
2. **再把 dsh-better-sidebar 更新到 0.19.0+**：`dsh plugin --profile web add dsh-better-sidebar@latest`；
3. **最后更新本插件**：`dsh plugin --profile web add dsh-plugin-wallpaper-engine`（或插件市场里点更新）。

> 💡 同时建议把**其它 DSH 插件也一并更新**：旧版插件在 harness 0.1.5 下可能直接加载失败
> （实测旧版 dsh-better-sidebar 在 0.1.5 下会因 API 变更异常）。

### 顺序反了怎么办

把内核与 better-sidebar 各自更新到匹配版本即可恢复；**无需回滚本插件**。

### 升级提示

插件更新后会在界面里弹一次提示（每个新版本仅出现一次），漏看也没关系。

### 兼容性实测记录

- **v0.7.1** 已在 DSH Desktop v2.0.5（harness 0.1.2-rc.1）上完成实测：壁纸宿主路由（inventory / media /
  scene-frame）、设置一级分区、选择器弹窗、视频与场景壁纸播放、拉绳抽屉、液态玻璃在「兼容模式」与
  「增强模式」下均正常。
- 本插件依赖的 slots / webserver / 主题变量等 API 在 0.1.2-rc.1 → 0.1.5-rc.1 之间经实测同样稳定。
- v0.7.2 起官方原生右侧栏纳入「侧栏液态玻璃」适配（修复升级 better-sidebar 0.19 后右侧栏整体透明的
  回归），细节见 [`CHANGELOG.md`](./CHANGELOG.md) 的 v0.7.2 条目。

---

## English

### ⚠️ Prerequisites for updating: ① latest DSH kernel ② latest better-sidebar

**Do NOT update this plugin until BOTH prerequisites are met.** v0.7.2 targets DeepSeek Harness
**0.1.5-rc.1** (shipped in **DSH Desktop ≥ 2.0.7**) and requires **dsh-better-sidebar ≥ 0.19.0**
(from 0.19 the right column plugs into the native right sidebar of harness 0.1.5; users still on the
0.1.2-rc.1 line should keep better-sidebar 0.18.x — **do not mix**).

| Component | Required by v0.7.2+ | Staying on the older kernel (0.1.2-rc.1) |
|---|---|---|
| DeepSeek Harness / DSH Desktop | 0.1.5-rc.1 / ≥ 2.0.7 | 0.1.2-rc.1 / v2.0.5 |
| dsh-better-sidebar | ≥ 0.19.0 | 0.18.x |

### The correct update order

1. **Update DeepSeek Harness / DSH Desktop first**: check for updates via the desktop app's top-bar version info, or grab the installer from [GitHub Releases](https://github.com/anywhere-labs/dsh-desktop/releases);
2. **Then update dsh-better-sidebar to 0.19.0+**: `dsh plugin --profile web add dsh-better-sidebar@latest`;
3. **Finally update this plugin**: `dsh plugin --profile web add dsh-plugin-wallpaper-engine` (or click update in the plugin market).

> 💡 Also update your **other DSH plugins at the same time**: older plugins may fail to load outright on
> harness 0.1.5 (an old dsh-better-sidebar was observed misbehaving on 0.1.5 due to API changes).

### If you updated out of order

Bringing the kernel and better-sidebar back to their matching latest versions restores everything —
**no plugin rollback needed**.

### Update notice

The plugin shows a one-time in-app notice per release; missing it is harmless.

### Verified compatibility

- **v0.7.1** has been verified on DSH Desktop v2.0.5 (harness 0.1.2-rc.1): host routes (inventory / media /
  scene-frame), the first-level settings section, the picker modal, video & scene wallpaper playback, the
  rope-dock drawer, and the liquid-glass effects all work in both Compatibility and Enhanced desktop modes.
- The APIs this plugin relies on (slots / webserver / theme variables) were verified unchanged between
  0.1.2-rc.1 and 0.1.5-rc.1.
- From v0.7.2 the official native right sidebar is covered by the「侧栏液态玻璃」adaptation (fixing the
  fully-transparent right column after upgrading better-sidebar to 0.19) — see the v0.7.2 entry in
  [`CHANGELOG.md`](./CHANGELOG.md).
