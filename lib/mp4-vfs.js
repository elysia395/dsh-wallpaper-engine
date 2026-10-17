/**
 * mp4-vfs.js — **虚拟 faststart**：让 moov 在文件尾部的 mp4 在**服务时**看起来像 moov 在前的，
 * 而磁盘上一个字节都不用搬。
 *
 * 为什么需要它：Chromium 的媒体加载器对 `Range: bytes=0-` 的响应会**顺流整读**，moov 在尾部
 * ⇒ 元数据（duration/尺寸）要读到文件末尾才出来，耗时 ∝ 文件大小。真机 `media-req` 取证
 * （官方壳）：iris2 764,688,296B / 1761ms · lv_0 501,752,315B / 1250ms · kei 155,604,213B /
 * 357ms · ahq 101,749,329B / 324ms（≈430MB/s），而**同一个 iris2** 在"moov 已在前面"的那条
 * 路上只要 149–233ms。旧版的做法是用 `-c copy -movflags +faststart` 生成一份**等大副本**
 * （本机实测 5 张 = 1570MB，而它们真正缺的只是合计 0.49MB 的 moov）。
 *
 * 本模块的依据：`+faststart` 的字节效果**只等于两件事** ——
 *   ① 把 `moov` 盒整段挪到 `mdat` 之前；
 *   ② 给 `moov` 里每个 `stco`/`co64` 条目加上 `len(moov)`（mdat 整体后移这么多）。
 * `mdat` 的内容、顺序、长度都不变 ⇒ 总长度也不变（与旧行为的 Content-Length 完全一致）。
 * 于是"搬家"可以在**响应时**按段表合成：`[ftyp][free][moov(补丁版)][mdat]` —— 前后两段直读
 * 原文件、中间那段是内存里打了补丁的 moov ⇒ 磁盘成本 **0**，索引只占一个 moov 的内存。
 * 等价性已真机取证（docs/CHANGELOG.md 有完整记录）：把合成结果落盘后与源做
 * `ffmpeg -v error -f null -`（无任何输出）、`-map 0:v:0 -f framemd5` 812 帧哈希完全一致、
 * 音轨 framemd5 一致；与 ffmpeg 自己 `-c copy -movflags +faststart` 的产物相比语义等价
 * （虚拟那份还小 35B —— 它不重排 free box）。
 *
 * 契约：`createMp4VfsKit(c)` → `{ layoutFor }`。
 *   · `layoutFor(abs, logFn)` →
 *       `{ kind: 'virtual', size, moov, segments, delta, patched, tracks }`（可按段表服务）|
 *       `{ kind: 'plain' }`（moov 本来就在前 ⇒ 调用方原样发原片即可，**不要**走虚拟路径）|
 *       `{ kind: 'none', reason }`（判不了 ⇒ **调用方必须原样发原片**）
 *     只有 `virtual` 会被缓存；`plain` / `none` 都不碰磁盘也不占内存（`plain` 缓存以免反复探测
 *     顶部盒表，代价是 0 字节）。
 *   · `c.appendDiagLine`（可选）← 首次算出一份虚拟布局时落一行诊断（桌面壳默认安静档，
 *     否则这条"磁盘 0"的事实真机无从核对）。
 *
 * 不变量：
 *   · 这是**优化**，不是功能：任何判不了的输入（非 mp4 / 无 moov / 多个 mdat / 偏移落在 mdat
 *     之外 / 分片或带辅助偏移表的 mp4 / moov 过大 / IO 失败）都必须安静退回原片。
 *   · 判不了的结论**不缓存**：瞬时 IO 失败下次还要能重试（每次重试只花两三次小读）。
 *   · 只认 `stco`/`co64` 这一处绝对偏移；见到分片/加密族的盒子（见 `BAIL_MARKERS`）一律放弃
 *     —— 那些文件的绝对偏移不止一处，硬搬会读出花屏。
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

/** moov 内存缓存的单份上限：真实 moov 只有 16KB–190KB（体积实测见文件头），这是畸形兜底。 */
const MP4_VFS_MAX_MOOV_BYTES = 8 * 1024 * 1024;
/** 布局缓存：条数 + moov 总字节双上限（键 = 路径 + 大小 + mtime，源改过自动失效）。 */
const VFS_CACHE_MAX_ENTRIES = 32;
const VFS_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** 顶层盒表最多认多少个盒（正常 mp4 只有 4–6 个；更多说明这不是我们认识的布局）。 */
const TOP_BOX_MAX = 64;
/**
 * 见到这些盒子就直接放弃（它们的**绝对偏移语义不止 stco/co64 一处**）：
 * 分片 mp4（moof/mvex/traf/tfhd/tfdt/trun）、辅助信息表（saio/senc）、索引（mfra/tfra）。
 * 只在 moov 字节里搜这 4 字节 ASCII —— 误判的代价只是"这张照旧发原片"，漏判才会花屏。
 */
