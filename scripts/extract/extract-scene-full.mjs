// 提取 scene.json 完整内容: animationlayers + 水对象 effects
import fs from 'fs';

const PKG = 'c:/program files (x86)/steam/steamapps/workshop/content/431960/3461168300/scene.pkg';
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

const scene = JSON.parse(Buffer.from(read('scene.json')).toString('utf8'));
// 找 animationlayers
console.log('scene.json keys:', Object.keys(scene));
console.log('objects 数:', scene.objects ? scene.objects.length : 0);

// 动画层
for (const o of scene.objects || []) {
  if (o.animationlayers && o.animationlayers.length) {
    console.log('\n对象:', o.name || o.id, 'animationlayers:');
    for (const al of o.animationlayers) {
      console.log('  ', JSON.stringify(al));
    }
  }
}

// 水对象 effects
for (const o of scene.objects || []) {
  if ((o.name || '').includes('水')) {
    console.log('\n水对象:', o.name || o.id);
    if (o.effects) {
      for (const ef of o.effects) {
        console.log('  effect:', ef.name || ef.id, JSON.stringify(ef).slice(0, 1500));
      }
    }
  }
}

// 保存完整 scene.json
fs.writeFileSync('D:/dsh-wallpaper-engine/scene-layers-out/scene-full.json', JSON.stringify(scene, null, 1));
console.log('\nscene-full.json 已保存');
