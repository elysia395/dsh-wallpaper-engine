// Verify protected host floors and the explicitly transparent chat surfaces.
//
// Why this suite exists: the wallpaper may be dimmed/blended so it "does not
// dominate", but TEXT MUST STAY READABLE. IDEA's background-image feature has a
// single knob (image opacity) and still "just works" because the image always
// sits BEHIND the editor / tool-window surfaces, which keep a background of
// their own. This plugin lacked that structural property: every text-bearing
// surface was painted as `glass colour @ --we-glass-alpha`, and in dark mode
// that alpha is additionally multiplied by 0.4 — worst case 0.03 × 0.4 = 0.012,
// i.e. no frost at all. The floor is a THEME-BASE LAYER composited OVER the
// glass tint at a fixed weight:
//
//     color-mix(in srgb, <theme base> floor%, <glass tint @ its alpha> (1-floor)%)
//     effective alpha = floor + a·(1−floor) ≥ floor
//
// so neither 玻璃透明度 nor the dark-theme ×0.4/×0.33 factors can undercut it
// (they only scale the tint operand). Clamping the tint alpha itself with max()
// cannot work — in dark mode the tint is a WHITE glaze and can only LIGHTEN the
// surface (measured ceiling 1.79:1 at any alpha), so the theme-base layer is
// the only shape that reaches the WCAG 4.5:1 body-text target. Where a surface
// drives its own same-colour alpha (the editor/terminal content plate) the
// floor IS a literal max() clamp, which leaves the user's value above the floor
// byte-identical.
//
// Chat element overrides intentionally bypass shared-token floors at the user
// glass-alpha setting. F2c–F2g check those overrides and their single plate;
// the remaining floor checks still protect settings, popups, sidebars/editors.
// Assertions (all derived from the BUILT lib/client.js — nothing re-typed):
//   F1  the floor is an explicit named constant + CSS token pair, and the
//       stylesheet copy matches the JS constant (no drift).
//   F2  every text-bearing surface the plugin drives carries the floor in BOTH
//       themes: composer/bubble tokens, settings-window layers 1/2/3, sidebar
//       panels + native right panel, the plugin's own drawer, and
//       the update toast (max() form).
//   F3  the content-surface plate uses a literal max() clamp on its own alpha.
//   F4  the software-render fallback plate still clears the floor (the #95
//       fallback keeps working).
//   F5  DSH Desktop 的外壳画布底必须被清掉，且插件侧**不得**钉模式名
//       （模式名漂移免疫：漏清与"写回单一模式门控"两个方向都要红）
//   C1  full grid 玻璃透明度 {0,15,30,45,60} × theme {light,dark} × 壁纸透明度
//       {0,50,90}: the effective composer-surface alpha is ≥ the floor, with the
//       computed numbers printed.
//   C2  the floor is NOT reduced at 玻璃透明度 = 60 (its most transparent end).
//   C3  the floor is NOT affected by 壁纸透明度: the floor declarations never
//       read --we-wallpaper-opacity, the effective alpha is identical for
//       {0,50,90}, and that token still only drives .we-layer.
//   C4  above the floor the slider is NOT flattened: the alpha still changes
//       monotonically with 玻璃透明度 (the content plate's own max() clamp is
//       pinned structurally by F3).
//   C5  the dark-theme ×0.4 tint factor cannot undercut the floor (the veil
//       weight is independent of it) — proven against the extracted factor.
//   M1  the measurement has discriminating power: the UN-floored tint fails
//       4.5:1 in the worst case (the bug), the floored surface passes.
//   M2  helpers behave (positive + negative controls on the contrast maths).
//   C6  stylesheet integrity + the wallpaper layer can never cover the UI.
//   C0f the glass-fidelity tier (weClampSurfaceColor 3rd param): default is
//       byte-identical to the legacy 2-arg call, 0 passes the raw color
//       through, and the lerp toward the raw color is monotone + sandwiched —
//       the stylesheet composes the floor with --we-glass-fidelity (default 1).
//   F7  侧栏全透明（issue #137，sidebarFullClear）：放弃地板的**显式开关**链路
//       完整且默认关 —— 默认值 false + boolFalse kind、门控属性成对挂/摘、UI 行
//       过 weT、规则组逐条带壁纸门（无壁纸不生效）且把地板/色染/釉光归零。
//       这是地板的**反向判据**：它证明"绕过地板"只能经这一个显式开关发生。
//
// Usage: node test/verify-readability.mjs
import { readFileSync } from 'node:fs';
import { styleSources, cssBodyOf } from './tools/src-scope.mjs';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// ── source → values ─────────────────────────────────────────────────────────
function num(re, text = SRC) {
  const m = text.match(re);
  return m ? Number(m[1]) : NaN;
}

// 1) the named JS constants (single source of truth for both floor values)
const FLOOR_JS = {
  light: num(/const READABILITY_FLOOR = ([\d.]+);/),
  dark: num(/const READABILITY_FLOOR_DARK = ([\d.]+);/),
};

// 2) the injected stylesheet: evaluate the CSS template literal with exactly
// those constants (so the string checked here IS the string the plugin injects).
// ⚠️ 锚点锚在行首且容忍缩进（产物把内联模块整段缩进过）：散文里出现同样的声明字面量会把锚点带偏。
// （刀3）：样式表拆成 8 个域模板 + 组装点 ⇒ 取文改走 cssBodyOf（按声明顺序拼回一份
// CSS 体，与旧单模板取文逐字节相同）；取不到任何模板会抛错，不再静默返回空串让判据恒真。
const CSS_BODY = cssBodyOf(SRC);
let CSS = '';
let cssError = null;
try {
  CSS = new Function('READABILITY_FLOOR', 'READABILITY_FLOOR_DARK',
    'return `' + CSS_BODY + '`;')(FLOOR_JS.light, FLOOR_JS.dark);
} catch (err) { cssError = err && err.message; }

// 3) the glass-alpha mapping, derived from the source (never re-typed here)
const GMAP = SRC.match(/const glassAlpha = Math\.max\(([\d.]+), ([\d.]+) - \(selection\.glassAlpha \/ ([\d.]+)\) \* ([\d.]+)\);/);
const glassAlpha = GMAP
  ? (pct) => Math.max(Number(GMAP[1]), Number(GMAP[2]) - (pct / Number(GMAP[3])) * Number(GMAP[4]))
  : null;

// ── flat-rule lookup on the injected stylesheet ─────────────────────────────
/** Every flat rule whose body declares `prop` (brace-depth matched). */
function rulesWithProp(prop) {
  const out = [];
  const needle = prop + ':';
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(needle, from);
    if (at < 0) break;
    from = at + needle.length;
    const open = CSS.lastIndexOf('{', at);
    if (open < 0) continue;
    const prevClose = CSS.lastIndexOf('}', open);
    const header = CSS.slice(prevClose + 1, open).trim();
    let depth = 0, close = -1;
    for (let i = open; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) continue;
    out.push({ header, body: CSS.slice(open + 1, close) });
  }
  return out;
}

function declValue(body, prop) {
  const m = body.match(new RegExp('(?:^|[\\s;])' + prop + ':\\s*([^;]+);'));
  return m ? m[1].trim() : null;
}

/** The rule declaring `prop` whose header contains `selector`, if any. */
function ruleFor(prop, selector) {
  return rulesWithProp(prop).find((r) => r.header.includes(selector)) || null;
}

