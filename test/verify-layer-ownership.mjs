#!/usr/bin/env node
/**
 * verify-layer-ownership.mjs -- P-D S4：壁纸层所有权收口（ADR-0013 D12 / ADR-0013 D12 / §13 风险 9）
 *
 * 背景（为什么需要这条守卫）：
 *   壁纸层是**进程内单例 DOM 节点**，靠固定 id 相互引用：
 *     `#dsh-wallpaper-engine-layer`（src/client.js `LAYER_ID`，壁纸层，含 iframe/video/img 子树）、
 *     `#dsh-wallpaper-engine-scrim`（src/client.js `SCRIM_ID`，可读性暗化层）。
 *   P-D 要把渲染半边搬进 `packages/media-bridge`，最大的结构性风险不是"搬不动"，而是**搬出第二份
 *   层生命周期**：两个半边各建一次层 = 同 id 两节点、各自退役 = 一个半边拆的层另一个还在引用；
 *   这正是 ADR-0013 D12（层/iframe 单例 id 撞车）写下的后果。S4 的口径（task-12）：
 *   **层所有权 = 主包渲染内核独占，子包不得建层/退层/持层引用；零行为改动，只钉判据与注释。**
 *
 * 四条判据（P1–P4，全部先红后绿；每条都在内存里带负对照，负对照不落盘）：
 *   P1 层单例声明：`LAYER_ID` / `SCRIM_ID` 在**源码面**（src/ + packages/<pkg>/src/，不含构建产物）
 *      恰各声明 1 处，且钉在 `src/client.js`；`id =` 赋值只许出现在 `src/live-layer.js`
 *      （当前 4 处：obtainLayerNode 建层 / 领养、syncScrimElement 建 scrim、:399 领养回写）；
 *      字面量 id 串只许出现在声明行；子包源码面零引用这两个标识符。
 *   P2 body 挂载白名单：`document.body.appendChild(` 的每个点都必须在白名单里、且**逐点归属**
 *      （壁纸层 / scrim / 轮换 staging / 场景音轨 / 一次性 input 与下载 a / rope dock / 子包自有宿主）。
 *      白名单外的写入判红；`lib/routes/**` 与"壁纸层族"（we-layer / we-live-iframe / we-scrim）
 *      在子包里出现判红；子包自有宿主必须**同包成对拆除**（否则就是卸载残留）。
 *   P3 拆卸零残留：从 `src/client.js` 的 fiber cleanup（`return () => { disposed = true; … }`）里
 *      静态核对"先 release 后 remove / scrim 摘净 / 退役渐变层先于停看护 / 每层 hooks.dispose"，
 *      再把这**段真源码**在 mini mock DOM 上执行，断言 `#layer`、`#scrim`、iframe 全部不可从
 *      `document.body` 到达；负对照 = 删 scrim 摘除 / 把 remove 换成 display:none / 调换顺序，
 *      三种变异都必须让同一个判据函数变红。
 *   P4 iframe 父链：iframe 创建点恰 5 处（3 文件），创建函数体内**不得**出现
 *      `document.body.appendChild`；`buildMedia`/`createLiveFrame`/`rebuildLiveFrame` 不得 append
 *      iframe；两条 staging 探测函数必须建 `we-layer--staging` 容器再 `div.appendChild(f)`；
 *      数据流式兜底：任何 `iframeVar` 都不许被 `document.body.appendChild(...)` 直接挂到 body。
 *
 * 写面：本文件只读 `src/` 与 `packages/<pkg>/src/`（源码面），**不读构建产物**（lib/client.js 是
 * 派生物，读它等于把同一判据判两遍，且会逼着守卫在"没 build"时也红）。唯一写盘动作是自检用的
 * `--write-fixture` 之外不存在：本守卫无写盘分支。
 *
 * 判据分档（ADR-0004）：hard。它守的是"两半边各建一层"这类**用户会撞上**的失效（壁纸层永远
 * 停在上一张 / 关掉插件层不撤），不是仓库内务。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankStringLiterals, functionBodyOf, stripComments } from './tools/js-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n      ' + detail : '')); }
}
/** 负对照：给定变异源码/变异函数必须**被判据判红**；判红文案需命中 `expect`。 */
function negOk(name, ok, detail) {
  check('负对照：' + name, ok, detail);
}

// ── 源码面快照（唯一真源 = 盘上源码；不读产物） ───────────────────────────────
const isDir = (abs) => { try { return statSync(abs).isDirectory(); } catch { return false; } };
const relOf = (abs) => relative(ROOT, abs).split(sep).join('/');

function walkJs(dir, out) {
  out = out || [];
  if (!isDir(dir)) return out;
  for (const n of readdirSync(dir).sort()) {
    const abs = join(dir, n);
    if (isDir(abs)) { if (n !== 'node_modules' && n !== '.test-cache') walkJs(abs, out); }
    else if (/\.js$/.test(n)) out.push(abs);
  }
  return out;
}

