/**
 * picker-model.js — 壁纸选择器的**模型层**：过滤判定 + 派生数据 + 分页切片。
 *
 * 为什么单独一个文件：过滤谓词、派生数据与分页切片是**同一套语义**（什么算可播放 /
 * 什么被过滤掉 / 每页几张），并且被网格、两个下拉的计数、隐藏页、轮换编辑器与选择校验共用。
 * 把它们留在组件里，改一处过滤就要同时摸五处，天然会长出第二个真源。
 * 因此组件体只做「取 state → 调模型 → 画」，模型可以脱离 DOM 与 React 单测。
 *
 * 契约（构建期由 scripts/build-client.mjs 内联进 bundle 的工厂作用域，"外部作用域"=
 * 同一 prelude / src/client.js 的顶层）：
 *   · **纯函数 + 显式入参**：不读 `selection`、不读任何模块级可变状态 —— 隐藏集合与两个
 *     过滤档都从入参进。同一份输入永远得到同一份输出，"什么被过滤掉"不再隐含在全局里。
 *   · **零 DOM / 零 emit / 零 setSetting / 零定时器 / 零 fetch**：本层的产物是数据，
 *     不是副作用。写设置、落盘与重渲染都是调用点（client.js / media-prep.js）的职责。
 *   · **浏览器安全**：无 import / require / Node API。
 *   · **不得有顶层可执行语句**：本文件被内联到 bundle 顶部，顶层读 client.js 的 `const`
 *     会撞 TDZ；顶层只放函数声明与纯常量（两条正则 + 每页张数）。
 *
 * API：
 *   `pickerModel(input)` —— input：
 *     · `wallpapers`    库存数组（`selection.inventory.wallpapers`）
 *     · `hiddenIds`     隐藏集合（`selection.hiddenIds`）；缺省视作空集合
 *     · `search`        搜索原文（缺省 / 空串 = 不过滤；内部 trim + 小写）
 *     · `ratingFilter`  内容分级档（`"all" | "everyone" | "pg13" | "mature" | "unrated"`）
 *     · `typeFilter`    类型档（`"all" | "video" | "web" | "image" | "scene"`）
 *     · `page` / `hiddenPage` / `editorPage`  各列表的页号（可越界，内部 clamp）
 *   返回：
 *     · `query`          归一化后的查询串（`""` = 不过滤）—— 视图的"没有匹配「…」"空态
 *                        也按同一份归一化结果判分支，所以它随模型一起出去，不再让调用点
 *                        抄一遍 trim + toLowerCase
 *     · `playableList`   网格列表：可轮换 ∧ 未隐藏 ∧ 标题命中搜索
 *     · `basePlayable`   两个下拉计数的底数：可播放类型 ∧ 未隐藏（**不含**搜索与两级过滤）
 *     · `ratingCounts`   `{ everyone, pg13, mature, unrated }`，`basePlayable` 的单遍聚合
 *     · `typeCounts`     `{ video, web, image, scene }`，同上
 *     · `editorList`     轮换编辑器候选：可轮换 ∧ 未隐藏（不受搜索影响）
 *     · `hiddenList`     已隐藏列表（保持库存顺序）
 *     · `normalPage` / `hiddenPageView` / `editorPageView`
 *                        依次为 `playableList` / `hiddenList` / `editorList` 的当页切片
 *   每个 page view = `{ items, page, pages }`：`pages >= 1`，`page` 已 clamp 到 `[0, pages-1]`
 *   （列表缩短时页号自动回落，调用点不必自己纠偏）。
 *
 *   `pageSlice(list, page)`、`playableWallpapers(...)`、`hiddenWallpapers(...)` 与六个判定
 *   谓词各自也是本模块的公开入口（调用点按需直取，不必绕 `pickerModel`）。
 *
 * **哪些东西不属于本层**：
 *   · 「✕ 关闭」卡由**视图**渲染（它是网格里的一张卡，但不是任何列表的元素）；
 *   · 分页器的「上一页 / 下一页」那一行（`pagerRow`）是视图；
 *   · 隐藏 / 恢复 / 落盘 / 页号改写是处理器的事，本层只读入参里的页号、不回写。
 */

