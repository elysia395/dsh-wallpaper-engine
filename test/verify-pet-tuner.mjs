import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performerFixture } from './tools/official-performer.mjs';
import { parseInlineModules } from './tools/src-scope.mjs';
import { stripExportBlocks } from './tools/js-text.mjs';
const source = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8');
const definitions = readFileSync(new URL('../packages/pet-link/src/pet-link-performer.js', import.meta.url), 'utf8');
const make = new Function(definitions + '\n' + source + ';return createOfficialPetTuner;')();
class Element {
  constructor(tag) { this.tag = tag; this.style = {}; this.attrs = new Map(); this.children = []; this.events = new Map(); }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key); }
  appendChild(node) { this.children.push(node); }
  replaceChildren() { this.children = []; }
  addEventListener(key, fn) { this.events.set(key, fn); }
  querySelectorAll(selector) {
    const out = [], name = selector.slice(1, -1);
    for (const child of this.children) {
      if (selector === 'textarea' ? child.tag === selector : child.attrs.has(name)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  remove() { this.removed = true; }
  focus() {} select() {}
}
const listeners = new Map();
const doc = { body: new Element('body'), createElement: tag => new Element(tag),
  addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
const h = performerFixture();
await h.api.warmup();
const panel = make(h.api, { document: doc });
panel.install(); panel.install();
assert.equal(listeners.size, 1);
panel.open();
const root = doc.body.children[0];
assert.equal(root.getAttribute('role'), 'dialog');
assert.equal(root.querySelectorAll('[data-logic]').length, 4);
assert.equal(root.querySelectorAll('[data-param]').length, 15);
assert.equal(root.querySelectorAll('[data-bubble-rule]').length, 10, '五气泡的出现与隐藏均有独立控件');
const rule = root.querySelector('[data-bubble-action]');
rule.value = 'brace'; rule.events.get('change')();
assert.equal(h.api.tuner.snapshot().bubbleTiming.sidebar.show.action, 'brace');
h.api.tuner.reset('sidebar');
assert.equal(h.api.tuner.snapshot().bubbleTiming.sidebar, undefined, '重置当前逻辑也清除该逻辑气泡节点');
const input = root.querySelectorAll('[data-param]').find(node => node.getAttribute('data-param') === 'bubbleMs');
input.value = '1700'; input.events.get('change')();
assert.equal(h.api.tuner.snapshot().logicTuning.sidebar.bubbleMs, 1700);
input.value = '-1'; input.events.get('change')();
assert.equal(input.value, '1700', '非法输入还原，不静默改变排播');
const target = root.querySelector('[data-target]');
target.value = 'second'; target.events.get('change')();
await h.flush();
assert.equal(h.api.tuner.snapshot().target, 'second');
const exported = root.children.find(node => node.tag === 'div' && node.children.some(item => item.title === '导出 JSON'));
exported.children.find(node => node.title === '导出 JSON').events.get('click')();
assert.equal(JSON.parse(root.querySelector('textarea').value).target, 'second');
panel.close(); assert.equal(panel.isOpen(), false);
panel.dispose(); assert.equal(listeners.size, 0); assert.equal(root.removed, true);
const copies = parseInlineModules().map(item => item.file).filter(file => /(?:^|\/)i18n-copy(?:-[^/]+)?\.js$/.test(file));
const dictionary = new Function(copies.map(file => stripExportBlocks(readFileSync(new URL('../' + file, import.meta.url), 'utf8'))).join('\n') + ';return WE_I18N_EN;')();
const english = make(h.api, { document: doc, translate: value => dictionary[value] || value });
english.open();
const englishRoot = doc.body.children.at(-1);
assert.equal(englishRoot.getAttribute('aria-label'), 'Pet link tuning');
const texts = node => [node.textContent || '', node.title || '', node.getAttribute('aria-label') || '', ...node.children.flatMap(texts)];
assert.equal(texts(englishRoot).filter(value => /[\u3400-\u9fff]/.test(value)).length, 0, '英文面板的标签、按钮、气泡标题和可访问名称全部翻译');
english.dispose();
h.api.dispose();
console.log('PASS 官方调参：四逻辑、15参数、目标选择、非法输入、JSON导出、监听器回收');
