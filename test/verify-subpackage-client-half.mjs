#!/usr/bin/env node
/**
 * verify-subpackage-client-half.mjs -- BUNDLE-SPLIT 7.6(2) 浏览器半边在场（P-A 子包族）
 *
 * 故障形态（2.2 + C2）：浏览器半边只能被"活动的 Loader 行"发现 -- 行不在某个已选中 bundle 的
 * patch 里、或包没有 dsh.client / exports["./client"] 时，客户端拿不到那份代码，宿主不报任何错。
 *
 * 范围（lead 裁定）：对**声明了 dsh.client** 的子包逐项检查；另外有一张**必被覆盖**棘轮清单
 * （P-C 契约 §1：字体包从"明确排除"改为必被覆盖）。清单里没声明 dsh.client 的包**判红**，
 * 不再走"集合为空就通过"的静默路径。有浏览器半边但没声明 dsh.client 的包只做**信息行**
 * （"停在主 bundle"），不算违反 —— 除非它在必被覆盖清单里（那时上面那条直接判红）。
 *
 * 每个声明 dsh.client 的包要求四面对齐：
 *   1. dsh.client 形状与根 package.json 的 dsh.client 一致（web / immediately / 同键集）。
 *   2. exports["./client"] 必须指向 packages/<pkg>/lib/client.<short>.js
 *      （<short> = 包名去掉 dsh-plugin-wallpaper-engine- 前缀）。
 *   3. 该产物存在、非空，且文件头里注册 window.__ModuleLoader__.load({ id: "<子包真实包名>" })。
 *   4. 该 id 只出现在恰好一个产物里，且根产物 lib/client.js 里不出现（③④）。
 *   5. 该包的行（name = 真实包名）必须被根 cordis.patch.yml 插入。
 *   6. **产物里必须真的发出构建期那一行** require("<主包名>")（P-C 契约 §2：浏览器半边唯一
 *      跨包通道；只有 __ModuleLoader__ 注册、没有这一行 = 产物的键集是空的）。放行面在
 *      test/verify-subpackage-purity.mjs 逐字对账（判据只认这一处 require）。
 * 产物缺失时的报错必须提示"先跑 npm run build"（verify 组单独跑时没有产物），不许静默通过。
 * 负对照全部在内存里喂纯函数 clientHalfViolations()。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './tools/js-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHORT_PREFIX = 'dsh-plugin-wallpaper-engine-';
let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n      ' + detail : '')); }
}
const isFile = (abs) => { try { return statSync(abs).isFile(); } catch { return false; } };
const isDir = (abs) => { try { return statSync(abs).isDirectory(); } catch { return false; } };
const readAbs = (abs) => (isFile(abs) ? readFileSync(abs, 'utf8') : null);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const shortOf = (name) => (name.indexOf(SHORT_PREFIX) === 0 ? name.slice(SHORT_PREFIX.length) : null);

function walkFiles(dir, out) {
  out = out || [];
  if (!isDir(dir)) return out;
  for (const n of readdirSync(dir).sort()) {
    const abs = join(dir, n);
    if (isDir(abs)) { if (n !== 'node_modules' && n !== '.test-cache') walkFiles(abs, out); }
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

function patchRowNames() {
  const out = [];
  for (const line of read('cordis.patch.yml').split('\n')) {
    const m = /^\s*(?:-\s*)?name:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** 全部客户端产物（根 lib/ 与各包 lib/ 下的 client*.js）。 */
function listClientArtifacts(pkgs) {
  const out = {};
  const roots = [join(ROOT, 'lib')];
  for (const p of pkgs) roots.push(join(p.abs, 'lib'));
  for (const abs of roots) {
    if (!isDir(abs)) continue;
    for (const n of readdirSync(abs).sort()) {
      if (!/^client.*\.js$/.test(n)) continue;
      const file = join(abs, n);
      out[relative(ROOT, file).split('\\').join('/')] = readAbs(file) || '';
    }
  }
  return out;
}

