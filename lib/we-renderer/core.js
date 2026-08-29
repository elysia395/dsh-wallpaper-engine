// WE 渲染引擎 — SceneRenderer 主体 (core)
// 独立子目录 lib/we-renderer/: 工具层拆分 (math/canvas/textures/mdl),
// 类主体集中于此便于调试; 由 ../scene-renderer.js 兼容再导出
import fs from 'fs';
import path from 'path';
import { extractTexVideoMp4 } from '../pkg-extract.js';
import { parseCffFont, renderText } from '../font-render.js';
import { applySceneScripts, createScriptCache } from '../scene-scripts.js';
import {
  parseVec3, parseVec2, getVal, setUserPropsResolver,
  v3sub, v3add, v3cross, v3dot, v3norm,
  mat4Identity, mat4Mul, mat4Perspective, mat4Ortho, mat4LookAt, mat4FromTRS,
  mat4TransformPoint, mat4TransformVec3, sat,
  applyBlending, _greyscale, _sat3, _frac, rgb2hsv, hsv2rgb, smoothstepFn,
} from './math.js';
import { Canvas, encodePng, decodePngBuffer } from './canvas.js';
import { readPkgDir, readPkg, loadTexImage, loadPngFile } from './textures.js';
import { parseMdlPuppet, parseMdlStatic } from './mdl.js';

import { installBloom } from './bloom.js';
import { installCamera } from './camera.js';
import { installImage } from './image.js';
import { installText } from './text.js';
import { installPuppet } from './puppet.js';
import { installModel } from './model.js';
import { installEffects } from './effects.js';
import { installParticles } from './particles.js';
import { installGlsl } from './glsl/integration.js';

export class SceneRenderer {
  constructor(pkgPath, opts = {}) {
    this.pkgPath = pkgPath;
    // 支持: scene.pkg 文件 / 松散 scene.json 目录 / scene.json 文件路径
    let isDir = false;
    try { isDir = fs.statSync(pkgPath).isDirectory(); } catch { /* */ }
    if (!isDir && String(pkgPath).toLowerCase().endsWith('.json')) {
      // scene.json 文件 → 用其所在目录
      pkgPath = path.dirname(pkgPath);
      isDir = true;
    }
    this.pkg = isDir ? readPkgDir(pkgPath) : readPkg(pkgPath);
    this.log = opts.log || (() => {});
    // CPU degraded 通道 (契约 C1): 静默降级点发射 {object, feature, action} 事件,
    // 结构与 GL 路由 gate (index.js sceneGLCheck 的 mark) 一致。缺省 null →
    // 行为与旧版完全一致; this.log 调试日志与 onDegraded 并存。
    this.onDegraded = typeof opts.onDegraded === 'function' ? opts.onDegraded : null;
    // 外部 project.json 查找目录 (BASE-34): pkg 文件 → pkg 旁; 松散目录/json → 目录自身
    this._extProjDir = isDir ? pkgPath : path.dirname(String(pkgPath));
    this.scene = this.pkg.readJson('scene.json');
    if (!this.scene) throw new Error('scene.json 不存在');
    this.W = opts.width || 3840;
    this.H = opts.height || 2160;
    this.fovOverride = opts.fov != null ? opts.fov : null;
    this.time = opts.time ?? 0;
    // 静态帧 (单帧渲染, scene-frame) 不降采样效果 — 4K 壁纸效果全分辨率保证细腻;
    // 仅 scene-anim 多帧动画 (times 数组) 启用降采样加速 (sf38 性能近似)
    this.staticFrame = !(opts.times && opts.times.length > 1);
    this.canvas = new Canvas(this.W, this.H);
    this.textureCache = new Map();
    // 缺失纹理 → 外部 PNG 贴图映射 (已从 pkg 提取的粒子贴图)
    this.assetDir = opts.assetDir || null;
    // WE 全局 assets 目录 (util/noise 等全局纹理)
    this.weAssetsDir = opts.weAssetsDir || null;
    // 视差鼠标位置 (0-1, 默认中心)
    this.optsMouse = opts.mouse || null;
    // 音频频谱 (引擎 g_AudioSpectrum16Left/Right): {left:[16], right:[16]}
    this.audioSpectrum = opts.audioSpectrum || null;
    // 视频纹理静态帧映射 (主线程 ffmpeg 预抽帧): 规范化纹理引用 → PNG 路径
    this.videoFrames = opts.videoFrames || null;
    // NSL 脚本运行时 (跨帧状态保留): 编译缓存 + shared — 每个实例一个
    // (scene-anim 多帧复用同一实例 → 脚本状态跨帧推进, 不再每帧重编译)
    this._scriptCache = createScriptCache();
    this.userProps = this._readUserProps();
    // P1-1: 把 userProps 接到 getVal 的 {user, value} 绑定解析 (math.js 模块级注入)
    setUserPropsResolver(() => this.userProps);
    this._resolveObjects();
  }

  // 用户属性 (project.json general.properties): pkg 内 + 外部文件 (pkg 模式下
  // scene.pkg 旁的 project.json 是独立文件, pkg 内没有该条目 → 旧实现读到空
  // → 脚本 scriptProperties 无默认值 → 组件位置/动画参数全错)
  _readUserProps() {
    const props = {};
    const collect = (proj) => {
      if (!proj || !proj.general || !proj.general.properties) return;
      for (const [k, v] of Object.entries(proj.general.properties)) {
        if (v && typeof v === 'object' && 'value' in v) props[k] = v.value;
      }
    };
    try { collect(this.pkg.readJson('project.json')); } catch { /* ignore */ }
    // BASE-34: pkg 文件模式的外部 project.json 在 pkg 旁 (独立文件, pkg 内无该条目);
    // 松散目录/scene.json 模式在目录自身 — 旧实现一律取父目录, 相邻其他壁纸的
    // project.json 会污染 userProps (错误 schema 颜色/脚本默认值)
    if (this._extProjDir) {
      try {
        const ext = path.join(this._extProjDir, 'project.json');
        if (fs.existsSync(ext)) collect(JSON.parse(fs.readFileSync(ext, 'utf8')));
      } catch { /* ignore */ }
    }
    return props;
  }

