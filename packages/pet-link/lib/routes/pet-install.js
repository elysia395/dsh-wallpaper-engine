/**
 * 路由：pet-link 宿主半的运行时**只读**状态面。
 *
 *   GET `${BASE}/pet-link/pet/state` → { ok, installed, name, version, path, runtimePresent,
 *                                        installUrl, installCommand, running, ... }
 *
 * 安装 / 卸载 / 安装进度三条路由已于 2026-11-01 移除（自研下载解包绕过 DSH 依赖管理、
 * 与 link: 布局冲突，实测造成重复注册 / 误判未安装 / 启动崩溃）；安装改走 DSH 官方入口。
 * 本文件只负责「装了没有、什么版本、运行时在不在」的只读探测。
 *
 * 安全口径与 `routes/official-pet.js` 一致：
 *   · 同源校验：带 Origin 时必须 http + 本机回环 + 同端口；`sec-fetch-site: cross-site` 一律 403。
 *   · 只读：GET 之外一律 405，不读请求体。
 *
 * @module pet-link/routes/pet-install
 */
export const DEPS = ['disposers', 'base', 'http'];

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

/**
 * 注册只读状态路由。
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
}
