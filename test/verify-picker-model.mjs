// Verify the picker's MODEL layer — src/picker-model.js as inlined into the emitted
// bundle lib/client.js — by two independent routes:
//
//   ① 用例表：直接调模型（从**产物**里切出内联段落再求值），逐条判「同一份输入给出
//      同一份输出」：搜索大小写不敏感 / 空查询不过滤 / 类型过滤 / 评分过滤 / 自上传的
//      宽松分级 / 隐藏排除 / 分页切片与页号 clamp / 轮换编辑器列表 / 空库存与零命中。
//   ② 跨层对拍：真挂载客户端（readFileSync(lib/client.js) + __ModuleLoader__.load 捕获
//      handoff → factory(mockReact) → slots → ctx → apply() → 打开模态框），拿**模型算出的
//      可播放数**与**真实渲染出的 `.we-picker__card` 数（减掉关闭卡）**对拍 ——
//      起库视图不分页、改虚拟窗口（首窗 = 关闭卡 + min(VP_FIRST, 可播放数)），对拍对象
//      相应从"当页切片"换成"首窗"；"模型说的和视图画的是不是同一件事"照旧只在这条上能看出。
//
// 判据纪律（docs/DEV-GUIDE.md §4.7 约定 5）：每条判据只在这里定义一次（命名函数 / 命名常量），
// 正判据与负对照**调同一个函数**，负对照喂的是**变异输入**（换掉用例的输入夹具 / 换掉模型的
// 一项输出 / 换掉被求值的源码文本），不是另抄一份判据；且判据先剥注释再判（§约定 3）——
// 本文件的散文里正带着 `selection` / `emit` 这些词。
//
// 被钉住的不变量：模型是**纯函数 + 显式入参**（不读 selection / 不碰 DOM / 不 emit），
// 每页 24 张，"关闭卡"不属模型，标题搜索是大小写不敏感的子串匹配（空查询 = 不过滤）。
//
// Usage: node test/verify-picker-model.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// 剥注释：共享的字符串感知实现（test/tools/js-text.mjs）。
import { stripComments, stripExportBlocks } from './tools/js-text.mjs';

// ══ 判据（唯一一份）══════════════════════════════════════════════════════════

