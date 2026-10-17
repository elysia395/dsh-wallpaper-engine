#!/usr/bin/env node
/** 真实彩蛋一编排与几何：碰撞时刻、双次反击及取消边界。 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const tuner=readFileSync(new URL('../packages/pet-link/src/pet-link-tuner.js',import.meta.url),'utf8');
const pet=readFileSync(new URL('../packages/pet-link/src/pet-link.js',import.meta.url),'utf8');
function load(options={}) {
  let now=0,serial=0,nativeId=0,flightEnd=0,base={left:500,top:100},locked=false;
  const tasks=new Map(),events=[];const record=(type,data)=>events.push({type,data,at:now});
  const schedule=(fn,ms)=>{const id=++serial;tasks.set(id,{fn,at:now+ms});return id;};
  let target=1400,from=1400,started=0,duration=1;
  const liveEdge=()=>from+(target-from)*Math.min(1,(now-started)/duration);
  const sidebar={edgeX:liveEdge,rebound(open,ms){from=liveEdge();target=open?1100:1400;started=now;duration=ms;record(open?'open':'close');},
    open(){this.rebound(true,240);},close(){this.rebound(false,180);},commit(){record('restore');},isOpen:()=>target<1400};
  const width=options.width||640,height=width*9/16;
  const ctl={lock(){locked=true;return true;},unlock(){locked=false;record('unlock');},setBubbleDuration(){},hideBubble(){},
    throwNative(point,velocity){record('throw',{point,velocity,edge:liveEdge()});base={left:point.x-width/2,top:point.y-height/2};flightEnd=now+(options.flightMs||800);return ++nativeId;},
    getNativeThrow(id){return {active:id===nativeId&&now<flightEnd,cancelled:id!==nativeId};},stopNativeThrow(id){if(id!==nativeId)return false;record('stop');nativeId++;return true;}};
  const env={options,ctl,sidebar,base:()=>base,width,height,record,window:{innerWidth:1400,innerHeight:900},weT:x=>x,
    setTimeout:schedule,clearTimeout:id=>tasks.delete(id),setInterval:undefined,clearInterval:undefined,requestAnimationFrame:fn=>schedule(fn,10),performance:{now:()=>now}};
  const mod=new Function(...Object.keys(env),tuner+'\n'+pet+`
    petLinkState.offset={x:0,y:0};petLinkState.activeLogic='egg1';petLinkState.available=true;
    const rect=()=>({left:base().left+petLinkState.offset.x,top:base().top+petLinkState.offset.y,width,height});
    const el={style:{},querySelector:()=>({getBoundingClientRect:rect})};
    petLinkPetEl=()=>el;petLinkPetRect=rect;petLinkPetCtl=()=>ctl;petLinkProbe=async()=>true;petLinkEligible=()=>true;
    petLinkSay=async()=>true;petLinkMascot.registerSidebar(sidebar);
    petLinkPost=async(url,body)=>{if(!url.includes('/anim?'))return true;const key=Object.keys(PET_ANIM).find(k=>PET_ANIM[k]===body.name);record('request',key);if(key==='eggFlung')await petLinkWait(options.ackMs||0);record('play',key);return !(key==='eggFlung'&&options.failPlay);};
    for(const [k,v]of Object.entries({egg1WalkMs:100,egg1LeadMs:0,egg1KickMs:200,egg1FlungMs:600,egg1LandMs:100,egg1FlingDelayMs:0,egg1FlingPx:420,egg1FlingMs:520,egg1PostLandMs:10,egg1EdgeGapPx:0}))petLinkSetLogicTune('egg1',k,v);
    return {state:petLinkState,rect,ctl,set:(k,v)=>petLinkSetLogicTune('egg1',k,v),run:()=>petLinkTuner.run('egg1'),
      anchor:typeof petLinkEggAnchorX==='function'?petLinkEggAnchorX:null,
      rebound:typeof petLinkEggRebound==='function'?petLinkEggRebound:null,
      dispose:()=>petLink.dispose()};
  `)(...Object.values(env));
  const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
  async function advance(to){await flush();for(let count=0;count<50000;count++){let first;for(const [id,t]of tasks)if(!first||t.at<first.t.at)first={id,t};if(!first||first.t.at>to){now=to;await flush();return;}now=first.t.at;tasks.delete(first.id);first.t.fn();await flush();}throw Error('无界调度');}
  return {...mod,events,advance,liveEdge,locked:()=>locked};
}
let failures=0;async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+': '+e.message);}}
await check('去程按真实踢出脚尖对边，三尺寸不依赖身体框或逻辑一手位',async()=>{
  for(const width of [640,462,250]){const h=load({width});assert.equal(typeof h.anchor,'function');const p=h.run();await h.advance(150);assert.ok(Math.abs(h.anchor(h.rect(),425/640)-1400)<.2);h.dispose();await h.advance(20000);await p;}
});
await check('被弹飞实际开播后首次侧栏接触即起飞，随后缩回再展开',async()=>{
  const h=load({ackMs:500});const p=h.run();await h.advance(750);assert.equal(h.events.filter(e=>e.type==='open').length,0);await h.advance(2500);
  const hit=h.events.find(e=>e.type==='throw');assert.ok(hit,'必须调用原生抛掷');const play=h.events.find(e=>e.type==='play'&&e.data==='eggFlung');assert.ok(hit.at>=play.at);
  const steps=h.events.filter(e=>['open','close','throw'].includes(e.type));assert.deepEqual(steps.map(e=>e.type),['open','throw','close','open']);
  assert.equal(hit.at,steps[2].at,'碰撞当帧起飞并开始回缩，不能等第二次弹出');
  assert.ok(hit.data.velocity.vx<0&&hit.data.velocity.vy<0);assert.ok(hit.data.edge<1400&&hit.data.edge>1100,'首次只弹到人物，非完全展开后再起飞');
  await h.advance(20000);await p;assert.equal(h.liveEdge(),1100);assert.equal(h.locked(),false);
});
await check('物理仍在运动时不能演落地，结束后自动回程解锁',async()=>{
  const h=load({flightMs:2200});const p=h.run();await h.advance(1800);assert.equal(h.events.find(e=>e.type==='play'&&e.data==='eggLand'),undefined);
  const hit=h.events.find(e=>e.type==='throw');await h.advance(20000);await p;const land=h.events.find(e=>e.type==='play'&&e.data==='eggLand');assert.ok(land.at>=hit.at+2200);assert.equal(h.state.runner.busy,false);
});
await check('碰撞前、飞行中和回缩中取消不留下物理，不再二次展开',async()=>{
  for(const at of [310,380,450]){const h=load();const p=h.run();await h.advance(at);h.dispose();const n=h.events.filter(e=>e.type==='open').length;await h.advance(20000);await p;assert.equal(h.events.filter(e=>e.type==='open').length,n);assert.equal(h.locked(),false);assert.equal(h.state.throwRelease,null);}
});
await check('点播失败不触发侧栏反击或物理，仍有限退出',async()=>{
  const h=load({failPlay:true});const p=h.run();await h.advance(20000);await p;assert.equal(h.events.filter(e=>e.type==='throw'||e.type==='open').length,0);assert.equal(h.locked(),false);
});
if(failures)process.exitCode=1;
