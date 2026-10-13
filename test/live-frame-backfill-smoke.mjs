// React #31 校验：**对象不能作为子节点**。替身若默默吞掉，这类错就只能在真机上炸
// （实测：参数位置上的赋值表达式把"角色对象数组"当成了子节点，空表时看不出、
// 一旦筛出角色整块面板就崩）。替身必须和 React 一样**抛**。
function badChild(c) {
  if (c === null || c === undefined || typeof c === 'boolean' || typeof c === 'string' || typeof c === 'number') return null;
  if (Array.isArray(c)) { for (const x of c) { const b = badChild(x); if (b) return b; } return null; }
  if (typeof c === 'object' && c.type) return null;
  return c;
}
function assertChildren(children) {
  for (const c of children) {
    const bad = badChild(c);
    if (bad) throw new Error('React #31：无效子节点（对象不能作为子节点）: ' + JSON.stringify(Object.keys(bad)).slice(0, 80));
  }
}// Live GPU 抓帧回填冒烟（真失败通道：任何断言失败 → 非零退出）。
//
// 链路：live 首帧确认 → 2.5s 后 HEAD 探测槽位 → 抓渲染页 canvas → 内容/体积
// 门禁 → PUT /scene-frame-cache/<token>。
// 每个用例独立启动一个 client 实例（独立 vm 沙箱 + 独立 mock 挂载），因为
// 心跳 tick 的 alive 分支带 `!watch.firstFrame` 守卫 —— 同一次挂载里只会调度
// 一次回填，真正的重试发生在重新挂载（届时 applySelection 会清 token）。
//
// 用例：
//   A 全黑画面（内容门禁）→ 只 HEAD、不 PUT；
//   B 有画面 + 体积达标 → HEAD + PUT 全链走通，body 就是抓到的 blob；
//   C 体积低于分辨率地板（1080p → 41472B）→ 不 PUT（判据是分辨率地板，不是固定字节闸）；
//   D 槽位已有 GPU 帧且几何相符 → 连抓帧都不发生（缓存唯一性）；
//   G 槽位已有 GPU 帧但面积明显偏小（别的窗口在更小视口抓的）→ 抓帧过门禁后
//     直接 PUT 覆盖（升级；自动路径**不删槽**，宿主面积守卫兜底小帧）——自愈；
//   H 槽位已有 GPU 帧但宿主没回几何头（旧宿主）→ 按未知处理，同样升级重抓；
//   I 面积偏小 + 清除通道不可用（宿主 500）→ 升级路径本就不删槽，PUT 照常；
//   J 主帧偏小但画面还没出来（黑帧门禁拦下）→ 不抓不写（先清后抓会留下空槽）；
//   K 画布比 ≠ 窗口盒比（渲染器夹了画布尺寸）→ 升级判定基准取 canvas 面积，
//     不得反复清写。
//   L 单主帧契约：HEAD/PUT 均为裸 URL（无形状参数）；自动路径零 DELETE
//    （DELETE 仅「重新截」force 路径使用）。
//   M PUT 撞上更大主帧（宿主面积守卫 409 frame-smaller）⇒ 视为已定局：不重试、
//    不报错、槽位记账照常（别处有更大的帧，显示只会更好）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const React = { Fragment:'Fragment', useState:(i)=>[i,()=>{}], useEffect:()=>{}, useRef:(v)=>({current:v}),
  createElement:(t,p,...c)=>{ assertChildren(c); return typeof t==='function'?t(p||{}):({type:t,props:p||null,children:c}); } };

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};
// 场景编排里必须执行的一步：抛错不得被吞—— 吞掉就等于整段静默跳过，
// 于是「重跑 applySelection」这条覆盖面判据根本没被测到。
const runStep = (label, fn) => {
  try { fn(); }
  catch (e) { failures++; console.log('  ✗ 步骤未执行（' + label + ' 抛出）：' + e.message); }
};

