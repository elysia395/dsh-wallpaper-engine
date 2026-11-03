<div align="center">

<p>
  <a href="README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-lang-zh-dark.png"><img src="assets/readme/key-lang-zh-light.png" alt="中文" height="48"></picture></a>
  <a href="README.en.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-lang-en-dark.png"><img src="assets/readme/key-lang-en-light.png" alt="English" height="60"></picture></a>
  <a href="README.beginner.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-lang-start-dark.png"><img src="assets/readme/key-lang-start-light.png" alt="Beginner guide" height="48"></picture></a>
</p>

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-dark.png">
    <img src="assets/readme/hero-light.png" alt="DSH Wallpaper Engine" width="1440">
  </picture>
</h1>

[![npm Version](https://img.shields.io/npm/v/dsh-plugin-wallpaper-engine?style=flat-square&logo=npm&label=npm&color=8fd6a0&labelColor=5a544a)](https://www.npmjs.com/package/dsh-plugin-wallpaper-engine) [![Upstream Stars](https://img.shields.io/github/stars/elysia395/dsh-wallpaper-engine?style=flat-square&label=Upstream%20Stars&color=ffd84a)](https://github.com/elysia395/dsh-wallpaper-engine/stargazers) [![Upstream Release](https://img.shields.io/github/v/release/elysia395/dsh-wallpaper-engine?style=flat-square&label=Upstream%20Release&color=8fd6a0)](https://github.com/elysia395/dsh-wallpaper-engine/releases) [![npm Downloads](https://img.shields.io/npm/dm/dsh-plugin-wallpaper-engine?style=flat-square&label=npm%20Downloads&color=8fd6a0)](https://www.npmjs.com/package/dsh-plugin-wallpaper-engine)
<p>
  <a href="https://trendshift.io/repositories/170341" target="_blank"><img src="https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/badges/trendshift-daily.svg" alt="Trendshift · JavaScript daily best rank" width="250" height="55"></a>
  <a href="https://trendshift.io/repositories/170341" target="_blank"><img src="https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/badges/trendshift-weekly.svg" alt="Trendshift · JavaScript weekly best rank" width="250" height="55"></a>
</p>

<p>
  <a href="#quick-start"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-get-dark.png"><img src="assets/readme/key-get-light.png" alt="Install GET" height="48"></picture></a>
  <a href="README.beginner.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-setup-dark.png"><img src="assets/readme/key-setup-light.png" alt="Setup guide SETUP" height="48"></picture></a>
  <a href="docs/README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-docs-dark.png"><img src="assets/readme/key-docs-light.png" alt="Docs DOCS" height="48"></picture></a>
  <a href="https://github.com/elysia395/dsh-wallpaper-engine/releases"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-release-dark.png"><img src="assets/readme/key-release-light.png" alt="Release RELEASE" height="48"></picture></a>
</p>

</div>

<h2 id="intro">Intro</h2>

Bring local **Wallpaper Engine** Scene, Web and Video wallpapers into DSH, with liquid glass, typography, mascots and shareable appearance presets. The plugin registers no agent tools or prompt text, so it adds no model token overhead.

<a id="preview" href="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/main-interface.gif">
  <img src="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/main-interface.gif" alt="Wallpaper, liquid glass and mascots in the DSH interface" width="960">
</a>

<p align="center"><sub>Real interface demo; historical captures may differ slightly from the installed build.</sub></p>

<h2 id="contents">Contents</h2>

<table>
  <tr>
    <td width="40%" valign="middle">
      <ul>
        <li><a href="#preview">Preview</a> · <a href="#features">Features</a> · <a href="#supported-wallpapers">Supported wallpapers</a></li>
        <li><a href="#quick-start">Quick start</a> · <a href="#usage">Usage</a> · <a href="#compatibility">Compatibility</a></li>
        <li><a href="#development">Development</a> · <a href="#special-thanks">Special Thanks</a></li>
        <li><a href="#support">Support</a> · <a href="#community">Community</a></li>
      </ul>
    </td>
    <td width="30%" align="center" valign="middle">
      <a href="assets/readme/mascot-eating-rice-1280x1784.jpg">
        <img src="assets/readme/mascot-eating-rice-1280x1784.jpg" alt="Mascot illustration" width="320">
      </a>
    </td>
    <td id="support" width="30%" align="center" valign="middle">
      <a href="assets/about/sponsor-fish.png"><img src="assets/about/sponsor-fish.png" alt="Sponsor QR code" width="260" height="260"></a>
      <br><strong>Sponsor QR code</strong>
      <br><sub>The project is open source; donations are entirely optional and never affect installation, usage or issue support.</sub>
    </td>
  </tr>
</table>

<h2 id="features">Features</h2>

- **Wallpapers**: live Scene / Web rendering, video playback, local image / video uploads and WE project directories.
- **Appearance**: liquid glass for settings, conversation and sidebar; colors, transparency, blur, borders and fonts.
- **Glass subpackage**: liquid glass is a standalone subpackage row, `wallpaper-engine-glass`, which can be disabled on its own in the plugin manager; with it disabled the host — except for the wallpaper shown in the content area — returns to its native look, while wallpapers, fonts and mascots keep working.
- **Extensions**: mascots, conversation avatars, click / pointer-trail effects, 3D parallax and optional official `dsh-pet` integration.
- **Library**: filters, hide / restore, rotation lists and whole-configuration preset import / export.

<h2 id="supported-wallpapers">Supported wallpapers</h2>

| Type | How it works in DSH | Support |
|---|---|---|
| **Scene** | Built-in WebWallGL live rendering, with fallback chain | Supported; no WE process required |
| **Web** | Web page mounting, WE API shim and sandboxing | Supported; depends on the page and browser |
| **Video** | Browser playback with transcoding, fps cap and pause control | Supported |
| **Picture** | Reads the image folder of a WE `preset` project and crossfades locally at the interval set in WE | Supported; images are never uploaded |
| **Custom image / video** | Upload local JPG / PNG / MP4 | Supported; files stay local |

Application wallpapers require launching third-party executables and are **not supported**; they never enter the library or rotation candidates.

<h2 id="quick-start">Quick start</h2>

Requires **Node.js >= 22.12.0**, a **DSH 0.2 kernel** (including `0.2.0-rc.1/rc.2`) and **pnpm**. Close DSH completely before installing.

**npm (recommended)**

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

Use `desktop` instead of `web` for the desktop host.

The repository ships a **multi-package release set**: installing the main package resolves the same-version subpackages (current package/tarball counts and `publishOrder` live in [RELEASING](docs/RELEASING.md); per-version changes in [CHANGELOG](docs/CHANGELOG.md)).

**From source**

```sh
node scripts/install-source.mjs --profile desktop --dsh-home "<DSH data directory>" --app-closed
```

Keep the source directory in place after installation. See [upgrading](docs/UPGRADING.md) and [contributing](CONTRIBUTING.md); see the [beginner guide](README.beginner.md#english) if you are new to the command line.

<h2 id="usage">Usage</h2>

1. Open **Settings → Wallpaper Engine → Library**, or pull the mascot cord above the chat.
2. Pick a thumbnail in the in-panel library and adjust playback / appearance; changes apply immediately and persist on the host.
3. Pause / play controls only the current playback; clearing the current wallpaper never deletes the source file.

<a href="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/settings-ui.gif">
  <img src="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/settings-ui.gif" alt="Settings UI">
</a>

<a href="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/wallpaper-library.gif">
  <img src="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/wallpaper-library.gif" alt="Wallpaper library">
</a>

<h2 id="compatibility">Compatibility</h2>

- Windows, macOS and Linux share the same source. macOS has no Wallpaper Engine client: upload images / videos or point custom-wallpaper storage at WE project directories.
- Scene rendering depends on browser WebGL and drivers; complex workshop projects may differ. Failures degrade gracefully.
- Occlusion pause, focus-loss pause and audio loopback are platform-adapted; online lyrics are off by default.
- When running with other skins / plugins, read [Coexistence](docs/en/HOW-IT-WORKS.md#coexistence-glass-surfaces-vs-other-ui-plugins) first.

<a href="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/better-sidebar-font.png">
  <img src="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/better-sidebar-font.png" alt="Sidebar glass and font adaptation">
</a>

<h2 id="development">Development</h2>

Bug reports, platform feedback, documentation fixes and feature PRs are welcome. Include host / plugin versions, OS, wallpaper type, reproduction steps and sanitized logs.

- [How it works](docs/HOW-IT-WORKS.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Upgrading](docs/UPGRADING.md)
- [Changelog](docs/CHANGELOG.md) · [Coexistence](docs/en/HOW-IT-WORKS.md#coexistence-glass-surfaces-vs-other-ui-plugins) · [Code structure](docs/CODE-STRUCTURE.md)
- [Contributing](CONTRIBUTING.md) · [Release process](docs/RELEASING.md)

<h2 id="community">Community</h2>

<p align="center">
  <a href="lib/about/qq-group.png"><img src="lib/about/qq-group.png" alt="QQ group: DSHWE | LLM" width="260" height="259"></a>
  &nbsp;
  <a href="lib/about/douyin-group.png"><img src="lib/about/douyin-group.png" alt="Douyin group: dshwe 2" width="260" height="260"></a>
</p>

<h2 id="star-history">Star history</h2>

<a href="https://star-history.com/#elysia395/dsh-wallpaper-engine&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=elysia395/dsh-wallpaper-engine&amp;type=Date&amp;theme=dark">
    <img src="https://api.star-history.com/svg?repos=elysia395/dsh-wallpaper-engine&amp;type=Date" alt="Upstream Star History" width="960">
  </picture>
</a>

<h2 id="special-thanks">Special Thanks</h2>

Special thanks to all contributors for their contributions to this project ❤️

<a href="https://github.com/elysia395/dsh-wallpaper-engine/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=elysia395/dsh-wallpaper-engine" alt="Contributors">
</a>

<p align="center"><sub>Code is released under the <a href="LICENSE">MIT License</a>. Wallpaper, character and font assets may use different licenses; check <a href="assets/readme/SOURCES.md">asset sources</a> before redistribution or commercial use.</sub></p>
