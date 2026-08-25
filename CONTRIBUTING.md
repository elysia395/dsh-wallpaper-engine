# Contributing / 参与贡献

Thanks for helping improve `dsh-wallpaper-engine`. Please keep each pull request focused on one clear problem and include the platform and verification results in its description.

感谢你参与改进 `dsh-wallpaper-engine`。请让每个 Pull Request 聚焦一个明确问题，并在说明中写清适用平台和验证结果。

## Choose the target branch / 选择目标分支

| Change / 改动 | Pull request base / PR 目标分支 |
|---|---|
| Windows, WSL, and shared cross-platform behavior / Windows、WSL 与跨平台公共功能 | `main` |
| macOS, WaifuX, loose-media discovery, and the macOS package / macOS、WaifuX、松散媒体扫描与 macOS 包 | `dsh-wallpaper-engine-mac` |

The macOS line is maintained by [Jerry (@ruijiaang-lab)](https://github.com/ruijiaang-lab). Keeping platform-specific work on the macOS branch lets the Windows-first `main` line and the WaifuX integration evolve without overwriting each other.

macOS 版本由 [Jerry（@ruijiaang-lab）](https://github.com/ruijiaang-lab)维护。将平台专属改动提交到 macOS 分支，可以避免 Windows-first `main` 与 WaifuX 适配在同步时互相覆盖。

## Build from the canonical source / 从唯一源码构建

- `src/client.js` is the canonical browser source. Edit it, then run `npm run build` to regenerate `lib/client.js`.
- `lib/client.js` is generated and tracked for distribution. Do not edit it by hand.
- Host-side changes live directly in `lib/index.js` and the other `lib/*.js` host modules.
- Use the Node.js version required by the target branch and your DSH profile. The macOS package currently requires Node.js 24 or newer.

- `src/client.js` 是浏览器端唯一源码。修改后运行 `npm run build` 重新生成 `lib/client.js`。
- `lib/client.js` 是随包分发的构建产物，请勿手改。
- 宿主端代码直接位于 `lib/index.js` 和其他 `lib/*.js` 模块中。
- 请使用目标分支与 DSH profile 要求的 Node.js 版本；当前 macOS 包要求 Node.js 24 或更高版本。

## Verify before opening a PR / 提交 PR 前验证

```sh
npm ci
npm run build
npm run verify
git diff --check
```

For UI changes, also describe the real DSH surface you tested, including browser or DSH Desktop mode. For platform-specific changes, call out the source layout used in the test—for example Wallpaper Engine, WSL, WaifuX, or loose media.

UI 改动还应说明实际测试过的 DSH 界面、浏览器或 DSH Desktop 模式。平台专属改动请注明测试数据来源，例如 Wallpaper Engine、WSL、WaifuX 或松散媒体文件。

## Pull request checklist / PR 检查清单

- The PR targets the correct branch for its platform.
- Source and generated client output are both included when `src/client.js` changes.
- Existing platform behavior is preserved or the intentional change is explained.
- Build and verification commands pass.
- The PR contains no credentials, local media, generated caches, or unrelated cleanup.

- PR 已选择正确的平台分支。
- 修改 `src/client.js` 时同时包含重新生成的客户端产物。
- 现有平台行为已保留，或正文已解释有意变更。
- 构建与验证命令全部通过。
- PR 不含凭据、本地媒体、生成缓存或无关清理。
