#!/usr/bin/env node
/** 执行真实官方侧栏控制面，确保反击仅调整过渡，不改宿主网格。 */
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
// RopeDock 组件自 2026-11-07（S7 试点）起住 `src/client/rope-dock.js`；切片锚点不变。
const source=readFileSync(new URL('../src/client/rope-dock.js',import.meta.url),'utf8');
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

{
  const values = new Map([['--ds-transition-duration-slow', '450ms']]);
  const overflow = new Map([['overflow', 'clip']]);
  const style = map => ({ getPropertyValue: key => map.get(key) || '',
    setProperty(key, value) { assert.notEqual(key, 'grid-template-columns'); map.set(key, value); },
    removeProperty: key => map.delete(key) });
  let left = 1200, api;
  const dock = { matches: selector => selector.includes('data-dockkit-host'),
    getBoundingClientRect: () => ({ left, width: 320 }) };
  const divider = { matches: selector => selector.includes('data-dockkit-divider') };
  const animations = [], created = [];
  const panel = {
    style: style(overflow),
    closest: () => null,
    querySelector: selector => selector === '.we-qp--official' ? {} : dock,
    querySelectorAll: () => [dock],
    getAnimations: () => animations,
  };
  // 当前宿主的时长从 panel 继承，表面本体不随 transform 移动。
  panel.style = style(new Map([...values, ...overflow]));
  const hiddenPanel = { closest: () => ({}), querySelector() { throw Error('不能使用后台会话'); } };
  const open = () => {
    assert.equal(panel.style.getPropertyValue('--ds-transition-duration-slow'), '1000ms');
    for (const target of [dock, divider]) {
      const animation = { transitionProperty: 'transform', currentTime: 0, playState: 'running',
        effect: { target, updateTiming() {}, getComputedTiming: () => ({ duration: 1000 }) },
        pause() { this.playState = 'paused'; }, finish() { this.currentTime = 1000; this.playState = 'finished'; },
        cancel() { this.playState = 'idle'; } };
      animations.push(animation); created.push(animation);
    }
  };
  new Function('document', 'React', 'petLink', 'wallSidebarOpen', 'wallSidebarClose', 'sidebarRightOursActive',
    'const hidden=false,petOfficialMode=true;' + source.slice(a, b) + '  }, [hidden, petOfficialMode]);')(
    { querySelector: () => null, querySelectorAll: () => [hiddenPanel, panel] },
    { useEffect: fn => fn() }, { mascot: { registerSidebar: value => { api = value; } } }, open, () => {}, () => true);
  const run = api.syncOpen();
  assert.equal(panel.style.getPropertyValue('--ds-transition-duration-slow'), '1000ms', '新版 panel 也必须临时调长过渡');
  run.seek(.4);
  assert.equal(created.length, 2);
  for (const animation of created) {
    assert.equal(animation.playState, 'paused', 'DockKit 宿主与分隔条的 transform 一起跟随');
    assert.equal(animation.currentTime, 400);
  }
  left = 1040;
  assert.equal(api.edgeX(), 1040, '读取正在移动的 dock 边缘，不是固定 panel 的左缘');
  left = 920;
  assert.equal(api.edgeX(), 920, '边缘继续变化，宠物可逐帧跟随');
  run.finish();
  assert.equal(panel.style.getPropertyValue('--ds-transition-duration-slow'), '450ms');
  assert.equal(panel.style.getPropertyValue('overflow'), 'clip');
  for (const animation of created) assert.equal(animation.playState, 'finished');
  console.log('PASS 新版DockKit无旧类名时仍控制慢拉、移动边缘和全部自有transform过渡');
}

