// 轮换准备元素泄漏 smoke：复现并锁死两个故障
//
//  A. 「live 首帧探测超时 → 回退探针写进元素级领养槽位 → 提交时 buildMedia 仍
//     选 live（自建 iframe）→ 探针既不上屏也不释放」。detached 的 <video> 是解
//     码器根：失去句柄后仍满速解码到页面关闭（真机实测 4K ≈35% 单核/个、gc()
//     收不走）。test 里测不到 CPU，改判「disposeMediaEl 的 video 三连」与
//     「已脱离文档且仍在播」这个孤儿形态。
//
//  B. 兄弟故障：槽位里的元素属于**上一张壁纸**，跨过一次 live 提交存活后，被
//     之后的非提交重建（liveFail → isSceneVideo 分支）按 tag 命中领养 → 层里
//     播上一张壁纸的画面、store/weKey 却是当前壁纸（画面串味）。
//
//  C. 卸载/禁用：进行中的 staged iframe 与探针必须一起收掉。
//
// 关键设施：可控时钟（首帧超时是墙钟比较 Date.now()-startedAt>15000，没有 15s
// 定时器可以 fire）、按壁纸 token 切换 __wpStats.frame()、setInterval、媒体记账。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 渐变退役定时器 = ROTATION_FADE_MS + 100ms 宽限：从被测源码读常量，改时长
// 不用同步改这里的硬编码。注意必须模块级定义 —— 场景 body 回调在模块作用域
// 求值，runScenario 内部的局部常量它看不见（ReferenceError 教训）。
const FADE_GRACE_MS = Number(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  .match(/ROTATION_FADE_MS = (\d+)/)[1]) + 100;

const React = { Fragment:'Fragment', useState:(i)=>[i,()=>{}], useEffect:()=>{}, useRef:(v)=>({current:v}),
  createElement:(t,p,...c)=>typeof t==='function'?t(p||{}):({type:t,props:p||null,children:c}) };

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};

// ── 可控时钟：让「首帧探测 15s 超时」能被测试精确跨过 ────────────────────────
const RealDate = Date;
const clock = { offset: 0 };
class MockDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + clock.offset); else super(...a); }
  static now() { return RealDate.now() + clock.offset; }
}

