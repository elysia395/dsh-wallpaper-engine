// scene scripts 运行时测试
import { runScriptValue, WEColor, applySceneScripts } from '../../lib/scene-scripts.js';
import fs from 'node:fs';

// 测试 WEColor
console.log('hsv2rgb(0,1,1) =', JSON.stringify(WEColor.hsv2rgb({ x: 0, y: 1, z: 1 })));
console.log('hsv2rgb(0.5,1,1) =', JSON.stringify(WEColor.hsv2rgb({ x: 0.5, y: 1, z: 1 })));

// razer 彩虹脚本
const rainbow = `'use strict';
import * as WEColor from 'WEColor';
let rainbowSpeed = 0.08;
export function update(value) {
  value = WEColor.hsv2rgb({ x: Date.now() / 2000 * rainbowSpeed % 1, y: 1, z: 1 });
  return value;
}`;
const v = runScriptValue({ script: rainbow, value: '1 0 0' }, 0);
console.log('rainbow update →', v);

// applyUserProperties 脚本 (shimmering bloom)
const bloomScript = `'use strict';
export function applyUserProperties(changedUserProperties) {
  if (changedUserProperties.hasOwnProperty('glow')) {
    thisObject.bloomstrength = changedUserProperties.glow * 0.5;
  }
}`;
const b = runScriptValue({ script: bloomScript, value: 1.12 }, 0);
console.log('bloom applyUserProperties →', b);

// 完整场景扫描 (razer_bedroom)
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';
const scene = JSON.parse(fs.readFileSync(WE + '/projects/defaultprojects/razer_bedroom/scene.json', 'utf8'));
applySceneScripts(scene, 0);
// 检查 glow1 color 是否更新
const glow1 = scene.objects.find((o) => o.name === 'glow1');
const color = glow1 && glow1.effects && glow1.effects[0].passes[0].constantshadervalues.color;
console.log('glow1 color 更新后:', JSON.stringify(color));
