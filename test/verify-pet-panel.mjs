import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * M6 浮层操控面板夹具（浏览器半，脱真实浏览器）。
 *
 * 覆盖验收：
 *  1) 可开可关：open/close/isOpen + Ctrl+Shift+D 唤起 + Esc 关闭 + 关闭按钮；
 *  2) 约 50 参数分组 + 缓动三选一：字段数、分组齐全、缓动是 3 选项下拉；
 *  3) 参数改动生效：改 sidebarWalkMs → tuner 快照生效；
 *  4) 持久化可回读：同 storage 新建面板 open 后读到持久化值；
 *  5) 导出 JSON 结构被导入还原；
 *  6) a11y：role=dialog + aria-label、按钮 type、输入 aria-label、tab/tabpanel、status aria-live；
 *  7) 可拖动：标题 pointerdown+move 后 left 改变。
 *
 * 直接读源码串起来求值（沿用 verify-pet-tuner.mjs 口径），不依赖构建产物。
 */

const FILES = ['constants.js', 'i18n.js', 'panel-params.js', 'mode.js', 'bubble.js',
  'linked-shared.js', 'linked-sidebar.js', 'linked-mascot.js', 'linked-egg1.js', 'linked-egg2.js',
  'linked.js', 'native.js', '../pet-link.js', 'panel.js'];
const source = FILES.map(file => readFileSync(new URL('../packages/pet-link/src/pet-link/' + file, import.meta.url), 'utf8')).join('\n');
const load = new Function(source + ';return { createPetLink, createPetLinkPanel, createPetLinkPanelSettings, createPetLinkTranslate, PETLINK_PANEL_FIELDS, PETLINK_PANEL_LOGICS, PETLINK_BUBBLE_SPECS };')();

/** 极简 DOM 元素。 */
class El {
  constructor(tag) {
    this.tag = tag; this.style = {}; this.children = []; this.parent = null;
    this.textContent = ''; this.value = ''; this.attrs = new Map(); this.events = new Map();
    this.type = ''; this.step = ''; this.min = ''; this.rows = 0; this.hidden = false; this.disabled = false;
  }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.has(key) ? this.attrs.get(key) : null; }
  hasAttribute(key) { return this.attrs.has(key); }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  replaceChildren() { this.children = []; }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } this.removed = true; }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(fn); }
  removeEventListener(type, fn) { const list = this.events.get(type); if (list) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); } }
  fire(type, event = {}) { for (const fn of [...(this.events.get(type) || [])]) fn({ target: this, preventDefault() {}, stopImmediatePropagation() {}, ...event }); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 440, height: 520 }; }
  focus() { this.focused = true; } select() { this.selected = true; }
}

function makeDoc() {
  const body = new El('body');
  const doc = {
    body,
    createElement: tag => new El(tag),
    addEventListener(type, fn) { if (!doc._ev.has(type)) doc._ev.set(type, []); doc._ev.get(type).push(fn); },
    removeEventListener(type, fn) { const list = doc._ev.get(type); if (list) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); } },
    _ev: new Map(),
    fire(type, event = {}) { for (const fn of [...(doc._ev.get(type) || [])]) fn({ preventDefault() {}, stopImmediatePropagation() {}, ...event }); },
  };
  return doc;
}

function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  };
}

const walk = (node, out = []) => { out.push(node); for (const child of node.children || []) walk(child, out); return out; };
const all = root => walk(root);
const byAttr = (root, name, value) => all(root).filter(node => node.getAttribute && node.getAttribute(name) !== null && (value === undefined || node.getAttribute(name) === value));
const one = (root, name, value) => { const list = byAttr(root, name, value); return list[0] || null; };

function makePetLink() {
  return load.createPetLink({
    getApi: () => null, // native，只为驱动 tuner 覆盖层读写
    translate: value => value,
    viewport: () => ({ width: 1200, height: 900 }),
    document: makeDoc(),
    storage: null,
    now: () => 0,
    wait: async () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  });
}

