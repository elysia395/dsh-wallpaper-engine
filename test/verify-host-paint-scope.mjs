#!/usr/bin/env node
/**
 * 宿主容器「上色必须做状态限定」护栏 (host-container paint scope guard)
 *
 * 背景：宿主右栏面板容器 `[data-sidebar-right-panel]` 在**关闭态**仍然占着宽度 —— 宿主把
 * 隐藏做成"子元素 `visibility:hidden` + 沿 `--dsh-sidebar-width` 滑出"，容器自己**没有
 * 背景**，靠"没背景所以不显形"这个前提工作。而本插件无条件给这个容器刷了玻璃底/近不透明底
 * ⇒ 关闭态在对话区右侧露出一块中灰板（控制台零报错，用户会误判成主题/皮肤问题）。
 *
 * 这个前提有边界：容器**自己** `visibility:hidden` + `translate(100%)` 完全滑出时，刷底
 * 看不见 —— 所以限定必须认宿主**当前**给的那套标记，而不是"容器关着就没事"。加限定同时是
 * 向后兼容的 no-op：`data-sidebar-right-open` 由宿主自己给出，语义就是 `expanded || void 0`。
 *
 * 本护栏把规则固化：**凡是给 `[data-sidebar-right-panel]` 上色的选择器，都必须带
 * `[data-sidebar-right-open]`**。它防的是"类"而不是这一次 —— 新增一条刷底规则忘了限定，
 * 行为断言（`verify-scene-live` / `verify-readability` 等）都不会变红。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 读**构建产物**（与 verify-readability 同源）：它才是实际注入浏览器的字符串。
// 源码侧的选择器同名同形，改 src 后必须 `npm run build` 才会在这里生效（这也顺带
// 断住"改了源码忘了重建"）。
const SRC = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8');
let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('PASS | ' + name + (detail ? ' | ' + detail : ''));
  else { console.log('FAIL | ' + name + (detail ? ' | ' + detail : '')); failed++; }
}

// 注入的样式表：与 verify-readability 同法求值（选择器本身不含插值，但保持同一来源）。
// ⚠️ 锚点**锚在行首且容忍缩进**（产物把内联模块整段缩进过）：否则注释/散文里出现同样的
//    声明字面量会把锚点带偏，取出的"模板"会从注释一直吃到文件尾。
const CSS_BODY = (SRC.match(/^\s*const CSS = `([^`]*)`;/m) || [])[1] || '';
const num = (re) => Number((SRC.match(re) || [])[1]);
let CSS = '';
try {
  CSS = new Function('READABILITY_FLOOR', 'READABILITY_FLOOR_DARK', 'return `' + CSS_BODY + '`;')(
    num(/const READABILITY_FLOOR = ([\d.]+);/), num(/const READABILITY_FLOOR_DARK = ([\d.]+);/));
} catch { CSS = CSS_BODY; }

const TARGET = '[data-sidebar-right-panel]';
const GATE = '[data-sidebar-right-open]';

/** 取出每个 `[data-sidebar-right-panel]` 出现处所在规则的**选择器原文**（未压空白）。 */
function panelSelectors(css) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(TARGET, from);
    if (at < 0) break;
    from = at + TARGET.length;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', at);
    // 只在**选择器位置**上判定：该出现处后面必须先遇到 `{`（规则头），而不是先遇到 `}`。
    if (open < 0 || (close >= 0 && close < open)) continue;
    const start = Math.max(css.lastIndexOf('{', at), css.lastIndexOf('}', at)) + 1;
    out.push(css.slice(start, open));
  }
  return out;
}
const NORM = (s) => s.replace(/\s+/g, ' ').trim();

const rawSels = panelSelectors(CSS);
const sels = rawSels.map(NORM);
const unqualified = sels.filter((s) => !s.includes(GATE));
const qualified = sels.filter((s) => s.includes(GATE));

