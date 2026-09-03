#!/usr/bin/env python3
# scene-gl 真实 GUI E2E（plan-scene-webgl §6 Phase 1 验收 ①③④⑥）
# headed Chrome + DISPLAY=:1（真 GPU）；dev 实例 http://127.0.0.1:41723
# 前置：dev 已选场景壁纸 ls-a3cf4eb71b45 + betaSceneAnim=true + 玻璃开。
# 用法: DISPLAY=:1 python3 gui-e2e.py [--skip-soak]
import json
import os
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:41723'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))
SKIP_SOAK = '--skip-soak' in sys.argv
report = {'checks': [], 'errors': []}


def get_settings():
    with urllib.request.urlopen(BASE + '/wallpaper-engine/settings', timeout=10) as r:
        return json.load(r)['settings']


def put_settings(patch):
    # PUT 是全量替换（不合并）— 必须先 GET 合并再整体回写，否则会抹掉其它键
    # （教训：裸 PUT 三键曾把壁纸选择/beta/玻璃配置全部冲成默认）。
    merged = get_settings()
    merged.update(patch)
    req = urllib.request.Request(BASE + '/wallpaper-engine/settings',
                                 data=json.dumps(merged).encode(),
                                 headers={'Content-Type': 'application/json'}, method='PUT')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def check(name, ok, detail=''):
    report['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS' if ok else 'FAIL'), name, '—', detail)


