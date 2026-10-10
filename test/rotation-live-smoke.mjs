// React #31 校验：**对象不能作为子节点**。替身若默默吞掉，这类错就只能在真机上炸
// （实测：参数位置上的赋值表达式把"角色对象数组"当成了子节点，空表时看不出、
// 一旦筛出角色整块面板就崩）。替身必须和 React 一样**抛**。
function badChild(c) {
  if (c === null || c === undefined || typeof c === 'boolean' || typeof c === 'string' || typeof c === 'number') return null;
  if (Array.isArray(c)) { for (const x of c) { const b = badChild(x); if (b) return b; } return null; }
  if (typeof c === 'object' && c.type) return null;
  return c;
}
function assertChildren(children) {
  for (const c of children) {
    const bad = badChild(c);
    if (bad) throw new Error('React #31：无效子节点（对象不能作为子节点）: ' + JSON.stringify(Object.keys(bad)).slice(0, 80));
  }
}// Rotation prepare/commit smoke for the WebWallGL live staging path.
// 场景壁纸走「live 渲染页 staged 预载 → 首帧确认 → 领养进新层」通道：
// mock iframe 自带 __wpStats 心跳读数（running && fps>0 = 首帧已出），
// 断言 staged iframe 被新层领养（不重建）、we-live-on 立即点亮、staging
// 容器随提交移除、旧层进入渐变淡出。间隔走开发覆盖钩子
// localStorage.weRotationTestSec=10（秒），与生产路径共用同一条定时器武装逻辑。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const React = { Fragment:'Fragment', useState:(i)=>[i,()=>{}], useEffect:()=>{}, useRef:(v)=>({current:v}),
  createElement:(t,p,...c)=>{ assertChildren(c); return typeof t==='function'?t(p||{}):({type:t,props:p||null,children:c}); } };

let byId = {};
const timers = [];
const iframeEls = [];
const videoEls = [];

function makeEl(tag) {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
    style: { _props:{}, cssText:'', setProperty(k,v){this._props[k]=v;}, removeProperty(k){delete this._props[k];} },
    className: '',
    appendChild(c){ this.children.push(c); if (c.id) byId[c.id]=c; c._parent=this; return c; },
    remove(){ if (this._parent){ const i=this._parent.children.indexOf(this); if(i>=0)this._parent.children.splice(i,1); } if (this.id) delete byId[this.id]; },
    setAttribute(k,v){ this.attributes[k]=v; },
    removeAttribute(k){ delete this.attributes[k]; (this.__removedAttrs ||= []).push(k); },
    getAttribute(k){ return this.attributes[k] ?? null; },
    querySelector(sel){
      // 支持 'tag' 与 'tag.class' 两种简单选择器（深度优先）。
      const m = /^([a-z]+)(?:\.(.+))?$/.exec(sel) || [];
      const want = m[1] ? m[1].toUpperCase() : null;
      const wantCls = m[2] || '';
      const walk=(n)=>{ if (!Array.isArray(n.children)) return null; for (const c of n.children){ if (c.tagName===want && (!wantCls || String(c.className).includes(wantCls))) return c; const r=walk(c); if(r)return r; } return null; };
      return walk(this);
    },
    contains(n){ let cur=n; while(cur){ if(cur===this)return true; cur=cur._parent; } return false; },
    querySelectorAll(sel){
      const want = String(sel).split(',').map(x=>x.trim().toUpperCase());
      const out=[]; const walk=(n)=>{ if (!Array.isArray(n.children)) return; for (const c of n.children){ if (want.includes(c.tagName)) out.push(c); walk(c); } }; walk(this); return out;
    },
    get isConnected(){ let cur=this; while (cur) { if (cur._parent === undefined && cur.tagName === 'BODY') return true; if (!cur._parent) return false; cur = cur._parent; } return false; },
    addEventListener(ev,fn){ (listeners[ev] ||= []).push(fn); },
    removeEventListener(ev,fn){ const l=listeners[ev]; if(l){const i=l.indexOf(fn); if(i>=0)l.splice(i,1);} },
    __fire(ev){ (listeners[ev]||[]).slice().forEach(f=>f()); },
    // 真 DOM 语义：`play()/pause()` 会同时改 **`paused`**（产品读的是它，见 applyVideoPlayback
    // 的 `!video.paused` 短路）—— 只记 `__paused` 会让"夺回焦点后自动恢复"这条路在测试里
    // 永远走不到 play()（`!undefined === true` 早退），与真机行为分叉。
    // 取真值语义：媒体未播放时 `paused === true`，play() 后 false，pause() 后 true。
    get paused(){ return this.__paused !== false; },
    set paused(v){ this.__paused = !!v; },
    play(){ this.__plays = (this.__plays || 0) + 1; this.__paused = false; return Promise.resolve(); },
    pause(){ this.__paused = true; },
    load(){ this.__loads = (this.__loads || 0) + 1; },
  };
  // mock getElementById 的 byId 映射跟随 id 赋值实时同步（真实 DOM 语义：
  // 节点级领养会给 staging 容器事后赋 LAYER_ID）。
  let _id = '';
  Object.defineProperty(el, 'id', {
    get: () => _id,
    set: (v) => { if (_id) delete byId[_id]; _id = v || ''; if (v) byId[v] = el; },
  });
  el.classList = {
    add(c){ const parts = el.className ? el.className.split(' ') : []; if (!parts.includes(c)) { parts.push(c); el.className = parts.join(' '); } },
    remove(c){ const parts = el.className ? el.className.split(' ') : []; const i = parts.indexOf(c); if (i >= 0) { parts.splice(i, 1); el.className = parts.join(' '); } },
  };
  if (tag === 'iframe') {
    // live 渲染页控制面/心跳读数：首帧已出（running && fps>0）。
    // setVolume 记录调用序列：轮换音频闸断言用（提交瞬间必须先压 0、
    // 旧层退场后才恢复真实音量）。
    el.__volumes = [];
    el.contentWindow = {
      __wpStats: { frame: () => ({ fps: 30, running: true }) },
      __wp: { resume(){}, pause(){}, setVolume(v){ el.__volumes.push(v); }, setFit(){}, pushPointer(){}, pointerLeave(){} },
    };
  }
  return el;
}

