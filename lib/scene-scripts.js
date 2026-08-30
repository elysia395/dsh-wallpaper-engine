// WE scene scripts 运行时: 执行 {script, value} 对象的 JS 脚本 (NSL)
// 支持: export function update(value) — 每帧更新 (返回新值)
//       export function applyUserProperties(changed) — 用户属性变更更新
//       export function init(value) — 初始化一次 (返回新值, NSL init(value))
// 提供 WEColor / createScriptProperties / engine.canvasSize / Vec3 等引擎 API (vm 沙箱)
// 用户属性 (project.json general.properties) 注入 scriptProperties (user 映射)
//
// 关键设计 (sf35 重构): 脚本**编译一次、状态跨帧保留** — 旧实现每帧重编译导致
// NSL 脚本内部状态 (计数器/动画调度器) 每帧重置、大型脚本每帧编译 CPU 爆炸,
// 且 init() 每帧重复调用。现在:
//   - createScriptCache() 持有 {map: Map<源码, 编译条目>, shared}
//   - 每个 SceneRenderer 实例一个 cache (静态帧单实例渲染, 脚本状态在快进步骤间保留)
//   - 同一源码只编译一次; init() 只在首次执行; 每帧只调 update(value)
//   - thisObject/thisLayer 通过 ownerRef 代理指向"当前脚本所属对象" (缓存共享
//     时对象不串; 读写真实渲染对象 (origin/scale/visible/alpha/animationlayers))
//   - engine API 补全 (isRunningInEditor 等) — NSL 库 (如 Mutsumi 788) 缺失
//     方法时中途抛错 → 后续 shared 赋值全部丢失 → 整个动画框架失效
import vm from 'node:vm';
import { WEColor, Vec3, Vec2, ScriptPropertiesBuilder } from './scene-script-apis.js';

// localStorage 鍐呭瓨 shim (vm 娌欑鏃犳祻瑙堝櫒瀛樺偍): 姣?SceneRenderer 瀹炰緥涓€浠?
// 璺ㄥ抚淇濈暀 (鍦烘櫙鑴氭湰 Day/Night 绛夌敤瀹冨瓨鐢ㄦ埛閫夋嫨, 缂哄け 鈫?ReferenceError)
// 鍚屾椂鎻愪緵 NSL 搴撶殑 .get/.set/.has 鍒悕 (noeru NSL 鐢?localStorage.get('k'))
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
    key: (i) => [...store.keys()][i] || null,
    get length() { return store.size; },
    // NSL 搴撳埆鍚?
    get: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    set: (k, v) => { store.set(String(k), String(v)); },
    has: (k) => store.has(String(k)),
    remove: (k) => { store.delete(String(k)); },
  };
}

// NSL thisScene: getLayer(name) 鈫?鍥惧眰鍖呰, 璇诲啓鐪熷疄鍦烘櫙瀵硅薄灞炴€?
// origin/scale/size 瀛楃涓?"x y z" 鈫?Vec3; visible/alignment 鐩存帴璇诲啓
// 鑴氭湰瀵硅薄 {script, value} 鍙?value (715 璇?Launcher scale 鏃跺叾鑴氭湰鍙兘灏氭湭
// 鎵ц/宸叉墽琛?鈥?璇绘渶缁?value 鑰岄潪鍘熷 {script,value} 瀵硅薄)
export function makeSceneRef(objects) {
  const rawVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const parseV = (s, def) => {
    const v = rawVal(s);
    const p = String(v == null ? '' : v).trim().split(/\s+/).map(Number);
    return new Vec3(p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]);
  };
  const layer = (obj) => ({
    get visible() { return obj.visible !== false; },
    set visible(v) { obj.visible = !!v; },
    get alignment() { return obj.alignment; },
    set alignment(v) { obj.alignment = v; },
    get size() { return parseV(obj.size, [0, 0, 0]); },
    get scale() { return parseV(obj.scale, [1, 1, 1]); },
    get origin() { return parseV(obj.origin, [0, 0, 0]); },
    set origin(v) {
      if (v == null) return;
      const x = v.x != null ? v.x : v[0];
      const y = v.y != null ? v.y : v[1];
      const z = v.z != null ? v.z : v[2];
      obj.origin = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
    },
    get name() { return obj.name || ''; },
    get id() { return obj.id; },
    clicked: false,
    cursorDetected: false,
    // thisScene.getLayer() 鐨勫姩鐢?鎾斁鎺у埗 (涓?thisLayer 鍚屾 no-op, 闃?ReferenceError)
    getAnimation: () => ({ play: () => {}, pause: () => {}, resume: () => {}, stop: () => {}, setFrame: () => {}, setTime: () => {} }),
    getAnimationLayer: () => ({ play: () => {}, pause: () => {}, resume: () => {}, setFrame: () => {}, setTime: () => {} }),
    getTextureAnimation: () => ({ frameCount: 1, duration: 1, getFrame: () => 0, stop: () => {}, play: () => {} }),
    play: () => {}, pause: () => {}, resume: () => {},
  });
  const objList = Array.isArray(objects) ? objects : [];
  return {
    getLayer: (name) => {
      const obj = objList.find((o) => o && o.name === name);
      return obj ? layer(obj) : layer({ name, origin: '0 0 0', scale: '1 1 1', size: '0 0 0', visible: true, id: -1 });
    },
    getSceneObject: (id) => {
      const obj = objList.find((o) => o && o.id === id);
      return obj ? layer(obj) : null;
    },
  };
}

