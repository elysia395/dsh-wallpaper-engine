/**
 * 壁纸媒体源（独立 loopback 监听）＋ 适配器形态观测。
 *
 * 本模块把这批状态收进一个**显式依赖**的工厂。这批状态（媒体 token 与媒体源地址）**必须与
 * `/inventory` 同作用域** —— 扫描链与路由都要用它，是门面无法收缩的主要单点耦合。调用方在
 * `apply()` 里构建一次，拿回访问器供扫描链、`/inventory`、`/settings`、诊断族与场景载荷族共用。
 *
 * 纪律：`mediaOrigin` 与 `mediaDiagHandler` 都是**本模块的可变量**（前者懒启动、
 * 后者由 `registerDiagRoutes` 的出参稍后武装），所以跨模块**只以访问器形式**提供 ——
 * 把 `mediaOrigin.port` 的值拷进 context 会永远报 null（`/inventory` 只需要
 * `mediaOriginBase()`；端口只有诊断路由用）。
 */
import { createServer } from 'node:http';
import { ADAPTER_TARGET_VALUES } from './settings-schema.js';

/**
 * @param {object} deps
 * @param {string} deps.base               请求前缀（`BASE`）。
 * @param {import('./log.js').LogFn} deps.log 宿主日志（本模块**用全形状**：会直接调 `log.error(...)`）。
 * @param {Function} deps.notice           提示通道（成功事实不写日志，走这里）。
 * @param {Function} deps.appendDiagLine   诊断环写入。
 * @param {Array} deps.disposers           卸载回卷登记表（媒体源关闭钩子推进去）。
 * @param {Function} deps.handleSceneFiles `/scene-files` 处理函数（媒体源复用同一段逻辑）。
 * @param {Function} deps.readSettings     读设置（`adapterTarget` 手选值）。
 */
