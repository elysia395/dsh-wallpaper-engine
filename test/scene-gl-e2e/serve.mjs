// scene-gl E2E harness server: static files + /wallpaper-engine/* proxy → dev daemon.
// Usage: node serve.mjs [port=8932] [target=http://127.0.0.1:41723]
// scene-gl.bundle.js 缺失时自动从 src/scene-gl.js 重打包（生成物已 gitignore）。
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2]) || 8932;
const target = process.argv[3] || 'http://127.0.0.1:41723';
const root = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

const bundlePath = join(root, 'scene-gl.bundle.js');
if (!existsSync(bundlePath)) {
  const src = readFileSync(resolve(root, '../../src/scene-gl.js'), 'utf8');
  writeFileSync(bundlePath, `var __WESceneGL = (function () {\n${src}\n})();\n`);
  console.log('scene-gl.bundle.js rebuilt from src/scene-gl.js');
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/wallpaper-engine/')) {
    // proxy to dev daemon（renderer 用相对路径取 meta/shader/纹理）
    fetch(target + url.pathname + url.search, { signal: AbortSignal.timeout(30000) })
      .then(async (up) => {
        res.statusCode = up.status;
        const ct = up.headers.get('content-type');
        if (ct) res.setHeader('content-type', ct);
        res.end(Buffer.from(await up.arrayBuffer()));
      })
      .catch((e) => { res.statusCode = 502; res.end(String(e)); });
    return;
  }
  let p = join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!p.startsWith(root) || !existsSync(p) || !statSync(p).isFile()) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(port, '127.0.0.1', () => console.log(`e2e harness http://127.0.0.1:${port} → ${target}`));
