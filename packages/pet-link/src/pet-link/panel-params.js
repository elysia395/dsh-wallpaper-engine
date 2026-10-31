/**
 * 桌宠联动 · 调参面板参数清单（M6）。
 *
 * 这是「面板上到底出现哪些旋钮」的**唯一真源**：分组、顺序、单位/步长、缓动选项全在这里。
 * 数据与渲染分离——panel.js 只负责把这些定义画成 DOM 并接线，不再散落一份参数表。
 *
 * 继承旧版约 50 个参数的分组（逻辑一 / 抓绳 / 绳子位移 / 脱手下落 / 弹飞位移 / 落地恢复 /
 * 彩蛋二 / 气泡 / 占用 / 返回原位）。分组只是排版，不影响语义；同一个 `key` 在四个逻辑下
 * 各存一份覆盖（`state.tuning[logic][key]`）。
 *
 * ⚠️ 与 M5 非目标「不改排播算法」的关系：面板是**调试/调参工具**，值落到排播覆盖层。
 * M5 排播实际消费其中一部分键（如 sidebarWalkMs / openDelayMs / mascotOpenAtMs /
 * egg1FlingPx…）；其余键（逐帧跟随、抖动等旧版细化参数）照样可调、可持久化、可导出，
 * 供维护者据导出的 JSON 调整算法常量 —— 与旧版面板「导出贴回聊天」的定位一致。
 */

/** 四个可调逻辑（与排播一致）。 */
const PETLINK_PANEL_LOGICS = [
  { logic: 'sidebar', name: '逻辑一', label: '拉动侧边栏' },
  { logic: 'mascot', name: '逻辑二', label: '抓绳互动' },
  { logic: 'egg1', name: '彩蛋一', label: '踢开并弹飞' },
  { logic: 'egg2', name: '彩蛋二', label: '站立哈气' },
];

/** 缓动三选一（索引 0/1/2 存进覆盖层，与旧版下拉取值一致）。 */
const PETLINK_PANEL_EASES = ['匀速', '缓入缓出', '缓出'];

/**
 * 参数字段（扁平表）。`scope` 决定出现在哪些逻辑页：
 *  - 'all' / 'sidebarMascot' / 'sidebar' / 'mascot' / 'egg1' / 'egg2'
 * `ease: true` 表示这是缓动下拉，值为 PETLINK_PANEL_EASES 的索引。
 */
