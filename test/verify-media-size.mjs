#!/usr/bin/env node
/**
 * verify-media-size.mjs — 方向筛选的尺寸探测守卫（#304）。
 *
 * 断言：
 *   A. 图片：PNG / JPEG / WebP（VP8X / VP8 / VP8L）/ GIF 的真实宽高；HTML / 截断头返回 null；
 *   B. 视频：合成 MP4 的 moov/trak/tkhd 宽高（横屏与竖屏各一）；
 *   C. 探测失败一律 null（调用方按「方向未知」处理）。
 */

import { jpegExifOrientation, parseImageSize, parseVideoSize } from '../lib/media/media-size.js';

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failed += 1;
};
const section = (title) => console.log('\n' + title);

const box = (type, payload) => {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 'latin1');
  payload.copy(out, 8);
  return out;
};
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };

section('A. 图片尺寸');
{
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR', 'latin1'),
    u32(1920), u32(1080),
    Buffer.from([8, 6, 0, 0, 0]),
  ]);
  const d = parseImageSize(png);
  check('PNG 1920×1080', d && d.width === 1920 && d.height === 1080, JSON.stringify(d));

  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
    Buffer.from([0x04, 0x38, 0x07, 0x80]),   // height 1080, width 1920
    Buffer.alloc(3 + 3 * 3, 0),
    Buffer.from([0xff, 0xd9]),
  ]);
  const dj = parseImageSize(jpeg);
  check('JPEG 1920×1080（无 EXIF，按存储宽高）', dj && dj.width === 1920 && dj.height === 1080, JSON.stringify(dj));

  const vp8x = Buffer.concat([
    Buffer.from('RIFF', 'latin1'), u32(30), Buffer.from('WEBP', 'latin1'),
    Buffer.from('VP8X', 'latin1'), u32(10),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([(1920 - 1) & 0xff, ((1920 - 1) >> 8) & 0xff, ((1920 - 1) >> 16) & 0xff]),
    Buffer.from([(1080 - 1) & 0xff, ((1080 - 1) >> 8) & 0xff, ((1080 - 1) >> 16) & 0xff]),
  ]);
  const dv = parseImageSize(vp8x);
  check('WebP VP8X 1920×1080', dv && dv.width === 1920 && dv.height === 1080, JSON.stringify(dv));

  const vp8lBits = ((800 - 1) | ((600 - 1) << 14)) >>> 0;
  const vp8l = Buffer.concat([
    Buffer.from('RIFF', 'latin1'), u32(30), Buffer.from('WEBP', 'latin1'),
    Buffer.from('VP8L', 'latin1'), u32(10),
    Buffer.from([0x2f]), u32le(vp8lBits),
  ]);
  const dl = parseImageSize(vp8l);
  check('WebP VP8L 800×600', dl && dl.width === 800 && dl.height === 600, JSON.stringify(dl));

  const vp8 = Buffer.concat([
    Buffer.from('RIFF', 'latin1'), u32(30), Buffer.from('WEBP', 'latin1'),
    Buffer.from('VP8 ', 'latin1'), u32(10),
    Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a]),
    Buffer.from([1920 & 0xff, (1920 >> 8) & 0x3f, 1080 & 0xff, (1080 >> 8) & 0x3f]),
  ]);
  const d8 = parseImageSize(vp8);
  check('WebP VP8 1920×1080', d8 && d8.width === 1920 && d8.height === 1080, JSON.stringify(d8));

  const gif = Buffer.concat([
    Buffer.from('GIF89a', 'latin1'),
    Buffer.from([800 & 0xff, (800 >> 8) & 0xff, 600 & 0xff, (600 >> 8) & 0xff]),
    Buffer.alloc(4),
  ]);
  const dg = parseImageSize(gif);
  check('GIF 800×600', dg && dg.width === 800 && dg.height === 600, JSON.stringify(dg));

  check('HTML 不被当成图片', parseImageSize(Buffer.from('<html>404</html>')) === null);
  check('截断的 PNG 头返回 null', parseImageSize(png.subarray(0, 12)) === null);
}

section('A2. JPEG EXIF Orientation（竖拍照片存成横像素）');
{
  // APP1/Exif（小端 TIFF）+ 一个只有 Orientation 的 IFD0 + SOF0 1080×1920 存储像素。
  const makeJpeg = (orientation) => {
    const tiff = Buffer.alloc(8 + 2 + 12 + 4);
    tiff.write('II', 0, 'latin1');
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);            // IFD0 紧跟 TIFF 头
    tiff.writeUInt16LE(1, 8);            // 一个条目
    tiff.writeUInt16LE(0x0112, 10);      // Orientation
    tiff.writeUInt16LE(3, 12);           // SHORT
    tiff.writeUInt32LE(1, 14);           // count
    tiff.writeUInt16LE(orientation, 18);
    tiff.writeUInt16LE(0, 20);
    tiff.writeUInt32LE(0, 22);           // next IFD
    const app1Body = Buffer.concat([Buffer.from('Exif\u0000\u0000', 'latin1'), tiff]);
    const app1 = Buffer.concat([
      Buffer.from([0xff, 0xe1]),
      Buffer.from([((app1Body.length + 2) >> 8) & 0xff, (app1Body.length + 2) & 0xff]),
      app1Body,
    ]);
    const sof = Buffer.concat([
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
      Buffer.from([0x07, 0x80, 0x04, 0x38]),   // 存储高 1920、宽 1080
      Buffer.alloc(3 + 3 * 3, 0),
    ]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]);
  };
  check('EXIF Orientation 解析（6 = 顺时针 90°）', jpegExifOrientation(makeJpeg(6)) === 6);
  const o6 = parseImageSize(makeJpeg(6));
  check('Orientation 6 ⇒ 交换宽高（显示 1920×1080）', o6 && o6.width === 1920 && o6.height === 1080, JSON.stringify(o6));
  const o8 = parseImageSize(makeJpeg(8));
  check('Orientation 8 ⇒ 交换宽高（显示 1920×1080）', o8 && o8.width === 1920 && o8.height === 1080, JSON.stringify(o8));
  const o3 = parseImageSize(makeJpeg(3));
  check('Orientation 3（纯旋转 180°）⇒ 宽高不交换', o3 && o3.width === 1080 && o3.height === 1920, JSON.stringify(o3));
  const o1 = parseImageSize(makeJpeg(1));
  check('Orientation 1（正常）⇒ 宽高不交换', o1 && o1.width === 1080 && o1.height === 1920, JSON.stringify(o1));
  check('无 EXIF 的 JPEG ⇒ orientation 0', jpegExifOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x00, 0x00, 0x00])) === 0);
}

