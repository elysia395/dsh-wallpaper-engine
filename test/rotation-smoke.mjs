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

function makeEl(tag) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
    style: { _props:{}, cssText:'', setProperty(k,v){this._props[k]=v;}, removeProperty(k){delete this._props[k];} },
    className: '',
    appendChild(c){ this.children.push(c); if (c.id) byId[c.id]=c; c._parent=this; return c; },
    remove(){ if (this._parent){ const i=this._parent.children.indexOf(this); if(i>=0)this._parent.children.splice(i,1); } },
    setAttribute(k,v){ this.attributes[k]=v; },
    removeAttribute(k){ delete this.attributes[k]; },
    getAttribute(k){ return this.attributes[k] ?? null; },
    hasAttribute(k){ return k in this.attributes; },
    querySelector(sel){
      const want = sel === 'video' ? 'VIDEO' : sel.includes('canvas') ? 'CANVAS' : null;
      const walk=(n)=>{ for (const c of n.children){ if (c.tagName===want) return c; const r=walk(c); if(r)return r; } return null; };
      return walk(this);
    },
    contains(n){ let cur=n; while(cur){ if(cur===this)return true; cur=cur._parent; } return false; },
    addEventListener(ev,fn){ (listeners[ev] ||= []).push(fn); },
    removeEventListener(ev,fn){ const l=listeners[ev]; if(l){const i=l.indexOf(fn); if(i>=0)l.splice(i,1);} },
    __fire(ev){ (listeners[ev]||[]).slice().forEach(f=>f()); if (ev==='load'&&this.onload) this.onload(); if(ev==='error'&&this.onerror)this.onerror(); },
    play(){ return Promise.resolve(); },
    pause(){},
    load(){},
  };
}

const bodyEl = makeEl('body');
const document = {
  createElement: (t) => { const el = makeEl(t); if (t==='video') mediaEls.push(el); return el; },
  getElementById: (id) => byId[id] || null,
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
    rotationGroups:[{id:'g1',name:'L',interval:5,order:'sequence',wallpaperIds:['a','b']}],
  }), weRotationTestSec: '10' },
  getItem(k){ return this._store[k] ?? null; }, setItem(k,v){ this._store[k]=v; }, removeItem(k){ delete this._store[k]; },
};
const fetch = (url) => Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(
  String(url).includes('/settings') ? { ok:true, betterSidebar:false } :
  String(url).includes('/media-info') ? { info:null } :
  { installDir:'D:/we', total:2, portableCount:2, playlists:[], wallpapers:[
    { id:'a', title:'A', type:'video', playable:true, media:'/wallpaper-engine/media/aaa', preview:'/wallpaper-engine/preview/aaa', contentrating:'Everyone' },
    { id:'b', title:'B', type:'video', playable:true, media:'/wallpaper-engine/media/bbb', preview:'/wallpaper-engine/preview/bbb', contentrating:'Everyone' },
  ] }) });

const code = readFileSync(new URL('../lib/client.js', import.meta.url),'utf8');
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

setTimeout(async () => {
  await Promise.resolve();
  console.log('== boot done ==');
  console.log('timers after boot:', timers.filter(t=>!t.cleared).map(t=>t.ms));
  const rot = timers.find(t=>!t.cleared && t.ms===10000);
  console.log('10s rotation timer armed:', !!rot);
  if (!rot) { console.log('FAIL: no rotation timer'); process.exit(1); }
  console.log('-- fire rotation timer (prepare B begins) --');
  try { fire(rot); } catch(e){ console.log('EXCEPTION on rotation fire:', e && e.stack || e); process.exit(1); }
  console.log('probe videos created:', mediaEls.length);
  const probe = mediaEls[mediaEls.length-1];
  console.log('probe src:', probe.attributes.src || probe.src, '| poster:', probe.poster);
  console.log('-- fire canplay on probe --');
  try { probe.__fire('canplay'); } catch(e){ console.log('EXCEPTION on canplay:', e && e.stack || e); }
  const layer = byId['dsh-wallpaper-engine-layer'];
  console.log('layer rebuilt (fadein):', layer && layer.className);
  console.log('layer video is probe (adopted):', layer && layer.querySelector('video') === probe);
  timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
  console.log('persisted id:', JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id);
  console.log('re-armed 10s timer:', timers.some(t=>!t.cleared && t.ms===10000));

  // Second cycle: timeout fallback (never fire canplay)
  console.log('-- fire second rotation timer; do NOT fire canplay; fire 20s prep timeout --');
  const rot2 = timers.find(t=>!t.cleared && t.ms===10000);
  fire(rot2);
  const probe2 = mediaEls[mediaEls.length-1];
  const t20 = timers.find(t=>!t.cleared && t.ms===20000);
  console.log('prep timeout armed:', !!t20);
  try { fire(t20); } catch(e){ console.log('EXCEPTION on prep timeout:', e && e.stack || e); }
  const layer2 = byId['dsh-wallpaper-engine-layer'];
  console.log('second commit layer video is probe2 (timeout-adopted):', layer2 && layer2.querySelector('video') === probe2);
  timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
  console.log('persisted id after wrap:', JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id);
  console.log('SMOKE DONE');
}, 50);

// ── Scene path smoke (user env: typeFilter=scene, fpsCap=24) ─────────────────
