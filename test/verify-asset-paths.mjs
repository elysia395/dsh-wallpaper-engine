#!/usr/bin/env node
/**
 * 聚焦守卫：`lib/asset-paths.js`（上传 / 自定义画面 / 头像立绘 / 自动首帧 / WE 官方素材目录族）。
 *
 * 为什么值得独立守卫：这一族的失效形态全是**静默**的，而且分散在四条不变量上 ——
 *   · ① 目录写死家目录 ⇒ `DSH_WE_DATA_DIR` 隔离开关失效，自检脚本会往真实数据目录里写/删
 *     （scene-frame 路由还会"清掉同一壁纸 id 的旧文件"）；变异体 `homedir-default` 钉这条。
 *   · ② WE 素材目录解析顺序（env → config → null）与 `materials/` 探测门：配错就是"渲染端静默
 *     回落程序化复刻"，页面上看不出错，只是像素对不上。
 *   · ③ 素材名清单：`readdir` 的**来路**（`node:fs/promises` vs `node:fs`）写错会让
 *     `listWeAssetNames` 恒返回 `[]`（`await` 一个同步函数抛在 try 里被吞）—— 变异体
 *     `readdir-import` 钉这条；缓存键是目录 ⇒ setter 必须清表。
 *   · ④ 头像/立绘挑选按文件形状 + side 前缀 ⇒ 前缀判据丢了就会把另一侧的头像端上去。
 *
 * 口径（docs/DEV-GUIDE.md §4.7）：期望值从源码自行重推；正向与负对照喂**同一个判据函数**
 * （负对照只改被测源码、落在 `.test-cache/` 下）；地板写在 `if` 之外；env 注入一律在
 * try/finally 里还原，绝不把 `DSH_WE_*` 泄漏给后面的判据。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAssetPathsKit } from '../lib/asset-paths.js';
import { createCheck } from './tools/assert-harness.mjs';
import { stripComments } from './tools/js-text.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'asset-paths-guard');
const SRC = join(ROOT, 'lib', 'asset-paths.js');
const SOURCE = readFileSync(SRC, 'utf8');
const OWN = readFileSync(fileURLToPath(import.meta.url), 'utf8');
const { check, stats } = createCheck();
let mutants = 0;
let seq = 0;

rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

function section(title) { console.log('\n' + title); }

function freshDir(label) {
  const d = join(ISO, `${label}-${++seq}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

/** env 注入：无论判据怎么结束都还原（判据之间不得互相污染）。
 *  设值与还原都不在 async 函数体里（免得 `require-atomic-updates` 以为是 await 后的陈旧写）。 */
function withEnv(name, value, fn) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  const restore = () => {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  };
  return Promise.resolve().then(fn).finally(restore);
}

/**
 * 与宿主同形的注入面：`pluginDataDir` 是**活访问器**（`dirRef.value` 可被测试改写，模拟
 * `DSH_WE_DATA_DIR` 切换）；`ensureDirOnce` 真建目录并**返回该目录**（宿主同名函数就这么用）；
 * `writeConfig` 落一份深拷贝以便回看；`enqueueConfigWrite` 是**真串行队列**并计数（用于判"必须入队"）。
 */
function makeKit({ dirRef, cfg = {}, factory } = {}) {
  const state = { cfg, written: [], queueCalls: 0, ensured: [] };
  let queue = Promise.resolve();
  const F = factory || createAssetPathsKit;
  const kit = F({
    pluginDataDir: () => dirRef.value,
    ensureDirOnce: (d) => { state.ensured.push(d); mkdirSync(d, { recursive: true }); return d; },
    readConfig: () => state.cfg,
    writeConfig: (next) => { state.cfg = next; state.written.push(JSON.parse(JSON.stringify(next))); },
    enqueueConfigWrite: (fn) => {
      state.queueCalls += 1;
      const p = queue.then(fn);
      queue = p.then(() => {}, () => {});
      return p;
    },
  });
  return { kit, state };
}

