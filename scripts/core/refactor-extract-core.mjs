// 重构: 从 scene-renderer.js 提取 SceneRenderer 类主体 → we-renderer/core.js
// 顶层工具改为 import (math/canvas/textures/mdl), 类内逻辑原样保留
import fs from 'node:fs';

const src = fs.readFileSync('lib/scene-renderer.js', 'utf8');
const lines = src.split('\n');

// 找到 export class SceneRenderer 行
let classStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('export class SceneRenderer')) { classStart = i; break; }
}
if (classStart < 0) { console.error('SceneRenderer class not found'); process.exit(1); }

// 类主体 (含尾随 export 语句, 如果有)
const classBody = lines.slice(classStart).join('\n');

// 需要从子模块 import 的标识符
const importNames = [
  // math.js
  'parseVec3', 'parseVec2', 'getVal',
  'v3sub', 'v3add', 'v3cross', 'v3dot', 'v3norm',
  'mat4Identity', 'mat4Mul', 'mat4Perspective', 'mat4Ortho', 'mat4LookAt', 'mat4FromTRS',
  'mat4TransformPoint', 'mat4TransformVec3', 'sat',
  'applyBlending', '_greyscale', '_frac', 'rgb2hsv', 'hsv2rgb', 'smoothstepFn',
  // canvas.js
  'Canvas', 'encodePng', 'decodePngBuffer',
  // textures.js
  'readPkgDir', 'readPkg', 'loadTexImage', 'loadPngFile',
  // mdl.js
  'parseMdlPuppet', 'parseMdlStatic',
  // bloom/camera 已在 core 内, 无需 import
];

// 新头部
const header = `// WE 渲染引擎 — SceneRenderer 主体 (core)
// 独立子目录 lib/we-renderer/: 工具层拆分 (math/canvas/textures/mdl),
// 类主体集中于此便于调试; 由 ../scene-renderer.js 兼容再导出
import fs from 'fs';
import path from 'path';
import { parseTex, decodeTex } from '../pkg-extract.js';
import { parseCffFont, renderText } from '../font-render.js';
import { applySceneScripts } from '../scene-scripts.js';
import {
  parseVec3, parseVec2, getVal,
  v3sub, v3add, v3cross, v3dot, v3norm,
  mat4Identity, mat4Mul, mat4Perspective, mat4Ortho, mat4LookAt, mat4FromTRS,
  mat4TransformPoint, mat4TransformVec3, sat,
  applyBlending, _greyscale, _frac, rgb2hsv, hsv2rgb, smoothstepFn,
} from './math.js';
import { Canvas, encodePng, decodePngBuffer } from './canvas.js';
import { readPkgDir, readPkg, loadTexImage, loadPngFile } from './textures.js';
import { parseMdlPuppet, parseMdlStatic } from './mdl.js';

`;

fs.writeFileSync('lib/we-renderer/core.js', header + classBody);
console.log('core.js 已生成:', (header + classBody).split('\n').length, '行');
