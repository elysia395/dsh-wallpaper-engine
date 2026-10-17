#!/usr/bin/env node
/** 可选的真实 Edge 回归，不替换宿主服务、不触碰用户浏览器配置。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { stripExportBlocks } from './tools/js-text.mjs';

const edge = process.env.PET_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = mkdtempSync(join(tmpdir(), 'pet-tuner-verify-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const pending = new Map();
let socket;
let nextId = 0;
let launchError;
browser.on('error', err => { launchError = err; });
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!reply.exceptionDetails, JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}
try {
  let port;
  const deadline = Date.now() + 20000;
  while (!port && Date.now() < deadline) {
    if (launchError) throw launchError;
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); }
    catch (err) { if (!['ENOENT', 'EBUSY'].includes(err.code)) throw err; }
    if (!port) await delay(100);
  }
  assert.ok(port, 'Edge 未能开启调试端口');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(p => p.type === 'page');
  assert.ok(page, 'Edge 未创建测试页面');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const reply = JSON.parse(data);
    const call = pending.get(reply.id);
    if (!call) return;
    pending.delete(reply.id);
    clearTimeout(call.timeout);
    if (reply.error) call.reject(new Error(JSON.stringify(reply.error)));
    else call.resolve(reply.result);
  };
  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  const tuner = readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js', import.meta.url), 'utf8');
  const pet = readFileSync(new URL('../packages/pet-link/src/pet-link.js', import.meta.url), 'utf8');
  const copy = readFileSync(new URL('../src/i18n-copy.js', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');
  const moduleSource = stripExportBlocks(copy + '\n' + i18n) + '\n' + tuner + '\n' + pet + '\nreturn petLink;';
  await evaluate(`document.body.style.cssText='margin:0;background:#eee';
    const stale=document.createElement('div'); stale.setAttribute('data-pet-tuner','1'); document.body.appendChild(stale);
    window.__legacyCalls=0; window.__legacyHandler=()=>window.__legacyCalls++;
    document.addEventListener('keydown',window.__legacyHandler);
    window.__loadTestPet=new Function(${JSON.stringify(moduleSource)});
    window.__testGenerations=[];
    for(let i=0;i<3;i++) {
      const pet=window.__loadTestPet(); window.__testGenerations.push(pet); pet.tuner.open();
    }
    window.__testPet=window.__testGenerations.at(-1);
    window.__testTuner=window.__testPet.tuner;`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-pet-tuner]').length`), 1, '三次加载及旧版遗留清理后只能有一个面板');
  await evaluate(`for(const old of window.__testGenerations.slice(0,-1)) { old.dispose(); old.warmup(); old.tuner.open(); }`);
  assert.ok(await evaluate(`document.querySelectorAll('[data-pet-tuner]').length===1 && window.__testTuner.isOpen()`), '旧代延迟卸载不得删除或抢占新面板');
  const hotkey = async () => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'D', code: 'KeyD', windowsVirtualKeyCode: 68, modifiers: 10 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'D', code: 'KeyD', windowsVirtualKeyCode: 68, modifiers: 10 });
  };
  await hotkey();
  assert.equal(await evaluate('window.__testTuner.isOpen()'), false, '一次真实热键必须只切换一次');
  // 旧版监听同时注册 keydown，匹配热键不能再传给它。
  assert.equal(await evaluate('window.__legacyCalls'), 0, '捕获热键必须阻止旧版匿名监听');
  await hotkey();
  assert.ok(await evaluate(`window.__testTuner.isOpen() && document.querySelectorAll('[data-pet-tuner]').length===1`), '再次按键应只重开一个面板');
  await evaluate(`window.__testPet.dispose(); window.__testPet.dispose();`);
  await hotkey();
  assert.equal(await evaluate(`document.querySelectorAll('[data-pet-tuner]').length`), 0, '卸载后真实热键不能重建面板');
  await evaluate(`window.__testPet.warmup(); window.__testPet.warmup();`);
  await hotkey();
  assert.ok(await evaluate(`window.__testTuner.isOpen() && document.querySelectorAll('[data-pet-tuner]').length===1`), '同代重新挂载必须恢复单次热键');
  await evaluate(`document.removeEventListener('keydown',window.__legacyHandler);`);
  console.log('PASS 真实浏览器三代加载、旧代延迟卸载、旧版清理与真实热键');
  const bubbleResult = await evaluate(`(() => {
    const root=document.querySelector('[data-pet-tuner]');
    const page=logic=>root.querySelector('[data-tuner-page="'+logic+'"]');
    const tab=logic=>root.querySelector('[data-tuner-tab="'+logic+'"]');
    const el=(id,key)=>root.querySelector('[data-tuner-bubble="'+id+'"] [data-tuner="'+key+'"]');
    const change=(id,key,value,type='change')=>{ const input=el(id,key); input.value=value; input.dispatchEvent(new Event(type,{bubbles:true})); };
    const run=window.__testTuner.run, calls=[], pages=[];
    window.__testTuner.run=logic=>{calls.push(logic); return Promise.resolve(true);};
    for(const [logic,count] of Object.entries({sidebar:1,mascot:1,egg1:2,egg2:1})) {
      tab(logic).click();
      const visible=[...root.querySelectorAll('[data-tuner-page]')].filter(p=>getComputedStyle(p).display!=='none');
      pages.push({logic,count:page(logic).querySelectorAll('[data-tuner-bubble]').length,expected:count,
        visible:visible.map(p=>p.getAttribute('data-tuner-page')),run:root.querySelector('[data-tuner-run]').getAttribute('data-tuner-run'),
        buttons:[...root.querySelectorAll('[data-tuner-tab],[data-tuner-run]')].filter(b=>getComputedStyle(b).display!=='none').length});
    }
    const passive=calls.length===0;
    root.querySelector('[data-tuner-run]').click();
    window.__testTuner.run=run;
    tab('sidebar').click();
    change('sidebar','bubble-show-action','pull'); change('sidebar','bubble-show-edge','end'); change('sidebar','bubble-show-offset','-300','input');
    change('sidebar','bubble-hide-action','duration'); change('sidebar','bubble-hide-offset','1500','input');
    const edit=(logic,key,value)=>{const input=page(logic).querySelector('[data-tuner="'+key+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
    edit('sidebar','bubbleMs','1111');
    tab('egg1').click(); edit('egg1','bubbleMs','3333');
    change('egg1Angry','bubble-show-action','eggKick'); change('egg1Angry','bubble-show-offset','100','input');
    change('egg1Land','bubble-show-action','eggLand'); change('egg1Land','bubble-show-offset','200','input');
    tab('mascot').click(); edit('mascot','bubbleMs','2222'); root.querySelector('[data-tuner="reset-current"]').click();
    tab('sidebar').click();
    return {pages,passive,calls,target:!!root.querySelector('[data-tuner="bubbleTarget"]'),show:el('sidebar','bubble-show-offset').value,
      snapshot:window.__testTuner.snapshot(),exported:JSON.parse(root.querySelector('[data-tuner="out"]').value)};
  })()`);
  assert.equal(bubbleResult.target, false);
  assert.equal(bubbleResult.passive, true);
  assert.deepEqual(bubbleResult.calls, ['egg2']);
  for (const result of bubbleResult.pages) {
    assert.deepEqual(result.visible, [result.logic]); assert.equal(result.run, result.logic);
    assert.equal(result.count, result.expected); assert.equal(result.buttons, 4);
  }
  assert.equal(bubbleResult.show, '-300');
  assert.equal(bubbleResult.snapshot.bubbleTiming.sidebar.hide.offsetMs, 1500);
  assert.equal(bubbleResult.snapshot.bubbleTiming.egg1Angry.show.offsetMs, 100);
  assert.equal(bubbleResult.snapshot.bubbleTiming.egg1Land.show.offsetMs, 200);
  assert.equal(bubbleResult.snapshot.logicValues.sidebar.bubbleMs, 1111);
  assert.equal(bubbleResult.snapshot.logicValues.mascot.bubbleMs, 3000);
  assert.equal(bubbleResult.snapshot.logicValues.egg1.bubbleMs, 3333);
  assert.deepEqual(bubbleResult.snapshot, bubbleResult.exported);
  console.log('PASS 真实浏览器四页独占、固定气泡、单播放与三切页、独立重置及全量JSON');
  const factoryResult = await evaluate(`(() => {
    const root=document.querySelector('[data-pet-tuner]');
    root.querySelector('[data-tuner-tab="sidebar"]').click();
    root.querySelector('[data-tuner="reset-current"]').click();
    const current=JSON.parse(root.querySelector('[data-tuner="out"]').value);
    const bubble=root.querySelector('[data-tuner-bubble="sidebar"]');
    const controls={show:bubble.querySelector('[data-tuner="bubble-show-action"]').value,
      offset:bubble.querySelector('[data-tuner="bubble-show-offset"]').value,
      hide:bubble.querySelector('[data-tuner="bubble-hide-action"]').value,
      duration:bubble.querySelector('[data-tuner="bubble-hide-offset"]').value};
    [...root.querySelectorAll('button')].find(button=>button.textContent==='全部重置').click();
    return {current,controls,all:JSON.parse(root.querySelector('[data-tuner="out"]').value)};
  })()`);
  const factoryTiming = {show:{action:'pull',edge:'start',offsetMs:7000},hide:{action:'duration',edge:'start',offsetMs:5000}};
  assert.deepEqual(factoryResult.current.bubbleTiming.sidebar, factoryTiming);
  assert.equal(factoryResult.current.logicValues.egg1.bubbleMs, 3333, '当前重置不能清除彩蛋一覆盖');
  assert.deepEqual(factoryResult.controls, {show:'pull',offset:'7000',hide:'duration',duration:'5000'});
  assert.deepEqual(factoryResult.all.bubbleTiming.sidebar, factoryTiming);
  assert.equal(factoryResult.all.logicValues.egg1.bubbleMs, 3000);
  console.log('PASS 真实浏览器当前及全部重置恢复逻辑一7000/5000出厂节点，控件与JSON一致');
  const motionResult = await evaluate(`(() => {
    const root=document.querySelector('[data-pet-tuner]');
    root.querySelector('[data-tuner-tab="mascot"]').click();
    const page=root.querySelector('[data-tuner-page="mascot"]');
    const values={mascotReleaseAtMs:3100,mascotDropPx:110,mascotDropMs:650};
    const change=(key,value,type)=>{const el=page.querySelector('[data-tuner="'+key+'"]');el.value=String(value);el.dispatchEvent(new Event(type,{bubbles:true}));return el.tagName;};
    for(const [key,value] of Object.entries(values)) change(key,value,'input');
    const selects=['mascotRopePullEase','mascotRopeBackEase'].map(key=>change(key,0,'change'));
    const saved=JSON.parse(root.querySelector('[data-tuner="out"]').value);
    root.querySelector('[data-tuner="reset-current"]').click();
    const removed=['mascotRecoverAtMs','mascotRecoverMs'].every(key=>!page.querySelector('[data-tuner="'+key+'"]')
      && !Object.hasOwn(saved.values,key) && !Object.hasOwn(saved.defaults,key));
    return {values,selects,saved,removed,reset:window.__testTuner.snapshot()};
  })()`);
  assert.equal(motionResult.removed,true,'不能残留额外起身归位控件或默认参数');
  assert.deepEqual(motionResult.selects, ['SELECT','SELECT']);
  for(const [key,value] of Object.entries(motionResult.values)) assert.equal(motionResult.saved.logicValues.mascot[key],value);
  assert.equal(motionResult.saved.logicValues.mascot.mascotRopePullEase,0);
  assert.equal(motionResult.reset.logicValues.mascot.mascotDropPx,motionResult.reset.defaults.mascotDropPx);
  assert.deepEqual(motionResult.saved.logicValues.sidebar,motionResult.reset.logicValues.sidebar);
  await evaluate(`document.querySelector('[data-tuner-tab="sidebar"]').click()`);
  console.log('PASS 真实浏览器逻辑二脱手/下落及缓动控件输入、私有JSON和当前重置，无额外归位控件');
  const eggResult = await evaluate(`(() => {
    const root=document.querySelector('[data-pet-tuner]');
    root.querySelector('[data-tuner-tab="egg1"]').click();
    const page=root.querySelector('[data-tuner-page="egg1"]');
    const before=window.__testTuner.snapshot();
    const values={egg1EdgeGapPx:-25,egg1FlingDelayMs:250,egg1PostLandMs:900};
    for(const [key,value] of Object.entries(values)) {
      const input=page.querySelector('[data-tuner="'+key+'"]');
      input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    const valid=page.querySelector('[data-tuner="egg1EdgeGapPx"]').checkValidity();
    const saved=JSON.parse(root.querySelector('[data-tuner="out"]').value);
    root.querySelector('[data-tuner="reset-current"]').click();
    return {values,valid,saved,before,reset:window.__testTuner.snapshot()};
  })()`);
  assert.equal(eggResult.valid,true,'负间距不应被HTML最小值限制');
  for(const [key,value] of Object.entries(eggResult.values)) {
    assert.equal(eggResult.saved.logicTuning.egg1[key],value);
    assert.equal(eggResult.reset.logicValues.egg1[key],eggResult.reset.defaults[key]);
  }
  for(const logic of ['sidebar','mascot']) assert.deepEqual(eggResult.reset.logicValues[logic],eggResult.before.logicValues[logic]);
  await evaluate(`document.querySelector('[data-tuner-tab="sidebar"]').click()`);
  console.log('PASS 真实浏览器彩蛋一负间距、弹飞延迟、落地停留及私有JSON和当前重置');
  const rect = () => evaluate(`(() => { const r=document.querySelector('[data-pet-tuner]').getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; })()`);
  await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  await evaluate(`window.__dragTrace=[];
    window.addEventListener('error', e=>window.__dragTrace.push({error:e.message}));
    for(const type of ['pointerdown','pointermove','pointerup','blur','resize','gotpointercapture','lostpointercapture'])
    window.addEventListener(type,e=>window.__dragTrace.push({type:e.type,target:e.target?.getAttribute?.('data-tuner'),primary:e.isPrimary,button:e.button,id:e.pointerId,buttons:e.buttons,x:e.clientX,y:e.clientY}),true)`);
  const first = await rect();
  const grip = await evaluate(`(() => { const r=document.querySelector('[data-tuner="drag"]').getBoundingClientRect(); return {x:r.x+20,y:r.y+10}; })()`);
  const mouse = (type, x, y, button = 'none', buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
  await mouse('mouseMoved', grip.x, grip.y);
  await mouse('mousePressed', grip.x, grip.y, 'left', 1);
  await evaluate('new Promise(r => requestAnimationFrame(r))');
  await mouse('mouseMoved', grip.x - 220, grip.y + 60, 'none', 1);
  await mouse('mouseReleased', grip.x - 220, grip.y + 60, 'left');
  const moved = await rect();
  assert.ok(Math.abs(moved.x - first.x + 220) < 1 && Math.abs(moved.y - first.y - 60) < 1,
    `真实指针拖动不符: ${JSON.stringify({ first, moved, trace: await evaluate('window.__dragTrace') })}`);
  await evaluate(`window.__testTuner.close(); window.__testTuner.toggle();`);
  assert.deepEqual(await rect(), moved, '重开须保留位置');
  const outDir = join(fileURLToPath(new URL('../', import.meta.url)), '.artifacts', 'pet-tuner');
  mkdirSync(outDir, { recursive: true });
  for (const [width, height] of [[1366, 900], [360, 640], [320, 480]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    for (const logic of ['sidebar', 'mascot', 'egg1', 'egg2']) {
      await evaluate(`document.querySelector('[data-tuner-tab="${logic}"]').click(); document.querySelector('[data-pet-tuner]').scrollTop=0;`);
      await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      const r = await rect();
      assert.ok(r.x >= 0 && r.y >= 0 && r.right <= width && r.bottom <= height, JSON.stringify(r));
      const overflow = await evaluate(`(() => { const root=document.querySelector('[data-pet-tuner]');
        return root.scrollWidth-root.clientWidth; })()`);
      assert.ok(overflow <= 1, `${logic} 横向溢出 ${overflow}px (${width}x${height})`);
      const buttons = await evaluate(`[...document.querySelectorAll('[data-tuner-tab],[data-tuner-run]')]
        .filter(b=>getComputedStyle(b).display!=='none').map(b=>({height:b.getBoundingClientRect().height,
          horizontal:b.scrollWidth-b.clientWidth,vertical:b.scrollHeight-b.clientHeight}))`);
      for (const button of buttons) assert.ok(button.height === 44 && button.horizontal <= 1 && button.vertical <= 1,
        `${logic} 导航尺寸不稳定或文字溢出: ${JSON.stringify(button)}`);
      const png = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, `tuner-${logic}-${width}x${height}.png`), Buffer.from(png.data, 'base64'));
      if (logic === 'sidebar') writeFileSync(join(outDir, `tuner-${width}x${height}.png`), Buffer.from(png.data, 'base64'));
      const fields = await evaluate(`(() => { const page=document.querySelector('[data-tuner-page="${logic}"]');
        return [...page.querySelectorAll('[data-tuner-bubble]')].flatMap(bubble=>['show','hide'].map(kind=>{
          const unit=bubble.querySelector('[data-tuner="bubble-'+kind+'-unit"]');
          const input=bubble.querySelector('[data-tuner="bubble-'+kind+'-offset"]');
          return {height:unit.getBoundingClientRect().height,overflow:unit.scrollWidth-unit.clientWidth,width:input.getBoundingClientRect().width};
        })); })()`);
      for (const field of fields) assert.ok(field.height <= 18 && field.overflow <= 1 && field.width >= 70,
        `${logic} 节点标签或数字栏被挤压 (${width}x${height}): ${JSON.stringify(field)}`);
      if (logic === 'mascot') {
        await evaluate(`document.querySelector('[data-tuner-page="mascot"] [data-tuner="mascotReleaseAtMs"]').closest('label').scrollIntoView({block:'center'});`);
        await evaluate('new Promise(r => requestAnimationFrame(r))');
        const motionFields = await evaluate(`(() => {
          const page=document.querySelector('[data-tuner-page="mascot"]');
          return ['mascotRopePullEase','mascotRopeBackEase','mascotReleaseAtMs','mascotDropPx','mascotDropMs'].map(key=>{
            const el=page.querySelector('[data-tuner="'+key+'"]'),label=el.closest('label'),text=label.querySelector('span');
            const a=el.getBoundingClientRect(),b=text.getBoundingClientRect();
            return {key,width:a.width,gap:a.left-b.right,overflow:label.scrollWidth-label.clientWidth};
          });
        })()`);
        for(const field of motionFields) assert.ok(field.width>=100 && field.gap>=7 && field.overflow<=1,JSON.stringify(field));
        const motionPng=await send('Page.captureScreenshot',{format:'png'});
        writeFileSync(join(outDir,`tuner-mascot-motion-${width}x${height}.png`),Buffer.from(motionPng.data,'base64'));
      }
      if (logic === 'egg1') {
        const eggFields = await evaluate(`(() => {
          const page=document.querySelector('[data-tuner-page="egg1"]');
          return ['egg1EdgeGapPx','egg1FlingDelayMs','egg1FlingPx','egg1FlingMs','egg1PostLandMs'].map(key=>{
            const el=page.querySelector('[data-tuner="'+key+'"]'),label=el.closest('label'),text=label.querySelector('span');
            const a=el.getBoundingClientRect(),b=text.getBoundingClientRect();
            return {key,width:a.width,gap:a.left-b.right,overflow:label.scrollWidth-label.clientWidth};
          });
        })()`);
        for(const field of eggFields) assert.ok(field.width>=100 && field.gap>=7 && field.overflow<=1,JSON.stringify(field));
        for(const [key,area] of [['egg1EdgeGapPx','gap'],['egg1FlingDelayMs','flight']]) {
          await evaluate(`document.querySelector('[data-tuner-page="egg1"] [data-tuner="${key}"]').closest('label').scrollIntoView({block:'center'});`);
          await evaluate('new Promise(r => requestAnimationFrame(r))');
          const png=await send('Page.captureScreenshot',{format:'png'});
          writeFileSync(join(outDir,`tuner-egg1-${area}-${width}x${height}.png`),Buffer.from(png.data,'base64'));
        }
      }
      await evaluate(`document.querySelector('[data-tuner-page="${logic}"] [data-tuner-bubble]').scrollIntoView({block:'start'});`);
      await evaluate('new Promise(r => requestAnimationFrame(r))');
      const nodes = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, `tuner-${logic}-nodes-${width}x${height}.png`), Buffer.from(nodes.data, 'base64'));
      console.log(`PASS 真实浏览器 ${logic} 固定气泡与全部参数 ${width}x${height}`);
    }
    console.log(`PASS 真实浏览器拖动、重开、尺寸与四页内容 ${width}x${height}`);
  }
  const motionSource = tuner + '\n' + pet + `
    return { pull(el) {
      petLinkRopeEl=()=>el;
      petLinkSetLogicTune('mascot','mascotRopeDownPx',90);
      petLinkSetLogicTune('mascot','mascotRopePullMs',240);
      petLinkSetLogicTune('mascot','mascotRopeBackMs',240);
      petLinkSetLogicTune('mascot','mascotRopePullEase',0);
      petLinkSetLogicTune('mascot','mascotRopeBackEase',0);
      return petLinkPullRopeDown(()=>true,120);
    }, drop(el) {
      petLinkPetEl=()=>el;
      return petLinkMascotDrop(()=>true,petLinkNow(),0,{distance:90,dropMs:120});
    }, reset: () => petLinkResetOffset() };`;
  const transitionResult = await evaluate(`(async () => {
    const motion=new Function('weT',${JSON.stringify(motionSource)})(x=>x);
    const el=document.createElement('div');
    el.style.cssText='position:fixed;width:30px;height:30px;transform:translate(0px,0px);transition:top 280ms ease,left 280ms ease';
    document.body.appendChild(el);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    el.getBoundingClientRect();
    let done=false; const samples=[]; const started=performance.now();
    const pending=motion.pull(el).then(()=>{done=true;});
    while(!done && performance.now()-started<5000){
      await new Promise(r=>requestAnimationFrame(r));
      samples.push(new DOMMatrix(getComputedStyle(el).transform).m42);
    }
    if(!done) throw new Error('实际下拉动效未收敛');
    await pending;
    const restored={property:el.style.transitionProperty,duration:el.style.transitionDuration,transform:el.style.transform};
    el.remove();return {samples,restored};
  })()`);
  const peak=transitionResult.samples.indexOf(Math.max(...transitionResult.samples));
  assert.ok(transitionResult.samples.slice(0,peak).some(y=>y>1 && y<89),'下拉必须有可见中间帧');
  assert.ok(transitionResult.samples.slice(peak+1).some(y=>y>1 && y<89),'弹回必须有可见中间帧');
  assert.equal(transitionResult.restored.property,'top, left');
  assert.equal(transitionResult.restored.transform,'translate(0px, 0px)');
  console.log('PASS 真实浏览器下拉和弹回均有中间位移帧，并还原原过渡样式');
  const dropResult = await evaluate(`(async () => {
    const motion=new Function('weT',${JSON.stringify(motionSource)})(x=>x);
    const el=document.createElement('div');
    el.style.cssText='position:fixed;width:30px;height:30px;left:100px;top:100px;transform:translate(0px,0px)';
    document.body.appendChild(el);
    let done=false; const samples=[]; const started=performance.now();
    const pending=motion.drop(el).then(()=>{done=true;});
    while(!done && performance.now()-started<3000) {
      await new Promise(r=>requestAnimationFrame(r));
      samples.push(new DOMMatrix(getComputedStyle(el).transform).m42);
    }
    if(!done) throw new Error('实际下落未收敛');
    await pending;
    const landed=new DOMMatrix(getComputedStyle(el).transform).m42;
    await new Promise(r=>setTimeout(r,300));
    const held=new DOMMatrix(getComputedStyle(el).transform).m42;
    motion.reset();
    const cleared=new DOMMatrix(getComputedStyle(el).transform).m42;
    el.remove(); return {samples,landed,held,cleared};
  })()`);
  assert.ok(dropResult.samples.some(y=>y>1 && y<89),'下落必须有真实中间帧');
  assert.equal(dropResult.landed,90); assert.equal(dropResult.held,90);
  assert.equal(dropResult.cleared,0);
  console.log('PASS 真实浏览器下落90像素后保持落点，无额外起身归位且统一清理可归零');
  // 彩蛋一完整物理与双次反击由 verify-pet-egg1-native-browser.mjs 验证。
  const grabFrame = process.env.PET_TEST_GRAB_FRAME
    ? 'data:image/png;base64,' + readFileSync(process.env.PET_TEST_GRAB_FRAME).toString('base64') : '';
  const mascotMotionSource = tuner + '\n' + pet + `
    return { start(el,rope) {
      const events=[];let locked=false;
      const record=key=>events.push({key,at:performance.now(),rect:petLinkPetRect().toJSON()});
      petLinkPetEl=()=>el;petLinkRopeEl=()=>rope;
      petLinkPetCtl=()=>({lock(){locked=true;return true;},unlock(){locked=false;record('unlock');},setBubbleDuration(){},hideBubble(){}});
      petLinkProbe=async()=>true;petLinkSay=async()=>true;
      petLinkPost=async(url,body)=>{
        if(!url.includes('/anim?')) return true;
        const key=Object.keys(PET_ANIM).find(key=>PET_ANIM[key]===body.name);
        record('request-'+key);
        if(key==='walkLeft') await petLinkWait(180);
        record(key);return true;
      };
      petLinkState.available=true;
      petLinkMascot.registerSidebar({open(){record('open');},close(){},isOpen:()=>false});
      petLinkWaitSidebarClose=()=>petLinkWait(150).then(()=>'closed');
      for(const [key,value] of Object.entries({mascotWalkMs:400,mascotTumbleMs:1450,
        mascotGrabAtMs:300,mascotOpenAtMs:600,mascotRopeDownPx:0,mascotRopePullMs:200,
        mascotReleaseAtMs:750,mascotRopeBackMs:200,mascotDropPx:80,mascotDropMs:260})) petLinkSetLogicTune('mascot',key,value);
      return {pending:petLinkTuner.run('mascot'),state:petLinkState,events,locked:()=>locked,dispose:()=>petLink.dispose(),
        walkName:PET_ANIM.walkLeft};
    } };`;
  for(const [width,height,size] of [[1366,900,640],[360,640,320]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`(async()=>{
      document.querySelector('[data-pet-tuner]')?.remove();
      const el=document.createElement('div');
      el.style.cssText='position:fixed;left:'+Math.max(0,innerWidth-${size})+'px;top:200px;width:${size}px;height:${size*9/16}px;z-index:100';
      const stage=document.createElement('div');stage.className='dsh-pet-stage';
      stage.style.cssText='position:relative;width:100%;height:100%;transform:translateY(${24*size/640}px)';
      const frame=document.createElement('img');frame.style.cssText='width:100%;height:100%;display:block';
      if(${JSON.stringify(grabFrame)}) {frame.src=${JSON.stringify(grabFrame)};await frame.decode();}
      stage.appendChild(frame);el.appendChild(stage);
      const rope=document.createElement('div');rope.className='we-rope';rope.style.cssText='position:fixed;left:${size===640?240:70}px;top:60px;width:50px;height:60px;background:#16a085;z-index:90';
      document.body.append(el,rope);
      const motion=new Function('weT',${JSON.stringify(mascotMotionSource)})(x=>x).start(el,rope);
      const initial=el.getBoundingClientRect().toJSON();let done=false;
      motion.pending.then(()=>{done=true;});
      const trace={el,stage,rope,motion,initial,frames:[],done:()=>done};
      window.__mascotMotion=trace;
      const sample=()=>{if(done) return;const r=el.getBoundingClientRect();trace.frames.push({at:performance.now(),x:r.x,y:r.y});requestAnimationFrame(sample);};
      requestAnimationFrame(sample);
    })()`);
    const aligned=await evaluate(`(async()=>{
      const m=window.__mascotMotion;const started=performance.now();
      while(performance.now()-started<4000){
        await new Promise(r=>requestAnimationFrame(r));
        const jump=m.motion.events.find(e=>e.key==='mascotTumble');
        if(jump && performance.now()-jump.at>=330){
          const s=m.stage.getBoundingClientRect(),r=m.rope.getBoundingClientRect();
          return {hand:{x:s.left+s.width*312/640,y:s.top+s.height*36/360},rope:{x:r.left+r.width/2,y:r.top,bottom:r.bottom},
            jump,initial:m.initial,frames:m.frames.slice(),walkName:m.motion.walkName,events:m.motion.events.slice()};
        }
      }
      throw new Error('逻辑二未进入双手触顶时刻');
    })()`);
    assert.ok(Math.abs(aligned.hand.x-aligned.rope.x)<0.15,'去程已将双手中点对准吉祥物');
    assert.ok(Math.abs(aligned.hand.y-aligned.rope.y)<0.15,'去程站位让素材自身跳跃触顶（含stage偏移）');
    assert.ok(aligned.walkName.includes('左侧螃蟹步'),'去程请求必须是左侧螃蟹步素材');
    const request=aligned.events.find(e=>e.key==='request-walkLeft'),ack=aligned.events.find(e=>e.key==='walkLeft');
    assert.ok(ack.at-request.at>=170,'真实请求延迟被覆盖');
    assert.ok(aligned.frames.filter(f=>f.at<ack.at).every(f=>Math.abs(f.x-aligned.initial.x)<0.15 && Math.abs(f.y-aligned.initial.y)<0.15),'左蟹步确认前不移动');
    assert.ok(aligned.frames.some(f=>f.at>ack.at && f.at<aligned.jump.at && Math.abs(f.x-aligned.initial.x)>1),'确认后具有真实走路中间位移帧');
    const png=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(outDir,`mascot-grab-aligned-${width}x${height}.png`),Buffer.from(png.data,'base64'));
    const landing=await evaluate(`(async()=>{
      const m=window.__mascotMotion;const jump=m.motion.events.find(e=>e.key==='mascotTumble');
      while(performance.now()-jump.at<1200) await new Promise(r=>requestAnimationFrame(r));
      const r=m.el.getBoundingClientRect(),f=m.stage.getBoundingClientRect();
      const landed={x:r.left+r.width/2,y:r.top+r.height/2,bagTop:f.top+f.height*4/360};
      const count=m.frames.length;await new Promise(r=>setTimeout(r,100));
      const held=m.el.getBoundingClientRect().toJSON();
      await m.motion.pending;
      const result={landed,held,jump,frames:m.frames.slice(0,count),busy:m.motion.state.runner.busy,
        locked:m.motion.locked(),offset:{...m.motion.state.offset}};
      m.motion.dispose();m.el.remove();m.rope.remove();return result;
    })()`);
    assert.ok(Math.abs(landing.landed.x-aligned.rope.x)<0.15,'下落横向仍到原吉祥物中心');
    assert.ok(Math.abs(landing.landed.y-(Math.min(height-60,aligned.rope.bottom+120)+80))<0.15,'下落仍到调整前认可的绝对终点');
    assert.ok(Math.abs(landing.held.top+landing.held.height/2-landing.landed.y)<0.15,'落地后无额外起身归位');
    assert.ok(landing.frames.filter(f=>f.at>aligned.jump.at && f.at<aligned.jump.at+700).every(f=>Math.abs(f.x-aligned.jump.rect.left)<0.15 && Math.abs(f.y-aligned.jump.rect.top)<0.15),'跳抓阶段根画布不额外上抬或平移');
    assert.equal(landing.busy,false);assert.equal(landing.locked,false);assert.deepEqual(landing.offset,{x:0,y:0});
    console.log('PASS 真实浏览器左蟹步确认后贴近站位、双手自然触顶无上抬及原落点保持 '+width+'x'+height+(grabFrame?'（去白袋素材帧）':''));
  }
  console.log('ALL PET TUNER BROWSER CHECKS PASSED');
} finally {
  for (const call of pending.values()) clearTimeout(call.timeout);
  if (socket) socket.close();
  if (browser.exitCode === null) {
    const exited = new Promise(resolve => { browser.once('exit', resolve); });
    browser.kill();
    await exited;
  }
}
