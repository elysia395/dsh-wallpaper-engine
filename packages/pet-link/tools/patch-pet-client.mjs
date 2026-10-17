import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

/**
 * dsh-pet 渲染半（`lib/client.js`）补丁：**独占锁**（动画 + 气泡 + 移动）+ 气泡时长可控/可回收。
 *
 * ── 用户口径（2026-10-15）───────────────────────────────────────────────────
 * 「只要一进入 DSHWE 的动画开始就**拒绝所有输入**，包括动画以及任何气泡。
 *   到结束才允许释放。」——先用补丁实现，后续再研究无损注入。
 *
 * ── 为什么必须打补丁：宿主有**三条平行通道**，彼此没有优先级语义 ─────────────
 *  ① **动画**：十几个 `setAnim` 调用点（随机链 / 点击 / 拖拽 / 余额 / 工作状态 /
 *     碎碎念 / 右键菜单）。谁最后调谁赢，宿主没有锁/占用/优先级接口。
 *  ② **气泡**：三个**独立**开关（balance / whisper / workStatus），而且渲染**有优先级**：
 *         workStatus 终态 > whisper > balance > workStatus 非终态
 *     ⇒ 别人的气泡会**直接盖掉**我们那张（不是"同时显示两张"）。
 *  ③ **移动**：随机链的 `move` 档经 `tryMove` → `startMoveDrive` **真的改 `left/top`**
 *     把宠物搬走（`pet-link` 的位移只写 `transform`，两者叠加 ⇒ 位置彻底跑偏）。
 *
 * ⚠️ **第一版补丁只拦了 ①**，实测气泡与走位照样插进来 —— 这是本版重做的原因。
 *
 * ── 补丁做什么（**只加控制面，不改宿主原有行为**）───────────────────────────
 *  页内控制面 `window.__dshPetCtl`：
 *    · `lock(name, ttlMs?)` / `unlock()` / `isLocked()` —— 独占锁
 *    · `allowBubble(ms?)` —— 开一个"允许气泡"的窗口（**我方气泡专用**）
 *    · `setBubbleDuration(ms)` / `getBubbleDuration()` / `hideBubble()`
 *  并且把三条通道的出口各包一层闸门：
 *    · `setAnim`：锁住时只放行被锁的名字；
 *    · 三个气泡 setter：锁住时**只拦 `true`**（`false` 永远放行，否则定时器关不掉），
 *      且仅在 `allowBubble` 窗口内放行 —— 这样我方的气泡能显示、别人的显示不了；
 *    · `tryMove`：锁住时返回 `true`（语义 = "移动占用中，不重播"）⇒ 既不移动也不换动画；
 *    · `handlePointerDown`：锁住时直接 return ⇒ 点击/拖拽也一并"拒绝输入"。
 *  另：`lock()` 会**立刻**收回正在显示的外来气泡、并取消在途移动。
 *
 * ── 安全边界 ──────────────────────────────────────────────────────────────
 *  · **默认行为逐字不变**：不设时长 ⇒ 10s；不锁 ⇒ 全部放行；不开窗口 ⇒ 不拦气泡。
 *  · **自动过期是安全兜底**：锁的释放依赖调用方（墙纸侧在 `finally` 里解锁），
 *    但"异常退出且没走到 finally"是可能的 —— 没有过期兜底，宠物会被**永久冻住**
 *    （所有随机行为、点击、拖拽全被闸掉），比"被插入"严重得多。
 *  · 指纹校验：只认已复算的官方构建；用户改过 / 版本不符一律拒绝写入。
 *  · 写前备份、写后校验；**只动这一个文件**，不碰 dsh-pet 的其它任何文件。
 *  · 幂等：已打补丁（指纹相符）直接返回，不重复写。
 */

/** 支持的 dsh-pet 版本（补丁针对其 `lib/client.js` 复算）。 */
const SUPPORTED_VERSION = '0.3.6';
/** 官方原版 `lib/client.js` 的 sha256（未打过本补丁）。**导出**供判据用（单一真源）。 */
export const ORIGINAL = '34fd03899054b1f742f241b7d9b3b20d4ca1fb06d2ce1a4a66cbec9a406b96ec';

const sha = (data) => createHash('sha256').update(data).digest('hex');

/** 独占锁的基础设施：插在 `[anim, setAnim]` 声明处。
 *  它是 `readLock` / `setAnim` / `allowBubble` 的**唯一定义点**，后面几条替换都引用它。 */
