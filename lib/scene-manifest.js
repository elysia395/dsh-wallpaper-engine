/**
 * Wallpaper Engine scene.pkg / .tex resource extraction.
 *
 * 职责：**从场景包里探测作者内嵌的 MP4**（`extractSceneVideo` /
 * `extractSceneVideoFromDir`），供 `/scene-video` 用作出图来源链的第二顺位。
 * pkg 文件版（issue #136）：`probeSceneVideoFromPkgFile`（后台布尔快路径）与
 * `extractSceneVideoFromPkgFile`（/scene-video 的整段提取）只读「索引 + 条目前缀」，
 * 与内存版共用判定窗/打分/压缩判定，输出逐字节一致。
 * 本文件只做这件事；下面这些**格式事实**是它的依据，容器原语由 `./pkg-read.js` 提供：
 *
 * Format facts were cross-checked against the two reference implementations:
 * RePKG (github.com/notscuffed/repkg, PackageReader / TexReader and friends)
 * and linux-wallpaperengine (github.com/Almamu/linux-wallpaperengine,
 * PackageParser / TextureParser):
 *
 * - PKG header: int32-length-prefixed magic string, int32 entry count, then
 *   per entry a length-prefixed path plus uint32 offset/length. Offsets are
 *   relative to the end of the index. Entry data is stored raw in practice;
 *   some packers emit LZ4-chained entries instead (int64 original size, then
 *   repeated [int32 decompressed size][int32 compressed size][LZ4 block]).
 *   parsePkg probes for a perfectly-fitting block chain and flags such
 *   entries; readPkgEntry decompresses them ("compressedSize != size" means
 *   LZ4), single-block chains included.
 * - TEX magics are NUL-terminated 8-character strings (9 bytes on disk).
 *   TEXB0002+ mipmaps carry an isLZ4Compressed flag and a decompressed byte
 *   count; the LZ4 payload is one whole block per mipmap. TEXB0004 with an
 *   unknown FreeImage format plus the video flag marks an embedded MP4, which
 *   is exposed via TexInfo 的 `isVideoMp4`（本模块只做探测，不解码像素）。GIF flags
 *   (bit 2) pull in a TEXS frame container exposed via TexInfo.frames.
 *
 * LZ4 block decoding follows the official lz4 block format specification;
 * BC1/BC2/BC3 follow the standard public algorithms. **本仓不解码 TEX 像素**：
 * 容器原语唯一实现在 `lib/pkg-read.js`（其 `dependencies` 里没有 pkg/TEX 容器解析库，
 * 也没有任何 vendored 副本可走）。
 *
 * @module @linxin666/dsh-client-ui-skin-center/scene-manifest
 */
import { Buffer } from 'node:buffer';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join as joinPath, resolve as resolvePath, sep } from 'node:path';
import { parsePkg, parsePkgHead, readPkgEntry, readPkgEntryAt, readPkgEntryHeadAt } from './pkg-read.js';
/**
 * SceneAccess over a packed scene.pkg container (case-insensitive paths).
 *
 * 形状**只有** `readFile` / `listTexPaths` 两个成员：原先三处同源工厂各带一个 `readJson`
 * （包版/目录版做 `JSON.parse`，只含命中 .tex 的那版返回 null），但全仓零调用、零类型契约、
 * 零守卫钉文本（只在此文件的三个声明处出现过）⇒ 已按死代码删除。将来真要"按路径读 scene.json"
 * 时再加回来 —— 那时必须同时带来真实调用点，别再留没有读者的成员。
 */
function pkgSceneAccess(pkgData) {
    const entries = parsePkg(pkgData);
    const byPath = new Map(entries.map((entry) => [entry.path.toLowerCase(), entry]));
    const readFile = (path) => {
        const entry = byPath.get(path.toLowerCase());
        if (!entry)
            return null;
        return { path: entry.path, bytes: readPkgEntry(pkgData, entry) };
    };
    return {
        readFile,
        listTexPaths: () => entries.filter((entry) => entry.path.toLowerCase().endsWith('.tex')).map((entry) => entry.path),
    };
}
/**
 * SceneAccess over a loose scene project directory (scene.json plus loose
 * .tex/.json files, e.g. WE defaultprojects). Reads are fenced inside the
 * directory; texture references escaping it resolve to null.
 */
