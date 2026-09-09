#!/usr/bin/env python3
# Phase 0 冻结归因实验（plan §6.1）：真实显示 + 真 GPU，长跑 rAF 帧时统计
# 用法: python3 freeze-test.py "<url-query 或 index-iframe.html?...>" <minutes> <label>
# 产出: freeze-<label>.json（帧时数组摘要）+ 每 30s 心跳（页面冻结则心跳停）
import json
import sys
import time
from playwright.sync_api import sync_playwright

target = sys.argv[1]
minutes = float(sys.argv[2]) if len(sys.argv) > 2 else 10
label = sys.argv[3] if len(sys.argv) > 3 else "x"
page_file = "index-iframe.html" if target.startswith("iframe:") else "index.html"
query = target[7:] if target.startswith("iframe:") else target
url = f"http://127.0.0.1:8931/{page_file}?{query}"

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome-stable",
        headless=False,
        args=["--no-sandbox", "--window-position=2000,100"],  # 挪到角落减少遮挡
    )
    page = browser.new_page(viewport={"width": 1000, "height": 620})
    page.on("pageerror", lambda e: print("[pageerror]", str(e)[:300], flush=True))
    page.goto(url)
    page.wait_for_function("window.__ready === true", timeout=60000)
    print(f"[{label}] started: {url}", flush=True)
    t_end = time.time() + minutes * 60
    heartbeats = 0
    while time.time() < t_end:
        time.sleep(30)
        try:
            stats = page.evaluate("""() => {
              const host = window.__hostFrameTimes || [];
              const inner = window.__frameTimes || [];
              const f = document.getElementById('f');
              const inner2 = f && f.contentWindow ? (f.contentWindow.__frameTimes || []) : [];
              return { host: host.length, main: inner.length, inner: inner2.length,
                       glErr: (f && f.contentWindow ? f.contentWindow.__errors : window.__errors) || [] };
            }""", )
            heartbeats += 1
            print(f"[{label}] hb{heartbeats} t+{heartbeats*30}s {stats}", flush=True)
        except Exception as e:
            print(f"[{label}] HEARTBEAT FAILED: {e}", flush=True)
            break
    # 收尾统计
    try:
        out = page.evaluate("""() => {
          const grab = (arr) => {
            if (!arr.length) return null;
            const s = [...arr].sort((a, b) => a - b);
            return { n: arr.length, p50: s[(s.length*0.5)|0], p95: s[(s.length*0.95)|0],
                     p99: s[(s.length*0.99)|0], max: s[s.length-1] };
          };
          const f = document.getElementById('f');
          const inner = f && f.contentWindow ? (f.contentWindow.__frameTimes || []) : (window.__frameTimes || []);
          return { inner: grab(inner), host: grab(window.__hostFrameTimes || []) };
        }""")
    except Exception as e:
        out = {"error": str(e)}
    with open(f"freeze-{label}.json", "w") as fp:
        json.dump(out, fp, indent=1)
    print(f"[{label}] FINAL {json.dumps(out)}", flush=True)
    browser.close()
