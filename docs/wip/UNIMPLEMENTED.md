# 尚未实现 / 已知缺口

> 状态：`wip/` 工作清单（依据 ADR-0017 D2/D5；寿命规则见 [`../README.md`](../README.md)「目录的寿命规则」）。
> 只登记「设计过 / 答应过、但还没做成事实」的东西；机制、判据、取舍分别住在实现文件头注释、`test/`、`adr/`。
> 完成一项就删一项（结论落到该住的地方）；整件收口后本文件移入 `docs/archive/wip/`。

## Linux 壳窗遮挡

现行规格：`CODE-STRUCTURE.md` §9。已实现：X11 适配器 `lib/occlusion/x11.js`、OcclusionHub、宿主路由、渲染页桥、客户端轮询。

1. **Wayland 后端未实现**。按会话的设计矩阵：

   | 会话 | 主路线 | 备用 | 最后 |
   | --- | --- | --- | --- |
   | sway/i3、Hyprland、niri | socket/stdio IPC（逻辑坐标，零特权） | portal 像素差 | 二值 |
   | KDE Wayland | KWin 脚本 `callDBus` → 宿主 D-Bus 服务（勿走 plasma-window-management，被 plasmashell 的窗口隐藏策略误导） | portal 像素差 | 二值 |
   | GNOME Wayland | Shell 扩展 `get_frame_rect` + D-Bus 导出 | portal 像素差（`restore_token`） | 二值 |
   | river/COSMIC/未知 | portal ScreenCast 像素差 | — | 二值 |

   ⚠️ Wayland 会话**禁止**走 X11/xwininfo（XWayland 隔离，看不见原生 Wayland 窗口，漏判 = 白渲染）。
   现状：非 X11 会话 hub 返回 `backend:"none"`，渲染器保持 `run` —— 即「不做遮挡优化」，不报错、不降画面。
   触发/依赖：有 Wayland 用户实际反馈或维护者自用时再拆；IPC 路线零特权，KDE / GNOME 需要宿主侧脚本或扩展配合。

2. **降级矩阵的各级备用路径未实现**：CLI 轮询（xwininfo/xprop）、portal 像素差、最小化二值 —— 目前只有 X11 主路线在跑，矩阵是设计而不是可用功能。
3. **Windows / macOS 遮挡通路未开始**（数据通路与 Linux 不同，另行立项）。

## 玻璃共存（ADR-0010 三批，只完成第一批）

已落地：①文档与契约（ADR-0010、`HOW-IT-WORKS.md` 的「共存」节、`TOKEN-CONTRACT.md` + 守卫）。

1. **S1 玻璃主开关 / 共存四态**：`full`（默认）/ `glass-only`（已支持，即关壁纸）/ `wallpaper-only`（渲染层就绪，缺主开关）/ `off`（= 皮肤让路态，升格为用户与第三方可声明）。四态键尚未进 schema，主开关未做。
2. **S3 让路协议通用化**：属性级 opt-out、对外让路信号。现状让路只认皮肤中心一个信号，不可被用户或第三方声明。
3. **S4 共存自诊断 + 一键降级到「仅壁纸」**：无入口。
4. **S6 / S7 未核对**：包含块预检常开（不依赖视差开关）、卸载健壮性（逐步 try/catch + 幂等 + 单一属性表）—— 审计表里标「未核对」，需逐条过。

真源：[`adr/0010`](../adr/0010-glass-off-revisit-four-states.md) D2/D3；审计证据 [`archive/wip/COEXISTENCE-AUDIT.md`](../archive/wip/COEXISTENCE-AUDIT.md)（历史记录，数字不作准）。

## 媒体切层

1. **视频档「真静帧门面」未做**：页面刚加载后的第一张壁纸没有旧层可守，首帧到位前会露一小段底色；方案是复用已有抽帧路径给视频档一个真静帧当门面（见 [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md#页面刚加载后的第一张壁纸会先有一小段底色)）。
2. **旧链网页壁纸的 `load` / `error` 未接入切层闸门**：裸 `iframe.we-iframe` 切换时可能短暂白 / 空；`prepareWebProbe` 已在用这两个信号，缺的是把它们接进闸门的信号表（见 [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md#切到网页壁纸旧链时有一小段白--空)）。
