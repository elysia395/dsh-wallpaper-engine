/**
 * 桌宠联动 · 共享排播骨架（linked provider 的"能力层"）。
 *
 * 旧内置版把四条排播、常量、跟随/贴边、气泡、调参全塞在一个 138 KB 文件里；新版按
 * 「分区 + 共享骨架」拆开：本文件只放**四条排播都会用到**的能力，四个逻辑分区
 * （linked-sidebar / linked-mascot / linked-egg1 / linked-egg2）各自只写自己的时序。
 *
 * 这一层只认**注入的运行时**（`rt`），不碰全局 `window`、不自己发 HTTP：
 *  - 发动作：`rt.playAnim(petId, name, facing)`（每个**段**发一次，唯一 HTTP）；
 *  - 读进度：`det.link.getPlayback(petId)`（页面内读 video，逐帧、零请求）；
 *  - 贴边/跟随：`det.link.getRoot(petId)` 取根节点量 rect（不 `document.querySelector`）；
 *  - 写位置：`det.link.adoptPosition({x,y}, petId)`（页面内写，逐帧零请求）；
 *  - 弹飞：`det.link.throwNative/getNativeThrow/stopNativeThrow`；
 *  - 租约：`det.link.lock/unlock`；气泡自绘（`rt.bubble`）。
 *
 * ⚠️ 参数读取**唯一入口**是 `kit.tune('<key>', logic)`：判据（verify-pet-tuner-coverage）
 * 只认 `tune('<key>')` 这一种取值写法，任何绕过它的字面量都会变成"骗人的旋钮"。
 */

/**
 * 跟随期间「宠物基准中心」的刷新间隔（ms），对齐旧蓝本 `PET_FOLLOW_MEASURE_MS`。
 * 旧版注释：每帧 `getBoundingClientRect()` 会强制同步布局、实测掉到 20fps；边缘（edgeX）
 * 仍逐帧读，但**宠物 rect 基准**按 250ms 节流刷新。这不是面板旋钮（旧版也不是），故用常量。
 */
const PETLINK_FOLLOW_MEASURE_MS = 250;

/** 缓动：easeInOutQuad（旧蓝本 `petLinkGlide` 的位移曲线）。t∈[0,1] → k∈[0,1]。 */
function petLinkEaseInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

/**
 * 气泡配图的**池内图名**（与 dsh-pet `memes` 配置的键一致）。
 *
 * 顺序必须与 `PETLINK_BUBBLE_SPECS` 的 `image` 下标对应：0=累瘫鲸鱼的两碗饭 …
 * 传给 `/broadcast` 的 `image` 是这个**名字**，不是 URL——宿主只认池内条目，
 * 池外值回 `{ok:false, reason:'unknown-image'}`。
 */
const PETLINK_MEME_POOL = Object.freeze([
  '累瘫鲸鱼的两碗饭',
  '蓝发鲸尾女仆拒绝换壁纸',
  '暴怒鲸尾女仆贴纸',
  '吓哭了',
  '？！欺负一只肥鱼！？',
]);

/**
 * 气泡时间节点「工厂默认」（旧蓝本 `PET_BUBBLE_DEFAULTS` legacy:1824-1840）。
 *
 * 规则语义（旧蓝本 `petLinkCreateBubbleTimeline` legacy:1841-2012，逐字对齐）：
 *   · 每个 `PETLINK_BUBBLE_SPECS` 一条 track，独立 show/hide 规则；
 *   · rule = { action, edge:'start'|'end', offsetMs }；`action` 是**段键**（PETLINK_ANIM key），
 *     锚点 `edge` 取该段**开始/结束**时刻，`offsetMs` 可正可负（相对该锚点的毫秒偏移）；
 *   · `action:'default'`   ⇒ 不在节点表里求值，由逻辑显式 `showBubble/hideBubble`（=旧 defaultShow/defaultHide）触发；
 *   · `action:'duration'`  ⇒ 仅 hide 用，相对**本气泡已显示的墙钟时刻** + offsetMs。
 *   · 未自定义时用下表工厂默认与 `bubbleMs` 兜底。
 */
const PETLINK_BUBBLE_DEFAULTS = {
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

/** 自定义 hide 节点时给自绘气泡设一个「长到不会被宿主提前收回」的时长（< bubble.js 的 180000 上限）。 */
const PETLINK_BUBBLE_CUSTOM_MS = 179000;

/** 读睡觉叶子：`getState().pets.<id>.sleep.data`。取不到返回 null。 */
function petLinkSleepLeaf(readState, petId) {
  let state = null;
  try { state = readState(); } catch { state = null; }
  const leaf = state && state.pets && state.pets[petId] ? state.pets[petId].sleep : null;
  return leaf && leaf.data ? leaf.data : null;
}

/** 此刻是否在睡（含入睡/醒来过渡）。 */
function petLinkSleeping(readState, petId) {
  const data = petLinkSleepLeaf(readState, petId);
  return Boolean(data && data.sleeping === true);
}

/** 睡觉「起来」段的名字（用于等 wake 播完）；不在睡返回空串。 */
function petLinkSleepEndName(readState, petId) {
  const data = petLinkSleepLeaf(readState, petId);
  return data && data.sleeping === true && typeof data.end === 'string' ? data.end : '';
}

/**
 * 运行时实测「宠物本体的可视边界」（画面内的比例）。
 *
 * 为什么需要它：`handRightRatio`（手）与 `bodyRightRatio`（身体）是**旧素材**量出的比例，
 * 九段新素材的构图不同，套上去就会出现"贴边差一截"或"埋进窗口"。
 * 维护环境里（无浏览器 / 无 ffmpeg / 无出网）没法离线量，所以让插件在运行时量一次：
 * 把正在播放的 `<video>` 抽一帧到 canvas，扫描 alpha 的左右边界，得到真实占比。
 *
 * 失败一律返回 null（无 video / 跨域污染 / VP9 alpha 不可读），调用方按原逻辑继续。
 */
function measurePetAlphaBounds(det, rt) {
  try {
    const doc = rt.document || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.createElement !== 'function') return null;
    const root = det.link.getRoot(det.target);
    const video = root && typeof root.querySelector === 'function' ? root.querySelector('video') : null;
    if (!video || !(video.videoWidth > 0) || !(video.videoHeight > 0)) return null;
    const canvas = doc.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width;
    let maxX = -1;
    let minY = canvas.height;
    let maxY = -1;
    // 纵向抽样：既够快，又不会被零星噪点骗到（阈值 24/255）。
    for (let y = 0; y < canvas.height; y += 4) {
      const row = y * canvas.width;
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(row + x) * 4 + 3] > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return {
      videoWidth: canvas.width,
      videoHeight: canvas.height,
      leftRatio: minX / canvas.width,
      rightRatio: (maxX + 1) / canvas.width,
      // 纵向：逻辑二"头顶贴屏幕顶部"要用的真实上边界。
      topRatio: minY / canvas.height,
      bottomRatio: (maxY + 1) / canvas.height,
    };
  } catch { return null; }
}

