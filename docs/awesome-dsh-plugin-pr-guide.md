# 向 awesome-dsh-plugin 提交插件收录 PR 的操作指南

> 目标仓库：`awesome-dsh-plugin/awesome-dsh-plugin`
> 你的 fork：`elysia395/awesome-dsh-plugin`
> 提交对象：插件 `dsh-plugin-wallpaper-engine`（仓库 `elysia395/dsh-wallpaper-engine`）

本指南依据上游 `CONTRIBUTING.md` 与 `check-submission.mjs` 的校验逻辑编写。上游 README 由脚本生成，**禁止手改**；所有改动只发生在 `data/plugins/` 下你的那个 YAML 文件 + 由脚本重新生成的 README。

---

## 〇、前置自检（提交前必须全部满足，否则 CI 直接打回）

| 检查项 | 要求 | 你的现状 |
|---|---|---|
| 插件仓库年龄 | ≥ 1 天 | ✅ 创建于 2026-08-16 |
| 提交数量 | ≥ 10 个 commit | ✅ 29 个 |
| `dsh.bundle` manifest | 仓库 `package.json` 必须声明 `dsh.bundle`（仅 `dsh.client` 会被拒） | ✅ 已有 `dsh.bundle.patch` |
| `cordis.patch.yml` | 与 `package.json` 同目录 | ✅ 已有 |
| `dsh-plugin` topic | 仓库必须打上该 topic 标签 | ⚠️ 待确认（见第 6 节） |
| description | 只描述功能、无营销词、必须准确 | 本文档第 4 节已备好 |
| 分类 | 选与功能匹配的类别，主题/皮肤 → `theme` | ✅ 选 `theme` |

> 注意：上游 `check-submission.mjs` 会**实际访问你的插件仓库**，从根目录（或 `packages/`、`plugins/`、`apps/` 子包）的 `package.json` 读取 `dsh.bundle`，并检查仓库年龄与 commit 数。请确保提交 PR 时插件仓库处于公开且可访问状态。

---

## 一、准备工作

### 1.1 本地 clone 你的 fork

```powershell
git clone https://github.com/elysia395/awesome-dsh-plugin.git
cd awesome-dsh-plugin
```

### 1.2 添加上游源并同步

```powershell
git remote add upstream https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
git fetch upstream
git checkout main
git merge upstream/main    # 或 git reset --hard upstream/main（fork 无本地修改时更稳）
git push origin main
```

> 每次提交 PR 前都先做这一步，保证基于最新上游。

---

## 二、创建功能分支

```powershell
git checkout -b add/dsh-wallpaper-engine
```

---

## 三、创建 YAML 条目文件

在 `data/plugins/` 下新建**唯一一个文件**，命名规则：`<owner>__<repo>.yml`，即：

```
data/plugins/elysia395__dsh-wallpaper-engine.yml
```

---

## 四、YAML 内容（已按规范备好，可直接使用）

```yaml
url: https://github.com/elysia395/dsh-wallpaper-engine
name: elysia395/dsh-wallpaper-engine
category: theme
description:
  en: 'Wallpaper Engine backgrounds for the DSH web GUI: renders local Video and Web wallpapers behind the chat with an iOS-style liquid glass effect and adjustable blur, dim, border and glass sliders.'
  zh: 在 DSH 网页界面后方渲染本机 Wallpaper Engine 的 Video/Web 壁纸，支持 iOS 风格液态玻璃效果，并可用滑动条调节模糊、暗化、边框与玻璃强度。
```

**格式要点（违反会被 CI 或维护者打回）：**
- `url` 必须与插件仓库完全一致（`https://github.com/elysia395/dsh-wallpaper-engine`），**不要**写 `.git` 后缀。
- `name` 是列表里的链接文本：`elysia395/dsh-wallpaper-engine`。
- `description.en` **必填**，英文以句号结尾；`description.zh` 选填（留空维护者会补，但不建议，中文读者会看到缺翻译）。
- **描述含 `: `（英文冒号+空格）时整个字符串必须加单引号**。上述 en 描述里的 `web GUI:` 已加引号。若未来改描述，凡含 `: ` 记得加引号。
- 描述只讲功能，不得出现"最好/最强/惊艳"等营销措辞；若描述里提到数字或 API 名称，必须与实际代码一致（维护者会对照代码核实）。
- 分类：主题/皮肤类必须用 `theme`（会自动进入 dsh-market 的 Themes Tab）。可参考同类已收录条目 `keke050/dsh-wallpaper`。

---

## 五、重新生成 README 并提交

上游要求 PR 必须同时携带重新生成的 README（`README.md` + `README.zh.md`），否则 CI 报"README 未重新生成"。

```powershell
npm ci
node scripts/generate-readme.mjs
```

运行后检查：
- `data/plugins/elysia395__dsh-wallpaper-engine.yml` 存在 ✅
- `README.md` / `README.zh.md` 有对应变更（你的条目出现在 **主题与外观/Themes & Appearance** 分类下）

然后提交（只提交你自己的改动，**绝不**碰其他条目）：

```powershell
git add data/plugins/elysia395__dsh-wallpaper-engine.yml README.md README.zh.md
git commit -m "Add dsh-plugin-wallpaper-engine to themes"
git push origin add/dsh-wallpaper-engine
```

> ⚠️ 提交信息随仓库规范；若上游 PR 模板有具体要求，以模板为准。
> ⚠️ `git add` 时仔细核对 `git status`，确保没有把其他插件的 YAML 或无关文件带进来。上游对"PR 修改了不属于你的条目"是零容忍（曾因误改相邻条目打回过）。

