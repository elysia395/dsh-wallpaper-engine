/**
 * 桌宠联动 · 自绘气泡层。
 *
 * 旧版用 `POST /broadcast` 写宠物的原生气泡，还要额外补丁改时长/收回；新版自重绘制一个
 * 独立 DOM 覆盖层，锚点用宠物根节点 rect 逐帧跟随（页面内测量、零请求），
 * 不占用、不清理宠物自己的任一种气泡，卸载即摘除。
 *
 * 依赖注入：document / viewport / raf / caf / later / clear / bubbleUrl，可脱浏览器单测。
 * @param {object} deps - 注入依赖。
 * @returns {{ show: Function, hide: Function, dispose: Function, isShown: Function }}
 */
function createPetLinkBubble(deps = {}) {
  const doc = deps.document || (typeof document !== 'undefined' ? document : null);
  const raf = deps.requestAnimationFrame
    || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn => setTimeout(fn, 16)));
  const caf = deps.cancelAnimationFrame
    || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id => clearTimeout(id)));
  const later = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clear = deps.clearTimeout || (id => clearTimeout(id));
  const viewport = deps.viewport || (() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  const bubbleUrl = deps.bubbleUrl || (index => 'm' + index + '.png');

  /** 当前挂着的那一只气泡；`null` = 没显示。 */
  let current = null;

  const hide = () => {
    if (current === null) return;
    const own = current;
    current = null;
    clear(own.timer);
    if (own.frame !== null) caf(own.frame);
    try { own.node.remove(); } catch { /* 已被移除 */ }
  };

  const show = (config = {}) => {
    const text = typeof config.text === 'string' ? config.text : '';
    const image = config.image === undefined ? null : config.image;
    const duration = config.duration;
    const anchor = typeof config.anchor === 'function' ? config.anchor : null;
    if (!doc || typeof doc.createElement !== 'function') return false;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180000) return false;
    if (image !== null && (!Number.isInteger(image) || image < 0 || image > 4)) return false;
    if (text.length > 2000) return false;

    hide();
    const node = doc.createElement('div');
    node.setAttribute('data-pet-link-bubble', '');
    Object.assign(node.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '50',
      width: 'min(240px, calc(100vw - 16px))', boxSizing: 'border-box', overflowWrap: 'anywhere',
      padding: '8px', borderRadius: '8px', background: 'Canvas', color: 'CanvasText',
      border: '1px solid GrayText', transform: 'translate(-50%, -100%)',
    });
    node.textContent = text;
    if (image !== null) {
      // 图片地址可能尚未就绪（预取未完成）或取不到（鉴权拒绝 / 离线）：此时**不插 img**，
      // 避免一个破图占位框盖在宠物头上——文字气泡本身仍然有效。
      const pictureUrl = bubbleUrl(image);
      if (pictureUrl) {
        const picture = doc.createElement('img');
        picture.src = pictureUrl;
        picture.alt = '';
        Object.assign(picture.style, { display: 'block', width: '180px', maxWidth: '100%', height: '180px', objectFit: 'contain' });
        node.appendChild(picture);
      }
    }

    const own = { node, timer: null, frame: null, anchor };
    const place = () => {
      if (current !== own) return;
      const view = viewport();
      const rect = own.anchor ? own.anchor() : null;
      const cx = rect && Number.isFinite(rect.x) ? rect.x : view.width / 2;
      const topPx = rect && Number.isFinite(rect.y) ? rect.y : view.height / 2;
      const size = rect && Number.isFinite(rect.size) ? rect.size : 90;
      const box = (typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null)
        || { width: Math.min(240, view.width - 16), height: 80 };
      if (box.height > view.height - 16) { hide(); return; }
      node.style.left = `${Math.max(box.width / 2 + 8, Math.min(view.width - box.width / 2 - 8, cx))}px`;
      node.style.top = `${Math.max(box.height + 8, Math.min(view.height - 8, topPx - size / 2 - 8))}px`;
      own.frame = raf(place);
    };

    current = own;
    try { doc.body.appendChild(node); } catch { current = null; return false; }
    place();
    if (current !== own) return false;
    own.timer = later(() => { if (current === own) hide(); }, duration);
    return true;
  };

  return { show, hide, dispose: hide, isShown: () => current !== null };
}
