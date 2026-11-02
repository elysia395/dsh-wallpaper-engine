/**
 * 桌宠联动 · 逻辑一：拉动侧边栏（linked provider 分区模块）。
 *
 * 时序（对照旧版 `petLinkRun` 的 sidebar 分支）：
 *   走位（sidebarWalkMs）→ 预备（braceMs）→ 后拉（pullMs）＋侧栏慢展开（slowOpenMs）
 *   → 逐帧贴边跟随（followSpeed / followGraceMs / followStillMs / followStillEps）
 *   → 提交（commit）→ 气泡。
 *
 * 贴边口径 = **手右边缘**贴住侧栏左边缘：`edgeTarget` / `followEdge` 都用根节点真 rect
 * 现量 + `handRightRatio` 比例常量换算，写 `adoptPosition`，绝不退化成归一化坐标。
 *
 * @param kit - `createLinkedKit(rt)` 提供的共享骨架。
 * @returns {{ run: (det: object, ctx: { home: object, alive: Function }) => Promise<void> }}
 */
function createLinkedSidebarLogic(kit) {
  return {
    async run(det, ctx) {
      const { alive } = ctx;
      const logic = 'sidebar';

      // ① 走位到贴边目标：时长吃 sidebarWalkMs。
      //    ⚠️ 必须与 `followEdge` **同一口径（手）**：两处若用不同比例，目标会差
      //    `size×(bodyRightRatio−handRightRatio) ≈ 54px`，切段时位置往后跳一截
      //    （用户："切换下一个动作会往后一段距离，要求切换动作位置不准变"）。
      //    "贴右但不埋"改由 `edgeGapPx` 保证：手口径下
      //    身体右边缘 = edge − gap + size×(body−hand)，gap=56 时正好落在窗口内 2px。
      await kit.walkTo(det, kit.edgeTarget(det, logic), kit.tune('sidebarWalkMs', logic), alive);
      await kit.gap(logic);
      if (!alive()) return;

      // ② 预备段：只演 braceMs（不必等完整准备素材）。
      const braceMs = Math.max(0, kit.tune('braceMs', logic));
      await kit.playSegment(det, 'brace', null, braceMs, alive);
      await kit.gap(logic);
      if (!alive()) return;

      // ③ 后拉段：侧栏随后拉开，并从那一刻起逐帧贴边跟随。
      //    openLeadMs 是「提前量」（旧蓝本 PET_OPEN_LEAD_MS）：展开起手点相对**后拉起点**
      //    提前 openLead —— 推导：old 在 brace 尾段（braceMs−openLead）起手 + openDelay，
      //    换算到后拉起点即 `openDelay − openLead`。展开时长同步加 openLead，保证结束时点不变。
      const openLead = Math.max(0, Math.min(kit.tune('openLeadMs', logic), braceMs));
      const openDelay = Math.max(0, kit.tune('openDelayMs', logic));
      const slowOpenMs = Math.max(0, kit.tune('slowOpenMs', logic));
      const pullMs = Math.max(0, kit.tune('pullMs', logic));
      const openDurMs = slowOpenMs + openLead;
      const openAtMs = Math.max(0, openDelay - openLead);

      // 共享给 followEdge 判 openSettled：展开起手后需再等 openDurMs 才算"展开结束"。
      const openState = { opened: false, at: 0, ms: openDurMs };
      let opened = false;
      const openIt = async () => {
        if (opened) return;
        opened = true;
        openState.opened = true;
        openState.at = kit.rt.now();
        // ⚠️ 布局补偿：`beginPull` 会让侧栏列宽开始占位，而宠物是 `inset` 定位
        // （贴容器右缘）——容器一变宽，它的**视口坐标瞬间平移**一段，紧接着
        // `followEdge` 才按 followSpeed 追上去。用户看到的就是"准备拉的时候位置被替换一次"。
        // 这里记下开门前的真实中心，开门后立刻写回，把这次位移抵消掉；
        // 之后的位置变化照常交给 followEdge 平滑跟随。
        const rectBefore = kit.rectOf(det);
        const centerBefore = rectBefore ? kit.centerOf(rectBefore) : null;
        kit.sidebarCall('beginPull', openDurMs);
        kit.sidebarCall('open');
        const rectAfter = kit.rectOf(det);
        const centerAfter = rectAfter ? kit.centerOf(rectAfter) : null;
        // 时序探针：开门前后各一次真实中心 —— 差值就是布局造成的位移量。
        try {
          kit.rt.reportDiag?.({
            kind: 'open-it',
            before: centerBefore ? { x: Math.round(centerBefore.x), y: Math.round(centerBefore.y) } : null,
            after: centerAfter ? { x: Math.round(centerAfter.x), y: Math.round(centerAfter.y) } : null,
            shiftedX: centerBefore && centerAfter ? Math.round(centerAfter.x - centerBefore.x) : null,
            openDurMs,
          });
        } catch { /* 诊断不许影响业务 */ }
        if (centerBefore) {
          try { det.link.adoptPosition({ x: centerBefore.x, y: centerBefore.y }, det.target); } catch { /* 卸载竞态 */ }
        }
      };

      // 起手由**墙钟**驱动（后拉起点 + openAtMs），不依赖后拉素材时长——避免短素材下
      // 展开永远等不到 followEdge 的 openSettled 而死锁；生产里与 clip 触发等价。
      const openP = (async () => {
        if (openAtMs > 0 && kit.rt.wait) await kit.rt.wait(openAtMs);
        await openIt();
      })();
      const followP = kit.followEdge(det, alive, logic, {
        // 旧版口径：slowOpenMs + openLead + openDelay + 2500（**不含** pullMs）。
        maxMs: slowOpenMs + openLead + openDelay + 2500,
        openState,
      });
      const pullP = kit.playSegment(det, 'pull', async ms => {
        if (!opened && ms >= openAtMs) await openIt();
      }, pullMs, alive);
      await Promise.allSettled([pullP, openP, followP]);
      if (!opened) await openIt();

      // ④ 收尾：提交展开 + 自绘气泡（停留由编排层统一处理）。
      kit.sidebarCall('commit');
      kit.showBubble('sidebar', det);
    },
  };
}