/** Does this declaration open with the floor veil (theme base at floor weight)? */
function hasVeil(value, label) {
  if (value === null) return { ok: false, why: label + ': declaration missing' };
  // 对话栏解耦后，气泡 / 输入卡片 / 对话内 markdown 家族消费 --we-chat-readability-*
  //（独立保真度旋钮 chatGlassFidelity），其余面仍消费全局对 —— 两种形态都算「带下限」。
  const ok = /^color-mix\(in srgb,\s*var\(--we-(?:chat-)?readability-base\)\s+calc\(var\(--we-(?:chat-)?readability-floor\) \* 100%\),/.test(value)
    && /calc\(\(1 - var\(--we-(?:chat-)?readability-floor\)\) \* 100%\)/.test(value);
  return { ok, why: label + ': ' + JSON.stringify(value.slice(0, 120)) };
}

// ── colour maths (WCAG 2.x) ─────────────────────────────────────────────────
const hex2rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const s2l = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
const contrast = (a, b) => {
  const la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, fa, bg) => fg.map((c, i) => c * fa + bg[i] * (1 - fa));
/** theme-base veil at `F` composited OVER a tint of colour `frost` at alpha `w`. */
const veil = (frost, w, base, F) => {
  const alpha = F + w * (1 - F);
  const premult = frost.map((c, i) => base[i] * F + c * w * (1 - F));
  return { alpha, color: premult.map((c) => c / alpha) };
};

const GRID_GLASS = [0, 15, 30, 45, 60];
const GRID_WP = [0, 50, 90];
const TEXT = { light: [0, 0, 0], dark: [255, 255, 255] };
// worst-case backdrop: the darkest / brightest plausible wallpaper pixel (the
// wallpaper is fully opaque there, i.e. 壁纸透明度 = 0).
const WORST_PIXEL = { light: [0, 0, 0], dark: [255, 255, 255] };
// page base the wallpaper blends toward (README: light → white, dark → black)
const PAGE_BASE = { light: [255, 255, 255], dark: [0, 0, 0] };

function main() {
  // ── F1: explicit named floor, JS constant ↔ CSS token, no drift ───────────
  check('F1a the floor is an explicit named pair of JS constants',
    FLOOR_JS.light > 0 && FLOOR_JS.light < 1 && FLOOR_JS.dark > 0 && FLOOR_JS.dark < 1,
    'READABILITY_FLOOR=' + FLOOR_JS.light + ' READABILITY_FLOOR_DARK=' + FLOOR_JS.dark);

  check('F1b the injected stylesheet was extracted + evaluated (no interpolation surprise)',
    CSS.length > 50000 && cssError === null,
    'css chars=' + CSS.length + ' · template error=' + JSON.stringify(cssError));

  // 玻璃保真度（glassFidelity）落地后 floor 是组合声明：常量进 --we-readability-floor-base，
  // --we-readability-floor = base × var(--we-glass-fidelity, 1)。缺省回退 1 ⇒ 默认行为
  // 与旧逐位声明完全一致；F1d 仍然锚定**常量**本体（无漂移判据不变）。
  const FLOOR_COMPOSED = '--we-readability-floor: calc(var(--we-readability-floor-base) * var(--we-glass-fidelity, 1));';
  const lightVars = CSS.match(/body \{\s*--we-readability-floor-base:\s*([\d.]+);\s*--we-readability-floor:\s*calc\(var\(--we-readability-floor-base\) \* var\(--we-glass-fidelity, 1\)\);\s*--we-readability-base:\s*var\(--we-surface-tint-light, (#[0-9a-fA-F]{6})\);/);
  const darkVars = CSS.match(/body\[data-ds-dark-theme\] \{\s*--we-readability-floor-base:\s*([\d.]+);\s*--we-readability-floor:\s*calc\(var\(--we-readability-floor-base\) \* var\(--we-glass-fidelity, 1\)\);\s*--we-readability-base:\s*var\(--we-surface-tint-dark, (#[0-9a-fA-F]{6})\);/);
  check('F1c --we-readability-floor(-base) / --we-readability-base are declared for both themes (base = 染色地板 tint)',
    lightVars !== null && darkVars !== null,
    'light=' + JSON.stringify(lightVars && [Number(lightVars[1]), lightVars[2]])
      + ' dark=' + JSON.stringify(darkVars && [Number(darkVars[1]), darkVars[2]]));
  check('F1d the stylesheet floor EQUALS the JS constant (no drift)',
    lightVars !== null && darkVars !== null
      && Number(lightVars[1]) === FLOOR_JS.light && Number(darkVars[1]) === FLOOR_JS.dark,
    'css=' + JSON.stringify(lightVars && Number(lightVars[1])) + '/' + JSON.stringify(darkVars && Number(darkVars[1]))
      + ' js=' + FLOOR_JS.light + '/' + FLOOR_JS.dark);
  check('F1e both theme blocks compose the floor with --we-glass-fidelity (default 1 = 逐位现状)',
    CSS.split(FLOOR_COMPOSED).length === 3,
    'composed declarations=' + (CSS.split(FLOOR_COMPOSED).length - 1) + ' (expect 2: light + dark)');
  // F1f: 对话栏专属对（chatGlassFidelity 解耦）——组合形态与全局逐字同构，只换变量名。
  const CHAT_COMPOSED = '--we-chat-readability-floor: calc(var(--we-readability-floor-base) * var(--we-chat-glass-fidelity, 1));';
  check('F1f both theme blocks declare the chat-scoped floor/base pair (composed with --we-chat-glass-fidelity, default 1)',
    CSS.split(CHAT_COMPOSED).length === 3
      && (CSS.match(/--we-chat-readability-base: var\(--we-chat-surface-tint-light, #ffffff\);/g) || []).length === 1
      && (CSS.match(/--we-chat-readability-base: var\(--we-chat-surface-tint-dark, #0d1524\);/g) || []).length === 1,
    'chat floor declarations=' + (CSS.split(CHAT_COMPOSED).length - 1) + ' (expect 2)');
  // F2c: 对话栏对的作用域钉子 —— 只准被气泡 / 输入卡片的 4 条声明消费（浅深 × 2 token）。
  // 正文里的 markdown 内容面（代码块 / 行内代码 / 引用等）跟**全局**对（用户口径：
  // 代码块不和输入框一起，与侧边栏同尺）—— chat 变量每多一处消费都会在这里现形。
  const chatBaseUses = (CSS.match(/var\(--we-chat-readability-base\)/g) || []).length;
  const markdownGlobal = ['markdown-code-block', 'markdown-inline-code', 'markdown-citation'].every((t) => {
    const rule = ruleFor('--dsw-alias-' + t, 'body[data-we-glass-page]');
    const v = rule ? declValue(rule.body, '--dsw-alias-' + t) : '';
    return /var\(--we-readability-base\)/.test(v) && !/var\(--we-chat-/.test(v);
  });
  check('F2c the chat-scoped pair is consumed ONLY by bubble/input tokens (light+dark = 4 uses); the markdown content family stays on the global pair',
    chatBaseUses === 4 && markdownGlobal,
    'chat base uses=' + chatBaseUses + ' (expect 4) · markdown family on global pair=' + markdownGlobal);

  // ── C0: the tint clamp (染色地板) ships as a pure function and holds its grid ──
  // 钳制实现必须随 bundle 交付且可独立复算 —— 抽出来对三个极端输入各跑一遍。
  // 内联产物用 tab 缩进 ⇒ 不能用 `\n}` 找函数尾，用**花括号计数**切出整个函数。
  const clampStart = SRC.indexOf('function weClampSurfaceColor(');
  let clampSrc = null;
  if (clampStart >= 0) {
    let depth = 0;
    for (let i = clampStart; i < SRC.length; i++) {
      const ch = SRC[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { clampSrc = SRC.slice(clampStart, i + 1); break; } }
    }
  }
  const weClampSurfaceColor = clampSrc
    ? new Function('return (' + clampSrc + ')')()
    : null;
  const CLAMP_COLORS = ['#000000', '#7f7f7f', '#ffffff'];
  const tintOf = {};
  let clampUsable = weClampSurfaceColor !== null;
  if (weClampSurfaceColor) {
    try {
      for (const theme of ['light', 'dark']) {
        for (const gc of CLAMP_COLORS) {
          const out = weClampSurfaceColor(gc, theme);
          if (!/^#[0-9a-fA-F]{6}$/.test(out)) { clampUsable = false; break; }
          tintOf[theme + ' ' + gc] = hex2rgb(out);
        }
      }
    } catch { clampUsable = false; }
  }
  check('C0 the surface-tint clamp function ships in the bundle and clamps #000/#7f7f7f/#ffffff per theme',
    clampUsable,
    'extracted=' + (clampSrc !== null) + ' · tints=' + JSON.stringify(tintOf));

  // ── C0f: 玻璃保真度分档（weClampSurfaceColor 第三参 fidelity，0–1）────────────
  // 语义 = 两段式：先用满档地板跑完整红线的钳制（现状），再把结果向用户原色线性
  // 回退。判据四条：缺省/1 = 与旧口径逐位一致（C 网格与现有玻璃判据因此不受扰动）；
  // 0 = 原色直出；到原色的通道距离随 f **单调**下降（线性回退 ⇒ 无「中间档反而更
  // 极端」的悬崖）；f=0.5 每通道**夹逼**在原色与完整钳制色之间（不塌端点纯色）。
  let fidelityUsable = weClampSurfaceColor !== null;
  let fidelityDetail = '';
  if (weClampSurfaceColor) {
    try {
      const probe = '#00ccff';
      const raw = hex2rgb(probe);
      const dist = (hexOut) => hex2rgb(hexOut).reduce((s, v, i) => s + Math.abs(v - raw[i]), 0);
      const defaultIsFull = ['light', 'dark'].every((t) => weClampSurfaceColor(probe, t) === weClampSurfaceColor(probe, t, 1));
      const zeroPassesThrough = ['light', 'dark'].every((t) => weClampSurfaceColor(probe, t, 0) === probe);
      const dists = [0, 0.25, 0.5, 0.75, 1].map((f) => dist(weClampSurfaceColor(probe, 'dark', f)));
      const monotone = dists.every((d, i) => i === 0 || d >= dists[i - 1]);
      const fullL = hex2rgb(weClampSurfaceColor(probe, 'light', 1));
      const midL = hex2rgb(weClampSurfaceColor(probe, 'light', 0.5));
      const sandwiched = midL.every((v, i) => v >= Math.min(fullL[i], raw[i]) && v <= Math.max(fullL[i], raw[i]));
      fidelityUsable = defaultIsFull && zeroPassesThrough && monotone && sandwiched;
      fidelityDetail = 'default==f1:' + defaultIsFull + ' · f0原色直出:' + zeroPassesThrough
        + ' · 单调回退:' + monotone + ' (dark dists=' + dists.join('/') + ')'
        + ' · f0.5夹逼:' + sandwiched;
    } catch (e) { fidelityUsable = false; fidelityDetail = String(e && e.message); }
  }
  check('C0f the fidelity tier: default byte-identical, 0 passes the raw color, the lerp toward raw is monotone and sandwiched',
    fidelityUsable, fidelityDetail);

  // ── C0b: accent 墨色（issue #127）——纯函数随 bundle 交付，且逐色过对比度闸 ─────
  // 宿主 primary 控件的契约是「填充 × label-primary-foreground 反色墨」成对翻转；
  // 填充被重映射成任意亮度的用户配色后，墨必须按 accent 亮度重选（否则浅色配色 ×
  // 浅色主题墨 ≈ 1.5:1 = 报告里的「文字与背景同色」）。判据：抽函数 + 三个已知色 +
  // 对比度下限（黄底深墨 ≥ 7:1 / 蓝底白字 ≥ 3:1）。
  const inkStart = SRC.indexOf('function weAccentInk(');
  let inkSrc = null;
  if (inkStart >= 0) {
    let depth = 0;
    for (let i = inkStart; i < SRC.length; i++) {
      const ch = SRC[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { inkSrc = SRC.slice(inkStart, i + 1); break; } }
    }
  }
  const weAccentInk = inkSrc ? new Function('return (' + inkSrc + ')')() : null;
  let inkUsable = weAccentInk !== null;
  let inkDetail = '';
  if (weAccentInk) {
    try {
      const yellow = weAccentInk('#FFCF4D');
      const blue = weAccentInk('#4f8cff');
      const white = weAccentInk('#ffffff');
      const black = weAccentInk('#000000');
      const cYellow = contrast(hex2rgb('#FFCF4D'), hex2rgb(yellow));
      const cBlue = contrast(hex2rgb('#4f8cff'), hex2rgb(blue));
      inkUsable = yellow === '#0f1115' && blue === '#ffffff' && white === '#0f1115' && black === '#ffffff'
        && cYellow >= 7 && cBlue >= 3;
      inkDetail = 'yellow→' + yellow + '(' + cYellow.toFixed(1) + ':1) blue→' + blue + '(' + cBlue.toFixed(1) + ':1)';
    } catch (e) { inkUsable = false; inkDetail = String(e && e.message); }
  }
  check('C0b the accent-ink function ships and picks a contrast-safe foreground per accent luminance (#127)',
    inkUsable, 'extracted=' + (inkSrc !== null) + ' ' + inkDetail);

  const FLOOR = {
    light: lightVars ? Number(lightVars[1]) : NaN,
    dark: darkVars ? Number(darkVars[1]) : NaN,
  };

  // ── F2: every text-bearing surface carries the floor, both themes ─────────
  const surfaceSpecs = [
    ['composer card token (light)', '--dsw-specific-input-major', 'body[data-we-glass-page]'],
    ['message bubble token (light)', '--dsw-specific-bubble', 'body[data-we-glass-page]'],
    ['composer card token (dark)', '--dsw-specific-input-major', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['message bubble token (dark)', '--dsw-specific-bubble', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['settings window layer 1 (light)', '--dsw-alias-bg-layer-1', 'body[data-we-glass-window]'],
    ['settings window layer 2 (light)', '--dsw-alias-bg-layer-2', 'body[data-we-glass-window]'],
    ['settings window layer 3 (light)', '--dsw-alias-bg-layer-3', 'body[data-we-glass-window]'],
    ['settings window layer 1 (dark)', '--dsw-alias-bg-layer-1', 'body[data-ds-dark-theme][data-we-glass-window]'],
    ['settings window layer 2 (dark)', '--dsw-alias-bg-layer-2', 'body[data-ds-dark-theme][data-we-glass-window]'],
    ['settings window layer 3 (dark)', '--dsw-alias-bg-layer-3', 'body[data-ds-dark-theme][data-we-glass-window]'],
    // #80：壁纸激活时**整窗**的表面令牌也要过下限。它们原本保持宿主实色（因此谈不上
    // 玻璃、也谈不上"玻璃下的可读性"）；一旦按 #80 在 body[data-we-glass-page] 上映射成
    // 玻璃配方，它们立刻变成文字面（宿主对话框 / 面板 / 抬高按钮都读这些令牌），
    // 于是必须与设置窗口那三档同一条下限 —— 否则这次修复会把文字直接放到壁纸上。
    ['app surface layer 1 (light)', '--dsw-alias-bg-layer-1', 'body[data-we-glass-page]'],
    ['app surface layer 2 (light)', '--dsw-alias-bg-layer-2', 'body[data-we-glass-page]'],
    ['app surface layer 3 (light)', '--dsw-alias-bg-layer-3', 'body[data-we-glass-page]'],
    ['app raised button face (light)', '--dsw-alias-button-elevated-fill', 'body[data-we-glass-page]'],
    ['app surface layer 1 (dark)', '--dsw-alias-bg-layer-1', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['app surface layer 2 (dark)', '--dsw-alias-bg-layer-2', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['app surface layer 3 (dark)', '--dsw-alias-bg-layer-3', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['app raised button face (dark)', '--dsw-alias-button-elevated-fill', 'body[data-ds-dark-theme][data-we-glass-page]'],
    // markdown 代码块 / 行内代码（用户口径："代码块和重点文字背景也要和对话框一样玻璃化"）：
    // 它们以前保持宿主实色、因此不在表内；一旦按玻璃配方映射就成了文字面（shiki 前景色
    // 压在它上面）⇒ 必须与气泡 / 面板同一条下限，明暗两套都要。
    ['code block token (light)', '--dsw-alias-markdown-code-block', 'body[data-we-glass-page]'],
    ['code block banner token (light)', '--dsw-alias-markdown-code-block-banner', 'body[data-we-glass-page]'],
    ['inline code token (light)', '--dsw-alias-markdown-inline-code', 'body[data-we-glass-page]'],
    ['markdown tag token (light)', '--dsw-alias-markdown-tag', 'body[data-we-glass-page]'],
    ['code segment token (light)', '--dsw-alias-markdown-code-segment-unselected', 'body[data-we-glass-page]'],
    ['selected code segment token (light)', '--dsw-alias-markdown-code-segment-selected', 'body[data-we-glass-page]'],
    ['code block token (dark)', '--dsw-alias-markdown-code-block', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['code block banner token (dark)', '--dsw-alias-markdown-code-block-banner', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['inline code token (dark)', '--dsw-alias-markdown-inline-code', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['markdown tag token (dark)', '--dsw-alias-markdown-tag', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['code segment token (dark)', '--dsw-alias-markdown-code-segment-unselected', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['selected code segment token (dark)', '--dsw-alias-markdown-code-segment-selected', 'body[data-ds-dark-theme][data-we-glass-page]'],
    ['sidebar panel (light)', 'background-color', 'body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"]'],
    ['sidebar chrome group (light)', 'background-color', 'body[data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"]'],
    ['sidebar panel (dark)', 'background-color', 'body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_panel"]'],
    ['sidebar chrome group (dark)', 'background-color', 'body[data-ds-dark-theme][data-we-sidebar-glass] [data-dsh-better-sidebar] [class*="_terminalWrap"]'],
    ['native right panel (light)', 'background-color', 'body[data-we-sidebar-glass] [data-sidebar-right-panel]'],
    ['native right panel (dark)', 'background-color', 'body[data-ds-dark-theme][data-we-sidebar-glass] [data-sidebar-right-panel]'],
    // 左侧栏液态玻璃（leftSidebarGlass，默认关）：那一列同样是文字面（会话列表 / 工作区），
    // 一旦接管成玻璃就必须过同一条下限 —— 而且它是**唯一**能直接看到壁纸的大块区域，
    // 少了这条声明就是"整列文字直接压在花壁纸上"。
    ['native left column (light)', 'background-color', 'body[data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"])'],
    ['native left column (dark)', 'background-color', 'body[data-ds-dark-theme][data-we-glass-page][data-we-left-sidebar] div:has(> [data-slot="sidebar"])'],
    ['plugin repo drawer', 'background-color', '.we-repo-panel--open'],
  ];
  const veilMisses = [];
  for (const [label, prop, selector] of surfaceSpecs) {
    const rule = ruleFor(prop, selector);
    const value = rule ? declValue(rule.body, prop) : null;
    const verdict = hasVeil(value, label);
    if (!verdict.ok) veilMisses.push(verdict.why);
  }
  check('F2a every text-bearing surface token carries the readability floor (veil form)',
    veilMisses.length === 0,
    surfaceSpecs.length + ' surface(s) checked · missing/broken=' + veilMisses.length
      + (veilMisses.length ? ' · ' + JSON.stringify(veilMisses) : ''));

  // The user's chat surfaces must transmit wallpaper at the slider alpha.
  // Keep protected host-token floor checks above; test the actual overrides
  // rather than calling an 88% code canvas "transparent glass".
  {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const all = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((m) => ({ header: m[1].trim(), body: m[2] }));
    const normal = all.filter((r) => !r.header.includes('data-we-glass-fallback')
      && !r.header.includes('@supports'));
    const fill = (value) => /rgba\(var\(--we-surface-tint-rgb-(?:light|dark),/.test(value || '')
      && /var\(--we-glass-alpha,/.test(value || '')
      && !/readability-floor|max\(/.test(value || '');
    const fills = normal.filter((r) => r.header === 'body[data-we-glass-page]'
      || r.header === 'body[data-ds-dark-theme][data-we-glass-page]')
      .map((r) => declValue(r.body, '--we-chat-glass-fill')).filter(Boolean);
    check('F2c chat fill uses the slider directly in both themes, no opacity floor',
      fills.length === 2 && fills.every(fill));
    check('negative control: the rejected 88% canvas fails the transparency contract',
      fills.length === 2 && !fill(fills[0].replace(/var\(--we-glass-alpha, [^)]+\)/, '0.88')));
    //  用户口径：输入框退出思考玻璃作用域 ⇒ fill 接管的名单只剩
    // 气泡与两类代码围栏；输入卡在挂门规则里出现一次就算红（双向判据）。
    const roots = ['[class*="_bubble"]',
      '[data-chat-flow] .md-code-block', ':has(> pre > code)'];
    check('F2d bubble and message fences retain their slider fill; composer stays outside the thinking-glass scope',
      roots.every((anchor) => normal.some((r) => r.header.includes(anchor)
        && /background(?:-color)?: var\(--we-chat-glass-fill\)/.test(r.body)))
      && !normal.some((r) => r.header.includes('data-we-thinking-glass')
        && r.header.includes('[data-composer-card]')));
    // #161：宿主 Tooltip（dsh-client-ui-primitives）也编译成 *_bubble —— 但它是独立
    // 浮层：底色读 --dsw-alias-tooltip-bg（浅色 #2c2c2e 实色）、文字固定 bluish-00
    // （近白），位置不由 [data-chat-flow] 约束。气泡的 fill/霜釉盖上去就是白字压浅底。
    // 判据取宿主写在气泡元素上的 role="tooltip"（全 asar 唯一一处），它同时免疫类名
    // 哈希漂移与浮层 DOM 位置 ⇒ 每一条 _bubble 规则要么 chat-flow 作用域、要么带豁免。
    // 数下界 4 = 现有四条（fill / 霜釉 / 气泡内代码块清底 / fallback 摘霜），少一条即红。
    const bubbleRules = all.filter((r) => r.header.includes('[class*="_bubble"]')
      && !r.header.includes('@supports'));
    // ⚠️ §11 A1-4：这里原先允许"头里有 [data-chat-flow] 就放行"，于是把
    //    `… [data-chat-flow] [class*="_bubble"]:not([role="tooltip"]) .md-code-block`（当前
    //    `src/styles-shell.js` 里那一条）的 `:not(...)` 摘掉仍全绿。作用域与豁免是**两件事**：
    //    `[data-chat-flow]` 只说"在对话流里"，不说"不是宿主 Tooltip 那个 _bubble"。
    //    今天四条 `_bubble` 规则（三条在 `src/styles-shell.js`、一条在 `src/styles-ext.js`）都同时有两者
    //    ⇒ 收紧成"每条都必须带 role 豁免"：语义不放松，判据才有牙。
    const bubbleExempt = (r) => (r.header || '').includes(':not([role="tooltip"])');
    check('F2dN every [class*="_bubble"] rule excludes the host Tooltip (role="tooltip")',
      bubbleRules.length >= 4
      && bubbleRules.every(bubbleExempt),
      bubbleRules.filter((r) => !bubbleExempt(r)).map((r) => r.header).join(' | ')
        || bubbleRules.length + ' 条 _bubble 规则全部带 role 豁免');
    check('negative control: chat-flow 作用域不能代替 role="tooltip" 豁免（A1-4）',
      bubbleExempt({ header: 'body[data-we-glass-page] [data-chat-flow] [class*="_bubble"] .md-code-block' }) === false
        && bubbleExempt({ header: 'body[data-we-glass-page] [class*="_bubble"]:not([role="tooltip"]) .md-code-block' }) === true);
    const clear = (body) => /background: transparent !important/.test(body)
      && /(?:^|[;\s])backdrop-filter: none !important/.test(body)
      && /-webkit-backdrop-filter: none !important/.test(body)
      && !/(?:^|[;\s])opacity\s*:/.test(body);
    check('F2d2 reasoning and both file-card roots have no tint or backdrop blur',
      ['[data-vcp-reasoning]', '[data-changed-files]', '[data-presented-file]']
        .every((anchor) => normal.some((r) => r.header.includes(anchor) && clear(r.body))));
    // ⚠️ v1.3.0 追版（本仓「思考触发条」面与上游 #134 的收敛口径）：`[data-turn-trigger]` **刻意
    //   不在上面那一组** —— 上游原稿把思考触发条与推理面一起做成"清底 + 无霜"，本仓把它做成
    //   "吃玻璃、可独立配置"的面（接管宿主专属令牌 `--dsw-alias-turn-trigger-bg` / `-hover`
    //   + 在锚点元素上挂模糊载体），门与那一组**相同**（`data-we-thinking-glass`，默认关）。
    //   两头都钉：① 它不得落进"清底 + 无霜"那组（否则我们的玻璃整组被 !important 压掉）；
    //   ② 它必须真的接了玻璃（令牌 + 模糊），而不是"摘出清底组之后什么都不剩"。
    check('F2d2b 思考触发条刻意不在清底组，且真的接了玻璃（令牌 + 模糊载体，门同为 thinking-glass）',
      !normal.some((r) => r.header.includes('[data-turn-trigger]') && clear(r.body))
      && normal.some((r) => r.header.includes('[data-we-thinking-glass]')
        && r.header.includes('[data-turn-trigger]')
        && /var\(--we-thinking-trigger-blur/.test(r.body)
        && /backdrop-filter: blur\(/.test(r.body))
      && normal.some((r) => r.header.includes('[data-we-thinking-glass]')
        && /--dsw-alias-turn-trigger-bg:/.test(r.body)
        && /var\(--we-thinking-trigger-alpha/.test(r.body)));
    check('negative control: a tinted reasoning/file bar is not fully transparent',
      !clear('background: rgba(28, 28, 28, 0.19) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;'));
    const chip = normal.find((r) => r.header.includes('[data-chat-flow] :not(pre) > code')
      && r.header.includes('[data-vcp-rawhtml] :not(pre) > code'));
    check('F2d3 inline capsules restore ten-percent white mist and independent 8px frost',
      normal.some((r) => r.header === 'body[data-we-glass-page][data-we-thinking-glass]'
        && declValue(r.body, '--dsw-alias-markdown-inline-code') === 'var(--we-capsule-glass-fill)')
      && normal.some((r) => r.header === 'body[data-we-glass-page]'
        && declValue(r.body, '--we-capsule-glass-fill') === 'rgba(var(--we-capsule-tint-rgb, 255, 255, 255), var(--we-inline-code-alpha, 0.10))')
      && !!chip && /background: var\(--dsw-alias-markdown-inline-code\) !important/.test(chip.body)
      && declValue(chip.body, 'backdrop-filter') === 'blur(var(--we-inline-code-blur, 8px)) saturate(var(--we-saturate, 1.3)) brightness(var(--we-glass-brightness, 1.04))'
      && declValue(chip.body, '-webkit-backdrop-filter') === declValue(chip.body, 'backdrop-filter')
      && declValue(chip.body, 'background-image') === 'none !important'
      && declValue(chip.body, 'border-color') === 'rgba(255, 255, 255, 0.14) !important'
      && !/(?:^|[;\s])(?:color|filter|opacity)\s*:/.test(chip.body));
    // #197：推理正文由宿主用 compact 变体渲染（宿主模块类带 _thinkBody 后缀），那里的
    // 行内代码是 display:inline。跨行折断时 backdrop-filter 的取值区取的是**所有行盒的
    // 外接矩形**，于是胶囊霜釉长成一条横贯整列的矩形底板、盖住同行普通文字。修复=在推理
    // 正文子树里**只撤模糊载体、保留胶囊填充**（宿主自身的 box-decoration-break: clone
    // 已把背景按行盒分片）。判据两头钉：① 收口规则在位，且同时带玻璃门与 :not(pre) 围栏
    // 排除；② 原 chip 规则的霜釉**不得被就地删掉** —— 否则"局部收口"退化成"全局摘霜"，
    // 助手正文的胶囊也一起失去磨砂。
    const capsuleScope = (header) => header.includes('[data-we-glass-page]')
      && header.includes('[data-we-thinking-glass]')
      && header.includes(':not(pre) > code');
    const noFrost = (body) => /(?:^|[;\s])backdrop-filter: none !important/.test(body)
      && /-webkit-backdrop-filter: none !important/.test(body)
      && !/(?:^|[;\s])background(?:-color)?\s*:/.test(body);
    // 特异性计数器（Selectors 规范的三级元组 #id / .class·[attr]·:pseudo / 元素名）。
    // :is() 取最具体实参、:where() 计零、:not() 计其实参。逐条对教科书样例校准过：
    // * → 0-0-0、li → 0-0-1、ul ol+li → 0-0-3、h1 + *[rel=up] → 0-1-1、li.red.level → 0-2-1。
    const SPEC_ORDER = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
    // 按**顶层**逗号拆选择器列表：`:is()` / `:not()` 实参里的逗号不是列表分隔符。
    // 朴素 `header.split(',')` 会把 `:is(a, b)` 切成两段、留下一个没有闭括号的 `:is(`，
    // 伪类计数被误加 —— 实测把收口规则的真实 0-4-3 算成 0-5-1，于是"特异性压过"那条
    // 判据靠错误数字蒙混通过，只有负对照（去 [data-chat-flow] 应与原规则相等）把它咬出来。
    const splitTop = (s) => {
      const out = [];
      let depth = 0;
      let cur = '';
      for (const ch of s) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const specificity = (header) => {
      const oneSel = (sel) => {
        let s = sel.replace(/:is\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (_, inner) => {
          const parts = splitTop(inner).map((p) => p.trim()).filter(Boolean);
          return parts.reduce((best, cur) => (SPEC_ORDER(oneSel(cur), oneSel(best)) > 0 ? cur : best), parts[0] || '');
        });
        s = s.replace(/:where\([^()]*\)/g, ' ').replace(/:not\(([^()]*)\)/g, ' $1 ');
        return [
          (s.match(/#[\w-]+/g) || []).length,
          (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length,
          (s.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length,
        ];
      };
      return splitTop(header).map((p) => oneSel(p.trim()))
        .reduce((best, cur) => (SPEC_ORDER(cur, best) > 0 ? cur : best), [0, 0, 0]);
    };
    const thinkBodyCode = normal.filter((r) => r.header.includes('[class*="_thinkBody"]')
      && r.header.includes(':not(pre) > code'));
    const thinkChip = thinkBodyCode[0];
    check('F2d3b 推理正文（compact 变体）行内代码只撤模糊载体、保留胶囊填充（#197）',
      thinkBodyCode.length >= 1
      && thinkBodyCode.every((r) => capsuleScope(r.header) && noFrost(r.body))
      && !!chip && /backdrop-filter: blur\(var\(--we-inline-code-blur, 8px\)\)/.test(chip.body),
      (thinkChip ? thinkChip.header : 'no _thinkBody capsule rule'));
    // 收口规则必须**顺序无关地**压过原规则。两条都带 !important，若特异性相等，唯一决胜
    // 因素就是源码顺序 —— 浏览器里把新规则挪到原规则之前，#197 会静默复活，而只看
    // "规则在位 / 带门 / 保留 :not(pre)" 的判据抓不到（变异实测：对调后套件仍全绿）。
    const thinkSpec = thinkChip ? specificity(thinkChip.header) : null;
    const chipSpec = chip ? specificity(chip.header) : null;
    check('F2d3b2 收口规则的特异性严格压过原 chip 规则（顺序无关，不靠后置取胜）',
      !!thinkSpec && !!chipSpec && SPEC_ORDER(thinkSpec, chipSpec) > 0,
      'closing=' + (thinkSpec ? thinkSpec.join('-') : 'n/a')
        + ' · original=' + (chipSpec ? chipSpec.join('-') : 'n/a'));
    check('negative control: 抽掉 [data-chat-flow] 后两条特异性相等，顺序又成为唯一决胜因素（#197）',
      !!thinkChip && !!chipSpec
      && SPEC_ORDER(specificity(thinkChip.header.replaceAll('[data-chat-flow]', '')), chipSpec) === 0);
    // 语义锚点必须扛事：_thinkBody 是构建期哈希的一半，DSH-UI-INTERFACES.md 判其
    // 稳定性为低、明确不许把用户可见功能单独挂上去（宿主改个类名就静默复发）。
    check('F2d3b3 收口规则带着语义锚点 [data-variant="think"]，不只挂类名后缀（#197）',
      !!thinkChip && thinkChip.header.includes('[data-variant="think"]'));
    check('negative control: 少了思考玻璃门的收口规则等于全局摘霜（#197）',
      thinkBodyCode.length >= 1
      && !capsuleScope(thinkBodyCode[0].header.replaceAll('[data-we-thinking-glass]', '')));
    const tools = normal.find((r) => declValue(r.body, 'background-color') === 'var(--we-tool-glass-fill) !important');
    const toolScope = (header) => header.split(',').every((selector) =>
      selector.includes('[data-we-glass-page][data-we-thinking-glass]') && selector.includes('[data-chat-flow]')
      && (selector.includes('[data-slot="tool.call.toolview"]') || selector.includes('[data-chat-flow-kind="context"]')));
    check('F2d4 all seven tool result bodies are scoped to their chat slots and gates',
      !!tools && tools.header.split(',').length === 7 && toolScope(tools.header)
      && ['[data-context-injection-body]', '[data-terminal]', '[data-read]', '[data-search="matches"]',
        '[data-variant="others"]', '[data-search="paths"]', '[data-diff]'].every((a) => tools.header.includes(a)));
    check('F2d4b generic IO glass covers the others family in normal and fallback modes',
      all.filter((r) => r.header.includes('[class*="_ioCard"]')).length === 2
      && all.filter((r) => r.header.includes('[class*="_ioCard"]'))
        .every((r) => r.header.includes('[data-variant="others"]') && !r.header.includes('[data-tool="tool_call"]')));
    check('negative control: tool glass without its chat-slot boundary is rejected',
      !!tools && !toolScope(tools.header.replaceAll('[data-slot="tool.call.toolview"]', '')));
    check('F2d5 tool bodies retain theme tint, add six opacity points and clear nested canvases',
      ['light', 'dark'].every((theme) => normal.some((r) =>
        new RegExp('--we-tool-glass-fill: rgba\\(var\\(--we-surface-tint-rgb-' + theme + ',').test(r.body)
        && /calc\(var\(--we-glass-alpha, 0\.15\) \+ 0\.06\)/.test(r.body)))
      && !!tools && declValue(tools.body, '--dsw-alias-markdown-code-block') === 'transparent'
      && declValue(tools.body, '--dsw-alias-markdown-code-block-banner') === 'transparent'
      && declValue(tools.body, '--dsl-code-block-background') === 'transparent'
      && !/(?:^|[;\s])(?:color|filter|opacity)\s*:/.test(tools.body));
    const fences = all.filter((r) => r.header.includes('.md-code-block') || r.header.includes(':has(> pre > code)'));
    const gated = (h) => h.split(',').every((s) => s.includes('[data-we-glass-page]') && s.includes('[data-we-thinking-glass]'));
    check('F2e fence rules are opt-in and message-scoped',
      fences.length >= 5 && fences.every((r) => gated(r.header))
      && fences.every((r) => r.header.includes('[data-chat-flow]') || r.header.includes('[data-vcp-rawhtml]')));
    check('negative control: unguarded fence rules are rejected',
      !!fences[0] && !gated(fences[0].header.replaceAll('[data-we-thinking-glass]', '')));
    const native = normal.filter((r) => r.header.includes('.md-code-block') && !r.header.includes('> pre {'));
    check('F2f native Shiki foregrounds remain untouched; inner canvas is transparent',
      native.every((r) => !/(?:^|[;\s])(?:color|filter|opacity|mix-blend-mode)\s*:/.test(r.body))
      && normal.some((r) => r.header.includes('.md-code-block pre')
        && /background: transparent !important/.test(r.body) && /backdrop-filter: none !important/.test(r.body))
      && normal.some((r) => r.header.includes('[data-vcp-reasoning-body]')
        && /background: transparent !important/.test(r.body) && /backdrop-filter: none !important/.test(r.body)));
    check('F2g VCP plain code follows theme foreground; 92% plate is fallback-only',
      normal.some((r) => r.header.includes('[data-vcp-rawhtml]') && r.header.endsWith('> pre')
        && /color: var\(--dsw-alias-label-primary\) !important/.test(r.body))
      && all.some((r) => r.header.includes('data-we-glass-fallback')
        && /--we-chat-glass-fill: color-mix\(in srgb, var\(--we-readability-base\) 92%, transparent\)/.test(r.body)));
  }

  // 负对照（DEV-GUIDE §4.7 约定 5：变异输入必须喂进**同一条判据**）：把一条真实声明改坏
  // （把下限那一项换成玻璃色）后，`hasVeil` 必须判不合格 —— 否则 F2a 可能是空转的
  // （选择器一改名，spec 全落空也没人发现）。
  {
    const rule = ruleFor('--dsw-alias-bg-layer-1', 'body[data-we-glass-page]');
    const real = rule ? declValue(rule.body, '--dsw-alias-bg-layer-1') : null;
    const mutated = String(real).replace('var(--we-readability-base)', 'var(--we-glass-color, #ffffff)');
    check('negative control: 同一条下限判据对"被改坏的声明"有牙',
      real !== null && mutated !== real
      && hasVeil(real, 'real').ok === true && hasVeil(mutated, 'mutated').ok === false,
      'real=' + String(real).slice(0, 64) + ' · mutated=' + mutated.slice(0, 64));
  }

  const darkComposer = ruleFor('--dsw-specific-input-major', 'body[data-ds-dark-theme][data-we-glass-page]');
  // 对话栏解耦（chatGlassFidelity）后，composer/bubble 的深色档消费 --we-chat-* 变量对。
  const DARK_FACTOR = darkComposer
    ? Number((declValue(darkComposer.body, '--dsw-specific-input-major')
      .match(/rgba\(var\(--we-chat-surface-tint-rgb-dark, 255, 255, 255\), calc\(var\(--we-glass-alpha, [\d.]+\) \* ([\d.]+)\)\)/) || [])[1])
    : NaN;
  check('F2b the veil keeps a fixed weight while the tint keeps its own alpha (dark ×factor preserved)',
    /rgba\(var\(--we-chat-surface-tint-rgb-dark, 255, 255, 255\), calc\(var\(--we-glass-alpha, 0\.15\) \* 0\.4\)\)/.test(declValue(darkComposer ? darkComposer.body : '', '--dsw-specific-input-major') || '')
      && /calc\(var\(--we-chat-readability-floor\) \* 100%\)/.test(declValue(darkComposer ? darkComposer.body : '', '--dsw-specific-input-major') || ''),
    'dark tint factor=' + DARK_FACTOR);

  // ── F3: the content plate uses a literal max() clamp on its own alpha ──────
  const contentProp = 'background-color';
  const contentRules = rulesWithProp(contentProp)
    .filter((r) => /\.cm-editor|xterm|\.dshDesktopSidebarSurface/.test(r.header));
  const CONTENT_TOKEN = 'max(calc(var(--we-readability-floor) * 100%), var(--we-content-surface-alpha, 88%))';
  check('F3 the editor/terminal content plate clamps its own alpha with max()',
    contentRules.length >= 3 && contentRules.every((r) => r.body.includes(CONTENT_TOKEN)),
    contentRules.length + ' content rule(s), all carrying ' + CONTENT_TOKEN);

  // ── F4: the software-render fallback plate still clears the floor ─────────
  const fbRule = rulesWithProp(contentProp)
    .find((r) => r.header.includes('[data-we-glass-fallback]') && r.header.includes('[data-composer-card]::before'));
  const fbPlatePct = fbRule
    ? Number((fbRule.body.match(/color-mix\(in srgb, var\(--we-surface-tint-(?:light|dark), (#[0-9a-fA-F]{6})\) (\d+)%, transparent\)/) || [])[2])
    : NaN;
  check('F4 the software-render fallback plate (#95) still clears the floor',
    fbPlatePct / 100 >= Math.max(FLOOR.light, FLOOR.dark),
    'fallback plate=' + (isNaN(fbPlatePct) ? 'missing' : fbPlatePct + '%') + ' · floor=' + Math.max(FLOOR.light, FLOOR.dark));

  // ── F5: DSH Desktop 的外壳画布底必须被清掉 ─────────────────────────────────
  // 壳层样式表里有一条**模式门控**规则（兼容模式没有，所以只有那个模式会把壁纸
  // 整片盖住 → 用户看到的就是「没选壁纸」）：
  //   body[data-dsh-desktop-mode="extended"] .dshDesktopFrame            { background: var(--dsh-desktop-frame-fill) }
  //   body[data-dsh-desktop-mode="extended"] .dshDesktopConversationSurface { background: var(--dsw-alias-bg-base) }
  // Windows 上 material 只能是 off ⇒ --dsh-desktop-frame-fill = --dsw-alias-bg-layer-1（不透明）。
  // 主内容区那条读 --dsw-alias-bg-base，插件已在 body[data-we-wallpaper] 上置 transparent，
  // 所以这里只要守住**画布**那一层被清掉（且用的是 transparent，不是某个不透明色）。
  // ⚠️ 插件侧**不得**跟着写模式门控：模式名与门控集合由壳层自己演进，钉住某一个模式名
  // 一旦漂移就是"整片盖住壁纸"。判据因此要求选择器里**没有** data-dsh-desktop-mode ——
  // 两个方向都有牙：漏清（无规则）红，写回单一模式门控也红。
  // ⚠️ 本仓的 CSS 规则解析器把**前置注释**也算进 header，所以判据必须先剥注释再匹配选择器
  // —— 否则我在这条规则上方写的那段说明注释本身就含 `.dshDesktopFrame`，断言会靠注释过关
  //（"负对照空转"的老坑）。三条负对照：同形但不含 transparent / 只在注释里出现选择器 /
  // 写回单一模式门控的那一版。
  const selOf = (r) => String(r.header).replace(/\/\*[\s\S]*?\*\//g, '');
  const clearsShellFrame = (r) => {
    const h = selOf(r);
    return h.includes('[data-we-wallpaper]') && h.includes('data-we-adapter^="desktop-"')
      && h.includes('.dshDesktopFrame') && /transparent/.test(r.body)
      && !h.includes('data-dsh-desktop-mode');
  };
  const shellFrameRules = rulesWithProp('background').filter(clearsShellFrame);
  const shellDecoy = { header: 'body[data-we-wallpaper] .dshDesktopFrame', body: 'background: var(--dsh-desktop-frame-fill) !important;' };
  const commentDecoy = { header: '/* body[data-we-wallpaper] .dshDesktopFrame */ body', body: 'background: transparent;' };
  const modeGatedDecoy = { header: 'body[data-we-adapter^="desktop-"][data-we-wallpaper][data-dsh-desktop-mode="extended"] .dshDesktopFrame', body: 'background: transparent !important;' };
  check('F5 桌面壳的外壳画布底被清掉（否则整窗盖住壁纸 = 像没选壁纸），且不钉模式名',
    shellFrameRules.length >= 1 && !clearsShellFrame(shellDecoy) && !clearsShellFrame(commentDecoy)
      && !clearsShellFrame(modeGatedDecoy),
    shellFrameRules.length + ' rule(s): ' + shellFrameRules.map((r) => selOf(r).slice(-64)).join(' | ')
      + ' · 负对照[不透明]=' + (clearsShellFrame(shellDecoy) ? 'FAIL' : 'ok')
      + ' · 负对照[仅注释]=' + (clearsShellFrame(commentDecoy) ? 'FAIL' : 'ok')
      + ' · 负对照[钉住单一模式名]=' + (clearsShellFrame(modeGatedDecoy) ? 'FAIL' : 'ok'));

  // ── F6: 画布兜底色必须落在 html 上 ─────────────────────────────────────────
  // 「壁纸的像素没送到屏上」时的最后一道底：根元素的背景色就是**画布背景**（合成器直接
  // 填充的纯色 quad，不依赖栅格），掉层时它还在。落在 body 上等于没写 —— 宿主有一条
  //   html[data-platform=darwin] body { background: transparent }
  // 在层叠上赢过 body 侧的任何声明（选择器多一层 html[data-platform]），而 darwin 正是
  // 桌面壳的主场。判据读的是**规则体**，所以自带负对照：把承载规则原地换成 body 之后必须判不出来。
  const underlayCarrierOf = (css) => {
    const at = css.indexOf('background-color: var(--we-wallpaper-underlay');
    if (at < 0) return null;
    const open = css.lastIndexOf('{', at);
    if (open < 0) return null;
    const prevClose = css.lastIndexOf('}', open);
    const header = String(css.slice(prevClose + 1, open));
    // header 可能**从一段注释中间**开始（规则的注释写在它上方，而这一刀切在上一条规则的 } 之后）
    // ⇒ 先砍掉尾部那段注释，再按"整段注释"兜底。
    const cut = header.includes('*/') ? header.slice(header.lastIndexOf('*/') + 2) : header;
    return cut.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  };
  const carrier = underlayCarrierOf(CSS);
  const swapped = (() => {
    const at = CSS.indexOf('background-color: var(--we-wallpaper-underlay');
    if (at < 0) return '';
    const open = CSS.lastIndexOf('{', at);
    const start = CSS.lastIndexOf('}', open) + 1;
    return CSS.slice(0, start) + ' body ' + CSS.slice(open);
  })();
  check('F6 画布兜底色落在 html 元素上（body 侧会被宿主 darwin 的透明规则盖掉）',
    carrier === 'html' && underlayCarrierOf(swapped) !== 'html',
    'carrier=' + JSON.stringify(carrier) + ' · 负对照[换成 body]=' + (underlayCarrierOf(swapped) === 'html' ? 'FAIL' : 'ok'));

  // ── C1/C2: the grid — 染色地板网格：玻璃色 {黑/中灰/白} × 滑杆五档 × 主题 ──
  // 表面 = 染色地板（base 与 frost 同为钳制后的 tint，见样式表令牌映射），
  // alpha = F + w(1−F)（w = glassAlpha，深色再乘 0.4 层因子）。判据不变：
  // 最坏背衬（深色白壁纸像素 / 浅色黑壁纸像素）上正文 ≥4.5:1 —— 测的是
  // **任意玻璃色**（三档极端输入覆盖钳制的全部路径），不是单一白色 frost 点。
  check('C1a the glass-alpha mapping was derived from the source',
    glassAlpha !== null, 'mapping=' + JSON.stringify(GMAP ? GMAP.slice(1) : null));

  const alphaTable = { light: [], dark: [] };
  const contrastTable = { light: [], dark: [] };
  let alphaOk = true, contrastOk = true;
  const worstAt = { light: [], dark: [] };
  if (clampUsable) {
    for (const theme of ['light', 'dark']) {
      const F = FLOOR[theme];
      for (const gp of GRID_GLASS) {
        const g = glassAlpha(gp);
        const w = theme === 'dark' ? g * DARK_FACTOR : g;
        const alpha = F + w * (1 - F);
        if (!(alpha >= F)) alphaOk = false;
        if (theme === 'light') alphaTable.light.push(Number(alpha.toFixed(4)));
        if (theme === 'dark') alphaTable.dark.push(Number(alpha.toFixed(4)));
        // 壁纸透明度 only changes the BACKDROP (never the surface): worst case is
        // the fully opaque extreme wallpaper pixel.
        for (const gc of CLAMP_COLORS) {
          const tint = tintOf[theme + ' ' + gc];
          let worst = Infinity;
          for (const wp of GRID_WP) {
            const backdrop = over(WORST_PIXEL[theme], 1 - wp / 100, PAGE_BASE[theme]);
            worst = Math.min(worst, contrast(TEXT[theme], over(tint, alpha, backdrop)));
          }
          if (!(worst >= 4.5)) contrastOk = false;
          worstAt[theme].push(theme + ' ' + gc + ' @' + gp + ' → ' + worst.toFixed(2) + ':1');
        }
      }
    }
  }
  check('C1b full grid: effective composer-surface alpha ≥ floor (玻璃透明度 × 壁纸透明度 × theme)',
    alphaOk && clampUsable,
    'light α=' + alphaTable.light.join('/') + ' (floor ' + FLOOR.light + ') · dark α='
      + alphaTable.dark.join('/') + ' (floor ' + FLOOR.dark + ')');
  check('C1c full grid: worst-case WCAG contrast of body text ≥ 4.5:1 (玻璃色 黑/中灰/白 × 滑杆 × 主题 × 壁纸透明度)',
    contrastOk && clampUsable,
    worstAt.light.slice(0, 3).concat(worstAt.dark.slice(0, 3)).join(' · ')
      + ' … 共 ' + worstAt.light.length + '×2 格 (worst backdrop: light #000, dark #fff)');

  check('C2 the floor is NOT reduced at 玻璃透明度 = 60 (most transparent end)',
    alphaTable.light[GRID_GLASS.length - 1] >= FLOOR.light
      && alphaTable.dark[GRID_GLASS.length - 1] >= FLOOR.dark
      && alphaTable.light[GRID_GLASS.length - 1] === Math.min(...alphaTable.light)
      && alphaTable.dark[GRID_GLASS.length - 1] === Math.min(...alphaTable.dark),
    'min alpha light=' + Math.min(...alphaTable.light) + ' dark=' + Math.min(...alphaTable.dark)
      + ' vs floors ' + FLOOR.light + '/' + FLOOR.dark);

  // ── C3: independence from 壁纸透明度 ──────────────────────────────────────
  // One composite step that takes the 壁纸透明度-driven backdrop as an INPUT, so
  // "the alpha does not move" is a property of the code path, not of a constant
  // compared with itself (the contrast half DOES move, proving wp is exercised).
  function surfaceFor(theme, gp, wp) {
    const g = glassAlpha(gp);
    const w = theme === 'dark' ? g * DARK_FACTOR : g;
    const backdrop = over(WORST_PIXEL[theme], 1 - wp / 100, PAGE_BASE[theme]);
    const tint = tintOf[theme + ' #7f7f7f'];
    const alpha = FLOOR[theme] + w * (1 - FLOOR[theme]);
    return {
      alpha,
      contrast: contrast(TEXT[theme], over(tint, alpha, backdrop)),
    };
  }
  const floorDeclRules = surfaceSpecs
    .map(([, prop, selector]) => ruleFor(prop, selector))
    .filter(Boolean);
  const floorText = floorDeclRules.map((r) => r.header + ' { ' + r.body + ' }').join('\n')
    + '\n' + (lightVars ? lightVars[0] : '') + (darkVars ? darkVars[0] : '');
  const wpLeak = /--we-wallpaper-opacity/.test(floorText);
  const alphaPerWp = GRID_WP.map((wp) => Number(surfaceFor('light', 30, wp).alpha.toFixed(6)));
  const contrastPerWp = GRID_WP.map((wp) => Number(surfaceFor('light', 30, wp).contrast.toFixed(2)));
  check('C3a the floor never reads --we-wallpaper-opacity: surface alpha is identical for 壁纸透明度 {0,50,90}',
    !wpLeak && new Set(alphaPerWp).size === 1 && new Set(contrastPerWp).size > 1,
    'floor declarations mention --we-wallpaper-opacity=' + wpLeak
      + ' · α=' + alphaPerWp.join('/') + ' (identical) · backdrop contrast=' + contrastPerWp.join('/') + ' (moves)');
  // ── C3b: the slider stays scoped to the wallpaper layer only ─────────────
  // 上游 v0.7.5 起淡出改在**媒体叶子**上（.we-layer .we-media）：.we-layer 保持
  // 不透明并垫主题实色（--we-wallpaper-fade-bg），因为透明 backdrop 会让
  // backdrop-filter（玻璃模糊）失效。语义不变 —— 仍只作用于壁纸层、不碰文字面。
  const layerRule = rulesWithProp('background-color').find((r) => /\.we-layer\s*$/.test(r.header));
  const mediaFadeRule = rulesWithProp('opacity').find((r) => /\.we-layer\s+\.we-media\s*$/.test(r.header));
  check('C3b 壁纸透明度 stays scoped to the wallpaper layer (opaque padded layer + fade on the media leaf)',
    layerRule !== undefined
      && declValue(layerRule.body, 'opacity') === '1'
      && /^var\(--we-wallpaper-fade-bg/.test(String(declValue(layerRule.body, 'background-color')))
      && mediaFadeRule !== undefined
      && mediaFadeRule.body.includes('opacity: var(--we-wallpaper-opacity, 1)'),
    '.we-layer opacity=' + JSON.stringify(layerRule && declValue(layerRule.body, 'opacity'))
      + ' · bg=' + JSON.stringify(layerRule && declValue(layerRule.body, 'background-color'))
      + ' · .we-layer .we-media opacity=' + JSON.stringify(mediaFadeRule && declValue(mediaFadeRule.body, 'opacity')));

  // ── C4: the slider is not flattened above the floor ──────────────────────
  // 内容面自身的 max() 夹逼（地板以上的用户 α 逐字穿过去）由 F3 结构性钉住：那条判据
  // 钉的是产品 CSS 里真实的夹逼表达式 `max(calc(var(--we-readability-floor) * 100%),
  // var(--we-content-surface-alpha, 88%))`，覆盖同一个内容面集合（.cm-editor / xterm /
  // .dshDesktopSidebarSurface）。这里**不复刻**产品的夹逼算术：把产品夹逼用 Math.max 重实现
  // 一遍再断它自己，测的是测试自己的算盘，不是产品。
  const strictlyDecreasing = (arr) => arr.every((v, i) => i === 0 || v < arr[i - 1]);
  check('C4b 玻璃透明度 still changes the effective alpha monotonically (no flattening)',
    strictlyDecreasing(alphaTable.light) && strictlyDecreasing(alphaTable.dark),
    'light ' + alphaTable.light.join(' > ') + ' · dark ' + alphaTable.dark.join(' > '));

  // ── C5: the dark ×0.4 factor cannot undercut the floor ───────────────────
  const darkNoTint = veil([255, 255, 255], 0, [0, 0, 0], FLOOR.dark);
  check('C5 the dark-theme tint factor cannot lower the veil (floor holds even at tint alpha 0)',
    Math.abs(darkNoTint.alpha - FLOOR.dark) < 1e-12 && FLOOR.dark > DARK_FACTOR,
    'veil alpha at tint 0 = ' + darkNoTint.alpha + ' · floor=' + FLOOR.dark + ' > tint factor=' + DARK_FACTOR);

  // ── M1: discriminating power — the un-floored tint FAILS ─────────────────
  let beforeWorst = Infinity, beforeAt = null;
  let clampCeiling = 0;
  for (const theme of ['light', 'dark']) {
    for (const gp of GRID_GLASS) {
      const g = glassAlpha(gp);
      const w = theme === 'dark' ? g * DARK_FACTOR : g;
      for (const wp of GRID_WP) {
        const backdrop = over(WORST_PIXEL[theme], 1 - wp / 100, PAGE_BASE[theme]);
        const cr = contrast(TEXT[theme], over([255, 255, 255], w, backdrop));
        if (cr < beforeWorst) { beforeWorst = cr; beforeAt = theme + ' @ 玻璃透明度=' + gp + ', 壁纸透明度=' + wp + ', α=' + w.toFixed(4); }
      }
      // What a max() clamp on the TINT alpha could do at best in dark mode: the
      // glaze is white, so over the brightest pixel it is white at every alpha.
      if (theme === 'dark') {
        clampCeiling = Math.max(clampCeiling,
          contrast(TEXT.dark, over([255, 255, 255], Math.max(FLOOR.dark, w), WORST_PIXEL.dark)));
      }
    }
  }
  check('M1 the OLD (un-floored) surface really fails 4.5:1 — this assertion has teeth',
    beforeWorst < 4.5 && clampCeiling < 4.5,
    'worst before=' + beforeWorst.toFixed(2) + ':1 (' + beforeAt + ') · worst after='
      + Math.min(...contrastTable.light, ...contrastTable.dark).toFixed(2) + ':1'
      + ' · best a max() clamp on the dark tint could reach=' + clampCeiling.toFixed(2) + ':1 (why the floor is a layer)');

  // ── M2: maths helpers, positive + negative controls ──────────────────────
  const controls = [
    ['black on white = 21', Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 21) < 0.01],
    ['white on white = 1', Math.abs(contrast([255, 255, 255], [255, 255, 255]) - 1) < 0.01],
    ['veil alpha additive', Math.abs(veil([0, 0, 0], 0.5, [255, 255, 255], 0.5).alpha - 0.75) < 1e-12],
    ['veil colour is the base over the tint', veil([0, 0, 0], 0, [255, 255, 255], 0.5).color.join() === '255,255,255'],
    ['veil at tint 0 = base only', veil([0, 0, 0], 0, [0, 0, 0], 0.59).alpha === 0.59],
    ['negative control: 0.3 veil fails 4.5:1', contrast([0, 0, 0], over([255, 255, 255], 0.3, [0, 0, 0])) < 4.5],
  ];
  const bad = controls.filter(([, ok]) => !ok).map(([name]) => name);
  check('M2 contrast/veil helpers hold their positive + negative controls',
    bad.length === 0, controls.length + ' controls, failed=[' + bad.join(', ') + ']');

  // ── C6: stylesheet integrity + the wallpaper layer can never cover the UI ──
  // 一次未闭合的 `/*` 会把其后的规则**整段静默吞掉**（CSS 注释不嵌套，故必然造成
  // `/*` 多于 `*/`）: 实测这让 .we-layer 丢掉 position:fixed/z-index:-2 —— 壁纸于是
  // 掉进文档流（视频跑到页面底部）或直接盖住文字层。解析器不会为此报任何错。
  // 判据用两条: ①注释配平; ②**剥掉注释后**关键规则仍然在, 且仍是 fixed 负 z-index。
  {
    const opens = (CSS.match(/\/\*/g) || []).length;
    const closes = (CSS.match(/\*\//g) || []).length;
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const layerBody = (stripped.match(/\.we-layer\s*\{([^}]*)\}/) || [])[1] || '';
    const pos = (layerBody.match(/position:\s*([a-z-]+)/) || [])[1] || null;
    const z = (layerBody.match(/z-index:\s*(-?\d+)/) || [])[1] || null;
    check('C6s comment balance + .we-layer survives comment-stripping as position:fixed with a negative z-index',
      opens === closes && pos === 'fixed' && Number(z) < 0,
      'comments ' + opens + '/' + closes + ' · .we-layer position=' + JSON.stringify(pos)
        + ' z-index=' + JSON.stringify(z));
  }

  // ── C6t：CSS 模板里**不许有裸反引号**（加, 因为这条连踩三次）──────────
  // 背景: `src/styles.js` 的整张样式表是一个**模板字符串**, 而它内部的注释很容易顺手
  // 写成 Markdown 那种 `` `token` `` 反引号 —— 那个反引号会**提前终止模板字符串**, 后面的
  // CSS 文本于是被当 JS 解析。症状极具误导性: `node scripts/build-client.mjs` 报
  // "产物语法错误: Unexpected identifier 'verify'" / "Invalid left-hand side expression in
  // postfix operation"（报的是 CSS 里的词, 不是反引号本身）⇒ 会让人去查完全无关的地方。
  // 本条把它变成**指名道姓**的判据。判据读**源码**（不是产物）: 产物构建失败时它根本不会
  // 更新, 拿产物判会测到上一次的旧文本。
  {
    // 刀3：样式表从单个 CSS 模板拆成 8 个域模块（+ 组装点）⇒ 逐**族文件**取模板体
    // 再数裸反引号。逐文件判（不是拼成一份再判）才能指名道姓到具体域文件；判据本身一字未改。
    const parts = [];
    for (const rel of styleSources()) {
      const text = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
      const open = text.search(/^[ \t]*const CSS(?:_[A-Z][A-Z0-9_]*)? = `/m);
      if (open < 0) continue;
      const bodyStart = text.indexOf('`', open) + 1;
      // 结尾锚在行首的 `;`（与上面 C6s 取 CSS 的方式同源, 避免散文里的反引号影响）
      const tail = text.slice(bodyStart).match(/^`;/m);
      if (!tail) continue;
      parts.push({ file: rel, text, bodyStart, body: text.slice(bodyStart, bodyStart + tail.index) });
    }
    const found = parts.length > 0;
    const strays = found ? parts.reduce((n, p) => n + (p.body.match(/`/g) || []).length, 0) : -1;
    const bodyBytes = parts.reduce((n, p) => n + Buffer.byteLength(p.body, 'utf8'), 0);
    // 行号定位（便于直接去改）: 第一个裸反引号所在**文件与行**
    let where = '';
    for (const p of parts) {
      const at = p.body.indexOf('`');
      if (at >= 0) {
        where = p.file + ':' + p.text.slice(0, p.bodyStart + at).split('\n').length;
        break;
      }
    }
    check('C6t styles.js 的 CSS 模板内无裸反引号（会把模板提前终止, 报错却指向别处）',
      found && strays === 0,
      !found ? '取不到模板体（锚点变了?）'
        : strays + ' 个裸反引号 · 首个在 ' + where + ' · 族模板体 ' + bodyBytes + ' B');
    // 负对照: 同一判据必须能判出**合成**的裸反引号（否则它可能恒真）。
    // 用与正面**同一个谓词**（strays === 0）判, 而不是自己数一遍 —— 数一遍等于把判据抄成
    // 期望值, 那样"谓词写错"时正负对照会一起错（本仓的"期望值不许与被测对象同源"）。
    const pick = parts[0] ? parts[0].body : '';
    const synth = pick.slice(0, 200) + '\n/* `demo` */\n' + pick.slice(200);
    check('negative control C6t-1: 合成一个裸反引号会被同一条判据判出',
      (synth.match(/`/g) || []).length !== 0 && found);
  }

  // ── F7: 侧栏全透明（issue #137）—— 放弃地板的显式开关链路（默认关）──────
  // 与上面所有判据互为反向：F1–F5/C* 钉"地板在"，F7 钉"地板只能被这个开关
  //（且仅在壁纸下、仅侧栏子树）拿掉"。全部从**产物**取（schema/glass/effects/
  // panel 都内联在 lib/client.js 里），不重打字。
  {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const allRules = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((m) => ({ header: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
    const fcRules = allRules.filter((r) => r.header.includes('data-we-sidebar-fullclear'));
    check('F7a 全透明规则组在位（≥3 条）且每条都带壁纸门（无壁纸时不生效）',
      fcRules.length >= 3 && fcRules.every((r) => r.header.includes('data-we-wallpaper')),
      fcRules.length + ' 条 · 缺壁纸门 ' + fcRules.filter((r) => !r.header.includes('data-we-wallpaper')).length);
    // 容器覆盖：六变量归零（地板 / 色染 / 釉光三组）—— 面板 color-mix 与渐变靠它透掉。
    const container = fcRules.find((r) => r.header.includes('[data-dsh-better-sidebar]'));
    const ZEROS = ['--we-readability-floor: 0', '--we-sidebar-tint: 0%',
      '--we-sidebar-color: transparent', '--we-sidebar-sheen: 0',
      '--we-sidebar-sheen-a: 0', '--we-sidebar-sheen-b: 0', '--we-sidebar-sheen-c: 0'];
    check('F7b 容器覆盖规则把地板/色染/釉光六个变量归零',
      !!container && ZEROS.every((z) => container.body.includes(z)),
      container ? ZEROS.filter((z) => !container.body.includes(z)).join(' | ') || '六项齐' : '规则缺失');
    // 显式接管：右栏那条必须是**画底色**的规则（容器覆盖那条也含 panel 选择器但只写变量）。
    const rp = fcRules.find((r) => r.header.includes('[data-sidebar-right-panel]')
      && r.body.includes('background-color'));
    check('F7c 右栏显式接管：展开态门 + 透明 !important + 釉光关掉',
      !!rp && rp.header.includes('[data-sidebar-right-open]')
      && rp.body.includes('background-color: transparent !important')
      && rp.body.includes('background-image: none !important'),
      rp ? rp.header.slice(0, 100) : '规则缺失');
    // 左栏：一条规则两个选择器（浅 + 深）—— 按**选择器**数，不按规则条数。
    const leftRule = fcRules.find((r) => r.header.includes('data-we-left-sidebar'));
    const leftSels = leftRule ? leftRule.header.split(',').filter((h) => h.includes('data-we-left-sidebar')) : [];
    check('F7d 左栏显式接管：浅深两个选择器都在（深色带 data-ds-dark-theme 提权压软件渲染兜底）',
      leftSels.length === 2 && leftSels.some((h) => h.includes('data-ds-dark-theme'))
      && leftRule.body.includes('background-color: transparent !important'),
      '选择器 ' + leftSels.length + ' 个');
    // 链路：默认关（安全不变量）+ 成对挂摘 + UI 行过 weT。
    check('F7e 设置键默认关且 kind 为 boolFalse（默认态地板照旧兜底）',
      /sidebarFullClear:\s*false,/.test(SRC) && /sidebarFullClear:\s*\{\s*kind:\s*'boolFalse'\s*\}/.test(SRC));
    const sets = (SRC.match(/setAttribute\("data-we-sidebar-fullclear"/g) || []).length;
    const rems = (SRC.match(/removeAttribute\("data-we-sidebar-fullclear"/g) || []).length;
    const paired = SRC.includes('else document.body.removeAttribute("data-we-sidebar-fullclear")');
    check('F7f 门控属性有挂有摘：applyGlass 成对（if/else）+ clearEffects 卸载再摘一次（rem ≥2）',
      sets >= 1 && paired && rems >= 2, 'set=' + sets + ' rem=' + rems + ' paired=' + paired);
    check('F7g UI 行存在且文案过 weT（新中文必须进 weT + 词表）',
      /weT\("侧栏全透明"\)/.test(SRC) && /"侧栏全透明":\s*"/.test(SRC));
    // 负对照：把上面几条判据各自喂坏输入，必须判出（判据不是恒真）。
    const gateOk = (r) => r.header.includes('data-we-wallpaper');
    check('negative control F7-1: 缺壁纸门的全透明规则会被同一条判据判出',
      !gateOk({ header: 'body[data-we-sidebar-fullclear] [data-dsh-better-sidebar]' })
      && fcRules.every(gateOk));
    const defaultOk = (src) => /sidebarFullClear:\s*false,/.test(src)
      && /sidebarFullClear:\s*\{\s*kind:\s*'boolFalse'\s*\}/.test(src);
    check('negative control F7-2: 默认 true（地板默认被拿掉）或缺 kind 会被同一条判据判出',
      !defaultOk('sidebarFullClear: true, sidebarFullClear: { kind: \'boolFalse\' }')
      && !defaultOk('sidebarFullClear: false,')
      && defaultOk(SRC));
    const zerosOk = (body) => ZEROS.every((z) => body.includes(z));
    check('negative control F7-3: 六变量缺一项会被同一条判据判出',
      !zerosOk(ZEROS.slice(1).join('; ')) && zerosOk(container ? container.body : ''));
    const unpairOk = (src) => (src.match(/setAttribute\("data-we-sidebar-fullclear"/g) || []).length >= 1
      && src.includes('else document.body.removeAttribute("data-we-sidebar-fullclear")')
      && (src.match(/removeAttribute\("data-we-sidebar-fullclear"/g) || []).length >= 2;
    check('negative control F7-4: 只挂不摘（漏 clearEffects 那次）会被同一条判据判出',
      !unpairOk('setAttribute("data-we-sidebar-fullclear","on"); else document.body.removeAttribute("data-we-sidebar-fullclear")')
      && unpairOk(SRC));
  }

  // ── F8 (#164)：原生 select 弹层的选项行必须显式「不透明底 + 对比墨」──────────────────
  // Chromium 的弹层是独立文档：画布只在 select 自身背景不透明时才取它的底色，而我们的
  // select 是透明玻璃底 ⇒ 弹层落到默认浅色画布；选项文字却继承 select 的墨色 ⇒ 深色主题
  // （浅字）与「用户把"正文"角色设成浅色」两档都变成浅字浅底。#164 的修法是把这一对换成
  // 按**有效墨色**派生的 --we-popup-row-bg / --we-popup-row-ink。判据钉三件事：
  //   ① **全局** select option 规则在位且读的就是这一对（防止退回半透明玻璃形态）；
  //   ② 选中行单钉（UA 的 Highlight 蓝不吃这一对）；
  //   ③ 自家 .we-picker 子树那条也在（特异性更高，宿主若有类名压 option 的规则也盖得过）。
  {
    // header 可能带着规则前的整段注释（rulesWithProp 取的是"上一个 } 到 { 之间"的原文）
    // ⇒ 先剥注释再匹配选择器，避免"注释里出现同名选择器"与"注释吃掉行首锚"两种假判。
    const norm = (r) => ({
      header: r.header.replace(/\/\*[^]*?\*\//g, ' ').replace(/\s+/g, ' ').trim(),
      body: r.body,
    });
    const optRules = rulesWithProp('background-color').map(norm);
    const globalRules = optRules.filter((r) => r.header === 'select option');
    const groupRules = optRules.filter((r) => r.header === 'select optgroup');
    const checkedRules = optRules.filter((r) => r.header === 'select option:checked');
    const pickerRules = optRules.filter((r) => /(^|,)\s*(\.we-picker select|\.we-picker__select) option$/.test(r.header));
    const pairOk = (r) => /background-color:\s*var\(--we-popup-row-bg/.test(r.body)
      && /color:\s*var\(--we-popup-row-ink/.test(r.body);
    // 选中行不是行配对（语义不同）⇒ 单独一条断言。填充必读 -src、不读 --we-accent：
    // 设置窗那个作用域块末尾把 --we-accent 掐成 initial（块内既有消费一律走 -src），而
    // #164 的复现入口恰在窗内 —— 读 --we-accent 会恒落兜底色、与跟随用户的墨色错配。
    const accentOk = (r) => /background-color:\s*var\(--we-accent-src,/.test(r.body)
      && /color:\s*var\(--we-popup-row-checked-ink,/.test(r.body);
    const f8Ok = (g, gr, c, p) => g.length >= 1 && g.every(pairOk)
      && gr.length >= 1 && gr.every(pairOk)
      && c.length >= 1 && c.every(accentOk) && p.length >= 1 && p.every(pairOk);
    check('F8 原生下拉弹层选项行：全局 option / optgroup + 自家 picker 三条读 --we-popup-row-bg / -ink，选中行读 accent-src + checked-ink',
      f8Ok(globalRules, groupRules, checkedRules, pickerRules),
      'global=' + globalRules.length + ' · optgroup=' + groupRules.length + ' · checked=' + checkedRules.length
      + ' · picker=' + pickerRules.length
      + ' · 选择器 ' + optRules.filter((r) => /option/.test(r.header)).map((r) => r.header.slice(0, 48)).join(' | '));
    const g0 = globalRules[0];
    const badOpaque = g0 ? {
      header: g0.header,
      body: g0.body.replace(/background-color:\s*var\(--we-popup-row-bg[^;]*;/,
        'background-color: color-mix(in srgb, var(--we-sidebar-color) 20%, transparent);'),
    } : null;
    const badNoInk = g0 ? {
      header: g0.header,
      body: g0.body.replace(/\s*color:\s*var\(--we-popup-row-ink[^;]*;/, ''),
    } : null;
    check('negative control F8-1: 全局那条底色改回半透明玻璃（弹层再次浅底浅字）会被判出',
      badOpaque ? !pairOk(badOpaque) : false);
    check('negative control F8-2: 全局那条丢掉墨色声明会被判出',
      badNoInk ? !pairOk(badNoInk) : false);
    check('negative control F8-3: 只剩自家 picker 那条、全局那条缺失会被判出',
      pickerRules.length >= 1 && !f8Ok([], groupRules, checkedRules, pickerRules));
    const c0 = checkedRules[0];
    const badChecked = c0 ? {
      header: c0.header,
      body: c0.body.replace(/background-color:\s*var\(--we-accent-src,[^;]*;/, 'background-color: transparent;'),
    } : null;
    check('negative control F8-4: 选中行底色改回 transparent（UA 蓝底下自定义墨不可控）会被判出',
      badChecked ? !accentOk(badChecked) : false);
    // 这条负对照钉的正是本 PR 复审时实测到的缺口：填充写 --we-accent（而不是 -src）时，
    // 设置窗那块把 --we-accent 掐成 initial ⇒ 填充恒落兜底色、与用户 accent 脱钩。
    const badSrc = c0 ? {
      header: c0.header,
      body: c0.body.replace(/var\(--we-accent-src,/, 'var(--we-accent,'),
    } : null;
    check('negative control F8-5: 选中行填充改读 --we-accent（设置窗内被掐成 initial ⇒ 恒落兜底、与用户配色脱钩）会被判出',
      badSrc ? !accentOk(badSrc) : false);
    check('negative control F8-6: 分组标签 optgroup 那条缺失会被判出',
      !f8Ok(globalRules, [], checkedRules, pickerRules));
  }

  // ── F9 (#164)：行配对必须随产物交付、是纯函数，且网格内处处达标 ────────────────────
  // 「只随主题翻转」救不了自定义浅墨那一档（浅色主题默认浅底 + 用户 #fff 墨 = 白字白底），
  // 所以判据不能只看"有没有这对令牌"，必须**复算**：抽产物里的 wePopupRowPair 对一网格墨色
  // 各跑一遍，逐对算对比度。中灰是最难的一档（白/黑两臂在相对亮度 0.1791 处只有 4.58:1）。
  {
    const fnStart = SRC.indexOf('function wePopupRowPair(');
    let fnSrc = null;
    if (fnStart >= 0) {
      let depth = 0;
      for (let i = fnStart; i < SRC.length; i++) {
        const ch = SRC[i];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { fnSrc = SRC.slice(fnStart, i + 1); break; } }
      }
    }
    const wePopupRowPair = fnSrc ? new Function('return (' + fnSrc + ')')() : null;
    const usable = typeof wePopupRowPair === 'function';
    check('F9 弹层行配对函数随产物交付且可独立复算', usable);
    if (usable) {
      const INKS = [
        ['宿主深墨（浅主题默认）', '#1f2328'],
        ['宿主浅墨（深主题默认）', '#e6e8eb'],
        ['纯白（#164 场景 B）', '#ffffff'],
        ['纯黑', '#000000'],
        ['中灰（两臂最窄处）', '#7f7f7f'],
        ['彩墨 浅黄', '#f5d76e'],
        ['彩墨 靛蓝', '#3b3f8f'],
      ];
      const pairs = INKS.map(([label, ink]) => {
        const p = wePopupRowPair(ink);
        const hex = p && /^#[0-9a-f]{6}$/.test(p.bg);
        return { label, ink, bg: p && p.bg, ratio: hex ? contrast(hex2rgb(p.bg), hex2rgb(ink)) : 0 };
      });
      const worst = pairs.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
      check('F9a 七档墨色的行底都解析成不透明 #rrggbb 且与墨色对比度 ≥4.5:1', worst.ratio >= 4.5,
        '最差 ' + worst.label + ' → ' + worst.bg + ' vs ' + worst.ink + ' = ' + worst.ratio.toFixed(2) + ':1'
        + ' · 全档 ' + pairs.map((p) => p.ratio.toFixed(2)).join('/'));
      const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
      const dL = wePopupRowPair('#1f2328');
      const dD = wePopupRowPair('#e6e8eb');
      check('F9b 主题默认墨色下逐位还原现状（浅 #ffffff+宿主深墨 / 深 #1e1f26+宿主浅墨）',
        same(dL.bg, '#ffffff') && same(dL.ink, '#1f2328') && same(dD.bg, '#1e1f26') && same(dD.ink, '#e6e8eb'),
        'light=' + dL.bg + '/' + dL.ink + ' · dark=' + dD.bg + '/' + dD.ink);
      check('F9c 输入缺失 / 不可解析 ⇒ 返回 null，交给样式表缺省兜底（不写脏值）',
        wePopupRowPair('') === null && wePopupRowPair(undefined) === null && wePopupRowPair('rgba(0,0,0,.5)') === null);
      // 负对照：短路掉"对比度约束"（一律给浅基色 = 只认墨色、不校验）必须被同一条网格判红。
      const naiveWorst = Math.min(...INKS.map(([, ink]) => contrast(hex2rgb('#ffffff'), hex2rgb(ink))));
      check('negative control F9-1: 不做钳制（一律给 #ffffff 行底）在纯白墨上会被同一条网格判红',
        naiveWorst < 4.5, 'naive worst=' + naiveWorst.toFixed(2) + ':1');
    }
  }

  // ── F10 (#164 / P1)：选中行的墨 = 纯白 / 纯黑两支里**实算对比度更大**的那支 ─────────
  // 旧版（白 vs #0f1115 对比度取大）在九档采样面上全绿，但连续色域最差只有 ≈4.35:1
  // （accent #de3c42、灰阶 #797979）—— 判据的**采样面**有缺口，不是实现侥幸达标。
  // 现在换成**连续 + 自适应**网格：256 灰阶 + 6³ 粗立方 + （每一级取当前最差点）邻域
  // 逐级细化 ±51 → ±17 → ±5 → ±1，门限 4.5。纯白/纯黑两支的等点在 L≈0.1791、比值
  // ≈4.58 ⇒ 「取大」自带 4.58:1 的全局下界，细化网格必须落在与之相符的位置。
  // 判据从**产物**里抽出 weCheckedRowInk 复算；负对照同时复刻两种旧实现（#0f1115 取大、
  // 0.45 阈值），并用同一条网格证明它们判红 —— 先红后绿的那条红就是 F10-1。
  {
    const fnStart = SRC.indexOf('function weCheckedRowInk(');
    let fnSrc = null;
    if (fnStart >= 0) {
      let depth = 0;
      for (let i = fnStart; i < SRC.length; i++) {
        const ch = SRC[i];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { fnSrc = SRC.slice(fnStart, i + 1); break; } }
      }
    }
    const weCheckedRowInk = fnSrc ? new Function('return (' + fnSrc + ')')() : null;
    const usable10 = typeof weCheckedRowInk === 'function';
    check('F10 选中行墨函数随产物交付且可独立复算', usable10);
    if (usable10) {
      const hexOf = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      const clamp255 = (v) => Math.max(0, Math.min(255, v));
      const neighborhood = (hex, step) => {
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        const out = [];
        for (const dr of [-step, 0, step]) for (const dg of [-step, 0, step]) for (const db of [-step, 0, step]) {
          out.push(hexOf(clamp255(r + dr), clamp255(g + dg), clamp255(b + db)));
        }
        return out;
      };
      // ① 连续面：全 256 灰阶（等点 L≈0.1791 落在灰阶上，是最差候选所在的脊）
      // ② 粗立方：**16 级/通道 = 4096 点**（与独立复核方用的同一张网格，结论可直接对号）
      // ③ 自适应细化：每级取当前最差点、按该级步长的 3³ 邻域加深（去重后并进网格）
      const seen = new Set();
      const grid = [];
      const push = (acc) => { if (!seen.has(acc)) { seen.add(acc); grid.push(acc); } };
      for (let i = 0; i < 256; i++) push(hexOf(i, i, i));
      for (let r = 0; r < 16; r++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) push(hexOf(r * 17, g * 17, b * 17));
      const ratioOf = (acc, ink) => (ink ? contrast(hex2rgb(acc), hex2rgb(ink)) : 0);
      for (const step of [51, 17, 5, 1]) {
        let worstAcc = grid[0], worstRatio = Infinity;
        for (const acc of grid) {
          const r = ratioOf(acc, weCheckedRowInk(acc));
          if (r < worstRatio) { worstRatio = r; worstAcc = acc; }
        }
        for (const acc of neighborhood(worstAcc, step)) push(acc);
      }
      const rows = grid.map((acc) => {
        const ink = weCheckedRowInk(acc);
        return { acc, ink, ratio: ratioOf(acc, ink) };
      });
      const worst = rows.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
      check('F10a 连续/自适应网格上选中行墨都是黑/白且对比度 ≥4.5:1', worst.ratio >= 4.5,
        '网格 ' + grid.length + ' 档 · 最差 ' + worst.acc + ' vs ' + worst.ink + ' = ' + worst.ratio.toFixed(3) + ':1'
        + ' · 低于 4.5 的档数 ' + rows.filter((r) => r.ratio < 4.5).length);
      check('F10a-2 两支只出纯黑 / 纯白（不得再混进有色深墨 #0f1115）',
        rows.every((r) => r.ink === '#ffffff' || r.ink === '#000000'),
        '不同取值 ' + [...new Set(rows.map((r) => r.ink))].join(' / '));
      check('F10b 输入缺失 / 不可解析 ⇒ 返回 null，交给样式表缺省兜底（不写脏值）',
        weCheckedRowInk('') === null && weCheckedRowInk(undefined) === null && weCheckedRowInk('rgba(0,0,0,.5)') === null);
      // F10c：兜底**只在 accent 解析不出、JS 没写值**时可达 —— 那一档填充同时落回缺省
      // #4f8cff。两条硬要求：① 兜底墨必须**等于 JS 对缺省填充的判决**（同一套择优逻辑，
      // 不许写死一个"看起来够深"的墨 —— 曾经的 #0f1115 就是这样漏过了）；② 兜底对过红线。
      const checkedCss = (CSS.match(/select option:checked\s*\{[^}]*\}/) || [''])[0];
      const fbFill = /var\(--we-accent-src,\s*(#[0-9a-fA-F]{6})\)/.exec(checkedCss);
      const fbInk = /var\(--we-popup-row-checked-ink,\s*(#[0-9a-fA-F]{6})\)/.exec(checkedCss);
      const fbInkHex = fbInk ? fbInk[1].toLowerCase() : null;
      const fbFillHex = fbFill ? fbFill[1].toLowerCase() : null;
      check('F10c 缺省兜底墨 = JS 对缺省填充的判决（兜底不得落回固定 #0f1115，也不得与其不一致）',
        !!fbInkHex && !!fbFillHex && fbInkHex === weCheckedRowInk(fbFillHex),
        'CSS 兜底对 ' + fbFillHex + ' × ' + fbInkHex + ' · JS 判决 ' + (fbFillHex ? weCheckedRowInk(fbFillHex) : '-'));
      const fbRatio = (fbFillHex && fbInkHex) ? contrast(hex2rgb(fbFillHex), hex2rgb(fbInkHex)) : 0;
      check('F10c-2 样式表缺省兜底对也 ≥4.5:1', fbRatio >= 4.5, '缺省对 = ' + fbRatio.toFixed(2) + ':1');
      // 负对照 F10-1：**先红后绿的那条红** —— 复刻 PR #203 原实现（白 vs #0f1115 取大）。
      const ratioScalar = (a, b) => (a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05));
      const lumOf = (hex) => lum(hex2rgb(hex));
      const armInkOf = (acc, armHex) => {
        const l = lumOf(acc);
        return ratioScalar(1, l) >= ratioScalar(lum(hex2rgb(armHex)), l) ? '#ffffff' : armHex;
      };
      const worstOver = (list, armHex) => Math.min(...list.map((acc) => ratioScalar(lumOf(acc), lumOf(armInkOf(acc, armHex)))));
      const oldWorst = worstOver(grid, '#0f1115');
      check('negative control F10-1: 旧实现（白 vs #0f1115 取大，PR #203 原样）会被同一条网格判红',
        oldWorst < 4.5, 'old worst=' + oldWorst.toFixed(4) + ':1');
      // 负对照 F10-1b：暗臂的**临界值**也得判红。#0a0a0a 是"看着够深"的合理候选，但全局
      // 最差 = 等点比值 = 1.05/(L*+0.05)，要 ≥4.5 必须暗臂 Lin ≤ 0.001852 ⇒ #0a0a0a
      // (Lin≈0.00278) 只有 4.4495，仍差 0.05。这条钉住"暗臂必须真的是纯黑"。
      const nearWorst = worstOver(grid, '#0a0a0a');
      check('negative control F10-1b: 暗臂只放到 #0a0a0a（Lin≈0.0028，看着够深）仍会被同一条网格判红',
        nearWorst < 4.5, '#0a0a0a worst=' + nearWorst.toFixed(4) + ':1');
      // 负对照 F10-2：更早的 0.45 阈值口径（复审补丁前）也在这条网格上判红。
      const inkByThreshold = (acc) => (lumOf(acc) > 0.45 ? '#0f1115' : '#ffffff');
      const naiveWorst10 = Math.min(...grid.map((acc) => ratioScalar(lumOf(acc), lumOf(inkByThreshold(acc)))));
      check('negative control F10-2: 沿用按钮那条 0.45 阈值（中亮度 accent 上给白字）会被同一条网格判红',
        naiveWorst10 < 4.5, 'naive worst=' + naiveWorst10.toFixed(2) + ':1');
      // 负对照 F10-3：网格自身有牙 —— 旧版 F10 的**九档手挑采样面**对旧实现是**漏判**的
      //（那九档最差 4.72:1 ⇒ 全绿）。这条钉住"采样面也是判据的一部分"：谁把网格缩回
      // 采样面，F10-1 的红就没了，而这条会立刻指出缩回去等于漏判。
      const nineDeck = ['#4f8cff', '#3366cc', '#1a237e', '#0b1020', '#000000', '#7f7f7f', '#ffffff', '#ffcf4d', '#f5d76e'];
      const oldWorstNine = worstOver(nineDeck, '#0f1115');
      check('negative control F10-3: 旧的九档采样面对旧实现漏判（该面最差 ≥4.5 ⇒ 全绿）—— 采样面必须连续',
        oldWorstNine >= 4.5, '旧实现九档最差=' + oldWorstNine.toFixed(2) + ':1');
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0
    ? 'ALL READABILITY FLOOR CHECKS PASSED'
    : failed.length + ' CHECK(S) FAILED'));
  process.exit(failed.length === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error('TEST ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
}
