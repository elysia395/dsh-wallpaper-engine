/**
 * upload-dir.js —— 上传目录的**解析链 + 运行期状态与迁移**（上游把这些留在门面私有位置）。
 *
 * 为什么单独成模块：上游的 `lib/index.js` 把 `UPLOAD_DIR`（可变模块状态）+ `resolveUploadFile` +
 * `setUploadDir` 留在**门面内**，只把「解析默认/候选目录」交给 `lib/asset-paths.js` 的 kit。
 * ⚠️ 上游那份同名副本**已删**（`lib/asset-paths.js`；其能力在本分支分居 `lib/media/media-dirs.js`
 * 与 `lib/we-assets.js`，上传目录解析则收在本模块）：解析链由本模块的
 * `createUploadDirResolution()` 就地给出（见下），不再内联在内核工厂体内。本分支的门面是薄适配层
 * （P0 库化后不再持有实现），因此把这几样收进叶子模块，由 `lib/kernel/host-kernel.js` 在
 * **模块加载期**建一次（`UPLOAD_DIR` 的 env 解析时点是被判据钉住的）。
 *
 * 注入契约（照抄上游门面的依赖面，逐条都有买家）：
 *   · `defaultUploadDir` / `resolveUploadDir` ← 本模块 `createUploadDirResolution()` 的返回值
 *     （默认值唯一真源在那里；内核只 import + 注入）
 *   · `ensureDir` · `pathExistsP` · `moveFileP` · `enqueueConfigWrite`
 *   · `pluginDataDir`（`resolveUploadDir()` 的兜底根）
 *
 * ⚠️ `UPLOAD_DIR` 是**运行期可变**的模块内状态：`setUploadDir` 改写它，`getUploadDir()` 是访问器
 * （不是值快照）—— 把值传进路由族会导致"刚改完上传目录、清单却仍列旧目录"。
 */
import { readdirSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, normalize, relative, resolve } from 'node:path';

/**
 * 上传目录的**解析链**：默认目录 + 三级优先。从 `lib/kernel/host-kernel.js` 的工厂体内提取出来
 * （原先内联在那里 ⇒ 判据无法 import，只能靠 boot 内核 + env 才能覆盖）。
 *
 * 默认值的**唯一真源**在这里：`<pluginDataDir>/uploads`。三级优先逐字保留上游语义：
 *   ① `DSH_WE_UPLOAD_DIR`（env，原样返回、不 trim）
 *   ② `config.json` 的根字段 `uploadDir`（两侧空白 trim 后用）
 *   ③ `<pluginDataDir>/uploads`
 * @param {object} deps
 * @param {() => string} deps.pluginDataDir 数据目录访问器（认 `DSH_WE_DATA_DIR`）
 * @param {() => { uploadDir?: unknown }} deps.readConfig    配置读取（读不到回 `{}`；根字段 `uploadDir`）
 */
export function createUploadDirResolution({ pluginDataDir, readConfig }) {
  function defaultUploadDir() { return join(pluginDataDir(), 'uploads'); }
  function resolveUploadDir() {
    if (process.env.DSH_WE_UPLOAD_DIR) return process.env.DSH_WE_UPLOAD_DIR;
    const cfg = readConfig();
    if (typeof cfg.uploadDir === 'string' && cfg.uploadDir.trim()) return cfg.uploadDir.trim();
    return defaultUploadDir();
  }
  return { defaultUploadDir, resolveUploadDir };
}


/** 上传体积上限：512 MB（单个壁纸视频）。与上游 `lib/index.js` 同值。 */
export const UPLOAD_MAX_BYTES = 512 * 1024 * 1024;

/** 上传文件名模式：`<up-id>.<ext>`（组 1 = id、组 2 = ext）。与上游 `lib/index.js` 同值。 */
const UPLOAD_FILE_RE = /^(up-[a-z0-9-]+)\.(mp4|jpg|jpeg|png)$/i;

/**
 * 上传 id → 该文件在目录内的绝对路径；找不到或不合法返回 `null`。
 *
 * 包含性判据用 `relative()` 而不是拼分隔符：上游注释记录的实测是
 * `abs.startsWith(root + '\\')` 在 macOS/Linux 上永远不命中（`normalize` 产出 `/`）。
 * @param {string} dir
 * @param {string} id
 * @returns {string|null}
 */
export function resolveUploadFile(dir, id) {
  if (typeof id !== 'string' || !/^up-[a-z0-9-]+$/.test(id)) return null;
  const root = normalize(dir);
  try {
    for (const entry of readdirSync(dir)) {
      const m = UPLOAD_FILE_RE.exec(entry);
      if (m && m[1].toLowerCase() === id.toLowerCase()) {
        const abs = normalize(join(dir, entry));
        const rel = relative(root, abs);
        if (!rel || rel.startsWith('..') || /^[\\/]/.test(rel)) return null;
        return abs;
      }
    }
  } catch { return null; }
  return null;
}

