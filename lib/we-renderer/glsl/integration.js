// WE GLSL 渲染集成 — 第三方 workshop 效果通用执行器 (mixin)
// applyEffects 的 else 分支调用 _applyGlslEffect: 从 pkg 读 shader → 编译缓存 →
// uniform 组装 → 逐像素渲染; 失败回退原图 (不崩溃)
import path from 'node:path';
import fs from 'node:fs';
import { compileGlsl, buildUniforms, renderGlsl } from './executor.js';
import { parseMeta } from './preprocess.js';

export function installGlsl(proto) {
  // 大对象降采样渲染: 超过阈值在小分辨率执行 GLSL 再放大 (静态帧近似, 防全屏效果过慢)
  const MAX_GLSL_PIXELS = 65536; // 256x256
  proto._glslCache = null;     // 编译缓存 (key = file|combos)
  proto._glslShaderText = null; // shader 源码缓存 (key = 效果名, 防逐帧重复读 pkg)

  // 读取 shader 源码 (frag/vert), 带实例级缓存
  proto._readGlslShader = function (name) {
    if (!this._glslShaderText) this._glslShaderText = new Map();
    if (this._glslShaderText.has(name)) return this._glslShaderText.get(name);
    // P0-19: pkg 内官方路径 shaders/effects/<name>.(frag|vert) (与 GL 路由一致);
    // 旧代码 split('/')[2] 对 "effects/<name>/effect.json" 恒得 'effect.json'
    // → 拼出 shaders/workshop/effect.json/... 永不命中。效果目录名 = basename(dirname(file))
    const stem = 'shaders/effects/' + name;
    let frag = '';
    try { frag = this.pkg.readText(stem + '.frag') || ''; } catch {}
    if (!frag && this.weAssetsDir) {
      const p = path.join(this.weAssetsDir, 'assets', 'effects', name, 'shaders', 'effects', name + '.frag');
      try { if (fs.existsSync(p)) frag = fs.readFileSync(p, 'utf8'); } catch {}
    }
    let vert = '';
    try { vert = this.pkg.readText(stem + '.vert') || ''; } catch {}
    if (!vert && this.weAssetsDir) {
      const p = path.join(this.weAssetsDir, 'assets', 'effects', name, 'shaders', 'effects', name + '.vert');
      try { if (fs.existsSync(p)) vert = fs.readFileSync(p, 'utf8'); } catch {}
    }
    if (!frag) this.log('GLSL shader 未找到: ' + stem + '.frag (' + name + ')'); // P1-45: 失败记日志 (源码缓存防逐帧重复)
    const rec = { frag, vert };
    this._glslShaderText.set(name, rec);
    return rec;
  };

  // 编译并缓存 (key = effect.file + combos)
  proto._compileWorkshopEffect = function (ef) {
    const name = path.basename(path.dirname(ef.file));
    const sh = this._readGlslShader(name);
    if (!sh.frag) return null;
    const pass0 = (ef.passes && ef.passes[0]) || {};
    const texRefs = pass0.textures || [];
    // P0-20: 纹理派生 combo (MASK 等) — uniform 元注释带 combo+opacitymask 且无
    // [COMBO] 默认块时 (parseMeta 同 parseMetaGL 推导), 对应槽位绑定纹理 → 1, 否则 0
    const texCombos = {};
    for (const src of [sh.frag, sh.vert]) {
      if (!src) continue;
      for (const info of Object.values(parseMeta(src).uniforms)) {
        if (!info.combo || !info.textureUniform) continue;
        const mm = /^g_Texture(\d+)$/.exec(info.textureUniform);
        if (!mm) continue;
        const bound = !!(texRefs[Number(mm[1])] && texRefs[Number(mm[1])] !== 'null');
        texCombos[info.combo] = bound ? '1' : '0';
      }
    }
    const combos = { ...texCombos, ...(pass0.combos || {}) }; // 显式 baked combos 优先
    const key = ef.file + '|' + JSON.stringify(combos);
    if (!this._glslCache) this._glslCache = new Map();
    if (this._glslCache.has(key)) return this._glslCache.get(key);
    if (ef.passes && ef.passes.length > 1) {
      this.log('GLSL 效果 ' + name + ': ' + ef.passes.length + ' 个 pass 仅执行 pass 0'); // P1-43
    }
    const warns = [];
    let compiled = null;
    try {
      compiled = compileGlsl({
        fragSource: sh.frag,
        vertSource: sh.vert || null,
        combos,
        resolveInclude: (inc) => this._resolveGlslInclude(inc),
        onWarn: (w) => warns.push(w),
      });
    } catch (e) {
      this.log('GLSL 编译失败 ' + name + ': ' + e.message);
    }
    for (const w of warns) this.log('GLSL ' + name + ' include 警告: ' + w); // P1-36
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
    const totalPx = img.width * img.height;
    // 降采样仅动画多帧启用; 静态帧全分辨率 (用户要求: 静态帧不应用降低分辨率操作)
    if (!this.staticFrame && totalPx > MAX_GLSL_PIXELS) {
      const scale = Math.sqrt(MAX_GLSL_PIXELS / totalPx);
      const sw = Math.max(1, Math.round(img.width * scale));
      const sh = Math.max(1, Math.round(img.height * scale));
      const small = this._renderGlslEffect(compiled, img, ef, sw, sh, t, name);
      if (small && small !== img) return this._upsampleRgba(small, img.width, img.height);
      return img;
    }
    return this._renderGlslEffect(compiled, img, ef, img.width, img.height, t, name);
  };

  proto._renderGlslEffect = function (compiled, img, ef, w, h, t, name) {
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
      // (官方槽位语义; 此前 textures[idx-1] off-by-one → g_Texture2 绑到 mask, P0-18)
      for (const [un, info] of Object.entries(compiled.uniforms)) {
        if (info.type === 'sampler2D' && u[un] === undefined) {
          const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
          u[un] = idx === 0 ? img : (textures[idx] || null);
        }
      }
      // P0-16 (§9.6 裁决): 主图 (g_Texture0, 链输入) CLAMP; 位移/噪声/遮罩等辅助槽 REPEAT
      // (注释 "GL 默认=clamp" 有误 — GL 默认环绕是 REPEAT; waterripple 等位移采样本就跨 [0,1])
      const repeatTex = new Set(textures.filter(Boolean));
      const out = renderGlsl(compiled, {
        width: w, height: h, u,
        sampler: (tex, uu, vv) => this._texSample(tex, uu, vv, !repeatTex.has(tex)),
      });
      if (out.pixelErrors) {
        this.log('GLSL 效果 ' + name + ': ' + out.pixelErrors + ' 像素异常已隔离 (' + (out.lastError || '') + ')'); // F-12
      }
      return out;
    } catch (e) {
      this.log('GLSL 效果 ' + name + ' 渲染失败: ' + e.message); // P1-42: name 由参数传入 (此前未声明 → ReferenceError)
      return img;
    }
  };

  // 最近邻放大 (降采样结果 → 原始尺寸)
  proto._upsampleRgba = function (small, W, H) {
    const out = new Uint8Array(W * H * 4);
    const sw = small.width, sh = small.height;
    for (let y = 0; y < H; y++) {
      const sy = Math.min(sh - 1, Math.floor((y * sh) / H));
      const srcRow = sy * sw * 4;
      const dstRow = y * W * 4;
      for (let x = 0; x < W; x++) {
        const sx = Math.min(sw - 1, Math.floor((x * sw) / W));
        const si = srcRow + sx * 4;
        const di = dstRow + x * 4;
        out[di] = small.rgba[si];
        out[di + 1] = small.rgba[si + 1];
        out[di + 2] = small.rgba[si + 2];
        out[di + 3] = small.rgba[si + 3];
      }
    }
    return { width: W, height: H, rgba: out };
  };
}
