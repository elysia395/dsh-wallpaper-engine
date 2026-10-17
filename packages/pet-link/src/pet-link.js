/**
 * pet-link.js — 桌宠联动（浏览器半）：点吉祥物 → 宠物走过去拉侧栏。
 *
 * ── 四条排播（2026-10-15 口径，真源是素材方的 `动作索引.txt`）────────────────
 *  **选路规则**：比较「宠物→侧边栏」与「宠物→吉祥物」两个距离，谁近走哪条
 *  （`petLinkDecide`）。两条主干各自**独立计数**，第 3 次触发改走对应彩蛋。
 *
 *   · 逻辑一（离侧边栏近）：
 *       通用-右侧螃蟹步 → 侧边栏-蓄力准备往后拉
 *       → **手接触屏幕边缘那一刻**分段推进侧边栏（后拉段，10.125s）
 *       → 气泡「累死本鲸了，给我添两碗饭」(3s) → 就地静止等待侧栏关闭/180s
 *       → 判断左/右，用对应侧螃蟹步走回原点
 *   · 逻辑二（离吉祥物近）：
 *       通用-左侧螃蟹步 → 走到吉祥物下方就位
 *       → 吉祥物-跳抓眩晕落地起身（8s）→ **吉祥物被往下拖的关键帧**处侧栏弹出
 *       → 气泡「可以换壁纸了，不要用××√哦」(3s) → 就地等待 → 走回原点
 *   · 彩蛋一（逻辑一第 3 次）：
 *       通用-右侧螃蟹步 → 气泡「偶鲸鲸！！！」→ 彩蛋-侧边栏-半身转向踢腿
 *       → **回收气泡** → 彩蛋-侧边栏-被弹飞 → 气泡「哇啊啊啊啊啊！！！」
 *       → 彩蛋-侧边栏-落地 → **回收气泡** → 等待 → 走回原点
 *   · 彩蛋二（逻辑二第 3 次）：
 *       原地不动 → 气泡「？！欺负一只肥鱼！？」→ 彩蛋-吉祥物-哈气 → **回收气泡**
 *
 * 契约纪律：
 *   · 所有方法绝不抛、返回的 Promise 必定 resolve（调用方无需 try/catch）。
 *   · 不写面板状态：侧栏开合只经 wallSidebarOpen/Close 既有出口；拉出的进度由
 *     client.js 的 RopeDock 注册进来（见 registerSidebar）。
 *   · 位置动画由本模块直接驱动宠物元素（dsh-pet 的 /anim 不支持指定目标坐标，
 *     而宠物就渲染在同一页面里）——只写 `transform`，绝不碰它拥有的 `left/top`。
 */
const PET_BASE = '/dsh-pet-7340';
/** 动作名（协议值，与 src/pet-link-actions.json 和注入工具逐字一致）。
 *
 *  ── 2026-10-15 整批换代：18 段 → 9 段，命名体系一并换掉 ────────────────────
 *  旧版一律叫 `拉侧栏-<动作>`（单一族名），新版按**使用场景**分族：
 *    · `通用-<左|右>侧螃蟹步` —— 去程与回程共用；**原地踏步**，位移由页面驱动
 *    · `侧边栏-*`             —— 逻辑一（拉侧栏）专用
 *    · `吉祥物-*`             —— 逻辑二（拉吉祥物）专用
 *    · `彩蛋-*`               —— 两条彩蛋专用
 *  ⚠️ 素材**不再带转身过场**：螃蟹步是"全程正脸朝镜头、靠身体左右倾斜表示行进方向"
 *  （见素材方提示词），所以旧版的 `转身-正转右` / `转身-右转正` / `落地转正` 三段
 *  随整批素材一起退休 —— **不要**按旧逻辑去补过场，那三段已经没有素材了。
 *
 *  ⚠️ 旁支两段（`彩蛋-吉祥物-远程吸入planA/planB-dshwe`）**刻意不在本表**：
 *  用户口径（2026-10-15）「暂不接入协议表」。素材文件保留在注入包的
 *  `assets/_alternates/`，要启用时再登记（判据见 bridge 的 verify-tools）。
 */
const PET_ANIM = {
  // ── 走位：两个方向各一段（不再有"正面走"，去/回程都按方向选）──────────
  walkRight: '通用-右侧螃蟹步-dshwe',
  walkLeft: '通用-左侧螃蟹步-dshwe',
  // ── 逻辑一：蓄力 → 拉出（侧栏在这一段里被逐步推出）─────────────────────
  brace: '侧边栏-蓄力准备往后拉-dshwe',
  pull: '侧边栏-后拉接疲态结束-dshwe',
  // ── 逻辑二：跳起抓吉祥物 → 眩晕 → 落地 → 起身（一段素材演完）───────────
  mascotTumble: '吉祥物-跳抓眩晕落地起身-dshwe',
  // ── 彩蛋一（逻辑一第 3 次）：踢腿 → 被弹飞 → 落地 ──────────────────────
  eggKick: '彩蛋-侧边栏-半身转向踢腿-dshwe',
  eggFlung: '彩蛋-侧边栏-被弹飞-dshwe',
  eggLand: '彩蛋-侧边栏-落地-dshwe',
  // ── 彩蛋二（逻辑二第 3 次）：原地哈气 ─────────────────────────────────
  eggHiss: '彩蛋-吉祥物-哈气-dshwe',
};
const PET_TARGET = 'main';
const PET_PROBE_TIMEOUT = 4000;
const PET_PLAY_TIMEOUT = 2500;
const PET_SAY_TIMEOUT = 2500;
/** 逻辑一去程按整段走路移动；预备多久切后拉独立计时，不必等完整准备素材。 */
const PET_SIDEBAR_WALK_MS = 5167;
/** 默认留一个宿主轮询周期，避免预备请求被紧接的后拉覆盖。 */
const PET_BRACE_MS = 1000;
/** 后拉素材真实时长；走路与准备分别计时，默认侧栏只随后拉展开。 */
const PET_PULL_MS = 10125;
const PET_SLOW_OPEN_MS = 8125;

/** 相对后拉开始的展开提前量，只能进入准备段，不能越过走路阶段。 */
const PET_OPEN_LEAD_MS = 0;
/** 仅推迟侧栏开始展开，不延后准备和后拉动画。 */
const PET_OPEN_DELAY_MS = 500;

/** 段与段之间的最小间隙（ms）：上一段**发出**之后这么久才发下一段。
 *
 *  用户口径（2026-10-15 m04043）：「这上一个动画播放完要**立刻**切到（下一段）」。
 *  队列原本的兜底是硬编码的 120ms（`item.hold || 120`）——对"上一段自己报了时长"
 *  （hold > 0）的段没有影响，但凡是我们**刻意不等满**的段（走位段传 `hold: 0`）就会
 *  白等 120ms。默认取 0 ⇒ 立刻切。
 *  ⚠️ 这只影响"没有 hold 的段"；有 hold 的段仍按素材时长串行。 */
const PET_SEG_GAP_MS = 0;

/** 联动气泡的展示时长（ms）。用户口径（2026-10-15）：**3s**。
 *
 *  ⚠️ 为什么需要"设时长 + 主动收回"这两件事：
 *  宿主 dsh-pet 把气泡时长**硬编码**成 10s（其 `BUBBLE_DURATION_MS`），且
 *  `pets.<id>.say` 是**只写**叶子 —— 没有任何"收回气泡"的接口。而彩蛋一的排播明确要求
 *  「弹气泡 → 播动作 → **回收气泡** → 播下一段」。所以 bridge 配套了一个针对 dsh-pet
 *  渲染半的补丁（`tools/repatch-pet.mjs`），它暴露页内控制面 `window.__dshPetCtl`，
 *  本模块通过它设时长与收回。
 *  **补丁不在场时全部静默降级**（气泡照弹，只是按宿主默认 10s 自行消失），
 *  绝不因为一个可选增强把流程打断。 */
const PET_BUBBLE_MS = 3000;
/** 「允许气泡」窗口的宽度（ms）：独占锁会把气泡一并拦下，我方气泡需要临时开窗。
 *  ⚠️ 要盖住"从 /broadcast 到宿主把它渲染出来"的延迟：宿主对 /state 的轮询间隔是 **1s**
 *  （`setInterval(poll, 1e3)`），所以窗口不能只开几百毫秒。
 *  4s ≈ 4 个轮询周期，足够宽；且窗口开着时**锁仍然拦外来气泡**（锁只管"谁的"，
 *  窗口只管"能不能显示"），所以开宽一点不会让别人的气泡乘虚而入。 */
const PET_BUBBLE_WINDOW_MS = 4000;
/** 独占锁的**心跳续期**周期（ms）。
 *  ⚠️ 必须显著小于补丁侧默认的锁 TTL（60s）：留出两三次机会，
 *  任一次续期被丢弃也不至于让锁真的过期（过期 = 随机链与外来气泡回来）。
 *  取 20s（TTL 的 1/3）。 */
const PET_LOCK_HEARTBEAT_MS = 20000;

/** 每段动画的**停留时长**（= 素材真实时长，ms）。
 *
 *  ⚠️ 掐表纪律（用户口径「每一段动画的时长要和素材时长严格对齐」）：
 *  这里的每个数字必须**等于素材帧数 × 帧时长**（24fps ⇒ 41.667ms/帧），
 *  真源是 `src/pet-link-timings.json`（由素材方交付的 `时长表.json` 换算而来）。
 *  `verify-pet-mascot` 有一条判据逐项比对，**素材换了就会红**，提醒你同步这里。
 *  偏差会导致"动作播完了流程还在干等"或"流程往下走了动作被截断"。
 *  ⚠️ 宠物每秒轮询一次状态：各段至少占满一个周期（≥1000ms），否则快速连发会被后一段
 *     覆盖。本批 9 段最短 5167ms，天然满足（旧版有 583ms 的转身段，那个隐患随整批换代消失）。 */
const PET_HOLD = {
  walkRight: 5167, walkLeft: 5167,
  brace: 5167, pull: 10125,
  mascotTumble: 8000,
  eggKick: 5167, eggFlung: 10125, eggLand: 5167,
  eggHiss: 5167,
};
/** 能力门：**逻辑一的主干三段**必须在池子里，联动才成立。
 *
 *  用户口径（2026-10-15）：逻辑一（拉侧栏）是主路径，走位 → 蓄力 → 后拉 三段缺一不可。
 *  逻辑二的 `吉祥物-跳抓眩晕落地起身` 与彩蛋各段**不进门** —— 它们是支线，
 *  缺了只影响那条支线（走 PET_FALLBACK 降级），不该把整个联动判成不可用。
 *  ⚠️ 名字必须与 `lib/components/pet-link/capability.js` 的 `PET_ANIM` **逐字一致**：
 *  两边不一致的后果是"探测判定运行时池里缺动作 ⇒ 联动整体不可用 ⇒ 点击只做开合切换"。
 *  判据：test/verify-pet-link.mjs 的「两侧名字…一致」一条会解析这两份并逐字比对。 */
const PET_CORE = ['通用-右侧螃蟹步-dshwe', '侧边栏-蓄力准备往后拉-dshwe', '侧边栏-后拉接疲态结束-dshwe'];
/** 某一段缺素材时的降级（空串 = 跳过该步）。
 *
 *  ⚠️ 本批 9 段**都已交付**，本表只在"素材被用户删掉 / 注入不完整"时兜底，不是正常路径。
 *  降级原则：**保流程不断**（流程纪律「绝不因缺素材而中断」），代价是那一拍的观感打折。
 *  · 走位段：用**另一侧**螃蟹步顶上 —— 顶多身体倾斜方向别扭，至少宠物还在走；
 *  · `brace`/`mascotTumble`/彩蛋段：跳过。`pull` 段素材本身自带"蓄力→后拉"，
 *    跳过蓄力仍讲得通；主演出缺失时逻辑二退化成"侧栏直接弹出 + 气泡"；
 *  · `pull`：用蓄力段顶上（有使劲动作，但没有真实位移）。 */
const PET_FALLBACK = {
  walkRight: '通用-左侧螃蟹步-dshwe',
  walkLeft: '通用-右侧螃蟹步-dshwe',
  brace: '',                                  // 蓄力段缺失 ⇒ 跳过
  pull: '侧边栏-蓄力准备往后拉-dshwe',        // 拉出段缺失 ⇒ 用蓄力段顶上
  mascotTumble: '',                           // 主演出缺失 ⇒ 跳过
  eggKick: '',
  eggFlung: '彩蛋-侧边栏-落地-dshwe',
  eggLand: '',
  eggHiss: '',
};
/** 名字 → 停留时长 的反查表（PET_ANIM 与 PET_HOLD 的合成）。
 *
 *  用途：`PET_FALLBACK` 顶替之后，**实际播的那一段**可能不是原键对应的素材
 *  （例如 `pull` 顶替成蓄力段），此时 `PET_HOLD[键]` 的时长是错的。
 *  收尾/掐表必须按**真正播出去的名字**算，否则"顶替 + 按时长等"会错拍。
 *  ⚠️ 两张表都不含的名字（用户自加的动作）查不到 ⇒ 调用方按 0 处理（不干等）。 */
const PET_HOLD_BY_NAME = (() => {
  const out = {};
  for (const key of Object.keys(PET_ANIM)) {
    if (Number.isFinite(PET_HOLD[key])) out[PET_ANIM[key]] = PET_HOLD[key];
  }
  return out;
})();
/** 池子里可用的动作名（探测时记下）；缺哪个就按 PET_FALLBACK 顶替。 */
const petLinkPool = { names: [] };
/** 彩蛋触发次数：第 N 次逻辑一改为彩蛋一（踢腿/弹飞），第 N 次逻辑二改为彩蛋二（哈气）。 */
const PET_EGG_AT = 3;
/** 逻辑二「吉祥物被抓握往下拖的关键帧」的**近似时刻**（ms，从主演出开始算）。
 *
 *  用户口径（2026-10-15）：「侧边栏弹出逻辑在这为吉祥物被抓握往下拖的关键帧」。
 *  ⚠️ 这是个**近似值**，不是从素材里读出来的真值 —— 我们拿不到视频的关键帧标注，
 *  `吉祥物-跳抓眩晕落地起身` 只是一段 8000ms 的整片。取 2500ms 的依据是素材方的命名与
 *  时长结构（"跳抓"在先、"眩晕落地起身"在后，后者明显占更长的篇幅）。
 *  **要做成精确值，只能由素材方给关键帧号** —— 那时把这里换成 `帧号 × 41.667` 即可，
 *  判据（verify-pet-mascot 的"侧栏弹出与下拉同刻"）不依赖具体数值，只要求二者同刻。 */
const PET_MASCOT_GRAB_AT_MS = 2500;
/** 彩蛋里「弹气泡」到「开始演动作」之间的留白（ms）。
 *  用户口径给的顺序是"弹气泡 → 播动作 → 回收气泡"，气泡需要一点时间**看得见**
 *  再开始演，否则第一帧就被后一段动作的观感盖过去。 */
const PET_EGG_BUBBLE_LEAD_MS = 600;
/** 收尾：**带走路动作**把偏移滑回零，方向按原点在当前位置的哪一侧决定。
 *
 *  用户口径（2026-10-15，动作索引.txt）：
 *  「返回原点动画要做判断左/右按结果采用【通用-左/右侧螃蟹步】」——
 *  回程不是瞬移、也不是默默滑回去，而是**真的走回去**，且走出去的方向必须与
 *  横向位移方向一致（往左走用左侧螃蟹步、往右走用右侧螃蟹步），否则会"倒着走"。
 *
 *  ⚠️ 与 `petLinkReturnHome` 的分工：那个是"不出声地滑回零"（异常路径/dispose 用），
 *  这个是正常收尾的**带动作**版本。两者都必须把偏移归零（见 petLinkReturnHome 的说明：
 *  留下非零 transform 会让 dsh-pet 的拖拽"不跟手"）。 */
async function petLinkReturnHomeWalk(ms, alive = () => true, home, onStart) {
  const rect = petLinkPetRect();
  if (!rect || !alive()) return false;
  const off = petLinkState.offset || { x: 0, y: 0 };
  const target = home || { x: rect.left + rect.width / 2 - off.x, y: rect.top + rect.height / 2 - off.y };
  const dx = target.x - (rect.left + rect.width / 2);
  const threshold = Math.max(0, petLinkTune('returnWalkMinPx'));
  const walkKey = dx < -threshold ? 'walkLeft' : dx > threshold ? 'walkRight' : '';
  let duration = Math.max(0, Number.isFinite(ms) ? ms : 600);
  if (walkKey) {
    if (!petLinkState.releaseFacing) petLinkState.releaseFacing = petLinkArmFacing();
    const played = await petLinkPlay(walkKey, { hold: 0, internal: true, gap: 0 });
    if (!played || !alive()) return false;
    duration = Math.max(duration, PET_HOLD[walkKey]);
  }
  const current = petLinkPetRect();
  if (!current || !alive()) return false;
  if (typeof onStart === 'function') onStart(duration);
  const moved = await petLinkGlide(current, target.x, target.y, duration, alive);
  if (!alive()) return false;
  await petLinkFinishAction(alive);
  if (!alive()) return false;
  petLinkHandoffPosition();
  return moved;
}

/** 回程"值得播一段走路"的最小横移（px）：低于它就直接滑回零，不播走路。 */
const PET_RETURN_WALK_MIN_PX = 40;

/** 走位速度（px/s）与最短/最长耗时，避免瞬移或走太久。
 *  ⚠️ 走位是**页面驱动的 transform 位移**，与素材时长无关：素材（螃蟹步）只是
 *  "原地横向挪步"的循环动画，真正从 A 点到 B 点由这里的速度决定（见 petLinkGlide）。 */
const PET_WALK_SPEED = 900;
const PET_WALK_MIN_MS = 420;
const PET_WALK_MAX_MS = 2600;
/** 逻辑二：把吉祥物本体（`.we-rope`）下拉的距离与时长（含弹回）。
 *  用户口径（2026-10-15）：「侧边栏弹出逻辑在这为**吉祥物被抓握往下拖的关键帧**」——
 *  即吉祥物被拖下来这一刻，侧栏顺势弹出。所以下拉与 `petLinkSnapOpenSidebar()` 同一时刻。 */
