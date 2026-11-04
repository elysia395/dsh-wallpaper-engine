/**
 * #257：真实浏览器验证输入卡视差不改变 fixed 浮层的视口锚点。
 * 复用 glass-runtime 的浏览器与真实构建产物，不复制视差算法，也不修改磁盘产物。
 * 覆盖已有/超限/晚挂载浮层、滚动、点击、居中与卸载；旧 translate 分支为负对照。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export async function verifyComposerFixedBrowser({ send, evaluate, until, check, screenshot, css, bundle }) {
  const parallax = readFileSync('packages/parallax/lib/client.parallax.js', 'utf8');
  const marker = '// ── 内联模块：src/we-base.js';
  const start = bundle.indexOf(marker);
  const end = bundle.indexOf('// ── 内联模块：', start + marker.length);
  assert.ok(start >= 0 && end > start, 'main bundle 必须含唯一 we-base 内联段');
  const base = bundle.slice(bundle.indexOf('\n', start), end);
  const offsetBranch = "return kind === 'sidebar' || kind === 'composer';";
  assert.equal(parallax.split(offsetBranch).length, 2, '负对照必须准确替换一次真实位移分支');
  const mutant = parallax.replace(offsetBranch, "return kind === 'sidebar';");
  const ownership = 'rec.rel = rec.rel === true || parallaxGroupNeedsRelative(el);';
  assert.equal(parallax.split(ownership).length, 2, '定位所有权负对照必须准确命中一次');
  const ownershipMutant = parallax.replace(ownership, 'rec.rel = parallaxGroupNeedsRelative(el);');
  const anchored = sample => Math.abs(sample.panel.x - sample.expectedX) < .5
    && Math.abs(sample.panel.y - 80) < .5;

  async function mount({ width, dpr, dark, scenario, source = parallax, position = 'relative' }) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: dpr, mobile: false });
    await send('Page.navigate', { url: 'about:blank' });
    await until('document.readyState === "complete"');
    await evaluate(`(() => {
      document.body.innerHTML='<div id="scroll" data-conversation-scroll><div id="messages">Conversation</div>'
        +'<div id="seat" data-composer-seat><div id="card" data-composer-card>Composer<div id="filler"></div></div></div></div>';
      document.body.setAttribute('data-we-glass-chat','on');
      document.body.setAttribute('data-we-glass-page','on');
      ${dark ? "document.body.setAttribute('data-ds-dark-theme','');" : ''}
      const fixture=document.createElement('style');
      fixture.textContent='body{margin:0;font:16px sans-serif;background:repeating-linear-gradient(45deg,#264653 0 40px,#2a9d8f 40px 80px)}'
        +'#scroll{position:absolute;inset:60px 20px 40px;overflow:auto;border:2px solid white}'
        +'#messages{height:1800px;padding:20px;background:#ffffff40}'
        +'#seat{position:sticky;bottom:0;padding:16px}'
        +'#card{position:${position};min-height:110px;border-radius:12px;padding:16px}'
        +'#panel{position:fixed;left:${width - 190}px;top:80px;width:160px;height:120px;z-index:1100;background:#f4a261}'
        +'#filler{display:none}';
      document.head.append(fixture);
      const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
      document.querySelector('#filler').innerHTML='<span></span>'.repeat(${scenario === 'large' ? 410 : 1});
      window.__clicks=0;
      window.__addPanel=()=>{
        document.querySelector('#card').insertAdjacentHTML('beforeend','<button id="panel">Viewport-fixed overlay</button>');
        document.querySelector('#panel').onclick=()=>__clicks++;
      };
      ${scenario !== 'late' ? '__addPanel();' : ''}
      const scroll=document.querySelector('#scroll');scroll.scrollTop=scroll.scrollHeight;
      window.__originalHeight=scroll.scrollHeight;
      window.__sample=()=>{
        const card=document.querySelector('#card'), panel=document.querySelector('#panel'), cs=getComputedStyle(card);
        return {panel:panel?.getBoundingClientRect().toJSON(),expectedX:${width - 190},
          card:card.getBoundingClientRect().toJSON(),translate:cs.translate,transform:cs.transform,willChange:cs.willChange,
          left:card.style.left,top:card.style.top,position:card.style.position,computedPosition:cs.position,
          blur:getComputedStyle(card,'::before').backdropFilter,scrollHeight:scroll.scrollHeight,
          originalHeight:__originalHeight,scrollTop:scroll.scrollTop};
      };
      ${base}
      const selection={parallaxEnabled:false,parallaxUi:true,parallaxBg:0,parallaxUiComposerDepth:1.8,parallaxSmooth:0};
      const host={selection,weNow,weClampTo,weBody,React:{},weT:s=>s,switchRow:()=>{},SliderRow:()=>{},
        registerExtensionModule:()=>{},registerLayerHooks:(_id,hooks)=>{window.__hooks=hooks;}};
      window.__selection=selection;
      window.__ModuleLoader__={load:({factory})=>factory(name=>{
        if(name!=='dsh-plugin-wallpaper-engine')throw Error('Unexpected dependency '+name);
        return host;
      })};
      ${source}
      return true;
    })()`);
  }

  const samples = [];
  for (const config of [
    { width: 375, dpr: 1, dark: false },
    { width: 1280, dpr: 1.25, dark: false },
    { width: 1280, dpr: 2, dark: true },
  ]) for (const scenario of ['small', 'large', 'late']) {
    // static 输入卡验证本层补的 relative 能归还；原生 relative 必须保持。
    const position = scenario === 'large' ? 'static' : 'relative';
    const tag = `composer ${config.width}/${config.dpr}/${config.dark ? 'dark' : 'light'}/${scenario}`;
    await mount({ ...config, scenario, position });
    if (scenario !== 'late') {
      const glassOnly = await evaluate('__sample()');
      check(tag + ' 伪元素霜本身不改变fixed锚点', anchored(glassOnly) && glassOnly.blur.includes('blur('), glassOnly);
    }
    await evaluate('__selection.parallaxEnabled=true;__hooks.sync()');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 780 });
    await until("!!document.querySelector('#card').style.left");
    if (scenario === 'late') await evaluate('__addPanel()');
    const sample = await evaluate('__sample()');
    samples.push({ tag, ...sample });
    check(tag + ' 输入卡确实移动但fixed不改锚、不增加滚动溢出',
      anchored(sample) && Math.abs(parseFloat(sample.left)) > 0 && sample.translate === 'none'
      && sample.transform === 'none' && sample.willChange === 'auto'
      && sample.scrollHeight === sample.originalHeight, sample);
    await evaluate("document.querySelector('#scroll').scrollTop-=120");
    const scrolled = await evaluate('__sample()');
    check(tag + ' 滚动后fixed仍钉在视口', anchored(scrolled) && scrolled.scrollTop < sample.scrollTop, scrolled);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: config.width - 170, y: 100, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: config.width - 170, y: 100, button: 'left', clickCount: 1 });
    check(tag + ' 浮层真实点击可达', await evaluate("__clicks===1 && document.activeElement.id==='panel'"));
    // 超过重扫节流窗再起帧：本层补的 relative 不能因计算值已是 relative 就丢掉所有权。
    if (position === 'static') {
      await evaluate('new Promise(resolve=>setTimeout(resolve,350))');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 12, y: 780 });
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      check(tag + ' 重扫后仍保留安全相对偏移', await evaluate("__sample().translate==='none' && __sample().position==='relative'"));
    }
    if (config.dpr === 1.25 && scenario === 'late') await screenshot('composer-fixed-after');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: config.width / 2, y: 410 });
    await until("!document.querySelector('#card').style.left && !document.querySelector('#card').style.top");
    const centered = await evaluate('__sample()');
    check(tag + ' 居中移除位移、保留玻璃', anchored(centered) && centered.translate === 'none'
      && centered.blur.includes('blur('), centered);
    await evaluate('__hooks.dispose();__hooks.dispose()');
    const disposed = await evaluate('__sample()');
    check(tag + ' 重复卸载归还定位、不残留位移', anchored(disposed) && !disposed.left && !disposed.top
      && !disposed.position && disposed.computedPosition === position, disposed);
  }

  for (const scenario of ['large', 'late']) {
    await mount({ width: 1280, dpr: 1.25, dark: false, scenario, source: mutant });
    await evaluate('__selection.parallaxEnabled=true;__hooks.sync()');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 780 });
    await until("getComputedStyle(document.querySelector('#card')).translate!=='none'");
    if (scenario === 'late') await evaluate('__addPanel()');
    const sample = await evaluate('__sample()');
    check('composer 负对照/' + scenario + '：恢复旧分支必须错锚且增加滚动溢出',
      !anchored(sample) && sample.scrollHeight > sample.originalHeight, sample);
    if (scenario === 'late') await screenshot('composer-fixed-before-negative-control');
    await evaluate('__hooks.dispose()');
  }
  await mount({ width: 1280, dpr: 1.25, dark: false, scenario: 'large', source: ownershipMutant, position: 'static' });
  await evaluate('__selection.parallaxEnabled=true;__hooks.sync()');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 780 });
  await until("document.querySelector('#card').style.position==='relative'");
  await evaluate('new Promise(resolve=>setTimeout(resolve,350))');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 12, y: 780 });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await evaluate('__hooks.dispose()');
  check('composer 负对照/所有权：丢弃rel记忆会在卸载后残留定位',
    await evaluate("__sample().position==='relative' && __sample().computedPosition==='relative'"));
  return { parallaxBundleSha256: createHash('sha256').update(parallax).digest('hex'), samples };
}
