// WE 渲染引擎 — 兼容入口 (re-export from we-renderer/)
// 实际实现在 lib/we-renderer/core.js (SceneRenderer 主体) + 工具子模块
export { SceneRenderer } from './we-renderer/core.js';
export { parseVec3, parseVec2, getVal, applyBlending } from './we-renderer/math.js';
export { Canvas, encodePng, decodePngBuffer } from './we-renderer/canvas.js';
export { readPkgDir, readPkg, loadTexImage, loadPngFile } from './we-renderer/textures.js';
export { parseMdlPuppet, parseMdlStatic } from './we-renderer/mdl.js';
// N-15: applyBloom 再导出随 bloom.js 死代码删除一并移除 (全仓 grep 无 import 消费)
export { resolveCameraPose, computeParallaxDisplacement, setupCameraMatrices } from './we-renderer/camera.js';
