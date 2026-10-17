/**
 * eslint.config.mjs — 静态检查（ESLint flat config）。
 *
 * ## 为什么是两套配置，而不是一套
 *
 * 本仓有**两种互不相同的半边**，它们的"作用域真相"不一样：
 *
 *   · **宿主半边**（`lib/**`、`scripts/**`、`test/**`）是**真 ESM 模块**：每个文件自己的
 *     `import` 决定自己看得见谁。ESLint 的默认模型在这里成立 —— `no-undef` 有牙。
 *   · **客户端半边**（`src/**`）是**扁平作用域片段**：这些文件不是模块，而是被
 *     `scripts/build-client.mjs` 按 `INLINE_MODULES` 顺序**平铺进同一个 factory 作用域**的
 *     代码段（该文件头 19–28 行解释了原因：浏览器半边没有本地模块解析器）。
 *
 * 于是在 `src/**` 上按默认模型判会**系统性误报**：`src/styles.js` 里用 `weClampTo` 是合法的
 * （它由内联清单里排在更前的 `src/we-base.js` 提供），而 `src/we-base.js` 里那个函数
 * 又会被判成"定义了没人用"。**误报比不报更坏**：它训练人忽略这门检查。因此这一半边
 * 显式关掉 `no-undef` / `no-unused-vars`，把"跨文件名字对得上"交给**真正拥有这个判据的人**：
 *   · 撞名（平铺后同作用域重复声明）→ `scripts/build-client.mjs` 的 `readInlinedPrelude()`
 *     机器提取注入名后与正文比对，**构建期硬失败**；
 *   · 未定义（引用了没人声明的名字）→ 构建期的 `new Script(output)` 语法解析 + 运行期。
 * 即：判据没有被丢掉，而是留在了能拿出机器事实的那一层。
 *
 * ## 为什么阈值走棘轮而不是"一把修干净"
 *
 * 45,000+ 行历史代码一次性修到零违规＝一场无法审查的巨型改动（也正是本仓铁律
 * "不做无判别力的批量文本替换"要挡的东西）。这里的目标是**让它只能变好**：
 * `test/verify-static.mjs` 按**规则**冻结一条基线（规则级计数对"挪代码"稳定，
 * 行级/文件级基线一重构就碎），此后任何一条规则**只能减不能增**。
 *
 * 用法：`npm run lint`（人读）· `npm run verify:static`（棘轮门禁 + 负对照）
 */
import js from '@eslint/js';

/** Node 内建全局名（手写而**不**引入 `globals` 包：少一个依赖，且这份清单本来就是有界的）。 */
const NODE_GLOBALS = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', clearImmediate: 'readonly', queueMicrotask: 'readonly',
  structuredClone: 'readonly', performance: 'readonly', fetch: 'readonly',
  AbortController: 'readonly', AbortSignal: 'readonly', global: 'readonly', globalThis: 'readonly',
  __dirname: 'readonly', __filename: 'readonly', require: 'readonly', module: 'writable',
  // Node ≥18 的实现里已有、但不在 `es2024` 语言全局里的两个 Web 平台构造器：
  // `WebSocket` 由 workspace 里的监听/回环夹具用，`Blob` 由 prepared-frame 冒烟用。
  WebSocket: 'readonly', Blob: 'readonly',
};

/**
 * 浏览器全局名 —— 只给**躺在 `lib/` 里、运行期却在页面上**的那几个文件用。
 *
 * `lib/webwallgl/**` 是引擎的浏览器侧产物（经路由原样发给页面），`lib/we-focus-guard.js`
 * 是同一形态的补丁脚本。它们物理上在宿主半边目录下（要随包分发、进 `files`），
 * 所以会被上面的宿主配置覆盖；不补这份清单就会得到一批**系统性的 `no-undef` 误报**
 * （`window`/`document`/`location` 在这里不是漏写，就是它们的运行环境）。
 *
 * 清单按**实测**逐个加入，不做"把 DOM 全搬进来"：多写一个名字就会静默放过一个真拼错的引用。
 */
const BROWSER_GLOBALS = {
  window: 'readonly', document: 'readonly', location: 'readonly', navigator: 'readonly',
  Image: 'readonly', HTMLCanvasElement: 'readonly', MutationObserver: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
};

