/**
 * install-release.mjs —— 用**发布集目录**（GitHub Release 的九件套）在指定 profile 上做一次可验证的安装。
 *
 * ## 为什么需要它
 *
 * 发布形态的主包把全部子包声明成**精确版本运行依赖**（`scripts/pack-release.mjs`），pnpm 会拿这些
 * 版本去 registry 解析 —— 实测（pnpm 11.22.0，隔离 profile）只装主包 tarball 必然失败：
 *
 *   ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/dsh-plugin-wallpaper-engine-media-bridge
 *   This error happened while installing the dependencies of dsh-plugin-wallpaper-engine@1.3.3
 *
 * 因此"只挂主包 tgz 的 Release"对用户是一个**装不上的包**。把整套 tarball 一起挂上去也不够：顶层
 * `file:` 依赖**不能满足**传递依赖的 registry 版本范围（同样实测 404）。唯一能让"离线九件套"装上的
 * 机制是 profile 的 `overrides:` 把每个子包名钉到同目录的 tarball —— DSH 自己的兼容性实跑
 * （`test/compat-harness-live.mjs`）走的就是这条路，`test/verify-deployment.mjs` 之外另有一份
 * 端到端探针（见 `CONTRIBUTING.md`「发布流程（维护者）」 §证据）。
 *
 * 本脚本把这套动作固化成一条命令，并在装完后**逐个 require.resolve** 自证：整套包都在、声明
 * `dsh.client` 的包连 `./client` 入口都在。它不发布、不改版本，只读发布集目录。
 *
 * ## 边界
 *
 *   · 只动 `--profile` 指名的那个 profile；`package.json` 与 `pnpm-workspace.yaml` 先做带时间戳的备份。
 *   · profile 里**已有** `overrides:` 时拒绝执行：不同来源的 override 交集无法自动合并，报错里给出
 *     要手工贴进去的行。
 *   · 与 `scripts/install-source.mjs` 的分工：那一条用于源码检出（八个 `link:` 依赖），这一条用于
 *     **发布集**（一个 `file:` 主包 + 八个 overrides）；两者都只保留主包 bundle 选择。
 *
 * Usage:
 *   node scripts/install-release.mjs --set <release-set dir> --profile web --dsh-home <dir> --app-closed
 *   node scripts/install-release.mjs --set <dir> --profile web --dsh-home <dir> --dry-run
 */

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, assertNodeVersion, resolveDshCli, runTool } from './deploy-tools.mjs';
import { retainMainBundle } from './install-source.mjs';

/** DSH 自己给每个 profile 写的 workspace 默认值；缺什么补什么，不覆盖已有键。 */
const WORKSPACE_DEFAULTS = ['packages:\n  - .', 'nodeLinker: hoisted', 'autoInstallPeers: false'];

export function releasePlan(options) {
  assertNodeVersion();
  if (!options.home) throw new Error('Specify --dsh-home <directory> explicitly.');
  if (!/^[a-z0-9_-]+$/i.test(options.profile || '')) throw new Error('Specify --profile <name> explicitly.');
  if (!options.set) throw new Error('Specify --set <release-set directory> explicitly.');
  const set = resolve(options.set);
  const indexPath = join(set, 'release-set.json');
  if (!existsSync(indexPath)) throw new Error('Not a release set (missing release-set.json): ' + set);
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const packages = Array.isArray(index.packages) ? index.packages : [];
  if (packages.length < 2) throw new Error('A release set needs the main package plus its subpackages.');
  const seen = new Set();
  for (const pkg of packages) {
    if (!pkg || typeof pkg.name !== 'string' || typeof pkg.version !== 'string' || typeof pkg.file !== 'string') {
      throw new Error('Malformed release-set.json entry: ' + JSON.stringify(pkg));
    }
    if (seen.has(pkg.name)) throw new Error('Duplicate package in release set: ' + pkg.name);
    seen.add(pkg.name);
    if (pkg.file !== pkg.file.replace(/[\\/]/g, '')) throw new Error('Release set entry must be a bare filename: ' + pkg.file);
    if (!existsSync(join(set, pkg.file))) throw new Error('Missing tarball listed by release-set.json: ' + pkg.file);
  }
  const main = packages[packages.length - 1];
  const children = packages.slice(0, -1);
  for (const child of children) {
    if (!child.name.startsWith(main.name + '-')) {
      throw new Error('Release set order is wrong: ' + child.name + ' is not a subpackage of ' + main.name
        + ' (publishOrder must end with the main package).');
    }
  }
  if (Array.isArray(index.publishOrder)
    && index.publishOrder.join('\n') !== packages.map((pkg) => pkg.file).join('\n')) {
    throw new Error('release-set.json publishOrder disagrees with packages order.');
  }
  const profileDir = join(resolve(options.home), 'profiles', options.profile);
  if (!existsSync(profileDir)) throw new Error('No such DSH profile: ' + profileDir);
  return { set, home: resolve(options.home), profileDir, main, children,
    mainTarball: join(set, main.file), index };
}

