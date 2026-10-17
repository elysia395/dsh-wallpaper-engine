/**
 * PKG 容器读取原语（**唯一实现**）。
 *
 * 契约：`parsePkg` 解析 PKGV 目录；`readPkgEntry` 按条目读出字节（LZ4 条目自动解压）；
 * `probeCompressedEntry` 在不真解压的前提下回答"这条目是不是压缩的、原始多大"（给探测路径省一次分配）；
 * `lz4DecompressBlock` 是块解压，**带 MAX_DECOMPRESSED_BYTES 上限** —— 上限只该长在实现里，
 * 所以两个消费者共用这一份：各写一份就会出现"一份有上限、一份没有"的漂移。
 *
 * 文件版（issue #136）：`parsePkgHead` 只读文件头解析索引（64KB → 1MB → 8MB → 整包
 * 的重试梯），`readPkgEntryAt` / `readPkgEntryHeadAt` 按 `readAt(pos, len)` 只读命中的
 * 那段字节 —— 判定语义（bounds / 压缩探测 / LZ4 解压链）与内存版共用同一批函数，
 * 两条路径不允许出现判定分叉。消费者经 `readAt` 注入 I/O，本模块保持零 fs 依赖。
 *
 * 消费者：`lib/scene-manifest.js`（内嵌视频探测）与 `lib/media/scene-probe.js`（场景音频/视频族的
 * `parsePkg` / `readPkgEntry` 两处动态导入）。两者共用这一份实现，取的是更严格的那套约束
 *（上限 / 命名常量 / 注释）。
 *
 * ⚠️ 本模块是 PKG/TEX 容器知识的**唯一实现**。再需要 TEX 解码时**加在这里**，不要再开第二个
 * 模块 —— "一份有上限、一份没有"正是这一份实现要杜绝的缺陷形态（退役判据见
 * `test/verify-retired-lines.mjs` ④）。
 */
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

/**
 * Hard ceilings for allocations driven by wallpaper file content. Workshop
 * files are untrusted: a crafted pkg/tex/png must not be able to force
 * multi-GB host allocations (PR #717 follow-up hardening).
 */
const MAX_PKG_ENTRY_BYTES = 512 * 1024 * 1024;

/** PkgEntry.flags bit marking LZ4 block-chain storage. */
const PKG_ENTRY_FLAG_LZ4 = 1;

const textDecoder = new TextDecoder('utf-8');

/**
 * Bounds-checked little-endian binary reader. Every failed read throws an
 * Error prefixed with the reader label (e.g. 'pkg: unexpected end of data').
 */
class Reader {
    data;
    label;
    view;
    pos = 0;
    constructor(data, label) {
        this.data = data;
        this.label = label;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }
    get remaining() {
        return this.view.byteLength - this.pos;
    }
    need(n) {
        if (n < 0 || this.pos + n > this.view.byteLength) {
            throw new Error(this.label + ': unexpected end of data');
        }
    }
    u8() {
        this.need(1);
        return this.view.getUint8(this.pos++);
    }
    i32() {
        this.need(4);
        const v = this.view.getInt32(this.pos, true);
        this.pos += 4;
        return v;
    }
    u32() {
        this.need(4);
        const v = this.view.getUint32(this.pos, true);
        this.pos += 4;
        return v;
    }
    /** Unsigned 64-bit integer; safe up to 2^53. */
    u64() {
        const lo = this.u32();
        const hi = this.u32();
        return hi * 0x100000000 + lo;
    }
    f32() {
        this.need(4);
        const v = this.view.getFloat32(this.pos, true);
        this.pos += 4;
        return v;
    }
    bytes(n) {
        this.need(n);
        const out = this.data.subarray(this.pos, this.pos + n);
        this.pos += n;
        return out;
    }
    /** int32-length-prefixed UTF-8 string (PKG magic and entry paths). */
    sizedString(maxLength) {
        const length = this.i32();
        if (length < 0 || length > maxLength) {
            throw new Error(this.label + ': invalid string length ' + length);
        }
        return textDecoder.decode(this.bytes(length));
    }
    /** NUL-terminated string (all TEX magics and the TEXB0004 json blob). */
    nstring(maxLength) {
        const start = this.pos;
        let end = start;
        const limit = Math.min(this.view.byteLength, start + maxLength);
        while (end < limit && this.view.getUint8(end) !== 0)
            end++;
        if (end >= limit) {
            throw new Error(this.label + ': unterminated string');
        }
        const out = textDecoder.decode(this.data.subarray(start, end));
        this.pos = end + 1;
        return out;
    }
}

