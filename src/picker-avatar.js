/**
 * picker-avatar.js — 「头像」页签的**参数渲染器**（纯渲染 + 显式 ctx）。
 *
 * ══ 它是什么 ══════════════════════════════════════════════════════════════════
 * 设置面板里「头像」这一页的全部控件，按「先开关、再画什么、后调形状」排：
 *   总开关 → 一句说明 → 助手头像（预览 + 上传 + 清除）→ 用户头像（同上）
 *   → 尺寸 / 间距 / 圆角 三根滑杆。
 * 屏上表现由 `src/avatar-layer.js` 注入的一张样式表实现（用 CSS 伪元素画在消息旁边，
 * 不动 dsh 原生的 markdown / 推理折叠 / 反馈 / 统计任何结构）；设置项的真源在
 * `lib/settings-schema.js` 的 8 个 `avatar*` 键（`DEFAULTS` 提供默认，KINDS 做消毒）。
 *
 * 契约：
 *   需要的外界：`ctx`（由 `src/client.js` 在渲染这一页的调用点组装）—— `sel` + 一组
 *     具名 `on*` 处理器；扁平可用的渲染助手 `React` / `weT` / `switchRow` / `SliderRow` /
 *     `ctlText`（住在 `src/client.js` 正文，**函数体内**调用没问题，不要写进模块级 const）。
 *   对外提供：`renderAvatarTab(ctx)`（这一页的渲染函数本身）。它**不是**模块描述符 ——
 *     「头像」是一个独立页签，不挂在「扩展」页签的 `extensionModules()` 注册表下，
 *     所以本文件没有 `*_EXTENSION_MODULE` 那种 `{ id, title, desc, render }` 形状。
 *
 * 不变量：
 *   · **不得自己写设置 / 发通知 / 持有状态**（页签渲染器的契约，同 ext-fx.js）：本文件里
 *     没有 `setSetting`、没有 `emit(`、没有 `selection`，一个动作一个 `on*` 处理器 ——
 *     越界的形态由 test/verify-client.mjs 的接缝判据钉住。
 *   · **只从一个参数取外界**：`renderAvatarTab(ctx)`，函数体第一行解构。
 *   · **文件读取只干一件事**：把用户选的那张图变成 data URI，交给对应的 `on*` 回调 ——
 *     落盘、消毒、失败提示都在宿主那边（ctx 里没有错误通道，本渲染器不自己造）。
 *   · 关掉总开关时**只画总开关 + 一句说明**："关着还能拖它的参数"是本仓刻意不做的那种
 *     错觉（同一口径见 ext-fx.js 文件头最后一条）。
 *   · 参数的可调范围与默认值**不在这里写死**：下面的 min/max/step 与 `lib/settings-schema.js`
 *     的 KINDS 保持一致（改范围要同时看那份 —— 它是唯一真源）；默认值由 `sel` 带过来，
 *     本文件不抄一份"万一 sel 缺了"的第二真源。
 */

/** 两个头像槽的文案（形状照抄 ext-fx.js 的 `FX_CLICK_STYLES`）。
 *  文案写成 **getter**：既让 `weT(...)` 是这些字面量的"最内层调用帧"（test/verify-i18n.mjs
 *  的判据 ① 认这个形态），又保证取译文发生在**渲染时** —— 直接写 `label: "…"` 会被判成
 *  裸中文，写成顶层 `weT("…")` 又会撞内联后的 TDZ（见 docs/CODE-STRUCTURE.md 的模块纪律）。
 *  表里**只有文案**：data URI 与两个回调都从 ctx 来（模块级碰 ctx 就越界了）。 */
const AVATAR_SLOTS = [
  {
    id: 'assistant',
    get label() { return weT("助手头像"); },
    get hint() { return weT("显示在每条助手回复的左侧；没有头像时用灰白剪影占位"); },
  },
  {
    id: 'user',
    get label() { return weT("用户头像"); },
    get hint() { return weT("显示在你发出的每条消息的右侧；没有头像时用灰白剪影占位"); },
  },
];

/** 预览框的固定边长（px）。
 *  ⚠️ **刻意不跟「头像尺寸」滑杆联动**：预览框一跟着缩，"看不清自己刚传的是哪张图"就又
 *  回来了；真实直径由那根滑杆负责表达。圆角**要**跟着（它是这一页唯一能一眼验收的效果），
 *  但夹在边长一半以内 —— CSS 圆角超过一半本来就等价于正圆，夹不夹一个样。 */
const AVATAR_PREVIEW_PX = 48;

/**
 * 一个头像槽：预览小方图 + 「上传」/「清除」两个按钮 + 一个藏在界面外的 file input。
 *
 * @param {string} key  React key（稳定且唯一；决定这一行重挂时会不会丢状态）
 * @param {{id:string,label:string,hint:string}} slot AVATAR_SLOTS 里的一项（只取文案）
 * @param {{value:string,radius:number,onPick:Function,onClear:Function}} opts
 *   `value` 是当前 data URI（空串 = 没设置）；`onPick(uri)` / `onClear()` 来自 ctx。
 */