// ── 0) 参数清单齐全（约 50 + 分组 + 缓动）──────────────────────────────────
assert.ok(load.PETLINK_PANEL_FIELDS.length >= 45, '参数清单应约 50 条，实际 ' + load.PETLINK_PANEL_FIELDS.length);
const groups = new Set(load.PETLINK_PANEL_FIELDS.map(field => field.group));
for (const need of ['逻辑一 · 侧栏拉动', '抓绳互动', '绳子位移', '脱手与下落', '弹飞位移', '落地恢复', '彩蛋二 · 站立哈气', '气泡', '联动占用', '彩蛋与返回原位']) {
  assert.ok(groups.has(need), '缺分组：' + need);
}
assert.ok(load.PETLINK_PANEL_FIELDS.filter(field => field.ease).length >= 3, '缓动三选一字段应 ≥3 处');
console.log('PASS 参数清单：' + load.PETLINK_PANEL_FIELDS.length + ' 条 / ' + groups.size + ' 组 / 缓动 ' + load.PETLINK_PANEL_FIELDS.filter(f => f.ease).length + ' 处');

// ── 1) 可开可关 + 热键 + a11y ──────────────────────────────────────────────
const storage = makeStorage();
const doc = makeDoc();
const win = { innerWidth: 1200, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
const petLink = makePetLink();
const panel = load.createPetLinkPanel({ petLink, settings: load.createPetLinkPanelSettings({ storage }), document: doc, window: win, translate: value => value });
assert.equal(panel.install(), true, 'install 应装上 Ctrl+Shift+D 热键');
assert.equal(panel.isOpen(), false, '初始应关闭');
assert.equal(panel.open(), true, 'open 应成功');
assert.equal(panel.isOpen(), true, 'open 后应打开');
const root = doc.body.children[0];
assert.equal(root.getAttribute('role'), 'dialog', '浮层 role=dialog');
assert.equal(root.getAttribute('aria-label'), '桌宠联动调参', '浮层 aria-label');
for (const name of ['run', 'stop', 'reset', 'export', 'import', 'close']) {
  const button = one(root, 'data-pl', name);
  assert.ok(button, '缺按钮：' + name);
  assert.equal(button.type, 'button', name + ' 必须 type=button');
}
assert.equal(one(root, 'data-pl', 'status').getAttribute('role'), 'status', '状态行 role=status');
assert.equal(one(root, 'data-pl', 'status').getAttribute('aria-live'), 'polite', '状态行 aria-live');
const tabs = byAttr(root, 'data-pl', 'tab');
assert.equal(tabs.length, 4, '四个逻辑页签');
assert.ok(tabs.every(tab => tab.getAttribute('role') === 'tab' && tab.getAttribute('aria-selected') !== null), '页签 role/aria-selected');
const panels = byAttr(root, 'data-pl-panel', undefined);
// 页签切到 mascot 验证 aria-selected 切换
tabs.find(tab => tab.getAttribute('data-pl-tab-logic') === 'mascot').fire('click');
assert.equal(panel.currentLogic(), 'mascot', '点页签切换当前逻辑');
assert.equal(tabs.find(tab => tab.getAttribute('data-pl-tab-logic') === 'mascot').getAttribute('aria-selected'), 'true', '选中页签 aria-selected=true');
// Ctrl+Shift+D 关闭再打开
doc.fire('keydown', { ctrlKey: true, shiftKey: true, key: 'd' });
assert.equal(panel.isOpen(), false, 'Ctrl+Shift+D 应关闭');
doc.fire('keydown', { ctrlKey: true, shiftKey: true, key: 'd' });
assert.equal(panel.isOpen(), true, 'Ctrl+Shift+D 应再次打开');
// Esc 关闭
doc.fire('keydown', { key: 'Escape' });
assert.equal(panel.isOpen(), false, 'Esc 应关闭');
panel.open();
console.log('PASS 浮层：可开可关 + Ctrl+Shift+D + Esc + a11y(role/aria/tab/status)');

// ── 2) 参数改动生效 + 持久化可回读 ─────────────────────────────────────────
panel.setLogic('sidebar');
const walkInput = byAttr(doc.body.children[0], 'data-pl-key', 'sidebarWalkMs').find(node => node.getAttribute('data-pl-logic') === 'sidebar');
assert.ok(walkInput, '缺 sidebarWalkMs 输入框');
walkInput.value = '4000';
walkInput.fire('input');
assert.equal(petLink.tuner.snapshot().logicTuning.sidebar.sidebarWalkMs, 4000, '改动应写进覆盖层')
const saved = JSON.parse(storage.getItem('dsh-we-pet-link-panel-v1'));
assert.equal(saved.tuning.sidebar.sidebarWalkMs, 4000, '改动应持久化到 storage');
// 缓动三选一：切到 mascot，选第 3 项
panel.setLogic('mascot');
const easeSelect = byAttr(doc.body.children[0], 'data-pl-key', 'mascotRopePullEase').find(node => node.getAttribute('data-pl-logic') === 'mascot');
assert.ok(easeSelect && easeSelect.children.length === 3, '缓动应为 3 选项下拉');
easeSelect.value = '2'; easeSelect.fire('change');
assert.equal(petLink.tuner.snapshot().logicTuning.mascot.mascotRopePullEase, 2, '缓动改动应生效');
// 新建面板 + 新 tuner、共用 storage → open 回读持久化值
const petLink2 = makePetLink();
const panel2 = load.createPetLinkPanel({ petLink: petLink2, settings: load.createPetLinkPanelSettings({ storage }), document: makeDoc(), window: win, translate: value => value });
panel2.open();
assert.equal(petLink2.tuner.snapshot().logicTuning.sidebar.sidebarWalkMs, 4000, '新面板 open 应回读持久化的 sidebarWalkMs');
assert.equal(petLink2.tuner.snapshot().logicTuning.mascot.mascotRopePullEase, 2, '新面板 open 应回读持久化的缓动');
console.log('PASS 参数改动生效 + 持久化可回读（新面板 open 读回）');

// ── 3) 导出 JSON 结构被导入还原 ───────────────────────────────────────────
const root2 = doc.body.children[0];
const exportBtn = one(root2, 'data-pl', 'export');
exportBtn.fire('click');
const outNode = one(root2, 'data-pl', 'out');
const exported = JSON.parse(outNode.value);
assert.equal(exported.version, 1, '导出 JSON 带 version');
assert.equal(exported.tuning.sidebar.sidebarWalkMs, 4000, '导出含 tuning');
assert.ok(exported.bubbleTiming && typeof exported.bubbleTiming === 'object', '导出含 bubbleTiming');
// 清空后导入还原
petLink.tuner.reset();
assert.equal(petLink.tuner.snapshot().logicTuning.sidebar, undefined, '重置后覆盖层应为空');
outNode.value = JSON.stringify(exported);
one(root2, 'data-pl', 'import').fire('click');
assert.equal(petLink.tuner.snapshot().logicTuning.sidebar.sidebarWalkMs, 4000, '导入应还原 sidebarWalkMs');
assert.equal(petLink.tuner.snapshot().logicTuning.mascot.mascotRopePullEase, 2, '导入应还原缓动');
// 非法 JSON 不崩、状态行给可读提示
outNode.value = '{ not json';
one(root2, 'data-pl', 'import').fire('click');
assert.ok(String(one(root2, 'data-pl', 'status').textContent).indexOf('导入失败') >= 0, '非法导入应提示');
console.log('PASS 导出 JSON 结构被导入还原（含非法输入容错）');

// ── 4) 可拖动 ──────────────────────────────────────────────────────────────
const title = one(doc.body.children[0], 'data-pl', 'title');
const beforeLeft = doc.body.children[0].style.left;
title.fire('pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
doc.fire('pointermove', { pointerId: 1, clientX: 260, clientY: 180 });
assert.notEqual(doc.body.children[0].style.left, beforeLeft, '拖动后 left 应改变');
console.log('PASS 可拖动：标题拖动改变浮层位置');

// ── 5) EN 抽查：13 个分组名全部有英文译文、无中文残留（t21 词表生效证据）──────────
{
  const cjk = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;
  const enT = load.createPetLinkTranslate(value => value, () => 'en');
  const groups = [...new Set(load.PETLINK_PANEL_FIELDS.map(field => field.group))];
  assert.ok(groups.length >= 13, '应有 ≥13 个分组名，实际 ' + groups.length);
  for (const group of groups) {
    const en = enT(group);
    assert.ok(en !== group && !cjk.test(en), 'EN 下分组名应翻译且无中文残留：' + group + ' → ' + en);
  }
  // 未配置 EN 时回落中文（机制双向都成立，不是"永远翻成英文"）
  const zhT = load.createPetLinkTranslate(value => value, () => 'zh');
  assert.equal(zhT('逻辑一'), '逻辑一', 'zh 下应回落中文原文');
  console.log('PASS EN 抽查：' + groups.length + ' 个面板分组名全部英文、无中文残留');
}

panel.dispose(); panel2.dispose();
assert.equal(doc.body.children.length, 0, 'dispose 应把浮层从 DOM 摘除');
console.log('PASS M6 浮层操控面板：分组参数 + 缓动 + 持久化 + 导入导出 + a11y + 拖动 + 开关');

// ── 7) 气泡时间节点：duration/default 可存 + 大偏移 + 持久化回读（T14）─────────
//   证明面板「按显示时长(duration)」与 offsetMs=300000 不再被校验拒收，且能持久化回读。
{
  const storage3 = makeStorage();
  const doc3 = makeDoc();
  const petLink3 = makePetLink();
  const panel3 = load.createPetLinkPanel({ petLink: petLink3, settings: load.createPetLinkPanelSettings({ storage: storage3 }), document: doc3, window: win, translate: value => value });
  panel3.open();
  panel3.setLogic('egg1');
  const section = one(doc3.body.children[0], 'data-pl-bubble-id', 'egg1Angry');
  assert.ok(section, '应有 egg1Angry 气泡时间节点编辑器');
  const hideAction = byAttr(section, 'data-pl-bubble-action', 'hide')[0];
  const hideEdge = byAttr(section, 'data-pl-bubble-edge', 'hide')[0];
  const hideOffset = byAttr(section, 'data-pl-bubble-offset', 'hide')[0];
  assert.ok(hideAction && hideEdge && hideOffset, 'hide 规则应有 动作/锚点/偏移 三个控件');
  hideAction.value = 'duration';
  hideEdge.value = 'start';
  hideOffset.value = '300000';
  hideAction.fire('change');
  const snap3 = petLink3.tuner.snapshot().bubbleTiming.egg1Angry;
  assert.ok(snap3 && snap3.hide, 'duration hide 规则应写进 state');
  assert.equal(snap3.hide.action, 'duration', 'action=duration 应被接受（原先会被 PETLINK_ANIM 校验拒收）');
  assert.equal(snap3.hide.offsetMs, 300000, 'offsetMs=300000 应可存（≤600000）');
  const saved3 = JSON.parse(storage3.getItem('dsh-we-pet-link-panel-v1'));
  assert.equal(saved3.bubbleTiming.egg1Angry.hide.action, 'duration', '应持久化 duration 规则到 storage');
  // 刷新回读：新建 tuner + 面板，共用 storage → open 时 applySettings 调 setBubbleTiming 还原。
  const petLink4 = makePetLink();
  const panel4 = load.createPetLinkPanel({ petLink: petLink4, settings: load.createPetLinkPanelSettings({ storage: storage3 }), document: makeDoc(), window: win, translate: value => value });
  panel4.open();
  const back = petLink4.tuner.snapshot().bubbleTiming.egg1Angry;
  assert.ok(back && back.hide, '新面板 open 应回读 duration 规则');
  assert.equal(back.hide.action, 'duration', '回读的 action 应为 duration');
  assert.equal(back.hide.offsetMs, 300000, '回读的 offsetMs 应为 300000');
  panel3.dispose(); panel4.dispose();
  console.log('PASS T14 面板气泡节点：duration hide + offsetMs=300000 可存，且持久化回读');
}
