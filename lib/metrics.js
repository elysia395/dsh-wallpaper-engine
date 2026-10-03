/**
 * metrics.js — 宿主侧**资源采样器**：把"系统当前的资源值"采成一条 1 Hz 时间序列，
 * 供浏览器端的「硬件资源监控柱状图」扩展取用（读口是 `GET ${BASE}/metrics`，见
 * `lib/routes/metrics.js`）。
 *
 * 为什么值得独立成文件：采样是**进程级状态** —— 一个 1 Hz 定时器、一个常驻
 * `typeperf` 子进程、一段环形历史。它比一次请求活得久（客户端按秒轮询同一个序列），
 * 所以生命周期不能挂在某条路由的局部量上；反过来，路由只是它的读口。放在一个文件里，
 * "谁在跑、什么时候停、失败怎么办"就是一处而不是两处。
 *
 * 数据来源（每条都在本机 Windows 上实测过；标注见下）：
 *   · CPU   `os.cpus()` 的 times 差分 `1 - idleΔ/totalΔ` —— **零子进程**、约 1 ms/次。
 *           首个样本必须有两次快照 ⇒ 启动后第 1 秒才开始出值（照 LiteMonitor 的预热口径）。
 *   · 内存  `os.freemem()` / `os.totalmem()` —— **零子进程**。⚠️ Windows 上
 *           `os.freemem()` = "可用"(Available，含待命/零页列表)，**不是**任务管理器的
 *           "使用中"；本模块报的内存使用率因此**低于**任务管理器看到的值。这是口径差异，
 *           不是 bug（实测：os.freemem() 18.25 GiB ≈ `\Memory\Available Bytes` 18.36 GiB）。
 *   · GPU   常驻 `typeperf` 的 `\GPU Engine(*engtype_3D)\Utilization Percentage`：
 *           按 `luid` 求和、再跨 luid 取最大（= 任务管理器"GPU 3D"的口径）。
 *           实例名里的 `(*engtype_3D)` 是 PDH 实例通配 —— 实测有效，且把列数从全量 `(*)`
 *           的六百多列压到 ~181 列（全量表头一行 ~64 KB / 2.1 s 启动，通配后小得多）。
 *   · 网络  同一条常驻命令的 `\Network Interface(*)\Bytes Total/sec`（各网卡相加）。
 *   · 磁盘  同一条常驻命令的 `\PhysicalDisk(_Total)\% Disk Time`。
 *
 * 不变量：
 *   · **任何一条指标取不到都不许抛**：拿不到就保持上一值 / 该序列返回 null，客户端把
 *     null 当断点。一条坏计数器**不许**拖垮整条 `/metrics`（PDH 的一条坏路径会毒化整个
 *     `Get-Counter`/`typeperf` 调用，所以失败是"整条 PDH 腿退场"，不是"少一列"）。
 *   · **懒启动 + 闲置自停**：`ensure()` 才起定时器；无人请求 30 s 后自己停（连子进程一起）。
 *     装了插件但没开这个扩展的用户，事件循环里不该多一个 1 Hz 定时器。
 *   · PDH 腿**只在 win32 起**（`typeperf` 是 Windows 自带）。其余平台只剩 CPU/内存两行，
 *     客户端按 `avail` 隐藏画不出来的那些序列。
 *   · 起不来（`ENOENT` / 沙箱 `EPERM` / 非 Windows）⇒ 记一次 warn、退场，2 分钟后再试一次；
 *     不重试风暴、不打日志刷屏。
 *   · 一律经注入的 `log`（`lib/log.js`）出话，**不碰 `console`**（`test/verify-logging.mjs` N1）。
 *
 * 与 `typeperf` 的两个实测坑（都写在这里，免得下次再踩）：
 *   ① 启动后第一行数据可能是 `-1`（PDH 的"无数据"哨兵）⇒ 必须丢弃、不能当 0 画；
 *   ② 退出时它会往 stdout 追加**本地化**的完成提示（"正在退出，请稍候..."）⇒ 解析器只认
 *      "第一格像时间戳"的行，其余一律忽略。另外 CSV 的时间戳是区域格式（`10/03/2026`），
 *      有 MM/DD 歧义 ⇒ **丢弃该列，用本机时钟**打时间戳。
 */

import { spawn } from 'node:child_process';
import { cpus, freemem, totalmem } from 'node:os';