function loadMutant(label, transforms) {
  let text = SOURCE;
  for (const [find, replace] of transforms) {
    if (!text.includes(find)) {
      throw new Error(`变异体 ${label} 的锚点没命中：${JSON.stringify(find.slice(0, 70))} —— 源码变了就同步改锚点`);
    }
    text = text.replace(find, () => replace);
  }
  mutants += 1;
  const file = join(ISO, 'mutants', `${mutants}-${label}.mjs`);
  mkdirSync(join(ISO, 'mutants'), { recursive: true });
  writeFileSync(file, text);
  return import(pathToFileURL(file).href);
}

/** 同一个判据函数喂正向与负对照（负对照只换被测源码）。 */
async function pair(name, judge, label, transforms) {
  const pos = await judge({});
  check(name, pos.ok === true, '正向读数：' + pos.detail);
  const mod = await loadMutant(label, transforms);
  const mut = await judge({ factory: mod.createAssetPathsKit });
  check(`${name} —— 负对照（${label}）必须判红`, mut.ok === false, '变异体读数：' + mut.detail);
}

// ───────────────────────── A. 上传目录三级优先（不变量 ②） ─────────────────────────
async function judgeUploadPriority(make) {
  const dirRef = { value: freshDir('a-up') };
  const mk = (cfg) => makeKit({ dirRef, cfg, factory: make.factory }).kit;
  // ① env 最高（config 也设了也要 env 胜）
  const envWins = await withEnv('DSH_WE_UPLOAD_DIR', '/env/upload', async () => mk({ uploadDir: '/cfg/upload' }).resolveUploadDir());
  // ② env 不设 ⇒ config，且两侧空白都 trim 掉
  const cfgWins = await withEnv('DSH_WE_UPLOAD_DIR', undefined, async () => mk({ uploadDir: '  /cfg/upload  ' }).resolveUploadDir());
  // ③ 都没有 ⇒ pluginDataDir()/uploads
  const fallback = await withEnv('DSH_WE_UPLOAD_DIR', undefined, async () => {
    const k = mk({});
    return { resolved: k.resolveUploadDir(), expected: k.defaultUploadDir() };
  });
  // ④ 纯空白 config ⇒ 回落默认（不是空串、不是空目录）
  const blank = await withEnv('DSH_WE_UPLOAD_DIR', undefined, async () => {
    const k = mk({ uploadDir: '   ' });
    return { resolved: k.resolveUploadDir(), expected: k.defaultUploadDir() };
  });
  const wantDefault = join(dirRef.value, 'uploads');
  const ok = envWins === '/env/upload' && cfgWins === '/cfg/upload'
    && fallback.resolved === fallback.expected && fallback.expected === wantDefault
    && blank.resolved === blank.expected;
  return { ok, detail: `env=${envWins} · config='  /cfg/upload  '⇒${cfgWins} · 默认=${fallback.resolved}（期望 ${wantDefault}） · 纯空白⇒${blank.resolved}` };
}

// ───────────────────────── B. 五条目录派生自注入的 pluginDataDir()（不变量 ①） ─────────────────────────
async function judgeDerivedDirs(make) {
  const dirRef = { value: freshDir('b-data1') };
  const { kit } = makeKit({ dirRef, factory: make.factory });
  const subs = { overrides: 'overrides', avatars: 'avatars', mascot: 'mascot', liveFrames: 'live-frames', uploads: 'uploads' };
  const cells = {
    overrides: kit.customFrameDir(), avatars: kit.avatarDir(), mascot: kit.mascotDir(),
    liveFrames: kit.liveFrameDir(), uploads: kit.defaultUploadDir(),
  };
  const notes = [];
  let ok = true;
  for (const [key, sub] of Object.entries(subs)) {
    const want = join(dirRef.value, sub);
    // uploads 只是路径解析（不建目录）；其余四条是 ensure*Dir ⇒ 调用即建。
    const mustExist = key !== 'uploads';
    if (cells[key] !== want || (mustExist && !existsSync(want))) {
      ok = false;
      notes.push(`${key}=${cells[key]}（期望 ${want}，存在=${existsSync(want)}，要求存在=${mustExist}）`);
    }
  }
  // 活访问器：换 pluginDataDir() 之后新目录跟过去（旧目录不再被这些调用创建）
  const dir2 = freshDir('b-data2');
  dirRef.value = dir2;
  const after = { overrides: kit.customFrameDir(), avatars: kit.avatarDir(), mascot: kit.mascotDir(), liveFrames: kit.liveFrameDir() };
  for (const [key, sub] of Object.entries({ overrides: 'overrides', avatars: 'avatars', mascot: 'mascot', liveFrames: 'live-frames' })) {
    const want = join(dir2, sub);
    if (after[key] !== want || !existsSync(want)) { ok = false; notes.push(`换目录后 ${key}=${after[key]}（期望 ${want}）`); }
  }
  return { ok, detail: `首批=${JSON.stringify(cells)} · 换目录后=${JSON.stringify(after)}${notes.length ? ' | ' + notes.join(' ; ') : ''}` };
}

