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
        const sys = this._buildParticleSystem(o, def);
        if (!sys) return;
        // 模拟期也使用确定性 RNG (发射/初始器), 保证同场景帧可复现
        const origRandom = Math.random;
        Math.random = sys.rng;
        try {
          this._simulateParticleSystem(sys, t);
          this._drawParticles(sys);
        } finally {
          Math.random = origRandom;
        }
      }
    
,
    _buildParticleSystem(o, def) {
        const tr = this.resolveTransform(o);
        const origin = tr.origin;
        const scale = tr.scale;
        const angle = tr.angle;
        const inst = o.instanceoverride || {};
        const alphaMul = getVal(inst, 'alpha', 1);
        const rateMul = getVal(inst, 'rate', 1);
        const maxCount = def.maxcount || 100;
        // 确定性伪随机: 粒子生成期间替换 Math.random, 保证同场景渲染可复现 (缓存一致)
        const rng = this._particleRng(o);
        const origRandom = Math.random;
        Math.random = rng;
        try {
          const sys = this._buildParticleSystemInner(o, def, { tr, origin, scale, angle, inst, alphaMul, rateMul, maxCount, rng });
          return sys;
        } finally {
          Math.random = origRandom;
        }
      }
    
,
    _buildParticleSystemInner(o, def, ctx) {
        const { tr, origin, scale, angle, inst, alphaMul, rateMul, maxCount, rng } = ctx;
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
        return {
          o, origin, scale, angle, alphaMul, rateMul, maxCount,
          emitters, initializers, operators, tex, blending, color1, color2, projScale,
          starttime: def.starttime || 0,
          particles: [],
          count: 0,
          // MOD-31: 复用 ctx.rng (单一 RNG, 不再二次 hash 生成第二个 — 旧实现
          // ctx.rng 装全局后丢弃, 实际用的是这里新建的第二个)
          rng,
        };
      }
    
      // mulberry32 确定性 RNG (种子 = 对象 id + 场景路径 hash)
,
    _particleRng(o) {
        let seed = 0x9e3779b9;
        const str = String(this.pkgPath) + '|' + (o.id != null ? o.id : o.name || '') + '|' + (o.origin || '');
        for (let i = 0; i < str.length; i++) {
          seed = (seed ^ str.charCodeAt(i)) * 16777619 >>> 0;
        }
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
        return { name, params: i };
      }
    
,
    _parseOperator(op, rng) {
        const name = op.name || '';
        // 湍流确定性: 官方 CParticle.cpp:1249-1252 — phase/turbSpeed 在算子创建时
        // 随机一次并捕获 (默认 phasemin/max 均为 0, 即无相位偏移), 此后场演化
        // 完全确定。旧实现每步每粒子重抽 rng → 20Hz 白噪抖动, 非官方语义。
        if (name === 'turbulence') {
          const r = rng || Math.random;
          const sMin = getVal(op, 'speedmin', 500), sMax = getVal(op, 'speedmax', 1000);
          const pMin = getVal(op, 'phasemin', 0), pMax = getVal(op, 'phasemax', 0);
          return {
            name, params: op,
            turbSpeed: sMin + r() * (sMax - sMin),
            phase: pMin + r() * Math.max(0, pMax - pMin),
          };
        }
        return { name, params: op };
      }
    
