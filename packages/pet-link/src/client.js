/**
 * 桌宠联动浏览器半边入口（双 provider）。
 *
 * 只消费主包登记的窄门面，运行期按需读同页 `petApiDshwe` 服务：
 *   · 探测 `petApiDshwe.link` 决定 linked / native（判定在 pet-link.js 装配层）；
 *   · linked：发动作走 dsh-pet-dshwe 的 HTTP `/anim`、`/wake`（每段一次），
 *     读进度/位置/抛掷/租约/气泡全走页面内 `link.*`（逐帧零请求）；
 *   · native：回落主包原生吉祥物（`wallSidebarToggle`），主包一行不改。
 */
const PET_LINK_HOST_REQUIRED = [
  'weT', 'apiUrl', 'apiFetch', 'wallSidebarOpen', 'wallSidebarClose', 'wallSidebarToggle', 'registerPetLink',
];
for (const key of PET_LINK_HOST_REQUIRED) {
  if (!(key in host)) throw new Error('[wallpaper-engine-pet-link] 主 bundle 键集缺少 "' + key + '"');
}
const { weT, apiUrl, apiFetch, wallSidebarOpen, wallSidebarClose, wallSidebarToggle, registerPetLink } = host;

/** dsh-pet-dshwe 的 HTTP 前缀（fork 独立命名；与 WE 自身的 /wallpaper-engine 前缀无关，走 origin 根）。 */
const PET_LINK_PET_BASE = '/dsh-pet-dshwe-7340';

/**
 * 气泡配图（WE 侧 5 张表情）→ objectURL。
 *
 * 为什么不能直接把路由地址给 `<img src>`：资源路由由 DSH 的浏览器访问门禁保护，
 * 令牌由客户端的 `apiFetch`（全局 fetch 已被宿主包装）带上；`<img>` 不经过 fetch，
 * 带不上令牌 ⇒ 403 ⇒ 破图（实测：气泡出现黑洞占位框）。
 * 所以这里用 `apiFetch(parse:false)` 取 blob 再转 objectURL；取不到就留空，
 * 气泡退化为纯文字（`bubble.js` 在 URL 为空时不插 img）。
 */
const petLinkMemeUrls = new Map();
const petLinkMemeWarned = new Set();
const PETLINK_MEME_COUNT = 5;

