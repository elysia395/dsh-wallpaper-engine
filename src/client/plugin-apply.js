/**
 * plugin-apply.js — 浏览器半边的插件入口 `apply(ctx)`（fiber 生命周期、启动链、宿主服务接线），
 * 从 `src/client.js` 整段搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / emit / loadPersisted / loadInventory / prefetchFontSetList 等自由名
 *      由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文与拆前 src/client.js 的 2899–3452 行逐字节相同。
 *   3) 函数声明提升 ⇒ 正文里的 `exports.apply = apply;` 文本零改动；apply 只在宿主装载后调用一次，
 *      此时正文常量早已初始化完，不存在 TDZ 窗口。
 *   4) 函数体自身的清理链（fiber dispose：监听拆除 / 计时器 / 进行中的准备）随函数整体搬走，仍是
 *      同一份实现 —— verify-layer-ownership 的 P3 取文口径跟着改到客户端正文族。
 */
function apply(ctx) {
  // 0. i18n：把插件文案接上宿主的 locale 服务（`ctx.get("locale")`，可选服务 + 短轮询 ——
  //    缺服务时静默停在默认语言，见 src/i18n/i18n.js）。放在最前面：界面首次渲染就要按当前
  //    语言取词；服务通常已在（dsh-web-app 的 base bundle 自带），轮询只是兜底。
  if (ctx.effect) ctx.effect(() => weI18nAttach(ctx) || undefined);

  // 0b. 启动预取（字体集清单）：与设置无关，启动链却要等 settings 之后才发 —— 这里先发，
  //     链走到它时通常已经回来（只预取一次；失败不影响启动链）。
  //     ⚠️ **inventory 不在这里预取**（#158）：大库（2600 项目 / 13,941 文件）上
  //     `/inventory` 冷调用要等整轮扫描，实测总延迟 1.6–2.0 s。插件激活期就发，等于让
  //     宿主的启动和这轮全盘扫描抢同一段 I/O；而首帧之前没有任何界面在等它。改为首帧后
  //     空闲时再发（见 apply 末尾启动链里的 `afterFirstPaint`）。
  try {
    prefetchFontSetList();
  } catch { /* 预取失败走原路径（启动链各步自己会发请求） */ }

  // 0c. 玻璃行停用时的残留回收（见 reclaimGlassResidue 的注释：清理函数住在玻璃子包，
  //     行停用后那个 bundle 不求值 ⇒ 只能由永远加载的主包来收）。
  //     ⚠️ **不发额外请求**：早先版本在这里 `setTimeout` + `apiJson(INVENTORY_URL)` 自探一次，
  //     结果在 vm 沙箱（live-frame-backfill-smoke）里与夹具的 fetch 桩抢时序，把
  //     "有画面 + 体积达标 ⇒ PUT 回填" 那一档整个压掉（实测 11 条判据连锁红）。
  //     结论：回收只挂在**本来就有的数据流**上 —— `loadInventory` 拿到新 components 时
  //     即时回收（见那里），再加上本函数在每次 `emit` 里对**已缓存的** components 复核一次。
  //     页面刷新后什么都不点的情况由 `loadInventory` 的启动链覆盖（它本来就会跑一次）。

  // 1. Mount the behind-body wallpaper + scrim layers and keep them in sync
  //    with the selection store. ctx.effect gives fiber-lifetime cleanup.
  if (ctx.effect) {
    ctx.effect(() => {
      const unsub = subscribe(syncLayers);
      const unsubEffects = subscribe(applyEffects);
      // 「扩展」页签的那几层（P-A 起统一走注册表）：接法与壁纸层同形 —— 每次 emit 重判一次
      // "该不该活"。三层各自的性质不同（画布层内容驱动、视差层收敛驱动、头像层改宿主 DOM），
      // 但**接法只有一个**：注册表说有哪些层，这里就 subscribe 谁的 sync；参数不在这里传，
      // 每一层自己每帧现读 `selection`。三项里两项住在自己的包里，本 bundle 的作用域里
      // 根本没有它们的函数名 —— 这正是这张注册表存在的理由。
      const layerUnsubs = new Map();
      const attachLayer = (layerId, hooks) => {
        if (layerUnsubs.has(layerId)) return;
        layerUnsubs.set(layerId, subscribe(hooks.sync));
      };
      // 迟到注册（子包产物在挂载之后才求值）：补订阅 + 立刻对时 + emit 一次让面板把新模块画上。
      weSetLayerAttacher((layerId, hooks) => {
        attachLayer(layerId, hooks);
        try { hooks.sync(); } catch { /* 单层启动失败不许带崩挂载 */ }
        emit();
      });
      // 注册表本身变了也要重画（迟到登记的扩展模块描述符 —— 与层钩子同一次 bundle 求值）。
      weSetRegistryListener(() => emit());
      for (const [layerId, hooks] of weLayerHooks()) attachLayer(layerId, hooks);
      // 启动对时：挂载后的第一次 emit 由 applySelection 触发，但「轮播开关 / 场景实时
      // 渲染 / 帧率档 / 播放倍速」这族键不在 emit 订阅链里（syncRotationTimer /
      // syncSceneAudio 需显式调用）—— preset-store 的 reapplyAll() 只在应用预设时跑。
      // 这里补一次对时，让挂载那一刻就按真实设置运转（幂等：按当前值重排定时器 / 音频）。
      try { reapplyAll(); } catch { /* 挂载期静默：无媒体层时是空操作 */ }
      // Occlusion pause: re-apply the effective playing state whenever the
      // page hides/shows or the window loses/gains focus (see occlusionActive).
      // Fires syncLayers → play/pause on the video; decode drops to 0 while
      // minimized / covered by another app, exactly like desktop WE.
      // #288：pauseOnHidden 的持续期防抖。瞬时 hidden（虚拟桌面切换 / 焦点竞态）直接忽略，
      // 只有持续 ≥ HIDDEN_PAUSE_DEBOUNCE_MS 才置 hiddenHoldActive 并 emit（走正常暂停管线）；
      // 回来时立刻清状态并 emit。绑定随 fiber 注销（下面的 cleanup）。
      let hiddenDebounce = 0;
      let hiddenHoldBound = false;
      const applyHiddenHold = () => {
        const hidden = typeof document !== "undefined" && document.hidden === true;
        if (!hidden) {
          if (hiddenDebounce) { clearTimeout(hiddenDebounce); hiddenDebounce = 0; }
          if (hiddenHoldActive) { hiddenHoldActive = false; emit(); }
          return;
        }
        if (hiddenHoldActive || hiddenDebounce) return;
        hiddenDebounce = setTimeout(() => {
          hiddenDebounce = 0;
          if (typeof document !== "undefined" && document.hidden === true) {
            hiddenHoldActive = true;
            emit();
          }
        }, HIDDEN_PAUSE_DEBOUNCE_MS);
      };
      applyHiddenHold();
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", applyHiddenHold);
        hiddenHoldBound = true;
      }
      const onOcclusionChange = () => emit();
      const ocListeners = [];
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        for (const t of ["visibilitychange", "blur", "focus"]) {
          window.addEventListener(t, onOcclusionChange);
          ocListeners.push(t);
        }
      }
      // 视频壁纸的**提交前预热**：指针按到/停在卡片上时就把它预到元数据（见 src/wallpaper/video-layer.js
      // 的 warmVideoUrl）—— 点击发生在抬手，按下→抬手、以及鼠标停在卡片上的这段时间都是白捡的
      // 窗口（手动点选没有准备链）。capture + passive：不拦事件、不进冒泡链。
      const onWarmPointerDown = (ev) => { try { warmVideoForPointer(ev, true); } catch { /* ignore */ } };
      const onWarmPointerOver = (ev) => { try { warmVideoForPointer(ev, false); } catch { /* ignore */ } };
      let warmBound = false;
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("pointerdown", onWarmPointerDown, { capture: true, passive: true });
        document.addEventListener("pointerover", onWarmPointerOver, { capture: true, passive: true });
        warmBound = true;
      }
      // 可见性恢复（最小化 → 还原 / 页面从 bfcache 回来）：**只在"隐藏 → 可见"这一个方向**
      // 做两件事 —— 一次两帧的复合成微推（见 nudgeWallpaperRepaint）与"画面真的回到屏上了吗"
      // 的留痕（见 probeWallpaperOnScreen）。普通 focus（用户点回窗口）不做，否则每次点窗口
      // 都要动一次层；两件事都是事件级、不进热路径。
      const onBackVisible = () => {
        if (typeof document !== "undefined" && document.hidden) return;   // 还在隐藏态
        try { nudgeWallpaperRepaint(); } catch { /* ignore */ }
        try { probeWallpaperOnScreen("back-visible"); } catch { /* ignore */ }
      };
      let backVisBound = false, pageShowBound = false;
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onBackVisible);
        backVisBound = true;
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("pageshow", onBackVisible);
        pageShowBound = true;
      }
      // 客户端 JS 异常的**留痕**：这台机器打不开 DevTools ⇒ 没有这一条，一次渲染期异常就只剩
      // "UI 崩了"这句转述（实测过：面板白屏时诊断缓冲里什么也没有）。只**记录**、不改行为；
      // 与其它监听器一样随 fiber 注销（HMR 重挂不会叠）。
      const onClientError = (ev) => {
        try {
          const err = ev && (ev.error || ev.reason);
          const type = (ev && ev.type) ? ev.type : "error";
          const msg = String((err && err.message) || (ev && ev.message) || err || ev || "").slice(0, 240);
          const where = (err && err.stack) ? " @ " + String(err.stack).split("\n").slice(0, 3).join(" <- ") : "";
          liveLog("client-error", type + ": " + msg + where);
        } catch { /* 连记录都失败就放弃，绝不在错误处理里再抛 */ }
      };
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("error", onClientError);
        window.addEventListener("unhandledrejection", onClientError);
      }
      // 遮挡判定**不能只靠事件**：原生模态（`window.confirm` / `alert`）会把焦点交给自己的窗口，
      // 而**回来时的 focus 事件不保证送达** —— 判定就会一直停在「窗口失焦」，壁纸从此不恢复
      // （真机形态：删除确认弹窗之后壁纸停住、输入框也收不到键，只剩重载能救）。
      // 事件之外再**低频复核**一次，且只在判定**变了**时 emit ⇒ 常态零代价、不 churn。
      let lastOcclusion = occlusionReason();
      let ocWatch = 0;
      if (typeof setInterval === "function") {
        ocWatch = setInterval(() => {
          const now = occlusionReason();
          if (now === lastOcclusion) return;
          lastOcclusion = now;
          // 留痕：这条日志是"事件丢了、靠复核补上"的唯一事后证据（真机排查时缺的就是它）。
          try { liveLog("play-state", liveStateBrief("occlusion-recheck")); } catch { /* ignore */ }
          emit();
        }, OCCLUSION_RECHECK_MS);
      }
      // 图片 URL 源（Bing 每日一图）由宿主每天换图：客户端在**存在这类源**时低频重拉清单，
      // 让正在显示的壁纸跟着换（宿主把 lastFetchedAt 带进 media URL 当版本号 ⇒ 层键变化）。
      // ⚠️ 只有**正在显示**的那张是 URL 源时才重拉：轮询只为拿到版本号，不该让大库每半小时
      // 做一次整库重建，更不能在轮播过场准备期间把 applySelection 的 cancelRotationPrepare
      // 撞进来（那会跳一张 / 卡顿）。
      let urlWatch = 0;
      if (typeof setInterval === "function") {
        urlWatch = setInterval(() => {
          if (disposed) return;
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          const list = selection.inventory.wallpapers || [];
          const current = list.find((w) => w && w.id === selection.id);
          if (!current || !current.urlSource) return;
          if (selection.rotationTimer) return;   // 过场准备中：下一拍再说
          loadInventory().catch(() => { /* 失败保持现状，下一次再试 */ });
        }, URL_SOURCE_POLL_MS);
      }
      // 壁纸库自动刷新：WallpaperMachine 会自己把新壁纸下到库目录（Library/<id>/），
      // 但它**只在宿主真的找到这个库**时才需要轮询。判据是 /inventory 回的
      // wallpaperMachineRoots（宿主按磁盘实测报的数）—— 不用「installDir 为空」当
      // 「没有 Steam」的代理：探测不到 Steam 的 Windows 用户会因此被拖进每 30s 一次
      // 的大库重拉（#396 评审）。轮询走 silent：不亮 loading、清单没变不 emit、不重算选择。
      let invWatch = 0, invPollFails = 0, invPollSkip = 0;
      if (typeof setInterval === "function") {
        invWatch = setInterval(() => {
          if (disposed) return;
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          if (!selection.inventory.wallpaperMachineRoots) return;
          if (selection.rotationTimer) return;   // 过场准备中：下一拍再说
          if (invPollSkip > 0) { invPollSkip -= 1; return; }
          loadInventory({ silent: true }).then(() => {
            // loadInventory 自己吞异常 ⇒ 失败只能从库存的 error 字段读。
            if (selection.inventory && selection.inventory.error) {
              invPollFails += 1;
              if (invPollFails >= 3) { invPollFails = 0; invPollSkip = 6; }   // 连败 3 次 ⇒ 退避约 3 分钟
            } else {
              invPollFails = 0;
            }
          });
        }, INVENTORY_POLL_MS);
      }

      // 持久化监听器: pagehide → 立即 flush 未落盘的设置; visibilitychange →
      // 页面回到前台时重试失败过的 PUT。注册在这里 (而不是模块作用域) 才能随
      // fiber 注销 — 否则每次插件重载/HMR 都会在同一页面再叠一对, 永不释放。
      // 字体集是**另一条**通道（src/settings/fontset-store.js），同形但各自记自己的脏标记 ⇒ 各自注册。
      let pageHideBound = false, visBound = false;
      let fontPageHideBound = false, fontVisBound = false;
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("pagehide", onPageHideFlush);
        pageHideBound = true;
        window.addEventListener("pagehide", onPageHideFlushFontSet);
        fontPageHideBound = true;
      }
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibilityResyncPersist);
        visBound = true;
        document.addEventListener("visibilitychange", onVisibilityResyncFontSet);
        fontVisBound = true;
      }
      // 样式标签也按 fiber 生命周期注入 (dispose 会移除, 见下方 cleanup)
      ensurePluginCss();
      petLink.warmup();
      // Battery optimization (省电暂停): navigator.getBattery is deprecated but
      // still functional in Chromium; feature-detected so other engines just
      // no-op. 'chargingchange' covers plug/unplug; onOcclusionChange re-applies
      // the effective playing state.
      let batteryCleanup = null;
      let disposed = false;
      if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
        navigator.getBattery().then((bm) => {
          // The plugin effect may have been torn down (disable / HMR) while
          // this promise was pending — registering listeners then would leak.
          if (disposed) return;
          weBattery = bm;
          bm.addEventListener("chargingchange", onOcclusionChange);
          batteryCleanup = () => bm.removeEventListener("chargingchange", onOcclusionChange);
          emit(); // already on battery → pause immediately
        }).catch(() => { /* battery API unavailable: no-op */ });
      }
      syncLayers();
      applyEffects();
      // 每一层挂载后的第一次对时（幂等）：注册表里有哪层就对哪层，没有的不调用。
      for (const [, hooks] of weLayerHooks()) {
        try { hooks.sync(); } catch { /* 单层对时失败不许带崩挂载 */ }
      }
      return () => {
        disposed = true;
        petLink.dispose();
        unsub();
        unsubEffects();
        weSetLayerAttacher(null);
        weSetRegistryListener(null);
        for (const [, unsubLayer] of layerUnsubs) unsubLayer();
        layerUnsubs.clear();
        if (ocWatch) { try { clearInterval(ocWatch); } catch { /* ignore */ } ocWatch = 0; }
        if (urlWatch) { try { clearInterval(urlWatch); } catch { /* ignore */ } urlWatch = 0; }
        if (invWatch) { try { clearInterval(invWatch); } catch { /* ignore */ } invWatch = 0; }
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
          for (const t of ocListeners) window.removeEventListener(t, onOcclusionChange);
          if (pageShowBound) window.removeEventListener("pageshow", onBackVisible);
          window.removeEventListener("error", onClientError);
          window.removeEventListener("unhandledrejection", onClientError);
          if (pageHideBound) window.removeEventListener("pagehide", onPageHideFlush);
          if (fontPageHideBound) window.removeEventListener("pagehide", onPageHideFlushFontSet);
        }
        if (backVisBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onBackVisible);
        }
        if (warmBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("pointerdown", onWarmPointerDown, { capture: true });
          document.removeEventListener("pointerover", onWarmPointerOver, { capture: true });
        }
        if (visBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onVisibilityResyncPersist);
        }
        // #288：防抖状态与监听随 fiber 一起收（模块级 hiddenHoldActive 必须复位，
        // 否则禁用期间页面若是隐藏的，重挂后会带着旧态直接暂停）。
        if (hiddenHoldBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", applyHiddenHold);
        }
        if (hiddenDebounce) { clearTimeout(hiddenDebounce); hiddenDebounce = 0; }
        hiddenHoldActive = false;
        if (fontVisBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onVisibilityResyncFontSet);
        }
        if (batteryCleanup) { batteryCleanup(); batteryCleanup = null; }
        weBattery = null;
        clearRotationTimer();
        // 卸载/禁用要收掉「进行中的准备」与「领养槽位」：否则 staged iframe 继续
        // 跑 rAF/WebGL、探测 <video> 以无句柄后台解码器的形态活到页面关闭，
        // 而且 prep 的兜底定时器之后仍会 commit（往已卸载的插件里建层）。
        cancelRotationPrepare();
        disposePreparedMedia();
        // 预热槽位同一条纪律：留着就是一个没有句柄的解复用器（页面关闭前不会自己走）。
        disposeWarmVideo();
        // 每一层的收尾都归它自己：画布层摘节点 + 解绑监听与 rAF；视差层摘监听、rAF 与 body
        // 上的 CSS 变量/开关属性（否则重挂会残留上一份位移）；头像层摘注入节点与行标记、
        // 断开观察者、撤开关属性（"关掉 = 逐字节回原生"在卸载路径上的同一个动作）。
        // 逐层包 try/catch：某一层收尾抛错不许把后面的层留在屏上。
        for (const [layerId, hooks] of weLayerHooks()) {
          try { hooks.dispose(); } catch (err) {
            try { reportClientDiag("layer-dispose-failed:" + layerId, String((err && err.message) || err)); } catch { /* 诊断本身不许再抛 */ }
          }
        }
        // 关掉音频闸并退役渐变中的旧层：禁用/重挂时旧层不能被留在屏上等退役定时器
        // （≤1.3s 的可见残留），闸也不该跨过一次重挂活着（准备链的 BGM 起播会被它
        // 推迟到那个定时器触发为止）。这两条收尾本身是正确性要求：跨过一次重挂活着的闸
        // 会让准备链的 BGM 起播被推迟，而留在屏上的旧层要等退役定时器（≤1.3s 可见残留）。
        // 先清闸、再退役渐变层：卸载不是「渐变结束」，走放行会 restoreNodeAudio →
        // syncSceneAudio → play()，刚被闸压住的场景 BGM 反而在禁用时响一下（smoke 场景 H
        // 锁定）。清掉闸后 retireFadingLayer 内部的
        // releaseRotationAudioGateFor 直接早退；场景音频元素也一并拆掉 —— 不拆的话
        // 禁用后正在播的 BGM 不会停止。
        rotationAudioGate = null;
        retireFadingLayer();
        stopSceneAudioEl();
        cancelLiveFrameBackfill(); // 卸载后不得再发 HEAD/PUT（少这一步就漏一次）
        stopLiveWatch();
        cancelLiveMount("unload"); // 延迟期那个正在预热的渲染页也要终止（否则卸载后仍在后台跑）
        abortTranscodeUpgrade(); // 含 clearUpgradePoll + AbortController.abort（否则卸载后 500ms 轮询永久泄漏）
        cancelPendingPersist(); // 模块级 persistTimer 不属于 fiber：不取消则 200ms 后仍会写一次
        cancelPendingFontSet(); // 字体集那条通道的 timer 同理（各自一个模块级 timer）
        cancelUserPropsCommit(); // 「壁纸属性」拖动期的尾部提交也是模块级 timer（同上）
        // media-info 探测的 AbortController 也要断开 (token 可能永远不再变化)
        abortMediaInfoProbe();
        // sceneVideo 时序补拉: 卸载后不该再拉 inventory (也不该钉住本次求值的闭包)
        if (sceneVideoResyncTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
          window.clearTimeout(sceneVideoResyncTimer);
        }
        sceneVideoResyncTimer = null;
        weStopDraw();
        const node = document.getElementById(LAYER_ID);
        if (node) { releaseLayerMedia(node); node.remove(); }
        const scrim = document.getElementById(SCRIM_ID);
        if (scrim) scrim.remove();
        clearEffects();
        setWallpaperActive(false);
        // 主样式标签: 每次 bundle 求值都会注入一份 (HMR 后旧 <style>
        // 永久留在 <head>), 故只移除本次求值这一代, 重挂载由 ensurePluginCss() 补回。
        if (typeof document !== "undefined" && typeof document.querySelector === "function") {
          const cssTag = document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]");
          if (cssTag && cssTag.dataset && cssTag.dataset.pluginCssGen === CSS_GEN
              && typeof cssTag.remove === "function") cssTag.remove();
        }
      };
    });
  }

  // 1b. 「文字颜色角色」令牌层：后台轮询 theme 服务（启动竞态：实测 7ms 时还没有、
  //     325ms 才有），拿到后按设置给每个角色上色；拿不到就**什么都不做** —— 全局
  //     令牌层是**唯一**的上色通道：`#we-font-patch` 那类全局回落通道已不存在，
  //     所以拿不到服务时角色色就是不上色，而不是换一条腿顶上。
  //     - 不声明 `inject: ["theme"]`：缺服务时声明式依赖会让插件 park。
  //     - 首次写入前先取宿主墨色基线，否则退出契约会把我们的颜色当宿主原值快照。
  //     - 不监听配色变化重注册：值给的是 {light,dark} 对，配色切换由服务自己换值。
  if (ctx.effect && typeof ctx.get === "function" && typeof document !== "undefined") {
    ctx.effect(() => {
      let layer = null;
      // 排版层：**必须独立 source** —— 同 source 再注册会整层替换，会把颜色层顶掉。
      // 它不碰 --dsw-alias-label-*，因此与宿主墨色基线（onBeforeFirstWrite）无关。
      let typeLayer = null;
      let unsub = null;
      const cancelPoll = pollThemeService(ctx, {
        intervalMs: 250,
        timeoutMs: 6000,
        onReady: (theme) => { themeFollowAttach(theme, ctx);   // 主题随壁纸：同一个服务句柄，接上即补评一次（开关默认关，关着时这次补评整体空转）
          // 首装的主题腿：applyPreset 若跑得比服务就绪早，那一次写会因句柄为空而静默跳过
          // ⇒ 这里补一次（幂等；非首装时 firstRunAuthorPending 为假，零开销）。
          try { flushFirstRunAuthorTheme(); } catch { /* 增强腿，不阻断主题层 */ }
          try {
            const available = scanThemeTokens(document);
            // 样式表扫描是清单的权威来源（active.tokens 为空、exportInspectTokens 只有 14 条）；
            // 再叠一层 computed 存在性探测，跨源样式表读不到 cssRules 时也能判定。
            const hasToken = (t) => available.has(t)
              || (typeof getComputedStyle === "function"
                && getComputedStyle(document.body).getPropertyValue(t).trim() !== "");
            layer = createThemeLayer({
              theme,
              // 绑在「字体自定义」总开关下：关闭 = 连颜色一起恢复原生（与面板文案一致）。
              // `|| {}` 是第二道：这几个 getter 会在**订阅回调**里被调到，而订阅回调不在 try 里 ——
              // 数据侧已有兜底（selection 初始化必带字体键），这里再挡一次，免得"某个键缺失"
              // 升级成"改一下设置整块面板崩"。
              getColors: () => (selection.fontCustom ? (selection.themeColors || {}) : {}),
              isAvailable: hasToken,
              onBeforeFirstWrite: () => { try { snapshotHostFontDefaults(); } catch { /* 基线失败不阻断上色 */ } },
            });
            typeLayer = createThemeLayer({
              theme,
              source: THEME_TYPE_SOURCE,
              // 全局字族也在这一层生效（作为**每个角色的默认**）。本机字体的栈里要拼
              // `var(--we-host-font-family, …)`，那是"开写之前"的宿主快照 ⇒ 本层也挂一次
              // onBeforeFirstWrite（它是幂等的"已快照则跳过"，与颜色层共用同一份快照）。
              onBeforeFirstWrite: () => { try { snapshotHostFontDefaults(); } catch { /* 基线失败不阻断字体 */ } },
              buildPayload: () => buildTypePayload(
                selection.fontCustom ? (selection.themeSize || {}) : {},
                hasToken,
                selection.fontCustom ? (selection.themeWeight || {}) : {},
                selection.fontCustom ? (selection.themeFamily || {}) : {},
                fontFamilyStack,
                selection.fontCustom ? (selection.globalFamily || "") : ""),
            });
            layer.sync();
            typeLayer.sync();
            // 订阅回调必须自己收异常：它跑在 emit() 里，抛出去就是"改一下设置整个面板崩"。
            unsub = subscribe(() => {
              try { if (layer) layer.sync(); if (typeLayer) typeLayer.sync(); } catch { /* 令牌层是增强 */ }
            });
          } catch { /* 主题层是增强：任何异常都不该影响壁纸主路径 */ }
        },
      });
      return () => {
        try { if (unsub) unsub(); } catch { /* ignore */ }
        try { if (cancelPoll) cancelPoll(); } catch { /* ignore */ }
        // 交给服务的 disposer 把令牌还原（实测干净）；这里只保证调用一次
        try { if (layer) layer.dispose(); } catch { /* ignore */ }
        try { if (typeLayer) typeLayer.dispose(); } catch { /* ignore */ }
      };
    });
  }

  // 2. Settings page as a FIRST-LEVEL settings section (mirrors the skin-center
  //    in dsh-web-ui-all: its own nav entry, rendered inside the panel content
  //    column). The picker renders inside the liquid-glass card shell.
  //    `label` 用 **thunk**（官方 SlotLabel 支持"每次读取时求值"）：语言切换后设置导航里
  //    的那一行跟着换文字，不需要重注册座位。nav-icon.js / sidebar-right.js 的 DOM 锚点
  //    认的就是这个词的当前译文。
  if (ctx.slots) {
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        { name: "settings.section", id: "wallpaper-engine", order: 500, label: () => weT("壁纸引擎") },
        () => React.createElement(WallpaperPickerSection),
      ),
    );
  }

  // 2b. 设置导航图标：官方 nav 的图标是 shell 里 navIcon(id) 的硬编码映射，第三方
  //     section 一律拿兜底齿轮 —— 用 DOM 补丁把「壁纸引擎」那格换成自绘 SVG
  //    （src/nav-icon.js；补丁失败 = 保留齿轮，不抛、不重试）。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installWeNavIcon() || undefined);
  }

  // 2c. 官方右侧栏接入（harness ≥0.1.5）：能力门在 src/sidebar-right.js —— 座位
  //     声明则面板融进右侧栏 tab，未声明则保持抽屉态。低版本宿主上回调永远不跑，
  //     插件也不会 park（可选服务全靠 ctx.get，不写进 inject）。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installSidebarRight(ctx) || undefined);
  }

  // 2d. 壁纸侧栏快捷键（官方桌面默认 Cmd/Ctrl+Alt+W）：注册进宿主的 shortcuts 服务
  //     （可选服务 + 短轮询，缺服务安静跳过），命令在宿主快捷键编辑器里可改键。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installWallSidebarShortcut(ctx) || undefined);
  }

  // 2e. 这些副作用**必须挂 fiber**（已在 `src/live-layer.js` 与本文件的轮换恢复监听两处收口）：
  //     诊断留痕（加载即留痕 / 窗口失焦·隐藏 / 60s 心跳）与「重启恢复」档的交互即退出监听
  //     （pointerdown/keydown，once），以及「隐藏期轮换推迟到可见时补做」的
  //     visibilitychange/focus 两条监听。理由：宿主每次 revision 变化
  //     都会 tearDownEntryFiber 后用新模块体重跑一遍，不挂 fiber ⇒ 旧实例的定时器
  //     与监听器永不释放（实测同一 document 214 个页 id、一次 window blur 被 117 份实例各记一条）。
  //     与官方契约一致（原文与现场见 src/live-layer.js 的 installLiveDiagnostics）。
  //     焦点交还（#148 宿主半）同理由同形态：document/window 级监听器，拆除函数交给 fiber。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installLiveDiagnostics() || undefined);
    ctx.effect(() => installLiveBootRestore() || undefined);
    ctx.effect(() => installRotationResumeListeners() || undefined);
    ctx.effect(() => installFocusHandback() || undefined);
  }

  // 3b. 皮肤中心互操作（皮肤在台上 ⇒ 我方整族退场）：只读对方两条公开信号，
  //     见文件顶部互操作块。随 fiber 注销（卸载即摘下观察器与轮询）。
  if (ctx.effect && typeof document !== "undefined") {
    ctx.effect(() => installSkinInterop() || undefined);
  }

  // 3. Chat-interface rope dock: the draggable pull-cord + glass repo side
  //    panel, portalled onto <body> under its own React root — independent of
  //    the settings view, floating above the conversation. Feature-detected
  //    (react-dom without createRoot → skip) so minimal host/mocks stay safe.
  if (ctx.effect && typeof document !== "undefined" &&
      typeof ReactDOM !== "undefined" && typeof ReactDOM.createRoot === "function") {
    ctx.effect(() => {
      let host = document.getElementById(ROPE_DOCK_ID);
      if (!host && document.body && typeof document.createElement === "function") {
        host = document.createElement("div");
        host.id = ROPE_DOCK_ID;
        document.body.appendChild(host);
      }
      if (!host) return undefined;
      const root = ReactDOM.createRoot(host);
      root.render(React.createElement(RopeDock, null));
      return () => {
        try { root.unmount(); } catch { /* already gone */ }
        if (host.parentNode) host.parentNode.removeChild(host);
      };
    });
  }

  // 3c. 性能监控悬浮窗（issue #263）：同样是 body 下的独立 React root，浮在对话上。
  //     RopeDock 是常驻入口，这里不同 —— 组件内部读 perfEnabled / perfFloat，关着就
  //     return null，不会画任何东西；打开后关掉配置面板仍然常驻（这正是用户要的）。
  if (ctx.effect && typeof document !== "undefined" &&
      typeof ReactDOM !== "undefined" && typeof ReactDOM.createRoot === "function") {
    ctx.effect(() => {
      let host = document.getElementById(PERF_FLOAT_HOST_ID);
      if (!host && document.body && typeof document.createElement === "function") {
        host = document.createElement("div");
        host.id = PERF_FLOAT_HOST_ID;
        document.body.appendChild(host);
      }
      if (!host) return undefined;
      const root = ReactDOM.createRoot(host);
      root.render(React.createElement(PerfFloat, null));
      return () => {
        try { root.unmount(); } catch { /* already gone */ }
        if (host.parentNode) host.parentNode.removeChild(host);
      };
    });
  }

  // 启动时暂停（#349）：宿主设置落地后（`loadPersisted` 末尾置 `hostLoaded`）统一在这里
  // 把播放意图置为暂停。位置在库存恢复**之前**（`loadInventory → revalidateSelection →
  // applySelection`），于是壁纸以暂停态挂载，而不是"先自动播放、随后才被暂停"（会闪一帧）。
  // 两个瞬态都置位：`playing` 是用户意图（面板按钮/出图闸门读它），`videoPlaying` 是元素
  // 真实态，启动时元素尚未挂载 ⇒ 不置位的话视频卡会在首帧前谎报「播放中」。
  // 只改瞬态、不落盘；手动点「播放」后本次会话照常播放。
  function applyStartPaused() {
    if (selection.startPaused === true && selection.playing) {
      setTransient("playing", false);
      setTransient("videoPlaying", false);
    }
  }

  // Settings first (host file, port-independent), then the ACTIVE FONTSET (its values live in
  // fontsets/<id>.json — a different store on the same host), then inventory — so the
  // selection restore inside loadInventory()'s revalidateSelection() sees the persisted id
  // and can resolve its media URL, and the first paint already has the user's fonts.
  //
  // ⚠️ 终止 `.catch` 是**必须**的：这条链上任何一步 reject，后面的 `loadInventory` 就永不执行 ——
  // 选择器永久停在「扫描 Wallpaper Engine…」，一次性提示也不收敛（用户只能靠刷新或禁用插件自救）。
  // 各步内部已各自消化可预期的失败（宿主不可达 / 存储被拒 / 坏 JSON），这一条兜的是"没预料到的那次抛"。
  // #158：库存这一腿排在**首帧之后**再跑（`afterFirstPaint` 见上）。大库上它要等一轮全盘
  // 扫描，而首帧之前没有任何界面等它 ⇒ 没必要在宿主启动那几百毫秒里跟它抢 I/O。
  // 与 settings / fontset 分离不影响正确性：链尾的 `revalidateSelection()` 只依赖库存本身。
  loadPersisted()
    .then(applyStartPaused)
    .then(loadFontSet)
    .then(afterFirstPaint)
    .then(() => { prefetchInventoryOnce(); return loadInventory(); })
    .then(loadGlassPresets)
    .catch((err) => {
    // 链断在任何一步都可能留下没被消费的启动预取；它们属于**这一次**启动链，
    // 不能留到用户后来的手动刷新 / 切字体集时冒充新响应（陈旧库存/清单）。
    inventoryBootPrefetch = null;
    try { cancelFontSetListPrefetch(); } catch { /* 模块未内联时也不许二次抛 */ }
    try { reportClientDiag("boot-chain-failed", String((err && err.message) || err)); } catch { /* 诊断本身不许再抛 */ }
  });
}