  // CPU degraded 通道发射 (契约 C1): 结构与 GL gate mark 一致 {object, feature, action}。
  // 无 onDegraded 时零行为; 回调抛错不影响渲染。
  _degraded(object, feature, action) {
    if (typeof this.onDegraded !== 'function') return;
    try { this.onDegraded({ object, feature, action }); } catch { /* 回调失败不影响渲染 */ }
  }

  // 读 JSON: 场景 pkg 优先, 缺失时回退 WE 全局 assets (assets/models/..., assets/materials/...)
  // 读 JSON: 场景 pkg 优先, 缺失时回退 WE 全局 assets (assets/models/..., assets/materials/...)
  readJsonAny(rel) {
    if (!rel) return null;
    let j = this.pkg.readJson(rel);
    if (j || !this.weAssetsDir) return j;
    const gp = path.join(this.weAssetsDir, 'assets', rel);
    try {
      if (fs.existsSync(gp)) return JSON.parse(fs.readFileSync(gp, 'utf8'));
    } catch { /* ignore */ }
    return null;
  }

  // 读原始字节: 场景 pkg 优先, 缺失时回退 WE 全局 assets
  // 读原始字节: 场景 pkg 优先, 缺失时回退 WE 全局 assets
  readAny(rel) {
    if (!rel) return null;
    let b = this.pkg.read(rel);
    if (b || !this.weAssetsDir) return b;
    const gp = path.join(this.weAssetsDir, 'assets', rel);
    try {
      if (fs.existsSync(gp)) return new Uint8Array(fs.readFileSync(gp));
    } catch { /* ignore */ }
    return null;
  }

  // ── 对象树: 依赖/父级排序 (CScene::createObject/addObjectToRenderOrder) ──
  // ── 对象树: 依赖/父级排序 (CScene::createObject/addObjectToRenderOrder) ──
  _resolveObjects() {
    const objects = this.scene.objects || [];
    this.objects = objects.map((o) => ({ ...o, _renderType: this._classify(o) }));
    // id 索引 (BASE-16: 旧实现依赖/父链/可见性逐跳 objects.find → 每帧 O(n²))
    this.objectsById = new Map();
    for (const o of this.objects) if (o.id != null && !this.objectsById.has(o.id)) this.objectsById.set(o.id, o);
    // 渲染顺序: 仅依赖前置 + 场景顺序 (防循环依赖栈溢出)。
    // BASE-31: 父级是变换关系而非渲染顺序 (官方仅提升 dependencies; 编辑器输出
    // 本就父先子后) — 旧实现把 parent 也前置, 手工排序场景 (子先父后) 绘制序
    // 偏离场景序; 父变换由 resolveTransform 惰性解析, 不依赖此处的顺序。
    const order = [];
    const added = new Set();
    const visiting = new Set();
    const add = (o) => {
      if (added.has(o.id)) return;
      if (visiting.has(o.id)) return; // 依赖循环 (A↔B): 已在此链中, 跳过
      visiting.add(o.id);
      for (const dep of o.dependencies || []) {
        const d = this.objectsById.get(dep);
        if (d) add(d);
      }
      visiting.delete(o.id);
      added.add(o.id);
      order.push(o);
    };
    for (const o of this.objects) add(o);
    this.renderOrder = order;
  }

  _classify(o) {
    if (o.image) return 'image';
    if (o.model) return 'model';
    if (o.particle) return 'particle';
    if (o.sound) return 'sound';
    if (o.text) return 'text';
    if (o.light) return 'light';
    return 'unknown';
  }

  // 纹理加载: pkg .tex 优先, 缺失时用 WE 全局 assets, 最后外部 PNG 贴图映射
  // 视频纹理 (MP4/WebM/MOV): 主线程 ffmpeg 预抽帧 PNG 替换 (静态帧模式)
  loadTexture(pathOrName) {
    if (!pathOrName) return null;
    // _rt_ 渲染目标 (反射/帧缓冲): 用当前画布内容近似 (引擎反射缓冲)
    if (String(pathOrName).startsWith('_rt_')) {
      if (this.canvas && this.canvas.data) {
        // BASE-11: 同一画布状态 (canvas.rev 未变) 内快照复用 — 多 pass/多效果
        // 引用 _rt_ 不再每次全画布拷贝 (~4K 33MB); 画布一旦有绘制即失效重照
        if (!this._rtSnap || this._rtSnapRev !== this.canvas.rev) {
          this._rtSnap = { width: this.canvas.w, height: this.canvas.h, rgba: new Uint8Array(this.canvas.data) };
          this._rtSnapRev = this.canvas.rev;
        }
        return this._rtSnap;
      }
      return null;
    }
    // 视频纹理: 独立媒体文件引用 (须在 .tex 规范化之前识别)
    if (/\.(mp4|m4v|webm|mov)$/i.test(String(pathOrName))) {
      return this._loadVideoTextureFrame(pathOrName);
    }
    let texPath = pathOrName;
    if (!texPath.endsWith('.tex')) texPath = 'materials/' + texPath + '.tex';
    if (this.textureCache.has(texPath)) return this.textureCache.get(texPath);
    let raw = this.pkg.read(texPath);
    let img = null;
    if (raw) {
      try {
        img = loadTexImage(raw);
      } catch (e) {
        // TEX 容器内嵌 MP4 (sync 视频纹理): 用主线程预抽帧的 PNG 替代
        if (this.videoFrames && this.videoFrames[texPath]) {
          img = this._readVideoFramePng(texPath);
          if (img) {
            this.textureCache.set(texPath, img);
            return img;
          }
        }
        this.log('纹理解析失败 ' + texPath + ': ' + e.message);
        // C1: 纹理解析失败不再静默 (旧: log 默认 no-op → 残缺帧被当成功加载);
        // 记录失败类别 (是否视频纹理) 供对象级预检归类, 并发射纹理级降级事件
        if (!this._texParseFailed) this._texParseFailed = new Map();
        let isVideo = false;
        // 视频纹理两类形态: TEXI isVideoMp4 标志 / mip0 内嵌 MP4 ftyp box
        // (decodeTex 解码期才发现 — 3113554287 等"同步"视频纹理走后者)
        try { isVideo = extractTexVideoMp4(raw) != null; } catch { /* 非 TEX 容器 */ }
        this._texParseFailed.set(texPath, isVideo);
        this._degraded(null, 'texture-parse', '纹理解析失败 ' + texPath + ': ' + e.message);
      }
    }
    // WE 全局 assets 回退: assets/materials/util/noise.tex
    if (!img && this.weAssetsDir) {
      const globalPath = path.join(this.weAssetsDir, 'assets', texPath);
      try {
        if (fs.existsSync(globalPath)) {
          const gRaw = fs.readFileSync(globalPath);
          img = loadTexImage(gRaw);
        }
      } catch (e) {
        this.log('全局纹理解析失败 ' + globalPath + ': ' + e.message);
        this._degraded(null, 'texture-parse', '全局纹理解析失败 ' + texPath + ': ' + e.message);
      }
    }
    if (!img && this.assetDir) {
      img = this._loadAssetPng(texPath);
    }
    this.textureCache.set(texPath, img);
    return img;
  }

