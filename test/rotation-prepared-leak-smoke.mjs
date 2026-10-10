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
}// 轮换准备元素泄漏 smoke：复现并锁死两个故障
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
// 求值，runScenario 内部的局部常量它看不见（那是 ReferenceError 的来源）。
const FADE_GRACE_MS = Number(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  .match(/ROTATION_FADE_MS = (\d+)/)[1]) + 100;
// 帧字节留存表的上限：同样**从产物读**。判据判的是"表被截到上限"，在这里抄死数字等于给
// 上限造第二份真源 —— 上限一改，判据量的就不是产品了。
const FRAME_BYTES_MAX = Number(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  .match(/FRAME_BYTES_MAX = (\d+)/)[1]);

const React = { Fragment:'Fragment', useState:(i)=>[i,()=>{}], useEffect:()=>{}, useRef:(v)=>({current:v}),
  createElement:(t,p,...c)=>{ assertChildren(c); return typeof t==='function'?t(p||{}):({type:t,props:p||null,children:c}); } };

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

// `opts.quietConsole` = 吞掉客户端经 console 打的诊断（等价真机上没开控制台的观感）。默认放行，
// 因为客户端里任何一处 `console.*` 在**没有 console 的 vm 上下文里会直接抛** —— 那会把整段
// 调用链吞掉（实测：留字节那条路整条不执行）。这里必须给 console，否则测的不是产品行为。
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
  const imageEls = [];
  // 宿主 inventory 里当前这批壁纸（`fetch` 的 /settings 响应按它给）。
  const loadedWallpapers = opts.wallpapers;
  // 当前 client 的全局对象：产品把留存表挂在它上面，判据据此读出"留下的到底是哪几条"。
  let liveWindow = null;
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
      // 真 DOM 语义：`play()/pause()` 会同时改 `paused`（**产品读的是它**，见 applyVideoPlayback
      // 的 `!video.paused` 短路）—— 只记 `__paused` 会让"夺回焦点后自动恢复"这条路在测试里
      // 永远走不到 play()，与真机行为分叉（同 getElementById / isConnected 那两处的保真修法）。
      play(){ this.__plays = (this.__plays||0)+1; this.__paused = false; this.paused = false; return Promise.resolve(); },
      pause(){ this.__pauses = (this.__pauses||0)+1; this.__paused = true; this.paused = true; },
      load(){ this.__loads = (this.__loads||0)+1; },
      // canvas 面：留字节那条路要把已解码的帧画进 canvas 再取回 blob（真实浏览器里这两个都在）。
      // `noFrameBytes` 档关掉它 —— 模拟"宿主画不出字节"的形态，用来单独量只留地址那一支。
      getContext(){ if (this.tagName !== 'CANVAS') return null; if (!this.__ctx) { const c = this; this.__ctx = { drawImage(img){ c.__src = String((img && (img.src || (img.attributes && img.attributes.src))) || ''); } }; } return this.__ctx; },
      toBlob(cb){ if (opts.noFrameBytes || this.tagName !== 'CANVAS') { cb(null); return; } cb(makeBlob(this.__src || '')); },
    };
    if (tag === 'video') { el.__plays = 0; el.__pauses = 0; el.__loads = 0; el.__paused = false; el.__removedAttrs = []; }
    // <video>/<img> 的 poster 是**反射属性**：真机上 `el.poster = url` 与 setAttribute 等价，
    // 而切层内容闸门（见 src/live-layer.js 的 layerContentReady）正是按这个属性判「插入这一刻
    // 是否已有画面」。mock 不反射的话，内嵌 MP4 那一档会被判成"没有画面"——测出来的行为与
    // 真机分叉（同 getElementById / isConnected / play-pause 那几处的保真修法）。
    if (tag === 'video' || tag === 'img') {
      Object.defineProperty(el, 'poster', {
        get: () => el.attributes.poster ?? '',
        set: (v) => { el.attributes.poster = v || ''; },
      });
    }
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
      // `__srcSets` = 赋 src 的次数：视频"没有被重载"的可判定形式之一是它只被赋过一次
      //（重赋同值也会触发 resource selection 重新加载 = 黑窗）。判据只读它，不改行为。
      set: (v) => { el.attributes.src = v || ''; el.__srcSets = (el.__srcSets || 0) + 1; },
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

  // object URL 登记表：client 把「帧字节」留成 object URL，判据要能从 `blob:…` 反查回它原本是哪个
  // URL 的字节（否则屏上那一张的断言没法写：`background-image` 里是 blob 地址，不是帧地址）。
  const blobSources = new Map();
  const revokedObjectUrls = [];
  const makeBlob = (source) => Object.assign(new Blob(['png-bytes:' + source], { type: 'image/png' }), { __source: source });
  // 静态帧准备走 new Image()（真实客户端在 headless 环境会同步直通，所以必须
  // 提供 Image 才能测档位不符的领养校验）。
  // `toBlob` 照抄 canvas 的形态（真机上是 canvas → PNG blob）：缺了它，留存帧字节那条路在本测试里
  // 永远不可达 —— 判据就会只覆盖"只记 URL"那一支，而那一支正是要升级掉的东西。
  class ImageMock {
    constructor() {
      this.tagName = 'IMG'; this.attributes = {}; this.naturalWidth = 1920; this.naturalHeight = 1080;
      this.width = 1920; this.height = 1080;
      // 浏览器事实：load 落下之前 `complete === false`（切层内容闸门读这一条判"解码完了吗"）。
      this.complete = false;
      this.__listeners = {};
      imageEls.push(this);
    }
    set src(v){ this.attributes.src = v || ''; }
    get src(){ return this.attributes.src || ''; }
    set className(v){ this._cls = v; } get className(){ return this._cls || ''; }
    cloneNode(){ const c = new ImageMock(); c.src = this.src; return c; }
    set alt(v){} set draggable(v){}
    setAttribute(k, v){ this.attributes[k] = v; }
    getAttribute(k){ return this.attributes[k] ?? null; }
    // 切层闸门会给层里的 <img> 挂 load/error（等待"这一层后来真的有画面了"）——替身缺了事件
    // 设施，那条放行路径在测试里就不可达。
    addEventListener(ev, fn){ (this.__listeners[ev] ||= []).push(fn); }
    removeEventListener(ev, fn){ const a = this.__listeners[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
    // 真机是浏览器自己落 load：这里按同一语义派发（`complete` 由它翻真，属性回调与
    // addEventListener 的监听都要收到），夹具据此声明"这一刻像素到了"。
    __fireLoad() {
      this.complete = true;
      if (typeof this.onload === 'function') this.onload();
      for (const fn of [...(this.__listeners.load || [])]) fn();
    }
    toBlob(cb){ cb(opts.noFrameBytes ? null : makeBlob(this.src)); }
  }

  const bodyEl = makeEl('body');
  // 真事件语义：客户端现在用 visibilitychange/focus 触发「隐藏期间被推迟的轮换」
  // 的补做，mock 若仍是空实现，这条路径在测试里永远不可达（假绿）。
  const docListeners = {}; const winListeners = {};
  const fireOn = (reg, ev) => { for (const fn of (reg[ev] ? [...reg[ev]] : [])) fn({ type: ev }); };
  // 焦点必须**可切换**：遮挡暂停里 `pauseOnBlur` 那一档的判据就是 `!document.hasFocus()`，
  // 写死 true 会让它两个分支都不可达（P3-23 的 A 类候选正是这么漏掉的）。客户端把
  // blur/focus 挂在 **window** 上（见 apply 的 onOcclusionChange），所以配 `fireWin` 用。
  let docFocus = true;
  const document = {
    createElement: (t) => { const el = makeEl(t); if (t==='iframe') iframeEls.push(el); if (t==='video') mediaEls.push(el); return el; },
    // 真 DOM 语义：getElementById 跳过已脱离文档的节点（否则 mock 会让客户端
    // 误以为旧层还在，重建路径与真实行为分叉）。
    getElementById: (id) => { const el = byId[id]; return el && el.isConnected ? el : null; },
    querySelector: () => null,
    head: { appendChild: () => {} },
    body: bodyEl,
    hidden: false,
    hasFocus: () => docFocus,
    addEventListener(ev, fn){ (docListeners[ev] ||= []).push(fn); },
    removeEventListener(ev, fn){ const a = docListeners[ev]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    documentElement: makeEl('html'),
  };

  const localStorage = {
    // `opts.localStorageSeed`：给"上一轮会话留下的别的键"用（例如失败记忆的管线身份
    // `weLivePipeline`）。缺省时 `_store` 与既有场景逐字节一致。
    _store: Object.assign({ 'dsh-wallpaper-engine:selection': JSON.stringify(opts.selection), weRotationTestSec: '10' }, opts.localStorageSeed || {}),
    getItem(k){ return this._store[k] ?? null; }, setItem(k,v){ this._store[k]=v; }, removeItem(k){ delete this._store[k]; },
  };
  const fetch = (url, init) => Promise.resolve({ ok:true, status:200, headers:{ get: () => '0' },
    json: () => Promise.resolve(
      String(url).includes('/settings') ? { ok:true, betterSidebar:false } :
      String(url).includes('/media-info') ? { info:null } :
      { installDir:'D:/we', total:3, portableCount:3, playlists:[], wallpapers: loadedWallpapers }) });

  // ── 主题服务替身（只在 opts.theme 的场景里挂上）───────────────────────────────
  // 宿主侧「改主题」不是一次纯变量写：ThemeRuntime.publish → ctx.emit('theme/change')
  // → ThemePresenter 重写整份别名令牌 + 翻 color-scheme / body 主题属性 + 一次强制样式
  // 读取。替身只复刻**可观察的两件事** —— `setTheme` 与广播 —— 并在调用的那一刻给当时的
  // 媒体层拍一张快照：判据量的是「主题写入落在媒体层的哪一侧」，不是毫秒（开销本身在宿主
  // 侧，harness 里无从复现）。
  const themeSubs = [];
  const themeCalls = [];
  const themeSnap = (id) => {
    const layer = byId['dsh-wallpaper-engine-layer'];
    const live = layer && layer.isConnected ? layer : null;
    const video = live ? live.querySelector('video') : null;
    const iframe = live ? live.querySelector('iframe') : null;
    return { id, layer: live, wid: live ? String(live.dataset.weWid || '') : '',
      video, iframe, media: video || iframe || null,
      src: video ? mediaSrc(video) : (iframe ? String(iframe.src) : '') };
  };
  const themeService = {
    preference: opts.themePreference || 'dark',
    getTheme() { return { preference: themeService.preference, revision: 0 }; },
    setTheme(id) {
      if (themeService.preference === id) return;   // 同判决不写：宿主侧也是这一步先行
      themeCalls.push(themeSnap(id));
      themeService.preference = id;
      for (const fn of [...themeSubs]) fn(themeService.getTheme());
    },
    overrideTokens() { return () => {}; },
  };

  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  // 一轮"宿主下发 + 客户端 init"：换一份持久化 selection 后重新初始化客户端，模块级状态随之重建。
  // 同一条会话里连续下发几张壁纸就先只建一次 sandbox、后面逐轮只换持久化记录并重跑 init（见
  // runScenarioSeries）—— 把 sandbox 整个换掉会把会话级状态一起换掉。
  // 轮换 `order: 'random'` 的取序来源：真机是 Math.random。判据若要构造"访问序 ≠ 插入序"
  // 那种只有 LRU 与 FIFO 才分得开的序列，就得喂一串**确定**的值（见 t.setRandomSeq）；
  // 不喂时逐值转发宿主 Math，本档以外的行为与不给 Math 时一致。
  let randomPick = null;
  const setRandomSeq = (vals) => { let i = 0; randomPick = () => vals[Math.min(i++, vals.length - 1)]; };
  const init = (selection, wallpapers) => {
    clock.offset = 0;
    localStorage._store['dsh-wallpaper-engine:selection'] = JSON.stringify(selection);
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
      // Math 逐方法转发宿主（原型链），只把 random 换成可控序列。
      Math: Object.create(Math, { random: { value: () => (randomPick ? randomPick() : Math.random()) } }),
      // 帧字节留存的载体（真实浏览器里都有）：client 只用 createObjectURL / revokeObjectURL，
      // 台账统一记在 blobSources 里，判据据此把屏上的 blob 地址反查回帧 URL。
      Blob,
      URL: {
        createObjectURL(blob){ const u = 'blob:mock/' + (blobSources.size + 1); blobSources.set(u, String((blob && blob.__source) || '')); return u; },
        revokeObjectURL(u){ revokedObjectUrls.push(String(u)); blobSources.delete(String(u)); },
      },
      // 控制台：真机上有；不给它，客户端里任何 console.* 都会在 vm 上下文里抛
      //（`console` 未定义 ⇒ 取属性就 TypeError）—— 而那会把整段调用链吞掉。
      console,
      location: { origin: 'http://localhost' },
      setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
      clearTimeout:(t)=>{ if(t)t.cleared=true; },
      setInterval:(fn,ms)=>{ const t={fn,ms,cleared:false}; intervals.push(t); return t; },
      clearInterval:(t)=>{ if(t)t.cleared=true; },
    };
    liveWindow = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'client.js' });
    const exportsObj = cap.handoff.factory((spec)=> spec==='react' ? React : { createPortal:(n)=>n });
    const pluginCtx = { slots:{ inject:(k,cb)=>cb(), register:()=>{} },
      // 捕获 cleanup 返回值：卸载路径断言需要它。
      effect(fn){ effects.push(fn); const c = fn(); if (typeof c === 'function') cleanups.push(c); return fn; } };
    // 主题服务只在 opts.theme 的场景里提供：`ctx.get('theme')` 一旦存在，产品的那段主题
    // 接线就会真的跑起来（轮询 → themeFollowAttach → 换壁纸时判决并写入）。不给它的场景
    // 逐字节保持既有行为，既有 40 余条判据因此不受影响。
    if (opts.theme) {
      pluginCtx.get = (id) => (id === 'theme' ? themeService : undefined);
      pluginCtx.on = (ev, fn) => {
        if (ev === 'theme/change') themeSubs.push(fn);
        return () => { const i = themeSubs.indexOf(fn); if (i >= 0) themeSubs.splice(i, 1); };
      };
    }
    exportsObj.apply(pluginCtx);
  };

  const fire = (t) => { if (t && !t.cleared) { t.cleared = true; t.fn(); } };
  const fireLatest = (ms) => { const t = [...timers].reverse().find(x => !x.cleared && x.ms === ms); if (t) fire(t); return t; };
  const flushPersist = () => timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
  const stagingDivs = () => bodyEl.children.filter(c => String(c.className).includes('we-layer--staging'));
  const layerEl = () => byId['dsh-wallpaper-engine-layer'];
  // 孤儿判据：已脱离文档且仍在播的 video —— 修复前回退探针正是这种形态。
  const orphans = () => mediaEls.filter(v => !v.isConnected && !v.__paused);
  const mediaSrc = (el) => String((el && el.attributes && el.attributes.src) || '');
  const persistedId = () => JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id;
  const ctx = { timers, intervals, byId, mediaEls, iframeEls, cleanups, effects, bodyEl, fire, fireLatest,
    flushPersist, stagingDivs, layerEl, orphans, mediaSrc, persistedId, clock, setStats, setWebState, imageEls,
    localStorage, blobSources, revokedObjectUrls, document, themeCalls, themeService, themeSnap,
    // 轮换随机序（见 setRandomSeq 的说明）：喂值后 order='random' 的取序由判据决定。
    setRandomSeq,
    // 留存表本体（产品挂在 window 上的只读诊断面）：用它量"留下的到底是哪几条"。
    frameBytes: () => liveWindow && liveWindow.__weFrameBytes };
  const api = Object.assign(ctx, {
    // 帧字节留存面：blobSources 反查原 URL、revokedObjectUrls 看淘汰有没有真的释放字节。
    // 整份持久化 selection（P3-23 的 A 类候选要断言的不只是 id：`rotationGroupId` 自愈等）。
    persistedSel: () => JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']),
    // 隐藏/恢复必须同时派发 visibilitychange（真机语义）：客户端靠它补做被推迟的轮换。
    setHidden(v){ document.hidden = !!v; fireOn(docListeners, 'visibilitychange'); },
    // 焦点：只改读数，事件要另派（客户端把 blur/focus 挂在 window 上 ⇒ fireWin）
    setFocus(v){ docFocus = !!v; },
    fireDoc(ev){ fireOn(docListeners, ev); },
    fireWin(ev){ fireOn(winListeners, ev); }, failureMemory: () => (JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).sceneLiveFailures || {}),
    // 失败记忆的**管线身份**（`weLivePipeline`）：换管线时客户端会作废旧记忆并刷新它。
    pipelineMarker: () => localStorage._store.weLivePipeline || '' });
  return (async () => {
    init(opts.selection, opts.wallpapers);
    // boot 是 promise 链（loadPersisted → loadInventory → applySelection →
    // syncRotationTimer）：等它落定后再驱动轮换（同既有 smoke 的 50ms 等待）。
    await new Promise((r) => setTimeout(r, 50));
    return body(api);
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
// 就会把它恢复并起播 —— 禁用插件反而开始响。cleanup 因此必须显式停掉 sceneAudioEl：
// 否则禁用时正在播的 BGM 会一直响。
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
  // 模拟卸载：cordis 的卸载语义是跑**全部** fiber disposer —— 只跑最后一个等于假定
  // "主拆卸恰好注册在最尾"，而 cleanup 的注册顺序不保证这一点；逐个跑才是真实路径。
  t.cleanups.forEach((c) => c()); // 模拟「禁用插件 / 热重挂」
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

  // 这一跳的**画面是异步到的**（真机里是探针自己回来），所以在量下一轮之前先把它推到位：
  // 下面第二轮要量的是「一次**已经完成**的切换之后，轮换回视频壁纸」这条路径，而切层内容
  // 闸门（见 src/live-layer.js）会让"新层还没画面"的切换停在旧层上 —— 不推这一下，第二轮
  // 的旧层就不是这里假设的那一层（切层闸门自己的判据在 C 组）。
  const frameProbe = t.imageEls.filter((i) => t.mediaSrc(i) === '/wallpaper-engine/scene-frame/s1').pop() || null;
  if (frameProbe && typeof frameProbe.onload === 'function') frameProbe.onload();

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
  // 模拟卸载：cordis 的卸载语义是跑**全部** fiber disposer。不吞异常：disposer 抛错就成了
  // 「没释放也没人知道」，必须让它在守卫里可见（与兄弟场景的写法一致）。
  t.cleanups.forEach((c) => c());

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
  // 模拟卸载：cordis 的卸载语义是跑**全部** fiber disposer —— 只跑最后一个等于假定
  // "主拆卸恰好注册在最尾"，而 cleanup 的注册顺序不保证这一点；逐个跑才是真实路径。
  t.cleanups.forEach((c) => c()); // 模拟「禁用插件 / HMR 重挂」
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
  check('暂停期间不得记入 sceneLiveFailures（那一刻写 timeout 会导致永久降级）',
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
  t.clock.offset += 300000;                     // 隐藏 5 分钟（每一次复现都会重新加载/释放 staging）
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

// ── L：失败记忆带**管线身份**（旧管线的 timeout 不许压住新管线）──────────────────
// 为什么记忆必须带**管线身份**：宿主半没重载（= 旧管线，`sceneMediaBase` 还是空串）时留下的
// `timeout` 记忆，在客户端更新后仍然逐字显示成「实时渲染失败（首帧超时…）已自动回退」——
// 而那条断言其实属于**另一条管线**，用户会据此判定"修复完全没作用"。判据必须两半都有：
//   ① 旧管线记下的记忆 ⇒ 作废（面板那行才会消失，壁纸才会重新试一次 live）；
//   ② 当前管线自己挣来的记忆 ⇒ **保留**（否则每次刷新都白试一次，记忆就失去意义）。
await runScenario('L. 换管线：旧管线的失败记忆作废一次（自己的那半不受影响）', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 30, running: true } },   // 这条管线其实出得了帧
  selection: Object.assign(selSeed(['s1'], 's1'), { sceneLiveFailures: { s1: 'timeout' } }),
  // 上一轮会话留下的管线身份：build d7 + 媒体源还没出现 ⇒ 与当前管线不可比。
  localStorageSeed: { weLivePipeline: JSON.stringify({ build: 'd7', media: 0 }) },
}, (t) => {
  t.flushPersist();                                  // 迁移会 persistSelection（200ms 定时器）
  check('旧管线的失败记忆被作废（面板那行「实时渲染失败」的唯一来源）',
    !t.failureMemory()['s1'], JSON.stringify(t.failureMemory()));
  const layer = t.layerEl();
  check('作废后这一跳直接建回 live 层（不必手动重开「场景实时渲染」开关）',
    !!layer && !!layer.querySelector('iframe.we-live-iframe'));
  check('管线身份刷新为当前管线（build=d8）',
    /"build":"d8"/.test(String(t.pipelineMarker())), String(t.pipelineMarker()));
});

