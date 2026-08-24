// 验证: animationlayers 选择动画1 vs 当前动画0 — 头形位置 (修复 patch)
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodeApng } from '../../lib/apng-encode.js';
import fs from 'node:fs';

const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const id = '3486806915';

function renderHead(animIdx) {
  const r = new SceneRenderer(`${WS}/${id}/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  const origRP = r.renderPuppet.bind(r);
  r.renderPuppet = (o, model, tr, t) => {
    const cache = r._mdlCache || (r._mdlCache = new Map());
    let mesh2 = cache.get(model.puppet);
    if (!mesh2) {
      const raw = r.pkg.read(model.puppet);
      if (!raw) return origRP(o, model, tr, t);
      mesh2 = r._parseMdl(raw);
      cache.set(model.puppet, mesh2);
    }
    if (o.id === 697 && mesh2 && mesh2.animations && mesh2.animations.length > animIdx) {
      // 保存原动画数组引用, 用指定动画
      if (!mesh2._origAnims) mesh2._origAnims = mesh2.animations;
      mesh2.animations = [mesh2._origAnims[animIdx]];
    }
    return origRP(o, model, tr, t);
  };
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
  return { bbox: nz ? [minX, minY, maxX, maxY] : null, nz };
}

// 眼睛中心 (1920)
const eyeMid = [(461 + 390) / 2, (684.5 + 657) / 2]; // (425.5, 670.75)
for (const [label, ai] of [['动画0(当前)', 0], ['动画1(呼吸循环)', 1]]) {
  const { bbox, nz } = renderHead(ai);
  if (!bbox) { console.log(`${label}: 无内容`); continue; }
  const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const rel = [center[0] - eyeMid[0], center[1] - eyeMid[1]];
  console.log(`${label}: 头形(${bbox.join(',')}) 中心(${center[0].toFixed(1)},${center[1].toFixed(1)}) 像素${nz}`);
  console.log(`  相对两眼中点(${eyeMid[0]},${eyeMid[1]}): dx=${rel[0].toFixed(1)} dy=${rel[1].toFixed(1)}`);
}