/** 采样间隔（ms）。客户端按同一节奏轮询；两处不互通，改这里也要看一眼客户端。 */
export const SAMPLE_INTERVAL_MS = 1000;
/** 环形历史上限（条）。客户端最多只能要这么多 —— 5 分钟 @1 Hz。 */
export const HISTORY_MAX = 300;
/** 无请求多久后自停（ms）：连定时器与 typeperf 子进程一起收掉。 */
export const IDLE_STOP_MS = 30000;
/** PDH 腿失败后的重试间隔（ms）。 */
export const PDH_RETRY_MS = 120000;

/**
 * 序列定义。`scale` = 画满一格对应的值（客户端据此归一化，所以**只在这里定义一次**，
 * 宿主随响应下发）：CPU/内存/GPU/磁盘都是百分比；网络是字节/秒，满格按 100 Mbps 画。
 */
const SERIES = [
  { id: 'cpu', scale: 100 },
  { id: 'mem', scale: 100 },
  { id: 'gpu', scale: 100 },
  { id: 'net', scale: 12500000 },
  { id: 'disk', scale: 100 },
];
/** PDH 腿要采的三个计数器（顺序即列分组顺序；`(*)` 只出现在这两处通配里）。 */
const PDH_GPU = '\\GPU Engine(*engtype_3D)\\Utilization Percentage';
const PDH_NET = '\\Network Interface(*)\\Bytes Total/sec';
const PDH_DISK = '\\PhysicalDisk(_Total)\\% Disk Time';
const PDH_COUNTERS = [PDH_GPU, PDH_NET, PDH_DISK];

