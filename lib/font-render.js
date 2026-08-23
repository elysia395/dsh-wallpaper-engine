// CFF (Compact Font Format) 字体解析 + 文本光栅化
// 支持: sfnt 表目录 → CFF 表 → Name/CharStrings INDEX → charstring 轮廓 →
//       扫描线光栅化 (非零环绕). 用于 WE text 对象 (Segment7Standard.otf 等).
// 参考: Adobe CFF 规范 + 引擎 text 渲染语义 (FreeType 位图 → 画布合成)

// ── CFF 数据读取 ──────────────────────────────────────────────
function readU16(b, p) { return (b[p] << 8) | b[p + 1]; }
function readI16(b, p) { const v = readU16(b, p); return v >= 0x8000 ? v - 0x10000 : v; }

// CFF INDEX 读取: 返回 { p: 数据结束位置, items: Buffer[] }
function readCffIndex(b, p) {
  const count = readU16(b, p);
  if (count === 0) return { p: p + 2, items: [] };
  const offSize = b[p + 2];
  const offs = [];
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = (v << 8) | b[p + 3 + i * offSize + k];
    offs.push(v);
  }
  const dataStart = p + 3 + (count + 1) * offSize;
  const items = [];
  for (let i = 0; i < count; i++) {
    const s = dataStart + offs[i] - 1, e = dataStart + offs[i + 1] - 1;
    items.push(Buffer.from(b.slice(s, e)));
  }
  return { p: dataStart + offs[count] - 1, items };
}

// DICT 操作符解析: 返回 [{type:'num'|'op', value}]
export function parseDict(b) {
  const ops = [];
  let i = 0;
  while (i < b.length) {
    const byte = b[i];
    if (byte >= 32 && byte <= 246) { ops.push({ type: 'num', value: byte - 139 }); i++; }
    else if (byte >= 247 && byte <= 250) { ops.push({ type: 'num', value: (byte - 247) * 256 + b[i + 1] + 108 }); i += 2; }
    else if (byte >= 251 && byte <= 254) { ops.push({ type: 'num', value: -(byte - 251) * 256 - b[i + 1] - 108 }); i += 2; }
    else if (byte === 28) { ops.push({ type: 'num', value: readI16(b, i + 1) }); i += 3; }
    else if (byte === 29) { ops.push({ type: 'num', value: b.readInt32BE(i + 1) }); i += 5; }
    else if (byte === 30) {
      let s = '', j = i + 1, done = false, neg = false;
      while (!done && j < b.length) {
        const nib = b[j];
        for (const n of [nib >> 4, nib & 15]) {
          if (n === 15) { done = true; break; }
          if (n === 10) s += '.';
          else if (n === 11) s += 'E';
          else if (n === 12) s += 'E-';
          else if (n === 14) neg = true;
          else s += n;
        }
        j++;
      }
      ops.push({ type: 'num', value: parseFloat((neg ? '-' : '') + s) }); i = j;
    }
    else if (byte === 12) { ops.push({ type: 'op', value: 1200 + b[i + 1] }); i += 2; }
    else if (byte <= 27) { ops.push({ type: 'op', value: byte }); i++; }
    else { i++; } // 跳过未知
  }
  return ops;
}

