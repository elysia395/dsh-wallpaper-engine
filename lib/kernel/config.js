/**
 * config.js —— config.json / settings / 字体集持久化内核（P0 库化）。
 *
 * 来源：从 `lib/index.js` 纯搬移（原 750–910）。函数、常量、注释、文案逐字未改 —— 唯一形式
 * 差异是包进工厂后统一缩进 2 格（脚本逐行核对过）。
 *
 * 依赖方向：本模块**单向** import `./data-dir.js` 的 `configPath` / `pluginDataDir`；
 * data-dir 不 import 本模块（否则成环：`cacheBaseDir()` 要读 config.json）。
 * `atomicTmpSeq` / `configWriteQueue` 收进工厂（门面在模块作用域建一次，生命周期不变）。
 *
 * deps 契约（**全部可选**；缺省即生产行为 —— 门面 `createConfigKit()` 一字未改）：
 *   · `configPath` —— 访问器或字符串。**缺省 = `./data-dir.js` 的 `configPath` 现算**
 *     （`DSH_WE_DATA_DIR` 覆盖 + `<pluginDataDir>/config.json`）。默认值的唯一真源留在 data-dir，
 *     本模块不复制第二份。
 *   · `pluginDataDir` —— 同上；`fontsets/` 与 `glass-presets/` 两个子目录由它派生。
 *   为什么要这个注入缝：判据要像其它 kit 一样**直接注入夹具路径**，不能靠"先设 `DSH_WE_DATA_DIR`
 *   再动态 import"的时序 —— 那种写法在模块缓存 / 实例顺序下会退化成"看似隔离、实则共享"
 *   （本仓踩过 `UPLOAD_DIR` / `scanSignatureP` 这类"值快照 vs 访问器"的坑）。
 *
 * 本模块绝不 import `lib/index.js`。
 */
import { dirname, join } from 'node:path';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rename as renameP, unlink as unlinkP, writeFile as writeFileP } from 'node:fs/promises';
import { sanitizeFromSchema, isFontSetId, sanitizeFontset, FONTSET_KEYS } from '../settings-schema.js';
import { configPath as dataDirConfigPath, pluginDataDir as dataDirPluginDataDir } from './data-dir.js';

/** 注入缝的取值口径：访问器直接用；字符串/对象包成访问器；`undefined` ⇒ data-dir 现算。 */
const asAccessor = (v, fallback) => (typeof v === 'function' ? v : (v === undefined ? fallback : () => v));

