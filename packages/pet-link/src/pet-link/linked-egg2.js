/**
 * 桌宠联动 · 彩蛋二：站立哈气（linked provider 分区模块）。
 *
 * 时序（与旧版 138KB `petLinkRunInner` 的 egg2 分支 + `petLinkEggHissMotion` 逐段对齐）：
 *   原地弹气泡 → egg2LeadMs 留白 → 哈气（eggHiss，只演 egg2HissMs）
 *     · **全屏抖动**（旧版既有能力，非新增）：egg2ShakeAtMs 起，对 `document.documentElement`
 *       施加 WAAPI `translate` 抖动——6 帧关键帧（±strength、∓strength*.625…）、
 *       0.625 的纵向分量、`iterations:Infinity` + `easing:'linear'`，再按
 *       `currentTime = (播放毫秒 − shakeAt) * egg2ShakeHz` 控频；抖动期间把根的
 *       `overflow-x/overflow-y` 临时设为 `clip`，结束还原；遵从 `prefers-reduced-motion`。
 *     · 侧栏展开：按实际播放进度越过 egg2OpenAtPct 后，用 egg2OpenEase 曲线
 *       （0 匀速 / 1 smoothstep 缓入缓出 / 2 easeOutCubic 缓出）驱动 `syncOpen().seek()`。
 *   → 回收气泡。**默认原地不动**（本体不写 adoptPosition）。
 *
 * @param kit - `createLinkedKit(rt)` 提供的共享骨架。
 * @returns {{ run: (det: object, ctx: { rect: object, home: object, alive: Function }) => Promise<void> }}
 */

/** 展开缓动三选一（对齐旧版：0 匀速 / 1 t²(3−2t) / 2 1−(1−t)³）。 */
function egg2OpenEaseFn(index) {
  const mode = Number.isFinite(index) ? Math.round(index) : 1;
  if (mode === 1) return t => t * t * (3 - 2 * t);
  if (mode === 2) return t => 1 - Math.pow(1 - t, 3);
  return t => t;
}

function createLinkedEgg2Logic(kit) {
  return {
    async run(det, ctx) {
      const { alive } = ctx;
      const logic = 'egg2';

      // ── 参数一次性读取（唯一入口）──────────────────────────────────────
      const leadMs = Math.max(0, kit.tune('egg2LeadMs', logic));
      const hissMs = Math.max(0, kit.tune('egg2HissMs', logic));
      const shakeAtMs = Math.max(0, kit.tune('egg2ShakeAtMs', logic));
      const shakePx = Math.max(0, Math.min(40, kit.tune('egg2ShakePx', logic)));
      const shakeHz = Math.max(0, Math.min(30, kit.tune('egg2ShakeHz', logic)));
      const openAt = Math.max(0, Math.min(1, kit.tune('egg2OpenAtPct', logic) / 100));
      const easeIndex = kit.tune('egg2OpenEase', logic);
      const easeFn = egg2OpenEaseFn(easeIndex);

      kit.showBubble('egg2', det);
      await kit.rt.wait(leadMs);
      if (!alive()) return;

      // ── 全屏抖动（对齐旧版 petLinkEggHissMotion）───────────────────────
      const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const rootEl = typeof document !== 'undefined' ? document.documentElement : null;
      let shake = null;
      const clipped = [];
      const beginShake = () => {
        if (shake || reduced || shakePx <= 0 || shakeHz <= 0 || !rootEl || typeof rootEl.animate !== 'function') return;
        if (rootEl.style) {
          for (const key of ['overflow-x', 'overflow-y']) {
            clipped.push([key, rootEl.style.getPropertyValue(key), rootEl.style.getPropertyPriority(key)]);
            rootEl.style.setProperty(key, 'clip', 'important');
          }
        }
        const y = shakePx * 0.625;
        shake = rootEl.animate([
          { translate: '0px 0px' }, { translate: shakePx + 'px ' + (-y) + 'px' },
          { translate: -shakePx + 'px ' + y + 'px' }, { translate: shakePx * 0.5 + 'px ' + y + 'px' },
          { translate: -shakePx * 0.5 + 'px ' + (-y) + 'px' }, { translate: '0px 0px' },
        ], { duration: 1000, iterations: Infinity, composite: 'add', easing: 'linear' });
        if (shake && typeof shake.pause === 'function') shake.pause();
      };
      const releaseShake = () => {
        if (shake) { try { shake.cancel(); } catch { /* 卸载竞态忽略 */ } shake = null; }
        if (rootEl && rootEl.style) {
          for (const [key, value, priority] of clipped) {
            if (value) rootEl.style.setProperty(key, value, priority); else rootEl.style.removeProperty(key);
          }
        }
        clipped.length = 0;
      };

      // ── 侧栏按播放进度 + 缓动展开（对齐旧版 syncOpen()/seek()）─────────
      let sidebar = null;
      let opened = false;
      const beginSidebar = () => {
        if (sidebar || opened) return;
        sidebar = kit.sidebarCall('syncOpen') || null;
        if (!sidebar) { opened = true; kit.sidebarCall('open', easeIndex); }
      };
      const finishSidebar = () => {
        if (opened) return;
        beginSidebar();
        opened = true;
        if (sidebar) {
          if (typeof sidebar.finish === 'function') sidebar.finish();
          else kit.sidebarCall('open', easeIndex);
        }
      };

      try {
        await kit.playSegment(det, 'eggHiss', (ms, duration) => {
          if (ms >= shakeAtMs) beginShake();
          if (shake) shake.currentTime = Math.max(0, ms - shakeAtMs) * shakeHz;
          if (Number.isFinite(duration) && duration > 0) {
            const progress = Math.max(0, Math.min(1, ms / duration));
            if (progress >= openAt && openAt < 1) {
              beginSidebar();
              if (sidebar) {
                const t = Math.min(0.999, (progress - openAt) / (1 - openAt));
                const eased = Math.min(0.999, easeFn(t));
                if (typeof sidebar.seek === 'function') sidebar.seek(eased);
              }
            }
          }
        }, hissMs > 0 ? hissMs : null, alive);
      } finally {
        releaseShake();
      }
      finishSidebar();
      kit.hideBubble();
    },
  };
}
