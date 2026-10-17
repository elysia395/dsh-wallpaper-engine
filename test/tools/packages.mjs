/**
 * 包发现层（BUNDLE-SPLIT §10.2 顺序纪律第 1 条 / P-B 基石）。
 *
 * 本仓从「一个包」拆成「主包 + 3 个 subpath 组件包 + 3 个 standalone 子包」后，
 * "有哪些包、每包的清单 / patch / 浏览器半边产物 / 主 patch 行"这几张脸散落在 build 与
 * 各守卫里各写一遍，已经开始互相漂移。这里把它们收敛成**一份数据模型**：
 *
 *   · 真源 = 磁盘（`lib/components/*`、`packages/*`）+ 根 `package.json` + 根 `cordis.patch.yml`；
 *   · **不写死任何包名 / 子目录名** —— 新增一个包只改磁盘，不改本文件；
 *   · 零裸包依赖（`test/verify-package-files.mjs` P5：构建 / 校验链上不许 import 裸包，
 *     CI 只装运行期依赖）⇒ 只用 `node:` 内置模块与相对路径，手写 patch 扫描（链上不引 js-yaml）。
 *
 * ── 冻结接口（Lead 定，build / 守卫两个消费者按此写的任务，不得改名 / 改形）─────────────
 *   export const ROOT                       仓库根绝对路径。
 *   export function parseRows(patchText)    → [{ id, name }]，按文件顺序。
 *   export function discoverPackages(root=ROOT) → 模型（见下）。
 *   export function enumerateViolations(model, io) → string[]（**纯函数**，io 注入）。
 *   export const FLOORS = { packages: 6, clientArtifacts: 4, rows: 7 }
 *   CLI: `node test/tools/packages.mjs selftest`（退出码 0/1，逐条打印 ✓/✗）、
 *        可选 `--json`（打印模型）、无参（打印摘要，有违规则退出码 1）。
 *
 * ── 路径口径（消费必读）──────────────────────────────────────────────────────
 *   模型里**所有路径都是仓库根相对的 POSIX 字符串**（`/` 分隔，不含盘符、不开头 `./`），
 *   所以 `path.resolve(model.root, p)` 一定解析得到绝对路径（Windows 上同样成立）。
 *   主包的 `dir` 是 `'.'`（join 时视为空段）。`main.clientArtifact` 冻结为 `'lib/client.js'`。
 *
 * ── 模型形状 ─────────────────────────────────────────────────────────────────
 *   { root,
 *     main: { dir:'.', name, version, manifestPath:'package.json', patchPath:'cordis.patch.yml',
 *             clientArtifact:'lib/client.js'|null, rows:[{id,name}], row:null },
 *     packages: [ { kind:'subpath'|'standalone', sub, dir, name, version, manifestPath,
 *                   entry, patchPath, clientArtifact, row:{id,name}|null } ... ]（按 dir 排序）,
 *     clientPackages: [main, ...有 clientArtifact 的包],
 *     violations: string[] }
 *
 * `enumerateViolations(model, io)` 是**唯一的判据面**：生产路径（discoverPackages 末尾）与
 * selftest 的全部负对照都调它，不允许在负对照里另抄一份判据 —— 本仓踩过"负对照恒真"的坑
 * （守卫的负对照必须能真的证明主判据会红）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根绝对路径（本文件在 `test/tools/` 下 ⇒ 上两级）。 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 地板取当前实测值：主包 + 7 个独立子包，主 patch 共 8 行。
 * 浏览器半边产物 5 份：主包（src/client.js）、fx、parallax、fonts、pet-link
 * （pet-link 收口前源码由主包构建内联、无自有产物；2026-10-15 收口成一般形态后自出
 * packages/pet-link/lib/client.pet-link.js，地板随之 4→5）。
 * ⚠️ `clientArtifacts` 与 `test/verify-client-sync.mjs` 的产物面地板**共用这一个常量**（那边 import 它）
 * ⇒ 抬地板是**一处改动**，两边的正/负对照自动同批跟着走（原先两处各写一个数字、必须手动同批抬的隐患已消）。
 */
export const FLOORS = { packages: 7, clientArtifacts: 5, rows: 8 };

// ── 路径小工具（模型一律根相对 POSIX）─────────────────────────────────────────

/** 平台路径 → POSIX 分隔（跨平台比较用）。 */
function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

/** 把若干相对段拼成根相对 POSIX 路径；丢掉空段与 `'.'`，剥 `./` 前缀与尾 `/`。 */
function joinPosix(...parts) {
  const segs = [];
  for (const raw of parts) {
    if (raw === undefined || raw === null) continue;
    let s = toPosix(raw).trim();
    if (s.startsWith('./')) s = s.slice(2);
    s = s.replace(/\/+$/, '');
    if (s === '' || s === '.') continue;
    segs.push(s);
  }
  return segs.join('/');
}

/** 根相对路径 → 绝对路径（`io` 面的入参一律绝对路径）。 */
function absOf(root, rel) {
  return path.resolve(root, rel);
}

