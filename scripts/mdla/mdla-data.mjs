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
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

const mdla = 79842, mdle = 1481325;
// MDLA 结构推测: "MDLA0006"(9) + u32(4) + "动画 1"(str) + u32 + "loop"(4+4?) + 数据
// 从 ASCII 看: MDLA0006 + .m... + 字符串"动画 1" + .loop. + 数据
// 定位 "loop" 后的数据起点
const loopIdx = buf.indexOf(Buffer.from('loop'), mdla);
console.log('loop @', loopIdx);
// loop 后: 跳过 \0\0 + 可能的 u32
let dataStart = loopIdx + 4;
while (dataStart < buf.length && buf[dataStart] === 0) dataStart++;
console.log('MDLA 数据起点 @', dataStart, '(相对 +' + (dataStart - mdla) + ')');
const dataLen = mdle - dataStart;
console.log('MDLA 数据长度:', dataLen);

// 尝试多种"骨骼数×矩阵"布局
console.log('\n数据区按矩阵解析:');
for (const bones of [30, 31, 32, 40, 48, 53, 64, 128]) {
  for (const matSize of [48, 64, 80]) {
    const total = bones * matSize;
    if (dataLen >= total) {
      // 检查第一个矩阵
      const m00 = dv.getFloat32(dataStart, true);
      const m11 = dv.getFloat32(dataStart + matSize + 16, true);
      const m22 = dv.getFloat32(dataStart + matSize * 2 + 32, true);
      console.log('  bones=' + bones, 'mat=' + matSize + 'B', 'm00=' + m00.toFixed(3), 'm11(第2矩阵)=' + m11.toFixed(3), 'm22(第3)=' + m22.toFixed(3));
    }
  }
}

// 打印数据区前 80 个 float
console.log('\n数据区前 80 float:');
const fs2 = [];
for (let i = 0; i < 80; i++) fs2.push(dv.getFloat32(dataStart + i * 4, true).toFixed(3));
console.log(fs2.join(' '));

// 检查是否在数据区开头有骨骼层级/名称
console.log('\n数据区开头 ASCII:');
let ascii = '';
for (let i = dataStart; i < Math.min(dataStart + 200, buf.length); i++) {
  const c = buf[i];
  ascii += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
}
console.log(ascii);

// 检查 512 的作用：可能是帧数或骨骼数（u32@+12=512）
// 如果 512 是帧数，数据区 = 512 × 每帧数据
// 每帧 = 骨骼数 × 变换
console.log('\n512 假设:');
for (const perFrame of [30, 31, 32, 48, 53, 64, 128]) {
  const frameBytes = perFrame * 64;
  const frames = Math.floor(dataLen / frameBytes);
  console.log('  每帧' + perFrame + '骨骼×64B =', frameBytes, '→ 帧数', frames);
}
