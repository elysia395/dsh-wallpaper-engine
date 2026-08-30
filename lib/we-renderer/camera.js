// WE 渲染引擎 — 相机 (lookAt/透视/正交 + camera paths + 视差)
import { parseVec3, parseVec2, getVal, mat4LookAt, mat4Perspective, mat4Ortho, mat4Mul, v3norm } from './math.js';

export function resolveCameraPose(cam, t, readJson) {
  const def = {
    eye: parseVec3(cam.eye, [0, 0, 1]),
    center: parseVec3(cam.center, [0, 0, 0]),
    up: parseVec3(cam.up, [0, 1, 0]),
    zoom: 1,
  };
  let paths = [];
  try {
    if (Array.isArray(cam.paths)) {
      for (const p of cam.paths) {
        if (typeof p === 'string') {
          const j = readJson(p);
          if (j && Array.isArray(j.paths)) paths = paths.concat(j.paths);
        } else if (p && Array.isArray(p.paths)) {
          paths = paths.concat(p.paths);
        } else if (p && Array.isArray(p.transforms)) {
          paths.push(p);
        }
      }
    }
  } catch { /* 解析失败 → 默认相机 */ }
  const eff = paths.map((p) => {
    const trs = (p.transforms || []).filter((x) => x && x.timestamp != null).sort((a, b) => a.timestamp - b.timestamp);
    const lastT = trs.length ? trs[trs.length - 1].timestamp : 0;
    return { p, trs, len: Math.max(lastT, p.duration != null ? p.duration : lastT) };
  });
  const total = eff.reduce((s, e) => s + e.len, 0);
  if (!eff.length || total <= 0) return def;
  let remain = ((t % total) + total) % total;
  let idx = 0;
  for (let i = 0; i < eff.length; i++) {
    if (remain < eff[i].len) { idx = i; break; }
    remain -= eff[i].len;
  }
  const cur = eff[idx];
  if (!cur.trs.length) return def;
  const pt = Math.min(remain, cur.trs[cur.trs.length - 1].timestamp);
  const pose = { ...def };
  let k = 0;
  while (k < cur.trs.length - 1 && pt > cur.trs[k + 1].timestamp) k++;
  const a = cur.trs[k], b = cur.trs[Math.min(k + 1, cur.trs.length - 1)];
  const span = b.timestamp - a.timestamp;
  const f = span > 0 ? Math.min(1, Math.max(0, (pt - a.timestamp) / span)) : 0;
  const lerp3 = (va, vb) => [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f, va[2] + (vb[2] - va[2]) * f];
  pose.eye = lerp3(parseVec3(a.eye, def.eye), parseVec3(b.eye, def.eye));
  pose.center = lerp3(parseVec3(a.center, def.center), parseVec3(b.center, def.center));
  pose.up = v3norm(lerp3(parseVec3(a.up, def.up), parseVec3(b.up, def.up)));
  const za = a.zoom != null ? a.zoom : def.zoom, zb = b.zoom != null ? b.zoom : def.zoom;
  pose.zoom = za + (zb - za) * f;
  return pose;
}

export function computeParallaxDisplacement(cam, mouse) {
  const par = cam.parallax || {};
  const parEnabled = getVal(par, 'enabled', false) === true;
  if (!parEnabled) return [0, 0];
  const parAmount = getVal(par, 'amount', 1);
  const parInfluence = getVal(par, 'mouseinfluence', 0.1);
  const mx = mouse != null ? mouse[0] : 0.5;
  const my = mouse != null ? mouse[1] : 0.5;
  const centeredMouse = [mx - 0.5, my - 0.5];
  return [centeredMouse[0] * parAmount * parInfluence, centeredMouse[1] * parAmount * parInfluence];
}