function runScenario(name, opts, body) {
  console.log('\n== ' + name + ' ==');
  clock.offset = 0;
  const timers = [];
  const intervals = [];
  const byId = {};
  const mediaEls = [];
  const iframeEls = [];
  const cleanups = [];
  const effects = [];
  // 按 token 切换首帧读数：{fps:0, running:true} =「在跑但永远没有首帧」。
  const stats = Object.assign({}, opts.stats || {});
  const setStats = (tok, st) => { stats[tok] = st; };
  const statsFor = (src) => {
    for (const [tok, st] of Object.entries(stats)) if (String(src).includes(tok)) return Object.assign({}, st);
    return { fps: 30, running: true };
  };
  // 渲染页运行时状态（新渲染页的 __wp.getState）。网页壁纸的就绪判据看
  // iframeLoaded === true，不看 fps —— 网页壁纸常无 rAF 打点，按 fps 判会把
  // 它们误判失败并降级。默认不种（返回 null）→ 客户端退化为「stats 可达即
  // 就绪」，与既有场景的行为完全一致。
  const webStates = Object.assign({}, opts.webStates || {});
  const webStateFor = (src) => {
    for (const [tok, st] of Object.entries(webStates)) if (String(src).includes(tok)) return Object.assign({}, st);
    return null;
  };
  const setWebState = (tok, st) => { webStates[tok] = st; };

  function makeEl(tag) {
    const listeners = {};
    const el = {
      tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
      style: { _props:{}, cssText:'', setProperty(k,v){this._props[k]=v;}, removeProperty(k){delete this._props[k];} },
      className: '',
      appendChild(c){ this.children.push(c); if (c.id) byId[c.id] = c; c._parent = this; return c; },
      // remove()：真 DOM 语义 —— 摘除后不再有父节点（isConnected 随之为 false）。
      remove(){ if (this._parent){ const i = this._parent.children.indexOf(this); if (i>=0) this._parent.children.splice(i,1); this._parent = undefined; } },
      setAttribute(k,v){ this.attributes[k] = v; },
      removeAttribute(k){ delete this.attributes[k]; (this.__removedAttrs ||= []).push(k); },
      getAttribute(k){ return this.attributes[k] ?? null; },
      hasAttribute(k){ return k in this.attributes; },
      querySelector(sel){
        const m = /^([a-z]+)(?:\.(.+))?$/.exec(sel) || [];
        const want = m[1] ? m[1].toUpperCase() : null;
        const wantCls = m[2] || '';
        const walk=(n)=>{ if (!Array.isArray(n.children)) return null; for (const c of n.children){ if (c.tagName===want && (!wantCls || String(c.className).includes(wantCls))) return c; const r=walk(c); if(r)return r; } return null; };
        return walk(this);
      },
      querySelectorAll(sel){
        const want = String(sel).split(',').map(x=>x.trim().toUpperCase());
        const out=[]; const walk=(n)=>{ if (!Array.isArray(n.children)) return; for (const c of n.children){ if (want.includes(c.tagName)) out.push(c); walk(c); } }; walk(this); return out;
      },
      contains(n){ let cur=n; while(cur){ if(cur===this)return true; cur=cur._parent; } return false; },
      get isConnected(){ let cur=this; while (cur) { if (!cur._parent) return cur.tagName === 'BODY'; cur = cur._parent; } return false; },
      addEventListener(ev,fn){ (listeners[ev] ||= []).push(fn); },
      removeEventListener(ev,fn){ const l=listeners[ev]; if(l){const i=l.indexOf(fn); if(i>=0)l.splice(i,1);} },
      __fire(ev){ (listeners[ev]||[]).slice().forEach(f=>f()); },
      play(){ this.__plays = (this.__plays||0)+1; this.__paused = false; return Promise.resolve(); },
      pause(){ this.__pauses = (this.__pauses||0)+1; this.__paused = true; },
      load(){ this.__loads = (this.__loads||0)+1; },
    };
    if (tag === 'video') { el.__plays = 0; el.__pauses = 0; el.__loads = 0; el.__paused = false; el.__removedAttrs = []; }
    let _id = '';
    Object.defineProperty(el, 'id', {
      get: () => _id,
      set: (v) => { if (_id) delete byId[_id]; _id = v || ''; if (v) byId[v] = el; },
    });
    el.classList = {
      add(c){ const parts = el.className ? el.className.split(' ') : []; if (!parts.includes(c)) { parts.push(c); el.className = parts.join(' '); } },
      remove(c){ const parts = el.className ? el.className.split(' ') : []; const i = parts.indexOf(c); if (i >= 0) { parts.splice(i, 1); el.className = parts.join(' '); } },
    };
    // src 走访问器：disposeMediaEl 的 removeAttribute('src') 之后 String(el.src) === ''，
    // 探测 iframe 被释放时（src='about:blank'）也可直接断言。
    Object.defineProperty(el, 'src', {
      get: () => el.attributes.src ?? '',
      set: (v) => { el.attributes.src = v || ''; },
    });
    if (tag === 'iframe') {
      el.__volumes = [];
      // 渲染页 pause/resume 与心跳读数的真实耦合（真机取自 renderer bundle 的
      // __wpStats：`!frameMeter.last || paused ? {fps:0,running:false} : …`）——
      // 页面被 pause() 之后「无帧」是**预期**结果而不是渲染故障。mock 必须照抄
      // 这条语义，否则「暂停被误判成首帧超时」这类缺陷在测试里根本不可见。
      el.__wpPaused = false;
      el.contentWindow = {
        __wpStats: { frame: () => {
          el.__statsCalls = (el.__statsCalls||0)+1;
          return el.__wpPaused ? { fps: 0, running: false } : statsFor(el.src);
        } },
        __wp: { resume(){ el.__wpPaused = false; }, pause(){ el.__wpPaused = true; },
          setVolume(v){ el.__volumes.push(v); }, setFit(){}, pushPointer(){}, pointerLeave(){},
          getState: () => webStateFor(el.src) },
      };
    }
    return el;
  }

  const imageEls = [];
  // 静态帧准备走 new Image()（真实客户端在 headless 环境会同步直通，所以必须
  // 提供 Image 才能测档位不符的领养校验）。
  class ImageMock {
    constructor(){ this.tagName = 'IMG'; this.attributes = {}; imageEls.push(this); }
    set src(v){ this.attributes.src = v || ''; }
    get src(){ return this.attributes.src || ''; }
    set className(v){ this._cls = v; } get className(){ return this._cls || ''; }
    set alt(v){} set draggable(v){}
  }

  const bodyEl = makeEl('body');
  // 真事件语义：客户端现在用 visibilitychange/focus 触发「隐藏期间被推迟的轮换」
  // 的补做，mock 若仍是空实现，这条路径在测试里永远不可达（假绿）。
  const docListeners = {}; const winListeners = {};
  const fireOn = (reg, ev) => { for (const fn of (reg[ev] ? [...reg[ev]] : [])) fn({ type: ev }); };
  const document = {
    createElement: (t) => { const el = makeEl(t); if (t==='iframe') iframeEls.push(el); if (t==='video') mediaEls.push(el); return el; },
    // 真 DOM 语义：getElementById 跳过已脱离文档的节点（否则 mock 会让客户端
    // 误以为旧层还在，重建路径与真实行为分叉）。
    getElementById: (id) => { const el = byId[id]; return el && el.isConnected ? el : null; },
    querySelector: () => null,
    head: { appendChild: () => {} },
    body: bodyEl,
    hidden: false,
    hasFocus: () => true,
    addEventListener(ev, fn){ (docListeners[ev] ||= []).push(fn); },
    removeEventListener(ev, fn){ const a = docListeners[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    documentElement: makeEl('html'),
  };

  const localStorage = {
    _store: { 'dsh-wallpaper-engine:selection': JSON.stringify(opts.selection), weRotationTestSec: '10' },
    getItem(k){ return this._store[k] ?? null; }, setItem(k,v){ this._store[k]=v; }, removeItem(k){ delete this._store[k]; },
  };
  const fetch = (url) => Promise.resolve({ ok:true, status:200, headers:{ get: () => '0' },
    json: () => Promise.resolve(
      String(url).includes('/settings') ? { ok:true, betterSidebar:false } :
      String(url).includes('/media-info') ? { info:null } :
      { installDir:'D:/we', total:3, portableCount:3, playlists:[], wallpapers: opts.wallpapers }) });

  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const cap = { handoff: null };
  const sandbox = {
    window: {
      __ModuleLoader__: { load:(h)=>{ cap.handoff = h; } },
      setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
      clearTimeout:(t)=>{ if(t)t.cleared=true; },
      setInterval:(fn,ms)=>{ const t={fn,ms,cleared:false}; intervals.push(t); return t; },
      clearInterval:(t)=>{ if(t)t.cleared=true; },
      addEventListener(ev, fn){ (winListeners[ev] ||= []).push(fn); },
      removeEventListener(ev, fn){ const a = winListeners[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
      innerWidth:1920, innerHeight:1080, devicePixelRatio:1,
    },
    document, localStorage, fetch, React, Date: MockDate, Image: ImageMock,
    location: { origin: 'http://localhost' },
    setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
    clearTimeout:(t)=>{ if(t)t.cleared=true; },
    setInterval:(fn,ms)=>{ const t={fn,ms,cleared:false}; intervals.push(t); return t; },
    clearInterval:(t)=>{ if(t)t.cleared=true; },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  const exportsObj = cap.handoff.factory((spec)=> spec==='react' ? React : { createPortal:(n)=>n });
  exportsObj.apply({ slots:{ inject:(k,cb)=>cb(), register:()=>{} },
    // 捕获 cleanup 返回值：卸载路径断言需要它。
    effect(fn){ effects.push(fn); const c = fn(); if (typeof c === 'function') cleanups.push(c); return fn; } });

  const fire = (t) => { if (t && !t.cleared) { t.cleared = true; t.fn(); } };
  const fireLatest = (ms) => { const t = [...timers].reverse().find(x => !x.cleared && x.ms === ms); if (t) fire(t); return t; };
  const flushPersist = () => timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
  const stagingDivs = () => bodyEl.children.filter(c => String(c.className).includes('we-layer--staging'));
  const layerEl = () => byId['dsh-wallpaper-engine-layer'];
  // 孤儿判据：已脱离文档且仍在播的 video —— 修复前回退探针正是这种形态。
  const orphans = () => mediaEls.filter(v => !v.isConnected && !v.__paused);
  const mediaSrc = (el) => String((el && el.attributes && el.attributes.src) || '');
  const persistedId = () => JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id;

  return (async () => {
    // boot 是 promise 链（loadPersisted → loadInventory → applySelection →
    // syncRotationTimer）：等它落定后再驱动轮换（同既有 smoke 的 50ms 等待）。
    await new Promise((r) => setTimeout(r, 50));
    return body({ timers, intervals, byId, mediaEls, iframeEls, cleanups, bodyEl, fire, fireLatest,
      flushPersist, stagingDivs, layerEl, orphans, mediaSrc, persistedId, clock, setStats, setWebState, imageEls,
      // 遮挡/隐藏相关的场景需要直接改这两个（真机上是页面自身的状态）。
      document,
      // 隐藏/恢复必须同时派发 visibilitychange（真机语义）：客户端靠它补做被推迟的轮换。
      setHidden(v){ document.hidden = !!v; fireOn(docListeners, 'visibilitychange'); },
      fireDoc(ev){ fireOn(docListeners, ev); },
      fireWin(ev){ fireOn(winListeners, ev); }, failureMemory: () => (JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).sceneLiveFailures || {}) });
  })();
}

const wallpaperV = { id:'v', title:'V', type:'video', playable:true, media:'/wallpaper-engine/media/vvv', preview:'/wallpaper-engine/preview/vvv', contentrating:'Everyone' };
const scene = (id, tok) => ({ id, title:id.toUpperCase(), type:'scene', playable:false, media:null,
  frameUrl:'/wallpaper-engine/scene-frame/' + id, sceneLive:true, sceneLiveSrc:tok,
  sceneVideo:'/wallpaper-engine/scene-video/' + id, preview:'/wallpaper-engine/preview/' + id, contentrating:'Everyone' });
// liveBootDelay: 0 —— 「重启恢复」期的启动延迟会让首层只挂占位图、iframe 交给
// scheduleLiveMount 延迟挂载。本文件测的是轮换交接/领养/回退链（层结构与节点归属），
// 与启动延迟无关，统一走不延迟路径，等价于用户已交互之后的状态。
const selSeed = (ids, cur) => ({ id:cur, rotationGroupId:'g1', rotationEnabled:true, videoVolume:0.6, videoAudioEnabled:true,
  liveBootDelay:0,
  // 本套断言「渐变退役定时器已武装（ROTATION_FADE_MS + 100ms）」—— 硬切（默认）
  // 根本不进过渡路径，所以这里显式选交叉淡化。
  switchTransition:'fade',
  rotationGroups:[{ id:'g1', name:'L', interval:5, order:'sequence', wallpaperIds:ids }] });

// ── H：静态帧形态的场景 BGM —— 卸载必须停播并拆掉 <audio>，不得反而起播 ──────
// 渐变期闸会把 BGM 压成 volume=0 + pause；cleanup 若走「放行」（restoreNodeAudio）
// 就会把它恢复并起播 —— 禁用插件反而开始响。而且此前 cleanup 从不停 sceneAudioEl，
// 禁用时正在播的 BGM 会一直响。
await runScenario('H. 卸载停掉场景 BGM 并拆掉 <audio>（不起播）', {
  wallpapers: [wallpaperV,
    { id:'s4', title:'S4', type:'scene', playable:false, media:null,
      frameUrl:'/wallpaper-engine/scene-frame/s4', sceneAudio:'/wallpaper-engine/scene-audio/s4',
      preview:'/wallpaper-engine/preview/s4', contentrating:'Everyone' }],
  selection: selSeed(['v','s4'], 'v'),
}, (t) => {
  const audios = () => t.bodyEl.querySelectorAll('audio');
  t.fireLatest(10000); // 准备 s4：静态帧探针
  const img = t.imageEls[t.imageEls.length-1];
  if (img && typeof img.onload === 'function') img.onload();
  const el = audios()[0];
  // 提交即进渐变 → 闸立刻把它压住（volume=0 + pause），所以这里断言的是「挂上了
  // 且被闸压住」，而不是「正在播」。
  check('静态帧形态提交后场景 BGM 元素已挂上（渐变期被闸压住：volume=0 + pause）',
    audios().length === 1 && !!el && String(el.volume) === '0' && el.__paused === true,
    'audios=' + audios().length + (el ? ' volume=' + el.volume + ' paused=' + el.__paused : ''));
  check('卸载前捕获到 cleanup', t.cleanups.length > 0, 'cleanups=' + t.cleanups.length);
  const playsBefore = el ? (el.__plays || 0) : 0;
  t.cleanups[t.cleanups.length-1](); // 模拟「禁用插件 / 热重挂」
  // 核心：卸载**不是**渐变结束 —— 走放行（restoreNodeAudio）会连带 syncSceneAudio
  // 把刚压住的 BGM 恢复起播（禁用插件反而响一下），所以判据是「play 次数不增加」。
  check('卸载过程中不得起播场景 BGM（放行会 restore → syncSceneAudio → play）',
    !!el && (el.__plays || 0) === playsBefore,
    el ? 'plays ' + playsBefore + ' → ' + (el.__plays || 0) : 'no audio');
  check('卸载后 BGM 保持停播', !!el && el.__paused === true, el ? 'paused=' + el.__paused : 'no audio');
  check('卸载后 <audio> 已拆掉且脱离文档',
    audios().length === 0 && !!el && !el.isConnected, 'audios=' + audios().length);
});

// ── A：超时回退 → 提交后回退探针必须已被释放，且正常领养不得被误杀 ──────────
await runScenario('A. live 首帧超时回退：探针不得留在领养槽位里', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['v','s1'], 'v'),
}, (t) => {
  check('轮换定时器已武装（测试钩子 10s）', !!t.timers.find(x=>!x.cleared && x.ms===10000));
  t.fireLatest(10000); // 准备 s1 → live 探测
  const probeIframe = t.iframeEls[t.iframeEls.length-1];
  check('准备期先走 live 探测（staging 容器 + scene-live iframe）',
    !!probeIframe && String(probeIframe.src).includes('scene-live/index.html')
      && String(probeIframe.src).includes('tok-s1') && t.stagingDivs().length === 1,
    'src=' + String(probeIframe && probeIframe.src).slice(0, 60));
  check('此时尚未创建视频探针', t.mediaEls.length === 1, 'videos=' + t.mediaEls.length);

  t.fireLatest(300); // 首拍：fps=0 → 未达标，轮询续跑
  check('首帧未达标 → 探测轮询续跑（500ms）',
    t.mediaEls.length === 1 && !!t.timers.find(x=>!x.cleared && x.ms===500));

  t.clock.offset = 16000; // 跨过 LIVE_FIRST_FRAME_MS（墙钟比较）
  t.fireLatest(500);      // → bail → 回退到 sceneVideo 探针
  check('超时后探测 iframe 被释放（对照项：证明释放检测有效）',
    String(probeIframe && probeIframe.src) === 'about:blank' && t.stagingDivs().length === 0,
    'src=' + String(probeIframe && probeIframe.src) + ' staging=' + t.stagingDivs().length);
  const probe1 = t.mediaEls[t.mediaEls.length-1];
  check('回退创建了 sceneVideo 探针且已在预播（detached 播放 → 泄漏形态）',
    t.mediaEls.length === 2 && t.mediaSrc(probe1).includes('/wallpaper-engine/scene-video/s1')
      && probe1.__plays >= 1 && probe1.__paused === false, 'src=' + t.mediaSrc(probe1));

  const loadsBefore = probe1.__loads;
  probe1.__fire('canplay'); // 提交（准备期 kind=sceneVideo → 元素级领养通道）
  const layer = t.layerEl();
  // 垫底画面在合并线里是 div.we-live-poster（background-image + 主题色兜底、
  // dataset.weFrameSrc 记录来源），不是 <img> —— 按类名判「有垫底画面」。
  check('提交后层是 live iframe + poster（buildMedia 选了 live 分支，不消费槽位）',
    !!layer && !!layer.querySelector('iframe.we-live-iframe') && !!layer.querySelector('div.we-live-poster'),
    layer ? String(layer.dataset.weKey).slice(0, 70) : 'no layer');
  // ── 核心 1：回退探针必须被释放（disposeMediaEl 的 video 三连）──
  check('回退探针已暂停', probe1.__paused === true, 'paused=' + probe1.__paused);
  check('回退探针已清 src', probe1.__removedAttrs.includes('src') && t.mediaSrc(probe1) === '',
    'removed=' + JSON.stringify(probe1.__removedAttrs) + ' src="' + t.mediaSrc(probe1) + '"');
  check('回退探针额外 load() 一次（真释放而非只改标记）', probe1.__loads === loadsBefore + 1,
    'loads=' + probe1.__loads);
  check('不存在「已脱离文档且仍在播」的 video（无孤儿）', t.orphans().length === 0,
    'orphans=' + t.orphans().length);
  check('body 里只剩旧层那张渐变淡出的 video',
    t.bodyEl.querySelectorAll('video').length === 1, 'bodyVideos=' + t.bodyEl.querySelectorAll('video').length);
  t.flushPersist();
  check('提交已持久化到 s1', t.persistedId() === 's1', 'id=' + t.persistedId());

  // 第二轮：轮换回视频壁纸 → 正常领养路径不得被误释放。
  t.fireLatest(10000);
  const probe2 = t.mediaEls[t.mediaEls.length-1];
  const loads2 = probe2.__loads;
  probe2.__fire('canplay');
  const layer2 = t.layerEl();
  check('正常领养未被误杀（新层 video 就是探针元素）',
    !!layer2 && layer2.querySelector('video') === probe2);
  check('被领养的探针仍在播、保留 src、未额外 load()',
    probe2.__paused === false && t.mediaSrc(probe2).includes('/wallpaper-engine/media/vvv')
      && probe2.__loads === loads2 && !probe2.__removedAttrs.includes('src'),
    'paused=' + probe2.__paused + ' loads=' + probe2.__loads);
  check('仍然没有孤儿 video', t.orphans().length === 0, 'orphans=' + t.orphans().length);
});

// ── B：陈旧槽位跨壁纸被领养（画面串味）────────────────────────────────────
await runScenario('B. 陈旧槽位不得被当成当前壁纸的资产领养', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1'), scene('s2', 'tok-s2')],
  stats: { 'tok-s1': { fps: 0, running: true }, 'tok-s2': { fps: 30, running: true } },
  selection: selSeed(['v','s1','s2'], 'v'),
}, (t) => {
  // 第一轮：v → s1，走「探测超时回退」的泄漏形态提交（层 = live iframe）。
  t.fireLatest(10000);
  t.clock.offset = 16000;
  t.fireLatest(300);
  t.fireLatest(500);
  const probeS1 = t.mediaEls[t.mediaEls.length-1];
  probeS1.__fire('canplay');
  check('第一轮：s1 提交为 live iframe（回退探针不领养）',
    !!t.layerEl() && !!t.layerEl().querySelector('iframe.we-live-iframe'));
  check('第一轮：s1 的回退探针已被释放（不留在槽位）',
    probeS1.__paused === true && t.mediaSrc(probeS1) === '',
    'paused=' + probeS1.__paused + ' src="' + t.mediaSrc(probeS1) + '"');

  // 第二轮：s1 → s2，live 首帧正常 → 节点级领养（整条绕过 buildMedia）。
  t.fireLatest(10000);
  const staged2 = t.iframeEls[t.iframeEls.length-1];
  check('第二轮：s2 探测 iframe 指向 tok-s2', String(staged2.src).includes('tok-s2'),
    'src=' + String(staged2.src).slice(0, 60));
  t.fireLatest(300); // 首帧达标（tok-s2 fps=30）→ 提交
  const layer2 = t.layerEl();
  check('第二轮：节点级领养（staging 容器原地成为层、iframe 未搬动）',
    !!layer2 && layer2.querySelector('iframe.we-live-iframe') === staged2,
    layer2 ? String(layer2.className) : 'no layer');

  // 第三轮：s2 的 live 运行期失败 → syncLayers 重建 → isSceneVideo 分支消费槽位。
  t.setStats('tok-s2', { fps: 0, running: true });
  t.clock.offset = 32000; // 跨过运行期看护的 15s 墙钟
  const tick = t.intervals.find(x => !x.cleared && x.ms === 1000);
  check('运行期心跳已武装（1s）', !!tick);
  if (tick) tick.fn(); // → liveFail → syncLayers 重建
  const layer3 = t.layerEl();
  const v3 = layer3 && layer3.querySelector('video');
  check('重建后层里出现 video（live 失败 → sceneVideo 回退）', !!v3,
    v3 ? 'src=' + t.mediaSrc(v3) : 'no video');
  // ── 核心 2：必须是 s2 自己的视频，绝不能是上一张壁纸的探针 ──
  check('层内 video 属于当前壁纸 s2（画面不串味）',
    !!v3 && t.mediaSrc(v3).includes('/wallpaper-engine/scene-video/s2'),
    v3 ? 'src=' + t.mediaSrc(v3) : 'no video');
  check('s1 的探针未被复活/被领养', probeS1.__paused === true && v3 !== probeS1);
  check('仍然没有孤儿 video', t.orphans().length === 0, 'orphans=' + t.orphans().length);
});

// ── C：卸载/禁用必须收掉进行中的准备与探针 ─────────────────────────────────
await runScenario('C. 卸载时收掉 staged iframe 与在途准备', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['v','s1'], 'v'),
}, (t) => {
  t.fireLatest(10000); // 开始准备（staging iframe 已挂在 body 上）
  const staged = t.iframeEls[t.iframeEls.length-1];
  check('准备中的 staging iframe 已在 body 上', t.stagingDivs().length === 1 && !!staged);

  check('捕获到插件 cleanup（卸载路径可测）', t.cleanups.length > 0, 'cleanups=' + t.cleanups.length);
  for (const c of t.cleanups) { try { c(); } catch { /* ignore */ } }

  check('卸载后 staged iframe 被释放（导航到 about:blank）',
    String(staged.src) === 'about:blank', 'src=' + staged.src);
  check('卸载后 staging 容器已从 body 移除', t.stagingDivs().length === 0,
    'staging=' + t.stagingDivs().length);
  check('卸载后没有孤儿 video', t.orphans().length === 0, 'orphans=' + t.orphans().length);
});

