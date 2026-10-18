# Upgrading

> **中文**: [`../UPGRADING.md`](../UPGRADING.md)（与本文同源：改一处请同步另一处）


### ✅ Prerequisites from v1.3.0: DSH kernel ≥ 0.1.5 (0.1.5-rc.1+, tested floor)

**v1.3.0 states its prerequisite in kernel terms (v1.2.0 shipped npm with `>=0.2.0-rc.1`)**: the plugin manifest declares
`engines.dsh: ">=0.1.5-rc.1"` — both the official desktop (DeepSeek Harness, kernel 0.2.0-rc.1+)
and the old **DSH Desktop ≥ 2.0.7** line (kernel 0.1.5-rc.1+) **can install this release**; older
kernels (e.g. 0.1.2-rc.1) still cannot. **`dsh-better-sidebar` is no longer version-restricted**
(updating it to the latest is still recommended if installed).

| Component | Required by v1.3.0+ |
|---|---|
| DSH kernel (DeepSeek Harness / DSH Desktop) | ≥ 0.1.5 (0.1.5-rc.1+) |
| dsh-better-sidebar | no version restriction (latest recommended) |

### v0.7.2 prerequisites (historical): ① DSH kernel 0.1.5-rc.1+ ② better-sidebar ≥ 0.19.0

**(The v0.7.2–v1.1.x wording, superseded by the "Prerequisites from v1.3.0" section above.)** v0.7.2 targets DeepSeek Harness
**0.1.5-rc.1** (shipped in **DSH Desktop ≥ 2.0.7**) and requires **dsh-better-sidebar ≥ 0.19.0**
(from 0.19 the right column plugs into the native right sidebar of harness 0.1.5; users still on the
0.1.2-rc.1 line should keep better-sidebar 0.18.x — **do not mix**).

| Component | Required by v0.7.2+ | Staying on the older kernel (0.1.2-rc.1) |
|---|---|---|
| DeepSeek Harness / DSH Desktop | 0.1.5-rc.1 / ≥ 2.0.7 | 0.1.2-rc.1 / v2.0.5 |
| dsh-better-sidebar | ≥ 0.19.0 | 0.18.x |

### The correct update order