const LOCK_INFRA = [
  '\t\t// ── pet-link 补丁：独占锁（动画 + 气泡 + 移动）──────────────────────',
  '\t\t// 用户口径：「只要一进入 DSHWE 的动画开始就拒绝所有输入，包括动画以及任何气泡。」',
  '\t\t//',
  '\t\t// ⚠️ 为什么只拦 `setAnim` 不够（第一版的教训）：宿主有**三条平行通道** ——',
  '\t\t//   ① 动画：十几个 setAnim 调用点，谁最后调谁赢；',
  '\t\t//   ② 气泡：三个独立开关，且渲染**有优先级**（别人的会直接盖掉我们那张）；',
  '\t\t//   ③ 移动：随机链 move 档经 tryMove → startMoveDrive 真的改 left/top 把宠物搬走。',
  '\t\t// 详见 patch-pet-client.mjs 的文件头。',
  '\t\t//',
  '\t\t// ⚠️⚠️ **自动过期是安全兜底，不是可选优化**：解锁依赖调用方（墙纸侧在 finally 里',
  '\t\t//   解锁）。若流程异常退出且没走到 finally，没有过期兜底就会把宠物**永久冻在',
  '\t\t//   最后一段动作上** —— 比"被插入"严重得多。所以每次判定都现算一次是否过期。',
  '\t\t//',
  '\t\t// ⚠️⚠️ 自动独占（2026-10-15 第二轮，用户口径「一直没实现」的根因之一）：',
  '\t\t//   宠物**右键菜单「动作 → DSHWE」直接点播**时，墙纸半根本没有机会调用 lock()',
  '\t\t//   —— 那条路径是 dsh-pet 自己 setAnim，锁从未存在过，于是随机链/气泡照样插进来。',
  '\t\t//   所以把「正在播的段属于 DSHWE 池」**本身**当成锁的来源：',
  '\t\t//   `setAnim` 一旦放行了一个 DSHWE 段名，就把它记进 `selfLockName`；',
  '\t\t//   该段播完的 `handleEnded` 会清掉它（释放）。不需要任何调用方记得上锁/解锁。',
  '\t\t//   池子从 `petAnims.events.DSHWE` 现取（= 注入工具写进 animation-ext/ 的那九段）；',
  '\t\t//   扩展文件不在场时池子为空 ⇒ 这一层自动失效，回到纯粹的显式锁行为。',
  '\t\tconst selfPool = new Set();',
  '\t\ttry {',
  '\t\t\tconst slots = petAnims && petAnims.events ? petAnims.events.DSHWE : null;',
  '\t\t\tif (Array.isArray(slots)) {',
  '\t\t\t\tfor (const s of slots.flat()) if (typeof s === "string" && s) selfPool.add(s);',
  '\t\t\t}',
  '\t\t} catch (e) { /* 池子读不出来 ⇒ 自动独占不生效，不影响显式锁 */ }',
  '\t\tlet selfLockName = null;',
  '\t\t// 自动独占的兜底存活时长（ms）：最长的一段 DSHWE 素材是 10.125s，给到 20s 足够。',
  '\t\t// 正常情况下由 handleEnded 按时释放；这个上限只为兜住"视频报错 / onended 没触发"',
  '\t\t// 这类异常路径 —— 与显式锁的 60s 兜底同一个理由（绝不能让宠物被永久冻住）。',
  '\t\tconst SELF_LOCK_TTL_MS = 20000;',
  '\t\tlet selfLockUntil = 0;',
  '\t\tconst readLock = () => {',
  '\t\t\tif (typeof window === "undefined") return null;',
  '\t\t\tconst l = window.__dshPetLock;',
  '\t\t\tif (l && typeof l.name === "string" && l.name) {',
  '\t\t\t\tif (typeof l.expiresAt === "number" && Date.now() > l.expiresAt) {',
  '\t\t\t\t\twindow.__dshPetLock = null;',
  '\t\t\t\t\tconsole.warn("[dsh-pet][pet-link] 独占锁已超时自动解除（调用方没解锁？）");',
  '\t\t\t\t} else {',
  '\t\t\t\t\treturn l;',
  '\t\t\t\t}',
  '\t\t\t}',
  '\t\t\t// 显式锁不在场 ⇒ 看自动独占（菜单点播路径）',
  '\t\t\tif (selfLockName) {',
  '\t\t\t\tif (Date.now() > selfLockUntil) {',
  '\t\t\t\t\tselfLockName = null;',
  '\t\t\t\t\tconsole.warn("[dsh-pet][pet-link] 自动独占已超时自动解除（handleEnded 没触发？）");',
  '\t\t\t\t} else {',
  '\t\t\t\t\treturn { name: selfLockName, expiresAt: selfLockUntil, derived: true };',
  '\t\t\t\t}',
  '\t\t\t}',
  '\t\t\treturn null;',
  '\t\t};',
  '\t\tconst lockedNow = () => Boolean(readLock());',
  '\t\t// 「允许气泡」窗口：我方气泡要能显示，别人的不能。',
  '\t\t// ⚠️ 窗口必须够宽：宿主对 /state 的轮询间隔是 1s，广播到气泡显示之间有延迟。',
  '\t\tlet bubbleAllowUntil = 0;',
  '\t\tconst allowBubbleWindow = (ms) => {',
  '\t\t\tbubbleAllowUntil = Date.now() + (Number.isFinite(ms) && ms > 0 ? ms : 4000);',
  '\t\t};',
  '\t\tconst bubbleAllowed = () => Date.now() < bubbleAllowUntil;',
  '\t\tconst setAnim = (next) => {',
  '\t\t\tconst held = readLock();',
  '\t\t\tif (held && next !== held.name) {',
  '\t\t\t\tconsole.log("[dsh-pet][pet-link] 独占锁生效，已拦下动画：" + next);',
  '\t\t\t\treturn;',
  '\t\t\t}',
  '\t\t\t// 放行的这一段若属于 DSHWE 池 ⇒ **自动上锁**（菜单点播路径的唯一锁来源）。',
  '\t\t\t// 播完由 handleEnded 释放（兜底 TTL 见 SELF_LOCK_TTL_MS）；不需要任何调用方记得 lock/unlock。',
  '\t\t\tif (typeof next === "string" && selfPool.has(next)) {',
  '\t\t\t\tselfLockName = next;',
  '\t\t\t\tselfLockUntil = Date.now() + SELF_LOCK_TTL_MS;',
  '\t\t\t}',
  '\t\t\tsetAnimRaw(next);',
  '\t\t};',
].join('\n');

/** 气泡 setter 的闸门包装（三条通道各一份，只有**状态变量名**不同）。
 *
 *  ⚠️ 状态变量名与 setter 名**必须分开**处理 —— 这里踩过一个会直接打断渲染的坑：
 *  第一版只用一个占位符，于是把 `const [bubbleOn, setBubbleOnRaw]` 里的**状态变量**
 *  也一起改成了大写 `BubbleOn`；而渲染处读的仍是 `bubbleOn` ⇒ 渲染时
 *  `ReferenceError: bubbleOn is not defined`，**宠物整只直接挂掉**。
 *  所有"找字符串"的判据都没发现它（两边各自都"存在"），只有把注入片段**真的跑起来**
 *  才暴露（见 `test/verify-patch-behavior.mjs`）。
 *
 *  @param stateVar 原版里的**状态变量名**（逐字保留，不得改大小写）
 *  @param label 日志里用的中文名（余额 / 说话 / 工作状态） */
function bubbleGuard(stateVar, label) {
  const setter = 'set' + stateVar.charAt(0).toUpperCase() + stateVar.slice(1);
  return [
    '\t\tconst [' + stateVar + ', ' + setter + 'Raw] = useState(false);',
    '\t\t// pet-link 补丁：锁住时只拦 `true`（`false` 永远放行 —— 否则定时器关不掉气泡），',
    '\t\t// 且仅在 allowBubble 窗口内放行（我方的气泡能显示、别人的显示不了）。',
    '\t\tconst ' + setter + ' = (v) => {',
    '\t\t\tif (v === true && lockedNow() && !bubbleAllowed()) {',
    '\t\t\t\tconsole.log("[dsh-pet][pet-link] 独占锁生效，已拦下' + label + '气泡");',
    '\t\t\t\treturn;',
    '\t\t\t}',
    '\t\t\t' + setter + 'Raw(v);',
    '\t\t};',
  ].join('\n');
}