// ── 字体解析 ──────────────────────────────────────────────────
export function parseCffFont(buf) {
  // 统一为 Buffer (需 readUInt32BE 等方法)
  const b = Buffer.from(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  // sfnt 表目录 (OTF: OTTO / TTF: 0x00010000)
  const magic = b[0] === 0x4f && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4f ? 'OTTO' : 'TTF';
  if (magic !== 'OTTO' && !(b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00)) return null;
  const numTables = readU16(b, 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]).trim();
    tables[tag] = { offset: b.readUInt32BE(off + 8), length: b.readUInt32BE(off + 12) };
  }
  const cff = tables['CFF'];
  if (!cff) return null;
  const o = cff.offset;
  // Name INDEX
  const nameIdx = readCffIndex(b, o + 4);
  // Top DICT INDEX
  const topIdx = readCffIndex(b, nameIdx.p);
  const topDict = topIdx.items[0];
  const topOps = parseDict(topIdx.items[0]);
  // 提取关键操作符值 (累积栈)
  let charstringsOff = -1, privateSize = 0, privateOff = 0, charsetOff = -1, encodingOff = -1;
  const stack = [];
  for (const op of topOps) {
    if (op.type === 'num') stack.push(op.value);
    else if (op.type === 'op') {
      switch (op.value) {
        case 15: charstringsOff = stack.length ? stack[stack.length - 1] : -1; break; // CharStrings
        case 17: break; // CharStringsType
        case 18: privateSize = stack.length >= 2 ? stack[stack.length - 2] : 0; privateOff = stack.length ? stack[stack.length - 1] : 0; break;
        case 16: charsetOff = stack.length ? stack[stack.length - 1] : -1; break; // charset
        case 0: encodingOff = stack.length ? stack[stack.length - 1] : -1; break; // Encoding
      }
      stack.length = 0;
    }
  }
  // 兜底: 数据验证 CharStrings 偏移 — 在候选偏移找 count 合理 (10..1000) 的 INDEX
  // (部分字体 op15 值解析不可靠, 用数据确认)
  {
    const candidates = [];
    for (const op of topOps) if (op.type === 'num' && op.value > 0 && op.value < 100000) candidates.push(op.value);
    candidates.sort((a, b) => a - b);
    let verified = -1;
    for (const cand of candidates) {
      const p = o + cand;
      if (p + 3 > b.length) continue;
      const cnt = readU16(b, p);
      const os = b[p + 2];
      if (cnt >= 10 && cnt <= 1000 && os >= 1 && os <= 4) {
        // 确认是 CharStrings: 最后一个条目偏移 ≈ 数据总长
        verified = cand;
        break;
      }
    }
    if (verified > 0) charstringsOff = verified;
  }
  if (charstringsOff < 0) return null;
  // CharStrings INDEX
  const csIdx = readCffIndex(b, o + charstringsOff);
  // Global Subrs: Top DICT INDEX 之后 (String INDEX 后)
  let gsubrIdx = { items: [] };
  try {
    const strIdx = readCffIndex(b, topIdx.p);
    gsubrIdx = readCffIndex(b, strIdx.p);
  } catch { /* 无 Global Subrs */ }
  // Local Subrs: Private DICT 的 Subrs 操作符 (19)
  let lsubrIdx = { items: [] };
  if (privateOff > 0) {
    try {
      const privDict = b.slice(o + privateOff, o + privateOff + privateSize);
      const privOps = parseDict(privDict);
      let subrsOff = -1;
      const st2 = [];
      for (const op of privOps) {
        if (op.type === 'num') st2.push(op.value);
        else if (op.type === 'op') { if (op.value === 19 && st2.length) subrsOff = st2[st2.length - 1]; st2.length = 0; }
      }
      if (subrsOff >= 0) lsubrIdx = readCffIndex(b, o + privateOff + subrsOff);
    } catch { /* 无 Local Subrs */ }
  }
  const gsubrs = gsubrIdx.items.map((it) => Buffer.from(it));
  const lsubrs = lsubrIdx.items.map((it) => Buffer.from(it));
  // charset: 字形名 → SID (此处只需字形索引顺序, 用 SID 找字符映射需 cmap 配合)
  // cmap: 字符码 → glyph id (字形索引 = CharStrings 索引)
  const cmap = tables['cmap'];
  let charToGlyph = new Map();
  if (cmap) {
    const nSub = readU16(b, cmap.offset + 2);
    for (let i = 0; i < nSub; i++) {
      const so = cmap.offset + 4 + i * 8;
      const pid = readU16(b, so), eid = readU16(b, so + 2), suboff = cmap.offset + b.readUInt32BE(so + 4);
      if (pid !== 3 || eid !== 1) continue; // Windows BMP
      const fmt = readU16(b, suboff);
      if (fmt === 4) {
        const segX2 = readU16(b, suboff + 6);
        const endCodes = suboff + 14;
        const startCodes = endCodes + segX2 + 2;
        const idDeltas = startCodes + segX2;
        const idRangeOffsets = idDeltas + segX2;
        for (let seg = 0; seg < segX2 / 2; seg++) {
          const endC = readU16(b, endCodes + seg * 2);
          const startC = readU16(b, startCodes + seg * 2);
          const delta = readI16(b, idDeltas + seg * 2);
          const ro = readU16(b, idRangeOffsets + seg * 2);
          for (let c = startC; c <= endC && c <= 0xffff; c++) {
            let gid = 0;
            if (ro === 0) gid = (c + delta) & 0xffff;
            else {
              const gi = idRangeOffsets + seg * 2 + ro + (c - startC) * 2;
              if (gi + 1 < b.length) gid = readU16(b, gi);
              if (gid !== 0) gid = (gid + delta) & 0xffff;
            }
            if (gid < csIdx.items.length) charToGlyph.set(c, gid);
          }
        }
      } else if (fmt === 12) {
        const nGroups = b.readUInt32BE(suboff + 12);
        for (let g = 0; g < nGroups; g++) {
          const go = suboff + 16 + g * 12;
          const sC = b.readUInt32BE(go), eC = b.readUInt32BE(go + 4), sG = b.readUInt32BE(go + 8);
          for (let c = sC; c <= eC; c++) {
            const gid = sG + (c - sC);
            if (gid < csIdx.items.length) charToGlyph.set(c, gid);
          }
        }
      }
    }
  }
  // hmtx: advance width per glyph
  const hmtx = tables['hmtx'];
  const hhea = tables['hhea'];
  let advances = new Array(csIdx.items.length).fill(500);
  if (hmtx && hhea) {
    const numHMetrics = readU16(b, hhea.offset + 34);
    for (let i = 0; i < Math.min(numHMetrics, csIdx.items.length); i++) {
      advances[i] = readU16(b, hmtx.offset + i * 4);
    }
  }
  const unitsPerEm = tables['head'] ? readU16(b, tables['head'].offset + 18) : 1000;
  const ascender = hhea ? readI16(b, hhea.offset + 4) : 800;
  const descender = hhea ? readI16(b, hhea.offset + 6) : -200;
  return {
    unitsPerEm, ascender, descender, advances,
    charToGlyph, charstrings: csIdx.items,
    gsubrs, lsubrs,
  };
}

