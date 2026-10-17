/**
 * avatar-import.js — 头像导入的**两道闸**与它们的**零解码尺寸探针**（issue #185 后续）。
 *
 * ══ 为什么独立成文件 ═══════════════════════════════════════════════════════════
 * 理由与 `src/section-head.js` / `src/module-reset.js` **完全同一条**：`test/verify-scene-live.mjs`
 * 是**按文件 import** 的替身（每个模块各有自己的作用域），它必须能 import 到**真实现**才能
 * 用真字节喂真函数 —— 而"源码里有没有这行字"这种判据测不出**位域读错一位**（1024 读成 0，
 * 闸随之恒放行）。本文件是纯函数（零 DOM、零异步、零外界），因此可被直接执行断言。
 *
 * ══ 为什么闸必须在"解码之前"════════════════════════════════════════════════════
 * `decodeImageFile` 一跑就已经吃掉了 `w × h × 4` 字节。一个 20000×20000 的 PNG 只有几百 KB，
 * 解码却要 1.6 GB —— 那是能把标签页直接拖死的量级；而"这图多大"**根本不用解码**：PNG / JPEG /
 * GIF / BMP / WebP 的头部都写着宽高，AVIF 写在 `ftyp` 之后的盒树里（`meta → iprp → ipco →
 * ispe`，见下面那组 `iso*` 函数）。下面这组解析器只读**文件头的前若干字节**，
 * 一次 `createImageBitmap` 都不调。
 *
 * 契约：
 *   · 纯函数 + 常量；**不碰 weT、不碰 DOM、不碰 selection**（文案由调用方出）。
 *   · 解析不出来时返回 `null` 而**不是**抛错 ⇒ 调用方退回"解码后由 canvas 报错"的老路，
 *     绝不因为解析器认不出就把用户的图拒之门外（宁可漏放一个，不可误拒）。
 *   · 内联进客户端 bundle（见 scripts/build-client.mjs 的 INLINE_MODULES），
 *     因此不得出现 import / require / process。
 */

/**
 * 头像落盘的长边上限（px）—— 用户口径「头像最大 1024×1024」。
 *
 * 为什么不是 512：显示档最大 72px，1024 已是 **14 倍**超采样；而矢量导入（issue #185）
 * 想要"更清晰"，唯一能兑现的地方就是**光栅化的分辨率** —— 512 那版把矢量优势直接抹平了。
 * 为什么不是更大：1024×1024 的 RGBA 本就是 4 MiB 像素，再往上收益递减而体积线性涨。
 */
const AVATAR_IMPORT_MAX_EDGE = 1024;
/**
 * 头像**原图**的体积上限（字节）—— 与上面那条边长闸配对，在**解码之前**判。
 *
 * 4 MiB 是**算出来的**，不是拍的：
 *   1024 × 1024 × 4 B/px（32bpp）= 4,194,304 B = **4.000 MiB**  ← "不丢信息"的像素上界
 *   PNG 无损编码只在它之上留极小开销 —— 实测最坏情况（不可压缩噪声，每像素独立随机）
 *   1024×1024 的 PNG = **4,196,676 B（+0.06%）**。
 * ⇒ 4 MiB 恰好是"能无损装下 1024×1024"的那道闸。超过它的图**必然**要么超分辨率、
 * 要么是极高熵内容，两者都该走「自动压缩后导入」那条明路，而不是静默缩图。
 */
const AVATAR_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
/**
 * **直传层** accept：客户端原样上传 ⇒ 宿主的 `AVATAR_EXT` / `MASCOT_EXT` 必须认得，
 * 且**原样落盘**。（`test/verify-contracts.mjs` 钉住它与宿主表逐个相等。）
 */
const IMAGE_DIRECT_ACCEPT = "image/png,image/jpeg,image/webp";
/**
 * **仅光栅化层** accept（issue #185：SVG 等格式）：选择器收得下，但**绝不原样落盘** ——
 * 它们经 canvas 解码成像素、再由同一个编码器重编成直传格式。
 *
 * 为什么不给宿主加 `{ 'image/svg+xml': 'svg' }`：`/avatar/<side>` 是**同源**服务的
 * （`<img>` 加载它、脚本不执行），但同源下的一份原始 SVG 一旦被直接导航或嵌入就是存储型
 * XSS 面；加一个扩展名换来的只是"更清晰"的错觉 —— 清晰度真正来自上面那条 1024 边长。
 * ⚠️ 本清单与宿主 MIME 表**必须不相交**，由 test/verify-contracts.mjs 的一条判据钉住。
 */