function loadSourceSurface() {
  const files = [];
  for (const abs of walkJs(join(ROOT, 'src'))) files.push({ rel: relOf(abs), text: readFileSync(abs, 'utf8') });
  const pkgRoot = join(ROOT, 'packages');
  if (isDir(pkgRoot)) {
    for (const n of readdirSync(pkgRoot).sort()) {
      const dir = join(pkgRoot, n);
      if (!isDir(dir)) continue;
      for (const abs of walkJs(join(dir, 'src'))) files.push({ rel: relOf(abs), text: readFileSync(abs, 'utf8') });
    }
  }
  return files;
}

const SRC = loadSourceSurface();
const codeOf = (f) => stripComments(f.text);
const codeNoStrings = (f) => blankStringLiterals(stripComments(f.text), () => true);
const lineOfIndex = (text, index) => text.slice(0, index).split('\n').length;
const fileOf = (rel) => SRC.find((f) => f.rel === rel) || null;

// ── 覆盖面地板（防空扫描"真空为真"）────────────────────────────────────────────
const SRC_FILES = SRC.filter((f) => f.rel.startsWith('src/'));
const PKG_FILES = SRC.filter((f) => f.rel.startsWith('packages/'));
const FLOOR_SRC_FILES = 60;
const FLOOR_PKG_FILES = 15;
const REQUIRED_SRC = ['src/client.js', 'src/live-layer.js', 'src/media-prep.js', 'src/layer-core.js'];

check('扫描面非空：src 面 ' + SRC_FILES.length + ' 个 .js（地板 ' + FLOOR_SRC_FILES + '）、packages/<pkg>/src 面 '
  + PKG_FILES.length + ' 个（地板 ' + FLOOR_PKG_FILES + '）',
  SRC_FILES.length >= FLOOR_SRC_FILES && PKG_FILES.length >= FLOOR_PKG_FILES,
  'src=' + SRC_FILES.length + ' packages=' + PKG_FILES.length);
const missingRequired = REQUIRED_SRC.filter((rel) => !fileOf(rel));
check('冻结锚点文件都在扫描面内：' + REQUIRED_SRC.join(' / '), missingRequired.length === 0, '缺 ' + missingRequired.join(', '));

// ══ P1 层单例声明 ════════════════════════════════════════════════════════════
const LAYER_LITERALS = { LAYER_ID: 'dsh-wallpaper-engine-layer', SCRIM_ID: 'dsh-wallpaper-engine-scrim' };

/** @returns {{rel:string,line:number,id:string,literal:string}[]} */
function declarationsOf(files) {
  const out = [];
  for (const f of files) {
    const lines = stripComments(f.text).split(/\r?\n/);
    lines.forEach((ln, i) => {
      const m = /^\s*(?:const|let|var)\s+(LAYER_ID|SCRIM_ID)\s*=\s*["']([^"']*)["']\s*;?\s*$/.exec(ln);
      if (m) out.push({ rel: f.rel, line: i + 1, id: m[1], literal: m[2] });
    });
  }
  return out;
}

