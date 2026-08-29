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

// access = pkgSceneAccess 形态 ({readFile(p)→{bytes}|null}); modelJson = 模型
// json ({puppet: '<mdl path>'}); 返回 JSON-safe payload | null (解析失败)。
export function buildPuppetPayload(access, modelJson) {
  if (!modelJson || typeof modelJson.puppet !== 'string' || !modelJson.puppet) return null;
  const f = access.readFile(modelJson.puppet);
  if (!f || !f.bytes) return null;
  // 裸 proto: mixin 方法只依赖 pkg/log/onDegraded (parse 路径), 每次新建 —
  // mesh 缓存 (_mdlCache) 挂 this, 跨调用串缓会张冠李戴, 不可单例。
  const proto = {};
  installPuppet(proto);
  proto.pkg = { read: (p) => { const g = access.readFile(p); return g ? g.bytes : null; } };
  proto.log = () => {};
  proto.onDegraded = null;
  const mesh = proto._parseMdl(f.bytes);
  if (!mesh || !mesh.vertexCount) return null;

  // 平铺几何 (JSON 数组; 本地 puppet 网格 ≤500 顶点, 体积可忽略)
  const positions = new Array(mesh.vertexCount * 3);
  const uvs = new Array(mesh.vertexCount * 2);
  const blendIndices = new Array(mesh.vertexCount * 4);
  const blendWeights = new Array(mesh.vertexCount * 4);
  for (let i = 0; i < mesh.vertexCount; i++) {
    positions[i * 3] = mesh.positions[i][0];
    positions[i * 3 + 1] = mesh.positions[i][1];
    positions[i * 3 + 2] = mesh.positions[i][2];
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
  if (nb > 0 && mesh.animations.length) {
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
      payload.animations.push({ name: anim.name || '', frameCount: fc, rt });
    }
  }
  return payload;
}
