#!/usr/bin/env node
/**
 * sync-webwallgl.mjs — 从本地 webwallgl-github 仓库构建 WebWallGL 渲染页
 * 产物并 vendor 进 lib/webwallgl/。
 *
 * 产物只包含 dist/renderer/index.html + 它引用的 dist/assets/*（约 1MB；
 * bench 与库产物不进来）。构建使用 --base=/wallpaper-engine/scene-live/，使
 * 产物内的绝对资源引用对齐本插件的 HTTP 前缀（serve 见 lib/index.js 的
 * /scene-live 路由）——默认 base 是 "/"，挂在子路径下会 404。
 *
 * 用法：
 *   node test/tools/sync-webwallgl.mjs                 # 默认上游 ../webwallgl-github
 *   WEBWALLGL_REPO=/path/to/webwallgl node test/tools/sync-webwallgl.mjs
 *
 * 同步后写 lib/webwallgl/.upstream.json（上游 commit / 版本 / 文件清单）。
 * 上游更新渲染器后重跑本脚本即可；手动改 lib/webwallgl/ 会被下次同步
 * 覆盖 —— 需要的改动应做在上游。
 *
 * 溯源（两处本地补丁的**职责归属**：上游都已按契约实现，本地不再各留一份）：
 *   · [diag 级别] 渲染页给 `/diag` 上报时自带 `&lvl=`，级别由发送方声明、
 *     宿主不再靠文案关键字分档。上游 `renderer/src/diag-level.ts` 已按契约
 *     实现（issue #13，878ec88），宿主 `lib/routes/diag.js` 读的就是这个值。
 *   · [xray 精灵] 上游是从语义侧修的（7480a37 exponent 语义 / 0d1d5c1 halo_6 环绕 CLAMP /
 *     5cec4f6 素材重建），**不是**过滤器：在真 GPU 无头浏览器上跑上游 `bench/xray-shot.html`
 *     （壁纸 3475149989，effects/xray，size=0.07，指针居中）实测两档 MIN_FILTER
 *     的像素差为 0（缺精灵贴图时差异 31%，证明该贴图确实在被采样）。所以在本地把
 *     `makeTextureMip` 的 MIN_FILTER 从 `LINEAR_MIPMAP_LINEAR` 改成 `LINEAR` 解决不了它，
 *     还会连带关掉 system/particle/pattern/封面这些纹理的 mip 采样 —— 上游别处
 *     （封面 mip 链重建、puppet 细线淡化）明确依赖它。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// 本文件在 test/tools/ 下 ⇒ 仓库根要退两层（这一行在目录重整时最容易漏改）。
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(ROOT, 'lib', 'webwallgl');
/** 必须与 lib/index.js 的 /scene-live 路由前缀一致（BASE + '/scene-live'）。 */
const BASE_PATH = '/wallpaper-engine/scene-live';

/** 溯源清单里的相对路径：正斜杠（该文件随包发布，不该带平台分隔符）。 */
const relPosix = (p) => p.slice(OUT_DIR.length + 1).replace(/\\/g, '/');