const BAIL_MARKERS = ['moof', 'mvex', 'traf', 'tfhd', 'tfdt', 'trun', 'saio', 'senc', 'mfra', 'tfra']
  .map((t) => Buffer.from(t, 'latin1'));
/** 值得尝试的容器扩展名（与旧版 `needsFaststart` 同一口径）。 */
const VFS_EXTS = new Set(['mp4', 'm4v', 'mov']);
/** 顶层盒头探测长度：8 字节盒头 + 64 位大小（`size32 === 1` 时用）。 */
const HEADER_PROBE = 16;

// ── 盒（box）遍历原语 ───────────────────────────────────────────────────────
// mp4 是"盒子套盒子"的树：每个盒子 = [size(4)][type(4)] 或 [size=1][type][size64(8)]。
// 这里只认**够用**的那几层（moov → trak → mdia → minf → stbl → stco/co64），不做通用解析器：
// 认不出来的一律当"判不了"，让调用方发原片。

/** 读一个盒头；结构不合法（越界 / size 不合理）返回 null。`limit` 是该缓冲区里盒族的终点。 */
function boxAt(buf, off, limit) {
  if (off + 8 > limit) return null;
  const size32 = buf.readUInt32BE(off);
  const type = buf.toString('latin1', off + 4, off + 8);
  let size = size32;
  let header = 8;
  if (size32 === 1) {
    if (off + 16 > limit) return null;
    size = Number(buf.readBigUInt64BE(off + 8));
    header = 16;
  } else if (size32 === 0) {
    size = limit - off;                  // 0 = "直到父盒末尾"（只出现在最后一个子盒）
  }
  if (!Number.isSafeInteger(size) || size < header || off + size > limit) return null;
  return { start: off, size, header, type, end: off + size };
}

/** 把 [start,end) 逐个盒列出来；中间有任何不合法的字节序列 ⇒ null（整份放弃）。 */
function listBoxes(buf, start, end) {
  const out = [];
  let off = start;
  while (off < end) {
    const b = boxAt(buf, off, end);
    if (!b) return null;
    out.push(b);
    off = b.end;
  }
  return off === end ? out : null;
}

/** 取某个盒的第一个指定类型子盒（找不到 ⇒ null）。 */
function childBox(buf, parent, type) {
  const kids = listBoxes(buf, parent.start + parent.header, parent.end);
  if (!kids) return null;
  return kids.find((b) => b.type === type) || null;
}

/**
 * 顶层盒表 —— 这里**按需 seek 读盒头**（不把几百 MB 的文件读进内存）。
 * 返回 `[{ start, size, type }]`；任何不自洽（越界 / 盒数超限 / 尾部对不齐）⇒ null。
 */
function listTopBoxes(fd, size) {
  const head = Buffer.alloc(HEADER_PROBE);
  const out = [];
  let off = 0;
  while (off < size) {
    const n = readSync(fd, head, 0, HEADER_PROBE, off);
    if (n < 8) return null;
    const size32 = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    let boxSize = size32;
    let header = 8;
    if (size32 === 1) {
      if (n < 16) return null;
      boxSize = Number(head.readBigUInt64BE(8));
      header = 16;
    } else if (size32 === 0) {
      boxSize = size - off;
    }
    if (!Number.isSafeInteger(boxSize) || boxSize < header || off + boxSize > size) return null;
    out.push({ start: off, size: boxSize, end: off + boxSize, type });
    off += boxSize;
    if (out.length > TOP_BOX_MAX) return null;
  }
  return off === size ? out : null;
}