await runScenario('L2. 同管线：记忆是自己挣来的 ⇒ 不作废（负对照）', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 30, running: true } },
  selection: Object.assign(selSeed(['s1'], 's1'), { sceneLiveFailures: { s1: 'timeout' } }),
  // 当前管线（build d8、媒体源同样还没出现）⇒ 这份记忆是"这条管线"挣来的。
  localStorageSeed: { weLivePipeline: JSON.stringify({ build: 'd8', media: 0 }) },
}, (t) => {
  t.flushPersist();
  check('同一管线的失败记忆保留（作废判据不是"凡有记忆就清"）',
    t.failureMemory()['s1'] === 'timeout', JSON.stringify(t.failureMemory()));
  const layer = t.layerEl();
  check('记忆保留 ⇒ 层走回退链、不建 live 渲染页（记忆的语义没被破坏）',
    !(layer && layer.querySelector('iframe.we-live-iframe')));
  check('未发生作废 ⇒ 管线标记原样保留（没有多余的写盘）',
    String(t.pipelineMarker()) === JSON.stringify({ build: 'd8', media: 0 }), String(t.pipelineMarker()));
});

// ── P：首帧前的垫底画面来源顺序（**实时抓帧 → 作者预览图 → 主题色**）────────────
// 为什么需要：新壁纸**第一次**激活时抓帧还不存在（要等这一轮 live 首帧回填），只试一级
// 会 404 —— 而失败若「静默保留主题色」（近黑）就是一块黑屏。预览图是**作者随包发布的那张**，
// 不是本插件合成的"猜图"（与 buildMedia 里 scene 静态 img 的 onerror 回落同源）。
//
// 夹具形态：**启动即选中该壁纸**（手动/恢复路径 ⇒ 走 buildMedia 建层）。轮换提交走节点级
// 领养（staging 容器原地成层、iframe 不移动，见 syncLayers 的 pendingStagedLayerNode 分支），
// 那条路径不经过 buildMedia，因此**没有**垫底图 —— 用它测这张图会测到空气。
// stats fps=0：live 永远不出首帧 ⇒ iframe 停在 `--we-live-fade:0`（透明），屏上就是垫底图本身，
// 正是用户报的"第一次激活黑屏"那一刻。
await runScenario('P. 首帧前垫底图：抓帧 → 作者预览图 → 主题色（首次激活不留黑屏）', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['s1'], 's1'),
}, (t) => {
  const layer = t.layerEl();
  const poster = layer && layer.querySelector('div.we-live-poster');
  check('场景 live 层带垫底图（不是空层）', !!poster);
  const frameSrc = '/wallpaper-engine/scene-frame/s1';
  const previewSrc = '/wallpaper-engine/preview/s1';
  const probeFrame = t.imageEls.filter((i) => t.mediaSrc(i) === frameSrc).pop() || null;
  check('① 垫底图先试**实时抓帧**（当前视口的真实构图优先于预览图）',
    !!probeFrame, 'probe=' + (probeFrame ? t.mediaSrc(probeFrame) : 'none'));
  check('   来源已记录（诊断能看出退到哪一级）',
    !!poster && poster.dataset.weFrameSrc === frameSrc,
    'weFrameSrc=' + (poster ? poster.dataset.weFrameSrc : 'no poster'));
  // 首次激活：抓帧不存在（这一轮 live 才回填）⇒ 必须退到作者预览图
  if (probeFrame && typeof probeFrame.onerror === 'function') probeFrame.onerror();
  const probePreview = t.imageEls.filter((i) => t.mediaSrc(i) === previewSrc).pop() || null;
  check('② 抓帧 404 ⇒ 退到**作者预览图**（而不是停在近黑主题色）',
    !!probePreview, 'probe=' + (probePreview ? t.mediaSrc(probePreview) : 'none'));
  if (probePreview && typeof probePreview.onload === 'function') probePreview.onload();
  check('③ 预览图就绪 ⇒ 铺上垫底画面（首帧前不再是黑屏）',
    !!poster && String(poster.style.backgroundImage) === 'url(' + previewSrc + ')',
    'bg=' + (poster ? String(poster.style.backgroundImage) : 'no poster'));
  check('   链在首个成功处停（不再产生第三级探针）',
    t.imageEls[t.imageEls.length - 1] === probePreview);
});

// ── P2：负对照 —— 没有预览图时**不得凭空造一级**（否则就是把"猜图"接回来）──────
await runScenario('P2. 无预览图：垫底图只留主题色兜底，不猜图（负对照）', {
  wallpapers: [Object.assign(scene('s2', 'tok-s2'), { preview: null })],
  stats: { 'tok-s2': { fps: 0, running: true } },
  selection: selSeed(['s2'], 's2'),
}, (t) => {
  const layer = t.layerEl();
  const poster = layer && layer.querySelector('div.we-live-poster');
  const frameSrc = '/wallpaper-engine/scene-frame/s2';
  const probeFrame = t.imageEls.filter((i) => t.mediaSrc(i) === frameSrc).pop() || null;
  check('垫底图仍先试实时抓帧', !!probeFrame, 'probe=' + (probeFrame ? t.mediaSrc(probeFrame) : 'none'));
  const imagesBefore = t.imageEls.length;
  if (probeFrame && typeof probeFrame.onerror === 'function') probeFrame.onerror();
  check('抓帧失败且无预览图 ⇒ 不产生第二级探针（不猜图、不回退到别的东西）',
    t.imageEls.length === imagesBefore, 'images=' + imagesBefore + '→' + t.imageEls.length);
  check('垫底图保留主题色兜底（背景图始终没被赋上 —— 判据有牙）',
    !!poster && !poster.style.backgroundImage,
    'bg=' + (poster ? String(poster.style.backgroundImage) : 'no poster'));
});

