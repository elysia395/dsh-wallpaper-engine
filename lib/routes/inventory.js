/**
 * 清单 JSON 路由 —— `GET ${BASE}/inventory`。
 *
 * 为什么独立成族：P0.2-D 把 `apply()` 里最后一条内联路由处理器搬了出来，门面只剩
 * 「建 kit → 装路由 → 返回 disposer」的装配骨架。处理器体逐字搬来（原本就在 apply() 里
 * 2 格缩进 ⇒ 本文件里的缩进逐字未变），路径 / 头 / 状态码 / 错误文案一律不变。
 *
 * 契约：registerInventoryRoutes(webServer, c)；`c` 里是这一族要用、但不属于它的东西：
 *   - disposers      apply() 的清理句柄台账（注册返回值**必须**推进去）
 *   - base           URL 前缀（= 门面 BASE，这里本地别名为 BASE）
 *   - mediaOriginApi 媒体源访问器（`observeAdapter(req)`）
 *   - buildInventory 清单构建器（门面模块作用域的 3s TTL 缓存，生命周期 = 一次 apply）
 *   - componentsProbe 组件行**行状态**探针（门面 `componentProbe()`，只读；见下「组件行状态」）
 *
 * 不变量：
 *   - `mediaOriginApi.observeAdapter(req)` 必须在 `buildInventory()` **之前**：媒体源起不起
 *     由本次请求的形态决定。
 *   - 成功响应头逐字保留：`application/json; charset=utf-8` + `Cache-Control: no-store`；
 *     500 分支只有 `application/json`（**不带** charset），字面量按 P0 纪律原样搬来，
 *     不要"顺手"改用 sendJson（那会多出 `; charset=utf-8`）。
 *   - 只 import `node:*` 与相对路径；**绝不** import `lib/index.js`。
 *
 * ── 组件行状态（`inventory.components`，ADR-0013 D3 的**状态面**）────────────────────
 * 形状（跨半边契约，浏览器半边按它 gate 可见面）：
 *   `{ "<组件名>": "started" | "failed:<错误文案>" | "missing" }`
 *   · `started`：该组件行的 apply 跑完、disposer 已交回宿主 —— **唯一算"可用"的值**；
 *   · `failed:<…>`：apply 抛错（文案随行，便于排障；判定不可用只该看前缀 `failed`）；
 *   · `missing`  ：该行**存在**（本包内建）但运行时**没有**装载 —— 行被 `disabled`、或入口没走到。
 * 键集 = 该次装载的**内建声明面**（探针的 `builtin`，即 `componentImpls()` 的键）。
 * 为什么不用探针的 `declared`（同一个键集、且被 `test/verify-bundle-rows.mjs` 钉成"逐名等于 patch 子行"）：
 * 那个面表达的是**装载面**（这次到底装了什么），`/diag-log` 的买家要的是它；
 * 行状态表要的是**代码内建面**（这个包写死了哪些组件行）—— 两者当前取值相同，但**读取方向必须有优先序**：
 * 先 `builtin`、`declared` 只作"更老/更窄的宿主"的兜底。
 * ⚠️ 别把这条读成"关掉的行会在 `declared` 里消失"：`declared` 是调用点传进来的**同一个键集**
 * （`lib/index.js` 现在把 `componentImpls()` 的键同时传给两个面），它 **不知道** patch 行的启停 ——
 * "行被 disable"最终由**账本**表达：没装载 ⇒ 不在 `started` / `failed` 里 ⇒ 落到 `missing`。
 * 两个面都保留在探针里，是为了让下游买家各自认自己那一面，且不放开 `declared` 的既有判据。
 *
 * ⚠️ **失效口径（D3③，跨半边纪律）**：整个 `components` 字段可能**缺席**
 *   （探针不可用 / 响应来自更老的宿主）⇒ 消费方必须**按"可用"渲染**（宁可显示，不可静默消失）。
 *   这条与"内核缺键即抛"是不同场景的两条纪律：缺键 = 装错（响亮报错），探测失败 = 不许让功能凭空消失。
 *   ⇒ 本族因此在探针不可用时**不合成**一份"全 missing"的假地图，而是让字段缺席。
 *
 * 单一真源：三本账（loaded / started / failed）都在 `lib/host-boot.js`；
 * 本文件只做**派生**（把三本账折叠成上面这张状态表），不持有任何组件状态。
 */
/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面/组件行调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'mediaOriginApi', 'buildInventory', 'componentsProbe'];

/**
 * 探针三面 → 行状态表（形状见文件头「组件行状态」）。
 * 纯派生，不改探针、不缓存。**先读内建面**（`builtin`：本包写死了哪些组件行）——
 * 行被 disable 时它在 `declared` 里不出现、但在 `builtin` 里必然出现 ⇒ 才有一个值为 `missing`
 * 的键可以表达"这一行被关掉了"。退一步用 `declared` 兜底（探针来自更老 / 更窄的宿主时）。
 * 探针不可用（不是函数 / **抛错** / 返回非对象 / 两个面都读不出）时返回 `null` —— 调用方据此**不写**
 * `components` 字段，而不是合成"全不可用"（失效口径：宁可显示）。
 * ⚠️ **探针抛错必须在这里吞掉**：`components` 只是可选的状态面，它不该有能力把整条清单（壁纸库）
 * 一起打成 500 —— 那等于让"可选面不可用"升级成"主功能不可用"，与 D3③ 的方向相反。
 * @param {unknown} probe 门面注入的 `componentProbe()`
 * @returns {Record<string, string> | null}
 */
function rowStatusOf(probe) {
  /** @type {any} */
  let p;
  try {
    p = typeof probe === 'function' ? probe() : null;
  } catch {
    p = null;   // 探针抛错 = 状态面不可用（不是"全都不在"）⇒ 交给下面的失效口径
  }
  if (!p || typeof p !== 'object') return null;
  const rows = Array.isArray(p.builtin) && p.builtin.length ? p.builtin
    : (Array.isArray(p.declared) && p.declared.length ? p.declared : null);
  if (!rows) return null;
  const failed = (p.failed && typeof p.failed === 'object') ? p.failed : {};
  const started = Array.isArray(p.started) ? p.started : [];
  const out = {};
  for (const name of rows) {
    if (started.includes(name)) out[name] = 'started';
    // `in` 而不是真值判断：空文案的失败也是失败（`failed:''` 折叠成 `missing` 会把"抛错"误报成"没装载"）。
    else if (name in failed) out[name] = `failed:${failed[name]}`;
    else out[name] = 'missing';
  }
  return out;
}

export function registerInventoryRoutes(webServer, c) {
  const { disposers, base: BASE, mediaOriginApi, buildInventory, componentsProbe } = c;

  // 1. Inventory JSON.
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/inventory`,
    handler: async (req, res) => {
      try {
        mediaOriginApi.observeAdapter(req);   // 先观测再建库：媒体源起不起由本次请求的形态决定
        const payload = await buildInventory();
        // 组件行状态（只读，形状与失效口径见文件头「组件行状态」）：探针不可用时**不写**该字段 ——
        // 消费方据此按"可用"渲染，而不是把"探测失败"渲染成"组件都没了"。
        const components = rowStatusOf(componentsProbe);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(components ? { ...payload, components } : payload));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      }
    },
  }));
}
