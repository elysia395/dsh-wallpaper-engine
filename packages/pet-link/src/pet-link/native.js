/**
 * 桌宠联动 · native provider：不接管，回落主包原生吉祥物。
 *
 * 语义：linked 判据任一不满足（未装 / 关了 / 探测失败 / 版本过旧 / 目标无效）时，
 * 点吉祥物 = 原样操作壁纸侧栏（`rt.fallback()`，生产端接 `wallSidebarToggle`），
 * 主包吉祥物代码一行不改。所有手势/排播入口在这里都是安静 no-op（返回 false）。
 */
function createNativePetProvider(rt) {
  const reason = () => (rt.state && rt.state.reason) || 'native';
  const tap = () => {
    let handled = false;
    try { handled = rt.fallback() === true; } catch { handled = false; }
    return { logic: 'disabled', phase: 'done', busy: false, fallback: handled, reason: reason() };
  };
  const snapshot = () => ({
    available: false,
    mode: 'native',
    reason: reason(),
    busy: false,
    phase: 'done',
    logic: '',
    target: (rt.state && rt.state.target) || 'main',
    farCount: 0,
    nearCount: 0,
    home: null,
  });
  return {
    tap,
    run: () => tap(),
    snapshot,
    registerSidebar() { /* native 不持有侧栏接口 */ },
    registerGesture() { return () => {}; },
    reset() { /* 无计数 */ },
    performer: {
      onGrab() { return Promise.resolve(false); },
      onPull() { return Promise.resolve(false); },
      onRelease() { return Promise.resolve(false); },
      snapshot,
    },
  };
}
