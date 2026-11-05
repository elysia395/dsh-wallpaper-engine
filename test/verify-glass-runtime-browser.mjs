import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { cssBodyOf } from './tools/src-scope.mjs';
import { readabilityFloors } from './tools/readability-floors.mjs';
import { createHash } from 'node:crypto';
import { verifyPetSidebarGlassBrowser } from './verify-pet-sidebar-glass-browser-case.mjs';

const bundle = readFileSync(resolve('lib/client.js'), 'utf8');
// ADR-0016 第三刀：玻璃运行时（glass-surfaces / glass-extra）随玻璃包出产物 ⇒
// 模块提取面改读**玻璃包产物**（主 bundle 的 officialPull 等主包段仍读主产物）。
const glassBundle = readFileSync(resolve('packages/glass/lib/client.glass.js'), 'utf8');
// 可读性下限常量随玻璃 CSS 出户（ADR-0016 第四刀）⇒ 唯一读法在 test/tools/readability-floors.mjs
// （旧写法在这里硬编码 0.45 / 0.59：常量一改就静默对不上真注入的样式）。
const FLOOR = readabilityFloors();
const css = new Function('READABILITY_FLOOR', 'READABILITY_FLOOR_DARK', 'return `' + cssBodyOf(bundle + glassBundle) + '`;')(FLOOR.light, FLOOR.dark);
function moduleText(name) {
  // 子包产物的内联 marker 带**全路径**（packages/glass/src/<name>.js），与主 bundle 的 src/<name>.js 不同。
  const start = glassBundle.indexOf('// ── 内联模块：packages/glass/src/' + name + '.js');
  if (start < 0) return '';
  const end = glassBundle.indexOf('// ── 内联模块：', start + 10);
  return glassBundle.slice(glassBundle.indexOf('\n', start), end < 0 ? glassBundle.length : end);
}
const runtime = moduleText('glass-surfaces');
const extra = moduleText('glass-extra');
const out = resolve('.artifacts/glass-runtime');
mkdirSync(out, { recursive: true });
const browsers = process.platform === 'win32'
  ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const browser = process.env.WE_TEST_BROWSER || browsers.find(existsSync);
assert.ok(browser && existsSync(browser), '缺少 Chromium 浏览器；请用 WE_TEST_BROWSER 指定可执行文件，浏览器回归不会跳过。');
const profile = mkdtempSync(join(out, 'profile-'));
const browserLogPath = join(profile, 'browser-stderr.log');
const browserLog = openSync(browserLogPath, 'w');
// 用 `--remote-debugging-pipe` 而不是 `--remote-debugging-port=0`：就绪信号是管道收到第一条
// CDP 回复，不是轮询 `DevToolsActivePort` 文件。2026-11-04 的 ubuntu 腿实测过另一种形态：
// 浏览器进程活着、20 秒内却没写端口文件，一步就把整条链判红（`[27/103]` 短路）。
// 管道模式下"没起来"= fd 4 立刻 EOF，不必等满一个超时；没有 TCP 端口也就没有端口冲突一类故障。
let child;
try {
  child = spawn(browser, [
    '--headless=new', '--no-first-run', '--remote-debugging-pipe', '--user-data-dir=' + profile,
    ...(process.env.WE_TEST_BROWSER_LOG ? ['--enable-logging=stderr', '--log-level=0'] : []), 'about:blank',
  ], { stdio: ['ignore', 'ignore', process.env.WE_TEST_BROWSER_LOG ? 2 : browserLog, 'pipe', 'pipe'] });
} catch (error) {
  // 路径存在但不是可执行文件（spawn 在 Windows 上同步抛 EFTYPE/ENOEXEC）——按"没起来"报，不崩栈。
  assert.fail('浏览器无法启动（' + browser + '）：' + error.message);
}
closeSync(browserLog);
const launchDetails = () => JSON.stringify({ browser, exitCode: child.exitCode, signal: child.signalCode,
  stderr: readFileSync(browserLogPath, 'utf8').slice(-16384) });
