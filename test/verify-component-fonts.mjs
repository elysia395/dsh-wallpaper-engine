/**
 * verify-component-fonts.mjs — G4 组件字体通道的守卫。
 *
 * 这条通道抓的是 DSH 的 CSS-module 类名（`_模块_哈希_行`），**是打包器产物而非官方 API**
 * ⇒ 守卫的重点不是"功能对不对"，而是"**不许越界**"：
 *   · 选择器只能是 `body [class*="_<白名单模块名>_"]` 这一种形态（不许裸类名/标签/`:has()`/祖先关联）；
 *   · 选择器**只能由组件 id 生成**（模块名不许从外部传进来），且只写白名单内的组件；
 *   · 只写三个字体属性；不许把**哈希**写进代码（写死哈希 = DSH 一升级就静默失效）；
 *   · **`id` 与模块名分离**：`id` 是设置键（稳定），模块名是实测产物（会变）；
 *   · **泛模块名只许出现在 `route: 'hooks'` 通道**：那里写的是自定义属性，写在非消费方元素上
 *     是惰性的；写真实属性的通道用泛模块名会误伤同名元素 ⇒ `buildComponentCss` 必须跳过 hooks；
 *   · 未命中的组件整条不启用（自探测降级）；
 *   · 空配置不生成任何规则（**官方值作初始值**：不设置 = 回官方）。
 *
 * ⚠️ **覆盖缺口（已知、不假装有牙）**：模块名的**真伪**（它是否真的存在于 DSH 产物里）
 * 无法在这里判定 —— 守卫读不到 DSH 安装目录。它只能靠"实测记录 + 启动自探测降级"兜住：
 * 名字写错时那一行只是静默不生效。改动白名单时**必须**照 src/font/components.js 文件头
 * 记的口径重新实测。
 *
 * **负对照的形态规则（P3-16）**：变异输入必须喂进**同一条判据**（同一个命名函数 / 同一个正则
 * 常量）。两种写法不算数：① 只断言"某个常量 / 数组不含 X" —— 判据根本没被执行；
 * ② 在对照里另抄一份判据 —— 生产侧（这里是 `src/font/components.js`）改了它也不会红。
 * 规则全文与其余守卫约定见 [`docs/DEV-GUIDE.md`](../docs/DEV-GUIDE.md) §4.7。
 *
 * Usage:  node test/verify-component-fonts.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments } from './tools/js-text.mjs';
// 单独 import `src/**` 时补上 bundle 作用域的取词层（中文身份；见该文件头）。
import { installWeTShim } from './tools/weT-shim.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 文案层（i18n）：本模块的 label / group 是**每读现取**的 getter（`get label() { return weT("…") }`，
// 中文原文即键）。单独 import 时 bundle 作用域里的 `weT` 不在场 ⇒ 先装共享身份 shim
// （`test/tools/weT-shim.mjs`），判据读到的就是面板在中文下会显示的那串。
installWeTShim();
const mod = await import(new URL('../src/font/components.js', import.meta.url).href);
const { COMPONENT_FONT_TARGETS, COMPONENT_FONT_PROPS, probeComponentTargets, buildComponentCss, selectorFor } = mod;

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};
const section = (t) => console.log('\n' + t);
/** 判据只认代码：调用点沿用短名 `strip`。 */
const strip = stripComments;

const ALL = COMPONENT_FONT_TARGETS.map((t) => t.id);
const MARKDOWN = 'markdown';

// ── 命名判据（正判据与负对照**共用同一份** —— 见文件头的形态规则）─────────────
const SELECTOR_SHAPE = /^body \[class\*="_[A-Za-z][A-Za-z0-9]*_"\] \{$/;
const HASHED_CLASS = /_[A-Za-z0-9]+_[a-z0-9]{5,}_\d+/;
/** 泛模块名（跨模块重名）：只许出现在 hooks 通道（那里写自定义属性，非消费方元素上惰性）。 */
const GENERIC_PREFIXES = ['label', 'tab', 'input', 'content', 'item', 'row', 'block'];
/** 这段 CSS 里所有**白名单外**的属性声明。 */
const offendingProps = (css) => [...css.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1])
  .filter((p) => !COMPONENT_FONT_PROPS.includes(p));
