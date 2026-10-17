#!/usr/bin/env node
/**
 * dev-link-subpackages.mjs —— 开发期把 `packages/<pkg>/` 接进 profile 的 `node_modules`。
 *
 * 为什么需要（docs/wip/BUNDLE-SPLIT.md §8.1 的 spike 结论）：
 *   本版 DSH 的 `boot()` 调用点只传 4 个实参 ⇒ `bareModuleBaseUrl` 恒 `undefined` ⇒
 *   loader 恒走 `Include` 分支 ⇒ **行名一律从 `<profile>/cordis.yml` 旁起算**：
 *   裸包名 → `<profile>/node_modules/<name>`（与 `./…` 相对名同底）。
 *   而开发期 profile 是按 `link:D:/dsh-wallpaper-engine` 装的，`link:` **不会**把被 link 包的
 *   `dependencies` 装进 profile（实测 `<profile>/node_modules/.package-map.json` 里那条的
 *   `dependencies` 是空表）⇒ **子包永远不会自己出现在 profile 的 node_modules 里**。
 *   ⇒ 发布期（用户装主包、子包作为传递依赖被 hoist 到 profile 顶层）成立，
 *     开发期必须在 profile 的 `node_modules` 里放一个**指向本仓 `packages/<pkg>/` 的目录 junction**。
 *
 * 为什么用 junction（而不是改行名）：
 *   目录 junction 让 `<profile>/node_modules/dsh-plugin-wallpaper-engine-<pkg>` 与发布后 npm/pnpm
 *   hoist 出来的布局**同形** ⇒ **同一份 `cordis.patch.yml`（裸真名）开发期与发布期都成立**，
 *   不需要"开发期行名 ↔ 发布期行名"两套（§8.1 里那条"开发期写相对行名"的备选口径已作废：
 *   `./packages/<pkg>/lib/index.js` 会落到不存在的 `<profile>/packages/…`）。
 *
 * 已知代价（照付）：junction **不在** profile 的 `.modules.yaml` / `.package-map.json` 里
 *   ⇒ profile 侧每次 `pnpm install`（它会重写 node_modules）之后要**重跑本脚本**。
 *   幂等且可重跑，就是为这件事准备的。
 *
 * Usage:
 *   node scripts/dev-link-subpackages.mjs                 # 给所有 profile 建/修复 junction
 *   node scripts/dev-link-subpackages.mjs --dry-run       # 只打印要做什么
 *   node scripts/dev-link-subpackages.mjs --profile web   # 只处理一个 profile
 *   node scripts/dev-link-subpackages.mjs --force         # 覆盖"占位但指错地方"的链接
 *   node scripts/dev-link-subpackages.mjs --json          # 机器可读输出
 *   node scripts/dev-link-subpackages.mjs --no-repo-links  # 只处理 profile（不建本仓 node_modules 链接）
 *   node scripts/dev-link-subpackages.mjs --no-profiles    # 只建本仓 node_modules 链接
 *
 * 两个链接点：
 *   ① 本仓 `node_modules/<子包名>` —— **主包自己**启动自检时 resolve 的落脚处（开发期子包未发布
 *      ⇒ 不建这条主包 apply 会抛）；
 *   ② 各 profile 的 node_modules（宿主解析 patch 行名）。
 *
 * 已删除的第三个链接点（2026-10-15）：本仓 `node_modules/<主包名>` → 本仓根（主包**自链接**）。
 *   它唯一服务的是子包宿主入口里 `import … from 'dsh-plugin-wallpaper-engine/subpackage-boot.js'`
 *   这条裸说明符；跨包通道改走 **① Cordis Service**（BUNDLE-SPLIT §5.1）后，子包宿主半边
 *   **零主包说明符**（`test/verify-subpackage-purity.mjs` 的 `ROOT_SPEC_ALLOW` 已收紧为零）
 *   ⇒ 那条 `node_modules` 边不存在了，`rootSelfLink()` 与 `--no-self-link` 一并删除。
 *
 * 判定与安全：
 *   · 已经是**指向正确目标**的 junction / 符号链接 ⇒ 跳过（幂等）；
 *   · 同名条目存在但指向别处、或是一个**真目录**（可能是用户自己装的包）⇒ **默认不动**，
 *     报 conflict 并提示用 --force；--force 只替换**链接**，真目录永不删除（那是用户的数据）；
 *   · 仓库里没有子包清单 ⇒ 打印一行 no subpackages 并 exit 0。
 */

