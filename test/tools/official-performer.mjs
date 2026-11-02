import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export function clientEntryFixture(built) {
  let registration, bridge;
  const listeners = new Set();
  const document = {
    addEventListener(event, handler) { listeners.add(handler); },
    removeEventListener(event, handler) { listeners.delete(handler); },
    querySelector() { return null; },
  };
  new Function('window', 'document', built)({ __ModuleLoader__: { load(value) { registration = value; } } }, document);
  const facade = {
    weT: value => value, apiUrl: path => path,
    apiFetch: async () => ({ data: { ok: true, pets: [{ id: 'main', size: 180, display: 'web' }] } }),
    wallSidebarOpen: () => true, wallSidebarClose: () => true, wallSidebarToggle: () => true,
    registerPetLink(value) { bridge = value; },
  };
  const plugin = registration.factory(spec => {
    assert.equal(spec, 'dsh-plugin-wallpaper-engine'); return facade;
  });
  return { plugin, bridge, listeners };
}

const source = readFileSync(new URL('../../packages/pet-link/src/official-pet.js', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../../packages/pet-link/src/pet-link-performer.js', import.meta.url), 'utf8');
const create = new Function(source + ';return createOfficialPetPerformer;')();

export function performerFixture(options = {}) {
  let time = 0, serial = 0, playback = null, serviceOn = true;
  const calls = [], timers = new Map(), frames = new Map(), nodes = [];
  const service = { pose: id => serviceOn && ['main', 'second'].includes(id) ? { x: 0.4, y: 0.6, facing: 'left' } : null,
    progress: () => playback && { ...playback, currentTime: Math.max(0, time - playback.at) / 1000,
      duration: 0.2, paused: false, buffering: false } };
  const document = { createElement() { return { style: {}, setAttribute() {}, appendChild() {},
    remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1); } }; },
    body: { appendChild(node) { nodes.push(node); } } };
  const sidebar = Object.fromEntries(['open', 'close', 'toggle', 'beginPull', 'commit', 'rebound'].map(key =>
    [key, (...args) => { calls.push({ sidebar: key, args }); return true; }]));
  sidebar.edgeX = () => 700; sidebar.isOpen = () => false;
  const api = (options.create || create)({ getContext: () => ({ get: () => serviceOn ? service : null }), document, storage: null,
    viewport: () => ({ width: 1000, height: 800 }), now: () => time,
    wait: async ms => { time += Math.max(40, ms); if (options.wait) await options.wait(ms); },
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    fetchTargets: async () => ({ ok: true, pets: [
      { id: 'main', size: 180, display: 'web' }, { id: 'second', size: 120, display: 'web' }] }),
    request: async input => {
      calls.push(input);
      if (options.request) { const value = await options.request(input); if (value) return value; }
      if (input.op === 'start') return { ok: true, petId: input.petId, pageId: input.pageId, runId: 'run-' + ++serial };
      if (input.action?.kind === 'anim') {
        playback = { playbackId: 'play-' + ++serial, at: time }; return { ok: true, playbackId: playback.playbackId };
      }
      return { ok: true };
    }, bubbleUrl: index => '/m' + index + '.png', fallback: () => sidebar.toggle(),
    moveRope: px => calls.push({ rope: px }), restoreRope: () => calls.push({ restore: true }),
  });
  api.mascot.registerSidebar(sidebar);
  return { api, calls, timers, frames, nodes,
    service(on) { serviceOn = on; },
    async flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); },
  };
}
