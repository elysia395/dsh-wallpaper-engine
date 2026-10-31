/**
 * 路由：pet-link 宿主半的运行时安装控制面。
 *
 *   GET  `${BASE}/pet-link/pet/state`     → { ok, installed, version, path, running, officialPet, conflict, ... }
 *   POST `${BASE}/pet-link/pet/install`   → { ok, method, version, steps[], state }（分步进度）
 *   POST `${BASE}/pet-link/pet/uninstall` → { ok, keepData, steps[], state }
 *
 * 安全口径与 `routes/official-pet.js` 一致并更严：
 *   · 同源校验：带 Origin 时必须 http + 本机回环 + 同端口；`sec-fetch-site: cross-site` 一律 403。
 *   · 请求体上限 8192 字节（沿用 official-pet 的 8 KiB）。
 *
 * @module pet-link/routes/pet-install
 */
export const DEPS = ['disposers', 'base', 'http'];

const BODY_MAX_BYTES = 8192;

/** 判断请求是否为本机同源（无 Origin 视为本机直连，放行）。仅本文件内部使用，不导出。 */
function isSameOrigin(req, webServer) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const from = new URL(origin);
    return from.protocol === 'http:'
      && Number(from.port || 80) === webServer.port
      && ['127.0.0.1', 'localhost', '[::1]'].includes(from.hostname);
  } catch { return false; }
}

/** 读并解析 JSON 请求体（带字节上限），返回 { ok, value, reason }。 */
async function readJsonBody(req, send, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_MAX_BYTES) { send(res, 413, { ok: false, reason: 'body-too-large' }); return { ok: false }; }
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return { ok: true, value: {} };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not-object');
    return { ok: true, value };
  } catch { send(res, 400, { ok: false, reason: 'bad-request' }); return { ok: false }; }
}

/**
 * 注册三条路由。
 * @param {{ register: Function, port: number }} webServer
 * @param {{ disposers: Function[], base: string, http: { sendJson: Function } }} c
 */
export function registerPetInstallRoutes(webServer, c, options = {}) {
  const { disposers, base, http } = c;
  const BASE = base;
  const installer = options.installer;
  if (!installer) throw new Error('pet-install 路由需要 installer');
  const send = (res, status, value) => http.sendJson(res, status, value);
  let active = true;
  disposers.push(() => { active = false; });

  const guard = (req, res) => {
    if (!active) { send(res, 410, { ok: false, reason: 'bridge-disposed' }); return false; }
    if (!isSameOrigin(req, webServer)) { send(res, 403, { ok: false, reason: 'cross-site-request' }); return false; }
    return true;
  };

  disposers.push(webServer.register({ kind: 'exact', path: `${BASE}/pet-link/pet/state`, handler: (req, res) => {
    if (!guard(req, res)) return;
    if (req.method !== 'GET') return send(res, 405, { ok: false, reason: 'method-not-allowed' });
    return send(res, 200, installer.state());
  } }));

  /**
   * 只读进度（UI 轮询；不用 SSE）：`{ ok, state, received, total, percent, source, error? }`。
   * 终态（done / error）**只交付一次**，下一次读即回 idle —— UI 拿它收尾，之后进度条自动隐藏。
   * 纯读：不改盘、不推进安装、不做任何副作用；页面传的任何参数一律忽略。
   */
    // ⚠️ 2026-11-01：install / uninstall / install-progress 三条路由全部移除。
  // 自研下载解包会绕过 DSH 的依赖管理，与本地 link: 布局冲突，已实际造成
  // 「插件列表出现两个同名条目 / 运行时误判未安装 / DSH 启动崩溃」。
  // 安装与更新改由 DSH 官方入口（插件 → 添加插件）完成，此处只保留 state 与 UI 引导。
}
