#!/usr/bin/env node
/**
 * 只读审计：`test/**` 里「只被写、从不被读」的局部变量与对象字段。
 *
 * ## 为什么是审计工具，不是守卫（Lead 裁定，task-11 ①）
 * 这条规则**现在还不是机械可判的**：实测有四大类结构性假阳，靠豁免名单撑起来的守卫会把
 * "红"变成维护负担，而本仓的门禁纪律是"只收机械可判的判据"（docs/DEV-GUIDE.md §4.8）。
 * 假阳（都是"读"发生在 AST 之外，静态引用面看不见）：
 *   ① **外部工具参数**：`spawn(..., { stdio, detached, windowsHide })` / `npm_config_cache` /
 *      `vm.Script` 的 `filename` / `Cookie` / `Origin` / CDP 参数 —— 消费者是子进程或原生层。
 *   ② **期望值字面量**：`assert.deepEqual(x, { beforeOpen: 1 })` —— 字面量整体被比较函数读。
 *   ③ **只作身份标记的桩字段**：`{ _interval: true }` —— 判据只 `typeof`/真值判定，从不按名取。
 *   ④ **DOM/框架桩完整性字段**：`{ cssText, baseVal, innerHTML }` / `{ createPortal }` /
 *      `React.createRef` —— 桩在建模"模块接口/DOM 语义"，消费者是被测代码或未来的调用路径。
 *   ⑤ **打印/序列化边界**：字段进 `JSON.stringify` / `console.log` / `--json` 载荷 ——
 *      消费者是"把那段文字读出来的人或外部工具"，不是仓库里的任何标识符。
 *   ⑥ **喂给被测代码的数据字面量**：fixture / payload / settings 形状（`Object.assign` 后进沙箱、
 *      作为桩响应体、当表达式求值器的变量域）—— 消费者是 SUT 运行期，按名读发生在 SUT 里，
 *      常是**动态键遍历**（`Object.keys/values/entries`、`for…of`、`[变量]`）。
 *
 * ## task-13 判定结论：窄桶当前为空 ⇒ 守卫无当下牙口
 * 把 B1 全部 46 条逐条判完（清单见下），**没有一条**能落进"机械可判且当下非空"的窄桶：
 *   · ①×5 `test/warn-only.mjs:42-44`（`stdio`/`windowsHide`，`spawnSync` 的 opts，经 `[name, opts]`
 *     表 + 数组解构流到 spawn）· ②×1 `test/verify-client.mjs:2993`（`dispatchKey()` 的返回对象被
 *     `assert.deepEqual` 比）· ③×4 `_interval`（`setInterval` 句柄，交回 `clearInterval`）·
 *     ④×9 `createPortal`×7 + `verify-scene-live.mjs:3082 createRef` + `verify-client.mjs:5056 baseVal`
 *     （框架/DOM 桩面；`lib/client.js` 里 `createPortal` 只出现在一句注释里 ⇒ 产品确实不调它）·
 *     ⑤×5 `test/run-guards.mjs:195 command` · `test/tools/guard-targets.mjs:209 fanIn`（`--list-json`/
 *     `--json` 是文档化的机器面）· `verify-scene-live.mjs:4511/:4532/:4539`（`legacyDepthOut`/
 *     `overScanOut` 在 `:4572-4573` 被 `JSON.stringify` 打进判据 detail）·
 *     ⑥×22（`verify-fontset` 的 `buildAppearance()` 返回体经 `flatten()` 的 `Object.keys` 遍历、
 *     `boxDecl()` 返回体经 `Object.values/entries`、`verify-glass-surfaces` 的 `mode(on)` 经
 *     `Object.assign` 进沙箱与 `({…})[f]` 负对照、`verify-theme-layer.mjs:349 caption` 经 SUT 遍历角色键、
 *     `verify-i18n.mjs:598 locales` 快照形状、`verify-picker-props.mjs:312 hasProject` payload 契约、
 *     `verify-client.mjs:4008 str` 求值器变量域、`verify-scene-live.mjs:4485` 深度表）。
 * 残差两条**真**死状态（task-13 第二步的处置，已按 Lead 裁定办）：
 *   · `test/verify-scene-live.mjs:4813 onAvatarName` —— **已删**：真实调用点（`src/client.js:3988`）与岛
 *     （`src/ext-avatar.js:123` 的解构）都只取 5 个 `onAvatar*`，全仓再无 `onAvatarName`；
 *     删后 `verify-scene-live` 改前/改后 exit 0 + 末行 `ALL SCENE-LIVE CHECKS PASSED (642)` 逐字一致。
 *   · `test/verify-scene-live.mjs:4980 avatarUserName` —— **保留**：这是有意喂给 SUT 的**未知字段**
 *     （`src/avatar-layer.js:268/275/276` 只按名读 enabled/size/radius），同一条 check 里断言节点
 *     仍只有一枚 `.we-avatar__glyph` 子节点 ⇒ "设置里多一个名字字段也不会长出名字节点"。
 *     行内有理由注释；补齐 7 条动态边界后它归入 `global-assign`（`globalThis.selection = {…}`）。
 * ⇒ 收盘时 **B1 的真死残差 = 0**（剩下的 8 条全是六类结构性假阳）；立守卫只能靠"同形于合法
 *    夹具字段"的白名单：**不机械可判**，故按牌面"停手报我"走，不建 `verify-write-only-state.mjs`。
 *
 * ## 动态判定边界（task-13 第二步：7 条已全部补齐；`--all` 会逐条打出 reason）
 *   reason 字符串 ← 缺口；单独禁用任一条做实验即可看它消掉了哪些候选（括号里是本刀实测）：
 *   ① `computed-key-member`：`({…})[变量]` 直接按变量取键（消掉 `conversation`×3）。
 *   ② `call-arg` / `whole-object-call`：`return {…}` **追调用点**，按返回值的消费方式判
 *      （消掉 16 条：`colors.roles` 一族、`boxDecl` 五个 CSS 点号键、`afterOpen`、`fanIn`、
 *      `floaters`、`hasProject`…）。
 *   ③ `handler-map`：混合 ctx（`{ sel, onX: () => {} }`）也算桩上下文（与 ⑦ 联动消掉 `createPortal`×7）。
 *   ④ 变量/赋值跟随引擎：先绑变量，之后再 `JSON.stringify(变量)` / 进实参 / 按变量取键都算消费。
 *      本刀新增的是**赋值目标**跟随（`:4511 elapsed`、`:4539 styled` 这类先 `let x;` 后 `x = {…}`）。
 *      注意：整条引擎禁用会把 B1 从 8 顶回 135 —— 它是基数，不只是"新增的那两条"。
 *   ⑤ `array-collection`：数组当集合交出去（`[name, opts]` 表 + `.filter(([, opts]) => …)`、
 *      `for (const [a, b] of T)`）⇒ 元素一律算动态（消掉 `stdio`×3 + `windowsHide`×2）。
 *      **粗粒度**：不区分元素下标 —— 宁可少报，也不把"其实被消费了"的字段报成写而不读。
 *   ⑥ `global-assign`：`globalThis.<obj> = {…}`（含 `process.env.*`）夹具（消掉 `avatarUserName`、
 *      `@audit/styled`）。
 *   ⑦ 分支 / 短路 / 逗号传递：`cond ? { a } : { b }`、`x || {…}`、`(a, {…})` 继续上爬同一条链
 *      （`createPortal`×7 的桩对象正是三元产物；单独禁用 ⑦ ⇒ B1 回到 15）。
 *   **可信边界**：只有上面 7 条全部为"已闭"时，"零命中"才可采信（读面无洞 + 动态面不漏）。
 *   本刀补完后 B1 = 8 条（`command` · `baseVal` · `locales` · `_interval`×4 · `caption`），全部是
 *   六类结构性假阳；真死残差 0。
 *   **读面靠 sourceType 回退才不漏**（实测，2026-10）：`:218` 对每个文件依次试 `['module',
 *   'commonjs']`。读面 225 个文件里 216 个只能按 `module` 解析、**恰好 1 个只能按 `commonjs`
 *   解析 = `src/client.js`**（尾部 `inject = inject;\nreturn module.exports;\n`；按 `module` 解析
 *   会抛 `'return' outside of function` 且收集到 **0** 个名字，按 `commonjs` 解析得 349 个成员名 +
 *   991 个裸名，含 `selection` / `setTransient`）。没有这个回退就会整体漏掉 hub 这个**最大消费面**
 *   ⇒ 那一版读数多出 148 条假候选（把真被消费的字段报成"写而不读"）。
 *   同理 **`零命中` 只有读面无洞时才可采信**：读面回退一旦被摘掉，本工具的"零真死"结论立刻失效。
 *
 * ## 边界：本工具只扫 `test/**`（`src/**` 的同类扫描必须换读面）
 * `src/**` 是构建期内联成**一个作用域**的，单文件 `eslint-scope` 天生看不见跨文件读
 * （`dict[key]`、`{…}[k]` 这类按变量取键）。client-refactor 的实测读数：`src/**` 扫出
 * B1 **1000** 条，其中 **925 条是 i18n 字典的 `dict[key]` 跨文件取键**、其余 75 条里多数同形
 * ⇒ 换读面前不要用本工具扫 `src/**`（绝大多数是假阳）。本工具的候选面 = `test/**`、
 * 读面 = `test/` + `lib/` + `src/` + `scripts/`，故 `src/**` 的跨文件读对它不是盲区。
 *
 * ## 将来要升级成守卫的前置条件（三条都要满足）
 *   1. 上面六类假阳能**机械判定**，且上述 7 条动态边界全部为"已闭"，不依赖人工豁免名单；
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
// 每个 reason 字符串对应文件头清单里的一条已知边界；`--all` 会把它打出来 ⇒ "谁把它消掉的"可追溯。
const GLOBAL_ROOTS = new Set(['globalThis', 'window', 'global', 'self']);
const GLOBAL_CONTAINERS = new Set(['process', 'globalThis']);
const WHOLE_OBJECT_CALLEES = new Set(['Object.keys', 'Object.values', 'Object.entries', 'Object.fromEntries',
  'Object.assign', 'Object.freeze', 'Object.getOwnPropertyNames', 'JSON.stringify',
  'assert.deepEqual', 'assert.deepStrictEqual']);

function calleeName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier'
    && callee.property.type === 'Identifier') return callee.object.name + '.' + callee.property.name;
  return '';
}

function isFunctionValue(node) {
  return node && (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression');
}

function isHandlerMap(obj) {
  // 爬到链条末端时 `node` 可能已经不是对象字面量了（调用表达式、赋值目标…）⇒ 先判类型
  if (obj.type !== 'ObjectExpression' || !obj.properties.length) return false;
  if (!obj.properties.every((p) => p.type === 'Property' && !p.computed)) return false;
  if (!obj.properties.some((p) => isFunctionValue(p.value))) return false;
  // ③ 混合 ctx：`{ sel, onAvatarPick: () => {} }` —— 函数值 + 标量/标识符都算"交给被测代码的桩上下文"
  return obj.properties.every((p) => isFunctionValue(p.value) || p.value.type === 'Identifier' || p.value.type === 'Literal');
}

function refsByName(sourceCode, name) {
  const out = [];
  const manager = sourceCode.scopeManager;
  if (!manager) return out;
  for (const scope of manager.scopes) {
    for (const v of scope.variables) {
      if (v.name !== name) continue;
      for (const ref of v.references) out.push(ref.identifier);
    }
  }
  return out;
}

function isGlobalTarget(left) {
  if (!left || left.type !== 'MemberExpression') return false;
  const obj = left.object;
  if (obj.type === 'Identifier') return GLOBAL_ROOTS.has(obj.name);
  if (obj.type === 'MemberExpression' && !obj.computed && obj.object.type === 'Identifier'
    && obj.property.type === 'Identifier') return GLOBAL_CONTAINERS.has(obj.object.name);
  return false;
}

// ④ 绑到变量/赋给变量之后再被整体消费；② 追调用点时也走这里。
function followVariable(name, sourceCode, seen, depth) {
  if (depth > 2) return null;
  for (const id of refsByName(sourceCode, name)) {
    const p = id.parent;
    if (!p) continue;
    if ((p.type === 'CallExpression' || p.type === 'NewExpression') && p.callee === id) {
      const r = consumptionReason(p, sourceCode, seen, depth);
      if (r) return r;
      continue;
    }
    if (p.type === 'ForOfStatement' && p.right === id) return 'array-collection'; // ⑤ 迭代 + 解构成对
    const r = consumptionReason(id, sourceCode, seen, depth);
    if (r) return r;
  }
  return null;
}

// 从一个"值"往上爬，判它是不是被整体消费（进实参 / 被 Object.keys|JSON.stringify 吃 / 按变量取键…）。
function consumptionReason(node, sourceCode, seen, depth) {
  let cur = node;
  for (let hop = 0; cur && hop < 5; hop += 1) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const p = cur.parent;
    if (!p) return null;
    if (p.type === 'ConditionalExpression' && (p.consequent === cur || p.alternate === cur)) { cur = p; continue; }
    if (p.type === 'LogicalExpression' && (p.left === cur || p.right === cur)) { cur = p; continue; }
    if (p.type === 'SequenceExpression') { cur = p; continue; }
    if (p.type === 'Property' && p.value === cur) { cur = p.parent; continue; }
    if (p.type === 'ArrayExpression') { cur = p; continue; }
    if (p.type === 'CallExpression' || p.type === 'NewExpression') {
      if (!p.arguments.includes(cur)) return null;
      return WHOLE_OBJECT_CALLEES.has(calleeName(p.callee)) ? 'whole-object-call' : 'call-arg';
    }
    if (p.type === 'SpreadElement') return 'spread';
    if (p.type === 'MemberExpression' && p.object === cur && p.computed) return 'computed-key-member';
    if (p.type === 'VariableDeclarator' && p.init === cur && p.id.type === 'Identifier') {
      return depth >= 2 ? null : followVariable(p.id.name, sourceCode, seen, depth + 1);
    }
    if (p.type === 'AssignmentExpression' && p.right === cur && p.left.type === 'Identifier') {
      return depth >= 2 ? null : followVariable(p.left.name, sourceCode, seen, depth + 1);
    }
    return null;
  }
  return null;
}

// ② 追调用点：`fn()` 的返回值怎么被消费，就等于 `return {…}` 的对象怎么被消费。
function returnedReason(node, sourceCode, seen, root) {
  for (let fn = node.parent; fn; fn = fn.parent) {
    if (fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression' || fn.type === 'ArrowFunctionExpression') {
      const name = functionName(fn);
      if (!name) break;
      for (const id of refsByName(sourceCode, name)) {
        const p = id.parent;
        if (!p) continue;
        if ((p.type === 'CallExpression' || p.type === 'NewExpression') && p.callee === id) {
          const r = consumptionReason(p, sourceCode, seen, 1);
          if (r) return r;
        }
      }
      break;
    }
  }
  return isHandlerMap(root || node) ? 'handler-map' : null;
}

function functionName(fn) {
  if (fn.id && fn.id.name) return fn.id.name;
  const p = fn.parent;
  if (!p) return null;
  if (p.type === 'VariableDeclarator' && p.init === fn && p.id.type === 'Identifier') return p.id.name;
  if (p.type === 'Property' && p.value === fn && p.key.type === 'Identifier') return p.key.name;
  if (p.type === 'AssignmentExpression' && p.right === fn && p.left.type === 'Identifier') return p.left.name;
  return null;
}

function dynamicReason(node, sourceCode, seen = new Set()) {
  const root = node; // ⑦ 分支传递后 cur 会漂走，判 handler-map 要用最初那个对象字面量
  let cur = node;
  for (let hop = 0; cur && hop < 8; hop += 1) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const p = cur.parent;
    if (!p) return null;
    if (p.type === 'Property' && p.value === cur) { cur = p.parent; continue; } // 嵌套对象 ⇒ 看外层
    if (p.type === 'SpreadElement') return 'spread';
    // ⑦ 分支 / 短路 / 逗号表达式的传递（`cond ? { a } : { b }`、`x || {…}`、`(a, {…})`）
    if (p.type === 'ConditionalExpression' && (p.consequent === cur || p.alternate === cur)) { cur = p; continue; }
    if (p.type === 'LogicalExpression' && (p.left === cur || p.right === cur)) { cur = p; continue; }
    if (p.type === 'SequenceExpression') { cur = p; continue; }
    if (p.type === 'ArrayExpression') {
      const ap = p.parent;
      // ⑤ 数组 = 集合：元素会被迭代 / 解构成对 / 交给高阶回调（`[name, opts]` 表 + `.filter(([, opts]) => …)`）
      const handedOver = ap && (ap.type === 'CallExpression' || ap.type === 'NewExpression' || ap.type === 'ForOfStatement'
        || (ap.type === 'MemberExpression' && ap.parent
          && (ap.parent.type === 'CallExpression' || ap.parent.type === 'NewExpression')));
      if (handedOver) return 'array-collection';
      cur = p; continue;
    }
    if (p.type === 'ObjectExpression') { cur = p; continue; }
    if (p.type === 'CallExpression' || p.type === 'NewExpression') {
      if (p.arguments.includes(cur)) {
        return WHOLE_OBJECT_CALLEES.has(calleeName(p.callee)) ? 'whole-object-call' : 'call-arg';
      }
      cur = p; continue;
    }
    if (p.type === 'ReturnStatement' || (p.type === 'ArrowFunctionExpression' && p.body === cur)) {
      return returnedReason(cur, sourceCode, seen, root);
    }
    if (p.type === 'AssignmentExpression' && p.right === cur) {
      if (p.left.type === 'MemberExpression') return isGlobalTarget(p.left) ? 'global-assign' : null; // ⑥
      if (p.left.type === 'Identifier') {
        return followVariable(p.left.name, sourceCode, seen, 1) || (isHandlerMap(root) ? 'handler-map' : null);
      }
      return null;
    }
    if (p.type === 'VariableDeclarator' && p.init === cur && p.id.type === 'Identifier') {
      return followVariable(p.id.name, sourceCode, seen, 1) || (isHandlerMap(root) ? 'handler-map' : null);
    }
    if (p.type === 'MemberExpression' && p.object === cur && p.computed) return 'computed-key-member'; // ①
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
const reasonTally = new Map();
for (const p of dyn) reasonTally.set(p.dyn, (reasonTally.get(p.dyn) || 0) + 1);
console.log(`\n【B2】对象字段只声明不被读，但所在对象被整体消费（${dyn.length}${SHOW_ALL ? '，下面列出' : '，默认不列'}）`);
console.log('  按边界分类：' + [...reasonTally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' · '));
if (SHOW_ALL) for (const p of dyn) console.log(`  ${relative(ROOT, p.file)}:${p.line}  ${p.name}  ← ${p.dyn}`);
else console.log('  （多数是 assert.deepEqual 期望值 / spawn 参数 / 桩字段 —— 需人工判，--all 查看）');
console.log(`\n合计候选：A ${vars.length} + B1 ${propsNonDynamic.length} + B2 ${dyn.length} = ${vars.length + propsNonDynamic.length + dyn.length}`);