// ── D：web 壁纸的 live 失败必须重建层（wantKey 缺 live 段 → 层不重建）──────
await runScenario('D. web 壁纸 live 失败后必须重建为旧链', {
  wallpapers: [
    { id:'w1', title:'W1', type:'web', playable:true, media:'/wallpaper-engine/web/w1',
      webLive:true, webLiveSrc:'tok-w1', preview:'/wallpaper-engine/preview/w1', contentrating:'Everyone' },
    wallpaperV,
  ],
  stats: { 'tok-w1': { fps: 30, running: true } },
  selection: selSeed(['w1','v'], 'w1'),
}, (t) => {
  const layer = t.layerEl();
  const liveFrame = layer && layer.querySelector('iframe.we-live-iframe');
  check('web 壁纸初始层是 live iframe', !!liveFrame,
    layer ? String(layer.dataset.weKey).slice(0, 60) : 'no layer');
  const keyBefore = layer ? layer.dataset.weKey : '';
  liveFrame.__fire('load'); // 层内 iframe load → startLiveWatch 武装 1s 心跳
  const tick = t.intervals.find(x => !x.cleared && x.ms === 1000);
  check('web live 心跳已武装（1s）', !!tick);

  // 网页壁纸的「live 走不通」判据：渲染页报告它内部的入口 iframe 加载失败。
  // 不能用 fps=0 —— 网页壁纸常无 rAF 打点（setTimeout 主循环 / 纯静态页），
  // 按无帧判会把这些壁纸误判失败并降级（真机实测：一直停在占位图、15s 后黑屏）。
  t.setWebState('tok-w1', { iframeLoaded: false, webError: 'entry-load-failed' });
  t.clock.offset = 16000;
  if (tick) tick.fn();                             // → liveFail('load') → 重建旧链

  const layer2 = t.layerEl();
  const keyAfter = layer2 ? layer2.dataset.weKey : '';
  check('live 失败后层被重建（key 里的 live 段变为 nolive）',
    keyAfter.includes('nolive') && keyAfter !== keyBefore, 'key=' + String(keyAfter).slice(0, 70));
  check('重建后不再是 live iframe（回退旧链裸 iframe）',
    !!layer2 && !layer2.querySelector('iframe.we-live-iframe'));
  check('旧 live iframe 已随旧层退场', !liveFrame.isConnected || layer2 !== layer);
});

