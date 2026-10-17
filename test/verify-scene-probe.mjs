#!/usr/bin/env node
/**
 * verify-scene-probe.mjs —— `lib/media/scene-probe.js` 的聚焦判据。
 *
 * 被测对象：`createSceneProbeKit({ atomicWriteFileP, ensureFrameCacheDir })` 返回的两本账 ——
 * 「scene 主文件是否内嵌 MP4」的有界 LRU 探测账 与 「独立音轨抽取」账。
 *
 * 为什么值得一条独立守卫：这两本账是 `/inventory` 的 `sceneVideo` 字段与 `/scene-audio` 路由的
 * **唯一来源**。字段说谎（把"没探测过"当成 `false`）会让客户端直接不发 `/scene-video/<token>`；
 * 音轨账挑错文件则会让场景静音。两者都是"用户会撞上"的行为 ⇒ 硬档。
 *
 * 判据设计（DEV-GUIDE §4.7）：
 *   · 每个正向判据都配**同一段判据代码**喂进去的变异体（负对照）—— 变异体必须被判红，
 *     否则这条判据是恒真的。变异体由 `lib/media/scene-probe.js` 源码文本现场改写而成，
 *     落在 `.test-cache/` 下（不动 `lib/`）。
 *   · 不依赖仓库 fixture：全部在 `.test-cache/scene-probe/` 里现造。
 *   · 覆盖面地板写在 `if` 之外（G 段），跳过项会被点名。
 */
import { mkdirSync, writeFileSync, rmSync, statSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSceneProbeKit } from '../lib/media/scene-probe.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISO = join(ROOT, '.test-cache', 'scene-probe-guard');
const SRC = join(ROOT, 'lib', 'media', 'scene-probe.js');

let passed = 0; let failed = 0;
function check (name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}
function section (title) { console.log('\n' + title); }

// ── 沙盒与注入点 ────────────────────────────────────────────────────────────
rmSync(ISO, { recursive: true, force: true });
mkdirSync(ISO, { recursive: true });

/** 注入点 1：音轨产物落到哪（本守卫自己决定，正是注入点的意义）。 */
function frameDir (name) {
  const d = join(ISO, name);
  mkdirSync(d, { recursive: true });
  return d;
}

/** 造一个 kit + 记录落盘次数（注入点 2：原子写由调用方给）。 */
function makeKit (name = 'kit') {
  const writes = [];
  const kit = createSceneProbeKit({
    atomicWriteFileP: async (file, data) => { writes.push({ file, bytes: Buffer.from(data).length }); writeFileSync(file, data); },
    ensureFrameCacheDir: () => frameDir(name),
  });
  return { kit, writes };
}

/** 把 `lib/media/scene-probe.js` 的源码改写成一个变异体，落到 `.test-cache/` 后 import 回来。
 *  相对 import 改写成绝对 file: URL —— 否则 tmp 目录里解析不到 `./scene-manifest.js`。 */
let mutantSeq = 0;
async function loadMutant (label, transform) {
  const src = readFileSync(SRC, 'utf8');
  const out = transform(src);
  if (out === src) throw new Error('变异体没改到源码（判据会失真）: ' + label);
  const patched = out
    // ⚠️ 用**正则**替 specifier（不是写死 `'./scene-manifest.js'`）：真源在 lib/media/ 下，
// 相对路径是 `../scene-manifest.js` —— 写死 `./` 会让改写落空，临时目录里就解析不到该模块。
    .replace(/['"][^'"]*scene-manifest\.js['"]/, JSON.stringify(pathToFileURL(join(ROOT, 'lib', 'scene-manifest.js')).href))
    // 同上：specifier 形式容忍（真源可能用 `../pkg-read.js`）。
    .replace(/['"][^'"]*pkg-read\.js['"]/, JSON.stringify(pathToFileURL(join(ROOT, 'lib', 'pkg-read.js')).href));
  const dir = join(ISO, 'mutants');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, (mutantSeq++) + '-' + label + '.mjs');
  writeFileSync(file, patched);
  const mod = await import(pathToFileURL(file).href);
  const writes = [];
  const kit = mod.createSceneProbeKit({
    atomicWriteFileP: async (f, d) => { writes.push({ file: f, bytes: Buffer.from(d).length }); writeFileSync(f, d); },
    ensureFrameCacheDir: () => frameDir('mutant-' + label),
  });
  return { kit, writes };
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
/** 轮询后台泵直到账本有答案（有超时 ⇒ 卡死会判红而不是挂住）。 */
async function waitFor (get, key, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = get(key);
    if (v !== undefined) return v;
    await sleep(10);
  }
  return undefined;
}

