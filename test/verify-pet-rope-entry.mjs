import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// RopeDock 组件自 2026-11-07（S7 试点）起住 `src/client/rope-dock.js`；切片锚点不变。
const source = readFileSync(new URL('../src/client/rope-dock.js', import.meta.url), 'utf8');
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
// 1.4.1 线上事故的**源头**：官方态的拖动路径对每一次 pointermove 都发 performer.onPull。
// 这个形状本身是刻意的（要按手指位移做跟手预览），不能改成只发一次
// —— 所以契约是「手势合成事件必须逐帧转发，且**不得**合成任何侧栏 toggle」：
// 侧栏只有两个提交点（抬手 click = mascot.tap / 越过阈值 = open|close），
// 且这两点各自最多一次。以前 provider 把它当点击回落，就成了"拖动 = 连续点击"。
await test('官方态拖动逐帧转手势，但不合成任何侧栏开关（单次拖动最多一次提交）',()=>{
  const h=load();
  h.api.down(h.event());
  // 40 帧连续位移：每一帧都必须转发 onPull（跟手预览的数据源）。
  for(let i=1;i<=40;i+=1)h.api.move(h.event(100+i,10+i*3));
  const pulls=h.calls.filter(x=>x==='pull').length;
  assert.equal(pulls,40,'每一帧 pointermove 都必须转发一次 onPull（跟手预览靠它）');
  assert.equal(h.calls.filter(x=>x==='grab').length,1,'onGrab 只在越过死区那一刻发一次');
  // 途中不许出现任何侧栏动作：整段拖动从头到尾零 toggle/open/close。
  assert.ok(!h.calls.includes('toggle')&&!h.calls.includes('open')&&!h.calls.includes('close'),
    '拖动途中不得碰侧栏开关（1.4.1 的右侧栏高频开合就是这个形状）');
  // 抬手：短距离 = 一次点击语义（tap 或原生态 toggle，取决于模式），且只有一次。
  h.api.finish(140,130,false);
  const commits=h.calls.filter(c=>c==='tap'||c==='toggle'||c==='open'||c==='close').length;
  assert.equal(commits,1,'一次拖动结束只允许一次开/关提交，实际 '+commits+' 次');
});
if(fail)process.exitCode=1;
