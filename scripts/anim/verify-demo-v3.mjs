import fs from 'fs';
const html = fs.readFileSync('D:/dsh-wallpaper-engine/scene-layers-out/particles-demo.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script');
new Function(m[1]);
console.log('demo JS 语法 OK');

// 验证 y 翻转后的关键位置
const H = 2160;
const layers = [
  { name: '背景', o: [1917.4, 1074.6] },
  { name: '水',   o: [1912.1, 1341.3] },
  { name: '伞',   o: [3433.7, 420.8] },
];
for (const l of layers) {
  console.log(l.name, 'scene(' + l.o.join(',') + ') → 屏幕(' + l.o[0] + ',' + (H - l.o[1]) + ')');
}
const S = (o) => Object.assign({ rate: 1, starttime: 0, alpha: 1, count: 1, sizeMul: 1, rateMul: 1, gravity: [0,0], blend: 'source-over', overbright: 1, tex: null, animFrames: 0, angle: 0, objScale: [1,1], turb: null }, o);
const SYSTEMS = [
  S({ name: '沙砾', origin: [2848.3, 1293.2], objScale: [2, 2], angle: -0.938, alpha: 0.36, rateMul: 0.91, emitter: 'boxrandom', box: [[-200,-1400],[200,1400]], rate: 40, starttime: 15, life: [8,20], size: [50,50], vel: [[-37,-90],[-10,-50]], max: 360, tex: 'flare', blend: 'lighter' }),
  S({ name: '光圈', origin: [2074.7, 1075.0], objScale: [2, 2], alpha: 0.28, emitter: 'boxrandom', box: [[500,500],[1000,256]], rate: 4, starttime: 0, life: [10,10], size: [400,700], vel: [[-50,-50],[50,50]], max: 5, tex: 'halo' }),
  S({ name: 'GlassShards1', origin: [1113.0, 173.7], objScale: [1, 1], angle: 1.812, alpha: 0.27, emitter: 'sphererandom', dist: 450, emOrigin: [100, 300], rate: 5, starttime: 3, life: [8,10], size: [200,200], vel: [[-100,-100],[-50,-15]], max: 10, tex: 'leaf', blend: 'lighter', overbright: 5, gravity: [1,1] }),
  S({ name: 'Trembling1', origin: [2070.0, 625.4], objScale: [1, 1], alpha: 0.43, count: 0.13, rateMul: 1.31, emitter: 'sphererandom', dist: [10,150], rate: 4, starttime: 0, life: [5,10], size: [100,150], vel: [[-10,-3],[10,3]], max: 10, tex: 'debris', blend: 'source-over', gravity: [2,-4], animFrames: 8 }),
  S({ name: 'Trembling2', origin: [2121.1, 612.1], objScale: [1, 1], alpha: 0.42, count: 0.13, sizeMul: 0.37, emitter: 'sphererandom', dist: [10,150], rate: 4, starttime: 0, life: [5,8], size: [100,150], vel: [[-10,-3],[10,3]], max: 10, tex: 'p44', blend: 'source-over', gravity: [2,-4] }),
  S({ name: 'GlassShards2', origin: [3784.2, 447.0], objScale: [0.408, 0.408], angle: 0.762, alpha: 0.5, count: 0.1, sizeMul: 5, emitter: 'sphererandom', dist: 750, emOrigin: [350, 750], rate: 5, starttime: 3, life: [8,10], size: [70,75], vel: [[-100,-100],[-50,-15]], max: 10, tex: 'leaf', blend: 'lighter', overbright: 5 }),
  S({ name: 'quan', origin: [3809.7, 968.5], objScale: [0.408, 0.408], angle: 0.299, alpha: 0.49, count: 0.05, sizeMul: 4, emitter: 'sphererandom', dist: 750, emOrigin: [350, 750], rate: 5, starttime: 3, life: [10,20], size: [70,75], vel: [[-100,-100],[-50,-15]], max: 10, tex: 'p39', blend: 'lighter', overbright: 5 }),
];
for (const s of SYSTEMS) {
  s.scale = s.objScale;
  s.anchor = [s.origin[0] + s.scale[0]*(s.emOrigin?s.emOrigin[0]:0), H - (s.origin[1] + s.scale[1]*(s.emOrigin?s.emOrigin[1]:0))];
  s.effMax = Math.max(1, Math.round(s.max * s.count));
  s.effRate = s.rate * s.rateMul;
  console.log(s.name.padEnd(14), '锚点(' + s.anchor.map(v=>Math.round(v)).join(',') + ')', '数量', s.effMax, '速率', s.effRate.toFixed(2), '尺寸', Math.round(s.size[0]*s.sizeMul*s.scale[0]) + '-' + Math.round(s.size[1]*s.sizeMul*s.scale[0]));
}
