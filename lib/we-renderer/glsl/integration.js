// WE GLSL 渲染集成 — 第三方 workshop 效果通用执行器 (mixin)
// applyEffects 的 else 分支调用 _applyGlslEffect: 从 pkg 读 shader → 编译缓存 →
// 逐像素渲染; 失败回退原图 (不崩溃)。GPU 加速 (sf40h): 配置 sceneGpuAccel
// 开启 (附属 beta场景动画) 且 x64 + supreium-headless-gl (WebGL/ANGLE) 可用时,
// 内置/GLSL 效果优先 GPU 执行 (同一份 preprocess 结果, 输出与 CPU 一致),
// 任何 GPU 失败/不可用回退 CPU (与 ffmpeg 的"可用则加速、不可用回退"同模式)。
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { compileGlsl, buildUniforms, renderGlsl } from './executor.js';
import { getVal } from '../math.js';

const _require = createRequire(import.meta.url);

// GPU 后端 (惰性加载, 模块级缓存避免重复 require): x64 且包可用时非 null;
// 实际启用还看实例 this.gpuAccel (见 _getGpuBackend)。
let _gpuBackend = null;
let _gpuBackendProbed = false;
function probeGpuBackend() {
  if (_gpuBackendProbed) return _gpuBackend;
  _gpuBackendProbed = true;
  // 测试/排查开关: DSH_WE_GPU_GL=0 强制 CPU; =1 强制 (跳过 gpuAccel 门控)
  if (process.env.DSH_WE_GPU_GL === '0') { _gpuBackend = null; return null; }
  try {
    const core = _require('../gpu-gl/gl-core.js');
    if (!core.isGPUAvailable()) { _gpuBackend = null; return null; }
    _gpuBackend = {
      runEffectOnGL: _require('../gpu-gl/gl-effect.js').runEffectOnGL,
      runEffectChainOnGL: _require('../gpu-gl/gl-effect.js').runEffectChainOnGL,
      runMultiPassOnGL: _require('../gpu-gl/gl-multipass.js').runMultiPassOnGL,
    };
    return _gpuBackend;
  } catch { _gpuBackend = null; return null; }
}

