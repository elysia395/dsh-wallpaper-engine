#!/usr/bin/env node
/**
 * verify-static.mjs —— 静态门禁的**基线棘轮**：ESLint（按规则计数）＋ `tsc --checkJs`（按错误码计数）。
 *
 * ## 为什么是"棘轮"而不是"修到零"
 *
 * 45,000+ 行历史代码一次性清零＝一场无法审查的巨型改动。这里只要求**只能变好**：
 * 每条规则 / 每个 TS 错误码各自有一条计数上限，任一格涨上去即红。
 *
 * 基线按**规则名 / 错误码**聚合，**不按行、不按文件** —— 拆文件会让行号与文件归属全变，
 * 只有"某个码还有多少条"这种计数在重构中稳定，才可能被冻结在提交里。
 *
 * ## 两份不变量，缺一不可
 *
 *   ① **计数上限**（`byRule` / `byCode`）：任一格 `当前 > 基线` ⇒ FAIL。改进（当前 < 基线）
 *      是绿的，但会**提示**你跑 `--write-baseline` 收紧 —— 不收紧就等于把这份改善借给下一次回归。
 *   ② **扫描面下限**（`filesLinted`）：只钉计数会留一个后门 —— 往 `ignores` 里加一条就能
 *      "减少违规"。所以同时钉住 ESLint 实际检查到的文件数不得低于基线。
 *
 * ## 跳过不得与通过同形（DEV-GUIDE §4.7 约定）
 *
 * devDependencies 缺席时（有人 clone 后直接跑、且没 `npm ci`）本守卫无法运行。此时**不**打印
 * `PASSED`，而是打印具名的 `SKIP` 行并以 0 退出 —— 与"真跑过了"在输出上不同形。
 *
 * ## 脚本是唯一真源
 *
 * 本守卫**不硬抄** `eslint .` / `tsc --noEmit -p tsconfig.json`，而是读 `package.json` 的
 * `lint` / `typecheck` 两条脚本、把其中的可执行名换成仓内路径后**原样执行**。于是
 * "门禁跑的命令"与"人跑的命令"不可能漂开；脚本被改成别的工具时当场 FAIL。
 *
 * 用法：`node test/verify-static.mjs`（判据）· `node test/verify-static.mjs --write-baseline`
 * （**唯一写盘分支**：重算并冻结 `test/fixtures/static-baseline.json`）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASELINE = join(ROOT, 'test/fixtures/static-baseline.json');

/** 脚本名 → 仓内可执行文件（跨平台：一律用 `node <js入口>`，不走 .bin 的 shell 包装）。 */
const TOOLS = {
  lint: { tool: 'eslint', entry: 'node_modules/eslint/bin/eslint.js' },
  typecheck: { tool: 'tsc', entry: 'node_modules/typescript/bin/tsc' },
};

/**
 * 读一条 `package.json` 脚本，把可执行名换成仓内路径，返回 `{ entry, args }`。
 * 脚本必须是 `<tool> <args…>` 形状且 `<tool>` 与 `TOOLS` 声明一致 —— 否则判据当场红
 * （换成别的工具就等于门禁换了一门检查，而基线还是旧的）。
 */
function toolInvocation(pkg, key) {
  const spec = TOOLS[key];
  const cmd = String((pkg.scripts || {})[key] || '').trim();
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(cmd);
  if (!m || m[1] !== spec.tool) {
    return { error: '`' + key + '` 脚本为 ' + JSON.stringify(cmd) + '，期望以 `' + spec.tool + ' ` 开头' };
  }
  const entry = join(ROOT, spec.entry);
  if (!existsSync(entry)) return { missing: entry };
  return { entry, args: m[2] ? m[2].split(/\s+/).filter(Boolean) : [] };
}

