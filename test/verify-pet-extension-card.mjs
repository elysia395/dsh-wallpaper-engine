import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { weRegisterExtensionModule, weExtensionModules } from '../src/extension-registry.js';

/**
 * M7 设置页扩展模块卡片夹具。
 *
 * 覆盖验收：
 *  1) 卡片在扩展页第一位显示（order:0 排在 avatar=1/fx=2/parallax=3 之前）；
 *  2) 五种状态可复现：未装 / 已装 / 引导展开 / 官方共存 / 版本过旧（下载器已拆，安装中与失败态不再存在）；
 *  3) 无契约违规（静态判据）：视图纯渲染、副作用只在具名处理器、动作只打 M4 路由、不写主包设置/不通知/不持 React 态。
 */

const cardSource = readFileSync(new URL('../packages/pet-link/src/pet-link/extension-card.js', import.meta.url), 'utf8');
const load = new Function(cardSource + ';return { createPetLinkExtensionCard, petLinkCardView, petLinkCardToReact };')();
const i18nSrc = readFileSync(new URL('../packages/pet-link/src/pet-link/i18n.js', import.meta.url), 'utf8');
const i18n = new Function(i18nSrc + ';return { createPetLinkTranslate };')();

const byAttr = (node, name, value, out = []) => {
  if (!node || typeof node !== 'object') return out;
  const attrs = node.attrs || node.props || {};
  if (attrs[name] !== undefined && (value === undefined || attrs[name] === value)) out.push(node);
  for (const child of node.children || []) byAttr(child, name, value, out);
  return out;
};
const textOf = (node, out = []) => {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out; }
  for (const child of node.children || []) textOf(child, out);
  return out;
};
const text = view => textOf(view).join(' | ');

const fakeCard = {
  toggleEnabled() {}, install() {}, openPanel() {}, testOnce() {},
};

// ── 0) 注册顺序：order:0 排第一 ─────────────────────────────────────────────
const deps = {
  h: (tag, props, ...children) => ({ tag, props, children }),
  petLink: { mode: () => 'native', reason: () => '', mascot: { tap: async () => ({ logic: 'sidebar' }) } },
  panel: { toggle: () => true },
  apiFetch: async () => ({ ok: true, data: {} }),
  apiUrl: path => path,
  translate: value => value,
  setLinkEnabled: () => {},
};
const card = load.createPetLinkExtensionCard(deps);
for (const [id, order] of [['avatar', 1], ['fx', 2], ['parallax', 3]]) {
  weRegisterExtensionModule(id, { id, order, title: id, desc: id });
}
weRegisterExtensionModule('pet-link', card.descriptor);
const ordered = weExtensionModules().map(mod => mod.id);
assert.equal(ordered[0], 'pet-link', '扩展页第一位必须是 pet-link，实际 ' + ordered.join(','));
assert.deepEqual(ordered, ['pet-link', 'avatar', 'fx', 'parallax'], '顺序应为 pet-link→avatar→fx→parallax');
assert.equal(card.descriptor.id, 'pet-link');
assert.equal(card.descriptor.order, 0);
console.log('PASS 扩展页第一位：' + ordered.join(' → '));

// ── 1) 五种状态可复现（纯视图）────────────────────────────────────────────
const view = snapshot => load.petLinkCardView(snapshot, fakeCard, value => value);
const cases = [
  // 2026-11-01：不再自研下载。主按钮恒为「如何下载安装联动桌宠」（展开后变「收起安装说明」）。
  { name: '未装', snap: { checking: false, installed: false, linkEnabled: true, mode: 'native', reason: 'runtime-not-installed', phase: 'idle' }, need: ['未安装', '如何下载安装联动桌宠'] },
  { name: '已装', snap: { checking: false, installed: true, version: '0.3.8', running: false, mode: 'linked', reason: '', phase: 'idle' }, need: ['已安装 v0.3.8', '如何下载安装联动桌宠'] },
  { name: '引导展开', snap: { checking: false, installed: false, guideOpen: true, mode: 'native', reason: '', phase: 'idle' }, need: ['收起安装说明', '三步装好联动桌宠', '复制包名', 'dshpet-dshwe', '不承诺跟随上游更新', 'github.com/Fish-under-sea/dshpet-dshwe'] },
  { name: '官方共存', snap: { checking: false, installed: true, version: '0.3.8', running: true, officialPet: true, mode: 'linked', reason: '', phase: 'idle' }, need: ['已安装 v0.3.8', '检测到官方 dsh-pet'] },
  { name: '版本过旧', snap: { checking: false, installed: true, version: '0.3.8', mode: 'native', reason: 'runtime-too-old', phase: 'idle' }, need: ['运行时版本过旧', '落后于本插件'] },
  { name: '服务未就绪', snap: { checking: false, installed: true, version: '0.3.8', mode: 'native', reason: 'runtime-not-installed', phase: 'idle' }, need: ['联动服务未就绪'] },
];
for (const item of cases) {
  const rendered = text(view(item.snap));
  for (const need of item.need) assert.ok(rendered.includes(need), item.name + ' 应显示「' + need + '」，实际：' + rendered);
}
console.log('PASS 五种状态：未装 / 已装 / 引导展开 / 官方共存 / 版本过旧');

