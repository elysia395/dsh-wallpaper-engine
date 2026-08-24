// 测试 encodePng vs encodeApng 输出完整性
import { SceneRenderer } from '../../lib/we-renderer/core.js';
import { encodePng } from '../../lib/we-renderer/canvas.js';
import { encodeApng } from '../../lib/apng-encode.js';
import { decodePngBuffer } from '../../lib/we-renderer/canvas.js';
import fs from 'node:fs';
const WS = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960';
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const r = new SceneRenderer(`${WS}/3486806915/scene.pkg`, { width: 3840, height: 2160, time: 2.5, weAssetsDir: WE, log: () => {} });
r.render();
console.log('canvas.data 长度:', r.canvas.data.length, ' 期望:', r.W*r.H*4);
// 直接统计 canvas.data
let nz = 0;
for (let i = 3; i < r.canvas.data.length; i += 4) if (r.canvas.data[i] > 10) nz++;
console.log('canvas.data 非透明:', (nz / (r.W*r.H) * 100).toFixed(1) + '%');
// encodePng (静态)
const pngStatic = encodePng(r.W, r.H, r.canvas.data);
fs.writeFileSync('scripts/out/test_static.png', pngStatic);
const decStatic = decodePngBuffer(fs.readFileSync('scripts/out/test_static.png'));
let snz = 0;
for (let i = 3; i < decStatic.rgba.length; i += 4) if (decStatic.rgba[i] > 10) snz++;
console.log('encodePng 解码非透明:', (snz / (decStatic.width*decStatic.height) * 100).toFixed(1) + '%', '尺寸:', decStatic.width, 'x', decStatic.height);
// encodeApng (单帧)
const apng = encodeApng(r.W, r.H, [{ rgba: r.canvas.data, delayMs: 100 }]);
fs.writeFileSync('scripts/out/test_apng.png', apng);
const decApng = decodePngBuffer(fs.readFileSync('scripts/out/test_apng.png'));
let anz = 0;
for (let i = 3; i < decApng.rgba.length; i += 4) if (decApng.rgba[i] > 10) anz++;
console.log('encodeApng 解码非透明:', (anz / (decApng.width*decApng.height) * 100).toFixed(1) + '%', '尺寸:', decApng.width, 'x', decApng.height);