/** 补丁要做的**逐字符替换表**。
 *
 *  ⚠️ 每条 `from` 都必须与官方构建**逐字一致**（含缩进与换行）。
 *  除 `all: true` 的条目外，`from` 必须**唯一命中** —— 任何一条找不到或出现多次就整体拒绝
 *  （宁可失败，也不做"部分打上"的补丁：那种状态既无法回滚也无法诊断）。
 *  每条替换都自带 `expect`（打完后该串必须出现）与可读的用途说明。
 *
 *  ⚠️ 气泡时长为什么用**函数**而不是把常量改成变量：
 *  4 个调用点读的是模块级常量，把声明改成 `let` 也只是换个名字，
 *  调用点拿到的仍是**当时的值**。真正稳的做法是把「读时长」收敛成一个函数，
 *  由它每次现读可变的 `bubbleDurationMs` —— 这样 4 个调用点全都自动跟随。 */
export const EDITS = [
  {
    why: '气泡时长：常量 → 可变变量 + 读取函数（默认值不变，不设时行为与原实现逐字相同）',
    from: '/** 余额气泡展示时长（ms）：定时自动消失，与动画生命周期解耦 */\n'
      + 'const BUBBLE_DURATION_MS = 10 * 1e3;',
    to: '/** 余额气泡展示时长（ms）：定时自动消失，与动画生命周期解耦。\n'
      + ' *  ⚠️ 已由 pet-link 补丁改为**可调**（默认 10s ⇒ 不调时行为与原实现逐字相同）。\n'
      + ' *  外部经 `window.__dshPetCtl.setBubbleDuration(ms)` 调整；调用点一律走\n'
      + ' *  `bubbleDuration()` 现读，不要在调用点缓存它的值。 */\n'
      + 'let bubbleDurationMs = 10 * 1e3;\n'
      + 'const bubbleDuration = () => bubbleDurationMs;\n'
      + 'const BUBBLE_DURATION_MS = 10 * 1e3;',
    expect: 'const bubbleDuration = () => bubbleDurationMs;',
  },
  {
    why: '余额气泡定时器改走 `bubbleDuration()`（现读）—— 否则 setBubbleDuration 不起作用',
    from: 'window.setTimeout(() => setBubbleOn(false), BUBBLE_DURATION_MS)',
    to: 'window.setTimeout(() => setBubbleOn(false), bubbleDuration())',
    expect: 'setBubbleOn(false), bubbleDuration()',
    all: true,
  },
  {
    why: '工作状态气泡定时器同样改走 `bubbleDuration()`',
    from: 'window.setTimeout(() => setWorkBubbleOn(false), BUBBLE_DURATION_MS)',
    to: 'window.setTimeout(() => setWorkBubbleOn(false), bubbleDuration())',
    expect: 'setWorkBubbleOn(false), bubbleDuration()',
    all: true,
  },
  {
    why: '说话气泡定时器同样改走 `bubbleDuration()`',
    from: 'window.setTimeout(() => setWhisperBubbleOn(false), BUBBLE_DURATION_MS)',
    to: 'window.setTimeout(() => setWhisperBubbleOn(false), bubbleDuration())',
    expect: 'setWhisperBubbleOn(false), bubbleDuration()',
    all: true,
  },
  {
    why: '通道① 动画：`setAnim` 包守卫 + 装入独占锁基础设施（readLock / allowBubble / setAnim）',
    from: '\t\tconst [anim, setAnim] = useState(petAnims.idle[0] ?? "");',
    to: '\t\tconst [anim, setAnimRaw] = useState(petAnims.idle[0] ?? "");\n' + LOCK_INFRA,
    expect: 'const setAnim = (next) => {',
  },
  {
    why: '通道② 气泡（余额）：setter 包闸门（只拦 true，且需 allowBubble 窗口）',
    from: '\t\tconst [bubbleOn, setBubbleOn] = useState(false);',
    to: bubbleGuard('bubbleOn', '余额'),
    expect: 'const setBubbleOn = (v) => {',
  },
  {
    why: '通道② 气泡（说话）：setter 包闸门',
    from: '\t\tconst [whisperBubbleOn, setWhisperBubbleOn] = useState(false);',
    to: bubbleGuard('whisperBubbleOn', '说话'),
    expect: 'const setWhisperBubbleOn = (v) => {',
  },
  {
    why: '通道② 气泡（工作状态）：setter 包闸门 —— 它的**渲染优先级最高**，不拦会盖掉我们那张',
    from: '\t\tconst [workBubbleOn, setWorkBubbleOn] = useState(false);',
    to: bubbleGuard('workBubbleOn', '工作状态'),
    expect: 'const setWorkBubbleOn = (v) => {',
  },
  {
    why: '通道③ 移动：`tryMove` 在锁住时返回 `true`（= 移动占用中，不重播）⇒ 不移动也不换动画',
    from: '\t\tconst tryMove = (preferredName) => {\n'
      + '\t\t\tif (moveRef.current !== null || pendingMoveRef.current || throwRef.current !== null) return true;',
    to: '\t\tconst tryMove = (preferredName) => {\n'
      + '\t\t\t// pet-link 补丁：锁住时按"移动占用中"处理（返回 true）——\n'
      + '\t\t\t// 调用方据此走「移动进行中(不重播)」分支，于是既不移动、也不 setAnim。\n'
      + '\t\t\tif (lockedNow()) return true;\n'
      + '\t\t\tif (moveRef.current !== null || pendingMoveRef.current || throwRef.current !== null) return true;',
    expect: 'if (lockedNow()) return true;',
  },
  {
    why: '拒绝输入：锁住时点击/拖拽直接 return（用户口径「拒绝所有输入」）',
    from: '\t\tconst handlePointerDown = (e) => {\n\t\t\tif (e.button !== 0) return;',
    to: '\t\tconst handlePointerDown = (e) => {\n'
      + '\t\t\t// pet-link 补丁：锁住期间"拒绝所有输入"——点击、拖拽一律不响应。\n'
      + '\t\t\t// ⚠️ 有 60s 自动过期兜底，所以即使调用方忘记解锁也不会永久点不动。\n'
      + '\t\t\tif (lockedNow()) return;\n'
      + '\t\t\tif (e.button !== 0) return;',
    expect: 'if (lockedNow()) return;\n\t\t\tif (e.button !== 0) return;',
  },
  {
    why: '通道④ 重播通道：`setSeq` 包闸门 —— 它经 useEffect([anim,once,seq]) 触发 switchTo，'
      + '此时 pendingRef 已清空 ⇒ 会重新取素材**从头重播当前段**（绕过 setAnim 闸门的第二条动画通道）',
    from: '\t\tconst [seq, setSeq] = useState(0);',
    to: [
      '\t\tconst [seq, setSeqRaw] = useState(0);',
      '\t\t// pet-link 补丁：锁住期间**禁止重播通道**。',
      '\t\t// `seq` 是 `useEffect(() => { switchTo(anim, once); }, [anim, once, seq])` 的依赖项，',
      '\t\t// 而 `handleEnded` / `pickNext` 在段末都会无条件 `setSeq((s) => s + 1)`：',
      '\t\t// 此时 `anim` 已被 setAnim 闸门挡下（没变），但 `pendingRef.current` 已清空 ⇒',
      '\t\t// switchTo 会**重新 fetch 并从头重播**正被锁住的那一段。',
      '\t\t// 表现：锁住的段无限循环、永不结束（"到结束才释放"永远等不到）。',
      '\t\t// 锁住期间一律吞掉 —— 期间的转场只允许由 setAnim 自己驱动。',
      '\t\tconst setSeq = (v) => {',
      '\t\t\tif (lockedNow()) {',
      '\t\t\t\tconsole.log("[dsh-pet][pet-link] 独占锁生效，已拦下重播通道（setSeq）");',
      '\t\t\t\treturn;',
      '\t\t\t}',
      '\t\t\tsetSeqRaw(v);',
      '\t\t};',
    ].join('\n'),
    expect: 'const setSeq = (v) => {',
  },
  {
    why: 'DSHWE 段播完 ⇒ 释放自动独占（"到结束才允许释放，让宠物本身重新注入"）',
    from: '\t\tconst handleEnded = (e) => {\n'
      + '\t\t\tconst evEl = e && e.currentTarget;\n'
      + '\t\t\tif (evEl && !evEl.classList.contains("is-front")) return;',
    to: '\t\tconst handleEnded = (e) => {\n'
      + '\t\t\tconst evEl = e && e.currentTarget;\n'
      + '\t\t\tif (evEl && !evEl.classList.contains("is-front")) return;\n'
      + '\t\t\t// pet-link 补丁：**自动独占的释放点** —— 用户口径「到结束才允许释放这个输入，\n'
      + '\t\t\t// 允许 pet 本身注入」。锁住的那一段播完的这一刻交还控制权，随后本函数末尾的\n'
      + '\t\t\t// 正常逻辑（挑 idle / pickNext）就能照常执行。\n'
      + '\t\t\t// ⚠️ 只清自动独占，**不**碰显式锁（墙纸侧的整段编排仍由它罩着）。\n'
      + '\t\t\tif (typeof animRef.current === "string" && selfPool.has(animRef.current)) {\n'
      + '\t\t\t\tselfLockName = null;\n'
      + '\t\t\t\tconsole.log("[dsh-pet][pet-link] 独占锁释放（DSHWE 段播完）：" + animRef.current);\n'
      + '\t\t\t}',
    expect: '独占锁释放（DSHWE 段播完）',
  },
  {
    why: '挂上页内控制面 `window.__dshPetCtl`（独占锁 / 允许气泡窗口 / 气泡时长 / 收回）',
    // 锚点选"清理效应"之前：它在四个气泡 setter 与 anim 声明**之后**，作用域全都可见。
    from: '\t\tuseEffect(() => () => {\n'
      + '\t\t\tif (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);',
    to: [
      '\t\t// ── pet-link 补丁：页内控制面 ─────────────────────────────────────',
      '\t\t// 为什么挂在窗口上而不是新开路由：dsh-pet 的渲染半与墙纸插件**同页**，',
      '\t\t// 直接给一个对象最省事（不需要新端点、不碰宿主的状态叶子、卸载即失效）。',
      '\t\t// 生命周期：挂载时装、卸载时删 —— 绝不留下指向已卸载组件的裸函数。',
      '\t\tuseEffect(() => {',
      '\t\t\t/** 锁的兜底存活时长（ms）：默认 60s，远长于任何一段素材（最长 10.125s）。',
      '\t\t\t *  调用方应显式 unlock；这个上限只为防"没走到 finally"的异常路径。',
      '\t\t\t *  ⚠️ 长流程（逻辑一停留等侧栏关闭最长 180s）必须显式传更长的 ttl，',
      '\t\t\t *     否则锁会在流程中途过期、随机链就会插进来。 */',
      '\t\t\tconst LOCK_TTL_MS = 60000;',
      '\t\t\t/** 收回全部气泡（三个槽一起）。用 Raw setter：闸门只该拦"显示"，不该拦"收回"。 */',
      '\t\t\tconst hideAllBubbles = () => {',
      '\t\t\t\tsetWhisperBubbleOnRaw(false);',
      '\t\t\t\tsetBubbleOnRaw(false);',
      '\t\t\t\tsetWorkBubbleOnRaw(false);',
      '\t\t\t};',
      '\t\t\tconst ctl = {',
      '\t\t\t\tversion: 2,',
      '\t\t\t\tsetBubbleDuration(ms) {',
      '\t\t\t\t\tconst n = Number(ms);',
      '\t\t\t\t\tif (!Number.isFinite(n) || n <= 0) return false;',
      '\t\t\t\t\tbubbleDurationMs = n;',
      '\t\t\t\t\treturn true;',
      '\t\t\t\t},',
      '\t\t\t\tgetBubbleDuration() { return bubbleDurationMs; },',
      '\t\t\t\tallowBubble(ms) { allowBubbleWindow(ms); return true; },',
      '\t\t\t\thideBubble() { hideAllBubbles(); return true; },',
      '\t\t\t\tlock(name, ttlMs) {',
      '\t\t\t\t\tif (typeof name !== "string" || !name) return false;',
      '\t\t\t\t\tconst ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : LOCK_TTL_MS;',
      '\t\t\t\t\twindow.__dshPetLock = { name: name, expiresAt: Date.now() + ttl };',
      '\t\t\t\t\t// 上锁即"清场"：收回正在显示的外来气泡、取消在途移动。',
      '\t\t\t\t\t// 不做这一步的话，锁住之前已经弹出来的气泡会一直挂着（最长 10s）。',
      '\t\t\t\t\ttry { hideAllBubbles(); } catch (e) { /* 收回失败不影响上锁 */ }',
      '\t\t\t\t\ttry { stopMove(); } catch (e) { /* 取消失败不影响上锁 */ }',
      '\t\t\t\t\treturn true;',
      '\t\t\t\t},',
      '\t\t\t\tunlock() {',
      '\t\t\t\t\t// ⚠️ 交还控制权（用户口径「到结束才允许释放这个输入，允许 pet 本身注入」）：',
      '\t\t\t\t\t// 锁住期间 `handleEnded` 的「回待机 / pickNext」被闸门挡下、重播通道也被吞掉，',
      '\t\t\t\t\t// 于是解锁时宠物会**停在最后一段的末帧**。这里补一次正常注入，让宠物立刻',
      '\t\t\t\t\t// 回到自己的节奏（挑 idle → 随后的随机链照常）。',
      '\t\t\t\t\t// 只在"确实锁着"时做：无锁解锁是空操作，不该打断宠物自己的演出。',
      '\t\t\t\t\tconst wasLocked = Boolean(readLock());',
      '\t\t\t\t\twindow.__dshPetLock = null;',
      '\t\t\t\t\t// ⚠️ 必须一并清自动独占：它的 TTL（20s）只按单个素材段算，',
      '\t\t\t\t\t// 而墙纸侧逻辑一的停留阶段最长 180s ⇒ 若只清显式锁，菜单点播留下的',
      '\t\t\t\t\t// 派生根会在 20s 后过期、也可能在中途把宠物冻住，行为不可预期。',
      '\t\t\t\t\tselfLockName = null;',
      '\t\t\t\t\tif (wasLocked) {',
      '\t\t\t\t\t\ttry {',
      '\t\t\t\t\t\t\tif (petAnims.idle.length) setAnimRaw(pick(petAnims.idle, animRef.current));',
      '\t\t\t\t\t\t\tsetOnce(true);',
      '\t\t\t\t\t\t\tsetSeqRaw((s) => s + 1);',
      '\t\t\t\t\t\t} catch (e) { /* 注入失败不影响解锁本身 */ }',
      '\t\t\t\t\t}',
      '\t\t\t\t\treturn true;',
      '\t\t\t\t},',
      '\t\t\t\tisLocked() { return Boolean(readLock()); },',
      '\t\t\t};',
      '\t\t\twindow.__dshPetCtl = ctl;',
      '\t\t\treturn () => {',
      '\t\t\t\tif (window.__dshPetCtl === ctl) window.__dshPetCtl = null;',
      '\t\t\t\twindow.__dshPetLock = null;',
      '\t\t\t};',
      '\t\t}, []);',
      '\t\tuseEffect(() => () => {',
      '\t\t\tif (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);',
    ].join('\n'),
    expect: 'window.__dshPetCtl = ctl;',
  },
];

