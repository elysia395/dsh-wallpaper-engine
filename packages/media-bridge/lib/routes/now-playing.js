/**
 * packages/media-bridge/lib/routes/now-playing.js — **媒体状态族**路由：媒体后端健康探针（`/media-status`）、
 * 系统音频频谱（`/audio-spectrum`）、当前曲目信息（`/now-playing`）、封面字节
 * （`/now-playing/artwork`）与反向控制（`/media-control`）。
 *
 * 为什么值得独立成文件：这五条路由里**取数的四条**（`/media-control` 不触发启动，见下）共用同一个
 * **懒启动**的媒体后端实例与它的一次性启动决策
 * —— `mediaBackend` 与 `ensureMedia` 只被这一族引用（全仓无其它消费者）。
 * 收在本文件里，后端的生命周期就是本文件的两个局部量，
 * 而**依赖写在签名上**（`c`）。
 *
 * 契约：`registerNowPlayingRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers`      ← `apply` 的清理句柄数组；注册返回值与后端停止都要推进去
 *   · `base`           ← 路径前缀 `BASE`（宿主唯一的定义处；这里以别名 BASE 使用）
 *   · `appendDiagLine` ← `lib/diag-trace.js` 的落盘函数（多族共用；主包各族由门面注入，本组件行走组件会话交出）
 *   · `configPath`     ← 模块级：数据目录里的 `config.json` 路径（后端的 `dataDir` 取它的父目录）
 *   · `readConfig`     ← 模块级：读取设置（启动决策读 `audioSource` / `mediaIntegration` / `mediaLyricsOnline`）
 *   · `log`            ← `lib/log.js` 的宿主日志入口（已带 `[media]` 标签）⇒ 后端的注入契约为
 *                        `log(msg, level)`：级别由调用点标注，缺省 `info`
 *   · `serveFile`      ← 组件会话交出的静态文件发送器（多族共用；规模由 `node test/tools/host-route-index.mjs --deps` 现算）
 * 族内状态（`mediaBackend` / `ensureMedia`）是本文件的局部量 —— 只被这一族使用，**不经过 context**。
 *
 * 不变量：
 *   · **懒启动**：后端只在第一次被问到数据时才启动 —— 没人用就不该去下产物、不起子进程、
 *     更不该申请系统音频权限。启动决策**每次现读设置**（改完设置下一次请求即生效）。
 *   · `audioSource === 'off'` 且媒体集成关闭 ⇒ **完全不启动**（`ensureMedia` 直接返回）。
 *   · `DSH_WE_MEDIA_NO_AUDIO=1` ⇒ 只取元数据、永不碰系统音频采集（与 `DSH_WE_DATA_DIR` /
 *     `DSH_WE_CACHE_DIR` 同一套测试隔离约定：端到端脚本靠它免掉「音频录制」授权弹窗）。
 *   · `/audio-spectrum` 的 `running` 是**客户端契约**：为 false 时客户端不装音频桥 —— 渲染页
 *     一旦装了桥就跳过场景 BGM 的分析器接线，喂一屏 0 会把音频反应从「内置模拟源」变成一条死线。
 *   · `/now-playing/artwork` **每次**都读当前快照的路径：中间件的封面文件名带内容指纹（换曲即换名），
 *     缓存文件名会在换曲后继续发上一张封面。
 *   · `/media-control` 是这一族**唯一会改变系统状态**的路由（其余四条只读）：只收 POST +
 *     JSON `{action}`，动作走 `MEDIA_CONTROL_ACTIONS` 白名单（在 supervisor 一侧），
 *     不可用/未知动作都如实回 `{ok:false}` 而不是造一个成功。它**不触发懒启动**
 *     —— 控制是用户点一下的交互，不该顺带把产物下载与子进程拉起来（取数那四条才是启动点）。
 *   · 注册顺序按原样：`/media-status` → `/audio-spectrum` → `/now-playing` → `/now-playing/artwork`
 *     → `/media-control`。
 *   · 注册返回值与 `mediaBackend.stop()` 都必须推进 `c.disposers`，否则插件卸载 / HMR 之后
 *     路由仍挂着已释放的处理器，子进程与系统音频采集也继续存活。
 */

import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMediaBackend } from '../backend.js';

/**
 * 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/子包调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。
 * `http` = 收体器与 JSON 应答的**唯一实现**（`bodyReader` / `sendJson`，见主包 `lib/http-body.js`、
 * `lib/json-response.js`）：P-F 出户后本包不许直接 import 主包叶子模块，改由调用点按需注入。
 */
export const DEPS = ['disposers', 'base', 'appendDiagLine', 'configPath', 'cacheBaseDir', 'readConfig', 'serveFile', 'CONTROL_JSON_MAX_BYTES', 'log', 'http'];