/** 泛模块名是否只出现在 hooks 通道。 */
const genericOnlyInHooks = (list) => list.every((t) => !GENERIC_PREFIXES.includes(t.prefix) || t.route === 'hooks');
/** 是否每一项都登记了 `.module.css` 出处。 */
const allHaveModuleCssSource = (sources) => sources.every((s) => typeof s === 'string' && s.endsWith('.module.css'));
/** 声明出来的钩子是否全在官方白名单内（防漂移）。 */
const hooksAllKnown = (list, hooks) => list.every((h) => hooks.includes(h));

// ── ① 选择器形态（唯一合法模板） ────────────────────────────────────────────
section('① 选择器形态：只许 `body [class*="_前缀_"]`');
{
  const sel = selectorFor(MARKDOWN);
  check('形态正确', sel === 'body [class*="_markdown_"]', sel);
  check('拒绝裸类名形态', (() => { try { selectorFor('.markdown'); return false; } catch { return true; } })());
  check('拒绝不在白名单的前缀', (() => { try { selectorFor('evilTarget'); return false; } catch { return true; } })());
  check('拒绝带特殊字符的前缀', (() => { try { selectorFor('a b'); return false; } catch { return true; } })());
  const css = buildComponentCss({ markdown: { size: 15 } }, ALL);
  check('生成的 CSS 里每个选择器都符合唯一形态',
    css.split('\n').filter((l) => l.includes('{')).every((l) => SELECTOR_SHAPE.test(l.trim())),
    css.split('\n').filter((l) => l.includes('{')).join(' | '));
  check('负对照：形态判据对越界写法有牙',
    ['.markdown {', 'body :has(.markdown) {', 'body .markdown {', 'body [class*="_markdown"] {']
      .every((s) => !SELECTOR_SHAPE.test(s))
    && SELECTOR_SHAPE.test('body [class*="_markdown_"] {')); // 反向：合规形态必须被接受
}

// ── ② 只写白名单前缀 + 三个字体属性 ─────────────────────────────────────────
section('② 白名单与前缀/属性边界');
{
  const css = buildComponentCss(
    { markdown: { size: 15, weight: 600, family: '"KaiTi"' }, evilTarget: { size: 99 } }, ALL);
  check('只出现白名单内前缀', !css.includes('evilTarget'));
  const bad = offendingProps(css);
  check('只写 font-size / font-weight / font-family', bad.length === 0, bad.join(' ') || '（无越界属性）');
  // 变异输入喂进**同一条**判据：越界属性必须被抓到，合规的那份必须放行
  check('负对照：属性判据能抓到越界属性',
    offendingProps('body [class*="_markdown_"] {\n  font-size: 15px;\n  line-height: 1.5;\n}').length === 1
    && offendingProps('body [class*="_markdown_"] {\n  font-size: 15px;\n}').length === 0);
}

