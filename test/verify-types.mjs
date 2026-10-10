#!/usr/bin/env node
/**
 * verify-types.mjs —— 发布的 TypeScript 面必须描述真实运行时。
 *
 * `lib/types/index.d.ts` 与 `lib/types/client.d.ts` 是 package.json `types` /
 * `exports.types` 指向的**发布面**：消费者读到的就是它们。它们与实现漂移时，
 * 仓库里没有任何编译步骤会红（本仓库刻意没有 tsc / tsconfig / devDependencies），
 * 所以漂移只能由本守卫用**文本对账**钉住。
 *
 * 为什么必须钉「字段清单」而不是只钉「字段名出现在代码里」：
 *   - 描述符字段是**逐个手写**的，drift 的方向是「代码加了字段、.d.ts 没跟上」
 *     （本守卫建立时的实测：inventory 返回 18 个壁纸字段 / 8 个顶层字段，而当时的
 *     .d.ts 只声明了 8 / 5；现已补齐 —— P2/P3 断言「声明集 == 钉住集」）。所以这里显式
 *     钉一份**必需字段清单**，每条注明它为什么必需 ——
 *     清单本身才是被守住的东西，而不是"某个名字在文件里出现过"。
 *   - 反方向同样要守：.d.ts 里凭空多出的字段（已经没有生产者）必须报错。
 *
 * 断言（每条都配可失败的负对照，见各节 P4/P5/P7/P9）：
 *   P1 WallpaperDescriptor：声明的每个字段都能在 inventory 构造代码里找到赋值。
 *   P2 WallpaperDescriptor：钉住的必需字段全部已声明，且声明集 == 钉住集。
 *   P3 Inventory：同上两条。
 *   P4 负对照：同一判据喂进"漏掉一个必需字段的合成 .d.ts"必须报缺。
 *   P5 负对照：同一判据喂进"字段被改名的合成代码"必须报缺。
 *   P6 client 半：`src/client.js` 的每个 `exports.X =` 都有对应的值导出声明。
 *   P7 负对照：同一判据喂进"删掉 apply 声明的合成 client.d.ts"必须报缺。
 *   P8 散文不变量：index.d.ts 明说 webServer 是硬依赖、不再称它 optional、
 *      指向生成的 docs/ROUTE-INDEX.md、不写死一个会漂移的路由条数。
 *   P9 负对照：同一散文判据对改坏的文本必须为假。
 *
 * 用法: node test/verify-types.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

// ── 文本解析工具（纯文本，不加载 lib/index.js：无需缓存/配置隔离）──────────────

/** `export interface <name> { … }` 的**顶层成员名**（按缩进深度 1 逐行收集）。 */
function interfaceFields(src, name) {
  const m = new RegExp('^[ \\t]*export[ \\t]+interface[ \\t]+' + name + '\\b', 'm').exec(src);
  if (!m) return null;
  const lines = src.slice(m.index).split('\n');
  const fields = [];
  let depth = 0;
  let opened = false;
  for (const line of lines) {
    const code = line.replace(/\/\/.*$/, '');
    if (opened && depth === 1) {
      const f = /^[ \t]*([A-Za-z_$][\w$]*)[ \t]*\??[ \t]*:/.exec(code);
      if (f) fields.push(f[1]);
    }
    if (!opened) {
      if (!code.includes('{')) continue;
      opened = true;
    }
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth <= 0) break;
  }
  return opened ? fields : null;
}

/**
 * 函数体文本（含 {…}）。跳过字符串/模板字面量与注释，避免里面的括号干扰配对；
 * 配对失败返回 null —— 调用处会把它当"解析失败"判红，而不是静默放行。
 */
function functionBody(src, name) {
  const m = new RegExp('function[ \\t]+' + name + '[ \\t]*\\(').exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index + m[0].length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); if (nl < 0) return null; i = nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); if (end < 0) return null; i = end + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

/** 字段在文本里是否作为键（`name:`）或简写属性（`name,`）出现。 */
function codeDeclaresField(code, field) {
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^\\w$.])' + esc + '[ \\t]*[:,]', 'm').test(code);
}