function dirSceneAccess(dir) {
    const normDir = resolvePath(dir);
    const realDir = (() => { try {
        return realpathSync(normDir);
    }
    catch {
        return normDir;
    } })();
    const readFile = (path) => {
        const abs = resolvePath(normDir, path);
        if (abs !== normDir && !abs.startsWith(normDir + sep))
            return null;
        try {
            // Never follow symlinks: a project dir containing a link must not
            // leak arbitrary file bytes into the extraction pipeline.
            if (lstatSync(abs).isSymbolicLink())
                return null;
            if (!statSync(abs).isFile())
                return null;
            const real = realpathSync(abs);
            if (real !== realDir && !real.startsWith(realDir + sep))
                return null;
            return { path, bytes: new Uint8Array(readFileSync(real)) };
        }
        catch {
            return null;
        }
    };
    const listTexPaths = () => {
        const out = [];
        const walk = (sub, depth) => {
            if (depth > 4)
                return;
            let names;
            try {
                names = readdirSync(sub === '' ? normDir : joinPath(normDir, sub));
            }
            catch {
                return;
            }
            for (const name of names) {
                const rel = sub === '' ? name : sub + '/' + name;
                let isDir;
                let isFile;
                try {
                    const lst = lstatSync(joinPath(normDir, rel));
                    if (lst.isSymbolicLink())
                        continue;
                    isDir = lst.isDirectory();
                    isFile = lst.isFile();
                }
                catch {
                    continue;
                }
                if (isDir)
                    walk(rel, depth + 1);
                else if (isFile && name.toLowerCase().endsWith('.tex'))
                    out.push(rel);
            }
        };
        walk('', 0);
        return out;
    };
    return {
        readFile,
        listTexPaths,
    };
}
function isLikelyMaskOrHelper(path) {
    const lower = path.toLowerCase();
    return (lower.includes('/masks/') ||
        lower.includes('_mask') ||
        lower.includes('mask') ||
        lower.includes('flow') ||
        lower.includes('wave') ||
        lower.includes('noise') ||
        lower.includes('lut') ||
        lower.includes('distort') ||
        lower.includes('warp') ||
        lower.includes('vortex') ||
        lower.includes('glow') ||
        lower.includes('neon') ||
        lower.includes('strip') ||
        lower.includes('bulb') ||
        lower.includes('led') ||
        lower.includes('combined') ||
        lower.includes('isometric') ||
        lower.includes('razer') ||
        lower.includes('len') ||
        lower.includes('lens') ||
        lower.includes('flare') ||
        lower.includes('prism') ||
        lower.includes('diffract') ||
        lower.includes('black') ||
        lower.includes('overlay') ||
        lower === 'sun' ||
        lower.endsWith('/sun.tex') ||
        lower.endsWith('/sun.json') ||
        lower.endsWith('/sun') ||
        lower.includes('waterripple') ||
        lower.includes('waterflow') ||
        lower.includes('phase') ||
        lower.includes('normal') ||
        lower.includes('foliagesway') ||
        lower.includes('cursorripple') ||
        lower.includes('赞助') ||
        lower.includes('sponsor') ||
        lower.includes('donate') ||
        lower.includes('qrcode') ||
        lower.includes('qr_code') ||
        lower.includes('audio_bar') ||
        lower.includes('audiobar') ||
        lower.includes('simple_audio') ||
        lower.includes('提示框') ||
        lower.includes('tip') ||
        lower.includes('watermark') ||
        lower.includes('logo') ||
        lower.includes('particle') ||
        lower.includes('audio') ||
        lower.includes('lightmap') ||
        lower.includes('light_map') ||
        lower.includes('visso') ||
        lower.includes('font') ||
        lower.includes('text_'));
}
function getTextureScore(path) {
    const lower = path.toLowerCase();
    if (isLikelyMaskOrHelper(path))
        return -100;
    let score = 0;
    if (lower.includes('白天') || lower.includes('day') || lower.includes('main') || lower.includes('background') || lower.includes('wallpaper')) {
        score += 50;
    }
    if (lower.includes('清晨') || lower.includes('morning') || lower.includes('黄昏') || lower.includes('dusk')) {
        score += 20;
    }
    if (lower.includes('昼夜变化') || lower.includes('mddn') || lower.includes('transition')) {
        score -= 30;
    }
    return score;
}
/**
 * Detection window: find the first `ftyp` box header (bytes 66 74 79 70) at a
 * position where the box start (i − 4) lands inside the entry — the exact loop
 * the in-memory path always had (i < 200 && i + 8 <= length). Extracted as one
 * function so the file path can run the SAME window over a prefix: `bytes` may
 * be shorter than `length` (only the first ~203 bytes are ever touched), while
 * the loop bounds always use the full logical `length`.
 * Returns the offset of the box start, or −1 when this entry is not a video.
 */