const IMAGE_RASTER_ACCEPT = "image/svg+xml,image/gif,image/bmp,image/avif";
/** 头像选图腿收的全部格式（两层之和）。 */
const AVATAR_PICK_ACCEPT = IMAGE_DIRECT_ACCEPT + "," + IMAGE_RASTER_ACCEPT;

/** 大端读一个 u32。 */
function readU32BE(b, at) {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}
/** 小端读一个 u32。 */
function readU32LE(b, at) {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}
/**
 * ── AVIF / ISOBMFF（issue #185 的 P1 收口）─────────────────────────────────────
 * `IMAGE_RASTER_ACCEPT` 里列着 `image/avif`，但探针**原先一个分支都没写**：AVIF 的宽高不在
 * 文件开头，而在 `ftyp` 之后的盒树 `meta → iprp → ipco → ispe` 里 ⇒ 旧实现恒返 null，
 * `avatarImportLimit` 只剩体积闸 —— 一个 3 MiB 的 20000×20000 AVIF 能直接过闸，直到
 * `createImageBitmap` 才炸出约 1.6 GB 的像素内存。"先拒再解"的全部价值在这条格式上归零。
 *
 * ISOBMFF 是**盒树**：每个盒 = `size`(4, 大端) + `type`(4) + 有效载荷。按真实结构走要处理：
 *   · `size === 1` ⇒ 盒头多 8 字节的 64 位 largesize（带大偏移的编码器会写）；
 *   · `size === 0` ⇒ 该盒一直延伸到文件尾；
 *   · `meta` 是 **FullBox** ⇒ 有效载荷前 4 字节是 version/flags，子盒从 +4 起；
 *   · `ipco` 是**属性表**（1 基索引），`ispe` 只是其中一种属性 ⇒ 不能"见到 ispe 就读"；
 *   · 尺寸属于**主图**：`pitm` 给主 item_ID，`ipma` 给该 item 关联的属性索引
 *     ⇒ 第 N 个 `ipco` 子盒（且它确是 ispe）才是主图尺寸。
 * 认不出照样返回 null —— 宁可漏放一个，不可误拒。
 */

/** 读一个 ISOBMFF 盒头：`{ type, start, end }`（`start` = 有效载荷起点），非法给 null。 */
function isoBoxAt(b, at, limit) {
  if (at + 8 > limit) return null;
  let size = readU32BE(b, at);
  const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
  let head = 8;
  if (size === 1) {
    if (at + 16 > limit) return null;
    // 64 位 largesize：高 32 位现实中恒为 0，但仍按无符号拼全（翻成负数就会算出负长度）。
    size = readU32BE(b, at + 8) * 0x100000000 + readU32BE(b, at + 12);
    head = 16;
  } else if (size === 0) {
    size = limit - at; // 延伸到文件尾
  }
  if (size < head) return null; // 盒头自相矛盾 ⇒ 链断在这里
  const end = Math.min(at + size, limit);
  if (end <= at) return null;
  return { type: type, start: at + head, end: end };
}
/** 列出一个区间里的**同级**盒（只读盒头；链一断就停）。 */
function isoChildren(b, from, to) {
  const out = [];
  let at = from;
  while (at + 8 <= to && out.length < 4096) {
    const child = isoBoxAt(b, at, to);
    if (!child || child.end <= at) break;
    out.push(child);
    at = child.end;
  }
  return out;
}
/** 同级里第一个指定类型的盒（没有给 null）。 */
function isoFind(b, type, from, to) {
  const kids = isoChildren(b, from, to);
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].type === type) return kids[i];
  }
  return null;
}
/**
 * 在 `ipma` 里找某个 item 关联的**第一个属性索引**（1 基；找不到给 0）。
 * 布局：FullBox(4) + entry_count(4) + N × [ item_ID(2|4) + association_count(1) + M × 索引 ]；
 * 索引宽度由 flags 最低位决定（置位 ⇒ 每项 2 字节，最高位是 essential 标志）。
 */