// ── P3–P7：垫底图的**存在性分级**（谁允许上屏）────────────────────────────────
// P / P2 钉的是「来源顺序」（抓帧 → 作者预览图 → 主题色）与「不替作者猜图」。这一组钉的是
// **上屏规则**本身，一条规则管三档：
//   ① **缓存实时帧存在** ⇒ 直接用实时帧：P6 断言建层那一刻屏上就是它、缩略图一次都不上屏；
//      P7 断言命中**过期**（本会话见过、盘上已没有）时第 2 级才被补发并兜住画面；
//   ② **判失败才准降级**：第 r 级只允许在比它更权威的每一级都**已判失败**之后上屏 —— 高权威级
//      在飞 / 已就绪时，低权威级一律不许上屏（缓存实时帧存在时，缩略图**一次都不该成为屏上那张**，
//      哪怕它先解码完）。P3（高权威级在飞 ⇒ 缩略图不上屏）/ P4（高权威级成功 ⇒ 只有它上屏，
//      低权威级压不回来）/ P5（高权威级判失败 ⇒ 已就绪的缩略图此刻补上）钉的就是这一支；
//   ③ **两者都不存在** ⇒ 主题色兜底（第 0 级同步铺底；P2 钉住"不猜图"那一半）。
// **请求与上屏解耦**：各级探针仍然**并行发出**（第 1 级慢/挂都不挡第 2 级发请求），谁上屏由上面
// 那条存在性闸门说了算 —— 少了并行，第 1 级一慢/一挂第 2 级连请求都发不出去；少了闸门，缩略图
// 会先成为屏上那张（用户要的正是"缓存实时帧存在时不得先出缩略图那一帧"）。
// 判断「存在」的**同步**证据仍是上一轮那只记账（本会话观测到这个 URL 加载成功过，见
// buildLivePoster 的 liveFrameLoadedSrcs）；没有同步证据时，**判失败**是"不存在"的唯一依据 ——
// 所以 P3–P5 的夹具都从冷会话起步（该 URL 还没被观测到）。
//
// 判据一律只看**结果**：此刻垫底图屏上是哪一张（`background-image` 的值），不看内部变量、
// 不看探针数组的顺序。正负对照喂进**同一条**判据（见 docs/DEV-GUIDE.md §4.7 约定 5）。
const posterOf = (t) => {
  const layer = t.layerEl();
  return layer && layer.querySelector('div.we-live-poster');
};
const posterBg = (poster) => (poster && poster.style ? String(poster.style.backgroundImage || '') : '');
// 留存帧字节上屏有**两条通道**，同一条判据都要看得见：
//   · object URL 写进 `background-image`（blob:…）—— 与逐级探针同一条通道，按登记表还原成原 URL；
//   · 拿不到 object URL 的宿主退回插入那个已解码的 `<img>`（src 就是帧 URL）。
// 两条都归约成与 `background-image` 同形的字符串（`url(…)`），于是正负对照写法不变。
const posterBgSrc = (t, poster) => {
  const raw = posterBg(poster);
  const m = /url\(["']?(blob:[^"')]+)["']?\)/.exec(raw);
  if (m) {
    const source = String((t.blobSources && t.blobSources.get(m[1])) || m[1]);
    if (source) return 'url(' + source + ')';
    return raw;
  }
  if (raw) return raw;
  const img = poster && poster.querySelector && poster.querySelector('img');
  const src = img ? t.mediaSrc(img) : '';
  return src ? 'url(' + src + ')' : '';
};
// src 为空串 = 判「屏上没有任何图」（= 只剩第 0 级主题色兜底）
const posterShowsSrc = (t, poster, src) => posterBgSrc(t, poster) === (src ? 'url(' + src + ')' : '');
const posterColor = (poster) => (poster && poster.style ? String(poster.style.backgroundColor || '') : '');
const posterProbeFor = (t, src) => t.imageEls.filter((i) => t.mediaSrc(i) === src).pop() || null;
const fireProbe = (probe, ev) => {
  if (probe && typeof probe[ev] === 'function') { probe[ev](); return true; }
  return false;
};
/**
 * 夹具：把"这个 `<video>` 已经解码好了"这件事按**浏览器事实**标出来，再发事件。
 *
 * 为什么需要：canplay 的 spec 含义就是 `readyState ≥ HAVE_FUTURE_DATA(3)`（手上已经有帧）。
 * 闸门读的是**当下这一帧**（见 src/live-layer.js 的 layerContentReady / src/video-layer.js 的
 * videoContentReady），所以夹具只发事件、不标 readyState，量到的是"元素没有画面"这个**假的**
 * 浏览器事实 —— 会与产品判据（也见 T2：无帧不得放行）自相矛盾。
 */
const markVideoDecoded = (el) => {
  if (!el) return null;
  el.readyState = 3;
  if (typeof el.__fire === 'function') el.__fire('canplay');
  return el;
};

// ── P3：**无缓存实时帧**：第 1 级**还在飞行中**（既未成功也未失败）⇒ 缩略图不得上屏 ──
// 真机形态：本会话还没观测到这张抓帧，而盘上它其实**存在**（4K PNG 正在读/解码；宿主对两条来源
// 都发 no-store，每次建层都要重读重解）。缩略图只有几十 KB、往往还是卡片刚用过的同一张图，几毫秒
// 就解码完 —— 但它**更不权威**：第 1 级没判失败之前，它一次都不该成为屏上那张。
await runScenario('P3. 无缓存实时帧：第 1 级仍在飞行中 ⇒ 缩略图不上屏（存在性闸门）', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['s1'], 's1'),
}, (t) => {
  const poster = posterOf(t);
  const frameSrc = '/wallpaper-engine/scene-frame/s1';
  const previewSrc = '/wallpaper-engine/preview/s1';
  const probeFrame = posterProbeFor(t, frameSrc);
  const probePreview = posterProbeFor(t, previewSrc);
  check('① 抓帧未定（既未成功也未失败）时，两张探针**都已发出**（并行请求，不互相门控）',
    !!probePreview && !!probeFrame,
    'frame=' + (probeFrame ? t.mediaSrc(probeFrame) : 'none')
      + ' preview=' + (probePreview ? t.mediaSrc(probePreview) : 'none'));
  check('   负对照（同一条判据，喂空 src）：此刻屏上还没有任何图 —— 判据有牙，不是恒真',
    posterShowsSrc(t, poster, ''), 'bg=' + posterBg(poster));
  fireProbe(probePreview, 'onload');            // 几十 KB 的 JPEG 先解码完
  check('② 抓帧仍在飞行的同一时刻，屏上**不是**作者预览图（更低权威的级不许先上屏）',
    !posterShowsSrc(t, poster, previewSrc), 'bg=' + posterBg(poster));
  check('   负对照（同一条判据，喂空 src）：屏上仍是"只有主题色"那个状态 —— 判据分得清两张图',
    posterShowsSrc(t, poster, ''), 'bg=' + posterBg(poster));
  // 闸门由「高权威级判失败」打开：这时缩略图才补上（同时钉住"闸门不会被永久关死"）。
  fireProbe(probeFrame, 'onerror');
  check('③ 第 1 级判失败（这一级确实不存在）⇒ 已就绪的缩略图**此刻**才上屏',
    posterShowsSrc(t, poster, previewSrc), 'bg=' + posterBg(poster));
});

// ── P4：**无缓存实时帧**：第 1 级成功 ⇒ 上屏的就是真帧；低权威级压不回来 ──────────────
await runScenario('P4. 无缓存实时帧：第 1 级成功 ⇒ 真帧上屏，缩略图压不回来', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['s1'], 's1'),
}, (t) => {
  const poster = posterOf(t);
  const frameSrc = '/wallpaper-engine/scene-frame/s1';
  const previewSrc = '/wallpaper-engine/preview/s1';
  const probeFrame = posterProbeFor(t, frameSrc);
  const probePreview = posterProbeFor(t, previewSrc);
  check('① 两张探针同场竞速（"谁允许上屏"的前提：两张都可能到）',
    !!probeFrame && !!probePreview, 'frame=' + !!probeFrame + ' preview=' + !!probePreview);
  fireProbe(probePreview, 'onload');            // 低权威先到
  check('② 低权威先到也**不许**上屏（第 1 级尚未判失败）',
    !posterShowsSrc(t, poster, previewSrc) && posterShowsSrc(t, poster, ''),
    'bg=' + posterBg(poster));
  fireProbe(probeFrame, 'onload');              // 高权威后到
  check('③ 真帧到达 ⇒ 上屏的就是真帧',
    posterShowsSrc(t, poster, frameSrc), 'bg=' + posterBg(poster));
  // 负方向：真帧已定稿后，低权威的**迟到回调**不得把它压回去。抓帧先到、预览图后到时，
  // 低权威那次 onload 走的正是这条路径；这里把它再放一次（同一段代码路径）。
  fireProbe(probePreview, 'onload');
  check('④ 负对照（同一条判据）：真帧定稿后低权威不得压回去（屏上仍是真帧）',
    posterShowsSrc(t, poster, frameSrc) && !posterShowsSrc(t, poster, previewSrc),
    'bg=' + posterBg(poster));
});

// ── P5：**无缓存实时帧**：第 1 级**判失败** ⇒ 已就绪的缩略图补上（不退回纯色） ──────────
// 真机形态：首次激活 / 清帧之后抓帧必然 404。缩略图早在并行请求里就绪了，按闸门它必须等到这一级
// **确实不存在**才上屏 —— 上屏那一刻是"补上"，语义是「这一级没有图」，不是「撤掉屏上已有的图」。
await runScenario('P5. 无缓存实时帧：第 1 级判失败 ⇒ 已就绪的缩略图补上（不退回纯色）', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['s1'], 's1'),
}, (t) => {
  const poster = posterOf(t);
  const frameSrc = '/wallpaper-engine/scene-frame/s1';
  const previewSrc = '/wallpaper-engine/preview/s1';
  const probeFrame = posterProbeFor(t, frameSrc);
  const probePreview = posterProbeFor(t, previewSrc);
  const colorBefore = posterColor(poster);
  fireProbe(probePreview, 'onload');            // 缩略图先就绪（按闸门还不能上屏）
  check('① 前置：第 1 级尚未判失败 ⇒ 缩略图还没上屏（闸门关着）',
    !posterShowsSrc(t, poster, previewSrc), 'bg=' + posterBg(poster));
  fireProbe(probeFrame, 'onerror');             // 抓帧 404：这一级不存在
  check('② 第 1 级判失败 ⇒ 已就绪的缩略图**补上**（第 2 档语义：不存在 ⇒ 缩略图兜底）',
    posterShowsSrc(t, poster, previewSrc), 'bg=' + posterBg(poster));
  check('   负对照（同一条判据，喂空 src）：屏上**不是**"只剩主题色"那个状态（不被纯色顶掉）',
    !posterShowsSrc(t, poster, ''), 'bg=' + posterBg(poster));
  check('③ 第 0 级主题色兜底始终在同一元素上垫底（失败路径不动它）',
    colorBefore.length > 0 && posterColor(poster) === colorBefore, 'schemeColor=' + posterColor(poster));
});

// ── P6：**帧字节在手** ⇒ 建层那一刻就是实时帧，且两个级都不发请求 ─────────────
// 这条判据测的是"命中"的新口径：命中 = **本进程里留着这张帧的字节**（见 buildLivePoster 的
// liveFrameBytes），不是"这个地址在本会话取回来过"。所以它的形状是：先让第 1 级成功一次
// （字节由此进留存），再为**同一个 key** 建第二次层，量新 poster 在**建层那一刻**（任何探针
// 回调都还没被触发）屏上是什么、以及这一跳为它发了几个请求。
//
// 正负共用同一条判据（posterShowsSrc 一族）：冷的那一次（留存表还空着）量出"屏上不是实时帧"，
// 热的那一次量出"是" —— 判据在两种输入下给出相反结果，不是恒真。
// 让同一个 key 建第二次层的办法：轮换出去再轮换回来（手动切换与轮换提交都经 syncLayers →
// buildMedia → buildLivePoster）。stats fps=0 ⇒ live 永不出首帧，屏上就是垫底图本身。
await runScenario('P6. 缓存实时帧存在：建层那一刻就是实时帧（缩略图不上屏）', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['v', 's1'], 's1'),   // 启动即选中 s1：冷的那一次建层立刻发生
}, (t) => {
  const frameSrc = '/wallpaper-engine/scene-frame/s1';
  const previewSrc = '/wallpaper-engine/preview/s1';
  const frameProbes = () => t.imageEls.filter((i) => t.mediaSrc(i) === frameSrc);
  const previewProbes = () => t.imageEls.filter((i) => t.mediaSrc(i) === previewSrc);

  // 第一次建层：本会话还没加载过第 1 级（本文件自己的留存表也是空的）
  const cold = posterOf(t);
  check('① 冷（本会话还没见过第 1 级）⇒ 建层那一刻屏上没有任何图 —— 判据有牙，不是恒真',
    !!cold && posterShowsSrc(t, cold, '') && !posterShowsSrc(t, cold, frameSrc),
    'bg=' + posterBg(cold));
  check('   负对照（同一条判据，换 src）：屏上也不是缩略图那张（这一刻谁都还没上屏）',
    !posterShowsSrc(t, cold, previewSrc), 'bg=' + posterBg(cold));
  // 第 1 级加载成功 ⇒ 它的**字节**留在本进程里（下一次建层据此同步上帧）
  fireProbe(frameProbes().pop(), 'onload');
  check('② 第 1 级就绪 ⇒ 屏上是实时帧（字节由此进留存）',
    posterShowsSrc(t, cold, frameSrc), 'bg=' + posterBg(cold));

  // 换出去（v），再换回来（s1）⇒ 同一个 key 的第二次建层
  t.fireLatest(10000);
  const probeV = t.mediaEls[t.mediaEls.length - 1];
  markVideoDecoded(probeV);
  check('③ 前置换出：当前层已不是那张垫底图（"第二次建层"的前提，否则后面量的是同一张）',
    !!t.layerEl() && posterOf(t) === null, 'poster=' + (posterOf(t) ? 'still there' : 'gone'));

  const previewsBefore = previewProbes().length;
  const frameProbesBefore = frameProbes().length;
  t.fireLatest(10000);            // 准备 s1 → live 探测
  t.fireLatest(300);              // 首拍：fps=0 → 未达标，轮询续跑
  t.clock.offset = 16000;         // 跨过 LIVE_FIRST_FRAME_MS（墙钟比较）
  t.fireLatest(500);              // → bail → sceneVideo 探针
  const probeBack = t.mediaEls[t.mediaEls.length - 1];
  markVideoDecoded(probeBack);   // 提交 → buildMedia → buildLivePoster（热）
  const warm = posterOf(t);
  check('④ 缓存命中 ⇒ 第二次建层那一刻屏上**已经是实时帧**（不是缩略图、也不是纯色）',
    !!warm && warm !== cold && posterShowsSrc(t, warm, frameSrc),
    'bg=' + posterBg(warm) + ' layer=' + (t.layerEl() ? String(t.layerEl().dataset.weKey).slice(0, 40) : 'none'));
  check('   负对照（同一条判据，换 src）：缩略图从未成为屏上那张',
    !posterShowsSrc(t, warm, previewSrc), 'bg=' + posterBg(warm));
  check('⑤ 缓存命中 ⇒ 第 2 级连请求都不发（缩略图探针一个都没新增）',
    previewProbes().length === previewsBefore,
    'preview probes ' + previewsBefore + '→' + previewProbes().length);
  // 「有帧就直接上帧」的**确定性**判据：命中时连第 1 级探针都不再建 —— 屏上那张来自本进程留住的
  // 字节，而不是"浏览器这次来得及把那个地址取回来/解码出来"。只断言"屏上是帧"是不够的：把地址写进
  // background-image 也能让屏上是帧，出不出帧仍取决于这一次请求与解码的时序（同一张壁纸时有时无）。
  check('⑥ 缓存命中 ⇒ 第 1 级也不发请求（帧探针没新增：屏上那张来自留住的字节，不是重新取值）',
    frameProbes().length === frameProbesBefore,
    'frame probes ' + frameProbesBefore + '→' + frameProbes().length);
});

