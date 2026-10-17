import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdits } from '../tools/patch-pet-client.mjs';
const original = new URL('../../../.artifacts/hotplug-upstream/package/lib/client.js', import.meta.url);
const source = applyEdits(readFileSync(process.argv[2] || original, 'utf8'));
const start = source.indexOf('\t\t\tconst ctl = {');
const end = source.indexOf('\n\t\t\twindow.__dshPetCtl = ctl;', start);
assert.ok(start >= 0 && end > start);
const code = source.slice(start, end) + ';return ctl;';
const window = {};
function mount(id) {
  const root = { style: {} };
  const env = { window, cfg: { id }, rootRef: { current: root }, Date, LOCK_TTL_MS: 60000,
    bubbleAllowUntilRef: { current: 0 }, allowBubbleWindow() {}, statePoller: { now() {} },
    linkPlaybackRef: { current: {} }, frontRef: { current: 0 }, videoARef: { current: {} }, videoBRef: { current: {} },
    bubbleLockedNow: () => Boolean(window.__dshPetBubbleLock), hideAllBubbles() {}, readLock: () => window.__dshPetLock,
    selfLockRef: { current: {} }, stopMove() {}, petAnims: { idle: [] }, setOnce() {}, setSeqRaw() {},
  };
  return { ctl: new Function('env', 'with(env){let bubbleDurationMs=1000;' + code + '}')(env), root };
}
const first = mount('main'), second = mount('pet-2');
assert.equal(first.ctl.target, 'main');
assert.equal(first.ctl.getRoot(), first.root);
assert.equal(second.ctl.target, 'pet-2');
console.log('PASS 控制面明确绑定目标与当前根元素');
first.ctl.lock('old'); second.ctl.lock('new'); first.ctl.unlock();
assert.equal(window.__dshPetLock.name, 'new');
first.ctl.lockBubbles(); second.ctl.lockBubbles(); const held = window.__dshPetBubbleLock;
first.ctl.unlockBubbles(); assert.equal(window.__dshPetBubbleLock, held);
second.ctl.unlockBubbles(); second.ctl.unlock();
assert.equal(window.__dshPetLock, null); assert.equal(window.__dshPetBubbleLock, null);
console.log('PASS 旧控制面不能解除新实例的动作锁或气泡锁');
