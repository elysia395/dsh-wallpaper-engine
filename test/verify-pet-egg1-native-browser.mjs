#!/usr/bin/env node
/** 隔离浏览器中执行真实素材、原生抛掷和完整彩蛋一，不触碰用户页面。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
if(!process.env.PET_TEST_VIEWPORT){
  for(const viewport of ['1366x900','360x640'])await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url)],{stdio:'inherit',env:{...process.env,PET_TEST_VIEWPORT:viewport}});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('视口 '+viewport+' 测试退出 '+code)));
  });
  process.exit(0);
}
import { applyThrowEdits } from '../packages/pet-link/tools/patch-pet-client.mjs';
assert.ok(process.env.PET_TEST_CLIENT, '请通过 PET_TEST_CLIENT 指定已准备的隔离桌宠客户端，不要使用活动安装');
const original=readFileSync(process.env.PET_TEST_CLIENT,'utf8');
const source=original.includes('throwNative(point, velocity)')?original:applyThrowEdits(original);
const part=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a);return source.slice(i,j);};
const driver=part('const SPRING_K =','const PET_BOUNCE_E =')+'\n'+part('\t\tconst stopThrow =','\t\t/** rAF 弹簧跟随')+'\n'+part('\t\tconst startThrow =','\t\t/** 被撞回调');
const switchCode=part('\t\tconst handleEnded = (e) => {','\t\tconst moveRef = useRef(null);')+'\n'+part('\t\tconst switchTo = (next, nextOnce) => {','\n\t\tuseEffect(() => {');
const ctlCode=part('\t\t\t\tgetPlayback() {','\t\t\t\tlockBubbles(')+part('\t\t\t\tthrowNative(point, velocity)','\n\t\t\t\tlock(');
const moduleSource=readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../packages/pet-link/src/pet-link.js',import.meta.url),'utf8');
const assets={};
for(const name of ['通用-右侧螃蟹步-dshwe','通用-左侧螃蟹步-dshwe','彩蛋-侧边栏-半身转向踢腿-dshwe','彩蛋-侧边栏-被弹飞-dshwe','彩蛋-侧边栏-落地-dshwe'])assets[name]=readFileSync(new URL('../packages/pet-link/assets/webm/'+name+'.webm',import.meta.url)).toString('base64');
const profile=mkdtempSync(join(tmpdir(),'pet-egg1-native-'));
const browser=spawn(process.env.PET_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling','--window-size='+process.env.PET_TEST_VIEWPORT.replace('x',','),'--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let socket,id=0,launchError;const pending=new Map();browser.on('error',e=>{launchError=e;});
function send(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},10000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
  let port;const launchDeadline=Date.now()+20000;
  while(!port&&Date.now()<launchDeadline){if(launchError)throw launchError;try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch(e){if(!['ENOENT','EBUSY'].includes(e.code))throw e;}if(!port)await delay(100);}
  assert.ok(port,'Edge 未能开启调试端口');const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=({data})=>{const r=JSON.parse(data);if(r.method==='Runtime.exceptionThrown')console.error('BROWSER '+JSON.stringify(r.params));const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);if(r.error)p.reject(Error(JSON.stringify(r.error)));else p.resolve(r.result);};
  await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const artDir=new URL('../.artifacts/pet-tuner/',import.meta.url);mkdirSync(artDir,{recursive:true});
  for(const [width,height] of [process.env.PET_TEST_VIEWPORT.split('x').map(Number)]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`(()=>{
      document.body.innerHTML='';document.body.style.cssText='margin:0;background:#eef2f0';
      const size=${width===1366?400:220},h=size*9/16,home={x:innerWidth*.4,y:innerHeight*.45},events=[],frames=[];
      const record=(type,value={})=>events.push({type,at:performance.now(),...value});
      const root=document.createElement('div');root.className='dsh-pet-root';root.style.cssText='position:fixed;width:'+size+'px;height:'+h+'px;left:'+(home.x-size/2)+'px;top:'+(home.y-h/2)+'px';
      const stage=document.createElement('div');stage.className='dsh-pet-stage';stage.style.cssText='position:relative;width:100%;height:100%';root.append(stage);
      const videos=[document.createElement('video'),document.createElement('video')];for(const v of videos){v.className='dsh-pet-video';v.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain';stage.append(v);}document.body.append(root);
      const sidebar=document.createElement('div');sidebar.style.cssText='position:fixed;top:0;height:100%;width:'+Math.min(320,innerWidth*.4)+'px;left:'+innerWidth+'px;background:#d4e4de;border-left:2px solid #507d69';document.body.append(sidebar);
      const blobs={};for(const [name,b64]of Object.entries(${JSON.stringify(assets)}))blobs[name]=new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'video/webm'});
      const ref=current=>({current});let locked=false,bubbleLocked=false,opened=false;const native=[];
      const env={window,performance,requestAnimationFrame:fn=>window.requestAnimationFrame(fn),cancelAnimationFrame:id=>window.cancelAnimationFrame(id),AbortController,URL,console,
        rootRef:ref(root),size,sideAllow:100,halfW:size/2,halfH:h/2,boxPxRef:ref(null),customPosRef:ref(null),throwTokenRef:ref(0),throwRef:ref(null),throwStateRef:ref(null),
        cfg:{id:'main',physics:{gravity:1400,restitution:.4,groundFriction:5,petCollision:false}},arena:ref({slots:{}}),stopMove(){},stopDragFollow(){},startSquash(){record('squash');},setCustomPos:p=>{native.push(p);},
        linkPlaybackRef:ref({id:0,name:'',phase:'idle'}),pendingRef:ref(null),pendingSquashRef:ref(false),pendingMoveRef:ref(false),frontRef:ref(0),genRef:ref(0),videoARef:ref(videos[0]),videoBRef:ref(videos[1]),
        petAnims:{events:{}},isEventAnim:()=>false,THUMB_EXT:'.webm',inflightRef:ref([]),mountedRef:ref(true),blobUrlRef:ref({a:null,b:null}),facingRef:ref('right'),readLock:()=>locked?{derived:false}:null,
        fetch:async url=>{const name=Object.keys(blobs).find(n=>decodeURIComponent(url).includes(n));if(!name)throw Error('未知素材 '+url);await new Promise(r=>setTimeout(r,90));return{ok:true,blob:async()=>blobs[name]};},
      };
      const media=new Function('env','with(env){'+${JSON.stringify(driver+'\n'+switchCode)}+';const startThrowLatestRef={current:startThrow};return {switchTo,ctl:{'+${JSON.stringify(ctlCode)}+'}};}')(env);
      const ctl=media.ctl;const throwNative=ctl.throwNative;ctl.throwNative=function(point,velocity){record('throw',{point,velocity,edge:sidebar.getBoundingClientRect().left,contact:stage.getBoundingClientRect().left+size*370/640});return throwNative(point,velocity);};
      Object.assign(ctl,{lock(){locked=true;return true;},unlock(){locked=false;record('unlock');},lockBubbles(){bubbleLocked=true;return true;},unlockBubbles(){bubbleLocked=false;record('bubble-unlock');},isBubbleLocked:()=>bubbleLocked,pollState(){},hideBubble(){},setBubbleDuration(){}});window.__dshPetCtl=ctl;
      const move=(open,ms)=>{opened=open;sidebar.style.transition='left '+ms+'ms linear';sidebar.style.left=(open?innerWidth-Math.min(320,innerWidth*.4):innerWidth)+'px';record(open?'open':'close',{ms});};
      const module=new Function('weT','root','media','record','move','sidebar',${JSON.stringify(moduleSource+`\npetLinkPetEl=()=>root;petLinkProbe=async()=>true;petLinkSay=async()=>true;
        petLinkPost=async(url,body)=>{if(url.includes('/anim')){record('post',{name:body.name});media.switchTo(body.name,true);}return true;};
        petLinkState.available=true;petLinkMascot.registerSidebar({edgeX:()=>sidebar.getBoundingClientRect().left,isOpen:()=>true,open:()=>move(true,240),close:()=>move(false,180),rebound:move,commit(){record('commit');}});
        for(const [key,value]of Object.entries({egg1WalkMs:350,egg1LeadMs:30,egg1KickMs:5167,egg1FlungMs:300,egg1LandMs:300,egg1EdgeGapPx:0,egg1FlingDelayMs:0,egg1FlingPx:420,egg1FlingMs:520,egg1PostLandMs:30}))petLinkSetLogicTune('egg1',key,value);
        const originalRun=petLinkRun;petLinkRun=async(...args)=>{try{return await originalRun(...args);}catch(e){record('error',{message:e.stack});throw e;}};
        return{state:petLinkState,run:()=>petLinkTuner.run('egg1'),dispose:()=>petLink.dispose()};`)})(x=>x,root,media,record,move,sidebar);
      const trace={root,stage,sidebar,media,env,module,events,frames,home,native,done:false};window.__egg=trace;
      function sample(){if(trace.done)return;const r=root.getBoundingClientRect(),p=ctl.getPlayback();frames.push({at:performance.now(),x:r.left+size/2,y:r.top+h/2,edge:sidebar.getBoundingClientRect().left,toe:stage.getBoundingClientRect().left+size*425/640,phase:module.state.runner.phase,clip:p.name,play:p.phase,time:p.currentTime,active:env.throwRef.current!==null});requestAnimationFrame(sample);}sample();
      trace.promise=module.run().then(result=>{trace.result=result;trace.done=true;trace.locked=locked;trace.bubbleLocked=bubbleLocked;trace.final=root.getBoundingClientRect().toJSON();},e=>{trace.error=e.stack;trace.done=true;});
    })()`);
    let done=false,captured=false;const deadline=Date.now()+45000;
    while(!done&&Date.now()<deadline){await delay(200);const state=await evaluate(`({done:__egg.done,active:__egg.env.throwRef.current!==null,error:__egg.error})`);assert.ok(!state.error,state.error);done=state.done;if(state.active&&!captured){const image=await send('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('egg1-native-flight-'+width+'x'+height+'.png',artDir),Buffer.from(image.data,'base64'));captured=true;}}
    const result=await evaluate(`({events:__egg.events,frames:__egg.frames,done:__egg.done,error:__egg.error,locked:__egg.locked,bubbleLocked:__egg.bubbleLocked,busy:__egg.module.state.runner.busy,final:__egg.final,home:__egg.home,offset:__egg.module.state.offset,opened:parseFloat(__egg.sidebar.style.left)<innerWidth})`);
    assert.ok(done,'彩蛋一未有限结束 '+JSON.stringify({events:result.events,tail:result.frames.slice(-3)}));assert.ok(captured,'实际物理必须启动 '+JSON.stringify({events:result.events,tail:result.frames.slice(-4),result:result.error}));
    const hit=result.events.find(e=>e.type==='throw');assert.ok(hit,'首次侧栏接触应起飞');assert.ok(Math.abs(hit.edge-hit.contact)<40,'接触阈值当帧触发');
    const kicking=result.frames.filter(f=>f.clip==='彩蛋-侧边栏-半身转向踢腿-dshwe'&&f.play==='playing');assert.ok(kicking.length>8);assert.ok(kicking.every(f=>Math.abs(f.toe-width)<1),'真实DOM末帧脚尖锚点对边');
    const flight=result.frames.filter(f=>f.active&&f.at>hit.at);assert.ok(flight.length>12);assert.ok(flight.some(f=>f.x<hit.point.x-10&&f.y<hit.point.y-5),'真实重力须向后上方起飞');
    const opens=result.events.filter(e=>e.type==='open'),close=result.events.filter(e=>e.type==='close').find(e=>e.at>hit.at-2);assert.equal(opens.length,2);assert.ok(close&&opens[1].at>close.at,'首次撞击后缩回再弹出');assert.equal(result.opened,true);
    const land=result.events.find(e=>e.type==='post'&&e.name==='彩蛋-侧边栏-落地-dshwe');assert.ok(land&&land.at>=flight.at(-1).at,'物理落定后才能演落地');
    assert.equal(result.locked,false);assert.equal(result.bubbleLocked,false);assert.equal(result.busy,false);assert.deepEqual(result.offset,{x:0,y:0});
    assert.ok(Math.abs(result.final.left+result.final.width/2-result.home.x)<.2&&Math.abs(result.final.top+result.final.height/2-result.home.y)<.2,'实际落定后走回原位');
    await evaluate(`__egg.module.dispose();for(const u of Object.values(__egg.env.blobUrlRef.current))if(u)URL.revokeObjectURL(u);`);
    console.log('PASS 原片脚尖贴边、首次碰撞原生后上抛飞、缩回再展开、实际落定与连续回程 '+width+'x'+height+'，物理帧 '+flight.length);
  }
}finally{for(const p of pending.values())clearTimeout(p.timer);if(socket)socket.close();if(browser.exitCode===null){const exited=new Promise(r=>{browser.once('exit',r);});browser.kill();await exited;}}
