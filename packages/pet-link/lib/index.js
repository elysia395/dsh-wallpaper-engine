import { registerPetLinkRoutes } from './routes/pet-link.js';

export const name = 'dsh-plugin-wallpaper-engine-pet-link';
export const inject = ['webServer', 'wallpaperEngineHost'];

/** 从宿主服务领取本子包的最小键集；首次桌宠注入仍须显式运行安装器。 */
export function apply(ctx, config) {
  config ??= {};
  const host = ctx.wallpaperEngineHost;
  if (!host) throw new Error('[wallpaper-engine] pet-link 缺少 wallpaperEngineHost 服务');
  const keys = host.keys('pet-link', ctx);
  return keys.handOffTeardown(ctx, keys.runComponent('pet-link', ctx, config, keys, applyImpl));
}

export function applyImpl(ctx, config = {}, c) {
  const { base } = c;
  const disposers = [];
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    for (const off of disposers.splice(0).reverse()) {
      try { off(); } catch { /* 继续归还其余注册。 */ }
    }
  };
  const webServer = ctx.webServer;
  try {
    registerPetLinkRoutes(webServer, { disposers, base }, {
      isLinkEnabled: () => config.linkEnabled !== false,
    });
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
