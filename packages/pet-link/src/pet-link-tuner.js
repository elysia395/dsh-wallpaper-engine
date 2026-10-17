/**
 * pet-link-tuner.js —— 桌宠联动的**页内调参面板**（用户口径 2026-10-15：
 * 「创建一个可以方便调数值互动的东西，这样我可以决定什么时候播放什么动画、播放多久」）。
 *
 * 定位：这是**调试工具**，不是产品功能。它不进正式设置、不写任何宿主状态，
 *      热点开关（Ctrl+Shift+D）唤出一个浮层，改数值立即生效，跑完一遍可以把当前
 *      生效值导出成 JSON 贴回聊天，我照数值改源码常量。
 *
 * 界面用中文说明参数含义与单位，并沿用 `weT(...)` 词表；
 * 导出的 JSON 保留原参数键，与排播覆盖层直接对应。
 *
 * 三条纪律（与 `src/pet-link.js` 同一份内联通路 ⇒ 同作用域、共享常量）：
 *   ① 只**读**排播常量、只**写** `petLinkState.tuning` 覆盖层，绝不复制排播逻辑；
 *      面板上的「▶ run」调的是 `petLink.tuner.run(logic)`，与点击吉祥物走**同一条**流程；
 *   ② 浏览器安全：零依赖、零模块语法、零 Node 全局，只在 `document` 存在时建 DOM；
 *   ③ 覆盖层为空时行为与面板不存在时**逐字相同**（负对照由 `verify-pet-mascot` 钉着）。
 */

