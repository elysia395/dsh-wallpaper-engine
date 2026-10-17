/**
 * packages/parallax/lib/index.js —— 「3D 效果」子包的**宿主半边**。
 *
 * 这一族的实现**全在浏览器半边**（packages/parallax/src/*.js，入口 src/client.js，产物
 * lib/client.parallax.js）。宿主侧**零实现、零路由、零服务**：按 ADR-0014 S1.2 / S6.1，纯浏览器包的
 * 宿主半边就是一个满足导出形状的空壳（in-box 的 dsh-client-ui-layout/lib/index.js 全文只有
 * function apply() {}）。它在 cordis.patch.yml 里是一条**独立插件行**
 * （id=wallpaper-engine-parallax / name=本包真实包名）。
 *
 * 但"空壳"不等于"不接线"（m00214 ③）：
 *   ① apply 先经 **Cordis Service**（`export const inject = ['wallpaperEngineHost']`，ADR-0014 S5.1）向
 *      主包要一份本包的**显式键集**（host.keys('parallax', ctx)）—— 缺 id 会抛、不静默 undefined；
 *      服务面是子包与主包之间**唯一**的通道（ADR-0014 S5.1 / S5.3：子包半边零主包说明符、不 import 主包
 *      任何叶子、不出现任何指向主包的相对路径）。启动自检的宿主侧那一半就是这一步。
 *      主包停用 ⇒ 服务随其 fiber 撤销 ⇒ 本子包因 inject 级联 park（ADR-0014 S7.2「关主包 = 关整族」）。
 *   ② 拆除账照交：ADR-0013 D15 / ADR-0014 S6.2「teardown 必须交 ctx.effect」⇒ 用 host.handOff(ctx, dispose) 转发。
 *      宿主半边零副作用 ⇒ dispose 是空操作，但形状与 lib/components/<组件>/index.js 同形。
 *
 * 纪律：不再注册额外 ctx.effect（不留残留，ADR-0014 S6.2）、不读 config、不 acquireKernelLease、
 * 模块顶层只有 import/声明（无求值期副作用、无定时器、无 window/DOM）。产物（lib/client.parallax.js）
 * 落盘前不要声明 dsh.client / exports["./client"]：声明了却没有产物，客户端会按 id 去取那个
 * lazy factory 然后抛错（ADR-0014 S3.4）。
 */
export const name = 'dsh-plugin-wallpaper-engine-parallax';

/** 宿主侧只依赖主包供给的跨包服务面（ADR-0014 S5.1）：'wallpaperEngineHost' 是子包半边**唯一**的注入项。 */
export const inject = ['wallpaperEngineHost'];

export function apply(ctx) {
  const host = ctx.wallpaperEngineHost;
  // ① 显式键集：服务契约是"缺 id 抛错（不静默 undefined）"，这里再兜一层形状判据。
  //    （主包 SUBPACKAGE_KEY_TABLE.parallax = base / log（不消费的键不进表）；传 ctx 让 log 同时落平台通道。）
  const keys = host.keys('parallax', ctx);
  if (keys === null || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new Error('[wallpaper-engine-parallax] host.keys("parallax") 没有返回键集对象（ADR-0014 S5.1 / S5.4 服务面显式键集契约）');
  }
  // 宿主半边刻意**不用** keys 做任何事（这一族的全部行为都在浏览器半边）。
  // 读一次 = 键表真的存在，失败即大声抛：这就是启动自检里属于宿主半边的那一半。
  void keys;
  // ② 拆除账照交（ADR-0013 D15 / ADR-0014 S6.2）：空壳 = 空操作，但 teardown 必须走 ctx.effect。
  return host.handOff(ctx, () => {});
}

export default { name, inject, apply };
