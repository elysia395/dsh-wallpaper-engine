#!/usr/bin/env node
/**
 * verify-subpackage-purity.mjs -- BUNDLE-SPLIT 7.6(3) 跨包纯度（P-A 子包族）
 *
 * 2.1/2.2：包边界就是卸载边界。子包之间的任何 import（裸名或相对跨到 packages/<other>）都会把
 * 两个包在模块图上粘死：关掉其中一个，另一个还握着它的模块实例。
 *
 * 允许的跨包面（lead 裁定，Service 口径 = 收窄后的**唯一**面）：
 *   · node: 内置（包内相对 import 照常）；
 *   · 子包宿主半边**零主包说明符**：既不 import 主包裸名，也不 import 主包任何子路径
 *     （旧叶子 specifier 'dsh-plugin-wallpaper-engine/subpackage-boot.js' 同样判红）；
 *     唯一的跨包通道是 **Cordis Service**：`export const inject = ['<HOST_SERVICE_NAME>']`
 *     + 在 apply 里从 `ctx[HOST_SERVICE_NAME]` 取用（§5.1 ① / §5.2 允许清单 1）。
 *     服务名**不硬编码在判据里**：本文件动态 import lib/subpackage-boot.js 读它的
 *     `HOST_SERVICE_NAME` 导出，逐包逐字对账 —— 名字漂移即判红。
 *   · require('dsh-plugin-wallpaper-engine') 这条**浏览器侧**通道只允许出现在子包客户端产物
 *     （packages/<pkg>/lib/client*.js）里，宿主半边里出现即违规；例外面不扩大。
 *     **P-C 契约 §2 收紧**（放行面 = 声明落点产物里的**那一行 require**）：
 *     ① 落点必须是本包 manifest `exports["./client"]` 指的**那一份**产物（同包另一个
 *        `lib/client*.js` 不认账）；② 形态必须是 `require(...)`（构建期那一行，kind='dynamic'）——
 *        产物里写 `import root from '主包名'` 同样判红；③ 每个声明 dsh.client 的包，其声明落点
 *        产物里的主包通道**恰一条**（0 条 / 多条都红）。三处都由 `rootChannels()` 单一真源给出，
 *        判据与主流程对账共用它，不允许两处各写一套条件。
 *   · **字体包覆盖面地板**（P-C 契约 §1）：判据真的作用到字体包 —— 浏览器半边入口
 *     `packages/fonts/src/client.js` 必须在扫描面内、字体包 src 面非空。0 文件会让上面所有
 *     "零主包说明符"判据**真空为真**（这是本轮要堵的洞），所以空扫描面判红。
 * 其余裸包必须在自己 dependencies/peerDependencies/optionalDependencies（客户端产物可放宽到
 * dsh.client.inject 声明面）里声明；相对 import 一律不许逃出本包；也不许自引用。
 * 宿主半边 inject 与使用面一致：用了 ctx.<key> 就必须在该文件 export const inject = [...] 里声明；
 * 声明了 inject 的半边必须含 HOST_SERVICE_NAME，子包宿主入口还必须真的从 ctx 取用它。
 *
 * ── 可选探测 vs 必需依赖（2026-10-30 修正「判据过严」，见 CORDIS_CONTEXT_API）──────────────
 * 本判据意图是「防未声明的**必需**服务消费」。但 `ctx.get(name)` 是 Cordis 官方提供的
 * **不声明 inject 也能读**的入口（reflect.ts: Read a service from the store without the
 * inject requirement），正是子包「装不装上游插件都能加载」的可选探测手段；
 * 旧实现把 `ctx.get` 里的方法名 `get` 当成服务名，误判成「未声明依赖」。现在把 Cordis
 * Context 内建 API 成员排除在「消费的服务名」之外（只排 API，不排业务服务名），
 * 判据仍能抓住 ctx.webServer / ctx.foo 这类真正的未声明服务（负对照两向都在）。
 * 负对照全部在内存里喂纯函数 purityViolations()。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripComments } from './tools/js-text.mjs';
import { upstreamForkByName } from './tools/subpackage-shapes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n      ' + detail : '')); }
}
const isFile = (abs) => { try { return statSync(abs).isFile(); } catch { return false; } };
const isDir = (abs) => { try { return statSync(abs).isDirectory(); } catch { return false; } };
const readAbs = (abs) => (isFile(abs) ? readFileSync(abs, 'utf8') : null);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const relOf = (abs) => relative(ROOT, abs).split(sep).join('/');

/** 工具备份目录名（发行面外）：`lib/pet-link-backups/` 是补丁链的恢复点，不是产品代码。 */
const SKIP_DIRS = new Set(['node_modules', '.test-cache', 'pet-link-backups']);

