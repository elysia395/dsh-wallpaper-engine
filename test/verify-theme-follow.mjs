#!/usr/bin/env node
/**
 * verify-theme-follow.mjs — 主题随壁纸：开关、取色优先级、亮度判决、写入去重与让位规则。
 *
 * 为什么要有这一层：自动切换默认**关**（`selection.themeFollow`，真源见 lib/settings-schema.js）——
 * 关着时这个功能整体不生效：不判决、不写主题、不留痕；开着时才恢复上游那套自动行为。两侧都要
 * 钉住，因为开着的每一条自我约束都只能靠守卫看着 —— 取色顺序错了会在部分壁纸上给出反向主题；
 * 亮度阈值漂了会让"深色壁纸配浅色界面"这种错误变成常态；写入不去重会在轮换列表里每次切换都改
 * 一次 profile 文件（`setTheme` 会把偏好落进 `cordis.patch.yml`）；不认"用户已经手动改过主题"
 * 会跟用户抢控制权。四条都在这里钉住。
 *
 * 分节：
 *   ① 颜色解析与 WCAG 亮度：三种来源写法（宿主 rgb() / CSS hex / WE 0–1 浮点三元组）、
 *      黑=0 白=1 中灰≈0.2159、阈值两侧的判决、缺色返回空判决
 *   ② 画面主色（纯函数）：量化到 4 bit/通道后取众数桶、透明像素不参与、空输入返回 null
 *   ③ 行为：作者配色 → 判决；覆盖值优先；同判决不重复写；外来改动即让位、换壁纸恢复；
 *      服务缺席不抛
 *   ④ ⑤ 取色链与两条腿的合议（作者纯黑视作"没填"、不一致取深色）
 *   ⑥ 开关：默认为关（设置模型 + 面板两面）· 关时深/浅两向都不改主题且清掉让位痕迹 ·
 *      开时上游行为仍在 · 键经唯一落盘入口且序列化→重建往返仍是该值
 *   ⑦ 接线（源码形态）：attach 挂在主题层 onReady 上、applySelection 里落 schemeColor
 *      并触发评估、面板开关经落盘入口、模块已登记进内联清单、清空路径放回 / 放回带标志
 *   ⑧ 皮肤互操作：退场放回（改过才放、一次性）· 让路态一律不写 · 外部切换不硬覆盖回去
 *      （让位标记 + 现值比对两层判据，含 fromSkinRestore 的正负对照）
 *
 * 本模块与 src/adapter.js 一样，按构建期契约以**同作用域**内联（`selection` /
 * `propTokenOf` / `storedUserPropsOf` 都是外部作用域的自由变量）⇒ 这里把这三个名字挂到
 * globalThis 上复现同一形态；每种初值用**新 URL 重新 import**，避免模块级判定状态互相污染。
 *
 * Usage: node test/verify-theme-follow.mjs
 */

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 源码形态判据一律先剥注释（共享的字符串感知实现）：注释里写着同一个名字不算"接线在位"。
import { stripComments } from './tools/js-text.mjs';
// 单独 import `src/**`（含 fresh URL 重载）时补上 bundle 作用域的取词层（中文身份）。
import { installWeTShim } from './tools/weT-shim.mjs';
installWeTShim();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
  else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

globalThis.ADAPTER_TARGET_VALUES = [];   // 与本次无关，但保证同作用域里没有未声明自由变量
let diagTraces = [];                     // 本模块的决策留痕（每次 freshThemeFollow 清空）
let transientWrites = {};                // 状态行落到的瞬态字段（面板从 sel 上读）
let importSeq = 0;
/**
 * 重新 import 该模块（模块内的判定状态是模块级的，跨用例会互相污染）。
 * `themeFollow` = 这个功能的总开关（**默认关**，见 lib/settings-schema.js）：上游行为用例
 * 显式传 `true`（开着才有那套自动行为），关的用例传 `false`。
 */
async function freshThemeFollow({ selection: sel, props = {}, themeFollow = true } = {}) {
  diagTraces = [];
  globalThis.reportClientDiag = (ev, detail) => { diagTraces.push(ev + ':' + String(detail)); };
  transientWrites = {};
  globalThis.setTransient = (field, value) => { transientWrites[field] = value; };
  globalThis.selection = Object.assign({ themeFollow }, sel || { id: "", schemeColor: null, previewUrl: "" });
  globalThis.propTokenOf = (s) => (s && s.propsUrl ? String(s.propsUrl).split("/").pop() : "");
  globalThis.storedUserPropsOf = (token) => (props[token] ? { ...props[token] } : {});
  return import(pathToFileURL(join(root, 'src', 'theme-follow.js')).href + '?case=' + (++importSeq));
}
/** 假主题服务 + 假 ctx：记录写入、记录订阅回调（供"用户改主题"用例手动触发）。 */
function makeFake(preference) {
  const calls = [];
  const handlers = [];
  const svc = {
    preference,
    getTheme() { return { preference: svc.preference }; },
    setTheme(v) { calls.push(v); svc.preference = v; },
  };
  const ctx = { on(ev, cb) { handlers.push([ev, cb]); return () => {}; } };
  return { svc, ctx, calls, handlers };
}
/** 一条最小壁纸条目（只带本模块会读的字段）。 */
function wallpaper(id, schemeColor, extra) {
  return Object.assign({ id, schemeColor, previewUrl: "", propsUrl: "" }, extra || {});
}
/**
 * 模拟"当前壁纸"：把桩 selection 换成这一条并触发评估 —— 生产里这两个东西本来就是同一个
 * 对象，而 accept 会核对它们一致（防止抓帧结果落到已经切走的那张上）。
 */