/** 模型段的源码里**不许出现**的外界引用（判定只读入参，副作用归调用点）。 */
const AMBIENT_REFERENCE = /\bselection\b|\bemit\s*\(|\bsetSetting\s*\(|\bdocument\b|\bwindow\b|\bfetch\s*\(|\brequire\s*\(|^\s*import\s/m;

/** 判据：这段源码是纯的（先剥注释再判 —— 头部的散文正带着这些词）。 */
const isPureModelSource = (src) => !AMBIENT_REFERENCE.test(stripComments(src));

/**
 * 判据：用例的某项投影是否等于期望。正判据与负对照共用这一个函数 —— 负对照喂的是
 * **变异后的模型输入**（见用例表的 `breakOver`），投影函数与期望都保持不变。
 */
const projectsTo = (model, project, want) =>
  JSON.stringify(project(model)) === JSON.stringify(want);

/** 判据：直调某个判定函数是否得 `want`（负对照喂变异实参）。 */
const callsTo = (fn, args, want) => fn(...args) === want;

/** 判据：模型 API 是否齐全（防切出来的段落是空的 ⇒ 下面每条都在空跑）。 */
const hasModelApi = (M) => ['ratingOf', 'matchesRatingFilter', 'matchesTypeFilter',
  'matchesOrientationFilter',
  'isPlayableType', 'isRotatableWallpaper', 'keepPlayingWallpaper', 'isHiddenWallpaper',
  'isUploadedWallpaper', 'isDirWallpaper', 'playableWallpapers', 'hiddenWallpapers',
  'pageSlice', 'pickerModel']
  .every((k) => typeof M[k] === 'function') && typeof M.PICKER_PAGE_SIZE === 'number';

/** 判据：`pageSlice` 的形状（张数 / 页号 / 页数）。 */
const sliceShapeOf = (M, list, page) => {
  const v = M.pageSlice(list, page);
  return [v.items.length, v.page, v.pages];
};
const slicesTo = (M, list, page, want) =>
  JSON.stringify(sliceShapeOf(M, list, page)) === JSON.stringify(want);

/** 判据：模型自己的分页切片形状（模型层仍提供 pageSlice；轮换编辑器还在用）。 */
const pageIs = (model, items, pages) =>
  model.normalPage.items.length === items && model.normalPage.pages === pages;

// ── 跨层判据：模型算出的卡片数 vs 真实渲染出的卡片数 ──
/** 渲染树里的卡片（按 class **令牌**匹配：卡片有 `--selected` / `--checked` 修饰态）。 */
function collectCards(root) {
  const cards = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const cls = typeof (node.props && node.props.className) === 'string' ? node.props.className : '';
    if (cls.split(/\s+/).includes('we-picker__card')) cards.push(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  })(root);
  return cards;
}

/** 壁纸卡片 = 全部卡片减掉「✕ 关闭」那张（关闭卡由视图渲染，不属模型）。 */
const wallpaperCards = (root) =>
  collectCards(root).filter((c) => !JSON.stringify(c).includes('✕ 关闭'));
const renderedCardCount = (root) => wallpaperCards(root).length;

/** 虚拟首窗的条目容量（与 src/picker-modal.js 顶层 PICKER_VP_FIRST 同源；改那边必须同步这里）。 */
const PICKER_VP_FIRST = 30;
/** 首窗的**总**卡片数 = 关闭卡 + min(首窗容量, 可播放数)。 */
const firstWindowCards = (playableCount) => Math.min(PICKER_VP_FIRST, 1 + playableCount);

/** 跨层对拍判据：渲染出的壁纸卡片数 == 首窗减掉关闭卡（模型出可播放数，视图出卡数）。 */
const crossLayerAgrees = (root, model) =>
  renderedCardCount(root) === firstWindowCards(model.playableList.length) - 1;

/** 判据：挂载台自身 —— picker 渲染回调已注册（否则跨层那些判据全在空跑）。 */
const hasPickerRender = (renders) => renders.length > 0;

/**
 * 产物里的**分段标记**（`内联模块：` / `客户端正文`）—— 它们是 `scripts/build-client.mjs` 拼产物时
 * 写下的**机制常量**（用来**定位**段落），不是被检验的期望值 ⇒ 从构建脚本源码**现取**，本文件不手抄。
 * 构建脚本里改一次文案即自动跟上；取不到时返回 `null`，调用方据此判红（不静默放行）。
 *
 * ⚠️ 为什么必须现取（task-13 审计：类别 3「易腐化」）：这两个字面量原先手抄在本文件里，改构建脚本里
 * 那句**注释文案**（与正确性零关系）就会让 `inlinedSection()` 切不出段落 ⇒ 本文件十余条判据一起红。
 * 与**期望值**的分野要看清：像 `PICKER_VP_FIRST = 30`、`MODEL_EXPORTS` 那种"答案"手抄是**故意的
 * 独立口径**（从被测侧派生会让判据恒真）；这里只是"去哪找"，派生才是对的。
 */
const sectionMarkers = (buildSrc) => {
  // 形状取自构建脚本本身（`// ── <标签>：` 后面接模块名；`// ── <标签>（` 是正文段）——
  // 标签文案**不写死**，所以改文案（换词、换语言）时这里跟着走。
  //
  // ⚠️ 必须在**剥注释后**取，且正文那条的标签里不许出现 `：`（task-14 实测踩到的两个坑）：
  //   · 分段标记的**真源是发射点**（产物里那两行是构建脚本的**字符串 / 模板字面量**拼出来的），
  //     不是文件里任意一句长得像它的散文。本分支在组装点前新加了一句散文注释
  //     `// ── 刀4：panel-tabs …（…` ⇒ 旧写法（在原文上取第一个匹配）会把它当成 inline 标记
  //     （取到 `刀4`），拿去切产物必然切不出 ⇒ 本文件十余条判据一起假红。
  //   · 同一个模板字面量 `// ── 内联模块：${mod.file} —— …（构建期注入…）` 里既有 `：` 又有 `（`，
  //     正文正则会把它整段吃成「标签」（`内联模块：${mod.file} —— ${mod.why}`）⇒ 排除 `：` 后
  //     就只有真正的正文发射点 `// ── 客户端正文（…` 能匹配。
  // 剥注释是等长替换（test/tools/js-text.mjs），列定位语义不变；标签文案仍然不写死。
  const code = stripComments(buildSrc);
  const inline = /\/\/ ── ([^：\n]+)：/.exec(code);
  const body = /\/\/ ── ([^：\n]+)（/.exec(code);
  return {
    inline: inline ? '// ── ' + inline[1] + '：' : null,
    body: body ? '// ── ' + body[1] + '（' : null,
  };
};
const BUILD_SRC = readFileSync(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8');
const SECTION_MARKERS = sectionMarkers(BUILD_SRC);

/** 从产物里切出某个内联模块的段落（含 marker 注释行；切不出 → null）。 */
function inlinedSection(bundle, file, markers = SECTION_MARKERS) {
  if (!markers || !markers.inline) return null;
  const marker = markers.inline + file;
  const start = bundle.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  const ends = [
    bundle.indexOf(markers.inline, from),
    markers.body ? bundle.indexOf(markers.body, from) : -1,
  ].filter((i) => i > 0);
  return bundle.slice(start, ends.length ? Math.min(...ends) : bundle.length);
}

// ══ 判据挂载：从产物切出模型段并求值 ═════════════════════════════════════════
// 变异测试钩子：默认读构建产物，DSH_MUT_LIB 指向变异副本时读它。
const code = readFileSync(process.env.DSH_MUT_LIB || new URL('../lib/client.js', import.meta.url), 'utf8');

const MODEL_API_NAMES = '{ ratingOf, matchesRatingFilter, matchesTypeFilter, matchesOrientationFilter, isPlayableType,'
  + ' isRotatableWallpaper, keepPlayingWallpaper, isRotationEligible, isHiddenWallpaper, isUploadedWallpaper,'
  + ' isDirWallpaper, playableWallpapers, hiddenWallpapers, pageSlice, pickerModel,'
  + ' PICKER_PAGE_SIZE }';
/** 该模块的完整导出清单（与 `src/picker-model.js` 末尾的 `export { … }` 逐字相同）。
 *
 *  注意它和上面 `MODEL_API_NAMES` 是**两个不同的面**，别一起改：
 *  - `MODEL_API_NAMES` 是「从内联段落里解构出哪些名字来测」⇒ 需要的是**声明**存在
 *    （`hiddenWallpapers` 在源文件 `:136` 声明、`:163` 主流程自用 ⇒ 必须留在这里）。
 *  - `MODEL_EXPORTS` 是「这个模块对外发布哪些名字」⇒ 收窄导出面时
 *    `hiddenWallpapers` 因零跨模块按名引用被移出 `export { … }`，故这里同步移除；
 *    判据形状不变（导出名集合必须与钉住的清单逐字相等，
 *    多一枚少一枚都判红）。 */
const MODEL_EXPORTS = ['ratingOf', 'matchesRatingFilter', 'matchesTypeFilter', 'matchesOrientationFilter', 'isPlayableType',
  'isRotatableWallpaper', 'keepPlayingWallpaper', 'isRotationEligible', 'isHiddenWallpaper', 'isUploadedWallpaper',
  'isDirWallpaper', 'playableWallpapers', 'pageSlice', 'pickerModel',
  'PICKER_PAGE_SIZE'];

/** 把切出来的段落包进一个函数作用域求值 —— 返回模型 API（纯函数，无需宿主环境）。 */
function evaluateModelSection(section) {
  return new vm.Script('(function () {\n' + section + '\n;return ' + MODEL_API_NAMES + ';})()',
    { filename: 'inlined:src/picker-model.js' }).runInNewContext({});
}

const modelSection = inlinedSection(code, 'src/picker-model.js');
const M = modelSection ? evaluateModelSection(modelSection) : null;

// ══ 用例夹具 ═════════════════════════════════════════════════════════════════
// 十张覆盖六种形态的库存：三种分级 + 未分级、有/无 frameUrl 的场景、playable:false、
// 带/不带分级的自上传、以及 up-dir- 目录项目。
const W = [
  { id: 'v1', title: 'Alpha Video', type: 'video', playable: true, contentrating: 'Everyone', width: 1920, height: 1080 },
  { id: 'v2', title: 'beta video', type: 'video', playable: true, contentrating: 'PG13', width: 1080, height: 1920 },
  { id: 'v3', title: 'Gamma Video', type: 'video', playable: true, contentrating: 'Mature', width: 1000, height: 1000 },
  { id: 'w1', title: 'WEB One', type: 'web', playable: true, contentrating: null },
  { id: 'i1', title: 'Image One', type: 'image', playable: true, contentrating: 'G', width: 3840, height: 2160 },
  { id: 's1', title: 'Scene With Frame', type: 'scene', playable: false, frameUrl: '/frame/s1', contentrating: 'Everyone' },
  { id: 's2', title: 'Scene No Frame', type: 'scene', playable: false, frameUrl: null, contentrating: 'Everyone' },
  { id: 'v4', title: 'Video Four', type: 'video', playable: false, contentrating: 'Everyone' },
  { id: 'up-1', title: 'Upload One', type: 'image', playable: true, width: 720, height: 1280 },
  { id: 'up-dir-2', title: 'Upload Dir', type: 'image', playable: true, contentrating: 'Everyone', width: 2560, height: 1440 },
];
// 30 张额外的可播放视频：把列表推过一页（24）⇒ 分页与页号 clamp 才有得判。
const EXTRA = Array.from({ length: 30 }, (_, i) => ({
  id: 'x' + i, title: 'Extra ' + i, type: 'video', playable: true, contentrating: 'Everyone',
}));
const BIG = W.concat(EXTRA);
const EXTRA_IDS = EXTRA.map((w) => w.id);

const RATING_ALL = ['everyone', 'pg13', 'mature', 'unrated'];
const TYPE_ALL = ['video', 'web', 'image', 'scene'];
const modelInput = (over) => Object.assign({
  wallpapers: W, hiddenIds: [], search: '', ratingFilter: RATING_ALL, typeFilter: TYPE_ALL,
  orientationFilter: 'all', page: 0, hiddenPage: 0, editorPage: 0,
}, over);

// 投影：只挑模型输出的**一部分**来比 —— 投影函数本身也是正负共用的那一份。
const P = {
  playableIds: (m) => m.playableList.map((w) => w.id),
  hiddenIds: (m) => m.hiddenList.map((w) => w.id),
  editorIds: (m) => m.editorList.map((w) => w.id),
  query: (m) => m.query,
  counts: (m) => [m.basePlayable.length, m.ratingCounts, m.typeCounts],
  orientations: (m) => m.orientationCounts,
  sizes: (m) => [m.playableList.length, m.basePlayable.length, m.editorList.length, m.hiddenList.length],
  layout: (m) => [m.normalPage.items.length, m.normalPage.page, m.normalPage.pages],
  hiddenLayout: (m) => [m.hiddenPageView.items.length, m.hiddenPageView.page, m.hiddenPageView.pages],
  emptyShape: (m) => [m.playableList.length, m.basePlayable.length, m.editorList.length,
    m.hiddenList.length, m.normalPage.items.length, m.normalPage.page, m.normalPage.pages],
  zeroHit: (m) => [m.playableList.length, m.normalPage.pages, m.normalPage.items.length, m.basePlayable.length],
};

const ALL_PLAYABLE = ['v1', 'v2', 'v3', 'w1', 'i1', 's1', 'up-1', 'up-dir-2'];

/** 用例表：`over` 是喂给模型的输入（叠在基准输入上），`breakOver` 是**变异输入**。 */
const CASES = [
  { name: '搜索：大写 ALPHA 命中（大小写不敏感）',
    over: { search: 'ALPHA' }, project: P.playableIds, want: ['v1'], breakOver: { search: 'ALPHA!' } },
  { name: '搜索：小写 alpha 与大写命中同一张（大小写不敏感的另一腿）',
    over: { search: 'alpha' }, project: P.playableIds, want: ['v1'], breakOver: { search: 'alpha video x' } },
  { name: '搜索：纯空白 = 空查询 = 不过滤',
    over: { search: '   ' }, project: P.playableIds, want: ALL_PLAYABLE, breakOver: { search: 'One' } },
  { name: '搜索：query 归一化（trim + 小写）随模型出去',
    over: { search: '  Alpha  ' }, project: P.query, want: 'alpha', breakOver: { search: '  Beta ' } },
  { name: '类型过滤：video 只留视频档',
    over: { typeFilter: ['video'] }, project: P.playableIds, want: ['v1', 'v2', 'v3'],
    breakOver: { typeFilter: ['web'] } },
  { name: '类型过滤：scene 只留有静态帧的场景（无 frameUrl 的 s2 不算可播放）',
    over: { typeFilter: ['scene'] }, project: P.playableIds, want: ['s1'],
    breakOver: { typeFilter: ['image'] } },
  { name: '分级勾选：只勾全年龄 ⇒ Everyone/G/宽松分级的自上传（最窄组合）',
    over: { ratingFilter: ['everyone'] }, project: P.playableIds,
    want: ['v1', 'i1', 's1', 'up-1', 'up-dir-2'],
    breakOver: { ratingFilter: ['everyone', 'pg13'] } },
  { name: '分级勾选：全年龄 + PG13 ⇒ 两档都放行（自由组合，不是累积档）',
    over: { ratingFilter: ['everyone', 'pg13'] }, project: P.playableIds,
    want: ['v1', 'v2', 'i1', 's1', 'up-1', 'up-dir-2'],
    breakOver: { ratingFilter: ['everyone'] } },
  { name: '分级勾选：三档都勾 ⇒ 全年龄 + PG13 + 成人',
    over: { ratingFilter: ['everyone', 'pg13', 'mature'] }, project: P.playableIds,
    want: ['v1', 'v2', 'v3', 'i1', 's1', 'up-1', 'up-dir-2'],
    breakOver: { ratingFilter: ['everyone', 'pg13'] } },
  { name: '分级勾选：只勾未分级 ⇒ 只剩没有 contentrating 的 WE 条目',
    over: { ratingFilter: ['unrated'] }, project: P.playableIds, want: ['w1'],
    breakOver: { ratingFilter: RATING_ALL } },
  { name: '分级勾选：只勾成人 ⇒ 纯 R18 用法（Everyone/PG13 一律被挡）',
    over: { ratingFilter: ['mature'] }, project: P.playableIds, want: ['v3'],
    breakOver: { ratingFilter: ['mature', 'everyone'] } },
  { name: '自上传：没写分级 ⇒ 按 Everyone（不会被默认勾选挡掉）',
    over: { ratingFilter: ['everyone'] }, project: (m) => m.playableList.map((w) => w.id).filter((id) => id.startsWith('up-')),
    want: ['up-1', 'up-dir-2'], breakOver: { ratingFilter: ['unrated'] } },
  { name: '方向筛选：横屏只留宽 > 高（正方形 / 未知方向不出现）',
    over: { orientationFilter: 'landscape' }, project: P.playableIds,
    want: ['v1', 'i1', 'up-dir-2'], breakOver: { orientationFilter: 'portrait' } },
  { name: '方向筛选：竖屏只留高 > 宽',
    over: { orientationFilter: 'portrait' }, project: P.playableIds,
    want: ['v2', 'up-1'], breakOver: { orientationFilter: 'landscape' } },
  { name: '方向筛选：全部方向不受影响',
    over: { orientationFilter: 'all' }, project: P.playableIds, want: ALL_PLAYABLE,
    breakOver: { orientationFilter: 'landscape' } },
  { name: '方向筛选只筛可见列表：轮换编辑器成员不变',
    over: { orientationFilter: 'portrait' }, project: P.editorIds, want: ALL_PLAYABLE,
    breakOver: { orientationFilter: 'portrait', typeFilter: ['image'] } },
  { name: '方向计数：横 / 竖 / 未知（正方形与无尺寸都算未知）',
    over: {}, project: P.orientations,
    want: { landscape: 3, portrait: 2, unknown: 3 }, breakOver: { hiddenIds: ['v1'] } },
  { name: '分档计数：与勾选组合无关（底数是可播放 ∧ 未隐藏，按精确档分桶）',
    over: { ratingFilter: RATING_ALL }, project: P.counts,
    want: [8, { everyone: 5, pg13: 1, mature: 1, unrated: 1 }, { video: 3, web: 1, image: 3, scene: 1 }],
    breakOver: { ratingFilter: RATING_ALL, hiddenIds: ['v1'] } },
  { name: '隐藏排除：隐藏项离开可播放网格（其余保持库存顺序）',
    over: { hiddenIds: ['v1', 's1'] }, project: P.playableIds,
    want: ['v2', 'v3', 'w1', 'i1', 'up-1', 'up-dir-2'], breakOver: { hiddenIds: ['v1'] } },
  { name: '隐藏列表：只收隐藏项，且保持库存顺序',
    over: { hiddenIds: ['v1', 's1'] }, project: P.hiddenIds, want: ['v1', 's1'],
    breakOver: { hiddenIds: ['s1'] } },
  { name: '隐藏排除：隐藏项同时离开分档计数的底数',
    over: { hiddenIds: ['v1'] }, project: P.counts,
    want: [7, { everyone: 4, pg13: 1, mature: 1, unrated: 1 }, { video: 2, web: 1, image: 3, scene: 1 }],
    breakOver: { hiddenIds: [] } },
  { name: '分页：38 张可播放 ⇒ 第 1 页 24 张 / 共 2 页',
    over: { wallpapers: BIG }, project: P.layout, want: [24, 0, 2],
    breakOver: { wallpapers: BIG, page: 1 } },
  { name: '分页：第 2 页 14 张（不是每页都满）',
    over: { wallpapers: BIG, page: 1 }, project: P.layout, want: [14, 1, 2],
    breakOver: { wallpapers: BIG, page: 0 } },
  { name: '分页：页号越界 clamp 到末页',
    over: { wallpapers: BIG, page: 99 }, project: P.layout, want: [14, 1, 2],
    breakOver: { wallpapers: BIG, page: 99, search: 'zzz' } },
  { name: '分页：负页号 clamp 到首页',
    over: { wallpapers: BIG, page: -5 }, project: P.layout, want: [24, 0, 2],
    breakOver: { wallpapers: BIG, page: 1 } },
  { name: '分页：隐藏页独立分页（30 张隐藏 ⇒ 24 + 6）',
    over: { wallpapers: BIG, hiddenIds: EXTRA_IDS }, project: P.hiddenLayout, want: [24, 0, 2],
    breakOver: { wallpapers: BIG, hiddenIds: EXTRA_IDS, hiddenPage: 1 } },
  { name: '轮换编辑器列表：不受搜索影响（编辑器没有搜索框）',
    over: { search: 'Alpha' }, project: P.sizes, want: [1, 8, 8, 0],
    breakOver: { search: 'Alpha', hiddenIds: ['v1'] } },
  { name: '空库存：零列表、零计数，但页数仍为 1（不会出现 0 页）',
    over: { wallpapers: [] }, project: P.emptyShape, want: [0, 0, 0, 0, 0, 0, 1],
    breakOver: { wallpapers: W } },
  { name: '零命中：网格空、仍 1 页、底数不变（只有网格受搜索影响）',
    over: { search: 'zzz' }, project: P.zeroHit, want: [0, 1, 0, 8],
    breakOver: { search: '' } },
  { name: '搜索 ∧ 评分过滤叠加：只有同时命中的那张留下',
    over: { search: 'video', ratingFilter: 'everyone' }, project: P.playableIds, want: ['v1'],
    breakOver: { search: 'video', ratingFilter: 'all' } },
];

// ══ 挂载台（与 test/verify-client.mjs 同一套做法）══════════════════════════════
const React = {
  Fragment: 'Fragment',
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  createElement: (type, props, ...children) =>
    (typeof type === 'function' ? type(props || {}) : ({ type, props: props || null, children })),
};

const byId = {};
const sandboxTimers = [];
function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; }, removeProperty(k) { delete this._props[k]; } },
    className: '',
    _parent: null,
    appendChild(c) { this.children.push(c); c._parent = this; if (c.id) byId[c.id] = c; return c; },
    remove() {
      if (this._parent) { const i = this._parent.children.indexOf(this); if (i >= 0) this._parent.children.splice(i, 1); }
      if (this.id) delete byId[this.id];
    },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector() { return null; },
  };
}