function ipmaProperty(b, box, itemId) {
  const ver = b[box.start];
  const flags = (b[box.start + 1] << 16) | (b[box.start + 2] << 8) | b[box.start + 3];
  let at = box.start + 4;
  if (at + 4 > box.end) return 0;
  const count = readU32BE(b, at);
  at += 4;
  for (let i = 0; i < count; i++) {
    if (at >= box.end) return 0;
    let id;
    if (ver === 0) {
      if (at + 2 > box.end) return 0;
      id = (b[at] << 8) | b[at + 1];
      at += 2;
    } else {
      if (at + 4 > box.end) return 0;
      id = readU32BE(b, at);
      at += 4;
    }
    if (at >= box.end) return 0;
    const n = b[at];
    at += 1;
    const wide = (flags & 1) !== 0;
    const step = wide ? 2 : 1;
    for (let k = 0; k < n; k++) {
      if (at + step > box.end) return 0;
      const idx = wide ? (((b[at] << 8) | b[at + 1]) & 0x7fff) : (b[at] & 0x7f);
      at += step;
      if (id === itemId && idx > 0) return idx;
    }
  }
  return 0;
}
/** 品牌 ⇒ `kind`（`avif` / `avis` 是 AVIF，同族其余按 HEIF 记）。 */
function avifKind(brand) {
  return brand === "avif" || brand === "avis" ? "avif" : "heif";
}
/** 一个 `meta` 盒里的主图尺寸（`{ width, height }`；这个盒里读不出来给 null）。 */
function avifSizeInMeta(b, meta) {
  const metaStart = meta.start + 4; // meta 是 FullBox
  const iprp = isoFind(b, "iprp", metaStart, meta.end);
  if (!iprp) return null;
  const ipco = isoFind(b, "ipco", iprp.start, iprp.end);
  if (!ipco) return null;
  const props = isoChildren(b, ipco.start, ipco.end);
  if (!props.length) return null;
  // 主图：`pitm` 的主 item_ID + `ipma` 的属性索引；指认不出来才退回第一个 ispe。
  let hit = null;
  const pitm = isoFind(b, "pitm", metaStart, meta.end);
  const ipma = isoFind(b, "ipma", iprp.start, iprp.end);
  if (pitm && ipma && pitm.start + 4 + (b[pitm.start] === 0 ? 2 : 4) <= pitm.end) {
    const itemId = b[pitm.start] === 0
      ? ((b[pitm.start + 4] << 8) | b[pitm.start + 5])
      : readU32BE(b, pitm.start + 4);
    const idx = ipmaProperty(b, ipma, itemId);
    if (idx > 0 && idx <= props.length && props[idx - 1].type === "ispe") hit = props[idx - 1];
  }
  if (!hit) {
    for (let i = 0; i < props.length; i++) {
      if (props[i].type === "ispe") { hit = props[i]; break; }
    }
  }
  if (!hit || hit.end - hit.start < 12) return null;
  const width = readU32BE(b, hit.start + 4);
  const height = readU32BE(b, hit.start + 8);
  if (!width || !height) return null;
  return { width: width, height: height };
}
/** `ftyp` 里的主品牌 / 兼容品牌命中这一族就给该品牌，否则空串（品牌从 `start` 起逐个 4cc）。 */
function avifBrandIn(b, ftyp) {
  for (let at = ftyp.start; at + 4 <= ftyp.end; at += 4) {
    const one = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
    if (one === "avif" || one === "avis" || one === "heic" || one === "heif"
      || one === "mif1" || one === "msf1") return one;
  }
  return "";
}
/**
 * 头里是不是 AVIF / HEIF 族。只看 `ftyp` 的品牌、**不看尺寸** —— 它要回答的是"值不值得为这族
 * 放宽读头"，若以"量不出尺寸"为条件就成自证了。
 */
