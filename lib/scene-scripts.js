// WE scene scripts 运行时: 执行 {script, value} 对象的 JS 脚本 (NSL)
// 支持: export function update(value) — 每帧更新 (返回新值)
//       export function applyUserProperties(changed) — 用户属性变化更新
//       export function init(value) — 初始化一次 (返回新值; NSL init(value))
// 提供 WEColor / createScriptProperties / engine.canvasSize / Vec3 等引擎 API (vm 沙箱)
// 用户属性 (project.json general.properties) 注入 scriptProperties (user 映射)
//
// 关键设计 (sf35 重构): 脚本**编译一次、状态跨帧保留** — 旧实现每帧重编译导致
// NSL 脚本内部状态 (计数器/动画调度器) 每帧重置、大型脚本每帧编译 CPU 爆表,
// 且 init() 每帧重复调用。现在:
//   - createScriptCache() 持有 {map: Map<源码, 编译条目>, shared}
//   - 每个 SceneRenderer 实例一个 cache (scene-anim 多帧复用实例 → 状态跨帧保留)
//   - 同一源码只编译一次; init() 只在首次执行; 每帧只调 update(value)
//   - thisObject/thisLayer 通过 ownerRef 桥指向"当前脚本所属对象" (缓存共享
//     时对象不串); 读写真实渲染对象 (origin/scale/visible/alpha/animationlayers)
//   - engine API 补全 (isRunningInEditor 等) — NSL 库 (如 Mutsumi 788) 缺失
//     方法时中途抛错 → 后续 shared 赋值全部丢失 → 整个动画框架失效
//
// 沙箱安全 (P-01): 脚本在 scene-render-worker (完整 Node 权限) 内执行, 旧实现把
// 宿主创建的函数/类/Math/console 直接放进 context, 任意对象 .constructor.constructor
// 即得宿主 Function → 主进程任意代码执行 (已复现 12 条逃逸链)。现约定:
//   1. context 为 null 原型对象且禁用 strings 代码生成 (eval/new Function);
//   2. 脚本可见的一切类/函数都在沙箱 realm 内由 bootstrap 创建 (Vec3/WEColor/
//      WEMath/ScriptPropertiesBuilder/engine API/thisScene/thisObject 包装),
//      其 .constructor 链终止于沙箱 Function, 永远够不到宿主;
//   3. 宿主回调 (图层读写/ownerRef/定时器/console) 只在 bootstrap 期间经
//      context.__bridge 一次性注入, bootstrap 结束后立即删除 — 脚本运行期
//      context 内不存在任何宿主对象;
//   4. 宿主↔沙箱只交换基元与纯数据 (scriptProperties 合并、返回值格式化都在
//      沙箱内完成, 宿主不直接触碰脚本可控对象 — 避免恶意 getter 在宿主栈上执行);
//   5. 宿主调用沙箱一律经 vm.Script 入口 (V8 只在 runInContext 边界过滤跨上下文
//      栈帧; 直接调用沙箱函数会把宿主函数暴露给 Error.prepareStackTrace)。
//
// 超时保护 (P-13): 编译与 init/applyUserProperties/update/setTimeout 回调分别有
// 超时 (vm timeout 中断同步死循环); update 连续超时 → 记日志并停用该脚本条目,
// 死循环不再拖垮整帧渲染。
import vm from 'node:vm';
import { WEColor, Vec3, ScriptPropertiesBuilder } from './scene-script-apis.js';

// ── P-13 超时常量 ──────────────────────────────────────────────
const COMPILE_TIMEOUT = 2000;  // 顶层编译/沙箱引导 (原有 2s 保留)
const INIT_TIMEOUT = 1000;     // init/applyUserProperties (一次性, 给足)
const UPDATE_TIMEOUT = 100;    // 每帧 update (正常为微秒级)
const CALL_TIMEOUT = 250;      // engine.setTimeout 回调
const SCRIPT_DEAD_TIMEOUTS = 10; // 连续超时上限 → 停用脚本条目