/** 面板上要暴露的键（顺序即显示顺序）。分组只是排版，不影响语义。 */
const PET_TUNER_FIELDS = [
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'sidebarWalkMs', label: () => weT('去程走路时长（毫秒）'), step: 100 },
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'braceMs', label: () => weT('预备到后拉间隔（毫秒）'), step: 50 },
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'pullMs', label: () => weT('后拉动画时长（毫秒）'), step: 1 },
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'slowOpenMs', label: () => weT('侧栏展开时长（毫秒）'), step: 1 },
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'edgeGapPx', label: () => weT('手与侧栏间距（像素）'), step: 1 },
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'openLeadMs', label: () => weT('后拉提前展开（毫秒）'), step: 50 },
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'openDelayMs', label: () => weT('侧栏展开延迟（毫秒）'), step: 50 },
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'segGapMs', label: () => weT('动作间隔（毫秒）'), step: 10 },
  { group: () => weT('侧栏拉动（逻辑一）'), key: 'handRightRatio', label: () => weT('右手横向位置（比例）'), step: 0.0001 },
  { group: () => weT('后退跟随（逻辑一）'), key: 'followGraceMs', label: () => weT('跟随起步宽限（毫秒）'), step: 50 },
  { group: () => weT('后退跟随（逻辑一）'), key: 'followSpeed', label: () => weT('最大跟随速度（像素/秒）'), step: 10 },
  { group: () => weT('后退跟随（逻辑一）'), key: 'followStillMs', label: () => weT('静止确认时长（毫秒）'), step: 10 },
  { group: () => weT('后退跟随（逻辑一）'), key: 'followStillEps', label: () => weT('静止位移阈值（像素）'), step: 0.1 },
  { group: () => weT('气泡'), key: 'bubbleMs', label: () => weT('气泡显示时长（毫秒）'), step: 100 },
  { group: () => weT('气泡'), key: 'bubbleWindowMs', label: () => weT('气泡放行窗口（毫秒）'), step: 100 },
  { group: () => weT('联动占用'), key: 'lockHeartbeatMs', label: () => weT('占用续期间隔（毫秒）'), step: 1000 },
  { group: () => weT('联动占用'), key: 'holdMaxMs', label: () => weT('等待关闭上限（毫秒）'), step: 1000 },
  { group: () => weT('彩蛋'), key: 'eggAt', label: () => weT('彩蛋触发次数（次）'), step: 1 },
  { group: () => weT('彩蛋'), key: 'mascotGrabAtMs', label: () => weT('抓住绳子时刻（毫秒）'), step: 100 },
  { group: () => weT('彩蛋'), key: 'eggBubbleLeadMs', label: () => weT('彩蛋气泡提前量（毫秒）'), step: 100 },
  { group: () => weT('返回原位'), key: 'returnWalkMinPx', label: () => weT('走路返回最小距离（像素）'), step: 5 },
  { group: () => weT('抓绳互动'), key: 'mascotWalkMs', label: () => weT('去程时长（毫秒，0 自动）'), step: 100 },
  { group: () => weT('抓绳互动'), key: 'mascotTumbleMs', label: () => weT('跳抓动作时长（毫秒）'), step: 100 },
  { group: () => weT('抓绳互动'), key: 'mascotOpenAtMs', label: () => weT('侧栏触发时刻（毫秒）'), step: 50 },
  { group: () => weT('绳子位移'), key: 'mascotRopeDownPx', label: () => weT('绳子下拉距离（像素）'), step: 1 },
  { group: () => weT('绳子位移'), key: 'mascotRopePullMs', label: () => weT('绳子拉下时长（毫秒）'), step: 50 },
  { group: () => weT('绳子位移'), key: 'mascotRopeBackMs', label: () => weT('绳子弹回时长（毫秒）'), step: 50 },
  { group: () => weT('绳子位移'), key: 'mascotRopePullEase', label: () => weT('下拉缓动'), options: [() => weT('匀速'), () => weT('缓入缓出'), () => weT('缓出')] },
  { group: () => weT('绳子位移'), key: 'mascotRopeBackEase', label: () => weT('弹回缓动'), options: [() => weT('匀速'), () => weT('缓入缓出'), () => weT('缓出')] },
  { group: () => weT('脱手与下落'), key: 'mascotReleaseAtMs', label: () => weT('脱手时刻（毫秒）'), step: 50 },
  { group: () => weT('脱手与下落'), key: 'mascotDropPx', label: () => weT('pet 下落距离（像素，0 关闭）'), step: 1 },
  { group: () => weT('脱手与下落'), key: 'mascotDropMs', label: () => weT('pet 下落时长（毫秒）'), step: 50 },
  { group: () => weT('彩蛋一：踢开并弹飞'), key: 'egg1EdgeGapPx', label: () => weT('踢腿与侧栏间距（像素）'), step: 1 },
  { group: () => weT('彩蛋一：踢开并弹飞'), key: 'egg1WalkMs', label: () => weT('去程时长（毫秒，0 自动）'), step: 100 },
  { group: () => weT('彩蛋一：踢开并弹飞'), key: 'egg1LeadMs', label: () => weT('踢腿前等待（毫秒）'), step: 50 },
  { group: () => weT('彩蛋一：踢开并弹飞'), key: 'egg1KickMs', label: () => weT('踢腿动作时长（毫秒）'), step: 100 },
  { group: () => weT('彩蛋一：踢开并弹飞'), key: 'egg1FlungMs', label: () => weT('被弹飞动作时长（毫秒）'), step: 100 },
  { group: () => weT('彩蛋一：踢开并弹飞'), key: 'egg1LandMs', label: () => weT('落地动作时长（毫秒）'), step: 100 },
  { group: () => weT('弹飞位移'), key: 'egg1FlingDelayMs', label: () => weT('弹飞启动延迟（毫秒）'), step: 50 },
  { group: () => weT('弹飞位移'), key: 'egg1FlingPx', label: () => weT('向左弹飞强度（参考像素）'), step: 5 },
  { group: () => weT('弹飞位移'), key: 'egg1FlingMs', label: () => weT('弹飞发力时间（毫秒）'), step: 50 },
  { group: () => weT('落地恢复'), key: 'egg1PostLandMs', label: () => weT('落地后停留时长（毫秒）'), step: 50 },
  { group: () => weT('彩蛋二：站立哈气'), key: 'egg2LeadMs', label: () => weT('哈气前等待（毫秒）'), step: 50 },
  { group: () => weT('彩蛋二：站立哈气'), key: 'egg2HissMs', label: () => weT('哈气动作时长（毫秒）'), step: 100 },
  { group: () => weT('全屏抖动与展开'), key: 'egg2ShakeAtMs', label: () => weT('抖动开始时刻（毫秒）'), step: 50 },
  { group: () => weT('全屏抖动与展开'), key: 'egg2ShakePx', label: () => weT('全屏抖动强度（像素，0 关闭）'), step: 1 },
  { group: () => weT('全屏抖动与展开'), key: 'egg2ShakeHz', label: () => weT('抖动频率（次/秒）'), step: 1 },
  { group: () => weT('全屏抖动与展开'), key: 'egg2OpenAtPct', label: () => weT('侧栏开始展开进度（%）'), step: 1 },
  { group: () => weT('全屏抖动与展开'), key: 'egg2OpenEase', label: () => weT('侧栏展开缓动'), options: [() => weT('匀速'), () => weT('缓入缓出'), () => weT('缓出')] },
].filter(field => field.key !== 'eggBubbleLeadMs').flatMap(field => {
  const base = ['bubbleMs', 'bubbleWindowMs', 'lockHeartbeatMs', 'holdMaxMs', 'returnWalkMinPx', 'segGapMs'];
  const logics = base.includes(field.key) ? ['sidebar', 'mascot', 'egg1', 'egg2']
    : field.key === 'eggAt' ? ['sidebar', 'mascot']
      : [field.key.startsWith('mascot') ? 'mascot' : field.key.startsWith('egg1') ? 'egg1' : field.key.startsWith('egg2') ? 'egg2' : 'sidebar'];
  return logics.map(logic => ({ ...field, logic }));
});

