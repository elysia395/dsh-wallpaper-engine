// 检查头部纹理的原始字节 (png-pass) 是否真的是 PNG 且内容正确
import { SceneRenderer } from '../lib/scene-renderer.js';
import { parseTex, decodeTex } from '../lib/pkg-extract.js';

const r = new SceneRenderer('C:/Program Files (x86)/Steam/steamapps/workshop/content/431960/3486806915/scene.pkg', { width: 3840, height: 2160, time: 0, log: () => {} });

const head = r.objects.find(o => o.id === 697);
const model = r.pkg.readJson(head.image);
const mat = r.pkg.readJson(model.material);
const t = mat.passes[0].textures[0];
console.log('头纹理名:', t);

const raw = r.pkg.read('materials/' + t + '.tex');
console.log('tex 大小:', raw.length);
const info = parseTex(raw);
console.log('parseTex:', JSON.stringify(info));
const dec = decodeTex(raw);
console.log('decodeTex kind:', dec.kind, 'bytes:', dec.bytes && dec.bytes.length);

if (dec.kind === 'png-pass') {
  const b = Buffer.from(dec.bytes);
  console.log('PNG magic:', b.slice(0, 8).toString('hex'));
  console.log('PNG 尺寸:', b.readUInt32BE(16) + 'x' + b.readUInt32BE(20));
  console.log('PNG bit/color:', b[24], '/', b[25]);
  // 检查 PNG 是否有效: 应该有大量像素
  // 采样 PNG 的 IDAT 大小
  let idatLen = 0, pos = 8;
  while (pos + 12 <= b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idatLen += len;
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  console.log('PNG IDAT 总大小:', idatLen);
  // 对比 decodePngBuffer 的结果
  const { loadTexImage } = await import('../lib/scene-renderer.js');
  const img = loadTexImage(raw);
  console.log('loadTexImage:', img.width + 'x' + img.height, 'rgba len', img.rgba.length);
  // 采样几个像素
  for (const [x, y] of [[100, 100], [274, 339], [400, 500], [200, 300]]) {
    const i = (y * img.width + x) * 4;
    console.log('纹理(' + x + ',' + y + '): rgba(' + img.rgba[i] + ',' + img.rgba[i+1] + ',' + img.rgba[i+2] + ',' + img.rgba[i+3] + ')');
  }
}
