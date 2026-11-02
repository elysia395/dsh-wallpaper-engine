/**
 * 桌宠联动 · linked provider 编排层：用 `petApiDshwe.link` 直控复刻旧版四条排播。
 *
 * 本文件只做**状态机 + 分区调度**，具体时序已拆到四个分区模块 + 共享骨架：
 *   · `linked-shared.js`    —— tune 取值 / 租约 / 段播放 / 走路 / 贴边跟随 / 抛掷 / 气泡（能力层）；
 *   · `linked-sidebar.js`   —— 逻辑一：拉动侧边栏（走位 → 预备 → 后拉+展开+逐帧贴边）；
 *   · `linked-mascot.js`    —— 逻辑二：抓绳互动；
 *   · `linked-egg1.js`      —— 彩蛋一：踢开并弹飞；
 *   · `linked-egg2.js`      —— 彩蛋二：站立哈气。
 *
 * 运行时契约同旧版实现：`run()` 永不抛、Promise 恒 resolve；任何失败返回
 * `{phase:'cancelled', reason}`。与 M2 的 sleep/wake 竞争由共享骨架的 `ensureAwake` 处理。
 *
 * 参数读取统一走 `kit.tune('<key>', logic)`（判据只认 `tune('<key>')`）。
 */

/**
 * 造 linked provider。
 * @param rt - 注入运行时，见模块头与 `createPetLink` 的装配。
 * @returns 四条排播 + 手势 + 快照。
 */