/** 可强制播放的四条逻辑（绕过距离判断与彩蛋计数）。 */
const PET_TUNER_LOGICS = [
  { logic: 'sidebar', name: () => weT('逻辑一'), label: () => weT('拉动侧边栏') },
  { logic: 'mascot', name: () => weT('逻辑二'), label: () => weT('抓绳互动') },
  { logic: 'egg1', name: () => weT('彩蛋一'), label: () => weT('踢开并弹飞') },
  { logic: 'egg2', name: () => weT('彩蛋二'), label: () => weT('站立哈气') },
];

let petTunerRoot = null;
let petTunerInputs = null;
let petTunerBubbleSync = null;
let petTunerPageSync = null;
let petTunerLogic = 'sidebar';
let petTunerEndDrag = null;
let petTunerInstalled = false;
let petTunerSuperseded = false;
const PET_TUNER_OWNER_KEY = '__dshPetLinkTunerOwner';
const petTunerCleanups = [];
const petTunerOwner = {
  dispose() {
    petTunerSuperseded = true;
    if (petLinkState.bubbleRun) petLinkState.bubbleRun.cancel();
    petTunerDispose();
  },
};

/** 所有监听跟随当前实例卸载，包括脱离 DOM 后仍可能被持有的控件。 */
function petTunerListen(target, type, listener, capture = false) {
  if (!target || typeof target.addEventListener !== 'function') return;
  target.addEventListener(type, listener, capture);
  petTunerCleanups.push(() => {
    if (typeof target.removeEventListener === 'function') target.removeEventListener(type, listener, capture);
  });
}

function petTunerDispose() {
  petTunerInstalled = false;
  if (petTunerEndDrag) petTunerEndDrag();
  for (const cleanup of petTunerCleanups.splice(0)) cleanup();
  if (petTunerRoot) petTunerRoot.remove();
  petTunerRoot = null;
  petTunerInputs = null;
  petTunerBubbleSync = null;
  petTunerPageSync = null;
  petTunerEndDrag = null;
  const scope = typeof window !== 'undefined' ? window : typeof document !== 'undefined' ? document : null;
  // 旧代延迟卸载只能清理自己，不能撤掉新代的所有权。
  if (scope && scope[PET_TUNER_OWNER_KEY] === petTunerOwner) delete scope[PET_TUNER_OWNER_KEY];
}

/** 初次打开、拖动和缩放窗口都沿用同一条边界约束。 */
function petTunerClamp(left, top) {
  const root = petTunerRoot;
  if (!root || root.style.display === 'none' || typeof window === 'undefined') return;
  const rect = root.getBoundingClientRect();
  const x = Number.isFinite(left) ? left : rect.left;
  const y = Number.isFinite(top) ? top : rect.top;
  root.style.right = 'auto';
  root.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
  root.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
}