// ── 1b) EN 抽查：五种状态行在英文 translator 下无中文残留（t21 词表生效证据）──────
{
  const cjk = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;
  const enT = i18n.createPetLinkTranslate(value => value, () => 'en');
  for (const item of cases) {
    const renderedEn = text(load.petLinkCardView(item.snap, fakeCard, enT));
    assert.ok(!cjk.test(renderedEn), item.name + ' EN 下仍有中文残留：' + renderedEn);
  }
  console.log('PASS EN 抽查：卡片五种状态行在 EN 下无中文残留');
}

// ── 1c) 并发刷新：慢的旧响应不得覆盖新响应（5s 轮询与点按会并发）──────────
{
  const pending = [];
  const raceCard = load.createPetLinkExtensionCard({
    ...deps,
    apiFetch: () => new Promise(resolve => { pending.push(resolve); }),
  });
  const first = raceCard.refresh();
  const second = raceCard.refresh();
  pending[1]({ ok: true, data: { ok: true, installed: true, version: '9.9.9' } });
  await second;
  pending[0]({ ok: true, data: { ok: true, installed: false } });
  await first;
  assert.equal(raceCard.snapshot().installed, true, '过期刷新响应不得覆盖最新状态');
  console.log('PASS 并发刷新：丢弃过期响应，保留最新状态');
}

// ── 2) 卡片控件：胶囊开关 / 状态 / 安装引导 / 诊断；面板与测试按钮随检测结果出现或隐藏 ──
const base = view({ checking: false, installed: false, linkEnabled: true, phase: 'idle' });
const switchNode = byAttr(base, 'data-pet-link', 'switch')[0];
assert.ok(switchNode && switchNode.attrs.type === 'checkbox' && switchNode.attrs.role === 'switch', '联动开关输入');
assert.ok(text(base).includes('启用桌宠联动'), '开关标签为「启用桌宠联动」');
assert.equal(byAttr(base, 'data-pet-link', 'open-panel').length, 0, '未检测到桌宠时不出现打开面板按钮');
assert.equal(byAttr(base, 'data-pet-link', 'test-once').length, 0, '未检测到桌宠时不出现测试一次按钮');
assert.ok(byAttr(base, 'data-pet-link', 'status')[0], '状态行');
assert.ok(byAttr(base, 'data-pet-link', 'install-guide')[0], '安装引导按钮');
assert.ok(byAttr(base, 'data-pet-link', 'diag')[0], '折叠诊断 details');
const detected = view({ checking: false, installed: true, version: '0.3.8', mode: 'linked', phase: 'idle' });
assert.ok(byAttr(detected, 'data-pet-link', 'open-panel')[0], '检测到桌宠时出现打开面板按钮');
assert.ok(byAttr(detected, 'data-pet-link', 'test-once')[0], '检测到桌宠时出现测试一次按钮');
// 口径提示（2026-11-02）：常驻路标在安装按钮下方（不在开关行）；完整说明只在展开的安装引导里。
assert.equal(byAttr(base, 'data-pet-link', 'adapted-hint').length, 1, '常驻「改编版」路标只出现一次');
assert.ok(text(base).includes('独立改编版'), '常驻路标文案');
assert.equal(byAttr(base, 'data-pet-link', 'adapted-note').length, 0, '引导未展开时不渲染完整说明');
const guideOpen = view({ checking: false, installed: false, guideOpen: true, phase: 'idle' });
const noteNode = byAttr(guideOpen, 'data-pet-link', 'adapted-note')[0];
assert.ok(noteNode, '引导展开时出现「关于联动包」说明');
assert.ok(text(noteNode).includes('不承诺跟随上游更新'), '说明里写明不跟随上游');
console.log('PASS 卡片控件：胶囊开关 / 状态 / 安装引导 / 诊断；面板与测试按钮随检测结果出现或隐藏');
console.log('PASS 口径提示：常驻路标 + 引导内完整说明（开关行不塞小字）');

