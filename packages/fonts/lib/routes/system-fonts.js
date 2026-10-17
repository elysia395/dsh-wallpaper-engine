/**
 * routes/system-fonts.js — **本机字体清单**的唯一一条路由：`GET <BASE>/system-fonts`
 * （设置页「全局字体 / 终端字体」两个下拉里那一组「本机字体」的数据源）。
 *
 * 为什么独立成文件：这一族要回答的问题与别处都不同 —— "字体清单从哪来（三平台各自的工具）、
 * 工具不在时给什么、一次扫描很贵所以缓存放哪、缓存放多久"。写进 `lib/index.js` 只会让那个门面
 * 多一段与壁纸无关的进程调用。
 *
 * ══ 清单从哪来（**权威**来源可有多条，取并集；失败才降级）══════════════════════════════
 *   · macOS **两条腿**（并行跑，取名字并集 —— 这是"两种写法都能选到"的原因）：
 *       ① `system_profiler SPFontsDataType -json -detailLevel mini` → `typefaces[].family`
 *          = **本地化**族名（中文系统上 `PingFang SC` 报成 `苹方-简`）。**实测**：本机 367 个
 *          字体文件 → 359 个族名（含 `.` 开头的私有族）；耗时 ~10s ⇒ 必须缓存，见下。
 *       ② CoreText（`osascript -l JavaScript` → `CTFontManagerCopyAvailableFontFamilyNames`）
 *          = **规范（英文）族名**：`PingFang SC` / `Heiti SC` / `Songti SC` … 实测 ~0.05s。
 *          为什么必须有它：CSS / 字体册英文界面 / 设计软件用的都是这套名字，本插件的内置族键
 *          （`STXingkai` / `KaiTi` …）也是英文名 —— 只有本地化名时用户找不到自己认识的字体，
 *          看着就像"没扫全"（**用户报的缺陷**）。
 *   · Windows `powershell … InstalledFontCollection`（族名是 .NET 那边的权威口径）；
 *            拿不到时退回注册表 `Fonts` 键的**值名**（那是"字体名"不是族名 ⇒ 标 approximate）
 *   · Linux  `fc-list --format=%{family}\n`（fontconfig 的族名口径，一行可含多个别名逗号分隔）
 * 权威来源一条都没拿到（工具不在 / 调用失败 / 超时）时走 `parseFontFileNames`：扫字体目录按
 * **文件名**推族名，并**如实标 `approximate: true`** —— 面板据此显示"按文件名推测"。宁可说清是
 * 推测，也不要让一个猜出来的名字看着像真的（与「内嵌 MP4 探测未命中一律 未知」同一口径）。
 *
 * ══ 缓存（一次扫描 10s，绝不能每次开面板都付）══════════════════════════════════════
 * 内存 + 落盘（`cachePath()`，`pluginDataDir()/system-fonts.json`）双层；TTL 见
 * `SYSTEM_FONTS_TTL_MS`。过期**照旧先回旧值**（标 `stale: true`）、后台重扫 —— 面板永远
 * 是"先有东西可选"，不会因为一次扫描把界面卡住。`?refresh=1` 强制重扫（面板上的「重新扫描」）。
 * 并发请求合并成一次扫描（与 `star-count` 同形）。
 *
 * 不变量：
 *   · **不猜**：权威来源给的族名原样使用（只去重排序 + 过滤私有族）；只有降级路径的结果才带
 *     `approximate` 标记。
 *   · **绝不把失败甩成 5xx**：任何失败都回 200 + `ok:false` + 原因（清单给空数组，面板说得出话）。
 *   · **有界**：单次进程输出有上限、清单有条数上限、没有超时的子进程不留在后台
 *     （超时即 kill，之后走降级路径）—— 一个挂住的 `system_profiler` 不许拖住整个插件。
 *   · **子进程输出必须按字节收、最后一次性解码**：逐块 `toString('utf8')` 会在多字节字符跨块时
 *     插进 U+FFFD（实测 `系统字体` → `系统\uFFFD\uFFFD\uFFFD体`）⇒ 清单里出现认不出的族名。
 *   · **过滤掉不可用的名字**：`.` 开头的私有族、以及过不了共享内核 `systemFontKeyOf`
 *     校验的名字（含控制符 / 引号 / 括号类破坏 CSS 的字符）一律不进清单 ⇒ 前端拿到的
 *     每个名字都能安全变成 `sys:` 族键。
 *   · **扫描不在启动期发生**：只有第一次请求这条路才触发（`apply()` 一个字节都不写，
 *     与字体集迁移同一条纪律）。
 *
 * 契约：`registerSystemFontsRoutes(webServer, c)`；`c` 里是这一族用到但不属于它的东西：
 *   · `disposers` / `base: BASE` ← 清理句柄与路径前缀
 *   · `cachePath()`             ← 落盘缓存路径（`pluginDataDir()/system-fonts.json`）
 *   · `log`                     ← 降级要留痕（成功不记：成功是常态）
 *   · `schema`                  ← 共享内核的纯符号面（本族只用 `systemFontKeyOf`，见下）
 *   · `http`                    ← JSON 应答的纯函数面（本族只用 `sendJson`，见下）
 *   · `platform` / `home` / `fontDirs` / `runFontCommand` ← **可选**注入点：真实调用一个都不传
 *     （各自有默认实现），守卫用它们换掉平台、目录与子进程（本族**不 spawn** 真进程就能判）。
 * 本文件自己的纯函数（`collectSystemFonts` / `defaultRun` / 各 `parse*`）**导出**：守卫用夹具判前者，
 * 用**真子进程**判 `defaultRun` 的解码（那一条没有夹具能替）。
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// 跨包通道（ADR-0014 S5.1 / S5.3）：本族**零主包 specifier** —— 共享内核的纯符号面也不静态
// import，而由 `registerSystemFontsRoutes` 的 `c` 显式收下（调用点 = 子包入口
// packages/fonts/lib/index.js，值来自 `ctx.wallpaperEngineHost`）：
//   · `c.schema.systemFontKeyOf` —— 名字的值域与前端**同一份**（这里过滤掉的名字，前端也一定拼不出族键）。
//   · `c.http.sendJson` —— JSON 应答的**唯一实现**（状态码 + 两个头 + end，见主包 lib/json-response.js）。
// 运行期才存在的实例（disposers / cachePath / log / 平台注入点）仍逐键从 `c` 消费。
// 模块作用域**不持有**主包的任何值（ADR-0014 S5.1 / S5.3 反模式：HMR 后旧代 exports）。

/** 权威扫描的成功结果新鲜期：字体装/删不频繁，一次扫描（macOS ~10s）摊到一周可接受。 */
const SYSTEM_FONTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * **落盘缓存的口径版本**：`readDisk` 只认这个版本，别的（含没有这个字段的老缓存）一律当"没有缓存"
 * ⇒ 立刻重扫。
 *
 * 为什么必须有它：TTL 是一周，而"清单长什么样"会随**代码**变（加了一条腿、改了过滤规则、修了解码）。
 * 没有版本号时，用户升级插件后最长一周里拿到的还是**老口径**的结果 —— 表现就是"改了没生效"，
 * 而且看不出是缓存。**改动枚举口径（来源、过滤、解码）时必须 +1。**
 */
