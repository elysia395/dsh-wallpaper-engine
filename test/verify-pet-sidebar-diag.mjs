import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// RopeDock 组件自 2026-11-07（S7 试点）起住 `src/client/rope-dock.js`；切片锚点不变。
const source=readFileSync(new URL('../src/client/rope-dock.js',import.meta.url),'utf8');
const start=source.indexOf('  const officialPull = {');
const end=source.indexOf('  }, [hidden, petOfficialMode]);',start);
const events=[];let api;
const column={parentElement:null,getBoundingClientRect:()=>({left:900,top:0,width:300,height:700})};
const frame={getBoundingClientRect:()=>({left:0,top:0,width:1200,height:700}),getAnimations:()=>[
 {effect:{target:frame,getTiming:()=>({duration:8125})},transitionProperty:'grid-template-columns',currentTime:2000,playState:'running'}]};
column.parentElement=frame;
const panel={closest:selector=>selector==='[data-rightbar-col]'?column:null,querySelector:()=>({}),hasAttribute:()=>true,
 getBoundingClientRect:()=>({left:900,top:0,width:300,height:700,bottom:700}),
 style:{getPropertyValue:()=>''},querySelectorAll:()=>[]};
const setup=source.slice(start,end)+'  }, [hidden, petOfficialMode]);return officialPull;';
const pull=new Function('document','React','petLink','wallSidebarOpen','wallSidebarClose','sidebarRightOursActive','apiPostJson','getComputedStyle',
 'const hidden=false,petOfficialMode=true;'+setup)(
 {querySelector:()=>panel,querySelectorAll:()=>[panel]}, {useEffect:fn=>fn()},
 {mascot:{registerSidebar:value=>{api=value;}}},()=>{},()=>{},()=>true,
 (path,body)=>{events.push({path,body});return Promise.resolve();},
 ()=>({transitionDuration:'8.125s',gridTemplateColumns:'240px 660px 300px',getPropertyValue:()=> '8125ms'}));
assert.ok(api);
const gridEvent=events.find(event=>event.body.event==='sidebar-grid-v6');
assert.ok(gridEvent,'必须测量真实外层网格，不能从内部dock慢开推断整列正常');
const grid=JSON.parse(gridEvent.body.detail);
assert.deepEqual(grid.f,[0,0,1200,700]);assert.deepEqual(grid.c,[900,0,300,700]);
assert.equal(grid.g,'240px 660px 300px');assert.equal(grid.d,'8.125s');
assert.equal(grid.a[0][0],'grid-template-columns');assert.equal(grid.a[0][1],8125);
assert.ok(events.some(event=>event.body.event==='sidebar-paint-v4'&&JSON.parse(event.body.detail).s==='ready'),'注册时应报告当前绘制诊断版本');
for(let i=0;i<100;i++)pull.trace('sample',{surface:panel,modern:true});
assert.ok(events.length<=25,'诊断应有全生命周期上限');
for(const event of events){
 assert.equal(event.path,'/client-diag');
 assert.deepEqual(Object.keys(event.body).sort(),['detail','event','type']);
 assert.ok(event.body.detail.length<=300);
 JSON.parse(event.body.detail);
 assert.equal(event.body.type,'sidebar-motion');
}
console.log('PASS 侧栏绘制诊断标明加载版本、仅几何数据且有界，不读取内容/URL/用户配置');