const bodyEl = makeEl('body');
// 焦点可变：遮挡判定的**自愈**要在"事件丢了"的前提下判（原生模态会吞掉 focus 事件）。
let focusOn = true;
const document = {
  createElement: (t) => { const el = makeEl(t); if (t==='iframe') iframeEls.push(el); if (t==='video') videoEls.push(el); return el; },
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  head: { appendChild: () => {} },
  body: bodyEl,
  hidden: false,
  hasFocus: () => focusOn,
  addEventListener(){},
  removeEventListener(){},
  documentElement: makeEl('html'),
};

const localStorage = {
  _store: { 'dsh-wallpaper-engine:selection': JSON.stringify({
    id:'v', rotationGroupId:'g1', rotationEnabled:true,
    // 本套测的是「轮换交叉淡化 + 音频闸」，显式选交叉淡化（默认已是硬切）。
    switchTransition: 'fade',
    // 本次还要测遮挡自愈，显式开「窗口失焦时暂停」（默认关）。
    pauseOnBlur: true,
    videoVolume: 0.6, videoAudioEnabled: true,
    rotationGroups:[{id:'g1',name:'L',interval:5,order:'sequence',wallpaperIds:['v','s']}],
  }), weRotationTestSec: '10' },
  getItem(k){ return this._store[k] ?? null; }, setItem(k,v){ this._store[k]=v; }, removeItem(k){ delete this._store[k]; },
};
const diagPosts = [];
const diagText = (from) => diagPosts.slice(from).map((u) => { try { return decodeURIComponent(u); } catch { return u; } }).join(' | ');
const fetch = (url, init) => { if (String(url).includes('diag')) diagPosts.push(String((init && init.body) || '')); return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(
  String(url).includes('/settings') ? { ok:true, betterSidebar:false } :
  String(url).includes('/media-info') ? { info:null } :
  { installDir:'D:/we', total:2, portableCount:2, playlists:[], wallpapers:[
    { id:'v', title:'V', type:'video', playable:true, media:'/wallpaper-engine/media/vvv', preview:'/wallpaper-engine/preview/vvv', contentrating:'Everyone' },
    { id:'s', title:'S', type:'scene', playable:false, media:null, frameUrl:'/wallpaper-engine/scene-frame/sss',
      sceneLive:true, sceneLiveSrc:'tok-sss', preview:'/wallpaper-engine/preview/sss', contentrating:'Everyone' },
  ] }) }); };

