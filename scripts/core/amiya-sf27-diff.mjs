// sf27 验证: 视图平移 (-eye) 只作用于前景, 背景(314)静止
import { SceneRenderer } from '../../lib/we-renderer/core.js';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
// 帧1: 当前 (含视图平移)
const r1 = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
r1.render();
const d1 = Uint8Array.from(r1.canvas.data); // 复制! canvas.data 是引用
// 帧2: 禁用视图平移
const origShift = r1._viewShift.bind(r1);
r1._viewShift = () => [0, 0];
r1.render();
const d2 = r1.canvas.data;
r1._viewShift = origShift;
// 比较: 差异像素 (有视图 vs 无视图)
let diffCnt = 0, bgDiff = 0, bgTotal = 0;
let minDx = 1e9, maxDx = -1e9, minDy = 1e9, maxDy = -1e9;
// 背景区域 = 左上角 100x100 内无前景差异? 用全帧统计差异像素的位移
for (let y = 0; y < r1.H; y += 4) {
  for (let x = 0; x < r1.W; x += 4) {
    const i = (y * r1.W + x) * 4;
    if (d1[i] !== d2[i] || d1[i+1] !== d2[i+1] || d1[i+2] !== d2[i+2] || d1[i+3] !== d2[i+3]) {
      diffCnt++;
      if (x < 400 && y < 400) bgDiff++; // 背景区域 (场景左上)
    }
  }
}
const total = (r1.W/4) * (r1.H/4);
console.log(`差异采样: ${diffCnt}/${total} (${(diffCnt/total*100).toFixed(1)}%)`);
console.log(`背景区(左上400x400)差异: ${bgDiff}`);
// 验证各组件数学位移
const ortho = r1.scene.general.orthogonalprojection;
const ps = [r1.W / ortho.width, r1.H / ortho.height];
console.log(`\n视图平移 = (-camEye)×ps = (${(-r1.camEye[0]*ps[0]).toFixed(1)}, ${(-r1.camEye[1]*ps[1]).toFixed(1)})`);
console.log(`camEye = ${r1.camEye.map(v=>v.toFixed(2)).join(',')}`);
