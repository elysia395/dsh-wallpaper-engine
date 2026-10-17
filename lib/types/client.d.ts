/**
 * dsh-wallpaper-engine — client (browser) half.
 *
 * A compiled browser module in the `window.__ModuleLoader__.load({ id,
 * factory })` form. The factory returns the plugin exports declared below. It
 * is a normal browser module (full access to fetch/document/window; `react` via
 * `require("react")`), distinct from the dynamic cordis_define closure whose
 * traps and withheld globals do not apply here.
 */

import type { Context } from '@deepseek-ai/cordis';

/** Declarative service dependency of the browser half: the client `slots` service. */
export declare const inject: string[];

/**
 * Mounts the wallpaper layers, the settings section and the floating rope dock
 * on the client context. Returns nothing; teardown rides the fiber's effects.
 * The client runtime merges the `slots` service into this context.
 */
export declare function apply(ctx: Context): void;

/**
 * Frozen, sorted key table of the **cross-package host bridge** (`src/client.js`
 * `HOST_BRIDGE_BINDINGS`): the bindings a sub-package browser half receives as
 * `require("dsh-plugin-wallpaper-engine")`. Every sub-package bundle destructures
 * these names from the host module and throws at evaluation time when one is
 * missing (`packages/<pkg>/src/client.js` `*_HOST_REQUIRED`), so the list is a
 * contract, not documentation — see docs/wip/BUNDLE-SPLIT.md §5.1 ②.
 */
export declare const hostBridgeKeys: readonly string[];

/** The factory's return shape: the browser plugin exports consumed by the Cordis Loader. */
export interface WallpaperEngineClientPlugin {
  apply: typeof apply;
  inject: typeof inject;
  hostBridgeKeys: typeof hostBridgeKeys;
}

/**
 * Page globals of the wallpaper **render page** (the `lib/webwallgl/**` bundle and
 * the injected `lib/we-focus-guard.js`). `checkJs` reads those modules as ordinary
 * `lib/**` files, so their `window.<name>` accesses need the shape declared here;
 * every member below is taken from the actual write/read sites in those three files.
 */
declare global {
  interface Window {
    /** Renderer observation face: `frame()` returns the current stats object. Written at `lib/webwallgl/renderer.js:191`, read by `src/live-layer.js` / `src/client.js`. */
    __wpStats: { frame: () => any };
    /** Renderer control face: every member is written at `lib/webwallgl/renderer.js:195-309` and called by name from `src/**`. */
    __wp: {
      setWallpaper(cfg: any): void;
      pause(): void;
      resume(): void;
      setFit(fit: any): void;
      setVolume(v: any): void;
      release(): void;
      restore(): void;
      setRenderDpr(dpr: any): void;
      setSceneFps(fps: any): void;
      setQuality(patch: any): void;
      getQuality(): any;
      setFilter(id: any): void;
      updateWebProps(wire: any): void;
      pushPointer(u: any, v: any, buttons: any, mods: any): void;
      pointerLeave(): void;
      pushWheel(dx: any, dy: any, mode: any, mods: any): void;
      loadSceneFile(file: any, project: any): void;
      setAudioBridge(fn: any): void;
      capture(maxWidth: any): any;
      getProperties(): any;
      setMedia(init: any): void;
      setMediaControl(controls: any): void;
      setOcclusion(payload: any): void;
      getOcclusion(): any;
      getState(): any;
    };
    /** Sole occlusion entry point: written by `lib/webwallgl/renderer.js:313`, called by the bridge at `lib/webwallgl/occlusion-bridge.js:33/:35` (`null` clears). */
    __weSetOcclusion: (payload: any) => void;
    /** Idempotence marker of the occlusion bridge (`lib/webwallgl/occlusion-bridge.js:24/:25`): same document installs one listener only. */
    __weOcclusionBridge: number;
    /** Frame-level counters and escape hatch of the focus guard (`lib/we-focus-guard.js:64/:70`). */
    __weFocusGuard: {
      calls: number;
      blocked: number;
      allowed: number;
      installed: boolean;
      allow: boolean;
      elCalls: number;
      elAllowed: number;
      elBlocked: number;
      elInstalled: boolean;
      gestureAt: number;
      gestureWindowMs: number;
      elLastBlockedAt: number;
      elLastBlockedStack: string;
    };
  }
}