// ───────────────────────── C. 常量表与上限（逐字） ─────────────────────────
async function judgeConstants(make) {
  const { kit } = makeKit({ dirRef: { value: freshDir('c') }, factory: make.factory });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ok = eq(kit.UPLOAD_EXT, { 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png' })
    && eq(kit.CUSTOM_FRAME_EXT, { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })
    && kit.CUSTOM_FRAME_MAX_BYTES === 30 * 1024 * 1024
    && eq(kit.AVATAR_EXT, { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })
    && eq(kit.MASCOT_EXT, { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })
    && kit.AVATAR_MAX_BYTES === 8 * 1024 * 1024 && kit.MASCOT_MAX_BYTES === 8 * 1024 * 1024
    && eq(kit.AVATAR_SIDES, ['user', 'ai']) && kit.WE_ASSETS_SOURCE_ID === 'local';
  return {
    ok,
    detail: `UPLOAD_EXT=${JSON.stringify(kit.UPLOAD_EXT)} FRAME_MAX=${kit.CUSTOM_FRAME_MAX_BYTES} AVATAR_MAX=${kit.AVATAR_MAX_BYTES} MASCOT_MAX=${kit.MASCOT_MAX_BYTES} SIDES=${JSON.stringify(kit.AVATAR_SIDES)} SOURCE_ID=${kit.WE_ASSETS_SOURCE_ID}`,
  };
}

// ───────────────────────── D. 头像 / 立绘挑选 ─────────────────────────
async function judgeAvatarPicker(make) {
  const dirRef = { value: freshDir('d-av') };
  const { kit } = makeKit({ dirRef, factory: make.factory });
  const adir = kit.avatarDir();
  writeFileSync(join(adir, 'user-ab12.png'), 'x');      // 唯一合法的 user
  writeFileSync(join(adir, 'ai-cd34.jpg'), 'x');        // 唯一合法的 ai
  writeFileSync(join(adir, 'bogus.png'), 'x');          // 无 side 前缀
  writeFileSync(join(adir, 'user-AB12.png'), 'x');      // 大写 stamp 不在 [a-z0-9]
  writeFileSync(join(adir, 'user-ab.png'), 'x');        // stamp 过短（<4）
  writeFileSync(join(adir, 'user-ab12.gif'), 'x');      // 扩展名不在表
  // 跨 side 不得串：目录里只有 ai 的文件，问 user 必须 null
  const dirRef2 = { value: freshDir('d-av2') };
  const { kit: kit2 } = makeKit({ dirRef: dirRef2, factory: make.factory });
  writeFileSync(join(kit2.avatarDir(), 'ai-only1.png'), 'x');
  // 立绘：只认 mascot-*；目录里只有不合形状的文件必须 null
  const mdir = kit.mascotDir();
  writeFileSync(join(mdir, 'mascot-ab12.webp'), 'x');
  writeFileSync(join(mdir, 'anything.png'), 'x');
  const dirRef3 = { value: freshDir('d-m2') };
  const { kit: kit3 } = makeKit({ dirRef: dirRef3, factory: make.factory });
  writeFileSync(join(kit3.mascotDir(), 'anything.png'), 'x');
  const out = {
    user: kit.avatarPath('user'), ai: kit.avatarPath('ai'), cross: kit2.avatarPath('user'),
    badSide: kit.avatarPath('x'), emptySide: kit.avatarPath(''), undefSide: kit.avatarPath(undefined),
    mascot: kit.mascotPath(), mascotOther: kit3.mascotPath(),
  };
  const ok = out.user === join(adir, 'user-ab12.png') && out.ai === join(adir, 'ai-cd34.jpg')
    && out.cross === null && out.badSide === null && out.emptySide === null && out.undefSide === null
    && out.mascot === join(mdir, 'mascot-ab12.webp') && out.mascotOther === null;
  return { ok, detail: `user=${out.user} ai=${out.ai} 跨side=${out.cross} 非法side=${out.badSide}/${out.emptySide}/${out.undefSide} 立绘=${out.mascot} 只有杂文件时立绘=${out.mascotOther}` };
}

// ───────────────────────── E. WE 素材目录：解析 / 探测门 / setter（不变量 ③） ─────────────────────────
async function judgeWeResolve(make) {
  const dirRef = { value: freshDir('e-resolve') };
  const mk = (cfg) => makeKit({ dirRef, cfg, factory: make.factory }).kit;
  const envVal = await withEnv('DSH_WE_ASSETS_DIR', '/env/we/', async () => mk({ weAssetsDir: '/cfg/we' }).resolveWeAssetsDir());
  const cfgVal = await withEnv('DSH_WE_ASSETS_DIR', undefined, async () => mk({ weAssetsDir: '  /cfg/we  ' }).resolveWeAssetsDir());
  const none = await withEnv('DSH_WE_ASSETS_DIR', undefined, async () => {
    const k = mk({});
    return { resolved: k.resolveWeAssetsDir(), get: k.getWeAssetsDir() };
  });
  const blankEnv = await withEnv('DSH_WE_ASSETS_DIR', '   ', async () => {
    const k = mk({ weAssetsDir: '/cfg/we' });
    return k.resolveWeAssetsDir();
  });
  const ok = envVal === normalize('/env/we/') && envVal.endsWith('/')
    && cfgVal === '/cfg/we' && none.resolved === null && none.get === null && blankEnv === '/cfg/we';
  return { ok, detail: `env='/env/we/'⇒${envVal}（normalize 不剥尾斜杠） · config='  /cfg/we  '⇒${cfgVal} · 都没有⇒${none.resolved} · 纯空白 env⇒${blankEnv}` };
}

async function judgeWeProbe(make) {
  const dirRef = { value: freshDir('e-probe') };
  const probe = await withEnv('DSH_WE_ASSETS_DIR', undefined, async () => {
    const mk = (cfg) => makeKit({ dirRef, cfg, factory: make.factory }).kit;
    const bare = freshDir('e-bare');
    const asFile = freshDir('e-file');
    writeFileSync(join(asFile, 'materials'), 'x');
    const good = freshDir('e-good');
    mkdirSync(join(good, 'materials'), { recursive: true });
    return {
      none: mk({}).weAssetsAvailable(),
      bare: mk({ weAssetsDir: bare }).weAssetsAvailable(),
      asFile: mk({ weAssetsDir: asFile }).weAssetsAvailable(),
      good: mk({ weAssetsDir: good }).weAssetsAvailable(),
    };
  });
  const ok = probe.none === false && probe.bare === false && probe.asFile === false && probe.good === true;
  return { ok, detail: `未配置=${probe.none} 无 materials=${probe.bare} materials 是文件=${probe.asFile} 真目录=${probe.good}` };
}

async function judgeWeSetter(make) {
  const dirRef = { value: freshDir('e-set') };
  const r = await withEnv('DSH_WE_ASSETS_DIR', undefined, async () => {
    const { kit, state } = makeKit({ dirRef, cfg: { keep: 1 }, factory: make.factory });
    const before = kit.getWeAssetsDir();
    const ret1 = await kit.setWeAssetsDir('/we/one');
    const get1 = kit.getWeAssetsDir();
    const cfg1 = JSON.parse(JSON.stringify(state.cfg));
    const ret2 = await kit.setWeAssetsDir(null);
    const get2 = kit.getWeAssetsDir();
    const cfg2 = JSON.parse(JSON.stringify(state.cfg));
    // 清除路径**不能只看返回值**：指到真素材目录（有 `materials/`）⇒ 可用为 true；`setWeAssetsDir(null)`
    // 必须把可用性打回 false。这条同时钉住 setter 的返回值语义：它回显"被设进去的那个值"（清除时是 null）。
    const realDir = freshDir('e-set-real');
    mkdirSync(join(realDir, 'materials'), { recursive: true });
    writeFileSync(join(realDir, 'materials', 'x.tex'), 'x');
    const retReal = await kit.setWeAssetsDir(realDir);
    const availReal = kit.weAssetsAvailable();
    const retClear = await kit.setWeAssetsDir(null);
    const availCleared = kit.weAssetsAvailable();
    const beforeMany = state.queueCalls;
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => kit.setWeAssetsDir('/we/' + i)));
    const cfgMany = JSON.parse(JSON.stringify(state.cfg));
    return { before, ret1, get1, cfg1, ret2, get2, cfg2, realDir, retReal, availReal, retClear, availCleared, many, cfgMany, queued: state.queueCalls - beforeMany };
  });
  const ok = r.before === null && r.ret1 === '/we/one' && r.get1 === '/we/one'
    && r.cfg1.weAssetsDir === '/we/one' && r.cfg1.keep === 1
    && r.ret2 === null && r.get2 === null && !('weAssetsDir' in r.cfg2) && r.cfg2.keep === 1
    && r.retReal === r.realDir && r.availReal === true && r.retClear === null && r.availCleared === false
    && r.queued === 20 && r.many.every((v, i) => v === '/we/' + i) && r.cfgMany.weAssetsDir === '/we/19';
  return {
    ok,
    detail: `初值=${r.before} set⇒rets=${r.ret1}/${typeof r.ret1 === 'string' ? '' : '(不是字符串！)'} get=${r.get1} cfg=${JSON.stringify(r.cfg1)} | null⇒ret=${JSON.stringify(r.ret2)} get=${r.get2} cfg=${JSON.stringify(r.cfg2)} | 真目录⇒ret 回显=${r.retReal === r.realDir ? 'ok' : JSON.stringify(r.retReal)} 可用=${r.availReal}；清除后可用=${r.availCleared} | 20 路入队=${r.queued} 末值=${r.cfgMany.weAssetsDir}`,
  };
}

