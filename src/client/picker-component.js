/**
 * picker-component.js — 设置页里的壁纸选择器组件 `WallpaperPicker`，从 `src/client.js` 整段搬出，
 * 组件体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      组件体引用的 selection / emit / setSetting / useStore / useWeLocale / render* 渲染器等自由名
 *      由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文与拆前 src/client.js 的 2573–3102 行逐字节相同。
 *   3) 组件是**函数声明**（提升），构建期内联后仍与正文同一作用域 ⇒ `WallpaperPickerSection` 与
 *      `renderPickerModal` 的调用点文本零改动。
 *   4) hooks 仍长在组件里（不使用任何模块级可变状态以外的捕获）—— 搬家不改变渲染身份：
 *      每次渲染仍是同一个函数对象（不在渲染里重建）。
 */
function WallpaperPicker() {
  useWeLocale(); // 设置页壁纸库：语言切换 → 整棵选择器（含 render* 渲染器）重渲染
  const sel = useStore();
  // ── 组件行状态面（ADR-0013 D3②/D3③）──────────────────────────────────────
  // 宿主行状态（`/inventory` 的 `components`，透传见 loadInventory）在这里读**一次**，之后
  // 经 ctx 传进各渲染器（渲染器不得直接读 selection）；判定只有一处实现 —— 本文件的
  // `weComponentVisible`。可见页签表（D3① 的"页签安全"）另见 visiblePickerTabs。
  const components = sel.inventory && sel.inventory.components;
  const visibleTabs = visiblePickerTabs();
  // 视频类壁纸（原生视频 + 内嵌 MP4 场景）: 只有它们有
  // 「真实播放态」的概念。实时渲染（live iframe）形态必须排除在外：它没有
  // <video> 元素可回写真实状态，且 sceneVideo 在 live 形态下非空（降级备用），
  // 沿用视频类判定会让 playbackLive 恒为 videoPlaying=true —— 「暂停」后按钮
  // 永不变「播放」（实测）。
  const isLiveScene = (sel.type === "scene" || sel.type === "web") && liveRenderEnabled(sel);
  const isVideoLike = !isLiveScene && (sel.type === "video"
    || (sel.type === "scene" && Boolean(sel.sceneVideo)));
  // 卡片上显示/按钮用的播放态: 视频类壁纸以 <video> 元素的真实状态为准。
  // 意图为「播放」但元素被拒/解码失败时，面板必须说「已暂停」并把按钮显示成
  // 「播放」，否则用户面对一张冻住的壁纸却只有「暂停」可点 —— 没有「继续」。
  const playbackLive = isVideoLike ? sel.videoPlaying : sel.playing;
  // 播放/暂停 / 音轨 / 音量 / 关闭 / 轮播切换 / 换列表：处理器见「播放控制处理器」段
  //（快捷播放面板共用同一份实现）。

  // 画面滑块（暗化 / 壁纸透明度 / 壁纸模糊 / 亮度 / 对比度 / 饱和度）与外观细调
  //（配色 / 玻璃颜色 / 玻璃透明度 / 边框 / 雾化）：处理器见「外观 / 画面处理器」段
  //（快捷播放面板共用同一份实现）。
  // 主题随壁纸的开关处理器同「外观 / 画面处理器」段。

  // 出图来源：当前场景壁纸在「自动 ⇄ 自定义画面」之间切换（按壁纸记忆）。
  // 只有一档可切（没导入自定义画面）时**不动** —— 避免"点了没反应"。
  const onRefreshFrame = () => {
    if (sel.type !== "scene" || !sel.sceneFrameUrl) return;
    const wid = String(sel.id);
    const total = frameVariantCount(sel, wid);
    if (total < 2) return;
    // 推进**下标**、存**档位值**：值域有洞（0 与 4），取模会造出 1/2/3 这种退役档位。
    const cur = Number(sel.frameVariants && sel.frameVariants[wid]) || 0;
    const idx = Math.max(0, FRAME_VARIANTS.findIndex((f) => f.id === cur));
    const next = FRAME_VARIANTS[(idx + 1) % total].id;
    const map = Object.assign({}, selection.frameVariants || {});
    map[wid] = next;
    selection.frameVariants = map;
    // 切换作用于出图来源：把层切到该档的画面。
    setSetting("url", frameUrlWithVariant(sel.sceneFrameUrl, next)); syncLayers(); emit();
  };
  // 清除 GPU 抓帧缓存（<key>_gpu.png）：按用户决策 GPU 帧优先于全部档位，
  // 所以「切档位 / 换回 CPU 生成画面」的前置动作就是先删掉它。删除后立刻按
  // 当前档位重挂静态帧（scene-frame 响应带 no-store，重挂即重新取图）。
  const onClearGpuFrame = () => {
    if (sel.type !== "scene" || !sel.sceneFrameUrl || gpuFrameUi.busy) return;
    const wid = String(sel.id || "");
    const token = gpuFrameToken(sel.sceneFrameUrl);
    if (!wid || !token) return;
    gpuFrameUi.wid = wid;
    gpuFrameUi.busy = true;
    emit();
    // 清除 = 删主帧（单主帧语义）。这是共享资源：清掉后其他窗口在下一次回填点
    // 各自按自己的画布尺寸重抓——与旧单槽时代一致，用户显式点「清除」即此意。
    apiDelete("/scene-frame-cache/" + encodeURIComponent(token), { parse: true })
      .then((r) => {
        // 真·失败只有一种：宿主 500（unlink 被权限/占用挡住）。`removed:false`
        //（200）= 主帧本来就没有 —— 目标态已达成，按成功走：探测读数本来就说
        // 没有帧，两面一致。
        if (!r.ok) {
          gpuFrameUi.busy = false;
          gpuFrameUi.error = weT("清除失败：宿主返回 {status}", { status: r.status });
          emit();
          return;
        }
        gpuFrameUi.error = "";
        markGpuFrameProbed(wid, false);
        forgetGpuFramePin(token);
        // 请求期间用户可能已经切走：槽位状态属于发起时那张壁纸，URL 重写/渲染恢复
        // 只对「还是它」的情况做（同 A4 的身份校验；否则会把当前壁纸的 URL 改写成
        // 「当前帧 URL + 旧壁纸的档位」→ 画面与面板读数不一致）。
        if (String(selection.id || "") !== wid) { gpuFrameUi.busy = false; emit(); return; }
        gpuFrameUi.busy = false;
        const variant = Number(selection.frameVariants && selection.frameVariants[wid]) || 0;
        setSetting("url", frameUrlWithVariant(sel.sceneFrameUrl, variant)); syncLayers(); emit();
      })
      .catch(() => {
        gpuFrameUi.busy = false;
        gpuFrameUi.error = weT("清除失败：请求未完成");
        emit();
      });
  };
  // 「重新截」：实时渲染**开着时也要能用** —— GPU 实时帧就是切换途中 / live 首帧
  // 之前给用户看的那张静帧，构图或时机不对时（黑帧、旧视口、切走时那张）用户必须
  // 能立刻重抓，而不是先关掉实时渲染再回来。
  // 走的是自动回填那条同一条安全路径（先抓帧 + 内容门禁 → 成功后才清旧帧 → PUT），
  // 所以抓不到时**不会**把原来那张删掉；失败原因直接显示在面板上。
  const onRecaptureGpuFrame = () => {
    if (sel.type !== "scene" || !sel.sceneFrameUrl || gpuFrameUi.recapturing) return;
    const live = currentLiveFrame();
    if (!live) {
      gpuFrameUi.error = weT("拿不到实时画面（实时渲染没在运行）→ 想抓实时帧请先开「场景实时渲染」");
      emit();
      return;
    }
    gpuFrameUi.recapturing = true;
    gpuFrameUi.error = "";
    emit();
    // force：即使槽里已有 GPU 帧也重抓一张（用户显式要求换一张）。
    scheduleLiveFrameBackfill(live, { force: true });
  };
  const onCustomFrameFile = (e) => {
    const file = e.target.files && e.target.files[0];
    try { e.target.value = ""; } catch { /* ignore */ }
    if (!file || sel.type !== "scene" || !sel.id) return;
    const wid = String(sel.id);
    const ctype = (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp")
      ? file.type : "image/png";
    apiFetch("/custom-frame/" + encodeURIComponent(wid), {
      method: "POST",
      headers: { "Content-Type": ctype },
      body: file,
    }).then((r) => {
      if (!r.ok) throw new Error("宿主返回 " + r.status);
      setCustomFrameLocal(wid, true);
      const map = Object.assign({}, selection.frameVariants || {});
      map[wid] = 4;
      selection.frameVariants = map;
      // 上传可能花掉秒级（截屏多 MB）：期间用户切走就只记账到发起时那张壁纸，
      // 不改当前壁纸的 URL（否则当前壁纸会被套上旧壁纸的档位 4）。
      if (String(selection.id || "") !== wid) { persistSelection(); emit(); return; }
      // 落盘只能挂在这条分支上（不能挂在下面那个 `if` 里）：`setSetting("url", …)` 只在有
      // `sceneFrameUrl` 时才发，而上面刚写的 `customFrames` / `frameVariants` 是**客户端持久化字段**
      // —— 漏掉 persist 就是"导入的自定义画面刷新后不见了"（同族缺陷的另一头）。
      if (sel.sceneFrameUrl) setSetting("url", frameUrlWithVariant(sel.sceneFrameUrl, 4));
      else persistSelection();
      syncLayers(); emit();
    }).catch(() => { /* 导入失败保持现状 */ });
  };
  const onClearCustomFrame = () => {
    if (!sel.id) return;
    const wid = String(sel.id);
    apiDelete("/custom-frame/" + encodeURIComponent(wid))
      .then((r) => {
        if (!r.ok) throw new Error("宿主返回 " + r.status);
        setCustomFrameLocal(wid, false);
        const map = Object.assign({}, selection.frameVariants || {});
        const cur = Number(map[wid]) || 0;
        if (cur === 4) map[wid] = 0;
        selection.frameVariants = map;
        if (String(selection.id || "") !== wid) { persistSelection(); emit(); return; }
        if (cur === 4 && sel.sceneFrameUrl) {
          setTransient("url", frameUrlWithVariant(sel.sceneFrameUrl, 0));
          syncLayers();
        }
        persistSelection(); emit();
      }).catch(() => { /* ignore */ });
  };

  // ESC anywhere closes the library view. Capture phase + stopPropagation so the
  // shell's own ESC handling (which may close the whole settings panel) never
  // sees the key while the view is open.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && selection.pickerOpen) {
        e.stopPropagation();
        closePicker();
      }
    };
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("keydown", onKey, true);
      return () => { window.removeEventListener("keydown", onKey, true); };
    }
  }, []);

  // ── 页签状态：调节面板分六个页签（壁纸库/外观/播放/系统/扩展/关于 —— 前四个由原六域
  //    合并，「扩展」「关于」后加），每份实例独立记忆（设置页与仓库抽屉互不影响）；只存
  //    localStorage，不进 config.json。useState 必须在下方早退分支之前调用（Rules of Hooks）。 ──
  const [activeTab, setActiveTab] = React.useState(() => resolvePickerTab(readSavedPickerTab()));
  const switchTab = (id) => {
    // 校验走**可见页签表**（不是 PICKER_TABS）：子包浏览器半边缺席时被 gate 掉的页签不该再能被
    // 切进去（那正是"点进一块空面板"的来源）。
    if (!visibleTabs.some((t) => t.id === id) || id === activeTab) return;
    // 切页签 ⇒ 清掉待确认（不变量 3）：问句行随页签一起离屏，不能留着它等回来。
    disarmConfirm();
    // 下钻的库视图也随页签一起退出：否则切走再切回来，看到的还是库而不是该页内容。
    if (selection.pickerOpen) setTransient("pickerOpen", false);
    setTransient("pickerDraft", false);
    // 「关于」页才去问 star 数（TTL 内是空操作）：别的页签一次网络都不发。
    if (id === "about") loadStarCount(false);
    setActiveTab(id);
    try { localStorage.setItem(PICKER_TAB_KEY, id); } catch { /* ignore */ }
  };
  // 停在「关于」页刷新页面这条路径不走 switchTab（activeTab 直接从 localStorage 读出来），
  // 用一次订阅式 effect 补上；TTL 同日历口径，重复触发是空操作。
  React.useEffect(() => { if (activeTab === "about") loadStarCount(false); }, [activeTab]);

  // 页签安全（ADR-0013 D3① + D-6(b)）：可见页签表变了（面板节注册表变化 / 组件行状态随
  // inventory 轮询回到本地）而当前页签不在表里 ⇒ 回落到第一个可见页签，自愈、不用用户自己点走。
  // 表为空（空表意味着一个页签都没有，理论不可达）时什么都不做 —— 绝不把 activeTab 设成空值。
  // deps 用 `[activeTab, components]`：`visibleTabs` 每次渲染都是新数组，拿它当依赖会每帧触发；
  // 而 `components` 只在 inventory 重新落地时换引用（`setTransient("inventory", next)`）。
  // 注册表变更是"只增"（子包浏览器半边求值时登记，没有反注册 API）⇒ 可见集只会变大，晚到的节
  // 最多让某页签从"缺席"变"可见"，不会把已选中的页签挤出表 ⇒ 不需要把注册表版本写进依赖。
  React.useEffect(() => {
    if (!visibleTabs.length || visibleTabs.some((t) => t.id === activeTab)) return;
    switchTab(visibleTabs[0].id);
  }, [activeTab, components]);

  // ── 外观页各节的折叠态（本档 = 设置页）──────────────────────────────────────────
  //    用户口径（二次修订）：「设置页则是**全部开启**但也支持隐藏」⇒
  //    下面五个门在本档**默认都展开**，但每个都能点节头收起（与侧边栏同一套构件）。
  //    与侧边栏那一侧同序：细节 / 玻璃 UI / 侧边栏圆角 / 全局 UI 配色 / 全局字体。
  //    hook 必须在早退分支之前调用（Rules of Hooks），与 activeTab 相邻。
  const [pickerFontOpen, setPickerFontOpen] = React.useState(readSavedPickerFontOpen);
  const togglePickerFontSection = () => {
    setPickerFontOpen((prev) => {
      const next = !prev;
      writeSavedPickerFontOpen(next);
      return next;
    });
  };
  const [pickerUiColorOpen, setPickerUiColorOpen] = React.useState(readSavedPickerUiColorOpen);
  const togglePickerUiColorSection = () => {
    setPickerUiColorOpen((prev) => {
      const next = !prev;
      writeSavedPickerUiColorOpen(next);
      return next;
    });
  };
  // 「细节 / 玻璃 UI / 侧边栏圆角」三节（二次修订：设置页也支持隐藏）。
  // ⚠️ 与上面两个同形，但三者共用一条读法（都默认展开）—— 所以抽成一个**自定义 hook**
  //    生成，避免把同一段"读-写-翻转"抄三遍（抄三遍就一定会有一处漏写 localStorage）。
  //    名字必须以 `use` 开头：它内部调 `React.useState`，React 的规则要求 hook 只能从
  //    组件或**另一个 hook** 里以固定顺序调用（三次调用顺序恒定 ⇒ 合法）。
  const usePickerSectionOpen = (key) => {
    const [open, setOpen] = React.useState(() => readSavedPickerOpen(key));
    const toggle = () => setOpen((prev) => {
      const next = !prev;
      writeSavedPickerOpen(key, next);
      return next;
    });
    return [open, toggle];
  };
  const [pickerDetailOpen, togglePickerDetailSection] = usePickerSectionOpen(PICKER_DETAIL_OPEN_KEY);
  const [pickerGlassUiOpen, togglePickerGlassUiSection] = usePickerSectionOpen(PICKER_GLASS_UI_OPEN_KEY);
  const [pickerCornersOpen, togglePickerCornersSection] = usePickerSectionOpen(PICKER_CORNERS_OPEN_KEY);
  const [pickerPresetsOpen, togglePickerPresetsSection] = usePickerSectionOpen(PICKER_PRESETS_OPEN_KEY);

  // 本机字体清单的触发点**两处都有**（三次修订）：字体节回到设置页之后，
  // 这里也要一份 —— 否则「全局字族」那排下拉在本档是空的死旋钮（清单由宿主现扫描）。
  // 三条门与侧栏那侧同形：停在外观页 + 字体节展开 + 字体自定义打开；TTL 内是空操作。
  React.useEffect(() => {
    if (activeTab === "appearance" && pickerFontOpen && sel.fontCustom) ensureSystemFonts(false);
  }, [activeTab, pickerFontOpen, sel.fontCustom]);

  // 侧栏深链（快捷播放面板底栏的「更多外观设置 ›」/「更多播放设置 ›」）：请求"打开
  // 设置页后停在哪一页"。打开对话框由 src/ui/sidebar-right.js 的 DOM 路径负责，这里只管
  // 落地 —— 走**同一个 switchTab**（清待确认 / 退出下钻 / 写 localStorage 这些副作用
  // 一处不落），落地后把请求清掉（一次性；否则用户几分钟后自己开设置会被旧请求劫持）。
  // 组件没挂载时请求就先躺在 store 里，挂载后这一趟 effect 消费它 —— 两条路都覆盖。
  React.useEffect(() => {
    const req = selection.settingsTabRequest;
    if (!req) return;
    if (req === activeTab || !visibleTabs.some((t) => t.id === req)) {
      setTransient("settingsTabRequest", "");
      return;
    }
    switchTab(req);
  }, [sel.settingsTabRequest, activeTab]);

  // 库视图虚拟滚动的窗口（机制与几何见 src/picker/picker-modal.js 顶注）：hooks 必须长在组件
  // 里（renderPickerModal 是纯渲染器），经 ctx 传下去。classic CD 架不虚拟化 ⇒ 渲染侧
  // 不把 gridRef 挂到网格上，测量 effect 拿不到元素就整体空转。count 给**上界**（正常 /
  // 隐藏两个列表 + 关闭卡都 ≤ 库存 + 1；无滚动容器时窗口 = count，渲染侧按真实列表
  // 长度钳），viewTag 戳这份窗口量自哪个形态 —— 换形态 / 开关下钻的一帧按未测量处理
  // （首窗 + 零占位），测量 effect 随 tag 进 deps 立刻跟上。
  const pickerGridRef = React.useRef(null);
  const pickerRootRef = React.useRef(null);
  // ── 吉祥物 3D 环的「面板宽度」（「左右拉宽、顶格」）──────────────────────
  // 环要随可用宽度等比放大才填得满，而**渲染器是纯函数、拿不到宽度** ⇒ 在这里量一次、
  // 经 ctx 的 `paneWidth` 传下去（渲染器量不到时退回 scale=1，见 panel-tabs 的 SCALE）。
  // 量的是**环那一行的可用宽度**（`.we-picker__mascot-carousel` 是 width:100% 的 flex 行，
  // 它的宽度不随窗口的 max-width 变 ⇒ 拿它当"可用宽度"不会自我指涉）。
  // ⚠️ 这个控件住在**系统**页签（不是外观）⇒ deps 用 `activeTab`，切到系统页时重量一次；
  //   只在挂载时量会让"先开壁纸页再切系统页"永远停在 scale=1（**实测踩过**）。
  // ⚠️ 元素**不存在时不更新**（而不是写 0）：别的页签上根本没有这个元素，写 0 会白白触发
  //   一次重渲染；到了系统页自然会重量到真值。
  const [paneW, setPaneW] = React.useState(0);
  React.useEffect(() => {
    const root = pickerRootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const el = root.querySelector(".we-picker__mascot-carousel");
      if (!el || !el.clientWidth) return;                 // 本页签没画它 ⇒ 保持原值
      const w = el.clientWidth;
      // 容差 2px：避免亚像素抖动把整棵面板反复重渲染。
      setPaneW((prev) => (Math.abs(prev - w) < 2 ? prev : w));
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeTab]);
  const pickerViewTag = sel.pickerOpen
    ? (sel.modalView === "hidden" ? "hidden" : (sel.pickerDraft ? "draft" : "normal"))
    : "closed";
  const pickerVwin = qpVirtWindow(pickerGridRef, (sel.inventory.wallpapers || []).length + 1,
    PICKER_CARD_H, PICKER_CARD_GAP, true, pickerViewTag);

  if (!sel.loaded) {
    return React.createElement("div", { className: "we-picker" },
      React.createElement("span", { className: "we-picker__hint" }, weT("扫描 Wallpaper Engine…")));
  }
  if (sel.inventory.error) {
    return React.createElement("div", { className: "we-picker" },
      React.createElement("div", { className: "we-picker__error" },
        weT("未检测到 Wallpaper Engine：{error}", { error: weT(sel.inventory.error) })),
      React.createElement("button", {
        className: "we-picker__btn", type: "button", onClick: onRefresh, disabled: sel.loading,
      }, sel.loading ? weT("刷新中…") : weT("重试")));
  }

  const list = sel.inventory.wallpapers;
  // WE「已安装」文件夹：摊平成一维选项（层级用 depth 表达），并取当前选中夹子的成员集。
  // 选中的夹子**已经不在**宿主清单里（用户在 WE 里删了/改名了）⇒ 按「全部」处理 ——
  // 否则下拉会停在一个不存在的 id 上、网格永远空着，而用户看不出是为什么。
  const folderOptions = flattenWallpaperFolders(sel.inventory.folders, 0, []);
  const activeFolder = folderOptions.find((folder) => folder.id === sel.folderFilter) || null;
  const folderFilter = activeFolder ? activeFolder.id : "all";
  const folderWallpaperIds = activeFolder ? activeFolder.wallpaperIds : null;
  // 派生数据 + 分页全部由 **src/picker/picker-model.js** 算（`pickerModel`）：可播放网格、两个
  // 过滤下拉的分档计数、隐藏列表，以及三个列表各自的当页切片。搜索是大小写不敏感的
  // 标题子串匹配（空查询 = 不过滤），每页 24 张，页号越界自动 clamp。这里只把状态喂
  // 进去、把结果取出来 —— 组件体不再就地算这些（分级/类型/隐藏的判定也在那边）。
  const {
    query, playableList, basePlayable, ratingCounts, typeCounts, orientationCounts, hiddenList,
    editorPageView,
  } = pickerModel({
    wallpapers: list,
    hiddenIds: selection.hiddenIds,
    search: sel.search,
    ratingFilter: sel.contentRatingFilter,
    typeFilter: sel.typeFilter,
    folderFilter,
    folderWallpaperIds,
    orientationFilter: sel.orientationFilter,
    editorPage: sel.editorPage,
  });
  // CD-rack mode: compact one-page grid (no pagination, no virtualization —
  // aspect-ratio cards with overlapping rows don't fit the fixed-pitch model).
  const cdMode = sel.pickerLayout === "classic";
  const current = list.find((w) => w.id === sel.id) || null;
  const uploadedList = list.filter((w) => isUploadedWallpaper(w) && !isDirWallpaper(w));
  const groups = sel.rotationGroups;
  const group = activeRotationGroup();
  const candidates = rotationCandidates();
  const playableCount = candidates.length;
  const editing = sel.editing;

  // ── 壁纸属性面板的接线────────────────────────────────────
  // 面板标记搬去了 `src/picker/picker-props-panel.js`（构建期内联回本作用域）。这里只做**组装**：
  // 面板状态（开关 / token / 加载态 / 错误 / 属性表 / 实时渲染是否接管）与三个动作
  // （该重拉时重拉、改一个属性、恢复默认）都留在本文件 —— 状态与处理器是 ctx 的**供给方**，
  // 渲染器只拿值 + 回调（同模态框那条契约）。判定就一句：
  // token 变了且不在加载中才重拉。
  // ── 页签面板内容（函数声明提升，renderActiveTab 在 return 里先调用）──────
  // 六页签 = 三个单渲染器（「外观」「扩展」「关于」）+ 两个合并渲染器（「播放」= 效果 + 声音，
  // 「系统」= 吉祥物 + 高级）+ 壁纸库。「关于」除组件行状态外不取任何 ctx 字段（其余是静态
  // 内容）；「扩展」只取 `onResetModule` 与组件行状态，其余整包转交给注册表里的模块（每个
  // 模块的控件由它自己的渲染器画）。
  // 组件行状态面（ADR-0013 D3②）：**经 ctx 传进渲染器**（渲染器不得直接读 selection）；
  // 判定本身只有一处实现 —— 本文件的 `weComponentVisible(components, name)`。
  // `components` 在本组件体上方读了一次，这里只是把它塞进各渲染器的 ctx。
  const extensionCtx = () => ({
    components,
    sel: selection,
    onPerfEnabled, onPerfFloatToggle,
    onFxEnabled, onFxClick, onFxClickStyle, onFxClickSize, onFxClickGlow,
    onFxTrail, onFxTrailStyle, onFxTrailLength, onFxTrailWidth, onFxTrailGlow,
    onFxOpacity, onFxBlend, onFxColorMode, onFxColor,
    onParallaxEnabled, onParallaxBg, onParallaxMascot, onParallaxUi, onParallaxSmooth,
    onParallaxPlugin,
    onParallaxUiChatDepth, onParallaxUiComposerDepth, onParallaxUiSidebarDepth, onParallaxUiBubbleDepth,
    onParallaxPluginDepth,
    // 认到的插件槽位（用户口径 m02697-②）：只给**槽键字符串**（画一行一个）。发现逻辑在
    // packages/parallax/src/parallax-layer.js（与层自己每帧扫的是同一份名单），这里只是转交；
    // P-A 起问的是**注册表**（`weDiscoveredGroupsOf`）—— 那一层住在自己的包里，本 bundle 的
    // 作用域里既没有它的函数名也不该有（没有这层 / 没声明就是空数组，不是 undefined）。
    // **插件前端那一块自己的开关**（用户诉求 m03549）关着时层也不认它们，面板就跟着空 ——
    // 名单与"真的会动"必须同源，否则会出现点了没反应的滑杆。它与「界面元素跟随」互不依赖。
    parallaxPluginSlots: sel.parallaxPlugin === true ? weDiscoveredGroupsOf('parallax').sort() : [],
    onAvatarEnabled, onAvatarSize, onAvatarRadius, onAvatarAiRepeatRows, onAvatarPick, onAvatarClear,
    // 上传裁切（issue #191 问题 1）：几何在这里现算（唯一实现），渲染器只读结果。
    onAvatarCropZoom, onAvatarCropDrag, onAvatarCropWheel, onAvatarCropConfirm, onAvatarCropCancel: closeAvatarCrop,
    avatarCropGeo: avatarCropGeometry(), avatarCropView: AVATAR_CROP_VIEW,
    // 超限拦截（#185 后续）：面板画提示行 + 「自动压缩后导入」按钮，处理器在 client 这一侧。
    onAvatarAutoCompress,
    // 模块级重置（issue #192）：各模块头的 ↺ 把该模块的键整批写回默认值。
    onResetModule,
  });
  const renderActiveTab = () => {
    if (activeTab === "about") return renderAboutTab({
      components,
      // 「重新查看本版更新公告」的落点：立请求位 + emit 让 `UpdateNotice` 重渲染。
      // 不变量：这两个动作必须留在本文件这一侧 —— `renderAboutTab` 体内不许出现
      // `setSetting(` / 字面 `emit(` / `apiJson|apiFetch(`（判据见 test/verify-about.mjs），
      // 所以那条腿只调这个回调。请求位由 `UpdateNotice.dismiss()` 清。
      onReopenNotice: () => { noticeReopenRequest = true; emit(); },
    });
    if (activeTab === "extensions") return renderExtensionsTab(extensionCtx());
    if (activeTab === "appearance") return renderAppearanceTab({
      setSetting, setTransient,
      fontSet: fontSetCtx(),
      glassPresets: glassPresetCtx(),
      // 「全局字体」节的折叠态（ADR-0008 D4 三次修订）：设置页也画那一节 ⇒ 本档自己一份
      // 开合状态（picker-font-open），展开后字体清单由上面的 effect 去要。
      fontOpen: pickerFontOpen, onToggleFontSection: togglePickerFontSection,
      // 「全局 UI 配色」节（含原「输入光标」节的光标颜色行）：同样本档自己一份开合状态；
      // 处理器是模块级的（onAccent / onCaretColor / onToggleUiColorCustom / onUiColorElement）。
      uiColorOpen: pickerUiColorOpen, onToggleUiColorSection: togglePickerUiColorSection,
      onToggleUiColorCustom, onUiColorElement,
      onGlassSurfacePolicy, surfaceStatus: weGlassSurfaceStatus(),
      officialColorOf, onAccent, onCapsuleBlur, onCapsuleColor, onBlur, onBorder, onCaretColor, onChatGlassFidelity, onComponentFamily, onComponentFont, onExtraGlassSelectors, onFontAdvanced, onFontResetAll, onGlassAlpha, onGlassMaskStrength, onGlassColor, onGlassDarkSeparate, onGlassFidelity, onGlassSheenStrength, onGlobalFamily, onLeftSidebarGlass, onTitlebarGlass, onRefreshSystemFonts, onSidebarAlpha, onSidebarBlur, onSidebarColor, onSidebarContentAlpha, onSidebarContentColor, onSidebarCornerRadius, onSidebarCornerSquare, onSidebarFollowGlobal, onSidebarGlass, onSidebarFullClear, onFloaterSolidBase, onMarketStickyClip, onMarketStickyFade, onThemeColor, onThemeColorClear, onThemeDarkSeparate, onThemeFamily, onThemeSize, onThemeTypeOnly, onThemeWeight, onThinkingMode, onTableReadability, onToggleFontCustom, onToggleThemeFollow, sel,
      // 玻璃 UI 子项开关 + 独立配置 + 独立参数（见 onToggleChildIndependent 那段注释）
      onToggleChildIndependent, onGlassChildParam, childIndependentOn,
      // 二次修订：设置页也**支持隐藏**这几节（默认全展开）——
      // 「细节 / 玻璃 UI / 侧边栏圆角」三个门是本档新增的，与「全局 UI 配色 / 全局字体」
      // 那两个同形。顺序与侧边栏同序（两侧都走 renderAppearanceTab 这一处装配）。
      // 「主题预设」：与其他节同口径升折叠节 —— 只在设置页画 ⇒ 没有侧栏半边。
      detailOpen: pickerDetailOpen, onToggleDetailSection: togglePickerDetailSection,
      glassUiOpen: pickerGlassUiOpen, onToggleGlassUiSection: togglePickerGlassUiSection,
      cornersOpen: pickerCornersOpen, onToggleCornersSection: togglePickerCornersSection,
      // 模块级重置（issue #192）：外观页签下每个模块（主题 / 细节 / 玻璃 UI / 侧边栏圆角 /
      // 全局 UI 配色 / 全局字体）节头右端各一枚 ↺。
      onResetModule,
      presetsOpen: pickerPresetsOpen, onTogglePresetsSection: togglePickerPresetsSection,
    });
    if (activeTab === "playback") return React.createElement(React.Fragment, null,
      renderEffectsTab({
        setSetting, setTransient,
        onBackgroundBrightness, onBackgroundContrast, onBackgroundSaturate, onClearCustomFrame, onClearGpuFrame, onCustomFrameFile, onFlip, onFpsCap, onLayerPositionX, onLayerPositionY, onLayerReset, onLayerScale, onLiveBootDelay, onObjectFit, onOpenPicker, onPlaybackRate, onRecaptureGpuFrame, onRefreshFrame, onSceneAutoQuality, onSceneSoftRenderPause, onSceneLiveFps, onScrim, onToggleSceneLive, onWallpaperBlur, onWallpaperOpacity, sel, setPickerOpener,
      }),
      renderAudioTab({
        setSetting, setTransient,
        onToggleAudio, onVideoVolume, sel,
      }),
    );
    if (activeTab === "system") return React.createElement(React.Fragment, null,
      renderMascotTab({
        components,
        onMascotClear, onMascotPick, onRopeFormChange, onMascotFormConfirm, onDisarmConfirm: disarmConfirm, onRopeScaleChange, onRopeVisibilityChange, sel,
        // ⚠️⚠️ 吉祥物环的等比缩放基准**必须接在这一档**（实测「左右拉宽没生效」）：
        //   吉祥物控件由**系统**页签渲染（不是外观页签），我上一轮把它加进了外观档的 ctx
        //   ⇒ 渲染器永远收到 undefined ⇒ scale 恒为 1、拉宽毫无效果。
        //   而当时的判据是**直接调 renderMascotTab**（隔离测试）⇒ 它当然全绿。
        //   教训：隔离测试证明不了"线接上了"；接线必须单独有判据（见 verify-client 的接线判据）。
        paneWidth: paneW,
      }),
      renderAdvancedTab({
        setSetting, setTransient,
        onAdapterTarget, onEdgeCompatChange, onLayoutChange, onPauseOnBattery, onPauseOnBlur, onPauseOnHidden, onToggleLiveDiag, onStartPaused, sel,
        onStartEditCacheDir, onCancelEditCacheDir, onCacheDirDraft,
        onCacheDirBrowseInput, onCacheDirBrowseGo, onCacheDirBrowseEnter, onCacheDirBrowseUp, onPickCacheDir, onCloseCacheDirBrowse,
      }),
    );
    return renderWallpaperTab({
      setSetting, setTransient,
      INTERVALS, armedConfirm: sel.armedConfirm, cdMode, current, editing, editorPageView, group, groups, isLiveScene, onArmConfirm: armConfirm, onArmDeleteGroup, onCancelEditUploadDir, onCancelEditWeAssetsDir, onClear, onDeleteGroup, onDisarmConfirm: disarmConfirm, onEditInterval, onEditName, onEditOrder, onEditTrigger, onGroupChange, onGroupTrigger, onRotationLiveInterval, onPictureSlideSeconds, onOpenPicker, onOpenPickerDraft, onRefresh, onStartEditUploadDir, onStartEditWeAssetsDir, onSwitchTransition, onSwitchTransitionDir, onSwitchTransitionSpeed, onToggleAudio, onTogglePlay, onTogglePropsPanel, onToggleRotation, onUploadDirDraft, onUrlDraft, addUrlWallpaper, addBingWallpaper, refreshUrlWallpaper, onWeAssetsDirDraft, pagerRow, playableCount, playableList, playbackLive, propsPanelOpen, renderUserPropsPanel, sel, setPickerOpener, uploadedList,
    });
  };
  const tabIdx = Math.max(0, visibleTabs.findIndex((t) => t.id === activeTab));

  return React.createElement("div", { className: "we-picker", "data-we-cards": sel.pickerLayout, ref: pickerRootRef },
    // ── Card header (mirrors the skin-center's pluginCard header): plugin
    //    name + live wallpaper count badge + description. ──
    React.createElement("div", { className: "we-picker__card-head" },
      React.createElement("span", { className: "we-picker__card-name" }, weT("壁纸引擎")),
      React.createElement("span", { className: "we-picker__card-badge" }, String(playableList.length)),
      React.createElement("span", { className: "we-picker__card-desc" }, weT("本地 Wallpaper Engine 壁纸 · 液态玻璃主题")),
    ),
    // ── 页签栏（分段式）：六个页签互斥展示，替代三十控件的单列长滚动。
    //    指示胶囊随 activeTab 平移（transform 合成器属性，不引发布局）；宽度按
    //    **可见页签表**的长度现算 ⇒ 加页签只改那张表、组件行关闭只改可见性，这里零改动。 ──
    React.createElement("div", { className: "we-tabs", role: "tablist", "aria-label": weT("壁纸引擎设置分区") },
      React.createElement("span", {
        className: "we-tabs__pill",
        "aria-hidden": "true",
        style: {
          width: "calc((100% - 6px) / " + visibleTabs.length + ")",
          transform: "translateX(" + tabIdx * 100 + "%)",
        },
      }),
      visibleTabs.map((t) => React.createElement("button", {
        key: t.id,
        type: "button",
        role: "tab",
        "aria-selected": activeTab === t.id ? "true" : "false",
        className: "we-tabs__tab" + (activeTab === t.id ? " we-tabs__tab--active" : ""),
        onClick: () => switchTab(t.id),
      }, t.label)),
    ),
    React.createElement("div", { className: "we-tabpanel", role: "tabpanel" },
      // 库视图是**页内下钻**：pickerOpen 时页签面板整区切换成
      // 壁纸网格，ESC / 顶部「返回」退出，切页签也会退出（见 switchTab）。
      sel.pickerOpen ? renderPickerModal({
        sel, closePicker, current, playbackLive, playableList, hiddenList,
        cdMode, query, basePlayable, ratingCounts, typeCounts, orientationCounts,
        folderOptions, folderFilter, onFolderFilterChange,        gridRef: pickerGridRef, vwin: pickerVwin,
        armedConfirm: sel.armedConfirm, onArmConfirm: armConfirm, onDisarmConfirm: disarmConfirm,
        onClear, onTogglePlay, onRatingToggle: onRatingFilterToggle, onTypeToggle: onTypeFilterToggle,
        onOrientationChange: onOrientationFilterChange,
        onShowNormalView, onShowHiddenView,
        onToggleBatchMode, onArmBatchHide, onBatchHide, onBatchCancel, onSearchInput, onPickCard,
      }) : React.createElement(React.Fragment, null,
        // 页签内容 → **每个页签末尾一个重置**（issue #192 用户口径：重置指定选项卡）→
        // 全局重置（只在「系统」页签末尾，即设置页里最接近"最底部"的位置）。
        renderActiveTab(),
        renderTabReset({
          armedConfirm: sel.armedConfirm, onArmConfirm: armConfirm,
          onDisarmConfirm: disarmConfirm, onResetTab,
        }, activeTab),
        activeTab === "system"
          ? renderResetSection({
              armedConfirm: sel.armedConfirm, onArmConfirm: armConfirm,
              onDisarmConfirm: disarmConfirm, onResetAll,
            })
          : null,
      )),
  );
}