// ── ③ 自探测降级 ────────────────────────────────────────────────────────────
section('③ 自探测：未命中整条不启用（按模块名采样，返回组件 id）');
{
  const fake = (hits) => ({ querySelectorAll: (sel) => ({ length: hits.some((h) => sel.includes('_' + h + '_')) ? 1 : 0 }) });
  const hit = probeComponentTargets(fake(['markdown', 'tableScroll']));
  check('只返回命中的组件 id', JSON.stringify(hit.slice().sort()) === JSON.stringify(['markdown', 'table']), hit.join(' '));
  // 代码块与终端块共用模块名 `block` ⇒ 命中一个即两条都启用（各自的钩子仍互不干扰）
  const shared = probeComponentTargets(fake(['block']));
  check('共用模块名的两个组件一起命中', JSON.stringify(shared.slice().sort()) === JSON.stringify(['codeBlock', 'terminal']), shared.join(' '));
  const none = probeComponentTargets(fake([]));
  check('全不命中 ⇒ 空数组（打包器改名时整条降级）', none.length === 0);
  check('没有 document 也不炸', probeComponentTargets(null).length === 0);
  const css = buildComponentCss({ markdown: { size: 15 }, table: { size: 14 } }, ['markdown']);
  check('只给命中的组件生成规则', css.includes('_markdown_') && !css.includes('_tableScroll_'));
  check('负对照：全命中时两个都该生成',
    buildComponentCss({ markdown: { size: 15 }, table: { size: 14 } }, ['markdown', 'table']).includes('_tableScroll_'));
  // 这条是"泛模块名可以共用"的前提：真实属性通道必须把 hooks 组件整体排除
  check('buildComponentCss 绝不写 hooks 通道的组件（否则误伤同名的搜索块 / 网页块）',
    buildComponentCss({ codeBlock: { size: 20 }, terminal: { size: 20 } }, ['codeBlock', 'terminal']) === '');
  check('负对照：同一次调用里非 hooks 组件照常生成（判据有牙）',
    buildComponentCss({ markdown: { size: 20 } }, ['markdown']).includes('font-size: 20px'));
}

// ── ④ "官方值作初始值"：空配置不生成 ────────────────────────────────────────
section('④ 空 = 回官方（不生成规则）');
{
  check('空配置 ⇒ 空串', buildComponentCss({}, ALL) === '');
  check('缺键 ⇒ 空串', buildComponentCss({ markdown: {} }, ALL) === '');
  check('0 / 空串 ⇒ 不覆盖该项',
    buildComponentCss({ markdown: { size: 0, weight: 0, family: '' } }, ALL) === '');
  const partial = buildComponentCss({ markdown: { size: 15 } }, ALL);
  check('只设字号 ⇒ 只写 font-size（其余保持官方）',
    partial.includes('font-size: 15px') && !partial.includes('font-weight') && !partial.includes('font-family'));
  check('越界值被忽略（字重 50 / 字号 -3）',
    buildComponentCss({ markdown: { weight: 50 } }, ALL) === ''
    && buildComponentCss({ markdown: { size: -3 } }, ALL) === '');
  check('负对照：合法边界值必须被接受（字重 100/900、字号 1）',
    buildComponentCss({ markdown: { weight: 100 } }, ALL).includes('font-weight: 100')
    && buildComponentCss({ markdown: { weight: 900 } }, ALL).includes('font-weight: 900')
    && buildComponentCss({ markdown: { size: 1 } }, ALL).includes('font-size: 1px'));
}