// ───────────────────────── F. 素材名清单：扫描 / 排序 / 缓存 / setter 清表 ─────────────────────────
async function judgeWeAssetList(make) {
  const dirRef = { value: freshDir('f-set') };
  const tree = freshDir('f-tree');
  // 排序是可观察的：walk 是**深度优先**（遇目录立即下钻），而 readdir 在 APFS 上按名返回。
  // 于是 `a/`（目录）排在 `a.tex`（同名文件）之前 ⇒ 盘上原始顺序 = [a/deep, a, …]，
  // 与排序结果 [a, a/deep, …] 不同 ⇒ "去掉 sort" 有真牙齿（否则该变异体在本机永远假绿）。
  mkdirSync(join(tree, 'materials', 'a'), { recursive: true });
  mkdirSync(join(tree, 'materials', 'b'), { recursive: true });
  writeFileSync(join(tree, 'materials', 'a', 'deep.tex'), 'x');
  writeFileSync(join(tree, 'materials', 'a.tex'), 'x');
  writeFileSync(join(tree, 'materials', 'b', 'b1.tex'), 'x');
  writeFileSync(join(tree, 'materials', 'b.tex'), 'x');
  writeFileSync(join(tree, 'materials', 'z.tex'), 'x');
  writeFileSync(join(tree, 'materials', 'ignore.txt'), 'x');
  const expect = ['a', 'a/deep', 'b', 'b/b1', 'z'];
  // 环境前提：排序变异体的牙齿依赖"盘上原始顺序 ≠ 排序结果"（APFS 的 hash 顺序）；这里如实报出来。
  const raw = [];
  (function walk (d, prefix) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) walk(join(d, e.name), rel);
      else if (e.name.toLowerCase().endsWith('.tex')) raw.push(rel.slice(0, -4));
    }
  })(join(tree, 'materials'), '');
  const { kit } = makeKit({ dirRef, factory: make.factory });
  const first = await kit.listWeAssetNames(tree);
  // 缓存命中：盘上整棵 materials 删掉后仍返回旧清单（60s 内）
  rmSync(join(tree, 'materials'), { recursive: true, force: true });
  const cached = await kit.listWeAssetNames(tree);
  // setter 换目录 ⇒ 清表 ⇒ 再查同一目录必须重扫（此时盘上已无 materials ⇒ []）
  await kit.setWeAssetsDir('/we/other');
  const afterClear = await kit.listWeAssetNames(tree);
  const ok = JSON.stringify(first) === JSON.stringify(expect)
    && JSON.stringify(cached) === JSON.stringify(expect) && afterClear.length === 0;
  return {
    ok,
    detail: `首次=${JSON.stringify(first)}（期望 ${JSON.stringify(expect)}） · 缓存命中=${JSON.stringify(cached)} · 清表后重扫=${JSON.stringify(afterClear)} · 盘上原始顺序=${JSON.stringify(raw)}${JSON.stringify(raw) === JSON.stringify(expect) ? '（⚠ 与排序相同，排序变异体在此机器上没有牙齿）' : ''}`,
  };
}