{
  const sidebar = readFileSync(new URL('../src/sidebar-right.js', import.meta.url), 'utf8');
  const prefix = sidebar.slice(0, sidebar.indexOf('/** 强制抽屉态'));
  let expanded = false, kind = 'wallpaper-library', toggles = 0;
  const ctrl = { active: () => ({ kind }), isExpanded: () => expanded,
    toggleExpanded() { expanded = !expanded; toggles++; },
    openTab(next) { kind = next; expanded = true; } };
  const api = new Function('ctrl', prefix + `
    weSidebarMode='official'; weSidebarCtrl=ctrl;
    weSidebarOpenFn=()=>ctrl.openTab(WE_SIDEBAR_KIND);
    return {isOpen:sidebarRightOursActive,toggle:sidebarRightToggle,close:sidebarRightClose};`)(ctrl);
  assert.equal(api.isOpen(), false, 'tab仍为壁纸不代表收起的侧栏还开着');
  api.toggle(); assert.equal(expanded, true); assert.equal(api.isOpen(), true);
  api.toggle(); assert.equal(expanded, false); assert.equal(api.isOpen(), false);
  kind = 'files'; expanded = true;
  const before = toggles;
  api.close(); assert.equal(toggles, before, '不能收起用户切换到的其他tab');
  api.toggle(); assert.equal(kind, 'wallpaper-library'); assert.equal(toggles, before, '聚焦壁纸而不是同时切换默认栏');
  console.log('PASS 官方栏状态包含expanded，壁纸开关不误收其他tab');
}

{
  const sidebar = readFileSync(new URL('../src/sidebar-right.js', import.meta.url), 'utf8');
  const prefix = sidebar.slice(0, sidebar.indexOf('/** 强制抽屉态'));
  let drawerOpen = true;
  const api = new Function('closeDrawer', prefix + `
    weSidebarMode='official';
    weSidebarOpenFn=()=>{};
    ropeDrawerControl={close:closeDrawer};
    return {open:wallSidebarOpen};`)(() => { drawerOpen = false; });
  assert.equal(api.open(), true);
  assert.equal(drawerOpen, false, '官方栏已接管时须收起之前回落打开的自有抽屉');
  console.log('PASS 官方栏接管后不残留自有抽屉，不改其他宿主tab');
}