// ── P7：**拿不到 object URL**（宿主画不出字节）⇒ 命中改用插入已解码元素那条通道 ──────────
// 上屏有两条通道：object URL 写 background-image（拿得到字节时的主路），或插入那个**已解码的
// Image**（canvas / toBlob 不可用，画布被跨源污染时）。两条都必须"命中即同步、且不为它再发请求"，
// 否则这一支就退回成"每次建层都要重新取值 + 解码"——那正是要修掉的随机性。
// 用 s7（而不是 P6 的 s1）：每条会话一个 sandbox，s7 让两个场景的夹具互不借用状态，量到的就是这一支。
await runScenario('P7. 拿不到 object URL：命中仍同步上帧（插入已解码元素那条通道）', {
  wallpapers: [wallpaperV, scene('s7', 'tok-s7')],
  stats: { 'tok-s7': { fps: 0, running: true } },
  selection: selSeed(['v', 's7'], 's7'),
  noFrameBytes: true,               // canvas.toBlob 拿不到字节这一档
}, (t) => {
  const frameSrc = '/wallpaper-engine/scene-frame/s7';
  const previewSrc = '/wallpaper-engine/preview/s7';
  // 只数**网络探针**：`new Image()` 建的那种（没有 `data-we-frame-src`）。命中时插进屏里的那个
  // 已解码元素带这个标记 —— 它是留住的字节，不是一次新请求，两者必须分开数。
  const frameMark = (i) => String((i && i.attributes && i.attributes['data-we-frame-src']) || '');
  const frameProbes = () => t.imageEls.filter((i) => t.mediaSrc(i) === frameSrc && !frameMark(i));
  const clonedFrames = () => t.imageEls.filter((i) => frameMark(i) === frameSrc);
  const previewProbes = () => t.imageEls.filter((i) => t.mediaSrc(i) === previewSrc);

  // 先建立"这张帧可用"这个事实（冷建层 → 第 1 级成功 ⇒ 字节进留存）
  fireProbe(frameProbes().pop(), 'onload');
  const retainedObjectUrls = t.blobSources.size;   // 拿不到 blob ⇒ 不该登记 object URL
  check('① 前置：这一档确实没留下 object URL（判据量的就是另一条通道）',
    retainedObjectUrls === 0, 'object urls=' + retainedObjectUrls);
  // 换出去再换回来 ⇒ 同一个 key 的第二次建层（命中）
  t.fireLatest(10000);
  const probeV = t.mediaEls[t.mediaEls.length - 1];
  markVideoDecoded(probeV);
  t.fireLatest(10000);
  t.fireLatest(300);
  t.clock.offset = 16000;         // 跨过 LIVE_FIRST_FRAME_MS（墙钟比较）
  t.fireLatest(500);              // → bail → sceneVideo 探针
  const probeBack = t.mediaEls[t.mediaEls.length - 1];
  const frameProbesBefore = frameProbes().length;
  const previewsBefore = previewProbes().length;
  markVideoDecoded(probeBack);   // 提交 → 命中分支（第 2 次建层）
  const warm = posterOf(t);
  check('② 命中：第 2 次建层那一刻屏上已是实时帧（插入的是已解码元素，不是纯色也不是缩略图）',
    !!warm && posterShowsSrc(t, warm, frameSrc), 'bg=' + posterBgSrc(t, warm));
  check('③ 命中不为它再发请求：网络探针没新增（屏上那张来自留住的元素，不是重新取值）',
    frameProbes().length === frameProbesBefore,
    'frame probes ' + frameProbesBefore + '→' + frameProbes().length
      + ' cloned=' + clonedFrames().length);
  check('   前置：这一跳确实是**插入已解码元素**那条通道上的屏（不是靠新探针才有的图）',
    clonedFrames().length > 0, 'cloned=' + clonedFrames().length);
  check('   负对照（同一条判据，换 src）：缩略图从未成为屏上那张',
    !posterShowsSrc(t, warm, previewSrc), 'bg=' + posterBgSrc(t, warm));
  check('④ 命中时第 2 级连请求都不发（缩略图探针也没新增）',
    previewProbes().length === previewsBefore,
    'preview probes ' + previewsBefore + '→' + previewProbes().length);
});

// ── P8：留存帧字节的**替换路径**：换一份帧字节时旧的 object URL 必须被撤销 ──────────────
// 一条 object URL 背后是一整帧的字节。留着不撤，那份字节在页面关闭前都不会回来；同一个 key 反复
// 成功（下一次建层又把它取回来一次）时尤其明显 —— 每轮都多留一份、旧的谁都不收。
// 判据只认**可观测**的两件事：登记过的 object URL 有没有被撤销、屏上那张是不是帧的字节。
// ⚠️ **上限本身（FRAME_BYTES_MAX）这条判据量不到**：触发淘汰要"同一个会话里留过超过上限张数"的
// 夹具，而本冒烟每起一个场景就重建一次客户端，模块级的留存表跟着重建（实测：每次建层后表里恒为
// 1 条）。所以这里钉的是**替换时也必须撤地址**这条 —— 它与淘汰那条共用同一个释放函数，漏掉它
// 就是无界增长的真身（见本报告"没能证明"一节）。
await runScenario('P8. 留存帧字节替换：旧 object URL 被撤销（只删记账不撤地址 = 无界增长）', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['s1'], 's1'),
}, (t) => {
  const frameSrc = '/wallpaper-engine/scene-frame/s1';
  const probe = posterProbeFor(t, frameSrc);
  check('① 前置：第 1 级探针在场（本轮帧字节的来源）', !!probe, 'src=' + frameSrc);
  // 帧就绪 ⇒ 字节进留存
  fireProbe(probe, 'onload');
  const bytes = t.frameBytes();
  check('② 帧就绪后留存表里就是这一条（诊断面可读出留下的是哪几张）',
    !!bytes && bytes.size === 1 && bytes.has(frameSrc), 'size=' + (bytes ? bytes.size : 'n/a'));
  const urlsAfterFirst = t.blobSources.size;
  // 同一个 URL 再成功一次（真机形态：下一次建层又把它取回来了一次）⇒ 换一份字节
  fireProbe(posterProbeFor(t, frameSrc), 'onload');
  check('③ 同一 URL 再来一次不会越留越多：留存表仍只有这一条（每键一份）',
    t.frameBytes() && t.frameBytes().size === 1, 'size=' + (t.frameBytes() ? t.frameBytes().size : 'n/a'));
  check('④ 旧的 object URL 被 URL.revokeObjectURL 撤掉（不撤 = 那份字节收到页面关闭）',
    t.revokedObjectUrls.length === 1 && t.blobSources.size === urlsAfterFirst,
    'revoked=' + t.revokedObjectUrls.length + ' registered=' + t.blobSources.size);
  check('⑤ 屏上始终是这张帧（换字节不撤图）', posterShowsSrc(t, posterOf(t), frameSrc),
    'bg=' + posterBgSrc(t, posterOf(t)));
});

// ── X：web 壁纸的**实时帧腿**（宿主 inventory 的 liveFrame → 垫底图第 1 级 + 抽帧定时器）──
// 宿主为每张 web 壁纸发 `liveFrame`（`/live-frame/<token>`），客户端在 live 首帧稳定后向它
// 回填抽帧。这条字段落到 `selection.liveFrame` 之后，web 支才有三样东西可观测：候选表首项是
// 帧、为它发了存在性探针、首帧稳定后武装 3000ms 抽帧定时器（那一路里还有"真实渲染帧"参与
// 主题判决）。判据只看这三件事，正负对照喂进**同一条**取用器 webFrameFacts。
const webWallpaper = (id, opts) => Object.assign({
  id, title: id.toUpperCase(), type: 'web', playable: true,
  media: '/wallpaper-engine/web/' + id, webLive: true, webLiveSrc: 'tok-' + id,
  preview: '/wallpaper-engine/preview/' + id, contentrating: 'Everyone',
}, (opts && opts.hostSendsLiveFrame === false) ? {} : { liveFrame: '/wallpaper-engine/live-frame/' + id });
const webFrameFacts = (t, frameSrc, previewSrc) => {
  const poster = posterOf(t);
  const probed = t.imageEls.map((i) => t.mediaSrc(i));
  return {
    head: poster ? String(poster.dataset.weFrameSrc || '') : '',
    frameProbed: probed.includes(frameSrc),
    previewProbed: probed.includes(previewSrc),
    // 3000ms 也属于别的腿（例如场景视频的时序补拉），所以判据量的是**增量**而不是绝对值。
    captureTimers: t.timers.filter((x) => !x.cleared && x.ms === 3000).length,
  };
};
// live 首帧稳定：iframe load → 1s 心跳第一拍（alive ⇒ we-live-on + maybeCaptureLiveFrame）。
const fireLiveFirstFrame = (t) => {
  const live = t.layerEl() && t.layerEl().querySelector('iframe.we-live-iframe');
  if (live) live.__fire('load');
  const tick = t.intervals.find((x) => !x.cleared && x.ms === 1000);
  if (tick) tick.fn();
};

await runScenario('X1. web 壁纸：宿主发的 liveFrame 成为垫底图第 1 级，且抽帧定时器会装上', {
  wallpapers: [webWallpaper('w1')],
  selection: selSeed(['w1'], 'w1'),
}, (t) => {
  const frameSrc = '/wallpaper-engine/live-frame/w1';
  const previewSrc = '/wallpaper-engine/preview/w1';
  const cold = webFrameFacts(t, frameSrc, previewSrc);
  check('① web 支的候选表首项是**宿主发的实时帧**（不是作者预览图）',
    cold.head === frameSrc, 'head=' + cold.head);
  check('② 第 1 级（实时帧）确实发了探针：它参与存在性闸门，不是记账里的摆设',
    cold.frameProbed && cold.previewProbed,
    'frame=' + cold.frameProbed + ' preview=' + cold.previewProbed);
  check('   负对照（同一条取用器，换 src）：首项不是预览图 —— 判据分得清两条腿',
    cold.head !== previewSrc, 'head=' + cold.head);
  check('③ 首帧稳定之前没有抽帧定时器（它只在首帧那一跳被武装）',
    cold.captureTimers === 0, 'timers3000=' + cold.captureTimers);
  fireLiveFirstFrame(t);
  const warm = webFrameFacts(t, frameSrc, previewSrc);
  check('④ live 首帧稳定 ⇒ 抽帧定时器（3000ms）已武装 —— 帧腿可达（抽帧上传 + 真实帧参与主题判决）',
    warm.captureTimers > cold.captureTimers,
    'timers3000 ' + cold.captureTimers + '→' + warm.captureTimers);
});

// ── X2：负对照 —— 宿主没发 liveFrame（或没有媒体）时 web 支**没有**帧腿 ──────────────
// 与 X1 同一族取用器：同一份判断换成"这条字段缺席"的输入，三件事必须全部相反。
await runScenario('X2. 负对照：宿主没发 liveFrame ⇒ web 支没有帧腿（同一取用器）', {
  wallpapers: [webWallpaper('w1', { hostSendsLiveFrame: false })],
  selection: selSeed(['w1'], 'w1'),
}, (t) => {
  const frameSrc = '/wallpaper-engine/live-frame/w1';
  const previewSrc = '/wallpaper-engine/preview/w1';
  const cold = webFrameFacts(t, frameSrc, previewSrc);
  check('① 首项退到作者预览图（这一档确实没有实时帧候选）',
    cold.head === previewSrc, 'head=' + cold.head);
  check('② 没有为实时帧发探针（候选表里根本没有它）',
    !cold.frameProbed && cold.previewProbed,
    'frame=' + cold.frameProbed + ' preview=' + cold.previewProbed);
  fireLiveFirstFrame(t);
  const warm = webFrameFacts(t, frameSrc, previewSrc);
  check('③ live 首帧稳定也不会武装抽帧定时器（没有帧可抽、没有槽位可回填）',
    warm.captureTimers === cold.captureTimers,
    'timers3000 ' + cold.captureTimers + '→' + warm.captureTimers);
});

