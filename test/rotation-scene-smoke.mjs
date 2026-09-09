// Scene rotation paths: sceneVideo ok / sceneVideo 404→GL staged / GL err→static / static 422→preview.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const React = { Fragment:'Fragment', useState:(i)=>[i,()=>{}], useEffect:()=>{}, useRef:(v)=>({current:v}),
  createElement:(t,p,...c)=>typeof t==='function'?t(p||{}):({type:t,props:p||null,children:c}) };
let byId = {};
const timers = []; const mediaEls = []; const glRenderers = [];
function makeEl(tag) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
    style: { _props:{}, cssText:'', setProperty(k,v){this._props[k]=v;}, removeProperty(k){delete this._props[k];} },
    className: '',
    appendChild(c){ this.children.push(c); if (c.id) byId[c.id]=c; c._parent=this; return c; },
    remove(){ if (this._parent){ const i=this._parent.children.indexOf(this); if(i>=0)this._parent.children.splice(i,1); } },
    setAttribute(k,v){ this.attributes[k]=v; }, removeAttribute(k){ delete this.attributes[k]; },
    getAttribute(k){ return this.attributes[k] ?? null; }, hasAttribute(k){ return k in this.attributes; },
    querySelector(sel){
      const walk=(n)=>{ for (const c of n.children){ if (sel==='video'&&c.tagName==='VIDEO') return c; if(sel.includes('canvas')&&c.tagName==='CANVAS') return c; const r=walk(c); if(r)return r; } return null; };
      return walk(this);
    },
    querySelectorAll(){ return []; },
    closest(){ return null; },
    contains(n){ let cur=n; while(cur){ if(cur===this)return true; cur=cur._parent; } return false; },
    classList: { add(){}, remove(){} },
    addEventListener(ev,fn){ (listeners[ev] ||= []).push(fn); },
    removeEventListener(ev,fn){ const l=listeners[ev]; if(l){const i=l.indexOf(fn); if(i>=0)l.splice(i,1);} },
    __fire(ev){ (listeners[ev]||[]).slice().forEach(f=>f()); if (ev==='load'&&this.onload) this.onload(); if(ev==='error'&&this.onerror)this.onerror(); },
    play(){ return Promise.resolve(); }, pause(){}, load(){},
  };
}
const bodyEl = makeEl('body');
const document = {
  createElement: (t) => { const el = makeEl(t); if (t==='video') mediaEls.push(el); return el; },
  getElementById: (id) => byId[id] || null,
  querySelector: () => null, head: { appendChild: () => {} }, body: bodyEl,
  hidden: false, hasFocus: () => true, addEventListener(){}, removeEventListener(){},
  documentElement: makeEl('html'),
};
const imageEls = [];
class ImageMock { constructor(){ this.tagName='IMG'; this.style={}; imageEls.push(this); } }
const localStorage = {
  _store: { 'dsh-wallpaper-engine:selection': JSON.stringify({
    id:'s0', rotationGroupId:'g1', rotationEnabled:true, fpsCap:24, typeFilter:'scene',
    rotationGroups:[{id:'g1',name:'L',interval:60,order:'sequence',wallpaperIds:['s0','s1','s2','s3','s4']}],
  }), weRotationTestSec: '10' },
  getItem(k){ return this._store[k] ?? null; }, setItem(k,v){ this._store[k]=v; }, removeItem(k){ delete this._store[k]; },
};
// s0 current (scene, playing static), s1 scene WITH sceneVideo, s2 scene 404→GL ok,
// s3 scene GL err → static ok, s4 scene GL err → static 422 → preview ok.
const mk = (id, sv) => ({ id, title:id, type:'scene', playable:false, media:null,
  preview:'/wallpaper-engine/preview/'+id, frameUrl:'/wallpaper-engine/scene-frame/'+id,
  sceneVideo: sv ? '/wallpaper-engine/scene-video/'+id : null, contentrating:'Everyone' });
const fetch = (url) => Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(
  String(url).includes('/settings') ? { ok:true, betterSidebar:false } :
  String(url).includes('/media-info') ? { info:null } :
  { installDir:'D:/we', total:5, portableCount:5, playlists:[], wallpapers:[
    mk('s0',true), mk('s1',true), mk('s2',true), mk('s3',true), mk('s4',true) ] }) });