export function createMediaOrigin({ base, log, notice, appendDiagLine, disposers, handleSceneFiles, readSettings }) {
  // ---------------------------------------------------------------------------
  // 3c-0. 适配器：宿主形态观测（判定与操作系统无关 —— 只读请求头与 UA）。
  //
  // 三档的事实来源：
  //   · 能力头 `x-dsh-desktop-renderer` ⇒ 带栅栏的桌面端。该头由**社区壳**
  //     注入（DSH Desktop.app 的 desktop-browser-access 分片）；官方
  //     DeepSeek Harness.app 的 app.asar 里该字面量零命中 —— 所以"有栅栏"判给
  //     社区端，而不是按 app 名望文生义。
  //   · UA 含 `Electron/` ⇒ 桌面壳。官方与社区都是 Electron，这一档只负责把
  //     「桌面壳」与「原生浏览器」分开，分不了官民。
  //   · 两者皆无 ⇒ 原生浏览器。
  // 两把闩锁**只增不减**：首帧之前可能先来一条非渲染器请求（探活、命令行），
  // 它不该把已经判明的桌面端改回浏览器 —— 而错判成浏览器的代价是网页壁纸 403。
  // 手选（settings.adapterTarget，见 lib/settings-schema.js）优先于观测。
  // ---------------------------------------------------------------------------
  let adapterFenceSeen = false;
  let adapterShellSeen = false;
  let adapterOverride = 'auto';
  function observeAdapter(req) {
    const headers = (req && req.headers) || {};
    if (headers['x-dsh-desktop-renderer'] !== undefined) adapterFenceSeen = true;
    const ua = headers['user-agent'];
    if (typeof ua === 'string' && /Electron\//i.test(ua)) adapterShellSeen = true;
    const s = readSettings();
    const picked = s && typeof s.adapterTarget === 'string' ? s.adapterTarget : 'auto';
    adapterOverride = ADAPTER_TARGET_VALUES.includes(picked) ? picked : 'auto';
  }
  /** 观测目标（与客户端 src/adapter.js 的判定表同一套字面量）。 */
  function adapterDetectedTarget() {
    if (adapterFenceSeen) return 'desktop-community';
    if (adapterShellSeen) return 'desktop-official';
    return 'browser';
  }
  /** `/settings` 的 `adapter` 段：观测到的形态 + 手选后的生效值。 */
  function adapterState() {
    return {
      detected: adapterDetectedTarget(),
      fence: adapterFenceSeen,
      target: adapterOverride !== 'auto' ? adapterOverride : adapterDetectedTarget(),
    };
  }
  /** 网页壁纸载荷要不要走独立媒体源。`/media-origin` 是显式探测，不经这条。 */
  function mediaOriginNeeded() {
    if (adapterOverride === 'browser') return false;  // 手选浏览器：显式走应用源
    if (adapterOverride !== 'auto') return true;      // 手选桌面：恒走独立源
    return adapterFenceSeen || adapterShellSeen;      // 自动：观测到桌面形态才需要
  }

  // 3c-3a. 壁纸媒体源：独立 loopback 监听（壁纸载荷的落点）。
  //
  // 为什么需要第二个源 —— DSH Desktop 给**每一个**插件路由套了能力头栅栏
  //（desktop-browser-access 分片 → decideDesktopBrowserAccess：请求必须带
  // x-dsh-desktop-renderer，而该头只由 Electron 主进程注入给「frame.origin === 应用源
  // 且顶层 frame 同源」的请求）。网页壁纸按设计必须跑在 sandbox="allow-scripts" 的
  // 不透明源里：它的 frame.origin 是 "null"，永远拿不到这个头 —— 于是入口 HTML 一律
  // 403 Forbidden，服务端连一行请求日志都不会有（表现为预览图先正常、随后整块黑掉）。
  // 增强模式下普通浏览器访问也不可用（desktopBrowserAccessAvailable 只认兼容模式），
  // 唯一干净的出路是让壁纸载荷根本不经过宿主插件路由：我们自己在 127.0.0.1 上再监听
  // 一个随机端口，只服务 /scene-files/<token>/…，行为与同源那条完全一致（同一段处理
  // 函数：两层目录围栏 / CORS / shim+seed 注入 / Range）。顺带的好处是第三方 HTML 连
  // 「同源」都不再沾边，沙箱之外又多一层隔离。
  // **场景壁纸也走这条**：100–336MB 的 `scene.pkg` 走应用源那条路挤不过
  // 首帧预算（15 秒里还要买纹理解码与 shader 编译），把它的载荷也指向自建源即可。
  // 这条源的根路径 `/diag` 也要接（渲染页的诊断信标打的是 `{mediaBase origin}/diag`），
  // 否则 mediaBase 一指过来，渲染页的告警就 404 静默丢掉 —— 见下面的 `mediaDiagHandler`。
  let mediaOrigin = null;       // { server, port, base }
  let mediaOriginTask = null;
  let mediaOriginDead = false;  // 起过一次就不反复试（否则每次 inventory 都重试绑定）
  /**
   * 诊断族的根路径处理器（`routes/diag.js` 的 `handleDiag`），由 `registerDiagRoutes` 的**出参**
   * `onHandleDiag`（3c-7）武装。**为什么是一个可变量而不是常量**：媒体源（3c-3a）先创建、
   * 诊断族（3c-7）随后注册，两者在同一次 `apply` 内先后发生；而这个闭包只在**请求时**读它
   * （媒体源是按需懒启动的，任何请求都晚于 `apply` 返回）⇒ 读到的一定是已武装的值。
   * 传值会把 null 快照带进闭包。
   */
  let mediaDiagHandler = null;
  function mediaOriginBase() {
    // 适配器门控：**网页壁纸**的独立源只为「能力头栅栏」存在（栅栏只在桌面壳里）。
    // 原生浏览器没有栅栏 ⇒ 网页载荷走应用源相对路径即可，不必多开一个 loopback 监听。
    // 观测与手选都由 observeAdapter 收敛到 mediaOriginNeeded（见 3c-0）。
    // ⚠️ **场景载荷不走这条门控**（见 ensureSceneMediaOrigin）：它要独立源的理由是带宽。
    if (!mediaOriginNeeded()) return Promise.resolve('');
    return ensureMediaOrigin().then((m) => (m ? m.base : ''));
  }
  /**
   * 场景载荷的源（`/inventory` 的 `sceneMediaBase`）。
   *
   * **与适配器形态无关**：`scene.pkg` 动辄 100–336MB，走应用源（DSH 的插件路由）那条路
   * 实测会饿死（同一份 336MB 包，应用源上出现 15–74s 甚至永不返回的传输；媒体源上 0.6s），
   * 而首帧预算是墙钟 15s ⇒ 大场景壁纸被误判成"渲染不出来"并写进全局失败记忆。
   * 带宽是**所有形态**都成立的物理约束，所以这里直接懒起媒体源（仍然只在库里真有
   * `sceneLive` 时调用，且失败返空串回落应用源）。
   */
  function ensureSceneMediaOrigin() {
    return ensureMediaOrigin().then((m) => (m ? m.base : ''));
  }
  function ensureMediaOrigin() {
    if (mediaOrigin) return Promise.resolve(mediaOrigin);
    if (mediaOriginDead) return Promise.resolve(null);
    if (mediaOriginTask) return mediaOriginTask;
    mediaOriginTask = new Promise((done) => {
      const unavailable = (cause) => {
        const msg = cause instanceof Error ? cause.message : String(cause);
        // error：这不是优雅降级 —— 网页壁纸在 Desktop 上会直接 403（`ensureMediaOrigin`
        // 上方那段注释说明了能力头栅栏），也就是该形态的核心能力不可用。
        log.error(`壁纸媒体源不可用（网页壁纸回落应用源；Desktop 上会 403）：${msg}`);
        appendDiagLine('media-origin', { base: null, error: msg.slice(0, 160) });
        mediaOriginTask = null;
        mediaOriginDead = true;
        done(null);
      };
      let server;
      try {
        server = createServer((req, res) => {
          let pathname;
          try { pathname = new URL(req.url || '/', 'http://x').pathname; } catch { pathname = ''; }
          // 渲染页的诊断信标打的是 `{mediaBase origin}/diag`（**根路径**，见 routes/diag.js 的
          // Kg()）。场景壁纸的 mediaBase 指向本媒体源之后，这个根路径必须在这里也有落点 ——
          // 否则「大场景 pkg 首帧超时」时渲染页的告警会以 404 **静默丢掉**，而那正是排查现场
          // 唯一的内窗（同一条不变量见 routes/diag.js）。
          // 纪律与 /scene-files 一致：**同一个 handleDiag**，不另起一份缓冲（`/diag-log` 读的是
          // 同一份）；`${base}/diag` 一并接上，与 app 源的两条通道保持对称。
          if (pathname === '/diag' || pathname === `${base}/diag`) {
            // 未武装只可能发生在启动竞态里；此时**不假装成功** —— 落到下面的 404，
            // 让"告警丢了"当场可见，而不是被一个 204 吞掉。
            if (mediaDiagHandler) { mediaDiagHandler(req, res); return; }
          }
          if (!pathname.startsWith(`${base}/scene-files/`)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end('not found');
            return;
          }
          handleSceneFiles(req, res, 'media');
        });
      } catch (cause) { unavailable(cause); return; }
      server.on('clientError', (_err, socket) => { try { socket.destroy(); } catch { /* ignore */ } });
      server.on('error', unavailable);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = addr && typeof addr === 'object' ? addr.port : 0;
        if (!port) { unavailable(new Error('listen 未返回端口')); return; }
        mediaOrigin = { server, port, base: `http://127.0.0.1:${port}` };
        appendDiagLine('media-origin', { base: mediaOrigin.base });
        // 成功事实：**不发日志**，只走提示通道（D4）。文案惰性构造 —— 闸门关掉时不必拼。
        notice('media-origin', () => `壁纸媒体源已监听 ${mediaOrigin.base}（网页壁纸载荷不再经过插件路由的能力头栅栏）`);
        done(mediaOrigin);
      });
    });
    return mediaOriginTask;
  }
  disposers.push(() => { try { mediaOrigin?.server?.close(); } catch { /* ignore */ } });

  /**
   * `/media-origin` 的应答体：媒体源地址与端口。
   * `mediaOrigin` 是**本作用域的可变量**（ensureMediaOrigin 会重新赋值它）⇒ 跨模块只能以
   * **访问器**形式提供；把 `mediaOrigin.port` 的值拷进 context 会永远报 null。
   * `/inventory` 只需要 `mediaOriginBase()`（拼 media/preview 前缀），端口只有诊断路由用。
   */
  function mediaOriginInfo() {
    // 显式探测（GET /media-origin）：问的就是"媒体源在不在"，所以绕开适配器
    // 门控直接起 —— 浏览器形态下 inventory 不用它，但这条诊断路由必须给真话。
    return ensureMediaOrigin().then((m) => ({ base: (m && m.base) || null, port: mediaOrigin ? mediaOrigin.port : null }));
  }

  return {
    observeAdapter,
    adapterState,
    mediaOriginBase,
    ensureSceneMediaOrigin,
    mediaOriginInfo,
    /** 由 `registerDiagRoutes` 的出参武装（3c-7）。 */
    setDiagHandler: (fn) => { mediaDiagHandler = fn; },
  };
}