  // 视频纹理静态帧: 查主线程 ffmpeg 预抽帧映射, 读 PNG 替代视频
  _loadVideoTextureFrame(ref) {
    if (!this.videoFrames) return null;
    const norm = ref.startsWith('materials/') ? ref : 'materials/' + ref;
    const png = this.videoFrames[norm] || this.videoFrames[ref];
    if (!png) return null;
    const img = this._readVideoFramePng(ref, png);
    if (img) this.textureCache.set(ref, img);
    return img;
  }

  // 读视频预抽帧 PNG (ref 用于日志; pngPath 缺省时从 videoFrames 反查)
  _readVideoFramePng(ref, pngPath) {
    const png = pngPath || (this.videoFrames && this.videoFrames[ref]);
    if (!png) return null;
    try {
      return decodePngBuffer(fs.readFileSync(png));
    } catch (e) {
      this.log('视频纹理帧读取失败 ' + ref + ': ' + e.message);
      return null;
    }
  }

  // 从外部目录加载粒子贴图 (按纹理名匹配)
  // 从外部目录加载粒子贴图 (按纹理名匹配)
  _loadAssetPng(texPath) {
    if (!this.assetDir) return null;
    const name = texPath.split('/').pop().replace('.tex', '');
    const map = {
      'flare_1': 'particle_flare1.png',
      'halo_6': 'particle_halo6.png',
      'halo_9': 'particle_halo6.png',
      'halo_2': 'particle_halo6.png',
      'Untitled': 'particle_leaves.png',
      '图层 44': 'particle_layer44.png',
      '图层 39': 'particle_layer39.png',
      'debris1': 'particle_debris1.png',
    };
    const f = map[name];
    if (!f) return null;
    const p = this.assetDir + '/' + f;
    try { return loadPngFile(p); } catch (e) { return null; }
  }

  // 加载模型 → 材质 → 主纹理
  // 加载模型 → 材质 → 主纹理
  loadModelTexture(modelPath) {
    const model = this.pkg.readJson(modelPath);
    if (!model) return null;
    const mat = model.material ? this.pkg.readJson(model.material) : null;
    if (!mat || !mat.passes || !mat.passes.length) return null;
    const texName = mat.passes[0].textures && mat.passes[0].textures[0];
    return texName ? this.loadTexture(texName) : null;
  }

  // ── 变换解析 (CImage::resolveTransform: 父链 origin/scale/angle 累积) ──
  // lwe CImage.cpp:156-164 语义: 从根到叶, 子 origin × 祖先累积 scale →
  // 旋转(祖先累积角度) → + 祖先 origin; 子 scale 乘入累积 (不含自身 origin 缩放)
  // ── 变换解析 (CImage::resolveTransform: 父链 origin/scale/angle 累积) ──
  // lwe CImage.cpp:156-164 语义: 从根到叶, 子 origin × 祖先累积 scale →
  // 旋转(祖先累积角度) → + 祖先 origin; 子 scale 乘入累积 (不含自身 origin 缩放)
  // MDAT0001 锚点 (官方引擎确认: wallpaper64.exe 解析 MDAT0001 = u16 计数 +
  // [u16 骨骼索引 + 名字\0 + 64B 矩阵] 列表; 场景对象 attachment 字段匹配锚点名字):
  // 子对象 origin 相对父 puppet 命名锚点定位 → 有效子原点 = 锚点偏移 + 自身 origin。
  // (如 attachment="身体：头" 等锚点名字与父 puppet MDL 的 MDAT 锚点精确匹配)
  // MDAT 锚点解析上限 (BASE-19): 旧 64 → 1024 防坏 count 爆循环 (条目解析本就有
  // 越界 break); 超出部分不再静默丢, 记 onDegraded
  _mdlAnchors(model) {
    if (!model || !model.puppet) return null;
    if (!this._anchorCache) this._anchorCache = new Map();
    if (this._anchorCache.has(model.puppet)) return this._anchorCache.get(model.puppet);
    const raw = this.pkg.read(model.puppet);
    const out = [];
    const MAX_ANCHORS = 1024;
    if (raw) {
      try {
        const buf = Buffer.from(raw);
        for (let idx = buf.indexOf('MDAT'); idx >= 0; idx = buf.indexOf('MDAT', idx + 4)) {
          if (buf.toString('utf8', idx, idx + 8) !== 'MDAT0001') continue;
          let p = idx + 9 + 4;
          const count = buf.readUInt16LE(p); p += 2;
          for (let e = 0; e < count && e < MAX_ANCHORS && p + 2 < buf.length; e++) {
            const boneIdx = buf.readUInt16LE(p); p += 2;
            const ne = buf.indexOf(0, p);
            if (ne < 0 || ne - p > 128) break;
            const name = buf.toString('utf8', p, ne);
            p = ne + 1;
            if (p + 64 > buf.length) break;
            const m = [];
            for (let i = 0; i < 16; i++) m.push(buf.readFloatLE(p + i * 4));
            p += 64;
            out.push({ name, boneIdx, m, tx: m[12], ty: m[13] });
          }
          if (count > MAX_ANCHORS) {
            this._degraded(null, 'mdl-anchors', 'MDAT 锚点数 ' + count + ' 超上限 ' + MAX_ANCHORS + '，超出锚点已丢弃');
          }
        }
      } catch { /* 解析失败 → 无锚点 */ }
    }
    this._anchorCache.set(model.puppet, out);
    return out;
  }

