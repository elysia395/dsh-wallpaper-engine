/**
 * occlusion-bridge.js — /scene-live 渲染页内的**遮挡消息桥**（由宿主注入 HTML，
 * 见 lib/routes/scene-serve.js 的 index.html 注入；经 /scene-live/occlusion-bridge.js
 * 服务，落在 WEBWALLGL_DIR 围栏内）。
 *
 * 职责：把父页（src/occlusion.js 的 1Hz postMessage）转成渲染器遮挡管线的一次调用。
 *   父页 → 本桥：{__weLive:1, op:'setOcclusion',   payload:{occluders, epoch, gen}}
 *               {__weLive:1, op:'clearOcclusion'}
 *   本桥 → 渲染器：window.__weSetOcclusion(payload)（lib/webwallgl/renderer.js 曝光，
 *          转给 webwallgl 实例的 setOcclusion；入参 = 规格 docs/wip/LINUX-OCCLUSION.md §1
 *          的 setOcclusion payload，null = 清除、回 run 档）。
 *
 * 不变量：
 *   · 只认 `e.source === window.parent` 且 `e.data.__weLive === 1` 的消息 —— 渲染页自身
 *     （iframe 内脚本 / SceneScript 沙箱）与其它窗口发的同名消息一概不认；
 *   · setOcclusion 的 payload.occluders 必须是数组（或 null），形状不对静默丢弃 ——
 *     宁可维持现状也不把坏数据喂进渲染器的迟滞状态机；
 *   · window.__weSetOcclusion 未就绪（渲染器晚启动是正常态）静默丢弃：父页的
 *     1Hz 心跳 ≤3s 内会再喂，渲染器 3s 过期规则保证旧数据不会粘住；
 *   · 本桥的任何异常都不得抛出影响渲染页（监听器入口整体 try/catch，清除入口同理）。
 */
(function () {
  'use strict';
  if (window.__weOcclusionBridge) return;   // 幂等：同一文档只装一份监听器
  window.__weOcclusionBridge = 1;
  window.addEventListener('message', function (e) {
    try {
      if (!e || e.source !== window.parent || !e.data || e.data.__weLive !== 1) return;
      var expose = window.__weSetOcclusion;
      if (typeof expose !== 'function') return;
      if (e.data.op === 'setOcclusion') {
        var payload = e.data.payload;
        if (payload && (Array.isArray(payload.occluders) || payload.occluders === null)) expose(payload);
      } else if (e.data.op === 'clearOcclusion') {
        expose(null);
      }
    } catch { /* 桥的任何异常不得影响渲染页 */ }
  });
})();
