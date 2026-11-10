/**
 * we-wproperties.js — 只读导入 Wallpaper Engine 安装目录 `config.json` 里的
 * **用户当前属性值**（`wproperties.<壁纸路径>.<MonitorN>.<属性名>`）。
 *
 * 与 `project.json` 的 `general.properties` 的区别（这也是 issue #341 的全部动机）：
 *   · `project.json` 存作者导出的**默认值**；
 *   · WE 安装根的 `config.json` 存**这台机器上用户当前选的值**（用户在 WE 里把
 *     「时间组件」关掉就只在这里体现）；
 *   · 插件自己的 `settings.userProps` 是插件侧覆盖（优先级最高）。
 *
 * 契约（只读、绝不写 WE 的文件）：
 *   · 缺失 / 坏 JSON / 多 profile / 多 Monitor / 路径大小写或斜杠方向不一致，**一律宽容降级**
 *     （返回 `{ ok:false, reason }`，绝不抛）；
 *   · 壁纸路径按归一化后比较（小写 + 正斜杠 + 去尾斜杠），容忍 `\\?\` 前缀与相对后缀；
 *   · Monitor 选择：`Monitor0` 优先，其次按数字最小的 `MonitorN`；
 *   · 返回值只含标量（数字 / 字符串 / 布尔），对象/数组值跳过（WE 里不是属性值）。
 *
 * 为什么自足实现而不复用主包 `lib/steam-discovery.js`：本文件在
 * `packages/media-bridge/`（S5c 出户之后子包不得 import 主包），而路由自己本来就在
 * 读盘（`project.json`），所以这里只做「从壁纸目录往上找 WE 安装根 → 读 config.json」
 * 这一段，格式解析与主包 `lib/wallpaper-scan.js` 的 playlists 读取同口径（顶层是多个
 * profile，各自的 `general` / `wproperties` 挂在 profile 下；也兼容旧的扁平形态）。
 *
 * 判据：`test/verify-steam-discovery.mjs`（纯函数 + 临时目录夹具）与
 * `test/verify-scene-live.mjs` Level C5（真实路由回包带 `we`；WE 里没有这张壁纸 ⇒
 * `ok:false` 的负对照）。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** 统一的路径比较形态：去 `\\?\` 前缀、`\`→`/`、去尾斜杠、小写。 */
export function normPath(p) {
  if (typeof p !== 'string' || p === '') return '';
  return p
    .trim()
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** vdf 里的 `"path" "D:\\SteamLibrary"` 列表（只认这一种写法；坏文件返回空表）。 */
export function libraryFoldersFromVdf(text) {
  const out = [];
  if (typeof text !== 'string' || text === '') return out;
  const re = /"path"\s+"([^"]+)"/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = String(m[1]).replace(/\\\\/g, '\\');
    if (raw && !out.includes(raw)) out.push(raw);
  }
  return out;
}

/** 在一张 `{路径: <MonitorN 表>}` 里找这张壁纸的键（精确优先，其次路径后缀）。 */
function findWallpaperKey(map, absWallpaperDir) {
  const want = normPath(absWallpaperDir);
  if (!want || !map || typeof map !== 'object') return null;
  let suffixHit = null;
  for (const key of Object.keys(map)) {
    const k = normPath(key);
    if (!k) continue;
    if (k === want) return key;
    if (suffixHit === null && (want.endsWith('/' + k) || k.endsWith('/' + want))) suffixHit = key;
  }
  return suffixHit;
}

const monitorRank = (name) => {
  const m = /^Monitor(\d+)$/i.exec(String(name));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

/**
 * 从已解析的 WE `config.json` 里取这张壁纸的当前值。
 *
 * @param config  WE `config.json` 解析后的对象
 * @param absWallpaperDir 壁纸目录绝对路径
 * @returns {{ok:boolean, values?:object, monitor?:string, profile?:string, matchedKey?:string, monitors?:string[], reason?:string}}
 *   成功时带 `values` / `monitor` / `profile` / `matchedKey` / `monitors`；失败时带 `reason`。
 *   这里用「单形状 + 可选字段」而不是判别联合：调用方全是 JS，联合类型在 `picked.ok`
 *   之后仍会丢收窄，反而让 tsc 报 TS2339（基线 0）。
 */
export function extractWProperties(config, absWallpaperDir) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ok: false, reason: 'no-config' };
  const maps = [];
  // 形态 3（旧 / 扁平）：顶层直接 wproperties
  if (config.wproperties && typeof config.wproperties === 'object') {
    maps.push({ profile: '', map: config.wproperties });
  }
  // 形态 1 / 2：每个 profile 下 wproperties（或在 general.wproperties 里）
  for (const [name, profile] of Object.entries(config)) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
    if (name === 'wproperties') continue;
    if (profile.wproperties && typeof profile.wproperties === 'object') {
      maps.push({ profile: name, map: profile.wproperties });
    }
    const general = profile.general;
    if (general && typeof general === 'object' && general.wproperties && typeof general.wproperties === 'object') {
      maps.push({ profile: name, map: general.wproperties });
    }
  }
  if (maps.length === 0) return { ok: false, reason: 'no-wproperties' };
  for (const { profile, map } of maps) {
    const key = findWallpaperKey(map, absWallpaperDir);
    if (!key) continue;
    const entry = map[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const monitors = Object.keys(entry)
      .filter((m) => entry[m] && typeof entry[m] === 'object' && !Array.isArray(entry[m]));
    if (monitors.length === 0) continue;
    monitors.sort((a, b) => monitorRank(a) - monitorRank(b) || (a < b ? -1 : a > b ? 1 : 0));
    const monitor = monitors[0];
    const values = {};
    for (const [propName, raw] of Object.entries(entry[monitor])) {
      if (raw === null || raw === undefined) continue;
      const t = typeof raw;
      if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
      values[propName] = raw;
    }
    return { ok: true, values, monitor, profile, matchedKey: key, monitors };
  }
  return { ok: false, reason: 'no-match' };
}