function isAvifFamilyHead(b) {
  const ftyp = isoBoxAt(b, 0, b.length);
  return !!(ftyp && ftyp.type === "ftyp" && avifBrandIn(b, ftyp));
}
/**
 * 从 AVIF / HEIF 的盒树里读出主图尺寸（认不出给 null）。
 *
 * 先按盒链走（`ftyp` 之后的顶层盒里找 `meta`）；走不到时再在**已读到的头部字节**里兜底扫
 * `meta` 盒头 —— 极少数编码器把 `ftyp` 的 size 写成整个文件、或把 `meta` 排在 `mdat` 之后，
 * 按链就够不着它。兜底不是"见到字就读"：每个候选盒都必须真的走出 `iprp → ipco → ispe`，
 * 走不通就继续找下一个；全都不行才给 null ⇒ 退回解码腿，绝不误拒。
 */
function parseAvifSize(b) {
  const ftyp = isoBoxAt(b, 0, b.length);
  if (!ftyp || ftyp.type !== "ftyp") return null;
  // 主品牌（+ 兼容品牌）必须是这一族，否则不拿任意 ISOBMFF 当图片探。
  // ftyp 有效载荷 = major_brand(4) + minor_version(4) + compatible_brands…，从 start 起逐个品牌。
  const brand = avifBrandIn(b, ftyp);
  if (!brand) return null;
  const chained = isoFind(b, "meta", ftyp.end, b.length);
  if (chained) {
    const got = avifSizeInMeta(b, chained);
    if (got) return { width: got.width, height: got.height, kind: avifKind(brand) };
  }
  for (let at = ftyp.start; at + 8 <= b.length; at++) {
    if (b[at + 4] !== 0x6d || b[at + 5] !== 0x65 || b[at + 6] !== 0x74 || b[at + 7] !== 0x61) continue;
    const cand = isoBoxAt(b, at, b.length);
    if (!cand || cand.type !== "meta" || cand.end - cand.start < 4) continue;
    if (chained && cand.start === chained.start) continue;
    const got = avifSizeInMeta(b, cand);
    if (got) return { width: got.width, height: got.height, kind: avifKind(brand) };
  }
  return null;
}
/**
 * 从**位图**文件头里读出 `{ width, height, kind }`（认不出给 null）。
 *
 * 覆盖 PNG（IHDR）/ GIF（逻辑屏幕）/ BMP（DIB 头，含高度为负的自顶向下位图）/
 * WebP（VP8 / VP8L / VP8X 三种容器）/ JPEG（逐个扫 SOFn 段）/ AVIF·HEIF（盒树，
 * 见 `parseAvifSize`）。前几种都是**首部即尺寸**的格式，所以只需前若干字节；
 * JPEG 的 SOF 段可能被 EXIF 推后、AVIF 的 `meta` 可能排在 `mdat` 之后，
 * 故调用方先给 256 KB；AVIF / HEIF 这一族在这一段里读不出时，再按体积闸上限放宽重读
 * （见 `AVATAR_AVIF_HEAD_BYTES`）。
 */