// ── 2b) 宿主不订阅 notify 的补偿：render 必须交出"自带订阅"的组件 ─────────────
//  宿主在 renderExtensionsTab 里是一次性内联调用 mod.render(ctx)，不会订阅本卡片的 notify()；
//  若 render 直接返回静态树，开关点下去只改内部状态、要等宿主因别的原因重画（切页签再切回）
//  才看得见（实测「按下去没反应」）。这里钉住：React 在场时 render 返回函数组件，且该组件
//  内部仍是同一棵描述树（开关节点/anchor 文案都在）。
{
  const ReactFake = {
    Fragment: 'Fragment',
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ tag: type, attrs: props || {}, children }),
  };
  const cardWithReact = load.createPetLinkExtensionCard({ ...deps, React: ReactFake });
  const rendered = cardWithReact.descriptor.render({});
  assert.equal(typeof rendered.tag, 'function',
    'React 在场时 render 必须返回自带订阅的组件（否则开关/状态要等宿主重画才更新）');
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.tag === 'function') return expand(node.tag(node.attrs || node.props || {}));
    return { ...node, children: (node.children || []).map(expand) };
  };
  const inner = expand(rendered.tag({}));
  const toggle = byAttr(inner, 'data-pet-link', 'switch')[0];
  assert.ok(toggle, '组件内部仍要画出联动开关');
  assert.ok(text(inner).includes('启用桌宠联动'), '开关行标签仍是「启用桌宠联动」');
  let notified = 0;
  const off = cardWithReact.subscribe(() => { notified += 1; });
  assert.equal(cardWithReact.snapshot().linkEnabled, true, '初始联动开关为开');
  (toggle.attrs || toggle.props).onChange({ target: { checked: false } });
  assert.equal(cardWithReact.snapshot().linkEnabled, false, '开关点下去立即生效（不必等宿主重画）');
  assert.ok(notified >= 1, '开关变化必须 notify 订阅者（组件据此立刻重画）');
  off();
  // 2b.1) 卸载：dispose() 摘订阅并停发通知（热重载后旧卡片不得继续驱动渲染/定时器）
  let afterDispose = 0;
  cardWithReact.subscribe(() => { afterDispose += 1; });
  assert.equal(typeof cardWithReact.dispose, 'function', '卡片必须提供 dispose（卸载时清定时器与订阅）');
  cardWithReact.dispose();
  cardWithReact.toggleEnabled(false);
  assert.equal(afterDispose, 0, 'dispose 之后不得再 notify 订阅者（订阅已清、disposed 置位）');
  console.log('PASS 开关自订阅：render 交出组件、点按立即改状态并 notify；dispose 后静默');
}

// ── 3) 具名处理器：走 M4 路由、开关立即生效、安装成功/失败、面板/测试 ────────
let mode = 'native';
let reason = 'runtime-not-installed';
const stateResp = { installed: false, version: '', running: false, officialPet: false };
const installResp = { ok: true, method: 'pnpm', version: '0.3.8', steps: [{ step: 'preflight', ok: true }, { step: 'install', ok: true }], state: { installed: true, version: '0.3.8', running: false } };
const calls = [];
let panelToggled = 0; let tapCalled = 0;
const controller = load.createPetLinkExtensionCard({
  h: (tag, props, ...children) => ({ tag, props, children }),
  petLink: { mode: () => mode, reason: () => reason, mascot: { tap: async () => { tapCalled += 1; return { logic: 'sidebar' }; } } },
  panel: { toggle: () => { panelToggled += 1; return true; } },
  apiUrl: path => '/wallpaper-engine' + path,
  apiFetch: async (path, init) => {
    calls.push({ path, init });
    if (path.endsWith('/pet/state')) return { ok: true, data: stateResp };
    if (path.endsWith('/pet/install')) return { ok: true, data: installResp };
    return { ok: false, data: null, error: 'unexpected' };
  },
  translate: value => value,
  setLinkEnabled: on => { calls.push({ setLinkEnabled: on }); },
});
await controller.refresh();
assert.equal(controller.snapshot().installed, false, 'refresh 读到未装');
assert.equal(controller.snapshot().checking, false, 'checking 落定');
mode = 'linked'; reason = '';
await controller.refresh();
assert.equal(controller.snapshot().mode, 'linked', 'refresh 读联动模式');
  // 下载器已拆：控制器不再暴露 install（自研下载会绕过 DSH 依赖管理）
  assert.equal(typeof controller.install, 'undefined', '控制器不应再有 install 方法');
// 联动开关立即生效
assert.equal(controller.toggleEnabled(false), false, '关掉开关返回 false');
assert.equal(controller.snapshot().linkEnabled, false, '快照 linkEnabled=false');
assert.ok(calls.some(c => c.setLinkEnabled === false), '开关处理回调收到 false（立即生效，不重启）');
// 打开面板 / 测试一次
controller.openPanel(); assert.equal(panelToggled, 1, '打开面板调用 panel.toggle');
await controller.testOnce(); assert.equal(tapCalled, 1, '测试一次调用 mascot.tap');
// render 返回 React 元素且不抛
const el = card.descriptor.render({});
assert.equal(el.tag, 'div', 'descriptor.render 返回根 div');
console.log('PASS 具名处理器：M4 路由 / 开关立即生效 / 安装成功失败 / 面板 / 测试 / render');