// ── E：档位不符的就绪元素不得被收编（画面档位与 weKey 不一致且不自愈）──────
// ── E：静态帧探针必须按「提交后会显示的 URL」预载；不符的元素不得被原样收编 ──
await runScenario('E. 静态帧预载按提交档位；不符（preview 回退）不得原样收编', {
  wallpapers: [
    wallpaperV,
    { id:'s3', title:'S3', type:'scene', playable:false, media:null,
      frameUrl:'/wallpaper-engine/scene-frame/s3', preview:'/wallpaper-engine/preview/s3', contentrating:'Everyone' },
  ],
  selection: Object.assign(selSeed(['v','s3'], 'v'), { frameVariants: { s3: 3 } }), // 该壁纸停在画面档位 3
}, (t) => {
  t.fireLatest(10000); // 准备 s3：静态帧探针
  const probeImg = t.imageEls[t.imageEls.length-1];
  // ── 核心 1（本轮修复）：探针按提交档位准备，于是能真的被收编 ──
  check('静态帧探针按提交档位准备（?v=3，不再是无档位 URL）',
    !!probeImg && t.mediaSrc(probeImg) === '/wallpaper-engine/scene-frame/s3?v=3',
    'src=' + String(probeImg && probeImg.src));
  if (probeImg && typeof probeImg.onload === 'function') probeImg.onload();
  const layer = t.layerEl();
  const img = layer && layer.querySelector('img');
  check('同档位预载被原样收编（零重建：层内 img 就是探针元素）', !!img && img === probeImg,
    img ? ('same=' + (img === probeImg)) : 'no img');
  check('层内静态帧按当前档位加载（?v=3）',
    !!img && String(img.src).includes('/wallpaper-engine/scene-frame/s3?v=3'),
    img ? 'src=' + String(img.src) : 'no img');
  t.flushPersist();
  check('提交已落库到 s3', t.persistedId() === 's3', 'id=' + t.persistedId());

  // 第二轮：回视频壁纸（正常领养），再回 s3 —— 这次让静态帧提取失败。
  t.fireLatest(10000);
  const probeV = t.mediaEls[t.mediaEls.length-1];
  if (probeV && typeof probeV.__fire === 'function') probeV.__fire('canplay');
  t.flushPersist();
  check('第二轮回到视频壁纸', t.persistedId() === 'v', 'id=' + t.persistedId());

  t.fireLatest(10000); // 再准备 s3
  const frameImg = t.imageEls[t.imageEls.length-1];
  check('第二轮 s3 仍按档位 3 预载', t.mediaSrc(frameImg) === '/wallpaper-engine/scene-frame/s3?v=3',
    'src=' + t.mediaSrc(frameImg));
  if (frameImg && typeof frameImg.onerror === 'function') frameImg.onerror(); // 提取失败 → preview 回退
  const previewImg = t.imageEls[t.imageEls.length-1];
  check('提取失败后回退到 preview 探针',
    previewImg !== frameImg && t.mediaSrc(previewImg) === '/wallpaper-engine/preview/s3',
    'src=' + t.mediaSrc(previewImg));
  if (previewImg && typeof previewImg.onload === 'function') previewImg.onload(); // 就绪 → 提交
  // ── 核心 2（186df3a 的 URL 校验不能退化）：src 与提交 URL 不符的元素（preview）
  //    绝不能被原样收编成「当前档位的静态帧」──
  const layer2 = t.layerEl();
  const img2 = layer2 && layer2.querySelector('img');
  check('不符的 preview 探针未被原样收编（层内 img 按帧 URL 重建）',
    !!img2 && img2 !== previewImg && String(img2.src).includes('/wallpaper-engine/scene-frame/s3?v=3'),
    img2 ? ('src=' + String(img2.src) + ' same=' + (img2 === previewImg)) : 'no img');
  check('重建的 img 带 onerror 兜底（提取失败仍能退回 preview）',
    !!img2 && typeof img2.onerror === 'function');
});

