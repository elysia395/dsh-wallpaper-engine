// 更多 puppet 锚点变体: origin±size/2+raw
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { getVal, parseVec2 } from '../../lib/we-renderer/math.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
function make(anchor) {
  const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  const orig = r.renderPuppet.bind(r);
  r.renderPuppet = function(o, model, tr, t) {
    const mdlRaw = this.pkg.read(model.puppet);
    if (!this._mdlCache) this._mdlCache = new Map();
    let mesh = this._mdlCache.get(model.puppet);
    if (!mesh) { mesh = this._parseMdl(mdlRaw); if (mesh) this._mdlCache.set(model.puppet, mesh); }
    if (!mesh) return;
    const tex = this.loadModelTexture(o.image);
    if (!tex) return;
    let animIdx = 0, animBlend = 1;
    if (mesh.animations && mesh.animations.length > 1 && o.animationlayers && o.animationlayers.length) {
      const layers = o.animationlayers.filter((l) => { const v = l && l.visible; return v === true || (v && typeof v === 'object' && v.value === true); });
      if (layers.length) {
        const layer = layers[0];
        if (typeof layer.blend === 'number' && layer.blend >= 0 && layer.blend <= 1) animBlend = layer.blend;
        let idx = mesh.animations.findIndex((a) => a.name && layer.name && a.name === layer.name);
        if (idx < 0) { const li = o.animationlayers.indexOf(layer); if (li >= 0 && li < mesh.animations.length) idx = li; }
        if (idx >= 0) animIdx = idx;
      }
    }
    let skinned = mesh.positions;
    if (mesh.bones && mesh.bones.length && mesh.animations && mesh.animations.length) {
      skinned = this._skinPuppet(mesh, t, 0, 0, animIdx, animBlend);
    }
    const rawBounds = this._meshBounds(skinned);
    const W = Math.ceil(rawBounds.maxX - rawBounds.minX) + 1;
    const H = Math.ceil(rawBounds.maxY - rawBounds.minY) + 1;
    const flipY = (y) => rawBounds.maxY - y;
    const img = this._rasterizeMesh(mesh, tex, skinned, rawBounds, W, H, flipY);
    const orthoP = this.scene.general && this.scene.general.orthogonalprojection;
    const ps = orthoP && orthoP.width ? [this.W / orthoP.width, this.H / (orthoP.height || 1080)] : null;
    const dw = W * (ps ? ps[0] : 1) * tr.scale[0], dh = H * (ps ? ps[1] : 1) * tr.scale[1];
    const size = parseVec2(getVal(o, 'size'), [0, 0]);
    let baseX, baseY;
    if (anchor === 'origin+raw') { baseX = tr.origin[0] + rawBounds.minX; baseY = tr.origin[1] + rawBounds.maxY; }
    else if (anchor === 'origin+size2+raw') { baseX = tr.origin[0] + size[0]/2 + rawBounds.minX; baseY = tr.origin[1] + size[1]/2 + rawBounds.maxY; }
    else if (anchor === 'origin-size2+raw') { baseX = tr.origin[0] - size[0]/2 + rawBounds.minX; baseY = tr.origin[1] - size[1]/2 + rawBounds.maxY; }
    else if (anchor === 'origin+rawscale') {
      // raw 缩放: raw × size/bbox
      const sx = size[0] / (rawBounds.maxX - rawBounds.minX), sy = size[1] / (rawBounds.maxY - rawBounds.minY);
      baseX = tr.origin[0] + rawBounds.minX * sx; baseY = tr.origin[1] + rawBounds.maxY * sy;
    }
    const dx = baseX * (ps ? ps[0] : 1);
    const dy = this.H - baseY * (ps ? ps[1] : 1);
    this.canvas.blitScaled(img, dx, dy, dw, dh, getVal(o, 'alpha', 1));
  };
  r.render();
  return r;
}
function soloBbox(r, oid) {
  const o = r.objects.find(x => x.id === oid);
  if (!o) return null;
  const sv = new Map();
  for (const oo of r.objects) { sv.set(oo.id, oo.visible); oo.visible = false; }
  o.visible = true;
  r.render();
  const d = r.canvas.data;
  let minX=1e9,minY=1e9,maxX=-1,maxY=-1,nz=0;
  for (let y = 0; y < r.H; y++) for (let x = 0; x < r.W; x++) {
    const i = (y*r.W+x)*4;
    if (d[i+3] > 10) { nz++; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  for (const [oid2, v] of sv) { const obj = r.objects.find(x => x.id === oid2); if (obj) obj.visible = v; }
  return nz ? [minX,minY,maxX,maxY] : null;
}
for (const anchor of ['origin+raw', 'origin+size2+raw', 'origin-size2+raw', 'origin+rawscale']) {
  const r = make(anchor);
  const head = soloBbox(r, 697);
  const eyeR = soloBbox(r, 295);
  const eyeL = soloBbox(r, 329);
  const ear = soloBbox(r, 421);
  console.log(`锚点=${anchor}: 头=${head ? head.join(',') : '无'} 右眼=${eyeR ? eyeR.join(',') : '无'} 左眼=${eyeL ? eyeL.join(',') : '无'} 右耳=${ear ? ear.join(',') : '无'}`);
  if (head && eyeR && eyeL) {
    const hc = [(head[0]+head[2])/2, (head[1]+head[3])/2];
    const ec = [(eyeR[0]+eyeR[2])/2, (eyeR[1]+eyeR[3])/2];
    const el = [(eyeL[0]+eyeL[2])/2, (eyeL[1]+eyeL[3])/2];
    console.log(`  头中心(${hc[0].toFixed(0)},${hc[1].toFixed(0)}) 右眼(${ec[0].toFixed(0)},${ec[1].toFixed(0)}) 左眼(${el[0].toFixed(0)},${el[1].toFixed(0)}) 眼距=${(ec[0]-el[0]).toFixed(0)}px 头眼dx=${(hc[0]-ec[0]).toFixed(0)} dy=${(hc[1]-ec[1]).toFixed(0)}`);
  }
}