  // puppet 骨骼最终世界位姿 (绑定 + 动画层合成, 与 _skinPuppet 同逻辑) —
  // attachment 锚点跟随动画骨骼 (锚点矩阵相对骨骼局部, 旋角 0 时直接加平移)
  _puppetBoneFinal(mesh, t, layers = null) {
    const bones = mesh.bones;
    if (!bones || !bones.length) return null;
    const nb = bones.length;
    // BASE-18: 前向父引用 (parent ≥ b) 旧实现按根骨骼静默处理 → 绑定姿势错;
    // 改递归 + 备忘解析 (循环引用深度守卫), 不可解析父链记 onDegraded
    const bindWorld = new Array(nb);
    let bindParentBroken = false;
    const resolveBind = (b, depth) => {
      if (bindWorld[b]) return bindWorld[b];
      const parent = bones[b].parent;
      const local = bones[b].bind;
      let out = local;
      if (parent >= 0 && parent < nb) {
        if (depth < 64) {
          const pw = resolveBind(parent, depth + 1);
          if (pw) out = this._matMulRow(pw, local);
          else bindParentBroken = true;
        } else bindParentBroken = true; // 父链循环/过深
      }
      bindWorld[b] = out;
      return out;
    };
    for (let b = 0; b < nb; b++) resolveBind(b, 0);
    if (bindParentBroken) {
      this._degraded(null, 'puppet-bones', '骨骼父链无法解析（循环/过深引用），相关骨骼按根骨骼渲染');
    }
    const bindRT = bindWorld.map((m) => ({ angle: Math.atan2(m[1], m[0]), tx: m[12], ty: m[13] }));
    const final = bindRT.map((r) => ({ angle: r.angle, tx: r.tx, ty: r.ty }));
    if (!mesh.animations || !mesh.animations.length) return final;
    if (!layers || !layers.length) layers = [{ animIdx: 0, blend: 1, rate: 1, additive: false }];
    // 豁免 (P1-3/MOD-04): fps 硬编码 30 — MDL 帧率元数据未实证 (0xF0 0x41 魔数
    // 扫描脆弱), 待官方元数据确认后再动, 本轮不改
    const fps = 30;
    // additive 参考 = 层动画帧0 (帧0≠bind 时用 bind 会让角色飞走; 帧0=bind 的模型等价)
    const refCache = new Map();
    const animRef = (anim) => {
      if (!refCache.has(anim)) refCache.set(anim, this._sampleAnimRT(mesh, anim, 0, nb, bones));
      return refCache.get(anim);
    };
    for (const layer of layers) {
      const anim = mesh.animations[layer.animIdx] || mesh.animations[0];
      if (!anim) continue;
      const frame = Math.floor(t * fps * layer.rate) % Math.max(1, anim.frameCount);
      const lw = this._sampleAnimRT(mesh, anim, frame, nb, bones);
      const refRT = animRef(anim);
      for (let b = 0; b < nb; b++) {
        if (layer.additive) {
          const ref = refRT[b];
          let da = lw[b].angle - ref.angle;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          final[b].angle += da * layer.blend;
          final[b].tx += (lw[b].tx - ref.tx) * layer.blend;
          final[b].ty += (lw[b].ty - ref.ty) * layer.blend;
        } else {
          let da = lw[b].angle - final[b].angle;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          final[b].angle += da * layer.blend;
          final[b].tx += (lw[b].tx - final[b].tx) * layer.blend;
          final[b].ty += (lw[b].ty - final[b].ty) * layer.blend;
        }
      }
    }
    return final;
  }

  // attachment 锚点偏移: 子对象相对父 puppet 锚点的局部偏移 (骨骼位姿 + 锚点矩阵)
  _attachmentOffset(child, parent) {
    if (!child || !parent || child.attachment == null) return [0, 0];
    const parentModel = parent.image ? this.readJsonAny(parent.image) : null;
    const anchors = this._mdlAnchors(parentModel);
    if (!anchors) return [0, 0];
    const anch = anchors.find((a) => a.name === child.attachment);
    if (!anch) return [0, 0];
    // 骨骼最终世界位姿 (动画后)
    let bx = 0, by = 0, ba = 0;
    if (parentModel && parentModel.puppet) {
      if (!this._mdlCache) this._mdlCache = new Map();
      let mesh = this._mdlCache.get(parentModel.puppet);
      if (!mesh) {
        mesh = this._parseMdl(this.pkg.read(parentModel.puppet));
        if (mesh) this._mdlCache.set(parentModel.puppet, mesh);
      }
      if (mesh && mesh.bones && anch.boneIdx < mesh.bones.length) {
        let layers = null;
        // 与 renderPuppet 的 animLayers 构建保持严格一致 (sf39c):
        // 仅当 多动画 + 有 animationlayers 时做层合成; 单动画时 layers=null →
        // _puppetBoneFinal 用默认动画0 = 父网格蒙皮同款, 否则锚点跟随错误
        // 动画 (layer 选中动画 ≠ 动画0) → 子对象挂载错位
        if (mesh.animations && mesh.animations.length > 1 && parent.animationlayers && parent.animationlayers.length) {
          const ls = parent.animationlayers
            .filter((l) => (l.visible === true || (l.visible && typeof l.visible === 'object' && l.visible.value === true)))
            .map((l) => {
              const blend = typeof l.blend === 'number' && l.blend >= 0 && l.blend <= 1 ? l.blend : 1;
              const rate = typeof l.rate === 'number' && l.rate > 0 ? l.rate : 1;
              let idx = mesh.animations.findIndex((a) => a.name && l.name && a.name === l.name);
              if (idx < 0 && l.name) {
                // 数字后缀: "动画 N" → MDL 第 N 个动画 (用于层名带编号、动画本身无名的模型)
                const m = String(l.name).match(/(\d+)/);
                if (m) {
                  const n = parseInt(m[1], 10);
                  if (n >= 1 && n <= mesh.animations.length) idx = n - 1;
                }
              }
              if (idx < 0) {
                const layerIdx = parent.animationlayers.indexOf(l);
                if (layerIdx >= 0 && layerIdx < mesh.animations.length) idx = layerIdx;
              }
              if (idx < 0) idx = 0;
              return { animIdx: idx, blend, rate, additive: !!l.additive };
            });
          if (ls.length) layers = ls;
        }
        const final = this._puppetBoneFinal(mesh, this.time, layers);
        if (final) {
          bx = final[anch.boneIdx].tx; by = final[anch.boneIdx].ty; ba = final[anch.boneIdx].angle;
        }
      }
    }
    // 锚点矩阵相对骨骼局部: 旋角 0 → 直接加平移; 非 0 旋转后加
    const c = Math.cos(ba), s = Math.sin(ba);
    return [bx + anch.tx * c - anch.ty * s, by + anch.tx * s + anch.ty * c];
  }