// ── 生产 io（node:fs；selftest 用注入版覆盖单点）─────────────────────────────

function ioReal() {
  return {
    fileExists(abs) {
      try {
        return statSync(abs).isFile();
      } catch {
        return false;
      }
    },
    readText(abs) {
      return readFileSync(abs, 'utf8');
    },
  };
}

/** 读一份清单并 JSON.parse；失败返回 `{ ok:false, error }`（发现层不许崩，改由判据点名）。 */
function readManifest(io, abs) {
  let text;
  try {
    text = io.readText(abs);
  } catch (err) {
    return { ok: false, error: '读取失败：' + String((err && err.message) || err).split('\n')[0] };
  }
  try {
    return { ok: true, manifest: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).split('\n')[0] };
  }
}

// ── patch 扫描（手写：链上不引 js-yaml）──────────────────────────────────────

/** 剥掉行尾 `#` 注释（引号内的 `#` 不算注释；行首 `#` 即整行注释）。 */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** 剥值两侧成对的引号（单 / 双）。 */
function stripQuotes(value) {
  const s = String(value).trim();
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === "'" || a === '"') && a === b) return s.slice(1, -1);
  }
  return s;
}

/**
 * 主 `cordis.patch.yml` 的 `insert` 行 → `[{ id, name }]`，按文件顺序。
 *
 * 语义（与 `lib/subpackage-boot.js` / `verify-package-files.mjs` 的 patch 行扫描同一口径）：
 *   · `#` 开头的整行与行尾注释都先剥掉 —— 注释里出现 `id:` / `name:` **不得**被认成数据；
 *   · 只认**行级** `id:` / `name:`（`- id: x` 与缩进 `name: y` 两种写法都要认，
 *     `foo: id: bar` 这种行内出现不算）；
 *   · 值两侧的单 / 双引号剥掉。
 * 分组：一个 `id:` 开一行；随后的 `name:` 归它；`name:` 先于 `id:` 出现时也成一行（id=null）。
 */
export function parseRows(patchText) {
  const rows = [];
  let cur = null;
  const flush = () => {
    if (cur && (cur.id !== null || cur.name !== null)) rows.push(cur);
    cur = null;
  };
  for (const raw of String(patchText === undefined || patchText === null ? '' : patchText).split(/\r?\n/)) {
    const body = stripComment(raw).trim();
    if (!body || body === '-') continue;
    const isItem = /^-\s/.test(body);
    // 新的序列项开始（且上一项已有 name）⇒ 收束上一行；`- id:` 若上一行只写了 id 也在此收束。
    if (isItem && cur && (cur.name !== null || cur.id !== null)) flush();
    const line = isItem ? body.replace(/^-\s+/, '') : body;
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (key !== 'id' && key !== 'name') continue;
    const value = stripQuotes(m[2]);
    if (key === 'id') {
      flush();
      cur = { id: value, name: null };
    } else {
      if (!cur) cur = { id: null, name: null };
      cur.name = value;
    }
  }
  flush();
  return rows;
}

// ── 清单里的两张脸：`exports['./client']` ⇄ 产物路径；`dsh.bundle.patch` ⇄ patch 路径 ──

/**
 * `exports['./client']` 的路径值（字符串，或条件对象里的第一个字符串）。
 * 返回 `null` = 没声明；返回 `''` = 声明了但取不到路径（判据要红，别静默当没有）。
 */
function clientExport(exportsField) {
  if (!exportsField || typeof exportsField !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(exportsField, './client')) return null;
  const v = exportsField['./client'];
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    for (const k of ['default', 'import', 'require', 'node', 'browser']) {
      if (typeof v[k] === 'string') return v[k];
    }
  }
  return '';
}

/** 包目录 + `exports['./client']`（去 `./`）⇒ 根相对产物路径；无声明 / 取不到 ⇒ null。 */
function artifactOf(dir, exportsField) {
  const rel = clientExport(exportsField);
  if (rel === null || rel === '') return null;
  return joinPosix(dir, rel);
}

/** 包目录 + `dsh.bundle.patch` ⇒ 根相对 patch 路径；无声明 ⇒ null。 */
function patchRelOf(manifest, dir) {
  const p = manifest && manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch;
  if (typeof p !== 'string' || !p) return null;
  return joinPosix(dir, p);
}

