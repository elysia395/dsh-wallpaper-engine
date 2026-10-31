/**
 * 桌宠联动 · 设置页「扩展模块」卡片（M7）。
 *
 * 由 pet-link 浏览器半注册进主包注册表（`weRegisterExtensionModule`，order:0 → 排在
 * avatar=1 / fx=2 / parallax=3 之前），主包**枚举逻辑零改动**。
 *
 * 分工（守住 extension-registry 契约）：
 *  - `petLinkCardView(snapshot, card, translate)` 是**纯视图**：只知道「当前快照 + 具名处理器」，
 *    返回一个可序列化的描述树（tag/attrs/children/on）。它**不发请求、不写设置、不持状态**，
 *    也不碰主包 store；事件回调只是转调 `card.*` 这些具名处理器。
 *  - `createPetLinkExtensionCard(deps)` 是**具名处理器**：`refresh / install / toggleEnabled /
 *    openPanel / testOnce` 全部走宿主半 HTTP 路由（/pet-link/pet/state；install 系列已随下载器移除）
 *    或已注册的 panel/petLink 服务；不写主包设置、不发通知、不碰主包 store。
 *
 * 状态（安装态 / 版本 / 运行中 / 官方共存 / 安装进度 / 失败块）由控制器（本模块单例的 `state`）
 * 持有，卡片只是它的只读快照的渲染；这既让「五种态」可复现，也把副作用挡在视图之外。
 *
 * 视觉分层（自上而下，间距由样式表统一，见 src/styles-ext.js 的 we-pet-link 段）：
 *   标题行（联动 + 开关）→ 状态行 → 联动模式 → 共存提示 → **卡片内进度条** → **失败块**
 *   → 主按钮 → 次按钮组（面板 / 测试）→ 分步进度 → 折叠诊断。
 *
 * 进度条（下载进度可视化）：POST /install 在途期间，控制器轮询只读端点
 * done 后进度条**不渲染**（不留空行）；error 时改渲染失败块（包名 / 已尝试的源 / 官方地址）。
 */

/** 从 installer.state() 的形状合并进控制器状态（容错：字段缺失不抛）。 */
function petLinkCardApplyState(state, data) {
  if (!data || typeof data !== 'object') return;
  if (data.installed !== undefined) state.installed = data.installed === true;
  if (typeof data.version === 'string') state.version = data.version;
  if (typeof data.path === 'string') state.path = data.path;
  if (data.running !== undefined) state.running = data.running === true;
  if (data.officialPet !== undefined) state.officialPet = data.officialPet === true;
  if (data.conflict !== undefined) state.conflict = data.conflict === true;
  state.checking = false;
}

/** 从 petLink 服务读联动模式与降级原因。 */
function petLinkCardReadMode(state, petLink) {
  try { state.mode = petLink.mode ? petLink.mode() : 'native'; } catch { state.mode = 'native'; }
  try { state.reason = petLink.reason ? petLink.reason() : ''; } catch { state.reason = ''; }
}

/** 失败兜底常量：与宿主侧 installer 的 RUNTIME_NAME / OFFICIAL_PACKAGE_URL 同源（t1）。 */
const PET_LINK_CARD_PACKAGE = 'dshpet-dshwe';
const PET_LINK_CARD_OFFICIAL_URL = 'https://www.npmjs.com/package/dshpet-dshwe';

/**
 * 图文安装引导的内容行（纯函数，组件与回退路径共用）。
 * @param t - 词表
 * @param card - 具名处理器（用 guideImageUrl / copyPackage）
 * @param copied - 是否刚复制过（决定按钮文案）
 * @returns {Array} 描述树子节点
 */
