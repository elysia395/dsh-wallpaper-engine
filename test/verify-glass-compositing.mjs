// Verify the GLASS COMPOSITING invariants (static, parse-based — no browser).
//
// Why this suite exists: a "noise / grain" experiment (option C, kept only as
// the local tag archive/noise-overlay-exp) laid a grain layer on the composer
// card as a `::after` carrying `mix-blend-mode: overlay` + `opacity: 0.05`. That
// broke real behaviour: the composer's `backdrop-filter` lives on the SAME
// card's `::before`, and `mix-blend-mode` (like `isolation: isolate`, `filter:`
// and `opacity:` < 1) makes its ancestor an isolated group / backdrop root — so
// the `::before` found an EMPTY backdrop and the glass went dead (the 玻璃
// slider stopped affecting the composer). Readability was also measured to be
// unaffected by the grain (masker 44–79x weaker than the residual text signal),
// so the whole experiment was dropped. The class of bug survived the drop
// because nothing asserted it statically: this suite is that missing guard.
//
// Assertions (all derived from the BUILT lib/client.js — nothing re-typed):
//   G0  the guard really read the injected stylesheet (non-empty CSS + a
//       plausible rule count), so a bundle-shape change can never make the
//       checks below pass vacuously.
//   G1  the carrier inventory is derived from the stylesheet itself: every rule
//       declaring a non-none `backdrop-filter` names a glass carrier, and the
//       required carriers ([data-composer-card] incl. its ::before,
//       [class*="_bubble"], and the plugin's own glass panels) are all present.
//   G2  no rule introduces `mix-blend-mode` (other than `normal`),
//       `isolation: isolate`, `filter:` / `-webkit-filter:` (other than `none`),
//       or `opacity:` < 1 ON a glass carrier or on one of its pseudo-elements.
//       Rationale: those properties create an isolated group / backdrop root and
//       can empty the backdrop that `backdrop-filter` samples — exactly how the
//       dropped noise commit broke the composer glass.
//   G3  the same properties never appear INSIDE a carrier (a descendant
//       selector) or on an ANCESTOR of one — an isolated group anywhere on that
//       axis can swallow the carrier's backdrop sampling.
//   G4  a rule that declares a non-none `backdrop-filter` never also declares
//       one of those primitives in the SAME body (the blur carrier must stay a
//       pure glass surface).
//   G5  the two carriers that must keep their blur are present and non-none in
//       the DEFAULT (no-flag) build: the composer `::before` blur expression and
//       the message-bubble blur expression, each reading --we-blur AND
//       --we-saturate.
//   G6  the composer card ITSELF keeps `backdrop-filter: none` (the blur must
//       stay on `::before`: a non-none backdrop-filter on the card makes it a
//       containing block for its position:fixed descendants — #89).
//   N1  `@keyframes` blocks, which G2/G3 exempt as transient entry fades, never
//       carry a compositing primitive of their own (only opacity/transform).
//   N2  the detector has teeth: the EXACT dropped-commit selector shape (with its
//       `body[data-we-noise="on"]` prefix and `:not(...)::after`) is flagged, and
//       its clean twin is not.
//   D1  the Task-1 contract: in the DEFAULT path `--we-saturate` is a CONSTANT
//       (the 玻璃 slider drives frost depth only — one slider, one job), the
//       constant sits in the modest liquid-glass band and BELOW the stylesheet's
//       own fallback default, and the `?we-saturate=legacy` escape hatch still
//       restores the old coupled ramp verbatim.
//
// Usage: node test/verify-glass-compositing.mjs [path-to-client-bundle]
//   The optional argument points the parser at another bundle; the negative
//   control uses it to prove the assertions fail on a mutated copy.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const CLIENT = process.argv[2] || fileURLToPath(new URL('../lib/client.js', import.meta.url));
const SRC = readFileSync(CLIENT, 'utf8');