const code = readFileSync(new URL('../lib/client.js', import.meta.url),'utf8');
// 渐变退役定时器 = ROTATION_FADE_MS + 100ms 宽限：从被测源码读常量，改时长
// 不用同步改这里的硬编码。
const FADE_GRACE_MS = Number(code.match(/ROTATION_FADE_MS = (\d+)/)[1]) + 100;
const cap = { handoff:null };
// 诊断留痕：`liveLog` 走的是 `new Image().src = "/diag?msg=…"`（同源像素请求），
// 沙箱里没有 Image 就会静默跳过 ⇒ 补一个只记录 src 的替身。
class RecordingImage { set src(v) { diagPosts.push(String(v)); } }
// setInterval 也要登记：遮挡判定的**低频复核**（OCCLUSION_RECHECK_MS）靠它自愈。
const intervals = [];
const winListeners = {};
const fireWin = (ev, payload) => (winListeners[ev] || []).slice().forEach((f) => f(payload));
const sandbox = {
  window: {
    __ModuleLoader__: { load:(h)=>{ cap.handoff=h; } },
    setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
    clearTimeout:(t)=>{ if(t)t.cleared=true; },
    setInterval:(fn,ms)=>{ const t={fn,ms,cleared:false}; intervals.push(t); return t; },
    clearInterval:(t)=>{ if(t)t.cleared=true; },
    addEventListener(ev,fn){ (winListeners[ev] ||= []).push(fn); }, removeEventListener(ev,fn){ const l=winListeners[ev]; if(l){const i=l.indexOf(fn); if(i>=0)l.splice(i,1);} }, innerWidth:1920, innerHeight:1080, devicePixelRatio:1,
  },
  document, localStorage, fetch, React, Image: RecordingImage,
  location: { origin: 'http://localhost' },
  setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
  clearTimeout:(t)=>{ if(t)t.cleared=true; },
  setInterval:(fn,ms)=>{ const t={fn,ms,cleared:false}; intervals.push(t); return t; },
  clearInterval:(t)=>{ if(t)t.cleared=true; },
};
vm.createContext(sandbox);
new vm.Script(code,{filename:'client.js'}).runInContext(sandbox);
const exportsObj = cap.handoff.factory((spec)=> spec==='react'?React:{createPortal:(n)=>n});
const effects = [];
exportsObj.apply({ slots:{inject:(k,cb)=>cb(),register:()=>{}}, effect(fn){ effects.push(fn); fn(); return fn; } });

const fire = (t) => { if (t && !t.cleared) { t.cleared = true; t.fn(); } };
const flushPersist = () => timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
const stagingDivs = () => bodyEl.children.filter(c => String(c.className).includes('we-layer--staging'));

// 真失败通道：断言失败 → 非零退出 —— 否则把节点级领养改回元素级（iframe 重载）也能 exit 0，
// 冒烟就退化成恒绿。
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};
const persistedId = () => JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id;

