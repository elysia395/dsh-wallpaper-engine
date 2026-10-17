#!/usr/bin/env node
/**
 * token-contract.mjs — `--dsw-*` 令牌契约的**生成与核对**（共存审计 S2 的核心）。
 *
 * 为什么需要它（COEXISTENCE-AUDIT §一 M1）：本插件把宿主的设计令牌层
 * （`--dsw-alias-*` 等 46 个 token）整层改写成玻璃配方，而 DSH 官方给插件作者的
 * 规范就是「用 `--dsw-alias-*` 上色」⇒ **任何按规范写的第三方 UI 插件都会自动
 * 继承我们的玻璃** —— 这是全仓最大的隐式耦合面，但今天没有任何一份文件列出
 * 「我们到底改写了哪些 token、在哪个门控下」。手写清单一定会烂，所以本工具从
 * **样式族**（`src/styles-base.js` … `src/styles-ext.js`，刀3 由单一
 * `src/styles.js` 按视觉域拆出）的 CSS 模板**现算**出契约，`test/verify-token-contract.mjs`
 * 重算并逐字节比对 `docs/TOKEN-CONTRACT.md`。
 *
 * 解析口径（与审计复算脚本同形，两处必须守住）：
 *   ① **只计真实声明**：`--dsw-x: v;` 出现在属性位才算；值里的 `var(--dsw-…)`
 *      是**读**不是写，一律排除（否则 284 处引用会淹掉 135 条声明）。
 *   ② **花括号栈定门控**：每条声明按其选择器链归桶 ——
 *      链上有 `[data-we-glass-*]` ⇒ 玻璃；只有 `[data-we-wallpaper]` ⇒ 壁纸；
 *      两者都不挂 ⇒ **无门控**（M1 的全部暴露面，审计量化为 19 条，全部落在
 *      `body[data-we-thinking-native]`（思考块自带开关）与 `.we-layer`（插件自有
 *      元素）两处 —— 守卫把这份白名单钉死，**新增任何一条无门控改写即红**）。
 *
 * 用法：
 *   node test/tools/token-contract.mjs            # 打印契约（守卫用它比对）
 *   node test/tools/token-contract.mjs --write    # 写入 docs/TOKEN-CONTRACT.md
 *   node test/tools/token-contract.mjs --stats    # 只打印聚合数（对审计口径）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeFiles } from './src-scope.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = join(ROOT, 'docs', 'TOKEN-CONTRACT.md');
/** 样式族：8 个域模块 + 组装点，顺序 = 构建期内联顺序（INLINE_MODULES 单一真源）。 */
const STYLE_FAMILY = scopeFiles('src/styles');

/**
 * 抽出某个**样式域模板**的模板体（`const CSS` 或 `const CSS_<域> = \`…\``）。模板里没有
 * 转义反引号（内容若含 `"` 会被当字符串处理，见下面 scan 的引号跟踪），`${…}` 插值只有
 * 两个只读下限常量且落在 `--we-*` 令牌的值位 —— 扫描前统一替换成字面量，避免 `}` 混进花括号栈。
 */
export function extractCss(src) {
  const open = /const CSS(?:_[A-Z][A-Z0-9_]*)? = `/.exec(src);
  if (!open) throw new Error('styles: 找不到样式域模板声明（const CSS[_域]）');
  const start = open.index + open[0].length;
  let i = start;
  for (; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '`') break;
  }
  if (i >= src.length) throw new Error('styles: CSS 模板没有闭合反引号');
  const raw = src.slice(start, i).replace(/\$\{[^{}]*\}/g, '0');
  // 起始行号：模板开在声明那一行；raw[0] 多半是它的换行符。
  const baseLine = src.slice(0, start).split('\n').length;
  return { raw, baseLine };
}

/**
 * 遍历样式族：把各域模板按构建序**拼成一份**（= 拆段前的单模板，逐字节等价）后扫一遍，
 * 再按每段的偏移把行号映射回来源文件 —— 声明上是 `{ file, line }`（line = 该文件内的真实行号）。
 *
 * 为什么不能逐文件各扫一遍：切段边界按"视觉域分区注释"划，**允许落在 @media / 规则块内部**，
 * 于是单个域模块的 CSS 花括号常常自己不配平（实测 `scanTokenDecls` 逐文件扫会抛
 * `styles.js: 花括号栈没有归零（CSS 结构异常）`）。花括号配平是**整张样式表**的性质，
 * 拼接后扫才是拆段前的原有口径。
 */