/** 启动一个独立 client 实例并跑到「回填定时器已触发」为止。 */
async function runScenario({ mode = 'varied', blobSize = 120000, gpuAlreadyPinned = false, toBlobFails = false, liveStall = false, gpuDims = null, viewport = { w: 1920, h: 1080 }, canvasSize = { w: 1920, h: 1080 }, clearFails = false, putRejectsSmaller = false }) {
  const byId = {};
  const timers = [];
  const intervals = [];
  const iframeEls = [];
  const headCalls = [];
  const putCalls = [];
  const clearCalls = [];
  const slotOrder = []; // 槽位端点上的方法顺序：DELETE 必须早于 PUT
  const progCalls = []; // 进度轮询探针：本仓没有 CPU 动画渲染路线 ⇒ 必须恒为空（场景 F 判据）
  const blobStub = { get size() { return blobSize; } };
  const make2d = () => ({
    drawImage() {},
    getImageData: () => {
      const px = new Uint8ClampedArray(64 * 64 * 4);
      if (mode === 'varied') {
        for (let i = 0; i < px.length; i += 4) {
          const bright = (i / 4) % 2 === 0;
          px[i] = bright ? 220 : 20; px[i + 1] = bright ? 200 : 30; px[i + 2] = bright ? 180 : 40; px[i + 3] = 255;
        }
      } // blank：全 0 → 近全黑 + 零方差
      return { data: px };
    },
  });
  const ctx2d = make2d();

  const makeEl = (tag) => {
    const listeners = {};
    const el = {
      tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, isConnected: true,
      style: { _props:{}, cssText:'', setProperty(k,v){this._props[k]=v;}, removeProperty(k){delete this._props[k];} },
      className: '',
      appendChild(c){ this.children.push(c); if (c.id) byId[c.id]=c; c._parent=this; return c; },
      remove(){ if (this._parent){ const i=this._parent.children.indexOf(this); if(i>=0)this._parent.children.splice(i,1); } },
      setAttribute(k,v){ this.attributes[k]=v; },
      removeAttribute(k){ delete this.attributes[k]; },
      querySelector(){ return null; },
      addEventListener(ev,fn){ (listeners[ev] ||= []).push(fn); },
      removeEventListener(ev,fn){ const l=listeners[ev]; if(l){const i=l.indexOf(fn); if(i>=0)l.splice(i,1);} },
      __fire(ev){ (listeners[ev]||[]).slice().forEach(f=>f()); },
      play(){ return Promise.resolve(); },
      pause(){},
      load(){},
    };
    el.classList = {
      add(c){ const parts = el.className ? el.className.split(' ') : []; if (!parts.includes(c)) { parts.push(c); el.className = parts.join(' '); } },
      remove(c){ const parts = el.className ? el.className.split(' ') : []; const i = parts.indexOf(c); if (i >= 0) { parts.splice(i, 1); el.className = parts.join(' '); } },
    };
    if (tag === 'canvas') {
      // 门禁会 createElement('canvas') 做 64×64 降采样采样。
      el.width = 64; el.height = 64;
      el.getContext = (kind) => (kind === '2d' ? ctx2d : null);
    }
    if (tag === 'iframe') {
      el.contentWindow = {
        __wpStats: { frame: () => ({ fps: 30, running: true }) },
        __wp: { resume(){}, pause(){}, setVolume(){}, setFit(){}, pushPointer(){}, pointerLeave(){} },
        document: { querySelector: (sel) => String(sel).includes('data-webwallgl-gl') ? displayCanvas : null },
      };
    }
    return el;
  };

  // 渲染页的显示 canvas：默认 1080p、toBlob 产出体积可调的假 PNG。
  const displayCanvas = {
    width: canvasSize.w, height: canvasSize.h,
    toBlob: (cb) => { if (toBlobFails) throw new Error('tainted'); cb(blobStub); },
  };

  const bodyEl = makeEl('body');
  const document = {
    createElement: (t) => { const el = makeEl(t); if (t==='iframe') iframeEls.push(el); return el; },
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    head: { appendChild: () => {} },
    body: bodyEl,
    hidden: false,
    hasFocus: () => true,
    addEventListener(){}, removeEventListener(){},
    documentElement: makeEl('html'),
  };
  const localStorage = {
    _store: { 'dsh-wallpaper-engine:selection': JSON.stringify({ id: 's' }) },
    getItem(k){ return this._store[k] ?? null; }, setItem(k,v){ this._store[k]=v; }, removeItem(k){ delete this._store[k]; },
  };
  const fetch = (url, opts) => {
    const u = String(url), m = (opts && opts.method) || 'GET';
    if (u.includes('/scene-anim-progress/')) progCalls.push(u);
    if (m === 'HEAD') {
      headCalls.push(u);
      if (!gpuAlreadyPinned) return Promise.resolve({ ok:false, status:404, headers:{ get:()=>null } });
      // 真宿主语义：GPU 帧几何来自 PNG 的 IHDR → X-WE-GPU-W/H（客户端算面积）；
      // 旧宿主没有这两个头 ⇒ gpuDims 传 null 模拟。
      return Promise.resolve({ ok:true, status:204, headers:{ get:(k) => {
        const key = String(k).toLowerCase();
        if (key === 'x-we-gpu') return '1';
        if (key === 'x-we-gpu-w') return gpuDims ? String(gpuDims.w) : null;
        if (key === 'x-we-gpu-h') return gpuDims ? String(gpuDims.h) : null;
        return null;
      } } });
    }
    if (m === 'DELETE') {
      clearCalls.push(u);
      slotOrder.push('DELETE');
      return Promise.resolve({ ok:!clearFails, status: clearFails ? 500 : 200,
        json:()=>Promise.resolve(clearFails ? { ok:false, removed:false } : { ok:true, removed:true }) });
    }
    if (m === 'PUT') {
      // 只记回填端点的 PUT —— client 自己还会 PUT /settings（持久化）。
      if (u.includes('/scene-frame-cache/')) {
        putCalls.push({ url:u, body:opts.body }); slotOrder.push('PUT');
        if (putRejectsSmaller) {
          // 宿主面积守卫：来帧比盘上主帧小 ⇒ 409 frame-smaller（守卫拒写）。
          return Promise.resolve({ ok:false, status:409, json:()=>Promise.resolve({ error:'frame-smaller' }) });
        }
      }
      return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({ ok:true }) });
    }
    return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(
      u.includes('/settings') ? { ok:true, betterSidebar:false } :
      u.includes('/media-info') ? { info:null } :
      { installDir:'D:/we', total:1, portableCount:1, playlists:[], wallpapers:[
        { id:'s', title:'S', type:'scene', playable:false, media:null, frameUrl:'/wallpaper-engine/scene-frame/sss',
          sceneLive:true, sceneLiveSrc:'tok-sss', preview:'/wallpaper-engine/preview/sss', contentrating:'Everyone' },
      ] }) });
  };

  const cap = { handoff: null };
  const pickerRenders = [];
  const sandbox = {
    window: {
      __ModuleLoader__: { load:(h)=>{ cap.handoff=h; } },
      setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
      clearTimeout:(t)=>{ if(t)t.cleared=true; },
      setInterval:(fn,ms)=>{ const t={fn,ms,cleared:false}; intervals.push(t); return t; },
      clearInterval:(t)=>{ if(t)t.cleared=true; },
      addEventListener(){}, innerWidth:viewport.w, innerHeight:viewport.h, devicePixelRatio:1,
    },
    document, localStorage, fetch, React,
    location: { origin: 'http://localhost' },
    setInterval:(fn,ms)=>{ const t={fn,ms,cleared:false}; intervals.push(t); return t; },
    clearInterval:(t)=>{ if(t)t.cleared=true; },
    // 全局 setTimeout/clearTimeout：client 里有若干走裸全局的定时器路径（转码
    // 元数据兜底、live 轮询），sandbox 不给就会在首次触发时抛 ReferenceError
    //（暴露出的 harness 缺口，不是产品缺陷）。
    setTimeout:(fn,ms)=>{ const t={fn,ms,cleared:false}; timers.push(t); return t; },
    clearTimeout:(t)=>{ if(t)t.cleared=true; },
  };
  vm.createContext(sandbox);
  new vm.Script(CODE, { filename:'client.js' }).runInContext(sandbox);
  const exportsObj = cap.handoff.factory((spec)=> spec==='react'?React:{createPortal:(n)=>n});
  exportsObj.apply({ slots:{inject:(k,cb)=>cb(),register:(opts, render)=>{ if (typeof render === 'function') pickerRenders.push(render); }}, effect(fn){ fn(); return fn; } });
  // 挂载要等 loadPersisted → loadInventory 的 Promise 链跑完（纯微任务，但
  // 有若干 hop），轮询到 iframe 出现为止。
  for (let i = 0; i < 50 && iframeEls.length === 0; i++) {
    await new Promise((r) => { setTimeout(r, 10); });
  }
  if (!iframeEls.length) throw new Error('live iframe 未挂载（boot 未完成）');

  const frame = iframeEls[iframeEls.length-1];
  frame.__fire('load');
  const watchTick = intervals.find((t) => !t.cleared && t.ms === 1000);
  watchTick.fn(); // 首帧确认 → 调度回填
  const backfill = timers.find((t) => !t.cleared && t.ms === 2500);
  // P2-M 前置：让 live 运行期失联（连续无帧 ≥ LIVE_STALL_TICKS*2）→ 降级回静态帧。
  // 目标形态里回退链**没有任何 CPU 动画渲染**（动画只走 WebWallGL 一条路线），所以这里
  // 记录的两个计数只用来断言它们恒为 0（1500ms 轮询若出现，就是 CPU 渲染路线被接了回来）。
  let animPollBefore = 0, progBefore = 0;
  const tickPoll = async () => {
    const t = intervals.filter((x) => !x.cleared && x.ms === 1500).pop();
    if (t) t.fn();
    await new Promise((r) => { setTimeout(r, 30); });
  };
  if (liveStall) {
    frame.contentWindow.__wpStats.frame = () => ({ fps: 0, running: true });
    // 首帧确认后 watch 会重建（新 interval 对象），所以每次取「最新的活跃 1s tick」。
    for (let i = 0; i < 44; i++) {
      const t = intervals.filter((x) => !x.cleared && x.ms === 1000).pop();
      if (t) t.fn();
    }
    await new Promise((r) => { setTimeout(r, 60); });
    // liveFail 只 syncLayers；这里再点一次该壁纸卡片走一遍 applySelection，确认
    // 重新应用选中也不会拉起任何 CPU 渲染路径（场景 F 的零请求断言）。
    const collect = (root, pred) => {
      const out = [];
      (function walk(node) {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        if (pred(node)) out.push(node);
        if (Array.isArray(node.children)) node.children.forEach(walk);
      })(root);
      return out;
    };
    // 同一类地板放在 `if (pickerRenders.length)` **外面**：渲染器一个都没拿到时，
    // 下面「重跑 applySelection」整段会被跳过 —— 那种静默通过必须变成可见失败。
    check('覆盖面：拾取器渲染器已捕获（可重跑 applySelection）', pickerRenders.length > 0, 'renders=' + pickerRenders.length);
    if (pickerRenders.length) {
      const t0 = pickerRenders[0]();
      const openBtn = collect(t0, (n) => {
        const cls = typeof n.props?.className === 'string' ? n.props.className : '';
        return cls.includes('we-picker__btn') && Array.isArray(n.children) && n.children[0] === '选择壁纸';
      })[0];
      // 吞掉的异常必须可见：onClick 抛错就计入失败，不得静默跳过这一步。
      if (openBtn) { runStep('重跑 applySelection（点「选择壁纸」）', () => openBtn.props.onClick()); }
      const card = collect(pickerRenders[0](), (n) => {
        const cls = typeof n.props?.className === 'string' ? n.props.className : '';
        return (cls === 'we-picker__card' || cls.startsWith('we-picker__card ')) && JSON.stringify(n).includes('"S"');
      })[0];
      if (card) { runStep('重跑 applySelection（点壁纸卡片）', () => card.props.onClick()); }
      // 地板放在 `if (openBtn)` / `if (card)` **外面**：元素没找到时整段不再静默通过。
      check('覆盖面：重跑 applySelection 的入口存在（选择壁纸按钮）', Boolean(openBtn), 'openBtn=' + Boolean(openBtn));
      check('覆盖面：重跑 applySelection 的目标存在（壁纸卡片）', Boolean(card), 'card=' + Boolean(card));
      await new Promise((r) => { setTimeout(r, 40); });
    }
    await tickPoll();
    animPollBefore = intervals.filter((t) => !t.cleared && t.ms === 1500).length;
    progBefore = progCalls.length;
  }
  if (backfill) backfill.fn();
  await new Promise((r) => { setTimeout(r, 30); });
  await tickPoll(); // 落地后再敲一次：修复生效时轮询已被清，不得再发进度请求
  const animPollAfter = intervals.filter((t) => !t.cleared && t.ms === 1500).length;
  return { frame, backfill, headCalls, putCalls, clearCalls, slotOrder, progCalls, blobStub,
    animPollBefore, animPollAfter, progBefore,
    selectedId: JSON.parse(localStorage._store['dsh-wallpaper-engine:selection'] || '{}').id };
}

