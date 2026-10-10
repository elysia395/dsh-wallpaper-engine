#!/usr/bin/env node
/**
 * verify-system-fonts.mjs — 「本机字体清单」的守卫（宿主枚举 + 客户端通道 + 全局字族那两条腿）。
 *
 * 为什么要有它：这一族有三处**只会静默坏**的地方 ——
 *   ① **解析**：三平台各一条来源（system_profiler JSON / PowerShell 行 / fc-list），形状一变就
 *      解析出空清单，而"没有本机字体可选"和"系统里真没有"在界面上长得一样；
 *   ② **降级**：权威来源拿不到时按文件名推，推出来的名字**必须**带 `approximate` 标记
 *      —— 丢了标记，用户会以为系统里真有一个叫「STHeiti Light」的字体族；
 *   ③ **全局字族**：它必须写 DSH 的基准令牌 `--dsw-font-family`（否则"全局"够不到角色表之外
 *      的文字），同时**只**把已被接管的角色（用户改过字号/字重）落到全局 —— 见 typography.js
 *      的 `useGlobal && (useSize || useWeight)`：挑一个全局字体不该改动任何角色的字号。
 *
 * 需要的外界：几乎无（纯函数 + mock webServer；`runFontCommand` 是注入的替身）。**唯一**一处真起
 * 进程的是 ② 里那条"多字节字符跨 chunk"的解码判据（它要的是真管道边界，替身给不了）—— 环境禁止建
 * 管道 stdio 时（受限沙箱）那一条记**环境跳过**并在末尾点名，不静默算过。
 * 扫描期的一切都走 `collectSystemFonts(deps)` 的显式入参（platform / run / home / now）。
 *
 * 不变量（本文件断言的对象）：
 *   · 权威来源成功 ⇒ `approximate: false` 且**不 spawn 第二次**（缓存生效）；`?refresh=1` 才重扫。
 *   · 权威来源失败 ⇒ 走文件名降级且**标 approximate**（不许把推测当事实）。
 *   · 任何失败都回 200 + `ok:false`（绝不 5xx），清单给空数组而不是编一个。
 *   · 清单里的每个名字都能变成合法 `sys:` 族键（值域由共享内核判：`systemFontKeyOf`）。
 *   · 非 GET = 405；注册必须推进 `disposers`（否则卸载/HMR 后路由还挂着）。
 *   · 客户端通道**只写自己那四个瞬态字段**，绝不碰字体值（那条真源住字体集）。
 *
 * Usage:  node test/verify-system-fonts.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { stripComments } from './tools/js-text.mjs';
import {
  registerSystemFontsRoutes, collectSystemFonts, normalizeFamilies, familyFromFileName, defaultRun,
  parseMacFonts, parseFcList, parseLineFamilies, parseWindowsFontRegistry, parseFontFileNames,
  authoritativeSources, SYSTEM_FONTS_TTL_MS, SYSTEM_FONTS_CACHE_VERSION, FONT_SCAN_TIMEOUT_MS,
} from '../lib/routes/system-fonts.js';
import { systemFontKeyOf, sanitizeFamilyValue } from '../lib/settings-schema.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ISO = join(root, '.test-cache', 'system-fonts');
const CACHE = join(ISO, 'system-fonts.json');
rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

let passed = 0;
let failed = 0;
/** 环境跳过（**不是通过**）：只有"这条判据在本进程所在的环境里根本跑不了"才计数，末尾必须点名。 */
let skipped = 0;
const check = (name, ok, detail) => {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
};
const section = (t) => console.log('\n' + t);

// ── 夹具：三平台各自的**真实形状**（macOS 那份照 system_profiler -json 的字段名）────────
const MAC_JSON = JSON.stringify({
  SPFontsDataType: [
    {
      _name: 'PingFang.ttc', path: '/System/Library/Fonts/PingFang.ttc', type: 'truetype',
      typefaces: [
        { _name: 'PingFangSC-Regular', family: '苹方-简' },
        { _name: 'PingFangTC-Regular', family: '苹方-繁' },
        // 私有族（`.` 开头）必须在收口时被丢掉 —— 它们是系统的内部字体，不是给用户选的。
        { _name: 'PingFangUI', family: '.PingFang UI' },
      ],
    },
    { _name: 'Helvetica.ttc', typefaces: [{ _name: 'Helvetica', family: 'Helvetica' }] },
    // 同一个族被两个文件重复报（真机上很常见）⇒ 收口去重。
    { _name: 'HelveticaNeue.ttc', typefaces: [{ _name: 'HelveticaNeue', family: 'helvetica' }] },
    // 形状坏掉的条目：不许让整份解析炸掉。
    null,
    { typefaces: 'not-an-array' },
  ],
});
const FC_LIST = 'Noto Sans CJK SC,Noto Sans CJK SC Regular\nDejaVu Sans\n';
const REG_QUERY = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  '    Arial (TrueType)    REG_SZ    arial.ttf',
  '    MS Gothic & MS UI Gothic & MS PGothic (TrueType)    REG_SZ    msgothic.ttc',
].join('\r\n');

// ── ① 纯解析（跨平台那一半唯一可机械判的东西）────────────────────────────────
section('① 纯解析：三个来源各一条正判据 + 负对照');
{
  const mac = parseMacFonts(MAC_JSON);
  check('macOS：从 typefaces[].family 取族名（**不是**条目自己的 _name —— 那是文件名）',
    mac.includes('苹方-简') && mac.includes('Helvetica') && !mac.includes('PingFang.ttc'),
    mac.slice(0, 4).join(' / '));

  const norm = normalizeFamilies(mac);
  check('收口：丢掉 `.` 开头的私有族', !norm.some((n) => n.startsWith('.')), norm.join(', '));
  check('收口：**大小写不敏感**去重（真机上同一个族会被多个文件重复报）',
    norm.filter((n) => n.toLowerCase() === 'helvetica').length === 1);
  check('收口：排序稳定（同一份输入两趟给同一结果）',
    JSON.stringify(normalizeFamilies(mac)) === JSON.stringify(norm));
  check('负对照：把私有族混回来会被判出', normalizeFamilies(['.Hidden', 'Shown']).includes('Shown')
    && !normalizeFamilies(['.Hidden', 'Shown']).includes('.Hidden'));

  check('Linux：fc-list 一行可给多个别名（逗号分隔，各自成族）',
    JSON.stringify(normalizeFamilies(parseFcList(FC_LIST))) === JSON.stringify(['DejaVu Sans', 'Noto Sans CJK SC', 'Noto Sans CJK SC Regular']),
    normalizeFamilies(parseFcList(FC_LIST)).join(' / '));
  check('负对照：不切逗号就会被判出',
    normalizeFamilies(parseFcList('A,B')).length === 2);

  check('Windows 注册表：取值名并摘掉结尾的 (TrueType)',
    JSON.stringify(parseWindowsFontRegistry(REG_QUERY)) === JSON.stringify(['Arial', 'MS Gothic & MS UI Gothic & MS PGothic']),
    parseWindowsFontRegistry(REG_QUERY).join(' / '));
  check('负对照：`HKEY…` 那一行不是值（否则清单里会多一个注册表路径）',
    !parseWindowsFontRegistry(REG_QUERY).some((n) => n.startsWith('HKEY')));

  check('PowerShell：一行一个族名（空行丢掉）',
    JSON.stringify(normalizeFamilies(parseLineFamilies('Arial\n\nSegoe UI\narial\n'))) === JSON.stringify(['Arial', 'Segoe UI']));

  check('降级：文件名 → 族名（去扩展名 + 摘掉尾部的字重/字形词）',
    familyFromFileName('PingFang-SC-Regular.ttf') === 'PingFang SC'
    && familyFromFileName('Arial_Bold_Italic.otf') === 'Arial'
    && familyFromFileName('STHeiti Light.ttc') === 'STHeiti Light',
    ['PingFang-SC-Regular.ttf', 'Arial_Bold_Italic.otf', 'STHeiti Light.ttc'].map(familyFromFileName).join(' / '));
  check('负对照：判据只摘**尾部**的字重词（不许把中间的词也吃掉）',
    familyFromFileName('Light-Bold.ttf') === 'Light' && familyFromFileName('Bold-Light.ttf') === 'Bold');
  check('降级路径结果里没有空串（空族名不许进清单）',
    parseFontFileNames(['.ttf', 'Arial.ttf']).every((n) => Boolean(n)));
}

