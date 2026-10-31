# 守卫映射（生成物，勿手改）

> 由 `node test/tools/guard-targets.mjs --write` 重算；`test/verify-guard-map.mjs` 会重算并逐字比对。
> **怎么用**：改了 `src/` 或 `lib/` 的某个模块，在「模块 → 守卫」那张表里查该跑哪几条。
> 口径：只统计守卫**代码**里真正碰到的模块（先剥注释），并区分"直接读源文件"与"隔着产物 `lib/client.js`"。
> 写法：字面量路径 / `join(...)` 拼接 / 唯一 basename / 产物配方 / **前缀族读法** `scopeFiles|scopeText(<前缀>)` / **经共享族助手读**（`import { panelText } from './tools/src-scope.mjs'` + 真调用；族口径封在那个库里，见 DEV-GUIDE §4.6「同时是守卫的库」）/ **真源定位读**（`locate('符号')` / `locateFile('文件名')`，`test/tools/source-locator.mjs`：符号唯一声明在哪就是读了哪个模块）。

模块面 190 个 · 守卫 119 个

## 守卫 → 模块

| 守卫 | 直接读的模块 | 隔着产物 |
|---|---|:--:|
| `compat-harness-live.mjs` | — |  |
| `compat-harness-pages.mjs` | — |  |
| `compat-harness-surfaces.mjs` | — |  |
| `e2e-web-media-origin.mjs` | `lib/index.js` `packages/media-bridge/lib/provision.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` `src/quick-panel.js` `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` |  |
| `fontset-load-smoke.mjs` | — | ✅ |
| `live-frame-async-identity-smoke.mjs` | — | ✅ |
| `live-frame-backfill-smoke.mjs` | — | ✅ |
| `rotation-live-smoke.mjs` | — | ✅ |
| `rotation-prepared-leak-smoke.mjs` | — | ✅ |
| `rotation-smoke.mjs` | — | ✅ |
| `verify-about.mjs` | `lib/host-boot.js` `lib/index.js` `lib/json-response.js` `packages/about-notice/lib/index.js` `packages/about-notice/lib/routes/about-qr.js` `packages/about-notice/lib/routes/github-stars.js` `src/about-assets.js` `src/client.js` `src/i18n-copy-core.js` `src/i18n-copy-ext.js` `src/i18n-copy-font.js` `src/i18n-copy-glass.js` `src/i18n-copy-live.js` `src/i18n-copy-panel.js` `src/i18n-copy-pet-link.js` `src/i18n-copy-picker.js` `src/i18n-copy.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` | ✅ |
| `verify-adapter.mjs` | `lib/index.js` `lib/settings-schema.js` `src/adapter.js` `src/client.js` `src/effects.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` `src/persistence.js` `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` |  |
| `verify-api-client.mjs` | `src/api-client.js` `src/client.js` `src/panel-tabs.js` | ✅ |
| `verify-asset-paths.mjs` | `lib/media/media-dirs.js` `lib/upload-dir.js` `lib/we-assets.js` |  |
| `verify-avatar-interval-and-rotation.mjs` | `lib/fs-paths.js` `lib/inventory.js` `lib/media/image-preview.js` `lib/routes/inventory.js` `lib/routes/media-bytes.js` `lib/serve.js` `lib/settings-schema.js` `lib/upload-dir.js` `lib/upload-store.js` `src/avatar-layer.js` `src/client.js` `src/ext-avatar.js` `src/panel-tabs-wallpaper.js` `src/video-layer.js` |  |
| `verify-body-caps.mjs` | `lib/http-body.js` `lib/routes/upload.js` | ✅ |
| `verify-bridge-ci.mjs` | — |  |
| `verify-bundle-rows.mjs` | `lib/host-boot.js` `lib/index.js` `lib/kernel/component-session.js` `lib/kernel/host-kernel.js` `lib/subpackage-boot.js` |  |
| `verify-cache-dir.mjs` | `lib/faststart.js` `lib/index.js` `lib/kernel/data-dir.js` `lib/media/frame-store.js` `lib/media/media-dirs.js` `lib/media/transcode.js` `lib/media/video-preview.js` `lib/routes/cache-dir.js` `lib/upload-dir.js` `packages/media-bridge/lib/backend.js` `packages/media-bridge/lib/legacy.js` `packages/media-bridge/lib/routes/now-playing.js` |  |
| `verify-cache-prune.mjs` | `lib/media/transcode.js` `lib/media/video-preview.js` |  |
| `verify-child-kill.mjs` | `lib/media/transcode.js` `packages/media-bridge/lib/legacy.js` | ✅ |
| `verify-ci-routing.mjs` | — |  |
| `verify-ci-steps.mjs` | — |  |
| `verify-client-sync.mjs` | — | ✅ |
| `verify-client.mjs` | `lib/index.js` `lib/kernel/data-dir.js` `lib/settings-schema.js` `packages/fonts/src/appearance-font-section.js` `src/client.js` `src/effects.js` `src/focus-handback.js` `src/font/apply.js` `src/fontset-store.js` `src/glass-panel.js` `src/glass.js` `src/live-layer-watch.js` `src/live-layer.js` `src/media-prep.js` `src/nav-icon.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` `src/persistence.js` `src/picker-modal.js` `src/picker-props-panel.js` `src/preset-store.js` `src/quick-panel.js` `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` `src/system-fonts.js` `src/theme-follow.js` `src/video-layer.js` `src/we-cond.js` | ✅ |
| `verify-component-face.mjs` | `lib/host-boot.js` `lib/kernel/component-session.js` `lib/kernel/host-kernel.js` |  |
| `verify-component-fonts.mjs` | `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/font/apply.js` `src/font/components.js` | ✅ |
| `verify-component-visibility.mjs` | `lib/component-visibility.js` `lib/kernel/component-session.js` `lib/routes/inventory.js` `src/panel-tabs.js` |  |
| `verify-config-store.mjs` | `lib/kernel/config.js` `lib/media/transcode.js` |  |
| `verify-contracts.mjs` | `lib/host-boot.js` `lib/index.js` `lib/kernel/host-kernel.js` `lib/media/media-dirs.js` `lib/settings-schema.js` `packages/fonts/lib/routes/fontsets.js` `packages/fonts/src/fontset-editor.js` `packages/mascot-avatar/lib/routes/avatar.js` `packages/mascot-avatar/lib/routes/mascot.js` `packages/media-bridge/lib/backend.js` `packages/media-bridge/lib/index.js` `packages/media-bridge/lib/legacy.js` `packages/media-bridge/lib/supervisor.js` `src/api-client.js` `src/client.js` `src/fontset-store.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` |  |
| `verify-dead-declarations.mjs` | — |  |
| `verify-deployment.mjs` | — |  |
| `verify-eol.mjs` | — |  |
| `verify-extra-glass.mjs` | `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/glass-extra.js` `src/glass-panel.js` `src/quick-panel.js` | ✅ |
| `verify-fontset.mjs` | `lib/index.js` `lib/settings-schema.js` `packages/fonts/lib/index.js` `packages/fonts/src/appearance-font-section.js` `packages/fonts/src/fontset-editor.js` `src/client.js` `src/extension-registry.js` `src/font/apply.js` `src/font/color-roles.js` `src/font/components.js` `src/font/typography.js` `src/fontset-store.js` `src/glass-panel.js` `src/media-prep.js` `src/module-reset.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` `src/picker-modal.js` `src/picker-props-panel.js` `src/section-head.js` `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` `src/system-fonts.js` `src/we-cond.js` | ✅ |
| `verify-glass-compat.mjs` | `lib/settings-schema.js` `src/glass-panel.js` |  |
| `verify-glass-compositing.mjs` | — | ✅ |
| `verify-glass-runtime-browser.mjs` | — | ✅ |
| `verify-glass-runtime.mjs` | `src/glass-surfaces.js` | ✅ |
| `verify-glass-surfaces.mjs` | `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/glass-panel.js` `src/glass-surfaces.js` `src/glass.js` `src/live-layer-diag.js` `src/live-layer-gate.js` `src/live-layer-pointer.js` `src/live-layer-underlay.js` `src/live-layer-watch.js` `src/live-layer.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` | ✅ |
| `verify-guard-chain.mjs` | — |  |
| `verify-host-diag.mjs` | `lib/diag-trace.js` |  |
| `verify-host-paint-scope.mjs` | — | ✅ |
| `verify-host-teardown.mjs` | `lib/index.js` |  |
| `verify-i18n.mjs` | `packages/pet-link/src/pet-link/extension-card.js` `packages/pet-link/src/pet-link/i18n.js` `packages/pet-link/src/pet-link/panel-params.js` `packages/pet-link/src/pet-link/panel.js` `src/client.js` `src/i18n-copy.js` `src/i18n.js` `src/nav-icon.js` `src/quick-panel.js` `src/sidebar-right.js` `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` | ✅ |
| `verify-inject-contracts.mjs` | `lib/subpackage-boot.js` |  |
| `verify-inventory-index.mjs` | `lib/inventory.js` |  |
| `verify-issue-claim-policy.mjs` | — |  |
| `verify-json-response.mjs` | `lib/json-response.js` `lib/subpackage-boot.js` | ✅ |
| `verify-logging.mjs` | `lib/host-boot.js` `lib/index.js` `lib/kernel/host-kernel.js` `lib/kernel/host-session.js` `lib/log.js` `lib/notice.js` `lib/routes/diag.js` `lib/routes/scene-serve.js` `lib/serve.js` `lib/webwallgl/renderer.js` `src/live-layer-diag.js` `src/live-layer-gate.js` `src/live-layer-pointer.js` `src/live-layer-underlay.js` `src/live-layer-watch.js` `src/live-layer.js` |  |
| `verify-media-bridge.mjs` | `packages/media-bridge/lib/backend.js` `packages/media-bridge/lib/provision.js` `packages/media-bridge/lib/supervisor.js` |  |
| `verify-media-probe.mjs` | `lib/media/mp4-probe.js` |  |
| `verify-module-layout.mjs` | `lib/index.js` `lib/settings-schema.js` `src/client.js` | ✅ |
| `verify-mp4-vfs.mjs` | `lib/faststart.js` `lib/host-boot.js` `lib/kernel/host-session.js` `lib/mp4-vfs.js` |  |
| `verify-notice-routing.mjs` | `lib/index.js` `src/client.js` |  |
| `verify-occlusion-client.mjs` | `src/api-client.js` `src/live-layer-diag.js` `src/live-layer-gate.js` `src/live-layer-pointer.js` `src/live-layer-underlay.js` `src/live-layer-watch.js` `src/live-layer.js` `src/occlusion.js` | ✅ |
| `verify-occlusion-hub.mjs` | `lib/index.js` `lib/json-response.js` `lib/occlusion/index.js` `lib/occlusion/rects.js` `lib/occlusion/x11.js` `lib/routes/occlusion.js` |  |
| `verify-package-files.mjs` | `lib/http-body.js` `lib/index.js` `lib/pkg-read.js` `lib/routes/upload.js` | ✅ |
| `verify-package-publish.mjs` | `lib/index.js` `lib/pkg-read.js` `src/client.js` | ✅ |
| `verify-pet-egg.mjs` | `packages/pet-link/src/pet-link.js` `packages/pet-link/src/pet-link/bubble.js` `packages/pet-link/src/pet-link/constants.js` `packages/pet-link/src/pet-link/linked-egg1.js` `packages/pet-link/src/pet-link/linked-egg2.js` `packages/pet-link/src/pet-link/linked-mascot.js` `packages/pet-link/src/pet-link/linked-shared.js` `packages/pet-link/src/pet-link/linked-sidebar.js` `packages/pet-link/src/pet-link/linked.js` `packages/pet-link/src/pet-link/mode.js` `packages/pet-link/src/pet-link/native.js` |  |
| `verify-pet-extension-card.mjs` | `packages/pet-link/src/pet-link/extension-card.js` `packages/pet-link/src/pet-link/i18n.js` `src/extension-registry.js` |  |
| `verify-pet-hotplug-client.mjs` | `packages/pet-link/src/official-pet.js` `packages/pet-link/src/pet-link-performer.js` |  |
| `verify-pet-hotplug-host.mjs` | `lib/subpackage-boot.js` `packages/pet-link/lib/index.js` `packages/pet-link/lib/official-provider.js` `packages/pet-link/lib/routes/official-pet.js` `packages/pet-link/src/official-pet.js` |  |
| `verify-pet-hotplug-integration.mjs` | `lib/subpackage-boot.js` `packages/pet-link/lib/index.js` |  |
| `verify-pet-install.mjs` | `lib/index.js` `packages/pet-link/lib/pet-install/run-pnpm.js` `packages/pet-link/lib/pet-install/tar.js` `packages/pet-link/lib/pet-install/transaction.js` `packages/pet-link/lib/routes/pet-install.js` |  |
| `verify-pet-link.mjs` | — |  |
| `verify-pet-linked.mjs` | `packages/pet-link/src/pet-link.js` `packages/pet-link/src/pet-link/bubble.js` `packages/pet-link/src/pet-link/constants.js` `packages/pet-link/src/pet-link/linked-egg1.js` `packages/pet-link/src/pet-link/linked-egg2.js` `packages/pet-link/src/pet-link/linked-mascot.js` `packages/pet-link/src/pet-link/linked-shared.js` `packages/pet-link/src/pet-link/linked-sidebar.js` `packages/pet-link/src/pet-link/linked.js` `packages/pet-link/src/pet-link/mode.js` `packages/pet-link/src/pet-link/native.js` |  |
| `verify-pet-mascot.mjs` | `packages/pet-link/src/pet-link.js` `packages/pet-link/src/pet-link/bubble.js` `packages/pet-link/src/pet-link/constants.js` `packages/pet-link/src/pet-link/linked-egg1.js` `packages/pet-link/src/pet-link/linked-egg2.js` `packages/pet-link/src/pet-link/linked-mascot.js` `packages/pet-link/src/pet-link/linked-shared.js` `packages/pet-link/src/pet-link/linked-sidebar.js` `packages/pet-link/src/pet-link/linked.js` `packages/pet-link/src/pet-link/mode.js` `packages/pet-link/src/pet-link/native.js` |  |
| `verify-pet-official.mjs` | `lib/subpackage-boot.js` `packages/pet-link/lib/index.js` `packages/pet-link/src/official-pet.js` `packages/pet-link/src/pet-link-performer.js` |  |
| `verify-pet-optional-probe.mjs` | `packages/pet-link/lib/index.js` `packages/pet-link/src/pet-link.js` `packages/pet-link/src/pet-link/bubble.js` `packages/pet-link/src/pet-link/constants.js` `packages/pet-link/src/pet-link/linked-egg1.js` `packages/pet-link/src/pet-link/linked-egg2.js` `packages/pet-link/src/pet-link/linked-mascot.js` `packages/pet-link/src/pet-link/linked-shared.js` `packages/pet-link/src/pet-link/linked-sidebar.js` `packages/pet-link/src/pet-link/linked.js` `packages/pet-link/src/pet-link/mode.js` `packages/pet-link/src/pet-link/native.js` |  |
| `verify-pet-package.mjs` | `lib/index.js` `lib/subpackage-boot.js` `packages/pet-link/lib/index.js` `src/sidebar-right.js` |  |
| `verify-pet-panel.mjs` | `packages/pet-link/src/pet-link.js` `packages/pet-link/src/pet-link/bubble.js` `packages/pet-link/src/pet-link/constants.js` `packages/pet-link/src/pet-link/linked-egg1.js` `packages/pet-link/src/pet-link/linked-egg2.js` `packages/pet-link/src/pet-link/linked-mascot.js` `packages/pet-link/src/pet-link/linked-shared.js` `packages/pet-link/src/pet-link/linked-sidebar.js` `packages/pet-link/src/pet-link/linked.js` `packages/pet-link/src/pet-link/mode.js` `packages/pet-link/src/pet-link/native.js` `packages/pet-link/src/pet-link/panel-params.js` `packages/pet-link/src/pet-link/panel.js` |  |
| `verify-pet-rope-entry.mjs` | `src/client.js` |  |
| `verify-pet-sidebar-diag.mjs` | `src/client.js` |  |
| `verify-pet-sidebar-glass-browser-case.mjs` | — |  |
| `verify-pet-sidebar-glass.mjs` | `src/glass-surfaces.js` |  |
| `verify-pet-sidebar-rebound.mjs` | `src/client.js` `src/sidebar-right.js` |  |
| `verify-pet-tuner-browser.mjs` | `packages/pet-link/lib/prepared.js` `packages/pet-link/src/pet-link-performer.js` `packages/pet-link/src/pet-link-tuner.js` |  |
| `verify-pet-tuner-coverage.mjs` | `packages/pet-link/src/pet-link/panel-params.js` `packages/pet-link/src/pet-link/panel.js` |  |
| `verify-pet-tuner.mjs` | `packages/pet-link/src/pet-link-performer.js` `packages/pet-link/src/pet-link-tuner.js` |  |
| `verify-picker-model.mjs` | `src/picker-model.js` | ✅ |
| `verify-picker-props.mjs` | — | ✅ |
| `verify-picker-upload.mjs` | — | ✅ |
| `verify-playback-controls.mjs` | — | ✅ |
| `verify-presets.mjs` | `lib/index.js` `lib/media/media-dirs.js` `lib/routes/presets.js` `lib/settings-schema.js` `src/client.js` `src/glass-panel.js` `src/i18n-copy-core.js` `src/i18n-copy-ext.js` `src/i18n-copy-font.js` `src/i18n-copy-glass.js` `src/i18n-copy-live.js` `src/i18n-copy-panel.js` `src/i18n-copy-pet-link.js` `src/i18n-copy-picker.js` `src/i18n-copy.js` `src/persistence.js` `src/preset-store.js` `src/quick-panel.js` | ✅ |
| `verify-reachability.mjs` | `lib/index.js` | ✅ |
| `verify-readability.mjs` | `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` | ✅ |
| `verify-release-set.mjs` | `lib/index.js` `lib/subpackage-boot.js` |  |
| `verify-retired-lines.mjs` | — |  |
| `verify-route-families.mjs` | `packages/pet-link/lib/routes/pet-install.js` |  |
| `verify-route-index.mjs` | `lib/index.js` `lib/kernel/component-session.js` `lib/routes/inventory.js` `lib/routes/media-bytes.js` |  |
| `verify-route-ownership.mjs` | `lib/index.js` `lib/kernel/component-session.js` |  |
| `verify-scene-frame-master.mjs` | `lib/index.js` `lib/routes/scene-frame.js` |  |
| `verify-scene-live-occlusion.mjs` | `lib/webwallgl/occlusion-bridge.js` `lib/webwallgl/renderer.js` |  |
| `verify-scene-live.mjs` | `lib/cache-dir.js` `lib/diag-trace.js` `lib/faststart.js` `lib/fs-paths.js` `lib/http-lifecycle.js` `lib/index.js` `lib/inventory.js` `lib/media-origin.js` `lib/mp4-vfs.js` `lib/routes/diag.js` `lib/routes/media-bytes.js` `lib/routes/scene-serve.js` `lib/routes/we-assets.js` `lib/serve.js` `lib/settings-schema.js` `lib/shim-seed.js` `lib/startup-sweep.js` `lib/upload-dir.js` `lib/upload-store.js` `lib/we-assets.js` `lib/we-focus-guard.js` `lib/we-props.js` `lib/webwallgl/renderer.js` `packages/fonts/src/appearance-font-section.js` `packages/fx/src/ext-fx.js` `packages/fx/src/fx-layer.js` `packages/media-bridge/lib/index.js` `packages/media-bridge/lib/legacy.js` `packages/media-bridge/lib/provision.js` `packages/media-bridge/lib/routes/now-playing.js` `packages/media-bridge/lib/supervisor.js` `packages/parallax/src/ext-parallax.js` `packages/parallax/src/parallax-layer.js` `src/avatar-import.js` `src/avatar-layer.js` `src/client-audio-playback.js` `src/client-media-frame.js` `src/client-rotation.js` `src/client.js` `src/effects.js` `src/ext-avatar.js` `src/extension-registry.js` `src/font/color-roles.js` `src/font/typography.js` `src/glass-panel.js` `src/layer-core.js` `src/live-layer-diag.js` `src/live-layer-gate.js` `src/live-layer-pointer.js` `src/live-layer-underlay.js` `src/live-layer-watch.js` `src/live-layer.js` `src/media-prep.js` `src/module-reset.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` `src/picker-modal.js` `src/quick-panel.js` `src/section-head.js` `src/sidebar-right.js` `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` `src/system-fonts.js` `src/video-layer.js` `src/we-base.js` `src/we-cond.js` | ✅ |
| `verify-scene-probe.mjs` | `lib/media/scene-probe.js` `lib/pkg-read.js` `lib/scene-manifest.js` |  |
| `verify-scene.mjs` | `lib/index.js` `lib/kernel/host-kernel.js` `lib/kernel/host-session.js` `lib/media/frame-store.js` `lib/pkg-read.js` `lib/routes/live-frame.js` `lib/routes/media-bytes.js` `lib/routes/props.js` `lib/routes/scene-frame.js` `lib/routes/scene-media.js` `lib/routes/settings.js` `lib/scene-manifest.js` | ✅ |
| `verify-settings-namespaces.mjs` | `lib/index.js` `lib/kernel/data-dir.js` `lib/routes/settings.js` `lib/settings-schema.js` `src/persistence.js` |  |
| `verify-settings-schema-exports.mjs` | `lib/index.js` `lib/subpackage-boot.js` | ✅ |
| `verify-softrender.mjs` | — | ✅ |
| `verify-static.mjs` | — |  |
| `verify-steam-discovery.mjs` | `lib/index.js` `lib/steam-discovery.js` |  |
| `verify-subpackage-boot.mjs` | `lib/index.js` `lib/subpackage-boot.js` |  |
| `verify-subpackage-client-half.mjs` | — | ✅ |
| `verify-subpackage-manifests.mjs` | `lib/kernel/component-session.js` `lib/subpackage-boot.js` |  |
| `verify-subpackage-purity.mjs` | `lib/host-boot.js` `lib/index.js` `lib/subpackage-boot.js` `packages/fonts/src/client.js` `src/client.js` `src/fontset-store.js` |  |
| `verify-subpackage-toggle-roundtrip.mjs` | `lib/index.js` `lib/subpackage-boot.js` `packages/fonts/src/client.js` `src/client.js` `src/extension-registry.js` `src/panel-tabs-appearance.js` `src/panel-tabs.js` | ✅ |
| `verify-system-fonts.mjs` | `lib/json-response.js` `lib/settings-schema.js` `packages/fonts/lib/routes/system-fonts.js` `packages/fonts/src/appearance-font-section.js` `src/client.js` `src/font/typography.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` `src/quick-panel.js` `src/system-fonts.js` | ✅ |
| `verify-theme-follow.mjs` | `lib/settings-schema.js` `src/client.js` `src/live-layer-diag.js` `src/live-layer-gate.js` `src/live-layer-pointer.js` `src/live-layer-underlay.js` `src/live-layer-watch.js` `src/live-layer.js` `src/media-prep.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` `src/theme-follow.js` | ✅ |
| `verify-theme-layer.mjs` | `lib/settings-schema.js` `packages/fonts/src/appearance-font-section.js` `src/client.js` `src/effects.js` `src/font/apply.js` `src/font/color-roles.js` `src/font/typography.js` `src/panel-tabs-advanced.js` `src/panel-tabs-appearance.js` `src/panel-tabs-effects.js` `src/panel-tabs-mascot.js` `src/panel-tabs-wallpaper.js` `src/panel-tabs.js` | ✅ |
| `verify-token-contract.mjs` | `src/styles-base.js` `src/styles-chrome.js` `src/styles-ext.js` `src/styles-panel.js` `src/styles-quick.js` `src/styles-settings.js` `src/styles-shell.js` `src/styles-sidebar.js` `src/styles.js` |  |
| `verify-transcode-state.mjs` | `lib/index.js` `lib/media/transcode.js` `lib/routes/media-derived.js` `src/client.js` `src/media-prep.js` `src/video-layer.js` | ✅ |
| `verify-types.mjs` | `lib/index.js` `lib/inventory.js` `src/client.js` | ✅ |
| `verify-undefined-refs.mjs` | — |  |
| `verify-upload-store.mjs` | `lib/index.js` `lib/kernel/config.js` `lib/kernel/data-dir.js` `lib/upload-dir.js` `lib/upload-store.js` |  |
| `verify-video-preview.mjs` | `lib/media/video-preview.js` |  |
| `verify-wallpaper-scan.mjs` | `lib/fs-paths.js` `lib/wallpaper-scan.js` |  |
| `verify-we-install-probe.mjs` | `lib/index.js` `lib/inventory.js` `lib/steam-discovery.js` |  |
| `verify-windows-caption.mjs` | — | ✅ |