export function installGlsl(proto) {
  proto._glslCache = null;

  // GPU 后端实例门控: 配置 sceneGpuAccel 开启 (或 DSH_WE_GPU_GL=1 测试强制)
  // 且平台可用才返回后端; 否则 null → 全 CPU。
  proto._getGpuBackend = function () {
    if (!this.gpuAccel && process.env.DSH_WE_GPU_GL !== '1') return null;
    return probeGpuBackend();
  };

  // 编译并缓存 (key = effect.file)
  proto._compileWorkshopEffect = function (ef, combosOverride = null) {
    const name = path.basename(path.dirname(ef.file));
    const id = String(ef.file).split('/')[2];
    const pass = ef.passes && ef.passes[0];
    const combos = combosOverride || (pass && pass.combos) || {};
    // sf42: NODE_COUNT 推断 — auto_sway 等分节点效果: 场景对象只存控制点
    // 常量 (center1..centerN / size1..sizeN), NODE_COUNT combo 由编辑器按
    // 控制点数量自动生成; 但部分场景对象漏存 NODE_COUNT (皓风琦 3640755971
    // 第一个 auto_sway 对象 combos 只有 {DEBUG:0}) → shader 里
    // `#if NODE_COUNT == N` 全 false → `#define rootLen/rootPosX` 全部不生效
    // → 残活分支引用裸 rootLen → "rootLen is not defined" (持续存在错误)。
    // 官方语义: NODE_COUNT = 控制点常量数量 (center1..N 或 size1..N 的最大下标)。
    if (combos.NODE_COUNT === undefined && pass && pass.constantshadervalues) {
      const cv = pass.constantshadervalues;
      let maxNode = 0;
      for (const k of Object.keys(cv)) {
        const m = /^(?:center|size)(\d+)$/.exec(k);
        if (m) maxNode = Math.max(maxNode, Number(m[1]));
      }
      if (maxNode >= 2) combos.NODE_COUNT = maxNode;
    }
    const key = ef.file + '|' + JSON.stringify(combos);
    if (!this._glslCache) this._glslCache = new Map();
    if (this._glslCache.has(key)) return this._glslCache.get(key);
    const stem = 'shaders/workshop/' + id + '/effects/' + name;
    let frag = '';
    try { frag = this.pkg.readText(stem + '.frag') || ''; } catch {}
    if (!frag) {
      // 尝试官方全局 shader (assets/effects/<name>/shaders/effects/<name>.frag)
      if (this.weAssetsDir) {
        const p = path.join(this.weAssetsDir, 'assets', 'effects', name, 'shaders', 'effects', name + '.frag');
        try { if (fs.existsSync(p)) frag = fs.readFileSync(p, 'utf8'); } catch {}
      }
    }
    if (!frag) { this._glslCache.set(key, null); return null; }
    let vert = '';
    try { vert = this.pkg.readText(stem + '.vert') || ''; } catch {}
    if (!vert && this.weAssetsDir) {
      const p = path.join(this.weAssetsDir, 'assets', 'effects', name, 'shaders', 'effects', name + '.vert');
      try { if (fs.existsSync(p)) vert = fs.readFileSync(p, 'utf8'); } catch {}
    }
    let compiled = null;
    try {
      compiled = compileGlsl({
        fragSource: frag,
        vertSource: vert || null,
        combos,
        resolveInclude: (inc) => this._resolveGlslInclude(inc),
      });
    } catch (e) {
      this.log('GLSL 编译失败 ' + name + ': ' + e.message);
    }
    this._glslCache.set(key, compiled);
    return compiled;
  };

  proto._resolveGlslInclude = function (inc) {
    if (this.weAssetsDir) {
      const p = path.join(this.weAssetsDir, 'assets', 'shaders', inc);
      try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch {}
    }
    try { return this.pkg.readText('shaders/' + inc) || ''; } catch {}
    return '';
  };

  // ── 内置效果 GPU 优先 (sf40h): 官方 shader + WebGL 执行 ──
  // 官方内置效果 (waterwaves/waterripple/shake/foliagesway...) 走手写 CPU 实现
  // (性能热点: Plana 水层 4 效果 3840×1741 全分辨率)。这里用官方 shader 编译
  // + GPU 执行 (与手写实现同一官方数学), 失败/不可用返回 null → 手写 CPU 回退。
  // combos 推断与手写实现同逻辑 (从 pass 参数/textures 判断 MASK/DUALWAVES 等)。
  proto._tryEffectGpu = function (img, ef, name, c, pass, t) {
    const gpu = this._getGpuBackend();
    if (!gpu) return null;
    try {
      // combos 推断 (对齐各手写实现的判断):
      const combos = inferBuiltinCombos(name, c, pass);
      const compiled = this._compileWorkshopEffect(ef, combos);
      if (!compiled || !compiled.fragPre) return null;
      const texRefs = (pass && pass.textures) || [];
      const textures = texRefs.map((p) => (p && p !== 'null' ? this.loadTexture(p) : null));
      const u = buildUniforms(compiled.uniforms, c, {
        time: t || 0,
        textures,
        objW: img.width,
        objH: img.height,
        userAlpha: 1,
        parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
      });
      for (const [un, info] of Object.entries(compiled.uniforms)) {
        if (info.type === 'sampler2D' && u[un] == null) {
          const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
          // WE 约定: pass.textures 1 起始 (index 0 占位), g_TextureN ↔ textures[N]
          // (g_Texture0 = 隐式场景输入 img)。手写 CPU 实现同约定 (pt[1]=g_Texture1)。
          u[un] = idx === 0 ? img : (textures[idx] || null);
        }
      }
      const gpuOut = gpu.runEffectOnGL({
        fragPre: compiled.fragPre,
        vertPre: compiled.vertPre,
        u,
        width: img.width, height: img.height,
      });
      if (process.env.DSH_WE_DEBUG_GLSL === '1') this._gpuOutStats(gpuOut, '内置 ' + name);
      return gpuOut;
    } catch (e) {
      if (process.env.DSH_WE_DEBUG_GLSL === '1') this.log('内置效果 GPU ' + name + ' 失败回退 CPU: ' + e.message);
      return null;
    }
  };

  // 诊断 (DSH_WE_DEBUG_GLSL=1): GPU 效果输出统计 — 定位"GPU 渲染全白"来源
  // (全白通常是 null sampler 绑白纹理后整帧采样白 / uniform 缺默认值)。
  proto._gpuOutStats = function (out, label) {
    if (!out || !out.rgba) return;
    let s = 0, m = 0, white = 0, nz = 0;
    const np = (out.width || 0) * (out.height || 0);
    if (!np) return;
    for (let i = 0; i < np; i++) {
      const r = out.rgba[i * 4], g = out.rgba[i * 4 + 1], b = out.rgba[i * 4 + 2];
      const lum = (r + g + b) / 3;
      s += lum; if (lum > m) m = lum;
      if (r >= 250 && g >= 250 && b >= 250) white++;
      if (lum > 2) nz++;
    }
    this.log('GPU ' + label + ' 输出 ' + out.width + 'x' + out.height + ' avg=' + (s / np).toFixed(1) + ' max=' + m + ' white%=' + (100 * white / np).toFixed(1) + ' nz%=' + (100 * nz / np).toFixed(1));
  };

  // ── 连续效果链 GPU 批量 (sf40h): 同一对象多个效果在 GPU 内 FBO 乒乓 ──
  // 中间结果不读回 CPU — 大幅减少纹理上传/readPixels/CPU 组装
  // (水层 4 效果: 独立 4 次 ~400ms → 链式 ~35ms)。全部效果能编译 GPU
  // 才批量; 任一失败 → 返回 null → 调用方逐个回退原路径。
  proto._tryEffectChainGpu = function (img, o, t) {
    const gpu = this._getGpuBackend();
    if (!gpu || !gpu.runEffectChainOnGL) return null;
    const effs = (o.effects || []).filter((ef) => {
      if (getVal(ef, 'visible', true) === false) return false;
      return !!(ef && ef.file);
    });
    if (effs.length < 2) return null; // 单效果不批量
    try {
      const chain = [];
      for (const ef of effs) {
        const name = path.basename(path.dirname(ef.file));
        const pass = (ef.passes && ef.passes[0]) || {};
        const c = pass.constantshadervalues || {};
        const combos = inferBuiltinCombos(name, c, pass);
        const compiled = this._compileWorkshopEffect(ef, combos);
        if (!compiled || !compiled.fragPre) return null; // 任一失败 → 回退
        const texRefs = pass.textures || [];
        const textures = texRefs.map((p) => (p && p !== 'null' ? this.loadTexture(p) : null));
        const u = buildUniforms(compiled.uniforms, c, {
          time: t || 0,
          textures,
          objW: img.width,
          objH: img.height,
          userAlpha: 1,
          parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
        });
        for (const [un, info] of Object.entries(compiled.uniforms)) {
          if (info.type === 'sampler2D' && u[un] == null) {
            const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
            // WE 约定: pass.textures 1 起始 (index 0 占位), g_TextureN ↔ textures[N]
            u[un] = idx === 0 ? img : (textures[idx] || null);
          }
        }
        chain.push({ fragPre: compiled.fragPre, vertPre: compiled.vertPre, u });
      }
      const out = gpu.runEffectChainOnGL(chain, img.width, img.height);
      return out || null;
    } catch (e) {
      if (process.env.DSH_WE_DEBUG_GLSL === '1') this.log('效果链 GPU 失败回退: ' + e.message);
      return null;
    }
  };

  proto._glslSample = function (tex, u, v) {
    return this._texSample(tex, u, v, true); // clamp (GL 默认)
  };

  // 执行第三方/未实现效果: 返回新 RGBA 或原图 (失败回退)
  proto._applyGlslEffect = function (img, ef, name, t) {
    let compiled;
    try {
      compiled = this._compileWorkshopEffect(ef);
    } catch (e) {
      this.log('GLSL 效果 ' + name + ' 加载失败: ' + e.message);
      return img;
    }
    if (!compiled) return img;
    try {
      const pass = (ef.passes && ef.passes[0]) || {};
      const constants = pass.constantshadervalues || {};
      const texRefs = pass.textures || [];
      const textures = texRefs.map((p) => (p && p !== 'null' ? this.loadTexture(p) : null));
      const u = buildUniforms(compiled.uniforms, constants, {
        time: t || 0,
        textures,
        objW: img.width,
        objH: img.height,
        userAlpha: 1,
        parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
      });
      // sampler2D uniform 绑定: g_Texture0 = 当前纹理 (img), g_TextureN (N>0) = textures[N]
      // (WE 约定: pass.textures 1 起始, index 0 占位)
      for (const [un, info] of Object.entries(compiled.uniforms)) {
        if (info.type === 'sampler2D' && u[un] == null) {
          const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
          u[un] = idx === 0 ? img : (textures[idx] || null);
        }
      }
      const out = renderGlsl(compiled, {
        time: t || 0,
        sampler: this._glslSample.bind(this),
      });
      return out;
    } catch (e) {
      this.log('GLSL 效果 ' + name + ' 渲染失败: ' + e.message);
      return img;
    }
  };

  // 大对象降采样渲染: 超过阈值在小分辨率执行 GLSL 再放大 (静态帧近似, 防全屏效果过慢)
  const MAX_GLSL_PIXELS = 65536; // 256x256
  // 多 pass FBO 链 (bloom) 动画帧降采样上限: 全屏后处理降采样到 ≤384 宽执行
  // 再双线性放大 (辉光低频, 视觉等价; CPU 逐像素解释 16 pass 全分辨率过慢)。
  // 静态帧不降采样 (官方 GPU 全分辨率, 降采样放大=马赛克)。
  const BLOOM_MAX_W = 384;
  proto._applyGlslEffect = function (img, ef, name, t) {
    // 多 pass FBO 链 (bloom 等): fbos/target 定义在 effect.json (场景对象只存
    // passes 覆盖 + file 引用) → 从 pkg 读全量定义合并
    let full = ef;
    if (ef && ef.file && (!Array.isArray(ef.fbos) || !ef.fbos.length)) {
      try {
        const j = this.pkg.readJson(ef.file);
        if (j) {
          // effect.json 的 passes 含 material/bind/target (FBO 链结构);
          // 场景对象的 passes 是逐 pass 参数覆盖 (constantshadervalues/combos),
          // 按索引合并到 effect.json pass 上
          const jp = Array.isArray(j.passes) ? j.passes : [];
          const op = Array.isArray(ef.passes) ? ef.passes : [];
          const merged = jp.map((p, i) => {
            const o = op[i];
            return o ? { ...p, ...o, constantshadervalues: o.constantshadervalues || p.constantshadervalues, combos: o.combos || p.combos } : p;
          });
          full = { ...j, ...ef, passes: merged.length ? merged : op };
        }
      } catch { /* 保持原对象 */ }
    }
    if (full && Array.isArray(full.fbos) && full.fbos.length && Array.isArray(full.passes) && full.passes.length > 1) {
      // 多 pass 链 (bloom): 全分辨率执行 (正确性优先, 不降采样 — sf40f)。
      // GPU 优先 (WebGL FBO 乒乓, 与 CPU 同语义; 失败回退 CPU)。
      const gpu = this._getGpuBackend();
      if (gpu) {
        try {
          const out = this._renderGlslMultiPassGpu(gpu, img, full, t);
          if (process.env.DSH_WE_DEBUG_GLSL === '1') this._gpuOutStats(out, '多pass ' + name);
          if (out && out !== img) return out;
        } catch (e) {
          if (process.env.DSH_WE_DEBUG_GLSL === '1') this.log('GLSL 多pass GPU ' + name + ' 失败回退 CPU: ' + e.message);
        }
      }
      try {
        const out = this._renderGlslMultiPass(img, full, t);
        if (out && out !== img) return out;
      } catch (e) {
        this.log('GLSL 多pass ' + name + ' 失败: ' + e.message);
      }
      return img;
    }
    let compiled;
    try {
      compiled = this._compileWorkshopEffect(ef);
    } catch (e) {
      this.log('GLSL 效果 ' + name + ' 加载失败: ' + e.message);
      return img;
    }
    if (!compiled) return img;
    // GPU 优先 (sf40h): x64 + supreium-headless-gl 可用时全分辨率 GPU 执行
    // (同一份 fragPre/vertPre, 输出与 CPU 逐位一致; 失败/不可用回退 CPU)。
    // 静态帧与动画帧都走 GPU — WebGL 无 Dawn 的尺寸/持续执行崩溃限制。
    const gpu = this._getGpuBackend();
    if (gpu) {
      try {
        const out = this._renderGlslEffectGpu(gpu, compiled, img, ef, img.width, img.height, t);
        if (out && out !== img) return out;
      } catch (e) {
        if (process.env.DSH_WE_DEBUG_GLSL === '1') this.log('GLSL GPU ' + name + ' 失败回退 CPU: ' + e.message);
      }
    }
    // sf40f: 删除单 pass GLSL 降采样 (旧实现动画帧降采样 256×256 再放大 =
    // 马赛克) — 全分辨率执行 (CPU 慢但正确)
    return this._renderGlslEffect(compiled, img, ef, img.width, img.height, t);
  };

  // ── 单 pass 效果 GPU 执行 (WebGL) — uniform 组装与 CPU 路径共用 ──
  proto._renderGlslEffectGpu = function (gpu, compiled, img, ef, w, h, t) {
    const pass = (ef.passes && ef.passes[0]) || {};
    const constants = pass.constantshadervalues || {};
    const texRefs = pass.textures || [];
    const textures = texRefs.map((p) => (p && p !== 'null' ? this.loadTexture(p) : null));
    const u = buildUniforms(compiled.uniforms, constants, {
      time: t || 0,
      textures,
      objW: img.width,
      objH: img.height,
      userAlpha: 1,
      parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
    });
    // sampler2D uniform 绑定: g_Texture0 = 当前纹理 (img), g_TextureN (N>0) = textures[N]
    // (WE 约定: pass.textures 1 起始, index 0 占位)
    for (const [un, info] of Object.entries(compiled.uniforms)) {
      if (info.type === 'sampler2D' && u[un] == null) {
        const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
        u[un] = idx === 0 ? img : (textures[idx] || null);
      }
    }
    return gpu.runEffectOnGL({
      fragPre: compiled.fragPre,
      vertPre: compiled.vertPre,
      u,
      width: w, height: h,
    });
  };

  // ── 多 pass 链 GPU 执行 (WebGL FBO 乒乓) — 与 CPU _renderGlslMultiPass 同结构 ──
  proto._renderGlslMultiPassGpu = function (gpu, img, ef, t) {
    return gpu.runMultiPassOnGL({
      ef, img,
      passShader: (materialPath) => {
        const mat = this.pkg.readJson(materialPath);
        const mpp = mat && mat.passes && mat.passes[0];
        if (!mpp || !mpp.shader) return null;
        const stem = 'shaders/' + mpp.shader;
        const frag = this.pkg.readText(stem + '.frag') || '';
        if (!frag) return null;
        const vert = this.pkg.readText(stem + '.vert') || null;
        return compileGlsl({
          fragSource: frag,
          vertSource: vert,
          combos: mpp.combos || {},
          resolveInclude: (inc) => this._resolveGlslInclude(inc),
        });
      },
      uPerPass: (pass, compiled, inputTex, bound, outW, outH) => {
        const constants = pass.constantshadervalues || {};
        const u = buildUniforms(compiled.uniforms, constants, {
          time: t || 0,
          textures: bound,
          objW: inputTex.width || outW,
          objH: inputTex.height || outH,
          userAlpha: 1,
          parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
        });
        if (compiled.uniforms.g_TexelSize && u.g_TexelSize === undefined) {
          u.g_TexelSize = Float32Array.from([1 / (inputTex.width || outW), 1 / (inputTex.height || outH)]);
        }
        for (const [un, info] of Object.entries(compiled.uniforms)) {
          if (info.type === 'sampler2D' && u[un] == null) {
            const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
            // 无 bind 的 pass (bind=[]) → g_Texture0 隐式 = 输入帧 img
            // (blur_precise_gaussian_x 等首 pass; 旧实现绑 null → GPU 白纹理
            // → 整帧全白)。inputTex 已含 bound[0] || img 回退。
            u[un] = idx === 0 ? inputTex : (bound[idx] || null);
          }
        }
        return u;
      },
    });
  };

  // ── 多 pass FBO 链 (workshop bloom 等) ─────────────────────────
  // effect.json: fbos=[{name, scale}], passes=[{bind:[{index,name}], material, target}]
  // 逐 pass: 读材质 → shader → 编译 → 以 target FBO 分辨率渲染 → 存 FBO;
  // 无 target 的 pass (apply) 输出最终结果。输入纹理 "previous" = 原始帧。
  proto._renderGlslMultiPass = function (img, ef, t) {
    const W = img.width, H = img.height;
    const fbos = {};
    for (const f of ef.fbos || []) {
      const sc = f.scale || 1;
      fbos[f.name] = { width: Math.max(1, Math.round(W / sc)), height: Math.max(1, Math.round(H / sc)), rgba: null };
    }
    // 材质 → shader 名缓存
    const shaderCache = new Map();
    const passShader = (materialPath) => {
      try {
        const mat = this.pkg.readJson(materialPath);
        const mp = mat && mat.passes && mat.passes[0];
        if (!mp || !mp.shader) return null;
        const key = mp.shader + '|' + JSON.stringify(mp.combos || {});
        if (shaderCache.has(key)) return shaderCache.get(key);
        // shader 路径: materials 里的 shader 字段 "workshop/2822917890/effects/light_map"
        const stem = 'shaders/' + mp.shader;
        const frag = this.pkg.readText(stem + '.frag') || '';
        if (!frag) { shaderCache.set(key, null); return null; }
        const vert = this.pkg.readText(stem + '.vert') || null;
        const compiled = compileGlsl({
          fragSource: frag,
          vertSource: vert,
          combos: mp.combos || {},
          resolveInclude: (inc) => this._resolveGlslInclude(inc),
        });
        shaderCache.set(key, compiled);
        return compiled;
      } catch { return null; }
    };
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
      if (process.env.DSH_WE_DEBUG_GLSL === '1') {
        const _iv = inputTex && inputTex.rgba ? (() => { let s = 0, m = 0; for (let i = 0; i < (inputTex.width * inputTex.height || 1); i++) { const v = inputTex.rgba[i * 4]; s += v; if (v > m) m = v; } return { avg: (s / (inputTex.width * inputTex.height || 1)).toFixed(2), max: m }; })() : 'none';
        this.log('GLSL pass 输入 ' + (pass.target || 'OUT') + ' 来自 ' + (pass.bind && pass.bind[0] ? pass.bind[0].name : '?') + ': ' + JSON.stringify(_iv));
      }
      const constants = pass.constantshadervalues || {};
      const u = buildUniforms(compiled.uniforms, constants, {
        time: t || 0,
        textures: bound,
        objW: inputTex.width || outW,
        objH: inputTex.height || outH,
        userAlpha: 1,
        parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
      });
      // g_TexelSize (blur_gaussian.vert): 1/输入分辨率
      if (compiled.uniforms.g_TexelSize && u.g_TexelSize === undefined) {
        u.g_TexelSize = Float32Array.from([1 / (inputTex.width || outW), 1 / (inputTex.height || outH)]);
      }
      for (const [un, info] of Object.entries(compiled.uniforms)) {
        if (info.type === 'sampler2D' && u[un] == null) {
          const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
          // 无 bind 的 pass → g_Texture0 隐式 = 输入帧 img (同 GPU 路径)
          u[un] = idx === 0 ? inputTex : (bound[idx] || null);
        }
      }
      const out = renderGlsl(compiled, {
        width: outW, height: outH, u, textures: bound,
        time: t || 0,
        sampler: this._glslSample.bind(this),
      });
      if (!out) continue;
      if (process.env.DSH_WE_DEBUG_GLSL === '1') {
        let s = 0, m = 0;
        for (let i = 0; i < out.width * out.height; i++) { const v = out.rgba[i * 4]; s += v; if (v > m) m = v; }
        const ur = u.u_radius, ts = u.g_TexelSize;
        this.log('GLSL pass 输出 ' + (pass.target || 'OUT') + ': avg=' + (s / (out.width * out.height)).toFixed(2) + ' max=' + m + ' u_radius=' + ur + ' g_TexelSize=' + (ts ? Array.from(ts).map((x) => x.toFixed(4)).join(',') : 'none'));
        if (out.width >= 8 && out.height >= 8) {
          const p = (x, y) => out.rgba[(y * out.width + x) * 4];
          this.log('   px(1,1)=' + p(1, 1) + ' px(4,4)=' + p(4, 4) + ' px(8,8)=' + p(8, 8));
        }
      }
      if (target) { target.rgba = out.rgba; target.width = out.width; target.height = out.height; }
      else last = out;
    }
    return last;
  };

  proto._renderGlslEffect = function (compiled, img, ef, w, h, t) {
    try {
      const pass = (ef.passes && ef.passes[0]) || {};
      const constants = pass.constantshadervalues || {};
      const texRefs = pass.textures || [];
      const textures = texRefs.map((p) => (p && p !== 'null' ? this.loadTexture(p) : null));
      const u = buildUniforms(compiled.uniforms, constants, {
        time: t || 0,
        textures,
        objW: img.width,
        objH: img.height,
        userAlpha: 1,
        parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
      });
      // sampler2D uniform 绑定: g_Texture0 = 当前纹理 (img), g_TextureN (N>0) = textures[N]
      // (WE 约定: pass.textures 1 起始, index 0 占位)
      for (const [un, info] of Object.entries(compiled.uniforms)) {
        if (info.type === 'sampler2D' && u[un] == null) {
          const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
          u[un] = idx === 0 ? img : (textures[idx] || null);
        }
      }
      const out = renderGlsl(compiled, {
        width: w, height: h, u, textures,
        time: t || 0,
        sampler: this._glslSample.bind(this),
      });
      return out;
    } catch (e) {
      // 修复: 旧实现引用本函数不存在的 `name` → 任何 GLSL 效果失败都被
      // ReferenceError("name is not defined") 掩盖, 真实错误全部丢失。
      const efName = ef && ef.file ? path.basename(path.dirname(ef.file)) : '?';
      const dbg = (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : '');
      this.log('GLSL 效果 ' + efName + ' 渲染失败: ' + e.message + (dbg ? ' || ' + dbg : ''));
      return img;
    }
  };

  // 双线性放大 (降采样结果 → 原始尺寸)。最近邻放大会在边缘产生马赛克块
  // (静态帧 3840→384→3840 的 10 倍最近邻 = 明显色块; 用户反馈静态帧马赛克),
  // 双线性平滑消除。GL 纹理采样默认线性过滤, 与官方行为一致。
  proto._upsampleRgba = function (small, W, H) {
    const out = new Uint8Array(W * H * 4);
    const sw = small.width, sh = small.height;
    const src = small.rgba;
    for (let y = 0; y < H; y++) {
      const gy = ((y + 0.5) * sh / H) - 0.5;
      const y0 = Math.max(0, Math.floor(gy));
      const y1 = Math.min(sh - 1, y0 + 1);
      const ty = Math.max(0, Math.min(1, gy - y0));
      const dstRow = y * W * 4;
      for (let x = 0; x < W; x++) {
        const gx = ((x + 0.5) * sw / W) - 0.5;
        const x0 = Math.max(0, Math.floor(gx));
        const x1 = Math.min(sw - 1, x0 + 1);
        const tx = Math.max(0, Math.min(1, gx - x0));
        const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
        const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        const di = dstRow + x * 4;
        for (let c = 0; c < 4; c++) {
          const top = src[i00 + c] * (1 - tx) + src[i10 + c] * tx;
          const bot = src[i01 + c] * (1 - tx) + src[i11 + c] * tx;
          out[di + c] = Math.round(top * (1 - ty) + bot * ty);
        }
      }
    }
    return { width: W, height: H, rgba: out };
  };
}

