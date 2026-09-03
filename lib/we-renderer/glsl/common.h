#ifndef WE_COMMON_H_MIN
#define WE_COMMON_H_MIN
#define M_PI   3.14159265358979323846
#define M_PI_2 1.57079632679489661923
#define M_PI_4 0.78539816339744830962
#define mul(v, m) ((v) * (m))            // GLSL v*m 与 HLSL mul(v,m)（行向量积）逐位等价
#define frac fract                        // iris.vert 用
#define lerp mix
#define saturate(x) clamp((x), 0.0, 1.0)
#define CAST2(x) vec2(x)
#define CAST3(x) vec3(x)
#define CAST4(x) vec4(x)
#define CAST3X3(x) mat3(x)
// rotateVec2：官方语义=平面逆时针旋转。核对：CPU waterripple.js 以
// rotateVec2((0,1),dir) 得 (-sin dir, cos dir)，与本实现一致。【官方语义核对过】
vec2 rotateVec2(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}
#endif
