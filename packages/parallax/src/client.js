/**
 * packages/parallax/src/client.js —— 「3D 效果」子包的**浏览器半边入口**（拆包草案，task-3）。
 *
 * 构建期形状与 packages/fx/src/client.js 完全同形（见那份文件头的长注释）：本文件 = 入口，
 * 构建期只取**首个块注释之后**的正文；包内 INLINE_MODULES（src/parallax-layer.js、
 * src/ext-parallax.js）被内联到正文之前，与正文同一个 factory 作用域 ⇒ 那两份里的裸名由本文件的
 * prelude + 构建期那一行 host 绑定共同提供，兄弟文件之间**不 import**（零改动迁移）。
 * 注：src/ext-parallax.js 的样式归主包 src/styles.js 管，所以本包只注入"行为层 + 描述符"两份。
 *
 * ⚠️ 本文件同样**不许**出现 require/import（test/verify-subpackage-purity.mjs 的产物面判据
 *    :175-176、:201 只放行客户端产物里的 require('dsh-plugin-wallpaper-engine')）⇒ 那行绑定由构建
 *    循环 outline 在正文与内联件之前发出：`const host = require('dsh-plugin-wallpaper-engine');`。
 *    下面的 prelude 是消费侧契约。
 *
 * 键集的依据（acorn 扫描的逐行清单）：
 *   packages/parallax/src/parallax-layer.js : selection×12 · weClampTo×7 · weNow×6 · weBody×4
 *   packages/parallax/src/ext-parallax.js   : weT×28 · React×7 · SliderRow×7 · switchRow×4
 *   ⚠️ PARALLAX_PLUGIN_DEFAULT(line 60) / PARALLAX_GROUP_DEPTH_MIN / PARALLAX_GROUP_DEPTH_MAX(line 64)
 *   三枚由**同包** src/parallax-layer.js 声明 ⇒ 走包内内联，**不进**宿主键集（这是本包与 fx 包
 *   在接缝上唯一的差别）。
 */

/** 缺键**大声失败**，不许静默 undefined（ADR-0014 S5.1 / S5.4 服务面显式键集 + ADR-0013 D3③「宁可显示、不可静默消失」）。理由同 packages/fx/src/client.js。 */
const PARALLAX_HOST_REQUIRED = [
  // 内核（只读面）
  'selection', 'weNow', 'weClampTo', 'weBody',
  // 渲染助手（主 bundle 的共享零件表）
  'React', 'weT', 'switchRow', 'SliderRow',
  // 贡献面（主 bundle 的收件箱：值 + 回调，写权留主包）
  'registerExtensionModule', 'registerLayerHooks',
];
for (const key of PARALLAX_HOST_REQUIRED) {
  if (!(key in host)) {
    throw new Error('[wallpaper-engine-parallax] 主 bundle 键集缺少 "' + key
      + '"（ADR-0014 S5.1 / S5.4 显式键集：要么补键，要么改申报表，不许静默 undefined）');
  }
}
const {
  selection, weNow, weClampTo, weBody,
  React, weT, switchRow, SliderRow,
  registerExtensionModule, registerLayerHooks,
} = host;

/* ===== 贡献 ===== */

// ① 「扩展」页签的三号模块描述符（id='parallax'，resetGroup 同为 'parallax'，与包名无关）。
//    主包 src/panel-tabs.js 自 P-A（3842584e）起已不再硬编码清单：extensionModules() 只问注册表
//    （现见 :274-276 → weExtensionModules()，实现 src/extension-registry.js:89-97），这一行就是它的来源。
registerExtensionModule('parallax', PARALLAX_EXTENSION_MODULE);

// ② 行为层生命周期 + 插件槽位发现。主包 src/client.js 的作用域里**已经没有**这些裸名
//    （P-A 起只在注册表里流动，主包只按注册表调用）：挂载期订阅 :5393（→ :5383 `subscribe(hooks.sync)`）、
//    挂载后首次对时 :5512、拆卸期 :5559-5560 `hooks.dispose()`（另 :5521 退订）；
//    插件槽位 :4360 `parallaxPluginSlots: sel.parallaxPlugin === true ? weDiscoveredGroupsOf('parallax').sort() : [],`
//    ⇒ discoveredGroups 与 sync/dispose 一起注册（主包只调用、不接管实现）。
registerLayerHooks('parallax', {
  sync: syncParallaxLayer,
  dispose: disposeParallaxLayer,
  discoveredGroups: parallaxDiscoveredGroups,
});