function onWallpaper(m, sel) {
  globalThis.selection = Object.assign({}, globalThis.selection, {
    id: sel.id, schemeColor: sel.schemeColor, previewUrl: sel.previewUrl || "", propsUrl: sel.propsUrl || "",
  });
  m.themeFollowOnWallpaper(globalThis.selection);
  return sel;
}

// ═══ ① 颜色解析与亮度 ═════════════════════════════════════════════════════════
console.log('\n① 颜色解析与 WCAG 亮度判决');
{
  const m = await freshThemeFollow();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('宿主写法 rgb(r, g, b) 可解析', eq(m.themeFollowParseColor('rgb(29, 56, 84)'), [29, 56, 84]),
    JSON.stringify(m.themeFollowParseColor('rgb(29, 56, 84)')));
  check('CSS 写法 #rrggbb / #rgb 可解析',
    eq(m.themeFollowParseColor('#1d3854'), [29, 56, 84]) && eq(m.themeFollowParseColor('#fff'), [255, 255, 255]));
  check('WE 属性的 0–1 浮点三元组可解析（面板覆盖值走这条）',
    eq(m.themeFollowParseColor('0.114 0.220 0.329'), [29, 56, 84]),
    JSON.stringify(m.themeFollowParseColor('0.114 0.220 0.329')));
  check('越界值被夹住、而不是溢出（0–1 域与 0–255 域各一条）',
    eq(m.themeFollowParseColor('300 -5 128'), [255, 0, 128])
    && eq(m.themeFollowParseColor('-0.2 0.5 0.9'), [0, 128, 230]),
    JSON.stringify(m.themeFollowParseColor('300 -5 128')) + ' / ' + JSON.stringify(m.themeFollowParseColor('-0.2 0.5 0.9')));
  // 混合域（有分量 > 1）：整条按 0–255 解释 —— 规则单一、可预期，不猜也不抛。
  check('混合域按 0–255 解释（规则显式写死在判据里）',
    eq(m.themeFollowParseColor('1.5 0.5 0.5'), [2, 1, 1]),
    JSON.stringify(m.themeFollowParseColor('1.5 0.5 0.5')));
  check('认不得的形状 ⇒ null（不猜）',
    m.themeFollowParseColor('not-a-color') === null && m.themeFollowParseColor('') === null
    && m.themeFollowParseColor(null) === null && m.themeFollowParseColor('1 2') === null);
  // 负对照：把合法值改坏一个字，同一条判据必须判空
  check('负对照：同一条解析判据对坏输入返回 null',
    m.themeFollowParseColor('rgb(29, 56)') === null && m.themeFollowParseColor('#1d385') === null);

  const lumBlack = m.themeFollowLuminance([0, 0, 0]);
  const lumWhite = m.themeFollowLuminance([255, 255, 255]);
  const lumMid = m.themeFollowLuminance([128, 128, 128]);
  check('亮度极值：黑 = 0、白 = 1', lumBlack === 0 && Math.abs(lumWhite - 1) < 1e-9,
    'black=' + lumBlack + ' white=' + lumWhite.toFixed(6));
  check('阈值是 0.40 —— "明显偏亮才浅色"（不再等于中灰）',
    m.THEME_FOLLOW_LIGHT_ABOVE === 0.4 && lumMid < m.THEME_FOLLOW_LIGHT_ABOVE,
    'mid=' + lumMid.toFixed(4) + ' threshold=' + m.THEME_FOLLOW_LIGHT_ABOVE);

  check('颜色规则本身不变：纯黑仍判深色（"没填"是取色链的事，不是判决的事）',
    m.themeFollowVerdict(m.themeFollowParseColor('0 0 0')) === 'dark');
  check('恰好 (0,0,0) 被判为「作者没填」（WE 新建工程的默认值）',
    m.themeFollowIsUnfilledSchemeColor([0, 0, 0]) === true
    && m.themeFollowIsUnfilledSchemeColor([0, 0, 1]) === false
    && m.themeFollowIsUnfilledSchemeColor([1, 0, 0]) === false
    && m.themeFollowIsUnfilledSchemeColor([255, 255, 255]) === false
    && m.themeFollowIsUnfilledSchemeColor(null) === false);
  check('深色方案色（0.114 0.220 0.329）⇒ 深色主题',
    m.themeFollowVerdict(m.themeFollowParseColor('0.114 0.220 0.329')) === 'dark');
  check('浅色方案色（Frieren 那张 0.619… 0.765… 0.910…）⇒ 浅色主题',
    m.themeFollowVerdict(m.themeFollowParseColor('0.6196078431372549 0.7647058823529411 0.9098039215686274')) === 'light');
  check('阈值两侧的判决（灰 169 = 深色，灰 170 = 浅色 —— 边界就在 0.40 上）',
    m.themeFollowVerdict([169, 169, 169]) === 'dark' && m.themeFollowVerdict([170, 170, 170]) === 'light',
    '169=' + m.themeFollowVerdict([169, 169, 169]) + ' 170=' + m.themeFollowVerdict([170, 170, 170]));
  // 两个真实投诉样本：饱和中间调人眼看是深的，0.40 门槛下判深色（中灰阈值时它们都判浅）。
  check('报过的两张壁纸在新门槛下都判深色（#00918A 与 88/168/88 的绿）',
    m.themeFollowVerdict([0, 145, 138]) === 'dark' && m.themeFollowVerdict([88, 168, 88]) === 'dark',
    'teal=' + m.themeFollowVerdict([0, 145, 138]) + ' green=' + m.themeFollowVerdict([88, 168, 88]));
  check('没有颜色 ⇒ 空判决（调用方据此"保持当前主题"）',
    m.themeFollowVerdict(null) === '' && m.themeFollowVerdict([1, 2]) === '');
}