// ── 判据本体（正/负对照共用）─────────────────────────────────────────────────
/** ① 未知必须是"未知"：`undefined`，不是 `false`（`/inventory` 的诚实性根据）。 */
const unknownIsHonest = (get, key) => get(key) === undefined;

/** ③ 有界 LRU：先证明"512 条都留得住"，再证明"第 513 条挤掉最旧的" ⇒ 上限恰好 512。 */
function lruBoundHolds (set, get) {
  for (let i = 0; i < 512; i++) set('k' + i, true);
  const keepAll = get('k0') === true && get('k255') === true && get('k511') === true;
  get('k0'); // 读一次 ⇒ 提升到队尾
  set('k512', true); // 超限 ⇒ 淘汰队头（此时是 k1，不是 k0）
  return keepAll && get('k1') === undefined && get('k0') === true && get('k2') === true;
}

/** ⑥ 音轨抽取：唯一一次落盘、挑最大音频、可缓存 —— 全部走这一条。 */
async function audioPickHolds (kit, writes, dirAbs, wantExt, wantBytes) {
  const target = await kit.ensureSceneAudio(join(dirAbs, 'scene.json'));
  const ok1 = typeof target === 'string' && target.endsWith('.' + wantExt)
    && statSync(target).size === wantBytes && writes.length === 1;
  const again = await kit.ensureSceneAudio(join(dirAbs, 'scene.json'));
  return ok1 && again === target && writes.length === 1;
}

// ═══ A. 未知 ≠ 否 ═══════════════════════════════════════════════════════════
await (async () => {
  section('A. 未知 ≠ 否（`/inventory` 的 sceneVideo 字段不说谎的根据）');
  const { kit } = makeKit('a');
  const key = kit.sceneVideoProbeKey(join(ISO, 'no-such.pkg'), 1);
  check('A1 从没探测过的键 ⇒ undefined（未知），不是 false',
    unknownIsHonest(kit.sceneVideoProbeGet, key), '得到 ' + String(kit.sceneVideoProbeGet(key)));

  // 负对照：把"未知"改成"否"的变异体，必须被**同一段**判据判红。
  const evil = await loadMutant('unknown-as-false', (s) => s.replace(
    'if (!_sceneVideoProbeCache.has(key)) return undefined;',
    'if (!_sceneVideoProbeCache.has(key)) return false;'));
  const evilKey = evil.kit.sceneVideoProbeKey(join(ISO, 'no-such.pkg'), 1);
  check('A2 负对照：变异体把未知冒充成 false ⇒ 同一条判据判红',
    unknownIsHonest(evil.kit.sceneVideoProbeGet, evilKey) === false,
    '变异体返回 ' + String(evil.kit.sceneVideoProbeGet(evilKey)));
})();

// ═══ B. 往返与覆盖 ═══════════════════════════════════════════════════════════
await (async () => {
  section('B. set/get 往返，且结果可被修正（true → false）');
  const { kit } = makeKit('b');
  const k1 = kit.sceneVideoProbeKey(join(ISO, 'a.pkg'), 100);
  const k2 = kit.sceneVideoProbeKey(join(ISO, 'b.pkg'), 100);
  kit.sceneVideoProbeSet(k1, true);
  kit.sceneVideoProbeSet(k2, false);
  check('B1 写入什么读出什么（true / false 都如实留着，不做真值合并）',
    kit.sceneVideoProbeGet(k1) === true && kit.sceneVideoProbeGet(k2) === false);
  kit.sceneVideoProbeSet(k1, false);
  check('B2 同键覆盖：true → false 能修正（包改坏了之后不许留旧答案）',
    kit.sceneVideoProbeGet(k1) === false);
  kit.sceneVideoProbeSet(k2, 1);
  check('B3 非布尔输入被归一到布尔（账本里的值只有 true/false 两种形态）',
    kit.sceneVideoProbeGet(k2) === true);
})();