1. **Bring the DSH kernel to ≥ 0.1.5 first**: on the official desktop (DeepSeek Harness) check for updates via the top-bar version info, or grab the installer from [GitHub Releases](https://github.com/anywhere-labs/dsh-desktop/releases); old DSH Desktop users should move to ≥ 2.0.7 at least;
2. **Then update this plugin**: `dsh plugin --profile web add dsh-plugin-wallpaper-engine` (or click update in the plugin market);
3. **dsh-better-sidebar has no version requirement**: if installed, bringing it to the latest (`dsh plugin --profile web add dsh-better-sidebar@latest`) is still a good idea.

> 💡 Also update your **other DSH plugins at the same time**: older plugins may fail to load outright on
> harness 0.1.5 (an old dsh-better-sidebar was observed misbehaving on 0.1.5 due to API changes).

### If anything breaks after updating

Bringing the kernel to ≥ 0.1.5 and dsh-better-sidebar to the latest restores everything —
**no plugin rollback needed**.

### Update notice

The plugin shows a one-time in-app notice per release; missing it is harmless.

### What changes after the upgrade (frame cache / live rendering)

- **The frame cache is invalidated once**: cache keys are prefixed with a pipeline version (currently
  `LIVE_FRAME_KEY_VERSION = 'lf2'`; the published version was `sf33_`), and any change to the capture /
  live-render logic bumps it. A change to the **key shape** bumps it too (v1.3.4 replaced the path's
  base64url with a short hash — see #208): after a bump nothing under
  `~/.dsh-wallpaper-engine/cache/frames/` hits any more, and each scene wallpaper is captured afresh.
  **This is expected, not a regression**; old files are not deleted automatically (clear
  `cache/frames/` by hand to reclaim the space). The same directory also holds the scene's embedded
  video (`sv1_*.mp4`) and packaged audio (`sa1_*`), each with its own prefix.
- **Live rendering needs WebGL2**: after upgrading, scene / web wallpapers render live through WebWallGL by
  default (「场景实时渲染」/「网页实时渲染」, on by default). Without WebGL2, or with a broken GPU driver, the
  renderer page times out after a 15 s first frame and **degrades silently** to the
  「embedded MP4 → live capture → custom frame → empty state」 chain (before the first frame the
  **author's preview** stands in and only a missing preview leaves it honestly blank — no black screen).
  (Since v1.3.0 a **loose `scene.json` directory also renders live**: the renderer judges the form from
  `project.json`'s `file` suffix, so a whole-package `scene.pkg` is no longer required.)
- **Live rendering is on by default** (`sceneLive`) — nothing to do after upgrading.

### Verified compatibility

- **v0.7.1** has been verified on DSH Desktop v2.0.5 (harness 0.1.2-rc.1): host routes (inventory / media /
  scene-frame), the first-level settings section, the picker modal, video & scene wallpaper playback, the
  rope-dock drawer, and the liquid-glass effects all work in both Compatibility and Enhanced desktop modes.
- The APIs this plugin relies on (slots / webserver / theme variables) were verified unchanged between
  0.1.2-rc.1 and 0.1.5-rc.1.
- From v0.7.2 the official native right sidebar is covered by the「侧栏液态玻璃」adaptation (fixing the
  fully-transparent right column after upgrading better-sidebar to 0.19) — see the v0.7.2 entry in
  [`CHANGELOG.md`](../CHANGELOG.md) (Chinese only).

- **The current version is whatever `package.json`'s `version` says (published versions: see the npm package page / GitHub Releases)**: the end-to-end record in this file stops
  at v0.7.1/v0.7.2; the live-rendering chain from v0.7.5 on has offline verification only
  (`test/verify-scene-live.mjs` and more, `npm run verify`). **The pairing recommended at v1.0.1 (historical): `dsh-desktop` ≥ 2.0.14** —
  that release fixed plugin load failures, the right-sidebar glass grey plate when collapsed, and the
  enhanced-mode left grey panel covering the wallpaper; from v1.0.1 wallpapers and every effect work in all
  three window modes (compatibility / enhanced / extended). See the v1.0.1 and v0.7.6–v0.7.8 entries in
  [`CHANGELOG.md`](../CHANGELOG.md) (Chinese only). **Current kernel / desktop requirements are governed by
  the "prerequisites from v1.3.0" section above** — this file no longer maintains a per-version pairing table.

### Settings persistence: moved to a host-side file (v0.4.0)

**Since v0.4.0 every setting (selected wallpaper, accent, transparency, layout, rotation, hidden list,
playback speed/flip, …) lives in a host-side file instead of browser localStorage.**

- **Where**: `~/.dsh-wallpaper-engine/config.json` (the same file that stores your upload directory).
- **Why**: localStorage is isolated per "origin + port", and **DSH Desktop picks a random port on every
  start** — so each launch looked like a brand-new store and every setting reverted to default. A host-side
  file is port-independent.
- **Benefits**: restarts, port changes, cleared browser data, a different browser or a private window no
  longer lose your settings.
- **Migration**: settings previously kept in localStorage are **migrated automatically on first start**.
- **Behaviour change**: several browsers on the same machine now **share one config** (they used to be
  separate); rolling back to an older version still reads the localStorage copy, so nothing is lost.
- **Writes**: debounced 200 ms; a corrupt file falls back to defaults and is **never overwritten**.

---

### The frame-rate cap tiers are now "unlimited / 60 / 30" (unreleased)

**If you had the *fps cap* in **Playback → Effects** set to 48 or 24 fps, it will read "unlimited" after upgrading.**
Those tiers were retired (48 has no natural audience and saves only ~20% of the decode load; 24 makes most
wallpapers visibly choppy for little extra saving over 30), and stored values are **collapsed to the default 0
(unlimited)** by the setting's enum domain — there is no migration step and nothing for you to change.

- **To keep saving GPU**: pick **60** (halves 120 fps sources) or **30** (halves 60/50 fps sources). While a cap is
  active, a wallpaper whose source frame rate is above it is transcoded **once** to the capped rate (the timeline
  is not re-encoded, playback stays at normal speed; cached by "path + mtime + cap", so each wallpaper pays once;
  the original plays first and the app swaps when it is ready, falling back to the original on failure).
- **Unlimited is the default**: with no cap set, not a single transcode ever runs.

---

### Glass configuration collapses into one "independent configuration" switch per surface (unreleased)

**What you will see** (all under Settings → Wallpaper Engine → Appearance; **nothing for you to change** — existing settings migrate once):

- **Two switch layers retired**: the「设置窗口液态玻璃」(settings-window glass) and「子 UI 玻璃」(child-UI glass) switches are **gone** — they used to turn a surface's glass off, but that "off" measurably **did not** restore the native solid look (those surfaces carry a batch of tint rewrites that no switch controls), and doing it properly costs several times the complexity. The behaviour now equals **always on** (i.e. the way it looked with the switch on).
- **One「独立配置」(independent configuration) switch per surface**: on = this surface's own glass parameters **fully override** the global ones; off = it follows the global values. Each brings its own parameters (colour / transparency / blur; the conversation surface also has fidelity).
- **The「窗口与侧栏」(window & sidebar) section was removed** and merged into「玻璃 UI」— on machines without `better-sidebar` it used to be **an empty section with nothing but a heading**.
- **「独立配置」appears in the settings page only** (the sidebar variant keeps just the global four and each surface's **master switch**). The classification is ADR-0008's D4, written down on 2026-10-05: **simple configuration** (both variants) = glass colour / transparency / blur / fidelity plus the thinking-glass, left-sidebar glass, sidebar glass, sidebar full-clear and sidebar follow-global switches; **advanced configuration** (settings page only) = **presets**, each surface's「独立配置」and its parameters, and the capsule blur / capsule colour rows under the thinking-glass switch.
- **The sidebar and content-surface sliders now have an entry point**: they previously had no「独立配置」switch, so those sliders **did nothing when dragged**; turning the matching「独立配置」on makes them appear and take effect (still following the global values by default).
- **One scale**: the sidebar and content-surface sliders now share the global scale (**no visual change** — stored values were converted once by *normalised position*). The one exception: if you had pushed **sidebar blur** very deep, it is clamped to the new ceiling.
- **The thinking trigger bar (the entry row of a "thinking" block) also takes glass now, with its own independent configuration**: it used to be the host's opaque code-block background. It now runs the same recipe as the other conversation surfaces, keeps its hover feedback, and falls back to an opaque panel colour under software rendering (no blur). 「思考触发条玻璃·独立配置」on = override the global **blur / transparency** for this surface, off = follow the global values (same rule as the other surfaces).

⚠️ These changes live on both the host side and the browser side ⇒ **restart DSH** (or reload the plugin) for them to take effect.