/**
 * Cordis Context 的**内建 API 成员**（不是可注入服务）：读取它们不构成「消费某个服务」，
 * 因此不要求在 inject 里声明。真源：本机 DSH 实际使用的 @deepseek-ai/cordis@4.0.5
 * `src/reflect.ts` 的 mixin 表 ——
 *   reflect: [get, set, provide, accessor, mixin]
 *   fiber:   [runtime, effect]
 *   registry:[inject, plugin]
 *   events:  [on, once, parallel, emit, serial, bail, waterfall]
 * 外加 context 自带的 logger / root / intercept。
 *
 * ⚠️ 只放 Cordis 自己的 API，**任何业务服务名都不在此列**，所以「未声明消费」判据仍然有牙：
 *   · `ctx.get('petApiDshwe')` 是**可选探测**（reflect.ts：Read a service from the store
 *     without the inject requirement）⇒ 不要求声明，也不该被误判成「未声明的必需依赖」；
 *   · `ctx.webServer` / `ctx.foo` 这种真正的服务读法**照旧判红**（见文末负对照）。
 */
const CORDIS_CONTEXT_API = new Set([
  'get', 'set', 'provide', 'accessor', 'mixin',
  'runtime', 'effect',
  'inject', 'plugin',
  'on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall',
  'logger', 'root', 'intercept',
]);

function walkFiles(dir, out) {
  out = out || [];
  if (!isDir(dir)) return out;
  for (const n of readdirSync(dir).sort()) {
    const abs = join(dir, n);
    if (isDir(abs)) { if (!SKIP_DIRS.has(n)) walkFiles(abs, out); }
    else if (/\.(?:js|mjs)$/.test(n)) out.push(abs);
  }
  return out;
}