// ── P-16: 字符串/注释安全的正则替换 ────────────────────────────
// 计算"字符串字面量 + 注释"区间; 模板插值 ${..} 内按代码处理 (其内的
// scriptProperties 引用仍需改写), 正则字面量不识别 (场景脚本无 /'/ 类写法)。
function stringCommentRanges(code) {
  const ranges = [];
  const stack = []; // 模板插值栈: {start, dollar, brace} 记录进入插值时的花括号深度
  let st = 'code', start = 0, brace = 0;
  const endTok = (i, extra) => { ranges.push([start, i + extra]); st = 'code'; };
  for (let i = 0; i < code.length; i++) {
    const c = code[i], d = code[i + 1];
    if (st === 'code') {
      if (c === '/' && d === '/') { start = i; st = 'line'; i++; }
      else if (c === '/' && d === '*') { start = i; st = 'block'; i++; }
      else if (c === "'") { start = i; st = 'single'; }
      else if (c === '"') { start = i; st = 'double'; }
      else if (c === '`') { start = i; st = 'template'; }
      else if (c === '{') brace++;
      else if (c === '}') {
        if (stack.length && stack[stack.length - 1].brace === brace) {
          // 插值收尾: ${..} 之后的模板字面部分继续按字符串处理
          const fr = stack.pop();
          ranges.push([fr.start, fr.dollar + 2]);
          start = i + 1;
          st = 'template';
        } else if (brace > 0) brace--;
      }
    } else if (st === 'line') {
      if (c === '\n' || c === '\r') endTok(i, 0);
    } else if (st === 'block') {
      if (c === '*' && d === '/') { i++; endTok(i, 1); }
    } else if (st === 'single' || st === 'double') {
      if (c === '\\') i++;
      else if (c === '\n') endTok(i, 0); // 未闭合 → 容错截断 (语法错误交给 vm 报)
      else if ((st === 'single' && c === "'") || (st === 'double' && c === '"')) endTok(i, 1);
    } else { // template
      if (c === '\\') i++;
      else if (c === '`') endTok(i, 1);
      else if (c === '$' && d === '{') { stack.push({ start, dollar: i, brace }); i++; st = 'code'; }
    }
  }
  if (st !== 'code') ranges.push([start, code.length]);
  return ranges;
}

// 只在字符串/注释区间之外执行正则替换 (P-16: 旧 \bscriptProperties\b 全局替换
// 会误改字符串字面量内容, 如提示文案 "scriptProperties.x 不可用")
function replaceSafe(code, regex, replacer) {
  const ranges = stringCommentRanges(code);
  const covered = (idx) => {
    for (let r = 0; r < ranges.length; r++) if (idx >= ranges[r][0] && idx < ranges[r][1]) return true;
    return false;
  };
  return code.replace(regex, (...args) => {
    const off = args[args.length - 2]; // replace 回调倒数第二个参数 = 匹配偏移
    return covered(off) ? args[0] : replacer(...args);
  });
}

// 转译 ESM 导入/导出为 CommonJS (NSL 模块映射: import * as X from
// 'WEColor'/'WEMath' → 对应沙箱全局; 旧转译把一切 import * as 映射到 __WEColor
// — WEMath 模块的函数全部丢失, 726 Launcher 报 "WEMath.smoothStep is not a
// function" → update 失败)
function transpileScript(source) {
  let code = source;
  code = replaceSafe(code, /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, (m, name, mod) => {
    return `const ${name} = ${mod === 'WEMath' ? '__WEMath' : '__WEColor'};`;
  });
  code = replaceSafe(code, /import\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g, (m, names, mod) => {
    const src = mod === 'WEMath' ? '__WEMath' : '__WEColor';
    return `const { ${names} } = ${src};`;
  });
  code = replaceSafe(code, /export\s+function\s+(\w+)\s*\(/g, (m, name) => `__exports.${name} = function (`);
  code = replaceSafe(code, /export\s+var\s+scriptProperties\s*=\s*([^;]+);/g, (m, val) => `__scriptProps = ${val};`);
  code = replaceSafe(code, /export\s+let\s+([\w$]+)\s*=\s*([^;]+);/g, (m, name, val) => `__exports.${name} = ${val};`);
  code = replaceSafe(code, /export\s+const\s+([\w$]+)\s*=\s*([^;]+);/g, (m, name, val) => `__exports.${name} = ${val};`);
  code = replaceSafe(code, /export\s*\{([^}]+)\}/g, (m, names) => {
    return names.split(',').map((n) => {
      const nn = n.trim();
      const [orig, alias] = nn.includes(' as ') ? nn.split(' as ').map((s) => s.trim()) : [nn, nn];
      return `__exports.${alias} = ${orig};`;
    }).join('\n');
  });
  // scriptProperties 使用: 脚本内 `scriptProperties.x` 需指向构建的属性对象
  // (P-16: 现跳过字符串/注释 — 旧行为会把提示字符串里的字样一并改写)
  code = replaceSafe(code, /\bscriptProperties\b/g, () => '__scriptProperties');
  return code;
}

