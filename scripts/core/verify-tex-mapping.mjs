import fs from 'fs';
import { decodeTex } from 'file:///D:/dsh-wallpaper-engine/lib/pkg-extract.js';

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
// 人物贴图内容分析：角色在贴图中的实际区域（alpha>10 的分布）
const model = JSON.parse(Buffer.from(read('models/人物.json')).toString('utf8'));
const mat = JSON.parse(Buffer.from(read(model.material)).toString('utf8'));
const tex = decodeTex(read('materials/' + mat.passes[0].textures[0] + '.tex'));
const { width: w, height: h, rgba } = tex;
console.log('人物贴图', w + 'x' + h);
// 每 10% 高度的非空像素数
for (let band = 0; band < 10; band++) {
  const y0 = (h * band) / 10 | 0, y1 = (h * (band + 1)) / 10 | 0;
  let cnt = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x += 4) {
      if (rgba[(y * w + x) * 4 + 3] > 10) cnt++;
    }
  }
  console.log('  y ' + (band * 10) + '-' + ((band + 1) * 10) + '%: 非空采样 ' + cnt);
}
// 角色包围盒 (x[747,2993] y[294,2549]) 对应贴图区域
console.log('\n角色渲染包围盒 y[294,2549] = 贴图 ' + (294 / h * 100).toFixed(0) + '%-' + (2549 / h * 100).toFixed(0) + '% 高度');
console.log('角色渲染包围盒 x[747,2993] = 贴图 ' + (747 / w * 100).toFixed(0) + '%-' + (2993 / w * 100).toFixed(0) + '% 宽度');
