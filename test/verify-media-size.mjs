#!/usr/bin/env node
/**
 * verify-media-size.mjs — 方向筛选的尺寸探测守卫（#304）。
 *
 * 断言：
 *   A. 图片：PNG / JPEG / WebP（VP8X / VP8 / VP8L）/ GIF 的真实宽高；HTML / 截断头返回 null；
 *   B. 视频：合成 MP4 的 moov/trak/tkhd 宽高（横屏与竖屏各一）；
 *   C. 探测失败一律 null（调用方按「方向未知」处理）。
 */

import { parseImageSize, parseVideoSize } from '../lib/media/media-size.js';

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
  check('JPEG 1920×1080（竖图 1080×1920）', dj && dj.width === 1920 && dj.height === 1080, JSON.stringify(dj));

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

section('B. 视频尺寸（MP4 tkhd）');
{
  const make = (w, h) => {
    const tkhd = box('tkhd', Buffer.concat([Buffer.alloc(76), u32(w << 16), u32(h << 16)]));
    const moov = box('moov', box('trak', tkhd));
    return Buffer.concat([box('ftyp', Buffer.alloc(8)), moov]);
  };
  const landscape = make(1920, 1080);
  const dl = parseVideoSize(landscape, landscape.length);
  check('MP4 横屏 1920×1080', dl && dl.width === 1920 && dl.height === 1080, JSON.stringify(dl));
  const portrait = make(1080, 1920);
  const dp = parseVideoSize(portrait, portrait.length);
  check('MP4 竖屏 1080×1920', dp && dp.width === 1080 && dp.height === 1920, JSON.stringify(dp));
  check('无 moov 的 MP4 返回 null', parseVideoSize(box('ftyp', Buffer.alloc(8)), 16) === null);
  check('损坏的 tkhd（0 宽高）返回 null', (() => {
    const tkhd = box('tkhd', Buffer.alloc(84));
    const bad = Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', box('trak', tkhd))]);
    return parseVideoSize(bad, bad.length) === null;
  })());
}

section('C. 未知输入');
check('空 buffer 返回 null', parseImageSize(Buffer.alloc(0)) === null && parseVideoSize(Buffer.alloc(0), 0) === null);

if (failed) {
  console.log('\nMEDIA SIZE CHECKS FAILED：' + failed + ' 条');
  process.exit(1);
}
console.log('\nMEDIA SIZE CHECKS PASSED');
