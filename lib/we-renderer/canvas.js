// WE 渲染引擎 — 画布 (RGBA 缓冲 + 合成操作) 与 PNG 编解码
import zlib from 'node:zlib';
import { applyBlending } from './math.js';

export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8Array(w * h * 4); this.zbuf = new Float32Array(w * h); this.zbuf.fill(Infinity); this.rev = 0; }
  // rev = 内容版本号 (clear/写入时 +1) — _rt_ 快照缓存 (BASE-11) 判失效用
  clear(r = 0, g = 0, b = 0, a = 0) {
    // 旧实现无视参数恒填 0（clearcolor 从未生效 — 未覆盖区域透明黑而非场景底色）
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
    this.zbuf.fill(Infinity);
    this.rev++;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i+1], this.data[i+2], this.data[i+3]];
  }
  set(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i+1] = g; this.data[i+2] = b; this.data[i+3] = a;
    this.rev++;
  }
  // source-over 合成一个已解码纹理 (直接像素拷贝, 无缩放)
  blit(img, dx, dy, alpha = 1) {
    this.rev++;
    const x0 = Math.floor(dx), y0 = Math.floor(dy);
    for (let ty = y0; ty < y0 + img.height; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      for (let tx = x0; tx < x0 + img.width; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        const sx = tx - x0, sy = ty - y0;
        const si = (sy * img.width + sx) * 4;
        const a = img.rgba[si + 3] / 255 * alpha;
        if (a <= 0) continue;
        const di = (ty * this.w + tx) * 4;
        const dstA = this.data[di + 3] / 255;
        const outA = a + dstA * (1 - a);
        this.data[di] = Math.round((img.rgba[si] * a + this.data[di] * dstA * (1 - a)) / outA);
        this.data[di+1] = Math.round((img.rgba[si+1] * a + this.data[di+1] * dstA * (1 - a)) / outA);
        this.data[di+2] = Math.round((img.rgba[si+2] * a + this.data[di+2] * dstA * (1 - a)) / outA);
        this.data[di+3] = Math.round(outA * 255);
      }
    }
  }
  // 带缩放的 blit (真双线性 4-tap 边缘钳制, 与 blitRotated 同款写法; 支持负 dw/dh
  // = 水平/垂直镜像, scale.x<0)。P0-2: 旧实现 Math.round 最近邻与注释"bilinear"不符;
  // P0-3/BASE-01: 旧实现 flip 时源偏移按 dx 计算 → (x0-dx)=dw<0 → clamp 全钉 0 →
  // 整列/整行单色条 (flipY 镜像语句完全缺失)。
  // blendMode > 0 → 用官方 ApplyBlending(mode, 画布色A, 源色B, 源alpha) 颜色混合 (colorBlendMode)
  blitScaled(img, dx, dy, dw, dh, alpha = 1, blendMode = 0) {
    if (dw === 0 || dh === 0) return;
    this.rev++;
    const flipX = dw < 0, flipY = dh < 0;
    const x0 = Math.floor(flipX ? dx + dw : dx), y0 = Math.floor(flipY ? dy + dh : dy);
    const x1 = Math.ceil(flipX ? dx : dx + dw), y1 = Math.ceil(flipY ? dy : dy + dh);
    const invDw = img.width / Math.abs(dw), invDh = img.height / Math.abs(dh);
    // 反向映射基准: 目标像素中心 → 连续源坐标 (半像素对齐), 相对矩形前导边;
    // flip 时前导边在 dx+dw / dy+dh — 翻转在连续源坐标上做 (插值对称正确)
    const srcX0 = (x0 + 0.5 - (flipX ? dx + dw : dx)) * invDw - 0.5;
    const srcY0 = (y0 + 0.5 - (flipY ? dy + dh : dy)) * invDh - 0.5;
    const w1 = img.width - 1, h1 = img.height - 1;
    const rgba = img.rgba;
    for (let ty = y0; ty < y1; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      let sy = srcY0 + (ty - y0) * invDh;
      if (flipY) sy = h1 - sy;
      sy = Math.min(h1, Math.max(0, sy));
      const sj0 = sy | 0, fy = sy - sj0;
      const rowA = sj0 * img.width, rowB = Math.min(h1, sj0 + 1) * img.width;
      for (let tx = x0; tx < x1; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        let sx = srcX0 + (tx - x0) * invDw;
        if (flipX) sx = w1 - sx;
        sx = Math.min(w1, Math.max(0, sx));
        const si0 = sx | 0, fx = sx - si0;
        const si1 = Math.min(w1, si0 + 1);
        const i00 = (rowA + si0) * 4, i10 = (rowA + si1) * 4, i01 = (rowB + si0) * 4, i11 = (rowB + si1) * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const a = (rgba[i00 + 3] * w00 + rgba[i10 + 3] * w10 + rgba[i01 + 3] * w01 + rgba[i11 + 3] * w11) / 255 * alpha;
        if (a <= 0) continue;
        const r = rgba[i00] * w00 + rgba[i10] * w10 + rgba[i01] * w01 + rgba[i11] * w11;
        const g = rgba[i00 + 1] * w00 + rgba[i10 + 1] * w10 + rgba[i01 + 1] * w01 + rgba[i11 + 1] * w11;
        const b = rgba[i00 + 2] * w00 + rgba[i10 + 2] * w10 + rgba[i01 + 2] * w01 + rgba[i11 + 2] * w11;
        const di = (ty * this.w + tx) * 4;
        const dstA = this.data[di + 3] / 255;
        const outA = a + dstA * (1 - a);
        if (blendMode > 0) {
          // 官方 passthroughblend: ApplyBlending(mode, screen.rgb, albedo.rgb, albedo.a)
          // 两路合成归一化一致: blend 路同样走 source-over 加权 + /outA
          // (旧实现直接覆盖 RGB、丢弃画布底色贡献, 与普通路不一致)
          const A = [this.data[di] / 255, this.data[di + 1] / 255, this.data[di + 2] / 255];
          const B = [r / 255, g / 255, b / 255];
          const blended = applyBlending(blendMode, A, B, a);
          this.data[di] = Math.round((blended[0] * a + this.data[di] * dstA * (1 - a)) / outA);
          this.data[di+1] = Math.round((blended[1] * a + this.data[di + 1] * dstA * (1 - a)) / outA);
          this.data[di+2] = Math.round((blended[2] * a + this.data[di + 2] * dstA * (1 - a)) / outA);
          this.data[di+3] = Math.round(outA * 255);
          continue;
        }
        this.data[di] = Math.round((r * a + this.data[di] * dstA * (1 - a)) / outA);
        this.data[di+1] = Math.round((g * a + this.data[di+1] * dstA * (1 - a)) / outA);
        this.data[di+2] = Math.round((b * a + this.data[di+2] * dstA * (1 - a)) / outA);
        this.data[di+3] = Math.round(outA * 255);
      }
    }
  }
  // 带缩放 + 旋转的 blit: 以中心 (cx, cy) 旋转 angle 弧度 (正角 = 屏幕逆时针,
  // WE-REVERSE §9.4 裁决), 目标尺寸 dw×dh
  // 反向映射: 目标像素 → 逆旋转 → 源矩形 → 双线性采样 (引擎 CImage 角度语义)。
  // P0-1: 画布 y 向下, 屏幕逆时针的正向变换是代数 R(-angle) → 逆映射用 R(+angle);
  // 旧实现 cos(-angle)/sin(-angle) 把逆映射也转 -angle → 内容呈顺时针 (方向反)。
  blitRotated(img, cx, cy, dw, dh, angle, alpha = 1) {
    this.rev++;
    // 负 dw/dh = 绕中心镜像 (负 scale 语义, 与 blitScaled 的 flipX/flipY 等价)。
    // 先把负尺寸归一化为正 + 镜像标记, 再旋转 — 避免负 invDw 导致源 UV 翻转
    // 且包围盒错误 (旧实现负尺寸完全不渲染: sx 越界被 continue 跳过)。
    const flipX = dw < 0, flipY = dh < 0;
    const adw = Math.abs(dw), adh = Math.abs(dh);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const halfW = adw / 2, halfH = adh / 2;
    // 旋转后包围盒 (保守扫描范围)
    const absC = Math.abs(cos), absS = Math.abs(sin);
    const rw = halfW * absC + halfH * absS, rh = halfW * absS + halfH * absC;
    const x0 = Math.floor(cx - rw), y0 = Math.floor(cy - rh);
    const x1 = Math.ceil(cx + rw), y1 = Math.ceil(cy + rh);
    const invDw = img.width / adw, invDh = img.height / adh;
    for (let ty = y0; ty < y1; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      for (let tx = x0; tx < x1; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        // 逆旋转到未旋转坐标 (相对中心)
        const ox = tx - cx, oy = ty - cy;
        const ux = ox * cos - oy * sin;
        const uy = ox * sin + oy * cos;
        // 矩形归属判定用未旋转连续坐标 (旧实现用源坐标 sx>=w 判外 → 右/下缘
        // 恰落在边界上的像素被跳过, 旋转对象右/下缘缺一列/行)
        if (ux < -halfW || ux > halfW || uy < -halfH || uy > halfH) continue;
        // 未旋转矩形内 → 源 UV (负尺寸: 翻转 ux/uy 实现镜像)
        let sux = ux, suy = uy;
        if (flipX) sux = -sux;
        if (flipY) suy = -suy;
        const sx = Math.min(img.width - 1, Math.max(0, (sux + halfW) * invDw));
        const sy = Math.min(img.height - 1, Math.max(0, (suy + halfH) * invDh));
        const si0 = sx | 0;
        const sj0 = sy | 0;
        const fx = sx - si0, fy = sy - sj0;
        const i0 = (sj0 * img.width + si0) * 4;
        const i1 = (sj0 * img.width + Math.min(img.width - 1, si0 + 1)) * 4;
        const i2 = (Math.min(img.height - 1, sj0 + 1) * img.width + si0) * 4;
        const i3 = (Math.min(img.height - 1, sj0 + 1) * img.width + Math.min(img.width - 1, si0 + 1)) * 4;
        const a = (img.rgba[i0 + 3] * (1 - fx) * (1 - fy) + img.rgba[i1 + 3] * fx * (1 - fy)
          + img.rgba[i2 + 3] * (1 - fx) * fy + img.rgba[i3 + 3] * fx * fy) / 255 * alpha;
        if (a <= 0) continue;
        const r = img.rgba[i0] * (1 - fx) * (1 - fy) + img.rgba[i1] * fx * (1 - fy)
          + img.rgba[i2] * (1 - fx) * fy + img.rgba[i3] * fx * fy;
        const g = img.rgba[i0 + 1] * (1 - fx) * (1 - fy) + img.rgba[i1 + 1] * fx * (1 - fy)
          + img.rgba[i2 + 1] * (1 - fx) * fy + img.rgba[i3 + 1] * fx * fy;
        const b = img.rgba[i0 + 2] * (1 - fx) * (1 - fy) + img.rgba[i1 + 2] * fx * (1 - fy)
          + img.rgba[i2 + 2] * (1 - fx) * fy + img.rgba[i3 + 2] * fx * fy;
        const di = (ty * this.w + tx) * 4;
        const dstA = this.data[di + 3] / 255;
        const outA = a + dstA * (1 - a);
        if (outA <= 0) continue;
        this.data[di] = Math.round((r * a + this.data[di] * dstA * (1 - a)) / outA);
        this.data[di + 1] = Math.round((g * a + this.data[di + 1] * dstA * (1 - a)) / outA);
        this.data[di + 2] = Math.round((b * a + this.data[di + 2] * dstA * (1 - a)) / outA);
        this.data[di + 3] = Math.round(outA * 255);
      }
    }
  }
}