setTimeout(async () => {
  await Promise.resolve();
  const rot = timers.find(t=>!t.cleared && t.ms===10000);
  check('轮换定时器已武装（测试钩子 10s）', !!rot);
  if (!rot) { console.log('\n' + failures + ' CHECK(S) FAILED'); process.exit(1); }

  try { fire(rot); } catch(e){ console.log('EXCEPTION on rotation fire:', e && e.stack || e); process.exit(1); }
  const staged = iframeEls[iframeEls.length-1];
  const stagingDiv = stagingDivs()[0] || null;
  check('准备阶段创建了 staging 容器', !!stagingDiv, 'staging=' + stagingDivs().length);
  check('staged iframe 指向 scene-live 且带 token',
    String(staged.src).includes('/wallpaper-engine/scene-live/index.html') && String(staged.src).includes('tok-sss'),
    String(staged.src));
  const poll = timers.find(t=>!t.cleared && t.ms===300);
  check('首帧轮询定时器已武装（300ms）', !!poll);
  try { fire(poll); } catch(e){ console.log('EXCEPTION on poll fire:', e && e.stack || e); process.exit(1); }
  const layer = byId['dsh-wallpaper-engine-layer'];
  check('提交后新层带过场类（交叉淡化）', !!layer && String(layer.className).includes('we-layer--switch'),
    layer ? String(layer.className) : 'no layer');
  // 核心回归：节点级领养 —— staging 容器直接变成 layer，iframe 从未被搬动
  //（元素级 appendChild 会让 Chromium 重载 browsing context → 首帧超时）。
  check('staging 容器原地成为 layer（节点级领养）', !!stagingDiv && layer === stagingDiv);
  check('iframe 未被重新挂载（父节点就是 layer）',
    !!layer && layer.querySelector('iframe.we-live-iframe') === staged && staged._parent === layer);
  check('领养后立即点亮 we-live-on', String(staged.className).includes('we-live-on'),
    String(staged.className));
  check('提交后 staging 类名已消失', stagingDivs().length === 0, 'staging=' + stagingDivs().length);
  // 节点级领养的反向约束：被领养的渲染页 iframe 不得被「兜底释放」波及
  // （释放 iframe 的手段是把它导航到 about:blank，那会让层直接变黑）。
  check('被领养的 live iframe 未被误释放（未导航到 about:blank）',
    String(staged.src).includes('/wallpaper-engine/scene-live/index.html'), 'src=' + String(staged.src).slice(0, 50));
  flushPersist();
  check('提交已持久化到 scene（S）', persistedId() === 's', 'id=' + persistedId());
  check('提交后重新武装轮换定时器', timers.some(t=>!t.cleared && t.ms===10000));

  // ── 轮换音频闸（live 路径）：渲染页自带 BGM 由 __wp.setVolume 控制，
  //    提交瞬间必须压 0（否则与旧层 BGM 重叠整个渐变时长），旧层退场后才恢复。 ──
  check('提交后 live 渲染页音量被压到 0（闸内静音）',
    staged.__volumes.length > 0 && staged.__volumes[staged.__volumes.length-1] === 0
      && !staged.__volumes.includes(0.6),
    'volumes=' + JSON.stringify(staged.__volumes));
  const fade = timers.find(t=>!t.cleared && t.ms===FADE_GRACE_MS);
  check('渐变退役定时器已武装（ROTATION_FADE_MS + 100ms）', !!fade);
  if (fade) {
    fire(fade);
    check('旧层退场后 live 渲染页恢复设置音量 0.6',
      staged.__volumes[staged.__volumes.length-1] === 0.6,
      'volumes=' + JSON.stringify(staged.__volumes));
  }

  // 第二轮：live → video，验证渐变退役路径。视频类壁纸不预热（0.7.5「选中即播」），
  // 层内是新建的 <video>（不走 prepareVideoProbe 的 load()+play() 预热领养）。
  const rot2 = timers.find(t=>!t.cleared && t.ms===10000);
  fire(rot2);
  const probe = videoEls[videoEls.length-1]; // 提交后 = 新层里的 video
  const layer2 = byId['dsh-wallpaper-engine-layer'];
  check('第二个提交层内是新建立的 video（不预热）', !!layer2 && layer2.querySelector('video') === probe);
  check('层内 video 未被误释放（保留 src / 未额外 load）',
    String(probe.attributes.src || probe.src).includes('/wallpaper-engine/media/vvv')
      && (probe.__loads || 0) === 0
      && !(probe.__removedAttrs || []).includes('src'),
    'loads=' + probe.__loads + ' src=' + String(probe.attributes.src || probe.src).slice(0, 40));
  check('没有「已脱离文档且仍在播」的 video（无孤儿）',
    videoEls.filter((v) => !v.isConnected && !v.__paused).length === 0);
  check('被换下的 scene 层标记为渐变中（weFading）', layer.dataset.weFading === '1',
    'weFading=' + layer.dataset.weFading);
  // 新层的**内容闸门**（见 src/live-layer.js 的切层内容闸门）：新 `<video>` 在没有任何
  // 可解码帧之前不参与绘制，过场与退役计时都从"有画面"那一刻才起。按浏览器事实把它推到位
  //（canplay 的 spec 含义 = readyState ≥ HAVE_FUTURE_DATA(3)）。
  probe.readyState = 3;
  try { probe.__fire('canplay'); } catch(e){ console.log('EXCEPTION on canplay 2:', e && e.stack || e); failures++; }
  flushPersist();
  check('第二轮提交持久化回绕到 v', persistedId() === 'v', 'id=' + persistedId());
  const fade2 = timers.find((t) => !t.cleared && t.ms === FADE_GRACE_MS);

  // ── P2-I：退场的旧层必须显式释放其中的 iframe。真 DOM 实测「从文档摘除的
  //    iframe 其 JS 世界仍在跑」（contentWindow 已 null 而 setInterval 照跳）——
  //    只 remove() 等于把它留给 GC，每个渐变周期都可能多留一个活着的渲染页。 ──
  check('第二轮渐变退役定时器已武装', !!fade2);
  if (fade2) {
    fire(fade2);
    check('退场旧层的 live iframe 已导航到 about:blank（不得只 remove 留给 GC）',
      String(staged.src) === 'about:blank', 'src=' + String(staged.src).slice(0, 70));
  }

  // ── 遮挡判定的**自愈**（真机：删除确认弹窗之后壁纸停住、只剩重载能救）──────────────
  // 形态：原生模态（window.confirm）把焦点交给自己的窗口 ⇒ blur ⇒ pauseOnBlur 命中；
  // 它同时**同步阻塞渲染线程**，而回来时的 focus 事件**不保证送达** ⇒ 判定永久卡在
  // 「窗口失焦」。所以判定不能只靠事件，要有低频复核（OCCLUSION_RECHECK_MS）。
  // 这里直接模拟"事件丢了"：只改 hasFocus()，一个 focus/blur 事件都不发。
  {
    const live = videoEls.filter((v) => v.isConnected).pop() || videoEls[videoEls.length-1];
    const watch = intervals.find((t) => !t.cleared && t.ms === 3000);
    check('遮挡复核定时器已武装（3s；只在判定变化时 emit）', !!watch,
      'intervals=' + JSON.stringify(intervals.filter((t) => !t.cleared).map((t) => t.ms)));
    // 真 setInterval 是**重复**触发的：挂载台里同一个对象要能反复 fire（别标 cleared）。
    const tick = () => { if (watch) watch.fn(); };
    const diagBefore = diagPosts.length;
    focusOn = false;                       // 焦点丢了，但**不派发事件**（原生模态的真实形态）
    tick();
    check('焦点丢了且事件没送达 ⇒ 复核把壁纸停下（pauseOnBlur 仍然生效）',
      live.__paused === true, 'paused=' + live.__paused);
    check('复核翻转了判定就**留痕**（事后能看出"事件丢了、复核补上"）',
      diagText(diagBefore).includes('occlusion-recheck') && diagText(diagBefore).includes('playing=false'),
      diagText(diagBefore).slice(0, 90));
    const diagBefore2 = diagPosts.length;
    const playsBeforeResume = live.__plays || 0;
    focusOn = true;                        // 焦点回来了，同样**不派发事件**
    tick();
    // ⚠️ 断言里必须带上「**真的恢复了播放**」：只查诊断文本的话，替身丢 `paused` 语义
    //    （`!undefined === true` 早退）时这条照样绿 ⇒ 替身必须带真属性，而这条断言
    //    正是 `get paused()` 要守住的东西。
    check('焦点回来且事件没送达 ⇒ 复核把判定翻回"可播"并**真的恢复播放**（这就是"只剩重载能救"的那一档）',
      diagText(diagBefore2).includes('occlusion-recheck') && diagText(diagBefore2).includes('playing=true')
        && (live.__plays || 0) > playsBeforeResume,
      diagText(diagBefore2).slice(0, 90) + ' · plays ' + playsBeforeResume + '→' + (live.__plays || 0));
    // 负对照：不动焦点时复核**不产生**额外动作（判据不是恒真，也不会 churn）。
    const diagBefore3 = diagPosts.length;
    const playsBefore3 = live.__plays || 0;
    tick();
    check('负对照：判定没变时复核什么都不做（零 churn）',
      diagPosts.length === diagBefore3 && (live.__plays || 0) === playsBefore3,
      '新增日志 ' + (diagPosts.length - diagBefore3) + ' 条');
  }

  // ── 客户端异常留痕（这台机器打不开 DevTools，"崩了"必须能落到诊断缓冲里）──────────
  {
    const before = diagPosts.length;
    fireWin('error', { type: 'error', message: 'boom from render', error: new Error('boom from render') });
    check('window error ⇒ 诊断里落一行 client-error（含消息）',
      diagText(before).includes('client-error') && diagText(before).includes('boom from render'),
      diagText(before).slice(0, 96));
    const before2 = diagPosts.length;
    fireWin('unhandledrejection', { type: 'unhandledrejection', reason: new Error('promise blew up') });
    check('unhandledrejection 同样落痕（异步路径的异常不丢）',
      diagText(before2).includes('unhandledrejection') && diagText(before2).includes('promise blew up'),
      diagText(before2).slice(0, 96));
  }

  console.log('');
  console.log(failures === 0 ? 'SMOKE PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}, 50);