const PET_ROPE_PULL_DOWN = 90;  // 下拉距离（px）
const PET_ROPE_PULL_MS = 420;   // 拉到底的时长
const PET_ROPE_BACK_MS = 260;   // 弹回的时长
/** 跟随面板边缘时的速度上限（px/s）—— **必须按时间算，不能按帧算**。
 *  ⚠️ 这里踩过坑：原先写「每帧最多 24px」= 按帧限速 ⇒ 速度上限 = 24 × fps。
 *  60fps 下是 1440px/s（够用），但真机拉出期间页面只跑约 20fps ⇒ 掉到 480px/s，
 *  而宿主面板峰值约 1176px/s ⇒ 拉出后半段宠物必然越落越远（实测每 250ms 恰好落后
 *  120px = 24px × 5 帧，缺口逐帧线性扩大）。
 *  3200 远高于面板峰值：正常拉出全程"贴得住"，而面板**已经展开**时（目标离得很远）
 *  仍会在约 0.4s 内滑过去，不会瞬移。 */
const PET_FOLLOW_MAX_SPEED = 3200;
/** 边缘静止多久算"拉出结束"（ms）。也用时间而不是帧数 —— 低帧率下 8 帧会拖得很久。 */
const PET_FOLLOW_STILL_MS = 140;
/** 彩蛋一保留旧参数键，用参考距离/发力时间换算初速；落点和反弹交给原生物理。 */
const PET_FLING_LEFT = 420;
const PET_FLING_MS = 520;
/** 跟随起手的**宽限期**（ms）：从"面板开始动"到"允许判静止"之间的最小等待。
 *
 *  ⚠️ 这是用户 m04043「没有往后同步位移」的根治点。原判据是：
 *    `上一次边缘读数与这次相差 < PET_FOLLOW_STILL_EPS` 持续 `PET_FOLLOW_STILL_MS` ⇒ 认为拉完。
 *  但侧栏的展开是**宿主自己的 CSS Grid 过渡**，它不会在我们点火的那一帧就开始跑：
 *    React 要重新渲染、过渡要等下一帧、`--ds-transition-duration-slow` 刚被改过
 *    还要等样式重算。真机上这段时间边缘读数**一直不动**（或一开始只有 1~2px 抖动），
 *    于是"静止"判据在**面板还没开始动**的时候就成立 ⇒ 跟随循环立刻 `resolve(true)` 退出
 *    ⇒ 宠物全程一动不动（用户看到的就是"没有往后同步位移"）。
 *  加一段宽限期后，起手阶段**不判静止**，只累计时间。
 *  但宽限期无法防止慢速过渡每帧不足阈值的误判；现在还要等展开流程结束，
 *  按静止窗口的累计位移判断，并确认宠物已经追上边缘，才允许收尾。
 *
 *  默认 200ms 按用户当前导出的参数；完整展开与累计静止判据仍负责防止早退。
 *  ⚠️ 它**必须可调**：不同机器/不同侧栏内容下起手延迟会变，这正是面板存在的意义。 */
const PET_FOLLOW_GRACE_MS = 200;
/** 跟随期间"基准中心"的刷新间隔（ms）。dsh-pet 自己也会走位，基准不能永不刷新；
 *  但也不能每帧刷新（每次都要 getBoundingClientRect ⇒ 强制同步布局 ⇒ 掉帧）。 */
const PET_FOLLOW_MEASURE_MS = 250;
/** 「等宠物物理稳定」的判据（v4 素材对接文档 §4.4）：
 *  `transform` 偏移连续静止 `PET_SETTLE_STILL_MS` 即认为稳定，`PET_SETTLE_MAX_MS` 是硬上限。
 *  ⚠️ 为什么必须有上限：宿主的重力只认 `left/top`、我们只写 `transform`，两者互不感知，
 *  "稳定"没有权威信号来源，只能由我方观测 + 上限兜底 —— 绝不允许等不到就卡死。 */
const PET_SETTLE_STILL_MS = 220;
const PET_SETTLE_MAX_MS = 2600;
/** 拉出成功后停留等待"侧栏被关闭"的上限（ms）。到点自行收尾 —— 绝不让宠物永远杵在那儿。
 *  ⚠️ 用户口径（2026-10-14 第二版）：**180s**（早先版本是 60s）。到点后**慢慢走回原位**。
 *  停留期间侧栏保持打开，宠物**就地在拉出位置**不动（不再走到面板左侧）。 */
const PET_HOLD_MAX_MS = 180000;
/** 轮询"侧栏是否还开着"的间隔（ms）。 */
const PET_HOLD_POLL_MS = 200;
/** 采用本地状态跟踪的判定：宿主侧栏不可用（open 是空操作）时 isOpen() 恒 false，
 *  那种情况不该空等 —— 见 petLinkWaitSidebarClose。 */
const PET_HOLD_GRACE_MS = 1200;
/** 透明画布 640 设计宽里**身体命中框**占的左右比例（dsh-pet 的 `HIT_BOX`，见
 *  `src/shared/constants.ts` 的 `{ x0: 200, y0: 50, x1: 440, y1: 335 }`）。
 *  ⚠️ 画布左右各有约 14.4% 透明留白：把**画布**贴到边缘时，身体其实还离边缘
 *  约 146px（size=462 时 462 × 0.1875 = 86.625）。
 *  这份比例是**身体框**口径，只用于 `petLinkBodyRect()` 的回落量测；
 *  **贴边不用它**（用户口径 2026-10-15 要求手对上边缘，见 `PET_HAND_RIGHT_RATIO`）。 */
const PET_BODY_RIGHT_RATIO = 0.6875; // HIT_BOX.x1 / 640
const PET_BODY_LEFT_RATIO = 0.3125;  // HIT_BOX.x0 / 640
/** 贴边口径：素材 640 设计宽里**手**（肤色检出）右边缘所在的比例。
 *
 *  ── 为什么贴边不能用身体口径 ────────────────────────────────────────────────
 *  `PET_BODY_RIGHT_RATIO = 0.6875` 是**旧精灵**的命中框（`HIT_BOX.x1 = 440`），
 *  与这批素材的真实手位**不在同一处**：手尖全程只落在 0.4984–0.6609 之间 ⇒ 按身体
 *  对齐会在 462px 画布上留下 0.0266 × 462 ≈ 12px 起步的缝（蓄力/后拉段更大）。
 *  这正是用户两轮反馈「还是不够贴边」「一定要让 pet 手对上侧边栏边缘」的量化根因。
 *
 *  ── 为什么取 0.5703 ────────────────────────────────────────────────────────
 *  逐帧实测（`_hand-measure/hand-profile.json`，2026-10-15）三段手位分别是
 *  走路 0.5391–0.6609、蓄力 0.5437–0.6219、后拉 0.4984–0.6141。单点无法同时对上
 *  全部帧，于是取**"抓握那一刻"**的值：走路段起步那一段（f0–f14 全是 0.5703）、
 *  蓄力段首帧 0.5781、后拉段首帧 0.5641 —— 三者几乎重合，取 0.5703。
 *  取值偏向"略靠内"（小于各段峰值）是**刻意**的：偏差表现为手**压住**面板边缘，
 *  看起来像"抓握"；反过来（ratio 偏大）就是一条可见的缝，那正是用户不满意的那种。
 *  后拉段中段角色低头擦泪、手明显收回（0.4984），那是素材本身"疲态"的动作，
 *  此时手不抓边缘是对的，不追。 */
const PET_HAND_RIGHT_RATIO = 0.5703;
/** 贴边时**手右边缘**与屏幕右边缘（= 侧边栏左边缘）之间保留的像素数。
 *
 *  用户口径（2026-10-15）：「吉祥物要往右边再靠近一点，让吉祥物的手和侧边栏 0 距离」
 *  ⇒ 取 0：手右边缘**正好落在 W**，手指压在侧边栏左边缘上。
 *  原先的 6px 是为了避免"精度抖动导致反复贴边"，但实测那 6px 在视觉上就是一条缝 ——
 *  而且跟随循环本身有 `PET_FOLLOW_STILL_MS` 静止判据，贴到位后不会来回抽动。
 *  ⚠️ 两处消费点（去向停点 `petLinkStops` / 后拉跟随 `wantOff`）必须用**同一个值**，
 *  否则会出现"走到 A 之后再被拽到 B"的二段位移。故收敛成常量。 */
const PET_EDGE_GAP_PX = -15;
/** 朝向武装的复写周期（ms）。见 petLinkArmFacing：宿主随时会重写视频的 transform，
 *  我们必须周期性把那条 `scaleX(-1)` 去掉。100ms 远快于一次切段（>=792ms）。 */
const PET_FACING_TICK_MS = 100;

/** 朝向武装：**只在联动期间**把宠物视频层"钉"成不镜像。
 *
 *  ── 为什么需要它（用户口径 2026-10-14「拉/踢朝向反了」的代码侧隐患）────────
 *  我方素材按协议是**面向画面右侧**的（侧边栏在右）。但 dsh-pet 有一个**朝向状态**：
 *  随机链抽到 `turn` 档（「东张西望」）播完后会翻转 `facing`（`pet.ts` 的 `handleEnded`
 *  → `setFacing`），而 `facing === 'right'` 时它给**视频元素**写 `scaleX(-1)`
 *  （`pet.ts` 的 `switchTo`/`startSquash`）。
 *  ⇒ 一旦宠物当前朝右，我方"朝右"的素材会被镜像成**朝左**，看起来还是反的。
 *  用户的 `main-config.jsonc` 是 `fixedEnabled: false`，随机链**会**抽到 `turn`，所以这不是
 *  理论风险（实测的失败模式：素材改对了，实机仍然"反了"，且只在某些时刻出现）。
 *
 *  ── v4 之后**不需要**按段收窄（我一度以为要，盘过逻辑后否掉）─────────────────
 *  v4 的朝向不再一刀切（有的段面向右、有的正面），于是"要不要按段决定摘不摘镜像"
 *  看起来像个问题。其实不是：
 *   · 素材**自带正确朝向**（正面段画的就是正面、朝右段画的就是朝右）；
 *   · 宿主的 `facing` 是**全局状态**，它给**所有**视频层无差别加 `scaleX(-1)`，
 *     并不知道我们在播哪一段；
 *   · 所以那条镜像**永远是多余的干扰**：摘掉后朝右段=朝右（对）、正面段=正面（对）。
 *  反过来若按段收窄（正面段保留镜像），只会让正面段被左右翻转、徒增不对称细节的偏差。
 *  ⇒ 保持"联动期间无差别摘掉"，不必读当前在播哪一段。
 *
 *  ── 为什么**不能**在 `.dsh-pet-root` 上对消（我最初的想法，错的）──────────
 *  镜像写在 `.dsh-pet-video`（root 的**子节点**），而气泡 `.dsh-pet-bubble` 与命中区
 *  `.dsh-pet-hit` 是视频的**兄弟**。在 root 上叠 `scaleX(-1)`：
 *   · 位移**不受影响**（镜像作用于 root 的局部坐标，`translate` 语义不变）——这点是安全的；
 *   · 但**气泡文字会被一起镜像**（变成反字），这是不可接受的。
 *  所以对消只能落在**视频层本身**，且必须把它当成"覆盖层"来写：视频的 transform 由
 *  dsh-pet 拥有，它会随时重写（切动画 / Q 弹），我们只能**周期性复写**，不能只写一次。
 *
 *  ── 安全边界（本函数的全部行为）─────────────────────────────────────────
 *   · 只把视频元素的 transform 里那条 `scaleX(-1)` **去掉**，其余（`scaleY(...)` 等）原样保留；
 *   · 只在**联动进行中**生效（进入武装 / 收尾解除），绝不常驻改写宿主元素；
 *   · 收尾**还原**成"如果没有我们，它本该是什么"——即按 root 的 `data-facing` 复原，
 *     不留下任何"我们改过"的痕迹（与 `petLinkResetOffset` 同一纪律）。
 *
 *  @returns 解除函数（幂等） */
function petLinkArmFacing() {
  const root = petLinkPetEl();
  if (!root || typeof document === 'undefined' || !document.querySelector) return () => {};
  const videos = () => {
    try { return Array.from(document.querySelectorAll('.dsh-pet-video')); } catch { return []; }
  };
  /** dsh-pet 的朝向状态：它自己渲染在 root 的 `data-facing` 上（`pet.ts:1535`），
   *  是唯一稳定的真源 —— 比自己解析 transform 字符串可靠（squash 期间会有 `scaleY`）。 */
  const hostFacing = () => {
    try { return root.getAttribute ? root.getAttribute('data-facing') : null; } catch { return null; }
  };
  const strip = (el) => {
    if (!el || !el.style) return;
    let tf = '';
    try { tf = String(el.style.transform || ''); } catch { return; }
    // 只动 scaleX(-1)：其余片段（scaleY / translate…）逐字保留
    if (!tf.includes('scaleX(-1)')) return;
    const next = tf.replace(/scaleX\(-1\)\s*/g, '').trim();
    try { el.style.transform = next; } catch { /* 样式写失败不影响流程 */ }
  };
  const tick = () => { for (const v of videos()) strip(v); };
  tick();
  // 视频的 transform 由 dsh-pet 拥有、随时会被重写 ⇒ 必须周期性复写。
  // 周期取 100ms：远快于一次切段（>=792ms），且每次只做一次 `includes` 判定，
  // 不做 getBoundingClientRect（不触发强制同步布局，与跟随循环的性能纪律一致）。
  // ⚠️ 环境可能没有 setInterval（测试替身只给 setTimeout/rAF）⇒ 取不到就退化为
  //    只写一次，绝不因为一个可选优化把整条流程打断。
  let timer = null;
  if (typeof setInterval === 'function') {
    try { timer = setInterval(tick, PET_FACING_TICK_MS); } catch { timer = null; }
  }
  return () => {
    if (timer !== null && typeof clearInterval === 'function') {
      try { clearInterval(timer); } catch { /* ignore */ }
    }
    timer = null;
    // 还原：按宿主自己的朝向复原（它若朝右，仍应是镜像 —— 我们只负责联动期间不镜像）
    const wantMirror = hostFacing() === 'right';
    for (const el of videos()) {
      if (!el || !el.style) continue;
      let tf = '';
      try { tf = String(el.style.transform || ''); } catch { continue; }
      if (wantMirror) {
        if (tf.includes('scaleX(-1)')) continue; // 已是镜像：不重复叠加
        try { el.style.transform = ('scaleX(-1) ' + tf).trim(); } catch { /* ignore */ }
      } else {
        try { el.style.transform = tf.replace(/scaleX\(-1\)\s*/g, '').trim(); } catch { /* ignore */ }
      }
    }
  };
}

const petLinkState = {
  available: null, reason: '', probing: null,
  lastKey: '', lastAt: -Infinity, tugAt: -Infinity,
  queue: [], playing: false, readyAt: 0, timer: null, epoch: 0,
  runner: null, farCount: 0, nearCount: 0, animLockName: '',
  // 调参面板的覆盖层（用户口径 2026-10-15）：空对象 = 行为与没有面板时逐字相同。
  // 面板只写这里，排播只经 petLinkTune() 读 —— 这是"调试"与"悄悄改时序"的分界线。
  tuning: {},
};

const petLinkRuntime = { started: false, superseded: false, token: 0, timer: null, expiry: null,
  lease: null, ctl: null, root: null, requests: new Set(), waits: new Set(), frames: new Set() };
const PET_LINK_RUNTIME_KEY = '__dshwePetLinkRuntime';
const petLinkRuntimeOwner = { dispose() { petLinkRuntime.superseded = true; petLink.dispose(); } };

function petLinkControlReady(ctl, root) {
  try {
    if (!ctl || ctl.version !== 3 || ctl.target !== PET_TARGET || !root || root.isConnected === false
        || typeof ctl.getRoot !== 'function' || ctl.getRoot() !== root) return false;
    const required = ['getPlayback', 'lock', 'unlock', 'lockBubbles', 'unlockBubbles', 'hideBubble',
      'allowBubble', 'setBubbleDuration', 'adoptPosition', 'throwNative', 'getNativeThrow', 'stopNativeThrow'];
    if (!required.every(key => typeof ctl[key] === 'function')) return false;
    const rect = root.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    if (typeof getComputedStyle === 'function') {
      const css = getComputedStyle(root);
      if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
    }
    return true;
  } catch { return false; }
}

function petLinkEligible() {
  const rt = petLinkRuntime;
  const valid = Boolean(rt.lease && petLinkNow() < rt.lease.expires
    && typeof window !== 'undefined' && window.__dshPetCtl === rt.ctl
    && petLinkControlReady(rt.ctl, rt.root));
  if (!valid && rt.lease) petLinkCancel(weT('桌宠运行资格失效'));
  return valid;
}

/** 只归还当前代已取得的资源；清理期间仍使用固定的旧控制面和根元素。 */
function petLinkCancel(reason = '') {
  const rt = petLinkRuntime;
  const hadLease = Boolean(rt.lease);
  petLinkState.epoch++;
  if (rt.expiry !== null) clearTimeout(rt.expiry);
  rt.expiry = null; rt.lease = null;
  for (const cancel of [...rt.requests]) cancel();
  for (const cancel of [...rt.frames]) cancel();
  for (const cancel of [...rt.waits]) cancel();
  if (petLinkState.lockHeartbeat != null) clearInterval(petLinkState.lockHeartbeat);
  petLinkState.lockHeartbeat = null;
  if (hadLease && petLinkState.cancelGesture) petLinkState.cancelGesture();
  if (petLinkState.egg2Release) petLinkState.egg2Release();
  if (petLinkState.sidebarRelease) petLinkState.sidebarRelease();
  if (petLinkState.ropeRelease) petLinkState.ropeRelease();
  if (petLinkState.bubbleRun) petLinkState.bubbleRun.cancel();
  if (petLinkState.bubbleHeld) petLinkBubbleLock(false);
  if (petLinkState.releaseFacing) { petLinkState.releaseFacing(); petLinkState.releaseFacing = null; }
  petLinkEggCleanup();
  if (petLinkState.offset && (petLinkState.offset.x || petLinkState.offset.y)) {
    if (!petLinkHandoffPosition()) petLinkResetOffset();
  }
  if (petLinkState.animLockName) petLinkAnimUnlock();
  if (petLinkState.timer !== null) clearTimeout(petLinkState.timer);
  for (const item of petLinkState.queue) item.resolve(false);
  petLinkState.queue = []; petLinkState.timer = null; petLinkState.playing = false;
  petLinkState.available = null; petLinkState.probing = null; petLinkState.reason = reason;
  petLinkState.readyAt = 0; petLinkState.lastKey = ''; petLinkState.tugAt = -Infinity;
  const sidebar = petLinkState.runner?.sidebar || null;
  petLinkState.runner = { busy: false, sidebar };
  rt.ctl = null; rt.root = null;
  petTunerSyncRuntime();
}

