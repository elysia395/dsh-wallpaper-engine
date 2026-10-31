import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * pet-link 浏览器半 · HTTP 点播请求夹具。
 *
 * 覆盖（对照 dsh-pet-dshwe 的 `/anim`、`/wake` 契约）：
 *  1) `/anim` 的 URL **必须**带 `surface=web`（运行时 `pet-lookup.ts` 的 `surfaceParam`：缺省即
 *     `bad-request` —— 缺这一条时面板显示"联动可用"而任何动作都被 400 挡回）；
 *  2) body 形状：`{name}`，只有显式合法朝向时才多一个 `facing`（`left` / `right`）；
 *  3) 非 ok 应答 ⇒ `playAnim` 返回 false（`unknown-animation` / `pet-not-displayed` / `bad-request` 都走这条），
 *     且**不**踢 `/state` 轮询；
 *  4) `/wake` 只校验 `pet`（`sleep.ts` 的 `requirePet` 没开 surface 档）⇒ URL 不带 surface，
 *     与 `/anim` 的差异是**契约差异**，不是漏写；
 *  5) petId 一律 URL 编码（中文 / 斜杠宠物 id 照常）。
 *
 * 口径与 `test/verify-pet-linked.mjs` 一致：直接读源码串起来求值，不依赖构建产物。
 * `createPetLink` 换成"抓 options"的假体 —— 本夹具要测的是 `src/client.js` 里那两个 HTTP 闭包。
 */

const source = readFileSync(new URL('../packages/pet-link/src/client.js', import.meta.url), 'utf8');

const PET_BASE = '/dsh-pet-dshwe-7340';
const ORIGIN = 'http://127.0.0.1:51845';
const NAME = '通用-右侧螃蟹步-dshwe';

const fakeLink = {
  warmup: () => true, tap: () => ({}), dispose() {},
  mode: () => 'linked', reason: () => '', detect: () => ({ mode: 'linked', reason: '' }),
  snapshot: () => ({}), getState: () => ({}),
  mascot: { tap: () => ({}) },
  performer: { onGrab: () => ({}), onPull: () => ({}), onRelease: () => ({}), snapshot: () => ({}) },
  tuner: { run: () => ({}), cancel() {}, snapshot: () => ({}) },
};

/**
 * 求值一次 `src/client.js`，返回它的运行面。
 * @param {'web'|'desktop'|string} [surface] - 注入 `petApiDshwe.link.surface` 的取值（缺省不注入）。
 * @returns {{options: object, fetches: {url: string, init: object}[], polls: () => number, feed: (body: any) => void}}
 */
