import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const out = resolve('.artifacts/glass-optics');
mkdirSync(out, { recursive: true });
const source = readFileSync(resolve('packages/glass/src/glass-optics.js'), 'utf8').replace(/export \{[^}]+\};/, '');
const html = readFileSync(resolve('test/fixtures/glass-optics.html'), 'utf8').replace('/* OPTICS_SOURCE */', source);
writeFileSync(join(out, 'fixture.html'), html);
const candidates = process.platform === 'win32'
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  : ['/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = process.env.WE_TEST_BROWSER || candidates.find(existsSync);
assert.ok(browser, 'Set WE_TEST_BROWSER to a Chromium executable; this test does not skip.');
const profile = mkdtempSync(join(tmpdir(), 'we-optics-'));
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-pipe', '--user-data-dir=' + profile], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let counter = 0, sessionId, buffered = '', stderr = '';
const pending = new Map();
child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
const rejectAll = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
child.on('error', rejectAll);
child.on('exit', () => rejectAll(Error('Browser exited: ' + stderr)));
child.stdio[3].on('error', rejectAll);
child.stdio[4].on('data', data => {
  buffered += data;
  let end;
  while ((end = buffered.indexOf('\0')) >= 0) {
    const event = JSON.parse(buffered.slice(0, end)); buffered = buffered.slice(end + 1);
    const item = pending.get(event.id);
    if (!item) continue;
    clearTimeout(item.timer); pending.delete(event.id);
    if (event.error) item.reject(Error(JSON.stringify(event.error))); else item.resolve(event.result);
  }
});
const send = (method, params = {}) => new Promise((resolveCall, reject) => {
  const id = ++counter, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method + stderr)); }, 30000);
  pending.set(id, { resolve: resolveCall, reject, timer });
  child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  // This fixture exercises pointer highlights, which honor the host's reduced-motion preference.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.navigate', { url: pathToFileURL(join(out, 'fixture.html')).href });
  let result;
  for (let i = 0; i < 150; i++) {
    await delay(100);
    const read = await send('Runtime.evaluate', { expression: 'document.getElementById("result")?.textContent', returnByValue: true });
    const value = read.result?.value;
    if (value && value !== 'RUNNING') { result = JSON.parse(value); break; }
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify(result || { ok: false, error: 'timeout' }, null, 2));
  assert.ok(result?.ok, result?.error || 'Browser fixture timed out');
  console.log('PASS | glass optics browser: ' + result.assertions.length + ' assertions');
  await send('Browser.close');
} finally { child.kill(); rejectAll(Error('Test complete')); }