// ── NSL thisScene 宿主桥 (P-01 重构) ──────────────────────────
// getLayer(name)/getSceneObject(id) 的原始属性读写: 只交换基元 (宿主包装对象
// 不再进沙箱, 其 .constructor 会通向宿主 Function); Vec3 解析在沙箱侧完成。
// 脚本对象 {script, value} 取 value (715 读 Launcher scale 时其脚本可能尚未
// 执行/已执行 — 读最终 value 而非原始 {script,value} 对象)
export function makeSceneRef(objects) {
  const objList = Array.isArray(objects) ? objects : [];
  const rawVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const find = (pred) => objList.find(pred) || null;
  // 缺失图层默认值 (旧实现假对象 layer({name, origin:'0 0 0', scale:'1 1 1', size:'0 0 0', visible:true, id:-1}))
  const DEFAULTS = { origin: '0 0 0', scale: '1 1 1', size: '0 0 0', visible: true, id: -1, alignment: undefined };
  const warned = new Set();
  const warnMissing = (name) => {
    if (warned.has(name)) return;
    warned.add(name);
    // P-16: 旧实现静默返回假对象, 图层名拼错/被裁剪时无从排查
    console.warn(`[scene-scripts] thisScene.getLayer("${name}"): 图层不存在, 返回占位假对象 (写入将被忽略)`);
  };
  // 读: 只回基元 (对象一律 String 化 — 与旧 parseV 的 String() 行为一致)
  const readProp = (obj, prop, name) => {
    if (!obj) return prop === 'name' ? name : DEFAULTS[prop];
    const v = rawVal(obj[prop]);
    return v && typeof v === 'object' ? String(v) : v;
  };
  // 写: origin 传沙箱侧解析好的 [x,y,z] 数字数组, 格式沿用旧实现 (toFixed(6))
  const writeProp = (obj, prop, v) => {
    if (prop === 'visible') obj.visible = !!v;
    else if (prop === 'alignment') obj.alignment = v;
    else if (prop === 'origin') obj.origin = `${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`;
  };
  return {
    layerExists(name) { const o = find((x) => x && x.name === name); if (!o) warnMissing(name); return o; },
    layerGet(name, prop) { return readProp(find((x) => x && x.name === name), prop, name); },
    layerSet(name, prop, v) {
      const o = find((x) => x && x.name === name);
      if (!o) { warnMissing(name); return; } // 假对象写入丢弃 (旧实现同)
      writeProp(o, prop, v);
    },
    objExists(id) { return !!find((x) => x && x.id === id); },
    objGet(id, prop) { return readProp(find((x) => x && x.id === id), prop, ''); },
    objSet(id, prop, v) { const o = find((x) => x && x.id === id); if (o) writeProp(o, prop, v); },
  };
}

// ── 当前脚本所属对象宿主桥 (P-01 重构) ─────────────────────────
// thisObject/thisLayer 在沙箱内构造, 属性读写经此桥转发到 ref.current
// (每次 update 前 setOwner 更新 — 缓存共享的编译条目在多个对象间不串)。
function makeOwnerRef() {
  const ref = { current: null };
  const rawVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const getRaw = (kind, prop) => {
    const o = ref.current;
    if (prop === 'visible') return o ? o.visible !== false : true;
    if (prop === 'name') return o ? o.name || '' : '';
    if (prop === 'id') return o ? o.id : 0;
    if (kind === 'layer' && prop === 'alpha') return o ? (o.alpha != null ? o.alpha : 1) : 1;
    if (prop === 'scale') return o ? rawVal(o.scale) : '1 1 1';
    return o ? rawVal(o.origin) : ''; // origin → 沙箱 parseV 兜底 [0,0,0]
  };
  return {
    ref,
    setOwner(o) { ref.current = o; },
    get(kind, prop) { const v = getRaw(kind, prop); return v && typeof v === 'object' ? String(v) : v; },
    set(kind, prop, v) {
      const o = ref.current;
      if (!o) return; // 无当前对象 → 丢弃 (旧实现同)
      if (prop === 'visible') { o.visible = !!v; return; }
      if (prop === 'alpha') { o.alpha = Number(v); return; }
      // layerRef 用 toFixed(6)、objectRef 用原值 — 保留旧格式 (NSL 兼容)
      const s = kind === 'layer'
        ? `${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`
        : `${v[0]} ${v[1]} ${v[2]}`;
      if (prop === 'origin') o.origin = s;
      else if (prop === 'scale') o.scale = s;
    },
    animCount() { const o = ref.current; return o && o.animationlayers ? o.animationlayers.length : 1; },
  };
}

// ── 沙箱引导源码 (P-01 核心) ──────────────────────────────────
// 脚本可见的类源码直接取自 scene-script-apis.js 的宿主定义 (Function.toString),
// 在沙箱 realm 内重新求值 — 单一实现来源, 不维护两份。
const SANDBOX_CLASSES_SRC =
  `const Vec3 = ${Vec3.toString()};\n` +
  `const WEColor = { ${WEColor.hsv2rgb.toString()}, ${WEColor.rgb2hsv.toString()} };` + // 方法简写整体嵌入
  `\nconst ScriptPropertiesBuilder = ${ScriptPropertiesBuilder.toString()};\n`;

