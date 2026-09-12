// WE GL 木偶数据导出 (W4) — host 端 MDL 解析与物化。
// 产物经 /scene-puppet 端点下发, GL 客户端消费:
//   测试层 (默认): 绑定姿态网格渲染 — 只用 positions/uvs/indices (恒等蒙皮,
//     本地 22 个 puppet 对象实测全部 anims=0, 见 .analysis/w4-puppet-design.md);
//   实验层 (实验开关): 骨骼动画 — 消费物化帧世界 RT + bind 链, 客户端逐帧
//     层合成 + JS 蒙皮, 无需移植 _sampleAnimRT 的 MDLA 段解析。
// 解析复用 CPU 权威实现 (puppet.js mixin 挂裸 proto — 已 node 实测可行),
// 与 CPU 路由共享同一份 parse 代码, 无漂移面。
import { installPuppet } from './puppet.js';

// 单 anim 帧物化上界: 病理 MDL (frameCount 伪造巨大) 防内存爆炸; 超限弃该动画
// (客户端退回绑定姿态 + degraded), 不影响网格渲染主路径。
const MAX_MATERIALIZE_FRAMES = 1200;

// MDAT0001 段单次解析锚点数上限 (坏 count 防爆循环; 条目解析本就有越界 break)。
const MAX_MDAT_ANCHORS = 1024;

/**
 * W7: 解析 MDL 的 MDAT0001 锚点段 (attachment 锚点)。
 * 段布局 (官方 wallpaper64.exe 逆向 + 实测):
 *   "MDAT0001\0" + u32 段字节 + u16 锚点数
 *   + 每条锚点: u16 骨骼索引 + 名字\0 + 64B 行主序矩阵 (平移 = m[12], m[13])
 * 名字与场景对象 attachment 字段精确匹配。
 * @param {Buffer|Uint8Array} raw MDL 字节
 * @returns {Array<{name:string,boneIdx:number,tx:number,ty:number}>}
 */
export function parseMdatAnchors(raw) {
  const out = [];
  if (!raw) return out;
  // Uint8Array.indexOf(字符串) 恒 -1 (类型强转 NaN) — 与 _parseMdl sf42 同款,
  // 统一转 Buffer 使段搜索在 pkgSceneAccess (Uint8Array) 路径一致。
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let idx = buf.indexOf('MDAT'); idx >= 0; idx = buf.indexOf('MDAT', idx + 4)) {
    if (buf.toString('utf8', idx, idx + 8) !== 'MDAT0001') continue;
    let p = idx + 9 + 4; // 魔数\0 + u32 段字节
    if (p + 2 > buf.length) continue;
    const count = buf.readUInt16LE(p); p += 2;
    for (let e = 0; e < count && e < MAX_MDAT_ANCHORS && p + 2 <= buf.length; e++) {
      const boneIdx = buf.readUInt16LE(p); p += 2;
      const ne = buf.indexOf(0, p);
      if (ne < 0 || ne - p > 128) break; // 名字越界/畸形 → 段内后续不可信
      const name = buf.toString('utf8', p, ne);
      p = ne + 1;
      if (p + 64 > buf.length) break;
      const tx = buf.readFloatLE(p + 48); // m[12]
      const ty = buf.readFloatLE(p + 52); // m[13]
      p += 64;
      if (name) out.push({ name, boneIdx, tx, ty });
    }
  }
  return out;
}

/**
 * W7: 父 puppet 的 attachment 锚点表 + 绑定姿态骨骼位姿 (锚点相对骨骼定位用)。
 * 返回 null = 该模型不是 puppet / MDL 不可读 / 无锚点 (调用方按无锚点渲染)。
 * 骨骼位姿取 **绑定姿态** (_ensureBindRig, MDLS 静态矩阵) — 与 GL 木偶网格的
 * 静态渲染口径一致; MDLA 动画解析可用后, 跟随动画的锚点需另一条逐帧路径。
 * @param {{readFile:(p:string)=>({bytes:Buffer|Uint8Array}|null)}} access pkgSceneAccess
 * @param {{puppet?:string}} modelJson 父对象模型 json
 */
export function buildPuppetAnchors(access, modelJson) {
  if (!modelJson || typeof modelJson.puppet !== 'string' || !modelJson.puppet) return null;
  const f = access.readFile(modelJson.puppet);
  if (!f || !f.bytes) return null;
  const anchors = parseMdatAnchors(f.bytes);
  if (!anchors.length) return null;
  // 裸 proto (同 buildPuppetPayload): mixin 方法只依赖 pkg/log/onDegraded。
  const proto = newPuppetProto(access);
  const mesh = proto._parseMdl(f.bytes);
  // 骨骼位姿口径必须与网格渲染姿态一致: 旧容器 (MDLV0013/0016) 的 bind 是图集
  // 排版姿态, 渲染姿态 = MDLA 首帧 (见 buildPuppetPayload) → 锚点也按首帧取。
  const rig = !mesh ? null : (mesh.legacyAnim ? proto._legacyPoseRT(mesh, 0) : proto._ensureBindRig(mesh));
  const boneRT = Array.isArray(rig)
    ? rig.map((r) => ({ angle: r.angle, tx: r.tx, ty: r.ty }))
    : [];
  return { anchors, boneRT };
}

// 官方语义: puppet 动画由场景对象挂的 animationlayers 驱动 —— 对象未挂任何
// 可见层 = 未播放动画 → 网格保持绑定姿态 (raw 顶点 = 对象 rect = 作者构图)。
// 客户端 src/scene-gl.js `_weGLBuildPuppetMesh` 必须同口径 (同一规则两处,
// 改动请同步; 该函数服务于 gate 侧"要不要物化动画帧"的判定)。
export function hasVisibleAnimLayer(sceneObj) {
  const l = sceneObj && sceneObj.animationlayers;
  return Array.isArray(l) && l.some((x) => x && x.visible !== false);
}

