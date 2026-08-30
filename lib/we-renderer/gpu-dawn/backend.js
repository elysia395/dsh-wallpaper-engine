// WE 渲染引擎 — Dawn (WebGPU) 效果后端 (P4b)
// 官方 shader → preprocess → WGSL → Dawn compute 执行。
// 设计约束: WebGPU 设备/readback 异步 → 本后端是**异步** API (worker 场景帧管线用),
// 不能同步接入 applyEffects; 集成点为异步渲染管线 (scene-frame worker)。
// 门控: DSH_WE_DAWN=1 启用; DSH_WE_DAWN_MODULE 指定 webgpu 包路径 (默认 require('webgpu')).
// 支持效果 (v1): waterwaves / opacity / tint / skew / scroll — varying 模板内联 vert 数学
// (v_TexCoord + 掩码 UV 缩放 + 效果特有 varying); 其他效果返回 null → 调用方回退 CPU。
// 采样器: clamp-to-edge + 双线性 (对齐官方 GPU 路径); 单 dispatch + readback (静态帧)。
//
// 部署与边界 (可行性 spike 结论, RTX 4060 实测): `webgpu` npm 包 (Dawn 实现) tarball
// 自带全平台 prebuild (win32-x64 / linux-x64 / linux-arm64 / darwin-universal,
// 附 d3dcompiler_47.dll), 可走插件 ffmpeg 三档资产供给模式分发; 960×540 计算着色器
// 0.31ms/帧 vs CPU 6.58ms/帧 = 21.1×。Dawn 边界: 同一进程二次 create() 原生崩溃
// (Dawn 单例 → 每进程一个实例, 本文件 getDawnDevice 已是单例); unmap 后立即重建
// pipeline 可能崩溃 (readback 用独立 buffer 或延迟销毁, 见下方 readback 处)。
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from '@shaderfrog/glsl-parser';
import { preprocessShader, parseMeta } from '../glsl/preprocess.js';
import { emitWgslWithSlots } from '../glsl/wgsl.js';
import { buildUniforms } from '../glsl/executor.js';
import { getVal } from '../math.js';

const VEC_N = { vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4 };

let _dawn = null;
let _probed = false;

/** 惰性获取 Dawn device (单例)。异步 — 调用方需先预热 (渲染前 await 一次)。 */
export async function getDawnDevice() {
  if (_probed) return _dawn;
  _probed = true;
  if (process.env.DSH_WE_DAWN !== '1') { _dawn = null; return null; }
  try {
    const modPath = process.env.DSH_WE_DAWN_MODULE || 'webgpu';
    // 用动态 import (与验证 harness 一致) — require(esm) 的 dawn.node 绑定初始化行为不同
    const mod = await import(pathToFileURL(modPath).href);
    const create = mod.create, globals = mod.globals;
    Object.assign(globalThis, globals);
    const gpu = create([]);
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();
    // dawn.node 绑定初始化不稳定: 首个设备直接 dispatch 会原生崩溃 (0xC0000005) —
    // 观察到"先成功 dispatch 过某设备后再创建新设备"才稳定。预热: 用本设备执行
    // 一个 1×1 compute, 让绑定完成初始化。
    try {
      const warmOut = device.createBuffer({ size: 4, usage: globals.GPUBufferUsage.STORAGE | globals.GPUBufferUsage.COPY_SRC });
      const warmShader = device.createShaderModule({
        code: '@group(0) @binding(0) var<storage, read_write> out: array<u32>; @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3<u32>) { out[0] = 0u; }',
      });
      const warmLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: globals.GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] });
      const warmBg = device.createBindGroup({ layout: warmLayout, entries: [{ binding: 0, resource: { buffer: warmOut } }] });
      const warmPipe = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [warmLayout] }), compute: { module: warmShader, entryPoint: 'main' } });
      const warmEnc = device.createCommandEncoder();
      const warmPass = warmEnc.beginComputePass();
      warmPass.setPipeline(warmPipe);
      warmPass.setBindGroup(0, warmBg);
      warmPass.dispatchWorkgroups(1, 1, 1);
      warmPass.end();
      device.queue.submit([warmEnc.finish()]);
      await device.queue.onSubmittedWorkDone();
    } catch { /* 预热失败不影响 — 后续调用会再失败回退 CPU */ }
    _dawn = {
      device, globals,
      pipelines: new Map(),      // wgsl → pipeline
      layouts: new Map(),        // textureCount → bindGroupLayout
      sampler: null,
      samplerNearest: null,
    };
    return _dawn;
  } catch (e) {
    _dawn = null;
    return null;
  }
}

