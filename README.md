<div align="center">

<p>
  <a href="README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-lang-zh-dark.png"><img src="assets/readme/key-lang-zh-light.png" alt="中文" height="60"></picture></a>
  <a href="README.en.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-lang-en-dark.png"><img src="assets/readme/key-lang-en-light.png" alt="English" height="48"></picture></a>
  <a href="README.beginner.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-lang-start-dark.png"><img src="assets/readme/key-lang-start-light.png" alt="入门指南" height="48"></picture></a>
</p>

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-dark.png">
    <img src="assets/readme/hero-light.png" alt="DSH Wallpaper Engine" width="1440">
  </picture>
</h1>

[![npm Version](https://img.shields.io/npm/v/dsh-plugin-wallpaper-engine?style=flat-square&logo=npm&label=npm&color=8fd6a0&labelColor=5a544a)](https://www.npmjs.com/package/dsh-plugin-wallpaper-engine) [![正式主仓 Stars](https://img.shields.io/github/stars/elysia395/dsh-wallpaper-engine?style=flat-square&label=Upstream%20Stars&color=ffd84a)](https://github.com/elysia395/dsh-wallpaper-engine/stargazers)[![正式发布](https://img.shields.io/github/v/release/elysia395/dsh-wallpaper-engine?style=flat-square&label=Upstream%20Release&color=8fd6a0)](https://github.com/elysia395/dsh-wallpaper-engine/releases) [![npm 月下载量](https://img.shields.io/npm/dm/dsh-plugin-wallpaper-engine?style=flat-square&label=npm%20Downloads&color=8fd6a0)](https://www.npmjs.com/package/dsh-plugin-wallpaper-engine)
<p>
  <a href="https://trendshift.io/repositories/170341" target="_blank"><img src="https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/badges/trendshift-daily.svg" alt="Trendshift · JavaScript 日榜最好名次" width="250" height="55"></a>
  <a href="https://trendshift.io/repositories/170341" target="_blank"><img src="https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/badges/trendshift-weekly.svg" alt="Trendshift · JavaScript 周榜最好名次" width="250" height="55"></a>
</p>

<p>
  <a href="#快速开始"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-get-dark.png"><img src="assets/readme/key-get-light.png" alt="安装使用 GET" height="48"></picture></a>
  <a href="README.beginner.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-setup-dark.png"><img src="assets/readme/key-setup-light.png" alt="新手指南 SETUP" height="48"></picture></a>
  <a href="docs/README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-docs-dark.png"><img src="assets/readme/key-docs-light.png" alt="文档 DOCS" height="48"></picture></a>
  <a href="https://github.com/elysia395/dsh-wallpaper-engine/releases"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-release-dark.png"><img src="assets/readme/key-release-light.png" alt="发布页 RELEASE" height="48"></picture></a>
</p>

</div>

<h2 id="简介"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-intro-dark.png"><img src="assets/readme/section-intro-light.png" alt="INTRO · 简介" width="1440"></picture></h2>

把本机 **Wallpaper Engine** 的 Scene、Web 与视频壁纸带进 DSH 对话界面，再配上液态玻璃、字体、吉祥物与可分享的外观预设。插件不向 agent 注册工具、不注入提示文本，**不增加模型 token 开销**。

<a id="界面预览" href="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/main-interface.gif">
  <img src="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/main-interface.gif" alt="DSH 对话界面中的壁纸、液态玻璃与吉祥物演示" width="960">
</a>

<p align="center"><sub>真实界面演示；历史素材与当前安装版本可能略有不同。</sub></p>

<h2 id="目录"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-index-dark.png"><img src="assets/readme/section-index-light.png" alt="目录" width="1440"></picture></h2>

<table>
  <tr>
    <td width="40%" valign="middle">
      <ul>
        <li><a href="#界面预览">界面预览</a> · <a href="#主要能力">主要能力</a> · <a href="#支持哪些壁纸">支持哪些壁纸</a></li>
        <li><a href="#快速开始">快速开始</a> · <a href="#使用">使用</a> · <a href="#兼容与限制">兼容与限制</a></li>
        <li><a href="#开发与贡献">开发与贡献</a> · <a href="#致谢">致谢</a></li>
        <li><a href="#赞赏">赞赏</a> · <a href="#联系方式">联系方式</a></li>
      </ul>
    </td>
    <td width="30%" align="center" valign="middle">
      <a href="assets/readme/mascot-eating-rice-1280x1784.jpg">
        <img src="assets/readme/mascot-eating-rice-1280x1784.jpg" alt="吉祥物干饭插画" width="320">
      </a>
    </td>
    <td id="赞赏" width="30%" align="center" valign="middle">
      <a href="assets/about/sponsor-fish.png"><img src="assets/about/sponsor-fish.png" alt="生鱼的赞赏码" width="260" height="260"></a>
      <br><strong>生鱼的赞赏码</strong>
      <br><sub>项目保持开源，赞赏完全自愿，不影响安装、使用或问题反馈。</sub>
    </td>
  </tr>
</table>

<h2 id="主要能力"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-features-dark.png"><img src="assets/readme/section-features-light.png" alt="能做什么" width="1440"></picture></h2>

- **壁纸**：Scene / Web 实时渲染，Video 直接播放；支持自定义图片 / 视频上传与 WE 项目目录。
- **外观**：设置窗、对话区与侧栏液态玻璃；配色、透明度、模糊、边框与字体可调。
- **玻璃子包**：液态玻璃是独立子包行 `wallpaper-engine-glass`，可在插件管理器单独停用；停用后，除内容区壁纸外界面回到宿中原生外观，壁纸、字体与吉祥物等功能不受影响。
- **扩展**：吉祥物、会话头像、点击 / 拖尾特效、3D 视差；可选官方 `dsh-pet` 联动。
- **壁纸库**：筛选、隐藏 / 恢复、自动轮播；外观预设整套导入导出。

<h2 id="支持哪些壁纸"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-formats-dark.png"><img src="assets/readme/section-formats-light.png" alt="支持哪些壁纸类型" width="1440"></picture></h2>

| 类型 | 在 DSH 中的路径 | 支持情况 |
|---|---|---|
| **Scene（场景）** | 内置 WebWallGL 实时渲染，失败时按降级链回退 | 支持，不需要 WE 在后台运行 |
| **Web（网页）** | 网页挂载、WE API 注入与沙箱隔离 | 支持；效果取决于网页与浏览器能力 |
| **Video（视频）** | 浏览器播放，配合转码、帧率上限与暂停控制 | 支持 |
| **Picture（图片 / 幻灯片项目）** | 读取 WE `preset` 项目的图片目录，按 WE 里设的周期在本机交叉淡化轮播 | 支持；图片不上传、留在本机 |
| **自定义图片 / 视频** | 上传本地 JPG / PNG / MP4 | 支持，文件保存在本机 |

Application（应用）类壁纸需要启动第三方程序，**不支持**，也不会进入壁纸库或轮播候选。

<h2 id="快速开始"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-start-dark.png"><img src="assets/readme/section-start-light.png" alt="快速开始" width="1440"></picture></h2>

前置：**Node.js >= 22.12.0**、**DSH 0.2 内核**（含 `0.2.0-rc.1/rc.2`）与 **pnpm**。安装前完全退出 DSH。

**npm（推荐）**

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

桌面端把 `web` 改为 `desktop`。

本仓按**多包发布集**发布：主包与同版本子包一起解析（具体包数、tarball 数与 `publishOrder` 见[发布说明](docs/RELEASING.md)，各版本变化见[变更记录](docs/CHANGELOG.md)）。

**源码**

```sh
node scripts/install-source.mjs --profile desktop --dsh-home "<DSH 数据目录>" --app-closed
```

源码安装会构建客户端并注册主包与子包；安装后不要移动或删除源码目录。完整说明见 [安装与升级](docs/UPGRADING.md) 与 [贡献指南](CONTRIBUTING.md)；没有命令行经验请先看 [入门指南](README.beginner.md)。

<h2 id="使用"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-usage-dark.png"><img src="assets/readme/section-usage-light.png" alt="使用" width="1440"></picture></h2>

1. 打开 **设置 → Wallpaper Engine → 壁纸库**，或在聊天顶部从吉祥物拉绳进入壁纸仓库。
2. 在页内壁纸库选择缩略图，按需调整播放与外观；修改即时生效并保存到宿主端。
3. 暂停 / 播放只控制当前播放；清除当前壁纸不会删除原文件。

<a href="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/settings-ui.gif">
  <img src="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/settings-ui.gif" alt="设置界面功能展示">
</a>

<a href="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/wallpaper-library.gif">
  <img src="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/wallpaper-library.gif" alt="壁纸库与壁纸仓库">
</a>

<h2 id="兼容与限制"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-compat-dark.png"><img src="assets/readme/section-compat-light.png" alt="兼容与限制" width="1440"></picture></h2>

- Windows / macOS / Linux 使用同一份源码；macOS 没有 WE 客户端，可上传图片 / 视频或指向 WE 项目目录。
- Scene 渲染依赖浏览器 WebGL 与显卡驱动，复杂工坊项目可能存在兼容差异；失败会逐级降级。
- 遮挡暂停、窗口失焦暂停与音频回环采集按平台适配；在线歌词默认关闭。
- 与其他皮肤 / 插件同时启用时，先看 [共存说明](docs/HOW-IT-WORKS.md#共存玻璃表面与其他-ui-插件)。

<a href="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/better-sidebar-font.png">
  <img src="https://github.com/elysia395/dsh-wallpaper-engine/releases/download/media-v1/better-sidebar-font.png" alt="侧栏玻璃与字体适配">
</a>

<h2 id="开发与贡献"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-develop-dark.png"><img src="assets/readme/section-develop-light.png" alt="开发与贡献" width="1440"></picture></h2>

欢迎提交 Bug 复现、平台兼容反馈、文档修正和功能 PR。反馈时请附宿主 / 插件版本、操作系统、壁纸类型、复现步骤与脱敏日志。

- [工作原理](docs/HOW-IT-WORKS.md) · [故障排查](docs/TROUBLESHOOTING.md) · [升级指南](docs/UPGRADING.md)
- [更新记录](docs/CHANGELOG.md) · [共存说明](docs/HOW-IT-WORKS.md#共存玻璃表面与其他-ui-插件) · [代码结构](docs/CODE-STRUCTURE.md)
- [贡献指南](CONTRIBUTING.md) · [发布流程](docs/RELEASING.md)

<h2 id="联系方式"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-community-dark.png"><img src="assets/readme/section-community-light.png" alt="联系方式" width="1440"></picture></h2>

<p align="center">
  <a href="lib/about/qq-group.png"><img src="lib/about/qq-group.png" alt="QQ 群：DSHWE | LLM 讨论群" width="260" height="259"></a>
  &nbsp;
  <a href="lib/about/douyin-group.png"><img src="lib/about/douyin-group.png" alt="抖音群：dshwe 交流 2 群" width="260" height="260"></a>
</p>

<h2 id="star-history"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-stars-dark.png"><img src="assets/readme/section-stars-light.png" alt="Star History" width="1440"></picture></h2>

<a href="https://star-history.com/#elysia395/dsh-wallpaper-engine&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=elysia395/dsh-wallpaper-engine&amp;type=Date&amp;theme=dark">
    <img src="https://api.star-history.com/svg?repos=elysia395/dsh-wallpaper-engine&amp;type=Date" alt="上游项目 Star History 趋势图" width="960">
  </picture>
</a>

<h2 id="致谢"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-credits-dark.png"><img src="assets/readme/section-credits-light.png" alt="致谢" width="1440"></picture></h2>

感谢所有贡献者对本项目的贡献 ❤️

<a href="https://github.com/elysia395/dsh-wallpaper-engine/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=elysia395/dsh-wallpaper-engine" alt="Contributors">
</a>

<p align="center"><sub>代码以 <a href="LICENSE">MIT License</a> 开源；壁纸、角色与字体素材的授权可能不同，再分发或商用前请核对 <a href="assets/readme/SOURCES.md">素材说明</a>。</sub></p>
