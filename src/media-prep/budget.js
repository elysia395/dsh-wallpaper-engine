/**
 * media-prep/budget.js — 媒体预备族的**live 准备超时账本**（S5 从 src/media-prep.js 纯搬移）。
 *
 * 单一真源：PREPARE_LIVE_TIMEOUT_LIMIT / PREPARE_LIVE_HIDDEN_HOLD_MAX_MS /
 * PREPARE_LIVE_HIDDEN_POLL_MS / prepareLiveTimeouts（wallpaper id → 连续超时次数）+
 * prepareLiveExhausted / notePrepareLiveTimeout / clearPrepareLiveTimeout。
 * 记账只许清零或自增；达到上限后本会话不再对该壁纸预挂载 live。
 * 被根组装点（scene 两阶段）、live 层与面板/守卫读。
 */

// live 渲染页预载：staging 层（opacity:0 但 in-DOM 且几何满视口 → 渲染页按
// 全分辨率正常初始化）里加载 WebWallGL 渲染页，首帧判定与 startLiveWatch
// 同口径（__wpStats running && fps>0）→ 就绪后 staging 容器在 commit 时整体
// 转为新层（节点级领养，iframe 不移动 —— 同文档 reparent 会重载文档）。
// 超时/失败回退 sceneVideo/静态帧阶段；刻意不簿记 sceneLiveFailures ——
// 探测放弃不等于渲染失败，切换后的正式心跳仍有自己的首帧看护兜底。
// 准备期 live 首帧连续超时的候选：本会话不再对它尝试 live 准备，直接走
// sceneVideo/静态帧。理由：超时候选本来也进不了 live，而每次尝试都要重新完整
// 拉一次 scene.pkg（host 对 /scene-files 响应 no-store，没有 HTTP 缓存）+ 满
// 视口渲染最多 LIVE_FIRST_FRAME_MS，并且准备失败刻意不簿记 sceneLiveFailures
// （探测放弃 ≠ 渲染失败）→ 不设闸就是每轮轮换重来一次。手动选择壁纸走的是建层
// 路径、不经过准备链，不受此闸影响；准备期真的出首帧即清零，下轮恢复正常尝试。
const PREPARE_LIVE_TIMEOUT_LIMIT = 2;
// 准备期中途被隐藏（人切走了）最多等多久：短时间离开就等着 —— 回来能看到本轮
// 立刻完成切换；超过上限则释放 staging 渲染页（pkg 堆 ~10MB + 数十 MB 显存），
// 转为「可见时补做」，且不记超时计数（隐藏 ≠ 这张壁纸 live 走不通）。60s 与轮换
// 间隔同量级：离开超过一轮就没必要替用户先切好，回来再切更贴近直觉，也省掉
// 「隐藏数小时 = 每 4 分钟加载一次 pkg」的反复冷启动。
const PREPARE_LIVE_HIDDEN_HOLD_MAX_MS = 60000;
// 隐藏期探测间隔（显式拉长）：隐藏页定时器本来就被 Chromium 钳到 ≥1s、5 分钟后
// 1/min，写 2s 是为了让「这里不需要高频探测」这层意图留在代码里。
const PREPARE_LIVE_HIDDEN_POLL_MS = 2000;
const prepareLiveTimeouts = new Map(); // wallpaper id -> 连续超时次数
function prepareLiveExhausted(wid) {
  return (prepareLiveTimeouts.get(String(wid || "")) || 0) >= PREPARE_LIVE_TIMEOUT_LIMIT;
}
function notePrepareLiveTimeout(wid) {
  const key = String(wid || "");
  if (!key) return;
  const n = (prepareLiveTimeouts.get(key) || 0) + 1;
  prepareLiveTimeouts.set(key, n);
  if (n === PREPARE_LIVE_TIMEOUT_LIMIT) {
    // 降级（本会话对该壁纸不再尝试 live）⇒ `warn`；经 liveLog 走同一条诊断通道
    //（浏览器控制台 + 宿主 /diag 环形缓冲），不再自打一行裸 console。
    try {
      liveLog("prep-live-timeout",
        "wid=" + key + " 连续 " + n + " 次超时 → 本会话对该壁纸改用 sceneVideo/静态帧", "warn");
    } catch { /* ignore */ }
  }
}
function clearPrepareLiveTimeout(wid) {
  const key = String(wid || "");
  if (key) prepareLiveTimeouts.delete(key);
}