const SANDBOX_BOOTSTRAP = String.raw`
(function () {
var b = globalThis.__bridge; // 宿主桥 (bootstrap 结束后由宿主删除全局引用)
${SANDBOX_CLASSES_SRC}
// 纯数据深拷贝: 基元/普通对象/数组 (限深限量), 函数/Symbol 等一律丢弃 —
// 宿主送来的 userProps/覆盖值、脚本返回值都经此净化
function copyPlain(v, depth) {
  if (v === null || typeof v !== 'object') return (typeof v === 'function' || typeof v === 'symbol') ? undefined : v;
  if ((depth || 0) > 6) return undefined;
  if (Array.isArray(v)) {
    var a = [];
    for (var i = 0; i < v.length && i < 256; i++) a[i] = copyPlain(v[i], (depth || 0) + 1);
    return a;
  }
  var o = {}, n = 0;
  for (var k in v) { if (n++ > 512) break; o[k] = copyPlain(v[k], (depth || 0) + 1); }
  return o;
}
function fmtArgs(args) {
  var out = [];
  for (var i = 0; i < args.length; i++) {
    var x = args[i];
    if (typeof x === 'string') out.push(x);
    else { try { out.push(JSON.stringify(x)); } catch (e) { out.push(String(x)); } }
  }
  return out.join(' ');
}
// "x y z" 字符串 → Vec3 (与旧宿主 parseV 逐行为一致)
function parseV(s, def) {
  var v = (s && typeof s === 'object' && 'value' in s) ? s.value : s;
  var p = String(v == null ? '' : v).trim().split(/\s+/).map(Number);
  return new Vec3(p[0] != null ? p[0] : def[0], p[1] != null ? p[1] : def[1], p[2] != null ? p[2] : def[2]);
}
// Vec3/{x,y,z}/类数组 → [x,y,z] 数字数组 (跨桥写入的统一载荷)
function xyz(v) {
  var x = v.x != null ? v.x : v[0];
  var y = v.y != null ? v.y : v[1];
  var z = v.z != null ? v.z : v[2];
  return [Number(x), Number(y), Number(z)];
}
var userProps = copyPlain(b.userProps()) || {};
var canvasSize = copyPlain(b.canvasSize()) || { x: 3840, y: 2160 };
// NSL 数学工具 (726 Launcher 等用 WEMath.mix/clamp/smoothStep; rad2deg 供 733
// Lens Flare 等角度换算); min/max/... 直接取本 realm 的 Math — 构造函数链不出境
var WEMath = {
  mix: function (a, c, t) { return a + (c - a) * t; },
  lerp: function (a, c, t) { return a + (c - a) * t; },
  clamp: function (v, a, c) { return Math.max(a, Math.min(c, v)); },
  smoothstep: function (a, c, x) { var t = Math.max(0, Math.min(1, (x - a) / (c - a || 1))); return t * t * (3 - 2 * t); },
  smoothStep: function (a, c, x) { var t = Math.max(0, Math.min(1, (x - a) / (c - a || 1))); return t * t * (3 - 2 * t); },
  rad2deg: 180 / Math.PI,
  deg2rad: Math.PI / 180,
  min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  pow: Math.pow, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, PI: Math.PI,
};
globalThis.Vec3 = Vec3;
globalThis.WEColor = WEColor;
globalThis.__WEColor = WEColor; // import * as X from 'WEColor' 的映射目标
globalThis.WEMath = WEMath;
globalThis.__WEMath = WEMath;   // import * as X from 'WEMath' 的映射目标
globalThis.__exports = {};
globalThis.__scriptProps = null;        // export var scriptProperties = ... 写入
globalThis.__scriptProperties = null;   // 脚本内 scriptProperties 引用
globalThis.createScriptProperties = function () { return new ScriptPropertiesBuilder(userProps); };
// 鼠标/输入 (本地无鼠标 → 画布中心, 静止): NSL Dock 逻辑 (715 L126
// input.cursorWorldPosition) 缺失 → update 抛错 → shared 值不计算
globalThis.input = {
  cursorWorldPosition: new Vec3(canvasSize.x / 2, canvasSize.y / 2, 0),
  cursorDelta: new Vec3(0, 0, 0),
  cursorVelocity: 0,
  mousePressed: false,
  mouseDelta: new Vec3(0, 0, 0),
};
// thisScene: NSL 场景引用 — getLayer(name) 返回沙箱图层包装, 读写经宿主桥
// 转发到真实场景对象 (缺失图层由宿主桥记一次性日志后走占位默认值)
function sceneLayer(key, get, set) {
  return {
    get visible() { return get('visible'); },
    set visible(v) { set('visible', !!v); },
    get alignment() { return get('alignment'); },
    set alignment(v) { set('alignment', v); },
    get size() { return parseV(get('size'), [0, 0, 0]); },
    get scale() { return parseV(get('scale'), [1, 1, 1]); },
    get origin() { return parseV(get('origin'), [0, 0, 0]); },
    set origin(v) { if (v == null) return; set('origin', xyz(v)); },
    get name() { return get('name'); },
    get id() { return get('id'); },
    clicked: false,
    cursorDetected: false,
  };
}
globalThis.thisScene = {
  getLayer: function (name) { b.sceneLayerExists(name); return sceneLayer(name, function (p) { return b.sceneLayerGet(name, p); }, function (p, v) { b.sceneLayerSet(name, p, v); }); },
  getSceneObject: function (id) {
    if (!b.sceneObjExists(id)) return null;
    return sceneLayer(id, function (p) { return b.sceneObjGet(id, p); }, function (p, v) { b.sceneObjSet(id, p, v); });
  },
};
// thisLayer/thisObject: 当前脚本所属对象 (ownerRef 桥, 每帧 setOwner 切换)
function animRef() {
  return {
    play: function () {}, setFrame: function () {}, setTime: function () {}, setFps: function () {},
    setVisible: function () {}, setBlend: function () {}, setRate: function () {}, setScale: function () {},
    setOrigin: function () {}, setAngles: function () {}, setAlpha: function () {}, setColor: function () {},
    setSize: function () {}, setParallaxDepth: function () {}, setPosition: function () {}, setBrightness: function () {},
    setColorBlendMode: function () {},
    getAnimationLayerCount: function () { return b.ownerAnimCount(); },
    setFrameCount: function () {},
    addEndedCallback: function () {},
  };
}
globalThis.thisLayer = {
  getAnimationLayer: function (i) { return animRef(); },
  getParent: function () { return { origin: new Vec3(0, 0, 0), visible: true }; },
  get visible() { return b.ownerGet('layer', 'visible'); },
  set visible(v) { b.ownerSet('layer', 'visible', !!v); },
  get origin() { return parseV(b.ownerGet('layer', 'origin'), [0, 0, 0]); },
  set origin(v) { if (v == null) return; b.ownerSet('layer', 'origin', xyz(v)); },
  get scale() { return parseV(b.ownerGet('layer', 'scale'), [1, 1, 1]); },
  set scale(v) { if (v == null) return; b.ownerSet('layer', 'scale', xyz(v)); },
  get alpha() { return b.ownerGet('layer', 'alpha'); },
  set alpha(v) { b.ownerSet('layer', 'alpha', Number(v)); },
  get name() { return b.ownerGet('layer', 'name'); },
  get id() { return b.ownerGet('layer', 'id'); },
  cursorDetected: false,
  clicked: false,
};
globalThis.thisObject = {
  getMaterial: function () { return {}; },
  getAnimation: function () { return animRef(); },
  get origin() { return parseV(b.ownerGet('object', 'origin'), [0, 0, 0]); },
  set origin(v) { if (v != null) b.ownerSet('object', 'origin', xyz(v)); },
  get scale() { return parseV(b.ownerGet('object', 'scale'), [1, 1, 1]); },
  set scale(v) { if (v != null) b.ownerSet('object', 'scale', xyz(v)); },
  get visible() { return b.ownerGet('object', 'visible'); },
  set visible(v) { b.ownerSet('object', 'visible', !!v); },
  get name() { return b.ownerGet('object', 'name'); },
  get id() { return b.ownerGet('object', 'id'); },
};
globalThis.engine = {
  registerAsset: function () { return { getAsset: function () { return null; } }; },
  canvasSize: canvasSize,
  runtime: b.runtime(),
  frametime: b.frametime(),
  userProperties: userProps,
  // NSL 库 (Mutsumi 788 等) 依赖编辑器环境探测; 缺失此方法 → 脚本中途抛错,
  // 后续 shared 赋值全部丢失 → 整个动画框架失效
  isRunningInEditor: function () { return false; },
  // setTimeout 必须异步延迟 — 旧实现立即同步执行回调, NSL 库的调度递归
  // (动画推进/节流) 会同步无限递归卡死主线程; 回调经宿主定时器 + 沙箱调度
  // 入口执行 (P-13: 带超时保护)
  setTimeout: function (fn, ms) {
    var tok = b.setTimeout(fn, Math.max(0, Number(ms) || 0));
    return function () { b.clearTimeout(tok); };
  },
  clearTimeout: function (t) { try { if (t && typeof t === 'function') t(); } catch (e) {} },
};
// shared: 跨脚本共享对象 — 由宿主登记 (同一渲染器所有沙箱共用同一实例);
// NSL 框架主逻辑写 shared、其他层读 (715 Dock 的 minScale/maxScale/radius)
var shared = b.getShared();
if (!shared) { shared = {}; b.setShared(shared); }
globalThis.shared = shared;
// vm 裸 context 无 console — 桥接到宿主日志 (参数已在沙箱内序列化为字符串)
var consoleShim = {};
['log', 'info', 'warn', 'error', 'debug'].forEach(function (lv) {
  consoleShim[lv] = function () { try { b.console(lv, fmtArgs(arguments)); } catch (e) {} };
});
globalThis.console = consoleShim;
// value → 脚本可操作对象 (Vec3 / number / 原样)。
// 注意: 只有"纯数字"字符串才转 Vec3 (如 "0.5 0.5 0") — 文本类脚本的 value
// 是多词字符串 (如 "Text Layer"、"Good day!"), 误转 Vec3 会让 update 返回
// 的文本被 fmtResult 格式化破坏 (FPS 计数器实测 "Text Layer" → "0.000000 ...")
function toValue(v) {
  if (typeof v === 'string') {
    var parts = v.trim().split(/\s+/);
    var ok = parts.length >= 2;
    if (ok) for (var i = 0; i < parts.length; i++) if (parts[i] === '' || !isFinite(Number(parts[i]))) { ok = false; break; }
    if (ok) { var n = parts.map(Number); return new Vec3(n[0], n[1], n[2] || 0); }
    return v;
  }
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') return copyPlain(v);
  return v;
}
// 脚本返回值 → 存储值 (Vec3/{x,y,z} → "x y z"; 其余基元原样, 对象净化为纯数据)
function fmtResult(r) {
  if (r == null || typeof r === 'string' || typeof r === 'number' || typeof r === 'boolean') return r;
  if (typeof r === 'object') {
    if (!Array.isArray(r) && 'x' in r && 'y' in r && 'z' in r) {
      return Number(r.x).toFixed(6) + ' ' + Number(r.y).toFixed(6) + ' ' + Number(r.z).toFixed(6);
    }
    return copyPlain(r);
  }
  return undefined;
}
// scriptProperties 合并 (finish()/属性读取留在沙箱内 — 宿主不触碰脚本可控
// 对象, 避免恶意 getter 搭宿主栈帧逃逸)。
// payload: null → 只安装脚本声明的基础属性; 否则 {__user: 用户属性值表, ...对象级覆盖}
var baseProps = null, baseDone = false;
function installProps(payload) {
  if (!baseDone) {
    baseDone = true;
    var sp = globalThis.__scriptProps;
    if (sp && typeof sp === 'object' && typeof sp.finish === 'function') {
      try { sp = sp.finish(); } catch (e) { sp = null; }
    }
    baseProps = sp && typeof sp === 'object' ? sp : null;
  }
  if (!payload) {
    globalThis.__scriptProperties = baseProps ? copyPlain(baseProps) : null;
    return;
  }
  var out = baseProps ? copyPlain(baseProps) : {};
  var userVals = payload.__user || {};
  for (var k in payload) {
    if (k === '__user') continue;
    var v = payload[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.user === 'string' && v.user) {
        var uv = userVals[v.user];
        out[k] = uv !== undefined && uv !== null ? copyPlain(uv) : copyPlain(v.value);
      } else if ('value' in v) {
        out[k] = copyPlain(v.value);
      } else {
        out[k] = copyPlain(v);
      }
    } else {
      out[k] = v;
    }
  }
  globalThis.__scriptProperties = out;
}
// 调度入口: 宿主一律经 vm.Script('__dispatch()') 进入 (V8 在 runInContext 边界
// 过滤跨上下文栈帧), 返回 [状态, 值] — 值只含基元与净化过的纯数据
globalThis.__dispatchOp = null;
globalThis.__dispatchArg = undefined;
globalThis.__dispatch = function () {
  var op = globalThis.__dispatchOp, arg = globalThis.__dispatchArg;
  globalThis.__dispatchOp = null;
  globalThis.__dispatchArg = undefined;
  if (op === 'update' || op === 'init') {
    var fn = op === 'update' ? globalThis.__exports.update : globalThis.__exports.init;
    if (typeof fn !== 'function') return ['nofn', undefined];
    return ['ok', fmtResult(fn(toValue(arg)))];
  }
  if (op === 'apply') {
    if (typeof globalThis.__exports.applyUserProperties !== 'function') return ['nofn', undefined];
    return ['ok', fmtResult(globalThis.__exports.applyUserProperties({}))];
  }
  if (op === 'call') { if (typeof arg === 'function') arg(); return ['ok', undefined]; }
  if (op === 'props') { installProps(arg); return ['ok', 1]; }
  return ['nofn', undefined];
};
})();
`;