/** 修复控制链路，不引入即时点播或视频对齐改写。 */
export const CONTROL_EDITS = [
  {
    why: '允许气泡的窗口必须跨 React 重渲染共享，控制面与当前 setter 不能读不同闭包',
    from: '\t\tlet bubbleAllowUntil = 0;\n'
      + '\t\tconst allowBubbleWindow = (ms) => {\n'
      + '\t\t\tbubbleAllowUntil = Date.now() + (Number.isFinite(ms) && ms > 0 ? ms : 4000);\n'
      + '\t\t};\n'
      + '\t\tconst bubbleAllowed = () => Date.now() < bubbleAllowUntil;',
    to: '\t\tconst bubbleAllowUntilRef = useRef(0);\n'
      + '\t\tconst allowBubbleWindow = (ms) => {\n'
      + '\t\t\tbubbleAllowUntilRef.current = Date.now() + (Number.isFinite(ms) && ms > 0 ? ms : 4000);\n'
      + '\t\t};\n'
      + '\t\tconst bubbleAllowed = () => Date.now() < bubbleAllowUntilRef.current;',
    expect: 'Date.now() < bubbleAllowUntilRef.current',
  },
  {
    why: '独占期间拒绝外部切换到循环，避免同一后拉段因 once 变化重新播放',
    from: '\t\tconst [once, setOnce] = useState(true);',
    to: '\t\tconst [once, setOnceRaw] = useState(true);\n'
      + '\t\tconst setOnce = (value) => {\n'
      + '\t\t\tif (lockedNow() && value !== true) return;\n'
      + '\t\t\tsetOnceRaw(value);\n'
      + '\t\t};',
    expect: 'if (lockedNow() && value !== true) return;',
  },
  {
    why: '显式独占下演到末帧停住，不执行工作状态回退或随机重播',
    from: '\t\tconst handleEnded = (e) => {\n'
      + '\t\t\tconst evEl = e && e.currentTarget;\n'
      + '\t\t\tif (evEl && !evEl.classList.contains("is-front")) return;',
    to: '\t\tconst handleEnded = (e) => {\n'
      + '\t\t\tconst evEl = e && e.currentTarget;\n'
      + '\t\t\tif (evEl && !evEl.classList.contains("is-front")) return;\n'
      + '\t\t\tconst held = readLock();\n'
      + '\t\t\tif (held && !held.derived) return;',
    expect: 'if (held && !held.derived) return;',
  },
  {
    why: '点播与广播确认后可唤醒已有状态轮询，不增加播放通道',
    from: '\t\t\t\tallowBubble(ms) { allowBubbleWindow(ms); return true; },',
    to: '\t\t\t\tpollState() { statePoller.now(); return true; },\n'
      + '\t\t\t\tallowBubble(ms) { allowBubbleWindow(ms); return true; },',
    expect: 'pollState() { statePoller.now(); return true; }',
  },
  {
    why: '记录续期前的锁，区分新动作清场与同一动作心跳',
    from: '\t\t\t\t\twindow.__dshPetLock = { name: name, expiresAt: Date.now() + ttl };',
    to: '\t\t\t\t\tconst previous = readLock();\n'
      + '\t\t\t\t\twindow.__dshPetLock = { name: name, expiresAt: Date.now() + ttl };',
    expect: 'const previous = readLock();',
  },
  {
    why: '心跳只续期，不把已经展示的我方气泡清掉',
    from: '\t\t\t\t\ttry { hideAllBubbles(); } catch (e) { /* 收回失败不影响上锁 */ }',
    to: '\t\t\t\t\tif (!previous || previous.derived || previous.name !== name) {\n'
      + '\t\t\t\t\t\ttry { hideAllBubbles(); } catch (e) { /* 收回失败不影响上锁 */ }\n'
      + '\t\t\t\t\t}',
    expect: 'if (!previous || previous.derived || previous.name !== name)',
  },
];