// ───────────────────────── 变异体（锚点都是真修不会碰的行/整句） ─────────────────────────
const M_HOMEDIR = [
  [`import { readdirSync, statSync } from 'node:fs';`,
    `import { readdirSync, statSync } from 'node:fs';\nimport { homedir } from 'node:os';`],
  [`function defaultUploadDir() { return join(pluginDataDir(), 'uploads'); }`,
    `function defaultUploadDir() { return join(homedir(), '.dsh-wallpaper-engine', 'uploads'); }`],
];
const M_UPLOAD_NO_TRIM = [[
  `    if (typeof cfg.uploadDir === 'string' && cfg.uploadDir.trim()) return cfg.uploadDir.trim();`,
  `    if (typeof cfg.uploadDir === 'string' && cfg.uploadDir) return cfg.uploadDir;`,
]];
const M_ENV_IGNORED = [[
  `    if (process.env.DSH_WE_UPLOAD_DIR) return process.env.DSH_WE_UPLOAD_DIR;`,
  `    if (false) return process.env.DSH_WE_UPLOAD_DIR;`,
]];
const M_FRAME_MAX = [[
  `  const CUSTOM_FRAME_MAX_BYTES = 30 * 1024 * 1024;`,
  `  const CUSTOM_FRAME_MAX_BYTES = 31 * 1024 * 1024;`,
]];
const M_AVATAR_NO_PREFIX = [[
  `      if (!AVATAR_FILE_RE.test(name) || name.slice(0, s.length + 1) !== s + '-') continue;`,
  `      if (!AVATAR_FILE_RE.test(name)) continue;`,
]];
const M_MASCOT_ANY = [[
  `      if (!MASCOT_FILE_RE.test(name)) continue;`,
  `      if (false) continue;`,
]];
const M_PROBE_LOOSE = [[
  `    try { return statSync(join(WE_ASSETS_DIR, 'materials')).isDirectory(); } catch { return false; }`,
  `    try { statSync(join(WE_ASSETS_DIR, 'materials')); return true; } catch { return false; }`,
]];
const M_WE_ENV_IGNORED = [[
  `    if (process.env.DSH_WE_ASSETS_DIR && process.env.DSH_WE_ASSETS_DIR.trim()) {`,
  `    if (false) {`,
]];
const M_SET_NO_DELETE = [[
  `      else delete cfg.weAssetsDir;`,
  `      else cfg.weAssetsDir = dir;`,
]];
const M_SET_NO_QUEUE = [[
  `    return enqueueConfigWrite(() => {`,
  `    return (() => {`,
]];
const M_READDIR_SYNC = [[
  `import { readdir } from 'node:fs/promises';`,
  `import { readdir } from 'node:fs';`,
]];
const M_CACHE_NO_CLEAR = [[`      weAssetsIndexCache.clear();\n`, ``]];
const M_LIST_UNSORTED = [[`    names.sort();\n`, ``]];