// ── F：渐变窗口内卸载 → 渐变中的旧层必须随 cleanup 一起退役 ────────────────
await runScenario('F. 渐变窗口内卸载：旧层随 cleanup 退役（不留屏上残留）', {
  wallpapers: [wallpaperV, scene('s1','tok-s1')],
  stats: { 'tok-s1': { fps: 30, running: true } }, // live 首帧立刻达标
  selection: selSeed(['v','s1'], 'v'),
}, (t) => {
  const layerCount = () => t.bodyEl.children.filter(c => String(c.className).includes('we-layer')).length;
  t.fireLatest(10000); // 准备 s1 → live 首帧达标
  t.fireLatest(300);
  check('提交成功并进入渐变（body 里 2 层：淡出的旧层 + 新层）', layerCount() === 2,
    'layers=' + layerCount());
  check('渐变退役定时器已武装（ROTATION_FADE_MS + 100ms）', !!t.timers.find(x=>!x.cleared && x.ms===FADE_GRACE_MS));
  check('卸载前捕获到 cleanup', t.cleanups.length > 0, 'cleanups=' + t.cleanups.length);
  t.cleanups[t.cleanups.length-1](); // 模拟「禁用插件 / HMR 重挂」
  check('卸载后 body 里不再有 we-layer（旧层随 cleanup 退役，而不是等退役定时器）',
    layerCount() === 0, 'layers=' + layerCount());
});