/** 维护权限不依赖桌宠；运行权限仍由统一资格门决定。 */
function petTunerSyncRuntime() {
  if (!petTunerRoot) return;
  const ready = petLinkEligible();
  const reason = petLinkState.fallbackReason || petLinkState.reason || weT('联动暂不可用');
  const run = petTunerRoot.querySelector('[data-tuner="run"]');
  if (run) {
    run.disabled = !ready;
    run.setAttribute('aria-disabled', String(!ready));
    run.style.opacity = ready ? '1' : '0.45';
    run.style.cursor = ready ? 'pointer' : 'not-allowed';
    run.title = ready ? '' : reason;
  }
  const status = petTunerRoot.querySelector('[data-tuner="status"]');
  if (status) status.textContent = ready ? weT('联动可用') : reason;
}

/** 把当前生效值写回输入框（打开面板、或导出一份之后调一次）。 */
function petTunerSync() {
  if (!petTunerRoot || !petTunerInputs) return;
  petTunerSyncRuntime();
  const snap = petLinkTuneSnapshot();
  for (const { key, logic, input } of Object.values(petTunerInputs)) {
    input.value = String(snap.logicValues[logic][key]);
    input.dataset.default = String(snap.defaults[key]);
  }
  if (petTunerPageSync) petTunerPageSync();
  if (petTunerBubbleSync) petTunerBubbleSync();
  const out = petTunerRoot.querySelector('[data-tuner="out"]');
  if (out) out.value = JSON.stringify(snap, null, 2);
}

/** 气泡以结构化配置独立存储，原数值参数及导出键保持兼容。 */
function petTunerBuildBubbleTiming(parent, spec) {
  const root = document.createElement('section');
  root.setAttribute('data-tuner-bubble', spec.id);
  root.style.scrollMarginTop = '32px';
  parent.appendChild(root);
  const heading = document.createElement('div');
  heading.textContent = spec.logic === 'egg1' ? spec.label() : weT('气泡时间节点');
  heading.style.cssText = 'margin:10px 0 4px;color:#ffd479;font-weight:700';
  root.appendChild(heading);
  const style = 'min-width:0;width:100%;box-sizing:border-box;background:#0d0f14;color:#e8eaf0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:3px 4px';
  const option = (select, value, text) => {
    const el = document.createElement('option'); el.value = value; el.textContent = text; select.appendChild(el);
  };
  const labels = {
    walk: () => weT('去程走路'), brace: () => weT('蓄力准备'), pull: () => weT('后拉'),
    mascotTumble: () => weT('跳抓眩晕起身'), eggKick: () => weT('踢腿'),
    eggFlung: () => weT('被弹飞'), eggLand: () => weT('落地'), eggHiss: () => weT('哈气'),
    return: () => weT('返回原位'),
  };
  const controls = {};
  for (const kind of ['show', 'hide']) {
    const text = kind === 'show' ? weT('出现') : weT('关闭');
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:52px minmax(0,1fr);gap:4px 8px;align-items:center;margin:6px 0';
    const label = document.createElement('span'); label.textContent = text;
    const action = document.createElement('select');
    action.style.cssText = style;
    action.setAttribute('data-tuner', 'bubble-' + kind + '-action');
    action.setAttribute('aria-label', text + ' · ' + weT('动作节点'));
    const detail = document.createElement('div');
    detail.style.cssText = 'grid-column:1 / -1;display:grid;grid-template-columns:64px 90px minmax(0,1fr);gap:4px;align-items:center';
    const edge = document.createElement('select'); edge.style.cssText = style;
    edge.setAttribute('data-tuner', 'bubble-' + kind + '-edge');
    edge.setAttribute('aria-label', text + ' · ' + weT('开始或结束'));
    option(edge, 'start', weT('开始')); option(edge, 'end', weT('结束'));
    const unit = document.createElement('span'); unit.style.cssText = 'font-size:11px;line-height:1.4;white-space:nowrap';
    unit.setAttribute('data-tuner', 'bubble-' + kind + '-unit');
    const offset = document.createElement('input'); offset.type = 'number'; offset.step = '50'; offset.max = '600000';
    offset.style.cssText = style;
    offset.setAttribute('data-tuner', 'bubble-' + kind + '-offset');
    offset.setAttribute('aria-label', text + ' · ' + weT('偏移（毫秒）'));
    detail.appendChild(edge); detail.appendChild(unit); detail.appendChild(offset);
    row.appendChild(label); row.appendChild(action); row.appendChild(detail); root.appendChild(row);
    controls[kind] = { action, edge, offset, unit };
    const update = () => {
      const previous = petLinkBubbleTiming(spec.id)[kind];
      const duration = action.value === 'duration';
      const disabled = action.value === 'default';
      const negativeAllowed = !duration && !(action.value === 'return' && edge.value === 'start');
      const value = duration && previous.action !== 'duration' ? petLinkTune('bubbleMs', spec.logic) : Number(offset.value);
      const rule = { action: action.value, edge: disabled || duration ? 'start' : edge.value,
        offsetMs: disabled ? 0 : negativeAllowed ? value : Math.max(0, value) };
      if (!petLinkSetBubbleTiming(spec.id, { [kind]: rule })) return;
      sync();
      const out = petTunerRoot && petTunerRoot.querySelector('[data-tuner="out"]');
      if (out) out.value = JSON.stringify(petLinkTuneSnapshot(), null, 2);
    };
    petTunerListen(action, 'change', update);
    petTunerListen(edge, 'change', update);
    petTunerListen(offset, 'input', update);
  }
  function sync() {
    const rules = petLinkBubbleTiming(spec.id);
    for (const kind of ['show', 'hide']) {
      const c = controls[kind], rule = rules[kind];
      for (const old of [...c.action.children]) old.remove();
      option(c.action, 'default', weT('保持默认'));
      if (kind === 'hide') option(c.action, 'duration', weT('按显示时长'));
      for (const key of PET_BUBBLE_ACTIONS[spec.logic]) option(c.action, key, labels[key]());
      c.action.value = rule.action; c.edge.value = rule.edge; c.offset.value = String(rule.offsetMs);
      c.edge.disabled = rule.action === 'default' || rule.action === 'duration';
      c.offset.disabled = rule.action === 'default';
      c.offset.min = rule.action === 'duration' || (rule.action === 'return' && rule.edge === 'start') ? '0'
        : rule.action === 'return' ? '-600' : '-600000';
      c.unit.textContent = rule.action === 'duration' ? weT('持续（毫秒）') : weT('偏移（毫秒）');
    }
  }
  sync();
  return sync;
}