function discoverSubpackages() {
  const dir = join(ROOT, 'packages');
  if (!isDir(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const pj = join(dir, n, 'package.json');
    if (!isFile(pj)) continue;
    let manifest = null, error = null;
    try { manifest = JSON.parse(readFileSync(pj, 'utf8')); } catch (e) { error = e.message; }
    out.push({ dir: 'packages/' + n, abs: join(dir, n), manifest, error });
  }
  return out;
}

/** 抽取 3 种形态的 import 说明符（已去注释）。 */
function specifiersOf(text) {
  const src = stripComments(text);
  const out = [], seen = new Set();
  const push = (s, i, kind) => { const k = kind + '|' + s; if (!seen.has(k)) { seen.add(k); out.push({ spec: s, index: i, kind }); } };
  const res = [
    [/(?:^|[\s;{(])(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g, 'from'],
    [/(?:^|[\s;{(])import\s*['"]([^'"]+)['"]/g, 'side'],
    [/(?:^|[^.\w$])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'dynamic'],
  ];
  for (const pair of res) {
    const re = pair[0], kind = pair[1];
    let m;
    while ((m = re.exec(src)) !== null) push(m[1], m.index, kind);
  }
  return out;
}

const norm = (abs) => resolve(abs).split(sep).join('/');
const inside = (child, parent) => norm(child).indexOf(norm(parent) + '/') === 0;
const isClientArtifact = (abs) => /\/lib\/client[^/]*\.js$/.test(norm(abs));

const rootNameOf = (spec) => {
  const p = spec.split('/');
  return spec.charAt(0) === '@' ? p.slice(0, 2).join('/') : p[0];
};
function declaredFace(manifest, spec) {
  const rootName = rootNameOf(spec);
  const fam = [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies, manifest.devDependencies];
  // upstream-fork：宿主提供面登记在 test/tools/subpackage-shapes.mjs（上游真值），清单里的三族
  // 必须与之逐字相等（由 S12 判）。这里**同时**认登记表 —— 否则"清单漏写一条"会被报成
  // 「未声明」，而真问题是「清单与登记表漂移」。两处都认 = 判据不互相遮蔽。
  const fork = upstreamForkByName(manifest && manifest.name);
  if (fork) {
    for (const d of [fork.dependencies, fork.peerDependencies, fork.optionalDependencies]) {
      if (d && Object.prototype.hasOwnProperty.call(d, rootName)) return true;
    }
  }
  for (const d of fam) if (d && Object.prototype.hasOwnProperty.call(d, rootName)) return true;
  return false;
}
function clientInjectedFace(manifest, spec) {
  const rootName = rootNameOf(spec);
  const inj = (manifest.dsh && manifest.dsh.client && manifest.dsh.client.inject) || [];
  return inj.indexOf(rootName) >= 0;
}
/** 子包宿主入口（manifest.main，缺省 ./lib/index.js）在仓内的相对路径；null = 入口跑出本包。 */
function hostEntryRel(pkg) {
  if (!pkg || !pkg.manifest) return null;
  const main = (typeof pkg.manifest.main === 'string' && pkg.manifest.main.trim()) ? pkg.manifest.main.trim() : './lib/index.js';
  const abs = resolve(pkg.abs, main);
  return inside(abs, pkg.abs) ? relOf(abs) : null;
}

/** 子包**声明面**的客户端落点（manifest `exports["./client"]`）的仓内相对路径；null = 未声明。 */
function clientArtifactRelOf(pkg) {
  const exp = (pkg && pkg.manifest && pkg.manifest.exports) || {};
  const v = exp['./client'];
  // 条件对象（`{ types, default }`）是 upstream-fork 的合法形态：落点取 default（与
  // `test/tools/packages.mjs` 的 clientExport 同口径），否则 fork 的放行面永远对不上账。
  let t = null;
  if (typeof v === 'string') t = v;
  else if (v && typeof v === 'object') {
    for (const k of ['default', 'import', 'require', 'node', 'browser']) {
      if (typeof v[k] === 'string') { t = v[k]; break; }
    }
  }
  if (typeof t !== 'string') return null;
  t = t.replace(/^\.\//, '');
  return t && pkg.dir ? pkg.dir + '/' + t : null;
}

/**
 * 浏览器半边**唯一**允许的跨包通道（P-C 契约 §2）= 声明落点产物里的 `require("<主包名>")`。
 * 单一真源：`purityViolations()` 用它的结果决定放行，主流程用它的结果做"恰一条"对账。
 * @returns {{rel:string, spec:string, kind:string, index:number}[]}
 */
function rootChannels(pkg, rootPkg, files) {
  const out = [];
  const want = clientArtifactRelOf(pkg);
  if (!want || !rootPkg || typeof rootPkg.name !== 'string' || !rootPkg.name) return out;
  for (const f of files) {
    if (relOf(f.abs) !== want || !isClientArtifact(f.abs)) continue;
    for (const sp of specifiersOf(f.text)) {
      if (sp.spec === rootPkg.name) out.push({ rel: want, spec: sp.spec, kind: sp.kind, index: sp.index });
    }
  }
  return out;
}

/**
 * 字体包覆盖面地板（P-C 契约 §1）——判据真的作用到字体包，且**不许真空为真**。
 * 单独一个纯函数 = 有负对照（空扫描面必须报，见文件末）。
 * @returns {string[]} 违反项
 */
function fontsCoverageProblems(pkg, files) {
  if (!pkg) return ['packages/ 下没有 dsh-plugin-wallpaper-engine-fonts（包名漂移 => 棘轮静默失效）'];
  const bad = [];
  const rels = files.map((f) => relOf(f.abs));
  const src = rels.filter((r) => r.indexOf(pkg.dir + '/src/') === 0);
  if (src.length === 0) bad.push(pkg.dir + '/src 面 0 个文件 => "零主包说明符"判据对本包真空为真（P-C 契约 §1）');
  if (src.indexOf(pkg.dir + '/src/client.js') < 0) bad.push(pkg.dir + '/src/client.js（冻结的浏览器半边入口，P-C 契约 §1）不在扫描面内');
  return bad;
}

/**
 * 判据核心（纯函数）。
 *
 * @param {{pkg:object, siblings:object[], rootPkg:object, files:{abs:string,text:string}[],
 *          hostServiceName?:string|null}} inp hostServiceName = 从主包动态读来的服务名；null/缺省 = 不做服务名对账
 */
function purityViolations(inp) {
  const bad = [];
  const pkg = inp.pkg, name = pkg.manifest.name;
  const hostService = (typeof inp.hostServiceName === 'string' && inp.hostServiceName) ? inp.hostServiceName : null;
  const hostLabel = hostService || 'HOST_SERVICE_NAME';
  const entryRel = hostEntryRel(pkg);
  const declaredArtifactRel = clientArtifactRelOf(pkg);
  // 放行面：只认声明落点产物里的那一行 require（P-C 契约 §2）。
  const allowed = new Set(rootChannels(pkg, inp.rootPkg, inp.files).map((c) => c.rel + '|' + c.spec + '|' + c.kind));
  const siblings = inp.siblings.map((s) => ({ name: s.manifest.name, abs: s.abs, dir: s.dir }));
  // upstream-fork 形态（P1：packages/pet）不是主包服务面的消费者：它自带 patch 行 + 自己的
  // inject 面（webServer / agentDefaultModel / credentials / llm / commands / connection），
  // 与主包的关系是"同级插件"。所以「必须 inject wallpaperEngineHost 且必须从 ctx 取用」这条
  // 对它不适用 —— 显式跳过（判据**反向**由 client-half 的"产物不许有主包绑定"与
  // subpackage-boot 的"空面必须为空"钉住），不是静默放宽。
  const forkReg = upstreamForkByName(name);
  const forkNoHostService = Boolean(forkReg && forkReg.hostServiceConsumer === false);
  for (const file of inp.files) {
    const rel = relOf(file.abs), base = dirname(file.abs), clientSide = isClientArtifact(file.abs);
    for (const sp of specifiersOf(file.text)) {
      const spec = sp.spec;
      if (spec.indexOf('node:') === 0) continue;
      if (builtinModules.indexOf(spec) >= 0) continue;
      if (spec.charAt(0) === '.' || spec.charAt(0) === '/') {
        const target = resolve(base, spec);
        if (inside(target, pkg.abs)) {
          const cands = [target, target + '.js', target + '.mjs', join(target, 'index.js')];
          if (!cands.some(isFile)) bad.push(rel + ' 相对 import ' + spec + ' 的目标不存在（' + relOf(target) + '）');
          continue;
        }
        const sib = siblings.filter((s) => inside(target, s.abs))[0];
        if (sib) { bad.push(rel + ' 跨子包相对 import ' + spec + ' -> 子包 ' + sib.name + '（2.1 包边界=卸载边界，禁止）'); continue; }
        bad.push(rel + ' 相对 import ' + spec + ' 逃出本包到 ' + relOf(target) + '（子包不许相对 import 主包文件；跨包面只许 Cordis Service ctx.' + hostLabel + '）');
        continue;
      }
      if (spec === name) { bad.push(rel + ' 自引用裸包名 ' + spec); continue; }
      if (siblings.some((s) => s.name === spec || spec.indexOf(s.name + '/') === 0)) {
        bad.push(rel + ' 跨子包 value import ' + spec + '（子包之间不许直接 import）'); continue;
      }
      if (spec === inp.rootPkg.name || spec.indexOf(inp.rootPkg.name + '/') === 0) {
        if (spec === inp.rootPkg.name && allowed.has(rel + '|' + spec + '|dynamic')) continue;   // 唯一放行面（P-C 契约 §2）
        const where = isClientArtifact(file.abs) ? rel + ' 的客户端产物里出现主包说明符 ' : rel + ' 宿主半边 import 主包说明符 ';
        if (spec === inp.rootPkg.name && declaredArtifactRel === rel) {
          bad.push(rel + ' 里以 ' + sp.kind + " 形态引用主包（P-C 契约 §2：放行面只认构建期那一行 require(\"" + spec + '")）');
        } else if (spec === inp.rootPkg.name && isClientArtifact(file.abs)) {
          bad.push(rel + ' 里出现主包说明符 ' + spec + '，但它不是本包 exports["./client"] 的声明落点 '
            + (declaredArtifactRel || '（本包未声明 exports["./client"]）') + '（P-C 契约 §1/§2：放行面恰为声明落点产物）');
        } else {
          bad.push(where + spec + '（§5.2：子包半边零主包说明符，只许 Cordis Service ctx.' + hostLabel + '）');
        }
        continue;
      }
      if (clientSide && clientInjectedFace(pkg.manifest, spec)) continue;
      if (!declaredFace(pkg.manifest, spec)) bad.push(rel + ' 裸包 import ' + spec + ' 未在 ' + name + ' 的 dependencies/peerDependencies/optionalDependencies 里声明');
    }
    const inj = /export\s+const\s+inject\s*=\s*\[([^\]]*)\]/.exec(stripComments(file.text));
    if (inj) {
      const listed = inj[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      const body = stripComments(file.text), used = new Set();
      const cre = /\bctx\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\])/g;
      let m;
      while ((m = cre.exec(body)) !== null) used.add(m[1] || m[2]);
      for (const k of used) {
        // Cordis Context 内建 API（get / effect / plugin …）不是可注入服务：读取它不等于消费某服务，
        // 不要求写进 inject（真源见 CORDIS_CONTEXT_API）。业务服务名不在此列，仍按下面这条判红。
        if (CORDIS_CONTEXT_API.has(k)) continue;
        if (listed.indexOf(k) < 0) bad.push(rel + ' 用了 ctx.' + k + ' 但 inject=[' + listed.join(', ') + '] 里没有声明它（inject 使用面与声明面必须一致）');
      }
      if (hostService && !clientSide && listed.indexOf(hostService) < 0) {
        bad.push(rel + ' 宿主半边 export const inject=[' + listed.join(', ') + "] 里没有 '" + hostService + "'（§5.1 ①：子包半边唯一跨包面 = 主包服务名，逐字对账 lib/subpackage-boot.js 的 HOST_SERVICE_NAME）");
      }
    }
    if (hostService && !clientSide && entryRel && rel === entryRel && !forkNoHostService) {
      if (!inj) bad.push(rel + " 宿主入口没有 export const inject = [...]（§5.1 ①：必须 inject '" + hostService + "'）");
      else {
        const body = stripComments(file.text);
        const useRe = new RegExp('\\bctx\\s*(?:\\.\\s*' + hostService + '\\b|\\[\\s*[\'"]' + hostService + '[\'"]\\s*\\])');
        if (!useRe.test(body)) bad.push(rel + ' 宿主入口没有从 ctx 取用 ' + hostService + '（§5.1 ①：不许 import 主包说明符，只许 ctx.' + hostService + '）');
      }
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------
// 服务名真源：动态读主包（§5.1 ①），判据里不硬编码。
const HOST_SERVICE_FALLBACK = 'wallpaperEngineHost';
let HOST_SERVICE_NAME = null, hostServiceError = null;
try {
  const boot = await import(pathToFileURL(join(ROOT, 'lib/subpackage-boot.js')).href);
  HOST_SERVICE_NAME = boot.HOST_SERVICE_NAME;
} catch (e) { hostServiceError = e.message; }
check('lib/subpackage-boot.js 的 HOST_SERVICE_NAME 可动态读入（判据真源）',
  typeof HOST_SERVICE_NAME === 'string' && HOST_SERVICE_NAME.length > 0,
  hostServiceError || ('HOST_SERVICE_NAME=' + String(HOST_SERVICE_NAME)));
const HOST = (typeof HOST_SERVICE_NAME === 'string' && HOST_SERVICE_NAME) ? HOST_SERVICE_NAME : HOST_SERVICE_FALLBACK;

const rootPkg = JSON.parse(read('package.json'));
const pkgs = discoverSubpackages();
check('packages/ 下至少有一个子包（P-A 未落判红）', pkgs.length > 0, pkgs.map((p) => p.dir).join(' / '));
const usable = pkgs.filter((p) => p.manifest && !p.error);
check('每个子包 manifest 可解析', usable.length === pkgs.length, pkgs.filter((p) => p.error).map((p) => p.dir + '：' + p.error).join('；'));

if (usable.length > 0) {
  const inputs = usable.map((p) => ({
    pkg: p, siblings: usable.filter((s) => s.dir !== p.dir), rootPkg, hostServiceName: HOST_SERVICE_NAME,
    files: walkFiles(p.abs).map((abs) => ({ abs, text: readAbs(abs) || '' })),
  }));
  const real = [];
  for (const i of inputs) for (const v of purityViolations(i)) real.push(v);
  check('子包 import 面纯度（零主包说明符 / 无跨子包 import / 依赖面已声明 / inject 一致）', real.length === 0, real.join('\n      '));
  const entryMiss = [];
  for (const i of inputs) {
    const e = hostEntryRel(i.pkg);
    if (!e || !i.files.some((f) => relOf(f.abs) === e)) entryMiss.push(i.pkg.dir + '（' + (e || '入口跑出本包') + '）');
  }
  check('每个子包宿主入口（manifest.main）都在扫描面内，服务名判据真的作用到它', entryMiss.length === 0, entryMiss.join('；'));

  // -- P-C 契约 §1/§2：字体包覆盖面地板 + 浏览器通道恰一条（判据不许真空为真）----------------
  const fontsPkg = usable.find((p) => p.manifest.name === 'dsh-plugin-wallpaper-engine-fonts');
  const fontsInput = inputs.find((i) => i.pkg === fontsPkg) || null;
  const fontsProblems = fontsCoverageProblems(fontsPkg, fontsInput ? fontsInput.files : []);
  check('字体包覆盖面地板（P-C 契约 §1：src 面非空 + src/client.js 在扫描面内）',
    fontsProblems.length === 0, fontsProblems.join('；'));

  const channelRows = []; let channelBad = 0;
  for (const i of inputs) {
    const declaresClient = !!(i.pkg.manifest.dsh && i.pkg.manifest.dsh.client);
    if (!declaresClient) continue;
    const chans = rootChannels(i.pkg, rootPkg, i.files);
    const declared = clientArtifactRelOf(i.pkg);
    const kinds = [...new Set(chans.map((c) => c.kind))];
    const forkReg = upstreamForkByName(i.pkg.manifest.name);
    let note = (declared || '（未声明 exports["./client"]）') + ' => ' + chans.length + ' 条'
      + (kinds.length ? '（' + kinds.join('/') + '）' : '');
    if (!declared) note += ' ✗ 未声明 exports["./client"]：浏览器半边没有声明落点，放行面无法对账';
    else if (!i.files.some((f) => relOf(f.abs) === declared)) note += ' ✗ 声明落点产物不在盘（先跑 npm run build）';
    else if (forkReg && forkReg.hostServiceConsumer === false) {
      // upstream-fork：独立插件，跨包面只有 HTTP capability 一条 ⇒ 主包通道必须**恰为 0 条**。
      // 这一条与一般子包的"恰为 1 条"是同一条判据的两向，不是放宽（多一条 = 偷偷挂主包模块图）。
      note += chans.length === 0 ? ' ✓（fork：独立插件，主包通道必须为 0）'
        : ' ✗ fork 的声明落点产物里出现 ' + chans.length + ' 条主包通道（独立插件不许绑定主包）';
    } else if (chans.length !== 1 || kinds.length !== 1 || kinds[0] !== 'dynamic') note += ' ✗ 声明落点产物里的主包通道必须恰一条 require("<主包名>")';
    else note += ' ✓';
    if (note.indexOf('✗') >= 0) channelBad++;
    channelRows.push(note);
  }
  check('每个声明 dsh.client 的子包：声明落点产物里的主包通道「一般子包恰一条 require("' + rootPkg.name + '") / upstream-fork 恰零条」（P-C 契约 §1/§2）',
    channelBad === 0, channelRows.join('；'));

  const files = inputs.reduce((n, i) => n + i.files.length, 0);
  const specs = inputs.reduce((n, i) => n + i.files.reduce((m2, f) => m2 + specifiersOf(f.text).length, 0), 0);
  console.log('    · 扫描 ' + inputs.length + ' 个子包 / ' + files + ' 个文件 / ' + specs + ' 条 import / 服务名 ' + HOST);
  console.log('    · 浏览器通道（放行面）：' + (channelRows.join('；') || '（无声明 dsh.client 的子包）'));
}

// -- 负对照 ------------------------------------------------------------------
const MOD = 'dsh-plugin-wallpaper-engine-fx';
const mkPkg = (name, deps) => ({ dir: 'packages/fx', abs: join(ROOT, 'packages', 'fx'), manifest: { name, dependencies: deps || {} }, error: null });
const other = { dir: 'packages/parallax', abs: join(ROOT, 'packages', 'parallax'), manifest: { name: 'dsh-plugin-wallpaper-engine-parallax', dependencies: {} }, error: null };
const mk = (files, opts) => {
  const pkg = (opts && opts.pkg) || mkPkg(MOD, (opts && opts.deps) || {});
  return {
    pkg, siblings: (opts && opts.siblings) || [other], rootPkg,
    hostServiceName: (opts && 'hostServiceName' in opts) ? opts.hostServiceName : HOST,
    files: files.map((f) => ({ abs: join(pkg.abs, f.rel), text: f.text })),
  };
};
const baseline = purityViolations(mk([{ rel: 'src/fx-layer.js', text: "import { readFileSync } from 'node:fs';\nexport function apply() {}\n" }]));
check('负对照基准：node 内置 + 无跨包面 0 违反项', baseline.length === 0, JSON.stringify(baseline));
const PURITY_RE = /纯度|跨子包|自引用|未在|inject 使用面|逃出本包|只许|宿主半边|宿主入口|主包说明符|里没有 '|没有从 ctx 取用|形态引用主包|声明落点/;
const neg = (label, files, expectRe, opts) => {
  const v = purityViolations(mk(files, opts));
  check('负对照：' + label, v.some((s) => expectRe.test(s)), '违反项=' + JSON.stringify(v));
};
const negOk = (label, files, opts) => {
  const v = purityViolations(mk(files, opts));
  check('负对照：' + label, !v.some((s) => PURITY_RE.test(s)), JSON.stringify(v));
};
neg('跨子包相对 import 判红', [{ rel: 'src/a.js', text: "import { x } from '../../parallax/src/parallax-layer.js';\n" }], /跨子包相对 import/);
neg('跨子包裸包 import 判红', [{ rel: 'src/a.js', text: "import { x } from 'dsh-plugin-wallpaper-engine-parallax';\n" }], /跨子包 value import/);
neg('未声明裸包 import 判红', [{ rel: 'src/a.js', text: "import { x } from 'lodash';\n" }], /未在 .* 里声明/);
neg('自引用裸包名判红', [{ rel: 'src/a.js', text: "import { x } from 'dsh-plugin-wallpaper-engine-fx';\n" }], /自引用裸包名/);
neg('逃出本包到主包的相对 import 判红', [{ rel: 'src/a.js', text: "import { x } from '../../../lib/host-boot.js';\n" }], /逃出本包/);
neg('用了 ctx.webServer 但 inject 没声明判红', [{ rel: 'lib/index.js', text: "export const inject = [];\nexport function apply(ctx) { ctx.webServer.register({}); }\n" }], /inject 使用面/);
neg('宿主半边 import 主包裸名判红（零主包说明符）', [{ rel: 'lib/index.js', text: "import root from 'dsh-plugin-wallpaper-engine';\n" }], /宿主半边 import 主包说明符/);
neg('宿主半边 import 旧叶子 subpackage-boot.js 判红', [{ rel: 'lib/index.js', text: "import { subpackageKeys } from 'dsh-plugin-wallpaper-engine/subpackage-boot.js';\n" }], /宿主半边 import 主包说明符/);
neg('宿主半边 require 旧叶子 subpackage-boot.js 判红', [{ rel: 'lib/index.js', text: "const { subpackageKeys } = require('dsh-plugin-wallpaper-engine/subpackage-boot.js');\n" }], /宿主半边 import 主包说明符/);
neg('主包其它子路径判红', [{ rel: 'lib/a.js', text: "import { x } from 'dsh-plugin-wallpaper-engine/lib/host-boot.js';\n" }], /宿主半边 import 主包说明符/);
negOk('客户端产物里 require("dsh-plugin-wallpaper-engine") 不判红', [{ rel: 'lib/client.fx.js', text: "const root = require('dsh-plugin-wallpaper-engine');\n" }], { pkg: (() => { const p = mkPkg(MOD); p.manifest.exports = { './client': './lib/client.fx.js' }; return p; })() });
negOk('dsh.client.inject 声明的裸包在客户端产物里不判红', [{ rel: 'lib/client.fx.js', text: "const r = require('@deepseek-ai/dsh-client-runtime');\n" }], { pkg: (() => { const p = mkPkg(MOD); p.manifest.dsh = { client: { inject: ['@deepseek-ai/dsh-client-runtime'] } }; return p; })() });
negOk('inject 声明齐全（含服务名 + 真取用）-> 不触发', [{ rel: 'lib/index.js', text: "export const inject = ['webServer', '" + HOST + "'];\nexport function apply(ctx) { const host = ctx." + HOST + "; ctx.webServer.register({}); host.keys('fx', ctx); }\n" }]);
negOk('服务名以 ctx["<名>"] 括号取用同样认账', [{ rel: 'lib/index.js', text: "export const inject = ['" + HOST + "'];\nexport function apply(ctx) { const host = ctx['" + HOST + "']; host.keys('fx'); }\n" }]);
// Cordis 内建 API（ctx.get）是可选探测入口，不是「未声明消费」——不写进 inject 也不判红。
negOk('ctx.get("可选服务") 不要求 inject 声明（Cordis get 是 API 不是服务；可选探测）',
  [{ rel: 'lib/index.js', text: "export const inject = ['" + HOST + "'];\nexport function apply(ctx) { const h = ctx." + HOST + "; h.keys('fx'); const o = ctx.get && ctx.get('petApiDshwe'); }\n" }]);
// 但排除 API 名不能把真正的未声明服务放过去：ctx.foo 仍判红。
neg('可选探测不掩盖真正的未声明服务：ctx.get(...) 旁的 ctx.foo 仍判红',
  [{ rel: 'lib/index.js', text: "export const inject = ['" + HOST + "'];\nexport function apply(ctx) { const h = ctx." + HOST + "; const a = ctx.get('x'); ctx.foo.bar(); }\n" }],
  /用了 ctx\.foo|inject 使用面/);
neg('宿主半边 inject 里缺服务名判红', [{ rel: 'lib/index.js', text: "export const inject = ['webServer'];\nexport function apply(ctx) { const host = ctx." + HOST + "; ctx.webServer.register({}); host.keys('fx'); }\n" }], /里没有 '/);
neg('宿主入口 inject 了服务名但从不取用判红', [{ rel: 'lib/index.js', text: "export const inject = ['webServer', '" + HOST + "'];\nexport function apply(ctx) { ctx.webServer.register({}); }\n" }], /没有从 ctx 取用/);
neg('宿主入口完全没有 inject 判红', [{ rel: 'lib/index.js', text: "export function apply(ctx) { const host = ctx." + HOST + "; host.keys('fx'); }\n" }], /宿主入口没有 export const inject/);
negOk('已声明 peer 的裸包 import 不判红', [{ rel: 'lib/a.js', text: "import { x } from 'some-peer';\n" }], { deps: {}, pkg: (() => { const p = mkPkg(MOD); p.manifest.peerDependencies = { 'some-peer': '^1.0.0' }; return p; })() });
negOk('客户端产物不背宿主 inject 义务（服务名对账不越界）', [{ rel: 'lib/client.fx.js', text: "const root = require('dsh-plugin-wallpaper-engine');\nexport const inject = ['webServer'];\n" }], { pkg: (() => { const p = mkPkg(MOD); p.manifest.exports = { './client': './lib/client.fx.js' }; return p; })() });

// -- P-C 契约 §1/§2 的负对照：字体包源码面 / 放行面收紧 / 覆盖面地板 -------------------------
// 「在 packages/fonts/src/*.js 写入一句 require ⇒ 红」用**真落点路径**在内存里构造（不落盘）：
// 本判据的写面只有 test/**，packages/fonts/** 属 fonts-pc；纯函数喂文件清单等价于那处写入。
const mkFontsPkg = () => {
  const p = mkPkg('dsh-plugin-wallpaper-engine-fonts');
  p.dir = 'packages/fonts'; p.abs = join(ROOT, 'packages', 'fonts');
  p.manifest.exports = { './client': './lib/client.fonts.js' };
  return p;
};
neg('字体包源码面出现主包说明符判红（P-C 契约 §1：零主包说明符，真落点路径 packages/fonts/src/client.js）',
  [{ rel: 'src/client.js', text: "const host = require('dsh-plugin-wallpaper-engine');\n" }], /宿主半边 import 主包说明符/, { pkg: mkFontsPkg() });
neg('字体包其它源码文件出现主包说明符同样判红',
  [{ rel: 'src/appearance-font-section.js', text: "const h = require('dsh-plugin-wallpaper-engine');\n" }], /宿主半边 import 主包说明符/, { pkg: mkFontsPkg() });
negOk('同一句 require 落在字体包**声明落点产物**里不判红（放行面 = 那一行）',
  [{ rel: 'lib/client.fonts.js', text: "const host = require('dsh-plugin-wallpaper-engine');\n" }], { pkg: mkFontsPkg() });
neg('声明落点产物里用 import 形态引用主包判红（只认构建期那一行 require）',
  [{ rel: 'lib/client.fonts.js', text: "import root from 'dsh-plugin-wallpaper-engine';\n" }], /形态引用主包|主包说明符/, { pkg: mkFontsPkg() });
neg('同包另一份 client*.js（非声明落点）里 require 主包判红（放行面恰为声明落点）',
  [{ rel: 'lib/client.other.js', text: "const host = require('dsh-plugin-wallpaper-engine');\n" }], /不是本包 exports|主包说明符/, { pkg: mkFontsPkg() });
neg('声明落点产物里 require 主包**子路径**判红（放行面只有裸包名那一行）',
  [{ rel: 'lib/client.fonts.js', text: "const h = require('dsh-plugin-wallpaper-engine/lib/host-boot.js');\n" }], /主包说明符/, { pkg: mkFontsPkg() });
const fontsOkInput = mk([{ rel: 'src/client.js', text: "export const x = 1;\n" }, { rel: 'src/appearance-font-section.js', text: "export const y = 2;\n" }], { pkg: mkFontsPkg() });
check('负对照基准：字体包扫描面非空（src 面 ≥1 且有 src/client.js）时地板判据 0 违反',
  fontsCoverageProblems(mkFontsPkg(), fontsOkInput.files).length === 0
  && purityViolations(fontsOkInput).length === 0);
check('负对照：字体包 src 面清空判红（0 文件 => 判据真空为真，必须被堵）',
  fontsCoverageProblems(mkFontsPkg(), [{ abs: join(ROOT, 'packages', 'fonts', 'lib', 'client.fonts.js'), text: '' }]).some((s) => /src 面 0 个文件/.test(s)));
check('负对照：字体包 src/client.js 不在扫描面内判红（冻结入口缺锚即红）',
  fontsCoverageProblems(mkFontsPkg(), [{ abs: join(ROOT, 'packages', 'fonts', 'src', 'fontset-store.js'), text: '' }]).some((s) => /冻结的浏览器半边入口/.test(s)));
check('负对照：字体包名漂移（packages 下找不到）判红，不回落到"0 违反"',
  fontsCoverageProblems(null, []).some((s) => /包名漂移/.test(s)));
check('负对照：服务名对账在 hostServiceName=null 时整体关闸（不误报旧口径输入）',
  purityViolations(mk([{ rel: 'lib/index.js', text: "export function apply() {}\n" }], { hostServiceName: null })).length === 0);

if (failed) { console.log('SUBPACKAGE PURITY CHECKS FAILED -- ' + failed + ' failed'); process.exit(1); }
console.log('ALL SUBPACKAGE PURITY CHECKS PASSED');
process.exit(0);