const bodyEl = makeEl('body');
const document = {
  createElement: (t) => makeEl(t),
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  head: makeEl('head'),
  body: bodyEl,
};

const localStorage = {
  _store: {}, // 不种选择：默认分级档（Everyone）与空隐藏集合就是起点
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
};

// 库存夹具与 test/verify-client.mjs 同形：30 张合成视频 + a/b（可播放）、c（有帧的场景）、
// d（无帧的场景，不可播放）、e（PG13，默认 Everyone 下被过滤）⇒ 默认状态下 **33 张可播放**。
const WALLPAPERS = [
  ...Array.from({ length: 30 }, (_, i) => ({
    id: 'w' + i, title: 'Wall ' + i, type: 'video', playable: true,
    media: '/wallpaper-engine/media/w' + i, preview: null, contentrating: 'Everyone',
  })),
  { id: 'a', title: 'Video A', type: 'video', playable: true, media: '/wallpaper-engine/media/xyz', preview: null, contentrating: 'Everyone' },
  { id: 'b', title: 'Video B', type: 'video', playable: true, media: '/wallpaper-engine/media/def', preview: null, contentrating: 'Everyone' },
  { id: 'c', title: 'Scene C', type: 'scene', playable: false, media: null, preview: '/wallpaper-engine/preview/ccc', frameUrl: '/wallpaper-engine/scene-frame/ccc', contentrating: 'Everyone' },
  { id: 'd', title: 'Scene D (no frame)', type: 'scene', playable: false, media: null, preview: null, frameUrl: null, contentrating: 'Everyone' },
  { id: 'e', title: 'PG13 E', type: 'web', playable: true, media: '/wallpaper-engine/media/pg', preview: null, contentrating: 'PG13' },
];

