#!/usr/bin/env node
/** 抽取真实原生抛掷驱动，验证联动入口与手动甩出共用物理。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as patcher from '../tools/patch-pet-client.mjs';
const input = readFileSync(process.argv[2], 'utf8');
const source = process.argv.includes('--installed') ? input : patcher.applyThrowEdits ? patcher.applyThrowEdits(input) : input;
const part = (from, to) => { const a=source.indexOf(from),b=source.indexOf(to,a+from.length);assert.ok(a>=0&&b>a,from);return source.slice(a,b); };
function load(physics = {}) {
  let now=0, serial=0;const tasks=new Map(), commits=[], squashes=[];
  const style={left:'900px',top:'200px'}, root={style,getBoundingClientRect:()=>({left:parseFloat(style.left),top:parseFloat(style.top),width:400,height:225})};
  const ref=value=>({current:value});
  const env={window:{innerWidth:1400,innerHeight:900},performance:{now:()=>now},
    requestAnimationFrame:fn=>{const id=++serial;tasks.set(id,fn);return id;},cancelAnimationFrame:id=>tasks.delete(id),
    stopDragFollow(){},stopMove(){},rootRef:ref(root),throwTokenRef:ref(0),throwRef:ref(null),throwStateRef:ref(null),boxPxRef:ref(null),customPosRef:ref(null),
    size:400,sideAllow:100,halfW:200,halfH:112.5,frontRef:ref(0),videoARef:ref({}),videoBRef:ref(null),
    cfg:{id:'main',physics:{gravity:1400,restitution:.4,groundFriction:5,petCollision:false,...physics}},arena:ref({slots:{}}),
    setCustomPos:p=>commits.push(p),startSquash:(el,depth)=>squashes.push(depth)};
  const shared=part('const SPRING_K =','const PET_BOUNCE_E =');
  const driver=part('\t\tconst stopThrow =','\t\t/** rAF 弹簧跟随')+'\n'+part('\t\tconst startThrow =','\t\t/** 被撞回调');
  const api=source.includes('throwNative(point, velocity)')?part('\t\t\t\tthrowNative(point, velocity)', '\t\t\t\tadoptPosition(point)'):'';
  const ctl=new Function('env','with(env){'+shared+'\n'+driver+'\nconst startThrowLatestRef={current:startThrow};return {'+api+'};}')(env);
  const frames=[];
  function advance(to) {while(now<to){now+=10;const batch=[...tasks.values()];tasks.clear();for(const fn of batch)fn(now);frames.push({at:now,x:parseFloat(style.left),y:parseFloat(style.top)});}}
  return {ctl,style,env,frames,commits,squashes,advance};
}
let failures=0;
async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+': '+e.message);}}
await check('联动从可见中心交还位置后进入手动丢走使用的原生驱动',()=>{
  const h=load();assert.equal(typeof h.ctl.throwNative,'function');
  const id=h.ctl.throwNative({x:1100,y:312.5},{vx:-900,vy:-500});assert.equal(typeof id,'number');
  assert.equal(h.style.left,'900px');assert.equal(h.style.transform,'translate(0px,0px)');
  assert.equal(h.ctl.getNativeThrow(id).active,true);h.advance(250);
  assert.ok(h.frames.at(-1).x<900&&h.frames.at(-1).y<200,'必须后退并向上飞，而非原地动画');
  h.advance(12000);assert.equal(h.ctl.getNativeThrow(id).active,false);assert.equal(h.ctl.getNativeThrow(id).cancelled,false);
  assert.ok(h.frames.some((f,i,a)=>i>0&&f.x>a[i-1].x),'到左边界必须原生反弹');
  assert.ok(h.squashes.length>0,'落地使用原生挤压');assert.ok(h.commits.length>0,'物理落定提交原生坐标');
});
await check('停止只取消本次抛掷，陈旧句柄不能停止新的手动抛掷',()=>{
  const h=load();assert.equal(typeof h.ctl.throwNative,'function');const first=h.ctl.throwNative({x:900,y:300},{vx:-800,vy:-400});h.advance(100);
  assert.equal(h.ctl.stopNativeThrow(first),true);const x=h.style.left;h.advance(1000);assert.equal(h.style.left,x);
  const next=h.ctl.throwNative({x:700,y:300},{vx:-600,vy:-300});assert.notEqual(first,next);assert.equal(h.ctl.stopNativeThrow(first),false);
  assert.equal(h.ctl.getNativeThrow(first).cancelled,true);assert.equal(h.ctl.getNativeThrow(next).active,true);h.ctl.stopNativeThrow(next);
});
await check('初速有限且拒绝非法输入，不启动NaN或无限物理任务',()=>{
  const h=load();assert.equal(typeof h.ctl.throwNative,'function');
  for(const velocity of [{vx:NaN,vy:0},{vx:0,vy:Infinity},null])assert.equal(h.ctl.throwNative({x:100,y:200},velocity),false);
  assert.equal(h.ctl.throwNative({x:Infinity,y:0},{vx:1,vy:1}),false);
  const id=h.ctl.throwNative({x:900,y:300},{vx:-999999,vy:-999999});h.advance(10);
  assert.ok(Math.hypot(h.env.throwStateRef.current.vx,h.env.throwStateRef.current.vy)<=3610);h.ctl.stopNativeThrow(id);
});
if(failures)process.exitCode=1;