// ── 内容分级：复刻 Wallpaper Engine 自己的分类（project.json `contentrating`）────
// "Everyone" (G) / "PG13" / "Mature" (R)；没有该字段的项目算「未分级」。匹配大小写
// 不敏感并接受常见拼写，好让别的本地副本行为一致。
const ADULT_RATING_PATTERN = /^(mature|adult|adultonly|18\+|r18)$/i;
const PG13_RATING_PATTERN = /^(pg13|pg-13|pg ?13|questionable)$/i;

function isUploadedWallpaper(w) {
  return Boolean(w && w.id && w.id.indexOf("up-") === 0);
}

// 存储位置里的 WE 项目目录（project.json + scene.pkg/…，id 前缀 up-dir-）。与单文件
// 上传同属「用户自己的内容」（ratingOf 的宽松分级、隐藏/轮转都适用），但不是「上传」、
// 也没有可移除的文件（/remove 只解析 up-*.ext）——上传管理列表与计数须把它们排除，
// 否则会出现点「移除」却删不掉的幽灵条目。
function isDirWallpaper(w) {
  return Boolean(w && w.id && w.id.indexOf("up-dir-") === 0);
}

function ratingOf(w) {
  const rating = typeof w.contentrating === "string" ? w.contentrating.trim() : "";
  // 自上传壁纸没有标注分级时按 Everyone 处理（#84）。用户自己的文件不该被默认的
  // 「Everyone」过滤挡在门外 —— uploads/.meta.json 从不写 contentrating，把这种条目
  // 算成「未分级」会让默认过滤下所有自上传壁纸既不出现在网格里，也无法被选中：
  // 上传接口自动应用新 id 时 applySelection 直接拒绝，壁纸层空白、播放按钮因
  // !sel.url 变灰 —— 表现就是「视频壁纸不能播放，也没有继续按钮」。显式写了
  // G / PG13 / R 的照读（#77），成人内容依然会被过滤。
  if (!rating) return isUploadedWallpaper(w) ? "everyone" : "unrated";
  if (/^(everyone|general|g)$/i.test(rating)) return "everyone";
  if (PG13_RATING_PATTERN.test(rating)) return "pg13";
  if (ADULT_RATING_PATTERN.test(rating)) return "mature";
  return "unrated";
}

function matchesRatingFilter(w, filter) {
  if (filter === "all") return true;
  return ratingOf(w) === filter;
}

function matchesTypeFilter(w, filter) {
  if (filter === "all") return true;
  return w.type === filter;
}

function isPlayableType(w) {
  // "image" = user-uploaded still image (custom uploads, id prefix "up-").
  // "scene" = WE scene wallpaper — usable as a still image when the host served
  // a frameUrl (a GPU frame the live render page backfilled, or the user-imported
  // custom frame; there is no texture extraction).
  if (!w) return false;
  if (w.playable && (w.type === "video" || w.type === "web" || w.type === "image")) return true;
  return w.type === "scene" && Boolean(w.frameUrl);
}

function isRotatableWallpaper(w, ratingFilter, typeFilter) {
  return isPlayableType(w) && matchesRatingFilter(w, ratingFilter) && matchesTypeFilter(w, typeFilter);
}

// 「正在应用的壁纸可以继续播」判据：可播放 ∧ 分级闸门，**不过滤类型**。过滤档分两种
// 效力 —— 分级是内容闸门（拦播放），类型档只筛列表与轮播候选（快捷面板与设置页**共用
// 同一个 `typeFilter`**）；把类型档写进播放闸门就会出现「一切过滤档，正在播的壁纸被干掉」。
function keepPlayingWallpaper(w, ratingFilter) {
  return Boolean(w) && isPlayableType(w) && matchesRatingFilter(w, ratingFilter);
}