function petLinkRuntimeStart() {
  const rt = petLinkRuntime;
  if (rt.superseded || typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return Promise.resolve(false);
  petTunerInstallHotkey();
  if (rt.started) return petLinkProbe();
  if (typeof window !== 'undefined') {
    const previous = window[PET_LINK_RUNTIME_KEY];
    if (previous && previous !== petLinkRuntimeOwner) previous.dispose();
    window[PET_LINK_RUNTIME_KEY] = petLinkRuntimeOwner;
  }
  rt.started = true;
  const token = ++rt.token;
  const tick = async () => {
    if (!rt.started || rt.token !== token) return false;
    const ok = await petLinkProbe();
    if (rt.started && rt.token === token) rt.timer = setTimeout(tick, 500);
    return ok;
  };
  return tick();
}

function petLinkNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}
function petLinkFrame(callback, resolve) {
  const native = typeof requestAnimationFrame === 'function';
  const release = () => {
    petLinkRuntime.frames.delete(release);
    if (native && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id);
    resolve(false);
  };
  const run = () => { petLinkRuntime.frames.delete(release); callback(); };
  const id = native ? requestAnimationFrame(run) : setTimeout(run, 16);
  petLinkRuntime.frames.add(release);
}
function petLinkWait(ms) {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); petLinkRuntime.waits.delete(finish); resolve(); };
    const timer = setTimeout(finish, ms);
    petLinkRuntime.waits.add(finish);
  });
}
/** 超时直接收尾；即使缺 AbortController 或底层请求忽略 abort 也能 resolve。 */
function petLinkRequest(path, init, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let controller = null;
    const epoch = petLinkState.epoch;
    const cancel = () => { finish(null); try { if (controller) controller.abort(); } catch { /* 已退出 */ } };
    const finish = value => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      petLinkRuntime.requests.delete(cancel);
      resolve(epoch === petLinkState.epoch ? value : null);
    };
    petLinkRuntime.requests.add(cancel);
    try {
      if (typeof fetch !== 'function') return finish(null);
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      timer = setTimeout(() => {
        finish(null);
        try { if (controller) controller.abort(); } catch { /* 已收尾 */ }
      }, timeoutMs);
      const url = String(path).startsWith(PET_BASE) ? location.origin + path : path;
      Promise.resolve(apiFetch(url, { ...init, signal: controller ? controller.signal : undefined }))
        .then(result => {
          if (done || epoch !== petLinkState.epoch) return finish(null);
          const data = result && result.ok ? result.data : null;
          if (data && data.ok === true && init && init.method === 'POST'
              && String(path).startsWith(PET_BASE)) {
            // 仍通过原 HTTP 状态协议播放，只唤醒已有轮询，不直通视频控制。
            try {
              const ctl = petLinkPetCtl();
              if (ctl && typeof ctl.pollState === 'function') ctl.pollState();
            } catch { /* 旧版控制面或刷新失败不影响请求结果 */ }
          }
          finish(data);
        }, () => finish(null));
    } catch { finish(null); }
  });
}
function petLinkGetJson(path, timeoutMs) {
  return petLinkRequest(path, { cache: 'no-store' }, timeoutMs);
}
function petLinkPost(path, body, timeoutMs) {
  return petLinkRequest(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, timeoutMs).then(result => Boolean(result && result.ok === true));
}
/** 宿主资格与当前网页实例双重核验；有效期从请求发出时起算。 */
function petLinkProbe() {
  const rt = petLinkRuntime;
  if (petLinkState.probing) return petLinkState.probing;
  const epoch = petLinkState.epoch, token = rt.token, started = petLinkNow();
  const promise = (async () => {
    let reason = weT('桌宠运行资格不可用');
    try {
      const cap = await petLinkGetJson(apiUrl('/pet-link/capability'), 800);
      const names = Object.values(PET_ANIM);
      const compatible = cap && cap.protocol === 1 && typeof cap.generation === 'string' && cap.generation
        && cap.enabled === true && cap.linkEnabled === true && cap.available === true
        && cap.target === PET_TARGET && cap.petBase === PET_BASE && cap.ttlMs === 1500
        && Array.isArray(cap.names) && names.every(name => cap.names.includes(name));
      if (epoch !== petLinkState.epoch || token !== rt.token) return false;
      if (!compatible) { reason = cap?.reason || reason; throw new Error(reason); }
      if (rt.lease && rt.lease.generation !== cap.generation) {
        petLinkCancel(weT('桌宠桥接会话已替换')); return false;
      }
      const ctl = typeof window !== 'undefined' ? window.__dshPetCtl : null;
      const root = ctl && typeof ctl.getRoot === 'function' ? ctl.getRoot() : null;
      if (rt.lease && (rt.ctl !== ctl || rt.root !== root)) {
        petLinkCancel(weT('桌宠实例已替换')); return false;
      }
      const cfg = await petLinkGetJson(PET_BASE + '/config', 800);
      if (epoch !== petLinkState.epoch || token !== rt.token) return false;
      const main = cfg && cfg.main;
      const pool = main?.animations?.events?.DSHWE;
      const pet = Array.isArray(main?.pets) && main.pets.find(row => row?.id === PET_TARGET);
      if (!pet || !['web', 'both'].includes(pet.display) || !Array.isArray(pool)
          || !names.every(name => pool.flat().includes(name)) || !petLinkControlReady(ctl, root)
          || window.__dshPetCtl !== ctl || petLinkNow() >= started + cap.ttlMs) throw new Error(reason);
      rt.ctl = ctl; rt.root = root;
      rt.lease = { generation: cap.generation, expires: started + cap.ttlMs };
      petLinkPool.names = pool.flat(); petLinkState.available = true; petLinkState.reason = '';
      if (rt.expiry !== null) clearTimeout(rt.expiry);
      rt.expiry = setTimeout(() => petLinkCancel(weT('桌宠运行资格已过期')), rt.lease.expires - petLinkNow());
      petLinkState.fallbackReason = '';
      petTunerSyncRuntime();
      return true;
    } catch (error) {
      if (epoch === petLinkState.epoch && token === rt.token) petLinkCancel(error.message || reason);
      return false;
    }
  })();
  petLinkState.probing = promise;
  promise.finally(() => { if (petLinkState.probing === promise) petLinkState.probing = null; });
  return promise;
}
/** 队列只承载动画，不进入面板事件处理链。 */
function petLinkDrain() {
  if (petLinkState.playing || petLinkState.timer !== null || !petLinkState.queue.length) return;
  const wait = Math.max(0, petLinkState.readyAt - petLinkNow());
  if (wait > 0) {
    petLinkState.timer = setTimeout(() => { petLinkState.timer = null; petLinkDrain(); }, wait);
    return;
  }
  const item = petLinkState.queue.shift();
  const epoch = petLinkState.epoch;
  petLinkState.playing = true;
  // 标记"这段动作已经真的发出去了" —— 供 petLinkPlayStarted 等待（见那里说明）
  if (typeof item.onStart === 'function') { try { item.onStart(); } catch { /* 通知失败不影响播放 */ } }
  const ctl = petLinkPetCtl();
  let previousId = -1;
  try { if (ctl && typeof ctl.getPlayback === 'function') previousId = ctl.getPlayback().id; } catch { /* 旧控制面降级。 */ }
  petLinkPost(PET_BASE + '/anim?pet=' + encodeURIComponent(PET_TARGET),
    { name: item.name }, PET_PLAY_TIMEOUT).then(async ok => {
    const started = ok && epoch === petLinkState.epoch
      && await petLinkWaitPlayback(item.name, false, epoch, previousId);
    item.resolve(Boolean(started));
    if (epoch !== petLinkState.epoch) return;
    petLinkState.playing = false;
    petLinkState.readyAt = started ? petLinkNow() + (item.hold > 0 ? item.hold : petLinkTune('segGapMs')) : petLinkNow();
    petLinkDrain();
  });
}
/** 联动流程是否正在跑（busy 期间我方外部入口一律静默，见 `petLinkPlay` 的优先级纪律）。 */
function petLinkIsBusy() {
  return Boolean(petLinkState.runner && petLinkState.runner.busy);
}

/** 点播一段动作（串行队列）。which 是 PET_ANIM 里的键。
 *  增强动作缺素材时按 PET_FALLBACK 顶替（顶替也没有 → 跳过，不报错）。
 *  `opts.onStart` 在该段**真正发出请求**时回调（不是播完）——用于"气泡要在动作过程中弹"
 *  这类时序编排（见彩蛋的走回段）。
 *
 *  ── 优先级纪律（用户口径 2026-10-14「dshwe 动效执行期间不希望有别的动效插入」）──
 *  ⚠️ 这条口径**已在 2026-10-15 落地**，靠的是 dsh-pet 侧的补丁（见 `petLinkAnimLock`）：
 *     补丁在 dsh-pet 渲染半里给四条通道都加了闸门 —— 动画 `setAnim`、重播通道 `setSeq`、
 *     三个气泡 setter、走位 `tryMove`、以及点击/拖拽 `handlePointerDown`；
 *     并且对"正在播的段属于 DSHWE 池"**自动上独占**（`selfPool`），所以连**右键菜单
 *     直接点播**那条不经过本模块的路径也会被独占住。段播完由 `handleEnded` 自动释放。
 *
 *  · **本函数负责的部分**：① 在"确实要播"之后立刻 `petLinkAnimLock(name)`（下详）；
 *    ② 让我方自己**绝不**在流程进行中插话 —— 所有我方入口（吉祥物点击、绳子的
 *    抓握/使劲/松手手势）在流程 busy 时一律静默，避免"流程演到一半被另一段手势
 *    动作顶掉"。③ 防气泡被自己的锁误伤：`petLinkSay` 里先开 `allowBubble` 窗口。
 *
 *  · **静默降级**：补丁缺席（用户没跑注入工具 / dsh-pet 换版）时 `petLinkAnimLock`
 *    一路 `typeof` 探测失败返回 false，本模块照常工作，只是回到"拦不住别人"的旧行为。
 *
 *  `opts.internal` 标记"这是我方流程自己在编排"——只有内部调用允许在 busy 期间发动作，
 *  否则流程自己都发不出下一段。外部手势（performer）不传它，因此天然被闸住。 */
/** 某段动作的停留时长：走调参覆盖层（目前只有后拉段暴露）。
 *  传 `fallback` 时优先用它（调用点自己按**实际播出的名字**查过表）。 */
function petLinkHoldOf(which, fallback) {
  const keys = { pull: 'pullMs', mascotTumble: 'mascotTumbleMs', eggKick: 'egg1KickMs',
    eggFlung: 'egg1FlungMs', eggLand: 'egg1LandMs', eggHiss: 'egg2HissMs' };
  if (Object.prototype.hasOwnProperty.call(keys, which)) {
    const tuned = petLinkTune(keys[which]);
    if (Number.isFinite(tuned)) return Math.max(0, tuned);
  }
  if (Number.isFinite(fallback)) return fallback;
  return PET_HOLD[which];
}
function petLinkPlay(which, opts) {
  let name = PET_ANIM[which];
  if (!name) return Promise.resolve(false);
  const internal = Boolean(opts && opts.internal);
  if (!internal && petLinkIsBusy()) return Promise.resolve(false);
  const pool = petLinkPool.names;
  if (pool.length && !pool.includes(name)) {
    const alt = PET_FALLBACK[which];
    if (!alt) return Promise.resolve(false);
    name = alt;
  }
  const gap = opts && Number.isFinite(opts.gap) ? opts.gap : 120;
  const hold = opts && Number.isFinite(opts.hold) ? opts.hold : petLinkHoldOf(which);
  const onStart = opts && typeof opts.onStart === 'function' ? opts.onStart : null;
  const now = petLinkNow();
  if (petLinkState.lastKey === name && now - petLinkState.lastAt < gap) return Promise.resolve(false);
  petLinkState.lastKey = name;
  petLinkState.lastAt = now;
  const epoch = petLinkState.epoch;
  return petLinkProbe().then(ok => {
    if (!ok || epoch !== petLinkState.epoch) return false;
    // 队列上限：并发堆积超过 8 段说明编排出了错（正常路径每段都 await 完才发下一段）。
    if (petLinkState.queue.length >= 8) return false;
    // ⚠️ **上锁必须在"确实要播"之后**，不能放在探测之前 —— 踩过的坑：
    //    探测失败（或池里没这段、被闸门挡下）时若已经上了锁，宠物就会被锁在一段
    //    **永远不播**的动作上，直到补丁的 TTL 兜底过期（最坏 60s 内所有随机行为被闸掉）。
    //    所以顺序是"先确认这一发真的会进队列，再上锁"。
    petLinkAnimLock(name);
    // 记下"当前锁是谁"，供 petLinkRun 的**心跳续期**使用（停留阶段没有点播，
    // 不续期的话锁会到点过期 —— 见 petLinkRun 里 lockHeartbeat 的说明）。
    petLinkState.animLockName = name;
    return new Promise(resolve => {
      petLinkState.queue.push({ name, hold, resolve, onStart });
      petLinkDrain();
    });
  }).catch(() => false);
}
/** 让宠物说一句（dsh-pet 的 /broadcast 写 pets.<id>.say，两端共用同一气泡）。
 *
 *  `image` 是**可选**的表情包名（= 宠物配置 `memes` 池里的键，由 `inject-assets` 工具登记）。
 *
 *  ⚠️ 降级纪律（**必须**，不是可选优化）：宿主对**池外**配图的处理是 `unknown-image` +
 *  **整条拒收** —— 连文字都不写进气泡（见 dsh-pet 的 `broadcast.ts` 与 `POST /broadcast` 路由）。
 *  所以带图发送一旦失败，必须**自动重发一次纯文字**，否则用户看到的是"点了没反应"。
 *  这也覆盖了"用户还没跑注入工具"的情况：配图缺失只损失图，文案永不丢。
 *
 *  ⚠️ **先开"允许气泡"窗口再发**（独占锁会把气泡一并拦下，用户口径"包括任何气泡"）：
 *  开窗这件事放在本函数里，而不是每个调用点各写一遍 —— 调用点有 5 处，
 *  漏一处就会出现"这条气泡被自己的锁拦掉"（观感是"该说话时没反应"，很难查）。
 *  @returns 是否至少送达了一次（带图成功，或降级纯文字成功） */
function petLinkSay(text, image) {
  const url = PET_BASE + '/broadcast?pet=' + encodeURIComponent(PET_TARGET);
  // 开窗（补丁缺席时是空操作）：窗口默认 4s，要盖住宿主 1s 的 /state 轮询延迟。
  petLinkAllowBubble(petLinkTune('bubbleWindowMs'));
  const key = typeof image === 'string' ? image.trim() : '';
  if (!key) return petLinkPost(url, { text }, PET_SAY_TIMEOUT);
  return petLinkRequest(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, image: key }),
  }, PET_SAY_TIMEOUT).then(body => {
    // ⚠️ `petLinkRequest` 已经把 `apiFetch` 的外层对象拆掉了：它 resolve 的是
    //    **载荷本身**（`result.data`），不是 `{ ok, status, data }`。
    //    所以这里只能读载荷里的 `ok` —— 曾误写成 `result.data`（恒 undefined）⇒ 带图
    //    明明成功也被判失败、紧接着补发纯文字，把带图气泡**顶掉**（真机实测：
    //    同一秒内 `{text,image}` 与 `{text}` 各一条，用户最终看到的是没图的那条）。
    //    宿主对池外配图回的是 **HTTP 200 + {ok:false, reason:'unknown-image'}**，
    //    因此判据只能是载荷的 `ok`，不是 HTTP 状态。
    const accepted = Boolean(body && body.ok === true);
    if (accepted) return true;
    // 带图被拒（unknown-image / 网络问题 / 超时）⇒ 退回纯文字，保证文案送达。
    return petLinkPost(url, { text }, PET_SAY_TIMEOUT);
  });
}
/** 直接驱动宠物元素走到视口比例位置；返回是否真的动了。 */
function petLinkPetEl() {
  try {
    if (petLinkRuntime.root) return petLinkRuntime.root;
    if (petLinkRuntime.started) return null;
    if (typeof document === 'undefined' || !document.querySelector) return null;
    return document.querySelector('.dsh-pet-root');
  } catch { return null; }
}
function petLinkPetRect() {
  const el = petLinkPetEl();
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  try {
    const r = el.getBoundingClientRect();
    return r && Number.isFinite(r.left) ? r : null;
  } catch { return null; }
}
/** 人物**身体**（命中框 `.dsh-pet-hit`）的当前 rect —— 贴边口径的唯一来源。
 *  取不到命中框（dsh-pet 改了结构 / 未渲染）时按 `HIT_BOX` 比例从画布 rect 推出
 *  身体框，**绝不**退回画布边界：画布左右是透明留白，拿它当身体会误判"已贴边"。 */
function petLinkBodyRect() {
  try {
    if (typeof document !== 'undefined' && document.querySelector) {
      const el = document.querySelector('.dsh-pet-hit');
      if (el && typeof el.getBoundingClientRect === 'function') {
        const r = el.getBoundingClientRect();
        if (r && Number.isFinite(r.left)) return r;
      }
    }
  } catch { /* 落回按比例推算 */ }
  const rect = petLinkPetRect();
  if (!rect) return null;
  const left = rect.left + rect.width * PET_BODY_LEFT_RATIO;
  const width = rect.width * (PET_BODY_RIGHT_RATIO - PET_BODY_LEFT_RATIO);
  return {
    left, right: left + width, width,
    top: rect.top, height: rect.height,
    x: left, y: rect.top, bottom: rect.top + rect.height,
  };
}
/** 身体右边缘相对**画布中心**的偏移（含画布右侧那段透明留白；`size = 462` 时约 86.6px）。
 *  优先用真实命中框**量**出来（dsh-pet 改了尺寸或比例也不会算错），取不到才按
 *  `HIT_BOX` 常量推 —— 两条路都指向"身体"，绝不指向画布边界。
 *  ⚠️ 量测分支要求 `canvas` 带 `left`（能算出中心）；只给宽度的调用方（`petLinkStops`
 *  里还没有 rect 的那一步）走常量分支。两条分支的**单位都是"相对画布中心的偏移"**，
 *  所以调用方传含自身 transform 的 rect 也不会算漂（两边等量平移，差值恒定）。 */