function petLinkGuideRows(t, card, copied) {
  const rows = [];
  const steps = [
    t('① 左侧栏点「插件」'),
    t('② 右上角点「+ 添加插件」'),
    t('③ 输入包名后点「安装」'),
  ];
  rows.push({ tag: 'div', attrs: { className: 'we-pet-link__guide-title' }, children: [t('三步装好联动桌宠')] });
  for (let i = 0; i < steps.length; i += 1) {
    const src = card && typeof card.guideImageUrl === 'function' ? card.guideImageUrl(i + 1) : '';
    rows.push({
      tag: 'div',
      attrs: { className: 'we-pet-link__guide-step' },
      children: [
        { tag: 'div', attrs: { className: 'we-pet-link__guide-caption' }, children: [steps[i]] },
        src
          ? { tag: 'img', attrs: { className: 'we-pet-link__guide-shot', src, alt: steps[i], loading: 'lazy' } }
          : {
              tag: 'div',
              attrs: { className: 'we-pet-link__guide-shot we-pet-link__guide-shot--pending', 'data-pet-link': 'guide-pending' },
              children: [t('截图加载中…')],
            },
      ],
    });
  }
  rows.push({
    tag: 'div',
    attrs: { className: 'we-pet-link__guide-pkg' },
    children: [
      { tag: 'code', attrs: { className: 'we-pet-link__guide-code' }, children: [PET_LINK_CARD_PACKAGE] },
      {
        tag: 'button',
        attrs: { type: 'button', className: 'we-pet-link__guide-copy', 'data-pet-link': 'copy-package', 'aria-label': t('复制包名') },
        children: [copied ? t('已复制') : t('复制包名')],
        on: { onClick: () => card.copyPackage() },
      },
    ],
  });
  rows.push({
    tag: 'div',
    attrs: { className: 'we-pet-link__guide-tip' },
    children: [t('安装时请复制上面的包名粘贴进去；也可在 npm 页面手动下载。')],
  });
  rows.push({
    tag: 'a',
    attrs: { className: 'we-pet-link__guide-link', href: PET_LINK_CARD_OFFICIAL_URL, target: '_blank', rel: 'noopener noreferrer' },
    children: [PET_LINK_CARD_OFFICIAL_URL],
  });
  return rows;
}

/**
 * 造一张卡片描述树（纯视图）。
 * @param {object} snapshot - 控制器状态快照。
 * @param {object} card - 具名处理器集合。
 * @param {Function} translate - 词表。
 * @returns {{tag:string, attrs:object, children:Array}} 描述树。
 */
