// WE 渲染引擎 — scene 层: 变换解析 (TRS 父链累积 + MDAT 锚点 + puppet 骨骼位姿)
// 官方对应: CImage::resolveTransform (lwe CImage.cpp:156-164 语义) + wallpaper64.exe
// 的 MDAT0001 锚点解析 (u16 计数 + [u16 骨骼索引 + 名字\0 + 64B 矩阵] 列表)
// P1 重构: 从 core.js 拆出, 纯搬家零行为变化
import { parseVec3, getVal } from '../math.js';

export function installTransform(proto) {
  Object.assign(proto, {
    // MDAT0001 锚点 (官方引擎确认: wallpaper64.exe 解析 MDAT0001 = u16 计数 +
    // [u16 骨骼索引 + 名字\0 + 64B 矩阵] 列表; 场景对象 attachment 字段匹配锚点名字):
    // 子对象 origin 相对父 puppet 命名锚点定位 → 有效子原点 = 锚点偏移 + 自身 origin。
    // (如 attachment="身体：头" 等锚点名字与父 puppet MDL 的 MDAT 锚点精确匹配)
    _mdlAnchors(model) {
      if (!model || !model.puppet) return null;
      if (!this._anchorCache) this._anchorCache = new Map();
      if (this._anchorCache.has(model.puppet)) return this._anchorCache.get(model.puppet);
      const raw = this.pkg.read(model.puppet);
      const out = [];
      if (raw) {
        try {
          const buf = Buffer.from(raw);
          for (let idx = buf.indexOf('MDAT'); idx >= 0; idx = buf.indexOf('MDAT', idx + 4)) {
            if (buf.toString('utf8', idx, idx + 8) !== 'MDAT0001') continue;
            let p = idx + 9 + 4;
            const count = buf.readUInt16LE(p); p += 2;
            for (let e = 0; e < count && e < 64 && p + 2 < buf.length; e++) {
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
          }
        } catch { /* 解析失败 → 无锚点 */ }
      }
      this._anchorCache.set(model.puppet, out);
      return out;
    },

    // puppet 骨骼最终世界位姿 (绑定 + 动画层合成, 与 _skinPuppet 同逻辑) —
    // attachment 锚点跟随动画骨骼 (锚点矩阵相对骨骼局部, 旋角 0 时直接加平移)
    _puppetBoneFinal(mesh, t, layers = null) {
      const bones = mesh.bones;
      if (!bones || !bones.length) return null;
      const nb = bones.length;
      const bindWorld = new Array(nb);
      for (let b = 0; b < nb; b++) {
        const parent = bones[b].parent;
        const local = bones[b].bind;
        bindWorld[b] = parent >= 0 && parent < nb && bindWorld[parent] ? this._matMulRow(bindWorld[parent], local) : local;
      }
      const bindRT = bindWorld.map((m) => ({ angle: Math.atan2(m[1], m[0]), tx: m[12], ty: m[13] }));
      const final = bindRT.map((r) => ({ angle: r.angle, tx: r.tx, ty: r.ty }));
      if (!mesh.animations || !mesh.animations.length) return final;
      if (!layers || !layers.length) layers = [{ animIdx: 0, blend: 1, rate: 1, additive: false }];
      // 帧率: 官方 frame = t × 动画fps (MDLA fps 字段; 旧硬编码 30 让 60fps 动画半速)
      // additive 参考 = 层动画帧0 (帧0≠bind 时用 bind 会让角色飞走; 帧0=bind 的模型等价)
      const refCache = new Map();
      const animRef = (anim) => {
        if (!refCache.has(anim)) refCache.set(anim, this._sampleAnimRT(mesh, anim, 0, nb, bones));
        return refCache.get(anim);
      };
      for (const layer of layers) {
        const anim = mesh.animations[layer.animIdx] || mesh.animations[0];
        if (!anim) continue;
        const fps = anim.fps > 0 ? anim.fps : 30;
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
    },

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
                // 层 animation 字段 = MDLA 动画 ID (如 4327) → 按 id 匹配
                if (idx < 0 && l.animation != null) {
                  const lid = Number(l.animation);
                  const byId = mesh.animations.findIndex((a) => a.id === lid);
                  if (byId >= 0) idx = byId;
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
    },

    resolveTransform(o) {
      // 注意: scene.json 的 angles 单位 = **弧度**（2026-08-30 实测确认: 3554161528
      // 场景 "裙子底" angles.z=0.14317≈8.2°、"notes1_simple"=0.51322≈29.4°, 小数值
      // 只可能是弧度; WE 编辑器里显示角度但文件存弧度）。因此本函数直接对 ang
      // 做 Math.cos/sin（弧度）, image.js 的 blitRotated 也直接收弧度, 无需换算。
      // 旋转方向约定 (静态核验 2026-08-30): 官方 common.h rotateVec2 = 标准逆时针
      // [[cos,-sin],[sin,cos]]; lwe 参考实现 (CImage.cpp:1097-1103) 对 quad 用
      // R(-angle) 绕 Z (注释: 为补偿 Y-flip) → 场景 y-up 下顺时针; 本插件 canvas
      // y-down 下 +angle = 顺时针, 与 lwe 视觉等价。官方 2D 图像矩阵的确切符号
      // 未能从反编译片段完全闭合 (无实机验证能力), 以"与 lwe 一致"为准 (若端到端
      // 符号反了, 8° 级旋转会在所有场景明显可见, 与现状不符)。
      // 收集链 (叶到根)
      const chain = [o];
      let cur = o;
      let guard = 0;
      while (cur.parent != null && guard < 32) {
        const parent = this.objects.find((x) => x.id === cur.parent);
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
    },
  });
}
