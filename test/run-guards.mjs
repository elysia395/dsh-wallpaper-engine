#!/usr/bin/env node
/**
 * run-guards.mjs —— 守卫链的**显式有序清单 + 执行器**（`package.json` 的四条 scripts 都指向它）。
 *
 * ## 为什么需要它
 *
 * 此前 `verify` / `verify:docs` / `smoke` 各自是 `package.json` 里的一行 `&&` 链：
 * `verify` 一行 1.6KB / 43 条 `node test/xxx.mjs && …`。那行有两个问题：
 *   ① **不可读**：一条守卫的档位（硬 / 软）、它的参数（`--probe-spawn` / `--allow-skip`）、
 *      它在链里的位置，全都要人肉在 `&&` 之间数。
 *   ② **不可判**：想断言"链里有没有漏掉某条守卫"，只能去正则抠那行字符串（`verify-package-files`
 *      的 P5 就是这么干的）。字符串一改，判据就静默缩水。
 * 清单落到本文件后，链的形状成为**机器可读的数据**：`--list-json` 直接输出有序步骤表。
 *
 * ## 清单即真源
 *
 * `MANIFEST` 是这条链的**唯一真源**，本文件**不读 `package.json`**（否则 runner 与
 * package.json 互为循环、等价证明无从谈起）。`package.json` 那一侧只留一行
 * `node test/run-guards.mjs [group]`，由 `test/verify-package-files.mjs` 的 P5 从
 * `--list-json` 取有序清单与档位。
 *
 * ## 逐条等价（对旧 `&&` 链）
 *
 * | 旧写法 | 本 runner |
 * |---|---|
 * | `node test/a.mjs && node test/b.mjs` | 硬档步骤**串行**执行；任一步非 0 ⇒ 立即以**同一个退出码**退出（`&&` 的短路语义） |
 * | `node test/warn-only.mjs test/soft.mjs` | 软档步骤 → `node test/warn-only.mjs <file> [args…]`，**逐字复用现入口**：退出码降级、`[warn-only] 软档守卫原退出码 = N`、具名 `SKIP` 全都不重写 |
 * | `node test/warn-only.mjs --probe-spawn test/x.mjs --allow-skip` | 软档 + `probeSpawn: true` ⇒ 原样带上 `--probe-spawn` |
 * | `npm run build`（`verify:all` 首步） | `npmStep` ⇒ `npm run build`，与旧串一字不差 |
 *
 * 子进程一律 `stdio: 'inherit'`，与 `&&` 链一样把守卫自己的 `✓` / `✗` / `PASS |` 明细
 * 直接接到父进程的终端上。
 *
 * ## 用法
 *
 *   node test/run-guards.mjs [verify|docs|smoke|all]   跑一组（缺省 verify）
 *   node test/run-guards.mjs [group] --list            打印该组的等价命令串（**不执行**）
 *   node test/run-guards.mjs [group] --list-json       打印该组的机器可读步骤表（**不执行**）
 *
 * `--list` 的口径与旧 `package.json` 字符串**逐字等价**：把同组每一步渲染成
 * `node <file> <args…>` / `npm run <step>`，再用 ` && ` 连起来 —— 于是"清单有没有漂"
 * 可以拿旧字符串做一次纯文本 diff（见交付报告里的等价证明）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERE = 'test/run-guards.mjs';

/**
 * npm 步骤的子进程姿势（Windows 上的实测坑，别再试别的写法）。
 *
 * 本 runner 的 `npmStep`（`all` 组的首步 `npm run build`）此前直接 `spawnSync('npm', …)`，
 * 在 Node ≥ 18.20.2（CVE-2024-27980 的修法）之后于 Windows 上**必然起不来**：
 *   · 裸 `'npm'` ⇒ ENOENT（PATH 上只有 `npm` bash 脚本与 `npm.cmd` 垫片，没有可执行体）；
 *   · `'npm.cmd'` ⇒ EINVAL（Node 明确拒绝不经 shell 直接起 `.cmd`）；
 *   · `'npm.cmd' + shell:true` 能跑，但会带 DEP0190 告警（args 不转义）且多一层壳。
 * 可靠姿势：**用当前 node 直接跑 npm 自己的 CLI 入口 `npm-cli.js`**。
 * 先试 `npm_execpath`（npm 起的进程自带、就是那个入口），再试 Node 官方安装布局
 * `<nodeDir>/node_modules/npm/bin/npm-cli.js`（实测本机 D:\Nodejs 即此布局）。
 * 两者都找不到时退 `npm.cmd + shell:true`：还能跑，只是带一层 shell（POSIX 上 `npm` 本来
 * 就是脚本，同样的退路在那里也无副作用）。
 */