{
  const makeStyle = initial => {
    const values = new Map(initial);
    return { getPropertyValue: key => values.get(key) || '', getPropertyPriority: () => '',
      setProperty(key, value) {
        values.set(key, key === 'clip-path' ? value.replace(/\d+\.\d+px/g, part => Number(parseFloat(part).toFixed(3)) + 'px') : value);
      }, removeProperty: key => values.delete(key) };
  };
  const frames = new Map(), observers = [];
  let nextFrame = 0, expanded = false, left = 1200, api, cleanup;
  const plate = { style: makeStyle([]) };
  const dock = { matches: () => true, getBoundingClientRect: () => ({ left, width: 300 }) };
  const animation = { transitionProperty: 'transform', playState: 'running',
    effect: { target: dock, updateTiming() {}, getComputedTiming: () => ({ duration: 1000 }) },
    pause() { this.playState = 'paused'; }, finish() { left = 900; this.playState = 'finished'; },
    cancel() { this.playState = 'idle'; },
    set currentTime(value) { left = 1200 - 300 * value / 1000; } };
  const animations = [];
  dock.getAnimations = () => animations;
  const panel = { style: makeStyle([['clip-path', 'inset(1px)']]), closest: () => null,
    hasAttribute: name => name === 'data-sidebar-right-open' && expanded,
    querySelector: () => dock, querySelectorAll: () => [dock], getAnimations: () => animations,
    getBoundingClientRect: () => ({ left: 900, right: 1200, width: 300 }) };
  const record = { plate: null };
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); };
  class Observer {
    constructor(fn) { this.fn = fn; observers.push(this); }
    observe() {} disconnect() { this.stopped = true; }
  }
  new Function('document', 'React', 'petLink', 'wallSidebarOpen', 'wallSidebarClose', 'sidebarRightOursActive',
    'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'weSurfaceRuntime',
    'const hidden=false,petOfficialMode=true;' + source.slice(a, b) + '  }, [hidden, petOfficialMode]);')(
    { querySelector: () => null, querySelectorAll: () => [panel], body: {} },
    { useEffect: fn => { cleanup = fn(); } }, { mascot: { registerSidebar: value => { api = value; } } },
    () => { expanded = true; animations.push(animation); }, () => { expanded = false; }, () => expanded,
    Observer, fn => { const id = ++nextFrame; frames.set(id, fn); return id; }, id => frames.delete(id),
    { records: new Map([[panel, record]]) });
  const run = api.syncOpen();
  assert.equal(panel.style.getPropertyValue('clip-path'), 'inset(0px 0px 0px 300px)', '开栏首帧不能先铺满底板');
  run.seek(.25); flush();
  assert.equal(panel.style.getPropertyValue('clip-path'), 'inset(0px 0px 0px 225px)', '底板须按内容真实左缘显露而非独立计时');
  record.plate = plate;
  for (const observer of observers) if (!observer.stopped) observer.fn();
  assert.equal(plate.style.getPropertyValue('clip-path'), 'inset(0px 0px 0px 225px)', '后挂载的独立玻璃底板也须在绘制前同步');
  run.seek(.6); flush();
  assert.equal(plate.style.getPropertyValue('clip-path'), 'inset(0px 0px 0px 120px)');
  run.seek(.3333333); flush();
  assert.equal(plate.style.getPropertyValue('clip-path'), 'inset(0px 0px 0px 200px)');
  run.finish();
  assert.equal(panel.style.getPropertyValue('clip-path'), 'inset(1px)', '结束须恢复原面板裁剪');
  assert.equal(plate.style.getPropertyValue('clip-path'), '', '结束不残留自有玻璃裁剪');
  assert.equal(frames.size, 0, '结束停止跟随帧，不留常驻轮询');
  cleanup();
  console.log('PASS 侧栏底板和后挂载玻璃层跟随实际拉取边缘，结束恢复原样');
}

{
  const frames = new Map(), observers = [], styles = new Map();
  let nextFrame = 0, open = false, left = 1200, api, cleanup;
  const style = { getPropertyValue: key => styles.get(key) || '',
    setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) };
  const dock = { matches: () => true, closest: () => null,
    getBoundingClientRect: () => ({ left, width: 300, height: 700 }) };
  const retained = { matches: () => true, closest: () => ({}),
    getBoundingClientRect: () => ({ left: 0, width: 0, height: 0 }),
    animate() { throw Error('隐藏保留节点不能被补动画'); } };
  const panel = { style, closest: () => null, isConnected: true,
    hasAttribute: () => open, querySelector: () => dock, querySelectorAll: () => [retained, dock],
    getBoundingClientRect: () => ({ left: 900, right: 1200, width: 300, height: 700 }) };
  class Observer { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.stopped = true; } }
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); };
  new Function('document', 'React', 'petLink', 'wallSidebarOpen', 'wallSidebarClose', 'sidebarRightOursActive',
    'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'weSurfaceRuntime',
    'const hidden=false,petOfficialMode=true;' + source.slice(a, b) + '  }, [hidden, petOfficialMode]);')(
    { querySelector: () => null, querySelectorAll: () => [panel], body: {} },
    { useEffect: fn => { cleanup = fn(); } }, { mascot: { registerSidebar: value => { api = value; } } },
    () => {}, () => {}, () => open, Observer,
    fn => { const id = ++nextFrame; frames.set(id, fn); return id; }, id => frames.delete(id), null);
  api.beginPull(2000);
  for (const observer of observers) if (!observer.stopped) observer.fn();
  flush();
  assert.equal(style.getPropertyValue('clip-path'), 'inset(0px 0px 0px 300px)', 'React尚未提交expanded时不能撤掉开栏裁剪');
  open = true; left = 1125;
  flush();
  assert.equal(api.edgeX(), 1125, '隐藏保留节点不能作为面板或宠物跟随边缘');
  assert.equal(style.getPropertyValue('clip-path'), 'inset(0px 0px 0px 225px)', '延迟挂载后继续按实际可见节点跟随');
  open = false;
  flush();
  assert.equal(style.getPropertyValue('clip-path'), '', '开栏后用户收起即停止本轮裁剪');
  assert.equal(frames.size, 0);
  cleanup();
  console.log('PASS 延迟提交不提前撤裁剪，隐藏保留节点不误开底板，用户中断可清理');
}

