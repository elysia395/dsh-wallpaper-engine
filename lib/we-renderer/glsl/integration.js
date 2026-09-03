// WE GLSL 渲染集成 — 第三方 workshop 效果通用执行器 (mixin)
// applyEffects 的 else 分支调用 _applyGlslEffect: 从 pkg 读 shader → 编译缓存 →
// uniform 组装 → 逐像素渲染; 失败回退原图 (不崩溃)
import path from 'node:path';
import fs from 'node:fs';
import { compileGlsl, buildUniforms, renderGlsl } from './executor.js';
import { parseMeta } from './preprocess.js';

// P2-23: 编译缓存全局化 — 模块级 LRU Map, 跨渲染器实例复用 (此前挂实例,
// 换壁纸/重建实例即全量重编译)。key = frag+vert 源码 + combos (完整字符串即
// 天然 hash, 不同 pkg 同名效果不会串); 编译产物为纯闭包 (u/__v/__rt 全走参),
// 跨实例复用安全
const GLSL_CACHE_MAX = 24; // 容量上限 (编译产物含闭包, 控制常驻内存)
const _glslCompileCache = new Map();
// P2-23: include 的 existsSync+readFileSync memoize — weAssetsDir 为静态资产
// 目录, 进程内内容不变, 按绝对路径缓存 (pkg 侧 include 由实例缓存覆盖)
const _fsIncludeCache = new Map();

export function installGlsl(proto) {
  // 大对象降采样渲染: 超过阈值在小分辨率执行 GLSL 再放大 (静态帧近似, 防全屏效果过慢)
  const MAX_GLSL_PIXELS = 65536; // 256x256
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
    // P2-23: parseMeta 结果挂 shader 文本缓存 (逐帧/多 pass 调用不再重复全文扫描)
    if (!sh.metaFrag) sh.metaFrag = parseMeta(sh.frag);
    if (sh.vert && !sh.metaVert) sh.metaVert = parseMeta(sh.vert);
    // P0-20: 纹理派生 combo (MASK 等) — uniform 元注释带 combo+opacitymask 且无
    // [COMBO] 默认块时 (parseMeta 同 parseMetaGL 推导), 对应槽位绑定纹理 → 1, 否则 0
    const texCombos = {};
    for (const meta of [sh.metaFrag, sh.metaVert]) {
      if (!meta) continue;
      for (const info of Object.values(meta.uniforms)) {
        if (!info.combo || !info.textureUniform) continue;
        const mm = /^g_Texture(\d+)$/.exec(info.textureUniform);
        if (!mm) continue;
        const bound = !!(texRefs[Number(mm[1])] && texRefs[Number(mm[1])] !== 'null');
        texCombos[info.combo] = bound ? '1' : '0';
      }
    }
    const combos = { ...texCombos, ...(pass0.combos || {}) }; // 显式 baked combos 优先
    // P2-23: 全局 LRU 编译缓存 (key 含完整源码, 即 shader 源 + combos 的 hash)
    const key = sh.frag + '\x00#F\x00' + sh.vert + '\x00#C\x00' + JSON.stringify(combos);
    if (_glslCompileCache.has(key)) {
      const hit = _glslCompileCache.get(key);
      _glslCompileCache.delete(key); // LRU 触碰: 重插到最新端
      _glslCompileCache.set(key, hit);
      return hit;
    }
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
    _glslCompileCache.set(key, compiled);
    if (_glslCompileCache.size > GLSL_CACHE_MAX) {
      _glslCompileCache.delete(_glslCompileCache.keys().next().value); // 淘汰最旧
    }
    return compiled;
  };

  proto._resolveGlslInclude = function (inc) {
    // P2-23: 实例级 memoize (pkg 内容随实例固定, include 名 → 文本一次解析)
    if (!this._glslIncCache) this._glslIncCache = new Map();
    if (this._glslIncCache.has(inc)) return this._glslIncCache.get(inc);
    let out = '';
    if (this.weAssetsDir) {
      const p = path.join(this.weAssetsDir, 'assets', 'shaders', inc);
      // P2-23: existsSync+readFileSync 进程内 memoize (静态资产目录);
      // rec=null 表示不存在/读失败 → 落 pkg (与旧 fs-first 语义一致, 空文件也以 fs 为准)
      let rec = _fsIncludeCache.get(p);
      if (rec === undefined) {
        rec = null;
        try { if (fs.existsSync(p)) rec = fs.readFileSync(p, 'utf8'); } catch {}
        _fsIncludeCache.set(p, rec);
      }
      if (rec !== null) out = rec;
    }
    if (!out) {
      try { out = this.pkg.readText('shaders/' + inc) || ''; } catch {}
    }
    this._glslIncCache.set(inc, out);
    return out;
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
      // P1-8⑥: 每采样 Set.has → 纹理对象一次属性标记 (槽位数有限, 属性读取替代哈希查找;
      // 纹理不在辅助槽且非主图 → undefined → !undefined = true = CLAMP, 与旧 Set 判定一致)
      // 采样链 4 层 (转译调用 → rt.texture2D 的 uv 拆包 → 本 sampler → _texSample 内
      // 分配 [r,g,b,a]) — 再减层需写入口采样器 (_texSampleInto, model.js 域), 超出
      // glsl/ 目录修复范围, 此处仅标注
      for (const t of textures) if (t) t.__glslRepeat = true;
      img.__glslRepeat = textures.includes(img);
      const out = renderGlsl(compiled, {
        width: w, height: h, u,
        sampler: (tex, uu, vv) => this._texSample(tex, uu, vv, !(tex && tex.__glslRepeat)),
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
