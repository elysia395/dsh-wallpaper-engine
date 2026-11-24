import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DEFAULTS, sanitizeFromSchema, RESET_MODULES, PROFILE_PRESET_KEYS } from '../lib/settings-schema.js';

assert.equal(DEFAULTS.glassOptics, false);
for (const value of [undefined, false, 'true', 1, null]) {
  assert.equal(sanitizeFromSchema({ glassOptics: value }).glassOptics, false);
}
assert.equal(sanitizeFromSchema({ glassOptics: true }).glassOptics, true);
assert.ok(RESET_MODULES.glass.includes('glassOptics'));
assert.ok(PROFILE_PRESET_KEYS.includes('glassOptics'));

// Exercise actual lifecycle code: disabled settings must allocate no timers,
// and disabling/skin yielding before a pending mount must cancel that mount.
const source = readFileSync(new URL('../packages/glass/src/glass-optics.js', import.meta.url), 'utf8');
const tail = source.slice(source.indexOf('let glassOpticsTimer')).replace(/export \{[^}]+\};/, '');
const tasks = new Map(), attrs = new Set(['data-we-glass-page']);
let serial = 0, installs = 0, releases = 0, yielding = false;
let gpu = { renderer: '', software: false };
const ctx = vm.createContext({
  selection: { glassOptics: false }, glassRowDisabled: false,
  skinYieldActive: () => yielding,
  probeGlassRenderer: () => gpu,
  detectSoftwareRender: () => false,
  document: { body: { hasAttribute: key => attrs.has(key) } },
  window: {
    setTimeout: fn => { tasks.set(++serial, fn); return serial; },
    clearTimeout: id => tasks.delete(id),
  },
  installGlassOptics: () => { installs++; return () => releases++; },
  reportGlassOptics: () => { throw new Error('Unexpected mount error'); },
});
vm.runInContext(tail, ctx);
const sync = () => vm.runInContext('syncGlassOptics()', ctx);
const flush = () => { for (const [id, fn] of [...tasks]) { tasks.delete(id); fn(); } };
const blockReason = () => vm.runInContext('glassOpticsBlockReason()', ctx);
for (const renderer of [
  'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11)',
  'Mesa Intel(R) HD Graphics 4000 (IVB GT2)',
  'ANGLE (NVIDIA, GeForce GTX 960M Direct3D11)',
  'NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2',
  'AMD Radeon (TM) RX 580 Series (radeonsi, polaris10)',
]) {
  gpu = { renderer, software: false };
  assert.equal(blockReason(), 'legacy', renderer);
  ctx.selection.glassOptics = true;
  sync(); assert.equal(tasks.size, 0, renderer);
}
for (const renderer of [
  'ANGLE (Intel, Intel(R) Arc(TM) B580 Graphics Direct3D11)',
  'Intel(R) Iris(R) Xe Graphics', 'Intel(R) UHD Graphics 770',
  'GeForce GTX 1660 Ti', 'GeForce RTX 4060', 'Radeon RX 6600', 'Apple M1', 'ANGLE', '',
]) {
  gpu = { renderer, software: false };
  assert.equal(blockReason(), '', renderer);
}
gpu = { renderer: 'SwiftShader', software: true };
assert.equal(blockReason(), 'software');
sync(); assert.equal(tasks.size, 0);
gpu = { renderer: 'Intel(R) Arc(TM) B580 Graphics', software: false };
ctx.selection.glassOptics = false;
sync(); assert.equal(tasks.size, 0);
ctx.selection.glassOptics = true;
sync(); sync(); assert.equal(tasks.size, 1);
yielding = true; flush(); assert.equal(installs, 0);
yielding = false; sync(); flush(); assert.equal(installs, 1);
sync(); flush(); assert.equal(installs, 1);
attrs.add('data-we-glass-fallback'); sync(); assert.equal(releases, 1);
attrs.delete('data-we-glass-fallback'); sync();
ctx.selection.glassOptics = false; sync(); flush(); assert.equal(installs, 1);
ctx.selection.glassOptics = true; sync(); flush();
ctx.glassRowDisabled = true; sync(); assert.equal(releases, 2);
console.log('PASS | glass optics: opt-in schema, GPU gate, reset/preset ownership, mount cancellation and disposal');
