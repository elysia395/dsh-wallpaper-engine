// WE puppet MDL 解析与蒙皮数学 — GL 路径支持模块 (W4 木偶 payload 的服务端解析源)。
// CPU 渲染路径已移除 (renderPuppet/_rasterizeMesh/_parseMdlStatic 等随之删除);
// 本文件只保留 puppet-export.js 消费的解析/骨骼链/动画采样方法,
// mixin 挂裸 proto 的契约不变 (pkg/log/onDegraded), 与 GL 路由共享同一份 parse。
import { getVal, v3sub, v3cross, v3dot, v3norm } from './math.js';

// ── MDL 顶点记录布局 (实测两族, 见 docs/WE-REVERSE.md §8) ──
// pos 恒在记录首 12B; 两族的差别只在 pos 之后是否有 28B 法线/切线区。
//   STRIDE80: [pos 12][法线/切线 28][blendIdx 16][weights 16][uv 8] = 80B
//             MDLV0021/0023 家族 (库内 36 个 puppet MDL 全部命中)
//   COMPACT52: [pos 12][blendIdx 16][weights 16][uv 8] = 52B
//             MDLV0013/0016 家族 — pos 与 uv 是同一张图集上的同一映射
//             (x = u·W − W/2, y = H/2 − v·H), 2686862510 主体 781 顶点逐点残差 0.0000
const MDL_VERTEX_STRIDE80 = { stride: 80, blend: 40, weight: 56, uv: 72, strict: false };
const MDL_VERTEX_COMPACT52 = { stride: 52, blend: 12, weight: 28, uv: 44, strict: true };