// ── H0 模板完整性：CSS 模板内不得出现反引号 ──────────────────────────────────
// 整段样式表是一个模板字符串；注释里写 markdown 反引号会**提前截断**它，于是所有
// "提取样式表"的护栏（本文件与 verify-readability F1b）都读到空串 —— 而且报错信息
// 只说"css chars=0"，不看源码根本猜不到原因。这条把它变成一句人能看懂的失败。
{
  // ⚠️ 取模板的三处都必须**容忍缩进**，一件事都不能写死：
  //   · 起始锚：`const CSS = ` —— 用行首锚定（`^\s*`），散文里出现同样字面量时不会带偏；
  //   · 结束标记：写死 `'\n\t\t`;'`（正文里是 2 个 tab）就会失效 —— 样式表搬进**内联模块**
  //     后整段缩进变成 4 个 tab，写死的标记找不到，切片会一路吃到文件尾
  //（**实测**：那时 H0 报"模板长度 1130572 字符" = 整份 bundle）。
  const startMatch = /^\s*const CSS = `([^`]*)`;/m.exec(SRC);
  const region = startMatch ? startMatch[1] : '';
  // ⚠️ 这里**不许**断言"提取到的模板里没有裸反引号"：抽取正则本身就是 `[^`]*`，该断言对
  // 任何输入恒真（数学恒等式）；"注入一个反引号后被抓到 1/1"也只是拿测试自己刚写下的串跟同一段
  // 正则比（C3）。真正会失真的量是**抽取长度**，两个方向都要红：
  //   ① 裸反引号**提前终止**模板字面量 ⇒ 抽取结果骤短；
  //   ② 结束锚失配、切片一路吃到文件尾 ⇒ 结果是整份 bundle（实测那种"读到 bundle"是
  //      1130572 字符）。
  // 实测 CSS 本体 208118 字符（lib/client.js），上下限各留余量。
  const CSS_FLOOR = 1000;
  const CSS_CEIL = 400000;
  check('H0 CSS 模板抽取完整（裸反引号 ⇒ 提前截断骤短；结束锚失配 ⇒ 吃到文件尾）',
    region.length > CSS_FLOOR && region.length < CSS_CEIL,
    `模板长度 ${region.length} 字符（应落在 ${CSS_FLOOR}–${CSS_CEIL} 之间）`);
}

// 负对照：把**某条真实选择器**（不是注释）里的状态属性删掉，同一判定必须报出未限定。
// ⚠️ 两个坑都踩过：①用"压过空白的选择器"去 replace 原文对不上（静默不生效）；
// ②删"CSS 里第一处 [data-sidebar-right-open]"实际删的是**注释里**那一处。
const firstRaw = rawSels[sels.findIndex((s) => s.includes(GATE))];
const mutated = firstRaw ? CSS.replace(firstRaw, firstRaw.replace(GATE, '')) : CSS;
const unqualifiedAfterMutation = panelSelectors(mutated).map(NORM).filter((s) => !s.includes(GATE));

check('H1 给宿主右栏面板上色的每条规则都限定在展开态（[data-sidebar-right-open]）',
  sels.length >= 6 && unqualified.length === 0 && qualified.length >= 6
  && firstRaw !== undefined && mutated !== CSS && unqualifiedAfterMutation.length >= 1,
  `命中规则 ${sels.length} 条（已限定 ${qualified.length}）` +
  `${unqualified.length ? ' · 未限定: ' + unqualified.join(' | ') : ''}` +
  ` · 负对照 去掉一条选择器的限定后被抓到 ${unqualifiedAfterMutation.length >= 1 ? 1 : 0}/1`);

// ── H2（仅报告）：其它被我们上色的宿主原生容器 ────────────────────────────────
// 判据同上：这些元素是否"留在布局里、只靠子元素隐藏"需要各自核对；本护栏只负责把
// 审计面列出来（#107 类的形态是：这类前提一旦被宿主改掉，插件侧就是静默的视觉回归）。
const MARKERS = ['[data-dsh-better-sidebar]', '.dshDesktopSidebarSurface', '[data-composer-card]', '[role="dialog"]'];
const audit = MARKERS.map((m) => {
  let n = 0, from = 0;
  for (;;) {
    const at = CSS.indexOf(m, from);
    if (at < 0) break;
    from = at + m.length;
    const open = CSS.indexOf('{', at);
    const close = CSS.indexOf('}', at);
    if (open >= 0 && (close < 0 || open < close)) n++;
  }
  return m + '×' + n;
});
console.log('INFO | H2 其它被上色的宿主容器（需各自核对"关闭态是否留在布局里"）: ' + audit.join(' · '));

