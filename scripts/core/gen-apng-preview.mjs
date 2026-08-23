// 生成 APNG 预览 HTML (数据 URI 内嵌)
import fs from 'node:fs';
const b = fs.readFileSync('D:/dsh-wallpaper-engine/scene-layers-out/shimmer_anim.apng');
const b64 = b.toString('base64');
const html = `<!DOCTYPE html><html><body style="background:#222;margin:0"><img src="data:image/apng;base64,${b64}" style="max-width:480px"></body></html>`;
fs.writeFileSync('D:/dsh-wallpaper-engine/scripts/core/apng-preview2.html', html);
console.log('HTML 大小:', html.length, '数据 URI 长度:', b64.length);