/**
 * Decompress one raw LZ4 block (the format inside PKG entry chains and TEXB
 * mipmaps) following the official lz4 block format specification.
 *
 * @param src compressed block bytes
 * @param dstSize exact expected decompressed size
 */
function lz4DecompressBlock(src, dstSize) {
    if (dstSize < 0 || dstSize > MAX_DECOMPRESSED_BYTES) {
        throw new Error('lz4: decompressed size out of bounds (' + String(dstSize) + ')');
    }
    const dst = new Uint8Array(dstSize);
    let ip = 0;
    let op = 0;
    while (ip < src.length) {
        const token = src[ip++];
        // literal run
        let literalLength = token >> 4;
        if (literalLength === 15) {
            let s;
            do {
                if (ip >= src.length)
                    throw new Error('lz4: truncated literal length');
                s = src[ip++];
                literalLength += s;
            } while (s === 255);
        }
        if (ip + literalLength > src.length || op + literalLength > dstSize) {
            throw new Error('lz4: literal run out of bounds');
        }
        dst.set(src.subarray(ip, ip + literalLength), op);
        ip += literalLength;
        op += literalLength;
        if (ip >= src.length)
            break; // last sequence: literals only, block ends
        // match copy
        if (ip + 2 > src.length)
            throw new Error('lz4: truncated match offset');
        const offset = src[ip] | (src[ip + 1] << 8);
        ip += 2;
        if (offset === 0 || offset > op)
            throw new Error('lz4: invalid match offset ' + offset);
        let matchLength = token & 0x0f;
        if (matchLength === 15) {
            let s;
            do {
                if (ip >= src.length)
                    throw new Error('lz4: truncated match length');
                s = src[ip++];
                matchLength += s;
            } while (s === 255);
        }
        matchLength += 4;
        if (op + matchLength > dstSize)
            throw new Error('lz4: match run out of bounds');
        for (let i = 0; i < matchLength; i++) {
            dst[op] = dst[op - offset];
            op++;
        }
    }
    if (op !== dstSize) {
        throw new Error('lz4: decompressed size mismatch (got ' + op + ', expected ' + dstSize + ')');
    }
    return dst;
}

/**
 * Probe whether the entry data at [abs, abs+length) is an LZ4 block chain:
 * int64 original size followed by [int32 uncomp][int32 comp][block] entries
 * that reconstruct exactly originalSize bytes while consuming the entry to
 * the byte. Returns the original size when the chain fits perfectly.
 */
function probeCompressedEntry(data, abs, length) {
    if (length < 8)
        return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const originalSize = view.getUint32(abs, true) + view.getUint32(abs + 4, true) * 0x100000000;
    // compression only ever wins space; larger "originals" are raw data
    if (originalSize <= length || originalSize > 0x7fffffff)
        return null;
    let pos = abs + 8;
    let total = 0;
    while (total < originalSize) {
        if (pos + 8 > abs + length)
            return null;
        const uncomp = view.getInt32(pos, true);
        const comp = view.getInt32(pos + 4, true);
        if (uncomp <= 0 || comp <= 0 || pos + 8 + comp > abs + length)
            return null;
        total += uncomp;
        pos += 8 + comp;
    }
    return total === originalSize && pos === abs + length ? originalSize : null;
}

/**
 * Parse the PKG index (magic → count → per-entry path/offset/length) out of a
 * head buffer. Offsets stay relative to the end of the index (`dataStart`
 * returned beside them); entry flags/data are NOT probed here — that needs the
 * data region, which the in-memory and file paths supply differently.
 * A buffer truncated before the index ends throws Reader's 'unexpected end of
 * data' — the file path uses exactly that signal to retry with a larger head.
 */
function parsePkgIndexHead(head) {
    const r = new Reader(head, 'pkg');
    const magic = r.sizedString(32);
    if (!/^PKGV\d{4}$/.test(magic)) {
        throw new Error("pkg: bad magic '" + magic + "'");
    }
    const count = r.i32();
    if (count < 0 || count > 0x100000) {
        throw new Error('pkg: invalid entry count ' + count);
    }
    const index = [];
    for (let i = 0; i < count; i++) {
        index.push({ path: r.sizedString(1024), offset: r.u32(), length: r.u32() });
    }
    return { index, dataStart: r.pos };
}