const SYSTEM_FONTS_CACHE_VERSION = 2;
/** 单个子进程的超时：macOS 实测 ~10s，25s 给慢机器留余量；超时即 kill 并降级。 */
const FONT_SCAN_TIMEOUT_MS = 25000;
/** 子进程输出上限（macOS 的 JSON 实测 ~2MB）：够用，又不让一次异常输出吃光内存。 */
const FONT_SCAN_MAX_BYTES = 16 * 1024 * 1024;
/** 清单条数上限：一台机器几百到几千个族名，超出即截断（只影响这份"可选清单"）。 */
const SYSTEM_FONTS_MAX = 2000;
/** 目录扫描（降级路径）的递归深度与文件数上限：不让一次扫目录变成无界遍历。 */
const FONT_DIR_MAX_DEPTH = 3;
const FONT_DIR_MAX_FILES = 4000;

/**
 * macOS 的第二条腿：**CoreText 的规范族名**（英文名）—— 一条 JXA 脚本，实测几十毫秒。
 *
 * 为什么需要它（**用户报的"没扫出本机所有字体"的直接修法**）：`system_profiler` 报的是
 * **本地化**族名 —— 中文系统上 `PingFang SC` 报成 `苹方-简`、`Heiti SC` 报成 `黑体-简`。
 * 而那套英文名才是 CSS / 字体册（英文界面）/ 设计软件里用的名字，本插件的**内置族键**
 * （`STXingkai` / `KaiTi` / `SimHei` …）也是英文名 ⇒ 用户在"本机字体"里找不到自己认识的字体，
 * 看着就像"没扫全"。两种名字在 Chromium 里命中同一个字体（实测 `"PingFang SC"` 与 `"苹方-简"`
 * 的渲染宽度逐位相同）⇒ 两条腿的名字**取并集**，两种写法都能选到。
 *
 * 为什么走 `osascript -l JavaScript` 而不是 `fc-list`：macOS 默认没有 fontconfig；而 CoreText
 * 自己的族名列表就是"系统认为存在哪些字体族"的权威答案（实测与本机字体册逐条对得上）。
 * 它**只做枚举**（`CTFontManagerCopyAvailableFontFamilyNames`），不取本地化名 —— 那条路要穿过
 * CFStringRef 的桥接（实测拿回来是 `[object Ref]`，不可靠），本地化名由 `system_profiler` 那条腿负责。
 */
