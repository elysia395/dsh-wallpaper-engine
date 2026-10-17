#!/usr/bin/env node
/**
 * verify-pet-tuner.mjs —— 桌宠联动的**页内调参面板**判据（真跑，不是文本比对）。
 *
 * 为什么必须"真跑"：调参面板与排播之间只有**一个接口**（覆盖层 `petLinkTune(key)`），
 * 而这个接口的错法几乎全是**纯文本判据抓不到**的：
 *   · 两个内联模块的**声明顺序**写反 ⇒ 模块求值期就 `ReferenceError`（TDZ）；
 *   · 覆盖层的默认值与常量**静默分叉**（面板一打开就把默认行为改了）；
 *   · 面板 DOM 建不出来 / 输入框没接上 ⇒ 用户改了数值但排播不变。
 * 所以本文件把 `src/pet-link-tuner.js` 与 `src/pet-link.js` **按构建顺序拼成一个函数体**
 * 在最小 DOM 替身里真跑一遍 —— 这正是 `scripts/build-client.mjs` 干的事。
 *
 * 判据口径提醒：`petLinkTune` 的默认值一律**引用常量本身**（不抄字面量），
 * 而 `PET_SLOW_OPEN_MS` 这类常量的右侧是**表达式**（`PET_PULL_MS + 5167`）
 * ⇒ 比字符串是错的判据，必须就地把常量名替换成字面值再求值。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function main() {
  const ROOT = fileURLToPath(new URL('../', import.meta.url));
  const results = [];

  /** 打印一条判据。失败时**必须**把"期望串"写进文案。 */
  function check(name, ok, detail) {
    results.push(Boolean(ok));
    console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  }

  /** 读源码并规范化行尾（仓库是 CRLF，锚点按 LF 写）。 */
  function read(rel) {
    return readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n');
  }

  // ── 模块路径（**逐字**，guard-targets 从这些字面量派生"本守卫管哪些模块"）──
  // ⚠️ 只允许出现这两个。绝不能写裸的 'client.js'。
  const SRC_TUNER = 'packages/pet-link/src/pet-link-tuner.js';
  const SRC_PET = 'packages/pet-link/src/pet-link.js';

  const tunerSrc = read(SRC_TUNER);
  const petSrc = read(SRC_PET);

  // ── 最小 DOM 替身 ──────────────────────────────────────────────────────
  // 面板只用 createElement / appendChild / setAttribute / addEventListener /
  // querySelector('[data-tuner=…]') / textContent / value / style / replaceChildren。
  const captureOf = new WeakMap();
  function dispatch(target, handlers, type, fields = {}) {
    let stopped = false;
    const event = { target, type, button: 0, pointerId: 1, isPrimary: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
      stopImmediatePropagation() { stopped = true; }, ...fields };
    const listeners = [...(handlers[type] || [])].sort((a, b) => Number(captureOf.get(b)) - Number(captureOf.get(a)));
    for (const fn of listeners) { if (stopped) break; fn(event); }
    return event;
  }
  function makeEl(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      children: [], attrs: {}, dataset: {}, style: {},
      textContent: '', value: '', type: '', title: '', placeholder: '',
      _handlers: {}, _captured: new Set(),
      setPointerCapture(id) { this._captured.add(id); },
      hasPointerCapture(id) { return this._captured.has(id); },
      releasePointerCapture(id) { this._captured.delete(id); },
      getBoundingClientRect() {
        const width = Math.min(430, windowStub.innerWidth - 16);
        const height = Math.min(600, windowStub.innerHeight - 16);
        const left = this.style.left ? parseFloat(this.style.left) : windowStub.innerWidth - width - 16;
        const top = this.style.top ? parseFloat(this.style.top) : 16;
        return { left, top, width, height, right: left + width, bottom: top + height };
      },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      remove() {
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
      },
      replaceChildren() { this.children = []; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener(type, fn) { (this._handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { this._handlers[type] = (this._handlers[type] || []).filter(f => f !== fn); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const m = /^\[([a-z-]+)(?:="?([^"\]]+)"?)?\]$/.exec(String(sel));
        if (!m) return [];
        const found = [];
        const walk = node => {
          for (const child of node.children || []) {
            if (child.attrs && Object.hasOwn(child.attrs, m[1]) && (m[2] === undefined || child.attrs[m[1]] === m[2])) found.push(child);
            walk(child);
          }
        };
        walk(this);
        return found;
      },
      dispatch(type, fields = {}) { return dispatch(this, this._handlers, type, fields); },
    };
    return el;
  }

  const documentStub = {
    body: makeEl('body'), handlers: {},
    createElement: (tag) => makeEl(tag),
    addEventListener(type, fn, capture = false) {
      (this.handlers[type] ||= []).push(fn);
      captureOf.set(fn, Boolean(capture));
    },
    removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); },
    querySelector(sel) { return this.body.querySelector(sel); },
    querySelectorAll(sel) { return this.body.querySelectorAll(sel); },
    dispatch(type, fields = {}) { return dispatch(this, this.handlers, type, fields); },
  };

  const windowStub = {
    __dshPetCtl: null, innerWidth: 1280, innerHeight: 800, handlers: {},
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); },
    dispatch(type) { for (const fn of this.handlers[type] || []) fn(); },
  };
  const sandbox = {
    document: documentStub,
    window: windowStub,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.resolve({ status: 404, ok: false, json: () => Promise.resolve({}) }),
    apiUrl: (p) => String(p),
    weT: (s) => s,
    wallSidebarOpen() {}, wallSidebarClose() {}, wallSidebarToggle() {},
    wallSidebarAvailable: () => true,
    sidebarRightMode: () => 'official',
    sidebarRightOursActive: () => false,
  };

  // ── 按构建顺序拼装并真跑（顺序写反 = TDZ，正是判据要抓的）──────────────
  let mod = null;
  let evalError = '';
  const loadModule = () => new Function(
    ...Object.keys(sandbox),
    tunerSrc + '\n' + petSrc + '\nreturn { petLink, petLinkTuner, petLinkTune, petLinkState, PET_TUNE_DEFAULTS, installHotkey: petTunerInstallHotkey };',
  )(...Object.values(sandbox));
  try {
    mod = loadModule();
  } catch (err) {
    evalError = (err && err.message) || String(err);
  }

  check('两个内联模块按构建顺序求值不得抛错（顺序写反即 TDZ）', Boolean(mod), evalError);

  if (mod) {
    const { petLink, petLinkTuner, petLinkTune, petLinkState, PET_TUNE_DEFAULTS } = mod;

    // ── 一、覆盖层默认值 == 常量（静默分叉是这里最危险的错法）────────────
    // 常量右侧可能是表达式（PET_SLOW_OPEN_MS = PET_PULL_MS + 5167）⇒ 就地替换名字再求值。
    const consts = {};
    for (const m of petSrc.matchAll(/const (PET_[A-Z0-9_]+) = ([^;]+);/g)) consts[m[1]] = m[2];
    const evalConst = (name) => {
      const raw = consts[name];
      if (raw === undefined) return 'MISSING';
      const inlined = raw.replace(/\bPET_[A-Z0-9_]+\b/g, (n) => {
        const v = consts[n];
        return v === undefined ? n : '(' + v + ')';
      });
      if (!/^[\s\d+\-*/().]+$/.test(inlined)) return 'EXPR:' + raw;
      try { return Function('"use strict";return (' + inlined + ');')(); } catch { return 'ERR:' + raw; }
    };

    const PAIRS = [
      ['sidebarWalkMs', 'PET_SIDEBAR_WALK_MS'], ['braceMs', 'PET_BRACE_MS'],
      ['pullMs', 'PET_PULL_MS'], ['slowOpenMs', 'PET_SLOW_OPEN_MS'],
      ['bubbleMs', 'PET_BUBBLE_MS'], ['bubbleWindowMs', 'PET_BUBBLE_WINDOW_MS'],
      ['lockHeartbeatMs', 'PET_LOCK_HEARTBEAT_MS'], ['holdMaxMs', 'PET_HOLD_MAX_MS'],
      ['eggAt', 'PET_EGG_AT'], ['mascotGrabAtMs', 'PET_MASCOT_GRAB_AT_MS'],
      ['eggBubbleLeadMs', 'PET_EGG_BUBBLE_LEAD_MS'], ['returnWalkMinPx', 'PET_RETURN_WALK_MIN_PX'],
      ['handRightRatio', 'PET_HAND_RIGHT_RATIO'], ['edgeGapPx', 'PET_EDGE_GAP_PX'],
      ['followGraceMs', 'PET_FOLLOW_GRACE_MS'], ['openLeadMs', 'PET_OPEN_LEAD_MS'],
      ['segGapMs', 'PET_SEG_GAP_MS'], ['openDelayMs', 'PET_OPEN_DELAY_MS'],
      ['followSpeed', 'PET_FOLLOW_MAX_SPEED'], ['followStillMs', 'PET_FOLLOW_STILL_MS'],
      ['followStillEps', 'PET_FOLLOW_STILL_EPS'],
    ];
    for (const [key, constName] of PAIRS) {
      const want = evalConst(constName);
      const got = PET_TUNE_DEFAULTS[key];
      check('覆盖层默认值等于常量 ' + constName, got === want, '面板=' + got + ' 常量=' + want);
    }

    // ── 二、覆盖层语义 ────────────────────────────────────────────────────
    check('未覆盖时返回默认值（默认行为与没有面板时逐字相同）',
      petLinkTune('bubbleMs') === PET_TUNE_DEFAULTS.bubbleMs,
      'petLinkTune(bubbleMs)=' + petLinkTune('bubbleMs'));

    check('未知键必须返回 undefined（不静默给默认值，免得掩盖拼错键）',
      petLinkTune('noSuchKey___') === undefined,
      'got=' + String(petLinkTune('noSuchKey___')));

    check('覆盖后立刻返回覆盖值', (() => {
      petLinkState.tuning.bubbleMs = 1234;
      const got = petLinkTune('bubbleMs');
      delete petLinkState.tuning.bubbleMs;
      return got === 1234;
    })(), '');

    check('覆盖值非法（非有限数）时退回默认值', (() => {
      petLinkState.tuning.bubbleMs = NaN;
      const got = petLinkTune('bubbleMs');
      delete petLinkState.tuning.bubbleMs;
      return got === PET_TUNE_DEFAULTS.bubbleMs;
    })(), '');

    check('snapshot 报出全部生效值、默认值与已覆盖清单', (() => {
      const snap = petLinkTuner.snapshot();
      return snap && typeof snap.values === 'object' && typeof snap.defaults === 'object'
        && Array.isArray(snap.overridden);
    })(), '');

    check('reset() 之后回到默认值', (() => {
      petLinkState.tuning.bubbleMs = 9999;
      petLinkTuner.reset();
      return petLinkTune('bubbleMs') === PET_TUNE_DEFAULTS.bubbleMs;
    })(), '');

    check('覆盖层只落在 petLinkState.tuning 一个格子里（不旁写排播状态）',
      Object.keys(petLinkState.tuning).length === 0,
      JSON.stringify(Object.keys(petLinkState.tuning)));

    // ── 三、面板 DOM ──────────────────────────────────────────────────────
    let root = null;
    const findRoot = () => {
      const walk = (node) => {
        for (const c of node.children || []) {
          if (c.attrs && c.attrs['data-pet-tuner'] === '1') return c;
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      };
      return walk(documentStub.body);
    };
    try {
      petLinkTuner.open();
      root = petLinkTuner.isOpen() ? findRoot() : null;
    } catch (err) { evalError = (err && err.message) || String(err); }
    check('open() 必须把浮层真的建出来', Boolean(root), evalError);

    if (root) {
      const keys = PAIRS.map(p => p[0]);
      const tab = logic => root.querySelector('[data-tuner-tab="' + logic + '"]');
      const page = logic => root.querySelector('[data-tuner-page="' + logic + '"]');
      const field = (logic, key) => page(logic)?.querySelector('[data-tuner="' + key + '"]');
      const bubble = id => root.querySelector('[data-tuner-bubble="' + id + '"]');
      const pageKeys = {
        sidebar: ['sidebarWalkMs', 'braceMs', 'pullMs', 'slowOpenMs', 'edgeGapPx'],
        mascot: ['mascotWalkMs', 'mascotTumbleMs', 'mascotGrabAtMs', 'mascotOpenAtMs', 'mascotRopeDownPx', 'mascotRopePullMs', 'mascotRopeBackMs'],
        egg1: ['egg1WalkMs', 'egg1LeadMs', 'egg1KickMs', 'egg1FlungMs', 'egg1LandMs', 'egg1FlingPx', 'egg1FlingMs'],
        egg2: ['egg2LeadMs', 'egg2HissMs'],
      };
      const ownKeys = ['bubbleMs', 'bubbleWindowMs', 'lockHeartbeatMs', 'holdMaxMs', 'returnWalkMinPx', 'segGapMs'];
      const runCalls = [];
      const originalRun = petLinkTuner.run;
      petLinkTuner.run = logic => { runCalls.push(logic); return Promise.resolve(true); };
      for (const [logic, fields] of Object.entries(pageKeys)) {
        tab(logic)?.dispatch('click');
        check('切页显示自己的动作和基础参数：' + logic, Boolean(page(logic))
          && page(logic).style.display !== 'none'
          && Object.keys(pageKeys).filter(key => key !== logic).every(key => page(key)?.style.display === 'none')
          && [...fields, ...ownKeys].every(key => field(logic, key)));
        check('切页更新选中状态：' + logic, tab(logic)?.getAttribute('aria-pressed') === 'true');
        const run = root.querySelector('[data-tuner="run"]');
        check('仅当前逻辑有播放按钮：' + logic, root.querySelectorAll('[data-tuner-run]').length === 1
          && run?.getAttribute('data-tuner-run') === logic);
      }
      check('切换四页不能触发播放', runCalls.length === 0);
      root.querySelector('[data-tuner="run"]')?.dispatch('click');
      check('试跑按钮只触发当前彩蛋二', runCalls.join(',') === 'egg2');
      petLinkTuner.run = originalRun;
      check('不再存在共用设置页或气泡对象选择', !page('common') && !root.querySelector('[data-tuner="bubbleTarget"]'));
      check('逻辑二不再显示额外起身归位的时刻和时长控件',
        !field('mascot', 'mascotRecoverAtMs') && !field('mascot', 'mascotRecoverMs'));
      const motionKeys = ['mascotReleaseAtMs', 'mascotDropPx', 'mascotDropMs'];
      check('逻辑二专属脱手/下落数字控件齐全', motionKeys.every(key => field('mascot', key)?.type === 'number')
        && motionKeys.every(key => !field('sidebar', key) && !field('egg1', key) && !field('egg2', key)));
      for (const key of ['mascotRopePullEase', 'mascotRopeBackEase']) {
        const el = field('mascot', key);
        check('逻辑二缓动为固定选项下拉：' + key, el?.tagName === 'SELECT' && el.children.length === 3);
        if (el) { el.value = '0'; el.dispatch('change'); }
        check('缓动选择直接写入私有JSON：' + key, petLinkTuner.snapshot().logicValues.mascot[key] === 0);
      }
      const drop = field('mascot', 'mascotDropPx');
      if (drop) { drop.value = '123'; drop.dispatch('input'); }
      check('下落距离写入导出并可被当前重置恢复', (() => {
        const saved = JSON.parse(root.querySelector('[data-tuner="out"]').value);
        petLinkTuner.reset('mascot');
        return saved.logicValues.mascot.mascotDropPx === 123
          && Number(drop?.value) === PET_TUNE_DEFAULTS.mascotDropPx;
      })());
      const eggKeys = ['egg1EdgeGapPx', 'egg1FlingDelayMs', 'egg1PostLandMs'];
      check('彩蛋一专属距离/延迟/落地停留控件齐全且不串页', eggKeys.every(key => field('egg1', key)?.type === 'number')
        && eggKeys.every(key => ['sidebar', 'mascot', 'egg2'].every(logic => !field(logic, key))));
      if (eggKeys.every(key => field('egg1', key))) {
        const before = petLinkTuner.snapshot();
        for (const [key, value] of Object.entries({ egg1EdgeGapPx: -25, egg1FlingDelayMs: 250, egg1PostLandMs: 900 })) {
          const el = field('egg1', key); el.value = String(value); el.dispatch('input');
        }
        const saved = JSON.parse(root.querySelector('[data-tuner="out"]').value);
        check('踢腿间距允许负值并写入彩蛋一私有导出', field('egg1', 'egg1EdgeGapPx').min !== '0'
          && saved.logicTuning.egg1.egg1EdgeGapPx === -25
          && saved.logicTuning.egg1.egg1FlingDelayMs === 250 && saved.logicTuning.egg1.egg1PostLandMs === 900);
        petLinkTuner.reset('egg1');
        const reset = petLinkTuner.snapshot();
        check('彩蛋一重置恢复控件且保留逻辑一二参数及气泡', eggKeys.every(key => Number(field('egg1', key).value) === reset.defaults[key])
          && JSON.stringify(reset.logicValues.sidebar) === JSON.stringify(before.logicValues.sidebar)
          && JSON.stringify(reset.logicValues.mascot) === JSON.stringify(before.logicValues.mascot)
          && JSON.stringify(reset.bubbleTiming.sidebar) === JSON.stringify(before.bubbleTiming.sidebar));
      }
      const hissKeys = ['egg2ShakeAtMs', 'egg2ShakePx', 'egg2ShakeHz', 'egg2OpenAtPct', 'egg2OpenEase'];
      check('彩蛋二抖动与展开控件独占本页且缓动使用下拉', hissKeys.every(key => field('egg2', key))
        && hissKeys.every(key => ['sidebar', 'mascot', 'egg1'].every(logic => !field(logic, key)))
        && field('egg2', 'egg2OpenEase')?.tagName === 'SELECT');
      if (hissKeys.every(key => field('egg2', key))) {
        const before = petLinkTuner.snapshot();
        for (const [key, value] of Object.entries({ egg2ShakeAtMs: 2100, egg2ShakePx: 14, egg2ShakeHz: 9, egg2OpenAtPct: 55, egg2OpenEase: 0 })) {
          const el = field('egg2', key); el.value = String(value); el.dispatch(key === 'egg2OpenEase' ? 'change' : 'input');
        }
        const saved = JSON.parse(root.querySelector('[data-tuner="out"]').value);
        check('彩蛋二五控件直接写入私有JSON', saved.logicValues.egg2.egg2ShakeAtMs === 2100
          && saved.logicValues.egg2.egg2ShakePx === 14
          && saved.logicValues.egg2.egg2ShakeHz === 9 && saved.logicValues.egg2.egg2OpenAtPct === 55
          && saved.logicValues.egg2.egg2OpenEase === 0);
        petLinkTuner.reset('egg2');
        const reset = petLinkTuner.snapshot();
        check('彩蛋二当前重置恢复新默认且不串其他三页', hissKeys.every(key => Number(field('egg2', key).value) === reset.defaults[key])
          && ['sidebar', 'mascot', 'egg1'].every(logic => JSON.stringify(reset.logicValues[logic]) === JSON.stringify(before.logicValues[logic])));
      }
      for (const [logic, count] of Object.entries({ sidebar: 1, mascot: 1, egg1: 2, egg2: 1 })) {
        check('气泡固定归属且彩蛋一有两套：' + logic, page(logic)?.querySelectorAll('[data-tuner-bubble]').length === count);
      }
      if (tab('mascot') && field('sidebar', 'bubbleMs')) {
        const edit = (logic, key, value) => { const el = field(logic, key); el.value = String(value); el.dispatch('input'); };
        edit('sidebar', 'braceMs', 777); edit('sidebar', 'bubbleMs', 1111);
        edit('mascot', 'bubbleMs', 2222); edit('egg1', 'bubbleMs', 3333); edit('egg2', 'bubbleMs', 4444);
        edit('mascot', 'holdMaxMs', 12345); edit('egg1', 'egg1KickMs', 888);
        edit('mascot', 'mascotTumbleMs', 1234);
        tab('egg1').dispatch('click'); tab('mascot').dispatch('click');
        const snap = petLinkTuner.snapshot();
        check('四页气泡时长独立导出且切页不串改', ['sidebar', 'mascot', 'egg1', 'egg2'].every((logic, i) =>
          snap.logicValues?.[logic]?.bubbleMs === (i + 1) * 1111));
        check('支线覆盖和逻辑一精调值各自保留', field('mascot', 'mascotTumbleMs').value === '1234'
          && snap.logicValues?.sidebar.braceMs === 777 && snap.logicValues?.egg1.egg1KickMs === 888);
        petLinkTuner.setBubbleTiming('sidebar', { show: { action: 'pull', edge: 'start', offsetMs: 10 } });
        petLinkTuner.setBubbleTiming('mascot', { show: { action: 'mascotTumble', edge: 'start', offsetMs: 20 } });
        root.querySelector('[data-tuner="reset-current"]')?.dispatch('click');
        const reset = petLinkTuner.snapshot();
        check('当前重置只归还本页动作、气泡和占用', reset.logicValues?.mascot.mascotTumbleMs === 8000
          && reset.logicValues?.mascot.bubbleMs === 3000 && reset.logicValues?.mascot.holdMaxMs === 180000
          && reset.logicValues?.sidebar.braceMs === 777 && reset.logicValues?.sidebar.bubbleMs === 1111
          && reset.logicValues?.egg1.egg1KickMs === 888 && reset.bubbleTiming.sidebar.show.offsetMs === 10
          && reset.bubbleTiming.mascot.show.action === 'default');
        check('全量JSON导出全部未显示页', JSON.parse(root.querySelector('[data-tuner="out"]').value).logicValues?.egg1.egg1KickMs === 888);
      }
      petLinkTuner.reset(); tab('sidebar')?.dispatch('click');
      const nodes = [];
      const collect = node => { nodes.push(node); for (const child of node.children || []) collect(child); };
      collect(root);
      check('面板标题显示中文', root.querySelector('[data-tuner="drag"]')?.textContent === '桌宠联动调参');
      check('逻辑一参数标题不再使用无归属气泡分组', nodes.some(node => node.textContent === '逻辑一')
        && !nodes.some(node => node.textContent === '气泡' || node.textContent === '通用设置'));
      check('工具按钮使用中文', ['全部重置', '重置当前逻辑', '导出 JSON', '隐藏'].every(text =>
        nodes.some(node => node.tagName === 'BUTTON' && node.textContent === text)));
      check('JSON 输出框具有中文名称', root.querySelector('[data-tuner="out"]').getAttribute('aria-label') === '当前调参 JSON');
      check('导出的原数字参数键不丢失', (() => {
        const values = JSON.parse(root.querySelector('[data-tuner="out"]').value).values;
        return keys.every(key => typeof values[key] === 'number')
          && Object.keys(values).length === Object.keys(PET_TUNE_DEFAULTS).length;
      })());
      const change = (id, key, value, type = 'change') => {
        const el = bubble(id)?.querySelector('[data-tuner="' + key + '"]');
        if (!el) return false;
        el.value = value; el.dispatch(type); return true;
      };
      if (bubble('sidebar') && tab('egg1')) {
        change('sidebar', 'bubble-show-action', 'pull'); change('sidebar', 'bubble-show-edge', 'end');
        change('sidebar', 'bubble-show-offset', '-300', 'input');
        tab('egg1').dispatch('click');
        change('egg1Angry', 'bubble-show-action', 'eggKick'); change('egg1Angry', 'bubble-show-offset', '100', 'input');
        change('egg1Land', 'bubble-show-action', 'eggLand'); change('egg1Land', 'bubble-show-offset', '200', 'input');
        change('egg1Land', 'bubble-hide-action', 'duration'); change('egg1Land', 'bubble-hide-offset', '1500', 'input');
        const rules = JSON.parse(root.querySelector('[data-tuner="out"]').value).bubbleTiming;
        check('两套固定气泡直接编辑且不影响其他页', rules.egg1Angry.show.offsetMs === 100
          && rules.egg1Land.show.offsetMs === 200 && rules.egg1Land.hide.offsetMs === 1500 && rules.sidebar.show.offsetMs === -300);
        check('按显示时长关闭禁用开始结束', bubble('egg1Land').querySelector('[data-tuner="bubble-hide-edge"]').disabled);
        tab('sidebar').dispatch('click');
        check('返回逻辑一恢复自己的固定节点', bubble('sidebar').querySelector('[data-tuner="bubble-show-offset"]').value === '-300');
        petLinkTuner.reset();
        check('全部重置同步所有固定气泡及逻辑一出厂节点',
          bubble('sidebar').querySelector('[data-tuner="bubble-show-action"]').value === 'pull'
          && bubble('sidebar').querySelector('[data-tuner="bubble-show-offset"]').value === '7000'
          && bubble('sidebar').querySelector('[data-tuner="bubble-hide-action"]').value === 'duration'
          && bubble('sidebar').querySelector('[data-tuner="bubble-hide-offset"]').value === '5000'
          && petLinkTuner.snapshot().bubbleTiming.egg1Land.hide.action === 'duration'
          && petLinkTuner.snapshot().bubbleTiming.egg1Land.hide.offsetMs === 15000);
        change('sidebar', 'bubble-show-offset', '900', 'input');
        change('sidebar', 'bubble-hide-offset', '1200', 'input');
        root.querySelector('[data-tuner="reset-current"]')?.dispatch('click');
        const factory = JSON.parse(root.querySelector('[data-tuner="out"]').value).bubbleTiming.sidebar;
        check('当前重置按钮和JSON都恢复逻辑一7000/5000基点',
          factory.show.action === 'pull' && factory.show.edge === 'start' && factory.show.offsetMs === 7000
          && factory.hide.action === 'duration' && factory.hide.offsetMs === 5000
          && bubble('sidebar').querySelector('[data-tuner="bubble-hide-edge"]').disabled);
      }
      for (const [logic, rules] of Object.entries({
        egg1: { egg1Angry: ['eggKick', '5000'], egg1Land: ['eggFlung', '15000'] },
        egg2: { egg2: ['default', '5000'] },
      })) {
        tab(logic).dispatch('click');
        for (const id of Object.keys(rules)) change(id, 'bubble-hide-offset', '99', 'input');
        root.querySelector('[data-tuner="reset-current"]').dispatch('click');
        const snap = JSON.parse(root.querySelector('[data-tuner="out"]').value);
        for (const [id, [action, duration]] of Object.entries(rules)) {
          const group = bubble(id);
          check('当前重置后控件和JSON恢复截图基点：' + id,
            group.querySelector('[data-tuner="bubble-show-action"]').value === action
            && group.querySelector('[data-tuner="bubble-show-offset"]').value === '0'
            && group.querySelector('[data-tuner="bubble-hide-action"]').value === 'duration'
            && group.querySelector('[data-tuner="bubble-hide-offset"]').value === duration
            && snap.bubbleTiming[id].show.action === action
            && snap.bubbleTiming[id].hide.offsetMs === Number(duration));
        }
      }
      tab('sidebar').dispatch('click');
      const box = field('sidebar', 'bubbleMs') || root.querySelector('[data-tuner="bubbleMs"]');
      if (box) { box.value = '2500'; box.dispatch('input'); }
      check('输入直接写到本页独占覆盖层', petLinkTuner.snapshot().logicValues?.sidebar.bubbleMs === 2500);
      petLinkTuner.reset();

      const handle = root.querySelector('[data-tuner="drag"]');
      check('必须有标题栏拖动柄', Boolean(handle), 'data-tuner=drag');
      if (handle) {
        const before = root.getBoundingClientRect();
        handle.dispatch('pointerdown', { clientX: before.left + 20, clientY: before.top + 10 });
        handle.dispatch('pointermove', { clientX: before.left - 180, clientY: before.top + 70 });
        const moved = root.getBoundingClientRect();
        check('拖标题栏按指针增量移动且捕获指针',
          moved.left === before.left - 200 && moved.top === before.top + 60 && handle.hasPointerCapture(1), '实际=' + JSON.stringify(moved));
        handle.dispatch('pointermove', { clientX: -9999, clientY: -9999 });
        let r = root.getBoundingClientRect();
        check('拖动不得越出视口左上边界', r.left >= 0 && r.top >= 0, JSON.stringify(r));
        handle.dispatch('pointermove', { clientX: 9999, clientY: 9999 });
        r = root.getBoundingClientRect();
        check('拖动不得越出视口右下边界', r.right <= windowStub.innerWidth && r.bottom <= windowStub.innerHeight, JSON.stringify(r));
        handle.dispatch('pointercancel');
        const stopped = JSON.stringify(root.getBoundingClientRect());
        handle.dispatch('pointermove', { clientX: 10, clientY: 10 });
        check('取消后停止拖动并释放捕获', stopped === JSON.stringify(root.getBoundingClientRect()) && !handle.hasPointerCapture(1));
        for (const end of ['pointerup', 'lostpointercapture']) {
          handle.dispatch('pointerdown', { clientX: r.left + 10, clientY: r.top + 10 });
          handle.dispatch(end);
          const atEnd = JSON.stringify(root.getBoundingClientRect());
          handle.dispatch('pointermove', { clientX: 20, clientY: 20 });
          check(end + '后停止拖动', atEnd === JSON.stringify(root.getBoundingClientRect()));
        }
        handle.dispatch('pointerdown', { button: 2, clientX: r.left, clientY: r.top });
        handle.dispatch('pointermove', { clientX: 10, clientY: 10 });
        check('右键不得启动拖动', stopped === JSON.stringify(root.getBoundingClientRect()));
        handle.dispatch('pointerdown', { isPrimary: false, clientX: r.left, clientY: r.top });
        handle.dispatch('pointermove', { clientX: 10, clientY: 10 });
        check('非主指针不得启动拖动', stopped === JSON.stringify(root.getBoundingClientRect()));
        const snapshot = JSON.stringify(root.getBoundingClientRect());
        box.dispatch('pointerdown', { clientX: 20, clientY: 20 });
        root.dispatch('pointermove', { clientX: 100, clientY: 100 });
        check('参数输入不触发面板移动', snapshot === JSON.stringify(root.getBoundingClientRect()));
        handle.dispatch('pointerdown', { clientX: r.left, clientY: r.top });
        handle.dispatch('pointermove', { pointerId: 2, clientX: 10, clientY: 10 });
        check('其他指针不能抢占当前拖动', snapshot === JSON.stringify(root.getBoundingClientRect()));
        petLinkTuner.close();
        petLinkTuner.toggle();
        check('隐藏后可再次toggle打开并保留位置', petLinkTuner.isOpen() && snapshot === JSON.stringify(root.getBoundingClientRect()));
        handle.dispatch('pointermove', { clientX: 10, clientY: 10 });
        check('隐藏面板会终止进行中的拖动', snapshot === JSON.stringify(root.getBoundingClientRect()));
        const outsideEvent = { pointerId: 1, clientX: r.left - 50, clientY: r.top - 20,
          preventDefault() {}, stopPropagation() {} };
        handle.dispatch('pointerdown', { clientX: r.left, clientY: r.top });
        for (const fn of documentStub.handlers.pointermove || []) fn(outsideEvent);
        const outside = root.getBoundingClientRect();
        check('未转发捕获事件时文档级兜底仍可拖动', outside.left === r.left - 50 && outside.top === r.top - 20);
        for (const fn of documentStub.handlers.pointerup || []) fn(outsideEvent);
        const released = JSON.stringify(root.getBoundingClientRect());
        for (const fn of documentStub.handlers.pointermove || []) fn({ ...outsideEvent, clientX: 0 });
        check('在标题外松手也能终止拖动', released === JSON.stringify(root.getBoundingClientRect()));
        handle.dispatch('pointerdown', { clientX: outside.left, clientY: outside.top });
        windowStub.dispatch('blur');
        handle.dispatch('pointermove', { clientX: 0, clientY: 0 });
        check('窗口失焦终止拖动', released === JSON.stringify(root.getBoundingClientRect()));
        windowStub.innerWidth = 320;
        windowStub.innerHeight = 480;
        windowStub.dispatch('resize');
        r = root.getBoundingClientRect();
        check('缩小窗口后面板仍在视口内', r.left >= 0 && r.top >= 0 && r.right <= 320 && r.bottom <= 480, JSON.stringify(r));
      }
      petLinkTuner.close();
      petLinkTuner.toggle();
      check('不传force的toggle必须能重开已隐藏面板', petLinkTuner.isOpen());
    }

    check('必须挂上热键开关（Ctrl+Shift+D）',
      Array.isArray(documentStub.handlers.keydown) && documentStub.handlers.keydown.length > 0,
      'keydown 监听数=' + (documentStub.handlers.keydown || []).length);

    check('close() 之后浮层必须收起（display:none）', (() => {
      try {
        petLinkTuner.open();
        petLinkTuner.close();
        return !petLinkTuner.isOpen();
      } catch { return false; }
    })(), '');

    check('排播入口暴露在 petLink.tuner 上（面板与排播是同一个对象）',
      Boolean(petLink && petLink.tuner === petLinkTuner), '');

    // 同一份 document/window 上真加载多代源码，不能只测单个闭包里的单例。
    const panels = () => documentStub.querySelectorAll('[data-pet-tuner]');
    const listenerCount = handlers => Object.values(handlers).reduce((sum, list) => sum + list.length, 0);
    const hotkey = () => documentStub.dispatch('keydown', { key: 'D', ctrlKey: true, shiftKey: true });
    petLinkTuner.open();
    const oldRoot = findRoot();
    check('缺少联动资格时仅禁用试跑，参数与导出仍可维护',
      oldRoot.querySelector('[data-tuner="run"]').disabled === true
      && oldRoot.querySelector('[data-tuner="out"]').disabled !== true);
    check('维护面板具有可读的运行状态', Boolean(oldRoot.querySelector('[data-tuner="status"]')?.textContent));
    const oldHandle = oldRoot.querySelector('[data-tuner="drag"]');
    const oldInput = oldRoot.querySelector('[data-tuner="bubbleMs"]');
    oldHandle.dispatch('pointerdown', { clientX: 10, clientY: 10 });
    petLink.dispose();
    check('插件卸载会移除面板并释放拖动捕获', panels().length === 0 && !oldHandle.hasPointerCapture(1));
    check('插件卸载会解绑全部文档与窗口监听', listenerCount(documentStub.handlers) === 0 && listenerCount(windowStub.handlers) === 0);
    oldInput.value = '777';
    oldInput.dispatch('input');
    check('已移除面板的控件不再修改覆盖值', petLinkTune('bubbleMs') !== 777);
    hotkey();
    petLinkTuner.open();
    check('卸载后的热键和旧API不会重建面板', panels().length === 0 && !petLinkTuner.isOpen());
    petLink.warmup();
    petLink.warmup();
    hotkey();
    check('未取得桌宠资格时重新挂载仍恢复维护面板热键', panels().length === 1 && petLinkTuner.isOpen());
    mod.installHotkey(); mod.installHotkey();
    check('面板安装函数重复执行仅保留一份热键', panels().length === 1 && petLinkTuner.isOpen() && documentStub.handlers.keydown.length === 1);
    hotkey();
    check('一次热键只切换一次开关', !petLinkTuner.isOpen());
    petLinkTuner.open();

    const generations = [mod];
    for (let i = 0; i < 2; i++) {
      const next = loadModule();
      generations.push(next);
      next.petLinkTuner.open();
    }
    const latest = generations.at(-1);
    check('连续加载三代后只保留一个面板与一份全局监听',
      panels().length === 1 && documentStub.handlers.keydown.length === 1 && documentStub.handlers.pointermove.length === 1 && windowStub.handlers.resize.length === 1);
    check('被替换的旧代不再报告面板开启', generations.slice(0, -1).every(item => !item.petLinkTuner.isOpen()));
    for (const item of generations.slice(0, -1)) {
      item.petLink.dispose();
      item.petLink.warmup();
      item.petLinkTuner.open();
    }
    check('旧代延迟卸载或再挂载不会删除或抢占新代面板', panels().length === 1 && latest.petLinkTuner.isOpen() && documentStub.handlers.keydown.length === 1);
    hotkey();
    check('三代加载后热键仍只切换当前面板一次', !latest.petLinkTuner.isOpen() && panels().length === 1);
    latest.petLink.dispose();
    latest.petLink.dispose();
    check('多次卸载可安全重复且不留下监听', panels().length === 0 && listenerCount(documentStub.handlers) === 0 && listenerCount(windowStub.handlers) === 0);

    // 旧英文版没有登记所有者，也没有可调用的匿名热键卸载函数。
    const legacyRoot = makeEl('div');
    legacyRoot.setAttribute('data-pet-tuner', '1');
    documentStub.body.appendChild(legacyRoot);
    let legacyHotkeys = 0;
    const legacyKeydown = () => { legacyHotkeys++; };
    documentStub.addEventListener('keydown', legacyKeydown);
    const upgraded = loadModule();
    check('升级时清除没有所有者登记的旧版遗留面板', panels().length === 0);
    hotkey();
    check('匹配的捕获热键阻止旧版匿名监听再打开旧面板', legacyHotkeys === 0 && panels().length === 1 && upgraded.petLinkTuner.isOpen());
    documentStub.dispatch('keydown', { key: 'x', ctrlKey: true, shiftKey: true });
    check('无关按键仍传给原有监听', legacyHotkeys === 1);
    documentStub.removeEventListener('keydown', legacyKeydown);
    upgraded.petLink.dispose();
    for (const item of generations) item.petLink.dispose();
  }

  // ════════════════════════════════════════════════════════════════════════
  const failed = results.filter((r) => !r).length;
  if (failed > 0) {
    console.log('PET TUNER CHECKS FAILED：' + failed);
    process.exit(1);
  }
  console.log('ALL PET TUNER CHECKS PASSED');
}

main();