// ═══ ② 画面主色（纯函数）══════════════════════════════════════════════════════
console.log('\n② 画面占比最大色（纯函数，供守卫直测）');
{
  const m = await freshThemeFollow();
  const px = (list) => {
    const b = Buffer.alloc(list.length * 4);
    list.forEach(([r, g, b2, a], i) => { b[i * 4] = r; b[i * 4 + 1] = g; b[i * 4 + 2] = b2; b[i * 4 + 3] = a === undefined ? 255 : a; });
    return b;
  };
  const mostlyRed = px([[255, 0, 0], [255, 0, 0], [255, 0, 0], [0, 0, 255]]);
  check('多数派胜出（3 红 1 蓝 ⇒ 红桶中心）',
    JSON.stringify(m.themeFollowModeColorOf(mostlyRed, 2, 2)) === JSON.stringify([248, 8, 8]),
    JSON.stringify(m.themeFollowModeColorOf(mostlyRed, 2, 2)));
  check('透明像素不参与（全透明 ⇒ null）',
    m.themeFollowModeColorOf(px([[255, 0, 0, 0], [255, 0, 0, 0]]), 2, 1) === null);
  check('半透明像素参与（alpha = 128 算在场）',
    JSON.stringify(m.themeFollowModeColorOf(px([[255, 0, 0, 128]]), 1, 1)) === JSON.stringify([248, 8, 8]));
  check('空输入 ⇒ null（不抛）',
    m.themeFollowModeColorOf(null, 0, 0) === null && m.themeFollowModeColorOf(Buffer.alloc(0), 1, 1) === null);
  // 负对照：把同一张图改成全透明，判据必须从"有结果"变成 null
  check('负对照：同一判据把整图改透明后返回 null',
    m.themeFollowModeColorOf(mostlyRed, 2, 2) !== null
    && m.themeFollowModeColorOf(px([[255, 0, 0, 0], [255, 0, 0, 0], [255, 0, 0, 0], [0, 0, 255, 0]]), 2, 2) === null);
  check('确定性：同一张图两次得到同一个答案',
    JSON.stringify(m.themeFollowModeColorOf(mostlyRed, 2, 2)) === JSON.stringify(m.themeFollowModeColorOf(mostlyRed, 2, 2)));
}

// ═══ ③ 行为：判决 / 去重 / 让位 / 降级 ════════════════════════════════════════
console.log('\n③ 行为：写入口的三条自我约束');
{

  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));
    check('作者配色 ⇒ 写入对应主题（深色方案写 dark）',
      JSON.stringify(f.calls) === JSON.stringify(['dark']), JSON.stringify(f.calls));
  }  {
    const m = await freshThemeFollow();
    const f = makeFake('dark');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));
    m.themeFollowOnWallpaper(wallpaper('w2', 'rgb(4, 6, 10)'));
    check('结论与当前偏好相同 ⇒ 一次都不写（轮换不写盘）',
      f.calls.length === 0, 'calls=' + JSON.stringify(f.calls));
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));
    const before = f.calls.length;
    f.svc.preference = 'light';                    // 用户在 DSH 里改回浅色：外部改动，不经我们的写入口
    for (const [ev, cb] of f.handlers) if (ev === 'theme/change') cb();
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));
    check('让位后不再插手（同一张壁纸再评估也被拦下）', f.calls.length === before,
      'before=' + before + ' after=' + f.calls.length);
    m.themeFollowOnWallpaper(wallpaper('w2', 'rgb(4, 6, 10)'));
    check('换下一张壁纸才恢复自动', f.calls.length === before + 1,
      'calls=' + JSON.stringify(f.calls));
  }
  {
    const m = await freshThemeFollow({ props: { tok: { schemecolor: '0.9 0.9 0.9' } } });
    const f = makeFake('dark');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(0, 0, 0)', { propsUrl: '/wallpaper-engine/props/tok' }));
    check('面板覆盖值优先于作者值（覆盖成浅色 ⇒ 写 light）',
      JSON.stringify(f.calls) === JSON.stringify(['light']), JSON.stringify(f.calls));
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));
    check('服务还没就绪时不抛、也不写', f.calls.length === 0);
    m.themeFollowAttach(null, null);
    m.themeFollowAttach({}, null);                 // 形状不对的服务：同样只当"没有"
    check('形状不对的服务被拒绝（不误当可用）', f.calls.length === 0);
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', null, { previewUrl: '' }));
    check('两条取色都拿不到 ⇒ 保持当前主题（一个字节都不写）', f.calls.length === 0);
  }
  {
    // 负对照（一个实现两个变体，喂同一条件）：去重判据是「同判决不重复写」（:196-202 那条正向
    // 判据）。这里把它的**判定对象换成一个真的不去重的实现** —— 同一份判定 + 无脑写 —— 并断言
    // 去重实现 `calls === []`、不去重实现 `calls !== []`。不去重那一支是**照产品逻辑写**的真实现
    // （对同一张壁纸评估两次、每次都 `setTheme`），所以期望值与比较值都来自被测实现，任一侧退化
    // 这条判据都会红；两个变体的服务序列与 :196-202 完全一致（两张同色壁纸、当前偏好 dark）。
    const naiveCalls = async () => {
      const f = makeFake('dark');
      const apply = () => { f.svc.setTheme('dark'); };   // 不去重：判决即写，同一偏好也照写
      apply(); apply();
      return f.calls.slice();
    };
    const dedupedCalls = async () => {
      const m = await freshThemeFollow();
      const f = makeFake('dark');
      m.themeFollowAttach(f.svc, f.ctx);
      m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));
      m.themeFollowOnWallpaper(wallpaper('w2', 'rgb(4, 6, 10)'));
      return f.calls.slice();
    };
    const deduped = await dedupedCalls();
    const naive = await naiveCalls();
    check('负对照：同一条判据（同判决不重复写）能区分"去重"与"每次都写"',
      deduped.length === 0 && naive.length > 0,
      '去重实现 calls=' + JSON.stringify(deduped) + ' · 不去重实现 calls=' + JSON.stringify(naive));
  }
}

