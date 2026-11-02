/**
 * 桌宠联动（浏览器半）能力层 · 常量与默认值。
 *
 * 旧内置版把 138 KB 的排播、常量、气泡、调参全塞在一个文件里；本次按能力分层，
 * 这一层只保留**数据**：动作名、素材时长、默认参数、气泡规格、能力门。
 * 任何一层都不得在此之上再写数值字面量（改参数只来这里）。
 *
 * 命名统一 `PETLINK_` 前缀，和新版 `src/pet-link.js` 装配层同处一个内联作用域时
 * 不与旧 `pet-link-performer.js`（`PET_*`）撞名。
 */

/** 动作名（协议值，与 src/pet-link-actions.json 与素材方逐字一致）。 */
const PETLINK_ANIM = {
  walkRight: '通用-右侧螃蟹步-dshwe',
  walkLeft: '通用-左侧螃蟹步-dshwe',
  brace: '侧边栏-蓄力准备往后拉-dshwe',
  pull: '侧边栏-后拉接疲态结束-dshwe',
  mascotTumble: '吉祥物-跳抓眩晕落地起身-dshwe',
  eggKick: '彩蛋-侧边栏-半身转向踢腿-dshwe',
  eggFlung: '彩蛋-侧边栏-被弹飞-dshwe',
  eggLand: '彩蛋-侧边栏-落地-dshwe',
  eggHiss: '彩蛋-吉祥物-哈气-dshwe',
};

/** 每段素材真实时长（ms）：帧数 × 41.667，真源 src/pet-link-timings.json。 */
const PETLINK_HOLD = {
  walkRight: 5167, walkLeft: 5167,
  brace: 5167, pull: 10125,
  mascotTumble: 8000,
  eggKick: 5167, eggFlung: 10125, eggLand: 5167,
  eggHiss: 5167,
};

/** 缺素材时的顶替（空串 = 跳过该步）；同旧版降级纪律：保流程不断。 */
const PETLINK_FALLBACK = {
  walkRight: '通用-左侧螃蟹步-dshwe',
  walkLeft: '通用-右侧螃蟹步-dshwe',
  brace: '',
  pull: '侧边栏-蓄力准备往后拉-dshwe',
  mascotTumble: '',
  eggKick: '',
  eggFlung: '彩蛋-侧边栏-落地-dshwe',
  eggLand: '',
  eggHiss: '',
};

/**
 * 参数默认值（沿用旧版调参面板默认；面板本身属 M6，这里只留排播要用的这一份）。
 *
 * `egg1FlingPx / egg1FlingMs` 只用于把「弹飞」换算成原生抛掷初速度（旧版同口径），
 * `egg1FlingPower` 保留为旧面板的力度倍数，取 1 时不改变换算结果。
 */
const PETLINK_DEFAULTS = {
  // ── 逻辑一：侧栏拉动 ──────────────────────────────────────────────
  // 默认值逐字对齐真蓝本 PET_TUNE_DEFAULTS（legacy:2454-2502）。
  sidebarWalkMs: 5167, braceMs: 1000, pullMs: 10125, slowOpenMs: 8125,
  // edgeGapPx：**可视右边缘**与目标边缘（窗口右缘 / 侧栏左缘）之间的留白。
  // 走位与跟随共用同一口径，切段时目标值一致、位置不跳。
  edgeGapPx: 0, openLeadMs: 0, openDelayMs: 500, segGapMs: 0,
  // handRightRatio：**可视右边界**在视频画面内的比例。
  // ⚠️ 这个值必须来自实测。2026-10-31 用真素材（通用-右侧螃蟹步-dshwe.webm）
  //    在 2560 宽画布上渲染 + 逐像素量测：
  //      · 该段宠物本体像素范围 x=2383..2531（宽 149px，容器 462），
  //        反推真实右界 = (2531-2255)/462 = **0.597**；
  //      · 用 0.66 时右缘停在 2531，距屏幕右缘 **28px**（用户看到"手没贴"）；
  //      · 改成 0.597 后右缘 2559，距屏幕右缘 **0px**（像素级验证通过）。
  //    旧值 0.62 是"另一段动作"的 alpha 右界（日志 alphaBounds 报过 0.653/0.667），
  //    拿它给走位用就会差 10~29px —— 这也是"调参数方向反了、越大越不贴"的原因：
  //    center = W − size×(hand−0.5)，hand 越大中心越靠左。
  handRightRatio: 0.597,
  // 后退跟随（旧版逐帧贴边参数；蓝本 followSpeed=3200 / grace=200 / still=140）
  followGraceMs: 200, followSpeed: 3200, followStillMs: 140, followStillEps: 0.5,
  // ── 气泡 ──────────────────────────────────────────────────────────
  bubbleMs: 3000, bubbleWindowMs: 4000, bubbleDurationMs: 3000,
  // ── 联动占用 ──────────────────────────────────────────────────────
  lockHeartbeatMs: 20000, holdMaxMs: 180000,
  // ── 彩蛋通用 / 返回原位 ───────────────────────────────────────────
  eggAt: 3, mascotGrabAtMs: 2500, returnWalkMinPx: 40,
  // ── 抓绳互动（逻辑二）────────────────────────────────────────────
  mascotWalkMs: 0, mascotTumbleMs: 8000, mascotOpenAtMs: 2500, mascotTopOffsetPx: 0,
  // ── 绳子位移 ──────────────────────────────────────────────────────
  mascotRopeDownPx: 40, mascotRopePullMs: 800, mascotRopeBackMs: 260,
  mascotRopePullEase: 1, mascotRopeBackEase: 2,
  // ── 脱手与下落 ────────────────────────────────────────────────────
  mascotReleaseAtMs: 2920, mascotDropPx: 90, mascotDropMs: 520,
  // ── 彩蛋一：踢开并弹飞 ───────────────────────────────────────────
  egg1EdgeGapPx: 0, egg1WalkMs: 0, egg1LeadMs: 600,
  egg1KickMs: 5167, egg1FlungMs: 10125, egg1LandMs: 5167,
  // ── 弹飞位移 ──────────────────────────────────────────────────────
  // 「弹飞启动延迟」：蓝本 petLinkEggRebound 用 `delay = tune('egg1FlingStartDelayMs','egg1')`（L1425），
  // 默认 0；之前 t16 当死参数误删，T11 恢复并真接进三阶段回弹的起手等待。
  egg1FlingStartDelayMs: 0,
  // egg1FlingPower 是新面板的力度倍数（旧版无此键），默认 1 时换算结果与旧版逐字相同。
  egg1FlingPx: 420, egg1FlingMs: 520, egg1FlingPower: 1,
  // ── 落地恢复 ──────────────────────────────────────────────────────
  egg1PostLandMs: 600,
  // ── 彩蛋二：站立哈气 ─────────────────────────────────────────────
  egg2LeadMs: 600, egg2HissMs: 5167,
  // ── 全屏抖动与展开 ────────────────────────────────────────────────
  egg2ShakeAtMs: 1750, egg2ShakePx: 8, egg2ShakeHz: 12, egg2OpenAtPct: 35, egg2OpenEase: 2,
  // ── 走位时长边界（算法内部用；面板不暴露；蓝本 PET_WALK_MIN/MAX_MS）──
  walkMinMs: 420, walkMaxMs: 2600,
};