// ── PNG 编码 (filter 0) ────────────────────────────────────────
// crc32 查表提模块级 (旧实现在 crc32() 里每次重建 256 项表)
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) crc = CRC32_TABLE[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function encodePng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── PNG 解码 (RGBA/RGB/灰度/灰度+alpha 8bit, filter 0-4) ─────────
// 硬化 (P-08/F-9, 上限与 GL 路径 scene-manifest.js decodePngToRgba 一致):
// workshop 文件不可信 → 维度/像素/IDAT/inflate maxOutputLength 上限 + 行长/截断
// 校验 — 截断必须抛错, 不许静默出黑/花屏。
const MAX_TEX_DIMENSION = 16384;
const MAX_TEX_PIXELS = 64 * 1024 * 1024;
const MAX_IDAT_BYTES = 256 * 1024 * 1024;
// colorType → 每像素字节数 (4 = 8bit 灰度+alpha 是 2 字节/px, 旧实现误当 4 通道
// → stride 翻倍 → 整图错位; 3 = palette 不支持)
const PNG_CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
export function decodePngBuffer(b) {
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) throw new Error('not a png');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = -1;
  let idatBytes = 0;
  const idatChunks = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);
      if (!(colorType in PNG_CHANNELS)) throw new Error('unsupported color type ' + colorType);
      if (width <= 0 || height <= 0 || width > MAX_TEX_DIMENSION || height > MAX_TEX_DIMENSION
        || width * height > MAX_TEX_PIXELS) {
        throw new Error('png invalid dimensions ' + width + 'x' + height);
      }
      // 隔行 (Adam7, IHDR[12]) 不支持 → 显式抛错 (旧实现静默解出花屏)
      if (data[12]) throw new Error('interlaced png unsupported');
    } else if (type === 'IDAT') {
      idatChunks.push(data);
      idatBytes += data.length;
      if (idatBytes > MAX_IDAT_BYTES) throw new Error('png idat stream too large (' + idatBytes + ' bytes)');
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (colorType < 0 || width <= 0 || height <= 0) throw new Error('png missing IHDR');
  const channels = PNG_CHANNELS[colorType];
  const stride = width * channels;
  const rowLen = stride + 1;
  // inflate 输出上限 = 恰好所需行字节数 (+64 冗余): 解压炸弹/坏流直接抛错
  const raw = zlib.inflateSync(Buffer.concat(idatChunks), { maxOutputLength: height * rowLen + 64 });
  // 行数不足 (流完整但数据短于声明行数) → 抛错, 不静默出黑
  if (raw.length < height * rowLen) {
    throw new Error('png truncated pixel data (' + raw.length + ' < ' + height * rowLen + ' bytes)');
  }
  const rgba = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const out = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * rowLen];
    const row = raw.subarray(y * rowLen + 1, (y + 1) * rowLen);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const bb = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + bb) & 0xff;
      else if (filter === 3) v = (v + ((a + bb) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + bb - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c);
        v = (v + pr) & 0xff;
      }
      out[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (channels === 4) {
        rgba[di] = out[x * 4]; rgba[di + 1] = out[x * 4 + 1]; rgba[di + 2] = out[x * 4 + 2]; rgba[di + 3] = out[x * 4 + 3];
      } else if (channels === 3) {
        rgba[di] = out[x * 3]; rgba[di + 1] = out[x * 3 + 1]; rgba[di + 2] = out[x * 3 + 2]; rgba[di + 3] = 255;
      } else if (channels === 2) {
        // 灰度+alpha: 灰度复制到 RGB + alpha
        rgba[di] = out[x * 2]; rgba[di + 1] = out[x * 2]; rgba[di + 2] = out[x * 2]; rgba[di + 3] = out[x * 2 + 1];
      } else {
        rgba[di] = out[x]; rgba[di + 1] = out[x]; rgba[di + 2] = out[x]; rgba[di + 3] = 255;
      }
    }
    prev.set(out);
  }
  return { width, height, rgba };
}
