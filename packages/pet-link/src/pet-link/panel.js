/**
 * 桌宠联动 · 浮层操控面板（M6）。
 *
 * 复刻旧版调参浮层并修掉它的短板：
 *  - 浮层形态：右上锚定、标题栏可拖动、`Ctrl+Shift+D` 唤起、Esc 关闭；
 *  - 参数：继承旧的约 50 个参数分组 + 缓动三选一（清单见 panel-params.js）；
 *  - **持久化**：旧版是「本页运行时覆盖、刷新即丢」，本版把覆盖层落到 WE 侧的持久化存储
 *    （`createPetLinkPanelSettings`，默认 localStorage 命名空间键），刷新/重开可回读；
 *  - 导出/导入 JSON：导出 `{version,logic,target,tuning,bubbleTiming}`，导入还原；
 *  - 四个按钮 + 状态行保留；
 *  - a11y：`role=dialog` + `aria-label`、按钮 `type=button`、输入有 `aria-label`/`<label>` 包裹、
 *    分页 `role=tab/aria-selected` + `role=tabpanel`、状态 `role=status/aria-live=polite`、Esc 关闭。
 *
 * 纪律：面板只**读**排播常量、只**写**覆盖层（经 `petLink.tuner.*`），不复制排播逻辑；
 * 「▶ 运行」调的是 `petLink.tuner.run(logic)`，与点击吉祥物走同一条流程。零依赖、零模块语法。
 */

