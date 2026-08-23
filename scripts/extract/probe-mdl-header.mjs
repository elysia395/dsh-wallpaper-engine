// 精确定位 demon_core MDL 头部字段与索引流
import fs from 'fs';

for (const [name, p] of [
  ['core', 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/models/core/core.mdl'],
  ['bgsphere', 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine/projects/defaultprojects/demon_core/models/backgroundsphere/backgroundsphere.mdl'],
]) {
  const b = fs.readFileSync(p);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const matStart = b.indexOf('materials/', 8);
  const matEnd = b.indexOf(0, matStart);
  console.log(`\n===== ${name} =====`);
  console.log('material:', b.toString('utf8', matStart, matEnd), 'null@', matEnd);
  // 头部字段: 假设 [u32 f0][u32 vertBytes][vertices][u32 idxCount][u16 indices]
  const f0 = dv.getUint32(matEnd + 1, true);
  const vertBytes = dv.getUint32(matEnd + 5, true);
  const vertStart = matEnd + 9;
  console.log(`f0=${f0} vertBytes=${vertBytes} vertStart=${vertStart}`);
  // 试 stride: 64 与 32
  for (const stride of [64, 32]) {
    if (vertBytes % stride === 0) {
      const vc = vertBytes / stride;
      const idxCountPos = vertStart + vertBytes;
      const idxCount = dv.getUint32(idxCountPos, true);
      const idxCount16 = dv.getUint16(idxCountPos, true);
      console.log(`stride=${stride}: vc=${vc}; u32@${idxCountPos}=${idxCount} u16@=${idxCount16}`);
      // 若 idxCount 合理, 验证索引
      for (const [off, cnt] of [[0, idxCount], [2, idxCount16], [4, dv.getUint32(idxCountPos + 4, true)]]) {
        const base = idxCountPos + off;
        if (cnt > 0 && cnt < 200000 && base + 4 + cnt <= b.length && cnt % 2 === 0) {
          let ok = 0, n2 = 0;
          for (let k = 0; k < Math.min(cnt / 2, 400); k++) {
            const idx = dv.getUint16(base + 4 + k * 2, true);
            if (idx < vc) ok++;
            n2++;
          }
          console.log(`  idx@+${off}: count=${cnt} ${ok}/${n2} < vc (${ok > n2 * 0.9 ? '✓' : '✗'})`);
        }
      }
      // 首个顶点浮点预览 (stride 64: pos/normal/uv; stride 32: pos/normal/uv)
      const o = vertStart;
      const floats = [];
      for (let k = 0; k + 4 <= stride; k += 4) floats.push(dv.getFloat32(o + k, true).toFixed(3));
      console.log(`  v0 floats: ${floats.join(' ')}`);
      if (stride === 64) {
        console.log(`  v0 uv@36: (${dv.getFloat32(o+36,true).toFixed(3)}, ${dv.getFloat32(o+40,true).toFixed(3)})`);
      } else {
        console.log(`  v0 uv@24: (${dv.getFloat32(o+24,true).toFixed(3)}, ${dv.getFloat32(o+28,true).toFixed(3)})`);
      }
      // 如果 stride=32 且 idxCount 不合理, 尝试 vertStart 前移
    }
  }
  // 也试 vertStart = matEnd+1 直接 (f0 可能是顶点流一部分)
  const altStart = matEnd + 1;
  console.log(`alt: vertStart=${altStart} u32@=${dv.getUint32(altStart, true)} u32@+4=${dv.getUint32(altStart+4, true)} u32@+8=${dv.getUint32(altStart+8, true)}`);
}