function petLinkBodyRightOffset(canvas) {
  const size = canvas && Number.isFinite(canvas.width) ? canvas.width : 0;
  if (canvas && Number.isFinite(canvas.left)) {
    const body = petLinkBodyRect();
    if (body && Number.isFinite(body.right)) return body.right - (canvas.left + size / 2);
  }
  return size * (PET_BODY_RIGHT_RATIO - 0.5);
}
/** 让**身体右边缘**落在 `edge` 所需的画布中心 x。
 *  画布中心 = 身体右边缘 − 身体右边缘相对画布中心的偏移。 */
function petLinkCenterForBodyRight(edge, rect) {
  return edge - petLinkBodyRightOffset(rect);
}
/** 让**手右边缘**落在 `edge` 所需的画布中心 x（贴边口径，用户口径 2026-10-15）。
 *
 *  实现 = 身体口径打底 + 补上"身体框右边缘到手掌"那段实测留白：
 *  `PET_BODY_RIGHT_RATIO − PET_HAND_RIGHT_RATIO` 就是旧精灵命中框与真实手位
 *  之间的差（正值 = 手比命中框更靠内，需要把宠物再往右推回来）。
 *  复用身体口径有两个好处：① 保留 `.dsh-pet-hit` 量测分支（dsh-pet 改结构/尺寸时
 *  仍能自适应）；② 参照系继续只有"画布中心"一个，目标与基准同源才收敛。
 *
 *  注意签名里**没有段名**：手位比例是单点常量（见 PET_HAND_RIGHT_RATIO 的注释），
 *  贴边全程用同一个值 —— 走位、蓄力、后拉三段的手位差就让它表现为"手指/手腕
 *  在边缘上滑动"，而不是让宠物来回抽动。 */
function petLinkCenterForHandRight(edge, rect) {
  const body = petLinkCenterForBodyRight(edge, rect);
  const size = rect && Number.isFinite(rect.width) ? rect.width : 0;
  return body + size * (PET_BODY_RIGHT_RATIO - petLinkTune('handRightRatio'));
}
/** 把宠物挪到目标中心点（视口坐标）。
 *  ⚠️ 用 `transform: translate()` 而不是 left/top：dsh-pet 的 React 拥有 inset
 *  （left/top/right/bottom）并在每次重渲染时重写，直接改 left/top 会被它覆盖成
 *  "一跳一跳"（实测：3 次 100–200px 瞬移）。root 上的 transform 它不写。
 *
 *  基准每次现算（不缓存）：`rect` 已含我们写的 transform，减掉自己的 offset 就是
 *  "未偏移中心"。缓存基准会被 dsh-pet 自身的走位弄过期。
 *
 *  ⚠️ **参照系只有画布中心一个**：`toX` 全部由 `petLinkCenterForHandRight()` 从
 *  "手右边缘该落在哪"换算而来，基准也用画布中心 —— 两者同源才收敛。二者等价性：
 *  `手右边缘 = 画布中心 + size × (PET_HAND_RIGHT_RATIO − 0.5)`，offset 对两边等量平移。 */
function petLinkGlide(rect, toX, toY, ms, alive) {
  const el = petLinkPetEl();
  if (!el || !el.style) return Promise.resolve(false);
  const off = petLinkState.offset || { x: 0, y: 0 };
  const baseX = rect.left + rect.width / 2 - off.x;
  const baseY = rect.top + rect.height / 2 - off.y;
  const toOffX = toX - baseX;
  const toOffY = toY - baseY;
  const fromOffX = off.x;
  const fromOffY = off.y;
  const duration = Math.max(1, Number.isFinite(ms) ? ms : 600);
  const started = petLinkNow();
  return new Promise(resolve => {
    const step = () => {
      if (alive && !alive()) { resolve(false); return; }
      const t = Math.min(1, (petLinkNow() - started) / duration);
      // easeInOutQuad：起步与收尾都软，避免瞬移感
      const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = fromOffX + (toOffX - fromOffX) * k;
      const y = fromOffY + (toOffY - fromOffY) * k;
      petLinkState.offset = { x, y };
      try {
        el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      } catch { /* 样式写失败不影响流程 */ }
      if (t >= 1) { resolve(true); return; }
      petLinkFrame(step, resolve);
    };
    petLinkFrame(step, resolve);
  });
}
/** 只写 transform 偏移（跟随面板边缘时逐帧调用；不碰 React 拥有的 left/top）。 */
function petLinkElStyleX(x, y) {
  const el = petLinkPetEl();
  if (!el || !el.style) return;
  el.style.transform = 'translate(' + Number(x).toFixed(1) + 'px,' + Number(y).toFixed(1) + 'px)';
}
/** 归还偏移：**不在驱动宠物时，元素上必须没有我们写的位移**（见 `petLinkReturnHome`）。
 *  异常路径与 dispose 用它做即时收尾 —— 宁可瞬间归位，也绝不把偏移留在元素上。 */
function petLinkResetOffset() {
  petLinkState.offset = { x: 0, y: 0 };
  const el = petLinkPetEl();
  if (!el || !el.style) return;
  try { el.style.transform = 'translate(0.0px,0.0px)'; } catch { /* 样式写失败不影响流程 */ }
}
/** 收尾：把偏移**滑回零**（= 触发前位置），而不是滑到某个记录下来的坐标。
 *
 *  ⚠️ 为什么必须回到"偏移零"而不是"home 坐标"：home 坐标是流程开始时量到的**视口位置**，
 *  而 dsh-pet 自己也会走位（漫游 / 物理），等我们收尾时它的 `left/top` 早已换了锚点。
 *  滑到旧坐标 ⇒ 我们留下一个**非零**的 transform；dsh-pet 的拖拽只写 `left/top`
 *  （见 pet.ts 的 `startDragFollow`），不认识 root 上的 transform，于是两者叠加成
 *  "拖宠物不跟手、恒定偏向一侧（实测残 `translate(-285.8px,-580.1px)` ⇒ 往左上角跑）"。
 *  偏移归零即"触发前位置"（本模块只**加**偏移，从不改它的 left/top），既修拖拽也修观感。 */
function petLinkReturnHome(ms) {
  const rect = petLinkPetRect();
  if (!rect) { petLinkResetOffset(); return Promise.resolve(false); }
  const off = petLinkState.offset || { x: 0, y: 0 };
  // 目标 = 未偏移中心本身 ⇒ 目标偏移恒为 {0,0}
  const baseX = rect.left + rect.width / 2 - off.x;
  const baseY = rect.top + rect.height / 2 - off.y;
  return petLinkGlide(rect, baseX, baseY, Number.isFinite(ms) ? ms : 600);
}
/** 边缘"仍在动"的最小位移（px）：与 follow 循环的静止判据同量级（它用 0.5px/140ms）。 */
const PET_FOLLOW_STILL_EPS = 0.5;

/** 拉出是否**仍在进行**（= 边缘还在动）。用于「跟随拉出过程」的停止判据。
 *
 *  为什么不用"面板是否已展开"：宿主展开的 DOM 状态在我们 commit 之前就已经是"开"，
 *  用它当判据会在拉出刚开始时就停。**边缘是否还在移动**才是"还在拉"的真实信号。
 *  取不到边缘时返回 false（= 视为已结束，不空转）。 */
function petLinkSidebarPullActive(api) {
  const edgeX = api && typeof api.edgeX === 'function' ? api.edgeX : null;
  if (!edgeX) return false;
  let live = null;
  try { live = edgeX(); } catch { return false; }
  if (!Number.isFinite(live) || live <= 0) return false;
  const prev = petLinkState.pullEdge;
  petLinkState.pullEdge = live;
  if (prev === null || prev === undefined) return true; // 第一帧：还在拉
  return Math.abs(live - prev) >= petLinkTune('followStillEps');
}

/** 吉祥物本体元素（下拉/弹回的目标）。 */
function petLinkRopeEl() {
  try {
    if (typeof document === 'undefined' || !document.querySelector) return null;
    return document.querySelector('.we-rope');
  } catch { return null; }
}

// ── 气泡控制（配套 dsh-pet 渲染半补丁；补丁缺席时全部静默降级）─────────────
//
//  ⚠️ 为什么走"页内控制面"而不是改 dsh-pet 的路由：
//  dsh-pet 的气泡时长是宿主里硬编码的常量，`pets.<id>.say` 又是**只写**叶子 ——
//  没有"收回气泡"的接口。但 dsh-pet 的渲染半侧与墙纸插件**跑在同一个页面**里，
//  所以 bridge 的补丁在那边挂一个 `window.__dshPetCtl`，我们直接调用即可。
//  这比改宿主的 host 路由干净得多：不需要新端点、不碰它的状态叶子、卸载即失效。

/** 取页内控制面；不在场（没打补丁 / 补丁版本旧）返回 null。 */
function petLinkPetCtl() {
  try {
    if (petLinkRuntime.ctl) return petLinkRuntime.ctl;
    if (petLinkRuntime.started) return null;
    const ctl = typeof window !== 'undefined' ? window.__dshPetCtl : null;
    return ctl && typeof ctl === 'object' ? ctl : null;
  } catch { return null; }
}

/** 点播成功不等于视频开播；只接受当前这一发的播放回执。 */
async function petLinkWaitPlayback(name, ended, epoch, afterId = -1, alive) {
  const ctl = petLinkPetCtl();
  if (!ctl || typeof ctl.getPlayback !== 'function') return true;
  const started = petLinkNow();
  let budget = ended ? 25000 : 15000;
  while (epoch === petLinkState.epoch && (!alive || alive())) {
    let playback;
    try { playback = ctl.getPlayback(); } catch { return false; }
    if (playback && playback.name === name && playback.id > afterId) {
      if (playback.phase === 'failed') return false;
      if (ended && playback.phase === 'ended') return true;
      if (!ended && playback.phase === 'playing') return true;
      if (!ended && playback.phase === 'ended') return false;
      if (ended && Number.isFinite(playback.duration) && playback.duration > 0)
        budget = Math.min(120000, Math.max(budget, playback.duration * 1000 + 3000));
    }
    if (petLinkNow() - started >= budget) return false;
    await petLinkWait(16);
  }
  return false;
}

/** 哈气特效只读取同一视频代的实际时间，不用墙钟预测展开终点。 */
async function petLinkEggHissMotion(alive) {
  const ctl = petLinkPetCtl();
  if (!ctl || typeof ctl.getPlayback !== 'function') return false;
  const initial = ctl.getPlayback();
  if (!initial || initial.name !== PET_ANIM.eggHiss || initial.phase !== 'playing') return false;
  const playbackId = initial.id;
  if (petLinkState.egg2Release) petLinkState.egg2Release();
  const epoch = petLinkState.epoch;
  const api = petLinkState.runner && petLinkState.runner.sidebar;
  const strength = Math.max(0, Math.min(40, petLinkTune('egg2ShakePx', 'egg2')));
  const frequency = Math.max(0, Math.min(30, petLinkTune('egg2ShakeHz', 'egg2')));
  const shakeAt = Math.max(0, petLinkTune('egg2ShakeAtMs', 'egg2')) / 1000;
  const openAt = Math.max(0, Math.min(1, petLinkTune('egg2OpenAtPct', 'egg2') / 100));
  const easing = petLinkTune('egg2OpenEase', 'egg2');
  const started = petLinkNow();
  const root = typeof document !== 'undefined' && document.documentElement;
  let shake = null, sidebar = null, released = false;
  const clipped = [];
  const release = () => {
    if (released) return;
    released = true;
    if (shake) shake.cancel();
    if (sidebar) sidebar.cancel();
    for (const [key, value, priority] of clipped) {
      if (root.style.getPropertyValue(key) !== 'clip' || root.style.getPropertyPriority(key) !== 'important') continue;
      if (value) root.style.setProperty(key, value, priority); else root.style.removeProperty(key);
    }
    if (petLinkState.egg2Release === release) petLinkState.egg2Release = null;
  };
  const begin = () => {
    if (!sidebar && api && typeof api.syncOpen === 'function') sidebar = api.syncOpen();
  };
  petLinkState.egg2Release = release;
  try {
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const beginShake = () => {
      if (shake || reduced || strength <= 0 || frequency <= 0 || !root || typeof root.animate !== 'function') return;
      if (root.style) for (const key of ['overflow-x', 'overflow-y']) {
        clipped.push([key, root.style.getPropertyValue(key), root.style.getPropertyPriority(key)]);
        root.style.setProperty(key, 'clip', 'important');
      }
      const y = strength * .625;
      shake = root.animate([
        { translate: '0px 0px' }, { translate: strength + 'px ' + -y + 'px' },
        { translate: -strength + 'px ' + y + 'px' }, { translate: strength * .5 + 'px ' + y + 'px' },
        { translate: -strength * .5 + 'px ' + -y + 'px' }, { translate: '0px 0px' },
      ], { duration: 1000, iterations: Infinity, composite: 'add', easing: 'linear' });
      shake.pause();
    };
    while (!released && epoch === petLinkState.epoch && alive()) {
      const p = ctl.getPlayback();
      if (!p || p.id !== playbackId || p.name !== PET_ANIM.eggHiss || p.phase === 'failed') return false;
      if (p.phase === 'ended') {
        begin();
        if (sidebar) sidebar.finish();
        else if (api && typeof api.open === 'function') api.open();
        return true;
      }
      if (Number.isFinite(p.currentTime)) {
        if (p.currentTime >= shakeAt) beginShake();
        if (shake) shake.currentTime = Math.max(0, p.currentTime - shakeAt) * frequency * 1000;
        if (Number.isFinite(p.duration) && p.duration > 0) {
          const progress = Math.max(0, Math.min(1, p.currentTime / p.duration));
          if (progress >= openAt && openAt < 1) {
            begin();
            const t = Math.min(.999, (progress - openAt) / (1 - openAt));
            const eased = easing === 1 ? t * t * (3 - 2 * t) : easing === 2 ? 1 - Math.pow(1 - t, 3) : t;
            if (sidebar) sidebar.seek(Math.min(.999, eased));
          }
        }
      }
      const budget = Number.isFinite(p.duration) && p.duration > 0
        ? Math.min(120000, Math.max(25000, p.duration * 1000 + 3000)) : 25000;
      if (petLinkNow() - started >= budget) return false;
      await new Promise(resolve => petLinkFrame(() => resolve(true), resolve));
    }
    return false;
  } catch { return false; }
  finally { release(); }
}

/** 已开播素材的剩余时长只用于节点预测，真正结束仍以 ended 为准。 */
function petLinkPlaybackRemaining(name, fallback) {
  const ctl = petLinkPetCtl();
  if (!ctl || typeof ctl.getPlayback !== 'function') return fallback;
  try {
    const p = ctl.getPlayback();
    if (p.name === name && Number.isFinite(p.duration) && p.duration > 0 && Number.isFinite(p.currentTime))
      return Math.max(0, (p.duration - p.currentTime) * 1000);
  } catch { /* 元数据暂不可用时沿用排播时长。 */ }
  return fallback;
}

/** 结束一段接管；清续期标记先于解锁，迟到心跳不能把已释放的动作锁回来。 */
async function petLinkFinishAction(alive) {
  const epoch = petLinkState.epoch;
  const name = petLinkState.animLockName;
  if (name) await petLinkWaitPlayback(name, true, epoch, -1, alive);
  if (epoch !== petLinkState.epoch) return false;
  petLinkAnimUnlock();
  if (petLinkState.releaseFacing) { petLinkState.releaseFacing(); petLinkState.releaseFacing = null; }
  return true;
}

/** 在同一任务内把可见中心交还给原生位置状态，清 transform 不再造成跳变。 */
function petLinkHandoffPosition() {
  const ctl = petLinkPetCtl();
  const rect = petLinkPetRect();
  if (!ctl || typeof ctl.adoptPosition !== 'function' || !rect) return false;
  try {
    if (!ctl.adoptPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })) return false;
    petLinkResetOffset();
    return true;
  } catch { return false; }
}

function petLinkBubbleLock(locked) {
  const ctl = petLinkPetCtl();
  const key = locked ? 'lockBubbles' : 'unlockBubbles';
  if (!ctl || typeof ctl[key] !== 'function') return false;
  try {
    const ok = Boolean(ctl[key](Math.max(60000, petLinkTune('holdMaxMs') + 120000)));
    if (ok) petLinkState.bubbleHeld = locked;
    return ok;
  } catch { return false; }
}

/** 设定气泡展示时长（ms）。补丁缺席 ⇒ 什么都不做（气泡按宿主默认 10s 自行消失）。 */
function petLinkBubbleDuration(ms) {
  const ctl = petLinkPetCtl();
  if (!ctl || typeof ctl.setBubbleDuration !== 'function') return false;
  try { ctl.setBubbleDuration(ms); return true; } catch { return false; }
}

// ── 独占锁（配套 dsh-pet 渲染半补丁；补丁缺席时静默降级）─────────────────────
//
//  用户口径（2026-10-15）：「只要一进入 DSHWE 的动画开始就**拒绝所有输入**，
//  包括动画以及任何气泡。到结束才允许释放。」
//
//  ⚠️ 为什么必须在 dsh-pet 打补丁：宿主有**三条平行通道**，彼此没有优先级语义 ——
//   ① 动画：十几个 `setAnim` 调用点（随机链 / 点击 / 拖拽 / 余额 / 工作状态 /
//      碎碎念 / 右键菜单），我方播的段会被其中任何一个顶掉；
//   ② 气泡：三个**独立**开关，且渲染**有优先级**（别人的会直接盖掉我们那张）；
//   ③ 移动：随机链的 `move` 档会真的改 `left/top` 把宠物搬走。
//  这三条都发生在 dsh-pet 内部，墙纸半侧**无从拦截** ⇒ 只能打补丁加闸门。
//  （第一版补丁只拦了 ①，实测气泡与走位照样插进来；本版三条一起拦。）
//
//  ⚠️ 锁的**释放**是硬纪律：`petLinkRun` 的 finally 一定会解锁（与"归还偏移""解除朝向
//  武装"同一套纪律）。漏解锁的后果是宠物**永久停在最后一段动作**、不再有任何随机行为
//  —— 比"被插入"严重得多。补丁侧另有 60s 自动过期兜底。

/** 上锁：锁住期间只允许 `name` 这一段被播放，并拒绝点击/拖拽/随机移动/外来气泡。
 *
 *  @param name 允许播放的那一段（= 我方正在播的素材名）
 *  @param ttlMs 锁的存活时长。**必须覆盖整个流程**，否则锁会在中途过期、
 *         随机链与外来气泡就会插进来。默认 60s（补丁侧兜底），
 *         但逻辑一/二会**停留等侧栏关闭（最长 180s）**，那条路径必须显式传更长值。
 *  @returns 补丁是否在场（false = 降级，流程照走） */