const CORETEXT_LIST_ARGS = [
  '-l', 'JavaScript', '-e',
  'ObjC.import("CoreText");'
  + 'const arr=$.CTFontManagerCopyAvailableFontFamilyNames();'
  + 'const n=$.CFArrayGetCount(arr);'
  + 'const out=[];'
  + 'for(let i=0;i<n;i++)out.push(ObjC.unwrap(ObjC.castRefToObject($.CFArrayGetValueAtIndex(arr,i))));'
  + 'out.join("\\n");',
];

/** 按平台给**权威来源**（绝对路径优先 —— Electron 的 PATH 不保证含 /usr/sbin）。可有多条。 */
function authoritativeSources(platform) {
  if (platform === 'darwin') {
    const bin = existsSync('/usr/sbin/system_profiler') ? '/usr/sbin/system_profiler' : 'system_profiler';
    // 两条腿**并行**跑：慢的那条决定总耗时，快的那条几乎免费 ⇒ 冷扫描不因为多一条而变慢。
    return [
      { source: 'system_profiler', cmd: bin, args: ['SPFontsDataType', '-json', '-detailLevel', 'mini'], parse: parseMacFonts },
      { source: 'coretext', cmd: 'osascript', args: CORETEXT_LIST_ARGS, parse: parseLineFamilies },
    ];
  }
  if (platform === 'win32') {
    return [{
      source: 'powershell-fonts',
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -AssemblyName System.Drawing; '
        + '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'],
      parse: parseLineFamilies,
    }];
  }
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    return [{ source: 'fc-list', cmd: 'fc-list', args: ['--format=%{family}\\n'], parse: parseFcList }];
  }
  return [];
}

/**
 * **非**权威来源（只有 Windows 有）：注册表的值名是"字体名"（可能带 Bold/Italic）而不是族名
 * ⇒ 结果标 `approximate`。只在**权威**那条腿失败后才试。
 */
function fallbackSources(platform) {
  if (platform === 'win32') {
    return [{
      source: 'registry',
      cmd: 'reg.exe',
      args: ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'],
      parse: parseWindowsFontRegistry,
    }];
  }
  return [];
}

// ── 纯解析（每个都只吃文本、只吐族名数组；守卫用夹具判它们）────────────────────

/**
 * macOS `system_profiler … -json`：每个条目是一个**字体文件**，族名在
 * `typefaces[].family` 里（**不是**条目自己的 `_name` —— 那是文件名）。
 * 形状不对一律给空数组（宁可走降级，也不猜）。
 */
function parseMacFonts(text) {
  let doc;
  try { doc = JSON.parse(String(text || '')); } catch { return []; }
  const list = doc && Array.isArray(doc.SPFontsDataType) ? doc.SPFontsDataType : null;
  if (!list) return [];
  const out = [];
  for (const item of list) {
    const faces = item && Array.isArray(item.typefaces) ? item.typefaces : [];
    for (const face of faces) {
      if (face && typeof face.family === 'string') out.push(face.family);
    }
  }
  return out;
}

/** `fc-list --format=%{family}\n`：一行一个字体，族名可用逗号给多个别名（本地化名）。 */
function parseFcList(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    for (const name of line.split(',')) out.push(name);
  }
  return out;
}