/** 面板持久化的默认适配器：localStorage 命名空间键（WE 侧持久化，刷新不丢）。 */
function createPetLinkPanelSettings(options = {}) {
  const storage = options.storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : options.storage;
  const key = options.key || 'dsh-we-pet-link-panel-v1';
  return {
    key,
    load() {
      try {
        const raw = storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null;
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save(record) {
      try { if (storage && typeof storage.setItem === 'function') storage.setItem(key, JSON.stringify(record)); } catch { /* 私密模式仍可用 */ }
    },
    clear() {
      try { if (storage && typeof storage.removeItem === 'function') storage.removeItem(key); } catch { /* ignore */ }
    },
  };
}

/**
 * 造浮层面板。
 * @param options - { petLink, settings?, document?, window?, translate? }
 * @returns 面板生命周期与控制面。
 */
function createPetLinkPanel(options = {}) {
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const win = options.window || (typeof window !== 'undefined' ? window : null);
  const petLink = options.petLink;
  const translate = options.translate || (value => value);
  const settings = options.settings || createPetLinkPanelSettings({});

  let root = null;
  let statusNode = null;
  let outNode = null;
  let runNode = null;
  let logic = 'sidebar';
  let loaded = false;
  let drag = null;
  let installed = false;
  const inputs = [];
  const pages = {};
  const tabs = {};
  const bubbleSyncs = [];
  const cleanups = [];

  const listen = (target, type, listener, capture = false) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, listener, capture);
    cleanups.push(() => { try { if (typeof target.removeEventListener === 'function') target.removeEventListener(type, listener, capture); } catch { /* ignore */ } });
  };
  const el = (tag, text) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const snapshot = () => petLink.tuner.snapshot();
  const defaultsOf = () => snapshot().defaults || {};
  const valuesOf = lg => (snapshot().logicTuning && snapshot().logicTuning[lg]) || {};
  const validLogic = lg => PETLINK_PANEL_LOGICS.some(item => item.logic === lg);

  const setStatus = text => { if (statusNode) statusNode.textContent = text; };

  /** 持久化当前覆盖层（每次改动后落盘）。 */
  const persist = () => {
    const snap = snapshot();
    settings.save({
      version: 1,
      logic,
      target: snap.target,
      tuning: snap.logicTuning || {},
      bubbleTiming: snap.bubbleTiming || {},
    });
  };

  /** 把一份导入/持久化记录灌回覆盖层。返回是否至少采纳了一条。 */
  const applyRecord = record => {
    if (!record || typeof record !== 'object') return false;
    let applied = false;
    if (typeof record.logic === 'string' && validLogic(record.logic)) { logic = record.logic; applied = true; }
    const tuning = record.tuning || record.logicTuning || {};
    for (const lg of Object.keys(tuning)) {
      if (!validLogic(lg) || !tuning[lg] || typeof tuning[lg] !== 'object') continue;
      for (const key of Object.keys(tuning[lg])) {
        if (petLink.tuner.setForLogic(lg, key, tuning[lg][key])) applied = true;
      }
    }
    const bubble = record.bubbleTiming || {};
    for (const id of Object.keys(bubble)) {
      if (petLink.tuner.setBubbleTiming(id, bubble[id])) applied = true;
    }
    return applied;
  };

  /** 把覆盖层里的当前值写回所有控件（打开、切换逻辑、导入、重置后调用）。 */
  const sync = () => {
    if (!root) return;
    const snap = snapshot();
    const defaults = defaultsOf();
    for (const item of inputs) {
      const values = valuesOf(item.logic);
      const value = values[item.key] !== undefined ? values[item.key] : defaults[item.key];
      item.input.value = String(value === undefined ? 0 : value);
    }
    for (const lg of Object.keys(pages)) {
      pages[lg].style.display = lg === logic ? '' : 'none';
      tabs[lg].setAttribute('aria-selected', String(lg === logic));
    }
    const meta = PETLINK_PANEL_LOGICS.find(item => item.logic === logic);
    if (runNode) runNode.textContent = translate('▶ 运行 ') + (meta ? meta.label : logic);
    for (const syncBubble of bubbleSyncs) syncBubble();
    if (outNode) outNode.value = JSON.stringify({ version: 1, logic, target: snap.target, tuning: snap.logicTuning || {}, bubbleTiming: snap.bubbleTiming || {} }, null, 2);
    refreshStatus();
  };

  /** 状态行：优先反映联动可用性/原因，其次当前逻辑阶段。 */
  const refreshStatus = () => {
    let text;
    try {
      const mode = petLink.mode ? petLink.mode() : 'native';
      const reason = petLink.reason ? petLink.reason() : '';
      const snap = snapshot();
      if (mode !== 'linked') text = (reason ? translate(reason) : translate('联动暂不可用')) + translate('（原生吉祥物）');
      else {
        text = translate('联动可用') + ' · ' + translate('当前逻辑') + ': ' + translate((PETLINK_PANEL_LOGICS.find(item => item.logic === logic) || {}).label || logic) + (snap.busy ? ' · ' + translate('运行中') : '');
        // 显示**运行时实测**的素材可视边界 —— 面板对的是真实数据，不是写死的默认值。
        const ab = snap.alphaBounds;
        if (ab && Number.isFinite(ab.leftRatio) && Number.isFinite(ab.rightRatio)) {
          text += ' · ' + translate('实测可视边界') + ' ' + ab.leftRatio.toFixed(3) + '~' + ab.rightRatio.toFixed(3) + ' (' + ab.videoWidth + '×' + ab.videoHeight + ')';
        } else {
          text += ' · ' + translate('实测可视边界') + ': ' + translate('待测量（运行一次后显示）');
        }
      }
    } catch { text = translate('联动暂不可用'); }
    setStatus(text);
  };

  const styleInput = node => {
    node.style.cssText = 'min-width:0;width:100%;box-sizing:border-box;background:#0d0f14;color:#e8eaf0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:2px 4px;font:inherit';
    return node;
  };

  /** 造一行参数控件（number 或缓动 select）。 */
  const buildFieldRow = (page, field, pageLogic) => {
    const row = el('label');
    row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:8px;align-items:center;margin:3px 0';
    const name = el('span', translate(field.label));
    name.style.cssText = 'min-width:0;overflow-wrap:anywhere;opacity:0.9';
    let input;
    if (field.ease) {
      input = el('select');
      PETLINK_PANEL_EASES.forEach((label, index) => {
        const option = el('option', translate(label));
        option.value = String(index);
        input.appendChild(option);
      });
    } else {
      input = el('input');
      input.type = 'number';
      input.step = String(field.step || 1);
      // 间距类参数**可以是负数**（`edgeGapPx` 默认 -15、`egg1EdgeGapPx` 同理）：
      // 固定 `min = 0` 会让 number 控件连负号都输入不进去（用户反馈"没办法改负数"）。
      input.min = field.key === 'edgeGapPx' || field.key === 'egg1EdgeGapPx' ? '-1000' : '0';
    }
    input.setAttribute('data-pl-field', '');
    input.setAttribute('data-pl-key', field.key);
    input.setAttribute('data-pl-logic', pageLogic);
    input.setAttribute('aria-label', translate(field.label));
    styleInput(input);
    listen(input, field.ease ? 'change' : 'input', () => {
      const value = Number(input.value);
      if (input.value === '' || !Number.isFinite(value)) return;
      if (!petLink.tuner.setForLogic(pageLogic, field.key, value)) {
        // 写值被拒：面板会把输入框弹回旧值（`sync()`），用户看到的就是"改了不生效"。
        // 把具体键与值报到宿主日志，免得只能靠猜。
        try { petLink.reportDiag?.({ kind: 'tune-reject', logic: pageLogic, key: field.key, value }); } catch { /* ignore */ }
        sync(); return;
      }
      persist();
      refreshStatus();
      // ⚠️ 不做"改参数就自动重跑"：那会在每敲一个键时 cancel 当前走位再重启，
      // 走位永远到不了终点（表现就是"手一直贴不上边"）。改完请手动「停止」→「运行」。
      if (outNode) outNode.value = JSON.stringify({ version: 1, logic, target: snapshot().target, tuning: snapshot().logicTuning || {}, bubbleTiming: snapshot().bubbleTiming || {} }, null, 2);
    });
    inputs.push({ key: field.key, logic: pageLogic, field, input });
    row.appendChild(name);
    row.appendChild(input);
    page.appendChild(row);
  };

  /** 造一个气泡时间节点编辑器（出现/隐藏：动作 + 起止锚点 + 偏移）。 */
  const buildBubbleEditor = (page, spec) => {
    const section = el('section');
    section.setAttribute('data-pl-bubble', '');
    section.setAttribute('data-pl-bubble-id', spec.id);
    section.style.cssText = 'margin:10px 0 4px';
    const heading = el('div', spec.logic === 'egg1' ? translate('气泡时间节点') : translate('气泡时间节点'));
    heading.style.cssText = 'margin:6px 0 4px;color:#ffd479;font-weight:700';
    section.appendChild(heading);
    const controls = {};
    const styleSelect = node => { node.style.cssText = 'min-width:0;box-sizing:border-box;background:#0d0f14;color:#e8eaf0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:2px 4px;font:inherit'; return node; };
    const option = (select, value, text) => { const o = el('option', text); o.value = value; select.appendChild(o); };
    for (const kind of ['show', 'hide']) {
      const row = el('div');
      row.style.cssText = 'display:grid;grid-template-columns:44px minmax(0,1fr) 64px 70px;gap:4px;align-items:center;margin:4px 0';
      row.appendChild(el('span', kind === 'show' ? translate('出现') : translate('隐藏')));
      const action = el('select'); action.setAttribute('data-pl-bubble-action', kind); action.setAttribute('aria-label', (kind === 'show' ? translate('出现') : translate('隐藏')) + ' · ' + translate('动作节点')); styleSelect(action);
      const edge = el('select'); edge.setAttribute('data-pl-bubble-edge', kind); edge.setAttribute('aria-label', (kind === 'show' ? translate('出现') : translate('隐藏')) + ' · ' + translate('开始或结束')); styleSelect(edge);
      option(edge, 'start', translate('开始')); option(edge, 'end', translate('结束'));
      const offset = el('input'); offset.type = 'number'; offset.step = '50'; offset.setAttribute('data-pl-bubble-offset', kind); offset.setAttribute('aria-label', (kind === 'show' ? translate('出现') : translate('隐藏')) + ' · ' + translate('偏移（毫秒）')); styleInput(offset);
      row.appendChild(action); row.appendChild(edge); row.appendChild(offset);
      section.appendChild(row);
      controls[kind] = { action, edge, offset };
      const update = () => {
        const previous = (snapshot().bubbleTiming || {})[spec.id] || {};
        const rule = { action: action.value, edge: edge.value, offsetMs: Number(offset.value) };
        const config = { ...previous };
        if (action.value === 'default' || !Number.isFinite(rule.offsetMs)) delete config[kind];
        else config[kind] = rule;
        if (!petLink.tuner.setBubbleTiming(spec.id, config)) return;
        persist(); refreshStatus();
      };
      for (const node of [action, edge, offset]) listen(node, 'change', update);
    }
    const syncBubble = () => {
      const rules = (snapshot().bubbleTiming || {})[spec.id] || {};
      for (const kind of ['show', 'hide']) {
        const c = controls[kind];
        for (const old of [...c.action.children]) old.remove();
        option(c.action, 'default', translate('保持默认'));
        if (kind === 'hide') option(c.action, 'duration', translate('按显示时长'));
        for (const key of Object.keys(PETLINK_ANIM)) option(c.action, key, key);
        const rule = rules[kind];
        c.action.value = rule ? rule.action : 'default';
        c.edge.value = rule ? rule.edge : 'start';
        c.offset.value = String(rule ? rule.offsetMs : 0);
        c.edge.disabled = !rule || rule.action === 'default' || rule.action === 'duration';
        c.offset.disabled = !rule || rule.action === 'default';
      }
    };
    page.appendChild(section);
    bubbleSyncs.push(syncBubble);
  };

  const clampPosition = (left, top) => {
    const rect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
    const width = rect && rect.width ? rect.width : 430;
    const height = rect && rect.height ? rect.height : 400;
    const maxX = (win && win.innerWidth ? win.innerWidth : 1280) - width - 8;
    const maxY = (win && win.innerHeight ? win.innerHeight : 800) - height - 8;
    root.style.right = 'auto';
    root.style.left = Math.max(8, Math.min(left, maxX)) + 'px';
    root.style.top = Math.max(8, Math.min(top, maxY)) + 'px';
  };

  const build = () => {
    if (root || !doc || !doc.body) return root;
    root = el('div');
    root.setAttribute('data-pl', 'panel');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', translate('桌宠联动调参'));
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('tabindex', '-1');
    root.style.cssText = [
      'position:fixed', 'right:16px', 'top:16px', 'z-index:2147483600',
      'width:440px', 'max-width:calc(100vw - 16px)', 'box-sizing:border-box',
      'max-height:min(88vh,calc(100dvh - 16px))', 'overflow:auto',
      'background:rgba(18,20,26,0.97)', 'color:#e8eaf0',
      'border:1px solid rgba(255,255,255,0.18)', 'border-radius:10px',
      'padding:12px 14px', 'font:12px/1.6 ui-monospace,Consolas,monospace',
      'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
    ].join(';');

    // 标题栏（可拖动 + 关闭按钮）
    const title = el('h2', translate('桌宠联动调参'));
    title.setAttribute('data-pl', 'title');
    title.style.cssText = 'font-size:13px;font-weight:700;margin:0 0 8px;color:#8fd0ff;cursor:move;touch-action:none;user-select:none;position:sticky;top:0;background:#12141a;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px';
    const titleText = el('span', translate('桌宠联动调参'));
    title.textContent = '';
    title.appendChild(titleText);
    const closeBtn = el('button', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('data-pl', 'close');
    closeBtn.setAttribute('aria-label', translate('关闭面板'));
    closeBtn.style.cssText = 'min-width:32px;min-height:32px;background:#2a2a2a;color:#ddd;border:1px solid rgba(255,255,255,0.22);border-radius:5px;cursor:pointer;font:inherit';
    // 关闭按钮的 pointerdown 必须拦住，不让它冒泡到标题栏的拖动监听：
    // 那个监听会 `preventDefault()`，把随后的 click 吞掉 ⇒ 表现为"点关闭变成拖动"。
    listen(closeBtn, 'pointerdown', event => {
      if (event.stopPropagation) event.stopPropagation();
    });
    listen(closeBtn, 'click', () => close());
    title.appendChild(closeBtn);
    root.appendChild(title);
    listen(title, 'pointerdown', event => {
      // 双保险：从关闭按钮上按下时一律不启动拖动（不依赖 stopPropagation 是否被尊重）。
      if (event.target && typeof event.target.closest === 'function' && event.target.closest('[data-pl="close"]')) return;
      if (drag || (event.button !== undefined && event.button !== 0)) return;
      const rect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : { left: 16, top: 16 };
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      if (typeof title.setPointerCapture === 'function') { try { title.setPointerCapture(event.pointerId); } catch { /* ignore */ } }
      if (typeof event.preventDefault === 'function') event.preventDefault();
    });
    const moveDrag = event => {
      if (!drag || event.pointerId !== drag.id) return;
      clampPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    };
    listen(title, 'pointermove', moveDrag);
    listen(doc, 'pointermove', moveDrag);
    const endDrag = event => { if (drag && event.pointerId === drag.id) drag = null; };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(title, type, endDrag);

    // 状态行
    statusNode = el('div');
    statusNode.setAttribute('data-pl', 'status');
    statusNode.setAttribute('role', 'status');
    statusNode.setAttribute('aria-live', 'polite');
    statusNode.style.cssText = 'margin:6px 0;line-height:1.5;overflow-wrap:anywhere;color:#ffd479';
    root.appendChild(statusNode);

    // 运行 / 停止 / 逻辑页签
    const navigation = el('div');
    navigation.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:8px 0';
    const buttonStyle = 'min-width:0;min-height:40px;box-sizing:border-box;background:#1d2b3a;color:#cfe6ff;border:1px solid rgba(255,255,255,0.22);border-radius:5px;padding:5px 8px;cursor:pointer;font:inherit;white-space:normal';
    runNode = el('button');
    runNode.type = 'button';
    runNode.setAttribute('data-pl', 'run');
    runNode.style.cssText = buttonStyle;
    listen(runNode, 'click', () => {
      const result = petLink.tuner.run(logic);
      if (result && typeof result.then === 'function') result.then(value => { setStatus(translate('已完成') + (value && value.phase ? ' (' + value.phase + ')' : '')); sync(); }).catch(() => setStatus(translate('联动暂不可用')));
    });
    navigation.appendChild(runNode);
    const stopBtn = el('button', translate('■ 停止'));
    stopBtn.type = 'button';
    stopBtn.setAttribute('data-pl', 'stop');
    stopBtn.style.cssText = buttonStyle + ';background:#3a1d1d;color:#ffd0d0';
    listen(stopBtn, 'click', () => { if (petLink.tuner.cancel) petLink.tuner.cancel(); setStatus(translate('已停止')); refreshStatus(); });
    navigation.appendChild(stopBtn);
    root.appendChild(navigation);

    const tabBar = el('div');
    tabBar.setAttribute('role', 'tablist');
    tabBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:8px 0';
    for (const item of PETLINK_PANEL_LOGICS) {
      const tab = el('button', translate(item.name) + ' · ' + translate(item.label));
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('data-pl', 'tab');
      tab.setAttribute('data-pl-tab-logic', item.logic);
      tab.setAttribute('aria-controls', 'pet-link-panel-page-' + item.logic);
      tab.setAttribute('aria-selected', 'false');
      tab.style.cssText = buttonStyle + ';background:#24272e;color:#ddd';
      listen(tab, 'click', () => { logic = item.logic; sync(); });
      tabs[item.logic] = tab;
      tabBar.appendChild(tab);
    }
    root.appendChild(tabBar);

    // 每个逻辑一页
    for (const item of PETLINK_PANEL_LOGICS) {
      const page = el('section');
      page.setAttribute('role', 'tabpanel');
      page.setAttribute('id', 'pet-link-panel-page-' + item.logic);
      page.setAttribute('aria-label', translate(item.name));
      pages[item.logic] = page;
      root.appendChild(page);
      let lastGroup = '';
      for (const field of petLinkPanelFieldsFor(item.logic)) {
        if (field.group !== lastGroup) {
          const h = el('div', translate(field.group));
          h.style.cssText = 'margin:10px 0 4px;color:#ffd479;font-weight:700';
          page.appendChild(h);
          lastGroup = field.group;
        }
        buildFieldRow(page, field, item.logic);
      }
      for (const spec of PETLINK_BUBBLE_SPECS.filter(spec => spec.logic === item.logic)) buildBubbleEditor(page, spec);
    }

    // 四个按钮：重置当前逻辑 / 导出 JSON / 导入 JSON（+ 停止已在上面）
    const tools = el('div');
    tools.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:10px 0';
    const resetCurrent = el('button', translate('重置当前逻辑'));
    resetCurrent.type = 'button';
    resetCurrent.setAttribute('data-pl', 'reset');
    resetCurrent.style.cssText = buttonStyle + ';background:#302d23;color:#ffe5af';
    listen(resetCurrent, 'click', () => { petLink.tuner.reset(logic); sync(); persist(); });
    tools.appendChild(resetCurrent);
    const exportBtn = el('button', translate('导出 JSON'));
    exportBtn.type = 'button';
    exportBtn.setAttribute('data-pl', 'export');
    exportBtn.style.cssText = buttonStyle + ';background:#1d3a24;color:#d0ffd8';
    listen(exportBtn, 'click', () => {
      if (!outNode) return;
      outNode.value = JSON.stringify({ version: 1, logic, target: snapshot().target, tuning: snapshot().logicTuning || {}, bubbleTiming: snapshot().bubbleTiming || {} }, null, 2);
      if (typeof outNode.focus === 'function') outNode.focus();
      if (typeof outNode.select === 'function') outNode.select();
      setStatus(translate('已导出 JSON'));
    });
    tools.appendChild(exportBtn);
    const importBtn = el('button', translate('导入 JSON'));
    importBtn.type = 'button';
    importBtn.setAttribute('data-pl', 'import');
    importBtn.style.cssText = buttonStyle + ';background:#1d2b3a;color:#cfe6ff';
    listen(importBtn, 'click', () => {
      let record = null;
      try { record = JSON.parse(outNode && outNode.value ? outNode.value : 'null'); } catch { record = null; }
      const ok = applyRecord(record);
      sync(); if (ok) persist();
      setStatus(ok ? translate('已导入 JSON') : translate('导入失败：JSON 结构不正确'));
    });
    tools.appendChild(importBtn);
    root.appendChild(tools);

    outNode = el('textarea');
    outNode.setAttribute('data-pl', 'out');
    outNode.setAttribute('aria-label', translate('当前调参 JSON'));
    outNode.rows = 10;
    outNode.style.cssText = 'width:100%;background:#0d0f14;color:#bfe3ff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:4px;box-sizing:border-box';
    root.appendChild(outNode);

    // Esc 关闭
    listen(doc, 'keydown', event => {
      if (event && String(event.key) === 'Escape' && isOpen()) { close(); }
    });

    doc.body.appendChild(root);
    sync();
    return root;
  };

  const isOpen = () => Boolean(root && root.style.display !== 'none');

  const open = () => {
    build();
    if (!root) return false;
    if (!loaded) {
      loaded = true;
      const record = settings.load();
      if (record) applyRecord(record);
    }
    root.style.display = '';
    sync();
    clampPosition(parseFloat(root.style.left) || 16, parseFloat(root.style.top) || 16);
    const focusable = runNode || root;
    if (focusable && typeof focusable.focus === 'function') { try { focusable.focus(); } catch { /* ignore */ } }
    return true;
  };
  const close = () => { if (root) { root.style.display = 'none'; drag = null; } return false; };
  const toggle = () => (isOpen() ? close() : open());

  const install = () => {
    if (installed || !doc || typeof doc.addEventListener !== 'function') return false;
    installed = true;
    listen(doc, 'keydown', event => {
      if (!event || !event.ctrlKey || !event.shiftKey) return;
      if (String(event.key || '').toLowerCase() !== 'd') return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      toggle();
    }, true);
    return true;
  };

  const dispose = () => {
    installed = false;
    drag = null;
    for (const cleanup of cleanups.splice(0)) cleanup();
    if (root && typeof root.remove === 'function') root.remove();
    root = null; statusNode = null; outNode = null; runNode = null;
    inputs.length = 0; bubbleSyncs.length = 0;
    for (const lg of Object.keys(pages)) delete pages[lg];
    for (const lg of Object.keys(tabs)) delete tabs[lg];
  };

  return {
    open, close, toggle, isOpen,
    install, dispose,
    /** 供夹具/诊断读的当前面板值（与 tuner 快照一致）。 */
    snapshot,
    setLogic(next) { if (validLogic(next)) { logic = next; sync(); } return logic; },
    currentLogic: () => logic,
    persist,
    applyRecord,
  };
}
