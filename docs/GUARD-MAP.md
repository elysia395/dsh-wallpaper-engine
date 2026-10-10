# 守卫映射（生成物，勿手改）

> 由 `node test/tools/guard-targets.mjs --write` 重算；`test/verify-guard-map.mjs` 会重算并逐字比对。
> **怎么用**：改了 `src/` 或 `lib/` 的某个模块，在「模块 → 守卫」那张表里查该跑哪几条。
> 口径：只统计守卫**代码**里真正碰到的模块（先剥注释），并区分"直接读源文件"与"隔着产物 `lib/client.js`"。

模块面 83 个 · 守卫 54 个

## 守卫 → 模块

| 守卫 | 直接读的模块 | 隔着产物 |
|---|---|:--:|
| `compat-harness-live.mjs` | — |  |
| `compat-harness-pages.mjs` | — |  |
| `compat-harness-surfaces.mjs` | — |  |
| `e2e-web-media-origin.mjs` | `lib/index.js` `lib/media/provision.js` `src/client.js` `src/panel-tabs.js` `src/quick-panel.js` `src/styles.js` |  |
| `fontset-load-smoke.mjs` | — | ✅ |
| `live-frame-async-identity-smoke.mjs` | — | ✅ |
| `live-frame-backfill-smoke.mjs` | — | ✅ |
| `rotation-live-smoke.mjs` | — | ✅ |
| `rotation-prepared-leak-smoke.mjs` | — | ✅ |
| `rotation-smoke.mjs` | — | ✅ |
| `verify-about.mjs` | `lib/index.js` `lib/routes/about-qr.js` `lib/routes/github-stars.js` `src/about-assets.js` `src/client.js` `src/i18n-copy.js` `src/panel-tabs.js` | ✅ |
| `verify-adapter.mjs` | `lib/index.js` `lib/settings-schema.js` `src/adapter.js` `src/client.js` `src/effects.js` `src/panel-tabs.js` `src/persistence.js` `src/styles.js` |  |
| `verify-api-client.mjs` | `src/api-client.js` `src/client.js` `src/panel-tabs.js` | ✅ |
| `verify-body-caps.mjs` | `lib/http-body.js` `lib/routes/upload.js` | ✅ |
| `verify-cache-dir.mjs` | `lib/faststart.js` `lib/index.js` `lib/media/index.js` `lib/media/legacy.js` `lib/routes/cache-dir.js` `lib/routes/now-playing.js` |  |
| `verify-client-sync.mjs` | — | ✅ |
| `verify-client.mjs` | `lib/index.js` `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/focus-handback.js` `src/font/apply.js` `src/fontset-store.js` `src/glass-panel.js` `src/glass.js` `src/live-layer.js` `src/media-prep.js` `src/panel-tabs.js` `src/persistence.js` `src/picker-modal.js` `src/picker-props-panel.js` `src/preset-store.js` `src/quick-panel.js` `src/system-fonts.js` `src/theme-follow.js` `src/video-layer.js` `src/we-cond.js` | ✅ |
| `verify-component-fonts.mjs` | `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/font/apply.js` `src/font/components.js` | ✅ |
| `verify-contracts.mjs` | `lib/index.js` `lib/media/index.js` `lib/media/legacy.js` `lib/media/supervisor.js` `lib/routes/avatar.js` `lib/routes/fontsets.js` `lib/routes/mascot.js` `lib/settings-schema.js` `src/api-client.js` `src/client.js` `src/fontset-editor.js` `src/fontset-store.js` `src/panel-tabs.js` |  |
| `verify-dead-declarations.mjs` | — |  |
| `verify-fontset.mjs` | `lib/index.js` `lib/settings-schema.js` `src/client.js` `src/font/apply.js` `src/font/color-roles.js` `src/font/components.js` `src/font/typography.js` `src/fontset-editor.js` `src/fontset-store.js` `src/glass-panel.js` `src/media-prep.js` `src/panel-tabs.js` `src/picker-modal.js` `src/picker-props-panel.js` `src/styles.js` `src/system-fonts.js` `src/we-cond.js` | ✅ |
| `verify-glass-compositing.mjs` | — | ✅ |
| `verify-glass-surfaces.mjs` | `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/glass-panel.js` `src/glass.js` `src/live-layer.js` `src/panel-tabs.js` `src/styles.js` | ✅ |
| `verify-host-paint-scope.mjs` | — | ✅ |
| `verify-i18n.mjs` | `src/client.js` `src/i18n-copy.js` `src/i18n.js` `src/nav-icon.js` `src/quick-panel.js` `src/sidebar-right.js` `src/styles.js` | ✅ |
| `verify-inventory-index.mjs` | `lib/inventory.js` |  |
| `verify-json-response.mjs` | `lib/json-response.js` | ✅ |
| `verify-logging.mjs` | `lib/index.js` `lib/log.js` `lib/notice.js` `lib/routes/diag.js` `lib/routes/scene-serve.js` `lib/serve.js` `src/live-layer.js` |  |
| `verify-media-bridge.mjs` | `lib/media/index.js` `lib/media/provision.js` `lib/media/supervisor.js` |  |
| `verify-module-layout.mjs` | `lib/index.js` `lib/settings-schema.js` `src/client.js` | ✅ |
| `verify-mp4-vfs.mjs` | `lib/faststart.js` `lib/mp4-vfs.js` |  |
| `verify-package-files.mjs` | `lib/http-body.js` `lib/index.js` `lib/media/index.js` `lib/media/legacy.js` `lib/pkg-read.js` `lib/routes/upload.js` | ✅ |
| `verify-package-publish.mjs` | `lib/index.js` `lib/pkg-read.js` `src/client.js` | ✅ |
| `verify-picker-model.mjs` | `src/picker-model.js` | ✅ |
| `verify-picker-props.mjs` | — | ✅ |
| `verify-picker-upload.mjs` | — | ✅ |
| `verify-playback-controls.mjs` | — | ✅ |
| `verify-presets.mjs` | `lib/index.js` `lib/routes/presets.js` `lib/settings-schema.js` `src/client.js` `src/glass-panel.js` `src/preset-store.js` `src/quick-panel.js` | ✅ |
| `verify-reachability.mjs` | `lib/index.js` | ✅ |
| `verify-readability.mjs` | — | ✅ |
| `verify-retired-lines.mjs` | — |  |
| `verify-route-families.mjs` | — |  |
| `verify-route-index.mjs` | `lib/index.js` `lib/routes/media-bytes.js` |  |
| `verify-scene-live.mjs` | `lib/faststart.js` `lib/index.js` `lib/inventory.js` `lib/media-origin.js` `lib/media/index.js` `lib/media/legacy.js` `lib/media/provision.js` `lib/media/supervisor.js` `lib/mp4-vfs.js` `lib/routes/diag.js` `lib/routes/media-bytes.js` `lib/routes/now-playing.js` `lib/routes/scene-serve.js` `lib/routes/we-assets.js` `lib/serve.js` `lib/settings-schema.js` `lib/we-focus-guard.js` `lib/we-props.js` `lib/webwallgl/web-shim.js` `src/avatar-layer.js` `src/client.js` `src/effects.js` `src/ext-avatar.js` `src/ext-fx.js` `src/ext-parallax.js` `src/font/color-roles.js` `src/font/typography.js` `src/fx-layer.js` `src/glass-panel.js` `src/layer-core.js` `src/live-layer.js` `src/media-prep.js` `src/panel-tabs.js` `src/parallax-layer.js` `src/picker-modal.js` `src/quick-panel.js` `src/sidebar-right.js` `src/styles.js` `src/system-fonts.js` `src/video-layer.js` `src/we-base.js` `src/we-cond.js` | ✅ |
| `verify-scene.mjs` | `lib/index.js` `lib/pkg-read.js` `lib/routes/live-frame.js` `lib/routes/media-bytes.js` `lib/routes/props.js` `lib/routes/scene-frame.js` `lib/routes/scene-media.js` `lib/routes/settings.js` `lib/scene-manifest.js` | ✅ |
| `verify-softrender.mjs` | — | ✅ |
| `verify-system-fonts.mjs` | `lib/routes/system-fonts.js` `lib/settings-schema.js` `src/client.js` `src/font/typography.js` `src/panel-tabs.js` `src/quick-panel.js` `src/system-fonts.js` | ✅ |
| `verify-theme-follow.mjs` | `lib/settings-schema.js` `src/client.js` `src/live-layer.js` `src/media-prep.js` `src/panel-tabs.js` `src/theme-follow.js` | ✅ |
| `verify-theme-layer.mjs` | `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/font/apply.js` `src/font/color-roles.js` `src/font/typography.js` `src/panel-tabs.js` | ✅ |
| `verify-token-contract.mjs` | `src/styles.js` |  |
| `verify-transcode-state.mjs` | `lib/index.js` `lib/routes/media-derived.js` `src/client.js` `src/media-prep.js` `src/video-layer.js` | ✅ |
| `verify-types.mjs` | `lib/inventory.js` `src/client.js` | ✅ |
| `verify-we-install-probe.mjs` | `lib/index.js` |  |
| `verify-windows-caption.mjs` | — | ✅ |

