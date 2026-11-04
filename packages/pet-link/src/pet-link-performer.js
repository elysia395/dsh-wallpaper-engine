/** 官方原生联动。只读同页服务，所有宠物写操作经宿主协调器，不查询或改写宠物 DOM。 */
const PET_BASE = '/dsh-pet-7340';
const PET_ANIM = {
  walkRight: '通用-右侧螃蟹步-dshwe', walkLeft: '通用-左侧螃蟹步-dshwe',
  brace: '侧边栏-蓄力准备往后拉-dshwe', pull: '侧边栏-后拉接疲态结束-dshwe',
  mascotTumble: '吉祥物-跳抓眩晕落地起身-dshwe', eggKick: '彩蛋-侧边栏-半身转向踢腿-dshwe',
  eggFlung: '彩蛋-侧边栏-被弹飞-dshwe', eggLand: '彩蛋-侧边栏-落地-dshwe', eggHiss: '彩蛋-吉祥物-哈气-dshwe',
};
const PET_HOLD = { walkRight: 5167, walkLeft: 5167, brace: 5167, pull: 10125,
  mascotTumble: 8000, eggKick: 5167, eggFlung: 10125, eggLand: 5167, eggHiss: 5167 };
const PET_TUNE_DEFAULTS = {
  sidebarWalkMs: 5167, braceMs: 1000, slowOpenMs: 8125, openDelayMs: 500,
  bubbleMs: 3000, holdMaxMs: 180000, eggAt: 3, mascotOpenAtMs: 2500,
  mascotRopeDownPx: 40, mascotReleaseAtMs: 2920, egg1FlingPower: 1,
  egg1LeadMs: 600, egg1PostLandMs: 600, egg2LeadMs: 600, egg2OpenAtPct: 35,
};
const PET_TUNER_LOGICS = ['sidebar', 'mascot', 'egg1', 'egg2'];
const PET_BUBBLE_SPECS = [
  { id: 'sidebar', logic: 'sidebar', image: 0, text(weT = value => value) { return weT('累死本鲸了，给我添两碗饭'); } },
  { id: 'mascot', logic: 'mascot', image: 1, text(weT = value => value) { return weT('可以换壁纸了，不要用××√哦'); } },
  { id: 'egg1Angry', logic: 'egg1', image: 2, text(weT = value => value) { return weT('偶鲸鲸！！！'); } },
  { id: 'egg1Land', logic: 'egg1', image: 3, text(weT = value => value) { return weT('哇啊啊啊啊啊！！！'); } },
  { id: 'egg2', logic: 'egg2', image: 4, text(weT = value => value) { return weT('？！欺负一只肥鱼！？'); } },
];

