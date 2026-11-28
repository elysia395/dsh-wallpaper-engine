/**
 * app-mount.js — 应用**挂载前缀**的唯一探测点（issue #409）。
 *
 * ══ 为什么需要 ════════════════════════════════════════════════════════════════
 * 宿主把插件路由挂在站点根（`/wallpaper-engine/*`）。反代把整个 DSH 挂在子路径下时
 * （实测：飞牛 fnOS 的 `/app/Harness/dsh/`，两级前缀），网关会**先剥前缀再转发**给
 * 宿主 —— 于是宿主侧看到的路由还是 `/wallpaper-engine/*`，而浏览器必须把前缀补回去，
 * 否则请求落到网关的站点根，拿到的是网关的 404/405 HTML 页，而不是宿主的
 * `{ error }` 信封。表现就是「设置页显示『宿主返回 404』，换根路径访问一切正常」。
 *
 * ══ 契约 ══════════════════════════════════════════════════════════════════════
 * 需要的外界：只有**环境读数**（`performance` 资源计时 / `document.baseURI` /
 * `location.origin`），全部可注入 ⇒ 纯函数部分可在 Node 里直接测。
 * 对外提供：weAppMount(env) / weAppBase() / weAppMountReset() / weNormalizeMount()。
 *
 * 不变量：
 *   · **根路径部署必须逐字退回现状**：探不出前缀时返回空串，`apiUrl()` 拼出来的
 *     路径与改动前**逐字节相同**（这条由 test/verify-api-client.mjs 钉住）。
 *   · **宁可不补，也不乱补**：证据不足一律返回空串。补错前缀比不补更糟 ——
 *     根路径部署是所有用户的默认形态，误判会把它整块打死。
 *   · **探测只做一次**：origin 与挂载在页面生命周期内不变；重探（weAppMountReset）
 *     只服务于测试与极少数导航场景。
 *   · 返回值形态统一：空串（站点根）或以 `/` 开头、不带尾斜杠的前缀。
 */

/** 探测结果缓存 —— 一个页面只探一次（见文件头「探测只做一次」）。 */
const WE_APP_MOUNT_CACHE = { value: null };

/**
 * 归一化：`/` / 空串 / 尾斜杠 / 缺前导斜杠 都收敛成同一种形态。
 * 只做形态收敛，**不判断合法性**（合法性由各证据源自己的规则负责）。
 */
function weNormalizeMount(prefix) {
  let s = String(prefix == null ? "" : prefix).trim();
  if (!s || s === "/") return "";
  if (!s.startsWith("/")) s = "/" + s;
  s = s.replace(/\/+$/, "");
  return s === "" ? "" : s;
}

/**
 * 证据源 ①：**已加载资源的真实 URL**（最可靠 —— 资源名一定带完整前缀）。
 *
 * 页面里必然有应用自己的 `assets/` 或插件 `plugins/` 资源；它们的 pathname 形如
 * `<mount>/assets/<file>`。取所有命中项的前缀：**全部一致才采信**，不一致（不同源、
 * 不同挂载混在一起时）返回空串而不是掷硬币。
 *
 * @returns {string|null} null = 没有可用证据（交给下一个证据源）；
 *                        "" = 有证据但不可采信（明确按站点根处理）。
 */
function weMountFromResources(resources) {
  if (!Array.isArray(resources)) return null;
  const found = new Set();
  for (const entry of resources) {
    const name = typeof entry === "string" ? entry : (entry && entry.name);
    if (!name) continue;
    let pathname;
    try {
      // 相对名也要能解析：用一个不会被误认成真实主机的占位源。
      pathname = new URL(String(name), "http://mount.invalid/").pathname;
    } catch { continue; }
    const m = /^(.*)\/(?:assets|plugins)\/[^/]+$/.exec(pathname);
    if (m) found.add(weNormalizeMount(m[1]));
  }
  if (found.size === 0) return null;
  if (found.size > 1) return "";
  return found.values().next().value;
}

