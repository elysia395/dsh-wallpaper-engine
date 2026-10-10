// Assert the DOM contract behind the Windows caption gate: while a wallpaper is
// active the product sets data-we-wallpaper="on" on <body> (the stylesheet's
// wallpaper gate) and keeps a plugin-owned `--we-caption-active` marker for the
// Windows shell's style-only observer; clearing removes both. Ordinary browsers
// (no Windows titlebar) get the gate but no marker.
// The caption COLOUR itself belongs to that host observer — this file must not
// re-implement the observable and then assert on its own mirror.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const start = bundle.indexOf('function setWallpaperActive(active) {');
const end = bundle.indexOf('function syncLayers() {', start);
assert.ok(start >= 0 && end > start, 'test the shipped activation function');
const source = bundle.slice(start, end);

// The gate attribute lives at module level (outside the slice), so read its real
// name out of the bundle instead of assuming it.
const attrMatch = bundle.match(/const ACTIVE_ATTR = "([^"]+)";/);
assert.equal(attrMatch?.[1], 'data-we-wallpaper', 'the gate attribute keeps its name');
const ATTR = attrMatch[1];

function harness(windows = true, sourceText = source) {
  const attributes = new Map();
  const properties = new Map();
  // No value de-duplication on purpose: a redundant write must stay visible,
  // otherwise "unchanged activation does not resend" could never fail.
  const styleWrites = [];
  const body = {
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    style: {
      getPropertyValue(name) { return properties.get(name) || ''; },
      setProperty(name, value) { properties.set(name, value); styleWrites.push([name, value]); },
      removeProperty(name) { properties.delete(name); styleWrites.push([name, null]); },
    },
  };
  const document = { body, documentElement: { dataset: windows ? { windowsTitlebar: '' } : {} } };
  const setActive = vm.runInNewContext(`${sourceText}\nsetWallpaperActive`, {
    document, ACTIVE_ATTR: ATTR,
  });
  return { body, setActive, attributes, properties, styleWrites };
}

// One shared vocabulary for the positive sequence and every control below: all of
// them read what the product wrote, never a test-side expectation of it.
const gateOn = (h) => h.attributes.get(ATTR) === 'on';
const gateOff = (h) => !h.attributes.has(ATTR);
const wakeUpOn = (h) => h.properties.get('--we-caption-active') === '1';
const wakeUpClear = (h) => h.properties.size === 0;

const win = harness();
assert.ok(gateOff(win) && wakeUpClear(win), 'idle: no gate, no plugin-owned style');
win.setActive(true);
assert.ok(gateOn(win), 'activation updates the data-we-wallpaper attribute');
assert.ok(wakeUpOn(win) && win.styleWrites.length === 1, 'activation writes the wake-up marker exactly once');
assert.deepEqual(win.styleWrites[0], ['--we-caption-active', '1'], 'the marker the Windows observer watches');
win.setActive(true);
assert.equal(win.styleWrites.length, 1, 'unchanged activation does not resend');
win.setActive(false);
assert.ok(gateOff(win) && wakeUpClear(win), 'clear drops the gate and the plugin-owned wake-up style');
assert.deepEqual(win.styleWrites.at(-1), ['--we-caption-active', null], 'clear removes the marker itself');
win.setActive(true);
assert.ok(gateOn(win) && wakeUpOn(win) && win.styleWrites.length === 3, 'reactivation resynchronizes');
// The host repaints its own theme attribute under us; that is not our gate.
win.body.removeAttribute('data-ds-dark-theme');
assert.ok(gateOn(win) && wakeUpOn(win) && win.styleWrites.length === 3, 'host theme churn leaves the gate alone');
win.setActive(false);
assert.ok(gateOff(win) && wakeUpClear(win) && win.styleWrites.length === 4, 'clear still follows a theme change');

// Control A (synthetic host): an ordinary browser document has no Windows
// titlebar, so the same predicates must find the gate and NO wake-up marker.
const web = harness(false);
web.setActive(true);
assert.ok(gateOn(web) && !wakeUpOn(web) && web.styleWrites.length === 0,
  'ordinary browsers need no native-caption wake-up');
web.setActive(false);
assert.ok(gateOff(web) && wakeUpClear(web), 'ordinary browser clear is still a plain gate drop');

// Control B (mutated product source): rename the attribute the product writes and
// the very same gate predicate must go red — otherwise gateOn proves nothing.
const mutantSource = source.replace('body.setAttribute(ACTIVE_ATTR, "on")',
  'body.setAttribute(ACTIVE_ATTR + "-typo", "on")');
assert.notEqual(mutantSource, source, 'the mutation landed on the shipped source');
const mutant = harness(true, mutantSource);
mutant.setActive(true);
assert.ok(!gateOn(mutant) && mutant.attributes.get(`${ATTR}-typo`) === 'on',
  'the gate predicate rejects an attribute-rename mutant');
console.log('WINDOWS CAPTION SYNC CHECKS PASSED');
