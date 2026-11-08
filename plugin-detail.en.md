# Wallpaper Engine

Bring your local **Wallpaper Engine** Scene, Web and video wallpapers into the DSH chat UI, with liquid glass, typography, a mascot and shareable appearance presets. The plugin registers no agent tools and injects no prompt text, so it adds **no model token overhead**.

![Wallpapers and liquid glass in the DSH chat UI](assets/readme/hero-light.png)

## What it does

- **Wallpapers**: Scene and Web render in real time through the bundled WebWallGL engine, Video plays directly; local image / video uploads and installed Wallpaper Engine projects are supported too.
- **Appearance**: liquid glass for the settings window, chat area and sidebars; colours, opacity, blur, borders and fonts are adjustable. Glass ships as its own subpackage row `wallpaper-engine-glass` and can be disabled on its own in the plugin manager.
- **Extensions**: mascot, session avatar, click / trail effects, 3D parallax, and optional desktop-pet integration.
- **Library**: filtering, hiding / restoring, auto-rotation, and whole-set appearance preset import / export.

## Getting started

Requirements: a **DSH 0.2 kernel**, **Node.js ≥ 22.12.0**, and Wallpaper Engine installed (only needed for WE wallpapers).

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

On the desktop build, replace `web` with `desktop`. Then open **Settings → Wallpaper Engine → Wallpaper library**; you can also pull the mascot's rope at the top of the chat to open the wallpaper drawer.

The full guide lives in the [README](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/README.en.md); questions and reports belong in [Issues](https://github.com/elysia395/dsh-wallpaper-engine/issues).

中文: [README.md](https://github.com/elysia395/dsh-wallpaper-engine)
