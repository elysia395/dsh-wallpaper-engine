/**
 * packages/fx/src/client.js —— 「点击效果与拖尾效果」子包的**浏览器半边入口**。
 *
 * 构建期形状（与主 bundle 同一套，见 `scripts/build-client.mjs` 的 `stripHeader` 与包配方校验）：
 *   · 本文件 = 入口（对应主 bundle 的 src/client.js）。构建期只取**首个块注释之后**的正文；
 *   · 包内 INLINE_MODULES（packages/fx/src/fx-layer.js、packages/fx/src/ext-fx.js）被内联到正文**之前**，与正文同一个
 *     factory 作用域 ⇒ 那两份里的裸名（selection / weT / React …）由本文件的 prelude 与构建期
 *     那一行 host 绑定共同提供，兄弟文件之间**不 import**；
 *   · 产物 = packages/fx/lib/client.fx.js，id = 子包真实包名 dsh-plugin-wallpaper-engine-fx
 *     （与宿主 graph row 的 id 逐字相等，客户端 require 才命中）。
 *
 * ⚠️ 本文件**不许**出现 require/import（所以这里没有那行 host 绑定）——
 *    test/verify-subpackage-purity.mjs 的放行清单已**收紧为零**（，ADR-0014 S5.1）：包内任何文件
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
 * 键集的依据 = 两个基座/渲染器文件的**自由标识符**接缝（键集真源 = 主包 `HOST_BRIDGE_BINDINGS`）：
 *   packages/fx/src/fx-layer.js : selection · weClampTo · weNow
 *   packages/fx/src/ext-fx.js   : weT · React · SliderRow · switchRow · ctlText
 *                                 · swatchRow · FX_BLEND_VALUES
 *   FX_BLEND_VALUES 的产地在主包 lib/settings-schema.js（构建期随主 bundle 内联）⇒ 属主包叶子面。
 *   selection 是主包 src/client.js 的模块级 const 对象，**就地改字段、从不换引用** ⇒ 取一次即稳定。
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
  // 设置真源里的字面量（lib/settings-schema.js 的 FX_BLEND_VALUES，随主 bundle 内联）
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

// ① 「扩展」页签的二号模块描述符（order 2）。主包 panel-tabs 的 extensionModules() 只问注册表
//    （`weExtensionModules()`，实现 src/extension-registry.js），本行登记即它的来源。
//    id='fx' 是**页签内**的模块 id（resetGroup 同为 'fx'），与包名无关。
registerExtensionModule('fx', FX_EXTENSION_MODULE);

// ② 行为层的生命周期：主包只按注册表调用（`registerLayerHooks` 登记后，挂载/对时/拆卸时分别
//    调用 `hooks.sync` / `hooks.dispose`）。`sync` 由主包在 sel 变化 / 订阅回调里调用，`dispose`
//    由主包在行停用时调用（主包侧替本包起停 rAF 的"内容驱动"节奏不变）。
//    本包不自建订阅、不自起定时器（ADR-0014 S6.3）。
registerLayerHooks('fx', { sync: syncFxLayer, dispose: disposeFxLayer });