function petLinkCardView(snapshot, card, translate = value => value) {
  const t = translate;
  const s = snapshot || {};
  const children = [];

  // 标题行：联动名 + 开关（开关推到行尾）
  const switchInput = {
    tag: 'input',
    attrs: { type: 'checkbox', role: 'switch', 'aria-label': t('启用桌宠联动'), 'data-pet-link': 'switch', checked: s.linkEnabled !== false },
    children: [],
    on: { onChange: event => card.toggleEnabled(Boolean(event && event.target && event.target.checked)) },
  };
  children.push({
    tag: 'label',
    attrs: { className: 'we-pet-link__head' },
    children: [{ tag: 'span', attrs: {}, children: [t('桌宠联动')] }, switchInput],
  });

  // 状态行：安装态 / 版本 / 运行中 / 失败摘要（aria-live 即时播报）
  let status;
  if (s.phase === 'installing') status = t('正在下载并安装 dshpet-dshwe…');
  else if (s.phase === 'failed') status = t('安装 / 更新失败') + ': ' + (s.error || t('未知原因'));
  else if (s.checking && s.installed !== true) status = t('正在检测运行时…');
  else if (s.installed === true) status = t('已安装') + ' v' + (s.version || '?') + (s.running ? ' (' + t('运行中') + ')' : '');
  else status = t('未安装');
  children.push({ tag: 'div', attrs: { className: 'we-pet-link__status', role: 'status', 'aria-live': 'polite', 'data-pet-link': 'status' }, children: [status] });

  // 联动模式 / 版本过旧
  if (s.installed === true || s.mode) {
    let modeText;
    if (s.reason === 'runtime-too-old') modeText = t('运行时版本过旧（需升级 dshpet-dshwe）');
    else if (s.mode === 'linked') modeText = t('联动已就绪（linked）');
    else modeText = t('当前回落原生吉祥物（native）') + (s.reason ? ' · ' + t(s.reason) : '');
    children.push({ tag: 'div', attrs: { className: 'we-pet-link__mode', 'data-pet-link': 'mode' }, children: [modeText] });
  }

  // 官方 dsh-pet 共存提示
  if (s.officialPet === true) {
    children.push({ tag: 'div', attrs: { className: 'we-pet-link__coexist', role: 'note', 'data-pet-link': 'coexist' }, children: [t('检测到官方 dsh-pet：两者会各显示一只，互不接管。')] });
  }

  // 卡片内进度条：仅安装中且轮询到了有效阶段时渲染；done 后不渲染（不留空行）。
  const progress = s.progress && typeof s.progress === 'object' ? s.progress : null;
  if (s.phase === 'installing' && progress && ['downloading', 'verifying', 'installing'].includes(progress.state)) {
    const stageText = progress.state === 'downloading' ? t('正在下载…')
      : (progress.state === 'verifying' ? t('正在校验…') : t('正在安装…'));
    const labelLeft = stageText + (progress.source ? ' · ' + t('下载源') + ': ' + progress.source : '');
    const pct = typeof progress.percent === 'number' && Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, Math.round(progress.percent))) : null;
    children.push({
      tag: 'div',
      attrs: {
        className: 'we-pet-link__progress', 'data-pet-link': 'progress',
        role: 'progressbar', 'aria-label': t('安装进度'), 'aria-valuemin': '0', 'aria-valuemax': '100',
        ...(pct !== null ? { 'aria-valuenow': String(pct) } : {}),
      },
      children: [
        { tag: 'div', attrs: { className: 'we-pet-link__progress-label' }, children: [
          { tag: 'span', attrs: {}, children: [labelLeft] },
          { tag: 'span', attrs: {}, children: [pct !== null ? pct + '%' : ''] },
        ] },
        { tag: 'div', attrs: { className: 'we-pet-link__progress-bar' }, children: [
          { tag: 'div', attrs: { className: 'we-pet-link__progress-fill' + (pct !== null ? '' : ' we-pet-link__progress-fill--indeterminate'), style: pct !== null ? { width: pct + '%' } : undefined }, children: [] },
        ] },
      ],
    });
  }

  // 失败块：包名 + 已尝试的源（结构化体）+ 官方地址（新开页 + noopener）；无结构化体时给包名与官方地址兜底。
  if (s.phase === 'failed') {
    const fail = s.failBlock && typeof s.failBlock === 'object' ? s.failBlock : null;
    const pkg = (fail && typeof fail.package === 'string' && fail.package) || PET_LINK_CARD_PACKAGE;
    const officialUrl = (fail && typeof fail.officialUrl === 'string' && fail.officialUrl) || PET_LINK_CARD_OFFICIAL_URL;
    const failRows = [
      { tag: 'div', attrs: { className: 'we-pet-link__fail-title' }, children: [t('安装 / 更新失败') + ': ' + (s.error || t('未知原因'))] },
      { tag: 'div', attrs: {}, children: [t('包名') + ': ' + pkg] },
    ];
    if (fail && Array.isArray(fail.sources) && fail.sources.length > 0) {
      failRows.push({
        tag: 'div',
        attrs: {},
        children: [t('已尝试的下载源') + ': ' + fail.sources.map(src => String((src && src.source) || 'unknown')
          + (src && src.error ? ' (' + String(src.error) + ')' : '')).join(' · ')],
      });
    }
    if (fail) failRows.push({ tag: 'div', attrs: {}, children: [t('双源均失败，可从官方地址手动安装')] });
    failRows.push({ tag: 'a', attrs: { className: 'we-pet-link__fail-link', href: officialUrl, target: '_blank', rel: 'noopener noreferrer' }, children: [officialUrl] });
    children.push({ tag: 'div', attrs: { className: 'we-pet-link__fail', role: 'note', 'data-pet-link': 'fail-block' }, children: failRows });
  }

  // 主按钮 + 图文引导面板。
  // 2026-11-01：本插件**不再自己下载安装**（自研下载器绕过 DSH 依赖管理，会与 link: 布局
  // 冲突，曾造成重复注册 / 误判未安装 / 启动崩溃）。改为引导用户走 DSH 官方入口，
  // 面板里给三步截图 + 包名 + 一键复制。
  const installing = false; // 下载器已拆：不再有安装中状态
  // 引导面板优先用 **React 组件**：它自带 useState，点击只重画自己。
  // 为什么必须这么做：宿主的 render(ctx) 是内联调用、**不订阅**我们的 notify()，
  // 纯快照驱动的展开/收起要等宿主因别的原因重画才生效（实测「点半天没反应」）。
  const GuidePanelComp = card && typeof card.guidePanel === 'function' ? card.guidePanel : null;
  if (typeof GuidePanelComp === 'function') {
    children.push({ tag: GuidePanelComp, attrs: {}, children: [] });
  } else {
    // 回退路径（无 React 的测试环境）：仍按快照里的 guideOpen 渲染静态结构。
    const guideOpen = Boolean(s.guideOpen);
    const installLabel = guideOpen ? t('收起安装说明') : t('如何下载安装联动桌宠');
    children.push({
      tag: 'button',
      attrs: {
        type: 'button',
        className: 'we-pet-link__install',
        'data-pet-link': 'install-guide',
        'aria-label': installLabel,
        'aria-expanded': guideOpen ? 'true' : 'false',
      },
      children: [installLabel],
      on: { onClick: () => card.toggleGuide() },
    });
    if (guideOpen) {
      children.push({
        tag: 'div',
        attrs: { className: 'we-pet-link__guide', 'data-pet-link': 'install-guide-panel' },
        children: petLinkGuideRows(t, card, s.copied === true),
      });
    }
  }

  // 次按钮组：打开操控面板 + 测试一次（并排）
  children.push({
    tag: 'div',
    attrs: { className: 'we-pet-link__actions' },
    children: [
      {
        tag: 'button',
        attrs: { type: 'button', className: 'we-pet-link__panel', 'data-pet-link': 'open-panel', 'aria-label': t('打开操控面板') },
        children: [t('打开操控面板（Ctrl+Shift+D）')],
        on: { onClick: () => card.openPanel() },
      },
      {
        tag: 'button',
        attrs: { type: 'button', className: 'we-pet-link__test', 'data-pet-link': 'test-once', 'aria-label': t('测试一次联动'), disabled: installing },
        children: [t('测试一次联动')],
        on: { onClick: () => card.testOnce() },
      },
    ],
  });

  // 分步进度
  if (Array.isArray(s.steps) && s.steps.length > 0) {
    children.push({
      tag: 'ol',
      attrs: { className: 'we-pet-link__steps', 'data-pet-link': 'steps' },
      children: s.steps.map((step, index) => ({
        tag: 'li',
        attrs: { 'data-step': String(step && step.step ? step.step : index), 'data-ok': String(!(step && step.ok === false)) },
        children: [String((step && step.step) || ('#' + (index + 1))) + (step && step.ok === false ? ' (' + ((step && step.reason) || t('失败')) + ')' : '')],
      })),
    });
  }

  // 折叠诊断
  children.push({
    tag: 'details',
    attrs: { className: 'we-pet-link__diag', 'data-pet-link': 'diag' },
    children: [
      { tag: 'summary', attrs: {}, children: [t('诊断')] },
      { tag: 'pre', attrs: {}, children: [JSON.stringify({ mode: s.mode || null, reason: s.reason || '', installed: s.installed === true, version: s.version || '', path: s.path || '', running: s.running === true, officialPet: s.officialPet === true, phase: s.phase || 'idle', error: s.error || '', steps: s.steps || [] }, null, 2)] },
    ],
  });

  return { tag: 'div', attrs: { className: 'we-pet-link__card', 'data-pet-link': 'card' }, children };
}