/** `exports.X = ` 赋值（浏览器半运行时真正导出的值）。 */
function runtimeValueExports(src) {
  const out = [];
  for (const m of src.matchAll(/^[ \t]*exports\.([A-Za-z_$][\w$]*)[ \t]*=/gm)) out.push(m[1]);
  return out;
}

/** `.d.ts` 里的值导出声明：`export declare const|function|class X` / `export { X }`。 */
function declaredValueExports(src) {
  const out = [];
  for (const m of src.matchAll(/^[ \t]*export[ \t]+(?:declare[ \t]+)?(?:const|let|var|function|class)[ \t]+([A-Za-z_$][\w$]*)/gm)) out.push(m[1]);
  for (const m of src.matchAll(/^[ \t]*export[ \t]*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/[ \t]+as[ \t]+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) out.push(n);
    }
  }
  return out;
}

// ── 必需字段清单：**钉住的东西**。每条附上"为什么必需"（依据见括注的代码处）──

const WALLPAPER_REQUIRED = [
  { name: 'id', why: 'entry key; playlist wallpaperIds resolve against it (buildInventory)' },
  { name: 'title', why: 'picker label; both construction sites assign it (buildInventory)' },
  { name: 'type', why: 'drives every capability branch (buildInventory)' },
  { name: 'contentrating', why: 'rating filter input; readProjectP / metaEntry always produce it' },
  { name: 'playable', why: 'portableCount and rotation filter read it (buildInventory)' },
  { name: 'media', why: 'the video/web media URL the browser half plays (buildInventory)' },
  { name: 'mediaExt', why: 'real container suffix of that media file: the token-shaped URL carries no extension, so the client\'s "browser can play it natively" decision has no other source (buildInventory)' },
  { name: 'preview', why: 'picker thumbnail (buildInventory)' },
  { name: 'frameUrl', why: 'scene static-frame source (buildInventory)' },
  { name: 'schemeColor', why: 'load-time placeholder colour before a frame exists (buildInventory)' },
  { name: 'sceneLive', why: 'produced by sceneFieldsFor, spread into every scene entry' },
  { name: 'sceneLiveSrc', why: 'produced by sceneFieldsFor (live-render source token)' },
  { name: 'scenePkgBytes', why: 'produced by sceneFieldsFor: scene.pkg size, the client scales the first-frame budget by it' },
  { name: 'sceneVideo', why: 'produced by sceneFieldsFor (probe-confirmed embedded MP4)' },
  { name: 'sceneAudio', why: 'produced by sceneFieldsFor (packaged audio)' },
  { name: 'hasCustomFrame', why: 'produced by sceneFieldsFor (user frame overrides the extracted one)' },
  { name: 'webLive', why: 'produced by webFieldsFor, spread into every web entry' },
  { name: 'webLiveSrc', why: 'produced by webFieldsFor (renderer entry URL)' },
  { name: 'propsUrl', why: 'properties-panel entry point; assigned once per entry (buildInventory)' },
  { name: 'liveFrame', why: 'web first-frame cache URL (buildInventory)' },
];

const INVENTORY_REQUIRED = [
  { name: 'installDir', why: 'top-level payload shorthand from locateWallpaperEngineP()' },
  { name: 'uploadDir', why: 'UPLOAD_DIR; the settings UI moves it (buildInventory payload)' },
  { name: 'cacheDir', why: 'cacheBaseDir() in effect (env → config.json cacheDir → default); the settings UI moves it (buildInventory payload)' },
  { name: 'weAssetsDir', why: 'WE_ASSETS_DIR; the client derives localAssets=1 from it' },
  { name: 'weAssetsAvailable', why: 'weAssetsAvailable() probe gates the official-assets UI' },
  { name: 'sceneMediaBase', why: 'media source origin the live renderer uses as mediaBase for Scenes (buildInventory payload)' },
  { name: 'total', why: 'entry count shown in the picker (buildInventory payload)' },
  { name: 'portableCount', why: 'playable count shown in the picker (buildInventory payload)' },
  { name: 'wallpapers', why: 'the entry list itself (payload shorthand)' },
  { name: 'playlists', why: 'scoped-rotation source (payload shorthand)' },
];