// ── 支持的效果 + varying 模板 ──
// 返回: { varyings, defines, textures } 或 null (不支持)
// maskScale = [mSx, mSy] (掩码纹理/对象尺寸比; 无掩码 = [1,1])
// mask UV 缩放 (sf39i): 官方 vert v_TexCoord.z *= maskRes.z/x — 掩码尺寸 ≠ 对象
// 尺寸时必须缩放, 否则 mask 采样错位 (CPU 内核按 mask宽/对象宽 计算)。
function effectConfig(name, c, pass, t, renderer, imgW, imgH) {
  const pt = (pass && pass.textures) || [];
  const hasMask = !!pt[1] && pt[1] !== 'null';
  const mS = [1, 1];
  const maskUVOff = [0, 0]; // 半 texel (texel 中心系对齐 CPU _texSample)
  if (hasMask && renderer && pt[1] && imgW > 0) {
    try {
      const m = renderer.loadTexture(pt[1]);
      if (m && m.width > 0) {
        mS[0] = m.width / imgW; mS[1] = m.height / imgH;
      } else if (process.env.DSH_WE_DEBUG_DAWN === '1') {
        console.error('[dawn-backend] mask ' + pt[1] + ' 加载为空 (m=' + (m ? m.width + 'x' + m.height : 'null') + ')');
      }
    } catch (e) {
      if (process.env.DSH_WE_DEBUG_DAWN === '1') console.error('[dawn-backend] mask ' + pt[1] + ' 加载异常:', e && e.message, '\n' + (e && e.stack || '').split('\n').slice(0, 8).join('\n'));
    }
  }
  const combos = (pass && pass.combos) || {};
  const vTexCoord4 = (ms, off) => `vec4f(uv.x, uv.y, uv.x * ${ms[0]} + ${off[0]}, uv.y * ${ms[1]} + ${off[1]})`;
  const vTexCoord2 = 'vec2f(uv.x, uv.y)';
  switch (name) {
    case 'waterwaves': {
      const dir = getVal(c, 'direction', 0);
      const defines = { PERSPECTIVE: '0', MASK: hasMask ? '1' : '0', TIMEOFFSET: '0', DUALWAVES: (c.direction2 != null || c.scale2 != null) ? '1' : '0' };
      return {
        varyings: {
          v_TexCoord: vTexCoord4(mS, maskUVOff),
          v_Direction: `vec2f(${(-Math.sin(dir)).toFixed(6)}, ${Math.cos(dir).toFixed(6)})`,
        },
        defines, maskScale: mS, combos,
      };
    }
    case 'opacity':
    case 'tint':
      return {
        varyings: { v_TexCoord: vTexCoord4(mS, maskUVOff) },
        defines: { MASK: hasMask ? '1' : '0', ...(name === 'tint' ? { BLENDMODE: String(combos.BLENDMODE != null ? combos.BLENDMODE : 30) } : {}) },
        maskScale: mS, combos,
      };
    case 'skew':
      return {
        varyings: { v_TexCoord: vTexCoord2 },
        defines: { REPEAT: String(combos.REPEAT != null ? combos.REPEAT : 1) },
        maskScale: mS, combos,
      };
    case 'scroll': {
      const sx = getVal(c, 'speedx', 0.2), sy = getVal(c, 'speedy', 0.2);
      const scrollX = Math.sign(sx) * sx * sx * t, scrollY = Math.sign(sy) * sy * sy * t;
      return {
        varyings: {
          v_TexCoord: vTexCoord2,
          v_Scroll: `vec2f(${scrollX.toFixed(6)}, ${scrollY.toFixed(6)})`,
        },
        defines: {}, maskScale: mS, combos,
      };
    }
    default:
      return null;
  }
}

// 解析 shader 源 (pkg 或 WE 全局 assets) — 与 integration.js _compileWorkshopEffect 同逻辑
function resolveShaderSource(renderer, name) {
  const stem = 'shaders/workshop/' + String(efId(renderer, name)) + '/effects/' + name;
  let frag = '';
  try { frag = renderer.pkg.readText(stem + '.frag') || ''; } catch { /* ignore */ }
  if (!frag && renderer.weAssetsDir) {
    const p = path.join(renderer.weAssetsDir, 'assets', 'effects', name, 'shaders', 'effects', name + '.frag');
    try { if (fs.existsSync(p)) frag = fs.readFileSync(p, 'utf8'); } catch { /* ignore */ }
  }
  return frag || null;
}
function efId(renderer, name) {
  // workshop id: 从 ef.file 推断 "effects/workshop/<id>/..." — 简化: 由调用方传 ef
  return '';
}