// 褰撳墠鑴氭湰鎵€灞炲璞′唬鐞? thisObject/thisLayer 閫氳繃瀹冩寚鍚?褰撳墠瀵硅薄",
// 浣跨紦瀛樺叡浜殑缂栬瘧鏉＄洰鍦ㄥ涓璞￠棿涓嶄覆 (姣忔 update 鍓?ownerRef.current 鏇存柊)銆?
function makeOwnerRef() {
  const ref = { current: null, textureInfoFn: null };
  const rawVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const parseV = (s, def) => {
    const v = rawVal(s);
    const p = String(v == null ? '' : v).trim().split(/\s+/).map(Number);
    return new Vec3(p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]);
  };
  const animRef = (obj) => ({
    play: () => {}, pause: () => {}, resume: () => {}, stop: () => {},
    setFrame: () => {}, setTime: () => {}, setFps: () => {},
    setVisible: () => {}, setBlend: () => {}, setRate: () => {}, setScale: () => {},
    setOrigin: () => {}, setAngles: () => {}, setAlpha: () => {}, setColor: () => {},
    setSize: () => {}, setParallaxDepth: () => {}, setPosition: () => {}, setBrightness: () => {},
    setColorBlendMode: () => {}, getAnimationLayerCount: () => (obj && obj.animationlayers ? obj.animationlayers.length : 1),
    setFrameCount: () => {},
    addEndedCallback: () => {},
  });
  const layerRef = () => {
    const obj = ref.current;
    return {
      getAnimationLayer: (i) => animRef(obj),
      getAnimation: () => animRef(obj),
      // 闊抽/瑙嗛灞傛帶鍒?(bubbleclick 绛夎剼鏈皟 thisLayer.pause() 鈥?缂哄け 鈫?
      // update 鎶涢敊 鈫?鑴氭湰鍚庣画閫昏緫鍏ㄤ涪); 闈欐€佹覆鏌撴棤鎾斁 鈫?no-op
      play: () => {}, pause: () => {}, resume: () => {},
      // 绾圭悊甯у姩鐢?(楦?鏄煎绛?spritesheet): 杩斿洖 {frameCount, duration, getFrame,
      // setFrame, stop, play, pause, resume}銆傛覆鏌撳櫒 spritesheet 璺緞鎸夋椂闂存挱甯?
      // setFrame/pause 閫氳繃 obj._texAnimFrame/_texAnimPaused 褰卞搷 renderImage 鐨?
      // 甯ч€夋嫨 (瑙?image.js spritesheet 鍒嗘敮) 鈥?鑴氭湰鍒囨崲鏄煎甯т笉鍐嶆姏閿欍€?
      getTextureAnimation: () => {
        let info = null;
        try { info = ref.textureInfoFn ? ref.textureInfoFn(obj) : null; } catch { /* ignore */ }
        const frameCount = info && info.frameCount ? info.frameCount : 1;
        const duration = info && info.duration ? info.duration : 1;
        return {
          frameCount,
          duration,
          getFrame: () => (obj && obj._texAnimFrame != null ? obj._texAnimFrame : 0),
          setFrame: (n) => { if (obj) obj._texAnimFrame = Math.max(0, Math.min(frameCount - 1, Math.floor(Number(n) || 0))); },
          stop: () => { if (obj) obj._texAnimPaused = true; },
          pause: () => { if (obj) obj._texAnimPaused = true; },
          play: () => { if (obj) obj._texAnimPaused = false; },
          resume: () => { if (obj) obj._texAnimPaused = false; },
          get isPlaying() { return !(obj && obj._texAnimPaused); },
        };
      },
      getParent: () => ({ origin: new Vec3(0, 0, 0), visible: true }),
      get visible() { return obj ? obj.visible !== false : true; },
      set visible(v) { if (obj) obj.visible = !!v; },
      get origin() { return obj ? parseV(obj.origin, [0, 0, 0]) : new Vec3(0, 0, 0); },
      set origin(v) {
        if (!obj || v == null) return;
        const x = v.x != null ? v.x : v[0];
        const y = v.y != null ? v.y : v[1];
        const z = v.z != null ? v.z : v[2];
        obj.origin = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
      },
      get scale() { return obj ? parseV(obj.scale, [1, 1, 1]) : new Vec3(1, 1, 1); },
      set scale(v) {
        if (!obj || v == null) return;
        const x = v.x != null ? v.x : v[0];
        const y = v.y != null ? v.y : v[1];
        const z = v.z != null ? v.z : v[2];
        obj.scale = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
      },
      get alpha() { return obj ? (obj.alpha != null ? obj.alpha : 1) : 1; },
      set alpha(v) { if (obj) obj.alpha = Number(v); },
      // size 璇诲彇 (闊充箰灏侀潰绛夎剼鏈?`let imageSize = thisLayer.size` 鍚庡仛
      // imageSize.x *= ... 鈥?鏃?layerRef 缂?size getter 鈫?undefined 鈫?宕?
      get size() { return obj ? parseV(obj.size, [0, 0, 0]) : new Vec3(0, 0, 0); },
      set size(v) {
        if (!obj || v == null) return;
        const x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2];
        obj.size = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
      },
      get angles() { return obj ? parseV(obj.angles, [0, 0, 0]) : new Vec3(0, 0, 0); },
      set angles(v) {
        if (!obj || v == null) return;
        const x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2];
        obj.angles = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
      },
      get name() { return obj ? obj.name || '' : ''; },
      get id() { return obj ? obj.id : 0; },
      cursorDetected: false,
      clicked: false,
    };
  };
  const objectRef = () => {
    const obj = ref.current;
    return {
      getMaterial: () => ({}),
      getAnimation: () => animRef(obj),
      get origin() { return obj ? parseV(obj.origin, [0, 0, 0]) : new Vec3(0, 0, 0); },
      set origin(v) { if (obj && v != null) { const x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2]; obj.origin = `${x} ${y} ${z}`; } },
      get scale() { return obj ? parseV(obj.scale, [1, 1, 1]) : new Vec3(1, 1, 1); },
      set scale(v) { if (obj && v != null) { const x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2]; obj.scale = `${x} ${y} ${z}`; } },
      get visible() { return obj ? obj.visible !== false : true; },
      set visible(v) { if (obj) obj.visible = !!v; },
      get name() { return obj ? obj.name || '' : ''; },
      get id() { return obj ? obj.id : 0; },
    };
  };
  return {
    ref,
    makeLayer: layerRef,
    makeObject: objectRef,
    setOwner(o) { ref.current = o; },
  };
}

