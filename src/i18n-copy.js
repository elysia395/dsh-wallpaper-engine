/**
 * i18n-copy.js — 英文词表（**中文原文 → 英文**；键就是界面上的原文，见 src/i18n.js 的设计说明）。
 *
 * 两份表，各有各的守卫判据：
 *   · `WE_I18N_EN`      —— 客户端文案。键集必须与 `src/**` 里 `weT("…")` 的字面量**双向相等**
 *                          （少一条 = 界面漏译，多一条 = 孤儿键），判据在 test/verify-i18n.mjs。
 *   · `WE_I18N_HOST_EN` —— 宿主文案（`lib/**` 的路由应答体等由客户端显示的字符串）。
 *                          宿主半不认语言，客户端在**显示处**把值再查一次表（`weT(hostText)`）；
 *                          表里没有的键原样露出（渐进式，不炸）。键集必须都能在 `lib/**` 里
 *                          找到同一条字面量（防凭空造句），判据同上。
 *
 * 写作纪律：
 *   · 键逐字复制界面原文（含全角标点、空格、emoji），改中文原文 = 改键（旧键变孤儿，守卫会红）。
 *   · 值里不得出现中文；`{name}` 占位符必须与键里的集合**相等**（守卫逐条比对）。
 *   · 品牌与代码标识不译：DSH / DeepSeek Harness / Wallpaper Engine / WebWallGL / Edge /
 *     JPG / PNG / MP4 / project.json / `--dsl-*` / `GET /wallpaper-engine/…` 等原样保留。
 *   · 只读不写：本文件是词表的**组装点**（构建期内联进 bundle 的工厂作用域），顶层只有常量
 *     声明、无可执行语句；表体按域住在同族的 `src/i18n-copy-*.js` 里（各域文件头写明归属）。
 */

// ── 客户端文案（src/**）──────────────────────────────────────────────────────
// 表体按域拆到同族模块（i18n-copy-core.js · i18n-copy-font.js · i18n-copy-live.js · i18n-copy-panel.js · i18n-copy-picker.js · i18n-copy-ext.js · i18n-copy-glass.js），
// 本文件只按 INLINE_MODULES 顺序展开组装。⚠️ 域模块必须排在 composer 之前（构建期内联进同一
// 作用域，顶层读受 TDZ 约束）；展开顺序 = 键插入序，守卫逐条比对（test/verify-i18n.mjs）。

const WE_I18N_EN = {
  ...WE_I18N_EN_CORE,
  ...WE_I18N_EN_FONT,
  ...WE_I18N_EN_LIVE,
  ...WE_I18N_EN_PANEL,
  ...WE_I18N_EN_PICKER,
  ...WE_I18N_EN_EXT,
  ...WE_I18N_EN_GLASS,
  ...WE_I18N_EN_PET_LINK,
};

// ── 宿主文案（lib/** 里由客户端显示的那些原文）────────────────────────────────


const WE_I18N_HOST_EN = {
  "文件过大（上限 512MB）": "File too large (limit 512MB)",
  "请输入有效的绝对路径（如 D:\\MyWallpapers 或 /data/wallpapers）": "Enter a valid absolute path (e.g. D:\\MyWallpapers or /data/wallpapers)",
  "无法在该路径创建目录（权限不足或路径被占用）": "Cannot create a directory at that path (permission denied or path in use)",
  "字体集文件必须是一个 JSON 对象": "Font set file must be a JSON object",
  "字体集数量已达上限": "Font set limit reached",
  "body 必须是 { name?, values: {…} }（values 必填：清空请显式给 {}）": "Body must be { name?, values: {…} } (values is required: pass {} explicitly to clear it)",
  "不能删除正在使用的字体集（先切换到别的集）": "Cannot delete the font set in use (switch to another set first)",
  "删除失败（文件被占用或权限不足）": "Delete failed (file in use or permission denied)",
  "随包预设不能删除（可以直接覆盖它；要恢复原样就删掉你的覆盖）": "Bundled presets cannot be deleted (you can override it directly; to restore the original, delete your override)",
  "图片过大（上限 30MB）": "Image too large (limit 30MB)",
  "素材目录未配置或不可用": "Asset directory not configured or unavailable",
  "路径非法": "Invalid path",
  "请输入有效的绝对路径（如 D:\\Steam\\steamapps\\common\\wallpaper_engine\\assets 或 ~/WE/assets）": "Enter a valid absolute path (e.g. D:\\Steam\\steamapps\\common\\wallpaper_engine\\assets or ~/WE/assets)",
  "该目录下没有 materials/ 子目录 —— 请指向 WE 安装目录的 assets 树（或其拷贝）": "No materials/ subdirectory in that directory — point to the assets tree under the WE installation directory (or a copy of it)",
  "未知错误": "Unknown error",
  "已在设置中关闭「系统音频反应」": "System audio reaction is disabled in settings",
  "需要 ffmpeg 与 PulseAudio/PipeWire（monitor 源）": "Requires ffmpeg and PulseAudio/PipeWire (monitor source)",
  "未检测到系统音频采集设备：请在「声音设置 → 录制」启用「立体声混音」，或安装 VB-Cable 虚拟声卡后重试（未启用时壁纸回落模拟频谱）": "No system audio capture device detected: enable Stereo Mix in Sound Settings → Recording, or install the VB-Cable virtual audio device and retry (when disabled, the wallpaper falls back to a simulated spectrum)",
  "未找到 Swift 编译器（Xcode Command Line Tools）—— 安装后重试；当前回落模拟频谱": "Swift compiler not found (Xcode Command Line Tools) — install it and retry; falling back to a simulated spectrum for now",
  "未获得「音频录制」权限：请在「系统设置 → 隐私与安全性 → 音频录制」中勾选 DSH Desktop（或你的终端/DSH 宿主），然后重试": "Audio Recording permission not granted: check DSH Desktop (or your terminal/DSH host) in System Settings → Privacy & Security → Audio Recording, then retry",
  "当前平台不支持系统音频采集，回落模拟频谱": "System audio capture is not supported on this platform; falling back to a simulated spectrum",
  "需要 media-control（brew install media-control）": "Requires media-control (brew install media-control)",
  "需要 playerctl（apt/dnf/pacman 安装后重试）": "Requires playerctl (install via apt/dnf/pacman and retry)",
  "Windows 的媒体集成在二期提供": "Windows media integration is planned for phase two",
  // ── 玻璃预设（lib/routes/presets.js）────────────────────────────────────
  "预设名字不能为空": "Preset name cannot be empty",
  "body 必须是 { name, values }": "Body must be { name, values }",
  "预设数量已达上限": "Preset limit reached",
  "已存在同名的预设（换个名字再存）": "A preset with the same name already exists (choose another name)",
  "预设数量已达上限（最多 8 个 —— 删除不需要的预设腾位）": "Preset limit reached (8 max — delete presets you no longer need to free a slot)",

};

export {
  WE_I18N_EN,
  WE_I18N_HOST_EN,
};