// ── puppet 解析 mixin ──
export function installPuppet(proto) {
  Object.assign(proto, {
    _resolveAnimLayers(o, mesh) {
        // N-14: 帧内缓存 — 同帧多个 attachment 子对象共享同一父对象的层解析
        // (findIndex+数字后缀正则); 失效点在 core.js render() 脚本执行后
        // (与 _tfParseCache 同款挂法, 见 core.js 失效点注释)。键含
        // animationlayers 数组引用: 被整体换写时失效重解
        if (!this._animLayerCache) this._animLayerCache = new Map();
        const hit = this._animLayerCache.get(o);
        if (hit && hit.src === o.animationlayers) return hit.out;
        const out = this._resolveAnimLayersInner(o, mesh);
        this._animLayerCache.set(o, { src: o.animationlayers, out });
        return out;
      }

      // 上法的实际解析体 (原 _resolveAnimLayers 逻辑零改动)
,
    _resolveAnimLayersInner(o, mesh) {
        if (!(mesh.animations && mesh.animations.length > 1 && o.animationlayers && o.animationlayers.length)) return null;
        const layers = o.animationlayers
          .filter((l) => {
            const v = l && l.visible;
            return v === true || (v && typeof v === 'object' && v.value === true);
          })
          .map((l) => {
            const blend = typeof l.blend === 'number' && l.blend >= 0 && l.blend <= 1 ? l.blend : 1;
            const rate = typeof l.rate === 'number' && l.rate > 0 ? l.rate : 1;
            let idx = mesh.animations.findIndex((a) => a.name && l.name && a.name === l.name);
            if (idx < 0 && l.name) {
              // 数字后缀: "动画 N" → MDL 第 N 个动画 (层名带编号、动画本身无名时,
              // 名字不匹配按索引回退会选错动画 → 角色蒙皮飞走)
              const m = String(l.name).match(/(\d+)/);
              if (m) {
                const n = parseInt(m[1], 10);
                if (n >= 1 && n <= mesh.animations.length) idx = n - 1;
              }
            }
            if (idx < 0) {
              const layerIdx = o.animationlayers.indexOf(l);
              if (layerIdx >= 0 && layerIdx < mesh.animations.length) idx = layerIdx;
            }
            if (idx < 0) idx = 0;
            return { animIdx: idx, blend, rate, additive: !!l.additive };
          });
        return layers.length ? layers : null;
      }
    
      // 骨骼蒙皮: 时间 → 动画帧 → 骨骼世界矩阵 → 顶点 × Σ w × (bindWorld⁻¹ × finalWorld)
      // (MOD-01: 行向量约定下 g_Bones = bindInv×final, 左因子先应用 — 见下方构造处)
      // 引擎 model_vertex_v1.h ApplySkinningPosition: pos' = Σ w·(pos × g_Bones[bi])
      // 动画层合成 (官方 animationlayers 语义, 全部 visible 层参与):
      //   普通层: final = mix(final, layerWorld, blend)   (blend=1 → 替换)
      //   additive层: final += (layerWorld − refWorld) × blend, refWorld = 动画帧0世界 = bind 世界
      //   (已验证: 动画帧0 局部姿势链乘后 = bind 世界姿势)
      // 世界空间合成 (非局部空间 lerp): 多 additive 层各层 delta 在各自骨骼上叠加,
      // 丢失任何一层即组件错位 (眼/上半身/嘴/呼吸层等)
,
    // 绑定姿态骨架 (bindWorld/bindInv/bindRT) 物化 — 只依赖 MDLS 静态骨骼矩阵,
    // 与动画层/t 无关。抽成独立方法供两条消费路径共用 (单一实现):
    //   1) _skinPuppet 蒙皮 (下方, 需要 bindInv);
    //   2) W7 attachment 锚点 (puppet-export.buildPuppetAnchors) — 无动画 MDL
    //      走不到 _skinPuppet 的 bind 段 (anim0 早退), 旧实现无法在此取骨骼位姿。
    _ensureBindRig(mesh) {
        const bones = mesh.bones || [];
        const nb = bones.length;
        if (mesh._bindRT) return mesh._bindRT;
        // 绑定世界矩阵 (MDLS 层级累积, 行主序) + 逆
        const bindWorld = new Array(nb);
        const bindInv = new Array(nb);
        for (let b = 0; b < nb; b++) {
          const parent = bones[b].parent;
          const local = bones[b].bind; // 行主序 4x4 (平移在行3)
          // MOD-02: 链法与 _sampleAnimRT 统一 (平移 = 父t + Rz(父角)·子t, 即
          // 先应用子局部再应用父)。行向量约定 p·(A×B)=(p·A)·B → 左因子先应用,
          // 故子先父后 = local×parent。旧实现 parent×local (父先子后) 在父绑定
          // 旋转 ≠0 且子平移 ≠0 时与动画帧0链乘结果分歧 (node: b0=R90°+t(10,0),
          // b1=t(0,5) → 旧 (10,5) vs 动画链 (5,0))。
          bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? this._matMulRow(local, bindWorld[parent]) : local;
        }
        for (let b = 0; b < nb; b++) bindInv[b] = this._matInvertRow(bindWorld[b]);
        // bind 世界 {angle, tx, ty, sx, sy, tz} (additive 参考姿势 = 动画帧0世界 = bind 世界)
        // MOD-09: 补骨骼缩放/Z — 从 bind 矩阵分解 2D 缩放 (行向量幅值) 与 Z 平移,
        // 动画 RT 无缩放通道 → final 沿用 bind 缩放 (此前恒 1 丢缩放; 单位缩放
        // 绑定下输出与旧实现逐位一致)
        const bindRT = new Array(nb);
        for (let b = 0; b < nb; b++) {
          const m = bindWorld[b];
          bindRT[b] = {
            angle: Math.atan2(m[1], m[0]), tx: m[12], ty: m[13],
            sx: Math.sqrt(m[0] * m[0] + m[1] * m[1]) || 1,
            sy: Math.sqrt(m[4] * m[4] + m[5] * m[5]) || 1,
            tz: m[14],
          };
        }
        mesh._bindWorld = bindWorld;
        mesh._bindInv = bindInv;
        mesh._bindRT = bindRT;
        return bindRT;
      }
,
    // 顶点记录布局 (实测两族, 见 docs/WE-REVERSE.md §8):
    //   STRIDE80: [pos 12B][法线/切线区 28B][blendIdx 16B][weights 16B][uv 8B] = 80B
    //             (MDLV0021/0023 家族 — 库内 36 个文件)
    //   COMPACT52: [pos 12B][blendIdx 16B][weights 16B][uv 8B] = 52B
    //             (MDLV0013/0016 家族 — 无 28B 中间区; uv 恰好是 pos 的图集映射:
    //              x = u·W − W/2, y = H/2 − v·H, 逐顶点残差 0.0000)
    _scanVertexBlock(dv, buf, mdlsOffset, L) {
        for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
          const vertexBytes = dv.getUint32(offset + 4, true);
          const verticesOffset = offset + 8;
          if (vertexBytes === 0 || vertexBytes % L.stride !== 0) continue;
          const indexLenOffset = verticesOffset + vertexBytes;
          if (indexLenOffset + 4 > mdlsOffset) continue;
          const indexBytes = dv.getUint32(indexLenOffset, true);
          const indicesOffset = indexLenOffset + 4;
          if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
          // 顶点合理性: 前若干顶点的 pos 必须有限且量级合理 (部分 MDL 有垃圾候选块,
          // 选错会把顶点炸到 1e28 导致渲染崩溃)
          const vc = vertexBytes / L.stride;
          // 紧凑回退的最小规模判据 (噪声块防误判); 主路径不加, 与旧实现逐条一致
          if (L.strict && vc < 3) continue;
          let sane = true;
          for (let i = 0; i < Math.min(vc, 64); i++) {
            const vo = verticesOffset + i * L.stride;
            for (let k = 0; k < 3; k++) {
              const v = dv.getFloat32(vo + k * 4, true);
              if (!isFinite(v) || Math.abs(v) > 1e6) { sane = false; break; }
            }
            if (!sane) break;
          }
          if (!sane) continue;
          // 索引范围: 前若干索引必须 < 顶点数 (部分 MDL 索引与顶点块不匹配)
          const ic = indexBytes / 2;
          if (ic > 0) {
            let idxOk = 0;
            for (let k = 0; k < Math.min(ic, 400); k++) {
              if (dv.getUint16(indicesOffset + k * 2, true) < vc) idxOk++;
            }
            if (idxOk < Math.min(ic, 400) * 0.98) continue;
          }
          // 紧凑记录额外判据 (无 28B 中间区, 光靠 pos 无法与噪声块区分): 蒙皮权重
          // 4 项须 0..1 且和 = 1, uv 须在 [0,1] 附近 — 抽样 90% 通过才认。
          // 只加在 COMPACT52 回退路径上: STRIDE80 主路径逐条件与旧实现一致 (零回归)。
          if (L.strict) {
            let recOk = 0;
            const sample = Math.min(vc, 64);
            for (let i = 0; i < sample; i++) {
              const vo = verticesOffset + i * L.stride;
              let sum = 0, wOk = true;
              for (let k = 0; k < 4; k++) {
                const w = dv.getFloat32(vo + L.weight + k * 4, true);
                if (!isFinite(w) || w < -0.01 || w > 1.01) { wOk = false; break; }
                sum += w;
              }
              if (!wOk || Math.abs(sum - 1) > 0.02) continue;
              const u = dv.getFloat32(vo + L.uv, true), v = dv.getFloat32(vo + L.uv + 4, true);
              if (!isFinite(u) || !isFinite(v) || u < -4 || u > 5 || v < -4 || v > 5) continue;
              recOk++;
            }
            if (recOk < sample * 0.9) continue;
          }
          return { verticesOffset, vertexBytes, indicesOffset, indexBytes, layout: L };
        }
        return null;
      }
,
    // 旧容器 (MDLV0013/0016) 的 MDLA 头读取 — **按偏移直读**, 不做 [f0 41] 魔数扫描。
    // 既有实现用 fps=30.0f 的魔数 (00 00 f0 41) 定位头部, fps≠30 的动画 (实测 3.625)
    // 永远失配 → 扫描跑到文件尾 → 整个 MDLA 丢弃。实测布局 (2686862510 逐字节核对):
    //   "MDLA0001\0" + u32 段尾偏移 + u32 动画数
    //   per 动画: u32 id + u32 0 + 名字\0 + 循环标志\0
    //             + float fps + u32 frameCount + u32 0 + u32 boneCount
    //   per 骨骼: u32 0 + u32 segBytes + segBytes 数据  ← 每骨 8B 段头 (易漏!
    //             segBytes=(frameCount+1)×36 只是数据部分, 段步进 = segBytes+8)
    //   行 = 9 float / 36B: pos.x, pos.y, pos.z, ?, ?, rotZ, sx, sy, sz
    // 返回 null = 不可用; 只服务静态装配姿态, 不进动画物化 (见 _parseMdl 尾注)。
    _parseLegacyMdla(dv, buf, mdlaOffset) {
        if (mdlaOffset < 0 || mdlaOffset + 32 > buf.length) return null;
        try {
          let p = mdlaOffset + 9 + 4; // 魔数\0 + u32 段尾偏移
          const count = dv.getUint32(p, true); p += 4;
          if (count <= 0) return null;
          p += 8; // u32 动画 id + u32 0
          const nameEnd = buf.indexOf(0, p);
          if (nameEnd < 0 || nameEnd - p > 256) return null;
          const name = buf.toString('utf8', p, nameEnd);
          p = nameEnd + 1;
          const flagEnd = buf.indexOf(0, p);
          if (flagEnd < 0 || flagEnd - p > 64) return null;
          const flag = buf.toString('utf8', p, flagEnd);
          p = flagEnd + 1;
          if (p + 16 > buf.length) return null;
          const fps = dv.getFloat32(p, true);
          const frameCount = dv.getUint32(p + 4, true);
          const boneCount = dv.getUint32(p + 12, true);
          const segBytes = dv.getUint32(p + 20, true); // 首骨的段头 (+16 起)
          const segStart = p + 24;
          // 结构自洽校验: 行 = 36B, 段内行数 = frameCount+1, 每骨 8B 段头 + 段数据
          if (!(fps > 0 && fps <= 240) || frameCount <= 0 || frameCount > 100000) return null;
          if (boneCount <= 0 || boneCount > 512) return null;
          if (segBytes !== (frameCount + 1) * 36) return null;
          const segStride = segBytes + 8;
          // 末段之后没有 8B 段头 → 上界按 (骨数−1)×步进 + 段字节
          if (segStart + (boneCount - 1) * segStride + segBytes > buf.length) return null;
          return { name, flag, fps, frameCount, boneCount, segBytes, segStride, segStart };
        } catch { return null; }
      }
,
    // 旧容器骨骼世界姿势 (帧 frame): 逐骨骼一段 (段 b ↔ 骨 b, 无交错/无行位移),
    // 行 9 float: pos = 列 0/1, rotZ = 列 5; 父链 2D 合成 (角度相加, 平移经父角旋转),
    // 与 _sampleAnimRT 同口径。返回 [{angle,tx,ty,sx,sy,tz}]。
    _legacyPoseRT(mesh, frame) {
        const la = mesh.legacyAnim;
        const nb = mesh.bones ? mesh.bones.length : 0;
        if (!la || !nb) return null;
        const dv = new DataView(mesh.raw.buffer, mesh.raw.byteOffset, mesh.raw.byteLength);
        const rows = la.frameCount + 1;
        const f = Math.max(0, Math.min(rows - 1, frame | 0));
        const out = new Array(nb);
        for (let b = 0; b < nb; b++) {
          const bi = b < la.boneCount ? b : (la.boneCount - 1);
          const o = la.segStart + bi * (la.segStride || la.segBytes + 8) + f * 36;
          const px = dv.getFloat32(o, true);
          const py = dv.getFloat32(o + 4, true);
          const rotZ = dv.getFloat32(o + 20, true);
          if (!isFinite(px) || !isFinite(py) || !isFinite(rotZ) || Math.abs(px) > 1e5 || Math.abs(py) > 1e5) return null;
          const sx = dv.getFloat32(o + 24, true), sy = dv.getFloat32(o + 28, true);
          const scale = { sx: isFinite(sx) && sx > 0 ? sx : 1, sy: isFinite(sy) && sy > 0 ? sy : 1 };
          const parent = mesh.bones[b].parent;
          const bind = mesh.bones[b].bind;
          const tz = bind ? bind[14] : 0;
          if (parent >= 0 && parent < nb && out[parent]) {
            const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa);
            out[b] = { angle: pa + rotZ, tx: out[parent].tx + px * pc - py * ps, ty: out[parent].ty + px * ps + py * pc, sx: scale.sx, sy: scale.sy, tz };
          } else {
            out[b] = { angle: rotZ, tx: px, ty: py, sx: scale.sx, sy: scale.sy, tz };
          }
        }
        return out;
      }
,
    // 按给定世界 RT 做一次蒙皮 (bind⁻¹ × RT), 返回新顶点数组 (不加 cxs/cys)。
    // 语义与 _skinPuppet 的 gBones 完全一致 (单一实现: MOD-01 行向量约定), 供
    // 静态装配姿态烘焙用 (旧容器首帧)。
    _poseMeshByRT(mesh, rt) {
        const bones = mesh.bones || [];
        const nb = bones.length;
        this._ensureBindRig(mesh);
        const bindInv = mesh._bindInv;
        const gBones = new Array(nb);
        for (let b = 0; b < nb; b++) {
          const r = rt[b] || { angle: 0, tx: 0, ty: 0, sx: 1, sy: 1, tz: 0 };
          const c = Math.cos(r.angle), s = Math.sin(r.angle);
          const sx = r.sx || 1, sy = r.sy || 1;
          const m = [c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, 1, 0, r.tx, r.ty, r.tz || 0, 1];
          gBones[b] = this._matMulRow(bindInv[b], m);
        }
        const out = new Array(mesh.positions.length);
        for (let i = 0; i < mesh.positions.length; i++) {
          const p = mesh.positions[i], bi = mesh.blendIndices[i], bw = mesh.blendWeights[i];
          let x = 0, y = 0, z = 0;
          for (let k = 0; k < 4; k++) {
            const w = bw[k];
            if (w === 0) continue;
            const m = gBones[bi[k]] || gBones[0];
            x += (p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12]) * w;
            y += (p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13]) * w;
            z += (p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14]) * w;
          }
          out[i] = [x, y, z];
        }
        return out;
      }
