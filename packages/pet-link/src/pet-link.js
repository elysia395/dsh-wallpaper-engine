/**
 * 桌宠联动（浏览器半）装配层 · 双 provider。
 *
 * 这一层只做「接线 + 状态机路由」：
 *   · `petLinkMode()` 判定 linked / native（判定在 `pet-link/mode.js`）；
 *   · linked → `createLinkedPetProvider`（四条排播直控 `petApiDshwe.link`）；
 *   · native → `createNativePetProvider`（回落主包原生吉祥物）。
 *
 * 对外形状与主包 `src/client.js` 的 `petLink` 门面（mascot.tap / registerGesture /
 * registerSidebar / performer.onGrab / performer.onPull / warmup / dispose）逐字对齐，
 * 主包吉祥物代码零改动。运行期依赖全部注入，夹具可脱浏览器单测。
 *
 * @param {object} options - 全部可注入的运行时依赖。
 * @returns 与主包门面对齐的联动服务（另含 tuner 编程面与 detect 诊断面）。
 */
function createPetLink(options = {}) {
  const now = options.now
    || (() => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()));
  const later = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clear = options.clearTimeout || (id => clearTimeout(id));
  const wait = options.wait || (ms => new Promise(resolve => later(resolve, ms)));
  const viewport = options.viewport || (() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const translate = options.translate || (value => value);
  const storage = options.storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : options.storage;
  const getApi = options.getApi || (() => null);
  const fallback = options.fallback || (() => false);
  const playAnim = options.playAnim || (async () => false);
  const wake = options.wake || (async () => false);
  const rope = options.rope || { point: () => null, moveRope() {}, restoreRope() {} };
  const bubbleUrl = options.bubbleUrl || (index => 'm' + index + '.png');

  const TARGET_KEY = 'dsh-pet-link-target';
  const initialTarget = (() => {
    try {
      if (typeof options.targetId === 'function') {
        const value = String(options.targetId() ?? '').trim();
        if (value) return value;
      }
      const stored = storage ? storage.getItem(TARGET_KEY) : null;
      if (stored && String(stored).trim()) return String(stored).trim();
    } catch { /* 私密模式仍可用 */ }
    return 'main';
  })();

  /** 共享状态：两只 provider 与 tuner 都读写这一份。 */
  const state = {
    target: initialTarget,
    busy: false,
    phase: 'idle',
    logic: '',
    home: null,
    farCount: 0,
    nearCount: 0,
    tuning: {},
    bubbleTiming: {},
    sidebar: null,
    cancelGesture: null,
    epoch: 0,
    disposed: false,
    mode: 'native',
    reason: '',
    pool: null,
  };

  const bubble = createPetLinkBubble({
    document: doc,
    viewport,
    bubbleUrl,
    requestAnimationFrame: options.requestAnimationFrame,
    cancelAnimationFrame: options.cancelAnimationFrame,
    setTimeout: later,
    clearTimeout: clear,
  });

  const rt = {
    now,
    wait,
    viewport,
    translate,
    state,
    getApi,
    playAnim,
    wake,
    rope,
    fallback,
    bubble,
    getState: () => {
      try {
        const api = getApi();
        return api && typeof api.getState === 'function' ? api.getState() : null;
      } catch { return null; }
    },
    /** 让宠物自己说话（`POST /broadcast`）：气泡由运行时渲染，样式与位置才是"原版"。 */
    say: options.say || (async () => false),
    /**
     * 桌面端写位：`surface === 'desktop'` 时，页面内 `adoptPosition` 控不到独立桌面窗口里的那只，
     * 位置必须走宿主 HTTP `POST /position?surface=desktop`（实现见 packages/pet-link/src/client.js）。
     */
    positionDesktop: options.positionDesktop || (() => {}),
    /** 诊断上报（浏览器 → 宿主日志）：桌面版没有 DevTools，运行期真值必须走这条。 */
    reportDiag: options.reportDiag || (() => {}),
    detect: () => {
      const detected = detectPetLinkProvider({
        isEnabled: options.isEnabled || (() => true),
        getApi,
        targetId: () => state.target,
      });
      state.mode = detected.mode;
      state.reason = detected.reason;
      return detected;
    },
  };

  const linked = createLinkedPetProvider(rt);
  const native = createNativePetProvider(rt);
  /** 按当刻判定路由到 provider；判定本身已在各 provider 内重做（幂等）。 */
  const active = () => (rt.detect().mode === 'linked' ? linked : native);

  /** 编程调参面（浮层面板属 M6；这一层只给面板/诊断用的读写口）。 */
  const tuner = {
    run: logic => active().run(logic),
    cancel() {
      state.epoch += 1;
      state.busy = false;
      state.phase = 'cancelled';
      if (typeof linked.cancel === 'function') linked.cancel();
    },
    snapshot: () => {
      const base = active().snapshot();
      return { ...base, defaults: { ...PETLINK_DEFAULTS }, logicTuning: clone(state.tuning), bubbleTiming: clone(state.bubbleTiming),
        // 运行时实测的素材可视边界（null = 尚未测到）：面板据此显示"真实数据"。
        alphaBounds: state.alphaBounds || null };
    },
    setTarget(id) {
      if (typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 128 || /[\u0000-\u001f]/.test(id)) return false;
      if (typeof linked.cancel === 'function') linked.cancel();
      state.target = id;
      state.mode = 'native';
      state.reason = 'target-changed';
      try { if (storage) storage.setItem(TARGET_KEY, id); } catch { /* 当前页选择仍生效 */ }
      return true;
    },
    setForLogic(logic, key, value) {
      if (!PETLINK_TUNER_LOGICS.includes(logic) || !(key in PETLINK_DEFAULTS)) return false;
      // 间距类参数允许负值：`edgeGapPx` 的默认值本来就是 **-15**（把宠物的手往侧栏里压一点），
      // `egg1EdgeGapPx` 同理。早先统一用 `value < 0` 拒绝，等于这两个键永远改不出负值
      // （面板里一填就被清空，用户反馈"没办法改负数"）。
      const allowsNegative = key === 'edgeGapPx' || key === 'egg1EdgeGapPx';
      const lowerBound = allowsNegative ? -1000 : 0;
      if (!Number.isFinite(value) || value < lowerBound || value > 180000) return false;
      if (key === 'egg1FlingPower' && (value <= 0 || value > 10)) return false;
      if (key === 'egg2OpenAtPct' && value > 100) return false;
      if (key === 'eggAt' && (!Number.isInteger(value) || value < 1)) return false;
      state.tuning[logic] = state.tuning[logic] || {};
      state.tuning[logic][key] = value;
      return true;
    },
    setBubbleTiming(id, config) {
      if (!PETLINK_BUBBLE_SPECS.some(item => item.id === id) || !config || typeof config !== 'object') return false;
      for (const edge of ['show', 'hide']) {
        const rule = config[edge];
        if (!rule) continue;
        // 允许的动作：任一素材段键（PETLINK_ANIM）、'default'（保持默认）、'duration'（按显示时长，仅 hide 面板提供）。
        // 旧校验只认 PETLINK_ANIM 键，会把面板的「按显示时长(duration)」拒之门外 ⇒ 可编辑却存不进。
        const actionOk = (rule.action in PETLINK_ANIM) || rule.action === 'default' || rule.action === 'duration';
        // offsetMs 上限与蓝本 PET_TUNE_DEFAULTS 一致（600000）；T12 的 timeOf 已能处理大偏移。
        if (!actionOk || !['start', 'end'].includes(rule.edge) || !Number.isFinite(rule.offsetMs) || Math.abs(rule.offsetMs) > 600000) return false;
      }
      state.bubbleTiming[id] = clone(config);
      return true;
    },
    reset(logic) {
      if (logic) {
        delete state.tuning[logic];
        for (const spec of PETLINK_BUBBLE_SPECS.filter(item => item.logic === logic)) delete state.bubbleTiming[spec.id];
      } else {
        state.tuning = {};
        state.bubbleTiming = {};
      }
      return tuner.snapshot();
    },
  };

  return {
    /** 双 provider 状态机：'linked' | 'native'（会刷新 state.mode / state.reason）。 */
    mode: () => rt.detect().mode,
    /** 最近一次判定的降级原因（linked 可用时为空串）。 */
    reason: () => state.reason,
    /** 诊断面：完整判定结果（含 link / target）。 */
    detect: () => rt.detect(),
    warmup: async () => rt.detect().mode === 'linked',
    tap: () => active().tap(),
    mascot: {
      tap: () => active().tap(),
      registerGesture: fn => linked.registerGesture(fn),
      registerSidebar: api => {
        state.sidebar = api || null;
        linked.registerSidebar(api);
      },
      reset: () => { state.farCount = 0; state.nearCount = 0; },
      snapshot: () => active().snapshot(),
    },
    performer: {
      onGrab: () => linked.performer.onGrab(),
      onPull: ratio => linked.performer.onPull(ratio),
      onRelease: () => linked.performer.onRelease(),
      snapshot: () => active().snapshot(),
    },
    tuner,
    /** 诊断上报出口：面板写值被拒 / 让宠物说话失败等，统一走宿主日志（桌面版无 DevTools）。 */
    reportDiag: payload => { try { rt.reportDiag?.(payload); } catch { /* 诊断不许影响业务 */ } },
    snapshot: () => active().snapshot(),
    getState: () => linked.getState(),
    dispose() {
      state.disposed = true;
      state.epoch += 1;
      if (typeof linked.cancel === 'function') linked.cancel();
      if (bubble && typeof bubble.dispose === 'function') bubble.dispose();
      if (rope && typeof rope.restoreRope === 'function') rope.restoreRope();
    },
  };
}

/** 结构化克隆（避免把内部对象引用漏给调用方）；无 structuredClone 时退回 JSON。 */
function clone(value) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  } catch { return {}; }
}
