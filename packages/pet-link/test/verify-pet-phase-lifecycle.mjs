#!/usr/bin/env node
/** 执行真实联动及桌宠控制片段，覆盖开播回执、分轨释放和原生漫游后的回程。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as patcher from '../tools/patch-pet-client.mjs';
const input = readFileSync(process.argv[2], 'utf8');
const source = process.argv.includes('--installed') ? input : patcher.applyLifecycleEdits ? patcher.applyLifecycleEdits(input) : input;
const repo = new URL('../../../', import.meta.url);
const pet = readFileSync(new URL('src/pet-link.js', repo), 'utf8');
const tuner = readFileSync(new URL('src/pet-link-tuner.js', repo), 'utf8');
const part = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a + from.length); assert.ok(a >= 0 && b > a); return source.slice(a, b); };
let failures = 0;
async function check(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message); } }
function control() {
  let now = 0, cursor = 0, mounted = false;
  const slots = [], effects = [], calls = [], window = { innerWidth: 1000, innerHeight: 800 };
  const env = { window, cfg: { id: 'main' }, Date: { now: () => now }, console: { log() {}, warn() {} },
    petAnims: { idle: ['idle'], events: { DSHWE: ['walk', 'pull'] } }, animRef: { current: 'pull' },
    stopMove: () => calls.push('stop'), stopThrow() {}, stopDragFollow() {}, pick: a => a[0], setSeqRaw() {},
    statePoller: { now() {} }, customPosRef: { current: null }, setCustomPos: p => calls.push(p),
    rootRef: { current: { style: {}, getBoundingClientRect: () => ({ left: 100, top: 100, width: 100, height: 60 }) } },
    halfW: 50, halfH: 30, videoARef: { current: { currentTime: 1, duration: 5 } }, videoBRef: { current: null }, frontRef: { current: 0 },
    useState(v) { const i = cursor++; if (!(i in slots)) slots[i] = v; return [slots[i], n => { slots[i] = typeof n === 'function' ? n(slots[i]) : n; }]; },
    useRef(v) { const i = cursor++; if (!(i in slots)) slots[i] = { current: v }; return slots[i]; },
    useEffect(fn) { if (!mounted) effects.push(fn); },
  };
  const body = part('\t\tconst [anim, setAnimRaw]', '\t\tconst [facing,') + '\n' + part('\t\tconst [bubbleOn,', '\t\tconst menuRef') + '\n' + part('\t\t// ── pet-link 补丁：页内控制面', '\t\tuseEffect(() => () => {');
  const render = () => { cursor = 0; effects.length = 0; const r = new Function('env', 'with(env){let bubbleDurationMs=10000; const bubbleDuration=()=>bubbleDurationMs;' + body + ';return {anim,whisperBubbleOn,show:()=>setWhisperBubbleOn(true),setAnim};}')(env); for (const fn of effects) fn(); mounted = true; return r; };
  render(); return { window, render, calls, advance: ms => now += ms };
}
await check('动作独占不再顺带锁住或清掉原生气泡', () => {
  const h = control(); h.render().show(); h.window.__dshPetCtl.lock('pull'); h.render().setAnim('pull');
  assert.equal(h.render().whisperBubbleOn, true);
  h.render().setAnim('idle'); assert.notEqual(h.render().anim, 'idle');
});
await check('气泡先释放不提前释放动作，动作先释放也不提前释放气泡', () => {
  const h = control(), ctl = h.window.__dshPetCtl;
  assert.equal(typeof ctl.lockBubbles, 'function'); ctl.lockBubbles(); ctl.lock('pull'); ctl.unlockBubbles();
  h.render().show(); assert.equal(h.render().whisperBubbleOn, true); assert.equal(ctl.isLocked(), true);
  ctl.lockBubbles(); ctl.hideBubble(); ctl.unlock(); h.render().show();
  assert.equal(h.render().whisperBubbleOn, false); assert.equal(ctl.isLocked(), false);
  ctl.unlockBubbles(); h.render().show(); assert.equal(h.render().whisperBubbleOn, true);
});
await check('独立气泡锁有超时兜底且跨 React 重渲染共享', () => {
  const h = control(), ctl = h.window.__dshPetCtl;
  assert.equal(typeof ctl.lockBubbles, 'function'); ctl.lockBubbles(100); h.render().show(); assert.equal(h.render().whisperBubbleOn, false);
  h.advance(101); h.render().show(); assert.equal(h.render().whisperBubbleOn, true);
});
await check('位置交还由桌宠自己接收，不留下 transform 或改变可见中心', () => {
  const h = control(), ctl = h.window.__dshPetCtl;
  assert.equal(typeof ctl.adoptPosition, 'function'); assert.equal(ctl.adoptPosition({ x: 400, y: 240 }), true);
  assert.deepEqual(h.calls.at(-1), { rx: 0.4, ry: 0.3 });
});
function motion() {
  let now = 0, serial = 0, native = { x: 700, y: 400 };
  const tasks = new Map(), events = [], playback = { name: '', phase: 'idle', id: 0 };
  const schedule = (fn, ms) => { const id = ++serial; tasks.set(id, { fn, at: now + ms }); return id; };
  const env = { performance: { now: () => now }, setInterval: undefined, setTimeout: schedule, clearTimeout: id => tasks.delete(id), requestAnimationFrame: fn => schedule(fn, 10), weT: s => s,
    window: { __dshPetCtl: { lock() { return true; }, unlock() {}, getPlayback: () => ({ ...playback }), pollState() {}, adoptPosition(p) { native = p; return true; } } },
    document: { querySelector: () => null },
    record: (type, data) => events.push({ type, data, at: now }), rect: off => ({ left: native.x + off.x - 50, top: native.y + off.y - 30, width: 100, height: 60 }),
    post: async (url, body) => { if (url.includes('/anim')) { playback.name = body.name; playback.phase = 'loading'; playback.id++; schedule(() => { playback.phase = 'playing'; }, 400); schedule(() => { playback.phase = 'ended'; }, 1400); } return true; },
  };
  const mod = new Function(...Object.keys(env), tuner + '\n' + pet + `
    petLinkProbe=async()=>true;petLinkPost=post;
    const el={style:new Proxy({}, {set(t,k,v){t[k]=v;record('style',v);return true;}})};
    petLinkPetEl=()=>el;petLinkPetRect=()=>rect(petLinkState.offset||{x:0,y:0});
    petLinkState.offset={x:120,y:40}; petLinkState.runner={busy:true};
    return {state:petLinkState,play:()=>petLinkPlay('walkLeft',{internal:true,hold:0,gap:0}),
      back:()=>petLinkReturnHomeWalk(600,()=>true,{x:300,y:220}),
      waitEnd:()=>typeof petLinkFinishAction==='function'?petLinkFinishAction(()=>true):Promise.resolve(),
      remaining:()=>petLinkPlaybackRemaining('walk',75),
      handoff:()=>typeof petLinkHandoffPosition==='function'?petLinkHandoffPosition():false};
  `)(...Object.values(env));
  const flush = async () => { for (let i=0;i<40;i++) await Promise.resolve(); };
  const advance = async to => { await flush(); for(let i=0;i<20000;i++){let first;for(const [id,t] of tasks)if(!first||t.at<first.t.at)first={id,t};if(!first||first.t.at>to){now=to;await flush();return;}now=first.t.at;tasks.delete(first.id);first.t.fn();await flush();}throw Error('计时器未收敛');};
  return { ...mod, events, advance, playback, position: () => ({ x: native.x + mod.state.offset.x, y: native.y + mod.state.offset.y }) };
}
await check('接口已成功但视频仍加载时，点播不提前宣告开播', async () => {
  const h = motion(); let done = false; const p = h.play().then(ok => { done=ok; });
  await h.advance(200); assert.equal(done,false); await h.advance(500); await p; assert.equal(done,true);
});
await check('回程等真实开播，存在连续中间帧，原生漫游后仍回到触发前坐标', async () => {
  const h = motion(); const p = h.back(); await h.advance(200); assert.equal(h.events.length,0);
  await h.advance(750); const middle = h.events.length; assert.ok(middle>5); assert.ok(h.state.offset.x<120 && h.state.offset.x>-400);
  await h.advance(7000); await p; assert.equal(h.state.lastKey,'通用-左侧螃蟹步-dshwe');
  assert.deepEqual(h.position(),{x:300,y:220}); assert.deepEqual(h.state.offset,{x:0,y:0});
});
await check('末段实际未播完不提前释放，结束后立刻清续期标记', async () => {
  const h=motion();const p=h.play();await h.advance(500);await p;let done=false;const end=h.waitEnd().then(()=>done=true);
  await h.advance(1000);assert.equal(done,false);await h.advance(1600);await end;assert.equal(done,true);assert.equal(h.state.animLockName,'');
});
await check('交还位置时清偏移，原生走位接手前后不发生视觉跳变', async()=>{
  const h=motion();assert.equal(h.handoff(),true);assert.deepEqual(h.state.offset,{x:0,y:0});
});
await check('真实switchTo只在playing回执开播，ended在显式锁下仍可观察', async()=>{
  const handlers = new Map();
  const video = { style:{},classList:{add(){},remove(){},contains:()=>true}, addEventListener:(n,fn)=>handlers.set(n,fn),removeEventListener(){},load(){},pause(){},play:async()=>{} };
  const env={linkPlaybackRef:{current:{id:0,name:'',phase:'idle'}},pendingRef:{current:null},pendingSquashRef:{current:false},
    pendingMoveRef:{current:false},frontRef:{current:0},genRef:{current:0},videoARef:{current:{...video}},videoBRef:{current:video},
    petAnims:{events:{}},isEventAnim:()=>false,cfg:{id:'main'},THUMB_EXT:'.webm',inflightRef:{current:[]},mountedRef:{current:true},
    blobUrlRef:{current:{a:null,b:null}},AbortController,window:{setTimeout:()=>1,clearTimeout(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},
    facingRef:{current:'left'},fetch:async()=>({ok:true,blob:async()=> 'video'}),readLock:()=>({derived:false}),console,
  };
  const code=part('\t\tconst handleEnded = (e) => {','\t\tconst moveRef = useRef(null);')+'\n'+part('\t\tconst switchTo = (next, nextOnce) => {','\n\t\tuseEffect(() => {');
  const api=new Function('env','with(env){'+code+';return{switchTo,handleEnded};}')(env);
  api.switchTo('walk',true);for(let i=0;i<12;i++)await Promise.resolve();assert.equal(env.linkPlaybackRef.current.phase,'loading');
  handlers.get('loadeddata')();assert.equal(env.linkPlaybackRef.current.phase,'loading');handlers.get('playing')();assert.equal(env.linkPlaybackRef.current.phase,'playing');
  api.handleEnded({currentTarget:video});assert.equal(env.linkPlaybackRef.current.phase,'ended');
  const oldPlaying=handlers.get('playing');api.switchTo('pull',true);oldPlaying();assert.equal(env.linkPlaybackRef.current.name,'pull');assert.equal(env.linkPlaybackRef.current.phase,'loading');
  api.handleEnded({currentTarget:video});assert.equal(env.linkPlaybackRef.current.phase,'loading');
});
await check('等真实开播时取消不产生迟到位移',async()=>{
  const h=motion();const p=h.back();await h.advance(100);h.state.epoch++;await h.advance(7000);assert.equal(await p,false);assert.equal(h.events.length,0);
});
function flow(logic, failWalk = false) {
  let now=0, serial=0, name='', phase='idle', playbackId=0, action=false, bubble=false, native={x:600,y:300};
  const tasks=new Map(),events=[];
  const record=(type,data)=>events.push({type,data,at:now});
  const schedule=(fn,ms)=>{const id=++serial;tasks.set(id,{fn,at:now+Math.max(0,ms)});return id;};
  const ctl={lock(n){name=n;action=true;record('lock',n);return true;},unlock(){action=false;record('unlock');},
    lockBubbles(){bubble=true;return true;},unlockBubbles(){bubble=false;record('bubble-unlock');return true;},
    getPlayback:()=>({id:playbackId,name,phase,duration:0.3}),setBubbleDuration(){},hideBubble(){},allowBubble(){},
    adoptPosition(p){native=p;record('adopt',p);return true;}};
  const env={window:{__dshPetCtl:ctl,innerWidth:1000,innerHeight:700},weT:x=>x,performance:{now:()=>now},
    setTimeout:schedule,clearTimeout:id=>tasks.delete(id),setInterval:undefined,requestAnimationFrame:fn=>schedule(fn,10),
    rect:off=>({left:native.x+off.x-50,top:native.y+off.y-30,width:100,height:60}),record,
    post:async(url,body)=>{if(url.includes('/anim')){if(failWalk&&body.name.includes('螃蟹步'))return false;name=body.name;playbackId++;const id=playbackId;phase='loading';schedule(()=>{if(id===playbackId){phase='playing';record('playing',body.name);}},80);schedule(()=>{if(id===playbackId){phase='ended';record('ended',body.name);}},380);}return true;},
    hold:async()=>{record('hold-enter',{action,bubble});await new Promise(r=>schedule(r,400));record('hold-free',{action,bubble});native={x:820,y:400};record('native-walk');await new Promise(r=>schedule(r,100));return 'closed';},
  };
  const mod=new Function(...Object.keys(env),tuner+'\n'+pet+`
    petLinkPetEl=()=>({style:new Proxy({}, {set(t,k,v){t[k]=v;record('style',v);return true;}})});petLinkPetRect=()=>rect(petLinkState.offset||{x:0,y:0});
    petLinkStops=()=>({rightEdge:{x:900,y:350},rope:{left:200,top:50,width:50,height:57},W:1000,H:700});
    petLinkEligible=()=>true;petLinkProbe=async()=>true;petLinkPost=post;petLinkSay=async()=>true;petLinkWaitSidebarClose=hold;
    petLinkState.offset={x:0,y:0};petLinkState.available=true;
    petLinkMascot.registerSidebar({mode:'official',isOpen:()=>true,edgeX:()=>900,beginPull(){},commit(){},open(){},close(){}});
    Object.assign(petLinkState.tuning,{sidebarWalkMs:100,braceMs:50,pullMs:200,slowOpenMs:40,openDelayMs:0,openLeadMs:0,
      followGraceMs:0,followStillMs:10,mascotWalkMs:100,mascotTumbleMs:10000,mascotGrabAtMs:20,mascotOpenAtMs:20,
      mascotReleaseAtMs:40,mascotRopePullMs:20,mascotRopeDownPx:0,mascotDropPx:0,
      egg1WalkMs:100,egg1LeadMs:20,egg1KickMs:50,egg1FlungMs:50,egg1LandMs:10000,egg1FlingPx:20,egg1FlingMs:20,egg1PostLandMs:50,
      egg2LeadMs:20,egg2HissMs:10000,segGapMs:0,bubbleMs:100});
    for(const spec of PET_BUBBLE_SPECS) petLinkSetBubbleTiming(spec.id,{show:{action:'default',edge:'start',offsetMs:0},hide:{action:'duration',edge:'start',offsetMs:200}});
    return{state:petLinkState,run:()=>petLinkTuner.run(${JSON.stringify(logic)}),dispose:()=>petLink.dispose()};
  `)(...Object.values(env));
  const flush=async()=>{for(let i=0;i<45;i++)await Promise.resolve();};
  const advance=async to=>{await flush();for(let i=0;i<30000;i++){let f;for(const[id,t]of tasks)if(!f||t.at<f.t.at)f={id,t};if(!f||f.t.at>to){now=to;await flush();return;}now=f.t.at;tasks.delete(f.id);f.t.fn();await flush();}throw Error('流程计时器未收敛');};
  return{...mod,events,advance,position:()=>({...native}),locks:()=>({action,bubble})};
}
for(const logic of ['sidebar','mascot','egg1','egg2']) await check('真实排播按主演出与回程独立释放：'+logic,async()=>{
  const h=flow(logic);let done=false;const p=h.run().then(()=>done=true);await h.advance(20000);await p;assert.equal(done,true);
  assert.deepEqual(h.locks(),{action:false,bubble:false});assert.deepEqual(h.position(),{x:600,y:300});
  const first=h.events.find(e=>e.type==='unlock'),returned=h.events.filter(e=>e.type==='playing'&&e.data.includes('螃蟹步')).at(-1);
  assert.ok(first,'主演出需要主动释放');
  if(logic==='sidebar'||logic==='mascot'){
    const entered=h.events.find(e=>e.type==='hold-enter'),free=h.events.find(e=>e.type==='hold-free');
    assert.equal(entered.data.action,false);assert.deepEqual(free.data,{action:false,bubble:false});
    assert.ok(returned.at>free.at);assert.ok(h.events.some(e=>e.type==='lock'&&e.at>free.at));
  }
  if(logic==='egg1'||logic==='mascot'||logic==='egg2')assert.ok(first.at<10000,'真实末段结束不应等旧的10秒猜测时长');
  if(logic==='egg2')assert.equal(h.events.filter(e=>e.type==='playing'&&e.data.includes('螃蟹步')).length,0,'彩蛋二原地哈气不能凭空加去程');
});
await check('结束负偏移使用真实视频剩余时长，未知元数据回退而不产生NaN',()=>{
  const h=motion();Object.assign(h.playback,{name:'walk',duration:10,currentTime:2});assert.equal(h.remaining(),8000);
  h.playback.duration=Infinity;assert.equal(h.remaining(),75);h.playback.duration=10;h.playback.name='other';assert.equal(h.remaining(),75);
});
await check('走路点播失败后安全收尾，不能滑行并继续后拉',async()=>{
  const h=flow('sidebar',true);const p=h.run();await h.advance(20000);await p;
  assert.equal(h.events.filter(e=>e.type==='playing').length,0);assert.deepEqual(h.locks(),{action:false,bubble:false});
});
if(failures) process.exitCode=1;