// ── H3：满屏 body 级浮层必须放行窗口拖拽（上游 #120）──────────────────────────
// 背景：macOS 桌面壳没有原生标题栏，可拖几何**全部**来自 Web 侧的 drag 行；而宿主前端有一条
// darwin 规则 `html[data-platform=darwin] body>:not(#root){-webkit-app-region:no-drag}`，
// 它把 body 下每个非 #root 直接子元素当成**no-drag 矩形**。Electron 对 no-drag 的语义是
// **几何挖除** —— 与绘制顺序、z-index、pointer-events 都无关。本插件把 `.we-layer` /
// `.we-scrim` 这两个 `inset:0` 的整屏层直接挂在 body 上 ⇒ 整个窗口的可拖区被挖空，顶栏
// 整片失灵（1.1.0 实测：顶栏空白点 0/6 可拖）。
//
// 为什么要有这条判据：它**在 Windows 上无法用行为复现**（Windows 走的是另一套标题栏规则），
// 而其它判据也看不见它（层照常出现、样式照常解析）。没有这条，"以后再挂一个 body 级满屏层"
// 会静默复发。
//
// 判据要求两条**同时**成立（缺一不可，理由各不相同）：
//   · 值必须是 `initial` 而**不是 `none`** —— Chromium 把关键字 none 归进 no-drag 模式，
//     写 none 等于什么都没修（computed 仍是 no-drag）；
//   · 必须带 `!important` —— 宿主那条规则带 id 选择器（特异性 1,1,2），而我们只有 (0,1,0)，
//     没有 !important 必输。
{
  const DECL = /-webkit-app-region\s*:\s*initial\s*!important/;
  /**
   * 取 `.cls { … }` 这条**规则本体**。
   * ⚠️ 必须锚在 `.cls {`（带大括号）上，**不能**只锚 `.cls `（带空格）：带空格的形态在
   *    **注释里也会出现**（例如"（.we-layer .we-media）上"这种散文），从注释处切片会一路
   *    吃到后面那条真规则，导致"规则体"里混着注释 —— 负对照于是改到注释里的那个词上、
   *    永远报绿（本判据第一版就是这么写的，负对照 0/1 当场把它抓了出来）。
   */
  const ruleOf = (cls) => {
    const i = CSS.indexOf(cls + ' {');
    if (i < 0) return '';
    const open = CSS.indexOf('{', i);
    const close = CSS.indexOf('}', open);
    return open < 0 || close < 0 ? '' : CSS.slice(i, close + 1);
  };
  const LAYER = ruleOf('.we-layer');
  const SCRIM = ruleOf('.we-scrim');
  const isFullViewport = (r) => /inset:\s*0\b/.test(r);
  const ok = (r) => DECL.test(r);

  // 负对照走**同一个**判据函数：把值换成 none、以及去掉 !important，都必须被判出。
  const stripImportant = (r) => r.replace(/\s*!important/, '');
  const toNone = (r) => r.replace(/initial/, 'none');
  const negValue = LAYER.length > 0 && ok(toNone(LAYER)) === false;
  const negImportant = LAYER.length > 0 && ok(stripImportant(LAYER)) === false;

  check('H3 满屏 body 级浮层放行窗口拖拽（initial 而非 none，且带 !important）',
    LAYER.length > 0 && SCRIM.length > 0 && isFullViewport(LAYER) && isFullViewport(SCRIM)
    && ok(LAYER) && ok(SCRIM) && negValue && negImportant,
    `.we-layer ${ok(LAYER) ? '已放行' : '未放行'} · .we-scrim ${ok(SCRIM) ? '已放行' : '未放行'}` +
    ` · 负对照 值改成 none 被抓到 ${negValue ? 1 : 0}/1 · 去掉 !important 被抓到 ${negImportant ? 1 : 0}/1`);
}