// ── 宿主 → 沙箱调度 (P-01 第 5 条 / P-13) ─────────────────────
const DISPATCH_SCRIPT = new vm.Script('__dispatch()');
// 注意: 不许直接调用沙箱函数 — 宿主 JS 栈帧会经 Error.prepareStackTrace 暴露
function invokeDispatch(context, op, arg, timeoutMs) {
  context.__dispatchOp = op;
  context.__dispatchArg = arg; // 仅基元 / 沙箱对象 / bootstrap 可信代码消费的纯数据
  try {
    return DISPATCH_SCRIPT.runInContext(context, { timeout: timeoutMs });
  } finally {
    // 立即清引用: arg 可能携带宿主纯数据负载 (scriptProperties 合并), 不得滞留全局
    context.__dispatchOp = null;
    context.__dispatchArg = undefined;
  }
}
function isVmTimeout(e) {
  return !!e && typeof e.message === 'string' && e.message.includes('Script execution timed out');
}
// P-13: 连续超时记日志, 达上限停用脚本 (死循环不再逐帧吃掉超时预算)
function noteScriptTimeout(entry, src, op) {
  const label = (String(src || '').split('\n').find((l) => l.trim()) || '').trim().slice(0, 80);
  if (entry.timeouts === 1) {
    console.warn(`[scene-scripts] 脚本 ${op}() 执行超时 (连续 1 次), 本帧跳过: ${label}`);
  } else if (entry.timeouts >= SCRIPT_DEAD_TIMEOUTS && !entry.dead) {
    entry.dead = true;
    console.warn(`[scene-scripts] 脚本 ${op}() 连续 ${entry.timeouts} 次超时, 停用该脚本 (value 保持现状): ${label}`);
  }
}