console.log('A. 全黑画面（内容门禁）');
{
  const r = await runScenario({ mode: 'blank', blobSize: 120000 });
  check('回填定时器已武装（首帧后 2.5s）', !!r.backfill);
  // 面板状态探测（syncLayers → probeGpuFrameState）与回填探测都打同一个
  // URL，所以这里只要求「至少探测过一次」；实质断言是 put=0。
  check('探测过槽位（HEAD 发出）', r.headCalls.length >= 1, 'head=' + r.headCalls.length);
  check('黑帧不 PUT（内容门禁拦下）', r.putCalls.length === 0, 'put=' + r.putCalls.length);
}

console.log('B. 有画面 + 体积达标（正常链路）');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000 });
  check('PUT 回填发生', r.putCalls.length === 1, 'put=' + r.putCalls.length);
  check('PUT 目标为 scene-frame-cache/<token>',
    r.putCalls.length === 1 && r.putCalls[0].url === '/wallpaper-engine/scene-frame-cache/sss',
    r.putCalls.length ? r.putCalls[0].url : 'none');
  check('PUT body 就是抓到的 blob', r.putCalls.length === 1 && r.putCalls[0].body === r.blobStub);
}

console.log('C. 体积低于分辨率地板（1080p → 41472B）');
{
  const r = await runScenario({ mode: 'varied', blobSize: 8192 });
  check('不 PUT（体积未过分辨率地板）', r.putCalls.length === 0, 'put=' + r.putCalls.length);
}