let launchError, counter = 0, sessionId = null, pipeClosed = false;
const pending = new Map(), failures = [], report = [];
const toBrowser = child.stdio[3], fromBrowser = child.stdio[4];
// 管道先关时写会 EPIPE —— 由 pending 的 reject 表达失败，不额外抛。
toBrowser.on('error', () => {});
child.on('error', error => { launchError = error; });
function failPending(error) {
  for (const [id, item] of pending) { clearTimeout(item.timer); pending.delete(id); item.reject(error); }
}
let buffer = '';
fromBrowser.on('data', chunk => {
  buffer += chunk.toString('utf8');
  let at;
  while ((at = buffer.indexOf('\0')) >= 0) {
    const text = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (!text) continue;
    const event = JSON.parse(text), item = pending.get(event.id);
    if (!item) continue;
    clearTimeout(item.timer); pending.delete(event.id);
    if (event.error) item.reject(Error(JSON.stringify(event.error))); else item.resolve(event.result);
  }
});
fromBrowser.on('end', () => { pipeClosed = true; failPending(Error('浏览器管道已关闭：' + launchDetails())); });
child.on('exit', () => failPending(Error('浏览器进程已退出：' + launchDetails())));
function send(method, params = {}, timeoutMs = 15000) {
  if (launchError) return Promise.reject(launchError);
  if (pipeClosed) return Promise.reject(Error('浏览器管道已关闭：' + launchDetails()));
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('CDP timeout: ' + method + (sessionId ? '' : '（启动预算 ' + timeoutMs + 'ms 内无回复：' + launchDetails() + '）')));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    // 管道消息以 \0 分隔；attach 之后每条命令都带 sessionId（flat 会话）。
    toBrowser.write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + '\0');
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await delay(25);
  }
  throw Error('等待条件失败: ' + expression);
}
function check(name, passed, detail) {
  report.push({ name, passed, detail });
  if (!passed) failures.push(name + ': ' + JSON.stringify(detail));
  console.log((passed ? 'PASS' : 'FAIL') + ' | ' + name);
}
async function screenshot(name) {
  // 大面积 backdrop-filter 光栅化在 1280 视口上实测可到 1~10 秒（与新加的
  // 「动画跟随」判据无关；基线就有），15 秒的通用超时处在边缘 ⇒ 这里单独放宽。
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, 60000);
  writeFileSync(join(out, name + '.png'), Buffer.from(data, 'base64'));
  return data;
}
try {
  // 启动只认"浏览器自己回了第一条协议消息"这个事件，不回 = 没起来（不是判据失败）。
  // "没起来"的**快**信号是 fd 4 先 EOF（管道关、进程退），不是这个墙钟上限：CI 冷机上
  // 首条回复实测会超过 3 秒（2026-11-05 ubuntu 腿 3 秒整超时、同一提交另一条腿 0.3 秒），
  // 所以墙钟只兜"进程活着但永不说话"，放宽到 12 秒，可用 env 覆盖。
  const STARTUP_BUDGET = Number(process.env.WE_TEST_BROWSER_STARTUP_MS || 12000);
  // 启动阶段的两条命令失败一律转成 AssertionError：它们是"浏览器没连上"，不是判据结论。
  const startup = async (method, params) => {
    try { return await send(method, params, STARTUP_BUDGET); }
    catch (error) {
      assert.fail('浏览器未在 ' + STARTUP_BUDGET + 'ms 内建立 CDP 管道（' + method + '）：' + error.message);
    }
  };
  const { targetInfos } = await startup('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'page');
  assert.ok(target, '浏览器没有 page target：' + launchDetails());
  ({ sessionId } = await startup('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  assert.ok(sessionId, '浏览器未返回会话：' + launchDetails());
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const width of [320, 375, 414, 768, 1280]) for (const dark of [false, true]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'about:blank' });
    await until('document.readyState === "complete"');
    await evaluate(`(() => {
      document.documentElement.style.cssText='background:white';
      document.body.innerHTML='<div id="wall"></div><main id="app"><div id="left"><div data-slot="sidebar"><span>Sidebar</span><div id="modal" role="dialog" aria-modal="true"><section id="dialog-panel"><button id="modal-close">Close</button></section></div></div></div><section id="main"><button id="composer">Composer</button></section></main><aside id="right" data-sidebar-right-panel="push" data-sidebar-right-open><div data-dockkit-host="dock">Dock</div></aside><div id="unknown" class="extra"></div>';
      const fixture=document.createElement('style');fixture.textContent=
        'body{margin:0;font:16px sans-serif;--we-readability-floor:${dark ? FLOOR.dark : FLOOR.light};--we-surface-tint-light:#8fd0ff;--we-surface-tint-dark:#0d1524;--we-left-sidebar-alpha:.12;--we-left-sidebar-blur:14px;--we-sidebar-blur:14px;--we-sidebar-saturate:1.3;--we-sidebar-color:${dark ? '#151515' : '#ffffff'};--we-sidebar-tint:20%;--we-panel-color:${dark ? '#151515' : '#ffffff'};--we-panel-sheen-a:.1;--we-panel-sheen-b:.03;--we-panel-sheen-c:.05;--we-sidebar-sheen-a:.1;--we-sidebar-sheen-b:.03;--we-sidebar-sheen-c:.05;--we-sidebar-sheen:1;--we-blur:14px}' +
        '#wall{position:fixed;inset:0;z-index:-2;background:repeating-linear-gradient(90deg,#244f46 0 4px,#e6b929 4px 8px)}#app{display:flex;height:820px}#left{width:30%;height:100%;background:transparent}#main{flex:1;position:relative;z-index:1}#composer{position:fixed;left:38vw;top:150px;width:58vw;height:220px;background:#128a4d;border:0;z-index:10}#modal{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.25)}#dialog-panel{position:fixed;left:38vw;top:150px;width:58vw;height:220px;background:#b32235}#modal-close{position:absolute;left:12px;top:12px;width:90px;height:38px}#right{position:fixed;right:0;bottom:0;width:25%;height:180px}#unknown{position:fixed;left:10px;bottom:10px;width:30px;height:30px;z-index:20;background:#57a0e0}';
      document.head.append(fixture);
      const style=document.createElement('style');style.dataset.testBundle='on';style.textContent=${JSON.stringify(css)};document.head.append(style);
      document.body.setAttribute('data-we-glass-page','on');document.body.setAttribute('data-we-left-sidebar','on');document.body.setAttribute('data-we-sidebar-glass','on');
      ${dark ? "document.body.setAttribute('data-ds-dark-theme','');" : ''}
      // 左栏默认关（G1 左栏条款）：leftSidebarGlass 先 false，模态移除后显式开。
      window.__selection={leftSidebarGlass:false,sidebarGlass:true,extraGlassSelectors:'.extra'};
      window.__clicks={modal:0,composer:0};document.querySelector('#modal-close').onclick=()=>__clicks.modal++;document.querySelector('#composer').onclick=()=>__clicks.composer++;
      window.__frames=0;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=(callback)=>{__frames++;return raf(callback);};
      const sanitizeExtraGlassSelectors=value=>typeof value==='string' && /^\.[a-z]+$/.test(value)?value:'';
      ${runtime}\n${extra}
      window.__glass={sync:()=>syncExtraGlassCss(__selection),dispose:()=>disposeExtraGlassCss(),status:()=>typeof weGlassSurfaceStatus==='function'?weGlassSurfaceStatus():[]};
      __glass.sync();
      return true;
    })()`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const tag = (dark ? 'dark-' : 'light-') + width;
    // 两段配方解析器（t9-003 computed 取证）：与 packages/glass/src/glass-extra.js / src/styles-panel.js
    // 同构 —— base@readability-floor 叠 tint 段@settings-window-alpha×0.9。序列化兼容
    // rgba(...) 与 Chrome 新式 color(srgb r g b / a)。floor/tint 按 loop 的 dark 取值，
    // 与 fixture 注入一致；base 不再硬编码（t30 F1：#151515/#ffffff 与产品真源
    // src/styles-base.js/585 的 tint 链自相矛盾）—— 读解析后的 --we-readability-base，
    // 期望与真实级联同源；解析失败 ⇒ NaN 让 own-four 如实 FAIL（detail 带原始文本）。
    const hex1 = (h) => parseInt(h, 16) / 255;
    const floor = dark ? FLOOR.dark : FLOOR.light;
    const baseHex = await evaluate("getComputedStyle(document.body).getPropertyValue('--we-readability-base').trim()");
    const baseMatch = /^#([0-9a-fA-F]{6})$/.exec(baseHex);
    const tintHex = dark ? '0d1524' : '8fd0ff';
    const base = baseMatch ? [0, 2, 4].map((i) => hex1(baseMatch[1].slice(i, i + 2))) : [NaN, NaN, NaN];
    const tint = [hex1(tintHex.slice(0, 2)), hex1(tintHex.slice(2, 4)), hex1(tintHex.slice(4, 6))];
    const mixOut = (alpha) => { // 两段配方解析式：base@floor 上 tint 段@alpha×0.9
      const at = alpha * 0.9, a = floor + (1 - floor) * at;
      return { a, rgb: base.map((bc, i) => (bc * floor + tint[i] * (1 - floor) * at) / a) };
    };
    const parseColor = (str) => { // 兼容 rgba(...) 与 color(srgb ... / a) 两种序列化
      const rgba = String(str).match(/rgba?\(([^)]+)\)/);
      if (rgba) { const p = rgba[1].split(',').map(Number); return { a: p.length > 3 ? p[3] : 1, rgb: [p[0] / 255, p[1] / 255, p[2] / 255] }; }
      const srgb = String(str).match(/color\(srgb\s+([^)]+)\)/);
      if (srgb) { const p = srgb[1].replace('/', ' ').trim().split(/\s+/).map(Number); return { a: p.length > 3 ? p[3] : 1, rgb: [p[0], p[1], p[2]] }; }
      return { a: NaN, rgb: [NaN, NaN, NaN], raw: String(str) };
    };
    const close = (got, want) => Number.isFinite(got.a) && Math.abs(got.a - want.a) < 0.02 &&
      Math.abs(got.rgb[0] - want.rgb[0]) < 0.02 && Math.abs(got.rgb[1] - want.rgb[1]) < 0.02 && Math.abs(got.rgb[2] - want.rgb[2]) < 0.02;
    const state = await evaluate(`(() => {
      const el=document.querySelector('#modal-close'), rect=el.getBoundingClientRect(), left=getComputedStyle(document.querySelector('#left'));
      el.focus();return {hit:document.elementFromPoint(rect.x+20,rect.y+20)?.id,rect:rect.toJSON(),focus:document.activeElement.id,left:{z:left.zIndex,position:left.position,blur:left.backdropFilter},plates:document.querySelectorAll('[data-we-surface-plate]').length,status:__glass.status(),x:rect.x+20,y:rect.y+20};
    })()`);
    check(tag + ' 模态命中与fixed包含块', state.hit === 'modal-close' && state.left.z === 'auto' && state.left.blur === 'none' && Math.abs(state.rect.x - (width * .38 + 12)) < 1 && state.focus === 'modal-close', state);
    check(tag + ' 左栏默认关：不认领所有权且仅右栏plate（玻璃开关关=原生外观）', state.plates === 1 && !await evaluate(`document.querySelector('#left').hasAttribute('data-we-surface-runtime')`), state);
    // 宿主可能同时保留另一份“在布局里但未展开”的右栏面板（fullscreen/push 或旧会话）；
    // 当前展开的那份仍必须被认领，不能被 rightLive.length !== 1 整体否掉。
    await evaluate(`(() => {
      const extra = document.createElement('div');
      extra.id = 'extra-right-panel';
      extra.setAttribute('data-sidebar-right-panel', 'push');
      extra.style.cssText = 'position:fixed;right:0;top:0;width:160px;height:420px;';
      document.body.append(extra);
      __glass.sync();
      return true;
    })()`);
    check(tag + ' 可见但未展开的第二份右栏面板不否定当前展开面板', await evaluate(`document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar' && !!document.querySelector('[data-we-surface-plate="right-sidebar"]') && !document.querySelector('#extra-right-panel').hasAttribute('data-we-surface-runtime')`));
    await evaluate("document.querySelector('#extra-right-panel').remove();__glass.sync()");
    // 负对照：没有 data-we-nudge 的静态 transform 仍须回退原生，豁免不能被放宽成通用后门。
    await evaluate(`(() => {
      const p = document.querySelector('#right');
      p.style.transform = 'translateX(1px)';
      __glass.sync();
      return true;
    })()`);
    check(tag + ' 无 nudge 标记的静态 transform 仍回退原生', await evaluate(`!document.querySelector('#right').hasAttribute('data-we-surface-runtime') && !document.querySelector('[data-we-surface-plate="right-sidebar"]')`));
    await evaluate("document.querySelector('#right').style.removeProperty('transform');__glass.sync()");
    // HMR / 行重挂可能留下另一份模块实例的装饰根与 plate；sync 必须只保留当前根，
    // 否则多层同几何 backdrop-filter 叠加 = 右栏对应位置壁纸对比度/饱和度爆表。
    await evaluate(`(() => {
      for (let i = 0; i < 3; i += 1) {
        const root = document.createElement('div');
        root.setAttribute('data-we-surface-root', 'v1');
        root.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none';
        const plate = document.createElement('div');
        plate.setAttribute('data-we-surface-plate', 'right-sidebar');
        plate.style.cssText = 'position:absolute;left:0;top:0;width:40px;height:40px';
        root.append(plate);
        document.body.append(root);
      }
      __glass.sync();
      return true;
    })()`);
    check(tag + ' 孤儿装饰根/plate 被收口为当前唯一一份', await evaluate(`document.querySelectorAll('[data-we-surface-root]').length === 1 && document.querySelectorAll('[data-we-surface-plate="right-sidebar"]').length === 1 && document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar'`));
    // 别的实例/旧清理把当前装饰根摘掉时，marker 仍在；下一次 sync 必须把 root+plate
    // 一起重建（旧 plate 记录指向断开节点，不能只留 marker 不画玻璃）。
    await evaluate(`(() => {
      document.querySelectorAll('[data-we-surface-root]').forEach(x => x.remove());
      __glass.sync();
      return true;
    })()`);
    check(tag + ' 装饰根被外部摘掉后按 marker 重建 root/plate', await evaluate(`document.querySelectorAll('[data-we-surface-root]').length === 1 && document.querySelectorAll('[data-we-surface-plate="right-sidebar"]').length === 1 && document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar'`));
    // 旧版微推泄漏的 translateZ(0)+will-change（没有 data-we-nudge 归属）要自动清掉，
    // 否则 safeRoot 会被永远判死、右栏退回纯色。
    await evaluate(`(() => {
      const p = document.querySelector('#right');
      p.style.transform = 'translateZ(0px)';
      p.style.willChange = 'transform';
      __glass.sync();
      return true;
    })()`);
    check(tag + ' 旧微推泄漏的内联 translateZ(0) 自动清理并恢复认领', await evaluate(`(() => { const p = document.querySelector('#right'); return !p.style.transform && !p.style.willChange && p.getAttribute('data-we-surface-runtime')==='right-sidebar'; })()`));
    // 合成微推（nudge）两帧内会给宿主右栏写 translateZ(0)/will-change；带 data-we-nudge
    // 时只豁免 target 自身，不能因此把右栏判成 unsafe-root 而退回纯色。
    await evaluate(`(() => {
      const p = document.querySelector('#right');
      p.setAttribute('data-we-nudge', 'on');
      p.style.transform = 'translateZ(0)';
      p.style.willChange = 'transform';
      __glass.sync();
      return true;
    })()`);
    check(tag + ' 合成微推两帧内右栏仍可认领（data-we-nudge 只豁免 target 自身）', await evaluate(`document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar'`));
    await evaluate(`(() => {
      const p = document.querySelector('#right');
      p.removeAttribute('data-we-nudge');
      p.style.removeProperty('transform');
      p.style.removeProperty('will-change');
      __glass.sync();
      return true;
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', clickCount: 1 });
    check(tag + ' 点击未穿透到composer', await evaluate('__clicks.modal===1 && __clicks.composer===0'), await evaluate('__clicks'));
    const shot = await screenshot(tag);
    const pixel = await evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${shot}';await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(Math.round(innerWidth*.65),300,1,1).data];})()`);
    check(tag + ' 模态像素未被底层输入区覆盖', pixel[0] > 120 && pixel[0] > pixel[1] * 2, pixel);
    if (runtime) {
      // 左栏显式开（G1）：selection 提交走产品真实接线（effects→syncExtraGlassCss），
      // observer 自动消费场景只在后续 DOM 变化（多 right/fullscreen 回撤）上取证。
      await evaluate('__selection.leftSidebarGlass=true;__glass.sync()');
      await until('document.querySelectorAll("[data-we-surface-plate=left-sidebar]").length===1');
      await evaluate("document.querySelector('#modal').remove();__glass.sync()");
      await until('document.querySelectorAll("[data-we-surface-plate]").length>=1');
      // #272：<1100px 的折叠抽屉里装饰板 backdrop-filter 采样不到（宿主 transform），
      // 产品政策是「近不透明兜底 + 显式关掉不会生效的模糊」；宽视口仍是 blur 载体。
      const carrier = await evaluate(`(()=>{
        const plate=document.querySelector('[data-we-surface-plate="left-sidebar"]');
        if(!plate) return {ok:false, why:'no-plate'};
        const w=plate.getBoundingClientRect().width;
        const cs=getComputedStyle(plate);
        const narrow=window.matchMedia('(max-width: 1100px)').matches;
        if(plate.children.length!==0 || w<=20) return {ok:false, why:'geometry', w, kids:plate.children.length};
        if(!narrow) return {ok:cs.backdropFilter.includes('blur('), why:'wide', bf:cs.backdropFilter};
        if(cs.backdropFilter!=='none') return {ok:false, why:'narrow-bf', bf:cs.backdropFilter};
        const seat=document.querySelector('[data-slot="sidebar"]');
        const col=seat && seat.parentElement;
        const bg=col && getComputedStyle(col).backgroundColor;
        const m=/rgba?\\(([^)]+)\\)/.exec(bg||'');
        const parts=m ? m[1].split(',').map(Number) : [];
        const slash=/\\/\\s*([0-9.]+)\\s*\\)/.exec(bg||'');
        const alpha=parts.length===4 ? parts[3] : (parts.length===3 ? 1 : (slash ? Number(slash[1]) : 0));
        return {ok:alpha>=0.9, why:'narrow', seat:!!seat, bg, alpha};
      })()`);
      check(tag + ' 安全侧栏玻璃实际载体存在（宽视口 blur / 窄视口近不透明兜底）', Boolean(carrier && carrier.ok), JSON.stringify(carrier));
      // 宿主（ui-sidebar-right 的 RightbarRoot）给**每个被保留的会话**各渲染一份右栏面板，
      // 非当前会话那份在 `.session[hidden]` 里。旧判据按全文档 NodeList 长度要求"恰好一份"
      // ⇒ 用户开过第二个会话后右栏永远不接管、整块退回原生不透明底。隐藏的兄弟不得参与竞争。
      await evaluate(`(() => {
        const wrap=document.createElement('div');wrap.id='ghost-session';wrap.hidden=true;
        const ghost=document.createElement('aside');ghost.id='ghost-right';ghost.setAttribute('data-sidebar-right-panel','push');ghost.setAttribute('data-sidebar-right-open','');
        ghost.style.cssText='position:fixed;right:0;bottom:0;width:25%;height:180px';
        wrap.append(ghost);document.body.append(wrap);__glass.sync();return true;
      })()`);
      await until('!!document.querySelector("[data-we-surface-plate=right-sidebar]")');
      check(tag + ' 隐藏会话的右栏面板不夺走接管资格', await evaluate(`document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar' && !document.querySelector('#ghost-right').hasAttribute('data-we-surface-runtime') && !!document.querySelector('[data-we-surface-plate="right-sidebar"]')`));
      await evaluate("document.querySelector('#ghost-session').remove();__glass.sync()");
      // Blink 布局以 1/64 CSS px 量化；用可精确表达的 1/8 px，避免 0.0001px 被取整。
      await evaluate(`(() => {
        const wrap=document.createElement('div');wrap.id='clip-wrap';
        wrap.style.cssText='position:fixed;top:0;left:0;width:'+(innerWidth-0.125)+'px;height:'+innerHeight+'px;overflow:hidden';
        document.body.append(wrap);
        const right=document.querySelector('#right');
        right.style.width='25%'; right.style.height='180px';
        wrap.append(right);
        __glass.sync();return true;
      })()`);
      for (const scale of [1, 1.25, 1.5]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: scale, mobile: false });
        await evaluate("document.querySelector('#clip-wrap').style.width=(innerWidth-0.125)+'px';__glass.sync()");
        const subpixel = await evaluate(`(()=>{const r=document.querySelector('#right'),w=document.querySelector('#clip-wrap');return {delta:r.getBoundingClientRect().right-w.getBoundingClientRect().right,rt:r.getAttribute('data-we-surface-runtime'),plate:!!document.querySelector('[data-we-surface-plate="right-sidebar"]')};})()`);
        check(tag + ' DPR ' + scale + ' 祖先裁剪差 0.125px 仍接管',
          Math.abs(subpixel.delta - 0.125) < 0.001 && subpixel.rt === 'right-sidebar' && subpixel.plate,
          subpixel);
        await evaluate("document.querySelector('#clip-wrap').style.width=(innerWidth-2)+'px';__glass.sync()");
        const clipped = await evaluate(`(()=>{const r=document.querySelector('#right'),w=document.querySelector('#clip-wrap');return {delta:r.getBoundingClientRect().right-w.getBoundingClientRect().right,rt:r.getAttribute('data-we-surface-runtime'),plate:!!document.querySelector('[data-we-surface-plate="right-sidebar"]')};})()`);
        check(tag + ' DPR ' + scale + ' 负对照：真裁掉 2px 仍回退原生',
          Math.abs(clipped.delta - 2) < 0.001 && clipped.rt !== 'right-sidebar' && !clipped.plate,
          clipped);
      }
      await send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: false });
      // 复原夹具：面板回到 #app 下，裁剪包装移除。
      await evaluate(`(() => {
        const wrap=document.querySelector('#clip-wrap'), app=document.querySelector('#app'), right=document.querySelector('#right');
        app.append(right); wrap.remove(); __glass.sync(); return true;
      })()`);
      await until('document.querySelector("#right").getAttribute("data-we-surface-runtime")==="right-sidebar"');
      // ── 宿主开合侧栏时的**祖先动画**（用户报障："侧边栏弹出时会出现丢失左右两侧的
      //    玻璃效果…只出现在过程中"）──────────────────────────────────────────────
      // 真实来源：ui-layout 的 AppFrame 在 `.frame[data-animating]` 上做
      // `transition: grid-template-columns`，而 frame 是左右两侧栏共同的祖先。
      // 旧判据把"祖先链上有任何 getAnimations()"当成 unsafeRoot ⇒ 动画期间两侧同时
      // 退回原生、底板被撤掉，动画结束才回来。这里用**同样的机制**复现（grid 列宽过渡，
      // 不是 transform —— transform 会把目标移出视口，那是合理的原生回退）。
      await evaluate(`(() => {
        const right=document.querySelector('#right');
        document.querySelector('#app').append(right);   // 让两侧栏落在同一祖先之下
        const st=document.createElement('style');st.id='motion';st.textContent=
          '#app{display:grid;grid-template-columns:30% minmax(0,1fr);animation:weTrack 1200ms ease-out}'+
          '@keyframes weTrack{from{grid-template-columns:38% minmax(0,1fr)}to{grid-template-columns:30% minmax(0,1fr)}}';
        document.head.append(st);__glass.sync();return true;
      })()`);
      await until('document.querySelector("#app").getAnimations().length>0');
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      check(tag + ' 祖先有限动画期间两侧仍接管（玻璃不闪退）', await evaluate(`(()=>{
        const l=document.querySelector('[data-we-surface-runtime="left-sidebar"]');
        const r=document.querySelector('#right');
        return !!l && r.getAttribute('data-we-surface-runtime')==='right-sidebar'
          && !!document.querySelector('[data-we-surface-plate="left-sidebar"]')
          && !!document.querySelector('[data-we-surface-plate="right-sidebar"]');
      })()`));
      // 底板必须跟着动画中的几何走：等目标宽度真的变了（说明动画在推进），
      // 同一时刻底板宽度必须与目标一致（不跟就会停在动画起点）。
      const plateFollow = await evaluate(`(async()=>{
        const plate=()=>document.querySelector('[data-we-surface-plate="left-sidebar"]');
        const target=()=>document.querySelector('#left');
        const w0=target().getBoundingClientRect().width;
        const deadline=performance.now()+1200;
        while (performance.now()<deadline) {
          await new Promise(r=>requestAnimationFrame(r));
          const tw=target().getBoundingClientRect().width;
          if (Math.abs(tw-w0)>2) {
            const pw=plate().getBoundingClientRect().width;
            return { w0, target:tw, plate:pw, diff:Math.abs(pw-tw), changed:true };
          }
        }
        return { w0, target:w0, plate:plate().getBoundingClientRect().width, diff:0, changed:false };
      })()`);
      check(tag + ' 动画期间底板跟住几何', plateFollow.changed === true && plateFollow.diff < 1.5, plateFollow);
      await until('document.querySelector("#app").getAnimations().length===0');
      check(tag + ' 动画结束后仍接管（不是动画结束才回来）', await evaluate(`document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar' && !!document.querySelector('[data-we-surface-plate="right-sidebar"]')`));
      await delay(140);
      const stillFrames = await evaluate('__frames');
      await delay(140);
      check(tag + ' 动画结束后停止续帧', await evaluate(`__frames===${stillFrames}`), { before: stillFrames, after: await evaluate('__frames') });
      await evaluate(`(() => {
        document.getElementById('motion').remove();
        document.body.append(document.querySelector('#right'));
        document.querySelector('#app').removeAttribute('style');
        __glass.sync();return true;
      })()`);
      await until('!!document.querySelector("[data-we-surface-plate=right-sidebar]")');
      await evaluate("document.querySelector('#left').style.width='25%'");
      await until('Math.abs(document.querySelector("[data-we-surface-plate=left-sidebar]").getBoundingClientRect().width-document.querySelector("#left").getBoundingClientRect().width)<1');
      // 多 right 节点（G1 历史栏位）：后台保留节点（无 open 属性）+ 活动节点。
      // 可见但未展开的后台节点**不应**否定当前展开面板；只有两份都展开时才保守放弃。
      await evaluate(`(() => {
        const dock=document.createElement('aside');
        dock.id='right-bg';dock.setAttribute('data-sidebar-right-panel','push');
        dock.style.cssText='position:fixed;left:0;bottom:0;width:20%;height:80px;background:#5c4a9e';
        dock.innerHTML='<div data-dockkit-host="dock">BG</div>';
        document.body.append(dock);return true;
      })()`);
      await until('!!document.querySelector("[data-we-surface-plate=right-sidebar]")');
      check(tag + ' 多right：后台保留节点未展开不否定活动右栏', await evaluate(`(()=>{const r=document.querySelector('#right'),p=document.querySelector('#right-bg');return r.getAttribute('data-we-surface-runtime')==='right-sidebar' && !!document.querySelector('[data-we-surface-plate=right-sidebar]') && !p.hasAttribute('data-we-surface-runtime');})()`));
      await evaluate("document.querySelector('#right-bg').setAttribute('data-sidebar-right-open','')");
      await until('!document.querySelector("[data-we-surface-plate=right-sidebar]") && !document.querySelector("#right").hasAttribute("data-we-surface-runtime")');
      check(tag + ' 多right：两份都展开时保守放弃认领', await evaluate(`(()=>{const r=document.querySelector('#right'),p=document.querySelector('#right-bg');return !r.hasAttribute('data-we-surface-runtime') && !p.hasAttribute('data-we-surface-runtime') && !document.querySelector('[data-we-surface-plate=right-sidebar]');})()`));
      await evaluate("document.querySelector('#right-bg').removeAttribute('data-sidebar-right-open')");
      await until('!!document.querySelector("[data-we-surface-plate=right-sidebar]")');
      check(tag + ' 多right：后台节点收起后唯一展开右栏恢复所有权（observer 自动）', await evaluate(`document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar'`));
      await evaluate("document.querySelector('#right-bg').remove()");
      await until('!!document.querySelector("[data-we-surface-plate=right-sidebar]")');
      await evaluate("document.querySelector('#right').removeAttribute('data-sidebar-right-open')");
      await until('!document.querySelector("[data-we-surface-plate=right-sidebar]")');
      check(tag + ' 收起右栏无残板', true);
      // 收起→重新展开（observer 自动恢复 plate），后续 fullscreen 段需要 open 右栏在场。
      await evaluate("document.querySelector('#right').setAttribute('data-sidebar-right-open','')");
      await until('!!document.querySelector("[data-we-surface-plate=right-sidebar]")');
      await evaluate("document.body.setAttribute('data-we-glass-fallback','on')");
      await until('getComputedStyle(document.querySelector("[data-we-surface-plate=left-sidebar]")).backdropFilter==="none"');
      check(tag + ' 软件回退不留下模糊', true);
      // 软渲档 extra 面（t9-001 的浏览器级证据）：marker 跟走为 extra-fallback、
      // ::before 霜被门摘掉（frost 不该留在软渲环境），玻璃页别名块照样工作。
      await until('document.querySelector("#unknown").getAttribute("data-we-surface-runtime")==="extra-fallback"');
      check(tag + ' 软渲档 extra 标记跟走为 extra-fallback 且无霜', await evaluate(`(()=>{const b=getComputedStyle(document.querySelector('#unknown'),'::before');return b.backdropFilter==='none' && document.querySelector('#unknown').getAttribute('data-we-surface-runtime')==='extra-fallback';})()`));
      await evaluate("document.body.removeAttribute('data-we-glass-fallback');__glass.sync()");
      await until('document.querySelector("#unknown").getAttribute("data-we-surface-runtime")==="extra"');
      check(tag + ' 软渲解除 extra 标记切回 extra 且霜恢复（双向跟走）', await evaluate(`getComputedStyle(document.querySelector('#unknown'),'::before').backdropFilter.includes('blur(')`));
      await evaluate("document.body.removeAttribute('data-we-glass-fallback');document.querySelector('#unknown').setAttribute('data-we-surface-preserve','')");
      await until('!document.querySelector("#unknown").hasAttribute("data-we-surface-runtime")');
      check(tag + ' preserve声明撤销额外载体', await evaluate('getComputedStyle(document.querySelector("#unknown")).backgroundColor==="rgb(87, 160, 224)"'));
      await evaluate("document.querySelector('#unknown').removeAttribute('data-we-surface-preserve');__glass.sync();__glass.sync()");
      check(tag + ' 额外载体重复同步仍由同一所有者管理', await evaluate(`document.querySelector('#unknown').getAttribute('data-we-surface-runtime')==='extra' && getComputedStyle(document.querySelector('#unknown'),'::before').backdropFilter.includes('blur(')`));
      await evaluate("document.querySelector('#unknown').style.zIndex='auto';__glass.sync()");
      check(tag + ' 未知且无安全上下文目标完整保留原生', await evaluate(`!document.querySelector('#unknown').hasAttribute('data-we-surface-runtime') && getComputedStyle(document.querySelector('#unknown'),'::before').content==='none' && getComputedStyle(document.querySelector('#unknown')).backgroundColor==='rgb(87, 160, 224)'`));
      await evaluate("document.querySelector('#unknown').style.zIndex='20';document.querySelector('#unknown').style.setProperty('--occupied-content','1');const tag=document.createElement('style');tag.id='occupied';tag.textContent='#unknown::before{content:\"native\"}';document.head.append(tag);__glass.sync()");
      check(tag + ' 已有伪元素不被额外雾化覆盖', await evaluate(`!document.querySelector('#unknown').hasAttribute('data-we-surface-runtime') && getComputedStyle(document.querySelector('#unknown'),'::before').content==='"native"'`));
      await evaluate("document.querySelector('#occupied').remove();__selection.glassSurfacePolicy={'left-sidebar':'native'};__glass.sync()");
      check(tag + ' 单面原生策略撤销绘制和所有权', await evaluate(`!document.querySelector('[data-we-surface-plate="left-sidebar"]') && !document.querySelector('#left').hasAttribute('data-we-surface-runtime')`));
      await evaluate("__selection.glassSurfacePolicy={};document.querySelector('#app').style.transform='translateX(1px)';__glass.sync()");
      check(tag + ' 变换祖先回退原生不在错误坐标画底板', await evaluate(`!document.querySelector('[data-we-surface-plate="left-sidebar"]') && !document.querySelector('#left').hasAttribute('data-we-surface-runtime')`));
      await evaluate("document.querySelector('#app').style.transform='none';document.querySelector('#app').setAttribute('data-we-surface-preserve','');__glass.sync()");
      check(tag + ' 祖先preserve声明优先于内建适配器', await evaluate(`!document.querySelector('#left').hasAttribute('data-we-surface-runtime')`));
      await evaluate("document.querySelector('#app').removeAttribute('data-we-surface-preserve');__glass.sync()");
      await until('!!document.querySelector("[data-we-surface-plate=left-sidebar]")');
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
      await evaluate('window.__steadyFrames=__frames');
      await delay(150);
      check(tag + ' 静止不持续安排帧扫描', await evaluate('__frames===__steadyFrames'), await evaluate('({frames:__frames,steady:__steadyFrames})'));
      await evaluate(`document.querySelector('#left').style.zIndex='0';document.querySelector('#left').style.position='relative';document.querySelector('#left').innerHTML='<div data-slot="sidebar"><div id="negative" style="position:fixed;inset:0;z-index:1000;background:#b32235"></div></div>'`);
      check(tag + ' 种回旧围栏的负对照能失败', await evaluate('document.elementFromPoint(innerWidth*.65,300).id==="composer"'));
      await evaluate('__glass.dispose()');
      check(tag + ' 卸载成对清理', await evaluate('document.querySelectorAll("[data-we-surface-plate],[data-we-surface-runtime],[data-we-surface-root]").length===0'));
      await evaluate('window.__endFrames=__frames;document.body.append(document.createElement("section"))');
      await delay(100);
      check(tag + ' 卸载后无监听残留更新', await evaluate('__frames===__endFrames'));
      // 行级开关不会重载页面：上一轮若留下装饰根/运行标记，重新同步必须从干净状态开始。
      await evaluate(`(() => {
        const orphan = document.createElement('div');
        orphan.id = 'orphan-surface-root';
        orphan.setAttribute('data-we-surface-root', 'v1');
        document.body.append(orphan);
        document.querySelector('#left').setAttribute('data-we-surface-runtime', 'left-sidebar');
        return true;
      })()`);
      await evaluate('__glass.sync()');
      check(tag + ' 行开关重启：旧装饰根/标记清掉后只重建一层', await evaluate(`!document.querySelector('#orphan-surface-root') && document.querySelectorAll('[data-we-surface-root]').length<=1`));
      await evaluate('__glass.dispose()');
      // 行停用期间右栏被关掉再打开，随后重新启用玻璃：必须仍认领右栏并重建底板。
      await evaluate("document.querySelector('#right').removeAttribute('data-sidebar-right-open');__glass.dispose()");
      await evaluate("document.querySelector('#right').setAttribute('data-sidebar-right-open','');__glass.sync()");
      check(tag + ' 停用期间重开右栏，重新启用仍认领玻璃面', await evaluate(`document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar' && !!document.querySelector('[data-we-surface-plate="right-sidebar"]')`));
      // 更贴近真实行开关：停用期间撤 gates + 玻璃样式表，打开右栏，再回注并重新启用。
      await evaluate(`(() => {
        const style = document.querySelector('style[data-test-bundle="on"]');
        window.__savedGlassStyle = style;
        document.body.removeAttribute('data-we-glass-page');
        document.body.removeAttribute('data-we-sidebar-glass');
        document.body.removeAttribute('data-we-left-sidebar');
        if (style) style.remove();
        __glass.dispose();
        const right = document.querySelector('#right');
        right.removeAttribute('data-sidebar-right-open');
        right.setAttribute('data-sidebar-right-open', '');
        return __glass.status();
      })()`);
      const rowCycleStatus = await evaluate(`(() => {
        document.head.append(window.__savedGlassStyle);
        document.body.setAttribute('data-we-glass-page', 'on');
        document.body.setAttribute('data-we-sidebar-glass', 'on');
        __glass.sync();
        return __glass.status();
      })()`);
      check(tag + ' 完整行开关循环后右栏认领', await evaluate(`document.querySelector('#right').getAttribute('data-we-surface-runtime')==='right-sidebar' && !!document.querySelector('[data-we-surface-plate="right-sidebar"]')`), rowCycleStatus);
      check(tag + ' 合成微推不把内联 transform/will-change 写进宿主右栏', await evaluate(`(() => { const p = document.querySelector('#right'); return !p.style.transform && !p.style.willChange; })()`), await evaluate(`({ transform: document.querySelector('#right').style.transform, willChange: document.querySelector('#right').style.willChange })`));
      await evaluate('__glass.dispose()');
    }
    await evaluate(`(() => {
      document.body.innerHTML='<div id="wall"></div><section id="settings" role="dialog" aria-modal="true"><div data-slot="settings.section" id="settings-layout"><section id="plugin-native"><button id="native-button">Native</button><div id="warning">Warning</div></section><section id="declared" data-we-surface="v1"><div data-we-surface-layout id="layout">Layout<div data-we-surface-preserve id="keep">Preserve<div data-we-surface-layout id="preserve-child">Keep</div></div><section data-we-surface="v1" id="nested"><div data-we-surface-layout id="nested-layout">Nested</div></section></div></section><button id="nested-modal" style="position:fixed;left:10px;top:20px;z-index:1001">Nested</button></div></section><aside data-sidebar-right-panel="push" data-sidebar-right-open id="content-dock"><div class="cm-editor" id="editor"><span id="syntax" style="color:rgb(197,104,228)">Syntax</span><div class="cm-selectionBackground" id="selection"></div></div><div id="preview" data-we-surface="v1"><div data-we-surface-layout>Preview</div></div></aside><div id="own-host"><div class="we-picker" id="own-picker"><div class="we-tabs" id="own-tabs"><button class="we-tabs__tab">Library</button></div><div class="we-picker__current" id="own-current"><span class="we-picker__current-title">Current</span></div><div class="we-picker__uploads" id="own-uploads"><span>Upload</span></div><div class="we-ext" id="own-ext"><div class="we-ext__module" id="own-module"><span class="we-ext__module-title">Module</span></div></div></div><button class="we-rope" id="rope">Rope</button><div class="we-update-notice" id="notice">Notice</div>';
      const fixture=document.createElement('style');fixture.id='compat-fixture';fixture.textContent=
        'body{--dsw-alias-bg-layer-1:rgb(246,246,246);--dsw-alias-bg-layer-2:rgb(241,242,243);--dsw-alias-bg-layer-3:rgb(225,226,227);--dsw-alias-label-primary:#151515;--we-settings-window-blur:14px;--we-settings-window-alpha:.15;--we-readability-floor:${dark ? '0.59' : '0.45'};--we-surface-tint-light:#8fd0ff;--we-surface-tint-dark:#0d1524}' +
        '#settings{position:fixed;z-index:1000;left:5vw;top:100px;width:90vw;height:500px;overflow:auto;background:var(--dsw-alias-bg-layer-2)}#settings-layout{background:var(--dsw-alias-bg-layer-1)}#plugin-native{background:#fff}#native-button{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}#warning{background:rgb(244,180,40)}#declared{position:relative;z-index:1;background:white}#layout,#keep,#preserve-child,#nested-layout{background:rgb(222,223,224)}#content-dock{position:fixed;bottom:0;right:0;width:40vw;height:150px}#content-dock[data-sidebar-right-panel="fullscreen"]{--dsh-dockkit-dock-layer:40}#own-host{--dsw-alias-bg-layer-1:rgb(0,0,0);--dsw-alias-bg-layer-2:rgb(0,0,0);--dsw-alias-bg-layer-3:rgb(0,0,0)}#own-current{position:fixed;left:12px;top:40px;width:220px;height:60px;background:var(--dsw-alias-bg-layer-1)}#own-module{position:fixed;left:12px;top:110px;width:220px;height:60px;background:var(--dsw-alias-bg-layer-1)}#editor{background:#fff;height:80px}#selection{background:rgb(60,80,160);height:8px}#rope{left:10px;top:20px}#notice{bottom:30px;left:40px}';
      document.head.append(fixture);document.body.setAttribute('data-we-glass-window','on');document.body.setAttribute('data-we-glass-floaters','on');
      document.querySelector('#plugin-native').className='thirdparty_root';document.querySelector('#warning').className='thirdparty_frame';
      const host=document.createElement('div');host.id='root';host.innerHTML='<div class="host_frame" id="host-frame"><div class="host_root" id="host-root"></div></div>';document.body.append(host);
      document.querySelector('#host-frame').style.background='rgb(20,30,40)';document.querySelector('#host-root').style.background='rgb(30,40,50)';
      document.body.setAttribute('data-we-wallpaper','on');document.body.setAttribute('data-we-adapter','browser');
      __selection={sidebarGlass:true};__glass.sync();return true;
    })()`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const compat = await evaluate(`(()=>{const s=id=>getComputedStyle(document.getElementById(id));const r=document.querySelector('#nested-modal').getBoundingClientRect();return {blur:s('settings').backdropFilter,rect:r.toJSON(),token:s('native-button').color,unknown:s('plugin-native').backgroundColor,warning:s('warning').backgroundColor,mark:document.querySelector('#settings').getAttribute('data-we-surface-runtime'),layout:s('layout').backgroundColor,keep:s('keep').backgroundColor,child:s('preserve-child').backgroundColor,syntax:s('syntax').color,selection:s('selection').backgroundColor,editor:s('editor').backgroundColor,ownTab:s('own-tabs').backgroundColor,ownUploads:s('own-uploads').backgroundColor,ownCurrent:s('own-current').backgroundColor,ownModule:s('own-module').backgroundColor,alias1:s('own-picker').getPropertyValue('--dsw-alias-bg-layer-1').trim(),rope:s('rope').visibility,notice:s('notice').visibility,status:__glass.status()};})()`);
    check(tag+' 设置本体不再建立fixed包含块', compat.blur==='none' && compat.rect.x===10 && compat.rect.y===20, compat);
    // ⚠️ 这个用例的上半截（未知第三方面板的底色 / 状态色不被改写）保持不动；
    //    `token` 那一项**按用户实测反转**：5cabb9e1 把宿主背景令牌映射收窄到聊天流后，
    //    设置窗里的卡片 / 页签 / 导航全部退回宿主实底（用户："这些我用红色矩形框选中的
    //    组件的玻璃效果又丢失了"）。现在的口径：宿主自己的设置窗控件吃玻璃令牌
    //    （仍带可读性下限），未知第三方面板的底色声明与 preserve 区保持原生。
    check(tag+' 未知设置控件底色保留原生（第三方面板不被改写）',
      compat.unknown==='rgb(255, 255, 255)' && compat.warning==='rgb(244, 180, 40)', compat);
    check(tag+' 宿主设置窗控件吃玻璃令牌（不是宿主实底）',
      compat.token !== 'rgb(225, 226, 227)', compat.token);
    check(tag+' 壁纸仅清宿主外壳而非任意root和frame',await evaluate(`getComputedStyle(document.querySelector('#host-frame')).backgroundColor==='rgba(0, 0, 0, 0)' && getComputedStyle(document.querySelector('#host-root')).backgroundColor==='rgba(0, 0, 0, 0)'`));
    // ── 跨插件内联令牌（DS Bot 的 Bot 模式）────────────────────────────────────────
    // 全界面插件用 DSH 的 ctx.theme.overrideTokens 给宿主上色时，宿主把令牌以**内联
    // 样式**写在 <body> 上；普通作者声明输给内联声明 ⇒ 页面基色/侧栏填充保持不透明，
    // 壁纸层被盖死（现场：DS Bot 模式下壁纸完全不可见）。本插件让页面让开的那两条
    // 必须用作者 !important 压过内联普通声明。判据两个方向都断言：
    //   · 壁纸在场 ⇒ 消费这两枚令牌的壳层元素 computed 透明；
    //   · 摘掉壁纸门 ⇒ 内联值原样生效 —— 证明这是**按门的单向接管**，不是把宿主主题
    //     永久改掉；否则「!important 换成普通声明」或「门被摘掉」任一漂移都可能假绿。
    const inlineTokens = await evaluate(`(() => {
      const probe = document.createElement('div');
      probe.innerHTML = '<div id="dsb-frame" style="background:var(--dsw-alias-bg-base)"><div id="dsb-sidebar" style="background:var(--dsw-specific-sidebar-fill)"></div></div>';
      document.body.append(probe);
      document.body.style.setProperty('--dsw-alias-bg-base', 'rgb(20, 20, 20)');
      document.body.style.setProperty('--dsw-specific-sidebar-fill', 'rgb(27, 27, 27)');
      const read = () => [getComputedStyle(document.getElementById('dsb-frame')).backgroundColor, getComputedStyle(document.getElementById('dsb-sidebar')).backgroundColor];
      const withWallpaper = read();
      document.body.removeAttribute('data-we-wallpaper');
      const withoutWallpaper = read();
      document.body.setAttribute('data-we-wallpaper', 'on');
      document.body.style.removeProperty('--dsw-alias-bg-base');
      document.body.style.removeProperty('--dsw-specific-sidebar-fill');
      probe.remove();
      return { withWallpaper, withoutWallpaper };
    })()`);
    check(tag+' 壁纸在场时页面令牌压过宿主内联主题（DS Bot 的 Bot 模式）',
      inlineTokens.withWallpaper.every((color) => color === 'rgba(0, 0, 0, 0)'), inlineTokens);
    check(tag+' 壁纸退场后宿主内联令牌原样生效（单向接管，不改宿主主题）',
      inlineTokens.withoutWallpaper[0] === 'rgb(20, 20, 20)' && inlineTokens.withoutWallpaper[1] === 'rgb(27, 27, 27)', inlineTokens);
    check(tag+' 已知设置面与显式布局接管且preserve优先',compat.mark==='settings-window' && compat.layout==='rgba(0, 0, 0, 0)' && compat.keep==='rgb(222, 223, 224)' && compat.child==='rgb(222, 223, 224)',compat);
    check(tag+' 编辑内容底板受控且语法选区不改',compat.editor!=='rgb(255, 255, 255)' && compat.syntax==='rgb(197, 104, 228)' && compat.selection==='rgb(60, 80, 160)',compat);
    check(tag+' 本插件页签与上传区不继承宿主黑色实底',compat.ownTab!=='rgb(0, 0, 0)' && compat.ownUploads!=='rgb(0, 0, 0)',compat);
    // own 面 computed 精确配方（t8 修复的浏览器级验证）：玻璃页门别名块
    // （src/styles-panel.js）在 .we-picker 根上把 --dsw-alias-bg-layer-1 换成
    // 两段 color-mix（tint×alpha×0.9 + floor 地板）；.we-tabs(:249)/.we-picker__current(:208)/
    // .we-picker__uploads(:258)/.we-ext__module(styles-ext.js) 消费同一令牌 ⇒
    // 四元素 computed 必须等于配方解析值，且不等于宿主黑实底/宿主灰。深浅主题分叉由
    // tint 色相差异体现（light #8fd0ff / dark #0d1524，mixOut 已按主题取值）。
    const ownMix = mixOut(0.15); // phase-two fixture 显式给了 --we-settings-window-alpha:.15
    // F1 反事实负控（t31 revision1）：判据必须能红。wrongBaseMix = t30 F1 的旧错误硬编码
    // #151515 系构造的期望 —— 对观测值必须 close 失败（base 判据对色相敏感，深浅两主题
    // 均超 0.02 容差）；wrongWeightMix = 缺失 0.9 权重（tint 段 ×1.0）的期望 —— Δa≈0.006
    // 在 close(0.02) 下不可判别，故另设 exact(0.002) 精确档负控证明权重判据有判别力
    // （产品权重漂移时精确档主证据=alias1 结构判据 + 本负控同向翻转）。
    const wrongBaseMix = (() => { const wb = [hex1('15'), hex1('15'), hex1('15')]; const at = 0.15 * 0.9, a = floor + (1 - floor) * at; return { a, rgb: wb.map((bc, i) => (bc * floor + tint[i] * (1 - floor) * at) / a) }; })();
    const wrongWeightMix = (() => { const at = 0.15 * 1.0, a = floor + (1 - floor) * at; return { a, rgb: base.map((bc, i) => (bc * floor + tint[i] * (1 - floor) * at) / a) }; })();
    const exact = (got, want) => Number.isFinite(got.a) && Math.abs(got.a - want.a) < 0.002 && [0, 1, 2].every(i => Math.abs(got.rgb[i] - want.rgb[i]) < 0.002);
    const parsedTab = parseColor(compat.ownTab);
    check(tag+' own四元素=两段配方解析值（tabs/current/uploads/module，非黑非宿主灰）',
      close(parseColor(compat.ownTab), ownMix) && close(parseColor(compat.ownCurrent), ownMix) &&
      close(parseColor(compat.ownUploads), ownMix) && close(parseColor(compat.ownModule), ownMix), { got: [compat.ownTab, compat.ownCurrent, compat.ownUploads, compat.ownModule], want: ownMix });
    check(tag+' F1反事实负控：错误base(#151515)期望被拒（判据对base色相敏感）', !close(parsedTab, wrongBaseMix), { got: parsedTab, want: wrongBaseMix });
    check(tag+' F1反事实负控：缺失0.9权重(×1.0)期望在0.002精确档被拒', !exact(parsedTab, wrongWeightMix), { got: parsedTab, want: wrongWeightMix });
    // F2（t31 revision1）：computed 值是已解析 var() 的文本，不再检 var 字面量；
    // 对解析后的两段结构作可失败数值判据：①存在 color-mix(in srgb（外层+内层）；
    // ②地板段百分比=floor（浅 calc(0.45 * 100%) / 深 calc(calc(0.59 * 1) * 100%)，
    // 序列化按 Chrome 实测）；③tint 段权重=0.9×alpha（calc(.15 * 0.9 * 100%)——
    // 权重漂移为 1.0 或地板被摘除时本判据必红，即内嵌反事实负控）。
    const floorTxt = dark ? 'calc\\(0\\.59 \\* 1\\)' : '0\\.45';
    check(tag+' own面板别名token=两段color-mix配方（tint×alpha×0.9+地板段）', /color-mix\(in srgb/.test(compat.alias1) && new RegExp('calc\\(' + floorTxt + ' \\* 100%\\)').test(compat.alias1) && /calc\(\.15 \* 0\.9 \* 100%\)/.test(compat.alias1), compat.alias1);
    check(tag+' 可见外部模态时自有装饰和自动提示让路',compat.rope==='hidden' && compat.notice==='hidden',compat);
    // push→fullscreen→push（G1 历史栏位）：宿主布局属性（--dsh-dockkit-dock-layer），
    // 非浏览器 Fullscreen API；回撤后 plate 回 push 几何、所有权保持。
    await evaluate("document.querySelector('#content-dock').setAttribute('data-sidebar-right-panel','fullscreen');__glass.sync()");
     await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
     check(tag+' 宿主 fullscreen 右栏可接管并使用 dock 层（宿主布局属性，非Fullscreen API）',await evaluate("(()=>{const p=document.querySelector('#content-dock');return p.getAttribute('data-we-surface-runtime')==='right-sidebar' && getComputedStyle(p).zIndex==='40';})()"));
     // fullscreen→push 回撤：plate 继续存在（所有权不丢）且 dock 层抬升声明随之失效。
     await evaluate("document.querySelector('#content-dock').setAttribute('data-sidebar-right-panel','push');__glass.sync()");
     await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
     check(tag+' fullscreen→push 回撤保持所有权且dock层退回常态',await evaluate("(()=>{const p=document.querySelector('#content-dock');return p.getAttribute('data-we-surface-runtime')==='right-sidebar' && !!document.querySelector('[data-we-surface-plate=right-sidebar]') && getComputedStyle(p).zIndex!=='40';})()"));
     await evaluate("document.querySelector('#keep').removeAttribute('data-we-surface-preserve')");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    check(tag+' 移除非布局preserve包装自动接管子布局',await evaluate("getComputedStyle(document.querySelector('#preserve-child')).backgroundColor==='rgba(0, 0, 0, 0)'"));
    await evaluate("document.querySelector('#keep').setAttribute('data-we-surface-preserve','')");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    check(tag+' 恢复preserve包装自动撤回子布局',await evaluate("getComputedStyle(document.querySelector('#preserve-child')).backgroundColor==='rgb(222, 223, 224)'"));
    await evaluate("document.querySelector('#settings-layout').style.minHeight='1000px';document.querySelector('#settings').scrollTop=120;document.querySelector('#settings').style.width='80vw'");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    check(tag+' 滚动缩放设置窗不拖动fixed子弹层',await evaluate("(()=>{const r=document.querySelector('#nested-modal').getBoundingClientRect();return document.querySelector('#settings').scrollTop===120 && r.x===10 && r.y===20 && getComputedStyle(document.querySelector('#settings')).backdropFilter==='none';})()"));
    await evaluate("document.querySelector('#nested-modal').focus();window.__modalClicks=0;document.querySelector('#nested-modal').onclick=()=>window.__modalClicks++");
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:20,y:30,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:20,y:30,button:'left',clickCount:1});
    check(tag+' 设置子弹层保持焦点和真实点击',await evaluate("document.activeElement.id==='nested-modal' && document.elementFromPoint(20,30).id==='nested-modal' && __modalClicks===1"));
    await evaluate("document.querySelector('#settings').scrollTop=0;document.querySelector('#settings-layout').style.minHeight='';document.querySelector('#settings').style.width='90vw'");
    await screenshot(tag+'-settings-owned');
    await evaluate("__selection.glassSurfacePolicy={'settings-window':'native',content:'native',declared:'native'};__glass.sync()");
    // 「保留原生」= 不接管这一面：不挂运行标记、不画霜；窗内的表面令牌由
    // `:not(:where([data-we-surface-runtime="settings-window"]))` 那条钉回不透明面板色
    // （--we-panel-color 的浅色缺省 #ffffff），因此底色是**实色**而不是玻璃色。
    check(tag+' 逐面原生撤销设置布局和内容接管',await evaluate(`(()=>{
      const bg=getComputedStyle(document.querySelector('#settings')).backgroundColor;
      const rgba=bg.startsWith('rgba(') ? Number(bg.slice(5,-1).split(',')[3]) : 1;
      return !document.querySelector('#settings').hasAttribute('data-we-surface-runtime')
        && rgba===1
        && getComputedStyle(document.querySelector('#settings')).backdropFilter==='none'
        && getComputedStyle(document.querySelector('#editor')).backgroundColor==='rgb(255, 255, 255)'
        && getComputedStyle(document.querySelector('#layout')).backgroundColor==='rgb(222, 223, 224)';
    })()`));
    await evaluate("__selection.glassSurfacePolicy={};document.querySelector('#settings').remove();__glass.sync()");
    check(tag+' 模态卸载后浮层恢复',await evaluate("getComputedStyle(document.querySelector('#rope')).visibility==='visible'"));
    await evaluate("const el=document.createElement('div');el.setAttribute('role','dialog');el.style.cssText='width:20px;height:20px';document.body.append(el);__glass.sync()");
    check(tag+' 无模态语义的普通dialog不压制WE',await evaluate("getComputedStyle(document.querySelector('#rope')).visibility==='visible'"));
    await evaluate("document.querySelector('#editor').setAttribute('data-we-surface-preserve','');__glass.sync()");
    check(tag+' 内容preserve恢复原生画布',await evaluate("getComputedStyle(document.querySelector('#editor')).backgroundColor==='rgb(255, 255, 255)'"));
    await screenshot(tag+'-settings');
    // extra 端值 × 双主题（t9-003，真实参数合同取证）。真实范围（源码实测，非虚构滑杆）：
    // --we-settings-window-alpha ∈ [0.10, 0.25]（packages/glass/src/glass.js Math.max(0.10, 0.25-pct/100*0.15)，
    // 不是自有设置窗 5..42/5..50）；--we-blur ∈ [0,60]px（packages/glass/src/glass-panel.js SliderRow(cn.blur,0,60,1)）。
    // extra normal 霜读 --we-blur（packages/glass/src/glass-extra.js），底色两段 color-mix 消费
    // --we-settings-window-alpha×0.9 + readability-floor 地板（packages/glass/src/glass-extra.js）；
    // own-current 走同一配方表（src/styles-panel.js）⇒ 同一断言面。phase-two 此处
    // 已无 #settings（:248 移除），霜载体读 extra 面 ::before 本体。
    await evaluate(`(() => {
      __selection.extraGlassSelectors='.extra';
      const el=document.createElement('div');el.id='extra-end';el.className='extra';
      el.style.cssText='position:fixed;left:12px;bottom:12px;width:60px;height:40px;z-index:20';
      document.body.append(el);__glass.sync();return true;
    })()`);
    await until('document.querySelector("#extra-end").getAttribute("data-we-surface-runtime")==="extra"');
    await evaluate("document.body.style.setProperty('--we-settings-window-alpha','0.10');document.body.style.setProperty('--we-blur','0px')");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const low = await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('#extra-end'),'::before');const c=getComputedStyle(document.getElementById('own-current'));return {extraBg:s.backgroundColor,frost:s.backdropFilter,ownBg:c.backgroundColor};})()`);
    const wantLow = mixOut(0.10);
    check(tag + ' alpha端点0.10：extra底色=两段配方解析值（floor ' + floor + ' + tint×0.09）', close(parseColor(low.extraBg), wantLow), { got: parseColor(low.extraBg), want: wantLow, raw: low.extraBg });
    check(tag + ' own-current同配方表端点一致（非宿主黑灰）', close(parseColor(low.ownBg), wantLow) && low.ownBg !== 'rgb(0, 0, 0)' && low.ownBg !== 'rgb(246, 246, 246)', { got: parseColor(low.ownBg), want: wantLow, raw: low.ownBg });
    check(tag + ' blur端点0px：extra霜含blur(0px)（--we-blur 真实刻度0）', low.frost.includes('blur(0px)'), low.frost);
    await evaluate("document.body.style.setProperty('--we-settings-window-alpha','0.25');document.body.style.setProperty('--we-blur','60px')");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const high = await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('#extra-end'),'::before');const c=getComputedStyle(document.getElementById('own-current'));return {extraBg:s.backgroundColor,frost:s.backdropFilter,ownBg:c.backgroundColor};})()`);
    const wantHigh = mixOut(0.25);
    check(tag + ' alpha端点0.25：extra底色=上限混合（floor ' + floor + ' + tint×0.225）', close(parseColor(high.extraBg), wantHigh), { got: parseColor(high.extraBg), want: wantHigh, raw: high.extraBg });
    check(tag + ' own-current上限端点一致（非宿主黑灰）', close(parseColor(high.ownBg), wantHigh) && high.ownBg !== 'rgb(0, 0, 0)' && high.ownBg !== 'rgb(246, 246, 246)', { got: parseColor(high.ownBg), want: wantHigh, raw: high.ownBg });
    check(tag + ' blur端点60px：extra霜含blur(60px)（--we-blur 真实刻度60）', high.frost.includes('blur(60px)'), high.frost);
    await evaluate("document.body.style.removeProperty('--we-settings-window-alpha');document.body.style.removeProperty('--we-blur');document.querySelector('#extra-end').remove();__glass.sync()");
    await evaluate('__glass.dispose()');
    check(tag+' 第二阶段卸载清理',await evaluate('document.querySelectorAll("[data-we-surface-runtime],[data-we-layout-runtime],[data-we-modal-blocked]").length===0'));
  }
  await verifyPetSidebarGlassBrowser({ send, evaluate, until, check, screenshot, css, runtime, bundle });
  // computed/身份证据：bundle 与内联模块字节的 sha256 —— 截图与 computed 矩阵对应
  // 的就是这批字节（同一进程内读出，不与盘上其他时点混淆）。
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  writeFileSync(join(out, 'report.json'), JSON.stringify({
    bundleBytes: Buffer.byteLength(bundle),
    bundleSha256: sha(bundle),
    runtimeModuleSha256: sha(runtime),
    extraModuleSha256: sha(extra),
    cssSha256: sha(css),
    report, failures,
  }, null, 2));
  assert.equal(failures.length, 0, failures.join('\n'));
} finally {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('browser closing')); }
  pending.clear();
  // Browser.close 是浏览器级命令，不带 sessionId；管道已关时不必再写。
  if (!pipeClosed && child.exitCode === null) {
    try { toBrowser.write(JSON.stringify({ id: ++counter, method: 'Browser.close' }) + '\0'); } catch { /* 关闭管道亦视为结束 */ }
  }
  if (child.exitCode===null) {
    const exit = new Promise(resolve=>{ child.once('exit',resolve); });
    child.kill(); await exit;
  }
}
