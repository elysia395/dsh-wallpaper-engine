/**
 * adapter.js — 适配器模式：宿主形态（原生浏览器 / 非官方桌面端 / 官方桌面端）
 * 的本地判定、宿主上报落点、最终目标与能力矩阵。
 *
 * 三档的**事实来源**（判定本身与操作系统无关，读的是请求头与 UA，两侧同一套
 * 字面量，见 lib/settings-schema.js 的 ADAPTER_TARGET_VALUES）：
 *   · 能力头 `x-dsh-desktop-renderer` ⇒ 带栅栏的桌面端（实测：该头只出现在
 *     社区壳 DSH Desktop.app 的 desktop-browser-access 分片里，官方
 *     DeepSeek Harness.app 的 app.asar 零命中）；
 *   · UA 含 `Electron/` ⇒ 桌面壳（官方与社区都是 Electron，这一档分不了官民，
 *     只用来把「桌面壳」与「原生浏览器」分开）；
 *   · 两者皆无 ⇒ 原生浏览器。
 * 宿主按请求观测并闩锁（只增不减），经 `GET /settings` 的 `adapter` 字段上报；
 * 页面侧在拿到上报之前先用本地信号给一个**临时判定**，避免首帧无从下手。
 *
 * 优先级（本文件的唯一裁决点）：**手选 > 宿主上报 > 本地判定**。
 *
 * 契约：
 *   · 需要的外界：`selection.adapterTarget`（手选值）与浏览器全局
 *     （location / navigator / document）。**只在函数体内读** —— 本文件被内联到
 *     bundle 顶部、早于 src/client.js 正文，顶层读 selection 会 TDZ。
 *   · 对外提供：`setAdapterFromHost`（上报落点）、`resolveAdapterTarget`（最终目标）、
 *     `adapterCaps`（能力矩阵）、`adapterDetectedLabel` / `adapterMismatchWarning`
 *     （面板文案）、`ADAPTER_LABELS`（选项文案）。
 *   · 判定异常一律吞掉并退回最保守的一档（浏览器），绝不因探测改变页面行为。
 */

// 选项文案。值域与 schema 的 ADAPTER_TARGET_VALUES 逐字对齐（守卫比对）。
// 取值用 getter 现取（不在模块级冻结）：语言在 bundle 求值之后才由 locale 服务确定，
// 冻结的值会让 en 界面永远停在中文（见 src/i18n/i18n.js 的"模块级冻结"纪律）。
const ADAPTER_LABELS = {
  get auto() { return weT('自动检测'); },
  get browser() { return weT('原生浏览器'); },
  get 'desktop-community'() { return weT('非官方桌面端'); },
  get 'desktop-official'() { return weT('官方桌面端'); },
};

// 宿主上报的落点：`GET /settings` 响应里的 `adapter` 字段（null = 还没拿到）。
let adapterHostReport = null; // { detected, fence } · null = 未上报

/**
 * 宿主上报入口（src/persistence.js 的 loadPersisted 调）。非对象一律视为
 * "宿主没给"，保持 null —— 客户端不能因为响应里缺字段就抛。
 */
function setAdapterFromHost(adapter) {
  adapterHostReport = adapter && typeof adapter === 'object'
    ? { detected: String(adapter.detected || ''), fence: Boolean(adapter.fence) }
    : null;
}

// 本地判定的缓存：undefined = 未探测。桌面壳的两个查询参数与壳层 DOM 只有
// 壳会写/建，UA 的 Electron 片段覆盖「壳存在但没写查询参数」的形态。
let adapterLocalTarget; // undefined = 未探测 · 三档之一 = 已探测
function adapterLocalDetect() {
  if (adapterLocalTarget !== undefined) return adapterLocalTarget;
  adapterLocalTarget = 'browser'; // 保守初值：探测异常时按浏览器处理
  try {
    let shell = false;
    if (typeof location !== 'undefined' && location && typeof location.search === 'string') {
      const q = new URLSearchParams(location.search);
      // dsh-desktop-mode 存在即为壳；dsh-desktop-mica 取值 1/0，只有"存在"有意义。
      shell = q.get('dsh-desktop-mode') !== null || q.get('dsh-desktop-mica') !== null;
    }
    if (!shell && typeof document !== 'undefined' && document && typeof document.querySelector === 'function') {
      shell = Boolean(document.querySelector('.dshDesktopFrame, .dshDesktopConversationSurface'))
        || (Boolean(document.body) && document.body.hasAttribute('data-dsh-desktop-mode'));
    }
    if (!shell && typeof navigator !== 'undefined' && navigator && typeof navigator.userAgent === 'string') {
      shell = /Electron\//.test(navigator.userAgent);
    }
    // 本地判不出官民（两侧都有壳层信号），按"无栅栏"的那一档给标签：
    // 栅栏是宿主侧观测事实，最终以宿主上报为准。
    if (shell) adapterLocalTarget = 'desktop-official';
  } catch { /* 探测异常：保持 browser —— 不改变既有行为 */ }
  return adapterLocalTarget;
}