,
    // SF54: 定位下一条骨骼头 (MDLS 条目尾部名字无终止符, 长度不定)。
    // 判据 = len/parent/type 合理 + 其后 64B 是合法仿射矩阵 (m[15]=1, 无透视列),
    // 无名骨骼 (条目尾仅 1 个 0x00) 时首个候选即命中, 与旧行为一致。
    // 返回 buf.length = 无更多骨骼 (外层循环自然结束)。
    _nextBoneHeader(dv, buf, p, nextIndex = 1) {
        let loose = -1; // 放宽 parent 顺序判据后的首个候选 (兜底)
        for (let q = p + 1; q + 77 <= buf.length; q++) {
          const len = dv.getUint32(q + 9, true);
          if (len === 0 || len > 4096) continue;
          const parent = dv.getInt32(q + 5, true);
          if (parent < -1 || parent > 4096) continue;
          if (dv.getUint32(q + 1, true) > 16) continue; // type
          const m0 = q + 13;
          if (m0 + 64 > buf.length) break;
          if (dv.getFloat32(m0 + 60, true) !== 1) continue; // m[15]
          if (dv.getFloat32(m0 + 12, true) !== 0 || dv.getFloat32(m0 + 28, true) !== 0) continue; // m[3]/m[7] 透视列
          let ok = true;
          for (let i = 0; i < 15 && ok; i++) ok = Number.isFinite(dv.getFloat32(m0 + i * 4, true));
          if (!ok) continue;
          for (const i of [0, 5, 10]) { const v = Math.abs(dv.getFloat32(m0 + i * 4, true)); if (!(v > 1e-6 && v < 1e6)) { ok = false; break; } }
          if (!ok) continue;
          // 父骨骼必须排在子骨骼之前 (MDLS 顺序不变式) — 强判据, 排除随机撞上的
          // 64B 数据块; 命中即返回, 否则记下放宽候选兜底 (宁可多算一根, 也不重演
          // "截断成 1 根"的旧 bug)。
          if (parent < nextIndex) return q;
          if (loose < 0) loose = q;
        }
        return loose >= 0 ? loose : buf.length;
      }