// ── ② 收口：值域与共享内核同一份（名字必须能变成 `sys:` 族键）──────────────────
section('② 值域：清单里的每个名字都能变成合法 `sys:` 族键（可进 CSS）');
{
  const nasty = ['ok name', 'bad;name', 'bad{name}', 'quote"name', 'back\\slash', 'a'.repeat(200), '  '];
  const kept = normalizeFamilies(nasty);
  check('收口用**共享内核**的值域：破坏 CSS 的名字一个都不留',
    kept.every((n) => systemFontKeyOf(n) !== ''), kept.join(' / '));
  check('负对照：同一判据对"把 `bad;name` 当合法名"有牙', systemFontKeyOf('bad;name') === '');
  check('限长：超长名字被丢（不截断成另一个名字）',
    !kept.some((n) => n.length > 64), kept.map((n) => n.length).join(','));
  check('`sys:` 键经组件字体消毒后原样保留（本机字体要能存进字体集）',
    sanitizeFamilyValue('sys:苹方-简') === 'sys:苹方-简'
    && sanitizeFamilyValue('sys:bad;name') === '');
}

// ── ③ 扫描：权威 / 降级 / 缓存（`run` 是替身，本文件不 spawn）───────────────
section('③ 扫描与降级：来源、approximate 标记、缓存');
const okRun = (stdout) => async () => ({ ok: true, stdout, error: '' });
const failRun = async () => ({ ok: false, stdout: '', error: 'not-found' });
/** macOS 两条腿的替身：各有各的夹具（CoreText 那条吐**一行一个规范族名**）。 */
const CORETEXT_OUT = ['Helvetica', 'PingFang SC', 'Heiti SC', 'Songti SC', '.SF Numeric', 'Bad;Name'].join('\n') + '\n';
const macRun = async (cmd) => (cmd === 'osascript'
  ? { ok: true, stdout: CORETEXT_OUT, error: '' }
  : { ok: true, stdout: MAC_JSON, error: '' });
{
  const mac = await collectSystemFonts({ platform: 'darwin', run: macRun, home: '/nonexistent-home', now: () => 111 });
  check('macOS 两条权威来源都成功 ⇒ 来源逐条留痕 + approximate=false + 时钟来自注入的 now',
    mac.source === 'system_profiler+coretext' && mac.approximate === false && mac.scannedAt === 111,
    mac.source + ' / appr=' + mac.approximate);
  // **用户报的缺陷的回归判据**：只有 system_profiler 时清单里只有本地化名，用户找不到 `PingFang SC`
  // 这类"自己认识的"名字，看着就像"本机字体没扫全"。
  check('并集里**两种名字都在**：本地化「苹方-简」与规范 `PingFang SC` / `Heiti SC` 同时可选',
    mac.fonts.includes('苹方-简') && mac.fonts.includes('PingFang SC') && mac.fonts.includes('Heiti SC'));
  check('两条腿的名字都过同一条值域与私有族过滤（`.SF Numeric` / `Bad;Name` 都不进）',
    !mac.fonts.some((n) => n.startsWith('.') || n === 'Bad;Name'));
  check('负对照：只跑 system_profiler 那条腿 ⇒ 清单里没有 `PingFang SC`（判据不是恒真）',
    normalizeFamilies(parseMacFonts(MAC_JSON)).includes('PingFang SC') === false
    && mac.fonts.includes('PingFang SC'));

  // 只有一条腿活着也要能用（CoreText 快、system_profiler 慢；任一缺失都不该让整块功能失效）。
  const onlyCore = await collectSystemFonts({
    platform: 'darwin', home: '/nonexistent-home', now: () => 222,
    run: async (cmd) => (cmd === 'osascript' ? { ok: true, stdout: CORETEXT_OUT, error: '' }
      : { ok: false, stdout: '', error: 'not-found' }),
  });
  check('system_profiler 挂了 ⇒ 仍用 CoreText 那条腿（规范名可用、approximate=false）',
    onlyCore.source === 'coretext' && onlyCore.approximate === false && onlyCore.fonts.includes('PingFang SC'),
    onlyCore.source + ' / ' + onlyCore.fonts.join(', '));
  const onlySp = await collectSystemFonts({
    platform: 'darwin', home: '/nonexistent-home', now: () => 223,
    run: async (cmd) => (cmd === 'osascript' ? { ok: false, stdout: '', error: 'no-jxa' }
      : { ok: true, stdout: MAC_JSON, error: '' }),
  });
  check('osascript 被挡 ⇒ 仍用 system_profiler 那条腿（本地化名可用）',
    onlySp.source === 'system_profiler' && onlySp.fonts.includes('苹方-简'), onlySp.source);

  // 权威来源失败 ⇒ 文件名降级（家目录指向不存在的地方 ⇒ 清单为空，但**来源与标记**必须诚实）。
  const down = await collectSystemFonts({ platform: 'darwin', run: failRun, home: '/nonexistent-home', now: () => 224 });
  check('权威来源失败：走文件名降级且**标 approximate**（不把推测当事实）',
    down.source === 'file-names' && down.approximate === true,
    down.source + ' / appr=' + down.approximate);
  check('负对照：拿权威那次的标记去判降级那次 ⇒ 判据变红',
    down.approximate !== mac.approximate);

  const win = await collectSystemFonts({ platform: 'win32', run: async (cmd) => (cmd === 'powershell.exe'
    ? { ok: false, stdout: '', error: 'no-powershell' }
    : { ok: true, stdout: REG_QUERY, error: '' }), home: '/nonexistent-home', dirs: [], now: () => 333 });
  check('Windows：PowerShell 失败后退回注册表那条腿（同样标 approximate）',
    win.source === 'registry' && win.approximate === true && win.fonts.includes('Arial'),
    win.source + ' / ' + win.fonts.join(', '));

  // 降级那条腿**真的会读目录**：喂一个装着字体文件的临时目录，看它按文件名推出来的东西。
  const FIX_DIR = join(ISO, 'fonts');
  mkdirSync(FIX_DIR, { recursive: true });
  for (const f of ['PingFang-SC-Regular.ttf', 'Arial_Bold.otf', '.Hidden.ttf', 'notes.txt']) {
    writeFileSync(join(FIX_DIR, f), '');
  }
  const fallback = await collectSystemFonts({
    platform: 'plan9', run: failRun, home: '/nonexistent-home', dirs: [FIX_DIR], now: () => 555,
  });
  check('降级：扫目录按文件名推族名（去扩展名 + 摘字重词），非字体文件不进清单',
    JSON.stringify(fallback.fonts) === JSON.stringify(['Arial', 'PingFang SC'])
    && fallback.approximate === true && fallback.source === 'file-names',
    fallback.fonts.join(' / '));

  const none = await collectSystemFonts({
    platform: 'plan9', run: okRun(''), home: '/nonexistent-home', dirs: [], now: () => 444,
  });
  check('不认识的平台 + 空目录：不 spawn（没有权威命令）、清单为空、来源诚实标 file-names',
    none.fonts.length === 0 && none.source === 'file-names' && none.approximate === true);

  // 子进程输出的**多字节解码**：真起一个子进程，让它在两个 chunk 里切开一个 3 字节汉字。
  // 这条**只能真跑**（`run` 替身给的是字符串，压根没有 chunk 边界）—— 它守的是实测过的缺陷：
  // 逐块 `toString('utf8')` 把 `系统字体` 变成 `系统\uFFFD\uFFFD\uFFFD体`，而清单里"好的"和
  // "坏的"两条同时存在（用户在字体下拉里就看到一个认不出的族名）。
  const SPLIT = '系统字体';
  const childCode = 'const b=Buffer.from(process.argv[1],"utf8");'
    + 'process.stdout.write(b.slice(0,2));'
    + 'setTimeout(()=>{process.stdout.write(b.slice(2));},20);';
  const raw = await defaultRun(process.execPath, ['-e', childCode, SPLIT]);
  // ⚠️ 上面那句的 `stdio: ['ignore','pipe','ignore']` 要**真的建一根管道**：受限沙箱（本仓的
  //    判据进程就跑在里面，见工具说明里的 "programs cannot open named pipes"）会在 spawn 这一
  //    步直接 EPERM。那是**环境不让这条判据跑**，不是被测实现坏了 ⇒ 记一次显式环境跳过（照
  //    verify-media-bridge 那条通道的规矩：不静默算过、也不冤枉判红），并在末尾点名。
  //    CI runner 与普通开发机都建得出管道 ⇒ 那边照旧真跑这条断言。
  const pipeBlocked = raw.ok === false && /EPERM|EACCES/.test(String(raw.error || ''));
  if (pipeBlocked) {
    skipped++;
    console.log('  ○ ' + '真子进程：多字节字符跨 chunk —— **环境跳过**：本进程所在的环境禁止建管道 stdio'
      + '（' + raw.error + '），这条只能在允许子进程的环境里真跑（CI runner / 普通开发机）。'
      + '本次**没有断言覆盖**这一条。');
  } else {
    check('真子进程：多字节字符跨 chunk ⇒ 解码后逐字仍是原文（不插 U+FFFD）',
      raw.ok === true && raw.stdout === SPLIT && !raw.stdout.includes('\uFFFD'), JSON.stringify(raw.stdout));
  }
  // 负对照：同一串字节按**逐块解码再拼**（修法之前的写法）必须真的坏掉 —— 证明上面那条有牙。
  const naiveBytes = Buffer.from(SPLIT, 'utf8');
  const naiveDecoded = naiveBytes.slice(0, 2).toString('utf8') + naiveBytes.slice(2).toString('utf8');
  check('负对照：逐块 toString 再拼确实会产生 U+FFFD（上面那条判据不是恒真）',
    naiveDecoded.includes('\uFFFD') && naiveDecoded !== SPLIT, JSON.stringify(naiveDecoded));

  // macOS 两条权威来源**并行**发：慢的那条（system_profiler ~10s）决定总耗时，快的那条几乎免费。
  check('macOS 权威来源是两条、且 CoreText 那条走 osascript 的 JXA 枚举',
    authoritativeSources('darwin').length === 2
    && authoritativeSources('darwin').some((s) => s.cmd === 'osascript' && s.args.includes('-l'))
    && authoritativeSources('darwin').some((s) => s.source === 'system_profiler'));
  check('负对照：Windows / Linux 各只有一条权威来源（多跑一条只会白等）',
    authoritativeSources('win32').length === 1 && authoritativeSources('linux').length === 1);
}