/** 一行一个族名（PowerShell 的 `$_.Name` 输出就是这个形状）。 */
function parseLineFamilies(text) {
  return String(text || '').split(/\r?\n/);
}

/**
 * Windows 注册表 `Fonts` 键的 `reg query` 输出。行形如
 *   `    Arial (TrueType)    REG_SZ    arial.ttf`
 * 取**值名**并去掉结尾的 `(TrueType)` / `(OpenType)` 这类后缀。注意值名是"字体名"
 * （可能带 Bold/Italic）而不是族名 ⇒ 调用方会把这条路径的结果标成 approximate。
 */
function parseWindowsFontRegistry(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^HKEY/i.test(line)) continue;
    const m = line.match(/^(.*?)\s+REG_\w+\s+/);
    if (!m) continue;
    out.push(m[1].replace(/\s*\((?:TrueType|OpenType|Type 1|All res)\)\s*$/i, ''));
  }
  return out;
}

/** 文件名里常见的字重/字形词（降级路径把它们从文件名尾部摘掉换算族名）。 */
const FONT_STYLE_WORDS = [
  'thin', 'extralight', 'ultralight', 'light', 'book', 'regular', 'normal', 'medium',
  'semibold', 'demibold', 'demib', 'bold', 'extrabold', 'ultrabold', 'black', 'heavy',
  'italic', 'oblique', 'condensed', 'narrow', 'expanded', 'wide', 'retina',
];
const FONT_FILE_RE = /\.(ttf|otf|ttc|dfont)$/i;

/** 文件名 → 族名（降级用：只做"去扩展名 + 摘掉尾部字重词"两件确定的事）。 */
function familyFromFileName(fileName) {
  let base = String(fileName || '').replace(FONT_FILE_RE, '');
  // `PingFang-SC-Regular` / `Arial_Bold_Italic` / `SourceSansPro Bold` 三种分隔都遇到。
  const parts = base.split(/[-_,]/);
  while (parts.length > 1 && FONT_STYLE_WORDS.includes(parts[parts.length - 1].toLowerCase())) parts.pop();
  base = parts.join(' ').replace(/\s+/g, ' ').trim();
  return base;
}

/** 目录扫描（降级路径）：递归收集字体文件名 → 推族名。 */
function parseFontFileNames(names) {
  const out = [];
  for (const n of Array.isArray(names) ? names : []) {
    const family = familyFromFileName(n);
    if (family) out.push(family);
  }
  return out;
}

/** 按平台列出字体目录（降级路径用；不存在的一律跳过）。 */
function fontDirs(platform, home) {
  const dirs = [];
  if (platform === 'darwin') {
    dirs.push('/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts',
      join(home, 'Library', 'Fonts'));
  } else if (platform === 'win32') {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    dirs.push(join(root, 'Fonts'));
    const local = process.env.LOCALAPPDATA;
    if (local) dirs.push(join(local, 'Microsoft', 'Windows', 'Fonts'));
  } else {
    dirs.push('/usr/share/fonts', '/usr/local/share/fonts', join(home, '.fonts'),
      join(home, '.local', 'share', 'fonts'));
  }
  return dirs;
}

/** 递归收集字体文件名（有界：深度与文件数都封顶）。 */
function collectFontFiles(dirs, depth, files) {
  if (depth > FONT_DIR_MAX_DEPTH || files.length >= FONT_DIR_MAX_FILES) return files;
  for (const dir of dirs) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (files.length >= FONT_DIR_MAX_FILES) return files;
      const abs = join(dir, e.name);
      if (typeof e.isDirectory === 'function' && e.isDirectory()) {
        collectFontFiles([abs], depth + 1, files);
      } else if (typeof e.isFile === 'function' && e.isFile() && FONT_FILE_RE.test(e.name)) {
        files.push(e.name);
      }
    }
  }
  return files;
}

// ── 收口：名字 → 干净清单 ────────────────────────────────────────────────────