,
    _skinPuppet(mesh, t, cxs, cys, layers = null) {
        const bones = mesh.bones;
        if (!layers || !layers.length) layers = [{ animIdx: 0, blend: 1, rate: 1, additive: false }];
        const anim0 = mesh.animations[layers[0].animIdx] || mesh.animations[0];
        if (!anim0) return mesh.positions.map((p) => [p[0] + cxs, p[1] + cys, p[2]]);
        const nb = bones.length;
        // P1-10: 蒙皮数据兼容性校验按 mesh 记忆 (blendWeights/blendIndices/bones
        // 均为 MDL 静态数据, 校验结论跨帧不变 — 旧实现每帧全顶点重校)
        if (mesh._skinOK == null) {
          let skinOK = true;
          for (let i = 0; i < mesh.positions.length; i++) {
            for (let k = 0; k < 4; k++) {
              const w = mesh.blendWeights[i][k];
              const bi = mesh.blendIndices[i][k];
              if (w < -0.001 || w > 1.001 || !isFinite(w) || bi >= nb) { skinOK = false; break; }
            }
            if (!skinOK) break;
          }
          mesh._skinOK = skinOK;
        }
        // 蒙皮数据兼容性: 权重须 0..1 且索引 < 骨骼数 (部分 MDL 顶点布局不同, 蒙皮数据不可靠
        // → 回退绑定姿态, 避免垃圾权重把顶点炸飞)
        if (!mesh._skinOK) return mesh.positions.map((p) => [p[0] + cxs, p[1] + cys, p[2]]);
        // P1-10: bind 链 (bindWorld/bindInv/bindRT) 按 mesh 缓存 — 全部由 MDLS
        // 静态骨骼矩阵推导, 与 t/layers 无关 (旧实现每帧重建+全矩阵求逆)
        const bindRT = this._ensureBindRig(mesh);
        const bindInv = mesh._bindInv;
        // final 世界 = bind, 逐层合成
        const final = bindRT.map((r) => ({ angle: r.angle, tx: r.tx, ty: r.ty, sx: r.sx, sy: r.sy, tz: r.tz }));
        // A3: fps 从 MDLA 头读出 (0<fps≤240 校验, 解析回退 30) — 旧硬编码 30 在
        // fps≠30 模型上播放速度错。每层取其动画自己的 fps。
        const fpsOf = (an) => (an && Number.isFinite(an.fps) && an.fps > 0 ? an.fps : 30);
        // additive 参考姿势缓存: 每动画帧0 世界 (部分模型骨骼帧0≠bind 数十单位,
        // 用 bind 作 ref 会让 additive 在帧0 就有常数偏移 → 角色蒙皮飞走数百单位;
        // 正确 ref = 层动画自己的帧0, 帧0=bind 的模型等价)
        const refCache = new Map();
        const animRef = (anim) => {
          if (!refCache.has(anim)) refCache.set(anim, this._sampleAnimRT(mesh, anim, 0, nb, bones));
          return refCache.get(anim);
        };
        for (const layer of layers) {
          const anim = mesh.animations[layer.animIdx] || mesh.animations[0];
          if (!anim) continue;
          // 帧: 动画 fps 循环; 层 rate 加速播放 (高光层 rate>1, 呼吸层 rate<1)
          const frame = Math.floor(t * fpsOf(anim) * layer.rate) % Math.max(1, anim.frameCount);
          const lw = this._sampleAnimRT(mesh, anim, frame, nb, bones);
          const refRT = animRef(anim);
          for (let b = 0; b < nb; b++) {
            if (layer.additive) {
              // additive: final += (layerWorld − 层帧0)×blend (ref = 层动画帧0 世界)
              const ref = refRT[b];
              let da = lw[b].angle - ref.angle;
              while (da > Math.PI) da -= 2 * Math.PI;
              while (da < -Math.PI) da += 2 * Math.PI;
              final[b].angle += da * layer.blend;
              final[b].tx += (lw[b].tx - ref.tx) * layer.blend;
              final[b].ty += (lw[b].ty - ref.ty) * layer.blend;
            } else {
              // 普通层: final = mix(final, layerWorld, blend)
              let da = lw[b].angle - final[b].angle;
              while (da > Math.PI) da -= 2 * Math.PI;
              while (da < -Math.PI) da += 2 * Math.PI;
              final[b].angle += da * layer.blend;
              final[b].tx += (lw[b].tx - final[b].tx) * layer.blend;
              final[b].ty += (lw[b].ty - final[b].ty) * layer.blend;
            }
          }
        }
        // 蒙皮矩阵: g_Bones[b] = bindInv[b] × finalWorld[b]
        // MOD-01: 行向量约定 p·(A×B) = (p·A)·B (左因子先应用), 线性蒙皮
        // p_world = final(bindInv(p)) → 复合必须是 bindInv×final。
        // 旧实现 final×bindInv 把最终姿势先应用 → 旋转骨骼绕模型原点公转
        // 而非绕自身枢轴 (复现: bind=R90°+t(10,0), final=R180°+t(10,0),
        // 顶点 (11,0) → 旧 (0,11), 正确 (10,1); 绑定平移偏差 |R−I|·t_b)。
        const gBones = new Array(nb);
        for (let b = 0; b < nb; b++) {
          const c = Math.cos(final[b].angle), s = Math.sin(final[b].angle);
          const sx = final[b].sx || 1, sy = final[b].sy || 1;
          // [S·Rz | T]: [c·sx, s·sx, 0, 0, -s·sy, c·sy, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]
          // (MOD-09: 缩放/Z 来自 bind 分解, 动画只驱动 角度+平移)
          const m = [c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, 1, 0, final[b].tx, final[b].ty, final[b].tz || 0, 1];
          gBones[b] = this._matMulRow(bindInv[b], m);
        }
        // 顶点蒙皮
        // P1-10: 输出顶点缓冲按 mesh 复用 (旧每帧 new n 个 3 元数组)。调用方
        // (_meshBounds/_rasterizeMesh) 同步只读、不跨渲染持有 → 原地改写安全
        if (!mesh._skinOut || mesh._skinOut.length !== mesh.positions.length) {
          mesh._skinOut = new Array(mesh.positions.length);
          for (let i = 0; i < mesh.positions.length; i++) mesh._skinOut[i] = [0, 0, 0];
        }
        const out = mesh._skinOut;
        for (let i = 0; i < mesh.positions.length; i++) {
          const p = mesh.positions[i];
          const bi = mesh.blendIndices[i];
          const bw = mesh.blendWeights[i];
          let x = 0, y = 0, z = 0;
          for (let k = 0; k < 4; k++) {
            const w = bw[k];
            if (w === 0) continue;
            const m = gBones[bi[k]] || gBones[0];
            // 行向量右乘: [x,y,z,1] × M
            const px = p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12];
            const py = p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13];
            const pz = p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14];
            x += px * w; y += py * w; z += pz * w;
          }
          const o = out[i];
          o[0] = x + cxs; o[1] = y + cys; o[2] = z;
        }
        return out;
      }
    
      // 采样动画帧 → 每骨骼世界姿势 {angle, tx, ty}
      // MDLA 段布局 (逆向自 32 骨骼与 6 骨骼模型, 9 列循环交错):
      //   骨骼 b 的 pos = 段 b 帧 floor(2b/9) 列 (2b)%9,(2b+1)%9 (col9 跨下一段)
      //   骨骼 b 的 rot = 段 b 帧 floor(2b/9)+floor((2b+5)/9) 列 (2b+5)%9
      //   段帧循环 (frameCount+1) 帧; rot 为弧度 (bind 矩阵旋转角一致)
      // sf45: 段表实际有 fc+1 行 (segBytes=(fc+1)×36), 末行 = 循环闭合行。
      //   旧实现 (frame+shift) % frameCount 把溢出行回绕到行 0 — 交错布局下
      //   行 0 的列归属与溢出行不同 (03腿-下 骨2 rot=col0: 行0 col0 是错槽值
      //   1.0, 闭合行 210 col0 才是正确 0.0) → 循环末尾 shift 帧读到脏值,
      //   表现为 3735447194 鞋子每周期闪跳 ~57° (用户实证)。
      //   溢出行必须钳到闭合行 fc, 不许回绕行 0。
      // 2D 世界链乘: 角度相加, 平移 = 父平移 + Rz(父角度)·局部平移
      //
      // MOD-05 (待实测, 暂不改索引): 按上述自述布局, 通道存在两处冲突 —
      //  ① 列重叠: b=2 的 pos 占 (行f, 列4-5), b=0 的 rot 占 (行f, 列5-6) →
      //     行 f 的 float5 同时被 bone2.pos.y 与 bone0.rot.x 读取;
      //  ② 帧错位: b=31 时 posShift=6、rotShift=7 → pos 取自帧 (f+6)%N 而 rot
      //     取自帧 (f+13)%N, 同一逻辑帧的 pos/rot 相差最多 7 帧。
      //  该布局下两块已验证模型渲染正确 (布局猜测对其成立), 贸然改索引会回归;
      //  需 2-3 个已知骨数模型的 hexdump 重推帧 stride 后再修 (含通道连续性单测)。