/**
 * 造共享骨架：`rt` 是装配层 `createPetLink` 注入的运行时。
 * 所有逻辑分区拿到同一个 kit，保证"同一套租约 / 同一套量测 / 同一个 tune 入口"。
 * @param rt - 注入运行时。
 * @returns 共享能力集合（tune / 量测 / 走路 / 贴边跟随 / 段播放 / 抛掷 / 气泡 …）。
 */
function createLinkedKit(rt) {
  const state = rt.state;

  /** 读某逻辑的调参值（覆盖层优先，其次默认）。**唯一**参数入口。 */
  const tune = (key, logic) => {
    const group = logic || state.logic || 'sidebar';
    const override = state.tuning[group] ? state.tuning[group][key] : undefined;
    if (Number.isFinite(override)) return override;
    return PETLINK_DEFAULTS[key];
  };

  /** 侧栏（主包 RopeDock 注册进来的窄接口）方法转发；缺席安静 no-op。 */
  const sidebarCall = (method, ...args) => {
    const api = state.sidebar;
    const fn = api ? api[method] : undefined;
    if (typeof fn !== 'function') return undefined;
    try { return fn(...args); } catch { return undefined; }
  };

  /** 当前目标宠物的根节点 rect（px）；取不到 null。**逐帧 DOM 真测**，不看归一化坐标。 */
  const rectOf = det => {
    try {
      const root = det.link.getRoot(det.target);
      if (!root || typeof root.getBoundingClientRect !== 'function') return null;
      const rect = root.getBoundingClientRect();
      return rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) ? rect : null;
    } catch { return null; }
  };
  const centerOf = rect => ({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  });

  /** 当前显示端：`link.surface`（PET 侧按配置 display 解析）。旧运行时不带该字段 → 按 web。 */
  const surfaceOf = det => {
    const value = det && det.link ? det.link.surface : undefined;
    return value === 'desktop' ? 'desktop' : 'web';
  };

  /**
   * 写宠物位置：web 端直接走页面内 `adoptPosition`（逐帧零请求）；
   * desktop 端（独立桌面窗口里的那只）不在本页 DOM 里，`adoptPosition` 控不到它，
   * 所以必须改走宿主 HTTP `POST /position?surface=desktop`（由装配层的 `rt.positionDesktop` 发送）。
   */
  const writePosition = (det, x, y) => {
    if (surfaceOf(det) === 'desktop') {
      try { rt.positionDesktop?.(det.target, x, y); } catch { /* 卸载竞态：交给 alive 收尾 */ }
      return;
    }
    try { det.link.adoptPosition({ x, y }, det.target); } catch { /* 卸载竞态：下一次 alive 会退出 */ }
  };

  /** 当前朝向（从 pose / data-facing 读；读不到按 left）。 */
  const facing = det => {
    try {
      const pose = rt.getApi()?.pose?.(det.target);
      if (pose && (pose.facing === 'left' || pose.facing === 'right')) return pose.facing;
    } catch { /* 降级到 DOM 属性 */ }
    try {
      const root = det.link.getRoot(det.target);
      const attr = root && root.getAttribute ? root.getAttribute('data-facing') : null;
      if (attr === 'left' || attr === 'right') return attr;
    } catch { /* 都没有 */ }
    return 'left';
  };

  /** 段键选实际动作名（缺池时用顶替，再缺就跳过）。 */
  const animNameOf = key => {
    const name = PETLINK_ANIM[key];
    if (!name) return '';
    const pool = state.pool && state.pool.length ? state.pool : null;
    if (pool && !pool.includes(name)) return PETLINK_FALLBACK[key] || '';
    return name;
  };

  /** 走一步等待：轻量、可被 epoch 取消（run 的 finally 负责收尾）。 */
  const waitUntil = async (predicate, timeoutMs) => {
    const start = rt.now();
    while (rt.now() - start < timeoutMs) {
      let ok = false;
      try { ok = predicate() === true; } catch { ok = false; }
      if (ok) return true;
      await rt.wait(PETLINK_POLL_MS);
    }
    return false;
  };

  /** 段与段之间的最小间隙（`segGapMs`，默认 0 = 立刻切）：只在 >0 时真等。 */
  const gap = async (logic) => {
    const ms = Math.max(0, tune('segGapMs', logic));
    if (ms > 0 && rt.wait) await rt.wait(ms);
  };

  // ── 页面内租约 + 心跳续期（`lockHeartbeatMs` 真消费）────────────────────────
  // 旧版租约 TTL 固定 60s；新版把「续期间隔」变成面板可调：心跳按 `lockHeartbeatMs`
  // 周期用**同名** `lock()` 续期（同名续期只顺延 expiresAt，不清我方已展示的气泡），
  // TTL 取 2×心跳 —— 保证「漏一拍」仍不掉锁，又不会因续期远密于租约而抖动。
  let lease = null; // { det, ttl, lastRenewAt }
  const leaseHeartbeatMs = () => {
    const raw = tune('lockHeartbeatMs');
    return Number.isFinite(raw) && raw >= 500 ? raw : PETLINK_LOCK_TTL_MS;
  };
  const leaseTtlMs = () => Math.max(leaseHeartbeatMs() * 2, 5000);
  /** 上独占租约。`preserveBubble` 用于「换动作但留住当前气泡」。 */
  const acquireLease = (det, preserveBubble = false) => {
    const ttl = leaseTtlMs();
    let ok = false;
    try { ok = det.link.lock('pet-link', ttl, preserveBubble === true, det.target) === true; }
    catch { ok = false; }
    if (ok) lease = { det, ttl, lastRenewAt: rt.now() };
    return ok;
  };
  /** 心跳续期：仅在持锁且距上次续期已达 `lockHeartbeatMs` 时真发一次同名 lock()（幂等）。 */
  const renewLease = () => {
    if (!lease) return false;
    if (rt.now() - lease.lastRenewAt < leaseHeartbeatMs()) return false;
    try { lease.det.link.lock('pet-link', lease.ttl, true, lease.det.target); } catch { /* 卸载竞态忽略 */ }
    lease.lastRenewAt = rt.now();
    return true;
  };
  /**
   * 把「白名单动画名」**立刻**写进租约（旧版 `petLinkAnimLock(name, ttl)` 的语义）。
   *
   * 为什么不能靠 `renewLease`：它有 `lockHeartbeatMs`（默认 20s）节流，跟不上逐段切换；
   * 而这一段必须在**发 /anim 之前**就位，运行时才会放行这个名字、拦掉其它动画
   * （碎碎念 / 随机链 / 右键菜单 —— 旧版注释称之为"三条平行通道"）。
   * @param name - 允许播放的素材名。
   */
  const allowOnly = name => {
    if (!lease || typeof name !== 'string' || name === '') return false;
    if (lease.allowAnim === name) return true;
    lease.allowAnim = name;
    try { lease.det.link.lock('pet-link', lease.ttl, true, lease.det.target, name); } catch { /* 卸载竞态忽略 */ }
    lease.lastRenewAt = rt.now();
    return true;
  };
  const releaseLease = det => {
    lease = null;
    try { det.link.unlock(det.target); } catch { /* 卸载路径也要能收尾 */ }
  };

  /**
   * 取锁后若宠物在睡：释放租约（页面租约会延迟 wake 叶子）→ /wake → 等醒来 → 等「起来」演完 → 重新取锁。
   * @returns 是否最终持锁且醒着可下发点播。
   */
  const ensureAwake = async det => {
    if (!petLinkSleeping(rt.getState, det.target)) return true;
    const endName = petLinkSleepEndName(rt.getState, det.target);
    releaseLease(det);
    await rt.wake(det.target);
    try { det.link.pollState(det.target); } catch { /* 唤醒失败也不阻塞后续重取锁 */ }
    await waitUntil(() => !petLinkSleeping(rt.getState, det.target), PETLINK_WAKE_TIMEOUT_MS);
    if (endName) {
      await waitUntil(() => {
        const p = det.link.getPlayback(det.target);
        if (!p) return true;
        if (p.anim && p.anim !== endName) return true;
        return Number.isFinite(p.duration) && p.duration > 0 && p.currentTime >= p.duration - 0.05;
      }, PETLINK_WAKE_ANIM_TIMEOUT_MS);
    }
    if (!acquireLease(det, true)) throw new Error('lock-failed');
    return true;
  };

  // ── 气泡时间节点（bubbleTiming）真消费 ─────────────────────────────────────
  // 旧蓝本 `petLinkCreateBubbleTimeline`(L1870-2012) 的等价实现：每逻辑一份时间线，
  // 每个气泡 spec 各一条 track（show/hide 规则），在**段播放推进 / 显式 default 触发 /
  // 主动 pump** 时评估 `{action,edge,offsetMs}` 节点，触发真实 show/hide——
  // 而不是"段末统一弹一次"。规则默认值见 `PETLINK_BUBBLE_DEFAULTS`。
  let bubbleRun = null;

  const bubbleRules = specId => {
    const stored = (state.bubbleTiming || {})[specId] || {};
    const factory = PETLINK_BUBBLE_DEFAULTS[specId] || {};
    const rule = key => ({ action: 'default', edge: 'start', offsetMs: 0, ...factory[key], ...stored[key] });
    return { show: rule('show'), hide: rule('hide') };
  };

  const createBubbleRun = (logic, det, alive) => {
    const specs = PETLINK_BUBBLE_SPECS.filter(item => item.logic === logic);
    const tracks = specs.map(spec => ({ spec, rules: bubbleRules(spec.id), shown: false, closed: false, at: 0 }));
    /** action(段键) → { startWall, endWall, started, finished }（墙钟，旧版 nodes 同构）。 */
    const nodes = new Map();
    let cancelled = false;
    const isCurrent = () => !cancelled && alive();
    const anchorFor = () => {
      const rect = rectOf(det);
      return rect ? { x: rect.left + rect.width / 2, y: rect.top, size: rect.width } : null;
    };
    const doShow = track => {
      // ⚠️ 曾经的早退条件里带 `!rt.bubble`：这条时间线（T12 的 bubbleTiming）接管了所有
      // 显隐，于是永远走自绘，`/broadcast`（原生气泡）根本没有机会被调用 —— 用户三次反馈
      // "气泡不是 pet 原生的框和文字"就是这个。现在把它当成**降级路径**：
      // 有 say 能力就先让宠物自己说，失败才画自绘。
      if (!isCurrent() || track.shown || track.closed) return false;
      // 气泡放行窗口（bubbleWindowMs）+ canBubble（自绘气泡的既有纪律；原生气泡也要开窗）。
      try { if (det.link && typeof det.link.allowBubble === 'function') det.link.allowBubble(Math.max(0, tune('bubbleWindowMs'))); } catch { /* 无该能力不影响气泡 */ }
      let allowed = true;
      try { if (det.link && typeof det.link.canBubble === 'function') allowed = det.link.canBubble() !== false; } catch { allowed = true; }
      if (!allowed) return false;
      const hideRule = track.rules.hide;
      // hide 自定义节点时把时长设到很长（由时间线按 offset 收回），默认时用 bubbleMs 自收。
      const duration = hideRule.action === 'default' ? Math.max(1, tune('bubbleMs')) : PETLINK_BUBBLE_CUSTOM_MS;
      const drawOwn = () => {
        if (!rt.bubble) return false;
        const ok = rt.bubble.show({
          text: track.spec.text(rt.translate),
          image: track.spec.image,
          duration,
          anchor: anchorFor,
        }) === true;
        if (!ok) return false;
        track.shown = true;
        track.at = rt.now();
        return true;
      };
      if (typeof rt.say === 'function') {
        const poolName = track.spec.image === null || track.spec.image === undefined
          ? ''
          : (PETLINK_MEME_POOL[track.spec.image] || '');
        try {
          void Promise.resolve(rt.say(det.target, track.spec.text(rt.translate), poolName))
            .then(ok => {
              try { rt.reportDiag?.({ kind: 'say', ok: ok === true, poolName, spec: track.spec.id, via: 'timeline' }); } catch { /* ignore */ }
              if (ok !== true) drawOwn();
            })
            .catch(error => {
              try { rt.reportDiag?.({ kind: 'say', ok: false, error: String(error && error.message || error), via: 'timeline' }); } catch { /* ignore */ }
              drawOwn();
            });
          track.shown = true;
          track.at = rt.now();
          return true;
        } catch (error) {
          try { rt.reportDiag?.({ kind: 'say', ok: false, phase: 'throw', error: String(error && error.message || error), via: 'timeline' }); } catch { /* ignore */ }
        }
      } else {
        try { rt.reportDiag?.({ kind: 'say', ok: false, phase: 'no-say', spec: track.spec.id, via: 'timeline' }); } catch { /* ignore */ }
      }
      return drawOwn();
    };
    const doHide = track => {
      if (!track.shown || track.closed) return;
      track.closed = true;
      if (rt.bubble) rt.bubble.hide();
    };
    /** 规则的「墙钟目标时刻」；不可预测返回 null（正偏移须等真实锚点通知——旧版同）。 */
    const timeOf = (rule, track) => {
      if (!rule || rule.action === 'default') return null;
      if (rule.action === 'duration') {
        return track.shown ? track.at + (Number.isFinite(rule.offsetMs) ? rule.offsetMs : 0) : null;
      }
      const node = nodes.get(rule.action);
      if (!node) return null;
      // 正偏移等真实锚点通知；负偏移可用已知锚点预测（旧版 L1922-1925）。
      if (rule.offsetMs >= 0 && !(rule.edge === 'end' ? node.finished : node.started)) return null;
      const base = rule.edge === 'end' ? node.endWall : node.startWall;
      return Number.isFinite(base) ? base + (Number.isFinite(rule.offsetMs) ? rule.offsetMs : 0) : null;
    };
    const pump = () => {
      if (!isCurrent()) return;
      const now = rt.now();
      for (const track of tracks) {
        if (track.closed) continue;
        if (!track.shown) {
          const at = timeOf(track.rules.show, track);
          if (at !== null && now >= at) doShow(track);
        }
        if (track.shown && track.rules.hide.action !== 'default') {
          const at = timeOf(track.rules.hide, track);
          if (at !== null && now >= at) doHide(track);
        }
      }
    };
    return {
      segmentBegin(action) {
        // endWall 先用 +∞（时长未知），等 segmentUpdate 用 clip 时长补齐——
        // 否则 edge:'end' 的负偏移会在段首误判为「已到终点」而立刻弹。
        nodes.set(action, { startWall: rt.now(), endWall: Number.POSITIVE_INFINITY, started: true, finished: false });
        pump();
      },
      segmentUpdate(action, durationMs) {
        const node = nodes.get(action);
        if (node && Number.isFinite(durationMs) && durationMs > 0) node.endWall = node.startWall + durationMs;
        pump();
      },
      segmentEnd(action) {
        const node = nodes.get(action);
        if (node) { node.endWall = rt.now(); node.finished = true; }
        pump();
      },
      pump,
      /** 显式显示（=旧 defaultShow）：仅当 show 规则为 'default' 时立即弹。 */
      showDefault(specId) {
        const track = tracks.find(t => t.spec.id === specId);
        if (track && track.rules.show.action === 'default') doShow(track);
      },
      /** 显式隐藏（=旧 defaultHide）：仅隐藏 hide 规则为 'default' 的 track。 */
      hideDefaults() {
        for (const track of tracks) if (track.rules.hide.action === 'default') doHide(track);
      },
      cancel() {
        if (cancelled) return;
        cancelled = true;
        for (const track of tracks) doHide(track);
        if (rt.bubble) rt.bubble.hide();
      },
    };
  };

  /** 开始一轮逻辑的气泡时间线（由编排层在逻辑 run 前调用）。 */
  const beginBubbles = (logic, det, alive) => {
    if (bubbleRun) bubbleRun.cancel();
    bubbleRun = createBubbleRun(logic, det, alive);
    return bubbleRun;
  };
  /** 结束气泡时间线（由编排层 finally 调用）。 */
  const endBubbles = () => { if (bubbleRun) { bubbleRun.cancel(); bubbleRun = null; } };
  /** 主动评估一次（编排层的等待/停留循环里调用，让 duration/偏移节点不丢拍）。 */
  const pumpBubbles = () => { if (bubbleRun) bubbleRun.pump(); };

  /** 自绘气泡：锚点用根节点 rect 逐帧跟随（页面内测量，不出请求）。
   *  注意：有 `bubbleTiming` 时间线时，本函数只负责「show 规则为 default」的立即弹；
   *  自定义节点（action/edge/offset）由时间线在段推进中按规则触发（旧 defaultShow 语义）。 */
  const showBubble = (specId, det) => {
    if (bubbleRun) { bubbleRun.showDefault(specId); return true; }
    const spec = PETLINK_BUBBLE_SPECS.find(item => item.id === specId);
    if (!spec || !rt.bubble) return false;
    // 气泡放行窗口（`bubbleWindowMs`，旧版 PET_BUBBLE_WINDOW_MS）：
    // 先在 link 上开一个「允许弹气泡」窗口，再自绘气泡；窗口失效（canBubble() 为假）不弹。
    const windowMs = Math.max(0, tune('bubbleWindowMs'));
    try {
      if (det && det.link && typeof det.link.allowBubble === 'function') det.link.allowBubble(windowMs);
    } catch { /* 运行时无该能力不影响自绘气泡 */ }
    let allowed = true;
    try {
      if (det && det.link && typeof det.link.canBubble === 'function') allowed = det.link.canBubble() !== false;
    } catch { allowed = true; }
    if (!allowed) return false;
    // ① 优先让**宠物自己**说话（旧版 `petLinkSay` → `POST /broadcast`）：
    //    气泡由 dsh-pet 渲染，样式/位置/配图与宠物本体一致；我们自绘的 div 会被
    //    一眼看出"不是原版气泡"，而且锚点算错就飘到不相干的位置。
    //    成功即返回，不阻塞排播；失败（无 say 能力 / 被拒）才走 ② 的自绘兜底。
    const drawn = () => rt.bubble && rt.bubble.show({
      text: spec.text(rt.translate),
      image: spec.image,
      duration: Math.max(1, tune('bubbleMs')),
      anchor: () => {
        const rect = rectOf(det);
        if (!rect) return null;
        return { x: rect.left + rect.width / 2, y: rect.top, size: rect.width };
      },
    }) === true;
    if (typeof rt.say === 'function') {
      const poolName = spec.image === null || spec.image === undefined
        ? ''
        : (PETLINK_MEME_POOL[spec.image] || '');
      try {
        void Promise.resolve(rt.say(det.target, spec.text(rt.translate), poolName))
          .then(ok => {
            try { rt.reportDiag?.({ kind: 'say', ok: ok === true, poolName, spec: spec.id }); } catch { /* ignore */ }
            if (ok === true) return;
            drawn();
          })
          .catch(error => {
            try { rt.reportDiag?.({ kind: 'say', ok: false, error: String(error && error.message || error) }); } catch { /* ignore */ }
            drawn();
          });
        return true;
      } catch (error) {
        try { rt.reportDiag?.({ kind: 'say', ok: false, phase: 'throw', error: String(error && error.message || error) }); } catch { /* ignore */ }
      }
    } else {
      // 没有 say 能力 = 必然自绘（正是"不是原生气泡"的来源），必须留痕。
      try { rt.reportDiag?.({ kind: 'say', ok: false, phase: 'no-say', spec: spec.id }); } catch { /* ignore */ }
    }
    return drawn();
  };
  const hideBubble = () => {
    if (bubbleRun) { bubbleRun.hideDefaults(); return; }
    if (rt.bubble) rt.bubble.hide();
  };

  /** 位置插值：每帧只写 adoptPosition（页面内），不发请求。
   *  缓动对齐旧蓝本 `petLinkGlide` 的 easeInOutQuad（起步与收尾都软，避免瞬移/线性生硬）。
   *  ⚠️ 旧版写 `transform` 偏移、新版写 `adoptPosition` 绝对中心——这是**有意替换**：
   *  dsh-pet 拥有 inset，旧版只能叠 transform；新 `link.adoptPosition` 是协议认可的写位入口。 */
  /**
   * 位置插值：每帧 `adoptPosition`（页面内），不发请求。
   *
   * ⚠️ 这里**回到逐帧 adoptPosition**，是有意的保守取舍：
   * 曾尝试「中间帧写 style.transform、收尾提交一次」来消除卡顿（adoptPosition 每帧会
   * `commitRatio` → 状态提交），但 transform 与运行时自身的定位/物理叠加后会产生
   * **反复抽搐**，而且在无浏览器可用的环境里无法自证修好了没有。
   * 结论：先要"不抽搐"，卡顿作为已知成本接受（后续再用可验证的方式优化）。
   * 缓动对齐旧蓝本 `petLinkGlide` 的 easeInOutQuad。
   */
  const moveTo = async (det, target, ms, alive) => {
    const rect = rectOf(det);
    if (!rect) {
      // 走位唯一的硬前提：拿得到宠物根节点的真 rect（`link.getRoot(petId)`）。
      // 拿不到就**无法移动**（动作仍能播，因为点播走 HTTP 不依赖 DOM）——现象就是「原地动」。
      if (!moveTo.warned) {
        moveTo.warned = true;
        console.warn('[wallpaper-engine-pet-link] 走位跳过：link.getRoot(' + JSON.stringify(det.target)
          + ') 取不到宠物根节点 rect —— 本页可能没有正在显示的该宠物');
      }
      return false;
    }
    moveTo.warned = false;
    const from = centerOf(rect);
    const duration = Math.max(0, Number.isFinite(ms) ? ms : tune('sidebarWalkMs'));
    const start = rt.now();
    while (alive()) {
      renewLease();
      const t = duration <= 0 ? 1 : Math.min(1, (rt.now() - start) / duration);
      const k = petLinkEaseInOutQuad(t);
      writePosition(det, from.x + (target.x - from.x) * k, from.y + (target.y - from.y) * k);
      if (t >= 1) {
        // 落点探针：先分清"手贴不上边"是**没走到**（finalCenterX ≠ targetX）
        // 还是走对了但比例/间距不对。没有这条就只能互相猜。
        try {
          const after = rectOf(det);
          // 关键：把**视频元素**的 rect 也带上。根节点是 462×462 的方框，
          // 而视频 640×360 `object-fit:contain` 只占其中 462×260（上下留白），
          // 若两者不一致，"按根节点算的手位"和眼睛看到的就会差一截。
          let videoRect = null;
          try {
            const rootEl = det.link.getRoot(det.target);
            const video = rootEl && rootEl.querySelector ? rootEl.querySelector('video') : null;
            if (video && video.getBoundingClientRect) {
              const vr = video.getBoundingClientRect();
              videoRect = { left: Math.round(vr.left), top: Math.round(vr.top), width: Math.round(vr.width), height: Math.round(vr.height) };
            }
          } catch { /* ignore */ }
          rt.reportDiag?.({
            kind: 'walk-done',
            targetX: Math.round(target.x),
            finalCenterX: after ? Math.round(centerOf(after).x) : null,
            offBy: after ? Math.round(centerOf(after).x - target.x) : null,
            rootRect: after ? { left: Math.round(after.left), width: Math.round(after.width) } : null,
            videoRect,
            viewportWidth: rt.viewport().width,
            ms: Math.round(duration),
          });
        } catch { /* 诊断不许影响业务 */ }
        return true;
      }
      await rt.wait(PETLINK_MOVE_STEP_MS);
    }
    return false;
  };

  /**
   * 贴边目标（px 中心）：**手右边缘**落在侧栏左边缘（`edgeX`）减去 `edgeGapPx` 处。
   *
   * 旧版比例常量是核心信号（用户口径「一定要让 pet 手对上侧边栏边缘」）：
   *   手右边缘 = 画布中心 + size × (handRightRatio − 0.5)
   *   ⇒ 画布中心 = (edgeX − edgeGapPx) − size × (handRightRatio − 0.5)
   * 这里量的是根节点真 rect（getRoot），不是归一化坐标。
   *
   * `gapPxOverride`：调用方专属间距（彩蛋一传 `egg1EdgeGapPx`）。
   * `anchorRatio`：可选锚点比例（旧蓝本彩蛋一踢腿用 `375/640≈0.586` 附近、脚接触点 425/640≈0.664，
   *   见 L2028-2029）。传了就替代通用 `handRightRatio`——侧栏（逻辑一）不传，仍用手口径。
   */
  const edgeTarget = (det, logic, gapPxOverride, anchorRatio) => {
    const rect = rectOf(det);
    const view = rt.viewport();
    const width = view.width;
    if (!rect) return { x: width / 2, y: (view.height || 0) / 2 };
    // 走位目标回到 `edgeX`：**不再用 `panelLeft`**。
    // 实测 `panelLeft` 量的是「右侧整列容器」的宽度（2560−1408=1152，不是侧栏宽度），
    // 会把宠物甩到屏幕中间（用户反馈"走位反了"）。侧栏收起时 edgeX 退化为视口右边缘，
    // 这让"走到右边"距离很小 —— 那是**宠物初始位置在右上**造成的观感问题，
    // 正确的解法是初始位置（旧版数据根是 bottom-left），不是在这里篡改边缘语义。
    const edge = sidebarCall('edgeX');
    const liveEdge = Number.isFinite(edge) ? edge : width;
    // 允许调用方（彩蛋一）用专属间距覆盖通用 `edgeGapPx`（egg1EdgeGapPx）。
    const edgeGapPx = Number.isFinite(gapPxOverride) ? gapPxOverride : tune('edgeGapPx', logic);
    const handRatio = Number.isFinite(anchorRatio) ? anchorRatio : tune('handRightRatio', logic);
    // 蓝本口径（legacy L1601-1606）：手右边缘落在 `rightTarget` 时的画布中心
//   centerForBodyRight(edge) = edge − size × bodyRightRatio
//   centerForHandRight(edge) = centerForBodyRight + size × (bodyRightRatio − handRightRatio)
//                            = edge − size × handRightRatio          ← 展开后是这个
// 之前写成 `edge − size × (handRatio − 0.5)`，多减了 **0.5 × size（这里 231px）**，
// 于是宠物总是停在离目标一大截的位置（用户："一直有一段距离"）。
    // 贴边口径（与 `followEdge` 必须**逐字一致**，否则走位与退后各差半个 size）：
//   centerForBodyRight(edge) = edge − bodyRightOffset
//   bodyRightOffset          = size × (BODY_RIGHT_RATIO − 0.5)
//   centerForHandRight(edge) = centerForBodyRight + size × (BODY_RIGHT_RATIO − handRatio)
//                            = edge − size × (handRatio − 0.5)
// ⚠️ 我中途误展开成 `edge − size × handRatio`（多减 0.5×size ≈ 231px），导致走位偏左、
//    且与 followEdge 的目标相差 231px（用户："拉侧边栏退后坏了"）。已回滚到上式。
    const rightTarget = liveEdge - edgeGapPx;
    const wantX = rightTarget - rect.width * (handRatio - 0.5);
    // ⚠️ **不做 clamp**：蓝本 `petLinkCenterForHandRight` 直接返回 `edge − size × handRatio`
    // （legacy L840-845），没有任何「中心不出视口」的限制。我先前加了
    // `Math.min(width − half, …)`，结果 `edgeGapPx` 往负方向调时目标全撞在同一堵墙上
    // （日志实证：-15 / -60 / -1000 三次都是 targetX=2329），用户看到的就是
    // "无论怎么改间距都不生效"。间距是**手**的口径，允许本体略出界才叫"手贴边"。
    const target = {
      x: wantX,
      y: Number.isFinite(view.height) && view.height > 0 ? view.height * 0.55 : centerOf(rect).y,
    };
    // 诊断（每轮一次）：去程"看起来没动"通常是目标与当前位置几乎重合。
    // 把四项真值打出来就能分辨是「侧栏边缘没拿到（liveEdge 退化成视口宽）」还是「比例/间距把目标拉回原处」。
    // 每次走位都尝试测量，**直到成功为止**（视频首帧常未挂载，测一次就放弃会永远"待测量"）。
    if (!state.alphaBounds) {
      const measured = measurePetAlphaBounds(det, rt);
      if (measured) state.alphaBounds = measured;
    }
    const alphaBounds = state.alphaBounds || null;
    // 上报节流：首次 + 每次测到新值（测到之前那次 null 上报不会挡住后续真值上报）。
    if (!edgeTarget.diagnosed || (alphaBounds && edgeTarget.reportedAlpha !== alphaBounds)) {
      edgeTarget.diagnosed = true;
      edgeTarget.reportedAlpha = alphaBounds;
      const snapshot = {
        kind: 'walk-target',
        // 素材可视边界的**运行时实测**：手的/身体的真实比例只能这样拿到（无 ffmpeg、无出网）。
        alphaBounds,
        logic,
        viewportWidth: width,
        rect: { left: Math.round(rect.left), width: Math.round(rect.width) },
        currentCenterX: Math.round(centerOf(rect).x),
        currentCenterY: Math.round(centerOf(rect).y),
        sidebarEdgeX: Number.isFinite(edge) ? Math.round(edge) : String(edge),
        liveEdge: Math.round(liveEdge),
        edgeGapPx,
        handRatio,
        wantX: Math.round(wantX),
        targetX: Math.round(target.x),
        deltaPx: Math.round(target.x - centerOf(rect).x),
        sidebarRegistered: state.sidebar !== null,
      };
      try { rt.reportDiag?.(snapshot); } catch { /* 诊断不许影响业务 */ }
      console.info('[wallpaper-engine-pet-link] 去程目标计算：', snapshot);
    }
    return target;
  };

  /**
   * 逐帧贴边跟随（逻辑一「拉」的观感核心）。**逐字对齐旧蓝本 follow 循环**（lines 2128–2185）。
   *
   * 收尾判据（旧版三条，缺一即早退/空转；新版 T1 曾漏掉 `openSettled` 门，本 T5 补回）：
   *   ① `openSettled`：**侧栏展开流程结束**之前一律不判静止（首帧 `!openSettled` ⇒ 每帧重置
   *      `stillSince`）。否则面板还没动就先"静止"⇒ 跟随瞬间退出（用户报的"没有往后同步位移"）。
   *   ② `followGraceMs`：从 t0 起手的宽限期，起手阶段不判静止。
   *   ③ 累计静止 `followStillMs`：边缘在 `followStillEps` 内**持续**不动 ⇒ 认为拉完；
   *      并且必须先追上目标（`|wantX − baseX| ≤ eps`），否则限速时提前停在半路。
   *
   * 性能纪律（对齐旧版 `PET_FOLLOW_MEASURE_MS`）：边缘 `edgeX` 每帧读；**宠物 rect 基准**
   * 按 `PETLINK_FOLLOW_MEASURE_MS`(250ms) 节流重测，其余帧用我们自己的写位量推进 baseX，
   * 避免每帧 `getBoundingClientRect()` 强制同步布局（实测会掉到 20fps）。
   * 位移上限按 **dt**（`followSpeed px/s × 秒`）换算，与帧率解耦。
   *
   * 几何口径：`wantX = (edgeX − edgeGapPx) − size × (handRightRatio − 0.5)`（手右边缘贴边）。
   *
   * `options.openState`：`{ opened:boolean, at:number, ms:number }` 由侧栏分区共享，用来判
   * `openSettled`（`opened && now − at ≥ ms`）。不传则视为已 settled（向后兼容）。
   * `options.maxMs`：硬上限；默认 = slowOpenMs + openLeadMs + openDelayMs + 2500（旧版口径，
   * **不含 pullMs**——T1 多加了 pullMs，本 T5 去掉）。
   */
  const followEdge = async (det, alive, logic, options = {}) => {
    const graceMs = Math.max(0, tune('followGraceMs', logic));
    const stillMs = Math.max(0, tune('followStillMs', logic));
    const eps = Math.max(0, tune('followStillEps', logic));
    const speed = Math.max(1, tune('followSpeed', logic));
    const edgeGapPx = tune('edgeGapPx', logic);
    const handRatio = tune('handRightRatio', logic);
    const view = rt.viewport();
    const W = view.width;
    const maxMs = Number.isFinite(options.maxMs)
      ? options.maxMs
      : (tune('slowOpenMs', logic) + tune('openLeadMs', logic) + tune('openDelayMs', logic) + 2500);
    const openState = options.openState || null;
    const openSettled = () => {
      if (!openState) return true;
      if (!openState.opened) return false;
      const dur = Number.isFinite(openState.ms) ? Math.max(0, openState.ms) : 0;
      return dur <= 0 || rt.now() - openState.at >= dur;
    };

    const seed = rectOf(det);
    const size = seed ? seed.width : 0;
    const handOffset = size * (handRatio - 0.5);
    let baseX = seed ? centerOf(seed).x : null;
    let baseY = seed ? centerOf(seed).y : null;

    const t0 = rt.now();
    let stillSince = null;
    let stillEdge = null;
    let lastAt = t0;
    let measuredAt = t0;
    let followWriteTick = 0;

    while (alive() && rt.now() - t0 <= maxMs) {
      renewLease();
      let live = null;
      try { live = sidebarCall('edgeX'); } catch { live = null; }
      const usable = Number.isFinite(live) && live > 0 && live < W;
      if (usable) {
        const now = rt.now();
        // ① openSettled / 宽限 / 静止窗口：任一不满足就重置静止计时（不判到位）。
        if (!openSettled() || now - t0 < graceMs || stillEdge === null || Math.abs(live - stillEdge) > eps) {
          stillSince = now;
          stillEdge = live;
        }
        // 宠物 rect 基准按 250ms 节流重测（其余帧用 baseX 自行推进）。
        if (now - measuredAt >= PETLINK_FOLLOW_MEASURE_MS) {
          const rect = rectOf(det);
          if (rect) { baseX = centerOf(rect).x; baseY = centerOf(rect).y; }
          measuredAt = now;
        }
        if (baseX !== null && baseY !== null) {
          const half = size / 2;
          let wantX = live - edgeGapPx - handOffset;
          // ⚠️ **不要 clamp**：`edgeTarget`（走位终点）已经不做任何 clamp，
          // 这里若还卡 `min(W − half, wantX)`，跟随一开始就会把宠物从走位终点
          // 拽回 149px（用户反馈"走到边上会往后退"，算式：走位 2478.4 → clamp 2329）。
          // 两边必须同口径，位置才连续。
          const dt = Math.min(0.1, Math.max(0, (now - lastAt) / 1000));
          lastAt = now;
          const maxStep = Math.max(1, speed * dt);
          const dx = wantX - baseX;
          const stepX = Math.abs(dx) <= maxStep ? dx : Math.sign(dx) * maxStep;
          baseX += stepX;
          // 恢复逐帧写入：节流（每 2 帧）会让位置更新不连续，用户反馈"抽搐"更明显。
          // 卡顿的治本方案在 pet 侧（`commitRatio` 去抖），不在这一层做取舍。
          writePosition(det, baseX, baseY);
          if (openSettled() && now - t0 >= graceMs && now - stillSince >= stillMs && Math.abs(wantX - baseX) <= eps) {
            return true;
          }
        }
      } else {
        stillSince = null;
        stillEdge = null;
      }
      await rt.wait(PETLINK_MOVE_STEP_MS);
    }
    return true;
  };

  /**
   * 绳子按下拉/回弹分段求位移像素（对齐旧蓝本 `petLinkMascotPlaybackMotion` lines 1277–1307）。
   *
   * **分段边界（旧版核心，T1 移植时漏了夹紧）**：
   *   `releaseAt = max(grabAtMs + pullMs, mascotReleaseAtMs)` —— 旧版保证「下拉一定先走满
   *   pullMs」再脱手回弹；若面板把 `mascotReleaseAtMs` 设得比 `grabAt+pullMs` 还小，旧版**夹紧**
   *   到 `grabAt+pullMs`，新版 linked-mascot.js 的内联 `ropeAt` 直接用 releaseAtMs，会「拉一半就回弹」。
   *   本函数给出**夹紧语义**的规范实现，供 mascot 侧（B/C 所有者）切换（本 T5 硬约束不改 mascot）。
   * 缓动：旧版下拉用 `mascotRopePullEase`、回弹用 `mascotRopeBackEase`（0/1/2 三选一），
   *   **没有** `PET_ROPE_PULL_EASE` 这个常量名——名字别硬套，缓动是面板 ease 索引。
   *
   * @param ms  - 从整段动画开始算的播放时间（ms，clip 时钟）。
   * @param cfg - { grabAtMs, releaseAtMs, pullMs, backMs, downPx, pullEase, backEase }。
   * @returns 绳子应下移的像素（0 = 原位，downPx = 拉到底）。
   */
  const ropeSegmentAt = (ms, cfg = {}) => {
    const grabAt = Math.max(0, Number.isFinite(cfg.grabAtMs) ? cfg.grabAtMs : 0);
    const pullMs = Math.max(0, Number.isFinite(cfg.pullMs) ? cfg.pullMs : 0);
    const releaseRaw = Number.isFinite(cfg.releaseAtMs) ? cfg.releaseAtMs : grabAt + pullMs;
    const releaseAt = Math.max(grabAt + pullMs, Math.max(0, releaseRaw));
    const backMs = Math.max(0, Number.isFinite(cfg.backMs) ? cfg.backMs : 0);
    const downPx = Math.max(0, Number.isFinite(cfg.downPx) ? cfg.downPx : 0);
    const pullEase = typeof cfg.pullEase === 'function' ? cfg.pullEase : (t => t);
    const backEase = typeof cfg.backEase === 'function' ? cfg.backEase : (t => t);
    if (ms < grabAt) return 0;
    if (ms < releaseAt) {
      const p = pullMs <= 0 ? 1 : Math.min(1, Math.max(0, (ms - grabAt) / pullMs));
      return downPx * pullEase(p);
    }
    const p = backMs <= 0 ? 1 : Math.min(1, Math.max(0, (ms - releaseAt) / backMs));
    return downPx * (1 - backEase(p));
  };

  /** 绳子分段的时间线（夹紧后的 releaseAt 与整段结束 endAt），对齐旧版 `endAt` 计算。 */
  const ropeTimeline = (cfg = {}) => {
    const grabAt = Math.max(0, Number.isFinite(cfg.grabAtMs) ? cfg.grabAtMs : 0);
    const pullMs = Math.max(0, Number.isFinite(cfg.pullMs) ? cfg.pullMs : 0);
    const releaseRaw = Number.isFinite(cfg.releaseAtMs) ? cfg.releaseAtMs : grabAt + pullMs;
    const releaseAt = Math.max(grabAt + pullMs, Math.max(0, releaseRaw));
    const backMs = Math.max(0, Number.isFinite(cfg.backMs) ? cfg.backMs : 0);
    const dropMs = Math.max(0, Number.isFinite(cfg.dropMs) ? cfg.dropMs : 0);
    const dropPx = Math.max(0, Number.isFinite(cfg.dropPx) ? cfg.dropPx : 0);
    const openAtMs = Math.max(0, Number.isFinite(cfg.openAtMs) ? cfg.openAtMs : 0);
    const endAt = Math.max(openAtMs, releaseAt + backMs, releaseAt + (dropPx > 0 ? dropMs : 0));
    return { grabAtMs: grabAt, releaseAtMs: releaseAt, pullMs, backMs, endAt };
  };

  /** 绳子中心（px）；取不到 null。 */
  const ropeTarget = () => {
    const point = rt.rope && typeof rt.rope.point === 'function' ? rt.rope.point() : null;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const view = rt.viewport();
    // `top` 供逻辑二站位使用（手指尖对准绳子顶部，见蓝本 L1251-1255）；
    // 老运行时没有该字段时退回下沿，行为与之前一致。
    const top = Number.isFinite(point.top) ? point.top * view.height : point.y * view.height;
    return { x: point.x * view.width, y: point.y * view.height, top };
  };

  /**
   * 播一段动作并等它播完。
   * 只在这里发一次 HTTP（`rt.playAnim`）；之后逐帧读 `getPlayback`（页面内）。
   * @param onTick - 每帧回调 `(currentMs, durationMs)`，用于同步侧栏/绳子/气泡/抛掷时序。
   * @param limitMs - 提前收段（如准备段只演 braceMs / 后拉段只演 pullMs）。
   */
  const playSegment = async (det, key, onTick, limitMs, alive, facingOverride) => {
    const name = animNameOf(key);
    if (!name) return false;
    // `facing` 必须表示**这一段往哪边走**，而不是"宠物当前朝哪边"：
    // 走路段由 `walkTo` 按目标左右显式覆盖（`walkLeft → 'left'` / `walkRight → 'right'`）。
    // 早先一律传 `facing(det)`（读 pose/DOM 的既有朝向，默认 'left'），于是往右走时
    // 动作名是右向、朝向却是左 ⇒ 渲染端播成左向动画（用户："往右走却调用左走动效"）。
    const pose = typeof facingOverride === 'string' ? facingOverride : facing(det);
    let reasserts = 0; // 段被运行时的自主动画顶替时，最多重发几次接上（见下方分支）
    // 段开始时刻：结束时用它补足到 `hold`（旧版 readyAt 口径，见函数末尾）。
    const segStartAt = rt.now();
    let ok = false;
    // ⚠️ 白名单锁**暂不启用**（保留实现与单测，只停用调用）。
    // 实测启用后"动作全无"：pet 侧 `onReady` 的白名单守卫把我方点播也拦下了
    // （`pending.anim` 与白名单名的取值口径在真机上没对齐，无法在此环境验证）。
    // 取舍：宁可回到"动作能播、偶发被碎碎念顶替（reassert 重发兜底）"，
    // 也不要"一个动作都不播"。要看效果请重启 DSH 后跑一次彩蛋一。
    // allowOnly(name);
    try { ok = await rt.playAnim(det.target, name, pose); } catch { ok = false; }
    if (!ok) return false;
    // 气泡时间线：登记本段锚点（startWall=现在；endWall 由 clip 时长补齐）。
    if (bubbleRun) bubbleRun.segmentBegin(key);
    try {
      // ── 段时长 = **固定 hold**（旧版口径，蓝本 petLinkDrain: readyAt = now + hold）──
      // 旧版从不看素材进度：发完 /anim 就按 hold 掐表，到点发下一段。
      // 早先用 currentTime >= duration - 0.045 判"播完"，在 pet 的**双缓冲**
      // （videoA/videoB 交替）下读到的不一定是当前段进度，条件可能永不满足 ⇒
      // 段要等到 30s deadline 才结束（用户："动作时间也是错误"）。
      const hold = Number.isFinite(limitMs) ? limitMs : (PETLINK_HOLD[key] || 0);
      const deadline = segStartAt + Math.max(30000, hold + 20000);
      let started = false;
      while (alive()) {
        renewLease();
        let p = null;
        try { p = det.link.getPlayback(det.target); } catch { p = null; }
        // 开播判定：片段名匹配即可（playbackId/currentTime 在两个 video 元素间不可靠）。
        if (p && p.anim === name) started = true;
        const elapsed = rt.now() - segStartAt;
        // 气泡时间线的锚点要用**素材真实时长**（offsetMs 是相对片长算的）；
        // 读不到片长时才退回 hold。用错会让气泡提前/延后出现（T12 夹具会红）。
        const clipMs = (p && Number.isFinite(p.duration) && p.duration > 0) ? p.duration * 1000 : hold;
        if (bubbleRun) bubbleRun.segmentUpdate(key, clipMs);
        if (typeof onTick === 'function') {
          // onTick 收到**段内已耗时**（不是素材进度），用于走位启动与彩蛋时刻编排。
          await onTick(Math.min(elapsed, hold), hold);
          if (!alive()) return false;
        }
        if (elapsed >= hold) return true; // 到点即收口，与旧版 readyAt 等价
        if (started && p && p.anim && p.anim !== name) {
          // 段播到一半被运行时自己的动画顶替（自主走动 / 碎碎念 / 转向等）。
          if (reasserts < 3) {
            reasserts += 1;
            try { rt.reportDiag?.({ kind: 'segment-preempted', key, want: name, got: p.anim, reassert: reasserts }); } catch { /* ignore */ }
            try { await rt.playAnim(det.target, name, pose); } catch { /* 重发失败就按自然结束处理 */ }
          } else {
            return true;
          }
        }
        if (rt.now() >= deadline) return false;
        await rt.wait(PETLINK_POLL_MS);
      }
      return false;
    } finally {
      if (bubbleRun) bubbleRun.segmentEnd(key);
    }
  };

  /** 走动：一边播左/右侧螃蟹步，一边把位置插值到目标。 */
  const walkTo = async (det, target, ms, alive) => {
    const rect = rectOf(det);
    if (!rect) return false;
    const key = target.x < centerOf(rect).x ? 'walkLeft' : 'walkRight';
    // ⚠️ 朝向必须是 `'left'`（= **不翻转**），不是"往哪边走"。
    // dsh-pet 渲染端：`transform = facing === 'right' ? 'scaleX(-1)' : ''`，
    // 它的自带素材统一朝左、靠 flip 出右向。而我们的九段素材**自带方向**
    // （`通用-右侧螃蟹步` 画面朝右、`左侧` 朝左），再传 `right` 会被镜像成反向
    // —— 用户两次反馈"动作反了"都是这个。段键已经决定方向，这里只负责不翻转。
    const dir = 'left';
    let moving = false;
    // 段时长必须跟**走位时长**一致（`ms`），不能用素材全长：
    // 走位距离短（如回程 1100ms）却播满 5.2 秒的螃蟹步，宠物会在原地"踩空"很久。
    await playSegment(det, key, async () => {
      if (!moving) { moving = true; await moveTo(det, target, ms, alive); }
    }, ms, alive, dir);
    return true;
  };

  /**
   * 返回原位：横移超过 `returnWalkMinPx` 才播走路段（否则原地滑回），
   * 否则"一小步也播整段螃蟹步"会显得拖着走。方向由 walkTo 按目标左右自动选。
   * `msOverride`：调用方专属回程时长（旧蓝本彩蛋一 `petLinkEggReturnHome(600,…)` L2303
   * 固定 600ms，而非逻辑一的 `sidebarWalkMs`）。不传则用 `sidebarWalkMs`。
   */
  const returnHome = async (det, home, alive, msOverride) => {
    const rect = rectOf(det);
    if (!rect) return false;
    const cur = centerOf(rect);
    const minPx = Math.max(0, tune('returnWalkMinPx'));
    // 回程时长：给了 `msOverride` 也**按距离兜底**（约 2.2ms/px，下限 600ms）。
    // 旧蓝本的 600ms 是它自己离原位近；新版一旦距离几百像素，600ms 就是"瞬移"。
    const distance = Math.abs(home.x - cur.x);
    const walkMs = Number.isFinite(msOverride) && msOverride > 0
      ? Math.max(msOverride, distance * 2.2)
      : tune('sidebarWalkMs');
    if (distance > minPx) return walkTo(det, home, walkMs, alive);
    return moveTo(det, home, walkMs, alive);
  };

  /** 起一段原生抛掷；返回令牌或 null。 */
  const startThrow = (det, rect) => {
    if (!rect) return null;
    const distance = Math.max(0, tune('egg1FlingPx', 'egg1'));
    const ms = Math.max(100, tune('egg1FlingMs', 'egg1'));
    const power = Math.max(0.1, tune('egg1FlingPower', 'egg1'));
    const speed = Math.min(3200, (distance * 1000) / ms) * power;
    const center = centerOf(rect);
    try {
      const id = det.link.throwNative(
        { x: center.x, y: center.y },
        { vx: -speed, vy: -Math.min(1600, speed * 0.65) },
        det.target,
      );
      return id === false ? null : id;
    } catch { return null; }
  };

  /** 等抛掷落定（原生物理）；超时则主动停飞，绝不无限等。 */
  const settleThrow = async (det, id, alive) => {
    const start = rt.now();
    while (alive()) {
      let handle = null;
      try { handle = det.link.getNativeThrow(id, det.target); } catch { handle = null; }
      if (!handle || handle.active !== true) return !handle || handle.cancelled !== true;
      if (rt.now() - start >= 30000) {
        try { det.link.stopNativeThrow(id, det.target); } catch { /* 卸载也要收尾 */ }
        return true;
      }
      await rt.wait(PETLINK_POLL_MS);
    }
    return false;
  };

  return {
    rt, state, tune, sidebarCall,
    rectOf, centerOf, facing, surfaceOf, writePosition, animNameOf, waitUntil, gap,
    acquireLease, releaseLease, renewLease, ensureAwake,
    // 白名单锁能力：实现与单测都在，调用点暂时停用（见 playSegment 处注释）。
    // 导出是为了随时能一行开启，也让"死代码"判据承认它是有意保留的。
    allowOnly,
    showBubble, hideBubble, beginBubbles, endBubbles, pumpBubbles, moveTo,
    edgeTarget, followEdge, ropeTarget,
    ropeSegmentAt, ropeTimeline,
    playSegment, walkTo, returnHome,
    startThrow, settleThrow,
  };
}