// 编译效果 → WGSL + 槽位 (缓存)
const _compileCache = new Map();
function compileEffect(renderer, name, c, pass, t, imgW, imgH) {
  const cfg = effectConfig(name, c, pass, t, renderer, imgW, imgH);
  if (!cfg) return null;
  const frag = resolveShaderSource(renderer, name);
  if (!frag) return null;
  const key = name + '|' + JSON.stringify(cfg.defines) + '|' + JSON.stringify(cfg.varyings) + '|' + imgW + 'x' + imgH;
  if (_compileCache.has(key)) return _compileCache.get(key);
  try {
    const pre = preprocessShader(frag, {
      defines: cfg.defines,
      resolveInclude: (inc) => {
        if (renderer.weAssetsDir) {
          const p = path.join(renderer.weAssetsDir, 'assets', 'shaders', inc);
          try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch { /* ignore */ }
        }
        try { return renderer.pkg.readText('shaders/' + inc) || ''; } catch { /* ignore */ }
        return '';
      },
    });
    const ast = parse(pre, { stage: 'fragment', quiet: true });
    // parseMeta 必须在原始源码上解析 — 预处理后 uniform 注释可能丢失 → material 映射为空
    const meta = parseMeta(frag);
    const texNames = Object.keys(meta.uniforms).filter((n) => meta.uniforms[n].type === 'sampler2D');
    const { wgsl, slots, totalSlots } = emitWgslWithSlots(ast, {
      varyings: cfg.varyings,
      textures: texNames,
      sizeX: imgW, sizeY: imgH,
    });
    const result = { wgsl, slots, totalSlots, texNames, meta, pre };
    if (process.env.DSH_WE_DEBUG_DAWN === '1') {
      try { fs.writeFileSync(path.join(process.env.TMPDIR || process.env.TEMP || '.', 'dsh-dawn-' + name + '.wgsl'), wgsl); } catch { /* ignore */ }
    }
    _compileCache.set(key, result);
    return result;
  } catch (e) {
    if (process.env.DSH_WE_DEBUG_DAWN === '1') console.error('[dawn-backend] compile ' + name + ' 失败:', e && e.message);
    return null;
  }
}