{
  const makeStyle = values => ({ getPropertyValue: key => values.get(key) || '', getPropertyPriority: () => '',
    setProperty(key, value) { assert.notEqual(key, 'grid-template-columns'); values.set(key, value); },
    removeProperty: key => values.delete(key) });
  const frameValues = new Map([['--ds-transition-duration-slow', '450ms']]);
  const panelValues = new Map(), animations = [], created = [];
  const frame = { style: makeStyle(frameValues), getAnimations: () => animations, hasAttribute: () => false };
  const col = { parentElement: frame };
  let expanded = false, api;
  const dock = { matches: () => true, closest: () => expanded ? null : panel,
    getBoundingClientRect: () => ({ left: 1200, width: 300, height: 700 }) };
  const panel = { style: makeStyle(panelValues), closest: selector => selector === '[data-rightbar-col]' ? col : null,
    querySelector: () => dock, querySelectorAll: () => [dock], hasAttribute: () => expanded,
    getAnimations: () => animations.filter(animation => animation.effect.target !== frame),
    getBoundingClientRect: () => ({ left: 900, right: 1200, width: 300, height: 700 }) };
  const animation = (target, transitionProperty) => ({ transitionProperty, currentTime: 0,
    effect: { target, updateTiming() {}, getComputedTiming: () => ({ duration: 1000 }) },
    pause() { this.playState = 'paused'; }, finish() { this.playState = 'finished'; }, cancel() { this.playState = 'idle'; } });
  const open = () => {
    assert.equal(frameValues.get('--ds-transition-duration-slow'), '1000ms', '时长必须写在拥有整层网格的祖先，而非panel');
    assert.match(frameValues.get('transition') || '', /grid-template-columns/, '宿主600ms清除data-animating后过渡仍须保留');
    expanded = true;
    created.push(animation(frame, 'grid-template-columns'), animation(dock, 'transform'));
    const foreign = animation({}, 'grid-template-columns');
    foreign.pause = () => { throw Error('不能暂停其他面板内部网格'); };
    animations.push(...created, foreign);
  };
  new Function('document', 'React', 'petLink', 'wallSidebarOpen', 'wallSidebarClose', 'sidebarRightOursActive',
    'const hidden=false,petOfficialMode=true;' + source.slice(a, b) + '  }, [hidden, petOfficialMode]);')(
    { querySelector: () => null, querySelectorAll: () => [panel] }, { useEffect: fn => fn() },
    { mascot: { registerSidebar: value => { api = value; } } }, open, () => {}, () => expanded);
  assert.equal(api.edgeX(), 1200, '收起的dock虽隐藏，彩蛋一仍须从屏幕右缘启动碰撞检测');
  const run = api.syncOpen(); run.seek(.4);
  assert.equal(panelValues.get('--ds-transition-duration-slow'), undefined, '不在panel遮蔽祖先继承的时长');
  for (const item of created) { assert.equal(item.playState, 'paused'); assert.equal(item.currentTime, 400); }
  run.finish();
  assert.equal(frameValues.get('--ds-transition-duration-slow'), '450ms');
  assert.equal(frameValues.get('transition'), undefined, '归还宿主原有过渡控制');
  console.log('PASS 新版侧栏同时控制整层网格与dock，关闭时仍可取得彩蛋一碰撞起点');
}