const fetch = (url) => {
  const u = String(url);
  if (u.includes('/wallpaper-engine/inventory')) {
    return Promise.resolve({
      status: 200,
      json: () => Promise.resolve({
        installDir: 'D:/we', total: 34, portableCount: 33, playlists: [],
        wallpapers: WALLPAPERS,
      }),
    });
  }
  return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
};

const cap = { handoff: null };
const sandbox = {
  window: {
    __ModuleLoader__: { load: (h) => { cap.handoff = h; } },
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; sandboxTimers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
  },
  document, localStorage, fetch, React,
  setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; sandboxTimers.push(t); return t; },
  clearTimeout: (t) => { if (t) t.cleared = true; },
  setInterval: (fn, ms) => { const t = { fn, ms, cleared: false, interval: true }; sandboxTimers.push(t); return t; },
  clearInterval: (t) => { if (t) t.cleared = true; },
};
vm.createContext(sandbox);
new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox);

const { factory } = cap.handoff;
const requireMock = (spec) => {
  if (spec === 'react') return React;
  if (spec === 'react-dom') return { createPortal: (node) => node }; // 模态框在 mock 里就地渲染
  throw new Error('unexpected require: ' + spec);
};
const exportsObj = factory(requireMock);
// P-D S3c：「壁纸库」页签四节已全部搬进 packages/media-bridge 的浏览器半边 ⇒ 抽屉里的
// 「选择壁纸」/壁纸属性/播放控制等节点只在该产物登记 library 节之后才出现。与真实
// loader 同形，在 apply() **之前**求值该产物（它的 factory 用主 bundle 的显式键集登记四节）。
{
  const wallpaperArtifact = readFileSync(
    new URL('../packages/media-bridge/lib/client.media-bridge.js', import.meta.url), 'utf8');
  const subHandoffs = [];
  const savedLoader = sandbox.window.__ModuleLoader__;
  sandbox.window.__ModuleLoader__ = { load: (h) => { subHandoffs.push(h); } };
  new vm.Script(wallpaperArtifact, { filename: 'client.media-bridge.js' }).runInContext(sandbox);
  sandbox.window.__ModuleLoader__ = savedLoader;
  if (subHandoffs.length !== 1) {
    throw new Error('wallpaper 浏览器半边必须恰好注册一份 bundle（实际 ' + subHandoffs.length + ' 份）');
  }
  const wallpaperExports = subHandoffs[0].factory((spec) => (
    spec === 'dsh-plugin-wallpaper-engine' ? exportsObj : requireMock(spec)
  ));
  if (typeof wallpaperExports.apply !== 'function') throw new Error('wallpaper 浏览器半边必须导出 apply');
}