,
    _simulateParticleSystem(sys, t) {
        // 引擎 starttime: 粒子系统从 starttime 后启动 (t < starttime → 无粒子)
        const st = sys.starttime || 0;
        // 从 0 开始模拟到 t-starttime (静态帧渲染: 一次性推进)
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
          }
        }
        // 更新
        for (const p of sys.particles) p.age += dt;
        for (const op of sys.operators) this._applyOperator(sys, op, dt, simT);
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
        // 应用系统缩放和旋转
        const cos = Math.cos(-em.angle), sin = Math.sin(-em.angle);
        const rx = px * cos - py * sin, ry = px * sin + py * cos;
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
        const lx = em.origin[0] * em.scale[0] + rx * em.scale[0];
        const ly = em.origin[1] * em.scale[1] + ry * em.scale[1];
        // 应用 initializers
        const p = {
          // 画布坐标 (y 向下, 已含系统 origin)
          pos: [sys.origin[0] + lx, this.H - sys.origin[1] - ly, 0],
          // P0-4: 纯场景坐标 (y 向上) 补上系统 origin — 旧实现只含发射器局部偏移,
          // 正交场景粒子全部聚在画布角落而非发射器世界位置 (像素路径 230 一直有)。
          scenePos: [sys.origin[0] + lx, sys.origin[1] + ly, 0],
          vel, angVel: 0, rot: 0,
          alpha: 1, size: 20, color: [1, 1, 1],
          // 官方字段名 lifetime (秒, CParticle.h:76-79): isAlive = alive && age < lifetime,
          // lifePos = age/lifetime; 死亡仅由 age >= lifetime 触发 (CParticle.cpp:307-320)
          lifetime: 1, age: 0, alive: true,
          oscAlpha: null, oscSize: null, oscPos: null,
        };
        for (const init of sys.initializers) this._applyInitializer(sys, p, init);
        return p;
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
            p.size = min + rng() * (max - min);
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
            p.lifetime = min + rng() * (max - min);
            break;
          }
          case 'velocityrandom': {
            // 官方 CParticle.cpp:773-777: p.velocity += random(min,max) 且 vel.y 取负
            // (叠加非赋值 — 不覆盖发射器初速; y 翻转: 场景 y 上 → 画布 y 下)
            const min = parseVec3(getVal(pr, 'min'), [-32, -32, -32]);
            const max = parseVec3(getVal(pr, 'max'), [32, 32, 32]);
            p.vel = [
              p.vel[0] + min[0] + rng() * (max[0] - min[0]),
              p.vel[1] - (min[1] + rng() * (max[1] - min[1])),
              p.vel[2] + min[2] + rng() * (max[2] - min[2]),
            ];
            break;
          }
          case 'rotationrandom': {
            const min = parseVec3(getVal(pr, 'min'), [0, 0, 0]);
            const max = parseVec3(getVal(pr, 'max'), [0, 0, Math.PI * 2]);
            p.rot = min[2] + rng() * (max[2] - min[2]);
            break;
          }
          case 'angularvelocityrandom': {
            const min = parseVec3(getVal(pr, 'min'), [0, 0, -5]);
            const max = parseVec3(getVal(pr, 'max'), [0, 0, 5]);
            p.angVel = min[2] + rng() * (max[2] - min[2]);
            break;
          }
          case 'colorrandom': {
            const min = parseVec3(getVal(pr, 'min'), [0, 0, 0]);
            const max = parseVec3(getVal(pr, 'max'), [1, 1, 1]);
            // 引擎初始器值域 0-255, 着色器内归一化到 0..1 (v_Color.r 参与 mix)
            const k = (max[0] > 1 || max[1] > 1 || max[2] > 1 || min[0] > 1 || min[1] > 1 || min[2] > 1) ? 1 / 255 : 1;
            p.color = [
              (min[0] + rng() * (max[0] - min[0])) * k,
              (min[1] + rng() * (max[1] - min[1])) * k,
              (min[2] + rng() * (max[2] - min[2])) * k,
            ];
            break;
          }
        }
      }
    