export function setupCameraMatrices(scene, cam, gen, pose, W, H, fovOverride) {
  const view = mat4LookAt(pose.eye, pose.center, pose.up);
  const near = gen.nearz != null ? gen.nearz : 0.01;
  const far = gen.farz != null ? gen.farz : 10000;
  const ortho = gen.orthogonalprojection;
  let proj, isOrtho;
  if (ortho && ortho.width) {
    // 官方 ortho (逆向 FUN_140183a70): 画布宽高比 ≠ 场景宽高比时, 官方引擎对
    // ortho 视口做 **aspect-fit letterbox** (窄边加黑边, SetOrtho(left,bottom,…)
    // 带 border 偏移)。本插件在 scene-frame 路由按场景 ortho 宽高比计算渲染
    // 尺寸 (index.js sceneAspect → fw/fh), 画布与场景同比例 → 无需 letterbox。
    const hw = ortho.width / 2;
    const hh = (ortho.height || 1080) / 2;
    proj = mat4Ortho(-hw, hw, -hh, hh, near, far);
    isOrtho = true;
  } else {
    const fovDeg = fovOverride != null ? fovOverride : (gen.fov != null ? gen.fov : 50);
    const zoom = pose.zoom != null ? pose.zoom : (gen.zoom != null ? gen.zoom : 1);
    let fovy = fovDeg * Math.PI / 180;
    proj = mat4Perspective(fovy, W / H, near, far);
    if (zoom !== 1) {
      proj[0] *= zoom; proj[5] *= zoom;
    }
    isOrtho = false;
  }
  return { view, proj, vp: mat4Mul(proj, view), isOrtho };
}

import path from 'path';