,
    _sampleAnimRT(mesh, anim, frame, nb, bones) {
        // P1-10/N-14: 纯函数记忆 — 只读 mesh.raw/bones.bind (MDL 静态数据), 同
        // (anim, frame) 结果恒定 → 按 anim 记忆 (条目数 ≤ frameCount, 有界)。
        // 返回数组全部调用方只读 (蒙皮合成/锚点位姿), 共享安全
        if (!anim._rtCache) anim._rtCache = new Map();
        const cached = anim._rtCache.get(frame);
        if (cached) return cached;
        const out = new Array(nb);
        const dv = new DataView(mesh.raw.buffer, mesh.raw.byteOffset, mesh.raw.byteLength);
        const totalFrames = Math.max(1, anim.frameCount);
        // sf45: 溢出行钳到闭合行 (fc), 见上方布局注释
        const rowOf = (v) => (v >= totalFrames ? totalFrames : v);
        for (let b = 0; b < nb; b++) {
          const segStart = anim.segs[b];
          const b2 = 2 * b;
          const posShift = Math.floor(b2 / 9);
          const posCol = b2 % 9;
          const frame0 = rowOf(frame + posShift) * 36;
          const o = segStart + frame0 + posCol * 4;
          const px = dv.getFloat32(o, true);
          const py = dv.getFloat32(o + 4, true);
          // rot: 列 (2b+5)%9, 段帧 posShift + floor((2b+5)/9)
          const rotShift = Math.floor((b2 + 5) / 9);
          const rotCol = (b2 + 5) % 9;
          const o2 = segStart + rowOf(frame + posShift + rotShift) * 36 + rotCol * 4;
          const rotZ = dv.getFloat32(o2, true);
          // pos 合理性校验 (有限 + 量级 < 10000), 异常则用绑定局部矩阵 (绑定姿态, 不炸)
          const parent = bones[b].parent;
          if (isFinite(px) && isFinite(py) && Math.abs(px) < 10000 && Math.abs(py) < 10000 && isFinite(rotZ)) {
            if (parent >= 0 && parent < nb && out[parent]) {
              const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa);
              out[b] = {
                angle: pa + rotZ,
                tx: out[parent].tx + px * pc - py * ps,
                ty: out[parent].ty + px * ps + py * pc,
              };
            } else {
              out[b] = { angle: rotZ, tx: px, ty: py };
            }
          } else {
            const bm = bones[b].bind;
            if (parent >= 0 && parent < nb && out[parent]) {
              const pa = out[parent].angle, pc = Math.cos(pa), ps = Math.sin(pa);
              out[b] = {
                angle: pa + Math.atan2(bm[1], bm[0]),
                tx: out[parent].tx + bm[12] * pc - bm[13] * ps,
                ty: out[parent].ty + bm[12] * ps + bm[13] * pc,
              };
            } else {
              out[b] = { angle: Math.atan2(bm[1], bm[0]), tx: bm[12], ty: bm[13] };
            }
          }
        }
        anim._rtCache.set(frame, out);
        return out;
      }
    
      // 行主序 4x4 矩阵乘法 a × b
