// WE GPU 后端 — 多 pass FBO 链执行器 (bloom 等)
// effect.json 的 fbos/passes 结构: 逐 pass 以 target FBO 分辨率渲染, 输入纹理
// 来自 "previous"(原始) 或已渲染 FBO; 无 target 的 pass 输出最终结果。
// 与 CPU _renderGlslMultiPass 同语义, 差异仅在 WebGL FBO 乒乓 + readPixels。
// 任何失败抛错 → 调用方回退 CPU。
import { createGLContext } from './gl-core.js';
import { runEffectOnGL } from './gl-effect.js';

let _gl = null;
function getGL() {
  if (!_gl) {
    _gl = createGLContext(64, 64);
    if (!_gl) throw new Error('WebGL 不可用');
  }
  return _gl;
}

/**
 * 执行多 pass 链。
 * @param {object} opts
 * @param {object} opts.ef 合并后 effect 定义 { fbos, passes }
 * @param {{width,height,rgba}} opts.img 输入帧
 * @param {(materialPath) => {fragPre,vertPre,uniforms}} opts.passShader 材质 → 编译结果
 * @param {(matPath) => object} opts.readMaterial 材质 JSON 读取
 * @param {object} opts.uPerPass 每 pass 的 uniform 组装函数 (pass, compiled, input) => u
 * @returns {{width,height,rgba}} 结果
 */
export function runMultiPassOnGL({ ef, img, passShader, uPerPass }) {
  const W = img.width, H = img.height;
  const fbos = {};
  for (const f of ef.fbos || []) {
    const sc = f.scale || 1;
    fbos[f.name] = { width: Math.max(1, Math.round(W / sc)), height: Math.max(1, Math.round(H / sc)), rgba: null };
  }
  let last = img;
  for (const pass of ef.passes || []) {
    const compiled = passShader(pass.material);
    if (!compiled) continue;
    const target = pass.target ? fbos[pass.target] : null;
    const outW = target ? target.width : W;
    const outH = target ? target.height : H;
    // 纹理绑定: bind[i].name → "previous"(原始) 或 FBO 名
    const bound = [];
    for (const b of pass.bind || []) {
      if (b.name === 'previous') bound[b.index] = img;
      else if (fbos[b.name] && fbos[b.name].rgba) bound[b.index] = fbos[b.name];
      else bound[b.index] = null;
    }
    const inputTex = bound[0] || img;
    // sampler uniform 组装 (与 CPU 路径一致): g_TextureN → bound[N]
    const u = uPerPass ? uPerPass(pass, compiled, inputTex, bound, outW, outH) : {};
    const out = runEffectOnGL({
      fragPre: compiled.fragPre,
      vertPre: compiled.vertPre,
      u,
      width: outW, height: outH,
    });
    if (!out) continue;
    if (target) { target.rgba = out.rgba; target.width = out.width; target.height = out.height; }
    else last = out;
  }
  return last;
}