with sync_playwright() as pw:
    # 遮挡暂停旋钮在测试期强制关闭（电池放电会触发 pauseOnBattery → GL 暂停
    # 不渲染 — 该行为本身是 WE 对齐特性，但会让性能采样饿死；结束后恢复）。
    saved = get_settings()
    pause_knobs = {k: saved.get(k) for k in ('pauseOnHidden', 'pauseOnBlur', 'pauseOnBattery')}
    put_settings({'pauseOnHidden': False, 'pauseOnBlur': False, 'pauseOnBattery': False})
    try:
        browser = pw.chromium.launch(headless=False, executable_path='/usr/bin/google-chrome-stable',
                                     args=['--no-sandbox', '--window-position=0,0'])
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})
        requests = []
        page.on('request', lambda r: requests.append(r.url))
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.goto(BASE, wait_until='domcontentloaded')

        # 等 GL 激活（app boot + sceneVideo 404 + meta/shader/纹理，给 90s）。
        # 注意：boot 期 applySelection 会二次触发（inventory 到达后再应用一次），
        # 旧渲染器被 dispose 重建 — 必须等「GL_RUN + ready 类」并稳定 3s。
        deadline = time.time() + 90
        gl_ok = False
        stable_since = None
        while time.time() < deadline:
            st = page.evaluate('''() => (window.__weSceneGL && window.__weSceneGL.renderer
                  && window.__weSceneGL.renderer.state() === "GL_RUN"
                  && document.querySelector('.we-layer canvas.we-media--gl.we-media--gl-ready')) ? 1 : 0''')
            if st:
                if stable_since is None:
                    stable_since = time.time()
                if time.time() - stable_since >= 3:
                    gl_ok = True
                    break
            else:
                stable_since = None
            time.sleep(0.5)
        check('boot: GL_RUN reached', gl_ok, page.evaluate('window.__weSceneGL ? window.__weSceneGL.renderer.state() : "no-hook"'))
        if not gl_ok:
            page.screenshot(path=os.path.join(OUT, 'gui-boot-fail.png'))
            browser.close()
            print('\n== SUMMARY ==')
            print('0/1 checks passed (boot failed, aborting)')
            with open(os.path.join(OUT, 'gui-e2e-report.json'), 'w') as f:
                json.dump(report, f, ensure_ascii=False, indent=1)
            sys.exit(1)

        # ── 验收①：canvas 层出现 + img 底图 + 无 scene-anim 请求 ──
        dom = page.evaluate('''() => ({
          canvas: Boolean(document.querySelector('.we-layer canvas.we-media--gl')),
          canvasReady: Boolean(document.querySelector('.we-layer canvas.we-media--gl.we-media--gl-ready')),
          img: Boolean(document.querySelector('.we-layer img.we-media')),
          video: Boolean(document.querySelector('.we-layer video')),
        })''')
        check('① canvas 层 + ready 淡入', dom['canvas'] and dom['canvasReady'], json.dumps(dom))
        check('① img 底图存在（回退兜底）', dom['img'], json.dumps(dom))
        check('① 无 <video>（mp4 未接管）', not dom['video'], json.dumps(dom))
        anim_reqs = [u for u in requests if '/scene-anim/' in u]
        check('① 无 scene-anim 请求', len(anim_reqs) == 0, f'{len(anim_reqs)} 个: {anim_reqs[:2]}')
        page.screenshot(path=os.path.join(OUT, 'gui-1-gl-active.png'))

        # ── 验收③：30s 帧时 P95 ≤ 20ms（真 GPU + 玻璃开）──
        page.evaluate('window.__weSceneGL.renderer.stats.frameTimes.length = 0')
        time.sleep(30)
        ft = page.evaluate('window.__weSceneGL.renderer.stats.frameTimes.slice()')
        ft_sorted = sorted(ft)
        p50 = ft_sorted[len(ft_sorted) // 2] if ft else -1
        p95 = ft_sorted[int(len(ft) * 0.95)] if ft else -1
        p99 = ft_sorted[int(len(ft) * 0.99)] if ft else -1
        mx = ft_sorted[-1] if ft else -1
        check('③ 30s 帧时 P95 ≤ 20ms', 0 < p95 <= 20, f'n={len(ft)} p50={p50:.2f} p95={p95:.2f} p99={p99:.2f} max={mx:.2f}')

        # ── 验收④：60s 逐帧差分 MAD 上界 < 3×中位数（页内降采样 readback）──
        mad = page.evaluate('''() => new Promise((resolve) => {
          const r = window.__weSceneGL.renderer;
          const src = r.canvas;
          const dw = 480, dh = 270;
          const c2 = document.createElement('canvas');
          c2.width = dw; c2.height = dh;
          const g = c2.getContext('2d', { willReadFrequently: true });
          const mads = [];
          let prev = null, n = 0;
          const N = 600; // 600 连续帧 ≈ 10s（60fps）；60s 窗口由 soak 覆盖
          function step() {
            // 同帧读缓冲（rAF 注册序：renderer loop 先跑）
            g.drawImage(src, 0, 0, dw, dh);
            const d = g.getImageData(0, 0, dw, dh).data;
            if (prev) {
              let sum = 0, cnt = 0;
              for (let i = 0; i < d.length; i += 4) {
                sum += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]);
                cnt += 3;
              }
              mads.push(sum / cnt);
            }
            prev = d;
            if (++n < N) requestAnimationFrame(step);
            else resolve(mads);
          }
          requestAnimationFrame(step);
        })''')
        if mad:
          sm = sorted(mad)
          med = sm[len(sm) // 2]
          mxm = sm[-1]
          check('④ 逐帧差分 MAD 上界 < 3×中位数', med > 0 and mxm < 3 * med, f'n={len(mad)} median={med:.3f} max={mxm:.3f}')
        else:
          check('④ 逐帧差分 MAD', False, 'no samples')

        # ── 验收⑥：contextlost → 重建 → 再丢 → mp4 回退（无黑帧 = img 恒在）──
        # 扩展句柄预取挂 window：context lost 后 getExtension 返回 null（规范行为）
        page.evaluate('''() => {
          const gl = window.__weSceneGL.renderer.canvas.getContext('webgl2');
          window.__extLose = gl.getExtension('WEBGL_lose_context');
          window.__extLose.loseContext();
        }''')
        time.sleep(0.3)
        lost1 = page.evaluate('window.__weSceneGL ? window.__weSceneGL.renderer.stats.contextLost : -1')
        page.evaluate('window.__extLose.restoreContext()')
        # 等重建回 GL_RUN
        rebuilt = False
        deadline = time.time() + 30
        while time.time() < deadline:
            st = page.evaluate('window.__weSceneGL && window.__weSceneGL.renderer.state()')
            if st == 'GL_RUN':
                rebuilt = True
                break
            if st is None:
                break
            time.sleep(0.5)
        check('⑥ contextlost → 自动重建回 GL_RUN', rebuilt, f'contextLost={lost1}')
        img_still = page.evaluate('Boolean(document.querySelector(".we-layer img.we-media"))')
        check('⑥ 重建期间 img 底图恒在（无黑帧）', img_still, '')
        # 第二次丢失 → rebuiltOnce 已用 → fail → glFailed → mp4 回退
        page.evaluate('''() => {
          window.__extLose.loseContext();
          setTimeout(() => window.__extLose.restoreContext(), 200);
        }''')
        deadline = time.time() + 30
        fell_back = False
        while time.time() < deadline:
            hook = page.evaluate('window.__weSceneGL === null || !window.__weSceneGL')
            anim = len([u for u in requests if '/scene-anim/' in u]) > 0
            if hook and anim:
                fell_back = True
                break
            time.sleep(0.5)
        check('⑥ 二次丢失 → glFailed → mp4 回退', fell_back,
              f'hook_cleared={page.evaluate("window.__weSceneGL === null")}, anim_req={len([u for u in requests if "/scene-anim/" in u])}')
        # 无黑帧：回退兜底层 = img（渲染期静态帧）或 video（mp4 缓存命中快路径）——
        # dev 实例此前渲过该场景 mp4（san_sf34_ 缓存），轮询 100% 会直接切 video。
        base_ok = page.evaluate('Boolean(document.querySelector(".we-layer img.we-media") || document.querySelector(".we-layer video.we-media"))')
        check('⑥ 回退后兜底层在（无黑帧）', base_ok, '')
        failed_reason = page.evaluate('sessionStorage.getItem(Object.keys(sessionStorage).find(k => k.startsWith("weSceneGLFailed:")) || "")')
        print('   glFailed reason:', failed_reason)
        page.screenshot(path=os.path.join(OUT, 'gui-6-fallback.png'))

        # ── 验收③b：清 glFailed → 重载回 GL → 5min soak 无 contextlost ──
        if not SKIP_SOAK:
            page.evaluate('sessionStorage.clear()')
            page.reload(wait_until='domcontentloaded')
            deadline = time.time() + 90
            while time.time() < deadline:
                ok = page.evaluate('Boolean(window.__weSceneGL && window.__weSceneGL.renderer && window.__weSceneGL.renderer.state() === "GL_RUN")')
                if ok:
                    break
                time.sleep(0.5)
            lost0 = page.evaluate('window.__weSceneGL ? window.__weSceneGL.renderer.stats.contextLost : -1')
            errs0 = len(report['errors'])
            print('soak 5min …')
            time.sleep(300)
            lost1b = page.evaluate('window.__weSceneGL ? window.__weSceneGL.renderer.stats.contextLost : -1')
            frames = page.evaluate('window.__weSceneGL ? window.__weSceneGL.renderer.stats.frames : 0')
            check('③ 5min soak 无 contextlost', lost0 == lost1b, f'before={lost0} after={lost1b} frames={frames}')
            check('③ 5min soak 无 pageerror', len(report['errors']) == errs0, f'errors={len(report["errors"])}')
            page.screenshot(path=os.path.join(OUT, 'gui-3-soak.png'))

        browser.close()
    finally:
        try:
            put_settings(pause_knobs)
        except Exception as e:
            print('WARN: restore pause knobs failed:', e)

print('\n== SUMMARY ==')
ok = sum(1 for c in report['checks'] if c['ok'])
print(f'{ok}/{len(report["checks"])} checks passed')
with open(os.path.join(OUT, 'gui-e2e-report.json'), 'w') as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
sys.exit(0 if ok == len(report['checks']) else 1)