// ── 4) 无契约违规（静态判据）
const s2 = cardSource;
for (const banned of ['selection', 'setSetting(', 'setTransient(', 'emit(', 'displayNotice', 'dispatchEvent', 'localStorage']) {
  assert.ok(!cardSource.includes(banned), '卡片源码不得出现主包状态/副作用符号：' + banned);
}
// hooks 只允许**经 deps.React 显式调用**（引导面板的局部展开态），不得裸用全局 hooks。
// 口径：出现 useXxx( 时必须带 R. 前缀（R = deps.React）。
{
  // 逐个 hook 名做字符串扫描：出现处前两个字符必须是 "R."，否则视为裸用。
  const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback'];
  const bare = [];
  for (const name of hooks) {
    let at = s2.indexOf(name + '(', 0);
    while (at >= 0) {
      const prev = s2.slice(Math.max(0, at - 2), at);
      if (prev !== 'R.') bare.push(name);
      at = s2.indexOf(name + '(', at + 1);
    }
  }
  assert.equal(bare.length, 0, '不得裸用 React hooks，必须经 deps.React：' + bare.join(','));
  assert.ok(s2.includes('deps.React'), '应通过 deps.React 取 React 以使用局部态');
}
// 只允许 M4 的 pet 路由
assert.ok(cardSource.includes('/pet-link/pet/state'), '必须打 state 路由（下载器已拆，不再有 install）');
assert.ok(!cardSource.includes('/pet-link/pet/install\''), '不得再打已移除的 install 路由');
assert.ok(!/\/anim|\/wake|dsh-pet-dshwe-7340/.test(cardSource), '卡片不得直接打运行时动画路由');
// 副作用只经注入的 apiFetch（不是全局 fetch）
const stripped = cardSource.replace(/apiFetch\(/g, '');
assert.ok(!/(^|[^A-Za-z])fetch\(/.test(stripped), '不得使用全局 fetch');
// render 是纯视图：只把快照交回纯函数
assert.ok(cardSource.includes('petLinkCardToReact(petLinkCardView(snapshot(), api, translate), deps.h)'), 'render 只做纯视图转换');
console.log('PASS 无契约违规：纯视图 + 副作用只在具名处理器 + 只打 state 路由 + 不写主包设置/不通知/局部态仅经 deps.React');

// ── 开关持久化：真值归宿主，卡片只镜像 ───────────────────────────────────
{
  const cardDeps = {
    h: (tag, props, ...children) => ({ tag, props, children }),
    petLink: { mode: () => 'native', reason: () => '' },
    panel: { toggle: () => true },
    apiFetch: async () => ({ ok: true, data: { installed: false } }),
    apiUrl: path => path,
    translate: value => value,
  };
  const fresh = load.createPetLinkExtensionCard(cardDeps);
  assert.equal(fresh.snapshot().linkEnabled, true, '宿主未提供 isLinkEnabled 时默认开');

  // 2026-11-02：此前初值硬编码 true，用户关掉后刷新即回 ON。
  const offCard = load.createPetLinkExtensionCard({ ...cardDeps, isLinkEnabled: () => false });
  assert.equal(offCard.snapshot().linkEnabled, false, '开关初值必须回读宿主持久化的值');

  let stored = true;
  const written = [];
  const toggleCard = load.createPetLinkExtensionCard({
    ...cardDeps,
    isLinkEnabled: () => stored,
    setLinkEnabled: value => { written.push(value); stored = value; },
  });
  assert.equal(toggleCard.toggleEnabled(false), false, 'toggleEnabled 应返回新值');
  assert.deepEqual(written, [false], 'toggleEnabled 必须把值交给宿主持久化层');
  assert.equal(toggleCard.snapshot().linkEnabled, false, '点按后快照应立即为新值');

  // 另一个页签/重开页面改了真值：下一次 refresh 必须对齐，而不是继续显示旧值。
  stored = true;
  await toggleCard.refresh();
  assert.equal(toggleCard.snapshot().linkEnabled, true, 'refresh 应把开关对齐到宿主真值');
  console.log('PASS 开关持久化：初值回读 / 点按写回 / 刷新对齐');
}

console.log('PASS M7 设置页扩展模块卡片：第一位 / 五种态 / 具名处理器 / 无契约违规 / 开关持久化');
