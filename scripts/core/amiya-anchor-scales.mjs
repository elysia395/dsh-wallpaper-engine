// 检查所有锚点 (467/697/463/494/528) 的 scale/angles 完整定义
// 用户: 头部组件偏移、身体组件不偏移 — 头分支 vs 身体分支的差异
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
for (const id of [467, 697, 463, 494, 528, 407, 459, 421, 295, 513, 535]) {
  const o = r.objects.find(x => x.id === id);
  if (!o) continue;
  const m = (() => { try { return o.image ? r.readJsonAny(o.image) : null; } catch { return null; } })();
  console.log(`id=${id} "${o.name}": origin="${o.origin}" scale="${o.scale}" angles="${o.angles}" parent=${o.parent} size="${o.size}" image=${o.image ? o.image : '-'} puppet=${m && m.puppet ? 'Y' : 'N'} animlayers=${o.animationlayers ? o.animationlayers.length : 0}`);
}
// 完整 resolveTransform 的 scale 链
console.log('\n=== resolveTransform scale/angle ===');
for (const id of [697, 459, 421, 295, 407, 411, 389, 403, 449]) {
  const o = r.objects.find(x => x.id === id);
  if (!o) continue;
  const tr = r.resolveTransform(o);
  console.log(`id=${id} "${o.name}": origin=(${tr.origin[0].toFixed(2)},${tr.origin[1].toFixed(2)},${tr.origin[2].toFixed(2)}) scale=(${tr.scale[0].toFixed(3)},${tr.scale[1].toFixed(3)},${tr.scale[2].toFixed(3)}) angle=${tr.angle.toFixed(4)}`);
}