/** 手选值（非 auto 时即最终目标）；没手选返回 'auto'。 */
function adapterPickedTarget() {
  try {
    const v = typeof selection !== 'undefined' && selection ? selection.adapterTarget : 'auto';
    return typeof v === 'string' && ADAPTER_TARGET_VALUES.includes(v) ? v : 'auto';
  } catch { return 'auto'; }
}

/** 最终目标：手选 > 宿主上报 > 本地判定。返回值恒在 ADAPTER_TARGET_VALUES 内且非 auto。 */
function resolveAdapterTarget() {
  const picked = adapterPickedTarget();
  if (picked !== 'auto') return picked;
  if (adapterHostReport && adapterHostReport.detected
    && adapterHostReport.detected !== 'auto'
    && ADAPTER_TARGET_VALUES.includes(adapterHostReport.detected)) {
    return adapterHostReport.detected;
  }
  return adapterLocalDetect();
}

/**
 * 能力矩阵（客户端四处行为的唯一依据）：
 *   · desktop        —— 是否桌面壳：决定外壳 CSS 门控与失焦暂停是否适用；
 *   · fence          —— 宿主是否观测到能力头栅栏（决定面板对媒体源的说明）；
 *   · blurPause      —— 「窗口失焦时暂停」是否生效。桌面壳失焦时壁纸多半仍整块
 *                       可见（壳是透明的 / 壁纸就是窗口底），暂停会定格**可见**
 *                       画面；浏览器里失焦通常意味着窗口已被完全盖住。
 */
function adapterCaps() {
  const target = resolveAdapterTarget();
  const desktop = target !== 'browser';
  return {
    target,
    desktop,
    fence: Boolean(adapterHostReport && adapterHostReport.fence),
    blurPause: !desktop,
  };
}

/** 面板状态行的「检测到：X」——只反映**观测/判定**，与手选无关。 */
function adapterDetectedLabel() {
  const detected = adapterHostReport && adapterHostReport.detected
    && adapterHostReport.detected !== 'auto'
    && ADAPTER_TARGET_VALUES.includes(adapterHostReport.detected)
    ? adapterHostReport.detected
    : adapterLocalDetect();
  return ADAPTER_LABELS[detected] || ADAPTER_LABELS.browser;
}

/**
 * 手选与观测不一致时的警示（空串 = 一致 / 没手选）。手选浏览器而宿主观测到栅栏
 * 是唯一会真的画不出网页壁纸的组合，单独给一句可执行的话。
 */
function adapterMismatchWarning() {
  const picked = adapterPickedTarget();
  if (picked === 'auto') return '';
  const detected = adapterHostReport && adapterHostReport.detected
    && adapterHostReport.detected !== 'auto'
    && ADAPTER_TARGET_VALUES.includes(adapterHostReport.detected)
    ? adapterHostReport.detected
    : adapterLocalDetect();
  if (detected === picked) return '';
  if (picked === 'browser' && adapterHostReport && adapterHostReport.fence) {
    return weT('手选了原生浏览器，但宿主观测到能力头栅栏 —— 网页壁纸会 403，请改回自动检测或桌面目标');
  }
  return weT('手选目标与检测不一致（检测到：{target}）', { target: ADAPTER_LABELS[detected] || '' });
}

export {
  ADAPTER_LABELS, setAdapterFromHost, resolveAdapterTarget,
  adapterCaps, adapterDetectedLabel, adapterMismatchWarning,
};