function harness(surface) {
  const fetches = [];
  const queue = [];
  let polls = 0;
  const host = {
    weT: value => value,
    apiUrl: path => path,
    async apiFetch(url, init) {
      // meme 预取与诊断上报走的宿主面（apiUrl('/pet-link/official…')）与本夹具无关：预取在
      // apply 之后异步进行且每张失败还续一条 diag 上报，会把「恰好一次请求」的计数搅浑。
      // 返回安静失败应答（不 push、不 reject——reject 会变 unhandledRejection 崩进程）。
      if (String(url).includes('/pet-link/official')) return { ok: false, status: 404 };
      fetches.push({ url, init });
      if (queue.length === 0) throw new Error('夹具没有排应答');
      return queue.shift();
    },
    wallSidebarOpen: () => true,
    wallSidebarClose: () => true,
    wallSidebarToggle: () => true,
    registerPetLink: () => {},
    React: undefined,
    registerExtensionModule: undefined,
  };
  let options = null;
  const exportsShim = {};
  const build = new Function(
    'host', 'exports', 'window', 'document', 'location', 'localStorage', 'console',
    'createPetLink', 'createPetLinkTranslate', 'createPetLinkPanel', 'createPetLinkPanelSettings',
    'createPetLinkExtensionCard', 'setInterval', 'clearInterval',
    source,
  );
  build(
    host, exportsShim,
    { innerWidth: 1280, innerHeight: 800 },
    { querySelector: () => null },
    { origin: ORIGIN, search: '' },
    { getItem: () => null, setItem() {}, removeItem() {} },
    { warn() {}, log() {}, error() {} },
    captured => {
      options = captured;
      return fakeLink;
    },
    () => value => value,
    () => ({ install() {}, dispose() {}, toggle: () => true }),
    () => ({}),
    () => { throw new Error('本夹具不该注册扩展卡片（host 既无 React 也无注册入口）'); },
    () => 0, () => {},
  );
  assert.ok(options, '没有抓到 createPetLink 的 options（src/client.js 结构变了？）');
  assert.equal(typeof exportsShim.apply, 'function', 'src/client.js 仍应以 exports.apply 收尾');
  // 真装上：`probePetApi()` 读的是 `petLinkContext.get('petApiDshwe')`（可选探测），
  // 只有 apply 之后"点播成功踢 /state"这条通道才存在 —— 所以这里照真宿主的形状给一个 ctx。
  // `surface`：模拟 PET 侧 `link.surface`（任务三：both→web、单端→那端）；缺省不注入 ⇒ 回落 web。
  const apiService = { link: { pollState: () => { polls += 1; return true; }, ...(surface !== undefined ? { surface } : {}) } };
  let teardown = null;
  exportsShim.apply({
    get: name => (name === 'petApiDshwe' ? apiService : null),
    effect: fn => { teardown = fn(); },
  });
  assert.equal(typeof teardown, 'function', 'apply 应通过 ctx.effect 交接 teardown');
  return { options, fetches, feed: body => queue.push(body), polls: () => polls };
}

const h = harness();
const anim = (petId = 'main', opts = {}) => h.options.playAnim(petId, opts.name ?? NAME, opts.facing);

// ── 1) /anim URL：surface=web 必填 ─────────────────────────────────────────
h.feed({ data: { ok: true } });
assert.equal(await anim('main'), true, 'ok:true 的应答应返回 true');
assert.equal(h.fetches.length, 1, '每段点播恰好一次请求');
const url = h.fetches[0].url;
assert.equal(url, ORIGIN + PET_BASE + '/anim?pet=main&surface=web',
  'URL 必须带 surface=web（缺参数会被运行时判 bad-request），实际 ' + url);
assert.ok(url.includes('surface=web'), 'URL 里必须有 surface=web');
assert.equal(h.fetches[0].init.method, 'POST');
assert.equal(h.fetches[0].init.headers['Content-Type'], 'application/json');
assert.deepEqual(JSON.parse(h.fetches[0].init.body), { name: NAME }, 'body 只有 name（没给朝向）');
assert.equal(h.polls(), 1, '点播成功应踢一次 /state 轮询');
console.log('PASS /anim URL：' + url);

// ── 2) body：facing 只在合法时出现 ────────────────────────────────────────
for (const facing of ['left', 'right']) {
  h.feed({ data: { ok: true } });
  await anim('main', { facing });
  assert.deepEqual(JSON.parse(h.fetches.at(-1).init.body), { name: NAME, facing });
}
for (const bad of ['up', 'LEFT', '', null, 1]) {
  h.feed({ data: { ok: true } });
  await anim('main', { facing: bad });
  assert.deepEqual(JSON.parse(h.fetches.at(-1).init.body), { name: NAME },
    '非法朝向不该写进 body（facing=' + String(bad) + '）');
}
console.log('PASS /anim body：{name} 与 {name, facing:left|right}');