// ── ④ 路由：状态码 / 缓存 / 重扫 / 清理句柄（mock webServer）──────────────────
section('④ 路由：200 信封、缓存不重复扫描、?refresh=1 重扫、非 GET 405、disposers 推进');
{
  /** 迷你 webServer：只收 `exact` 注册（这一族只用这一种）。 */
  const mockServer = () => {
    const routes = [];
    return {
      routes,
      register(spec) { routes.push(spec); return () => { spec.disposed = true; }; },
    };
  };
  const callRoute = async (route, method, url) => {
    const req = { method, url, headers: {} };
    const state = { statusCode: 0, headers: {}, body: '' };
    const res = {
      setHeader: (k, v) => { state.headers[k.toLowerCase()] = v; },
      end: (b) => { state.body = b === undefined ? '' : String(b); },
      get statusCode() { return state.statusCode; },
      set statusCode(v) { state.statusCode = v; },
    };
    await route.handler(req, res);
    let data = null;
    try { data = JSON.parse(state.body); } catch { data = null; }
    return { state, data };
  };

  let scans = 0;
  const server = mockServer();
  const disposers = [];
  const logs = [];
  rmSync(CACHE, { force: true });
  registerSystemFontsRoutes(server, {
    disposers, base: '/wallpaper-engine', cachePath: () => CACHE, log: (m) => logs.push(m),
    platform: 'darwin', home: '/nonexistent-home',
    // 权威两腿**并行** ⇒ 用 system_profiler 那条腿数“扫了几次”（CoreText 那条几乎免费）。
    runFontCommand: async (cmd) => {
      if (cmd === 'osascript') return { ok: true, stdout: CORETEXT_OUT, error: '' };
      scans++;
      return { ok: true, stdout: MAC_JSON, error: '' };
    },
  });

  check('注册推进了 disposers（卸载 / HMR 后不留挂着的处理器）', disposers.length === 1);
  check('注册用的是 exact 路由，路径 = <BASE>/system-fonts',
    server.routes.length === 1 && server.routes[0].kind === 'exact'
    && server.routes[0].path === '/wallpaper-engine/system-fonts',
    server.routes[0] && server.routes[0].path);
  const route = server.routes[0];

  const first = await callRoute(route, 'GET', '/wallpaper-engine/system-fonts');
  check('第一次 GET：200 + ok:true + 清单 + approximate:false',
    first.state.statusCode === 200 && first.data && first.data.ok === true
    && first.data.fonts.includes('苹方-简') && first.data.approximate === false,
    'status=' + first.state.statusCode + ' n=' + (first.data && first.data.fonts.length));
  check('第一次 GET：真的扫了一次', scans === 1, 'scans=' + scans);
  check('落盘缓存写了（下次开面板不必再等一次 10s 扫描）', existsSync(CACHE));

  const second = await callRoute(route, 'GET', '/wallpaper-engine/system-fonts');
  check('TTL 内的第二次 GET：直接回内存缓存，**不再 spawn**', scans === 1 && second.data.stale === false,
    'scans=' + scans);

  const forced = await callRoute(route, 'GET', '/wallpaper-engine/system-fonts?refresh=1');
  check('?refresh=1：强制重扫（面板上的「重新扫描」）', scans === 2 && forced.data.ok === true, 'scans=' + scans);

  // 口径版本：老缓存（没有 `v`，或版本不符）**一律当没有缓存** —— 否则升级插件后最长一周里拿到的
  // 还是老口径的结果（表现是"改了没生效"，而且看不出是缓存）。
  writeFileSync(CACHE, JSON.stringify({
    fonts: ['老口径族名'], source: 'system_profiler', approximate: false, scannedAt: Date.now(),
  }));
  let legacyScans = 0;
  const legacyServer = mockServer();
  registerSystemFontsRoutes(legacyServer, {
    disposers: [], base: '/wallpaper-engine', cachePath: () => CACHE, log: () => {},
    platform: 'darwin', home: '/nonexistent-home',
    runFontCommand: async (cmd) => {
      if (cmd === 'osascript') return { ok: true, stdout: CORETEXT_OUT, error: '' };
      legacyScans++;
      return { ok: true, stdout: MAC_JSON, error: '' };
    },
  });
  const relisted = await callRoute(legacyServer.routes[0], 'GET', '/wallpaper-engine/system-fonts');
  check('没有口径版本的老缓存**不被采用**（立刻重扫，不必等一周 TTL）',
    legacyScans === 1 && !relisted.data.fonts.includes('老口径族名') && relisted.data.stale === false,
    'scans=' + legacyScans + ' / ' + JSON.stringify(relisted.data.fonts.slice(0, 2)));
  check('写出来的缓存带当前口径版本（下次读它才作数）',
    JSON.parse(readFileSync(CACHE, 'utf8')).v === SYSTEM_FONTS_CACHE_VERSION);

  // 过期缓存：先回旧值（标 stale），后台重扫。⚠️ 夹具必须带**当前口径版本**，否则会被上面那条规则
  // 当成"没有缓存"（那样这一节测的就不是"过期先回旧值"了）。
  writeFileSync(CACHE, JSON.stringify({
    v: SYSTEM_FONTS_CACHE_VERSION, fonts: ['旧值族名'], source: 'system_profiler', approximate: false,
    scannedAt: Date.now() - SYSTEM_FONTS_TTL_MS - 1000,
  }));
  scans = 0;
  const fresh = mockServer();
  const freshDisposers = [];
  registerSystemFontsRoutes(fresh, {
    disposers: freshDisposers, base: '/wallpaper-engine', cachePath: () => CACHE, log: () => {},
    platform: 'darwin', home: '/nonexistent-home',
    // 权威两腿**并行** ⇒ 用 system_profiler 那条腿数“扫了几次”（CoreText 那条几乎免费）。
    runFontCommand: async (cmd) => {
      if (cmd === 'osascript') return { ok: true, stdout: CORETEXT_OUT, error: '' };
      scans++;
      return { ok: true, stdout: MAC_JSON, error: '' };
    },
  });
  const stale = await callRoute(fresh.routes[0], 'GET', '/wallpaper-engine/system-fonts');
  check('过期缓存：**先回旧值**并标 stale（不因一次扫描卡住面板）',
    stale.data.stale === true && stale.data.fonts.join() === '旧值族名',
    JSON.stringify(stale.data.fonts));
  await new Promise((r) => setTimeout(r, 50));
  check('过期缓存：旧值回了之后**后台**重扫一次', scans === 1, 'scans=' + scans);

  const notGet = await callRoute(route, 'POST', '/wallpaper-engine/system-fonts');
  check('非 GET：405（这一族只有只读一条腿）', notGet.state.statusCode === 405);

  // 权威来源与文件名降级都拿不到 ⇒ 200 + ok:false（绝不是 5xx），清单空。
  const deadServer = mockServer();
  registerSystemFontsRoutes(deadServer, {
    disposers: [], base: '/wallpaper-engine', cachePath: () => join(ISO, 'dead.json'), log: () => {},
    platform: 'darwin', home: '/nonexistent-home', fontDirs: [], runFontCommand: failRun,
  });
  const dead = await callRoute(deadServer.routes[0], 'GET', '/wallpaper-engine/system-fonts');
  check('一个字体都读不到：仍回 200 + ok:false + 原因（失败不甩成 5xx）',
    dead.state.statusCode === 200 && dead.data.ok === false && Array.isArray(dead.data.fonts)
    && dead.data.fonts.length === 0 && Boolean(dead.data.error),
    'status=' + dead.state.statusCode + ' err=' + (dead.data && dead.data.error));
  check('空清单**不落盘**（下次一问就重扫，不会被一份空缓存钉住）',
    !existsSync(join(ISO, 'dead.json')));

  check('扫描超时是个有界的数（挂住的 system_profiler 不许拖住插件）',
    Number.isFinite(FONT_SCAN_TIMEOUT_MS) && FONT_SCAN_TIMEOUT_MS > 0 && FONT_SCAN_TIMEOUT_MS <= 60000,
    FONT_SCAN_TIMEOUT_MS + 'ms');
}