const pickerRenders = [];
const slots = {
  inject: (key, cb) => cb(),
  register: (opts, render) => { pickerRenders.push(render); },
};
// ctx.effect 立刻执行（与 fiber 首次提交同序），否则订阅没挂上、emit() 不重渲染。
const ctx = { slots, effect(fn) { fn(); return fn; } };
exportsObj.apply(ctx);

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const render = () => pickerRenders[0]();


/** className 里带某个**令牌**的节点。 */
function findByClass(root, cls) {
  let hit = null;
  (function walk(n) {
    if (hit) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const c = typeof (n.props && n.props.className) === 'string' ? n.props.className : '';
    if (c.split(/\s+/).includes(cls)) { hit = n; return; }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  })(root);
  return hit;
}

// ══ 检查 ═════════════════════════════════════════════════════════════════════
let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else { failures++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
};

console.log('0. 挂载台 / 模型段自检');
{
  check('模型已由 build-client 内联进产物（marker 段可从 lib/client.js 切出）',
    modelSection !== null, modelSection ? modelSection.split('\n').length + ' 行段落' : '(切不出)');
  check('负对照：未登记的合成文件名切不出段落（同一条切片判据）',
    inlinedSection(code, 'src/picker-model-nope.js') === null);
  // 分段标记的**来源**要有牙：构建脚本换文案时跟着换（手抄字面量会切不出），且缺失时不静默放行。
  check('覆盖面：两条分段标记都从 `scripts/build-client.mjs` 现取到了（防空手抄 / 防静默 null）',
    SECTION_MARKERS.inline !== null && SECTION_MARKERS.body !== null,
    JSON.stringify(SECTION_MARKERS));
  check('负对照：构建脚本换了标记文案 ⇒ 现取方案照样切得出（同一条切片判据，喂合成构建脚本）',
    (() => {
      // ⚠️ 合成文本里的路径**不许写成字面量**：`guard-targets` 按路径字面量派生"守卫 ↔ 模块"映射，
      //    写死 `src/client.js` 会让本文件被算成"管了那个模块"（GUARD-MAP 会多一行假目标，实测踩过）。
      const m2 = sectionMarkers("const a = '// ── 内联模块：';\nconst b = '// ── 客户端正文（" + ['src', 'client.js'].join('/') + "）';\n");
      if (!m2.inline || !m2.body) return false;
      const bundle2 = m2.inline + 'src/picker-model.js\nconst probe = 1;\n' + m2.body + '\n';
      const sec = inlinedSection(bundle2, 'src/picker-model.js', m2);
      return sec !== null && sec.includes('const probe = 1;') && !sec.includes('客户端正文');
    })());
  check('负对照：散文注释里长得像标记的 `// ── X：` 不会劫持现取（只有发射点算数）',
    (() => {
      const m2 = sectionMarkers('// ── 散文标签：这不是发射点\n'
        + 'const a = `// ── 内联模块：${mod.file}`;\n'
        + "const b = '// ── 客户端正文（x）';\n");
      return m2.inline === '// ── 内联模块：' && m2.body === '// ── 客户端正文（';
    })());
  check('负对照：构建脚本里没有分段标记时返回 null（判据不静默放行一个空段落）',
    inlinedSection('anything', 'src/picker-model.js', sectionMarkers('const a = 1;')) === null);
  check('模型 API 齐全（函数都在、PICKER_PAGE_SIZE 是数字）——否则后面每条都在空跑',
    !!M && hasModelApi(M));
  check('负对照：空对象被同一条「API 齐全」判据判为不齐',
    !hasModelApi({}));
  check('模型段是纯的：源码里没有 selection / emit / setSetting / DOM / fetch / require / import',
    isPureModelSource(modelSection || ''));
  check('负对照：塞进 `return selection.hiddenIds;` 的同类源码被同一条判据判为不纯（判据有牙）',
    !isPureModelSource('function probe() { return selection.hiddenIds; }'));
  check('每页 24 张（PICKER_PAGE_SIZE）',
    callsTo(() => M.PICKER_PAGE_SIZE, [], 24));
  check('负对照：同一个取值判据对 25 判为假（数字不是恒真）',
    !callsTo(() => M.PICKER_PAGE_SIZE, [], 25));
  if (!M) { console.log('\n模型段不可用（上面已判红），后续检查无法进行'); process.exit(1); }
}

console.log('\n1. 用例表：模型的判定 / 派生 / 分页（每行都配一条变异输入的负对照）');
for (const c of CASES) {
  const got = M.pickerModel(modelInput(c.over));
  check(c.name, projectsTo(got, c.project, c.want),
    JSON.stringify(c.project(got)));
  const broken = M.pickerModel(modelInput(c.breakOver));
  check('负对照（' + c.name + '）：换掉该项输入后，同一条判据判为不一致',
    !projectsTo(broken, c.project, c.want), JSON.stringify(c.project(broken)));
}

console.log('\n2. 直接 import 的源模块 vs 产物里那段内联副本（双通道对拍）');
// 为什么这条值得存在：上面每一行判的都是**产物里那段**（R1：浏览器半边隔着产物）。
// `src/picker-model.js` 原本没有 `export {}`，于是「直接 import 源模块」这条最便宜的路
// 根本不存在 —— 全仓只有本守卫要写 `inlinedSection()` 去切字符串。加上导出块之后，
// 这里把两条通道**对拍**：既证明内联副本 == 源模块（构建保真），也证明导出接口是活的
// （守着导出的名字，而不是守着一份手抄的 API 清单）。
// 直接用 `URL` 的 `href`（Windows 上 `pathToFileURL(...).pathname` 会拼出 `/D:/…` ⇒ ERR_MODULE_NOT_FOUND）
const MODEL_PATH = new URL('../src/picker-model.js', import.meta.url);
{
  const srcMod = await import(MODEL_PATH.href);
  check('src/picker-model.js 的导出接口齐全（导出清单 == 本文件钉住的 API 面）',
    MODEL_EXPORTS.every((n) => srcMod[n] !== undefined)
    && Object.keys(srcMod).sort().join() === MODEL_EXPORTS.slice().sort().join(),
    '导出 ' + Object.keys(srcMod).length + ' 个：' + Object.keys(srcMod).sort().join(','));
  check('负对照：同一个「导出接口齐全」判据对缺一项的模块判为不齐（判据不是恒真）',
    !MODEL_EXPORTS.every((n) => ({ ...srcMod, pickerModel: undefined })[n] !== undefined));

  // 产物那段 vs 源模块：**逐用例对拍**同一投影 —— 两条通道必须给同一份答案。
  for (const c of CASES) {
    check('对拍（' + c.name + '）：产物内联副本与直接 import 的源模块给出同一份投影',
      projectsTo(M.pickerModel(modelInput(c.over)), c.project, c.want)
      && projectsTo(srcMod.pickerModel(modelInput(c.over)), c.project, c.want),
      'bundle=' + JSON.stringify(c.project(M.pickerModel(modelInput(c.over))))
      + ' src=' + JSON.stringify(c.project(srcMod.pickerModel(modelInput(c.over)))));
  }
}

