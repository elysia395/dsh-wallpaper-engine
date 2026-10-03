# 守卫映射（生成物，勿手改）

> 由 `node test/tools/guard-targets.mjs --write` 重算；`test/verify-guard-map.mjs` 会重算并逐字比对。
> **怎么用**：改了 `src/` 或 `lib/` 的某个模块，在「模块 → 守卫」那张表里查该跑哪几条。
> 口径：只统计守卫**代码**里真正碰到的模块（先剥注释），并区分"直接读源文件"与"隔着产物 `lib/client.js`"。

模块面 54 个 · 守卫 45 个

## 守卫 → 模块

| 守卫 | 直接读的模块 | 隔着产物 |
|---|---|:--:|
| `compat-harness-live.mjs` | — |  |
| `compat-harness-pages.mjs` | — |  |
| `compat-harness-surfaces.mjs` | — |  |
| `e2e-web-media-origin.mjs` | `lib/index.js` `lib/media/provision.js` `src/client.js` `src/styles.js` |  |
| `fontset-load-smoke.mjs` | — | ✅ |
| `live-frame-async-identity-smoke.mjs` | — | ✅ |
| `live-frame-backfill-smoke.mjs` | — | ✅ |
| `rotation-live-smoke.mjs` | — | ✅ |
| `rotation-prepared-leak-smoke.mjs` | — | ✅ |
| `rotation-smoke.mjs` | — | ✅ |
| `verify-about.mjs` | `lib/index.js` `lib/routes/about-qr.js` `lib/routes/github-stars.js` `src/about-assets.js` `src/client.js` `src/i18n-copy.js` `src/panel-tabs.js` | ✅ |
| `verify-adapter.mjs` | `lib/index.js` `lib/settings-schema.js` `src/adapter.js` `src/client.js` `src/effects.js` `src/panel-tabs.js` `src/persistence.js` `src/styles.js` |  |
| `verify-api-client.mjs` | `src/api-client.js` `src/client.js` `src/effects.js` `src/font/apply.js` `src/font/color-roles.js` `src/font/typography.js` `src/layer-core.js` `src/live-layer.js` `src/media-prep.js` `src/panel-tabs.js` `src/persistence.js` `src/styles.js` `src/video-layer.js` `src/we-cond.js` | ✅ |
| `verify-body-caps.mjs` | `lib/http-body.js` `lib/routes/upload.js` | ✅ |
| `verify-client-sync.mjs` | — | ✅ |
| `verify-client.mjs` | `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/font/apply.js` `src/fontset-store.js` `src/live-layer.js` `src/media-prep.js` `src/persistence.js` `src/video-layer.js` | ✅ |
| `verify-component-fonts.mjs` | `src/client.js` `src/effects.js` `src/font/apply.js` `src/font/components.js` | ✅ |
| `verify-contracts.mjs` | `lib/index.js` `lib/media/index.js` `lib/media/legacy.js` `lib/media/supervisor.js` `lib/routes/fontsets.js` `lib/settings-schema.js` `src/api-client.js` `src/client.js` `src/fontset-editor.js` `src/fontset-store.js` `src/panel-tabs.js` |  |
| `verify-dead-declarations.mjs` | — |  |
| `verify-fontset.mjs` | `lib/index.js` `lib/settings-schema.js` `src/client.js` `src/font/apply.js` `src/font/color-roles.js` `src/font/components.js` `src/font/typography.js` `src/fontset-editor.js` `src/fontset-store.js` `src/glass-panel.js` `src/media-prep.js` `src/panel-tabs.js` `src/picker-modal.js` `src/picker-props-panel.js` `src/styles.js` `src/we-cond.js` | ✅ |
| `verify-glass-compositing.mjs` | — | ✅ |
| `verify-glass-surfaces.mjs` | `src/client.js` `src/effects.js` `src/glass-panel.js` `src/glass.js` `src/live-layer.js` `src/panel-tabs.js` `src/styles.js` | ✅ |
| `verify-host-paint-scope.mjs` | — | ✅ |
| `verify-i18n.mjs` | `src/client.js` `src/i18n-copy.js` `src/i18n.js` `src/nav-icon.js` `src/quick-panel.js` `src/sidebar-right.js` `src/styles.js` | ✅ |
| `verify-logging.mjs` | `lib/index.js` `lib/log.js` `lib/notice.js` `lib/routes/scene-serve.js` `src/live-layer.js` |  |
| `verify-media-bridge.mjs` | — |  |
| `verify-module-layout.mjs` | `lib/index.js` `lib/settings-schema.js` `src/client.js` | ✅ |
| `verify-package-files.mjs` | `lib/http-body.js` `lib/index.js` `lib/media/index.js` `lib/media/legacy.js` `lib/pkg-read.js` `lib/routes/upload.js` | ✅ |
| `verify-package-publish.mjs` | `lib/index.js` `lib/pkg-read.js` `src/client.js` | ✅ |
| `verify-picker-model.mjs` | `src/picker-model.js` | ✅ |
| `verify-picker-props.mjs` | — | ✅ |
| `verify-picker-upload.mjs` | — | ✅ |
| `verify-playback-controls.mjs` | — | ✅ |
| `verify-reachability.mjs` | `lib/index.js` | ✅ |
| `verify-readability.mjs` | — | ✅ |
| `verify-retired-lines.mjs` | `src/client.js` |  |
| `verify-route-families.mjs` | — |  |
| `verify-route-index.mjs` | `lib/index.js` |  |
| `verify-scene-live.mjs` | `lib/index.js` `lib/media/index.js` `lib/media/legacy.js` `lib/media/provision.js` `lib/media/supervisor.js` `lib/routes/diag.js` `lib/routes/now-playing.js` `lib/routes/scene-serve.js` `lib/settings-schema.js` `lib/we-props.js` `lib/webwallgl/web-shim.js` `src/client.js` `src/effects.js` `src/font/color-roles.js` `src/font/typography.js` `src/glass-panel.js` `src/live-layer.js` `src/media-prep.js` `src/panel-tabs.js` `src/picker-modal.js` `src/quick-panel.js` `src/sidebar-right.js` `src/styles.js` `src/we-cond.js` | ✅ |
| `verify-scene.mjs` | `lib/index.js` `lib/routes/scene-frame.js` | ✅ |
| `verify-softrender.mjs` | — | ✅ |
| `verify-theme-follow.mjs` | `lib/settings-schema.js` `src/client.js` `src/live-layer.js` `src/media-prep.js` `src/panel-tabs.js` `src/theme-follow.js` | ✅ |
| `verify-theme-layer.mjs` | `lib/settings-schema.js` `src/client.js` `src/effects.js` `src/font/apply.js` `src/font/color-roles.js` `src/font/typography.js` `src/panel-tabs.js` | ✅ |
| `verify-transcode-state.mjs` | `src/video-layer.js` | ✅ |
| `verify-types.mjs` | `lib/index.js` `src/client.js` | ✅ |

