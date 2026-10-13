#!/usr/bin/env node
/**
 * 只读审计：`test/**` 里「只被写、从不被读」的局部变量与对象字段。
 *
 * ## 为什么是审计工具，不是守卫（Lead 裁定，task-11 ①）
 * 这条规则**现在还不是机械可判的**：实测有四大类结构性假阳，靠豁免名单撑起来的守卫会把
 * "红"变成维护负担，而本仓的门禁纪律是"只收机械可判的判据"（docs/DEV-GUIDE.md §4.8）。
 * 四类假阳（都是"读"发生在 AST 之外，静态引用面看不见）：
 *   ① **外部工具参数**：`spawn(..., { stdio, detached, windowsHide })` / `npm_config_cache` /
 *      `vm.Script` 的 `filename` / `Cookie` / `Origin` / CDP 参数 —— 消费者是子进程或原生层。
 *   ② **期望值字面量**：`assert.deepEqual(x, { beforeOpen: 1 })` —— 字面量整体被比较函数读。
 *   ③ **只作身份标记的桩字段**：`{ _interval: true }` —— 判据只 `typeof`/真值判定，从不按名取。
 *   ④ **DOM 桩完整性字段**：`{ cssText, baseVal, innerHTML }` —— 被测代码只从桩上整体取。
 *
 * ## 将来要升级成守卫的前置条件（三条都要满足）
 *   1. 上面四类假阳能**机械判定**，不依赖人工豁免名单；
 *   2. 豁免条目陈旧时（被豁免的行已不在盘上）**判红** —— 否则名单只增不减；
 *   3. 合成样本必须判红（喂一个只写不读的局部变量与字段，守据必须报）。
 *
 * ## 已知真候选（task-10 报出、task-11 已修，留作样例）
 *   · `test/verify-asset-paths.mjs` 的 `ret2`（删路径返回值零断言）
 *   · `test/warn-only.mjs` 的 `DSH_WARN_ONLY_EXIT`（进程内 set 的 env 传不给父进程 ⇒ 零读取）
 *   · `test/verify-softrender.mjs` 的 `exportsObj` / `test/live-frame-backfill-smoke.mjs` 的 `watchTick`
 *     （return 里从未被消费的字段）
 *
 * ## 用法
 *   node test/tools/audit-write-only-state.mjs            # 只打「非动态消费」桶（默认）
 *   node test/tools/audit-write-only-state.mjs --all      # 连动态消费桶一起打
 * 退出码恒为 0（审计工具，不进 `test/run-guards.mjs`，不改任何夹具）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // test/tools/ 比仓库根深两层
const CANDIDATE_DIRS = [join(ROOT, 'test')];
const READ_FACE_DIRS = [join(ROOT, 'test'), join(ROOT, 'lib'), join(ROOT, 'src'), join(ROOT, 'scripts')];
const SKIP_DIR = /(?:^|[\\/])(?:node_modules|\.git|\.test-cache|docs|types)(?:[\\/]|$)/;
const CODE_EXT = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/;
const SHOW_ALL = process.argv.includes('--all');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (SKIP_DIR.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && CODE_EXT.test(e.name)) out.push(p);
  }
  return out;
}

// ── 单文件收集器：把"读面"与"候选面"一次 AST 遍历拿到 ────────────────────────────
// eslint-scope 的 `references` 只认标识符引用：对象字面量的键、外部工具参数、
// 断言期望值都**不是**读 ⇒ 这正是假阳的来路，也是本工具只给候选的原因。
function keyName(node) {
  if (node.key.type === 'Identifier') return node.key.name;
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
  return null;
}

function declNames(node, out) {
  if (!node) return;
  if (node.type === 'VariableDeclaration') for (const d of node.declarations) collectPattern(d.id, out);
  else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') { if (node.id) out.add(node.id.name); }
}

function collectPattern(node, out) {
  if (!node) return;
  if (node.type === 'Identifier') out.add(node.name);
  else if (node.type === 'ObjectPattern') for (const p of node.properties) collectPattern(p.value || p.argument, out);
  else if (node.type === 'ArrayPattern') for (const el of node.elements) collectPattern(el, out);
  else if (node.type === 'AssignmentPattern') collectPattern(node.left, out);
  else if (node.type === 'RestElement') collectPattern(node.argument, out);
}

function isDeclarationId(node) {
  const p = node.parent;
  if (!p) return true;
  if (p.type === 'VariableDeclarator') return p.id === node;
  if (p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression') {
    return p.id === node || p.params.includes(node);
  }
  if (p.type === 'ClassDeclaration' || p.type === 'ClassExpression') return p.id === node;
  if (p.type === 'ImportSpecifier' || p.type === 'ImportDefaultSpecifier' || p.type === 'ImportNamespaceSpecifier') return true;
  if (p.type === 'CatchClause') return p.param === node;
  if (p.type === 'RestElement' || p.type === 'AssignmentPattern') return isDeclarationId(p);
  return false;
}

function makeRule(out) {
  return {
    create(ctx) {
      const sc = ctx.sourceCode;
      return {
        Identifier(node) {
          const p = node.parent;
          if (!p) return;
          if (p.type === 'MemberExpression' && p.property === node && !p.computed) return;
          if (p.type === 'Property' && p.key === node) return;
          if (p.type === 'MemberExpression' && p.property === node && p.computed) { out.bare.add(node.name); return; }
          if (isDeclarationId(node)) return;
          // `{ foo }` 简写：既是字段候选，也是变量 foo 的读
          if (p.type === 'Property' && p.shorthand && p.value === node) out.bare.add(node.name);
          else out.bare.add(node.name);
        },
        MemberExpression(node) {
          if (!node.computed && node.property.type === 'Identifier') out.member.add(node.property.name);
          // `x['content-type']` 这类**计算属性里的字符串字面量**也是按名读（HTTP 头 / CSS / 带点号键的常客）
          if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') out.member.add(node.property.value);
        },
        Property(node) {
          const name = keyName(node);
          if (!name) return;
          if (node.parent.type === 'ObjectExpression' && !node.computed) {
            out.props.push({ name, line: node.loc.start.line, dyn: dynamicReason(node.parent, ctx.sourceCode) });
          } else if (node.parent.type === 'ObjectPattern' && !node.computed) {
            out.patKey.add(name);
          }
        },
        BinaryExpression(node) {
          if (node.operator === 'in' && node.left.type === 'Literal' && typeof node.left.value === 'string') out.inKey.add(node.left.value);
        },
        ExportNamedDeclaration(node) {
          for (const s of node.specifiers) out.exported.add(s.local.name);
          declNames(node.declaration, out.exported);
        },
        'Program:exit'() {
          const { scopeManager } = sc;
          if (!scopeManager) return;
          for (const scope of scopeManager.scopes) {
            for (const v of scope.variables) {
              if (out.exported.has(v.name)) continue;
              if (v.defs.some((d) => d.type === 'ImportBinding')) continue;
              const refs = v.references;
              if (!refs.length || refs.some((r) => r.isRead()) || !refs.some((r) => r.isWrite())) continue;
              const def = v.defs[0];
              if (!def || def.type === 'Parameter' || def.type === 'CatchClause') continue;
              out.writeOnly.push({
                name: v.name,
                line: def.name && def.name.loc ? def.name.loc.start.line : 0,
                kind: def.type,
                writes: refs.filter((r) => r.isWrite()).map((r) => r.identifier.loc.start.line),
              });
            }
          }
        },
      };
    },
  };
}

function parseFile(linter, code) {
  const out = { bare: new Set(), member: new Set(), patKey: new Set(), inKey: new Set(), props: [], writeOnly: [], exported: new Set(), parsed: false, crash: null };
  const rule = { rules: { collect: makeRule(out) } };
  for (const sourceType of ['module', 'commonjs']) {
    const config = [{ plugins: { audit: rule }, rules: { 'audit/collect': 'error' }, languageOptions: { ecmaVersion: 'latest', sourceType } }];
    let messages;
    // 规则自身抛错**不能**当成"解析失败"吞掉：那会静默缩小读面（实测踩过一次 TypeError ⇒ 33 个文件被误报）
    try { messages = linter.verify(code, config); } catch (e) { out.crash = (e && e.message) || String(e); return out; }
    if (messages.some((m) => m.fatal)) continue;
    out.parsed = true;
    return out;
  }
  return out;
}

// ── 动态消费判定：绑到变量的对象若被"整体消费"，其字段一律进动态桶 ────────────────
function isHandlerMap(obj) {
  // 爬到链条末端时 `node` 可能已经不是对象字面量了（调用表达式、赋值目标…）⇒ 先判类型
  return obj.type === 'ObjectExpression' && obj.properties.length > 0 && obj.properties.every((p) => p.type === 'Property'
    && (p.value.type === 'FunctionExpression' || p.value.type === 'ArrowFunctionExpression'));
}

function dynamicReason(node, sourceCode, seen = new Set()) {
  for (let hop = 0; node && hop < 6; hop += 1) {
    if (seen.has(node)) return null;
    seen.add(node);
    const p = node.parent;
    if (!p) return null;
    if (p.type === 'Property' && p.value === node) { node = p.parent; continue; } // 嵌套对象 ⇒ 看外层
    if (p.type === 'SpreadElement') return 'spread';
    if (p.type === 'CallExpression' || p.type === 'NewExpression') {
      if (p.arguments.includes(node)) return 'call-arg';
      node = p;
      continue;
    }
    if (p.type === 'ReturnStatement') return isHandlerMap(node) ? 'handler-map' : null; // 返回出去的对象：调用方 `x.field` 在静态面里可见
    if (p.type === 'AssignmentExpression' && p.right === node) return null;
    if (p.type === 'VariableDeclarator' && p.init === node && p.id.type === 'Identifier') {
      const varName = p.id.name;
      for (const scope of sourceCode.scopeManager.scopes) {
        for (const v of scope.variables) {
          if (v.name !== varName) continue;
          for (const ref of v.references) {
            const rp = ref.identifier.parent;
            if (!rp) continue;
            if (rp.type === 'MemberExpression' && rp.object === ref.identifier && rp.computed) return 'computed-member';
            if (rp.type === 'SpreadElement') return 'spread';
            if ((rp.type === 'CallExpression' || rp.type === 'NewExpression') && rp.arguments.includes(ref.identifier)) return 'call-arg';
            // 简写属性（`{ headers }` / `{ sandbox }`）⇒ 看外层对象怎么被消费（fetch 参数、vm.runInContext …）
            if (rp.type === 'Property' && rp.value === ref.identifier && rp.parent.type === 'ObjectExpression') {
              const outer = dynamicReason(rp.parent, sourceCode, seen);
              if (outer) return outer;
            }
          }
        }
      }
      return isHandlerMap(node) ? 'handler-map' : null;
    }
    if (p.type === 'ObjectExpression' || p.type === 'ArrayExpression') { node = p; continue; }
    return null;
  }
  return null;
}

const linter = new Linter();
const candidates = [];
const reads = { bare: new Set(), member: new Set(), patKey: new Set(), inKey: new Set() };
const perFile = new Map();
const unparsed = [];
const crashed = [];

for (const dir of READ_FACE_DIRS) {
  for (const file of walk(dir)) {
    if (perFile.has(file)) continue;
    const info = parseFile(linter, readFileSync(file, 'utf8'));
    if (info.crash) { crashed.push(relative(ROOT, file) + ' :: ' + info.crash); continue; }
    if (!info.parsed) { unparsed.push(relative(ROOT, file)); continue; }
    perFile.set(file, info);
    for (const k of Object.keys(reads)) for (const n of info[k]) reads[k].add(n);
    if (CANDIDATE_DIRS.some((d) => file.startsWith(d + sep))) {
      for (const w of info.writeOnly) candidates.push({ file, ...w });
      for (const p of info.props) candidates.push({ file, name: p.name, line: p.line, dyn: p.dyn, prop: true });
    }
  }
}

const isRead = (name) => reads.bare.has(name) || reads.member.has(name) || reads.patKey.has(name) || reads.inKey.has(name);
// A 桶是**逐文件作用域级**的结论（eslint-scope 的引用面），不再按名字跨文件过滤；
// B 桶（对象字段）的消费天然跨文件，才用全仓读面。
const vars = candidates.filter((c) => !c.prop);
const props = candidates.filter((c) => c.prop && !isRead(c.name));
// 字段候选按"非动态消费"分桶：动态桶是 deepEqual 期望值 / spawn 参数 / 整体取用的桩那一类
const propsNonDynamic = props.filter((p) => !p.dyn);
const dyn = props.filter((p) => p.dyn);

console.log('write-only state audit（只读；候选须人工判，本工具不判红）');
console.log(`扫描面：候选 ${CANDIDATE_DIRS.length} 个目录 / 读面 ${perFile.size} 个文件${unparsed.length ? ` / 解析失败 ${unparsed.length}（${unparsed.slice(0, 3).join(', ')}）` : ''}${crashed.length ? ` / ⚠ 规则抛错 ${crashed.length}（读面有洞，须先修工具）` : ''}`);
for (const c of crashed) console.log('  ⚠ ' + c);
console.log(`\n【A】只被写、从不被读的局部变量（${vars.length}）`);
for (const v of vars) console.log(`  ${relative(ROOT, v.file)}:${v.line}  ${v.kind} ${v.name}  (writes@${v.writes.join(',')})`);
// 字段候选按"非动态消费"过滤：动态桶里是 deepEqual 期望值 / 外部工具参数那一类
console.log(`\n【B1】对象字段只声明不被读、且所在对象非动态消费（${propsNonDynamic.length}）`);
for (const p of propsNonDynamic) console.log(`  ${relative(ROOT, p.file)}:${p.line}  ${p.name}`);
console.log(`\n【B2】对象字段只声明不被读，但所在对象被整体消费（${dyn.length}${SHOW_ALL ? '，下面列出' : '，默认不列'}）`);
if (SHOW_ALL) for (const p of dyn) console.log(`  ${relative(ROOT, p.file)}:${p.line}  ${p.name}`);
else console.log('  （多数是 assert.deepEqual 期望值 / spawn 参数 / 桩字段 —— 需人工判，--all 查看）');
console.log(`\n合计候选：A ${vars.length} + B1 ${propsNonDynamic.length} + B2 ${dyn.length} = ${vars.length + propsNonDynamic.length + dyn.length}`);