function petLinkAnimLock(name, ttlMs) {
  const ctl = petLinkPetCtl();
  if (!ctl || typeof ctl.lock !== 'function') return false;
  const preserveBubble = Boolean(petLinkState.bubbleRun && petLinkState.bubbleRun.preserve());
  try { return Boolean(ctl.lock(name, ttlMs, preserveBubble)); } catch { return false; }
}

/** 解锁（幂等；补丁缺席时无操作）。 */
function petLinkAnimUnlock() {
  petLinkState.animLockName = '';
  const ctl = petLinkPetCtl();
  if (!ctl || typeof ctl.unlock !== 'function') return false;
  try { ctl.unlock(); return true; } catch { return false; }
}

/** **开一个"允许气泡"窗口**：独占锁会把气泡一并拦下（用户口径"包括任何气泡"），
 *  但我方自己那张必须能显示 ⇒ 在发气泡**之前**开窗。
 *
 *  ⚠️ 窗口要盖住"从 /broadcast 到宿主轮询显示"的延迟：宿主对 /state 的轮询间隔是 1s，
 *  所以窗口不能只开几百毫秒，否则我们的气泡会被自己的锁拦掉。
 *  默认 4s（≈ 4 个轮询周期），足够宽且不会让外来气泡有机可乘（锁仍在）。
 *  @returns 补丁是否在场 */
function petLinkAllowBubble(ms) {
  const ctl = petLinkPetCtl();
  if (!ctl || typeof ctl.allowBubble !== 'function') return false;
  try { ctl.allowBubble(ms); return true; } catch { return false; }
}

/** **立刻收回**气泡（彩蛋排播里的"回收气泡"）。
 *
 *  为什么必须"立刻"而不是"等它自己到点"：彩蛋一的排播是
 *  「弹气泡 → 播踢腿 → **回收气泡** → 被弹飞 → 弹另一条气泡」——
 *  不收回的话两条气泡会在同一槽位互相顶替，且第一条会挂满整个 3s 盖住第二段动作。
 *  补丁缺席 ⇒ 返回 false，流程照走（气泡只是晚一点自己消失，不阻塞任何一段动画）。 */
function petLinkBubbleHide() {
  const ctl = petLinkPetCtl();
  if (!ctl || typeof ctl.hideBubble !== 'function') return false;
  try { ctl.hideBubble(); return true; } catch { return false; }
}

/** 点播一段动作并**按它真正的时长等完**（含 PET_FALLBACK 顶替后的时长）。
 *
 *  为什么不能直接 `await petLinkPlay(...)` 就算完：`petLinkPlay` 的 Promise 在
 *  **动作被真正发出后**就 resolve（它等的是 `/anim` 请求成功，不是播放结束），
 *  真正的"停留"是由队列里的 `hold` 在 `petLinkDrain` 里实现的。
 *  所以编排要自己掐表，且必须按**实际播出的名字**查时长（顶替后就变了）。 */
async function petLinkPlayAndHold(which, opts) {
  const ok = await petLinkPlay(which, Object.assign({ internal: true, gap: 0 }, opts || {}));
  if (!ok) return false;
  // 实际时长：优先调用方显式给的，其次按名字反查，最后按原键查
  const name = petLinkState.lastKey;
  const ms = (opts && Number.isFinite(opts.hold)) ? opts.hold
    : petLinkHoldOf(which, PET_HOLD_BY_NAME[name]);
  await petLinkWait(Number.isFinite(ms) ? ms : 0);
  return true;
}

/** 逻辑二下拉与弹回使用完整 transform 过渡；脱手前保持拉到底的位置。 */
async function petLinkPullRopeDown(alive, holdMs = 0) {
  const el = petLinkRopeEl();
  if (!el || !el.style) return false;
  if (petLinkState.ropeRelease) petLinkState.ropeRelease();
  const keys = ['transform', 'transitionProperty', 'transitionDuration', 'transitionTimingFunction'];
  const original = Object.fromEntries(keys.map(key => [key, el.style[key] || '']));
  const valid = () => (typeof alive !== 'function' || alive()) && petLinkState.ropeRelease === release;
  const pullMs = Math.max(0, petLinkTune('mascotRopePullMs', 'mascot'));
  const backMs = Math.max(0, petLinkTune('mascotRopeBackMs', 'mascot'));
  const ease = value => ['linear', 'ease-in-out', 'cubic-bezier(0.16,1,0.3,1)'][value] || 'ease-in-out';
  const release = () => {
    if (petLinkState.ropeRelease !== release) return;
    for (const key of keys) el.style[key] = original[key];
    petLinkState.ropeRelease = null;
  };
  petLinkState.ropeRelease = release;
  try {
    if (!valid()) return false;
    el.style.transitionProperty = 'transform';
    el.style.transitionDuration = pullMs + 'ms';
    el.style.transitionTimingFunction = ease(petLinkTune('mascotRopePullEase', 'mascot'));
    el.style.transform = 'translate(0px,' + Math.max(0, petLinkTune('mascotRopeDownPx', 'mascot')) + 'px)';
    await petLinkWait(pullMs);
    if (!valid()) return false;
    if (holdMs > 0) await petLinkWait(holdMs);
    if (!valid()) return false;
    el.style.transitionDuration = backMs + 'ms';
    el.style.transitionTimingFunction = ease(petLinkTune('mascotRopeBackEase', 'mascot'));
    el.style.transform = 'translate(0px,0px)';
    await petLinkWait(backMs);
    return valid();
  } finally {
    release();
  }
}

/** 去程即站到原片双手最高点能触顶的位置；跳跃只由素材自身完成。 */
function petLinkMascotStand(rope, rect, fallback) {
  if (!rope || !rect) return fallback;
  let canvas = rect;
  try {
    const stage = petLinkPetEl()?.querySelector?.('.dsh-pet-stage');
    if (stage) canvas = stage.getBoundingClientRect();
  } catch { /* 宿主无视频层时按根画布换算。 */ }
  if (!canvas || canvas.width <= 0 || canvas.height <= 0
    || ![rect.left, rect.top, rect.width, rect.height, canvas.left, canvas.top, canvas.width, canvas.height,
      rope.left, rope.top, rope.width].every(Number.isFinite)) return fallback;
  // 640×360 原片约 1.3s 双手最高处：中点 x=312、指尖 y=36；袋子已从素材移除。
  const handX = canvas.left + canvas.width * 312 / 640;
  const handY = canvas.top + canvas.height * 36 / 360;
  return { x: rect.left + rect.width / 2 + rope.left + rope.width / 2 - handX,
    y: rect.top + rect.height / 2 + rope.top - handY };
}

/** 脱手后只下落并保持落点，正常回程或取消时统一清理偏移。 */
async function petLinkMascotDrop(alive, started, releaseAt, config) {
  if (config.distance <= 0) return false;
  await petLinkWait(Math.max(0, started + releaseAt - petLinkNow()));
  if (!alive()) return false;
  const rect = petLinkPetRect();
  if (!rect || !petLinkPetEl()) return false;
  const landing = config.landing || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 + config.distance };
  return petLinkGlide(rect, landing.x, landing.y, config.dropMs, alive);
}

/** 所有关键时刻均从跳抓点播确认开始，不再早于点播确认启动。 */
function petLinkRunMascotMotion(alive, state, landingBase) {
  const tune = key => Math.max(0, petLinkTune(key, 'mascot'));
  const started = petLinkNow();
  const grabAt = tune('mascotGrabAtMs');
  const pullMs = tune('mascotRopePullMs');
  const releaseAt = Math.max(grabAt + pullMs, tune('mascotReleaseAtMs'));
  const openAt = tune('mascotOpenAtMs');
  const config = { distance: tune('mascotDropPx'), dropMs: tune('mascotDropMs') };
  if (landingBase) config.landing = { x: landingBase.x, y: landingBase.y + config.distance };
  const grab = (async () => {
    await petLinkWait(Math.max(0, started + grabAt - petLinkNow()));
    if (!alive()) return false;
    state.phase = 'mascot-drag';
    return petLinkPullRopeDown(alive, releaseAt - grabAt - pullMs);
  })();
  const open = (async () => {
    await petLinkWait(Math.max(0, started + openAt - petLinkNow()));
    if (!alive()) return false;
    return petLinkSnapOpenSidebar();
  })();
  return Promise.allSettled([grab, open, petLinkMascotDrop(alive, started, releaseAt, config)]);
}

/** 彩蛋一以原片脚尖/躯干锚点测量，不沿用通用命中框。 */
function petLinkEggAnchorX(rect, ratio) {
  if (!rect) return null;
  let canvas = rect;
  try {
    const root = petLinkPetEl();
    const stage = root && root.querySelector && root.querySelector('.dsh-pet-stage');
    const live = stage && stage.getBoundingClientRect();
    if (live && Number.isFinite(live.left) && live.width > 0) canvas = live;
  } catch { /* 没有舞台层时按根画布换算。 */ }
  return canvas.left + canvas.width * ratio;
}

/** 有界等待实际状态；取消后不再驱动后续节点。 */
function petLinkEggWait(predicate, alive, maxMs) {
  const started = petLinkNow();
  return new Promise(resolve => {
    const tick = () => {
      if (!alive()) { resolve(false); return; }
      if (predicate()) { resolve(true); return; }
      if (petLinkNow() - started >= maxMs) { resolve(false); return; }
      petLinkFrame(tick, resolve);
    };
    tick();
  });
}