// ── G：准备期 live 首帧连续超时的候选 → 本会话不再对它尝试 live 准备 ────────
// 不设闸时：每次轮换都会重新完整拉一次 scene.pkg（host no-store，无 HTTP 缓存）
// + 满视口渲染最多 15s —— 而它本来也进不了 live。
await runScenario('G. 准备期 live 连续超时 → 冷却后跳过 live 阶段', {
  wallpapers: [wallpaperV, scene('s1','tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } }, // 在跑但永远不出首帧
  selection: selSeed(['v','s1'], 'v'),
}, (t) => {
  // 判据用「准备期的 staging 容器」：live 探测只在这里发起；提交后建层挂的
  // live iframe 是另一回事（冷却不管建层路径，那条 live 是活的）。
  const staged = () => t.stagingDivs().length;
  const startRound = () => { t.fireLatest(10000); return staged(); };   // 发起一轮准备
  const settle = () => { t.fireLatest(300); t.clock.offset += 16000; t.fireLatest(500); }; // 跨过 15s 墙钟
  const commitProbe = () => {                                           // 提交当前探针
    const p = t.mediaEls[t.mediaEls.length-1];
    if (p && typeof p.__fire === 'function') p.__fire('canplay');
    t.flushPersist();
    return p;
  };
  let r = startRound(); settle(); commitProbe(); // s1 第 1 次超时
  check('第 1 次准备 s1 仍然尝试 live 探测', r === 1, 'staged=' + r);
  check('第 1 次超时后回退提交到 s1', t.persistedId() === 's1', 'id=' + t.persistedId());
  r = startRound(); commitProbe();               // v（视频壁纸）
  check('视频候选不经过 live 探测', r === 0 && t.persistedId() === 'v', 'staged=' + r + ' id=' + t.persistedId());
  r = startRound(); settle(); commitProbe();     // s1 第 2 次超时
  check('第 2 次准备仍会再试一次（上限 2，避免一次抖动就永久放弃）', r === 1, 'staged=' + r);
  r = startRound(); commitProbe();               // v
  check('轮换回视频壁纸', r === 0 && t.persistedId() === 'v', 'id=' + t.persistedId());
  r = startRound();                              // s1：冷却生效 → 不发起 live
  check('连续超时后不再发起 live 探测（本会话对该壁纸跳过 live 阶段）', r === 0, 'staged=' + r);
  const probe = t.mediaEls[t.mediaEls.length-1];
  check('直接回退到 sceneVideo 探针（准备链仍能就绪）',
    t.mediaSrc(probe).includes('/wallpaper-engine/scene-video/s1'), 'src=' + t.mediaSrc(probe));
  commitProbe();
  check('第 3 轮提交回到 s1', t.persistedId() === 's1', 'id=' + t.persistedId());

  // ── 冷却必须会被「live 真的跑起来」清掉 ──────────────────────────────────
  // 提交后建层依然给它挂 live iframe（冷却只管准备阶段）——这条 live 一旦真出首帧，
  // 说明这张壁纸跑得动，冷却就该清零；否则用户手动点开是活的、轮换却一直降级成
  // sceneVideo/静态帧，直到页面关闭（手动选择走建层路径，不经过准备链）。
  const liveLayer = t.layerEl();
  check('提交后的层里仍是 live iframe（冷却不影响建层路径）',
    !!liveLayer && !!liveLayer.querySelector('iframe.we-live-iframe'));
  const liveFrame = liveLayer && liveLayer.querySelector('iframe.we-live-iframe');
  if (liveFrame) liveFrame.__fire('load'); // 层内 iframe load → 武装 1s 心跳
  const tick2 = t.intervals.find(x => !x.cleared && x.ms === 1000);
  check('live 心跳已武装（1s）', !!tick2);
  t.setStats('tok-s1', { fps: 30, running: true }); // 这次 live 真的出画面了
  if (tick2) tick2.fn(); // 心跳确认首帧 → clearPrepareLiveTimeout
  r = startRound(); commitProbe();               // v
  check('轮换回视频壁纸（清冷却前）', r === 0 && t.persistedId() === 'v', 'id=' + t.persistedId());
  r = startRound();                              // s1：冷却已清 → 恢复 live 探测
  check('live 真的出过首帧后冷却被清零 → 下轮恢复 live 探测', r === 1, 'staged=' + r);
});

// ── I：领养后的「主动暂停」不得被判成首帧超时 ────────────────────────────────
// 真机复现（Chrome + 真渲染页 + 真宿主，见 PR）：轮换的节点级领养路径在同一个
// 任务里就调用 applyLiveControls → 若此刻「非有效播放」（窗口失焦 pauseOnBlur /
// 标签页隐藏 / 用户暂停），渲染页被我们自己的 pause() 停表，__wpStats.frame()
// 恒为 {fps:0,running:false}；首帧看护若照常计时，15s 后就把这张壁纸持久记成
// 「首帧超时」并降级回 sceneVideo/静态帧 —— 渲染页其实是好的，用户得手动重开
// 「实时渲染」开关才能恢复。运行期 stall 规则早就有 !isEffectivelyPlaying() 守卫。
await runScenario('I. 领养后处于暂停/失焦：首帧看护必须暂停计时，不得记超时', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 30, running: true } },
  selection: Object.assign(selSeed(['v','s1'], 'v'), { pauseOnBlur: true }),
}, (t) => {
  t.document.hasFocus = () => false;           // 窗口失焦（pauseOnBlur）
  t.fireLatest(10000);                          // 轮换：准备 s1
  t.fireLatest(300);                            // 首帧达标 → 提交（节点级领养）
  const staged = t.iframeEls[t.iframeEls.length-1];
  const layer = t.layerEl();
  check('失焦状态下仍完成 live 准备与领养（准备期不看父页焦点；iframe 未搬动）',
    !!layer && t.stagingDivs().length === 0 && layer.querySelector('iframe.we-live-iframe') === staged
      && staged._parent === layer,
    'layer=' + (layer ? String(layer.className) : 'none') + ' staging=' + t.stagingDivs().length);
  check('领养后渲染页被 applyLiveControls 按「非有效播放」暂停（失焦的真实后果）',
    staged.__wpPaused === true, '__wpPaused=' + staged.__wpPaused);
  const tick = t.intervals.find(x => !x.cleared && x.ms === 1000);
  check('live 心跳已武装（1s）', !!tick);
  // 跨过 LIVE_FIRST_FRAME_MS：暂停期间连敲 20 tick（每秒一拍）
  t.clock.offset += 20000;
  for (let i = 0; i < 20; i++) if (tick) tick.fn();
  t.flushPersist();                             // 失败记忆只有落库后才可见（200ms 定时器）
  check('暂停期间不得记入 sceneLiveFailures（旧实现在这里写 timeout 并永久降级）',
    !t.failureMemory()['s1'], JSON.stringify(t.failureMemory()));
  // 诊断日志默认档（无需任何开关）：关键事件直接进宿主 /diag 环形缓冲 —— 这台机器上
  // 打不开 DevTools，事后唯一的取证通道就是它，所以「默认有没有在记」必须被锁住。
  const beacons = () => t.imageEls.map((e) => String(e.src || ''))
    .filter((s) => s.indexOf('/diag?msg=') === 0).map((s) => decodeURIComponent(s));
  check('默认就向宿主诊断缓冲上报关键事件（watch-start / adopt-live，无需开关）',
    beacons().some((s) => s.indexOf('watch-start') !== -1) && beacons().some((s) => s.indexOf('adopt-live') !== -1),
    'beacons=' + beacons().length);
  check('暂停期间不上报 liveFail（日志与行为一致）',
    !beacons().some((s) => s.indexOf('liveFail') !== -1),
    beacons().filter((s) => s.indexOf('liveFail') !== -1).join(' | ').slice(0, 120));
  check('暂停期间层不得被重建（仍是领养那个 iframe、渲染页不重载）',
    t.layerEl() === layer && !!layer.querySelector('iframe.we-live-iframe'), 'rebuilt=' + (t.layerEl() !== layer));
  // 焦点回来（真机上是 focus 事件 → emit → applyLiveControls.resume；心跳里也有一条）
  t.document.hasFocus = () => true;
  t.clock.offset += 1000;
  if (tick) tick.fn();                          // 这一拍读到旧读数 + 下发 resume
  t.clock.offset += 1000;
  if (tick) tick.fn();                          // 这一拍读到出帧 → 确认首帧
  check('恢复播放后心跳立刻确认首帧（渲染页 resume 后照常出帧）',
    staged.__wpPaused === false && t.timers.some(x => !x.cleared && x.ms === 2500),
    'wpPaused=' + staged.__wpPaused + ' 回填定时器=' + t.timers.filter(x => !x.cleared && x.ms === 2500).length);
  t.flushPersist();
  check('恢复后依然没有失败记忆', !t.failureMemory()['s1'], JSON.stringify(t.failureMemory()));
});