/** 读一个文本文件（不存在 / 读不动 ⇒ null，不抛）。 */
function readTextOrNull(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

const dirNameOf = (p) => {
  const raw = String(p || '').replace(/[\\/]+$/, '');
  const i = raw.lastIndexOf(sep) >= 0 ? raw.lastIndexOf(sep) : Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  return i > 0 ? raw.slice(0, i) : '';
};
const baseNameOf = (p) => {
  const raw = String(p || '').replace(/[\\/]+$/, '');
  const i = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'), raw.lastIndexOf(sep));
  return i >= 0 ? raw.slice(i + 1) : raw;
};

/**
 * 候选 `config.json` 路径（按优先级）：env 覆盖 → 壁纸所在的 Steam 库 → 该 Steam 的
 * `libraryfolders.vdf` 里登记的其它库 → 便携安装根（`<WE>/projects/...`）。
 *
 * @param absWallpaperDir 壁纸目录绝对路径
 * @param {{DSH_WE_STEAM_ROOT?: string}} [env] 进程环境（测试注入）
 * @param {(p:string)=>string|null} [reader] 文本读取（测试注入）
 * @returns {string[]}
 */
export function candidateConfigPaths(absWallpaperDir, env = {}, reader = readTextOrNull) {
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (!p) return;
    const k = normPath(p);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  const override = env && env.DSH_WE_STEAM_ROOT;
  if (typeof override === 'string' && override !== '') push(join(override, 'config.json'));
  const raw = String(absWallpaperDir || '').replace(/[\\/]+$/, '');
  if (!raw) return out;
  let cur = raw;
  for (let depth = 0; depth < 16; depth += 1) {
    const name = baseNameOf(cur).toLowerCase();
    const parent = dirNameOf(cur);
    if (!parent || parent === cur) break;
    if (name === 'steamapps') {
      // Steam 根；WE 的默认库在这里
      push(join(cur, 'common', 'wallpaper_engine', 'config.json'));
      const vdf = reader(join(cur, 'libraryfolders.vdf')) || reader(join(parent, 'config', 'libraryfolders.vdf'));
      for (const lib of libraryFoldersFromVdf(vdf)) {
        push(join(lib, 'steamapps', 'common', 'wallpaper_engine', 'config.json'));
      }
    } else if (name === 'wallpaper_engine') {
      // 已经站在安装根里（壁纸是从它的 projects/ 导入的）
      push(join(cur, 'config.json'));
    } else if (name === 'projects') {
      // 便携 / 非 Steam 安装：projects/ 的上一级就是安装根
      push(join(parent, 'config.json'));
    }
    cur = parent;
  }
  return out;
}

/** config.json 的按 (mtime, size) 缓存：同一文件反复请求不重复解析（大文件实测 ~1MB）。 */
const CONFIG_CACHE = new Map();

function readJsonCached(path) {
  let st;
  try { st = statSync(path); } catch { return null; }
  if (!st.isFile()) return null;
  const hit = CONFIG_CACHE.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  CONFIG_CACHE.set(path, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
}

/**
 * 读这张壁纸在 WE 里的当前属性值（只读）。
 *
 * @param absWallpaperDir 壁纸目录绝对路径
 * @param {{env?: {DSH_WE_STEAM_ROOT?: string}, configPaths?: string[]}} [opts] `{ env, configPaths }`（测试注入；`configPaths` 给了就不再探测安装根）
 * @returns {{ok:boolean, values?:object, monitor?:string, profile?:string, matchedKey?:string, monitors?:string[], reason?:string, path?:string}}
 */
export function readWeConfigValues(absWallpaperDir, opts = {}) {
  const env = opts.env || (typeof process !== 'undefined' ? process.env : {});
  const paths = Array.isArray(opts.configPaths)
    ? opts.configPaths.slice()
    : candidateConfigPaths(absWallpaperDir, env);
  if (paths.length === 0) return { ok: false, reason: 'no-install' };
  let sawBad = false;
  for (const p of paths) {
    const config = readJsonCached(p);
    if (config === null) { sawBad = true; continue; }
    const picked = extractWProperties(config, absWallpaperDir);
    if (picked.ok) return { ...picked, path: p };
    if (picked.reason === 'no-match') continue;
    return { ...picked, path: p };
  }
  return { ok: false, reason: sawBad ? 'unreadable' : 'no-match' };
}
