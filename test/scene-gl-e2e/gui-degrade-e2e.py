#!/usr/bin/env python3
# 0.7.0 降级 GL 真实 GUI E2E：dev 实例选达妮娅（30 对象降级场景）→ 等 GL_RUN
# → 校验降级提示行 + 0 个 scene-anim 请求 → 截图。结束恢复 settings 现场。
import json
import os
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:41723'
TARGET_ID = 'ls-7fda094b100c'  # 达妮娅
OUT = os.path.dirname(os.path.abspath(__file__))


def get_settings():
    with urllib.request.urlopen(BASE + '/wallpaper-engine/settings', timeout=10) as r:
        return json.load(r)['settings']


def put_settings(merged):
    req = urllib.request.Request(BASE + '/wallpaper-engine/settings',
                                 data=json.dumps(merged).encode(),
                                 headers={'Content-Type': 'application/json'}, method='PUT')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


orig = get_settings()
print('orig id:', orig.get('id'))
merged = dict(orig)
merged['id'] = TARGET_ID
put_settings(merged)
print('switched to', TARGET_ID)

scene_anim_reqs = []
gl_state = {'state': None, 'frames': 0}
hint_text = None
shot = os.path.join(OUT, 'gui-degrade-dny.png')
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'])
        page = browser.new_page(viewport={'width': 1600, 'height': 900})
        page.on('request', lambda req: scene_anim_reqs.append(req.url)
                if '/scene-anim/' in req.url else None)
        page.goto(BASE, wait_until='domcontentloaded')
        # 等 GL_RUN（30 对象 SwiftShader 初始化较慢，给 180s）
        t0 = time.time()
        while time.time() - t0 < 180:
            st = page.evaluate('window.__weSceneGL && window.__weSceneGL.renderer '
                               '? window.__weSceneGL.renderer.state() : null')
            if st == 'GL_RUN':
                break
            time.sleep(2)
        gl_state['state'] = st
        time.sleep(4)  # 多跑几帧 + 让降级提示行渲染
        gl_state['frames'] = page.evaluate('window.__weSceneGL && window.__weSceneGL.renderer '
                                           '? window.__weSceneGL.renderer.stats.frames : -1')
        # 打开设置面板拿降级提示（设置面板可能在 DOM 里常驻，先试直接读）
        hint_text = page.evaluate('''(() => {
            const els = document.querySelectorAll('.we-picker__hint');
            for (const el of els) {
                if (el.textContent.includes('降级')) return el.textContent;
            }
            return null;
        })()''')
        if hint_text is None:
            # 设置面板未展开：点击齿轮打开再读
            try:
                page.click('.we-fab, [class*="settings"], [title*="设置"]', timeout=3000)
                time.sleep(1.5)
                hint_text = page.evaluate('''(() => {
                    const els = document.querySelectorAll('.we-picker__hint');
                    for (const el of els) {
                        if (el.textContent.includes('降级')) return el.textContent;
                    }
                    return '(panel opened, no hint found)';
                })()''')
            except Exception as e:
                hint_text = '(open panel failed: %s)' % e
        page.screenshot(path=shot)
        browser.close()
finally:
    put_settings(orig)
    print('restored id:', orig.get('id'))

print('GL state:', gl_state['state'], '| frames:', gl_state['frames'])
print('scene-anim requests:', len(scene_anim_reqs))
print('degrade hint:', hint_text)
print('screenshot:', shot)
