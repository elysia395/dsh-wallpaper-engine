#!/usr/bin/env node
/** 执行真实官方侧栏控制面，确保反击仅调整过渡，不改宿主网格。 */
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
const source=readFileSync(new URL('../src/client.js',import.meta.url),'utf8');
const a=source.indexOf('  const officialPull = {'),b=source.indexOf('  }, [hidden, petOfficialMode]);',a);assert.ok(a>=0&&b>a);
const changes=[],values=new Map([['--ds-transition-duration-slow','450ms']]);
const style={getPropertyValue:k=>values.get(k)||'',setProperty(k,v){assert.notEqual(k,'grid-template-columns');values.set(k,v);},removeProperty:k=>values.delete(k)};
const frame={style},surf={style:{...style},getBoundingClientRect:()=>({left:900})};let api,cleanup;
new Function('document','React','petLink','wallSidebarOpen','wallSidebarClose','sidebarRightOursActive','const hidden=false,petOfficialMode=true;'+source.slice(a,b)+'  }, [hidden, petOfficialMode]);')(
 {querySelector:q=>q==='.dshDesktopFrame'?frame:surf},{useEffect:fn=>{cleanup=fn();}}, {mascot:{registerSidebar:value=>{api=value;}}},
 ()=>changes.push({open:true,duration:values.get('--ds-transition-duration-slow')}),()=>changes.push({open:false,duration:values.get('--ds-transition-duration-slow')}),()=>true);
assert.equal(typeof api.rebound,'function','官方侧栏应提供开/合反击通道');
api.rebound(true,240);api.rebound(false,180);api.rebound(true,300);
assert.deepEqual(changes,[{open:true,duration:'240ms'},{open:false,duration:'180ms'},{open:true,duration:'300ms'}]);
api.commit();assert.equal(values.get('--ds-transition-duration-slow'),'450ms');cleanup();assert.equal(api,null);
console.log('PASS 真实官方侧栏按反击开合时长运行，恢复临时样式且不碰宿主网格');

{
  const values = new Map([['--ds-transition-duration-slow', '450ms']]);
  const surfaceValues = new Map([['overflow', 'visible']]);
  const style = map => ({ getPropertyValue: key => map.get(key) || '',
    setProperty(key, value) { assert.notEqual(key, 'grid-template-columns'); map.set(key, value); },
    removeProperty: key => map.delete(key) });
  const unrelated = { transitionProperty: 'opacity', pause() { throw Error('不能暂停无关过渡'); } };
  const animations = [unrelated], created = [];
  const frame = { style: style(values), getAnimations: () => animations };
  const surface = { style: style(surfaceValues) };
  let api;
  const open = () => {
    const animation = { transitionProperty: 'grid-template-columns', currentTime: 0, playState: 'running',
      effect: { updateTiming() {}, getComputedTiming: () => ({ duration: 1000 }) },
      pause() { this.playState = 'paused'; }, finish() { this.currentTime = 1000; this.playState = 'finished'; },
      cancel() { this.playState = 'idle'; } };
    animations.push(animation); created.push(animation);
  };
  new Function('document', 'React', 'petLink', 'wallSidebarOpen', 'wallSidebarClose', 'sidebarRightOursActive',
    'const hidden=false,petOfficialMode=true;' + source.slice(a, b) + '  }, [hidden, petOfficialMode]);')(
    { querySelector: q => q === '.dshDesktopFrame' ? frame : surface }, { useEffect: fn => fn() },
    { mascot: { registerSidebar: value => { api = value; } } }, open, () => {}, () => false);
  assert.equal(typeof api.syncOpen, 'function', '应提供原生展开进度控制，而非猜测毫秒数');
  const first = api.syncOpen(); first.seek(.4);
  assert.equal(created[0].playState, 'paused'); assert.equal(created[0].currentTime, 400);
  first.seek(1); assert.ok(created[0].currentTime < 1000, '没有实际ended不能完整到位');
  first.finish(); assert.equal(created[0].playState, 'finished');
  assert.equal(values.get('--ds-transition-duration-slow'), '450ms');
  assert.equal(surfaceValues.get('overflow'), 'visible');
  const second = api.syncOpen(); second.seek(.2);
  const third = api.syncOpen(); third.seek(.6);
  assert.equal(created[1].playState, 'idle');
  second.finish(); second.cancel();
  assert.equal(created[2].currentTime, 600, '旧会话不能完成或清除新会话');
  third.cancel(); third.cancel();
  assert.equal(created[2].playState, 'idle');
  assert.equal(values.get('--ds-transition-duration-slow'), '450ms');
  assert.equal(surfaceValues.get('overflow'), 'visible');
  console.log('PASS 原生侧栏过渡按进度暂停定位，实际结束才完成，旧会话不碰新代且不改宿主网格');
}