// ───────────────────────── 判据 ─────────────────────────
section('A. 上传目录三级优先：env > config（trim）> pluginDataDir()/uploads');
await pair('A1 三级各自独立生效、两侧空白都 trim、纯空白 config 回落默认', judgeUploadPriority, 'homedir-default', M_HOMEDIR);
await pair('A2 config 必须 trim 后才用', judgeUploadPriority, 'upload-no-trim', M_UPLOAD_NO_TRIM);
await pair('A3 env 覆盖优先', judgeUploadPriority, 'env-ignored', M_ENV_IGNORED);

section('B. 五条目录都派生自注入的 pluginDataDir()，且调用即建（活访问器跟随换目录）');
await pair('B1 overrides/avatars/mascot/live-frames/uploads 全部落在当前数据目录下并已创建', judgeDerivedDirs, 'homedir-default', M_HOMEDIR);

section('C. 三张 MIME 表、三个上限、side 表、素材源 id 与源码逐字一致');
await pair('C1 常量表与上限逐字', judgeConstants, 'custom-frame-max', M_FRAME_MAX);

section('D. 头像按 side 前缀命中、立绘只认 mascot-*');
await pair('D1 头像：形状/前缀/跨 side/非法 side 四类', judgeAvatarPicker, 'avatar-no-prefix', M_AVATAR_NO_PREFIX);
await pair('D2 立绘：只有杂文件时必须 null', judgeAvatarPicker, 'mascot-any-file', M_MASCOT_ANY);

