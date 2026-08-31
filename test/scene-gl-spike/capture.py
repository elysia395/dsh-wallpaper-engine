#!/usr/bin/env python3
# Phase 0 spike — 截图采集：打开 spike 页 → 等待 __ready → 取 __capturePNG 落盘
# 用法: python3 capture.py "<query>" <out.png>   例: python3 capture.py "t=3.7&res=lwe" cap-lwe.png
import base64
import sys
from playwright.sync_api import sync_playwright

query = sys.argv[1] if len(sys.argv) > 1 else "t=3.7"
out = sys.argv[2] if len(sys.argv) > 2 else "capture.png"
url = f"http://127.0.0.1:8931/index.html?{query}"

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome-stable",
        args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
    )
    page = browser.new_page(viewport={"width": 1000, "height": 600})
    page.on("console", lambda m: print("[console]", m.type, m.text[:500]))
    page.on("pageerror", lambda e: print("[pageerror]", str(e)[:800]))
    page.on("response", lambda r: print("[404]", r.url) if r.status == 404 else None)
    page.goto(url)
    try:
        page.wait_for_function("window.__ready === true", timeout=30000)
    except Exception as e:
        print("WAIT TIMEOUT — __ready:", page.evaluate("window.__ready"), "errors:", page.evaluate("window.__errors"))
        browser.close()
        sys.exit(1)
    title = page.title()
    errors = page.evaluate("window.__errors")
    hud = page.evaluate("document.getElementById('hud').textContent")
    print("title:", title)
    print("hud:", hud)
    if errors:
        print("ERRORS:", errors)
    data = page.evaluate("window.__capturePNG")
    if data and title == "SPIKE_OK":
        png = base64.b64decode(data.split(",", 1)[1])
        with open(out, "wb") as f:
            f.write(png)
        print("saved:", out, len(png), "bytes")
    else:
        print("NO CAPTURE")
    browser.close()
    sys.exit(0 if title == "SPIKE_OK" else 1)
