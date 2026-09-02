// Temporary visual-preview server (deleted after QA). Serves the harness page,
// React UMD builds and the built client bundle — all static; the page stubs
// the plugin's HTTP API in-page.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const html = (theme) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WE picker preview — ${theme}</title>
<style>
  body { margin: 0; font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }
  body.fake-app {
    min-height: 100vh; display: flex; gap: 28px; padding: 28px; box-sizing: border-box;
    align-items: flex-start;
  }
  body.fake-app.light {
    background:
      radial-gradient(1100px 640px at 18% 12%, #c9d8ef 0%, transparent 62%),
      radial-gradient(900px 560px at 82% 88%, #eed3da 0%, transparent 58%),
      linear-gradient(160deg, #eef1f6, #dde3ec);
    --dsw-alias-label-primary: #1b1e26;
    --dsw-alias-label-secondary: rgba(27, 30, 38, 0.72);
    --dsw-alias-label-tertiary: rgba(27, 30, 38, 0.5);
    --dsw-alias-label-dimmed: rgba(27, 30, 38, 0.42);
    --dsw-alias-bg-layer-1: rgba(255, 255, 255, 0.55);
    --dsw-alias-bg-layer-2: rgba(255, 255, 255, 0.4);
    --dsw-alias-bg-layer-3: rgba(255, 255, 255, 0.66);
    --dsw-alias-border-l1: rgba(22, 28, 40, 0.14);
    --dsw-alias-border-l2: rgba(22, 28, 40, 0.22);
  }
  body.fake-app.dark {
    background:
      radial-gradient(1100px 640px at 18% 12%, #33456b 0%, transparent 62%),
      radial-gradient(900px 560px at 82% 88%, #6b3542 0%, transparent 58%),
      linear-gradient(160deg, #232936, #141821);
    --dsw-alias-label-primary: #e9ecf2;
    --dsw-alias-label-secondary: rgba(233, 236, 242, 0.72);
    --dsw-alias-label-tertiary: rgba(233, 236, 242, 0.52);
    --dsw-alias-label-dimmed: rgba(233, 236, 242, 0.4);
    --dsw-alias-bg-layer-1: rgba(30, 34, 46, 0.55);
    --dsw-alias-bg-layer-2: rgba(26, 29, 40, 0.45);
    --dsw-alias-bg-layer-3: rgba(44, 49, 64, 0.62);
    --dsw-alias-border-l1: rgba(255, 255, 255, 0.14);
    --dsw-alias-border-l2: rgba(255, 255, 255, 0.22);
  }
  .fake-dialog {
    flex: 1 1 720px; max-width: 780px; min-width: 0;
    border-radius: 24px; padding: 20px 22px; box-sizing: border-box;
    background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.4));
    -webkit-backdrop-filter: blur(18px) saturate(1.6);
    backdrop-filter: blur(18px) saturate(1.6);
    border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2));
    box-shadow: 0 24px 80px rgba(0, 7, 18, 0.35);
    font-size: 14px;
  }
  #drawer-mount { flex: 0 0 auto; }
  /* 抽屉在 harness 里以相对定位常开呈现（真实环境为 fixed 25vw 抽屉）。 */
  #drawer-mount > .we-repo-panel {
    position: relative !important; top: 0; right: 0;
    width: 380px !important; max-width: none !important;
    height: auto !important; min-height: 860px;
    transform: none !important; opacity: 1 !important;
    visibility: visible !important; pointer-events: auto !important;
    border-radius: 24px; border: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.2)) !important;
  }
  .we-repo-panel__body .we-picker__section-list { display: contents; }
  .we-repo-panel__body .we-picker__card-shell { border: 0; background: transparent; padding: 0; box-shadow: none; }
  .drawer-cap { font-size: 12px; opacity: .6; margin: 0 0 10px; }