/** 上游仓库 → 构建 → 解析产物清单；返回 `{ repo, pkg, assets }`。 */
function loadUpstream() {
  const repo = resolve(process.env.WEBWALLGL_REPO || join(ROOT, '..', 'webwallgl-github'));
  const pkgPath = join(repo, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(`[sync-webwallgl] 上游仓库不存在或缺少 package.json：${repo}`);
    console.error('                可用 WEBWALLGL_REPO 环境变量指定 webwallgl 仓库路径。');
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.name !== 'webwallgl') {
    console.error(`[sync-webwallgl] ${repo} 不是 webwallgl 仓库（name=${pkg.name}）。`);
    process.exit(1);
  }

  // 1. 构建（跳过上游 npm run build 里的 tsc —— 类型检查属于上游自己的
  //    `npm run check`，这里只要产物）。
  console.log(`[sync-webwallgl] 构建上游 ${repo} (base=${BASE_PATH}/) …`);
  const buildArgs = ['exec', 'vite', 'build', `--base=${BASE_PATH}/`];
  let built = spawnSync('pnpm', buildArgs, { cwd: repo, stdio: 'inherit' });
  if (built.error || built.status !== 0) {
    console.log('[sync-webwallgl] pnpm 不可用或失败，回退 npx …');
    built = spawnSync('npx', buildArgs, { cwd: repo, stdio: 'inherit' });
  }
  if (built.error || built.status !== 0) {
    console.error('[sync-webwallgl] 上游构建失败。');
    process.exit(1);
  }

  // 2. 从 dist/renderer/index.html 提取以 BASE_PATH 为前缀的资源引用，
  //    映射回 dist 内的真实文件。出现非前缀引用说明 base 没生效，直接失败。
  const htmlPath = join(repo, 'dist', 'renderer', 'index.html');
  if (!existsSync(htmlPath)) {
    console.error(`[sync-webwallgl] 缺少 ${htmlPath} —— 上游构建输出结构变化？`);
    process.exit(1);
  }
  const html = readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => r.startsWith('/'));
  if (!refs.length) {
    console.error('[sync-webwallgl] index.html 中没有解析到任何资源引用（结构变化？）');
    process.exit(1);
  }
  const assets = [];
  for (const ref of refs) {
    if (!ref.startsWith(BASE_PATH + '/')) {
      console.error(`[sync-webwallgl] 发现未带 base 前缀的绝对引用：${ref}（base 未生效）`);
      process.exit(1);
    }
    const rel = ref.slice(BASE_PATH.length + 1); // e.g. assets/renderer-xxx.js
    const src = join(repo, 'dist', rel);
    if (!existsSync(src)) {
      console.error(`[sync-webwallgl] 产物引用的文件不存在：${src}`);
      process.exit(1);
    }
    assets.push({ ref, src, out: join(OUT_DIR, rel) });
  }

  // 3. 覆盖式写出（先清空目录，旧 hash 文件名不累积）。
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(htmlPath, join(OUT_DIR, 'index.html'));
  for (const a of assets) {
    mkdirSync(dirname(a.out), { recursive: true });
    copyFileSync(a.src, a.out);
  }
  // 3c-2c. **曝光打点重放**：本仓库对 vendored 渲染器有一处手改 —— `window.__wp={…}`
  // 字面量后追加 `window.__weSetOcclusion` 曝流行（遮挡桥的唯一入口，见
  // docs/wip/LINUX-OCCLUSION.md §5.1）。上游刷新会把它抹掉，这里同步后自动重放；
  // 找不到锚点直接 exit 1（防静默失联 —— verify-scene-live-occlusion Level A 是
  // 第二道网，但那要等下次跑 verify 才红）。
  const rendererAsset = assets.find((a) => /assets\/renderer-.*\.js$/.test(a.out));
  if (!rendererAsset) {
    console.error('[sync-webwallgl] 产物里没有 assets/renderer-*.js —— 上游结构变化？');
    process.exit(1);
  }
  {
    const out = rendererAsset.out;
    let code = readFileSync(out, 'utf8');
    if (!code.includes('__weSetOcclusion')) {
      const anchor = 'window.__wp={';
      const at = code.indexOf(anchor);
      if (at === -1) {
        console.error('[sync-webwallgl] 找不到 `window.__wp={` 锚点 —— 上游控制器形态变化，曝光打点需人工重打');
        process.exit(1);
      }
      // 从锚点起做花括号配平，找到控制器字面量的收尾 `}`，打点插在其后。
      let depth = 0, end = -1;
      for (let i = at + anchor.length - 1; i < code.length; i++) {
        const ch = code[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }
      if (end === -1) {
        console.error('[sync-webwallgl] `window.__wp={…}` 字面量配平失败 —— 打点需人工重打');
        process.exit(1);
      }
      const exposure = ';window.__weSetOcclusion=function(t){try{window.__wp.setOcclusion(t)}catch(e){}};';
      code = code.slice(0, end) + exposure + code.slice(end);
      writeFileSync(out, code);
      console.log('  ↻ 已重放遮挡曝光打点（window.__weSetOcclusion）');
    }
  }
  // web-shim.js 原文：宿主把它注入**网页壁纸**的 HTML 响应（见 lib/index.js 的
  // /scene-files 路由）—— 严格沙箱下渲染页与壁纸 iframe 不同源，shim 只能这样
  // 进入作者页面（渲染页内的 ?raw 版本是给 WallpaperEM 的注入路径用的）。
  const shimSrc = join(repo, 'renderer', 'src', 'web-shim.js');
  if (!existsSync(shimSrc)) {
    console.error(`[sync-webwallgl] 缺少 ${shimSrc} —— 上游 web shim 位置变化？`);
    process.exit(1);
  }
  copyFileSync(shimSrc, join(OUT_DIR, 'web-shim.js'));
  // 兜底页：渲染页在场景解析失败时把一个 iframe 指到
  // `<BASE>/default-wallpaper/index.html`（上游 public/ 下的静态文件，不在构建
  // 产物里）。缺了它，「静默 N 秒超时」没有可见落点 —— 该有兜底页的一次可见
  // 404 都没有（issue #129 证据 4）。上游没有这个文件时不报错（老版本同步兼容）。
  const fallbackSrc = join(repo, 'public', 'default-wallpaper', 'index.html');
  if (existsSync(fallbackSrc)) {
    mkdirSync(join(OUT_DIR, 'default-wallpaper'), { recursive: true });
    copyFileSync(fallbackSrc, join(OUT_DIR, 'default-wallpaper', 'index.html'));
  }
  return { repo, pkg, assets };
}

// 入口：构建 → 拷贝 → 溯源。
const { repo, pkg, assets } = loadUpstream();

/** `.upstream.json` 的 `files` 列：盘上真实存在的名字。 */
const fileList = () => [
  'index.html', 'web-shim.js',
  ...assets.map((a) => relPosix(a.out)),
  ...(existsSync(join(OUT_DIR, 'default-wallpaper', 'index.html')) ? ['default-wallpaper/index.html'] : []),
];

// 4. 溯源信息。
//    ⚠️ **不写本机的仓库路径**：这个文件随包发布（`files` 含 `lib/webwallgl/`），
//    写进去等于把同步机器的绝对路径发给每个用户（本仓被发布面守卫抓到过一次）。
//    `name` + `commit` + `version` 已足够复现"哪一版上游"，路径对复现没有价值。
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
// `--untracked-files=no`：这个字段回答的是"产物是不是从**改过的源码**建出来的"。
// 未跟踪目录（如 pnpm 的 .pnpm-store/）不影响产物，算进来只会让每次同步都报 dirty=true。
const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repo, encoding: 'utf8' });
writeFileSync(join(OUT_DIR, '.upstream.json'), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  commit: commit.status === 0 ? commit.stdout.trim() : null,
  dirty: dirty.status === 0 ? dirty.stdout.trim().length > 0 : null,
  base: BASE_PATH,
  syncedAt: new Date().toISOString(),
  files: fileList(),
}, null, 2) + '\n');

console.log(`[sync-webwallgl] 完成：webwallgl@${pkg.version} → lib/webwallgl/`);
for (const a of assets) console.log(`  + ${a.out.slice(ROOT.length + 1)}`);
console.log('  + index.html / web-shim.js / default-wallpaper/index.html（上游有才拷）/ .upstream.json');