/** 本仓**有意**依赖、且 `recommended` 会误判的形态，逐条给出豁免理由。 */
const JUSTIFIED_OFF = {
  // 守卫与构建脚本里有大量"先剥注释再判文本"的正则，字符类里的转义看着多余但不是。
  'no-useless-escape': 'off',
  // `src/**` 的扁平作用域片段的注释里常有一整段示例代码，空 catch 是刻意的"探测"形态。
  'no-empty': 'off',
  // 设置与 i18n 词表里**故意**匹配控制字符（`[\x00-\x1f]` 是判据本身：要挡的就是它们），
  // 不是漏转义。`no-control-regex` 的默认意图在这里正好相反。
  'no-control-regex': 'off',
};

export default [
  {
    // `lib/client.js` 是**构建产物**（`npm run build` 生成、不入库；新鲜度由 `test/verify-client-sync.mjs` 真跑构建逐字节判）。
    // 对产物报违规没有任何可执行的含义 —— 要改就改 `src/**` 再重建。
    // `.integration-notes/**`：`.gitignore` 里的**本地移交/取证笔记**（含 scratch 脚本与**另一个 worktree**）。
    // 不忽略它会把本机 lint 面从 ~260 撑到 ~1470（其中还有 `(fatal) Parsing error` 的历史探针），
    // 于是 `verify-static` 的棘轮在本机量与 CI 量之间对不上 —— 与 `repo-face.mjs` 的"脏扫描面"
    // （假绿）同一族：**扫描面必须来自 git 视角**。CI 上没有该目录 ⇒ CI 结论不变。
    ignores: [
      'lib/client.js', 'node_modules/**', '.npm-cache/**', '.test-cache/**', 'assets/**', 'lib/types/**',
      '.integration-notes/**',
    ],
  },

  // ── 宿主半边 + 工具链：真 ESM 模块 ──────────────────────────────────────────
  {
    files: ['lib/**/*.js', 'scripts/**/*.mjs', 'test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: NODE_GLOBALS,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...JUSTIFIED_OFF,
      // 捕获"抛了却没人接"的静默失败：本仓的守卫文化要求失败必须可见。
      'no-unused-private-class-members': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-promise-executor-return': 'error',
      'require-atomic-updates': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unused-expressions': 'error',
      'no-void': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'no-console': 'off', // 守卫与构建脚本的输出就是 console
    },
  },

  // ── `lib/` 里其实跑在页面上的那几个文件：宿主配置 + 浏览器全局 ───────────────
  // 为什么要单独一块：它们**物理上**属于发布面（随包分发、进 `files`），运行期却在浏览器里。
  {
    files: ['lib/webwallgl/**/*.js', 'lib/we-focus-guard.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
    },
    rules: {
      // 这几份是**以文本形式注入页面的经典脚本**（`lib/we-focus-guard.js` 由宿主把源码拼进
      // HTML、`lib/webwallgl/**` 经路由原样发给页面）：按经典脚本语义写 `var` 是形态本身
      // （函数体内提升、不引入块级 TDZ），换成 `let`/`const` 会改变提升与 TDZ 语义。
      // 它们的行为判据在 `test/verify-*` 里，不靠这条 lint 守。
      'no-var': 'off',
    },
  },

  // ── `test/**`：守卫要**求值被抽出来的客户端代码**，`new Function` 是判据手段本身 ──
  // 这批用法不是"动态执行不可信输入"：源码是仓内文件、内容在断言里逐条钉住。把它们判成
  // 违规只会逼人加 `eslint-disable`，从而失去"一处豁免一处理由"的可审计性。
  {
    files: ['test/**/*.mjs'],
    rules: {
      'no-new-func': 'off', 'no-eval': 'off', 'no-implied-eval': 'off', 'no-script-url': 'off',
      // 守卫里常拿**单引号**装一段"带 `${}` 的样本源码"（`test/tools/host-route-index.mjs`、
      // `test/tools/i18n-scan.mjs`、`test/verify-contracts.mjs`：判据的输入就是要被测的那段文本）。
      // 这里没有模板串插值的意图，规则的前提不成立 ⇒ 只对 `test/**` 关。
      'no-template-curly-in-string': 'off',
    },
  },

  // ── 客户端半边：扁平作用域片段（见文件头）────────────────────────────────────
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      // 片段本身不是模块，但保留 module 语义以便 ESLint 正确解析 `export {}` 块。
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      ...JUSTIFIED_OFF,
      // ⚠️ 只关这两条：它们是"把文件当独立模块"才成立的判据，而这里不是。
      // 同作用域撞名由构建脚本判、未定义由构建解析 + 运行期判（见文件头）。
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // 片段内**文件内**重复声明仍是真问题（平铺后同作用域一定是 SyntaxError）。
      'no-redeclare': 'error',
      // ⚠️ `no-var` 在 `src/**` 是**契约**不是坏味道：`scripts/build-client.mjs` 的文件头写明
      // 「顶层只声明函数与 `var` 状态、`apiJson` 在调用期解引用（无 TDZ 交互）」—— 这些片段被
      // 平铺进同一个 factory 作用域、跨片段互引，`var` 的状态声明正是不引入 TDZ 的手段。
      // 换成 `let`/`const` 会把"跨片段引用"变成时序敏感的 TDZ 崩溃面。
      'no-var': 'off',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      // ⚠️ 这里**故意不**声明 `react-hooks/exhaustive-deps`：本仓不装
      // `eslint-plugin-react-hooks`，声明一个未安装插件的规则只会在配置层制造假错误。
      // 历史：`src/client.js` 曾有一条 `eslint-disable-next-line react-hooks/exhaustive-deps`
      // 行内指令，它被报成 `Definition for rule ... was not found`（一条**假错误**，还进过棘轮
      // 基线）。该行内指令已随客户端半边的改动移除了 —— 实测 `src/**` 现在**零 `eslint-disable`
      // 指令**、ESLint 对 `src/**` 也无任何非规则型消息 ⇒ 这条欠账与它的基线条目都不存在了。
    },
  },

  // ── `src/client.js` 正文：产物契约要求它以 `return module.exports;` 收尾 ──────
  // 它是**平铺进 factory 的正文段**（不是模块）：没有 `import` / `export`，用 `require` / `exports`。
  // 按 `module` 解析会把收尾那个 `return` 判成 `Parsing error: 'return' outside of function` ——
  // 而**一条解析错误会吞掉整个文件的全部判据**（其余规则一条都不再报）。按 `commonjs` 解析
  // 正是它的真实形态，于是这个文件也能被门禁看见（实测这条修好后立刻暴露了两条真违规）。
  {
    files: ['src/client.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs' },
  },

  // ── 豁免面：**必须排在最后** ─────────────────────────────────────────────────
  // 上面 `src/**` 那块 spread 了 `js.configs.recommended.rules`，而 `@eslint/js` v10 的
  // recommended **包含** `no-irregular-whitespace` ⇒ 任何写在它**之前**的豁免都会被重新打开
  // （实测：`src/styles-base.js` 的 U+3000 一度照红）。所以形态级豁免集中放在数组末尾，
  // 并保持"一处豁免一段理由"。
  {
    // 注释里的全角空格是**排版**：中文注释用 U+3000 对齐列是刻意的书写方式；代码里的不规则
    // 空白仍要判红，所以只关注释面。
    rules: { 'no-irregular-whitespace': ['error', { skipComments: true }] },
  },
  {
    // `src/styles-*.js` 的模板串体是从原 `src/styles.js` **逐字节**搬出来的（拆域的唯一验收
    // 判据就是"拼回的 CSS 与拆前逐字节相同"）；里面的 U+3000 在 CSS 注释文本里，属**被搬运的
    // 数据**而不是书写失误 ⇒ 只对这几个数据文件关。
    files: ['src/styles.js', 'src/styles-*.js'],
    rules: { 'no-irregular-whitespace': 'off' },
  },
  {
    // `src/panel-tabs.js` 的 5 个 `render*Tab(ctx)` 函数体**第一条语句必须**是 `const { } = ctx;`：
    // `test/verify-scene-live.mjs:1861-1868` 用 `/^\s*\n\s*const \{[^}]*\} = ctx;/` 逐页签强制这条
    // 形状（意图写在 `:227-230`：别让后来人以为这个页签不用取外界就能绕过接缝）。空解构是
    // **契约的形状**，与 `src/**` 的 `no-var` 同性质 ⇒ 形态级豁免，真正的判据在守卫里。
    files: ['src/panel-tabs.js'],
    rules: { 'no-empty-pattern': 'off' },
  },
];
