/**
 * routes/occlusion.js — **遮挡快照族**路由：`GET <BASE>/occlusion`。
 *
 * 为什么独立成文件：遮挡的生产端（`lib/occlusion/`）是一个自带心跳、降级与适配器
 * 重建的**活系统**，而路由层应当薄到零逻辑——hub 的快照 `getSnapshot()` 永不抛错、
 * 永不回空（见 `lib/occlusion/index.js` 头注释），所以这里**不需要任何防御性代码**，
 * 直接把快照 JSON 化发出去即可。把「活系统」收进 `lib/occlusion/`、把「一个只读
 * 端点」收进本文件，依赖（`hub`）写在签名上（`c`），生命周期（`dispose`）由调用点
 * 推进 `c.disposers` —— 与其它路由族同一套分工。
 *
 * 契约：`registerOcclusionRoutes(webServer, c)`；`c` 里是这一族用到但不属于它的东西：
 *   · `disposers` ← `apply` 的清理句柄数组；本族路由注册返回值推进去（hub 的
 *     dispose 由调用点另推，因为 hub 在调用点创建）。
 *   · `base`      ← 路径前缀 `BASE`（宿主唯一的定义处）。
 *   · `hub`       ← `createOcclusionHub()` 产物；本族是它的**唯一路由消费者**。
 *
 * 不变量：
 *   · **只读端点**：没有任何 POST/控制语义 —— 客户端只轮询，不回写；
 *   · `GET` 200 + `no-store`：快照是"此刻状态"，与全插件其余 JSON 端点同一缓存口径
 *     （`lib/json-response.js` 默认值即 no-store，不显式覆盖）；
 *   · 非 GET ⇒ 405（`Allow` 头 + JSON 体——比先例更完整：upload 族只发裸文本、
 *     preview 族有 Allow 无 JSON 体）；
 *   · 快照序列化交给 `sendJson`：本文件不出现第二份 JSON 应答样板（单一实现纪律，
 *     `test/verify-json-response.mjs` 的棘轮盯着）。
 */

// JSON 应答的唯一实现 —— 见 lib/json-response.js。
import { sendJson } from '../json-response.js';

/** 注入契约（P2-7A / ADR-0013 D12）：本族从 `c` 消费的**必需**键 —— 门面调用点必须逐键给到（判据 test/verify-inject-contracts.mjs 双向对账）。 */
export const DEPS = ['disposers', 'base', 'hub', 'log', 'diag'];

export function registerOcclusionRoutes(webServer, c) {
  const { disposers, base: BASE, hub, log, diag } = c;
  // trace 判定放 handler 内**现读**（对齐 lib/log.js 的环境闸门约定：不快照在
  // 注册那一刻）—— QA 中途开/关 DSH_WE_OCCLUSION_TRACE 立即生效，无需重挂插件。
  const tracing = () => process.env.DSH_WE_OCCLUSION_TRACE === '1';
  // mock/测试场景 c.log 可能缺省：trace 分支的日志回调用与 diag 相同的守卫，
  // 绝不让可观测性缺陷升级成 unhandled rejection。
  const traceLog = (line) => {
    if (typeof log === 'function') log(line);
  };
  const traceDiag = (obj) => {
    if (typeof diag === 'function') {
      try {
        diag(obj);
      } catch { /* 诊断失败不影响服务 */ }
    }
  };
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/occlusion`,
    handler: async (req, res) => {
      const trace = tracing();
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { ok: 0, error: 'method not allowed' });
        // 405 也逐请求留痕：QA 用非 GET 探测方法面时同样要对账。
        if (trace) {
          traceLog(`${req.method} ${BASE}/occlusion -> 405 (allow: GET)`);
          traceDiag({ ev: '405', method: String(req.method || '') });
        }
        return;
      }
      const t0 = Date.now();
      const snap = hub.getSnapshot();
      // hub.getSnapshot() 永不抛错（含降级态）——这里不需要 try/catch。
      sendJson(res, 200, snap);
      if (trace) {
        const ms = Date.now() - t0;
        traceLog(`GET ${BASE}/occlusion -> 200 gen=${snap.gen} backend=${snap.backend} rects=${snap.rects ? snap.rects.length : 'null'} (${ms}ms)`);
        traceDiag({ ev: 'get', gen: snap.gen, backend: snap.backend, rects: snap.rects ? snap.rects.length : null, ms });
      }
    },
  }));
}