## 模块 → 守卫

| 模块 | 守卫数 | 守卫 |
|---|---:|---|
| `lib/client.js` | 33 | `fontset-load-smoke` `live-frame-async-identity-smoke` `live-frame-backfill-smoke` `rotation-live-smoke` `rotation-prepared-leak-smoke` `rotation-smoke` `verify-about` `verify-api-client` `verify-body-caps` `verify-client-sync` `verify-client` `verify-component-fonts` `verify-fontset` `verify-glass-compositing` `verify-glass-surfaces` `verify-host-paint-scope` `verify-i18n` `verify-module-layout` `verify-package-files` `verify-package-publish` `verify-picker-model` `verify-picker-props` `verify-picker-upload` `verify-playback-controls` `verify-reachability` `verify-readability` `verify-scene-live` `verify-scene` `verify-softrender` `verify-theme-follow` `verify-theme-layer` `verify-transcode-state` `verify-types` |
| `lib/http-body.js` | 2 | `verify-body-caps` `verify-package-files` |
| `lib/index.js` | 14 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-contracts` `verify-fontset` `verify-logging` `verify-module-layout` `verify-package-files` `verify-package-publish` `verify-reachability` `verify-route-index` `verify-scene-live` `verify-scene` `verify-types` |
| `lib/log.js` | 1 | `verify-logging` |
| `lib/media/index.js` | 3 | `verify-contracts` `verify-package-files` `verify-scene-live` |
| `lib/media/legacy.js` | 3 | `verify-contracts` `verify-package-files` `verify-scene-live` |
| `lib/media/provision.js` | 2 | `e2e-web-media-origin` `verify-scene-live` |
| `lib/media/supervisor.js` | 2 | `verify-contracts` `verify-scene-live` |
| `lib/notice.js` | 1 | `verify-logging` |
| `lib/pkg-read.js` | 2 | `verify-package-files` `verify-package-publish` |
| `lib/routes/about-qr.js` | 1 | `verify-about` |
| `lib/routes/diag.js` | 1 | `verify-scene-live` |
| `lib/routes/fontsets.js` | 1 | `verify-contracts` |
| `lib/routes/github-stars.js` | 1 | `verify-about` |
| `lib/routes/now-playing.js` | 1 | `verify-scene-live` |
| `lib/routes/scene-frame.js` | 1 | `verify-scene` |
| `lib/routes/scene-serve.js` | 2 | `verify-logging` `verify-scene-live` |
| `lib/routes/upload.js` | 2 | `verify-body-caps` `verify-package-files` |
| `lib/scene-manifest.js` | 0 | **（无）** |
| `lib/settings-schema.js` | 8 | `verify-adapter` `verify-client` `verify-contracts` `verify-fontset` `verify-module-layout` `verify-scene-live` `verify-theme-follow` `verify-theme-layer` |
| `lib/we-props.js` | 1 | `verify-scene-live` |
| `lib/webwallgl/assets/modulepreload-polyfill-B5Qt9EMX.js` | 0 | **（无）** |
| `lib/webwallgl/assets/renderer-DTLW1Gf0.js` | 0 | **（无）** |
| `lib/webwallgl/web-shim.js` | 1 | `verify-scene-live` |
| `src/about-assets.js` | 1 | `verify-about` |
| `src/adapter.js` | 1 | `verify-adapter` |
| `src/api-client.js` | 2 | `verify-api-client` `verify-contracts` |
| `src/client.js` | 17 | `e2e-web-media-origin` `verify-about` `verify-adapter` `verify-api-client` `verify-client` `verify-component-fonts` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-module-layout` `verify-package-publish` `verify-retired-lines` `verify-scene-live` `verify-theme-follow` `verify-theme-layer` `verify-types` |
| `src/effects.js` | 7 | `verify-adapter` `verify-api-client` `verify-client` `verify-component-fonts` `verify-glass-surfaces` `verify-scene-live` `verify-theme-layer` |
| `src/font/apply.js` | 5 | `verify-api-client` `verify-client` `verify-component-fonts` `verify-fontset` `verify-theme-layer` |
| `src/font/color-roles.js` | 4 | `verify-api-client` `verify-fontset` `verify-scene-live` `verify-theme-layer` |
| `src/font/components.js` | 2 | `verify-component-fonts` `verify-fontset` |
| `src/font/typography.js` | 4 | `verify-api-client` `verify-fontset` `verify-scene-live` `verify-theme-layer` |
| `src/fontset-editor.js` | 2 | `verify-contracts` `verify-fontset` |
| `src/fontset-store.js` | 3 | `verify-client` `verify-contracts` `verify-fontset` |
| `src/glass-panel.js` | 3 | `verify-fontset` `verify-glass-surfaces` `verify-scene-live` |
| `src/glass.js` | 1 | `verify-glass-surfaces` |
| `src/i18n-copy.js` | 2 | `verify-about` `verify-i18n` |
| `src/i18n.js` | 1 | `verify-i18n` |
| `src/layer-core.js` | 1 | `verify-api-client` |
| `src/live-layer.js` | 6 | `verify-api-client` `verify-client` `verify-glass-surfaces` `verify-logging` `verify-scene-live` `verify-theme-follow` |
| `src/media-prep.js` | 5 | `verify-api-client` `verify-client` `verify-fontset` `verify-scene-live` `verify-theme-follow` |
| `src/nav-icon.js` | 1 | `verify-i18n` |
| `src/panel-tabs.js` | 9 | `verify-about` `verify-adapter` `verify-api-client` `verify-contracts` `verify-fontset` `verify-glass-surfaces` `verify-scene-live` `verify-theme-follow` `verify-theme-layer` |
| `src/persistence.js` | 3 | `verify-adapter` `verify-api-client` `verify-client` |
| `src/picker-modal.js` | 2 | `verify-fontset` `verify-scene-live` |
| `src/picker-model.js` | 1 | `verify-picker-model` |
| `src/picker-props-panel.js` | 1 | `verify-fontset` |
| `src/quick-panel.js` | 2 | `verify-i18n` `verify-scene-live` |
| `src/sidebar-right.js` | 2 | `verify-i18n` `verify-scene-live` |
| `src/styles.js` | 7 | `e2e-web-media-origin` `verify-adapter` `verify-api-client` `verify-fontset` `verify-glass-surfaces` `verify-i18n` `verify-scene-live` |
| `src/theme-follow.js` | 1 | `verify-theme-follow` |
| `src/video-layer.js` | 3 | `verify-api-client` `verify-client` `verify-transcode-state` |
| `src/we-cond.js` | 3 | `verify-api-client` `verify-fontset` `verify-scene-live` |
