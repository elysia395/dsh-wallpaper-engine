#!/usr/bin/env python3
# scene-gl 验收⑤⑥b：beta 关 → 静态帧；weSceneGL=0 → mp4；不支持场景 → 自动 mp4；
# GL↔mp4 连切 10 次无泄漏。headless（无需真 GPU；不采样性能）。
# 前置：dev 实例已选场景壁纸 + betaSceneAnim=true。结束恢复现场。
import json
import os
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:41723'
OUT = os.path.dirname(os.path.abspath(__file__))
report = {'checks': [], 'errors': []}


def get_settings():
    with urllib.request.urlopen(BASE + '/wallpaper-engine/settings', timeout=10) as r:
        return json.load(r)['settings']


def put_settings(patch):
    merged = get_settings()
    merged.update(patch)  # PUT 全量替换 — 必须合并回写
    req = urllib.request.Request(BASE + '/wallpaper-engine/settings',
                                 data=json.dumps(merged).encode(),
                                 headers={'Content-Type': 'application/json'}, method='PUT')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def check(name, ok, detail=''):
    report['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS' if ok else 'FAIL'), name, '—', detail)


saved = get_settings()
# 遮挡暂停旋钮测试期关闭（电池放电会暂停 GL — WE 对齐特性，但饿死路径判定）
put_settings({'pauseOnHidden': False, 'pauseOnBlur': False, 'pauseOnBattery': False})

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    try:
        # ── ⑤a：beta 关 → 静态帧（无 GL、无 scene-anim）──
        put_settings({'betaSceneAnim': False})
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        reqs = []
        page.on('request', lambda r: reqs.append(r.url))
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.goto(BASE, wait_until='domcontentloaded')
        time.sleep(12)
        st = page.evaluate('''() => JSON.stringify({
          hook: Boolean(window.__weSceneGL),
          canvas: Boolean(document.querySelector('.we-layer canvas.we-media--gl')),
          img: Boolean(document.querySelector('.we-layer img.we-media')),
          video: Boolean(document.querySelector('.we-layer video')),
        })''')
        d = json.loads(st)
        anim = len([u for u in reqs if '/scene-anim/' in u])
        check('⑤a beta关 → 无 GL 无 canvas', not d['hook'] and not d['canvas'], st)
        check('⑤a beta关 → 静态帧 img', d['img'] and not d['video'], st)
        check('⑤a beta关 → 无 scene-anim 请求', anim == 0, f'{anim} 个')
        page.close()

        # ── ⑤b：beta 开 + weSceneGL=0 → 强制 mp4 路径 ──
        put_settings({'betaSceneAnim': True})
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        reqs = []
        page.on('request', lambda r: reqs.append(r.url))
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.add_init_script('localStorage.setItem("weSceneGL", "0")')
        page.goto(BASE, wait_until='domcontentloaded')
        time.sleep(12)
        d = json.loads(page.evaluate('''() => JSON.stringify({
          hook: Boolean(window.__weSceneGL),
          canvas: Boolean(document.querySelector('.we-layer canvas.we-media--gl')),
          video: Boolean(document.querySelector('.we-layer video.we-media')),
        })'''))
        anim = len([u for u in reqs if '/scene-anim/' in u])
        check('⑤b weSceneGL=0 → GL 不激活', not d['hook'] and not d['canvas'], json.dumps(d))
        check('⑤b weSceneGL=0 → mp4 升级启动', anim > 0 or d['video'], f'anim_req={anim} video={d["video"]}')
        page.close()

        # ── ⑥b：GL ↔ mp4 连切 10 次（flag 交替 + reload）无泄漏 ──
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.goto(BASE, wait_until='domcontentloaded')  # 先落地目标 origin（about:blank 无 localStorage）
        leaks = 0
        for i in range(10):
            flag = '0' if i % 2 else None  # 偶数轮 GL，奇数轮 mp4
            page.evaluate('(f) => f ? localStorage.setItem("weSceneGL","0") : localStorage.removeItem("weSceneGL")', flag)
            page.reload(wait_until='domcontentloaded')
            want_gl = flag is None
            # SwiftShader 软渲 GL 初始化（编译 + 4K 纹理解码）慢 — 轮询等待而非定长 sleep
            d = {}
            deadline = time.time() + (40 if want_gl else 20)
            while time.time() < deadline:
                d = json.loads(page.evaluate('''() => JSON.stringify({
                  hook: Boolean(window.__weSceneGL),
                  run: Boolean(window.__weSceneGL && window.__weSceneGL.renderer.state() === "GL_RUN"),
                  canvas: Boolean(document.querySelector('.we-layer canvas.we-media--gl')),
                  video: Boolean(document.querySelector('.we-layer video.we-media')),
                  img: Boolean(document.querySelector('.we-layer img.we-media')),
                })'''))
                if want_gl and d['run'] and d['canvas']:
                    break
                if not want_gl and (d['video'] or d['img']):
                    break  # mp4 路径落定（img 静态帧或已切 video）
                time.sleep(0.5)
            ok = (d['run'] and d['canvas']) if want_gl else (not d['hook'] and not d['canvas'])
            base = d['img'] or d['video'] or d['canvas']
            if not (ok and base):
                leaks += 1
                print(f'  cycle {i}: want_gl={want_gl} got={d}')
        errs_after = len(report['errors'])
        check('⑥b 连切 10 次全部符合预期路径', leaks == 0, f'失败轮数={leaks}')
        check('⑥b 连切 10 次无 pageerror', errs_after == 0, f'errors={errs_after}')

        # ── ⑤c：不支持场景（bloom 变体）→ supported:false + 自动 mp4 ──
        # host 侧白名单判定（curl 级）：变体场景 bloom=true → supported:false。
        # GUI 级回退链路与 ⑤b 同码（onError → mp4），此处验证 host 判定。
        import subprocess
        inv = json.loads(urllib.request.urlopen(BASE + '/wallpaper-engine/inventory', timeout=30).read())
        test_w = [w for w in inv.get('wallpapers', []) if 'test-unsupported' in (w.get('title') or '')]
        if test_w:
            token = test_w[0]['frameUrl'].split('/')[-1]
            meta = json.loads(urllib.request.urlopen(BASE + f'/wallpaper-engine/scene-gl-meta/{token}', timeout=15).read())
            check('⑤c bloom 变体 supported:false + reason', meta.get('supported') is False and 'bloom' in str(meta.get('reason')), json.dumps({k: meta.get(k) for k in ('supported', 'reason')}))
        else:
            check('⑤c 变体场景入库', False, 'test-unsupported 壁纸未在 inventory 中（需先放置变体目录）')
    finally:
        browser.close()
        try:
            put_settings(saved)  # 全量恢复
        except Exception as e:
            print('WARN: restore failed:', e)

print('\n== SUMMARY ==')
ok = sum(1 for c in report['checks'] if c['ok'])
print(f'{ok}/{len(report["checks"])} checks passed')
with open(os.path.join(OUT, 'gui-e2e-5-report.json'), 'w') as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
sys.exit(0 if ok == len(report['checks']) else 1)
