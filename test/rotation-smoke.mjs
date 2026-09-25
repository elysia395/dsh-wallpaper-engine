// Rotation prepare/commit smoke with browser-ish media mocks.
// 间隔走正式版的开发覆盖钩子 localStorage.weRotationTestSec=10（秒），与生产
// 路径（组间隔分钟制）共用同一条定时器武装逻辑。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const React = { Fragment:'Fragment', useState:(i)=>[i,()=>{}], useEffect:()=>{}, useRef:(v)=>({current:v}),
  createElement:(t,p,...c)=>typeof t==='function'?t(p||{}):({type:t,props:p||null,children:c}) };

let byId = {};
const timers = [];
const mediaEls = [];
const audioEls = []; // 场景包 BGM（<audio>）——轮换音频闸的 BGM 断言用

function makeEl(tag) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
    style: { _props:{}, cssText:'', setProperty(k,v){this._props[k]=v;}, removeProperty(k){delete this._props[k];} },
    className: '',
    appendChild(c){ this.children.push(c); if (c.id) byId[c.id]=c; c._parent=this; return c; },
    // remove(): 真 DOM 语义 —— 摘除后不再有父节点（isConnected 随之为 false）。
    remove(){ if (this._parent){ const i=this._parent.children.indexOf(this); if(i>=0)this._parent.children.splice(i,1); this._parent = undefined; } },
    setAttribute(k,v){ this.attributes[k]=v; },
    removeAttribute(k){ delete this.attributes[k]; (this.__removedAttrs ||= []).push(k); },
    getAttribute(k){ return this.attributes[k] ?? null; },
    hasAttribute(k){ return k in this.attributes; },
    querySelector(sel){
      const want = sel === 'video' ? 'VIDEO' : sel.includes('canvas') ? 'CANVAS' : null;
      // mock Image 等节点没有 children → 遍历必须容忍（真 DOM 由浏览器实现）。
      const walk=(n)=>{ if (!Array.isArray(n.children)) return null; for (const c of n.children){ if (c.tagName===want) return c; const r=walk(c); if(r)return r; } return null; };
      return walk(this);
    },
    contains(n){ let cur=n; while(cur){ if(cur===this)return true; cur=cur._parent; } return false; },
    querySelectorAll(sel){
      const want = String(sel).split(',').map(x=>x.trim().toUpperCase());
      const out=[]; const walk=(n)=>{ if (!Array.isArray(n.children)) return; for (const c of n.children){ if (want.includes(c.tagName)) out.push(c); walk(c); } }; walk(this); return out;
    },
    get isConnected(){ let cur=this; while (cur) { if (!cur._parent) return cur.tagName === 'BODY'; cur = cur._parent; } return false; },
    addEventListener(ev,fn){ (listeners[ev] ||= []).push(fn); },
    removeEventListener(ev,fn){ const l=listeners[ev]; if(l){const i=l.indexOf(fn); if(i>=0)l.splice(i,1);} },
    __fire(ev){ (listeners[ev]||[]).slice().forEach(f=>f()); if (ev==='load'&&this.onload) this.onload(); if(ev==='error'&&this.onerror)this.onerror(); },
    play(){ this.__plays = (this.__plays || 0) + 1; this.__paused = false; return Promise.resolve(); },
    pause(){ this.__paused = true; },
    load(){ this.__loads = (this.__loads || 0) + 1; },
  };
}

const bodyEl = makeEl('body');
const document = {
  createElement: (t) => {
    const el = makeEl(t);
    if (t==='video') mediaEls.push(el);
    if (t==='audio') audioEls.push(el);
    return el;
  },
  // 真 DOM 语义：getElementById 不返回已脱离文档的节点（此前返回旧层会让
  // syncLayers 复用 detach 节点，掩盖领养/闸的真实行为）。
  getElementById: (id) => { const el = byId[id]; return el && el.isConnected ? el : null; },
  querySelector: () => null,
  head: { appendChild: () => {} },
  body: bodyEl,
  hidden: false,
  hasFocus: () => true,
  addEventListener(){},
  removeEventListener(){},
  documentElement: makeEl('html'),
};