function createOfficialPetPerformer(options) {
  const now = options.now || Date.now;
  const later = options.setTimeout || setTimeout;
  const clear = options.clearTimeout || clearTimeout;
  const wait = options.wait || (ms => new Promise(resolve => later(resolve, ms)));
  const view = options.viewport || (() => ({ width: window.innerWidth, height: window.innerHeight }));
  const doc = options.document || (typeof document === 'undefined' ? null : document);
  const storage = options.storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : options.storage;
  const storageKey = 'dsh-we-official-pet-target';
  let target = 'main';
  try { target = storage?.getItem(storageKey) || target; } catch { /* 私密模式仍可用。 */ }
  const state = { available: false, reason: 'official-unavailable', pets: [], epoch: 0, busy: false,
    phase: 'idle', logic: '', farCount: 0, nearCount: 0, tuning: {}, bubbleTiming: {}, timer: null,
    client: null, sidebar: null, disposed: false, home: null, activeLogic: 'sidebar' };
  const tune = (key, logic = state.activeLogic) => state.tuning[logic]?.[key] ?? PET_TUNE_DEFAULTS[key];
  const service = () => { try { return options.getContext()?.get('petApi7340') || null; } catch { return null; } };
  const pet = () => state.pets.find(item => item.id === target);
  const pose = () => { try { return service()?.pose(target) || null; } catch { return null; } };
  function ensureClient() {
    if (!state.client) state.client = createOfficialPetClient({ get: () => service() }, {
      ...options, document: doc, viewport: view, sizeOf: () => pet()?.size,
    });
    return state.client;
  }
  async function probe() {
    const epoch = state.epoch;
    try {
      const result = await options.fetchTargets();
      if (epoch !== state.epoch || state.disposed) return false;
      state.pets = result?.ok && Array.isArray(result.pets) ? result.pets : [];
      const api = service(), chosen = pet();
      state.reason = !result?.ok ? result?.reason || 'official-unavailable'
        : !chosen ? 'unknown-pet'
          : !['web', 'both'].includes(chosen.display) ? 'pet-not-displayed'
            : !api || typeof api.pose !== 'function' || typeof api.progress !== 'function' || !pose()
              ? 'client-service-unavailable' : '';
      state.available = !state.reason;
    } catch { state.available = false; state.reason = 'official-unavailable'; }
    return state.available;
  }
  const clamp = value => Math.max(0, Math.min(1, value));
  function point() {
    const value = pose();
    if (!value || ![value.x, value.y].every(Number.isFinite)) throw new Error('pose-unavailable');
    return value;
  }
  function sidebarCall(method, ...args) {
    const fn = state.sidebar?.[method];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }
  function cancel() {
    state.epoch++; state.busy = false;
    const oldClient = state.client;
    state.client = null;
    oldClient?.dispose();
    sidebarCall('commit');
    options.restoreRope?.();
  }
  function fallback() {
    let handled = false;
    try { handled = options.fallback() === true; } catch { /* 不影响壁纸主界面。 */ }
    return { logic: 'disabled', phase: 'done', busy: false, fallback: handled, reason: state.reason };
  }
  async function run(logic, gesture = false) {
    if (state.busy) return { logic: 'busy', busy: true };
    if (!PET_TUNER_LOGICS.includes(logic) && !gesture) return { logic: 'invalid', busy: false };
    state.busy = true;
    const epoch = state.epoch;
    const alive = () => epoch === state.epoch && !state.disposed && Boolean(pose());
    const check = () => { if (!alive()) throw new Error('run-lost'); };
    const assertResult = result => { if (!result?.ok) throw new Error(result?.reason || 'official-unavailable'); };
    let client, released = false, openedSidebar = false;
    const openSidebar = () => { openedSidebar = true; sidebarCall('open'); };
    try {
      if (!await probe() || !alive()) return gesture ? { logic: 'disabled', busy: false } : fallback();
      client = ensureClient();
      assertResult(await client.begin(target)); check();
      state.home = point(); state.logic = logic; state.activeLogic = logic;
      const hooks = new Set();
      const shown = new Map();
      const hide = id => { if (shown.has(id)) { client.hideBubble(); shown.clear(); } };
      const show = id => {
        const spec = PET_BUBBLE_SPECS.find(item => item.id === id);
        if (!spec) return;
        shown.clear(); shown.set(id, now());
        client.showBubble({ text: spec.text(options.translate), image: spec.image, duration: Math.max(1, tune('bubbleMs')) });
      };
      const node = (action, seconds, duration) => {
        for (const spec of PET_BUBBLE_SPECS.filter(item => item.logic === logic)) {
          const config = state.bubbleTiming[spec.id];
          for (const edge of ['show', 'hide']) {
            const rule = config?.[edge];
            if (!rule || rule.action !== action || hooks.has(spec.id + edge)) continue;
            const at = (rule.edge === 'end' ? duration * 1000 : 0) + rule.offsetMs;
            if (seconds * 1000 < at) continue;
            hooks.add(spec.id + edge);
            if (edge === 'show') show(spec.id); else hide(spec.id);
          }
        }
      };
      const defaultShow = id => { if (!state.bubbleTiming[id]?.show) show(id); };
      const defaultHide = id => { if (!state.bubbleTiming[id]?.hide) hide(id); };
      const clip = async (key, tick, limitMs = null) => {
        check(); state.phase = key;
        const current = point();
        assertResult(await client.play(PET_ANIM[key], current.facing === 'right' ? 'right' : 'left')); check();
        const deadline = now() + Math.max(30000, PET_HOLD[key] + 20000);
        let started = false;
        while (alive() && now() < deadline) {
          const p = client.progress();
          if (p && Number.isFinite(p.currentTime) && Number.isFinite(p.duration) && p.duration > 0) {
            started = true;
            node(key, p.currentTime, p.duration);
            if (tick) await tick(p.currentTime * 1000, p.duration * 1000);
            if (p.currentTime >= p.duration - 0.045 || (limitMs !== null && p.currentTime * 1000 >= limitMs)) return;
          } else if (started) throw new Error('playback-replaced');
          await wait(32);
        }
        throw new Error('playback-timeout');
      };
      const move = async (destination, duration = 600) => {
        check();
        assertResult(await client.position(clamp(destination.x), clamp(destination.y), 'line', duration));
        check();
      };
      const walk = async destination => {
        const current = point();
        const key = destination.x < current.x ? 'walkLeft' : 'walkRight';
        let moving = false;
        await clip(key, async () => { if (!moving) { moving = true; await move(destination, tune('sidebarWalkMs')); } });
      };
      const edgePoint = () => {
        const width = view().width;
        const edge = sidebarCall('edgeX');
        return { x: clamp(((Number.isFinite(edge) ? edge : width) - Number(pet()?.size || 180) * 0.15) / width), y: point().y };
      };
      if (gesture) {
        await clip(logic === 'grab' ? 'brace' : 'pull', null, logic === 'grab' ? tune('braceMs') : null);
      } else if (logic === 'sidebar') {
        await walk(edgePoint());
        await clip('brace', null, tune('braceMs'));
        let opened = false;
        await clip('pull', async ms => {
          if (!opened && ms >= tune('openDelayMs')) {
            opened = true; sidebarCall('beginPull', tune('slowOpenMs')); openSidebar();
            await move(edgePoint(), tune('slowOpenMs'));
          }
        });
        if (!opened) openSidebar();
        sidebarCall('commit'); defaultShow('sidebar');
      } else if (logic === 'mascot') {
        const rope = options.ropePoint?.() || { x: 0.25, y: point().y };
        await walk({ x: clamp(rope.x), y: point().y });
        let opened = false;
        await clip('mascotTumble', ms => {
          if (!opened && ms >= tune('mascotOpenAtMs')) { opened = true; openSidebar(); }
          const pull = ms >= tune('mascotOpenAtMs') && ms < tune('mascotReleaseAtMs');
          options.moveRope?.(pull ? tune('mascotRopeDownPx') : 0);
        });
        if (!opened) openSidebar();
        options.restoreRope?.(); defaultShow('mascot');
      } else if (logic === 'egg1') {
        await walk(edgePoint()); defaultShow('egg1Angry');
        await wait(tune('egg1LeadMs')); check(); await clip('eggKick'); defaultHide('egg1Angry');
        let thrown = false;
        await clip('eggFlung', async () => {
          if (!thrown) { thrown = true; assertResult(await client.throwPet(155, tune('egg1FlingPower'))); sidebarCall('rebound', true, 240); }
        });
        defaultShow('egg1Land'); await clip('eggLand'); defaultHide('egg1Land');
        openSidebar(); await wait(tune('egg1PostLandMs')); check();
      } else {
        defaultShow('egg2'); await wait(tune('egg2LeadMs')); check();
        let opened = false;
        await clip('eggHiss', (ms, duration) => {
          if (!opened && ms >= duration * tune('egg2OpenAtPct') / 100) { opened = true; openSidebar(); }
        });
        if (!opened) openSidebar(); defaultHide('egg2');
      }
      check();
      assertResult(await client.finish()); released = true;
      if (!gesture && ['sidebar', 'mascot'].includes(logic)) {
        state.phase = 'waiting';
        const deadline = now() + tune('holdMaxMs');
        while (alive() && sidebarCall('isOpen') === true && now() < deadline) await wait(100);
      }
      if (!gesture && alive() && logic !== 'egg2') {
        // 等待期间已归还官方唯一锁；回程重新申请，不强占用户或其他插件的新锁。
        assertResult(await client.begin(target)); released = false;
        await walk(state.home);
        assertResult(await client.finish()); released = true;
      }
      state.phase = 'done';
      return { logic, phase: 'done', busy: false };
    } catch (error) {
      if (epoch === state.epoch) {
        state.reason = error.message || 'official-unavailable'; state.phase = 'cancelled';
        if (!gesture && !released && !openedSidebar) { try { options.fallback(); } catch { /* 保留主交互。 */ } }
      }
      return { logic, phase: 'cancelled', busy: false, reason: error.message || 'official-unavailable' };
    } finally {
      if (client && !released) { client.hideBubble(); await client.finish(); }
      if (epoch === state.epoch) { state.busy = false; sidebarCall('commit'); options.restoreRope?.(); }
    }
  }
  async function warmup() {
    state.disposed = false;
    clear(state.timer); state.timer = null;
    const result = await probe();
    return result;
  }
  const snapshot = () => ({ available: state.available, reason: state.reason, busy: state.busy,
    phase: state.phase, logic: state.logic, target, pets: state.pets.map(item => ({ ...item })),
    farCount: state.farCount, nearCount: state.nearCount, home: state.home });
  const result = {
    names: PET_ANIM, warmup,
    dispose() { state.disposed = true; clear(state.timer); state.timer = null; cancel(); state.client?.dispose(); state.client = null; },
    mascot: {
      async tap() {
        if (state.busy) return { logic: 'busy', busy: true };
        if (!await probe()) return fallback();
        const p = point(), rope = options.ropePoint?.() || { x: 0.25, y: p.y };
        let logic = Math.abs(p.x - rope.x) < Math.abs(p.x - 1) ? 'mascot' : 'sidebar';
        const key = logic === 'sidebar' ? 'farCount' : 'nearCount';
        if (++state[key] >= tune('eggAt', logic)) { state[key] = 0; logic = logic === 'sidebar' ? 'egg1' : 'egg2'; }
        return run(logic);
      }, snapshot,
      registerSidebar(api) { if (!api && state.busy) cancel(); state.sidebar = api; },
      registerGesture(fn) { state.cancelGesture = fn; return () => { if (state.cancelGesture === fn) state.cancelGesture = null; }; },
      reset() { state.farCount = 0; state.nearCount = 0; },
    },
    performer: {
      onGrab() { return run('grab', true).then(value => value.phase === 'done'); },
      onPull(progress) { return Number.isFinite(progress) && progress >= 0.12 ? run('pull', true).then(value => value.phase === 'done') : Promise.resolve(false); },
      onRelease() { return Promise.resolve(false); }, snapshot,
    },
    tuner: {
      run: logic => run(logic), snapshot: () => ({ ...snapshot(), defaults: { ...PET_TUNE_DEFAULTS }, logicTuning: structuredClone(state.tuning), bubbleTiming: structuredClone(state.bubbleTiming) }),
      cancel,
      setTarget(id) {
        if (typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 128 || /[\u0000-\u001f]/.test(id)) return false;
        cancel(); target = id; state.available = false; state.reason = 'target-changed';
        try { storage?.setItem(storageKey, id); } catch { /* 当前页选择仍生效。 */ }
        return true;
      },
      setForLogic(logic, key, value) {
        if (!PET_TUNER_LOGICS.includes(logic) || !(key in PET_TUNE_DEFAULTS) || !Number.isFinite(value) || value < 0 || value > 180000) return false;
        if (key === 'egg1FlingPower' && (value <= 0 || value > 10)) return false;
        if (key === 'egg2OpenAtPct' && value > 100) return false;
        if (key === 'eggAt' && (!Number.isInteger(value) || value < 1)) return false;
        state.tuning[logic] ??= {}; state.tuning[logic][key] = value; return true;
      },
      setBubbleTiming(id, config) {
        if (!PET_BUBBLE_SPECS.some(item => item.id === id) || !config || typeof config !== 'object') return false;
        for (const edge of ['show', 'hide']) {
          const rule = config[edge];
          if (rule && (!(rule.action in PET_ANIM) || !['start', 'end'].includes(rule.edge) || !Number.isFinite(rule.offsetMs) || Math.abs(rule.offsetMs) > 180000)) return false;
        }
        state.bubbleTiming[id] = structuredClone(config); return true;
      },
      reset(logic) {
        if (logic) {
          delete state.tuning[logic];
          for (const spec of PET_BUBBLE_SPECS.filter(item => item.logic === logic)) delete state.bubbleTiming[spec.id];
        } else { state.tuning = {}; state.bubbleTiming = {}; }
        return result.tuner.snapshot();
      },
    },
  };
  return result;
}
