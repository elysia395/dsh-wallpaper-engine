/**
 * packages/fx/src/client.js —— 「点击效果与拖尾效果」子包的**浏览器半边入口**（拆包草案，task-3）。
 *
 * 构建期形状（与主 bundle 同一套，见 scripts/build-client.mjs:541-565 / stripHeader:850）：
 *   · 本文件 = 入口（对应主 bundle 的 src/client.js）。构建期只取**首个块注释之后**的正文；
 *   · 包内 INLINE_MODULES（src/fx-layer.js、src/ext-fx.js）被内联到正文**之前**，与正文同一个
 *     factory 作用域 ⇒ 那两份里的裸名（selection / weT / React …）由本文件的 prelude 与构建期
 *     那一行 host 绑定共同提供，兄弟文件之间**不 import**（四个文件零改动迁移）；
 *   · 产物 = packages/fx/lib/client.fx.js，id = 子包真实包名 dsh-plugin-wallpaper-engine-fx
 *     （与宿主 graph row 的 id 逐字相等，客户端 require 才命中）。
 *
 * ⚠️ 本文件**不许**出现 require/import（所以这里没有那行 host 绑定）——
 *    test/verify-subpackage-purity.mjs 的放行清单已**收紧为零**（2026-10-15，ADR-0014 S5.1）：包内任何文件
 *    都不许出现主包说明符（旧的 'dsh-plugin-wallpaper-engine/subpackage-boot.js' 叶子通道作废）。
 *    唯一例外是**客户端产物** packages/<pkg>/lib/client.<short>.js 里由构建期发出的
 *    require('dsh-plugin-wallpaper-engine')（判据 isClientArtifact）。源码面写 require 会判红。
 *    ⇒ 那行绑定由构建循环的 outline 在正文/内联件之前发出（一行，属 task-1）：
 *
 *        const host = require('dsh-plugin-wallpaper-engine');
 *
 *    下面的 prelude 就是**消费侧**的契约：键名 = 主 bundle 申报表键名（lead 在
 *    scripts/build-client.mjs 的 outline 里冻结 module.exports 之后逐字对齐；若改名，
 *    **只改本文件的解构那一段**，四个兄弟文件一个字不用动）。
 *
 * 键集的依据 = 四个已迁文件的自由标识符接缝（acorn 扫描，逐行清单见 task-3 报告）：
 *   packages/fx/src/fx-layer.js : selection×14(L181-199) · weClampTo×6 · weNow×3
 *   packages/fx/src/ext-fx.js   : weT×34 · React×8 · SliderRow×6 · switchRow×3 · ctlText×2
 *                                 · swatchRow×1 · FX_BLEND_VALUES×1
 *   FX_BLEND_VALUES 的产地在主包 lib/settings-schema.js:180（构建期随主 bundle 内联）⇒ 属主包叶子面。
 *   selection 是主包 src/client.js:216 的 const 对象，**就地改字段、从不换引用** ⇒ 取一次即稳定。
 */

/**
 * 缺键**大声失败**，不许静默 undefined（ADR-0014 S5.1 / S5.4 服务面显式键集 + ADR-0013 D3③「宁可显示、不可静默消失」）。
 * 主包被关 ⇒ 本 bundle 根本不会被 require（ADR-0014 S7.2 连坐）；能走到这里却缺键 = 键集与申报表脱钩。
 */
const FX_HOST_REQUIRED = [
  // 内核（只读面）
  'selection', 'weNow', 'weClampTo',
  // 渲染助手（主 bundle 的共享零件表）
  'React', 'weT', 'switchRow', 'SliderRow', 'ctlText', 'swatchRow',
  // 设置真源里的字面量（lib/settings-schema.js:180，随主 bundle 内联）
  'FX_BLEND_VALUES',
  // 贡献面（主 bundle 的收件箱：值 + 回调，写权留主包）
  'registerExtensionModule', 'registerLayerHooks',
];
for (const key of FX_HOST_REQUIRED) {
  if (!(key in host)) {
    throw new Error('[wallpaper-engine-fx] 主 bundle 键集缺少 "' + key
      + '"（ADR-0014 S5.1 / S5.4 显式键集：要么补键，要么改申报表，不许静默 undefined）');
  }
}
const {
  selection, weNow, weClampTo,
  React, weT, switchRow, SliderRow, ctlText, swatchRow,
  FX_BLEND_VALUES,
  registerExtensionModule, registerLayerHooks,
} = host;

/* ===== 贡献（主 bundle 的 extensionModules() 改成读注册表，本包是首个贡献点）===== */

// ① 「扩展」页签的二号模块描述符（order 2）。主包 src/panel-tabs.js:274-276 自 P-A 起不再硬编码清单
//    （原文为 `return [AVATAR_EXTENSION_MODULE, FX_EXTENSION_MODULE, PARALLAX_EXTENSION_MODULE];`，
//    见 3842584e 前 :261；此处引文保留为"已删除历史"标注）；页签改为 extensionModules() →
//    weExtensionModules() 只问注册表（src/extension-registry.js:89-97），本行登记即它的来源。
//    id='fx' 是**页签内**的模块 id（resetGroup 同为 'fx'），与包名无关，保持零迁移。
registerExtensionModule('fx', FX_EXTENSION_MODULE);

// ② 行为层的生命周期。P-A（3842584e）之前主包 src/client.js 曾有 3 处裸名直接引用：
//      5365 `const unsubFx = subscribe(syncFxLayer);` · 5492 `syncFxLayer();` · 5536 `disposeFxLayer();`
//    P-A 起这些引用已删除，改由注册表转发：本行 registerLayerHooks 登记后，主包 :5383 attachLayer
//    里 `subscribe(hooks.sync)`、:5512 挂载对时 `hooks.sync()`、:5559 拆卸时 `hooks.dispose()` 逐层调用。
//    sync 由主包在 sel 变化 / 订阅回调里调用，dispose 由主包在行停用时调用（主包侧替本包起停 rAF
//    的"内容驱动"节奏不变）。本包不自建订阅、不自起定时器（ADR-0014 S6.3）。
registerLayerHooks('fx', { sync: syncFxLayer, dispose: disposeFxLayer });