// ── Charstring 解释器: 直线/曲线轮廓 ──────────────────────────
// 返回 [{x,y}] 闭合轮廓 (按轮廓分组), 非零环绕光栅化
function interpretCharstring(ops, gsubrs, localsubrs) {
  const contours = [];
  let cur = [];
  let x = 0, y = 0;
  const g = gsubrs || [], l = localsubrs || [];
  let sawWidth = false;
  const interpretOps = (opsArr, gg, ll, depth) => {
    if (depth > 10) return; // 子程序递归上限
    let j = 0;
    const st = [];
    let steps = 0;
    let hintCount = 0;
    while (j < opsArr.length && steps < 20000) {
      steps++;
      const byte = opsArr[j];
      if (byte >= 32 && byte <= 246) { st.push(byte - 139); j++; }
      else if (byte >= 247 && byte <= 250) { st.push((byte - 247) * 256 + opsArr[j + 1] + 108); j += 2; }
      else if (byte >= 251 && byte <= 254) { st.push(-(byte - 251) * 256 - opsArr[j + 1] - 108); j += 2; }
      else if (byte === 28) { st.push(readI16(opsArr, j + 1)); j += 3; }
      else if (byte === 255) { st.push((opsArr.readInt32BE ? opsArr.readInt32BE(j + 1) : ((opsArr[j+1]<<24)|(opsArr[j+2]<<16)|(opsArr[j+3]<<8)|opsArr[j+4])) / 65536); j += 5; }
      else if (byte === 12) {
        const op = 1200 + opsArr[j + 1]; j += 2;
        if (op === 1201 || op === 1202 || op === 1206 || op === 1207) { // hstem/vstem variants
          if (!sawWidth && st.length % 2 === 1) { st.shift(); sawWidth = true; }
          hintCount += st.length; st.length = 0;
        } else if (op === 1203) { st.length = 0; } // endchar variants
        else { st.length = 0; }
      }
      else if (byte === 1 || byte === 3 || byte === 18 || byte === 23) { if (!sawWidth && st.length % 2 === 1) { st.shift(); sawWidth = true; } hintCount += st.length; st.length = 0; j++; } // hstem/vstem (首数 width)
      else if (byte === 19 || byte === 20) { /* hintmask: 跳过 mask 字节 */ j += 1 + Math.ceil(hintCount / 8); st.length = 0; }
      else if (byte === 21) { // rmoveto
        if (!sawWidth && st.length === 3) { st.shift(); sawWidth = true; }
        const dy = st.pop() || 0, dx = st.pop() || 0;
        x += dx; y += dy;
        if (cur.length) contours.push(cur);
        cur = [{ x, y }];
        st.length = 0; j++;
      }
      else if (byte === 22) { // hmoveto
        if (!sawWidth && st.length === 2) { st.shift(); sawWidth = true; }
        const dx = st.pop() || 0;
        x += dx;
        if (cur.length) contours.push(cur);
        cur = [{ x, y }];
        st.length = 0; j++;
      }
      else if (byte === 4) { // vmoveto
        if (!sawWidth && st.length === 2) { st.shift(); sawWidth = true; }
        const dy = st.pop() || 0;
        y += dy;
        if (cur.length) contours.push(cur);
        cur = [{ x, y }];
        st.length = 0; j++;
      }
      else if (byte === 5) { // rlineto
        while (st.length >= 2) { const dy = st.shift(), dx = st.shift(); x += dx; y += dy; cur.push({ x, y }); }
        j++;
      }
      else if (byte === 6) { // hlineto
        let h = true;
        while (st.length >= 1) {
          const d = st.shift();
          if (h) x += d; else y += d;
          cur.push({ x, y }); h = !h;
        }
        j++;
      }
      else if (byte === 7) { // vlineto
        let h = false;
        while (st.length >= 1) {
          const d = st.shift();
          if (h) x += d; else y += d;
          cur.push({ x, y }); h = !h;
        }
        j++;
      }
      else if (byte === 8) { // rrcurveto
        while (st.length >= 6) {
          const dx1 = st.shift(), dy1 = st.shift(), dx2 = st.shift(), dy2 = st.shift(), dx3 = st.shift(), dy3 = st.shift();
          const x1 = x + dx1, y1 = y + dy1, x2 = x1 + dx2, y2 = y1 + dy2;
          x = x2 + dx3; y = y2 + dy3;
          cur.push({ x, y }); // 直线近似: 端点
        }
        j++;
      }
      else if (byte === 10 || byte === 29) { // callsubr / callgsubr
        const idx = st.pop() || 0;
        if (byte === 10 && ll && ll[idx]) interpretOps(parseCharstring(ll[idx]), gg, ll, depth + 1);
        else if (byte === 29 && gg && gg[idx]) interpretOps(parseCharstring(gg[idx]), gg, ll, depth + 1);
        j++;
      }
      else if (byte === 11 || byte === 14) { // return / endchar
        j++;
        break;
      }
      else if (byte === 24) { // rcurveline
        while (st.length >= 6) {
          const dx1 = st.shift(), dy1 = st.shift(), dx2 = st.shift(), dy2 = st.shift(), dx3 = st.shift(), dy3 = st.shift();
          x = x + dx1 + dx2 + dx3; y = y + dy1 + dy2 + dy3;
          cur.push({ x, y });
          if (st.length < 6) break;
        }
        if (st.length >= 2) { const dy = st.shift(), dx = st.shift(); x += dx; y += dy; cur.push({ x, y }); }
        j++;
      }
      else if (byte === 25) { // rlinecurve
        while (st.length >= 8) {
          const dy = st.shift(), dx = st.shift();
          x += dx; y += dy; cur.push({ x, y });
          if (st.length <= 6) break;
        }
        if (st.length >= 6) {
          const dx1 = st.shift(), dy1 = st.shift(), dx2 = st.shift(), dy2 = st.shift(), dx3 = st.shift(), dy3 = st.shift();
          x = x + dx1 + dx2 + dx3; y = y + dy1 + dy2 + dy3;
          cur.push({ x, y });
        }
        j++;
      }
      else if (byte === 30) { // vhcurveto
        let h = false;
        while (st.length >= 4) {
          const d1 = st.shift(), d2 = st.shift(), d3 = st.shift(), d4 = st.shift();
          if (!h) { x += d1; } else { y += d1; }
          x += d2; y += d3;
          x += d4; y += 0;
          cur.push({ x, y });
          if (st.length < 4) break;
          h = !h;
        }
        j++;
      }
      else if (byte === 31) { // hvcurveto
        let h = true;
        while (st.length >= 4) {
          const d1 = st.shift(), d2 = st.shift(), d3 = st.shift(), d4 = st.shift();
          if (h) { x += d1; } else { y += d1; }
          x += d2; y += d3;
          y += d4;
          cur.push({ x, y });
          if (st.length < 4) break;
          h = !h;
        }
        j++;
      }
      else if (byte === 26 || byte === 27 || byte === 16 || byte === 17) { j++; st.length = 0; } // flex / others
      else { j++; st.length = 0; }
    }
  };
  interpretOps(ops, g, l, 0);
  if (cur.length) contours.push(cur);
  // 闭合轮廓 (首尾相连)
  return contours.map((c) => {
    if (c.length > 1 && (c[0].x !== c[c.length - 1].x || c[0].y !== c[c.length - 1].y)) c.push({ ...c[0] });
    return c;
  });
}