// ── J：标签页隐藏期间的 live 准备不得超时（隐藏页面物理上不可能出帧）───────────
// 真机：Chromium 对隐藏页面完全停摆 rAF，渲染页心跳读数退化为 {fps:0,running:false}。
// 若照常计时，隐藏期间的每次轮换都白等 15s 并退化成 sceneVideo/静态帧，连续两次
// 还会给这张壁纸盖上「本会话不再尝试 live」（prepareLiveExhausted）—— 用户切回来
// 看到的是一张回不到 live 的静态壁纸（要手动重选/重开开关）。
await runScenario('J. 标签页隐藏：本轮轮换推迟（零驻留），可见后立刻补做', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  selection: selSeed(['v','s1'], 'v'),
  // 隐藏期间渲染页读数为「没在跑」（rAF 停摆），可见后恢复出帧
  stats: { 'tok-s1': { fps: 0, running: false } },
}, (t) => {
  t.setHidden(true);                            // 人切走了（真机语义：状态 + 事件）
  t.fireLatest(10000);                          // 轮换到点
  check('隐藏期间不建 staging 渲染页（零驻留：不加载 pkg、不占显存）',
    t.stagingDivs().length === 0 && t.persistedId() === 'v',
    'staging=' + t.stagingDivs().length + ' id=' + t.persistedId());
  t.clock.offset += 300000;                     // 隐藏 5 分钟（旧实现：反复加载/释放 staging）
  t.fireLatest(10000);                          // 下一个间隔又到点
  check('长时间隐藏期间始终不建 staging、不提交、不记失败',
    t.stagingDivs().length === 0 && t.persistedId() === 'v' && !t.failureMemory()['s1'],
    'staging=' + t.stagingDivs().length + ' id=' + t.persistedId());
  // 恢复可见 → visibilitychange → 立刻补做本轮（不等下一个间隔）
  t.setStats('tok-s1', { fps: 30, running: true });
  t.setHidden(false);
  const staged = t.iframeEls[t.iframeEls.length - 1];
  check('恢复可见立刻补做：建立 staging 渲染页',
    t.stagingDivs().length === 1 && String(staged.src).includes('tok-s1'),
    'staging=' + t.stagingDivs().length);
  t.fireLatest(300);                            // 首拍轮询：出帧 → 领养
  t.flushPersist();                             // 落库（200ms 定时器）
  check('补做完成后提交到 s1', t.persistedId() === 's1', 'id=' + t.persistedId());
  const layer = t.layerEl();
  check('提交走节点级领养（staging 容器原地成为层，iframe 未重载）',
    !!layer && layer.querySelector('iframe.we-live-iframe') === staged && staged._parent === layer);
  t.flushPersist();
  check('隐藏不产生失败记忆（隐藏 ≠ 这张壁纸 live 走不通）',
    !t.failureMemory()['s1'], JSON.stringify(t.failureMemory()));
});