// 纹理上传 (创建 + writeTexture) — 返回 texture
function uploadTexture(dawn, img) {
  const { device, globals } = dawn;
  const w = img.width, h = img.height;
  const tex = device.createTexture({ size: { width: w, height: h }, format: 'rgba8unorm', usage: globals.GPUTextureUsage.TEXTURE_BINDING | globals.GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: tex }, img.rgba, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
  return tex;
}

// 白色 1x1 占位纹理 (null sampler 兜底)
let _whiteTex = null;
function whiteTexture(dawn) {
  if (_whiteTex) return _whiteTex;
  const { device, globals } = dawn;
  _whiteTex = device.createTexture({ size: { width: 1, height: 1 }, format: 'rgba8unorm', usage: globals.GPUTextureUsage.TEXTURE_BINDING | globals.GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: _whiteTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4, rowsPerImage: 1 }, { width: 1, height: 1, depthOrArrayLayers: 1 });
  return _whiteTex;
}

/** 执行单个效果 (异步)。失败/不支持返回 null → 调用方回退 CPU。
 *  @param {object} extDevice 可选外部设备 (调用方顶层创建 — dawn.node 绑定在
 *    某些环境下 getDawnDevice 内部创建的设备 dispatch 会原生崩溃; 顶层创建的可用) */
export async function runEffectOnDawn(renderer, img, ef, name, c, pass, t, extDevice = null) {
  const dawn = extDevice ? { device: extDevice, globals: _dawn ? _dawn.globals : globalThis, pipelines: new Map(), layouts: new Map(), sampler: null } : await getDawnDevice();
  if (!dawn) return null;
  const compiled = compileEffect(renderer, name, c, pass, t, img.width, img.height);
  if (!compiled) return null;
  const { device, globals } = dawn;
  const dbg = (m) => { if (process.env.DSH_WE_DEBUG_DAWN === '1') console.error('[dawn-backend] ' + name + ': ' + m); };
  try {
    // 纹理绑定: tex0 = 输入 img; texN (N≥1) = pass.textures[N]
    const pt = (pass && pass.textures) || [];
    const texs = [img];
    for (let n = 1; n < compiled.texNames.length; n++) {
      const ref = pt[n];
      let texImg = null;
      if (ref && ref !== 'null') { try { texImg = renderer.loadTexture(ref); } catch { /* ignore */ } }
      texs.push(texImg || { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) });
    }
    dbg('textures: ' + texs.map((x) => x.width + 'x' + x.height).join(','));
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    // 与验证 harness (dbt-iso) 完全一致的创建顺序: shader → 纹理 → 缓冲 → uniform → layout → pipeline
    const shader = device.createShaderModule({ code: compiled.wgsl });
    dbg('shader created');
    const gpuTexs = texs.map((im) => uploadTexture(dawn, im));
    dbg('uploaded');
    const W = img.width, H = img.height;
    const outBuf = device.createBuffer({ size: W * H * 4, usage: globals.GPUBufferUsage.STORAGE | globals.GPUBufferUsage.COPY_SRC });
    // uniform buffer (槽位序; 值来自 buildUniforms)
    const meta = compiled.meta;
    const engine = {
      time: t || 0,
      textures: texs,
      objW: img.width, objH: img.height,
      userAlpha: 1,
      parallaxPosition: [0.5, 0.5],
    };
    const u = buildUniforms(meta.uniforms, c || {}, engine);
    // 按槽位序取值 (parseMeta 的迭代序 ≠ AST 声明序: 无注释 uniform 排最后)
    const values = [];
    for (const [uname, off] of Object.entries(compiled.slots)) {
      const info = meta.uniforms[uname];
      if (!info || info.type === 'sampler2D') continue;
      const n = VEC_N[info.type] || 1;
      const v = u[uname];
      for (let i = 0; i < n; i++) {
        const cv = v != null ? (typeof v === 'number' ? v : (v[i] != null ? v[i] : v[0] != null ? v[0] : 0)) : 0;
        values.push(typeof cv === 'number' && isFinite(cv) ? cv : 0);
      }
    }
    while (values.length < compiled.totalSlots) values.push(0);
    const unif = new Float32Array(values);
    dbg('uniforms: ' + unif.length + ' 值 [' + Array.from(unif).map((x) => (isFinite(x) ? x.toFixed(3) : 'NaN/Inf')).join(',') + ']');
    const unifBuf = device.createBuffer({ size: Math.max(16, unif.length * 4), usage: globals.GPUBufferUsage.UNIFORM | globals.GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(unifBuf, 0, unif);
    // layout (缓存 per 纹理数)
    const texN = gpuTexs.length;
    const layoutKey = texN;
    let layout = dawn.layouts.get(layoutKey);
    if (!layout) {
      const entries = [];
      for (let i = 0; i < texN; i++) entries.push({ binding: i, visibility: globals.GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } });
      // per-texture 采样器 (与发射器 samp0..sampN-1 对齐)
      for (let i = 0; i < texN; i++) entries.push({ binding: texN + i, visibility: globals.GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } });
      entries.push({ binding: texN * 2, visibility: globals.GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } });
      entries.push({ binding: texN * 2 + 1, visibility: globals.GPUShaderStage.COMPUTE, buffer: { type: 'storage' } });
      layout = device.createBindGroupLayout({ entries });
      dawn.layouts.set(layoutKey, layout);
    }
    let pipeline = dawn.pipelines.get(compiled.wgsl);
    if (!pipeline) {
      pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module: shader, entryPoint: 'main' } });
      dawn.pipelines.set(compiled.wgsl, pipeline);
    }
    // 采样器: clamp-to-edge。过滤策略对齐 CPU 内核 (P4b = 加速替代, 输出不变):
    //   waterwaves: 源纹理 (tex0) 最近邻 floor; mask/辅助 (texN≥1) 双线性 _texSample
    //   opacity/tint/skew/scroll: 全部双线性 (_texSample)
    if (!dawn.sampler) dawn.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    if (!dawn.samplerNearest) dawn.samplerNearest = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const bgEntries = [];
    for (let i = 0; i < texN; i++) bgEntries.push({ binding: i, resource: gpuTexs[i].createView() });
    for (let i = 0; i < texN; i++) {
      const useNearest = name === 'waterwaves' && i === 0;
      bgEntries.push({ binding: texN + i, resource: useNearest ? dawn.samplerNearest : dawn.sampler });
    }
    bgEntries.push({ binding: texN * 2, resource: { buffer: unifBuf } });
    bgEntries.push({ binding: texN * 2 + 1, resource: { buffer: outBuf } });
    const bindGroup = device.createBindGroup({ layout, entries: bgEntries });
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(pipeline);
    cp.setBindGroup(0, bindGroup);
    cp.dispatchWorkgroups(Math.ceil(W / 64), H, 1);
    cp.end();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const vErr = await device.popErrorScope();
    const oomErr = await device.popErrorScope();
    if (vErr && process.env.DSH_WE_DEBUG_DAWN === '1') console.error('[dawn-backend] validation:', vErr.message.split('\n').slice(0, 4).join(' | '));
    // readback (unmap 前拷贝 — unmap detach ArrayBuffer)
    const readBuf = device.createBuffer({ size: W * H * 4, usage: globals.GPUBufferUsage.COPY_DST | globals.GPUBufferUsage.MAP_READ });
    const enc2 = device.createCommandEncoder();
    enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, W * H * 4);
    device.queue.submit([enc2.finish()]);
    await device.queue.onSubmittedWorkDone();
    await readBuf.mapAsync(globals.GPUMapMode.READ);
    const rgba = new Uint8Array(new Uint8Array(readBuf.getMappedRange(0, W * H * 4)));
    readBuf.unmap();
    return { width: W, height: H, rgba };
  } catch (e) {
    if (process.env.DSH_WE_DEBUG_DAWN === '1') console.error('[dawn-backend] ' + name + ' 失败:', e && e.message, (e && e.stack || '').split('\n').slice(0, 3).join(' | '));
    return null;
  }
}