// ── ⑤ 源码不变量 ────────────────────────────────────────────────────────────
section('⑤ 源码不变量');
{
  const code = strip(readFileSync(join(root, 'src', 'font', 'components.js'), 'utf8'));
  check('零 !important（写死的声明里 315/319 无 !important ⇒ 等特异性即可）', !/!\s*important/.test(code));
  // 判据只针对**生成的 CSS**（源码里的 `length > 0` 是 JS 比较符，不是 CSS 子组合器 ——
  // 对源码做 `\s>\s` 匹配是假阳性）。
  check('零 :has() / 祖先关联选择器（白闪红线 1）',
    !/:has\(/.test(code)
    && !buildComponentCss({ markdown: { size: 15 } }, ALL).includes('>')
    && !buildComponentCss({ markdown: { size: 15 } }, ALL).includes('~'));
  check('**不把哈希写进代码**（写死哈希 = DSH 一升级就静默失效）', !HASHED_CLASS.test(code));
  check('不碰 katex 与 @font-face', !/katex/i.test(code) && !/@font-face/.test(code));
  check('负对照：哈希判据对真实哈希类名有牙',
    HASHED_CLASS.test('_wordmark_u7vgf_31') && !HASHED_CLASS.test('_markdown_plain'));
  check('属性白名单就是三项', JSON.stringify(COMPONENT_FONT_PROPS) === JSON.stringify(['font-size', 'font-weight', 'font-family']));
  // 棘轮：首期口径 3–5 个组件。**上限就是棘轮** —— 想加组件必须同时改这条断言（有意动作），
  // 并按 components.js 文件头记的口径**实测**模块名，不许按"组件叫什么"猜。
  check('首期白名单 3–5 个组件（上限即棘轮）',
    COMPONENT_FONT_TARGETS.length >= 3 && COMPONENT_FONT_TARGETS.length <= 5, String(COMPONENT_FONT_TARGETS.length));
  check('组件 id 唯一（id 是设置键：重复 = 两行抢同一份配置）',
    new Set(COMPONENT_FONT_TARGETS.map((t) => t.id)).size === COMPONENT_FONT_TARGETS.length,
    COMPONENT_FONT_TARGETS.map((t) => t.id).join(' '));
  check('每个白名单项都有 id/label/group/prefix 且 route 合法',
    COMPONENT_FONT_TARGETS.every((t) => t.id && t.label && t.group && t.prefix
      && ['tokens', 'hooks', 'props'].includes(t.route)));
  // 泛模块名（跨模块重名）只许出现在 hooks 通道：那里写的是自定义属性，非消费方元素上是惰性的。
  // 写真实属性的通道用了泛名 ⇒ 会打到同名的别的块上（搜索块 / 网页块），必须红。
  check('泛模块名只许出现在 hooks 通道（写真实属性的通道不得用）',
    genericOnlyInHooks(COMPONENT_FONT_TARGETS),
    COMPONENT_FONT_TARGETS.map((t) => t.id + ':' + t.prefix + '/' + t.route).join(' '));
  check('负对照：把泛模块名挪到非 hooks 通道会被判出',
    !genericOnlyInHooks([{ id: 'x', prefix: 'block', route: 'tokens' }])       // 泛名 + 真实属性通道 ⇒ 红
    && genericOnlyInHooks([{ id: 'x', prefix: 'block', route: 'hooks' }])      // 反向：hooks 通道放行
    && genericOnlyInHooks([{ id: 'x', prefix: 'markdown', route: 'tokens' }])); // 非泛名放行
  // 一个模块名可以被两条共用（代码块 / 终端块），但**不许**三条以上：共用越多，
  // "面板默认值只读第一个命中元素"这条已知代价的偏差面越大。
  {
    const byPrefix = new Map();
    for (const t of COMPONENT_FONT_TARGETS) byPrefix.set(t.prefix, (byPrefix.get(t.prefix) || 0) + 1);
    const worst = Math.max(...byPrefix.values());
    check('同一模块名最多被 2 个组件共用', worst <= 2, '最多的模块名被 ' + worst + ' 条共用');
  }
}

// ── ⑤b 每个组件的模块名必须有**实测出处**（B4）──────────────────────────────
// 这条通道最脆的地方是"模块名是猜的"（本仓真发生过：三个猜出来的名字在 DSH 里都不存在，
// 那三行静默无效）。守卫读不到 DSH 安装目录时至少能强制**登记出处**；本机装了 DSH 时
// 顺带把出处**真的打开核对**一遍（这是唯一能机器判定"名字是真的"的路子）。
section('⑤b 模块名的实测出处（source）');
{
  const bad = COMPONENT_FONT_TARGETS.filter((t) => !allHaveModuleCssSource([t.source]));
  check('每个组件都登记了 .module.css 出处', bad.length === 0,
    bad.map((t) => t.id).join(' ') || COMPONENT_FONT_TARGETS.map((t) => t.id).join(' '));
  check('负对照：出处判据对缺失/乱填有牙',
    !allHaveModuleCssSource([undefined]) && !allHaveModuleCssSource(['guess.css']) && !allHaveModuleCssSource([''])
    && allHaveModuleCssSource(['block.module.css']));
  // 机会性核对：装了 DSH 就逐个打开出处文件，断言里面真的定义了 `.prefix`。
  // 没装则显式跳过（并打印），不假装有牙 —— CI 上没有 DSH，这条必须能安全跳过。
  // 候选位置：环境变量优先，其次几个常见安装位置；全都不在就跳过。
  const dshCandidates = [
    process.env.DSH_WE_DSH_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DSH Desktop', 'resources', 'app'),
    'C:\\Program Files\\DSH Desktop\\resources\\app',
    'D:\\DSH Desktop\\resources\\app',
  ].filter(Boolean);
  const dshRoot = dshCandidates.find((c) => existsSync(join(c, 'node_modules'))) || null;
  const nm = dshRoot ? join(dshRoot, 'node_modules') : null;
  if (nm) {
    const wrong = [];
    for (const t of COMPONENT_FONT_TARGETS) {
      const abs = join(nm, String(t.source));
      if (!existsSync(abs)) { wrong.push(t.id + ':缺文件'); continue; }
      const css = readFileSync(abs, 'utf8');
      // 类名必须作为**独立的类选择器**出现（`.block` 不能靠 `.blockWrap` 之类的子串蒙混）
      const re = new RegExp('^\\.' + t.prefix + '(?![A-Za-z0-9_-])', 'm');
      if (!re.test(css)) wrong.push(t.id + ':' + t.prefix);
    }
    check('★ 出处文件真实存在且里面定义了该模块名（本机 DSH 静态核对）', wrong.length === 0,
      wrong.join(' ') || COMPONENT_FONT_TARGETS.length + ' 个组件逐个核对通过（' + dshRoot + '）');
    check('负对照：核对判据对不存在的类名有牙',
      !new RegExp('^\\.' + 'definitelyNotAClass' + '(?![A-Za-z0-9_-])', 'm')
        .test(readFileSync(join(nm, String(COMPONENT_FONT_TARGETS[0].source)), 'utf8')));
  } else {
    console.log('  · 跳过出处核对（本机没有 DSH 安装：' + nm + '；可用 DSH_WE_DSH_ROOT 指定）');
  }
}

// ── ⑥ G3：官方 `--dsl-*` 组件钩子 ───────────────────────────────────────────
section('⑥ G3 官方钩子（--dsl-*，作用域 = 钩子的**定义点**）');
{
  const HOOKS = mod.DSL_FONT_HOOKS.map((h) => h.name);
  check('钩子白名单就是官方那三个（不多不少）',
    JSON.stringify(HOOKS.sort()) === JSON.stringify([
      '--dsl-code-block-banner-font', '--dsl-code-block-content-font', '--dsl-terminal-font'].sort()),
    HOOKS.join(' '));
  // 防漂移主线：route=hooks 的组件声明的钩子必须全在官方白名单里
  const declared = COMPONENT_FONT_TARGETS.flatMap((t) => t.dslHooks || []);
  check('所有声明的钩子都在官方白名单内（防漂移）', hooksAllKnown(declared, HOOKS), declared.join(' '));
  check('每个组件都标了 route（tokens/hooks/props）',
    COMPONENT_FONT_TARGETS.every((t) => ['tokens', 'hooks', 'props'].includes(t.route)));
  check('route=hooks 的组件必须声明至少一个钩子',
    COMPONENT_FONT_TARGETS.filter((t) => t.route === 'hooks').every((t) => (t.dslHooks || []).length > 0));

  // 作用域由**扫描样式表**得到：代码块与终端共用模块名 `.block`，但定义点不同 ⇒ 必须分开。
  const SCOPES = {
    '--dsl-code-block-content-font': '._cbHASH_1',
    '--dsl-code-block-banner-font': '._cbHASH_1',
    '--dsl-terminal-font': '._termHASH_2',
  };
  const css = mod.buildDslBlocks({ codeBlock: { size: 14, family: '"KaiTi"' } },
    ['codeBlock', 'terminal'], () => true, SCOPES);
  check('写进**该钩子的定义点**（而不是按模块名生成的泛作用域）',
    css.includes('._cbHASH_1 {') && !css.includes('[class*="_block_"]'), css.split('\n')[0]);
  check('用官方钩子名，且组合式取自 DSH 细粒度令牌',
    css.includes('--dsl-code-block-content-font:') && css.includes('var(--dsw-font-markdown-code-block-font-weight)')
    && css.includes('var(--dsw-font-markdown-code-block-line-height)'), css.split('\n')[1]);
  check('只动用户改的两项（字号/字族），字重与行高沿用 DSH 令牌',
    css.includes('14px') && css.includes('"KaiTi"') && !css.includes('font-weight:'));
  check('零 !important（等特异性即可 —— 简写在组件根作用域上）', !/!\s*important/.test(css));
  // 本轮修掉的两处遗留，各一条断言：
  const both = mod.buildDslBlocks({ codeBlock: { size: 14 }, terminal: { size: 13 } },
    ['codeBlock', 'terminal'], () => true, SCOPES);
  check('★ 代码块与终端落到**各自**的定义点（改一个不再连带改另一个）',
    both.includes('._cbHASH_1 {') && both.includes('._termHASH_2 {'));
  check('★ 两个组件的钩子各自成块（不混进同一条规则）',
    (both.match(/\{/g) || []).length === 2);
  check('同一组件的多个钩子合并进它自己的定义点',
    (css.match(/\{/g) || []).length === 1
    && css.includes('--dsl-code-block-banner-font:'));
  // 共用作用域安全的前提：这里只写自定义属性。
  check('hooks 通道只写自定义属性（共用/精确作用域都安全的前提）',
    !/^\s*font-/m.test(css) && !/^\s*font:/m.test(css));
  // 降级：没有定义点 或 定义点形态不合规 ⇒ 该钩子不生成（不退回泛命中）
  check('未命中的组件不生成（自探测降级）',
    mod.buildDslBlocks({ terminal: { size: 13 } }, ['codeBlock'], () => true, SCOPES) === '');
  check('扫不到定义点 ⇒ 不生成（不退回按模块名的泛作用域）',
    mod.buildDslBlocks({ codeBlock: { size: 14 } }, ['codeBlock'], () => true, {}) === '');
  check('定义点形态不合规 ⇒ 拒绝注入（复合/后代/列表选择器）',
    mod.buildDslBlocks({ codeBlock: { size: 14 } }, ['codeBlock'], () => true,
      { '--dsl-code-block-content-font': 'body .x', '--dsl-code-block-banner-font': '.a, .b' }) === '');
  check('负对照：合规定义点必须被接受',
    mod.buildDslBlocks({ codeBlock: { size: 14 } }, ['codeBlock'], () => true, SCOPES)
      .includes('--dsl-code-block-content-font'));
  check('空配置不生成（官方值作初始值）', mod.buildDslBlocks({}, ['codeBlock'], () => true, SCOPES) === '');
  check('四令牌缺一 ⇒ 跳过该钩子（与 F2 同一规则）',
    mod.buildDslBlocks({ codeBlock: { size: 14 } }, ['codeBlock'],
      (t) => t !== '--dsw-font-markdown-code-block-line-height', SCOPES) === '');
  check('负对照：四令牌齐全时必须生成',
    mod.buildDslBlocks({ codeBlock: { size: 14 } }, ['codeBlock'], () => true, SCOPES)
      .includes('--dsl-code-block-content-font'));
  check('负对照：钩子漂移判据能抓到拼错的钩子（防手滑）',
    !hooksAllKnown(['--dsl-codeblock-content-font'], HOOKS)   // 变异输入：少一个连字符 ⇒ 红
    && hooksAllKnown(['--dsl-terminal-font'], HOOKS));        // 反向：白名单内的必须放行
}

// ── ⑥b 钩子定义点扫描（scanHookScopes）──────────────────────────────────────
section('⑥b 扫样式表取钩子定义点（F1 同一口径：样式表是权威来源）');
{
  // 假的 document.styleSheets：一条 @media 包着的规则 + 一条顶层规则 + 一条跨域（cssRules 抛）
  const sheetOf = (rules) => ({ cssRules: rules });
  const ruleOf = (selectorText, decls) => ({
    selectorText,
    style: { getPropertyValue: (n) => (decls[n] === undefined ? '' : decls[n]) },
  });
  const deps = ruleOf('._block_cbH_1', { '--dsl-code-block-content-font': 'var(--x)' });
  const term = ruleOf('._block_tmH_2', { '--dsl-terminal-font': 'var(--y)' });
  const nested = { selectorText: '', style: null, cssRules: [term] };
  const media = { selectorText: '', style: null, cssRules: [nested] };
  const foreign = { get cssRules() { throw new Error('cross-origin'); } };
  const fakeDoc = { styleSheets: [sheetOf([deps, media]), foreign] };
  const scopes = mod.scanHookScopes(fakeDoc);
  check('从定义该钩子的规则上取选择器（含 @media 嵌套）',
    scopes['--dsl-code-block-content-font'] === '._block_cbH_1' && scopes['--dsl-terminal-font'] === '._block_tmH_2',
    JSON.stringify(scopes));
  check('共用模块名但定义点不同 ⇒ 两条钩子分别落到各自规则',
    scopes['--dsl-code-block-content-font'] !== scopes['--dsl-terminal-font']);
  check('跨域样式表（cssRules 抛）不炸、也不吞掉其它样式表',
    Object.keys(scopes).length === 2);
  check('没有 document 也不炸', Object.keys(mod.scanHookScopes(null)).length === 0);
  check('形态不合规的选择器被丢弃（复合/后代/列表）',
    Object.keys(mod.scanHookScopes({ styleSheets: [sheetOf([
      ruleOf('body .x', { '--dsl-terminal-font': 'v' }),
      ruleOf('.a, .b', { '--dsl-code-block-content-font': 'v' }),
    ])] })).length === 0);
  check('负对照：形态判据对合规单类选择器有牙',
    mod.HOOK_SCOPE_RE.test('._block_9ufs4_4') && !mod.HOOK_SCOPE_RE.test('body .x')
      && !mod.HOOK_SCOPE_RE.test('.a, .b') && !mod.HOOK_SCOPE_RE.test('.a .b'));
}

// ── ⑦ 设置侧一致性（跨文件，机械核对） ──────────────────────────────────────
section('⑦ schema 设置键与模块一致');
{
  const schema = await import(new URL('../lib/settings-schema.js', import.meta.url).href);
  const modIds = COMPONENT_FONT_TARGETS.map((t) => t.id);
  check('组件设置键两份一致（宿主只 import schema，浏览器只带模块）',
    JSON.stringify(modIds) === JSON.stringify(schema.COMPONENT_FONT_KEYS),
    'module=' + modIds.join(',') + ' schema=' + schema.COMPONENT_FONT_KEYS.join(','));
  check('负对照：多塞一个键会被判出',
    JSON.stringify([...modIds, 'ghost']) !== JSON.stringify(schema.COMPONENT_FONT_KEYS));
  // 键名与模块名**解耦**的收益：模块名改了（table → tableScroll）老设置照旧有效
  // ⚠️ `componentFonts` 是**字体集正文**的键：消毒入口是 `sanitizeFontset`，
  //    不是 settings 的 `sanitizeFromSchema`（后者不收它，见下面最后一条）。
  check('模块名改而设置键不变 ⇒ 老设置零迁移',
    schema.sanitizeFontset({ componentFonts: { table: { size: 13 } } }).componentFonts.table.size === 13
    && COMPONENT_FONT_TARGETS.find((t) => t.id === 'table').prefix === 'tableScroll');
  check('已退役的 sidebar 设置被丢弃（模块里根本没有可命中的前缀）',
    JSON.stringify(schema.sanitizeFontset({ componentFonts: { sidebar: { size: 12 } } }).componentFonts) === '{}');
  // 值必须能安全进 CSS：字族消毒（防设置文件里的字符串变成任意 CSS）
  const dirty = schema.sanitizeFontset(
    { componentFonts: { markdown: { size: 15, weight: 600, family: 'KaiTi; } body { display:none' } } });
  check('字族消毒：分号/花括号被剔除',
    !/[;{}]/.test(dirty.componentFonts.markdown.family), JSON.stringify(dirty.componentFonts.markdown.family));
  const bad = schema.sanitizeFontset(
    { componentFonts: { markdown: { size: 999, weight: 42 }, nope: { size: 12 } } });
  check('越界值与未知组件被丢弃', JSON.stringify(bad.componentFonts) === '{}', JSON.stringify(bad.componentFonts));
  check('该键已不在 settings 白名单里、而在字体集正文里（F3 阶段 2 的单一真源）',
    !('componentFonts' in schema.sanitizeFromSchema({}, 'host')) && 'componentFonts' in schema.sanitizeFontset({}));
}

// ── ⑧ 落地点已独立成模块（P1-7 手法：在位 + 已内联 + 不在正文）──────────────
// 抽出去之后**最危险的漂移是"两边各留一份"**：产物里一份、正文里还留一份同名实现，
// 于是改了模块却没生效（或反之）。三件事一起断言才能防住：模块在位、产物里有、正文里没有。
section('⑧ 字体落地点已抽成 src/font/apply.js 并内联');
{
  const applySrc = readFileSync(join(root, 'src', 'font', 'apply.js'), 'utf8');
  const effectsSrc = readFileSync(join(root, 'src', 'effects.js'), 'utf8');
  const clientSrc = readFileSync(join(root, 'src', 'client.js'), 'utf8');
  const bundleSrc = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
  const moved = ['function componentFontAvailability()', 'function componentFontDefaults()',
    'function applyComponentFonts()', 'function removeComponentFonts()',
    'function snapshotHostFontDefaults()', 'function removeFontStyles()'];
  const missing = moved.filter((m) => !applySrc.includes(m));
  // 覆盖面地板：[`missing`/`notInlined`/`stale`] 三个 filter 判据在**空清单**上全为 []（恒过）；
  // 空清单必须显式判红：下面三条 filter 判据在空域上恒过，先钉住清单非空。
  check('覆盖面：搬家清单非空（空清单会让下面三条 filter 判据全部空转）', moved.length === 6);
  check('落地点模块在位（六个定义齐全）', missing.length === 0, missing.join(' ') || 'ok');
  const notInlined = moved.filter((m) => !bundleSrc.includes(m));
  check('六个定义都已内联进 lib/client.js', notInlined.length === 0, notInlined.join(' ') || 'ok');
  const stale = moved.filter((m) => clientSrc.includes(m) || effectsSrc.includes(m));
  check('client.js 与 effects.js 都不再自带这些实现（防"两边各留一份"）', stale.length === 0,
    stale.join(' ') || 'ok');
  // effects.js 里不该再有任何字体 DOM 落点：`#we-font-scope` 这个 style 元素的 id 是它的指纹
  check('effects.js 里零字体落点（不再引用 #we-font-scope）',
    !effectsSrc.includes('we-font-scope'));
}

console.log('');
if (failed) { console.log(`COMPONENT FONT CHECKS FAILED — ${failed} failed`); process.exit(1); }
console.log('ALL COMPONENT FONT CHECKS PASSED');