// ── K：准备中途被隐藏 —— 短暂离开仍等（回来即时看到本轮切换），超过 60s 上限则
// 释放 staging 并转为「可见时补做」，且**不得**回退提交成静态帧、不得记超时。
await runScenario('K. 准备中途隐藏：≤60s 继续等，超限释放 staging 且不回退成静态帧', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  selection: selSeed(['v','s1'], 'v'),
  stats: { 'tok-s1': { fps: 0, running: false } },   // 先不出帧
}, (t) => {
  t.fireLatest(10000);                          // 可见时到点 → 开始准备
  check('可见时准备立刻建立 staging', t.stagingDivs().length === 1, 'staging=' + t.stagingDivs().length);
  t.fireLatest(300);                            // 首拍：无帧 → 继续等
  t.setHidden(true);                            // 中途切走
  t.clock.offset += 30000;                      // 隐藏 30s（未超上限）
  t.fireLatest(500);                            // 隐藏后的第一次探测（上一次是在可见时 arm 的 500ms）
  t.fireLatest(2000);                           // 隐藏期探测间隔 2000ms
  check('隐藏未超上限：staging 保留（回来即可看到本轮切换）',
    t.stagingDivs().length === 1 && t.persistedId() === 'v',
    'staging=' + t.stagingDivs().length + ' id=' + t.persistedId());
  t.clock.offset += 40000;                      // 累计 70s > 60s 上限
  t.fireLatest(2000);                           // 隐藏期探测（间隔 2000ms）
  check('超过上限：释放 staging、不提交、不回退成静态帧',
    t.stagingDivs().length === 0 && t.persistedId() === 'v',
    'staging=' + t.stagingDivs().length + ' id=' + t.persistedId());
  check('隐藏超限不得记入失败记忆/超时计数（隐藏 ≠ 这张壁纸 live 走不通）',
    !t.failureMemory()['s1'] && t.persistedId() === 'v', JSON.stringify(t.failureMemory()));
  // 恢复可见 → 立刻重新准备 → 出帧 → 领养提交
  t.setStats('tok-s1', { fps: 30, running: true });
  t.setHidden(false);
  check('恢复可见立刻重新准备（新 staging）', t.stagingDivs().length === 1, 'staging=' + t.stagingDivs().length);
  t.fireLatest(300);                            // 新准备的首拍
  t.flushPersist();
  check('补做完成后提交到 s1（且是 live 形态）', t.persistedId() === 's1', 'id=' + t.persistedId());
  const layer = t.layerEl();
  check('补做提交后 live 渲染页在位（未被降级成静态帧/内嵌 MP4）',
    !!layer && !!layer.querySelector('iframe.we-live-iframe'));
});

console.log('');
console.log(failures === 0 ? 'ROTATION PREPARED-LEAK SMOKE PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
