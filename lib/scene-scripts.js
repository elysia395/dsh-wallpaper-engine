// WE scene scripts 运行时: 执行 {script, value} 对象的 JS 脚本
// 支持: export function update(value) — 每帧更新 (返回新值)
//       export function applyUserProperties(changed) — 用户属性变化更新
//       export function init() — 初始化 (如 App Dock 复杂脚本)
// 提供 WEColor / createScriptProperties / engine.canvasSize / Vec3 等引擎 API (vm 沙箱)
// 用户属性 (project.json general.properties) 注入 scriptProperties (user 映射)
import vm from 'node:vm';
import { WEColor, Vec3, ScriptPropertiesBuilder } from './scene-script-apis.js';

// NSL thisScene: getLayer(name) → 图层包装, 读写真实场景对象属性
// origin/scale/size 字符串 "x y z" ↔ Vec3; visible/alignment 直接读写
export function makeSceneRef(objects) {
  const parseV = (s, def) => {
    const p = String(s == null ? '' : s).trim().split(/\s+/).map(Number);
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

// 编译脚本: 返回 { update, applyUserProperties, init, ... } 函数 (vm 沙箱)
// opts: { canvasSize: {x,y}, userProps: {name: value}, shared: {}, runtime }
function compileScript(source, opts = {}) {
  // 转译 ESM 导入/导出为 CommonJS (脚本用 import * as WEColor / export function)
  let code = source;
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['\"]([^'\"]+)['\"]/g, 'const $1 = __WEColor;');
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]/g, 'const { $1 } = __WEColor;');
  code = code.replace(/export\s+function\s+(\w+)\s*\(/g, '__exports.$1 = function (');
  code = code.replace(/export\s+var\s+scriptProperties\s*=\s*([^;]+);/g, '__scriptProps = $1;');
  code = code.replace(/export\s+let\s+([\w$]+)\s*=\s*([^;]+);/g, '__exports.$1 = $2;');
  code = code.replace(/export\s+const\s+([\w$]+)\s*=\s*([^;]+);/g, '__exports.$1 = $2;');
  code = code.replace(/export\s*\{([^}]+)\}/g, (m, names) => {
    return names.split(',').map((n) => {
      const nn = n.trim();
      const [orig, alias] = nn.includes(' as ') ? nn.split(' as ').map(s => s.trim()) : [nn, nn];
      return `__exports.${alias} = ${orig};`;
    }).join('\n');
  });
  // scriptProperties 使用: 脚本内 `scriptProperties.x` 需指向构建的属性对象
  code = code.replace(/\bscriptProperties\b/g, '__scriptProperties');
  const shared = opts.shared || {};
  const context = {
    __WEColor: WEColor,
    __exports: {},
    __scriptProps: null, // export var scriptProperties = ... 写入
    __scriptProperties: null, // 脚本内 scriptProperties 引用
    Date, Math, console, JSON, Number, String, Boolean, Object, Array, Set, Map, Promise,
    parseFloat, parseInt, isNaN, isFinite, Infinity, NaN, undefined, globalThis: null,
    Vec3,
    createScriptProperties: () => new ScriptPropertiesBuilder(opts.userProps),
    // thisScene: NSL 场景引用 — getLayer(name) 返回图层包装 (读写真实场景对象)
    // (NSL Dock 类: icons = ICON_NAMES.map(name => thisScene.getLayer(name)),
    //  脚本设置 icon.origin/visible 驱动图标层)
    thisScene: makeSceneRef(opts.sceneObjects),
    engine: {
      registerAsset: () => ({ getAsset: () => null }),
      canvasSize: opts.canvasSize || { x: 3840, y: 2160 },
      runtime: opts.runtime || 0,
      frametime: opts.frametime || 1 / 60,
      userProperties: opts.userProps || {},
      setTimeout: (fn) => { try { fn(); } catch {} return () => {}; },
      clearTimeout: () => {},
    },
    shared,
    thisObject: { getMaterial: () => ({}), origin: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1), visible: true },
    thisLayer: {
      getAnimationLayer: () => ({ play: () => {}, setFrame: () => {}, setTime: () => {}, setFps: () => {}, setVisible: () => {}, setBlend: () => {}, setRate: () => {}, setScale: () => {}, setOrigin: () => {}, setAngles: () => {}, setAlpha: () => {}, setColor: () => {}, setSize: () => {}, setParallaxDepth: () => {}, setPosition: () => {}, setBrightness: () => {}, setColorBlendMode: () => {}, getAnimationLayerCount: () => 1, setFrameCount: () => {} }),
      getParent: () => ({ origin: new Vec3(0, 0, 0), visible: true }),
      origin: new Vec3(0, 0, 0), scale: new Vec3(1, 1, 1), visible: true, alpha: 1,
      name: '', id: 0,
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  try {
    vm.runInContext(code, context, { timeout: 2000 });
  } catch (e) {
    return { error: e.message, exports: context.__exports, scriptProps: context.__scriptProps };
  }
  // scriptProperties 构建: __scriptProps 是 builder 或对象
  let props = null;
  if (context.__scriptProps instanceof ScriptPropertiesBuilder) {
    props = context.__scriptProps.finish();
  } else if (context.__scriptProps && typeof context.__scriptProps === 'object') {
    props = context.__scriptProps;
  }
  context.__scriptProperties = props;
  return { exports: context.__exports, scriptProps: props, context };
}

// 执行脚本值: 对 {script, value, scriptproperties} 对象运行脚本更新 value
// opts: { canvasSize, userProps, shared, runtime }
export function runScriptValue(scriptVal, time, opts = {}) {
  if (!scriptVal || typeof scriptVal !== 'object' || !('script' in scriptVal)) return scriptVal;
  const fn = compileScript(scriptVal.script, {
    canvasSize: opts.canvasSize,
    userProps: opts.userProps,
    shared: opts.shared,
    sceneObjects: opts.sceneObjects,
    runtime: opts.runtime != null ? opts.runtime : time,
    frametime: opts.frametime,
  });
  const exports = fn.exports || {};
  if (fn.error && !exports.update && !exports.applyUserProperties && !exports.init) {
    return scriptVal.value; // 脚本编译失败且无可用导出 → 静态 value
  }
  try {
    if (typeof exports.init === 'function') exports.init();
    if (typeof exports.update === 'function') {
      // update(value): value 是字符串 "x y z" 或数值; 脚本内 value.x = ... 需转换
      let value = scriptVal.value;
      let valueObj = null;
      if (typeof value === 'string' && value.trim().split(/\s+/).length >= 2) {
        const p = value.trim().split(/\s+/).map(Number);
        valueObj = new Vec3(p[0] || 0, p[1] || 0, p[2] || 0);
      } else if (typeof value === 'number') {
        valueObj = value;
      } else if (value && typeof value === 'object') {
        valueObj = value;
      }
      const result = exports.update(valueObj);
      if (result == null) return scriptVal.value;
      // Vec3 / {x,y,z} → "x y z"
      if (result instanceof Vec3 || (typeof result === 'object' && !Array.isArray(result) && 'x' in result && 'y' in result && 'z' in result)) {
        return `${Number(result.x).toFixed(6)} ${Number(result.y).toFixed(6)} ${Number(result.z).toFixed(6)}`;
      }
      return result;
    }
    if (typeof exports.applyUserProperties === 'function') {
      exports.applyUserProperties({});
      return scriptVal.value;
    }
  } catch { /* 运行时错误 → 用 value */ }
  return scriptVal.value;
}

// 扫描并执行场景所有 {script, value} 对象 (更新到原对象树)
// opts: { canvasSize, userProps, shared }
export function applySceneScripts(scene, time, opts = {}) {
  const shared = opts.shared || {};
  const sceneObjects = (scene.objects || []).map((o) => o);
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if ('script' in obj && 'value' in obj && typeof obj.script === 'string') {
      const v = runScriptValue(obj, time, {
        canvasSize: opts.canvasSize,
        userProps: opts.userProps,
        shared,
        sceneObjects,
        runtime: opts.runtime,
        frametime: opts.frametime,
      });
      if (v !== undefined) obj.value = v;
      return; // script 对象内部不再含 script 子对象
    }
    if (Array.isArray(obj)) obj.forEach(walk);
    else for (const k of Object.keys(obj)) walk(obj[k]);
  };
  walk(scene);
  return shared;
}
