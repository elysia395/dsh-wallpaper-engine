import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PET_NAMES } from '../packages/pet-link/lib/prepared.js';
import { verifyEgg2Browser } from './verify-pet-egg2-browser-case.mjs';

if (!process.env.PET_TEST_VIEWPORT) {
  for (const viewport of ['1366x900', '360x640']) await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, PET_TEST_VIEWPORT: viewport } });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(viewport + ' 测试退出 ' + code)));
  });
  process.exit(0);
}
const fixture = JSON.parse(readFileSync(resolve('.artifacts/hotplug-prepared.json'), 'utf8'));
const app = process.env.PET_TEST_APP_ROOT;
assert.ok(app, '须设置 PET_TEST_APP_ROOT 指向 DSH 安装根目录；本测试不猜测用户路径');
const react = readFileSync(join(app, 'node_modules/react/umd/react.production.min.js'), 'utf8');
const dom = readFileSync(process.env.PET_TEST_REACT_DOM || resolve('.artifacts/hotplug-upstream/react-dom/package/umd/react-dom.production.min.js'), 'utf8');
const jsx = readFileSync(join(app, 'node_modules/react/cjs/react-jsx-runtime.production.min.js'), 'utf8');
const client = readFileSync(join(fixture.packageRoot, 'lib/client.js'), 'utf8');
const link = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../packages/pet-link/src/pet-link.js', import.meta.url), 'utf8');
const assets = {};
for (const name of PET_NAMES) assets[name] = readFileSync(join(fixture.home, 'dsh-pet/main-animation/webm', name + '.webm')).toString('base64');
for (const name of ['待机呼吸休闲', '点击回应-开心跃动', '被鼠标拖拽悬空反馈']) assets[name] = readFileSync(join(fixture.upstream, 'assets/webm', name + '.webm')).toString('base64');
const profile = mkdtempSync(join(tmpdir(), 'pet-hotplug-'));
const browser = spawn(process.env.PET_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
  '--window-size=' + process.env.PET_TEST_VIEWPORT.replace('x', ','), '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore' });
