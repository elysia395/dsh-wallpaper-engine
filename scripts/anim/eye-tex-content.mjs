// 测量左眼/右眼纹理内容位置 → 计算图案中心在场景中的落点
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
const { SceneRenderer } = await import('../lib/scene-renderer.js');
const { decodeTex } = await import('../lib/pkg-extract.js');
const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';

const r = new SceneRenderer(PKG, { width: 3840, height: 2160, log: () => {} });
const pkg = r.pkg;

async function texContentBBox(texPath) {
  const dec = decodeTex(pkg.read(texPath));
  let w, h, d;
  if (dec.kind === 'png-pass') {
    const img = await sharp(dec.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    w = img.info.width; h = img.info.height; d = img.data;
  } else if (dec.kind === 'rgba') { w = dec.width; h = dec.height; d = dec.rgba; }
  else return null;
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y*w+x)*4+3] > 16) {
      count++;
      if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y;
    }
  }
  return { w, h, minX, minY, maxX, maxY, count, cx: (minX+maxX)/2, cy: (minY+maxY)/2 };
}

// 眼睛 mesh: 顶点 UV↔位置 线性关系 (从 dump 已知锚点)
const eyes = [
  { name: '左眼', tex: 'materials/左眼.tex', u0: 0.5058, v0: -0.0611, size: [140, 200] },
  { name: '右眼', tex: 'materials/右眼.tex', u0: 0.8703, v0: 0.1946, size: [150, 150] },
  { name: '眉毛', tex: 'materials/眉毛.tex', u0: 0.5, v0: null, size: [249, 118] },
  { name: '鼻子', tex: 'materials/鼻子.tex', u0: 0.5, v0: null, size: [70, 81] },
];

for (const e of eyes) {
  const t = await texContentBBox(e.tex);
  if (!t) { console.log(e.name, ': 纹理解码失败'); continue; }
  console.log(`\n=== ${e.name} 纹理 ${t.w}x${t.h}, 内容 bbox x[${t.minX},${t.maxX}] y[${t.minY},${t.maxY}], 中心 (${t.cx.toFixed(1)}, ${t.cy.toFixed(1)})`);
  console.log(`  内容占比: ${(100*t.count/(t.w*t.h)).toFixed(1)}%`);
  // 内容中心在纹理中的位置 vs 纹理中心
  const twc = t.w/2, thc = t.h/2;
  console.log(`  内容中心相对纹理中心: dx=${(t.cx-twc).toFixed(1)} dy=${(t.cy-thc).toFixed(1)}`);
  // 场景偏移: raw = (size.x*(u-u0), -size.y*(v-v0))
  const u = t.cx / t.w, v = t.cy / t.h;
  const rx = e.size[0] * (u - e.u0);
  const ry = e.v0 === null ? null : -e.size[1] * (v - e.v0);
  console.log(`  内容中心 UV: (${u.toFixed(4)}, ${v.toFixed(4)})`);
  console.log(`  场景偏移 (mesh raw): x=${rx.toFixed(1)}${ry !== null ? `, y=${ry.toFixed(1)}` : ' (v0 未知)'}`);
}

// 对象 origin (相对父级) 汇总
const scene = pkg.readJson('scene.json');
console.log('\n=== 眼睛/五官 origin (相对父级) ===');
for (const id of [329, 295, 373, 701, 494]) {
  const o = scene.objects.find(x => String(x.id) === String(id));
  console.log(`  ${o.name}(${id}): origin=${o.origin} parent=${o.parent}`);
}
