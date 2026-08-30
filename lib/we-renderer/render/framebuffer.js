// WE 渲染引擎 — render 层: FrameBuffer 抽象 (CPU 后端) + 图像操作
// 官方对应: wallpaper64.exe 的 FBO/交换链管理。
// P3 重构: 定义渲染缓冲的统一载体与核心图像操作 (downsample 从 core._downsample 收敛)。
// 约定: 效果管线内流转的"图像"是 {width,height,rgba} 形状 (kernels/GPU 路径都读
// 这三个字段); FrameBuffer 是同一形状的类封装 (getter 兼容), 供 render 层创建/
// 持有缓冲; P4 Dawn 后端将以同一接口提供 GPU 纹理/FBO 实现。
// ⚠ 不要给管线内图像包 FrameBuffer 后传回 — GLSL 多 pass 路径会原地改写
//   target.rgba (integration.js/gl-multipass.js), getter 只读会抛错。

/** 轻量 RGBA 图像缓冲 (形状兼容 {width,height,rgba}) */
export class FrameBuffer {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  get width() { return this.w; }
  get height() { return this.h; }
  get rgba() { return this.data; }
  clear(r = 0, g = 0, b = 0, a = 0) { this.data.fill(0); return this; }
  clone() {
    const f = new FrameBuffer(this.w, this.h);
    f.data.set(this.data);
    return f;
  }
  /** 导出为 {width,height,rgba} 形状 (共享 data, 零拷贝) */
  toImage() { return { width: this.w, height: this.h, rgba: this.data }; }
  /** 从 {width,height,rgba} 形状包装 (共享 data, 零拷贝); 已是 FrameBuffer 原样返回 */
  static fromImage(img) {
    if (img instanceof FrameBuffer) return img;
    const f = new FrameBuffer(img.width, img.height);
    if (img.rgba && img.rgba.length >= f.data.length) f.data = img.rgba;
    return f;
  }
  /** 从 Canvas 取当前像素 (拷贝) */
  static fromCanvas(canvas) {
    const f = new FrameBuffer(canvas.w, canvas.h);
    f.data.set(canvas.data);
    return f;
  }
}

export function createFrameBuffer(w, h) { return new FrameBuffer(w, h); }

// 等比降采样 (box 滤波) — 从 core._downsample 收敛 (逻辑逐字一致):
// 效果/渲染前把大纹理缩到 maxSize, 提速 CPU 逐像素
// (官方 GPU 并行处理全分辨率; CPU 用降采样近似, 效果是低频扰动损失小)
export function downsampleImage(tex, maxSize) {
  const w = tex.width, h = tex.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  if (scale >= 1) return tex;
  const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
  const src = tex.rgba;
  const out = new Uint8Array(tw * th * 4);
  const sx = w / tw, sy = h / th;
  for (let y = 0; y < th; y++) {
    const sy0 = Math.floor(y * sy), sy1 = Math.min(h, Math.ceil((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const sx0 = Math.floor(x * sx), sx1 = Math.min(w, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        const row = yy * w;
        for (let xx = sx0; xx < sx1; xx++) {
          const i = (row + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
          n++;
        }
      }
      const di = (y * tw + x) * 4;
      out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = a / n;
    }
  }
  return { width: tw, height: th, rgba: out };
}
