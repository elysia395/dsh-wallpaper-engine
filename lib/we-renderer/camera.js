// WE 渲染引擎 — 相机 (lookAt/透视/正交 + camera paths + 视差)
import { parseVec3, parseVec2, getVal, mat4LookAt, mat4Perspective, mat4Ortho, mat4Mul, v3norm } from './math.js';

// camera paths: 多 path 顺序循环 (总时长 = duration 和), path 内关键帧线性插值
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

// 视差 (lwe-CScene.cpp:304): displacement = mix(disp, centeredMouse*amount*influence, delay)
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

// 组装相机矩阵 (透视或正交)
export function setupCameraMatrices(scene, cam, gen, pose, W, H, fovOverride) {
  const view = mat4LookAt(pose.eye, pose.center, pose.up);
  const near = gen.nearz != null ? gen.nearz : 0.01;
  const far = gen.farz != null ? gen.farz : 10000;
  const ortho = gen.orthogonalprojection;
  let proj, isOrtho;
  if (ortho && ortho.width) {
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