## 模块 → 守卫

| 模块 | 守卫数 | 守卫 |
|---|---:|---|
| `lib/cache-dir.js` | 1 | `verify-scene-live` |
| `lib/client.js` | 45 | `fontset-load-smoke` `live-frame-async-identity-smoke` `live-frame-backfill-smoke` `rotation-live-smoke` `rotation-prepared-leak-smoke` `rotation-smoke` `verify-about` `verify-api-client` `verify-body-caps` `verify-child-kill` `verify-client-sync` `verify-client` `verify-component-fonts` `verify-extra-glass` `verify-fontset` `verify-glass-compositing` `verify-glass-runtime-browser` `verify-glass-runtime` `verify-glass-surfaces` `verify-host-paint-scope` `verify-i18n` `verify-json-response` `verify-module-layout` `verify-occlusion-client` `verify-package-files` `verify-package-publish` `verify-picker-model` `verify-picker-props` `verify-picker-upload` `verify-playback-controls` `verify-presets` `verify-reachability` `verify-readability` `verify-scene-live` `verify-scene` `verify-settings-schema-exports` `verify-softrender` `verify-subpackage-client-half` `verify-subpackage-toggle-roundtrip` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` `verify-transcode-state` `verify-types` `verify-windows-caption` |
| `lib/component-visibility.js` | 1 | `verify-component-visibility` |
| `lib/diag-trace.js` | 2 | `verify-host-diag` `verify-scene-live` |
| `lib/faststart.js` | 3 | `verify-cache-dir` `verify-mp4-vfs` `verify-scene-live` |
| `lib/fs-paths.js` | 3 | `verify-avatar-interval-and-rotation` `verify-scene-live` `verify-wallpaper-scan` |
| `lib/host-boot.js` | 7 | `verify-about` `verify-bundle-rows` `verify-component-face` `verify-contracts` `verify-logging` `verify-mp4-vfs` `verify-subpackage-purity` |
| `lib/http-body.js` | 2 | `verify-body-caps` `verify-package-files` |
| `lib/http-lifecycle.js` | 1 | `verify-scene-live` |
| `lib/index.js` | 35 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-bundle-rows` `verify-cache-dir` `verify-client` `verify-contracts` `verify-fontset` `verify-host-teardown` `verify-logging` `verify-module-layout` `verify-notice-routing` `verify-occlusion-hub` `verify-package-files` `verify-package-publish` `verify-pet-install` `verify-pet-package` `verify-presets` `verify-reachability` `verify-release-set` `verify-route-index` `verify-route-ownership` `verify-scene-frame-master` `verify-scene-live` `verify-scene` `verify-settings-namespaces` `verify-settings-schema-exports` `verify-steam-discovery` `verify-subpackage-boot` `verify-subpackage-purity` `verify-subpackage-toggle-roundtrip` `verify-transcode-state` `verify-types` `verify-upload-store` `verify-we-install-probe` |
| `lib/inventory.js` | 5 | `verify-avatar-interval-and-rotation` `verify-inventory-index` `verify-scene-live` `verify-types` `verify-we-install-probe` |
| `lib/json-response.js` | 4 | `verify-about` `verify-json-response` `verify-occlusion-hub` `verify-system-fonts` |
| `lib/kernel/component-session.js` | 6 | `verify-bundle-rows` `verify-component-face` `verify-component-visibility` `verify-route-index` `verify-route-ownership` `verify-subpackage-manifests` |
| `lib/kernel/config.js` | 2 | `verify-config-store` `verify-upload-store` |
| `lib/kernel/data-dir.js` | 4 | `verify-cache-dir` `verify-client` `verify-settings-namespaces` `verify-upload-store` |
| `lib/kernel/host-kernel.js` | 5 | `verify-bundle-rows` `verify-component-face` `verify-contracts` `verify-logging` `verify-scene` |
| `lib/kernel/host-session.js` | 3 | `verify-logging` `verify-mp4-vfs` `verify-scene` |
| `lib/log.js` | 1 | `verify-logging` |
| `lib/media-origin.js` | 1 | `verify-scene-live` |
| `lib/media/frame-store.js` | 2 | `verify-cache-dir` `verify-scene` |
| `lib/media/image-preview.js` | 1 | `verify-avatar-interval-and-rotation` |
| `lib/media/media-dirs.js` | 4 | `verify-asset-paths` `verify-cache-dir` `verify-contracts` `verify-presets` |
| `lib/media/mp4-probe.js` | 1 | `verify-media-probe` |
| `lib/media/scene-probe.js` | 1 | `verify-scene-probe` |
| `lib/media/transcode.js` | 5 | `verify-cache-dir` `verify-cache-prune` `verify-child-kill` `verify-config-store` `verify-transcode-state` |
| `lib/media/video-preview.js` | 3 | `verify-cache-dir` `verify-cache-prune` `verify-video-preview` |
| `lib/mp4-vfs.js` | 2 | `verify-mp4-vfs` `verify-scene-live` |
| `lib/notice.js` | 1 | `verify-logging` |
| `lib/occlusion/index.js` | 1 | `verify-occlusion-hub` |
| `lib/occlusion/rects.js` | 1 | `verify-occlusion-hub` |
| `lib/occlusion/x11.js` | 1 | `verify-occlusion-hub` |
| `lib/pkg-read.js` | 4 | `verify-package-files` `verify-package-publish` `verify-scene-probe` `verify-scene` |
| `lib/routes/cache-dir.js` | 1 | `verify-cache-dir` |
| `lib/routes/diag.js` | 2 | `verify-logging` `verify-scene-live` |
| `lib/routes/inventory.js` | 3 | `verify-avatar-interval-and-rotation` `verify-component-visibility` `verify-route-index` |
| `lib/routes/live-frame.js` | 1 | `verify-scene` |
| `lib/routes/media-bytes.js` | 4 | `verify-avatar-interval-and-rotation` `verify-route-index` `verify-scene-live` `verify-scene` |
| `lib/routes/media-derived.js` | 1 | `verify-transcode-state` |
| `lib/routes/occlusion.js` | 1 | `verify-occlusion-hub` |
| `lib/routes/presets.js` | 1 | `verify-presets` |
| `lib/routes/props.js` | 1 | `verify-scene` |
| `lib/routes/scene-frame.js` | 2 | `verify-scene-frame-master` `verify-scene` |
| `lib/routes/scene-media.js` | 1 | `verify-scene` |
| `lib/routes/scene-serve.js` | 2 | `verify-logging` `verify-scene-live` |
| `lib/routes/settings.js` | 2 | `verify-scene` `verify-settings-namespaces` |
| `lib/routes/upload.js` | 2 | `verify-body-caps` `verify-package-files` |
| `lib/routes/we-assets.js` | 1 | `verify-scene-live` |
| `lib/scene-manifest.js` | 2 | `verify-scene-probe` `verify-scene` |
| `lib/serve.js` | 3 | `verify-avatar-interval-and-rotation` `verify-logging` `verify-scene-live` |
| `lib/settings-schema.js` | 16 | `verify-adapter` `verify-avatar-interval-and-rotation` `verify-client` `verify-component-fonts` `verify-contracts` `verify-extra-glass` `verify-fontset` `verify-glass-compat` `verify-glass-surfaces` `verify-module-layout` `verify-presets` `verify-scene-live` `verify-settings-namespaces` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `lib/shim-seed.js` | 1 | `verify-scene-live` |
| `lib/startup-sweep.js` | 1 | `verify-scene-live` |
| `lib/steam-discovery.js` | 2 | `verify-steam-discovery` `verify-we-install-probe` |
| `lib/subpackage-boot.js` | 13 | `verify-bundle-rows` `verify-inject-contracts` `verify-json-response` `verify-pet-hotplug-host` `verify-pet-hotplug-integration` `verify-pet-official` `verify-pet-package` `verify-release-set` `verify-settings-schema-exports` `verify-subpackage-boot` `verify-subpackage-manifests` `verify-subpackage-purity` `verify-subpackage-toggle-roundtrip` |
| `lib/upload-dir.js` | 5 | `verify-asset-paths` `verify-avatar-interval-and-rotation` `verify-cache-dir` `verify-scene-live` `verify-upload-store` |
| `lib/upload-store.js` | 3 | `verify-avatar-interval-and-rotation` `verify-scene-live` `verify-upload-store` |
| `lib/wallpaper-scan.js` | 1 | `verify-wallpaper-scan` |
| `lib/we-assets.js` | 2 | `verify-asset-paths` `verify-scene-live` |
| `lib/we-focus-guard.js` | 1 | `verify-scene-live` |
| `lib/we-props.js` | 1 | `verify-scene-live` |
| `lib/webwallgl/occlusion-bridge.js` | 1 | `verify-scene-live-occlusion` |
| `lib/webwallgl/renderer.js` | 3 | `verify-logging` `verify-scene-live-occlusion` `verify-scene-live` |
| `packages/about-notice/lib/index.js` | 1 | `verify-about` |
| `packages/about-notice/lib/routes/about-qr.js` | 1 | `verify-about` |
| `packages/about-notice/lib/routes/github-stars.js` | 1 | `verify-about` |
| `packages/fonts/lib/client.fonts.js` | 5 | `fontset-load-smoke` `verify-client-sync` `verify-client` `verify-subpackage-purity` `verify-system-fonts` |
| `packages/fonts/lib/index.js` | 1 | `verify-fontset` |
| `packages/fonts/lib/routes/fontsets.js` | 1 | `verify-contracts` |
| `packages/fonts/lib/routes/system-fonts.js` | 1 | `verify-system-fonts` |
| `packages/fonts/src/appearance-font-section.js` | 5 | `verify-client` `verify-fontset` `verify-scene-live` `verify-system-fonts` `verify-theme-layer` |
| `packages/fonts/src/client.js` | 2 | `verify-subpackage-purity` `verify-subpackage-toggle-roundtrip` |
| `packages/fonts/src/fontset-editor.js` | 2 | `verify-contracts` `verify-fontset` |
| `packages/fx/lib/client.fx.js` | 4 | `verify-client-sync` `verify-client` `verify-scene-live` `verify-subpackage-client-half` |
| `packages/fx/lib/index.js` | 0 | **（无）** |
| `packages/fx/src/client.js` | 0 | **（无）** |
| `packages/fx/src/ext-fx.js` | 1 | `verify-scene-live` |
| `packages/fx/src/fx-layer.js` | 1 | `verify-scene-live` |
| `packages/mascot-avatar/lib/index.js` | 0 | **（无）** |
| `packages/mascot-avatar/lib/routes/avatar.js` | 1 | `verify-contracts` |
| `packages/mascot-avatar/lib/routes/mascot.js` | 1 | `verify-contracts` |
| `packages/media-bridge/lib/backend.js` | 3 | `verify-cache-dir` `verify-contracts` `verify-media-bridge` |
| `packages/media-bridge/lib/index.js` | 2 | `verify-contracts` `verify-scene-live` |
| `packages/media-bridge/lib/legacy.js` | 4 | `verify-cache-dir` `verify-child-kill` `verify-contracts` `verify-scene-live` |
| `packages/media-bridge/lib/provision.js` | 3 | `e2e-web-media-origin` `verify-media-bridge` `verify-scene-live` |
| `packages/media-bridge/lib/routes/now-playing.js` | 2 | `verify-cache-dir` `verify-scene-live` |
| `packages/media-bridge/lib/supervisor.js` | 3 | `verify-contracts` `verify-media-bridge` `verify-scene-live` |
| `packages/parallax/lib/client.parallax.js` | 3 | `verify-client-sync` `verify-client` `verify-scene-live` |
| `packages/parallax/lib/index.js` | 0 | **（无）** |
| `packages/parallax/src/client.js` | 0 | **（无）** |
| `packages/parallax/src/ext-parallax.js` | 1 | `verify-scene-live` |
| `packages/parallax/src/parallax-layer.js` | 1 | `verify-scene-live` |
| `packages/pet-link/lib/client.pet-link.js` | 3 | `verify-client-sync` `verify-client` `verify-pet-hotplug-integration` |
| `packages/pet-link/lib/index.js` | 5 | `verify-pet-hotplug-host` `verify-pet-hotplug-integration` `verify-pet-official` `verify-pet-optional-probe` `verify-pet-package` |
| `packages/pet-link/lib/official-provider.js` | 1 | `verify-pet-hotplug-host` |
| `packages/pet-link/lib/pet-install/run-pnpm.js` | 1 | `verify-pet-install` |
| `packages/pet-link/lib/pet-install/tar.js` | 1 | `verify-pet-install` |
| `packages/pet-link/lib/pet-install/transaction.js` | 1 | `verify-pet-install` |
| `packages/pet-link/lib/prepared.js` | 1 | `verify-pet-tuner-browser` |
| `packages/pet-link/lib/routes/official-pet.js` | 1 | `verify-pet-hotplug-host` |
| `packages/pet-link/lib/routes/pet-install.js` | 2 | `verify-pet-install` `verify-route-families` |
| `packages/pet-link/src/client.js` | 0 | **（无）** |
| `packages/pet-link/src/official-pet.js` | 3 | `verify-pet-hotplug-client` `verify-pet-hotplug-host` `verify-pet-official` |
| `packages/pet-link/src/pet-link-performer.js` | 4 | `verify-pet-hotplug-client` `verify-pet-official` `verify-pet-tuner-browser` `verify-pet-tuner` |
| `packages/pet-link/src/pet-link-tuner.js` | 2 | `verify-pet-tuner-browser` `verify-pet-tuner` |
| `packages/pet-link/src/pet-link.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/bubble.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/constants.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/extension-card.js` | 2 | `verify-i18n` `verify-pet-extension-card` |
| `packages/pet-link/src/pet-link/i18n.js` | 2 | `verify-i18n` `verify-pet-extension-card` |
| `packages/pet-link/src/pet-link/linked-egg1.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/linked-egg2.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/linked-mascot.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/linked-shared.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/linked-sidebar.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/linked.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/mode.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/native.js` | 5 | `verify-pet-egg` `verify-pet-linked` `verify-pet-mascot` `verify-pet-optional-probe` `verify-pet-panel` |
| `packages/pet-link/src/pet-link/panel-params.js` | 3 | `verify-i18n` `verify-pet-panel` `verify-pet-tuner-coverage` |
| `packages/pet-link/src/pet-link/panel.js` | 3 | `verify-i18n` `verify-pet-panel` `verify-pet-tuner-coverage` |
| `src/about-assets.js` | 1 | `verify-about` |
| `src/adapter.js` | 1 | `verify-adapter` |
| `src/api-client.js` | 3 | `verify-api-client` `verify-contracts` `verify-occlusion-client` |
| `src/avatar-import.js` | 1 | `verify-scene-live` |
| `src/avatar-layer.js` | 2 | `verify-avatar-interval-and-rotation` `verify-scene-live` |
| `src/client-audio-playback.js` | 1 | `verify-scene-live` |
| `src/client-media-frame.js` | 1 | `verify-scene-live` |
| `src/client-rotation.js` | 1 | `verify-scene-live` |
| `src/client.js` | 26 | `verify-about` `verify-adapter` `verify-api-client` `verify-avatar-interval-and-rotation` `verify-client` `verify-component-fonts` `verify-contracts` `verify-extra-glass` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-module-layout` `verify-notice-routing` `verify-package-publish` `verify-pet-rope-entry` `verify-pet-sidebar-diag` `verify-pet-sidebar-rebound` `verify-presets` `verify-scene-live` `verify-subpackage-purity` `verify-subpackage-toggle-roundtrip` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` `verify-transcode-state` `verify-types` |
| `src/effects.js` | 7 | `verify-adapter` `verify-client` `verify-component-fonts` `verify-extra-glass` `verify-glass-surfaces` `verify-scene-live` `verify-theme-layer` |
| `src/ext-avatar.js` | 2 | `verify-avatar-interval-and-rotation` `verify-scene-live` |
| `src/extension-registry.js` | 4 | `verify-fontset` `verify-pet-extension-card` `verify-scene-live` `verify-subpackage-toggle-roundtrip` |
| `src/focus-handback.js` | 1 | `verify-client` |
| `src/font/apply.js` | 4 | `verify-client` `verify-component-fonts` `verify-fontset` `verify-theme-layer` |
| `src/font/color-roles.js` | 3 | `verify-fontset` `verify-scene-live` `verify-theme-layer` |
| `src/font/components.js` | 2 | `verify-component-fonts` `verify-fontset` |
| `src/font/typography.js` | 4 | `verify-fontset` `verify-scene-live` `verify-system-fonts` `verify-theme-layer` |
| `src/fontset-store.js` | 4 | `verify-client` `verify-contracts` `verify-fontset` `verify-subpackage-purity` |
| `src/glass-extra.js` | 1 | `verify-extra-glass` |
| `src/glass-panel.js` | 7 | `verify-client` `verify-extra-glass` `verify-fontset` `verify-glass-compat` `verify-glass-surfaces` `verify-presets` `verify-scene-live` |
| `src/glass-surfaces.js` | 3 | `verify-glass-runtime` `verify-glass-surfaces` `verify-pet-sidebar-glass` |
| `src/glass.js` | 2 | `verify-client` `verify-glass-surfaces` |
| `src/i18n-copy-core.js` | 2 | `verify-about` `verify-presets` |
| `src/i18n-copy-ext.js` | 2 | `verify-about` `verify-presets` |
| `src/i18n-copy-font.js` | 2 | `verify-about` `verify-presets` |
| `src/i18n-copy-glass.js` | 2 | `verify-about` `verify-presets` |
| `src/i18n-copy-live.js` | 2 | `verify-about` `verify-presets` |
| `src/i18n-copy-panel.js` | 2 | `verify-about` `verify-presets` |
| `src/i18n-copy-pet-link.js` | 2 | `verify-about` `verify-presets` |
| `src/i18n-copy-picker.js` | 2 | `verify-about` `verify-presets` |
| `src/i18n-copy.js` | 3 | `verify-about` `verify-i18n` `verify-presets` |
| `src/i18n.js` | 1 | `verify-i18n` |
| `src/layer-core.js` | 1 | `verify-scene-live` |
| `src/live-layer-diag.js` | 5 | `verify-glass-surfaces` `verify-logging` `verify-occlusion-client` `verify-scene-live` `verify-theme-follow` |
| `src/live-layer-gate.js` | 5 | `verify-glass-surfaces` `verify-logging` `verify-occlusion-client` `verify-scene-live` `verify-theme-follow` |
| `src/live-layer-pointer.js` | 5 | `verify-glass-surfaces` `verify-logging` `verify-occlusion-client` `verify-scene-live` `verify-theme-follow` |
| `src/live-layer-underlay.js` | 5 | `verify-glass-surfaces` `verify-logging` `verify-occlusion-client` `verify-scene-live` `verify-theme-follow` |
| `src/live-layer-watch.js` | 6 | `verify-client` `verify-glass-surfaces` `verify-logging` `verify-occlusion-client` `verify-scene-live` `verify-theme-follow` |
| `src/live-layer.js` | 6 | `verify-client` `verify-glass-surfaces` `verify-logging` `verify-occlusion-client` `verify-scene-live` `verify-theme-follow` |
| `src/media-prep.js` | 5 | `verify-client` `verify-fontset` `verify-scene-live` `verify-theme-follow` `verify-transcode-state` |
| `src/module-reset.js` | 2 | `verify-fontset` `verify-scene-live` |
| `src/nav-icon.js` | 2 | `verify-client` `verify-i18n` |
| `src/occlusion.js` | 1 | `verify-occlusion-client` |
| `src/panel-tabs-advanced.js` | 11 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-client` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-scene-live` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `src/panel-tabs-appearance.js` | 12 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-client` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-scene-live` `verify-subpackage-toggle-roundtrip` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `src/panel-tabs-effects.js` | 11 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-client` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-scene-live` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `src/panel-tabs-mascot.js` | 11 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-client` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-scene-live` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `src/panel-tabs-wallpaper.js` | 12 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-avatar-interval-and-rotation` `verify-client` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-scene-live` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `src/panel-tabs.js` | 14 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-api-client` `verify-client` `verify-component-visibility` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-scene-live` `verify-subpackage-toggle-roundtrip` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `src/persistence.js` | 4 | `verify-adapter` `verify-client` `verify-presets` `verify-settings-namespaces` |
| `src/picker-modal.js` | 3 | `verify-client` `verify-fontset` `verify-scene-live` |
| `src/picker-model.js` | 1 | `verify-picker-model` |
| `src/picker-props-panel.js` | 2 | `verify-client` `verify-fontset` |
| `src/preset-store.js` | 2 | `verify-client` `verify-presets` |
| `src/quick-panel.js` | 7 | `e2e-web-media-origin` `verify-client` `verify-extra-glass` `verify-i18n` `verify-presets` `verify-scene-live` `verify-system-fonts` |
| `src/section-head.js` | 2 | `verify-fontset` `verify-scene-live` |
| `src/sidebar-right.js` | 4 | `verify-i18n` `verify-pet-package` `verify-pet-sidebar-rebound` `verify-scene-live` |
| `src/styles-base.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/styles-chrome.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/styles-ext.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/styles-panel.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/styles-quick.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/styles-settings.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/styles-shell.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/styles-sidebar.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/styles.js` | 9 | `e2e-web-media-origin` `verify-adapter` `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-readability` `verify-scene-live` `verify-token-contract` |
| `src/system-fonts.js` | 4 | `verify-client` `verify-fontset` `verify-scene-live` `verify-system-fonts` |
| `src/theme-follow.js` | 2 | `verify-client` `verify-theme-follow` |
| `src/video-layer.js` | 4 | `verify-avatar-interval-and-rotation` `verify-client` `verify-scene-live` `verify-transcode-state` |
| `src/we-base.js` | 1 | `verify-scene-live` |
| `src/we-cond.js` | 3 | `verify-client` `verify-fontset` `verify-scene-live` |