// 缂栬瘧鑴氭湰: 杩斿洖 { update, applyUserProperties, init, ... } 鍑芥暟 (vm 娌欑)
// opts: { canvasSize, userProps, shared, thisScene, ownerRef, runtime }
// NSL 妯″潡鏄犲皠: import * as X from 'WEColor'/'WEMath' 鈫?瀵瑰簲鍏ㄥ眬瀵硅薄
// (鏃ц浆璇戞妸涓€鍒?import * as 鏄犲皠鍒?__WEColor 鈥?WEMath 妯″潡鐨勫嚱鏁板叏閮ㄤ涪澶?
//  726 Launcher 鎶?"WEMath.smoothStep is not a function" 鈫?update 澶辫触)
export function compileScript(source, opts = {}) {
  // 杞瘧 ESM 瀵煎叆/瀵煎嚭涓?CommonJS
  let code = source;
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, (m, name, mod) => {
    return `const ${name} = ${mod === 'WEMath' ? '__WEMath' : '__WEColor'};`;
  });
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g, (m, names, mod) => {
    const src = mod === 'WEMath' ? '__WEMath' : '__WEColor';
    return `const { ${names} } = ${src};`;
  });
  code = code.replace(/export\s+function\s+(\w+)\s*\(/g, '__exports.$1 = function (');
  code = code.replace(/export\s+var\s+scriptProperties\s*=\s*([^;]+);/g, '__scriptProps = $1;');
  code = code.replace(/export\s+let\s+([\w$]+)\s*=\s*([^;]+);/g, '__exports.$1 = $2;');
  code = code.replace(/export\s+const\s+([\w$]+)\s*=\s*([^;]+);/g, '__exports.$1 = $2;');
  code = code.replace(/export\s*\{([^}]+)\}/g, (m, names) => {
    return names.split(',').map((n) => {
      const nn = n.trim();
      const [orig, alias] = nn.includes(' as ') ? nn.split(' as ').map((s) => s.trim()) : [nn, nn];
      return `__exports.${alias} = ${orig};`;
    }).join('\n');
  });
  // scriptProperties 浣跨敤: 鑴氭湰鍐?`scriptProperties.x` 闇€鎸囧悜鏋勫缓鐨勫睘鎬у璞?
  code = code.replace(/\bscriptProperties\b/g, '__scriptProperties');
  const shared = opts.shared || {};
  const ownerRef = opts.ownerRef || makeOwnerRef();
  const context = {
    __WEColor: WEColor,
    // NSL WEMath 妯″潡 (鑴氭湰 import * as WEMath from 'WEMath')
    __WEMath: {
      mix: (a, b, t) => a + (b - a) * t,
      lerp: (a, b, t) => a + (b - a) * t,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      smoothstep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      smoothStep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      // 瑙掑害鎹㈢畻 (733 Lens Flare 绛夌敤 WEMath.rad2deg; 缂哄け 鈫?angles NaN 鈫?缁勪欢娓叉煋寮傚父)
      rad2deg: 180 / Math.PI,
      deg2rad: Math.PI / 180,
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      pow: Math.pow,
      sqrt: Math.sqrt,
      sin: Math.sin,
      cos: Math.cos,
      PI: Math.PI,
    },
    __exports: {},
    __scriptProps: null, // export var scriptProperties = ... 鍐欏叆
    __scriptProperties: null, // 鑴氭湰鍐?scriptProperties 寮曠敤
    Date, Math, console, JSON, Number, String, Boolean, Object, Array, Set, Map, Promise,
    parseFloat, parseInt, isNaN, isFinite, Infinity, NaN, undefined,
    Vec3, Vec2,
    // localStorage: 閮ㄥ垎澹佺焊鑴氭湰鐢ㄦ祻瑙堝櫒瀛樺偍淇濆瓨鐢ㄦ埛閫夋嫨 (Day/Night 绛? 鈥?
    // vm 娌欑鏃犳祻瑙堝櫒 鈫?ReferenceError 鈫?update 鎶涢敊鍚庣画閫昏緫鍏ㄤ涪銆?
    // 鐢ㄥ唴瀛?shim (姣?SceneRenderer 瀹炰緥涓€浠? shared.localStorage), 璺ㄥ抚淇濈暀銆?
    localStorage: opts.localStorage || makeLocalStorage(),
    // NSL 鏁板宸ュ叿 (726 Launcher 绛夌敤 WEMath.mix/clamp/smoothStep)
    WEMath: {
      mix: (a, b, t) => a + (b - a) * t,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      smoothstep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      smoothStep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      rad2deg: 180 / Math.PI,
      deg2rad: Math.PI / 180,
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
    },
    // 榧犳爣/杈撳叆 (鏈湴鏃犻紶鏍?鈫?鐢诲竷涓績, 闈欐): NSL Dock 閫昏緫 (715 L126
    // input.cursorWorldPosition) 缂哄け 鈫?update 鎶涢敊 鈫?shared 鍊间笉璁＄畻
    input: {
      cursorWorldPosition: new Vec3((opts.canvasSize || { x: 3840 }).x / 2, (opts.canvasSize || { y: 2160 }).y / 2, 0),
      cursorDelta: new Vec3(0, 0, 0),
      cursorVelocity: 0,
      mousePressed: false,
      mouseDelta: new Vec3(0, 0, 0),
    },
    createScriptProperties: () => new ScriptPropertiesBuilder(opts.userProps),
    // thisScene: NSL 鍦烘櫙寮曠敤 鈥?getLayer(name) 杩斿洖鍥惧眰鍖呰 (璇诲啓鐪熷疄鍦烘櫙瀵硅薄)
    thisScene: opts.thisScene || makeSceneRef([]),
    engine: {
      registerAsset: () => ({ getAsset: () => null }),
      // 闊抽棰戣氨缂撳啿 (闊充箰灏侀潰/闊抽鏉¤剼鏈?: 闈欐€佹覆鏌撴棤闊抽杈撳叆 鈫?鍏?0
      // (isMusicPlaying() 璇?average.reduce 鈫?0 鈫?鑴氭湰璧?鏃犻煶涔?鍒嗘敮, 涓嶆姏閿?
      registerAudioBuffers: (n = 16) => {
        const zero = (len) => Array.from({ length: len }, () => 0);
        const avg = zero(n);
        return {
          average: avg,
          left: zero(n), right: zero(n),
          bass: 0, treble: 0,
          volume: 0,
        };
      },
      canvasSize: opts.canvasSize || { x: 3840, y: 2160 },
      runtime: opts.runtime || 0,
      frametime: opts.frametime || 1 / 60,
      userProperties: opts.userProps || {},
      // NSL 搴?(Mutsumi 788 绛? 渚濊禆缂栬緫鍣ㄧ幆澧冩帰娴? 缂哄け姝ゆ柟娉?鈫?鑴氭湰涓€旀姏閿?
      // 鍚庣画 shared 璧嬪€煎叏閮ㄤ涪澶?鈫?鏁翠釜鍔ㄧ敾妗嗘灦澶辨晥
      isRunningInEditor: () => false,
      // setTimeout 蹇呴』寮傛寤惰繜 鈥?鏃у疄鐜扮珛鍗冲悓姝ユ墽琛屽洖璋? NSL 搴撶殑璋冨害閫掑綊
      // (鍔ㄧ敾鎺ㄨ繘/鑺傛祦) 浼氬悓姝ユ棤闄愰€掑綊鍗℃涓荤嚎绋?
      setTimeout: (fn, ms) => {
        const t = setTimeout(() => { try { fn(); } catch { /* ignore */ } }, Math.max(0, Number(ms) || 0));
        return () => clearTimeout(t);
      },
      clearTimeout: (t) => { try { clearTimeout(t); } catch { /* ignore */ } },
    },
    shared,
    thisObject: ownerRef.makeObject(),
    thisLayer: ownerRef.makeLayer(),
  };
  context.globalThis = context;
  vm.createContext(context);
  try {
    vm.runInContext(code, context, { timeout: 2000 });
  } catch (e) {
    return { error: e.message, exports: context.__exports, scriptProps: context.__scriptProps, ownerRef };
  }
  // scriptProperties 鏋勫缓: __scriptProps 鏄?builder 鎴栧璞?
  let props = null;
  if (context.__scriptProps instanceof ScriptPropertiesBuilder) {
    props = context.__scriptProps.finish();
  } else if (context.__scriptProps && typeof context.__scriptProps === 'object') {
    props = context.__scriptProps;
  }
  context.__scriptProperties = props;
  return { exports: context.__exports, scriptProps: props, context, ownerRef };
}