/**
 * 名字数组 → 清单。三件事：去空白、丢**不可用**的名字（`.` 开头的私有族 / 过不了共享内核
 * 校验的）、去重排序（`localeCompare`：中文名与拉丁名混排时按本地口径，比码点序可读）。
 *
 * `keyOf` 就是共享内核的 `systemFontKeyOf`（纯函数）—— 本文件**不再静态 import** 它：调用方
 * （`registerSystemFontsRoutes` 经 `c.schema`，或守卫直接调用本导出）把面传进来。
 * 本文件零主包 specifier ⇒ **没有模块级默认可退**：缺 face 时**显式抛错**
 * （宁可响亮失败，也别静默按"全不过滤"跑出一份脏清单）。
 */
function normalizeFamilies(names, keyOf) {
  if (typeof keyOf !== 'function') {
    throw new Error('normalizeFamilies(names, keyOf)：缺少 systemFontKeyOf 面（c.schema.systemFontKeyOf）');
  }
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || name.startsWith('.')) continue;      // `.Apple Color Emoji UI` 这类私有族
    if (!keyOf(name)) continue;                       // 进不了 `sys:` 键的名字一律不要
    const dedupe = name.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(name);
    if (out.length >= SYSTEM_FONTS_MAX) break;
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** 默认的子进程执行器：有超时、有输出上限、超时即 kill。 */
function defaultRun(cmd, args) {
  // ⚠️ Promise 执行器的形参**不能**叫 `resolve`：本仓有一条守卫判"路由模块不得引用 `lib/index.js`
  //    单独 import 的名字"（那里 import 了 node:path 的 `resolve`），按名扫会把它当成越界。
  return new Promise((done) => {
    let child = null;
    try {
      child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      done({ ok: false, stdout: '', error: String((err && err.message) || err) });
      return;
    }
    // ⚠️ **按字节收、最后一次性解码**：逐块 `chunk.toString('utf8')` 再拼，会在一个多字节字符
    //    跨块时插进 U+FFFD —— 实测 `系统字体` 变成 `系统\uFFFD\uFFFD\uFFFD体`，而同一份输出里
    //    那个正确的名字也在 ⇒ 清单里同时出现"好的"和"坏的"两条（用户看到的就是一个认不出的
    //    字体族）。超上限即判失败：截断的 JSON 解析不出东西，宁可走降级也不给半份名单。
    const chunks = [];
    let bytes = 0;
    let settled = false;
    let overflow = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(result);
    };
    const timer = setTimeout(() => {
      // 判 pid 再 kill：`cmd` 不存在时 spawn 失败 ⇒ `pid === undefined`，此时 `kill()`
      // 会同步挂死事件循环（不抛，`try/catch` 挡不住）。pid 未落地就没有进程可杀。
      if (child.pid !== undefined) { try { child.kill('SIGKILL'); } catch { /* 已经退出 */ } }
      finish({ ok: false, stdout: '', error: 'timeout' });
    }, FONT_SCAN_TIMEOUT_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
    child.stdout.on('data', (buf) => {
      if (overflow) return;
      bytes += buf.length;
      if (bytes > FONT_SCAN_MAX_BYTES) { overflow = true; return; }
      chunks.push(buf);
    });
    child.on('error', (err) => finish({ ok: false, stdout: '', error: String((err && err.message) || err) }));
    child.on('close', (code) => {
      if (overflow) { finish({ ok: false, stdout: '', error: 'too-large' }); return; }
      finish({ ok: code === 0, stdout: Buffer.concat(chunks).toString('utf8'), error: code === 0 ? '' : 'exit ' + code });
    });
  });
}

/** 跑**一条**来源：命令失败 / 输出为空 / 解析抛错都返 `null`（调用方只关心"拿到名字没有"）。 */
async function runSource(source, run, now) {
  let res;
  try { res = await run(source.cmd, source.args); } catch (err) {
    res = { ok: false, stdout: '', error: String((err && err.message) || err) };
  }
  if (!res || !res.ok || !res.stdout) return null;
  let families;
  try { families = source.parse(res.stdout); } catch { return null; }
  return { source: source.source, families, at: now() };
}