/** 自定义气泡时间线显式持有显示权；默认切换动作仍清场。 */
export const BUBBLE_TIMING_EDITS = [
  {
    why: '上锁可显式保留正在按节点精调的我方气泡',
    from: '\t\t\t\tlock(name, ttlMs) {',
    to: '\t\t\t\tlock(name, ttlMs, preserveBubble = false) {',
    expect: 'lock(name, ttlMs, preserveBubble = false)',
  },
  {
    why: '只有调用方显式持有自定义气泡才跨动作保留，默认清场不变',
    from: '\t\t\t\t\tif (!previous || previous.derived || previous.name !== name) {',
    to: '\t\t\t\t\tif (preserveBubble !== true && (!previous || previous.derived || previous.name !== name)) {',
    expect: 'if (preserveBubble !== true && (!previous',
  },
  {
    why: '主动关闭后撤销放行窗口，避免迟到的轮询把气泡重新显示',
    from: '\t\t\t\thideBubble() { hideAllBubbles(); return true; },',
    to: '\t\t\t\thideBubble() { bubbleAllowUntilRef.current = 0; hideAllBubbles(); return true; },',
    expect: 'hideBubble() { bubbleAllowUntilRef.current = 0;',
  },
];
export function applyBubbleTimingEdits(source) {
  return applyReplacements(source, BUBBLE_TIMING_EDITS);
}