,
    _matMulRow(a, b) {
        const o = new Array(16);
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 4; c++) {
            o[r * 4 + c] = a[r * 4 + 0] * b[0 * 4 + c] + a[r * 4 + 1] * b[1 * 4 + c] + a[r * 4 + 2] * b[2 * 4 + c] + a[r * 4 + 3] * b[3 * 4 + c];
          }
        }
        return o;
      }
    
      // 行主序 4x4 仿射逆 (2D 旋转+缩放求逆 + 平移取反; MOD-09: 旧实现纯旋转
      // 转置, bind 带缩放时 bind×bindInv≠I → 蒙皮错位。单位旋转下与旧式逐位一致)
,
    _matInvertRow(m) {
        const o = new Array(16).fill(0);
        // 2D 线性块 [[m0,m1],[m4,m5]] (第三轴恒等): 伴随矩阵法求逆
        const det = m[0] * m[5] - m[1] * m[4];
        if (!isFinite(det) || Math.abs(det) < 1e-12) {
          // 奇异 (含镜像退化) → 回退纯旋转转置 (旧行为, 不炸)
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = m[c * 4 + r];
          o[15] = 1;
          o[12] = -(m[12] * o[0] + m[13] * o[4] + m[14] * o[8]);
          o[13] = -(m[12] * o[1] + m[13] * o[5] + m[14] * o[9]);
          o[14] = -(m[12] * o[2] + m[13] * o[6] + m[14] * o[10]);
          return o;
        }
        o[0] = m[5] / det; o[1] = -m[1] / det;
        o[4] = -m[4] / det; o[5] = m[0] / det;
        o[10] = 1; o[15] = 1;
        o[12] = -(m[12] * o[0] + m[13] * o[4]);
        o[13] = -(m[12] * o[1] + m[13] * o[5]);
        o[14] = -m[14];
        return o;
      }
    