section('E. WE 素材目录：解析顺序 / materials 探测门 / setter 串行与清字段');
await pair('E1 resolveWeAssetsDir：env（normalize，不剥尾斜杠）> config（trim）> null', judgeWeResolve, 'we-env-ignored', M_WE_ENV_IGNORED);
await pair('E2 探测门：未配置 / 无 materials / materials 是文件 ⇒ false，真目录 ⇒ true', judgeWeProbe, 'probe-loose', M_PROBE_LOOSE);
await pair('E3 setWeAssetsDir：落 config、传 null 删字段、get 立刻反映', judgeWeSetter, 'set-no-delete', M_SET_NO_DELETE);
await pair('E4 setWeAssetsDir 必须走串行队列（20 路并发全部入队、末值胜出）', judgeWeSetter, 'set-no-queue', M_SET_NO_QUEUE);

section('F. 清单：materials/**/*.tex ⇒ posix 相对名去扩展名 + 排序 + 60s 缓存 + setter 清表');
await pair('F1 扫描结果与排序（读目录用异步 API；非 .tex 忽略）', judgeWeAssetList, 'readdir-import', M_READDIR_SYNC);
await pair('F2 60s 缓存命中 + setter 清表后重扫', judgeWeAssetList, 'cache-no-clear', M_CACHE_NO_CLEAR);
await pair('F3 去掉排序 ⇒ 判红', judgeWeAssetList, 'list-unsorted', M_LIST_UNSORTED);

// ───────────────────────── G. 自检与地板 ─────────────────────────
section('G. 自检与覆盖面地板');
check('G1 本文件确实调用了被测模块（不是只 import）',
  stripComments(OWN).includes('createAssetPathsKit('),
  '剥注释后含 createAssetPathsKit(');
check('G2 模块文本（剥注释）不含 homedir( —— 写死家目录会让 DSH_WE_DATA_DIR 隔离失效',
  !stripComments(SOURCE).includes('homedir('),
  `剥注释后含 homedir( = ${stripComments(SOURCE).includes('homedir(')}`);

const CHECK_FLOOR = 18;
const MUTANT_FLOOR = 8;
const totalChecks = stats.passed + stats.failed;
check(`G3 覆盖面地板：执行的判据 ≥ ${CHECK_FLOOR}`, totalChecks >= CHECK_FLOOR, `实测 ${totalChecks}`);
check(`G4 负对照地板：变异体 ≥ ${MUTANT_FLOOR}`, mutants >= MUTANT_FLOOR, `实测 ${mutants}`);

console.log('');
if (stats.failed > 0) {
  console.log(`ASSET-PATHS CHECKS FAILED — ${stats.failed} failed, ${stats.passed} passed`);
  process.exit(1);
}
console.log(`ALL ASSET-PATHS CHECKS PASSED (${stats.passed})`);