export function applyAssetCacheEdits(source) {
  return applyReplacements(source, [{
    why: '同名替换跳抓素材后重新取文件，避免一小时HTTP缓存继续播放旧白袋',
    from: '\t\t\t\tcache: "default",',
    to: '\t\t\t\tcache: next === "吉祥物-跳抓眩晕落地起身-dshwe" ? "reload" : "default",',
    expect: 'cache: next === "吉祥物-跳抓眩晕落地起身-dshwe" ? "reload" : "default"',
  }]);
}

export function applyThrowEdits(source) {
  return applyReplacements(source, [{
    why: '彩蛋反击复用手动甩出物理，并提供只取消自身的句柄',
    from: '\t\t\t\tadoptPosition(point) {',
    to: '\t\t\t\tthrowNative(point, velocity) {\n'
      + '\t\t\t\t\tif (!point || !velocity || ![point.x, point.y, velocity.vx, velocity.vy].every(Number.isFinite) || !rootRef.current) return false;\n'
      + '\t\t\t\t\tstopMove(); stopThrow(); stopDragFollow();\n'
      + '\t\t\t\t\tconst x = point.x - halfW, y = point.y - halfH;\n'
      + '\t\t\t\t\tconst style = rootRef.current.style;\n'
      + '\t\t\t\t\tstyle.left = x + "px"; style.top = y + "px"; style.right = "auto"; style.bottom = "auto"; style.transform = "translate(0px,0px)";\n'
      + '\t\t\t\t\tboxPxRef.current = { x, y };\n'
      + '\t\t\t\t\tcustomPosRef.current = { rx: point.x / window.innerWidth, ry: point.y / window.innerHeight };\n'
      + '\t\t\t\t\tconst speed = Math.hypot(velocity.vx, velocity.vy), scale = speed > 3600 ? 3600 / speed : 1;\n'
      + '\t\t\t\t\tstartThrowLatestRef.current(x, y, velocity.vx * scale, velocity.vy * scale);\n'
      + '\t\t\t\t\treturn throwTokenRef.current;\n\t\t\t\t},\n'
      + '\t\t\t\tgetNativeThrow(id) {\n'
      + '\t\t\t\t\treturn { id, active: id === throwTokenRef.current && throwRef.current !== null, cancelled: id !== throwTokenRef.current, state: throwStateRef.current ? { ...throwStateRef.current } : null };\n\t\t\t\t},\n'
      + '\t\t\t\tstopNativeThrow(id) {\n'
      + '\t\t\t\t\tif (id !== throwTokenRef.current) return false;\n'
      + '\t\t\t\t\tstopThrow(); setCustomPos(customPosRef.current); return true;\n\t\t\t\t},\n'
      + '\t\t\t\tadoptPosition(point) {',
    expect: 'throwNative(point, velocity)',
  }]);
}

