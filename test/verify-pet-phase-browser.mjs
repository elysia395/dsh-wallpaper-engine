#!/usr/bin/env node
/** 隔离 Edge 执行实际视频槽、原片与联动回程，不连接用户页面。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { applyLifecycleEdits } from '../packages/pet-link/tools/patch-pet-client.mjs';
assert.ok(process.env.PET_TEST_CLIENT, '请通过 PET_TEST_CLIENT 指定已准备的隔离桌宠客户端，不要使用活动安装');
const old = readFileSync(process.env.PET_TEST_CLIENT,'utf8');
const client = old.includes('adoptPosition(point)') ? old : applyLifecycleEdits(old);
const part = (a,b) => { const start=client.indexOf(a),end=client.indexOf(b,start+a.length);assert.ok(start>=0&&end>start);return client.slice(start,end); };
const switchCode = part('\t\tconst handleEnded = (e) => {','\t\tconst moveRef = useRef(null);')+'\n'+part('\t\tconst switchTo = (next, nextOnce) => {','\n\t\tuseEffect(() => {');
const controlCode = part('\t\t\t\tgetPlayback() {','\t\t\t\tlockBubbles(')+part('\t\t\t\tadoptPosition(point) {','\n\t\t\t\tlock(');
const tuner=readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js',import.meta.url),'utf8');
const pet=readFileSync(new URL('../packages/pet-link/src/pet-link.js',import.meta.url),'utf8');
const assets={};
for(const side of ['左','右']) assets[side]=readFileSync(new URL('../packages/pet-link/assets/webm/通用-'+side+'侧螃蟹步-dshwe.webm',import.meta.url)).toString('base64');
const profile=mkdtempSync(join(tmpdir(),'pet-phase-verify-'));
const browser=spawn(process.env.PET_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let socket,id=0,launchError;
const pending=new Map();
browser.on('error',err=>{launchError=err;});
function send(method,params={}) { return new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},10000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));}); }
async function evaluate(expression) {const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;}
try {
  let port;const deadline=Date.now()+20000;
  while(!port&&Date.now()<deadline) {if(launchError)throw launchError;try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch(e){if(e.code!=='ENOENT'&&e.code!=='EBUSY')throw e;}if(!port)await delay(100);}
  assert.ok(port,'Edge 未能开启调试端口');
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=({data})=>{const r=JSON.parse(data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);if(r.error)p.reject(Error(JSON.stringify(r.error)));else p.resolve(r.result);};
  await send('Page.enable');
  const artDir=new URL('../.artifacts/pet-tuner/',import.meta.url);mkdirSync(artDir,{recursive:true});
  for(const [width,height,side]of [[1366,900,'左'],[360,640,'右']]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`(() => {
      document.body.innerHTML='';document.body.style.cssText='margin:0;background:#f5f7f6';
      const root=document.createElement('div');root.className='dsh-pet-root';
      const size=${width===1366?400:250},h=size*9/16;
      const home={x:innerWidth*${side==='左'?0.35:0.7},y:innerHeight*0.65};
      const start={x:innerWidth*${side==='左'?0.75:0.3},y:innerHeight*0.55};
      root.style.cssText='position:fixed;width:'+size+'px;height:'+h+'px;left:'+(start.x-size/2)+'px;top:'+(start.y-h/2)+'px';
      const stage=document.createElement('div');stage.className='dsh-pet-stage';stage.style.cssText='position:relative;width:100%;height:100%';root.append(stage);
      const videos=[document.createElement('video'),document.createElement('video')];for(const v of videos){v.className='dsh-pet-video';v.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain';stage.append(v);}document.body.append(root);
      const bytes=Uint8Array.from(atob(${JSON.stringify(assets[side])}),c=>c.charCodeAt(0));const blob=new Blob([bytes],{type:'video/webm'});
      let locked=false;const events=[],frames=[];let nativePos=start;
      const media={linkPlaybackRef:{current:{id:0,name:'',phase:'idle'}},pendingRef:{current:null},pendingSquashRef:{current:false},pendingMoveRef:{current:false},
        frontRef:{current:0},genRef:{current:0},videoARef:{current:videos[0]},videoBRef:{current:videos[1]},
        petAnims:{events:{}},isEventAnim:()=>false,cfg:{id:'main'},THUMB_EXT:'.webm',inflightRef:{current:[]},mountedRef:{current:true},blobUrlRef:{current:{a:null,b:null}},
        AbortController,window,URL,facingRef:{current:'left'},fetch:async()=>{await new Promise(r=>setTimeout(r,350));return{ok:true,blob:async()=>blob};},
        readLock:()=>locked?{derived:false}:null,console,rootRef:{current:root},halfW:size/2,halfH:h/2,
        customPosRef:{current:null},setCustomPos:p=>{nativePos={x:p.rx*innerWidth,y:p.ry*innerHeight};},stopMove(){},stopThrow(){},stopDragFollow(){},
      };
      const videoApi=new Function('env','with(env){'+${JSON.stringify(switchCode)}+';return{switchTo};}')(media);
      const ctl=new Function('env','with(env){return({'+${JSON.stringify(controlCode)}+'});}')(media);
      Object.assign(ctl,{lock(){locked=true;events.push({type:'lock',at:performance.now()});return true;},unlock(){locked=false;events.push({type:'unlock',at:performance.now()});},pollState(){}});
      window.__dshPetCtl=ctl;
      const module=new Function('el','videoApi',${JSON.stringify(tuner+'\n'+pet+`\npetLinkPetEl=()=>el;petLinkProbe=async()=>true;petLinkPost=async(url,body)=>{if(url.includes('/anim')){videoApi.switchTo(body.name,true);}return true;};petLinkState.offset={x:0,y:0};return{state:petLinkState,back:(home)=>petLinkReturnHomeWalk(600,()=>true,home),dispose:()=>petLink.dispose()};`)})(root,videoApi);
      const initial=root.getBoundingClientRect().toJSON(),trace={root,media,ctl,module,events,frames,home,initial,done:false};window.__phase=trace;
      function sample(){if(trace.done)return;const r=root.getBoundingClientRect(),p=ctl.getPlayback();frames.push({at:performance.now(),x:r.left+r.width/2,y:r.top+r.height/2,phase:p.phase,currentTime:p.currentTime});requestAnimationFrame(sample);}sample();
      trace.promise=module.back(home).then(ok=>{trace.ok=ok;trace.done=true;trace.final=root.getBoundingClientRect().toJSON();trace.native=nativePos;trace.locked=locked;trace.offset={...module.state.offset};});
    })()`);
    await delay(200);
    assert.ok(await evaluate(`__phase.frames.every(f=>Math.abs(f.x-(__phase.initial.left+__phase.initial.width/2))<0.1)`),'真实视频仍加载时不能位移');
    await evaluate(`new Promise((resolve,reject)=>{const deadline=performance.now()+7000;function sample(){const p=__phase.ctl.getPlayback();if(p.phase==='playing'&&p.currentTime>0.25)return resolve(true);if(performance.now()>deadline)return reject(Error('真实WebM未开播'));requestAnimationFrame(sample);}sample();})`);
    const picture=await send('Page.captureScreenshot',{format:'png'});writeFileSync(new URL('phase-real-walk-'+width+'x'+height+'.png',artDir),Buffer.from(picture.data,'base64'));
    const pixels=await evaluate(`(()=>{const el=(__phase.media.frontRef.current===0?__phase.media.videoARef:__phase.media.videoBRef).current;const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');ctx.drawImage(el,0,0,640,360);const d=ctx.getImageData(0,0,640,360).data;let visible=0;for(let i=3;i<d.length;i+=4)if(d[i]>20)visible++;return visible;})()`);
    assert.ok(pixels>2000,'实际螃蟹步必须有非空透明视频像素');
    const result=await evaluate(`__phase.promise.then(()=>({frames:__phase.frames,events:__phase.events,final:__phase.final,home:__phase.home,native:__phase.native,locked:__phase.locked,offset:__phase.offset,ok:__phase.ok}))`);
    assert.equal(result.ok,true);assert.equal(result.locked,false);assert.deepEqual(result.offset,{x:0,y:0});
    assert.ok(Math.abs(result.final.left+result.final.width/2-result.home.x)<0.1);assert.ok(Math.abs(result.final.top+result.final.height/2-result.home.y)<0.1);
    assert.ok(Math.abs(result.native.x-result.home.x)<0.1&&Math.abs(result.native.y-result.home.y)<0.1,'原生坐标与回程终点一致');
    const moving=result.frames.filter((f,i,a)=>i>0&&Math.abs(f.x-a[i-1].x)>0.1);
    assert.ok(moving.length>=8,'回程必须有连续中间位移帧');assert.ok(moving.every(f=>f.phase==='playing'),'位移只发生在实际螃蟹步开播之后');
    const unlock=result.events.at(-1);const lastFrame=result.frames.at(-1);assert.ok(unlock.at>=lastFrame.at-60,'末帧结束才释放动作');
    await evaluate(`__phase.module.dispose();for(const url of Object.values(__phase.media.blobUrlRef.current))if(url)URL.revokeObjectURL(url);`);
    console.log('PASS 真实'+side+'侧螃蟹步加载等待、连续位移、原生坐标交还与末帧解锁 '+width+'x'+height+'；有效像素 '+pixels);
  }
} finally {
  for(const p of pending.values())clearTimeout(p.timer);if(socket)socket.close();
  if(browser.exitCode===null){const exited=new Promise(r=>{browser.once('exit',r);});browser.kill();await exited;}
}
