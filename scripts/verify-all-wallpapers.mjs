/**
 * verify-all-wallpapers.mjs — full-library end-to-end verification.
 *
 * Spins up the plugin with a mock webServer (same harness pattern as
 * verify-scene.mjs level B), pulls the real inventory, then for EVERY scene
 * wallpaper in the library exercises the full client-facing chain offline:
 *
 *   1. /scene-video/<token>   — top-priority path (embedded mp4 present?)
 *   2. /scene-gl-meta/<token> — GL gate verdict (supported / reason / degraded)
 *   3. /scene-frame/<token>   — static fallback frame (extractor composite)
 *
 * Extracted frames are written to <root>/.verify-all/ for visual review, and a
 * machine-readable report lands in <root>/.verify-all/report.json. The frame
 * cache is env-isolated (.test-cache) so the run never touches the real
 * ~/.dsh-wallpaper-engine cache.
 *
 * Usage:  node scripts/verify-all-wallpapers.mjs [--lib <dir>]
 *   --lib overrides the loose library dir (default ~/Pictures/WallpaperEngine).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.verify-all');
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const libFlag = args.indexOf('--lib');
const libDir = libFlag >= 0 ? resolve(args[libFlag + 1])
  : join(process.env.HOME || '/', 'Pictures', 'WallpaperEngine');

// Env isolation BEFORE importing the plugin (index.js reads these at startup).
process.env.DSH_WE_CACHE_DIR = join(root, '.test-cache', 'frames-all');
process.env.DSH_WE_LOOSE_DIR = libDir;

const BASE = '/wallpaper-engine';

// ── Mock host harness (mirror of verify-scene.mjs level B) ───────────────────
const routes = [];
const mockCtx = {
  webServer: {
    register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
    tapIndex() { return () => {}; },
  },
};
const hostMod = await import(pathToFileURL(resolve(root, 'lib', 'index.js')).href);
const host = hostMod.default || hostMod;
const dispose = (host.apply || (host.inject && host.apply))(mockCtx);
const route = (name) => routes.find((r) => r.path === `${BASE}/${name}`);

function fakeReq(url) { return { url, headers: {}, method: 'GET' }; }
function fakeRes() {
  const state = { status: 200, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = new Writable({
    write(chunk, enc, cb) { state.body = Buffer.concat([state.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); cb(); },
    final(cb) { state.ended = true; cb(); },
  });
  res.setHeader = (k, v) => { state.headers[k] = v; };
  res.writeHead = (s, h) => { state.status = s; if (h) Object.assign(state.headers, h); };
  Object.defineProperty(res, 'statusCode', { get: () => state.status, set: (v) => { state.status = v; } });
  res.__state = state;
  return res;
}
async function runHandler(rt, url) {
  const res = fakeRes();
  const done = rt.handler(fakeReq(url), res);
  if (done && typeof done.then === 'function') await done;
  if (!res.__state.ended) {
    await new Promise((resolveFn) => {
      const t = setTimeout(resolveFn, 30000);
      res.on('finish', () => { clearTimeout(t); resolveFn(); });
    });
  }
  return res;
}
const jsonBody = (res) => { try { return JSON.parse(res.__state.body.toString('utf8')); } catch { return null; } };

// ── Inventory ────────────────────────────────────────────────────────────────
const invRoute = route('inventory');
if (!invRoute) { console.error('FATAL: inventory route not registered'); process.exit(1); }
const inv = jsonBody(await runHandler(invRoute, `${BASE}/inventory`));
const scenes = (inv.wallpapers || []).filter((w) => w.type === 'scene');
console.log(`library: ${libDir}`);
console.log(`wallpapers: ${inv.wallpapers.length} total, ${scenes.length} scene\n`);

const frameRoute = route('scene-frame');
const metaRoute = route('scene-gl-meta');
const videoRoute = route('scene-video');

const report = [];
for (const w of scenes) {
  const token = w.frameUrl ? w.frameUrl.split('/').pop() : null;
  const row = { id: w.id, title: w.title, token };
  console.log(`── ${w.id}  ${w.title || ''}`);

  // 1. embedded scene video (top priority in the client chain)
  if (videoRoute && token) {
    const t0 = Date.now();
    const res = await runHandler(videoRoute, `${BASE}/scene-video/${token}`);
    // The mp4 stream can be large; only the status matters here.
    row.sceneVideo = res.__state.status === 200 ? 'mp4' : `http-${res.__state.status}`;
    console.log(`   scene-video : ${row.sceneVideo} (${Date.now() - t0}ms, ${res.__state.body.length}B buffered)`);
  }

  // 2. GL gate meta
  if (metaRoute && token) {
    const res = await runHandler(metaRoute, `${BASE}/scene-gl-meta/${token}`);
    const meta = jsonBody(res);
    if (!meta) {
      row.gl = { http: res.__state.status, error: 'unparseable body' };
    } else {
      row.gl = {
        http: res.__state.status,
        supported: meta.supported === true,
        reason: meta.reason || null,
        degraded: meta.degraded || [],
        objects: meta.scene && meta.scene.objects ? meta.scene.objects.length : 0,
      };
    }
    const d = row.gl.degraded || [];
    console.log(`   scene-gl    : http=${row.gl.http} supported=${row.gl.supported}${row.gl.reason ? ' reason=' + row.gl.reason : ''} objects=${row.gl.objects} degraded=[${d.join(', ')}]`);
  }

  // 3. static frame (extractor composite)
  if (frameRoute && token) {
    const t0 = Date.now();
    const res = await runHandler(frameRoute, `${BASE}/scene-frame/${token}`);
    const ctype = res.__state.headers['Content-Type'] || res.__state.headers['content-type'] || '';
    const ok = res.__state.status === 200 && res.__state.body.length > 1000 && /image\/(png|jpeg)/.test(ctype);
    if (ok) {
      const ext = ctype.includes('jpeg') ? 'jpg' : 'png';
      const file = join(OUT, `${w.id}.${ext}`);
      writeFileSync(file, res.__state.body);
      row.frame = { http: 200, mime: ext, bytes: res.__state.body.length, file, ms: Date.now() - t0 };
      console.log(`   scene-frame : OK ${ext} ${res.__state.body.length}B ${Date.now() - t0}ms → ${file}`);
    } else {
      const errBody = jsonBody(res);
      row.frame = { http: res.__state.status, error: errBody && errBody.error ? errBody.error : ctype || 'no image' };
      console.log(`   scene-frame : FAIL ${row.frame.http} ${row.frame.error}`);
    }
  }
  report.push(row);
}

if (typeof dispose === 'function') dispose();
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));

// ── Summary ──────────────────────────────────────────────────────────────────
const n = report.length;
const okFrame = report.filter((r) => r.frame && r.frame.http === 200).length;
const okGl = report.filter((r) => r.gl && r.gl.supported).length;
const hasVideo = report.filter((r) => r.sceneVideo === 'mp4').length;
const scriptNotes = report.filter((r) => (r.gl.degraded || []).some?.((d) => d && d.feature === 'scene-script')).length;
console.log(`\nsummary: ${n} scene wallpapers | sceneVideo=${hasVideo} | GL-supported=${okGl} | frame-ok=${okFrame} | script-notice=${scriptNotes}`);
console.log(`report: ${join(OUT, 'report.json')}`);
process.exit(okFrame === n ? 0 : 2);
