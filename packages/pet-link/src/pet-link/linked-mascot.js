/**
 * 桌宠联动 · 逻辑二：抓绳互动（linked provider 分区模块）。
 *
 * ── 真蓝本对照（`_reference/legacy-pet-link-138k.js`，逻辑二「抓绳互动」）──────────
 * 旧版主路径是 `petLinkMascotPlaybackMotion`（有视频回执时）：按 `getPlayback().currentTime`
 * 逐帧求绳子位移 + 逐帧写 pet 偏移；无回执才回落到 `petLinkPullRopeDown`（CSS transition）
 * + `petLinkMascotDrop`（`petLinkGlide`）。本模块按**有回执主路径**对齐：
 *
 *   走位到「手够得到绳」的站位（`petLinkMascotStand`：固定手位锚点 312/640、36/360）
 *   → 跳抓（mascotTumble，只演 mascotTumbleMs）
 *     · 时间线：grabAt = mascotGrabAtMs
 *               releaseAt = max(grabAt + mascotRopePullMs, mascotReleaseAtMs)   ← 蓝本同式（git kit.ropeTimeline）
 *               openAt = mascotOpenAtMs
 *     · 绳子：kit.ropeSegmentAt(ms) —— ms ≥ grabAt 起下拉（mascotRopePullMs + PullEase 缓动）；
 *              ms ≥ releaseAt 起弹回（mascotRopeBackMs + BackEase 缓动）。曲线对齐蓝本 ease(t,kind)。
 *     · 脱手：ms ≥ releaseAt 起，逐帧写页面内位置（新架构 = `link.adoptPosition()`），
 *              **绝对落点** = landingBase.y + mascotDropPx（蓝本同义），缓动 easeInOutQuad、时长 mascotDropMs。
 *     · 侧栏：ms ≥ openAt 直接弹出；默认 openAt == grabAt == 2500（同刻），两键各自可调。
 *   → 气泡。
 *
 * 三条纪律：
 *   ① 绳子位移带缓动（0 匀速 / 1 缓入缓出 / 2 缓出），曲线对齐真蓝本，不写死线性；
 *   ② 脱手下落用 `link.adoptPosition()` 逐帧写页面内位置，**不发逐帧 HTTP**（蓝本写 transform 偏移，等价）；
 *   ③ 抓住（mascotGrabAtMs）与侧栏触发（mascotOpenAtMs）分别消费（蓝本默认同刻）。
 *
 * @param kit - `createLinkedKit(rt)` 提供的共享骨架。
 * @returns {{ run: (det: object, ctx: { rect: object, home: object, alive: Function }) => Promise<void> }}
 */

/**
 * 吉祥物站位的手位锚点（原片像素比例）—— **不是**侧栏的 `handRightRatio`。
 * 蓝本 `petLinkMascotStand`：640×360 原片约 1.3s 双手最高处「中点 x=312、指尖 y=36」，
 * 换算成画布比例即 312/640 与 36/360；侧栏贴边用的是另一套手口径（handRightRatio），二者不可混用。
 */
const MASCOT_HAND_X_RATIO = 312 / 640; // 0.4875

/**
 * 站位换算（逐字对齐蓝本 `petLinkMascotStand`）：
 *   手点 = 画布中心 + size × (ratio − 0.5)
 *   ⇒ 要让手点落在 `anchor`（绳子参考点），画布中心 = anchor − size × (ratio − 0.5)。
 * 用固定手位锚点，绝不复用 `handRightRatio`（那是侧栏的手）。
 * @param {{width:number,height:number}} petRect - 宠物根节点 rect（蓝本里是 `.dsh-pet-stage`/根画布）。
 * @param {{x:number,y:number}} anchor - 绳子参考点（中心 x + 参考 y）。
 * @returns {{x:number,y:number}} 宠物画布中心目标（px）。
 */