/** 描述树 → React 元素（只用注入的 h，不直接碰 React）。 */
function petLinkCardToReact(node, h) {
  if (node === null || node === undefined || node === false) return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(child => petLinkCardToReact(child, h));
  const props = { ...(node.attrs || {}) };
  if (node.on) for (const key of Object.keys(node.on)) props[key] = node.on[key];
  const children = (node.children || []).map(child => petLinkCardToReact(child, h));
  return h(node.tag, props, ...children);
}

/**
 * 造卡片控制器 + 描述符。
 * @param deps - { h, petLink, panel, apiFetch, apiUrl, translate, setLinkEnabled? }
 * @returns {{ descriptor, snapshot, subscribe, refresh, install, toggleEnabled, openPanel, testOnce, _state }}
 */
function createPetLinkExtensionCard(deps = {}) {
  const translate = deps.translate || (value => value);
  const state = {
    linkEnabled: true,
    checking: true,
    installed: null,
    version: '',
    path: '',
    running: false,
    officialPet: false,
    conflict: false,
    mode: 'native',
    reason: '',
    phase: 'idle',
    steps: [],
    error: '',
    progress: null,
    failBlock: null,
    // 图文安装引导的本地 UI 状态（不持久化、不发请求）
    guideOpen: false,
    copied: false,
    // 拼引导图 URL 用：来自宿主端口，空串时图会 404（可接受，不阻塞卡片）
    guideOrigin: '',
  };
  const listeners = new Set();
  const notify = () => { for (const listener of [...listeners]) { try { listener(); } catch { /* 渲染监听失败不影响流程 */ } } };
  const subscribe = fn => { if (typeof fn !== 'function') return () => {}; listeners.add(fn); return () => listeners.delete(fn); };
  const snapshot = () => ({
    ...state,
    // 引导图 URL 前缀：优先用页面 origin（同源路由），取不到就留空
    guideOrigin: (() => {
      try {
        if (typeof location !== 'undefined' && typeof location.origin === 'string') return location.origin;
      } catch { /* 非浏览器环境 */ }
      return state.guideOrigin || '';
    })(),
    steps: state.steps.map(step => ({ ...step })),
    progress: state.progress ? { ...state.progress } : null,
    failBlock: state.failBlock ? JSON.parse(JSON.stringify(state.failBlock)) : null,
  });

  const readMode = () => petLinkCardReadMode(state, deps.petLink);

  const refresh = async () => {
    try {
      const res = await deps.apiFetch(deps.apiUrl('/pet-link/pet/state'));
      petLinkCardApplyState(state, res && res.data ? res.data : null);
    } catch (error) {
      state.checking = false;
      state.error = String((error && error.message) || error || '');
    }
    readMode();
    notify();
    return snapshot();
  };

  const toggleEnabled = on => {
    state.linkEnabled = on === true;
    if (typeof deps.setLinkEnabled === 'function') { try { deps.setLinkEnabled(state.linkEnabled); } catch { /* ignore */ } }
    readMode();
    notify();
    return state.linkEnabled;
  };

  const openPanel = () => {
    if (deps.panel && typeof deps.panel.toggle === 'function') return deps.panel.toggle();
    return false;
  };

  const testOnce = async () => {
    let result = null;
    try {
      if (deps.petLink && deps.petLink.mascot && typeof deps.petLink.mascot.tap === 'function') result = await deps.petLink.mascot.tap();
    } catch { result = null; }
    readMode();
    notify();
    return result;
  };

  /** 展开/收起图文安装说明（纯本地 UI 状态，不发请求）。 */
  const toggleGuide = () => {
    state.guideOpen = !state.guideOpen;
    state.copied = false;
    notify();
    if (state.guideOpen) {
      // 展开时才拉图（首次点击立刻返回，不等网络）；图到位后补一次重渲染。
      try { deps.ensureGuideShots?.(); } catch { /* 预取失败只影响图片 */ }
      for (const delay of [400, 1200, 2600]) {
        setTimeout(() => { if (state.guideOpen) notify(); }, delay);
      }
    }
    return state.guideOpen;
  };

  /** 复制包名到剪贴板；失败时退回「手动复制」提示（不抛错）。 */
  const copyPackage = async () => {
    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText('dshpet-dshwe');
        ok = true;
      }
    } catch { ok = false; }
    state.copied = ok;
    notify();
    return ok;
  };

  /**
   * 引导面板组件：自带 useState，点击立刻重画自己（不依赖宿主重渲染）。
   * 返回 null 表示当前环境没有 React（测试里的 new Function 加载）⇒ 走纯视图回退。
   */
  const guidePanel = (() => {
    const R = deps.React;
    if (!R || typeof R.useState !== 'function' || typeof R.createElement !== 'function') return null;
    return function PetLinkGuidePanel() {
      const [open, setOpen] = R.useState(false);
      const [copied, setCopied] = R.useState(false);
      const onToggle = () => {
        const next = !open;
        setOpen(next);
        setCopied(false);
        if (next) { try { deps.ensureGuideShots?.(); } catch { /* 预取失败只影响图片 */ } }
      };
      const onCopy = async () => {
        const ok = await copyPackage();
        setCopied(ok);
      };
      const api2 = {
        guideImageUrl: step => (typeof deps.guideImageUrl === 'function' ? deps.guideImageUrl(step) : ''),
        copyPackage: onCopy,
      };
      const head = R.createElement('button', {
        type: 'button',
        className: 'we-pet-link__install',
        'data-pet-link': 'install-guide',
        'aria-label': translate(open ? '收起安装说明' : '如何下载安装联动桌宠'),
        'aria-expanded': open ? 'true' : 'false',
        onClick: onToggle,
      }, translate(open ? '收起安装说明' : '如何下载安装联动桌宠'));
      const panel = open
        ? R.createElement('div', { className: 'we-pet-link__guide', 'data-pet-link': 'install-guide-panel' },
            ...petLinkGuideRows(translate, api2, copied).map((node, i) => petLinkCardToReact(node, deps.h, i)))
        : null;
      return R.createElement(R.Fragment || 'div', null, head, panel);
    };
  })();

  const api = { snapshot, subscribe, refresh, toggleEnabled, openPanel, testOnce, toggleGuide, copyPackage, guideImageUrl: step => (typeof deps.guideImageUrl === 'function' ? deps.guideImageUrl(step) : ''), guidePanel };

  const descriptor = {
    id: 'pet-link',
    order: 0,
    get title() { return translate('桌宠联动'); },
    get desc() { return translate('把壁纸吉祥物换成可联动的桌宠，或回到原生吉祥物'); },
    render(ctx) {
      // 纯视图：只把「当前快照 + 具名处理器」翻成 React 元素；不发请求、不写设置、不持状态。
      return petLinkCardToReact(petLinkCardView(snapshot(), api, translate), deps.h);
    },
  };

  return {
    descriptor,
    snapshot,
    subscribe,
    refresh,
    toggleEnabled,
    openPanel,
    testOnce,
    toggleGuide,
    copyPackage,
    _state: state,
  };
}