/** 跑一次工具，返回 stdout（非 0 退出是**预期**的：有违规就有退出码，所以只认"有没有产出"）。 */
function runTool(inv) {
  try {
    return { out: execFileSync(process.execPath, [inv.entry, ...inv.args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) };
  } catch (err) {
    // execFileSync 在非 0 退出时抛异常，但 stdout/stderr 已带出 —— 有违规时这正是正常路径。
    if (err && typeof err.stdout === 'string' && err.stdout.trim()) return { out: err.stdout };
    return { err: String((err && err.message) || err) };
  }
}

/** ESLint `-f json` 载荷 → `{ filesLinted, byRule, fatal }`。 */
function summarizeEslint(json) {
  const reports = JSON.parse(json);
  const byRule = {};
  let fatal = 0;
  for (const f of reports) {
    for (const m of f.messages) {
      if (m.fatal) { fatal++; continue; }
      byRule[m.ruleId || 'unknown'] = (byRule[m.ruleId || 'unknown'] || 0) + 1;
    }
  }
  return { filesLinted: reports.length, byRule, fatal };
}

/** `tsc` 文本输出 → `{ byCode }`（只认 `error TSxxxx`，警告不参与）。 */
function summarizeTsc(text) {
  const byCode = {};
  for (const m of text.matchAll(/error (TS\d+)/g)) byCode[m[1]] = (byCode[m[1]] || 0) + 1;
  return { byCode };
}

/**
 * 棘轮比较：`cur` 不得在任何一格超过 `base`。返回超限项（空数组 = 绿）。
 * 负对照直接喂合成数据给**这个**函数，所以它必须是与主判据同一段代码。
 */
function overBudget(base, cur) {
  const over = [];
  for (const [k, v] of Object.entries(cur)) {
    const b = Object.prototype.hasOwnProperty.call(base, k) ? base[k] : 0;
    if (v > b) over.push(k + ' ' + v + ' > ' + b);
  }
  return over;
}

/** 相对基线**减少**的格（绿色改善；提示重冻结，不判红）。 */
function improvements(base, cur) {
  const down = [];
  for (const [k, b] of Object.entries(base)) {
    const v = Object.prototype.hasOwnProperty.call(cur, k) ? cur[k] : 0;
    if (v < b) down.push(k + ' ' + b + ' → ' + v);
  }
  return down;
}

function main() {
  const writeBaseline = process.argv.includes('--write-baseline');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  const eslintInv = toolInvocation(pkg, 'lint');
  const tscInv = toolInvocation(pkg, 'typecheck');
  if (eslintInv.error || tscInv.error) {
    check('脚本与门禁同一入口：`lint` / `typecheck` 仍是 eslint / tsc', false, eslintInv.error || tscInv.error);
    console.log('\n1 CHECK(S) FAILED');
    process.exit(1);
  }
  if (eslintInv.missing || tscInv.missing) {
    console.log('SKIP | 静态门禁未运行：devDependencies 未安装（' + (eslintInv.missing || tscInv.missing) + '）');
    console.log('SKIP | 这不是通过 —— 跑 `npm ci` 后重试（CI 会装全量 devDependencies）');
    console.log('\nSTATIC GATE SKIPPED (tools missing)');
    process.exit(0);
  }

  const eslintRun = runTool({ ...eslintInv, args: [...eslintInv.args, '-f', 'json'] });
  if (eslintRun.err) { check('ESLint 跑得起来并产出 JSON', false, eslintRun.err); console.log('\n1 CHECK(S) FAILED'); process.exit(1); }
  let lint;
  try { lint = summarizeEslint(eslintRun.out); } catch (err) {
    check('ESLint JSON 可解析', false, String((err && err.message) || err)); console.log('\n1 CHECK(S) FAILED'); process.exit(1);
  }
  const tscRun = runTool(tscInv);
  if (tscRun.err) { check('tsc 跑得起来', false, tscRun.err); console.log('\n1 CHECK(S) FAILED'); process.exit(1); }
  const types = summarizeTsc(tscRun.out);

  if (writeBaseline) {
    const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
    const payload = {
      eslint: { filesLinted: lint.filesLinted, byRule: sorted(lint.byRule) },
      tsc: { byCode: sorted(types.byCode) },
    };
    writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n');
    console.log('已写入 test/fixtures/static-baseline.json：ESLint ' + Object.keys(payload.eslint.byRule).length
      + ' 规则 / ' + payload.eslint.filesLinted + ' 文件 · tsc ' + Object.keys(payload.tsc.byCode).length + ' 错误码');
    process.exit(0);
  }

  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));

  // ① 解析错误是"文件根本没被检查"的形态：它不属于任何规则，也不该被计数上限悄悄容下。
  check('ESLint 无致命解析错误（有解析错误的文件等于没被门禁看见）', lint.fatal === 0,
    lint.fatal === 0 ? '0 条' : lint.fatal + ' 条 fatal');

  // ② 计数上限：每条规则 / 每个错误码各一格。
  const overRules = overBudget(base.eslint.byRule, lint.byRule);
  check('ESLint 每条规则的违规数都不超过基线', overRules.length === 0,
    overRules.length ? '超限=[' + overRules.join(' · ') + ']' : Object.keys(lint.byRule).length + ' 规则，全部 ≤ 基线');
  const overCodes = overBudget(base.tsc.byCode, types.byCode);
  check('tsc 每个错误码的条数都不超过基线', overCodes.length === 0,
    overCodes.length ? '超限=[' + overCodes.join(' · ') + ']' : Object.keys(types.byCode).length + ' 错误码，全部 ≤ 基线');
  check('ESLint 确实扫到了文件（判据不为空集）', lint.filesLinted > 0, lint.filesLinted + ' file(s)');

  // ③ 扫描面下限：只钉计数的话，`ignores` 里加一条就能"减少违规"。
  check('ESLint 的扫描面不低于基线（禁止用 ignores 缩小被检查的文件集）',
    lint.filesLinted >= base.eslint.filesLinted,
    lint.filesLinted + ' / ' + base.eslint.filesLinted);

  // ④ 负对照：把合成数据喂给**主判据用的同一个** overBudget —— 它必须能判红，否则"绿"无意义。
  check('负对照：计数超限 / 新出现的规则名 / 扫描面缩小 都必须被判红',
    overBudget({ a: 1 }, { a: 2 }).length === 1
    && overBudget({ a: 1 }, { a: 1 }).length === 0
    // 基线里没有的规则名 ⇒ 上限视为 0 ⇒ 出现 1 条即超限（新规则不会被"没登记"放过）
    && overBudget({ a: 1 }, { a: 1, brand_new_rule: 1 }).length === 1
    // 改善（当前 < 基线）不得误判成超限
    && overBudget({ a: 3 }, { a: 1 }).length === 0);

  const downRules = improvements(base.eslint.byRule, lint.byRule);
  const downCodes = improvements(base.tsc.byCode, types.byCode);
  if (downRules.length || downCodes.length) {
    console.log('NOTE | 已有改善但基线未收紧（跑 `node test/verify-static.mjs --write-baseline` 冻住它）：');
    for (const d of [...downRules, ...downCodes]) console.log('       ' + d);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (failed.length === 0 ? 'ALL STATIC GATE CHECKS PASSED' : failed.length + ' CHECK(S) FAILED'));
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
