#!/usr/bin/env python3
# scene-gl E2E capture（Playwright）：加载 harness 页 → 等 GL_RUN → 截图 + stats。
# 用法: capture.py <url> <out.png> [wait_s=6] [--headed] [--dump stats.json]
import json
import sys
import time

from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[2]
WAIT = float(sys.argv[3]) if len(sys.argv) > 3 and not sys.argv[3].startswith('-') else 6.0
HEADED = '--headed' in sys.argv
DUMP = None
if '--dump' in sys.argv:
    DUMP = sys.argv[sys.argv.index('--dump') + 1]

with sync_playwright() as pw:
    if HEADED:
        browser = pw.chromium.launch(headless=False, executable_path='/usr/bin/google-chrome-stable',
                                     args=['--no-sandbox'])
    else:
        browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type in ('error',) else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='domcontentloaded')
    # 等 GL_RUN 或 ERROR（最多 30s — meta 5s + shader + 纹理 10s + watchdog 12s）
    deadline = time.time() + 30
    state = 'BOOT'
    while time.time() < deadline:
        state = page.evaluate('window.__result && window.__result.state')
        if state in ('GL_RUN', 'ERROR'):
            break
        time.sleep(0.25)
    print('state:', state)
    if state == 'GL_RUN':
        time.sleep(WAIT)  # 稳定运行期（帧时统计 / 肉眼检查窗口）
    result = page.evaluate('''() => {
      const r = window.__result;
      const s = r.renderer ? r.renderer.stats : null;
      return {
        state: r.state, ready: r.ready, error: r.error,
        frames: s ? s.frames : 0, contextLost: s ? s.contextLost : -1,
        frameTimes: s ? s.frameTimes : [], errors: s ? s.errors : [],
        lastT: s ? s.lastT : 0,
        canvas: r.renderer ? { w: r.renderer.canvas.width, h: r.renderer.canvas.height } : null,
      };
    }''')
    if DUMP:
        with open(DUMP, 'w') as f:
            json.dump(result, f)
    print('frames:', result['frames'], 'ctxLost:', result['contextLost'],
          'canvas:', result['canvas'], 'error:', result['error'])
    if result['frameTimes']:
        ft = sorted(result['frameTimes'])
        p95 = ft[int(len(ft) * 0.95)]
        print(f'frameTimes n={len(ft)} median={ft[len(ft)//2]:.2f}ms p95={p95:.2f}ms max={ft[-1]:.2f}ms')
    if state == 'GL_RUN':
        # 原子取 (像素, lastT)：preserveDrawingBuffer:false 下 present 后缓冲即清，
        # 必须在渲染同帧内读 — rAF 回调按注册序执行，renderer 的 loop 先注册先渲染，
        # 本回调在其后同帧执行，此刻读缓冲仍有效。
        import base64
        pair = page.evaluate('''() => new Promise((res) => requestAnimationFrame(() => {
          const r = window.__result.renderer;
          res({ png: r.canvas.toDataURL('image/png'), t: r.stats.lastT });
        }))''')
        with open(OUT, 'wb') as f:
            f.write(base64.b64decode(pair['png'].split(',', 1)[1]))
        result['lastT'] = pair['t']
        if DUMP:
            with open(DUMP, 'w') as f:
                json.dump(result, f)
        print('screenshot:', OUT, 'lastT:', pair['t'])
    if errors:
        print('console errors:', errors[:5])
    browser.close()