function createLinkedPetProvider(rt) {
  const state = rt.state;
  const kit = createLinkedKit(rt);
  const sidebarLogic = createLinkedSidebarLogic(kit);
  const mascotLogic = createLinkedMascotLogic(kit);
  const egg1Logic = createLinkedEgg1Logic(kit);
  const egg2Logic = createLinkedEgg2Logic(kit);

  /** 跑一条逻辑（或手势段）。永不抛。 */
  const run = async (logic, gesture = false) => {
    if (state.busy) return { logic: 'busy', busy: true };
    if (!gesture && !PETLINK_TUNER_LOGICS.includes(logic)) return { logic: 'invalid', busy: false };
    const det = rt.detect();
    state.mode = det.mode;
    state.reason = det.reason;
    if (det.mode !== 'linked') {
      let handled = false;
      try { handled = rt.fallback() === true; } catch { handled = false; }
      return { logic: 'disabled', phase: 'done', busy: false, fallback: handled, reason: det.reason };
    }
    state.busy = true;
    const epoch = (state.epoch += 1);
    const alive = () => epoch === state.epoch && !state.disposed;
    try {
      if (!kit.acquireLease(det)) throw new Error('lock-failed');
      await kit.ensureAwake(det); // 内部会重取锁；失败则抛
      const rect = kit.rectOf(det);
      if (!rect) throw new Error('pose-unavailable');
      const home = kit.centerOf(rect);
      state.home = home;
      state.logic = logic;

      if (gesture) {
        if (logic === 'grab') await kit.playSegment(det, 'brace', null, kit.tune('braceMs'), alive);
        else await kit.playSegment(det, 'pull', null, null, alive);
        state.phase = 'done';
        return { logic, phase: 'done', busy: false };
      }

      // 气泡时间节点时间线：为本次逻辑开启（bubbleTiming 面板节点真消费；旧蓝本
      // petLinkCreateBubbleTimeline 等价物）。逻辑内部的 showBubble/hideBubble 会降级为
      // 「defaultShow/defaultHide」语义，自定义节点由时间线在段推进中按规则触发。
      kit.beginBubbles(logic, det, alive);

      if (logic === 'sidebar') {
        await sidebarLogic.run(det, { rect, home, alive });
      } else if (logic === 'mascot') {
        await mascotLogic.run(det, { rect, home, alive });
      } else if (logic === 'egg1') {
        await egg1Logic.run(det, { rect, home, alive });
      } else {
        await egg2Logic.run(det, { rect, home, alive });
      }

      // 停留：侧栏/吉祥物逻辑等侧栏被用户关掉或到上限（原地不动）。
      // 用户要求（热锁时序）：这一段「等侧边栏关闭」的等待期**放开独占锁**——此时宠物不该被我们
      // 独占，用户可以自由拖它、点它；放开后 `renewLease()` 因 kit 内部 lease 已被清空而不再续期，
      // 不会把锁悄悄续回来（见 linked-shared.js 的 renewLease 守卫）。
      let releasedForWait = false;
      if (logic === 'sidebar' || logic === 'mascot') {
        state.phase = 'waiting';
        kit.releaseLease(det);
        releasedForWait = true;
        const deadline = rt.now() + kit.tune('holdMaxMs');
        while (alive() && kit.sidebarCall('isOpen') === true && rt.now() < deadline) {
          kit.pumpBubbles(); // 停留等待也要评估气泡时间节点（duration/偏移不能丢拍）
          await rt.wait(100);
        }
      }
      // 回原位：带走路动作走回去（彩蛋二原地不动）。
      // 回程开始前**重新持锁**：回程的走位/动作同样不能被其它动作导入打断。
      // 只有「等关闭」阶段真的放开过锁（sidebar/mascot）才需要重取；egg1 等无等待段全程持锁，
      // 不重复 lock()（重复 lock 会以 preserveBubble=false 重入，可能清掉已展示的气泡）。
      // 旧蓝本 egg1 回程固定 600ms（petLinkEggReturnHome(600,…) L2303），其余逻辑用 sidebarWalkMs。
      if (alive() && logic !== 'egg2') {
        if (releasedForWait && !kit.acquireLease(det)) throw new Error('lock-failed');
        await kit.returnHome(det, home, alive, logic === 'egg1' ? 600 : undefined);
      }
      state.phase = 'done';
      return { logic, phase: 'done', busy: false };
    } catch (error) {
      if (epoch === state.epoch) {
        state.phase = 'cancelled';
        state.reason = error && error.message ? error.message : 'run-failed';
      }
      return { logic, phase: 'cancelled', busy: false, reason: error && error.message ? error.message : 'run-failed' };
    } finally {
      if (epoch === state.epoch) {
        kit.endBubbles();
        kit.hideBubble();
        if (rt.rope && typeof rt.rope.restoreRope === 'function') rt.rope.restoreRope();
        // 结束/取消一律完全释放：releaseLease 幂等（lease 已空时 unlock 也是安全 no-op），
        // 不依赖 leased 标记，保证任何异常路径都不会把锁留在外面。
        kit.releaseLease(det);
        state.busy = false;
      }
    }
  };

  /** 点吉祥物：选路 + 计数 + 第 N 次改走彩蛋。 */
  const tap = async () => {
    if (state.busy) return { logic: 'busy', busy: true };
    const det = rt.detect();
    state.mode = det.mode;
    state.reason = det.reason;
    if (det.mode !== 'linked') {
      let handled = false;
      try { handled = rt.fallback() === true; } catch { handled = false; }
      return { logic: 'disabled', phase: 'done', busy: false, fallback: handled, reason: det.reason };
    }
    const rect = kit.rectOf(det);
    const view = rt.viewport();
    const ropePx = kit.ropeTarget();
    const edge = kit.sidebarCall('edgeX');
    const petX = rect ? kit.centerOf(rect).x : view.width / 2;
    const logic = petLinkDecideLogic(petX, ropePx ? ropePx.x : NaN, Number.isFinite(edge) ? edge : view.width, view.width);
    const key = logic === 'sidebar' ? 'farCount' : 'nearCount';
    state[key] += 1;
    if (state[key] >= kit.tune('eggAt', logic)) {
      state[key] = 0;
      return run(logic === 'sidebar' ? 'egg1' : 'egg2');
    }
    return run(logic);
  };

  const snapshot = () => ({
    available: state.mode === 'linked',
    reason: state.reason,
    mode: state.mode,
    busy: state.busy,
    phase: state.phase,
    logic: state.logic,
    target: state.target,
    farCount: state.farCount,
    nearCount: state.nearCount,
    home: state.home,
  });

  return {
    run,
    tap,
    snapshot,
    cancel,
    getState: () => ({
      busy: state.busy, phase: state.phase, logic: state.logic,
      farCount: state.farCount, nearCount: state.nearCount, target: state.target,
    }),
    registerSidebar(api) {
      if (!api && state.busy) cancel();
      state.sidebar = api || null;
    },
    registerGesture(fn) {
      state.cancelGesture = typeof fn === 'function' ? fn : null;
      return () => { if (state.cancelGesture === fn) state.cancelGesture = null; };
    },
    reset() { state.farCount = 0; state.nearCount = 0; },
    performer: {
      onGrab() { return run('grab', true).then(value => value.phase === 'done'); },
      onPull(progress) {
        return Number.isFinite(progress) && progress >= 0.12 ? run('pull', true).then(value => value.phase === 'done') : Promise.resolve(false);
      },
      onRelease() { return Promise.resolve(false); },
      snapshot,
    },
  };

  /** 取消一次在跑的流程：递增 epoch 让 alive() 立即为假，run 的 finally 负责解锁与清场。 */
  function cancel() {
    state.epoch += 1;
    state.busy = false;
    state.phase = 'cancelled';
    kit.endBubbles();
    if (rt.bubble) rt.bubble.hide();
    if (rt.rope && typeof rt.rope.restoreRope === 'function') rt.rope.restoreRope();
    if (typeof state.cancelGesture === 'function') { try { state.cancelGesture(); } catch { /* 忽略 */ } }
  }
}