// ═══ C. 有界 LRU ════════════════════════════════════════════════════════════
await (async () => {
  section('C. 有界 LRU（上限恰好 512：少一条会被"512 条全在"抓住，多一条会被"第 513 条淘汰"抓住）');
  const { kit } = makeKit('c');
  check('C1 512 条全留得住 + 读过的会被提升 + 第 513 条淘汰最旧的',
    lruBoundHolds(kit.sceneVideoProbeSet, kit.sceneVideoProbeGet));

  const big = await loadMutant('cap-1024', (s) => s.replace(
    'const SCENE_VIDEO_PROBE_MAX = 512;', 'const SCENE_VIDEO_PROBE_MAX = 1024;'));
  check('C2 负对照：把上限改成 1024 的变异体 ⇒ 同一条判据判红（证明 C1 钉住了 512 这个数）',
    lruBoundHolds(big.kit.sceneVideoProbeSet, big.kit.sceneVideoProbeGet) === false);

  const small = await loadMutant('cap-256', (s) => s.replace(
    'const SCENE_VIDEO_PROBE_MAX = 512;', 'const SCENE_VIDEO_PROBE_MAX = 256;'));
  check('C3 负对照：把上限改成 256 的变异体 ⇒ 判红（有界不等于"越小越好"，512 是行为契约）',
    lruBoundHolds(small.kit.sceneVideoProbeSet, small.kit.sceneVideoProbeGet) === false);
})();

// ═══ D. 键含 mtime ══════════════════════════════════════════════════════════
await (async () => {
  section('D. 缓存键 = 路径 + mtime（换包/改包必须自动重探）');
  const { kit } = makeKit('d');
  const p = join(ISO, 'd.pkg');
  writeFileSync(p, 'x');
  const m = statSync(p).mtimeMs;
  check('D1 同一路径不同 mtime ⇒ 不同键（否则改了包还读旧答案）',
    kit.sceneVideoProbeKey(p, 1) !== kit.sceneVideoProbeKey(p, 2));
  check('D2 不传 mtime ⇒ 现取 stat（与显式传同一个值等价）',
    kit.sceneVideoProbeKey(p) === kit.sceneVideoProbeKey(p, m));
  const gone = join(ISO, 'never-existed.pkg');
  const g1 = kit.sceneVideoProbeKey(gone);
  const g2 = kit.sceneVideoProbeKey(gone); // 两次独立调用：稳定性必须来自"退化为 0"而不是别的东西
  const g0 = kit.sceneVideoProbeKey(gone, 0);
  check('D3 文件不存在 ⇒ mtime 退化为 0 且**稳定**（不许 NaN 混进键里，两次必须同键）',
    g1 === g2 && g1 === g0 && !/NaN/.test(g1), g1);
  writeFileSync(p, 'y');
  utimesSync(p, new Date(m + 5000), new Date(m + 5000));
  check('D4 改动 mtime 后键确实变了（D1 是真实语义，不是字符串拼接的巧合）',
    kit.sceneVideoProbeKey(p) !== kit.sceneVideoProbeKey(p, m));
})();

// ═══ E. 后台探测泵 ══════════════════════════════════════════════════════════
await (async () => {
  section('E. 后台探测泵：探测失败记「否」，异常不冒泡');
  const { kit } = makeKit('e');

  // 松散 scene 目录（`.json` 主文件）里没有内嵌 MP4 ⇒ 探到 false。
  const bare = join(ISO, 'bare-scene');
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, 'scene.json'), JSON.stringify({ type: 'scene' }));
  const kLoose = kit.sceneVideoProbeKey(join(bare, 'scene.json'), 1);
  kit.scheduleSceneVideoProbe(join(bare, 'scene.json'), kLoose);
  const loose = await waitFor(kit.sceneVideoProbeGet, kLoose);
  check('E1 无内嵌 MP4 的松散 scene 目录 ⇒ 后台探到 false（不是"永远未知"）', loose === false, String(loose));

  // 坏 pkg：解析必然失败 ⇒ 必须落 false，且不许把异常冒到调用方。
  const badPkg = join(ISO, 'broken.pkg');
  writeFileSync(badPkg, Buffer.from('NOT-A-PKG'.repeat(64)));
  const kBad = kit.sceneVideoProbeKey(badPkg, 1);
  kit.scheduleSceneVideoProbe(badPkg, kBad);
  const bad = await waitFor(kit.sceneVideoProbeGet, kBad);
  check('E2 坏 pkg 文件 ⇒ 记 false（坏包不许打断 inventory 的 map 回调）', bad === false, String(bad));

  // 已有结果时不再排队/重探（幂等）。
  kit.sceneVideoProbeSet(kBad, true);
  kit.scheduleSceneVideoProbe(badPkg, kBad);
  await sleep(30);
  check('E3 已有结果 ⇒ schedule 不再覆盖它（真实路由回填的结果优先）',
    kit.sceneVideoProbeGet(kBad) === true);

  // 负对照：让泵把异常抛出去（不落账）⇒ 同一条判据必须判红。
  const thrower = await loadMutant('pump-throws', (s) => s.replace(
    '        } catch { has = false; }', '        } catch (e) { throw e; }'));
  const kT = thrower.kit.sceneVideoProbeKey(join(ISO, 'broken.pkg'), 1);
  thrower.kit.scheduleSceneVideoProbe(join(ISO, 'broken.pkg'), kT);
  const threw = await waitFor(thrower.kit.sceneVideoProbeGet, kT, 400);
  check('E4 负对照：变异体让异常冒出而不落账 ⇒ 判据判红（"失败记否"不是白写的）',
    threw !== false, '变异体得到 ' + String(threw));
})();

