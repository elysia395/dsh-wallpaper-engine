// 健壮性审计 A1: 校验 lib/ 全部运行时导入闭包 vs package.json files
// 用法: node test/tools/audit-import-closure.mjs
// 输出: 未覆盖的导入（发布包缺文件 → registry 安装即崩）
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const filesList = pkg.files || [];

// 展开 files 列表为具体文件集合
function expandFiles(list) {
  const out = new Set();
  for (const entry of list) {
    const abs = join(root, entry);
    if (!existsSync(abs)) { console.log(`  [WARN] files 条目不存在: ${entry}`); continue; }
    if (statSync(abs).isDirectory()) {
      const walk = (d) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          if (statSync(p).isDirectory()) walk(p);
          else out.add(relative(root, p).replace(/\\/g, '/'));
        }
      };
      walk(abs);
    } else out.add(entry);
  }
  return out;
}
const packed = expandFiles(filesList);

// 收集 lib/ 全部 JS/MJS 文件
const libFiles = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(n)) libFiles.push(p);
  }
};
walk(join(root, 'lib'));

// 解析相对说明符。**两类分开**，因为它们的后果不同：
//   · 真模块导入（`import` / `import()` / `require(`）解析不到 ⇒ `ERR_MODULE_NOT_FOUND`，
//     包一装上就崩 ⇒ 必须被 `files` 覆盖，这是本工具的**主判据**。
//   · 数据文件读取（`readFileSync(new URL('../x', import.meta.url))` 这类）读不到只是那个
//     功能降级，且**数据文件本来就不该缺** —— 那由 `verify-package-files` 的 P1 管
//     （`files` 必须覆盖 `lib/` 下每一个文件）。混进主判据会把"合法地读一个包根文件"
//     报成缺陷（实测：`lib/index.js` 读 `../package.json` 取 owner/repo）。
// ⚠️ 剥注释后再扫：散文里出现同样的字面量会造成假阳性（本仓踩过）。
import { stripComments } from './js-text.mjs';

const MODULE_RE = /(?:import\s+[^'"]*?from\s*|import\s*|require\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g;
const DATA_RE = /readFileSync\s*\(\s*new\s+URL\s*\(\s*['"](\.\.?\/[^'"]+)['"]/g;
function resolveTarget(fromFile, spec) {
  const base = dirname(fromFile);
  const abs = resolve(base, spec);
  const candidates = [abs, abs + '.js', abs + '.mjs', join(abs, 'index.js'), join(abs, 'index.mjs')];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

let problems = 0;
const checked = new Set();
const libRoot = resolve(root, 'lib');
for (const f of libFiles) {
  const rel = relative(root, f).replace(/\\/g, '/');
  const src = stripComments(readFileSync(f, 'utf8'));
  let m;
  MODULE_RE.lastIndex = 0;
  while ((m = MODULE_RE.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith('node:')) continue;
    const target = resolveTarget(f, spec);
    if (!target) {
      console.log(`  [UNRESOLVED] ${rel}: ${spec}`);
      problems++;
      continue;
    }
    const trel = relative(root, target).replace(/\\/g, '/');
    // node_modules → 由 dependencies 提供（外部审计）
    if (trel.startsWith('node_modules/')) continue;
    // 越出 lib/（非 node_modules）→ 发布包必然缺 → 真问题
    if (!target.startsWith(libRoot)) {
      console.log(`  [OUT-OF-LIB] ${rel} → ${trel}`);
      problems++;
      continue;
    }
    if (!packed.has(trel)) {
      console.log(`  [NOT-PACKED] ${rel} → ${trel}`);
      problems++;
    }
    checked.add(trel);
  }
}
// ── 数据文件读取：只核对"真有这个文件"，不要求它在 lib/ 内 ─────────────────────
// 例：`lib/index.js` 读 `../package.json`（包根，npm 永远会带）。
// 这类路径解析不到同样是缺陷（读不到 ⇒ 功能降级），但**不是**导入闭包问题。
{
  let dataMissing = 0;
  for (const f of libFiles) {
    const rel = relative(root, f).replace(/\\/g, '/');
    const src = stripComments(readFileSync(f, 'utf8'));
    let m;
    DATA_RE.lastIndex = 0;
    while ((m = DATA_RE.exec(src)) !== null) {
      const abs = resolve(dirname(f), m[1]);
      if (!existsSync(abs)) { console.log(`  [DATA-MISSING] ${rel}: ${m[1]}`); dataMissing++; }
    }
  }
  if (dataMissing) problems += dataMissing;
  console.log(`\n数据文件读取核对: ${dataMissing === 0 ? '全部存在于磁盘' : dataMissing + ' 处读不到'}`);
}

// ── 地板（C6）：被守护的域不得退化成空 ────────────────────────────────────────
// 若导入正则或 lib/ 递归枚举哪天失效，`checked` 会空而 `problems` 仍是 0 ⇒「没发现问题」与
// 「什么都没检查」同形，工具照样 exit 0。地板放在段落外，域退化时**无条件**记一处问题。
// 基线实测：lib 文件 43 个 / 被导入闭包覆盖 39 个；地板取 10，给删文件与重构留余量。
if (libFiles.length === 0 || checked.size < 10) {
  console.log(`  [DOMAIN-FLOOR] 覆盖面退化：lib 文件数 ${libFiles.length}（须 > 0）、`
    + `被导入覆盖 ${checked.size}（须 >= 10）—— 域空了，"零问题"不算通过`);
  problems++;
}

// 反向: files 里的 lib 文件是否真的存在于导入图（孤儿文件，无碍但提示）
console.log(`\nlib 文件数: ${libFiles.length}, 被导入覆盖: ${checked.size}`);
console.log(problems === 0 ? '\n✅ 导入闭包全部被 files 覆盖' : `\n❌ ${problems} 处问题（见上）`);
process.exit(problems === 0 ? 0 : 1);