/** 建浮层（只建一次）。样式内联，不碰样式表、不影响任何既有选择器。 */
function petTunerBuild() {
  if (petTunerRoot || typeof document === 'undefined' || !document.body) return petTunerRoot;
  const root = document.createElement('div');
  root.setAttribute('data-pet-tuner', '1');
  root.style.cssText = [
    'position:fixed', 'right:16px', 'top:16px', 'z-index:2147483600',
    'width:430px', 'max-width:calc(100vw - 16px)', 'box-sizing:border-box',
    'max-height:min(88vh,calc(100dvh - 16px))', 'overflow:auto',
    'background:rgba(18,20,26,0.96)', 'color:#e8eaf0',
    'border:1px solid rgba(255,255,255,0.18)', 'border-radius:10px',
    'padding:12px 14px', 'font:12px/1.6 ui-monospace,Consolas,monospace',
    'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = weT('桌宠联动调参');
  title.setAttribute('data-tuner', 'drag');
  title.style.cssText = 'font-weight:700;margin-bottom:8px;color:#8fd0ff;cursor:move;touch-action:none;user-select:none;position:sticky;top:0;background:#12141a;z-index:1';
  let drag = null;
  petTunerEndDrag = () => {
    if (!drag) return;
    const id = drag.id;
    drag = null;
    try { title.releasePointerCapture(id); } catch { /* 指针已释放或环境不支持捕获。 */ }
  };
  petTunerListen(title, 'pointerdown', (e) => {
    if (drag || e.button !== 0 || e.isPrimary === false) return;
    const rect = root.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    try { title.setPointerCapture(e.pointerId); } catch { /* 离开标题栏时由终止事件清理。 */ }
    e.preventDefault();
    e.stopPropagation();
  });
  const moveDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    petTunerClamp(drag.left + e.clientX - drag.x, drag.top + e.clientY - drag.y);
    e.preventDefault();
    e.stopPropagation();
  };
  petTunerListen(title, 'pointermove', moveDrag);
  petTunerListen(document, 'pointermove', moveDrag);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      petTunerEndDrag();
      e.stopPropagation();
    };
    petTunerListen(title, type, endDrag);
    if (type !== 'lostpointercapture') petTunerListen(document, type, endDrag);
  }
  root.appendChild(title);
  const status = document.createElement('div');
  status.setAttribute('data-tuner', 'status');
  status.setAttribute('role', 'status');
  status.style.cssText = 'margin:6px 0;line-height:1.5;overflow-wrap:anywhere;color:#ffd479';
  root.appendChild(status);
  const buttonStyle = 'min-width:0;box-sizing:border-box;background:#1d2b3a;color:#cfe6ff;border:1px solid rgba(255,255,255,0.22);border-radius:5px;padding:5px 8px;cursor:pointer;font:inherit;white-space:normal';
  const navigation = document.createElement('div');
  navigation.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:8px 0';
  const run = document.createElement('button');
  run.setAttribute('data-tuner', 'run');
  run.style.cssText = buttonStyle + ';height:44px;line-height:16px';
  petTunerListen(run, 'click', () => { petLink.tuner.run(petTunerLogic); });
  navigation.appendChild(run);
  const tabs = {}, pages = {}, inputs = {}, bubbleSyncs = [];
  for (const item of PET_TUNER_LOGICS) {
    const tab = document.createElement('button');
    tab.textContent = weT('切换 · {logic}', { logic: item.name() });
    tab.setAttribute('data-tuner-tab', item.logic);
    tab.setAttribute('aria-controls', 'pet-tuner-page-' + item.logic);
    tab.style.cssText = buttonStyle + ';background:#24272e;color:#ddd;height:44px;line-height:16px';
    petTunerListen(tab, 'click', () => { petTunerLogic = item.logic; petTunerSync(); });
    tabs[item.logic] = tab;
    navigation.appendChild(tab);
  }
  root.appendChild(navigation);
  const shared = ['bubbleMs', 'bubbleWindowMs', 'lockHeartbeatMs', 'holdMaxMs', 'returnWalkMinPx', 'segGapMs', 'eggAt'];
  for (const item of PET_TUNER_LOGICS) {
    const page = document.createElement('section');
    page.setAttribute('data-tuner-page', item.logic);
    page.setAttribute('id', 'pet-tuner-page-' + item.logic);
    page.setAttribute('aria-label', item.name());
    pages[item.logic] = page;
    root.appendChild(page);
    const heading = document.createElement('div');
    heading.textContent = item.name();
    heading.style.cssText = 'margin:10px 0 4px;color:#ffd479;font-weight:700';
    page.appendChild(heading);
    let lastGroup = '';
    const fields = PET_TUNER_FIELDS.filter(f => f.logic === item.logic)
      .sort((a, b) => Number(shared.includes(a.key)) - Number(shared.includes(b.key)));
    for (const f of fields) {
      const group = ['segGapMs', 'bubbleMs', 'bubbleWindowMs'].includes(f.key) ? item.name() : f.group();
      if (group !== lastGroup && group !== weT('气泡') && group !== weT('侧栏拉动（逻辑一）')) {
        const h = document.createElement('div'); h.textContent = group;
        h.style.cssText = 'margin:10px 0 4px;color:#ffd479;font-weight:700'; page.appendChild(h);
      }
      lastGroup = group;
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:8px;align-items:center;margin:3px 0';
      const name = document.createElement('span'); name.textContent = f.label();
      name.style.cssText = 'min-width:0;overflow-wrap:anywhere;opacity:0.9';
      const input = document.createElement(f.options ? 'select' : 'input');
      if (f.options) {
        f.options.forEach((label, value) => {
          const option = document.createElement('option'); option.value = String(value); option.textContent = label(); input.appendChild(option);
        });
      } else { input.type = 'number'; input.step = String(f.step); }
      input.setAttribute('data-tuner', f.key);
      input.setAttribute('data-tuner-logic', item.logic);
      input.style.cssText = 'min-width:0;width:100%;box-sizing:border-box;background:#0d0f14;color:#e8eaf0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:2px 4px;font:inherit';
      if (!f.options && !['edgeGapPx', 'egg1EdgeGapPx'].includes(f.key)) input.min = '0';
      petTunerListen(input, f.options ? 'change' : 'input', () => {
        if (input.value === '' || !petLinkSetLogicTune(item.logic, f.key, Number(input.value))) return;
        const out = petTunerRoot && petTunerRoot.querySelector('[data-tuner="out"]');
        if (out) out.value = JSON.stringify(petLinkTuneSnapshot(), null, 2);
      });
      inputs[item.logic + ':' + f.key] = { input, key: f.key, logic: item.logic };
      row.appendChild(name); row.appendChild(input); page.appendChild(row);
    }
    for (const spec of PET_BUBBLE_SPECS.filter(spec => spec.logic === item.logic)) bubbleSyncs.push(petTunerBuildBubbleTiming(page, spec));
  }
  petTunerInputs = inputs;
  petTunerBubbleSync = () => { for (const sync of bubbleSyncs) sync(); };
  petTunerPageSync = () => {
    const item = PET_TUNER_LOGICS.find(item => item.logic === petTunerLogic);
    for (const key of Object.keys(pages)) {
      pages[key].style.display = key === petTunerLogic ? '' : 'none';
      tabs[key].style.display = key === petTunerLogic ? 'none' : '';
      tabs[key].setAttribute('aria-pressed', String(key === petTunerLogic));
    }
    run.textContent = '▶ ' + item.label();
    run.setAttribute('data-tuner-run', item.logic);
  };

  const tools = document.createElement('div');
  tools.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:6px 0';
  const resetCurrent = document.createElement('button');
  resetCurrent.textContent = weT('重置当前逻辑');
  resetCurrent.setAttribute('data-tuner', 'reset-current');
  resetCurrent.style.cssText = buttonStyle + ';background:#302d23;color:#ffe5af';
  petTunerListen(resetCurrent, 'click', () => { petLinkTunerReset(petTunerLogic); });
  tools.appendChild(resetCurrent);
  const reset = document.createElement('button');
  reset.textContent = weT('全部重置');
  reset.style.cssText = 'background:#3a1d1d;color:#ffd0d0;border:1px solid rgba(255,255,255,0.22);border-radius:5px;padding:3px 8px;cursor:pointer';
  petTunerListen(reset, 'click', () => { petLinkTunerReset(); petTunerSync(); });
  const copy = document.createElement('button');
  copy.textContent = weT('导出 JSON');
  copy.style.cssText = 'background:#1d3a24;color:#d0ffd8;border:1px solid rgba(255,255,255,0.22);border-radius:5px;padding:3px 8px;cursor:pointer';
  petTunerListen(copy, 'click', () => {
    const out = root.querySelector('[data-tuner="out"]');
    if (!out) return;
    out.value = JSON.stringify(petLinkTuneSnapshot(), null, 2);
    out.focus();
    out.select();
  });
  const hide = document.createElement('button');
  hide.textContent = weT('隐藏');
  hide.style.cssText = 'background:#2a2a2a;color:#ddd;border:1px solid rgba(255,255,255,0.22);border-radius:5px;padding:3px 8px;cursor:pointer';
  petTunerListen(hide, 'click', () => { petLinkTunerToggle(false); });
  tools.appendChild(reset);
  tools.appendChild(copy);
  tools.appendChild(hide);
  root.appendChild(tools);

  const note = document.createElement('div');
  note.textContent = weT('运行时参数（刷新后恢复默认值）');
  note.style.cssText = 'opacity:0.6;margin:8px 0 4px';
  root.appendChild(note);

  const out = document.createElement('textarea');
  out.setAttribute('data-tuner', 'out');
  out.setAttribute('aria-label', weT('当前调参 JSON'));
  out.rows = 10;
  out.style.cssText = 'width:100%;background:#0d0f14;color:#bfe3ff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:4px;box-sizing:border-box';
  root.appendChild(out);

  document.body.appendChild(root);
  petTunerRoot = root;
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    petTunerListen(window, 'resize', () => {
      if (petTunerEndDrag) petTunerEndDrag();
      petTunerClamp();
    });
    petTunerListen(window, 'blur', () => { if (petTunerEndDrag) petTunerEndDrag(); });
  }
  petTunerSync();
  return root;
}