/**
 * 证据源 ②：`document.baseURI` 的路径。
 *
 * 只采信两种形态，其余一律按站点根：
 *   · `/app/<应用>[/<子路径>...]` —— 反代应用的挂载约定。**故意认到头**：fnOS 是
 *     两级前缀 `/app/Harness/dsh`，只认 `/app/<一级>` 会漏掉应用自己的子路径。
 *   · **目录形态**（以 `/` 结尾，如 `/dsh/`）—— 页面就停在这个目录上。
 * 明确的**路由形态**（`/session/abc`、带扩展名的 `/x/index.html`）不猜：那不是挂载点，
 * 按它补前缀会把请求打到不存在的路径上。
 */
function weMountFromBaseURI(baseURI, origin) {
  if (!baseURI) return "";
  let u;
  try { u = new URL(String(baseURI), "http://mount.invalid/"); } catch { return ""; }
  // 绝对 baseURI 指向别的源时不算（同源判断只在能取到 origin 时做）。
  const raw = String(baseURI);
  if (origin && /^[a-z][a-z0-9+.-]*:/i.test(raw) && u.origin !== String(origin)) return "";
  const p = u.pathname || "/";
  if (p === "/" || p === "") return "";
  if (/^\/app\/[^/]+(?:\/[^/]+)*\/?$/.test(p)) return weNormalizeMount(p);
  if (p.endsWith("/")) return weNormalizeMount(p);
  return "";
}

/**
 * `?we-app-mount=` 逃生舱（探测出错时唯一的人工干预口子）。
 *
 *   · `?we-app-mount=/app/Harness/dsh` —— 强制这个前缀（探测不到、或层级猜错时手填）；
 *   · `?we-app-mount=0` / `off` / `root` / 空值 —— 强制站点根（探测误判出前缀时关掉）；
 *   · 畸形值（带 scheme、`//host`、反斜杠、空白）—— **忽略**，回退自动探测，绝不把请求
 *     指到另一个源上去。
 *
 * @returns {string|null} null = 没有这个参数（走探测）；`""` = 显式站点根。
 */
function weMountOverride(search) {
  const q = String(search == null ? "" : search);
  if (!q) return null;
  let raw = null;
  try {
    const params = new URLSearchParams(q.charAt(0) === "?" ? q.slice(1) : q);
    raw = params.get("we-app-mount");
  } catch { return null; }
  if (raw === null) return null;
  const value = String(raw).trim();
  if (value === "" || /^(0|off|none|root)$/i.test(value)) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.includes("\\") || /\s/.test(value)) return null;
  return weNormalizeMount(value);
}

/**
 * 纯函数入口：给定环境读数返回挂载前缀（`""` = 站点根）。
 * 证据优先级：`?we-app-mount=` 显式指定（唯一的人工干预）→ 资源名（最硬）→ baseURI（次之）
 * → 站点根。
 */
function weAppMount(env) {
  const e = env || {};
  const forced = weMountOverride(e.search);
  if (forced !== null) return forced;
  const fromResources = weMountFromResources(e.resources);
  if (fromResources !== null) return fromResources;
  return weMountFromBaseURI(e.baseURI, e.origin);
}

/** 读环境（唯一读 DOM 的地方），结果缓存一次。 */
function weAppBase() {
  if (WE_APP_MOUNT_CACHE.value === null) {
    let resources = [];
    try {
      if (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") {
        resources = performance.getEntriesByType("resource") || [];
      }
    } catch { resources = []; }
    let baseURI = "";
    let origin = "";
    let search = "";
    try { if (typeof document !== "undefined" && document.baseURI) baseURI = document.baseURI; } catch { baseURI = ""; }
    try { if (typeof location !== "undefined" && location.origin) origin = location.origin; } catch { origin = ""; }
    try { if (typeof location !== "undefined" && location.search) search = location.search; } catch { search = ""; }
    WE_APP_MOUNT_CACHE.value = weAppMount({ resources, baseURI, origin, search });
  }
  return WE_APP_MOUNT_CACHE.value;
}

/** 清缓存（测试与「页面主文档被替换」的极少数场景；正常路径不该调用）。 */
function weAppMountReset() {
  WE_APP_MOUNT_CACHE.value = null;
}

export { weAppMount, weAppBase, weAppMountReset, weNormalizeMount };
