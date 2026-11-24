import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CSS_GLASS } from '../packages/glass/src/glass-css.js';

const out = resolve('.artifacts/glass-optics');
mkdirSync(out, { recursive: true });
const source = readFileSync(resolve('packages/glass/src/glass-optics.js'), 'utf8').replace(/export \{[^}]+\};/, '');
const html = readFileSync(resolve('test/fixtures/glass-optics.html'), 'utf8')
  .replace('/* OPTICS_SOURCE */', source)
  .replace('/* GLASS_CSS */', () => JSON.stringify(CSS_GLASS));
writeFileSync(join(out, 'fixture.html'), html);
const candidates = process.platform === 'win32'
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browser = process.env.WE_TEST_BROWSER || candidates.find(existsSync);
assert.ok(browser, 'Set WE_TEST_BROWSER to a Chromium executable; this test does not skip.');

function launchBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'we-optics-'));
  const child = spawn(browser, [
    '--headless=new', '--no-first-run', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const [, , browserStderr, toBrowser, fromBrowser] = child.stdio;
  let counter = 0, sessionId, buffered = '', stderr = '', connectionError;
  const pending = new Map();

  function failConnection(error) {
    connectionError ??= error;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(connectionError);
    }
    pending.clear();
  }
  browserStderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
  browserStderr.on('error', failConnection);
  child.on('error', failConnection);
  child.on('exit', () => failConnection(Error('Browser exited: ' + stderr)));
  toBrowser.on('error', failConnection);
  fromBrowser.on('error', failConnection);
  fromBrowser.on('end', () => failConnection(Error('Browser CDP pipe closed: ' + stderr)));
  fromBrowser.setEncoding('utf8');
  fromBrowser.on('data', data => {
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
  const send = (method, params = {}, timeoutMs = 30000) => new Promise((resolveCall, reject) => {
    if (connectionError) { reject(connectionError); return; }
    const id = ++counter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`CDP timeout: ${method} (${timeoutMs} ms, ${browser})\n${stderr}`));
    }, timeoutMs);
    pending.set(id, { resolve: resolveCall, reject, timer });
    toBrowser.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });

  async function attach() {
    const startupTimeout = 15000;
    const { targetInfos } = await send('Target.getTargets', {}, startupTimeout);
    const target = targetInfos.find(info => info.type === 'page');
    assert.ok(target, 'Browser returned no startup page: ' + stderr);
    ({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, startupTimeout));
  }

  async function waitForExit() {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    try {
      await once(child, 'exit', { signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      return false;
    }
  }

  async function closeBrowser() {
    try {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      // Browser.close is browser-scoped. Chromium may close the pipe without replying.
      if (toBrowser.writable) {
        toBrowser.write(JSON.stringify({ id: ++counter, method: 'Browser.close' }) + '\0');
      }
      if (await waitForExit()) return;
      child.kill('SIGKILL');
      if (!(await waitForExit())) throw Error('Browser did not exit after termination: ' + stderr);
    } finally {
      failConnection(Error('Test complete'));
      // A descendant can keep inherited pipe handles open after the browser exits.
      toBrowser.destroy();
      fromBrowser.destroy();
      browserStderr.destroy();
      child.unref();
    }
  }
  return { send, attach, closeBrowser };
}

// Retry a cold browser startup once with a fresh profile. Fixture failures never retry.
let connection = launchBrowser();
try {
  await connection.attach();
} catch (error) {
  await connection.closeBrowser();
  console.warn('Retrying browser startup: ' + error.message.split('\n')[0]);
  connection = launchBrowser();
  try {
    await connection.attach();
  } catch (retryError) {
    await connection.closeBrowser();
    throw retryError;
  }
}
const { send, closeBrowser } = connection;
let result;
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  // This fixture exercises pointer highlights, which honor the host's reduced-motion preference.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.navigate', { url: pathToFileURL(join(out, 'fixture.html')).href });
  for (let i = 0; i < 150; i++) {
    await delay(100);
    const read = await send('Runtime.evaluate', { expression: 'document.getElementById("result")?.textContent', returnByValue: true });
    const value = read.result?.value;
    if (value && value !== 'RUNNING') { result = JSON.parse(value); break; }
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify(result || { ok: false, error: 'timeout' }, null, 2));
  assert.ok(result?.ok, result?.error || 'Browser fixture timed out');
} finally {
  await closeBrowser();
}
console.log('PASS | glass optics browser: ' + result.assertions.length + ' assertions');