section('B. 视频尺寸（MP4 tkhd）');
{
  const matrix = (a, b, c, d) => {
    const out = Buffer.alloc(36);
    const put = (v, at) => out.writeInt32BE(Math.round(v * 65536), at);
    put(a, 0); put(b, 4); out.writeInt32BE(0, 8);
    put(c, 12); put(d, 16); out.writeInt32BE(0, 20);
    out.writeInt32BE(0, 24); out.writeInt32BE(0, 28);
    out.writeInt32BE(0x40000000, 32);
    return out;
  };
  const make = (w, h, m) => {
    const tkhd = box('tkhd', Buffer.concat([Buffer.alloc(40), m || matrix(1, 0, 0, 1), u32(w << 16), u32(h << 16)]));
    const moov = box('moov', box('trak', tkhd));
    return Buffer.concat([box('ftyp', Buffer.alloc(8)), moov]);
  };
  const landscape = make(1920, 1080);
  const dl = await parseVideoSize(landscape, landscape.length);
  check('MP4 横屏 1920×1080', dl && dl.width === 1920 && dl.height === 1080, JSON.stringify(dl));
  const portrait = make(1080, 1920);
  const dp = await parseVideoSize(portrait, portrait.length);
  check('MP4 竖屏 1080×1920', dp && dp.width === 1080 && dp.height === 1920, JSON.stringify(dp));
  // 手机竖拍：像素存成 1920×1080 + 90° 矩阵 ⇒ 显示为 1080×1920。
  const rotated = make(1920, 1080, matrix(0, 1, -1, 0));
  const dr = await parseVideoSize(rotated, rotated.length);
  check('tkhd 90° 矩阵 ⇒ 交换宽高（显示 1080×1920）', dr && dr.width === 1080 && dr.height === 1920, JSON.stringify(dr));
  const rotated270 = make(1920, 1080, matrix(0, -1, 1, 0));
  const dr2 = await parseVideoSize(rotated270, rotated270.length);
  check('tkhd 270° 矩阵 ⇒ 交换宽高', dr2 && dr2.width === 1080 && dr2.height === 1920, JSON.stringify(dr2));
  check('无 moov 的 MP4 返回 null', (await parseVideoSize(box('ftyp', Buffer.alloc(8)), 16)) === null);
  check('损坏的 tkhd（0 宽高）返回 null', await (() => {
    const tkhd = box('tkhd', Buffer.alloc(84));
    const bad = Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', box('trak', tkhd))]);
    return parseVideoSize(bad, bad.length).then((v) => v === null);
  })());
}

section('B2. 伪造 moov 的加固（不按声明 size 整段读、不逐字节扫）');
{
  // 头部窗口里每 8 字节一个 `moov(size=0)`：旧实现会逐个候选放大。
  const evil = Buffer.alloc(64 * 1024);
  for (let i = 0; i + 8 <= evil.length; i += 8) {
    evil.writeUInt32BE(0, i);
    evil.write('moov', i + 4, 'latin1');
  }
  const started = Date.now();
  const result = await parseVideoSize(evil, 200 * 1024 * 1024, null, 0);
  const elapsed = Date.now() - started;
  check('伪 moov 头窗口 ⇒ 快速返回 null（不逐字节放大）', result === null && elapsed < 200, result + ' / ' + elapsed + 'ms');

  let readCalls = 0;
  let maxRead = 0;
  const fakeRead = (offset, size) => {
    readCalls += 1;
    maxRead = Math.max(maxRead, size);
    return Buffer.alloc(size);
  };
  const declared = Buffer.alloc(16);
  declared.writeUInt32BE(0, 0);            // size = 0 ⇒ "到文件尾"
  declared.write('moov', 4, 'latin1');
  const big = await parseVideoSize(declared, 200 * 1024 * 1024, fakeRead, 0);
  check('size=0 的 moov ⇒ 单次补读有上限（≤ 8 MB）', big === null && maxRead <= 8 * 1024 * 1024,
    'reads=' + readCalls + ' maxRead=' + maxRead);
  check('补读次数有上限（≤ 2 次）', readCalls <= 2, 'reads=' + readCalls);
}

section('C. 未知输入');
check('空 buffer 返回 null', parseImageSize(Buffer.alloc(0)) === null && (await parseVideoSize(Buffer.alloc(0), 0)) === null);

if (failed) {
  console.log('\nMEDIA SIZE CHECKS FAILED：' + failed + ' 条');
  process.exit(1);
}
console.log('\nMEDIA SIZE CHECKS PASSED');
