/**
 * 桌宠联动 · 浏览器半自成词表（path B）：面板与扩展卡片的中文原文 → 英文。
 *
 * 为什么需要它：这两个面（panel-params / panel / extension-card）的文案通过**注入的 translator**
 * （`translate()` / `t()`）在运行时翻译；生产端 translator 由 `createPetLinkTranslate` 生成——
 * **先查本表（EN）再回落主包 `weT`**。这样无需改主包 `src/i18n-copy-ext.js`（保住 M7「主包零改动」），
 * 又让英文界面下这些文案有真正生效的译文（不是塞进没人查的表）。
 *
 * 维护：本表的**键 = 源码里出现的中文字面量原文**，值 = 英文。`verify-i18n` 会对这三个 UI 文件做
 * 双向对账（零漏译 / 零孤儿 / EN 值无中文），漏一条补一条即可。
 */
const PETLINK_I18N_EN = {
  'pet 下落时长（毫秒）': 'Pet fall duration (ms)',
  'pet 下落距离（像素，0 关闭）': 'Pet fall distance (px, 0 = off)',
  '■ 停止': '■ Stop',
  '▶ 运行 ': '▶ Run ',
  '下拉缓动': 'Pull-down easing',
  '侧栏展开延迟（毫秒）': 'Sidebar open delay (ms)',
  '侧栏展开时长（毫秒）': 'Sidebar open duration (ms)',
  '侧栏展开缓动': 'Sidebar open easing',
  '侧栏开始展开进度（%）': 'Sidebar open start progress (%)',
  '侧栏触发时刻（毫秒）': 'Sidebar trigger time (ms)',
  '保持默认': 'Keep default',
  '偏移（毫秒）': 'Offset (ms)',
  '全屏抖动与展开': 'Full-screen shake & open',
  '全屏抖动强度（像素，0 关闭）': 'Full-screen shake strength (px, 0 = off)',
  '关闭面板': 'Close panel',
  '出现': 'Show',
  '动作节点': 'Action cue',
  '动作间隔（毫秒）': 'Action gap (ms)',
  '匀速': 'Linear',
  '占用续期间隔（毫秒）': 'Lock heartbeat interval (ms)',
  '原生抛掷力度倍数': 'Native throw power multiplier',
  '去程时长（毫秒，0 自动）': 'Approach duration (ms, 0 = auto)',
  '去程走路时长（毫秒）': 'Approach walk duration (ms)',
  '右手横向位置（比例）': 'Right-hand x position (ratio)',
  '后拉动画时长（毫秒）': 'Pull-back animation duration (ms)',
  '后拉提前展开（毫秒）': 'Open lead before pull (ms)',
  '后退跟随（逻辑一）': 'Back-follow (Logic 1)',
  '向左弹飞强度（参考像素）': 'Flung-left strength (ref px)',
  '启用桌宠联动': 'Enable pet link',
  '哈气前等待（毫秒）': 'Pre-hiss wait (ms)',
  '哈气动作时长（毫秒）': 'Hiss animation duration (ms)',
  '失败': 'Failed',
  '安装 / 更新失败': 'Install / update failed',
  '导入 JSON': 'Import JSON',
  '导入失败：JSON 结构不正确': 'Import failed: invalid JSON structure',
  '导出 JSON': 'Export JSON',
  '已停止': 'Stopped',
  '已安装': 'Installed',
  '已完成': 'Done',
  '已导入 JSON': 'JSON imported',
  '已导出 JSON': 'JSON exported',
  '开始': 'Start',
  '开始或结束': 'Start or end',
  '弹回缓动': 'Spring-back easing',
  '弹飞位移': 'Flung displacement',
  '弹飞发力时间（毫秒）': 'Fling impulse time (ms)',
  '弹飞启动延迟（毫秒）': 'Fling start delay (ms)',
  '实测可视边界': 'Measured visible bounds',
  '抓绳站位头顶偏移（像素）': 'Grab-stand top offset (px)',
  '待测量（运行一次后显示）': 'not measured yet (run once to show)',
  '当前回落原生吉祥物（native）': 'Currently falling back to native mascot',
  '当前调参 JSON': 'Current tuning JSON',
  '当前逻辑': 'Current logic',
  '彩蛋一': 'Egg 1',
  '彩蛋一 · 踢开并弹飞': 'Egg 1 · Kick and fling',
  '彩蛋与返回原位': 'Egg & return home',
  '彩蛋二': 'Egg 2',
  '彩蛋二 · 站立哈气': 'Egg 2 · Stand and hiss',
  '彩蛋触发次数（次）': 'Egg trigger count (times)',
  '手与侧栏间距（像素）': 'Hand-to-sidebar gap (px)',
  '打开操控面板': 'Open control panel',
  '打开操控面板（Ctrl+Shift+D）': 'Open control panel (Ctrl+Shift+D)',
  '把壁纸吉祥物换成可联动的桌宠，或回到原生吉祥物': 'Swap the wallpaper mascot for a linkable pet, or return to the native mascot',
  '抓住绳子时刻（毫秒）': 'Grab rope time (ms)',
  '抓绳互动': 'Rope grab',
  '抖动开始时刻（毫秒）': 'Shake start time (ms)',
  '抖动频率（次/秒）': 'Shake frequency (Hz)',
  '拉动侧边栏': 'Pull sidebar',
  '按显示时长': 'By display duration',
  '最大跟随速度（像素/秒）': 'Max follow speed (px/s)',
  '未安装': 'Not installed',
  '未知原因': 'Unknown reason',
  '桌宠联动': 'Pet Link',
  '桌宠联动调参': 'Pet Link Tuning',
  '检测到官方 dsh-pet：两者会各显示一只，互不接管。': 'Official dsh-pet detected: both will show one pet each and will not take over each other.',
  '正在检测运行时…': 'Detecting runtime…',
  '气泡': 'Bubble',
  '气泡放行窗口（毫秒）': 'Bubble allow window (ms)',
  '气泡时间节点': 'Bubble timing',
  '气泡显示时长（毫秒）': 'Bubble display duration (ms)',
  '测试一次联动': 'Test link once',
  '站立哈气': 'Stand and hiss',
  '等待关闭上限（毫秒）': 'Wait-for-close max (ms)',
  '结束': 'End',
  '绳子下拉距离（像素）': 'Rope pull-down distance (px)',
  '绳子位移': 'Rope displacement',
  '绳子弹回时长（毫秒）': 'Rope spring-back duration (ms)',
  '绳子拉下时长（毫秒）': 'Rope pull-down duration (ms)',
  '缓入缓出': 'Ease in-out',
  '缓出': 'Ease out',
  '联动占用': 'Link occupancy',
  '联动可用': 'Link ready',
  '联动已就绪（linked）': 'Link ready (linked)',
  '联动暂不可用': 'Link unavailable',
  '脱手与下落': 'Release & fall',
  '脱手时刻（毫秒）': 'Release time (ms)',
  '落地动作时长（毫秒）': 'Landing animation duration (ms)',
  '落地后停留时长（毫秒）': 'Post-landing dwell (ms)',
  '落地恢复': 'Landing recovery',
  '被弹飞动作时长（毫秒）': 'Flung animation duration (ms)',
  '诊断': 'Diagnostics',
  '走路返回最小距离（像素）': 'Walk-home min distance (px)',
  '跟随起步宽限（毫秒）': 'Follow grace (ms)',
  '跳抓动作时长（毫秒）': 'Jump-grab animation duration (ms)',
  '踢开并弹飞': 'Kick and fling',
  '踢腿与侧栏间距（像素）': 'Kick-to-sidebar gap (px)',
  '踢腿前等待（毫秒）': 'Pre-kick wait (ms)',
  '踢腿动作时长（毫秒）': 'Kick animation duration (ms)',
  '运行中': 'Running',
  '逻辑一': 'Logic 1',
  '逻辑一 · 侧栏拉动': 'Logic 1 · Sidebar pull',
  '逻辑二': 'Logic 2',
  '重置当前逻辑': 'Reset current logic',
  '隐藏': 'Hide',
  '静止位移阈值（像素）': 'Still-move threshold (px)',
  '静止确认时长（毫秒）': 'Still-confirm duration (ms)',
  '预备到后拉间隔（毫秒）': 'Brace-to-pull interval (ms)',
  '（原生吉祥物）': '(native mascot)',
  '包名': 'Package',
  '正在下载并安装 dshpet-dshwe…': 'Installing dshpet-dshwe…',
  '运行时版本过旧（需升级 dshpet-dshwe）': 'Runtime too old — upgrade dshpet-dshwe',
  '正在下载…': 'Downloading…',
  '正在校验…': 'Verifying…',
  '正在安装…': 'Installing…',
  '下载源': 'Registry',
  '安装进度': 'Install progress',
  '已尝试的下载源': 'Registries tried',
  '双源均失败，可从官方地址手动安装': 'Both registries failed — install manually from npm',
  '收起安装说明': 'Hide install steps',
  '如何下载安装联动桌宠': 'How to install the linked pet',
  '① 左侧栏点「插件」': '1. Click Plugins in the sidebar',
  '② 右上角点「+ 添加插件」': '2. Click + Add plugin (top right)',
  '③ 输入包名后点「安装」': '3. Paste the package name and click Install',
  '三步装好联动桌宠': 'Three steps to install',
  '复制包名': 'Copy package name',
  '已复制': 'Copied',
  '安装时请复制上面的包名粘贴进去；也可在 npm 页面手动下载。': 'Copy the package name and paste it in; you can also download manually from npm.',
  '截图加载中…': 'Loading screenshot…',
};