// ── 编译脚本 ──────────────────────────────────────────────────
// 返回 { context, ownerRef, error? } — exports 由沙箱 __exports 持有,
// 宿主只在调度入口读取 (P-01)。
// opts: { canvasSize, userProps, sharedRef, thisScene, ownerRef, runtime, frametime }
function compileScript(source, opts = {}) {
  const code = transpileScript(source);
  const ownerRef = opts.ownerRef || makeOwnerRef();
  const sceneRef = opts.thisScene || makeSceneRef([]);
  const sharedRef = opts.sharedRef || { current: null };
  const timers = new Map();
  let timerSeq = 1;
  // 宿主桥: bootstrap 期间一次性注入, bootstrap 结束后删除。
  // 全部回调只收/回基元与纯数据; 沙箱函数仅限 setTimeout 的回调参数。
  const bridge = {
    userProps: () => opts.userProps || {},
    canvasSize: () => opts.canvasSize || { x: 3840, y: 2160 },
    runtime: () => (opts.runtime != null ? opts.runtime : 0),
    frametime: () => opts.frametime || 1 / 60,
    getShared: () => sharedRef.current,
    setShared: (s) => { sharedRef.current = s; },
    console: (lv, msg) => { (typeof console[lv] === 'function' ? console[lv] : console.log)(`[scene-script] ${msg}`); },
    sceneLayerExists: (name) => sceneRef.layerExists(String(name)),
    sceneLayerGet: (name, prop) => sceneRef.layerGet(String(name), String(prop)),
    sceneLayerSet: (name, prop, v) => sceneRef.layerSet(String(name), String(prop), v),
    sceneObjExists: (id) => sceneRef.objExists(id),
    sceneObjGet: (id, prop) => sceneRef.objGet(id, String(prop)),
    sceneObjSet: (id, prop, v) => sceneRef.objSet(id, String(prop), v),
    ownerGet: (kind, prop) => ownerRef.get(String(kind), String(prop)),
    ownerSet: (kind, prop, v) => ownerRef.set(String(kind), String(prop), v),
    ownerAnimCount: () => ownerRef.animCount(),
    setTimeout: (fn, ms) => {
      const token = timerSeq++;
      const t = setTimeout(() => {
        timers.delete(token);
        try { invokeDispatch(context, 'call', fn, CALL_TIMEOUT); } catch { /* 回调失败/超时 → 忽略 (旧实现同) */ }
      }, Math.max(0, Number(ms) || 0));
      timers.set(token, t);
      return token;
    },
    clearTimeout: (token) => {
      const n = Number(token);
      const t = timers.get(n);
      if (t !== undefined) { clearTimeout(t); timers.delete(n); }
    },
  };
  // P-01: null 原型 context + 禁 eval/Function; 不注入任何宿主对象/内建
  const context = Object.create(null);
  vm.createContext(context, { codeGeneration: { strings: false } });
  context.__bridge = bridge;
  try {
    vm.runInContext(SANDBOX_BOOTSTRAP, context, { timeout: COMPILE_TIMEOUT });
  } catch (e) {
    return { error: `沙箱初始化失败: ${e.message}`, ownerRef };
  } finally {
    delete context.__bridge; // 一次性桥接 — 用后即删
  }
  try {
    vm.runInContext(code, context, { timeout: COMPILE_TIMEOUT });
  } catch (e) {
    // 编译期错误: 保留 context (部分导出可能已就位, 旧实现同) 由调度入口判 nofn
    return { error: e.message, ownerRef, context };
  }
  try { invokeDispatch(context, 'props', null, INIT_TIMEOUT); } catch { /* 属性安装失败 → scriptProperties 保持 null */ }
  return { ownerRef, context };
}

