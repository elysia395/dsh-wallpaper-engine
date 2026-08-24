// 验证: 动画1 (呼吸循环) vs 动画0 的头形中心 vs 眼睛/头发对齐
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function renderHead(animIdx) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 960, height: 540, time: 2.5, weAssetsDir: WE, log: () => {} });
  const origRP = r.renderPuppet.bind(r);
  r.renderPuppet = (o, model, tr, t) => {
    const mesh2 = r._mdlCache.get(model.puppet);
    if (mesh2 && o.id === 697 && mesh2.animations && mesh2.animations.length > animIdx) {
      mesh2.animations = [mesh2.animations[animIdx]];
    }
    return origRP(o, model, tr, t);
  };
  // 单独渲染头
  const headO = r.objects.find(x => x.id === 697);
  const sv = new Map();
  for (const oo of r.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
  headO.visible = true;
  r.render();
  const d = r.canvas.data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, nz = 0;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
    const i = (y * r.W + x) * 4;
    if (d[i + 3] > 10) { nz++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  for (const [oid, v] of sv) { const obj = r.objects.find(x => x.id === oid); if (obj) obj.visible = v; }
  const bbox = nz ? [minX, minY, maxX, maxY] : null;
  const center = bbox ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
  return { r, bbox, center, nz };
}

// 眼睛中心 (1920 下 → 960 下 ÷2)
const eyeC = { r: [461 / 2, 684.5 / 2], l: [390 / 2, 657 / 2] }; // 右眼/左眼 960 下
const eyeMid = [(eyeC.r[0] + eyeC.l[0]) / 2, (eyeC.r[1] + eyeC.l[1]) / 2];

for (const [label, ai] of [['动画0(当前)', 0], ['动画1(呼吸循环)', 1]]) {
  const { bbox, center, nz, r } = renderHead(ai);
  if (!bbox) { console.log(`${label}: 无内容`); continue; }
  const rel = center ? [center[0] - eyeMid[0], center[1] - eyeMid[1]] : null;
  console.log(`${label}: 头形(${bbox.join(',')}) 中心(${center[0].toFixed(1)},${center[1].toFixed(1)})`);
  console.log(`  相对两眼中点(${eyeMid[0].toFixed(1)},${eyeMid[1].toFixed(1)}): dx=${rel[0].toFixed(1)} dy=${rel[1].toFixed(1)}`);
  // 保存
  const png = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
  fs.writeFileSync(`scripts/out/amiya_head_anim${ai}.png`, png);
}