/** inventory 构造代码 = 基础条目 + 两个字段提供者（它们经 spread 进入每条）。
 *  ⚠️ `assembleInventory` 是**字段的唯一产出点**（#158 引入三级缓存时把组装从
 *  `buildInventory` 里提出来，好让"签名快路径"与"真扫描"共用同一段字段代码）——
 *  它必须在这张名单里，否则"声明的字段都能在构造代码里找到赋值"这条会失去覆盖。 */
const INVENTORY_FUNCS = ['sceneFieldsFor', 'webFieldsFor', 'assembleInventory', 'buildInventory'];

function auditSurface({ dts, code, iface, required }) {
  const declared = interfaceFields(dts, iface);
  const names = required.map((r) => r.name);
  if (declared === null) return { parsed: false, declared: [], missingDeclared: names, extraDeclared: [], missingInCode: [] };
  return {
    parsed: true,
    declared,
    missingDeclared: names.filter((n) => !declared.includes(n)),
    extraDeclared: declared.filter((n) => !names.includes(n)),
    missingInCode: declared.filter((n) => !codeDeclaresField(code, n)),
  };
}

/** 失败时把"缺的字段为什么必需"打出来 —— 署名清单不能只是注释里的死字。 */
function whyFor(required, names) {
  return required.filter((r) => names.includes(r.name)).map((r) => r.name + '（' + r.why + '）').join('；');
}

// ── 输入 ──────────────────────────────────────────────────────────────────────
const hostDts = readFileSync(join(ROOT, 'lib', 'types', 'index.d.ts'), 'utf8');
const clientDts = readFileSync(join(ROOT, 'lib', 'types', 'client.d.ts'), 'utf8');
// ⚠️ 清单构建代码已从 `apply()` 搬进 `lib/inventory.js`（§★ W-B B1）⇒ 解析面读该模块，
//    不再是 `lib/index.js`。`sceneFieldsFor`/`webFieldsFor`/`buildInventory` 三个函数都在这里。
const inventorySrc = readFileSync(join(ROOT, 'lib', 'inventory.js'), 'utf8');
const clientCode = readFileSync(join(ROOT, 'src', 'client.js'), 'utf8');

const inventoryCode = INVENTORY_FUNCS.map((n) => functionBody(inventorySrc, n)).join('\n');
const sourcesOk = INVENTORY_FUNCS.every((n) => {
  const b = functionBody(inventorySrc, n);
  return typeof b === 'string' && b.length > 200 && b.includes('return');
});

console.log('\nP1/P2  WallpaperDescriptor（壁纸条目）');
{
  const a = auditSurface({ dts: hostDts, code: inventoryCode, iface: 'WallpaperDescriptor', required: WALLPAPER_REQUIRED });
  check('字段解析成功（非空且条数 == 钉住的 ' + WALLPAPER_REQUIRED.length + ' 条）',
    sourcesOk && a.parsed && a.declared.length === WALLPAPER_REQUIRED.length,
    sourcesOk ? (a.parsed ? a.declared.length + ' 个字段' : 'interface 解析失败') : 'inventory 构造函数体解析失败');
  check('钉住的必需字段全部已声明，且没有多出的字段',
    a.parsed && a.missingDeclared.length === 0 && a.extraDeclared.length === 0,
    'missing=[' + a.missingDeclared.join(', ') + '] extra=[' + a.extraDeclared.join(', ') + ']'
      + (a.missingDeclared.length ? ' ⇒ ' + whyFor(WALLPAPER_REQUIRED, a.missingDeclared) : ''));
  check('声明的每个字段都能在 inventory 构造代码里找到赋值（无幽灵字段）',
    a.declared.length > 0 && a.missingInCode.length === 0,
    a.missingInCode.length ? '无生产者：' + a.missingInCode.join(', ') : '全部有生产者');
}