// value 鈫?鑴氭湰鍙搷浣滃璞?(Vec3 / number / 鍘熸牱)
// 娉ㄦ剰: 鍙湁"绾暟瀛?瀛楃涓叉墠杞?Vec3 (濡?"0.5 0.5 0") 鈥?鏂囨湰绫昏剼鏈殑 value
// 鏄璇嶅瓧绗︿覆 (濡?"Text Layer"銆?Good day!"), 璇浆 Vec3 浼氳 update 杩斿洖
// 鐨勬枃鏈 formatResult 鏍煎紡鍖栫牬鍧?(FPS 璁℃暟鍣ㄥ疄娴?"Text Layer" 鈫?"0.000000 ...")
function toValueObj(value) {
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/);
    if (parts.length >= 2 && parts.every((p) => p !== '' && isFinite(Number(p)))) {
      const nums = parts.map(Number);
      return new Vec3(nums[0], nums[1], nums[2] || 0);
    }
    return value; // 闈炵函鏁板瓧瀛楃涓?鈫?淇濇寔鍘熸牱 (鏂囨湰)
  }
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return value;
  return value;
}
// 鑴氭湰杩斿洖鍊?鈫?瀛樺偍鍊?(Vec3/{x,y,z} 鈫?"x y z")
function formatResult(result) {
  if (result instanceof Vec3 || (typeof result === 'object' && !Array.isArray(result) && 'x' in result && 'y' in result && 'z' in result)) {
    return `${Number(result.x).toFixed(6)} ${Number(result.y).toFixed(6)} ${Number(result.z).toFixed(6)}`;
  }
  return result;
}