const imageEls = [];
class ImageMock { constructor(){ this.tagName='IMG'; imageEls.push(this); } }

const localStorage = {
  _store: { 'dsh-wallpaper-engine:selection': JSON.stringify({
    id:'a', rotationGroupId:'g1', rotationEnabled:true,
    // 切换过场：本套测的是「轮换交叉淡化 + 音频闸」，故显式选交叉淡化。默认已是
    // 硬切（不进过渡路径、不开音频闸），那套行为在 verify-client 里断言。
    switchTransition: 'fade',
    // 音量必须非 0，否则「闸内压 0 / 退场后恢复」两条断言数值相同、测不出东西。
    videoVolume: 0.6, videoAudioEnabled: true,
    rotationGroups:[{id:'g1',name:'L',interval:5,order:'sequence',wallpaperIds:['a','b','c']}],
  }), weRotationTestSec: '10' },
  getItem(k){ return this._store[k] ?? null; }, setItem(k,v){ this._store[k]=v; }, removeItem(k){ delete this._store[k]; },
};
const fetch = (url) => Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(
  String(url).includes('/settings') ? { ok:true, betterSidebar:false } :
  String(url).includes('/media-info') ? { info:null } :
  { installDir:'D:/we', total:2, portableCount:2, playlists:[], wallpapers:[
    { id:'a', title:'A', type:'video', playable:true, media:'/wallpaper-engine/media/aaa', preview:'/wallpaper-engine/preview/aaa', contentrating:'Everyone' },
    { id:'b', title:'B', type:'video', playable:true, media:'/wallpaper-engine/media/bbb', preview:'/wallpaper-engine/preview/bbb', contentrating:'Everyone' },
    // 场景壁纸（静态帧 + 包内 BGM）：第三轮用它验证「BGM 严格晚于旧层退场」
    // —— 这是用户要求的直接场景（sceneVideo 缺失时 BGM 走独立 <audio>）。
    { id:'c', title:'C', type:'scene', playable:false, media:null, frameUrl:'/wallpaper-engine/scene-frame/ccc',
      sceneAudio:'/wallpaper-engine/scene-audio/ccc', preview:'/wallpaper-engine/preview/ccc', contentrating:'Everyone' },
  ] }) });

const code = readFileSync(new URL('../lib/client.js', import.meta.url),'utf8');
// 渐变退役定时器 = ROTATION_FADE_MS + 100ms 宽限：从被测源码读常量，改时长
// 不用同步改这里的硬编码（教训：1.2s→1.8s 时三处 1300 全部漂移）。
const FADE_GRACE_MS = Number(code.match(/ROTATION_FADE_MS = (\d+)/)[1]) + 100;
const cap = { handoff:null };
const sandbox = {
  window: {
    __ModuleLoader__: { load:(h)=>{ cap.handoff=h; } },
    setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
    clearTimeout:(t)=>{ if(t)t.cleared=true; },
    addEventListener(){}, innerWidth:1920, innerHeight:1080, devicePixelRatio:1,
  },
  document, localStorage, fetch, React, Image: ImageMock,
  setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
  clearTimeout:(t)=>{ if(t)t.cleared=true; },
};
vm.createContext(sandbox);
new vm.Script(code,{filename:'client.js'}).runInContext(sandbox);
const exportsObj = cap.handoff.factory((spec)=> spec==='react'?React:{createPortal:(n)=>n});
const effects = [];
exportsObj.apply({ slots:{inject:(k,cb)=>cb(),register:()=>{}}, effect(fn){ effects.push(fn); fn(); return fn; } });

const fire = (t) => { if (t && !t.cleared) { t.cleared = true; t.fn(); } };

// 真失败通道：断言失败 → 非零退出（评审指出此前全是 console.log，打断功能
// 仍会 exit 0，"全过"不可证伪）。
let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};
const persistedId = () => JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id;