console.log('\nP3  Inventory（顶层载荷）');
{
  const a = auditSurface({ dts: hostDts, code: inventoryCode, iface: 'Inventory', required: INVENTORY_REQUIRED });
  check('钉住的必需字段全部已声明，且没有多出的字段',
    // 集合已逐名相等（下面 missing/extra 两项）⇒ 长度相等是冗余合取项：本条只保留
    // 两项 missing/extra 与 `a.parsed`；"钉住的每条都真的在 .d.ts 里"由前面那条
    // 按名字逐一钉名的判据（约 203-205 行）负责，两处分工不重复。
    a.parsed && a.missingDeclared.length === 0 && a.extraDeclared.length === 0,
    a.parsed
      ? 'missing=[' + a.missingDeclared.join(', ') + '] extra=[' + a.extraDeclared.join(', ') + ']'
        + (a.missingDeclared.length ? ' ⇒ ' + whyFor(INVENTORY_REQUIRED, a.missingDeclared) : '')
      : 'interface 解析失败');
  check('声明的每个字段都能在 inventory 构造代码里找到赋值（无幽灵字段）',
    a.declared.length > 0 && a.missingInCode.length === 0,
    a.missingInCode.length ? '无生产者：' + a.missingInCode.join(', ') : '全部有生产者');
}

console.log('\nP4  负对照：漏掉必需字段的 .d.ts 必须被判缺');
{
  const dropped = 'liveFrame';
  const mutated = hostDts.replace(new RegExp('^.*\\b' + dropped + '\\b.*$', 'm'), '');
  const control = auditSurface({ dts: mutated, code: inventoryCode, iface: 'WallpaperDescriptor', required: WALLPAPER_REQUIRED });
  const baseline = auditSurface({ dts: hostDts, code: inventoryCode, iface: 'WallpaperDescriptor', required: WALLPAPER_REQUIRED });
  check('同一判据：删掉一行声明后恰好报缺 ' + dropped + '（且基线为 0 缺）',
    mutated !== hostDts && baseline.missingDeclared.length === 0 && control.missingDeclared.join(',') === dropped,
    'control missing=[' + control.missingDeclared.join(', ') + '] baseline missing=[' + baseline.missingDeclared.join(', ') + ']');
  const invDropped = 'uploadDir';
  const invMutated = hostDts.replace(new RegExp('^.*\\b' + invDropped + '\\b.*$', 'm'), '');
  const invControl = auditSurface({ dts: invMutated, code: inventoryCode, iface: 'Inventory', required: INVENTORY_REQUIRED });
  check('同一判据（Inventory）：删掉 ' + invDropped + ' 后恰好报缺它',
    invMutated !== hostDts && invControl.missingDeclared.join(',') === invDropped,
    'control missing=[' + invControl.missingDeclared.join(', ') + ']');
}

console.log('\nP5  负对照：字段不再被代码赋值时必须被判缺');
{
  const renamed = 'liveFrame';
  const mutatedCode = inventorySrc.split(renamed).join(renamed + 'Renamed');
  const control = auditSurface({ dts: hostDts, code: mutatedCode, iface: 'WallpaperDescriptor', required: WALLPAPER_REQUIRED });
  const baseline = auditSurface({ dts: hostDts, code: inventoryCode, iface: 'WallpaperDescriptor', required: WALLPAPER_REQUIRED });
  check('同一判据：把代码里的 ' + renamed + ' 改名后恰好报它无生产者（且基线为 0）',
    baseline.missingInCode.length === 0 && control.missingInCode.join(',') === renamed,
    'control missingInCode=[' + control.missingInCode.join(', ') + ']');
}

console.log('\nP6  client 半：运行时导出的值都有类型声明');
{
  const runtime = runtimeValueExports(clientCode);
  const declared = declaredValueExports(clientDts);
  const missing = runtime.filter((n) => !declared.includes(n));
  check('解析到 ≥2 个运行时导出（解析器没有空转）', runtime.length >= 2, 'runtime=[' + runtime.join(', ') + ']');
  check('每个 `exports.X =` 都有对应的值导出声明', missing.length === 0,
    runtime.length + ' 个导出；missing=[' + missing.join(', ') + ']');
}

