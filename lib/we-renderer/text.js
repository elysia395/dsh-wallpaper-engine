// WE 渲染引擎 — text (从 core.js 拆分, 逻辑不变)
import path from 'path';
import { parseVec3, getVal } from './math.js';
import { parseCffFont, renderText } from '../font-render.js';

// ── text mixin (从 core.js 拆分, 逻辑零改动) ──
export function installText(proto) {
  Object.assign(proto, {
    renderTextObject(o, t) {
        const text = String(getVal(o, 'text', ''));
        if (!text) return;
        const color = parseVec3(getVal(o, 'color', '1 1 1'), [1, 1, 1]);
        const pointsize = getVal(o, 'pointsize', 32);
        const scale = parseVec3(getVal(o, 'scale'), [1, 1, 1]);
        const tr = this.resolveTransform(o);
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        const ps = ortho && ortho.width ? [this.W / ortho.width, this.H / (ortho.height || 1080)] : [1, 1];
        // 字体: 场景 fonts/ 或全局 assets/fonts/; systemfont_* = WE 系统字体标识
        // (引擎用系统字体; 跨平台用内置 NotoSans 替代)
        let fontPath = getVal(o, 'font', '');
        if (String(fontPath).startsWith('systemfont_')) {
          fontPath = 'fonts/NotoSans-Regular.ttf';
        }
        if (fontPath) {
          try {
            const raw = this.readAny(fontPath) || this.readAny('fonts/' + path.basename(fontPath));
            if (!raw) { this.log('text ' + (o.name || o.id) + ': 字体缺失 ' + fontPath); return; }
            const font = parseCffFont(raw);
            if (!font) { this.log('text ' + (o.name || o.id) + ': 字体解析失败'); return; }
            // WE text: 字形像素 = pointsize × 场景缩放 × 对象 scale (场景单位→像素)
            const px = Math.max(4, Math.round(pointsize * ps[1] * scale[1]));
            const img = renderText(font, text, px, color);
            if (!img.width) return;
            // 定位: origin 是场景坐标 (y 向上), horizontalalign right 时右对齐
            const vs = this._viewShift(o, [img.width, img.height], ps);
            const ox = tr.origin[0] * ps[0] + vs[0], oy = this.H - tr.origin[1] * ps[1] + vs[1];
            const dw = img.width, dh = img.height;
            const align = String(getVal(o, 'horizontalalign', 'left'));
            const dx = align === 'right' ? ox - dw : (align === 'center' ? ox - dw / 2 : ox - dw / 2);
            this.canvas.blitScaled(img, dx, oy - dh / 2, dw, dh, getVal(o, 'alpha', 1));
          } catch (e) {
            this.log('text ' + (o.name || o.id) + ' 渲染失败: ' + e.message);
          }
        }
      }
    
      // ── Puppet (MDL 网格) 渲染: 解析 mesh → 蒙皮(骨骼动画) → 光栅化 ────
  });
}
