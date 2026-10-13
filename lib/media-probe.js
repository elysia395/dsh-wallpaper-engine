/**
 * media-probe.js —— MP4/MOV 容器探测：**一次 moov 盒走读**，回答
 * `{ width, height, codec, fps, duration, moovStart, moovSize }`。
 *
 * 为什么单独一个模块：这份盒表走读有**两个互不相干的消费者**，抄成两份就会各自漂移：
 *   · **抽帧上限的决策** —— `getMediaInfo` 的答案同时喂给 `/media-info`（面板提示
 *     "源 4K · 120fps · H.264"）与 `runFfmpegTranscode`：源帧率 ≤ 上限就整段跳过转码，
 *     探测结果直接决定要不要起 ffmpeg。
 *   · **faststart 判据** —— `moovStart` / `moovSize` 就是「moov 落在头部还是尾部」这个
 *     事实本身（见 lib/mp4-vfs.js：搬 moov 的虚拟布局只在 moov 落尾时才需要）。
 *
 * ⚠️ **三条不变量**（改动时别在这里写岔）：
 *   ① **只读源文件、绝不改写**：走读用 `openSync(abs, 'r')`，`finally` 里必 `closeSync`。
 *   ② **头尾各采一段**（各 ≤8MB）：faststart 文件的 moov 在前 1MB 内、普通文件的 moov 贴
 *      EOF —— 两段用 `anchoredToEof` 区分，避免把 mdat 里偶然出现的 'moov' 字节串当成真盒
 *      （假阳性会让 fps/尺寸读数变成垃圾）。
 *   ③ **缓存键含 size + mtime**：同一绝对路径换文件后必须重新探测；缓存是**惰性淘汰**
 *      （>500 条时删最老的一条），不是定时清理 —— 它只是加速重复查询，不是真源。
 *
 * 调用点（`lib/index.js` 顶层静态 import）：① 传进 `registerMediaDerivedRoutes`
 * （`/media-info` 的答案、`/transcoded` 的决策）；② `runFfmpegTranscode` 里算实时进度的
 * 像素数。除此之外无副作用：模块加载期只建一个空 Map。
 */
import { openSync, readSync, fstatSync, closeSync, existsSync, statSync } from 'node:fs';

const MEDIA_INFO_CACHE = new Map();
const VIDEO_CODECS = new Set(['avc1', 'hvc1', 'hev1', 'av01', 'vp09', 'mp4v']);

function readBoxes(buf, start, end, onBox) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) break;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) break;
    if (onBox(type, off, size, header)) return;
    off += size;
  }
}

function boxChild(buf, container, type) {
  let found = null;
  readBoxes(buf, container.off + container.header, container.off + container.size,
    (t, o, s, h) => { if (t === type) { found = { off: o, size: s, header: h }; return true; } return false; });
  return found;
}

