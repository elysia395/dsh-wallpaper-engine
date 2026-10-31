/**
 * 桌宠联动 · 彩蛋一：踢开并弹飞（linked provider 分区模块）。
 *
 * 时序（对照旧版 `petLinkRunInner` 的 egg1 分支 + `petLinkEggRebound` L1422-1468）：
 *   走位到「踢腿位」（egg1WalkMs；与侧栏间距吃 egg1EdgeGapPx；锚点用蓝本 425/640）→ 愤怒气泡
 *   → egg1LeadMs 留白 → 踢腿（eggKick，只演 egg1KickMs）→ 回收气泡 → 120ms 段间留白
 *   → 被弹飞（eggFlung，只演 egg1FlungMs）＋**三阶段回弹**（并发驱动）：
 *       弹飞启动延迟(egg1FlingStartDelayMs) → 侧栏展开 240ms → 等边沿接触（370/640 锚点）
 *       → 起飞 throwNative → 收起 180ms → 等回位 → 再展开 300ms → 等 300ms
 *   → 等落定 → 落地气泡 → 落地（eggLand，只演 egg1LandMs）→ 回收气泡
 *   → 弹出侧栏 → egg1PostLandMs 停留。
 *
 * 参数读取唯一入口：`kit.tune('<key>', 'egg1')`。
 *
 * @param kit - `createLinkedKit(rt)` 提供的共享骨架。
 * @returns {{ run: (det: object, ctx: { home: object, alive: Function }) => Promise<void> }}
 */
function createLinkedEgg1Logic(kit) {
  return {
    async run(det, ctx) {
      const { alive } = ctx;
      const logic = 'egg1';

      // ── 参数一次性读取（唯一入口）──────────────────────────────────────
      const edgeGapPx = Math.max(0, kit.tune('egg1EdgeGapPx', logic));
      const walkRaw = Math.max(0, kit.tune('egg1WalkMs', logic));
      const walkMs = walkRaw > 0 ? walkRaw : kit.tune('sidebarWalkMs', logic); // 0 = 自动
      const leadMs = Math.max(0, kit.tune('egg1LeadMs', logic));
      const kickMs = Math.max(0, kit.tune('egg1KickMs', logic));
      const flungMs = Math.max(0, kit.tune('egg1FlungMs', logic));
      const landMs = Math.max(0, kit.tune('egg1LandMs', logic));
      const postLandMs = Math.max(0, kit.tune('egg1PostLandMs', logic));
      const flingDelayMs = Math.max(0, kit.tune('egg1FlingStartDelayMs', logic)); // 蓝本「弹飞启动延迟」

      // ── 回弹三阶段（对齐旧版 petLinkEggRebound）───────────────────────
      // 边沿读数可用时按「边沿 ≤ 接触锚点(370/640)+1」驱动起飞；读数缺失/久未接触则按阶段时长兜底，
      // 绝不空转（旧版遇不到接触会直接 return false，这里改为兜底继续，保证流程完整）。
      const edgeNow = () => {
        try { const v = kit.sidebarCall('edgeX'); return Number.isFinite(v) ? v : null; } catch { return null; }
      };
      const move = (open, ms) => kit.sidebarCall('rebound', open, ms);
      const waitFor = async (predicate, budgetMs) => {
        const t0 = kit.rt.now();
        while (alive() && kit.rt.now() - t0 < budgetMs) {
          let ok = false;
          try { ok = predicate() === true; } catch { ok = false; }
          if (ok) return true;
          await kit.rt.wait(20);
        }
        return false;
      };
      const rebound = async () => {
        await kit.rt.wait(flingDelayMs);
        if (!alive()) return false;
        const rect0 = kit.rectOf(det);
        const initialEdge = edgeNow();
        const contact = rect0 ? rect0.left + rect0.width * (370 / 640) : null; // 接触锚点=躯干 370/640（非踢腿 425/640）
        const hasEdge = Number.isFinite(initialEdge) && Number.isFinite(contact);
        let flight = null;
        let throwId = null;
        try {
          move(true, 240);
          let hit = false;
          if (hasEdge) hit = await waitFor(() => { const e = edgeNow(); return Number.isFinite(e) && e <= contact + 1; }, 1200);
          else await kit.rt.wait(240);
          if (!alive()) return false;
          // 起飞：接触到躯干（或读不到边沿的兜底）后当帧抛掷；随后收起再完整展开。
          throwId = kit.startThrow(det, kit.rectOf(det));
          flight = throwId !== null ? kit.settleThrow(det, throwId, alive) : Promise.resolve(false);
          move(false, 180);
          if (hasEdge) await waitFor(() => { const e = edgeNow(); return Number.isFinite(e) && e >= initialEdge - 1; }, 1200);
          else await kit.rt.wait(180);
          if (!alive()) return false;
          move(true, 300);
          await kit.rt.wait(300);
          return await flight;
        } finally {
          kit.sidebarCall('commit');
          if (flight) { try { await flight; } catch { /* 收尾忽略 */ } }
        }
      };

      // ① 走到「踢腿位」：间距吃专属 egg1EdgeGapPx；锚点用蓝本脚接触点 425/640（≈0.664），
      //    而不是逻辑一的 handRightRatio —— 踢腿的接触点是脚尖，不是手。
      await kit.walkTo(det, kit.edgeTarget(det, logic, edgeGapPx, 425 / 640), walkMs, alive);
      await kit.gap(logic);
      if (!alive()) return;

      // ② 愤怒气泡 → 踢腿前留白。
      kit.showBubble('egg1Angry', det);
      await kit.rt.wait(leadMs);
      if (!alive()) return;

      // ③ 踢腿：**自然播完**（不再按 egg1KickMs 强制截断——那会让动作演到一半突然切走，
      //    用户反馈"动画播放会意外终止"）。该参数仍保留在面板，作为"最短等待"不生效也无害。
      await kit.playSegment(det, 'eggKick', null, null, alive);
      kit.hideBubble();
      if (!alive()) return;

      // ③' 段间留白（旧版 plan 的 `eggPause` = 120ms，踢腿与弹飞之间）。
      await kit.rt.wait(120);
      if (!alive()) return;

      // ④ 被弹飞：段一开播就并发驱动三阶段回弹（延迟→展开→接触→起飞→收起→回位→再展开）。
      let reboundP = null;
      await kit.playSegment(det, 'eggFlung', () => {
        if (reboundP === null) reboundP = rebound();
      }, null, alive);
      if (reboundP !== null) await reboundP;
      if (!alive()) return;

      // ⑤ 落地：气泡 + 只演 egg1LandMs → 展开侧栏 → 停留 egg1PostLandMs。
      kit.showBubble('egg1Land', det);
      await kit.playSegment(det, 'eggLand', null, null, alive);
      kit.hideBubble();
      kit.sidebarCall('open');
      await kit.rt.wait(postLandMs);
    },
  };
}