console.log('D. 槽位已有 GPU 帧 + 几何相符（缓存唯一性）');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000, gpuAlreadyPinned: true, gpuDims: { w: 1920, h: 1080 } });
  check('面积达标 → 完全不抓帧写入', r.putCalls.length === 0 && r.headCalls.length >= 1,
    'head=' + r.headCalls.length + ' put=' + r.putCalls.length);
  check('几何相符 → 也不清槽', r.clearCalls.length === 0, 'clear=' + r.clearCalls.length);
}

console.log('E. toBlob 抛错（tainted / 上下文异常）不炸');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000, toBlobFails: true });
  check('异常被兜住且不 PUT', r.putCalls.length === 0, 'put=' + r.putCalls.length);
}

console.log('G. 槽位已有 GPU 帧但面积明显偏小（更小视口抓的）→ 升级覆盖');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000, gpuAlreadyPinned: true, gpuDims: { w: 480, h: 320 } });
  check('升级不删槽（PUT 直写覆盖；DELETE 只属于 force 路径）',
    r.clearCalls.length === 0,
    'clear=' + r.clearCalls.length + (r.clearCalls[0] ? ' ' + r.clearCalls[0] : ''));
  check('重抓并写入（PUT 一次，裸 URL）',
    r.putCalls.length === 1 && r.putCalls[0].url === '/wallpaper-engine/scene-frame-cache/sss',
    r.putCalls.length ? r.putCalls[0].url : 'none');
  check('顺序：直接 PUT（无 DELETE 前置）',
    r.slotOrder.join('>') === 'PUT', r.slotOrder.join('>') || 'none');
}