/**
 * 扫一次本机字体。
 *
 * 顺序（每一步都是"上一步真的没拿到名字"才走）：
 *   ① **权威来源**（可多条）**并行**跑，名字取**并集** —— macOS 那条"本地化名 + 规范名"的并集
 *      就是两种写法都能选到的原因（见 `CORETEXT_LIST_ARGS` 上面那段）；
 *   ② Windows 注册表（**非**权威：值名不是族名）⇒ 标 `approximate`；
 *   ③ 按字体文件名推 ⇒ 标 `approximate`。
 * @param {object} deps 依赖注入面（全部可省；缺省走真实环境）
 * @param {string} [deps.platform]  'darwin' | 'win32' | 'linux' | …
 * @param {(cmd:string, args:string[]) => Promise<{ok:boolean, stdout:string, error?:any}>} [deps.run]  可注入；默认真 spawn
 * @param {string} [deps.home]      家目录（默认 `homedir()`；守卫喂夹具）
 * @param {string[]} [deps.dirs]    降级路径要扫的目录（默认按平台 + 家目录推；守卫喂夹具目录）
 * @param {() => number} [deps.now] 时钟（默认 `Date.now`）
 * @param {(name:string) => (string|undefined)} [deps.keyOf] 共享内核的名字校验面（`systemFontKeyOf`；
 *   纯函数，本文件**没有**模块级默认 —— 调用点必须给，缺了 `normalizeFamilies` 抛错）
 * @returns `{ fonts, source, approximate, scannedAt }` —— `fonts` 可能为空 = 真的一个都没读到
 */
async function collectSystemFonts(deps) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const platform = typeof d.platform === 'string' ? d.platform : process.platform;
  const run = typeof d.run === 'function' ? d.run : defaultRun;
  const home = typeof d.home === 'string' && d.home ? d.home : homedir();
  const now = typeof d.now === 'function' ? d.now : Date.now;
  // 共享内核的名字校验面（纯函数）由调用方传入；本文件零主包 specifier ⇒ 没有模块级默认可退
  // （normalizeFamilies 缺 face 会显式抛错）。
  const keyOf = typeof d.keyOf === 'function' ? d.keyOf : undefined;

  const authoritative = await Promise.all(
    authoritativeSources(platform).map((s) => runSource(s, run, now)));
  const merged = [];
  const used = [];
  let scannedAt = 0;
  for (const r of authoritative) {
    if (!r) continue;
    merged.push(...r.families);
    used.push(r.source);
    if (r.at > scannedAt) scannedAt = r.at;
  }
  const fonts = normalizeFamilies(merged, keyOf);
  if (fonts.length) {
    return { fonts, source: used.join('+'), approximate: false, scannedAt: scannedAt || now() };
  }

  // ② 非权威来源（Windows 注册表）：值名是"字体名"不是族名 ⇒ 标推测。
  for (const s of fallbackSources(platform)) {
    const r = await runSource(s, run, now);
    if (!r) continue;
    const f = normalizeFamilies(r.families, keyOf);
    if (f.length) return { fonts: f, source: r.source, approximate: true, scannedAt: r.at };
  }

  // ③ 降级：按文件名推（同样**标明是推测**）。
  const scanDirs = Array.isArray(d.dirs) ? d.dirs : fontDirs(platform, home);
  const files = collectFontFiles(scanDirs, 0, []);
  return {
    fonts: normalizeFamilies(parseFontFileNames(files), keyOf),
    source: 'file-names', approximate: true, scannedAt: now(),
  };
}

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
// 四键都是**运行期实例**（清理句柄 / 路径前缀 / 缓存路径 / 日志），调用点 = `packages/fonts/lib/index.js`，
// 由主包 `host.keys('fonts')` 一次给全；`schema` / `http` 是共享内核的**纯符号面**，
// 由同一个调用点从 `ctx.wallpaperEngineHost` 显式传下（见文件头）—— 本文件零主包 specifier。
export const DEPS = ['disposers', 'base', 'cachePath', 'log', 'schema', 'http'];
/** 允许缺席的键：真实调用点一个都不传，代码各有默认实现（守卫/测试用它们换掉平台、目录与子进程）。 */
export const OPTIONAL_DEPS = ['platform', 'home', 'fontDirs', 'runFontCommand'];

