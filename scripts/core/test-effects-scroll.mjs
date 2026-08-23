// 验证 effects/ scroll + tint + filmgrain CPU 实现
// dino_run: bg1_* + grass_ground 5 个可见对象用 effects/scroll (repeat/speedx/speedy)
// neon_sunset: Fullscreen 对象用 effects/filmgrain
import { SceneRenderer, encodePng } from '../lib/scene-renderer.js';
import fs from 'node:fs';
import path from 'node:path';

const WE = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine';
const OUT = 'D:\\dsh-wallpaper-engine\\scene-layers-out\\effects';

fs.mkdirSync(OUT, { recursive: true });

function pngStats(rgba, w, h) {
  let sum = [0, 0, 0], n = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      sum[0] += rgba[i]; sum[1] += rgba[i + 1]; sum[2] += rgba[i + 2];
      n++;
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n].map((v) => v.toFixed(1));
}

async function renderScene(name, src, opts = {}) {
  const t0 = Date.now();
  const r = new SceneRenderer(src, { width: opts.w || 1920, height: opts.h || 1080, time: opts.t ?? 2.5, weAssetsDir: WE, log: (m) => console.log('  [log]', m) });
  const canvas = r.render();
  const png = encodePng(canvas.w, canvas.h, canvas.data);
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, png);
  console.log(`${name}: ${canvas.w}x${canvas.h} ${(Date.now() - t0) / 1000}s avgRGB=${pngStats(canvas.data, canvas.w, canvas.h)} → ${f}`);
  return { r, canvas };
}

// ── dino_run (scroll effects) ──
const dinoDir = path.join(WE, 'projects', 'defaultprojects', 'dino_run');
await renderScene('dino_run_effects', dinoDir, { w: 1920, h: 1080 });

// 单独验证 scroll 对单纹理的效果: 对 bg1_0 的纹理跑 effectScroll, 对比前后
{
  const r = new SceneRenderer(dinoDir, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  const o = r.objects.find((x) => x.name === 'bg1_0');
  const tex = r.loadModelTexture(o.image);
  console.log('bg1_0 纹理尺寸:', tex && tex.width, 'x', tex && tex.height);
  // 场景中 bg1_0 的 scroll 参数
  const ef = o.effects[0];
  console.log('bg1_0 scroll csv:', JSON.stringify(ef.passes[0].constantshadervalues));
  // 渲染前后对比: 直接调用 effectScroll
  const img = r.effectScroll(tex, ef.passes[0].constantshadervalues || {}, 2.5);
  console.log('effectScroll 输出尺寸:', img.width, 'x', img.height);
  // 对比中心区域像素: 计算两张图差异
  const w = tex.width, h = tex.height;
  let diff = 0, n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const d = Math.abs(tex.rgba[i] - img.rgba[i]) + Math.abs(tex.rgba[i + 1] - img.rgba[i + 1]) + Math.abs(tex.rgba[i + 2] - img.rgba[i + 2]);
      if (d > 3) diff++;
      n++;
    }
  }
  console.log(`bg1_0 scroll 前后差异像素: ${diff}/${n} (${(diff / n * 100).toFixed(2)}%)  t=2.5s`);
}

// ── neon_sunset (filmgrain effect) ──
const neonDir = path.join(WE, 'projects', 'defaultprojects', 'neon_sunset');
await renderScene('neon_sunset_effects', neonDir, { w: 1920, h: 1080 });

// ── razer_bedroom (scroll+tint, 可见对象) ──
const razerDir = path.join(WE, 'projects', 'defaultprojects', 'razer_bedroom');
await renderScene('razer_bedroom_effects', razerDir, { w: 1920, h: 1080 });

console.log('\n完成');
