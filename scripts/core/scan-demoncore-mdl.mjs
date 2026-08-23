// 系统扫描 demon_core MDL 顶点布局: pos + 单位法线 + uv∈[0,1]
import fs from 'fs';

const files = [
  'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/models/core/core.mdl',
  'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/models/backgroundsphere/backgroundsphere.mdl',
];

for (const p of files) {
  const b = fs.readFileSync(p);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  console.log(`\n========== ${p.split('/').pop()} ==========`);
  const matStart = b.indexOf('materials/', 8);
  const matEnd = b.indexOf(0, matStart);
  console.log('material:', b.toString('utf8', matStart, matEnd), '| dataStart:', matEnd + 1);
  console.log('u32@46..:', dv.getUint32(matEnd + 1, true), 'u32@+4:', dv.getUint32(matEnd + 5, true), 'u32@+8:', dv.getUint32(matEnd + 9, true));

  const results = [];
  for (let s = matEnd + 1; s < matEnd + 17; s++) {
    for (const stride of [24, 28, 32, 36, 40, 44, 48, 52, 56, 64, 72, 80]) {
      const remaining = b.length - s;
      const vc = Math.floor(remaining / stride);
      if (vc < 20) continue;
      let posOk = 0, normOk = 0, uvOk = 0, n = 0;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
      // uv 候选偏移 (在 stride 内)
      let bestUvOff = -1, bestUvOk = 0;
      for (let uvOff = 12; uvOff + 8 <= stride; uvOff += 4) {
        let ok = 0;
        for (let i = 0; i < Math.min(vc, 600); i++) {
          const o = s + i * stride;
          const u = dv.getFloat32(o + uvOff, true), v = dv.getFloat32(o + uvOff + 4, true);
          if (u >= -0.02 && u <= 1.02 && v >= -0.02 && v <= 1.02) ok++;
        }
        if (ok > bestUvOk) { bestUvOk = ok; bestUvOff = uvOff; }
      }
      for (let i = 0; i < Math.min(vc, 600); i++) {
        const o = s + i * stride;
        const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
        const nx = dv.getFloat32(o + 12, true), ny = dv.getFloat32(o + 16, true), nz = dv.getFloat32(o + 20, true);
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        n++;
        if (isFinite(x) && isFinite(y) && isFinite(z) && Math.abs(x) < 100 && Math.abs(y) < 100 && Math.abs(z) < 100) posOk++;
        if (Math.abs(nl - 1) < 0.05) normOk++;
      }
      const minOk = Math.min(vc, 600);
      if (posOk > minOk * 0.8 && normOk > minOk * 0.6 && bestUvOk > minOk * 0.6) {
        results.push({ s, stride, vc, posOk, normOk, bestUvOff, bestUvOk, minX, maxX, minY, maxY, minZ, maxZ });
      }
    }
  }
  results.sort((a, b) => (b.normOk + b.bestUvOk) - (a.normOk + a.bestUvOk));
  console.log('candidates (pos80%+norm60%+uv60%):');
  for (const r of results.slice(0, 6)) {
    console.log(`  start=${r.s} stride=${r.stride} verts=${r.vc} pos=${r.posOk} norm=${r.normOk} uv@${r.bestUvOff} (${r.bestUvOk}) posX[${r.minX.toFixed(2)},${r.maxX.toFixed(2)}] Y[${r.minY.toFixed(2)},${r.maxY.toFixed(2)}] Z[${r.minZ.toFixed(2)},${r.maxZ.toFixed(2)}]`);
  }

  // 用最佳结果试解索引流
  const best = results[0];
  if (best) {
    const io = best.s + best.vc * best.stride;
    const after = b.length - io;
    console.log(`\nbest: start=${best.s} stride=${best.stride} verts=${best.vc}; index region @${io}, ${after} bytes`);
    for (let off = 0; off < Math.min(48, after - 4); off += 2) {
      const cnt = dv.getUint32(io + off, true);
      const cnt16 = dv.getUint16(io + off, true);
      if (cnt > 0 && cnt < 200000 && cnt % 2 === 0 && io + off + 4 + cnt <= b.length) {
        let ok = 0, n2 = 0;
        for (let k = 0; k < Math.min(cnt / 2, 300); k++) {
          const idx = dv.getUint16(io + off + 4 + k * 2, true);
          if (idx < best.vc) ok++;
          n2++;
        }
        if (ok > n2 * 0.9) console.log(`  INDEX u32@+${off}: count=${cnt} (${ok}/${n2} idx < vc)`);
      }
      if (cnt16 > 0 && cnt16 < 100000 && io + off + 2 + cnt16 * 2 <= b.length) {
        let ok = 0, n2 = 0;
        for (let k = 0; k < Math.min(cnt16, 300); k++) {
          const idx = dv.getUint16(io + off + 2 + k * 2, true);
          if (idx < best.vc) ok++;
          n2++;
        }
        if (ok > n2 * 0.9 && ok > 100) console.log(`  INDEX u16@+${off}: count=${cnt16} (${ok}/${n2} idx < vc)`);
      }
    }
  }
}