/** 产物 text 里是否注册了包 name（注册在文件头，只看前 400 字符）。 */
function registers(text, name) {
  if (typeof text !== 'string') return false;
  const i = text.indexOf('__ModuleLoader__');
  if (i < 0) return false;
  const head = text.slice(i, i + 400);
  for (const q of ['"', "'"]) if (head.indexOf('id: ' + q + name + q) >= 0) return true;
  return new RegExp('id\\s*:\\s*["' + "'" + ']' + name + '["' + "'" + ']').test(head);
}

/** 判据核心（纯函数）。 */
function clientHalfViolations(inp) {
  const bad = [];
  const name = inp.name, dir = inp.dir, manifest = inp.manifest || {};
  const exp = manifest.exports || {};
  const dc = manifest.dsh && manifest.dsh.client;
  // 6) 必被覆盖（P-C 契约 §1 / ADR-0014 S3.1）：清单里的包**不声明 dsh.client 就是违规** ——
  //    必须放在下面的提前返回之前，否则"字体包被明确排除"会静默地一直成立（这正是本轮要堵的洞）。
  const required = Array.isArray(inp.requiredCovered) ? inp.requiredCovered : [];
  if (!dc) {
    if (required.indexOf(dir) >= 0) {
      bad.push(dir + ' 必须声明 dsh.client（P-C 契约 §1 / ADR-0014 S3.1：字体包不再是"明确排除"，'
        + '浏览器半边必须能被活动行发现）');
    }
    return bad;                              // 未声明 dsh.client 且不在清单里的包不在本判据范围内
  }
  const short = shortOf(name);
  // 1) dsh.client 形状与根一致
  if (!inp.rootDshClient) bad.push('根 package.json 没有 dsh.client（基准缺失）');
  else {
    for (const k of Object.keys(inp.rootDshClient)) if (!(k in dc)) bad.push(dir + ' 的 dsh.client 缺键 ' + k);
    if (dc.platform !== 'web') bad.push(dir + ' 的 dsh.client.platform=' + JSON.stringify(dc.platform) + ' 不等于 "web"');
    if (dc.immediately !== true) bad.push(dir + ' 的 dsh.client.immediately=' + JSON.stringify(dc.immediately) + ' 不等于 true');
  }
  // 2) exports["./client"] 落点规则
  const target = typeof exp['./client'] === 'string' ? exp['./client'].replace(/^\.\//, '') : null;
  if (!short) bad.push(name + ' 不是 ' + SHORT_PREFIX + '<short> 形态的包名，无法推导产物名');
  const want = short ? dir + '/lib/client.' + short + '.js' : null;
  if (!target) bad.push(dir + ' 声明了 dsh.client 却没有 exports["./client"]');
  else if (want && dir + '/' + target !== want) bad.push(dir + ' 的 exports["./client"]=' + JSON.stringify(exp['./client']) + '，必须指向 ' + want);
  // 3/4) 产物与注册唯一性
  if (target) {
    const rel = dir + '/' + target;
    const text = Object.prototype.hasOwnProperty.call(inp.artifacts, rel) ? inp.artifacts[rel] : null;
    if (text === null) bad.push(rel + ' 不存在（先跑 npm run build：verify 组单独跑时还没有客户端产物）');
    else if (text.length < 1000) bad.push(rel + ' 只有 ' + text.length + ' 字符（产物像空壳）');
    else if (!registers(text, name)) bad.push(rel + ' 里没有 window.__ModuleLoader__.load({ id: "' + name + '" ... }) 注册（id 必须是子包真实包名）');
    const owners = Object.keys(inp.artifacts).filter((k) => registers(inp.artifacts[k], name));
    if (owners.length > 1) bad.push('包 ' + name + ' 的客户端注册出现在多份产物里：' + owners.join(' / ') + '（只许一份）');
    if (owners.length === 1 && owners[0] !== rel) bad.push('包 ' + name + ' 的客户端注册在 ' + owners[0] + '，而 exports["./client"] 指向 ' + rel);
    if (inp.rootClientRel && rel === inp.rootClientRel) bad.push(dir + ' 的 exports["./client"] 指向根产物 ' + inp.rootClientRel);
    if (inp.rootClientRel && Object.prototype.hasOwnProperty.call(inp.artifacts, inp.rootClientRel)
      && registers(inp.artifacts[inp.rootClientRel], name)) bad.push('根产物 ' + inp.rootClientRel + ' 里也注册了 ' + name + '（同一份浏览器半边不许内联两处）');
  }
  // 3b) 构建期那一行（P-C 契约 §2）：产物必须真的 require 主包 —— 只看非空且非空壳的产物，
  //     免得同一条缺陷被"像空壳"重复报两次。
  const artRel = target ? dir + '/' + target : null;
  const artText = (artRel && Object.prototype.hasOwnProperty.call(inp.artifacts, artRel)) ? inp.artifacts[artRel] : null;
  if (artRel && typeof artText === 'string' && artText.length >= 1000) {
    const rootEsc = String(inp.rootName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bound = new RegExp('require\\s*\\(\\s*[\'"]' + rootEsc + '[\'"]\\s*\\)').test(stripComments(artText));
    if (!bound) {
      bad.push(artRel + ' 里没有构建期的主包绑定 require("' + inp.rootName + '")'
        + '（P-C 契约 §2 / ADR-0014 S5.2：浏览器半边唯一跨包通道；产物由 npm run build 发出，勿手改）');
    }
  }
  // 5) 行必须被根 patch 插入
  if (!inp.rowNames.includes(name)) bad.push('主 patch（' + inp.rootName + ' 的 cordis.patch.yml）里没有 name: "' + name + '" 的行 => 2.2 静默失效');
  return bad;
}

// ---------------------------------------------------------------------------
const rootPkg = JSON.parse(read('package.json'));
const rootName = rootPkg.name;
const rootDshClient = (rootPkg.dsh && rootPkg.dsh.client) || null;
const rootClientRel = rootPkg.exports && typeof rootPkg.exports['./client'] === 'string'
  ? rootPkg.exports['./client'].replace(/^\.\//, '') : null;
const pkgs = discoverSubpackages();
const rowNames = patchRowNames();
const artifacts = listClientArtifacts(pkgs);
const usable = pkgs.filter((p) => p.manifest && !p.error);
check('packages/ 下至少有一个子包（P-A 未落判红）', pkgs.length > 0, pkgs.map((p) => p.dir).join(' / '));
check('每个子包 manifest 可解析', usable.length === pkgs.length, pkgs.filter((p) => p.error).map((p) => p.dir + '：' + p.error).join('；'));

// P-C 契约 §1 / ADR-0014 S3.1：字体包的浏览器半边**不再是"明确排除"**，而是必被覆盖。
// 棘轮（有意硬编码）：这张清单只许随契约显式改动；每个包名都必须在 packages/ 下命中真实目录，
// 否则改名/搬家会让棘轮**静默失效**（判据变成恒真）—— 命中 0 处即红。
const REQUIRED_CLIENT_HALF = ['dsh-plugin-wallpaper-engine-fonts'];

const requiredDirs = [];
for (const n of REQUIRED_CLIENT_HALF) {
  const p = usable.find((u) => u.manifest.name === n);
  requiredDirs.push(p ? p.dir : null);
}
check('必被覆盖清单（' + REQUIRED_CLIENT_HALF.length + ' 个包）在 packages/ 下逐名命中（0 处即红，防棘轮静默失效）',
  requiredDirs.every(Boolean),
  REQUIRED_CLIENT_HALF.map((n, i) => n + ' -> ' + (requiredDirs[i] || '未命中')).join('；'));
const requiredDeclared = [];
for (const n of REQUIRED_CLIENT_HALF) {
  const p = usable.find((u) => u.manifest.name === n);
  if (!p) continue;
  if (!(p.manifest.dsh && p.manifest.dsh.client)) requiredDeclared.push(p.dir + '（' + n + '）');
}
check('必被覆盖清单里的包都声明了 dsh.client（P-C 契约 §1：字体包从"明确排除"改为必被覆盖）',
  requiredDeclared.length === 0,
  requiredDeclared.join('；') + ' 没有声明 dsh.client => 浏览器半边不会被活动行发现（ADR-0014 S3.1）；'
  + '落地面 = packages/fonts/package.json 的 dsh.client + exports["./client"] + lib/client.fonts.js');

const declared = [], browserHalfNoDecl = [];
for (const p of usable) {
  const half = [];
  for (const abs of walkFiles(join(p.abs, 'src')).concat(walkFiles(join(p.abs, 'lib')))) {
    const t = readAbs(abs);
    if (t && /\b(?:window|document)\b/.test(stripComments(t))) half.push(relative(ROOT, abs).split('\\').join('/'));
  }
  const has = !!(p.manifest.dsh && p.manifest.dsh.client);
  if (has) declared.push({ name: p.manifest.name, dir: p.dir, manifest: p.manifest, browserHalf: half, artifacts, rowNames, rootName, rootClientRel, rootDshClient, requiredCovered: requiredDirs.filter(Boolean) });
  else if (half.length > 0) browserHalfNoDecl.push({ name: p.manifest.name, text: p.manifest.name + '（' + half.length + ' 个文件，留在主 bundle）' });
}
if (declared.length === 0) {
  console.log('    · 声明 dsh.client 的子包 0 个（P-A 范围）-> 本判据无对象，通过');
} else {
  const real = [];
  for (const i of declared) for (const v of clientHalfViolations(i)) real.push(v);
  check('声明 dsh.client 的 ' + declared.length + ' 个子包：声明面 <-> 落点 <-> 产物（含构建期主包绑定）<-> 主 patch 行 四面对齐', real.length === 0, real.join('\n      '));
}
if (browserHalfNoDecl.length > 0) console.log('    · 有浏览器半边但未声明 dsh.client（不算违反，P-B/P-C 再迁）：' + browserHalfNoDecl.map((x) => x.text).join(' / '));
// 必被覆盖清单与"停在主 bundle"信息行互为反向：清单里的包若出现在信息行里，上面那条已经判红；
// 这里再显式钉一次，免得两个触点将来分叉（一个红一个只打信息）。
check('必被覆盖清单里的包不出现在"有浏览器半边但停在主 bundle"信息行里（两个触点同向）',
  !browserHalfNoDecl.some((x) => REQUIRED_CLIENT_HALF.indexOf(x.name) >= 0),
  browserHalfNoDecl.map((x) => x.text).join(' / ') || '（信息行为空）');

// -- 负对照 ------------------------------------------------------------------
const okDshClient = rootDshClient || { platform: 'web', immediately: true, inject: [] };
const PAD = '/* pad */'.repeat(200);
const mkIn = (over) => {
  const o = {
    name: 'dsh-plugin-wallpaper-engine-fx', dir: 'packages/fx',
    manifest: { name: 'dsh-plugin-wallpaper-engine-fx', dsh: { client: JSON.parse(JSON.stringify(okDshClient)) }, exports: { './client': './lib/client.fx.js' } },
    rowNames: [rootName, 'dsh-plugin-wallpaper-engine-fx'],
    rootName,
    artifacts: {
      // 基准产物 = 真产物形状：__ModuleLoader__ 注册 + 构建期那一行 require("<主包名>")。
      'packages/fx/lib/client.fx.js': 'window.__ModuleLoader__.load({ id: "dsh-plugin-wallpaper-engine-fx", factory: (require) => { const host = require("' + rootName + '"); return { host }; } });' + PAD,
      'lib/client.js': 'window.__ModuleLoader__.load({ id: "' + rootName + '", factory: () => {} });',
    },
    rootClientRel: 'lib/client.js', rootDshClient,
  };
  if (over) over(o);
  return o;
};
const baseline = clientHalfViolations(mkIn());
check('负对照基准：正确形态（声明/落点/产物/行/构建期绑定）0 违反项', baseline.length === 0, JSON.stringify(baseline));
const neg = (label, mutate, expectRe) => {
  const v = clientHalfViolations(mkIn(mutate));
  check('负对照：' + label, v.some((s) => expectRe.test(s)), '违反项=' + JSON.stringify(v));
};
neg('声明了 dsh.client 但产物没构建（缺产物文案要提示先跑 build）', (o) => { o.artifacts = { 'lib/client.js': mkIn().artifacts['lib/client.js'] }; }, /先跑 npm run build/);
neg('exports["./client"] 落点不对判红', (o) => { o.manifest.exports['./client'] = './lib/client.js'; delete o.artifacts['packages/fx/lib/client.fx.js']; }, /必须指向|不存在/);
neg('产物里没有该包 id 的注册判红', (o) => { o.artifacts['packages/fx/lib/client.fx.js'] = 'window.__ModuleLoader__.load({ id: "somebody-else" });' + PAD; }, /注册/);
neg('产物像空壳判红', (o) => { o.artifacts['packages/fx/lib/client.fx.js'] = 'window.__ModuleLoader__.load({ id: "dsh-plugin-wallpaper-engine-fx" });'; }, /产物像空壳/);
neg('同一注册出现两份判红', (o) => { o.artifacts['lib/client.fx.bis.js'] = mkIn().artifacts['packages/fx/lib/client.fx.js']; }, /多份产物/);
neg('根产物里也注册了同一个包判红', (o) => { o.artifacts['lib/client.js'] = mkIn().artifacts['packages/fx/lib/client.fx.js']; }, /内联两处|多份产物/);
neg('主 patch 里没有该行判红', (o) => { o.rowNames = [rootName]; }, /没有 name/);
neg('dsh.client 缺根里的键判红', (o) => { delete o.manifest.dsh.client.inject; }, /缺键/);
// P-C 契约 §2：产物里少了构建期那一行 ⇒ 键集为空，必须判红（放行面见 verify-subpackage-purity.mjs）。
neg('产物里没有构建期的主包绑定 require("<主包名>") 判红', (o) => {
  o.artifacts['packages/fx/lib/client.fx.js'] = 'window.__ModuleLoader__.load({ id: "dsh-plugin-wallpaper-engine-fx", factory: (require) => { return {}; } });' + PAD;
}, /构建期的主包绑定/);
check('负对照：产物里有那一行就 0 违反（同一判据的两向都测）',
  !clientHalfViolations(mkIn()).some((s) => /构建期的主包绑定/.test(s)));
// P-C 契约 §1：必被覆盖清单是反向棘轮 —— 声明被删掉时**必须**报红，不许回落到"范围外 0 违反"。
check('负对照：必被覆盖的包没声明 dsh.client 判红（棘轮有牙）',
  clientHalfViolations(mkIn((o) => { o.requiredCovered = ['packages/fx']; delete o.manifest.dsh.client; })).some((s) => /必须声明 dsh.client/.test(s)));
check('负对照：未声明 dsh.client 的包不产生任何违反项（范围外）',
  clientHalfViolations(mkIn((o) => { delete o.manifest.dsh.client; })).some((s) => /必须声明 dsh.client/.test(s)) === false);
check('负对照：清单外的包声明了 dsh.client 也不额外报"必须声明"',
  !clientHalfViolations(mkIn()).some((s) => /必须声明 dsh.client/.test(s)));

if (failed) { console.log('SUBPACKAGE CLIENT-HALF CHECKS FAILED -- ' + failed + ' failed'); process.exit(1); }
console.log('ALL SUBPACKAGE CLIENT-HALF CHECKS PASSED');
process.exit(0);
