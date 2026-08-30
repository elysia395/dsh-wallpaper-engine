// 健壮性审计 A1: 校验 lib/ 全部运行时导入闭包 vs package.json files
// 用法: node scripts/audit-import-closure.mjs
// 输出: 未覆盖的导入（发布包缺文件 → registry 安装即崩，即 scene-script-apis 类 bug）
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

// 解析相对导入
const importRe = /(?:import\s+[^'"]*?from\s*|import\s*|require\s*\(\s*|new\s+URL\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g;
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
  const src = readFileSync(f, 'utf8');
  let m;
  importRe.lastIndex = 0;
  while ((m = importRe.exec(src)) !== null) {
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
// 反向: files 里的 lib 文件是否真的存在于导入图（孤儿文件，无碍但提示）
console.log(`\nlib 文件数: ${libFiles.length}, 被导入覆盖: ${checked.size}`);
console.log(problems === 0 ? '\n✅ 导入闭包全部被 files 覆盖' : `\n❌ ${problems} 处问题（见上）`);
process.exit(problems === 0 ? 0 : 1);