// ══ 「判据有牙」的自足证明 ═══════════════════════════════════════════════════
// 把源模块**真变异**一次（用同一份源码文本，不经磁盘），断言判据在变异体上会失败。
// 这条不依赖"临时改坏源文件"那种不可留仓库的手法 —— 证明是自足、可重复的。
{
  const srcText = readFileSync(MODEL_PATH, 'utf8');
  const mutated = stripExportBlocks(srcText).replace('const PICKER_PAGE_SIZE = 24', 'const PICKER_PAGE_SIZE = 25');
  check('变异探针前置：源模块里确实有可替换的那一行（否则下面的证明是空转）',
    mutated !== stripExportBlocks(srcText));
  if (mutated !== stripExportBlocks(srcText)) {
    const Mmut = evaluateModelSection(mutated);
    check('negative control: 把「每页 24 张」变异成 25，同一条判据当场判出（直接 import 通道有牙）',
      !slicesTo(Mmut, EXTRA, 0, [24, 0, 2]) && !callsTo(() => Mmut.PICKER_PAGE_SIZE, [], 24),
      '变异体 PICKER_PAGE_SIZE=' + Mmut.PICKER_PAGE_SIZE);
    check('positive control: 未变异的同一份源码在**同一条**判据下通过（不是"改了就说错"）',
      slicesTo(evaluateModelSection(stripExportBlocks(srcText)), EXTRA, 0, [24, 0, 2]));
  }
}

console.log('\n3. 直调判定：六个谓词 + 两个过滤助手（负对照喂变异实参）');
{
  check('ratingOf：自上传没写分级 ⇒ everyone', callsTo(M.ratingOf, [W[8]], 'everyone'));
  check('负对照：同一条判据对「未分级的 WE 条目」判为不是 everyone',
    !callsTo(M.ratingOf, [W[3]], 'everyone'));
  check('ratingOf：没有 contentrating 的 WE 条目 ⇒ unrated', callsTo(M.ratingOf, [W[3]], 'unrated'));
  check('负对照：同一条判据对「G」判为不是 unrated',
    !callsTo(M.ratingOf, [W[4]], 'unrated'));
  check('isPlayableType：有 frameUrl 的场景算可播放（静态帧）', callsTo(M.isPlayableType, [W[5]], true));
  check('负对照：同一条判据对「无 frameUrl 的场景」判为假',
    !callsTo(M.isPlayableType, [W[6]], true));
  check('isPlayableType：playable:false 的视频不算可播放', callsTo(M.isPlayableType, [W[7]], false));
  check('负对照：同一条判据对 playable:true 的视频判为不是假',
    !callsTo(M.isPlayableType, [W[0]], false));
  check('isRotatableWallpaper：PG13 在 everyone 档下不可轮换',
    callsTo(M.isRotatableWallpaper, [W[1], 'everyone', 'all'], false));
  check('负对照：同一张在 pg13 档下可轮换（判据对入参敏感，不是恒假）',
    !callsTo(M.isRotatableWallpaper, [W[1], 'everyone', 'all'], true));
  check('isRotatableWallpaper：unrated 的 web 在 unrated/web 档下可轮换',
    callsTo(M.isRotatableWallpaper, [W[3], 'unrated', 'web'], true));
  check('负对照：同一张在 unrated/video 档下不可轮换（类型档真的参与判定）',
    !callsTo(M.isRotatableWallpaper, [W[3], 'unrated', 'video'], true));
  check('isHiddenWallpaper：在隐藏集合里 ⇒ true',
    callsTo(M.isHiddenWallpaper, ['v1', ['v1']], true));
  check('负对照：空隐藏集合下同一 id ⇒ 不是 true',
    !callsTo(M.isHiddenWallpaper, ['v1', []], true));
  check('isHiddenWallpaper：空 id 永远不算隐藏（Boolean(id) 守卫）',
    callsTo(M.isHiddenWallpaper, ['', ['']], false));
  check('负对照：非空且在册的 id 不是 false（守卫只挡空 id）',
    !callsTo(M.isHiddenWallpaper, ['x', ['x']], false));
  check('isUploadedWallpaper：up-1 是上传', callsTo(M.isUploadedWallpaper, [W[8]], true));
  check('负对照：普通 WE 条目（v1）不是上传', !callsTo(M.isUploadedWallpaper, [W[0]], true));
  // 前缀判定的**重叠**是既有行为：`up-dir-2` 也命中 `up-` ⇒ 上传管理列表必须再排除目录项目
  // （client.js 的 `isUploadedWallpaper(w) && !isDirWallpaper(w)`）。这条把它钉住，防止有人
  // 把前缀判成互斥时静默改变上传计数。
  check('isUploadedWallpaper：up-dir-2 同样命中 up- 前缀（重叠是既有行为）',
    callsTo(M.isUploadedWallpaper, [W[9]], true));
  check('负对照：同一条判据对空 id 判为不是上传',
    !callsTo(M.isUploadedWallpaper, [{ id: '' }], true));
  check('isDirWallpaper：up-dir-2 是目录项目', callsTo(M.isDirWallpaper, [W[9]], true));
  check('负对照：up-1 不是目录项目', !callsTo(M.isDirWallpaper, [W[8]], true));
  check('matchesRatingFilter：四档全勾放行一切（含未分级）',
    callsTo(M.matchesRatingFilter, [W[3], RATING_ALL], true));
  check('matchesRatingFilter：旧档字符串 all 读作四档全勾（旧存档读兜底）',
    callsTo(M.matchesRatingFilter, [W[3], 'all'], true));
  // 多档勾选（用户拍板 2026-10-30 / 在 #294 之后再次协商）：勾上的档才放行，**自由组合**，
  // 不再强制累积 —— 只勾「成人」是合法的纯 R18 用法，只勾 everyone 也不会顺手放行 PG13。
  check('matchesRatingFilter：只勾 everyone ⇒ 放行 Everyone',
    callsTo(M.matchesRatingFilter, [W[0], ['everyone']], true));
  check('负对照：只勾 everyone ⇒ PG13 被拒绝',
    !callsTo(M.matchesRatingFilter, [W[1], ['everyone']], true));
  check('matchesRatingFilter：勾上 PG13 后放行 PG13',
    callsTo(M.matchesRatingFilter, [W[1], ['everyone', 'pg13']], true));
  check('负对照：勾 everyone+pg13 仍挡成人',
    !callsTo(M.matchesRatingFilter, [W[2], ['everyone', 'pg13']], true));
  check('matchesRatingFilter：只勾成人 ⇒ 放行 Mature（纯 R18 用法）',
    callsTo(M.matchesRatingFilter, [W[2], ['mature']], true));
  check('负对照：只勾成人 ⇒ Everyone 被挡（自由组合，不是累积上限）',
    !callsTo(M.matchesRatingFilter, [W[0], ['mature']], true));
  check('matchesRatingFilter：只勾未分级 ⇒ 放行未分级',
    callsTo(M.matchesRatingFilter, [W[3], ['unrated']], true));
  check('负对照：只勾未分级 ⇒ Everyone 被挡',
    !callsTo(M.matchesRatingFilter, [W[0], ['unrated']], true));
  check('负对照：空勾选集合 fail-closed（既不全放行、也不静默取默认）',
    !callsTo(M.matchesRatingFilter, [W[0], []], true));
  check('负对照：null 入参 ⇒ false', !callsTo(M.matchesRatingFilter, [W[0], null], true));
  check('负对照：未知档位 fail-closed（不放行任何人）',
    !callsTo(M.matchesRatingFilter, [W[0], 'pg-18'], true));
  check('负对照：数组里的未知档位被消毒掉后为空 ⇒ fail-closed',
    !callsTo(M.matchesRatingFilter, [W[0], ['pg-18']], true));
  check('matchesRatingFilter：旧存档的字符串档位按等价集合读（mature ⇒ 三档）',
    callsTo(M.matchesRatingFilter, [W[1], 'mature'], true));
  check('负对照：旧字符串 mature 仍挡未分级（未分级是独立档）',
    !callsTo(M.matchesRatingFilter, [W[3], 'mature'], true));
  // 轮播成员 / 「下一张」的入选判据（用户拍板 2026-10-30 / issue #294）：只认「内容安全 ∧
  // 可播放」，**不认类型档**；与 keepPlayingWallpaper 同源（二级封装，单一真源）。
  check('isRotationEligible：分级放行 ∧ 可播放 ⇒ true',
    callsTo(M.isRotationEligible, [W[0], RATING_ALL], true));
  check('负对照：勾选集合里没有它的档 ⇒ false（只勾 everyone 挡 PG13）',
    callsTo(M.isRotationEligible, [W[1], ['everyone']], false));
  check('负对照：不可播放类型 ⇒ false（不是只看分级）',
    callsTo(M.isRotationEligible, [W[7], RATING_ALL], false));
  check('负对照：null ⇒ false', callsTo(M.isRotationEligible, [null, RATING_ALL], false));
  check('isRotationEligible 只收两个入参（类型档不得入内）',
    M.isRotationEligible.length === 2);
  check('matchesTypeFilter：类型一致 ⇒ true', callsTo(M.matchesTypeFilter, [W[0], 'video'], true));
  check('负对照：换成别的类型档 ⇒ 不是 true',
    !callsTo(M.matchesTypeFilter, [W[0], 'web'], true));
  // 「正在应用的壁纸」判据（keepPlayingWallpaper）：**没有类型档入参**就是语义本身 ——
  // 类型档只筛列表与轮播候选，切过滤档不得把当前壁纸干掉（用户口径）。
  check('keepPlayingWallpaper：可播 + 分级放行 ⇒ true（类型档不参与播放闸门）',
    callsTo(M.keepPlayingWallpaper, [W[0], RATING_ALL], true));
  check('keepPlayingWallpaper：勾上成人时 Everyone 照旧可播（它也在勾选里）',
    callsTo(M.keepPlayingWallpaper, [W[0], ['everyone', 'mature']], true));
  check('负对照：分级闸门仍在 —— 只勾 everyone 时 PG13 被拒',
    !callsTo(M.keepPlayingWallpaper, [W[1], ['everyone']], true));
  check('keepPlayingWallpaper：不可播放的条目照旧拒（v4 playable:false）',
    !callsTo(M.keepPlayingWallpaper, [W[7], RATING_ALL], true));
  check('pageSlice：30 张 / 每页 24 ⇒ 第 1 页 24 张、共 2 页',
    slicesTo(M, EXTRA, 0, [24, 0, 2]));
  check('负对照：翻到第 2 页后同一条判据不再给出第 1 页的形状',
    !slicesTo(M, EXTRA, 1, [24, 0, 2]));

  // 分级白名单在「持久化消毒」（lib/settings-schema.js 的 RATING_TIER_VALUES）与「判定」
  // （src/picker-model.js 的 RATING_TIERS）各有一份字面量：必须逐字同序。两边各自都不报错，
  // 一旦漂移就是「存进去的档判定不认识」（勾了却永远不出现）—— 只能靠文本对账钉住。
  const tierList = (src, name) => {
    const m = new RegExp('const ' + name + ' = \\[([^\\]]*)\\]').exec(src);
    return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
  };
  const schemaSrc = readFileSync(new URL('../lib/settings-schema.js', import.meta.url), 'utf8');
  const pickerSrc = readFileSync(MODEL_PATH, 'utf8');
  const schemaTiers = tierList(schemaSrc, 'RATING_TIER_VALUES');
  const modelTiers = tierList(pickerSrc, 'RATING_TIERS');
  check('分级白名单：schema（持久化消毒）与 model（判定）逐字同序',
    Array.isArray(schemaTiers) && schemaTiers.length === 4
    && JSON.stringify(schemaTiers) === JSON.stringify(modelTiers),
    JSON.stringify([schemaTiers, modelTiers]));
  check('负对照：把 model 那份白名单换个顺序 ⇒ 同一条判据判出差异',
    JSON.stringify(tierList(pickerSrc.replace(
      "const RATING_TIERS = ['everyone', 'pg13', 'mature', 'unrated'];",
      "const RATING_TIERS = ['pg13', 'everyone', 'mature', 'unrated'];"), 'RATING_TIERS'))
    !== JSON.stringify(schemaTiers));
}

