import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

export async function verifyEgg2Browser({ evaluate, until, send, width, height, art }) {
  const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const a = client.indexOf('  const officialPull = {');
  const b = client.indexOf('  }, [hidden, petOfficialMode]);', a);
  assert.ok(a > 0 && b > a);
  const official = 'const hidden=false,petOfficialMode=true;' + client.slice(a, b) + '  }, [hidden, petOfficialMode]);';
  await evaluate(`(() => {
    __link.tuner.open(); document.querySelector('[data-tuner-tab="egg2"]').click();
    const keys=['egg2ShakeAtMs','egg2ShakePx','egg2ShakeHz','egg2OpenAtPct','egg2OpenEase'];
    window.__eggFields=keys.map(key=>document.querySelector('[data-tuner="'+key+'"][data-tuner-logic="egg2"]'));
  })()`);
  assert.equal(await evaluate('__eggFields.every(Boolean)'), true, '彩蛋二五个真实控件齐全');
  const controls = await evaluate(`__eggFields.map(el=>({width:el.getBoundingClientRect().width,tag:el.tagName}))`);
  assert.ok(controls.every(el => el.width >= 100), '窄视口数字框不得被压扁');
  assert.deepEqual(controls.map(el => el.tag), ['INPUT', 'INPUT', 'INPUT', 'INPUT', 'SELECT']);
  await evaluate(`__eggFields.forEach((el,i)=>{el.value=String([2100,14,9,45,0][i]);el.dispatchEvent(new Event(i===4?'change':'input',{bubbles:true}));});`);
  assert.equal(await evaluate(`JSON.parse(document.querySelector('[data-tuner="out"]').value).logicValues.egg2.egg2ShakeAtMs`), 2100);
  assert.equal(await evaluate(`JSON.parse(document.querySelector('[data-tuner="out"]').value).logicValues.egg2.egg2ShakePx`), 14);
  await evaluate(`__link.tuner.reset('egg2');document.querySelector('[data-pet-tuner]').scrollTop=__eggFields[0].offsetTop-100;`);
  assert.deepEqual(await evaluate('__eggFields.map(el=>el.value)'), ['1750', '8', '12', '35', '2']);
  const panel = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL('egg2-panel-' + width + 'x' + height + '.png', art), Buffer.from(panel.data, 'base64'));

  await evaluate(`(() => {
    __link.tuner.close();
    const frame=document.createElement('div');frame.className='dshDesktopFrame';
    frame.style.cssText='position:fixed;inset:0;display:grid;grid-template-columns:0px minmax(0,1fr) 0px;transition:grid-template-columns var(--ds-transition-duration-slow) linear;--ds-transition-duration-slow:450ms;pointer-events:none';
    frame.innerHTML='<div></div><div></div><div class="dshDesktopRightbarSurface" style="min-width:0;background:#c8d9d1;overflow:visible"><div style="width:320px;height:100vh;border-left:1px solid #547a6c"></div></div>';
    document.body.prepend(frame);window.__eggFrame=frame;
    window.__eggSurface=frame.querySelector('.dshDesktopRightbarSurface');window.__eggWidth=Math.min(320,innerWidth*.4);
    window.__eggTrace={samples:[],finishes:[]};
    const snapshot=()=>({at:performance.now(),p:window.__dshPetCtl.getPlayback(),width:__eggSurface.getBoundingClientRect().width,x:frame.getBoundingClientRect().left,y:frame.getBoundingClientRect().top,clip:document.documentElement.style.getPropertyValue('overflow-x')});
    window.__eggSample=snapshot;
    new Function('document','React','petLink','wallSidebarOpen','wallSidebarClose','sidebarRightOursActive',${JSON.stringify(official)})(document,{useEffect:fn=>fn()},
      {mascot:{registerSidebar(api){
        const original=api.syncOpen;
        api.syncOpen=()=>{const session=original();return {seek:p=>session.seek(p),cancel:()=>session.cancel(),finish:()=>{const before=snapshot();session.finish();__eggTrace.finishes.push({before,after:snapshot()});}};};
        __link.mascot.registerSidebar(api);
      }}},()=>{frame.style.gridTemplateColumns='0px minmax(0,1fr) '+__eggWidth+'px';return true;},
      ()=>{frame.style.gridTemplateColumns='0px minmax(0,1fr) 0px';return true;},()=>__eggSurface.getBoundingClientRect().width>0);
    window.__eggDone=false;window.__eggResult=null;
    const sample=()=>{if(__eggDone)return;__eggTrace.samples.push(snapshot());requestAnimationFrame(sample);};requestAnimationFrame(sample);
    __link.set('egg2','egg2LeadMs',0);__link.set('egg2','egg2OpenEase',0);
    void __link.tuner.run('egg2').then(result=>{__eggResult=result;__eggDone=true;});
  })()`);
  await until(`__dshPetCtl.getPlayback().name==='彩蛋-吉祥物-哈气-dshwe'&&__dshPetCtl.getPlayback().phase==='playing'&&__dshPetCtl.getPlayback().currentTime>2.4`, '实际哈气已播放且侧栏进入中间进度');
  await evaluate(`document.querySelector('video.is-front').pause();`);
  await evaluate(`new Promise(resolve=>{let n=0;const next=()=>++n===3?resolve():requestAnimationFrame(next);requestAnimationFrame(next);})`);
  const paused = await evaluate('__eggSample()');
  assert.ok(paused.width > 5 && paused.width < await evaluate('__eggWidth') - 2, '视频中途必须是真实中间宽度');
  await evaluate(`new Promise(resolve=>{let n=0;const next=()=>++n===16?resolve():requestAnimationFrame(next);requestAnimationFrame(next);})`);
  const still = await evaluate('__eggSample()');
  assert.ok(Math.abs(paused.width - still.width) < .2, '视频暂停时侧栏不能按墙钟继续');
  assert.ok(Math.abs(paused.x - still.x) < .2 && Math.abs(paused.y - still.y) < .2, '视频暂停时全GUI抖动也冻结');
  assert.equal(await evaluate('__eggTrace.finishes.length'), 0);
  const during = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL('egg2-mid-' + width + 'x' + height + '.png', art), Buffer.from(during.data, 'base64'));
  await evaluate(`document.querySelector('video.is-front').play()`);
  await until('__eggDone', '实际哈气结束后有界完成本次演出', 20000);
  const result = await evaluate(`({finishes:__eggTrace.finishes,final:__eggSample(),maxWidth:__eggWidth,
    early:__eggTrace.samples.filter(s=>s.p.name==='彩蛋-吉祥物-哈气-dshwe'&&s.p.phase==='playing'&&s.p.currentTime<1.75),
    shakeSamples:__eggTrace.samples.filter(s=>s.p.name==='彩蛋-吉祥物-哈气-dshwe'&&s.p.phase==='playing'&&(Math.abs(s.x)>.5||Math.abs(s.y)>.5)).length,
    active:!!__link.state.egg2Release,slow:__eggFrame.style.getPropertyValue('--ds-transition-duration-slow'),overflow:__eggSurface.style.overflow})`);
  assert.ok(result.early.length > 10, '实际视频张嘴前需要连续采样而非仅检查开头一帧');
  assert.ok(result.early.every(s => Math.abs(s.x) < .1 && Math.abs(s.y) < .1 && s.clip !== 'clip'), '1750毫秒前不得抖动或裁剪');
  assert.ok(result.shakeSamples > 5, '张嘴后整个GUI必须存在真实中间抖动帧');
  assert.equal(result.finishes.length, 1); assert.equal(result.finishes[0].before.p.phase, 'ended');
  assert.ok(Math.abs(result.finishes[0].after.width - result.maxWidth) < .2);
  assert.ok(Math.abs(result.final.x) < .1 && Math.abs(result.final.y) < .1);
  assert.equal(result.active, false); assert.equal(result.slow, '450ms'); assert.equal(result.overflow, 'visible');

  await evaluate(`__eggFrame.style.transition='none';__eggFrame.style.gridTemplateColumns='0px minmax(0,1fr) 0px';void __eggFrame.offsetWidth;__eggFrame.style.transition='grid-template-columns var(--ds-transition-duration-slow) linear';
    __eggTrace.finishes=[];__eggDone=false;void __link.tuner.run('egg2').then(()=>__eggDone=true);`);
  await until(`__dshPetCtl.getPlayback().name==='彩蛋-吉祥物-哈气-dshwe'&&__dshPetCtl.getPlayback().phase==='playing'&&__dshPetCtl.getPlayback().currentTime>2.1&&!!__link.state.egg2Release`, '第二次真实哈气中途退出');
  await evaluate('__cap.linkEnabled=false');
  await until(`!__link.eligible()&&__eggDone&&!__link.state.egg2Release`, '热撤销立即结束哈气特效');
  assert.deepEqual(await evaluate(`({finishes:__eggTrace.finishes.length,frames:__link.runtime.frames.size,x:__eggFrame.getBoundingClientRect().left,y:__eggFrame.getBoundingClientRect().top,slow:__eggFrame.style.getPropertyValue('--ds-transition-duration-slow'),overflow:__eggSurface.style.overflow})`),
    { finishes: 0, frames: 0, x: 0, y: 0, slow: '450ms', overflow: 'visible' });
  await evaluate('__cap.linkEnabled=true'); await until('__link.eligible()', '哈气取消后仍可无刷新恢复');
  console.log('PASS 真实哈气张嘴前无抖动或裁剪、张嘴后全GUI抖动，暂停冻结、ended同步、取消清理及五控件 ' + width + 'x' + height);
}