function npmLaunch(args) {
  const candidates = [];
  if (process.env.npm_execpath && /\.m?js$/.test(process.env.npm_execpath)) {
    candidates.push(process.env.npm_execpath);
  }
  candidates.push(join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  for (const c of candidates) {
    if (existsSync(c)) return { exe: process.execPath, argv: [c, ...args], shell: false };
  }
  return { exe: process.platform === 'win32' ? 'npm.cmd' : 'npm', argv: args, shell: process.platform === 'win32' };
}

/**
 * 一条步骤。
 *   `file`     —— 仓库根相对的守卫路径。
 *   `args`     —— 该守卫的参数（按旧链逐字抄）。
 *   `tier`     —— `'hard'`（挡 PR，失败即整组失败）/ `'soft'`（经 `warn-only` 降级，永不让组红）。
 *   `probe`    —— 软档专用：是否带 `--probe-spawn`（环境起不了子进程时点名 SKIP）。
 *   `kind`     —— 缺省 `'guard'`；`'npm'` 表示这一步是 npm 脚本（`verify:all` 的 `build`）。
 */
const step = (file, args = [], tier = 'hard', probe = false) => ({ file, args, tier, probe });
const npmStep = (script) => ({ file: null, npm: script, args: [], tier: 'hard', probe: false });

// ── 各组的步骤表。**顺序 = 执行顺序 = 旧 `&&` 链的顺序**，不得重排：
// `verify` 与 `smoke` 里有依赖前一步副作用的守卫（如 `verify-client-sync` 重建产物后
// `verify-client` 才读它），重排会改变结论。

/**
 * `npm run verify` —— 硬档（挡 PR），本组的唯一真源。
 *
 * ⚠️ 这 5 条**必须在链上**：`verify-inject-contracts` / `verify-component-face` /
 * `verify-route-ownership` / `verify-settings-namespaces` / `js-text selftest`。
 * 它们是契约类强判据（注入面 M8、内核分级面、实现归属 M10、设置分区、文本工具自检）；
 * 少了它们**不会有任何东西变红** —— 链的短路特性会让"链外的强判据"变成摆设。
 * 它们零依赖、干净检出下全部 exit 0 ⇒ 全部挂 **hard**，不需要 SKIP。
 * 链成员一变，必须重算 `test/fixtures/verify-chain.json`（`node test/verify-guard-chain.mjs --write-fixture`）
 * 并把 `test/verify-package-files.mjs` 的 `CHAIN_FLOOR` 收紧到实测值（那里有"删一步即红"的负对照）。
 */
const VERIFY_STEPS = [
  // ⓪ **行尾契约**（D-G1，2026-10-16 收口）：`.gitattributes:9` 的 `* text=auto eol=lf` 此前
  //    **零判据** —— 而它坏了不会报错，只会让下面一大批"按行锚定的字面替换"负对照**假红**
  //    （本仓真踩过：一次整轮改动被 CRLF 污染，靠人眼在 `git diff` 里找 `^M` 才发现；Windows 上
  //    `core.autocrlf=true` 会把文本文件检出成 CRLF）。它是**字节级前提**，故放链首：破了就不该
  //    继续往下跑（链的短路特性在这里是特性，不是缺陷）。判据 = `git ls-files` 全部入库文件减去
  //    `.gitattributes` 的 `binary` 白名单与含 NUL 者，逐一验零 `0x0D`；含纯函数负对照。
  step('test/verify-eol.mjs'),
  step('test/verify-client-sync.mjs'),
  step('test/verify-client.mjs'),
  // ⚠️ D3 可见面判据必须留在链上：它不在链里时，一次取上游 panel-tabs.js 就能把 D3 gate 丢掉
  // 而长期没人跑到（链的短路特性会让"链外的强判据"变成摆设）。
  // 在链上：只要 gate 落点与声明表对不上，链就在这里断。
  step('test/verify-component-visibility.mjs'),
  step('test/verify-windows-caption.mjs'),
  step('test/verify-transcode-state.mjs'),
  step('test/verify-playback-controls.mjs'),
  step('test/verify-scene.mjs'),
  step('test/verify-scene-frame-master.mjs'),
  step('test/verify-scene-live.mjs'),
  step('test/verify-scene-live-occlusion.mjs'),
  step('test/verify-scene-probe.mjs'),
  step('test/verify-occlusion-hub.mjs'),
  step('test/verify-occlusion-client.mjs'),
  step('test/verify-adapter.mjs'),
  step('test/verify-theme-follow.mjs'),
  step('test/verify-logging.mjs'),
  step('test/verify-media-bridge.mjs', ['--allow-skip'], 'soft', true),
  step('test/verify-media-probe.mjs'),
  step('test/verify-softrender.mjs'),
  step('test/verify-readability.mjs'),
  step('test/verify-glass-compositing.mjs'),
  step('test/verify-glass-surfaces.mjs'),
  step('test/verify-extra-glass.mjs'),
  step('test/verify-package-files.mjs'),
  step('test/verify-package-publish.mjs'),
  step('test/verify-contracts.mjs'),
  step('test/verify-body-caps.mjs'),
  step('test/verify-json-response.mjs'),
  step('test/verify-i18n.mjs'),
  step('test/verify-types.mjs'),
  step('test/verify-host-paint-scope.mjs'),
  step('test/verify-route-index.mjs'),
  step('test/verify-route-families.mjs'),
  step('test/verify-inject-contracts.mjs'),   // ← 还原（旧链位：route-families 之后、cache-dir 之前）
  step('test/verify-cache-dir.mjs'),
  step('test/verify-cache-prune.mjs'),
  step('test/verify-we-install-probe.mjs'),
  step('test/verify-wallpaper-scan.mjs'),
  step('test/verify-inventory-index.mjs'),
  step('test/verify-mp4-vfs.mjs'),
  step('test/verify-theme-layer.mjs'),
  step('test/verify-api-client.mjs'),
  step('test/verify-component-fonts.mjs'),
  step('test/verify-component-face.mjs'),     // ← 还原（旧链位：component-fonts 之后、fontset 之前）
  step('test/verify-fontset.mjs'),
  step('test/verify-presets.mjs'),
  step('test/verify-settings-namespaces.mjs'), // ← 还原（旧链位：presets 之后、system-fonts 之前）
  step('test/verify-system-fonts.mjs'),
  step('test/verify-picker-upload.mjs'),
  step('test/verify-picker-model.mjs'),
  step('test/verify-picker-props.mjs'),
  step('test/verify-about.mjs'),
  step('test/verify-token-contract.mjs'),
  step('test/verify-route-ownership.mjs'),    // ← 还原（旧链位：token-contract 之后、链尾附近）
  step('test/verify-config-store.mjs'),
  step('test/verify-steam-discovery.mjs'),
  step('test/verify-child-kill.mjs'),
  step('test/verify-host-diag.mjs'),
  step('test/verify-upload-store.mjs'),
  step('test/verify-video-preview.mjs'),
  step('test/verify-asset-paths.mjs'),
  step('test/verify-settings-schema-exports.mjs'),
  // BUNDLE-SPLIT 7.6 的四条新判据（P2-5b）。全部 hard：
  //   ① 启动自检：主包 apply 必须先 resolve 每个子包与其行，失败大声报错（I5 是行级静默失败）；
  //   ② 浏览器半边在场：声明 dsh.client 的子包，其行必须被主 patch 插入、产物按 id 注册且只注册一份；
  //   ③ 跨包纯度：子包只许 import 主包叶子 subpackage-boot.js + node: 内置，子包之间零 import；
  //   ④ 开关往返：对 patch 里的每一行做 关 -> 开 -> 再关（整族在场/缺席、互不相交、只动自己那一行、零残留），
  //      附真源码变异负对照（handOffTeardown -> 恒等 = 只 return dispose 必须变红）。
  // ②③④ 目前对 P-A 范围数据驱动；缺构建产物时的报错文案会提示"先跑 npm run build"。
  step('test/verify-subpackage-boot.mjs'),
  step('test/verify-subpackage-client-half.mjs'),
  step('test/verify-subpackage-purity.mjs'),
  step('test/verify-subpackage-toggle-roundtrip.mjs'),
  // ⑤ 子包包面（P2-5；2026-10-15 收口时**由软档升 hard**）：`packages/*/package.json` 的
  //    name/version/main/exports/peer 与自带 patch 行、根 `exports` 三连对账（组件行 + 独立子包行两段）。
  //    按 ADR-0004 的分档判据，它守的是**发布面 / 打包面**：版本漂离主包、peer 范围与主包不逐字相等
  //    （I6：宿主整次安装被拒 + 回滚）、`dsh.client` ⟺ `exports['./client']` 失配（C2：浏览器半边静默不加载）
  //    —— 每一条都是"用户会撞上"的后果，不是仓库内务 ⇒ 硬档。判据面与档位依据见 adr/0014 S3。
  step('test/verify-subpackage-manifests.mjs'),
  // ⑦ 主包 apply() 的**交接位置**（R-1 的真实形态；P2-6 gate-r1）：出货宿主的 `register` 判重在
  //    插入**之前** ⇒ 文档点名的"40 处单表达式兜底"没有可失败的中间态（那 20 个文件安全、零改动）；
  //    真缺陷是 `handOffTeardown(ctx, dispose)` 原本排在 `apply()` 最后一行 —— 中途抛错（最现实：
  //    上次装载残留撞 `duplicate … route`）那一行永不执行 ⇒ `ctx.effect` 从未登记 ⇒ fiber 不回滚、
  //    前序各族已注册路由全部残留。判据 = 源码序 + 行为（真 lib/index.js × 正序 mock 宿主，
  //    残留 31 → 0、注册面 32 条两臂同序逐字节相等），另有 6 条负对照（NC1–NC5 带牙 + 1 条前提②负对照）
  //    与 4 条覆盖面地板。
  //    真 cordis 往返仍未跑（`@deepseek-ai/cordis` 是 peer，本轮口径 `npm ci --omit=peer`）⇒
  //    fiber 回滚语义是**源码推读**，守卫只在文件头如实标注，不升级为"已验证"。
  step('test/verify-host-teardown.mjs'),
  // 可选桌宠联动的离线回归；安装和浏览器集成另走显式环境入口。
  step('test/verify-pet-package.mjs'),
  step('test/verify-pet-hotplug-host.mjs'),
  step('test/verify-pet-hotplug-client.mjs'),
  step('test/verify-pet-rope-entry.mjs'),
  step('test/verify-pet-tuner.mjs'),
  step('test/verify-pet-bubble-timing.mjs'),
  step('test/verify-pet-mascot-motion.mjs'),
  step('test/verify-pet-egg1-motion.mjs'),
  step('test/verify-pet-egg1-rebound.mjs'),
  step('test/verify-pet-sidebar-rebound.mjs'),
  step('test/verify-pet-egg2-motion.mjs'),
  step('test/verify-pet-follow.mjs'),
  // ⑥ 包发现层 `test/tools/packages.mjs` 的**自检**（P-B 基石）：上面这一批"包面"判据
  //    （client-sync 的产物集合 / bundle-rows 的行⇄包对账 / subpackage-manifests 的清单面 /
  //    host-route-index 一族的行·包解析）与 `scripts/build-client.mjs` 都读它 ⇒ 它自己坏了会
  //    连带整批判据失真（与下面 js-text 同理，属"判据底座的底座"）。11 条负对照全部经同一个
  //    `enumerateViolations`，另有 `FLOORS` 地板防"包 / 产物 / 行数静默缩水"。
  step('test/tools/packages.mjs', ['selftest']),
  // ← 还原（旧链最末一步）：`js-text` 的**自检**（字符串感知的剥注释/作用域/函数体提取，
  // 是上面一批"文本判据"的共同底座 ⇒ 它自己坏了会连带整批判据失真）。
  step('test/tools/js-text.mjs', ['selftest']),
  // ⑧ 链的**形状自检**（R-4 收口：由 docs 软档升 hard）。它把 MANIFEST 与
  //    `test/fixtures/verify-chain.json` 逐条对账（顺序 / 档位 / 参数 / 文件名），另判每组硬档地板、
  //    每个 file 真实存在、`all` = build + 三组有序拼接，以及 ⑤「守卫面上脱链者必须有代码内理由」。
  //    原先它挂在 docs 组，而 CI 的 `verify:docs` 步是 `continue-on-error: true` ⇒ 把链上头两步
  //    交换一下，**硬档可以全绿**、只有软档出声。"链的形状"是发布面（静默掉一条守卫 = 一条硬档
  //    判据无声脱离 PR 门禁）⇒ 按 ADR-0004 归硬档，放本组末尾（它是全组的自检，读的是 MANIFEST
  //    而非某一步的产物；`--list-json` 只打印不执行，不会递归）。
  step('test/verify-guard-chain.mjs'),
  // ⑨ CI 步骤表自检（R-7，task-11 交付）：`test/tools/ci-workflow.mjs` 的行扫描 + 判据（序列 / 脚本
  //    存在性 / `continue-on-error` 只在 verify:docs / 产物出库与无尾随空白两步真的在跑 / install 在
  //    第一条 npm run 之前），正判据与 10 条负对照共用一个纯函数（变异喂内存文本，不碰真 workflow）。
  //    与 ⑧ 同理归硬档：删掉 `verify:static` 或 `verify:bridge` 这类改动只有它能拦。
  step('test/verify-ci-steps.mjs'),
];

/** `npm run verify:docs` —— 软档（只出声）。全部经 warn-only 降级。 */
const DOCS_STEPS = [
  step('test/verify-module-layout.mjs', [], 'soft'),
  step('test/verify-reachability.mjs', [], 'soft'),
  step('test/verify-retired-lines.mjs', [], 'soft'),
  step('test/verify-dead-declarations.mjs', [], 'soft'),
  // 未定义引用普查（"用了但没 import/声明"）：先按软档出声若干轮，再有据可依地议升 hard
  // （这一类；`node --check` 与聚焦判据都照不到它）。
  step('test/verify-undefined-refs.mjs', [], 'soft'),
  step('test/verify-guard-map.mjs', [], 'soft'),
];

/** `npm run smoke` —— 节点级行为冒烟（硬档）。 */
const SMOKE_STEPS = [
  step('test/rotation-smoke.mjs'),
  step('test/rotation-live-smoke.mjs'),
  step('test/rotation-prepared-leak-smoke.mjs'),
  step('test/live-frame-backfill-smoke.mjs'),
  step('test/live-frame-async-identity-smoke.mjs'),
  step('test/fontset-load-smoke.mjs'),
];

/**
 * 四组的清单（**唯一真源**）。
 *
 * `verify:all` 是纯组合（旧串 = `npm run build && npm run verify && npm run verify:docs && npm run smoke`）：
 * 直接**引用同一批步骤对象**（不复制 —— 复制会让"改一处、漏一处"重新变成可能）。
 * `build` 留在 npm 侧（`package.json` 的 `build` 键是本步的真源，P5 的 build 地板仍从那里取），
 * 且**必须不经过** `verify` 组，否则跑 `all` 之外的组时会被意外触发产物重写。
 */
const MANIFEST = {
  verify: { chainKey: 'verify', steps: VERIFY_STEPS },
  docs: { chainKey: 'verify:docs', steps: DOCS_STEPS },
  smoke: { chainKey: 'smoke', steps: SMOKE_STEPS },
  all: { chainKey: 'verify:all', steps: [npmStep('build'), ...VERIFY_STEPS, ...DOCS_STEPS, ...SMOKE_STEPS] },
};

/** 把一条步骤渲染成旧链里的等价命令串（`--list` 用）。 */
function commandOf(s) {
  if (s.npm) return 'npm run ' + s.npm;
  const guard = ['node', s.file, ...s.args].join(' ');
  if (s.tier !== 'soft') return guard;
  return ['node', 'test/warn-only.mjs', ...(s.probe ? ['--probe-spawn'] : []), s.file, ...s.args].join(' ');
}

/** 组名 → 步骤数组。未知组返回 null（调用方负责报错与退出码 2）。 */
function stepsOf(group) {
  const entry = MANIFEST[group];
  return entry ? entry.steps : null;
}

/** 组名 → `package.json` 的脚本键（`chainKey`）。 */
function chainKeyOf(group) {
  const entry = MANIFEST[group];
  return entry ? entry.chainKey : null;
}

/** `--list-json` 的载荷：有序步骤表，P5 与外部判据据此取"链上到底跑哪些文件"。 */
function listJson(group) {
  return {
    group,
    chainKey: chainKeyOf(group),
    steps: stepsOf(group).map((s, i) => ({
      index: i + 1,
      kind: s.npm ? 'npm' : 'guard',
      npm: s.npm || null,
      file: s.file,
      args: s.args,
      tier: s.tier,
      probe: s.probe,
      command: commandOf(s),
    })),
  };
}

/** 执行一步：硬档直接起守卫，软档经 `warn-only.mjs` 起守卫。返回子进程 status（null = 没起来）。 */
function runStep(s) {
  // ⚠️ 软档必须传**仓库根相对路径**，不能传绝对路径：`test/warn-only.mjs` 自己按
  // `join(ROOT, target)` 解析目标（它的契约就是"收相对路径"），给绝对路径会被它拼成
  // `<ROOT>/<绝对路径>` ⇒ 前置缺失，全组以合成码 2 退出（实测踩过）。硬档那侧直接执行，
  // 传绝对路径无所谓。
  if (s.npm) {
    // npm 步骤的姿势见 `npmLaunch()`：直接 spawn `'npm'` 在 Windows 上必然 ENOENT/EINVAL。
    const l = npmLaunch(['run', s.npm]);
    const r = spawnSync(l.exe, l.argv, { cwd: ROOT, stdio: 'inherit', shell: l.shell });
    return r.status;
  }
  const argv = s.tier === 'soft'
    ? [join(ROOT, 'test', 'warn-only.mjs'), ...(s.probe ? ['--probe-spawn'] : []), s.file, ...s.args]
    : [join(ROOT, s.file), ...s.args];
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' });
  return r.status;
}

const USAGE = '用法：node ' + HERE + ' [verify|docs|smoke|all] [--list|--list-json]';
const GROUPS = Object.keys(MANIFEST);

const rawArgs = process.argv.slice(2);
const wantList = rawArgs.includes('--list');
const wantJson = rawArgs.includes('--list-json');
const positional = rawArgs.filter((a) => !a.startsWith('--'));
const unknownFlags = rawArgs.filter((a) => a.startsWith('--') && a !== '--list' && a !== '--list-json');

if (unknownFlags.length) {
  console.error('✗ 未知参数：' + unknownFlags.join(' ') + '\n' + USAGE);
  process.exit(2);
}
if (positional.length > 1) {
  console.error('✗ 只接受一个组名，收到：' + positional.join(' ') + '\n' + USAGE);
  process.exit(2);
}
const group = positional[0] || 'verify';
const steps = stepsOf(group);
if (!steps) {
  console.error('✗ 未知组：' + group + '（可选：' + GROUPS.join(' / ') + '）\n' + USAGE);
  process.exit(2);
}

// ── 只读模式：打印清单，不执行 ────────────────────────────────────────────────
if (wantJson) {
  console.log(JSON.stringify(listJson(group), null, 2));
  process.exit(0);
}
if (wantList) {
  for (const s of steps) console.log(commandOf(s));
  process.exit(0);
}

// ── 执行模式 ──────────────────────────────────────────────────────────────────
// 清单完整性先自检：清单漂成死路径时**当场**报出来，而不是等 npm 报一个难读的
// "Cannot find module"（这条与 P5 的"清单里每个 file 真实存在"同源，但本处是运行期兜底）。
const deadFiles = steps.filter((s) => s.file && !existsSync(join(ROOT, s.file)));
if (deadFiles.length) {
  console.error('✗ 清单里有 ' + deadFiles.length + ' 条指向不存在的文件（清单漂了）：');
  for (const s of deadFiles) console.error('    ' + s.file);
  process.exit(2);
}

console.log('▶ ' + group + ' —— ' + steps.length + ' 步（硬档 '
  + steps.filter((s) => s.tier !== 'soft').length + ' / 软档 '
  + steps.filter((s) => s.tier === 'soft').length + '）');

for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  console.log('\n── [' + (i + 1) + '/' + steps.length + '] ' + commandOf(s));
  const status = runStep(s);
  if (status === null) {
    // 与 `package.json` 的 `&&` 链同形：子进程起不来时 `&&` 链终止且 npm 以非 0 退出。
    console.error('✗ [' + (i + 1) + '/' + steps.length + '] 没能起来：' + commandOf(s));
    process.exit(1);
  }
  if (status !== 0 && s.tier !== 'soft') {
    // 短路语义：与 `&&` 一致 —— 后续步骤不再执行，退出码与原命令一致。
    console.error('✗ [' + (i + 1) + '/' + steps.length + '] 退出码 = ' + status + ' ⇒ 链在此短路');
    process.exit(status);
  }
  if (status !== 0) {
    console.log('⚠ [' + (i + 1) + '/' + steps.length + '] 软档守卫原退出码 = ' + status
      + '（已由 warn-only 降级，不决定本组红绿）');
  }
}

console.log('\n✓ ' + group + ' 全部 ' + steps.length + ' 步执行完毕');
process.exit(0);