// ── source → the stylesheet the plugin injects ──────────────────────────────
const FLOOR = {
  light: Number((SRC.match(/const READABILITY_FLOOR = ([\d.]+);/) || [])[1]),
  dark: Number((SRC.match(/const READABILITY_FLOOR_DARK = ([\d.]+);/) || [])[1]),
};
// ⚠️ 锚点锚在行首且容忍缩进（产物把内联模块整段缩进过）：散文里出现同样的声明字面量会把锚点带偏。
const CSS_BODY_MATCH = SRC.match(/^\s*const CSS = `([^`]*)`;/m);
const CSS_BODY = CSS_BODY_MATCH ? CSS_BODY_MATCH[1] : '';
let CSS = '';
let cssError = null;
try {
  if (CSS_BODY) {
    // Evaluate the template with exactly the constants the source declares, so
    // the string parsed here IS the string the plugin injects.
    CSS = new Function('READABILITY_FLOOR', 'READABILITY_FLOOR_DARK',
      'return `' + CSS_BODY + '`;')(FLOOR.light, FLOOR.dark);
  }
} catch (err) { cssError = err && err.message; }
// Comments are prose that can contain ':' and braces; drop them before parsing
// so the selector/declaration extraction is exact.
CSS = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');

// ── CSS parsing helpers ─────────────────────────────────────────────────────
/** Split a selector list into its comma-separated selectors, whitespace-collapsed. */
function selectorsOf(header) {
  const lastBrace = header.lastIndexOf('{');
  const tail = lastBrace >= 0 ? header.slice(lastBrace + 1) : header;
  return tail.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** Split one selector into compound selectors at TOP-level combinators only
 *  (spaces/`>`/`+`/`~` inside `:has(...)`, `:not(...)`, `[a="b c"]` must not split). */
function compounds(sel) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '>' || ch === '+' || ch === '~')) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Distinctive class/id/attribute tokens of a compound (falls back to the tag). */
function tokensOf(compound) {
  const tokens = [];
  const re = /\[[^\]]*\]|\.[A-Za-z0-9_-]+|#[A-Za-z0-9_-]+/g;
  let m;
  while ((m = re.exec(compound))) tokens.push(m[0]);
  if (tokens.length === 0) {
    const tag = compound.match(/^[A-Za-z][A-Za-z0-9-]*/);
    if (tag) tokens.push(tag[0]);
  }
  return tokens;
}

const WORD = /[A-Za-z0-9_-]/;
/** Does `hay` contain `token` as a complete selector token? `.we-update-notice`
 *  must NOT match inside `.we-update-notice__body` (BEM suffix is a longer name),
 *  which a plain substring test would wrongly flag. */
function containsToken(hay, token) {
  let from = 0;
  for (;;) {
    const at = hay.indexOf(token, from);
    if (at < 0) return false;
    const after = hay[at + token.length] || '';
    if (!WORD.test(after)) return true;
    from = at + 1;
  }
}

/** The first declaration value for `prop` in a rule body (prop is matched at a
 *  token boundary so `filter` never matches inside `backdrop-filter`). */
function declValue(body, prop) {
  const m = body.match(new RegExp('(?:^|[\\s;{])' + prop + ':\\s*([^;}]+)', 'i'));
  return m ? m[1].trim() : null;
}

/** Compositing primitives that create an isolated group / backdrop root. */
const RISK_PROPS = [
  { prop: 'mix-blend-mode', label: 'mix-blend-mode', bad: (v) => v.toLowerCase() !== 'normal' },
  { prop: 'isolation', label: 'isolation', bad: (v) => v.toLowerCase().startsWith('isolate') },
  { prop: 'filter', label: 'filter', bad: (v) => v.toLowerCase() !== 'none' },
  { prop: '-webkit-filter', label: '-webkit-filter', bad: (v) => v.toLowerCase() !== 'none' },
  { prop: 'opacity', label: 'opacity < 1', bad: (v) => Number.isFinite(parseFloat(v)) && parseFloat(v) < 1 },
];

/** Run the whole detection over one stylesheet string. Factored out so the
 *  negative control in N2 exercises the very same code path as the real checks. */
function analyze(cssText) {
  const keyframes = [];
  // Mask @keyframes blocks (transient entry fades, checked separately in N1)
  // before the steady-state rule scan.
  let masked = '';
  let i = 0;
  for (;;) {
    const at = cssText.indexOf('@keyframes', i);
    if (at < 0) { masked += cssText.slice(i); break; }
    masked += cssText.slice(i, at);
    const open = cssText.indexOf('{', at);
    if (open < 0) { masked += cssText.slice(at); break; }
    let depth = 0;
    let end = -1;
    for (let j = open; j < cssText.length; j++) {
      if (cssText[j] === '{') depth++;
      else if (cssText[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) { masked += cssText.slice(at); break; }
    keyframes.push({ name: cssText.slice(at, open).trim(), body: cssText.slice(open + 1, end) });
    masked += ' '.repeat(end - at + 1);
    i = end + 1;
  }

  // Every flat rule, brace-depth matched (same convention as verify-readability).
  const rules = [];
  let from = 0;
  for (;;) {
    const open = masked.indexOf('{', from);
    if (open < 0) break;
    const prevClose = masked.lastIndexOf('}', open);
    const header = masked.slice(prevClose + 1, open);
    let depth = 0;
    let close = -1;
    for (let j = open; j < masked.length; j++) {
      if (masked[j] === '{') depth++;
      else if (masked[j] === '}') { depth--; if (depth === 0) { close = j; break; } }
    }
    if (close < 0) break;
    rules.push({
      header,
      inSupports: /@supports/.test(header),
      selectors: selectorsOf(header),
      body: masked.slice(open + 1, close),
    });
    from = open + 1;
  }

  // Carriers: every selector whose rule declares a non-none backdrop-filter.
  const carriers = new Map(); // "token token" -> { sel, compounds, tokens, blur }
  for (const r of rules) {
    const bf = declValue(r.body, 'backdrop-filter') || declValue(r.body, '-webkit-backdrop-filter');
    if (!bf || /^none\b/i.test(bf)) continue;
    for (const s of r.selectors) {
      const cps = compounds(s);
      if (!cps.length) continue;
      const tokens = tokensOf(cps[cps.length - 1]);
      if (!tokens.length) continue;
      const key = tokens.join(' ');
      if (!carriers.has(key)) carriers.set(key, { sel: s, compounds: cps, tokens, blur: bf });
    }
  }

  // Violations: risky declarations on / inside / above a carrier.
  const violations = [];
  for (const r of rules) {
    for (const risk of RISK_PROPS) {
      const v = declValue(r.body, risk.prop);
      if (v === null || !risk.bad(v)) continue;
      for (const s of r.selectors) {
        const cps = compounds(s);
        if (!cps.length) continue;
        for (let ci = 0; ci < cps.length; ci++) {
          for (const [key, c] of carriers) {
            if (!c.tokens.every((t) => containsToken(cps[ci], t))) continue;
            violations.push({
              scope: ci === cps.length - 1 ? 'ON' : 'INSIDE',
              prop: risk.label, value: v, sel: s, carrier: key,
            });
          }
        }
        for (const [key, c] of carriers) {
          const isPrefix = cps.length < c.compounds.length
            && cps.every((x, k) => x === c.compounds[k]);
          if (isPrefix) violations.push({ scope: 'ABOVE', prop: risk.label, value: v, sel: s, carrier: key });
        }
      }
      break; // one risky property per rule body is enough to report
    }
  }

  // A blur-declaring rule must not also declare a risky primitive itself.
  const impureCarriers = [];
  for (const r of rules) {
    const bf = declValue(r.body, 'backdrop-filter') || declValue(r.body, '-webkit-backdrop-filter');
    if (!bf || /^none\b/i.test(bf)) continue;
    for (const risk of RISK_PROPS) {
      const v = declValue(r.body, risk.prop);
      if (v !== null && risk.bad(v)) impureCarriers.push({ prop: risk.label, value: v, sel: r.selectors[0] });
    }
  }

  return { rules, carriers, violations, impureCarriers, keyframes };
}

const fmtViolation = (v) => v.scope + ' ' + v.carrier + ' <= ' + v.prop + ': ' + v.value + ' (' + v.sel + ')';

/** First DEFAULT-build rule keeping a non-none blur on `token` (+ optional pseudo). */
function blurCarrierRule(rules, token, pseudo) {
  for (const r of rules) {
    if (r.inSupports) continue;
    for (const s of r.selectors) {
      if (/data-we-glass-fallback/.test(s)) continue;
      const cps = compounds(s);
      if (!cps.length) continue;
      const last = cps[cps.length - 1];
      if (!containsToken(last, token)) continue;
      if (pseudo && !last.includes(pseudo)) continue;
      const bf = declValue(r.body, 'backdrop-filter') || declValue(r.body, '-webkit-backdrop-filter');
      if (!bf || /^none\b/i.test(bf)) continue;
      return { sel: s, blur: bf };
    }
  }
  return null;
}

function main() {
  const { rules, carriers, violations, impureCarriers, keyframes } = analyze(CSS);

  // ── G0: the guard actually read the injected stylesheet ──────────────────
  check('G0 the injected stylesheet was parsed (non-empty CSS, plausible rules)',
    !cssError && CSS.length > 10000 && rules.length > 100,
    'CSS=' + CSS.length + 'b · rules=' + rules.length + ' · carriers=' + carriers.size
      + (cssError ? ' · CSS eval error: ' + cssError : ''));

  // ── G1: carrier inventory, derived from the stylesheet ───────────────────
  const REQUIRED = [
    { label: 'composer card / its ::before', token: '[data-composer-card]' },
    { label: 'message bubble', token: '[class*="_bubble"]' },
    // 轨迹（trajectory）视图的内容区：模块自带零 backdrop-filter（实测 289 条规则里没有一条），
    // 它的容器只有 --dsw-alias-bg-layer-1 给的**半透明底** ⇒ 在壁纸上是一层平涂的纱。
    // 这三条选择器是给它补霜的那条规则（用户口径："轨迹内容区域也同样做玻璃化"）。
    { label: 'trajectory table pane (frost)', token: '[class*="_tablePane"]' },
    { label: 'trajectory overview preview (frost)', token: '[class*="_overviewPreview"]' },
    { label: 'trajectory program panel (frost)', token: '[class*="_programPanel"]' },
  ];
  const missing = REQUIRED.filter((req) => ![...carriers.values()]
    .some((c) => c.tokens.some((t) => t === req.token)));
  const panelCount = [...carriers.keys()].filter((k) => /^\.we-/.test(k)).length;
  // 插件自己的玻璃面现存 2 块：仓库抽屉（.we-repo-panel--open）与更新通知
  //（.we-update-notice）—— 第三块（仓库弹窗 .we-picker__modal--panel）已随 UI
  // 重构退役（选择壁纸改为页内下钻，不再有玻璃弹窗），地板相应收为 ≥2。
  check('G1 every non-none backdrop-filter rule names a glass carrier, incl. the required composer/bubble/panel carriers',
    missing.length === 0 && panelCount >= 2,
    carriers.size + ' carriers (' + panelCount + ' plugin panels)'
      + (missing.length ? ' · MISSING: ' + missing.map((m) => m.label).join(', ') : ''));

  // ── G2: no compositing primitive ON a carrier (or its pseudo-elements) ───
  const onCarrier = violations.filter((v) => v.scope === 'ON');
  check('G2 no mix-blend-mode/isolation/filter/opacity<1 ON a blur carrier or its pseudo-elements (an isolated group would empty the sampled backdrop)',
    onCarrier.length === 0,
    onCarrier.length ? onCarrier.map(fmtViolation).join(' · ') : '0 violations across ' + carriers.size + ' carriers');

  // ── G3: none INSIDE a carrier, nor on an ancestor of one ─────────────────
  const around = violations.filter((v) => v.scope !== 'ON');
  check('G3 no mix-blend-mode/isolation/filter/opacity<1 INSIDE a blur carrier or on one of its ANCESTORS (same isolated-group / backdrop-root hazard)',
    around.length === 0,
    around.length ? around.map(fmtViolation).join(' · ') : '0 violations');

  // ── G4: a blur rule stays a pure glass surface ───────────────────────────
  check('G4 no rule declaring a non-none backdrop-filter also declares mix-blend-mode/isolation/filter/opacity<1 itself',
    impureCarriers.length === 0,
    impureCarriers.length
      ? impureCarriers.map((v) => v.sel + ' <= ' + v.prop + ': ' + v.value).join(' · ')
      : '0 impure carrier rules');

  // ── G5: the two required carriers keep their blur (default build) ────────
  const composer = blurCarrierRule(rules, '[data-composer-card]', '::before');
  const bubble = blurCarrierRule(rules, '[class*="_bubble"]', '');
  const readsBoth = (bf) => /var\(--we-blur\b/.test(bf) && /var\(--we-saturate\b/.test(bf);
  check('G5 composer ::before and message-bubble blur expressions are present, non-none and read --we-blur AND --we-saturate in the no-flag build',
    !!composer && !!bubble && readsBoth(composer.blur) && readsBoth(bubble.blur),
    'composer::before=' + (composer ? composer.blur : 'MISSING')
      + ' · bubble=' + (bubble ? bubble.blur : 'MISSING'));

  // ── G6: the composer card itself must not carry the blur (#89) ───────────
  let cardOwnBlur = null;
  for (const r of rules) {
    if (r.inSupports) continue;
    for (const s of r.selectors) {
      if (/data-we-glass-fallback/.test(s)) continue;
      const cps = compounds(s);
      if (!cps.length || cps[cps.length - 1] !== '[data-composer-card]') continue;
      const bf = declValue(r.body, 'backdrop-filter');
      if (bf) cardOwnBlur = bf;
    }
  }
  check('G6 the composer card itself keeps backdrop-filter: none (blur stays on ::before — a card-level blur becomes a containing block for its fixed descendants, #89)',
    cardOwnBlur === 'none',
    '[data-composer-card] backdrop-filter = ' + String(cardOwnBlur));

  // ── N1: keyframes (exempt from G2/G3) carry no compositing primitive ─────
  const kfBad = [];
  let kfFades = 0;
  for (const kf of keyframes) {
    if (/opacity:/.test(kf.body)) kfFades++;
    for (const risk of RISK_PROPS) {
      if (risk.prop === 'opacity') continue;
      const v = declValue(kf.body, risk.prop);
      if (v !== null && risk.bad(v)) kfBad.push(kf.name + ' <= ' + risk.label + ': ' + v);
    }
  }
  check('N1 @keyframes (transient entry fades, exempted from G2/G3) never carry mix-blend-mode/isolation/filter of their own',
    kfBad.length === 0,
    keyframes.length + ' keyframes (' + kfFades + ' opacity fades)'
      + (kfBad.length ? ' · ' + kfBad.join(' · ') : ''));

  // ── N2: the detector has teeth (the exact dropped-commit shape) ──────────
  const SYNTHETIC_CARRIER = 'body[data-we-wallpaper] [data-composer-card]::before{content:"";'
    + 'backdrop-filter:blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8));}'
    + 'body[data-we-wallpaper] [class*="_bubble"]{content:"";'
    + 'backdrop-filter:blur(var(--we-blur, 16px)) saturate(var(--we-saturate, 1.8));}';
  // The dropped option-C rule, verbatim in shape: extra body qualifier + :not() + ::after.
  const SYNTHETIC_NOISE = 'body[data-we-wallpaper][data-we-noise="on"] [data-composer-card]:not([class*="cardWorkspaceTrigger"])::after,'
    + 'body[data-we-wallpaper][data-we-noise="on"] [class*="_bubble"]:not([data-side])::after{content:"";'
    + 'mix-blend-mode:overlay;opacity:0.05;}';
  const bad = analyze(SYNTHETIC_CARRIER + SYNTHETIC_NOISE);
  const clean = analyze(SYNTHETIC_CARRIER
    + SYNTHETIC_NOISE.replace('mix-blend-mode:overlay;opacity:0.05;', 'background-image:none;'));
  const badFlagged = bad.violations.filter((v) => v.scope === 'ON');
  check('N2 negative control: the dropped-commit noise rule IS flagged (both carriers), and its clean twin is not — this assertion has teeth',
    badFlagged.length >= 2 && clean.violations.length === 0 && clean.carriers.size === 2,
    'mutated: ' + badFlagged.length + ' on-carrier violations [' + badFlagged.map((v) => v.carrier + ':' + v.prop).join(', ') + ']'
      + ' · clean twin: ' + clean.violations.length + ' violations, ' + clean.carriers.size + ' carriers');

  // ── T1: 轨迹的补霜规则**只补霜**，不叠第二层底 ────────────────────────────
  // 为什么不许叠：那条规则底下的父层已经拿到玻璃配方（--dsw-alias-bg-layer-1）。
  // 再写一层 background-color = 两层可读性下限相乘（0.494 → 0.744），正好把这次
  // 想要的通透收回去 —— 这是本改动唯一容易走反的地方，所以钉住。
  const TRAJ_TOKENS = ['[class*="_tablePane"]', '[class*="_overviewPreview"]', '[class*="_programPanel"]'];
  /** 返回**叠了底**的轨迹选择器（真判据；负对照共用）。 */
  const trajVeilStackers = (cssText) => {
    const parsed = analyze(cssText);
    const bad = [];
    for (const r of parsed.rules) {
      if (r.inSupports) continue;
      for (const sel of r.selectors) {
        const cps = compounds(sel);
        if (!cps.length) continue;
        const last = cps[cps.length - 1];
        if (!TRAJ_TOKENS.some((t) => containsToken(last, t))) continue;
        const bf = declValue(r.body, 'backdrop-filter') || declValue(r.body, '-webkit-backdrop-filter');
        if (!bf || /^none\b/i.test(bf)) continue;              // 只看 blur carrier 那条
        if (/background(?:-color)?\s*:/i.test(r.body)) bad.push(sel);
      }
    }
    return bad;
  };
  const realStackers = trajVeilStackers(CSS);
  // 变异按**选择器**定位（不能按声明的空白字面量：产物把内联模块整段缩进过，
  // 那种锚点在产物上匹配不到 ⇒ 负对照会变成 0 === 0 的假绿）。
  const mutatedStackers = trajVeilStackers(CSS.replace(
    /(\[class\*="_tablePane"\][^{]*\{)/,
    '$1background-color: rgba(255,255,255,0.5);'));
  check('T1 the trajectory frost rules add ONLY frost (no second background layer: stacking two readability floors would take the transparency back)',
    realStackers.length === 0 && mutatedStackers.length === 3,
    'real=' + realStackers.length + ' · mutated(planted background-color)=' + mutatedStackers.length
      + (realStackers.length ? ' · ' + realStackers.join(', ') : ''));

  // ── S1: 侧栏「跟随全局」⇒ 两侧栏同一条配方 ─────────────────────────────────
  // 现场口径："我需要侧栏玻璃也跟随全局"（此前左栏中性 63%/10px、右栏青色 76%/37px）。
  // 跟随的实现**不是把数值抄过去**，而是把侧栏那一套变量**指向**全局三件套（var() 惰性替换）
  // ⇒ 判据也只能这么判：把跟随映射代进两侧栏的声明里，归一化之后必须**逐字相等**
  //（同一层下限 + 同一个染色源 + 同一个色染权重）。
  const followBranch = SRC.match(/if \(selection\.sidebarFollowGlobal\) \{([\s\S]*?)\} else \{/);
  const followBody = followBranch ? followBranch[1] : '';
  const FOLLOW_MAP = [
    ['--we-sidebar-blur', 'var(--we-blur)'],
    ['--we-sidebar-saturate', 'var(--we-saturate)'],
    ['--we-sidebar-tint', 'calc(var(--we-glass-alpha) * 100%)'],
    ['--we-sidebar-color', 'var(--we-follow-tint)'],
  ];
  const declaredFollow = FOLLOW_MAP.every(([k, v]) => followBody.includes('setProperty("' + k + '", "' + v + '")'));
  check('S1a 跟随全局那一支把侧栏变量指向全局三件套（模糊 / 饱和 / 色染权重 / 底色四处，引用而非拷贝）',
    declaredFollow && /data-we-sidebar-follow/.test(SRC),
    declaredFollow ? FOLLOW_MAP.map((x) => x[0]).join(' ') + ' · 另有 body 属性' : '跟随分支缺失或不完整');

  /** 把「跟随态」的映射代进声明，再去掉 fallback 与空白 —— 便于逐字比较。 */
  const normalizedRecipe = (decl) => String(decl || '')
    .replace(/var\(--we-sidebar-color(?:,\s*[^)]*)?\)/g, 'var(--we-follow-tint)')
    .replace(/var\(--we-sidebar-tint(?:,\s*[^)]*)?\)/g, 'calc(var(--we-glass-alpha) * 100%)')
    .replace(/var\(--we-surface-tint-(?:light|dark)(?:,\s*[^)]*)?\)/g, 'var(--we-follow-tint)')
    .replace(/var\(--we-glass-alpha(?:,\s*[^)]*)?\)/g, 'var(--we-glass-alpha)')
    // 侧栏那条带 !important（它要顶掉宿主/内层面板的底），左栏那条不带 —— 那是"谁压谁"
    // 的写法差异，不是配方差异，归一化时抹掉。
    .replace(/!important/g, '')
    .replace(/\s+/g, '');
  const bgOf = (needle, extra) => {
    const r = rules.find((x) => x.header.includes(needle) && (!extra || x.header.includes(extra))
      && declValue(x.body, 'background-color'));
    return r ? declValue(r.body, 'background-color') : '';
  };
  const panelBg = bgOf('[class*="_panel"]', 'data-dsh-better-sidebar');
  const leftBg = bgOf('div:has(> [data-slot="sidebar"])');
  // ⚠️ 合并 #132 对本判据的口径修正：WIP 原版要求两侧**色染权重**也逐字相等 ——
  //    那是 WIP 时代左栏读 `--we-glass-alpha` 的实现。#132 把左栏改成按面独立的
  //    `--we-left-sidebar-alpha`（位置保持迁移、自己的透明度曲线）⇒ "权重相等"的前提
  //    被推翻。现场口径（"两侧栏别一个中性一个青色"）里仍成立、仍要钉的是：
  //      ① 下限层 + 染色源两侧逐字同源（两侧各自的色染权重归一后必须相等）；
  //      ② 右栏跟随态的权重源 = 全局玻璃透明度（写入侧见 S1a；CSS 侧读 --we-sidebar-tint）；
  //      ③ 左栏权重源 = 按面 --we-left-sidebar-alpha（#132 的契约，不许悄悄换回去）。
  const bothWeights = (decl) => String(decl || '')
    .replace(/calc\(var\(--we-glass-alpha(?:,\s*[^)]*)?\)\s*\*\s*100%\)/g, 'W')
    .replace(/calc\(var\(--we-left-sidebar-alpha(?:,\s*[^)]*)?\)\s*\*\s*100%\)/g, 'W');
  const normS1b = (decl) => bothWeights(normalizedRecipe(decl));
  // 负对照的种植点改在**染色源**上（原种植点是色染权重 —— 权重归一后种植不可见 ⇒ 假绿）：
  // 把右栏的色染源换成一个归一化碰不到的字面量。
  const plantedPanel = panelBg.replace('var(--we-sidebar-color)', '#010203');
  check('S1b 跟随全局下两侧栏**同源**（下限层 + 染色源逐字相等；色染权重按 #132 口径各自独立，另见 S1b-w）',
    Boolean(panelBg) && Boolean(leftBg) && normS1b(panelBg) === normS1b(leftBg),
    'panel=' + normS1b(panelBg).slice(0, 96) + ' · left=' + normS1b(leftBg).slice(0, 96));
  check('S1b 负对照：换掉右栏的染色源（字面量种植）就不再相等 —— 判据有牙',
    plantedPanel !== panelBg && normS1b(plantedPanel) !== normS1b(leftBg));
  check('S1b-w 权重源各自钉住：右栏跟随态读 --we-sidebar-tint（随全局玻璃透明度走）、左栏读 --we-left-sidebar-alpha（#132 按面独立）',
    panelBg.includes('var(--we-sidebar-tint)') && !panelBg.includes('var(--we-glass-alpha')
      && leftBg.includes('var(--we-left-sidebar-alpha)') && !leftBg.includes('var(--we-sidebar-tint)'),
    'panel 读=' + (panelBg.includes('var(--we-sidebar-tint)') ? 'sidebar-tint' : '?')
      + ' · left 读=' + (leftBg.includes('var(--we-left-sidebar-alpha)') ? 'left-sidebar-alpha' : '?'));

  const followTint = CSS.match(/--we-follow-tint:\s*var\(--we-surface-tint-(light|dark),\s*#[0-9a-fA-F]{6}\);/g) || [];
  const baseDecl = CSS.match(/--we-readability-base:\s*var\(--we-surface-tint-(light|dark),\s*#[0-9a-fA-F]{6}\);/g) || [];
  check('S1c --we-follow-tint 与 --we-readability-base 同源（两侧栏共用一个按主题钳制后的玻璃色）',
    followTint.length === 2 && baseDecl.length >= 2
      && followTint.every((d, i) => d.replace('--we-follow-tint', 'X').replace(/\s+/g, '')
        === baseDecl[i].replace('--we-readability-base', 'X').replace(/\s+/g, '')),
    'follow-tint=' + followTint.length + ' · base=' + baseDecl.length);

  const sheenFollow = /body\[data-we-sidebar-follow\]\s*\{[^}]*--we-sidebar-sheen-a:\s*var\(--we-panel-sheen-a\)/.test(CSS);
  const sheenCustom = /body\[data-we-sidebar-glass\]:not\(\[data-we-sidebar-follow\]\)\s*\{[^}]*--we-sidebar-sheen-a:\s*calc\(var\(--we-sidebar-sheen(?:,\s*1)?\) \* 0\.14\)/.test(CSS);
  const panelUsesSheenVars = /background-image:[^;]*var\(--we-sidebar-sheen-a/.test(CSS);
  check('S1d 侧栏的釉分两档：跟随态取与左栏同一道（--we-panel-sheen-*），自定义态保留旧曲线；面板声明读新变量',
    sheenFollow && sheenCustom && panelUsesSheenVars,
    'follow=' + sheenFollow + ' custom=' + sheenCustom + ' panel=' + panelUsesSheenVars);

  // ── S2: 玻璃面**自己的外沿发丝线**改为不画 ──────────────────────────────────
  // 现场口径："左侧边栏右边框线不要显示，即使全局设置了边框拉到了90%"。
  // 那条线此前是**刻意补**的（darwin 壳层把原生竖分割线置 none，补回来图个与其余面板口径一致）；
  // 现在这一列已是一整块玻璃，再画一条竖线就把它与会话区切成两半 ⇒ 显式 none。
  // ⚠️ 判据看的是**声明**而不是"有没有那行"：只删声明的话，非 darwin 壳层自己那条读
  // --dsw-alias-border-l3 的边框会在别的平台上回来 —— 所以必须是 none，且不许再跟滑杆联动。
  const leftColRule = rules.find((r) => r.header.includes('div:has(> [data-slot="sidebar"])')
    && declValue(r.body, 'background-color'));
  const leftBorder = leftColRule ? declValue(leftColRule.body, 'border-right') : null;
  /** 判据：这一列的 border-right 是不是"明确不画"。 */
  const hairlineRemoved = (decl) => decl !== null && decl !== undefined && /^none\b/i.test(String(decl).trim());
  check('S2 左侧栏液态玻璃不再画那一列的竖分割线（显式 none，而不是"删掉声明"）',
    hairlineRemoved(leftBorder) && !/--we-border-alpha/.test(String(leftBorder)),
    'border-right=' + String(leftBorder));
  check('S2 负对照：把随「边框」滑杆变浓淡的那条发丝线种回去，同一条判据必须判红',
    hairlineRemoved('0.5px solid rgba(180, 180, 180, var(--we-border-alpha, 0.35))') === false
      && hairlineRemoved(null) === false);
  check('S2b 只去掉外沿：「边框」滑杆对这一列**内部**的描边仍然生效（--dsw-alias-border-l3 映射保留）',
    Boolean(leftColRule) && /--dsw-alias-border-l3:\s*rgba\(180, 180, 180, var\(--we-border-alpha/.test(leftColRule.body),
    leftColRule ? '映射在场' : '取不到左栏规则');

  // ── S2c: 左栏的模糊必须在 ::before 上（issue #131：fixed 包含块）────────────
  // CSS 规范：非 none 的 backdrop-filter 会让元素成为**其后代 position:fixed 元素的
  // 包含块**。宿主在 Windows 标题栏模式下把「收起 / 展开侧边栏」按钮设成 fixed ——
  // 模糊画在列自身上时，按钮改成相对列定位（列被标题栏 padding 推下去 + 收起时
  // overflow:hidden 裁切）⇒ 按钮下移 / 不可见。修法：模糊只留在 ::before（无后代，
  // 永远不会成为任何 fixed 元素的包含块），列自己拿 position:relative + z-index:0。
  // 判据 = 三条声明形态 + 负对照（把模糊种回列自身必须判红）。谓词与主判据同源
  // （先剥注释再找声明）—— 否则「注释里提到 backdrop-filter」会被误判，负对照失去意义。
  // ⚠️ 本块**自足**：左栏规则的取用在本块内自己算一遍（不依赖别处同名 const ——
  //    本块要能独立成立，便于按 issue 拆分提交与单独回归）。
  const s2cLeftColRule = rules.find((r) => r.header.includes('div:has(> [data-slot="sidebar"])')
    && declValue(r.body, 'background-color'));
  const blurDeclaredOn = (body) => /(^|[;\s])backdrop-filter\s*:/.test(String(body).replace(/\/\*[\s\S]*?\*\//g, ''));
  const leftColBlurOnSelf = s2cLeftColRule ? blurDeclaredOn(s2cLeftColRule.body) : null;
  const leftBeforeRule = rules.find((r) => r.header.includes('div:has(> [data-slot="sidebar"])::before'));
  const leftBeforeBlur = leftBeforeRule ? declValue(leftBeforeRule.body, 'backdrop-filter') : null;
  const leftColPosition = s2cLeftColRule ? declValue(s2cLeftColRule.body, 'position') : null;
  const leftColZ = s2cLeftColRule ? declValue(s2cLeftColRule.body, 'z-index') : null;
  check('S2c 左栏的 backdrop-filter 只画在 ::before（fixed 包含块修复，issue #131）',
    leftColBlurOnSelf === false
      && Boolean(leftBeforeRule) && /blur\(/.test(String(leftBeforeBlur))
      && String(leftColPosition).trim() === 'relative' && String(leftColZ).trim() === '0',
    'self-blur=' + leftColBlurOnSelf + ' ::before=' + (leftBeforeRule ? 'present' : 'MISSING')
      + ' position=' + String(leftColPosition) + ' z-index=' + String(leftColZ));
  check('S2c 负对照：把 backdrop-filter 种回列自身，同一条判据必须判红（注释里的提及不算）',
    blurDeclaredOn('background-color: red; backdrop-filter: blur(4px);') === true
      && blurDeclaredOn('background-color: red; /* backdrop-filter: blur(4px); */') === false);
  check('S2c2 软件光栅器回退把 ::before 的模糊也显式关掉（不留不会生效的声明）',
    rules.some((r) => r.header.includes('[data-we-glass-fallback][data-we-glass-page][data-we-left-sidebar]')
      && r.header.includes('::before')
      && /backdrop-filter:\s*none\s*!important/.test(r.body)));

  // ── TB: 标题栏玻璃的锚点与两层结构（2026-10-06 回归）──────────────────────────
  // 三条故障的来龙去脉（死类名锚点 / 嵌套 :has() 让逗号列表**整条**失效 / 底色与模糊同层
  // 导致的色差）**只写在 src/styles.js 的标题栏注释块**，此处不复述 —— 判据只钉结论：
  //   TB1 死锚点 · TB2a/TB2b 两层互斥 · TB3 壳层门 · TB4 六条同色声明 · TB4a 恒定釉光 ·
  //   TB5 禁嵌套 :has() · TB6 不画分割线。各条可独立失败，各自带负对照。
  const deadAnchor = '.dshDesktopFrameTitlebar';
  const tbRules = rules.filter((r) => r.header.includes('[data-we-titlebar-glass]'));
  const tbSelectors = tbRules.flatMap((r) => selectorsOf(r.header));
  const hasDeadAnchor = (list) => list.length > 0 && !list.some((s) => s.includes(deadAnchor));
  check('TB1 标题栏玻璃不再挂在已消失的壳层类名上（该类名在当前 app.asar 命中 0 次）',
    hasDeadAnchor(tbSelectors),
    'tb selectors=' + tbSelectors.length + ' dead-anchor hits=' + tbSelectors.filter((s) => s.includes(deadAnchor)).length);
  check('TB1 负对照：死锚点要被判红、正常选择器要放行（判据有牙）',
    hasDeadAnchor(['html[data-windows-titlebar] body[data-we-titlebar-glass] ' + deadAnchor]) === false
      && hasDeadAnchor(['html[data-windows-titlebar] div[class*="pI_x6G_frame"]']) === true);
  const tbLightRule = tbRules.find((r) => r.header.includes('::before')
    && !r.header.includes('data-ds-dark-theme') && !r.header.includes('glass-fallback')
    && /background-color\s*:/.test(r.body)); // 排除 @supports not 里那两条 background 简写
  const tbAfterRule = tbRules.find((r) => r.header.includes('::after')
    && /blur\(/.test(String(r.body)) && !r.header.includes('glass-fallback'));
  const tbBeforeBlur = tbLightRule ? declValue(tbLightRule.body, 'backdrop-filter') : null;
  check('TB2a 底色在 ::before 且该层不带 backdrop-filter（同层 ⇒ 底色不过滤镜 ⇒ 与左栏色差）',
    Boolean(tbLightRule) && Boolean(declValue(tbLightRule.body, 'background-color'))
      && !/blur\(/.test(String(tbBeforeBlur)),
    'bg=' + String(tbLightRule ? declValue(tbLightRule.body, 'background-color') : 'MISSING').slice(0, 34)
      + ' · ::before-blur=' + String(tbBeforeBlur));
  check('TB2b 模糊在 ::after，几何与壳层 ::before 对齐（inset:0 0 auto + 标题栏高度），且不挡交互',
    Boolean(tbAfterRule)
      && /blur\(/.test(String(declValue(tbAfterRule.body, 'backdrop-filter')))
      && /absolute/.test(String(declValue(tbAfterRule.body, 'position')))
      && /0 0 auto/.test(String(declValue(tbAfterRule.body, 'inset')))
      && /dsh-windows-titlebar-height/.test(String(declValue(tbAfterRule.body, 'height')))
      && /pointer-events:\s*none/.test(String(tbAfterRule.body))
      && /:\s*""/.test(String(tbAfterRule.body)),
    'rule=' + (tbAfterRule ? 'present' : 'MISSING')
      + ' pos=' + String(tbAfterRule && declValue(tbAfterRule.body, 'position'))
      + ' inset=' + String(tbAfterRule && declValue(tbAfterRule.body, 'inset'))
      + ' h=' + String(tbAfterRule && declValue(tbAfterRule.body, 'height')).trim()
      + ' pe=' + String(tbAfterRule && declValue(tbAfterRule.body, 'pointer-events')).trim());
  // TB2c 的谓词必须与 TB2a **同一个**（拿真规则喂它），否则负对照只是在数正则：老写法
  // `/blur\(/.test('backdrop-filter: blur(15px);')` 拿字面量测字面量 ⇒ 恒真，等于没测。
  const tbBeforeHasBlur = (body) => /blur\(/.test(String(declValue(body, 'backdrop-filter')));
  const tbBeforeMutated = tbLightRule ? tbLightRule.body + ';backdrop-filter: blur(var(--we-titlebar-blur));' : '';
  check('TB2c 负对照：把模糊种回 ::before（两层合一），TB2a 的谓词必须判红',
    Boolean(tbLightRule) && tbBeforeHasBlur(tbBeforeMutated) === true
      && tbBeforeHasBlur(tbLightRule.body) === false
      && tbBeforeHasBlur('background-color: color-mix(in srgb, #fff 10%, transparent);') === false,
    'tb2a-predicate(真规则)=' + (tbLightRule ? tbBeforeHasBlur(tbLightRule.body) : 'MISSING')
      + ' · 变异后=' + (tbLightRule ? tbBeforeHasBlur(tbBeforeMutated) : 'MISSING'));
  check('TB3 顶栏选择器带壳层锚 html[data-windows-titlebar]（普通 Web 文档永远拿不到）',
    tbSelectors.length > 0 && tbSelectors.every((s) => s.includes('html[data-windows-titlebar]'))
      && tbSelectors.every((s) => !/\[[\w-]*collapsed[\w-]*\]/.test(s)),
    'every selector gated=' + tbSelectors.every((s) => s.includes('html[data-windows-titlebar]'))
      + ' no-conditional-attr=' + tbSelectors.every((s) => !/\[[\w-]*collapsed[\w-]*\]/.test(s)));
  // 「不要有任何色差」是这块的第一约束 ⇒ 只比**决定颜色的**声明：底色 + 五条 accent 映射。
  // ⚠️ background-image **刻意不在清单里**：釉光停靠点是百分比，装进高度差 27.8 倍的两个
  //    盒子会算出不同值（算术见 src/styles.js 的 ::before 注释）—— 对**盒子相对**的声明，
  //    "逐字相同 ⇒ 无色差"不成立。故它由 TB4a 单独钉。position/z-index、分层的模糊同理。
  const COLOR_DECLS = ['background-color',
    '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-accent',
    '--dsw-alias-state-business-primary', '--dsw-alias-brand-primary', '--dsw-alias-brand-text'];
  // 只允许面变量改名（--we-titlebar-alpha ⇄ --we-left-sidebar-alpha）与 !important 权重差异。
  const tbNorm = (s) => String(s).replace(/--we-titlebar-alpha/g, 'ALPHA')
    .replace(/--we-left-sidebar-alpha/g, 'ALPHA').replace(/\s*!important/g, '')
    .replace(/\s+/g, ' ').trim();
  // 判据本体：两条声明值同形（归一后逐字相等）。阳性判据与负对照**共用**它 —— 老写法
  // 只拿 tbNorm 比两个自造字面量（拿归一器测字面量），判据本体根本没被喂过。
  const sameDecl = (a, b) => tbNorm(a) === tbNorm(b);
  // 真判据：取两份**规则体**，逐条经 declValue 读出声明值，返回不同形的清单（空 = 同形）。
  const tbDiffs = (bodyA, bodyB) => COLOR_DECLS
    .map((k) => [k, declValue(bodyA, k), declValue(bodyB, k)])
    .filter(([, a, b]) => !sameDecl(a, b));
  const tbLeftBody = s2cLeftColRule ? s2cLeftColRule.body : '';
  const tbLightBody = tbLightRule ? tbLightRule.body : '';
  const tbRealDiffs = tbDiffs(tbLeftBody, tbLightBody);
  check('TB4 顶栏与左栏**逐条同形**（决定颜色的六条声明逐字相等 ⇒ 不可能有色差）',
    Boolean(tbLightRule) && Boolean(s2cLeftColRule) && tbRealDiffs.length === 0,
    tbRealDiffs.length ? tbRealDiffs.map(([k, a, b]) => k + ': ' + tbNorm(a) + ' ≠ ' + tbNorm(b)).join(' | ')
      : (COLOR_DECLS.length + ' colour declarations identical'));
  // 负对照：拿**真规则体**把一条声明的字面量改掉，把变异体喂回同一条判据 ⇒ 必须判红。
  const tbMutantKey = COLOR_DECLS.find((k) => declValue(tbLightBody, k) !== null);
  const tbMutantBody = tbMutantKey
    ? tbLightBody.replace(new RegExp('(^|[\\s;{])' + tbMutantKey + ':\\s*[^;}]+', 'i'),
      '$1' + tbMutantKey + ': rgb(1, 2, 3)')
    : '';
  const tbMutantDiffs = tbDiffs(tbLeftBody, tbMutantBody);
  check('TB4 负对照：给顶栏真规则改一个字面量，同一条判据必须判红',
    Boolean(tbMutantKey) && Boolean(tbLightRule) && tbMutantBody !== tbLightBody
      && tbMutantDiffs.length > 0,
    'mutated ' + String(tbMutantKey) + ' ⇒ diffs='
      + (tbMutantDiffs.length
        ? tbMutantDiffs.map(([k, a, b]) => k + ': ' + tbNorm(a) + ' ≠ ' + tbNorm(b)).join(' | ')
        : 'none'));
  // ── TB4a: 釉光必须**恒定** sheen-a —— TB4 测不出这条（它比声明文本，三段渐变两面
  //   逐字相同却算出不同颜色）。理由与算术见 src/styles.js 的 ::before 注释。
  const tbSheen = tbLightRule ? String(declValue(tbLightRule.body, 'background-image') || '') : '';
  const sheenIsConstant = (s) => ((String(s).match(/rgba\(/g) || []).length === 2)
    && /sheen-a/.test(s) && !/sheen-b/.test(s) && !/sheen-c/.test(s);
  check('TB4a 标题栏釉光是恒定 sheen-a（百分比停靠点在 40px 与 1111px 两个盒子上算出不同值）',
    Boolean(tbLightRule) && sheenIsConstant(tbSheen),
    'decl=' + tbSheen.replace(/\s+/g, ' ').slice(0, 88) || '(MISSING)');
  check('TB4a 负对照：三段渐变要被判红（判据有牙）',
    sheenIsConstant('linear-gradient(180deg, rgba(255,255,255,var(--we-panel-sheen-a)) 0%,'
      + ' rgba(255,255,255,var(--we-panel-sheen-b)) 38%, rgba(255,255,255,var(--we-panel-sheen-c)) 100%)') === false);
  // ── TB4b: 恒定釉光**暗档也要有** —— 2026-10-06 漏网：暗档照抄左栏那条三段渐变，而 TB4a
  //    早先的 tbLightRule 显式排除 data-ds-dark-theme ⇒ 那条恰好是 TB4a 定义的失败形态，
  //    却不在被测集合里（深色主题是日常默认档，这个空白比浅色那条更该钉）。理由与算术同 TB4a。
  const tbDarkRule = tbRules.find((r) => r.header.includes('::before')
    && r.header.includes('data-ds-dark-theme') && !r.header.includes('glass-fallback')
    && /background-color\s*:/.test(r.body));
  const tbDarkSheen = tbDarkRule ? String(declValue(tbDarkRule.body, 'background-image') || '') : '';
  check('TB4b 深色标题栏的釉光同样是恒定 sheen-a（暗档不得照抄左栏那条三段渐变）',
    Boolean(tbDarkRule) && sheenIsConstant(tbDarkSheen),
    'dark-rule=' + (tbDarkRule ? 'present' : 'MISSING')
      + ' decl=' + (tbDarkSheen.replace(/\s+/g, ' ').slice(0, 88) || '(MISSING)'));
  check('TB4b 负对照：暗档写成三段渐变必须判红，且亮/暗两条釉光声明必须同源',
    sheenIsConstant('linear-gradient(180deg, rgba(255,255,255,var(--we-panel-sheen-a)) 0%,'
      + ' rgba(255,255,255,var(--we-panel-sheen-b)) 38%, rgba(255,255,255,var(--we-panel-sheen-c)) 100%)') === false
      && Boolean(tbLightRule) && Boolean(tbDarkRule)
      && String(declValue(tbDarkRule.body, 'background-image')).replace(/\s+/g, ' ').trim()
        === String(declValue(tbLightRule.body, 'background-image')).replace(/\s+/g, ' ').trim(),
    'light=' + (tbSheen.replace(/\s+/g, ' ').slice(0, 52) || '(MISSING)')
      + ' · dark=' + (tbDarkSheen.replace(/\s+/g, ' ').slice(0, 52) || '(MISSING)'));
  // ── TB4d: 暗档也要有 TB4 —— 2026-10-06 缺口：TB4 只比了**浅档**顶栏与浅档左栏，
  //    TB4b 只管釉光（background-image），暗档的底色与 accent 映射一度无人钉。
  // 暗档与浅档**有意不同**的地方只有两处（此处归一掉、算"同形"，不是放过）：
  //   ① 面底色 --we-surface-tint-light ⇄ -dark
  //   ② 两条 accent 映射的"透明"基底 transparent ⇄ rgba(255,255,255,0.04)
  // 清单里**不含** background-image（釉光停靠点是盒子相对的声明，由 TB4a/TB4b 单独钉）。
  // ⚠️ 另外三条 accent（state-business-primary / brand-primary / brand-text）在**暗档
  //    两边都不重映射**（落回宿主）——"都没写"也要计入六条清单的比对：将来只给暗档顶栏
  //    补上其中一条就会与暗档左栏产生色差，本判据立刻抓到。
  const s2cLeftColDarkRule = rules.find((r) => r.header.includes('div:has(> [data-slot="sidebar"])')
    && r.header.includes('data-ds-dark-theme') && declValue(r.body, 'background-color'));
  const tbDarkColorDecls = COLOR_DECLS.filter((k) => k !== 'background-image');
  const tbDarkNorm = (s) => tbNorm(s)
    .replace(/--we-surface-tint-light/g, 'TINT').replace(/--we-surface-tint-dark/g, 'TINT')
    .replace(/rgba\(255,\s*255,\s*255,\s*0?\.04\)/g, 'INK');
  // 差异清单的**唯一**算法：给两条声明体，返回不一致的键。主判据与负对照共用它
  // （负对照不再另写一套比较 —— 那就成了"用另一条判据证明这条判据有牙"）。
  const darkDiffsOf = (leftBody, tbBody) => tbDarkColorDecls
    .map((k) => [k, tbDarkNorm(declValue(leftBody, k)), tbDarkNorm(declValue(tbBody, k))])
    .filter(([, a, b]) => a !== b);
  const tbDarkDiffs = darkDiffsOf(s2cLeftColDarkRule && s2cLeftColDarkRule.body,
    tbDarkRule && tbDarkRule.body);
  check('TB4d 暗档顶栏与暗档左栏**逐条同形**（底色 + accent 映射；TB4 只覆盖浅档）',
    Boolean(tbDarkRule) && Boolean(s2cLeftColDarkRule) && tbDarkDiffs.length === 0,
    'dark left-col rule=' + (s2cLeftColDarkRule ? 'present' : 'MISSING')
      + ' dark tb rule=' + (tbDarkRule ? 'present' : 'MISSING')
      + ' · ' + (tbDarkDiffs.length
        ? tbDarkDiffs.map(([k, a, b]) => k + ': ' + a + ' ≠ ' + b).join(' | ')
        : (tbDarkColorDecls.length + ' colour declarations identical')));
  check('TB4d 负对照：只给暗档顶栏补一条 accent 映射、左栏留空，清单比对必须报差异',
    darkDiffsOf('', '--dsw-alias-brand-primary: var(--we-accent, #4f8cff);').length === 1
      && darkDiffsOf('--dsw-alias-brand-primary: var(--we-accent, #abc);',
        '--dsw-alias-brand-primary: var(--we-accent, #4f8cff);').length === 1);
  // ── TB6: 顶栏**不得**画分割线 —— 与左栏 S2 同一条政策（那条线本身就是色差，理由见 styles.js）。
  const tbBorder = tbLightRule ? String(declValue(tbLightRule.body, 'border-bottom') || '') : '';
  const tbHasBorder = (v) => /solid|rgb|hsl|color\(/.test(String(v || ''));
  check('TB6 顶栏不画底分割线（左栏按 S2 已显式不画竖线，画了就是色差）',
    Boolean(tbLightRule) && !tbHasBorder(tbBorder),
    'border-bottom=' + (tbBorder ? tbBorder.slice(0, 60) : '(absent)'));
  check('TB6 负对照：发丝线要被判红（判据有牙）',
    tbHasBorder('border-bottom: 1px solid rgba(180, 180, 180, 0.6)') === true);

  // ── TB5: 禁止**嵌套** :has()，且标题栏每条规则只许一个元素锚（2026-10-06 回归）──
  // 这次故障**完全隐形**：文本在、结构对、静态正则也匹配，但壳层 Chromium 拒绝嵌套
  // :has() ⇒ 逗号列表整条丢弃 ⇒ 与"锚点没选对"现象同形。测试环境没有壳层的 Chromium，
  // 无法直接验引擎接受度，所以退而钉住**已知会被它拒绝的写法**。完整经过见 styles.js。
  const isNestedHas = (s) => /:has\([^)]*:has\(/.test(s);
  const nestedHas = [];
  const multiAlt = [];
  for (const r of rules) {
    if (!r.header.includes('data-we-titlebar-glass')) continue;
    for (const sel of selectorsOf(r.header)) {
      if (isNestedHas(sel)) nestedHas.push(sel.replace(/\s+/g, ' ').slice(0, 90));
    }
    const alts = selectorsOf(r.header).filter((s) => s.includes('::before'));
    if (alts.length > 1) multiAlt.push(alts.length + ' 个元素锚：' + alts.map((s) => s.slice(-46)).join(' , '));
  }
  check('TB5 标题栏不得用嵌套 :has()（本壳层 Chromium 拒绝 ⇒ 逗号列表一损俱损 ⇒ 整条规则静默失效）',
    nestedHas.length === 0,
    nestedHas.length ? nestedHas.length + ' 处：' + nestedHas.join(' | ') : '0 处');
  check('TB5 标题栏每条规则只许一个元素锚（要并存必须拆成两条独立规则，不得逗号相连）',
    multiAlt.length === 0,
    multiAlt.length ? multiAlt.join(' ; ') : 'rules=' + tbRules.length + ' 全部单锚');
  check('TB5 负对照：嵌套写法要被判红、单层写法要放行（判据有牙）',
    isNestedHas('div:has(> div:has(> [data-slot="sidebar"]))') === true
      && isNestedHas('div:has(> [data-slot="sidebar"])') === false);

  // ── S3: accent 重映射的两条不变量（issue #127）──────────────────────────────
  // ① 整窗规则里的填充重映射必须配「墨随 accent 亮度」：--dsw-alias-label-primary-foreground
  //    接 --we-accent-ink（宿主 primary 契约 = 填充 × 反色墨成对翻转；任意亮度的用户配色
  //    会让主题静态墨失去可读性 —— 黄底白字 ≈ 1.5:1）。
  // ② 第三方 settings 分区不得看到 --we-accent（拿它当文字色 × 我们重映射的 accent 填充
  //    = 逐像素同色）：整窗规则把它掐成 initial，块内消费改读 --we-accent-src，
  //    我们自己的 .we-picker 根再从 src 重新别名。
  const dialogRule = rules.find((r) => r.header.includes('[data-we-glass-window]')
    && r.header.includes('[role="dialog"]')
    && declValue(r.body, '--dsw-alias-button-primary-fill'));
  const dialogFg = dialogRule ? declValue(dialogRule.body, '--dsw-alias-label-primary-foreground') : null;
  const dialogAccent = dialogRule ? declValue(dialogRule.body, '--we-accent') : null;
  const dialogFill = dialogRule ? declValue(dialogRule.body, '--dsw-alias-button-primary-fill') : null;
  const dialogHover = dialogRule ? declValue(dialogRule.body, '--dsw-alias-button-primary-hover') : null;
  const pickerRule = rules.find((r) => r.selectors.some((s) => s.trim() === '.we-picker'));
  const pickerAlias = pickerRule ? declValue(pickerRule.body, '--we-accent') : null;
  const primaryBtnRule = rules.find((r) => r.selectors.some((s) => s.trim() === '.we-picker__btn--primary'));
  const primaryBtnColor = primaryBtnRule ? declValue(primaryBtnRule.body, 'color') : null;
  check('S3 整窗填充重映射配「墨随 accent」：label-primary-foreground 接 --we-accent-ink（#127）',
    Boolean(dialogRule) && /var\(--we-accent-ink/.test(String(dialogFg))
      && /var\(--we-accent-ink/.test(String(dialogHover)),
    'fg=' + String(dialogFg) + ' hover=' + String(dialogHover));
  check('S3 整窗掐掉 --we-accent 名字空间泄漏；块内消费读 --we-accent-src（同块 initial 会塌兜底蓝）',
    String(dialogAccent).trim().toLowerCase() === 'initial'
      && !/var\(--we-accent[,)]/.test(String(dialogFill))
      && /var\(--we-accent-src/.test(String(dialogFill)));
  check('S3 我们自己的 picker 从 --we-accent-src 重新别名（自家消费面不变）',
    /var\(--we-accent-src/.test(String(pickerAlias)), 'alias=' + String(pickerAlias));
  // 判据：自绘实色主按钮的墨必须随 accent —— 写死 #fff 会在任意亮度的用户配色上失去对比。
  // 阳性（真规则）与负对照（把墨改写成 #fff 的变异体）**共用**它。
  const btnInkFollowsAccent = (raw) => /var\(--we-accent-ink/.test(String(raw))
    && !/^#fff/i.test(String(raw).trim());
  const primaryBtnBody = primaryBtnRule ? primaryBtnRule.body : '';
  const primaryBtnMutated = primaryBtnBody.replace(/(^|[\s;{])color:\s*[^;}]+/i, '$1color: #fff');
  check('S3 负对照：自绘实色主按钮的墨也随 accent（不许写死 #fff）；变异体写成 #fff 必须判红',
    btnInkFollowsAccent(primaryBtnColor) === true
      && Boolean(primaryBtnRule) && primaryBtnMutated !== primaryBtnBody
      && btnInkFollowsAccent(declValue(primaryBtnMutated, 'color')) === false,
    'color=' + String(primaryBtnColor)
      + ' · 变异体=' + String(declValue(primaryBtnMutated, 'color')));

  // ── D1: Task-1 contract — saturation is decoupled from the blur slider ───
  const satTernary = SRC.match(
    /setProperty\("--we-saturate",\s*useLegacySaturateCoupling\(\)\s*\?\s*String\(1\.15 \+ selection\.blur \* 0\.028\)\s*:\s*String\(GLASS_SATURATE\)\)/);
  const satConst = Number((SRC.match(/const GLASS_SATURATE = ([\d.]+);/) || [])[1]);
  const satFallback = Number((CSS.match(/saturate\(var\(--we-saturate,\s*([\d.]+)\)\)/) || [])[1]);
  check('D1 --we-saturate is a CONSTANT in the default path (the 玻璃 slider drives frost depth only) and ?we-saturate=legacy still restores the old coupled ramp',
    !!satTernary && satConst >= 1.25 && satConst <= 1.4 && satConst < satFallback,
    'GLASS_SATURATE=' + (Number.isFinite(satConst) ? satConst : 'MISSING')
      + ' · stylesheet fallback=' + (Number.isFinite(satFallback) ? satFallback : 'MISSING')
      + ' · legacy branch (1.15 + blur*0.028) preserved=' + !!satTernary
      + ' · old ramp 0/15/30/45/60px = 1.15/1.57/1.99/2.41/2.83, new = constant');

  // ── G8: 浅/深两主题的 alias 接管集合必须逐 token 同形 ─────────────────────────
  // 全表面玻璃的映射分「浅色块 + 深色块」两处声明（深色要更高特异性才能压过宿主
  // body[data-ds-dark-theme] 的后置同权重规则），两边各漏一条 = 某个主题下该面
  // **悄悄回到宿主实色** —— 第二批收编代码块家族时正是漏了深色档（深色模式下
  // 代码块整块黑底，现场截图复现）。判据对**页面玻璃块**（data-we-glass-page，含
  // left-sidebar 变体）的浅/深两侧各求并集再比集合，不依赖块与块的书写配对。
  // ⚠️ 扫描面钉在 data-we-glass-page 上：它才是"整页玻璃接管"的锚点（data-we-wallpaper
  //    只管"页面让开、露出壁纸层"，那两块里已经没有 alias 映射了 —— 扫错属性会让本条
  //    静默退化成空集对空集，所以下面另配**覆盖面地板**）。
  const aliasTokens = (wantDark) => {
    const set = new Set();
    let from = 0;
    for (;;) {
      const at = CSS.indexOf('data-we-glass-page', from);
      if (at < 0) break;
      from = at + 1;
      const open = CSS.indexOf('{', at);
      if (open < 0) break;
      // ⚠️ 取"这条规则的块头" = 上一个 { 或 } 之后到本 { 之前。**必须从 open - 1 往左找**：
      //    lastIndexOf('{', open) 会先命中 open 自己 ⇒ 块头恒为空串 ⇒ 判据静默空转
      //    （这条断言此前就是这样"绿"的；新增的覆盖面地板把它抓了出来）。
      const headerFrom = Math.max(CSS.lastIndexOf('}', open - 1), CSS.lastIndexOf('{', open - 1)) + 1;
      const header = CSS.slice(headerFrom, open);
      if (!header.includes('data-we-glass-page')) continue; // 归属上一条规则的正文片段
      // 只认 **body 级整表块**（每个逗号分支都是 body[attr]… 的形态）。逐面作用域的块
      // （left-sidebar / thinking-glass / chat-flow …）里同样有 --dsw-alias-* 改写，但
      // 它们的浅深不对称是**有意**的（只覆盖需要改的那些，其余继承浅色块）—— 混进来
      // 会把"映射表必须是浅深双份"这条判据变成假红。
      const parts = header.split(',').map((p) => p.trim()).filter(Boolean);
      const bodyLevel = parts.length > 0 && parts.every((p) => /^body(\[[^\]]*\])+$/.test(p));
      if (!bodyLevel) continue;
      const hasDark = parts.some((p) => p.includes('data-ds-dark-theme'));
      const hasLight = parts.some((p) => !p.includes('data-ds-dark-theme'));
      if (wantDark ? !hasDark : !hasLight) continue;
      let depth = 0, end = -1;
      for (let i = open; i < CSS.length; i++) {
        if (CSS[i] === '{') depth++;
        else if (CSS[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) break;
      for (const t of CSS.slice(open + 1, end).matchAll(/--dsw-alias-[a-z0-9-]+/g)) set.add(t[0]);
      from = end;
    }
    return set;
  };
  const lightOnly = [...aliasTokens(false)].filter((t) => !aliasTokens(true).has(t));
  const darkOnly = [...aliasTokens(true)].filter((t) => !aliasTokens(false).has(t));
  // 覆盖面地板（实测浅 20 / 深 26；地板取 12）：防"扫描属性写错 ⇒ 两个空集相等 ⇒ 假绿"。
  const aliasFloor = Math.min(aliasTokens(false).size, aliasTokens(true).size);
  check('G8 alias takeover sets match across light/dark page-glass blocks (the missed-dark-twin class of drift)',
    lightOnly.length === 0 && darkOnly.length === 0 && aliasFloor >= 12,
    'lightOnly=' + JSON.stringify(lightOnly) + ' · darkOnly=' + JSON.stringify(darkOnly)
      + ' · light=' + aliasTokens(false).size + ' dark=' + aliasTokens(true).size + ' (floor 12)');

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0
    ? 'ALL GLASS COMPOSITING CHECKS PASSED'
    : failed.length + ' CHECK(S) FAILED'));
  process.exit(failed.length === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error('TEST ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
}