// 创建脚本运行时: 缓存 Map + shared (每个 SceneRenderer 实例一个)。
// shared 是沙箱内创建的跨脚本共享对象槽位 (首次编译后填充 — 宿主对象不再进沙箱)
export function createScriptCache() {
  return { map: new Map(), shared: null };
}

// 执行脚本值 (缓存模式): 编译一次, init 一次, 每帧 update(value) → 写回 obj.value
// opts: { canvasSize, userProps, sharedRef, sceneObjects, thisScene, cache, runtime, frametime, ownerRef, currentObject }
function runScriptValueCached(scriptVal, time, opts = {}) {
  if (!scriptVal || typeof scriptVal !== 'object' || !('script' in scriptVal)) return;
  const src = scriptVal.script;
  const cache = opts.cache;
  let entry = cache ? cache.get(src) : null;
  if (!entry) {
    const compiled = compileScript(src, {
      canvasSize: opts.canvasSize,
      userProps: opts.userProps,
      sharedRef: opts.sharedRef,
      thisScene: opts.thisScene,
      ownerRef: opts.ownerRef,
      runtime: opts.runtime != null ? opts.runtime : time,
      frametime: opts.frametime,
    });
    entry = {
      error: compiled.error,
      context: compiled.context || null,
      initialized: false,
      userPropsApplied: false,
      timeouts: 0,
      dead: false,
      ownerRef: compiled.ownerRef,
    };
    if (cache) cache.set(src, entry);
  }
  if (!entry.context || entry.dead) return;
  // 对象级 scriptproperties 覆盖 (WE 编辑器保存的用户调整 + user 属性绑定):
  // scene.json 对象上的 scriptproperties 是设计器存盘值, 格式 {name: value} 或
  // {name: {user: 用户属性名, value: 默认}} — 运行时读 userProps 当前值 (用户
  // 在 project.json 改过则生效), 无该键回退 value。脚本编译期 createScriptProperties
  // 只含脚本内声明的默认, 不含对象存盘覆盖 → 不应用则时钟 12/24h、分隔符等
  // 全用脚本默认 (用户调整丢失)。缓存按 src 共享, __scriptProperties
  // 每次按当前对象重新覆盖 (同脚本多对象不同覆盖不串); 合并在沙箱内完成 (P-01)。
  if (scriptVal.scriptproperties) {
    const payload = { __user: opts.userProps || {} }; // __user 为保留键 (用户属性值表)
    for (const k of Object.keys(scriptVal.scriptproperties)) {
      if (k === '__user') continue;
      payload[k] = scriptVal.scriptproperties[k];
    }
    try { invokeDispatch(entry.context, 'props', payload, INIT_TIMEOUT); } catch { /* 忽略 */ }
  }
  // ownerRef 是首次编译时创建的共享桥 (entry 持有); setOwner 指向当前脚本
  // 所属对象 — 缓存共享条目在多个对象间不串
  const ownerRef = entry.ownerRef;
  if (ownerRef && ownerRef.setOwner) ownerRef.setOwner(opts.currentObject || null);
  // P-13: 每次调用都有超时; 出错保持当前 value (旧语义), 连续超时记日志并停用
  const call = (op, arg, tmo) => {
    let r;
    try {
      r = invokeDispatch(entry.context, op, arg, tmo);
    } catch (e) {
      if (isVmTimeout(e)) {
        entry.timeouts++;
        noteScriptTimeout(entry, src, op);
      } // 非超时运行时错误 → 静默保持当前 value (旧语义)
      return null;
    }
    if (r && r[0] === 'ok' && entry.timeouts) entry.timeouts = 0; // 只有脚本函数真正执行成功才清零 (nofn 不清 — 否则死循环 init 永远停用不了)
    return r;
  };
  // 注意: init 与 update 拿到的是同一份初始 value (旧实现同 — init 的返回值
  // 写回 obj.value 但不影响本帧 update 的入参)
  const rawValue = scriptVal.value;
  if (!entry.initialized) {
    const r = call('init', rawValue, INIT_TIMEOUT);
    if (r) {
      entry.initialized = true;
      if (r[1] != null) scriptVal.value = r[1];
    }
  }
  // applyUserProperties: NSL 语义在用户属性变化时调用 (715 Dock 逻辑的
  // shared.minScale/maxScale/radius 都在这里计算)。本地无变化检测 → 首次
  // 执行一次 (属性固定, 幂等); 不执行则依赖它的脚本读到 undefined。
  if (!entry.userPropsApplied) {
    if (call('apply', undefined, INIT_TIMEOUT)) entry.userPropsApplied = true;
  }
  const r = call('update', rawValue, UPDATE_TIMEOUT);
  if (r && r[0] === 'ok' && r[1] != null) scriptVal.value = r[1];
}