function avatarUploadRow(key, slot, opts) {
  const o = opts || {};
  const value = typeof o.value === "string" ? o.value : "";
  // 显示层兜底：`sel` 缺键时预览圆角退成方形（0），**不是**把默认值抄一份进本文件。
  const radius = Math.max(0, Math.min(AVATAR_PREVIEW_PX / 2, Number(o.radius) || 0));
  const onPick = typeof o.onPick === "function" ? o.onPick : null;
  const onClear = typeof o.onClear === "function" ? o.onClear : null;
  // 取文件口：按钮点它。input 自己 `display: none`（不在界面里占位，也不吃焦点）。
  let fileInput = null;
  const pickFrom = (ev) => {
    const input = (ev && (ev.currentTarget || ev.target)) || null;
    const file = input && input.files && input.files[0];
    // ⚠️ 先摘文件、**后**清空 input：清空会连带丢掉 files 引用，顺序反了就永远选不中。
    //    清空也是为了"重选同一张图"仍能触发 change（既有上传控件的同款处理，见 panel-tabs.js）。
    if (input) input.value = "";
    if (!file || !onPick) return;
    const reader = new FileReader();
    // 成功：只把 data URI 交出去，落盘与消毒是宿主的事。
    reader.onload = () => {
      const uri = reader && typeof reader.result === "string" ? reader.result : "";
      if (uri) onPick(uri);
    };
    // 失败（文件读不出 / 不是图片）：**保持原头像不动** —— ctx 没有错误通道可报，
    // 悄悄换成空头像会让用户以为图被"清掉"了，比失败更让人困惑（与 fontset-store
    // "失败要可判定"的同款取舍：这里可判定的一极是"什么都没变"）。
    reader.onerror = () => {};
    reader.readAsDataURL(file);
  };
  return React.createElement("div", { className: "we-picker__ctl", key: key },
    ctlText(slot.label, slot.hint),
    React.createElement("div", { className: "we-picker__row" },
      // 预览：固定边长的圆角方块，里面要么是图、要么是"未设置"占位。
      // 内联样式而不是新 class —— 本仓的样式在 src/styles.js（构建期内联），这一页
      // 不往那份 20 万字符的文件里加东西，就用内联把形状定死。
      React.createElement("div", {
        className: "we-picker__avatar-preview",
        style: {
          width: AVATAR_PREVIEW_PX + "px",
          height: AVATAR_PREVIEW_PX + "px",
          borderRadius: radius + "px",
          overflow: "hidden",
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(127, 127, 127, 0.18)",
        },
      },
        value
          ? React.createElement("img", {
            src: value,
            alt: slot.label,
            title: slot.label,
            style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
          })
          : React.createElement("span", { className: "we-picker__hint" }, weT("未设置")),
      ),
      React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: () => { if (fileInput) fileInput.click(); },
      }, value ? weT("替换图片…") : weT("上传…")),
      // 「清除」只在真有头像时出现 —— 没有可清的东西还摆个键，就是"点了没反应"那一类。
      value && onClear ? React.createElement("button", {
        className: "we-picker__btn", type: "button",
        onClick: () => onClear(),
      }, weT("清除")) : null,
      React.createElement("input", {
        type: "file",
        accept: "image/*",
        style: { display: "none" },
        ref: (el) => { fileInput = el; },
        onChange: pickFrom,
      }),
    ),
  );
}

/**
 * 「头像」页签：总开关 → 说明 → 两个头像槽 → 尺寸 / 间距 / 圆角。
 * @param {object} ctx 见文件头契约
 */
function renderAvatarTab(ctx) {
  const { sel, onAvatarEnabled, onAvatarSize, onAvatarGap, onAvatarRadius,
    onAvatarAssistant, onAvatarUser, onAvatarClearAssistant, onAvatarClearUser } = ctx;
  const on = sel.avatarEnabled === true;
  // 两个槽并排画：文案与当前值来自 AVATAR_SLOTS 与 sel，四个回调来自 ctx。
  const slotRow = (key, slot, value, onPick, onClear) =>
    avatarUploadRow(key, slot, { value: value, radius: sel.avatarRadius, onPick: onPick, onClear: onClear });
  return React.createElement(React.Fragment, null,
    switchRow(weT("启用消息头像"), on, onAvatarEnabled, {
      key: "avatar-on",
      hint: weT("给助手回复与你的消息各挂一个头像"),
    }),
    React.createElement("span", { className: "we-picker__hint", key: "avatar-what" },
      weT("用纯 CSS 画在消息旁边，不改动对话内容本身：默认关闭，打开后立刻生效")),
    on && slotRow("avatar-assistant", AVATAR_SLOTS[0], sel.avatarAssistant,
      onAvatarAssistant, onAvatarClearAssistant),
    on && slotRow("avatar-user", AVATAR_SLOTS[1], sel.avatarUser,
      onAvatarUser, onAvatarClearUser),
    // 三个几何滑杆的范围与 lib/settings-schema.js 的 KINDS 对齐（avatarSize 20..72、
    // avatarGap 0..48、avatarRadius 0..48；改范围要同时改那份 KINDS）。
    on && SliderRow(weT("头像尺寸"), 20, 72, 1, sel.avatarSize, onAvatarSize, "px", "avatar-size"),
    on && SliderRow(weT("头像间距"), 0, 40, 1, sel.avatarGap, onAvatarGap, "px", "avatar-gap"),
    on && SliderRow(weT("圆角"), 0, 48, 1, sel.avatarRadius, onAvatarRadius, "px", "avatar-radius"),
  );
}

export { renderAvatarTab };