## 模块 → 守卫

| 模块 | 守卫数 | 守卫 |
|---|---:|---|
| `lib/client.js` | 37 | `fontset-load-smoke` `live-frame-async-identity-smoke` `live-frame-backfill-smoke` `rotation-live-smoke` `rotation-prepared-leak-smoke` `rotation-smoke` `verify-about` `verify-api-client` `verify-body-caps` `verify-client-sync` `verify-client` `verify-component-fonts` `verify-fontset` `verify-glass-compositing` `verify-glass-surfaces` `verify-host-paint-scope` `verify-i18n` `verify-json-response` `verify-module-layout` `verify-package-files` `verify-package-publish` `verify-picker-model` `verify-picker-props` `verify-picker-upload` `verify-playback-controls` `verify-presets` `verify-reachability` `verify-readability` `verify-scene-live` `verify-scene` `verify-softrender` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` `verify-transcode-state` `verify-types` `verify-windows-caption` |
| `lib/faststart.js` | 3 | `verify-cache-dir` `verify-mp4-vfs` `verify-scene-live` |
| `lib/http-body.js` | 2 | `verify-body-caps` `verify-package-files` |
| `lib/index.js` | 18 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-cache-dir` `verify-client` `verify-contracts` `verify-fontset` `verify-logging` `verify-module-layout` `verify-package-files` `verify-package-publish` `verify-presets` `verify-reachability` `verify-route-index` `verify-scene-live` `verify-scene` `verify-transcode-state` `verify-we-install-probe` |
| `lib/inventory.js` | 3 | `verify-inventory-index` `verify-scene-live` `verify-types` |
| `lib/json-response.js` | 1 | `verify-json-response` |
| `lib/log.js` | 1 | `verify-logging` |
| `lib/media-origin.js` | 1 | `verify-scene-live` |
| `lib/media/index.js` | 5 | `verify-cache-dir` `verify-contracts` `verify-media-bridge` `verify-package-files` `verify-scene-live` |
| `lib/media/legacy.js` | 4 | `verify-cache-dir` `verify-contracts` `verify-package-files` `verify-scene-live` |
| `lib/media/provision.js` | 3 | `e2e-web-media-origin` `verify-media-bridge` `verify-scene-live` |
| `lib/media/supervisor.js` | 3 | `verify-contracts` `verify-media-bridge` `verify-scene-live` |
| `lib/mp4-vfs.js` | 2 | `verify-mp4-vfs` `verify-scene-live` |
| `lib/notice.js` | 1 | `verify-logging` |
| `lib/pkg-read.js` | 3 | `verify-package-files` `verify-package-publish` `verify-scene` |
| `lib/routes/about-qr.js` | 1 | `verify-about` |
| `lib/routes/avatar.js` | 1 | `verify-contracts` |
| `lib/routes/cache-dir.js` | 1 | `verify-cache-dir` |
| `lib/routes/diag.js` | 2 | `verify-logging` `verify-scene-live` |
| `lib/routes/fontsets.js` | 1 | `verify-contracts` |
| `lib/routes/github-stars.js` | 1 | `verify-about` |
| `lib/routes/live-frame.js` | 1 | `verify-scene` |
| `lib/routes/mascot.js` | 1 | `verify-contracts` |
| `lib/routes/media-bytes.js` | 3 | `verify-route-index` `verify-scene-live` `verify-scene` |
| `lib/routes/media-derived.js` | 1 | `verify-transcode-state` |
| `lib/routes/now-playing.js` | 2 | `verify-cache-dir` `verify-scene-live` |
| `lib/routes/presets.js` | 1 | `verify-presets` |
| `lib/routes/props.js` | 1 | `verify-scene` |
| `lib/routes/scene-frame.js` | 1 | `verify-scene` |
| `lib/routes/scene-media.js` | 1 | `verify-scene` |
| `lib/routes/scene-serve.js` | 2 | `verify-logging` `verify-scene-live` |
| `lib/routes/settings.js` | 1 | `verify-scene` |
| `lib/routes/system-fonts.js` | 1 | `verify-system-fonts` |
| `lib/routes/upload.js` | 2 | `verify-body-caps` `verify-package-files` |
| `lib/routes/we-assets.js` | 1 | `verify-scene-live` |
| `lib/scene-manifest.js` | 1 | `verify-scene` |
| `lib/serve.js` | 2 | `verify-logging` `verify-scene-live` |
| `lib/settings-schema.js` | 12 | `verify-adapter` `verify-client` `verify-component-fonts` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-module-layout` `verify-presets` `verify-scene-live` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `lib/we-focus-guard.js` | 1 | `verify-scene-live` |
| `lib/we-props.js` | 1 | `verify-scene-live` |
| `lib/webwallgl/assets/modulepreload-polyfill-B5Qt9EMX.js` | 0 | **（无）** |
| `lib/webwallgl/assets/renderer-AJkjEL9i.js` | 0 | **（无）** |
| `lib/webwallgl/web-shim.js` | 1 | `verify-scene-live` |
| `src/about-assets.js` | 1 | `verify-about` |
| `src/adapter.js` | 1 | `verify-adapter` |
| `src/api-client.js` | 2 | `verify-api-client` `verify-contracts` |
| `src/avatar-layer.js` | 1 | `verify-scene-live` |
| `src/client.js` | 19 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-api-client` `verify-client` `verify-component-fonts` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-module-layout` `verify-package-publish` `verify-presets` `verify-scene-live` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` `verify-transcode-state` `verify-types` |
| `src/effects.js` | 6 | `verify-adapter` `verify-client` `verify-component-fonts` `verify-glass-surfaces` `verify-scene-live` `verify-theme-layer` |
| `src/ext-avatar.js` | 1 | `verify-scene-live` |
| `src/ext-fx.js` | 1 | `verify-scene-live` |
| `src/ext-parallax.js` | 1 | `verify-scene-live` |
| `src/focus-handback.js` | 1 | `verify-client` |
| `src/font/apply.js` | 4 | `verify-client` `verify-component-fonts` `verify-fontset` `verify-theme-layer` |
| `src/font/color-roles.js` | 3 | `verify-fontset` `verify-scene-live` `verify-theme-layer` |
| `src/font/components.js` | 2 | `verify-component-fonts` `verify-fontset` |
| `src/font/typography.js` | 4 | `verify-fontset` `verify-scene-live` `verify-system-fonts` `verify-theme-layer` |
| `src/fontset-editor.js` | 2 | `verify-contracts` `verify-fontset` |
| `src/fontset-store.js` | 3 | `verify-client` `verify-contracts` `verify-fontset` |
| `src/fx-layer.js` | 1 | `verify-scene-live` |
| `src/glass-panel.js` | 5 | `verify-client` `verify-fontset` `verify-glass-surfaces` `verify-presets` `verify-scene-live` |
| `src/glass.js` | 2 | `verify-client` `verify-glass-surfaces` |
| `src/i18n-copy.js` | 2 | `verify-about` `verify-i18n` |
| `src/i18n.js` | 1 | `verify-i18n` |
| `src/layer-core.js` | 1 | `verify-scene-live` |
| `src/live-layer.js` | 5 | `verify-client` `verify-glass-surfaces` `verify-logging` `verify-scene-live` `verify-theme-follow` |
| `src/media-prep.js` | 5 | `verify-client` `verify-fontset` `verify-scene-live` `verify-theme-follow` `verify-transcode-state` |
| `src/nav-icon.js` | 1 | `verify-i18n` |
| `src/panel-tabs.js` | 12 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-api-client` `verify-client` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-scene-live` `verify-system-fonts` `verify-theme-follow` `verify-theme-layer` |
| `src/parallax-layer.js` | 1 | `verify-scene-live` |
| `src/persistence.js` | 2 | `verify-adapter` `verify-client` |
| `src/picker-modal.js` | 3 | `verify-client` `verify-fontset` `verify-scene-live` |
| `src/picker-model.js` | 1 | `verify-picker-model` |
| `src/picker-props-panel.js` | 2 | `verify-client` `verify-fontset` |
| `src/preset-store.js` | 2 | `verify-client` `verify-presets` |
| `src/quick-panel.js` | 6 | `e2e-web-media-origin` `verify-client` `verify-i18n` `verify-presets` `verify-scene-live` `verify-system-fonts` |
| `src/sidebar-right.js` | 2 | `verify-i18n` `verify-scene-live` |
| `src/styles.js` | 7 | `e2e-web-media-origin` `verify-adapter` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-scene-live` `verify-token-contract` |
| `src/system-fonts.js` | 4 | `verify-client` `verify-fontset` `verify-scene-live` `verify-system-fonts` |
| `src/theme-follow.js` | 2 | `verify-client` `verify-theme-follow` |
| `src/video-layer.js` | 3 | `verify-client` `verify-scene-live` `verify-transcode-state` |
| `src/we-base.js` | 1 | `verify-scene-live` |
| `src/we-cond.js` | 3 | `verify-client` `verify-fontset` `verify-scene-live` |
