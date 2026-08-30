// WE 渲染引擎 — particles (从 core.js 拆分, 逻辑不变)
import { parseVec3, getVal } from './math.js';

// ── 湍流确定性噪声 (移植自参照实现 NoiseUtils.h) ──
// 官方 CParticle.cpp:1249-1285 + NoiseUtils.h:130-149: 湍流 = 固定 Perlin 置换表
// 的确定性 curl noise 场 — 同粒子同 t 必得同结果, 无任何逐步随机。简化为 2D
// (官方 mask 默认 (1,1,0), z 分量被屏蔽)。
// Perlin 置换表 (照抄 NoiseUtils.h PERLIN_PERM 前 256 项, 尾部重复一份供回绕,
// 与 C 表 512 项等价)
const PERLIN_BASE = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
const PERLIN_PERM = PERLIN_BASE.concat(PERLIN_BASE);

// 梯度函数 (NoiseUtils.h perlinGrad 的 z=0 化简, 含原表 0xD/-y+z 写法)
function perlinGrad2(hash, x, y) {
  switch (hash & 0xF) {
    case 0x0: return x + y; case 0x1: return -x + y; case 0x2: return x - y; case 0x3: return -x - y;
    case 0x4: return x; case 0x5: return -x; case 0x6: return x; case 0x7: return -x;
    case 0x8: return y; case 0x9: return -y; case 0xA: return y; case 0xB: return -y;
    case 0xC: return y + x; case 0xD: return -y; case 0xE: return y - x; default: return -y;
  }
}
// 缓动曲线 6t^5-15t^4+10t^3 (NoiseUtils.h perlinEase)
function perlinEase(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
// 2D Perlin 噪声 (perlinNoise(x, y, 0) 的等价化简: w=ease(0)=0, z 向插值坍缩)
function perlin2D(x, y) {
  const fx = Math.floor(x), fy = Math.floor(y);
  const xi = fx & 255, yi = fy & 255;
  const xf = x - fx, yf = y - fy;
  const u = perlinEase(xf), v = perlinEase(yf);
  const A = PERLIN_PERM[xi] + yi, B = PERLIN_PERM[xi + 1] + yi;
  const lerp = (t, a, b) => a + t * (b - a);
  return lerp(v,
    lerp(u, perlinGrad2(PERLIN_PERM[PERLIN_PERM[A]], xf, yf), perlinGrad2(PERLIN_PERM[PERLIN_PERM[B]], xf - 1, yf)),
    lerp(u, perlinGrad2(PERLIN_PERM[PERLIN_PERM[A + 1]], xf, yf - 1), perlinGrad2(PERLIN_PERM[PERLIN_PERM[B + 1]], xf - 1, yf - 1)));
}
// 2D 数值旋度 (中心差分): curl = (∂ψ/∂y, -∂ψ/∂x) — 无散度, 旋涡状流场
function curl2D(x, y) {
  const e = 1e-4; // 同 NoiseUtils.h curlNoise 步长
  return [(perlin2D(x, y + e) - perlin2D(x, y - e)) / (2 * e),
          -(perlin2D(x + e, y) - perlin2D(x - e, y)) / (2 * e)];
}

// ── particles mixin (从 core.js 拆分, 逻辑零改动) ──
export function installParticles(proto) {
  Object.assign(proto, {
    renderParticleSystem(o, t) {
        // 读取粒子定义 (文件或内联)
        let def = null;
        const particleVal = o.particle;
        if (typeof particleVal === 'string') {
          def = this.pkg.readJson(particleVal);
        } else if (typeof particleVal === 'object') {
          def = particleVal;
        }
        if (!def) return;
        // P1-9: 显式确定性 rng — 旧实现模拟期全局替换 Math.random, 实际消费点只有
        // oscillate* 算子 (经 _applyOperator 显式取 sys.rng), 序列逐位同构
        const sys = this._buildParticleSystem(o, def);
        if (!sys) return;
        this._simulateParticleSystem(sys, t);
        this._drawParticles(sys);
      }

,
    _buildParticleSystem(o, def) {
        const tr = this.resolveTransform(o);
        const inst = o.instanceoverride || {};
        const alphaMul = getVal(inst, 'alpha', 1);
        const rateMul = getVal(inst, 'rate', 1);
        // sf41c: instanceoverride 乘子族 (官方 lwe 同款; count 为 rate 的对象级
        // 别名)。CPU/GL/manifest 三处同步消费。
        const lifetimeMul = getVal(inst, 'lifetime', 1);
        const speedMul = getVal(inst, 'speed', 1);
        const sizeMul = getVal(inst, 'size', 1);
        const countMul = getVal(inst, 'count', null);
        const colorMul = parseVec3(getVal(inst, 'colorn', '1 1 1'), [1, 1, 1]);
        // P1-9: 构建级缓存按对象 (参照 _mdlCache 模式)。静态部分 = emitter/
        // initializer/operator 预解析 + 材质/纹理/投影常量; pkg JSON 不可变,
        // 内联 def 被脚本写回时是整体换引用 → def 引用比对即失效重建。
        // 种子每帧重算 (短字符串 hash, 开销可忽略) 并参与键比对 — 旧实现
        // 每帧 _particleRng(o) 重算种子, 此处逐帧语义保持一致。
        // 动态部分 (变换/实例覆盖/运行态) 每帧照旧取当前值 — 与旧"每帧全量
        // 重建"逐位等价。
        const seed = this._particleSeed(o);
        if (!this._particleBuildCache) this._particleBuildCache = new Map();
        let b = this._particleBuildCache.get(o);
        if (!b || b.def !== def || b.seed !== seed) {
          let draws = 0;
          // 计数 wrapper: 记录构建期消耗的 rng 抽数 (turbulence turbSpeed/phase)
          const rng = this._particleRngFromSeed(seed);
          const counting = () => { draws++; return rng(); };
          b = this._buildParticleSystemInner(o, def, { scale: tr.scale, angle: tr.angle, rng: counting });
          b.def = def;
          b.seed = seed;
          b.rngDraws = draws;
          this._particleBuildCache.set(o, b);
        }
        // 每帧新 rng 回放到"构建后"状态 (重放同数抽数 → 发射/初始器随机序列
        // 与旧每帧新 rng 逐位同构); 发射器运行态复位 (scale/angle 为当前帧值)
        const rng = this._particleRngFromSeed(b.seed);
        for (let i = 0; i < b.rngDraws; i++) rng();
        for (const em of b.emitters) { em.scale = tr.scale; em.angle = tr.angle; em.acc = 0; em._emitted = false; }
        return {
          o, origin: tr.origin, scale: tr.scale, angle: tr.angle, alphaMul, rateMul: countMul != null ? countMul : rateMul,
          // sf48: 官方粒子 size 语义 — 局部空间扩展后过模型矩阵 (官方
          // genericparticle.vert: ComputeParticlePosition 的 size·right/up 是局部
          // 量, 再 × g_MVP 含对象 scale) → 屏幕尺寸 = size × 对象 scale。
          // 3427824116 流星对象 scale 4.31: 子 glow (100..150)/2 × 4.31 = 215..323
          // 场景单位 ≈ 50..76px — 可见流星。旧实现不乘 → glow 12-18px 偏小。
          drawScale: [tr.scale[0] || 1, tr.scale[1] || 1],
          lifetimeMul, speedMul, sizeMul, colorMul,
          maxCount: b.maxCount, emitters: b.emitters, initializers: b.initializers, operators: b.operators,
          tex: b.tex, blending: b.blending, color1: b.color1, color2: b.color2, projScale: b.projScale,
          cps: b.cps, rendererName: b.rendererName,
          // sf50: ropetrail 参数转发 (length 秒历史 / segments 段; 非 trail 为 0)
          trailLength: b.trailLength || 0, trailSegments: b.trailSegments || 0,
          starttime: b.starttime, particles: [], count: 0, rng,
          // sf47: eventfollow 子系统运行态 (世界坐标事件队列 + 子粒子池)
          child: b.child ? {
            maxCount: b.child.maxCount, emitters: b.child.emitters, initializers: b.child.initializers,
            operators: b.child.operators, tex: b.child.tex, blending: b.child.blending,
            projScale: b.child.projScale, color1: b.child.color1, color2: b.child.color2,
            alphaMul: 1, rateMul: 1, lifetimeMul: 1, speedMul: 1, sizeMul: 1, colorMul: [1, 1, 1],
            origin: tr.origin, cps: b.child.cps, rendererName: b.child.rendererName,
            trailLength: b.child.trailLength || 0, trailSegments: b.child.trailSegments || 0,
            particles: [], count: 0, rng, pending: [],
          } : null,
        };
      }

,
    _buildParticleSystemInner(o, def, ctx) {
        const { scale, angle, rng } = ctx;
        const maxCount = def.maxcount || 100;
        const emitters = (def.emitter || []).map((e) => this._parseEmitter(e, scale, angle));
        const initializers = (def.initializer || []).map((i) => this._parseInitializer(i)).filter(Boolean);
        const operators = (def.operator || []).map((op) => this._parseOperator(op, rng)).filter(Boolean);
        // 纹理 + 材质属性 (blending / usershadervalues)
        let tex = null;
        let blending = 'translucent';
        let color1 = [1, 1, 1], color2 = [1, 1, 1];
        if (def.material) {
          const mat = this.pkg.readJson(def.material);
          const pass = mat && mat.passes && mat.passes[0] ? mat.passes[0] : null;
          if (pass) {
            if (pass.textures && pass.textures.length) tex = this.loadTexture(pass.textures[0]);
            if (pass.blending) blending = pass.blending;
            const usv = pass.usershadervalues;
            if (usv) for (const [prop, uniform] of Object.entries(usv)) {
              const v = this.userProps[prop];
              if (uniform === 'color1') color1 = typeof v === 'string' ? parseVec3(v, [1, 1, 1]) : color1;
              else if (uniform === 'color2') color2 = typeof v === 'string' ? parseVec3(v, [1, 1, 1]) : color2;
            }
          }
        }
        // 正交投影缩放: 场景单位 → 画布像素 (原生 ortho(-w/2,w/2,-h/2,h/2) 投影)
        let projScale = null;
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        if (ortho && ortho.width) {
          projScale = [this.W / ortho.width, this.H / (ortho.height || 1080)];
        }
        // P1-9: 返回静态构建物 (不含运行态/rng — 由 _buildParticleSystem 按帧组装)
        // sf41a: 控制点表 (id → {flags, offset}) — controlpointattract 消费
        const cps = new Map();
        for (const c of (Array.isArray(def.controlpoint) ? def.controlpoint : [])) {
          if (c && typeof c === 'object' && c.id != null) {
            const off = parseVec3(c.offset, [0, 0, 0]);
            cps.set(Number(c.id), { flags: Number(c.flags) || 0, offset: [off[0], off[1]] });
          }
        }
        // sf47: eventfollow 子系统 (官方 children 语义 — 父粒子生成事件触发子系统
        // 瞬时爆发; 3427824116 Shooting_Star → shootingstarglow size 100-150 = 流星
        // 可见主体)。静态构建递归一层; 运行态 pending/particles 由外层组装。
        let child = null;
        for (const c of (Array.isArray(def.children) ? def.children : [])) {
          // 实测 (3427824116): 子定义文件在 name 字段 (非 particle), type=eventfollow
          const cFile = typeof c.name === 'string' ? c.name : (typeof c.particle === 'string' ? c.particle : null);
          if (!c || c.type !== 'eventfollow' || !cFile) continue;
          try {
            const cDef = this.pkg.readJson(cFile);
            if (cDef) child = this._buildParticleSystemInner(o, cDef, { scale, angle, rng });
          } catch { /* 子定义不可读 → 无子系统 */ }
          break; // 本仓库语义: 单 eventfollow 子系统
        }
        return {
          maxCount, emitters, initializers, operators, tex, blending, color1, color2, projScale, cps,
          // sf46: rope/ropetrail 渲染器名（链节绘制分流）
          rendererName: (Array.isArray(def.renderer) && def.renderer[0] && def.renderer[0].name) || 'sprite',
          // sf50: ropetrail 参数（官方语义 = 每粒子路径拖尾: length 秒历史 ÷
          // segments 段; lwe ObjectParser.cpp:770-778 默认 length 1.0/segments 4,
          // segments 下限 2 = lwe CParticle.cpp:47 max(2,…)）
          trailLength: (() => {
            const r = Array.isArray(def.renderer) && def.renderer[0];
            if (!r || r.name !== 'ropetrail') return 0;
            const L = Number(r.length);
            return Number.isFinite(L) && L > 0 ? L : 1.0;
          })(),
          trailSegments: (() => {
            const r = Array.isArray(def.renderer) && def.renderer[0];
            if (!r || r.name !== 'ropetrail') return 0;
            const S = Math.round(Number(r.segments));
            return Math.max(2, Number.isFinite(S) && S > 0 ? S : 4);
          })(),
          starttime: def.starttime || 0,
          child,
        };
      }

      // mulberry32 确定性 RNG (种子 = 对象 id + 场景路径 hash)
      // P1-9: 拆为种子计算 + 闭包工厂 — 构建缓存存种子, 每帧新建 rng 并重放
      // 到构建期抽数, 抽序列与旧"每帧新 rng"逐位同构
,
    _particleSeed(o) {
        let seed = 0x9e3779b9;
        const str = String(this.pkgPath) + '|' + (o.id != null ? o.id : o.name || '') + '|' + (o.origin || '');
        for (let i = 0; i < str.length; i++) {
          seed = (seed ^ str.charCodeAt(i)) * 16777619 >>> 0;
        }
        return seed;
      }
,
    _particleRngFromSeed(seed) {
        return () => {
          seed = (seed + 0x6D2B79F5) >>> 0;
          let t = seed;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
    
,
    _parseEmitter(e, scale, angle) {
        const name = e.name || 'boxrandom';
        return {
          name,
          // MOD-26: e.rate || 10 会把显式 rate:0 (burst 专用发射器) 误当缺省变 10
          rate: e.rate ?? 10,
          instantaneous: e.instantaneous || 0,
          delay: e.delay || 0,
          duration: e.duration || 0,
          origin: parseVec3(e.origin, [0, 0, 0]),
          directions: parseVec3(e.directions, [1, 1, 0]),
          distanceMin: parseVec3(e.distancemin, [0, 0, 0]),
          distanceMax: parseVec3(e.distancemax, [256, 256, 0]),
          sign: parseVec3(e.sign, [0, 0, 0]).map((x) => (typeof x === 'number' ? x : 0)),
          speedMin: e.speedmin || 0,
          speedMax: e.speedmax || 0,
          cone: e.cone || 0, // 仅解析保留 — 官方解析但全仓库从未消费 (ObjectParser.cpp:605)
          controlPoint: e.controlpoint != null ? e.controlpoint : -1,
          flags: e.flags || 0,
          // F-2: 每发射器独立小数累加器 (旧实现全系统共享 sys.acc, 跨整数边界
          // 时发射记账被循环中靠后的发射器独占, 低速率前序发射器被饿死)
          acc: 0,
          scale, angle,
        };
      }
    
,
    _parseInitializer(i) {
        const name = i.name || '';
        // P1-9: vec3 参数一次解析挂预处理结构 (旧实现在 _applyInitializer 每次生成
        // 粒子时 parseVec3 — 内循环热路径); getVal 的 user 绑定解析自 userProps,
        // 构造时一次读取、脚本层只拿副本 → 实例内恒定, 跨帧缓存安全
        const p = { name, params: i };
        if (name === 'velocityrandom') {
          p.min = parseVec3(getVal(i, 'min'), [-32, -32, -32]);
          p.max = parseVec3(getVal(i, 'max'), [32, 32, 32]);
        } else if (name === 'rotationrandom') {
          p.min = parseVec3(getVal(i, 'min'), [0, 0, 0]);
          p.max = parseVec3(getVal(i, 'max'), [0, 0, Math.PI * 2]);
        } else if (name === 'angularvelocityrandom') {
          p.min = parseVec3(getVal(i, 'min'), [0, 0, -5]);
          p.max = parseVec3(getVal(i, 'max'), [0, 0, 5]);
        } else if (name === 'colorrandom') {
          const min = parseVec3(getVal(i, 'min'), [0, 0, 0]);
          const max = parseVec3(getVal(i, 'max'), [1, 1, 1]);
          // 引擎初始器值域 0-255, 着色器内归一化到 0..1 (v_Color.r 参与 mix)
          p.k = (max[0] > 1 || max[1] > 1 || max[2] > 1 || min[0] > 1 || min[1] > 1 || min[2] > 1) ? 1 / 255 : 1;
          p.min = min; p.max = max;
        }
        return p;
      }

,
    _parseOperator(op, rng) {
        const name = op.name || '';
        // P1-9: 算子参数一次解析挂预处理结构 (旧实现在 _applyOperator 每步每粒子
        // getVal/parseVec3 — 内循环热路径); turbulence 的 turbSpeed/phase 仍在创建时
        // 随机一次并捕获 (官方语义, 抽数计入 rngDraws 回放)
        const p = { name, params: op };
        if (name === 'turbulence') {
          // 湍流确定性: 官方 CParticle.cpp:1249-1252 — phase/turbSpeed 在算子创建时
          // 随机一次并捕获 (默认 phasemin/max 均为 0, 即无相位偏移), 此后场演化
          // 完全确定。旧实现每步每粒子重抽 rng → 20Hz 白噪抖动, 非官方语义。
          const r = rng || Math.random;
          const sMin = getVal(op, 'speedmin', 500), sMax = getVal(op, 'speedmax', 1000);
          const pMin = getVal(op, 'phasemin', 0), pMax = getVal(op, 'phasemax', 0);
          p.turbSpeed = sMin + r() * (sMax - sMin);
          p.phase = pMin + r() * Math.max(0, pMax - pMin);
          p.scale = getVal(op, 'scale', 0.005);
          p.timeScale = getVal(op, 'timescale', 0.01); // 官方默认 (ObjectParser.cpp:711)
          p.mask = parseVec3(getVal(op, 'mask'), [1, 1, 0]);
        } else if (name === 'movement') {
          p.gravity = parseVec3(getVal(op, 'gravity'), [0, 0, 0]);
          p.drag = getVal(op, 'drag', 0);
        } else if (name === 'angularmovement') {
          p.force = parseVec3(getVal(op, 'force'), [0, 0, 0]);
          p.drag = getVal(op, 'drag', 0);
        } else if (name === 'alphafade') {
          p.fadeIn = getVal(op, 'fadeintime', 0.5);
          p.fadeOut = getVal(op, 'fadeouttime', 0.5);
        } else if (name === 'sizechange' || name === 'alphachange') {
          p.st = getVal(op, 'starttime', 0);
          p.et = getVal(op, 'endtime', 1);
          p.sv = getVal(op, 'startvalue', 1);
          p.ev = getVal(op, 'endvalue', 0);
        } else if (name === 'controlpointattract') {
          // A2 (lwe ObjectParser.cpp:732-736): controlpoint 默认 0, origin (0,0,0),
          // scale 默认 100, threshold 默认 1000 (生效半径 = threshold/2)
          p.cpIdx = getVal(op, 'controlpoint', 0);
          p.cpOrigin = parseVec3(getVal(op, 'origin'), [0, 0, 0]);
          p.attractScale = getVal(op, 'scale', 100);
          p.threshold = getVal(op, 'threshold', 1000) / 2;
        } else if (name === 'oscillatealpha') {
          p.fMin = getVal(op, 'frequencymin', 0); p.fMax = getVal(op, 'frequencymax', 10);
          p.sMin = getVal(op, 'scalemin', 0); p.sMax = getVal(op, 'scalemax', 1);
          p.phMin = getVal(op, 'phasemin', 0); p.phMax = getVal(op, 'phasemax', Math.PI * 2);
        } else if (name === 'oscillatesize') {
          p.fMin = getVal(op, 'frequencymin', 0); p.fMax = getVal(op, 'frequencymax', 10);
          p.sMin = getVal(op, 'scalemin', 0.8); p.sMax = getVal(op, 'scalemax', 1.2);
          p.phMin = getVal(op, 'phasemin', 0); p.phMax = getVal(op, 'phasemax', Math.PI * 2);
        } else if (name === 'oscillateposition') {
          p.fMin = getVal(op, 'frequencymin', 0); p.fMax = getVal(op, 'frequencymax', 5);
          p.sMin = getVal(op, 'scalemin', 0); p.sMax = getVal(op, 'scalemax', 10);
          p.phMin = getVal(op, 'phasemin', 0); p.phMax = getVal(op, 'phasemax', Math.PI * 2);
          p.mask = parseVec3(getVal(op, 'mask'), [1, 1, 0]);
        }
        return p;
      }
    
,
    _simulateParticleSystem(sys, t) {
        // 引擎 starttime: 粒子系统从 starttime 后启动 (t < starttime → 无粒子)
        const st = sys.starttime || 0;
        // 从 0 开始模拟到 t-starttime (静态帧渲染: 一次性推进)。
        // P1-9 (增量模拟未做, 保守取舍): 步长序列 dt=min(1/60, target−simT) 中末段
        // 部分步长依赖到达路径 (直接跳 t 与经中间帧到达的 dt 分解不同), 发射记账
        // em.acc += dt·rate 在整数边界处可因 ULP 级分歧翻转 → 发射颗数/状态路径
        // 相关, 无法保证"同 (sys,t) 任意路径逐位一致" → 保持每帧从 0 重模拟
        // (P1-9 本轮交付构建缓存, 见 _buildParticleSystem)。
        if (sys._simulatedTo == null) sys._simulatedTo = 0;
        let simT = sys._simulatedTo;
        const target = Math.max(0, t - st);
        // MOD-30: 步数上限 × dt 1/60 = 最多模拟 100s, 超出部分直接跳钟
        // (状态冻结在 100s)。上限可配: 渲染器实例属性 particleMaxSeconds
        // (构造后可覆盖, 不动 core.js 构造器), 长循环壁纸调大。
        const maxSeconds = Number(this.particleMaxSeconds) > 0 ? Number(this.particleMaxSeconds) : 100;
        let guard = 0;
        const guardMax = Math.ceil(maxSeconds * 60);
        while (simT < target && guard < guardMax) {
          // 官方 CParticle.cpp:191-199: 真实 dt 变步长更新, dt = min(帧间隔, 0.1s)
          // (cap 防发散)。静态帧渲染无真实帧间隔, 以 60fps 固定步进逼近
          // (1/60 ≈ 0.0167 < 0.1 恒满足官方 cap)
          const dt = Math.min(1 / 60, target - simT);
          this._stepParticles(sys, dt, simT);
          simT += dt;
          guard++;
        }
        sys._simulatedTo = target;
      }
    
,
    _stepParticles(sys, dt, simT) {
        // 发射
        for (const em of sys.emitters) {
          if (em.delay > 0 && simT < em.delay) continue;
          // MOD-27: duration — 发射窗口 [delay, delay+duration], 过窗停止
          // (旧实现永不停止, "喷 2 秒"的发射器永远喷)
          if (em.duration > 0 && simT > em.delay + em.duration) continue;
          let toEmit = 0;
          if (em.instantaneous > 0 && !em._emitted) {
            toEmit = em.instantaneous;
            em._emitted = true;
          }
          // F-2: 每发射器独立 acc — 总速率不变 (Σrate), 但整数化后的发射颗数
          // 归属各自发射器 (旧共享 acc 跨边界时由后序发射器独占记账)
          em.acc += dt * em.rate * sys.rateMul;
          toEmit += Math.floor(em.acc);
          em.acc -= Math.floor(em.acc);
          const cap = em.flags & 2 ? 1 : toEmit;
          for (let k = 0; k < cap && sys.count < sys.maxCount; k++) {
            const p = this._spawnParticle(sys, em);
            sys.particles.push(p);
            sys.count++;
            // sf47: eventfollow 子系统 — 父粒子出生事件 (世界坐标 y-up)
            if (sys.child && p.scenePos) sys.child.pending.push([p.scenePos[0], p.scenePos[1]]);
          }
        }
        // sf47: 子系统推进 — 消费父 spawn 事件 (瞬时发射器在事件位置爆发) +
        // 年龄/算子/死亡 (与父循环同款)
        const ch = sys.child;
        if (ch) {
          if (ch.pending.length) {
            for (const ev of ch.pending.splice(0, 64)) {
              for (const cem of ch.emitters) {
                if (!(cem.instantaneous > 0)) continue;
                const ccap = cem.flags & 2 ? 1 : cem.instantaneous;
                for (let k = 0; k < ccap && ch.count < ch.maxCount; k++) {
                  const cp = this._spawnParticleAt(ch, cem, ev);
                  ch.particles.push(cp);
                  ch.count++;
                }
              }
            }
          }
          for (const p of ch.particles) p.age += dt;
          for (const op of ch.operators) this._applyOperator(ch, op, dt, simT);
          // sf50: 子系统若自身是 ropetrail 同样记录历史（与父循环同款）
          if (ch.trailLength > 0) {
            const ckeep = Math.ceil(ch.trailLength * 60) + 2;
            for (const p of ch.particles) {
              const hst = p.hist || (p.hist = []);
              hst.push({ a: p.age, sx: p.scenePos[0], sy: p.scenePos[1], cx: p.pos[0], cy: p.pos[1], al: p.alpha, sz: p.size });
              if (hst.length > ckeep) hst.splice(0, hst.length - ckeep);
            }
          }
          for (let i = ch.particles.length - 1; i >= 0; i--) {
            if (ch.particles[i].age >= ch.particles[i].lifetime) {
              ch.particles.splice(i, 1);
              ch.count--;
            }
          }
        }
        // 更新
        for (const p of sys.particles) p.age += dt;
        for (const op of sys.operators) this._applyOperator(sys, op, dt, simT);
        // sf50: ropetrail 位置历史（官方 semantics: 沿每个粒子自己的路径画线 —
        // docs.wallpaperengine.io renderer 文档 "draws a line along the path of
        // each particle"）。每步（固定 1/60）记录一份快照（双坐标系 + alpha/size），
        // 环形保留 length 秒; 绘制时按 tk=age−k·L/S 回溯取段端点。
        if (sys.trailLength > 0) {
          const keep = Math.ceil(sys.trailLength * 60) + 2;
          for (const p of sys.particles) {
            const hst = p.hist || (p.hist = []);
            hst.push({ a: p.age, sx: p.scenePos[0], sy: p.scenePos[1], cx: p.pos[0], cy: p.pos[1], al: p.alpha, sz: p.size });
            if (hst.length > keep) hst.splice(0, hst.length - keep);
          }
        }
        // 移除死亡
        for (let i = sys.particles.length - 1; i >= 0; i--) {
          if (sys.particles[i].age >= sys.particles[i].lifetime) {
            sys.particles.splice(i, 1);
            // P0-5: 死亡递减 — maxcount 封顶语义 = 同时存活数。旧实现 count 只增
            // 不减 (累计发射数), rate10/maxcount100 时 10s 后永久停止发射。
            sys.count--;
          }
        }
      }
    
,
    _spawnParticle(sys, em) {
        // 粒子系统: origin 是场景坐标 (y 向上), 像素中心 = (origin.x, H - origin.y)
        const rng = sys.rng || Math.random;
        let px, py;
        if (em.name === 'sphererandom') {
          const angle = rng() * Math.PI * 2;
          const minR = em.distanceMin[0], maxR = em.distanceMax[0];
          // 官方 CParticle.cpp:576-585: 正交粒子 2D 圆盘/环 √均匀面积采样 —
          // r = √(minR² + u·(maxR²-minR²)), u~U(0,1)。minR==maxR 时 u 项为 0,
          // 退化为固定半径圆环。旧实现线性 r → 单位面积密度 ∝ 1/r 向中心堆积。
          const u = rng();
          const r = Math.sqrt(minR * minR + u * (maxR * maxR - minR * minR));
          px = Math.cos(angle) * r * em.directions[0];
          py = Math.sin(angle) * r * em.directions[1];
          // P0-6 二次修正: 官方 CParticle.cpp:614-623 — sign 仅 sphere 生效, 作用
          // 于出生位置偏移 (1=强制正, -1=强制负, 0=双向); 速度方向因取自偏移而
          // 间接受约束。boxrandom 路径官方不消费 sign。
          if (em.sign[0] > 0) px = Math.abs(px);
          else if (em.sign[0] < 0) px = -Math.abs(px);
          if (em.sign[1] > 0) py = Math.abs(py);
          else if (em.sign[1] < 0) py = -Math.abs(py);
        } else {
          // boxrandom: 每轴在 [distancemin, distancemax] 范围内随机距离 + 随机翻转符号
          // (官方 emitter 字段 distancemin/max 实测; min>max 时交换容错)
          const randRange = (a, b) => (Math.min(a, b) + rng() * Math.abs(b - a));
          const rx = randRange(em.distanceMin[0], em.distanceMax[0]);
          const ry = randRange(em.distanceMin[1], em.distanceMax[1]);
          px = (rng() < 0.5 ? -rx : rx) * em.directions[0];
          py = (rng() < 0.5 ? -ry : ry) * em.directions[1];
        }
        // 应用系统缩放和旋转 (场景系 y 上, 官方 Rz(−a))
        // sf49: 发射器 origin 一并入旋转 — 官方模型矩阵作用于整个局部点
        // (origin+offset); 此前只旋转随机偏移、origin 仅乘 scale → 散布区
        // 中心错位。
        const cos = Math.cos(-em.angle), sin = Math.sin(-em.angle);
        const ox = em.origin[0] + px, oy = em.origin[1] + py;
        const rx = ox * cos - oy * sin, ry = ox * sin + oy * cos;
        // P0-6 二次修正 (按官方语义重写): 旧实现"全 emitter cone 锥角采样"为发明
        // 语义 — 官方 ObjectParser.cpp:605 解析 cone 但全仓库从未消费, 无 cone 行为。
        // 官方 CParticle.cpp:487-489: boxrandom 发射器 vel=0 (初速由 initializer 负责);
        // CParticle.cpp:626-636: 仅 sphererandom 且 speedmin/max 非全 0 时设初速 —
        // dir = normalize(出生偏移) (已含 directions 缩放与 sign, 径向外喷; 偏移为 0
        // 时官方回退 (0,1)), speed = random(speedmin, speedmax)。速度存画布坐标系
        // (y 向下, 与 velocityrandom/movement 一致, 场景 y 上 → 画布 y 下翻转)。
        let vel = [0, 0, 0];
        if (em.name === 'sphererandom' && (em.speedMax > 0 || em.speedMin !== 0)) {
          const len = Math.hypot(px, py);
          const dx = len > 0 ? px / len : 0;
          const dy = len > 0 ? py / len : 1;
          const speed = em.speedMin + rng() * Math.max(0, em.speedMax - em.speedMin);
          vel = [dx * speed, -dy * speed, 0];
        }
        // 统一场景局部坐标 (y 向上): 发射器原点偏移 + 随机偏移, 均乘 scale。
        // MOD-25: 两条绘制路径 (正交 scenePos / 非正交 p.pos) 从同一上向量导出,
        // 旧实现非正交路径随机偏移 y 符号相反 (分布镜像)。
        const lx = rx * em.scale[0];
        const ly = ry * em.scale[1];
        // 应用 initializers
        const p = {
          // 画布坐标 (y 向下, 已含系统 origin)
          pos: [sys.origin[0] + lx, this.H - sys.origin[1] - ly, 0],
          // P0-4: 纯场景坐标 (y 向上) 补上系统 origin — 旧实现只含发射器局部偏移,
          // 正交场景粒子全部聚在画布角落而非发射器世界位置 (像素路径 230 一直有)。
          scenePos: [sys.origin[0] + lx, sys.origin[1] + ly, 0],
          vel, angVel: 0, rot: 0,
          alpha: 1, size: 20, color: (sys.colorMul || [1, 1, 1]).slice(),
          // 官方字段名 lifetime (秒, CParticle.h:76-79): isAlive = alive && age < lifetime,
          // lifePos = age/lifetime; 死亡仅由 age >= lifetime 触发 (CParticle.cpp:307-320)
          lifetime: 1, age: 0, alive: true,
          oscAlpha: null, oscSize: null, oscPos: null,
        };
        for (const init of sys.initializers) this._applyInitializer(sys, p, init);
        // sf48+sf49: vel 是画布系 (y 下) — 场景系 R(−a) 折算到画布系 =
        // F·R(−a)·F = R(+a) (此前误用 R(−a): 垂直分量反向, 3427824116 流星
        // 俯冲而非升向右上)。× 对象 scale (官方模拟局部 + 模型矩阵缩放)。
        if (em.angle || em.scale[0] !== 1 || em.scale[1] !== 1) {
          const vc = Math.cos(em.angle), vs = Math.sin(em.angle);
          const nvx = p.vel[0] * vc - p.vel[1] * vs;
          const nvy = p.vel[0] * vs + p.vel[1] * vc;
          p.vel[0] = nvx * em.scale[0];
          p.vel[1] = nvy * em.scale[1];
        }
        return p;
      }

      // sf47: eventfollow 子系统事件生成 — 出生位置 = 父粒子出生事件 (世界 y-up)
      // + 发射器局部偏移 (glow 子系统 distancemin/max=0 → 恰在事件点)。
      ,
    _spawnParticleAt(sys, em, ev) {
        const rng = sys.rng || Math.random;
        const p = this._spawnParticle(sys, em);
        // 重定位: _spawnParticle 已用 sys.origin 定位 — 换成事件位置 + 发射器偏移
        const lx = p.scenePos[0] - sys.origin[0];
        const ly = p.scenePos[1] - sys.origin[1];
        p.scenePos = [ev[0] + lx, ev[1] + ly, 0];
        p.pos = [ev[0] + lx, this.H - (ev[1] + ly), 0];
        return p;
      }

      // sf50: ropetrail 历史回溯采样 — hist 按 age 升序 (每步 push), tk 落在
      // 相邻快照间线性插值; 早于最早快照 → 钳到最早 (≈出生点, 拖尾从短渐长)。
      ,
    _trailSample(hist, tk) {
        const first = hist[0];
        if (tk <= first.a) return first;
        for (let i = hist.length - 1; i > 0; i--) {
          const b = hist[i], a = hist[i - 1];
          if (tk >= a.a && tk <= b.a) {
            const f = (tk - a.a) / ((b.a - a.a) || 1e-9);
            return {
              sx: a.sx + (b.sx - a.sx) * f, sy: a.sy + (b.sy - a.sy) * f,
              cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f,
              al: a.al + (b.al - a.al) * f, sz: a.sz + (b.sz - a.sz) * f,
            };
          }
        }
        return hist[hist.length - 1];
      }
    
,
    _applyInitializer(sys, p, init) {
        const pr = init.params;
        // 全部 initializer 显式用系统确定性 rng, 不再依赖 renderParticleSystem
        // 的全局 Math.random 替换时序 (与官方"每粒子系统独立 m_rng"口径一致)。
        // sys 为空时兜底全局随机。
        const rng = (sys && sys.rng) || Math.random;
        switch (init.name) {
          case 'sizerandom': {
            const min = getVal(pr, 'min', 1), max = getVal(pr, 'max', 20);
            // sf41c 官方 (lwe createSizeRandomInitializer): × sizeOverride / 2
            p.size = (min + rng() * (max - min)) * (sys.sizeMul || 1) / 2;
            p._initSize = p.size;
            break;
          }
          case 'alpharandom': {
            const min = getVal(pr, 'min', 0.05), max = getVal(pr, 'max', 1);
            p.alpha = min + rng() * (max - min);
            p._initAlpha = p.alpha;
            break;
          }
          case 'lifetimerandom': {
            const min = getVal(pr, 'min', 0), max = getVal(pr, 'max', 1);
            // sf41c: × lifetimeOverride (instanceoverride.lifetime)
            p.lifetime = (min + rng() * (max - min)) * (sys.lifetimeMul || 1);
            break;
          }
          case 'velocityrandom': {
            // 官方 CParticle.cpp:773-777: p.velocity += random(min,max) 且 vel.y 取负
            // (叠加非赋值 — 不覆盖发射器初速; y 翻转: 场景 y 上 → 画布 y 下)
            // P1-9: 预解析参数 (init.min/max, 见 _parseInitializer), 兜底保留旧解析
            const min = init.min || parseVec3(getVal(pr, 'min'), [-32, -32, -32]);
            const max = init.max || parseVec3(getVal(pr, 'max'), [32, 32, 32]);
            p.vel = [
              p.vel[0] + min[0] + rng() * (max[0] - min[0]),
              p.vel[1] - (min[1] + rng() * (max[1] - min[1])),
              p.vel[2] + min[2] + rng() * (max[2] - min[2]),
            ];
            break;
          }
          case 'rotationrandom': {
            const min = init.min || parseVec3(getVal(pr, 'min'), [0, 0, 0]);
            const max = init.max || parseVec3(getVal(pr, 'max'), [0, 0, Math.PI * 2]);
            p.rot = min[2] + rng() * (max[2] - min[2]);
            break;
          }
          case 'angularvelocityrandom': {
            const min = init.min || parseVec3(getVal(pr, 'min'), [0, 0, -5]);
            const max = init.max || parseVec3(getVal(pr, 'max'), [0, 0, 5]);
            p.angVel = min[2] + rng() * (max[2] - min[2]);
            break;
          }
          case 'colorrandom': {
            const min = init.min || parseVec3(getVal(pr, 'min'), [0, 0, 0]);
            const max = init.max || parseVec3(getVal(pr, 'max'), [1, 1, 1]);
            // 引擎初始器值域 0-255, 着色器内归一化到 0..1 (v_Color.r 参与 mix)
            const k = init.k != null ? init.k
              : (max[0] > 1 || max[1] > 1 || max[2] > 1 || min[0] > 1 || min[1] > 1 || min[2] > 1) ? 1 / 255 : 1;
            // sf43 官方 (lwe): × instanceoverride.colorn 逐通道颜色乘子
            const cm = sys.colorMul || [1, 1, 1];
            p.color = [
              (min[0] + rng() * (max[0] - min[0])) * k * cm[0],
              (min[1] + rng() * (max[1] - min[1])) * k * cm[1],
              (min[2] + rng() * (max[2] - min[2])) * k * cm[2],
            ];
            break;
          }
        }
      }
    
,
    _applyOperator(sys, op, dt, t) {
        const pr = op.params;
        // P1-9: 参数取预处理结构 (见 _parseOperator, 循环外一次解析); 兜底保留旧解析。
        // oscillate* 的 rng 显式取 sys.rng (原经全局 Math.random 替换, 抽序列逐位同构)
        const rng = sys.rng || Math.random;
        for (const p of sys.particles) {
          switch (op.name) {
            case 'movement': {
              const gravity = op.gravity || parseVec3(getVal(pr, 'gravity'), [0, 0, 0]);
              const drag = op.drag != null ? op.drag : getVal(pr, 'drag', 0);
              // sf41c: gravity × instanceoverride.speed (官方 lwe 同款)
              // sf48: × 对象 scale; sf49: 画布系 R(+a) 旋转 (与 vel 同折算,
              // 此前漏旋转 → 旋转对象的重力方向偏差 = 对象角)
              const spd = sys.speedMul || 1;
              const gs = sys.scale ? sys.scale[0] : 1;
              const gvc = Math.cos(sys.angle || 0) * gs, gvs = Math.sin(sys.angle || 0) * gs;
              const gyC = -gravity[1]; // 场景 y 上 → 画布 y 下
              p.pos[0] += p.vel[0] * dt;
              p.pos[1] += p.vel[1] * dt;
              p.vel[0] += (gravity[0] * gvc - gyC * gvs) * spd * dt;
              p.vel[1] += (gravity[0] * gvs + gyC * gvc) * spd * dt;
              const df = Math.max(0, 1 - drag * dt);
              p.vel[0] *= df; p.vel[1] *= df;
              if (p.scenePos) {
                // 场景坐标 (y 向上): x 同向, y 与画布 y-down 反向
                p.scenePos[0] += p.vel[0] * dt;
                p.scenePos[1] += -p.vel[1] * dt;
              }
              break;
            }
            case 'controlpointattract': {
              // A2 重做 (lwe CParticle.cpp:1449-1494 精确对照, sf41a 回退后定标):
              //   threshold = value/2; center = cp.position + opOrigin (local y-down);
              //   0.001 < dist < threshold 时 vel += normalize(center−p)·scale·dt·speed。
              // cp.position → 场景 y-up 推导 (lwe:146-167/211-254, local = centered(S)−
              // centered(O), 即 S = O + (local.x, −local.y)):
              //   linkMouse (flags&1): S = (mx·W + off.x, my·H − off.y) — 鼠标归一化
              //     (0=底, 1=顶, y-up); 官方口径用场景宽高 (lwe 用屏幕宽高, 系其
              //     ortho≠屏幕场景的偏差, 官方 > lwe)。
              //   worldSpace (flags&2): S = (W/2 + off.x, H/2 − off.y)
              //   local: S = (origin.x + off.x, origin.y − off.y); 无数据 CP =
              //     local (0,0,0) → 对象原点 (lwe resize(8) 默认)
              // opOrigin 同为 local y-down → S.x += org.x, S.y −= org.y。
              {
                const cp = (sys.cps && sys.cps.get(op.cpIdx)) || { flags: 0, offset: [0, 0] };
                const ortho = this.scene.general && this.scene.general.orthogonalprojection;
                const sw = ortho && ortho.width ? ortho.width : this.W;
                const sh = ortho && ortho.height ? ortho.height : this.H;
                let cx, cy;
                if (cp.flags & 1) {
                  // optsMouse [0..1] 屏幕 y-down (0=顶) → 场景 y-up (1−my)
                  const m = this.optsMouse || [0.5, 0.5];
                  cx = m[0] * sw + cp.offset[0];
                  cy = (1 - m[1]) * sh - cp.offset[1];
                } else if (cp.flags & 2) {
                  cx = sw / 2 + cp.offset[0];
                  cy = sh / 2 - cp.offset[1];
                } else {
                  cx = sys.origin[0] + cp.offset[0];
                  cy = sys.origin[1] - cp.offset[1];
                }
                cx += op.cpOrigin[0];
                cy -= op.cpOrigin[1];
                // 粒子位置: 正交场景 scenePos (场景 y-up); 方向 → vel (画布 y-down)
                const sx = p.scenePos ? p.scenePos[0] : p.pos[0];
                const sy = p.scenePos ? p.scenePos[1] : this.H - p.pos[1];
                const dx = cx - sx, dy = cy - sy;
                const d = Math.hypot(dx, dy);
                const spd = sys.speedMul || 1;
                if (d > 0.001 && d < op.threshold) {
                  p.vel[0] += (dx / d) * op.attractScale * dt * spd;
                  p.vel[1] += (-dy / d) * op.attractScale * dt * spd;
                }
              }
              break;
            }
            case 'angularmovement': {
              const force = op.force || parseVec3(getVal(pr, 'force'), [0, 0, 0]);
              const drag = op.drag != null ? op.drag : getVal(pr, 'drag', 0);
              // A2: lwe CParticle.cpp:1073/1076 — rotation/angularVelocity 更新均
              // × instanceOverride.speed (与 force 同乘); 旧实现漏乘
              const spd = sys.speedMul || 1;
              p.rot += p.angVel * dt * spd;
              p.angVel += force[2] * dt * spd;
              p.angVel *= Math.max(0, 1 - drag * dt);
              // lwe CParticle.cpp:1090-1097: rotation 归一 [−π,π] (防精度漂移)
              if (p.rot > Math.PI) p.rot -= Math.PI * 2;
              else if (p.rot < -Math.PI) p.rot += Math.PI * 2;
              break;
            }
            case 'alphafade': {
              // A2: lwe Maths.cpp:23-32 fadeValue = **线性插值** (life≤start→startValue,
              // life≥end→endValue, 中间 lerp)。旧实现 smoothstep (tt²(3−2tt)) 无出处。
              const fadeIn = op.fadeIn != null ? op.fadeIn : getVal(pr, 'fadeintime', 0.5);
              const fadeOut = op.fadeOut != null ? op.fadeOut : getVal(pr, 'fadeouttime', 0.5);
              const lifePos = p.lifetime > 0 ? p.age / p.lifetime : 1;
              const base = p._initAlpha ?? 1;
              // fadeValue(life, 0, fadeIn, 0, 1) / 1 − fadeValue(life, fadeOut, 1, 0, 1)
              let fade;
              if (lifePos <= fadeIn) {
                fade = fadeIn > 0 ? Math.min(1, Math.max(0, lifePos / fadeIn)) : 1;
              } else if (lifePos > fadeOut) {
                const tt = 1 - fadeOut > 0 ? Math.min(1, Math.max(0, (lifePos - fadeOut) / (1 - fadeOut))) : 1;
                fade = 1 - tt;
              } else fade = 1;
              p.alpha = base * fade;
              // 原生每帧刷新振荡器基数 (oscillateAlpha 与 alphafade 组合的关键)
              if (p.oscAlpha) p.oscAlpha.base = p.alpha;
              break;
            }
            case 'sizechange': {
              const st = op.st != null ? op.st : getVal(pr, 'starttime', 0);
              const et = op.et != null ? op.et : getVal(pr, 'endtime', 1);
              const sv = op.sv != null ? op.sv : getVal(pr, 'startvalue', 1);
              const ev = op.ev != null ? op.ev : getVal(pr, 'endvalue', 0);
              const lifePos = p.lifetime > 0 ? p.age / p.lifetime : 1;
              // A2: fadeValue 线性 (lwe Maths.cpp:23-32), 逐边界分支照抄
              let mul;
              if (lifePos <= st) mul = sv;
              else if (lifePos >= et) mul = ev;
              else mul = sv + (ev - sv) * ((lifePos - st) / (et - st));
              p.size = (p._initSize ?? 20) * mul;
              if (p.oscSize) p.oscSize.base = p.size;
              break;
            }
            case 'alphachange': {
              const st = op.st != null ? op.st : getVal(pr, 'starttime', 0);
              const et = op.et != null ? op.et : getVal(pr, 'endtime', 1);
              const sv = op.sv != null ? op.sv : getVal(pr, 'startvalue', 1);
              const ev = op.ev != null ? op.ev : getVal(pr, 'endvalue', 0);
              const lifePos = p.lifetime > 0 ? p.age / p.lifetime : 1;
              let mul;
              if (lifePos <= st) mul = sv;
              else if (lifePos >= et) mul = ev;
              else mul = sv + (ev - sv) * ((lifePos - st) / (et - st));
              p.alpha = (p._initAlpha ?? 1) * mul;
              if (p.oscAlpha) p.oscAlpha.base = p.alpha;
              break;
            }
            case 'turbulence': {
              const scale = op.scale != null ? op.scale : getVal(pr, 'scale', 0.005);
              const timeScale = op.timeScale != null ? op.timeScale : getVal(pr, 'timescale', 0.01); // 官方默认 (ObjectParser.cpp:711)
              const mask = op.mask || parseVec3(getVal(pr, 'mask'), [1, 1, 0]);
              // MOD-29 重写 (官方语义): CParticle.cpp:1255-1285 + NoiseUtils.h:130-149 —
              // 湍流 = 确定性 curl noise 场 (固定 Perlin 置换表, 本文件顶部 curl2D),
              // phase/turbSpeed 已在 _parseOperator 建时随机一次 (op.phase/op.turbSpeed),
              // 此处无任何随机 — 同粒子同 t 必得同结果。noisePos = (pos.x + phase +
              // timeScale·t)·scale·2 (官方仅 x 轴加相位/时间漂移), y = pos.y·scale·2;
              // z 简化屏蔽 (官方 mask 默认 (1,1,0))。curlDir 归一 ×turbSpeed ×mask,
              // vel += curlDir·dt·speed (speed=实例覆盖, 默认 1); 坐标取画布系 (与 vel
              // 同系, 场为官方场景系的镜像等价)。旧实现逐步重抽 sp/phase → 20Hz 白噪
              // 抖动且耗 rng 序列, 非官方语义。
              const ns = scale * 2;
              const c = curl2D((p.pos[0] + op.phase + timeScale * t) * ns, p.pos[1] * ns);
              const cl = Math.hypot(c[0], c[1]);
              // A2: lwe CParticle.cpp:1285 — vel += curlDir·turbSpeed·mask·dt·speed
              // (× instanceOverride.speed); 旧实现漏乘
              const spd = sys.speedMul || 1;
              if (cl > 0.0001) {
                p.vel[0] += (c[0] / cl) * op.turbSpeed * dt * mask[0] * spd;
                p.vel[1] += (c[1] / cl) * op.turbSpeed * dt * mask[1] * spd;
              }
              break;
            }
            case 'oscillatealpha': {
              const fMin = op.fMin != null ? op.fMin : getVal(pr, 'frequencymin', 0);
              const fMax = op.fMax != null ? op.fMax : getVal(pr, 'frequencymax', 10);
              const sMin = op.sMin != null ? op.sMin : getVal(pr, 'scalemin', 0);
              const sMax = op.sMax != null ? op.sMax : getVal(pr, 'scalemax', 1);
              const phMin = op.phMin != null ? op.phMin : getVal(pr, 'phasemin', 0);
              const phMax = op.phMax != null ? op.phMax : getVal(pr, 'phasemax', Math.PI * 2);
              if (!p.oscAlpha) {
                // P1-9: rng 显式参数 (原 Math.random 全局替换, 同一 sys.rng 同一抽序列)
                // A2: lwe CParticle.cpp:1522-1523 phase = random(phasemin, phasemax+2π)
                p.oscAlpha = { f: fMin + rng() * (fMax - fMin), ph: phMin + rng() * (phMax + Math.PI * 2 - phMin), base: p.alpha };
              }
              const cosVal = (Math.cos(p.oscAlpha.f * p.age + p.oscAlpha.ph) + 1) * 0.5;
              p.alpha = p.oscAlpha.base * (sMin + (sMax - sMin) * cosVal);
              break;
            }
            case 'oscillatesize': {
              const fMin = op.fMin != null ? op.fMin : getVal(pr, 'frequencymin', 0);
              const fMax = op.fMax != null ? op.fMax : getVal(pr, 'frequencymax', 10);
              const sMin = op.sMin != null ? op.sMin : getVal(pr, 'scalemin', 0.8);
              const sMax = op.sMax != null ? op.sMax : getVal(pr, 'scalemax', 1.2);
              const phMin = op.phMin != null ? op.phMin : getVal(pr, 'phasemin', 0);
              const phMax = op.phMax != null ? op.phMax : getVal(pr, 'phasemax', Math.PI * 2);
              if (!p.oscSize) {
                p.oscSize = { f: fMin + rng() * (fMax - fMin), ph: phMin + rng() * (phMax + Math.PI * 2 - phMin), base: p.size };
              }
              const cosVal = (Math.cos(p.oscSize.f * p.age + p.oscSize.ph) + 1) * 0.5;
              p.size = p.oscSize.base * (sMin + (sMax - sMin) * cosVal);
              break;
            }
            case 'oscillateposition': {
              const fMin = op.fMin != null ? op.fMin : getVal(pr, 'frequencymin', 0);
              const fMax = op.fMax != null ? op.fMax : getVal(pr, 'frequencymax', 5);
              const sMin = op.sMin != null ? op.sMin : getVal(pr, 'scalemin', 0);
              const sMax = op.sMax != null ? op.sMax : getVal(pr, 'scalemax', 10);
              const mask = op.mask || parseVec3(getVal(pr, 'mask'), [1, 1, 0]);
              const phMin = op.phMin != null ? op.phMin : getVal(pr, 'phasemin', 0);
              const phMax = op.phMax != null ? op.phMax : getVal(pr, 'phasemax', Math.PI * 2);
              if (!p.oscPos) {
                p.oscPos = {
                  f: [0, 0, 0].map(() => fMin + rng() * (fMax - fMin)),
                  ph: [0, 0, 0].map(() => phMin + rng() * (phMax + Math.PI * 2 - phMin)),
                  sc: [0, 0, 0].map(() => sMin + rng() * (sMax - sMin)),
                };
              }
              // A2: lwe CParticle.cpp:1631 delta = move·mask·speedOverride —
              // × instanceOverride.speed; 旧实现漏乘
              const spd = sys.speedMul || 1;
              for (let a = 0; a < 2; a++) {
                const w = 2 * Math.PI * p.oscPos.f[a] / (2 * Math.PI);
                const move = -p.oscPos.sc[a] * w * Math.sin(w * p.age + p.oscPos.ph[a]) * dt;
                p.pos[a] += move * mask[a] * spd;
                if (p.scenePos) p.scenePos[a] += (a === 0 ? move : -move) * mask[a] * spd;
              }
              break;
            }
          }
        }
      }
    
,
    _drawParticles(sys) {
        const tex = sys.tex;
        const alphaMul = sys.alphaMul;
        const W = this.W, H = this.H;
        const canvas = this.canvas;
        const additive = sys.blending === 'additive';
        // 原生 genericparticle.vert: v_Color.a *= 0.5; v_Color.rgb = mix(color1, color2, v_Color.r)
        // (USERCOLORBLEND); 正交场景按投影缩放场景单位→像素
        const ps = sys.projScale;
        // sf50: rope / ropetrail 分流（官方语义, docs.wallpaperengine.io renderer）—
        //   ropetrail: "沿每个粒子自己的路径画线" — 每粒子位置历史 (_stepParticles
        //     逐步快照) 按 tk=age−k·L/S 回溯取 segments+1 个点, 逐段 quad;
        //     宽=size(垂直于段方向), UV.v 头(k/S)→尾((k+1)/S) 切片 (官方
        //     genericropeparticle.vert TRAILRENDERER: 首段 uvMinimum=0 起, 每段
        //     1/usableLength 递增; 渐隐由贴图 v 向 alpha 承担 — drop.tex v≈0.19
        //     亮核 v→1 隐)。无独立头部 sprite (亮核在首段 v 切片内)。
        //   rope: "在发射的粒子间连线" — 存活粒子按发射序串链 (oldest→newest),
        //     逐对相邻粒子链节 quad + 链头本体 sprite (sf46 近似保留)。
        // sf46 链节旋转有 90° 偏差 (rot=atan2(dx,dy)−π/2 把链方向映到本地 +x,
        // 长轴却在本地 y → 链节恒与链垂直; 流星散布盒 ±1280×±256 使链节呈
        // 水平长线 — "流星横移"观感主因): 本地 +y 对齐链方向应为 rot=atan2(dx,dy)。
        // 完整 genericropeparticle shader（Catmull-Rom 细分/UV 滚动）未移植 —
        // 直线轨迹（流星）场景与官方视觉等价。GL _weGLPFillRopeVerts 同款。
        let iter = sys.particles;
        const isRope = !!(sys.rendererName === 'rope' || sys.rendererName === 'ropetrail');
        if (isRope && tex && sys.trailLength > 0 && sys.particles.length > 0) {
          // —— ropetrail: 每粒子路径拖尾 ——
          const L = sys.trailLength, S = sys.trailSegments;
          const dsc = sys.drawScale || [1, 1];
          const links = [];
          for (const p of sys.particles) {
            const hst = p.hist;
            if (!hst || !hst.length) continue;
            // 段链 P_0=当前位置 → P_S=最老快照（不足 length 时钳到最早快照 ≈ 出生点,
            // 官方 "still spawning" 段同效: 拖尾随年龄逐渐伸长）
            let hx = p.scenePos[0], hy = p.scenePos[1], hxC = p.pos[0], hyC = p.pos[1], ha = p.alpha, hs = p.size;
            for (let k = 1; k <= S; k++) {
              const s2 = this._trailSample(hst, p.age - (k * L) / S);
              // 段端点 → 画布坐标（正交投影 or 直接画布）
              const ax = ps ? hx * ps[0] : hxC, ay = ps ? this.H - hy * ps[1] : hyC;
              const bx = ps ? s2.sx * ps[0] : s2.cx, by = ps ? this.H - s2.sy * ps[1] : s2.cy;
              const dx = bx - ax, dy = by - ay;
              const d = Math.hypot(dx, dy);
              if (d >= 1e-3) {
                // 半宽与 sprite 绘制同口径 (halfX2 = size·ps·dsc); 半长 = 段距/2+半宽重叠
                const wHalf = Math.max(0.5, (hs + s2.sz) / 2) * (ps ? ps[0] : 1) * dsc[0];
                links.push({
                  scenePos: [(hx + s2.sx) / 2, (hy + s2.sy) / 2],
                  pos: [(ax + bx) / 2, (ay + by) / 2],
                  linkW: wHalf, linkH: d / 2 + wHalf,
                  // 本地 +y → 尾 (v=1 端); UV 切片 v∈[(k−1)/S, k/S] 头→尾
                  rot: Math.atan2(dx, dy), uvY: (k - 1) / S, uvH: 1 / S,
                  alpha: Math.max(0, (ha + s2.al) / 2),
                  color: p.color.slice(),
                  lifetime: 1, age: 0, oscAlpha: null, oscSize: null, oscPos: null,
                });
              }
              hx = s2.sx; hy = s2.sy; hxC = s2.cx; hyC = s2.cy; ha = s2.al; hs = s2.sz;
            }
          }
          iter = links;
        } else if (isRope && tex && sys.particles.length > 1) {
          // —— rope: 相邻粒子串链（sf46 近似; 旋转/宽度修正）——
          const alive = sys.particles;
          const na = alive.length;
          const links = [];
          const posOf = (q) => (ps
            ? [q.scenePos ? q.scenePos[0] : q.pos[0], q.scenePos ? q.scenePos[1] : (this.H - q.pos[1]) / (ps[1] || 1)]
            : [q.pos[0], q.pos[1]]); // 非 ps: p.pos 已是画布坐标
          for (let k = 0; k + 1 < na; k++) {
            const p = alive[k], q = alive[k + 1];
            const pw = posOf(p), qw = posOf(q);
            // 画布方向 (供旋转角): world y-up → 画布 y-down 翻转
            const px = pw[0] * (ps ? ps[0] : 1), py = ps ? this.H - pw[1] * ps[1] : pw[1];
            const qx = qw[0] * (ps ? ps[0] : 1), qy = ps ? this.H - qw[1] * ps[1] : qw[1];
            const dx = qx - px, dy = qy - py;
            const d = Math.hypot(dx, dy);
            if (d < 1e-3) continue;
            const fade = (k + 1) / na;
            const dsc = sys.drawScale || [1, 1];
            // 半宽与 sprite 同口径 (size 已被 initializer 减半 → 半宽 = size·ps·dsc)
            const w = Math.max(0.5, Math.min(p.size, q.size)) * (ps ? ps[0] : 1) * dsc[0];
            // blit 旋转约定: 逆时针正角 (画布 y-down); 长轴=本地 y 对齐链方向
            const rot = Math.atan2(dx, dy);
            links.push({
              // scenePos (世界 y-up) — 绘制循环单次投影 (pos 路径会被再乘 ps)
              scenePos: [(pw[0] + qw[0]) / 2, (pw[1] + qw[1]) / 2],
              pos: [(px + qx) / 2, (py + qy) / 2],
              linkW: w, linkH: d / 2 + w, rot,
              alpha: Math.min(p.alpha, q.alpha) * fade,
              color: [(p.color[0] + q.color[0]) / 2, (p.color[1] + q.color[1]) / 2, (p.color[2] + q.color[2]) / 2],
              lifetime: 1, age: 0, oscAlpha: null, oscSize: null, oscPos: null,
            });
          }
          // 链头本体
          const q = alive[na - 1];
          const qw = posOf(q);
          const qx = qw[0] * (ps ? ps[0] : 1), qy = ps ? this.H - qw[1] * ps[1] : qw[1];
          links.push({
            scenePos: [qw[0], qw[1]],
            pos: [qx, qy],
            linkW: Math.max(0.5, q.size) * (ps ? ps[0] : 1) * (sys.drawScale ? sys.drawScale[0] : 1),
            linkH: Math.max(0.5, q.size) * (ps ? ps[0] : 1) * (sys.drawScale ? sys.drawScale[0] : 1) * (tex.height / tex.width),
            rot: q.rot || 0, alpha: q.alpha, color: q.color.slice(),
            lifetime: 1, age: 0, oscAlpha: null, oscSize: null, oscPos: null,
          });
          iter = links;
        }
        for (const p of iter) {
          const lifePos = p.lifetime > 0 ? p.age / p.lifetime : 1;
          if (lifePos >= 1) continue;
          // 官方 genericparticle: v_Color = a_Color (alpha 来自 CPU 端 initializer),
          // 无固定 0.5 衰减 — 旧实现乘 0.5 使粒子普遍偏淡 (sf39g)。
          const a = Math.max(0, p.alpha) * alphaMul;
          if (a <= 0.002) continue;
          const sz = Math.max(0.5, p.size);
          // 正交场景: 用 scenePos (场景坐标, y 向上, P0-4 修复后已含系统 origin)
          // 经投影缩放; 否则用画布坐标 (已含 origin)
          const x = ps ? (p.scenePos ? p.scenePos[0] * ps[0] : p.pos[0] * ps[0]) : p.pos[0];
          const y = ps ? (p.scenePos ? this.H - p.scenePos[1] * ps[1] : p.pos[1] * ps[1]) : p.pos[1];
          const dsc = sys.drawScale || [1, 1];
          const halfX = (ps ? sz * ps[0] * dsc[0] : sz * dsc[0]) / 2;
          // 官方 genericparticle.vert: textureRatio = g_Texture0Resolution.y / x,
          // ComputeParticlePosition: up×(v-0.5)×textureRatio — 垂直尺寸乘纹理纵横比
          // (高/宽)。旧实现忽略 ratio → 非正方形粒子纹理 (流星 256×794/drop 32×128
          // 等 12 个) 被拉伸成正方形 (sf39g)。
          const ratio = tex && tex.width > 0 ? tex.height / tex.width : 1;
          const halfY = ((ps ? sz * ps[1] * dsc[1] : sz * dsc[1]) / 2) * ratio;
          // sf46: rope 链节显式几何（宽/长直供, 构建期已含 drawScale）
          const halfX2 = p.linkW != null ? p.linkW : halfX * 2;
          const halfY2 = p.linkH != null ? p.linkH : halfY * 2;
          if (tex) {
            // 官方 genericparticle.vert SPRITESHEET: currentFrame = floor(lifetime×numFrames),
            // 采样对应帧区域 (TEXS 帧元数据 x/y/width/height)。旧实现无 SPRITESHEET
            // → 精灵表粒子 (notes_sprite_sheet 41帧 等) 显示整张表 (sf39g)。
            let frameUV = null;
            if (tex.frames && tex.frames.count > 1 && tex.frames.items) {
              const fr = tex.frames;
              const lt = p.lifetime > 0 ? p.age / p.lifetime : 1;
              const idx = Math.min(fr.count - 1, Math.floor(lt * fr.count));
              const f = fr.items[idx];
              // MOD-23: 优先级修正 — 有显式帧宽用之, 否则按 count 均分, 无 count 用整图。
              // 旧写法 f.width || fr.count > 0 ? … : … 解析为 (f.width || count>0) ? 均分 : 整图
              // → count>1 恒真, f.width 永远被丢弃 (tex.width=300,count=4 → 75 而非显式宽)。
              if (f) frameUV = { x: f.x, y: f.y, w: f.width || (fr.count > 0 ? Math.floor(tex.width / fr.count) : tex.width), h: f.height || tex.height };
            }
            const tw = tex.width, th = tex.height;
            // sf43 官方: v_Color = a_Color 直通, 顶点色 = colorrandom×colorn
            const colorR = p.color[0], colorG = p.color[1], colorB = p.color[2];
            // P1-24/MOD-22: 应用 p.rot (rotationrandom 初始化 + angularmovement 积分,
            // 旧实现只模拟不绘制 → 恒轴对方块)。逆旋转采样坐标与 canvas.blitRotated
            // 同款 (画布 y 向下, 屏幕逆时针正向 → 逆映射 R(+rot)); 扫描包围盒按
            // 旋转后对角线外扩 (halfX≠halfY, 纹理纵横比)。
            const rot = p.rot || 0;
            const cr = Math.cos(rot), sr = Math.sin(rot);
            let exX = halfX2, exY = halfY2;
            if (rot !== 0) {
              exX = halfX2 * Math.abs(cr) + halfY2 * Math.abs(sr);
              exY = halfX2 * Math.abs(sr) + halfY2 * Math.abs(cr);
            }
            const x0 = Math.floor(x - exX), y0 = Math.floor(y - exY);
            const x1 = Math.ceil(x + exX), y1 = Math.ceil(y + exY);
            for (let py = y0; py <= y1; py++) {
              if (py < 0 || py >= H) continue;
              for (let px = x0; px <= x1; px++) {
                if (px < 0 || px >= W) continue;
                const nx0 = (px - x), ny0 = (py - y);
                // sf50: 先旋转(像素域)再归一化 — 旧实现先按 halfX2/halfY2 各向异性
                // 归一化再旋转, rot≠0 且 halfX2≠halfY2 时 (ropetrail 段 1:6 宽高比 /
                // 非方纹理 rotationrandom) 旋转轴串刻度 → 采样点被错误裁出 quad
                // (流星拖尾段近 90° 旋转时整段不画)。方阵纹理两序等价, 无回归。
                const rxx = rot !== 0 ? nx0 * cr - ny0 * sr : nx0;
                const ryy = rot !== 0 ? nx0 * sr + ny0 * cr : ny0;
                const nx = rxx / halfX2, ny = ryy / halfY2;
                if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
                const u = (nx + 1) / 2, v = (ny + 1) / 2;
                // SPRITESHEET: 帧内 UV (帧区域归一化)
                let tu = u, tv = v, si;
                if (frameUV) {
                  tu = frameUV.x / tw + u * (frameUV.w / tw);
                  tv = frameUV.y / th + v * (frameUV.h / th);
                }
                // sf50: rope/trail 链节 UV 切片 (v 沿链长方向; ropetrail 段 k:
                // v∈[(k−1)/S, k/S] 头→尾, 官方 TRAILRENDERER uv 语义同款)
                if (p.uvY != null) tv = p.uvY + v * p.uvH;
                si = (Math.min(th - 1, Math.floor(tv * th)) * tw + Math.min(tw - 1, Math.floor(tu * tw))) * 4;
                // 官方 genericparticle.frag = 标准 RGBA 精灵: rgb × v_Color, 形状在
                // ALPHA 通道。WE 官方粒子纹理 (halo/drop 等全局素材) 白 RGB + A 形状;
                // 旧实现采 red 做形状 (chromaticdot 特例语义) → 官方纹理 R 恒 1 →
                // 白色实心方块 (sf40g, GL 同步修复)。
                const texA = tex.rgba[si + 3] / 255;
                if (texA <= 0.004) continue;
                const texR2 = tex.rgba[si] / 255, texG2 = tex.rgba[si + 1] / 255, texB2 = tex.rgba[si + 2] / 255;
                const sa = a * texA;
                const di = (py * W + px) * 4;
                // sf50: 改名 outR/outG/outB — 旧名 sr/sg/sb 与旋转正弦 const sr
                // (本循环体上方) TDZ 冲突: 任何 rot≠0 的纹理粒子 (rope 链节 /
                // rotationrandom) 在采样逆映射处抛 ReferenceError, 被上游 try/catch
                // 吞掉 → CPU 路径旋转粒子长期静默缺失 (GL 主渲染未受影响)。
                const outR = colorR * texR2 * sa * 255, outG = colorG * texG2 * sa * 255, outB = colorB * texB2 * sa * 255;
                if (additive) {
                  // additive: dst += src*srcA (clamp)
                  canvas.data[di] = Math.min(255, canvas.data[di] + outR);
                  canvas.data[di + 1] = Math.min(255, canvas.data[di + 1] + outG);
                  canvas.data[di + 2] = Math.min(255, canvas.data[di + 2] + outB);
                  canvas.data[di + 3] = 255;
                } else {
                  const dstA = canvas.data[di + 3] / 255;
                  const outA = sa + dstA * (1 - sa);
                  if (outA <= 0) continue;
                  canvas.data[di] = Math.round((outR + canvas.data[di] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 1] = Math.round((outG + canvas.data[di + 1] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 2] = Math.round((outB + canvas.data[di + 2] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 3] = Math.round(outA * 255);
                }
              }
            }
          } else {
            // 无纹理: 圆形占位 (additive)
            const r = Math.max(1, (halfX2 + halfY2) / 2);
            for (let py = Math.floor(y - r); py <= Math.ceil(y + r); py++) {
              for (let px = Math.floor(x - r); px <= Math.ceil(x + r); px++) {
                if (px < 0 || py < 0 || px >= W || py >= H) continue;
                if ((px - x) ** 2 + (py - y) ** 2 > r * r) continue;
                const di = (py * W + px) * 4;
                const sr = a * 255;
                if (additive) {
                  canvas.data[di] = Math.min(255, canvas.data[di] + sr);
                  canvas.data[di + 1] = Math.min(255, canvas.data[di + 1] + sr);
                  canvas.data[di + 2] = Math.min(255, canvas.data[di + 2] + sr);
                  canvas.data[di + 3] = 255;
                } else {
                  const dstA = canvas.data[di + 3] / 255;
                  const outA = a + dstA * (1 - a);
                  canvas.data[di] = Math.round((sr + canvas.data[di] * dstA * (1 - a)) / outA);
                  canvas.data[di + 1] = Math.round((sr + canvas.data[di + 1] * dstA * (1 - a)) / outA);
                  canvas.data[di + 2] = Math.round((sr + canvas.data[di + 2] * dstA * (1 - a)) / outA);
                  canvas.data[di + 3] = Math.round(outA * 255);
                }
              }
            }
          }
        }
        // sf47: eventfollow 子系统绘制 (子纹理/混合模式独立; 子对象有全部绘制
        // 所需字段 → 递归本函数复用 sprite 循环)
        if (sys.child && sys.child.particles.length) this._drawParticles(sys.child);
      }
  });
}