// ── 3) 非 ok 应答 ⇒ playAnim false 且不踢轮询 ────────────────────────────
const pollsBefore = h.polls();
for (const bad of [
  { data: { ok: false, reason: 'unknown-animation', message: '池里没有这个名字' } },
  { data: { ok: false, reason: 'pet-not-displayed', message: '不满足 surface=web' } },
  { data: { ok: false, reason: 'bad-request', message: 'surface 必填：web / desktop / both / any' } },
  { ok: true, data: null },
  undefined,
]) {
  h.feed(bad);
  assert.equal(await anim('main'), false, '非 ok 应答必须返回 false（' + JSON.stringify(bad) + '）');
}
assert.equal(h.polls(), pollsBefore, '点播失败不该踢 /state 轮询');
console.log('PASS /anim 失败面：非 ok ⇒ false（unknown-animation / pet-not-displayed / bad-request）');

// ── 4) /wake：只校验 pet，不带 surface ───────────────────────────────────
h.feed({ data: { ok: true, sleeping: false, changed: true } });
assert.equal(await h.options.wake('main'), true);
const wakeUrl = h.fetches.at(-1).url;
assert.equal(wakeUrl, ORIGIN + PET_BASE + '/wake?pet=main',
  '/wake 不校验 surface（sleep.ts 的 requirePet 没开 surface 档）⇒ 不该多带参数，实际 ' + wakeUrl);
assert.equal(h.fetches.at(-1).init.method, 'POST');
h.feed({ data: { ok: false, reason: 'unknown-pet' } });
assert.equal(await h.options.wake('main'), false, '非 ok 应答 ⇒ wake 返回 false');
console.log('PASS /wake URL：' + wakeUrl);

// ── 5) petId 编码 ────────────────────────────────────────────────────────
for (const petId of ['蓝 猫/1', 'main']) {
  h.feed({ data: { ok: true } });
  await anim(petId);
  const composed = h.fetches.at(-1).url;
  assert.ok(composed.includes('pet=' + encodeURIComponent(petId)), 'petId 必须 URL 编码：' + composed);
  assert.ok(composed.endsWith('&surface=web'), 'petId 之后仍必须带 surface=web：' + composed);
}
console.log('PASS petId 编码：' + h.fetches.at(-1).url);

// ── 6) surface 动态取值（t3）：按 link.surface 解析，缺省/非法回落 web ─────────
//   用户规则：both 只操控 web、单端操控那端 —— 由 PET 侧 link.surface 解析好，
//   这里只验证「照读 + 回落」：desktop 时 URL 真带 surface=desktop，/broadcast 同口径。
{
  const desktop = harness('desktop');
  desktop.feed({ data: { ok: true } });
  assert.equal(await desktop.options.playAnim('main', NAME), true);
  assert.equal(desktop.fetches.at(-1).url, ORIGIN + PET_BASE + '/anim?pet=main&surface=desktop',
    'link.surface=desktop 时 /anim 必须带 surface=desktop，实际 ' + desktop.fetches.at(-1).url);

  desktop.feed({ data: { ok: true } });
  assert.equal(await desktop.options.say('main', '你好'), true);
  assert.equal(desktop.fetches.at(-1).url, ORIGIN + PET_BASE + '/broadcast?pet=main&surface=desktop',
    'link.surface=desktop 时 /broadcast 也按同一 surface 取值，实际 ' + desktop.fetches.at(-1).url);

  for (const bad of [undefined, null, 'both', 'any', 'web ', '', 42]) {
    const h2 = harness(bad);
    h2.feed({ data: { ok: true } });
    assert.equal(await h2.options.playAnim('main', NAME), true);
    assert.equal(h2.fetches.at(-1).url, ORIGIN + PET_BASE + '/anim?pet=main&surface=web',
      'link.surface 缺失/非法（' + JSON.stringify(bad) + '）必须回落 surface=web，实际 ' + h2.fetches.at(-1).url);
  }
  console.log('PASS surface 动态取值：desktop 时 /anim·/broadcast 带 surface=desktop，缺失/非法回落 web');
}

console.log('PASS pet-link 点播请求（/anim 带 surface=web · body 形状 · 失败面 · /wake 口径）');