/** `overrides:` 的 YAML 片段：子包名 → 同目录 tarball 的绝对路径（正斜杠，YAML 里不需要引号转义）。 */
export function overrideLines(plan) {
  return plan.children.map((child) => '  ' + child.name + ": 'file:" + join(plan.set, child.file).replaceAll('\\', '/') + "'");
}

/**
 * 把 overrides 写进 profile 的 `pnpm-workspace.yaml`。
 *
 * 为什么不直接写整个文件：DSH 的 build-approval 会把 `allowBuilds` 决策写回同一份文件，用户也可能
 * 手工加过键。这里只追加缺失的默认键与 overrides 段；已有 `overrides:` 一律拒绝（交集不可自动合并）。
 */
export function writeWorkspaceOverrides(plan, exists = existsSync, read = readFileSync, write = writeFileSync) {
  const path = join(plan.profileDir, 'pnpm-workspace.yaml');
  const current = exists(path) ? read(path, 'utf8') : '';
  if (/^overrides:/m.test(current)) {
    throw new Error('Profile already declares `overrides:` in pnpm-workspace.yaml; merge these entries by hand:\n'
      + overrideLines(plan).join('\n'));
  }
  const parts = [];
  let text = current;
  if (!text) {
    text = WORKSPACE_DEFAULTS[0] + '\n';
    parts.push(WORKSPACE_DEFAULTS[0].split('\n')[0]);
  }
  for (const line of WORKSPACE_DEFAULTS.slice(1)) {
    const key = line.split(':')[0];
    if (new RegExp('^' + key + ':', 'm').test(text)) continue;
    text += line + '\n';
    parts.push(line);
  }
  text = text.replace(/\n*$/, '\n') + 'overrides:\n' + overrideLines(plan).join('\n') + '\n';
  write(path, text);
  return { path, added: parts };
}

export function installRelease(options, run = runTool) {
  const plan = releasePlan(options);
  if (options.dryRun) return { plan, overrides: overrideLines(plan) };
  if (!options.appClosed) throw new Error('Completely close the target DSH application, then pass --app-closed.');
  const env = { DSH_HOME: plan.home, DSH_PROFILE: options.profile, DSH_PROFILE_DIR: plan.profileDir };
  const manifestPath = join(plan.profileDir, 'package.json');
  const workspacePath = join(plan.profileDir, 'pnpm-workspace.yaml');
  const stamp = Date.now();
  for (const file of [manifestPath, workspacePath]) {
    if (existsSync(file)) copyFileSync(file, file + '.wallpaper-backup-' + stamp);
  }
  writeWorkspaceOverrides(plan);
  const args = ['plugin', '--profile', options.profile, 'add', plan.mainTarball];
  const cli = resolveDshCli(options.cli);
  run(cli ? process.execPath : 'dsh', cli ? [cli, ...args] : args, { cwd: ROOT, env });
  // 子包是持久依赖，但只有主包 patch 拥有整族行；把子包 bundle 选择摘掉，免得行重复。
  const manifest = retainMainBundle(JSON.parse(readFileSync(manifestPath, 'utf8')), plan);
  const temp = manifestPath + '.wallpaper-tmp';
  writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  renameSync(temp, manifestPath);
  const hostRequire = createRequire(join(plan.profileDir, 'cordis.yml'));
  for (const pkg of [plan.main, ...plan.children]) {
    if (!manifest.dependencies?.[pkg.name]) throw new Error('Missing persistent dependency after install: ' + pkg.name);
    hostRequire.resolve(pkg.name);
    const installed = JSON.parse(readFileSync(hostRequire.resolve(pkg.name + '/package.json'), 'utf8'));
    if (installed.dsh?.client) hostRequire.resolve(pkg.name + '/client');
    if (installed.version !== pkg.version) {
      throw new Error('Installed version mismatch for ' + pkg.name + ': ' + installed.version + ' != ' + pkg.version);
    }
  }
  console.log('Release-set deployment verified: ' + plan.main.name + ' + ' + plan.children.length
    + ' subpackages from ' + plan.set + '. Restart the target DSH host.');
  return { plan, overrides: overrideLines(plan) };
}

function main(args) {
  const values = new Map();
  const flags = new Set(['--app-closed', '--dry-run']);
  const names = new Set(['--profile', '--dsh-home', '--dsh-cli', '--set']);
  for (let i = 0; i < args.length; i++) {
    if (flags.has(args[i])) values.set(args[i], true);
    else if (names.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) values.set(args[i], args[++i]);
    else throw new Error('Unknown or incomplete argument: ' + args[i]);
  }
  const result = installRelease({ set: values.get('--set'), profile: values.get('--profile'),
    home: values.get('--dsh-home'), cli: values.get('--dsh-cli'),
    appClosed: values.has('--app-closed'), dryRun: values.has('--dry-run') });
  if (values.has('--dry-run')) {
    console.log(JSON.stringify({ profileDir: result.plan.profileDir, mainTarball: result.plan.mainTarball,
      overrides: result.overrides }, null, 2));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