function findFtypOffset(bytes, length) {
    for (let i = 0; i < 200 && i + 8 <= length; i++) {
        if (bytes[i] === 0x66 && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x79 && bytes[i + 3] === 0x70) {
            const ftypOffset = i - 4;
            if (ftypOffset >= 0 && ftypOffset < length)
                return ftypOffset;
        }
    }
    return -1;
}
/** Find and extract the primary MP4 video embedded inside a scene's .tex textures. */
function extractSceneVideoVia(access) {
    const candidates = [];
    for (const path of access.listTexPaths()) {
        const file = access.readFile(path);
        if (!file)
            continue;
        const raw = file.bytes;
        const ftypOffset = findFtypOffset(raw, raw.length);
        if (ftypOffset >= 0) {
            candidates.push({
                path,
                score: getTextureScore(path),
                bytes: raw.slice(ftypOffset),
            });
        }
    }
    if (candidates.length === 0)
        return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].bytes;
}
export function extractSceneVideo(pkgData) {
    return extractSceneVideoVia(pkgSceneAccess(pkgData));
}
export function extractSceneVideoFromDir(dir) {
    return extractSceneVideoVia(dirSceneAccess(dir));
}
/**
 * 判定窗最多摸到条目的第 203 字节（i ≤ 199 且 i + 8 ≤ length ⇒ 最大索引 202）；
 * 读 204 留一字节余量。条目比它还短时整条读出（本来也就那么大）。
 */
const SCENE_VIDEO_PREFIX_BYTES = 204;
/**
 * 构造文件句柄上的 `readAt(pos, len)`：精确长度读取，读短（文件在 stat 与读取
 * 之间被截断/替换）一律抛 'unexpected end of data' —— 与 Reader 的截断信号同形，
 * parsePkgHead 的重试梯据此换更大的头块，条目读取则直接失败记「否」。
 */
function readAtOf(fh) {
    return async (pos, len) => {
        if (!(len > 0)) return new Uint8Array(0);
        if (pos < 0) throw new Error('pkg: unexpected end of data');
        const buf = Buffer.allocUnsafe(len);
        const { bytesRead } = await fh.read(buf, 0, len, pos);
        if (bytesRead < len)
            throw new Error('pkg: unexpected end of data');
        return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    };
}
/**
 * 文件版路径（issue #136）：启动探测与 /scene-video 都不再 readFile 整包 ——
 * 只读「PKG 索引 + 每个 .tex 的前缀」，判定命中才把那一条读出来。
 * 输出与内存版**逐字节一致**：判定窗（findFtypOffset）、打分/排序/取值
 * （extractSceneVideoVia）与压缩判定（pkg-read 的 probeCompressedEntry /
 * decompressLz4Entry）全部共用同一实现，这里只换 I/O。
 */
/** 后台布尔快路径：索引 + 前缀扫描，首个命中即 true；不为「判有」整条读任何 raw 条目。 */
export async function probeSceneVideoFromPkgFile(abs) {
    const fh = await open(abs, 'r');
    try {
        const size = (await fh.stat()).size;
        const readAt = readAtOf(fh);
        const entries = await parsePkgHead(readAt, size);
        for (const entry of entries) {
            if (!entry.path.toLowerCase().endsWith('.tex'))
                continue;
            const head = await readPkgEntryHeadAt(readAt, size, entry, SCENE_VIDEO_PREFIX_BYTES);
            if (head.byteLength > 0 && findFtypOffset(head, entry.size) >= 0)
                return true;
        }
        return false;
    }
    finally {
        await fh.close();
    }
}
/** 完整提取（/scene-video 用）：前缀扫出命中条目，命中才整条读出，再走同一套抽取逻辑。 */
export async function extractSceneVideoFromPkgFile(abs) {
    const fh = await open(abs, 'r');
    try {
        const size = (await fh.stat()).size;
        const readAt = readAtOf(fh);
        const entries = await parsePkgHead(readAt, size);
        const tex = entries.filter((entry) => entry.path.toLowerCase().endsWith('.tex'));
        const files = new Map();
        for (const entry of tex) {
            const head = await readPkgEntryHeadAt(readAt, size, entry, SCENE_VIDEO_PREFIX_BYTES);
            if (head.byteLength > 0 && findFtypOffset(head, entry.size) >= 0) {
                files.set(entry.path.toLowerCase(), await readPkgEntryAt(readAt, size, entry));
            }
        }
        if (files.size === 0)
            return null;
        // 只把命中条目喂给抽取逻辑：未命中条目在判定窗里永远成不了候选
        //（findFtypOffset 对整条与对前缀给出同一个答案）， readFile 对缺项返回 null
        // ⇒ extractSceneVideoVia 的遍历结果与内存版逐字节一致。
        return extractSceneVideoVia(partialTexAccess(tex, files));
    }
    finally {
        await fh.close();
    }
}
/** 只含命中 .tex 的 SceneAccess（顺序 = 索引序，与 pkgSceneAccess 同源）；只服务视频探测/提取。 */
function partialTexAccess(texEntries, files) {
    return {
        readFile: (path) => {
            const bytes = files.get(path.toLowerCase());
            return bytes === undefined ? null : { path, bytes };
        },
        listTexPaths: () => texEntries.map((entry) => entry.path),
    };
}
