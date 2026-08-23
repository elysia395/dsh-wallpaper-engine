// 解析眼睛 MDL 动画 (眨眼/高光), 计算 f=0 网格位移 — 找 ~90px 水平偏移
import fs from 'fs';
const mod = await import('../lib/scene-renderer.js');
const pkg = mod.readPkg('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg');

function parseMdl(mdlPath) {
  const buf = pkg.read(mdlPath);
  if (!buf) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const mdls = buf.indexOf(Buffer.from('MDLS'));
  const mdla = buf.indexOf(Buffer.from('MDLA0006'));
  if (mdla < 0) return { buf, dv, mdls, mdla: -1 };
  let mdle = buf.length;
  for (let i = mdla + 8; i + 8 < buf.length; i++) {
    if (buf.toString('ascii', i, i + 8) === 'MDLE0002') { mdle = i; break; }
  }
  return { buf, dv, mdls, mdla, mdle };
}

// 找动画: 名字 → 头部字段 (loop 相对偏移)
function findAnim(mdl, name) {
  const { buf, dv, mdla } = mdl;
  const nb = Buffer.from(name + '\0', 'utf8');
  const idx = buf.indexOf(nb, mdla);
  if (idx < 0) return null;
  const loop = buf.indexOf(Buffer.from('loop\0'), idx);
  const fps = dv.getFloat32(loop + 5, true);
  const frames = dv.getUint32(loop + 9, true);
  const bones = dv.getUint32(loop + 17, true);
  const blockSize = dv.getUint16(loop + 25, true);
  const dataStart = loop + 29;
  return { name, idx, loop, fps, frames, bones, blockSize, dataStart, mdla };
}

// 解析顶点
function parseVerts(mdl) {
  const { buf, dv, mdls, mdla } = mdl;
  let verticesOffset = -1, vertexCount = 0;
  for (let offset = 9; offset + 12 < (mdls > 0 ? mdls : mdla); offset++) {
    const vertexBytes = dv.getUint32(offset + 4, true);
    const vo = offset + 8;
    if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
    const ilo = vo + vertexBytes;
    if (ilo + 4 > (mdls > 0 ? mdls : mdla)) continue;
    const indexBytes = dv.getUint32(ilo, true);
    const io = ilo + 4;
    if (indexBytes === 0 || indexBytes % 2 !== 0 || io + indexBytes > (mdls > 0 ? mdls : mdla)) continue;
    verticesOffset = vo; vertexCount = vertexBytes / 80;
    break;
  }
  if (verticesOffset < 0) return null;
  const verts = [];
  for (let i = 0; i < vertexCount; i++) {
    const o = verticesOffset + i * 80;
    verts.push({
      x: dv.getFloat32(o, true), y: dv.getFloat32(o + 4, true),
      bones: [dv.getUint32(o + 40, true), dv.getUint32(o + 44, true), dv.getUint32(o + 48, true), dv.getUint32(o + 52, true)],
      weights: [dv.getFloat32(o + 56, true), dv.getFloat32(o + 60, true), dv.getFloat32(o + 64, true), dv.getFloat32(o + 68, true)],
    });
  }
  return verts;
}

// 解析骨骼锚点
function parseBones(mdl) {
  const { buf, dv, mdls, mdla } = mdl;
  if (mdls < 0 || mdla < 0) return [];
  const bones = [];
  let p = mdls + 17;
  for (let b = 0; b < 300 && p < mdla; b++) {
    const type = dv.getUint32(p + 1, true);
    const parent = dv.getUint32(p + 5, true);
    const entryLen = dv.getUint32(p + 9, true);
    if (entryLen <= 0 || entryLen > 10000) { p += 9; bones.push({ b, error: true }); continue; }
    const floats = [];
    for (let i = 0; i < Math.floor(entryLen / 4); i++) floats.push(dv.getFloat32(p + 13 + i * 4, true));
    const infoStart = p + 13 + entryLen;
    let infoStr = '';
    let ip2 = infoStart;
    while (ip2 < buf.length && buf[ip2] >= 32 && buf[ip2] < 127) { infoStr += String.fromCharCode(buf[ip2]); ip2++; }
    bones.push({ b, type, parent: parent === 0xffffffff ? -1 : parent, anchor: [floats[12] ?? NaN, floats[13] ?? NaN] });
    p = infoStart + infoStr.length + 1;
  }
  return bones;
}