function isHiddenWallpaper(id, hiddenIds) {
  return Boolean(id) && hiddenIds.includes(id);
}

// 每页张数：大库存不能一次渲染全部卡片（每次 emit 几百张缩略图会让选择器卡住）。
const PICKER_PAGE_SIZE = 24;

function pageSlice(list, page) {
  const pages = Math.max(1, Math.ceil(list.length / PICKER_PAGE_SIZE));
  const p = Math.min(Math.max(0, page | 0), pages - 1);
  return { items: list.slice(p * PICKER_PAGE_SIZE, (p + 1) * PICKER_PAGE_SIZE), page: p, pages };
}

/** 可轮换列表：可播放类型 ∧ 命中两级过滤 ∧ 未隐藏（网格与轮换编辑器共用的那份）。 */
function playableWallpapers(wallpapers, ratingFilter, typeFilter, hiddenIds) {
  return wallpapers.filter(
    (w) => isRotatableWallpaper(w, ratingFilter, typeFilter) && !isHiddenWallpaper(w.id, hiddenIds),
  );
}

/** 已隐藏列表（保持库存顺序）。 */
function hiddenWallpapers(wallpapers, hiddenIds) {
  return wallpapers.filter((w) => isHiddenWallpaper(w.id, hiddenIds));
}

function pickerModel(input) {
  const list = input.wallpapers || [];
  const hiddenIds = input.hiddenIds || [];
  const ratingFilter = input.ratingFilter;
  const typeFilter = input.typeFilter;
  // 标题搜索（选择器模态框）：在两级过滤之上再收窄可播放网格。大小写不敏感的**子串**匹配。
  const query = (input.search || "").trim().toLowerCase();
  // 只有可播放的 Video/Web/Image 才进网格 —— Scene/Application 不能嵌进 web UI，
  // 隐掉它们网格才有用。已隐藏（软删除）的壁纸离开这里去「已隐藏」区；两级过滤再收窄。
  const playableList = list.filter((w) =>
    isRotatableWallpaper(w, ratingFilter, typeFilter) && !isHiddenWallpaper(w.id, hiddenIds)
    && (!query || String(w.title || "").toLowerCase().indexOf(query) !== -1));
  // 两个过滤下拉的分档计数（可播放、未隐藏）：反映实际可用量，与当前生效的过滤无关。
  const basePlayable = list.filter((w) => isPlayableType(w) && !isHiddenWallpaper(w.id, hiddenIds));
  // 单遍聚合 —— 分档计数各刷一遍 basePlayable 是 10 次 O(n)（5 个分级档 + 5 个类型档）。
  const ratingCounts = { everyone: 0, pg13: 0, mature: 0, unrated: 0 };
  const typeCounts = { video: 0, web: 0, image: 0, scene: 0 };
  for (const w of basePlayable) {
    const r = ratingOf(w);
    ratingCounts[r] = (ratingCounts[r] || 0) + 1;
    typeCounts[w.type] = (typeCounts[w.type] || 0) + 1;
  }
  const editorList = playableWallpapers(list, ratingFilter, typeFilter, hiddenIds);
  const hiddenList = hiddenWallpapers(list, hiddenIds);
  return {
    query,
    playableList,
    basePlayable,
    ratingCounts,
    typeCounts,
    editorList,
    hiddenList,
    normalPage: pageSlice(playableList, input.page),
    hiddenPageView: pageSlice(hiddenList, input.hiddenPage),
    editorPageView: pageSlice(editorList, input.editorPage),
  };
}

export {
  isUploadedWallpaper,
  isDirWallpaper,
  ratingOf,
  matchesRatingFilter,
  matchesTypeFilter,
  isPlayableType,
  isRotatableWallpaper,
  keepPlayingWallpaper,
  isHiddenWallpaper,
  PICKER_PAGE_SIZE,
  pageSlice,
  playableWallpapers,
  pickerModel,
};