  resolveTransform(o) {
    // 收集链 (叶到根)
    const chain = [o];
    let cur = o;
    let guard = 0;
    while (cur.parent != null && guard < 32) {
      const parent = this.objectsById.get(cur.parent);
      if (!parent) break;
      chain.push(parent);
      cur = parent;
      guard++;
    }
    const root = chain[chain.length - 1];
    let origin = parseVec3(getVal(root, 'origin'), [0, 0, 0]);
    let scale = parseVec3(getVal(root, 'scale'), [1, 1, 1]);
    let ang = parseVec3(getVal(root, 'angles'), [0, 0, 0]);
    // 从根向下: 子 origin × 当前累积 scale → 旋转(当前累积 Z 角) → + 当前 origin
    for (let i = chain.length - 2; i >= 0; i--) {
      const co = parseVec3(getVal(chain[i], 'origin'), [0, 0, 0]);
      const ca = parseVec3(getVal(chain[i], 'angles'), [0, 0, 0]);
      const cos = Math.cos(ang[2]), sin = Math.sin(ang[2]);
      // attachment 锚点偏移 (子相对父 puppet 锚点): 与子 origin 同空间 (父局部),
      // 受祖先 scale/rotation 影响 — 先加锚点再加自身 origin
      const ao = this._attachmentOffset(chain[i], chain[i + 1]);
      if (ao[0] !== 0 || ao[1] !== 0) {
        const ax = ao[0] * scale[0], ay = ao[1] * scale[1];
        origin = [origin[0] + ax * cos - ay * sin, origin[1] + ax * sin + ay * cos, origin[2] || 0];
      }
      const rx = co[0] * scale[0], ry = co[1] * scale[1];
      const ox = rx * cos - ry * sin;
      const oy = rx * sin + ry * cos;
      origin = [origin[0] + ox, origin[1] + oy, 0];
      const cs = parseVec3(getVal(chain[i], 'scale'), [1, 1, 1]);
      scale = [scale[0] * cs[0], scale[1] * cs[1], scale[2] * cs[2]];
      ang = [ang[0] + ca[0], ang[1] + ca[1], ang[2] + ca[2]];
    }
    return { origin, scale, angle: ang[2], angles: ang };
  }

  // ── 主渲染入口 ────────────────────────────────────────────────────
  // 多帧复用: 构造一次后调 setTime 切换时间, 避免每帧重读 pkg/重解码纹理
  // ── 主渲染入口 ────────────────────────────────────────────────────
  // 多帧复用: 构造一次后调 setTime 切换时间, 避免每帧重读 pkg/重解码纹理
  setTime(t) {
    this.time = t;
  }

