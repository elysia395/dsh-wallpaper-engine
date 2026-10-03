// Reproduce the official Windows preload's style-only appearance observer.
// The caption colour must follow a wallpaper gate change across async turns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const start = bundle.indexOf('function setWallpaperActive(active) {');
const end = bundle.indexOf('function syncLayers() {', start);
assert.ok(start >= 0 && end > start, 'test the shipped activation function');
const source = bundle.slice(start, end);

function harness(windows = true) {
  const attributes = new Map();
  const properties = new Map();
  const sent = [];
  const palette = { dark: true };
  let pending = false;
  const readColour = () => attributes.has('data-we-wallpaper')
    ? 'rgba(0, 0, 0, 0)' : palette.dark ? 'rgb(27, 27, 28)' : 'rgb(249, 250, 251)';
  const syncCaption = () => {
    const colour = readColour();
    if (sent.at(-1) !== colour) sent.push(colour);
  };
  // This is the observed host contract: style/theme, but not wallpaper attrs.
  const mutation = (name) => {
    if (!['style', 'data-ds-dark-theme'].includes(name) || pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; syncCaption(); });
  };
  const body = {
    setAttribute(name, value) { attributes.set(name, value); mutation(name); },
    removeAttribute(name) { attributes.delete(name); mutation(name); },
    style: {
      getPropertyValue(name) { return properties.get(name) || ''; },
      setProperty(name, value) {
        if (properties.get(name) === value) return;
        properties.set(name, value); mutation('style');
      },
      removeProperty(name) { if (properties.delete(name)) mutation('style'); },
    },
  };
  const document = { body, documentElement: { dataset: windows ? { windowsTitlebar: '' } : {} } };
  const setActive = vm.runInNewContext(`${source}\nsetWallpaperActive`, {
    document, ACTIVE_ATTR: 'data-we-wallpaper',
  });
  syncCaption();
  return { body, setActive, sent, properties, palette, readColour,
    flush: () => new Promise(resolve => queueMicrotask(resolve)) };
}

const stale = harness();
stale.body.setAttribute('data-we-wallpaper', 'on');
await stale.flush();
assert.equal(stale.readColour(), 'rgba(0, 0, 0, 0)');
assert.equal(stale.sent.at(-1), 'rgb(27, 27, 28)', 'negative control: attr alone leaves opaque caption');

const win = harness();
win.setActive(true);
await win.flush();
assert.equal(win.sent.at(-1), 'rgba(0, 0, 0, 0)', 'activation updates the native caption');
win.setActive(true);
await win.flush();
assert.equal(win.sent.length, 2, 'unchanged activation does not resend');
win.setActive(false);
await win.flush();
assert.equal(win.sent.at(-1), 'rgb(27, 27, 28)', 'clearing restores the native dark fill');
assert.equal(win.properties.size, 0, 'clear/unload removes the plugin-owned wake-up style');
win.setActive(true);
await win.flush();
assert.equal(win.sent.at(-1), 'rgba(0, 0, 0, 0)', 'reactivation resynchronizes');
win.palette.dark = false;
win.body.removeAttribute('data-ds-dark-theme');
await win.flush();
assert.equal(win.sent.at(-1), 'rgba(0, 0, 0, 0)', 'theme changes keep an active wallpaper transparent');
win.setActive(false);
await win.flush();
assert.equal(win.sent.at(-1), 'rgb(249, 250, 251)', 'clear follows the current light theme');

const web = harness(false);
web.setActive(true);
await web.flush();
assert.equal(web.readColour(), 'rgba(0, 0, 0, 0)');
assert.equal(web.properties.size, 0, 'ordinary browsers need no native-caption wake-up');
console.log('WINDOWS CAPTION SYNC CHECKS PASSED');