// ═══ ④ 恰好 0 0 0 的作者值：视作「没填」═══════════════════════════════════════
console.log('\n④ 恰好 0 0 0 的作者值视作没填 ⇒ 退回画面主色');
{
  const m = await freshThemeFollow();
  check('作者值恰好纯黑 ⇒ 取色链返回"没有配色"（交给画面主色）',
    m.themeFollowSchemeColorOf({ schemeColor: 'rgb(0, 0, 0)', propsUrl: '' }) === null);
  check('作者值不是纯黑 ⇒ 照用（差一个分量也算填了）',
    JSON.stringify(m.themeFollowSchemeColorOf({ schemeColor: 'rgb(0, 0, 1)', propsUrl: '' })) === JSON.stringify([0, 0, 1])
    && JSON.stringify(m.themeFollowSchemeColorOf({ schemeColor: 'rgb(1, 0, 0)', propsUrl: '' })) === JSON.stringify([1, 0, 0]));
  check('作者值纯白照用（规则只管纯黑）',
    JSON.stringify(m.themeFollowSchemeColorOf({ schemeColor: 'rgb(255, 255, 255)', propsUrl: '' })) === JSON.stringify([255, 255, 255]));
}
{
  const m = await freshThemeFollow({ props: { tok: { schemecolor: '0 0 0' } } });
  check('面板里显式填的纯黑照用（明确意图 ≠ 默认值）',
    JSON.stringify(m.themeFollowSchemeColorOf(
      { schemeColor: 'rgb(0, 0, 0)', propsUrl: '/wallpaper-engine/props/tok' })) === JSON.stringify([0, 0, 0]));
}
{
  // 端到端：作者纯黑 + 没有图可采样 ⇒ 保持当前主题（不因为"没填"反手写深色）
  const m = await freshThemeFollow();
  const f = makeFake('light');
  m.themeFollowAttach(f.svc, f.ctx);
  m.themeFollowOnWallpaper({ id: 'w1', schemeColor: 'rgb(0, 0, 0)', previewUrl: '', propsUrl: '' });
  check('作者纯黑 + 无图可采样 ⇒ 一个字节都不写（不反手写深色）',
    f.calls.length === 0, JSON.stringify(f.calls));
}

// ═══ ⑤ 两条腿的合议：都说是浅色才用浅色 ════════════════════════════════════════
console.log('\n⑤ 两条腿合议：真实帧与预览图不一致时取深色，都说是浅色才浅色');
{
  const m = await freshThemeFollow();
  const f = makeFake('light');
  m.themeFollowAttach(f.svc, f.ctx);
  onWallpaper(m, wallpaper('w1', null));
  m.themeFollowAcceptImageVerdict([40, 45, 50], 1);          // 预览图：深
  check('预览图结果被采纳（只有一条腿 ⇒ 按它走，写 dark）',
    JSON.stringify(f.calls) === JSON.stringify(['dark']), JSON.stringify(f.calls));
  m.themeFollowAcceptImageVerdict([240, 240, 240], 2);       // 真实帧：浅（与预览图相反）
  check('两条腿不一致 ⇒ 取深色（真实帧不再单方面反转结论）',
    JSON.stringify(f.calls) === JSON.stringify(['dark']), JSON.stringify(f.calls));
  // 判据量**留痕这条通道**（诊断 + 面板瞬态状态行都非空），不量产品那句措辞 ——
  // 措辞只作 detail 串，改文案不该让守卫红，判错方向才该红。
  check('不一致这件事留下了痕迹（诊断 + 面板瞬态状态行）',
    diagTraces.length > 0 && String(transientWrites.themeFollowLine || '').trim().length > 0,
    (diagTraces.slice(-1)[0] || '(无)') + ' || ' + String(transientWrites.themeFollowLine || ''));
  m.themeFollowAcceptImageVerdict([40, 45, 50], 1);          // 迟到的预览图结果
  check('迟到的预览图结果不再回头改（rank 1 ≤ 已采纳的 2）',
    f.calls.length === 1, JSON.stringify(f.calls));
}
{
  // 两条腿都说是浅色 ⇒ 浅色（真的亮才切）
  const m = await freshThemeFollow();
  const f = makeFake('dark');
  m.themeFollowAttach(f.svc, f.ctx);
  onWallpaper(m, wallpaper('w2', null));
  m.themeFollowAcceptImageVerdict([240, 240, 240], 1);       // 预览图：浅
  m.themeFollowAcceptImageVerdict([250, 250, 250], 2);       // 真实帧：浅
  check('两条腿都说是浅色 ⇒ 写 light',
    JSON.stringify(f.calls) === JSON.stringify(['light']), JSON.stringify(f.calls));
}
{
  // 只有真实帧、没有预览图（图挂了）⇒ 按真实帧走
  const m = await freshThemeFollow();
  const f = makeFake('dark');
  m.themeFollowAttach(f.svc, f.ctx);
  onWallpaper(m, wallpaper('w3', null));
  m.themeFollowAcceptImageVerdict([240, 240, 240], 2);       // 只有帧这一条腿：浅
  check('只有真实帧一条腿时说浅色也认（唯一证据）',
    JSON.stringify(f.calls) === JSON.stringify(['light']), JSON.stringify(f.calls));
}
{
  const m = await freshThemeFollow();
  const f = makeFake('light');
  m.themeFollowAttach(f.svc, f.ctx);
  onWallpaper(m, wallpaper('w4', 'rgb(10, 12, 16)'));        // 作者配色在场
  const before = f.calls.length;
  m.themeFollowAcceptImageVerdict([240, 240, 240], 2);
  check('作者配色在场 ⇒ 两条腿都不参与（作者说了算）',
    f.calls.length === before, 'calls=' + JSON.stringify(f.calls));
}
{
  // 合议状态随壁纸清零：新壁纸只拿到预览图那一条腿时，不该被上一张的结论挡住
  const m = await freshThemeFollow();
  const f = makeFake('dark');
  m.themeFollowAttach(f.svc, f.ctx);
  onWallpaper(m, wallpaper('w5', null));
  m.themeFollowAcceptImageVerdict([240, 240, 240], 2);       // 只有帧：浅 ⇒ light
  onWallpaper(m, wallpaper('w6', null));                     // 换壁纸 ⇒ 两条腿与排名全清
  m.themeFollowAcceptImageVerdict([40, 45, 50], 1);          // 新壁纸的预览图：深
  check('换壁纸后合议状态清零（新壁纸的预览图结论照常生效）',
    JSON.stringify(f.calls) === JSON.stringify(['light', 'dark']), JSON.stringify(f.calls));
}
{
  // 抓帧入口本身：document 打桩，验证它确实读像素、并按真实帧那一档进合议
  const m = await freshThemeFollow();
  const f = makeFake('light');
  m.themeFollowAttach(f.svc, f.ctx);
  onWallpaper(m, wallpaper('w7', null));
  const px = Buffer.alloc(4 * 4);                            // 4 个暗像素
  for (let i = 0; i < 4; i++) { px[i * 4] = 30; px[i * 4 + 1] = 30; px[i * 4 + 2] = 30; px[i * 4 + 3] = 255; }
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage() {}, getImageData: () => ({ data: px }) }),
    }),
  };
  m.themeFollowOnFrameCanvas({});
  globalThis.document = prevDoc;
  check('场景抓帧入口：画布的占比最大色进了合议（唯一证据 ⇒ 写 dark）',
    JSON.stringify(f.calls) === JSON.stringify(['dark']), JSON.stringify(f.calls));
}
{
  const m = await freshThemeFollow();
  const f = makeFake('light');
  m.themeFollowAttach(f.svc, f.ctx);
  transientWrites = {};
  onWallpaper(m, wallpaper('w8', 'rgb(10, 12, 16)'));
  // 判据量**通道**、不量措辞：措辞是 `themeFollowDescribe` 的实现细节，抄进期望值就是让产品
  // 自己给自己判卷（改一个字就红，判错方向却可能仍绿）。判决的正确性由 :193-194 独立钉住，
  // 这里只问"判决真落进了瞬态字段"；实际写进去的那句话降为 detail 串（同形见 ⑤ / ⑧ 两处）。
  check('状态行会随判决落到瞬态字段（面板据此显示"当前：…"）',
    JSON.stringify(f.calls) === JSON.stringify(['dark'])
    && String(transientWrites.themeFollowLine || '').trim().length > 0,
    String(transientWrites.themeFollowLine || '(无)'));
}

