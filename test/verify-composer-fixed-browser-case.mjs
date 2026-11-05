/**
 * #257：真实浏览器验证输入卡视差不改变 fixed 浮层的视口锚点。
 * 复用 glass-runtime 的浏览器与真实构建产物，不复制视差算法，也不修改磁盘产物。
 * 覆盖已有/超限/晚挂载浮层、滚动、点击、居中与卸载；旧 translate 分支为负对照。
 * 相对偏移仍会扩张正方向滚动边界；本用例保护 fixed 锚点，不承诺卡片永不溢出。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionBodyOf, stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// 用现有词法工具定位函数内的语句；注释复述实现不会破坏负对照。
function mutateStatement(source, header, before, after) {
  const code = stripComments(source);
  const body = functionBodyOf(code, header);
  assert.ok(body, '负对照必须找到函数 ' + header);
  const scopeStart = code.indexOf('{', code.indexOf(header) + header.length);
  const at = body.indexOf(before);
  assert.ok(at >= 0 && body.indexOf(before, at + before.length) < 0, '负对照必须命中唯一语句');
  const offset = scopeStart + at;
  return source.slice(0, offset) + after + source.slice(offset + before.length);
}

export async function verifyComposerFixedBrowser({ send, evaluate, until, check, screenshot, css, bundle, benchmark = false }) {
  const parallax = readFileSync(resolve(ROOT, 'packages/parallax/lib/client.parallax.js'), 'utf8');
  const marker = '// ── 内联模块：src/we-base.js';
  const start = bundle.indexOf(marker);
  const end = bundle.indexOf('// ── 内联模块：', start + marker.length);
  assert.ok(start >= 0 && end > start, 'main bundle 必须含唯一 we-base 内联段');
  const base = bundle.slice(bundle.indexOf('\n', start), end);
  const offsetBranch = "return kind === 'sidebar' || kind === 'composer';";
  const mutant = mutateStatement(parallax, 'function parallaxGroupOffsets(kind)', offsetBranch, "return kind === 'sidebar';");
  const ownership = 'rec.rel = rec.rel === true || parallaxGroupNeedsRelative(el);';
  const ownershipMutant = mutateStatement(parallax, 'function parallaxTargetAdd(', ownership, 'rec.rel = parallaxGroupNeedsRelative(el);');
  const comment = '\n// ' + offsetBranch + '\n';
  assert.equal(mutateStatement(parallax + comment, 'function parallaxGroupOffsets(kind)', offsetBranch,
    "return kind === 'sidebar';"), mutant + comment, '注释复述不影响负对照');
  const anchored = sample => Math.abs(sample.panel.x - sample.expectedX) < .5
    && Math.abs(sample.panel.y - 80) < .5;

  async function mount({ width, dpr, dark, scenario, source = parallax, position = 'relative', debug = false }) {
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
      window.__originalWidth=scroll.scrollWidth;
      window.__sample=()=>{
        const card=document.querySelector('#card'), panel=document.querySelector('#panel'), cs=getComputedStyle(card);
        return {panel:panel?.getBoundingClientRect().toJSON(),expectedX:${width - 190},
          card:card.getBoundingClientRect().toJSON(),translate:cs.translate,transform:cs.transform,willChange:cs.willChange,
          left:card.style.left,top:card.style.top,position:card.style.position,computedPosition:cs.position,
          blur:getComputedStyle(card,'::before').backdropFilter,scrollHeight:scroll.scrollHeight,
          scrollWidth:scroll.scrollWidth,originalWidth:__originalWidth,
          originalHeight:__originalHeight,scrollTop:scroll.scrollTop};
      };
      ${base}
      const selection={parallaxEnabled:false,parallaxUi:true,parallaxBg:0,parallaxUiComposerDepth:1.8,parallaxSmooth:0};
      // about:blank 没有可用存储；仅为可选基准开启产品自检，计时算法仍来自真实产物。
      const localStorage={getItem:()=>${debug ? "'1'" : 'null'}};
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
    check(tag + ' 输入卡确实移动但fixed不改锚（此手势纵轴不增高）',
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

  // 两轴 × 两方向：同一已移动卡片在挂载 fixed 前后必须有相同滚动范围。
  // 正向卡片本身的溢出保留；不以裁剪浮层、只许负偏移或改距离参数来隐藏它。
  const overflow = [];
  for (const axis of ['x', 'y']) for (const sign of [-1, 1]) {
    await mount({ width: 1280, dpr: 1.25, dark: false, scenario: 'late' });
    await evaluate(`(() => {
      document.querySelector('#seat').style.padding='0';
      const s=document.querySelector('#scroll');s.scrollTop=s.scrollHeight;
      __originalHeight=s.scrollHeight;__originalWidth=s.scrollWidth;
      __selection.parallaxEnabled=true;__hooks.sync();
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved',
      x: axis === 'x' ? (sign > 0 ? 10 : 1270) : 640,
      y: axis === 'y' ? (sign > 0 ? 10 : 810) : 410 });
    await until(`Math.sign(parseFloat(document.querySelector('#card').style.${axis === 'x' ? 'left' : 'top'}))===${sign}`);
    const withoutPanel = await evaluate('__sample()');
    await evaluate('__addPanel()');
    const withPanel = await evaluate('__sample()');
    const deltaWidth = withPanel.scrollWidth - withPanel.originalWidth;
    const deltaHeight = withPanel.scrollHeight - withPanel.originalHeight;
    const measurement = { axis, sign, deltaWidth, deltaHeight, withoutPanel, withPanel };
    overflow.push(measurement);
    check(`composer 溢出边界/${axis}/${sign}：fixed不改锚也不额外扩大两轴`,
      anchored(withPanel) && withPanel.scrollWidth === withoutPanel.scrollWidth
      && withPanel.scrollHeight === withoutPanel.scrollHeight, measurement);
    const delta = axis === 'x' ? deltaWidth : deltaHeight;
    check(`composer 溢出边界/${axis}/${sign}：${sign > 0 ? '正向偏移已知扩张' : '负向不扩张'}`,
      sign > 0 ? delta > 0 : delta === 0, measurement);
    await evaluate('__hooks.dispose()');
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
  const performanceSamples = [];
  if (benchmark) {
    // 不改产品算法：在原自检计时已结束后旁录原始 cost，计算未暴露的 p99。
    const timed = mutateStatement(parallax, 'function parallaxDebugFrame(', 'stats.frames += 1;',
      'window.__costSamples.push(cost); stats.frames += 1;');
    const percentile = (values, p) => {
      assert.ok(values.length > 0, '基准不能接受空样本');
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.round((sorted.length - 1) * p)];
    };
    await send('Performance.enable');
    // 交错运行，避免把预热或温度变化全部算到某一个目标身上。
    for (let round = 0; round < 3; round += 1) {
      const cases = [
        { kind: 'sidebar', nodes: 20 }, { kind: 'composer', nodes: 20 },
        { kind: 'sidebar', nodes: 410 }, { kind: 'composer', nodes: 410 },
      ];
      if (round % 2) cases.reverse();
      for (const config of cases) {
        await mount({ width: 1280, dpr: 1.25, dark: false, scenario: 'late', source: timed, debug: true });
        await evaluate(`(() => {
          const card=document.querySelector('#card'), filler=document.querySelector('#filler');
          ${config.kind === 'sidebar' ? "card.removeAttribute('data-composer-card');card.setAttribute('data-slot','sidebar');" : ''}
          // 同几何/同可见子树/同玻璃/同距离；只切换实际产品的分组入口。
          const style=document.createElement('style');
          style.textContent='#card{height:240px;overflow:visible}#card::before{content:"";position:absolute;inset:0;backdrop-filter:blur(12px);pointer-events:none}'
            +'#filler{display:grid;grid-template-columns:repeat(20,1fr);position:relative;font-size:9px}';
          document.head.append(style);
          filler.innerHTML='<span>node</span>'.repeat(${config.nodes});
          __selection.parallaxUiSidebarDepth=1.8;
          __selection.parallaxEnabled=true;window.__costSamples=[];__hooks.sync();
          window.__drive=async(count)=>{
            const gaps=[];let previous=0;
            for(let i=0;i<count;i++){
              const now=await new Promise(resolve=>requestAnimationFrame(resolve));
              if(previous)gaps.push(now-previous);previous=now;
              document.dispatchEvent(new PointerEvent('pointermove',{
                clientX:640+560*Math.sin(i*.17),clientY:410+330*Math.cos(i*.13),bubbles:true}));
            }
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            return gaps;
          };
        })()`);
        // 产品的自检开关每秒才读取；在高刷新率屏幕上 60 帧不足一秒。
        await evaluate('new Promise(resolve=>setTimeout(resolve,1100))');
        await evaluate('__drive(60)');
        await evaluate('__costSamples=[]');
        const before = await send('Performance.getMetrics');
        const gaps = await evaluate('__drive(300)');
        const after = await send('Performance.getMetrics');
        const costs = await evaluate('__costSamples');
        const groups = await evaluate('window.__weParallaxStats.groups');
        assert.equal(groups[config.kind], 1, '基准必须实际发现目标组');
        assert.equal(groups.offset, 1, '基准必须实际走相对偏移');
        assert.equal(groups[config.kind === 'sidebar' ? 'composer' : 'sidebar'], 0, '对照只切换一个目标组');
        const metric = (snapshot, name) => {
          const found = snapshot.metrics.find(item => item.name === name);
          assert.ok(found, 'CDP 缺少指标 ' + name);
          return found.value;
        };
        assert.ok(costs.length >= 290, '运动期间必须采集到真实视差帧：' + JSON.stringify({ ...config, frames: costs.length }));
        const sample = { ...config, round, groups, frames: costs.length,
          costMs: { p50: percentile(costs, .5), p99: percentile(costs, .99), max: Math.max(...costs) },
          gapMs: { p50: percentile(gaps, .5), p99: percentile(gaps, .99), max: Math.max(...gaps) },
          layoutMsPerFrame: 1000 * (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) / costs.length,
          styleMsPerFrame: 1000 * (metric(after, 'RecalcStyleDuration') - metric(before, 'RecalcStyleDuration')) / costs.length,
          costs, gaps };
        performanceSamples.push(sample);
        await evaluate('__hooks.dispose()');
      }
    }
    await send('Performance.disable');
  }
  return { parallaxBundleSha256: createHash('sha256').update(parallax).digest('hex'), samples, overflow, performanceSamples };
}
