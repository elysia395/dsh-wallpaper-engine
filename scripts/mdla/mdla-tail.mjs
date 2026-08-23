import fs from 'fs';
const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
function readPkg() {
  const data = fs.readFileSync(PKG);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const rstr = () => { const len = dv.getInt32(pos, true); pos += 4; const s = data.toString('utf8', pos, pos + len); pos += len; return s; };
  rstr(); const count = dv.getInt32(pos, true); pos += 4;
  const entries = [];
  for (let i = 0; i < count; i++) { const p = rstr(); const off = dv.getUint32(pos, true); const len = dv.getUint32(pos + 4, true); pos += 8; entries.push({ p, off, len }); }
  const dataStart = pos;
  const byPath = Object.fromEntries(entries.map((e) => [e.p, e]));
  function lz4(src, dstSize) {
    const dst = new Uint8Array(dstSize);
    let ip = 0, op = 0;
    while (ip < src.length) {
      const t = src[ip++];
      let lit = t >> 4;
      if (lit === 15) { let s = 0; do { s = src[ip++]; lit += s; } while (s === 255); }
      dst.set(src.subarray(ip, ip + lit), op); ip += lit; op += lit;
      if (ip >= src.length) break;
      const off = src[ip] | (src[ip + 1] << 8); ip += 2;
      let ml = t & 15;
      if (ml === 15) { let s = 0; do { s = src[ip++]; ml += s; } while (s === 255); }
      ml += 4;
      for (let i = 0; i < ml; i++) { dst[op] = dst[op - off]; op++; }
    }
    return dst;
  }
  const read = (p) => {
    const e = byPath[p];
    if (!e) return null;
    const abs = dataStart + e.off;
    const seg = data.subarray(abs, abs + e.len);
    const orig = dv.getUint32(abs, true) + dv.getUint32(abs + 4, true) * 4294967296;
    if (orig <= e.len || orig > 2147483647) return seg;
    let r = abs + 8;
    const out = new Uint8Array(orig);
    let written = 0;
    while (written < orig) {
      const u = dv.getInt32(r, true), c = dv.getInt32(r + 4, true);
      r += 8;
      out.set(lz4(data.subarray(r, r + c), u), written);
      r += c; written += u;
    }
    return out;
  };
  return { read };
}

const { read } = readPkg();
const buf = read('models/人物_puppet.mdl');
const dv2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const mdla = 79842, mdle = 1481325;
const DATA0 = mdla + 63;

// 假设: head = 53×133 = 7049 entries, tail 从 entry 7049 开始
const HEAD_END = 7049;
console.log('head 结束 @entry', HEAD_END, '(@' + (63 + HEAD_END * 36) + ' 相对 mdla)');

// 逐 36B 打印 tail 前 30 个条目
console.log('\n=== tail 前 30 个条目 (entry 7049-7078) ===');
for (let k = HEAD_END; k < HEAD_END + 30; k++) {
  const o = DATA0 + k * 36;
  const vals = [];
  for (let i = 0; i < 9; i++) vals.push(dv2.getFloat32(o + i * 4, true));
  console.log(`  k=${k} @${o - mdla}: [` + vals.map(f => isFinite(f) ? f.toFixed(2) : 'INF').join(', ') + ']');
}

// tail 结构: 53 块 × (601 或 602) 条目?
// 27×601 + 26×602 = 31879 = 总 tail 条目
// 验证: 找每块起点, 检查第 0 条是否与新骨头锚点一致
console.log('\n=== tail 每块首条目 (假设 53 块, 601/602) ===');
let pos2 = HEAD_END;
const tailBlocks = [];
let i = 0;
while (pos2 < 38928 && i < 60) {
  const o = DATA0 + pos2 * 36;
  const vals = [];
  for (let j = 0; j < 9; j++) vals.push(dv2.getFloat32(o + j * 4, true));
  tailBlocks.push({ start: pos2, vals });
  pos2 += (i % 2 === 0) ? 602 : 601; // 猜测交替
  i++;
}
for (const b of tailBlocks) {
  console.log(`  块@entry${b.start}: [` + b.vals.map(f => isFinite(f) ? f.toFixed(2) : 'INF').join(', ') + ']');
}

// 取第一个动得明显的块 (块0), 打印 tx/ty 曲线: entry 7049 起 200 帧
console.log('\n=== 块0 tx/ty 曲线 (entry 7049 起, 每 8 帧) ===');
for (let k = HEAD_END; k < HEAD_END + 602; k += 8) {
  const o = DATA0 + k * 36;
  const tx = dv2.getFloat32(o, true), ty = dv2.getFloat32(o + 4, true);
  const f2 = dv2.getFloat32(o + 8, true), f3 = dv2.getFloat32(o + 12, true);
  const f4 = dv2.getFloat32(o + 16, true), f5 = dv2.getFloat32(o + 20, true);
  console.log(`  f${k - HEAD_END}: tx=${tx.toFixed(2)} ty=${ty.toFixed(2)} f2=${f2.toFixed(2)} f3=${f3.toFixed(2)} f4=${f4.toFixed(2)} f5=${f5.toFixed(2)}`);
}