function parseBitmapHeaderSize(buffer) {
  if (!buffer) return null;
  const b = new Uint8Array(buffer);
  if (b.length < 16) return null;
  // PNG：89 50 4E 47 0D 0A 1A 0A，随后是长度 4 + "IHDR" + 宽(4) + 高(4)。
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) {
    return { width: readU32BE(b, 16), height: readU32BE(b, 20), kind: "png" };
  }
  // GIF：GIF87a / GIF89a，宽高是小端 u16。
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b.length >= 10) {
    return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), kind: "gif" };
  }
  // BMP：BM + 文件头 14 字节后用 DIB 头，宽高是**有符号**小端 i32（负高度 = 自顶向下）。
  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) {
    const dw = readU32LE(b, 18); const dh = readU32LE(b, 22);
    const w = dw > 0x7fffffff ? dw - 0x100000000 : dw;
    const h = dh > 0x7fffffff ? dh - 0x100000000 : dh;
    return { width: Math.abs(w), height: Math.abs(h), kind: "bmp" };
  }
  // WebP：RIFF....WEBP，再按容器形态取宽高。
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 && b.length >= 30) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8X") {
      // 扩展容器：宽高各 24 位小端，语义是"实际尺寸 - 1"。
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { width: w, height: h, kind: "webp" };
    }
    if (fourcc === "VP8 ") {
      // 关键帧头：3 字节起始码 + 2 字节版本/标志，随后 14 位宽、14 位高（小端 u16 & 0x3fff）。
      const at = 26;
      if (b.length >= at + 4) {
        return {
          width: (b[at] | (b[at + 1] << 8)) & 0x3fff,
          height: (b[at + 2] | (b[at + 3] << 8)) & 0x3fff,
          kind: "webp",
        };
      }
    }
    if (fourcc === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
      // 无损：1 字节签名 0x2f + 14 位宽-1、14 位高-1（跨 4 字节的位域）。
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), kind: "webp" };
    }
  }
  // JPEG：FFD8 起，逐段跳到 SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15 读宽高。
  if (b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) { at++; continue; }
      const marker = b[at + 1];
      // 填充字节 / 无载荷标记：跳过。
      if (marker === 0xff) { at++; continue; }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { at += 2; continue; }
      if (marker === 0xda) break; // 进入压缩数据，尺寸段一定在前面
      const len = (b[at + 2] << 8) | b[at + 3];
      if (len < 2) break;
      const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isSof && at + 9 <= b.length) {
        return { width: (b[at + 7] << 8) | b[at + 8], height: (b[at + 5] << 8) | b[at + 6], kind: "jpeg" };
      }
      at += 2 + len;
    }
  }
  // AVIF / HEIF：`ftyp` 盒（offset 4 的 4cc）⇒ 尺寸在盒树里，单独走 parseAvifSize。
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    return parseAvifSize(b);
  }
  return null;
}
/**
 * 从 SVG 文本里读 `width` / `height` / `viewBox`（认不出给 null）。
 *
 * SVG 是**文本**，尺寸只写在属性或 viewBox 里；这里只做**数值感知的取值**（不建 DOM、
 * 不解析 XML）：闸只关心"会不会太大"，读不到就退回解码路径由浏览器裁决。
 * 单位为百分号 / em 这类相对值时读不出数（预期如此，返回 null）。
 */