export function applyLifecycleEdits(source) {
  let result = applyReplacements(source, [{
    why: '播放回执跨渲染共享，气泡使用独立的有界租约',
    from: '\t\tconst selfPool = new Set();',
    to: '\t\tconst linkPlaybackRef = useRef({ id: 0, name: "", phase: "idle" });\n'
      + '\t\tconst bubbleLockedNow = () => {\n'
      + '\t\t\tconst held = window.__dshPetBubbleLock;\n'
      + '\t\t\tif (!held) return false;\n'
      + '\t\t\tif (Date.now() >= held.expiresAt) { window.__dshPetBubbleLock = null; return false; }\n'
      + '\t\t\treturn true;\n\t\t};\n\t\tconst selfPool = new Set();',
    expect: 'const linkPlaybackRef = useRef(',
  }, {
    why: '三个原生气泡入口不再依赖动作锁',
    from: 'v === true && lockedNow() && !bubbleAllowed()',
    to: 'v === true && bubbleLockedNow() && !bubbleAllowed()', all: true,
    expect: 'v === true && bubbleLockedNow()',
  }, {
    why: '动作接管不再顺便清除气泡',
    from: '\t\t\t\t\tif (preserveBubble !== true && (!previous || previous.derived || previous.name !== name)) {\n'
      + '\t\t\t\t\t\ttry { hideAllBubbles(); } catch (e) { /* 收回失败不影响上锁 */ }\n\t\t\t\t\t}',
    to: '\t\t\t\t\t// 气泡独占由 lockBubbles / unlockBubbles 单独管理。',
    expect: '// 气泡独占由 lockBubbles / unlockBubbles 单独管理。',
  }, {
    why: '暴露真实开播/结束状态和无跳变的位置交还',
    from: '\t\t\t\tversion: 2,',
    to: '\t\t\t\tversion: 3,\n'
      + '\t\t\t\tgetPlayback() {\n'
      + '\t\t\t\t\tconst el = (frontRef.current === 0 ? videoARef : videoBRef).current;\n'
      + '\t\t\t\t\treturn { ...linkPlaybackRef.current, currentTime: el?.currentTime || 0, duration: el?.duration || 0 };\n\t\t\t\t},\n'
      + '\t\t\t\tlockBubbles(ttlMs = 60000) {\n'
      + '\t\t\t\t\twindow.__dshPetBubbleLock = { expiresAt: Date.now() + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 60000) };\n'
      + '\t\t\t\t\treturn true;\n\t\t\t\t},\n'
      + '\t\t\t\tunlockBubbles() { window.__dshPetBubbleLock = null; bubbleAllowUntilRef.current = 0; return true; },\n'
      + '\t\t\t\tisBubbleLocked() { return bubbleLockedNow(); },\n'
      + '\t\t\t\tadoptPosition(point) {\n'
      + '\t\t\t\t\tif (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !rootRef.current) return false;\n'
      + '\t\t\t\t\tstopMove(); stopThrow(); stopDragFollow();\n'
      + '\t\t\t\t\tconst pos = { rx: point.x / window.innerWidth, ry: point.y / window.innerHeight };\n'
      + '\t\t\t\t\tcustomPosRef.current = pos;\n'
      + '\t\t\t\t\tconst style = rootRef.current.style;\n'
      + '\t\t\t\t\tstyle.left = point.x - halfW + "px"; style.top = point.y - halfH + "px";\n'
      + '\t\t\t\t\tstyle.right = "auto"; style.bottom = "auto"; style.transform = "translate(0px,0px)";\n'
      + '\t\t\t\t\tsetCustomPos(pos);\n\t\t\t\t\treturn true;\n\t\t\t\t},',
    expect: 'adoptPosition(point)',
  }, {
    why: '加载尚未完成时不能把点播成功当作视频开播',
    from: '\t\t\tconst gen = ++genRef.current;',
    to: '\t\t\tconst gen = ++genRef.current;\n\t\t\tlinkPlaybackRef.current = { id: gen, name: next, phase: "loading" };',
    expect: 'name: next, phase: "loading"',
  }, {
    why: '只在真实 playing 事件报告开播，失败必须可取消',
    from: '\t\t\t\tel.play().catch(() => {});',
    to: '\t\t\t\tel.__dshwePlaybackId = gen;\n'
      + '\t\t\t\tconst reportPlaying = () => {\n'
      + '\t\t\t\t\tif (linkPlaybackRef.current.id === gen) linkPlaybackRef.current = { id: gen, name: next, phase: "playing" };\n\t\t\t\t};\n'
      + '\t\t\t\tel.addEventListener("playing", reportPlaying, { once: true });\n'
      + '\t\t\t\tel.play().catch(() => { if (linkPlaybackRef.current.id === gen) linkPlaybackRef.current.phase = "failed"; });',
    expect: 'el.addEventListener("playing", reportPlaying',
  }, {
    why: '素材加载失败能解除等待而不是冻结流程',
    from: '\t\t\t\tpendingRef.current = null;\n\t\t\t\tconsole.warn("[dsh-pet] 素材加载失败',
    to: '\t\t\t\tpendingRef.current = null;\n\t\t\t\tlinkPlaybackRef.current.phase = "failed";\n\t\t\t\tconsole.warn("[dsh-pet] 素材加载失败',
    expect: 'linkPlaybackRef.current.phase = "failed";',
  }, {
    why: '显式动作锁停帧之前记录真实 ended，让末段释放不依赖猜时长',
    from: '\t\t\tconst held = readLock();\n\t\t\tif (held && !held.derived) return;',
    to: '\t\t\tif (evEl && evEl.__dshwePlaybackId === linkPlaybackRef.current.id) linkPlaybackRef.current.phase = "ended";\n'
      + '\t\t\tconst held = readLock();\n\t\t\tif (held && !held.derived) return;',
    expect: 'linkPlaybackRef.current.phase = "ended";',
  }, {
    why: '桌宠卸载时回收两种锁',
    from: '\t\t\t\tif (window.__dshPetCtl === ctl) window.__dshPetCtl = null;\n\t\t\t\twindow.__dshPetLock = null;',
    to: '\t\t\t\tif (window.__dshPetCtl === ctl) {\n\t\t\t\t\twindow.__dshPetCtl = null;\n\t\t\t\t\twindow.__dshPetLock = null;\n\t\t\t\t\twindow.__dshPetBubbleLock = null;\n\t\t\t\t}',
    expect: 'window.__dshPetBubbleLock = null;',
  }]);
  // 菜单点播与首次挂载控制面必须共享同一个自动锁，否则解锁会读到旧闭包。
  result = result.replace('let selfLockName = null;', 'const selfLockRef = useRef({ name: null, until: 0 });')
    .replace('let selfLockUntil = 0;', '')
    .replace(/\bselfLockName\b/g, 'selfLockRef.current.name')
    .replace(/\bselfLockUntil\b/g, 'selfLockRef.current.until');
  return result;
}

/** 控制能力与实例绑定；不新增播放通道。 */
export function applyRuntimeOwnerEdits(source) {
  return applyReplacements(source, [{
    why: '控制面报告实际目标和根元素',
    from: '\t\t\t\tversion: 3,',
    to: '\t\t\t\tversion: 3,\n\t\t\t\ttarget: cfg.id,\n\t\t\t\tgetRoot() { return rootRef.current; },',
    expect: 'getRoot() { return rootRef.current; }',
  }, {
    why: '动作锁登记控制面所有者',
    from: 'window.__dshPetLock = { name: name, expiresAt:',
    to: 'window.__dshPetLock = { owner: ctl, name: name, expiresAt:',
    expect: 'window.__dshPetLock = { owner: ctl,',
  }, {
    why: '陈旧控制面不能解锁新实例',
    from: '\t\t\t\t\tconst wasLocked = Boolean(readLock());',
    to: '\t\t\t\t\tif (window.__dshPetLock?.owner && window.__dshPetLock.owner !== ctl) return false;\n\t\t\t\t\tconst wasLocked = Boolean(readLock());',
    expect: 'window.__dshPetLock.owner !== ctl',
  }, {
    why: '气泡锁登记控制面所有者',
    from: 'window.__dshPetBubbleLock = { expiresAt:',
    to: 'window.__dshPetBubbleLock = { owner: ctl, expiresAt:',
    expect: 'window.__dshPetBubbleLock = { owner: ctl,',
  }, {
    why: '旧气泡释放不影响新实例',
    from: 'unlockBubbles() { window.__dshPetBubbleLock = null;',
    to: 'unlockBubbles() { if (window.__dshPetBubbleLock?.owner && window.__dshPetBubbleLock.owner !== ctl) return false; window.__dshPetBubbleLock = null;',
    expect: 'window.__dshPetBubbleLock.owner !== ctl',
  }]);
}

/** 已发布旧补丁：只允许此精确指纹升级，仍拒绝未知修改。 */
export const PREVIOUS_PATCHED = '3a5cfec6751110e2d6f438fcc1be549250841450b573dd5b52325df68a6524a5';
/** 补丁后的预期指纹（修改后从已核对的原版复算）。 */
export const PREVIOUS_CONTROL_PATCHED = 'd9dc5aa5d00a28cd0a46e15b6988373e0bbed867b8407ae243d25e48d0e32d91';
export const PREVIOUS_BUBBLE_PATCHED = '4535c9447c350d7b2966d8ef417c9cf6612385df07eebd6662825e8d82257bcc';
export const PREVIOUS_CACHE_PATCHED = '4a73b16354d6c579456276c890c01578539fd182fac903b3b3176b32ca41b4d2';
export const PREVIOUS_LIFECYCLE_PATCHED = 'd257a88dba762e2ea7074d5e7550e5507bb441deb1534a76abf9b38731b67eda';
export const PREVIOUS_THROW_PATCHED = '9ce475c8f7cb5a5743334067666361845529137f78bad48aef120665df66ed26';
export const PATCHED = '7073c497cb9d81f28a7e303ef318b0fcb444b91ecb7682e4ccec69a2b3559c5a';