// ── P9：留存表的**上限与淘汰顺序**（同一会话轮换 9 张不同帧）────────────────────────
// 留存表是**模块级**的 ⇒ 要长到上限、要真的触发淘汰，必须在同一个 sandbox 里轮换到不同的
// frame URL（每个场景一个 sandbox 的夹具永远只留得下 1 条）。顺序由轮换 `order:'random'` 的
// Math.random 喂定：先 s1..s8 把表填满，再回到 s1（**命中**：搬到表尾），最后 s9（新条目 ⇒
// 淘汰）。命中之后谁该出表正是 LRU 与 FIFO 的唯一分界点 —— LRU 淘汰 s2（最久没被画过的那
// 一张），FIFO 淘汰 s1（刚被画过的那一张）。
const frameKey = (i) => '/wallpaper-engine/scene-frame/s' + i;
const noFpsStats = (ids) => Object.fromEntries(ids.map((id) => ['tok-' + id, { fps: 0, running: true }]));
const lruIds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
await runScenario('P9. 留存表 LRU：命中搬到表尾 ⇒ 超上限淘汰的是最久没被用到的那一条', {
  wallpapers: lruIds.map((id) => scene(id, 'tok-' + id)),
  stats: noFpsStats(lruIds),
  selection: Object.assign(selSeed(lruIds, 's1'), {
    rotationGroups: [{ id: 'g1', name: 'L', interval: 5, order: 'random', wallpaperIds: lruIds }],
  }),
}, (t) => {
  const bytes = () => t.frameBytes();
  const keys = () => (bytes() ? [...bytes().keys()] : []);
  const urlFor = (src) => { for (const [u, s] of t.blobSources) if (s === src) return u; return ''; };
  const nextRound = () => {
    t.fireLatest(10000);            // 轮换 → 准备下一张（live 探测）
    t.fireLatest(300);              // 首拍 fps=0 → 未达标，轮询续跑
    t.clock.offset += 16000;        // 跨过 LIVE_FIRST_FRAME_MS（墙钟比较）
    t.fireLatest(500);              // → bail → sceneVideo 探针
    const probe = t.mediaEls[t.mediaEls.length - 1];
    if (probe) probe.__fire('canplay');   // 提交 → buildMedia → buildLivePoster
  };
  // 取值序：每轮在"除当前张以外的 8 张"里选中下一张（下标 × 8 取整）。
  t.setRandomSeq([0.05, 0.2, 0.3, 0.4, 0.5, 0.7, 0.8, 0.1, 0.95]);
  // 启动即选中 s1：它的第 1 级探针 onload ⇒ 字节进留存（表由此有第一条）
  fireProbe(posterProbeFor(t, frameKey(1)), 'onload');
  check('① 前置：启动那一层已把 s1 的帧字节留住（留存表里唯一的一条）',
    !!bytes() && bytes().size === 1 && bytes().has(frameKey(1)),
    'size=' + (bytes() ? bytes().size : 'n/a'));
  // s2..s8：每轮换到一个**表里还没有字节**的 key ⇒ 冷建层 ⇒ 探针 onload 后进表
  for (let i = 2; i <= 8; i++) {
    nextRound();
    const probe = posterProbeFor(t, frameKey(i));
    check('   前置：第 ' + (i - 1) + ' 轮落在 s' + i + '（表里还没有它的字节 ⇒ 这一跳是冷建层）',
      !!probe && !keys().includes(frameKey(i)), 'probe=' + !!probe + ' size=' + keys().length);
    fireProbe(probe, 'onload');
  }
  check('② 前置：8 张不同帧刚好把表填到上限（还没触发淘汰）',
    keys().length === FRAME_BYTES_MAX, 'size=' + keys().length + '/' + FRAME_BYTES_MAX);
  // 第 9 轮回到 s1：字节还在表里 ⇒ 命中（同步上屏、一个探针都不发）= "最近被用到"那次访问
  const f1ProbesBefore = t.imageEls.filter((i) => t.mediaSrc(i) === frameKey(1)).length;
  nextRound();
  const f1ProbesAfter = t.imageEls.filter((i) => t.mediaSrc(i) === frameKey(1)).length;
  check('③ 前置：回到 s1 的那一跳是**命中**（屏上是帧的字节，且没有为它新建探针）',
    posterShowsSrc(t, posterOf(t), frameKey(1)) && f1ProbesAfter === f1ProbesBefore,
    'bg=' + posterBgSrc(t, posterOf(t)) + ' probes=' + f1ProbesBefore + '→' + f1ProbesAfter);
  const f2Url = urlFor(frameKey(2));
  // 第 10 轮：s9 是**新条目**（表里没有）⇒ 进表后超上限，必须淘汰一条
  nextRound();
  fireProbe(posterProbeFor(t, frameKey(9)), 'onload');
  check('④ 上限生效：同会话轮换 9 张不同帧之后，表被截到上限（不是无界增长）',
    keys().length === FRAME_BYTES_MAX, 'size=' + keys().length + '/' + FRAME_BYTES_MAX);
  check('⑤ 淘汰的是**最久没被用到**的那一条（s2：最后一次用它是在 7 轮之前）',
    !bytes().has(frameKey(2)), 'has(s2)=' + bytes().has(frameKey(2)));
  check('   正对照（同一条判据，换 key）：刚被画过的那一条（s1）留住了 —— 判据分得清两者',
    bytes().has(frameKey(1)), 'has(s1)=' + bytes().has(frameKey(1)));
  check('⑥ 被淘汰那一条的 object URL 被 URL.revokeObjectURL 撤销（不是只删记账）',
    !!f2Url && t.revokedObjectUrls.includes(f2Url),
    'f2=' + f2Url + ' revoked=' + JSON.stringify(t.revokedObjectUrls));
});

// ── T：切层内容闸门 —— 切换里不得出现「屏上是新层、但它还没有画面」的中间态 ──────────
// 用户报的"几帧纯色"就是这一态：新层进文档那一刻只有第 0 级底色，画面要等**异步**的
// 探针 onload / 第一帧；深浅主题自动切换只是把这段窗口拉长（它写主题那一轮压在同一
// 主线程上），所以关掉那个开关也仍然看得见。闸门把这一段交给**旧层的像素**：新层有
// 画面之前不撤旧层、也不让新层参与绘制（`we-layer--pending`，见 src/live-layer.js）。
//
// 判据只量**结果**：在这一跳的每一个可观测中间态里，**参与绘制的那一层**必须已经有画面。
//   · 参与绘制 = DOM 顺序里最后一个既不是 `--pending` 也不是 `--staging` 的 `.we-layer`
//     （这两类在设计上就不参与绘制）；
//   · 有画面 = 按**浏览器事实**读：垫底图已铺上 `background-image` / `<img>` 已解码 /
//     `<video>` 有 poster 或 `readyState ≥ 2`(HAVE_CURRENT_DATA) / 实时渲染页已点亮。
// 正负对照组喂进**同一条**函数（docs/DEV-GUIDE.md §4.7 约定 5）。
const LAYER_PENDING_CLS = 'we-layer--pending';
const paintedLayerOf = (t) => {
  const shown = t.bodyEl.children.filter((c) => {
    const cls = String(c.className || '');
    return cls.includes('we-layer') && !cls.includes(LAYER_PENDING_CLS) && !cls.includes('we-layer--staging');
  });
  return shown.length ? shown[shown.length - 1] : null;
};
const layerShowsPicture = (layer) => {
  if (!layer || typeof layer.querySelector !== 'function') return false;
  const poster = layer.querySelector('div.we-live-poster');
  if (poster && String(poster.style.backgroundImage || '')) return true;
  const img = layer.querySelector('img');
  if (img && Number(img.naturalWidth) > 0) return true;
  const video = layer.querySelector('video');
  if (video && (video.getAttribute('poster') || Number(video.readyState) >= 2)) return true;
  const live = layer.querySelector('iframe.we-live-iframe');
  if (live && String(live.className).includes('we-live-on')) return true;
  return false;
};
// 共用判据：一次切换表示成一串可观测中间态，逐态判"参与绘制的那一层不得没有画面"。
const noBlankFrameInSwitch = (frames) => frames.every((f) => !f.shown || f.showsPicture === true);
// 闸门的**输出**（而不是它的输入）：这一层是不是被挡在绘制之外、此刻参与绘制的是不是它。
// 下面 T7/T8 成对喂进这两条 —— 同一份输入（元素）在"有像素 / 没像素"两态下必须给出相反结果。
const layerIsPending = (layer) => !!layer && String(layer.className || '').includes(LAYER_PENDING_CLS);
const layerPainted = (t, layer) => !!layer && paintedLayerOf(t) === layer;
// 浏览器事实（与切层闸门同一口径）：`complete` 也覆盖"加载失败"，所以要连 `naturalWidth` 一起看。
const imgHasPixels = (img) => !!img && img.complete === true && Number(img.naturalWidth) > 0;
const observeFrame = (t, at) => {
  const shown = paintedLayerOf(t);
  return { at, shown, showsPicture: layerShowsPicture(shown) };
};
const frameLabel = (f) => f.at + ' → ' + (f.shown ? (f.showsPicture ? '有画面' : '**无画面**') : '无层');

// ── T1：切到场景 live（冷）—— 垫底图还没有图之前，旧层一直在屏上 ────────────────
// 真机形态：轮换/手动切到一张场景壁纸，`buildMedia` 现建垫底图，它的第 1 级抓帧与第 2 级
// 预览图都要等探针 onload。闸门之前，这一段窗口里屏上就是"新层 + 第 0 级纯色"。
await runScenario('T1. 切层内容闸门：垫底图还没有图 ⇒ 旧层留在屏上（无"无画面"中间态）', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['v', 's1'], 'v'),
}, (t) => {
  const frameSrc = '/wallpaper-engine/scene-frame/s1';
  const oldLayer = t.layerEl();
  const oldVideo = oldLayer && oldLayer.querySelector('video');
  // 旧层是**已经在出帧**的那一层：夹具按浏览器事实标它（canplay 之后 readyState ≥ 3）。
  if (oldVideo) oldVideo.readyState = 3;
  const beforeFrame = observeFrame(t, '切换前');
  check('前置：切换前屏上是旧层，且它有画面（判据的分辨力前提）',
    beforeFrame.shown === oldLayer && beforeFrame.showsPicture === true, frameLabel(beforeFrame));

  // 走轮换这条唯一的换壁纸入口：live 探测超时 → 回退 sceneVideo → 提交时 buildMedia 仍
  // 选 live 分支（探测放弃刻意不簿记失败记忆），于是这一跳**现建**垫底图与渲染页。
  t.fireLatest(10000);
  t.fireLatest(300);
  t.clock.offset = 16000;       // 跨过 LIVE_FIRST_FRAME_MS（墙钟比较）
  t.fireLatest(500);            // → bail → sceneVideo 探针
  const probeBack = t.mediaEls[t.mediaEls.length - 1];
  if (probeBack) probeBack.__fire('canplay');   // 提交 → 建 live 层

  const newLayer = t.layerEl();
  const pendingFrame = observeFrame(t, '提交后（垫底图还没图）');
  check('① 当前壁纸的层已经是**新层**（LAYER_ID 在它手里）',
    !!newLayer && newLayer !== oldLayer && !!newLayer.querySelector('div.we-live-poster'),
    'new=' + (!!newLayer && newLayer !== oldLayer));
  check('② 但它还没有画面：这一层被闸门挡在绘制之外（we-layer--pending）',
    !!newLayer && String(newLayer.className).includes(LAYER_PENDING_CLS)
      && layerShowsPicture(newLayer) === false,
    'cls=' + (newLayer && newLayer.className) + ' picture=' + (newLayer && layerShowsPicture(newLayer)));
  check('③ 这一刻参与绘制的是**旧层**（屏上是旧壁纸的像素，不是新层的底色）',
    pendingFrame.shown === oldLayer, frameLabel(pendingFrame));

  // 画面到了（真机里是抓帧或作者预览图的探针回来）
  const frameProbe = t.imageEls.filter((i) => t.mediaSrc(i) === frameSrc).pop() || null;
  check('   前置：这一跳确实发了抓帧探针（垫底图的第 1 级，冷会话里没有字节在手）', !!frameProbe);
  if (frameProbe && typeof frameProbe.onload === 'function') frameProbe.onload();
  const shownFrame = observeFrame(t, '画面到位后');
  check('④ 画面到手 ⇒ 新层被放行，且**同一个元素**此刻已经有画面',
    shownFrame.shown === newLayer && shownFrame.showsPicture === true
      && layerShowsPicture(newLayer) === true, frameLabel(shownFrame));
  check('⑤ 结果型判据：这一跳的每一个可观测中间态里，参与绘制的那一层都有画面',
    noBlankFrameInSwitch([beforeFrame, pendingFrame, shownFrame]),
    [beforeFrame, pendingFrame, shownFrame].map(frameLabel).join(' | '));
  check('   负对照（同一条判据，喂"被绘制了但还没有画面"的合成态）：判不合格 —— 判据有牙',
    !noBlankFrameInSwitch([{ at: '合成态', shown: newLayer, showsPicture: false }]), '合成态被拒');
});