// ── 内置效果 combo 推断 (对齐手写实现判断逻辑) ──
// 官方效果 shader 的 combo 宏 (MASK/DUALWAVES/PERSPECTIVE/TIMEOFFSET...) 由
// 场景参数/textures 隐式决定 (手写实现同样判断):
//   MASK:       pass.textures[1] 存在 (mask 纹理)
//   DUALWAVES:  waterwaves — constants 有 direction2/scale2
//   TIMEOFFSET: textures[2] 存在
//   PERSPECTIVE: 有 point0-3 (静态帧默认关)
// 返回对象传给 _compileWorkshopEffect(ef, combos) → 编译带对应分支的 shader。
function inferBuiltinCombos(name, c, pass) {
  // 场景 pass.combos 显式值优先 (如 blend 的 {BLENDMODE:0, WRITEALPHA:1})
  const combos = {};
  if (pass && pass.combos && typeof pass.combos === 'object') {
    for (const [k, v] of Object.entries(pass.combos)) combos[k] = v;
  }
  const pt = (pass && pass.textures) || [];
  const hasMask = !!pt[1] && pt[1] !== 'null';
  if (name === 'waterwaves') {
    if (hasMask) combos.MASK = 1;
    if (c.direction2 != null || c.scale2 != null) combos.DUALWAVES = 1;
    if (pt[2] && pt[2] !== 'null') combos.TIMEOFFSET = 1;
    if (c.point0 != null) combos.PERSPECTIVE = 1;
  } else if (name === 'waterripple') {
    if (hasMask) combos.MASK = 1;
    if (c.animationspeed != null || c.scrollspeed != null) combos.ANIMATION = 1;
  } else if (name === 'shake') {
    if (hasMask) combos.MASK = 1;
  } else if (name === 'foliagesway') {
    if (hasMask) combos.MASK = 1;
  } else if (name === 'swing') {
    if (hasMask) combos.MASK = 1;
  } else if (name === 'pulse') {
    if (hasMask) combos.MASK = 1;
  } else if (name === 'cloudmotion') {
    if (hasMask) combos.MASK = 1;
  } else if (name === 'filmgrain') {
    if (hasMask) combos.MASK = 1;
  } else if (name === 'blend' || name === 'blendgradient' || name === 'lightshafts') {
    // BLENDMODE/WRITEALPHA 来自 pass.combos (已在开头合并); 默认 31
    if (combos.BLENDMODE === undefined) combos.BLENDMODE = 31;
  }
  return combos;
}