console.log('H. 槽位已有 GPU 帧但没有几何头（旧宿主）→ 按未知自愈：升级重抓');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000, gpuAlreadyPinned: true, gpuDims: null });
  check('未知几何 → 升级重抓（宿主面积守卫兜底，不会写坏盘上更大的帧）',
    r.clearCalls.length === 0 && r.putCalls.length === 1,
    'clear=' + r.clearCalls.length + ' put=' + r.putCalls.length);
}

console.log('I. 清除通道不可用（宿主 500）→ 升级路径不依赖删除，PUT 照常');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000, gpuAlreadyPinned: true,
    gpuDims: { w: 480, h: 320 }, clearFails: true });
  check('自动升级不发 DELETE（删不到也不碍事）', r.clearCalls.length === 0, 'clear=' + r.clearCalls.length);
  // 单主帧 PUT 直写覆盖：升级只依赖 PUT + 宿主面积守卫，删除通道坏不坏都无关。
  check('升级 PUT 照常发生', r.putCalls.length === 1, 'put=' + r.putCalls.length);
}

console.log('J. 几何不符但画面还没出来（黑帧门禁）→ 不得清槽');
{
  const r = await runScenario({ mode: 'blank', blobSize: 120000, gpuAlreadyPinned: true, gpuDims: { w: 480, h: 320 } });
  check('门禁拦下时不抓不写（空槽比旧帧更糟，何况槽里本来就是有效主帧）',
    r.clearCalls.length === 0 && r.putCalls.length === 0,
    'clear=' + r.clearCalls.length + ' put=' + r.putCalls.length);
}