// ── T2：切到视频壁纸 —— `<video>` 没有任何可解码帧 / poster 时不得被显示 ──────────
// 视频类壁纸**刻意不设 poster**（作者预览常是动图，见 src/media-prep.js 的取舍），所以
// 它进文档时必然是一块还没有任何帧的 `<video>`：浏览器把这种元素画成空/黑，肉眼看就是
// "一块色"。判据按浏览器事实量（readyState < 2 = 手上没有帧）。
await runScenario('T2. 切层内容闸门：<video> 无帧 / 无 poster ⇒ 旧层留在屏上', {
  wallpapers: [
    { id:'t1', title:'T1', type:'video', playable:true, media:'/wallpaper-engine/media/t1',
      preview:'/wallpaper-engine/preview/t1', contentrating:'Everyone' },
    { id:'t2', title:'T2', type:'video', playable:true, media:'/wallpaper-engine/media/t2',
      preview:'/wallpaper-engine/preview/t2', contentrating:'Everyone' },
  ],
  selection: selSeed(['t1', 't2'], 't1'),
}, (t) => {
  const oldLayer = t.layerEl();
  const oldVideo = oldLayer && oldLayer.querySelector('video');
  if (oldVideo) oldVideo.readyState = 3;
  const beforeFrame = observeFrame(t, '切换前');
  check('前置：切换前屏上是旧层，且它有画面', beforeFrame.shown === oldLayer && beforeFrame.showsPicture,
    frameLabel(beforeFrame));

  t.fireLatest(10000);            // 轮换到 t2：视频候选不跑准备链 ⇒ 提交即建新层
  const probe = t.mediaEls[t.mediaEls.length - 1];
  const newLayer = t.layerEl();
  check('   前置：新层的 <video> 是现建的，既没有帧也没有 poster',
    !!probe && probe !== oldVideo && Number(probe.readyState || 0) < 2
      && !probe.getAttribute('poster'),
    'readyState=' + probe.readyState + ' poster=' + JSON.stringify(probe.getAttribute('poster')));
  const pendingFrame = observeFrame(t, '提交后（<video> 还没有帧）');
  check('① 无帧的 <video> 没有被显示：这一刻屏上还是旧层',
    pendingFrame.shown === oldLayer && !!newLayer
      && String(newLayer.className).includes(LAYER_PENDING_CLS),
    frameLabel(pendingFrame) + ' cls=' + (newLayer && newLayer.className));
  // canplay 的 spec 含义：readyState ≥ HAVE_FUTURE_DATA(3) —— 手上已经有一帧可解码数据。
  probe.readyState = 3;
  probe.__fire('canplay');
  const shownFrame = observeFrame(t, 'canplay 之后');
  check('② 有帧了才放行，且放行那一刻它已经有画面',
    shownFrame.shown === newLayer && shownFrame.showsPicture === true, frameLabel(shownFrame));
  check('③ 结果型判据（同一条函数）：每个中间态里参与绘制的那一层都有画面',
    noBlankFrameInSwitch([beforeFrame, pendingFrame, shownFrame]),
    [beforeFrame, pendingFrame, shownFrame].map(frameLabel).join(' | '));
});


// ── T3：正对照 —— 插入时就已有画面的那一档**不该**被闸门拦 ─────────────────────
// 内嵌 MP4（sceneVideo）在 buildMedia 里 `media.poster = 静态帧`：插入那一刻"有画面"
// 已经成立。闸门若不认这一条，每次切到内嵌 MP4 的场景都会白等一轮 —— 正对照证明它认。
await runScenario('T3. 正对照：内嵌 MP4（poster=静态帧）插入即上屏，不被闸门拦', {
  wallpapers: [wallpaperV, scene('s6', 'tok-s6')],
  // live 开关是**全局设置**（selection.sceneLive），不是每张壁纸的字段：关掉它这一跳才
  // 会落到「内嵌 MP4」那条腿（见 src/media-prep.js 的 prepareWallpaper 优先级）。
  selection: Object.assign(selSeed(['v', 's6'], 'v'), { sceneLive: false }),
}, (t) => {
  t.fireLatest(10000);            // 准备 s6：live 关闭 ⇒ 直接走 sceneVideo 探针
  const probe = t.mediaEls[t.mediaEls.length - 1];
  check('   前置：sceneVideo 探针带 poster（作者静态帧，真机上与 setAttribute 等价）',
    !!probe && String(probe.getAttribute('poster') || '').includes('/wallpaper-engine/scene-frame/s6'),
    'poster=' + (probe && probe.getAttribute('poster')));
  markVideoDecoded(probe);        // 提交 → 元素级领养
  const newLayer = t.layerEl();
  check('① 新层立刻参与绘制（没有被 --pending 挡住）',
    !!newLayer && !String(newLayer.className).includes(LAYER_PENDING_CLS)
      && paintedLayerOf(t) === newLayer, 'cls=' + (newLayer && newLayer.className));
  check('② 且它插入时就已有画面（poster = 静态帧）', layerShowsPicture(newLayer) === true,
    frameLabel(observeFrame(t, '领养后')));
});

// ── T4：终点语义 —— 一张图都没有时闸门必须放行（否则旧层永远换不下去）────────────
// 「探索不到任何画面」是一个**有限**的结论（探针会失败），不是等待：这一跳照旧停在既有的
// 第 0 级主题色兜底上（见 P2 与 buildLivePoster 的终点语义）。这里量的是**闸门会打开**，
// 不是"放行那一刻有画面" —— 这是本闸门唯一的诚实边界（一份画面都不存在的壁纸，屏上只能
// 是那层安静的颜色）。
await runScenario('T4. 终点语义：抓帧与预览图都不存在 ⇒ 闸门放行，停在主题色兜底', {
  wallpapers: [wallpaperV, Object.assign(scene('s2', 'tok-s2'), { preview: null })],
  stats: { 'tok-s2': { fps: 0, running: true } },
  selection: selSeed(['v', 's2'], 'v'),
}, (t) => {
  const frameSrc = '/wallpaper-engine/scene-frame/s2';
  const oldLayer = t.layerEl();
  const oldVideo = oldLayer && oldLayer.querySelector('video');
  if (oldVideo) oldVideo.readyState = 3;
  t.fireLatest(10000);
  t.fireLatest(300);
  t.clock.offset = 16000;
  t.fireLatest(500);              // → bail → sceneVideo 探针
  const probeBack = t.mediaEls[t.mediaEls.length - 1];
  if (probeBack) probeBack.__fire('canplay');   // 提交 → 建 live 层（垫底图在等图）
  const newLayer = t.layerEl();
  const pendingFrame = observeFrame(t, '提交后（抓帧探针在飞）');
  check('① 抓帧还没有结论之前守在旧层上',
    pendingFrame.shown === oldLayer && !!newLayer
      && String(newLayer.className).includes(LAYER_PENDING_CLS), frameLabel(pendingFrame));
  const probeFrame = t.imageEls.filter((i) => t.mediaSrc(i) === frameSrc).pop() || null;
  check('   前置：这一档只有抓帧一级（作者没有发布预览图 ⇒ 不猜图，见 P2）',
    !!probeFrame && !t.imageEls.some((i) => t.mediaSrc(i) === '/wallpaper-engine/preview/s2'),
    'frame=' + !!probeFrame + ' preview=' + t.imageEls.length);
  if (probeFrame && typeof probeFrame.onerror === 'function') probeFrame.onerror();
  const doneFrame = observeFrame(t, '抓帧判失败后');
  check('② 判失败 =「这一张壁纸没有画面」这个结论已确定 ⇒ 闸门放行（不会永远守着旧层）',
    doneFrame.shown === newLayer && !String(newLayer.className).includes(LAYER_PENDING_CLS),
    frameLabel(doneFrame));
  const poster = newLayer && newLayer.querySelector('div.we-live-poster');
  check('③ 此刻停在既有的第 0 级主题色兜底上（终点语义没变）',
    layerShowsPicture(newLayer) === false
      && !!poster && String(poster.style.backgroundColor || '').length > 0,
    'bg=' + (poster ? poster.style.backgroundColor : 'no poster'));
});

// ── T5：默认过场（**硬切**，`DEFAULTS.switchTransition = 'cut'`）也走同一条闸门 ────────
// 硬切那条腿原本是"先拆旧层，再建新层"：闸门之前，拆掉旧层与赋上画面之间那一帧就是
// 一块纯色 —— 用户默认配置下看到的多半正是它。这里量硬切：画面到位之前旧层仍在屏上，
// 到位之后旧层才**一次性退场**（body 里只剩新层）。
await runScenario('T5. 硬切（默认过场）：旧层留到新层有画面，之后一次性退场', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: Object.assign(selSeed(['v', 's1'], 'v'), { switchTransition: 'cut' }),
}, (t) => {
  const frameSrc = '/wallpaper-engine/scene-frame/s1';
  const layersNow = () => t.bodyEl.children.filter((c) => String(c.className).includes('we-layer'));
  const oldLayer = t.layerEl();
  const oldVideo = oldLayer && oldLayer.querySelector('video');
  if (oldVideo) oldVideo.readyState = 3;
  const beforeFrame = observeFrame(t, '切换前');
  t.fireLatest(10000);
  t.fireLatest(300);
  t.clock.offset = 16000;
  t.fireLatest(500);
  const probeBack = t.mediaEls[t.mediaEls.length - 1];
  if (probeBack) probeBack.__fire('canplay');
  const newLayer = t.layerEl();
  const pendingFrame = observeFrame(t, '硬切提交后（垫底图还没图）');
  check('① 硬切也不许提前拆旧层：这一刻屏上仍是旧壁纸（两张层都在文档里）',
    pendingFrame.shown === oldLayer && layersNow().length === 2
      && String(newLayer.className).includes(LAYER_PENDING_CLS),
    frameLabel(pendingFrame) + ' layers=' + layersNow().length);
  check('② 这一刻新层还没有画面（闸门挡的就是它）', layerShowsPicture(newLayer) === false,
    'picture=' + layerShowsPicture(newLayer));
  const frameProbe = t.imageEls.filter((i) => t.mediaSrc(i) === frameSrc).pop() || null;
  if (frameProbe && typeof frameProbe.onload === 'function') frameProbe.onload();
  const shownFrame = observeFrame(t, '画面到位后');
  check('③ 画面到位 ⇒ 旧层一次性退场（硬切语义：body 里只剩新层），新层已经有画面',
    shownFrame.shown === newLayer && shownFrame.showsPicture === true
      && layersNow().length === 1 && layersNow()[0] === newLayer,
    frameLabel(shownFrame) + ' layers=' + layersNow().length);
  check('④ 结果型判据（同一条函数）：每个中间态里参与绘制的那一层都有画面',
    noBlankFrameInSwitch([beforeFrame, pendingFrame, shownFrame]),
    [beforeFrame, pendingFrame, shownFrame].map(frameLabel).join(' | '));
});

// ── T6：待显影期间切回原来那张 —— 守着的旧层回到 LAYER_ID，不留空层、不建重复层 ──────
// 这一跳覆盖闸门的**状态迁移**：新层还在等画面时用户又切回来，那个"还没有画面"的层从未
// 上过屏，必须就地拆掉，而屏上一直没离开的那一层要重新成为当前层（LAYER_ID 回到它手上）。
// 少了这一步的收尾，屏上会同时存在"守着的层"与"新建的同名层"（重复绘制的两个壁纸层）。
await runScenario('T6. 待显影期间切回原壁纸：空层被拆掉，守着的层回到 LAYER_ID', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: selSeed(['v', 's1'], 'v'),
}, (t) => {
  const layersNow = () => t.bodyEl.children.filter((c) => String(c.className).includes('we-layer'));
  const original = t.layerEl();
  const oldVideo = original && original.querySelector('video');
  if (oldVideo) oldVideo.readyState = 3;
  // 第一跳：切到 s1，画面还没到 ⇒ 新层待显影、屏上仍是 original
  t.fireLatest(10000);
  t.fireLatest(300);
  t.clock.offset = 16000;
  t.fireLatest(500);
  const probeBack = t.mediaEls[t.mediaEls.length - 1];
  if (probeBack) probeBack.__fire('canplay');
  const blank = t.layerEl();
  check('   前置：第一跳停在待显影上（新层在文档里但没画面，旧层还在屏上）',
    !!blank && blank !== original && String(blank.className).includes(LAYER_PENDING_CLS)
      && layersNow().length === 2, 'layers=' + layersNow().length);

  // 第二跳：画面到位之前切回 v
  t.fireLatest(10000);
  const back = t.layerEl();
  check('① 屏上没离开过的那一层重新成为当前层（LAYER_ID 回到它手上）',
    back === original, 'same=' + (back === original));
  check('② 那个从未上屏的空层已被拆掉（不留重复的壁纸层）',
    layersNow().length === 1 && layersNow()[0] === original && !blank.isConnected,
    'layers=' + layersNow().length + ' blankConnected=' + blank.isConnected);
  check('③ 它不再被当作待退役的旧层（weFading 已清）', !original.dataset.weFading,
    'weFading=' + JSON.stringify(original.dataset.weFading));
  check('④ 落库回到 v，且它的媒体仍是原来那个元素（没有被重建过）',
    t.persistedId() === 'v' && back.querySelector('video') === oldVideo,
    'id=' + t.persistedId() + ' sameVideo=' + (back.querySelector('video') === oldVideo));
});

// ── T7/T8：闸门必须区分「探针跑完了」与「这一层确实有画面」──────────────────────────
// 轮换准备期有一条 20s 兜底：某一级探测太久就**兜底提交**（元素继续在新层里加载，别把轮换
// 卡死）。兜底那一刻像素还没到 —— 闸门若把"这次探测该收尾了"读成"这一层有画面"，新层就会
// 带着一块还没有像素的 <img> 上屏 = 切层露底色。两条判据把两种领养喂进**同一条**函数
//（layerIsPending / layerPainted）：没有像素的那一档**不得**放行，真的 load 过的那一档必须放行。
const imageWallpaper = (id) => ({ id, title: id.toUpperCase(), type: 'image', playable: true,
  media: '/wallpaper-engine/media/' + id, preview: '/wallpaper-engine/preview/' + id, contentrating: 'Everyone' });