/** 把可见位置和初速度交给手动甩出使用的原生驱动，等待真实物理落定。 */
async function petLinkFlingAway(alive) {
  const ctl = petLinkPetCtl(), rect = petLinkPetRect();
  const distance = Math.max(0, petLinkTune('egg1FlingPx', 'egg1'));
  if (!alive() || !rect || distance <= 0 || !ctl || typeof ctl.throwNative !== 'function'
    || typeof ctl.getNativeThrow !== 'function' || typeof ctl.stopNativeThrow !== 'function') return false;
  const speed = Math.min(3200, distance * 1000 / Math.max(100, petLinkTune('egg1FlingMs', 'egg1')));
  const id = ctl.throwNative({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    { vx: -speed, vy: -Math.min(1600, speed * 0.65) });
  if (id === false) return false;
  petLinkResetOffset();
  const release = () => { try { ctl.stopNativeThrow(id); } catch { /* 桌宠卸载仍需清理本侧。 */ } };
  petLinkState.throwRelease = release;
  let settled = false;
  try {
    settled = await petLinkEggWait(() => !ctl.getNativeThrow(id).active, alive, 30000);
    return settled && !ctl.getNativeThrow(id).cancelled;
  } finally {
    if (!settled || !alive()) release();
    if (petLinkState.throwRelease === release) petLinkState.throwRelease = null;
  }
}

/** 第一下只弹到躯干，撞击当帧起飞；随后收回，再完整展开。 */
async function petLinkEggRebound(alive) {
  const api = petLinkSidebar();
  if (!api || !alive()) return false;
  const delay = Math.max(0, petLinkTune('egg1FlingDelayMs', 'egg1'));
  await petLinkWait(delay);
  if (!alive()) return false;
  const edgeX = () => {
    try { return typeof api.edgeX === 'function' ? api.edgeX() : null; } catch { return null; }
  };
  const initialEdge = edgeX();
  const contact = petLinkEggAnchorX(petLinkPetRect(), 370 / 640);
  if (!Number.isFinite(initialEdge) || !Number.isFinite(contact)) return false;
  const move = (open, ms) => {
    if (typeof api.rebound === 'function') api.rebound(open, ms);
    else if (open && typeof api.beginPull === 'function') api.beginPull(ms);
    else if (typeof api[open ? 'open' : 'close'] === 'function') api[open ? 'open' : 'close']();
  };
  const restore = () => {
    if (petLinkState.eggReboundRelease !== restore) return;
    petLinkState.eggReboundRelease = null;
    if (typeof api.commit === 'function') api.commit();
  };
  petLinkState.eggReboundRelease = restore;
  let flight = Promise.resolve(false);
  try {
    move(true, 240);
    const hit = await petLinkEggWait(() => {
      const edge = edgeX();
      return Number.isFinite(edge) && edge <= contact + 1;
    }, alive, 1200);
    if (!hit || !alive()) return false;
    flight = petLinkFlingAway(alive);
    move(false, 180);
    const closed = await petLinkEggWait(() => {
      const edge = edgeX();
      return Number.isFinite(edge) && edge >= initialEdge - 1;
    }, alive, 1200);
    if (!closed || !alive()) return false;
    move(true, 300);
    await petLinkEggWait(() => false, alive, 300);
    return await flight;
  } finally {
    restore();
    if (petLinkState.eggReboundRelease === restore) petLinkState.eggReboundRelease = null;
    await flight;
  }
}

function petLinkEggCleanup() {
  if (petLinkState.throwRelease) petLinkState.throwRelease();
  petLinkState.throwRelease = null;
  if (petLinkState.eggReboundRelease) petLinkState.eggReboundRelease();
  petLinkState.eggReboundRelease = null;
}

/** 彩蛋一回程等点播确认后再归零，避免迟到点播或旧帧越过解锁/取消。 */
async function petLinkEggReturnHome(ms, alive, home, onStart) {
  return petLinkReturnHomeWalk(ms, alive, home, onStart);
}

/** 等宠物**真的稳定**（v4 素材对接文档 §4.4 的硬要求）。
 *
 *  ── 为什么不能"按素材时长硬推"────────────────────────────────────────────
 *  dsh-pet 自带重力与落地物理（`physics.gravity=1400`、`restitution=0.78`），
 *  但它**只写 `left/top`**；本模块的位移**只写 `transform`** —— 两者互不感知。
 *  所以 `被弹飞` 素材（1.417s）播完之后，宠物很可能**还在被它的物理继续抛**，
 *  这时若按素材时长直接播 `落地转正`，观感是"还在飞就开始表演落地"。
 *
 *  ── "稳定"在当前架构下只能由我方定义 ──────────────────────────────────────
 *  严格意义上宠物**永远不会**进入宿主意义的"静止"（宿主不知道我们把它 transform 到了哪），
 *  所以判据只能是**我方自己的观测量**：连续 `PET_SETTLE_STILL_MS` 内
 *  `transform` 偏移不再变化 ⇒ 认为稳定。同时必须有**硬上限**兜底 ——
 *  绝不允许"等不到稳定就把流程卡死"（流程纪律：任何一段都不许无限等待）。
 *
 *  @param alive 存活判据（流程被中断时立即返回，不空等）
 *  @returns 是否**观察到**稳定（false = 到上限了，但仍然继续，绝不卡住） */
function petLinkWaitSettled(alive) {
  const t0 = petLinkNow();
  let lastX = null, lastY = null, stillSince = null;
  return new Promise(resolve => {
    const tick = () => {
      if (typeof alive === 'function' && !alive()) { resolve(false); return; }
      const now = petLinkNow();
      const off = petLinkState.offset || { x: 0, y: 0 };
      if (lastX !== null && Math.abs(off.x - lastX) < 0.5 && Math.abs(off.y - lastY) < 0.5) {
        if (stillSince === null) stillSince = now;
        // 连续静止够久 ⇒ 稳定（判据按**时间**，与帧率解耦）
        if (now - stillSince >= PET_SETTLE_STILL_MS) { resolve(true); return; }
      } else {
        stillSince = null;
      }
      lastX = off.x; lastY = off.y;
      // 硬上限：到点就走，绝不让"等稳定"变成"卡死"
      if (now - t0 >= PET_SETTLE_MAX_MS) { resolve(false); return; }
      petLinkFrame(tick, resolve);
    };
    petLinkFrame(tick, resolve);
  });
}

/** 距离驱动走位的耗时；逻辑一改用独立可调时长，其余排播保留此速度规则。 */
function petLinkWalkMs(rect, toX, toY) {
  if (!rect) return 0;
  const dx = toX - (rect.left + rect.width / 2);
  const dy = toY - (rect.top + rect.height / 2);
  const dist = Math.sqrt(dx * dx + dy * dy);
  return Math.min(PET_WALK_MAX_MS, Math.max(PET_WALK_MIN_MS, (dist / PET_WALK_SPEED) * 1000));
}

/** 走近目标点；显式时长仅供逻辑一按走路素材整段对齐。 */
function petLinkWalkTo(toX, toY, ms, alive) {
  const rect = petLinkPetRect();
  if (!rect) return Promise.resolve(false);
  return petLinkGlide(rect, toX, toY, Number.isFinite(ms) ? Math.max(0, ms) : petLinkWalkMs(rect, toX, toY), alive);
}
/** 距离判定：比较"宠物→侧边栏开口"与"宠物→吉祥物"两个距离，谁近走哪条逻辑。
 *  取不到位置时按逻辑一（表演最完整），保证任何环境下都能走通。 */
function petLinkDecide() {
  const pet = petLinkPetRect();
  const rope = petLinkRopeRect();
  if (!pet || !rope) return 'sidebar';
  const W = (typeof window !== 'undefined' && window.innerWidth) || 1280;
  const H = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const pc = { x: pet.left + pet.width / 2, y: pet.top + pet.height / 2 };
  const rc = { x: rope.left + rope.width / 2, y: rope.top + rope.height / 2 };
  const panel = petLinkPanelRect();
  const side = panel && panel.width > 0
    ? { x: panel.left, y: panel.top + panel.height / 2 }
    : { x: W, y: H / 2 };
  const dRope = Math.sqrt((pc.x - rc.x) ** 2 + (pc.y - rc.y) ** 2);
  const dSide = Math.sqrt((pc.x - side.x) ** 2 + (pc.y - side.y) ** 2);
  return dSide < dRope ? 'sidebar' : 'mascot';
}
function petLinkPanelRect() {
  try {
    if (typeof document === 'undefined' || !document.querySelector) return null;
    const el = document.querySelector('.we-qp');
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const r = el.getBoundingClientRect();
    return r && Number.isFinite(r.left) ? r : null;
  } catch { return null; }
}
/** 侧栏此刻是否开着。优选注入的 isOpen（= 宿主的真实状态），取不到才看 DOM 可见性。 */
function petLinkSidebarIsOpen() {
  const api = petLinkSidebar();
  if (api && typeof api.isOpen === 'function') {
    try { return Boolean(api.isOpen()); } catch { /* 落回 DOM */ }
  }
  return petLinkSidebarOpen();
}
/** 停留等待「侧栏被用户关闭」。
 *
 *  用户口径（2026-10-14）：拉出成功后宠物**留在面板左侧**展示气泡与配图，等侧栏被关闭才回原位。
 *
 *  三条收尾路径（任一命中即返回，绝不让宠物永远杵着）：
 *    ① 侧栏真的被关上（`isOpen()` 变 false）—— 正常路径；
 *    ② 到达 `PET_HOLD_MAX_MS`（60s）—— 用户一直不关，宠物自己回去；
 *    ③ **侧栏压根打不开**（`open()` 是空操作 ⇒ 从未变成 true）—— 宽限 `PET_HOLD_GRACE_MS`
 *       后放弃等待。没有这一条，低版本宿主上宠物会僵在角落 60s。
 *  @param alive 流程是否仍然有效（epoch 未变）
 *  @returns 停止等待的原因（供诊断/断言） */
async function petLinkWaitSidebarClose(alive) {
  const opened = petLinkSidebarIsOpen();
  const t0 = petLinkNow();
  let sawOpen = opened;
  while (alive()) {
    const now = petLinkNow();
    const elapsed = now - t0;
    if (petLinkSidebarIsOpen()) sawOpen = true;
    else if (sawOpen) return 'closed';
    else if (elapsed >= PET_HOLD_GRACE_MS) return 'never-open';
    if (elapsed >= petLinkTune('holdMaxMs')) return 'timeout';
    await petLinkWait(PET_HOLD_POLL_MS);
  }
  return 'aborted';
}
function petLinkStops() {
  const W = (typeof window !== 'undefined' && window.innerWidth) || 1280;
  const H = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const rope = petLinkRopeRect();
  const pet = petLinkPetRect();
  const size = pet ? pet.width : 0;
  // 贴边按**手**口径（用户口径 2026-10-15「一定要让 pet 手对上侧边栏边缘」）：
  // 目标是"手右边缘落在 W − PET_EDGE_GAP_PX"，换算成画布中心再驱动宠物。
  const rightTarget = W - petLinkTune('edgeGapPx');
  return {
    W, H,
    rope,
    // 拉绳正下方一点：宠物站在绳子下手能够到
    ropeStand: rope ? { x: rope.left + rope.width / 2, y: Math.min(H - 40, rope.top + rope.height + 150) } : { x: W * 0.5, y: H - 200 },
    // 界面最右边（用户口径）：**手**右边缘贴住 W − PET_EDGE_GAP_PX（现为 0）。
    rightEdge: { x: petLinkCenterForHandRight(rightTarget, { width: size }), y: H * 0.55 },
    // ⚠️ 这里曾有 `sideEdge`（面板左侧停点）与配套的 `petLinkSideStop()`。
    //    用户口径（2026-10-14 第二版）改成"喘气后**就地静止不动**"，
    //    逻辑一不再有任何侧移 ⇒ 两者都是死代码，已删（别再加回来：
    //    `verify-dead-declarations` 的哲学是"死代码不会自己变红"）。
  };
}
function petLinkRopeRect() {
  try {
    if (typeof document === 'undefined' || !document.querySelector) return null;
    const el = document.querySelector('.we-rope');
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const r = el.getBoundingClientRect();
    return r && Number.isFinite(r.left) ? r : null;
  } catch { return null; }
}
/** 侧栏控制面（由 client.js 注册；子包缺席时保持 null，逻辑整体不激活）。 */
function petLinkSidebar() {
  return petLinkState.runner && petLinkState.runner.sidebar ? petLinkState.runner.sidebar : null;
}
function petLinkOpenSidebar() {
  const api = petLinkSidebar();
  if (api && typeof api.open === 'function') { try { api.open(); return true; } catch { /* 落回 */ } }
  try { if (typeof wallSidebarOpen === 'function') { wallSidebarOpen(); return true; } } catch { /* ignore */ }
  return false;
}
function petLinkCloseSidebar() {
  const api = petLinkSidebar();
  if (api && typeof api.close === 'function') { try { api.close(); return true; } catch { /* 落回 */ } }
  try { if (typeof wallSidebarClose === 'function') { wallSidebarClose(); return true; } } catch { /* ignore */ }
  return false;
}
/** 点击态“直接弹出”（逻辑二）：不走缓慢预览，直接提交开合。 */
function petLinkSnapOpenSidebar() {
  return petLinkOpenSidebar();
}
/** 侧栏是否已展开（优选注入的 isOpen，其次读 DOM 可见性）。 */
function petLinkSidebarOpen() {
  const api = petLinkSidebar();
  if (api && typeof api.isOpen === 'function') { try { return Boolean(api.isOpen()); } catch { /* 落回 */ } }
  try {
    if (typeof document === 'undefined' || !document.querySelector) return false;
    const panel = document.querySelector('.we-qp');
    if (!panel || typeof getComputedStyle !== 'function') return false;
    return getComputedStyle(panel).visibility !== 'hidden';
  } catch { return false; }
}
/** 缓慢拉出：两种侧栏形态各用各的通道。
 *   · 抽屉态：RopeDock 的跟手预览（preview/commit）——它本来就是位移动画。
 *   · 官方态：右侧栏是宿主的 CSS Grid 第三列，列宽由 React 内联样式写，
 *     而宿主**自带** `transition: grid-template-columns`。我们绝不改写它的 grid
 *     （实测那样会覆盖宿主三列定义、把面板挤到屏幕左侧），只把它的过渡时长
 *     临时调长再触发展开——动画仍由宿主执行，只是变慢。
 *  任一步失败都不抛；无论如何最后必须收尾到"完全展开"。
 *  `extraMs` 是**提前量**（见 `PET_OPEN_LEAD_MS`）：面板比宠物早开始动这么多毫秒，
 *  过渡总时长就要同步加上同样多 —— 提前起、同时止。 */
async function petLinkSlowOpen(extraMs) {
  const api = petLinkSidebar();
  if (!api) { petLinkOpenSidebar(); return false; }
  const epoch = petLinkState.epoch;
  const alive = () => epoch === petLinkState.epoch;
  const release = () => {
    if (petLinkState.sidebarRelease !== release) return;
    petLinkState.sidebarRelease = null;
    try { if (typeof api.commit === 'function') api.commit(); } catch { /* 已注销 */ }
  };
  if (petLinkState.sidebarRelease) petLinkState.sidebarRelease();
  petLinkState.sidebarRelease = release;
  try {
    if (api.mode === 'official') {
      const tunedOpen = petLinkTune('slowOpenMs');
      const baseMs = Number.isFinite(tunedOpen) ? tunedOpen : (Number.isFinite(api.pullMs) ? api.pullMs : 1600);
      const pullMs = baseMs + (Number.isFinite(extraMs) && extraMs > 0 ? extraMs : 0);
      if (typeof api.beginPull === 'function') api.beginPull(pullMs);
      else petLinkOpenSidebar();
      for (let waited = 0; waited < pullMs && alive(); waited += 100) await petLinkWait(100);
      return alive();
    }
    const drive = p => {
      if (typeof api.preview === 'function') { api.preview(p); return true; }
      if (typeof api.slowProgress === 'function') { api.slowProgress(p); return true; }
      return false;
    };
    let drove = false;
    for (let i = 1; i <= 14 && alive(); i++) {
      if (drive(i / 14)) drove = true;
      await petLinkWait(90);
    }
    if (!alive()) return false;
    drive(1);
    if (!drove) petLinkOpenSidebar();
    return true;
  } finally { release(); }
}

/** 仅补偿去程走路画面：末帧中心/脚底对齐准备首帧，不改根元素停点。 */
function petLinkArmSidebarWalkAlign() {
  const root = petLinkPetEl();
  if (!root || !root.querySelector || typeof MutationObserver !== 'function') return () => {};
  let previous = root.querySelector('.dsh-pet-video.is-front');
  let walking = null;
  let savedTranslate = '';
  let leftWalking = false;
  let observer = null;
  const cleanup = () => {
    if (observer) observer.disconnect();
    if (walking && walking.style) walking.style.translate = savedTranslate;
    walking = null;
  };
  observer = new MutationObserver(() => {
    const front = root.querySelector('.dsh-pet-video.is-front');
    if (!front || front === previous) return;
    previous = front;
    if (!walking) {
      // 等实际视频交换，不提前挪动当前待机画面；缺走路素材时不误改准备段。
      if (petLinkState.animLockName !== PET_ANIM.walkRight) { cleanup(); return; }
      walking = front;
      savedTranslate = front.style.translate;
      front.style.translate = (-49 / 640 * 100) + '% ' + (-12 / 360 * 100) + '%';
    } else if (front !== walking) {
      leftWalking = true;
    } else if (leftWalking) {
      // 双视频槽复用时，后拉画面不能继承走路偏移。
      cleanup();
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['class'], subtree: true });
  return cleanup;
}

/** 一次完整流程的实现（三条逻辑共用骨架）。 */
async function petLinkRun(logic, epoch) {
  petLinkState.activeLogic = logic;
  // ── 偏移归还的**唯一保证点** ──────────────────────────────────────────────
  // 流程无论怎么离开（正常收尾 / 中途 alive 失效 / 抛错），都必须归还偏移：
  // 留下非零 transform 会让 dsh-pet 的拖拽"不跟手、恒定偏向左上"
  // （它只写 left/top，不认识我们写在 root 上的 transform，两者叠加）。
  // 用 finally 而不是在各返回点各写一遍 —— 少一个出口就等于留一个 bug。
  //
  // 朝向武装走同一条纪律：进入时武装（联动期间不镜像），离开时**必须**解除并还原。
  const disarm = petLinkArmFacing();
  const disarmWalkAlign = logic === 'sidebar' ? petLinkArmSidebarWalkAlign() : () => {};
  petLinkState.releaseFacing = () => { disarmWalkAlign(); disarm(); };
  // 气泡时长按用户口径（3s）设一次；补丁缺席时静默跳过（宿主默认 10s）。
  petLinkBubbleDuration(petLinkTune('bubbleMs'));
  // ── 锁的**心跳续期** ──────────────────────────────────────────────────────
  // ⚠️ 为什么必须有它：补丁侧给锁设了到期时间（默认 60s）作为"调用方忘了解锁"的兜底，
  //    但**逻辑一/二的停留阶段最长 180s**（等侧栏被关闭）。没有心跳的话，锁会在 60s
  //    时静默过期 ⇒ 后半段停留里随机链、点击、外来气泡全都回来了（正是用户报的现象）。
  //    每次点播已经在 `petLinkPlay` 里重设了锁，但"停留"期间没有点播 ⇒ 必须自己续。
  //    续期周期取 TTL 的 1/3：任一次续期失败/被丢弃，后面还有两次机会。
  //
  //  ⚠️ `setInterval` 可能**不存在**（测试替身只给 setTimeout/rAF；真机浏览器两者都有）。
  //    取不到就退化为"不续期" —— 绝不因为一个可选优化把整条流程打断。
  //    实测踩过：无保护地调 `setInterval` 抛 ReferenceError 会**直接掐死流程**，
  //    表现为 32 条判据同时红（看起来像"协议全错"，实际只是缺一个全局函数）。
  let lockHeartbeat = null;
  if (typeof setInterval === 'function') {
    try {
      lockHeartbeat = setInterval(() => {
        if (epoch !== petLinkState.epoch) return;
        const held = petLinkState.animLockName;
        if (!held || !petLinkIsBusy()) return;   // 没锁 / 流程已结束 ⇒ 不续
        petLinkAnimLock(held);
      }, petLinkTune('lockHeartbeatMs'));
    } catch { lockHeartbeat = null; }
  }
  petLinkState.lockHeartbeat = lockHeartbeat;
  try {
    const result = await petLinkRunInner(logic, epoch);
    if (result.phase !== 'done' && epoch === petLinkState.epoch && petLinkState.bubbleRun)
      petLinkState.bubbleRun.cancel();
    return result;
  } catch (error) {
    if (epoch === petLinkState.epoch && petLinkState.bubbleRun) petLinkState.bubbleRun.cancel();
    throw error;
  } finally {
    // ⚠️ 三条归还纪律，一条都不能少（顺序无关，但每一条都必须执行）：
    //   · 解锁：漏了会让宠物永久停在最后一段动作（见 petLinkAnimLock 的说明）；
    //   · 解除朝向武装：漏了会让宿主的朝向镜像永久失灵；
    //   · 归还偏移：漏了会让 dsh-pet 的拖拽"不跟手"（见 petLinkResetOffset）。
    if (lockHeartbeat !== null && typeof clearInterval === 'function') {
      try { clearInterval(lockHeartbeat); } catch { /* ignore */ }
    }
    if (epoch === petLinkState.epoch) {
      petLinkState.lockHeartbeat = null;
      if (logic === 'egg1') petLinkEggCleanup();
      if (logic === 'egg2' && petLinkState.egg2Release) petLinkState.egg2Release();
      try { petLinkAnimUnlock(); } catch { /* 解锁失败不影响其余归还 */ }
      petLinkState.animLockName = '';
      try { if (petLinkState.releaseFacing) petLinkState.releaseFacing(); } catch { /* 卸载仍需回收位置。 */ }
      petLinkState.releaseFacing = null;
      if (!petLinkHandoffPosition()) petLinkResetOffset();
    }
  }
}

/** 气泡节点按排播掐表；不是宿主视频首帧回执。返回开始只能在实际返回时确定。 */
const PET_BUBBLE_SPECS = [
  { id: 'sidebar', logic: 'sidebar', label: () => weT('逻辑一气泡'), text: () => weT('累死本鲸了，给我添两碗饭'), image: '累瘫鲸鱼的两碗饭' },
  { id: 'mascot', logic: 'mascot', label: () => weT('逻辑二气泡'), text: () => weT('可以换壁纸了，不要用××√哦'), image: '蓝发鲸尾女仆拒绝换壁纸' },
  { id: 'egg1Angry', logic: 'egg1', label: () => weT('彩蛋一：愤怒气泡'), text: () => weT('偶鲸鲸！！！！！'), image: '暴怒鲸尾女仆贴纸' },
  { id: 'egg1Land', logic: 'egg1', label: () => weT('彩蛋一：落地气泡'), text: () => weT('哇啊啊啊啊啊！！！'), image: '吓哭了' },
  { id: 'egg2', logic: 'egg2', label: () => weT('彩蛋二气泡'), text: () => weT('？！欺负一只肥鱼！？'), image: '？！欺负一只肥鱼！？' },
];
const PET_BUBBLE_ACTIONS = {
  sidebar: ['walk', 'brace', 'pull', 'return'],
  mascot: ['walk', 'mascotTumble', 'return'],
  egg1: ['walk', 'eggKick', 'eggFlung', 'eggLand', 'return'],
  egg2: ['eggHiss', 'return'],
};
const PET_BUBBLE_DEFAULTS = {
  sidebar: {
    show: { action: 'pull', edge: 'start', offsetMs: 7000 },
    hide: { action: 'duration', edge: 'start', offsetMs: 5000 },
  },
  egg1Angry: {
    show: { action: 'eggKick', edge: 'start', offsetMs: 0 },
    hide: { action: 'duration', edge: 'start', offsetMs: 5000 },
  },
  egg1Land: {
    show: { action: 'eggFlung', edge: 'start', offsetMs: 0 },
    hide: { action: 'duration', edge: 'start', offsetMs: 15000 },
  },
  egg2: {
    hide: { action: 'duration', edge: 'start', offsetMs: 5000 },
  },
};
function petLinkBubbleTiming(id) {
  const stored = (petLinkState.bubbleTiming || {})[id] || {};
  const factory = PET_BUBBLE_DEFAULTS[id] || {};
  const rule = key => ({ action: 'default', edge: 'start', offsetMs: 0, ...factory[key], ...stored[key] });
  return { show: rule('show'), hide: rule('hide') };
}
function petLinkSetBubbleTiming(id, config) {
  const spec = PET_BUBBLE_SPECS.find(item => item.id === id);
  if (!spec || !config || typeof config !== 'object') return false;
  const next = petLinkBubbleTiming(id);
  for (const key of ['show', 'hide']) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue;
    const rule = config[key];
    const actions = ['default', ...PET_BUBBLE_ACTIONS[spec.logic], ...(key === 'hide' ? ['duration'] : [])];
    if (!rule || !actions.includes(rule.action) || !['start', 'end'].includes(rule.edge)
      || !Number.isFinite(rule.offsetMs) || Math.abs(rule.offsetMs) > 600000
      || (rule.action === 'duration' && rule.offsetMs < 0)
      || (rule.action === 'return' && rule.offsetMs < (rule.edge === 'start' ? 0 : -600))) return false;
    next[key] = { action: rule.action, edge: rule.edge, offsetMs: rule.offsetMs };
  }
  if (!petLinkState.bubbleTiming) petLinkState.bubbleTiming = {};
  petLinkState.bubbleTiming[id] = next;
  return next;
}
function petLinkBubbleTimingSnapshot() {
  return Object.fromEntries(PET_BUBBLE_SPECS.map(spec => [spec.id, petLinkBubbleTiming(spec.id)]));
}

/** 每轮持有独立定时器和气泡所有权，旧气泡的关闭绝不能误关新气泡。 */
function petLinkCreateBubbleTimeline(logic, alive) {
  if (petLinkState.bubbleRun) petLinkState.bubbleRun.cancel();
  const tracks = PET_BUBBLE_SPECS.filter(spec => spec.logic === logic)
    .map(spec => ({ spec, rules: petLinkBubbleTiming(spec.id), shown: false, closed: false, at: null, timers: {} }));
  const nodes = new Map();
  let active = null;
  let cancelled = false;
  petLinkBubbleLock(true);
  const release = () => { if (tracks.every(track => track.closed)) petLinkBubbleLock(false); };
  const current = () => !cancelled && alive() && petLinkState.bubbleRun === api;
  const clear = (track, kind) => {
    if (track.timers[kind] !== undefined) clearTimeout(track.timers[kind]);
    delete track.timers[kind];
  };
  const close = (track, hide = true) => {
    track.closed = true;
    for (const kind of Object.keys(track.timers)) clear(track, kind);
    release();
    if (active !== track) return;
    active = null;
    if (hide) petLinkBubbleHide();
    petLinkBubbleDuration(petLinkTune('bubbleMs'));
  };
  const schedule = (track, kind, at, fn) => {
    clear(track, kind);
    if (!Number.isFinite(at)) return;
    track.timers[kind] = setTimeout(() => {
      delete track.timers[kind];
      if (current()) fn();
    }, Math.max(0, at - petLinkNow()));
  };
  const show = track => {
    if (!current() || track.shown || track.closed) return;
    if (active && active !== track) close(active, false);
    active = track;
    track.shown = true;
    track.at = petLinkNow();
    const hide = track.rules.hide;
    // 自定义关闭节点可能跨动作、跨等待段，宿主默认三秒不能先把它清掉。
    const nativeMs = hide.action === 'default' ? Math.max(1, petLinkTune('bubbleMs')) : 2147483647;
    petLinkBubbleDuration(nativeMs);
    petLinkSay(track.spec.text(), track.spec.image).catch(() => false);
    if (hide.action === 'default' && ['sidebar', 'mascot'].includes(track.spec.logic)) {
      schedule(track, 'expire', track.at + nativeMs, () => close(track, false));
    }
    api.refresh();
  };
  const timeOf = (rule, track) => {
    if (rule.action === 'default') return null;
    if (rule.action === 'duration') return track.shown ? track.at + rule.offsetMs : null;
    const n = nodes.get(rule.action);
    if (!n) return null;
    // 正偏移等真实节点通知，负偏移用已知时长预测。未知的返回开始不作预测。
    if (rule.offsetMs >= 0 && !(rule.edge === 'start' ? n.started : n.finished)) return null;
    const at = rule.edge === 'start' ? n.start : n.end;
    return Number.isFinite(at) ? at + rule.offsetMs : null;
  };
  const moveFuture = (node, delta) => {
    let after = false;
    for (const n of nodes.values()) {
      if (after && !n.started && Number.isFinite(n.start)) { n.start += delta; n.end += delta; }
      if (n === node) after = true;
    }
  };
  const api = {
    plan(items) {
      let at = petLinkNow();
      for (const item of items) {
        const duration = Math.max(0, item.durationMs || 0);
        nodes.set(item.action, { start: at, end: at + duration, started: false, finished: false });
        at += duration;
      }
      api.refresh();
    },
    start(action, durationMs) {
      if (!current()) return;
      const n = nodes.get(action) || { start: null, end: null };
      const end = petLinkNow() + Math.max(0, durationMs || 0);
      const delta = Number.isFinite(n.end) ? end - n.end : 0;
      n.start = petLinkNow(); n.end = end; n.started = true;
      nodes.set(action, n);
      moveFuture(n, delta);
      api.refresh();
    },
    end(action) {
      if (!current()) return;
      const n = nodes.get(action);
      if (!n) return;
      const delta = petLinkNow() - n.end;
      n.end = petLinkNow(); n.finished = true;
      moveFuture(n, delta);
      api.refresh();
    },
    async play(action, onStart) {
      const ok = await petLinkPlay(action, { hold: 0, internal: true, gap: 0 });
      if (!current()) return false;
      const lastAction = (PET_BUBBLE_ACTIONS[logic] || []).at(-2);
      const ctl = petLinkPetCtl();
      const fallback = ok ? Math.max(0, petLinkHoldOf(action, PET_HOLD_BY_NAME[petLinkState.lastKey])) : 0;
      const ms = action === lastAction ? petLinkPlaybackRemaining(petLinkState.lastKey, fallback) : fallback;
      api.start(action, ms);
      if (ok && typeof onStart === 'function') onStart();
      if (ok && action === lastAction && ctl && typeof ctl.getPlayback === 'function') {
        await petLinkWaitPlayback(petLinkState.lastKey, true, petLinkState.epoch, -1, alive);
      } else {
        await petLinkWait(ms);
      }
      api.end(action);
      return ok;
    },
    defaultShow(id) {
      const track = tracks.find(t => t.spec.id === id);
      if (track && track.rules.show.action === 'default') show(track);
    },
    defaultHide(id) {
      const track = tracks.find(t => t.spec.id === id);
      if (track && track.rules.hide.action === 'default') close(track);
    },
    preserve() {
      if (!active || active.closed) return false;
      const rules = active.rules;
      return rules.show.action !== 'default' || rules.hide.action !== 'default';
    },
    refresh() {
      if (!current()) return;
      for (const track of tracks) {
        clear(track, 'show'); clear(track, 'hide');
        if (track.closed) continue;
        const rules = track.rules;
        schedule(track, 'hide', timeOf(rules.hide, track), () => close(track));
        if (!track.shown) schedule(track, 'show', timeOf(rules.show, track), () => show(track));
      }
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const track of tracks) close(track);
      if (petLinkState.bubbleRun === api) petLinkState.bubbleRun = null;
    },
  };
  petLinkState.bubbleRun = api;
  return api;
}