// __WESceneGL mock: per-token behavior from GL_PLAN.
const GL_PLAN = { s2:'ready', s3:'error', s4:'error' };
const __WESceneGL = {
  version: 'we/1',
  createSceneGLRenderer(opts){
    const canvas = document.createElement('canvas');
    const r = { canvas, token: opts.token,
      dispose(){ r.disposed = true; }, resize(){}, setPaused(){}, setPlaybackRate(){},
      degraded(){ return []; }, stats:{ viewportLog:[] }, captureFramePNG(){ return Promise.resolve(null); },
    };
    glRenderers.push({ r, opts });
    return r;
  },
};
const code = readFileSync(new URL('../lib/client.js', import.meta.url),'utf8');
const cap = { handoff:null };
const sandbox = {
  window: {
    __ModuleLoader__: { load:(h)=>{ cap.handoff=h; } },
    setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
    clearTimeout:(t)=>{ if(t)t.cleared=true; },
    addEventListener(){}, innerWidth:1920, innerHeight:1080, devicePixelRatio:1,
  },
  document, localStorage, fetch, React, Image: ImageMock, __WESceneGL,
  setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
  clearTimeout:(t)=>{ if(t)t.cleared=true; },
};
vm.createContext(sandbox);
new vm.Script(code,{filename:'client.js'}).runInContext(sandbox);
const exportsObj = cap.handoff.factory((spec)=> spec==='react'?React:{createPortal:(n)=>n});
exportsObj.apply({ slots:{inject:(k,cb)=>cb(),register:()=>{}}, effect(fn){ fn(); return fn; } });
const fire = (t) => { if (t && !t.cleared) { t.cleared = true; t.fn(); } };
const rot = () => timers.find(t=>!t.cleared && t.ms===10000);
const flush = () => timers.filter(t=>!t.cleared && t.ms===200).forEach(fire);
const selId = () => JSON.parse(localStorage._store['dsh-wallpaper-engine:selection']).id;
const step = (name, fn) => { try { fn(); } catch(e){ console.log('EXCEPTION @'+name+':', e && e.stack || e); } };

setTimeout(async () => {
  await Promise.resolve();
  console.log('boot: current id =', selId(), '| 10s armed:', !!rot());

  // Cycle 1 → s1 (sceneVideo canplay)
  step('fire1', () => fire(rot()));
  let probe = mediaEls[mediaEls.length-1];
  console.log('cycle1: probing', probe.attributes.src);
  step('canplay1', () => probe.__fire('canplay'));
  flush();
  console.log('cycle1: committed id =', selId(), '(expect s1)');

  // Cycle 2 → s2 (sceneVideo 404 → GL staged ready)
  step('fire2', () => fire(rot()));
  probe = mediaEls[mediaEls.length-1];
  console.log('cycle2: probing', probe.attributes.src);
  step('err2', () => probe.__fire('error'));
  const gl = glRenderers[glRenderers.length-1];
  console.log('cycle2: GL staged created for token:', gl && gl.opts.token, '| staging div in body:', bodyEl.children.some(c=>c.className.includes('we-layer--staging')));
  step('glReady2', () => gl.opts.onReady());
  flush();
  console.log('cycle2: committed id =', selId(), '(expect s2)', '| staging removed:', !bodyEl.children.some(c=>c.className.includes('we-layer--staging')));

  // Cycle 3 → s3 (sceneVideo 404 → GL error → static frame img onload)
  step('fire3', () => fire(rot()));
  probe = mediaEls[mediaEls.length-1];
  step('err3', () => probe.__fire('error'));
  const gl3 = glRenderers[glRenderers.length-1];
  step('glErr3', () => gl3.opts.onError({ reason:'init:test' }));
  const img = imageEls[imageEls.length-1];
  console.log('cycle3: static probe src:', img.src);
  step('imgLoad3', () => { img.onload && img.onload(); });
  flush();
  console.log('cycle3: committed id =', selId(), '(expect s3)');

  // Cycle 4 → s4 (GL error → static 422 → preview ok)
  step('fire4', () => fire(rot()));
  probe = mediaEls[mediaEls.length-1];
  step('err4', () => probe.__fire('error'));
  const gl4 = glRenderers[glRenderers.length-1];
  step('glErr4', () => gl4.opts.onError({ reason:'unsupported:test' }));
  const frameImg = imageEls[imageEls.length-1];
  console.log('cycle4: frame probe src:', frameImg.src);
  step('frameErr4', () => { frameImg.onerror && frameImg.onerror(); });
  const prevImg = imageEls[imageEls.length-1];
  console.log('cycle4: preview probe src:', prevImg.src);
  step('prevLoad4', () => { prevImg.onload && prevImg.onload(); });
  flush();
  console.log('cycle4: committed id =', selId(), '(expect s4)');

  // Cycle 5 → s0 wrap (sceneVideo canplay)
  step('fire5', () => fire(rot()));
  probe = mediaEls[mediaEls.length-1];
  step('canplay5', () => probe.__fire('canplay'));
  flush();
  console.log('cycle5: committed id =', selId(), '(expect s0 wrap)');
  console.log('SCENE SMOKE DONE');
}, 50);