// ── H4：右栏面板的玻璃规则必须把面板抬回 dockkit dock 层（#150）─────────────────
// 背景：宿主 0.2.0-rc.x 的 dockkit 层级体系是「面板内部的 dock 单元消费
// --dsh-dockkit-dock-layer（常态 10 / 右栏全屏 40）」拿到 z-index，从而盖住会话列
// （会话侧最高 z=9）。我们给**面板元素本身**上 backdrop-filter ⇒ 面板自成层叠上下文
// （z=auto 档），内部 dock 单元的 z 被困在面板里，整个面板作为原子被会话侧的
// z=1（hero 输入卡）/ z=7（composerSeat）反压 —— push / 收起态没有空间重叠看不出来，
// 唯独「右栏全屏」面板与对话列重叠时输入卡穿透玻璃面板叠在侧栏上（issue #150）。
// 修法 = 玻璃规则同时把面板本身抬到同一个 var（var 就声明在面板上，全屏自动 40）。
// 判据：**凡是对面板声明了非 none 的 backdrop-filter 的规则，必须同条声明
// z-index: var(--dsh-dockkit-dock-layer, …)**。防的是"类"：将来再往这条规则里加效果、
// 或新写一条带模糊的右栏规则，忘了抬层就当场红。回退档（backdrop-filter: none）与
// 主开关兜底（只上不透明底色）不成层叠上下文，刻意不要求。
{
  // 取出每条「选择器含面板 + 规则体声明了 blur 型 backdrop-filter」的规则体。
  // 选择器位置的判定与 panelSelectors 同款（TARGET 后必须先遇 { 而非 }）。
  const blurRules = [];
  {
    let from = 0;
    for (;;) {
      const at = CSS.indexOf(TARGET, from);
      if (at < 0) break;
      from = at + TARGET.length;
      const open = CSS.indexOf('{', at);
      const close = CSS.indexOf('}', at);
      if (open < 0 || (close >= 0 && close < open)) continue; // 注释/散文里的出现处
      const selStart = Math.max(CSS.lastIndexOf('{', at), CSS.lastIndexOf('}', at)) + 1;
      const sel = NORM(CSS.slice(selStart, open));
      if (!sel.includes(TARGET) || !sel.includes(GATE)) continue;
      const body = CSS.slice(open + 1, close);
      if (/backdrop-filter\s*:\s*blur/.test(body)) blurRules.push({ sel, body });
    }
  }
  const lifted = (r) => /z-index\s*:\s*var\(--dsh-dockkit-dock-layer/.test(r.body);
  // 负对照 ①：把真规则的 z-index 声明删掉，同一条判据必须报出；
  // 负对照 ②：合成一条「有 blur 没抬层」的规则，也必须报出。
  const stripped = blurRules[0]
    ? { sel: blurRules[0].sel, body: blurRules[0].body.replace(/\s*z-index\s*:\s*var\(--dsh-dockkit-dock-layer[^;]*;/, '') }
    : null;
  const negStripped = stripped ? lifted(stripped) === false : false;
  const synthetic = { sel: TARGET, body: 'backdrop-filter: blur(9px);' };
  const negSynthetic = lifted(synthetic) === false;

  check('H4 右栏面板玻璃规则带 backdrop-filter 就必须抬回 dockkit dock 层（z-index: var(--dsh-dockkit-dock-layer)）',
    blurRules.length >= 1 && blurRules.every(lifted) && negStripped && negSynthetic,
    `blur 规则 ${blurRules.length} 条（未抬层 ${blurRules.filter((r) => !lifted(r)).length}）` +
    ` · 负对照 删真规则抬层被抓到 ${negStripped ? 1 : 0}/1 · 合成无抬层规则被抓到 ${negSynthetic ? 1 : 0}/1`);
}

console.log(failed === 0 ? '\nverify-host-paint-scope: OK' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