console.log('\n3. 跨层对拍：模型算出的当页卡片数 == 真实渲染的 .we-picker__card 数（减关闭卡）');
await sleep(80); // 等 loadPersisted → loadInventory → revalidateSelection 这条启动链落定
{
  check('挂载：settings.section 注册了 picker 渲染回调（否则以下判据全部空转）',
    hasPickerRender(pickerRenders), 'render 回调 ' + pickerRenders.length + ' 个');
  check('负对照：空渲染回调列表被同一条判据判为未注册', !hasPickerRender([]));
  const panelTree = render();
  let openBtn = null;
  (function walk(n) {
    if (openBtn) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (n.type === 'button' && Array.isArray(n.children) && n.children.length === 1
      && n.children[0] === '选择壁纸') { openBtn = n; return; }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  })(panelTree);
  check('跨层：找得到「选择壁纸」入口（找不到时下面每条都在空跑）', !!openBtn);
  if (!openBtn) { console.log('\n找不到模态框入口（上面已判红），跨层对拍无法进行'); process.exit(1); }
  openBtn.props.onClick();
  let tree = render();

  // 模型的入参**从渲染出的 UI 读**（不给默认档写死值）：类型档取 select 的当前值，
  // 分级取下拉里勾中的档位（多档勾选，v7 起是数组），搜索词取搜索框的值。这样
  // "两边看的是不是同一份状态"本身也被判住。
  /** 下拉里的全部勾选框（分级与类型共用同一套 DOM 类名；vdom 里始终在，不依赖 <details>）。 */
  const allCheckboxes = (root) => {
    const out = [];
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      if (n.type === 'input' && n.props && n.props.className === 'we-picker__rating-check') out.push(n);
      if (Array.isArray(n.children)) n.children.forEach(walk);
    })(root);
    return out;
  };
  const ratingCheckboxes = (root) => allCheckboxes(root)
    .filter((n) => RATING_ALL.indexOf(n.props.value) !== -1);
  const ratingAllowFromUi = (root) => ratingCheckboxes(root)
    .filter((n) => n.props.checked).map((n) => n.props.value);
  /** 类型下拉里的 4 个勾选框（与分级同一套 DOM 类名，按 value 区分域）。 */
  const typeCheckboxes = (root) => allCheckboxes(root)
    .filter((n) => TYPE_ALL.indexOf(n.props.value) !== -1);
  const typeAllowFromUi = (root) => typeCheckboxes(root)
    .filter((n) => n.props.checked).map((n) => n.props.value);
  const searchValue = (root) => {
    const i = findByClass(root, 'we-picker__search');
    return i ? i.props.value : null;
  };
  const modelFromUi = (root, over) => M.pickerModel(Object.assign({
    wallpapers: WALLPAPERS,
    hiddenIds: [], // 起点没有隐藏项（localStorage 未种选择）
    search: searchValue(root),
    ratingFilter: ratingAllowFromUi(root),
    typeFilter: typeAllowFromUi(root),
    page: 0, hiddenPage: 0, editorPage: 0,
  }, over));

  const ratingChecks = ratingCheckboxes(tree);
  const typeChecks = typeCheckboxes(tree);
  check('跨层：分级 4 个勾选框 + 类型 4 个勾选框都在（模型入参从它们读）',
    ratingChecks.length === 4 && typeChecks.length === 4,
    '分级勾选=' + ratingChecks.length + ' / 类型勾选=' + typeChecks.length
    + ' 已勾=' + JSON.stringify(ratingAllowFromUi(tree)) + ' 类型=' + JSON.stringify(typeAllowFromUi(tree)));
  check('跨层：类型默认四档全勾（DEFAULTS 的 allow-set 与 UI 勾选态一致）',
    JSON.stringify(typeAllowFromUi(tree)) === JSON.stringify(TYPE_ALL), JSON.stringify(typeAllowFromUi(tree)));
  check('跨层：默认只勾「全年龄」（DEFAULTS 的 allow-set 与 UI 勾选态一致）',
    JSON.stringify(ratingAllowFromUi(tree)) === '["everyone"]', JSON.stringify(ratingAllowFromUi(tree)));

  // ── 状态 A：未过滤的虚拟首窗（默认 Everyone 档、无搜索、无隐藏）──
  const modelA = modelFromUi(tree);
  check('跨层（未过滤首窗）：模型算出的可播放数 == 首窗渲染的壁纸卡片数',
    crossLayerAgrees(tree, modelA),
    '模型 ' + modelA.playableList.length + ' 张 / 渲染 ' + renderedCardCount(tree)
    + '（首窗容量 ' + PICKER_VP_FIRST + ' 含关闭卡）');
  // 变异方向有讲究：33→32 仍在钳制区（窗口容量没变，判据不会动）；必须砍到
  // 首窗容量以下，期望卡数才会真的变。
  check('负对照：把模型的可播放数砍到首窗以下（变异输入）后，同一条判据判为不一致',
    !crossLayerAgrees(tree, Object.assign({}, modelA,
      { playableList: modelA.playableList.slice(0, 10) })));
  check('跨层（未过滤首窗）：绝对锚点 = 渲染 29 张壁纸卡 + 关闭卡（33 张可播放 > 首窗，防"空对空"）',
    renderedCardCount(tree) === 29 && collectCards(tree).length === 30
    && modelA.playableList.length === 33,
    '壁纸卡 ' + renderedCardCount(tree) + ' / 总卡 ' + collectCards(tree).length
    + ' / 模型 ' + modelA.playableList.length);
  check('负对照：首窗判据对"多一张"判为假（数字不是恒真）',
    renderedCardCount(tree) !== 30);
  check('跨层（模型层）：库模型仍提供分页切片（轮换编辑器在用），锚点 = 24 张 / 2 页',
    pageIs(modelA, 24, 2), '页数 ' + modelA.normalPage.pages);
  check('负对照：把当页切片清空后，同一条锚点判据判为假',
    !pageIs(Object.assign({}, modelA,
      { normalPage: Object.assign({}, modelA.normalPage, { items: [] }) }), 24, 2));

  // ── 状态 B：一个能落到单页的搜索结果 ──
  const SEARCH_TEXT = 'Wall 3';
  const searchBox = findByClass(tree, 'we-picker__search');
  check('跨层：搜索框存在且可输入（否则第二个状态不可达）',
    !!searchBox && typeof searchBox.props.onInput === 'function');
  searchBox.props.onInput({ target: { value: SEARCH_TEXT } });
  tree = render();
  const modelB = modelFromUi(tree);
  check('跨层（搜索结果）：模型仍给出分页形状（1 张 / 1 页）',
    modelB.normalPage.items.length === 1 && modelB.normalPage.pages === 1,
    '命中 ' + modelB.playableList.length + ' 张 / 页数 ' + modelB.normalPage.pages);
  check('跨层（搜索结果）：模型算出的可播放数 == 渲染出的壁纸卡片数（整窗只画命中项）',
    crossLayerAgrees(tree, modelB),
    '模型 ' + modelB.playableList.length + ' / 渲染 ' + renderedCardCount(tree));
  check('负对照：把模型的搜索词换成空串（变异输入）后，同一条判据判为不一致',
    !crossLayerAgrees(tree, modelFromUi(tree, { search: '' })));
}