function probeMp4(abs) {
  const fd = openSync(abs, 'r');
  try {
    const fileSize = fstatSync(fd).size;
    if (fileSize < 64) return null;
    const headLen = Math.min(fileSize, 8 * 1024 * 1024);
    const tailLen = Math.min(fileSize, 8 * 1024 * 1024);
    const head = Buffer.alloc(headLen);
    const tail = Buffer.alloc(tailLen);
    let read = 0;
    while (read < headLen) {
      const n = readSync(fd, head, read, headLen - read, read);
      if (n <= 0) break;
      read += n;
    }
    read = 0;
    while (read < tailLen) {
      const n = readSync(fd, tail, read, tailLen - read, fileSize - tailLen + read);
      if (n <= 0) break;
      read += n;
    }
    // Head candidates must live in the first 1MB (faststart); tail candidates
    // must END at (or just before) EOF — filters out random 'moov' runs in mdat.
    const findMoov = (buf, bufStart, anchoredToEof, limit) => {
      const scanEnd = Math.min(buf.length - 4, limit || buf.length);
      for (let i = scanEnd; i >= 4; i--) {
        if (buf[i] === 0x6d && buf[i + 1] === 0x6f && buf[i + 2] === 0x6f && buf[i + 3] === 0x76) {
          const s = buf.readUInt32BE(i - 4);
          const start = bufStart + i - 4;
          if (s >= 8 && start >= 0 && start + s <= fileSize + 8) {
            if (!anchoredToEof || (start + s >= fileSize - 128)) return { start, size: s };
          }
        }
      }
      return null;
    };
    const moov = findMoov(head, 0, false, 1024 * 1024)
      || findMoov(tail, fileSize - tailLen, true, tailLen);
    if (!moov) return null;
    const moovBuf = Buffer.alloc(moov.size);
    read = 0;
    while (read < moov.size) {
      const n = readSync(fd, moovBuf, read, moov.size - read, moov.start + read);
      if (n <= 0) break;
      read += n;
    }
    const moovEnd = moov.size;
    const traks = [];
    readBoxes(moovBuf, 8, moovEnd, (t, o, s, h) => { if (t === 'trak') traks.push({ off: o, size: s, header: h }); return false; });
    let best = null;
    for (const trak of traks) {
      const mdia = boxChild(moovBuf, trak, 'mdia');
      if (!mdia) continue;
      const hdlr = boxChild(moovBuf, mdia, 'hdlr');
      if (hdlr && moovBuf.toString('latin1', hdlr.off + hdlr.header + 8, hdlr.off + hdlr.header + 12) !== 'vide') continue;
      const mdhd = boxChild(moovBuf, mdia, 'mdhd');
      const minf = boxChild(moovBuf, mdia, 'minf');
      const stbl = minf ? boxChild(moovBuf, minf, 'stbl') : null;
      const stsd = stbl ? boxChild(moovBuf, stbl, 'stsd') : null;
      const stts = stbl ? boxChild(moovBuf, stbl, 'stts') : null;
      const info = { width: 0, height: 0, codec: null, fps: null };
      if (stsd) {
        const entryStart = stsd.off + stsd.header + 8;
        if (entryStart + 52 <= moovEnd) {
          const codec = moovBuf.toString('latin1', entryStart + 4, entryStart + 8);
          if (VIDEO_CODECS.has(codec)) {
            info.codec = codec;
            info.width = moovBuf.readUInt16BE(entryStart + 32);
            info.height = moovBuf.readUInt16BE(entryStart + 34);
          }
        }
      }
      if (mdhd && info.codec) {
        // mdhd 字段偏移**相对盒头之后**（version/flags 起算）：
        //   v0: creation@4(4B) modification@8(4B) → **timescale@12(4B)** → **duration@16(4B)**
        //   v1: creation@4(8B) modification@12(8B) → **timescale@20(**仍 4B**)** → **duration@24(8B)**
        // v1 的 timescale 是 4 字节不是 8 字节（64 位化的只是 creation/modification/duration）；
        // 曾把 v1 读成 u64@20/u64@28 ⇒ timescale 被读成 timescale<<32、fps 变 206158430208 这种垃圾。
        // 判据：test/verify-media-probe.mjs 的 D3（v1 走 64 位分支）+ D4（同字节流改回 v0 必须变读数）。
        const ver = moovBuf.readUInt8(mdhd.off + mdhd.header);
        const timescale = ver === 1
          ? moovBuf.readUInt32BE(mdhd.off + mdhd.header + 20)
          : moovBuf.readUInt32BE(mdhd.off + mdhd.header + 12);
        const duration = ver === 1
          ? Number(moovBuf.readBigUInt64BE(mdhd.off + mdhd.header + 24))
          : moovBuf.readUInt32BE(mdhd.off + mdhd.header + 16);
        if (timescale > 0 && duration > 0) {
          info.duration = Math.round((duration / timescale) * 100) / 100;
          if (stts) {
            const entryCount = moovBuf.readUInt32BE(stts.off + stts.header + 4);
            let samples = 0, ticks = 0;
            for (let i = 0; i < entryCount; i++) {
              const e = stts.off + stts.header + 8 + i * 8;
              if (e + 8 > moovEnd) break;
              const cnt = moovBuf.readUInt32BE(e);
              const delta = moovBuf.readUInt32BE(e + 4);
              samples += cnt; ticks += cnt * delta;
            }
            if (ticks > 0) info.fps = Math.round((samples * timescale / ticks) * 100) / 100;
          }
        }
      }
      if (info.codec) { best = info; break; }
    }
    if (best && (best.fps || best.width)) {
      // moov 位置：faststart 判据（见 needsFaststart）+ 诊断口径。
      best.moovStart = moov.start;
      best.moovSize = moov.size;
      return best;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function getMediaInfo(abs) {
  if (!abs || !existsSync(abs)) return null;
  const st = statSync(abs);
  const key = abs + '|' + st.size + '|' + Math.round(st.mtimeMs);
  if (MEDIA_INFO_CACHE.has(key)) return MEDIA_INFO_CACHE.get(key);
  let info = null;
  try { info = probeMp4(abs); } catch { /* 探测失败 = 这份文件没有可用元信息，留 null */ }
  if (MEDIA_INFO_CACHE.size > 500) {
    const first = MEDIA_INFO_CACHE.keys().next().value;
    if (first !== undefined) MEDIA_INFO_CACHE.delete(first);
  }
  MEDIA_INFO_CACHE.set(key, info);
  return info;
}

export { getMediaInfo };