export function registerNowPlayingRoutes(webServer, c) {
  const { disposers, base: BASE, appendDiagLine, configPath, cacheBaseDir, readConfig, serveFile, CONTROL_JSON_MAX_BYTES, log, http } = c;

  // 3c-5. 媒体后端（Now Playing + 系统音频频谱）。首选 media-bridge 子进程
  //       （macOS MediaRemote/CoreAudio、Windows GSMTC/WASAPI、Linux MPRIS/PipeWire，
  //       三平台同一套能力）；取不到产物或起不来时由**媒体后端门面** `backend.js` 的
  //       `createMediaBackend()` 自动回落到本包 `lib/legacy.js`
  //       （macOS Swift tap + ffmpeg 路径），回落原因在 status.fallback 里。
  //       `dataDir` = config.json 的父目录（中间件产物 / 音频 tap 编译产物，属工具链）；
  //       `cacheBaseDir` = 用户可改的**缓存根**访问器（中间件 --cache-dir 与封面缓存跟它走，
  //       且**传访问器而不是现算的值** —— 改了「缓存位置」不必重启宿主）。
  const mediaBackend = createMediaBackend({
    dataDir: dirname(configPath()),
    cacheBaseDir,
    // 注入契约：`log(msg, level?)` —— 媒体子系统只标级别，写终端 / 落档由 lib/log.js 定。
    log: (m, level) => log(m, level),
    diag: appendDiagLine,
  });
  disposers.push(() => mediaBackend.stop());
  const ensureMedia = () => {
    let st = {};
    try {
      const cfg = readConfig();
      st = cfg && cfg.settings ? cfg.settings : {};
    } catch { /* 读不到配置就按默认启用 */ }
    if (st.audioSource === 'off' && st.mediaIntegration === false) return;
    mediaBackend.start({
      // DSH_WE_MEDIA_NO_AUDIO=1：只取元数据、永不碰系统音频采集（不申请授权）。
      audio: st.audioSource !== 'off' && process.env.DSH_WE_MEDIA_NO_AUDIO !== '1',
      online: st.mediaLyricsOnline === true,
    });
  };

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/media-status`,
    handler: (req, res) => {
      ensureMedia();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: true, ...mediaBackend.status() }));
    },
  }));
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/audio-spectrum`,
    handler: (req, res) => {
      ensureMedia();
      const st = mediaBackend.status();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // running=false 时客户端**不装**音频桥：渲染页一旦装了桥就跳过场景 BGM 的
      // 分析器接线（renderer 的 L2 开头即 `if(t.audioBridge) return`），喂一屏 0
      // 会把壁纸的音频反应从「内置模拟源」变成「一条死线」。让渲染页继续用自己的
      // 模拟源 / 包内音频分析，比喂 0 正确。
      res.end(JSON.stringify({
        ok: true,
        bands: Array.from(mediaBackend.spectrum()),
        running: st.audio.status === 'running',
      }));
    },
  }));
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/now-playing`,
    handler: (req, res) => {
      ensureMedia();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({
        ok: true,
        media: mediaBackend.nowPlaying(),
        hasArtwork: Boolean(mediaBackend.artworkFile()),
      }));
    },
  }));
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/now-playing/artwork`,
    handler: (req, res) => {
      // 中间件的封面文件名带内容指纹（换曲即换名），所以每次都要读当前快照的路径，
      // 不能缓存文件名 —— 缓存了会在换曲后继续发上一张封面。
      const f = mediaBackend.artworkFile();
      if (!f || !existsSync(f)) { res.statusCode = 404; res.end('no-artwork'); return; }
      res.setHeader('Cache-Control', 'no-store');
      serveFile(f, req, res, false);
    },
  }));
  // 3c-6. 反向控制（壁纸里的播放/暂停/上下曲按钮 → 真实播放器）。
  //       入口是渲染页的媒体控制面：客户端把 __wp.setMediaControl 装进 live 帧，
  //       壁纸的媒体按钮点击经它打到这里；动作白名单与中间件翻译在 mediaBackend 内。
  //       只收 POST + JSON：这条会改系统播放态，而 JSON content-type 让**跨源**请求
  //       必须走预检（本路由不答 OPTIONS ⇒ 预检失败），网页壁纸（不透明源）因此
  //       够不到它 —— 它俩本来就只该经渲染页的控制面间接控制。
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/media-control`,
    handler: (req, res) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') { res.statusCode = 405; res.end('method not allowed'); return; }
      // 薄别名：保留调用点写法，实现收敛到 lib/json-response.js（默认带 no-store）。
      const json = (code, o) => http.sendJson(res, code, o);
      // 上限 + 收完一次性解码（不变量见 lib/routes/upload.js 文件头）：
      // 这是一条 POST，而 webserver 允许 host: 0.0.0.0 ⇒ 无上限的累加会把宿主堆无界撑大。
      let tooLarge = false;
      const reader = http.bodyReader(req, {
        maxBytes: CONTROL_JSON_MAX_BYTES,
        onOverflow: () => { tooLarge = true; json(413, { ok: false, error: 'payload too large' }); },
      });
      req.on('data', reader.onData);
      req.on('end', () => {
        if (tooLarge) return;
        const body = reader.text();
        let action = '';
        try { action = String((JSON.parse(body || '{}') || {}).action || ''); } catch { /* 非 JSON：按空动作处理 */ }
        if (!action) { json(400, { ok: false, error: 'missing-action' }); return; }
        // 不可用（内置实现不支持控制 / 中间件未就绪）与未知动作都如实回 200 + ok:false：
        // 调用方（渲染页里的壁纸按钮）不需要区分 HTTP 层错误与能力缺失，它只看 ok。
        Promise.resolve(mediaBackend.control(action)).then((r) => json(200, r && typeof r === 'object' ? r : { ok: false }));
      });
      req.on('error', () => { if (tooLarge) return; res.statusCode = 400; res.end('request error'); });
    },
  }));
}