const PETLINK_PANEL_FIELDS = [
  // ── 逻辑一：侧栏拉动 ──
  { group: '逻辑一 · 侧栏拉动', key: 'sidebarWalkMs', label: '去程走路时长（毫秒）', step: 100, scope: 'sidebar' },
  { group: '逻辑一 · 侧栏拉动', key: 'braceMs', label: '预备到后拉间隔（毫秒）', step: 50, scope: 'sidebar' },
  { group: '逻辑一 · 侧栏拉动', key: 'pullMs', label: '后拉动画时长（毫秒）', step: 1, scope: 'sidebar' },
  { group: '逻辑一 · 侧栏拉动', key: 'slowOpenMs', label: '侧栏展开时长（毫秒）', step: 1, scope: 'sidebar' },
  { group: '逻辑一 · 侧栏拉动', key: 'edgeGapPx', label: '手与侧栏间距（像素）', step: 1, scope: 'sidebar' },
  { group: '逻辑一 · 侧栏拉动', key: 'openLeadMs', label: '后拉提前展开（毫秒）', step: 50, scope: 'sidebar' },
  { group: '逻辑一 · 侧栏拉动', key: 'openDelayMs', label: '侧栏展开延迟（毫秒）', step: 50, scope: 'sidebar' },
  { group: '逻辑一 · 侧栏拉动', key: 'segGapMs', label: '动作间隔（毫秒）', step: 10, scope: 'all' },
  { group: '逻辑一 · 侧栏拉动', key: 'handRightRatio', label: '右手横向位置（比例）', step: 0.0001, scope: 'sidebar' },
  // ── 后退跟随（旧版逐帧贴边）──
  { group: '后退跟随（逻辑一）', key: 'followGraceMs', label: '跟随起步宽限（毫秒）', step: 50, scope: 'sidebar' },
  { group: '后退跟随（逻辑一）', key: 'followSpeed', label: '最大跟随速度（像素/秒）', step: 10, scope: 'sidebar' },
  { group: '后退跟随（逻辑一）', key: 'followStillMs', label: '静止确认时长（毫秒）', step: 10, scope: 'sidebar' },
  { group: '后退跟随（逻辑一）', key: 'followStillEps', label: '静止位移阈值（像素）', step: 0.1, scope: 'sidebar' },
  // ── 气泡 ──
  { group: '气泡', key: 'bubbleMs', label: '气泡显示时长（毫秒）', step: 100, scope: 'all' },
  { group: '气泡', key: 'bubbleWindowMs', label: '气泡放行窗口（毫秒）', step: 100, scope: 'all' },
  // ── 联动占用 ──
  { group: '联动占用', key: 'lockHeartbeatMs', label: '占用续期间隔（毫秒）', step: 1000, scope: 'all' },
  { group: '联动占用', key: 'holdMaxMs', label: '等待关闭上限（毫秒）', step: 1000, scope: 'all' },
  // ── 彩蛋与返回原位 ──
  { group: '彩蛋与返回原位', key: 'eggAt', label: '彩蛋触发次数（次）', step: 1, scope: 'sidebarMascot' },
  { group: '彩蛋与返回原位', key: 'mascotGrabAtMs', label: '抓住绳子时刻（毫秒）', step: 100, scope: 'mascot' },
  { group: '彩蛋与返回原位', key: 'mascotTopOffsetPx', label: '抓绳站位头顶偏移（像素）', step: 4, scope: 'mascot' },
  { group: '彩蛋与返回原位', key: 'returnWalkMinPx', label: '走路返回最小距离（像素）', step: 5, scope: 'all' },
  // ── 抓绳互动（逻辑二）──
  { group: '抓绳互动', key: 'mascotWalkMs', label: '去程时长（毫秒，0 自动）', step: 100, scope: 'mascot' },
  { group: '抓绳互动', key: 'mascotTumbleMs', label: '跳抓动作时长（毫秒）', step: 100, scope: 'mascot' },
  { group: '抓绳互动', key: 'mascotOpenAtMs', label: '侧栏触发时刻（毫秒）', step: 50, scope: 'mascot' },
  // ── 绳子位移 ──
  { group: '绳子位移', key: 'mascotRopeDownPx', label: '绳子下拉距离（像素）', step: 1, scope: 'mascot' },
  { group: '绳子位移', key: 'mascotRopePullMs', label: '绳子拉下时长（毫秒）', step: 50, scope: 'mascot' },
  { group: '绳子位移', key: 'mascotRopeBackMs', label: '绳子弹回时长（毫秒）', step: 50, scope: 'mascot' },
  { group: '绳子位移', key: 'mascotRopePullEase', label: '下拉缓动', ease: true, scope: 'mascot' },
  { group: '绳子位移', key: 'mascotRopeBackEase', label: '弹回缓动', ease: true, scope: 'mascot' },
  // ── 脱手与下落 ──
  { group: '脱手与下落', key: 'mascotReleaseAtMs', label: '脱手时刻（毫秒）', step: 50, scope: 'mascot' },
  { group: '脱手与下落', key: 'mascotDropPx', label: 'pet 下落距离（像素，0 关闭）', step: 1, scope: 'mascot' },
  { group: '脱手与下落', key: 'mascotDropMs', label: 'pet 下落时长（毫秒）', step: 50, scope: 'mascot' },
  // ── 彩蛋一：踢开并弹飞 ──
  { group: '彩蛋一 · 踢开并弹飞', key: 'egg1EdgeGapPx', label: '踢腿与侧栏间距（像素）', step: 1, scope: 'egg1' },
  { group: '彩蛋一 · 踢开并弹飞', key: 'egg1WalkMs', label: '去程时长（毫秒，0 自动）', step: 100, scope: 'egg1' },
  { group: '彩蛋一 · 踢开并弹飞', key: 'egg1LeadMs', label: '踢腿前等待（毫秒）', step: 50, scope: 'egg1' },
  { group: '彩蛋一 · 踢开并弹飞', key: 'egg1KickMs', label: '踢腿动作时长（毫秒）', step: 100, scope: 'egg1' },
  { group: '彩蛋一 · 踢开并弹飞', key: 'egg1FlungMs', label: '被弹飞动作时长（毫秒）', step: 100, scope: 'egg1' },
  { group: '彩蛋一 · 踢开并弹飞', key: 'egg1LandMs', label: '落地动作时长（毫秒）', step: 100, scope: 'egg1' },
  // ── 弹飞位移 ──
  // 「弹飞启动延迟」：蓝本 petLinkEggRebound 真消费（L1425），T11 从 t16 误删中恢复。
  { group: '弹飞位移', key: 'egg1FlingStartDelayMs', label: '弹飞启动延迟（毫秒）', step: 50, scope: 'egg1' },
  { group: '弹飞位移', key: 'egg1FlingPx', label: '向左弹飞强度（参考像素）', step: 5, scope: 'egg1' },
  { group: '弹飞位移', key: 'egg1FlingMs', label: '弹飞发力时间（毫秒）', step: 50, scope: 'egg1' },
  { group: '弹飞位移', key: 'egg1FlingPower', label: '原生抛掷力度倍数', step: 0.1, scope: 'egg1' },
  // ── 落地恢复 ──
  { group: '落地恢复', key: 'egg1PostLandMs', label: '落地后停留时长（毫秒）', step: 50, scope: 'egg1' },
  // ── 彩蛋二：站立哈气 ──
  { group: '彩蛋二 · 站立哈气', key: 'egg2LeadMs', label: '哈气前等待（毫秒）', step: 50, scope: 'egg2' },
  { group: '彩蛋二 · 站立哈气', key: 'egg2HissMs', label: '哈气动作时长（毫秒）', step: 100, scope: 'egg2' },
  // ── 全屏抖动与展开 ──
  { group: '全屏抖动与展开', key: 'egg2ShakeAtMs', label: '抖动开始时刻（毫秒）', step: 50, scope: 'egg2' },
  { group: '全屏抖动与展开', key: 'egg2ShakePx', label: '全屏抖动强度（像素，0 关闭）', step: 1, scope: 'egg2' },
  { group: '全屏抖动与展开', key: 'egg2ShakeHz', label: '抖动频率（次/秒）', step: 1, scope: 'egg2' },
  { group: '全屏抖动与展开', key: 'egg2OpenAtPct', label: '侧栏开始展开进度（%）', step: 1, scope: 'egg2' },
  { group: '全屏抖动与展开', key: 'egg2OpenEase', label: '侧栏展开缓动', ease: true, scope: 'egg2' },
];

/**
 * 把扁平字段按 scope 展开成「每个逻辑一份」。
 * @returns {Array<object>} 带 `logic` 的字段项。
 */
function petLinkPanelFieldsFor(logic) {
  return PETLINK_PANEL_FIELDS.filter(field => {
    if (field.scope === 'all') return true;
    if (field.scope === 'sidebarMascot') return logic === 'sidebar' || logic === 'mascot';
    return field.scope === logic;
  });
}