/** `dir` 下所有**带 package.json** 的直接子目录名（磁盘通配，不写死名单；跟随符号链接目录）。 */
function listPackageDirs(io, absDir) {
  let names;
  try {
    names = readdirSync(absDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.slice().sort()) {
    const abs = path.join(absDir, name);
    let st;
    try {
      st = statSync(abs); // 跟随链接：开发期子包目录可能是 junction
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (!io.fileExists(path.join(abs, 'package.json'))) continue;
    out.push(name);
  }
  return out;
}

/** 一个发现到的包（subpath / standalone）的模型项。 */
function buildEntry(io, root, kind, sub, dir) {
  const manifestPath = joinPosix(dir, 'package.json');
  const r = readManifest(io, absOf(root, manifestPath));
  const mf = r.ok ? r.manifest : {};
  const mainField = typeof mf.main === 'string' && mf.main ? mf.main : null;
  return {
    kind,
    sub,
    dir,
    name: typeof mf.name === 'string' && mf.name ? mf.name : null,
    version: typeof mf.version === 'string' && mf.version ? mf.version : null,
    manifestPath,
    entry: mainField ? joinPosix(dir, mainField) : null,
    patchPath: patchRelOf(mf, dir),
    clientArtifact: artifactOf(dir, mf.exports),
    row: null,
  };
}

// ── 发现 ─────────────────────────────────────────────────────────────────────

/**
 * 从磁盘 + 根 `package.json` + 根 `cordis.patch.yml` 发现全部包。
 *
 * 规则（真源，不写死包名 / 子目录）：
 *   · main：根 `package.json`（name / version / main / `dsh.bundle.patch` / `exports['./client']`）；
 *   · subpath：`lib/components/*` 下每个目录的 `package.json`；`sub` = 目录名；
 *     行名规则 `<主包名>/<sub>`；清单名规则 `<主包名>-<sub>`；
 *   · standalone：`packages/*` 下每个目录的 `package.json`；`sub` = 目录名；行名规则 = 清单真名；
 *   · 行真源 = 根 `cordis.patch.yml` 的 `insert` 行（parseRows）；
 *   · `clientArtifact` = 包目录 + `exports['./client']` 去 `./` 前缀（无声明则 null）。
 *
 * `main.row` 恒为 `null`（主包自己的行按**主包真名**在判据里认领，接口冻结如此）；
 * 每个子包 / 组件包的 `row` 是它认领到的**那一条** patch 行（认不到 / 认到多条 ⇒ null，判据点名）。
 */
export function discoverPackages(root = ROOT) {
  const io = ioReal();
  const mainManifestPath = 'package.json';
  const mainRead = readManifest(io, absOf(root, mainManifestPath));
  const mainMf = mainRead.ok ? mainRead.manifest : {};
  // 主 patch 挂点：清单声明优先（冻结值 `cordis.patch.yml`），声明缺失时退回该冻结路径。
  const patchPath = patchRelOf(mainMf, '.') || 'cordis.patch.yml';
  // 初值刻意不写：try / catch 两条分支都会先赋值再读（写 `''` 会被 no-useless-assignment 判死信）。
  let patchText;
  try {
    patchText = io.readText(absOf(root, patchPath));
  } catch {
    patchText = '';
  }
  const rows = parseRows(patchText);
  const main = {
    dir: '.',
    name: typeof mainMf.name === 'string' && mainMf.name ? mainMf.name : null,
    version: typeof mainMf.version === 'string' && mainMf.version ? mainMf.version : null,
    manifestPath: mainManifestPath,
    patchPath,
    clientArtifact: artifactOf('.', mainMf.exports),
    rows,
    row: null,
  };

  const packages = [];
  for (const sub of listPackageDirs(io, path.join(root, 'lib', 'components'))) {
    packages.push(buildEntry(io, root, 'subpath', sub, joinPosix('lib/components', sub)));
  }
  for (const sub of listPackageDirs(io, path.join(root, 'packages'))) {
    packages.push(buildEntry(io, root, 'standalone', sub, joinPosix('packages', sub)));
  }
  packages.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));

  for (const p of packages) {
    const want = p.kind === 'subpath'
      ? (main.name ? main.name + '/' + p.sub : null)
      : p.name;
    const hits = want === null ? [] : rows.filter((r) => r && r.name === want);
    p.row = hits.length === 1 ? { id: hits[0].id, name: hits[0].name } : null;
  }

  const model = {
    root,
    main,
    packages,
    clientPackages: [main, ...packages.filter((p) => p.clientArtifact !== null)],
    violations: [],
  };
  model.violations = enumerateViolations(model, io);
  return model;
}

// ── 判据面（纯函数；生产与全部负对照共用这一份）───────────────────────────────

/**
 * 不变量（每条都有 selftest 负对照，且负对照调的就是本函数）：
 *   1. 地板：`packages ≥ FLOORS.packages`、`clientPackages ≥ FLOORS.clientArtifacts`、
 *      `main.rows ≥ FLOORS.rows`，且每份清单可 JSON.parse（`floor/*`）。
 *   2. 行 ⇄ 包**两侧交叉**：每条主 patch 行必须被**恰好一个**发现到的包认领
 *      （main 按主包真名、subpath 按 `<主包名>/<sub>`、standalone 按真名）
 *      —— 零认领 = 死行（`rows/deadRow`）、多认领 = `rows/dupClaim`；
 *      盘上有包而 patch 无行 ⇒ `rows/noRow`；模型里的 `row` 与 patch 行不一致 ⇒ `rows/staleRow`。
 *   3. `dsh.client` 声明 ⟺ `exports['./client']` 存在 ⟺ `clientArtifact` 非 null
 *      **且目标文件在盘上**（`io.fileExists`），三处任一漂移都点名（`client/*`）。
 *   4. 清单名规则：subpath ⇒ `<主包名>-<sub>`；standalone ⇒ 自身真名且 ≠ 主包名（`name/rule-*`）。
 *
 * `io = { fileExists(absPath), readText(absPath) }` 注入 ⇒ 合成"产物缺失 / 清单坏 JSON /
 * 清单改名"都能走同一条判据。返回违规清单（空 = 干净）。
 */
