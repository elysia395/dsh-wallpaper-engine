/**
 * media-prep-handlers.js — 媒体准备处理器（预准备 / 构建 / 选中项落地），从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文与拆前 src/client.js 的 1350–1399 行逐字节相同。
 *   3) 顶层状态只有字面量（若有）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ── 媒体准备（预准备 / 构建 / 选中项落地）────────────────────────────────────
// 这一族的实现已抽到 **src/media-prep.js**（跨三个不相邻区段：预准备与轮换预挂载、
// applySelection、buildMedia）。构建期内联回本作用域，调用点无需改动。
// 契约：出向依赖清单 / 入口 / 不变量 —— 见该文件头（清单只在那里维护，此处不复述数量）。

function commitRotationSwitch(prep) {
  rotationPrep = null;
  for (const t of prep.timers) { try { clearTimeout(t); } catch { /* ignore */ } }
  prep.timers = [];
  releaseProbeMedia(prep);
  const staged = prep.staged;
  prep.staged = null;
  const w = wallpaperById().get(prep.id);
  const valid = selection.rotationEnabled && selection.id === prep.fromId
    && w && isRotationEligible(w, selection.contentRatingFilter)
    && !isHiddenWallpaper(w.id, selection.hiddenIds);
  liveLog("rotation-commit", "wid=" + prep.id + " from=" + prep.fromId + " kind=" + (prep.kind || "-")
    + " valid=" + valid + " " + liveStateBrief());
  if (!valid) {
    if (staged) { try { staged.div.remove(); } catch { /* ignore */ } }
    if (prep.readyEl) disposeMediaEl(prep.readyEl);
    syncRotationTimer();
    return;
  }
  // 就绪元素随提交走，分两条通道：
  // - iframe 类（live 渲染页 / 旧链网页）：staging 容器整体转为新层（节点级
  //   领养）—— 同源 iframe 同文档 reparent 会重载文档，绝不能让 iframe 移动；
  // - img/video：元素级领养，buildMedia 直接收编进新层。
  if ((prep.kind === "live" || prep.kind === "web") && staged && staged.div && prep.readyEl) {
    pendingStagedLayerNode = staged.div;
    prep.readyEl = null; // iframe 留在容器里，不拆散
  } else {
    preparedMediaEl = prep.readyEl || null;
    prep.readyEl = null;
    if (staged) { try { staged.div.remove(); } catch { /* ignore */ } }
  }
  pendingRotationFade = true;
  applySelection(prep.id, { fromRotation: true, kind: prep.kind });
  // 领养保险丝：applySelection 的 emit 未消费节点级领养（理论上不可达 ——
  // 准备期前提与领养条件一致，此处仅兜底）时 staging 容器不能泄漏。
  if (pendingStagedLayerNode) {
    const div = pendingStagedLayerNode;
    pendingStagedLayerNode = null;
    try {
      const f = div.querySelector && div.querySelector("iframe");
      if (f) disposeMediaEl(f);
    } catch { /* ignore */ }
    try { div.remove(); } catch { /* ignore */ }
  }
}
