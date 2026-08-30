// WE 渲染引擎 — SceneRenderer 主体 (core)
// 独立子目录 lib/we-renderer/: 工具层拆分 (math/canvas/textures/mdl),
// scene 层 (graph/transform/animation/visibility/scripts) P1 重构拆出,
// 类主体集中于此便于调试; 由 ../scene-renderer.js 兼容再导出
import fs from 'fs';
import path from 'path';
import { Canvas, decodePngBuffer } from './canvas.js';
import { readPkgDir, readPkg, loadTexImage, loadPngFile } from './textures.js';
import { compileMaterial } from './materials/compile.js';
import { downsampleImage } from './render/framebuffer.js';
import { createScriptCache } from '../scene-scripts.js';
import {
  parseVec3, getVal,
  v3sub, v3add, v3cross, v3dot, v3norm,
  mat4Identity, mat4Mul, mat4Perspective, mat4Ortho, mat4LookAt, mat4FromTRS,
  mat4TransformPoint, mat4TransformVec3, sat,
  applyBlending, _greyscale, _sat3, _frac, rgb2hsv, hsv2rgb, smoothstepFn,
} from './math.js';

import { installBloom } from './bloom.js';
import { installCamera } from './camera.js';
import { installImage } from './image.js';
import { installText } from './text.js';
import { installPuppet } from './puppet.js';
import { installModel } from './model.js';
import { installEffects } from './effects.js';
import { installParticles } from './particles.js';
import { installGlsl } from './glsl/integration.js';