/** 可调逻辑集合（与旧版四个分组一致）。 */
const PETLINK_TUNER_LOGICS = ['sidebar', 'mascot', 'egg1', 'egg2'];

/** 自绘气泡规格：逻辑 → 气泡文案与表情图下标（图在 assets/m{0..4}.png）。 */
const PETLINK_BUBBLE_SPECS = [
  { id: 'sidebar', logic: 'sidebar', image: 0, text(weT = value => value) { return weT('累死本鲸了，给我添两碗饭'); } },
  { id: 'mascot', logic: 'mascot', image: 1, text(weT = value => value) { return weT('可以换壁纸了，不要用××√哦'); } },
  { id: 'egg1Angry', logic: 'egg1', image: 2, text(weT = value => value) { return weT('偶鲸鲸！！！'); } },
  { id: 'egg1Land', logic: 'egg1', image: 3, text(weT = value => value) { return weT('哇啊啊啊啊啊！！！'); } },
  { id: 'egg2', logic: 'egg2', image: 4, text(weT = value => value) { return weT('？！欺负一只肥鱼！？'); } },
];

/**
 * `petApiDshwe.link` 必须具备的方法（判据「link.* 能力齐全」）。
 * 少任何一个都 = 运行时过旧，降级 native 并给出 `runtime-too-old`。
 */
const PETLINK_LINK_METHODS = [
  'getRoot', 'adoptPosition', 'pollState', 'getPlayback',
  'throwNative', 'stopNativeThrow', 'getNativeThrow',
  'allowBubble', 'hideBubble', 'setBubbleDuration',
  'lock', 'unlock',
];

/** 联动控制面协议版本门槛（M2 定版 = 4）。低于它按 `runtime-too-old` 处理。 */
const PETLINK_MIN_LINK_VERSION = 4;

/** 独占租约 TTL（ms）：必须长于任何一段素材（最长 ~10.1s），到点兜底解冻。 */
const PETLINK_LOCK_TTL_MS = 60000;

/** 自绘气泡「允许展示」窗口默认宽度（ms），盖住宿主 /state 轮询的 1s 延迟。 */
const PETLINK_BUBBLE_WINDOW_MS = 4000;

/** 逐帧轮询间隔（ms）：读 getPlayback 是页面内读，不是 HTTP。 */
const PETLINK_POLL_MS = 32;
/** 走位插值步长（ms）：每步只写 adoptPosition，页面内、无请求。 */
// 步进 16ms（≈60fps）：配合 pet 侧 commitRatio 去抖，密写只动 DOM 不触发重渲染，
// 从而既流畅又不卡。早先 40ms（25fps）在视觉上本身就是"一顿一顿"。
const PETLINK_MOVE_STEP_MS = 16;

/** 睡觉等待上限（ms）：唤醒状态轮询与「起来」动画播完各自的上限，绝不无限等。 */
const PETLINK_WAKE_TIMEOUT_MS = 8000;
const PETLINK_WAKE_ANIM_TIMEOUT_MS = 12000;