await runScenario('T7. 切层内容闸门：20s 兜底领养的元素还没有像素 ⇒ 不得放行', {
  wallpapers: [wallpaperV, imageWallpaper('i1')],
  selection: selSeed(['v', 'i1'], 'v'),
}, (t) => {
  t.fireLatest(10000);                        // 准备 i1：image 类型的探针
  const probe = t.imageEls[t.imageEls.length - 1];
  check('   前置：image 候选的探针在场，且 20s 兜底定时器已武装（"这一级解码 > 20s"那一档）',
    !!probe && t.mediaSrc(probe) === '/wallpaper-engine/media/i1'
      && t.timers.some((x) => !x.cleared && x.ms === 20000),
    'src=' + t.mediaSrc(probe || {}) + ' timers20s='
      + t.timers.filter((x) => !x.cleared && x.ms === 20000).length);
  t.fireLatest(20000);                        // 兜底提交（这个元素从未 load 成功）
  const newLayer = t.layerEl();
  const adopted = newLayer && newLayer.querySelector('img');
  const oldLayer = t.bodyEl.children
    .filter((c) => String(c.className).includes('we-layer') && c !== newLayer)[0] || null;
  check('① 领养的就是那个**从未加载成功**的探针元素（不是新建的）',
    !!adopted && adopted === probe, 'same=' + (adopted === probe));
  check('② 浏览器事实：它还没有像素（判据前提；`complete` 未翻真）',
    !!adopted && !imgHasPixels(adopted),
    'complete=' + (adopted && adopted.complete) + ' naturalWidth=' + (adopted && adopted.naturalWidth));
  check('③ 产品不得把"探针跑完了"标成"这个元素有画面"（__weReady 只许由就绪事件打）',
    !!adopted && adopted.__weReady !== true, '__weReady=' + (adopted && adopted.__weReady));
  check('④ 闸门因此**没有**放行：新层被挡在绘制之外，屏上仍是旧层的像素',
    layerIsPending(newLayer) && layerPainted(t, oldLayer) && !layerPainted(t, newLayer),
    'cls=' + (newLayer && newLayer.className) + ' paintedOld=' + layerPainted(t, oldLayer));
  // 正对照（同一条函数）：这一层后来真的有画面了（load 落下 ⇒ 浏览器事实翻真）必须放行 ——
  // 闸门不是永久关死，否则这一层永远换不上去。
  adopted.__fireLoad();
  check('⑤ 像素到手 ⇒ 同一个元素此刻被放行（闸门看的是浏览器事实，不是"探测结束"）',
    layerPainted(t, newLayer) && !layerIsPending(newLayer),
    frameLabel(observeFrame(t, 'load 之后')) + ' paintedNew=' + layerPainted(t, newLayer));
});

await runScenario('T8. 正对照（同一条闸门判据）：准备期真的 load 过的元素必须放行', {
  wallpapers: [wallpaperV, imageWallpaper('i1')],
  selection: selSeed(['v', 'i1'], 'v'),
}, (t) => {
  t.fireLatest(10000);                        // 准备 i1
  const probe = t.imageEls[t.imageEls.length - 1];
  if (probe) { probe.complete = true; probe.onload(); }  // 真机上就是 load 事件本身
  const newLayer = t.layerEl();
  check('   前置：领养的就是那个已就绪的探针（元素级领养没被 URL 校验打回）',
    !!newLayer && newLayer.querySelector('img') === probe,
    'same=' + (!!newLayer && newLayer.querySelector('img') === probe));
  check('① 就绪档（__weReady 由 onload 打上）⇒ 新层立刻参与绘制，不被闸门拦',
    layerPainted(t, newLayer) && !layerIsPending(newLayer),
    frameLabel(observeFrame(t, '领养后')) + ' paintedNew=' + layerPainted(t, newLayer));
});

// ── Q：启动等待（`liveBootDelay`）—— 上限前就绪即挂载 / 切走必须终止预热页 ──────
// 这一档必须有自己的行为覆盖（其余冒烟都把 liveBootDelay 钉成 0，见 selSeed 的注释），
// 它的两条不变量都要被判据钉住：
//   ① `liveBootDelay` 是**上限**不是固定等待：延迟期照常加载（这正是这一档存在的理由），
//      但首帧一就绪就该立刻换屏 —— 否则出帧快的壁纸白等满 N 秒。
//   ② 延迟期那个未上屏的 iframe 是**正在跑的渲染页**：换壁纸时必须显式终止
//      （`src=about:blank`），否则它留在后台继续抢 CPU/GPU，与新壁纸的启动叠在同一
//      主线程上 —— 用户反馈的「延迟期切下一张会卡」。
const liveIframeOf = (t) => {
  const layer = t.layerEl();
  return layer && layer.querySelector ? layer.querySelector('iframe.we-live-iframe') : null;
};
const pendingLiveIframe = (t) => t.iframeEls.filter((f) => t.mediaSrc(f).includes('/scene-live/')).pop() || null;
const bootDelaySel = (ids, cur, secs) => Object.assign(selSeed(ids, cur), { liveBootDelay: secs });

await runScenario('Q1. 启动等待：上限前首帧就绪 ⇒ 立刻挂载（不白等满上限）', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } }, // 一开始没有首帧
  selection: bootDelaySel(['s1'], 's1', 3),
}, (t) => {
  const pending = pendingLiveIframe(t);
  check('延迟期：预热 iframe **已在加载**（src 非空）但未上屏',
    !!pending && t.mediaSrc(pending).includes('/scene-live/') && !pending.isConnected,
    'iframes=' + t.iframeEls.length + ' src=' + t.mediaSrc(pending || {}));
  check('延迟期：层里只有垫底图（未挂载 iframe）', !liveIframeOf(t));
  // 首帧就绪（心跳读数 fps>0）⇒ 下一拍就该挂载，不必等满 3s
  t.setStats('tok-s1', { fps: 30, running: true });
  t.fireLatest(300);
  check('① 首帧就绪 ⇒ **立刻挂载**（不用等满上限）', liveIframeOf(t) === pending,
    'inLayer=' + (liveIframeOf(t) === pending));
  check('   挂载时 src 仍是渲染页（预热成果没被丢弃）',
    t.mediaSrc(pending).includes('/scene-live/'), 'src=' + t.mediaSrc(pending));
});

await runScenario('Q2. 启动等待：到上限仍未出帧 ⇒ 也挂载（最坏情况与固定等待一致）', {
  wallpapers: [scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } }, // 永远不出首帧
  selection: bootDelaySel(['s1'], 's1', 3),
}, (t) => {
  t.fireLatest(300); // 第 1 拍：未就绪、未到上限
  check('② 未就绪且未到上限 ⇒ 不挂载（判据有牙：不是无条件立刻挂）', !liveIframeOf(t));
  t.clock.offset += 3000; // 跨过 3s 上限
  t.fireLatest(300);      // 到上限那一拍：排「等首屏空闲再挂」
  t.fireLatest(300);      // 兜底路径的 300ms 定时器 → 真正挂载
  check('② 到上限仍未出帧 ⇒ 仍挂载（不让壁纸永远停在占位图）',
    liveIframeOf(t) === pendingLiveIframe(t));
});

await runScenario('Q3. 启动等待期切走：预热页被**终止**、零孤儿（卡顿的根因）', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  stats: { 'tok-s1': { fps: 0, running: true } },
  selection: bootDelaySel(['v', 's1'], 's1', 3), // 启动即 s1（延迟期）→ 轮换到 v
}, (t) => {
  const pending = pendingLiveIframe(t);
  check('启动等待期：s1 的预热 iframe 已在加载但未上屏',
    !!pending && !pending.isConnected, 'src=' + t.mediaSrc(pending || {}));
  t.fireLatest(10000); // 轮换到 v → applySelection（唯一的换壁纸入口）
  t.fireLatest(300);   // 提交
  t.flushPersist();    // 持久化走 200ms 去抖：不 flush 会读到上一张的 id
  check('切走后预热页被**终止**（src=about:blank ⇒ 中止在途加载并拆掉渲染页）',
    t.mediaSrc(pending) === 'about:blank', 'src=' + t.mediaSrc(pending));
  // 这一刻正是用户卡顿的那个窗口：已经切走了，预热页**必须已经**不在后台跑
  // （判据要在此刻成立 —— 再往后拖会被「到上限时那条陈旧检查」兜住，就测不到真问题了）。
  const orphansNow = t.iframeEls.filter((f) => !f.isConnected && t.mediaSrc(f) && t.mediaSrc(f) !== 'about:blank');
  check('切走那一刻零孤儿（没有「已脱离文档且仍在加载」的预热 iframe）', orphansNow.length === 0,
    'orphans=' + orphansNow.map((f) => t.mediaSrc(f).slice(0, 40)).join(' | '));
  // 再往前跑：延迟到点也不得把已作废的预热页挂上来
  t.clock.offset += 3000;
  for (let i = 0; i < 4; i++) t.fireLatest(300);
  check('到点也不得挂上已作废的预热页（当前壁纸是 v）',
    t.persistedId() === 'v' && !liveIframeOf(t), 'id=' + t.persistedId());
});

// ── R：默认值分支的行为覆盖 ──────────────────────────────────────────────────
// 这三个键的**默认值**没在任何别的行为夹具里出现（见 `test/tools/audit-fixture-coverage.mjs`
// 的 A 类清单）—— 默认值恰恰是"不写即生效"的那条路，最容易被夹具集体绕开。
// 每个用例都断言**默认值那条分支**的行为，并配一条反向（非默认值）对照。
await runScenario('R1. 音量映射：默认 0 ⇒ 静音；0.6 ⇒ 0.6；总开关关 ⇒ 0', {
  wallpapers: [wallpaperV],
  selection: Object.assign(selSeed(['v'], 'v'), { videoVolume: 0, videoAudioEnabled: true }),
}, (t) => {
  const vol = () => { const v = t.mediaEls[t.mediaEls.length - 1]; return v ? Number(v.volume) : NaN; };
  check('默认音量 0（静音）⇒ 媒体音量就是 0', vol() === 0, 'volume=' + vol());
});

await runScenario('R1b. 音量映射（非默认值对照）：0.6 ⇒ 0.6', {
  wallpapers: [wallpaperV],
  selection: Object.assign(selSeed(['v'], 'v'), { videoVolume: 0.6, videoAudioEnabled: true }),
}, (t) => {
  const vol = () => { const v = t.mediaEls[t.mediaEls.length - 1]; return v ? Number(v.volume) : NaN; };
  check('音量 0.6 ⇒ 媒体音量 0.6（与默认那条不是同一个数）', vol() === 0.6, 'volume=' + vol());
});

await runScenario('R1c. 音量映射：总开关关 ⇒ 0（保留数值，关掉再开能恢复）', {
  wallpapers: [wallpaperV],
  selection: Object.assign(selSeed(['v'], 'v'), { videoVolume: 0.6, videoAudioEnabled: false }),
}, (t) => {
  const vol = () => { const v = t.mediaEls[t.mediaEls.length - 1]; return v ? Number(v.volume) : NaN; };
  check('总开关关闭 ⇒ 即使 volume 是 0.6 也静音', vol() === 0, 'volume=' + vol());
  check('关闭总开关不动 videoVolume（数值保留）', Number(t.persistedSel().videoVolume) === 0.6,
    'videoVolume=' + t.persistedSel().videoVolume);
});

await runScenario('R2. 轮播关闭（默认值）⇒ 不武装定时器、到点也不换壁纸', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  selection: Object.assign(selSeed(['v', 's1'], 'v'), { rotationEnabled: false }),
}, (t) => {
  check('关闭轮播 ⇒ 没有武装中的轮换定时器（10s 那个）',
    !t.timers.some((x) => !x.cleared && x.ms === 10000),
    'timers=' + t.timers.filter((x) => !x.cleared).map((x) => x.ms).join(','));
  t.fireLatest(10000); // 万一被武装了：到点也不该换
  t.flushPersist();
  check('到点也不换壁纸（仍是 v）', t.persistedId() === 'v', 'id=' + t.persistedId());
});

await runScenario('R3. 轮播开着但没选列表 ⇒ 自愈到可用列表；无可用列表 ⇒ 关掉轮播', {
  wallpapers: [wallpaperV, scene('s1', 'tok-s1')],
  selection: Object.assign(selSeed(['v', 's1'], 'v'), { rotationGroupId: '' }),
}, (t) => {
  t.flushPersist(); // 持久化走 200ms 去抖：不 flush 会读到启动时那份旧值
  const sel = t.persistedSel();
  check('空 rotationGroupId ⇒ 自愈选中可用列表 g1（而不是静默不轮播）',
    sel.rotationGroupId === 'g1' && sel.rotationEnabled === true,
    'group=' + JSON.stringify(sel.rotationGroupId) + ' enabled=' + sel.rotationEnabled);
});

await runScenario('R3b. 轮播开着但列表全不可用 ⇒ 关掉轮播（不是留一个永远不动的开关）', {
  wallpapers: [wallpaperV],
  selection: Object.assign(selSeed([], 'v'), { rotationGroupId: '' }),
}, (t) => {
  t.flushPersist();
  const sel = t.persistedSel();
  check('无可用列表 ⇒ rotationEnabled 被关掉（开关状态与实际能力一致）',
    sel.rotationEnabled === false, 'enabled=' + sel.rotationEnabled);
});

