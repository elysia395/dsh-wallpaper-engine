/**
 * i18n-copy-core.js — 英文词表域：客户端外壳（src/adapter.js · src/client.js · 更新公告）
 *
 * 本域词条**原样搬自** `src/i18n-copy.js`（拆分属纯搬移：中文键与英文值一行未改、顺序未动）。
 * 组装点在同族的 `src/i18n-copy.js`（composer）；域模块必须排在 composer **之前**登记进
 * `scripts/build-client.mjs` 的 INLINE_MODULES —— 构建期内联进同一工厂作用域，顶层读受 TDZ 约束。
 * 只读不写：纯数据，不得有可执行语句。守卫判据见 `test/verify-i18n.mjs`（族读法 test/tools/src-scope.mjs）。
 */
const WE_I18N_EN_CORE = {
  // ── src/adapter.js ──
  "自动检测": "Auto-detect",
  "原生浏览器": "Plain browser",
  "非官方桌面端": "Third-party desktop shell",
  "官方桌面端": "Official desktop shell",
  "手选了原生浏览器，但宿主观测到能力头栅栏 —— 网页壁纸会 403，请改回自动检测或桌面目标": "Plain browser was selected manually, but the host observed a capability-header gate — Web wallpapers will return 403. Switch back to Auto-detect or a desktop target.",
  "手选目标与检测不一致（检测到：{target}）": "Manually selected target does not match detection (detected: {target})",

  // ── src/client.js ──
  "默认": "Default",
  "雅黑": "Microsoft YaHei",
  "楷体": "KaiTi",
  "宋体": "SimSun",
  "黑体": "SimHei",
  "行楷": "Xingkai",
  "等宽": "Monospace",
  "实时画面": "Live frame",
  "自定义画面": "Custom frame",
  "视频": "Video",
  "网页": "Web",
  "图片": "Image",
  "场景": "Scene",
  "就这么办（不可撤销）": "Do it (cannot be undone)",
  "确认": "Confirm",
  "算了": "Never mind",
  "取消": "Cancel",
  "宿主不可达（请求未完成）": "Host unreachable (request did not complete)",
  "宿主返回 {status}": "Host returned {status}",
  "当前壁纸已不在列表里（可能已被移除或隐藏）": "The current wallpaper is no longer in the list (it may have been removed or hidden)",
  "这张壁纸没有可播放的媒体文件": "This wallpaper has no playable media file",
  "这张壁纸被「内容分级」过滤排除了 —— 把内容分级切回「全部」即可播放": "This wallpaper is excluded by the content rating filter — set Content rating back to All to play it",
  "轮播列表": "Rotation list",
  "硬切": "Hard cut",
  "交叉淡化": "Cross-fade",
  "推移": "Push",
  "擦除": "Wipe",
  "光圈": "Iris",
  "缩放": "Zoom",
  // 壁纸层取景（位置）两行的标签：与 WE 壁纸属性面板里的同名滑条同词。
  "水平": "Horizontal",
  "垂直": "Vertical",
  "整屏百分比偏移：50 = 中心，0/100 = 两端（与 Wallpaper Engine 自带的同名滑条同义）；双击标签回中心。": "Whole-screen percentage offset: 50 = centered, 0/100 = the two ends (same meaning as Wallpaper Engine's slider of the same name); double-click the label to re-center.",
  "100 = 原大小；95 = 缩到 95%（四周露出页面底色）；105 = 放大到 105%；双击标签回 100%。": "100 = original size; 95 = scaled to 95% (the page base colour shows around the edges); 105 = enlarged to 105%; double-click the label to reset to 100%.",
  "条带": "Stripes",
  "快": "Fast",
  "标准": "Normal",
  "慢": "Slow",
  "左": "Left",
  "右": "Right",
  "上": "Up",
  "下": "Down",
  "轮播列表 {index}": "Rotation list {index}",
  "仅支持 JPG / PNG 图片与 MP4 视频": "Only JPG / PNG images and MP4 videos are supported",
  "文件扩展名需为 .jpg / .png / .mp4": "File extension must be .jpg / .png / .mp4",
  "已存在相同内容的壁纸，已直接选择原有的那张": "A wallpaper with identical content already exists; the existing one was selected instead",
  "上传失败：{error}": "Upload failed: {error}",
  "移除失败：{error}": "Remove failed: {error}",
  "请输入存储位置路径": "Enter a storage location path",
  "更改失败：{error}": "Change failed: {error}",
  "保存失败：{error}": "Save failed: {error}",
  "标签页隐藏(pauseOnHidden)": "Tab hidden (pauseOnHidden)",
  "窗口失焦(pauseOnBlur)": "Window unfocused (pauseOnBlur)",
  "窗口被完全遮挡(pauseOnOcclusion)": "Window fully occluded (pauseOnOcclusion)",
  "电池供电(pauseOnBattery)": "On battery (pauseOnBattery)",
  "用户暂停": "Paused by user",
  "浏览器无法解码这段视频（自上传建议改用 H.264 编码的 MP4）": "The browser cannot decode this video (for your own uploads, use an H.264-encoded MP4)",
  "视频解码失败（文件可能已损坏）": "Video decoding failed (the file may be corrupted)",
  "视频读取失败（文件可能已被移动或删除）": "Video could not be read (the file may have been moved or deleted)",
  "视频加载失败": "Video failed to load",
  "浏览器拒绝了播放请求": "The browser refused the play request",
  "(同 key)": "(same key)",
  "壁纸库": "Library",
  "外观": "Appearance",
  "播放": "Playback",
  "play\u0000播放": "Play",
  "系统": "System",
  "扩展": "Extensions",
  "自定义{label}": "Custom {label}",
  "自定义": "Custom",
  "未选择壁纸": "No wallpaper selected",
  "我的字体集": "My font set",
  "清除失败：宿主返回 {status}": "Clear failed: host returned {status}",
  "清除失败：请求未完成": "Clear failed: request did not complete",
  "拿不到实时画面（实时渲染没在运行）→ 想抓实时帧请先开「场景实时渲染」": "No live frame available (live rendering is not running) → to capture a live frame, turn on \"Scene live rendering\" first",
  "扫描 Wallpaper Engine…": "Scanning for Wallpaper Engine…",
  "未检测到 Wallpaper Engine：{error}": "Wallpaper Engine not detected: {error}",
  "刷新中…": "Refreshing…",
  "重试": "Retry",
  "共 {count} 个 · 第 {page} / {pages} 页": "Total {count} wallpapers · page {page} / {pages}",
  "‹ 上一页": "‹ Previous",
  "下一页 ›": "Next ›",
  "壁纸引擎": "Wallpaper Engine",
  "本地 Wallpaper Engine 壁纸 · 液态玻璃主题": "Local Wallpaper Engine wallpapers · liquid glass theme",
  "壁纸引擎设置分区": "Wallpaper Engine settings sections",
  "菲比啾比": "Phoebe Jiubi",
  // ⚠️ **八只「模型娘」的名字刻意不进词表**。原因不是"忘了翻"，而是本仓 i18n 的
  //    模型：真源是**中文**，扫描器 `test/tools/i18n-scan.mjs` 的 `scanCjkStrings` 只提取
  //    **含中日韩字符**的字面量 —— 纯 ASCII 的名字（Claude / DeepSeek / …）压根不进这条管线，
  //    加进词表反而会被「零孤儿键」判据判成多余词条（实测：一次红 8 条）。
  //    `ROPE_FORMS` 里仍写 `weT("Claude")`：查不到就**原样返回**，正好是要的结果；
  //    留着 weT 是为了与其余形态标签走同一条取值路径（将来真要翻也有唯一入口）。
  "壁纸库拉绳：沿顶部拖动移动位置，向下拉打开壁纸库面板": "Library pull-cord: drag along the top to move it, pull down to open the Library panel",
  "壁纸库 · 沿顶部拖动 / 向下拉打开": "Library · drag along the top / pull down to open",
  "壁纸库面板": "Library panel",
  "收起": "Collapse",
  "角色": "role",
  "组件": "component",
  "字体集": "font set",
  // ── 更新公告（旧清单条目退役；正文三条见 i18n-copy-ext.js）──
  "知道了": "Got it",

};

export { WE_I18N_EN_CORE };