function mascotStandTarget(petRect, anchor, alphaBounds, topOffsetPx) {
  // 站点口径**照抄蓝本** `petLinkMascotStand`（L1251-1255）：
  //   原片双手最高处在中点 x=312 / 指尖 y=36（640×360 基准）；
  //   目标 = 当前中心 + (绳子位置 − 手当前绝对位置)，即"平移让指尖对准绳子"。
  //
  // 早先我用的是"头顶贴屏幕顶部"，所以宠物比正确位置**高出半个脑袋**（用户实测）。
  // 视频 640×360 在正方容器里 contain ⇒ 垂直居中，手在容器内的 y 要加上那条留白。
  const videoH = petRect.width * (9 / 16);
  const padY = Math.max(0, (petRect.height - videoH) / 2);
  const handXInBox = petRect.width * (312 / 640);
  const handYInBox = padY + videoH * (36 / 360);
  const curCenterX = petRect.left + petRect.width / 2;
  const curCenterY = petRect.top + petRect.height / 2;
  const handAbsX = petRect.left + handXInBox;
  const handAbsY = petRect.top + handYInBox;
  // 绳子顶部优先（老运行时没有 top 时退回下沿 y）。
  const ropeTop = Number.isFinite(anchor.top) ? anchor.top : anchor.y;
  const offset = Number.isFinite(topOffsetPx) ? topOffsetPx : 0;
  return {
    x: curCenterX + (anchor.x - handAbsX),
    y: curCenterY + (ropeTop - handAbsY) + offset,
  };
}

/**
 * 绳子缓动曲线 —— 逐字对齐真蓝本 `petLinkMascotPlaybackMotion`：
 *   `ease = (t, kind) => kind === 0 ? t : kind === 2 ? 1 - Math.pow(1 - t, 3) : t * t * (3 - 2 * t)`
 * 即 0 匀速 / 1 平滑缓入缓出（smoothstep）/ 2 三次缓出。
 * （无回执回落路径用 CSS `['linear','ease-in-out','cubic-bezier(0.16,1,0.3,1)']`，语义一致。）
 * @param {number} index - 缓动索引 0/1/2；非数值按 1（缓入缓出）兜底。
 * @returns {(t: number) => number} 把 0..1 映射到 0..1 的缓动函数。
 */
function mascotRopeEase(index) {
  const mode = Number.isFinite(index) ? Math.round(index) : 1;
  if (mode === 0) return t => t;                              // 匀速
  if (mode === 2) return t => 1 - (1 - t) ** 3;               // 缓出（三次）
  return t => t * t * (3 - 2 * t);                            // 缓入缓出（smoothstep）
}