/** 流程主体（收尾顺序与三条逻辑的骨架）。 */
async function petLinkRunInner(logic, epoch) {
  petLinkState.activeLogic = logic;
  const stops = petLinkStops();
  const home = petLinkPetRect();
  const kickStop = { ...stops.rightEdge };
  if (logic === 'egg1') {
    let edge = stops.W;
    const sidebar = petLinkSidebar();
    try {
      const live = sidebar && typeof sidebar.edgeX === 'function' ? sidebar.edgeX() : null;
      if (Number.isFinite(live) && live > 0 && live <= stops.W) edge = live;
    } catch { /* 边缘不可读时以视口右缘为准。 */ }
    // 末段约4秒踢出的脚尖 x≈425/640；静态身体框比脚尖更宽，不能作为接触点。
    if (home) kickStop.x = home.left + home.width / 2 + edge - petLinkTune('egg1EdgeGapPx', 'egg1')
      - petLinkEggAnchorX(home, 425 / 640);
  }
  const homePoint = home ? { x: home.left + home.width / 2, y: home.top + home.height / 2 } : null;
  const alive = () => epoch === petLinkState.epoch;
  const state = { logic, phase: 'walk', home: homePoint };
  const bubbles = petLinkCreateBubbleTimeline(logic, alive);
  const hold = key => Math.max(0, petLinkHoldOf(key, PET_HOLD[key]));
  const step = (action, durationMs) => ({ action, durationMs });
  const rope = stops.rope;
  const mascotLanding = logic === 'mascot' && rope ? {
    x: rope.left + rope.width / 2, y: Math.min(stops.H - 60, rope.top + rope.height + 120),
  } : null;
  const mascotStop = mascotLanding ? petLinkMascotStand(rope, home, mascotLanding) : null;
  const walkOverride = Math.max(0, petLinkTune(logic === 'mascot' ? 'mascotWalkMs' : 'egg1WalkMs'));
  const walkDuration = logic === 'sidebar' ? Math.max(0, petLinkTune('sidebarWalkMs'))
    : logic === 'egg2' ? 0 : logic === 'mascot'
      ? (mascotStop ? walkOverride || Math.max(PET_HOLD.walkLeft, petLinkWalkMs(home, mascotStop.x, mascotStop.y)) : 0)
      : walkOverride || Math.max(PET_HOLD.walkRight, petLinkWalkMs(home, kickStop.x, kickStop.y));
  const eggLead = Math.max(0, petLinkTune(logic === 'egg2' ? 'egg2LeadMs' : 'egg1LeadMs'));
  const plan = logic === 'sidebar' ? [step('walk', walkDuration), step('brace', Math.max(0, petLinkTune('braceMs'))), step('pull', hold('pull'))]
    : logic === 'mascot' ? [step('walk', walkDuration), step('mascotTumble', hold('mascotTumble'))]
      : logic === 'egg2' ? [step('eggLead', eggLead), step('eggHiss', hold('eggHiss'))]
        : [step('walk', walkDuration), step('eggLead', eggLead), step('eggKick', hold('eggKick')),
          step('eggPause', 120), step('eggFlung', hold('eggFlung')), step('eggSettle', 0), step('eggLand', hold('eggLand'))];
  if (logic !== 'sidebar') bubbles.plan(plan);
  // 贴边参照系统一为**画布中心**：`petLinkStops()` 与跟随循环都把"手右边缘该落在哪"
  // 经 `petLinkCenterForHandRight()` 换算成画布中心再驱动，目标与基准同源才收敛。

  // 逻辑一、二等待点播确认；彩蛋一保留动作与位移并行。
  // 方向按目标位置选：逻辑一/彩蛋一向右；逻辑二向左。
  // ⚠️ **彩蛋二不发走路**：它的口径是「**原地不动** → 气泡 → 哈气 → 回收气泡」，
  //    既不选方向也不移动（它压根不关心自己离谁近）。给它点火走路会直接违背口径。
  const walkKey = logic === 'mascot' ? 'walkLeft'
    : (logic === 'egg2' ? '' : 'walkRight');
  if (walkKey && logic !== 'sidebar') {
    const played = await petLinkPlay(walkKey, { hold: 0, internal: true, gap: 0 });
    if (!played || !alive()) return state;
  }

  if (logic === 'sidebar') {
    // ① 点播确认后才按整段走路时长移动，避免短距离滑行抢在宿主轮询前结束。
    const walkPlayed = await petLinkPlay(walkKey, { hold: 0, internal: true, gap: 0 });
    if (!walkPlayed || !alive()) return state;
    const walkMs = Math.max(0, petLinkTune('sidebarWalkMs'));
    bubbles.plan(plan);
    bubbles.start('walk', walkMs);
    await petLinkWalkTo(stops.rightEdge.x, stops.rightEdge.y, walkMs, alive);
    bubbles.end('walk');
    if (!alive()) return state;

    // ② 到位后进入准备；提前量上限为准备段本身，绝不能再跨进走路阶段。
    state.phase = 'brace';
    const bracePlayed = await petLinkPlay('brace', { hold: 0, internal: true, gap: 0 });
    if (!alive()) return state;
    const braceMs = bracePlayed ? Math.max(0, petLinkTune('braceMs')) : 0;
    bubbles.start('brace', braceMs);
    const openLead = Math.max(0, Math.min(petLinkTune('openLeadMs'), braceMs));
    const openDelay = Math.max(0, petLinkTune('openDelayMs'));
    const startOpen = async (extraMs) => {
      if (openDelay > 0) await petLinkWait(openDelay);
      if (!alive()) return false;
      return petLinkSlowOpen(extraMs);
    };
    await petLinkWait(braceMs - openLead);
    if (!alive()) return state;

    let openRun;
    let pullRun;
    if (openLead > 0) {
      openRun = startOpen(openLead);
      pullRun = (async () => {
        await petLinkWait(openLead);
        if (!alive()) return false;
        bubbles.end('brace');
        state.phase = 'pull';
        return bubbles.play('pull');
      })();
    } else {
      // 默认不提前：等后拉点播成功再展开，网络往返不能吃掉准备时间。
      bubbles.end('brace');
      state.phase = 'pull';
      const pullPlayed = await petLinkPlay('pull', { hold: 0, internal: true, gap: 0 });
      if (!alive()) return state;
      const fallback = pullPlayed ? Math.max(0, petLinkHoldOf('pull', PET_HOLD_BY_NAME[petLinkState.lastKey])) : 0;
      const pullMs = petLinkPlaybackRemaining(petLinkState.lastKey, fallback);
      bubbles.start('pull', pullMs);
      openRun = startOpen(0);
      const ctl = petLinkPetCtl();
      const end = pullPlayed && ctl && typeof ctl.getPlayback === 'function'
        ? petLinkWaitPlayback(petLinkState.lastKey, true, epoch, -1, alive) : petLinkWait(pullMs);
      pullRun = end.then(() => bubbles.end('pull'));
    }
    const api = petLinkSidebar();
    const edgeX = api && typeof api.edgeX === 'function' ? api.edgeX : null;
    // 跟随循环：宠物**贴着面板左边缘**一起左移，这才是"拉"的观感。
    // ⚠️ 它必须**等走位到位之后**才起步：走位也在写同一个 `transform` 偏移，
    //    两者同时跑会互相抢写（宠物一边往右走、一边被面板边缘往回拽）。
    // ⚠️ 性能纪律（"卡顿"就是这么来的）：手口径偏移量循环外算一次；基准中心按时间节流
    //    刷新（默认 250ms）—— 每帧 `getBoundingClientRect()` 会强制同步布局，实测掉到 20fps。
    const followRect0 = petLinkPetRect();
    // 手右边缘相对画布中心的偏移（贴边口径，与 `petLinkCenterForHandRight` 同源）。
    const handRightOffset = (followRect0 ? followRect0.width : 0) * (petLinkTune('handRightRatio') - 0.5);
    let openSettled = false;
    Promise.resolve(openRun).then(() => { openSettled = true; }, () => { openSettled = true; });
    const follow = new Promise(resolve => {
      if (!edgeX) { resolve(false); return; }
      const maxMs = petLinkTune('slowOpenMs') + openLead + openDelay + 2500;   // 硬上限包含展开前等待，避免提前退出跟随。
      let stillSince = null;
      let stillEdge = null;
      let lastAt = petLinkNow();
      let baseCenter = followRect0 ? followRect0.left + followRect0.width / 2 - (petLinkState.offset ? petLinkState.offset.x : 0) : null;
      let measuredAt = lastAt;
      const t0 = lastAt;
      const tick = () => {
        const now = petLinkNow();
        if (!alive() || now - t0 > maxMs) { resolve(true); return; }
        let live = null;
        try { live = edgeX(); } catch { /* 控制面暂不可读时等待下一帧，仍受硬上限约束。 */ }
        const usable = Number.isFinite(live) && live > 0 && live < stops.W;
        if (usable) {
          // 不拿相邻两帧的亚像素位移判静止：慢速缓动在高帧率下本来就可能每帧不足 0.5px。
          // 展开流程结束后才开始观察累计位移，且必须先追上目标，避免限速时提前停在半路。
          const eps = Math.max(0, petLinkTune('followStillEps'));
          if (!openSettled || now - t0 < petLinkTune('followGraceMs')
            || stillEdge === null || Math.abs(live - stillEdge) > eps) {
            stillSince = now;
            stillEdge = live;
          }
          if (now - measuredAt >= PET_FOLLOW_MEASURE_MS) {
            const rect = petLinkPetRect();
            const cur = petLinkState.offset || { x: 0, y: 0 };
            if (rect) baseCenter = rect.left + rect.width / 2 - cur.x;
            measuredAt = now;
          }
          if (baseCenter !== null) {
            const off = petLinkState.offset || { x: 0, y: 0 };
            const wantOff = (live - petLinkTune('edgeGapPx') - handRightOffset) - baseCenter;
            // 位移上限按 **dt** 算（px/s × 秒），与帧率**解耦**。
            const dt = Math.min(0.1, Math.max(0, (now - lastAt) / 1000));
            lastAt = now;
            const maxStep = Math.max(1, petLinkTune('followSpeed') * dt);
            const dx = wantOff - off.x;
            const stepX = Math.abs(dx) <= maxStep ? dx : Math.sign(dx) * maxStep;
            petLinkState.offset = { x: off.x + stepX, y: off.y };
            try { petLinkElStyleX(off.x + stepX, off.y); } catch { /* ignore */ }
            if (openSettled && now - t0 >= petLinkTune('followGraceMs')
              && now - stillSince >= Math.max(0, petLinkTune('followStillMs'))
              && Math.abs(wantOff - petLinkState.offset.x) <= eps) { resolve(true); return; }
          }
        } else {
          stillSince = null;
          stillEdge = null;
        }
        petLinkFrame(tick, resolve);
      };
      petLinkFrame(tick, resolve);
    });
    // ③ 后拉、侧栏展开与贴边跟随共同收尾，不再重复点播准备或后拉。
    await Promise.allSettled([openRun, follow, pullRun]);
    if (!alive()) return state;
    // ⑤ 气泡：**不回收**（用户口径只给逻辑一/二要求"停留展示"）。3s 后自动消失。
    state.phase = 'tired';
    bubbles.defaultShow('sidebar');
    if (!alive()) return state;
    // ⑥ **就地静止不动**（用户口径："然后之间静止不动"），等侧栏被关闭或 180s 超时。
    //    ⚠️ 这一段**不得**再插入任何走位（"就地在拉出位置停住"）。
    await petLinkFinishAction(alive);
    if (!alive()) return state;
    petLinkHandoffPosition();
    state.phase = 'hold';
    state.holdStop = await petLinkWaitSidebarClose(alive);
  } else if (logic === 'mascot') {
    // ── 逻辑二（用户口径 2026-10-15，动作索引.txt）──────────────────────────
    //  判断：pet 离**吉祥物**比离**侧边栏**近 ⇒ 走这条。
    //  顺序：通用-左侧螃蟹步 → 走到吉祥物下方就位（为后序动画铺垫、掐表）
    //        → 吉祥物-跳抓眩晕落地起身 → **吉祥物被抓握往下拖的关键帧**处侧栏弹出
    //        → 气泡（3s）→ 就地等待侧栏关闭/超时 → 判断左右走回原点。
    bubbles.start('walk', walkDuration);
    if (mascotStop) await petLinkWalkTo(mascotStop.x, mascotStop.y, walkDuration, alive);
    bubbles.end('walk');
    if (!alive()) return state;
    // ① 主演出：一段素材演完「跳起抓住 → 眩晕 → 落地 → 起身」（8000ms）。
    //    用户口径里"吉祥物做准备…掐表为侧边栏逻辑做铺垫"没有对应素材 —— 那段就是
    //    走到位之后的**就位静默**，已由上面的 petLinkWalkTo 走完，不再单列一段。
    state.phase = 'mascot-tumble';
    let motion = Promise.resolve();
    await bubbles.play('mascotTumble', () => { motion = petLinkRunMascotMotion(alive, state, mascotLanding); });
    await motion;
    if (!alive()) return state;
    // ③ 气泡（同样**停留展示**，3s 自动消失）
    bubbles.defaultShow('mascot');
    if (!alive()) return state;
    await petLinkFinishAction(alive);
    if (!alive()) return state;
    petLinkHandoffPosition();
    state.phase = 'hold';
    state.holdStop = await petLinkWaitSidebarClose(alive);
  } else if (logic === 'egg2') {
    // ── 彩蛋二：原地气泡 → 哈气及全屏抖动 → 按实际播放进度展开侧栏 ────────
    state.phase = 'egg2-still';
    bubbles.defaultShow('egg2');
    bubbles.start('eggLead', eggLead);
    await petLinkWait(eggLead);   // 让气泡先露出来再开始演
    bubbles.end('eggLead');
    if (!alive()) return state;
    state.phase = 'egg2-hiss';
    let hissMotion = Promise.resolve(false);
    await bubbles.play('eggHiss', () => { hissMotion = petLinkEggHissMotion(alive); });
    await hissMotion;
    if (!alive()) return state;
    await petLinkFinishAction(alive);
    if (!alive()) return state;
    petLinkHandoffPosition();
    // 回收气泡（补丁缺席时无效，届时气泡按宿主默认时长自行消失）
    state.phase = 'egg2-reclaim';
    bubbles.defaultHide('egg2');
  } else {
    // ── 彩蛋一（第 3 次逻辑一）：踢腿 → 被弹飞 → 落地 ────────────────────────
    //  用户口径（动作索引.txt）：
    //    通用-右侧螃蟹步 → 弹气泡 → 彩蛋-侧边栏-半身转向踢腿 → **回收气泡**
    //    → 彩蛋-侧边栏-被弹飞 → 弹气泡 → 彩蛋-侧边栏-落地 → **回收气泡** → 等待 → 回原点。
    bubbles.start('walk', walkDuration);
    await petLinkWalkTo(kickStop.x, kickStop.y, walkDuration, alive);
    bubbles.end('walk');
    if (!alive()) return state;
    // ① 先弹气泡（愤怒），再踢。气泡挂在踢腿段之前 —— 用户口径的顺序就是"弹→踢"。
    state.phase = 'egg1-angry';
    bubbles.defaultShow('egg1Angry');
    bubbles.start('eggLead', eggLead);
    await petLinkWait(eggLead);
    bubbles.end('eggLead');
    if (!alive()) return state;
    state.phase = 'egg1-kick';
    await bubbles.play('eggKick');
    if (!alive()) return state;
    // ② 收回愤怒气泡，弹飞素材实际开播后再驱动侧栏第一次撞击。
    state.phase = 'egg1-reclaim1';
    bubbles.defaultHide('egg1Angry');
    if (!alive()) return state;
    state.phase = 'egg1-flung';
    let flight = Promise.resolve(false);
    await bubbles.play('eggFlung', () => { flight = petLinkEggRebound(alive); });
    await flight;
    if (!alive()) return state;
    // 原生抛掷已落定；素材和物理都完成才进入落地段。
    state.phase = 'egg1-settle';
    bubbles.start('eggSettle', 0);
    await petLinkWaitSettled(alive);
    bubbles.end('eggSettle');
    if (!alive()) return state;
    // ④ 落地中弹第二条气泡（"哇啊啊啊啊啊"），落地演完即回收。
    state.phase = 'egg1-land';
    bubbles.defaultShow('egg1Land');
    await bubbles.play('eggLand');
    if (!alive()) return state;
    await petLinkFinishAction(alive);
    if (!alive()) return state;
    petLinkHandoffPosition();
    state.phase = 'egg1-reclaim2';
    bubbles.defaultHide('egg1Land');
    // 第二次展开保持打开；落地后只等独立停留时长，再正常回程。
    state.phase = 'egg1-rest';
    await petLinkWait(Math.max(0, petLinkTune('egg1PostLandMs', 'egg1')));
    state.holdStop = alive() ? 'land-rest' : 'aborted';
  }

  if (!alive()) return state;
  // 回到触发时保存的绝对原点；等待中的原生漫游和抛掷都会改变基准位置。
  // 回程结束把可见位置交还桌宠并清 transform，中断由 finally 兜底。
  if (state.phase !== 'return') {
    state.phase = 'return';
    // 用户口径（动作索引.txt）：「返回原点动画要做判断左/右按结果采用【通用-左/右侧螃蟹步】」——
    // 回程必须**带走路动作**，且方向按原点在当前位置的哪一侧决定。
    const startReturn = duration => bubbles.start('return', duration);
    if (logic === 'egg1') await petLinkEggReturnHome(600, alive, state.home, startReturn);
    else await petLinkReturnHomeWalk(600, alive, state.home, startReturn);
    bubbles.end('return');
  }
  state.phase = 'done';
  return state;
}

