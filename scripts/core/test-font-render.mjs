// CFF 字体解析 + 文本渲染测试
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCffFont, renderText } from '../../lib/font-render.js';
import { encodePng } from '../../lib/scene-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WE = 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine';

const fontPath = path.join(WE, 'assets/fonts/Segment7Standard.otf');
const b = fs.readFileSync(fontPath);
console.log('字体:', fontPath.split('/').pop(), b.length, '字节');

const font = parseCffFont(new Uint8Array(b));
if (!font) { console.log('FAIL: 解析失败'); process.exit(1); }
console.log('unitsPerEm:', font.unitsPerEm, 'glyphs:', font.charstrings.length);
console.log('ascender:', font.ascender, 'descender:', font.descender);
// 字符映射
console.log('数字 0-9 映射:', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(c => `${c}→${font.charToGlyph.get(48 + c)}`).join(' '));
// 渲染 "00000" (dino_run 计分)
const img = renderText(font, '00000', 64, [1, 0.961, 0.443]);
console.log('渲染 "00000" 尺寸:', img.width, 'x', img.height);
if (img.width > 0) {
  // 统计非透明像素
  let cnt = 0;
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 128) cnt++;
  console.log('非透明像素:', cnt);
  fs.writeFileSync(path.join(__dirname, '../../scene-layers-out/text_test.png'), encodePng(img.width, img.height, img.rgba));
  console.log('已保存 text_test.png');
}
// 渲染单个 '5' 看结构
const img5 = renderText(font, '5', 100, [1, 1, 1]);
console.log('"5" 尺寸:', img5.width, 'x', img5.height, '非透明:', (() => { let c = 0; for (let i = 3; i < img5.rgba.length; i += 4) if (img5.rgba[i] > 128) c++; return c; })());
