// WE 渲染引擎 — scene 层: 属性动画 ({animation} 烘焙 + 关键帧贝塞尔切线)
// 官方对应: 引擎 Tween 求值器 (c0/c1/c2 逐通道 + relative 偏移 + 贝塞尔切线)
// P1 重构: 从 core.js 拆出, 纯搬家零行为变化
export function installAnimation(proto) {
  Object.assign(proto, {
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
    },

    // 数值或 "x y z" 向量线性插值
    _lerpValue(a, b, k) {
      const pa = typeof a === 'string' ? a.trim().split(/\s+/).map(Number) : [a];
      const pb = typeof b === 'string' ? b.trim().split(/\s+/).map(Number) : [b];
      if (pa.length === 1 && pb.length === 1) return pa[0] + (pb[0] - pa[0]) * k;
      const out = pa.map((x, i) => x + ((pb[i] ?? x) - x) * k);
      return out.join(' ');
    },

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
    },
  });
}