/**
 * moov 里所有的 `stco`/`co64` 表（媒体数据块的**绝对文件偏移**，也是全文件唯一的绝对偏移面）。
 * 结构认不出来 ⇒ null。返回 `[{ box, wide, count, entriesStart }]`（偏移都在 moov 缓冲区内）。
 */
function chunkOffsetTables(moovBuf) {
  const moov = boxAt(moovBuf, 0, moovBuf.length);
  if (!moov || moov.type !== 'moov') return null;
  const top = listBoxes(moovBuf, moov.start + moov.header, moov.end);
  if (!top) return null;
  const tables = [];
  for (const trak of top.filter((b) => b.type === 'trak')) {
    const mdia = childBox(moovBuf, trak, 'mdia');
    const minf = mdia ? childBox(moovBuf, mdia, 'minf') : null;
    const stbl = minf ? childBox(moovBuf, minf, 'stbl') : null;
    if (!stbl) return null;
    const kids = listBoxes(moovBuf, stbl.start + stbl.header, stbl.end);
    if (!kids) return null;
    for (const box of kids) {
      if (box.type !== 'stco' && box.type !== 'co64') continue;
      const wide = box.type === 'co64';
      // full box：version/flags(4) + entry_count(4) 之后才是条目。
      if (box.size < box.header + 8) return null;
      const count = moovBuf.readUInt32BE(box.start + 12);
      const entriesStart = box.start + 16;
      if (entriesStart + count * (wide ? 8 : 4) > box.end) return null;
      tables.push({ box, wide, count, entriesStart });
    }
  }
  return tables;
}

/**
 * 校验 + 打补丁：每条偏移必须落在 `mdat` 内（否则这不是我们认识的布局），然后统一 `+delta`。
 * 返回 `{ buf, patched }`（`buf` 是 moov 的副本）；任一条越界 / 溢出 ⇒ null。
 */
function patchMoov(moovBuf, tables, delta, mdat) {
  const out = Buffer.from(moovBuf);
  let patched = 0;
  for (const t of tables) {
    const step = t.wide ? 8 : 4;
    for (let i = 0; i < t.count; i += 1) {
      const at = t.entriesStart + i * step;
      const old = t.wide ? Number(out.readBigUInt64BE(at)) : out.readUInt32BE(at);
      if (!(old >= mdat.start && old < mdat.end)) return null;
      const next = old + delta;
      if (t.wide) {
        if (!Number.isSafeInteger(next)) return null;
        out.writeBigUInt64BE(BigInt(next), at);
      } else {
        if (next > 0xffffffff) return null;
        out.writeUInt32BE(next, at);
      }
      patched += 1;
    }
  }
  return { buf: out, patched };
}

/**
 * 算一份虚拟布局（纯函数：无缓存、无日志 —— 那些在 `createMp4VfsKit` 里）。
 * `st`（可选）= 调用方已经 `statSync` 过的结果，省一次 syscall。
 */
