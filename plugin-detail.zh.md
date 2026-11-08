# 壁纸引擎

把本机 **Wallpaper Engine** 的 Scene、Web 与视频壁纸带进 DSH 对话界面，再配上液态玻璃、字体、吉祥物与可分享的外观预设。插件不向 agent 注册工具、不注入提示文本，**不增加模型 token 开销**。

![DSH 对话界面中的壁纸与液态玻璃](assets/readme/hero-light.png)

## 能做什么

- **壁纸**：Scene / Web 由内置 WebWallGL 实时渲染，Video 直接播放；也支持上传本地图片 / 视频，或读取 Wallpaper Engine 已安装的项目。
- **外观**：设置窗、对话区与侧栏的液态玻璃；配色、透明度、模糊、边框与字体可调。玻璃是独立子包行 `wallpaper-engine-glass`，可以在插件管理器单独停用。
- **扩展**：吉祥物、会话头像、点击 / 拖尾特效、3D 视差，以及可选的桌宠联动。
- **壁纸库**：筛选、隐藏 / 恢复、自动轮播，外观预设整套导入导出。

## 开始使用

前置：**DSH 0.2 内核**、**Node.js ≥ 22.12.0**，以及已安装的 Wallpaper Engine（只有 WE 壁纸需要）。

```sh
dsh plugin --profile web add dsh-plugin-wallpaper-engine
```

桌面端把 `web` 改为 `desktop`。安装后打开 **设置 → 壁纸引擎 → 壁纸库** 选择壁纸；聊天顶部也可以从吉祥物拉绳进入壁纸仓库。

完整说明见 [README](https://github.com/elysia395/dsh-wallpaper-engine) 与 [文档](https://github.com/elysia395/dsh-wallpaper-engine/tree/main/docs)；问题与建议请到 [Issues](https://github.com/elysia395/dsh-wallpaper-engine/issues)。

English: [README.en.md](https://github.com/elysia395/dsh-wallpaper-engine/blob/main/README.en.md)