---

## 六、给插件仓库打 `dsh-plugin` topic（若尚未完成）

这是贡献规则的一部分，也让所有目录站自动收录你。

在插件仓库页面 `https://github.com/elysia395/dsh-wallpaper-engine` → 右侧 **About** 区 → ⚙️ 齿轮 → **Topics** 输入框 → 填入 `dsh-plugin` → **Save changes**。

> 若用 API 方式：`gh repo edit elysia395/dsh-wallpaper-engine --add-topic dsh-plugin`
> （此前你的 fine-grained token 因缺 Administration 权限返回 403，若网页操作更方便可直接走网页。）

---

## 七、创建 Pull Request

### 方式 A：网页（推荐，可视化）

1. 打开 `https://github.com/elysia395/awesome-dsh-plugin`，GitHub 会提示你的 `add/dsh-wallpaper-engine` 分支（有绿色 **Compare & pull request** 按钮）。
2. 确认 base 仓库 = `awesome-dsh-plugin/awesome-dsh-plugin` 的 `main`，head 仓库 = 你的 fork 的 `add/dsh-wallpaper-engine`。
3. 标题：`Add dsh-plugin-wallpaper-engine to themes`
4. 正文简明说明：
   ```markdown
   Adds [dsh-plugin-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) under Themes & Appearance.

   - Renders local Wallpaper Engine Video/Web wallpapers behind the DSH web chat UI
   - iOS-style liquid glass effect with adjustable blur / dim / border / glass sliders
   - Declares `dsh.bundle` manifest with `cordis.patch.yml`
   - Publishable via npm (`dsh plugin add dsh-plugin-wallpaper-engine`)
   ```
5. 点击 **Create pull request**。

### 方式 B：gh CLI（若 token 权限已修复）

```powershell
gh repo set-default awesome-dsh-plugin/awesome-dsh-plugin
gh pr create --base main --head elysia395:add/dsh-wallpaper-engine --title "Add dsh-plugin-wallpaper-engine to themes" --body "..."
```

---

## 八、提交后的流程与应对

### 8.1 CI 会按顺序检查

1. `dsh.bundle`：从你插件仓库的 `package.json` 读取（只声明 `dsh.client` 会在此失败）。
2. 仓库年龄（≥1 天）+ commit 数（≥10）。
3. `awesome-lint` + 站点构建（双语文案一致、分隔符、日期、截图）。

CI 失败时，报错会明确指出改哪里。**在同一分支继续 push 修复即可，不用重开 PR。**

### 8.2 维护者人工审查（CI 通过只是前置条件）

维护者会打开你的插件仓库人工核对：
- 代码是否真做了描述里说的事（含描述中提到的数字、API 名称）
- 分类是否合理（选错维护者会直接改，不退回）
- 是否真实可用代码（占位/空壳会被拒）
- 是否与列表已有条目重复（同功能先到先得，但更优的实现会被收）
- 源码是否有可疑点（混淆代码、凭据外泄、意外的安装时行为）
- PR 是否误改了别的条目

**常见被退回原因与对策：**
- 描述夸大 → 对照代码修正措辞，改一行重新 push
- 分类不准 → 等维护者改，或在评论里说明为什么 `theme` 更合适
- 打回≠拒绝，按 PR 评论逐条修完后 push 即可再次进入审查

---

## 九、可选的增强项（非必须）

### 9.1 添加截图（推荐）

在 `data/screenshots.json` 里，以插件仓库 URL 为 key，映射 1–8 张图：

```jsonc
{
  "https://github.com/elysia395/dsh-wallpaper-engine": [
    "https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/main/assets/screenshot-1.png"
  ]
}
```

要求：图片必须是 GitHub 自家托管的 https URL（`raw.githubusercontent.com`、`user-images.githubusercontent.com`、`camo.githubusercontent.com` 或 github 附件），放你自己仓库的 `assets/` 目录。没有截图也行，市场会退回从 README 抽取。

### 9.2 确保 npm 已发布（强烈建议）

上游明确推荐发布到 npm，用户安装体验最好（预构建，跳过 `allowBuilds` 授权步骤）。你的插件当前应发布 **0.1.4**（0.1.3 已占用），发布命令：

```powershell
npm version patch   # 0.1.3 → 0.1.4
npm run build
npm publish
```

> 若插件能完全从源码安装且你选择不发布 npm，则必须为仓库附一个 GitHub Release 的预构建 tarball 并加 `tarball:` 字段，否则可能被拒。

---

## 十、完整命令流水（速查）

```powershell
# 1. 同步 fork
git remote add upstream https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
git fetch upstream && git checkout main && git reset --hard upstream/main && git push -f origin main

# 2. 建分支 + 写 YAML（用第 4 节内容）
git checkout -b add/dsh-wallpaper-engine
#  → 新建 data/plugins/elysia395__dsh-wallpaper-engine.yml

# 3. 重新生成 README
npm ci
node scripts/generate-readme.mjs

# 4. 提交推送
git add data/plugins/elysia395__dsh-wallpaper-engine.yml README.md README.zh.md
git commit -m "Add dsh-plugin-wallpaper-engine to themes"
git push origin add/dsh-wallpaper-engine

# 5. 打 topic（若未做）
gh repo edit elysia395/dsh-wallpaper-engine --add-topic dsh-plugin

# 6. 创建 PR
gh pr create --base main --head elysia395:add/dsh-wallpaper-engine --title "Add dsh-plugin-wallpaper-engine to themes" --body "..."
```