/** 点击吉祥物的入口：先判距离，再跑对应逻辑。占用忙标记要早于探测，
 *  否则探测往返期间再点一次会并发起第二套流程（宠物会来回乱走）。 */
/** 原交互仅尝试一次；侧栏未就绪时提供可见诊断，不伪报已处理。 */
function petLinkFallback() {
  let handled = false;
  try { if (typeof wallSidebarToggle === 'function') handled = wallSidebarToggle() === true; } catch { /* 由维护面板报告失败。 */ }
  petLinkState.fallbackReason = handled ? '' : weT('壁纸侧栏尚未就绪');
  petTunerSyncRuntime();
  if (!handled) petLink.tuner.open();
  return { logic: 'disabled', busy: false, fallback: handled, reason: petLinkState.fallbackReason };
}

function petLinkTap() {
  if (!petLinkEligible()) return Promise.resolve(petLinkFallback());
  if (petLinkState.runner && petLinkState.runner.busy) {
    return Promise.resolve({ logic: 'busy', busy: true });
  }
  if (petLinkState.bubbleRun) petLinkState.bubbleRun.cancel();
  const epoch = petLinkState.epoch;
  const sidebarApi = (petLinkState.runner && petLinkState.runner.sidebar) || null;
  petLinkState.runner = { busy: true, sidebar: sidebarApi };
  const settle = (result) => {
    if (epoch !== petLinkState.epoch) return;
    if (result) petLinkState.lastResult = result;
    petLinkState.runner = { busy: false, sidebar: sidebarApi };
  };
  return Promise.resolve(petLinkEligible()).then(ok => {
    if (epoch !== petLinkState.epoch) return { logic: 'cancelled', busy: false };
    if (!ok) {
      // 接管尚未开始，本次原交互仅回退一次。
      // 绝不出现"点了没反应"。
      const result = petLinkFallback();
      settle({ logic: 'disabled', phase: 'done', home: null });
      return result;
    }
    let logic = petLinkDecide();
    if (logic === 'sidebar') {
      // 逻辑一计数：第 3 次触发 ⇒ 彩蛋一（踢腿/被弹飞/落地）
      petLinkState.farCount++;
      if (petLinkState.farCount >= petLinkTune('eggAt', 'sidebar')) { petLinkState.farCount = 0; logic = 'egg1'; }
    } else {
      // 逻辑二计数：第 3 次触发 ⇒ 彩蛋二（原地哈气）
      // ⚠️ 用户口径（2026-10-15）：「触发逻辑二次数达到阈值3次」—— 与逻辑一**各自独立**计数，
      //    不是共用一个计数器（共用一个会让两条彩蛋互相抢触发）。
      petLinkState.nearCount++;
      if (petLinkState.nearCount >= petLinkTune('eggAt', 'mascot')) { petLinkState.nearCount = 0; logic = 'egg2'; }
    }
    return petLinkRun(logic, epoch).then(result => {
      settle(result);
      return { logic, busy: false };
    }, () => {
      // 流程中途抛错也要收尾并留下可诊断的结果（绝不把 busy 卡死）
      settle({ logic, phase: 'done', home: petLinkState.lastResult ? petLinkState.lastResult.home : null });
      return { logic, busy: false };
    });
  }).catch(() => {
    settle({ logic: 'error', phase: 'done', home: null });
    return { logic: 'error', busy: false };
  });
}

const petLinkMascot = {
  tap: petLinkTap,
  registerGesture(cancel) {
    petLinkState.cancelGesture = cancel;
    return () => { if (petLinkState.cancelGesture === cancel) petLinkState.cancelGesture = null; };
  },
  snapshot() {
    return {
      available: petLinkState.available,
      reason: petLinkState.reason,
      phase: (petLinkState.lastResult && petLinkState.lastResult.phase) || 'idle',
      logic: (petLinkState.lastResult && petLinkState.lastResult.logic) || '',
      home: (petLinkState.lastResult && petLinkState.lastResult.home) || null,
      left: (() => { const r = petLinkPetRect(); return r ? Math.round(r.left) : null; })(),
      top: (() => { const r = petLinkPetRect(); return r ? Math.round(r.top) : null; })(),
      farCount: petLinkState.farCount,
      nearCount: petLinkState.nearCount,
      busy: Boolean(petLinkState.runner && petLinkState.runner.busy),
    };
  },
  /** client.js 在挂载时注册侧栏控制面（开/关/预览/提交/是否开）。 */
  registerSidebar(api) {
    petLinkState.runner = { busy: Boolean(petLinkState.runner && petLinkState.runner.busy), sidebar: api || null };
  },
  reset() { petLinkState.farCount = 0; petLinkState.nearCount = 0; },
};
const petLinkPerformer = {
  /** 绳子的"抓住"手势 → `brace`（蓄力准备往后拉）：新协议里语义最近的一段。 */
  onGrab() {
    if (!petLinkEligible()) return Promise.resolve(false);
    return petLinkPlay('brace', { gap: 0, hold: PET_HOLD.brace });
  },
  /** 绳子被往下拽 → `pull`（后拉接疲态结束）。
   *  `progress` 是跟手进度：太小的抖动不触发（与旧行为一致），避免轻轻一碰就播 10s 长段。 */
  onPull(progress) {
    if (!petLinkEligible() || !Number.isFinite(progress) || progress < 0.12) return Promise.resolve(false);
    return petLinkPlay('pull', { gap: 400, hold: PET_HOLD.pull });
  },
  /** 松手。
   *  ⚠️ 新协议**没有**"松手"素材了（旧的 `拉侧栏-松手` 已随整批换代退休，见 PET_ANIM 的说明），
   *  所以这里如实返回 false（= 这一段没有动作可播），不再拿别的段硬凑 ——
   *  硬凑会让"松手"看起来像又拉了一下（观感反而错）。 */
  onRelease() { return Promise.resolve(false); },
  snapshot() {
    return { available: petLinkState.available, reason: petLinkState.reason,
      last: petLinkState.lastKey, queued: petLinkState.queue.length };
  },
};
const petLink = {
  performer: petLinkPerformer,
  // 页内调参面板（用户口径 2026-10-15）：热键开关 + 强制跑某条逻辑 + 导出当前生效值。
  // 面板本体在 src/pet-link-tuner.js（同一条内联通路 ⇒ 同作用域，故排在内联清单里它之前）。
  tuner: petLinkTuner,
  mascot: petLinkMascot,
  warmup() { return petLinkRuntimeStart(); },
  dispose() {
    const rt = petLinkRuntime;
    rt.started = false; rt.token++;
    if (rt.timer !== null) clearTimeout(rt.timer);
    rt.timer = null;
    petLinkCancel();
    petTunerDispose();
    if (typeof window !== 'undefined' && window[PET_LINK_RUNTIME_KEY] === petLinkRuntimeOwner)
      delete window[PET_LINK_RUNTIME_KEY];
    petLinkState.runner = null;
    petLinkState.farCount = 0; petLinkState.nearCount = 0; petLinkState.lastResult = null;
  },
  names: PET_ANIM,
  target: PET_TARGET,
};

// ════════════════════════════════════════════════════════════════════════════
// 调参覆盖层（用户口径 2026-10-15：「方便调数值互动，决定什么时候播什么动画、播多久」）
//
// 设计：常量仍是**唯一真源**（守卫逐字读它们），但排播一律经 `petLinkTune(key)` 取值。
//      覆盖层为空时 `petLinkTune(key)` 返回的默认值与常量**逐字相等** ⇒ 行为不变。
//      ⚠️ 这张表**必须排在文件末尾**：它引用的常量里 `PET_FOLLOW_STILL_EPS` 声明在文件中段，
//      放前面会在模块求值时撞 TDZ（ReferenceError: Cannot access before initialization）。
// ════════════════════════════════════════════════════════════════════════════

/** 面板可调键 → 默认值（必须与对应常量逐字相等，由 verify-pet-mascot 逐键对账）。 */
const PET_TUNE_DEFAULTS = {
  'sidebarWalkMs': PET_SIDEBAR_WALK_MS,
  'braceMs': PET_BRACE_MS,
  'pullMs': 10125,
  'slowOpenMs': 8125,
  'bubbleMs': 3000,
  'bubbleWindowMs': 4000,
  'lockHeartbeatMs': 20000,
  'holdMaxMs': 180000,
  'eggAt': 3,
  'mascotGrabAtMs': 2500,
  'eggBubbleLeadMs': 600,
  'returnWalkMinPx': 40,
  'handRightRatio': 0.5703,
  'edgeGapPx': -15,
  'openLeadMs': 0,
  'openDelayMs': PET_OPEN_DELAY_MS,
  'segGapMs': 0,
  'followGraceMs': 200,
  'followSpeed': 3200,
  'followStillMs': 140,
  'followStillEps': 0.5,
  'mascotWalkMs': 0,
  'mascotTumbleMs': PET_HOLD.mascotTumble,
  'mascotOpenAtMs': PET_MASCOT_GRAB_AT_MS,
  'mascotRopeDownPx': PET_ROPE_PULL_DOWN,
  'mascotRopePullMs': PET_ROPE_PULL_MS,
  'mascotRopeBackMs': PET_ROPE_BACK_MS,
  'mascotReleaseAtMs': 2920,
  'mascotDropPx': 90,
  'mascotDropMs': 520,
  'mascotRopePullEase': 1,
  'mascotRopeBackEase': 2,
  'egg1EdgeGapPx': 0,
  'egg1WalkMs': 0,
  'egg1LeadMs': PET_EGG_BUBBLE_LEAD_MS,
  'egg1KickMs': PET_HOLD.eggKick,
  'egg1FlungMs': PET_HOLD.eggFlung,
  'egg1LandMs': PET_HOLD.eggLand,
  'egg1FlingDelayMs': 0,
  'egg1FlingPx': PET_FLING_LEFT,
  'egg1FlingMs': PET_FLING_MS,
  'egg1PostLandMs': 600,
  'egg2LeadMs': PET_EGG_BUBBLE_LEAD_MS,
  'egg2HissMs': PET_HOLD.eggHiss,
  'egg2ShakeAtMs': 1750,
  'egg2ShakePx': 8,
  'egg2ShakeHz': 12,
  'egg2OpenAtPct': 35,
  'egg2OpenEase': 2,
};

/** 取一个可调参数的当前生效值：优先覆盖层，其次默认表，未知键返回 undefined。 */
function petLinkTune(key, logic = petLinkState.activeLogic || 'sidebar') {
  const local = logic && petLinkState.logicTuning && petLinkState.logicTuning[logic];
  if (local && Object.prototype.hasOwnProperty.call(local, key) && Number.isFinite(local[key])) return local[key];
  const legacyValues = petLinkState.tuning || {};
  if (Object.prototype.hasOwnProperty.call(legacyValues, key) && Number.isFinite(legacyValues[key])) return legacyValues[key];
  // 兼容旧平面 JSON；新页面显式写入后，各自覆盖不再共享。
  const legacy = { egg1LeadMs: 'eggBubbleLeadMs', egg2LeadMs: 'eggBubbleLeadMs', mascotOpenAtMs: 'mascotGrabAtMs' };
  const alias = legacy[key];
  if (alias && Object.prototype.hasOwnProperty.call(legacyValues, alias) && Number.isFinite(legacyValues[alias])) return legacyValues[alias];
  if (Object.prototype.hasOwnProperty.call(PET_TUNE_DEFAULTS, key)) return PET_TUNE_DEFAULTS[key];
  return undefined;
}
function petLinkSetLogicTune(logic, key, value) {
  if (!PET_TUNER_LOGICS.some(item => item.logic === logic)
    || !Object.prototype.hasOwnProperty.call(PET_TUNE_DEFAULTS, key) || !Number.isFinite(value)) return false;
  if (['mascotRopePullEase', 'mascotRopeBackEase', 'egg2OpenEase'].includes(key) && ![0, 1, 2].includes(value)) return false;
  if (key === 'egg2OpenAtPct' && (value < 0 || value > 100)) return false;
  if (key === 'egg2ShakeAtMs' && value < 0) return false;
  if (key === 'egg2ShakePx' && (value < 0 || value > 40)) return false;
  if (key === 'egg2ShakeHz' && (value < 0 || value > 30)) return false;
  if (!petLinkState.logicTuning) petLinkState.logicTuning = {};
  if (!petLinkState.logicTuning[logic]) petLinkState.logicTuning[logic] = {};
  petLinkState.logicTuning[logic][key] = value;
  return true;
}

/** 保留旧平面格式，并额外导出四页完整生效值及私有覆盖。 */
function petLinkTuneSnapshot() {
  const values = {}, defaults = {}, overridden = [];
  for (const key of Object.keys(PET_TUNE_DEFAULTS)) {
    const def = PET_TUNE_DEFAULTS[key];
    defaults[key] = def;
    const live = petLinkTune(key, null);
    values[key] = Number.isFinite(live) ? live : null;
    if (values[key] !== def) overridden.push(key);
  }
  const logicValues = {}, logicTuning = {};
  for (const { logic } of PET_TUNER_LOGICS) {
    logicValues[logic] = Object.fromEntries(Object.keys(PET_TUNE_DEFAULTS).map(key => [key, petLinkTune(key, logic)]));
    logicTuning[logic] = { ...((petLinkState.logicTuning || {})[logic] || {}) };
  }
  return { values, defaults, overridden, logicValues, logicTuning, bubbleTiming: petLinkBubbleTimingSnapshot() };
}

/** 面板的「▶ 跑一遍」：**指定**逻辑跑一次（绕过距离判断与彩蛋计数），其余与点击同路。 */
function petLinkTunerRun(logic) {
  if (!petLinkEligible()) return Promise.resolve({ logic: 'disabled', busy: false });
  if (petLinkState.runner && petLinkState.runner.busy) {
    return Promise.resolve({ logic: 'busy', busy: true });
  }
  if (petLinkState.bubbleRun) petLinkState.bubbleRun.cancel();
  const epoch = petLinkState.epoch;
  const sidebarApi = (petLinkState.runner && petLinkState.runner.sidebar) || null;
  petLinkState.runner = { busy: true, sidebar: sidebarApi };
  const settle = (result) => {
    if (epoch !== petLinkState.epoch) return;
    if (result) petLinkState.lastResult = result;
    petLinkState.runner = { busy: false, sidebar: sidebarApi };
  };
  return petLinkProbe().then(ok => {
    if (!ok || epoch !== petLinkState.epoch) {
      settle({ logic: 'disabled', phase: 'done', home: null });
      return { logic: 'disabled', busy: false };
    }
    return petLinkRun(logic, epoch).then(result => {
      settle(result);
      return { logic, busy: false };
    }, () => {
      settle({ logic, phase: 'done', home: null });
      return { logic, busy: false };
    });
  }).catch(() => {
    settle({ logic: 'error', phase: 'done', home: null });
    return { logic: 'error', busy: false };
  });
}