/**
 * 建上传目录套件（模块加载期一次）。
 *
 * @param {object} deps
 * @param {string|(() => string)} deps.defaultUploadDir 出厂默认目录：**值或惰性访问器**
 *   （内核构造点传的是 `createUploadDirResolution()` 的 `defaultUploadDir()` 访问器——
 *   它是"默认值唯一真源"；这里两种形态都接受，取值时才调用）
 * @param {() => string} deps.resolveUploadDir 解析链（env → config → 默认）
 * @param {(dir: string) => unknown} deps.ensureDir 惰性 mkdir（memoized）——
 *   上游形态是 `ensureUploadDir()`（= `ensureDirOnce(getUploadDir())`，见 `lib/upload-store.js`）；
 *   本 kit 自己持有 `UPLOAD_DIR`，所以注入**收目录的** mkdir 并由 kit 把当前目录传进去。
 *   ⚠️ 修前 host-kernel 注入的是裸 `ensureDirOnce` 却按 `ensureUploadDir()` 无参调用 ⇒
 *   `mkdirSync(undefined)` 被 ensureDirOnce 自己的空 catch 吞掉 / 直接 TypeError（实测
 *   POST /upload-dir 回 500 `ensureUploadDir is not a function`）。
 * @param {() => Record<string, unknown>} deps.readConfig 配置读取（`setUploadDir` 落盘用）
 * @param {(cfg: Record<string, unknown>) => unknown} deps.writeConfig 配置整份原子写
 *   —— 上游 `setUploadDir` **自己持久化** `cfg.uploadDir = target`；搬进本 kit 时这条线丢了，
 *   结果是"改了上传目录、重启即回退"（用户可见的"改了却像没生效"）。
 * @param {(p: string) => Promise<boolean>} deps.pathExistsP
 * @param {(src: string, dst: string) => Promise<boolean>} deps.moveFileP
 * @param {<T>(fn: () => Promise<T>) => Promise<T>} deps.enqueueConfigWrite 配置写队列（整段迁移串行）
 * @param {Function} deps.readProjectP WE 工程 `project.json` 读取（枚举 `up-dir-*` 时用）
 * @param {Function} deps.resolveSceneMainFileP 场景主文件解析（`scene.json` 声明 / 随包 `scene.pkg`）
 * @param {number} [deps.SCAN_CHUNK] 工程目录扫描分块（缺省 32，避免一次扇出淹掉 libuv 线程池）
 * @param {string[]|(() => string[])} [deps.previewCandidates] 预览候选名（可传访问器：上传库 kit 后建）
 */
