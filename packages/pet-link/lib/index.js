import { registerOfficialPetRoutes } from './routes/official-pet.js';
import { registerPetInstallRoutes } from './routes/pet-install.js';
import { createStateProbe } from './pet-install/state-probe.js';

/**
 * 解析当前 DSH profile 目录（原 transaction.js 的 resolveProfileDir，随下载器一起移除后内联保留）。
 *
 * 优先级：config.profileDir → 环境变量 DSH_PROFILE_DIR → <home>/.dsh/profiles/desktop。
 * 只用于「报告运行时装在哪」，不再参与任何下载或写盘。
 * @param env - process.env（可注入便于测试）
 * @returns {string|null} 绝对路径；都取不到时返回 null
 */
function resolveProfileDirLocal(env = {}) {
  const e = env || {};
  const fromEnv = e.DSH_PROFILE_DIR || e.DSH_PROFILE || '';
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  const home = e.USERPROFILE || e.HOME || '';
  if (typeof home === 'string' && home.trim()) {
    return home.trim().replace(/[\\/]+$/, '') + '/.dsh/profiles/desktop';
  }
  return null;
}


export const name = 'dsh-plugin-wallpaper-engine-pet-link';
export const inject = ['webServer', 'wallpaperEngineHost'];
export const routeConfigs = Object.freeze([Object.freeze({})]);

/**
 * 可选服务探测：读取同页可能**不存在**的 Cordis 服务。
 *
 * ⚠️ 这是可选探测，不是必需依赖 —— 不许把 petApiDshwe 加进上面的 inject。
 *
 * 为什么用 `ctx.get` 而不是 inject 声明：pet-link 必须在「没装 dsh-pet-dshwe」时也能加载，
 * 这是双 provider 的降级前提（联动计划 §3.3）。本机 DSH（dsh-desktop-next 2.0.20-next）实际
 * 使用的 `@deepseek-ai/cordis@4.0.5` 里，`Inject = (keyof M)[] | { [K in keyof M]?: M[K] }`：
 * 对象形态的键值对是「服务名 → 拦截配置」，**没有** required / optional 之分；凡写进 inject 的
 * 服务都是**必需依赖**（fiber 会等它出现才激活，见 registry.ts「required service」）。
 * 相反，`ctx.get(name)` 是 Cordis 官方提供的「不声明 inject 也能读服务」的入口
 * （reflect.ts：「Read a service from the store without the inject requirement」），读不到返回
 * undefined —— 正好是可选探测。所以这里保留 `ctx.get`，并把「可选 vs 必需」的判断收敛到本函数。
 *
 * @param {object} ctx - Cordis 上下文。
 * @param {string} name - 服务名。
 * @returns {any|null} 服务实例；不存在时为 null（绝不让探测异常冒到装载流程）。
 */
export function probeOptionalService(ctx, name) {
  try {
    return ctx && typeof ctx.get === 'function' ? (ctx.get(name) ?? null) : null;
  } catch {
    return null;
  }
}

/** 官方 pet 是用户独立安装的可选插件；装载时不写它的配置或资源目录。
 *
 * ⚠️ 这里**不做资源注入**：九段专属动画与五张气泡图已经内置进 `dsh-pet-dshwe` 自己的包
 * （`assets/webm`、`assets/memes` 与 `assets/config.jsonc` 的 `DSHWE` 池）。桥接只负责发指令，
 * 不再在装载期往运行时数据根写文件 —— 那是「pet 是第三方包、只能外部注入」时代的做法。
 */
export function apply(ctx, config) {
  config ??= {};
  const host = ctx.wallpaperEngineHost;
  if (!host) throw new Error('[wallpaper-engine] pet-link 缺少 wallpaperEngineHost 服务');
  const keys = host.keys('pet-link', ctx);
  const deps = Object.freeze({ ...keys, http: host.http });
  return keys.handOffTeardown(ctx, keys.runComponent('pet-link', ctx, config, deps, applyImpl));
}

export function applyImpl(ctx, config = {}, c) {
  const { webServer } = ctx;
  const { base, http } = c;
  const disposers = [];
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    for (const off of disposers.splice(0).reverse()) {
      try { off(); } catch { /* 继续归还其余注册。 */ }
    }
  };
  try {
    registerOfficialPetRoutes(webServer, { disposers, base, http }, {
      isLinkEnabled: () => config.linkEnabled !== false,
    });
    // 运行时安装控制面（M4）：状态 / 安装（pnpm 优先 + tgz 兜底）/ 卸载。
    const profileDir = config.profileDir || resolveProfileDirLocal(process.env);
    const installer = createStateProbe({
      profileDir,
      // config 显式给 run（含 null=无 pnpm）时用它，否则走默认 pnpm runner（固定 hoisted）。
      run: Object.prototype.hasOwnProperty.call(config, 'run') ? config.run : null,
      // 可选探测：本页没有 dsh-pet-dshwe 时返回 false，不影响 pet-link 装载（见 probeOptionalService）。
      probeRunning: () => Boolean(probeOptionalService(ctx, 'petApiDshwe')),
    });
    registerPetInstallRoutes(webServer, { disposers, base, http }, { installer });
  } catch (error) { dispose(); throw error; }
  return dispose;
}