import {
  existsSync, lstatSync, statSync, readdirSync, readFileSync, mkdirSync, symlinkSync,
  unlinkSync, rmdirSync, realpathSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 收集本仓的开发子包：`packages/<dir>/package.json` 的 `name` 就是行名（= junction 名）。 */
export function collectSubpackages(repoRoot) {
  const dir = join(repoRoot, 'packages');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const manifest = join(dir, entry.name, 'package.json');
    if (!existsSync(manifest)) continue;
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      out.push({ dir: entry.name, name: pkg.name || null, manifest, target: join(dir, entry.name) });
    } catch (err) {
      out.push({ dir: entry.name, name: null, manifest, error: String((err && err.message) || err) });
    }
  }
  return out;
}

/** profile 根：`$DSH_HOME` 或 `$USERPROFILE/.dsh`。 */
export function dshHome(env = process.env) {
  return env.DSH_HOME || join(env.USERPROFILE || env.HOME || '', '.dsh');
}

/** 枚举 `<dshHome>/profiles/*`（只挑**有 package.json** 的目录：那才是一个装过东西的 profile）。 */
export function listProfiles(home) {
  const dir = join(home, 'profiles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'package.json')))
    .map((e) => ({ name: e.name, dir: join(dir, e.name), modules: join(dir, e.name, 'node_modules') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 路径同一性：Windows 大小写不敏感、分隔符两种写法都要算同一条路径。 */
function samePath(a, b) {
  const norm = (p) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** 不抛的 native realpath（它才认 Windows junction；普通 realpath 会把 junction 原样返回）。 */
function nativeReal(p) {
  try {
    return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * 一个链接条目的现状（不跟随最后一级：我们要的就是"它自己是什么"）。
 *
 * ⚠️ Windows 的**目录 junction 在 Node 眼里不是 symlink**：libuv 只给
 * `IO_REPARSE_TAG_SYMLINK` 打 `S_IFLNK`，而 junction 是 `IO_REPARSE_TAG_MOUNT_POINT`
 * ⇒ `lstatSync().isSymbolicLink() === false`、`isDirectory() === true`、`readlinkSync()` 报
 * `EINVAL`。所以这里**不能**靠 lstat/readlink 判定，改用两条实证口径：
 *   ① 与目标取 `statSync` 的 `dev` + `ino`（同一个文件对象 ⇒ 同一个东西，跨平台稳）；
 *   ② `realpathSync.native()`（GetFinalPathNameByHandle，**会**穿透 junction）。
 * 返回值：missing / ok / wrong（真 symlink 指别处）/ junction-elsewhere / realdir / other / dangling。
 */
export function linkState(linkPath, target) {
  let lst;
  try {
    lst = lstatSync(linkPath);
  } catch {
    return 'missing';
  }
  if (!lst.isSymbolicLink()) {
    if (!lst.isDirectory()) return 'other';
    let st;
    try {
      st = statSync(linkPath);
    } catch {
      return 'dangling';
    }
    try {
      const t = statSync(target);
      if (t.dev === st.dev && t.ino === st.ino) return 'ok';
    } catch { /* 目标不在盘上：交给下面的 realpath 判 dangling / 指别处 */ }
    const real = nativeReal(linkPath);
    if (real === null) return 'dangling';
    if (samePath(real, linkPath)) return 'realdir';
    return samePath(real, target) ? 'ok' : 'junction-elsewhere';
  }
  const real = nativeReal(linkPath);
  if (real === null) return 'dangling';
  return samePath(real, target) ? 'ok' : 'wrong';
}

function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
  };
  const json = has('--json');
  const dryRun = has('--dry-run');
  const force = has('--force');
  const repoRoot = resolve(val('--repo', join(HERE, '..')));
  const home = resolve(val('--dsh-home', dshHome()));
  const only = val('--profile', null);
  const log = (...a) => { if (!json) console.log(...a); };

  const subs = collectSubpackages(repoRoot);
  if (!subs.length) {
    log('dev-link: no subpackages (packages/<pkg>/package.json) — nothing to do');
    if (json) console.log(JSON.stringify({ repoRoot, home, profiles: [], subpackages: [], actions: [] }, null, 2));
    return 0;
  }
  for (const s of subs) {
    if (!s.name) log('dev-link: ✗ packages/' + s.dir + ' 的清单读不出 name — 跳过' + (s.error ? '（' + s.error + '）' : ''));
  }

  // 链接点有两处，缺一不可：
  //   ① 本仓 node_modules —— **主包自己**在启动自检里 resolve 子包名时走的那条路
  //      （lib/index.js 的 apply 用 createRequire(import.meta.url)）。开发期三个子包还没发布，
  //      不建这条链接，主包一 apply 就直接抛"子包行解析不到"；
  //   ② 每个 profile 的 node_modules —— **宿主**按裸包名解析 patch 行时的落脚处（§8.1 spike 第 1 条）。
  const sites = [];
  if (!has('--no-repo-links')) {
    sites.push({ name: '(repo)', modules: join(repoRoot, 'node_modules'), label: '(repo)', entries: subs });
  }
  let profiles = listProfiles(home);
  if (only) profiles = profiles.filter((p) => p.name === only);
  if (!has('--no-profiles')) for (const p of profiles) sites.push({ name: p.name, modules: p.modules, label: p.name, entries: subs });
  const actions = [];
  for (const site of sites) {
    let modulesReady = false;
    for (const s of site.entries) {
      if (!s.name) continue;
      const link = join(site.modules, s.name);
      const state = linkState(link, s.target);
      if (state === 'ok') { actions.push({ profile: site.name, name: s.name, state, action: 'skip' }); continue; }
      if (state === 'realdir' || state === 'other') {
        actions.push({ profile: site.name, name: s.name, state, action: 'conflict-untouched' });
        continue;
      }
      if ((state === 'wrong' || state === 'junction-elsewhere' || state === 'dangling') && !force) {
        actions.push({ profile: site.name, name: s.name, state, action: 'conflict-needs-force' });
        continue;
      }
      if (dryRun) { actions.push({ profile: site.name, name: s.name, state, action: state === 'missing' ? 'link' : 'relink' }); continue; }
      if (state !== 'missing') {
        // junction（mount point）要用 rmdir 摘：unlink 在 Windows 上对目录报 EPERM，
        // 而 rmdir 只摘链接本身、**不动**目标目录里的内容。
        if (state === 'wrong') unlinkSync(link); else rmdirSync(link);
      }
      if (!modulesReady) { mkdirSync(site.modules, { recursive: true }); modulesReady = true; }
      symlinkSync(s.target, link, process.platform === 'win32' ? 'junction' : 'dir');
      actions.push({ profile: site.name, name: s.name, state, action: state === 'missing' ? 'link' : 'relink' });
    }
  }
  for (const a of actions) {
    if (a.action === 'skip') continue;
    const line = 'dev-link: ' + a.profile + ' → ' + a.name + ' : ' + a.action;
    if (a.action.startsWith('conflict')) log(line + '（默认不动；确认它只是个过时链接再用 --force）');
    else log(line);
  }
  const made = actions.filter((a) => a.action === 'link' || a.action === 'relink').length;
  const conflicts = actions.filter((a) => a.action.startsWith('conflict')).length;
  log('dev-link: ' + subs.length + ' 个子包 × (' + (has('--no-repo-links') ? 0 : 1) + ' 个仓库 node_modules + '
    + (has('--no-profiles') ? 0 : profiles.length) + ' 个 profile)；'
    + (dryRun ? '计划落盘 ' : '本次落盘 ') + made + ' 条'
    + (conflicts ? '，' + conflicts + ' 条冲突未动' : '')
    + (dryRun ? '（--dry-run，未落盘）' : ''));
  if (json) console.log(JSON.stringify({ repoRoot, home, subpackages: subs.map((s) => ({ dir: s.dir, name: s.name })), actions }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