async function prefetchPetLinkMemes() {
  for (let index = 0; index < PETLINK_MEME_COUNT; index += 1) {
    if (petLinkMemeUrls.has(index)) continue;
    try {
      const response = await apiFetch(apiUrl('/pet-link/official/meme?i=' + index), { parse: false });
      const blob = response && response.ok && response.response && typeof response.response.blob === 'function'
        ? await response.response.blob()
        : null;
      if (blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        petLinkMemeUrls.set(index, URL.createObjectURL(blob));
        reportPetLinkDiag({ kind: 'meme', index, ok: true, bytes: blob.size });
      } else if (!petLinkMemeWarned.has(index)) {
        petLinkMemeWarned.add(index);
        const why = (response && (response.error || response.status)) || 'no-blob';
        reportPetLinkDiag({ kind: 'meme', index, ok: false, reason: String(why) });
        console.warn('[wallpaper-engine-pet-link] 气泡配图 m' + index + ' 取不到（气泡将只显示文字）：' + why);
      }
    } catch (error) {
      if (!petLinkMemeWarned.has(index)) {
        petLinkMemeWarned.add(index);
        console.warn('[wallpaper-engine-pet-link] 气泡配图 m' + index + ' 预取异常（气泡将只显示文字）：'
          + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
}

const petLinkGuideUrls = new Map();
const petLinkGuideWarned = new Set();
const PETLINK_GUIDE_COUNT = 3;

/**
 * 预取三张安装引导截图（blob → objectURL）。
 *
 * 为什么不直接把路由地址给 `<img src>`：与气泡配图完全同一个坑——资源路由由 DSH 的
 * 浏览器访问门禁保护，令牌由 `apiFetch`（全局 fetch 已被宿主包装）带上；`<img>` 不经过
 * fetch、带不上令牌 ⇒ 403 ⇒ 卡片里出现破图（实测：三个灰色破图框 + 每次点击都要等失败请求，
 * 显得很久没反应）。所以这里同样用 `apiFetch(parse:false)` 取 blob 再转 objectURL。
 */
async function prefetchPetLinkGuideShots() {
  for (let step = 1; step <= PETLINK_GUIDE_COUNT; step += 1) {
    if (petLinkGuideUrls.has(step)) continue;
    try {
      const response = await apiFetch(apiUrl('/pet-link/official/guide-step?n=' + step), { parse: false });
      const blob = response && response.ok && response.response && typeof response.response.blob === 'function'
        ? await response.response.blob()
        : null;
      if (blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        petLinkGuideUrls.set(step, URL.createObjectURL(blob));
        reportPetLinkDiag({ kind: 'guide-shot', step, ok: true, bytes: blob.size });
      } else if (!petLinkGuideWarned.has(step)) {
        petLinkGuideWarned.add(step);
        const why = (response && (response.error || response.status)) || 'no-blob';
        reportPetLinkDiag({ kind: 'guide-shot', step, ok: false, reason: String(why) });
        console.warn('[wallpaper-engine-pet-link] 引导图 step' + step + ' 取不到（卡片将不显示该图）：' + why);
      }
    } catch (error) {
      if (!petLinkGuideWarned.has(step)) {
        petLinkGuideWarned.add(step);
        console.warn('[wallpaper-engine-pet-link] 引导图 step' + step + ' 预取异常：'
          + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
}

const petLinkOrigin = () => (typeof location !== 'undefined' && location.origin ? location.origin : '');

/**
 * 诊断上报：浏览器半边 → 宿主日志（`[pet-link diag]`）。
 *
 * 桌面版没有 DevTools，用户看不到 console —— 所以走位目标、取图结果这类运行期真值
 * 必须送回宿主日志才能取证。**只发诊断，不影响业务**：失败静默。
 */
function reportPetLinkDiag(payload) {
  try {
    void apiFetch(apiUrl('/pet-link/official'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'diag', payload }),
    });
  } catch { /* 诊断失败不影响业务 */ }
}

let petLinkContext = null;
/** 联动开关（M7）：开=linked 优先，关=强制 native；内存态，切换立即生效不重启。 */
let linkEnabledFlag = true;

/** 当前语言 id：优先宿主 locale 服务快照，其次 `?we-lang` 逃生舱，回落 zh。 */
const petLinkLang = () => {
  try {
    const loc = petLinkContext && typeof petLinkContext.get === 'function' ? petLinkContext.get('locale') : null;
    const snap = loc && (typeof loc.getSnapshot === 'function' ? loc.getSnapshot() : (typeof loc.snapshot === 'function' ? loc.snapshot() : null));
    const active = snap && (snap.active || snap.locale || snap.lang);
    if (typeof active === 'string' && active) return active;
  } catch { /* locale 服务缺席 → 回落 */ }
  try {
    if (typeof location !== 'undefined') {
      const m = /[?&]we-lang=([^&]+)/.exec(String(location.search || ''));
      if (m) return decodeURIComponent(m[1]);
    }
  } catch { /* ignore */ }
  return 'zh';
};
/** 注入式 translator：先查 pet-link 本地 EN 表，再回落主包 weT（键=中文原文）。 */
const petLinkTranslate = createPetLinkTranslate(weT, petLinkLang);

/**
 * 可选探测 `petApiDshwe`：本页没有该服务（用户没装 dsh-pet-dshwe）时返回 null。
 *
 * ⚠️ 这是可选探测，不是必需依赖 —— 所以 `inject` 里没有、也不能有它（写进去就会让整个子包
 * 在没有运行时下不激活，破坏 native 降级）。宿主半同义实现见 lib/index.js 的 probeOptionalService
 * （Cordis 的 ctx.get 本身就是「不声明 inject 也能读」的官方入口）。
 * @returns {any|null}
 */
function probePetApi() {
  try {
    return petLinkContext && typeof petLinkContext.get === 'function'
      ? (petLinkContext.get('petApiDshwe') ?? null)
      : null;
  } catch {
    return null;
  }
}

/**
 * 当前宠物实际生效的显示端（由 PET 侧 `link.surface` 按配置 `display` 解析）。
 *
 * 用户规则：main pet 同时启用 web+desktop 时只允许操控 web；只启用单端时操控那一端。
 * 旧的 PET 运行时没有 `surface` 字段 → 回落 `'web'`，行为与原来写死 `surface=web` 完全一致。
 * @returns {'web'|'desktop'}
 */
function petLinkSurface() {
  try {
    const value = probePetApi()?.link?.surface;
    return value === 'desktop' ? 'desktop' : 'web';
  } catch {
    return 'web';
  }
}

/**
 * 桌面端写位：`surface === 'desktop'` 时页面内 `adoptPosition` 控不到独立桌面窗口里的宠物，
 * 位置指令必须走宿主 HTTP `POST /position?surface=desktop`（PET 侧 motion 路由已实现）。
 *
 * 走位是逐帧写的，这里做 60ms 节流 + 末尾补发（保最后一次落点不被吞），避免每帧一个请求。
 */
const petLinkDesktopPosition = (() => {
  let lastAt = 0;
  let timer = null;
  let latest = null;
  const flush = () => {
    timer = null;
    const point = latest;
    latest = null;
    if (!point) return;
    lastAt = Date.now();
    const width = typeof window !== 'undefined' ? window.innerWidth : 0;
    const height = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (!(width > 0 && height > 0)) return;
    const body = JSON.stringify({ x: point.x / width, y: point.y / height, mode: 'instant' });
    try {
      void apiFetch(
        petLinkOrigin() + PET_LINK_PET_BASE + '/position?pet=' + encodeURIComponent(point.petId) + '&surface=desktop',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      );
    } catch { /* 诊断/网络失败不影响排播 */ }
  };
  return (petId, x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    latest = { petId, x, y };
    const now = Date.now();
    if (timer === null) {
      const waitMs = Math.max(0, 60 - (now - lastAt));
      timer = setTimeout(flush, waitMs);
    }
  };
})();

const petLink = createPetLink({
  translate: petLinkTranslate,
  reportDiag: reportPetLinkDiag,
  // 联动开关：M7 扩展卡片把它接到「立即生效」的内存开关（开=linked 优先，关=强制 native）。
  // 不在主包设置里落键（主包零改动），只由 pet-link 自己的卡片控制器持有。
  isEnabled: () => linkEnabledFlag,
  getApi: probePetApi,
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  document,
  bubbleUrl: index => petLinkMemeUrls.get(index) || '',
  /**
   * 发一段动作：POST fork 的 `/anim?pet=<id>&surface=<petLinkSurface()>`，成功即踢一下该宠物的
   * `/state` 轮询（不新增通道）。
   *
   * ⚠️ `surface` 是**必填**参数（运行时 `pet-lookup.ts` 的 `surfaceParam`：缺省 / 非法一律
   * `bad-request`），不是可选修饰。取值按用户规则动态解析：both 只操控 web、单端操控那一端——
   * 该规则由 PET 侧 `link.surface`（`resolveSurface`）解析好，这里照读；旧运行时无该字段则回落
   * `web`（`petLinkSurface()`），与原来写死 `surface=web` 的行为一致。
   *
   * `name` 必须是运行时动画池里的名字（`DSHWE` 池由宿主半 `lib/provision.js` 追加进去）——
   * 池里没有的名字会被判 `unknown-animation`，绝不回落成"随便播一个"。
   */
  async playAnim(petId, name, facing) {
    const query = PET_LINK_PET_BASE + '/anim?pet=' + encodeURIComponent(petId) + '&surface=' + petLinkSurface();
    const body = facing === 'left' || facing === 'right' ? { name, facing } : { name };
    const response = await apiFetch(petLinkOrigin() + query, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!(response && response.data && response.data.ok === true)) return false;
    try { probePetApi()?.link?.pollState?.(petId); } catch { /* 唤醒失败不影响本段 */ }
    return true;
  },
  /** 叫醒：POST fork 的 `/wake?pet=`（该路由只校验 `pet`，不校验 `surface`，故不带）。 */
  async wake(petId) {
    const response = await apiFetch(petLinkOrigin() + PET_LINK_PET_BASE + '/wake?pet=' + encodeURIComponent(petId), { method: 'POST' });
    return Boolean(response && response.data && response.data.ok === true);
  },
  /** 桌面端（surface=desktop）写位：页面内 adoptPosition 够不到独立窗口，改走 HTTP /position。 */
  positionDesktop: petLinkDesktopPosition,
  /**
   * 让**宠物自己**说话：`POST /broadcast?pet=<id>&surface=<petLinkSurface()>`。
   *
   * 这是旧版 `petLinkSay` 的同一条路（蓝本 L740-760）：气泡由 dsh-pet 的渲染端绘制，
   * 因此样式、位置、配图都跟宠物本体一致——而不是我们在页面上另画一个 div
   * （那样会"不是原版气泡"且位置对不上宠物）。
   *
   * `image` 传**池内图名**（如 `累瘫鲸鱼的两碗饭`），不是 URL：宿主对池外配图回
   * `HTTP 200 + {ok:false, reason:'unknown-image'}`，所以判据必须读载荷 `ok`；
   * 带图被拒时退回纯文字，保证文案送达（蓝本同款兜底）。
   */
  async say(petId, text, image) {
    const url = petLinkOrigin() + PET_LINK_PET_BASE + '/broadcast?pet=' + encodeURIComponent(petId) + '&surface=' + petLinkSurface();
    const name = typeof image === 'string' ? image.trim() : '';
    const post = body => apiFetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    try {
      const payload = result => (result && result.data) || null;
      if (!name) return Boolean((payload(await post({ text })) || {}).ok === true);
      const withImage = payload(await post({ text, image: name }));
      if (withImage && withImage.ok === true) return true;
      return Boolean((payload(await post({ text })) || {}).ok === true);
    } catch { return false; }
  },
  rope: {
    point() {
      const rope = typeof document.querySelector === 'function' ? document.querySelector('.we-rope') : null;
      const box = rope && typeof rope.getBoundingClientRect === 'function' ? rope.getBoundingClientRect() : null;
      if (!box) return null;
      // 除中心/下沿外额外给出**上沿**：逻辑二站位口径是"手指尖对准绳子顶部"
      // （蓝本 L1251-1255：handY = stage.top + stage.height*36/360，y = … + rope.top - handY）。
      return {
        x: (box.left + box.width / 2) / window.innerWidth,
        y: box.bottom / window.innerHeight,
        top: box.top / window.innerHeight,
      };
    },
    /**
     * 把吉祥物（绳子）往下拉 `px` 像素。
     *
     * ⚠️ 必须写 `transform`，不能写 CSS 变量：`.we-rope` 的样式里**没有**任何
     * `--we-rope-pull` 的消费者（主包扫过 162 个文件，命中 0），写进去等于石沉大海
     * —— 这就是"吉祥物不会被下拉移动"的直接原因。
     * 旧版内置实现（蓝本 L1220-1234 `petLinkPullRopeDown`）也是改 `el.style.transform =
     * 'translate(0px,Npx)'`，这里与之对齐；原 transform 先存起来，恢复时原样写回。
     * @param px - 下移量（px），0 表示回到原位。
     */
    moveRope(px) {
      const rope = typeof document.querySelector === 'function' ? document.querySelector('.we-rope') : null;
      if (!rope) return;
      if (!rope.dataset || rope.dataset.plRopeOrig === undefined) {
        // 首次接管：记下主包自己设置的 transform，之后恢复时原样还原。
        if (rope.dataset) rope.dataset.plRopeOrig = rope.style.transform || '';
      }
      const orig = (rope.dataset && rope.dataset.plRopeOrig) || '';
      rope.style.transform = (orig ? orig + ' ' : '') + 'translate(0px,' + Math.round(px) + 'px)';
    },
    restoreRope() {
      const rope = typeof document.querySelector === 'function' ? document.querySelector('.we-rope') : null;
      if (!rope) return;
      const orig = (rope.dataset && rope.dataset.plRopeOrig) || '';
      rope.style.transform = orig;
      if (rope.dataset) delete rope.dataset.plRopeOrig;
    },
  },
  fallback: () => wallSidebarToggle('mascot') === true,
});

registerPetLink(petLink);

// 浮层操控面板（Ctrl+Shift+D）：只读写 petLink.tuner 覆盖层，值持久化到 WE 侧存储（刷新不丢）。
const petLinkPanel = createPetLinkPanel({
  petLink,
  translate: petLinkTranslate,
  document,
  window,
  settings: createPetLinkPanelSettings({ storage: typeof localStorage !== 'undefined' ? localStorage : null }),
});

// 设置页「扩展模块」卡片（M7，order:0 排第一）：卡片只渲染快照、动作全走具名处理器（M4 路由）。
// 主包零改动：靠 host 暴露的 registerExtensionModule 注册表入口登记，主包枚举逻辑不碰。
const hostRegisterExtensionModule = host.registerExtensionModule;
const ReactRef = host.React;
let petLinkExtensionCard = null;
let petLinkCardTimer = null;
if (typeof hostRegisterExtensionModule === 'function' && ReactRef && typeof ReactRef.createElement === 'function') {
  try {
    petLinkExtensionCard = createPetLinkExtensionCard({
      h: ReactRef.createElement,
      React: ReactRef,
      petLink,
      panel: petLinkPanel,
      apiFetch,
      apiUrl,
      translate: petLinkTranslate,
      setLinkEnabled: on => { linkEnabledFlag = on === true; },
      // 引导截图 URL（blob objectURL）；未就绪时返回空串，卡片不渲染 img（避免破图）
      guideImageUrl: step => petLinkGuideUrls.get(step) || '',
      ensureGuideShots: () => { void prefetchPetLinkGuideShots(); },
    });
    hostRegisterExtensionModule('pet-link', petLinkExtensionCard.descriptor);
  } catch (error) {
    // 注册失败只影响这张卡片（定位/去重冲突等），绝不影响联动本体。
    console.warn('[wallpaper-engine-pet-link] 扩展卡片注册失败（已忽略）：' + (error instanceof Error ? error.message : String(error)));
  }
}

exports.inject = [];
exports.apply = ctx => {
  petLinkContext = ctx;
  // 气泡配图预取（blob → objectURL）：`<img src>` 走不了带令牌的 fetch，会 403 破图。
  void prefetchPetLinkMemes();
  void prefetchPetLinkGuideShots();
  petLink.warmup();
  petLinkPanel.install();
  if (petLinkExtensionCard) {
    petLinkExtensionCard.refresh();
    // 适度轮询运行态（版本/运行中/官方共存），供卡片状态行保持最新；受主包零改动约束无订阅通道。
    if (petLinkCardTimer === null && typeof setInterval === 'function') {
      petLinkCardTimer = setInterval(() => { if (petLinkExtensionCard) petLinkExtensionCard.refresh(); }, 5000);
    }
  }
  ctx.effect(() => () => {
    if (petLinkContext === ctx) {
      if (petLinkCardTimer !== null && typeof clearInterval === 'function') { clearInterval(petLinkCardTimer); petLinkCardTimer = null; }
      petLinkPanel.dispose();
      petLink.dispose();
      petLinkContext = null;
    }
  });
};
