/**
 * packages/pet-link/src/client.js —— 「可选桌宠联动」子包的**浏览器半边入口**。
 *
 * 构建期形状（与主 bundle / packages/fx 同一套，见 scripts/build-client.mjs:894-940）：
 *   · 本文件 = 入口（对应主 bundle 的 src/client.js）；构建期只取**首个块注释之后**的正文；
 *   · 包内 INLINE_MODULES（src/pet-link-tuner.js、src/pet-link.js）被内联到正文**之前**，与正文
 *     同一 factory 作用域 ⇒ 那两份里的裸名（weT / apiUrl / apiFetch / wallSidebar*）由下面的
 *     prelude 与构建期那一行 host 绑定共同提供，兄弟文件之间**不 import**（零改动迁移）；
 *   · 顺序 = 调参面板 → 排播面（两份都会被内联，顺序即求值序）：面板读排播面的常量
 *     （PET_* / petLinkState / petLink.tuner），反过来不成立 ⇒ **不能调换**
 *     （test/verify-pet-tuner.mjs 用同一顺序求值，负对照钉着）；
 *   · 产物 = packages/pet-link/lib/client.pet-link.js，id = 子包真实包名
 *     dsh-plugin-wallpaper-engine-pet-link（与宿主 graph row 的 id 逐字相等，客户端 require 才命中）。
 *
 * ⚠️ 本文件**不许**出现 require/import：唯一例外是构建期在**客户端产物**里发出的那一行
 *    require('dsh-plugin-wallpaper-engine')（判据 test/verify-subpackage-purity.mjs 的 isClientArtifact）。
 *    源码面写 require/import 会判红（ADR-0014 S5.1）。
 *
 * 与主包的分工（收口前这半边停在主 bundle 里，主包 9 处调用点直接持对象）：
 *   · 主包只留**门面**（src/client.js 尾部的 petLink / petLinkWiring）：9 处调用点文本零改动；
 *     跨包求值顺序不保证（src/extension-registry.js 的注释：顺序必须由声明决定，不靠数组序）⇒
 *     主包把一次性接线缓冲起来，等 registerPetLink 到达时补做。
 *   · 本包是**被动**方：只登记服务，**不自起搏**（起搏 = 主包 mount effect 的 petLink.warmup() 那一次，
 *     经门面缓冲后必然到达）。本包不建订阅、不建替身，缺席语义全部由主包门面负责
 *     （mascot.tap() 缺席即抛 ⇒ 主包回落原生吉祥物行为）。
 *
 * 键集依据 = 两份被迁文件的自由标识符接缝（acorn 扫描，逐处清单见脚本
 *   .integration-notes/scratch/petlink-host-keys.mjs）：
 *   packages/pet-link/src/pet-link.js       : weT(8) · apiUrl · apiFetch · wallSidebarOpen · wallSidebarClose · wallSidebarToggle
 *   packages/pet-link/src/pet-link-tuner.js : weT（全在 `() => weT('…')` 箭头体内 ⇒ 求值期不触发 TDZ）
 *   其余"自由名"（PET_* / petLink* / petTuner* / petLinkTuner*）都在上面两份文件里声明，
 *   属**包内面**，不登记、也不该登记。
 */

/**
 * 缺键**大声失败**，不许静默 undefined
 * （ADR-0014 S5.1 / S5.4 服务面显式键集 + ADR-0013 D3③「宁可显示、不可静默消失」）。
 * 主包被关 ⇒ 本 bundle 根本不会被 require（S7.2 连坐）；能走到这里却缺键 = 键集与申报表脱钩。
 */
const PET_LINK_HOST_REQUIRED = [
  // 文案与请求面
  'weT', 'apiUrl', 'apiFetch',
  // 侧栏控制器（原生吉祥物与联动共用的一条路；回落与去程都走它）
  'wallSidebarOpen', 'wallSidebarClose', 'wallSidebarToggle',
  // 反向：主包要**调**本包（登记槽 + 缓冲补做，见 src/client.js 的门面）
  'registerPetLink',
];
for (const key of PET_LINK_HOST_REQUIRED) {
  if (!(key in host)) {
    throw new Error('[wallpaper-engine-pet-link] 主 bundle 键集缺少 "' + key
      + '"（ADR-0014 S5.1 / S5.4 显式键集：要么补键，要么改申报表，不许静默 undefined）');
  }
}
const {
  weT, apiUrl, apiFetch,
  wallSidebarOpen, wallSidebarClose, wallSidebarToggle,
  registerPetLink,
} = host;

/* ===== 登记回主包（本文件唯一的对外动作）===== */

// 主包 src/client.js 的门面收到服务后：① 转发事件期调用（performer.onGrab/onPull、mascot.tap、dispose）；
// ② 把门面缓冲的一次性接线补做（mascot.registerGesture / mascot.registerSidebar / warmup）。
// 登记是一次性的：同一份产物被求值两次会抛（src/extension-registry.js 的重复登记判据，属"大声失败"）。
// petLink 由上面内联的 src/pet-link.js 声明（同作用域裸名）。
registerPetLink(petLink);
