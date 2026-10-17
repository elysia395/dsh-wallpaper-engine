/**
 * lib/shim-seed.js —— web shim / 网页壁纸属性 seed / 侧栏安装检测（P0.2-C 纯搬移）
 *
 * 从 `lib/index.js` 整段搬出：`readWebShim`（缓存 + 注入 `web-shim.js`）、
 * `userPropsFor` / `buildSeedScript`（project.json + 用户覆盖值 → seed 脚本）、
 * `isBetterSidebarLoaded`（安装检测）。**逐字保真**：只做 +2 缩进与工厂包裹。
 *
 * ①`WEBWALLGL_DIR` 由 we-assets 套件以值常量提供（④ 之后建，无初始化环）；`readSettings`
 * 由门面注入（configKit）。
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseUserPropDefs, entryDirPrefix } from './we-props.js';

export function createShimSeedKit(deps) {
  // ⚠️ `WEBWALLGL_PKG_DIR` 是 **webwallgl 包目录**（shim 正文的取源），与 `WEBWALLGL_DIR`
  // （随包内建页面目录）不是同一个 —— 前者缺失时 readWebShim 降级为空串（注入整条跳过）。
  const { WEBWALLGL_PKG_DIR, readSettings } = deps;

  /**
   * WE web-wallpaper API shim, vendored next to the renderer page by the same
   * sync script. Injected into web-wallpaper HTML responses by /scene-files —
   * under the strict sandbox the renderer page cannot reach into the wallpaper
   * iframe, so the shim must ride along with the document. Read once and cached;
   * an absent file degrades silently (the wallpaper still runs, just without the
   * WE API surface).
   */
  let webShimCache;
  /**
   * 模板字面量"煮熟"：把 bundle 里的转义序列还原成真实字符（上游同款）。
   * 只处理 \u{…} / \uXXXX / \xXX 与换行续行，其余原样。
   */
  function cookTemplateLiteral(raw) {
    const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
    return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, e) => {
      if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e[1] === '{' ? e.slice(2, -1) : e.slice(1), 16));
      if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
      if (e === '\n' || e === '\r\n' || e === '\r') return '';
      return e in simple ? simple[e] : e;
    });
  }

  /**
   * 从 `webwallgl` 包的 `webwallgl.mjs` 里提取 shim 正文。
   * ⚠️ **npm 包不单独发 web-shim.js 这个文件** —— shim 就是 bundle 里的
   * `const shimSource = \`…\`;` 模板字面量（引擎自己在 fetch-rewrite 路径上注入的同一份文本）。
   * 带 `\${` 插值就拒（那是拼装过的文本，不能当源用）；形态变了提取得空串 ⇒ 上层照旧静默降级
   * （壁纸仍能跑，只是没有 WE API 表面）—— 判据 test/verify-scene-live.mjs 已钉住"形态还在"。
   */
  function extractWebShim(bundle) {
    const m = /const shimSource = \x60((?:\\[\s\S]|[^\x60\\])*)\x60;/.exec(bundle);
    return m && !/(^|[^\\])\$\{/.test(m[1]) ? cookTemplateLiteral(m[1]) : '';
  }

  /**
   * 读一次并缓存。取源是**包内的 bundle**（见 extractWebShim 的注释），不再是 `web-shim.js`
   * ——旧实现读那个文件永远 ENOENT，于是每次注入都在 catch 里静默返回 '' ⇒ 四段注入整条早退
   * （实测：site-root / shim / focus-guard / seed 四个标记同时缺失）。
   */
  function readWebShim() {
    if (webShimCache !== undefined) return webShimCache;
    try {
      webShimCache = WEBWALLGL_PKG_DIR
        ? extractWebShim(readFileSync(join(WEBWALLGL_PKG_DIR, 'webwallgl.mjs'), 'utf8'))
        : '';
    } catch {
      webShimCache = '';
    }
    return webShimCache;
  }

  /**
   * Build the user-property SEED script for a web wallpaper from the
   * project.json sitting next to its entry file — the same payload WallpaperEM's
   * /web/ middleware writes into the HTML.
   *
   * Why the HOST must do it: workshop web wallpapers read their defaults (colors,
   * line density, …) through `wallpaperPropertyListener.applyUserProperties`,
   * which only ever runs if someone calls the shim's `__weSeedProps`. WallpaperEM
   * injects the seed while rewriting the HTML; our strict-sandbox path serves the
   * original HTML (no rewrite) AND the renderer page cannot reach into the
   * cross-origin iframe at runtime to push props — so without this the wallpaper
   * silently falls back to its own defaults, which for property-driven wallpapers
   * means a black frame (measured: Chroma Drencher draws all-black lines).
   */
  /** 某张壁纸的用户覆盖值（「壁纸属性」面板改过的）：{ [属性名]: 值 }，键是 token。 */
  function userPropsFor(token) {
    try {
      const all = readSettings()?.userProps;
      const v = all && typeof all === 'object' ? all[String(token)] : null;
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }

  function buildSeedScript(entryAbs, token) {
    try {
      const pj = JSON.parse(readFileSync(join(dirname(entryAbs), 'project.json'), 'utf8'));
      // 默认值 + 用户覆盖值（面板里改过的属性要随文档到达，否则壁纸会先用默认值
      // 画一帧再被纠正 —— 属性驱动的壁纸会出现可见跳变）。file 类值按入口所在
      // 目录补前缀（网页壁纸相对入口 URL 解析，与上游 effectiveProps 同语义）。
      const overrides = userPropsFor(token);
      const defs = parseUserPropDefs(pj, overrides, {
        filePrefix: entryDirPrefix(String((pj && pj.file) || '')),
      });
      const wire = {};
      for (const d of defs) {
        if (d.value === null) continue;
        wire[d.name] = { value: d.value };
      }
      if (!Object.keys(wire).length) return '';
      return `window.__weSeedProps(${JSON.stringify(wire)});`;
    } catch {
      return '';
    }
  }

  // dsh-better-sidebar 安装检测：遍历 cordis loader 的条目树（ctx.loader 是根
  // EntryTree，entries() 覆盖所有嵌套子树），找 dsh-better-sidebar 且未禁用的
  // 条目。用它决定浏览器端的「侧栏玻璃」控制组是否显示 —— 不依赖侧栏 DOM 是否
  // 已挂载（侧栏懒加载，DOM 探测会漏判），也不依赖其服务 API（版本间不稳定）。
  // 注意 Entry 本身没有 name getter：包名在 entry.options.name（patch 行的 name
  // 字段，即 import 说明符）；聚合包挂载时条目 id 可能是 web-ui-better-sidebar
  // 之类，故 id 含 better-sidebar 也视为命中。loader 服务随 dsh-base 提供，
  // 读不到时按「未安装」处理。
  function isBetterSidebarLoaded(ctx) {
    try {
      const loader = ctx && ctx.loader;
      if (!loader || typeof loader.entries !== 'function') return false;
      for (const entry of loader.entries()) {
        const opts = entry && entry.options;
        if (!opts || opts.group) continue; // group 节点跳过
        const isSidebar = opts.name === 'dsh-better-sidebar'
          || String(opts.id || '').includes('better-sidebar');
        if (isSidebar && !entry.disabled) return true;
      }
    } catch { /* loader unavailable (headless/embed contexts): treat as absent */ }
    return false;
  }

  return {
    webShimCache,
    readWebShim,
    userPropsFor,
    buildSeedScript,
    isBetterSidebarLoaded,
  };
}