/** 取实例名里的 GPU luid（`..._luid_0x00000000_0x0000F9D3_phys_0_...`）。 */
const LUID_RE = /luid_[^_]*_(0x[0-9a-fA-F]+)/;
/** 表头一格的计数器路径属于哪一组。 */
function groupOf(path) {
  if (/GPU Engine\(/i.test(path)) return 'gpu';
  if (/Network Interface\(/i.test(path)) return 'net';
  if (/PhysicalDisk\(/i.test(path)) return 'disk';
  return '';
}
/** 一行 CSV → 单元格（`","` 分隔、外层引号剥掉）。计数器路径里不会出现 `","`。 */
function cells(line) {
  return line.split('","').map((s) => s.replace(/^"|"$/g, '').trim());
}

/**
 * 造一个采样器。返回的对象是**可长期持有**的：`ensure()` 起、闲置自停、`dispose()` 收。
 *
 * @param {{log?:Function, intervalMs?:number}} [opts] `log(text, level)`（缺省吞掉）
 */
export function createMetricsSampler(opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const intervalMs = Number.isFinite(opts.intervalMs) && opts.intervalMs > 0
    ? Math.round(opts.intervalMs)
    : SAMPLE_INTERVAL_MS;

  /** @type {Array<{t:number,cpu:number|null,mem:number|null,gpu:number|null,net:number|null,disk:number|null}>} */
  const history = [];
  /** 只有 CPU/内存永远可用；这三条由 PDH 腿决定。 */
  const avail = { gpu: false, net: false, disk: false };

  let timer = null;
  let disposed = false;
  let lastRequestAt = 0;
  let wantPdh = false;
  let cpuPrev = null;
  let lastSampleAt = 0;

  // ── PDH 腿（常驻 typeperf）────────────────────────────────────────────────
  let pdhState = 'idle'; // idle | starting | running | failed
  let pdhChild = null;
  let pdhRaw = Buffer.alloc(0);
  let pdhCols = null; // { gpu: [{i,luid}], net: [i], disk: [i] }
  let pdhLatest = {}; // 最近一行解析出来的 gpu/net/disk
  let pdhError = '';
  let pdhRetryAt = 0;

  /** 一行处理：表头建列索引 / 数据行取值 / 其余（本地化提示）忽略。 */
  function handleLine(line) {
    const text = line.replace(/^\uFEFF/, '');
    if (!text) return;
    if (text.indexOf('PDH-CSV') >= 0) {
      const cols = cells(text);
      const gpu = [];
      const net = [];
      const disk = [];
      for (let i = 1; i < cols.length; i += 1) {
        const g = groupOf(cols[i]);
        if (g === 'gpu') {
          const m = LUID_RE.exec(cols[i]);
          gpu.push({ i, luid: m ? m[1] : '' });
        } else if (g === 'net') net.push(i);
        else if (g === 'disk') disk.push(i);
      }
      pdhCols = { gpu, net, disk };
      avail.gpu = gpu.length > 0;
      avail.net = net.length > 0;
      avail.disk = disk.length > 0;
      return;
    }
    if (!pdhCols || !/\d[/-]\d/.test(text.slice(0, 24))) return; // 本地化提示 / 半行
    const v = cells(text);
    const num = (i) => {
      const raw = v[i];
      if (raw == null || raw === '') return null;
      const n = Number(raw);
      // `-1` = PDH 的"无数据"哨兵（首个速率样本），必须丢；不能让 0 冒充真实值。
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const sum = (list) => {
      let any = false;
      let acc = 0;
      for (const i of list) {
        const n = num(i);
        if (n == null) continue;
        any = true;
        acc += n;
      }
      return any ? acc : null;
    };
    // GPU：同一 luid 求和、跨 luid 取最大（多显卡时相加会把两块的负载叠成一个假数）。
    if (pdhCols.gpu.length) {
      const per = new Map();
      let any = false;
      for (const { i, luid } of pdhCols.gpu) {
        const n = num(i);
        if (n == null) continue;
        any = true;
        per.set(luid, (per.get(luid) || 0) + n);
      }
      if (any) pdhLatest.gpu = Math.min(100, Math.max(0, Math.max(...per.values())));
    }
    if (pdhCols.net.length) {
      const s = sum(pdhCols.net);
      if (s != null) pdhLatest.net = s;
    }
    if (pdhCols.disk.length) {
      const s = sum(pdhCols.disk);
      // `% Disk Time` 在多盘相加下可以 >100（这是该计数器的已知语义）⇒ 画之前钳到 100。
      if (s != null) pdhLatest.disk = Math.min(100, s);
    }
  }

  /**
   * 增量消费 stdout。**必须按块解码再拆行**：一行 CSV 可能被切成两块，
   * 而"半行"解析出来的数字是错的。编码嗅探 BOM —— 本机实测 PowerShell 重定向会写出
   * UTF-16LE，而 Node 直接 spawn（宿主里的真实路径）是单字节；两种都要能吃。
   */
  function consumePdh() {
    if (!pdhRaw.length) return;
    const utf16 = pdhRaw.length >= 2 && pdhRaw[0] === 0xff && pdhRaw[1] === 0xfe;
    const enc = utf16 ? 'utf16le' : 'utf8';
    const text = pdhRaw.toString(enc);
    const cut = text.lastIndexOf('\n');
    if (cut < 0) return;
    pdhRaw = Buffer.from(text.slice(cut + 1), enc);
    for (const line of text.slice(0, cut).split('\n')) handleLine(line.replace(/\r$/, ''));
  }

  function pdhFail(reason) {
    pdhError = String(reason == null ? '' : reason).slice(0, 200);
    avail.gpu = false;
    avail.net = false;
    avail.disk = false;
    pdhCols = null;
    pdhState = 'failed';
    pdhRetryAt = Date.now() + PDH_RETRY_MS;
    pdhRaw = Buffer.alloc(0);
    if (pdhChild) {
      try { pdhChild.kill(); } catch { /* 已经退了 */ }
      pdhChild = null;
    }
    log('[metrics] PDH 采样腿不可用（GPU/网络/磁盘三条序列将隐藏）：' + pdhError, 'warn');
  }

  function startPdh() {
    if (disposed || pdhState === 'starting' || pdhState === 'running') return;
    if (process.platform !== 'win32') return; // typeperf 只存在于 Windows
    pdhState = 'starting';
    let child;
    try {
      // `-si <秒>`：常驻流水（不给 `-sc` ⇒ 跑到被杀）。stdout 逐行 ~1 Hz flush（实测）。
      child = spawn('typeperf', [...PDH_COUNTERS, '-si', String(Math.max(1, Math.round(intervalMs / 1000)))], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (err) {
      pdhFail(err && err.message);
      return;
    }
    pdhChild = child;
    child.on('error', (err) => { if (pdhState !== 'failed') pdhFail(err && err.message); });
    child.stdout.on('data', (chunk) => {
      if (pdhState === 'starting') pdhState = 'running';
      pdhRaw = Buffer.concat([pdhRaw, chunk]);
      consumePdh();
    });
    child.on('exit', (code) => {
      if (disposed || pdhState === 'failed') return;
      pdhFail('typeperf 退出（code=' + code + '）');
    });
  }

  // ── 采样 ────────────────────────────────────────────────────────────────
  function readCpu() {
    const snap = cpus();
    let idle = 0;
    let total = 0;
    for (const c of snap) {
      const t = c && c.times;
      if (!t) continue;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    if (!cpuPrev) {
      cpuPrev = { idle, total };
      return null; // 预热：差分要两次快照
    }
    const idleDelta = idle - cpuPrev.idle;
    const totalDelta = total - cpuPrev.total;
    cpuPrev = { idle, total };
    if (!(totalDelta > 0)) return null;
    const pct = (1 - idleDelta / totalDelta) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  function readMem() {
    const total = totalmem();
    if (!(total > 0)) return null;
    const free = freemem();
    return Math.min(100, Math.max(0, ((total - free) / total) * 100));
  }

  function tick() {
    const now = Date.now();
    const point = {
      t: now,
      cpu: readCpu(),
      mem: readMem(),
      gpu: avail.gpu && typeof pdhLatest.gpu === 'number' ? pdhLatest.gpu : null,
      net: avail.net && typeof pdhLatest.net === 'number' ? pdhLatest.net : null,
      disk: avail.disk && typeof pdhLatest.disk === 'number' ? pdhLatest.disk : null,
    };
    history.push(point);
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
    lastSampleAt = now;
    // PDH 退场后按退避重试一次 —— 只在确实要它的时候（wantPdh）。
    if (wantPdh && pdhState === 'failed' && now >= pdhRetryAt) startPdh();
    if (wantPdh && pdhState === 'idle') startPdh();
    // 闲置自停：连定时器与子进程一起收掉，别让没开这个扩展的用户白养一个 1 Hz 定时器。
    if (now - lastRequestAt > IDLE_STOP_MS) stop();
  }

  function start() {
    if (disposed || timer) return;
    // 立刻打一次快照（`readCpu` 的首值会是 null）；第一次真实值在 1 个间隔之后。
    cpuPrev = null;
    readCpu();
    history.length = 0;
    timer = setInterval(tick, intervalMs);
    // 定时器不持有事件循环：宿主该退就退，届时 `dispose()` 由插件的 disposers 调用。
    if (typeof timer.unref === 'function') timer.unref();
    if (wantPdh) startPdh();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (pdhChild) {
      try { pdhChild.kill(); } catch { /* 已经退了 */ }
      pdhChild = null;
    }
    pdhRaw = Buffer.alloc(0);
    pdhCols = null;
    pdhLatest = {};
    pdhState = 'idle';
    if (avail.gpu || avail.net || avail.disk) {
      avail.gpu = false;
      avail.net = false;
      avail.disk = false;
    }
  }

  return {
    /**
     * 路由每次读之前调一次：起采样、记账"还有人要"，并按客户端要的序列决定要不要
     * 拉起 PDH 腿（只要 CPU/内存的客户端不该为 GPU 付一个常驻子进程）。
     * @param {{pdh?:boolean}} [opts]
     */
    ensure(o) {
      if (disposed) return;
      lastRequestAt = Date.now();
      if (o && o.pdh) wantPdh = true;
      if (!timer) start();
      else if (wantPdh && pdhState === 'idle') startPdh();
    },
    /** 响应体（给路由直接 `JSON.stringify`）。`n` = 客户端要多少条（钳到 10..HISTORY_MAX）。 */
    payload(n) {
      const want = Math.max(10, Math.min(HISTORY_MAX, Math.round(Number(n) || 60)));
      const from = Math.max(0, history.length - want);
      const samples = history.slice(from);
      return {
        ok: true,
        intervalMs,
        avail: { cpu: true, mem: true, gpu: avail.gpu, net: avail.net, disk: avail.disk },
        series: SERIES.map((s) => ({
          id: s.id,
          scale: s.scale,
          values: samples.map((p) => {
            const raw = p[s.id];
            return typeof raw === 'number' ? Math.round(raw * 1000) / 1000 : null;
          }),
        })),
        pdh: pdhState,
        pdhError,
        lastSampleAt,
      };
    },
    /** 诊断 / 自检用（不进响应体）。 */
    state() {
      return { running: Boolean(timer), samples: history.length, pdh: pdhState, pdhError, avail: { ...avail } };
    },
    /** 插件卸载 / HMR：收定时器与子进程。再调 `ensure()` 不会复活（本对象已废）。 */
    dispose() {
      disposed = true;
      stop();
    },
  };
}