export function enumerateViolations(model, io) {
  const bad = [];
  if (!model || typeof model !== 'object') return ['model: 不是对象（缺少 discoverPackages 的模型）'];
  if (!io || typeof io.fileExists !== 'function' || typeof io.readText !== 'function') {
    return ["model: io 面缺失（需要 { fileExists, readText }）"];
  }
  const root = typeof model.root === 'string' && model.root ? model.root : ROOT;
  const main = model.main && typeof model.main === 'object' ? model.main : null;
  const pkgs = Array.isArray(model.packages) ? model.packages : [];
  const clientPkgs = Array.isArray(model.clientPackages) ? model.clientPackages : [];
  const rows = main && Array.isArray(main.rows) ? main.rows : [];

  // ── 不变量 1：地板 ───────────────────────────────────────────────────────
  if (pkgs.length < FLOORS.packages) {
    bad.push('floor/packages: 发现到 ' + pkgs.length + ' 个包 < 地板 ' + FLOORS.packages);
  }
  if (clientPkgs.length < FLOORS.clientArtifacts) {
    bad.push('floor/clientArtifacts: 浏览器半边产物 ' + clientPkgs.length + ' 个 < 地板 ' + FLOORS.clientArtifacts);
  }
  if (rows.length < FLOORS.rows) {
    bad.push('floor/rows: 主 patch ' + rows.length + ' 行 < 地板 ' + FLOORS.rows);
  }

  const infos = [];
  if (main) infos.push({ label: 'main', entry: main, isMain: true, mf: null, declaredName: null });
  pkgs.forEach((p, i) => {
    infos.push({ label: (p && p.dir) || ('packages[' + i + ']'), entry: p, isMain: false, mf: null, declaredName: null });
  });

  // ── 清单可解析 + 不变量 3（dsh.client ⇔ exports['./client'] ⇔ 产物在盘上）──
  for (const info of infos) {
    const { entry, label } = info;
    if (!entry || typeof entry !== 'object') {
      bad.push('model/entry: ' + label + ' 不是对象');
      continue;
    }
    const manifestPath = typeof entry.manifestPath === 'string' && entry.manifestPath ? entry.manifestPath : null;
    if (!manifestPath) {
      bad.push('manifest/' + label + ': manifestPath 缺失');
    } else {
      const r = readManifest(io, absOf(root, manifestPath));
      if (!r.ok) {
        bad.push('floor/manifestParse: ' + label + ' 的清单不可 JSON.parse（' + manifestPath + '）：' + r.error);
      } else {
        info.mf = r.manifest;
      }
    }
    const mf = info.mf;
    const declaredName = mf && typeof mf.name === 'string' && mf.name ? mf.name : null;
    info.declaredName = declaredName;
    if (mf && !declaredName) bad.push('name/' + label + ': 清单缺 name');

    const hasDshClient = Boolean(mf && mf.dsh && typeof mf.dsh === 'object'
      && mf.dsh.client !== undefined && mf.dsh.client !== null);
    const expPath = mf ? clientExport(mf.exports) : null;
    const hasExport = expPath !== null;
    const artifact = typeof entry.clientArtifact === 'string' && entry.clientArtifact ? entry.clientArtifact : null;
    if (hasDshClient !== hasExport) {
      bad.push('client/dsh-client-vs-export: ' + label + (hasDshClient
        ? " 声明了 dsh.client 但没有 exports['./client']"
        : " 有 exports['./client'] 但没有 dsh.client"));
    }
    if (hasExport !== (artifact !== null)) {
      bad.push('client/export-vs-artifact: ' + label + (hasExport
        ? " 有 exports['./client'] 但模型 clientArtifact 为 null"
        : ' 模型 clientArtifact=' + artifact + " 但没有 exports['./client']"));
    }
    if (hasExport && artifact !== null && expPath !== '') {
      const want = joinPosix(entry.dir, expPath);
      if (artifact !== want) {
        bad.push('client/artifact-path: ' + label + ' 的 clientArtifact=' + artifact
          + " ≠ dir + exports['./client'] 归一化值 " + want);
      }
    }
    if (artifact !== null && !io.fileExists(absOf(root, artifact))) {
      bad.push('client/artifact-missing: ' + label + ' 的产物在盘上不存在：' + artifact);
    }
  }

  const mainInfo = infos.find((i) => i.isMain);
  const mainName = mainInfo ? mainInfo.declaredName : null;

  // ── 不变量 4：清单名规则 ─────────────────────────────────────────────────
  for (const info of infos) {
    if (info.isMain || !info.mf || !info.declaredName) continue;
    const e = info.entry;
    if (e.kind === 'subpath') {
      if (!mainName) continue; // 主包真名缺失已在 main 那条上单独点名
      const want = mainName + '-' + e.sub;
      if (info.declaredName !== want) {
        bad.push('name/rule-subpath: ' + info.label + ' 清单名 ' + info.declaredName
          + ' ≠ <主包名>-<sub> = ' + want);
      }
    } else if (e.kind === 'standalone') {
      if (mainName && info.declaredName === mainName) {
        bad.push('name/rule-standalone: ' + info.label + ' 用了主包名 ' + mainName + '（standalone 必须用自身真名）');
      }
    } else {
      bad.push('model/kind: ' + info.label + ' 的 kind=' + JSON.stringify(e.kind) + ' 不是 subpath/standalone');
    }
  }

  // ── 不变量 2：行 ⇄ 包两侧交叉 ───────────────────────────────────────────
  const claims = new Map();
  for (const r of rows) if (r && typeof r === 'object' && typeof r.name === 'string') claims.set(r, []);
  for (const info of infos) {
    if (!info.mf) continue; // 清单读不出来：上面已点名，不叠加
    const e = info.entry;
    let want = null;
    if (info.isMain) want = info.declaredName;
    else if (e.kind === 'subpath') want = mainName ? mainName + '/' + e.sub : null;
    else if (e.kind === 'standalone') want = info.declaredName;
    if (!want) continue;
    const hits = rows.filter((r) => r && r.name === want);
    if (hits.length === 0) {
      bad.push('rows/noRow: ' + info.label + ' 在 cordis.patch.yml 里没有行（期望行名 ' + want + '）');
      continue;
    }
    if (hits.length > 1) {
      bad.push('rows/dupRow: ' + info.label + ' 的期望行名 ' + want + ' 在 patch 里出现 ' + hits.length + ' 次');
    }
    for (const r of hits) if (claims.has(r)) claims.get(r).push(info.label);
    const stored = e.row;
    const hit = hits[0];
    // main.row **冻结为 null**（契约形状），其余包必须挂上被认领的那一行；
    // 挂错行 / 该挂没挂 ⇒ staleRow。两条路都有真负对照（⑩ null、⑪ 错行）。
    const pointerOk = Boolean(stored) && typeof stored === 'object'
      && stored.id === hit.id && stored.name === hit.name;
    const mainNullOk = info.isMain && (stored === null || stored === undefined);
    if (!pointerOk && !mainNullOk) {
      bad.push('rows/staleRow: ' + info.label + ' 的模型 row=' + JSON.stringify(stored === undefined ? null : stored)
        + ' 与 patch 行 id=' + hit.id + ' name=' + hit.name + ' 不一致');
    }
  }
  for (const [row, labels] of claims) {
    if (labels.length === 0) {
      bad.push('rows/deadRow: patch 行 id=' + row.id + ' name=' + row.name + ' 没有任何包认领');
    } else if (labels.length > 1) {
      bad.push('rows/dupClaim: patch 行 name=' + row.name + ' 被 ' + labels.length + ' 个包认领：' + labels.join(', '));
    }
  }
  return bad;
}