,
    _applyOperator(sys, op, dt, t) {
        const pr = op.params;
        for (const p of sys.particles) {
          switch (op.name) {
            case 'movement': {
              const gravity = parseVec3(getVal(pr, 'gravity'), [0, 0, 0]);
              const drag = getVal(pr, 'drag', 0);
              p.pos[0] += p.vel[0] * dt;
              p.pos[1] += p.vel[1] * dt;
              p.vel[0] += gravity[0] * dt;
              p.vel[1] += -gravity[1] * dt; // Y flip
              const df = Math.max(0, 1 - drag * dt);
              p.vel[0] *= df; p.vel[1] *= df;
              if (p.scenePos) {
                // 场景坐标 (y 向上): x 同向, y 与画布 y-down 反向
                p.scenePos[0] += p.vel[0] * dt;
                p.scenePos[1] += -p.vel[1] * dt;
              }
              break;
            }
            case 'angularmovement': {
              const force = parseVec3(getVal(pr, 'force'), [0, 0, 0]);
              const drag = getVal(pr, 'drag', 0);
              p.rot += p.angVel * dt;
              p.angVel += force[2] * dt;
              p.angVel *= Math.max(0, 1 - drag * dt);
              break;
            }
            case 'alphafade': {
              // MOD-28 (豁免, 仅注释): fadein/outtime 此处按寿命分数 (0-1) 参与比较,
              // 官方 CParticleAlphafade 疑为绝对秒。量纲与 sizechange/alphachange
              // (归一化 starttime/endtime) 口径一致, 待官方源确认后再改, 暂不动。
              const fadeIn = getVal(pr, 'fadeintime', 0.5);
              const fadeOut = getVal(pr, 'fadeouttime', 0.5);
              const lifePos = p.lifetime > 0 ? p.age / p.lifetime : 1;
              const base = p._initAlpha ?? 1;
              // 原生: fade = fadeValue(life, 0, fadeIn, 0, 1) = smoothstep
              let fade;
              if (lifePos <= fadeIn) {
                const tt = fadeIn > 0 ? Math.min(1, Math.max(0, lifePos / fadeIn)) : 1;
                fade = tt * tt * (3 - 2 * tt);
              } else if (lifePos > fadeOut) {
                const tt = 1 - fadeOut > 0 ? Math.min(1, Math.max(0, (lifePos - fadeOut) / (1 - fadeOut))) : 1;
                fade = 1 - tt * tt * (3 - 2 * tt);
              } else fade = 1;
              p.alpha = base * fade;
              // 原生每帧刷新振荡器基数 (oscillateAlpha 与 alphafade 组合的关键)
              if (p.oscAlpha) p.oscAlpha.base = p.alpha;
              break;
            }
            case 'sizechange': {
              const st = getVal(pr, 'starttime', 0), et = getVal(pr, 'endtime', 1);
              const sv = getVal(pr, 'startvalue', 1), ev = getVal(pr, 'endvalue', 0);
              const lifePos = p.lifetime > 0 ? p.age / p.lifetime : 1;
              const t01 = et > st ? Math.max(0, Math.min(1, (lifePos - st) / (et - st))) : 1;
              const tt = t01 * t01 * (3 - 2 * t01);
              p.size = (p._initSize ?? 20) * (sv + (ev - sv) * tt);
              if (p.oscSize) p.oscSize.base = p.size;
              break;
            }
            case 'alphachange': {
              const st = getVal(pr, 'starttime', 0), et = getVal(pr, 'endtime', 1);
              const sv = getVal(pr, 'startvalue', 1), ev = getVal(pr, 'endvalue', 0);
              const lifePos = p.lifetime > 0 ? p.age / p.lifetime : 1;
              const t01 = et > st ? Math.max(0, Math.min(1, (lifePos - st) / (et - st))) : 1;
              const tt = t01 * t01 * (3 - 2 * t01);
              p.alpha = (p._initAlpha ?? 1) * (sv + (ev - sv) * tt);
              if (p.oscAlpha) p.oscAlpha.base = p.alpha;
              break;
            }
            case 'turbulence': {
              const scale = getVal(pr, 'scale', 0.005);
              const timeScale = getVal(pr, 'timescale', 0.01); // 官方默认 (ObjectParser.cpp:711)
              const mask = parseVec3(getVal(pr, 'mask'), [1, 1, 0]);
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
              if (cl > 0.0001) {
                p.vel[0] += (c[0] / cl) * op.turbSpeed * dt * mask[0];
                p.vel[1] += (c[1] / cl) * op.turbSpeed * dt * mask[1];
              }
              break;
            }
            case 'oscillatealpha': {
              const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 10);
              const sMin = getVal(pr, 'scalemin', 0), sMax = getVal(pr, 'scalemax', 1);
              if (!p.oscAlpha) {
                p.oscAlpha = { f: fMin + Math.random() * (fMax - fMin), ph: Math.random() * Math.PI * 2, base: p.alpha };
              }
              const cosVal = (Math.cos(p.oscAlpha.f * p.age + p.oscAlpha.ph) + 1) * 0.5;
              p.alpha = p.oscAlpha.base * (sMin + (sMax - sMin) * cosVal);
              break;
            }
            case 'oscillatesize': {
              const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 10);
              const sMin = getVal(pr, 'scalemin', 0.8), sMax = getVal(pr, 'scalemax', 1.2);
              if (!p.oscSize) {
                p.oscSize = { f: fMin + Math.random() * (fMax - fMin), ph: Math.random() * Math.PI * 2, base: p.size };
              }
              const cosVal = (Math.cos(p.oscSize.f * p.age + p.oscSize.ph) + 1) * 0.5;
              p.size = p.oscSize.base * (sMin + (sMax - sMin) * cosVal);
              break;
            }
            case 'oscillateposition': {
              const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 5);
              const sMin = getVal(pr, 'scalemin', 0), sMax = getVal(pr, 'scalemax', 10);
              const mask = parseVec3(getVal(pr, 'mask'), [1, 1, 0]);
              if (!p.oscPos) {
                p.oscPos = {
                  f: [0, 0, 0].map(() => fMin + Math.random() * (fMax - fMin)),
                  ph: [0, 0, 0].map(() => Math.random() * Math.PI * 2),
                  sc: [0, 0, 0].map(() => sMin + Math.random() * (sMax - sMin)),
                };
              }
              for (let a = 0; a < 2; a++) {
                const w = 2 * Math.PI * p.oscPos.f[a] / (2 * Math.PI);
                const move = -p.oscPos.sc[a] * w * Math.sin(w * p.age + p.oscPos.ph[a]) * dt;
                p.pos[a] += move * mask[a];
                if (p.scenePos) p.scenePos[a] += (a === 0 ? move : -move) * mask[a];
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
        for (const p of sys.particles) {
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
          const halfX = (ps ? sz * ps[0] : sz) / 2;
          // 官方 genericparticle.vert: textureRatio = g_Texture0Resolution.y / x,
          // ComputeParticlePosition: up×(v-0.5)×textureRatio — 垂直尺寸乘纹理纵横比
          // (高/宽)。旧实现忽略 ratio → 非正方形粒子纹理 (流星 256×794/drop 32×128
          // 等 12 个) 被拉伸成正方形 (sf39g)。
          const ratio = tex && tex.width > 0 ? tex.height / tex.width : 1;
          const halfY = ((ps ? sz * ps[1] : sz) / 2) * ratio;
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
            const colorR = sys.color1[0] + (sys.color2[0] - sys.color1[0]) * p.color[0];
            const colorG = sys.color1[1] + (sys.color2[1] - sys.color1[1]) * p.color[0];
            const colorB = sys.color1[2] + (sys.color2[2] - sys.color1[2]) * p.color[0];
            // P1-24/MOD-22: 应用 p.rot (rotationrandom 初始化 + angularmovement 积分,
            // 旧实现只模拟不绘制 → 恒轴对方块)。逆旋转采样坐标与 canvas.blitRotated
            // 同款 (画布 y 向下, 屏幕逆时针正向 → 逆映射 R(+rot)); 扫描包围盒按
            // 旋转后对角线外扩 (halfX≠halfY, 纹理纵横比)。
            const rot = p.rot || 0;
            const cr = Math.cos(rot), sr = Math.sin(rot);
            let exX = halfX, exY = halfY;
            if (rot !== 0) {
              exX = halfX * Math.abs(cr) + halfY * Math.abs(sr);
              exY = halfX * Math.abs(sr) + halfY * Math.abs(cr);
            }
            const x0 = Math.floor(x - exX), y0 = Math.floor(y - exY);
            const x1 = Math.ceil(x + exX), y1 = Math.ceil(y + exY);
            for (let py = y0; py <= y1; py++) {
              if (py < 0 || py >= H) continue;
              for (let px = x0; px <= x1; px++) {
                if (px < 0 || px >= W) continue;
                const nx0 = (px - x) / halfX, ny0 = (py - y) / halfY;
                const nx = rot !== 0 ? nx0 * cr - ny0 * sr : nx0;
                const ny = rot !== 0 ? nx0 * sr + ny0 * cr : ny0;
                if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
                const u = (nx + 1) / 2, v = (ny + 1) / 2;
                // SPRITESHEET: 帧内 UV (帧区域归一化)
                let tu = u, tv = v, si;
                if (frameUV) {
                  tu = frameUV.x / tw + u * (frameUV.w / tw);
                  tv = frameUV.y / th + v * (frameUV.h / th);
                }
                si = (Math.min(th - 1, Math.floor(tv * th)) * tw + Math.min(tw - 1, Math.floor(tu * tw))) * 4;
                // 官方 genericparticle.frag: color = v_Color × tex.r (red 通道即形状,
                // chromaticdot 的 red 是渐变软点 中心175→边缘0, alpha 全 255 无软边)。
                // 旧实现加 smoothstep(0.2,0.7) 二次削边 → 68% 像素被削成硬边 (sf39g)。
                // 直接采样 red (官方语义), 保留纹理自带渐变软边。
                const texR = tex.rgba[si] / 255;
                if (texR <= 0.004) continue;
                const sa = a * texR;
                const di = (py * W + px) * 4;
                const sr = colorR * sa * 255, sg = colorG * sa * 255, sb = colorB * sa * 255;
                if (additive) {
                  // additive: dst += src*srcA (clamp)
                  canvas.data[di] = Math.min(255, canvas.data[di] + sr);
                  canvas.data[di + 1] = Math.min(255, canvas.data[di + 1] + sg);
                  canvas.data[di + 2] = Math.min(255, canvas.data[di + 2] + sb);
                  canvas.data[di + 3] = 255;
                } else {
                  const dstA = canvas.data[di + 3] / 255;
                  const outA = sa + dstA * (1 - sa);
                  if (outA <= 0) continue;
                  canvas.data[di] = Math.round((sr + canvas.data[di] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 1] = Math.round((sg + canvas.data[di + 1] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 2] = Math.round((sb + canvas.data[di + 2] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 3] = Math.round(outA * 255);
                }
              }
            }
          } else {
            // 无纹理: 圆形占位 (additive)
            const r = Math.max(1, (halfX + halfY) / 2);
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
      }
  });
}
