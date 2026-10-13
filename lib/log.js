/**
 * log.js — 宿主侧**日志收口**：三档（`error` / `warn` / `info`）+ 终端镜像。
 *
 * 为什么值得独立成文件：宿主输出收成一个入口，「问题」与「细节」之间才有分界 ——
 * 逐帧统计、心跳、成功事实与真正的故障混在同一条流里，终端默认看到的
 * 是一片噪音。收成一个入口之后，"默认终端只出问题"是一处开关，而不是几十个判断。
 *
 * 档位即 `ctx.logger` 的方法名（不自建数值等级表 —— 平台各档是**包含关系**：
 * `error ⊂ +info ⊂ +warn ⊂ +debug`，用自建阈值表达不出「只看 `warn`、不看 `info`」）：
 *   · `error` —— 会导致**插件 / DSH / 系统**出问题：核心能力起不来、数据/进程被破坏、需用户处理；
 *   · `warn`  —— **影响显示效果**的非正常表现：降级、回退、围栏拒绝、首帧超时、重试、被拒的请求；
 *   · `info`  —— 其余全部：诊断细节、逐帧统计、运行信息、成功事实的**日志侧**留痕。
 *
 * 一次调用喂两个出口：
 *   ① 平台通道 `ctx.logger[level](line)` —— DSH Desktop 的宿主把 `FileExporter` 挂在
 *      `ctx.logger` 上（`levels = { default: 3 }`，自身 threshold `info`），所以 `warn` 会落进
 *      `dsh-<date>.error.log`；本 profile 未挂 console exporter ⇒ 平台不会重复打到终端。
 *   ② 终端镜像 —— `error` / `warn` 默认可见，`info` 只在 `DSH_WE_LOG_LEVEL=info` 时可见。
 *      这一层是本模块自己的：平台的 exporter 只负责落档，不负责"默认终端安静"。
 *
 * 不变量：
 *   · **`lib/**` 里只有本模块与 `lib/notice.js` 允许直接调用 `console.*` / `process.stdout`**，
 *     其余宿主模块一律经它们（`test/verify-logging.mjs` 的 N1 把这条变成机器事实）。
 *   · 档位名与 `ctx.logger` 的方法名一一对应，**不自建数值等级表**。
 *   · `info` 永远不面向用户：默认不进终端，也不进提示通道（提示通道见 `lib/notice.js`）。
 *   · 任何一次写入失败（平台通道抛错 / 终端抛错）都**不得**改变调用点的控制流，也不上抛。
 *
 * 闸门：`DSH_WE_LOG_LEVEL` ∈ {`error`, `warn`, `info`}（大小写不敏感、忽略空白），默认 `warn`；
 * 非法值按默认走。每次调用现读环境变量 —— 闸门是一次性的进程级开关，不是"模块被 import 的
 * 那一刻"的隐式快照。
 */

/** 三档：字面量与 `ctx.logger` 的方法名同形（D3）。顺序 = 严重度递增。 */
const LEVELS = ['error', 'warn', 'info'];
/** 严重度名次：越小越严重。终端镜像的判据是"消息名次 ≤ 闸门名次"。 */
const RANK = { error: 0, warn: 1, info: 2 };
/** 缺省闸门：`warn` ⇒ 终端只镜像 `error` + `warn`。 */
const DEFAULT_LEVEL = 'warn';

/** 当前闸门（现读环境变量；非法值回落缺省）。 */
function gateRank() {
  const raw = String(process.env.DSH_WE_LOG_LEVEL || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANK, raw) ? RANK[raw] : RANK[DEFAULT_LEVEL];
}

/**
 * 日志入口的**形状**：可调用（`log(text, level?)`）＋ `error` / `warn` / `info` 三档 ＋ `tag(child)`。
 *
 * 为什么要显式写出来：三档是 `for (const level of LEVELS) log[level] = …` **动态挂**上去的，
 * TS 只能从赋值表达式推出「可调用 + `tag`」，推不出 `error/warn/info`
 * ⇒ 凡是把 `log` 当依赖注入的宿主模块，一写 `log.warn(…)` 就报 TS2339 / TS2559 / TS2554
 * （`lib/index.js` 的 `log.info(...)` 运行期一直是好的，缺的只是类型）。
 * 本 typedef 是该形状的**唯一真源**：`lib/**` 各工厂的 JSDoc 一律写 `import('./log.js').LogFn`，
 * 不要在各调用点重复手写形状、也不要在调用点做局部强转。
 *
 * @typedef {((text:any, level?:string) => void) & {
 *   error:(text:any) => void,
 *   warn:(text:any) => void,
 *   info:(text:any) => void,
 *   tag:(child:string) => LogFn,
 * }} LogFn
 */

/**
 * 造一个日志入口。返回**可调用**对象：`log(text, level?)` 与 `log.error/warn/info(text)`
 * 同义（前者给"调用点自带级别变量"的地方用，后者给字面量级别用）。
 *
 * @param {{error?:Function,warn?:Function,info?:Function}|null} logger 平台 logger（`ctx.logger(name)`）
 * @param {string} name 终端前缀里的名字（`[<name>]`）
 * @param {string} tag  可选子标签（`[<name>][<tag>]`），由 `log.tag(tag)` 派生
 * @returns {LogFn} 形状见上文 `LogFn`（`lib/**` 的依赖注入一律引用它）
 */
export function createLog(logger, name, tag = '') {
  const prefix = '[' + name + ']' + (tag ? '[' + tag + ']' : '');

  function write(level, text) {
    const line = prefix + ' ' + String(text == null ? '' : text);
    // ① 平台通道（落档；本 profile 没有 console exporter，不会重复打到终端）
    try {
      const method = logger && logger[level];
      if (typeof method === 'function') method.call(logger, line);
    } catch { /* 平台通道失败不影响终端镜像，也不上抛 */ }
    // ② 终端镜像：只有"名次 ≤ 闸门"的档位可见（默认 = error + warn）
    if (RANK[level] <= gateRank()) {
      try { console[level](line); } catch { /* 终端不可写（管道已关等）不是调用点的错 */ }
    }
  }

  const levelOf = (level) => (LEVELS.includes(level) ? level : 'info');

  const log = (text, level) => write(levelOf(level), text);
  // 三档**显式**挂上（原先是 `for (const level of LEVELS) log[level] = …` 动态挂）：
  // 动态挂的属性 TS 推不出来，会让 `return log` 不满足上面的 `@returns {LogFn}`。
  // 形状的唯一真源仍是 `LogFn`；档位名仍来自 `LEVELS`（`levelOf` 用同一张表校验）。
  log.error = (text) => write('error', text);
  log.warn = (text) => write('warn', text);
  log.info = (text) => write('info', text);
  /** 派生子标签入口：`log.tag('media')` ⇒ 行前缀 `[<name>][media]`。 */
  log.tag = (child) => createLog(logger, name, child);
  return log;
}

/**
 * 「只调用」的日志契约：模块**只把 log 当回调调**（`log(text, level?)`）时的形参类型。
 *
 * 与 `LogFn` 的分工：`LogFn` 是 `createLog()` 的**完整返回对象**（宿主注入、需要
 * `.error/.warn/.info/.tag` 时用它）；`LogCall` 只声明**被调用面**，所以工厂里
 * `log = () => {}` 这种零参缺省、单测里的 `log: (m) => …`、探针里的
 * `(msg) => console.log(…)` 都合法 —— 它们从不读那四个方法。
 * 收成 `LogFn` 会把这些合法实现判成类型错（并逼出「往调用点加挂四个空方法」的噪音）。
 *
 * @typedef {(text:any, level?:string) => void} LogCall
 */