/** 执行对象的效果链 (Dawn, 异步)。任一效果不支持/失败 → 返回 null (整体回退 CPU)。
 *  @param {object} extDevice 可选外部设备 (顶层创建 — 规避 getDawnDevice 内部设备
 *    在某些环境下的 dawn.node 原生崩溃) */
export async function renderEffectsOnDawn(renderer, img, effects, t, extDevice = null) {
  let current = img;
  for (const ef of effects || []) {
    if (getVal(ef, 'visible', true) === false) continue;
    const file = ef.file || '';
    if (!file) continue;
    const name = path.basename(path.dirname(file));
    const pass = (ef.passes && ef.passes[0]) || {};
    const c = pass.constantshadervalues || {};
    const out = await runEffectOnDawn(renderer, current, ef, name, c, pass, t, extDevice);
    if (!out) return null;
    current = out;
  }
  return current;
}

// ── 预计算模式 (P4b 集成): worker 在 render() 前异步预渲染支持的效果 ──
const SUPPORTED = new Set(['waterwaves', 'opacity', 'tint', 'skew', 'scroll']);
// 特殊 shader 路径 (renderImage 里在 applyEffects 之前的预处理) — 预计算需跳过
const SPECIAL_SHADERS = new Set(['swayimage', 'flag', 'retro', 'flat', 'flatalpha']);

/** 预渲染所有"纯 image + 支持效果"对象的 Dawn 效果链 → Map<objectId, 效果后图像>。
 *  仅含支持效果 (全链支持) 且无特殊 shader/无 spritesheet/无 puppet/passthrough/
 *  solidlayer 的对象; 其余跳过 (CPU 原路径)。
 *  @returns {Map<number, object>} 或 null (Dawn 不可用/无目标) */
export async function precomputeEffectsDawn(renderer, t, extDevice = null) {
  const dev = extDevice ? { device: extDevice, globals: (await getDawnDeviceSafeGlobals()) } : await getDawnDevice();
  if (!dev) return null;
  const cache = new Map();
  for (const o of renderer.objects || []) {
    if (!o || !o.image || !Array.isArray(o.effects) || !o.effects.length) continue;
    const names = o.effects.map((ef) => ef.file ? path.basename(path.dirname(ef.file)) : '');
    if (!names.every((n) => SUPPORTED.has(n))) continue;
    // 特殊路径跳过
    const model = renderer.readJsonAny ? renderer.readJsonAny(o.image) : null;
    if (!model) continue;
    if (model.puppet || model.passthrough === true || model.solidlayer === true) continue;
    const mat = model.material ? (renderer.readJsonAny ? renderer.readJsonAny(model.material) : null) : null;
    const pass0 = mat && mat.passes && mat.passes[0];
    const shaderName = pass0 ? pass0.shader : '';
    if (shaderName && SPECIAL_SHADERS.has(shaderName)) continue;
    if (pass0 && pass0.combos && (pass0.combos.spritesheet || pass0.combos.SPRITESHEET)) continue;
    const img = renderer.loadModelTexture(o.image);
    if (!img) continue;
    const out = await renderEffectsOnDawn(renderer, img, o.effects, t, extDevice);
    if (out) cache.set(o.id, out);
  }
  return cache.size ? cache : null;
}

async function getDawnDeviceSafeGlobals() {
  // extDevice 模式: 调用方已 Object.assign(globalThis, dawnMod.globals) —
  // 直接取 globalThis。**绝不**在此触发 getDawnDevice(): 那会创建第二个设备,
  // 其"首个 dispatch"预热会原生崩溃 (0xC0000005, dawn.node 绑定顺序敏感)。
  return globalThis;
}
