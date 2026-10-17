# 桌宠联动子包

本目录是完整的 `dsh-plugin-wallpaper-engine-pet-link` 子包：包含能力路由、浏览器排播、维护面板、桥接安装器、九段联动动画、五张气泡配图及回归测试。浏览器入口由 wallpaper 的构建器内联，吉祥物入口仍由 wallpaper 持有，避免重复挂载。

**不声明或自动安装 `dsh-pet` 依赖。** 未安装桌宠、桥接未准备、桌宠未在当前网页显示或联动关闭时，吉祥物保留 wallpaper 的原生点击、拖动及键盘行为。`Ctrl+Shift+D` 维护面板仍可查看、修改、重置和导出参数；没有运行资格时禁止试跑。

## 体验步骤

1. 在仓库根目录运行 `npm install` 和 `npm run build`。开发链接安装请按仓库现有方法运行 `node scripts/dev-link-subpackages.mjs --profile <当前profile>`，确保主包和本子包都能由该 profile 解析。
2. 仅在需要真实桌宠联动时，自行安装并启用受支持的 `dsh-pet@0.3.6`。本子包不会安装、升级、启用或替换未知版本的桌宠。
3. 显式指定当前 DSH 数据目录和桌宠包目录，先检查再安装：

```sh
node packages/pet-link/tools/install-bridge.mjs --dsh-home "<DSH_HOME>" --pet-package "<当前profile>/node_modules/dsh-pet" --check
node packages/pet-link/tools/install-bridge.mjs --dsh-home "<DSH_HOME>" --pet-package "<当前profile>/node_modules/dsh-pet"
```

**第二条命令会修改该桌宠的客户端与宿主代码，并写入联动资源和安装凭据。** 安装器先检查版本、严格代码指纹和全套资源，再备份、事务写入并校验；任何失败回滚本次已写文件，不覆盖并发的外部修改。未知构建拒绝写入。备份保存在 `<DSH_HOME>/dsh-pet/pet-link-backups/`。

4. 首次准备完成后，重新加载对应插件和网页，使补丁代码真正进入运行时。这与运行中的热插拔是两件事。请先导出维护面板中尚未保存的参数。
5. 把主桌宠设为网页显示，并将 wallpaper 吉祥物的侧栏模式设为官方侧栏；默认抽屉模式保留上游原有预览和拖动，不接管。按 `Ctrl+Shift+D` 打开维护面板，分别试跑逻辑一、逻辑二、彩蛋一、彩蛋二。

运行中的资格每 500ms 复核，租约上限 1500ms。桌宠隐藏、桥接退出、联动关闭或运行实例更换时撤销演出，归还动作、气泡、位移、侧栏临时样式及特效；恢复条件后重新探测。它不是“任意依赖变动在同一毫秒生效”的保证。

可通过独立的 `wallpaper-engine-pet-link` 宿主行启停本子包，或将该行配置设为 `linkEnabled: false`。不会因此关闭 wallpaper 的其他能力。

## 四条逻辑与维护

- 逻辑一：走到侧栏、准备、后拉并跟随侧栏边缘。
- 逻辑二：左侧螃蟹步走到吉祥物下方，使用素材自身跳跃抓绳、脱手与下落。
- 彩蛋一：踢侧栏、首次接触时调用桌宠原生抛掷物理，侧栏缩回后二次展开，落定后恢复。
- 彩蛋二：原地哈气，抖动默认从视频 1750ms 的张嘴帧开始，侧栏按真实视频进度展开，实际 `ended` 才完整到位。

每页参数及气泡节点独立，彩蛋一有两条固定气泡。支持当前页重置、全部重置和 JSON 导出。参数是运行时覆盖，刷新恢复默认，不写用户永久配置。

## 验证

无需桌宠即可运行：

```sh
npm run build
npm run verify:pet-link
```

完整安装测试需要从 npm 官方 `dsh-pet@0.3.6` 包准备只读测试夹具，不要拿自己的活动安装做故障注入。解包目录通过参数传入：

```sh
node packages/pet-link/test/verify-pet-install-transaction.mjs "<原版解包目录>"
node packages/pet-link/test/verify-pet-runtime-owner.mjs "<原版解包目录>/lib/client.js"
```

集成测试通过 `PET_TEST_UPSTREAM` 指定原版目录，`PET_TEST_CORDIS_MODULE` 可指定真实 Cordis 的模块入口，再运行 `npm run verify:pet-link:integration`。测试会在仓库 `.artifacts/` 创建隔离 profile，验证真实 Cordis 的配置更新和十轮启停，不使用真实用户配置。

完整 React 浏览器测试还需要 Node.js 22+、Edge/Chromium、React 18 和 ReactDOM 18 的测试资源。设置 `PET_TEST_APP_ROOT` 指向 DSH 安装根目录，`PET_TEST_BROWSER` 指向浏览器可执行文件；按测试入口的资源路径准备 ReactDOM 后运行 `npm run verify:pet-link:browser`。测试使用独立浏览器 profile，不打开或刷新用户主窗口。缺少环境是测试失败，不冒充通过。

## 兼容边界

这是供两边作者共同体验和评审的联动实现，不是 `dsh-pet` 的官方控制 API。当前首次注入仅支持严格匹配的 0.3.6 构建；上游代码变化时应拒绝安装并重新适配。长期宜由桌宠公开版本化的动作播放回执、独立动作与气泡占用、位置交还和原生抛掷接口，替代文件指纹补丁。

补丁载体派生自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的 0.3.6 MIT 授权代码，随包保留 [原作者许可](tools/patch-data/LICENSE.dsh-pet)。本仓的代码许可证不自动替代素材各自的授权。

仅包含联动所需的定制动画及气泡图，不包含桌宠原版完整分发包、FFmpeg、个人配置、测试下载物或凭据。合并及发布前仍请维护者审查素材分发授权和包发布策略。