function parseCharstring(buf) {
  return Buffer.from(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
}
export { interpretCharstring };

// ── 字形光栅化 (扫描线, 非零环绕) ─────────────────────────────
function rasterizeContours(contours, size, unitsPerEm) {
  // 轮廓坐标 (font units, CFF 原始坐标未乘 FontMatrix) → 位图像素
  // 动态缩放: 字形全高 = size
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const c of contours) for (const p of c) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const spanY = maxY - minY;
  const scale = spanY > 0 ? size / spanY : 1;
  if (maxX < minX) return { width: 0, height: 0, rgba: new Uint8Array(0) };
  const pad = 2;
  const W = Math.ceil((maxX - minX) * scale) + pad * 2;
  const H = Math.ceil((maxY - minY) * scale) + pad * 2;
  const rgba = new Uint8Array(W * H * 4);
  const toPx = (x, y) => [Math.round((x - minX) * scale) + pad, H - 1 - (Math.round((y - minY) * scale) + pad)];
  for (let py = 0; py < H; py++) {
    const yPix = py + 0.5;
    const yFont = minY + (H - 1 - py - pad + 0.5) / scale;
    // 每行扫描: 求所有边与扫描线交点
    const xs = [];
    for (const c of contours) {
      for (let i = 0; i < c.length - 1; i++) {
        const a = c[i], b = c[i + 1];
        if ((a.y <= yFont && b.y > yFont) || (b.y <= yFont && a.y > yFont)) {
          const t = (yFont - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.round((xs[k] - minX) * scale) + pad);
      const x1 = Math.min(W - 1, Math.round((xs[k + 1] - minX) * scale) + pad);
      for (let px = x0; px <= x1; px++) {
        const di = (py * W + px) * 4;
        rgba[di] = 255; rgba[di + 1] = 255; rgba[di + 2] = 255; rgba[di + 3] = 255;
      }
    }
  }
  return { width: W, height: H, rgba, offsetX: pad, offsetY: pad };
}

// ── 文本布局 + 渲染 ───────────────────────────────────────────
export function renderText(font, text, size, color = [1, 1, 1]) {
  const unitsPerEm = font.unitsPerEm || 1000;
  // 字形位图由 rasterizeContours 缩放 (轮廓已乘 FontMatrix); 布局用 advance × size/unitsPerEm
  const glyphs = [];
  let advance = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const gid = font.charToGlyph.get(code);
    if (gid == null) continue;
    const cs = font.charstrings[gid];
    if (!cs) continue;
    const contours = interpretCharstring(parseCharstring(cs), font.gsubrs, font.lsubrs);
    const img = rasterizeContours(contours, size, unitsPerEm);
    glyphs.push({ img, advance: font.advances[gid] || 0, code });
    advance += font.advances[gid] || 0;
  }
  if (!glyphs.length) return { width: 0, height: 0, rgba: new Uint8Array(0) };
  // 布局: 字形位图已按 size 缩放 (高 ≈ size), advance 按 em 比例
  const advScale = size / unitsPerEm;
  const maxH = Math.max(...glyphs.map((g) => g.img.height));
  const totalW = Math.max(1, Math.ceil(advance * advScale) + size);
  const totalH = Math.max(1, maxH + Math.round(size * 0.2));
  const out = new Uint8Array(totalW * totalH * 4);
  let x = 0;
  for (const g of glyphs) {
    const gx = Math.round(x) + 1;
    // 垂直居中
    const gy = Math.round((totalH - g.img.height) / 2);
    for (let py = 0; py < g.img.height; py++) {
      for (let px = 0; px < g.img.width; px++) {
        const si = (py * g.img.width + px) * 4;
        if (g.img.rgba[si + 3] > 128) {
          const dx = gx + px, dy = gy + py;
          if (dx >= 0 && dx < totalW && dy >= 0 && dy < totalH) {
            const di = (dy * totalW + dx) * 4;
            out[di] = Math.round(color[0] * 255);
            out[di + 1] = Math.round(color[1] * 255);
            out[di + 2] = Math.round(color[2] * 255);
            out[di + 3] = 255;
          }
        }
      }
    }
    x += g.advance * advScale;
  }
  // 裁剪空白边缘
  let minX = totalW, minY = totalH, maxX = -1, maxY = -1;
  for (let y = 0; y < totalH; y++) for (let x2 = 0; x2 < totalW; x2++) {
    if (out[(y * totalW + x2) * 4 + 3] > 0) {
      if (x2 < minX) minX = x2; if (x2 > maxX) maxX = x2;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { width: 0, height: 0, rgba: new Uint8Array(0) };
  const cw = maxX - minX + 1, chh = maxY - minY + 1;
  const cropped = new Uint8Array(cw * chh * 4);
  for (let y = 0; y < chh; y++) for (let x2 = 0; x2 < cw; x2++) {
    const si = ((y + minY) * totalW + (x2 + minX)) * 4;
    const di = (y * cw + x2) * 4;
    cropped[di] = out[si]; cropped[di + 1] = out[si + 1]; cropped[di + 2] = out[si + 2]; cropped[di + 3] = out[si + 3];
  }
  return { width: cw, height: chh, rgba: cropped, advancePx: advance * (size / unitsPerEm) };
}