export function createUploadDirKit({
  defaultUploadDir, resolveUploadDir, ensureDir, pathExistsP, moveFileP, enqueueConfigWrite,
  readConfig, writeConfig,
  readProjectP, resolveSceneMainFileP, SCAN_CHUNK = 32, previewCandidates = [],
}) {
  // ⚠️ 加载期解析（env 必须在 import 门面之前设好）—— 时点契约由 test/verify-adapter.mjs 钉住。
  // `defaultUploadDir` 两种形态都接受（值 / 惰性访问器）：内核传的是访问器。
  let UPLOAD_DIR = typeof resolveUploadDir === 'function' ? resolveUploadDir()
    : (typeof defaultUploadDir === 'function' ? defaultUploadDir() : defaultUploadDir);

  /** 取**当前**上传目录的访问器（不是值快照）。 */
  function getUploadDir() { return UPLOAD_DIR; }

  /**
   * 切换上传目录（落盘到 config.json）并迁移既有文件。
   * 整段跑在 `enqueueConfigWrite` 里：迁移 + `uploadDir` 持久化串行，不与 settings 的读-改-写交错。
   * @param {string} newDir
   * @param {boolean} [migrate]
   */
  function setUploadDir(newDir, migrate) {
    return enqueueConfigWrite(async () => {
      const oldDir = normalize(UPLOAD_DIR);
      const target = normalize(newDir);
      if (oldDir.toLowerCase() === target.toLowerCase()) {
        UPLOAD_DIR = target;
        return { uploadDir: target, migrated: 0, skipped: 0, same: true };
      }
      ensureDir(UPLOAD_DIR);   // 上游：`ensureUploadDir()` = `ensureDirOnce(getUploadDir())`
      let migrated = 0;
      let skipped = 0;
      if (migrate !== false && (await pathExistsP(oldDir))) {
        let entries;
        try { entries = await readdir(oldDir); } catch { entries = []; }
        for (const entry of entries) {
          if (entry === '.meta.json' || UPLOAD_FILE_RE.test(entry)) {
            // 逐项 await：迁移大量大文件时让出事件循环，避免一次性并发打满 IO。
            if (await moveFileP(join(oldDir, entry), join(target, entry))) migrated += 1;
            else skipped += 1;
          }
        }
      }
      // 运行期写者只有本函数，且整段跑在写队列里 ⇒ await 期间不会有第二个 setUploadDir 插进来。
      // eslint-disable-next-line require-atomic-updates -- 见上：全段串行在 enqueueConfigWrite 写队列里，写者唯一。
      UPLOAD_DIR = target;
      // 落盘（上游 `setUploadDir` 同款顺序与写法）：不写这一句，"改了上传目录"只活到本次进程结束 ——
      // 重启后解析链（env → config → 默认）又回旧目录，正是用户可见的"改了却像没生效"。
      // 整段仍在 `enqueueConfigWrite` 串行链里 ⇒ 与 settings 的读-改-写不会互相吞改动。
      const cfg = readConfig();
      cfg.uploadDir = target;
      writeConfig(cfg);
      ensureDir(UPLOAD_DIR);   // 上游此处那句 ensureUploadDir()（现在 UPLOAD_DIR 已是新目录）
      return { uploadDir: target, migrated, skipped, same: false };
    });
  }

  /**
   * 枚举"存储位置"目录里的**用户自有内容**（上游 `lib/index.js` 的门面级实现，逐字搬入）：
   *   1. `up-*.ext` 单文件上传（`UPLOAD_FILE_RE`）；
   *   2. **WE 工程目录**（含 `project.json`：`scene.pkg` / `scene.json` / `index.html` / `*.mp4`）
   *      —— 旧扫描器只认形态 1，把存储位置指向这种下载目录时一张场景壁纸都找不到。
   * `up-dir-` 前缀让目录形态与 `up-*` 同属"用户自有内容"，同时避开上传管理列表
   * （`/remove` 只解析 `up-*.ext` 文件 ⇒ 目录不会被误删）。
   * @param {string} dir
   */
  async function enumerateUploadsP(dir) {
    if (!(await pathExistsP(dir))) return [];
    let entries;
    try { entries = await readdir(dir); } catch { return []; }
    const files = [];
    const dirs = [];
    for (const entry of entries) {
      if (!entry || entry.startsWith('.')) continue;
      const abs = join(dir, entry);
      let st; try { st = await stat(abs); } catch { continue; }
      if (st.isFile()) {
        const m = UPLOAD_FILE_RE.exec(entry);
        if (!m) continue;
        const ext = m[2].toLowerCase();
        const id = m[1];
        const type = ext === 'mp4' ? 'video' : 'image';
        files.push({ id, type, fileAbs: abs, previewAbs: type === 'image' ? abs : null });
      } else if (st.isDirectory()) {
        dirs.push({ name: entry, abs });
      }
    }
    // WE 工程目录按 SCAN_CHUNK 分块：每个都要读 project.json + 几次存在性探测，
    // 而下载目录可能有几百个 —— 不设上限的扇出会淹掉 libuv 线程池（与 Steam 扫描同一纪律）。
    const projects = [];
    for (let i = 0; i < dirs.length; i += SCAN_CHUNK) {
      const chunk = dirs.slice(i, i + SCAN_CHUNK);
      const hits = await Promise.all(chunk.map(async ({ name, abs }) => {
        const proj = await readProjectP(abs);
        if (!proj || proj.type === 'application') return null;
        // 场景：解析真实容器 —— `project.json` 常声明 `scene.json` 而只随包 `scene.pkg`。
        const fileAbs = proj.type === 'scene'
          ? resolve(abs, (await resolveSceneMainFileP(abs, proj.file)) || proj.file)
          : resolve(abs, proj.file);
        if (!(await pathExistsP(fileAbs))) return null;   // 主文件缺失 ⇒ 不可用
        let previewAbs = proj.preview ? resolve(abs, proj.preview) : null;
        if (previewAbs && !(await pathExistsP(previewAbs))) previewAbs = null;
        if (!previewAbs) {
          // `previewCandidates` 允许传**函数**：上传库 kit 在本 kit 之后才建（它要注入本 kit 的
          // `getUploadDir`）⇒ 列表只能惰性取，否则会读到 undefined。
          const cands = typeof previewCandidates === 'function' ? (previewCandidates() || []) : (previewCandidates || []);
          for (const cand of cands) {
            const p = join(abs, cand);
            if (await pathExistsP(p)) { previewAbs = p; break; }
          }
        }
        return {
          id: `up-dir-${name}`,
          title: proj.title || name,
          type: proj.type,
          fileAbs,
          previewAbs,
          contentrating: proj.contentrating,
          // 作者配色必须透传（漏掉它 = 「主题随壁纸」对这些壁纸永不生效）。
          schemeColor: proj.schemeColor,
        };
      }));
      for (const hit of hits) if (hit) projects.push(hit);
    }
    const out = [...files, ...projects];
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }

  return { getUploadDir, setUploadDir, resolveUploadFile, UPLOAD_MAX_BYTES, UPLOAD_FILE_RE, enumerateUploadsP };
}
