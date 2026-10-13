/**
 * Steam / Wallpaper Engine 安装探测：注册表查 Steam 路径、解析 libraryfolders.vdf、枚举库、
 * 判定某个目录是不是 WE 安装根，以及把这些结果缓存起来。
 *
 * 为什么单独成模块：这是宿主启动路径上最重的一段 I/O（Windows 走 reg.exe、WSL 要扫 /mnt、
 * 每个候选根都要探标记文件），而它的三条纪律 —— 60s TTL、inflight 去重、只认「能扫出壁纸的库」——
 * 之前和壁纸枚举混在同一个文件里，导致「探测为什么慢/为什么漏库」无从下手。
 *
 * 不变量：
 *  1. 探测结果只经 `steamProbeDirsP()` 出：60s TTL（`STEAM_PROBE_TTL_MS`）+ inflight 去重；
 *     `DSH_WE_STEAM_ROOT` 的值进 key，变了就重探（不能被旧缓存挡住）。
 *  2. `locateWallpaperEngineP()` 是**唯一**的安装根推导：env → 注册表 → `STEAM_PROBE_DIRS`
 *     → WSL 候选，逐个用 `isWallpaperEngineRootP()` 判（判据是 distribution 下的标记文件）。
 *  3. `owningLibrariesP()` 只把「真的扫得出壁纸的库」算作归属：判据是
 *     `steamapps/workshop/content/<appid>` 存在。否则卸载残留的 `wallpaper_engine` 目录会
 *     登记成一个永远出不了壁纸的库（反过来，改名后的安装目录也会丢掉一个本该有的库）。
 *  4. 存在性一律走注入的 `pathExistsP`（本模块不直接 stat）；appid 由宿主注入，它是 workshop
 *     路径的一部分，也是模块里唯一认识 WE 的地方。
 *  5. 缓存（`steamProbeCache`/`steamProbeInflight`）是**套件内状态**：宿主在模块加载期建立一个
 *     实例 ⇒ 等价于原来的模块级单例；跨 apply 的可见性靠这一个门面，不需要 host 侧再持有。
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

export function createSteamDiscoveryKit({ WE_APPID, pathExistsP }) {
  /** Common Steam install locations probed when libraryfolders.vdf is missing. */
  const STEAM_PROBE_DIRS = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\SteamLibrary',
    'E:\\SteamLibrary',
  ];

  /** reg.exe: SystemRoot on Windows, /mnt/<letter>/Windows/System32 on WSL; null elsewhere. */
  async function resolveRegExeP() {
    if (process.platform === 'win32') {
      return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    }
    if (process.platform !== 'linux') return null;
    let letters;
    try { letters = (await readdir('/mnt')).filter((n) => /^[a-zA-Z]$/.test(n)); } catch { return null; }
    for (const letter of letters) {
      const p = join('/mnt', letter, 'Windows', 'System32', 'reg.exe');
      if (await pathExistsP(p)) return p;
    }
    return null;
  }

  /** Steam root from HKCU\\Software\\Valve\\Steam on Windows and WSL; null elsewhere. */
  function steamPathFromRegistryP() {
    return resolveRegExeP().then((reg) => {
      if (!reg) return null;
      return new Promise((resolvePromise) => {
        try {
          // async execFile (5s timeout): execFileSync would block the event loop.
          execFile(
            reg,
            ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
            { encoding: 'utf8', windowsHide: true, timeout: 5000 },
            (err, stdout) => {
              if (err) { resolvePromise(null); return; }
              const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout || '');
              const p = m ? normalize(m[1].trim()) : null;
              resolvePromise(p ? wslPath(p) : null);
            },
          );
        } catch { resolvePromise(null); }
      });
    });
  }

  /** Steam roots from DSH_WE_STEAM_ROOT (comma/semicolon separated, Windows or /mnt paths). */
  function steamRootsFromEnv() {
    const raw = process.env.DSH_WE_STEAM_ROOT && process.env.DSH_WE_STEAM_ROOT.trim();
    if (!raw) return [];
    return raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(wslPath);
  }

  /**
   * WSL-only: Windows Steam drives appear under /mnt/<letter>. Probe them so a
   * Harness running inside WSL can discover a Windows Wallpaper Engine install
   * (paths are DrvFS mounts — slow, which is exactly why only async probes run).
   */
  async function wslSteamRootsP() {
    if (process.platform !== 'linux') return [];
    let letters;
    try { letters = (await readdir('/mnt')).filter((n) => /^[a-zA-Z]$/.test(n)); } catch { return []; }
    const roots = [];
    for (const letter of letters) {
      const base = join('/mnt', letter);
      for (const c of [
        join(base, 'Program Files (x86)', 'Steam'),
        join(base, 'Program Files', 'Steam'),
        join(base, 'Steam'),
        join(base, 'SteamLibrary'),
      ]) {
        if (await pathExistsP(join(c, 'steamapps', 'libraryfolders.vdf'))) roots.push(c);
      }
    }
    return roots;
  }

  // Probe list 缓存：reg.exe 查询 + WSL /mnt 探测（DrvFS，慢）组合一次要几秒，
  // 而 buildInventory 每次请求都调用两次（locateWallpaperEngineP / owningLibrariesP）。
  // TTL 60s（含失败结果——Steam 未安装时不能每次请求都重新全盘探测），并发调用
  // 共享同一个 in-flight Promise。
  const STEAM_PROBE_TTL_MS = 60 * 1000;
  let steamProbeCache = null; // { t, key, dirs }
  let steamProbeInflight = null;

  /**
   * Probe list: env override(s), then the registry root, then known dirs, then WSL
   * /mnt mounts. The env override comes FIRST on purpose: it is an explicit user
   * (and self-check) instruction, and `locateWallpaperEngineP` returns the first
   * candidate that matches — with the registry first, a deliberate override could
   * never point away from an install Steam already knows about, and fixture-based
   * self-checks would silently pick up the developer's real install.
   */
  async function steamProbeDirsP() {
    // The 60s TTL exists for the expensive part (reg.exe query + WSL /mnt scan)
    // and deliberately caches failures too. The env override is re-read on every
    // call and is part of the cache key: otherwise a changed DSH_WE_STEAM_ROOT
    // stays masked by the TTL of an earlier probe.
    const envKey = process.env.DSH_WE_STEAM_ROOT || '';
    if (steamProbeCache && steamProbeCache.key === envKey
        && Date.now() - steamProbeCache.t < STEAM_PROBE_TTL_MS) {
      return steamProbeCache.dirs;
    }
    if (steamProbeInflight) return steamProbeInflight;
    steamProbeInflight = (async () => {
      const env = steamRootsFromEnv();
      const reg = await steamPathFromRegistryP();
      const wsl = await wslSteamRootsP();
      return [...env, ...(reg ? [reg] : []), ...STEAM_PROBE_DIRS, ...wsl];
    })();
    // require-atomic-updates（噪声，非竞态）：`steamProbeCache` 与 `steamProbeInflight` 的写者
    // 只有**在途发起者**这一路 —— 并发合流者在上面 `if (steamProbeInflight) return …` 就返回了，
    // 走不到下面两处写；`steamProbeInflight` 的 finally 清空同理也不会误清别人的在途 Promise
    // （只要它还非空，就没有第二个调用会去建新的 in-flight）。
    try {
      const dirs = await steamProbeInflight;
      // eslint-disable-next-line require-atomic-updates -- 见上方注释：写者只有在途发起者这一路（合流者上面已 return）。
      steamProbeCache = { t: Date.now(), key: envKey, dirs };
      return dirs;
    } finally {
      // eslint-disable-next-line require-atomic-updates -- 见上方注释：finally 只清自己建的那个 inflight，不会误清别人的在途。
      steamProbeInflight = null;
    }
  }

  /**
   * On WSL, translate a Windows path (`D:\SteamLibrary`) to its DrvFS mount form
   * (`/mnt/d/SteamLibrary`). libraryfolders.vdf entries are always Windows-style
   * even when read from inside WSL — without this the workshop library would
   * silently resolve to nothing. No-op on every other platform.
   */
  function wslPath(p) {
    if (process.platform !== 'linux' || typeof p !== 'string') return p;
    const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p);
    if (!m) return p;
    return join('/mnt', m[1].toLowerCase(), m[2].replace(/\\/g, '/'));
  }

  /** Valve KeyValues parser for libraryfolders.vdf: libraries owning WE. */
  async function librariesFromVdfP(vdfPath) {
    let text;
    try { text = await readFile(vdfPath, 'utf8'); } catch { return []; }
    const libs = [];
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
      if (m) { current = m[1].replace(/\\\\/g, '\\'); continue; }
      if (current && line.includes(WE_APPID)) {
        const t = wslPath(current);
        if (t && !libs.includes(t)) libs.push(t);
      }
    }
    return libs;
  }

  /**
   * Relative paths that prove a directory is the Wallpaper Engine install root.
   * Classic builds keep the executables at the root; current builds ship them one
   * level down in `distribution\` and leave only `launcher.exe` / `installer.exe` /
   * `ChromaAppInfo.xml` behind. Probing the classic path alone therefore reports
   * "not installed" for a current install, which is not a degradation but a
   * disappearance: the portable-project scan (`<root>/projects/*`) and the WE
   * playlist reads that back rotation (`<root>/config.json`) both hang off the
   * install root. `distribution/version.json` is always shipped next to the
   * executables, so it keeps detection working if they are renamed again.
   */
  const WE_INSTALL_MARKERS = [
    'wallpaper32.exe',
    'wallpaper64.exe',
    join('distribution', 'wallpaper32.exe'),
    join('distribution', 'wallpaper64.exe'),
    join('distribution', 'version.json'),
  ];

  /**
   * True when `dir` is a Wallpaper Engine install root. This is a *probe* only:
   * callers keep `dir` itself (the directory holding `projects/` and
   * `config.json`), never the `distribution\` subdirectory that matched.
   */
  async function isWallpaperEngineRootP(dir) {
    for (const marker of WE_INSTALL_MARKERS) {
      if (await pathExistsP(join(dir, marker))) return true;
    }
    return false;
  }

  /** Locate the Wallpaper Engine install root (where `projects/` and `config.json` live; the executables may sit one level down in `distribution\`). */
  async function locateWallpaperEngineP() {
    const candidates = [];
    const libraries = [];
    const probes = await steamProbeDirsP();
    for (const probe of probes) {
      const vdf = join(probe, 'steamapps', 'libraryfolders.vdf');
      if (await pathExistsP(vdf)) {
        try { libraries.push(...await librariesFromVdfP(vdf)); } catch { /* skip */ }
      }
    }
    const roots = [...probes, ...libraries];
    for (const root of roots) candidates.push(join(root, 'steamapps', 'common', 'wallpaper_engine'));
    candidates.push(wslPath('C:\\Program Files (x86)\\Wallpaper Engine'));

    const seen = new Set();
    for (const raw of candidates) {
      const dir = normalize(raw);
      if (seen.has(dir)) continue;
      seen.add(dir);
      if (await isWallpaperEngineRootP(dir)) return dir;
    }
    return null;
  }

  /** Libraries that own Wallpaper Engine (for the workshop content root). */
  async function owningLibrariesP() {
    const libs = [];
    for (const probe of await steamProbeDirsP()) {
      const vdf = join(probe, 'steamapps', 'libraryfolders.vdf');
      if (await pathExistsP(vdf)) {
        try { libs.push(...await librariesFromVdfP(vdf)); } catch { /* skip */ }
      }
      // The Steam root a libraryfolders.vdf lives in is itself a library, but it
      // is never listed as a "path" entry. If Wallpaper Engine is installed in
      // the DEFAULT Steam library, its workshop content lives under that same
      // root — include it, or every workshop wallpaper silently disappears from
      // the inventory (and playlists cannot resolve, breaking rotation).
      // Probe the directory the scan actually reads, not the install directory:
      // a bare `wallpaper_engine` folder left behind by an uninstalled game used
      // to register a library that could never yield a wallpaper (and a renamed
      // install folder used to lose one that could).
      if (await pathExistsP(join(probe, 'steamapps', 'workshop', 'content', WE_APPID))) libs.push(probe);
    }
    return [...new Set(libs)];
  }
  return { locateWallpaperEngineP, owningLibrariesP };
}