// ── selftest（正判据 + 负对照，全部走 enumerateViolations 同一份判据）──────────

/** 真实 io + 单点覆盖（键 = 绝对路径）；负对照只改一处，其余照走真实磁盘。 */
function ioWith(base, overrides) {
  const readText = (overrides && overrides.readText) || {};
  const fileExists = (overrides && overrides.fileExists) || {};
  return {
    fileExists(abs) {
      return Object.prototype.hasOwnProperty.call(fileExists, abs) ? fileExists[abs] : base.fileExists(abs);
    },
    readText(abs) {
      return Object.prototype.hasOwnProperty.call(readText, abs) ? readText[abs] : base.readText(abs);
    },
  };
}

const HIT = '\u2713';
const MISS = '\u2717';

function runSelftest() {
  const io = ioReal();
  const base = discoverPackages(ROOT);
  const results = [];
  const check = (label, ok, detail) => {
    results.push(ok);
    console.log((ok ? HIT : MISS) + ' ' + label + (detail ? ' — ' + detail : ''));
  };

  // ── 正判据：真实模型必须干净 ─────────────────────────────────────────────
  console.log('── 正判据 ──────────────────────────────────────────────');
  console.log('[model] packages=' + base.packages.length + ' clientPackages=' + base.clientPackages.length
    + ' rows=' + base.main.rows.length + ' root=' + base.root);
  for (const p of base.packages) {
    console.log('  · ' + p.kind + ' ' + p.dir + ' | name=' + p.name + ' | entry=' + p.entry
      + ' | clientArtifact=' + p.clientArtifact + ' | row=' + (p.row ? p.row.id : '(无)'));
  }
  console.log('  · main row=' + (base.main.row === null ? 'null（冻结）' : JSON.stringify(base.main.row))
    + ' | clientArtifact=' + base.main.clientArtifact + ' | patch=' + base.main.patchPath);

  const baseViolations = enumerateViolations(base, io);
  check('正判据：真实模型 violations 为空（enumerateViolations）',
    baseViolations.length === 0,
    baseViolations.length ? JSON.stringify(baseViolations) : 'violations=[]');
  check('正判据：discoverPackages 自己挂的 violations 也为空',
    Array.isArray(base.violations) && base.violations.length === 0,
    'model.violations=' + JSON.stringify(base.violations));
  check('正判据：地板达标（packages ≥ ' + FLOORS.packages + '、clientArtifacts ≥ ' + FLOORS.clientArtifacts
    + '、rows ≥ ' + FLOORS.rows + '）',
  base.packages.length >= FLOORS.packages && base.clientPackages.length >= FLOORS.clientArtifacts
    && base.main.rows.length >= FLOORS.rows,
  base.packages.length + ' / ' + base.clientPackages.length + ' / ' + base.main.rows.length);

  // ── 钉住出口口径：dir / entry / clientArtifact 一律**根相对**（Lead m00067 冻结）──
  check('正判据：clientArtifact 一律根相对（main `lib/client.js`；包内 `<dir>/lib/*.js`），可直接 path.resolve(ROOT, p)',
    base.main.clientArtifact === 'lib/client.js'
      && io.fileExists(absOf(ROOT, base.main.clientArtifact))
      && base.clientPackages.filter((p) => p !== base.main).every((p) =>
        typeof p.clientArtifact === 'string'
        && p.clientArtifact.startsWith(p.dir + '/')
        && io.fileExists(absOf(ROOT, p.clientArtifact))),
    'main=' + base.main.clientArtifact + ' 包内=' + JSON.stringify(
      base.clientPackages.filter((p) => p !== base.main).map((p) => p.clientArtifact)));
  check('正判据：entry 一律根相对（standalone `<dir>/lib/index.js`、subpath `<dir>/index.js`），可直接 path.resolve(ROOT, p)',
    typeof base.main.entry === 'undefined'
      && base.packages.every((p) => p.entry === (p.kind === 'standalone'
        ? p.dir + '/lib/index.js' : p.dir + '/index.js'))
      && base.packages.every((p) => io.fileExists(absOf(ROOT, p.entry))),
    'standalone=' + JSON.stringify(base.packages.filter((p) => p.kind === 'standalone').map((p) => p.entry))
      + ' subpath=' + JSON.stringify(base.packages.filter((p) => p.kind === 'subpath').map((p) => p.entry)));

  // ── parseRows 的牙（手写扫描：注释 / 引号 / 行级 key）────────────────────
  const syntheticPatch = [
    '# 说明：注释里出现 id: fake 与 name: fake 都不得被认成数据',
    '- insert:',
    "    - id: row-one   # 行尾注释 id: fake 同样是注释",
    "      name: 'quoted-single'",
    '    - id: row-two',
    '      name: "quoted-double"',
    '    - id: row-three',
    '      name: bare-value',
  ].join('\n');
  const parsed = parseRows(syntheticPatch);
  check('parseRows：3 行、注释里的 id/name 不计入、单双引号与裸值都剥对',
    parsed.length === 3
      && parsed[0].id === 'row-one' && parsed[0].name === 'quoted-single'
      && parsed[1].id === 'row-two' && parsed[1].name === 'quoted-double'
      && parsed[2].id === 'row-three' && parsed[2].name === 'bare-value',
    JSON.stringify(parsed));

  // ── 负对照（每条只喂一个缺陷；用一个"干净模型副本"做基）──────────────────
  console.log('── 负对照（全部经 enumerateViolations）─────────────────');

  /** 跑一条负对照：期望**恰好**命中 expected 这些 tag（多出任何不相干违规即红）。 */
  const control = (label, model, controlIo, expected) => {
    const got = enumerateViolations(model, controlIo);
    const missing = expected.filter((t) => !got.some((v) => v.startsWith(t)));
    const unmatched = got.filter((v) => !expected.some((t) => v.startsWith(t)));
    const ok = got.length > 0 && missing.length === 0 && unmatched.length === 0;
    check(label, ok, '命中=[' + expected.join(', ') + '] 实际 ' + got.length + ' 条'
      + (ok ? '' : ' | 缺=' + JSON.stringify(missing) + ' 多=' + JSON.stringify(unmatched) + ' 全部=' + JSON.stringify(got)));
  };

  const clone = (m) => JSON.parse(JSON.stringify(m));
  const abs = (rel) => absOf(ROOT, rel);
  // P-F 批 1c 起三格组件也已出户 ⇒ 发现层不再有任何 `kind === 'subpath'` 的包；"没有浏览器半边的包"
  // 改从**任意** kind 里找（today = about-notice / mascot-avatar / media-bridge 三个 standalone）。
  // 负对照不许依赖"盘面上恰好有某个形态的包"（≥ P-C 那次 `subNoClient` 崩掉的教训）。
  const subNoClient = base.packages.find((p) => p.clientArtifact === null);
  if (!subNoClient) throw new Error('[selftest] 负对照 ③/⑦ 需要至少一个不带浏览器半边的包（main 之外的任一形态）');
  const standaloneClient = base.packages.find((p) => p.kind === 'standalone' && p.clientArtifact !== null);

  // ① 模型里删掉一个包（挑带浏览器半边的 standalone：删它同时摘掉 clientPackages 一项，
  //    产物数 4→3 仍**正好压在地板线上**、不额外触发产物地板 ⇒ 这条负对照只留"删包"一个缺陷）。
  //    ⚠️ 曾经这里挑的是"不带浏览器半边的 standalone"（当时的 host-only 包）；P-C 之后字体包
  //    也有产物了、本仓已无这种真实包 ⇒ 该写法会 `undefined.dir` 崩掉。负对照不许依赖
  //    "盘面上恰好有某个形态的包"这种会随重构漂移的前提（否则重构一落地，判据自己先烂）。
  //    ✅ 已收（P-F 批 1c，2026-10-16）：`FLOORS.clientArtifacts` 已抬到 4（main+fonts+fx+parallax），
  //    且 `test/verify-client-sync.mjs` 的产物地板**直接 import 同一个常量** ⇒ 两处不会再一高一低
  //    （它那边的"地板 − 1 份 ⇒ 不达标"负对照也自动跟着走）。
  {
    const m = clone(base);
    const victim = m.packages.find((p) => p.kind === 'standalone' && p.clientArtifact !== null);
    if (!victim) throw new Error('[selftest] 负对照 ① 需要至少一个带浏览器半边的 standalone 包');
    m.packages = m.packages.filter((p) => p.dir !== victim.dir);
    m.clientPackages = m.clientPackages.filter((p) => p.dir !== victim.dir);
    control('\u2460 负对照：模型里删掉包 ' + victim.dir + ' ⇒ 地板 + 死行',
      m, io, ['floor/packages', 'floor/clientArtifacts', 'rows/deadRow']);
  }

  // ② 合成多一条 patch 行 ⇒ 死行
  {
    const m = clone(base);
    m.main.rows = m.main.rows.concat([{ id: 'synthetic-extra', name: (m.main.name || 'pkg') + '-synthetic-extra' }]);
    control('\u2461 负对照：合成多一条 patch 行 ⇒ 死行（无包认领）', m, io, ['rows/deadRow']);
  }

  // ③ 声明 dsh.client 但没有 exports['./client']
  {
    const m = clone(base);
    const rel = subNoClient.manifestPath;
    const text = io.readText(abs(rel));
    const mf = JSON.parse(text);
    mf.dsh = Object.assign({}, mf.dsh, { client: { platform: 'web', immediately: true } });
    control("\u2462 负对照：清单声明 dsh.client 但无 exports['./client'] ⇒ 违规",
      m, ioWith(io, { readText: { [abs(rel)]: JSON.stringify(mf, null, 2) } }), ['client/dsh-client-vs-export']);
  }

  // ④ clientArtifact 目标文件在盘上不存在（io.fileExists 注入）
  {
    const m = clone(base);
    control('\u2463 负对照：clientArtifact 目标文件不存在 ⇒ 违规',
      m, ioWith(io, { fileExists: { [abs(standaloneClient.clientArtifact)]: false } }), ['client/artifact-missing']);
  }

  // ⑤ 空模型 ⇒ 三条地板
  {
    const m = { root: ROOT, main: null, packages: [], clientPackages: [], violations: [] };
    control('\u2464 负对照：空模型 ⇒ 三条地板违规',
      m, io, ['floor/packages', 'floor/clientArtifacts', 'floor/rows']);
  }

  // ⑥ 清单名改成主包名 ⇒ 清单名规则（连带：行按 `name` 认领 ⇒ 改名后该包的行失配/被主包重复认领）
  //   P-F 批 1c 起 `subNoClient` 已是 standalone 形态（发现层不再有 subpath 包）⇒ 命中的是
  //   `name/rule-standalone`（"standalone 必须用自身真名"），不再是 `name/rule-subpath`；
  //   改名同时把行认领关系打散 ⇒ 一次性断言整条因果链（staleRow / dupClaim / deadRow）。
  {
    const m = clone(base);
    const rel = subNoClient.manifestPath;
    const mf = JSON.parse(io.readText(abs(rel)));
    mf.name = base.main.name;
    control('\u2465 负对照：非主包清单名改成主包名 ⇒ 清单名规则违规（连带行认领打散）',
      m, ioWith(io, { readText: { [abs(rel)]: JSON.stringify(mf, null, 2) } }),
      ['name/rule-standalone', 'rows/staleRow', 'rows/dupClaim', 'rows/deadRow']);
  }

  // ⑦ 盘上多一个包而 patch 无行 ⇒ 未登记（rows/noRow）
  {
    const m = clone(base);
    const ghostDir = 'packages/ghost';
    const ghostName = (m.main.name || 'pkg') + '-ghost';
    m.packages = m.packages.concat([{
      kind: 'standalone', sub: 'ghost', dir: ghostDir, name: ghostName, version: '0.0.0',
      manifestPath: ghostDir + '/package.json', entry: ghostDir + '/lib/index.js',
      patchPath: null, clientArtifact: null, row: null,
    }]);
    control('\u2466 负对照：盘上多一个包而 patch 无行 ⇒ 未登记行',
      m, ioWith(io, { readText: { [abs(ghostDir + '/package.json')]: JSON.stringify({ name: ghostName, version: '0.0.0' }) } }),
      ['rows/noRow']);
  }

  // ⑧ 两个包认领同一条行 ⇒ 重复认领
  {
    const m = clone(base);
    const dupDir = 'packages/fx-dup';
    const row = base.packages.find((p) => p.dir === standaloneClient.dir).row;
    m.packages = m.packages.concat([{
      kind: 'standalone', sub: 'fx-dup', dir: dupDir, name: standaloneClient.name,
      version: standaloneClient.version, manifestPath: dupDir + '/package.json',
      entry: dupDir + '/lib/index.js', patchPath: null, clientArtifact: null, row: row ? clone(row) : null,
    }]);
    control('\u2467 负对照：两个包认领同一条 patch 行 ⇒ 重复认领',
      m,
      ioWith(io, { readText: { [abs(dupDir + '/package.json')]: JSON.stringify({ name: standaloneClient.name, version: standaloneClient.version }) } }),
      ['rows/dupClaim']);
  }

  // ⑨ 清单坏 JSON ⇒ 不可解析（连带：认不出真名 ⇒ 那一行没人认领，同一缺陷的因果链）
  {
    const m = clone(base);
    const rel = subNoClient.manifestPath;
    control('\u2468 负对照：清单不是合法 JSON ⇒ 地板（JSON.parse）违规（连带该行无人认领）',
      m, ioWith(io, { readText: { [abs(rel)]: '{ this is not json' } }),
      ['floor/manifestParse', 'rows/deadRow']);
  }

  // ⑩ 非 main 包的行指针为 null ⇒ staleRow（该挂没挂）
  {
    const m = clone(base);
    const victim = m.packages.find((p) => p.kind === 'standalone' && p.clientArtifact !== null);
    victim.row = null;
    control('\u2469 负对照：包的行指针为 null ⇒ 该挂没挂（staleRow）', m, io, ['rows/staleRow']);
  }

  // ⑪ 行指针挂到别的行上 ⇒ staleRow（挂错行）
  {
    const m = clone(base);
    const victim = m.packages.find((p) => p.kind === 'standalone' && p.clientArtifact !== null);
    victim.row = { id: 'not-this-row', name: (m.main.name || 'pkg') + '-not-this-row' };
    control('\u246A 负对照：行指针挂错行 ⇒ staleRow', m, io, ['rows/staleRow']);
  }

  const negatives = 11;
  const failed = results.filter((r) => !r).length;
  console.log('── 汇总 ────────────────────────────────────────────────');
  console.log('[selftest] 负对照 ' + negatives + ' 条（要求 ≥6），共 ' + results.length + ' 项检查，'
    + (failed === 0 ? HIT + ' 全绿' : MISS + ' ' + failed + ' 项红'));
  return failed === 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printSummary(model) {
  console.log('[packages] root=' + model.root);
  console.log('[packages] main=' + model.main.name + '@' + model.main.version
    + ' manifest=' + model.main.manifestPath + ' patch=' + model.main.patchPath
    + ' clientArtifact=' + model.main.clientArtifact + ' rows=' + model.main.rows.length);
  for (const p of model.packages) {
    console.log('  · ' + p.kind + ' ' + p.dir + ' | name=' + p.name + ' | entry=' + p.entry
      + ' | patchPath=' + p.patchPath + ' | clientArtifact=' + p.clientArtifact
      + ' | row=' + (p.row ? p.row.id : '(无)'));
  }
  console.log('[packages] packages=' + model.packages.length
    + ' clientPackages=' + model.clientPackages.length
    + ' rows=' + model.main.rows.length);
  console.log(model.violations.length
    ? '[packages] violations:\n  ' + model.violations.join('\n  ')
    : '[packages] violations=[]');
}

function mainCli(argv) {
  const cmd = argv[0];
  if (cmd === 'selftest') {
    process.exitCode = runSelftest() ? 0 : 1;
    return;
  }
  const model = discoverPackages();
  if (cmd === '--json') {
    console.log(JSON.stringify(model, null, 2));
  } else {
    printSummary(model);
  }
  process.exitCode = model.violations.length ? 1 : 0;
}

const invokedDirectly = Boolean(process.argv[1])
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) mainCli(process.argv.slice(2));
