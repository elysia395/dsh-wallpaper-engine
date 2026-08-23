import fs from 'fs';
// 对比静态 puppet 与 MDLA 统一画布的边界
const staticOffset = JSON.parse(fs.readFileSync('D:/dsh-wallpaper-engine/scene-layers-out/puppet_人物.offset.json', 'utf8'));
console.log('静态 puppet_人物.offset.json:', JSON.stringify(staticOffset));

// 静态: box.minX=?, 画布 2401x2481, drawOffset=[-1122,-1732]
// 场景 origin=[2115.1,654.6]
// 屏幕定位: 人物左下角 = origin + drawOffset?
// 静态画布: 2401x2481, drawOffset=(-1122,-1732) → 在 origin 坐标系里画布左上角 = origin + (-1122, -1732) + (0, 画布高)?
// 实际: lwe 中 m_pos 计算 + drawOffset 语义
console.log('静态画布 2401x2481 drawOffset=(-1122,-1732)');
console.log('MDLA 统一画布 2402x2671, 全局边界 minX=-1122.2 maxX=1278.2 minY=-748.3 maxY=1921.6');

// 验证: 静态渲染的 box
// 静态 rasterize 的 box = 顶点实际范围, drawOffset=[minX, -maxY]
// 静态 minX = -1122, maxY = 1732 → 画布高 2481 → minY = 1732-2481 = -749
// MDLA: minY=-748.3 maxY=1921.6 → 画布高 2671
// 差异: maxY 从 1732 → 1921.6 (+189.6), 即长发摆动时延伸到更低 190px
console.log('\n差异: maxY 1732 → 1921.6 (+190px 长发下探)');
console.log('新 drawOffset: 保持 x=-1122, y 需从 -1732 变为 -1921.6 (画布左上角在屏幕坐标)');

// demo 中: ctx.translate(origin[0], H-origin[1]); drawImage(img, drawOffset[0], drawOffset[1], size[0], size[1])
// drawImage 的 drawOffset 是画布左上角相对 origin 的位置
// 静态: drawOffset=(-1122,-1732) → 画布左上角在 origin 左上 (1122, 1732)
// 屏幕 y 向下, 所以画布顶部 = origin.y 上方 1732px? 不对, 需要验证
console.log('\n结论: 需要新的 drawOffset 使动画帧在场景中位置正确');
