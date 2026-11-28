/**
 * pet-link-facade.js — 桌宠联动（packages/pet-link）的宿主侧门面，从 `src/client.js` 按族搬出，函数体逐字未改。
 *
 * 契约：
 *   1) 本文件不 import —— 构建期由 scripts/build-client.mjs 内联在正文之前，与正文同处一个扁平作用域；
 *      函数体引用的 selection / setSetting / setTransient / emit / weT / React 等自由名由正文与其它内联模块提供。
 *   2) 搬移只改了"声明住哪"：正文与拆前 src/client.js 的 4499–4571 行逐字节相同。
 *   3) 顶层状态只有字面量（若有）：不读正文的 const、不挂监听 ⇒ 无 TDZ 风险。
 */
// ── 桌宠联动（packages/pet-link）的宿主侧门面 ──────────────────────────────────────────
// 收口后这半边是**独立产物**（packages/pet-link/lib/client.pet-link.js）：它自己那一行求值，
// 再用 host.registerPetLink(petLink) 把服务登记回来。跨包求值顺序不保证（src/extensions/extension-registry.js
// 的注释：顺序必须由声明决定，不靠数组序）⇒ 主包**不许**假设子包已装载，所以这里把主包发出的
// 一次性接线先记下来，登记到达时补做（petLinkWireAttach）；之后所有调用直接转发。
// 本文件里 9 处 `petLink.*` 调用点因此**文本零改动**：它们读的就是这个作用域里的这个裸名。
//
// 缺席语义**必须**与"子包在场但没拿到运行资格"分开：
//   · mascot.tap() 在缺席时**抛错**（不是空操作）—— 下面那两处
//     `try { petLink.mascot.tap(); } catch { wallSidebarToggle(); }` 靠的就是"缺席 = 抛"来回落
//     原生吉祥物行为；空操作会让吉祥物点击在子包缺席时既不联动、也不回落（静默失效）。
//   · 其余方法缺席时安静 no-op，与"子包在场但未拿到资格"的观感一致。
const petLinkWiring = {
  armed: false,      // warmup() ⇒ true；dispose() ⇒ false（最后一次生效）
  gesture: null,     // registerGesture(cb) 的最后一次实参
  sidebarSet: false, // registerSidebar(desc) 是否调用过
  sidebar: null,     // 其最后一次实参（null = 摘下）
};

/** 登记到达时把主包已发出的一次性接线补做（补接失败只影响联动，不许带崩子包装载）。 */
function petLinkWireAttach(api) {
  try {
    if (petLinkWiring.gesture && typeof api.mascot.registerGesture === "function") {
      api.mascot.registerGesture(petLinkWiring.gesture);
    }
    if (petLinkWiring.sidebarSet && typeof api.mascot.registerSidebar === "function") {
      api.mascot.registerSidebar(petLinkWiring.sidebar);
    }
    if (petLinkWiring.armed && typeof api.warmup === "function") api.warmup();
  } catch { /* 见上：补接是尽力而为 */ }
}

/** 子包登记入口（桥键 registerPetLink）：先入槽，再把缓冲补做；返回服务本身便于子包自用。 */
function petLinkRegister(api) {
  weRegisterPetLink(api);
  petLinkWireAttach(api);
  return api;
}

const petLink = {
  performer: {
    onGrab() { const api = wePetLinkService(); if (api) api.performer.onGrab(); },
    onPull(ratio) { const api = wePetLinkService(); if (api) api.performer.onPull(ratio); },
  },
  mascot: {
    tap() {
      const api = wePetLinkService();
      if (!api) throw new Error("[wallpaper-engine] 桌宠联动浏览器半边未装载（pet-link 子包未启用 / 未构建）");
      api.mascot.tap();
    },
    registerGesture(cb) {
      petLinkWiring.gesture = cb;
      const api = wePetLinkService();
      return api ? api.mascot.registerGesture(cb) : undefined;
    },
    registerSidebar(desc) {
      petLinkWiring.sidebarSet = true;
      petLinkWiring.sidebar = desc;
      const api = wePetLinkService();
      return api ? api.mascot.registerSidebar(desc) : undefined;
    },
  },
  warmup() {
    petLinkWiring.armed = true;
    const api = wePetLinkService();
    return api ? api.warmup() : Promise.resolve(false);
  },
  dispose() {
    petLinkWiring.armed = false;
    const api = wePetLinkService();
    if (api) api.dispose();
  },
};