// ═══ F. 音轨抽取 ════════════════════════════════════════════════════════════
await (async () => {
  section('F. 音轨抽取：取最大音频（非 .txt）、只落一次盘、可缓存');
  const dir = join(ISO, 'loose-audio');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scene.json'), JSON.stringify({ type: 'scene' }));
  writeFileSync(join(dir, 'a.mp3'), Buffer.alloc(1024, 0x11));
  const ogg = Buffer.alloc(4096); for (let i = 0; i < ogg.length; i++) ogg[i] = i % 251;
  writeFileSync(join(dir, 'b.ogg'), ogg);
  writeFileSync(join(dir, 'notes.txt'), Buffer.alloc(9216, 0x22)); // 比音频大，但后缀不是音频

  const { kit, writes } = makeKit('f');
  check('F1 取最大的**音频**（4096B 的 .ogg），不是最大的文件（9216B 的 .txt），且恰好落盘一次',
    await audioPickHolds(kit, writes, dir, 'ogg', 4096),
    'writes=' + JSON.stringify(writes.map((w) => w.bytes)));
  const got = await kit.ensureSceneAudio(join(dir, 'scene.json'));
  check('F2 落盘内容就是 b.ogg 的字节（不是空文件 / 不是 txt）',
    readFileSync(got).equals(ogg));

  const silent = join(ISO, 'silent-scene');
  mkdirSync(silent, { recursive: true });
  writeFileSync(join(silent, 'scene.json'), '{}');
  check('F3 目录里没有音频 ⇒ null（不是抛错、不是编一个路径出来）',
    await kit.ensureSceneAudio(join(silent, 'scene.json')) === null);
  check('F4 主文件不存在 ⇒ null（不抛）',
    await kit.ensureSceneAudio(join(ISO, 'nope', 'scene.json')) === null);
  check('F5 不是 pkg 也不是目录主文件（坏 pkg）⇒ null',
    await kit.ensureSceneAudio(join(ISO, 'broken.pkg')) === null);

  // 负对照：让"取最大"退化成"取第一个"⇒ 同一条判据必须判红（否则"取最大"根本没人验）。
  const firstWins = await loadMutant('audio-first-wins', (s) => s.replace(
    'if (!best || st.size > best.size) best = { path: p,', 'if (!best) best = { path: p,'));
  check('F6 负对照：变异体把"取最大音频"退化成"取第一个" ⇒ 判据判红（会挑到 1024B 的 .mp3）',
    await audioPickHolds(firstWins.kit, firstWins.writes, dir, 'ogg', 4096) === false);
})();

// ═══ G. 覆盖面地板 ══════════════════════════════════════════════════════════
section('G. 覆盖面地板（防"判据在空域上恒真"）');
check('G1 正向判据数 ≥ 15（本文件真跑出结论的用例数，不许靠跳过凑绿）', passed >= 15, 'passed=' + passed);
check('G2 负对照（变异体）数 ≥ 5（每条判据都有牙齿）', mutantSeq >= 5, 'mutants=' + mutantSeq);
check('G3 本文件确实 import 了被测模块（不是隔着别的东西判）',
  typeof createSceneProbeKit === 'function' && readFileSync(SRC, 'utf8').includes('export function createSceneProbeKit'));

console.log('');
if (failed) {
  console.log(`SCENE-PROBE CHECKS FAILED — ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`ALL SCENE-PROBE CHECKS PASSED (${passed})`);