// 计算动画 f 的网格整体位移 (LBS)
function skinDisplacement(mdl, anim, verts, bones, f) {
  const { buf, dv, mdle } = mdl;
  const nb = anim.bones;
  const framesN = anim.frames + 1;
  let tx = 0, ty = 0, wsum = 0;
  const perV = [];
  for (const v of verts) {
    let fx = v.x, fy = v.y;
    for (let k = 0; k < 4; k++) {
      const w = v.weights[k];
      if (w <= 0.001) continue;
      const b = v.bones[k];
      if (b >= nb) continue;
      const rot = (2 * b) % 9;
      const o = anim.dataStart + (b * framesN + f) * 36;
      if (o + 36 > mdle) continue;
      const un = new Array(9);
      for (let i = 0; i < 9; i++) un[i] = dv.getFloat32(o + ((i + rot) % 9) * 4, true);
      const pos = un.slice(0, 3), rrot = un.slice(3, 6);
      const an = bones[b] && bones[b].anchor;
      if (!an || !isFinite(an[0])) continue;
      const [rx, ry, rz] = rrot;
      const cz = Math.cos(rz), sz = Math.sin(rz);
      const cy = Math.cos(ry), sy = Math.sin(ry);
      const cx = Math.cos(rx), sx = Math.sin(rx);
      const lx = v.x - an[0], ly = v.y - an[1];
      const y1 = ly * cx, z1 = ly * sx;
      const x2 = lx * cy + z1 * sy, z2 = -lx * sy + z1 * cy;
      const wx = pos[0] + x2 * cz - y1 * sz;
      const wy = pos[1] + x2 * sz + y1 * cz;
      fx += w * (wx - v.x);
      fy += w * (wy - v.y);
    }
    perV.push([fx - v.x, fy - v.y]);
    tx += fx - v.x; ty += fy - v.y;
    wsum += 1;
  }
  return { dx: wsum ? tx / wsum : 0, dy: wsum ? ty / wsum : 0, perV };
}

for (const mdlPath of ['models/左眼_puppet.mdl', 'models/右眼_puppet.mdl', 'models/眉毛_puppet.mdl', 'models/鼻子_puppet.mdl']) {
  const mdl = parseMdl(mdlPath);
  if (!mdl || mdl.mdla < 0) { console.log(mdlPath, ': 无 MDLA'); continue; }
  console.log('\n=== ' + mdlPath + ' MDLA@' + mdl.mdla + ' MDLE@' + mdl.mdle);
  const verts = parseVerts(mdl);
  const bones = parseBones(mdl);
  console.log('顶点:', verts ? verts.length : '?', '骨骼:', bones.filter(b => !b.error).length);
  // 找所有动画名 (扫描 "动画"/"眨眼"/"高光"/"闭眼"/"呼吸" 等名字)
  const nameCandidates = [];
  const searchNames = ['动画 1', '动画 2', '动画 3', '左眼正常眨眼', '左眼高光', '右眼正常眨眼', '右眼高光运动', '眼睛正常眨', '闭眼', '呼吸循环', '呼吸'];
  for (const n of searchNames) {
    const a = findAnim(mdl, n);
    if (a) { nameCandidates.push(a); console.log(`  动画 "${n}": fps=${a.fps} frames=${a.frames} bones=${a.bones} data@${a.dataStart - a.mdla}`); }
  }
  if (!nameCandidates.length) {
    // 扫描所有 "loop\0" 前的名字
    let off = mdl.mdla;
    while (off < mdl.mdle) {
      const li = bufIndexOfLoop(mdl, off);
      if (li < 0) break;
      // 名字 = loop 前, 找前一个 \0
      let nameStart = li;
      while (nameStart > mdl.mdla && mdl.buf[nameStart - 1] !== 0) nameStart--;
      const name = mdl.buf.toString('utf8', nameStart, li);
      if (name.trim()) { const a = findAnim(mdl, name); if (a) { nameCandidates.push(a); console.log(`  扫描动画 "${name}": frames=${a.frames} bones=${a.bones}`); } }
      off = li + 5;
    }
  }
  // f=0 和 f=1 位移
  for (const a of nameCandidates) {
    for (const f of [0, 1, 2, 12]) {
      if (f > a.frames) continue;
      const { dx, dy } = skinDisplacement(mdl, a, verts, bones, f);
      console.log(`  "${a.name}" f=${f}: 网格位移 (${dx.toFixed(2)}, ${dy.toFixed(2)})`);
    }
  }
}

function bufIndexOfLoop(mdl, from) {
  return mdl.buf.indexOf(Buffer.from('loop\0'), from);
}