/** 对给定源码按序施加全部替换；任一 `from` 找不到即抛错（**不做部分补丁**）。
 *
 *  `all: true` 的条目允许多处出现（例如余额气泡有两条路径用同一个定时器形状），
 *  此时替换**全部**出现处；否则要求 `from` 在源码里**唯一**（锚点不唯一说明构建变了，
 *  必须停下来复算，而不是"改第一个撞上的"）。 */
function applyReplacements(source, edits) {
  let out = source;
  for (const edit of edits) {
    const at = out.indexOf(edit.from);
    if (at < 0) throw new Error('补丁锚点未找到（构建不匹配）：' + edit.why);
    if (edit.all) {
      out = out.split(edit.from).join(edit.to);
    } else {
      if (out.indexOf(edit.from, at + 1) >= 0) throw new Error('补丁锚点不唯一（拒绝打补丁）：' + edit.why);
      out = out.slice(0, at) + edit.to + out.slice(at + edit.from.length);
    }
    if (out.indexOf(edit.expect) < 0) throw new Error('补丁施加后校验失败：' + edit.why);
  }
  return out;
}

export function applyControlEdits(source) {
  return applyReplacements(source, CONTROL_EDITS);
}
export function applyEdits(source) {
  return applyRuntimeOwnerEdits(applyThrowEdits(applyLifecycleEdits(applyAssetCacheEdits(applyBubbleTimingEdits(applyControlEdits(applyReplacements(source, EDITS)))))));
}

/** 给 dsh-pet 包打补丁。
 *  @param packageRoot dsh-pet 包根（默认从 DSH_PROFILE_DIR / DSH_HOME 推）
 *  @param dryRun 只检查是否可打，不写盘
 *  @returns { status, target, backup? } */
export function preparePetClient({ packageRoot } = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const root = resolve(packageRoot
    || join(process.env.DSH_PROFILE_DIR || join(dshHome, 'profiles', 'desktop'), 'node_modules', 'dsh-pet'));
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) throw new Error('找不到 dsh-pet 包：' + root);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== SUPPORTED_VERSION) {
    throw new Error('不支持该版本：' + manifest.version + '；需要先复算上游补丁（目标 ' + SUPPORTED_VERSION + '）。');
  }
  const target = join(root, 'lib', 'client.js');
  const original = readFileSync(target);
  const hash = sha(original);
  if (PATCHED !== 'PENDING' && hash === PATCHED) return { status: 'already-patched', target, original, patched: original, hash };
  if (hash !== ORIGINAL && hash !== PREVIOUS_PATCHED && hash !== PREVIOUS_CONTROL_PATCHED && hash !== PREVIOUS_BUBBLE_PATCHED && hash !== PREVIOUS_CACHE_PATCHED && hash !== PREVIOUS_LIFECYCLE_PATCHED && hash !== PREVIOUS_THROW_PATCHED) {
    throw new Error('构建指纹不符，保留现有代码：' + target
      + '（实测 ' + hash + '，期望 ' + ORIGINAL + ' 或 ' + PREVIOUS_PATCHED + ' 或 ' + PREVIOUS_CONTROL_PATCHED + ' 或 ' + PREVIOUS_BUBBLE_PATCHED + ' 或 ' + PREVIOUS_CACHE_PATCHED + ' 或 ' + PREVIOUS_LIFECYCLE_PATCHED + '）');
  }
  const upgraded = hash === PREVIOUS_BUBBLE_PATCHED
    ? original.toString('utf8')
    : hash === PREVIOUS_CONTROL_PATCHED
      ? applyBubbleTimingEdits(original.toString('utf8'))
      : hash === PREVIOUS_PATCHED
        ? applyBubbleTimingEdits(applyControlEdits(original.toString('utf8')))
        : null;
  const basePatched = hash === PREVIOUS_THROW_PATCHED ? original.toString('utf8')
    : hash === PREVIOUS_LIFECYCLE_PATCHED ? applyThrowEdits(original.toString('utf8'))
      : hash === PREVIOUS_CACHE_PATCHED ? applyThrowEdits(applyLifecycleEdits(original.toString('utf8')))
        : upgraded === null ? null : applyThrowEdits(applyLifecycleEdits(applyAssetCacheEdits(upgraded)));
  const patched = Buffer.from(basePatched === null ? applyEdits(original.toString('utf8'))
    : applyRuntimeOwnerEdits(basePatched), 'utf8');
  if (PATCHED !== 'PENDING' && sha(patched) !== PATCHED) {
    throw new Error('补丁产物指纹与预期不符，拒绝写入（预期 ' + PATCHED + '）。');
  }
  return { status: 'ready', target, original, patched, hash: sha(patched) };
}

export function patchPetClient({ packageRoot, dryRun = false } = {}) {
  const plan = preparePetClient({ packageRoot });
  const { target, original, patched } = plan;
  if (plan.status === 'already-patched') return { status: 'already-patched', target };
  if (dryRun) return { status: 'ready', target, patchedHash: plan.hash };
  // 单文件操作；先备份，再写。不涉及任何删除或目录创建（除备份目录）。
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(dirname(target), 'pet-link-backups', stamp, 'client.js');
  mkdirSync(dirname(backup), { recursive: true });
  writeFileSync(backup, original, { flag: 'wx' });
  writeFileSync(target, patched);
  const after = sha(readFileSync(target));
  if (after !== sha(patched)) throw new Error('补丁写入后校验失败；备份：' + backup);
  return { status: 'patched', target, backup, hash: after };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--pet-package');
  const packageRoot = at >= 0 ? args[at + 1] : undefined;
  if (args.includes('--freeze')) {
    // 供维护者复算 PATCHED 指纹（改了 EDITS 之后要跑它把常量更新掉）。
    // ⚠️ 必须在**原版**文件上跑；对已补丁态跑会因锚点被消费而报错。
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    const root = resolve(packageRoot || join(process.env.DSH_PROFILE_DIR || join(home, 'profiles', 'desktop'), 'node_modules', 'dsh-pet'));
    console.log(sha(Buffer.from(applyEdits(readFileSync(join(root, 'lib', 'client.js'), 'utf8')), 'utf8')));
    process.exit(0);
  }
  const result = patchPetClient({ packageRoot, dryRun: args.includes('--check') });
  console.log(JSON.stringify(result, null, 2));
}