// P1 重构: scene 层 (官方 scenescript64.dll 对应) 从 core 拆出
import { installSceneGraph } from './scene/graph.js';
import { installTransform } from './scene/transform.js';
import { installAnimation } from './scene/animation.js';
import { installVisibility } from './scene/visibility.js';
import { installSceneScripts } from './scene/scripts.js';

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
    this.scene = this.pkg.readJson('scene.json');
    if (!this.scene) throw new Error('scene.json 不存在');
    this.W = opts.width || 3840;
    this.H = opts.height || 2160;
    this.fovOverride = opts.fov != null ? opts.fov : null;
    this.time = opts.time ?? 0;
    // GPU 渲染加速 (sf40h): 仅当配置开启 (sceneGpuAccel, 静态帧加速) 时
    // 内置/GLSL 效果走 WebGL (x64 + supreium-headless-gl), 失败自动回退 CPU
    this.gpuAccel = opts.gpuAccel === true;
    // 静态帧模式 (唯一模式; scene-anim 多帧渲染已移除): 效果全分辨率渲染,
    // 脚本状态快进 (P4a) 启用
    this.staticFrame = true;
    this.canvas = new Canvas(this.W, this.H);
    this.textureCache = new Map();
    this.particleCache = new Map();
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
    // NSL 脚本运行时 (状态保留): 编译缓存 + shared — 每个渲染实例一个
    // (静态帧单实例渲染, 脚本状态在快进步骤间保留)
    this._scriptCache = createScriptCache();
    this.userProps = this._readUserProps();
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
    if (this.pkgPath) {
      try {
        const ext = path.join(path.dirname(String(this.pkgPath)), 'project.json');
        if (fs.existsSync(ext)) collect(JSON.parse(fs.readFileSync(ext, 'utf8')));
      } catch { /* ignore */ }
    }
    return props;
  }

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

  // 纹理加载: pkg .tex 优先, 缺失时用 WE 全局 assets, 最后外部 PNG 贴图映射
  // 视频纹理 (MP4/WebM/MOV): 主线程 ffmpeg 预抽帧 PNG 替换 (静态帧模式)
  loadTexture(pathOrName) {
    if (!pathOrName) return null;
    // _rt_ 渲染目标 (反射/帧缓冲): 用当前画布内容近似 (引擎反射缓冲)
    if (String(pathOrName).startsWith('_rt_')) {
      if (this.canvas && this.canvas.data) {
        return { width: this.canvas.w, height: this.canvas.h, rgba: new Uint8Array(this.canvas.data) };
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
  loadModelTexture(modelPath) {
    const model = this.pkg.readJson(modelPath);
    if (!model) return null;
    const mat = model.material ? this.pkg.readJson(model.material) : null;
    const ps = compileMaterial(mat);
    if (!ps || !ps.length) return null;
    const texName = ps[0].textures && ps[0].textures[0];
    return texName ? this.loadTexture(texName) : null;
  }

  // 对象纹理帧动画元数据 (thisLayer.getTextureAnimation 用): 读取对象
  // image 模型的主纹理 TEXS 帧表 → {frameCount, duration}
  _textureFrameInfo(o) {
    try {
      if (!o || !o.image) return null;
      const tex = this.loadModelTexture(o.image);
      if (!tex || !tex.frames || !tex.frames.count || tex.frames.count < 2) return null;
      return { frameCount: tex.frames.count, duration: tex.frames.duration || 0.1 };
    } catch { return null; }
  }

  // ── 主渲染入口 ────────────────────────────────────────────────────
  // 多帧复用: 构造一次后调 setTime 切换时间, 避免每帧重读 pkg/重解码纹理
  setTime(t) {
    this.time = t;
  }

  render() {
    const t = this.time;
    this.canvas.clear();
    // 属性动画 {animation} 先烘焙 (相机对象 origin/zoom 依赖烘焙后的值),
    // 再 setupCamera — 官方 camera:"default" 对象的 origin 动画驱动运镜
    try {
      this._resolveAnimations(t);
    } catch { /* 动画失败不影响渲染 */ }
    // sf42: scene scripts 须在 _setupCamera 前执行 — 相机对象 origin/zoom
    // 可能是 {script,value} (Amiya 等: 脚本把相机移到画布中心 1920,1080),
    // 旧实现 setupCamera 先读 origin → 脚本未跑 → co=null → camObjDriven 关
    // → eye 用 scene.camera.eye 原始值 → 相机错位 → 整个前景组件偏移
    // (用户报"组件位置不对"的根因)。先执行脚本再设相机。
    this._backupScriptValues();
    this._restoreScriptValues();
    this._runSceneScripts(t);
    this._setupCamera();
    // clearColor
    const cc = this.scene.general && this.scene.general.clearcolor;
    if (cc && this.scene.general.clearenabled !== false) {
      const [r, g, b] = parseVec3(cc, [0, 0, 0]);
      this.canvas.clear(r * 255, g * 255, b * 255, 255);
    }
    const order = this.renderOrder.filter((o) => this._isVisible(o) && !this._isLiveComponent(o));
    for (const o of order) {
      try {
        if (o._renderType === 'image') this.renderImage(o, t);
        else if (o._renderType === 'model') this.renderModel(o, t);
        else if (o._renderType === 'particle') this.renderParticleSystem(o, t);
        else if (o._renderType === 'text') this.renderTextObject(o, t);
      } catch (e) {
        this.log('对象 ' + (o.name || o.id) + ' 渲染失败: ' + e.message);
      }
    }
    // Bloom 后处理 (WE 场景标配: 亮部提取 → 降采样模糊 → 叠加)
    const gen = this.scene.general || {};
    if (gen.bloom === true) {
      this._applyBloom(gen);
    }
    return this.canvas;
  }

  // 等比降采样 (box 滤波) — P3 收敛到 render/framebuffer.js 的 downsampleImage
  _downsample(tex, maxSize) {
    return downsampleImage(tex, maxSize);
  }
}

// P1 重构: scene 层 install (官方 scenescript64.dll 对应) — 顺序无关, 均挂原型
installSceneGraph(SceneRenderer.prototype);
installTransform(SceneRenderer.prototype);
installAnimation(SceneRenderer.prototype);
installVisibility(SceneRenderer.prototype);
installSceneScripts(SceneRenderer.prototype);

installBloom(SceneRenderer.prototype);
installCamera(SceneRenderer.prototype);
installImage(SceneRenderer.prototype);
installText(SceneRenderer.prototype);
installPuppet(SceneRenderer.prototype);
installModel(SceneRenderer.prototype);
installEffects(SceneRenderer.prototype);
installParticles(SceneRenderer.prototype);
installGlsl(SceneRenderer.prototype);