setTimeout(async () => {
  await Promise.resolve();
  const rot = timers.find(t=>!t.cleared && t.ms===10000);
  check('轮换定时器已武装（5 分钟组间隔 → 测试钩子 10s）', !!rot);
  if (!rot) { console.log('\n' + failures + ' CHECK(S) FAILED'); process.exit(1); }
  const oldProbe = mediaEls[mediaEls.length-1]; // 当前层（a）的 video，提交后成旧层
  try { fire(rot); } catch(e){ console.log('EXCEPTION on rotation fire:', e && e.stack || e); process.exit(1); }
  // 视频类壁纸不预热（0.7.5「选中即播」的语义）：不建探测元素 ——
  // prepareVideoProbe 那套会给探测元素 load() + play() 预热领养，视频壁纸下
  // 表现为「双解码 + GIF 海报先进层」的整套加载流程，已按用户要求移除。
  // 提交后 mediaEls 末尾就是新层里新建的 <video>。
  const probe = mediaEls[mediaEls.length-1];
  check('视频目标不预热：层内 video 未被 load() 过（无探测元素）',
    (probe.__loads || 0) === 0, 'loads=' + probe.__loads + ' count=' + mediaEls.length);
  check('层内 video 指向新壁纸且不带 preview 海报（选中即播）',
    String(probe.attributes.src || probe.src).includes('/wallpaper-engine/media/bbb') && !probe.poster,
    'src=' + (probe.attributes.src || probe.src) + ' poster=' + probe.poster);
  const layer = byId['dsh-wallpaper-engine-layer'];
  check('提交后新层带过场类（交叉淡化）', !!layer && String(layer.className).includes('we-layer--switch'),
    layer ? String(layer.className) : 'no layer');
  check('新层里的 video 就是刚建的那个元素',
    !!layer && layer.querySelector('video') === probe);
  // ── 轮换音频闸：提交瞬间新层必须静音（否则渐变时长内两层 BGM 重叠），
  //    这次渐变的旧层退场后才恢复真实音量。 ──
  check('提交后新层音源被压到 0（闸内静音）',
    probe.volume === 0 && probe.muted === true, 'volume=' + probe.volume + ' muted=' + probe.muted);
  check('旧层（正在淡出）仍在出声，未被闸波及', oldProbe.volume === 0.6 && oldProbe.muted === false,
    'volume=' + oldProbe.volume + ' muted=' + oldProbe.muted);
  // 层内元素不得被误释放（disposeMediaEl 的 video 三连是 pause +
  // removeAttribute('src') + load()）。
  check('层内 video 未被误释放（保留 src / 未额外 load）',
    String(probe.attributes.src || probe.src).includes('/wallpaper-engine/media/bbb')
      && (probe.__loads || 0) === 0
      && !(probe.__removedAttrs || []).includes('src'),
    'loads=' + probe.__loads);
  check('没有「已脱离文档且仍在播」的 video（无孤儿）',
    mediaEls.filter((v) => !v.isConnected && !v.__paused).length === 0);

  // 持久化有 200ms 防抖：先冲掉写盘定时器再断言落库。
  timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
  check('提交已持久化到下一张（b）', persistedId() === 'b', 'id=' + persistedId());
  check('提交后重新武装轮换定时器', timers.some(t=>!t.cleared && t.ms===10000));
  // 渐变时长 +100ms 的退役定时器：旧层移除 → 新层 BGM 此刻才起播。
  const fade = timers.find(t=>!t.cleared && t.ms===FADE_GRACE_MS);
  check('渐变退役定时器已武装（ROTATION_FADE_MS + 100ms）', !!fade);
  if (fade) {
    fire(fade);
    const layersLeft = bodyEl.children.filter((c) => String(c.className).includes('we-layer'));
    check('旧层已退场（body 里只剩新层）', layersLeft.length === 1 && layersLeft[0] === layer,
      'layers=' + layersLeft.length + ' oldConnected=' + oldProbe.isConnected);
    check('旧层退场后新层音量恢复为设置值 0.6',
      probe.volume === 0.6 && probe.muted === false, 'volume=' + probe.volume + ' muted=' + probe.muted);
  }

  // 第二轮：b → 场景 c（带包内 BGM）。走 20s 准备超时兜底提交（场景静态帧
  // 的探针是 Image；超时路径与视频探针共用 prepTimeout）。
  const rot2 = timers.find(t=>!t.cleared && t.ms===10000);
  fire(rot2);
  const t20 = timers.find(t=>!t.cleared && t.ms===20000);
  check('场景准备超时定时器已武装（20s）', !!t20);
  const bgmBefore = audioEls.length;
  try { fire(t20); } catch(e){ console.log('EXCEPTION on prep timeout:', e && e.stack || e); failures++; }
  const layer2 = byId['dsh-wallpaper-engine-layer'];
  check('超时兜底提交到场景 c（静态帧层）',
    !!layer2 && String(layer2.dataset.weKey).includes('scene-frame/ccc'),
    layer2 ? String(layer2.dataset.weKey) : 'no layer');
  // ── BGM 闸（用户要求的核心）：渐变期间场景包 <audio> 必须静音/未在播，
  //    旧层退场后才按设置音量起播。 ──
  const bgmMid = audioEls.length > bgmBefore ? audioEls[audioEls.length-1] : null;
  check('渐变期间场景 BGM 未出声（音量 0 / 未播放）',
    !bgmMid || (bgmMid.volume === 0 && bgmMid.muted === true && bgmMid.__paused !== false),
    bgmMid ? ('volume=' + bgmMid.volume + ' muted=' + bgmMid.muted + ' paused=' + bgmMid.__paused) : 'no audio el');
  const fade2 = timers.find(t=>!t.cleared && t.ms===FADE_GRACE_MS);
  check('场景提交后渐变退役定时器已武装', !!fade2);
  if (fade2) {
    fire(fade2);
    const bgm = audioEls[audioEls.length-1];
    check('旧层退场后场景 BGM 才起播（音量恢复 + play 调用）',
      !!bgm && bgm.volume === 0.6 && bgm.muted === false && (bgm.__plays || 0) > 0,
      bgm ? ('volume=' + bgm.volume + ' muted=' + bgm.muted + ' plays=' + bgm.__plays) : 'no audio el');
  }
  timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
  check('第二轮提交持久化到 c', persistedId() === 'c', 'id=' + persistedId());

  // 第三轮：c（场景）→ a（视频）回绕。旧层是场景：BGM 元素该退场，新视频仍
  // 先静音、退场后才出声 —— 与第一轮同一套闸，覆盖「场景 → 视频」方向。
  const rot3 = timers.find(t=>!t.cleared && t.ms===10000);
  check('第二轮提交后重新武装轮换定时器', !!rot3);
  if (rot3) {
    fire(rot3);
    const probe3 = mediaEls[mediaEls.length-1];
    try { probe3.__fire('canplay'); } catch(e){ console.log('EXCEPTION on canplay 3:', e && e.stack || e); failures++; }
    const layer3 = byId['dsh-wallpaper-engine-layer'];
    check('第三轮提交领养了准备好的 video（回到 a）',
      !!layer3 && layer3.querySelector('video') === probe3);
    check('场景 → 视频：新层同样先静音',
      probe3.volume === 0 && probe3.muted === true, 'volume=' + probe3.volume + ' muted=' + probe3.muted);
    const fade3 = timers.find(t=>!t.cleared && t.ms===FADE_GRACE_MS);
    if (fade3) {
      fire(fade3);
      check('旧层退场后视频音量恢复 0.6',
        probe3.volume === 0.6 && probe3.muted === false, 'volume=' + probe3.volume + ' muted=' + probe3.muted);
    }
    timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
    check('第三轮回绕持久化到 a', persistedId() === 'a', 'id=' + persistedId());
  }

  console.log('');
  console.log(failures === 0 ? 'SMOKE PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}, 50);