console.log('\nP7  负对照：删掉 apply 声明的 client.d.ts 必须被判缺');
{
  const runtime = runtimeValueExports(clientCode);
  const mutated = clientDts.split('\n').filter((l) => !/\bapply\b/.test(l)).join('\n');
  const declared = declaredValueExports(mutated);
  const missing = runtime.filter((n) => !declared.includes(n));
  const baseline = runtime.filter((n) => !declaredValueExports(clientDts).includes(n));
  check('同一判据：删掉 apply 后只报缺 apply（inject 不受影响）',
    mutated !== clientDts && baseline.length === 0 && missing.join(',') === 'apply',
    'control missing=[' + missing.join(', ') + '] baseline missing=[' + baseline.join(', ') + ']');
}

console.log('\nP8/P9  散文不变量：路由面与 webServer 依赖');
{
  const ROUTE_INDEX = 'docs/ROUTE-INDEX.md';
  const indexText = existsSync(join(ROOT, ROUTE_INDEX)) ? readFileSync(join(ROOT, ROUTE_INDEX), 'utf8') : '';
  // 条数取**生成的索引**，不在这里再写死一个数字：索引变了而散文没跟上，这条会红。
  const indexCount = (() => { const m = /共\s*\*\*(\d+)\*\*\s*条路由/.exec(indexText); return m ? m[1] : null; })();
  const proseCount = (t) => { const m = /(\d+)\s+same-origin HTTP routes/.exec(t); return m ? m[1] : null; };
  const proseOk = (t) => /hard[ -]depend/i.test(t)
    && !/webServer[^.\n]*\boptional\b/i.test(t)
    && t.includes(ROUTE_INDEX)
    && !/\bthree\b[^.\n]*\broutes?\b|\broutes?\b[^.\n]*\bthree\b/i.test(t);
  const countOk = (t) => indexCount !== null && proseCount(t) === indexCount;
  check('明说 webServer 是硬依赖、不称它 optional、指向 ' + ROUTE_INDEX,
    proseOk(hostDts), proseOk(hostDts) ? ROUTE_INDEX + ' 存在' : '散文断言不成立');
  check('散文写的路由条数 == ' + ROUTE_INDEX + ' 的条数（不写死独立数字）',
    countOk(hostDts), 'd.ts=' + proseCount(hostDts) + ' index=' + indexCount);
  // 每条子句各配一次改写：证明判据的每一半都真的能判红，而不是只有第一半在起作用。
  // 条数对照的改写从**解析出来的当前值**推出来，因此索引改条数时这里不需要跟着改。
  const controls = [
    ['去掉硬依赖措辞', hostDts.replace(/hard[ -]depend\w*/i, 'optional'), proseOk],
    ['把 webServer 说成 optional', hostDts.replace('declared by `inject` below', 'declared by `inject` below, though webServer is optional'), proseOk],
    ['不再指向路由索引', hostDts.split(ROUTE_INDEX).join('README.md'), proseOk],
    ['声称 three routes', hostDts.replace(/(\d+)(\s+same-origin HTTP routes)/, 'three$2'), proseOk],
    ['路由条数少一', hostDts.replace(/(\d+)(\s+same-origin HTTP routes)/, (m, n, rest) => String(Number(n) - 1) + rest), countOk],
  ].map(([label, text, predicate]) => [label, text, predicate(text)]);
  const brokenControls = controls.filter(([, text, ok]) => text === hostDts || ok !== false).map(([label]) => label);
  check('负对照：五种改坏的措辞都会被判不合格（判据每一半都能失败）',
    brokenControls.length === 0,
    brokenControls.length ? '未被判红：' + brokenControls.join(' / ') : controls.map(([l]) => l).join(' / '));
}

// ── 汇总：failed 在全部 check 之后现场统计，不写死在文件中部 ────────────────────
console.log('\n' + (failed ? 'TYPES FAIL — ' + failed + ' check(s) failed' : 'TYPES PASS — every published type surface matches the runtime'));
process.exit(failed ? 1 : 0);