function parseSvgSize(text) {
  if (typeof text !== "string" || !text) return null;
  const head = text.slice(0, 4096);
  if (!/<svg[\s>]/i.test(head)) return null;
  /** 取一个数值属性（**只吃纯数字**，带 px 也行；百分比 / em 交给 null 兜底）。 */
  const attr = (name) => {
    const m = new RegExp(name + '\\s*=\\s*["\']?\\s*([0-9]+(?:\\.[0-9]+)?)').exec(head);
    return m ? Number(m[1]) : NaN;
  };
  const w = attr("width"); const h = attr("height");
  if (isFinite(w) && isFinite(h) && w > 0 && h > 0) {
    return { width: Math.round(w), height: Math.round(h), kind: "svg" };
  }
  const vb = /viewBox\s*=\s*["'][\s,]*([-0-9.eE]+)[\s,]+([-0-9.eE]+)[\s,]+([0-9.eE]+)[\s,]+([0-9.eE]+)/i.exec(head);
  if (vb) {
    const vw = Number(vb[3]); const vh = Number(vb[4]);
    if (isFinite(vw) && isFinite(vh) && vw > 0 && vh > 0) {
      return { width: Math.round(vw), height: Math.round(vh), kind: "svg" };
    }
  }
  return null;
}
/** SVG 的文件头要读多少（字节）：尺寸属性在根元素上，4 KB 足够。 */
const AVATAR_SVG_HEAD_BYTES = 4096;
/** 位图文件头要读多少（字节）：JPEG 的 SOF 段可能被很长的 EXIF 推后，故给足 256 KB。 */
const AVATAR_BITMAP_HEAD_BYTES = 262144;
/**
 * AVIF / HEIF 读头放宽到多少（字节）：这一族的宽高住在 `meta` 盒树里，而 `meta` 允许排在
 * `mdat` **之后** —— 256 KB 的头够不到它（残留洞 A：`ftyp` + 3.4 MB `mdat` + `meta` 约 3.4 MiB，
 * 过得了 4 MiB 体积闸，却量不出边长 ⇒ 边长闸被绕过）。
 *
 * 取值就是体积闸上限：**超过它的文件本来就要被体积闸拒掉**，所以放宽只可能帮到"量得出边长的
 * 大文件"（让它们被边长闸正确拦下），不可能放过任何东西；而 ≤ 4 MiB 的文件会被**整份**读进
 * 来，`meta` 再靠后也在手里。内存代价 ≤ 4 MiB，且仍然**只读字节、不解码**。
 */
const AVATAR_AVIF_HEAD_BYTES = AVATAR_IMPORT_MAX_BYTES;
/**
 * 探一张待导入图的原图尺寸（**不解码**）。
 *
 * @param {Blob|File} file 待探的文件（只用 `type` / `size` / `slice`）
 * @returns {Promise<{width:number,height:number,kind:string}|null>} 认不出给 null
 */
async function probeImageSize(file) {
  const type = String((file && file.type) || "").toLowerCase();
  try {
    if (type === "image/svg+xml") {
      // SVG 是文本：只读开头一段就够（尺寸属性在根元素上）。
      const head = await file.slice(0, AVATAR_SVG_HEAD_BYTES).text();
      return parseSvgSize(head);
    }
    const head = await file.slice(0, AVATAR_BITMAP_HEAD_BYTES).arrayBuffer();
    const got = parseBitmapHeaderSize(head);
    if (got) return got;
    // 这一族的 `meta` 允许排在 `mdat` 之后 ⇒ 256 KB 的头可能够不到尺寸，按体积闸上限放宽重读。
    if (!isAvifFamilyHead(new Uint8Array(head))) return null;
    // `size` 读不到（非标准 Blob）就按上限读 —— 反正总量 ≤ 4 MiB。
    const cap = typeof file.size === "number" ? Math.min(file.size, AVATAR_AVIF_HEAD_BYTES)
      : AVATAR_AVIF_HEAD_BYTES;
    if (cap <= head.byteLength) return null;
    return parseBitmapHeaderSize(await file.slice(0, cap).arrayBuffer());
  } catch {
    return null;
  }
}
/**
 * 头像导入的两道闸。返回 `{ ok: true }` 或 `{ ok: false, overBytes, overEdge, bytes, width, height }`。
 *
 * ① 边长：任一边 > `AVATAR_IMPORT_MAX_EDGE` ⇒ 拒（用户口径「最大 1024×1024」）；
 * ② 体积：原图 > `AVATAR_IMPORT_MAX_BYTES` ⇒ 拒（4 MiB，见常量处的推算）。
 *
 * 尺寸**读不出来**（`size` 为 null）时只按体积判 —— 闸的意义是挡住已知的大图，而不是猜。
 */
function avatarImportLimit(file, size) {
  const bytes = Number(file && file.size) || 0;
  const overBytes = bytes > AVATAR_IMPORT_MAX_BYTES;
  const w = size ? Number(size.width) || 0 : 0;
  const h = size ? Number(size.height) || 0 : 0;
  const overEdge = w > AVATAR_IMPORT_MAX_EDGE || h > AVATAR_IMPORT_MAX_EDGE;
  if (!overBytes && !overEdge) return { ok: true };
  return { ok: false, overBytes: overBytes, overEdge: overEdge, bytes: bytes, width: w, height: h };
}
/** 把字节数说成人话（MB，一位小数；与系统文件大小同口径）。 */
function humanMb(bytes) {
  return (Math.round(((Number(bytes) || 0) / (1024 * 1024)) * 10) / 10) + " MB";
}

// 导出面只留真有消费者的名字（本仓 `verify-settings-schema-exports.mjs` 的口径：内部模块
// 的每个具名导出都必须有人真读）。下面这几个常量/读字节小工具是**文件内自用**
// （`AVATAR_IMPORT_MAX_BYTES` 见 `avatarImportLimit`、`AVATAR_SVG_HEAD_BYTES` /
// `AVATAR_BITMAP_HEAD_BYTES` 见 `probeImageSize`、`readU32BE` / `readU32LE` 见
// `parseBitmapHeaderSize`），仓库里没有任何跨文件引用 ⇒ 不加 `export`。
// （本文件来自 PR #202，其底座落后于本地线的 task-17 导出面清理，故这里按本地口径收窄。）
export {
  AVATAR_IMPORT_MAX_EDGE,
  IMAGE_DIRECT_ACCEPT, IMAGE_RASTER_ACCEPT, AVATAR_PICK_ACCEPT,
  parseBitmapHeaderSize, parseSvgSize, probeImageSize,
  avatarImportLimit, humanMb,
};
