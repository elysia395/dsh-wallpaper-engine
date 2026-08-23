// dump 头部/眼睛模型与 mesh 原始数据 — 数据驱动分析
import { createRequire } from 'module';
const require = createRequire('file:///D:/dsh-wallpaper-engine/scripts/');
const sharp = require('C:/Users/Kai/.dsh/profiles/node_modules/sharp');
import fs from 'fs';

const { readPkg } = await import('../lib/scene-renderer.js').catch(() => ({}));
// 直接用 readPkg
const mod = await import('../lib/scene-renderer.js');
const pkg = mod.readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');

const scene = pkg.readJson('scene.json');
// 找所有对象
const objs = scene.objects || [];
console.log('objects:', objs.length);

// 遍历对象+模型, 打印所有 image 层
function dumpModel(modelPath, depth) {
  if (!modelPath) return;
  const model = pkg.readJson(modelPath);
  if (!model) { console.log('  '.repeat(depth) + 'MODEL NOT FOUND: ' + modelPath); return; }
  const layers = model.layers || [];
  for (const l of layers) {
    const pad = '  '.repeat(depth);
    const img = l.image || {};
    const size = img.size ? JSON.stringify(img.size) : '-';
    const crop = img.cropoffset ? JSON.stringify(img.cropoffset) : '-';
    const tex = img.texture || '-';
    const origin = img.origin ? JSON.stringify(img.origin) : '-';
    const scale = img.scale ? JSON.stringify(img.scale) : '-';
    console.log(`${pad}layer id=${l.id} name=${JSON.stringify(l.name||'')} size=${size} crop=${crop} autosize=${img.autosize} origin=${origin} scale=${scale} tex=${tex}`);
    if (img.puppet) console.log(`${pad}  PUPPET: ${img.puppet}`);
    // 递归子层
    if (l.layers && l.layers.length) dumpModel2(l.layers, depth + 1);
  }
}
function dumpModel2(layers, depth) {
  for (const l of layers) {
    const pad = '  '.repeat(depth);
    const img = l.image || {};
    const size = img.size ? JSON.stringify(img.size) : '-';
    const crop = img.cropoffset ? JSON.stringify(img.cropoffset) : '-';
    const tex = img.texture || '-';
    const origin = img.origin ? JSON.stringify(img.origin) : '-';
    console.log(`${pad}layer id=${l.id} name=${JSON.stringify(l.name||'')} size=${size} crop=${crop} autosize=${img.autosize} origin=${origin} tex=${tex} puppet=${img.puppet||'-'}`);
    if (l.layers && l.layers.length) dumpModel2(l.layers, depth + 1);
  }
}

for (const o of objs) {
  console.log('\n=== object', o.id, JSON.stringify(o.name||''), 'image:', o.image);
  dumpModel(o.image, 1);
  if (o.layers && o.layers.length) dumpModel2(o.layers, 2);
}