</style>
<script>
  // ── 在加载插件前拦截其 HTTP API（同源 fetch stub）──
  (function () {
    const svg = (c1, c2, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/>' +
      '</linearGradient></defs><rect width="320" height="180" fill="url(#g)"/>' +
      '<text x="50%" y="54%" font-size="30" fill="rgba(255,255,255,.9)" text-anchor="middle" font-family="sans-serif">' + label + '</text></svg>');
    const WALLS = [
      { id: 'w1', title: '晨雾山谷', type: 'image', playable: true, media: 'x', preview: svg('#7fa8d9', '#e8d9c8', ' valley'), contentrating: 'Everyone' },
      { id: 'w2', title: '霓虹夜雨', type: 'video', playable: true, media: 'x', preview: svg('#4a3d8f', '#d9537a', 'neon rain'), contentrating: 'Everyone' },
      { id: 'w3', title: '星野慢波', type: 'video', playable: true, media: 'x', preview: svg('#1d2b53', '#7fa8d9', 'starfield'), contentrating: 'Everyone' },
      { id: 'w4', title: '夏日海边', type: 'video', playable: true, media: 'x', preview: svg('#3fa7c2', '#f2e2b3', 'summer sea'), contentrating: 'Everyone' },
      { id: 'w5', title: '液态玻璃', type: 'web', playable: true, media: 'x', preview: svg('#67DCE7', '#DD8FAC', 'liquid'), contentrating: 'Everyone' },
      { id: 'w6', title: '秋日森林', type: 'image', playable: true, media: 'x', preview: svg('#c0762e', '#5c4a32', 'autumn'), contentrating: 'Everyone' },
      { id: 'w7', title: '极光之境', type: 'video', playable: true, media: 'x', preview: svg('#274690', '#5eead4', 'aurora'), contentrating: 'Everyone' },
      { id: 'w8', title: '粉色沙丘', type: 'image', playable: true, media: 'x', preview: svg('#e8a0b4', '#f2e2d3', 'dunes'), contentrating: 'Everyone' },
    ];
    window.__WE_WALLS__ = WALLS;
    const res = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.indexOf('/wallpaper-engine/settings') !== -1) {
        if (opts && opts.method === 'PUT') return res({ ok: true });
        return res({ ok: true, betterSidebar: true });
      }
      if (u.indexOf('/wallpaper-engine/inventory') !== -1) {
        return res({ installDir: 'D:/WallpaperEngine', total: 8, portableCount: 8, playlists: [], wallpapers: WALLS });
      }
      return res({ ok: true });
    };
    // 预置：选中图片壁纸（ vinyl 封面可见）+ 关掉更新公告弹窗。
    // 仅为全新环境播种；已有存档（如已关闭公告的 noticeSeen）不得覆盖。
    if (!localStorage.getItem('dsh-wallpaper-engine:selection')) {
      localStorage.setItem('dsh-wallpaper-engine:selection', JSON.stringify({
        id: 'w1', noticeSeen: '0.6.8',
      }));
    }
  })();
</script>
</head>
<body class="fake-app ${theme}"${theme === "dark" ? " data-ds-dark-theme" : ""}>
  <div class="fake-dialog" id="settings-mount"></div>
  <div id="drawer-mount"><p class="drawer-cap">↓ 主界面右侧 · 壁纸仓库抽屉（380px 模拟 25vw）</p></div>
  <script src="/node_modules/react/umd/react.production.min.js"></script>
  <script src="/node_modules/react-dom/umd/react-dom.production.min.js"></script>
  <script>window.__ModuleLoader__ = { load(h) { window.__WE__ = h; } };</script>
  <script src="/lib/client.js"></script>
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      const params = new URLSearchParams(location.search);
      const tab = params.get('tab');
      if (tab) localStorage.setItem('dsh-wallpaper-engine:picker-tab', tab);
      const require_ = (s) => (s === 'react' ? window.React : s === 'react-dom' ? window.ReactDOM : null);
      const api = window.__WE__.factory(require_);
      api.apply({
        slots: { inject: (k, cb) => cb(), register: (opts, render) => { window.__WE_RENDER__ = render; } },
        effect: (fn) => { fn(); return fn; },
      });
      const mount = (el) => {
        const r = ReactDOM.createRoot(el);
        r.render(window.__WE_RENDER__());
        return r;
      };
      mount(document.getElementById('settings-mount'));
      // 抽屉：手搭 aside（真实环境由 RopeDock 拉开），正文挂同一 render 的副本。
      const aside = document.createElement('aside');
      aside.className = 'we-repo-panel we-repo-panel--open';
      aside.setAttribute('aria-label', '壁纸仓库面板');
      aside.innerHTML = '<div class="we-repo-panel__head">' +
        '<span class="we-repo-panel__title">壁纸仓库</span>' +
        '<button class="we-picker__btn" type="button">收起</button></div>';
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'we-repo-panel__body';
      aside.appendChild(bodyDiv);
      document.getElementById('drawer-mount').appendChild(aside);
      mount(bodyDiv);
      window.__WE_READY__ = true;
    });
  </script>
</body>
</html>`;

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = url.pathname;
  let body;
  if (path === '/' || path === '/index.html') {
    const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(html(theme));
    return;
  }
  try {
    path = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
    const file = join(root, path);
    if (!file.startsWith(root)) throw new Error('traversal');
    body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[join(path).slice(join(path).lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('nope');
  }
}).listen(8137, () => console.log('preview server on http://localhost:8137'));