let socket, id = 0, launchError;
const pending = new Map(), errors = [];
browser.on('error', e => { launchError = e; });
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error('CDP timeout: ' + method)); }, 10000);
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
}
async function until(expression, label, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expression)) return; await delay(50); }
    throw Error(label + '\n' + JSON.stringify(await evaluate(`({ctl:!!window.__dshPetCtl,videos:[...document.querySelectorAll('video')].map(v=>({front:v.classList.contains('is-front'),ready:v.readyState,network:v.networkState,error:v.error?.message,paused:v.paused,time:v.currentTime,src:v.currentSrc.slice(0,100)})),playback:window.__dshPetCtl?.getPlayback(),log:window.__log,errors:window.__errors,phase:window.__link?.state.runner})`)));
}
try {
  let port; const deadline = Date.now() + 20000;
  while (!port && Date.now() < deadline) {
    if (launchError) throw launchError;
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (e) { if (!['ENOENT', 'EBUSY'].includes(e.code)) throw e; }
    if (!port) await delay(100);
  }
  assert.ok(port, 'Edge 未能开启调试端口');
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const r = JSON.parse(data); if (r.method === 'Runtime.exceptionThrown') errors.push(r.params);
    const item = pending.get(r.id); if (!item) return; pending.delete(r.id); clearTimeout(item.timer);
    if (r.error) item.reject(Error(JSON.stringify(r.error))); else item.resolve(r.result);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const [width, height] = process.env.PET_TEST_VIEWPORT.split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(react); await evaluate(dom);
  await evaluate(`(() => {
    const module={exports:{}};new Function('module','exports','require',${JSON.stringify(jsx)})(module,module.exports,n=>React);window.__jsx=module.exports;
    document.body.style.cssText='margin:0;background:#edf3f1';document.body.innerHTML='<div id="pet"></div><div class="we-rope" style="position:fixed;left:70px;top:70px;width:52px;height:57px;background:#499485"></div>';
    window.__log=[];window.__errors=[];window.addEventListener('error',e=>__errors.push(e.message));
    window.__state={sections:{},pets:{main:{anim:{counter:0,data:null},say:{counter:0,data:null}}}};
    window.__cfg={main:{pets:[{id:'main',name:'main',size:${width > 500 ? 400 : 220},display:'web',position:{corner:'bottom-left',marginX:60,marginY:30},fixedEnabled:true,balanceEnabled:false,whisperEnabled:false,workStatusEnabled:false}],
      animations:{idle:['待机呼吸休闲'],turn:[],drag:['被鼠标拖拽悬空反馈'],clicks:['点击回应-开心跃动'],moves:{default:{minDist:20,maxDist:40,margin:20,leadSec:0,tailSec:0},actions:[]},categories:[],events:{DSHWE:${JSON.stringify(PET_NAMES)},balance:[],whisper:[],workStatus:[]}},
      animationWeights:{idle:100,turn:0,move:0},physics:{gravity:1400,restitution:.78,groundFriction:2.5,ceilingBounce:true,throwPower:1,petCollision:false},eventsRefreshSec:{whisper:300,balance:1800},workStatusTexts:[],confineToScreen:true}};
    const assets=${JSON.stringify(assets)};
    window.__cap={protocol:1,generation:'initial',enabled:true,linkEnabled:true,available:true,ttlMs:1500,target:'main',petBase:'/dsh-pet-7340',names:${JSON.stringify(PET_NAMES)}};
    window.fetch=async (input,init={})=>{
      if(init.signal?.aborted)throw new DOMException('cancelled','AbortError');
      const path=String(input),pathname=new URL(path,'https://fixture.invalid').pathname;const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
      if(path.endsWith('/capability'))return json(__cap);
      if(path.endsWith('/config'))return json(__cfg);
      if(path.endsWith('/state'))return json(__state);
      if(path.includes('/thumb/')){const name=decodeURIComponent(path.split('/').at(-1)).replace(/\\.webm$/,'');const data=assets[name];if(!data)return new Response('',{status:404});return new Response(Uint8Array.from(atob(data),c=>c.charCodeAt(0)),{headers:{'Content-Type':'video/webm'}});}
      if(init.method==='POST'){
        const data=JSON.parse(init.body||'{}');__log.push({path,data,at:performance.now()});
        if(pathname.endsWith('/anim')){const leaf=__state.pets.main.anim;leaf.counter++;leaf.data={name:data.name};}
        if(pathname.endsWith('/say')){const leaf=__state.pets.main.say;leaf.counter++;leaf.data=data;}
        return json({ok:true});
      }
      return new Response('',{status:404});
    };
    window.__cleanups=[];window.__overlay=null;
    window.__ctx={effect:fn=>{const result=fn();if(typeof result==='function')__cleanups.push(result);},locale:{register:()=>()=>{},bind:()=>s=>s},get:()=>undefined,
      slots:{inject(name,fn){for(const value of fn()){}},register(meta,component){if(meta.id==='pet')window.__overlay=component;return()=>{};}}};
    window.__ModuleLoader__={load(spec){window.__petModule=spec.factory(name=>{if(name==='react')return React;if(name==='react/jsx-runtime')return __jsx;if(name==='react-dom'||name==='react-dom/client')return ReactDOM;return {};});__petModule.apply(__ctx);}};
  })()`);
  await evaluate(client);
  await evaluate(`window.__reactRoot=ReactDOM.createRoot(document.getElementById('pet'));window.__mount=()=>ReactDOM.flushSync(()=>__reactRoot.render(React.createElement(__overlay)));__mount();`);
  await until(`window.__dshPetCtl?.getRoot()?.isConnected && document.querySelector('video.is-front')?.readyState>=2`, '完整原版准备客户端必须真实挂载并解码原生待机');
  const pixels = await evaluate(`(()=>{const v=document.querySelector('video.is-front'),c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');x.drawImage(v,0,0,160,90);const p=x.getImageData(0,0,160,90).data;let count=0;for(let i=3;i<p.length;i+=4)if(p[i]>30)count++;return count;})()`);
  assert.ok(pixels > 80, '实际视频 canvas 不能空白：' + pixels);
  await evaluate(`window.__makeLink=()=>new Function('env','with(env){'+${JSON.stringify(link)}+';return {...petLink,state:petLinkState,runtime:petLinkRuntime,eligible:petLinkEligible,set:petLinkSetLogicTune};}')( {window,document,location,performance,Date,getComputedStyle:el=>window.getComputedStyle(el),AbortController,fetch,apiUrl:p=>'/wallpaper-engine'+p,weT:s=>s,wallSidebarToggle:()=>{window.__toggles=(window.__toggles||0)+1;return true;},wallSidebarOpen:()=>{},wallSidebarClose:()=>{},setTimeout:(fn,ms)=>window.setTimeout(fn,ms),clearTimeout:id=>window.clearTimeout(id),setInterval:(fn,ms)=>window.setInterval(fn,ms),clearInterval:id=>window.clearInterval(id),requestAnimationFrame:fn=>window.requestAnimationFrame(fn),cancelAnimationFrame:id=>window.cancelAnimationFrame(id),apiFetch:async(path,init)=>{const r=await fetch(path,init);return {ok:r.ok,data:await r.json()};}});window.__link=__makeLink();__link.warmup();`);
  await evaluate('__cap.available=false;__link.dispose();__link.warmup();');
  await until('!!__link.state.reason&&!__link.eligible()', '首次缺资格必须报告原因');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'D',ctrlKey:true,shiftKey:true,bubbles:true}));`);
  assert.equal(await evaluate(`__link.tuner.isOpen()&&document.querySelector('[data-tuner="run"]').disabled`), true);
  const beforeMaintenance = await evaluate('__log.length');
  await evaluate(`__link.tuner.setForLogic('mascot','mascotDropPx',92);document.querySelector('[data-tuner="run"]').click();`);
  assert.equal(await evaluate(`JSON.parse(document.querySelector('[data-tuner="out"]').value).logicValues.mascot.mascotDropPx`), 92);
  assert.equal(await evaluate('__log.length'), beforeMaintenance);
  const maintenanceArt = new URL('../.artifacts/pet-hotplug/', import.meta.url); mkdirSync(maintenanceArt, { recursive: true });
  const maintenanceShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL('maintenance-' + width + 'x' + height + '.png', maintenanceArt), Buffer.from(maintenanceShot.data, 'base64'));
  await evaluate(`__link.tuner.reset('mascot');__cap.available=true;`);
  await until('__link.eligible()', '实际当前桌宠与桥接共同取得资格');
  assert.equal(await evaluate(`document.querySelector('[data-tuner="run"]').disabled`), false);
  await evaluate(`__link.tuner.open();__link.set('mascot','mascotWalkMs',600);void(window.__run=__link.tuner.run('mascot'));`);
  await until(`__log.some(e=>e.path.includes('/anim')&&e.data.name==='吉祥物-跳抓眩晕落地起身-dshwe')&&window.__dshPetCtl.getPlayback().name==='吉祥物-跳抓眩晕落地起身-dshwe'&&window.__dshPetCtl.getPlayback().phase==='playing'`, '真实左蟹步后进入跳抓视频');
  await until(`window.__dshPetCtl.getPlayback().name==='吉祥物-跳抓眩晕落地起身-dshwe'&&document.querySelector('video.is-front')?.currentTime>2.65&&!!__link.state.ropeRelease`, '真实抓绳下拉阶段必须已开始');
  await evaluate('__link.tuner.close()');
  const art = new URL('../.artifacts/pet-hotplug/', import.meta.url); mkdirSync(art, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(new URL('mounted-' + width + 'x' + height + '.png', art), Buffer.from(shot.data, 'base64'));
  await evaluate(`__cap.linkEnabled=false;`);
  await until(`!__link.eligible()&&!__link.state.runner?.busy&&!window.__dshPetLock&&!window.__dshPetBubbleLock`, '关闭联动必须终止真实跳抓');
  const stopped = await evaluate(`({posts:__log.length,frames:__link.runtime.frames.size,waits:__link.runtime.waits.size,requests:__link.runtime.requests.size,panel:!!document.querySelector('[data-pet-tuner]')})`);
  assert.equal(stopped.frames, 0); assert.equal(stopped.waits, 0); assert.equal(stopped.requests, 0); assert.equal(stopped.panel, true);
  assert.equal(await evaluate(`document.querySelector('[data-tuner="run"]').disabled`), true);
  assert.deepEqual(await evaluate(`({transform:document.querySelector('.we-rope').style.transform,transition:document.querySelector('.we-rope').style.transition})`), { transform: '', transition: '' });
  await delay(900); assert.equal(await evaluate('__log.length'), stopped.posts, '撤销后不得迟发抓绳/侧栏点播');
  await evaluate('__cap.linkEnabled=true;'); await until('__link.eligible()', '联动开关无刷新恢复');
  await evaluate(`ReactDOM.flushSync(()=>__reactRoot.render(null));`);
  await until('!__link.eligible()&&!__link.runtime.ctl', '桌宠原生卸载撤销资格并回收控制引用');
  const beforeFallback = await evaluate('__log.length');
  await evaluate('__link.mascot.tap()'); assert.equal(await evaluate('__toggles'), 1); assert.equal(await evaluate('__log.length'), beforeFallback);
  await evaluate('__mount()'); await until('__link.eligible()', '实际 React 重挂后新实例自动恢复');
  await evaluate(`window.__old=__link;window.__link=__makeLink();__link.warmup();`);
  await until('__link.eligible()', '新一代壁纸接管');
  assert.equal(await evaluate('__old.warmup()'), false, '旧代不允许夺回新代');
  await evaluate('__old.dispose()'); assert.equal(await evaluate('__link.eligible()'), true);
  for (let i = 0; i < 10; i++) {
    await evaluate(`__link.dispose();window.__link=__makeLink();__link.warmup();`);
    await until('__link.eligible()', '浏览器第 ' + i + ' 次重挂');
  }
  await verifyEgg2Browser({ evaluate, until, send, width, height, art });
  await evaluate(`__link.dispose();ReactDOM.flushSync(()=>__reactRoot.unmount());for(const fn of __cleanups.reverse())fn();`);
  const clean = await evaluate(`({frames:__link.runtime.frames.size,waits:__link.runtime.waits.size,requests:__link.runtime.requests.size,started:__link.runtime.started,action:!!window.__dshPetLock,bubble:!!window.__dshPetBubbleLock,root:!!document.querySelector('.dsh-pet-root'),errors:__errors})`);
  assert.deepEqual(clean, { frames: 0, waits: 0, requests: 0, started: false, action: false, bubble: false, root: false, errors: [] });
  assert.equal(await evaluate(`!!document.querySelector('[data-pet-tuner]')`), false);
  assert.deepEqual(errors, []);
  console.log('PASS 完整安装客户端真实 React/素材挂载、跳抓中撤销、原生回退、桌宠重挂、世代替换和十次热启停 ' + width + 'x' + height + '，有效素材像素 ' + pixels);
} finally {
  for (const p of pending.values()) clearTimeout(p.timer);
  if (socket) socket.close();
  if (browser.exitCode === null) { const exited = new Promise(resolve => { browser.once('exit', resolve); }); browser.kill(); await exited; }
}
