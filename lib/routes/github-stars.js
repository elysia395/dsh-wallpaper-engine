/**
 * routes/github-stars.js — **仓库 star 数**的唯一一条路由：`GET <BASE>/star-count`
 * （「关于」页签那行「⭐ 当前 N star」的数据源）。
 *
 * 为什么单独成文件：**这是本插件唯一一条出站请求**（其余部分全是本机数据）。"什么时候可以
 * 联网 / 拉不到怎么办 / 缓存放哪 / 会不会被限流"必须能在一处读完 —— 写进 `lib/index.js` 只会
 * 让那个门面再多一段与它无关的联网逻辑。
 *
 * 为什么不做"一键 star"：GitHub 不允许未认证的程序点星（`PUT /user/starred/…` 要用户凭据）。
 * 插件**不存任何 token**、也不借用本机 `gh` 的凭据 ⇒ 这里只有**只读**一条腿，点星由用户
 * 在仓库页完成（关于页给的是链接 + 可复制地址）。
 *
 * 契约：`registerGithubStarsRoutes(webServer, c)`；`c` 里是这一族用到但不属于它的东西：
 *   · `disposers` / `base: BASE`  ← 清理句柄与路径前缀
 *   · `repoSlug`                  ← 'owner/repo'（`lib/index.js` 从 package.json 现读，
 *                                    见那里的 `repoSlugFromPkg` —— 仓库地址只有一处真源）
 *   · `cachePath()`               ← 落盘缓存路径（`pluginDataDir()/star-count.json`）
 *   · `fetchJson(url, ms)`        ← **可注入**的出站请求（守卫喂替身，避免测试联网）
 *   · `log`                       ← 失败留痕（成功不记：成功是常态，不该刷屏）
 *
 * 不变量（每条都有守卫）：
 *   · **只读**：只 GET `api.github.com/repos/<slug>`，永不发写请求、永不带凭据。
 *   · **绝不把失败当错误甩给用户**：网络失败 / 非 2xx / 限流都回 200 + `ok:false` + 原因；
 *     有落盘缓存时回它并标 `stale:true` —— 关于页显示"上一次取到的值"，不是断网图标。
 *   · **不放大请求**：TTL（10 分钟）内直接回内存缓存；并发请求合并成一次出站（GitHub 未认证
 *     限流是 **60 次/小时/IP**，且**整机共享** —— 别的程序也在用这个额度）。
 *   · **失败要重试、成功才计 TTL**：失败不写 `at`（下次一问就再试），只有成功才进入冷却。
 *   · **超时必须收**：出站 8s 超时（`AbortSignal.timeout`），不能让一个挂住的连接占住 handler。
 *   · **落盘必须原子**：同目录 `.tmp` + rename（半截 JSON 会让"离线兜底"这条腿永久失效）。
 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
// JSON 应答的**唯一实现**（状态码 + 两个头 + end）—— 见 lib/json-response.js。
import { sendJson } from '../json-response.js';

/** 成功结果的新鲜期：10 分钟内不再出站（客户端侧同一量级，两处相乘 ≈ 最坏 20 分钟一次）。 */
const STAR_TTL_MS = 10 * 60 * 1000;
/** 出站超时：GitHub 正常在 1s 内应答，8s 足够，也不会把设置页的一次打开拖长。 */
const STAR_FETCH_TIMEOUT_MS = 8000;

/** 默认出站实现：只读 GET，带 UA（GitHub API 要求有 UA），带超时。 */
async function defaultFetchJson(url, ms) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(ms),
    headers: {
      'User-Agent': 'dsh-wallpaper-engine',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    throw new Error('HTTP ' + res.status);
  }
  return res.json();
}

/** 从 API 应答里取 star 数：形状不对就当失败（宁可显示"取不到"，也不要显示一个假的数）。 */
function starsFromApi(json) {
  const n = json && json.stargazers_count;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function registerGithubStarsRoutes(webServer, c) {
  const { disposers, base: BASE, repoSlug, cachePath, log } = c;
  const fetchJson = typeof c.fetchJson === 'function' ? c.fetchJson : defaultFetchJson;

  /** 内存缓存 { count, at } —— 进程内共享，重启后由落盘那份接上。 */
  let mem = null;
  /** 在途请求：并发合并（多个窗口同时打开设置页也只出站一次）。 */
  let inflight = null;

  const fresh = (v) => Boolean(v) && Number.isFinite(v.count) && Date.now() - Number(v.at || 0) < STAR_TTL_MS;

  function readDisk() {
    try {
      const o = JSON.parse(readFileSync(cachePath(), 'utf8'));
      if (o && Number.isFinite(o.count) && Number.isFinite(o.at)) return { count: o.count, at: o.at };
    } catch { /* 没有 / 读不懂都当"没有" —— 缓存不是真源 */ }
    return null;
  }

  function writeDisk(v) {
    try {
      const file = cachePath();
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify({ count: v.count, at: v.at }));
      renameSync(tmp, file);
    } catch (err) {
      // 写不进缓存不影响这次应答；留个痕就够（下次仍能联网取到）。
      try { log('star-count 缓存写入失败：' + (err && err.message ? err.message : err)); } catch { /* ignore */ }
    }
  }

  async function fetchOnce() {
    const url = 'https://api.github.com/repos/' + repoSlug;
    const json = await fetchJson(url, STAR_FETCH_TIMEOUT_MS);
    const count = starsFromApi(json);
    if (count === null) throw new Error('unexpected payload');
    const got = { count, at: Date.now() };
    mem = got;
    writeDisk(got);
    return got;
  }

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/star-count`,
    handler: async (req, res) => {
      // 薄别名：保留调用点写法（只有 200 + body），实现收敛到 lib/json-response.js。
      // 缓存由**本路由**管（TTL 在上游），别让浏览器/CDN 再叠一层不可控的缓存 ⇒ no-store。
      const reply = (body) => sendJson(res, 200, body);
      if ((req.method || 'GET').toUpperCase() !== 'GET') { res.statusCode = 405; res.end(); return; }
      // 没有可解析的仓库地址（package.json 被改坏 / 不是从包安装）：功能关闭，但**不报错** ——
      // 关于页只是不显示数字，其余照常。
      if (!repoSlug) { reply({ ok: false, count: null, error: 'no-repo' }); return; }

      const cached = mem || readDisk();
      if (fresh(cached)) {
        mem = cached;
        reply({ ok: true, count: cached.count, fetchedAt: cached.at, stale: false });
        return;
      }
      try {
        if (!inflight) {
          inflight = fetchOnce().finally(() => { inflight = null; });
        }
        const got = await inflight;
        reply({ ok: true, count: got.count, fetchedAt: got.at, stale: false });
      } catch (err) {
        const stale = cached || readDisk();
        try { log('star-count 拉取失败：' + (err && err.message ? err.message : err)); } catch { /* ignore */ }
        // 有旧值就回旧值（标 stale）：关于页显示"上一次取到的数"比显示"取不到"有用。
        if (stale) reply({ ok: true, count: stale.count, fetchedAt: stale.at, stale: true });
        else reply({ ok: false, count: null, error: String((err && err.message) || err) });
      }
    },
  }));
}