// ── camera mixin (从 core.js 拆分, 逻辑零改动) ──
export function installCamera(proto) {
  Object.assign(proto, {
    _resolveCameraPose(cam, t) {
        const def = {
          eye: parseVec3(cam.eye, [0, 0, 1]),
          center: parseVec3(cam.center, [0, 0, 0]),
          up: parseVec3(cam.up, [0, 1, 0]),
          zoom: 1,
        };
        // 读取 paths: 每 path 的 transforms (timestamp 升序)
        let paths = [];
        try {
          if (Array.isArray(cam.paths)) {
            for (const p of cam.paths) {
              if (typeof p === 'string') {
                const j = this.pkg.readJson(p);
                if (j && Array.isArray(j.paths)) paths = paths.concat(j.paths);
              } else if (p && Array.isArray(p.paths)) {
                paths = paths.concat(p.paths);
              } else if (p && Array.isArray(p.transforms)) {
                paths.push(p);
              }
            }
          }
        } catch { /* paths 解析失败 → 用默认相机 */ }
        // 多 path 顺序循环: 每个 path 有效时长 = max(末帧 timestamp, duration)
        const eff = paths.map((p) => {
          const trs = (p.transforms || []).filter((x) => x && x.timestamp != null).sort((a, b) => a.timestamp - b.timestamp);
          const lastT = trs.length ? trs[trs.length - 1].timestamp : 0;
          return { p, trs, len: Math.max(lastT, p.duration != null ? p.duration : lastT) };
        });
        const total = eff.reduce((s, e) => s + e.len, 0);
        if (!eff.length || total <= 0) return def;
        // 全局时间定位 path
        let remain = ((t % total) + total) % total;
        let idx = 0;
        for (let i = 0; i < eff.length; i++) {
          if (remain < eff[i].len) { idx = i; break; }
          remain -= eff[i].len;
        }
        const cur = eff[idx];
        if (!cur.trs.length) return def;
        // path 内时间 → 关键帧插值 (clamp 到末帧)
        const pt = Math.min(remain, cur.trs[cur.trs.length - 1].timestamp);
        const pose = { ...def };
        let k = 0;
        while (k < cur.trs.length - 1 && pt > cur.trs[k + 1].timestamp) k++;
        const a = cur.trs[k], b = cur.trs[Math.min(k + 1, cur.trs.length - 1)];
        const span = b.timestamp - a.timestamp;
        const f = span > 0 ? Math.min(1, Math.max(0, (pt - a.timestamp) / span)) : 0;
        const lerp3 = (va, vb) => [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f, va[2] + (vb[2] - va[2]) * f];
        pose.eye = lerp3(parseVec3(a.eye, def.eye), parseVec3(b.eye, def.eye));
        pose.center = lerp3(parseVec3(a.center, def.center), parseVec3(b.center, def.center));
        pose.up = v3norm(lerp3(parseVec3(a.up, def.up), parseVec3(b.up, def.up)));
        const za = a.zoom != null ? a.zoom : def.zoom, zb = b.zoom != null ? b.zoom : def.zoom;
        pose.zoom = za + (zb - za) * f;
        return pose;
      }
    
,
    _setupCamera() {
        const cam = this.scene.camera || {};
        const gen = this.scene.general || {};
        // camera paths: 多镜头顺序循环, 全局时间定位当前 path + 关键帧插值
        const camPose = this._resolveCameraPose(cam, this.time);
        let eye = camPose.eye;
        const center = camPose.center;
        const up = camPose.up;
        // 相机对象 (camera:"default"): 官方用其 origin 动画驱动运镜
        // (入场镜头 origin x:87→0, y:-229→478→0, z:2000→500 —
        //  入场"先上移再拉远": y 负 → 角色上移, y 正 → 下移 + zoom 拉远;
        //  origin 的 x/y 作 eye → 前景经 _viewShift **完整位移 (含 y)**
        //  背景不随相机移动; scene.camera.eye 为默认 (0,0,0) 时生效)
        // 从 this.objects (已烘焙) 取, 而非 scene.objects (原始动画定义)
        // 多相机对象选择: 取 origin 动画"值域跨度"最大的 (真运镜对象)。
        // 证据 (Mutsumi sf33): 两相机对象 — id 216 (无名, origin y 0→400→0
        // 摆动 + zoom 缩小 + scale 全 0 动画, 无入场特征) 与 id 1297271
        // ("入场镜头", origin x/y/z 大幅位移 + zoom 拉近)。取 216 时前景组件
        // 集体做其摆动 (用户反馈"组件的运动方式像另一个组件"); 1297271 的
        // 大幅位移+拉近才是官方入场运镜 (preview 相机固定无法反推, 数学上
        // 幅度显著者为真运镜对象)。
        const camObjs = (this.objects || []).filter((o) => o && o.camera === 'default');
        let camObj = camObjs[0];
        if (camObjs.length > 1) {
          // 动画定义读原始 scene.objects: 此时 origin 已被 _resolveAnimations
          // 烘焙为 {value}, .animation 已不在烘焙对象上 (this._animBackup 也按
          // 烘焙后对象索引) — 按 id 回查 scene.objects 的原始动画。
          const sceneObjs = this.scene.objects || [];
          const spanOf = (o) => {
            const so = sceneObjs.find((x) => x.id === o.id) || o;
            const ov = so.origin;
            if (!ov || !ov.animation) return 0;
            const span = (ch) => {
              const fr = (ov.animation[ch] || []).filter((f) => f && typeof f.frame === 'number' && f.value != null);
              if (!fr.length) return 0;
              const vs = fr.map((f) => Number(f.value));
              return Math.max(...vs) - Math.min(...vs);
            };
            return span('c0') + span('c1') + span('c2');
          };
          let best = camObjs[0], bestSpan = spanOf(camObjs[0]);
          for (const co of camObjs.slice(1)) {
            const s = spanOf(co);
            if (s > bestSpan) { best = co; bestSpan = s; }
          }
          camObj = best;
        }
        this._camObjDriven = false;
        if (camObj) {
          const co = parseVec3(getVal(camObj, 'origin', null), null);
          // 官方语义 (相机对象 = 相机): camera:"default" 对象的 origin 动画驱动
          // 运镜, 与 scene.camera.eye 无关 (同一 eye 字段)。旧实现仅当
          // scene.camera.eye == (0,0,0) 才用相机对象 — eye 非默认时相机对象
          // 动画被丢弃 (根因 D1)。修正: 相机对象带 origin 动画 → 其 origin 即
          // eye (按 t 烘焙后的值); 无动画 (静态相机) → 保留 scene.camera.eye。
          // sf42: 脚本驱动也算 — Amiya 的相机对象 origin 是 {script,value}
          // (脚本把 eye 移到画布中心 1920,1080; 渲染顺序已改为脚本先于
          // setupCamera 执行)。旧实现只认 .animation → 脚本驱动相机被跳过
          // → eye 用 scene.camera.eye 原始值 → 前景组件整体偏移。
          const so = (this.scene.objects || []).find((x) => x.id === camObj.id) || camObj;
          const ov = so.origin;
          // 官方语义修正 (sf43): 只有真实 animation 才用相机对象 origin 驱动 eye。
          // script 驱动的 origin ({script,value}) 是编辑器属性绑定 (Lens position X/Y),
          // 运行时官方场景相机用 scene.camera.eye (Amiya 3486806915 实测:
          // eye=scEye(-360,-269.56) 时人物链 (32-39%,50-74%) 匹配官方 preview;
          // 用 origin 静态值 (2434,725) 时人物出界 (-40%,105%))。
          // 动画相机 (3554161528/3629379075/3641860575) 有 .animation → 仍驱动。
          const hasOriginAnim = ov && typeof ov === 'object' && !!ov.animation;
          const zv = so.zoom;
          const hasZoomAnim = zv && typeof zv === 'object' && !!zv.animation;
          if (co && (hasOriginAnim || hasZoomAnim)) {
            eye = co;
            // 相机对象驱动: 场景完整位移 (x+y) — 官方视图平移 = -eye 两轴
            // (画布 vs = -eye.x, +eye.y; 见 _viewShift sf42 修正)
            this._camObjDriven = true;
          }
        }
        this.camEye = eye;
        this.camView = mat4LookAt(eye, center, up);
        const near = gen.nearz != null ? gen.nearz : 0.01;
        const far = gen.farz != null ? gen.farz : 10000;
        const ortho = gen.orthogonalprojection;
        // 相机对象 (camera:"default"): 官方用其 zoom/origin 动画驱动运镜
        // (zoom 2.15→1 / 1.58→1 + origin 三维动画; 入场镜头效果)
        //  zoom 在正交下 = 缩放正交范围 → 画面放大, 入场镜头效果)
        let camZoom = camPose.zoom != null ? camPose.zoom : (gen.zoom != null ? gen.zoom : 1);
        if (camObj) {
          const cz = getVal(camObj, 'zoom', camZoom);
          if (typeof cz === 'number' && cz > 0 && isFinite(cz)) camZoom = cz;
        }
        if (ortho && ortho.width) {
          const hw = ortho.width / 2 / camZoom;
          const hh = (ortho.height || 1080) / 2 / camZoom;
          // 正交: 场景坐标直接映射画布 (shimmering 等 2D 场景)
          this.camProj = mat4Ortho(-hw, hw, -hh, hh, near, far);
          this.camIsOrtho = true;
          // 有效 zoom 供 2D 组件定位 (renderImage/renderPuppet/粒子):
          // 官方正交投影把 zoom 同时作用于可见范围 (hw=ortho.width/2/Z) 与
          // 组件尺寸/位置 (绕场景中心缩放 Z) — 只进 camProj 则 2D 组件不变 (根因 B)。
          this.camZoom = camZoom;
          this.orthoW = ortho.width;
          this.orthoH = ortho.height || 1080;
        } else {
          // opts.fov 覆盖 (诊断用); 默认取场景 fov, 缺失时 50
          const fovDeg = this.fovOverride != null ? this.fovOverride : (gen.fov != null ? gen.fov : 50);
          const zoom = camPose.zoom != null ? camPose.zoom : (gen.zoom != null ? gen.zoom : 1);
          let fovy = fovDeg * Math.PI / 180;
          this.camProj = mat4Perspective(fovy, this.W / this.H, near, far);
          if (zoom !== 1) { // zoom 缩放视野
            this.camProj[0] *= zoom; this.camProj[5] *= zoom;
          }
          this.camIsOrtho = false;
          // 透视场景: 2D 组件定位不应用正交 zoom (投影路径本就不同)
          this.camZoom = 1;
          this.orthoW = null;
          this.orthoH = null;
        }
        this.camVP = mat4Mul(this.camProj, this.camView); // Clip = Proj · View · World · p
        // 视差 (lwe-CScene.cpp:304): displacement = mix(disp, centeredMouse*amount*influence, delay)
        // 静态帧默认鼠标中心 (0.5,0.5) → 无位移; opts.mouse 可驱动 (跨平台能力)
        this.parallaxDisp = [0, 0];
        const par = cam.parallax || {};
        const parEnabled = getVal(par, 'enabled', false) === true;
        if (parEnabled) {
          const parAmount = getVal(par, 'amount', 1);
          const parInfluence = getVal(par, 'mouseinfluence', 0.1);
          const mx = this.optsMouse != null ? this.optsMouse[0] : 0.5;
          const my = this.optsMouse != null ? this.optsMouse[1] : 0.5;
          const centeredMouse = [mx - 0.5, my - 0.5];
          this.parallaxDisp = [centeredMouse[0] * parAmount * parInfluence, centeredMouse[1] * parAmount * parInfluence];
        }
        // 光照
        this.lights = (this.scene.objects || []).filter((o) => o.light).map((o) => ({
          type: String(o.light || 'point').toLowerCase(),
          origin: parseVec3(o.origin, [0, 0, 0]),
          color: parseVec3(o.color, [1, 1, 1]),
          intensity: o.intensity != null ? o.intensity : 1,
          radius: o.radius != null ? o.radius : 10,
        }));
        this.ambientColor = parseVec3(gen.ambientcolor, [0.3, 0.3, 0.3]);
        this.skylightColor = parseVec3(gen.skylightcolor, [0.3, 0.3, 0.3]);
        // 用户属性 (project.json general.properties 默认值, 供 material usershadervalues
        // 映射 + 脚本 scriptProperties)。构造时已读 (含外部 project.json, _readUserProps),
        // 这里不再覆盖 — 旧实现每帧重置为空 → 脚本属性默认值丢失。
        if (!this.userProps) this.userProps = {};
      }
    
      // 已实现 CPU 移植的 shader 集合 (model/image 材质分发用)
,
    _viewShift(o, size, ps) {
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        const w = ortho && ortho.width ? ortho.width : this.W;
        const h = ortho && ortho.height ? ortho.height : this.H;
        const isBg = size && size[0] >= w - 1 && size[1] >= h - 1;
        if (isBg || !this.camEye) return [0, 0];
        // 官方逆向 (wallpaper64.exe 0x1401ED0D0): 相机矩阵应用对 eye 的
        // x (0x178) 与 y (0x17c) 均做 subss 并折入矩阵平移行 — 视图平移
        // 作用于两个轴, 不存在 "y=0"。相机对象 (camera:"default") 与
        // scene.camera.eye 是同一 eye 字段, 平移语义一致:
        //   场景位移 = -eye (两轴) → 画布 vs = (-eye.x, +eye.y)·ps (y 翻转)。
        // 旧实现非 camObjDriven 路径 vs[1]=0 (sf32 无二进制依据, 且其推导
        // "实测与官方相反→移除" 是符号错误故事而非零); 修正为 +eye.y·ps。
        return [(-this.camEye[0]) * (ps ? ps[0] : 1), (this.camEye[1]) * (ps ? ps[1] : 1)];
      }
    
      // 正交 zoom 画布中心 (根因 B 修复): 官方 clip = Proj·View·World,
      // Proj = ortho(-Ws/2Z, Ws/2Z, ...) → 可见范围收窄 = 画面放大 Z 倍绕场景中心;
      // View 平移 -eye 在视图空间, 随投影缩放 Z。
      // 画布中心 = (origin - 场景中心)*Z*ps + 画布中心 + viewShift*Z
      // Z=1 且宽高比匹配时退化为原公式 (origin*ps + vs), 零行为变化。
      ,
    _orthoZoomCenter(origin, vs) {
        const Z = this.camZoom || 1;
        const Ws = this.orthoW || this.W;
        const Hs = this.orthoH || this.H;
        const psx = this.W / Ws, psy = this.H / Hs;
        return [
          (origin[0] - Ws / 2) * Z * psx + this.W / 2 + (vs ? vs[0] : 0) * Z,
          this.H / 2 - (origin[1] - Hs / 2) * Z * psy + (vs ? vs[1] : 0) * Z,
        ];
      }
    
      // 正交 zoom 像素比例: 组件尺寸 = size * zoom * ps (与投影一致)
      ,
    _orthoZoomScale() {
        return this.camZoom || 1;
      }
    
      // ── sf44: 统一世界坐标 → 画布像素 (官方矩阵数学真值) ──
      // 官方: clip = Proj·View·World; Proj = ortho(-Ws/2Z, Ws/2Z, -Hs/2Z, Hs/2Z);
      // View = lookAt(eye, center, up) (正交场景 = 平移 -eye)。
      // 屏幕: sx = (ndc.x+1)/2·W, sy = (1-ndc.y)/2·H (画布 y 向下)。
      // 这替代 image/particles 里分散的 ps·vs·Z·_orthoZoomCenter 组合 —
      // 它们对"非全屏局部对象"有系统性偏移 (场景原点被映射到画布左上角,
      // 而官方 ortho 对称 → 原点在画布中心)。Amiya 467 实测:
      //   矩阵模型 → (50%,51%) 匹配官方 preview 人物中心;
      //   DSH 旧公式 → (32%,57%) 偏移。
      // 全屏背景对象 (size ≥ 场景) 不受影响 (size 覆盖全画布)。
      ,
    worldToScreen(wx, wy, wz = 0) {
        const vp = this.camVP;
        const p = [wx, wy, wz, 1];
        const cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12] * p[3];
        const cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13] * p[3];
        const cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15] * p[3];
        if (cw === 0) return [0, 0];
        return [(cx / cw + 1) / 2 * this.W, (1 - cy / cw) / 2 * this.H];
      }
    
      // ── Image 对象渲染 ────────────────────────────────────────────────
  });
}
