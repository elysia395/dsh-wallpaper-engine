/**
 * 「播放」页签的节渲染器（从 src/panel-tabs.js 按域拆出）：滑块 / 实时帧 / 出图来源。
 * 转码进度 / 播放与出图 / 画面取景：倍速/帧率上限与适配/翻转两节 P-D S3d 起住在
 * packages/media-bridge 的浏览器半边（注册表续接）；renderEffectsTab 仍在组装点，只留空态与节外壳。
 * 本节渲染器从 src/panel-tabs.js 按域搬出，函数体逐字未改；内联顺序见 scripts/build-client.mjs（排在组装点之前）。
 */
  function renderEffectsSlidersSection(ctx) {
    const { onBackgroundBrightness, onBackgroundContrast, onBackgroundSaturate, onLayerPositionX, onLayerPositionY, onLayerReset, onLayerScale, onScrim, onWallpaperBlur, onWallpaperOpacity, sel } = ctx;
    return React.createElement(React.Fragment, null,
      SliderRow(weT("壁纸模糊"), 0, 60, 1, sel.wallpaperBlur, onWallpaperBlur, "px"),
      SliderRow(weT("亮度"), 40, 160, 5, sel.backgroundBrightness, onBackgroundBrightness, "%"),
      SliderRow(weT("对比度"), 40, 200, 5, sel.backgroundContrast, onBackgroundContrast, "%"),
      SliderRow(weT("饱和度"), 0, 200, 5, sel.backgroundSaturate, onBackgroundSaturate, "%"),
      // 壁纸层取景（位置 / 缩放）：WE 壁纸属性面板那三项（对齐方式 = 自由 时的 水平 / 垂直 /
      // 缩放，即 alignmentx / alignmenty / alignmentz）是 WE 引擎内置属性，存在 WE 自己的
      // config.json 里、本插件读不到；场景层的适配也只有 cover / contain / center / fill
      // ⇒ 想搬 WE 的取景只能在这里重设一遍。刻度与 WE 那三条滑条**同量程**（便于对拷）：
      // 位置 0..100（50 = 居中，整屏百分比偏移），缩放 50..150（100 = 原大小）。
      // `numberEdit` 让右侧数值区可直接键入；双击标签回默认（位置回 50、缩放回 100%）。
      SliderRow(weT("水平"), 0, 100, 1, sel.layerPositionX, onLayerPositionX, "%", "layer-pos-x", {
        tooltip: weT("整屏百分比偏移：50 = 中心，0/100 = 两端（与 Wallpaper Engine 自带的同名滑条同义）；双击标签回中心。"),
        numberEdit: true,
        onLabelDoubleClick: () => onLayerReset("x"),
      }),
      SliderRow(weT("垂直"), 0, 100, 1, sel.layerPositionY, onLayerPositionY, "%", "layer-pos-y", {
        tooltip: weT("整屏百分比偏移：50 = 中心，0/100 = 两端（与 Wallpaper Engine 自带的同名滑条同义）；双击标签回中心。"),
        numberEdit: true,
        onLabelDoubleClick: () => onLayerReset("y"),
      }),
      SliderRow(weT("缩放"), 50, 150, 1, sel.layerScale, onLayerScale, "%", "layer-scale", {
        tooltip: weT("100 = 原大小；95 = 缩到 95%（四周露出页面底色）；105 = 放大到 105%；双击标签回 100%。"),
        numberEdit: true,
        onLabelDoubleClick: () => onLayerReset("s"),
      }),
      // 壁纸透明度（#82）：越大越透，淡出后壁纸融向**原生外观**（浅色纯白 /
      // 深色纯黑，IDEA 背景图式）。与暗化互补 —— 一个减淡壁纸本身，一个压暗
      // 整体画面；上限 90% 避免调到「壁纸完全不可见但暗化还在」的诡异状态
      // （想关壁纸直接关掉即可）。
      SliderRow(weT("壁纸透明度"), 0, 90, 5, sel.wallpaperOpacity, onWallpaperOpacity, "%", "wallpaper-opacity", {
        tooltip: weT("壁纸向原生底色淡出（浅色纯白 / 深色纯黑）；透明生效时壁纸层会垫这层原生底色，以保证玻璃模糊不被透明背景破坏。场景壁纸的垫底实时帧会在实时画面出场后退场，不会在淡出时透出来"),
      }),
      SliderRow(weT("暗化"), 0, 90, 5, Math.round(sel.scrim * 100), onScrim, "%"),
    );
  }

  function renderEffectsLiveSection(ctx) {
    const { onLiveBootDelay, onSceneAutoQuality, onSceneLiveFps, onToggleSceneLive, sel } = ctx;
    return React.createElement(React.Fragment, null,
      // ── 场景实时渲染（WebWallGL）：scene.pkg 壁纸的实时 WebGL 形态，默认
      // 开启。失败（首帧超时/运行失联）按壁纸记忆并自动降级回内嵌 MP4 →
      // 静态帧；重开本开关清空全部失败记忆（显式重试入口）。
      (sel.type === "scene" || sel.type === "web") && switchRow(
        sel.type === "web" ? weT("网页实时渲染") : weT("场景实时渲染"),
        sel.sceneLive !== false, onToggleSceneLive, {
        key: "scene-live",
        hint: weT("WebGL 实时渲染 · 失败自动降级"),
        tooltip: sel.type === "web"
          ? weT("网页壁纸由 WebWallGL 加载并注入 WE API（音频/属性监听等），严格沙箱隔离（不继承宿主权限）；加载失败或运行失联时自动退回兼容 iframe。重新开启会重试此前失败的壁纸")
          : weT("场景壁纸由 WebWallGL 实时渲染（粒子/脚本/视差/包内音频）；加载失败或运行失联时自动退回内嵌视频 / 实时帧。重新开启会重试此前失败的壁纸"),
      }),
      (sel.type === "scene" || sel.type === "web") && sel.sceneLive !== false
        && React.createElement("div", { className: "we-picker__ctl", key: "live-boot-delay" },
        ctlText(weT("启动最长等待时间")),
        React.createElement("div", { className: "we-picker__seg" },
          [0, 3, 5, 10].map((secs) =>
            React.createElement("button", {
              key: secs,
              className: "we-picker__btn we-picker__rate" + (Number(sel.liveBootDelay) === secs ? " we-picker__rate--active" : ""),
              type: "button",
              onClick: () => onLiveBootDelay(secs),
            }, secs === 0 ? weT("立即") : "≤" + secs + "s"),
          ),
        ),
      ),
      (sel.type === "scene" || sel.type === "web") && sel.sceneLive !== false
        && (sel.sceneLiveSrc || sel.webLiveSrc)
        && React.createElement("div", { className: "we-picker__ctl", key: "scene-live-fps" },
        ctlText(weT("实时渲染帧率"), weT("渲染 fps · 越低越省电")),
        React.createElement("div", { className: "we-picker__seg" },
          SCENE_LIVE_FPS_VALUES.map((f) =>
            React.createElement("button", {
              key: f,
              className: "we-picker__btn we-picker__rate" + (sel.sceneLiveFps === f ? " we-picker__rate--active" : ""),
              type: "button",
              // 帧率进 iframe query（sceneFps）→ syncLayers key 变化重建层
              onClick: () => onSceneLiveFps(f),
            }, f + "fps"),
          ),
        ),
      ),
      // ── 自动画质（webwallgl autoQuality）：帧率压不住上限时引擎会逐级降后处理 /
      //    粒子 / AA，弱 GPU 上一路降到 postProcessing=off —— 发光、音频可视化、光晕全没，
      //    用户感知就是"动态效果没了"。这一行给它一个出口：关掉即保效果（`autoq=0`）。
      //    只在实时渲染真的会跑（有 live 源、总开关开着）时出现，否则它不起作用。
      (sel.type === "scene" || sel.type === "web") && sel.sceneLive !== false
        && (sel.sceneLiveSrc || sel.webLiveSrc)
        && switchRow(weT("自动画质"), sel.sceneAutoQuality !== false, onSceneAutoQuality, {
        key: "scene-auto-quality",
        hint: weT("帧率不足时自动降画质"),
        tooltip: weT("帧率达不到上限的 85% 时，引擎会逐级降低后处理（发光 / 音频可视化 / 光晕）与粒子、关掉抗锯齿来保帧率 —— 弱 GPU 或高分辨率下可能一路降到「后处理全关」，看起来就像动态效果消失了。关掉本开关则保留全部效果、接受可能掉帧；默认开启"),
      }),
    );
  }

  function renderEffectsSourceSection(ctx) {
    const { onClearCustomFrame, onClearGpuFrame, onCustomFrameFile, onRecaptureGpuFrame, onRefreshFrame, sel, surface } = ctx;
    const sidebarSurface = surface === "sidebar";
    const sceneWithFrame = sel.type === "scene" && Boolean(sel.sceneFrameUrl);
    const gpuPinnedHere = gpuFrameUi.wid === String(sel.id) && gpuFrameUi.pinned;
    return React.createElement(React.Fragment, null,
      // ── 出图来源：**只在实时渲染未生效时**出现 —— 它换的是「没有实时画面时显示什么」，
      //    实时画面在跑时它没有任何作用（换实时帧用下面的「重新截」）。
      //    侧栏档不出现在这里（准备与诊断，见函数头）。──
      !sidebarSurface && sel.type === "scene" && sel.sceneFrameUrl && !liveRenderEnabled(sel)
        && React.createElement("div", { className: "we-picker__ctl" },
        ctlText(weT("出图来源"), weT("这张画面从哪来"),
          weT("场景壁纸「这张画面从哪来」。两档：**实时画面**（有抓帧就用它，没有则留空）与**自定义画面**（手动导入的截图）。点一次切换一次，选择记忆在当前壁纸上。实时渲染生效时本行不显示（那时画面来自实时渲染，切这里不会生效）")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onRefreshFrame, "aria-label": weT("切换出图来源"),
        }, weT("切换")),
        React.createElement("span", { className: "we-picker__hint we-picker__value" },
          // 按**档位值**查表，不能当下标：值域有洞（0 与 4），下标会越界成 undefined.label
          (() => {
            const v = Number(sel.frameVariants && sel.frameVariants[String(sel.id)]) || 0;
            const i = Math.max(0, FRAME_VARIANTS.findIndex((f) => f.id === v));
            return weT("第 {n}/{total} 档 · {label}", { n: i + 1, total: frameVariantCount(sel, String(sel.id)), label: weT(FRAME_VARIANTS[i].label) });
          })()),
      ),
      // ── GPU 实时帧（抓帧缓存 + 重新截 + 微缩预览）：**实时渲染开着时同样显示**。
      //    它是切换途中 / live 首帧之前给用户看的那张静帧 —— 构图不对（黑帧、旧视口、
      //    切走瞬间抓的）时用户必须能立刻重抓，而不是先关掉实时渲染再回来。
      //    预览窗口指向的就是**层上正在用的那个 URL**（同一档位 + 缓存破坏参数），
      //    所以「预览看到什么，切换途中就是什么」。
      //    侧栏档不出现在这里（准备与诊断，见函数头）。──
      !sidebarSurface && sceneWithFrame && (gpuPinnedHere || liveRenderEnabled(sel))
        && React.createElement("div", { className: "we-picker__ctl we-picker__ctl--wrap" },
        ctlText(weT("实时帧"),
          gpuPinnedHere
            ? weT("已抓帧 · 优先于全部画面档位")
            : weT("实时渲染中 · 可随时抓一张"),
          weT("实时渲染成功后会自动抓帧缓存这一帧（<key>_gpu.png），它优先于「出图来源」的自动档；切换壁纸途中、以及 live 首帧出来之前，屏幕上显示的就是它。「重新截」会按**当前**画面重抓一张（已存在的缓存会被替换，抓不到则原样保留）；「清除 GPU 帧」删掉缓存、回到「自动」：没有实时画面时是空态（不再**合成**任何「猜」出来的图）；唯一的例外是该帧连**加载都失败**、而壁纸有工程预览图时，退到预览图垫底（作者随包发布的图）。")),
        // 微缩预览：只有槽里真有实时帧时才显示（否则这里会显示成 CPU 档位帧，误导）。
        gpuPinnedHere && React.createElement("img", {
          className: "we-picker__frame-shot",
          src: framePreviewSrc(sel),
          alt: weT("当前壁纸实时帧预览"),
          title: weT("当前壁纸的实时帧（就是切换途中 / live 首帧前显示的那张静帧）{size}", { size: gpuFrameUi.w > 0 && gpuFrameUi.h > 0 ? " · " + gpuFrameUi.w + "×" + gpuFrameUi.h : "" }),
        }),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onRecaptureGpuFrame,
          disabled: gpuFrameUi.recapturing, "aria-label": weT("重新截取当前壁纸实时帧"),
        }, gpuFrameUi.recapturing ? weT("抓帧中…") : weT("重新截")),
        gpuPinnedHere && React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onClearGpuFrame, "aria-label": weT("清除 GPU 实时帧缓存"),
        }, gpuFrameUi.busy ? weT("清除中…") : weT("清除 GPU 帧")),
        gpuPinnedHere && gpuFrameUi.w > 0
          && React.createElement("span", { className: "we-picker__hint we-picker__value" },
            gpuFrameUi.w + "×" + gpuFrameUi.h),
        gpuFrameUi.error
          && React.createElement("div", { className: "we-picker__hint" }, gpuFrameUi.error),
      ),
      // ── 自定义画面（截屏导入）：出不了实时画面的壁纸（骨骼拼装场景，预览 gif 仅
      //    160px）由用户从 WE 截图导入，画质=截图分辨率；就是 ?v=4 那一档。
      //    同样**不受实时渲染开关影响**（导入/清除与 live 互不干扰）。──
      !sidebarSurface && sel.type === "scene" && React.createElement("div", { className: "we-picker__ctl" },
        ctlText(weT("自定义画面"),
          weT("手动给电脑桌面截图，导入截图解决错误壁纸"),
          weT("手动对电脑桌面截图（壁纸显示效果的分辨率即最终展示画质），再回来点「导入画面…」选中该截图；导入后自动切换为该图，可随时切回「实时画面」档。实时渲染生效时它仍会作为「出图来源」的自定义档")),
        React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: () => { if (customFrameInput) customFrameInput.click(); },
        }, frameVariantCount(sel, String(sel.id)) === FRAME_VARIANTS.length ? weT("替换图片…") : weT("导入画面…")),
        frameVariantCount(sel, String(sel.id)) === FRAME_VARIANTS.length && React.createElement("button", {
          className: "we-picker__btn", type: "button",
          onClick: onClearCustomFrame,
        }, weT("清除")),
        React.createElement("input", {
          type: "file",
          accept: "image/png,image/jpeg,image/webp",
          style: { display: "none" },
          ref: (el) => { customFrameInput = el; },
          onChange: onCustomFrameFile,
        }),
      ),
    );
  }

export { renderEffectsSlidersSection, renderEffectsLiveSection, renderEffectsSourceSection };