,
    _parseMdl(buf) {
        // sf42: Uint8Array.indexOf(字符串) 恒 -1 (类型强转 NaN) — pkgSceneAccess
        // 路径 (GL payload 导出) 传入 Uint8Array, MDLA/MDLE 段永远找不到 →
        // 动画空 → 恒绑定姿态 (木偶失效根因)。统一转 Buffer 使字符串段搜索
        // 在两条路径 (CPU Buffer / GL Uint8Array) 一致。
        if (!(buf instanceof Buffer)) {
          buf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        let mdlsOffset = buf.length;
        for (let off = 9; off + 4 < buf.length; off++) {
          if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
        }
        // 顶点块: 先按 80B 记录扫 (库内 36 个文件的主路径, 条件与旧实现逐条一致);
        // 失败再按 52B 紧凑记录扫 (MDLV0013/0016 家族 — 旧容器, 见 _scanVertexBlock)。
        let found = this._scanVertexBlock(dv, buf, mdlsOffset, MDL_VERTEX_STRIDE80);
        let legacyContainer = false;
        if (!found) {
          found = this._scanVertexBlock(dv, buf, mdlsOffset, MDL_VERTEX_COMPACT52);
          legacyContainer = !!found;
        }
        if (!found) return null;
        const layout = found.layout;
        const vertexCount = found.vertexBytes / layout.stride;
        const indexCount = found.indexBytes / 2;
        const positions = [], uvs = [], blendIndices = [], blendWeights = [];
        for (let i = 0; i < vertexCount; i++) {
          const vo = found.verticesOffset + i * layout.stride;
          positions.push([dv.getFloat32(vo, true), dv.getFloat32(vo + 4, true), dv.getFloat32(vo + 8, true)]);
          uvs.push([dv.getFloat32(vo + layout.uv, true), dv.getFloat32(vo + layout.uv + 4, true)]);
          blendIndices.push([0, 1, 2, 3].map((k) => dv.getUint32(vo + layout.blend + k * 4, true)));
          blendWeights.push([0, 1, 2, 3].map((k) => dv.getFloat32(vo + layout.weight + k * 4, true)));
        }
        const indices = [];
        for (let i = 0; i < indexCount; i++) indices.push(dv.getUint16(found.indicesOffset + i * 2, true));
        // 骨骼 (MDLS) + 动画 (MDLA): puppet 蒙皮
        let bones = [], animations = [];
        if (mdlsOffset < buf.length) {
          // MOD-06: 逐骨骼 try/catch — 单骨畸形只跳过该骨 (蒙皮退化为该骨权重
          // 落 gBones[0] 兜底), 不再整体丢弃全部骨骼退回绑定姿态; 外层 try 保留
          // 兜底缓冲级异常。
          try {
            let p = mdlsOffset + 9;
            p += 4; // 段字节
            const boneCount = dv.getUint32(p, true); p += 4;
            for (let b = 0; b < boneCount && p + 12 < buf.length; b++) {
              try {
                // 骨骼头变体: 大部分 tmp 为 u8 (9 字节头); 个别骨骼 (带旋转/特殊) tmp 为 u16 (10 字节头)
                // 用 entryLen 合理性 (0 < len <= 4096) 判断; 不合法则按 u16 tmp 重读
                let headExtra = 0;
                let tmp = buf[p];
                let type = dv.getUint32(p + 1, true);
                let parent = dv.getInt32(p + 5, true);
                let len = dv.getUint32(p + 9, true);
                if (len === 0 || len > 4096) {
                  tmp = dv.getUint16(p, true);
                  type = dv.getUint32(p + 2, true);
                  parent = dv.getInt32(p + 6, true);
                  len = dv.getUint32(p + 10, true);
                  headExtra = 1;
                  if (len === 0 || len > 4096) break; // 无法对齐
                }
                p += 9 + headExtra; // tmp + type + parent 之后 (len 字段起点)
                p += 4; // len 字段本身
                // MOD-06: 64B 矩阵读取越界检查 (旧循环条件只查 p+12, 读 16 个
                // float32 需要 p+64 ≤ len, 越界 DataView 抛错 → 旧实现丢全部骨骼)
                if (p + 64 > buf.length) {
                  this.log('MDLS 骨骼 ' + b + ' 矩阵越界, 停止解析 (已得 ' + bones.length + '/' + boneCount + ')');
                  if (typeof this.onDegraded === 'function') {
                    try { this.onDegraded({ object: 'puppet-mdl', feature: 'mdl-bones', action: 'bone-matrix-out-of-bounds' }); } catch { /* 回调失败不影响渲染 */ }
                  }
                  break;
                }
                const m = new Array(16);
                for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(p + i * 4, true);
                p += len;
                // SF54: 骨骼条目尾部 = [0x00][名字] — **名字没有终止符**, 直接接
                // 下一根骨骼的 9 字节头 (实测 "legs"/"skirt"… 后紧跟 tmp/type/
                // parent)。旧实现只跳过第一个 0x00 就落到名字上 → 从第二根起
                // 头全错、循环很快越界退出 (3463520581 `asuna body bottom` 声明
                // 7 根只解析出 1 根 → 蒙皮 bind 链/锚点骨骼位姿全缺, 部件错位)。
                // 无名骨骼 (仅 0x00) 时旧逻辑恰好正确, 故必须按"下一个合法头"
                // 定位而非按固定字节数。
                p = this._nextBoneHeader(dv, buf, p, b + 1);
                bones.push({ index: b, type, parent: parent === -1 ? -1 : parent, bind: m });
              } catch (e) {
                // MOD-06: 单骨畸形 → 跳过继续 (boneCount 上界保证循环终止)
                this.log('MDLS 骨骼 ' + b + ' 解析失败已跳过: ' + (e && e.message));
              }
            }
          } catch (e) { this.log('MDLS 解析失败: ' + (e && e.message)); }
          // MDLA 动画
          const mdla = buf.indexOf('MDLA');
          if (mdla >= 0) {
            try {
              let p = mdla + 9;
              p += 4; // 总字节
              const animCount = dv.getUint32(p, true); p += 4;
              for (let a = 0; a < animCount && p + 12 < buf.length; a++) {
                p += 8; // u32 + u32 0
                const nameEnd = buf.indexOf(0, p);
                if (nameEnd < 0) break;
                const animName = buf.toString('utf8', p, nameEnd);
                p = nameEnd + 1;
                const loopEnd = buf.indexOf(0, p);
                if (loopEnd < 0) break;
                p = loopEnd + 1;
                // 找 [f0 41] 前缀
                // MOD-04 (豁免, 仅注释): 0xF0 0x41 是 float32 30.0 的低半字节魔数
                // 扫描 — 可能在真头之前撞上任意 41 F0 数据 (静默错位 frameCount/
                // boneCount, 仅靠下方每浮点合理性校验兜底), 且扫到后不读 fps 浮点。
                // 锚定到已解析头偏移 + 读出 fps (0<fps≤240 校验, 回退 30) 待实测布局后改。
                while (p + 1 < buf.length && !(buf[p] === 0xf0 && buf[p + 1] === 0x41)) p++;
                // A3: [f0 41] = float32 30.0 的高半字节 — 该 4 字节即 MDLA 帧率
                // 字段 (魔数扫描点前 2 字节起始)。读出并校验 (0<fps≤240), 非法回退 30。
                const fpsRaw = dv.getFloat32(p - 2, true);
                const fps = Number.isFinite(fpsRaw) && fpsRaw > 0 && fpsRaw <= 240 ? fpsRaw : 30;
                p += 2;
                const frameCount = dv.getUint16(p, true); p += 2;
                p += 2; // u16 0
                p += 4; // u32 0
                const boneCount = dv.getUint32(p, true); p += 4;
                p += 4; // u32 0
                const segBytes = dv.getUint32(p, true); p += 4;
                const segs = [];
                for (let b = 0; b < boneCount && p + (b + 1) * segBytes <= buf.length; b++) segs.push(p + b * segBytes);
                animations.push({ name: animName, frameCount, boneCount, segBytes, segs, fps });
                p += segBytes * boneCount;
              }
            } catch { animations = []; }
          }
          // MDLE0002 (骨骼扩展矩阵, 每骨骼 64B, IK/约束相关 — 逆向自 wallpaper64.exe)
          // 结构: [MDLE0002\0][u32 段尾偏移][u32 骨骼矩阵字节 = 骨数×64][每骨骼 64B 矩阵×骨数]
          const mdle = buf.indexOf('MDLE');
          if (mdle >= 0) {
            try {
              const tail = dv.getUint32(mdle + 9, true);
              const matBytes = dv.getUint32(mdle + 13, true);
              const n = matBytes > 0 ? matBytes / 64 : 0;
              const mats = [];
              for (let b = 0; b < Math.min(n, 256); b++) {
                const mo = mdle + 17 + b * 64;
                const m = new Array(16);
                for (let i = 0; i < 16; i++) m[i] = dv.getFloat32(mo + i * 4, true);
                mats.push(m);
              }
              bones.forEach((b, i) => { if (mats[i]) b.extend = mats[i]; });
            } catch { /* 扩展段解析失败不影响 */ }
          }
        }
        // 旧容器 (MDLV0013/0016) 的 MDLA: 单独通道, 只提供静态装配姿态。
        // 为什么需要它: 旧容器的 MDLS bind 是**图集排版姿态** (部件按 UV 摊在 atlas
        // 上, 如 2686862510 的斗篷/左右披风片散列在图集上/下/左右边缘), 渲染姿态
        // 来自 MDLA 首帧; 新容器 (MDLV0021/0023) 两姿态实测一致 (≤0.03 单位), 旧容器
        // 则差 285~800 单位 → 旧容器不按首帧装配就会出现"部件脱离人物"。
        let legacyAnim = null;
        if (legacyContainer) {
          const mdlaLegacy = buf.indexOf('MDLA');
          if (mdlaLegacy >= 0) legacyAnim = this._parseLegacyMdla(dv, buf, mdlaLegacy);
          // 逐帧动画不进物化: 新容器 _sampleAnimRT 的列交错规则 ((2b+5)%9 等) 对
          // "单骨整段 + 每骨 8B 段头" 的旧容器排布不成立 — 未实测验证前不喂给动画层,
          // 旧容器只走静态首帧装配 (既有 36 个新容器文件的行为逐位不变)。
          animations = [];
        }
        return { positions, uvs, indices, vertexCount, indexCount, blendIndices, blendWeights, bones, animations, legacyAnim, legacyContainer, raw: buf };
      }
    
      // ── 静态 MDL (MDLV0014 非 puppet 变体) 解析 ────────────────────────
      // 结构: "MDLV0014" + 头部 + "materials/....json\0" + u32 标志 + u32 顶点字节数
      //       + 顶点流 (stride 32: pos/normal/uv; stride 64: pos/normal/tangent/uv)
      //       + u32 索引字节数 + u16 索引流
,
  });
}
