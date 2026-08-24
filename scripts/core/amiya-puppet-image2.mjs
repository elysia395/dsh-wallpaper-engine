// 测试: puppet vs image 是否分别应用视图矩阵 - 直接 hook renderPuppet/renderImage
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { getVal, parseVec2 } from '../../lib/we-renderer/math.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
function make(mode) {
  const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  // 控制 -eye 应用: 0=全部, 1=仅puppet, 2=仅image
  const origEye = r.camEye;
  r._setupCamera = function() { /* 跳过, 手动设 camEye */ this.camEye = [-360, -269.56, 0]; };
  // 用标志控制: 通过临时字段
  r._eyeMode = mode;
  // renderPuppet 应用 -eye (由 renderPuppet 内部逻辑), renderImage 也应用
  // 我们在这里覆盖: 对 puppet 类, 修改 renderPuppet 使 -eye 可选
  const origRenderPuppet = r.renderPuppet.bind(r);
  const origRenderImage = r.renderImage.bind(r);
  // 直接改: 渲染前根据模式决定 camEye (puppet 用 oriEye, image 用 0)
  // 简单方案: 分别测试 puppet-only / image-only 的 -eye
  if (mode === 'puppetOnly' || mode === 'all') {
    // renderPuppet 内部用 this.camEye → 保持
  }
  r.render();
  return r;
}
// 更简单: 直接改 core.js 的 renderPuppet/renderImage 逻辑不可行(只读), 用 hook:
function make2(mode) {
  const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 1920, height: 1080, time: 2.5, weAssetsDir: WE, log: () => {} });
  const origSetup = r._setupCamera.bind(r);
  r._setupCamera = function() { origSetup(); this._eyeSave = this.camEye.slice(); };
  // 每对象渲染前, 按类型决定 camEye
  const origRender = r.render.bind(r);
  const eyeSave = [-360, -269.56, 0];
  r.render = function() {
    const self = this;
    const origRI = self.renderImage.bind(self);
    const origRP = self.renderPuppet.bind(self);
    self.renderImage = function(o, model, tr, t) {
      if (mode === 'imageOnly' || mode === 'all') { self.camEye = eyeSave; } else { self.camEye = [0,0,0]; }
      return origRI(o, model, tr, t);
    };
    self.renderPuppet = function(o, model, tr, t) {
      if (mode === 'puppetOnly' || mode === 'all') { self.camEye = eyeSave; } else { self.camEye = [0,0,0]; }
      return origRP(o, model, tr, t);
    };
    return origRender();
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
for (const mode of ['all', 'puppetOnly', 'imageOnly']) {
  const r = make2(mode);
  const head = soloBbox(r, 697);
  const body = soloBbox(r, 407);
  const eyeR = soloBbox(r, 295);
  console.log(`${mode}:`);
  console.log(`  头: ${head ? head.join(',') : '无'} 身体: ${body ? body.join(',') : '无'}`);
  if (head && body) console.log(`  头-身体重叠: ${(head[3]-body[1]).toFixed(0)}px`);
  if (head && eyeR) {
    const hc = [(head[0]+head[2])/2, (head[1]+head[3])/2];
    const ec = [(eyeR[0]+eyeR[2])/2, (eyeR[1]+eyeR[3])/2];
    console.log(`  头(${hc[0].toFixed(0)},${hc[1].toFixed(0)}) 右眼(${ec[0].toFixed(0)},${ec[1].toFixed(0)}) dx=${(hc[0]-ec[0]).toFixed(1)} dy=${(hc[1]-ec[1]).toFixed(1)}`);
  }
}