// 鍒涘缓鑴氭湰杩愯鏃? 缂撳瓨 Map + shared 瀵硅薄 + localStorage shim (姣忎釜 SceneRenderer 瀹炰緥涓€涓?
export function createScriptCache() {
  return { map: new Map(), shared: {}, localStorage: makeLocalStorage() };
}

// 鎵ц鑴氭湰鍊?(缂撳瓨妯″紡): 缂栬瘧涓€娆? init 涓€娆? 姣忓抚 update(value) 鈫?鍐欏洖 obj.value
// opts: { canvasSize, userProps, shared, sceneObjects, thisScene, cache, runtime, frametime, ownerRef }
function runScriptValueCached(scriptVal, time, opts = {}) {
  if (!scriptVal || typeof scriptVal !== 'object' || !('script' in scriptVal)) return;
  const src = scriptVal.script;
  const cache = opts.cache;
  let entry = cache ? cache.get(src) : null;
  if (!entry) {
    const compiled = compileScript(src, {
      canvasSize: opts.canvasSize,
      userProps: opts.userProps,
      shared: opts.shared,
      thisScene: opts.thisScene,
      ownerRef: opts.ownerRef,
      runtime: opts.runtime != null ? opts.runtime : time,
      frametime: opts.frametime,
      localStorage: (cache && cache.localStorage) || opts.localStorage,
    });
    entry = {
      exports: compiled.exports || {},
      error: compiled.error,
      scriptProps: compiled.scriptProps,
      context: compiled.context || null,
      initialized: false,
      ownerRef: compiled.ownerRef,
    };
    if (cache) cache.set(src, entry);
  }
  const exports = entry.exports;
  if (entry.error && !exports.update && !exports.applyUserProperties && !exports.init) {
    return; // 鑴氭湰缂栬瘧澶辫触涓旀棤鍙敤瀵煎嚭 鈫?淇濇寔闈欐€?value
  }
  // 瀵硅薄绾?scriptproperties 瑕嗙洊 (WE 缂栬緫鍣ㄤ繚瀛樼殑鐢ㄦ埛璋冩暣 + user 灞炴€х粦瀹?:
  // scene.json 瀵硅薄涓婄殑 scriptproperties 鏄璁″櫒瀛樼洏鍊? 鏍煎紡 {name: value} 鎴?
  // {name: {user: 鐢ㄦ埛灞炴€у悕, value: 榛樿}} 鈥?杩愯鏃惰 userProps 褰撳墠鍊?(鐢ㄦ埛
  // 鍦?project.json 鏀硅繃鍒欑敓鏁?, 鏃犺閿洖閫€ value銆傝剼鏈紪璇戞湡 createScriptProperties
  // 鍙惈鑴氭湰鍐呭０鏄庣殑榛樿, 涓嶅惈瀵硅薄瀛樼洏瑕嗙洊 鈫?涓嶅簲鐢ㄥ垯鏃堕挓 12/24h銆佸垎闅旂绛?
  // 鍏ㄧ敤鑴氭湰榛樿 (鐢ㄦ埛璋冩暣涓㈠け)銆傜紦瀛樻寜 src 鍏变韩, context.__scriptProperties
  // 姣忔鎸夊綋鍓嶅璞￠噸鏂拌鐩?(鍚岃剼鏈瀵硅薄涓嶅悓瑕嗙洊涓嶄覆)銆?
  if (scriptVal.scriptproperties && entry.context) {
    const props = Object.assign({}, entry.scriptProps || {});
    for (const [k, v] of Object.entries(scriptVal.scriptproperties)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.user === 'string' && v.user) {
          const uv = (opts.userProps || {})[v.user];
          props[k] = uv !== undefined && uv !== null ? uv : v.value;
        } else if ('value' in v) {
          props[k] = v.value;
        } else {
          props[k] = v;
        }
      } else {
        props[k] = v;
      }
    }
    entry.context.__scriptProperties = props;
  }
  // ownerRef 鏄娆＄紪璇戞椂鍒涘缓鐨勫叡浜唬鐞?(entry 鎸佹湁); setOwner 鎸囧悜褰撳墠鑴氭湰
  // 鎵€灞炲璞?鈥?缂撳瓨鍏变韩鏉＄洰鍦ㄥ涓璞￠棿涓嶄覆
  const ownerRef = entry.ownerRef;
  if (ownerRef && ownerRef.setOwner) ownerRef.setOwner(opts.currentObject || null);
  // 绾圭悊鍔ㄧ敾淇℃伅 hook (getTextureAnimation 鐨?frameCount/duration 鏉ユ簮)
  if (ownerRef && opts.textureInfoFn) ownerRef.textureInfoFn = opts.textureInfoFn;
  const valueObj = toValueObj(scriptVal.value);
  const onError = opts.onError || null;
  try {
    if (!entry.initialized && typeof exports.init === 'function') {
      // NSL init(value): 涓€娆℃€у垵濮嬪寲 (濡傚惎鍔ㄩ楠煎姩鐢?, 杩斿洖鏂板€?
      const r = exports.init(valueObj);
      if (r != null) scriptVal.value = formatResult(r);
      entry.initialized = true;
    }
    // applyUserProperties: NSL 璇箟鍦ㄧ敤鎴峰睘鎬у彉鍖栨椂璋冪敤 (715 Dock 閫昏緫鐨?
    // shared.minScale/maxScale/radius 閮藉湪杩欓噷璁＄畻)銆傛湰鍦版棤鍙樺寲妫€娴?鈫?棣栨
    // 鎵ц涓€娆?(灞炴€у浐瀹? 骞傜瓑); 涓嶆墽琛屽垯渚濊禆瀹冪殑鑴氭湰璇诲埌 undefined銆?
    if (!entry.userPropsApplied && typeof exports.applyUserProperties === 'function') {
      exports.applyUserProperties({});
      entry.userPropsApplied = true;
    }
    if (typeof exports.update === 'function') {
      // sf44: update 鎵ц绉诲叆 vm.runInContext 骞跺甫 timeout 鈥?鏃у疄鐜扮洿鎺ヨ皟鐢?
      // exports.update(valueObj) (涓荤嚎绋嬪悓姝ユ墽琛?, 鍧忚剼鏈?(濡?Amiya 鏌愭椂閽熻剼鏈?
      // 鐨?while 姝诲惊鐜? 浼氭案涔呭崱姝绘覆鏌撶嚎绋? 褰卞搷鎵€鏈夊満鏅€倂m 鐨?timeout 鍙?
      // 瑕嗙洊缂栬瘧鏈?(compileScript 鍐?runInContext), 鍑芥暟浣撴墽琛屾棤淇濇姢銆?
      // 鐢ㄥ悓涓€ context 鎵ц: 鑴氭湰鑳借闂嚜韬ā鍧椾綔鐢ㄥ煙 (__exports), valueObj
      // 閫氳繃 context.__valueObj 浼犲叆銆倀imeout 500ms 鈥?姝ｅ父鑴氭湰 (鏃堕挓/浣嶇疆
      // 璁＄畻) 寰绾у畬鎴? 姝诲惊鐜涓柇 鈫?vm 鎶?Error 鈫?璧?catch 淇濇寔鍘?value銆?
      if (entry.context) {
        try {
          entry.context.__valueObj = valueObj;
          const result = vm.runInContext('__exports.update(__valueObj)', entry.context, { timeout: 500 });
          if (result != null) scriptVal.value = formatResult(result);
        } catch (e) {
          if (onError) {
            try {
              const owner = opts.currentObject ? (opts.currentObject.name || '#' + opts.currentObject.id) : '?';
              onError('script[' + owner + '] update(timeout/err): ' + (e && e.message ? e.message : String(e)));
            } catch { /* ignore */ }
          }
        }
      } else {
        // 鏃?context (缂栬瘧澶辫触浣?update 鍙敤) 鈫?鐩存帴璋冪敤 (鏃ц涓? 灏戣)
        const result = exports.update(valueObj);
        if (result != null) scriptVal.value = formatResult(result);
      }
    }
  } catch (e) {
    // 杩愯鏃堕敊璇?鈫?淇濇寔褰撳墠 value (鏃у疄鐜伴潤榛樺悶鎺? 鐜板湪鍙瘖鏂? 璁板綍鍒?
    // renderer._scriptErrors, worker 缁撴潫鏃堕殢 gpuDiag 杈撳嚭 鈥?"娓叉煋鎴愬姛浣嗗唴瀹?
    // 閿?鐨勮剼鏈け璐ヤ笉鍐嶄笉鍙)
    if (onError) {
      try {
        const owner = opts.currentObject ? (opts.currentObject.name || '#' + opts.currentObject.id) : '?';
        const dbg = (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : '');
        onError('script[' + owner + '] update: ' + (e && e.message ? e.message : String(e)) + (dbg ? ' || ' + dbg : ''));
      } catch { /* ignore */ }
    }
  }
}

