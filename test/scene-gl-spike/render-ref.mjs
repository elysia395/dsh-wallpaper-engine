// Phase 0 spike — CPU 参考帧：SceneRenderer staticFrame（全分辨率效果链，不降采样）
// 用法: node test/scene-gl-spike/render-ref.mjs [W=960] [H=540] [t=3.7] [out=ref.png]
// 输出: assets/ref-<W>x<H>-t<t>.png（默认 assets/ref.png）
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { SceneRenderer, encodePng } from '../../lib/scene-renderer.js';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PKG = process.env.SRC || '/home/beef/Pictures/WallpaperEngine/3295448069/scene.pkg';
const W = Number(process.argv[2] || 960);
const H = Number(process.argv[3] || 540);
const T = Number(process.argv[4] || 3.7);
const out = process.argv[5] || path.join(HERE, 'assets', `ref-${W}x${H}-t${T}.png`);

const t0 = Date.now();
const renderer = new SceneRenderer(PKG, { width: W, height: H, time: T, log: () => {} });
const canvas = renderer.render();
fs.writeFileSync(out, encodePng(canvas.w, canvas.h, canvas.data));
console.log(`ref frame ${W}x${H} t=${T} → ${out} (${Date.now() - t0}ms)`);
