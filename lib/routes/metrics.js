/**
 * routes/metrics.js — **资源柱状图族**路由：一条只读的 `GET ${BASE}/metrics`，把宿主采样器
 * （`lib/metrics.js`）的 1 Hz 时间序列喂给浏览器端的「硬件资源监控柱状图」扩展。
 *
 * 为什么只有一条也单独成文件：这一族有**自己的进程级状态**（采样器的定时器与常驻
 * `typeperf` 子进程）与**自己的失败面**（PDH 腿在非 Windows / 沙箱 / 无计数器时整条退场）。
 * 收在本文件里，状态的生命周期就是本文件的一个局部量 + 一个 disposer，而依赖写在签名上（`c`）。
 *
 * 契约：`registerMetricsRoutes(webServer, c)`；`c` 里是这一族**用到但不属于它**的东西：
 *   · `disposers` ← `apply` 的清理句柄数组（注册返回值与采样器都要推进去）
 *   · `base`      ← 路径前缀 `BASE`（宿主唯一定义处；这里以别名 BASE 使用）
 *   · `log`       ← `lib/log.js` 的宿主日志入口 ⇒ 采样器的注入契约为 `log(msg, level)`
 *
 * 不变量：
 *   · **懒启动**：采样器只在第一次被问到数据时才起（`ensure()`）。没人用这个扩展的
 *     用户，事件循环里不该多一个 1 Hz 定时器、更不该多一个常驻子进程。
 *   · **闲置自停**：30 s 没有请求 ⇒ 采样器连子进程一起收掉（在 `lib/metrics.js` 里）。
 *   · **只读**：永远不改系统状态、不写配置。
 *   · **任何一条指标取不到都不许 500**：`ok: true` + 该序列 `values` 里是 `null` +
 *     `avail` 如实标 false；客户端据此不画那条（`pdh` / `pdhError` 只是诊断字段）。
 *   · `?n=<条数>` 是**客户端的时间窗**（秒数≈条数 @1 Hz）；钳在 10..HISTORY_MAX，
 *     非法值回落 60。`?s=<id,id>` 是客户端**要哪些序列** —— 只要 `cpu`/`mem` 的请求
 *     不会把 PDH 腿（常驻 `typeperf`）拉起来。
 *   · 注册返回值必须推进 `c.disposers`，否则插件卸载 / HMR 之后路由仍挂着已释放的处理器、
 *     采样定时器与子进程也继续存活。
 */

import { createMetricsSampler } from '../metrics.js';

export function registerMetricsRoutes(webServer, c) {
  const { disposers, base: BASE, log } = c;

  const sampler = createMetricsSampler({ log: (m, level) => log(m, level) });

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/metrics`,
    handler: (req, res) => {
      const query = String(req.url || '').split('?')[1] || '';
      const params = new URLSearchParams(query);
      const want = params.get('s') || '';
      const filtered = want
        ? ['cpu', 'mem', 'gpu', 'net', 'disk'].filter((id) => want.indexOf(id) >= 0)
        : null;
      // 只要 CPU/内存的请求不拉 PDH 腿：常驻 typeperf 是这一族最贵的东西，该按需。
      const needsPdh = filtered
        ? filtered.some((id) => id === 'gpu' || id === 'net' || id === 'disk')
        : true;
      // 采样器不认识"过滤器"：它按固定节奏采全部，由这里裁掉本次不发的序列。
      sampler.ensure({ pdh: needsPdh });
      const body = sampler.payload(params.get('n'));
      if (filtered) body.series = body.series.filter((s) => filtered.indexOf(s.id) >= 0);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    },
  }));

  disposers.push(() => sampler.dispose());
}