// 鎵弿骞舵墽琛屽満鏅墍鏈?{script, value} 瀵硅薄 (鏇存柊鍒板師瀵硅薄鏍?
// opts: { canvasSize, userProps, scriptCache, renderObjects, runtime }
// P4a: 状态脚本判定 — 含动画调度/时间累积/事件模式的脚本才需要静态帧快进重跑
// (纯属性/文本脚本每次 update 幂等, 重跑无意义还费时)
const STATEFUL_SCRIPT_RE = /aniScheduler|engine\.frametime|\bframetime\b|smoothValue|\bsetTimeout|startAnimation|getAnimation|\.play\s*\(|\.runtime\b|\btime\s*\+?=|\bcount\s*\+?=|_addFrametime/;
function isStatefulScript(src) {
  return typeof src === 'string' && STATEFUL_SCRIPT_RE.test(src);
}

// 扫描场景所有 {script, value} 对象 (与 applySceneScripts 的 walk 同语义)
// 返回 [[obj, owner], ...] (文档序)
function collectScriptValues(scene) {
  const out = [];
  const walk = (obj, owner) => {
    if (!obj || typeof obj !== 'object') return;
    if ('script' in obj && 'value' in obj && typeof obj.script === 'string') {
      out.push([obj, owner]);
      return; // script 对象内部不再含 script 子对象
    }
    if (Array.isArray(obj)) { obj.forEach((x) => walk(x, x)); return; }
    for (const k of Object.keys(obj)) walk(obj[k], obj);
  };
  walk(scene, null);
  return out;
}

export function applySceneScripts(scene, time, opts = {}) {
  const cache = opts.scriptCache && opts.scriptCache.map ? opts.scriptCache : null;
  const shared = (cache ? cache.shared : null) || opts.shared || {};
  // 娓叉煋瀵硅薄鍒楄〃 (this.objects, 宸茬儤鐒? 鈥?鑴氭湰鍐欒繖浜涘璞?鈫?娓叉煋鐩存帴鐢熸晥
  const sceneObjects = opts.renderObjects || (scene.objects || []).map((o) => o);
  const thisScene = makeSceneRef(sceneObjects);
  const ownerRef = makeOwnerRef();
  const walk = (obj, owner) => {
    if (!obj || typeof obj !== 'object') return;
    if ('script' in obj && 'value' in obj && typeof obj.script === 'string') {
      runScriptValueCached(obj, time, {
        canvasSize: opts.canvasSize,
        userProps: opts.userProps,
        shared,
        sceneObjects,
        thisScene,
        cache: cache ? cache.map : null,
        ownerRef,
        currentObject: owner || null,
        runtime: opts.runtime,
        frametime: opts.frametime,
        onError: opts.onError,
        textureInfoFn: opts.textureInfoFn,
      });
      return; // script 瀵硅薄鍐呴儴涓嶅啀鍚?script 瀛愬璞?
    }
    if (Array.isArray(obj)) {
      // 鏁扮粍鍏冪礌 owner = 鍏冪礌鑷韩 (script 甯告寕鍦ㄥ璞″睘鎬т笂, 鍏?thisObject = 瀵硅薄)
      obj.forEach((x) => walk(x, x));
      return;
    }
    for (const k of Object.keys(obj)) walk(obj[k], obj);
  };
  walk(scene, null);
  // P4a 静态帧脚本时间轴快进 (根因 A): NSL 调度器 `time += engine.frametime`
  // (每 update 一次, 见 NSL AnimationScheduler.calcInterpolators) — 静态帧只有
  // 1 次 update(frametime=1/60) → 脚本动画停在 init 态。把剩余场景时间切成
  // ≤fastForwardSteps 步逐次重跑状态脚本, 让动画时钟到达场景时间 t。
  // 纯属性脚本 (幂等) 不重跑。
  const ffSteps = opts.fastForwardSteps || 0;
  const ffStep = opts.fastForwardStep || 0;
  if (ffSteps > 0 && ffStep > 0) {
    const stateful = collectScriptValues(scene).filter(([obj]) => isStatefulScript(obj.script));
    if (stateful.length) {
      for (let s = 0; s < ffSteps; s++) {
        for (const [obj, owner] of stateful) {
          runScriptValueCached(obj, time, {
            canvasSize: opts.canvasSize,
            userProps: opts.userProps,
            shared,
            sceneObjects,
            thisScene,
            cache: cache ? cache.map : null,
            ownerRef,
            currentObject: owner || null,
            runtime: opts.runtime,
            frametime: ffStep,
            onError: opts.onError,
            textureInfoFn: opts.textureInfoFn,
          });
        }
      }
    }
  }
  return shared;
}