export function registerSystemFontsRoutes(webServer, c) {
  // 后四个是**可选**注入点：真实调用一个都不传（各有默认实现），守卫用它们换掉平台、目录与
  // 子进程 —— 于是本族**不 spawn 真进程**也能判（这是本文件唯一能跨平台判的那一半）。
  const { disposers, base: BASE, cachePath, log, schema, http, platform, home, fontDirs, runFontCommand } = c;
  // `keyOf` 是**纯函数面**（`c.schema.systemFontKeyOf`），随 deps 传进 `collectSystemFonts`。
  const deps = { platform, home, dirs: fontDirs, run: runFontCommand, keyOf: schema.systemFontKeyOf };

  /** 内存缓存 `{ fonts, source, approximate, scannedAt }` —— 进程内共享，重启由落盘那份接上。 */
  let mem = null;
  /** 在途扫描：并发合并（多个窗口同时开设置页也只扫一次）。 */
  let inflight = null;

  const fresh = (v) => Boolean(v) && Array.isArray(v.fonts)
    && Date.now() - Number(v.scannedAt || 0) < SYSTEM_FONTS_TTL_MS;

  function readDisk() {
    try {
      const o = JSON.parse(readFileSync(cachePath(), 'utf8'));
      // 口径版本不符（含没有 `v` 的老缓存）⇒ 当没有缓存：TTL 有一周，靠"过期"来生效太慢。
      if (o && o.v === SYSTEM_FONTS_CACHE_VERSION && Array.isArray(o.fonts) && Number.isFinite(o.scannedAt)) return o;
    } catch { /* 没有 / 读不懂都当"没有" —— 缓存不是真源 */ }
    return null;
  }

  function writeDisk(v) {
    try {
      const file = cachePath();
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(Object.assign({ v: SYSTEM_FONTS_CACHE_VERSION }, v)));
      renameSync(tmp, file);
    } catch (err) {
      // 写不进缓存不影响这次应答；留个痕就够（下次仍能重扫）。
      try { log('system-fonts 缓存写入失败：' + (err && err.message ? err.message : err)); } catch { /* ignore */ }
    }
  }

  function scan() {
    if (!inflight) {
      inflight = collectSystemFonts(deps).then((got) => {
        mem = got;
        if (got.fonts.length) writeDisk(got); // 空清单不落盘：下次一问就重扫（与 star-count 同口径）
        return got;
      }).catch((err) => {
        const why = String((err && err.message) || err);
        try { log('system-fonts 扫描失败：' + why); } catch { /* ignore */ }
        return { fonts: [], source: 'none', approximate: false, scannedAt: 0, error: why };
      }).finally(() => { inflight = null; });
    }
    return inflight;
  }

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/system-fonts`,
    handler: async (req, res) => {
      // 薄别名：保留调用点写法（只有 200 + body），实现来自共享内核的 `c.http.sendJson`
      // （主包 lib/json-response.js 的唯一实现）。
      // 缓存由**本路由**管（TTL 在上游），别让浏览器再叠一层不可控的缓存 ⇒ no-store。
      const reply = (body) => http.sendJson(res, 200, body);
      if ((req.method || 'GET').toUpperCase() !== 'GET') { res.statusCode = 405; res.end(); return; }
      let force;
      try { force = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1'; } catch { force = false; }

      const cached = mem || readDisk();
      if (cached) mem = cached;
      if (!force && fresh(cached)) {
        reply({ ok: true, fonts: cached.fonts, approximate: cached.approximate === true, source: cached.source || '', scannedAt: cached.scannedAt, stale: false });
        return;
      }
      // 过期但手里有旧值：**先回旧值**（标 stale），同时后台重扫 —— 面板不因一次 10s 扫描卡住。
      if (cached && Array.isArray(cached.fonts) && cached.fonts.length) {
        scan().catch(() => { /* 后台重扫失败不影响这次应答 */ });
        reply({ ok: true, fonts: cached.fonts, approximate: cached.approximate === true, source: cached.source || '', scannedAt: cached.scannedAt, stale: true });
        return;
      }
      const got = await scan();
      reply({
        ok: got.fonts.length > 0,
        fonts: got.fonts,
        approximate: got.approximate === true,
        source: got.source || '',
        scannedAt: got.scannedAt || 0,
        stale: false,
        error: got.fonts.length ? undefined : (got.error || 'no-fonts'),
      });
    },
  }));
}

export {
  collectSystemFonts, normalizeFamilies, familyFromFileName, defaultRun,
  parseMacFonts, parseFcList, parseLineFamilies, parseWindowsFontRegistry, parseFontFileNames,
  authoritativeSources,
  SYSTEM_FONTS_TTL_MS, SYSTEM_FONTS_CACHE_VERSION, FONT_SCAN_TIMEOUT_MS,
};