function createLinkedMascotLogic(kit) {
  return {
    async run(det, ctx) {
      const { rect, alive } = ctx;
      const logic = 'mascot';

      // ── 参数一次性读取：**唯一**入口 kit.tune('<key>', 'mascot') ──────────
      const walkRaw = Math.max(0, kit.tune('mascotWalkMs', logic));
      const tumbleMs = Math.max(0, kit.tune('mascotTumbleMs', logic));
      const openAtMs = Math.max(0, kit.tune('mascotOpenAtMs', logic));
      const grabAtMs = Math.max(0, kit.tune('mascotGrabAtMs', logic));
      const ropeDownPx = Math.max(0, kit.tune('mascotRopeDownPx', logic));
      const pullMs = Math.max(1, kit.tune('mascotRopePullMs', logic));
      const backMs = Math.max(1, kit.tune('mascotRopeBackMs', logic));
      const pullEase = mascotRopeEase(kit.tune('mascotRopePullEase', logic));
      const backEase = mascotRopeEase(kit.tune('mascotRopeBackEase', logic));
      const releaseTune = Math.max(0, kit.tune('mascotReleaseAtMs', logic));
      const dropPx = Math.max(0, kit.tune('mascotDropPx', logic));
      const dropMs = Math.max(0, kit.tune('mascotDropMs', logic));

      // 绳子时间线（共享层规范实现）：releaseAt = max(grab+pull, tune)，绝不提前回弹。
      const timeline = kit.ropeTimeline({
        grabAtMs, releaseAtMs: releaseTune, pullMs, backMs, dropMs, dropPx, openAtMs,
      });
      const releaseAtMs = timeline.releaseAtMs;
      const ropeAt = ms => kit.ropeSegmentAt(ms, {
        grabAtMs, releaseAtMs: releaseTune, pullMs, backMs, downPx: ropeDownPx, pullEase, backEase,
      });

      // ① 走位：按蓝本手位锚点把「手」对准绳子参考点（无绳子则原地，对齐蓝本 mascotStop=null）。
      const here = kit.centerOf(rect);
      const ropePx = kit.ropeTarget();
      const view = kit.rt.viewport();
      const walkMs = walkRaw > 0 ? walkRaw : (PETLINK_HOLD.walkLeft || 5167);
      if (ropePx) {
        await kit.walkTo(det, mascotStandTarget(rect, ropePx, kit.rt.state && kit.rt.state.alphaBounds, kit.tune('mascotTopOffsetPx', logic)), walkMs, alive);
        await kit.gap(logic);
        if (!alive()) return;
      }

      // 下落绝对落点：蓝本 mascotLanding = {x:绳中心, y:min(H−60, 绳下沿+120)}，target = landingBase.y + dropPx。
      // ropeTarget().y 是绳元素下沿（client.js 的 rope.point 取 box.bottom），故 landingBase.y 可直接算。
      const landingBase = ropePx
        ? { x: ropePx.x, y: Math.min((view.height || 0) - 60, ropePx.y + 120) }
        : null;
      const dropTarget = landingBase
        ? { x: landingBase.x, y: landingBase.y + dropPx }
        : { x: here.x, y: here.y + dropPx };

      const moveRope = px => {
        if (kit.rt.rope && typeof kit.rt.rope.moveRope === 'function') kit.rt.rope.moveRope(px);
      };

      let opened = false;
      let released = false;
      let dropFrom = null;
      let dropStart = 0;
      let dropComplete = false;

      /**
       * 脱手下落：到点后逐帧 `adoptPosition` 写页面内位置，零请求。
       * 从脱手瞬间中心沿 easeInOutQuad 滑到**绝对落点** dropTarget（= landingBase.y + dropPx）。
       */
      const applyDrop = () => {
        if (!released || dropPx <= 0 || dropComplete) return;
        const t = dropMs <= 0 ? 1 : Math.min(1, (kit.rt.now() - dropStart) / dropMs);
        const k = petLinkEaseInOutQuad(t);
        try {
          det.link.adoptPosition({
            x: dropFrom.x + (dropTarget.x - dropFrom.x) * k,
            y: dropFrom.y + (dropTarget.y - dropFrom.y) * k,
          }, det.target);
        } catch { /* 卸载竞态由 alive 收尾 */ }
        if (t >= 1) dropComplete = true;
      };

      // ② 跳抓段：只演 mascotTumbleMs；段内按 clip 时间触发各时刻。
      let lastMs = 0;
      await kit.playSegment(det, 'mascotTumble', ms => {
        lastMs = ms;
        // 侧栏触发（mascotOpenAtMs）——与抓住时刻分别消费（默认同刻）。
        if (!opened && ms >= openAtMs) {
          opened = true;
          kit.sidebarCall('open');
        }
        // 脱手（releaseAt = max(grab+pull, mascotReleaseAtMs)）——记下落起点与时长。
        if (!released && ms >= releaseAtMs) {
          released = true;
          const live = kit.rectOf(det) || rect;
          dropFrom = kit.centerOf(live);
          dropStart = kit.rt.now();
        }
        // 绳子按当前 clip 时间求值（抓住=开始下拉，脱手=开始弹回）。
        moveRope(ropeAt(ms));
        applyDrop();
      }, tumbleMs > 0 ? tumbleMs : null, alive);

      if (!opened) kit.sidebarCall('open');

      // ③ 段结束后把「已脱手」的绳子弹回 / pet 下落补完（若段时长把它们截断）。
      if (released) {
        const endWall = kit.rt.now();
        while (alive()) {
          const clipMs = lastMs + (kit.rt.now() - endWall);
          moveRope(ropeAt(clipMs));
          applyDrop();
          const ropeDone = clipMs >= releaseAtMs + backMs;
          const dropDone = dropPx <= 0 || dropMs <= 0 || (kit.rt.now() - dropStart) >= dropMs;
          if (ropeDone && dropDone) break;
          await kit.rt.wait(PETLINK_MOVE_STEP_MS);
        }
        applyDrop();
      }
      moveRope(0);

      kit.showBubble('mascot', det);
    },
  };
}
