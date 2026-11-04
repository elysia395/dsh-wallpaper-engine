/** 官方桥接自有界面的真实浏览器检查；不替代官方 pet 渲染器的演出验收。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { MEME_NAMES } from '../packages/pet-link/lib/prepared.js';

const out = resolve('.artifacts/official-pet');
mkdirSync(out, { recursive: true });
const source = ['official-pet.js', 'pet-link-performer.js', 'pet-link-tuner.js']
  .map(file => readFileSync(new URL('../packages/pet-link/src/' + file, import.meta.url), 'utf8')).join('\n');
const images = MEME_NAMES.map(name => pathToFileURL(resolve('packages/pet-link/assets/memes', name + '.png')).href);
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{color-scheme:light dark}body{margin:0;background:Canvas;color:CanvasText}</style><script>${source}
window.pose={x:0.02,y:0.05};const service={pose:()=>window.pose,progress:()=>null};let run=0;
window.client=createOfficialPetClient({get(){return service}},{sizeOf:()=>180,
request:async input=>({ok:true,...input,runId:'run-'+(++run)}),bubbleUrl:i=>${JSON.stringify(images)}[i]});
window.link=createOfficialPetPerformer({getContext:()=>({get:()=>service}),
fetchTargets:async()=>({ok:true,pets:[{id:'main',name:'测试目标',size:180,display:'web'}]}),
request:async()=>({ok:true}),fallback:()=>true,storage:null});
window.panel=createOfficialPetTuner(window.link);</script>`;
const previewFile = join(out, 'bubble-preview.html');
writeFileSync(previewFile, html);
const browser = process.env.PET_TEST_BROWSER || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
assert.ok(browser, '须安装 Edge/Chrome 或显式设置 PET_TEST_BROWSER');
const profile = mkdtempSync(join(out, 'profile-'));
const child = spawn(browser, ['--headless=new', '--no-first-run', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
let socket, counter = 0, launchError;
const pending = new Map();
child.on('error', error => { launchError = error; });
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  let port;
  const deadline = Date.now() + 20000;
  while (!port && Date.now() < deadline) {
    if (launchError) throw launchError;
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); }
    catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error; }
    if (!port) await delay(100);
  }
  assert.ok(port, '浏览器调试端口未就绪');
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data), item = pending.get(event.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(event.id);
    if (event.error) item.reject(new Error(JSON.stringify(event.error))); else item.resolve(event.result);
  };
  await send('Page.enable'); await send('Runtime.enable');
  for (const width of [320, 375, 768, 1280]) for (const theme of ['light', 'dark']) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await send('Page.navigate', { url: pathToFileURL(previewFile).href });
    let ready = false;
    const deadline = Date.now() + 10000;
    while (!ready && Date.now() < deadline) { ready = await evaluate('!!window.client'); if (!ready) await delay(30); }
    assert.ok(ready);
    await evaluate(`(async()=>{await client.begin('main');client.showBubble({text:'<b>动作释放后气泡保留。</b> '+
      'LongWord'.repeat(15),image:0,duration:60000});await client.finish();})()`);
    let loaded = false;
    const until = Date.now() + 5000;
    while (!loaded && Date.now() < until) {
      loaded = await evaluate('!!document.querySelector("img")?.naturalWidth');
      if (!loaded) await delay(30);
    }
    assert.ok(loaded, '配图实际加载');
    const box = await evaluate(`(()=>{const n=document.querySelector('[data-we-official-pet-bubble]'),r=n.getBoundingClientRect();
      return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,text:n.textContent,
      count:document.querySelectorAll('[data-we-official-pet-bubble]').length,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.equal(box.count, 1);
    assert.ok(box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= 800, JSON.stringify({ width, theme, ...box }));
    assert.equal(box.overflow, false); assert.ok(box.text.includes('<b>'));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `bubble-${width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
    await evaluate('client.dispose();');
    assert.equal(await evaluate('document.querySelectorAll("[data-we-official-pet-bubble]").length'), 0);
    console.log('PASS bubble ' + width + ' ' + theme);
    await evaluate('panel.open();');
    const tuner = await evaluate(`(()=>{const n=document.querySelector('[data-pet-tuner]'),r=n.getBoundingClientRect();
      return{left:r.left,right:r.right,overflow:n.scrollWidth>n.clientWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth,
      rules:[...n.querySelectorAll('[data-bubble-rule]')].filter(n=>!n.closest('fieldset').hidden).length}})()`);
    assert.ok(tuner.left >= 0 && tuner.right <= width, JSON.stringify(tuner));
    assert.equal(tuner.overflow, false); assert.equal(tuner.pageOverflow, false); assert.equal(tuner.rules, 2);
    const panelShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `tuner-${width}-${theme}.png`), Buffer.from(panelShot.data, 'base64'));
    await evaluate('panel.dispose();link.dispose();');
    console.log('PASS tuner ' + width + ' ' + theme);
  }
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  if (socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {});
  socket?.close();
  if (child.exitCode === null && !launchError) {
    const exited = new Promise(resolve => { child.once('exit', resolve); });
    child.kill(); await exited;
  }
}