console.log('K. 渲染器把画布比夹到别的比例（画布比 ≠ 窗口盒比）→ 不得反复清写');
{
  // 基准是**抓帧用的那个 canvas**，不是窗口盒：画布 1920x1080（与存帧同比）而
  // 窗口盒 2000x800（2.5）时，存帧并不旧 —— 拿盒比对照会永远判「不符」，
  // 每次挂载都清一次写一次（无休止 churn），这条断言正是防它回归。
  const r = await runScenario({ mode: 'varied', blobSize: 120000, gpuAlreadyPinned: true,
    gpuDims: { w: 1920, h: 1080 }, canvasSize: { w: 1920, h: 1080 }, viewport: { w: 2000, h: 800 } });
  check('画布面积达标（盒比不符）→ 保留，不清不写',
    r.clearCalls.length === 0 && r.putCalls.length === 0,
    'clear=' + r.clearCalls.length + ' put=' + r.putCalls.length);
}

console.log('L. 单主帧契约：裸 URL，自动路径零 DELETE');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000 });
  const backfillHead = r.headCalls.find((u) => u.indexOf('scene-frame/sss') !== -1);
  check('HEAD 为裸 URL（无 ?ar= —— 主帧无形状参数）',
    Boolean(backfillHead) && backfillHead.indexOf('ar=') === -1,
    backfillHead || 'none');
  const r2 = await runScenario({ mode: 'varied', blobSize: 120000, gpuAlreadyPinned: true, gpuDims: { w: 480, h: 320 } });
  check('升级路径零 DELETE（DELETE 仅「重新截」force 使用）',
    r2.clearCalls.length === 0 && r2.putCalls.length === 1,
    'clear=' + r2.clearCalls.length + ' put=' + r2.putCalls.length);
}

console.log('M. PUT 撞更大主帧（面积守卫 409）⇒ 已定局：不重试不报错，记账照常');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000, gpuAlreadyPinned: true,
    gpuDims: { w: 480, h: 320 }, putRejectsSmaller: true });
  check('升级 PUT 恰好一次（409 不触发重试）', r.putCalls.length === 1, 'put=' + r.putCalls.length);
  check('409 路径零 DELETE（没有"先删再试"的死循环）', r.clearCalls.length === 0,
    'clear=' + r.clearCalls.length);
  check('409 视为已定局：槽位记账照常（下次挂载不再重复抓帧）',
    r.slotOrder.join('>') === 'PUT', r.slotOrder.join('>') || 'none');
}

console.log('F. P2-M：GPU 静帧落地后不得有任何 CPU 渲染（该路线已删除）');
{
  const r = await runScenario({ mode: 'varied', blobSize: 120000, liveStall: true });
  // 目标形态：场景动画只保留 WebWallGL 一条路线，回退链是
  // MP4 → 静态帧 → 单张大图 → 内嵌图，**没有 CPU 动画渲染**。
  // 于是这里断的不变量是：整条流程里一帧 CPU 渲染都不许起（进度轮询/探针恒为 0）。
  check('live 失联降级后没有任何 CPU 动画渲染在跑（scene-anim 已删除）',
    r.animPollBefore === 0 && r.progBefore === 0,
    'poll=' + r.animPollBefore + ' prog=' + r.progBefore);
  check('回填 PUT 成功（GPU 静帧已落地）', r.putCalls.length === 1, 'put=' + r.putCalls.length);
  check('落地后仍无任何 CPU 渲染请求（轮询恒为 0）',
    r.animPollAfter === 0 && r.progCalls.length === 0,
    'poll=' + r.animPollAfter + ' prog=' + r.progCalls.length + ' id=' + r.selectedId);
}

console.log('');
console.log(failures === 0 ? 'SMOKE PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
