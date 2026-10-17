import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
const start = source.indexOf('  const onRopePointerDown =');
const end = source.indexOf('  // Keep the rope inside', start);
assert.ok(start > 0 && end > start);
function load(mode = 'official') {
  const calls = [], capture = new Set(), classes = new Set(), cleanups = [];
  let pos = { x: 100, y: 10 };
  const el = { style: {}, classList: { add:x=>classes.add(x), remove:x=>classes.delete(x) },
    setPointerCapture:id=>capture.add(id), releasePointerCapture:id=>capture.delete(id) };
  const dragRef = { current: null };
  let gesture;
  const env = { ropeRef:{current:el}, dragRef, pos, ROPE_PREVIEW_START:10, ROPE_OPEN_THRESHOLD:40, ROPE_EDGE_INSET:10,
    ROPE_POS_KEY:'rope', clampX:x=>x, clampY:y=>y, open:false, sidebarRightMode:()=> mode, clearPreview(){}, applyPreview(){},
    wallSidebarToggle:()=>calls.push('toggle'), wallSidebarOpen:()=>calls.push('open'), wallSidebarClose:()=>calls.push('close'),
    setPos:next=>{pos=next;}, localStorage:{setItem(){}},
    React:{useEffect:fn=>{cleanups.push(fn());}},
    petLink:{performer:{onGrab:()=>calls.push('grab'), onPull:()=>calls.push('pull'), onRelease:()=>calls.push('release')},
      mascot:{tap:()=>calls.push('tap'), registerGesture:fn=>{gesture=fn;return()=>{gesture=null;};}}},
  };
  const api = new Function('env','with(env){'+source.slice(start,end)+'return {down:onRopePointerDown,move:onRopePointerMove,key:onRopeKeyDown,finish:finishDrag};}')(env);
  const event = (x=110,y=20)=>({pointerType:'mouse',button:0,pointerId:7,clientX:x,clientY:y,preventDefault(){}});
  return {api,event,calls,capture,classes,dragRef,el,cleanups,get gesture(){return gesture;},get pos(){return pos;}};
}
let fail=0;
async function test(name,fn){try{await fn();console.log('PASS '+name);}catch(e){fail++;console.error('FAIL '+name+': '+e.message);}}
await test('Enter 和 Space 与点击使用同一接管及回退入口',()=>{
  const h=load();for(const key of ['Enter',' '])h.api.key({key,preventDefault(){}});
  assert.deepEqual(h.calls,['tap','tap']);h.api.key({key:'Escape'});assert.equal(h.calls.length,2);
});
await test('退出归还拖拽捕获并复位，不再切换侧栏',()=>{
  const h=load();h.api.down(h.event());h.api.move(h.event(125,100));assert.equal(h.capture.size,1);
  assert.equal(typeof h.gesture,'function');h.gesture();
  assert.equal(h.capture.size,0);assert.equal(h.dragRef.current,null);assert.equal(h.classes.has('we-rope--dragging'),false);
  assert.equal(h.pos.y,10);assert.ok(!h.calls.includes('open')&&!h.calls.includes('toggle'));
  const count=h.calls.length;h.api.move(h.event(130,120));assert.equal(h.calls.length,count);
  for(const cleanup of h.cleanups)if(typeof cleanup==='function')cleanup();assert.equal(h.gesture,null);
});
await test('原生拖动开合只执行一次且取消不补触发',()=>{
  const h=load();h.api.down(h.event());h.api.move(h.event(110,100));h.api.finish(110,100,false);
  assert.equal(h.calls.filter(x=>x==='open').length,1);
  const c=load();c.api.down(c.event());c.api.move(c.event(110,100));c.api.finish(110,100,true);
  assert.ok(!c.calls.includes('open')&&!c.calls.includes('toggle'));
});
await test('默认抽屉的点击键盘和拖动保留原生行为，不触发桌宠',()=>{
  const h=load('drawer'); h.api.key({key:'Enter',preventDefault(){}});
  h.api.down(h.event()); h.api.finish(110,20,false);
  h.api.down(h.event()); h.api.move(h.event(110,100)); h.api.finish(110,100,false);
  assert.deepEqual(h.calls,['toggle','toggle','open']);
});
if(fail)process.exitCode=1;