/** 显示 / 隐藏（首次显示时建 DOM 并同步当前值）。 */
function petLinkTunerToggle(force) {
  if (!petTunerInstalled || typeof document === 'undefined') return false;
  const want = typeof force === 'boolean' ? force : !petTunerRoot || petTunerRoot.style.display === 'none';
  if (want) {
    petTunerBuild();
    if (petTunerRoot) { petTunerRoot.style.display = ''; petTunerSync(); petTunerClamp(); }
  } else if (petTunerRoot) {
    if (petTunerEndDrag) petTunerEndDrag();
    petTunerRoot.style.display = 'none';
  }
  return want;
}

/** 清空全部覆盖（回到常量默认值）。 */
function petLinkTunerReset(logic) {
  if (PET_TUNER_LOGICS.some(item => item.logic === logic)) {
    if (!petLinkState.logicTuning) petLinkState.logicTuning = {};
    petLinkState.logicTuning[logic] = { ...PET_TUNE_DEFAULTS };
    for (const spec of PET_BUBBLE_SPECS.filter(spec => spec.logic === logic)) {
      if (petLinkState.bubbleTiming) delete petLinkState.bubbleTiming[spec.id];
    }
  } else {
    petLinkState.tuning = {};
    petLinkState.logicTuning = {};
    petLinkState.bubbleTiming = {};
  }
  petTunerSync();
  return petLinkTuneSnapshot();
}