/**
 * File counterpart of probeCompressedEntry: the same gates, the same chain
 * walk — but each block header is fetched with an 8-byte readAt instead of
 * indexing a buffer that already holds the whole entry. That distinction is
 * the whole point (issue #136): an entry whose first 8 bytes merely LOOK
 * chain-shaped used to pull its entire multi-MB payload just to conclude
 * "raw" (257 MB during ONE package's index phase, measured); with the header
 * walk it costs one more 8-byte read. Payload bytes are never touched here —
 * the sync probe doesn't validate them either, so both paths flag exactly the
 * same entries (equivalence pinned by test/verify-scene.mjs).
 */
async function probeCompressedEntryAt(readAt, abs, length) {
    if (length < 8)
        return null;
    const head = await readAt(abs, 8);
    if (head.byteLength < 8)
        throw new Error('pkg: unexpected end of data');
    const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const originalSize = headView.getUint32(0, true) + headView.getUint32(4, true) * 0x100000000;
    // compression only ever wins space; larger "originals" are raw data
    if (originalSize <= length || originalSize > 0x7fffffff)
        return null;
    let pos = abs + 8;
    let total = 0;
    while (total < originalSize) {
        if (pos + 8 > abs + length)
            return null;
        const hdr = await readAt(pos, 8);
        if (hdr.byteLength < 8)
            throw new Error('pkg: unexpected end of data');
        const hdrView = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
        const uncomp = hdrView.getInt32(0, true);
        const comp = hdrView.getInt32(4, true);
        if (uncomp <= 0 || comp <= 0 || pos + 8 + comp > abs + length)
            return null;
        total += uncomp;
        pos += 8 + comp;
    }
    return total === originalSize && pos === abs + length ? originalSize : null;
}

/**
 * Parse a PKG container (magic PKGVxxxx) and return its entry index.
 * Entry offsets in the returned list are absolute positions inside data.
 *
 * `p` 并不是本函数产出的字段：它只是上游/历史别名的**兼容位**（消费侧写
 * `e.path || e.p` 兜底，见 `lib/media/scene-probe.js` 的 `readPkgEntry` 消费点）。标成可选，是为了让那条
 * 防御性回落有类型可依，而不是把它当成"不存在的属性"报错。
 * @returns {Array<{ path: string, offset: number, compressedSize: number, size: number, flags: number, p?: string }>}
 */
function parsePkg(data) {
    const { index, dataStart } = parsePkgIndexHead(data);
    return index.map(({ path, offset, length }) => {
        const abs = dataStart + offset;
        if (abs + length > data.byteLength) {
            throw new Error("pkg: entry '" + path + "' out of bounds");
        }
        const originalSize = probeCompressedEntry(data, abs, length);
        return originalSize === null
            ? { path, offset: abs, compressedSize: length, size: length, flags: 0 }
            : { path, offset: abs, compressedSize: length, size: originalSize, flags: PKG_ENTRY_FLAG_LZ4 };
    });
}

/**
 * Read the PKG index from the HEAD of a file without touching the data region
 * (issue #136: startup video probes were reading every scene.pkg whole).
 * `readAt(pos, len)` fetches bytes at an absolute file position and must
 * resolve to at least the requested length (short results are treated as a
 * truncated head); `fileSize` is the stat snapshot used for bounds checks.
 *
 * Retry ladder: 64 KB covers every real package's index in one read; 1 MB /
 * 8 MB catch pathological ones; the last attempt is the whole file, which
 * reproduces the in-memory path exactly for anything larger (a crafted index
 * >8 MB must yield the same verdict as before, not an error the old path
 * never had). Flag probing runs per entry: an 8-byte peek answers "definitely
 * raw" with the exact first gate of probeCompressedEntry; only entries that
 * look like an LZ4 chain get their full bytes read and chain-validated —
 * same function, same semantics as parsePkg.
 */
async function parsePkgHead(readAt, fileSize) {
    const size = Number(fileSize) || 0;
    const attempts = [64 * 1024, 1024 * 1024, 8 * 1024 * 1024];
    if (attempts[attempts.length - 1] < size)
        attempts.push(size);
    let lastErr = null;
    for (const want of attempts) {
        const take = Math.min(want, size);
        let head;
        try {
            head = await readAt(0, take);
        }
        catch (e) {
            lastErr = e;
            continue;
        }
        let index, dataStart;
        try {
            ({ index, dataStart } = parsePkgIndexHead(head));
        }
        catch (e) {
            // 只对「头读短了」换更大的块重读；坏 magic / 非法 count 直接抛（与内存版一致）。
            if (e && typeof e.message === 'string' && e.message.endsWith('unexpected end of data')) {
                lastErr = e;
                continue;
            }
            throw e;
        }
        const entries = [];
        for (const { path, offset, length } of index) {
            const abs = dataStart + offset;
            if (abs + length > size) {
                throw new Error("pkg: entry '" + path + "' out of bounds");
            }
            // 压缩判定：与 parsePkg 同一门/同一条链走查，但逐头读（不拉整条载荷）。
            const originalSize = await probeCompressedEntryAt(readAt, abs, length);
            entries.push(originalSize === null
                ? { path, offset: abs, compressedSize: length, size: length, flags: 0 }
                : { path, offset: abs, compressedSize: length, size: originalSize, flags: PKG_ENTRY_FLAG_LZ4 });
        }
        return entries;
    }
    throw lastErr || new Error('pkg: unexpected end of data');
}

