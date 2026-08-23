// WE scene scripts 运行时: 执行 {script, value} 对象的 JS 脚本
// 支持: export function update(value) — 每帧更新 (返回新值)
//       export function applyUserProperties(changed) — 用户属性变化更新
// 提供 WEColor 等引擎 API (vm 沙箱)
import vm from 'node:vm';

// WEColor API (引擎颜色工具)
export const WEColor = {
  hsv2rgb({ x: h, y: s, z: v }) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return { x: rgb[0], y: rgb[1], z: rgb[2] };
  },
  rgb2hsv({ x: r, y: g, z: b }) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = h / 6;
    }
    const s = mx === 0 ? 0 : d / mx;
    return { x: ((h % 1) + 1) % 1, y: s, z: mx };
  },
};

// 编译脚本: 返回 { update, applyUserProperties } 函数 (vm 沙箱)
function compileScript(source) {
  // 转译 ESM 导入/导出为 CommonJS (脚本用 import * as WEColor / export function)
  let code = source;
  code = code.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['\"]([^'\"]+)['\"]/g, 'const $1 = __WEColor;');
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]/g, 'const { $1 } = __WEColor;');
  code = code.replace(/export\s+function\s+(\w+)\s*\(/g, '__exports.$1 = function (');
  code = code.replace(/export\s*\{([^}]+)\}/g, (m, names) => {
    return names.split(',').map((n) => {
      const nn = n.trim();
      const [orig, alias] = nn.includes(' as ') ? nn.split(' as ').map(s => s.trim()) : [nn, nn];
      return `__exports.${alias} = ${orig};`;
    }).join('\n');
  });
  const context = {
    __WEColor: WEColor,
    __exports: {},
    Date, Math, console,
    engine: {
      registerAsset: () => ({ getAsset: () => null }),
    },
    thisObject: { getMaterial: () => ({}) },
  };
  vm.createContext(context);
  try {
    vm.runInContext(code, context, { timeout: 1000 });
  } catch (e) {
    return { error: e.message };
  }
  return context.__exports;
}

// 执行脚本值: 对 {script, value} 对象运行脚本更新 value
export function runScriptValue(scriptVal, time) {
  if (!scriptVal || typeof scriptVal !== 'object' || !('script' in scriptVal)) return scriptVal;
  const fn = compileScript(scriptVal.script);
  if (fn.error) return scriptVal.value; // 脚本失败 → 用静态 value
  try {
    if (typeof fn.update === 'function') {
      const result = fn.update(scriptVal.value);
      if (result == null) return scriptVal.value;
      // WEColor 返回 {x,y,z} → 字符串 "x y z" (引擎 uniform 格式)
      if (typeof result === 'object' && !Array.isArray(result) && 'x' in result && 'y' in result && 'z' in result) {
        return `${Number(result.x).toFixed(6)} ${Number(result.y).toFixed(6)} ${Number(result.z).toFixed(6)}`;
      }
      return result;
    }
    if (typeof fn.applyUserProperties === 'function') {
      fn.applyUserProperties({});
      return scriptVal.value;
    }
  } catch { /* 运行时错误 → 用 value */ }
  return scriptVal.value;
}

// 扫描并执行场景所有 {script, value} 对象 (更新到原对象树)
export function applySceneScripts(scene, time) {
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if ('script' in obj && 'value' in obj && typeof obj.script === 'string') {
      const v = runScriptValue(obj, time);
      if (v !== undefined) obj.value = v;
      return;
    }
    if (Array.isArray(obj)) obj.forEach(walk);
    else for (const k of Object.keys(obj)) walk(obj[k]);
  };
  walk(scene);
}