/** @returns {{rel:string,line:number,literal:string}[]} */
function literalIdSites(files) {
  const out = [];
  for (const f of files) {
    const lines = stripComments(f.text).split(/\r?\n/);
    lines.forEach((ln, i) => {
      const m = /["'](dsh-wallpaper-engine-(?:layer|scrim))["']/.exec(ln);
      if (m) out.push({ rel: f.rel, line: i + 1, literal: m[1] });
    });
  }
  return out;
}

/** `X.id = LAYER_ID` 形式的赋值点。 */
function idAssignmentSites(files) {
  const out = [];
  for (const f of files) {
    const code = stripComments(f.text);
    const re = /\.id\s*=\s*(LAYER_ID|SCRIM_ID)\b/g;
    let m;
    while ((m = re.exec(code)) !== null) out.push({ rel: f.rel, line: lineOfIndex(code, m.index), id: m[1] });
  }
  return out;
}

const decls = declarationsOf(SRC);
const byId = (id) => decls.filter((d) => d.id === id);
const declLayer = byId('LAYER_ID');
const declScrim = byId('SCRIM_ID');
// ⚠️ 这两条原本把行号钉死（`:63` / `:64`，后来 `:123` / `:124`）—— 每次在常量上方
// 增删一行代码就要来改锚点，是**纯维护噪音**，且改晚了链直接红（本项目已发生过三次）。
// 现在改钉"**唯一且落在 src/client.js**"这一不变式：位置无关，语义不减
// （真正要防的是"第二个声明点"和"字面量散落"，不是它排第几行）。
check('P1.1 LAYER_ID 声明恰 1 处（src/client.js）',
  declLayer.length === 1 && declLayer[0].rel === 'src/client.js'
    && declLayer[0].literal === LAYER_LITERALS.LAYER_ID,
  JSON.stringify(declLayer));
check('P1.2 SCRIM_ID 声明恰 1 处（src/client.js）',
  declScrim.length === 1 && declScrim[0].rel === 'src/client.js'
    && declScrim[0].literal === LAYER_LITERALS.SCRIM_ID,
  JSON.stringify(declScrim));

const litSites = literalIdSites(SRC);
const litLayer = litSites.filter((s) => s.literal === LAYER_LITERALS.LAYER_ID);
const litScrim = litSites.filter((s) => s.literal === LAYER_LITERALS.SCRIM_ID);
check('P1.3 层 id 字面量只在声明行出现（其它地方一律引用 LAYER_ID / SCRIM_ID）',
  litLayer.length === 1 && litLayer[0].rel === 'src/client.js'
    && litScrim.length === 1 && litScrim[0].rel === 'src/client.js',
  'layer=' + JSON.stringify(litLayer) + ' scrim=' + JSON.stringify(litScrim));

const assignSites = idAssignmentSites(SRC);
const assignElsewhere = assignSites.filter((s) => s.rel !== 'src/live-layer.js');
check('P1.4 `id = LAYER_ID / SCRIM_ID` 赋值只许在 src/live-layer.js（当前 '
  + assignSites.length + ' 处：' + assignSites.map((s) => s.rel + ':' + s.line + ' ' + s.id).join(', ') + '）',
  assignSites.length === 4 && assignElsewhere.length === 0,
  '越界=' + JSON.stringify(assignElsewhere));
check('P1.5 不存在 setAttribute("id", LAYER_ID / SCRIM_ID) 的第二条赋值路',
  assignSites.length === 4 && !/setAttribute\(\s*["']id["']\s*,\s*(?:LAYER_ID|SCRIM_ID)/.test(SRC.map(codeOf).join('\n')));

const pkgLayerRefs = PKG_FILES
  .filter((f) => /\b(?:LAYER_ID|SCRIM_ID)\b/.test(codeNoStrings(f)))
  .map((f) => f.rel);
check('P1.6 子包源码面零引用 LAYER_ID / SCRIM_ID（层引用不外流）',
  pkgLayerRefs.length === 0, '命中 ' + pkgLayerRefs.join(', '));

// ══ P2 document.body 挂载白名单 ══════════════════════════════════════════════
/**
 * 白名单 = 唯一真源。每项：文件 → { count, owner }。
 * 归属判据（为什么是"渲染内核 only"）：
 *   · 壁纸层 / scrim：层生命周期的唯一所有者是主包实时渲染内核（live-layer.js）；
 *   · 轮换 staging 容器：轮换准备期把"未提交的层"提前挂进 DOM（media-prep.js），commit 时整体
 *     转为新层 —— 它也是层生命周期的一部分，同样归主包；
 *   · 场景音轨 <audio> / 一次性 <input type=file> / 下载 <a> / rope dock 宿主：与壁纸层无关的
 *     主包界面/音频宿主，各自成对拆除；
 *   · 子包自有宿主（fx 特效 overlay、pet-link 调参面板）：**不是**壁纸层，条件是 id/类名自持、
 *     不碰 we-layer / we-live-iframe / we-scrim，且同包内有成对拆除。
 */
const BODY_MOUNT_WHITELIST = Object.freeze({
  'src/live-layer.js': { count: 2, owner: 'layer+scrim' },
  'src/media-prep.js': { count: 1, owner: 'rotation-staging' },
  'src/media-prep/probe.js': { count: 1, owner: 'rotation-staging' },
  'src/client/audio-playback.js': { count: 1, owner: 'scene-audio' },
  'src/client.js': { count: 3, owner: 'transient-input|download-anchor|rope-dock' },
  'packages/fx/src/fx-layer.js': { count: 1, owner: 'pkg-own-host(fx overlay)' },
});

/** @returns {{rel:string,line:number}[]} */
function bodyAppendSites(files) {
  const out = [];
  for (const f of files) {
    const code = stripComments(f.text);
    const re = /document\.body\.appendChild\(/g;
    let m;
    while ((m = re.exec(code)) !== null) out.push({ rel: f.rel, line: lineOfIndex(code, m.index) });
  }
  return out;
}

/** 纯函数：给定源码快照，返回归属违规（供负对照喂合成源）。 */
function bodyMountViolations(files) {
  const problems = [];
  const sites = bodyAppendSites(files);
  const byFile = new Map();
  for (const s of sites) byFile.set(s.rel, (byFile.get(s.rel) || []).concat(s));
  for (const [rel, hits] of byFile) {
    const wl = BODY_MOUNT_WHITELIST[rel];
    if (!wl) { problems.push(rel + ': ' + hits.map((h) => ':' + h.line).join(',') + ' 不在 body 挂载白名单（属于主包渲染内核之外）'); continue; }
    if (hits.length !== wl.count) problems.push(rel + ' 挂载点 ' + hits.length + ' 个，白名单记 ' + wl.count + ' 个（逐点归属已漂移）');
  }
  for (const rel of Object.keys(BODY_MOUNT_WHITELIST)) {
    if (!byFile.has(rel)) problems.push(rel + ' 白名单登记了 ' + BODY_MOUNT_WHITELIST[rel].count + ' 个挂载点，实测 0 个（白名单过期）');
  }
  // 路由族（服务端）不得持有 DOM 挂载。
  for (const f of files) {
    if (!f.rel.startsWith('lib/routes/')) continue;
    if (/document\./.test(blankStringLiterals(stripComments(f.text), () => true))) problems.push(f.rel + ' 路由族出现 document 挂载面');
  }
  // 子包自有宿主：必须同包成对拆除，且绝不**建/摘**壁纸层族节点。
  // 只读引用（querySelector('.we-scrim') 之类，用于给自有浮层排层序）不算越界 —— 它没有所有权，
  // 也不会在卸载时跟层抢同一个节点；把查询调用整个抹掉后再扫类名。
  for (const f of files) {
    if (!f.rel.startsWith('packages/') || !/document\.body\.appendChild\(/.test(stripComments(f.text))) continue;
    const pkgDir = f.rel.split('/').slice(0, 2).join('/');
    const samePkg = files.filter((x) => x.rel.startsWith(pkgDir + '/'));
    const removalForm = samePkg.some((x) => /\.remove\(\)|removeChild\(/.test(stripComments(x.text)));
    if (!removalForm) problems.push(f.rel + ' 子包自有 body 宿主没有同包成对拆除（卸载会留节点）');
  }
  // 子包不许**建/改**壁纸层族节点的身份（id/类名），但**读取/定位**它们是既有契约：
  //   · parallax 用 `.we-layer, .we-rope` 选择器给层写 translate（只读定位 + 改 transform，不改身份）；
  //   · fx 用 querySelector('.we-scrim') 算浮层层序。
  // 所以这里只抓"身份写入"三种形态：className 赋 we-layer、classList.add/toggle 加层族类名、
  // 以及 `id = LAYER_ID`（P1.4 已单独抓）。选择器字符串里的类名不算。
  for (const f of files) {
    if (!f.rel.startsWith('packages/')) continue;
    const code = stripComments(f.text);
    const classWrite = [
      /className\s*=\s*["'][^"']*\bwe-layer\b/,
      /className\s*=\s*["'][^"']*\bwe-(?:live-iframe|scrim)\b/,
      /classList\.(?:add|toggle|replace)\(\s*["'][^"']*\bwe-(?:layer|live-iframe|scrim)\b/,
    ].find((re) => re.test(code));
    if (classWrite) {
      problems.push(f.rel + ' 子包源码面**写**了壁纸层族类名（we-layer / we-live-iframe / we-scrim 的身份只能由主包建）');
    }
  }
  return problems;
}

const bodyProblems = bodyMountViolations(SRC);
check('P2.1 document.body 挂载白名单逐点归属（' + bodyAppendSites(SRC).length + ' 个点 / '
  + Object.keys(BODY_MOUNT_WHITELIST).length + ' 个文件，归属：'
  + Object.entries(BODY_MOUNT_WHITELIST).map(([r, w]) => r + '=' + w.owner).join(' · ') + '）',
  bodyProblems.length === 0, bodyProblems.join('\n      '));

// 负对照：白名单外新增一个挂载点 ⇒ 红。
{
  const mutated = SRC.concat([{ rel: 'src/video-layer.js', text: 'function x(){ document.body.appendChild(document.createElement("div")); }' }]);
  const problems = bodyMountViolations(mutated);
  negOk('白名单外的新 body 挂载点判红', problems.some((p) => /src\/video-layer\.js.*白名单/.test(p)), problems.join(' | '));
  const pkgHost = bodyMountViolations(SRC.concat([{
    rel: 'packages/parallax/src/bad-host.js',
    text: 'function h(){ const el = document.createElement("div"); document.body.appendChild(el); }',
  }]));
  negOk('子包新增 body 宿主但无成对拆除判红', pkgHost.some((p) => /成对拆除/.test(p)), pkgHost.join(' | '));
  const pkgLayer = bodyMountViolations(SRC.concat([{
    rel: 'packages/parallax/src/bad-host.js',
    text: 'function h(){ const el = document.createElement("div"); el.className = "we-layer"; document.body.appendChild(el); }\nfunction d(){ el.remove(); }',
  }]));
  negOk('子包源码面碰壁纸层族类名判红', pkgLayer.some((p) => /壁纸层族/.test(p)), pkgLayer.join(' | '));
  const routes = bodyMountViolations(SRC.concat([{ rel: 'lib/routes/diag.js', text: 'export function x(){ document.body.appendChild({}); }' }]));
  negOk('路由族持有 body 挂载判红', routes.some((p) => /路由族/.test(p)), routes.join(' | '));
}

// ══ P3 拆卸零残留 ════════════════════════════════════════════════════════════
/** 从 src/client.js 里取出 fiber cleanup（唯一一段 `return () => { disposed = true; … }`）。 */
function extractCleanup(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*return \(\) => \{\s*$/.test(lines[i])) continue;
    if (!/disposed = true;/.test(lines[i + 1] || '')) continue;
    let depth = 1;
    for (let j = i + 1; j < lines.length; j++) {
      const skeleton = blankStringLiterals(stripComments(lines[j]), () => true);
      for (const ch of skeleton) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth <= 0) return { startLine: i + 1, endLine: j + 1, body: lines.slice(i + 1, j).join('\n') };
    }
  }
  return null;
}

/** 静态判据：cleanup 里"先 release 后 remove / scrim 摘净 / 退役先于停看护 / 每层 hooks.dispose"。 */
function cleanupStaticViolations(cleanupBody) {
  const code = stripComments(cleanupBody);
  const problems = [];
  const must = [
    ['releaseLayerMedia(node)', /releaseLayerMedia\(\s*node\s*\)/],
    ['node.remove()', /node\.remove\(\)/],
    ['getElementById(SCRIM_ID) + scrim.remove()', /getElementById\(\s*SCRIM_ID\s*\)[\s\S]{0,160}?\.remove\(\)/],
    ['getElementById(LAYER_ID)', /getElementById\(\s*LAYER_ID\s*\)/],
    ['retireFadingLayer()', /retireFadingLayer\(\)/],
    ['stopLiveWatch()', /stopLiveWatch\(\)/],
    ['cancelLiveMount("unload")', /cancelLiveMount\(\s*"unload"\s*\)/],
    ['abortTranscodeUpgrade()', /abortTranscodeUpgrade\(\)/],
    ['weStopDraw()', /weStopDraw\(\)/],
    ['每层 hooks.dispose()', /weLayerHooks\(\)[\s\S]{0,160}?\.dispose\(\)/],
  ];
  for (const [label, re] of must) if (!re.test(code)) problems.push('cleanup 缺 ' + label);
  const idxRelease = code.indexOf('releaseLayerMedia(node)');
  const idxRemove = code.indexOf('node.remove()');
  if (idxRelease >= 0 && idxRemove >= 0 && !(idxRelease < idxRemove)) problems.push('cleanup 顺序错：releaseLayerMedia(node) 必须在 node.remove() 之前（先摘媒体再摘节点）');
  const idxRetire = code.indexOf('retireFadingLayer()');
  const idxStopWatch = code.indexOf('stopLiveWatch()');
  if (idxRetire >= 0 && idxStopWatch >= 0 && !(idxRetire < idxStopWatch)) problems.push('cleanup 顺序错：retireFadingLayer() 必须先于 stopLiveWatch()（否则渐变中的旧层没人退役）');
  return problems;
}

/** mini mock DOM：只实现 cleanup 用到的面（appendChild、remove、byId、querySelector）。 */
function makeMockDom() {
  const byId = new Map();
  const log = [];
  const makeEl = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      dataset: {},
      style: {},
      id: '',
      appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        el.children.push(c);
        c.parentNode = el;
        if (c.id) byId.set(c.id, c);
        return c;
      },
      removeChild(c) {
        const i = el.children.indexOf(c);
        if (i >= 0) el.children.splice(i, 1);
        if (c.parentNode === el) c.parentNode = null;
        if (c.id && byId.get(c.id) === c) byId.delete(c.id);
        return c;
      },
      remove() {
        log.push('remove:' + (el.id || el.tagName));
        if (el.parentNode) el.parentNode.removeChild(el);
        if (el.id && byId.get(el.id) === el) byId.delete(el.id);
        el.removed = true;
      },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      get isConnected() { return Boolean(el.parentNode); },
    };
    return el;
  };
  const body = makeEl('body');
  const doc = {
    body,
    createElement: makeEl,
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    documentElement: { style: {} },
    head: { appendChild() {} },
    hidden: false,
  };
  return { doc, body, byId, log, makeEl };
}

const containsDeep = (root, target) => {
  if (root === target) return true;
  for (const c of root.children || []) if (containsDeep(c, target)) return true;
  return false;
};

/**
 * 行为判据：在 mock DOM 上执行**真 cleanup 源码**，返回残留违规。
 * 变异输入（删 scrim 摘除 / 换 remove 为隐藏 / 调换顺序）必须让它返回非空。
 */
function teardownViolations(cleanupBody) {
  const problems = [];
  const m = makeMockDom();
  const layer = m.makeEl('div');
  layer.id = LAYER_LITERALS.LAYER_ID;
  m.body.appendChild(layer);
  const frame = m.makeEl('iframe');
  frame.className = 'we-media we-iframe we-live-iframe';
  layer.appendChild(frame);
  const scrim = m.makeEl('div');
  scrim.id = LAYER_LITERALS.SCRIM_ID;
  m.body.appendChild(scrim);
  const scopeMiss = [];
  const real = {
    document: m.doc,
    LAYER_ID: LAYER_LITERALS.LAYER_ID,
    SCRIM_ID: LAYER_LITERALS.SCRIM_ID,
    TAG_ID: 'dsh-wallpaper-engine', CSS_GEN: 'g',
    petLink: { dispose() {} },
    unsub() {}, unsubEffects() {},
    weSetLayerAttacher() {}, weSetRegistryListener() {},
    layerUnsubs: new Map(), ocWatch: 0, urlWatch: 0, ocListeners: [],
    pageShowBound: false, pageHideBound: false, fontPageHideBound: false,
    backVisBound: false, warmBound: false, visBound: false, fontVisBound: false,
    onOcclusionChange() {}, onBackVisible() {}, onClientError() {}, onPageHideFlush() {},
    onPageHideFlushFontSet() {}, onVisibilityResyncPersist() {}, onVisibilityResyncFontSet() {},
    onWarmPointerDown() {}, onWarmPointerOver() {},
    batteryCleanup: null, weBattery: null,
    clearRotationTimer() {}, cancelRotationPrepare() {}, disposePreparedMedia() {}, disposeWarmVideo() {},
    weLayerHooks: () => [], reportClientDiag() {},
    rotationAudioGate: null, retireFadingLayer() {}, stopSceneAudioEl() {},
    cancelLiveFrameBackfill() {}, stopLiveWatch() {}, cancelLiveMount() {},
    abortTranscodeUpgrade() {}, cancelPendingPersist() {}, cancelPendingFontSet() {},
    cancelUserPropsCommit() {},
    // #288：暂停持续期防抖的状态面（cleanup 会成对撤定时器 / 摘标志）。
    applyHiddenHold() {}, hiddenDebounce: 0, hiddenHoldBound: false,
    abortMediaInfoProbe() {}, sceneVideoResyncTimer: null, weStopDraw() {},
    releaseLayerMedia(n) { m.log.push('release'); n.__released = true; },
    clearEffects() {}, setWallpaperActive() {},
    window: { removeEventListener() {}, clearTimeout() {}, setTimeout() {} },
    navigator: {},
  };
  const scope = new Proxy(real, {
    has: () => true,
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      // 标准内建（JSON / Math / Object …）从全局真实取，别把 `with` 环境变成真空世界。
      if (k in globalThis) return globalThis[k];
      scopeMiss.push(String(k));
      return () => {};
    },
    set: () => true,
  });
  try {
    // 与 verify-client.mjs 同款挂载台手法：`with` + 注入 scope，源码是**真 cleanup 段**。
    const run = new Function('__scope', 'with (__scope) {\n' + cleanupBody + '\n}');
    run(scope);
  } catch (err) {
    return ['cleanup 在 mock DOM 上执行抛错：' + String((err && err.message) || err) + '（scope 缺键：' + scopeMiss.join(',') + '）'];
  }
  if (m.byId.has(LAYER_LITERALS.LAYER_ID)) problems.push('#layer 拆卸后仍能被 getElementById 命中（节点没摘/#id 没撤）');
  if (m.byId.has(LAYER_LITERALS.SCRIM_ID)) problems.push('#scrim 拆卸后仍在 byId 里（残留 scrim）');
  if (m.body.children.length !== 0) problems.push('document.body 仍有 ' + m.body.children.length + ' 个子节点（应全部摘净）');
  if (containsDeep(m.body, frame)) problems.push('iframe 仍可从 document.body 到达（层子树没跟着摘）');
  const iRelease = m.log.indexOf('release');
  const iRemove = m.log.indexOf('remove:' + LAYER_LITERALS.LAYER_ID);
  if (iRelease < 0) problems.push('cleanup 没有对 #layer 调 releaseLayerMedia');
  if (iRemove < 0) problems.push('cleanup 没有 remove #layer');
  if (iRelease >= 0 && iRemove >= 0 && !(iRelease < iRemove)) problems.push('运行时顺序错：releaseLayerMedia 晚于 #layer.remove');
  if (scopeMiss.length) problems.push('cleanup 引用了挂载台未供给的键：' + scopeMiss.join(',') + '（源码漂移，补 mock 面）');
  return problems;
}

const clientSrc = fileOf('src/client.js');
check('P3.0 能从 src/client.js 定位到 fiber cleanup 段', clientSrc !== null);
const cleanup = clientSrc ? extractCleanup(clientSrc.text) : null;
check('P3.1 cleanup 段定位成功（return () => { disposed = true; … }）',
  cleanup !== null && cleanup.endLine - cleanup.startLine > 60,
  cleanup ? '行 ' + cleanup.startLine + '–' + cleanup.endLine : 'null');

if (cleanup) {
  const staticProblems = cleanupStaticViolations(cleanup.body);
  check('P3.2 cleanup 静态契约：先 release 后 remove、scrim 摘净、退役先于停看护、逐层 hooks.dispose',
    staticProblems.length === 0, staticProblems.join('\n      '));
  const behaviorProblems = teardownViolations(cleanup.body);
  check('P3.3 cleanup 行为：真源码在 mock DOM 上跑完，#layer/#scrim/iframe 全部不可从 body 到达',
    behaviorProblems.length === 0, behaviorProblems.join('\n      '));

  // ── P3 负对照（三种变异都必须判红；先验证变异真的改到了文本，防"替换没命中 ⇒ 假绿"）──
  const scrimBlock = /const scrim = document\.getElementById\(SCRIM_ID\);\s*\n\s*if \(scrim\) scrim\.remove\(\);/;
  const mutatedScrim = cleanup.body.replace(scrimBlock, '/* scrim removal removed by negative control */');
  negOk('删掉 scrim 摘除段 ⇒ 静态/行为都红',
    mutatedScrim !== cleanup.body
      && cleanupStaticViolations(mutatedScrim).some((p) => /SCRIM_ID|scrim/.test(p))
      && teardownViolations(mutatedScrim).some((p) => /scrim/.test(p)),
    '替换未命中（变异无效）');
  const mutatedHide = cleanup.body.replace('node.remove();', 'node.style.display = "none";');
  negOk('把 #layer 的 remove() 换成 display:none ⇒ 行为判据红（byId 仍命中）',
    mutatedHide !== cleanup.body && teardownViolations(mutatedHide).some((p) => /#layer/.test(p)),
    '替换未命中（变异无效）');
  const iR = cleanup.body.indexOf('releaseLayerMedia(node)');
  const iRM = cleanup.body.indexOf('node.remove()');
  const swapped = iR >= 0 && iRM > iR
    ? cleanup.body.slice(0, iR) + 'node.remove();' + cleanup.body.slice(iR + 'releaseLayerMedia(node)'.length, iRM)
      + 'releaseLayerMedia(node)' + cleanup.body.slice(iRM + 'node.remove()'.length)
    : null;
  negOk('releaseLayerMedia 与 node.remove() 调换顺序 ⇒ 静态顺序判据红',
    swapped !== null && cleanupStaticViolations(swapped).some((p) => /顺序/.test(p)),
    '替换未命中（变异无效）');
  const mutatedRetire = cleanup.body.replace('retireFadingLayer();', '/* retire removed */');
  negOk('删掉 retireFadingLayer() ⇒ 静态判据红（渐变中的旧层没人退役）',
    mutatedRetire !== cleanup.body && cleanupStaticViolations(mutatedRetire).some((p) => /retireFadingLayer|顺序/.test(p)),
    '替换未命中（变异无效）');
}

// ══ P4 iframe 父链 ═══════════════════════════════════════════════════════════
const IFRAME_CREATORS = [
  ['src/live-layer/pointer.js', 'function createLiveFrame(sel)'],
  ['src/live-layer/watch.js', 'function rebuildLiveFrame(frame, watch)'],
  ['src/media-prep/probe.js', 'function prepareWebProbe(w, prep, onReady)'],
  ['src/media-prep.js', 'function prepareSceneLiveStage(w, prep, onReady, onFail)'],
  ['src/media-prep.js', 'function buildMedia(sel)'],
];

function iframeCreateSites(files) {
  const out = [];
  for (const f of files) {
    const code = stripComments(f.text);
    const re = /document\.createElement\(\s*["']iframe["']\s*\)/g;
    let m;
    while ((m = re.exec(code)) !== null) out.push({ rel: f.rel, line: lineOfIndex(code, m.index) });
  }
  return out;
}

/** 纯函数：iframe 创建函数体 + 数据流兜底，返回违规。 */
function iframeViolations(files) {
  const problems = [];
  const sites = iframeCreateSites(files);
  const counts = {};
  for (const s of sites) counts[s.rel] = (counts[s.rel] || 0) + 1;
  const expected = { 'src/live-layer/pointer.js': 1, 'src/live-layer/watch.js': 1, 'src/media-prep/probe.js': 1, 'src/media-prep.js': 2 };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) {
    problems.push('iframe 创建点分布漂移：实测 ' + JSON.stringify(counts) + '，契约 ' + JSON.stringify(expected));
  }
  // 每条创建点必须落在冻结的创建函数里；创建函数体内不得出现 document.body.appendChild。
  for (const [rel, header] of IFRAME_CREATORS) {
    const f = files.find((x) => x.rel === rel);
    if (!f) { problems.push('缺文件 ' + rel); continue; }
    const body = functionBodyOf(stripComments(f.text), header);
    if (body === null) { problems.push(rel + ' 里找不到冻结的创建函数「' + header + '」'); continue; }
    if (!/document\.createElement\(\s*["']iframe["']\s*\)/.test(body)) problems.push(rel + ' 的 ' + header + ' 里没有 iframe 创建点（创建点外流？）');
    // 关键：staging 容器**允许**挂 body（它必须 in-DOM 才能出帧，属 P2 白名单的轮换 staging），
    // 但 **iframe 本身**不许直接挂 body —— 必须先挂进 .we-layer--staging 容器。
    if (/document\.body\.appendChild\(\s*f\s*\)/.test(body)) problems.push(rel + ' 的 ' + header + ' 把 iframe 直接挂到 body（iframe 父链会含 body）');
    if (header === 'function createLiveFrame(sel)' || header === 'function rebuildLiveFrame(frame, watch)') {
      if (/\.appendChild\(/.test(body)) problems.push(rel + ' 的 ' + header + ' 不应 append 任何节点（iframe 由调用方挂进层/staging）');
    }
    if (header === 'function prepareWebProbe(w, prep, onReady)' || header === 'function prepareSceneLiveStage(w, prep, onReady, onFail)') {
      if (!/we-layer--staging/.test(body)) problems.push(rel + ' 的 ' + header + ' 没有 we-layer--staging 容器（iframe 会直接挂到 body）');
      if (!/\bdiv\.appendChild\(f\)/.test(body)) problems.push(rel + ' 的 ' + header + ' 没有 div.appendChild(f)（iframe 必须先挂进 staging 容器）');
    }
    if (header === 'function buildMedia(sel)') {
      if (/\bmedia\.appendChild\(/.test(body)) problems.push(rel + ' 的 buildMedia 不应把 iframe 挂到别处（返回值由建层方 append）');
    }
  }
  // 数据流兜底：任何由 createElement("iframe") 得到的变量都不许被 document.body 直接 append。
  for (const f of files) {
    const code = stripComments(f.text);
    const vars = new Set();
    const reVar = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*["']iframe["']\s*\)/g;
    let mv;
    while ((mv = reVar.exec(code)) !== null) vars.add(mv[1]);
    for (const v of vars) {
      const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('document\\.body\\.appendChild\\(\\s*' + esc + '\\s*\\)').test(code)) {
        problems.push(f.rel + ' 把 iframe 变量 ' + v + ' 直接挂到 document.body（父链即 body）');
      }
    }
  }
  return problems;
}

const iframeProblems = iframeViolations(SRC);
check('P4.1 iframe 创建点恰 5 处（3 文件）+ 创建函数体不直接挂 body + staging 结构正确',
  iframeProblems.length === 0, iframeProblems.join('\n      '));

// 负对照：合成源 + 变异函数体。
{
  const badDirect = iframeViolations(SRC.concat([{
    rel: 'src/video-layer.js',
    text: 'function bad(sel){ const f = document.createElement("iframe"); document.body.appendChild(f); return f; }',
  }]));
  negOk('iframe 变量被 document.body.appendChild 直接挂上去判红',
    badDirect.some((p) => /iframe 变量 f 直接挂到 document\.body/.test(p)), badDirect.join(' | '));
  negOk('创建点分布漂移（新增第 6 处）判红',
    iframeViolations(SRC.concat([{ rel: 'src/video-layer.js', text: 'const z = document.createElement("iframe");' }]))
      .some((p) => /分布漂移/.test(p)));
  const probeBodyBad = 'function prepareWebProbe(w, prep, onReady) { const f = document.createElement("iframe"); document.body.appendChild(f); }';
  const probeFake = {
    rel: 'src/media-prep/probe.js',
    text: probeBodyBad + '\n' + SRC.filter((f) => f.rel === 'src/media-prep/probe.js').map((f) => stripComments(f.text)).join('\n'),
  };
  const filesFake = SRC.map((f) => (f.rel === 'src/media-prep/probe.js' ? { rel: f.rel, text: probeFake.text } : f));
  negOk('staging 探测函数直接挂 body 判红（父链含 body）',
    iframeViolations(filesFake).some((p) => /prepareWebProbe.*body/.test(p)), iframeViolations(filesFake).join(' | '));
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
if (failed) {
  console.log('\nLAYER OWNERSHIP CHECKS FAILED -- ' + failed + ' failed');
  console.log('口径：层所有权 = 主包渲染内核独占（ADR-0013 D12）。');
  console.log('子包要渲染壁纸，只能经 host 键面拿渲染器与状态，不许自己建层/退层/持 #layer 引用。');
  process.exit(1);
}
console.log('\nALL LAYER OWNERSHIP CHECKS PASSED');
process.exit(0);
