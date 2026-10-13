# 立绘（Rope artwork）派生载荷

本目录存放**拉绳吉祥物立绘的运行时载荷**：10 张已经缩放、抠底、编码好的 PNG。
它们原本以 10 条单行 base64 常量内联在 `src/client.js` 里（合计 2,369,676 个字符 /
1,777,009 字节 PNG），是当时全仓最大的一处内聚污染（4300 行正文里塞了 2.3MB 数据）。
2026-10-13 起改为**构建期注入**：字节住这里，产物照样自包含。

## 构建期注入契约

源码里保留声明与注释，只把载荷换成占位符：

```js
const ROPE_IMG_WHALE = "data:image/png;base64,__ROPE_ART_WHALE__";
```

`scripts/build-client.mjs` 在拼装产物前扫一遍 `src/client.js`，把
`__ROPE_ART_<NAME>__` 替换成 `本目录/<NAME 小写>.png` 的 base64，并断言：

1. 每个占位符在正文里**恰好命中一次**（漏写/写重都当场 exit 1）；
2. 10 个占位符**全部被消费**（改名或漏文件 → 红）；
3. 替换后正文里**不再残留** `__ROPE_ART_`（占位符泄漏进产物 = 白屏，宁可构建失败）。

因此：**文件名 = 占位符名的小写形式**。改名必须同时动 `src/client.js`、本 README 与构建脚本。

## 文件与形态

| 文件 | 字节 | 像素 | 形态（`ROPE_FORMS` 的键） | 备注 |
|---|---|---|---|---|
| `whale.png` | 321,971 | 384×576 | `whale`（显示名 `Deepseek_Pro`） | 全身体鲸鱼女仆；源图 `assets/mascot/rope-whale-source-1024x1536.png`，2:3 精确对应 |
| `phoebe.png` | 125,011 | 283×384 | `phoebe` | 菲比啾比（2026-10-11 换图），源图 1254×1254 正方形 |
| `claude.png` | 179,363 | 324×384 | `claude` | 八只「模型娘」之一 |
| `deepseek.png` | 159,289 | 330×384 | `deepseek` | 八只「模型娘」之一 |
| `gemini.png` | 163,640 | 296×384 | `gemini` | 八只「模型娘」之一 |
| `gpt.png` | 169,823 | 320×384 | `gpt` | 八只「模型娘」之一 |
| `glm.png` | 161,342 | 308×384 | `glm` | 八只「模型娘」之一 |
| `grok.png` | 168,778 | 311×384 | `grok` | 八只「模型娘」之一 |
| `kimi.png` | 160,670 | 299×384 | `kimi` | 八只「模型娘」之一 |
| `qwen.png` | 167,358 | 307×384 | `qwen` | 八只「模型娘」之一 |

`whale` 之外九只的**源图、裁到 alpha 紧致包围盒、按面积平均缩放到高 384、PNG 自适应行
filter** 的完整派生流程与踩坑记录在 [`../mascot/README.md`](../mascot/README.md)（源资产归档
在 `assets/mascot/`）。本目录存的是**派生载荷**，不是源资产。

## 两条纪律

- **禁止重新编码/压缩/改格式**（WebP、优化 PNG、换 filter 都不行）：`lib/client.js` 的字节
  与拆分前**完全一致**正是这一刀的等价性证据（sha256 相同）。任何重编码都会改变 data URI
  字符串 ⇒ 该证据失效，且必须重新走一遍守卫。
- **不进 npm 包**（不在 `package.json` 的 `files` 白名单内），但构建期已注入 `lib/client.js`
  ⇒ 发布出去的包仍然自包含、可用。构建只在仓库内跑（`prepack` → `scripts/prepare.mjs`），
  不需要把本目录打进 tarball。