// #255③：库视图第一张「关闭」卡在有壁纸时是**暂停/继续**（保留当前画面），不是清空壁纸。
{
  const pickerSrc = readFileSync(new URL('../src/picker-modal.js', import.meta.url), 'utf8');
  const clientSrc = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const closeCardShape = (t) => {
    const m = /function renderPickerCloseCard\(ctx\) \{[\s\S]*?\n {2}\}/.exec(t);
    if (!m) return null;
    const body = m[0];
    return {
      toggle: body.includes('onTogglePlay'),
      labels: body.includes('⏸ 暂停') && body.includes('▶ 播放'),
      fallback: body.includes('closePicker'),
    };
  };
  const shape = closeCardShape(pickerSrc);
  check('#255③ 关闭卡有壁纸时走 pause/resume（onTogglePlay + 两种文案），无壁纸才回退 closePicker',
    Boolean(shape && shape.toggle && shape.labels && shape.fallback), JSON.stringify(shape));
  const oldBody = pickerSrc.replace(/function renderPickerCloseCard\(ctx\) \{[\s\S]*?\n {2}\}/,
    'function renderPickerCloseCard(ctx) {\n    const { sel, onClear } = ctx;\n    return React.createElement("div", { onClick: onClear, title: weT("关闭壁纸") });\n  }');
  check('#255③ negative control: 旧「直接 onClear」实现会被同一判据判红',
    closeCardShape(oldBody) !== null && !closeCardShape(oldBody).toggle);
  check('#255③ picker ctx forwards onTogglePlay（否则回落分支会把暂停静默变成清空）',
    /onClear, onTogglePlay, onRatingToggle/.test(clientSrc));
}

console.log('');
console.log(failures === 0 ? 'ALL PICKER MODEL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
