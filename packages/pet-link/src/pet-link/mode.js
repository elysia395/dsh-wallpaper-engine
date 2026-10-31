/**
 * 桌宠联动 · 双 provider 状态机（纯判定，不碰 DOM、不发请求）。
 *
 * `petLinkMode()` 只回答一个问题：此刻该走 `linked`（页内 `petApiDshwe.link` 直控）
 * 还是 `native`（主包原生吉祥物）。判定失败永远降级 native 并给出**可读原因**，
 * 绝不留半死状态（半死 = 探测通过但控制面缺方法，点了没反应）。
 *
 * 判据（全真才 linked，任一假即 native）：
 *   1. 联动开关开启（`isEnabled()`）；
 *   2. 页面里探测到 `petApiDshwe`（Cordis 服务）；
 *   3. `petApiDshwe.link` 能力齐全且协议版本 ≥ 4；
 *   4. 目标 petId 有效（该 petId 有控制器、根节点在场且在视口内）。
 *
 * reason 词汇（顺序即判定顺序）：
 *   'toggled-off'          开关关闭
 *   'runtime-not-installed' 未装 / 服务不在本页
 *   'runtime-too-old'      有服务但无 link 或版本过旧 / 缺方法（新增）
 *   'unknown-target'       没给目标 petId
 *   'unknown-pet'          目标 petId 无控制器
 *   'pet-not-displayed'    目标不在 web 显示（根节点缺失 / 尺寸为 0 / 不可见）
 *   ''                      linked 可用
 *
 * @param {{ isEnabled?: () => boolean, getApi?: () => any, targetId?: () => string }} options
 * @returns {{ mode: 'linked'|'native', reason: string, link: any, target: string }}
 */

/** 根节点是否可见：尺寸非零且未被 display/visibility/opacity 隐藏。 */
function petLinkRootVisible(root) {
  try {
    if (!root || root.isConnected === false) return false;
    const rect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
    if (!rect || !(rect.width > 0 && rect.height > 0)) return false;
    if (typeof getComputedStyle === 'function') {
      const css = getComputedStyle(root);
      if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 探测一次 provider。
 * @param options - 注入的开关、服务取值与目标取值。
 * @returns mode / reason / link / target；linked 时 link 可直接使用。
 */
function detectPetLinkProvider(options = {}) {
  const isEnabled = options.isEnabled || (() => true);
  const getApi = options.getApi || (() => null);
  const targetIdOf = options.targetId || (() => 'main');
  const native = reason => ({ mode: 'native', reason, link: null, target: '' });

  let enabled = false;
  try { enabled = isEnabled() !== false; } catch { enabled = false; }
  if (!enabled) return native('toggled-off');

  let api = null;
  try { api = getApi() || null; } catch { api = null; }
  if (!api) return native('runtime-not-installed');

  const link = api.link || null;
  if (!link || typeof link !== 'object') return native('runtime-too-old');

  const version = Number(link.version);
  if (!Number.isFinite(version) || version < PETLINK_MIN_LINK_VERSION) return native('runtime-too-old');
  for (const method of PETLINK_LINK_METHODS) {
    if (typeof link[method] !== 'function') return native('runtime-too-old');
  }
  // surface 是可选能力（新 PET 运行时按配置 display 给出 'web'|'desktop'）。
  // 旧运行时没有这个字段：不判过旧，调用方（client.js 的 petLinkSurface）按 'web' 回落。
  // 但给了非法值说明控制面契约被破坏 —— 宁可降级 native，也不要按错端去操控。
  if (link.surface !== undefined && link.surface !== 'web' && link.surface !== 'desktop') {
    return native('runtime-too-old');
  }

  let target = '';
  try { target = String(targetIdOf() ?? '').trim(); } catch { target = ''; }
  if (!target) return native('unknown-target');

  let root = null;
  try { root = link.getRoot(target); } catch { root = null; }
  if (!root) return native('unknown-pet');
  if (!petLinkRootVisible(root)) return native('pet-not-displayed');

  return { mode: 'linked', reason: '', link, target };
}

/**
 * 选路：比较「宠物 → 侧边栏开口」与「宠物 → 吉祥物（绳子）」的横向距离，谁近走哪条。
 * 取不到位置时按逻辑一（表演最完整）。返回 'sidebar' | 'mascot'。
 * @param petX - 宠物中心横向像素。
 * @param ropeX - 绳子中心横向像素（可空）。
 * @param edgeX - 侧边栏开口横向像素。
 * @param width - 视口宽度。
 */
function petLinkDecideLogic(petX, ropeX, edgeX, width) {
  if (!Number.isFinite(petX) || !Number.isFinite(width) || width <= 0) return 'sidebar';
  const toEdge = Number.isFinite(edgeX) ? Math.abs(petX - edgeX) : Math.abs(petX - width);
  const toRope = Number.isFinite(ropeX) ? Math.abs(petX - ropeX) : Infinity;
  return toRope < toEdge ? 'mascot' : 'sidebar';
}