export function createConfigKit(deps = {}) {
  // `configPath` / `pluginDataDir` 在这里**遮蔽** import 进来的同名函数：族内所有调用点保持
  // `configPath()` / `pluginDataDir()` 原样（判据的源码形态锚点也因此逐字不变）。
  const configPath = asAccessor(deps.configPath, dataDirConfigPath);
  const pluginDataDir = asAccessor(deps.pluginDataDir, dataDirPluginDataDir);

  function readConfig() {
    try {
      const o = JSON.parse(readFileSync(configPath(), 'utf8'));
      // 数组也是 `typeof 'object'`：放它进来，后续 `cfg[SETTINGS_FIELD] = …` 挂的是非索引属性、
      // `JSON.stringify([])` 仍是 `"[]"` ⇒ 设置写静默丢失、且此后每次写都丢（不可逆）。
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch { return {}; }
  }

  /**
   * Atomic whole-file write: temp file + fsync + rename. Crash/断电 mid-write
   * leaves either the old file or the new file, never a truncated one (the same
   * publication semantics @deepseek-ai/dsh-storage-json uses for its JSON units;
   * on Windows libuv rename maps to MoveFileExW with replace).
   */
  function atomicWriteFileSync(filePath, data) {
    const tmp = filePath + '.tmp';
    const fd = openSync(tmp, 'w');
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, filePath);
    } catch {
      // Cross-device / locked-target fallback: keep best-effort plain write.
      writeFileSync(filePath, data);
    }
  }

  /** Async variant of atomicWriteFileSync (same .tmp + rename publication). */
  // 临时名带 pid + 进程内序号：同一目标文件的并发写入者不共用同一个
  // `<file>.tmp`（共用时两路并发 PUT 会互相 rename/覆盖对方半截内容）。
  // 后缀保持纯数字，兼容既有的 `.tmp\d*$` 清理规则。
  let atomicTmpSeq = 0;
  function atomicTmpPath(filePath) {
    atomicTmpSeq = (atomicTmpSeq + 1) % 1000000;
    return filePath + '.tmp' + process.pid + String(atomicTmpSeq).padStart(6, '0');
  }
  async function atomicWriteFileP(filePath, data) {
    const tmp = atomicTmpPath(filePath);
    await writeFileP(tmp, data);
    try {
      await renameP(tmp, filePath);
    } catch {
      // Cross-device / locked-target fallback: keep best-effort plain write.
      try { await writeFileP(filePath, data); } finally {
        try { await unlinkP(tmp); } catch { /* ignore */ }
      }
    }
  }

  function writeConfig(cfg) {
    try {
      mkdirSync(dirname(configPath()), { recursive: true });
      atomicWriteFileSync(configPath(), JSON.stringify(cfg));
    } catch { /* ignore */ }
  }

  /**
   * Plugin settings (wallpaper selection, scrim/border/blur, rotation groups,
   * hidden ids, playback rate, flip, object-fit, filters, liquid-glass theme)
   * persisted in the SAME config.json as uploadDir — host-side, port-independent.
   * The browser half reads/writes them through GET/PUT /wallpaper-engine/settings:
   * the loopback port is random (`--port 0`) and changes on every DSH Desktop
   * restart, so storage keyed to the page origin cannot be the source of truth.
   */
  const SETTINGS_FIELD = 'settings';

  // config.json 写串行化：settings 与 uploadDir 的写都是「读-改-写」三步，
  // 并发执行时后写者基于旧快照会吞掉先写者的改动。用一个简单的 promise 链
  // 排队，让每次读-改-写完整跑完再开始下一次。
  let configWriteQueue = Promise.resolve();
  /**
   * 把一次「读-改-写」排进 config.json 的写队列；返回**回调自己的结果**（队列本身永不 reject）。
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function enqueueConfigWrite(fn) {
    const p = configWriteQueue.then(fn, fn);
    // 队列本身永不 reject：一次失败只影响它自己的调用方，不阻塞后续写入。
    configWriteQueue = p.then(() => {}, () => {});
    return p;
  }

  function readSettings() {
    const cfg = readConfig();
    const s = cfg[SETTINGS_FIELD];
    return s && typeof s === 'object' ? s : null;
  }

  function writeSettings(settings) {
    return enqueueConfigWrite(() => {
      const cfg = readConfig();
      cfg[SETTINGS_FIELD] = settings;
      writeConfig(cfg);
      return settings;
    });
  }

  /**
   * **按键合并**写入（P1-S1 设置分区的组件写路径）：只覆盖 `patch` 里**出现**的键，磁盘上其余的键
   * 原样留在快照里。返回**合并后落盘的完整快照**，调用点据此应答，不必再读一次盘。
   *
   * 三条理由，缺一条这条路径就不该存在：
   *   ① **读必须在队内**。旧形态 `lib/routes/settings.js` 是「队外 `readSettings()` → 队内
   *      `writeSettings()`」：两个并发 PUT 各自基于同一份旧快照拼出**完整**快照，后写者把先写者的
   *      键整批吞掉。把读-改-写整条塞进 `enqueueConfigWrite`，那段窗口才真正关上。
   *   ② **未知键由 `sanitizeFromSchema` 丢弃**，组件路由不必自己维护白名单（白名单只有一处真源，
   *      见 `lib/settings-schema.js` 的 `KINDS`）。
   *   ③ **护栏也在队内**：`withLegacyFontValues` 必须看到"这次合并之后"的快照，且与写盘之间不能再有
   *      另一个写入者插队（它自己读磁盘取老字体值 —— 队外调等于把护栏和写盘拆成两个时刻）。
   *
   * 注意 `sanitizeFromSchema` 会给**缺**键补默认值，所以调用点传进来的 `patch` 必须**只**含这次真正
   * 要改的键；传整段快照进来就退化成"整段替换"（那正是 `writeSettings` 的语义，兼容入口仍在用它）。
   */
  function mergeSettings(patch) {
    return enqueueConfigWrite(() => {
      const cfg = readConfig();
      const prev = cfg[SETTINGS_FIELD];
      // 存量 base **先规范化到当前刻度**再叠加 patch：老档（缺 `settingsVersion`）在这里迁一次并
      // 带上当前版本号，随后第二次 `sanitizeFromSchema` 因版本号已到当前而短路 ⇒ patch 里那些
      // 已经是当前刻度的值不会被再换算一遍（版本号已到当前时 `sanitizeFromSchema` 短路）。
      const base = (prev && typeof prev === 'object' && !Array.isArray(prev))
        ? (sanitizeFromSchema(prev, 'host') || {})
        : (sanitizeFromSchema({}, 'host') || {});
      const merged = sanitizeFromSchema(Object.assign({}, base, patch), 'host') || {};
      const next = withLegacyFontValues(merged);
      cfg[SETTINGS_FIELD] = next;
      writeConfig(cfg);
      return next;
    });
  }

  // ── 字体集（`fontsets/<id>.json`）的目录与活动 id ────────────────────────
  /** 字体集目录。走 `pluginDataDir()`（认 `DSH_WE_DATA_DIR`）⇒ 守卫能整体隔离，绝不写真目录。 */
  function fontSetsDir() { return join(pluginDataDir(), 'fontsets'); }

  /** 玻璃预设的用户层目录（可写）。走 `pluginDataDir()` ⇒ 守卫能整体隔离，绝不写真目录。 */
  function glassPresetsDir() { return join(pluginDataDir(), 'glass-presets'); }

  /**
   * 活动字体集 id —— `config.json` 的**根字段**（不在 settings 的键集里，因此不经 PUT /settings
   * 改写）。空串 = "还没有迁到字体集"（路由族据此做一次性迁移）。
   */
  function readFontSetId() {
    const v = readConfig().fontSetId;
    return isFontSetId(v) ? v : '';
  }

  /**
   * 记下活动字体集 id。**必须**与 settings / uploadDir 走同一条写串行化队列：三者都是
   * config.json 的"读-改-写"，并发时会用一个旧快照吞掉另一方的改动。
   */
  function setFontSetId(id) {
    if (!isFontSetId(id)) return Promise.reject(new Error('fontsets: invalid id ' + String(id)));
    return enqueueConfigWrite(() => {
      const cfg = readConfig();
      cfg.fontSetId = id;
      writeConfig(cfg);
      return id;
    });
  }

  /**
   * 迁移落定：**一次** config 写入同时做两件事 —— 记下活动 id、并把内联的七个
   * 字体键从 `settings` 里摘掉（D1：迁移之后 config.json 只留 `{ fontSetId, fontCustom }`）。
   * 分两次写会留下"id 已记、内联值还在"的中间态；写成一次就没有那个窗口。
   */
  function commitFontSetMigration(id) {
    if (!isFontSetId(id)) return Promise.reject(new Error('fontsets: invalid id ' + String(id)));
    return enqueueConfigWrite(() => {
      const cfg = readConfig();
      cfg.fontSetId = id;
      const prev = cfg[SETTINGS_FIELD];
      if (prev && typeof prev === 'object') {
        // 过一遍宿主消毒即等于"按当前白名单重写" —— 字体键与 DEFAULTS_ONLY 一并落掉。
        cfg[SETTINGS_FIELD] = sanitizeFromSchema(prev, 'host') || prev;
      }
      writeConfig(cfg);
      return id;
    });
  }

  /**
   * 迁移前的护栏：字体值还没有自己的家（`fontSetId` 为空）时，**任何** settings
   * 写入都不得把它们抹掉 —— 否则用户随便改个别的设置（例如拖一下模糊）就会静默带走自定义的
   * 字体外观。值的来源是**磁盘上那份 config.json**，不是这次 PUT 的 body：新客户端的 body 已经
   * 不带这些键了，从 body 取等于没护栏。
   * 一旦迁移落定（`fontSetId` 非空）本函数即失效 —— 这条护栏自己终止，不留常驻的双写。
   */
  function withLegacyFontValues(next) {
    if (readFontSetId()) return next;
    const prev = readSettings();
    if (!prev || typeof prev !== 'object') return next;
    const legacy = sanitizeFontset(prev);
    const out = Object.assign({}, next);
    for (const key of FONTSET_KEYS) if (key in prev) out[key] = legacy[key];
    return out;
  }

  return {
    readConfig, atomicWriteFileSync, atomicTmpPath, atomicWriteFileP,
    writeConfig, enqueueConfigWrite, readSettings, writeSettings,
    mergeSettings,
    fontSetsDir, glassPresetsDir, readFontSetId, setFontSetId,
    commitFontSetMigration, withLegacyFontValues,
  };
}