// ── R4：遮挡暂停里 `pauseOnBlur` 那一档 ───────────────────────────────────────
// 为什么焦点必须**可切换**：`hasFocus` 若写死 `() => true`，判据
// `pauseOnBlur && !document.hasFocus()` 就永远不成立、两个分支都不可达（零覆盖仍绿）。
// 事件走 window（客户端在 apply 里对 ["visibilitychange","blur","focus"]
// 注册 onOcclusionChange → emit → syncLayers → applyVideoPlayback ⇒ `if (!isEffectivelyPlaying()) video.pause()`）。
await runScenario('R4. 失焦 + pauseOnBlur=true ⇒ 暂停；夺回焦点 ⇒ 恢复', {
  wallpapers: [wallpaperV],
  selection: Object.assign(selSeed(['v'], 'v'), { pauseOnBlur: true }),
}, (t) => {
  const vid = () => t.mediaEls[t.mediaEls.length - 1];
  check('焦点在时照常播放（前置：确实在播，否则下面的暂停测不出东西）',
    !!vid() && vid().__paused === false, 'paused=' + (vid() && vid().__paused));
  t.setFocus(false);
  t.fireWin('blur');
  check('失焦 + pauseOnBlur=true ⇒ 媒体被暂停（省电档真的生效）',
    !!vid() && vid().__paused === true, 'paused=' + (vid() && vid().__paused));
  t.setFocus(true);
  t.fireWin('focus');
  check('夺回焦点 ⇒ 自动恢复播放（不需要用户手动点）',
    !!vid() && vid().__paused === false, 'paused=' + (vid() && vid().__paused));
});

await runScenario('R4b. 默认 pauseOnBlur=false ⇒ 失焦**不**暂停（负对照：反向就是 R4）', {
  wallpapers: [wallpaperV],
  selection: selSeed(['v'], 'v'), // 不带 pauseOnBlur ⇒ 走默认 false
}, (t) => {
  const vid = () => t.mediaEls[t.mediaEls.length - 1];
  t.setFocus(false);
  t.fireWin('blur');
  check('失焦 + 默认 pauseOnBlur=false ⇒ 仍继续播放（开关关掉就不该被遮挡逻辑管）',
    !!vid() && vid().__paused === false, 'paused=' + (vid() && vid().__paused));
});

// ── R5/R6：B 类候选（行为面只跑过默认值 ⇒ 非默认那条路没人走）──────────────
await runScenario('R5. 关掉实时渲染（sceneLive=false）⇒ 不挂 live iframe，改走内嵌 MP4', {
  wallpapers: [scene('s1', 'tok-s1')],
  selection: Object.assign(selSeed(['s1'], 's1'), { sceneLive: false }),
}, (t) => {
  const layer = t.layerEl();
  check('关掉实时渲染 ⇒ 层里**没有** live iframe（不会偷偷还在渲染）',
    !!layer && !layer.querySelector('iframe.we-live-iframe'),
    layer ? 'hasLive=' + !!layer.querySelector('iframe.we-live-iframe') : 'no layer');
  check('改走内嵌 MP4 那条路（挂了 <video>，不再建渲染页）',
    t.mediaEls.length >= 1 && t.iframeEls.filter((f) => String(f.src).includes('/scene-live/')).length === 0,
    'videos=' + t.mediaEls.length + ' liveIframes=' + t.iframeEls.length);
});

await runScenario('R6. 倍速：非默认值 1.5 真的落到 <video> 上', {
  wallpapers: [wallpaperV],
  selection: Object.assign(selSeed(['v'], 'v'), { playbackRate: 1.5 }),
}, (t) => {
  const vid = () => t.mediaEls[t.mediaEls.length - 1];
  check('playbackRate 1.5 ⇒ 视频元素 playbackRate=1.5（原生倍速，不是重载）',
    !!vid() && Number(vid().playbackRate) === 1.5,
    'playbackRate=' + (vid() && vid().playbackRate));
});

// ── S：主题随壁纸不得横跨媒体层的创建边界 ─────────────────────────────────────
// 现象：只在「换到一张会把深浅主题翻过去的壁纸」时，屏上出现纯色图 / 视频几秒黑屏 /
// 旧壁纸卡住后秒切。位置在**顺序**上：判决的写作入口在宿主侧是同步的一整轮（重写全量
// 别名令牌 + 翻 color-scheme / body 主题属性 + 一次强制样式读取），落在 emit() 之前时，
// 这一轮正好插在「新壁纸的媒体节点还没被创建、请求还没发出」的空窗里，建层/起播/过渡
// 全排在它后面。
//
// 判据量**结果**，不看内部变量、不看调用栈：
//   `themeWriteLandsOnLayer(snap, wid, srcPart)` —— 主题写入那一刻，屏上的层是不是
//   **新壁纸**那一层（节点在位、组件的 src 已是新壁纸的媒体）。正判据喂写入那一刻的
//   快照，负对照喂换壁纸**之前**的快照（同一条函数，见 docs/DEV-GUIDE.md §4.7 约定 5）。
//   `mediaLayerSurvives(snap, layer, video)` —— 一次纯主题切换跨过去之后，层与 <video>
//   是不是**同一个节点**；负对照喂一个换了节点的合成快照，证明这条判据不是恒真。
const videoOf = (id, scheme) => Object.assign({}, wallpaperV, {
  id, title: id.toUpperCase(), media: '/wallpaper-engine/media/' + id,
  preview: '/wallpaper-engine/preview/' + id, schemeColor: scheme,
});
const themeWriteLandsOnLayer = (snap, wantWid, wantSrcPart) =>
  !!snap && !!snap.layer && String(snap.wid) === String(wantWid)
  && !!snap.media && String(snap.src).includes(wantSrcPart);
const mediaLayerSurvives = (snap, layer, video) =>
  !!snap && !!layer && snap.layer === layer && snap.video === video;
const videoSrcSets = (v) => (v && v.__srcSets) || 0;

// S1/S2 测的是「主题随壁纸**开着**」时的自动行为 ⇒ 持久化记录里显式把这个总开关打开
// （它默认关：关着时那个功能整体不生效，见 lib/settings-schema.js 的 DEFAULTS.themeFollow）。
await runScenario('S1. 主题随壁纸：判决落在媒体层建好之后（不横跨建层边界）', {
  wallpapers: [videoOf('d0', 'rgb(6, 6, 8)'), videoOf('l1', 'rgb(250, 250, 250)')],
  selection: Object.assign(selSeed(['d0', 'l1'], 'd0'), { themeFollow: true }),
  theme: true, themePreference: 'dark',
}, (t) => {
  const darkMedia = '/wallpaper-engine/media/d0';
  const lightMedia = '/wallpaper-engine/media/l1';
  const before = t.themeSnap('d0');
  check('前置：启动即选中暗色壁纸、层与 <video> 在位（判据的分辨力前提）',
    !!before.layer && before.wid === 'd0' && !!before.video && before.src === darkMedia,
    'wid=' + before.wid + ' src=' + before.src);
  check('前置：这一次启动没有写主题（判决与当前偏好同侧 ⇒ 不写）',
    t.themeCalls.length === 0, 'calls=' + t.themeCalls.length);
  t.fireLatest(10000); // 轮换到亮色壁纸（视频类准备期直接提交 ⇒ 整条切换在一次调用里走完）
  check('① 这一跳真的写了主题（否则下面的判据空转）',
    t.themeCalls.length === 1 && t.themeCalls[0].id === 'light',
    'calls=' + t.themeCalls.length + ' → ' + t.themeCalls.map((c) => c.id).join(','));
  const snap = t.themeCalls[0] || null;
  check('② 写入那一刻屏上已经是**新壁纸**的层（不是被换掉的那一层）',
    !!snap && String(snap.wid) === 'l1', 'wid=' + (snap && snap.wid) + ' want=l1');
  check('③ 写入那一刻新层的媒体节点已经在位、src 已是新壁纸的媒体',
    themeWriteLandsOnLayer(snap, 'l1', lightMedia), 'src=' + (snap && snap.src));
  check('   负对照（同一条判据，喂换壁纸之前的快照）：那一层判不合格 —— 判据分得清两跳',
    !themeWriteLandsOnLayer(before, 'l1', lightMedia), 'wid=' + before.wid);
  const finalLayer = t.layerEl();
  const finalVideo = finalLayer && finalLayer.querySelector('video');
  check('④ 视频侧：写入那一刻的 <video> 就是切换后层里的那个元素（节点身份不变）',
    !!snap && !!snap.video && snap.video === finalVideo,
    'same=' + (!!snap && snap.video === finalVideo));
  check('⑤ 主题写入不得让 <video> 重载：写入那一刻与切换后仍是同一份资源（src 只赋过一次）',
    !!snap && !!snap.video && videoSrcSets(finalVideo) === 1
      && videoSrcSets(snap.video) === videoSrcSets(finalVideo)
      && (finalVideo.__loads || 0) === (snap.video.__loads || 0),
    'srcSets=' + videoSrcSets(snap && snap.video) + '→' + videoSrcSets(finalVideo)
      + ' loads=' + (snap && snap.video && snap.video.__loads) + '→' + (finalVideo && finalVideo.__loads));
  check('   负对照（同一条判据，换 src）：把期望换成那一层里没有的媒体 ⇒ 判不合格',
    !themeWriteLandsOnLayer(snap, 'l1', '/wallpaper-engine/media/nope'), 'src=' + (snap && snap.src));
  // 同一条共享判据的牙齿：这一跳真的把媒体层换掉了。**不许**现场新建 `{ layer: {}, video: {} }`
  // 喂给判据：字面量对真节点的同一性永远不可能为真 —— 恒红的负对照证明不了判据分得清节点身份。
  // 这里喂**换壁纸之前**的真实快照，视频实参取它自己的 `<video>`（同一个元素 ⇒ 判据里
  // `snap.video === video` 这半项不再抢答），于是判决只剩层身份这一项说了算。
  const priorVideo = before.video;
  const beforeLayerGone = !!before.layer && before.layer !== finalLayer;
  const beforeVideoGone = !!before.video && before.video !== finalVideo;
  check('   负对照（同一条判据，喂换壁纸之前的真实快照）：层已重建 ⇒ 判不合格 —— 判据分得清节点身份',
    beforeLayerGone && beforeVideoGone && !!priorVideo
      && !mediaLayerSurvives(before, finalLayer, priorVideo),
    'layerBefore!==layerAfter: ' + beforeLayerGone + ' videoBefore!==videoAfter: ' + beforeVideoGone
      + ' ⇐ 判据喂真快照仍判不合格');
});

// ── S2：一次**纯主题切换**（不换壁纸）不得重建媒体层 ────────────────────────────
// 素材无作者配色 ⇒ 启动那段评估不会写主题（取色腿要等图解码，harness 里永不落结论），
// 于是这一跳的主题切换只能来自外部 —— 正是「用户在 DSH 设置里改深浅 / 系统深浅变化」。
await runScenario('S2. 纯主题切换不重建媒体层：节点身份同一个 + 不新发媒体请求', {
  wallpapers: [videoOf('p0', null)],
  selection: Object.assign(selSeed(['p0'], 'p0'), { themeFollow: true }),
  theme: true, themePreference: 'dark',
}, (t) => {
  check('前置：启动后主题服务没有被写入过（这一跳的主题切换来自外部）',
    t.themeCalls.length === 0, 'calls=' + t.themeCalls.length);
  const layerBefore = t.layerEl();
  const videoBefore = layerBefore && layerBefore.querySelector('video');
  const imagesBefore = t.imageEls.length, mediaBefore = t.mediaEls.length;
  const loadsBefore = videoBefore ? videoBefore.__loads : -1;
  t.themeService.setTheme('light');       // 外部改主题（不经过换壁纸）
  const layerAfter = t.layerEl();
  const videoAfter = layerAfter && layerAfter.querySelector('video');
  check('① 媒体层节点是同一个（节点身份不变，没有重建）',
    !!layerBefore && layerAfter === layerBefore,
    'same=' + (layerAfter === layerBefore));
  check('② <video> 是同一个元素（换主题不该让播放进度归零）',
    !!videoBefore && videoAfter === videoBefore, 'same=' + (videoAfter === videoBefore));
  check('③ 主题切换不得新发媒体请求（帧探针 / 视频元素都没新增）',
    t.imageEls.length === imagesBefore && t.mediaEls.length === mediaBefore,
    'images=' + imagesBefore + '→' + t.imageEls.length + ' videos=' + mediaBefore + '→' + t.mediaEls.length);
  check('④ 主题切换不得让 <video> 重载：src 没被重赋、也没有额外 load()',
    videoSrcSets(videoBefore) === 1 && videoBefore.__loads === loadsBefore
      && videoSrcSets(t.themeCalls[0] && t.themeCalls[0].video) === 1,
    'srcSets=' + videoSrcSets(videoBefore) + ' loads=' + loadsBefore + '→' + (videoBefore && videoBefore.__loads));
  // 同一跳里层与 <video> 都没被重建 ⇒ 同一条共享判据必须判合格。喂合成字面量
  // （`{ layer: {}, video: {} }`）会把这条判据恒红 —— 那种字面量对真节点的同一性永远不可能为真，
  // 所以这条只喂真快照；「判据分得清两跳」的负对照在 S1。
  const priorSnap = t.themeCalls[0] || null;
  check('   （共享判据的正判据）写入那一刻与切换之后是同一个层、同一个 <video>',
    mediaLayerSurvives(priorSnap, layerAfter, videoAfter),
    'layer=' + (priorSnap && priorSnap.layer === layerAfter)
      + ' video=' + (priorSnap && priorSnap.video === videoAfter));
});

console.log('');
console.log(failures === 0 ? 'ROTATION PREPARED-LEAK SMOKE PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