  // scene scripts ({script,value}) 写回原对象 value — 多帧复用需备份恢复, 避免值累积污染
  // scene scripts ({script,value}) 写回原对象 value — 多帧复用需备份恢复, 避免值累积污染
  _backupScriptValues() {
    if (this._scriptBackup) return;
    this._scriptBackup = [];
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if ('script' in obj && 'value' in obj && typeof obj.script === 'string') {
        this._scriptBackup.push([obj, obj.value]);
        return; // script 对象内部不再含 script 子对象
      }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') walk(v);
      }
    };
    for (const o of this.scene.objects || []) walk(o);
    if (this.scene.general) walk(this.scene.general);
    if (this.scene.camera) walk(this.scene.camera);
  }

  _restoreScriptValues() {
    if (!this._scriptBackup) return;
    for (const [obj, v] of this._scriptBackup) obj.value = v;
  }

  // 对象可见性: 官方语义 — visible 可能是 {user: <属性名>, value} 绑定用户属性
  // (可关闭的作者声明/时钟/FPS 等: user 指向 project.json 属性, 用户关闭后
  // 该组件整体不渲染)。scene.json 里的 value 是设计器默认, 运行时须读 userProps
  // 的当前值 (用户改过则生效), userProps 无该键时才回退 scene.json 的 value。
  // 对象自身可见性 (不含父级): visible 可能是 {user: <属性名>, value} 绑定用户属性
  // (可关闭的作者声明/时钟/FPS 等: user 指向 project.json 属性, 用户关闭后
  // 该组件整体不渲染)。scene.json 里的 value 是设计器默认, 运行时须读 userProps
  // 的当前值 (用户改过则生效), userProps 无该键时才回退 scene.json 的 value。
  _isVisibleSelf(o) {
    // BASE-05: 动画烘焙出的 visible 值可能是数值/字符串 (0/'0'/'false') —
    // 旧实现只判 === false → 数值 0 永不隐藏。
    // 官方语义 (lwe DynamicValueParser.cpp:37-52 + DynamicValue.cpp:160-185):
    // 数值按 !=0 判定; 字符串先尝试 stof 解析 — 可解析按数值 (非 0 → 可见),
    // 不可解析 ('true'/'false'/空串) → String 型, getBool() 恒 false → 隐藏,
    // 即裸字符串 'true' 官方也是隐藏。与 index.js gate 的 valHidden 完全一致。
    const hidden = (x) => x === false || x === 0
      || (typeof x === 'string' && (!Number.isFinite(Number(x)) || Number(x) === 0));
    const v = o && o.visible;
    if (v == null) return true;
    if (typeof v === 'object' && v !== null && 'user' in v) {
      const user = v.user;
      if (typeof user === 'string' && user && this.userProps && user in this.userProps) {
        return !hidden(this.userProps[user]);
      }
      // user 无对应属性 (或 object 形式) → 回退 value
      return !hidden(v.value);
    }
    return !hidden(getVal(o, 'visible', true));
  }

  // 对象可见性 = 自身可见 AND 祖先链全部可见 (官方场景图语义: 组/容器对象
  // 隐藏时其子对象一并隐藏 — App Launcher Dock 等作者组件用父对象 visible
  // 绑定用户属性开关, 父隐藏后 Launcher 子对象不得独立渲染)
  _isVisible(o) {
    if (!this._isVisibleSelf(o)) return false;
    // 沿 parent 链向上, 任一祖先不可见 → 本对象不可见
    let cur = o;
    let guard = 0;
    while (cur && cur.parent != null && guard < 32) {
      const parent = this.objectsById.get(cur.parent);
      if (!parent) break;
      if (!this._isVisibleSelf(parent)) return false;
      cur = parent;
      guard++;
    }
    return true;
  }

  // 降级预检 (仅 onDegraded 存在时执行): image.js / puppet.js 内部的静默跳过点
  // (缺纹理跳过 image / puppet 三条静默 return) 在本包不可改 → 渲染前在调用侧
  // 感知并发射对象级事件。结果按对象记忆 (纹理缺失跨帧不变, 每对象只检一次)。
  _precheckImageObject(o) {
    if (!this._precheckCache) this._precheckCache = new Set();
    if (this._precheckCache.has(o)) return;
    this._precheckCache.add(o);
    const name = o.name != null ? String(o.name) : null;
    const model = this.readJsonAny(o.image);
    if (!model) return;
    if (model.puppet) {
      // puppet.js 三条静默 return (无 MDL / MDL 解析失败 / 无纹理) 的调用侧感知
      if (!this.pkg.read(model.puppet)) {
        this._degraded(name, 'puppet', 'puppet 无 MDL 数据，已跳过该对象');
        return;
      }
      if (!this._mdlCache) this._mdlCache = new Map();
      let mesh = this._mdlCache.get(model.puppet);
      if (!mesh) {
        mesh = this._parseMdl(this.pkg.read(model.puppet));
        if (mesh) this._mdlCache.set(model.puppet, mesh);
      }
      if (!mesh) { this._degraded(name, 'puppet', 'puppet MDL 解析失败，已跳过该对象'); return; }
      if (!this.loadModelTexture(o.image)) this._degraded(name, 'puppet', 'puppet 无纹理，已跳过该对象');
      return;
    }
    // 普通路径 (与 image.js 路由一致): 自定义 shader / passthrough / solidlayer
    // 无主纹理依赖, 不预检
    const mat = model.material ? this.readJsonAny(model.material) : null;
    const pass = mat && mat.passes && mat.passes[0] ? mat.passes[0] : null;
    const shaderName = pass ? pass.shader : '';
    if (shaderName && this._customShaders.has(shaderName)) return;
    const passthrough = model.passthrough === true
      || (pass && pass.textures && pass.textures[0] && String(pass.textures[0]).startsWith('_rt_'));
    if (passthrough) return;
    if (model.solidlayer === true || shaderName === 'flat' || shaderName === 'flatalpha') return;
    const texName = pass && pass.textures ? pass.textures[0] : null;
    if (!texName) return;
    if (this.loadTexture(texName)) return;
    // 主纹理不可读 → image.js 将跳过整个对象; 按失败类别分流 (视频纹理单列)
    const tp = String(texName).endsWith('.tex') ? String(texName) : 'materials/' + texName + '.tex';
    const failedVideo = this._texParseFailed ? this._texParseFailed.get(tp) : undefined;
    if (failedVideo === true) this._degraded(name, 'video-texture', '视频纹理静态帧不可用，已跳过该对象');
    else if (failedVideo === false) this._degraded(name, 'texture', '主纹理解析失败，已跳过该对象');
    else this._degraded(name, 'texture', '主纹理不可读（缺失），已跳过该对象');
  }

  render() {
    const t = this.time;
    // 属性动画 {animation} 先烘焙 (相机对象 origin/zoom 依赖烘焙后的值),
    // 再 setupCamera — 官方 camera:"default" 对象的 origin 动画驱动运镜
    try {
      this._resolveAnimations(t);
    } catch { /* 动画失败不影响渲染 */ }
    this._setupCamera();
    // scene scripts: 执行 {script, value} 更新 (彩虹色/visible/bloom 等动态值)
    // 多帧复用: 首次备份原始 value, 每帧先恢复再执行 (避免脚本值跨帧累积污染)
    this._backupScriptValues();
    this._restoreScriptValues();
    try {
      // engine.canvasSize = 场景正交尺寸 (正交场景坐标, 非渲染分辨率)
      const ortho = this.scene.general && this.scene.general.orthogonalprojection;
      const sceneW = ortho && ortho.width ? ortho.width : this.W;
      const sceneH = ortho && ortho.height ? ortho.height : this.H;
      // shared 对象跨脚本共享 (NSL 框架: 主逻辑写 shared, 其他层读; 每帧持久化,
      // 由 _scriptCache 持有, 跨帧保留 — NSL 动画调度器/状态依赖)
      // BASE-17: 真实帧间隔 (旧: 恒 1/60 — 速度积分类脚本 System.frametime 在非
      // 60fps 渲染 (scene-anim 33/40/50ms 帧) 下走速错误); 时间回退/首帧回退 1/60
      let dt = 1 / 60;
      if (this._prevRenderT != null && t > this._prevRenderT && t - this._prevRenderT < 1) dt = t - this._prevRenderT;
      this._prevRenderT = t;
      applySceneScripts(this.scene, t, {
        canvasSize: { x: sceneW, y: sceneH },
        userProps: this.userProps,
        scriptCache: this._scriptCache,
        // 脚本 thisScene/getLayer 写渲染对象 (烘焙后的 this.objects), 直接生效
        renderObjects: this.objects,
        runtime: t,
        frametime: dt,
      });
    } catch { /* 脚本失败不影响渲染 */ }
    // clearColor (单次清屏 — 旧实现先 clear(0,0,0,0) 再 clearcolor 双重清;
    // 无 clearcolor 时也必须清, 否则多帧复用残帧)
    const cc = this.scene.general && this.scene.general.clearcolor;
    if (cc && this.scene.general.clearenabled !== false) {
      const [r, g, b] = parseVec3(cc, [0, 0, 0]);
      this.canvas.clear(r * 255, g * 255, b * 255, 255);
    } else {
      this.canvas.clear();
    }
    // P1-2: 实时组件 (音频条/频谱) 不再整对象过滤 — 改为 effects.js 逐效果跳过,
    // 对象照常渲染
    const order = this.renderOrder.filter((o) => this._isVisible(o));
    for (const o of order) {
      // C1: 对象级静默跳过点预检 (缺纹理 image / puppet 三条 return), 仅 onDegraded 时执行
      if (this.onDegraded && o._renderType === 'image') this._precheckImageObject(o);
      try {
        if (o._renderType === 'image') this.renderImage(o, t);
        else if (o._renderType === 'model') this.renderModel(o, t);
        else if (o._renderType === 'particle') this.renderParticleSystem(o, t);
        else if (o._renderType === 'text') this.renderTextObject(o, t);
      } catch (e) {
        this.log('对象 ' + (o.name || o.id) + ' 渲染失败: ' + e.message);
        this._degraded(o.name != null ? String(o.name) : null, 'object', '对象渲染失败，已跳过: ' + e.message);
      }
    }
    // Bloom 后处理 (WE 场景标配: 亮部提取 → 降采样模糊 → 叠加)
    const gen = this.scene.general || {};
    if (gen.bloom === true) {
      this._applyBloom(gen);
    }
    return this.canvas;
  }

  // WE 属性动画: {animation: {c0: [{frame, value}...], options: {fps, length, mode}}}
  // 按 t 求值 → 写回 o[key] = {value} (线性插值, 引擎 Tween 简化)
  // c0/c1/c2 = 向量 x/y/z 分量动画 (独立通道, 逐通道插值后合并)
  // animation.relative === true → 关键帧值是相对基准的偏移 (最终值 = 基准 + 偏移),
  // 逐分量相加 (scale 例: base=1, c0/c1=[0.3,0.3,0] → 1.3, 官方帧验证)
  // 多帧复用安全: 备份 animation 原对象, 每帧先恢复再烘焙 (避免污染导致后续帧丢失动画)
  _resolveAnimations(t) {
    const animKeys = ['alpha', 'scale', 'origin', 'angles', 'visible', 'color', 'size', 'brightness', 'parallaxDepth', 'zoom'];
    if (!this._animBackup) {
      this._animBackup = [];
      for (const o of this.objects) {
        for (const key of animKeys) {
          const v = o[key];
          if (v && typeof v === 'object' && v.animation) this._animBackup.push([o, key, v]);
        }
      }
    }
    // 恢复 animation 原对象
    for (const [o, key, v] of this._animBackup) o[key] = v;
    // 按当前 t 烘焙
    for (const [o, key, v] of this._animBackup) {
      const a = v.animation;
      const opts = a.options || {};
      const fps = opts.fps || 30;
      const length = opts.length || 0;
      const mode = opts.mode || 'single';
      let frame = t * fps;
      // 播放模式
      // 豁免 (P1-4): reverse 实为 ping-pong 三角波 (node 实测), length 量纲
      // (帧 vs 秒) 无官方定论 — 两项均维持现状, 待官方语义实证后再动
      if (length > 0) {
        if (mode === 'loop') frame = frame % length;
        else if (mode === 'reverse') {
          const m = frame % (length * 2);
          frame = m <= length ? m : length * 2 - m;
        }
      }
      // 逐通道 (c0/c1/c2 = x/y/z) 求值; 无通道动画的键用 c0
      const evalChannel = (ch) => {
        const frames = (a[ch] || []).filter((f) => f && typeof f.frame === 'number' && f.value != null);
        if (!frames.length) return null;
        frames.sort((x, y) => x.frame - y.frame);
        const last = frames[frames.length - 1];
        let value;
        if (frame <= frames[0].frame) value = frames[0].value;
        else if (frame >= last.frame) value = last.value;
        else {
          for (let i = 0; i < frames.length - 1; i++) {
            const a0 = frames[i], a1 = frames[i + 1];
            if (frame >= a0.frame && frame <= a1.frame) {
              value = this._animValueAt(a0, a1, frame);
              break;
            }
          }
          if (value === undefined) value = last.value;
        }
        return value;
      };
      const hasMulti = ['c1', 'c2'].some((ch) => a[ch] && a[ch].length) || (a.c0 && a.c0.length && typeof (a.c0[0] || {}).value === 'string' && String(a.c0[0].value).trim().split(/\s+/).length > 1);
      let value;
      if (hasMulti) {
        // 多通道: 逐通道求值 → "x y z" 字符串
        const parts = [];
        for (const ch of ['c0', 'c1', 'c2']) {
          const cv = evalChannel(ch);
          parts.push(cv != null ? cv : 0);
        }
        value = parts.join(' ');
      } else {
        value = evalChannel('c0');
        if (value === undefined || value === null) continue;
      }
      // relative: 基准值 + 动画偏移 (逐分量)
      if (a.relative === true && v.value != null) {
        const base = v.value;
        const valStr = typeof value === 'number' ? String(value) : value;
        const pb = typeof base === 'string' ? base.trim().split(/\s+/).map(Number) : [base];
        const pv = typeof valStr === 'string' ? valStr.trim().split(/\s+/).map(Number) : [valStr];
        const out = pv.map((x, i) => x + (pb[i] ?? 0));
        value = out.join(' ');
      }
      o[key] = { value };
    }
  }

  // 数值或 "x y z" 向量线性插值
  _lerpValue(a, b, k) {
    const pa = typeof a === 'string' ? a.trim().split(/\s+/).map(Number) : [a];
    const pb = typeof b === 'string' ? b.trim().split(/\s+/).map(Number) : [b];
    if (pa.length === 1 && pb.length === 1) return pa[0] + (pb[0] - pa[0]) * k;
    const out = pa.map((x, i) => x + ((pb[i] ?? x) - x) * k);
    return out.join(' ');
  }

  // 等比降采样 (box 滤波): 效果/渲染前把大纹理缩到 maxSize, 提速 CPU 逐像素
  // (官方 GPU 并行处理全分辨率; CPU 用降采样近似, 效果是低频扰动损失小)
  // 已知 (BASE-14, 行为敏感豁免): 非预乘 alpha 直接平均 → 半透明裁切边缘降采样
  // 有暗/亮晕边; 改预乘平均需整链视觉回归后才能动, 本轮不改
  _downsample(tex, maxSize) {
    const w = tex.width, h = tex.height;
    const scale = Math.min(1, maxSize / Math.max(w, h));
    if (scale >= 1) return tex;
    const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
    const src = tex.rgba;
    const out = new Uint8Array(tw * th * 4);
    const sx = w / tw, sy = h / th;
    for (let y = 0; y < th; y++) {
      const sy0 = Math.floor(y * sy), sy1 = Math.min(h, Math.ceil((y + 1) * sy));
      for (let x = 0; x < tw; x++) {
        const sx0 = Math.floor(x * sx), sx1 = Math.min(w, Math.ceil((x + 1) * sx));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = sy0; yy < sy1; yy++) {
          const row = yy * w;
          for (let xx = sx0; xx < sx1; xx++) {
            const i = (row + xx) * 4;
            r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
            n++;
          }
        }
        const di = (y * tw + x) * 4;
        out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = a / n;
      }
    }
    return { width: tw, height: th, rgba: out };
  }

  // 关键帧贝塞尔插值 (官方动画切线): 每关键帧带 back/front 控制点
  // {back:{x,y},front:{x,y}} — 相对关键帧的偏移 (x=帧, y=值); enabled 时生效。
  // 相邻帧 a0(f0,v0)→a1(f1,v1): P0=(f0,v0), P1=(f0+front.x, v0+front.y),
  // P2=(f1+back.x, v1+back.y), P3=(f1,v1); 解 x(u)=frame 得 u → y(u)。
  // 无切线或值非数值 → 回退线性插值 (原 _lerpValue 语义)。
  _animValueAt(a0, a1, frame) {
    const f0 = a0.frame, f1 = a1.frame;
    const v0 = Number(a0.value), v1 = Number(a1.value);
    if (!isFinite(v0) || !isFinite(v1) || f1 <= f0) {
      return this._lerpValue(a0.value, a1.value, (frame - f0) / (f1 - f0 || 1));
    }
    const ft = a0.front, bt = a1.back;
    const hasTangent = (ft && ft.enabled && (ft.x != null || ft.y != null)) || (bt && bt.enabled && (bt.x != null || bt.y != null));
    if (!hasTangent) return v0 + (v1 - v0) * ((frame - f0) / (f1 - f0));
    const p0x = f0, p0y = v0, p3x = f1, p3y = v1;
    const p1x = ft && ft.enabled && ft.x != null ? f0 + ft.x : f0;
    const p1y = ft && ft.enabled && ft.y != null ? v0 + ft.y : v0;
    const p2x = bt && bt.enabled && bt.x != null ? f1 + bt.x : f1;
    const p2y = bt && bt.enabled && bt.y != null ? v1 + bt.y : v1;
    // x(u) = (1-u)^3·p0x + 3(1-u)^2·u·p1x + 3(1-u)·u^2·p2x + u^3·p3x
    const bx = (u) => {
      const om = 1 - u;
      return om * om * om * p0x + 3 * om * om * u * p1x + 3 * om * u * u * p2x + u * u * u * p3x;
    };
    const dx = (u) => {
      const om = 1 - u;
      return 3 * om * om * (p1x - p0x) + 6 * om * u * (p2x - p1x) + 3 * u * u * (p3x - p2x);
    };
    const by = (u) => {
      const om = 1 - u;
      return om * om * om * p0y + 3 * om * om * u * p1y + 3 * om * u * u * p2y + u * u * u * p3y;
    };
    // 牛顿迭代解 x(u)=frame (u∈[0,1]); 切线 x 越界(时间回退)时退化为线性参数
    let u = (frame - f0) / (f1 - f0);
    let ok = true;
    for (let i = 0; i < 10; i++) {
      const x = bx(u) - frame;
      const d = dx(u);
      if (Math.abs(d) < 1e-9) break;
      const nu = u - x / d;
      if (nu < -0.5 || nu > 1.5) { ok = false; break; }
      u = nu;
      if (Math.abs(x) < 1e-6) break;
    }
    if (!ok || u < 0 || u > 1) u = (frame - f0) / (f1 - f0);
    return by(Math.max(0, Math.min(1, u)));
  }

  // Bloom: 引擎完整链 (downsample_quarter_bloom → combine_hdr)
  // 1. 降采样 1/4: 4 角平均 → saturate(scale-threshold) → 饱和度增强 → ×strength×tint
  // 2. 合成: 原图 + bloom 4 角平均×0.25 → 线性化 lin() → ×曝光
}

installBloom(SceneRenderer.prototype);
installCamera(SceneRenderer.prototype);
installImage(SceneRenderer.prototype);
installText(SceneRenderer.prototype);
installPuppet(SceneRenderer.prototype);
installModel(SceneRenderer.prototype);
installEffects(SceneRenderer.prototype);
installParticles(SceneRenderer.prototype);
installGlsl(SceneRenderer.prototype);