// ═══ ⑥ 开关「主题随壁纸」：默认关 · 关时主题不变 · 开时上游行为 · 持久化 ═══════
// 判据只量**结果**：主题服务收到几次写入、偏好最后是什么、面板状态行有没有留痕 —— 不看模块
// 内部走了哪条支（"关"的语义就是"这个功能不存在"）。下面 ②/③ 两条共用同一个判据函数
//（`themeMovesUnderSwitch`），只是喂进去的开关值不同：这正是正/负对照。
console.log('\n⑥ 开关「主题随壁纸」：默认关 · 关时主题不变 · 开时上游行为 · 键经落盘入口');
{
  const schema = await import(pathToFileURL(join(root, 'lib', 'settings-schema.js')).href);
  const tabsCode = stripComments(read('src/panel-tabs.js'));
  const clientCode = stripComments(read('src/client.js'));
  // i18n 之后行文案走 `weT("…")`（中文原文即键）—— 判据认"开关 + 配色行都还在、且顺序如此"，
  // 不认裸字面量（认形态的判据会在下一次改包装时静默失效）。
  const switchAt = tabsCode.indexOf('switchRow(weT("主题随壁纸")');
  const swatchAt = tabsCode.indexOf('swatchRow(weT("配色")');

  check('开关存在且默认为关（设置模型 DEFAULTS.themeFollow === false，kind = boolFalse）',
    schema.DEFAULTS.themeFollow === false && schema.KINDS.themeFollow
    && schema.KINDS.themeFollow.kind === 'boolFalse',
    'DEFAULTS=' + String(schema.DEFAULTS.themeFollow) + ' kind=' + String((schema.KINDS.themeFollow || {}).kind));

  check('面板「主题」段有这个开关，且文案说明「关 = 不按壁纸自动改深浅主题」（面板面可见）',
    switchAt >= 0 && swatchAt > switchAt && tabsCode.includes('不按壁纸自动改深浅主题'),
    '开关下标=' + switchAt + ' / 配色行下标=' + swatchAt);

  /**
   * 判据本体（正/负对照**共用这一个函数**）：给定开关值与当前偏好，喂一张壁纸。
   * 返回主题服务收到的写入、最终偏好与面板状态行 —— 结果型：只看"主题有没有被改动"。
   */
  async function themeMovesUnderSwitch(themeFollow, sel, preference) {
    const m = await freshThemeFollow({ themeFollow });
    const f = makeFake(preference);
    m.themeFollowAttach(f.svc, f.ctx);
    onWallpaper(m, sel);
    return { calls: f.calls.slice(), preference: f.svc.preference, line: String(transientWrites.themeFollowLine || '') };
  }

  // ② 关：深、浅两个方向都不许改主题（哪怕壁纸会让主题变深/变浅），也不留判决痕迹。
  //    「让位痕迹」是本张壁纸的跨评估状态：关掉时必须清掉，否则"关了再开"在同一张壁纸上
  //    会静默不生效（`themeFollowYield` 还压着写入）。做法：开着写下让位标记 → 关 → 再开回
  //    同一张，必须重新判决。
  const offDark = await themeMovesUnderSwitch(false, wallpaper('w1', 'rgb(4, 6, 10)'), 'light');
  const offLight = await themeMovesUnderSwitch(false, wallpaper('w2', 'rgb(240, 244, 250)'), 'dark');
  const mOff = await freshThemeFollow({ themeFollow: true });
  const fOff = makeFake('light');
  mOff.themeFollowAttach(fOff.svc, fOff.ctx);
  onWallpaper(mOff, wallpaper('w3', 'rgb(4, 6, 10)'));
  const wroteWhileOn = fOff.calls.length;
  // 驱动器地板（覆盖面）：下面用 `fOff.handlers` 驱动"外部改主题"来置让位标记 —— 订阅不在场
  // 时这个循环会静默空转，而紧跟着的判据恰好是「关时不留让位痕迹」，空转最容易让它通过。
  check('覆盖面：theme/change 订阅在场（否则驱动器静默空转、下面的"清掉让位痕迹"白测）',
    fOff.handlers.some(([ev]) => ev === 'theme/change'),
    '订阅=' + JSON.stringify(fOff.handlers.map(([ev]) => ev)));
  fOff.svc.preference = 'light';                       // 外部改主题 ⇒ 本张壁纸让位
  for (const [ev, cb] of fOff.handlers) if (ev === 'theme/change') cb();
  globalThis.selection.themeFollow = false;            // 关
  mOff.themeFollowOnWallpaper(globalThis.selection);
  globalThis.selection.themeFollow = true;             // 再开
  mOff.themeFollowOnWallpaper(globalThis.selection);
  check('关时：深/浅两向都不改主题（0 次写入、偏好原样、面板不留痕），且清掉让位痕迹（再开即重新判决）',
    offDark.calls.length === 0 && offDark.preference === 'light' && offDark.line === ''
    && offLight.calls.length === 0 && offLight.preference === 'dark' && offLight.line === ''
    && wroteWhileOn === 1 && fOff.calls.length === wroteWhileOn + 1,
    '关(深壁纸)=' + JSON.stringify(offDark.calls) + '/' + offDark.preference
    + ' 关(浅壁纸)=' + JSON.stringify(offLight.calls) + '/' + offLight.preference
    + ' 关→开写入 ' + wroteWhileOn + '→' + fOff.calls.length);

  // ③ 开：上游行为仍在 —— 与 ② 同一判据函数，只换开关值（正对照）。
  const onDark = await themeMovesUnderSwitch(true, wallpaper('w1', 'rgb(4, 6, 10)'), 'light');
  const onLight = await themeMovesUnderSwitch(true, wallpaper('w2', 'rgb(240, 244, 250)'), 'dark');
  check('开时：上游行为仍在（深色壁纸写 dark、浅色写 light，并留下状态行）',
    JSON.stringify(onDark.calls) === JSON.stringify(['dark'])
    && JSON.stringify(onLight.calls) === JSON.stringify(['light']) && onDark.line !== '',
    JSON.stringify(onDark.calls) + ' / ' + JSON.stringify(onLight.calls));

  // ④ 持久化：键**不在**只做默认值的豁免名单里，经唯一落盘入口 setSetting 写，且
  //    序列化 → 重建往返后客户端与宿主读到的都仍是该值（刷新/重启不丢）。
  const saved = schema.serializeSettings({ id: 'x', themeFollow: true });
  const rebuilt = (side) => schema.sanitizeFromSchema(JSON.parse(JSON.stringify(saved)), side).themeFollow;
  check('持久化：不在 DEFAULTS_ONLY、经 setSetting 落盘，且序列化→重建往返两侧都仍是该值',
    !schema.DEFAULTS_ONLY.includes('themeFollow') && 'themeFollow' in schema.serializeSettings({})
    && /setSetting\("themeFollow"/.test(clientCode)
    && saved.themeFollow === true && rebuilt('client') === true && rebuilt('host') === true,
    'setSetting=' + /setSetting\("themeFollow"/.test(clientCode)
    + ' 往返 client/host=' + rebuilt('client') + '/' + rebuilt('host'));
}

// ═══ ⑦ 接线（源码形态）════════════════════════════════════════════════════════
console.log('\n⑦ 接线：服务句柄 / 切换评估 / 面板开关 / 内联登记');
{
  const clientSrc = read('src/client.js');
  const prepSrc = read('src/media-prep.js');
  const tabsSrc = read('src/panel-tabs.js');
  const buildSrc = read('scripts/build-client.mjs');
  check('主题服务句柄接在既有的 theme 轮询 onReady 上（不新增轮询）',
    /onReady: \(theme\) => \{ themeFollowAttach\(theme, ctx\);/.test(clientSrc));
  check('applySelection 落 schemeColor（垫底图的底色兜底因此不再永远为空）',
    prepSrc.includes('selection.schemeColor = w.schemeColor || null;')
    && read('src/live-layer.js').includes('sel.schemeColor ||'));
  // 同一形态的接线判据：宿主发的字段（inventory 的 liveFrame）必须在 applySelection 里落地，
  // 否则 web 支的"实时帧"这一级在客户端不存在（候选表、抽帧定时器、真实帧取色那条腿全断）
  // —— 行为面由 rotation-prepared-leak-smoke 的 X1/X2 正负对照钉住。
  const liveAssign = prepSrc.includes('selection.liveFrame = w.type === "web" && w.liveFrame ? w.liveFrame : null;');
  const liveRead = read('src/live-layer.js').includes('sel.liveFrame ||');
  check('applySelection 落 liveFrame（web 支的实时帧候选因此才有入口）',
    liveAssign && liveRead, 'assign=' + liveAssign + ' read=' + liveRead);
  check('清空/被过滤两条早退分支也把实时帧清掉（不留上一张的残值）',
    prepSrc.split('selection.liveFrame = null;').length - 1 >= 2);
  check('applySelection 触发评估，并把「皮肤放回」标志透传（放回那次不复位让位标记）',
    prepSrc.includes('themeFollowOnWallpaper(selection, { fromSkinRestore: !!(opts && opts.fromSkinRestore) });'));
  check('清空/被过滤两条早退分支也把配色清掉（不留上一张的残值）',
    prepSrc.split('selection.schemeColor = null;').length - 1 >= 2);
  check('面板开关有文案说明规则与让位条件（关 = 不自动跟随）',
    tabsSrc.includes('主题随壁纸') && tabsSrc.includes('不按壁纸自动改深浅主题'));
  check('模块已登记进内联清单（否则永远不进产物）',
    buildSrc.includes("file: 'src/theme-follow.js'"));
  check('产物里确实带上了判定常量（构建期内联生效）',
    read('lib/client.js').includes('THEME_FOLLOW_LIGHT_ABOVE'));
  const liveSrc = read('src/live-layer.js');
  check('两条真实抓帧路径都接上了：场景画布 + 网页 __wp.capture',
    liveSrc.includes('themeFollowOnFrameCanvas(canvas);')
    && liveSrc.includes('themeFollowOnFrameImage(dataUrl);'));
  // 皮肤互操作（退出清单里的主题那一条）：清空路径放回 + 复位那次走 fromSkinRestore。
  // 判据认形态（函数名 + 实参形态），负对照在 ⑧ 的行为面（剥掉就不写回）。
  const themeSrc = read('src/theme-follow.js');
  // ⚠️ 换行一律写 `\r?\n`：CI 是 CRLF 检出（windows-latest），写死 `\n` 的形态正则在那边恒不匹配
  //（实测：本批主题放回守卫因此红过一次 CI）。第二条把容忍性本身钉住 —— CRLF 变换不依赖 CI
  // 环境，所以在本地就能判红"本地绿、CI 红"的复发。
  // ⚠️ 变换本身要先归一成 LF 再转 CRLF：CI 检出已是 CRLF，直接 replace(/\n/g) 会得到 `\r\r\n`
  //（第二次实测踩到：这条检查自己在 CI 上红了 —— 先归一 = 幂等）。
  const releaseThenEmitRe = /themeFollowRelease\(\);\r?\n\s*emit\(\);/;
  const toCrlf = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  check('清空路径调用放回（themeFollowRelease）—— 用户「清除」与皮肤让路两条路都汇到那里',
    releaseThenEmitRe.test(prepSrc));
  check('CRLF 容忍：同一条判据在 CRLF 检出形态上也命中（防"本地绿、CI 红"复发）',
    releaseThenEmitRe.test(toCrlf(prepSrc)));
  check('放回只在 applySelection 的清空路径调（被过滤的早退分支不调 —— 选择还在，主题时代没结束）',
    prepSrc.split('themeFollowRelease()').length - 1 === 1,
    'calls=' + (prepSrc.split('themeFollowRelease()').length - 1));
  check('皮肤退场放回壁纸时带 fromSkinRestore（让位标记随这次放回不复位）',
    clientSrc.includes('applySelection(mem.id, { fromSkinRestore: true });'));
  check('主题的写入口全部带皮肤让路门（评估 / 写 / 图源 / 两条帧腿，共 5 处）',
    (themeSrc.match(/\|\| themeFollowSkinYielded\(\)\)|if \(themeFollowSkinYielded\(\)\)/g) || []).length === 5,
    'gates=' + (themeSrc.match(/\|\| themeFollowSkinYielded\(\)\)|if \(themeFollowSkinYielded\(\)\)/g) || []).length);
}

// ═══ ⑧ 皮肤互操作：退场放回 · 让路不写 · 外部切换不硬覆盖回去 ═════════════════════════
// 三条规则（用户口径）：WE 在台时主题归 WE；我方退场（清空 / 让路给皮肤）把**我方改过的
// 那一份**原样放回；任何外部主题切换（用户手动 / 皮肤窗口里的改动）永远优先 —— 不放、不写、
// 不被打回。放回是对自己那次改动的撤销，不是把主题"翻回去"。
console.log('\n⑧ 皮肤互操作：退场放回 · 让路态不写 · 外部切换不硬覆盖回去');
{
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));   // light → dark
    const wrote = f.calls.length;
    m.themeFollowRelease();
    // 判据量**放回这件事真的发生了**（偏好回到 light、瞬态状态行留痕），不量产品那句措辞；
    // 「留痕」走面板瞬态通道独立观察，不拿 `diagTraces` 里的产品文案当判据。
    check('退场放回：我方改过的那份原样归还（dark → light）并留痕',
      wrote === 1 && JSON.stringify(f.calls) === JSON.stringify(['dark', 'light'])
      && f.svc.preference === 'light'
      && String(transientWrites.themeFollowLine || '').trim().length > 0,
      JSON.stringify(f.calls) + ' pref=' + f.svc.preference
      + ' || ' + String(transientWrites.themeFollowLine || '') + ' || ' + (diagTraces.slice(-1)[0] || '(无)'));
    m.themeFollowRelease();
    check('放回是一次性的（没有改动痕迹后不再写）', f.calls.length === 2, JSON.stringify(f.calls));
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('dark');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));   // 已是 dark：从未写
    m.themeFollowRelease();
    check('我方没动过主题 ⇒ 退场不放回（一个字节都不写）', f.calls.length === 0, JSON.stringify(f.calls));
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));   // 写 dark（before = light）
    f.svc.preference = 'light';                                   // 用户改浅色（外部，让位）
    // 驱动器地板（覆盖面）：下面的循环要"通知让位"，订阅不在场时它会静默空转，
    // 而紧接着的判据恰好是「不硬覆盖」—— 空转最容易让它通过。
    check('覆盖面：theme/change 订阅在场（否则下面的让位通知空转、"不硬覆盖"白测）',
      f.handlers.some(([ev]) => ev === 'theme/change'),
      '订阅=' + JSON.stringify(f.handlers.map(([ev]) => ev)));
    for (const [ev, cb] of f.handlers) if (ev === 'theme/change') cb();
    f.svc.preference = 'dark';                                    // 又改回深色：现值回到我方写的那份
    for (const [ev, cb] of f.handlers) if (ev === 'theme/change') cb();
    m.themeFollowRelease();
    check('别人动过手（让位标记在场）⇒ 退场不硬覆盖回去（哪怕现值恰好等于我方写的值）',
      JSON.stringify(f.calls) === JSON.stringify(['dark']) && f.svc.preference === 'dark',
      JSON.stringify(f.calls) + ' pref=' + f.svc.preference);
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));   // 写 dark
    f.svc.preference = 'light';                                   // 直接改服务、不触发事件（最坏形态）
    m.themeFollowRelease();
    check('现值已经不是我方写的值 ⇒ 退场也不碰（不硬覆盖回去）',
      JSON.stringify(f.calls) === JSON.stringify(['dark']) && f.svc.preference === 'light',
      JSON.stringify(f.calls) + ' pref=' + f.svc.preference);
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));   // before = light，写 dark
    globalThis.skinYieldActive = () => true;
    try {
      m.themeFollowOnWallpaper(wallpaper('w2', 'rgb(240, 244, 250)'));
      m.themeFollowAcceptImageVerdict([240, 240, 240], 2);
      const duringYield = f.calls.length;
      m.themeFollowRelease();
      check('让路态：评估与图源腿一律空转；放回照常执行（把环境还给皮肤）',
        duringYield === 1 && JSON.stringify(f.calls) === JSON.stringify(['dark', 'light']),
        'yield 中写入 ' + duringYield + ' → ' + JSON.stringify(f.calls));
    } finally { delete globalThis.skinYieldActive; }
  }
  {
    // 重载分裂：本页从未评估过这张壁纸（themeFollowWallpaperId 还是空），皮肤窗口期间
    // 用户改过主题；放回（fromSkinRestore）必须让那次切换活下来。负对照 = 同序列不带标志。
    const restoreCase = async (withFlag) => {
      const m = await freshThemeFollow();
      const f = makeFake('dark');
      m.themeFollowAttach(f.svc, f.ctx);
      f.svc.preference = 'light';                                  // 窗口期：用户把主题切成浅色
      for (const [ev, cb] of f.handlers) if (ev === 'theme/change') cb();
      m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'),
        withFlag ? { fromSkinRestore: true } : undefined);
      return { calls: f.calls.slice(), pref: f.svc.preference };
    };
    const kept = await restoreCase(true);
    check('放回（fromSkinRestore）不复位让位标记：窗口里改过的主题不被壁纸判决打回',
      kept.calls.length === 0 && kept.pref === 'light', JSON.stringify(kept));
    const naive = await restoreCase(false);
    check('负对照：不带 fromSkinRestore 的普通应用会复位让位标记（同一序列被写回 dark）⇒ 判据能区分',
      naive.calls.length === 1 && naive.pref === 'dark', JSON.stringify(naive));
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'), { fromSkinRestore: true });
    check('窗口里没人动过主题 ⇒ 放回照常写入壁纸判决（正对照：别把"不硬覆盖"做成"永远不写"）',
      JSON.stringify(f.calls) === JSON.stringify(['dark']), JSON.stringify(f.calls));
  }
  {
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));
    m.themeFollowRelease();
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));
    check('放回后再选同一张 ⇒ 重新接管（写 dark；before 重新记一份）',
      JSON.stringify(f.calls) === JSON.stringify(['dark', 'light', 'dark']), JSON.stringify(f.calls));
    m.themeFollowRelease();
    check('第二轮退场同样放回（环境每次都能退干净）',
      JSON.stringify(f.calls) === JSON.stringify(['dark', 'light', 'dark', 'light']), JSON.stringify(f.calls));
  }
  {
    // 放回的自反陷阱：放回自己也会触发一次 theme/change，不许被读成"别人接管"（否则**同一张**
    // 壁纸的放回会因让位标记被自己锁死）。判据用同一 id + fromSkinRestore（不复位让位标记）——
    // 那正是"先记再写"纪律唯一能被观察到的路径。
    const m = await freshThemeFollow();
    const f = makeFake('light');
    m.themeFollowAttach(f.svc, f.ctx);
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'));   // 写 dark
    m.themeFollowRelease();                                       // 放回 light（我方写入）
    for (const [ev, cb] of f.handlers) if (ev === 'theme/change') cb();   // 这次写入派发的事件
    m.themeFollowOnWallpaper(wallpaper('w1', 'rgb(4, 6, 10)'), { fromSkinRestore: true });
    check('放回自触发的 theme/change 不被读成"别人接管"（先记再写）：同张壁纸的放回照常接管',
      JSON.stringify(f.calls) === JSON.stringify(['dark', 'light', 'dark']), JSON.stringify(f.calls));
  }
}

console.log('\n' + (failed ? 'THEME-FOLLOW CHECKS FAILED — ' + failed + ' failed' : 'ALL THEME-FOLLOW CHECKS PASSED'));
process.exit(failed ? 1 : 0);