/** 热键：Ctrl+Shift+D（零宿主接线 —— 面板活在主渲染页里，与宠物同页）。 */
function petTunerInstallHotkey() {
  if (petTunerSuperseded || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return false;
  if (petTunerInstalled) return true;
  const scope = typeof window !== 'undefined' ? window : document;
  const previous = scope[PET_TUNER_OWNER_KEY];
  if (previous && previous !== petTunerOwner) previous.dispose();
  // 兼容未登记所有者的旧英文版；匿名监听由捕获阶段的热键拦住。
  if (typeof document.querySelectorAll === 'function') {
    for (const stale of document.querySelectorAll('[data-pet-tuner]')) stale.remove();
  }
  scope[PET_TUNER_OWNER_KEY] = petTunerOwner;
  petTunerInstalled = true;
  petTunerListen(document, 'keydown', (e) => {
    if (!e || !e.ctrlKey || !e.shiftKey) return;
    const k = String(e.key || '').toLowerCase();
    if (k !== 'd') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    petLinkTunerToggle();
  }, true);
  return true;
}

/** 面板对外的面（`petLink.tuner` 指向它）。 */
const petLinkTuner = {
  open() { return petLinkTunerToggle(true); },
  close() { return petLinkTunerToggle(false); },
  toggle() { return petLinkTunerToggle(); },
  isOpen() { return Boolean(petTunerRoot && petTunerRoot.style.display !== 'none'); },
  /** 强制跑一条逻辑（绕过距离判断与彩蛋计数）—— 与点击吉祥物同一条流程。 */
  run(logic) { return petLinkTunerRun(logic); },
  snapshot() { return petLinkTuneSnapshot(); },
  setBubbleTiming(id, config) {
    const value = petLinkSetBubbleTiming(id, config);
    petTunerSync();
    return value;
  },
  reset(logic) { return petLinkTunerReset(logic); },
  setForLogic(logic, key, value) {
    if (!petLinkSetLogicTune(logic, key, value)) return false;
    petTunerSync();
    return petLinkTuneSnapshot();
  },
  set(key, value) {
    if (!Number.isFinite(value)) return petLinkTuneSnapshot();
    petLinkState.tuning[key] = value;
    petTunerSync();
    return petLinkTuneSnapshot();
  },
};

petTunerInstallHotkey();