export function scanStyleFamily() {
  const parts = [];
  let concat = '';
  for (const rel of STYLE_FAMILY) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    if (!/const CSS(?:_[A-Z][A-Z0-9_]*)? = `/.test(src)) continue;
    const { raw, baseLine } = extractCss(src);
    const startRawLine = concat.split('\n').length;   // 本段首行在拼接体里的行号（1 基）
    parts.push({ file: rel, baseLine, startRawLine, lines: raw.split('\n').length });
    concat += raw;
  }
  if (parts.length === 0) throw new Error('styles: 样式族里一个域模板都没取到（锚点漂了？）');
  const decls = [];
  for (const d of scanTokenDecls('const CSS = `' + concat + '`;')) {
    const part = parts.find((p) => d.line >= p.startRawLine && d.line < p.startRawLine + p.lines);
    if (!part) throw new Error('styles: 行号 ' + d.line + ' 映射不到任何域模块（拼接口径漂了）');
    decls.push({ ...d, file: part.file, line: part.baseLine + (d.line - part.startRawLine) });
  }
  return decls;
}

/** 剥 `/* … *\/` 注释，等长替换（保换行 ⇒ 行号不漂移）。未配对的注释标记直接抛。 */
function stripCssComments(css) {
  const out = css.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '));
  if (/\/\*/.test(out) || /\*\//.test(out)) {
    throw new Error('styles: 注释标记未配对（或注释体里有字面 `*/` 提前闭合）');
  }
  return out;
}

/**
 * 花括号栈扫描：返回全部 `--dsw-*` **属性位**声明。
 * 每条：{ token, value, line, chain }，chain = 选择器链（含 @media 前提）。
 */
export function scanTokenDecls(src) {
  const { raw, baseLine } = extractCss(src);
  const clean = stripCssComments(raw);
  const decls = [];
  const stack = [];            // { selector, line } — 块的开括号行 = 选择器起始行
  let buf = '';
  let line = baseLine;
  let bufLine = baseLine;      // 当前 buf 首个非空白字符所在行
  let paren = 0;
  let quote = null;
  let declStartLine = 0;

  const flushDecl = () => {
    const t = buf.trim();
    if (t) {
      const m = /^(--[A-Za-z0-9-]+)\s*:([\s\S]*)$/.exec(t);
      if (m && m[1].startsWith('--dsw-')) {
        decls.push({
          token: m[1],
          value: m[2].replace(/\s+/g, ' ').trim().replace(/;$/, ''),
          line: declStartLine || bufLine,
          chain: stack.map((s) => s.selector.replace(/\s+/g, ' ')).join(' > '),
        });
      }
    }
    buf = '';
    declStartLine = 0;
  };

  for (let k = 0; k < clean.length; k++) {
    const ch = clean[k];
    if (ch === '\n') { line++; buf += ch; continue; }
    if (quote) {
      if (ch === '\\' && k + 1 < clean.length) { buf += ch + clean[++k]; continue; }
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (!buf.trim()) declStartLine = line;
      quote = ch; buf += ch;
      continue;
    }
    if (ch === '(') { paren++; buf += ch; continue; }
    if (ch === ')') { paren = Math.max(0, paren - 1); buf += ch; continue; }
    if (ch === '{') {
      const sel = buf.trim();
      if (sel) stack.push({ selector: sel, line: bufLine || line });
      buf = ''; bufLine = 0; paren = 0; declStartLine = 0;
      continue;
    }
    if (ch === '}') {
      flushDecl();
      stack.pop();
      buf = ''; bufLine = 0; paren = 0;
      continue;
    }
    if (ch === ';' && paren === 0) { flushDecl(); bufLine = 0; continue; }
    if (!buf.trim() && !/\s/.test(ch)) declStartLine = declStartLine || line;
    if (!buf.trim() && !/\s/.test(ch)) bufLine = bufLine || line;
    buf += ch;
  }
  if (buf.trim()) flushDecl(); // 模板收尾时未闭合的最后一条
  if (stack.length) throw new Error('styles: 花括号栈没有归零（CSS 结构异常）');
  return decls;
}

/** 归桶：glass（链上有 [data-we-glass-*]）> wallpaper（只有 [data-we-wallpaper]）> ungated。 */
export function bucketOf(chain) {
  if (/\[data-we-glass-/.test(chain)) return 'glass';
  if (/\[data-we-wallpaper\]/.test(chain)) return 'wallpaper';
  return 'ungated';
}

/** 无门控声明的**封闭白名单**：只有思考块自己的开关与插件自有元素两处（审计 §三.3）。 */
export function ungatedReason(chain) {
  if (/\[data-we-thinking-native\]/.test(chain)) return 'thinking-native（思考块自带开关）';
  if (chain === '.we-layer') return '.we-layer（插件自有元素，卸载即消失）';
  return null; // 不在白名单 ⇒ 守卫红
}

/** 人工消费者注记：高危别名的宿主消费面（依据 styles.js 注释 + DSH-UI-INTERFACES §3.4）。 */
const NOTES = {
  '--dsw-alias-bg-layer-1': '面板层次 1（宿主对话框/侧栏底）；better-sidebar 亦按它上色',
  '--dsw-alias-bg-layer-2': '面板层次 2',
  '--dsw-alias-bg-layer-3': '面板层次 3',
  '--dsw-alias-button-elevated-fill': '抬高按钮实色（侧栏「新建会话」等）',
  '--dsw-alias-bg-overlay': '弹层/浮出层底（issue #71 全表面玻璃）',
  '--dsw-alias-bg-base': '页面基底 —— 壁纸可见性的关键前提（transparent）',
  '--dsw-specific-sidebar-fill': '侧栏填充（宿主 Mica/深色主题各有一份）',
  '--dsw-alias-markdown-code-block': 'markdown 代码块底',
  '--dsw-alias-markdown-code-block-banner': 'markdown 代码条幅底',
  '--dsw-alias-markdown-inline-code': '行内代码底',
  '--dsw-alias-markdown-tag': 'markdown 标签底',
  '--dsw-alias-markdown-code-segment-unselected': '代码卡分段（未选中）',
  '--dsw-alias-markdown-code-segment-selected': '代码卡分段（选中）',
  '--dsw-alias-border-l1': '边框强调 L1（「边框」滑条）',
  '--dsw-alias-border-l2': '边框强调 L2',
  '--dsw-alias-border-l2-darkmode-thin': '深色细边框',
  '--dsw-alias-label-primary': '正文灰阶（壁纸激活时压暗提对比）',
  '--dsw-alias-label-secondary': '次要文字灰阶',
};

const BUCKET_LABEL = { glass: '玻璃', wallpaper: '壁纸', ungated: '无门控' };

/** 生成契约全文（守卫逐字节比对的就是它）。 */
export function buildContract() {
  const decls = scanStyleFamily();

  const buckets = { glass: [], wallpaper: [], ungated: [] };
  for (const d of decls) { d.bucket = bucketOf(d.chain); buckets[d.bucket].push(d); }

  // 按 token 归并：{ token, decls, buckets:Set, lines[] }
  const byToken = new Map();
  for (const d of decls) {
    let e = byToken.get(d.token);
    if (!e) { e = { token: d.token, decls: [], buckets: new Set(), lines: [] }; byToken.set(d.token, e); }
    e.decls.push(d); e.buckets.add(d.bucket); e.lines.push(d.file + ':' + d.line);
  }
  const tokens = [...byToken.values()].sort((a, b) => a.token.localeCompare(b.token));
  // `t.decls` 是**声明对象**数组（每个对象自带 `.bucket`）。旧版写成 `[...set].filter(x => x === b)`
  // 拿对象比桶名字符串 ⇒ 恒为 0，而且这个 0 被 verify-token-contract 的逐字节比对永久冻住
  //（产物里 46 玻璃(0) / 10 无门控(0) / 8 壁纸(0)，见 §11 A1-3）。
  const cnt = (declList, b) => declList.filter((x) => x.bucket === b).length;

  const L = [];
  L.push('# `--dsw-*` 令牌契约（自动生成，勿手改）');
  L.push('');
  L.push('> 生成：`node test/tools/token-contract.mjs --write`；核对：`node test/verify-token-contract.mjs`');
  L.push('> （守卫在契约与代码不一致时失败 —— 令牌集合因此不会烂掉）。');
  L.push('>');
  L.push('> **口径**：只计样式族（`src/styles-base.js` … `src/styles-ext.js` 的 8 个域模板）里**属性位**的');
  L.push('> `--dsw-*` 声明（值里的 `var(--dsw-…)` 是读不是写，不计）；门控归属按花括号栈上的**选择器链**判定。');
  L.push('> **玻璃** = 链上有 `[data-we-glass-*]`；**壁纸** = 只有 `[data-we-wallpaper]`；');
  L.push('> **无门控** = 两者都不挂（共存审计 M1 的全部暴露面 —— 白名单见下表，新增一条守卫即红）。');
  L.push('> JS 侧的令牌写入（`src/font/apply.js` 的 label 族等）不在本契约口径内，见 `docs/DSH-UI-INTERFACES.md`。');
  L.push('');
  L.push(`共 **${decls.length}** 条声明 / **${tokens.length}** 个不同令牌。门控归属：`);
  L.push(`玻璃 **${buckets.glass.length}** 条 · 壁纸 **${buckets.wallpaper.length}** 条 · 无门控 **${buckets.ungated.length}** 条。`);
  L.push('');
  L.push('## 无门控声明（白名单 —— M1 的全部暴露面）');
  L.push('');
  L.push('除下列两处封闭白名单外，**任何新的无门控 `--dsw-*` 声明都会让 `verify-token-contract` 变红**');
  L.push('（按宿主规范消费 token 的第三方插件无法区分「玻璃开/关」，只能拿到配方本身 —— 见 `docs/COEXISTENCE.md`）。');
  L.push('');
  L.push('| 令牌 | 行 | 选择器链 | 归属 |');
  L.push('|---|---|---|---|');
  for (const d of buckets.ungated) {
    L.push(`| \`${d.token}\` | ${d.file}:${d.line} | \`${d.chain}\` | ${ungatedReason(d.chain) || '⚠️ 不在白名单'} |`);
  }
  if (!buckets.ungated.length) L.push('| （无） | | | |');
  L.push('');
  L.push('## 全量令牌表');
  L.push('');
  L.push('| 令牌 | 条数 | 门控 | 行号 | 消费者注记 |');
  L.push('|---|---|---|---|---|');
  for (const t of tokens) {
    const gates = ['glass', 'wallpaper', 'ungated'].filter((b) => t.buckets.has(b))
      .map((b) => `${BUCKET_LABEL[b]}(${cnt(t.decls, b)})`).join(' + ');
    const lines = t.lines.join(', ');
    L.push(`| \`${t.token}\` | ${t.decls.length} | ${gates} | ${lines} | ${NOTES[t.token] || ''} |`);
  }
  L.push('');
  const text = L.join('\n');
  return { decls, tokens, buckets, text };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { decls, tokens, buckets, text } = buildContract();
  if (process.argv.includes('--stats')) {
    console.log(JSON.stringify({
      decls: decls.length, tokens: tokens.length,
      glass: buckets.glass.length, wallpaper: buckets.wallpaper.length, ungated: buckets.ungated.length,
      ungatedTokens: new Set(buckets.ungated.map((d) => d.token)).size,
      glassTokens: new Set(buckets.glass.map((d) => d.token)).size,
      wallpaperTokens: new Set(buckets.wallpaper.map((d) => d.token)).size,
      ungatedChains: buckets.ungated.map((d) => d.chain),
    }, null, 1));
  } else if (process.argv.includes('--write')) {
    writeFileSync(DOC, text);
    console.log('written: docs/TOKEN-CONTRACT.md (' + decls.length + ' decls / ' + tokens.length + ' tokens)');
  } else {
    process.stdout.write(text);
  }
}
