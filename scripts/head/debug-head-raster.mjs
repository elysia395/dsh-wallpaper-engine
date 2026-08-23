// 深挖头部光栅化: 为什么 0 像素
import { SceneRenderer } from '../lib/scene-renderer.js';

const PKG = 'C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg';
const r = new SceneRenderer(PKG, { width: 3840, height: 2160, time: 0, log: () => {} });
const head = r.objects.find(o => o.id === 697);
const model = r.pkg.readJson(head.image);
const mesh = r._parseMdl(r.pkg.read(model.puppet));
const tex = r.loadModelTexture(head.image);

console.log('头部网格: 顶点', mesh.positions.length, '索引', mesh.indices.length, 'UV', mesh.uvs.length);
// UV 范围
let minU = 9, maxU = -9, minV = 9, maxV = -9;
for (const [u, v] of mesh.uvs) { if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v; }
console.log('UV: u[' + minU.toFixed(3) + ',' + maxU.toFixed(3) + '] v[' + minV.toFixed(3) + ',' + maxV.toFixed(3) + ']');
console.log('纹理:', tex.width + 'x' + tex.height);
// UV 对应的像素范围
console.log('UV→像素: u*' + tex.width + ' = [' + (minU*tex.width).toFixed(0) + ',' + (maxU*tex.width).toFixed(0) + '], v*' + tex.height + ' = [' + (minV*tex.height).toFixed(0) + ',' + (maxV*tex.height).toFixed(0) + ']');

// 检查光栅化器: 手动光栅化一个三角形看是否产生像素
const bounds = r._meshBounds(mesh.positions);
const W = Math.ceil(bounds.maxX - bounds.minX) + 1;
const H = Math.ceil(bounds.maxY - bounds.minY) + 1;
const flipY = (y) => bounds.maxY - y;
const img = r._rasterizeMesh(mesh, tex, mesh.positions, bounds, W, H, flipY);
let cnt = 0;
for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 30) cnt++;
console.log('光栅化后不透明像素:', cnt, '/', W * H);

// 检查 sample 函数: 采样纹理中心 UV (0.5, 0.5)
// 手动验证 UV 是否正确 (采样一个已知 UV)
const tw = tex.width, th = tex.height;
function sampleAt(u, v) {
  const fx = u * tw - 0.5, fy = v * th - 0.5;
  const x0 = Math.max(0, Math.min(tw - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(th - 1, Math.floor(fy)));
  const i = (y0 * tw + x0) * 4;
  return tex.rgba[i] + ',' + tex.rgba[i+1] + ',' + tex.rgba[i+2] + ',' + tex.rgba[i+3];
}
console.log('纹理 (0.5,0.5):', sampleAt(0.5, 0.5));
console.log('纹理 (0.1,0.1):', sampleAt(0.1, 0.1));

// 检查前几个三角形的光栅化 (手动)
const { uvs, indices } = mesh;
let triWithPixels = 0, triTotal = 0;
for (let t = 0; t < indices.length; t += 3) {
  triTotal++;
  const i0 = indices[t], i1 = indices[t+1], i2 = indices[t+2];
  const a = [mesh.positions[i0][0] - bounds.minX, flipY(mesh.positions[i0][1])];
  const b = [mesh.positions[i1][0] - bounds.minX, flipY(mesh.positions[i1][1])];
  const c = [mesh.positions[i2][0] - bounds.minX, flipY(mesh.positions[i2][1])];
  const area = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  if (Math.abs(area) < 1e-9) continue;
  // 检查三角形包围盒
  const bx0 = Math.max(0, Math.floor(Math.min(a[0],b[0],c[0])));
  const by0 = Math.max(0, Math.floor(Math.min(a[1],b[1],c[1])));
  const bx1 = Math.min(W-1, Math.ceil(Math.max(a[0],b[0],c[0])));
  const by1 = Math.min(H-1, Math.ceil(Math.max(a[1],b[1],c[1])));
  if (bx1 < bx0 || by1 < by0) continue;
  // 采样中心点
  const px = (a[0]+b[0]+c[0])/3, py = (a[1]+b[1]+c[1])/3;
  const la = ((b[0]-px)*(c[1]-py) - (b[1]-py)*(c[0]-px)) / area;
  const lb = ((c[0]-px)*(a[1]-py) - (c[1]-py)*(a[0]-px)) / area;
  const lc = ((a[0]-px)*(b[1]-py) - (a[1]-py)*(b[0]-px)) / area;
  if (la < -1e-4 || lb < -1e-4 || lc < -1e-4) continue;
  const u = la*uvs[i0][0] + lb*uvs[i1][0] + lc*uvs[i2][0];
  const v = la*uvs[i0][1] + lb*uvs[i1][1] + lc*uvs[i2][1];
  const sx = Math.max(0, Math.min(W-1, Math.floor(px)));
  const sy = Math.max(0, Math.min(H-1, Math.floor(py)));
  const di = (sy * W + sx) * 4;
  if (img.rgba[di+3] > 30) triWithPixels++;
}
console.log('有像素的三角形:', triWithPixels, '/', triTotal);