/**
 * Decompress one LZ4 block-chain entry body (the bytes AFTER the bounds check
 * already isolated). Shared by the in-memory and file entry readers so the
 * two can never drift into "one has the size cap, one doesn't".
 * Returns a fresh buffer of exactly entry.size bytes.
 */
function decompressLz4Entry(compressed, entry) {
    if (entry.size > MAX_PKG_ENTRY_BYTES) {
        throw new Error("pkg: entry '" + entry.path + "' too large (" + entry.size + ' bytes)');
    }
    const r = new Reader(compressed, 'pkg');
    const originalSize = r.u64();
    if (originalSize !== entry.size) {
        throw new Error("pkg: entry '" + entry.path + "' size mismatch");
    }
    const out = new Uint8Array(entry.size);
    let written = 0;
    while (written < entry.size) {
        const uncomp = r.i32();
        const comp = r.i32();
        if (uncomp <= 0 || comp <= 0 || written + uncomp > entry.size) {
            throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
        }
        out.set(lz4DecompressBlock(r.bytes(comp), uncomp), written);
        written += uncomp;
    }
    if (r.remaining !== 0) {
        throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
    }
    return out;
}

/**
 * Extract (and decompress, when the entry uses LZ4 block-chain storage) one
 * package entry. Returns a fresh buffer of exactly entry.size bytes.
 */
function readPkgEntry(data, entry) {
    const abs = entry.offset;
    if (abs < 0 || abs + entry.compressedSize > data.byteLength) {
        throw new Error("pkg: entry '" + entry.path + "' out of bounds");
    }
    if ((entry.flags & PKG_ENTRY_FLAG_LZ4) === 0) {
        return data.slice(abs, abs + entry.compressedSize);
    }
    return decompressLz4Entry(data.subarray(abs, abs + entry.compressedSize), entry);
}

/**
 * File counterpart of readPkgEntry: same bounds check, same raw/LZ4 split,
 * only the bytes come from `readAt` — and a raw entry reads its own span, not
 * the whole container (issue #136).
 */
async function readPkgEntryAt(readAt, fileSize, entry) {
    const abs = entry.offset;
    if (abs < 0 || abs + entry.compressedSize > Number(fileSize)) {
        throw new Error("pkg: entry '" + entry.path + "' out of bounds");
    }
    if ((entry.flags & PKG_ENTRY_FLAG_LZ4) === 0) {
        return readAt(abs, entry.compressedSize);
    }
    const compressed = await readAt(abs, entry.compressedSize);
    if (compressed.byteLength < entry.compressedSize) {
        throw new Error('pkg: unexpected end of data');
    }
    return decompressLz4Entry(compressed, entry);
}

/**
 * First n bytes of an entry's LOGICAL content (raw = on-disk prefix, LZ4 =
 * decompressed prefix — the chain must be read whole regardless). Used by the
 * scene video probe, whose detection window never looks past ~203 bytes.
 * n is clamped to the entry size; short entries come back whole.
 */
async function readPkgEntryHeadAt(readAt, fileSize, entry, n) {
    const want = Math.max(0, Math.min(Number(n) || 0, entry.size));
    if (want === 0) return new Uint8Array(0);
    if ((entry.flags & PKG_ENTRY_FLAG_LZ4) === 0) {
        const abs = entry.offset;
        if (abs < 0 || abs + want > Number(fileSize)) {
            throw new Error("pkg: entry '" + entry.path + "' out of bounds");
        }
        const head = await readAt(abs, want);
        if (head.byteLength < want) {
            throw new Error('pkg: unexpected end of data');
        }
        return head;
    }
    const full = await readPkgEntryAt(readAt, fileSize, entry);
    return full.subarray(0, want);
}

export { parsePkg, parsePkgHead, readPkgEntry, readPkgEntryAt, readPkgEntryHeadAt };