export function analyzeMp4Layout(abs, st) {
  const ext = extname(abs).replace(/^\./, '').toLowerCase();
  if (!VFS_EXTS.has(ext)) return { kind: 'none', reason: 'ext' };
  let fd = -1;
  try {
    if (!st) st = statSync(abs);
    if (!st.isFile()) return { kind: 'none', reason: 'not-file' };
    if (st.size < HEADER_PROBE) return { kind: 'none', reason: 'too-small' };
    fd = openSync(abs, 'r');
    const boxes = listTopBoxes(fd, st.size);
    if (!boxes) return { kind: 'none', reason: 'top-boxes' };
    const moov = boxes.find((b) => b.type === 'moov');
    const mdats = boxes.filter((b) => b.type === 'mdat');
    if (!moov || mdats.length !== 1) return { kind: 'none', reason: 'no-moov-or-mdat' };
    const mdat = mdats[0];
    // moov 已经在 mdat 之前 ⇒ 没什么可搬的（原片的 Range 语义今天就是对的）。
    if (moov.start < mdat.start) return { kind: 'plain', reason: 'moov-first' };
    if (moov.size > MP4_VFS_MAX_MOOV_BYTES) return { kind: 'none', reason: 'moov-too-big' };
    const moovBuf = Buffer.alloc(moov.size);
    if (readSync(fd, moovBuf, 0, moov.size, moov.start) !== moov.size) return { kind: 'none', reason: 'moov-read' };
    const head = boxAt(moovBuf, 0, moovBuf.length);
    if (!head || head.type !== 'moov' || head.size !== moov.size) return { kind: 'none', reason: 'moov-header' };
    for (const marker of BAIL_MARKERS) {
      if (moovBuf.includes(marker)) return { kind: 'none', reason: 'fragmented-or-aux' };
    }
    const tables = chunkOffsetTables(moovBuf);
    if (!tables || !tables.length) return { kind: 'none', reason: 'no-chunk-offsets' };
    const delta = moov.size;                  // mdat 整体后移 len(moov)
    const patchedMoov = patchMoov(moovBuf, tables, delta, mdat);
    if (!patchedMoov) return { kind: 'none', reason: 'offsets-outside-mdat' };
    // 段表：原顺序，但把 moov 整段插到 mdat 之前。mdat 与它之后的盒整体后移 delta。
    const segments = [];
    let v = 0;
    for (const b of boxes) {
      if (b === moov) continue;               // 稍后插在 mdat 之前
      if (b === mdat) {
        segments.push({ vStart: v, len: moov.size, srcStart: -1, buf: patchedMoov.buf });
        v += moov.size;
      }
      segments.push({ vStart: v, len: b.size, srcStart: b.start, buf: null });
      v += b.size;
    }
    if (v !== st.size) return { kind: 'none', reason: 'size-mismatch' };
    return {
      kind: 'virtual',
      size: st.size,
      ext,
      mdat: { start: mdat.start, end: mdat.end },
      moov: { start: moov.start, size: moov.size, buf: patchedMoov.buf },
      segments,
      delta,
      patched: patchedMoov.patched,
      tracks: tables.length,
    };
  } catch {
    return { kind: 'none', reason: 'io' };
  } finally {
    if (fd >= 0) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

/**
 * 布局分析器（带**有界内存缓存**）：同一次宿主运行里同一份源只解析一次。
 * `layoutFor(abs, logFn)` 见文件头；`logFn` 只用于首次算出虚拟布局时的那条 info。
 */
export function createMp4VfsKit(c) {
  const appendDiagLine = c && c.appendDiagLine;
  const cache = new Map();                    // key → 布局结论（Map 的插入序就是 LRU 序）
  let cacheBytes = 0;

  function dropOldest() {
    while (cache.size > VFS_CACHE_MAX_ENTRIES || cacheBytes > VFS_CACHE_MAX_BYTES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      const res = cache.get(oldest.value);
      cacheBytes -= res && res.moov ? res.moov.buf.length : 0;
      cache.delete(oldest.value);
    }
  }

  function layoutFor(abs, logFn) {
    if (!abs) return null;
    /** @type {import('node:fs').Stats} */
    let st;
    try { st = statSync(abs); } catch { return null; }
    const key = abs + '|' + st.size + '|' + Math.round(st.mtimeMs) + '|v1';
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
    const res = analyzeMp4Layout(abs, st);
    if (res.kind === 'none') return res;      // 不缓存（见文件头：瞬时 IO 失败要能重试）
    cache.set(key, res);
    cacheBytes += res.moov ? res.moov.buf.length : 0;
    dropOldest();
    if (res.kind === 'virtual') {
      const say = (level, msg) => {
        try { if (logFn && typeof logFn[level] === 'function') logFn[level](msg); } catch { /* 日志绝不许影响流程 */ }
      };
      say('info', '视频壁纸 faststart 虚拟布局已就绪（磁盘 0）：' + basename(abs));
      try {
        if (typeof appendDiagLine === 'function') {
          appendDiagLine('faststart', {
            file: basename(abs), size: st.size, moovSize: res.moov.size, delta: res.delta,
            patches: res.patched, tracks: res.tracks, virtual: true,
          });
        }
      } catch { /* ignore */ }
    }
    return res;
  }

  return { layoutFor };
}