// 扫描并执行场景所有 {script, value} 对象 (更新到原对象树)
// opts: { canvasSize, userProps, scriptCache, renderObjects, runtime }
export function applySceneScripts(scene, time, opts = {}) {
  const cache = opts.scriptCache && opts.scriptCache.map ? opts.scriptCache : null;
  // shared: 沙箱内创建、经宿主登记的跨脚本共享对象 (P-01: 宿主对象不再注入
  // 沙箱; 挂在 cache.shared 上跨帧/跨脚本复用 — NSL 动画调度器/状态依赖)
  const sharedRef = { current: cache ? cache.shared : null };
  // 渲染对象列表 (this.objects, 已烘焙) — 脚本写这些对象 → 渲染直接生效
  const sceneObjects = opts.renderObjects || (scene.objects || []).map((o) => o);
  const thisScene = makeSceneRef(sceneObjects);
  const ownerRef = makeOwnerRef();
  const walk = (obj, owner) => {
    if (!obj || typeof obj !== 'object') return;
    if ('script' in obj && 'value' in obj && typeof obj.script === 'string') {
      runScriptValueCached(obj, time, {
        canvasSize: opts.canvasSize,
        userProps: opts.userProps,
        sharedRef,
        sceneObjects,
        thisScene,
        cache: cache ? cache.map : null,
        ownerRef,
        currentObject: owner || null,
        runtime: opts.runtime,
        frametime: opts.frametime,
      });
      return; // script 对象内部不再含 script 子对象
    }
    if (Array.isArray(obj)) {
      // 数组元素 owner = 元素自身 (script 常挂在对象属性上, 其 thisObject = 对象)
      obj.forEach((x) => walk(x, x));
      return;
    }
    for (const k of Object.keys(obj)) walk(obj[k], obj);
  };
  walk(scene, null);
  if (cache && sharedRef.current) cache.shared = sharedRef.current;
  return sharedRef.current || {};
}
