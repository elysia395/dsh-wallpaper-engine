/**
 * prepare.mjs — npm `prepack` 钩子（打包 / 发布前构建客户端）。
 *
 * 挂 `prepack` 而不是 `prepare` 是 issue #141 的直接修法：`prepare` 会在**安装期**跑
 * （git 直装 / 解包当根项目 `pnpm install`），而 pnpm 11 对 git 依赖的构建脚本有
 * allowBuilds 安全闸 —— 插件市场默认走 `git+https://…` 直装，于是每个用户都被
 * `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 拒装。改成 `prepack` 后：发布仍是"先构建再打包"，
 * 而安装期一个脚本都不跑 —— 装出来的包直接用随包发布的 `lib/client.js`
 *（它由 CI 的 build 幂等与 client-sync 守卫看着，见 test/verify-package-publish.mjs ⑦）。
 *
 * Runs the client build when the source is present (a dev checkout / publishing
 * workstation), and is a silent no-op otherwise (a published tarball, where `src/` is
 * excluded from `files` and `lib/client.js` is pre-built).
 *
 * **只挂主包，不给子包各挂一份 `prepack`（BUNDLE-SPLIT §7.2 的决定）**：子包的浏览器半边
 * （`packages/<pkg>/lib/client.<pkg>.js`）由**同一个**构建器在根 `pack` 时一并产出，产物随
 * 子包自己的 `files[]` 发布 —— 再给子包挂一次只是同一份字节的第二次构建。而且子包挂
 * `prepack` 会把 `scripts/` 拖进子包发布面（要么把 scripts/ 加进 files[]，要么让子包钩子指向
 * 仓外不存在的路径），并让每个子包的安装/发布多一个入口；这是纯负担，不是幂等性收益。
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hasSource = existsSync(resolve(root, 'src', 'client.js')) &&
  existsSync(resolve(root, 'scripts', 'build-client.mjs'));

if (hasSource) {
  const r = spawnSync(process.execPath, [resolve(root, 'scripts', 'build-client.mjs')], {
    cwd: root, stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}
// 同样的理由（见 build-client.mjs 末尾）：这条信息会被带进 `npm pack` / `npm publish` 的 stdout，
// 而 `--json` 要求那里只有 JSON。
console.error('prepare: no client source present (published package) — skipped build');
