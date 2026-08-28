#ifndef WE_COMMON_PERSPECTIVE_H_MIN
#define WE_COMMON_PERSPECTIVE_H_MIN
// 仅 waterripple.vert PERSPECTIVE=1 分支引用；白名单场景该分支被 #if 裁掉，
// 但 include 必须展开且可编译。
// squareToQuad = 单位方→四边形射影映射（Heckbert 公式重构；CPU math.js 无此函数）。
// 三组几何核对：单位方→恒等；平行四边形→g=h=0 纯仿射；梯形数值代入 (1,1)→(2,2)✓ (0,1)→(0,1)✓。
// 【重构+验证，非官方原文；PERSPECTIVE=1 不在 Phase 1】
mat3 squareToQuad(vec2 p0, vec2 p1, vec2 p2, vec2 p3) {
    float dx1 = p1.x - p2.x, dy1 = p1.y - p2.y;
    float dx2 = p3.x - p2.x, dy2 = p3.y - p2.y;
    float sx  = p0.x - p1.x + p2.x - p3.x;
    float sy  = p0.y - p1.y + p2.y - p3.y;
    float den = dx1 * dy2 - dy1 * dx2;
    float g = (sx * dy2 - sy * dx2) / den;
    float h = (dx1 * sy - dy1 * sx) / den;
    float a = p1.x - p0.x + g * p1.x;
    float b = p3.x - p0.x + h * p3.x;
    float c = p0.x;
    float d = p1.y - p0.y + g * p1.y;
    float e = p3.y - p0.y + h * p3.y;
    float f = p0.y;
    return mat3(a, d, g,  b, e, h,  c, f, 1.0);  // 列主序构造；列向量约定 p'=M·(u,v,1)ᵀ
}
// inverse(mat3)：ES 3.00 内建，不重定义；ES 1.00 首选路径下只在被裁掉的 #else 里出现，无需实现。
#endif