// ── ⑤ 客户端通道（静态契约）──────────────────────────────────────────────────
section('⑤ 客户端通道：登记进产物 / 浏览器安全 / 只碰自己那几个瞬态字段');
{
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const build = read('scripts/build-client.mjs');
  const mod = read('src/system-fonts.js');
  const modCode = stripComments(mod);

  check('src/system-fonts.js 已登记进 INLINE_MODULES（漏登记=静默不生效）',
    /file:\s*'src\/system-fonts\.js'/.test(build) && /markers:\s*\[[^\]]*readCachedSystemFonts/.test(build));
  check('浏览器安全：无 import / require( / process.* / __dirname',
    !/(^|\n)\s*import\s/.test(modCode) && !/\brequire\(/.test(modCode)
    && !/\bprocess\./.test(modCode) && !/__dirname|__filename/.test(modCode));
  check('请求走 api-client（唯一出口），不裸 fetch',
    /apiFetch\(/.test(modCode) && !/(?<![\w.])fetch\(/.test(modCode));
  check('负对照：裸 fetch( 会被同一条判据抓到', /(?<![\w.])fetch\(/.test('const r = fetch(url);'));

  // 只写自己那几个瞬态字段：**不许**碰任何字体值（那条真源住字体集）。
  /** 判据：一段代码里 `selection.<字段> = …` 直写的字段集（正负对照共用它）。 */
  const writtenFields = (code) => [...code.matchAll(/(?<![\w.$])selection\.([\w$]+)\s*=(?!=)/g)].map((m) => m[1]);
  const allowed = ['systemFonts', 'systemFontsAt', 'systemFontsApproximate', 'systemFontsLoading', 'systemFontsError'];
  const written = writtenFields(modCode);
  check('只写清单自己的瞬态字段，一个字体值都不碰',
    written.length > 0 && written.every((k) => allowed.includes(k)), written.join(', '));
  check('负对照：同一判据对"顺手写字体值"有牙',
    writtenFields('selection.globalFamily = "x";').every((k) => !allowed.includes(k))
    && writtenFields('selection.systemFonts = [];').every((k) => allowed.includes(k)));

  const client = stripComments(read('src/client.js'));
  const qp = stripComments(read('src/quick-panel.js'));
  check('清单初始化**先吃本地缓存**（否则已选中的本机字体首帧显示成"跟随"）',
    /systemFonts:\s*readCachedSystemFonts\(\)/.test(client));
  // ⚠️ 触发点 2026-10-09 随字体节迁到侧栏（设置页外观已没有字体 UI，在那边拉是白付
  //    宿主扫描）：新口径 = 侧栏外观页 + 字体节**展开** + 字体自定义打开。
  check('清单只在「侧栏外观页 + 字体节展开 + 字体自定义打开」时才去要（宿主那次扫描很贵）',
    /qpTab === "appearance" && fontOpen && sel\.fontCustom/.test(qp)
    && /if \(v\) ensureSystemFonts\(false\)/.test(client));
  check('面板拿到了全局字族与重新扫描两个入口（ctx 少一个就是"点了没反应"）',
    /onGlobalFamily, onRefreshSystemFonts/.test(read('src/panel-tabs.js')));
  const tabs = stripComments(read('src/panel-tabs.js'));
  check('下拉的选项与本机字体状态行都走同一条"本浏览器能否匹配"的筛',
    /filterUsableSystemFonts\(sel\.systemFonts\)\.fonts/.test(tabs)
    && /filterUsableSystemFonts\(sel\.systemFonts\)/.test(tabs));
  check('四处下拉都把**当前值**传进去（不在清单里也要摆出来，否则 select 显示成第一项=界面撒谎）',
    (tabs.match(/familyOptions\(sel, \{[^}]*current:/g) || []).length === 4,
    String((tabs.match(/familyOptions\(sel, \{[^}]*current:/g) || []).length));
}

// ── ⑥ 本浏览器能否匹配那道筛（合成"浏览器"判它：同一判据三种输入）────────────
section('⑥ 过滤"本浏览器取不到的族名"：合成浏览器判它（量不到时必须原样放行）');
{
  const mod = await import(new URL('../src/system-fonts.js', import.meta.url).href);
  const { filterUsableSystemFonts } = mod;
  /**
   * 合成一个"浏览器"：给每个族名一个宽度（`null` = 这个族名匹配不上 ⇒ 走后面的兜底字体，
   * 于是配 monospace 与配 serif 的宽度不同）。**测的是同一段判据**，只是 DOM 是假的。
   * @param widths `{ [族名]: {mono, serif} }`；缺项 = 量不到（0）
   */
  const fakeBrowser = (widths) => {
    const el = (css) => ({
      style: { fontFamily: '', fontSize: '', position: '', left: '', top: '', visibility: '', whiteSpace: '' },
      textContent: '', children: [],
      appendChild(c) { this.children.push(c); return c; },
      remove() {},
      getBoundingClientRect() { return { width: widths[css] === undefined ? 0 : widths[css] }; },
    });
    const body = el('');
    return {
      createElement: () => {
        const node = el('');
        // `style.fontFamily` 被赋值后记下来，`getBoundingClientRect` 按它取宽度。
        Object.defineProperty(node.style, 'fontFamily', {
          set(v) { this._fam = v; }, get() { return this._fam || ''; },
        });
        node.getBoundingClientRect = function () {
          const m = /^"([^"]*)", (monospace|serif)$/.exec(this.style.fontFamily || '');
          if (!m) return { width: 0 };
          const spec = widths[m[1]];
          if (!spec) return { width: 0 };
          return { width: m[2] === 'monospace' ? spec.mono : spec.serif };
        };
        return node;
      },
      body,
      documentElement: body,
    };
  };
  const withDocument = (doc, fn) => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
    const prev = globalThis.document;
    globalThis.document = doc;
    try { return fn(); } finally { if (had) globalThis.document = prev; else delete globalThis.document; }
  };

  // ① 真浏览器形状：匹配得上的名字两种兜底宽度相同；匹配不上的不同 ⇒ 只留前者。
  const doc = fakeBrowser({
    'PingFang SC': { mono: 300, serif: 300 },      // 匹配得上
    'Apple Color Emoji': { mono: 300, serif: 291 }, // 匹配不上（系统保留字体）
    '苹方-繁': { mono: 300, serif: 288 },           // 匹配不上（同一字体的另一种写法）
    'MesloLGL Nerd Font Mono': { mono: 300, serif: 300 },
  });
  const got = withDocument(doc, () => filterUsableSystemFonts(
    ['PingFang SC', 'Apple Color Emoji', '苹方-繁', 'MesloLGL Nerd Font Mono']));
  check('只留下**本浏览器能匹配**的名字，并如实报出略过几个',
    JSON.stringify(got.fonts) === JSON.stringify(['PingFang SC', 'MesloLGL Nerd Font Mono'])
    && got.skipped === 2 && got.measured === true,
    JSON.stringify(got));
  check('按清单**身份**记忆：同一份清单第二次不再重测（面板每帧重渲不会反复量布局）',
    withDocument(doc, () => {
      const same = filterUsableSystemFonts(got.fonts.length ? ['PingFang SC', 'Apple Color Emoji', '苹方-繁', 'MesloLGL Nerd Font Mono'] : []);
      return same === got || JSON.stringify(same.fonts) === JSON.stringify(got.fonts);
    }));

  // ② 量不到（替身 DOM / 无布局）⇒ **原样放行**：绝不因为"测不出来"把用户的字体名丢掉。
  const blind = fakeBrowser({});
  const blindGot = withDocument(blind, () => filterUsableSystemFonts(['A', 'B']));
  check('量不到（宽度恒为 0）⇒ 原样放行、skipped=0、measured=false',
    JSON.stringify(blindGot.fonts) === JSON.stringify(['A', 'B'])
    && blindGot.skipped === 0 && blindGot.measured === false, JSON.stringify(blindGot));
  // ③ 根本没有 document（守卫/SSR 形态）⇒ 同样原样放行，且不抛。
  const noDoc = (() => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
    const prev = globalThis.document;
    delete globalThis.document;
    try { return filterUsableSystemFonts(['A']); } finally { if (had) globalThis.document = prev; }
  })();
  check('没有 document ⇒ 原样放行且不抛（守卫的替身环境就是这种）',
    JSON.stringify(noDoc.fonts) === JSON.stringify(['A']) && noDoc.measured === false);
  check('空清单 / 非数组输入不抛', filterUsableSystemFonts(undefined).fonts.length === 0);
}

// ── ⑦ 全局字族那两条腿（纯计算：typography.js）───────────────────────────────
section('⑦ 全局字族：写基准令牌 + 只落在已被接管的角色上（不因换字体改动字号）');
{
  const typo = await import(new URL('../src/font/typography.js', import.meta.url).href);
  const stacks = { 全局: '"PingFang SC", var(--x, system-ui)', SimSun: '"SimSun", serif' };
  const resolve = (k) => stacks[k] || '';
  const sizes = { 'markdown-h1': 24 };
  const weights = {};
  const families = { 'markdown-base': 'SimSun' };

  const withGlobal = typo.buildTypePayload(sizes, () => true, weights, families, resolve, '全局');
  check('全局字族写进 DSH 的**基准令牌** --dsw-font-family（否则够不到角色表之外）',
    withGlobal.payload['--dsw-font-family']
    && withGlobal.payload['--dsw-font-family'].light === stacks['全局'],
    JSON.stringify(withGlobal.payload['--dsw-font-family']));
  check('被接管的角色（改过字号）落到全局', withGlobal.roles.includes('markdown-h1')
    && withGlobal.payload['--dsw-font-markdown-h1-font-family'].light === stacks['全局']);
  check('角色自己设了字族 ⇒ 用角色的（全局只是默认）',
    withGlobal.payload['--dsw-font-markdown-base-font-family'].light === stacks.SimSun);
  check('**没被接管**的角色一个都不进载荷（挑全局字体不该顺手改它的字号/行高）',
    !withGlobal.roles.includes('markdown-small') && !withGlobal.roles.includes('markdown-h2')
    && withGlobal.roles.join() === 'markdown-h1,markdown-base',
    withGlobal.roles.join(', '));

  const noGlobal = typo.buildTypePayload(sizes, () => true, weights, families, resolve, '');
  check('不设全局 ⇒ 载荷里没有基准令牌（关掉全局就干净回官方）',
    !('--dsw-font-family' in noGlobal.payload));
  const inheritGlobal = typo.buildTypePayload(sizes, () => true, weights, families, resolve, 'inherit');
  check('全局选「默认」(inherit) ⇒ 视作不设全局（它不是一条字族）',
    !('--dsw-font-family' in inheritGlobal.payload));
  check('负对照：把 `useGlobal && (useSize || useWeight)` 放宽成"所有角色"会被判出',
    typo.buildTypePayload({}, () => true, {}, {}, resolve, '全局').roles.length === 0);
}

// ── ⑧ 真渲染：跑**构建产物**，把两个下拉真画出来（挂载台形状与 verify-picker-props 同一套）──
// 为什么必须真渲染：上面那些静态判据只能证明"字段传进去了"，证明不了「本机字体真的出现在选项里、
// 选中的键真的能反查回来、改一下真的落进字体集」—— 那三件恰恰是这一族对用户可见的全部行为。
section('⑧ 真渲染（构建产物）：内置族键 + 本机字体同列、值能反查、改动落进字体集');
{
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
  /** 假 React 必须像 React 一样校验子节点（对象不能作为子节点）—— 见 DEV-GUIDE §4.7 约定 6。 */
  const badChild = (c) => {
    if (c === null || c === undefined || typeof c === 'boolean' || typeof c === 'string' || typeof c === 'number') return null;
    if (Array.isArray(c)) { for (const x of c) { const b = badChild(x); if (b) return b; } return null; }
    if (typeof c === 'object' && c.type) return null;
    return c;
  };
  const React = {
    Fragment: 'Fragment',
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    createElement: (type, props, ...children) => {
      for (const c of children) {
        const bad = badChild(c);
        if (bad) throw new Error('React #31：无效子节点 ' + JSON.stringify(Object.keys(bad)).slice(0, 60));
      }
      return typeof type === 'function' ? type(props || {}) : { type, props: props || null, children };
    },
  };

  const byId = {};
  const timers = [];
  const makeEl = (tag) => ({
    tagName: String(tag).toUpperCase(), children: [], dataset: {}, attributes: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: '', textContent: '', _parent: null,
    appendChild(c) { this.children.push(c); c._parent = this; if (c.id) byId[c.id] = c; return c; },
    remove() { if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); } if (this.id) delete byId[this.id]; },
    setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, querySelector() { return null; },
  });
  const bodyEl = makeEl('body');
  const document = {
    createElement: (t) => makeEl(t),
    getElementById: (id) => byId[id] || null,
    querySelector: () => null, querySelectorAll: () => [],
    head: makeEl('head'), body: bodyEl,
    addEventListener() {}, removeEventListener() {},
  };

  // 本地缓存那份**故意与宿主不同**：宿主回话后必须换成宿主那份（缓存只是缓存）。
  const cache = {
    'dsh-wallpaper-engine:picker-tab': 'appearance',
    'we-system-fonts': JSON.stringify({ fonts: ['Cached Only'], approximate: false }),
  };
  const localStorage = {
    getItem: (k) => (k in cache ? cache[k] : null),
    setItem: (k, v) => { cache[k] = String(v); },
    removeItem: (k) => { delete cache[k]; },
  };

  const HOST_FONTS = ['PingFang SC', '苹方-简', 'Bad;Name', '.Private'];
  const fontsetPuts = [];
  const FONTSET_VALUES = {
    themeColors: {}, themeDarkSeparate: false, themeSize: {}, themeWeight: {}, themeFamily: {},
    globalFamily: 'sys:PingFang SC',
    componentFonts: { terminal: { family: 'sys:苹方-简' } },
  };
  const fetch = (url, init) => {
    const u = String(url);
    const method = String((init && init.method) || 'GET').toUpperCase();
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (u.includes('/wallpaper-engine/system-fonts')) {
      return json({ ok: true, fonts: HOST_FONTS, approximate: false, source: 'system_profiler', scannedAt: 1 });
    }
    if (u.includes('/wallpaper-engine/settings')) return json({ ok: true, settings: { blur: 13 } });
    if (u.includes('/fontsets')) {
      if (method === 'PUT') { fontsetPuts.push(JSON.parse(String(init.body))); return json({ ok: true }); }
      if (/\/fontsets\/[^/?]+$/.test(u)) return json({ values: FONTSET_VALUES });
      return json({ fontsets: [{ id: 'compact', name: '紧凑' }], active: 'compact' });
    }
    if (u.includes('/wallpaper-engine/inventory')) {
      return json({ installDir: 'D:/we', total: 0, portableCount: 0, playlists: [], wallpapers: [] });
    }
    return json({ ok: true });
  };

  const cap = { handoff: null };
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
      setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false, fired: false }; timers.push(t); return t; },
      clearTimeout: (t) => { if (t) t.cleared = true; },
      addEventListener() {}, removeEventListener() {},
      location: { search: '' },
    },
    document, localStorage, fetch, React,
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false, fired: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    setInterval: (fn, ms) => { const t = { fn, ms, cleared: false, fired: false, interval: true }; timers.push(t); return t; },
    clearInterval: (t) => { if (t) t.cleared = true; },
    URL, JSON, Date, Math, String, Number, Object, Array, Boolean, Promise, Error, console,
  };
  vm.createContext(sandbox);
  new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);
  const exportsObj = cap.handoff.factory((spec) => {
    if (spec === 'react') return React;
    if (spec === 'react-dom') return { createPortal: (node) => node };
    throw new Error('unexpected require: ' + spec);
  });

  const renders = [];
  const slots = { inject: (key, cb) => cb(), register: (opts, render) => { renders.push({ opts, render }); } };
  // 侧栏官方档注册需要的两个可选服务桩（2026-10-09 字体节迁侧栏后，字体下拉的行为台
  // 从设置页渲染器改成侧栏 body 渲染器 —— 与 verify-client 同一套手法）。
  const sidebarRightTabsStub = { register: () => () => {} };
  const sidebarRightStub = { openTab: () => {} };
  const ctx = {
    slots,
    effect(fn) { fn(); return fn; },
    get: (name) => (name === 'sidebarRightTabs' ? sidebarRightTabsStub
      : name === 'sidebarRight' ? sidebarRightStub : null),
  };
  let applyThrew = null;
  try { exportsObj.apply(ctx); } catch (e) { applyThrew = (e && (e.stack || e.message)) || String(e); }
  check('apply(ctx) 不抛（夹具给全了 slots/effect/document/fetch）', applyThrew === null, applyThrew || '');
  await new Promise((r) => setTimeout(r, 150)); // 等 loadPersisted → loadFontSet → loadInventory → system-fonts

  const settings = renders.find((r) => r.opts && r.opts.name === 'settings.section');
  check('设置页渲染器已注册（跑的是真注册路径）', Boolean(settings));
  // 字体节的新家：官方侧栏 body（qp-tab=appearance + 字体节展开 的播种在调用点）。
  const sideBody = renders.find((r) => r.opts && r.opts.name === 'sidebar.right.pane.tab');
  check('侧栏 body 渲染器已注册（字体节迁移目的地 —— installSidebarRight 走了 ctx.get 桩）',
    Boolean(sideBody));
  const renderSide = () => {
    cache['dsh-wallpaper-engine:qp-tab'] = 'appearance';
    cache['dsh-wallpaper-engine:qp-font-open'] = '1';
    return sideBody.render();
  };

  /** 枚举一棵渲染树里的全部节点（数组 / 元素两种形态）。 */
  const allNodes = (n, out = []) => {
    if (!n || typeof n !== 'object') return out;
    if (Array.isArray(n)) { for (const x of n) allNodes(x, out); return out; }
    if (n.type) { out.push(n); allNodes(n.children, out); }
    return out;
  };
  const rowsOf = (tree) => allNodes(tree).filter((n) => n.type === 'div'
    && String((n.props || {}).className || '').split(/\s+/).includes('we-picker__ctl'));
  const rowLabelled = (row, label) => allNodes(row).some((n) => n.type === 'span'
    && String((n.props || {}).className || '').includes('we-picker__ctl-label')
    && (Array.isArray(n.children) ? n.children[0] : '') === label);

  // **走真实触发路径**：字体自定义默认关 ⇒ 面板上没有那两个下拉；打开总开关时顺手去要一次
  // 本机字体清单（`onToggleFontCustom` 里那一句）——这一条本身就是被测行为之一。
  // ⚠️ 2026-10-09 字体节迁侧栏 ⇒ 行为台从设置页渲染器改为侧栏 body（renderSide，
  //    播种 qp-tab=appearance + qp-font-open=1 ⇒ 外观页且字体节展开）。
  const before = renderSide();
  check('总开关关着时**没有**这两行（那一整块是 `fontCustom` 的门控）',
    !allNodes(before).some((n) => n.type === 'span'
      && String((n.props || {}).className || '').includes('we-picker__ctl-label')
      && n.children && n.children[0] === '默认字体'));
  const quickRow = rowsOf(before).find((r) => rowLabelled(r, '字体自定义'));
  const quickSwitch = quickRow ? allNodes(quickRow).find((n) => n.type === 'input') : null;
  check('面板里找得到「字体自定义」总开关（侧栏外观页 · 字体节展开）', Boolean(quickSwitch));
  quickSwitch && quickSwitch.props.onChange({ target: { checked: true } });
  await new Promise((r) => setTimeout(r, 80)); // 开关 ⇒ ensureSystemFonts ⇒ 宿主回话

  const tree = renderSide();
  const nodes = allNodes(tree);
  const optionsOf = (sel) => allNodes(sel.children).filter((n) => n.type === 'option');
  const optgroupsOf = (sel) => allNodes(sel.children).filter((n) => n.type === 'optgroup');
  /**
   * 按行**标签**找那一行里的 `<select>`。
   * ⚠️ 必须认标签元素本身（`span.we-picker__ctl-label` 的第一个子节点），不能拿整行
   * `JSON.stringify` 做子串匹配 —— 「字体自定义」那行的 tooltip 里就有"……默认字体外观"，
   * 子串匹配会先命中它（那一行没有 select），于是判据变成"面板里没有这个下拉"的假红。
   */
  const ctlSelectFor = (label) => {
    for (const r of rowsOf(tree)) {
      if (!rowLabelled(r, label)) continue;
      const sel = allNodes(r).find((n) => n.type === 'select');
      if (sel) return sel;
    }
    return null;
  };
  const valuesOf = (sel) => optionsOf(sel).map((o) => String((o.props || {}).value));

  const globalSel = ctlSelectFor('默认字体');
  const termSel = ctlSelectFor('终端字体');
  check('「默认字体」那一行画出来了（面板里真有这个下拉）', Boolean(globalSel));
  check('「终端字体」那一行画出来了', Boolean(termSel));

  if (globalSel && termSel) {
    const sysGroup = optgroupsOf(globalSel).find((g) => JSON.stringify(g).includes('本机字体'));
    check('两个下拉里都有「本机字体」分组', Boolean(sysGroup) && optgroupsOf(termSel).length > 0);
    const sysOptions = sysGroup
      ? allNodes(sysGroup.children).filter((n) => n.type === 'option').map((o) => (o.props || {}).value)
      : null;
    check('分组里的候选 = 宿主那份**过了值域过滤**的名单（`Bad;Name` / `.Private` 不进）',
      JSON.stringify(sysOptions) === JSON.stringify(['sys:PingFang SC', 'sys:苹方-简']),
      JSON.stringify(sysOptions));
    check('宿主回话后**取代**了本地缓存那份（缓存只是首帧起点）',
      !valuesOf(globalSel).includes('sys:Cached Only') && !JSON.stringify(tree).includes('Cached Only'));
    check('选中的值按**族键**反查回来（全局 = 字体集里那个 sys: 键）',
      (globalSel.props || {}).value === 'sys:PingFang SC', String((globalSel.props || {}).value));
    check('终端那一行反查的是 `componentFonts.terminal.family`（同一个键、两处入口）',
      (termSel.props || {}).value === 'sys:苹方-简', String((termSel.props || {}).value));
    check('全局那一行**不给**「默认」(inherit) —— 它在那里等于"不覆盖"，与「跟随 DSH」重复',
      !valuesOf(globalSel).includes('inherit') && valuesOf(globalSel).includes('')
      && valuesOf(termSel).includes('inherit'));

    // 负对照：把宿主名单换成一个过不了值域的名字 ⇒ 分组消失（判据对"清单内容"有牙）。
    check('负对照：把 `sys:` 名字值的过滤关掉，`Bad;Name` 就会混进选项里',
      systemFontKeyOf('Bad;Name') === '' && systemFontKeyOf('PingFang SC') !== '');

    // 改一下全局字体 ⇒ 真的落进字体集（PUT /fontsets/<活动 id> 的 body 带新键）。
    globalSel.props.onChange({ target: { value: 'sys:苹方-简' } });
    for (const t of timers.filter((x) => !x.cleared && !x.fired && x.ms === 200)) { t.fired = true; t.fn(); }
    await new Promise((r) => setTimeout(r, 40));
    const putGlobal = fontsetPuts.map((p) => p.values && p.values.globalFamily).filter(Boolean);
    check('改「默认字体」⇒ 落进字体集正文的那个键（PUT 体里带 globalFamily）',
      putGlobal.includes('sys:苹方-简'), putGlobal.join(' / ') || '（没有 PUT）');

    termSel.props.onChange({ target: { value: 'sys:PingFang SC' } });
    for (const t of timers.filter((x) => !x.cleared && !x.fired && x.ms === 200)) { t.fired = true; t.fn(); }
    await new Promise((r) => setTimeout(r, 40));
    const putTerm = fontsetPuts.map((p) => p.values && p.values.componentFonts
      && p.values.componentFonts.terminal && p.values.componentFonts.terminal.family).filter(Boolean);
    check('改「终端字体」⇒ 落进 componentFonts.terminal.family（与高级表同一项）',
      putTerm.includes('sys:PingFang SC'), putTerm.join(' / ') || '（没有 PUT）');

    // 「重新扫描」那颗按钮真的在那一行里（刚装完字体的出路）。
    check('本机字体那一行有「重新扫描」按钮',
      nodes.some((n) => n.type === 'button' && JSON.stringify(n.children).includes('重新扫描')));

    // **侧栏 / SSH 终端面板（dsh-ssh，xterm）**：它只认自己给皮肤留的钩子
    // `--dsh-ssh-terminal-font`（读 `getComputedStyle(document.body)`），普通 CSS 规则改不动它
    // （xterm 的字体只从构造选项来）。⚠️ **投递方式是 body 上的内联属性**，不是样式表规则：
    // 那个插件**只在构造终端的那一刻**读它，之后只有它自己的设置变化才重读 —— 我们的样式表要等
    // 宿主异步回话才写得出来，终端往往在那之前就建好了（现场症状："重启了还是口"）。
    const hookVar = () => String((bodyEl.style._props || {})['--dsh-ssh-terminal-font'] || '');
    const hookValue = hookVar();
    check('把「终端字体」交给 dsh-ssh 的官方皮肤钩子（侧栏那个"控制台"才吃得到）',
      hookValue !== '', hookValue || '（body 上没有这个变量）');
    check('钩子值是**摊平**过的具体字体列表：不含 `var(`（xterm 把值当 fontFamily 字符串，'
      + '`var()` 在里面不是函数 ⇒ 整条列表失效）',
      hookValue !== '' && !hookValue.includes('var('), hookValue);
    // 内置族键也必须带"退回 DSH 原链"的尾（**现场教训**：内置那几条栈是给 Windows 写的，
    // `KaiTi` / `STXingkai` 在 macOS 上都不存在 —— 不带尾时 `--dsw-font-family: KaiTi, serif`
    // 会把整个界面压到 serif，比"没生效"更糟）。
    termSel.props.onChange({ target: { value: 'KaiTi' } });
    quickSwitch.props.onChange({ target: { checked: false } });
    quickSwitch.props.onChange({ target: { checked: true } });   // 再开一次 ⇒ 跑一遍 applyEffects
    const builtinHook = hookVar();
    /** 判据：这条字体栈带没带"退回 DSH 原链"的尾（正负对照共用它 —— 只看后缀会被 `sans-serif;` 骗到）。 */
    const hasSnapshotTail = (line) => line.includes('system-ui') && line.includes('PingFang SC');
    check('内置族键那条也以"DSH 原字族快照"收尾（macOS 上 KaiTi 不存在 ⇒ 不能只剩 serif）',
      builtinHook.includes('KaiTi') && hasSnapshotTail(builtinHook), builtinHook);
    check('负对照：同一判据对"只有 KaiTi 自己那条栈"有牙',
      hasSnapshotTail('KaiTi, serif') === false);
    check('内置族键那条在写进 dsh-ssh 钩子时同样被摊平（没有 var(）',
      builtinHook !== '' && !builtinHook.includes('var('), builtinHook);
    // 清掉终端字体（关掉总开关）⇒ 那条规则必须消失，让位给 dsh-ssh 自己的取值链。
    quickSwitch.props.onChange({ target: { checked: false } });
    check('关掉字体自定义 ⇒ 那个变量随之撤掉（让位给 dsh-ssh 自己的取值链）',
      hookVar() === '', hookVar() || '（已撤掉）');
    quickSwitch.props.onChange({ target: { checked: true } });
  }
}

console.log(failed === 0
  ? `\nSYSTEM-FONT CHECKS PASSED (${passed})` + (skipped ? ` —— ⚠️ ${skipped} 条环境跳过（不是通过，见上面的 ○ 行）` : '')
  : `\nSYSTEM-FONT CHECKS FAILED — ${failed} failed, ${passed} passed`
    + (skipped ? `, ${skipped} skipped` : ''));
process.exit(failed === 0 ? 0 : 1);