// 裸 proto (每次新建, 不跨调用缓存 mesh — 与 buildPuppetPayload 同款约定:
// _mdlCache 挂 this, 串缓会张冠李戴)。
function newPuppetProto(access) {
  const proto = {};
  installPuppet(proto);
  proto.pkg = { read: (p) => { const g = access.readFile(p); return g ? g.bytes : null; } };
  proto.log = () => {};
  proto.onDegraded = null;
  return proto;
}

// access = pkgSceneAccess 形态 ({readFile(p)→{bytes}|null}); modelJson = 模型
// json ({puppet: '<mdl path>'}); sceneObj = 可选场景对象 (读 animationlayers —
// 对象未挂层时不需要动画帧, 见下方物化条件); 返回 JSON-safe payload | null。
export function buildPuppetPayload(access, modelJson, sceneObj) {
  if (!modelJson || typeof modelJson.puppet !== 'string' || !modelJson.puppet) return null;
  const f = access.readFile(modelJson.puppet);
  if (!f || !f.bytes) return null;
  // 裸 proto: mixin 方法只依赖 pkg/log/onDegraded (parse 路径), 每次新建 —
  // mesh 缓存 (_mdlCache) 挂 this, 跨调用串缓会张冠李戴, 不可单例。
  const proto = newPuppetProto(access);
  const mesh = proto._parseMdl(f.bytes);
  if (!mesh || !mesh.vertexCount) return null;

  // 旧容器 (MDLV0013/0016) 静态装配: MDLS bind = 图集排版姿态 (部件按 UV 摊在
  // atlas 上), 渲染姿态 = MDLA 首帧 → 烘焙首帧, 否则部件保持散列 (2686862510
  // "左肩/披风脱离人物" 的根因)。新容器实测首帧≈bind (≤0.03 单位) → 不烘焙,
  // 既有 36 个文件逐位不变。
  const poseRT = mesh.legacyAnim ? proto._legacyPoseRT(mesh, 0) : null;
  const srcPositions = poseRT ? proto._poseMeshByRT(mesh, poseRT) : mesh.positions;

  // 平铺几何 (JSON 数组; 本地 puppet 网格 ≤500 顶点, 体积可忽略)
  const positions = new Array(mesh.vertexCount * 3);
  const uvs = new Array(mesh.vertexCount * 2);
  const blendIndices = new Array(mesh.vertexCount * 4);
  const blendWeights = new Array(mesh.vertexCount * 4);
  for (let i = 0; i < mesh.vertexCount; i++) {
    positions[i * 3] = srcPositions[i][0];
    positions[i * 3 + 1] = srcPositions[i][1];
    positions[i * 3 + 2] = srcPositions[i][2];
    uvs[i * 2] = mesh.uvs[i][0];
    uvs[i * 2 + 1] = mesh.uvs[i][1];
    for (let k = 0; k < 4; k++) {
      blendIndices[i * 4 + k] = mesh.blendIndices[i][k];
      blendWeights[i * 4 + k] = mesh.blendWeights[i][k];
    }
  }

  const nb = mesh.bones.length;
  const payload = {
    vertexCount: mesh.vertexCount,
    positions, uvs,
    indices: mesh.indices.slice(),
    blendIndices, blendWeights,
    bones: mesh.bones.map((b) => ({ parent: b.parent, bind: b.bind.slice() })),
    animations: [],
  };

  // bind 链 + 帧物化: 仅在有骨骼+动画时需要 (实验层输入)。借 _skinPuppet 的
  // 惰性缓存副作用填充 mesh._bindWorld/_bindInv/_bindRT (t=0 一次调用),
  // 避免复制 bind 链构建代码 (MOD-07 的三份漂移教训)。
  // 对象未挂 animationlayers 时不物化: 官方语义里动画由层驱动, 无层 = 绑定
  // 姿态渲染 (客户端同口径), 物化的每帧世界 RT 永远不会被采样 —— 省掉
  // 「每对象 fc×骨数×3 float + JSON 序列化」的纯浪费 (3302695207 人物:
  // 121 帧 × 8 骨 × 5 对象)。
  const wantAnims = !(sceneObj && !hasVisibleAnimLayer(sceneObj));
  if (nb > 0 && mesh.animations.length && wantAnims) {
    proto._skinPuppet(mesh, 0, 0, 0, null);
    payload.bindRT = mesh._bindRT.map((r) => ({ angle: r.angle, tx: r.tx, ty: r.ty, sx: r.sx, sy: r.sy, tz: r.tz }));
    payload.bindInv = mesh._bindInv.map((m) => m.slice());
    for (const anim of mesh.animations) {
      const fc = Math.max(1, anim.frameCount | 0);
      if (fc > MAX_MATERIALIZE_FRAMES) continue; // 病理帧数: 弃动画保网格
      const rt = new Array(fc * nb * 3);
      for (let fr = 0; fr < fc; fr++) {
        const w = proto._sampleAnimRT(mesh, anim, fr, nb, mesh.bones);
        for (let b = 0; b < nb; b++) {
          rt[(fr * nb + b) * 3] = w[b].angle;
          rt[(fr * nb + b) * 3 + 1] = w[b].tx;
          rt[(fr * nb + b) * 3 + 2] = w[b].ty;
        }
      }
      payload.animations.push({ name: anim.name || '', frameCount: fc, fps: Number.isFinite(anim.fps) && anim.fps > 0 ? anim.fps : 30, rt });
    }
  }
  return payload;
}