/** `{name}` 占位符插值（与主包 weT 同口径的子集）。 */
function petLinkInterpolate(text, params) {
  if (!params || typeof text !== 'string') return text;
  return text.replace(/\{(\w+)\}/g, (whole, key) => (params[key] !== undefined ? String(params[key]) : whole));
}

/**
 * 造注入式 translator：**先查 pet-link 本地 EN 表，再回落主包 weT**。
 * @param hostWeT - 主包 `weT`（中文/其它语言的真源）。
 * @param langOf - 取当前语言 id 的函数（`zh*` = 中文，其余走本地 EN 表）。
 * @returns `(key, params) => string`
 */
function createPetLinkTranslate(hostWeT, langOf) {
  const base = typeof hostWeT === 'function' ? hostWeT : (key => key);
  return function translate(key, params) {
    if (typeof key !== 'string' || key === '') return key;
    let lang = 'zh';
    try { lang = (typeof langOf === 'function' ? langOf() : '') || 'zh'; } catch { lang = 'zh'; }
    if (!/^zh/i.test(String(lang))) {
      const en = Object.prototype.hasOwnProperty.call(PETLINK_I18N_EN, key) ? PETLINK_I18N_EN[key] : undefined;
      if (typeof en === 'string') return petLinkInterpolate(en, params);
    }
    return base(key, params);
  };
}
